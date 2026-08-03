"""
Staff Service Module
Contains: Staff CRUD operations, serialization
"""
import json
import logging
import secrets
from typing import Dict, Any

from django.shortcuts import get_object_or_404
from django.db import transaction
from django.utils.timezone import localtime

from core.models import User, EmailLog
from staff.models import Staff
from client.models import Client
from idcards.models import IDCardGroup
from core.utils import send_welcome_email
from core.utils.email_utils import generate_secure_password
from core.services.base import BaseService, ServiceResult

from accounts.services import normalize_password_input
logger = logging.getLogger(__name__)


class StaffService(BaseService):
    """
    Service for Staff CRUD operations.
    
    Handles both admin_staff (under super_admin) and client_staff (under clients).
    """
    
    # Permission fields for Staff model (must match Staff model BooleanFields)
    PERMISSION_FIELDS = [
        # ID Card Client List
        'perm_idcard_client_list',
        'perm_manage_client_staff',
        # ID Card Settings
        'perm_idcard_setting_list', 'perm_idcard_setting_add', 
        'perm_idcard_setting_edit', 'perm_idcard_setting_delete', 
        'perm_idcard_setting_status',
        # ID Card Lists
        'perm_idcard_pending_list', 'perm_idcard_verified_list',
        'perm_idcard_pool_list', 'perm_idcard_approved_list',
        'perm_idcard_download_list', 'perm_idcard_reprint_list',
        # Print & Reprint Lists
        'perm_reprint_request_list', 'perm_confirmed_list',
        # ID Card Actions (work in Pending and Verified lists only)
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete',
        'perm_idcard_info', 'perm_idcard_approve', 'perm_idcard_verify',
        'perm_idcard_updated_at',
        'perm_idcard_delete_from_pool',
        'perm_idcard_retrieve',
        # ID Card Bulk Actions (work across all lists)
        'perm_idcard_bulk_upload', 'perm_idcard_bulk_download',
        'perm_idcard_download_image_rename_mode', 'perm_idcard_download_image_generate_mode',
        'perm_idcard_bulk_reupload',
        'perm_idcard_upgrade_all',
        # Mobile App
        'perm_mobile_app',
        # Manage Panel
        'perm_manage_panel_backup', 'perm_manage_panel_email',
    ]
    
    @classmethod
    def serialize(cls, staff: Staff, include_permissions: bool = True) -> Dict[str, Any]:
        """Serialize Staff instance to dict"""
        user = staff.user
        data = {
            'id': staff.id,
            'name': user.get_full_name(),
            'email': cls._public_email(user.email),
            'phone': user.phone or '',
            'address': staff.address or '',
            'department': staff.department or '',
            'designation': staff.designation or '',
            'staff_type': staff.staff_type,
            'status': 'active' if user.is_active else 'inactive',
            'profile_image_url': None,  # Phase 1: profile_image removed - using avatar placeholder
            'created_at': localtime(staff.created_at).strftime('%d-%m-%Y %H:%M'),
            'updated_at': localtime(staff.updated_at).strftime('%d-%m-%Y %H:%M'),
        }
        
        if include_permissions:
            for perm in cls.PERMISSION_FIELDS:
                data[perm] = getattr(staff, perm, False)
        
        # Include assigned client IDs
        data['assigned_client_ids'] = list(
            staff.assigned_clients.values_list('id', flat=True)
        )
        
        return data

    @staticmethod
    def _public_email(email: str) -> str:
        """Hide internal placeholder emails from API payloads."""
        value = (email or '').strip()
        return '' if value.endswith('@noemail.local') else value

    @staticmethod
    def _has_real_email(email: str) -> bool:
        """Return True when the address can be used for outbound delivery."""
        value = (email or '').strip().lower()
        return bool(value and '@' in value and not value.endswith('@noemail.local'))

    @staticmethod
    def _unexpected_error_result(action: str, exc: Exception) -> ServiceResult:
        logger.exception('StaffService.%s failed: %s', action, exc)
        return ServiceResult(success=False, message='An unexpected error occurred. Please try again.')
    
    @classmethod
    def create(
        cls, 
        data: Dict[str, Any], 
        staff_type: str = 'admin_staff',
        client=None,
        request=None, 
        profile_image=None
    ) -> ServiceResult:
        """
        Create a new staff member.
        
        Args:
            data: Dict with staff data
            staff_type: 'admin_staff' or 'client_staff'
            client: Client instance (required for client_staff)
            request: HTTP request (for email context)
            profile_image: Uploaded profile image
        
        Returns:
            ServiceResult with staff data
        """
        try:
            send_welcome = False
            welcome_info = {}
            welcome_user_id = None
            welcome_email_log_id = None
            welcome_email_failed_reason = ''

            name = str(data.get('name') or '').strip()
            if not name:
                return ServiceResult(success=False, message='Name is required')

            raw_email = str(data.get('email') or '').strip().lower()
            email_was_provided = bool(raw_email)

            if raw_email:
                # Check for duplicate email
                if User.objects.filter(email__iexact=raw_email).exists():
                    return ServiceResult(
                        success=False,
                        message='A user with this email already exists'
                    )
                email = raw_email
            else:
                slug = cls.normalize_name(name)[:24] or 'staff'
                email = f'staff.{slug}.{secrets.token_hex(4)}@noemail.local'
                while User.objects.filter(email__iexact=email).exists():
                    email = f'staff.{slug}.{secrets.token_hex(4)}@noemail.local'
            
            # Generate unique username
            username = email.split('@')[0].lower().replace('.', '_')
            if not username:
                username = f'staff_{secrets.token_hex(4)}'
            base_username = username
            counter = 1
            while User.objects.filter(username=username).exists():
                username = f"{base_username}{counter}"
                counter += 1

            name_parts = name.split() if name else []
            
            # Password policy:
            # - if custom password is provided, use it
            # - otherwise phone number is required and used as password
            phone = str(data.get('phone') or '').strip()
            password = str(data.get('password') or '').strip()
            used_phone_as_password = False
            if not password:
                if phone:
                    # Universal password normalization (phone formats -> digits)
                    password = normalize_password_input(phone)
                    if not password:
                        return ServiceResult(success=False, message='Phone number must contain digits to be used as a password')
                    used_phone_as_password = True
                else:
                    return ServiceResult(
                        success=False,
                        message='Phone number is required when custom password is not provided'
                    )
            
            # Skip Django password validators when using phone as password
            # (NumericPasswordValidator would reject a pure-digit mobile number)
            if not used_phone_as_password:
                from django.contrib.auth.password_validation import validate_password
                try:
                    validate_password(password)
                except Exception as pw_err:
                    return ServiceResult(success=False, message=str(pw_err))
            
            # Determine role
            role = 'admin_staff' if staff_type == 'admin_staff' else 'client_staff'
            
            with transaction.atomic():
                # Create user — inactive by default; welcome email sent on first activation
                is_active = cls.parse_bool(data.get('is_active', False))
                user = User.objects.create_user(
                    username=username,
                    email=email,
                    first_name=name_parts[0] if name_parts else '',
                    last_name=' '.join(name_parts[1:]) if len(name_parts) > 1 else '',
                    phone=data.get('phone', ''),
                    role=role,
                    is_active=is_active,
                )
                user.set_password(password)
                
                # Phase 1: profile_image handling removed - using avatar placeholder
                user.save()
                
                # Build staff kwargs
                staff_kwargs = {
                    'user': user,
                    'staff_type': staff_type,
                    'address': data.get('address', ''),
                    'department': data.get('department', ''),
                    'designation': data.get('designation', ''),
                }
                
                # Add client for client_staff
                if staff_type == 'client_staff' and client:
                    staff_kwargs['client'] = client
                
                # Add permissions
                for perm in cls.PERMISSION_FIELDS:
                    if perm in data:
                        staff_kwargs[perm] = cls.parse_bool(data[perm])
                
                # Set default permissions for new client_staff (locked, enabled)
                if staff_type == 'client_staff':
                    # Set defaults for Pending List, Verified List, Pool List if not explicitly provided
                    if 'perm_idcard_pending_list' not in data:
                        staff_kwargs['perm_idcard_pending_list'] = True
                    if 'perm_idcard_verified_list' not in data:
                        staff_kwargs['perm_idcard_verified_list'] = True
                    if 'perm_idcard_pool_list' not in data:
                        staff_kwargs['perm_idcard_pool_list'] = True
                
                # Clamp client_staff permissions to parent client's permissions
                if staff_type == 'client_staff' and client:
                    for perm in cls.PERMISSION_FIELDS:
                        if perm in staff_kwargs and staff_kwargs[perm]:
                            if hasattr(client, perm) and not getattr(client, perm, False):
                                staff_kwargs[perm] = False
                
                staff = Staff.objects.create(**staff_kwargs)
                
                # Assign clients (M2M)
                assigned_client_ids = data.get('assigned_clients', [])
                if assigned_client_ids:
                    if isinstance(assigned_client_ids, str):
                        try:
                            assigned_client_ids = json.loads(assigned_client_ids)
                        except json.JSONDecodeError:
                            assigned_client_ids = []
                    # Accept list of IDs (ints or strings) - allow both active and inactive
                    try:
                        client_ids = [int(cid) for cid in assigned_client_ids if cid]
                        clients = Client.objects.filter(id__in=client_ids)
                        staff.assigned_clients.set(clients)
                    except (ValueError, TypeError):
                        pass  # Skip invalid IDs
                
                # Queue welcome email record whenever a real email is available.
                # Active accounts are sent immediately after commit; inactive
                # accounts remain on-hold until activation flow sends them.
                if email_was_provided and cls._has_real_email(email):
                    log = EmailLog.objects.create(
                        recipient_name=name or user.get_full_name(),
                        recipient_email=email,
                        subject='Welcome to Adarsh Admin - Your Account is Ready!',
                        email_type=EmailLog.EMAIL_TYPE_WELCOME,
                        status=EmailLog.STATUS_ON_HOLD,
                    )
                    welcome_email_log_id = log.pk

                    if is_active:
                        send_welcome = True
                        welcome_user_id = user.pk
                        welcome_info = {
                            'name': name or user.get_full_name(),
                            'email': email,
                            'password': password,
                            'phone': user.phone or '',
                            'role': role,
                        }

            if send_welcome:
                _user_pk = welcome_user_id
                _log_id = welcome_email_log_id
                _email = welcome_info['email']

                def _on_email_success():
                    try:
                        User.objects.filter(pk=_user_pk).update(welcome_email_sent=True)
                        EmailLog.objects.filter(pk=_log_id).update(
                            status=EmailLog.STATUS_SENT,
                            sent_at=localtime(),
                            error_message='',
                        )
                    except Exception as cb_err:
                        logger.warning('Email success callback failed for %s: %s', _email, cb_err)

                def _on_email_failure(err_msg):
                    try:
                        EmailLog.objects.filter(pk=_log_id).update(
                            status=EmailLog.STATUS_FAILED,
                            error_message=str(err_msg),
                        )
                    except Exception as cb_err:
                        logger.warning('Email failure callback failed for %s: %s', _email, cb_err)

                try:
                    queued, queue_message = send_welcome_email(
                        name=welcome_info['name'],
                        email=welcome_info['email'],
                        password=welcome_info['password'],
                        role=welcome_info['role'],
                        phone=welcome_info['phone'],
                        on_success=_on_email_success,
                        on_failure=_on_email_failure,
                    )
                except Exception as email_err:
                    queued = False
                    queue_message = str(email_err)

                if not queued:
                    welcome_email_failed_reason = queue_message or 'Failed to queue welcome email.'
                    _on_email_failure(welcome_email_failed_reason)

            email_sent = bool(send_welcome and not welcome_email_failed_reason)
            
            message = 'Staff created successfully!'
            if is_active:
                if email_sent:
                    message += ' Welcome email queued for delivery.'
                elif email_was_provided and cls._has_real_email(email):
                    message += f' Welcome email could not be sent right now: {welcome_email_failed_reason}'
                elif email_was_provided:
                    message += ' Email format is invalid, so welcome email was skipped.'
                else:
                    message += ' No email provided, so welcome email was skipped.'
            else:
                if email_was_provided and cls._has_real_email(email):
                    message += ' Account is inactive; welcome email is queued and will send when the account is activated.'
                else:
                    message += ' Account is inactive; activate it to allow login with the configured password.'

            return ServiceResult(
                success=True,
                message=message,
                data={
                    'staff': cls.serialize(staff, include_permissions=False),
                    'email_sent': email_sent,
                }
            )
            
        except Exception as e:
            return cls._unexpected_error_result('create', e)
    
    @classmethod
    def get(cls, staff_id: int, include_permissions: bool = True) -> ServiceResult:
        """Get a staff member by ID"""
        try:
            staff = get_object_or_404(Staff, id=staff_id)
            return ServiceResult(
                success=True,
                data={'staff': cls.serialize(staff, include_permissions)}
            )
        except Exception as e:
            return cls._unexpected_error_result('get', e)
    
    @classmethod
    def update(cls, staff_id: int, data: Dict[str, Any], profile_image=None) -> ServiceResult:
        """Update a staff member"""
        try:
            staff = get_object_or_404(Staff, id=staff_id)
            user = staff.user
            assignment_group_ids_to_set = None
            
            # Update user fields
            if data.get('email'):
                new_email = str(data['email'] or '').strip().lower()
                if new_email != user.email.lower():
                    if User.objects.filter(email__iexact=new_email).exclude(id=user.id).exists():
                        return ServiceResult(success=False, message='A user with this email already exists')
                    user.email = new_email
            if data.get('phone'):
                user.phone = data['phone']
            if data.get('name'):
                name_parts = data['name'].split()
                user.first_name = name_parts[0] if name_parts else ''
                user.last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''
            
            # Update password if provided — validate before setting
            password = data.get('password', '')
            if isinstance(password, str) and password.strip():
                # Universal password normalization (phone formats -> digits, text -> intact)
                normalized_password = normalize_password_input(password)
                
                from django.contrib.auth.password_validation import validate_password
                try:
                    validate_password(normalized_password, user=user)
                except Exception as pw_err:
                    return ServiceResult(success=False, message=str(pw_err))
                user.set_password(normalized_password)
            
            # Update status
            if 'is_active' in data:
                user.is_active = cls.parse_bool(data['is_active'])
            
            # Phase 1: profile_image handling removed - using avatar placeholder
            
            user.save()
            
            # Update staff fields
            for field in ['address', 'department', 'designation']:
                if field in data:
                    setattr(staff, field, data[field])
            
            # Update permissions — when ANY perm key is present, set ALL perms
            # (missing keys default to False to prevent stale ON states)
            has_any_perm = any(perm in data for perm in cls.PERMISSION_FIELDS)
            if has_any_perm:
                for perm in cls.PERMISSION_FIELDS:
                    new_val = cls.parse_bool(data[perm]) if perm in data else False
                    setattr(staff, perm, new_val)
            
            # Lock default permissions for client_staff (always on, cannot be disabled)
            if staff.staff_type == 'client_staff':
                staff.perm_idcard_pending_list = True
                staff.perm_idcard_verified_list = True
                staff.perm_idcard_pool_list = True
            
            # Clamp client_staff permissions to parent client's permissions
            if staff.staff_type == 'client_staff' and staff.client:
                for perm in cls.PERMISSION_FIELDS:
                    if getattr(staff, perm, False):
                        if hasattr(staff.client, perm) and not getattr(staff.client, perm, False):
                            setattr(staff, perm, False)

            assignment_keys = (
                'assigned_groups',
                'assigned_group_ids',
                'assigned_table_ids',
                'assignment_id_source',
                'allowed_classes',
                'allowed_sections',
                'allowed_branches',
                'assignment_scopes',
            )
            has_assignment_update = any(key in data for key in assignment_keys)

            # Support client_staff assignment scope updates from admin-side APIs.
            if staff.staff_type == 'client_staff' and staff.client and has_assignment_update:
                from client.services_staff import ClientStaffService

                raw_scope_ids = data.get('assigned_groups')
                if raw_scope_ids is None:
                    raw_scope_ids = data.get('assigned_group_ids')
                if raw_scope_ids is None and 'assigned_table_ids' in data:
                    raw_scope_ids = data.get('assigned_table_ids')

                id_source = data.get('assignment_id_source', 'auto')
                resolved_group_ids, resolved_table_ids = ClientStaffService._resolve_assignment_scope_ids(
                    staff.client,
                    raw_scope_ids,
                    id_source,
                )

                normalized_scopes = None
                if 'assignment_scopes' in data:
                    normalized_scopes = ClientStaffService._normalize_assignment_scopes(
                        staff.client,
                        data.get('assignment_scopes'),
                    )
                    staff.assignment_scopes = normalized_scopes

                    scope_group_ids = sorted({
                        int(scope.get('group_id')) for scope in normalized_scopes
                        if str(scope.get('group_id', '')).strip().isdigit() and int(scope.get('group_id')) > 0
                    })
                    scope_table_ids = sorted({
                        int(scope.get('scope_id')) for scope in normalized_scopes
                        if str(scope.get('scope_type', '')).strip().lower() == 'table'
                        and str(scope.get('scope_id', '')).strip().isdigit()
                        and int(scope.get('scope_id')) > 0
                    })

                    resolved_group_ids = sorted(set(resolved_group_ids) | set(scope_group_ids))
                    resolved_table_ids = sorted(set(resolved_table_ids) | set(scope_table_ids))

                if (
                    'assigned_groups' in data
                    or 'assigned_group_ids' in data
                    or 'assigned_table_ids' in data
                    or 'assignment_scopes' in data
                ):
                    assignment_group_ids_to_set = resolved_group_ids
                    staff.assigned_table_ids = resolved_table_ids

                if normalized_scopes is not None and normalized_scopes:
                    classes, sections, branches = ClientStaffService._scope_value_union(normalized_scopes)
                    staff.allowed_classes = classes
                    staff.allowed_sections = sections
                    staff.allowed_branches = branches
                else:
                    if 'allowed_classes' in data:
                        staff.allowed_classes = ClientStaffService._normalize_scope_value_list(data.get('allowed_classes'))
                    elif 'assignment_scopes' in data:
                        staff.allowed_classes = []

                    if 'allowed_sections' in data:
                        staff.allowed_sections = ClientStaffService._normalize_scope_value_list(data.get('allowed_sections'))
                    elif 'assignment_scopes' in data:
                        staff.allowed_sections = []

                    if 'allowed_branches' in data:
                        staff.allowed_branches = ClientStaffService._normalize_scope_value_list(data.get('allowed_branches'))
                    elif 'assignment_scopes' in data:
                        staff.allowed_branches = []
            
            staff.save()

            if assignment_group_ids_to_set is not None:
                groups = IDCardGroup.objects.filter(client=staff.client, id__in=assignment_group_ids_to_set)
                staff.assigned_groups.set(groups)
            
            # Update assigned clients (M2M)
            if 'assigned_clients' in data:
                assigned_client_ids = data['assigned_clients']
                if assigned_client_ids is None or assigned_client_ids == '':
                    staff.assigned_clients.clear()
                else:
                    try:
                        if isinstance(assigned_client_ids, str):
                            assigned_client_ids = json.loads(assigned_client_ids) if assigned_client_ids else []
                        client_ids = [int(cid) for cid in assigned_client_ids if cid]
                        # Allow both active and inactive clients to be assigned
                        clients = Client.objects.filter(id__in=client_ids)
                        staff.assigned_clients.set(clients)
                    except (ValueError, TypeError, json.JSONDecodeError):
                        pass  # Skip invalid IDs
            
            return ServiceResult(
                success=True,
                message='Staff updated successfully!',
                data={'staff': cls.serialize(staff, include_permissions=False)}
            )
            
        except Exception as e:
            return cls._unexpected_error_result('update', e)
    
    @classmethod
    def delete(cls, staff_id: int) -> ServiceResult:
        """Delete a staff member and associated user"""
        try:
            staff = get_object_or_404(Staff, id=staff_id)
            user = staff.user
            staff_name = user.get_full_name()
            
            # Phase 1: profile_image cleanup removed - using avatar placeholder
            
            with transaction.atomic():
                staff.delete()
                user.delete()
            
            return ServiceResult(
                success=True,
                message=f'Staff "{staff_name}" deleted successfully!'
            )
        except Exception as e:
            return cls._unexpected_error_result('delete', e)
    
    @classmethod
    def toggle_status(cls, staff_id: int) -> ServiceResult:
        """Toggle staff active/inactive status (atomic to prevent lost toggles).
        On first activation, generates/sends credentials only when no known password
        was provided at creation time.
        """
        try:
            send_welcome = False
            welcome_info = {}
            welcome_user_id = None

            with transaction.atomic():
                staff = Staff.objects.select_related('user').select_for_update().get(id=staff_id)
                user = staff.user
                has_pending_welcome = EmailLog.objects.filter(
                    recipient_email=user.email,
                    email_type=EmailLog.EMAIL_TYPE_WELCOME,
                    status=EmailLog.STATUS_ON_HOLD,
                ).exists()
                is_first_activation = (
                    (not user.is_active)
                    and has_pending_welcome
                    and not bool(user.welcome_email_sent)
                )
                user.is_active = not user.is_active
                status = 'active' if user.is_active else 'inactive'
                status_display = 'Active' if user.is_active else 'Inactive'

                if user.is_active and is_first_activation:
                    phone_value = (user.phone or '').strip()
                    
                    # Universal normalization for checking/setting phone passwords
                    normalized_phone_pw = normalize_password_input(phone_value)
                    
                    has_usable_password = bool(user.has_usable_password())
                    
                    # Resilient check: does current password match phone (raw or normalized digits)?
                    can_reuse_phone_password = (
                        has_usable_password and bool(phone_value) and (
                            user.check_password(phone_value) or 
                            user.check_password(normalized_phone_pw)
                        )
                    )

                    credential_password = ''
                    if can_reuse_phone_password:
                        # Use normalized phone digits as the standard password format
                        credential_password = normalized_phone_pw
                        # If it matched but wasn't exactly standard, update it
                        if not user.check_password(credential_password):
                            user.set_password(credential_password)
                        user.save(update_fields=['is_active', 'password'])
                    elif has_usable_password:
                        # Password was already configured by admin; preserve it.
                        credential_password = 'Use the password configured by your administrator.'
                        user.save(update_fields=['is_active'])
                    elif normalized_phone_pw:
                        # Default to normalized digits for phone-based passwords
                        user.set_password(normalized_phone_pw)
                        credential_password = normalized_phone_pw
                        user.save(update_fields=['is_active', 'password'])
                    elif phone_value:
                        # Fallback for weird phone numbers without digits
                        user.set_password(phone_value)
                        credential_password = phone_value
                        user.save(update_fields=['is_active', 'password'])
                    else:
                        first_password = generate_secure_password()
                        user.set_password(first_password)
                        credential_password = first_password
                        user.save(update_fields=['is_active', 'password'])

                    send_welcome = True
                    welcome_user_id = user.pk
                    welcome_info = {
                        'name': user.get_full_name(),
                        'email': user.email,
                        'password': credential_password,
                        'phone': user.phone or '',
                        'role': staff.staff_type,
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
                    name=welcome_info['name'],
                    email=welcome_info['email'],
                    password=welcome_info['password'],
                    role=welcome_info['role'],
                    phone=welcome_info['phone'],
                    on_success=_on_email_success,
                    on_failure=_on_email_failure,
                )

            extra = ' Welcome email queued for delivery.' if send_welcome else ''
            return ServiceResult(
                success=True,
                message=f'Staff status changed to {status_display}!{extra}',
                data={'status': status, 'status_display': status_display}
            )
        except Staff.DoesNotExist:
            return ServiceResult(success=False, message='Staff not found')
        except Exception as e:
            return cls._unexpected_error_result('toggle_status', e)
    
    @classmethod
    def list_admin_staff(cls) -> ServiceResult:
        """List all admin staff members"""
        try:
            queryset = Staff.objects.filter(staff_type='admin_staff').select_related('user').prefetch_related('assigned_clients')
            staff_list = [cls.serialize(s, include_permissions=False) for s in queryset]
            return ServiceResult(
                success=True,
                data={'staff': staff_list, 'total': len(staff_list)}
            )
        except Exception as e:
            return cls._unexpected_error_result('list_admin_staff', e)
    
    @classmethod
    def list_client_staff(cls, client_id: int) -> ServiceResult:
        """List all staff members for a specific client"""
        try:
            queryset = Staff.objects.filter(
                staff_type='client_staff', 
                client_id=client_id
            ).select_related('user')
            
            staff_list = [cls.serialize(s, include_permissions=False) for s in queryset]
            return ServiceResult(
                success=True,
                data={'staff': staff_list, 'total': len(staff_list)}
            )
        except Exception as e:
            return cls._unexpected_error_result('list_client_staff', e)

    @classmethod
    def set_temp_password(cls, staff_id: int, new_password: str, request=None) -> ServiceResult:
        """
        Set a temporary password for a staff user.
        Sends a welcome email with the new credentials so the user knows their password.
        """
        try:
            staff = Staff.objects.filter(id=staff_id).select_related('user').first()
            if not staff:
                return ServiceResult(success=False, message='Staff not found')

            user = staff.user

            if not new_password or not new_password.strip():
                return ServiceResult(success=False, message='Password cannot be empty')

            # Universal password normalization (phone formats -> digits, text -> intact)
            normalized_password = normalize_password_input(new_password)

            user.set_password(normalized_password)
            user.save(update_fields=['password'])

            # Send welcome email with the new temporary password
            email_sent = False
            try:
                email_sent, _ = send_welcome_email(
                    name=user.get_full_name(),
                    email=user.email,
                    password=new_password,
                    role=staff.staff_type,
                    phone=user.phone or '',
                    request=request,
                    email_variant='temp_password',
                )
                EmailLog.objects.create(
                    recipient_name=user.get_full_name(),
                    recipient_email=user.email,
                    subject='Your Temporary Password — Adarsh Admin',
                    email_type=EmailLog.EMAIL_TYPE_TEMP_PASSWORD,
                    status=EmailLog.STATUS_SENT if email_sent else EmailLog.STATUS_FAILED,
                )
            except Exception as e:
                logger.warning('Temp password email failed for %s: %s', user.email, e)

            return ServiceResult(
                success=True,
                message=f'Temporary password set for "{user.get_full_name()}"',
                data={'email_sent': email_sent}
            )
        except Exception as e:
            return cls._unexpected_error_result('set_temp_password', e)