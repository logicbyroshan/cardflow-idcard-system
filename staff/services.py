"""
Staff Services Module — SINGLE AUTHORITY for admin-staff mutations.

Handles:
- Admin Staff creation by Super Admin
- Permission assignment using Django Groups & Permissions
- Client assignment (many-to-many)
- Client scoping for data access
- Access control enforcement

ARCHITECTURE RULES:
- Views must NOT call .save(), .create(), .delete() on Staff/User directly.
- All admin-staff mutations go through AdminStaffCreationService.
- Permission checks use PermissionService.is_super_admin() (single authority).
- Client scoping delegates to PermissionService.get_accessible_clients().

ACCESS RULES:
- Only Super Admin (super_admin/superuser) can create/manage admin staff.
- Admin Staff can only operate on assigned clients.
- Uses Django's native permission system.
"""
from typing import Dict, Any, Optional, List

from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import QuerySet

from core.models import User, Client, Staff
from core.services.permission_service import PermissionService
from core.utils.email_utils import generate_secure_password, send_welcome_email


# =============================================================================
# ADMIN STAFF PERMISSION DEFINITIONS
# =============================================================================

# Permissions that can be assigned to Admin Staff
# These map to Django permission codenames
ADMIN_STAFF_PERMISSIONS = {
    # Client Management
    'can_view_clients': 'Can view client list',
    'can_add_clients': 'Can add new clients',
    'can_edit_clients': 'Can edit client details',
    'can_delete_clients': 'Can delete clients',
    'can_toggle_client_status': 'Can activate/deactivate clients',
    
    # ID Card Data Management
    'can_view_idcard_data': 'Can view ID card data',
    'can_add_idcard_data': 'Can add ID card data',
    'can_edit_idcard_data': 'Can edit ID card data',
    'can_delete_idcard_data': 'Can delete ID card data',
    'can_verify_idcard': 'Can verify ID cards',
    'can_approve_idcard': 'Can approve ID cards',
    
    # ID Card Settings
    'can_view_idcard_settings': 'Can view ID card settings',
    'can_add_idcard_settings': 'Can add ID card settings',
    'can_edit_idcard_settings': 'Can edit ID card settings',
    'can_delete_idcard_settings': 'Can delete ID card settings',
    
    # Image Management
    'can_upload_images': 'Can upload ID card images',
    'can_reupload_images': 'Can re-upload ID card images',
    
    # Bulk Operations
    'can_bulk_upload': 'Can perform bulk upload',
    'can_bulk_download': 'Can perform bulk download',
    
    # Exports
    'can_export_data': 'Can export data',
    'can_download_cards': 'Can download rendered cards',
    
    # Workflow
    'can_view_workflow': 'Can view workflow status',
    'can_manage_workflow': 'Can manage workflow',
}

# Admin Staff Django Group name
ADMIN_STAFF_GROUP = 'admin_staff_group'


# =============================================================================
# ADMIN STAFF PERMISSION SERVICE
# =============================================================================

class AdminStaffPermissionService:
    """
    Service for managing Django Groups & Permissions for Admin Staff.
    """
    
    @classmethod
    def ensure_permissions_exist(cls) -> None:
        """
        Ensure all admin staff permissions exist in the database.
        Creates them if they don't exist.
        """
        content_type = ContentType.objects.get_for_model(User)
        
        for codename, name in ADMIN_STAFF_PERMISSIONS.items():
            Permission.objects.get_or_create(
                codename=codename,
                content_type=content_type,
                defaults={'name': name}
            )
    
    @classmethod
    def get_or_create_admin_staff_group(cls) -> Group:
        """
        Get or create the Admin Staff Django Group.
        """
        cls.ensure_permissions_exist()
        group, created = Group.objects.get_or_create(name=ADMIN_STAFF_GROUP)
        return group
    
    @classmethod
    def get_assignable_permissions(cls) -> List[Dict[str, Any]]:
        """
        Get list of permissions that can be assigned to admin staff.
        """
        cls.ensure_permissions_exist()
        
        content_type = ContentType.objects.get_for_model(User)
        permissions = Permission.objects.filter(
            codename__in=ADMIN_STAFF_PERMISSIONS.keys(),
            content_type=content_type
        )
        
        return [
            {
                'id': p.pk,
                'codename': p.codename,
                'name': p.name,
                'description': ADMIN_STAFF_PERMISSIONS.get(p.codename, ''),
            }
            for p in permissions
        ]
    
    @classmethod
    def assign_permissions_to_staff(
        cls,
        staff_user: User,
        permission_codenames: List[str]
    ) -> Dict[str, Any]:
        """
        Assign specific permissions to an admin staff user.
        """
        try:
            cls.ensure_permissions_exist()
            
            # Validate codenames
            valid_codenames = set(ADMIN_STAFF_PERMISSIONS.keys())
            requested = set(permission_codenames)
            invalid = requested - valid_codenames
            
            if invalid:
                return {
                    'success': False,
                    'error': f"Invalid permissions: {', '.join(invalid)}"
                }
            
            content_type = ContentType.objects.get_for_model(User)
            
            # Clear existing permissions
            staff_user.user_permissions.filter(content_type=content_type).delete()
            
            # Add new permissions
            permissions = Permission.objects.filter(
                codename__in=permission_codenames,
                content_type=content_type
            )
            staff_user.user_permissions.add(*permissions)
            
            return {
                'success': True,
                'assigned_count': permissions.count()
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    @classmethod
    def get_user_permissions(cls, user: User) -> List[str]:
        """
        Get all permission codenames for an admin staff user.
        """
        if not user.is_authenticated:
            return []
        
        # Get permissions that match our defined ones
        user_perms = user.get_all_permissions()
        admin_staff_perms = []
        
        for perm in user_perms:
            # Format is 'app_label.codename', we want just codename
            if '.' in perm:
                codename = perm.split('.')[-1]
            else:
                codename = perm
            
            if codename in ADMIN_STAFF_PERMISSIONS:
                admin_staff_perms.append(codename)
        
        return admin_staff_perms


# =============================================================================
# ADMIN STAFF CREATION SERVICE
# =============================================================================

class AdminStaffCreationService:
    """
    Service for creating and managing Admin Staff members.
    Only accessible by Super Admin (super_admin/superuser).
    """
    
    @classmethod
    def create_admin_staff(
        cls,
        created_by: User,
        first_name: str,
        last_name: str,
        email: str,
        phone: str = '',
        designation: str = 'Staff',
        department: str = '',
        assigned_client_ids: Optional[List[int]] = None,
        permission_codenames: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Create a new admin staff member.
        
        Args:
            created_by: Super Admin user creating the staff
            first_name: Staff's first name
            last_name: Staff's last name
            email: Staff's email (becomes username)
            phone: Staff's phone number
            designation: Job designation
            department: Department name
            assigned_client_ids: List of client IDs this staff can access
            permission_codenames: List of permission codenames to assign
        
        Returns:
            Dict with success status, message, and staff data
        """
        try:
            # Verify creator is super admin
            if not PermissionService.is_super_admin(created_by):
                return {
                    'success': False,
                    'error': 'Only Super Admin can create admin staff'
                }
            
            # Check if email already exists
            if User.objects.filter(email=email).exists():
                return {
                    'success': False,
                    'error': 'A user with this email already exists'
                }
            
            with transaction.atomic():
                # Generate secure password
                password = generate_secure_password()
                
                # Create User
                user = User.objects.create_user(
                    username=email,
                    email=email,
                    password=password,
                    first_name=first_name,
                    last_name=last_name,
                    role='admin_staff',
                    phone=phone,
                    is_active=True,
                )
                
                # Create Staff profile
                staff = Staff.objects.create(
                    user=user,
                    staff_type='admin_staff',
                    designation=designation,
                    department=department,
                )
                
                # Assign clients (only active ones)
                if assigned_client_ids:
                    clients = Client.objects.filter(id__in=assigned_client_ids, status='active')
                    staff.assigned_clients.set(clients)
                
                # Add to admin staff group
                group = AdminStaffPermissionService.get_or_create_admin_staff_group()
                user.groups.add(group)
                
                # Assign permissions
                if permission_codenames:
                    perm_result = AdminStaffPermissionService.assign_permissions_to_staff(
                        user, permission_codenames
                    )
                    if not perm_result['success']:
                        raise ValueError(perm_result['error'])
                
                # Send welcome email
                full_name = f"{first_name} {last_name}"
                success, msg = send_welcome_email(
                    email=email,
                    name=full_name,
                    password=password,
                    role='Admin Staff'
                )
                
                return {
                    'success': True,
                    'message': f'Admin staff "{full_name}" created successfully',
                    'staff': {
                        'id': staff.pk,
                        'user_id': user.pk,
                        'name': full_name,
                        'email': email,
                    },
                    'email_sent': success,
                    'email_message': msg,
                }
                
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    @classmethod
    def update_admin_staff(
        cls,
        updated_by: User,
        staff_id: int,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        phone: Optional[str] = None,
        designation: Optional[str] = None,
        department: Optional[str] = None,
        assigned_client_ids: Optional[List[int]] = None,
        permission_codenames: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Update an existing admin staff member.
        """
        try:
            if not PermissionService.is_super_admin(updated_by):
                return {
                    'success': False,
                    'error': 'Only Super Admin can update admin staff'
                }
            
            staff = Staff.objects.filter(
                id=staff_id,
                staff_type='admin_staff'
            ).select_related('user').first()
            
            if not staff:
                return {'success': False, 'error': 'Admin staff not found'}
            
            with transaction.atomic():
                user = staff.user
                
                # Update user fields
                if first_name is not None:
                    user.first_name = first_name
                if last_name is not None:
                    user.last_name = last_name
                if phone is not None:
                    user.phone = phone
                user.save()
                
                # Update staff fields
                if designation is not None:
                    staff.designation = designation
                if department is not None:
                    staff.department = department
                staff.save()
                
                # Update assigned clients (only active ones)
                if assigned_client_ids is not None:
                    clients = Client.objects.filter(id__in=assigned_client_ids, status='active')
                    staff.assigned_clients.set(clients)
                
                # Update permissions
                if permission_codenames is not None:
                    AdminStaffPermissionService.assign_permissions_to_staff(
                        user, permission_codenames
                    )
                
                return {
                    'success': True,
                    'message': f'Admin staff "{user.get_full_name()}" updated successfully',
                }
                
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    @classmethod
    def delete_admin_staff(cls, deleted_by: User, staff_id: int) -> Dict[str, Any]:
        """
        Delete an admin staff member.
        """
        try:
            if not PermissionService.is_super_admin(deleted_by):
                return {
                    'success': False,
                    'error': 'Only Super Admin can delete admin staff'
                }
            
            staff = Staff.objects.filter(
                id=staff_id,
                staff_type='admin_staff'
            ).select_related('user').first()
            
            if not staff:
                return {'success': False, 'error': 'Admin staff not found'}
            
            name = staff.user.get_full_name()
            user = staff.user
            
            # Delete staff profile and user atomically
            with transaction.atomic():
                staff.delete()
                user.delete()
            
            return {
                'success': True,
                'message': f'Admin staff "{name}" deleted successfully'
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    @classmethod
    def toggle_status(cls, toggled_by: User, staff_id: int) -> Dict[str, Any]:
        """
        Toggle admin staff active/inactive status.
        """
        try:
            if not PermissionService.is_super_admin(toggled_by):
                return {
                    'success': False,
                    'error': 'Only Super Admin can toggle staff status'
                }
            
            with transaction.atomic():
                staff = Staff.objects.select_for_update().select_related('user').filter(
                    id=staff_id,
                    staff_type='admin_staff'
                ).first()
                
                if not staff:
                    return {'success': False, 'error': 'Admin staff not found'}
                
                user = staff.user
                user.is_active = not user.is_active
                user.save(update_fields=['is_active'])
            
            status = 'activated' if user.is_active else 'deactivated'
            return {
                'success': True,
                'message': f'Admin staff "{user.get_full_name()}" {status}',
                'is_active': user.is_active,
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    @classmethod
    def reset_password(cls, reset_by: User, staff_id: int) -> Dict[str, Any]:
        """
        Reset admin staff password and send email.
        """
        try:
            if not PermissionService.is_super_admin(reset_by):
                return {
                    'success': False,
                    'error': 'Only Super Admin can reset staff password'
                }
            
            staff = Staff.objects.filter(
                id=staff_id,
                staff_type='admin_staff'
            ).select_related('user').first()
            
            if not staff:
                return {'success': False, 'error': 'Admin staff not found'}
            
            user = staff.user
            new_password = generate_secure_password()
            user.set_password(new_password)
            user.save()
            
            # Send email with new password
            success, msg = send_welcome_email(
                email=user.email,
                name=user.get_full_name(),
                password=new_password,
                role='Admin Staff'
            )
            
            return {
                'success': True,
                'message': f'Password reset for "{user.get_full_name()}"',
                'email_sent': success,
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    @classmethod
    def list_admin_staff(cls, user: User) -> Dict[str, Any]:
        """
        List all admin staff members.
        Only accessible by Super Admin.
        """
        try:
            if not PermissionService.is_super_admin(user):
                return {
                    'success': False,
                    'error': 'Only Super Admin can view admin staff list'
                }
            
            staff_list = Staff.objects.filter(
                staff_type='admin_staff'
            ).select_related('user').prefetch_related('assigned_clients')
            
            data = []
            for staff in staff_list:
                permissions = AdminStaffPermissionService.get_user_permissions(staff.user)
                # Use prefetched cache instead of re-evaluating queryset
                assigned = list(staff.assigned_clients.all())
                data.append({
                    'id': staff.pk,
                    'user_id': staff.user.pk,
                    'name': staff.user.get_full_name(),
                    'email': staff.user.email,
                    'phone': staff.user.phone or '',
                    'designation': staff.designation or '',
                    'department': staff.department or '',
                    'is_active': staff.user.is_active,
                    'assigned_clients': [
                        {'id': c.id, 'name': c.name}
                        for c in assigned
                    ],
                    'assigned_clients_count': len(assigned),
                    'permissions_count': len(permissions),
                    'created_at': staff.created_at.isoformat(),
                })
            
            return {
                'success': True,
                'staff': data,
                'count': len(data),
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    @classmethod
    def get_admin_staff_detail(cls, user: User, staff_id: int) -> Dict[str, Any]:
        """
        Get detailed info for a single admin staff member.
        """
        try:
            if not PermissionService.is_super_admin(user):
                return {
                    'success': False,
                    'error': 'Only Super Admin can view admin staff details'
                }
            
            staff = Staff.objects.filter(
                id=staff_id,
                staff_type='admin_staff'
            ).select_related('user').prefetch_related('assigned_clients').first()
            
            if not staff:
                return {'success': False, 'error': 'Admin staff not found'}
            
            permissions = AdminStaffPermissionService.get_user_permissions(staff.user)
            
            return {
                'success': True,
                'staff': {
                    'id': staff.pk,
                    'user_id': staff.user.pk,
                    'first_name': staff.user.first_name,
                    'last_name': staff.user.last_name,
                    'email': staff.user.email,
                    'phone': staff.user.phone or '',
                    'designation': staff.designation or '',
                    'department': staff.department or '',
                    'is_active': staff.user.is_active,
                    'assigned_clients': [
                        {'id': c.id, 'name': c.name}
                        for c in staff.assigned_clients.all()
                    ],
                    'permissions': permissions,
                    'created_at': staff.created_at.isoformat(),
                    'updated_at': staff.updated_at.isoformat(),
                }
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}


# =============================================================================
# CLIENT SCOPING SERVICE — delegates to PermissionService (single authority)
# =============================================================================

class ClientScopingService:
    """
    Service for enforcing client-based data scoping.
    Now delegates to PermissionService for all role/scope decisions.
    """
    
    @classmethod
    def get_accessible_clients(cls, user: User) -> QuerySet:
        """Get QuerySet of clients accessible to the user."""
        from core.services.permission_service import PermissionService
        if not user.is_authenticated:
            return Client.objects.none()
        if PermissionService.is_super_admin(user):
            return Client.objects.all()
        if PermissionService.is_admin_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff and staff.staff_type == 'admin_staff':
                return staff.assigned_clients.all()
        return Client.objects.none()
    
    @classmethod
    def get_accessible_client_ids(cls, user: User) -> List[int]:
        """Get list of accessible client IDs for the user."""
        from core.services.permission_service import PermissionService
        return PermissionService.get_accessible_client_ids(user)
    
    @classmethod
    def can_access_client(cls, user: User, client_id: int) -> bool:
        """Check if user can access a specific client."""
        from core.services.permission_service import PermissionService
        return PermissionService.can_access_client(user, client_id)
    
    @classmethod
    def filter_by_accessible_clients(cls, user: User, queryset: QuerySet, client_field: str = 'client') -> QuerySet:
        """Filter queryset to only include records for accessible clients."""
        from core.services.permission_service import PermissionService
        if not user.is_authenticated:
            return queryset.none()
        if PermissionService.is_super_admin(user):
            return queryset
        if PermissionService.is_admin_staff(user):
            accessible_ids = PermissionService.get_accessible_client_ids(user)
            filter_kwargs = {f'{client_field}__id__in': accessible_ids}
            return queryset.filter(**filter_kwargs)
        return queryset.none()
    
    @classmethod
    def get_scope_context(cls, user: User) -> Dict[str, Any]:
        """Get client scoping context for templates/views."""
        from core.services.permission_service import PermissionService
        accessible = cls.get_accessible_clients(user)
        return {
            'is_shop_owner': PermissionService.is_super_admin(user),
            'is_admin_staff': PermissionService.is_admin_staff(user),
            'accessible_clients': list(accessible.values('id', 'name')),
            'accessible_client_ids': list(accessible.values_list('id', flat=True)),
            'has_client_access': accessible.exists(),
        }


# =============================================================================
# PERMISSION CHECK DECORATORS — delegates to permission_service decorators
# =============================================================================

from functools import wraps
from django.http import JsonResponse
from django.shortcuts import redirect


def require_shop_owner(view_func):
    """Deprecated — delegates to require_super_admin from permission_service."""
    from core.services.permission_service import require_super_admin
    return require_super_admin(view_func)


def require_admin_staff_or_owner(view_func):
    """Deprecated — delegates to require_any_admin from permission_service."""
    from core.services.permission_service import require_any_admin
    return require_any_admin(view_func)


def check_client_access(client_id_param: str = 'client_id'):
    """
    Decorator to check if user can access a specific client.
    Delegates to PermissionService.can_access_client().
    """
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            from core.services.permission_service import PermissionService
            client_id = kwargs.get(client_id_param) or request.GET.get(client_id_param) or request.POST.get(client_id_param)
            
            if client_id:
                try:
                    client_id = int(client_id)
                except (TypeError, ValueError):
                    return JsonResponse({'success': False, 'error': 'Invalid client ID'}, status=400)
                
                if not PermissionService.can_access_client(request.user, client_id):
                    return JsonResponse({
                        'success': False,
                        'error': 'You do not have access to this client'
                    }, status=403)
            
            return view_func(request, *args, **kwargs)
        
        return wrapper
    return decorator


def check_permission(codename: str):
    """
    Decorator to check if user has a specific Django permission.
    Delegates super_admin check to PermissionService.
    """
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            from core.services.permission_service import PermissionService
            user = request.user
            
            if not user.is_authenticated:
                return JsonResponse({'success': False, 'error': 'Not authenticated'}, status=401)
            
            # Super Admin has all permissions (via single authority)
            if PermissionService.is_super_admin(user):
                return view_func(request, *args, **kwargs)
            
            # Check permission
            if not user.has_perm(f'core.{codename}'):
                return JsonResponse({
                    'success': False,
                    'error': f'Permission denied: {codename}'
                }, status=403)
            
            return view_func(request, *args, **kwargs)
        
        return wrapper
    return decorator
