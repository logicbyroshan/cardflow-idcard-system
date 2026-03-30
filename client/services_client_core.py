"""
Client Service Module
Contains: Client CRUD operations, serialization
"""
import secrets
from typing import Dict, Any, Optional, List

from django.shortcuts import get_object_or_404
from django.db import transaction
from django.utils.timezone import localtime

from core.models import User, EmailLog
from client.models import Client
from staff.models import Staff
from core.utils import send_welcome_email
from core.utils.email_utils import generate_secure_password
from core.services.base import BaseService, ServiceResult

import logging
logger = logging.getLogger(__name__)


class ClientService(BaseService):
    """
    Service for Client CRUD operations.
    
    Usage:
        # Create
        result = ClientService.create(data, request)
        if result.success:
            client_dict = result.data['client']
        
        # Get
        result = ClientService.get(client_id)
        
        # Update
        result = ClientService.update(client_id, data)
        
        # Delete
        result = ClientService.delete(client_id)
    """
    
    # All permission field names for Client model
    PERMISSION_FIELDS = [
        # ID Card Client List
        'perm_idcard_client_list',
        # ID Card Setting Permissions
        'perm_idcard_setting_list', 'perm_idcard_setting_add', 
        'perm_idcard_setting_edit', 'perm_idcard_setting_delete', 
        'perm_idcard_setting_status',
        # ID Card List Permissions
        'perm_idcard_pending_list', 'perm_idcard_verified_list', 
        'perm_idcard_pool_list', 'perm_idcard_approved_list', 
        'perm_idcard_download_list', 'perm_reprint_request_list',
        'perm_confirmed_list',
        # ID Card Action Permissions (work in Pending and Verified lists only)
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete',
        'perm_idcard_info', 'perm_idcard_approve', 'perm_idcard_verify',
        'perm_idcard_reprint_list',
        'perm_idcard_updated_at',
        'perm_idcard_delete_from_pool',
        'perm_idcard_retrieve',
        # ID Card Bulk Action Permissions (work across all lists)
        'perm_idcard_bulk_upload', 'perm_idcard_bulk_download',
        'perm_delete_all_idcard',
        'perm_idcard_upgrade_all',
        # Mobile App
        'perm_mobile_app',
        # Account Security
        'perm_set_temp_password',
    ]
    
    @classmethod
    def serialize(cls, client: Client, include_permissions: bool = True) -> Dict[str, Any]:
        """Serialize Client instance to dict"""
        data = {
            'id': client.id,
            'name': client.name,
            'email': cls._public_email(client.user.email),
            'phone': client.user.phone or '',
            'address': client.address or '',
            'city': client.city or '',
            'state': client.state or '',
            'pincode': client.pincode or '',
            'status': client.status,
            'photo_url': None,  # Phase 1: Photo field removed - using avatar placeholder
            'created_at': localtime(client.created_at).strftime('%d-%m-%Y %H:%M'),
            'updated_at': localtime(client.updated_at).strftime('%d-%m-%Y %H:%M'),
        }
        
        if include_permissions:
            for perm in cls.PERMISSION_FIELDS:
                data[perm] = getattr(client, perm, False)
        
        return data

    @staticmethod
    def _public_email(email: str) -> str:
        """Hide internal placeholder emails from API payloads."""
        value = (email or '').strip()
        return '' if value.endswith('@noemail.local') else value
    
    @classmethod
    def create(cls, data: Dict[str, Any], request=None, photo=None) -> ServiceResult:
        """
        Create a new client with associated user account.
        
        Args:
            data: Dict with client data (name, email, phone, address, etc.)
            request: HTTP request (for email context)
            photo: Uploaded photo file
        
        Returns:
            ServiceResult with client data
        """
        try:
            name = data.get('name', '').strip()
            if not name:
                return ServiceResult(success=False, message='Name is required')

            raw_email = data.get('email', '').strip().lower()
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
                slug = cls.normalize_name(name)[:24] or 'client'
                email = f'client.{slug}.{secrets.token_hex(4)}@noemail.local'
                while User.objects.filter(email__iexact=email).exists():
                    email = f'client.{slug}.{secrets.token_hex(4)}@noemail.local'
            
            # Generate unique username
            username = email.split('@')[0].lower().replace('.', '_')
            if not username:
                username = f'client_{secrets.token_hex(4)}'
            base_username = username
            counter = 1
            while User.objects.filter(username=username).exists():
                username = f"{base_username}{counter}"
                counter += 1

            name_parts = name.split() if name else []
            
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
            # (NumericPasswordValidator would reject a pure-digit mobile number)
            if not used_phone_as_password:
                from django.contrib.auth.password_validation import validate_password
                try:
                    validate_password(password)
                except Exception as pw_err:
                    return ServiceResult(success=False, message=str(pw_err))
            
            # Check if admin explicitly requested active status at creation time
            create_as_active = cls.parse_bool(data.get('is_active', False))
            
            with transaction.atomic():
                # Create user — honour admin's active/inactive choice
                user = User.objects.create_user(
                    username=username,
                    email=email,
                    password=password,
                    first_name=name_parts[0] if name_parts else '',
                    last_name=' '.join(name_parts[1:]) if len(name_parts) > 1 else '',
                    phone=data.get('phone', ''),
                    role='client',
                    is_active=create_as_active,
                )
                
                # Build client kwargs
                client_kwargs = {
                    'user': user,
                    'name': name,
                    'address': data.get('address', ''),
                    'city': data.get('city', ''),
                    'state': data.get('state', ''),
                    'pincode': data.get('pincode', ''),
                    'status': 'active' if create_as_active else 'inactive',
                }
                
                # Add permissions
                for perm in cls.PERMISSION_FIELDS:
                    if perm in data:
                        client_kwargs[perm] = cls.parse_bool(data[perm])
                
                client = Client.objects.create(**client_kwargs)
                
                # Phase 1: Photo field removed - using avatar placeholder
                
                # Queue welcome email only when it is actually needed:
                # - active now and a real email exists
                if create_as_active and email_was_provided:
                    EmailLog.objects.create(
                        recipient_name=name or 'Client',
                        recipient_email=email,
                        subject='Welcome to Adarsh Admin - Your Account is Ready!',
                        email_type=EmailLog.EMAIL_TYPE_WELCOME,
                        status=EmailLog.STATUS_ON_HOLD,
                    )
            
            # Send welcome email in background thread if created as active
            # This prevents the API response from being blocked by SMTP
            if create_as_active and email_was_provided:
                _user_pk = user.pk
                _email = email
                _name = name
                _full_name = user.get_full_name()
                _phone = phone

                def _on_email_success():
                    User.objects.filter(pk=_user_pk).update(welcome_email_sent=True)
                    EmailLog.objects.filter(
                        recipient_email=_email,
                        email_type=EmailLog.EMAIL_TYPE_WELCOME,
                        status=EmailLog.STATUS_ON_HOLD,
                    ).update(status=EmailLog.STATUS_SENT)

                def _on_email_failure(err_msg):
                    EmailLog.objects.filter(
                        recipient_email=_email,
                        email_type=EmailLog.EMAIL_TYPE_WELCOME,
                        status=EmailLog.STATUS_ON_HOLD,
                    ).update(status=EmailLog.STATUS_FAILED, error_message=err_msg)

                try:
                    send_welcome_email(
                        name=_name or _full_name,
                        email=_email,
                        password=password,
                        role='client',
                        phone=_phone,
                        on_success=_on_email_success,
                        on_failure=_on_email_failure,
                    )
                except Exception as email_err:
                    logger.warning('Welcome email scheduling failed for new active client %s: %s', _email, email_err)
                    _on_email_failure(str(email_err))
            
            message = 'Client created successfully!'
            if create_as_active:
                if email_was_provided:
                    message += ' Welcome email queued for delivery.'
                else:
                    message += ' No email provided, so welcome email was skipped.'
            else:
                message += ' Account is inactive; activate it to allow login with the configured password.'
            
            return ServiceResult(
                success=True,
                message=message,
                data={
                    'client': cls.serialize(client, include_permissions=False),
                    'email_sent': create_as_active,
                }
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def get(cls, client_id: int, include_permissions: bool = True) -> ServiceResult:
        """Get a client by ID"""
        try:
            client = get_object_or_404(Client.objects.select_related('user'), id=client_id)
            return ServiceResult(
                success=True,
                data={'client': cls.serialize(client, include_permissions)}
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def update(cls, client_id: int, data: Dict[str, Any], photo=None) -> ServiceResult:
        """Update a client"""
        try:
            client = get_object_or_404(Client.objects.select_related('user'), id=client_id)
            user = client.user
            
            with transaction.atomic():
                # Update user fields
                if data.get('email'):
                    new_email = data['email'].strip().lower()
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
                user.save()
                
                # Update client fields
                if data.get('name'):
                    client.name = data['name']
                for field in ['address', 'city', 'state', 'pincode']:
                    if field in data:
                        setattr(client, field, data[field])
                
                # Handle is_active / status change via edit form
                if 'is_active' in data:
                    new_active = cls.parse_bool(data['is_active'])
                    if new_active != user.is_active:
                        user.is_active = new_active
                        client.status = 'active' if new_active else 'inactive'
                        user.save(update_fields=['is_active'])
                        # Cascade deactivation to all client staff
                        if not new_active:
                            cls._cascade_deactivate_staff(client)
                
                # Phase 1: Photo field removed - using avatar placeholder
                
                # Track revoked permissions for cascade to staff
                revoked_permissions = []
                
                # Update permissions — when ANY perm key is present, set ALL perms
                # (missing keys default to False to prevent stale ON states)
                has_any_perm = any(perm in data for perm in cls.PERMISSION_FIELDS)
                if has_any_perm:
                    for perm in cls.PERMISSION_FIELDS:
                        new_value = cls.parse_bool(data[perm]) if perm in data else False
                        old_value = getattr(client, perm, False)
                        
                        # Track if permission is being revoked
                        if old_value and not new_value:
                            revoked_permissions.append(perm)
                        
                        setattr(client, perm, new_value)
                
                client.save()
                
                # CRITICAL: Cascade revoked permissions to all staff members
                # Client Staff Permission ⊆ Client Permission
                if revoked_permissions:
                    cls._cascade_revoked_permissions(client, revoked_permissions)
            
            # Refresh from DB to return authoritative state
            client.refresh_from_db()
            
            return ServiceResult(
                success=True,
                message='Client updated successfully!',
                data={'client': cls.serialize(client, include_permissions=False)}
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def _cascade_revoked_permissions(cls, client: Client, revoked_permissions: List[str]) -> None:
        """
        Cascade revoked permissions to all client staff.
        Enforces: Client Staff Permission ⊆ Client Permission
        
        When a client permission is revoked, all staff members must also
        have that permission revoked.
        """
        import logging
        logger = logging.getLogger(__name__)
        
        # Get all client staff for this client
        client_staff = Staff.objects.filter(
            client=client,
            staff_type='client_staff'
        )
        
        if not client_staff.exists():
            return
        
        # Update each staff member
        updated_count = 0
        for staff in client_staff:
            staff_changed = False
            for perm in revoked_permissions:
                # Only update if staff actually has the permission
                if hasattr(staff, perm) and getattr(staff, perm, False):
                    setattr(staff, perm, False)
                    staff_changed = True
            
            if staff_changed:
                staff.save()
                updated_count += 1
        
        if updated_count > 0:
            logger.info(
                "Permission cascade: Revoked permissions %s from %d staff members of client '%s' (ID: %d)",
                revoked_permissions, updated_count, client.name, client.id
            )
    
    @classmethod
    def delete(cls, client_id: int) -> ServiceResult:
        """Delete a client and associated user (including client_staff users)"""
        try:
            client = get_object_or_404(Client, id=client_id)
            user = client.user
            client_name = client.name
            
            # Phase 1: Photo and profile_image fields removed - using avatar placeholder
            
            # Collect client_staff User IDs before cascade deletes their Staff records
            from staff.models import Staff as StaffModel
            staff_user_ids = list(
                StaffModel.objects.filter(
                    client=client, staff_type='client_staff'
                ).values_list('user_id', flat=True)
            )
            
            with transaction.atomic():
                client.delete()   # Cascades Staff records
                user.delete()     # Delete client's own User
                # Clean up orphaned client_staff User records
                if staff_user_ids:
                    from django.contrib.auth import get_user_model
                    get_user_model().objects.filter(id__in=staff_user_ids).delete()
            
            return ServiceResult(
                success=True,
                message=f'Client "{client_name}" deleted successfully!'
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def toggle_status(cls, client_id: int) -> ServiceResult:
        """Toggle client active/inactive status (atomic to prevent lost toggles).
        On first activation, generates/sends credentials only when no known password
        was provided at creation time.
        """
        try:
            # Collect state needed for email (must be outside atomic for clean email send)
            send_welcome = False
            welcome_email_info = {}
            welcome_user_id = None

            with transaction.atomic():
                client = Client.objects.select_related('user').select_for_update().get(id=client_id)
                user = client.user

                has_pending_welcome = EmailLog.objects.filter(
                    recipient_email=user.email,
                    email_type=EmailLog.EMAIL_TYPE_WELCOME,
                    status=EmailLog.STATUS_ON_HOLD,
                ).exists()
                has_known_phone_password = bool((user.phone or '').strip())
                is_first_activation = (
                    (client.status != 'active')
                    and has_pending_welcome
                    and not has_known_phone_password
                )

                if client.status == 'active':
                    # Deactivate
                    client.status = 'inactive'
                    user.is_active = False
                    status_display = 'Inactive'
                    deactivated_staff_count = cls._cascade_deactivate_staff(client)
                    client.save(update_fields=['status', 'updated_at'])
                    user.save(update_fields=['is_active'])
                else:
                    # Activate
                    client.status = 'active'
                    user.is_active = True
                    status_display = 'Active'
                    deactivated_staff_count = 0

                    if is_first_activation:
                        first_password = generate_secure_password()
                        user.set_password(first_password)
                        # Do NOT set welcome_email_sent here — set it only after
                        # the email is actually delivered so retries are possible.
                        user.save(update_fields=['is_active', 'password'])
                        send_welcome = True
                        welcome_user_id = user.pk
                        welcome_email_info = {
                            'name': client.name or user.get_full_name(),
                            'email': user.email,
                            'password': first_password,
                            'phone': user.phone or '',
                        }
                    else:
                        user.save(update_fields=['is_active'])

                    client.save(update_fields=['status', 'updated_at'])

            # Send welcome email asynchronously after the transaction commits
            if send_welcome:
                _user_pk = welcome_user_id
                _email = welcome_email_info['email']

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
                    name=welcome_email_info['name'],
                    email=welcome_email_info['email'],
                    password=welcome_email_info['password'],
                    role='client',
                    phone=welcome_email_info['phone'],
                    on_success=_on_email_success,
                    on_failure=_on_email_failure,
                )

            message = f'Client status changed to {status_display}!'
            if send_welcome:
                message += ' Welcome email queued for delivery.'
            if deactivated_staff_count > 0:
                message += f' ({deactivated_staff_count} staff members also deactivated)'
                logger.info(
                    'Client deactivation cascade: Deactivated %d staff members of client \'%s\' (ID: %d)',
                    deactivated_staff_count, client.name, client.id
                )

            return ServiceResult(
                success=True,
                message=message,
                data={
                    'status': client.status,
                    'status_display': status_display,
                    'staff_deactivated': deactivated_staff_count
                }
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def _cascade_deactivate_staff(cls, client: Client) -> int:
        """
        Deactivate all client staff when client is deactivated.
        Returns the count of staff members deactivated.
        """
        # Get all active client staff for this client
        active_staff = Staff.objects.filter(
            client=client,
            staff_type='client_staff',
            user__is_active=True
        ).select_related('user')
        
        count = 0
        for staff in active_staff:
            staff.user.is_active = False
            staff.user.save()
            count += 1
        
        return count
    
    @classmethod
    def list_all(cls, include_inactive: bool = False) -> ServiceResult:
        """List all clients"""
        try:
            queryset = Client.objects.select_related('user').all()
            if not include_inactive:
                queryset = queryset.filter(status='active')
            
            clients = [cls.serialize(c, include_permissions=False) for c in queryset]
            return ServiceResult(
                success=True,
                data={'clients': clients, 'total': len(clients)}
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def get_staff(cls, client_id: int) -> ServiceResult:
        """Get all staff members for a client"""
        try:
            client = get_object_or_404(Client, id=client_id)
            staff_members = Staff.objects.filter(
                client=client, 
                staff_type='client_staff'
            ).select_related('user')
            
            staff_list = []
            active_count = 0
            inactive_count = 0
            
            for staff in staff_members:
                is_active = staff.user.is_active
                if is_active:
                    active_count += 1
                else:
                    inactive_count += 1
                
                staff_list.append({
                    'id': staff.id,
                    'name': staff.user.get_full_name() or staff.user.username,
                    'email': staff.user.email or '',
                    'phone': staff.user.phone or '',
                    'department': staff.department or '',
                    'designation': staff.designation or '',
                    'address': staff.address or '',
                    'is_active': is_active,
                    'status': 'active' if is_active else 'inactive',
                    'status_display': 'Active' if is_active else 'Inactive',
                    'created_at': staff.created_at.strftime('%d-%m-%Y'),
                    # ID Card Client List Permission
                    'perm_idcard_client_list': staff.perm_idcard_client_list,
                    # ID Card Setting Permissions
                    'perm_idcard_setting_list': staff.perm_idcard_setting_list,
                    'perm_idcard_setting_add': staff.perm_idcard_setting_add,
                    'perm_idcard_setting_edit': staff.perm_idcard_setting_edit,
                    'perm_idcard_setting_delete': staff.perm_idcard_setting_delete,
                    'perm_idcard_setting_status': staff.perm_idcard_setting_status,
                })
            
            return ServiceResult(
                success=True,
                data={
                    'client_name': client.name,
                    'staff': staff_list,
                    'total': len(staff_list),
                    'active': active_count,
                    'inactive': inactive_count
                }
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))

    @classmethod
    def toggle_client_staff_status(cls, client_id: int, staff_id: int) -> ServiceResult:
        """Toggle a client staff member's active/inactive status (atomic, Super Admin only)"""
        try:
            client = get_object_or_404(Client, id=client_id)
            with transaction.atomic():
                staff = Staff.objects.select_for_update().select_related('user').filter(
                    id=staff_id,
                    client=client,
                    staff_type='client_staff'
                ).first()
                
                if not staff:
                    return ServiceResult(
                        success=False,
                        message='Staff member not found or does not belong to this client'
                    )
                
                user = staff.user
                user.is_active = not user.is_active
                user.save(update_fields=['is_active'])
            
            is_active = user.is_active
            return ServiceResult(
                success=True,
                message=f'Staff {"activated" if is_active else "deactivated"} successfully',
                data={
                    'staff_id': staff_id,
                    'is_active': is_active,
                    'status': 'active' if is_active else 'inactive',
                    'status_display': 'Active' if is_active else 'Inactive'
                }
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def update_client_staff_permissions(cls, client_id: int, staff_id: int, permissions: dict) -> ServiceResult:
        """
        Update a client staff member's permissions (Super Admin only).
        Enforces that staff permissions cannot exceed client permissions.
        """
        try:
            client = get_object_or_404(Client, id=client_id)
            staff = Staff.objects.filter(
                id=staff_id,
                client=client,
                staff_type='client_staff'
            ).first()
            
            if not staff:
                return ServiceResult(
                    success=False,
                    message='Staff member not found or does not belong to this client'
                )
            
            # Permission mapping: staff perm -> client perm
            STAFF_TO_CLIENT_PERMS = {
                'perm_idcard_client_list': 'perm_idcard_client_list',
                'perm_idcard_setting_list': 'perm_idcard_setting_list',
                'perm_idcard_setting_add': 'perm_idcard_setting_add',
                'perm_idcard_setting_edit': 'perm_idcard_setting_edit',
                'perm_idcard_setting_delete': 'perm_idcard_setting_delete',
                'perm_idcard_setting_status': 'perm_idcard_setting_status',
            }
            
            updated_perms = []
            rejected_perms = []
            
            with transaction.atomic():
                # Re-fetch with row lock to prevent concurrent permission updates
                staff = Staff.objects.select_for_update().get(pk=staff.pk)
                
                for perm_name, value in permissions.items():
                    if perm_name not in STAFF_TO_CLIENT_PERMS:
                        continue  # Ignore unknown permissions
                    
                    client_perm = STAFF_TO_CLIENT_PERMS.get(perm_name)
                    
                    # If trying to grant a permission, verify client has it
                    if value and client_perm:
                        client_has_perm = getattr(client, client_perm, False)
                        if not client_has_perm:
                            rejected_perms.append(perm_name)
                            continue  # Skip - client doesn't have this permission
                    
                    # Update staff permission
                    setattr(staff, perm_name, bool(value))
                    updated_perms.append(perm_name)
                
                staff.save()
            
            # Refresh to confirm persistence
            staff.refresh_from_db()
            
            message = f'Updated {len(updated_perms)} permission(s)'
            if rejected_perms:
                message += f'. {len(rejected_perms)} permission(s) rejected (client lacks permission)'
            
            return ServiceResult(
                success=True,
                message=message,
                data={
                    'staff_id': staff_id,
                    'updated_permissions': updated_perms,
                    'rejected_permissions': rejected_perms
                }
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))

    @classmethod
    def set_temp_password(cls, client_id: int, new_password: str, request=None) -> ServiceResult:
        """
        Set a temporary password for a client user.
        Sends a welcome email with the new credentials so the user knows their password.
        """
        try:
            client = get_object_or_404(Client.objects.select_related('user'), id=client_id)
            user = client.user

            if not new_password or not new_password.strip():
                return ServiceResult(success=False, message='Password cannot be empty')

            new_password = new_password.strip()

            user.set_password(new_password)
            user.save(update_fields=['password'])

            # Send welcome email with the new temporary password
            email_sent = False
            try:
                email_sent, _ = send_welcome_email(
                    name=client.name or user.get_full_name(),
                    email=user.email,
                    password=new_password,
                    role='client',
                    phone=user.phone or '',
                    request=request,
                )
                EmailLog.objects.create(
                    recipient_name=client.name or user.get_full_name(),
                    recipient_email=user.email,
                    subject='Your Temporary Password — Adarsh Admin',
                    email_type=EmailLog.EMAIL_TYPE_TEMP_PASSWORD,
                    status=EmailLog.STATUS_SENT if email_sent else EmailLog.STATUS_FAILED,
                )
            except Exception as e:
                logger.warning('Temp password email failed for %s: %s', user.email, e)

            return ServiceResult(
                success=True,
                message=f'Temporary password set for "{client.name}"',
                data={'email_sent': email_sent}
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
