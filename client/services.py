"""
Client Services Module — business logic for client-facing features.

- Dashboard data aggregation
- Client staff management (CRUD with permission checks)
- Card data access (read-only for their client)
- Image upload handling

ARCHITECTURE RULES:
- Views must NOT call .save(), .create(), .delete() on models directly.
- All client-facing mutations go through services in this file.
- Permission enforcement uses PermissionService (single authority).
- Status transitions delegate to WorkflowService.
"""
from typing import Dict, Any, Optional, List
import os
from django.utils.timezone import localtime
from django.db import transaction
from django.db.models import Count, Q

from core.models import Client, Staff, User, IDCardGroup, IDCardTable, IDCard
from core.services.base import BaseService, ServiceResult
from core.services.permission_service import PermissionService


class ClientAccessService:
    """
    Service for managing client data access.
    Ensures clients can only access their own data.
    """
    
    @staticmethod
    def get_client_for_user(user) -> Optional[Client]:
        """
        Get the Client instance for a user.
        Works for both 'client' and 'client_staff' roles.
        Delegates role checks to PermissionService (single authority).
        """
        if not user.is_authenticated:
            return None
        
        if PermissionService.is_client(user):
            return getattr(user, 'client_profile', None)
        
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                return staff.client
        
        return None
    
    @staticmethod
    def can_access_client(user, client_id: int) -> bool:
        """Check if user can access a specific client's data"""
        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        return client.id == client_id
    
    @staticmethod
    def can_access_group(user, group: IDCardGroup) -> bool:
        """Check if user can access a specific group"""
        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        return group.client_id == client.id
    
    @staticmethod
    def can_access_table(user, table: IDCardTable) -> bool:
        """Check if user can access a specific table"""
        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        return table.group.client_id == client.id
    
    @staticmethod
    def can_access_card(user, card: IDCard) -> bool:
        """Check if user can access a specific card.
        
        NOTE: ``card`` should be fetched with
        ``.select_related('table__group')`` to avoid extra queries.
        """
        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        return card.table.group.client_id == client.id


class ClientDashboardService(BaseService):
    """
    Service for client dashboard data.
    """
    
    @classmethod
    def get_dashboard_data(cls, user) -> ServiceResult:
        """
        Get dashboard summary data for a client user.
        
        Returns counts of cards by status for all tables belonging to the client.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(
                    success=False, 
                    message='Client profile not found'
                )
            
            # Get all groups for this client
            groups = IDCardGroup.objects.filter(client=client, is_active=True)
            
            # Get all tables from these groups
            tables = IDCardTable.objects.filter(group__in=groups, is_active=True)
            
            # Aggregate card counts by status
            status_counts = IDCard.objects.filter(
                table__in=tables
            ).values('status').annotate(count=Count('id'))
            
            # Convert to dict
            counts = {
                'pending': 0,
                'verified': 0,
                'pool': 0,
                'approved': 0,
                'download': 0,
                'reprint': 0,
            }
            
            for item in status_counts:
                if item['status'] in counts:
                    counts[item['status']] = item['count']
            
            # Total cards - exclude 'pool' status
            total_cards = counts['pending'] + counts['verified'] + counts['approved'] + counts['download']
            
            # Get group count and table count
            group_count = groups.count()
            table_count = tables.count()
            
            # Get staff count (client_staff under this client)
            staff_count = Staff.objects.filter(
                client=client, 
                staff_type='client_staff'
            ).count()
            
            # Recent activity - last 5 updated cards
            recent_cards = IDCard.objects.filter(
                table__in=tables
            ).select_related('table').order_by('-updated_at')[:5]
            
            recent_activity = []
            for card in recent_cards:
                name = card.field_data.get('NAME', card.field_data.get('name', f'Card #{card.id}'))
                recent_activity.append({
                    'id': card.id,
                    'name': name,
                    'status': card.status,
                    'status_display': card.get_status_display(),
                    'table_name': card.table.name,
                    'updated_at': localtime(card.updated_at).strftime('%d %b %Y, %H:%M'),
                })
            
            return ServiceResult(
                success=True,
                data={
                    'client': {
                        'id': client.id,
                        'name': client.name,
                        'status': client.status,
                    },
                    'card_counts': counts,
                    'counts': counts,  # Keep for backward compatibility
                    'total_cards': total_cards,
                    'group_count': group_count,
                    'table_count': table_count,
                    'staff_count': staff_count,
                    'recent_activity': recent_activity,
                }
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def get_groups_with_counts(cls, user) -> ServiceResult:
        """
        Get all groups with card status counts for the client.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            groups = IDCardGroup.objects.filter(
                client=client
            ).prefetch_related('tables')
            
            # Batch-fetch card counts per table
            table_card_counts = dict(
                IDCardTable.objects.filter(
                    group__client=client
                ).annotate(cc=Count('id_cards')).values_list('id', 'cc')
            )
            
            # Batch-fetch status counts per group
            group_status_qs = IDCard.objects.filter(
                table__group__client=client
            ).values('table__group_id', 'status').annotate(count=Count('id'))
            
            group_counts_map = {}
            for item in group_status_qs:
                gid = item['table__group_id']
                if gid not in group_counts_map:
                    group_counts_map[gid] = {}
                group_counts_map[gid][item['status']] = item['count']
            
            groups_data = []
            for group in groups:
                tables = group.tables.all()
                counts = group_counts_map.get(group.id, {})
                total = sum(counts.values())
                
                tables_data = [{
                    'id': t.id,
                    'name': t.name,
                    'is_active': t.is_active,
                    'card_count': table_card_counts.get(t.id, 0),
                } for t in tables]
                
                groups_data.append({
                    'id': group.id,
                    'name': group.name,
                    'is_active': group.is_active,
                    'created_at': group.created_at.strftime('%Y-%m-%dT%H:%M:%S') if hasattr(group, 'created_at') else None,
                    'table_count': len(tables_data),
                    'card_count': total,
                    'total_cards': total,
                    'pending_count': counts.get('pending', 0),
                    'pending': counts.get('pending', 0),
                    'verified': counts.get('verified', 0),
                    'pool': counts.get('pool', 0),
                    'approved': counts.get('approved', 0),
                    'download': counts.get('download', 0),
                    'reprint': counts.get('reprint', 0),
                    'tables': tables_data,
                })
            
            return ServiceResult(success=True, data={'groups': groups_data})
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))


class ClientStaffService(BaseService):
    """
    Service for client staff management.
    Only Client Admin (role='client') can manage staff.
    """
    
    # All permission fields that clients can set for their staff
    # Client staff only gets these 13 permissions (matching client admin's drawer)
    STAFF_PERMISSION_FIELDS = [
        'perm_idcard_pending_list', 'perm_idcard_verified_list',
        'perm_idcard_pool_list', 'perm_idcard_approved_list',
        'perm_idcard_download_list',
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete',
        'perm_idcard_info', 'perm_idcard_approve', 'perm_idcard_verify',
        'perm_idcard_created_at', 'perm_idcard_updated_at',
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


class ClientCardService(BaseService):
    """
    Service for client card data access.
    Clients can view and manage cards within their tables.
    """
    
    VALID_STATUSES = ['pending', 'verified', 'pool', 'approved', 'download', 'reprint']
    
    @classmethod
    def get_tables_for_client(cls, user) -> ServiceResult:
        """
        Get all tables for the client with card counts.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            tables = IDCardTable.objects.filter(
                group__client=client
            ).select_related('group').annotate(
                total_cards=Count('id_cards'),
                pending=Count('id_cards', filter=Q(id_cards__status='pending')),
                verified=Count('id_cards', filter=Q(id_cards__status='verified')),
                pool=Count('id_cards', filter=Q(id_cards__status='pool')),
                approved=Count('id_cards', filter=Q(id_cards__status='approved')),
                download=Count('id_cards', filter=Q(id_cards__status='download')),
                reprint=Count('id_cards', filter=Q(id_cards__status='reprint')),
            )
            
            tables_data = [{
                'id': t.id,
                'name': t.name,
                'group_name': t.group.name,
                'group_id': t.group.id,
                'is_active': t.is_active,
                'total_cards': t.total_cards,
                'pending': t.pending,
                'verified': t.verified,
                'pool': t.pool,
                'approved': t.approved,
                'download': t.download,
                'reprint': t.reprint,
            } for t in tables]
            
            return ServiceResult(success=True, data={'tables': tables_data})
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def get_cards(
        cls, 
        user, 
        table_id: int, 
        status_filter: Optional[str] = None,
        offset: int = 0,
        limit: int = 100,
        search: Optional[str] = None,
        cursor: int = None
    ) -> ServiceResult:
        """
        Get cards for a table (with permission checks).
        Supports cursor-based pagination (preferred) and offset (legacy).
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Get table and verify ownership
            try:
                table = IDCardTable.objects.get(id=table_id)
            except IDCardTable.DoesNotExist:
                return ServiceResult(success=False, message='Table not found')
            
            if not ClientAccessService.can_access_table(user, table):
                return ServiceResult(success=False, message='Access denied')
            
            # Check status viewing permission
            if status_filter:
                perm_map = {
                    'pending': 'perm_idcard_pending_list',
                    'verified': 'perm_idcard_verified_list',
                    'pool': 'perm_idcard_pool_list',
                    'approved': 'perm_idcard_approved_list',
                    'download': 'perm_idcard_download_list',
                    'reprint': 'perm_idcard_reprint_list',
                }
                perm = perm_map.get(status_filter)
                if perm and not PermissionService.has_permission(user, perm):
                    return ServiceResult(
                        success=False, 
                        message=f'No permission to view {status_filter} cards'
                    )
            
            # Build query — defer heavy photo column
            cards_query = IDCard.objects.filter(table=table).defer('photo').order_by('-id')
            
            if status_filter and status_filter in cls.VALID_STATUSES:
                cards_query = cards_query.filter(status=status_filter)
            
            # Search in field_data (JSONField)
            if search:
                search_lower = search.lower()
                # Filter by searching in the JSON field data
                # This looks for the search term in NAME, name, id_number, etc.
                cards_query = cards_query.filter(
                    Q(field_data__NAME__icontains=search_lower) |
                    Q(field_data__name__icontains=search_lower) |
                    Q(field_data__Name__icontains=search_lower) |
                    Q(field_data__ID__icontains=search) |
                    Q(field_data__id__icontains=search) |
                    Q(field_data__ID_NUMBER__icontains=search) |
                    Q(field_data__id_number__icontains=search) |
                    Q(field_data__ROLL_NO__icontains=search) |
                    Q(field_data__roll_no__icontains=search)
                )
            
            total_count = cards_query.count()

            # Cursor-based pagination (preferred) or offset (legacy)
            if cursor is not None:
                cards = list(cards_query.filter(id__lt=cursor)[:limit + 1])
            else:
                cards = list(cards_query[offset:offset + limit + 1])
            has_more = len(cards) > limit
            if has_more:
                cards = cards[:limit]
            next_cursor = cards[-1].id if cards and has_more else None
            
            # Serialize
            card_list = []
            for idx, card in enumerate(cards):
                # Extract common fields from field_data for convenience
                field_data = card.field_data or {}
                name = (
                    field_data.get('NAME') or 
                    field_data.get('name') or 
                    field_data.get('Name') or 
                    f'Card #{card.id}'
                )
                id_number = (
                    field_data.get('ID') or 
                    field_data.get('id') or 
                    field_data.get('ID_NUMBER') or 
                    field_data.get('id_number') or
                    field_data.get('ROLL_NO') or
                    field_data.get('roll_no') or
                    ''
                )
                class_designation = (
                    field_data.get('CLASS') or 
                    field_data.get('class') or 
                    field_data.get('DESIGNATION') or 
                    field_data.get('designation') or
                    ''
                )
                
                card_data = {
                    'id': card.id,
                    'sr_no': offset + idx + 1,
                    'name': name,
                    'id_number': id_number,
                    'class_designation': class_designation,
                    'photo_url': card.photo.url if card.photo else None,
                    'field_data': card.field_data,
                    'status': card.status,
                    'status_display': card.get_status_display(),
                    'created_at': localtime(card.created_at).strftime('%d %b %Y, %H:%M'),
                    'updated_at': localtime(card.updated_at).strftime('%d %b %Y, %H:%M'),
                }
                card_list.append(card_data)
            
            return ServiceResult(
                success=True,
                data={
                    'cards': card_list,
                    'table': {
                        'id': table.id,
                        'name': table.name,
                        'fields': table.fields,
                    },
                    'total': total_count,
                    'offset': offset,
                    'limit': limit,
                    'has_more': has_more,
                    'next_cursor': next_cursor,
                }
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def get_card_detail(cls, user, card_id: int) -> ServiceResult:
        """
        Get details of a specific card.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Get card
            try:
                card = IDCard.objects.select_related('table', 'table__group').get(id=card_id)
            except IDCard.DoesNotExist:
                return ServiceResult(success=False, message='Card not found')
            
            # Verify ownership
            if not ClientAccessService.can_access_card(user, card):
                return ServiceResult(success=False, message='Access denied')
            
            field_data = card.field_data or {}
            
            # Extract common fields
            name = (
                field_data.get('NAME') or 
                field_data.get('name') or 
                field_data.get('Name') or 
                f'Card #{card.id}'
            )
            id_number = (
                field_data.get('ID') or 
                field_data.get('id') or 
                field_data.get('ID_NUMBER') or 
                field_data.get('id_number') or
                field_data.get('ROLL_NO') or
                field_data.get('roll_no') or
                ''
            )
            class_designation = (
                field_data.get('CLASS') or 
                field_data.get('class') or 
                field_data.get('DESIGNATION') or 
                field_data.get('designation') or
                ''
            )
            father_name = (
                field_data.get('FATHER_NAME') or 
                field_data.get('father_name') or 
                field_data.get('FATHER') or 
                ''
            )
            mother_name = (
                field_data.get('MOTHER_NAME') or 
                field_data.get('mother_name') or 
                field_data.get('MOTHER') or 
                ''
            )
            dob = (
                field_data.get('DOB') or 
                field_data.get('dob') or 
                field_data.get('DATE_OF_BIRTH') or 
                ''
            )
            blood_group = (
                field_data.get('BLOOD_GROUP') or 
                field_data.get('blood_group') or 
                field_data.get('BLOOD') or 
                ''
            )
            address = (
                field_data.get('ADDRESS') or 
                field_data.get('address') or 
                ''
            )
            contact = (
                field_data.get('CONTACT') or 
                field_data.get('contact') or 
                field_data.get('PHONE') or 
                field_data.get('phone') or 
                field_data.get('MOBILE') or 
                ''
            )
            session = (
                field_data.get('SESSION') or 
                field_data.get('session') or 
                field_data.get('VALIDITY') or 
                field_data.get('validity') or 
                ''
            )
            
            return ServiceResult(
                success=True,
                data={
                    'id': card.id,
                    'name': name,
                    'id_number': id_number,
                    'class_designation': class_designation,
                    'father_name': father_name,
                    'mother_name': mother_name,
                    'dob': dob,
                    'blood_group': blood_group,
                    'address': address,
                    'contact': contact,
                    'session': session,
                    'photo_url': card.photo.url if card.photo else None,
                    'field_data': field_data,
                    'status': card.status,
                    'status_display': card.get_status_display(),
                    'table_name': card.table.name,
                    'group_name': card.table.group.name,
                    'created_at': localtime(card.created_at).strftime('%d %b %Y, %H:%M'),
                    'updated_at': localtime(card.updated_at).strftime('%d %b %Y, %H:%M'),
                }
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def change_card_status(cls, user, card_id: int, new_status: str) -> ServiceResult:
        """
        Change a card's status — delegates to WorkflowService.transition().

        WorkflowService enforces: transition matrix, permissions, mandatory
        fields, image gate, client-readonly guard, activity logging.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Get card
            try:
                card = IDCard.objects.select_related('table').get(id=card_id)
            except IDCard.DoesNotExist:
                return ServiceResult(success=False, message='Card not found')
            
            # Verify ownership
            if not ClientAccessService.can_access_card(user, card):
                return ServiceResult(success=False, message='Access denied')
            
            # Delegate entirely to WorkflowService (handles permissions + all guards)
            from core.services.workflow_service import WorkflowService
            return WorkflowService.transition(card, new_status, user=user)
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def bulk_change_status(cls, user, table_id: int, card_ids: List[int], new_status: str) -> ServiceResult:
        """
        Change status for multiple cards — delegates to WorkflowService.bulk_transition().

        WorkflowService enforces: transition matrix, permissions, mandatory
        fields, image gate, client-readonly guard, activity logging.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Verify table ownership
            try:
                table = IDCardTable.objects.get(id=table_id)
            except IDCardTable.DoesNotExist:
                return ServiceResult(success=False, message='Table not found')
            
            if not ClientAccessService.can_access_table(user, table):
                return ServiceResult(success=False, message='Access denied')
            
            # Delegate entirely to WorkflowService (handles permissions + all guards)
            from core.services.workflow_service import WorkflowService
            return WorkflowService.bulk_transition(table, card_ids, new_status, user=user)
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))


class ClientImageService(BaseService):
    """
    Service for client image uploads.
    Handles image upload and linking to card data.
    """
    
    @classmethod
    def upload_images(cls, user, table_id: int, images) -> ServiceResult:
        """
        Upload images and link them to cards based on filename matching.
        
        Args:
            user: Current user
            table_id: ID of the table
            images: List of uploaded image files
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Verify table access
            try:
                table = IDCardTable.objects.get(id=table_id)
            except IDCardTable.DoesNotExist:
                return ServiceResult(success=False, message='Table not found')
            
            if not ClientAccessService.can_access_table(user, table):
                return ServiceResult(success=False, message='Access denied')
            
            # Check upload permission
            if not PermissionService.has_permission(user, 'perm_reupload_idcard_image'):
                return ServiceResult(success=False, message='No permission to upload images')
            
            # Use the mediafiles ImageService for actual processing
            from mediafiles.services import ImageService
            
            matched = 0
            failed = 0
            for image in images:
                original_name = getattr(image, 'name', '')
                name_without_ext = os.path.splitext(original_name)[0] if original_name else ''
                
                # Find cards in the table that reference this image name
                cards = IDCard.objects.filter(table_id=table_id)
                for card in cards:
                    fd = card.field_data or {}
                    updated = False
                    for key, val in fd.items():
                        if isinstance(val, str) and name_without_ext and name_without_ext.lower() in val.lower():
                            try:
                                image.seek(0)
                                img_bytes = image.read()
                                result = ImageService.save_image(
                                    image_bytes=img_bytes,
                                    field_name=key,
                                    card=card,
                                    client=client,
                                    original_filename=original_name,
                                )
                                if result.success and result.data.get('path'):
                                    fd[key] = result.data['path']
                                    updated = True
                            except Exception:
                                failed += 1
                    if updated:
                        card.field_data = fd
                        card.save(update_fields=['field_data', 'updated_at'])
                        matched += 1
            
            return ServiceResult(
                success=True,
                message=f'Reupload complete: {matched} images matched, {failed} failed.',
                data={'matched': matched, 'failed': failed}
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
