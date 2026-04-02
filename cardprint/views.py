"""
Card Print Views
================
Page views + API endpoints for the Print Cards workflow:
    Approved → Generate List → Finalized → Pool
  + Generate Card editor page + PDF generation API.

ARCHITECTURE RULES (same as reprint):
- Views are ULTRA-THIN: parse request → call service → return JsonResponse.
- All mutations delegate to PrintWorkflowService / GenerateCardService.
"""
import io
import json
import logging

from django.conf import settings
from django.shortcuts import get_object_or_404, redirect, render
from django.http import HttpResponse, JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.timezone import localtime
from django.utils.dateparse import parse_datetime

from idcards.models import IDCard, IDCardTable
from core.services.permission_service import PermissionService, api_require_permission
from core.views.base import get_user_role, require_any_admin
from core.services import IDCardService

from .models import PrintRequest, CardTemplate, validate_field_mappings
from .services import PrintWorkflowService, GenerateCardService

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def _print_access_denied():
    return JsonResponse(
        {'status': 'error', 'message': 'Access denied. You are not assigned to this client.'},
        status=403,
    )


def _parse_offset_limit(request, *, default_limit=100, max_limit=200):
    """Parse and clamp offset/limit query params for list endpoints."""
    try:
        offset = int(request.GET.get('offset', 0))
    except (ValueError, TypeError):
        offset = 0
    try:
        limit = int(request.GET.get('limit', default_limit))
    except (ValueError, TypeError):
        limit = default_limit

    offset = max(offset, 0)
    limit = min(max(limit, 1), max_limit)
    return offset, limit


def _parse_local_datetime_filter(value):
    """Parse datetime-local input safely into an aware datetime."""
    if not value:
        return None
    dt = parse_datetime(value)
    if not dt:
        return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _check_print_table_scope(user, table_id):
    """Check user has access to the client owning this table."""
    table = get_object_or_404(IDCardTable.objects.select_related('group'), id=table_id)
    if not PermissionService.is_super_admin(user):
        staff_profile = getattr(user, 'staff_profile', None)
        if staff_profile and staff_profile.staff_type == 'admin_staff':
            if not staff_profile.assigned_clients.filter(id=table.group.client_id).exists():
                return None, _print_access_denied()
        elif user.role in ('client', 'client_staff'):
            from client.services import ClientAccessService
            if not ClientAccessService.can_access_table(user, table):
                return None, _print_access_denied()
    return table, None


def _build_ordered_fields(table, fd=None, fd_upper=None):
    """Build ordered fields list for a card's field_data against table.fields."""
    if fd is None:
        fd = {}
    if fd_upper is None:
        fd_upper = {k.upper(): v for k, v in fd.items()}
    ordered = []
    for field in table.fields:
        fname = field['name']
        ftype = field.get('type', 'text')
        fval = fd.get(fname, '') or fd_upper.get(fname.upper(), '')
        ordered.append({'name': fname, 'type': ftype, 'value': fval})
    return ordered


def _get_selected_generate_field_names(table, template_obj=None):
    """Return selected field names for generate-list display; fallback to all fields."""
    if template_obj is None:
        template_obj = CardTemplate.objects.filter(table=table).first()

    all_field_names = [f.get('name') for f in (table.fields or []) if f.get('name')]
    if not template_obj:
        return all_field_names

    cfg = template_obj.field_config or {}
    front = cfg.get('front_fields') or []
    back = cfg.get('back_fields') or [] if cfg.get('is_two_sided') else []

    valid = set(all_field_names)
    selected = []
    for name in front + back:
        if name in valid and name not in selected:
            selected.append(name)

    return selected if selected else all_field_names


def _filter_ordered_fields_by_names(ordered_fields, allowed_names):
    """Filter ordered_fields to the selected names while preserving row order."""
    if not ordered_fields or not allowed_names:
        return ordered_fields
    allowed = set(allowed_names)
    return [f for f in ordered_fields if f.get('name') in allowed]


def _promote_legacy_print_list(table):
    """One-way compatibility: move legacy print_list rows into generate_list."""
    PrintRequest.objects.filter(table=table, status='print_list').update(status='generate_list')


# ---------------------------------------------------------------------------
# PAGE VIEW
# ---------------------------------------------------------------------------

@login_required
@require_any_admin
def print_cards(request, table_id):
    """Print Cards workflow page with tabs: Generate List | Finalized."""
    table = get_object_or_404(
        IDCardTable.objects.select_related('group__client'), id=table_id,
    )
    user = request.user
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('active_clients')

    _promote_legacy_print_list(table)

    current_step = request.GET.get('step', 'generate_list')
    if current_step not in ('generate_list', 'finalized'):
        current_step = 'generate_list'

    # Step counts for tabs
    counts = PrintRequest.objects.filter(table=table).aggregate(
        fn=Count('id', filter=Q(status='finalized')),
        gl=Count('id', filter=Q(status='generate_list')),
    )
    step_counts = {
        'finalized': counts['fn'],
        'generate_list': counts['gl'],
    }
    approved_count = IDCard.objects.filter(table=table, status='approved').count()

    # Items for the current step
    generate_items = []
    finalized_items = []
    generate_total = 0
    finalized_total = 0

    # Existing field configuration drives which columns are shown in Generate List.
    template_obj = CardTemplate.objects.filter(table=table).first()
    selected_generate_field_names = _get_selected_generate_field_names(table, template_obj)

    if current_step == 'generate_list':
        base_qs = PrintRequest.objects.filter(table=table, status='generate_list')
        generate_total = base_qs.count()
        pr_qs = base_qs.select_related('card', 'requested_by').order_by('-updated_at')[:200]
        for idx, pr in enumerate(pr_qs):
            card = pr.card
            fd = card.field_data or {}
            fd_upper = {k.upper(): v for k, v in fd.items()}
            ordered_fields = _build_ordered_fields(table, fd, fd_upper)
            ordered_fields = _filter_ordered_fields_by_names(ordered_fields, selected_generate_field_names)
            req_by = pr.requested_by
            generate_items.append({
                'pr_id': pr.id,
                'card_id': card.id,
                'sr_no': idx + 1,
                'status': card.status,
                'status_display': card.get_status_display(),
                'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
                'moved_at': localtime(pr.updated_at).strftime('%d %b %Y %H:%M'),
                'ordered_fields': ordered_fields,
            })

    elif current_step == 'finalized':
        base_qs = PrintRequest.objects.filter(table=table, status='finalized')
        finalized_total = base_qs.count()
        pr_qs = base_qs.select_related('card', 'requested_by').order_by('-updated_at')[:200]
        for idx, pr in enumerate(pr_qs):
            card = pr.card
            fd = card.field_data or {}
            fd_upper = {k.upper(): v for k, v in fd.items()}
            ordered_fields = _build_ordered_fields(table, fd, fd_upper)
            req_by = pr.requested_by
            finalized_items.append({
                'pr_id': pr.id,
                'card_id': card.id,
                'sr_no': idx + 1,
                'status': card.status,
                'status_display': card.get_status_display(),
                'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
                'finalized_at': localtime(pr.updated_at).strftime('%d %b %Y %H:%M'),
                'ordered_fields': ordered_fields,
            })

    # Load existing field_config for the configure modal
    field_config = template_obj.field_config if template_obj else {}

    # Generate-card editor data (for inline modal)
    front_pdf_url = template_obj.front_pdf.url if template_obj and template_obj.front_pdf else ''
    back_pdf_url  = template_obj.back_pdf.url  if template_obj and template_obj.back_pdf  else ''
    template_data = {
        'is_two_sided':   template_obj.is_two_sided   if template_obj else False,
        'field_mappings': template_obj.field_mappings if template_obj else {'front': {}, 'back': {}},
        'font_size':      template_obj.font_size      if template_obj else 8,
        'font_family':    template_obj.font_family    if template_obj else 'Helvetica-Bold',
    }

    import json as _json
    context = {
        'active_page': 'active_clients',
        'user_role': get_user_role(user),
        'table': table,
        'group': table.group,
        'client': table.group.client,
        'current_step': current_step,
        'step_counts': step_counts,
        'approved_count': approved_count,
        'generate_items': generate_items,
        'finalized_items': finalized_items,
        'generate_total': generate_total,
        'generate_has_more': generate_total > len(generate_items),
        'generate_display_fields': [
            f for f in (table.fields or [])
            if f.get('name') in set(selected_generate_field_names)
        ],
        'finalized_total': finalized_total,
        'finalized_has_more': finalized_total > len(finalized_items),
        'table_fields_json': _json.dumps(table.fields if table.fields else []),
        'field_config_json': _json.dumps(field_config),
        'has_template_front_pdf': bool(template_obj and template_obj.front_pdf),
        'has_template_back_pdf': bool(template_obj and template_obj.back_pdf),
        'template_data_json': _json.dumps(template_data),
        'front_pdf_url': front_pdf_url,
        'back_pdf_url': back_pdf_url,
    }
    return render(request, 'cardprint/print-cards.html', context)


# ---------------------------------------------------------------------------
# API VIEWS
# ---------------------------------------------------------------------------

@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_print_send(request, table_id):
    """Send approved cards to generate list.

    Body: { "card_ids": [1, 2, 3] }
    Only cards in 'approved' status are accepted.
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    _promote_legacy_print_list(table)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    card_ids = data.get('card_ids', [])
    if not card_ids:
        return JsonResponse({'status': 'error', 'message': 'No cards selected'}, status=400)

    # Only allow cards in 'approved' status
    valid_ids = list(
        IDCard.objects.filter(
            id__in=card_ids, table=table, status='approved',
        ).values_list('id', flat=True)
    )
    if not valid_ids:
        return JsonResponse(
            {'status': 'error', 'message': 'No approved cards found in selection'},
            status=400,
        )

    result = PrintWorkflowService.create_requests(table, valid_ids, request.user)

    if not result.success:
        return JsonResponse({'status': 'error', 'message': result.message}, status=400)

    # Move approved cards → download status so they leave the approve list
    if result.data['created'] > 0:
        IDCard.objects.filter(
            id__in=valid_ids,
            table=table,
            status='approved',
        ).update(status='download')

    return JsonResponse({
        'status': 'ok',
        'message': f"{result.data['created']} card(s) added to generate list"
                   + (f" ({result.data['skipped']} already in list)" if result.data['skipped'] else ''),
        'created': result.data['created'],
        'skipped': result.data['skipped'],
    })


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_print_step_counts(request, table_id):
    """Return step counts for the generate/finalized workflow tabs."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    _promote_legacy_print_list(table)

    counts = PrintRequest.objects.filter(table=table).aggregate(
        gl=Count('id', filter=Q(status='generate_list')),
        fn=Count('id', filter=Q(status='finalized')),
        po=Count('id', filter=Q(status='pool')),
    )
    approved_count = IDCard.objects.filter(table=table, status='approved').count()
    return JsonResponse({
        'status': 'ok',
        'generate_list': counts['gl'],
        'finalized': counts['fn'],
        'pool': counts['po'],
        'approved': approved_count,
    })


# ---------------------------------------------------------------------------
# 2-STEP API VIEWS: Generate, Finalized List, Mark Pool, Pool List
# ---------------------------------------------------------------------------


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_print_generate_list(request, table_id):
    """List generate_list items with pagination and search."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    _promote_legacy_print_list(table)

    query = request.GET.get('q', '').strip()
    from_dt = _parse_local_datetime_filter(request.GET.get('from'))
    to_dt = _parse_local_datetime_filter(request.GET.get('to'))
    offset, limit = _parse_offset_limit(request, default_limit=100, max_limit=200)

    pr_qs = PrintRequest.objects.filter(
        table=table, status='generate_list',
    ).select_related('card', 'requested_by').order_by('-updated_at')

    selected_generate_field_names = _get_selected_generate_field_names(table)

    if query:
        pr_qs = IDCardService._apply_search_filter(
            pr_qs,
            query,
            table=table,
            json_field='card__field_data',
            id_lookup='card__id',
        )

    if from_dt:
        pr_qs = pr_qs.filter(updated_at__gte=from_dt)
    if to_dt:
        pr_qs = pr_qs.filter(updated_at__lte=to_dt)

    total = pr_qs.count()
    batch = list(pr_qs[offset:offset + limit + 1])
    has_more = len(batch) > limit
    if has_more:
        batch = batch[:limit]

    items = []
    for idx, pr in enumerate(batch):
        card = pr.card
        fd = card.field_data or {}
        fd_upper = {k.upper(): v for k, v in fd.items()}
        ordered_fields = _build_ordered_fields(table, fd, fd_upper)
        ordered_fields = _filter_ordered_fields_by_names(ordered_fields, selected_generate_field_names)
        req_by = pr.requested_by
        items.append({
            'pr_id': pr.id,
            'card_id': card.id,
            'sr_no': offset + idx + 1,
            'status': card.status,
            'status_display': card.get_status_display(),
            'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
            'moved_at': localtime(pr.updated_at).strftime('%d %b %Y %H:%M'),
            'ordered_fields': ordered_fields,
        })

    return JsonResponse({
        'status': 'ok',
        'items': items,
        'total': total,
        'has_more': has_more,
        'offset': offset,
        'limit': limit,
    })


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_field_config_save(request, table_id):
    """Save field_config (selected fields per side) for a table's CardTemplate.

    Body: {
        "is_two_sided": true/false,
        "front_fields": ["Name", "Photo", ...],
        "back_fields": ["Father Name", ...]
    }
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    is_two_sided = bool(data.get('is_two_sided', False))
    front_fields = data.get('front_fields', [])
    back_fields = data.get('back_fields', []) if is_two_sided else []

    if not front_fields:
        return JsonResponse({'status': 'error', 'message': 'Select at least one front field'}, status=400)

    # Validate field names against table fields
    valid_names = {f['name'] for f in (table.fields or [])}
    for fname in front_fields + back_fields:
        if fname not in valid_names:
            return JsonResponse({'status': 'error', 'message': f'Invalid field: {fname}'}, status=400)

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    tmpl.field_config = {
        'is_two_sided': is_two_sided,
        'front_fields': front_fields,
        'back_fields': back_fields,
    }
    tmpl.is_two_sided = is_two_sided
    tmpl.save()

    return JsonResponse({'status': 'ok', 'message': 'Field configuration saved'})


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_finalized_list')
def api_print_finalized_list(request, table_id):
    """List finalized print items with pagination and search."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    from_dt = _parse_local_datetime_filter(request.GET.get('from'))
    to_dt = _parse_local_datetime_filter(request.GET.get('to'))
    offset, limit = _parse_offset_limit(request, default_limit=100, max_limit=200)

    pr_qs = PrintRequest.objects.filter(
        table=table, status='finalized',
    ).select_related('card', 'requested_by').order_by('-updated_at')

    if query:
        pr_qs = IDCardService._apply_search_filter(
            pr_qs,
            query,
            table=table,
            json_field='card__field_data',
            id_lookup='card__id',
        )

    if from_dt:
        pr_qs = pr_qs.filter(updated_at__gte=from_dt)
    if to_dt:
        pr_qs = pr_qs.filter(updated_at__lte=to_dt)

    total = pr_qs.count()
    batch = list(pr_qs[offset:offset + limit + 1])
    has_more = len(batch) > limit
    if has_more:
        batch = batch[:limit]

    items = []
    for idx, pr in enumerate(batch):
        card = pr.card
        fd = card.field_data or {}
        fd_upper = {k.upper(): v for k, v in fd.items()}
        ordered_fields = _build_ordered_fields(table, fd, fd_upper)
        req_by = pr.requested_by
        items.append({
            'pr_id': pr.id,
            'card_id': card.id,
            'sr_no': offset + idx + 1,
            'status': card.status,
            'status_display': card.get_status_display(),
            'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
            'finalized_at': localtime(pr.updated_at).strftime('%d %b %Y %H:%M'),
            'ordered_fields': ordered_fields,
        })

    return JsonResponse({
        'status': 'ok',
        'items': items,
        'total': total,
        'has_more': has_more,
        'offset': offset,
        'limit': limit,
    })


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_finalized_list')
def api_print_mark_pool(request, table_id):
    """Move finalized items to pool.

    Body: { "request_ids": [1, 2, 3] }
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    request_ids = data.get('request_ids', [])
    if not request_ids:
        return JsonResponse({'status': 'error', 'message': 'No items selected'}, status=400)

    valid_ids = list(
        PrintRequest.objects.filter(
            id__in=request_ids, table=table, status='finalized',
        ).values_list('id', flat=True)
    )
    if not valid_ids:
        return JsonResponse(
            {'status': 'error', 'message': 'No valid finalized items found'},
            status=400,
        )

    result = PrintWorkflowService.bulk_mark_pool(valid_ids, request.user)
    if not result.success:
        return JsonResponse({'status': 'error', 'message': result.message}, status=400)
    return JsonResponse({
        'status': 'ok',
        'message': f"{result.data['updated']} item(s) moved to pool",
        'updated': result.data['updated'],
        'skipped': result.data['skipped'],
    })


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_print_retrieve_generate(request, table_id):
    """Move generate-list items back to approved list.

    Body: { "request_ids": [1, 2, 3] }
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    request_ids = data.get('request_ids', [])
    if not request_ids:
        return JsonResponse({'status': 'error', 'message': 'No items selected'}, status=400)

    prs = list(
        PrintRequest.objects.filter(
            id__in=request_ids,
            table=table,
            status='generate_list',
        ).values('id', 'card_id')
    )
    if not prs:
        return JsonResponse({'status': 'error', 'message': 'No valid generate-list items found'}, status=400)

    valid_request_ids = [row['id'] for row in prs]
    card_ids = [row['card_id'] for row in prs]

    with transaction.atomic():
        # Move cards back to approved list.
        IDCard.objects.filter(
            id__in=card_ids,
            table=table,
        ).update(status='approved')

        # Remove from active print workflow.
        updated = PrintRequest.objects.filter(
            id__in=valid_request_ids,
            table=table,
            status='generate_list',
        ).update(status='pool', updated_at=timezone.now())

    return JsonResponse({
        'status': 'ok',
        'message': f'{updated} item(s) moved back to approved list',
        'updated': updated,
        'skipped': len(request_ids) - updated,
    })


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_finalized_list')
def api_print_retrieve_finalized(request, table_id):
    """Move finalized items back to pending list.

    Body: { "request_ids": [1, 2, 3] }
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    request_ids = data.get('request_ids', [])
    if not request_ids:
        return JsonResponse({'status': 'error', 'message': 'No items selected'}, status=400)

    prs = list(
        PrintRequest.objects.filter(
            id__in=request_ids,
            table=table,
            status='finalized',
        ).values('id', 'card_id')
    )
    if not prs:
        return JsonResponse({'status': 'error', 'message': 'No valid finalized items found'}, status=400)

    valid_request_ids = [row['id'] for row in prs]
    card_ids = [row['card_id'] for row in prs]

    with transaction.atomic():
        # Move cards back to pending list.
        IDCard.objects.filter(
            id__in=card_ids,
            table=table,
        ).update(status='pending')

        # Remove from active print workflow.
        updated = PrintRequest.objects.filter(
            id__in=valid_request_ids,
            table=table,
            status='finalized',
        ).update(status='pool', updated_at=timezone.now())

    return JsonResponse({
        'status': 'ok',
        'message': f'{updated} item(s) moved back to pending list',
        'updated': updated,
        'skipped': len(request_ids) - updated,
    })


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_print_pool_list(request, table_id):
    """List pool items with pagination and search."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    offset, limit = _parse_offset_limit(request, default_limit=100, max_limit=200)

    pr_qs = PrintRequest.objects.filter(
        table=table, status='pool',
    ).select_related('card', 'requested_by').order_by('-updated_at')

    if query:
        pr_qs = IDCardService._apply_search_filter(
            pr_qs,
            query,
            table=table,
            json_field='card__field_data',
            id_lookup='card__id',
        )

    total = pr_qs.count()
    batch = list(pr_qs[offset:offset + limit + 1])
    has_more = len(batch) > limit
    if has_more:
        batch = batch[:limit]

    items = []
    for idx, pr in enumerate(batch):
        card = pr.card
        fd = card.field_data or {}
        fd_upper = {k.upper(): v for k, v in fd.items()}
        ordered_fields = _build_ordered_fields(table, fd, fd_upper)
        req_by = pr.requested_by
        items.append({
            'pr_id': pr.id,
            'card_id': card.id,
            'sr_no': offset + idx + 1,
            'status': card.status,
            'status_display': card.get_status_display(),
            'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
            'pool_at': localtime(pr.updated_at).strftime('%d %b %Y %H:%M'),
            'ordered_fields': ordered_fields,
        })

    return JsonResponse({
        'status': 'ok',
        'items': items,
        'total': total,
        'has_more': has_more,
        'offset': offset,
        'limit': limit,
    })

# ===========================================================================
# GENERATE CARD � PAGE VIEWS
# ===========================================================================
@login_required
@require_any_admin
def generate_card(request, table_id):
    """Generate Card editor for a specific table."""
    table = get_object_or_404(
        IDCardTable.objects.select_related('group__client'), id=table_id,
    )
    user = request.user
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('active_clients')

    template_obj, _ = CardTemplate.objects.get_or_create(table=table)
    generate_count = PrintRequest.objects.filter(table=table, status='generate_list').count()

    import json as _json
    template_data = {
        'is_two_sided': template_obj.is_two_sided,
        'field_mappings': template_obj.field_mappings or {'front': {}, 'back': {}},
        'font_size': template_obj.font_size,
        'font_family': template_obj.font_family,
        'has_front_pdf': bool(template_obj.front_pdf),
        'has_back_pdf': bool(template_obj.back_pdf),
        'front_pdf_url': template_obj.front_pdf.url if template_obj.front_pdf else None,
        'back_pdf_url': template_obj.back_pdf.url if template_obj.back_pdf else None,
    }

    table_fields = table.fields if hasattr(table, 'fields') and table.fields else []
    field_config = template_obj.field_config or {}

    context = {
        'active_page': 'active_clients',
        'user_role': get_user_role(user),
        'table': table,
        'group': table.group,
        'client': table.group.client,
        'template': template_obj,
        'template_data_json': _json.dumps(template_data),
        'table_fields_json': _json.dumps(table_fields),
        'field_config_json': _json.dumps(field_config),
        'front_pdf_url': template_obj.front_pdf.url if template_obj.front_pdf else '',
        'back_pdf_url': template_obj.back_pdf.url if template_obj.back_pdf else '',
        'generate_count': generate_count,
    }
    return render(request, 'cardprint/generate-card.html', context)


# ===========================================================================
# GENERATE CARD � API ENDPOINTS
# ===========================================================================

@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_template_get(request, table_id):
    """Return the current template settings for a table."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    return JsonResponse({
        'status': 'ok',
        'template': {
            'is_two_sided': tmpl.is_two_sided,
            'field_mappings': tmpl.field_mappings or {'front': {}, 'back': {}},
            'font_size': tmpl.font_size,
            'font_family': tmpl.font_family,
            'has_front_pdf': bool(tmpl.front_pdf),
            'has_back_pdf': bool(tmpl.back_pdf),
            'front_pdf_url': tmpl.front_pdf.url if tmpl.front_pdf else None,
            'back_pdf_url': tmpl.back_pdf.url if tmpl.back_pdf else None,
        },
    })


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_template_save(request, table_id):
    """Save field mappings and font settings for a table template."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    tmpl.is_two_sided = bool(data.get('is_two_sided', False))
    raw_mappings = data.get('field_mappings') or {'front': {}, 'back': {}}
    mapping_err = validate_field_mappings(raw_mappings)
    if mapping_err:
        return JsonResponse({'status': 'error', 'message': mapping_err}, status=400)
    tmpl.field_mappings = raw_mappings
    tmpl.font_size = max(7, min(10, int(data.get('font_size', 8) or 8)))
    font_family = data.get('font_family', 'Helvetica-Bold')
    if font_family not in ('Helvetica-Bold', 'Helvetica'):
        font_family = 'Helvetica-Bold'
    tmpl.font_family = font_family
    tmpl.save()
    return JsonResponse({'status': 'ok', 'message': 'Template saved'})


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_template_upload_pdf(request, table_id, side):
    """Upload front or back PDF template file."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    if side not in ('front', 'back'):
        return JsonResponse({'status': 'error', 'message': 'Invalid side'}, status=400)

    pdf_file = request.FILES.get('pdf')
    if not pdf_file:
        return JsonResponse({'status': 'error', 'message': 'No file uploaded'}, status=400)

    if not pdf_file.name.lower().endswith('.pdf'):
        return JsonResponse({'status': 'error', 'message': 'File must be a PDF (.pdf)'}, status=400)

    if pdf_file.size > 10 * 1024 * 1024:  # 10 MB limit
        return JsonResponse({'status': 'error', 'message': 'File too large (max 10 MB)'}, status=400)

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    if side == 'front':
        if tmpl.front_pdf:
            tmpl.front_pdf.delete(save=False)
        tmpl.front_pdf = pdf_file
    else:
        if tmpl.back_pdf:
            tmpl.back_pdf.delete(save=False)
        tmpl.back_pdf = pdf_file
    tmpl.save()

    pdf_url = (tmpl.front_pdf.url if side == 'front' else tmpl.back_pdf.url)
    return JsonResponse({'status': 'ok', 'message': 'PDF uploaded', 'pdf_url': pdf_url})


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_generate_card_list(request, table_id):
    """List cards in generate_list status for this table (paginated + searchable)."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    offset, limit = _parse_offset_limit(request, default_limit=500, max_limit=500)

    pr_qs = PrintRequest.objects.filter(
        table=table, status='generate_list',
    ).select_related('card', 'requested_by').order_by('created_at')

    selected_generate_field_names = _get_selected_generate_field_names(table)

    if query:
        pr_qs = IDCardService._apply_search_filter(
            pr_qs,
            query,
            table=table,
            json_field='card__field_data',
            id_lookup='card__id',
        )

    total = pr_qs.count()
    batch = list(pr_qs[offset:offset + limit])

    items = []
    for idx, pr in enumerate(batch):
        card = pr.card
        fd = card.field_data or {}
        fd_upper = {k.upper(): v for k, v in fd.items()}
        ordered_fields = _build_ordered_fields(table, fd, fd_upper)
        ordered_fields = _filter_ordered_fields_by_names(ordered_fields, selected_generate_field_names)
        items.append({
            'pr_id': pr.id,
            'card_id': card.id,
            'sr_no': offset + idx + 1,
            'ordered_fields': ordered_fields,
        })

    return JsonResponse({
        'status': 'ok',
        'items': items,
        'total': total,
        'offset': offset,
        'limit': limit,
    })


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_generate_pdf(request, table_id):
    """Generate a data-layer PDF for selected generate_list cards.

    On success: returns the PDF as a file download and moves cards to finalized.
    Body: { "request_ids": [1, 2, 3] }
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    request_ids = data.get('request_ids', [])
    if not request_ids:
        return JsonResponse({'status': 'error', 'message': 'No cards selected'}, status=400)

    try:
        tmpl = CardTemplate.objects.get(table=table)
    except CardTemplate.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'No template configured for this table'}, status=400)

    if not tmpl.field_mappings or not (tmpl.field_mappings.get('front') or tmpl.field_mappings.get('back')):
        return JsonResponse({'status': 'error', 'message': 'No field placements configured yet'}, status=400)

    prs = list(
        PrintRequest.objects.filter(
            id__in=request_ids, table=table, status='generate_list',
        ).select_related('card').order_by('created_at')
    )
    if not prs:
        return JsonResponse({'status': 'error', 'message': 'No valid generate-list cards found'}, status=400)

    pdf_buffer, error = GenerateCardService.generate(table, tmpl, prs)
    if error:
        logger.error('api_generate_pdf: %s', error)
        return JsonResponse({'status': 'error', 'message': f'PDF generation failed: {error}'}, status=500)

    # Move cards to finalized
    valid_ids = [pr.id for pr in prs]
    PrintWorkflowService.bulk_generate(valid_ids, request.user)

    stamp = timezone.now().strftime('%Y%m%d_%H%M%S')
    safe_name = table.name.replace(' ', '_')[:30]
    filename = f'cards_{safe_name}_{stamp}.pdf'

    response = HttpResponse(pdf_buffer.read(), content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response
