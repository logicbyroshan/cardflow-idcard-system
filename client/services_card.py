"""
Client Card Service — read and status-transition operations on ID cards.
"""
from typing import Optional, List

from django.utils.timezone import localtime
from django.db.models import Count, Q

from core.models import User
from client.models import Client
from staff.models import Staff
from idcards.models import IDCardGroup, IDCardTable, IDCard
from core.services.base import BaseService, ServiceResult
from core.services.permission_service import PermissionService

from .services_access import ClientAccessService


class ClientCardService(BaseService):
    """
    Service for client card data access.
    Clients can view and manage cards within their tables.
    """
    
    VALID_STATUSES = ['pending', 'verified', 'pool', 'approved', 'download', 'reprint']
    
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
            if not client and not PermissionService.is_any_admin(user):
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
