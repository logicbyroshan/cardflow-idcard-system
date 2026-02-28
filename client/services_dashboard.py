"""
Client Dashboard Service — aggregated statistics for the client dashboard.
"""
from django.utils.timezone import localtime
from django.db.models import Count, Q

from core.models import Client, Staff, IDCardGroup, IDCardTable, IDCard
from core.services.base import BaseService, ServiceResult

from .services_access import ClientAccessService


class ClientDashboardService(BaseService):
    """
    Service for client dashboard data.
    """
    
    @classmethod
    def get_dashboard_data(cls, user, client=None) -> ServiceResult:
        """
        Get dashboard summary data for a client user.
        
        Returns counts of cards by status for all tables belonging to the client.
        Accepts optional *client* override so admin roles (whose
        ``get_client_for_user`` returns ``None``) can view a specific client.
        """
        try:
            if not client:
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
