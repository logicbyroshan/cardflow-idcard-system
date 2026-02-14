"""
Client Service Module
Contains: Client CRUD operations, serialization
"""
import secrets
from typing import Dict, Any, Optional, List

from django.shortcuts import get_object_or_404
from django.db import transaction

from ..models import Client, Staff, User
from ..utils import send_welcome_email
from .base import BaseService, ServiceResult


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
        # Group/Table Create & Delete
        'perm_idcard_group_create', 'perm_idcard_group_delete',
        # ID Card List Permissions
        'perm_idcard_pending_list', 'perm_idcard_verified_list', 
        'perm_idcard_pool_list', 'perm_idcard_approved_list', 
        'perm_idcard_download_list', 'perm_idcard_reprint_list',
        # ID Card Action Permissions (work in Pending and Verified lists only)
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete',
        'perm_idcard_info', 'perm_idcard_approve', 'perm_idcard_verify',
        'perm_idcard_created_at', 'perm_idcard_updated_at',
        'perm_idcard_delete_from_pool', 'perm_reupload_idcard_image',
        'perm_idcard_retrieve',
        # ID Card Bulk Action Permissions (work across all lists)
        'perm_idcard_bulk_upload', 'perm_idcard_bulk_download',
        'perm_idcard_bulk_reupload', 'perm_delete_all_idcard',
        'perm_idcard_upgrade_all',
    ]
    
    @classmethod
    def serialize(cls, client: Client, include_permissions: bool = True) -> Dict[str, Any]:
        """Serialize Client instance to dict"""
        data = {
            'id': client.id,
            'name': client.name,
            'email': client.user.email,
            'phone': client.user.phone or '',
            'address': client.address or '',
            'city': client.city or '',
            'state': client.state or '',
            'pincode': client.pincode or '',
            'status': client.status,
            'photo_url': None,  # Phase 1: Photo field removed - using avatar placeholder
            'created_at': client.created_at.strftime('%d-%m-%Y %I:%M %p'),
            'updated_at': client.updated_at.strftime('%d-%m-%Y %I:%M %p'),
        }
        
        if include_permissions:
            for perm in cls.PERMISSION_FIELDS:
                data[perm] = getattr(client, perm, False)
        
        return data
    
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
            
            # Password from phone number
            phone = data.get('phone', '').strip()
            phone_clean = ''.join(filter(str.isdigit, phone))
            password = phone_clean if phone_clean else secrets.token_urlsafe(12)
            
            with transaction.atomic():
                # Create user
                user = User.objects.create_user(
                    username=username,
                    email=email,
                    first_name=name_parts[0] if name_parts else '',
                    last_name=' '.join(name_parts[1:]) if len(name_parts) > 1 else '',
                    phone=data.get('phone', ''),
                    role='client',
                )
                user.set_password(password)
                user.save()
                
                # Build client kwargs
                client_kwargs = {
                    'user': user,
                    'name': name,
                    'address': data.get('address', ''),
                    'city': data.get('city', ''),
                    'state': data.get('state', ''),
                    'pincode': data.get('pincode', ''),
                    'status': 'active',
                }
                
                # Add permissions
                for perm in cls.PERMISSION_FIELDS:
                    if perm in data:
                        client_kwargs[perm] = cls.parse_bool(data[perm])
                
                client = Client.objects.create(**client_kwargs)
                
                # Phase 1: Photo field removed - using avatar placeholder
            
            # Send welcome email
            email_sent = False
            email_message = ''
            if email and request:
                email_sent, email_message = send_welcome_email(
                    name=name or 'Client',
                    email=email,
                    password=password,
                    role='client',
                    request=request
                )
            
            message = 'Client created successfully!'
            if email_sent:
                message += ' Welcome email sent.'
            elif email_message:
                message += f' (Email not sent: {email_message})'
            
            return ServiceResult(
                success=True,
                message=message,
                data={
                    'client': cls.serialize(client, include_permissions=False),
                    'email_sent': email_sent,
                }
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def get(cls, client_id: int, include_permissions: bool = True) -> ServiceResult:
        """Get a client by ID"""
        try:
            client = get_object_or_404(Client, id=client_id)
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
            client = get_object_or_404(Client, id=client_id)
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
                
                # Phase 1: Photo field removed - using avatar placeholder
                
                # Track revoked permissions for cascade to staff
                revoked_permissions = []
                
                # Update permissions
                for perm in cls.PERMISSION_FIELDS:
                    if perm in data:
                        new_value = cls.parse_bool(data[perm])
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
        """Delete a client and associated user"""
        try:
            client = get_object_or_404(Client, id=client_id)
            user = client.user
            client_name = client.name
            
            # Phase 1: Photo and profile_image fields removed - using avatar placeholder
            
            with transaction.atomic():
                client.delete()
                user.delete()
            
            return ServiceResult(
                success=True,
                message=f'Client "{client_name}" deleted successfully!'
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def toggle_status(cls, client_id: int) -> ServiceResult:
        """Toggle client active/inactive status"""
        try:
            import logging
            logger = logging.getLogger(__name__)
            
            client = get_object_or_404(Client, id=client_id)
            user = client.user
            
            if client.status == 'active':
                client.status = 'inactive'
                user.is_active = False
                status_display = 'Inactive'
                # CRITICAL: Deactivate all client staff when client is deactivated
                deactivated_staff_count = cls._cascade_deactivate_staff(client)
            else:
                client.status = 'active'
                user.is_active = True
                status_display = 'Active'
                deactivated_staff_count = 0
            
            with transaction.atomic():
                client.save()
                user.save()
            
            message = f'Client status changed to {status_display}!'
            if deactivated_staff_count > 0:
                message += f' ({deactivated_staff_count} staff members also deactivated)'
                logger.info(
                    "Client deactivation cascade: Deactivated %d staff members of client '%s' (ID: %d)",
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
        """Toggle a client staff member's active/inactive status (Super Admin only)"""
        try:
            client = get_object_or_404(Client, id=client_id)
            staff = Staff.objects.filter(
                id=staff_id,
                client=client,
                staff_type='client_staff'
            ).select_related('user').first()
            
            if not staff:
                return ServiceResult(
                    success=False,
                    message='Staff member not found or does not belong to this client'
                )
            
            user = staff.user
            user.is_active = not user.is_active
            user.save()
            
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
            
            with transaction.atomic():
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
