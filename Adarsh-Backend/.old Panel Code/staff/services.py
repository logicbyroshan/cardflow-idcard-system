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
import logging
from typing import Dict, Any, Optional, List

from accounts.services import normalize_password_input
logger = logging.getLogger(__name__)


def _unexpected_error_response(action: str, exc: Exception) -> Dict[str, Any]:
    """Return safe error payload while logging full details server-side."""
    logger.exception('%s failed: %s', action, exc)
    return {'success': False, 'error': 'An unexpected error occurred. Please try again.'}

from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import QuerySet, Count, Q

from core.models import User
from client.models import Client
from staff.models import Staff
from core.services.permission_service import PermissionService
from core.utils.email_utils import generate_secure_password, send_welcome_email
from core.models import EmailLog


# =============================================================================
# ADMIN STAFF PERMISSION DEFINITIONS
# =============================================================================

# Permissions that can be assigned to Admin Staff
# These map to Django permission codenames
ADMIN_STAFF_PERMISSIONS = {
    # Client Management
    'can_view_clients': 'Can access Clients page',
    'can_add_clients': 'Can create new Client',
    'can_edit_clients': 'Can modify Client details',
    'can_delete_clients': 'Can remove Client',
    'can_toggle_client_status': 'Can toggle Client active status',
    
    # ID Card Data Management
    'can_view_idcard_data': 'Can access Card data',
    'can_add_idcard_data': 'Can add new Card entry',
    'can_edit_idcard_data': 'Can edit Card data',
    'can_delete_idcard_data': 'Can delete Card entry',
    'can_verify_idcard': 'Can verify Card data',
    'can_approve_idcard': 'Can approve Card status',
    
    # ID Card Settings
    'can_view_idcard_settings': 'Can view Template list',
    'can_add_idcard_settings': 'Can create new Template',
    'can_edit_idcard_settings': 'Can modify Template settings',
    'can_delete_idcard_settings': 'Can remove Template',
    
    # Image Management
    'can_upload_images': 'Can upload Card photos',
    'can_reupload_images': 'Can replace Card photos',
    
    # Bulk Operations
    'can_bulk_upload': 'Can use Excel / ZIP bulk upload',
    'can_bulk_download': 'Can download Cards as ZIP',
    
    # Exports
    'can_export_data': 'Can export data (Excel / Word / PDF)',
    'can_download_cards': 'Can download rendered Card images',
    
    # Workflow
    'can_view_workflow': 'Can view workflow dashboard',
    'can_manage_workflow': 'Can manage workflow settings',
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
        group, _created = Group.objects.get_or_create(name=ADMIN_STAFF_GROUP)
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

            # Clear only this user's direct User-content_type permissions.
            # Never call .delete() on Permission queryset: that deletes global
            # permission rows and breaks other users.
            existing_user_perms = list(
                staff_user.user_permissions.filter(content_type=content_type)
            )
            if existing_user_perms:
                staff_user.user_permissions.remove(*existing_user_perms)
            
            # Add new permissions
            permissions = list(Permission.objects.filter(
                codename__in=permission_codenames,
                content_type=content_type
            ))
            if permissions:
                staff_user.user_permissions.add(*permissions)
            
            return {
                'success': True,
                'assigned_count': len(permissions)
            }
            
        except Exception as e:
            return _unexpected_error_response('AdminStaffPermissionService.assign_permissions_to_staff', e)
    
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
        password: str = '',
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
            normalized_email = (email or '').strip().lower()

            if not normalized_email:
                return {
                    'success': False,
                    'error': 'Email is required'
                }

            # Verify creator is super admin
            if not PermissionService.is_super_admin(created_by):
                return {
                    'success': False,
                    'error': 'Only Super Admin can create admin staff'
                }
            
            # Check if email already exists
            if User.objects.filter(email__iexact=normalized_email).exists():
                return {
                    'success': False,
                    'error': 'A user with this email already exists'
                }
            
            with transaction.atomic():
                # Universal password normalization (phone formats -> digits, text -> intact)
                if password and password.strip():
                    final_password = normalize_password_input(password)
                elif phone:
                    final_password = normalize_password_input(phone)
                else:
                    final_password = generate_secure_password()
                
                # Create User — inactive by default; welcome email sent on first activation
                user = User.objects.create_user(
                    username=normalized_email,
                    email=normalized_email,
                    password=final_password,
                    first_name=first_name,
                    last_name=last_name,
                    role='admin_staff',
                    phone=phone,
                    is_active=False,
                )
                
                # Create Staff profile
                staff = Staff.objects.create(
                    user=user,
                    staff_type='admin_staff',
                    designation=designation,
                    department=department,
                )
                
                # Assign clients (allow both active and inactive)
                if assigned_client_ids:
                    clients = Client.objects.filter(id__in=assigned_client_ids)
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
                
                # Log email as on_hold — will be sent on first activation
                full_name = f"{first_name} {last_name}"
                EmailLog.objects.create(
                    recipient_name=full_name.strip(),
                    recipient_email=normalized_email,
                    subject='Welcome to Adarsh Admin - Your Account is Ready!',
                    email_type=EmailLog.EMAIL_TYPE_WELCOME,
                    status=EmailLog.STATUS_ON_HOLD,
                )
                
                return {
                    'success': True,
                    'message': f'Admin staff "{full_name}" created successfully. Welcome email will be sent on first activation.',
                    'staff': {
                        'id': staff.pk,
                        'user_id': staff.user.pk,
                        'name': full_name.strip(),
                        'email': normalized_email,
                    },
                    'email_sent': False,
                }
                
        except ValueError as e:
            return {'success': False, 'error': str(e)}
        except Exception as e:
            return _unexpected_error_response('AdminStaffCreationService.create_admin_staff', e)
    
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

            with transaction.atomic():
                staff = Staff.objects.select_for_update().filter(
                    id=staff_id,
                    staff_type='admin_staff'
                ).select_related('user').first()

                if not staff:
                    return {'success': False, 'error': 'Admin staff not found'}

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
                
                # Update assigned clients (allow both active and inactive)
                if assigned_client_ids is not None:
                    clients = Client.objects.filter(id__in=assigned_client_ids)
                    staff.assigned_clients.set(clients)
                
                # Update permissions
                if permission_codenames is not None:
                    perm_result = AdminStaffPermissionService.assign_permissions_to_staff(
                        user, permission_codenames
                    )
                    if not perm_result.get('success'):
                        raise ValueError(perm_result.get('error', 'Failed to assign permissions'))
                
                return {
                    'success': True,
                    'message': f'Admin staff "{user.get_full_name()}" updated successfully',
                }
                
        except ValueError as e:
            return {'success': False, 'error': str(e)}
        except Exception as e:
            return _unexpected_error_response('AdminStaffCreationService.update_admin_staff', e)
    
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
                'message': f'Admin staff "{name}" deleted successfully',
                'data': {'name': name},
            }
            
        except Exception as e:
            return _unexpected_error_response('AdminStaffCreationService.delete_admin_staff', e)
    
    @classmethod
    def toggle_status(cls, toggled_by: User, staff_id: int) -> Dict[str, Any]:
        """
        Toggle admin staff active/inactive status.
        On the FIRST activation, generates fresh credentials and sends a welcome email.
        """
        try:
            if not PermissionService.is_super_admin(toggled_by):
                return {
                    'success': False,
                    'error': 'Only Super Admin can toggle staff status'
                }

            send_welcome = False
            welcome_info = {}
            welcome_user_id = None

            with transaction.atomic():
                staff = Staff.objects.select_for_update().select_related('user').filter(
                    id=staff_id,
                    staff_type='admin_staff'
                ).first()

                if not staff:
                    return {'success': False, 'error': 'Admin staff not found'}

                user = staff.user
                is_first_activation = not user.is_active and not user.welcome_email_sent
                user.is_active = not user.is_active

                if user.is_active and is_first_activation:
                    phone_value = (user.phone or '').strip()
                    
                    # Use existing phone-based password if it exists, otherwise generate random
                    has_usable_password = bool(user.has_usable_password())
                    
                    # Universal normalization for checking/setting phone passwords
                    normalized_phone_pw = normalize_password_input(phone_value)
                    
                    can_reuse_phone_password = (
                        has_usable_password and bool(phone_value) and (
                            user.check_password(phone_value) or 
                            user.check_password(normalized_phone_pw)
                        )
                    )

                    credential_password = ''
                    if can_reuse_phone_password:
                        # Use the normalized format as standard
                        credential_password = normalized_phone_pw
                        if not user.check_password(credential_password):
                            user.set_password(credential_password)
                    elif normalized_phone_pw:
                        user.set_password(normalized_phone_pw)
                        credential_password = normalized_phone_pw
                    else:
                        credential_password = generate_secure_password()
                        user.set_password(credential_password)

                    user.save(update_fields=['is_active', 'password'])
                    send_welcome = True
                    welcome_user_id = user.pk
                    welcome_info = {
                        'full_name': user.get_full_name(),
                        'email': user.email,
                        'password': credential_password,
                        'phone': user.phone or '',
                    }
                else:
                    user.save(update_fields=['is_active'])

            if send_welcome:
                _user_pk = welcome_user_id
                _email = welcome_info['email']

                def _on_email_success():
                    try:
                        User.objects.filter(pk=_user_pk).update(welcome_email_sent=True)
                        EmailLog.objects.filter(
                            recipient_email=_email,
                            email_type=EmailLog.EMAIL_TYPE_WELCOME,
                            status=EmailLog.STATUS_ON_HOLD,
                        ).update(status=EmailLog.STATUS_SENT)
                    except Exception as cb_err:
                        logger.warning('Email success callback failed for %s: %s', _email, cb_err)

                def _on_email_failure(err_msg):
                    try:
                        EmailLog.objects.filter(
                            recipient_email=_email,
                            email_type=EmailLog.EMAIL_TYPE_WELCOME,
                            status=EmailLog.STATUS_ON_HOLD,
                        ).update(status=EmailLog.STATUS_FAILED, error_message=str(err_msg))
                    except Exception as cb_err:
                        logger.warning('Email failure callback failed for %s: %s', _email, cb_err)

                send_welcome_email(
                    email=welcome_info['email'],
                    name=welcome_info['full_name'],
                    password=welcome_info['password'],
                    role='admin_staff',
                    phone=welcome_info['phone'],
                    on_success=_on_email_success,
                    on_failure=_on_email_failure,
                )

            status_word = 'activated' if user.is_active else 'deactivated'
            extra = ' Welcome email queued for delivery.' if send_welcome else ''
            return {
                'success': True,
                'message': f'Admin staff "{user.get_full_name()}" {status_word}.{extra}',
                'is_active': user.is_active,
                'data': {
                    'is_active': user.is_active,
                    'name': user.get_full_name() or user.username,
                },
            }

        except Exception as e:
            return _unexpected_error_response('AdminStaffCreationService.toggle_status', e)
    
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
                role='admin_staff',
                phone=getattr(user, 'phone', ''),
                email_variant='temp_password',
            )
            
            return {
                'success': True,
                'message': f'Password reset for "{user.get_full_name()}"',
                'email_sent': success,
            }
            
        except Exception as e:
            return _unexpected_error_response('AdminStaffCreationService.reset_password', e)
    
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
            
            staff_list = list(Staff.objects.filter(
                staff_type='admin_staff'
            ).select_related('user').prefetch_related('assigned_clients'))

            user_ids = [s.user_id for s in staff_list]
            perm_counts_by_user = {}
            if user_ids:
                content_type = ContentType.objects.get_for_model(User)
                perm_counts_by_user = dict(
                    User.objects.filter(id__in=user_ids)
                    .annotate(
                        admin_perm_count=Count(
                            'user_permissions',
                            filter=Q(
                                user_permissions__content_type=content_type,
                                user_permissions__codename__in=ADMIN_STAFF_PERMISSIONS.keys(),
                            ),
                            distinct=True,
                        )
                    )
                    .values_list('id', 'admin_perm_count')
                )
            
            data = []
            for staff in staff_list:
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
                    'permissions_count': perm_counts_by_user.get(staff.user_id, 0),
                    'created_at': staff.created_at.isoformat(),
                })
            
            return {
                'success': True,
                'staff': data,
                'count': len(data),
            }
            
        except Exception as e:
            return _unexpected_error_response('AdminStaffCreationService.list_admin_staff', e)
    
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
            return _unexpected_error_response('AdminStaffCreationService.get_admin_staff_detail', e)


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
    import warnings
    warnings.warn(
        "require_shop_owner is deprecated. "
        "Use 'from core.services.permission_service import require_super_admin' instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    from core.services.permission_service import require_super_admin
    return require_super_admin(view_func)


def require_admin_staff_or_owner(view_func):
    """Deprecated — delegates to require_any_admin from permission_service."""
    import warnings
    warnings.warn(
        "require_admin_staff_or_owner is deprecated. "
        "Use 'from core.services.permission_service import require_any_admin' instead.",
        DeprecationWarning,
        stacklevel=2,
    )
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
