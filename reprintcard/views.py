"""
Reprint Card Views
==================
Page views + API endpoints for the 4-step Reprint Cards workflow:
  Reprint List → Confirmed List → Download → Pool

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

from workflows.models import IDCard, IDCardTable
from core.services.permission_service import PermissionService, api_require_permission
from core.views.base import get_user_role, require_any_admin

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


# ---------------------------------------------------------------------------
# PAGE VIEW
# ---------------------------------------------------------------------------

@login_required
@require_any_admin
def reprint_cards(request, table_id):
    """Reprint Cards page — 4-step workflow: Reprint List → Confirmed → Download → Pool."""
    table = get_object_or_404(
        IDCardTable.objects.select_related('group__client'), id=table_id,
    )
    user = request.user
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('active_clients')
    if not PermissionService.has_permission(user, 'perm_idcard_reprint_list'):
        return redirect('active_clients')

    current_step = request.GET.get('step', 'reprint_list')
    if current_step not in ('reprint_list', 'confirmed', 'download', 'pool'):
        current_step = 'reprint_list'

    # Step counts (single aggregate query)
    step_counts_raw = ReprintRequest.objects.filter(table=table).aggregate(
        rl=Count('id', filter=Q(status='requested')),
        cl=Count('id', filter=Q(status='confirmed')),
        dl=Count('id', filter=Q(status='downloaded')),
        pl=Count('id', filter=Q(status='pool')),
    )
    step_counts = {
        'reprint_list': step_counts_raw['rl'],
        'confirmed': step_counts_raw['cl'],
        'download': step_counts_raw['dl'],
        'pool': step_counts_raw['pl'],
    }

    INITIAL_LOAD_LIMIT = 100

    # Reprint List — shows reprint requests with status='requested'
    reprint_items = []
    reprint_total = 0
    if current_step == 'reprint_list':
        rr_qs = ReprintRequest.objects.filter(
            table=table, status='requested',
        ).select_related('card', 'requested_by').order_by('-created_at')
        reprint_total = rr_qs.count()
        rr_batch = rr_qs[:INITIAL_LOAD_LIMIT]
        for idx, rr in enumerate(rr_batch):
            req_by = rr.requested_by
            reprint_items.append({
                'rr_id': rr.id,
                'card_id': rr.card_id,
                'sr_no': idx + 1,
                'status': rr.card.status,
                'get_status_display': rr.card.get_status_display(),
                'reason': rr.reason,
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
            table=table, status='confirmed',
        ).select_related('card', 'requested_by').order_by('-updated_at')
        confirmed_total = cf_qs.count()
        cf_batch = cf_qs[:INITIAL_LOAD_LIMIT]
        for idx, rr in enumerate(cf_batch):
            req_by = rr.requested_by
            confirmed_items.append({
                'rr_id': rr.id,
                'card_id': rr.card_id,
                'sr_no': idx + 1,
                'status': rr.card.status,
                'get_status_display': rr.card.get_status_display(),
                'reason': rr.reason,
                'requested_by_name': (req_by.get_full_name() or req_by.username) if req_by else 'System',
                'confirmed_at': rr.updated_at,
                'ordered_fields': _build_ordered_fields(rr.card, table),
                'updated_at': rr.card.updated_at,
            })

    # Download — status='downloaded'
    download_items = []
    download_total = 0
    if current_step == 'download':
        dl_qs = ReprintRequest.objects.filter(
            table=table, status='downloaded',
        ).select_related('card', 'requested_by').order_by('-updated_at')
        download_total = dl_qs.count()
        dl_batch = dl_qs[:INITIAL_LOAD_LIMIT]
        for idx, rr in enumerate(dl_batch):
            req_by = rr.requested_by
            download_items.append({
                'rr_id': rr.id,
                'card_id': rr.card_id,
                'sr_no': idx + 1,
                'status': rr.card.status,
                'get_status_display': rr.card.get_status_display(),
                'reason': rr.reason,
                'requested_by_name': (req_by.get_full_name() or req_by.username) if req_by else 'System',
                'downloaded_at': rr.updated_at,
                'ordered_fields': _build_ordered_fields(rr.card, table),
                'updated_at': rr.card.updated_at,
            })

    # Pool — status='pool'
    pool_items = []
    pool_total = 0
    if current_step == 'pool':
        pl_qs = ReprintRequest.objects.filter(
            table=table, status='pool',
        ).select_related('card', 'requested_by').order_by('-updated_at')
        pool_total = pl_qs.count()
        pl_batch = pl_qs[:INITIAL_LOAD_LIMIT]
        for idx, rr in enumerate(pl_batch):
            req_by = rr.requested_by
            pool_items.append({
                'rr_id': rr.id,
                'card_id': rr.card_id,
                'sr_no': idx + 1,
                'status': rr.card.status,
                'get_status_display': rr.card.get_status_display(),
                'reason': rr.reason,
                'requested_by_name': (req_by.get_full_name() or req_by.username) if req_by else 'System',
                'pool_at': rr.updated_at,
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
        'confirmed_items': confirmed_items,
        'confirmed_total': confirmed_total,
        'confirmed_has_more': confirmed_total > INITIAL_LOAD_LIMIT,
        'download_items': download_items,
        'download_total': download_total,
        'download_has_more': download_total > INITIAL_LOAD_LIMIT,
        'pool_items': pool_items,
        'pool_total': pool_total,
        'pool_has_more': pool_total > INITIAL_LOAD_LIMIT,
        'initial_load_limit': INITIAL_LOAD_LIMIT,
    }
    return render(request, 'reprintcard/reprint-cards.html', context)


# ---------------------------------------------------------------------------
# API VIEWS
# ---------------------------------------------------------------------------

@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_step_counts(request, table_id):
    """Return step counts for the 4-step reprint workflow tabs."""
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err:
        return err

    agg = ReprintRequest.objects.filter(table=table).aggregate(
        requested=Count('id', filter=Q(status='requested')),
        confirmed=Count('id', filter=Q(status='confirmed')),
        downloaded=Count('id', filter=Q(status='downloaded')),
        pool=Count('id', filter=Q(status='pool')),
    )
    return JsonResponse({
        'status': 'ok',
        'reprint_list': agg['requested'],
        'confirmed': agg['confirmed'],
        'download': agg['downloaded'],
        'pool': agg['pool'],
    })


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_list(request, table_id):
    """List reprint requests with status='requested' (Reprint List step)."""
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
        table=table, status='requested',
    ).select_related('card', 'requested_by').order_by('-created_at')

    if query:
        search_q = Q(card__field_data__icontains=query) | Q(reason__icontains=query)
        if query.isdigit():
            search_q |= Q(card__id=int(query))
        rr_qs = rr_qs.filter(search_q)

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
def api_reprint_request_create(request, table_id):
    """Create reprint requests for card IDs.
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


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_reject(request, table_id):
    """Reject (delete) reprint requests still in 'requested' status.
    Body: { "rr_ids": [1, 2, 3] }
    """
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
        })
    return JsonResponse({'status': 'error', 'message': result.message}, status=400)


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_confirmed_list(request, table_id):
    """List confirmed reprint requests (status='confirmed')."""
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
        table=table, status='confirmed',
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


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_mark_pool(request, table_id):
    """Move downloaded reprints to pool: downloaded → pool.
    Body: { "rr_ids": [1, 2, 3] }
    """
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

    result = ReprintWorkflowService.bulk_transition(table, rr_ids, 'pool', user=request.user)

    if result.success:
        return JsonResponse({
            'status': 'ok',
            'message': result.message,
            'pool_count': result.data.get('updated_count', 0),
        })
    return JsonResponse({'status': 'error', 'message': result.message}, status=400)


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_pool_list(request, table_id):
    """List pool reprint requests (status='pool')."""
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
        table=table, status='pool',
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
            'pool_at': localtime(rr.updated_at).strftime('%d-%b-%Y %H:%M'),
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
def api_reprint_send_to_print(request, table_id):
    """Send confirmed reprint items to the cardprint Print List.

    Body: { "rr_ids": [1, 2, 3] }
    Extracts card IDs from the confirmed reprint requests and creates
    PrintRequest entries in the cardprint app.
    """
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

    # Only allow confirmed reprint requests
    confirmed_rrs = ReprintRequest.objects.filter(
        id__in=rr_ids,
        table=table,
        status='confirmed',
    ).values_list('card_id', flat=True)

    card_ids = list(confirmed_rrs)
    if not card_ids:
        return JsonResponse(
            {'status': 'error', 'message': 'No confirmed reprint items found'},
            status=400,
        )

    # Import PrintWorkflowService to create print requests
    from cardprint.services import PrintWorkflowService

    result = PrintWorkflowService.create_requests(table, card_ids, request.user)

    # Move the reprint requests from confirmed → downloaded
    if result['created'] > 0:
        ReprintRequest.objects.filter(
            id__in=rr_ids,
            table=table,
            status='confirmed',
        ).update(status='downloaded')

    return JsonResponse({
        'status': 'ok',
        'message': f"{result['created']} card(s) sent to print list"
                   + (f" ({result['skipped']} already in list)" if result['skipped'] else ''),
        'created': result['created'],
        'skipped': result['skipped'],
    })
