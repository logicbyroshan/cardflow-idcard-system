"""
Client Dashboard Service — aggregated statistics for the client dashboard.
"""
from django.utils.timezone import localtime
from django.db.models import Count, Q

from core.models import ActivityLog
from client.models import Client
from staff.models import Staff
from idcards.models import IDCardGroup, IDCardTable, IDCard
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

    @classmethod
    def get_reprint_stats(cls, user, client=None) -> ServiceResult:
        """
        Get reprint statistics for the client dashboard.
        
        Returns:
        - total_cards: Total ID cards across all tables
        - reprint_count: Total reprint requests (confirmed + downloaded)
        - recent_reprints: Last 10 reprint requests with card details
        """
        try:
            from reprintcard.models import ReprintRequest

            if not client:
                client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')

            groups = IDCardGroup.objects.filter(client=client, is_active=True)
            tables = IDCardTable.objects.filter(group__in=groups, is_active=True)

            total_cards = IDCard.objects.filter(table__in=tables).count()

            # Reprint counts (confirmed + downloaded = all processed reprints)
            reprint_qs = ReprintRequest.objects.filter(table__in=tables)
            reprint_confirmed = reprint_qs.filter(status='confirmed').count()
            reprint_downloaded = reprint_qs.filter(status='downloaded').count()
            reprint_total = reprint_confirmed + reprint_downloaded

            # Recent reprints (latest 10)
            recent_qs = (
                reprint_qs
                .filter(status__in=['confirmed', 'downloaded'])
                .select_related('card', 'table', 'requested_by')
                .order_by('-created_at')[:10]
            )
            recent_reprints = []
            for rr in recent_qs:
                fd = rr.card.field_data or {}
                # Try to get a display name from common field keys
                display_name = ''
                for key in ('Name', 'name', 'STUDENT NAME', 'EMPLOYEE NAME', 'Student Name'):
                    if fd.get(key):
                        display_name = fd[key]
                        break
                if not display_name:
                    # Fallback: first non-empty text field
                    for v in fd.values():
                        if isinstance(v, str) and v and not v.startswith(('PENDING:', '/')):
                            display_name = v
                            break

                req_by = rr.requested_by
                recent_reprints.append({
                    'rr_id': rr.id,
                    'card_id': rr.card_id,
                    'display_name': display_name or f'Card #{rr.card_id}',
                    'table_name': rr.table.name,
                    'status': rr.status,
                    'status_display': rr.get_status_display(),
                    'reason': rr.reason or '',
                    'requested_by': (req_by.get_full_name() or req_by.username) if req_by else 'System',
                    'created_at': localtime(rr.created_at).strftime('%d %b %Y, %H:%M'),
                })

            return ServiceResult(
                success=True,
                data={
                    'total_cards': total_cards,
                    'reprint_total': reprint_total,
                    'reprint_confirmed': reprint_confirmed,
                    'reprint_downloaded': reprint_downloaded,
                    'recent_reprints': recent_reprints,
                },
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))

    @classmethod
    def get_reprint_history(cls, user, client=None, limit=50) -> ServiceResult:
        """
        Get detailed reprint request history for the client dashboard table.
        Returns card details (first few text fields + photo) for each reprint request.
        """
        try:
            from reprintcard.models import ReprintRequest
            from mediafiles.services import ImageService

            if not client:
                client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')

            groups = IDCardGroup.objects.filter(client=client, is_active=True)
            tables = IDCardTable.objects.filter(group__in=groups, is_active=True)

            reprint_qs = (
                ReprintRequest.objects.filter(table__in=tables)
                .select_related('card', 'table', 'requested_by')
                .order_by('-created_at')[:limit]
            )

            # Build table fields lookup
            table_fields_map = {}
            for t in tables:
                table_fields_map[t.id] = t.fields or []

            items = []
            total_count = ReprintRequest.objects.filter(table__in=tables).count()

            for rr in reprint_qs:
                fd = rr.card.field_data or {}
                fields = table_fields_map.get(rr.table_id, [])

                # Collect first few text field values for display
                detail_parts = []
                photo_url = ''
                for f in fields:
                    fn = f.get('name', '')
                    ft = f.get('type', 'text')
                    val = fd.get(fn, '')
                    if ft in ('image', 'photo') or fn.upper() in ('PHOTO', 'F PHOTO', 'M PHOTO', 'SIGN', 'SIGN.', 'SIGNATURE', 'FATHER PHOTO', 'MOTHER PHOTO'):
                        if not photo_url:
                            img_path = ImageService.get_image_path_for_card(
                                card=rr.card, field_name=fn,
                                fallback_to_field_data=True, prefer_thumbnail=True
                            )
                            if img_path:
                                photo_url = f'/media/{img_path}'
                        continue
                    if val and isinstance(val, str) and not val.startswith(('PENDING:', '/')):
                        detail_parts.append(val)
                    if len(detail_parts) >= 4:
                        break

                req_by = rr.requested_by
                items.append({
                    'rr_id': rr.id,
                    'card_id': rr.card_id,
                    'details': ' | '.join(detail_parts) if detail_parts else f'Card #{rr.card_id}',
                    'photo_url': photo_url,
                    'table_name': rr.table.name,
                    'status': rr.status,
                    'status_display': rr.get_status_display(),
                    'reason': rr.reason or '',
                    'requested_by': (req_by.get_full_name() or req_by.username) if req_by else 'System',
                    'created_at': localtime(rr.created_at).strftime('%d %b %Y, %H:%M'),
                })

            return ServiceResult(
                success=True,
                data={
                    'items': items,
                    'total_count': total_count,
                },
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
