"""
Reprint API Views
Contains: API endpoints for the Reprint Cards workflow
"""
import json

from django.shortcuts import get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Q

from ..models import IDCard, IDCardTable, ReprintRequest
from ..services.permission_service import (
    PermissionService,
    api_require_permission,
)


_REPRINT_ACCESS_DENIED = JsonResponse(
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
                return None, _REPRINT_ACCESS_DENIED
        elif user.role in ('client', 'client_staff'):
            from client.services import ClientAccessService
            if not ClientAccessService.can_access_table(user, table):
                return None, _REPRINT_ACCESS_DENIED
    return table, None


@csrf_exempt
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
    offset = int(request.GET.get('offset', 0))
    limit = int(request.GET.get('limit', 100))

    cards_qs = IDCard.objects.filter(table=table).order_by('-id')

    # Text search across field_data JSON
    if query:
        cards_qs = cards_qs.filter(
            Q(field_data__icontains=query) |
            Q(id__icontains=query)
        )

    total_count = cards_qs.count()
    cards = cards_qs[offset:offset + limit]

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
            'updated_at': card.updated_at.strftime('%d-%b-%Y %I:%M %p'),
        })

    return JsonResponse({
        'status': 'success',
        'cards': card_list,
        'total': total_count,
        'total_count': total_count,
        'offset': offset,
        'limit': limit,
        'has_more': offset + limit < total_count,
    })


@csrf_exempt
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

    if not card_ids:
        return JsonResponse({'status': 'error', 'message': 'No card IDs provided'}, status=400)

    # Validate cards belong to this table
    valid_cards = IDCard.objects.filter(table=table, id__in=card_ids)
    valid_ids = set(valid_cards.values_list('id', flat=True))

    # Skip cards that already have a pending/confirmed reprint
    already_requested = set(
        ReprintRequest.objects.filter(
            table=table,
            card_id__in=valid_ids,
            status__in=['requested', 'confirmed'],
        ).values_list('card_id', flat=True)
    )

    new_ids = valid_ids - already_requested
    created_count = 0

    for card_id in new_ids:
        ReprintRequest.objects.create(
            card_id=card_id,
            table=table,
            status='requested',
            reason=reason,
            requested_by=request.user,
        )
        created_count += 1

    return JsonResponse({
        'status': 'success',
        'message': f'{created_count} reprint request(s) created',
        'created_count': created_count,
        'skipped_count': len(already_requested & set(card_ids)),
    })


@csrf_exempt
@require_http_methods(["GET"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_step_counts(request, table_id):
    """Return counts for each reprint workflow step."""
    table, err = _check_reprint_table_scope(request.user, table_id)
    if err: return err

    counts = {
        'requested': ReprintRequest.objects.filter(table=table, status='requested').count(),
        'confirmed': ReprintRequest.objects.filter(table=table, status='confirmed').count(),
        'downloaded': ReprintRequest.objects.filter(table=table, status='downloaded').count(),
    }

    return JsonResponse({'status': 'success', 'counts': counts})


# ─── Confirm step APIs ─────────────────────────────────────────────

@csrf_exempt
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
    offset = int(request.GET.get('offset', 0))
    limit = int(request.GET.get('limit', 100))

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
    rr_batch = rr_qs[offset:offset + limit]

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
            'requested_at': rr.created_at.strftime('%d-%b-%Y %I:%M %p'),
            'ordered_fields': ordered_fields,
            'updated_at': card.updated_at.strftime('%d-%b-%Y %I:%M %p'),
        })

    return JsonResponse({
        'status': 'success',
        'items': items,
        'total': total_count,
        'offset': offset,
        'limit': limit,
        'has_more': offset + limit < total_count,
    })


@csrf_exempt
@require_http_methods(["POST"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_confirm(request, table_id):
    """
    Confirm one or more reprint requests.
    Body: { "rr_ids": [1, 2, 3] }
    Changes status from 'requested' → 'confirmed'.
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

    updated = ReprintRequest.objects.filter(
        id__in=rr_ids, table=table, status='requested'
    ).update(status='confirmed')

    return JsonResponse({
        'status': 'success',
        'message': f'{updated} reprint(s) confirmed',
        'confirmed_count': updated,
    })


@csrf_exempt
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
    if not rr_ids:
        return JsonResponse({'status': 'error', 'message': 'No reprint IDs provided'}, status=400)

    deleted, _ = ReprintRequest.objects.filter(
        id__in=rr_ids, table=table, status='requested'
    ).delete()

    return JsonResponse({
        'status': 'success',
        'message': f'{deleted} reprint(s) rejected',
        'rejected_count': deleted,
    })


# ─── Download step APIs ────────────────────────────────────────────

@csrf_exempt
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
    offset = int(request.GET.get('offset', 0))
    limit = int(request.GET.get('limit', 100))

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
    rr_batch = rr_qs[offset:offset + limit]

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
            'confirmed_at': rr.updated_at.strftime('%d-%b-%Y %I:%M %p'),
            'ordered_fields': ordered_fields,
            'updated_at': card.updated_at.strftime('%d-%b-%Y %I:%M %p'),
        })

    return JsonResponse({
        'status': 'success',
        'items': items,
        'total': total_count,
        'offset': offset,
        'limit': limit,
        'has_more': offset + limit < total_count,
    })


@csrf_exempt
@require_http_methods(["POST"])
@api_require_permission('perm_idcard_reprint_list')
def api_reprint_mark_downloaded(request, table_id):
    """
    Mark one or more confirmed reprint requests as downloaded.
    Body: { "rr_ids": [1, 2, 3] }
    Changes status from 'confirmed' → 'downloaded'.
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

    updated = ReprintRequest.objects.filter(
        id__in=rr_ids, table=table, status='confirmed'
    ).update(status='downloaded')

    return JsonResponse({
        'status': 'success',
        'message': f'{updated} reprint(s) marked as downloaded',
        'downloaded_count': updated,
    })
