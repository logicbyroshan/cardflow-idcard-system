"""
Reprint Card Views
==================
Page views + API endpoints for the Reprint Cards workflow:
    Reprint List (download source) → Request List → Confirmed List

ARCHITECTURE RULES:
- Views are ULTRA-THIN: parse request → call service → return JsonResponse.
- All mutations delegate to ReprintWorkflowService (in this app).
"""
import json
import logging

from django.shortcuts import get_object_or_404, redirect, render
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.db.models import Count, Q
from django.utils.timezone import localtime
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from idcards.models import IDCard, IDCardTable
from core.services.permission_service import PermissionService, api_require_permission
from core.views.base import get_user_role, require_any_admin
from core.views.idcard_helpers import _get_class_section_field_names, _build_class_filter_q

from .models import ReprintRequest
from .services import ReprintWorkflowService

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def _reprint_access_denied():
    return JsonResponse(
        {'status': 'error', 'message': 'Access denied. You are not assigned to this client.'},
        status=403,
    )


def _check_reprint_table_scope(user, table_id):
    """Check user has access to the client owning this table."""
    table = get_object_or_404(IDCardTable.objects.select_related('group'), id=table_id)
    if not PermissionService.is_super_admin(user):
        staff_profile = getattr(user, 'staff_profile', None)
        if staff_profile and staff_profile.staff_type == 'admin_staff':
            if not staff_profile.assigned_clients.filter(id=table.group.client_id).exists():
                return None, _reprint_access_denied()
        elif user.role in ('client', 'client_staff'):
            from client.services import ClientAccessService
            if not ClientAccessService.can_access_table(user, table):
                return None, _reprint_access_denied()
    return table, None


def _build_ordered_fields(card, table):
    """Build ordered field list from card field_data and table field config."""
    fd = card.field_data or {}
    fd_upper = {k.upper(): v for k, v in fd.items()}
    ordered_fields = []
    for field in table.fields:
        fname = field['name']
        ftype = field.get('type', 'text')
        fval = fd.get(fname, '') or fd_upper.get(fname.upper(), '')
        ordered_fields.append({'name': fname, 'type': ftype, 'value': fval})
    return ordered_fields


def _require_admin_role(user):
    """Return a 403 JsonResponse if user is not super_admin or admin_staff, else None."""
    if PermissionService.is_any_admin(user):
        return None
    return JsonResponse(
        {'status': 'error', 'message': 'Admin access required for this action.'},
        status=403,
    )


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


# ---------------------------------------------------------------------------
# PAGE VIEW
# ---------------------------------------------------------------------------

@login_required
@require_any_admin
def reprint_cards(request, table_id):
    """Reprint Cards page — Reprint List → Request List → Confirmed."""
    table = get_object_or_404(
        IDCardTable.objects.select_related('group__client'), id=table_id,
    )
    user = request.user
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('active_clients')
    if not PermissionService.has_permission(user, 'perm_idcard_reprint_list'):
        return redirect('active_clients')

    current_step = request.GET.get('step', 'request_list')
    if current_step not in ('request_list', 'confirmed'):
        current_step = 'request_list'

    # Step counts
    source_cards_qs = IDCard.objects.filter(table=table, status='download')
    source_cards_count = source_cards_qs.count()
    request_count = ReprintRequest.objects.filter(
        table=table,
        status='requested',
        card__status='download',
    ).count()
    confirmed_count = ReprintRequest.objects.filter(
        table=table,
        status='confirmed',
        card__status='download',
    ).count()
    step_counts = {
        'download_list': source_cards_count,
        'reprint_list': source_cards_count,
        'request_list': request_count,
        'confirmed': confirmed_count,
    }

    INITIAL_LOAD_LIMIT = 100

    # Reprint List — source cards limited to Download
    reprint_items = []
    reprint_total = 0
    if current_step == 'reprint_list':
        card_qs = source_cards_qs.order_by('-updated_at')
        reprint_total = card_qs.count()
        card_batch = card_qs[:INITIAL_LOAD_LIMIT]
        for idx, card in enumerate(card_batch):
            reprint_items.append({
                'card_id': card.id,
                'sr_no': idx + 1,
                'status': card.status,
                'get_status_display': card.get_status_display(),
                'ordered_fields': _build_ordered_fields(card, table),
                'updated_at': card.updated_at,
            })

    # Request List — status='requested'
    request_items = []
    request_total = 0
    if current_step == 'request_list':
        req_qs = ReprintRequest.objects.filter(
            table=table,
            status='requested',
            card__status='download',
        ).select_related('card', 'requested_by').order_by('-created_at')
        request_total = req_qs.count()
        req_batch = req_qs[:INITIAL_LOAD_LIMIT]
        for idx, rr in enumerate(req_batch):
            req_by = rr.requested_by
            request_items.append({
                'rr_id': rr.id,
                'card_id': rr.card_id,
                'sr_no': idx + 1,
                'requested_by_name': (req_by.get_full_name() or req_by.username) if req_by else 'System',
                'requested_at': rr.created_at,
                'ordered_fields': _build_ordered_fields(rr.card, table),
                'updated_at': rr.card.updated_at,
            })

    # Confirmed List — status='confirmed'
    confirmed_items = []
    confirmed_total = 0
    if current_step == 'confirmed':
        cf_qs = ReprintRequest.objects.filter(
            table=table,
            status='confirmed',
            card__status='download',
        ).select_related('card', 'requested_by').order_by('-updated_at')
        confirmed_total = cf_qs.count()
        cf_batch = cf_qs[:INITIAL_LOAD_LIMIT]
        for idx, rr in enumerate(cf_batch):
            req_by = rr.requested_by
            confirmed_items.append({
                'rr_id': rr.id,
                'card_id': rr.card_id,
                'sr_no': idx + 1,
                'requested_by_name': (req_by.get_full_name() or req_by.username) if req_by else 'System',
                'confirmed_at': rr.updated_at,
                'ordered_fields': _build_ordered_fields(rr.card, table),
                'updated_at': rr.card.updated_at,
            })

    context = {
        'active_page': 'active_clients',
        'user_role': get_user_role(request.user),
        'table': table,
        'group': table.group,
        'client': table.group.client,
        'current_step': current_step,
        'step_counts': step_counts,
        # Step data
        'reprint_items': reprint_items,
        'reprint_total': reprint_total,
        'reprint_has_more': reprint_total > INITIAL_LOAD_LIMIT,
        'request_items': request_items,
        'request_total': request_total,
        'request_has_more': request_total > INITIAL_LOAD_LIMIT,
        'confirmed_items': confirmed_items,
        'confirmed_total': confirmed_total,
        'confirmed_has_more': confirmed_total > INITIAL_LOAD_LIMIT,
        'initial_load_limit': INITIAL_LOAD_LIMIT,
    }
    return render(request, 'reprintcard/reprint-cards.html', context)


# ---------------------------------------------------------------------------
# API VIEWS
# ---------------------------------------------------------------------------

@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_step_counts(request, table_id):
    """Return step counts for the reprint workflow tabs."""
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err:
        return err

    source_cards_count = IDCard.objects.filter(table=table, status='download').count()
    request_count = ReprintRequest.objects.filter(
        table=table,
        status='requested',
        card__status='download',
    ).count()
    confirmed_count = ReprintRequest.objects.filter(
        table=table,
        status='confirmed',
        card__status='download',
    ).count()
    return JsonResponse({
        'status': 'ok',
        'download_list': source_cards_count,
        'reprint_list': source_cards_count,
        'request_list': request_count,
        'confirmed': confirmed_count,
    })


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_list(request, table_id):
    """List source IDCards (Download only) for Reprint List step."""
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    try:
        offset = int(request.GET.get('offset', 0))
        limit = int(request.GET.get('limit', 100))
    except (ValueError, TypeError):
        offset, limit = 0, 100

    card_qs = IDCard.objects.filter(
        table=table,
        status='download',
    ).order_by('-updated_at')

    if query:
        search_q = Q(field_data__icontains=query)
        if query.isdigit():
            search_q |= Q(id=int(query))
        card_qs = card_qs.filter(search_q)

    total = card_qs.count()
    batch = list(card_qs[offset:offset + limit + 1])
    has_more = len(batch) > limit
    if has_more:
        batch = batch[:limit]

    items = []
    for idx, card in enumerate(batch):
        items.append({
            'card_id': card.id,
            'sr_no': offset + idx + 1,
            'status': card.status,
            'status_display': card.get_status_display(),
            'ordered_fields': _build_ordered_fields(card, table),
            'updated_at': localtime(card.updated_at).strftime('%d-%b-%Y %H:%M'),
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
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_request_create(request, table_id):
    """Create reprint requests for card IDs (goes to request list).
    Body: { "card_ids": [1, 2, 3], "reason": "optional" }
    """
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err:
        return err

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    card_ids = body.get('card_ids', [])
    reason = body.get('reason', '')

    result = ReprintWorkflowService.create_requests(
        table=table,
        card_ids=card_ids,
        reason=reason,
        requested_by=request.user,
    )

    if result.success:
        return JsonResponse({
            'status': 'ok',
            'message': result.message,
            'created_count': result.data['created_count'],
            'skipped_count': result.data['skipped_count'],
        })
    return JsonResponse({'status': 'error', 'message': result.message}, status=400)


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_confirm(request, table_id):
    """Confirm reprint requests: requested → confirmed.
    Body: { "rr_ids": [1, 2, 3] }
    """
    admin_err = _require_admin_role(request.user)
    if admin_err:
        return admin_err
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err:
        return err

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    rr_ids = body.get('rr_ids', [])
    if not rr_ids:
        return JsonResponse({'status': 'error', 'message': 'No reprint IDs provided'}, status=400)

    result = ReprintWorkflowService.bulk_transition(table, rr_ids, 'confirmed', user=request.user)

    if result.success:
        return JsonResponse({
            'status': 'ok',
            'message': result.message,
            'confirmed_count': result.data.get('updated_count', 0),
        })
    return JsonResponse({'status': 'error', 'message': result.message}, status=400)


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_request_list(request, table_id):
    """List requested reprint requests (status='requested')."""
    from django.db.models.functions import Cast
    from django.db.models import CharField
    from django.db.models.fields.json import KeyTextTransform

    table, err = _check_reprint_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    class_filter = request.GET.get('class', '').strip()
    section_filter = request.GET.get('section', '').strip()
    try:
        offset = int(request.GET.get('offset', 0))
        limit = int(request.GET.get('limit', 100))
    except (ValueError, TypeError):
        offset, limit = 0, 100

    rr_qs = ReprintRequest.objects.filter(
        table=table,
        status='requested',
        card__status='download',
    ).select_related('card', 'requested_by').order_by('-created_at')

    from_dt = _parse_local_datetime_filter(request.GET.get('from'))
    to_dt = _parse_local_datetime_filter(request.GET.get('to'))

    class_field_name, section_field_name = _get_class_section_field_names(table)
    if class_filter or section_filter:
        card_scope = IDCard.objects.filter(table=table, status='download')
        if class_filter and class_field_name:
            card_scope = _build_class_filter_q(card_scope, class_filter, class_field_name)
        if section_filter and section_field_name:
            card_scope = card_scope.annotate(
                _reprint_section=Cast(KeyTextTransform(section_field_name, 'field_data'), CharField()),
            ).filter(_reprint_section=section_filter)
        rr_qs = rr_qs.filter(card_id__in=card_scope.values('id'))

    if from_dt:
        rr_qs = rr_qs.filter(created_at__gte=from_dt)
    if to_dt:
        rr_qs = rr_qs.filter(created_at__lte=to_dt)

    if query:
        rr_qs = rr_qs.filter(
            Q(card__field_data__icontains=query) |
            Q(card__id__icontains=query)
        )

    total = rr_qs.count()
    batch = list(rr_qs[offset:offset + limit + 1])
    has_more = len(batch) > limit
    if has_more:
        batch = batch[:limit]

    items = []
    for idx, rr in enumerate(batch):
        req_by = rr.requested_by
        items.append({
            'rr_id': rr.id,
            'card_id': rr.card_id,
            'sr_no': offset + idx + 1,
            'requested_by_name': (req_by.get_full_name() or req_by.username) if req_by else 'System',
            'requested_at': localtime(rr.created_at).strftime('%d-%b-%Y %H:%M'),
            'ordered_fields': _build_ordered_fields(rr.card, table),
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
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_reject(request, table_id):
    """Reject (delete) reprint requests in 'requested' or 'confirmed' status.
    Body: { "rr_ids": [1, 2, 3] }
    """
    admin_err = _require_admin_role(request.user)
    if admin_err:
        return admin_err
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err:
        return err

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    rr_ids = body.get('rr_ids', [])

    result = ReprintWorkflowService.reject_requests(table=table, rr_ids=rr_ids)

    if result.success:
        return JsonResponse({
            'status': 'ok',
            'message': result.message,
            'rejected_count': result.data['rejected_count'],
            'rejected_ids': result.data.get('rejected_ids', []),
        })
    return JsonResponse({'status': 'error', 'message': result.message}, status=400)


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_confirmed_list(request, table_id):
    """List confirmed reprint requests (status='confirmed')."""
    from django.db.models.functions import Cast
    from django.db.models import CharField
    from django.db.models.fields.json import KeyTextTransform

    table, err = _check_reprint_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    class_filter = request.GET.get('class', '').strip()
    section_filter = request.GET.get('section', '').strip()
    try:
        offset = int(request.GET.get('offset', 0))
        limit = int(request.GET.get('limit', 100))
    except (ValueError, TypeError):
        offset, limit = 0, 100

    rr_qs = ReprintRequest.objects.filter(
        table=table,
        status='confirmed',
        card__status='download',
    ).select_related('card', 'requested_by').order_by('-updated_at')

    from_dt = _parse_local_datetime_filter(request.GET.get('from'))
    to_dt = _parse_local_datetime_filter(request.GET.get('to'))

    class_field_name, section_field_name = _get_class_section_field_names(table)
    if class_filter or section_filter:
        card_scope = IDCard.objects.filter(table=table, status='download')
        if class_filter and class_field_name:
            card_scope = _build_class_filter_q(card_scope, class_filter, class_field_name)
        if section_filter and section_field_name:
            card_scope = card_scope.annotate(
                _reprint_section=Cast(KeyTextTransform(section_field_name, 'field_data'), CharField()),
            ).filter(_reprint_section=section_filter)
        rr_qs = rr_qs.filter(card_id__in=card_scope.values('id'))

    if from_dt:
        rr_qs = rr_qs.filter(updated_at__gte=from_dt)
    if to_dt:
        rr_qs = rr_qs.filter(updated_at__lte=to_dt)

    if query:
        rr_qs = rr_qs.filter(
            Q(card__field_data__icontains=query) |
            Q(card__id__icontains=query)
        )

    total = rr_qs.count()
    batch = list(rr_qs[offset:offset + limit + 1])
    has_more = len(batch) > limit
    if has_more:
        batch = batch[:limit]

    items = []
    for idx, rr in enumerate(batch):
        req_by = rr.requested_by
        items.append({
            'rr_id': rr.id,
            'card_id': rr.card_id,
            'sr_no': offset + idx + 1,
            'requested_by_name': (req_by.get_full_name() or req_by.username) if req_by else 'System',
            'confirmed_at': localtime(rr.updated_at).strftime('%d-%b-%Y %H:%M'),
            'ordered_fields': _build_ordered_fields(rr.card, table),
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
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_mark_downloaded(request, table_id):
    """Mark confirmed reprints as downloaded: confirmed → downloaded.
    Body: { "rr_ids": [1, 2, 3] }
    """
    admin_err = _require_admin_role(request.user)
    if admin_err:
        return admin_err
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err:
        return err

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    rr_ids = body.get('rr_ids', [])
    if not rr_ids:
        return JsonResponse({'status': 'error', 'message': 'No reprint IDs provided'}, status=400)

    result = ReprintWorkflowService.bulk_transition(table, rr_ids, 'downloaded', user=request.user)

    if result.success:
        return JsonResponse({
            'status': 'ok',
            'message': result.message,
            'downloaded_count': result.data.get('updated_count', 0),
        })
    return JsonResponse({'status': 'error', 'message': result.message}, status=400)


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_download_list(request, table_id):
    """List downloaded reprint requests (status='downloaded')."""
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    try:
        offset = int(request.GET.get('offset', 0))
        limit = int(request.GET.get('limit', 100))
    except (ValueError, TypeError):
        offset, limit = 0, 100

    rr_qs = ReprintRequest.objects.filter(
        table=table, status='downloaded',
    ).select_related('card', 'requested_by').order_by('-updated_at')

    if query:
        rr_qs = rr_qs.filter(
            Q(card__field_data__icontains=query) |
            Q(reason__icontains=query) |
            Q(card__id__icontains=query)
        )

    total = rr_qs.count()
    batch = list(rr_qs[offset:offset + limit + 1])
    has_more = len(batch) > limit
    if has_more:
        batch = batch[:limit]

    items = []
    for idx, rr in enumerate(batch):
        req_by = rr.requested_by
        items.append({
            'rr_id': rr.id,
            'card_id': rr.card_id,
            'sr_no': offset + idx + 1,
            'status': rr.card.status,
            'status_display': rr.card.get_status_display(),
            'reason': rr.reason,
            'requested_by_name': (req_by.get_full_name() or req_by.username) if req_by else 'System',
            'downloaded_at': localtime(rr.updated_at).strftime('%d-%b-%Y %H:%M'),
            'ordered_fields': _build_ordered_fields(rr.card, table),
        })

    return JsonResponse({
        'status': 'ok',
        'items': items,
        'total': total,
        'has_more': has_more,
        'offset': offset,
        'limit': limit,
    })


# ---------------------------------------------------------------------------
# SEND TO PRINT (confirmed → cardprint print list)
# ---------------------------------------------------------------------------

@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_send_to_print(request, table_id):
    """Send requested reprint items to the cardprint Print List.

    Body: { "rr_ids": [1, 2, 3] }
    Extracts card IDs from requested reprint requests and creates
    PrintRequest entries in the cardprint app.
    """
    admin_err = _require_admin_role(request.user)
    if admin_err:
        return admin_err
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    rr_ids = data.get('rr_ids', [])
    if not rr_ids:
        return JsonResponse({'status': 'error', 'message': 'No items selected'}, status=400)

    # Only allow requested reprint requests
    requested_qs = ReprintRequest.objects.filter(
        id__in=rr_ids,
        table=table,
        status='requested',
        card__status='download',
    )

    eligible_rr_ids = list(requested_qs.values_list('id', flat=True))
    requested_rrs = requested_qs.values_list('card_id', flat=True)

    card_ids = list(requested_rrs)
    if not card_ids:
        return JsonResponse(
            {'status': 'error', 'message': 'No requested reprint items found'},
            status=400,
        )

    # Import PrintWorkflowService to create print requests
    from cardprint.services import PrintWorkflowService

    result = PrintWorkflowService.create_requests(table, card_ids, request.user)

    if not result.success:
        return JsonResponse({'status': 'error', 'message': result.message}, status=400)

    # Always move eligible rows from requested -> confirmed, even when
    # print rows were skipped because they already existed in print_list.
    moved_count = ReprintRequest.objects.filter(
        id__in=eligible_rr_ids,
        table=table,
        status='requested',
        card__status='download',
    ).update(status='confirmed')

    return JsonResponse({
        'status': 'ok',
        'message': f"{moved_count} request(s) moved to Confirmed List"
                   + (f" ({result.data['created']} added to print list" + (f", {result.data['skipped']} already in print list" if result.data['skipped'] else '') + ")" if (result.data['created'] or result.data['skipped']) else ''),
        'created': result.data['created'],
        'skipped': result.data['skipped'],
        'moved': moved_count,
        'moved_ids': eligible_rr_ids,
    })
