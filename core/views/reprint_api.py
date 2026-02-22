"""
Reprint API Views
Contains: API endpoints for the Reprint Cards workflow.

ARCHITECTURE RULES (enforced):
- Views are ULTRA-THIN: parse request → call service → return JsonResponse.
- NO .save(), .create(), .delete() on ReprintRequest in views.
- All mutations delegate to ReprintWorkflowService.
- Permission enforcement via @api_require_permission decorators.
- Client scoping via _check_reprint_table_scope.
"""
import json

from django.shortcuts import get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.db.models import Q
from django.utils.timezone import localtime

from ..models import IDCard, IDCardTable, ReprintRequest
from ..services.permission_service import (
    PermissionService,
    api_require_permission,
)


def _reprint_access_denied():
    """Factory: return a fresh 403 JsonResponse per request (thread-safe)."""
    return JsonResponse(
        {'status': 'error', 'message': 'Access denied. You are not assigned to this client.'},
        status=403,
    )

def _check_reprint_table_scope(user, table_id):
    """Check user has access to the client owning this table. Returns (table, error_response).
    
    Enforces:
    - super_admin: unrestricted
    - admin_staff: must be assigned to the client
    - client / client_staff: must own the table (same client)
    """
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


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_list_cards(request, table_id):
    """
    List all cards in the table for step 1 (Reprint Requests).
    Supports search query and pagination.
    Marks cards that already have an active reprint request.
    """
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err: return err
    query = request.GET.get('q', '').strip()
    cursor = request.GET.get('cursor', '').strip()
    try:
        offset = int(request.GET.get('offset', 0))
        limit = int(request.GET.get('limit', 100))
    except (ValueError, TypeError):
        offset, limit = 0, 100

    cards_qs = IDCard.objects.filter(table=table).defer('photo').order_by('-id')

    # Text search across field_data JSON
    if query:
        cards_qs = cards_qs.filter(
            Q(field_data__icontains=query) |
            Q(id__icontains=query)
        )

    total_count = cards_qs.count()

    # Cursor-based pagination (preferred) or offset (legacy)
    if cursor:
        try:
            cursor_id = int(cursor)
            cards = list(cards_qs.filter(id__lt=cursor_id)[:limit + 1])
        except (ValueError, TypeError):
            cards = list(cards_qs[offset:offset + limit + 1])
    else:
        cards = list(cards_qs[offset:offset + limit + 1])
    has_more = len(cards) > limit
    if has_more:
        cards = cards[:limit]
    next_cursor = cards[-1].id if cards and has_more else None

    # Get IDs of cards that already have a non-downloaded reprint request
    existing_reprint_ids = set(
        ReprintRequest.objects.filter(
            table=table,
            status__in=['requested', 'confirmed'],
        ).values_list('card_id', flat=True)
    )

    card_list = []
    for idx, card in enumerate(cards):
        # Build ordered fields from table config
        ordered_fields = []
        field_data = card.field_data or {}
        fd_upper = {k.upper(): v for k, v in field_data.items()}

        for field in table.fields:
            fname = field['name']
            ftype = field.get('type', 'text')
            fval = field_data.get(fname, '') or fd_upper.get(fname.upper(), '')
            ordered_fields.append({
                'name': fname,
                'type': ftype,
                'value': fval,
            })

        card_list.append({
            'id': card.id,
            'sr_no': offset + idx + 1,
            'status': card.status,
            'status_display': card.get_status_display(),
            'has_reprint': card.id in existing_reprint_ids,
            'ordered_fields': ordered_fields,
            'updated_at': localtime(card.updated_at).strftime('%d-%b-%Y %H:%M'),
        })

    return JsonResponse({
        'status': 'success',
        'cards': card_list,
        'total': total_count,
        'total_count': total_count,
        'offset': offset,
        'limit': limit,
        'has_more': has_more,
        'next_cursor': next_cursor,
    })


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_request_create(request, table_id):
    """
    Create reprint requests for one or more card IDs.
    Body: { "card_ids": [1, 2, 3], "reason": "optional reason" }
    Skips cards that already have a pending reprint request.
    """
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err: return err

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    card_ids = body.get('card_ids', [])
    reason = body.get('reason', '')

    from ..services.workflow_service import ReprintWorkflowService
    result = ReprintWorkflowService.create_requests(
        table=table,
        card_ids=card_ids,
        reason=reason,
        requested_by=request.user,
    )

    if result.success:
        return JsonResponse({
            'status': 'success',
            'message': result.message,
            'created_count': result.data['created_count'],
            'skipped_count': result.data['skipped_count'],
        })
    return JsonResponse({'status': 'error', 'message': result.message}, status=400)


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_step_counts(request, table_id):
    """Return counts for each reprint workflow step."""
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err: return err

    # Single aggregate query instead of 3 separate .count() round-trips
    from django.db.models import Count
    agg = ReprintRequest.objects.filter(table=table).aggregate(
        requested=Count('id', filter=Q(status='requested')),
        confirmed=Count('id', filter=Q(status='confirmed')),
        downloaded=Count('id', filter=Q(status='downloaded')),
    )
    counts = {
        'requested': agg['requested'],
        'confirmed': agg['confirmed'],
        'downloaded': agg['downloaded'],
    }

    return JsonResponse({'status': 'success', 'counts': counts})


# ─── Confirm step APIs ─────────────────────────────────────────────

@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_confirm_list(request, table_id):
    """
    List reprint requests with status='requested' for the confirm step.
    Supports search and pagination.
    """
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err: return err
    query = request.GET.get('q', '').strip()
    cursor = request.GET.get('cursor', '').strip()
    try:
        offset = int(request.GET.get('offset', 0))
        limit = int(request.GET.get('limit', 100))
    except (ValueError, TypeError):
        offset, limit = 0, 100

    rr_qs = ReprintRequest.objects.filter(
        table=table, status='requested'
    ).select_related('card', 'requested_by').order_by('-created_at')

    # Text search across card field_data or reason
    if query:
        rr_qs = rr_qs.filter(
            Q(card__field_data__icontains=query) |
            Q(reason__icontains=query) |
            Q(card__id__icontains=query)
        )

    total_count = rr_qs.count()

    # Cursor-based pagination (preferred) or offset (legacy)
    if cursor:
        try:
            cursor_id = int(cursor)
            rr_batch = list(rr_qs.filter(id__lt=cursor_id)[:limit + 1])
        except (ValueError, TypeError):
            rr_batch = list(rr_qs[offset:offset + limit + 1])
    else:
        rr_batch = list(rr_qs[offset:offset + limit + 1])
    has_more = len(rr_batch) > limit
    if has_more:
        rr_batch = rr_batch[:limit]
    next_cursor = rr_batch[-1].id if rr_batch and has_more else None

    items = []
    for idx, rr in enumerate(rr_batch):
        card = rr.card
        fd = card.field_data or {}
        fd_upper = {k.upper(): v for k, v in fd.items()}
        ordered_fields = []
        for field in table.fields:
            fname = field['name']
            ftype = field.get('type', 'text')
            fval = fd.get(fname, '') or fd_upper.get(fname.upper(), '')
            ordered_fields.append({'name': fname, 'type': ftype, 'value': fval})

        req_by = rr.requested_by
        items.append({
            'rr_id': rr.id,
            'card_id': card.id,
            'sr_no': offset + idx + 1,
            'status': card.status,
            'status_display': card.get_status_display(),
            'reason': rr.reason,
            'requested_by_name': (req_by.get_full_name() or req_by.username) if req_by else 'System',
            'requested_at': localtime(rr.created_at).strftime('%d-%b-%Y %H:%M'),
            'ordered_fields': ordered_fields,
            'updated_at': localtime(card.updated_at).strftime('%d-%b-%Y %H:%M'),
        })

    return JsonResponse({
        'status': 'success',
        'items': items,
        'total': total_count,
        'offset': offset,
        'limit': limit,
        'has_more': offset + limit < total_count,
    })


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_confirm(request, table_id):
    """
    Confirm one or more reprint requests.
    Body: { "rr_ids": [1, 2, 3] }
    Delegates to ReprintWorkflowService: requested → confirmed.
    """
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err: return err

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    rr_ids = body.get('rr_ids', [])
    if not rr_ids:
        return JsonResponse({'status': 'error', 'message': 'No reprint IDs provided'}, status=400)

    from ..services.workflow_service import ReprintWorkflowService
    result = ReprintWorkflowService.bulk_transition(table, rr_ids, 'confirmed', user=request.user)

    if result.success:
        return JsonResponse({
            'status': 'success',
            'message': result.message,
            'confirmed_count': result.data.get('updated_count', 0),
        })
    return JsonResponse({'status': 'error', 'message': result.message}, status=400)


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_reject(request, table_id):
    """
    Reject (delete) one or more reprint requests.
    Body: { "rr_ids": [1, 2, 3] }
    Removes the ReprintRequest records so the card can be re-requested later.
    """
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err: return err

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    rr_ids = body.get('rr_ids', [])

    from ..services.workflow_service import ReprintWorkflowService
    result = ReprintWorkflowService.reject_requests(table=table, rr_ids=rr_ids)

    if result.success:
        return JsonResponse({
            'status': 'success',
            'message': result.message,
            'rejected_count': result.data['rejected_count'],
        })
    return JsonResponse({'status': 'error', 'message': result.message}, status=400)


# ─── Download step APIs ────────────────────────────────────────────

@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_download_list(request, table_id):
    """
    List reprint requests with status='confirmed' for the download step.
    Supports search and pagination.
    """
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err:
        return err
    query = request.GET.get('q', '').strip()
    cursor = request.GET.get('cursor', '').strip()
    try:
        offset = int(request.GET.get('offset', 0))
        limit = int(request.GET.get('limit', 100))
    except (ValueError, TypeError):
        offset, limit = 0, 100

    rr_qs = ReprintRequest.objects.filter(
        table=table, status='confirmed'
    ).select_related('card', 'requested_by').order_by('-updated_at')

    if query:
        rr_qs = rr_qs.filter(
            Q(card__field_data__icontains=query) |
            Q(reason__icontains=query) |
            Q(card__id__icontains=query)
        )

    total_count = rr_qs.count()

    # Cursor-based pagination (preferred) or offset (legacy)
    if cursor:
        try:
            cursor_id = int(cursor)
            rr_batch = list(rr_qs.filter(id__lt=cursor_id)[:limit + 1])
        except (ValueError, TypeError):
            rr_batch = list(rr_qs[offset:offset + limit + 1])
    else:
        rr_batch = list(rr_qs[offset:offset + limit + 1])
    has_more = len(rr_batch) > limit
    if has_more:
        rr_batch = rr_batch[:limit]
    next_cursor = rr_batch[-1].id if rr_batch and has_more else None

    items = []
    for idx, rr in enumerate(rr_batch):
        card = rr.card
        fd = card.field_data or {}
        fd_upper = {k.upper(): v for k, v in fd.items()}
        ordered_fields = []
        for field in table.fields:
            fname = field['name']
            ftype = field.get('type', 'text')
            fval = fd.get(fname, '') or fd_upper.get(fname.upper(), '')
            ordered_fields.append({'name': fname, 'type': ftype, 'value': fval})

        req_by = rr.requested_by
        items.append({
            'rr_id': rr.id,
            'card_id': card.id,
            'sr_no': offset + idx + 1,
            'status': card.status,
            'status_display': card.get_status_display(),
            'reason': rr.reason,
            'requested_by_name': (req_by.get_full_name() or req_by.username) if req_by else 'System',
            'confirmed_at': localtime(rr.updated_at).strftime('%d-%b-%Y %H:%M'),
            'ordered_fields': ordered_fields,
            'updated_at': localtime(card.updated_at).strftime('%d-%b-%Y %H:%M'),
        })

    return JsonResponse({
        'status': 'success',
        'items': items,
        'total': total_count,
        'offset': offset,
        'limit': limit,
        'has_more': has_more,
        'next_cursor': next_cursor,
    })


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_mark_downloaded(request, table_id):
    """
    Mark one or more confirmed reprint requests as downloaded.
    Body: { "rr_ids": [1, 2, 3] }
    Delegates to ReprintWorkflowService: confirmed → downloaded.
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

    from ..services.workflow_service import ReprintWorkflowService
    result = ReprintWorkflowService.bulk_transition(table, rr_ids, 'downloaded', user=request.user)

    if result.success:
        return JsonResponse({
            'status': 'success',
            'message': result.message,
            'downloaded_count': result.data.get('updated_count', 0),
        })
    return JsonResponse({'status': 'error', 'message': result.message}, status=400)
