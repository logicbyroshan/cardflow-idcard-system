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
        # ID Card Action Permissions
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete',
        'perm_idcard_info', 'perm_idcard_approve', 'perm_idcard_verify',
        'perm_idcard_bulk_upload', 'perm_idcard_bulk_download',
        'perm_idcard_created_at', 'perm_idcard_updated_at',
        'perm_idcard_delete_from_pool', 'perm_delete_all_idcard',
        'perm_reupload_idcard_image', 'perm_idcard_retrieve',
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
            'photo_url': client.photo.url if client.photo else None,
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
                
                # Handle photo
                if photo:
                    client.photo = photo
                    client.save()
            
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
            
            # Handle photo
            if photo:
                client.photo = photo
            
            # Update permissions
            for perm in cls.PERMISSION_FIELDS:
                if perm in data:
                    setattr(client, perm, cls.parse_bool(data[perm]))
            
            client.save()
            
            return ServiceResult(
                success=True,
                message='Client updated successfully!',
                data={'client': cls.serialize(client, include_permissions=False)}
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def delete(cls, client_id: int) -> ServiceResult:
        """Delete a client and associated user"""
        try:
            client = get_object_or_404(Client, id=client_id)
            user = client.user
            client_name = client.name
            
            # Clean up photo and profile image files before deleting
            if client.photo:
                try:
                    client.photo.delete(save=False)
                except Exception:
                    pass
            if user.profile_image:
                try:
                    user.profile_image.delete(save=False)
                except Exception:
                    pass
            
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
            client = get_object_or_404(Client, id=client_id)
            user = client.user
            
            if client.status == 'active':
                client.status = 'inactive'
                user.is_active = False
                status_display = 'Inactive'
            else:
                client.status = 'active'
                user.is_active = True
                status_display = 'Active'
            
            with transaction.atomic():
                client.save()
                user.save()
            
            return ServiceResult(
                success=True,
                message=f'Client status changed to {status_display}!',
                data={
                    'status': client.status,
                    'status_display': status_display
                }
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
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
