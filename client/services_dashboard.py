"""
Client Dashboard Service — aggregated statistics for the client dashboard.
"""
import logging

from django.utils.timezone import localtime
from django.db.models import Count, Q, Prefetch

from core.services.activity_service import ActivityService
from client.models import Client
from staff.models import Staff
from idcards.models import IDCardGroup, IDCardTable, IDCard
from core.services.base import BaseService, ServiceResult
from core.services.permission_service import PermissionService

from .services_access import ClientAccessService
from .services_card import ClientCardService

logger = logging.getLogger(__name__)


class ClientDashboardService(BaseService):
    """
    Service for client dashboard data.
    """
    
    @staticmethod
    def _normalized_assigned_table_ids(staff):
        return [
            int(v) for v in (getattr(staff, 'assigned_table_ids', None) or [])
            if str(v).strip().isdigit() and int(v) > 0
        ]

    @staticmethod
    def _assigned_group_ids_for_access(staff):
        scopes = getattr(staff, 'assignment_scopes', None)
        if isinstance(scopes, list) and scopes:
            group_ids = []
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
                group_ids.append(sid_int)
            if has_any_valid_scope:
                return group_ids

        return list(staff.assigned_groups.values_list('id', flat=True))

    @staticmethod
    def _unexpected_error_result(action: str, exc: Exception) -> ServiceResult:
        logger.exception('ClientDashboardService.%s failed: %s', action, exc)
        return ServiceResult(success=False, message='An unexpected error occurred. Please try again.')

    @staticmethod
    def _to_dashboard_photo_url(raw_path: str) -> str:
        value = str(raw_path or '').strip()
        if not value:
            return ''

        value = value.replace('\\', '/')
        while '//' in value:
            value = value.replace('//', '/')

        lower = value.lower()
        if lower.startswith('http://') or lower.startswith('https://'):
            return value
        if lower.startswith('/media/'):
            return value
        if lower.startswith('/mediafiles/'):
            return '/media/' + value.lstrip('/')
        if lower.startswith('media/') or lower.startswith('mediafiles/'):
            if lower.startswith('media/'):
                return '/' + value
            return '/media/' + value

        mediafiles_marker = '/mediafiles/'
        media_marker = '/media/'
        mediafiles_idx = lower.find(mediafiles_marker)
        if mediafiles_idx >= 0:
            return '/media/mediafiles/' + value[mediafiles_idx + len(mediafiles_marker):].lstrip('/')

        media_idx = lower.find(media_marker)
        if media_idx >= 0:
            return '/media/' + value[media_idx + len(media_marker):].lstrip('/')

        return '/media/' + value.lstrip('/')

    @classmethod
    def _get_accessible_tables_qs(cls, user, client):
        tables = IDCardTable.objects.filter(group__client=client, is_active=True)

        if not PermissionService.is_client_staff(user):
            return tables

        staff = getattr(user, 'staff_profile', None)
        if not staff:
            return tables.none()

        assigned_table_ids = cls._normalized_assigned_table_ids(staff)
        assigned_group_ids = cls._assigned_group_ids_for_access(staff)

        if assigned_table_ids and assigned_group_ids:
            return tables.filter(Q(id__in=assigned_table_ids) | Q(group_id__in=assigned_group_ids))
        if assigned_table_ids:
            return tables.filter(id__in=assigned_table_ids)
        if assigned_group_ids:
            return tables.filter(group_id__in=assigned_group_ids)

        return tables

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
            
            tables = cls._get_accessible_tables_qs(user, client)

            counts = {
                'pending': 0,
                'verified': 0,
                'pool': 0,
                'approved': 0,
                'download': 0,
                'reprint': 0,
            }

            if PermissionService.is_client_staff(user):
                for table in tables:
                    scoped_qs = ClientCardService._apply_client_staff_row_scope(
                        user,
                        table,
                        IDCard.objects.filter(table=table),
                    )
                    for item in scoped_qs.values('status').annotate(count=Count('id')):
                        status = item.get('status')
                        if status in counts:
                            counts[status] += item.get('count', 0)
            else:
                status_counts = IDCard.objects.filter(
                    table__in=tables
                ).values('status').annotate(count=Count('id'))
                for item in status_counts:
                    if item['status'] in counts:
                        counts[item['status']] = item['count']

            table_meta = tables.aggregate(
                table_count=Count('id'),
                group_count=Count('group_id', distinct=True),
            )
            
            # Total cards - exclude 'pool' status
            total_cards = counts['pending'] + counts['verified'] + counts['approved'] + counts['download']
            
            # Get group count and table count (scoped for client_staff)
            group_count = int(table_meta.get('group_count') or 0)
            table_count = int(table_meta.get('table_count') or 0)
            
            # Get staff count (client_staff under this client)
            staff_count = Staff.objects.filter(
                client=client, 
                staff_type='client_staff'
            ).count()
            
            # Use centralized role-aware activity feed so legacy per-card logs are merged.
            recent_activity = ActivityService.get_recent(limit=6, hours=None, user=user)
            
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
            return cls._unexpected_error_result('get_dashboard_data', e)
    
    @classmethod
    def get_groups_with_counts(cls, user) -> ServiceResult:
        """
        Get all groups with card status counts for the client.
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            accessible_tables_qs = cls._get_accessible_tables_qs(user, client).select_related('group')
            accessible_group_ids = list(
                accessible_tables_qs.values_list('group_id', flat=True).distinct()
            )

            groups = IDCardGroup.objects.filter(
                client=client,
                id__in=accessible_group_ids,
            ).prefetch_related(
                Prefetch('tables', queryset=accessible_tables_qs)
            )

            table_card_counts = {}
            group_counts_map = {}

            if PermissionService.is_client_staff(user):
                for table in accessible_tables_qs:
                    scoped_qs = ClientCardService._apply_client_staff_row_scope(
                        user,
                        table,
                        IDCard.objects.filter(table=table),
                    )
                    status_rows = list(scoped_qs.values('status').annotate(count=Count('id')))
                    table_card_counts[table.id] = sum(int(row.get('count', 0) or 0) for row in status_rows)
                    for row in status_rows:
                        gid = table.group_id
                        if gid not in group_counts_map:
                            group_counts_map[gid] = {}
                        group_counts_map[gid][row['status']] = (
                            group_counts_map[gid].get(row['status'], 0) + row['count']
                        )
            else:
                table_card_counts = dict(
                    accessible_tables_qs.annotate(cc=Count('id_cards')).values_list('id', 'cc')
                )
                group_status_qs = IDCard.objects.filter(
                    table__in=accessible_tables_qs
                ).values('table__group_id', 'status').annotate(count=Count('id'))
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
            return cls._unexpected_error_result('get_groups_with_counts', e)

    @classmethod
    def get_reprint_stats(cls, user, client=None) -> ServiceResult:
        """
        Get reprint statistics for the client dashboard.
        
        Returns:
        - total_cards: Total ID cards across all tables
        - reprint_count: Total reprint requests (requested + confirmed + downloaded)
        - recent_reprints: Last 10 reprint requests with card details
        """
        try:
            from reprintcard.models import ReprintRequest

            if not client:
                client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')

            tables = IDCardTable.objects.filter(
                group__client=client,
                deleted_by_client=False,
            ).only('id')

            total_cards = IDCard.objects.filter(table__in=tables).count()

            # Reprint counts for dashboard visibility.
            reprint_qs = ReprintRequest.objects.filter(table__in=tables)
            status_counts = reprint_qs.aggregate(
                requested=Count('id', filter=Q(status='requested')),
                confirmed=Count('id', filter=Q(status='confirmed')),
                downloaded=Count('id', filter=Q(status='downloaded')),
            )
            reprint_requested = status_counts.get('requested', 0) or 0
            reprint_confirmed = status_counts.get('confirmed', 0) or 0
            reprint_downloaded = status_counts.get('downloaded', 0) or 0
            reprint_total = reprint_requested + reprint_confirmed + reprint_downloaded

            # Recent reprints (latest 10)
            recent_qs = (
                reprint_qs
                .filter(status__in=['requested', 'confirmed', 'downloaded'])
                .select_related('card', 'table', 'requested_by')
                .only(
                    'id', 'card_id', 'table_id', 'status', 'reason', 'created_at',
                    'card__field_data', 'table__name',
                    'requested_by__first_name', 'requested_by__last_name', 'requested_by__username',
                )
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
                    'reprint_requested': reprint_requested,
                    'reprint_confirmed': reprint_confirmed,
                    'reprint_downloaded': reprint_downloaded,
                    'recent_reprints': recent_reprints,
                },
            )
        except Exception as e:
            return cls._unexpected_error_result('get_reprint_stats', e)

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

            tables = IDCardTable.objects.filter(
                group__client=client,
                deleted_by_client=False,
            ).only('id', 'fields')

            reprint_qs = (
                ReprintRequest.objects.filter(table__in=tables)
                .select_related('card', 'table', 'requested_by')
                .only(
                    'id', 'card_id', 'table_id', 'status', 'reason', 'created_at',
                    'card__field_data', 'table__name',
                    'requested_by__first_name', 'requested_by__last_name', 'requested_by__username',
                )
                .order_by('-created_at')[:limit]
            )

            # Build table fields lookup
            table_fields_map = {}
            for t in tables:
                table_fields_map[t.id] = t.fields or []

            def _looks_like_image_field(field_type, field_name):
                ft = str(field_type or '').strip().lower()
                fn = str(field_name or '').strip().lower()
                if ft in ('image', 'photo', 'file'):
                    return True
                if 'designation' in fn:
                    return False
                return (
                    ('image' in ft) or ('photo' in ft) or ('file' in ft) or ('upload' in ft) or
                    ('photo' in fn) or ('image' in fn) or ('picture' in fn) or ('pic' in fn) or
                    ('signature' in fn) or ('barcode' in fn) or ('qr' in fn)
                )

            items = []
            total_count = ReprintRequest.objects.filter(table__in=tables).count()

            for rr in reprint_qs:
                try:
                    fd = rr.card.field_data if isinstance(rr.card.field_data, dict) else {}
                except Exception:
                    fd = {}

                raw_fields = table_fields_map.get(rr.table_id, [])
                if isinstance(raw_fields, list):
                    fields = [f for f in raw_fields if isinstance(f, dict)]
                elif isinstance(raw_fields, dict):
                    fields = [raw_fields]
                else:
                    fields = []

                # Collect first few text field values for display
                detail_parts = []
                photo_url = ''
                for f in fields:
                    fn = str(f.get('name', '') or '')
                    ft = str(f.get('type', 'text') or 'text')
                    val = fd.get(fn, '')
                    if _looks_like_image_field(ft, fn):
                        if not photo_url:
                            try:
                                img_path = ImageService.get_image_path_for_export(
                                    rr.card,
                                    fn,
                                    prefer_thumbnail=True,
                                    fallback_to_field_data=True,
                                )
                                if img_path:
                                    photo_url = cls._to_dashboard_photo_url(img_path)
                            except Exception:
                                logger.warning('Reprint history image resolution failed rr_id=%s field=%s', rr.id, fn)
                        continue
                    val_text = str(val or '').strip()
                    if val_text and not val_text.startswith(('PENDING:', '/')):
                        detail_parts.append(val_text)
                    if len(detail_parts) >= 4:
                        break

                if not photo_url and isinstance(fd, dict):
                    key_by_upper = {str(k or '').strip().upper(): k for k in fd.keys()}
                    for fallback_name in (
                        'PHOTO', 'STUDENT PHOTO', 'IMAGE', 'PICTURE', 'PIC',
                        'F PHOTO', 'M PHOTO', 'FATHER PHOTO', 'MOTHER PHOTO',
                        'SIGN', 'SIGN.', 'SIGNATURE',
                    ):
                        source_key = key_by_upper.get(fallback_name)
                        if not source_key:
                            continue
                        try:
                            img_path = ImageService.get_image_path_for_export(
                                rr.card,
                                source_key,
                                prefer_thumbnail=True,
                                fallback_to_field_data=True,
                            )
                            if img_path:
                                photo_url = cls._to_dashboard_photo_url(img_path)
                                break
                        except Exception:
                            logger.warning('Reprint history fallback image resolution failed rr_id=%s field=%s', rr.id, source_key)

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
            return cls._unexpected_error_result('get_reprint_history', e)
