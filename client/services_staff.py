"""
Client Staff Service — CRUD operations for client-managed staff members.
"""
from typing import Dict, Any, Optional, List
import os

from django.db import transaction

from core.models import Client, Staff, User, IDCardGroup, IDCardTable, IDCard
from core.services.base import BaseService, ServiceResult
from core.services.permission_service import PermissionService

from .services_access import ClientAccessService


class ClientStaffService(BaseService):
    """
    Service for client staff management.
    Only Client Admin (role='client') can manage staff.
    """
    
    # All permission fields that clients can delegate to their staff.
    # Must match the Client model fields AND exist on the Staff model.
    # Groups: ID Card List Tabs | Card Actions | Bulk Actions | App
    STAFF_PERMISSION_FIELDS = [
        # ── ID Card List Tabs ────────────────────────────────────────
        'perm_idcard_pending_list', 'perm_idcard_verified_list',
        'perm_idcard_pool_list', 'perm_idcard_approved_list',
        'perm_idcard_download_list', 'perm_idcard_reprint_list',
        # ── Card Actions ──────────────────────────────────────────────
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete',
        'perm_idcard_info', 'perm_idcard_approve', 'perm_idcard_verify',
        'perm_idcard_created_at', 'perm_idcard_updated_at',
        'perm_idcard_delete_from_pool', 'perm_reupload_idcard_image',
        'perm_idcard_retrieve',
        # ── Bulk Actions ────────────────────────────────────────────
        'perm_idcard_bulk_upload', 'perm_idcard_bulk_download',
        'perm_idcard_bulk_reupload', 'perm_idcard_upgrade_all',
        # ── App & Access ───────────────────────────────────────────
        'perm_mobile_app',
    ]
    
    @classmethod
    def can_manage_staff(cls, user) -> bool:
        """
        Check if user can manage client staff.
        Delegates to PermissionService.has() (single authority).
        """
        if not PermissionService.is_client(user):
            return False
        
        return PermissionService.has(user, 'perm_idcard_client_list')
    
    @classmethod
    def list_staff(cls, user) -> ServiceResult:
        """
        List all staff members for the client.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Check permission
            if not PermissionService.has_permission(user, 'perm_idcard_client_list'):
                return ServiceResult(success=False, message='Permission denied')
            
            staff_list = Staff.objects.filter(
                client=client,
                staff_type='client_staff'
            ).select_related('user').prefetch_related('assigned_groups')
            
            staff_data = []
            for staff in staff_list:
                item = {
                    'id': staff.id,
                    'name': staff.user.get_full_name() or staff.user.username,
                    'email': staff.user.email,
                    'phone': staff.user.phone or '',
                    'department': staff.department or '',
                    'designation': staff.designation or '',
                    'is_active': staff.user.is_active,
                    'created_at': staff.created_at.strftime('%d %b %Y'),
                    'assigned_group_ids': list(staff.assigned_groups.values_list('id', flat=True)),
                    'allowed_classes': staff.allowed_classes or [],
                    'allowed_sections': staff.allowed_sections or [],
                }
                # Include all permissions
                for perm in cls.STAFF_PERMISSION_FIELDS:
                    item[perm] = getattr(staff, perm, False)
                staff_data.append(item)
            
            # Also include which permissions the client can grant
            client_permissions = {
                perm: getattr(client, perm, False)
                for perm in cls.STAFF_PERMISSION_FIELDS
            }
            
            return ServiceResult(success=True, data={
                'staff': staff_data,
                'client_permissions': client_permissions
            })
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def get_staff_detail(cls, user, staff_id: int) -> ServiceResult:
        """
        Get details of a specific staff member.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Get staff and verify ownership
            try:
                staff = Staff.objects.select_related('user').prefetch_related('assigned_groups').get(
                    id=staff_id, 
                    client=client, 
                    staff_type='client_staff'
                )
            except Staff.DoesNotExist:
                return ServiceResult(success=False, message='Staff not found')
            
            # Include which permissions the client can grant
            client_permissions = {
                perm: getattr(client, perm, False)
                for perm in cls.STAFF_PERMISSION_FIELDS
            }
            
            detail = {
                'id': staff.id,
                'first_name': staff.user.first_name,
                'last_name': staff.user.last_name,
                'name': staff.user.get_full_name() or staff.user.username,
                'email': staff.user.email,
                'phone': staff.user.phone or '',
                'department': staff.department or '',
                'designation': staff.designation or '',
                'address': staff.address or '',
                'is_active': staff.user.is_active,
                'status': 'active' if staff.user.is_active else 'inactive',
                'created_at': staff.created_at.strftime('%Y-%m-%dT%H:%M:%S'),
                'profile_image_url': staff.user.profile_image.url if staff.user.profile_image else None,
                'assigned_group_ids': list(staff.assigned_groups.values_list('id', flat=True)),
                'allowed_classes': staff.allowed_classes or [],
                'allowed_sections': staff.allowed_sections or [],
                'client_permissions': client_permissions,
            }
            # Include all permissions
            for perm in cls.STAFF_PERMISSION_FIELDS:
                detail[perm] = getattr(staff, perm, False)
            
            return ServiceResult(success=True, data=detail)
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def create_staff(cls, user, data: Dict[str, Any]) -> ServiceResult:
        """
        Create a new client staff member.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Check permission
            if not PermissionService.has_permission(user, 'perm_idcard_client_list'):
                return ServiceResult(success=False, message='Permission denied')
            
            email = data.get('email', '').strip().lower()
            if not email:
                return ServiceResult(success=False, message='Email is required')
            
            # Check for duplicate email
            if User.objects.filter(email__iexact=email).exists():
                return ServiceResult(
                    success=False,
                    message='A user with this email already exists'
                )
            
            # Generate username
            username = email.split('@')[0].lower().replace('.', '_')
            base_username = username
            counter = 1
            while User.objects.filter(username=username).exists():
                username = f"{base_username}{counter}"
                counter += 1
            
            # Parse name - handle both formats: {name} or {first_name, last_name}
            first_name = data.get('first_name', '').strip()
            last_name = data.get('last_name', '').strip()
            if not first_name:
                # Fallback to parsing 'name' field
                name = data.get('name', '').strip()
                name_parts = name.split() if name else []
                first_name = name_parts[0] if name_parts else ''
                last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''
            
            # Default password strategy: phone number → random token
            # SECURITY NOTE: Phone-as-password is a deliberate UX choice — the welcome
            # email tells users "use your mobile number". When a stronger policy is
            # desired, always pass an explicit password from the UI instead.
            import secrets as _secrets
            phone = data.get('phone', '').strip()
            password = data.get('password', '').strip()
            used_phone_as_password = False
            if not password:
                if phone:
                    password = phone
                    used_phone_as_password = True
                else:
                    password = _secrets.token_urlsafe(12)
            
            # Skip Django password validators when using phone as password
            if not used_phone_as_password:
                from django.contrib.auth.password_validation import validate_password
                try:
                    validate_password(password)
                except Exception as pw_err:
                    return ServiceResult(success=False, message=str(pw_err))
            
            with transaction.atomic():
                # Create user
                staff_user = User.objects.create_user(
                    username=username,
                    email=email,
                    password=password,
                    first_name=first_name,
                    last_name=last_name,
                    phone=phone,
                    role='client_staff',
                    is_active=data.get('is_active', True),
                )
                
                # Build staff kwargs
                staff_kwargs = {
                    'user': staff_user,
                    'staff_type': 'client_staff',
                    'client': client,
                    'department': data.get('department', ''),
                    'designation': data.get('designation', ''),
                    'address': data.get('address', ''),
                }
                
                # Add permissions (only those the client themselves has)
                for perm in cls.STAFF_PERMISSION_FIELDS:
                    if perm in data:
                        # Server-side enforcement: client can only grant perms they have
                        if getattr(client, perm, False):
                            staff_kwargs[perm] = cls.parse_bool(data[perm])
                        else:
                            staff_kwargs[perm] = False
                
                staff = Staff.objects.create(**staff_kwargs)
                
                # Assign groups if provided
                assigned_groups = data.get('assigned_groups', [])
                if assigned_groups:
                    from workflows.models import IDCardGroup
                    valid_groups = IDCardGroup.objects.filter(
                        id__in=assigned_groups, client=client
                    )
                    staff.assigned_groups.set(valid_groups)
            
            display_name = f'{first_name} {last_name}'.strip() or email
            return ServiceResult(
                success=True,
                message=f'Staff member "{display_name}" created successfully!',
                data={'staff_id': staff.id}
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def update_staff(cls, user, staff_id: int, data: Dict[str, Any]) -> ServiceResult:
        """
        Update a client staff member.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Check permission
            if not PermissionService.has_permission(user, 'perm_idcard_client_list'):
                return ServiceResult(success=False, message='Permission denied')
            
            # Get staff and verify ownership
            try:
                staff = Staff.objects.get(id=staff_id, client=client, staff_type='client_staff')
            except Staff.DoesNotExist:
                return ServiceResult(success=False, message='Staff not found')
            
            staff_user = staff.user
            
            # Update user fields - handle both name formats
            if 'first_name' in data:
                staff_user.first_name = data['first_name'].strip()
            if 'last_name' in data:
                staff_user.last_name = data['last_name'].strip()
            
            # Also handle combined 'name' field
            name = data.get('name', '').strip()
            if name and 'first_name' not in data:
                name_parts = name.split()
                staff_user.first_name = name_parts[0] if name_parts else ''
                staff_user.last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''
            
            if 'phone' in data:
                staff_user.phone = data['phone']
            
            if 'is_active' in data:
                staff_user.is_active = cls.parse_bool(data['is_active'])
            
            staff_user.save()
            
            # Update staff fields
            if 'department' in data:
                staff.department = data['department']
            if 'designation' in data:
                staff.designation = data['designation']
            if 'address' in data:
                staff.address = data['address']
            
            # Update permissions (only those the client themselves has)
            for perm in cls.STAFF_PERMISSION_FIELDS:
                if perm in data:
                    # Server-side enforcement: client can only grant perms they have
                    if getattr(client, perm, False):
                        setattr(staff, perm, cls.parse_bool(data[perm]))
                    else:
                        setattr(staff, perm, False)
            
            staff.save()
            
            # Update class/section filters if provided
            if 'allowed_classes' in data:
                allowed_classes = data['allowed_classes']
                if isinstance(allowed_classes, list):
                    staff.allowed_classes = [str(v).strip() for v in allowed_classes if isinstance(v, str)]
            if 'allowed_sections' in data:
                allowed_sections = data['allowed_sections']
                if isinstance(allowed_sections, list):
                    staff.allowed_sections = [str(v).strip() for v in allowed_sections if isinstance(v, str)]
            staff.save()
            
            # Update group assignments if provided
            if 'assigned_groups' in data:
                from workflows.models import IDCardGroup
                group_ids = data['assigned_groups']
                if isinstance(group_ids, list):
                    valid_groups = IDCardGroup.objects.filter(
                        id__in=group_ids, client=client
                    )
                    staff.assigned_groups.set(valid_groups)
            
            return ServiceResult(
                success=True,
                message='Staff updated successfully!'
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def toggle_staff_status(cls, user, staff_id: int) -> ServiceResult:
        """
        Toggle staff active/inactive status.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Check permission
            if not PermissionService.has_permission(user, 'perm_idcard_client_list'):
                return ServiceResult(success=False, message='Permission denied')
            
            with transaction.atomic():
                staff = Staff.objects.select_for_update().get(id=staff_id, client=client, staff_type='client_staff')
                staff_user = staff.user
                staff_user.is_active = not staff_user.is_active
                staff_user.save(update_fields=['is_active'])
            
            status = 'active' if staff_user.is_active else 'inactive'
            
            return ServiceResult(
                success=True,
                message=f'Staff status changed to {status}!',
                data={'is_active': staff_user.is_active}
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def delete_staff(cls, user, staff_id: int) -> ServiceResult:
        """
        Delete a client staff member.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Check permission
            if not PermissionService.has_permission(user, 'perm_idcard_client_list'):
                return ServiceResult(success=False, message='Permission denied')
            
            # Get staff and verify ownership
            try:
                staff = Staff.objects.get(id=staff_id, client=client, staff_type='client_staff')
            except Staff.DoesNotExist:
                return ServiceResult(success=False, message='Staff not found')
            
            staff_name = staff.user.get_full_name() or staff.user.username
            staff_user = staff.user
            
            # Clean up profile image file before deleting
            if staff_user.profile_image:
                try:
                    staff_user.profile_image.delete(save=False)
                except Exception:
                    pass
            
            # Delete staff profile and user atomically
            with transaction.atomic():
                staff.delete()
                staff_user.delete()
            
            return ServiceResult(
                success=True,
                message=f'Staff "{staff_name}" deleted successfully!'
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
