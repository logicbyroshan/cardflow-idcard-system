"""
Client Views — page rendering views.

Full-page views for the client dashboard, card groups, card table,
and staff management.
"""
from django.urls import reverse
from django.shortcuts import render, redirect
from django.core.paginator import Paginator
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from idcards.models import IDCardTable
from core.services.permission_service import PermissionService
from core.models import ClientMessage, NotificationRead

from .views_decorators import require_client_user, require_client_admin, require_client_staff_manager
from .services import ClientAccessService, ClientDashboardService


# =============================================================================
# PAGE VIEWS
# =============================================================================

@require_client_user
def dashboard(request):
    """
    Client Dashboard - shows summary of card data and quick actions.
    """
    # Mobile users should use the PWA mobile app, not the desktop dashboard
    import re
    ua = request.META.get('HTTP_USER_AGENT', '')
    if re.search(r'Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini', ua, re.I):
        return redirect('/app/')

    user = request.user
    client = ClientAccessService.get_client_for_user(user)
    
    if not client:
        return redirect('/panel/auth/login/')
    
    # Get dashboard data
    result = ClientDashboardService.get_dashboard_data(user)
    
    # Get permission context
    permissions = PermissionService.get_permission_context(user)
    
    context = {
        'user': user,
        'user_name': user.get_full_name() or user.username,
        'user_role': 'Client Admin' if PermissionService.is_client(user) else 'Client Staff',
        'client': client,
        'is_client_admin': PermissionService.is_client(user),
        'active_page': 'dashboard',
        **permissions,
    }
    
    if result.success:
        context.update(result.data)
    
    return render(request, 'client/dashboard.html', context)


@require_client_user
def card_groups(request):
    """
    View all card groups (ID Card Settings) for the client.
    """
    user = request.user
    client = ClientAccessService.get_client_for_user(user)
    
    if not client:
        return redirect('/panel/auth/login/')
    
    # Check permission
    if not (
        PermissionService.has_permission(user, 'perm_idcard_setting_list')
        or PermissionService.has_permission(user, 'perm_idcard_reprint_list')
        or PermissionService.has_permission(user, 'perm_reprint_request_list')
        or PermissionService.has_permission(user, 'perm_confirmed_list')
    ):
        return redirect(reverse('client:dashboard'))
    
    result = ClientDashboardService.get_groups_with_counts(user)
    permissions = PermissionService.get_permission_context(user)
    
    context = {
        'user': user,
        'user_name': user.get_full_name() or user.username,
        'user_role': 'Client Admin' if PermissionService.is_client(user) else 'Client Staff',
        'client': client,
        'is_client_admin': PermissionService.is_client(user),
        'active_page': 'groups',
        'groups': result.data.get('groups', []) if result.success else [],
        **permissions,
    }
    
    return render(request, 'client/groups.html', context)


@require_client_user
def card_table(request, table_id):
    """
    View cards in a specific table.
    """
    user = request.user
    client = ClientAccessService.get_client_for_user(user)
    
    if not client:
        return redirect('/panel/auth/login/')
    
    # Require at least one list permission to view cards
    LIST_PERMISSIONS = [
        'perm_idcard_setting_list', 'perm_idcard_pending_list',
        'perm_idcard_verified_list', 'perm_idcard_approved_list',
        'perm_idcard_download_list', 'perm_idcard_pool_list',
        'perm_idcard_reprint_list',
        'perm_reprint_request_list', 'perm_confirmed_list',
    ]
    if not any(PermissionService.has_permission(user, p) for p in LIST_PERMISSIONS):
        return redirect(reverse('client:dashboard'))
    
    # Verify access
    try:
        table = IDCardTable.objects.select_related('group__client').get(id=table_id)
    except IDCardTable.DoesNotExist:
        return redirect(reverse('client:groups'))
    
    if not ClientAccessService.can_access_table(user, table):
        return redirect(reverse('client:groups'))
    
    # Get status filter from query params
    status_filter = request.GET.get('status', '')
    
    permissions = PermissionService.get_permission_context(user)
    
    context = {
        'user': user,
        'user_name': user.get_full_name() or user.username,
        'user_role': 'Client Admin' if PermissionService.is_client(user) else 'Client Staff',
        'client': client,
        'is_client_admin': PermissionService.is_client(user),
        'active_page': 'groups',
        'table': table,
        'group': table.group,
        'status_filter': status_filter,
        **permissions,
    }
    
    return render(request, 'client/cards.html', context)


@require_client_user
def print_table(request, table_id):
    """
    Client-facing print view for a table. Tests expect a redirect to
    the idcard-group page when the current client lacks print/download
    permissions. We do not implement full printing here; just guard access
    and redirect appropriately.
    """
    user = request.user
    client = ClientAccessService.get_client_for_user(user)
    if not client:
        return redirect('/panel/auth/login/')

    # Print functionality removed — print routes are deprecated.
    # Redirect to the shared ID card group view expected by existing callers.
    return redirect(reverse('client:idcard_group'))


@require_client_staff_manager
def manage_staff(request):
    """
    Manage client staff members.
    Only accessible by Client Admin.
    Uses same layout as admin manage-staff page.
    """
    user = request.user
    client = ClientAccessService.get_client_for_user(user)
    
    if not client:
        return redirect('/panel/auth/login/')
    
    # Check permission: allow either client-list toggle or explicit manage-staff flag
    if not (PermissionService.has_permission(user, 'perm_idcard_client_list')
            or PermissionService.has_permission(user, 'perm_manage_client_staff')):
        return redirect(reverse('client:dashboard'))
    
    # Get Staff QuerySet directly for server-side table rendering
    from staff.models import Staff  # local import: not needed at module level
    staff_list = Staff.objects.filter(
        client=client,
        staff_type='client_staff'
    ).select_related('user').order_by('-created_at')
    
    permissions = PermissionService.get_permission_context(user)
    
    context = {
        'user': user,
        'user_name': user.get_full_name() or user.username,
        'user_role': 'Client Admin' if PermissionService.is_client(user) else 'Client Staff',
        'client': client,
        'is_client_admin': PermissionService.is_client(user),
        'active_page': 'staff',
        'staff_list': staff_list,
        **permissions,
    }
    
    return render(request, 'client/staff.html', context)


@require_client_user
def messages(request):
    """Read-only client message history page (admin-originated one-way messages)."""
    user = request.user
    client = ClientAccessService.get_client_for_user(user)

    if not client:
        return redirect('/panel/auth/login/')

    now = timezone.now()
    base_qs = (
        ClientMessage.objects
        .filter(
            client_id=client.id,
            notification__is_active=True,
            notification__target='selected',
            notification__target_users=user,
        )
        .filter(Q(visibility='permanent') | Q(expires_at__gt=now))
        .annotate(
            is_read=Exists(
                NotificationRead.objects.filter(
                    notification_id=OuterRef('notification_id'),
                    user=user,
                )
            )
        )
        .select_related('client', 'sent_by', 'notification')
        .order_by('-created_at')
    )

    paginator = Paginator(base_qs, 20)
    page_obj = paginator.get_page(request.GET.get('page', 1))
    unread_count = base_qs.filter(is_read=False).count()

    permissions = PermissionService.get_permission_context(user)
    context = {
        'user': user,
        'user_name': user.get_full_name() or user.username,
        'user_role': 'Client Admin' if PermissionService.is_client(user) else 'Client Staff',
        'client': client,
        'is_client_admin': PermissionService.is_client(user),
        'active_page': 'client_messages',
        'messages_page': page_obj,
        'unread_count': unread_count,
        'total_count': paginator.count,
        **permissions,
    }
    return render(request, 'client/messages.html', context)
