"""
Staff Views Module

Views for Admin Staff management by Super Admin.
All views enforce Super Admin access at the view level.

API Endpoints:
- GET/POST /staff/api/admin-staff/           - List/Create admin staff
- GET/PUT/DELETE /staff/api/admin-staff/<id>/ - Detail/Update/Delete
- POST /staff/api/admin-staff/<id>/toggle-status/ - Toggle active status
- POST /staff/api/admin-staff/<id>/reset-password/ - Reset password
- GET /staff/api/permissions/available/      - List assignable permissions
- GET /staff/api/clients/available/          - List clients for assignment

Page Views:
- GET /staff/manage/                         - Staff management page
"""
import json
import logging

from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required

from client.models import Client
from .models import Staff
from core.services.activity_service import ActivityService

from .services import (
    AdminStaffCreationService,
    AdminStaffPermissionService,
    ClientScopingService,
    check_client_access,
    check_permission,

    ADMIN_STAFF_PERMISSIONS,
)
from core.services.permission_service import (
    require_super_admin,
    require_any_admin,
)


logger = logging.getLogger(__name__)


def _parse_json_object(request):
    """Parse request JSON and require a dict payload for mutation endpoints."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None, JsonResponse({'success': False, 'error': 'Invalid JSON'}, status=400)

    if not isinstance(data, dict):
        return None, JsonResponse({'success': False, 'error': 'Invalid JSON'}, status=400)

    return data, None


# =============================================================================
# PAGE VIEWS
# =============================================================================

@login_required
@require_super_admin
def staff_management_page(request):
    """
    Admin Staff management page for Super Admin.
    """
    context = {
        'page_title': 'Manage Admin Staff',
    }
    return render(request, 'staff/manage.html', context)


# =============================================================================
# ADMIN STAFF CRUD API
# =============================================================================

@login_required
@require_super_admin
@require_http_methods(['GET', 'POST'])
def api_admin_staff_list_create(request):
    """
    GET: List all admin staff members
    POST: Create new admin staff member
    """
    if request.method == 'GET':
        result = AdminStaffCreationService.list_admin_staff(request.user)
        return JsonResponse(result)
    
    # POST - Create new staff
    data, json_err = _parse_json_object(request)
    if json_err:
        return json_err
    
    result = AdminStaffCreationService.create_admin_staff(
        created_by=request.user,
        first_name=data.get('first_name', ''),
        last_name=data.get('last_name', ''),
        email=data.get('email', ''),
        phone=data.get('phone', ''),
        designation=data.get('designation', 'Staff'),
        department=data.get('department', ''),
        assigned_client_ids=data.get('assigned_clients', []),
        permission_codenames=data.get('permissions', []),
        password=data.get('password', ''),
    )
    
    if result.get('success'):
        staff_obj = result.get('data', {}).get('staff') or result.get('staff')
        name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip() or 'staff member'
        ActivityService.log(
            'staff_create',
            f'New admin staff "{name}" added',
            request=request,
            target_model='Staff',
            target_name=name,
        )
    
    status = 201 if result.get('success') else 400
    return JsonResponse(result, status=status)


@login_required
@require_super_admin
@require_http_methods(['GET', 'PUT', 'DELETE'])
def api_admin_staff_detail(request, staff_id):
    """
    GET: Get admin staff detail
    PUT: Update admin staff
    DELETE: Delete admin staff
    """
    if request.method == 'GET':
        result = AdminStaffCreationService.get_admin_staff_detail(request.user, staff_id)
        status = 200 if result.get('success') else 404
        return JsonResponse(result, status=status)
    
    if request.method == 'PUT':
        data, json_err = _parse_json_object(request)
        if json_err:
            return json_err
        
        result = AdminStaffCreationService.update_admin_staff(
            updated_by=request.user,
            staff_id=staff_id,
            first_name=data.get('first_name'),
            last_name=data.get('last_name'),
            phone=data.get('phone'),
            designation=data.get('designation'),
            department=data.get('department'),
            assigned_client_ids=data.get('assigned_clients'),
            permission_codenames=data.get('permissions'),
        )
        
        if result.get('success'):
            name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip() or 'staff member'
            ActivityService.log(
                'staff_update',
                f'Admin staff "{name}" details updated',
                request=request,
                target_model='Staff',
                target_id=staff_id,
                target_name=name,
            )
        
        status = 200 if result.get('success') else 400
        return JsonResponse(result, status=status)
    
    if request.method == 'DELETE':
        result = AdminStaffCreationService.delete_admin_staff(request.user, staff_id)
        if result.get('success'):
            name = result.get('data', {}).get('name', 'staff member')
            ActivityService.log(
                'staff_delete',
                f'Admin staff "{name}" removed',
                request=request,
                target_model='Staff',
                target_id=staff_id,
                target_name=name,
            )
        status = 200 if result.get('success') else 400
        return JsonResponse(result, status=status)


@login_required
@require_super_admin
@require_http_methods(['POST'])
def api_admin_staff_toggle_status(request, staff_id):
    """Toggle admin staff active/inactive status."""
    try:
        result = AdminStaffCreationService.toggle_status(request.user, staff_id)
        if result.get('success'):
            payload = result.get('data', {})
            new_status = payload.get('is_active')
            if new_status is None:
                new_status = result.get('is_active')
            name = payload.get('name', 'staff member')
            label = 'active' if new_status else 'inactive'
            ActivityService.log(
                'staff_status',
                f'Admin staff "{name}" marked as {label}',
                request=request,
                target_model='Staff',
                target_id=staff_id,
                target_name=name,
            )
        status = 200 if result.get('success') else 400
        return JsonResponse(result, status=status)
    except Exception as e:
        logger.exception("Staff toggle status error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@login_required
@require_super_admin
@require_http_methods(['POST'])
def api_admin_staff_reset_password(request, staff_id):
    """Reset admin staff password and send email."""
    try:
        result = AdminStaffCreationService.reset_password(request.user, staff_id)
        if result.get('success'):
            target_name = ''
            try:
                staff_obj = Staff.objects.select_related('user').filter(id=staff_id).first()
                if staff_obj and staff_obj.user:
                    target_name = (staff_obj.user.get_full_name() or staff_obj.user.username or '').strip()
            except Exception:
                target_name = ''

            ActivityService.log(
                'staff_password_reset',
                f'Admin staff password reset for "{target_name or staff_id}"',
                request=request,
                target_model='Staff',
                target_id=staff_id,
                target_name=target_name,
            )
        status = 200 if result.get('success') else 400
        return JsonResponse(result, status=status)
    except Exception as e:
        logger.exception("Staff reset password error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


# =============================================================================
# PERMISSION & CLIENT LISTING API
# =============================================================================

@login_required
@require_super_admin
@require_http_methods(['GET'])
def api_available_permissions(request):
    """Get list of permissions that can be assigned to admin staff."""
    permissions = AdminStaffPermissionService.get_assignable_permissions()
    return JsonResponse({
        'success': True,
        'permissions': permissions,
    })


@login_required
@require_super_admin
@require_http_methods(['GET'])
def api_available_clients(request):
    """Get list of all clients for assignment to admin staff (includes inactive)."""
    clients = Client.objects.all().values('id', 'name', 'status')
    return JsonResponse({
        'success': True,
        'clients': list(clients),
    })


# =============================================================================
# ADMIN STAFF SELF-SERVICE API
# =============================================================================

@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_my_permissions(request):
    """Get current user's permissions (for admin staff dashboard)."""
    permissions = AdminStaffPermissionService.get_user_permissions(request.user)
    scope = ClientScopingService.get_scope_context(request.user)
    
    return JsonResponse({
        'success': True,
        'user': {
            'id': request.user.id,
            'name': request.user.get_full_name(),
            'email': request.user.email,
            'role': request.user.role,
        },
        'permissions': permissions,
        'scope': scope,
    })


@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_my_clients(request):
    """Get clients accessible to the current admin staff user."""
    clients = ClientScopingService.get_accessible_clients(request.user)
    
    return JsonResponse({
        'success': True,
        'clients': list(clients.values('id', 'name', 'status')),
    })


# =============================================================================
# CLIENT-SCOPED DATA ACCESS EXAMPLES
# =============================================================================

@login_required
@require_any_admin
@check_permission('can_view_clients')
@require_http_methods(['GET'])
def api_scoped_clients(request):
    """
    Example: Get clients with automatic scoping.
    Admin staff only see their assigned clients.
    """
    clients = ClientScopingService.get_accessible_clients(request.user)
    
    # Apply additional filters if provided
    status = request.GET.get('status')
    if status:
        clients = clients.filter(status=status)
    
    search = request.GET.get('search')
    if search:
        clients = clients.filter(name__icontains=search)
    
    return JsonResponse({
        'success': True,
        'clients': list(clients.values('id', 'name', 'status', 'city')),
    })


@login_required
@require_any_admin
@check_permission('can_view_idcard_data')
@check_client_access('client_id')
@require_http_methods(['GET'])
def api_client_idcard_groups(request, client_id):
    """
    Example: Get ID card groups for a specific client.
    Enforces both permission AND client access checks.
    """
    from idcards.models import IDCardGroup
    
    groups = IDCardGroup.objects.filter(client_id=client_id)
    
    return JsonResponse({
        'success': True,
        'groups': list(groups.values('id', 'name', 'is_active')),
    })


# =============================================================================
# UTILITY VIEWS
# =============================================================================

@login_required
@require_any_admin
def staff_dashboard(request):
    """
    Admin Staff dashboard with scoped data.
    """
    from django.db.models import Count, Q
    from idcards.models import IDCard
    from core.services.permission_service import PermissionService

    scope = ClientScopingService.get_scope_context(request.user)
    permissions = AdminStaffPermissionService.get_user_permissions(request.user)

    # Card stats scoped by admin_staff's assigned clients
    user = request.user
    is_scoped = PermissionService.is_admin_staff(user)
    card_qs = IDCard.objects.all()
    if is_scoped:
        accessible_ids = PermissionService.get_accessible_client_ids(user)
        card_qs = card_qs.filter(table__group__client_id__in=accessible_ids)
    card_stats = card_qs.aggregate(
        total=Count('id', filter=Q(status__in=['pending', 'verified', 'approved', 'download'])),
        pending=Count('id', filter=Q(status='pending')),
        verified=Count('id', filter=Q(status='verified')),
        approved=Count('id', filter=Q(status='approved')),
        downloaded=Count('id', filter=Q(status='download')),
    )

    # Recent activity scoped to this staff user
    recent_activities = ActivityService.get_recent(limit=15, user=user)

    context = {
        'page_title': 'Admin Staff Dashboard',
        'active_page': 'dashboard',
        'scope': scope,
        'permissions': permissions,
        'total_id_cards': card_stats['total'],
        'pending_cards': card_stats['pending'],
        'verified_cards': card_stats['verified'],
        'approved_cards': card_stats['approved'],
        'downloaded_cards': card_stats['downloaded'],
        'recent_activities': recent_activities,
    }

    return render(request, 'dashboard/staff.html', context)
