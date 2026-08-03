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
    def _assigned_group_ids_for_access(staff):
        """Return group IDs that explicitly grant group-level access.

        When assignment_scopes exist, only ``scope_type='group'`` entries should
        grant group-level access. Table scopes should not implicitly unlock all
        tables in the parent group.
        """
        cached = getattr(staff, '_cached_assigned_group_ids_for_access', None)
        if cached is not None:
            return cached

        scopes = getattr(staff, 'assignment_scopes', None)
        if isinstance(scopes, list) and scopes:
            explicit_group_ids = []
            seen = set()
            has_any_valid_scope = False

            for scope in scopes:
                if not isinstance(scope, dict):
                    continue
                stype = str(scope.get('scope_type', '') or '').strip().lower()
                if stype not in ('group', 'table'):
                    continue
                has_any_valid_scope = True
                if stype != 'group':
                    continue

                sid = scope.get('scope_id')
                try:
                    sid_int = int(str(sid).strip())
                except (TypeError, ValueError):
                    continue
                if sid_int <= 0 or sid_int in seen:
                    continue
                seen.add(sid_int)
                explicit_group_ids.append(sid_int)

            if has_any_valid_scope:
                setattr(staff, '_cached_assigned_group_ids_for_access', explicit_group_ids)
                return explicit_group_ids

        fallback_group_ids = list(staff.assigned_groups.values_list('id', flat=True))
        setattr(staff, '_cached_assigned_group_ids_for_access', fallback_group_ids)
        return fallback_group_ids

    @staticmethod
    def _assigned_table_ids_for_access(staff):
        """Return cached normalized assigned table IDs for client_staff checks.
        Checks both legacy assigned_table_ids field and new assignment_scopes.
        """
        cached = getattr(staff, '_cached_assigned_table_ids_for_access', None)
        if cached is not None:
            return cached

        scopes = getattr(staff, 'assignment_scopes', None)
        if isinstance(scopes, list) and scopes:
            explicit_table_ids = []
            seen = set()
            has_any_valid_scope = False

            for scope in scopes:
                if not isinstance(scope, dict):
                    continue
                stype = str(scope.get('scope_type', '') or '').strip().lower()
                if stype not in ('group', 'table'):
                    continue
                has_any_valid_scope = True
                if stype != 'table':
                    continue

                sid = scope.get('scope_id')
                try:
                    sid_int = int(str(sid).strip())
                except (TypeError, ValueError):
                    continue
                if sid_int <= 0 or sid_int in seen:
                    continue
                seen.add(sid_int)
                explicit_table_ids.append(sid_int)

            if has_any_valid_scope:
                setattr(staff, '_cached_assigned_table_ids_for_access', explicit_table_ids)
                return explicit_table_ids

        assigned_table_ids = ClientAccessService._normalize_positive_int_ids(
            staff.assigned_table_ids or []
        )
        setattr(staff, '_cached_assigned_table_ids_for_access', assigned_table_ids)
        return assigned_table_ids

    @staticmethod
    def _assigned_client_ids_for_access(staff):
        """Return cached assigned client IDs for admin_staff access checks.

        This avoids repeating the same M2M query multiple times during a
        single request where several can_access_* checks are performed.
        """
        cached = getattr(staff, '_cached_assigned_client_ids_for_access', None)
        if cached is not None:
            return cached

        assigned_ids = set(staff.assigned_clients.values_list('id', flat=True))
        setattr(staff, '_cached_assigned_client_ids_for_access', assigned_ids)
        return assigned_ids

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
            client_profile = getattr(user, 'client_profile', None)
            if client_profile is None:
                # Force fresh DB query if cache is stale
                from django.contrib.auth import get_user_model
                User = get_user_model()
                try:
                    fresh_user = User.objects.select_related('client_profile').get(pk=user.pk)
                    client_profile = getattr(fresh_user, 'client_profile', None)
                except Exception:
                    pass
            return client_profile

        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff is None:
                # Force fresh DB query if cache is stale
                from django.contrib.auth import get_user_model
                User = get_user_model()
                try:
                    fresh_user = User.objects.select_related('staff_profile__client').get(pk=user.pk)
                    staff = getattr(fresh_user, 'staff_profile', None)
                except Exception:
                    pass
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
            return client_id in ClientAccessService._assigned_client_ids_for_access(staff)
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
            return group.client_id in ClientAccessService._assigned_client_ids_for_access(staff)

        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        if group.client_id != client.id:
            return False

        # For client_staff with assigned groups: restrict to assigned only
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_table_ids = ClientAccessService._assigned_table_ids_for_access(staff)
                assigned_group_ids = ClientAccessService._assigned_group_ids_for_access(staff)

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
            return table.group.client_id in ClientAccessService._assigned_client_ids_for_access(staff)

        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        if table.group.client_id != client.id:
            return False

        # For client_staff with assigned groups: restrict to assigned groups only
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_table_ids = ClientAccessService._assigned_table_ids_for_access(staff)
                assigned_group_ids = ClientAccessService._assigned_group_ids_for_access(staff)

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
                assigned_table_ids = ClientAccessService._assigned_table_ids_for_access(staff)
                assigned_group_ids = ClientAccessService._assigned_group_ids_for_access(staff)
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
            return card.table.group.client_id in ClientAccessService._assigned_client_ids_for_access(staff)

        client = ClientAccessService.get_client_for_user(user)
        if client is None:
            return False
        if card.table.group.client_id != client.id:
            return False

        # For client_staff with assigned groups
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_table_ids = ClientAccessService._assigned_table_ids_for_access(staff)
                assigned_group_ids = ClientAccessService._assigned_group_ids_for_access(staff)

                if assigned_table_ids and assigned_group_ids:
                    return (card.table_id in assigned_table_ids) or (card.table.group_id in assigned_group_ids)
                if assigned_table_ids:
                    return card.table_id in assigned_table_ids
                if assigned_group_ids:
                    return card.table.group_id in assigned_group_ids
        return True
