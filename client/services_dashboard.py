"""
Client Dashboard Service — aggregated statistics for the client dashboard.
"""
import logging
from collections import defaultdict

from django.core.cache import cache
from django.utils.timezone import localtime
from django.db.models import Count, Q

from core.services.activity_service import ActivityService
from core.services.cache_version_service import CacheVersionService
from core.services.session_revalidation import get_user_revalidation_marker
from client.models import Client
from staff.models import Staff
from idcards.models import IDCardGroup, IDCardTable, IDCard
from reprintcard.models import ReprintRequest
from core.services.base import BaseService, ServiceResult
from core.services.permission_service import PermissionService

from .services_access import ClientAccessService
from .services_card import ClientCardService

logger = logging.getLogger(__name__)


class ClientDashboardService(BaseService):
    """
    Service for client dashboard data.
    """

    DASHBOARD_COUNTS_CACHE_TTL = 20
    STAFF_SCOPED_TABLE_COUNTS_CACHE_TTL = 20
    GROUP_COUNTS_CACHE_TTL = 20
    STAFF_COUNT_CACHE_TTL = 60
    
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

        mediafiles_marker = '/mediafiles/'
        media_marker = '/media/'

        mediafiles_idx = lower.find(mediafiles_marker)
        if mediafiles_idx >= 0:
            return '/media/mediafiles/' + value[mediafiles_idx + len(mediafiles_marker):].lstrip('/')

        media_idx = lower.find(media_marker)
        if media_idx >= 0:
            remainder = value[media_idx + len(media_marker):].lstrip('/')
            if remainder.lower().startswith('mediafiles/'):
                return '/media/' + remainder
            return '/media/' + remainder

        if lower.startswith('/mediafiles/'):
            return '/media/' + value.lstrip('/')
        if lower.startswith('mediafiles/'):
            return '/media/' + value.lstrip('/')
        if lower.startswith('media/'):
            return '/' + value

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

    @staticmethod
    def _status_template():
        return {
            'pending': 0,
            'verified': 0,
            'pool': 0,
            'approved': 0,
            'download': 0,
        }

    @staticmethod
    def _scope_marker(user) -> str:
        return str(get_user_revalidation_marker(getattr(user, 'pk', None)) or '')

    @classmethod
    def _client_card_counts_version(cls, client_id: int) -> int:
        return CacheVersionService.get('client_dash_counts', f'client:{client_id}')

    @classmethod
    def _client_staff_version(cls, client_id: int) -> int:
        return CacheVersionService.get('client_staff', f'client:{client_id}')

    @classmethod
    def _dashboard_counts_cache_key(cls, user, client_id: int, marker: str, counts_version: int) -> str:
        return f'client:dash:counts:v3:{user.pk}:{client_id}:{counts_version}:{marker}'

    @classmethod
    def _dashboard_staff_table_counts_cache_key(cls, user, table_id: int, marker: str, counts_version: int) -> str:
        return f'client:dash:staff_table_counts:v3:{user.pk}:{table_id}:{counts_version}:{marker}'

    @classmethod
    def _groups_counts_cache_key(cls, user, client_id: int, marker: str, counts_version: int) -> str:
        return f'client:dash:groups_counts:v3:{user.pk}:{client_id}:{counts_version}:{marker}'

    @classmethod
    def _group_staff_table_counts_cache_key(cls, user, table_id: int, marker: str, counts_version: int) -> str:
        return f'client:dash:group_staff_table_counts:v3:{user.pk}:{table_id}:{counts_version}:{marker}'

    @classmethod
    def _staff_count_cache_key(cls, client_id: int, staff_version: int) -> str:
        return f'client:dash:staff_count:v2:{client_id}:{staff_version}'

    @classmethod
    def _accumulate_status_rows(cls, counts: dict, rows):
        for row in rows:
            status = row.get('status')
            if status in counts:
                counts[status] += int(row.get('count', 0) or 0)

    @classmethod
    def _accumulate_status_map(cls, counts: dict, status_map: dict):
        for status, count in (status_map or {}).items():
            if status in counts:
                counts[status] += int(count or 0)

    @classmethod
    def _build_reprint_history_item(cls, request_obj) -> dict:
        card = getattr(request_obj, 'card', None)
        table = getattr(request_obj, 'table', None)
        field_data = card.field_data if card and isinstance(getattr(card, 'field_data', None), dict) else {}

        photo_url = ''
        try:
            from mediafiles.services.image_service import ImageService

            table_fields = getattr(table, 'fields', None) if table else None
            field_names = []
            if isinstance(table_fields, list):
                for field in table_fields:
                    if isinstance(field, dict):
                        field_name = str(field.get('name', '') or '').strip()
                        if field_name:
                            field_names.append(field_name)
                    elif isinstance(field, str) and field.strip():
                        field_names.append(field.strip())

            candidate_names = []
            for field_name in field_names:
                lowered = field_name.lower()
                if 'photo' in lowered or 'image' in lowered or 'avatar' in lowered:
                    candidate_names.append(field_name)
            if not candidate_names:
                candidate_names = field_names

            for field_name in candidate_names:
                try:
                    path = ImageService.get_image_path_for_export(card, field_name)
                except Exception:
                    path = None
                if path:
                    photo_url = cls._to_dashboard_photo_url(path)
                    break
        except Exception:
            logger.debug('Reprint photo resolution failed for request_id=%s', getattr(request_obj, 'id', None), exc_info=True)

        if not photo_url and card:
            try:
                from mediafiles.utils import get_card_photo_url

                photo_url = cls._to_dashboard_photo_url(get_card_photo_url(card, field_data) or '')
            except Exception:
                photo_url = ''

        details_bits = []
        if card:
            details_bits.append(f'Card #{card.id}')
        if table and getattr(table, 'name', ''):
            details_bits.append(str(table.name).strip())

        if not details_bits:
            details_bits.append('Reprint request')

        return {
            'id': request_obj.id,
            'status': request_obj.status,
            'status_display': request_obj.get_status_display(),
            'card_id': getattr(card, 'id', None),
            'table_id': getattr(table, 'id', None),
            'table_name': getattr(table, 'name', '') or '',
            'details': ' - '.join(details_bits),
            'photo_url': photo_url,
            'created_at': request_obj.created_at.isoformat() if request_obj.created_at else None,
            'updated_at': request_obj.updated_at.isoformat() if request_obj.updated_at else None,
        }

    @classmethod
    def get_reprint_history(cls, user) -> ServiceResult:
        """Return the client's reprint request history."""
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')

            reprint_qs = (
                ReprintRequest.objects
                .select_related('card', 'table', 'table__group')
                .filter(table__group__client=client)
                .order_by('-created_at', '-id')
            )

            items = [cls._build_reprint_history_item(req) for req in reprint_qs]
            stats = reprint_qs.aggregate(
                reprint_requested=Count('id', filter=Q(status='requested')),
                reprint_confirmed=Count('id', filter=Q(status='confirmed')),
                reprint_total=Count('id'),
            )

            return ServiceResult(
                success=True,
                data={
                    'items': items,
                    'total_count': stats['reprint_total'] or 0,
                    'reprint_requested': stats['reprint_requested'] or 0,
                    'reprint_confirmed': stats['reprint_confirmed'] or 0,
                    'reprint_total': stats['reprint_total'] or 0,
                },
            )
        except Exception as e:
            return cls._unexpected_error_result('get_reprint_history', e)

    @classmethod
    def get_reprint_stats(cls, user) -> ServiceResult:
        """Return the client's reprint counts for dashboard summaries."""
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')

            counts = (
                ReprintRequest.objects
                .filter(table__group__client=client)
                .aggregate(
                    reprint_requested=Count('id', filter=Q(status='requested')),
                    reprint_confirmed=Count('id', filter=Q(status='confirmed')),
                    reprint_total=Count('id'),
                )
            )
            return ServiceResult(
                success=True,
                data={
                    'reprint_requested': counts['reprint_requested'] or 0,
                    'reprint_confirmed': counts['reprint_confirmed'] or 0,
                    'reprint_total': counts['reprint_total'] or 0,
                },
            )
        except Exception as e:
            return cls._unexpected_error_result('get_reprint_stats', e)

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
                user_role = getattr(user, 'role', 'unknown')
                client_profile = getattr(user, 'client_profile', None)
                staff_profile = getattr(user, 'staff_profile', None)
                logger.warning(
                    'ClientDashboardService.get_dashboard_data: Client not found for user_id=%s role=%s has_client_profile=%s has_staff_profile=%s',
                    user.pk, user_role, client_profile is not None, staff_profile is not None
                )
                return ServiceResult(
                    success=False, 
                    message='Client profile not found'
                )

            tables = list(
                cls._get_accessible_tables_qs(user, client)
                .only('id', 'group_id', 'fields')
            )
            table_ids = [table.id for table in tables]
            counts = cls._status_template()

            if table_ids:
                if PermissionService.is_client_staff(user):
                    staff = getattr(user, 'staff_profile', None)

                    # Only evaluate tables that have explicit row-level scope for this staff.
                    # If a staff member has no class/section/branch filters, dashboard
                    # summary counts should stay at zero even though table access may exist.
                    for table in tables:
                        table_scope = ClientCardService._table_scope_filters(staff, table)
                        if not any(table_scope):
                            continue
                        scoped_qs = ClientCardService._apply_client_staff_row_scope(
                            user,
                            table,
                            IDCard.objects.filter(table_id=table.id),
                        )
                        table_status_map = {
                            row['status']: int(row.get('count', 0) or 0)
                            for row in scoped_qs.values('status').annotate(count=Count('id'))
                            if row.get('status')
                        }
                        cls._accumulate_status_map(counts, table_status_map)
                else:
                    status_rows = IDCard.objects.filter(
                        table_id__in=table_ids
                    ).values('status').annotate(count=Count('id'))
                    cls._accumulate_status_rows(counts, status_rows)

            table_count = len(table_ids)
            group_count = len({table.group_id for table in tables})
            
            # Total cards - exclude 'pool' status
            total_cards = counts['pending'] + counts['verified'] + counts['approved'] + counts['download']

            # Get staff count (client_staff under this client)
            staff_count = Staff.objects.filter(
                client=client,
                staff_type='client_staff'
            ).count()
            
            # Use centralized role-aware activity feed so legacy per-card logs are merged.
            # Keep dashboard counts resilient if the activity feed hits a malformed row.
            try:
                recent_activity = ActivityService.get_recent(limit=6, hours=None, user=user)
            except Exception as activity_exc:
                logger.warning(
                    'ClientDashboardService.get_dashboard_data: recent activity load failed for user_id=%s role=%s: %s',
                    user.pk,
                    getattr(user, 'role', 'unknown'),
                    activity_exc,
                )
                recent_activity = []
            
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
            logger.exception(
                'ClientDashboardService.get_dashboard_data failed for user_id=%s role=%s: %s',
                user.pk, getattr(user, 'role', 'unknown'), str(e)
            )
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

            marker = cls._scope_marker(user)
            counts_version = cls._client_card_counts_version(client.id)
            cache_key = cls._groups_counts_cache_key(user, client.id, marker, counts_version)
            cached_groups = cache.get(cache_key)
            if cached_groups is not None:
                return ServiceResult(success=True, data={'groups': cached_groups})

            accessible_tables = list(
                cls._get_accessible_tables_qs(user, client)
                .select_related('group')
                .only('id', 'name', 'is_active', 'fields', 'group_id', 'group__id', 'group__name')
            )
            if not accessible_tables:
                cache.set(cache_key, [], cls.GROUP_COUNTS_CACHE_TTL)
                return ServiceResult(success=True, data={'groups': []})

            table_ids = [table.id for table in accessible_tables]
            group_ids = sorted({table.group_id for table in accessible_tables})

            groups = IDCardGroup.objects.filter(
                client=client,
                id__in=group_ids,
            ).only('id', 'name', 'is_active', 'created_at')

            table_card_counts = {}
            group_counts_map = defaultdict(dict)

            if PermissionService.is_client_staff(user):
                # Same rule as get_dashboard_data(): apply row-scope across every
                # accessible table that has explicit row-level filters.
                for table in accessible_tables:
                    table_scope = ClientCardService._table_scope_filters(getattr(user, 'staff_profile', None), table)
                    if not any(table_scope):
                        continue
                    table_cache_key = cls._group_staff_table_counts_cache_key(
                        user,
                        table.id,
                        marker,
                        counts_version,
                    )
                    table_status_map = cache.get(table_cache_key)
                    if table_status_map is None:
                        scoped_qs = ClientCardService._apply_client_staff_row_scope(
                            user,
                            table,
                            IDCard.objects.filter(table_id=table.id),
                        )
                        table_status_map = {
                            row['status']: int(row.get('count', 0) or 0)
                            for row in scoped_qs.values('status').annotate(count=Count('id'))
                            if row.get('status')
                        }
                        cache.set(
                            table_cache_key,
                            table_status_map,
                            cls.STAFF_SCOPED_TABLE_COUNTS_CACHE_TTL,
                        )

                    table_card_counts[table.id] = sum(int(v or 0) for v in table_status_map.values())
                    group_bucket = group_counts_map[table.group_id]
                    for status, count in table_status_map.items():
                        group_bucket[status] = group_bucket.get(status, 0) + int(count or 0)
            else:
                base_table_counts = IDCard.objects.filter(
                    table_id__in=table_ids
                ).values('table_id').annotate(count=Count('id'))
                table_card_counts = {
                    row['table_id']: int(row.get('count', 0) or 0)
                    for row in base_table_counts
                }

                base_group_counts = IDCard.objects.filter(
                    table_id__in=table_ids
                ).values('table__group_id', 'status').annotate(count=Count('id'))
                for row in base_group_counts:
                    gid = row['table__group_id']
                    status = row.get('status')
                    if status:
                        group_counts_map[gid][status] = int(row.get('count', 0) or 0)

            tables_by_group = defaultdict(list)
            for table in accessible_tables:
                tables_by_group[table.group_id].append(table)

            groups_data = []
            for group in groups:
                group_tables = tables_by_group.get(group.id, [])
                counts = group_counts_map.get(group.id, {})
                total = sum(int(v or 0) for v in counts.values())

                tables_data = [{
                    'id': table.id,
                    'name': table.name,
                    'is_active': table.is_active,
                    'card_count': table_card_counts.get(table.id, 0),
                } for table in group_tables]

                groups_data.append({
                    'id': group.id,
                    'name': group.name,
                    'is_active': group.is_active,
                    'created_at': group.created_at.strftime('%Y-%m-%dT%H:%M:%S') if group.created_at else None,
                    'table_count': len(tables_data),
                    'card_count': total,
                    'total_cards': total,
                    'pending_count': counts.get('pending', 0),
                    'pending': counts.get('pending', 0),
                    'verified': counts.get('verified', 0),
                    'pool': counts.get('pool', 0),
                    'approved': counts.get('approved', 0),
                    'download': counts.get('download', 0),
                    'tables': tables_data,
                })

            cache.set(cache_key, groups_data, cls.GROUP_COUNTS_CACHE_TTL)
            return ServiceResult(success=True, data={'groups': groups_data})
            
        except Exception as e:
            return cls._unexpected_error_result('get_groups_with_counts', e)
