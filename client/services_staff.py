"""
Client Staff Service — CRUD operations for client-managed staff members.
"""
from typing import Dict, Any, Optional, List, Tuple
import os
import secrets

from django.db import transaction

from core.models import User
from client.models import Client
from staff.models import Staff
from idcards.models import IDCardGroup, IDCardTable, IDCard
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
        'perm_idcard_download_list',
        'perm_reprint_request_list', 'perm_confirmed_list',
        # ── Export / Download ───────────────────────────────────────
        'perm_idcard_bulk_download',
        # ── Card Actions ──────────────────────────────────────────────
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete',
        'perm_idcard_info', 'perm_idcard_verify',
        'perm_idcard_reprint_list',
        'perm_idcard_updated_at',
        # ── App & Access ───────────────────────────────────────────
        'perm_mobile_app',
    ]

    # Sensitive permissions that client_staff must never hold.
    NON_DELEGABLE_CLIENT_STAFF_PERMS = [
        'perm_idcard_approve',
        'perm_idcard_delete_from_pool',
    ]

    @staticmethod
    def _public_email(email: str) -> str:
        """Hide internal placeholder emails from API payloads."""
        value = (email or '').strip()
        return '' if value.endswith('@noemail.local') else value

    @staticmethod
    def _resolve_assignment_scope_ids(
        client: Client,
        raw_ids: Any,
        id_source: str = 'auto',
    ) -> Tuple[List[int], List[int]]:
        """Normalize assignment IDs into valid group IDs and table IDs.

        ``id_source`` controls interpretation of ``raw_ids``:
        - ``group``: IDs are group IDs
        - ``table``: IDs are table IDs
        - ``auto``: follows client assignment mode (single group => table mode)
        """
        if not isinstance(raw_ids, list):
            return [], []

        normalized_ids = sorted({
            int(v) for v in raw_ids
            if not isinstance(v, bool) and str(v).strip().isdigit() and int(v) > 0
        })
        if not normalized_ids:
            return [], []

        source = str(id_source or '').strip().lower()
        if source not in ('group', 'table', 'auto'):
            source = 'auto'

        if source == 'auto':
            group_count = IDCardGroup.objects.filter(client=client).count()
            source = 'table' if group_count <= 1 else 'group'

        valid_group_ids = set(
            IDCardGroup.objects.filter(client=client, id__in=normalized_ids)
            .values_list('id', flat=True)
        )

        if source == 'group':
            return sorted(valid_group_ids), []

        valid_table_ids = set(
            IDCardTable.objects.filter(
                group__client=client,
                deleted_by_client=False,
                id__in=normalized_ids,
            ).values_list('id', flat=True)
        )

        if valid_table_ids:
            table_group_ids = IDCardTable.objects.filter(
                id__in=valid_table_ids,
            ).values_list('group_id', flat=True)
            valid_group_ids.update(table_group_ids)
            return sorted(valid_group_ids), sorted(valid_table_ids)

        # Backward-compatible fallback: keep group assignments even when
        # table mode was inferred but table IDs are not present in payload.
        return sorted(valid_group_ids), []
    
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
                    'email': cls._public_email(staff.user.email),
                    'phone': staff.user.phone or '',
                    'department': staff.department or '',
                    'designation': staff.designation or '',
                    'is_active': staff.user.is_active,
                    'created_at': staff.created_at.strftime('%d %b %Y'),
                    'assigned_group_ids': list(staff.assigned_groups.values_list('id', flat=True)),
                    'assigned_table_ids': [
                        int(v) for v in (staff.assigned_table_ids or [])
                        if str(v).strip().isdigit() and int(v) > 0
                    ],
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
                'email': cls._public_email(staff.user.email),
                'phone': staff.user.phone or '',
                'department': staff.department or '',
                'designation': staff.designation or '',
                'address': staff.address or '',
                'is_active': staff.user.is_active,
                'status': 'active' if staff.user.is_active else 'inactive',
                'created_at': staff.created_at.strftime('%Y-%m-%dT%H:%M:%S'),
                'profile_image_url': None,  # profile_image removed in Phase 1 refactor
                'assigned_group_ids': list(staff.assigned_groups.values_list('id', flat=True)),
                'assigned_table_ids': [
                    int(v) for v in (staff.assigned_table_ids or [])
                    if str(v).strip().isdigit() and int(v) > 0
                ],
                'allowed_classes': staff.allowed_classes or [],
                'allowed_sections': staff.allowed_sections or [],
                'allowed_branches': staff.allowed_branches or [],
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

            # Parse name - handle both formats: {name} or {first_name, last_name}
            first_name = data.get('first_name', '').strip()
            last_name = data.get('last_name', '').strip()
            if not first_name:
                # Fallback to parsing 'name' field
                name = data.get('name', '').strip()
                name_parts = name.split() if name else []
                first_name = name_parts[0] if name_parts else ''
                last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''

            display_name = f'{first_name} {last_name}'.strip()
            if not display_name:
                return ServiceResult(success=False, message='Name is required')

            raw_email = data.get('email', '').strip().lower()
            if raw_email:
                # Check for duplicate email
                if User.objects.filter(email__iexact=raw_email).exists():
                    return ServiceResult(
                        success=False,
                        message='A user with this email already exists'
                    )
                email = raw_email
            else:
                slug = cls.normalize_name(display_name)[:24] or 'cstaff'
                email = f'cstaff.{slug}.{secrets.token_hex(4)}@noemail.local'
                while User.objects.filter(email__iexact=email).exists():
                    email = f'cstaff.{slug}.{secrets.token_hex(4)}@noemail.local'

            # Generate username
            username = email.split('@')[0].lower().replace('.', '_')
            if not username:
                username = f'cstaff_{secrets.token_hex(4)}'
            base_username = username
            counter = 1
            while User.objects.filter(username=username).exists():
                username = f"{base_username}{counter}"
                counter += 1
            
            # Password policy:
            # - if custom password is provided, use it
            # - otherwise phone number is required and used as password
            phone = data.get('phone', '').strip()
            password = data.get('password', '').strip()
            used_phone_as_password = False
            if not password:
                if phone:
                    password = phone
                    used_phone_as_password = True
                else:
                    return ServiceResult(
                        success=False,
                        message='Phone number is required when custom password is not provided'
                    )
            
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
                    is_active=cls.parse_bool(data.get('is_active', True)),
                )
                
                # Build staff kwargs
                staff_kwargs = {
                    'user': staff_user,
                    'staff_type': 'client_staff',
                    'client': client,
                    'department': data.get('department', ''),
                    'designation': data.get('designation', ''),
                    'address': data.get('address', ''),
                    'allowed_classes': [
                        str(v).strip() for v in (data.get('allowed_classes') or [])
                        if isinstance(v, str) and str(v).strip()
                    ] if isinstance(data.get('allowed_classes', []), list) else [],
                    'allowed_sections': [
                        str(v).strip() for v in (data.get('allowed_sections') or [])
                        if isinstance(v, str) and str(v).strip()
                    ] if isinstance(data.get('allowed_sections', []), list) else [],
                    'allowed_branches': [
                        str(v).strip() for v in (data.get('allowed_branches') or [])
                        if isinstance(v, str) and str(v).strip()
                    ] if isinstance(data.get('allowed_branches', []), list) else [],
                }
                
                # Add permissions (only those the client themselves has)
                for perm in cls.STAFF_PERMISSION_FIELDS:
                    if perm in data:
                        # Server-side enforcement: client can only grant perms they have
                        if getattr(client, perm, False):
                            staff_kwargs[perm] = cls.parse_bool(data[perm])
                        else:
                            staff_kwargs[perm] = False

                # Sensitive perms are never delegable to client_staff.
                for perm in cls.NON_DELEGABLE_CLIENT_STAFF_PERMS:
                    staff_kwargs[perm] = False
                
                staff = Staff.objects.create(**staff_kwargs)
                
                # Assign groups if provided
                assigned_groups = data.get('assigned_groups', [])
                if assigned_groups:
                    resolved_group_ids, resolved_table_ids = cls._resolve_assignment_scope_ids(
                        client,
                        assigned_groups,
                        data.get('assignment_id_source', 'auto'),
                    )
                    valid_groups = IDCardGroup.objects.filter(
                        id__in=resolved_group_ids,
                        client=client,
                    )
                    staff.assigned_groups.set(valid_groups)
                    staff.assigned_table_ids = resolved_table_ids
                    staff.save(update_fields=['assigned_table_ids'])
            
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
            
            with transaction.atomic():
                # Get staff and verify ownership (row-lock for consistency)
                try:
                    staff = (
                        Staff.objects
                        .select_for_update()
                        .select_related('user')
                        .get(id=staff_id, client=client, staff_type='client_staff')
                    )
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

                # Sensitive perms are never delegable to client_staff.
                for perm in cls.NON_DELEGABLE_CLIENT_STAFF_PERMS:
                    setattr(staff, perm, False)

                # Update class/section filters if provided
                if 'allowed_classes' in data:
                    allowed_classes = data['allowed_classes']
                    if isinstance(allowed_classes, list):
                        staff.allowed_classes = [str(v).strip() for v in allowed_classes if isinstance(v, str)]
                if 'allowed_sections' in data:
                    allowed_sections = data['allowed_sections']
                    if isinstance(allowed_sections, list):
                        staff.allowed_sections = [str(v).strip() for v in allowed_sections if isinstance(v, str)]
                if 'allowed_branches' in data:
                    allowed_branches = data['allowed_branches']
                    if isinstance(allowed_branches, list):
                        staff.allowed_branches = [str(v).strip() for v in allowed_branches if isinstance(v, str)]

                staff.save()

                # Update group assignments if provided
                if 'assigned_groups' in data:
                    resolved_group_ids, resolved_table_ids = cls._resolve_assignment_scope_ids(
                        client,
                        data.get('assigned_groups', []),
                        data.get('assignment_id_source', 'auto'),
                    )
                    valid_groups = IDCardGroup.objects.filter(
                        id__in=resolved_group_ids,
                        client=client,
                    )
                    staff.assigned_groups.set(valid_groups)
                    staff.assigned_table_ids = resolved_table_ids
                    staff.save(update_fields=['assigned_table_ids'])
            
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

    @classmethod
    def set_temp_password(cls, user, staff_id: int, new_password: str, request=None) -> ServiceResult:
        """Set temporary password for a client-owned staff account."""
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')

            if not PermissionService.has_permission(user, 'perm_set_temp_password'):
                return ServiceResult(success=False, message='Permission denied')

            staff = Staff.objects.filter(
                id=staff_id,
                client=client,
                staff_type='client_staff',
            ).first()
            if not staff:
                return ServiceResult(success=False, message='Staff not found')

            from core.services import StaffService

            return StaffService.set_temp_password(staff.id, new_password, request=request)

        except Exception as e:
            return ServiceResult(success=False, message=str(e))
