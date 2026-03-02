"""
Card Print Views
================
Page views + API endpoints for the 3-step Print Cards workflow:
  Print List → Finalized → Pool

ARCHITECTURE RULES (same as reprint):
- Views are ULTRA-THIN: parse request → call service → return JsonResponse.
- All mutations delegate to PrintWorkflowService.
"""
import json
import logging

from django.shortcuts import get_object_or_404, redirect, render
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.db.models import Count, Q
from django.utils.timezone import localtime

from idcards.models import IDCard, IDCardTable
from core.services.permission_service import PermissionService, api_require_permission
from core.views.base import get_user_role, require_any_admin

from .models import PrintRequest
from .services import PrintWorkflowService

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def _print_access_denied():
    return JsonResponse(
        {'status': 'error', 'message': 'Access denied. You are not assigned to this client.'},
        status=403,
    )


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


# ---------------------------------------------------------------------------
# PAGE VIEW
# ---------------------------------------------------------------------------

@login_required
@require_any_admin
def print_cards(request, table_id):
    """Print Cards page — 3-step workflow: Print List → Finalized → Pool."""
    table = get_object_or_404(
        IDCardTable.objects.select_related('group__client'), id=table_id,
    )
    user = request.user
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('active_clients')
    if not PermissionService.has_permission(user, 'perm_print_list'):
        return redirect('active_clients')

    current_step = request.GET.get('step', 'print_list')
    if current_step not in ('print_list', 'finalized', 'pool'):
        current_step = 'print_list'

    # Step counts (single aggregate query)
    step_counts_raw = PrintRequest.objects.filter(table=table).aggregate(
        pl=Count('id', filter=Q(status='print_list')),
        fn=Count('id', filter=Q(status='finalized')),
        po=Count('id', filter=Q(status='pool')),
    )
    step_counts = {
        'print_list': step_counts_raw['pl'],
        'finalized': step_counts_raw['fn'],
        'pool': step_counts_raw['po'],
    }

    INITIAL_LOAD_LIMIT = 100

    def _build_items(status_filter, date_field_name, order_field):
        """Helper to build item dicts for a given status."""
        qs = PrintRequest.objects.filter(
            table=table, status=status_filter,
        ).select_related('card', 'requested_by').order_by(order_field)
        total = qs.count()
        batch = qs[:INITIAL_LOAD_LIMIT]
        items = []
        for idx, pr in enumerate(batch):
            card = pr.card
            fd = card.field_data or {}
            fd_upper = {k.upper(): v for k, v in fd.items()}
            ordered_fields = _build_ordered_fields(table, fd, fd_upper)
            req_by = pr.requested_by
            item = {
                'pr_id': pr.id,
                'card_id': card.id,
                'sr_no': idx + 1,
                'status': card.status,
                'status_display': card.get_status_display(),
                'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
                'ordered_fields': ordered_fields,
                'updated_at': card.updated_at,
            }
            item[date_field_name] = pr.updated_at if date_field_name != 'requested_at' else pr.created_at
            items.append(item)
        return items, total

    # Build items for the current step only
    print_items, print_total = ([], 0)
    finalized_items, finalized_total = ([], 0)
    pool_items, pool_total = ([], 0)

    if current_step == 'print_list':
        print_items, print_total = _build_items('print_list', 'requested_at', '-created_at')
    elif current_step == 'finalized':
        finalized_items, finalized_total = _build_items('finalized', 'finalized_at', '-updated_at')
    elif current_step == 'pool':
        pool_items, pool_total = _build_items('pool', 'pool_at', '-updated_at')

    context = {
        'active_page': 'active_clients',
        'user_role': get_user_role(request.user),
        'table': table,
        'group': table.group,
        'client': table.group.client,
        'current_step': current_step,
        'step_counts': step_counts,
        'print_items': print_items,
        'print_total': print_total,
        'print_has_more': print_total > INITIAL_LOAD_LIMIT,
        'finalized_items': finalized_items,
        'finalized_total': finalized_total,
        'finalized_has_more': finalized_total > INITIAL_LOAD_LIMIT,
        'pool_items': pool_items,
        'pool_total': pool_total,
        'pool_has_more': pool_total > INITIAL_LOAD_LIMIT,
        'initial_load_limit': INITIAL_LOAD_LIMIT,
    }
    return render(request, 'cardprint/print-cards.html', context)


# ---------------------------------------------------------------------------
# API VIEWS
# ---------------------------------------------------------------------------

@require_http_methods(["POST"])
@login_required
def api_print_send(request, table_id):
    """Send approved cards to the print list.

    Body: { "card_ids": [1, 2, 3] }
    Only cards in 'approved' status are accepted.
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

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

    # Move approved cards → download status so they leave the approve list
    if result['created'] > 0:
        IDCard.objects.filter(
            id__in=valid_ids,
            table=table,
            status='approved',
        ).update(status='download')

    return JsonResponse({
        'status': 'ok',
        'message': f"{result['created']} card(s) sent to print list"
                   + (f" ({result['skipped']} already in list)" if result['skipped'] else ''),
        'created': result['created'],
        'skipped': result['skipped'],
    })


@require_http_methods(["GET"])
@login_required
def api_print_list(request, table_id):
    """List print_list items with pagination and search."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    try:
        offset = int(request.GET.get('offset', 0))
        limit = int(request.GET.get('limit', 100))
    except (ValueError, TypeError):
        offset, limit = 0, 100

    pr_qs = PrintRequest.objects.filter(
        table=table, status='print_list',
    ).select_related('card', 'requested_by').order_by('-created_at')

    if query:
        search_q = Q(card__field_data__icontains=query)
        if query.isdigit():
            search_q |= Q(card__id=int(query))
        pr_qs = pr_qs.filter(search_q)

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
            'requested_at': localtime(pr.created_at).strftime('%d %b %Y %H:%M'),
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


@require_http_methods(["GET"])
@login_required
def api_print_step_counts(request, table_id):
    """Return step counts for the print workflow tabs."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    counts = PrintRequest.objects.filter(table=table).aggregate(
        pl=Count('id', filter=Q(status='print_list')),
        fn=Count('id', filter=Q(status='finalized')),
        po=Count('id', filter=Q(status='pool')),
    )
    return JsonResponse({
        'status': 'ok',
        'print_list': counts['pl'],
        'finalized': counts['fn'],
        'pool': counts['po'],
    })


@require_http_methods(["POST"])
@login_required
def api_print_remove(request, table_id):
    """Remove items from the print list.

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
            id__in=request_ids, table=table, status='print_list',
        ).values_list('id', flat=True)
    )

    result = PrintWorkflowService.delete_requests(valid_ids, request.user)
    return JsonResponse({
        'status': 'ok',
        'message': f"{result['deleted']} item(s) removed from print list",
        'deleted': result['deleted'],
        'skipped': result['skipped'],
    })



# ---------------------------------------------------------------------------
# 3-STEP API VIEWS: Generate, Finalized List, Mark Pool, Pool List
# ---------------------------------------------------------------------------

@require_http_methods(["POST"])
@login_required
def api_print_generate(request, table_id):
    """Generate (print_list → finalized) for selected items.

    In future this will trigger a background task (e.g. PDF generation).
    For now it transitions directly.

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
            id__in=request_ids, table=table, status='print_list',
        ).values_list('id', flat=True)
    )
    if not valid_ids:
        return JsonResponse(
            {'status': 'error', 'message': 'No valid print list items found'},
            status=400,
        )

    result = PrintWorkflowService.bulk_generate(valid_ids, request.user)
    return JsonResponse({
        'status': 'ok',
        'message': f"{result['updated']} item(s) generated successfully",
        'updated': result['updated'],
        'skipped': result['skipped'],
    })


@require_http_methods(["GET"])
@login_required
def api_print_finalized_list(request, table_id):
    """List finalized print items with pagination and search."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    try:
        offset = int(request.GET.get('offset', 0))
        limit = int(request.GET.get('limit', 100))
    except (ValueError, TypeError):
        offset, limit = 0, 100

    pr_qs = PrintRequest.objects.filter(
        table=table, status='finalized',
    ).select_related('card', 'requested_by').order_by('-updated_at')

    if query:
        search_q = Q(card__field_data__icontains=query)
        if query.isdigit():
            search_q |= Q(card__id=int(query))
        pr_qs = pr_qs.filter(search_q)

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
    return JsonResponse({
        'status': 'ok',
        'message': f"{result['updated']} item(s) moved to pool",
        'updated': result['updated'],
        'skipped': result['skipped'],
    })


@require_http_methods(["GET"])
@login_required
def api_print_pool_list(request, table_id):
    """List pool items with pagination and search."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    try:
        offset = int(request.GET.get('offset', 0))
        limit = int(request.GET.get('limit', 100))
    except (ValueError, TypeError):
        offset, limit = 0, 100

    pr_qs = PrintRequest.objects.filter(
        table=table, status='pool',
    ).select_related('card', 'requested_by').order_by('-updated_at')

    if query:
        search_q = Q(card__field_data__icontains=query)
        if query.isdigit():
            search_q |= Q(card__id=int(query))
        pr_qs = pr_qs.filter(search_q)

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
