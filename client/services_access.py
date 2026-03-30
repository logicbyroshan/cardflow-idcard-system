"""
Client Access Service — ownership and access-control checks.

Ensures clients (and client-staff) can only reach their own data.
"""
from typing import Optional
from django.db.models import Q

from client.models import Client
from idcards.models import IDCardGroup, IDCardTable, IDCard
from core.services.permission_service import PermissionService


class ClientAccessService:
    """
    Service for managing client data access.
    Ensures clients can only access their own data.
    """

    @staticmethod
    def _normalize_positive_int_ids(raw_ids):
        """Normalize mixed values into unique positive integers."""
        if not isinstance(raw_ids, (list, tuple, set)):
            return []

        out = []
        seen = set()
        for value in raw_ids:
            if isinstance(value, bool):
                continue
            try:
                number = int(str(value).strip())
            except (TypeError, ValueError):
                continue
            if number <= 0 or number in seen:
                continue
            seen.add(number)
            out.append(number)
        return out

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
        super_admin has unrestricted access.
        admin_staff is restricted to assigned clients.
        """
        if PermissionService.is_super_admin(user):
            return True
        if PermissionService.is_admin_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if not staff:
                return False
            return staff.assigned_clients.filter(id=client_id).exists()
        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        return client.id == client_id

    @staticmethod
    def can_access_group(user, group: IDCardGroup) -> bool:
        """Check if user can access a specific group.
        super_admin has unrestricted access.
        admin_staff is restricted to assigned clients.
        client_staff: must have group in assigned_groups (empty = all groups).
        """
        if PermissionService.is_super_admin(user):
            return True
        if PermissionService.is_admin_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if not staff:
                return False
            return staff.assigned_clients.filter(id=group.client_id).exists()

        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        if group.client_id != client.id:
            return False

        # For client_staff with assigned groups: restrict to assigned only
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_table_ids = ClientAccessService._normalize_positive_int_ids(staff.assigned_table_ids or [])
                assigned_group_ids = list(staff.assigned_groups.values_list('id', flat=True))

                if assigned_group_ids and group.id in assigned_group_ids:
                    return True

                if assigned_table_ids:
                    return IDCardTable.objects.filter(
                        id__in=assigned_table_ids,
                        group_id=group.id,
                        group__client_id=group.client_id,
                        deleted_by_client=False,
                    ).exists()

                if assigned_group_ids:
                    return group.id in assigned_group_ids
        return True

    @staticmethod
    def can_access_table(user, table: IDCardTable) -> bool:
        """Check if user can access a specific table.
        super_admin has unrestricted access.
        admin_staff is restricted to assigned clients.
        client_staff: limited to assigned groups (empty assigned_groups = all groups).
        """
        if PermissionService.is_super_admin(user):
            return True
        if PermissionService.is_admin_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if not staff:
                return False
            return staff.assigned_clients.filter(id=table.group.client_id).exists()

        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        if table.group.client_id != client.id:
            return False

        # For client_staff with assigned groups: restrict to assigned groups only
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_table_ids = ClientAccessService._normalize_positive_int_ids(staff.assigned_table_ids or [])
                assigned_group_ids = list(staff.assigned_groups.values_list('id', flat=True))

                if assigned_table_ids and assigned_group_ids:
                    return (table.id in assigned_table_ids) or (table.group_id in assigned_group_ids)
                if assigned_table_ids:
                    return table.id in assigned_table_ids
                if assigned_group_ids:  # Empty means all groups are accessible
                    return table.group_id in assigned_group_ids
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
                assigned_table_ids = ClientAccessService._normalize_positive_int_ids(staff.assigned_table_ids or [])
                assigned_group_ids = list(staff.assigned_groups.values_list('id', flat=True))
                from idcards.models import IDCardTable as _IDCardTable

                if assigned_table_ids and assigned_group_ids:
                    return list(
                        _IDCardTable.objects.filter(
                            group__client=client,
                            deleted_by_client=False,
                        ).filter(
                            Q(id__in=assigned_table_ids) | Q(group_id__in=assigned_group_ids)
                        ).values_list('id', flat=True)
                    )

                if assigned_table_ids:
                    return list(
                        _IDCardTable.objects.filter(
                            group__client=client,
                            id__in=assigned_table_ids,
                            deleted_by_client=False,
                        ).values_list('id', flat=True)
                    )

                if assigned_group_ids:
                    return list(
                        _IDCardTable.objects.filter(
                            group__client=client,
                            group_id__in=assigned_group_ids,
                            deleted_by_client=False,
                        ).values_list('id', flat=True)
                    )
        return None  # None means no restriction (all client tables accessible)

    @staticmethod
    def can_access_card(user, card: IDCard) -> bool:
        """Check if user can access a specific card.
        super_admin has unrestricted access.
        admin_staff is restricted to assigned clients.

        NOTE: ``card`` should be fetched with
        ``.select_related('table__group')`` to avoid extra queries.
        """
        if PermissionService.is_super_admin(user):
            return True
        if PermissionService.is_admin_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if not staff:
                return False
            return staff.assigned_clients.filter(id=card.table.group.client_id).exists()

        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        if card.table.group.client_id != client.id:
            return False

        # For client_staff with assigned groups
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_table_ids = ClientAccessService._normalize_positive_int_ids(staff.assigned_table_ids or [])
                assigned_group_ids = list(staff.assigned_groups.values_list('id', flat=True))

                if assigned_table_ids and assigned_group_ids:
                    return (card.table_id in assigned_table_ids) or (card.table.group_id in assigned_group_ids)
                if assigned_table_ids:
                    return card.table_id in assigned_table_ids
                if assigned_group_ids:
                    return card.table.group_id in assigned_group_ids
        return True
