"""
Client Dashboard Service — aggregated statistics for the client dashboard.
"""
from django.utils.timezone import localtime
from django.db.models import Count, Q

from core.models import Client, Staff, IDCardGroup, IDCardTable, IDCard, ActivityLog
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
            
            # Recent activity — only show actions performed by client/client_staff of this org.
            # Never expose admin or admin_staff actions to client-side users.
            from django.contrib.auth import get_user_model
            UserModel = get_user_model()
            # Collect all user PKs belonging to this client org
            org_user_ids = list(
                UserModel.objects.filter(
                    Q(role='client', client_profile=client) |
                    Q(role='client_staff', staff_profile__client=client)
                ).values_list('pk', flat=True)
            )
            from django.utils.timesince import timesince
            from django.utils import timezone as tz
            now = tz.now()
            logs = (
                ActivityLog.objects
                .filter(user_id__in=org_user_ids)
                .select_related('user')
                .order_by('-created_at')[:6]
            )
            recent_activity = []
            for log in logs:
                icon_class, icon_color = ActivityLog.ACTION_ICONS.get(
                    log.action, ('fa-circle-info', 'edit')
                )
                recent_activity.append({
                    'description': log.description,
                    'time_ago': timesince(log.created_at, now),
                    'icon_class': icon_class,
                    'icon_color': icon_color,
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
