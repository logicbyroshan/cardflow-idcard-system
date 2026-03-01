"""
Client Access Service — ownership and access-control checks.

Ensures clients (and client-staff) can only reach their own data.
"""
from typing import Optional

from client.models import Client
from idcards.models import IDCardGroup, IDCardTable, IDCard
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
        """Check if user can access a specific client's data.
        Admin roles (super_admin / admin_staff) have unrestricted access.
        """
        if PermissionService.is_any_admin(user):
            return True
        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        return client.id == client_id
    
    @staticmethod
    def can_access_group(user, group: IDCardGroup) -> bool:
        """Check if user can access a specific group.
        Admin roles have unrestricted access.
        client_staff: must have group in assigned_groups (empty = all groups).
        """
        if PermissionService.is_any_admin(user):
            return True
        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        if group.client_id != client.id:
            return False
        # For client_staff with assigned groups: restrict to assigned only
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_ids = list(staff.assigned_groups.values_list('id', flat=True))
                if assigned_ids:  # Empty means all groups are accessible
                    return group.id in assigned_ids
        return True

    @staticmethod
    def can_access_table(user, table: IDCardTable) -> bool:
        """Check if user can access a specific table.
        Admin roles have unrestricted access.
        client_staff: limited to assigned groups (empty assigned_groups = all groups).
        """
        if PermissionService.is_any_admin(user):
            return True
        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        if table.group.client_id != client.id:
            return False
        # For client_staff with assigned groups: restrict to assigned groups only
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_ids = list(staff.assigned_groups.values_list('id', flat=True))
                if assigned_ids:  # Empty means all groups are accessible
                    return table.group_id in assigned_ids
        return True

    @staticmethod
    def get_accessible_table_ids(user):
        """Return a queryset filter of accessible table IDs for a user.
        Returns None if all tables are accessible (no restriction).
        """
        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return []
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_group_ids = list(staff.assigned_groups.values_list('id', flat=True))
                if assigned_group_ids:
                    from idcards.models import IDCardTable as _IDCardTable
                    return list(_IDCardTable.objects.filter(
                        group__client=client,
                        group_id__in=assigned_group_ids,
                    ).values_list('id', flat=True))
        return None  # None means no restriction (all client tables accessible)

    @staticmethod
    def can_access_card(user, card: IDCard) -> bool:
        """Check if user can access a specific card.
        Admin roles have unrestricted access.

        NOTE: ``card`` should be fetched with
        ``.select_related('table__group')`` to avoid extra queries.
        """
        if PermissionService.is_any_admin(user):
            return True
        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        if card.table.group.client_id != client.id:
            return False
        # For client_staff with assigned groups
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_ids = list(staff.assigned_groups.values_list('id', flat=True))
                if assigned_ids:
                    return card.table.group_id in assigned_ids
        return True
