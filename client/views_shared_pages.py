"""
Client Views — shared admin-template pages.

Page views that render the same templates used by the admin panel
but scoped to the current client's data and permissions.
"""
from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.db.models import Count, Q
from django.urls import reverse
from django.views.decorators.http import require_http_methods

from idcards.models import IDCard, IDCardTable
from core.services import IDCardService
from core.services.permission_service import PermissionService
from core.utils.htmx import is_htmx

from .views_decorators import require_client_user, require_client_admin, _get_client_for_request
from .services import ClientAccessService


# =============================================================================
# SHARED PAGES — Render admin templates with client context
# =============================================================================

@require_client_user
def client_idcard_group(request):
    """
    ID Card Group page for clients — same template as admin idcard-group.html.
    Auto-detects client from user profile.
    """
    user = request.user
    client = _get_client_for_request(user)
    if not client:
        return redirect(reverse('client:dashboard'))
    
    # Check if user has any list permission (affects what content is shown)
    LIST_PERMISSIONS = [
        'perm_idcard_setting_list', 'perm_idcard_pending_list',
        'perm_idcard_verified_list', 'perm_idcard_approved_list',
        'perm_idcard_download_list', 'perm_idcard_pool_list',
        'perm_idcard_reprint_list',
    ]
    has_any_list_perm = any(PermissionService.has_permission(user, p) for p in LIST_PERMISSIONS)
    
    # Always render the page — show empty if no permissions
    if has_any_list_perm:
        tables_qs = IDCardTable.objects.filter(
            group__client=client,
            deleted_by_client=False,   # hide client-soft-deleted tables
        ).select_related('group', 'group__client')

        # For client_staff with assigned groups: restrict to those groups only
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_group_ids = list(staff.assigned_groups.values_list('id', flat=True))
                if assigned_group_ids:
                    tables_qs = tables_qs.filter(group_id__in=assigned_group_ids)

        tables = tables_qs.annotate(
            pending_count=Count('id_cards', filter=Q(id_cards__status='pending')),
            verified_count=Count('id_cards', filter=Q(id_cards__status='verified')),
            pool_count=Count('id_cards', filter=Q(id_cards__status='pool')),
            approved_count=Count('id_cards', filter=Q(id_cards__status='approved')),
            download_count=Count('id_cards', filter=Q(id_cards__status='download')),
            reprint_count=Count('id_cards', filter=Q(id_cards__status='reprint')),
            total_cards=Count('id_cards')
        ).order_by('-updated_at')
    else:
        tables = IDCardTable.objects.none()

    # Get default group for Create with XLSX button
    group = IDCardService.ensure_default_group(client)
    
    context = {
        'active_page': 'idcard_group',
        'user_role': user.get_role_display(),
        'client': client,
        'group': group,
        'tables': tables,
    }
    return render(request, 'idcard-group.html', context)


@require_client_user
def client_idcard_actions(request, table_id):
    """
    ID Card Actions page for clients — same template as admin idcard-actions.html.
    Uses shared build_idcard_actions_context() helper for queryset + context.
    """
    user = request.user
    client = _get_client_for_request(user)
    if not client:
        return redirect(reverse('client:dashboard'))
    
    # Require at least one list permission to access this page
    LIST_PERMISSIONS = [
        'perm_idcard_pending_list', 'perm_idcard_verified_list',
        'perm_idcard_approved_list', 'perm_idcard_download_list',
        'perm_idcard_pool_list', 'perm_idcard_reprint_list',
    ]
    if not any(PermissionService.has_permission(user, p) for p in LIST_PERMISSIONS):
        return redirect(reverse('client:dashboard'))
    
    table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)
    
    # Verify ownership
    if not ClientAccessService.can_access_table(user, table):
        return redirect(reverse('client:idcard_group'))
    
    status_filter = request.GET.get('status', None)
    if status_filter:
        from core.views.base import _STATUS_LIST_PERM
        required_perm = _STATUS_LIST_PERM.get(status_filter)
        if required_perm and not PermissionService.has_permission(user, required_perm):
            return redirect(reverse('client:idcard_group'))
    
    from core.views.base import build_idcard_actions_context
    context = build_idcard_actions_context(
        request, table,
        default_per_page=50,
        per_page_options=[50, 100, 150, 200],
        active_page='idcard_group',
        user_role=user.get_role_display(),
    )
    
    # Provide the correct base URL for HTMX requests in the template
    # This ensures HTMX calls go to the client endpoint, not the admin one
    context['actions_base_url'] = reverse('client:idcard_actions', args=[table.id])
    
    # HTMX partial response
    if is_htmx(request):
        return render(request, 'partials/idcard/table-container.html', context)
    
    return render(request, 'idcard-actions.html', context)


@require_client_admin
def client_group_settings(request):
    """
    Group Settings page for client admins only — not available to client_staff.
    Same template as admin group-setting.html, scoped to the current client.

    Supports:
    - HTMX partial responses (table-container only)
    - Search by table name
    - Pagination (matching admin defaults: 10 per page)
    - Excludes tables soft-deleted by this client (deleted_by_client=True)
    """
    from django.core.paginator import Paginator
    from core.views.base_helpers import get_page_range

    user = request.user
    client = _get_client_for_request(user)
    if not client:
        return redirect(reverse('client:dashboard'))

    # Always render — show empty if no permissions
    has_perm = PermissionService.has_permission(user, 'perm_idcard_setting_list')

    search_query = request.GET.get('search', '').strip()

    if has_perm:
        group = IDCardService.ensure_default_group(client)
        tables_qs = IDCardTable.objects.filter(
            group=group,
            deleted_by_client=False,   # hide client-soft-deleted tables
        ).annotate(total_cards=Count('id_cards')).order_by('-updated_at')

        if search_query:
            tables_qs = tables_qs.filter(name__icontains=search_query)
    else:
        group = None
        tables_qs = IDCardTable.objects.none()

    DEFAULT_PER_PAGE = 10
    PER_PAGE_OPTIONS = [5, 10, 25, 50]
    try:
        per_page = int(request.GET.get('per_page', DEFAULT_PER_PAGE))
        if per_page not in PER_PAGE_OPTIONS:
            per_page = DEFAULT_PER_PAGE
    except (ValueError, TypeError):
        per_page = DEFAULT_PER_PAGE

    paginator = Paginator(tables_qs, per_page)
    page_obj = paginator.get_page(request.GET.get('page', 1))

    context = {
        'active_page': 'group_settings',
        'user_role': user.get_role_display(),
        'client': client,
        'group': group,
        'tables': page_obj.object_list,
        'page_obj': page_obj,
        'page_range': get_page_range(page_obj),
        'per_page': per_page,
        'per_page_options': PER_PAGE_OPTIONS,
        'search_query': search_query,
    }

    if is_htmx(request):
        return render(request, 'partials/group-setting/table-container.html', context)

    return render(request, 'group-setting.html', context)


@require_client_user
def client_reprint_cards(request, table_id):
    """
    Reprint Cards page for clients — delegates to the reprintcard app's
    page view logic but uses client context & permissions.
    """
    from reprintcard.models import ReprintRequest
    
    user = request.user
    client = _get_client_for_request(user)
    if not client:
        return redirect(reverse('client:dashboard'))
    
    table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)
    
    # Verify ownership
    if not ClientAccessService.can_access_table(user, table):
        return redirect(reverse('client:idcard_group'))
    
    # Check perm_idcard_reprint_list permission
    if not PermissionService.has_permission(user, 'perm_idcard_reprint_list'):
        return redirect(reverse('client:idcard_group'))
    
    current_step = request.GET.get('step', 'reprint_list')
    if current_step not in ('reprint_list', 'request_list', 'confirmed'):
        current_step = 'reprint_list'
    
    # Real step counts
    source_cards_qs = IDCard.objects.filter(table=table, status__in=['approved', 'download'])
    source_cards_count = source_cards_qs.count()
    request_count = ReprintRequest.objects.filter(table=table, status='requested').count()
    confirmed_count = ReprintRequest.objects.filter(table=table, status='confirmed').count()
    step_counts = {
        'reprint_list': source_cards_count,
        'request_list': request_count,
        'confirmed': confirmed_count,
    }
    
    INITIAL_LOAD_LIMIT = 100
    
    from reprintcard.views import _build_ordered_fields

    # Reprint List — source cards limited to Approved + Download
    reprint_items = []
    reprint_total = source_cards_count
    if current_step == 'reprint_list':
        card_qs = source_cards_qs.order_by('-updated_at')
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
            table=table, status='requested',
        ).select_related('card', 'requested_by').order_by('-created_at')
        request_total = req_qs.count()
        req_batch = req_qs[:INITIAL_LOAD_LIMIT]
        for idx, rr in enumerate(req_batch):
            req_by = rr.requested_by
            request_items.append({
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

    context = {
        'active_page': 'idcard_group',
        'user_role': user.get_role_display(),
        'table': table,
        'group': table.group,
        'client': table.group.client,
        'current_step': current_step,
        'step_counts': step_counts,
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


@require_client_user
def client_print_cards(request, table_id):
    """
    Print Cards page for clients — same template as admin cardprint/print-cards.html.
    """
    from cardprint.models import PrintRequest

    user = request.user
    client = _get_client_for_request(user)
    if not client:
        return redirect(reverse('client:dashboard'))

    table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)

    # Verify ownership
    if not ClientAccessService.can_access_table(user, table):
        return redirect(reverse('client:idcard_group'))

    current_step = request.GET.get('step', 'print_list')
    if current_step not in ('print_list', 'download'):
        current_step = 'print_list'

    # Step counts
    from django.db.models import Count as AggCount
    step_counts_raw = PrintRequest.objects.filter(table=table).aggregate(
        pl=AggCount('id', filter=Q(status='print_list')),
        dl=AggCount('id', filter=Q(status='downloaded')),
    )
    step_counts = {
        'print_list': step_counts_raw['pl'],
        'download': step_counts_raw['dl'],
    }

    INITIAL_LOAD_LIMIT = 100

    print_items = []
    print_total = 0
    if current_step == 'print_list':
        pr_qs = PrintRequest.objects.filter(
            table=table, status='print_list',
        ).select_related('card', 'requested_by').order_by('-created_at')
        print_total = pr_qs.count()
        pr_batch = pr_qs[:INITIAL_LOAD_LIMIT]
        for idx, pr in enumerate(pr_batch):
            card = pr.card
            fd = card.field_data or {}
            fd_upper = {k.upper(): v for k, v in fd.items()}
            ordered_fields = []
            for field in table.fields:
                fname = field['name']
                ftype = field.get('type', 'text')
                fval = fd.get(fname, '') or fd_upper.get(fname.upper(), '')
                ordered_fields.append({'name': fname, 'type': ftype, 'value': fval})
            req_by = pr.requested_by
            print_items.append({
                'pr_id': pr.id,
                'card_id': card.id,
                'sr_no': idx + 1,
                'status': card.status,
                'get_status_display': card.get_status_display(),
                'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
                'requested_at': pr.created_at,
                'ordered_fields': ordered_fields,
                'updated_at': card.updated_at,
            })

    download_items = []
    download_total = 0
    if current_step == 'download':
        dl_qs = PrintRequest.objects.filter(
            table=table, status='downloaded',
        ).select_related('card', 'requested_by').order_by('-updated_at')
        download_total = dl_qs.count()
        dl_batch = dl_qs[:INITIAL_LOAD_LIMIT]
        for idx, pr in enumerate(dl_batch):
            card = pr.card
            fd = card.field_data or {}
            fd_upper = {k.upper(): v for k, v in fd.items()}
            ordered_fields = []
            for field in table.fields:
                fname = field['name']
                ftype = field.get('type', 'text')
                fval = fd.get(fname, '') or fd_upper.get(fname.upper(), '')
                ordered_fields.append({'name': fname, 'type': ftype, 'value': fval})
            req_by = pr.requested_by
            download_items.append({
                'pr_id': pr.id,
                'card_id': card.id,
                'sr_no': idx + 1,
                'status': card.status,
                'get_status_display': card.get_status_display(),
                'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
                'downloaded_at': pr.updated_at,
                'ordered_fields': ordered_fields,
                'updated_at': card.updated_at,
            })

    context = {
        'active_page': 'idcard_group',
        'user_role': user.get_role_display(),
        'table': table,
        'group': table.group,
        'client': table.group.client,
        'current_step': current_step,
        'step_counts': step_counts,
        'print_items': print_items,
        'print_total': print_total,
        'print_has_more': print_total > INITIAL_LOAD_LIMIT,
        'download_items': download_items,
        'download_total': download_total,
        'download_has_more': download_total > INITIAL_LOAD_LIMIT,
        'initial_load_limit': INITIAL_LOAD_LIMIT,
    }
    return render(request, 'cardprint/print-cards.html', context)


# =============================================================================
# CREATE TABLE FROM XLSX (client side)
# =============================================================================

@require_client_admin
@require_http_methods(["POST"])
def client_api_create_table_from_xlsx(request):
    """
    Client wrapper for the Create-from-XLSX API.
    Auto-detects the client's default group, then delegates to the core view.
    """
    user = request.user
    client = _get_client_for_request(user)
    if not client:
        return JsonResponse({'success': False, 'message': 'Client not found.'}, status=403)

    if not PermissionService.has_permission(user, 'perm_idcard_setting_add'):
        return JsonResponse({'success': False, 'message': 'Permission denied.'}, status=403)

    group = IDCardService.ensure_default_group(client)
    from core.views.idcard_api import api_create_table_from_xlsx
    return api_create_table_from_xlsx(request, group.id)
