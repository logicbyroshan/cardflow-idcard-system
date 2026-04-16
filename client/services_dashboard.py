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

    @staticmethod
    def _status_template():
        return {
            'pending': 0,
            'verified': 0,
            'pool': 0,
            'approved': 0,
            'download': 0,
            'reprint': 0,
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

            tables = list(
                cls._get_accessible_tables_qs(user, client)
                .only('id', 'group_id', 'fields')
            )
            table_ids = [table.id for table in tables]
            counts = cls._status_template()

            if table_ids:
                if PermissionService.is_client_staff(user):
                    staff = getattr(user, 'staff_profile', None)
                    unrestricted_table_ids = []
                    restricted_tables = []

                    if staff is not None:
                        for table in tables:
                            allowed_classes, allowed_sections, allowed_branches = ClientCardService._table_scope_filters(staff, table)
                            if allowed_classes or allowed_sections or allowed_branches:
                                restricted_tables.append(table)
                            else:
                                unrestricted_table_ids.append(table.id)

                    if unrestricted_table_ids:
                        unrestricted_rows = IDCard.objects.filter(
                            table_id__in=unrestricted_table_ids
                        ).values('status').annotate(count=Count('id'))
                        cls._accumulate_status_rows(counts, unrestricted_rows)

                    for table in restricted_tables:
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
                staff = getattr(user, 'staff_profile', None)
                unrestricted_table_ids = []
                restricted_tables = []

                if staff is not None:
                    for table in accessible_tables:
                        allowed_classes, allowed_sections, allowed_branches = ClientCardService._table_scope_filters(staff, table)
                        if allowed_classes or allowed_sections or allowed_branches:
                            restricted_tables.append(table)
                        else:
                            unrestricted_table_ids.append(table.id)

                if unrestricted_table_ids:
                    base_table_counts = IDCard.objects.filter(
                        table_id__in=unrestricted_table_ids
                    ).values('table_id').annotate(count=Count('id'))
                    for row in base_table_counts:
                        table_card_counts[row['table_id']] = int(row.get('count', 0) or 0)

                    base_group_counts = IDCard.objects.filter(
                        table_id__in=unrestricted_table_ids
                    ).values('table__group_id', 'status').annotate(count=Count('id'))
                    for row in base_group_counts:
                        gid = row['table__group_id']
                        status = row.get('status')
                        if status:
                            group_counts_map[gid][status] = group_counts_map[gid].get(status, 0) + int(row.get('count', 0) or 0)

                for table in restricted_tables:
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
                    'reprint': counts.get('reprint', 0),
                    'tables': tables_data,
                })

            cache.set(cache_key, groups_data, cls.GROUP_COUNTS_CACHE_TTL)
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

            def _norm_key(value):
                return ''.join(ch for ch in str(value or '').upper() if ch.isalnum())

            def _field_value_for_name(field_data, field_name):
                if not isinstance(field_data, dict):
                    return ''

                if field_name in field_data:
                    return field_data.get(field_name, '')

                target_upper = str(field_name or '').upper().strip()
                if target_upper:
                    for k, v in field_data.items():
                        if str(k or '').upper().strip() == target_upper:
                            return v

                target_norm = _norm_key(field_name)
                if target_norm:
                    for k, v in field_data.items():
                        if _norm_key(k) == target_norm:
                            return v

                return ''

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

            def _resolve_photo_url(card, field_data, field_name):
                if not isinstance(field_data, dict):
                    return ''

                ordered_candidates = []
                seen = set()

                def _push_candidate(name):
                    key = str(name or '').strip()
                    if not key:
                        return
                    marker = key.upper()
                    if marker in seen:
                        return
                    seen.add(marker)
                    ordered_candidates.append(key)

                _push_candidate(field_name)

                matched_key = None
                target_norm = _norm_key(field_name)
                if target_norm:
                    for k in field_data.keys():
                        if _norm_key(k) == target_norm:
                            matched_key = str(k)
                            break
                _push_candidate(matched_key)

                for key in ordered_candidates:
                    try:
                        img_path = ImageService.get_image_path_for_export(
                            card,
                            key,
                            prefer_thumbnail=True,
                            fallback_to_field_data=True,
                        )
                        if img_path:
                            return cls._to_dashboard_photo_url(img_path)
                    except Exception:
                        logger.warning('Reprint history image resolution failed card_id=%s field=%s', getattr(card, 'id', None), key)

                    raw_val = _field_value_for_name(field_data, key)
                    raw_text = str(raw_val or '').strip()
                    if raw_text and raw_text != 'NOT_FOUND' and not raw_text.startswith('PENDING:'):
                        return cls._to_dashboard_photo_url(raw_text)

                return ''

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
                    val = _field_value_for_name(fd, fn)
                    if _looks_like_image_field(ft, fn):
                        if not photo_url:
                            photo_url = _resolve_photo_url(rr.card, fd, fn)
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
                        source_key = key_by_upper.get(fallback_name) or fallback_name
                        photo_url = _resolve_photo_url(rr.card, fd, source_key)
                        if photo_url:
                            break

                if not photo_url and isinstance(fd, dict):
                    for candidate_key, candidate_val in fd.items():
                        candidate_name = str(candidate_key or '')
                        if not cls.is_image_field_by_name(candidate_name):
                            continue
                        candidate_text = str(candidate_val or '').strip()
                        if not candidate_text or candidate_text == 'NOT_FOUND' or candidate_text.startswith('PENDING:'):
                            continue
                        photo_url = cls._to_dashboard_photo_url(candidate_text)
                        if photo_url:
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
            return cls._unexpected_error_result('get_reprint_history', e)
