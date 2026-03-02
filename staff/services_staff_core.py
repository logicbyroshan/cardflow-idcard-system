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
from core.utils import send_welcome_email
from core.utils.email_utils import generate_secure_password
from core.services.base import BaseService, ServiceResult

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
        # ID Card Settings
        'perm_idcard_setting_list', 'perm_idcard_setting_add', 
        'perm_idcard_setting_edit', 'perm_idcard_setting_delete', 
        'perm_idcard_setting_status',
        # ID Card Lists
        'perm_idcard_pending_list', 'perm_idcard_verified_list',
        'perm_idcard_pool_list', 'perm_idcard_approved_list',
        'perm_idcard_download_list', 'perm_idcard_reprint_list',
        # Print & Reprint Lists
        'perm_confirmed_list', 'perm_print_list', 'perm_finalized_list',
        # ID Card Actions (work in Pending and Verified lists only)
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete',
        'perm_idcard_info', 'perm_idcard_approve', 'perm_idcard_verify',
        'perm_idcard_created_at', 'perm_idcard_updated_at',
        'perm_idcard_delete_from_pool',
        'perm_idcard_retrieve',
        # ID Card Bulk Actions (work across all lists)
        'perm_idcard_bulk_upload', 'perm_idcard_bulk_download',
        'perm_idcard_bulk_reupload',
        'perm_idcard_upgrade_all',
        # Mobile App
        'perm_mobile_app',
    ]
    
    @classmethod
    def serialize(cls, staff: Staff, include_permissions: bool = True) -> Dict[str, Any]:
        """Serialize Staff instance to dict"""
        user = staff.user
        data = {
            'id': staff.id,
            'name': user.get_full_name(),
            'email': user.email,
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
            email = data.get('email', '').strip().lower()
            if not email:
                return ServiceResult(success=False, message='Email is required')
            
            # Check for duplicate email
            if User.objects.filter(email__iexact=email).exists():
                return ServiceResult(
                    success=False, 
                    message='A user with this email already exists'
                )
            
            # Generate unique username
            username = email.split('@')[0].lower().replace('.', '_')
            base_username = username
            counter = 1
            while User.objects.filter(username=username).exists():
                username = f"{base_username}{counter}"
                counter += 1
            
            # Parse name
            name = data.get('name', '')
            name_parts = name.split() if name else []
            
            # Default password strategy: phone number → random token
            # SECURITY NOTE: Phone-as-password is a deliberate UX choice — the welcome
            # email tells users "use your mobile number". When a stronger policy is
            # desired, always pass an explicit password from the UI instead.
            phone = data.get('phone', '').strip()
            password = data.get('password', '').strip()
            used_phone_as_password = False
            if not password:
                if phone:
                    password = phone
                    used_phone_as_password = True
                else:
                    password = secrets.token_urlsafe(12)
            
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
                    # Accept list of IDs (ints or strings)
                    try:
                        client_ids = [int(cid) for cid in assigned_client_ids if cid]
                        clients = Client.objects.filter(id__in=client_ids, status='active')
                        staff.assigned_clients.set(clients)
                    except (ValueError, TypeError):
                        pass  # Skip invalid IDs
                
                # Log email as on_hold — will be sent on first activation
                EmailLog.objects.create(
                    recipient_name=name or user.get_full_name(),
                    recipient_email=email,
                    subject='Welcome to Adarsh Admin - Your Account is Ready!',
                    email_type=EmailLog.EMAIL_TYPE_WELCOME,
                    status=EmailLog.STATUS_ON_HOLD,
                )
            
            return ServiceResult(
                success=True,
                message='Staff created successfully! Welcome email will be sent on first activation.',
                data={
                    'staff': cls.serialize(staff, include_permissions=False),
                    'email_sent': False,
                }
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
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
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def update(cls, staff_id: int, data: Dict[str, Any], profile_image=None) -> ServiceResult:
        """Update a staff member"""
        try:
            staff = get_object_or_404(Staff, id=staff_id)
            user = staff.user
            
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
            
            # Update password if provided — validate before setting
            password = data.get('password', '')
            if isinstance(password, str) and password.strip():
                from django.contrib.auth.password_validation import validate_password
                try:
                    validate_password(password.strip(), user=user)
                except Exception as pw_err:
                    return ServiceResult(success=False, message=str(pw_err))
                user.set_password(password.strip())
            
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
            
            # Clamp client_staff permissions to parent client's permissions
            if staff.staff_type == 'client_staff' and staff.client:
                for perm in cls.PERMISSION_FIELDS:
                    if getattr(staff, perm, False):
                        if hasattr(staff.client, perm) and not getattr(staff.client, perm, False):
                            setattr(staff, perm, False)
            
            staff.save()
            
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
                        clients = Client.objects.filter(id__in=client_ids, status='active')
                        staff.assigned_clients.set(clients)
                    except (ValueError, TypeError, json.JSONDecodeError):
                        pass  # Skip invalid IDs
            
            return ServiceResult(
                success=True,
                message='Staff updated successfully!',
                data={'staff': cls.serialize(staff, include_permissions=False)}
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
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
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def toggle_status(cls, staff_id: int) -> ServiceResult:
        """Toggle staff active/inactive status (atomic to prevent lost toggles).
        On the FIRST activation, generates fresh credentials and sends a welcome email.
        """
        try:
            send_welcome = False
            welcome_info = {}
            welcome_user_id = None

            with transaction.atomic():
                staff = Staff.objects.select_related('user').select_for_update().get(id=staff_id)
                user = staff.user
                is_first_activation = not user.is_active and not user.welcome_email_sent
                user.is_active = not user.is_active
                status = 'active' if user.is_active else 'inactive'
                status_display = 'Active' if user.is_active else 'Inactive'

                if user.is_active and is_first_activation:
                    first_password = generate_secure_password()
                    user.set_password(first_password)
                    # Do NOT set welcome_email_sent here — set it only after
                    # the email is actually delivered so retries are possible.
                    user.save(update_fields=['is_active', 'password'])
                    send_welcome = True
                    welcome_user_id = user.pk
                    welcome_info = {
                        'name': user.get_full_name(),
                        'email': user.email,
                        'password': first_password,
                        'phone': user.phone or '',
                        'role': staff.staff_type,
                    }
                else:
                    user.save(update_fields=['is_active'])

            email_sent = False
            email_msg = ''
            if send_welcome:
                try:
                    email_sent, email_msg = send_welcome_email(
                        name=welcome_info['name'],
                        email=welcome_info['email'],
                        password=welcome_info['password'],
                        role=welcome_info['role'],
                        phone=welcome_info['phone'],
                    )
                    if email_sent:
                        User.objects.filter(pk=welcome_user_id).update(welcome_email_sent=True)
                    EmailLog.objects.filter(
                        recipient_email=welcome_info['email'],
                        email_type=EmailLog.EMAIL_TYPE_WELCOME,
                        status=EmailLog.STATUS_ON_HOLD,
                    ).update(
                        status=EmailLog.STATUS_SENT if email_sent else EmailLog.STATUS_FAILED,
                        **({}  if email_sent else {'error_message': email_msg})
                    )
                except Exception as email_err:
                    logger.warning('First-activation welcome email failed for %s: %s', welcome_info['email'], email_err)
                    EmailLog.objects.filter(
                        recipient_email=welcome_info['email'],
                        email_type=EmailLog.EMAIL_TYPE_WELCOME,
                        status=EmailLog.STATUS_ON_HOLD,
                    ).update(status=EmailLog.STATUS_FAILED, error_message=str(email_err))

            if send_welcome and email_sent:
                extra = ' Welcome email sent!'
            elif send_welcome and not email_sent:
                extra = f' ⚠️ Welcome email failed: {email_msg}'
            else:
                extra = ''
            return ServiceResult(
                success=True,
                message=f'Staff status changed to {status_display}!{extra}',
                data={'status': status, 'status_display': status_display}
            )
        except Staff.DoesNotExist:
            return ServiceResult(success=False, message='Staff not found')
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
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
            return ServiceResult(success=False, message=str(e))
    
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
            return ServiceResult(success=False, message=str(e))

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

            new_password = new_password.strip()

            user.set_password(new_password)
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
            return ServiceResult(success=False, message=str(e))