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
        """
        if PermissionService.is_any_admin(user):
            return True
        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        return group.client_id == client.id
    
    @staticmethod
    def can_access_table(user, table: IDCardTable) -> bool:
        """Check if user can access a specific table.
        Admin roles have unrestricted access.
        """
        if PermissionService.is_any_admin(user):
            return True
        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        return table.group.client_id == client.id
    
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
        return card.table.group.client_id == client.id
