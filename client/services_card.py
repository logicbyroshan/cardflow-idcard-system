"""
Client Card Service — read and status-transition operations on ID cards.
"""
from typing import Optional, List, Any, Tuple

from django.utils.timezone import localtime
from django.db.models import Count, Q
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast
from django.db.models import CharField

from core.models import User
from client.models import Client
from staff.models import Staff
from idcards.models import IDCardGroup, IDCardTable, IDCard
from core.services.base import BaseService, ServiceResult
from core.services.permission_service import PermissionService
from mediafiles.utils import get_card_photo_url

from .services_access import ClientAccessService


class ClientCardService(BaseService):
    """
    Service for client card data access.
    Clients can view and manage cards within their tables.
    """
    
    VALID_STATUSES = ['pending', 'verified', 'pool', 'approved', 'download', 'reprint']

    @staticmethod
    def _normalize_positive_int_ids(raw_ids) -> List[int]:
        """Normalize mixed input IDs into unique positive integers."""
        if not isinstance(raw_ids, (list, tuple, set)):
            return []

        normalized: List[int] = []
        seen = set()
        for value in raw_ids:
            if isinstance(value, bool):
                continue
            try:
                parsed = int(str(value).strip())
            except (TypeError, ValueError):
                continue
            if parsed <= 0 or parsed in seen:
                continue
            seen.add(parsed)
            normalized.append(parsed)
        return normalized

    @staticmethod
    def _get_class_section_branch_fields(table):
        class_field = None
        section_field = None
        branch_field = None
        for field in (table.fields or []):
            ftype = str(field.get('type', '') or '').strip().lower()
            fname = str(field.get('name', '') or '').strip()
            lower = fname.lower()

            if not class_field and (ftype == 'class' or lower == 'class'):
                class_field = fname
                continue
            if not section_field and (ftype == 'section' or lower == 'section'):
                section_field = fname
                continue
            if not branch_field and (
                ftype == 'branch' or lower == 'branch' or lower == 'stream' or lower == 'course'
                or 'branch' in lower or 'stream' in lower or 'course' in lower
            ):
                branch_field = fname
        return class_field, section_field, branch_field

    @staticmethod
    def _dedupe_scope_values(values: Any) -> List[str]:
        out: List[str] = []
        seen = set()
        for value in values or []:
            text = str(value).strip()
            if not text:
                continue
            lowered = text.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            out.append(text)
        return out

    @classmethod
    def _table_scope_filters(cls, staff, table) -> Tuple[List[str], List[str], List[str]]:
        scopes = getattr(staff, 'assignment_scopes', None)
        if not isinstance(scopes, list) or not scopes:
            return (
                cls._dedupe_scope_values(staff.allowed_classes or []),
                cls._dedupe_scope_values(staff.allowed_sections or []),
                cls._dedupe_scope_values(staff.allowed_branches or []),
            )

        matched = []
        for scope in scopes:
            if not isinstance(scope, dict):
                continue
            stype = str(scope.get('scope_type', '') or '').strip().lower()
            sid = scope.get('scope_id')
            try:
                sid_int = int(str(sid).strip())
            except (TypeError, ValueError):
                continue

            if stype == 'table' and sid_int == int(table.id):
                matched.append(scope)
            elif stype == 'group' and sid_int == int(table.group_id):
                matched.append(scope)

        if not matched:
            return (
                cls._dedupe_scope_values(staff.allowed_classes or []),
                cls._dedupe_scope_values(staff.allowed_sections or []),
                cls._dedupe_scope_values(staff.allowed_branches or []),
            )

        classes: List[str] = []
        sections: List[str] = []
        branches: List[str] = []
        for scope in matched:
            classes.extend(scope.get('classes') or [])
            sections.extend(scope.get('sections') or [])
            branches.extend(scope.get('branches') or [])

        return (
            cls._dedupe_scope_values(classes),
            cls._dedupe_scope_values(sections),
            cls._dedupe_scope_values(branches),
        )

    @classmethod
    def _table_is_assigned_to_staff(cls, staff, table) -> bool:
        assigned_table_ids = set(cls._normalize_positive_int_ids(staff.assigned_table_ids or []))
        assigned_group_ids = set(staff.assigned_groups.values_list('id', flat=True))

        if assigned_table_ids and assigned_group_ids:
            return (int(table.id) in assigned_table_ids) or (int(table.group_id) in assigned_group_ids)
        if assigned_table_ids:
            return int(table.id) in assigned_table_ids
        if assigned_group_ids:
            return int(table.group_id) in assigned_group_ids
        return True

    @classmethod
    def _apply_client_staff_row_scope(cls, user, table, qs):
        if not PermissionService.is_client_staff(user):
            return qs

        staff = getattr(user, 'staff_profile', None)
        if not staff:
            return qs.none()

        if not cls._table_is_assigned_to_staff(staff, table):
            return qs.none()

        allowed_classes, allowed_sections, allowed_branches = cls._table_scope_filters(staff, table)

        class_field, section_field, branch_field = cls._get_class_section_branch_fields(table)

        if allowed_classes:
            if not class_field:
                return qs.none()
            qs = qs.annotate(_scope_cls=Cast(KeyTextTransform(class_field, 'field_data'), CharField())).filter(_scope_cls__in=allowed_classes)

        if allowed_sections:
            if not section_field:
                return qs.none()
            qs = qs.annotate(_scope_sec=Cast(KeyTextTransform(section_field, 'field_data'), CharField())).filter(_scope_sec__in=allowed_sections)

        if allowed_branches:
            if not branch_field:
                return qs.none()
            qs = qs.annotate(_scope_branch=Cast(KeyTextTransform(branch_field, 'field_data'), CharField())).filter(_scope_branch__in=allowed_branches)

        return qs
    
    @classmethod
    def get_tables_for_client(cls, user, client=None) -> ServiceResult:
        """
        Get all tables for the client with card counts.
        Accepts optional *client* override for admin roles.
        """
        try:
            if not client:
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

            if PermissionService.is_client_staff(user):
                staff = getattr(user, 'staff_profile', None)
                if not staff:
                    tables = tables.none()
                else:
                    assigned_table_ids = cls._normalize_positive_int_ids(staff.assigned_table_ids or [])
                    assigned_group_ids = list(staff.assigned_groups.values_list('id', flat=True))

                    if assigned_table_ids and assigned_group_ids:
                        tables = tables.filter(Q(id__in=assigned_table_ids) | Q(group_id__in=assigned_group_ids))
                    elif assigned_table_ids:
                        tables = tables.filter(id__in=assigned_table_ids)
                    elif assigned_group_ids:
                        tables = tables.filter(group_id__in=assigned_group_ids)
            
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
            if not client and not PermissionService.is_any_admin(user):
                return ServiceResult(success=False, message='Client profile not found')
            
            # Get table and verify ownership
            try:
                table = IDCardTable.objects.get(id=table_id)
            except IDCardTable.DoesNotExist:
                return ServiceResult(success=False, message='Table not found')
            
            if not ClientAccessService.can_access_table(user, table):
                return ServiceResult(success=False, message='Access denied')
            
            status_filter = (status_filter or '').strip().lower()

            # Enforce status-view permissions for both filtered and unfiltered requests.
            perm_map = {
                'pending': 'perm_idcard_pending_list',
                'verified': 'perm_idcard_verified_list',
                'pool': 'perm_idcard_pool_list',
                'approved': 'perm_idcard_approved_list',
                'download': 'perm_idcard_download_list',
                'reprint': 'perm_idcard_reprint_list',
            }

            if status_filter and status_filter not in cls.VALID_STATUSES:
                return ServiceResult(success=False, message='Invalid status filter')

            if status_filter:
                perm = perm_map.get(status_filter)
                if perm and not PermissionService.has_permission(user, perm):
                    return ServiceResult(
                        success=False,
                        message=f'No permission to view {status_filter} cards'
                    )

            allowed_statuses = [
                status for status, perm_name in perm_map.items()
                if PermissionService.has_permission(user, perm_name)
            ]
            if not allowed_statuses:
                return ServiceResult(success=False, message='No permission to view cards')
            
            # Build base query — newest batch/action first, Excel order within batch
            if status_filter == 'download':
                cards_query = IDCard.objects.filter(table=table).order_by('-downloaded_at', '-id')
            elif status_filter == 'pool':
                cards_query = IDCard.objects.filter(table=table).order_by('-deleted_at', '-id')
            elif status_filter in ('verified', 'approved'):
                cards_query = IDCard.objects.filter(table=table).order_by('-status_changed_at', 'id')
            else:
                cards_query = IDCard.objects.filter(table=table).order_by('-created_at', 'id')
            
            if status_filter:
                cards_query = cards_query.filter(status=status_filter)
            else:
                cards_query = cards_query.filter(status__in=allowed_statuses)

            cards_query = cls._apply_client_staff_row_scope(user, table, cards_query)
            
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
                    'photo_url': get_card_photo_url(card, field_data),
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
            if not client and not PermissionService.is_any_admin(user):
                return ServiceResult(success=False, message='Client profile not found')
            
            # Get card
            try:
                card = IDCard.objects.select_related('table', 'table__group').get(id=card_id)
            except IDCard.DoesNotExist:
                return ServiceResult(success=False, message='Card not found')
            
            # Verify ownership
            if not ClientAccessService.can_access_card(user, card):
                return ServiceResult(success=False, message='Access denied')

            scoped_card = cls._apply_client_staff_row_scope(
                user,
                card.table,
                IDCard.objects.filter(id=card.id, table_id=card.table_id),
            )
            if not scoped_card.exists():
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
                    'photo_url': get_card_photo_url(card, field_data),
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
            if not client and not PermissionService.is_any_admin(user):
                return ServiceResult(success=False, message='Client profile not found')
            
            # Get card
            try:
                card = IDCard.objects.select_related('table').get(id=card_id)
            except IDCard.DoesNotExist:
                return ServiceResult(success=False, message='Card not found')
            
            # Verify ownership
            if not ClientAccessService.can_access_card(user, card):
                return ServiceResult(success=False, message='Access denied')

            scoped_card = cls._apply_client_staff_row_scope(
                user,
                card.table,
                IDCard.objects.filter(id=card.id, table_id=card.table_id),
            )
            if not scoped_card.exists():
                return ServiceResult(success=False, message='Access denied')
            
            # Delegate entirely to WorkflowService (handles permissions + all guards)
            from idcards.services_workflow import WorkflowService
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
            if not client and not PermissionService.is_any_admin(user):
                return ServiceResult(success=False, message='Client profile not found')
            
            # Verify table ownership
            try:
                table = IDCardTable.objects.get(id=table_id)
            except IDCardTable.DoesNotExist:
                return ServiceResult(success=False, message='Table not found')
            
            if not ClientAccessService.can_access_table(user, table):
                return ServiceResult(success=False, message='Access denied')

            forbidden_ids = []
            if PermissionService.is_client_staff(user):
                normalized_ids = cls._normalize_positive_int_ids(card_ids or [])
                scoped_ids = set(
                    cls._apply_client_staff_row_scope(
                        user,
                        table,
                        IDCard.objects.filter(table=table, id__in=normalized_ids),
                    ).values_list('id', flat=True)
                )
                forbidden_ids = [cid for cid in normalized_ids if cid not in scoped_ids]

            if forbidden_ids:
                return ServiceResult(success=False, message='Some selected cards are outside assigned scope')
            
            # Delegate entirely to WorkflowService (handles permissions + all guards)
            from idcards.services_workflow import WorkflowService
            return WorkflowService.bulk_transition(table, card_ids, new_status, user=user)
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
