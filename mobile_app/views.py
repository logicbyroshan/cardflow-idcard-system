"""
PWA Mobile App Views — real backend integration.

All views enforce:
  1. Login required
  2. Valid role (super_admin, admin_staff, client, client_staff)
  3. Mobile device user-agent (desktop gets block page)

No new backend logic — delegates entirely to existing services.
"""
import json
import re
import logging
import time
import hashlib
from datetime import timedelta
from urllib.parse import urlencode
from functools import wraps

from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.conf import settings
from django.core.cache import cache
from django.contrib.auth import login as auth_login
from django.contrib.auth import logout as auth_logout
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_exempt
from django.views.decorators.http import require_http_methods
from django.db import transaction
from django.db.models import Count, Q, Max, CharField, F, Case, When, Value, IntegerField
from django.db.models.functions import Cast
from django.db.models.fields.json import KeyTextTransform
from django.utils.dateparse import parse_date, parse_datetime
from django.utils.timezone import make_aware, is_naive
from django.utils import timezone

from client.services import (
    ClientAccessService,
    ClientDashboardService,
    ClientCardService,
    ClientImageService,
    ClientStaffService,
)
from client.services_client_core import ClientService
from core.services.permission_service import PermissionService
from idcards.models import IDCardTable, IDCard, IDCardGroup
from reprintcard.models import ReprintRequest
from mediafiles.utils import get_card_photo_url
from staff.models import Staff
from accounts.rate_limit import rate_limit
from accounts.rate_limit import _get_client_ip
from accounts.services import AuthService
from core.services.activity_service import ActivityService
from core.services.cache_version_service import CacheVersionService
from core.services import StaffService, IDCardService
from core.utils.field_utils import normalize_class_value
from mediafiles.utils import normalize_uploaded_image
from mediafiles.services import ImageService
from mediafiles.services.image_thumbnail import ThumbnailService
from mediafiles.models import CardMedia
from .models import MobileDevice

logger = logging.getLogger(__name__)
APP_BOOT_TS = time.time()
MAX_SEARCH_QUERY_LEN = 100
MAX_GLOBAL_SEARCH_DB_SCAN = 100
MAX_REPRINT_ACTION_IDS = 200
MOBILE_CLIENT_EDIT_LOCK_STATUSES = frozenset({'pool'})
MOBILE_INSTALLATION_ID_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,79}$')
MOBILE_SORT_MODES = frozenset({'sr-asc', 'name-asc', 'name-desc'})


def _truthy(value):
    return str(value or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _normalize_mobile_sort_mode(value):
    normalized = str(value or '').strip().lower()
    if normalized in MOBILE_SORT_MODES:
        return normalized
    return 'sr-asc'


def _mobile_shell_safe_int(raw_value, default=0):
    try:
        return int(raw_value)
    except (TypeError, ValueError):
        return default


def _mobile_shell_safe_bool(raw_value, default=False):
    if raw_value is None:
        return default
    if isinstance(raw_value, bool):
        return raw_value
    return _truthy(raw_value)


def _normalize_field_name(name):
    return str(name or '').strip().upper()


def _field_token(name):
    return re.sub(r'[^A-Z0-9]+', '', _normalize_field_name(name))


def _rel_photo_slot_for_name(name):
    normalized = _normalize_field_name(name)
    token = _field_token(name)
    if token in {'FATHERPHOTO', 'FPHOTO'}:
        return 1
    if token in {'MOTHERPHOTO', 'MPHOTO'}:
        return 2

    match = re.search(r'REL(?:ATION)?(?:NO)?([0-9]+)', token)
    if match:
        try:
            slot = int(match.group(1))
            if slot > 0:
                return slot
        except (TypeError, ValueError):
            pass

    match = re.search(r'REL[ _-]*NO?[ _-]*([0-9]+)', normalized)
    if match:
        try:
            slot = int(match.group(1))
            if slot > 0:
                return slot
        except (TypeError, ValueError):
            pass
    return None


def _rel_photo_aliases_for_slot(slot):
    if not slot or slot <= 0:
        return []
    aliases = [
        f'REL_{slot}PHOTO',
        f'REL{slot}PHOTO',
        f'REL {slot} PHOTO',
        f'REL NO {slot} PHOTO',
        f'REL{slot}',
        f'REL {slot}',
        f'REL_{slot}',
    ]
    if slot == 1:
        aliases.extend(['FATHER PHOTO', 'FATHER_PHOTO', 'F PHOTO'])
    elif slot == 2:
        aliases.extend(['MOTHER PHOTO', 'MOTHER_PHOTO', 'M PHOTO'])
    return aliases


def _get_field_value_case_insensitive(field_data, field_name):
    if not isinstance(field_data, dict):
        return ''
    canonical = _normalize_field_name(field_name)
    canonical_token = _field_token(field_name)
    for key, value in field_data.items():
        key_norm = _normalize_field_name(key)
        if key_norm == canonical:
            return value
        if canonical_token and _field_token(key_norm) == canonical_token:
            return value
    return ''


def _has_meaningful_field_value(value):
    if value is None:
        return False
    text = str(value).strip()
    return bool(text)


def _build_field_rename_pairs(old_fields, new_fields):
    pairs = []
    old_seq = old_fields if isinstance(old_fields, list) else []
    new_seq = new_fields if isinstance(new_fields, list) else []

    for index in range(min(len(old_seq), len(new_seq))):
        old_field = old_seq[index] or {}
        new_field = new_seq[index] or {}
        old_name = _normalize_field_name(old_field.get('name', ''))
        new_name = _normalize_field_name(new_field.get('name', ''))
        old_type = _normalize_field_name(old_field.get('type', 'text'))
        new_type = _normalize_field_name(new_field.get('type', 'text'))
        if old_name and new_name and (old_name != new_name or old_type != new_type):
            pairs.append({
                'old_name': old_name,
                'new_name': new_name,
                'old_type': old_type,
                'new_type': new_type,
                'old_rel_slot': _rel_photo_slot_for_name(old_name) if old_type in {'REL_PHOTO', 'FATHER_PHOTO', 'MOTHER_PHOTO'} else None,
                'new_rel_slot': _rel_photo_slot_for_name(new_name) if new_type in {'REL_PHOTO', 'FATHER_PHOTO', 'MOTHER_PHOTO'} else None,
            })
    return pairs


def _migrate_table_field_data_for_renames(table_id, rename_pairs, *, batch_size=500):
    if not rename_pairs:
        return 0

    updated = 0
    pending = []

    qs = IDCard.objects.filter(table_id=table_id).only('id', 'field_data')
    for card in qs.iterator(chunk_size=batch_size):
        field_data = card.field_data if isinstance(card.field_data, dict) else {}
        changed = False

        for pair in rename_pairs:
            old_name = pair['old_name']
            new_name = pair['new_name']
            old_slot = pair.get('old_rel_slot')

            old_val = _get_field_value_case_insensitive(field_data, old_name)
            if not _has_meaningful_field_value(old_val) and old_slot:
                for alias in _rel_photo_aliases_for_slot(old_slot):
                    old_val = _get_field_value_case_insensitive(field_data, alias)
                    if _has_meaningful_field_value(old_val):
                        break

            new_val = _get_field_value_case_insensitive(field_data, new_name)

            if _has_meaningful_field_value(old_val) and not _has_meaningful_field_value(new_val):
                field_data[new_name] = old_val
                changed = True

        if changed:
            card.field_data = field_data
            pending.append(card)
            updated += 1
            if len(pending) >= batch_size:
                IDCard.objects.bulk_update(pending, ['field_data'], batch_size=batch_size)
                pending.clear()

    if pending:
        IDCard.objects.bulk_update(pending, ['field_data'], batch_size=batch_size)

    return updated


def _migrate_cardmedia_field_names_for_renames(table_id, rename_pairs):
    if not rename_pairs:
        return 0

    updated_rows = 0
    for pair in rename_pairs:
        old_name = pair['old_name']
        new_name = pair['new_name']
        old_slot = pair.get('old_rel_slot')
        updated_rows += CardMedia.objects.filter(
            card__table_id=table_id,
            field_name__iexact=old_name,
        ).exclude(field_name=new_name).update(field_name=new_name)

        if old_slot:
            for alias in _rel_photo_aliases_for_slot(old_slot):
                updated_rows += CardMedia.objects.filter(
                    card__table_id=table_id,
                    field_name__iexact=alias,
                ).exclude(field_name=new_name).update(field_name=new_name)
    return updated_rows


def _mobile_shell_resolve_url(url_value, *, request=None, fallback=''):
    raw = str(url_value or '').strip() or str(fallback or '').strip()
    if not raw:
        return ''

    if raw.startswith('http://') or raw.startswith('https://'):
        return raw

    if raw.startswith('/'):
        if request is not None:
            try:
                return request.build_absolute_uri(raw)
            except Exception:
                pass

        base = str(getattr(settings, 'WEBSITE_URL', '') or getattr(settings, 'SITE_URL', '') or '').strip().rstrip('/')
        if base:
            return f'{base}{raw}'

    return raw


def _mobile_shell_app_config_payload(*, app_build=0, request=None):
    app_build = max(0, _mobile_shell_safe_int(app_build, 0))
    min_build = int(getattr(settings, 'MOBILE_SHELL_ANDROID_MIN_BUILD', 1) or 1)
    latest_build = int(getattr(settings, 'MOBILE_SHELL_ANDROID_LATEST_BUILD', min_build) or min_build)
    latest_build = max(min_build, latest_build)
    force_toggle = bool(getattr(settings, 'MOBILE_SHELL_ANDROID_FORCE_UPDATE', False))

    update_required = force_toggle or (app_build > 0 and app_build < min_build)
    update_recommended = app_build > 0 and app_build < latest_build
    update_url = _mobile_shell_resolve_url(
        getattr(settings, 'MOBILE_SHELL_ANDROID_UPDATE_URL', ''),
        request=request,
        fallback='/static/website/apk/adarsh-admin.apk',
    )
    support_url = _mobile_shell_resolve_url(
        getattr(settings, 'MOBILE_SHELL_SUPPORT_URL', ''),
        request=request,
        fallback='/app/profile/',
    )
    push_enabled = bool(getattr(settings, 'MOBILE_SHELL_PUSH_ENABLED', False))

    return {
        'platform': 'android',
        'app_name': 'Adarsh Panel',
        'min_supported_build': min_build,
        'latest_build': latest_build,
        'latest_version': str(getattr(settings, 'MOBILE_SHELL_ANDROID_LATEST_VERSION', '1.0.0') or '1.0.0'),
        'update_required': update_required,
        'update_recommended': update_recommended,
        'update_url': update_url,
        'push_enabled': push_enabled,
        'privacy_url': str(getattr(settings, 'MOBILE_SHELL_PRIVACY_URL', '') or ''),
        'support_url': support_url,
        'server_app_version': str(getattr(settings, 'APP_VERSION', '') or ''),
    }


def _mobile_shell_device_payload_hash(*, installation_id, app_build, app_version):
    seed = f'{installation_id}|{app_build}|{app_version}'.encode('utf-8', errors='ignore')
    return hashlib.sha256(seed).hexdigest()[:20]

MOBILE_PUBLIC_BENTO_INCLUDE_SLUGS = [
    'certificates',
    'marksheets',
    'mugs',
    't-shirts',
]
MOBILE_PUBLIC_BENTO_EXCLUDE_SLUGS = [
    'school-stationery',
    'office-stationery',
]
MOBILE_PUBLIC_BENTO_ORDER = [
    'id-cards',
    'lanyards',
    'badges',
    'student-diaries',
    'pamphlets',
    *MOBILE_PUBLIC_BENTO_INCLUDE_SLUGS,
]


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def is_mobile(request):
    """Check if request comes from a mobile device or native app."""
    ua = request.META.get('HTTP_USER_AGENT', '')
    # Expanded regex to include 'Adarsh' (custom) and 'okhttp' (standard Android networking)
    return bool(re.search(
        r'Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Adarsh|okhttp',
        ua, re.I,
    ))


def require_mobile_client(view_func):
    """Decorator: login + any valid role + perm_mobile_app + mobile UA.
    Supports all 4 roles: super_admin, admin_staff, client, client_staff.
    After login, redirects back to /app/ (PWA) via ?next= parameter.
    """
    @wraps(view_func)
    @login_required(login_url='/app/login/')
    def wrapper(request, *args, **kwargs):
        is_api_request = request.path.startswith('/app/api/')
        user = request.user

        # Mobile app uses its own auth checkpoint inside the same Django session.
        if not request.session.get('mobile_auth_ok'):
            if is_api_request:
                return JsonResponse({
                    'success': False,
                    'mobile_auth_required': True,
                    'message': 'Please sign in from the mobile app login screen.',
                }, status=401)
            return redirect('/app/login/')

        # Allow all 4 valid roles; reject unknown/empty roles
        valid_roles = ('pro_user', 'super_admin', 'admin_staff', 'client', 'client_staff')
        if not hasattr(user, 'role') or user.role not in valid_roles:
            auth_logout(request)
            request.session.pop('mobile_auth_ok', None)
            if is_api_request:
                return JsonResponse({'success': False, 'message': 'Invalid account role for mobile app.'}, status=403)
            return redirect('/app/login/')

        # Enforce perm_mobile_app (super_admin always passes)
        if not PermissionService.has(user, 'perm_mobile_app'):
            auth_logout(request)
            request.session.pop('mobile_auth_ok', None)
            if is_api_request:
                return JsonResponse({
                    'success': False,
                    'mobile_access_revoked': True,
                    'message': 'Mobile app access was revoked. Please contact admin.',
                }, status=403)
            return redirect('/app/login/?revoked=1')

        # Enforce mobile UA on the server as well (client-side block is not sufficient).
        # We allow a bypass if the session is already explicitly marked as mobile auth OK.
        if not is_mobile(request) and not request.session.get('mobile_auth_ok'):
            if is_api_request:
                return JsonResponse({
                    'success': False,
                    'desktop_blocked': True,
                    'message': 'Mobile device required for mobile app APIs.',
                }, status=403)
            return render(request, 'mobile_app/desktop_required.html', {
                'status': '',
                'status_display': 'Mobile App',
            }, status=403)

        return view_func(request, *args, **kwargs)
    return wrapper


def _get_notification_count(user):
    """Return unread notification count for the mobile bell badge (capped at 99)."""
    try:
        _, unread_count = _get_system_notifications(
            user,
            limit=100,
            mark_visible_as_read=False,
        )
        return min(unread_count, 99)
    except Exception:
        return 0


def _is_mobile_client_edit_locked(user, card_status):
    """Client/client_staff cannot edit cards in specific locked statuses on mobile."""
    return getattr(user, 'role', '') in ('client', 'client_staff') and card_status in MOBILE_CLIENT_EDIT_LOCK_STATUSES


def _mobile_client_edit_locked_response():
    """Standard 403 payload for mobile edit lock violations."""
    return JsonResponse(
        {'success': False, 'message': 'Cards in pool status cannot be edited by client users.'},
        status=403,
    )


def _can_access_card_with_row_scope(user, card):
    """Enforce card ownership plus client_staff row-level scope restrictions."""
    if not ClientAccessService.can_access_card(user, card):
        return False

    if not PermissionService.is_client_staff(user):
        return True

    scoped = ClientCardService._apply_client_staff_row_scope(
        user,
        card.table,
        IDCard.objects.filter(id=card.id, table_id=card.table_id),
    )
    return scoped.exists()


def _mobile_search_allowed_statuses(user):
    """Return card statuses visible to the user in mobile list/search surfaces."""
    status_perm_map = getattr(PermissionService, 'STATUS_LIST_PERM_MAP', {}) or {}
    allowed = []
    for status, perm_key in status_perm_map.items():
        if not perm_key or PermissionService.has(user, perm_key):
            allowed.append(status)
    return allowed


def _apply_mobile_search_status_scope(user, qs):
    """Limit search queryset to statuses the user can actually open on mobile."""
    if PermissionService.is_super_admin(user):
        return qs

    allowed_statuses = _mobile_search_allowed_statuses(user)
    if not allowed_statuses:
        return qs.none()
    return qs.filter(status__in=allowed_statuses)


def _filter_cards_for_client_staff_row_scope(user, cards):
    """Batch-filter search cards by client_staff row scope table-by-table."""
    cards_list = list(cards or [])
    if not PermissionService.is_client_staff(user):
        return cards_list
    if not cards_list:
        return cards_list

    grouped_by_table = {}
    for card in cards_list:
        table_id = getattr(card, 'table_id', None)
        card_id = getattr(card, 'id', None)
        table_obj = getattr(card, 'table', None)
        if not table_id or not card_id or table_obj is None:
            continue

        table_key = int(table_id)
        bucket = grouped_by_table.setdefault(table_key, {'table': table_obj, 'card_ids': []})
        bucket['card_ids'].append(int(card_id))

    allowed_ids = set()
    for table_id, payload in grouped_by_table.items():
        scoped_qs = ClientCardService._apply_client_staff_row_scope(
            user,
            payload['table'],
            IDCard.objects.filter(table_id=table_id, id__in=payload['card_ids']),
        )
        allowed_ids.update(scoped_qs.values_list('id', flat=True))

    return [card for card in cards_list if int(getattr(card, 'id', 0) or 0) in allowed_ids]


def _get_system_notifications(user, limit=20, mark_visible_as_read=False):
    """Return system notifications for a user with consistent unread tracking."""
    from core.models import Notification, NotificationRead
    from django.db.models import Q as _Q
    from django.utils import timezone as _tz

    role = getattr(user, 'role', 'all') or 'all'
    safe_limit = max(1, min(int(limit or 20), 100))
    now = _tz.now()

    notifications = list(
        Notification.objects
        .filter(is_active=True)
        .filter(_Q(expires_at__isnull=True) | _Q(expires_at__gt=now))
        .filter(_Q(target='all') | _Q(target=role) | _Q(target='selected', target_users=user))
        .distinct()
        .order_by('-created_at')[:safe_limit]
    )

    if not notifications:
        return [], 0

    notif_ids = [n.id for n in notifications]
    read_ids = set(
        NotificationRead.objects
        .filter(user=user, notification_id__in=notif_ids)
        .values_list('notification_id', flat=True)
    )

    if mark_visible_as_read:
        unread_ids = [nid for nid in notif_ids if nid not in read_ids]
        if unread_ids:
            NotificationRead.objects.bulk_create(
                [NotificationRead(user=user, notification_id=nid) for nid in unread_ids],
                ignore_conflicts=True,
            )
            read_ids.update(unread_ids)
            cache.delete(f'mobile:notif_count:{user.pk}')

    items = [
        {
            'id': n.id,
            'title': n.title,
            'message': n.message,
            'priority': n.priority,
            'priority_color': n.priority_color,
            'category': n.get_category_display(),
            'icon_class': n.icon_class,
            'created_at': n.created_at.strftime('%d %b %Y'),
            'is_read': n.id in read_ids,
        }
        for n in notifications
    ]

    unread_count = sum(1 for n in items if not n['is_read'])
    return items, unread_count


def _client_ctx(user):
    """Return (client, permissions_dict) for the current user.
    For admin roles (super_admin/admin_staff) that have no client profile,
    returns a scoped fallback client so PWA views can function.
    """
    client = ClientAccessService.get_client_for_user(user)
    if client is None and PermissionService.is_super_admin(user):
        # Super admin can access all clients — pick the first active one
        from client.models import Client
        client = Client.objects.filter(status='active').first()
    elif client is None and PermissionService.is_admin_staff(user):
        # Admin staff fallback must stay within assigned-client scope
        from client.models import Client
        accessible_ids = PermissionService.get_accessible_client_ids(user)
        if accessible_ids:
            client = Client.objects.filter(id__in=accessible_ids, status='active').first()
    perms = PermissionService.get_permission_context(user)
    return client, perms


def _mobile_no_client_redirect():
    """Single redirect target when mobile session has no client context."""
    return redirect('/app/no-access/?reason=no-client-context')


def _can_manage_clients_surface(user):
    """Return True when user can use Manage Client actions."""
    if PermissionService.is_super_admin(user):
        return True
    if PermissionService.is_admin_staff(user):
        return PermissionService.has(user, 'perm_manage_website_clients') or PermissionService.has(user, 'perm_idcard_client_list')
    return PermissionService.has(user, 'perm_idcard_client_list')


def _can_manage_client_staff_surface(user):
    """Return True when user can manage client staff."""
    if PermissionService.is_super_admin(user):
        return True
    if PermissionService.is_admin_staff(user):
        return PermissionService.has(user, 'perm_manage_client_staff') or PermissionService.has(user, 'perm_idcard_client_list')
    # Clients can manage their own staff if they have the manage_client_staff permission
    return PermissionService.is_client(user) or PermissionService.has(user, 'perm_manage_client_staff')


_AACI_SENTINEL = object()  # sentinel for _admin_accessible_client_ids cache


def _admin_accessible_client_ids(user):
    """Return admin-scoped client IDs, or None for super_admin (all clients).

    Performance: caches the result on the user object so repeated calls
    within the same request don't trigger additional M2M queries.
    """
    _cache_attr = '_cached_accessible_client_ids'
    cached = getattr(user, _cache_attr, _AACI_SENTINEL)
    if cached is not _AACI_SENTINEL:
        return cached

    if PermissionService.is_super_admin(user):
        result = None
    elif PermissionService.is_admin_staff(user):
        result = PermissionService.get_accessible_client_ids(user)
        # Defensive fallback: if cached scope is empty but staff has assignments,
        # read directly from M2M to avoid temporary stale-zero dashboards.
        if not result:
            staff = getattr(user, 'staff_profile', None)
            if staff is not None:
                result = list(staff.assigned_clients.values_list('id', flat=True))
    else:
        result = []

    setattr(user, _cache_attr, result)
    return result


def _image_path_basename(value):
    """Return a normalized basename from a stored media path-like value."""
    raw = str(value or '').strip()
    if not raw or raw == 'NOT_FOUND' or raw.startswith('PENDING:'):
        return ''
    cleaned = raw.replace('\\', '/').split('?', 1)[0].split('#', 1)[0]
    return cleaned.rsplit('/', 1)[-1]


def _search_cards_for_global_results(base_qs, query, limit=50, filter_type='all'):
    """Desktop-parity card matching for mobile global search.

    Uses a broad DB prefilter and then validates matches field-by-field so
    mobile search behaves like desktop global search for dynamic table fields.
    """
    if not query or len(query) < 2:
        return []

    query_upper = query.upper()
    active_filter = str(filter_type or 'all').strip().lower()
    if active_filter not in ('all', 'name', 'address', 'mobile'):
        active_filter = 'all'
    image_field_types = {'photo', 'rel_photo', 'mother_photo', 'father_photo', 'image', 'signature'}
    non_searchable_field_types = {'file', 'barcode', 'qr_code'}
    non_searchable_name_tokens = ('BARCODE', 'QR', 'FILE')

    cards = base_qs.filter(field_data__icontains=query)[:MAX_GLOBAL_SEARCH_DB_SCAN]
    matched_cards = []

    for card in cards:
        field_data = card.field_data or {}
        if not isinstance(field_data, dict):
            continue

        field_type_by_name = {}
        table_fields = getattr(card.table, 'fields', None)
        if isinstance(table_fields, list):
            for field in table_fields:
                if not isinstance(field, dict):
                    continue
                field_name = str(field.get('name', '')).strip().upper()
                if not field_name:
                    continue
                field_type_by_name[field_name] = str(field.get('type', 'text')).strip().lower()

        matched = False
        for field_name, field_value in field_data.items():
            if field_value in (None, ''):
                continue

            field_name_upper = str(field_name).upper()
            field_type = field_type_by_name.get(field_name_upper, '')

            is_image_field = (
                field_type in image_field_types
                or ((not field_type) and ('PHOTO' in field_name_upper or 'IMAGE' in field_name_upper or 'SIGN' in field_name_upper))
            )
            if is_image_field:
                if active_filter != 'all':
                    continue
                image_basename = _image_path_basename(field_value)
                if image_basename and query_upper in image_basename.upper():
                    matched = True
                    break
                continue

            if field_type in non_searchable_field_types:
                continue
            if (not field_type) and any(token in field_name_upper for token in non_searchable_name_tokens):
                continue

            if active_filter != 'all':
                if active_filter == 'name' and 'NAME' not in field_name_upper:
                    continue
                if active_filter == 'address' and 'ADDRESS' not in field_name_upper:
                    continue
                if active_filter == 'mobile' and ('MOBILE' not in field_name_upper and 'PHONE' not in field_name_upper and 'MOB' not in field_name_upper):
                    continue

            if query_upper in str(field_value).upper():
                matched = True
                break

        if not matched:
            continue

        matched_cards.append(card)
        if len(matched_cards) >= limit:
            break

    return matched_cards


def _card_display_name(card, field_data):
    """Return user-facing card name with table-aware fallback."""
    for key in ('NAME', 'name', 'Name'):
        value = (field_data or {}).get(key)
        if value:
            return str(value)

    table_fields = getattr(card.table, 'fields', None)
    if isinstance(table_fields, list):
        for field in table_fields:
            if not isinstance(field, dict):
                continue
            if str(field.get('type', 'text')).strip().lower() not in ('text', 'textarea'):
                continue
            fname = field.get('name')
            if not fname:
                continue
            value = (field_data or {}).get(fname)
            if value:
                return str(value)

    return f'Card #{card.id}'


def _sanitize_search_query(value, max_len=MAX_SEARCH_QUERY_LEN):
    """Trim and cap user-provided search strings to keep scans bounded."""
    return str(value or '').strip()[:max_len]


def _normalize_positive_int_ids(values):
    """Normalize mixed input to unique positive integer IDs."""
    if not isinstance(values, list):
        return []

    normalized = []
    seen = set()
    for value in values:
        if isinstance(value, bool):
            continue
        try:
            number = int(str(value).strip())
        except (TypeError, ValueError):
            continue
        if number <= 0 or number in seen:
            continue
        seen.add(number)
        normalized.append(number)
    return normalized


def _dedupe_scope_values(values):
    """Normalize filter values preserving first-seen order."""
    out = []
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


def _staff_assigned_group_ids_for_access(staff):
    """Return group IDs that explicitly grant group-level access."""
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


def _staff_assigned_table_ids_for_access(staff):
    """Return table IDs that explicitly grant table-level access."""
    scopes = getattr(staff, 'assignment_scopes', None)
    if isinstance(scopes, list) and scopes:
        table_ids = []
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
            table_ids.append(sid_int)

        if has_any_valid_scope:
            return table_ids

    return _normalize_positive_int_ids(getattr(staff, 'assigned_table_ids', None) or [])


def _staff_can_access_table(staff, table):
    """Allow access if table is assigned directly or via assigned group."""
    assigned_table_ids = set(_staff_assigned_table_ids_for_access(staff))
    assigned_group_ids = set(_staff_assigned_group_ids_for_access(staff))

    if assigned_table_ids and assigned_group_ids:
        return (int(table.id) in assigned_table_ids) or (int(table.group_id) in assigned_group_ids)
    if assigned_table_ids:
        return int(table.id) in assigned_table_ids
    if assigned_group_ids:
        return int(table.group_id) in assigned_group_ids
    return True


def _staff_table_scope_filters(staff, table):
    """Resolve class/section filters for current table from assignment scopes."""
    scopes = getattr(staff, 'assignment_scopes', None)
    if not isinstance(scopes, list) or not scopes:
        return (
            _dedupe_scope_values(staff.allowed_classes or []),
            _dedupe_scope_values(staff.allowed_sections or []),
        )

    matched = []
    for scope in scopes:
        if not isinstance(scope, dict):
            continue
        stype = str(scope.get('scope_type', '') or '').strip().lower()
        sid = scope.get('scope_id')
        try:
            sid = int(str(sid).strip())
        except (TypeError, ValueError):
            continue

        if stype == 'table' and sid == int(table.id):
            matched.append(scope)
        elif stype == 'group' and sid == int(table.group_id):
            matched.append(scope)

    if not matched:
        return (
            _dedupe_scope_values(staff.allowed_classes or []),
            _dedupe_scope_values(staff.allowed_sections or []),
        )

    classes = []
    sections = []
    for scope in matched:
        classes.extend(scope.get('classes') or [])
        sections.extend(scope.get('sections') or [])

    return (_dedupe_scope_values(classes), _dedupe_scope_values(sections))


def _get_table_filter_metadata(table, table_fields):
    """Build class/section filter metadata for list page."""
    class_field_name = None
    section_field_name = None
    for _f in table_fields:
        _fname = str(_f.get('name', '')).strip()
        _ftype = str(_f.get('type', '')).strip().lower()
        if not _fname:
            continue
        if class_field_name is None and (_ftype == 'class' or _fname.lower() == 'class'):
            class_field_name = _fname
        if section_field_name is None and (_ftype == 'section' or _fname.lower() == 'section'):
            section_field_name = _fname

    options_qs = IDCard.objects.filter(table=table)

    all_classes = []
    if class_field_name:
        all_classes = sorted(
            [
                str(v) for v in options_qs
                .annotate(_cv=Cast(KeyTextTransform(class_field_name, 'field_data'), CharField()))
                .exclude(_cv__isnull=True)
                .exclude(_cv='')
                .order_by()
                .values_list('_cv', flat=True)
                .distinct()
                if v is not None
            ],
        )

    all_sections = []
    if section_field_name:
        all_sections = sorted(
            [
                str(v) for v in options_qs
                .annotate(_sv=Cast(KeyTextTransform(section_field_name, 'field_data'), CharField()))
                .exclude(_sv__isnull=True)
                .exclude(_sv='')
                .order_by()
                .values_list('_sv', flat=True)
                .distinct()
                if v is not None
            ],
        )

    fallback_classes = set(all_classes)
    fallback_sections = set(all_sections)
    class_to_sections = {}

    for _card in options_qs.only('field_data').iterator(chunk_size=500):
        _fd = _card.field_data or {}

        _cls = ''
        _sec = ''
        if class_field_name:
            _cls = str(_fd.get(class_field_name, '') or '').strip()
        if section_field_name:
            _sec = str(_fd.get(section_field_name, '') or '').strip()

        if not _cls:
            _cls = str(_fd.get('CLASS') or _fd.get('class') or _fd.get('DESIGNATION') or '').strip()
        if not _sec:
            _sec = str(_fd.get('SECTION') or _fd.get('section') or '').strip()

        if not all_classes and _cls:
            fallback_classes.add(_cls)
        if not all_sections and _sec:
            fallback_sections.add(_sec)

        if _cls:
            if _cls not in class_to_sections:
                class_to_sections[_cls] = set()
            if _sec:
                class_to_sections[_cls].add(_sec)

    if not all_classes:
        all_classes = sorted(fallback_classes)
    if not all_sections:
        all_sections = sorted(fallback_sections)

    payload = {
        'all_classes': all_classes,
        'all_sections': all_sections,
        'class_to_sections': {
            _cls: sorted(list(_sections))
            for _cls, _sections in class_to_sections.items()
        },
    }
    return payload


def _build_filter_metadata_from_queryset(cards_qs, class_field_name=None, section_field_name=None):
    """Build class/section filter metadata from an already filtered queryset."""
    all_classes = []
    if class_field_name:
        all_classes = sorted(
            [
                str(v) for v in cards_qs
                .annotate(_cv=Cast(KeyTextTransform(class_field_name, 'field_data'), CharField()))
                .exclude(_cv__isnull=True)
                .exclude(_cv='')
                .order_by()
                .values_list('_cv', flat=True)
                .distinct()
                if v is not None
            ],
        )

    all_sections = []
    if section_field_name:
        all_sections = sorted(
            [
                str(v) for v in cards_qs
                .annotate(_sv=Cast(KeyTextTransform(section_field_name, 'field_data'), CharField()))
                .exclude(_sv__isnull=True)
                .exclude(_sv='')
                .order_by()
                .values_list('_sv', flat=True)
                .distinct()
                if v is not None
            ],
        )

    fallback_classes = set(all_classes)
    fallback_sections = set(all_sections)
    class_to_sections = {}

    for _card in cards_qs.only('field_data').iterator(chunk_size=500):
        _fd = _card.field_data or {}

        _cls = ''
        _sec = ''
        if class_field_name:
            _cls = str(_fd.get(class_field_name, '') or '').strip()
        if section_field_name:
            _sec = str(_fd.get(section_field_name, '') or '').strip()

        if not _cls:
            _cls = str(_fd.get('CLASS') or _fd.get('class') or _fd.get('DESIGNATION') or '').strip()
        if not _sec:
            _sec = str(_fd.get('SECTION') or _fd.get('section') or '').strip()

        if not all_classes and _cls:
            fallback_classes.add(_cls)
        if not all_sections and _sec:
            fallback_sections.add(_sec)

        if _cls:
            if _cls not in class_to_sections:
                class_to_sections[_cls] = set()
            if _sec:
                class_to_sections[_cls].add(_sec)

    if not all_classes:
        all_classes = sorted(fallback_classes)
    if not all_sections:
        all_sections = sorted(fallback_sections)

    return {
        'all_classes': all_classes,
        'all_sections': all_sections,
        'class_to_sections': {
            _cls: sorted(list(_sections))
            for _cls, _sections in class_to_sections.items()
        },
    }


# ── Image upload validation ──────────────────────────────────────────────────
_ALLOWED_IMAGE_TYPES = frozenset({
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
})
_ALLOWED_IMAGE_EXTS  = frozenset({'.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.hei'})
_MAX_IMAGE_SIZE = 40 * 1024 * 1024  # 40 MB raw input; normalized output is compressed JPEG

def _validate_image(photo):
    """Return (ok, message, normalized_upload) for an uploaded file."""
    normalized_upload, error_message = normalize_uploaded_image(
        photo,
        max_bytes=_MAX_IMAGE_SIZE,
        allowed_extensions=_ALLOWED_IMAGE_EXTS,
        allowed_mime_types=_ALLOWED_IMAGE_TYPES,
    )
    if error_message:
        return False, error_message, None
    return True, '', normalized_upload


def _unpack_validate_image_result(result, original_photo):
    if isinstance(result, tuple):
        if len(result) == 3:
            return result
        if len(result) == 2:
            ok, err = result
            return ok, err, original_photo if ok else None
    return False, 'Invalid image validation response', None


def _serialize_mobile_admin_staff(staff):
    """Serialize admin_staff rows with full permission flags for mobile edit forms."""
    row = {
        'id': staff.id,
        'user_id': staff.user.id,
        'name': staff.user.get_full_name() or staff.user.username,
        'email': staff.user.email,
        'phone': getattr(staff.user, 'phone', '') or '',
        'department': staff.department or '',
        'designation': staff.designation or '',
        'is_active': staff.user.is_active,
        'staff_type': staff.get_staff_type_display(),
        'created_at': staff.created_at.strftime('%d %b %Y'),
        'assigned_client_ids': [client.id for client in staff.assigned_clients.all()],
    }
    for perm in StaffService.PERMISSION_FIELDS:
        row[perm] = bool(getattr(staff, perm, False))
    return row


def _list_mobile_admin_staff(limit=200):
    """Return admin_staff records for mobile list/details, including permission booleans."""
    queryset = (
        Staff.objects
        .filter(staff_type='admin_staff')
        .select_related('user')
        .prefetch_related('assigned_clients')
        .order_by('-created_at')[:limit]
    )
    return [_serialize_mobile_admin_staff(staff) for staff in queryset]


# ---------------------------------------------------------------------------
# PAGE VIEWS
# ---------------------------------------------------------------------------

@ensure_csrf_cookie
def mobile_login(request):
    """Dedicated mobile PWA login page at /app/login/.
    Renders the branded mobile login template; AJAX POST is handled by
    the existing /panel/auth/api/auth/login/ endpoint.
    """
    if request.user.is_authenticated:
        user = request.user
        valid_roles = ('pro_user', 'super_admin', 'admin_staff', 'client', 'client_staff')
        if not hasattr(user, 'role') or user.role not in valid_roles:
            return redirect('/panel/auth/logout/?next=/app/login/')
        # Separate mobile auth flow: do not auto-enter app unless mobile auth checkpoint passed.
        if request.session.get('mobile_auth_ok') and PermissionService.has(user, 'perm_mobile_app'):
            client, _ = _client_ctx(user)
            if client is None:
                return _mobile_no_client_redirect()
            return redirect('/app/')
    return render(request, 'mobile_app/login.html')


@ensure_csrf_cookie
def mobile_no_access(request):
    """Show explicit mobile permission-required page."""
    user = request.user if request.user.is_authenticated else None
    reason = str(request.GET.get('reason') or '').strip().lower()

    title = 'Access Not Enabled'
    message = 'Mobile app access has not been enabled for your account. Please contact your administrator.'

    if reason == 'no-client-context':
        title = 'No Active Client Context'
        message = 'Your account is signed in, but no active client is assigned. Please contact your administrator to assign an active client.'

    return render(request, 'mobile_app/no_access.html', {
        'user_name': (user.get_full_name() or user.username) if user else '',
        'reason': reason,
        'no_access_title': title,
        'no_access_message': message,
    }, status=403)


@require_mobile_client
def desktop_required(request):
    """Inform users that this action/list is only available on desktop panel."""
    status = (request.GET.get('status') or '').strip().lower()
    return render(request, 'mobile_app/desktop_required.html', {
        'status': status,
        'status_display': status.replace('_', ' ').title() if status else 'This List',
    })


@csrf_exempt
@require_http_methods(["POST"])
@rate_limit(max_requests=6, window_seconds=60, key_prefix='mob_login')
def api_mobile_login(request):
    """Mobile-only login: authenticate + enforce perm_mobile_app before session login."""
    identifier = None
    try:
        data = json.loads(request.body or '{}')
        identifier = (data.get('email') or '').strip()
        password = data.get('password', '')
        force_logout_other = _truthy(data.get('force_logout_other'))
        client_ip = _get_client_ip(request)

        if not identifier or not password:
            return JsonResponse({'success': False, 'message': 'Email and password are required.'}, status=400)

        result = AuthService.authenticate_user(identifier, password)
        if not result.get('success'):
            return JsonResponse({'success': False, 'message': result.get('message', 'Invalid credentials.')}, status=400)

        user = result.get('user')
        valid_roles = ('pro_user', 'super_admin', 'admin_staff', 'client', 'client_staff')
        if not user or getattr(user, 'role', '') not in valid_roles:
            return JsonResponse({'success': False, 'message': 'This account cannot access the mobile app.'}, status=403)

        if not PermissionService.has(user, 'perm_mobile_app'):
            return JsonResponse({
                'success': False,
                'no_mobile_access': True,
                'message': 'Mobile app access is disabled for your account. Please contact admin/owner.',
            }, status=403)

        browser_fingerprint = AuthService.browser_fingerprint_from_request(request)
        current_session_key = ''
        if request.user.is_authenticated and getattr(request.user, 'pk', None) == user.pk:
            current_session_key = request.session.session_key or ''

        # Check for existing sessions (for logging purposes)
        session_inspection = AuthService.inspect_active_sessions_for_user(
            user.id,
            browser_fingerprint=browser_fingerprint,
            exclude_session_key=current_session_key,
        )
        surface_counts = session_inspection.get('surface_counts') or {}
        active_mobile_sessions = int(surface_counts.get('mobile', 0) or 0)

        auth_login(request, user)

        # Seed session fingerprint immediately so the very next
        # request doesn't see a mismatch and force-logout the user.
        from core.middleware import PermissionValidationMiddleware
        PermissionValidationMiddleware.seed_session_fingerprint(request)

        # Reset the absolute max-age clock for a fresh session lifetime.
        import time as _time
        request.session['_session_created'] = _time.time()
        request.session['_last_activity'] = _time.time()

        request.session['selected_role'] = getattr(user, 'role', '')
        # Mark session as mobile-authenticated so require_mobile_client passes.
        request.session['mobile_auth_ok'] = True
        AuthService.apply_session_auth_context(
            request,
            surface='mobile',
            ip_address=client_ip,
        )
        ActivityService.log_login(request, user)
        _, perms = _client_ctx(user)
        client, _ = _client_ctx(user)
        return JsonResponse({
            'success': True,
            'redirect_url': '/app/',
            'message': 'Login successful',
            'user_name': user.get_full_name() or user.username,
            'role': getattr(user, 'role', ''),
            'client_id': getattr(client, 'id', None) if client else None,
            'can_manage_clients': _can_manage_clients_surface(user),
            'can_manage_staff': _can_manage_client_staff_surface(user),
            'permissions': perms,
        })
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)
    except Exception:
        logger.exception('Mobile login error for user=%s', identifier or 'unknown')
        return JsonResponse({'success': False, 'message': 'An unexpected error occurred. Please try again.'}, status=500)


def pwa_manifest(request):
    """Serve the PWA Web App Manifest at /app/manifest.json.
    This is required for Chrome/Android to show the 'Add to Home Screen' prompt.
    """
    manifest = {
        'name': 'Adarsh ID Cards',
        'short_name': 'Adarsh IDs',
        'id': '/app/',
        'description': 'Manage ID cards on the go — fast, secure, and mobile-first.',
        'start_url': '/app/',
        'scope': '/app/',
        'display': 'standalone',
        'display_override': ['standalone', 'minimal-ui', 'browser'],
        'orientation': 'portrait',
        'background_color': '#eaf2ff',
        'theme_color': '#2f80ed',
        'lang': 'en',
        'prefer_related_applications': False,
        'icons': [
            {
                'src': '/static/mobile/images/icon-192.png',
                'sizes': '192x192',
                'type': 'image/png',
                'purpose': 'any',
            },
            {
                'src': '/static/mobile/images/icon-192.png',
                'sizes': '192x192',
                'type': 'image/png',
                'purpose': 'maskable',
            },
            {
                'src': '/static/mobile/images/icon-512.png',
                'sizes': '512x512',
                'type': 'image/png',
                'purpose': 'any',
            },
            {
                'src': '/static/mobile/images/icon-512.png',
                'sizes': '512x512',
                'type': 'image/png',
                'purpose': 'maskable',
            },
        ],
        'categories': ['business', 'productivity'],
    }
    response = JsonResponse(manifest)
    response['Content-Type'] = 'application/manifest+json'
    response['Cache-Control'] = 'public, max-age=3600'
    return response


def pwa_service_worker(request):
    """Serve the PWA service worker at /app/sw.js.
    The Service-Worker-Allowed header extends scope to the full /app/ path.
    A service worker is required by Chrome/Android to enable the PWA install prompt.
    """
    from django.http import HttpResponse
    app_version = str(getattr(settings, 'APP_VERSION', 'v0.00.00') or 'v0.00.00')
    version_seed = app_version.strip() or 'v0.00.00'
    normalized_version = re.sub(r'[^a-zA-Z0-9._-]+', '-', version_seed).strip('-').lower() or 'v0.00.00'

    try:
        cache_generation = max(1, int(getattr(settings, 'MOBILE_PWA_CACHE_GENERATION', 1) or 1))
    except (TypeError, ValueError):
        cache_generation = 1

    try:
        rollback_window = max(1, int(getattr(settings, 'MOBILE_PWA_CACHE_ROLLBACK_WINDOW', 2) or 2))
    except (TypeError, ValueError):
        rollback_window = 2

    cache_namespace = f'g{cache_generation}-{normalized_version}'
    asset_version = f'{normalized_version}.g{cache_generation}'
    cache_group = 'adarsh-mobile'

    shell_routes = [
        '/app/login/',
        '/app/no-access/',
        '/app/desktop-required/',
        '/app/manifest.json',
    ]
    static_assets = [
        f'/static/css/tailwind.css?v={asset_version}',
        '/static/css/vendor/fontawesome/all.min.css?v=3',
        '/static/css/vendor/webfonts/fa-solid-900.woff2',
        '/static/css/vendor/webfonts/fa-solid-900.ttf',
        '/static/css/vendor/webfonts/fa-regular-400.woff2',
        '/static/css/vendor/webfonts/fa-regular-400.ttf',
        '/static/css/vendor/webfonts/fa-brands-400.woff2',
        '/static/css/vendor/webfonts/fa-brands-400.ttf',
        f'/static/mobile/css/mobile.css?v={asset_version}',
        f'/static/css/dropdown-unified.css?v={asset_version}',
        f'/static/mobile/js/environment-gate.js?v={asset_version}',
        f'/static/mobile/js/device-bridge.js?v={asset_version}',
        f'/static/mobile/js/app.js?v={asset_version}',
    ]
    read_only_cacheable_paths = [
        '/app/login/',
        '/app/no-access/',
        '/app/desktop-required/',
        '/app/manifest.json',
    ]
    online_required_prefixes = [
        '/app/api/',
        '/app/camera/',
        '/app/table/',
        '/app/reprint/',
        '/app/clients/',
        '/app/website/',
        '/app/staff/',
        '/app/groups/',
        '/app/profile/',
        '/app/settings/',
        '/app/notifications/',
        '/app/search/',
    ]

    # Exclude login and CSRF from caching (Step 10)
    online_required_prefixes.extend([
        '/panel/auth/login/',
        '/panel/auth/csrf/',
        '/auth/login/',
        '/csrf/',
    ])

    sw_template = """\
/* Adarsh ID Cards — PWA Service Worker (Phase 5) */
const CACHE_GROUP = '__CACHE_GROUP__';
const CACHE_NAMESPACE = '__CACHE_NAMESPACE__';
const CACHE_GENERATION = __CACHE_GENERATION__;
const ROLLBACK_WINDOW = __ROLLBACK_WINDOW__;
const APP_CACHE = CACHE_GROUP + '-app-' + CACHE_NAMESPACE;
const STATIC_CACHE = CACHE_GROUP + '-static-' + CACHE_NAMESPACE;
const SHELL = __SHELL_JSON__;
const STATIC_ASSETS = __STATIC_ASSETS_JSON__;
const READ_ONLY_CACHEABLE_PATHS = __READ_ONLY_PATHS_JSON__;
const ONLINE_REQUIRED_PREFIXES = __ONLINE_REQUIRED_PREFIXES_JSON__;
const OFFLINE_HTML = [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Offline - Adarsh IDs</title>',
    '<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;background:#eaf2ff;color:#1f2937;} .card{max-width:420px;margin:8vh auto;background:#fff;border:1px solid #d6e7f8;border-radius:14px;padding:18px 16px;box-shadow:0 8px 20px rgba(15,23,42,.08);} h1{font-size:20px;margin:0 0 8px;} p{font-size:14px;line-height:1.45;color:#4b5563;margin:0;} a{display:inline-block;margin-top:12px;font-size:13px;text-decoration:none;color:#2f80ed;font-weight:600;}</style>',
    '</head><body><div class="card"><h1>Offline Mode</h1><p>This page requires internet right now. Reconnect and try again.</p><a href="/app/login/">Open Login</a></div></body></html>'
].join('');

function shouldCacheResponse(response) {
    return !!response && response.status === 200;
}

function parseGeneration(cacheName) {
    if (!cacheName) return null;
    var match = cacheName.match(/-g(\d+)-/);
    if (!match) return null;
    var parsed = parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function isLegacyCache(cacheName) {
    return /^adarsh-(app|static)-v\d+$/.test(cacheName || '');
}

function shouldDeleteStaleCache(cacheName, activeCaches) {
    if (activeCaches.indexOf(cacheName) !== -1) return false;
    if (isLegacyCache(cacheName)) return true;
    if ((cacheName || '').indexOf(CACHE_GROUP + '-') !== 0) return false;
    var generation = parseGeneration(cacheName);
    if (generation === null) return true;
    return generation < (CACHE_GENERATION - ROLLBACK_WINDOW);
}

function isOnlineRequiredPath(pathname) {
    if (!pathname) return false;
    return ONLINE_REQUIRED_PREFIXES.some(function(prefix) {
        return pathname.indexOf(prefix) === 0;
    });
}

function isReadOnlyCacheablePath(pathname) {
    return READ_ONLY_CACHEABLE_PATHS.indexOf(pathname) !== -1;
}

function offlineJsonResponse() {
    return new Response(JSON.stringify({ success: false, offline: true, message: 'Network connection required.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
    });
}

function offlineHtmlResponse() {
    return new Response(OFFLINE_HTML, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

self.addEventListener('install', function(event) {
    event.waitUntil(
        Promise.all([
            caches.open(APP_CACHE).then(async function(cache) {
                await Promise.allSettled(
                    SHELL.map(function(url) {
                        return cache.add(url);
                    })
                );
            }),
            caches.open(STATIC_CACHE).then(async function(cache) {
                await Promise.allSettled(
                    STATIC_ASSETS.map(function(url) {
                        return cache.add(url);
                    })
                );
            }),
        ])
    );
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    var activeCaches = [APP_CACHE, STATIC_CACHE];
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames
                    .filter(function(cacheName) {
                        return shouldDeleteStaleCache(cacheName, activeCaches);
                    })
                    .map(function(cacheName) {
                        return caches.delete(cacheName);
                    })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('message', function(event) {
    if (event && event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', function(event) {
    if (event.request.method !== 'GET') return;

    var url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    if (url.pathname.indexOf('/static/') === 0) {
        event.respondWith(
            caches.open(STATIC_CACHE).then(function(cache) {
                var isIconAsset = url.pathname.indexOf('/static/css/vendor/fontawesome/') === 0 ||
                    url.pathname.indexOf('/static/css/vendor/webfonts/') === 0;

                if (isIconAsset) {
                    return fetch(event.request)
                        .then(function(response) {
                            if (shouldCacheResponse(response)) {
                                cache.put(event.request, response.clone());
                            }
                            return response;
                        })
                        .catch(function() {
                            return cache.match(event.request).then(function(cached) {
                                return cached || Response.error();
                            });
                        });
                }

                return cache.match(event.request).then(function(cached) {
                    var networkFetch = fetch(event.request)
                        .then(function(response) {
                            if (shouldCacheResponse(response)) {
                                cache.put(event.request, response.clone());
                            }
                            return response;
                        })
                        .catch(function() {
                            return cached || Response.error();
                        });

                    return cached || networkFetch;
                });
            })
        );
        return;
    }

    if (url.pathname.indexOf('/app/api/') === 0) {
        event.respondWith(
            fetch(event.request).catch(function() {
                return offlineJsonResponse();
            })
        );
        return;
    }

    if (isOnlineRequiredPath(url.pathname)) {
        event.respondWith(
            fetch(event.request).catch(function() {
                return offlineHtmlResponse();
            })
        );
        return;
    }

    if (!url.pathname.startsWith('/app/')) return;

    if (isReadOnlyCacheablePath(url.pathname)) {
        event.respondWith(
            caches.open(APP_CACHE).then(function(cache) {
                return fetch(event.request)
                    .then(function(response) {
                        if (shouldCacheResponse(response)) {
                            cache.put(event.request, response.clone());
                        }
                        return response;
                    })
                    .catch(function() {
                        return cache.match(event.request).then(function(cached) {
                            return cached || cache.match('/app/login/');
                        });
                    });
            })
        );
        return;
    }

    event.respondWith(
        fetch(event.request).catch(function() {
            return offlineHtmlResponse();
        })
    );
});
"""

    sw_content = (
        sw_template
        .replace('__CACHE_GROUP__', cache_group)
        .replace('__CACHE_NAMESPACE__', cache_namespace)
        .replace('__CACHE_GENERATION__', json.dumps(cache_generation))
        .replace('__ROLLBACK_WINDOW__', json.dumps(rollback_window))
        .replace('__SHELL_JSON__', json.dumps(shell_routes))
        .replace('__STATIC_ASSETS_JSON__', json.dumps(static_assets))
        .replace('__READ_ONLY_PATHS_JSON__', json.dumps(read_only_cacheable_paths))
        .replace('__ONLINE_REQUIRED_PREFIXES_JSON__', json.dumps(online_required_prefixes))
    )
    response = HttpResponse(sw_content, content_type='application/javascript')
    response['Service-Worker-Allowed'] = '/app/'
    response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return response


@require_mobile_client
def home(request):
    """Home dashboard with real card counts and recent activity."""
    user = request.user

    # Ensure related-object caches do not hold stale values between auth transitions.
    # request.user is a SimpleLazyObject here, so avoid model-manager access on its type.
    if PermissionService.is_client(user):
        user.__dict__.pop('_client_profile_cache', None)
    elif PermissionService.is_client_staff(user):
        user.__dict__.pop('_staff_profile_cache', None)
    
    client, perms = _client_ctx(user)
    if not client:
        return _mobile_no_client_redirect()

    # ── Compute accessible_ids ONCE for the entire view ──────────────────
    # Avoids 4+ redundant M2M queries for admin_staff users.
    _is_admin = PermissionService.is_any_admin(user)
    _is_admin_staff = PermissionService.is_admin_staff(user)
    accessible_ids = _admin_accessible_client_ids(user) if _is_admin else None

    result = ClientDashboardService.get_dashboard_data(user, client=client)

    def _compute_mobile_counts_fallback(_user, _client_obj):
        """Direct DB fallback counts to keep mobile stats aligned with desktop."""
        _counts = {
            'pending': 0,
            'verified': 0,
            'approved': 0,
            'download': 0,
            'pool': 0,
            'reprint': 0,
        }

        _tables_qs = IDCardTable.objects.filter(group__client=_client_obj, is_active=True)
        if PermissionService.is_client_staff(_user):
            _staff = getattr(_user, 'staff_profile', None)
            if not _staff:
                return _counts
            _assigned_tids = _normalize_positive_int_ids(_staff.assigned_table_ids or [])
            _assigned_gids = _staff_assigned_group_ids_for_access(_staff)
            if _assigned_tids and _assigned_gids:
                _tables_qs = _tables_qs.filter(Q(id__in=_assigned_tids) | Q(group_id__in=_assigned_gids))
            elif _assigned_tids:
                _tables_qs = _tables_qs.filter(id__in=_assigned_tids)
            elif _assigned_gids:
                _tables_qs = _tables_qs.filter(group_id__in=_assigned_gids)

        _tables = list(_tables_qs.only('id', 'fields'))
        if not _tables:
            return _counts

        if PermissionService.is_client_staff(_user):
            for _table in _tables:
                _scoped_qs = ClientCardService._apply_client_staff_row_scope(
                    _user,
                    _table,
                    IDCard.objects.filter(table_id=_table.id),
                )
                for _row in _scoped_qs.values('status').annotate(n=Count('id')):
                    _status = _row.get('status')
                    if _status in _counts:
                        _counts[_status] += int(_row.get('n', 0) or 0)
            return _counts

        _rows = (
            IDCard.objects
            .filter(table_id__in=[_t.id for _t in _tables])
            .values('status')
            .annotate(n=Count('id'))
        )
        for _row in _rows:
            _status = _row.get('status')
            if _status in _counts:
                _counts[_status] += int(_row.get('n', 0) or 0)
        return _counts

    tables = IDCardTable.objects.filter(
        group__client=client, is_active=True,
    ).select_related('group').order_by('group__name', 'name')

    # Restrict client_staff to their assigned groups
    if PermissionService.is_client_staff(user):
        staff = getattr(user, 'staff_profile', None)
        if staff:
            assigned_table_ids = _normalize_positive_int_ids(staff.assigned_table_ids or [])
            assigned_group_ids = _staff_assigned_group_ids_for_access(staff)
            if assigned_table_ids and assigned_group_ids:
                tables = tables.filter(Q(id__in=assigned_table_ids) | Q(group_id__in=assigned_group_ids))
            elif assigned_table_ids:
                tables = tables.filter(id__in=assigned_table_ids)
            elif assigned_group_ids:
                tables = tables.filter(group_id__in=assigned_group_ids)

    tables_list = list(tables)  # evaluate once — avoids 3 separate DB hits
    first_table = tables_list[0] if tables_list else None

    ctx = {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'first_table_id': first_table.id if first_table else None,
        'tables': tables_list,
        'table_count': len(tables_list),
        **perms,
    }

    # Admin-specific counts for dashboard management section.
    if _is_admin:
        from client.models import Client
        from staff.models import Staff
        scoped_clients = Client.objects.filter(status='active')
        scoped_tables = IDCardTable.objects.filter(is_active=True)
        scoped_cards = IDCard.objects.all()
        scoped_staff = Staff.objects.all()
        if accessible_ids is not None:
            scoped_clients = scoped_clients.filter(id__in=accessible_ids)
            scoped_tables = scoped_tables.filter(group__client_id__in=accessible_ids)
            scoped_cards = scoped_cards.filter(table__group__client_id__in=accessible_ids)
            scoped_staff = scoped_staff.filter(
                Q(client_id__in=accessible_ids) |
                Q(staff_type='admin_staff', assigned_clients__id__in=accessible_ids)
            ).distinct()

        _admin_counts = {
            'admin_client_count': scoped_clients.count(),
            'admin_staff_count': scoped_staff.count(),
            'admin_table_count': scoped_tables.count(),
            'admin_total_cards': scoped_cards.count(),
        }
        ctx.update(_admin_counts)

    # ── Card status counts ───────────────────────────────────────────────
    # For client/client_staff: use ClientDashboardService result (already computed).
    if _is_admin:
        _gcards = IDCard.objects.all()
        if accessible_ids is not None:
            _gcards = _gcards.filter(table__group__client_id__in=accessible_ids)
        _gcounts = {r['status']: r['n'] for r in _gcards.order_by().values('status').annotate(n=Count('id'))}
        ctx.update({
            'pending_count': _gcounts.get('pending', 0),
            'verified_count': _gcounts.get('verified', 0),
            'approved_count': _gcounts.get('approved', 0),
            'download_count': _gcounts.get('download', 0),
            'pool_count': _gcounts.get('pool', 0),
            'total_cards': sum(v for k, v in _gcounts.items() if k not in ('pool', 'reprint')),
        })
    elif result.success:
        data = result.data
        counts = data.get('counts', data.get('card_counts', {}))
        # If service unexpectedly returns all-zero while tables exist,
        # recompute directly from DB to match desktop dashboard numbers.
        _service_total = int(data.get('total_cards', 0) or 0)
        if _service_total == 0 and tables.exists():
            _fallback_counts = _compute_mobile_counts_fallback(user, client)
            _fallback_total = (
                _fallback_counts.get('pending', 0)
                + _fallback_counts.get('verified', 0)
                + _fallback_counts.get('approved', 0)
                + _fallback_counts.get('download', 0)
            )
            if _fallback_total > 0:
                counts = _fallback_counts
                data = {**data, 'total_cards': _fallback_total}
        ctx.update({
            'pending_count': counts.get('pending', 0),
            'verified_count': counts.get('verified', 0),
            'approved_count': counts.get('approved', 0),
            'download_count': counts.get('download', 0),
            'pool_count': counts.get('pool', 0),
            'total_cards': data.get('total_cards', 0),
        })
    else:
        _fallback_counts = _compute_mobile_counts_fallback(user, client)
        _fallback_total = (
            _fallback_counts.get('pending', 0)
            + _fallback_counts.get('verified', 0)
            + _fallback_counts.get('approved', 0)
            + _fallback_counts.get('download', 0)
        )
        ctx.update({
            'pending_count': _fallback_counts.get('pending', 0),
            'verified_count': _fallback_counts.get('verified', 0),
            'approved_count': _fallback_counts.get('approved', 0),
            'download_count': _fallback_counts.get('download', 0),
            'pool_count': _fallback_counts.get('pool', 0),
            'total_cards': _fallback_total,
        })

    # Build card-based recent activity in the exact format the template expects
    # Admin: all cards across all clients; client roles: scoped to their client
    from django.utils.timesince import timesince as _timesince
    from django.utils import timezone as _tz
    _now = _tz.now()

    def _safe_client_logo_url(_client_obj):
        try:
            _logo = getattr(_client_obj, 'logo', None)
            return _logo.url if _logo else ''
        except Exception:
            return ''

    _cards_scope = (
        IDCard.objects.all() if _is_admin
        else IDCard.objects.filter(table__group__client=client)
    )
    if _is_admin_staff and accessible_ids is not None:
        _cards_scope = _cards_scope.filter(table__group__client_id__in=accessible_ids)
    # For client_staff: restrict activity to their assigned groups only
    if PermissionService.is_client_staff(user):
        _staff = getattr(user, 'staff_profile', None)
        if _staff:
            _assigned_tids = _normalize_positive_int_ids(_staff.assigned_table_ids or [])
            _assigned_gids = _staff_assigned_group_ids_for_access(_staff)
            if _assigned_tids and _assigned_gids:
                _cards_scope = _cards_scope.filter(
                    Q(table_id__in=_assigned_tids) | Q(table__group_id__in=_assigned_gids)
                )
            elif _assigned_tids:
                _cards_scope = _cards_scope.filter(table_id__in=_assigned_tids)
            elif _assigned_gids:
                _cards_scope = _cards_scope.filter(table__group_id__in=_assigned_gids)
    _recent_acts = []
    for _card in _cards_scope.select_related('table').order_by('-updated_at')[:10]:
        _fd = _card.field_data or {}
        _name = (_fd.get('NAME') or _fd.get('name') or _fd.get('Name')
                 or next((str(v) for k, v in _fd.items() if v and not any(w in k.lower() for w in ('photo', 'image', 'pic'))), ''))
        _recent_acts.append({
            'name': _name,
            'status': _card.status,
            'status_display': _card.status.replace('_', ' ').title(),
            'updated_at': _timesince(_card.updated_at, _now) if _card.updated_at else '—',
            'table_name': _card.table.name if _card.table else '',
        })
    ctx.update({'recent_activities': _recent_acts, 'has_new_activity': bool(_recent_acts)})

    # ── Recent Clients section ──────────────────────────────────────────────
    # For admins: mirror desktop dashboard ordering for recent clients.
    # For client / client_staff: show the single client's groups as "clients".
    recent_client_updates = []
    try:
        if _is_admin:
            from client.models import Client as ClientModel

            base_qs = ClientModel.objects.all()
            clients_qs = (
                PermissionService.get_accessible_clients(user, base_qs)
                .annotate(
                    latest_approved=Max(
                        'id_card_groups__tables__id_cards__updated_at',
                        filter=Q(id_card_groups__tables__id_cards__status='approved'),
                    )
                )
                .order_by(
                    F('latest_approved').desc(nulls_last=True),
                    F('created_at').desc(nulls_last=True),
                    F('id').desc(),
                )
            )
            client_list = list(clients_qs[:10])
            client_ids = [c.id for c in client_list]

            # 1 query: card counts by (client, status) for all visible clients
            _cc_qs = IDCard.objects.filter(table__group__client_id__in=client_ids)
            if PermissionService.is_client_staff(user):
                # For staff, we must iterate clients/tables because row-scope is table-specific.
                # However, for the dashboard top-level, we can at least filter by assigned tables.
                staff = getattr(user, 'staff_profile', None)
                if staff:
                    _assigned_tids = _normalize_positive_int_ids(staff.assigned_table_ids or [])
                    _assigned_gids = _staff_assigned_group_ids_for_access(staff)
                    if _assigned_tids and _assigned_gids:
                        _cc_qs = _cc_qs.filter(Q(table_id__in=_assigned_tids) | Q(table__group_id__in=_assigned_gids))
                    elif _assigned_tids:
                        _cc_qs = _cc_qs.filter(table_id__in=_assigned_tids)
                    elif _assigned_gids:
                        _cc_qs = _cc_qs.filter(table__group_id__in=_assigned_gids)

            _cc_raw = _cc_qs.values('table__group__client_id', 'status').annotate(n=Count('id'))
            _cc_map = {}
            for _row in _cc_raw:
                _cc_map.setdefault(_row['table__group__client_id'], {})[_row['status']] = _row['n']

            # 1 query: all active tables for these clients
            _all_tbls = list(
                IDCardTable.objects
                .filter(group__client_id__in=client_ids, is_active=True)
                .select_related('group')
                .order_by('group__client_id', 'group__name', 'name')
            )
            _tbls_by_client = {}
            for _tbl in _all_tbls:
                _cid = _tbl.group.client_id
                _tbls_by_client.setdefault(_cid, [])
                if len(_tbls_by_client[_cid]) < 8:
                    _tbls_by_client[_cid].append(_tbl)

            # 1 query: card counts by (table_id, status) for the sub-rows
            _tbl_ids = [_t.id for _ts in _tbls_by_client.values() for _t in _ts]
            _tc_map = {}
            if _tbl_ids:
                for _row in (IDCard.objects.filter(table_id__in=_tbl_ids)
                             .values('table_id', 'status').annotate(n=Count('id'))):
                    _tc_map.setdefault(_row['table_id'], {})[_row['status']] = _row['n']

            # Assemble in Python — no more per-client / per-table queries
            for c in client_list:
                _sm = _cc_map.get(c.id, {})
                _tables_data = []
                for _tbl in _tbls_by_client.get(c.id, []):
                    _tm = _tc_map.get(_tbl.id, {})
                    _tables_data.append({
                        'id': _tbl.id,
                        'name': _tbl.name,
                        'group_name': _tbl.group.name,
                        'pending': _tm.get('pending', 0),
                        'verified': _tm.get('verified', 0),
                        'approved': _tm.get('approved', 0),
                        'download': _tm.get('download', 0),
                    })
                recent_client_updates.append({
                    'client_id': c.id,
                    'client_name': c.name,
                    'logo_url': _safe_client_logo_url(c),
                    'pending': _sm.get('pending', 0),
                    'verified': _sm.get('verified', 0),
                    'approved': _sm.get('approved', 0),
                    'download': _sm.get('download', 0),
                    'tables': _tables_data,
                })
        else:
            # Client/client_staff: group-first rows with expandable tables.
            _tables_qs = IDCardTable.objects.filter(group__client=client, is_active=True).select_related('group')
            if PermissionService.is_client_staff(user):
                _staff = getattr(user, 'staff_profile', None)
                if _staff:
                    _assigned_table_ids = _normalize_positive_int_ids(_staff.assigned_table_ids or [])
                    _assigned_group_ids = _staff_assigned_group_ids_for_access(_staff)
                    if _assigned_table_ids and _assigned_group_ids:
                        _tables_qs = _tables_qs.filter(Q(id__in=_assigned_table_ids) | Q(group_id__in=_assigned_group_ids))
                    elif _assigned_table_ids:
                        _tables_qs = _tables_qs.filter(id__in=_assigned_table_ids)
                    elif _assigned_group_ids:
                        _tables_qs = _tables_qs.filter(group_id__in=_assigned_group_ids)

            _tables = list(_tables_qs.order_by('group__name', 'name')[:80])
            _table_ids = [t.id for t in _tables]
            _group_ids = list({t.group_id for t in _tables})

            _group_map = {
                g.id: g
                for g in IDCardGroup.objects.filter(id__in=_group_ids).only('id', 'name')
            }

            _gc_map = {}
            _tc_map = {}
            if _table_ids:
                # Optimized: Build status maps for groups and tables in the assigned scope.
                _cards_qs = IDCard.objects.filter(table_id__in=_table_ids)
                if PermissionService.is_client_staff(user):
                    # Apply row-level scope (Class/Section) to the counts as well.
                    # We have to do this carefully since _apply_client_staff_row_scope is table-specific.
                    # For performance on dashboard, we use a slightly more generic approach if possible,
                    # but here we can just apply it to the whole queryset since all tables belong to the same staff.
                    _cards_qs = ClientCardService._apply_client_staff_row_scope(user, None, _cards_qs)

                _gc_raw = _cards_qs.values('table__group_id', 'status').annotate(n=Count('id'))
                for _row in _gc_raw:
                    _gc_map.setdefault(_row['table__group_id'], {})[_row['status']] = _row['n']

                _tc_raw = _cards_qs.values('table_id', 'status').annotate(n=Count('id'))
                for _row in _tc_raw:
                    _tc_map.setdefault(_row['table_id'], {})[_row['status']] = _row['n']

            _tables_by_group = {}
            for _tbl in _tables:
                _tables_by_group.setdefault(_tbl.group_id, [])
                if len(_tables_by_group[_tbl.group_id]) < 8:
                    _tm = _tc_map.get(_tbl.id, {})
                    _tables_by_group[_tbl.group_id].append({
                        'id': _tbl.id,
                        'name': _tbl.name,
                        'group_name': _tbl.group.name,
                        'pending': _tm.get('pending', 0),
                        'verified': _tm.get('verified', 0),
                        'approved': _tm.get('approved', 0),
                        'download': _tm.get('download', 0),
                    })

            _ordered_group_ids = sorted(
                _group_ids,
                key=lambda gid: (_group_map.get(gid).name.lower() if _group_map.get(gid) else ''),
            )

            for gid in _ordered_group_ids:
                _grp = _group_map.get(gid)
                _sm = _gc_map.get(gid, {})
                recent_client_updates.append({
                    'client_id': gid,
                    'client_name': _grp.name if _grp else f'Group #{gid}',
                    'group_id': gid,
                    'pending': _sm.get('pending', 0),
                    'verified': _sm.get('verified', 0),
                    'approved': _sm.get('approved', 0),
                    'download': _sm.get('download', 0),
                    'tables': _tables_by_group.get(gid, []),
                })
    except Exception:
        logger.exception('Failed to build recent_client_updates for home view')

    ctx['recent_client_updates'] = recent_client_updates

    # ── Recent Reprint section ─────────────────────────────────────────────
    recent_reprint_updates = []
    reprint_request_total = 0
    reprint_confirmed_total = 0
    try:
        if _is_admin:
            from client.models import Client as ClientModel

            base_qs = ClientModel.objects.all()
            clients_qs = (
                PermissionService.get_accessible_clients(user, base_qs)
                .annotate(
                    latest_reprint_update=Max(
                        'id_card_groups__tables__reprint_requests__updated_at',
                        filter=Q(id_card_groups__tables__reprint_requests__status__in=['requested', 'confirmed']),
                    )
                )
                .order_by(
                    F('latest_reprint_update').desc(nulls_last=True),
                    'name',
                )
            )

            client_list = list(clients_qs[:10])
            client_ids = [c.id for c in client_list]

            # Per-client requested/confirmed totals
            _rc_raw = (
                ReprintRequest.objects
                .filter(table__group__client_id__in=client_ids, status__in=['requested', 'confirmed'])
                .values('table__group__client_id', 'status')
                .annotate(n=Count('id'))
            )
            _rc_map = {}
            for _row in _rc_raw:
                _rc_map.setdefault(_row['table__group__client_id'], {})[_row['status']] = _row['n']

            # Per-table requested/confirmed totals
            _tr_raw = (
                ReprintRequest.objects
                .filter(table__group__client_id__in=client_ids, status__in=['requested', 'confirmed'])
                .values('table_id', 'status')
                .annotate(n=Count('id'))
            )
            _tr_map = {}
            for _row in _tr_raw:
                _tr_map.setdefault(_row['table_id'], {})[_row['status']] = _row['n']

            _table_ids = list(_tr_map.keys())
            _tables = list(
                IDCardTable.objects
                .filter(id__in=_table_ids, is_active=True)
                .select_related('group')
                .order_by('group__client_id', 'group__name', 'name')
            )
            _tables_by_client = {}
            for _tbl in _tables:
                _cid = _tbl.group.client_id
                _tables_by_client.setdefault(_cid, [])
                if len(_tables_by_client[_cid]) < 8:
                    _tables_by_client[_cid].append(_tbl)

            for c in client_list:
                _cm = _rc_map.get(c.id, {})
                _tables_data = []
                for _tbl in _tables_by_client.get(c.id, []):
                    _tm = _tr_map.get(_tbl.id, {})
                    _tables_data.append({
                        'id': _tbl.id,
                        'name': _tbl.name,
                        'requested': _tm.get('requested', 0),
                        'confirmed': _tm.get('confirmed', 0),
                    })

                _requested = _cm.get('requested', 0)
                _confirmed = _cm.get('confirmed', 0)
                reprint_request_total += _requested
                reprint_confirmed_total += _confirmed

                recent_reprint_updates.append({
                    'client_id': c.id,
                    'client_name': c.name,
                    'logo_url': _safe_client_logo_url(c),
                    'requested': _requested,
                    'confirmed': _confirmed,
                    'tables': _tables_data,
                    'allow_client_jump': True,
                })
        else:
            _tables_qs = IDCardTable.objects.filter(group__client=client, is_active=True).select_related('group')
            if PermissionService.is_client_staff(user):
                _staff = getattr(user, 'staff_profile', None)
                if _staff:
                    _assigned_table_ids = _normalize_positive_int_ids(_staff.assigned_table_ids or [])
                    _assigned_group_ids = _staff_assigned_group_ids_for_access(_staff)
                    if _assigned_table_ids and _assigned_group_ids:
                        _tables_qs = _tables_qs.filter(Q(id__in=_assigned_table_ids) | Q(group_id__in=_assigned_group_ids))
                    elif _assigned_table_ids:
                        _tables_qs = _tables_qs.filter(id__in=_assigned_table_ids)
                    elif _assigned_group_ids:
                        _tables_qs = _tables_qs.filter(group_id__in=_assigned_group_ids)

            _tables = list(_tables_qs.order_by('group__name', 'name')[:80])
            _table_ids = [t.id for t in _tables]

            _tr_raw = (
                ReprintRequest.objects
                .filter(table_id__in=_table_ids, status__in=['requested', 'confirmed'])
                .values('table_id', 'status')
                .annotate(n=Count('id'))
            )
            _tr_map = {}
            for _row in _tr_raw:
                _tr_map.setdefault(_row['table_id'], {})[_row['status']] = _row['n']

            _tables_by_group = {}
            _group_totals = {}
            for _tbl in _tables:
                _tm = _tr_map.get(_tbl.id, {})
                _requested = _tm.get('requested', 0)
                _confirmed = _tm.get('confirmed', 0)
                reprint_request_total += _requested
                reprint_confirmed_total += _confirmed
                _tables_by_group.setdefault(_tbl.group_id, [])
                _group_totals.setdefault(_tbl.group_id, {'requested': 0, 'confirmed': 0})
                _group_totals[_tbl.group_id]['requested'] += _requested
                _group_totals[_tbl.group_id]['confirmed'] += _confirmed
                if len(_tables_by_group[_tbl.group_id]) >= 8:
                    continue
                _tables_by_group[_tbl.group_id].append({
                    'id': _tbl.id,
                    'name': _tbl.name,
                    'requested': _requested,
                    'confirmed': _confirmed,
                })

            _group_map = {
                g.id: g
                for g in IDCardGroup.objects.filter(id__in=list(_tables_by_group.keys())).only('id', 'name')
            }
            _ordered_group_ids = sorted(
                list(_tables_by_group.keys()),
                key=lambda gid: (_group_map.get(gid).name.lower() if _group_map.get(gid) else ''),
            )

            for gid in _ordered_group_ids:
                _grp = _group_map.get(gid)
                _gt = _group_totals.get(gid, {'requested': 0, 'confirmed': 0})
                recent_reprint_updates.append({
                    'client_id': client.id,
                    'client_name': _grp.name if _grp else f'Group #{gid}',
                    'group_id': gid,
                    'requested': _gt.get('requested', 0),
                    'confirmed': _gt.get('confirmed', 0),
                    'tables': _tables_by_group.get(gid, []),
                    'allow_client_jump': False,
                })
    except Exception:
        logger.exception('Failed to build recent_reprint_updates for home view')

    ctx['recent_reprint_updates'] = recent_reprint_updates
    ctx['reprint_request_total'] = reprint_request_total
    ctx['reprint_confirmed_total'] = reprint_confirmed_total

    response = render(request, 'mobile_app/home.html', ctx)
    response['Cache-Control'] = 'no-store'
    return response


@require_mobile_client
def clients_list(request):
    """In-app client list for admin roles — switch active client context."""
    user = request.user
    _, perms = _client_ctx(user)
    if not PermissionService.is_any_admin(user):
        return redirect('mobile_app:home')

    from client.models import Client
    base_qs = Client.objects.select_related('user').all()

    # Admin staff: restrict to assigned clients only
    if PermissionService.is_admin_staff(user):
        staff = getattr(user, 'staff_profile', None)
        if staff:
            assigned_ids = list(staff.assigned_clients.values_list('id', flat=True))
            base_qs = base_qs.filter(id__in=assigned_ids)

    clients = base_qs.annotate(
        tables_count=Count(
            'id_card_groups__tables',
            filter=Q(id_card_groups__tables__is_active=True),
            distinct=True,
        ),
        cards_count=Count(
            'id_card_groups__tables__id_cards',
            distinct=True,
        ),
    ).order_by('name')

    def _safe_client_logo_url(_client_obj):
        try:
            _logo = getattr(_client_obj, 'logo', None)
            return _logo.url if _logo else ''
        except Exception:
            return ''

    client_data = []
    for c in clients:
        client_data.append({
            'id': c.id,
            'name': c.name,
            'logo_url': _safe_client_logo_url(c),
            'tables_count': c.tables_count,
            'cards_count': c.cards_count,
            'status': c.status,
            'user_id': c.user.id if c.user else None,
        })

    # Tables are lazy-loaded per client on first expand — skip server-side preloading
    for _cd in client_data:
        _cd['tables'] = None

    return render(request, 'mobile_app/clients_list.html', {
        'user_name': user.get_full_name() or user.username,
        'clients': client_data,
        'clients_json': client_data,
        'client_count': len(client_data),
        'can_manage_clients': _can_manage_clients_surface(user),
        'can_delete_clients': PermissionService.is_super_admin(user),
        'is_pro_user': PermissionService.is_pro_user(user),
        **perms,
    })


@require_mobile_client
def client_groups(request, client_id):
    """Groups & tables for a specific client — admin only view.
    Admin taps a client in clients_list → sees that client's groups/tables.
    """
    user = request.user
    _, perms = _client_ctx(user)
    if not PermissionService.is_any_admin(user):
        return redirect('mobile_app:home')
    if not PermissionService.can_access_client(user, client_id):
        return redirect('mobile_app:home')

    from client.models import Client
    client = get_object_or_404(Client, id=client_id)

    groups = IDCardGroup.objects.filter(client=client).annotate(
        table_count=Count('tables'),
        total_cards=Count('tables__id_cards'),
        pending_cards=Count('tables__id_cards', filter=Q(tables__id_cards__status='pending')),
        verified_cards=Count('tables__id_cards', filter=Q(tables__id_cards__status='verified')),
        approved_cards=Count('tables__id_cards', filter=Q(tables__id_cards__status='approved')),
        download_cards=Count('tables__id_cards', filter=Q(tables__id_cards__status='download')),
    ).order_by('name')

    tables = IDCardTable.objects.filter(group__client=client).select_related('group').annotate(
        total_cards=Count('id_cards'),
        pending_cards=Count('id_cards', filter=Q(id_cards__status='pending')),
        verified_cards=Count('id_cards', filter=Q(id_cards__status='verified')),
        approved_cards=Count('id_cards', filter=Q(id_cards__status='approved')),
        download_cards=Count('id_cards', filter=Q(id_cards__status='download')),
    ).order_by('group__name', 'name')

    return render(request, 'mobile_app/groups.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'client_name': client.name,
        'groups': groups,
        'tables': tables,
        'back_to_clients': True,
        **perms,
    })


@require_mobile_client
def table_picker(request, status):
    """
    Show table picker when client has multiple tables.
    If only one table, redirect straight to card list.
    """
    user = request.user
    client, perms = _client_ctx(user)
    if not client and not PermissionService.is_any_admin(user):
        return redirect('/app/login/')

    # Check status-specific list permission before showing tables
    status_perm = PermissionService.STATUS_LIST_PERM_MAP.get(status)
    if status_perm and not PermissionService.has(user, status_perm):
        return redirect('mobile_app:home')

    # Admin roles: show tables across ALL accessible clients so counts
    # match the global aggregates displayed on the home dashboard.
    if PermissionService.is_any_admin(user):
        tables = IDCardTable.objects.filter(
            is_active=True,
        ).select_related('group__client').annotate(
            status_count=Count('id_cards', filter=Q(id_cards__status=status)),
        ).order_by('group__client__name', 'group__name', 'name')

        # admin_staff: restrict to their assigned clients
        if PermissionService.is_admin_staff(user):
            assigned_client_ids = PermissionService.get_accessible_client_ids(user)
            tables = tables.filter(group__client_id__in=assigned_client_ids) if assigned_client_ids else tables.none()
    else:
        tables = IDCardTable.objects.filter(
            group__client=client, is_active=True,
        ).select_related('group').annotate(
            status_count=Count('id_cards', filter=Q(id_cards__status=status)),
        ).order_by('group__name', 'name')

    # Restrict client_staff to their assigned groups
    if PermissionService.is_client_staff(user):
        staff = getattr(user, 'staff_profile', None)
        if staff:
            assigned_table_ids = _normalize_positive_int_ids(staff.assigned_table_ids or [])
            assigned_group_ids = _staff_assigned_group_ids_for_access(staff)
            if assigned_table_ids and assigned_group_ids:
                tables = tables.filter(Q(id__in=assigned_table_ids) | Q(group_id__in=assigned_group_ids))
            elif assigned_table_ids:
                tables = tables.filter(id__in=assigned_table_ids)
            elif assigned_group_ids:
                tables = tables.filter(group_id__in=assigned_group_ids)

    tables_list = list(tables)  # evaluate once — avoids 2 extra DB hits
    if len(tables_list) == 1:
        return redirect('mobile_app:card_list', table_id=tables_list[0].id, status=status)

    return render(request, 'mobile_app/table_picker.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'tables': tables_list,
        'status': status,
        'status_display': status.replace('_', ' ').title(),
        **perms,
    })


@require_mobile_client
def card_list(request, table_id, status):
    """Card list for a specific table + status — server-rendered."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client and not PermissionService.is_any_admin(user):
        return redirect('/app/login/')

    table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('mobile_app:home')

    if PermissionService.is_client_staff(user):
        staff = getattr(user, 'staff_profile', None)
        if not staff or not _staff_can_access_table(staff, table):
            return redirect('mobile_app:home')

    status_perm = PermissionService.STATUS_LIST_PERM_MAP.get(status)
    if status_perm and not PermissionService.has(user, status_perm):
        return redirect('mobile_app:home')

    from_date = (request.GET.get('from') or '').strip()
    to_date = (request.GET.get('to') or '').strip()
    selected_search = _sanitize_search_query(request.GET.get('search', ''))
    selected_photo = str(request.GET.get('photo', '') or '').strip().lower()
    if selected_photo not in ('with', 'without'):
        selected_photo = ''
    selected_sort = _normalize_mobile_sort_mode(request.GET.get('sort', 'sr-asc'))
    selected_class = (request.GET.get('class') or '').strip()
    selected_section = (request.GET.get('section') or '').strip()
    table_fields = table.fields if hasattr(table, 'fields') and table.fields else []

    class_field_name = None
    section_field_name = None
    for _field in table_fields:
        _fname = str(_field.get('name', '')).strip()
        _ftype = str(_field.get('type', '')).strip().lower()
        _norm = _fname.lower().replace('_', ' ').replace('-', ' ').replace('.', ' ')
        _norm = ' '.join(_norm.split())
        if class_field_name is None and (
            _ftype == 'class' or _norm in ('class', 'class name', 'std', 'standard', 'designation', 'grade')
        ):
            class_field_name = _fname
        if section_field_name is None and (
            _ftype == 'section' or _norm in ('section', 'section name', 'sec', 'division', 'div')
        ):
            section_field_name = _fname

    # Keep initial server-rendered ordering aligned with api_cards()/ClientCardService.get_cards.
    if status == 'download':
        cards_qs = IDCard.objects.filter(table=table, status=status).order_by('-downloaded_at', '-id')
    elif status == 'pool':
        cards_qs = IDCard.objects.filter(table=table, status=status).order_by('-deleted_at', '-id')
    elif status in ('verified', 'approved'):
        cards_qs = IDCard.objects.filter(table=table, status=status).order_by('-status_changed_at', '-id')
    else:
        cards_qs = IDCard.objects.filter(table=table, status=status).order_by('-created_at', '-id')

    # Keep the first render query lean: only fields used by this view are loaded.
    cards_qs = cards_qs.only(
        'id', 'field_data', 'status', 'photo',
        'created_at', 'status_changed_at', 'downloaded_at', 'deleted_at',
    )

    if selected_search:
        cards_qs = IDCardService._apply_search_filter(cards_qs, selected_search, table=table)

    if status == 'download':
        if from_date:
            parsed_from_dt = parse_datetime(from_date)
            if parsed_from_dt is not None:
                if is_naive(parsed_from_dt):
                    parsed_from_dt = make_aware(parsed_from_dt)
                cards_qs = cards_qs.filter(downloaded_at__gte=parsed_from_dt)
            else:
                parsed_from_d = parse_date(from_date)
                if parsed_from_d is not None:
                    cards_qs = cards_qs.filter(downloaded_at__date__gte=parsed_from_d)

        if to_date:
            parsed_to_dt = parse_datetime(to_date)
            if parsed_to_dt is not None:
                if is_naive(parsed_to_dt):
                    parsed_to_dt = make_aware(parsed_to_dt)
                cards_qs = cards_qs.filter(downloaded_at__lte=parsed_to_dt)
            else:
                parsed_to_d = parse_date(to_date)
                if parsed_to_d is not None:
                    cards_qs = cards_qs.filter(downloaded_at__date__lte=parsed_to_d)

    # For client_staff: apply class/section filter
    allowed_classes = []
    allowed_sections = []
    if PermissionService.is_client_staff(user):
        staff = getattr(user, 'staff_profile', None)
        if staff:
            allowed_classes, allowed_sections = _staff_table_scope_filters(staff, table)
        cards_qs = ClientCardService._apply_client_staff_row_scope(user, table, cards_qs)

    if selected_class:
        selected_class_norm = normalize_class_value(selected_class)
        if not class_field_name or not selected_class_norm:
            cards_qs = cards_qs.none()
        else:
            cards_qs = cards_qs.annotate(_filter_cls=Cast(KeyTextTransform(class_field_name, 'field_data'), CharField()))
            raw_classes = list(
                cards_qs
                .exclude(_filter_cls__isnull=True)
                .exclude(_filter_cls='')
                .values_list('_filter_cls', flat=True)
                .distinct()
            )
            matching_classes = [
                raw_value for raw_value in raw_classes
                if normalize_class_value(raw_value) == selected_class_norm
            ]
            if not matching_classes:
                cards_qs = cards_qs.none()
            else:
                cards_qs = cards_qs.filter(_filter_cls__in=matching_classes)

    if selected_section:
        if not section_field_name:
            cards_qs = cards_qs.none()
        else:
            cards_qs = cards_qs.annotate(_filter_sec=Cast(KeyTextTransform(section_field_name, 'field_data'), CharField()))
            target_section = selected_section.strip().lower()
            raw_sections = list(
                cards_qs
                .exclude(_filter_sec__isnull=True)
                .exclude(_filter_sec='')
                .values_list('_filter_sec', flat=True)
                .distinct()
            )
            matching_sections = [
                raw_value for raw_value in raw_sections
                if str(raw_value).strip().lower() == target_section
            ]
            if not matching_sections:
                cards_qs = cards_qs.none()
            else:
                cards_qs = cards_qs.filter(_filter_sec__in=matching_sections)

    if selected_photo:
        matching_photo_ids = []
        for _photo_card in cards_qs.only('id', 'photo', 'field_data').iterator(chunk_size=500):
            _has_photo = bool(get_card_photo_url(_photo_card, _photo_card.field_data or {}))
            if (selected_photo == 'with' and _has_photo) or (selected_photo == 'without' and not _has_photo):
                matching_photo_ids.append(_photo_card.id)

        if not matching_photo_ids:
            cards_qs = cards_qs.none()
        else:
            cards_qs = cards_qs.filter(id__in=matching_photo_ids)

    if selected_sort in ('name-asc', 'name-desc'):
        name_field_name = ClientCardService._get_name_field(table)

        if name_field_name:
            cards_qs = cards_qs.annotate(_name_sort=Cast(KeyTextTransform(name_field_name, 'field_data'), CharField()))
            if selected_sort == 'name-asc':
                cards_qs = cards_qs.order_by('_name_sort', 'id')
            else:
                cards_qs = cards_qs.order_by('-_name_sort', '-id')

    try:
        _page_size_raw = getattr(
            settings,
            'MOBILE_LIST_PAGE_SIZE',
            getattr(settings, 'MOBILE_LIST_INITIAL_PAGE_SIZE', 50),
        )
        initial_page_size = int(_page_size_raw or 50)
    except (TypeError, ValueError):
        initial_page_size = 50
    initial_page_size = max(10, min(initial_page_size, 200))

    _card_batch_raw = list(cards_qs[:initial_page_size + 1])
    _has_more_raw = len(_card_batch_raw) > initial_page_size
    cards_batch = _card_batch_raw[:initial_page_size]

    photo_exts = ('.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.hei')
    image_field_keywords = ('photo', 'image', 'signature', 'barcode', 'qr')
    image_field_types = ('photo', 'rel_photo', 'image', 'file', 'mother_photo', 'father_photo', 'signature', 'barcode', 'qr_code')

    def _is_image_like_name(raw_name):
        _name = str(raw_name).strip().lower()
        if not _name or _name.startswith(('ref', '__', '_')):
            return False
        return any(_kw in _name for _kw in image_field_keywords)

    def _is_image_like_type(raw_type):
        return str(raw_type).strip().lower() in image_field_types

    def _normalize_photo_value(raw_val):
        if not isinstance(raw_val, str):
            return None, False
        _raw = raw_val.strip()
        if not _raw:
            return None, False

        _media_base = settings.MEDIA_URL if str(settings.MEDIA_URL).endswith('/') else f"{settings.MEDIA_URL}/"
        _low = _raw.lower()

        if _low.startswith('data:image/'):
            return _raw, True

        if _low == 'not_found' or _low.startswith('pending:'):
            return None, True

        if _raw.startswith('http://') or _raw.startswith('https://'):
            return _raw, True

        _norm = _raw.replace('\\', '/')
        _norm_low = _norm.lower()

        _marker = '/media/'
        _idx = _norm_low.rfind(_marker)
        if _idx != -1:
            _rel = _norm[_idx + len(_marker):].lstrip('/')
            return (_media_base + _rel, True) if _rel else (None, True)

        if _norm.startswith('/'):
            return _norm, True

        _media_roots = (
            'adarshimg/',
            'card_media/',
            'clients_imgs/',
            'clients_imgs_cropped/',
            'clients_imgs_failed/',
            'staff_imgs/',
            'images/',
        )
        for _root in _media_roots:
            _root_marker = '/' + _root
            _root_idx = _norm_low.find(_root_marker)
            if _root_idx != -1:
                return _media_base + _norm[_root_idx + 1:].lstrip('/'), True
            if _norm_low.startswith(_root):
                return _media_base + _norm.lstrip('/'), True

        if _norm_low.endswith(photo_exts) or '/' in _norm:
            return _media_base + _norm.lstrip('/'), True

        return None, True

    def _extract_photo_slots(fd, primary_photo_url, field_defs):
        _fd = fd or {}

        photo_field_names = []
        _seen = set()
        for _f in field_defs or []:
            _name = str(_f.get('name', '')).strip()
            if not _name:
                continue
            _lower = _name.lower()
            _ftype = str(_f.get('type', '')).strip().lower()
            if _is_image_like_type(_ftype) or _is_image_like_name(_lower):
                if _lower not in _seen:
                    _seen.add(_lower)
                    photo_field_names.append(_name)

        slots = []
        urls = []

        if photo_field_names:
            for _fname in photo_field_names:
                _val = _get_field_value_case_insensitive(_fd, _fname)
                if not _has_meaningful_field_value(_val):
                    _slot = _rel_photo_slot_for_name(_fname)
                    if _slot:
                        for _alias in _rel_photo_aliases_for_slot(_slot):
                            _val = _get_field_value_case_insensitive(_fd, _alias)
                            if _has_meaningful_field_value(_val):
                                break
                _url, _has_path = _normalize_photo_value(_val)
                slots.append({'url': _url, 'has_path': _has_path, 'field_name': _fname})
                if _url and _url not in urls:
                    urls.append(_url)

            if primary_photo_url and primary_photo_url not in urls:
                _empty_idx = next((i for i, _slot in enumerate(slots) if not _slot.get('url')), None)
                if _empty_idx is not None:
                    slots[_empty_idx] = {
                        'url': primary_photo_url,
                        'has_path': True,
                        'field_name': slots[_empty_idx].get('field_name'),
                    }
                else:
                    slots.insert(0, {'url': primary_photo_url, 'has_path': True})
                urls.append(primary_photo_url)

            return slots, urls

        if primary_photo_url:
            slots.append({'url': primary_photo_url, 'has_path': True})
            urls.append(primary_photo_url)

        # Only auto-discover fields if table definition is empty or generic.
        # This prevents "REF_PHOTO" etc. from creating excessive columns when
        # explicit fields like "STUDENT PHOTO" are already present.
        if not photo_field_names:
            for _key, _val in _fd.items():
                _kl = str(_key).strip().lower()
                if not _is_image_like_name(_kl):
                    continue
                _url, _has_path = _normalize_photo_value(_val)
                if _url and _url not in urls:
                    slots.append({'url': _url, 'has_path': True})
                    urls.append(_url)
                elif not _url and _has_path:
                    slots.append({'url': None, 'has_path': True})

        if not slots:
            # Absolute fallback: search all values for anything that looks like a path/URL
            for _val in _fd.values():
                _url, _has_path = _normalize_photo_value(_val)
                if _url and _url not in urls:
                    slots.append({'url': _url, 'has_path': True})
                    urls.append(_url)

        if not slots:
            slots.append({'url': None, 'has_path': False})

        return slots, urls

    def _build_display_fields(fd, table_field_defs):
        """Build ordered key/value pairs for mobile card view based on table field order."""
        def _has_display_value(v):
            return v is not None and str(v).strip() != ''

        excluded = {'name', 'class', 'section', 'designation'}
        by_lower = {}
        for key, val in (fd or {}).items():
            if key is None:
                continue
            key_str = str(key)
            lower = key_str.strip().lower()
            if lower not in by_lower:
                by_lower[lower] = (key_str, val)

        ordered = []
        used = set()
        for f in table_field_defs or []:
            name = str(f.get('name', '')).strip()
            if not name:
                continue
            lower = name.lower()
            ftype = str(f.get('type', '')).strip().lower()
            if lower in used:
                continue
            item = by_lower.get(lower)
            if not item:
                continue
            key_str, val = item
            if not _has_display_value(val):
                continue
            if lower in excluded or _is_image_like_name(lower) or _is_image_like_type(ftype):
                continue
            ordered.append({'key': key_str, 'value': val})
            used.add(lower)

        for key, val in (fd or {}).items():
            if not _has_display_value(val):
                continue
            key_str = str(key)
            lower = key_str.strip().lower()
            if lower in used:
                continue
            if lower in excluded or _is_image_like_name(lower):
                continue
            ordered.append({'key': key_str, 'value': val})
            used.add(lower)

        return ordered

    cards = []
    display_name_field = ClientCardService._get_name_field(table)
    for idx, card in enumerate(cards_batch):
        fd = card.field_data or {}
        name = ''
        if display_name_field:
            name = _get_field_value_case_insensitive(fd, display_name_field) or ''
        if not name:
            name = fd.get('NAME') or fd.get('name') or fd.get('Name') or ''
        roll_no = fd.get('ROLL NO') or fd.get('ROLL_NO') or fd.get('roll_no') or fd.get('ID') or ''
        father_name = fd.get('FATHER NAME') or fd.get("FATHER'S NAME") or fd.get('FATHER_NAME') or fd.get('father_name') or ''
        mother_name = fd.get('MOTHER NAME') or fd.get("MOTHER'S NAME") or fd.get('MOTHER_NAME') or fd.get('mother_name') or ''
        class_name = (fd.get(class_field_name) if class_field_name else None) or fd.get('CLASS') or fd.get('class') or fd.get('DESIGNATION') or ''
        section = (fd.get(section_field_name) if section_field_name else None) or fd.get('SECTION') or fd.get('section') or ''
        dob = fd.get('DOB') or fd.get('dob') or fd.get('DATE OF BIRTH') or fd.get('DATE_OF_BIRTH') or ''

        primary_photo_url = card.photo.url if card.photo else None
        photo_slots, photo_urls = _extract_photo_slots(fd, primary_photo_url, table_fields)
        photo_url = next((_slot.get('url') for _slot in photo_slots if _slot.get('url')), None)

        cards.append({
            'id': card.id,
            'sr_no': idx + 1,
            'name': name,
            'roll_no': roll_no,
            'father_name': father_name,
            'mother_name': mother_name,
            'class_name': class_name,
            'section': section,
            'dob': dob,
            'photo_url': photo_url,
            'photo_urls': photo_urls,
            'photo_slots': photo_slots,
            'has_photo': bool(photo_urls),
            'status': card.status,
            'downloaded_date': card.downloaded_at.strftime('%Y-%m-%d') if card.downloaded_at else '',
            'field_data': fd,
            'display_fields': _build_display_fields(fd, table_fields),
        })

    total_count = cards_qs.count()

    # Row-scope is applied directly in queryset, so pagination stays accurate for scoped users.
    has_more = _has_more_raw

    # Build and cache filter options from full table data to avoid repeated full-table scans.
    filter_meta = _get_table_filter_metadata(table, table_fields)
    all_classes = list(filter_meta.get('all_classes') or [])
    all_sections = list(filter_meta.get('all_sections') or [])
    class_to_sections = dict(filter_meta.get('class_to_sections') or {})

    # Respect explicit client_staff restrictions in filter options.
    _allowed_norm_classes = {
        normalize_class_value(value)
        for value in (allowed_classes or [])
        if normalize_class_value(value)
    }

    if _allowed_norm_classes:
        all_classes = [c for c in all_classes if normalize_class_value(c) in _allowed_norm_classes]
    if allowed_sections:
        _allowed_set = set(allowed_sections)
        all_sections = [s for s in all_sections if s in _allowed_set]

    if _allowed_norm_classes:
        class_to_sections = {
            _cls: _sections
            for _cls, _sections in class_to_sections.items()
            if normalize_class_value(_cls) in _allowed_norm_classes
        }
    if allowed_sections:
        _allowed_sec_set = set(allowed_sections)
        class_to_sections = {
            _cls: [s for s in _sections if s in _allowed_sec_set]
            for _cls, _sections in class_to_sections.items()
        }
    # Count badges — single aggregate query replaces 4 separate COUNTs
    tab_counts = {'pending': 0, 'verified': 0, 'approved': 0, 'download': 0, 'pool': 0}
    _tab_counts_qs = IDCard.objects.filter(table=table)
    if PermissionService.is_client_staff(user):
        _tab_counts_qs = ClientCardService._apply_client_staff_row_scope(user, table, _tab_counts_qs)
    
    for _row in _tab_counts_qs.values('status').annotate(n=Count('id')):
        if _row['status'] in tab_counts:
            tab_counts[_row['status']] = _row['n']

    can_reprint_request_list = PermissionService.has(user, 'perm_reprint_request_list')
    can_reprint_confirmed_list = PermissionService.has(user, 'perm_confirmed_list')

    reprint_counts = {'requested': 0, 'confirmed': 0}
    if status == 'download' and (can_reprint_request_list or can_reprint_confirmed_list):
        for _row in (
            ReprintRequest.objects
            .filter(table=table, status__in=['requested', 'confirmed'])
            .values('status')
            .annotate(n=Count('id'))
        ):
            if _row['status'] in reprint_counts:
                reprint_counts[_row['status']] = _row['n']

    has_any_list_actions = bool(perms.get('perm_idcard_info') or perms.get('perm_idcard_bulk_download'))
    if status == 'pending':
        has_any_list_actions = has_any_list_actions or bool(
            perms.get('perm_idcard_add') or
            perms.get('perm_idcard_edit') or
            perms.get('perm_idcard_verify') or
            perms.get('perm_idcard_delete')
        )
    elif status == 'verified':
        has_any_list_actions = has_any_list_actions or bool(
            perms.get('perm_idcard_edit') or
            perms.get('perm_idcard_approve') or
            perms.get('perm_idcard_verify')
        )
    elif status == 'approved':
        has_any_list_actions = has_any_list_actions or bool(
            perms.get('perm_idcard_edit') or
            perms.get('perm_idcard_bulk_download') or
            perms.get('perm_idcard_approve')
        )
    elif status == 'download':
        has_any_list_actions = has_any_list_actions or bool(
            perms.get('perm_idcard_edit') or
            perms.get('perm_idcard_retrieve') or
            perms.get('perm_idcard_reprint_list')
        )
    elif status == 'pool':
        has_any_list_actions = has_any_list_actions or bool(
            perms.get('perm_idcard_retrieve') or
            perms.get('perm_idcard_delete_from_pool')
        )

    response = render(request, 'mobile_app/list_page.html', {
        'user_name': user.get_full_name() or user.username,
        # Always show the table owner in list subtitle to avoid stale fallback client labels.
        'client': getattr(table.group, 'client', None) or client,
        'table': table,
        'table_id': table.id,
        'first_table_id': table.id,
        'group': table.group,
        'students': cards,
        'total_count': total_count,
        'page_size': initial_page_size,
        'has_more': has_more,
        'list_type': status,
        'classes': all_classes,
        'sections': all_sections,
        'class_to_sections': class_to_sections,
        'table_fields': json.dumps(table_fields, default=str),
        # View-only mode: clients on approved/download lists can only view, not act
        'view_only_list': status in ('approved', 'download') and not PermissionService.is_any_admin(user),
        'pool_edit_locked': status == 'pool' and not PermissionService.is_any_admin(user),
        'tab_counts': tab_counts,
        'reprint_counts': reprint_counts,
        'can_reprint_request_list': can_reprint_request_list,
        'can_reprint_confirmed_list': can_reprint_confirmed_list,
        'has_any_list_actions': has_any_list_actions,
        'from_date': from_date if status == 'download' else '',
        'to_date': to_date if status == 'download' else '',
        'selected_search': selected_search,
        'selected_photo': selected_photo,
        'selected_sort': selected_sort,
        'search_scope_table_id': table.id,
        'selected_class': selected_class,
        'selected_section': selected_section,
        'back_url': '/app/clients/' if PermissionService.is_any_admin(user) else '/app/',
        **perms,
    })
    # Prevent browser from serving stale HTML after status changes
    response['Cache-Control'] = 'no-store'
    return response


@require_mobile_client
def reprint_lists(request, client_id):
    """Mobile Reprint page with Request/Confirmed tabs per table."""
    user = request.user
    _, perms = _client_ctx(user)

    can_request_list = PermissionService.has(user, 'perm_reprint_request_list')
    can_confirmed_list = PermissionService.has(user, 'perm_confirmed_list')
    if not (can_request_list or can_confirmed_list):
        return redirect('mobile_app:home')
    if not PermissionService.can_access_client(user, client_id):
        return redirect('mobile_app:home')

    from client.models import Client as ClientModel
    target_client = get_object_or_404(ClientModel, id=client_id)

    active_step = (request.GET.get('step') or 'request_list').strip().lower()
    if active_step not in ('request_list', 'confirmed'):
        active_step = 'request_list'
    if active_step == 'request_list' and not can_request_list:
        active_step = 'confirmed'
    elif active_step == 'confirmed' and not can_confirmed_list:
        active_step = 'request_list'

    tables_qs = (
        IDCardTable.objects
        .filter(group__client_id=client_id, is_active=True)
        .select_related('group', 'group__client')
        .order_by('group__name', 'name')
    )

    if PermissionService.is_client_staff(user):
        staff = getattr(user, 'staff_profile', None)
        if staff:
            assigned_table_ids = _normalize_positive_int_ids(staff.assigned_table_ids or [])
            assigned_group_ids = _staff_assigned_group_ids_for_access(staff)
            if assigned_table_ids and assigned_group_ids:
                tables_qs = tables_qs.filter(Q(id__in=assigned_table_ids) | Q(group_id__in=assigned_group_ids))
            elif assigned_table_ids:
                tables_qs = tables_qs.filter(id__in=assigned_table_ids)
            elif assigned_group_ids:
                tables_qs = tables_qs.filter(group_id__in=assigned_group_ids)

    tables = list(tables_qs)
    table_ids = [t.id for t in tables]

    reprint_map = {}
    if table_ids:
        for row in (
            ReprintRequest.objects
            .filter(table_id__in=table_ids, status__in=['requested', 'confirmed'])
            .values('table_id', 'status')
            .annotate(n=Count('id'))
        ):
            reprint_map.setdefault(row['table_id'], {})[row['status']] = row['n']

    download_map = {}
    if table_ids:
        for row in (
            IDCard.objects
            .filter(table_id__in=table_ids, status='download')
            .values('table_id')
            .annotate(n=Count('id'))
        ):
            download_map[row['table_id']] = row['n']

    table_items = []
    request_total = 0
    confirmed_total = 0
    download_total = 0
    for t in tables:
        sm = reprint_map.get(t.id, {})
        requested = int(sm.get('requested', 0) or 0)
        confirmed = int(sm.get('confirmed', 0) or 0)
        request_total += requested
        confirmed_total += confirmed
        download_total += int(download_map.get(t.id, 0) or 0)
        table_items.append({
            'id': t.id,
            'name': t.name,
            'group_name': t.group.name,
            'requested': requested,
            'confirmed': confirmed,
        })

    return render(request, 'mobile_app/reprint_lists.html', {
        'client': target_client,
        'tables': table_items,
        'active_step': active_step,
        'request_total': request_total,
        'confirmed_total': confirmed_total,
        'download_total': download_total,
        'can_reprint_request_list': can_request_list,
        'can_reprint_confirmed_list': can_confirmed_list,
        **perms,
    })


@require_mobile_client
@require_http_methods(["GET", "POST"])
def reprint_table(request, table_id):
    """Mobile per-table Reprint workflow page (Request List / Confirmed List)."""
    user = request.user
    _, perms = _client_ctx(user)

    can_request_list = PermissionService.has(user, 'perm_reprint_request_list')
    can_confirmed_list = PermissionService.has(user, 'perm_confirmed_list')
    if not (can_request_list or can_confirmed_list):
        return redirect('mobile_app:home')

    table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('mobile_app:home')

    active_step = (request.GET.get('step') or request.POST.get('step') or 'request_list').strip().lower()
    if active_step not in ('request_list', 'confirmed'):
        active_step = 'request_list'
    if active_step == 'request_list' and not can_request_list:
        active_step = 'confirmed'
    elif active_step == 'confirmed' and not can_confirmed_list:
        active_step = 'request_list'

    search_query = _sanitize_search_query(request.GET.get('q') or request.POST.get('q') or '')
    can_manage_actions = PermissionService.is_any_admin(user)
    notice = {'message': '', 'type': ''}

    if request.method == 'POST':
        post_action = (request.POST.get('action') or '').strip()
        rr_ids = []
        if request.POST.get('rr_id'):
            try:
                rr_ids = [int(request.POST.get('rr_id'))]
            except (TypeError, ValueError):
                rr_ids = []
        if not rr_ids:
            for _rid in request.POST.getlist('rr_ids'):
                try:
                    rr_ids.append(int(_rid))
                except (TypeError, ValueError):
                    continue

        # Deduplicate while preserving order.
        rr_ids = list(dict.fromkeys(rr_ids))

        if not can_manage_actions:
            notice = {'message': 'Only admin users can perform reprint actions.', 'type': 'error'}
        elif not rr_ids:
            notice = {'message': 'No request selected.', 'type': 'error'}
        elif len(rr_ids) > MAX_REPRINT_ACTION_IDS:
            notice = {'message': f'Maximum {MAX_REPRINT_ACTION_IDS} requests can be processed at once.', 'type': 'error'}
        elif post_action == 'send_to_print':
            # Cardprint integration removed: simply move eligible requested
            # rows to confirmed locally (no PrintRequest creation).
            with transaction.atomic():
                requested_qs = ReprintRequest.objects.select_for_update().filter(
                    id__in=rr_ids,
                    table=table,
                    status='requested',
                    card__status='download',
                )
                eligible_rr_ids = list(requested_qs.values_list('id', flat=True))
                card_ids = list(requested_qs.values_list('card_id', flat=True))

                if not card_ids:
                    notice = {'message': 'No requested reprint items found.', 'type': 'error'}
                else:
                    moved_count = ReprintRequest.objects.filter(
                        id__in=eligible_rr_ids,
                        table=table,
                        status='requested',
                        card__status='download',
                    ).update(status='confirmed')
                    notice = {
                        'message': f'{moved_count} request(s) moved to Confirmed List.',
                        'type': 'success',
                    }
                    active_step = 'request_list'
        elif post_action == 'reject':
            from reprintcard.services import ReprintWorkflowService

            with transaction.atomic():
                result = ReprintWorkflowService.reject_requests(table=table, rr_ids=rr_ids)
            if result.success:
                notice = {'message': result.message or 'Rejected selected requests.', 'type': 'success'}
            else:
                notice = {'message': result.message or 'Could not reject selected requests.', 'type': 'error'}
        else:
            notice = {'message': 'Invalid reprint action.', 'type': 'error'}

        qs = {'step': active_step}
        if search_query:
            qs['q'] = search_query
        if notice['message']:
            qs['notice'] = notice['message']
            qs['notice_type'] = notice['type']
        return redirect(f"{request.path}?{urlencode(qs)}")

    notice_message = (request.GET.get('notice') or '').strip()
    notice_type = (request.GET.get('notice_type') or '').strip().lower()
    if notice_type not in ('success', 'error', 'info'):
        notice_type = 'info'

    _counts_qs = ReprintRequest.objects.filter(
        table=table, status__in=['requested', 'confirmed'], card__status='download'
    )
    if PermissionService.is_client_staff(user):
        # We use ClientCardService row scope logic on the card relation
        _counts_qs = _counts_qs.filter(
            card_id__in=ClientCardService._apply_client_staff_row_scope(
                user, table, IDCard.objects.filter(table=table)
            ).values_list('id', flat=True)
        )

    counts_raw = _counts_qs.values('status').annotate(n=Count('id'))
    step_counts = {'requested': 0, 'confirmed': 0}
    for row in counts_raw:
        if row['status'] in step_counts:
            step_counts[row['status']] = row['n']

    if active_step == 'request_list':
        rr_qs = ReprintRequest.objects.filter(
            table=table,
            status='requested',
            card__status='download',
        ).select_related('card', 'requested_by').only(
            'id', 'status', 'created_at', 'updated_at', 'card_id',
            'card__id', 'card__field_data', 'card__photo',
            'requested_by__username', 'requested_by__first_name', 'requested_by__last_name',
        ).order_by('-created_at')
    else:
        rr_qs = ReprintRequest.objects.filter(
            table=table,
            status='confirmed',
            card__status='download',
        ).select_related('card', 'requested_by').only(
            'id', 'status', 'created_at', 'updated_at', 'card_id',
            'card__id', 'card__field_data', 'card__photo',
            'requested_by__username', 'requested_by__first_name', 'requested_by__last_name',
        ).order_by('-updated_at')

    if search_query:
        search_filter = (
            Q(card__field_data__icontains=search_query) |
            Q(requested_by__username__icontains=search_query)
        )
        if search_query.isdigit():
            search_filter |= Q(card_id=int(search_query))
        rr_qs = rr_qs.filter(search_filter)

    table_fields = table.fields if hasattr(table, 'fields') and table.fields else []
    image_field_keywords = ('photo', 'image', 'signature', 'barcode', 'qr')
    image_field_types = ('photo', 'rel_photo', 'image', 'file', 'mother_photo', 'father_photo', 'signature', 'barcode', 'qr_code')

    def _is_image_like_name(raw_name):
        _name = str(raw_name).strip().lower()
        if not _name:
            return False
        return any(_kw in _name for _kw in image_field_keywords)

    def _is_image_like_type(raw_type):
        return str(raw_type).strip().lower() in image_field_types

    def _build_display_fields(fd, table_field_defs):
        """Build ordered key/value list to mirror pending-list card detail blocks."""
        def _has_display_value(v):
            return v is not None and str(v).strip() != ''

        excluded = {'name', 'class', 'section', 'designation'}
        by_lower = {}
        for key, val in (fd or {}).items():
            if key is None:
                continue
            key_str = str(key)
            key_lower = key_str.strip().lower()
            if not key_lower:
                continue
            by_lower[key_lower] = (key_str, val)

        ordered = []
        used = set()

        for f in (table_field_defs or []):
            name = str(f.get('name', '')).strip()
            if not name:
                continue
            lower = name.lower()
            ftype = str(f.get('type', '')).strip().lower()
            if lower in used:
                continue
            item = by_lower.get(lower)
            if not item:
                continue
            key_str, val = item
            if not _has_display_value(val):
                continue
            if lower in excluded or _is_image_like_name(lower) or _is_image_like_type(ftype):
                continue
            ordered.append({'key': key_str, 'value': val})
            used.add(lower)

        for key_lower, (key_str, val) in by_lower.items():
            if key_lower in used:
                continue
            if not _has_display_value(val):
                continue
            if key_lower in excluded or _is_image_like_name(key_lower):
                continue
            ordered.append({'key': key_str, 'value': val})
            used.add(key_lower)

        return ordered

    rr_rows = list(rr_qs[:200])
    items = []
    for rr in rr_rows:
        card = rr.card
        fd = card.field_data or {}
        name = (
            fd.get('NAME') or fd.get('name') or fd.get('Name') or
            fd.get('STUDENT NAME') or fd.get('Student Name') or fd.get('student_name') or
            fd.get('FULL NAME') or fd.get('Full Name') or fd.get('full_name') or
            ''
        )
        roll_no = fd.get('ROLL NO') or fd.get('ROLL_NO') or fd.get('roll_no') or fd.get('ID') or ''
        class_name = fd.get('CLASS') or fd.get('class') or fd.get('DESIGNATION') or ''
        section = fd.get('SECTION') or fd.get('section') or ''
        photo_url = get_card_photo_url(card, fd)
        requested_by = rr.requested_by
        requested_by_name = (requested_by.get_full_name() or requested_by.username) if requested_by else 'System'
        display_fields = _build_display_fields(fd, table_fields)

        items.append({
            'rr_id': rr.id,
            'card_id': card.id,
            'name': name,
            'roll_no': roll_no,
            'class_name': class_name,
            'section': section,
            'photo_url': photo_url,
            'display_fields': display_fields,
            'requested_by_name': requested_by_name,
            'requested_at': rr.created_at.strftime('%d-%b-%Y %H:%M') if rr.created_at else '',
            'confirmed_at': rr.updated_at.strftime('%d-%b-%Y %H:%M') if rr.updated_at else '',
        })

    return render(request, 'mobile_app/reprint_table.html', {
        'client': table.group.client,
        'table': table,
        'active_step': active_step,
        'items': items,
        'request_total': step_counts['requested'],
        'confirmed_total': step_counts['confirmed'],
        'search_query': search_query,
        'can_manage_reprint_actions': can_manage_actions,
        'can_reprint_request_list': can_request_list,
        'can_reprint_confirmed_list': can_confirmed_list,
        'notice_message': notice_message,
        'notice_type': notice_type,
        **perms,
    })


@require_mobile_client
def camera_capture(request, table_id, card_id=None):
    """Camera page for capturing ID-card photos."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/app/login/')

    table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('mobile_app:home')

    if not PermissionService.has(user, 'perm_idcard_edit'):
        return redirect('mobile_app:home')

    if card_id is not None:
        scoped_card = IDCard.objects.select_related('table__group').filter(id=card_id, table_id=table.id).first()
        if not scoped_card or not _can_access_card_with_row_scope(user, scoped_card):
            return redirect('mobile_app:home')

    # If no specific card_id provided, show card picker with all cards for name-based search
    all_cards = []
    if card_id is None:
        cards_qs = IDCard.objects.filter(table=table).only('id', 'field_data').order_by('id')
        if PermissionService.is_client_staff(user):
            cards_qs = ClientCardService._apply_client_staff_row_scope(user, table, cards_qs)
        cards_qs = cards_qs[:300]
        for card in cards_qs:
            fd = card.field_data or {}
            name = fd.get('NAME') or fd.get('name') or fd.get('Name') or f'Card #{card.id}'
            all_cards.append({'id': card.id, 'name': name})

    return render(request, 'mobile_app/camera.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'table': table,
        'table_id': table.id,
        'card_id': card_id or 0,
        'all_cards_json': all_cards,
        **perms,
    })


@require_mobile_client
def notifications(request):
    """Notifications page backed by the same source used in Settings."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/app/login/')

    system_notifications, _ = _get_system_notifications(
        user,
        limit=40,
        mark_visible_as_read=True,
    )
    priority_to_color = {
        'critical': 'red',
        'high': 'orange',
        'normal': 'blue',
        'low': 'gray',
    }
    notifications_payload = [
        {
            'title': n['title'],
            'message': n['message'],
            'time': n['created_at'],
            'read': n['is_read'],
            'icon': n['icon_class'],
            'color': priority_to_color.get(n['priority'], 'gray'),
        }
        for n in system_notifications
    ]

    return render(request, 'mobile_app/notifications.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'notifications': notifications_payload,
        **perms,
    })


@require_mobile_client
def profile(request):
    """Profile page with real user data."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/app/login/')

    return render(request, 'mobile_app/profile.html', {
        'user_name': user.get_full_name() or user.username,
        'user_email': user.email or '',
        'user_phone': getattr(user, 'phone', '') or '',
        'user_role': {
            'super_admin': 'Super Admin',
            'admin_staff': 'Admin Staff',
            'client': 'Client Admin',
            'client_staff': 'Client Staff',
        }.get(getattr(user, 'role', ''), 'User'),
        'client': client,
        'client_name': client.name if client else '',
        **perms,
    })


@require_mobile_client
def permissions_center(request):
    """Android native permission control surface for camera/gallery/storage/notifications."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/app/login/')

    return render(request, 'mobile_app/permissions.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        **perms,
    })


# ---------------------------------------------------------------------------
# API VIEWS — thin proxies to existing services
# ---------------------------------------------------------------------------

@require_mobile_client
@require_http_methods(["POST"])
def api_card_status(request, card_id):
    """Change single card status."""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    new_status = data.get('status', '')
    result = ClientCardService.change_card_status(request.user, card_id, new_status)
    if result.success:
        return JsonResponse({'success': True, 'message': result.message, **(result.data or {})})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_mobile_client
@require_http_methods(["POST"])
@rate_limit(max_requests=30, window_seconds=60, key_prefix='mab_bulk')
def api_bulk_status(request, table_id):
    """Bulk status change."""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    card_ids_raw = data.get('card_ids', [])
    new_status = data.get('status', '')
    if not isinstance(card_ids_raw, list):
        return JsonResponse({'success': False, 'message': 'card_ids must be a list'}, status=400)
    if len(card_ids_raw) > 500:
        return JsonResponse({'success': False, 'message': 'Maximum 500 cards per batch'}, status=400)

    card_ids = _normalize_positive_int_ids(card_ids_raw)
    if not card_ids:
        return JsonResponse({'success': False, 'message': 'No valid card IDs provided'}, status=400)

    result = ClientCardService.bulk_change_status(request.user, table_id, card_ids, new_status)
    if result.success:
        return JsonResponse({'success': True, 'message': result.message, **(result.data or {})})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_mobile_client
@require_http_methods(["POST"])
@rate_limit(max_requests=20, window_seconds=60, key_prefix='mab_upload')
def api_upload_photo(request, table_id):
    """Upload photo for a card."""
    card_id = request.POST.get('card_id')
    photo = request.FILES.get('photo')
    if not photo or not card_id:
        return JsonResponse({'success': False, 'message': 'photo and card_id required'}, status=400)

    try:
        card_id_int = int(str(card_id).strip())
    except (TypeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid card_id'}, status=400)

    if not PermissionService.has(request.user, 'perm_idcard_edit'):
        return JsonResponse({'success': False, 'message': 'No permission to edit cards'}, status=403)

    _ok, _err, photo = _unpack_validate_image_result(_validate_image(photo), photo)
    if not _ok:
        return JsonResponse({'success': False, 'message': _err}, status=400)
    try:
        card = IDCard.objects.select_related('table__group').get(id=card_id_int, table_id=table_id)
        if not _can_access_card_with_row_scope(request.user, card):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
        if _is_mobile_client_edit_locked(request.user, card.status):
            return _mobile_client_edit_locked_response()

        # Keep mobile + desktop lists in sync by writing through the same
        # field_data/CardMedia image pipeline used by idcard-actions tables.
        image_field_names = ImageService.get_image_field_names(card.table.fields or [])
        requested_field_name = str(request.POST.get('field_name') or '').strip()
        preferred_field_name = None

        if requested_field_name:
            requested_token = _field_token(requested_field_name)
            for field_name in image_field_names:
                if _field_token(field_name) == requested_token:
                    preferred_field_name = field_name
                    break

        if not preferred_field_name:
            image_names_by_token = {
                _field_token(field_name): field_name
                for field_name in image_field_names
            }
            relation_name_tokens = ('father', 'mother', 'guardian', 'rel')
            for field_def in (card.table.fields or []):
                field_name = str(field_def.get('name', '')).strip()
                if not field_name:
                    continue

                token = _field_token(field_name)
                matched_name = image_names_by_token.get(token)
                if not matched_name:
                    continue

                field_type = str(field_def.get('type', '')).strip().lower()
                field_name_lower = field_name.lower()
                is_relation_like = (
                    field_type in {'rel_photo', 'mother_photo', 'father_photo'}
                    or any(tok in field_name_lower for tok in relation_name_tokens)
                )
                if field_type == 'photo' and not is_relation_like:
                    preferred_field_name = matched_name
                    break

        if not preferred_field_name:
            for field_name in image_field_names:
                field_name_lower = str(field_name or '').lower()
                if 'photo' not in field_name_lower:
                    continue
                if any(tok in field_name_lower for tok in ('rel', 'father', 'mother', 'guardian')):
                    continue
                preferred_field_name = field_name
                break

        if not preferred_field_name and image_field_names:
            preferred_field_name = image_field_names[0]

        if preferred_field_name:
            field_data = card.field_data or {}
            field_data_upper = {k.upper(): v for k, v in field_data.items()}
            existing_value = field_data.get(preferred_field_name, '') or field_data_upper.get(preferred_field_name.upper(), '')

            media_result = ImageService.process_image_field(
                field_name=preferred_field_name,
                new_value=None,
                existing_value=existing_value,
                client=card.table.group.client,
                card=card,
                uploaded_file=photo,
                batch_counter=1,
                uploaded_by=request.user,
            )
            if not media_result.success:
                return JsonResponse({'success': False, 'message': media_result.message or 'Upload failed'}, status=400)

            final_value = (media_result.data or {}).get('final_value', existing_value)
            field_data[preferred_field_name] = final_value
            card.field_data = field_data
            card.modified_by = getattr(request.user, 'username', '') or card.modified_by

            # Legacy compatibility: keep ImageField pointer aligned with latest path.
            if final_value:
                card.photo = final_value
                # Extra safety: ensure thumbnail exists even if initial creation failed.
                ThumbnailService.ensure_thumbnail_exists(final_value)

            card.save(update_fields=['field_data', 'modified_by', 'photo'])
            photo_url = get_card_photo_url(card, field_data)
            return JsonResponse({
                'success': True,
                'message': 'Photo uploaded',
                'photo_url': photo_url,
                'field_name': preferred_field_name,
            })

        # Fallback for tables with no configured image fields:
        # still route through ImageService so filenames follow timestamp policy.
        field_data = card.field_data or {}
        existing_value = ''
        try:
            existing_value = card.photo.name or ''
        except Exception:
            existing_value = ''

        media_result = ImageService.process_image_field(
            field_name='PHOTO',
            new_value=None,
            existing_value=existing_value,
            client=card.table.group.client,
            card=card,
            uploaded_file=photo,
            batch_counter=1,
            uploaded_by=request.user,
        )
        if not media_result.success:
            return JsonResponse({'success': False, 'message': media_result.message or 'Upload failed'}, status=400)

        final_value = (media_result.data or {}).get('final_value', existing_value)
        if final_value:
            field_data['PHOTO'] = final_value
            card.field_data = field_data
            card.photo = final_value
            # Extra safety: ensure thumbnail exists even if initial creation failed.
            ThumbnailService.ensure_thumbnail_exists(final_value)

        card.modified_by = getattr(request.user, 'username', '') or card.modified_by
        update_fields = ['modified_by']
        if final_value:
            update_fields.extend(['field_data', 'photo'])
        card.save(update_fields=update_fields)

        return JsonResponse({
            'success': True,
            'message': 'Photo uploaded',
            'photo_url': get_card_photo_url(card, field_data),
            'field_name': 'PHOTO',
        })
    except IDCard.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Card not found'}, status=404)
    except Exception:
        import logging as _log
        _log.getLogger(__name__).exception('Photo upload error')
        return JsonResponse({'success': False, 'message': 'An error occurred during upload.'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_card_detail(request, card_id):
    """Get card detail JSON."""
    result = ClientCardService.get_card_detail(request.user, card_id)
    if result.success:
        return JsonResponse({'success': True, 'data': result.data})
    msg = (result.message or '').lower()
    if 'permission' in msg or 'access denied' in msg or 'access' in msg:
        status_code = 403
    else:
        status_code = 404
    return JsonResponse({'success': False, 'message': result.message}, status=status_code)


@require_mobile_client
@require_http_methods(["GET"])
def api_cards(request, table_id):
    """Get cards for a table (paginated)."""
    status_filter = str(request.GET.get('status', '') or '').strip().lower()
    if not status_filter:
        return JsonResponse({'success': False, 'message': 'status is required'}, status=400)

    valid_statuses = {'pending', 'verified', 'approved', 'download', 'pool', 'reprint'}
    if status_filter not in valid_statuses:
        return JsonResponse({'success': False, 'message': 'Invalid status'}, status=400)

    search = _sanitize_search_query(request.GET.get('search', ''))
    from_date = (request.GET.get('from') or '').strip()
    to_date = (request.GET.get('to') or '').strip()
    photo_filter = str(request.GET.get('photo', '') or '').strip().lower()
    if photo_filter not in ('complete', 'pending', 'incomplete', 'with', 'without'):
        photo_filter = ''
    sort_mode = _normalize_mobile_sort_mode(request.GET.get('sort', 'sr-asc'))
    class_filter = (request.GET.get('class') or '').strip()
    section_filter = (request.GET.get('section') or '').strip()
    try:
        page = max(int(request.GET.get('page', 1)), 1)
        per_page = max(1, min(int(request.GET.get('per_page', 50)), 200))
    except (ValueError, TypeError):
        page, per_page = 1, 50

    offset = (page - 1) * per_page

    try:
        result = ClientCardService.get_cards(
            request.user, table_id,
            status_filter, offset, per_page,
            search or None,
            from_date=from_date,
            to_date=to_date,
            class_filter=class_filter or None,
            section_filter=section_filter or None,
            photo_filter=photo_filter or None,
            sort_order=sort_mode,
        )
        if result.success:
            return JsonResponse({'success': True, 'data': result.data})
        return JsonResponse({'success': False, 'message': result.message}, status=400)
    except Exception:
        logger.exception('api_cards error')
        return JsonResponse({'success': False, 'message': 'Unable to load cards.'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_all_card_ids(request, table_id):
    """Return all matching card IDs for mobile Select All (full dataset, filter-aware)."""
    status_filter = str(request.GET.get('status', '') or '').strip().lower()
    if not status_filter:
        return JsonResponse({'success': False, 'message': 'status is required'}, status=400)

    valid_statuses = {'pending', 'verified', 'approved', 'download', 'pool', 'reprint'}
    if status_filter not in valid_statuses:
        return JsonResponse({'success': False, 'message': 'Invalid status'}, status=400)

    table = get_object_or_404(IDCardTable, id=table_id)
    if not ClientAccessService.can_access_table(request.user, table):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)

    perm_map = {
        'pending': 'perm_idcard_pending_list',
        'verified': 'perm_idcard_verified_list',
        'pool': 'perm_idcard_pool_list',
        'approved': 'perm_idcard_approved_list',
        'download': 'perm_idcard_download_list',
        'reprint': 'perm_idcard_reprint_list',
    }
    needed_perm = perm_map.get(status_filter)
    if needed_perm and not PermissionService.has(request.user, needed_perm):
        return JsonResponse({'success': False, 'message': 'No permission to view this list'}, status=403)

    search = _sanitize_search_query(request.GET.get('search', ''))
    from_date = (request.GET.get('from') or '').strip()
    to_date = (request.GET.get('to') or '').strip()
    selected_class = (request.GET.get('class') or '').strip()
    selected_section = (request.GET.get('section') or '').strip()
    photo_filter = str(request.GET.get('photo', '') or '').strip().lower()
    if photo_filter not in ('complete', 'pending', 'incomplete', 'with', 'without'):
        photo_filter = ''

    if status_filter == 'download':
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('-downloaded_at', '-id')
    elif status_filter == 'pool':
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('-deleted_at', '-id')
    elif status_filter in ('verified', 'approved'):
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('-status_changed_at', '-id')
    else:
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('-created_at', '-id')

    cards_qs = ClientCardService._apply_client_staff_row_scope(request.user, table, cards_qs)

    if search:
        cards_qs = IDCardService._apply_search_filter(cards_qs, search, table=table)

    if status_filter == 'download':
        if from_date:
            parsed_from_dt = parse_datetime(from_date)
            if parsed_from_dt is not None:
                if is_naive(parsed_from_dt):
                    parsed_from_dt = make_aware(parsed_from_dt)
                cards_qs = cards_qs.filter(downloaded_at__gte=parsed_from_dt)
            else:
                parsed_from_d = parse_date(from_date)
                if parsed_from_d is not None:
                    cards_qs = cards_qs.filter(downloaded_at__date__gte=parsed_from_d)

        if to_date:
            parsed_to_dt = parse_datetime(to_date)
            if parsed_to_dt is not None:
                if is_naive(parsed_to_dt):
                    parsed_to_dt = make_aware(parsed_to_dt)
                cards_qs = cards_qs.filter(downloaded_at__lte=parsed_to_dt)
            else:
                parsed_to_d = parse_date(to_date)
                if parsed_to_d is not None:
                    cards_qs = cards_qs.filter(downloaded_at__date__lte=parsed_to_d)

    class_field_name, section_field_name, _ = ClientCardService._get_class_section_branch_fields(table)

    if selected_class:
        selected_class_norm = normalize_class_value(selected_class)
        if not class_field_name or not selected_class_norm:
            cards_qs = cards_qs.none()
        else:
            cards_qs = cards_qs.annotate(_filter_cls=Cast(KeyTextTransform(class_field_name, 'field_data'), CharField()))
            raw_classes = list(
                cards_qs
                .exclude(_filter_cls__isnull=True)
                .exclude(_filter_cls='')
                .values_list('_filter_cls', flat=True)
                .distinct()
            )
            matching_classes = [
                raw_value for raw_value in raw_classes
                if normalize_class_value(raw_value) == selected_class_norm
            ]
            if not matching_classes:
                cards_qs = cards_qs.none()
            else:
                cards_qs = cards_qs.filter(_filter_cls__in=matching_classes)

    if selected_section:
        if not section_field_name:
            cards_qs = cards_qs.none()
        else:
            cards_qs = cards_qs.annotate(_filter_sec=Cast(KeyTextTransform(section_field_name, 'field_data'), CharField()))
            target_section = selected_section.strip().lower()
            raw_sections = list(
                cards_qs
                .exclude(_filter_sec__isnull=True)
                .exclude(_filter_sec='')
                .values_list('_filter_sec', flat=True)
                .distinct()
            )
            matching_sections = [
                raw_value for raw_value in raw_sections
                if str(raw_value).strip().lower() == target_section
            ]
            if not matching_sections:
                cards_qs = cards_qs.none()
            else:
                cards_qs = cards_qs.filter(_filter_sec__in=matching_sections)

    if photo_filter:
        matching_photo_ids = []
        for _photo_card in cards_qs.only('id', 'photo', 'field_data').iterator(chunk_size=500):
            _has_photo = bool(get_card_photo_url(_photo_card, _photo_card.field_data or {}))
            if (photo_filter == 'with' and _has_photo) or (photo_filter == 'without' and not _has_photo):
                matching_photo_ids.append(_photo_card.id)

        if not matching_photo_ids:
            cards_qs = cards_qs.none()
        else:
            cards_qs = cards_qs.filter(id__in=matching_photo_ids)

    card_ids = list(cards_qs.values_list('id', flat=True))
    return JsonResponse({
        'success': True,
        'card_ids': card_ids,
        'total_count': len(card_ids),
    })


@require_mobile_client
@require_http_methods(["GET"])
def api_filter_options(request, table_id):
    """Return full-dataset class/section filter options for a table status scope."""
    status_filter = str(request.GET.get('status', '') or '').strip().lower()
    if not status_filter:
        return JsonResponse({'success': False, 'message': 'status is required'}, status=400)

    valid_statuses = {'pending', 'verified', 'approved', 'download', 'pool', 'reprint'}
    if status_filter not in valid_statuses:
        return JsonResponse({'success': False, 'message': 'Invalid status'}, status=400)

    table = get_object_or_404(IDCardTable, id=table_id)
    if not ClientAccessService.can_access_table(request.user, table):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)

    perm_map = {
        'pending': 'perm_idcard_pending_list',
        'verified': 'perm_idcard_verified_list',
        'pool': 'perm_idcard_pool_list',
        'approved': 'perm_idcard_approved_list',
        'download': 'perm_idcard_download_list',
        'reprint': 'perm_idcard_reprint_list',
    }
    needed_perm = perm_map.get(status_filter)
    if needed_perm and not PermissionService.has(request.user, needed_perm):
        return JsonResponse({'success': False, 'message': 'No permission to view this list'}, status=403)

    search = _sanitize_search_query(request.GET.get('search', ''))
    from_date = (request.GET.get('from') or '').strip()
    to_date = (request.GET.get('to') or '').strip()
    selected_class = (request.GET.get('class') or '').strip()
    selected_section = (request.GET.get('section') or '').strip()
    photo_filter = str(request.GET.get('photo', '') or '').strip().lower()
    if photo_filter not in ('with', 'without'):
        photo_filter = ''

    if status_filter == 'download':
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('-downloaded_at', '-id')
    elif status_filter == 'pool':
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('-deleted_at', '-id')
    elif status_filter in ('verified', 'approved'):
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('-status_changed_at', '-id')
    else:
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('-created_at', '-id')

    cards_qs = ClientCardService._apply_client_staff_row_scope(request.user, table, cards_qs)

    if search:
        cards_qs = IDCardService._apply_search_filter(cards_qs, search, table=table)

    if status_filter == 'download':
        if from_date:
            parsed_from_dt = parse_datetime(from_date)
            if parsed_from_dt is not None:
                if is_naive(parsed_from_dt):
                    parsed_from_dt = make_aware(parsed_from_dt)
                cards_qs = cards_qs.filter(downloaded_at__gte=parsed_from_dt)
            else:
                parsed_from_d = parse_date(from_date)
                if parsed_from_d is not None:
                    cards_qs = cards_qs.filter(downloaded_at__date__gte=parsed_from_d)

        if to_date:
            parsed_to_dt = parse_datetime(to_date)
            if parsed_to_dt is not None:
                if is_naive(parsed_to_dt):
                    parsed_to_dt = make_aware(parsed_to_dt)
                cards_qs = cards_qs.filter(downloaded_at__lte=parsed_to_dt)
            else:
                parsed_to_d = parse_date(to_date)
                if parsed_to_d is not None:
                    cards_qs = cards_qs.filter(downloaded_at__date__lte=parsed_to_d)

    class_field_name, section_field_name, _ = ClientCardService._get_class_section_branch_fields(table)

    if selected_class:
        selected_class_norm = normalize_class_value(selected_class)
        if not class_field_name or not selected_class_norm:
            cards_qs = cards_qs.none()
        else:
            cards_qs = cards_qs.annotate(_filter_cls=Cast(KeyTextTransform(class_field_name, 'field_data'), CharField()))
            raw_classes = list(
                cards_qs
                .exclude(_filter_cls__isnull=True)
                .exclude(_filter_cls='')
                .values_list('_filter_cls', flat=True)
                .distinct()
            )
            matching_classes = [
                raw_value for raw_value in raw_classes
                if normalize_class_value(raw_value) == selected_class_norm
            ]
            if not matching_classes:
                cards_qs = cards_qs.none()
            else:
                cards_qs = cards_qs.filter(_filter_cls__in=matching_classes)

    if selected_section:
        if not section_field_name:
            cards_qs = cards_qs.none()
        else:
            cards_qs = cards_qs.annotate(_filter_sec=Cast(KeyTextTransform(section_field_name, 'field_data'), CharField()))
            target_section = selected_section.strip().lower()
            raw_sections = list(
                cards_qs
                .exclude(_filter_sec__isnull=True)
                .exclude(_filter_sec='')
                .values_list('_filter_sec', flat=True)
                .distinct()
            )
            matching_sections = [
                raw_value for raw_value in raw_sections
                if str(raw_value).strip().lower() == target_section
            ]
            if not matching_sections:
                cards_qs = cards_qs.none()
            else:
                cards_qs = cards_qs.filter(_filter_sec__in=matching_sections)

    if photo_filter:
        matching_photo_ids = []
        for _photo_card in cards_qs.only('id', 'photo', 'field_data').iterator(chunk_size=500):
            _has_photo = bool(get_card_photo_url(_photo_card, _photo_card.field_data or {}))
            if (photo_filter == 'with' and _has_photo) or (photo_filter == 'without' and not _has_photo):
                matching_photo_ids.append(_photo_card.id)

        if not matching_photo_ids:
            cards_qs = cards_qs.none()
        else:
            cards_qs = cards_qs.filter(id__in=matching_photo_ids)

    filter_meta = _build_filter_metadata_from_queryset(
        cards_qs,
        class_field_name=class_field_name,
        section_field_name=section_field_name,
    )

    return JsonResponse({
        'success': True,
        'data': {
            'fields': table.fields,
            'classes': list(filter_meta.get('all_classes') or []),
            'sections': list(filter_meta.get('all_sections') or []),
            'class_to_sections': dict(filter_meta.get('class_to_sections') or {}),
            'total': cards_qs.count(),
        },
    })


@require_mobile_client
@require_http_methods(["POST"])
@rate_limit(max_requests=20, window_seconds=60, key_prefix='mab_add')
def api_card_add(request, table_id):
    """Add a new card to a table."""
    try:
        table = get_object_or_404(IDCardTable, id=table_id, is_active=True)
        if not ClientAccessService.can_access_table(request.user, table):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
        if not PermissionService.has(request.user, 'perm_idcard_add'):
            return JsonResponse({'success': False, 'message': 'No permission to add cards'}, status=403)

        field_data_raw = request.POST.get('field_data', '{}')
        try:
            field_data = json.loads(field_data_raw)
        except json.JSONDecodeError:
            field_data = {}
        if not isinstance(field_data, dict):
            field_data = {}

        legacy_photo = request.FILES.get('photo')
        image_files = {}
        for file_key in request.FILES:
            uploaded = request.FILES.get(file_key)
            if not uploaded:
                continue

            key_l = str(file_key).strip().lower()
            if key_l == 'photo' or key_l.startswith('image_'):
                _ok, _err, validated_file = _unpack_validate_image_result(_validate_image(uploaded), uploaded)
                if not _ok:
                    return JsonResponse({'success': False, 'message': _err}, status=400)

                if key_l == 'photo':
                    legacy_photo = validated_file
                elif key_l.startswith('image_'):
                    image_files[file_key] = validated_file

        # Guard against accidental PHOTO overwrite from mixed payloads.
        # When explicit image_<field> files are present, ignore legacy photo key.
        if image_files:
            legacy_photo = None

        with transaction.atomic():
            card = IDCard.objects.create(table=table, field_data=field_data, status='pending')

            if image_files or legacy_photo:
                update_result = IDCardService.update_card(
                    card_id=card.id,
                    field_data={},
                    image_files=image_files,
                    uploaded_by=request.user,
                    legacy_photo_file=legacy_photo,
                    modified_by=getattr(request.user, 'username', '') or None,
                )
                if not update_result.success:
                    raise ValueError(update_result.message or 'Image upload failed')

        try:
            CacheVersionService.bump('mob_filter', int(table.id))
            CacheVersionService.bump('class_section', int(table.group.client_id))
            CacheVersionService.bump('client_dash_counts', f'client:{table.group.client_id}')
            CacheVersionService.bump('global_search', 'all')
        except Exception:
            pass

        return JsonResponse({'success': True, 'message': 'Card added successfully', 'card_id': card.id})
    except ValueError as err:
        return JsonResponse({'success': False, 'message': str(err)}, status=400)
    except Exception:
        import logging as _log
        _log.getLogger(__name__).exception('Card add error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_table_download_pdf(request, table_id):
    """Download PDF for all cards in a specific table/status (Mobile Wrapper)."""
    user = request.user
    table = get_object_or_404(IDCardTable, id=table_id)
    if not ClientAccessService.can_access_table(user, table):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
    
    status = request.GET.get('status', 'pending')
    selected_ids_raw = request.GET.get('selected_ids', '')
    search_q = (request.GET.get('search') or '').strip()
    class_f = (request.GET.get('class') or '').strip()
    section_f = (request.GET.get('section') or '').strip()
    photo_f = (request.GET.get('photo') or '').strip().lower()
    
    try:
        from exports.services import ExportService
        service = ExportService(user)
        
        # Fetch base queryset
        qs = IDCard.objects.filter(table=table, status=status)
        
        # Apply filters
        if search_q:
            qs = _search_cards_for_global_results(qs, search_q, limit=None)
        if class_f:
            qs = qs.filter(field_data__CLASS=class_f) # Adjust based on actual JSON field naming
        if section_f:
            qs = qs.filter(field_data__SECTION=section_f)
        if photo_f == 'complete':
            qs = qs.exclude(photo__in=['', 'NOT_FOUND']).exclude(photo__startswith='PENDING:')
        elif photo_f == 'pending':
            qs = qs.filter(photo__startswith='PENDING:')
            
        if selected_ids_raw:
            try:
                selected_ids = [int(i.strip()) for i in selected_ids_raw.split(',') if i.strip()]
                if selected_ids:
                    qs = qs.filter(id__in=selected_ids)
            except (ValueError, TypeError):
                pass

        # Apply row-level scoping
        from core.views.idcard_helpers import _apply_client_staff_row_scope
        qs = _apply_client_staff_row_scope(qs, user, table)
        
        card_ids = list(qs.values_list('id', flat=True))
        
        if not card_ids:
            return JsonResponse({'success': False, 'message': f'No {status} cards to download'}, status=404)
        
        # Trigger PDF generation
        result = service.export_pdf(table_id, card_ids, status=status)
        
        if not result.success:
            return JsonResponse({'success': False, 'message': result.message}, status=400)
            
        return result.response
    except Exception as e:
        logger.exception('Mobile PDF download error')
        return JsonResponse({'success': False, 'message': 'Export failed'}, status=500)


@require_mobile_client
@require_http_methods(["POST"])
def api_card_update(request, table_id, card_id):
    """Update an existing card."""
    try:
        card = get_object_or_404(IDCard.objects.select_related('table__group'), id=card_id, table_id=table_id)
        if not _can_access_card_with_row_scope(request.user, card):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
        if not PermissionService.has(request.user, 'perm_idcard_edit'):
            return JsonResponse({'success': False, 'message': 'No permission to edit cards'}, status=403)
        if _is_mobile_client_edit_locked(request.user, card.status):
            return _mobile_client_edit_locked_response()

        field_data_raw = request.POST.get('field_data', '{}')
        try:
            field_data = json.loads(field_data_raw)
        except json.JSONDecodeError:
            field_data = {}
        if not isinstance(field_data, dict):
            field_data = {}

        legacy_photo = request.FILES.get('photo')
        image_files = {}
        for file_key in request.FILES:
            uploaded = request.FILES.get(file_key)
            if not uploaded:
                continue

            key_l = str(file_key).strip().lower()
            if key_l == 'photo' or key_l.startswith('image_'):
                _ok, _err, validated_file = _unpack_validate_image_result(_validate_image(uploaded), uploaded)
                if not _ok:
                    return JsonResponse({'success': False, 'message': _err}, status=400)

                if key_l == 'photo':
                    legacy_photo = validated_file
                elif key_l.startswith('image_'):
                    image_files[file_key] = validated_file

        # Guard against accidental PHOTO overwrite from mixed payloads.
        # When explicit image_<field> files are present, ignore legacy photo key.
        if image_files:
            legacy_photo = None

        update_result = IDCardService.update_card(
            card_id=card.id,
            field_data=field_data,
            image_files=image_files,
            uploaded_by=request.user,
            legacy_photo_file=legacy_photo,
            modified_by=getattr(request.user, 'username', '') or None,
        )
        if not update_result.success:
            return JsonResponse({'success': False, 'message': update_result.message or 'Update failed'}, status=400)

        return JsonResponse({'success': True, 'message': 'Card updated successfully'})
    except Exception:
        logger.exception('Card update error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


@require_mobile_client
@require_http_methods(["POST"])
def api_table_update_fields(request, table_id):
    """Update the column definitions (fields) of an IDCardTable.
    Accepts JSON body: { "fields": [{"name": "NAME", "type": "text", "order": 0, "mandatory": false}, ...] }
    """
    try:
        table = get_object_or_404(IDCardTable, id=table_id)
        if not ClientAccessService.can_access_table(request.user, table):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
        # Table schema changes must follow settings permission, not card-value edit permission.
        if not PermissionService.has(request.user, 'perm_idcard_setting_edit'):
            return JsonResponse({'success': False, 'message': 'Settings edit permission required'}, status=403)

        body = json.loads(request.body or '{}')
        raw_fields = body.get('fields', [])

        if not isinstance(raw_fields, list):
            return JsonResponse({'success': False, 'message': 'fields must be a list'}, status=400)

        VALID_FIELD_TYPES = {
            'text', 'number', 'date', 'select', 'photo', 'signature', 'qr_code',
            'barcode', 'class_section', 'rel_photo',
            # Legacy aliases accepted and normalized to rel_photo.
            'mother_photo', 'father_photo',
        }
        MAX_FIELDS = 30

        if len(raw_fields) > MAX_FIELDS:
            return JsonResponse({'success': False, 'message': f'Maximum {MAX_FIELDS} fields allowed'}, status=400)

        validated = []
        for idx, f in enumerate(raw_fields):
            if not isinstance(f, dict):
                continue
            name = str(f.get('name', '')).strip().upper()
            if not name:
                continue
            ftype = f.get('type', 'text')
            if ftype not in VALID_FIELD_TYPES:
                ftype = 'text'
            elif ftype in ('mother_photo', 'father_photo'):
                ftype = 'rel_photo'
            validated.append({
                'name': name,
                'type': ftype,
                'order': idx,
                'mandatory': bool(f.get('mandatory', False)),
            })

        old_fields = table.fields if isinstance(table.fields, list) else []
        rename_pairs = _build_field_rename_pairs(old_fields, validated)

        with transaction.atomic():
            table.fields = validated
            table.save(update_fields=['fields'])
            cards_updated = _migrate_table_field_data_for_renames(table.id, rename_pairs)
            media_updated = _migrate_cardmedia_field_names_for_renames(table.id, rename_pairs)

        try:
            CacheVersionService.bump('mob_filter', int(table.id))
            CacheVersionService.bump('class_section', int(table.group.client_id))
            CacheVersionService.bump('global_search', 'all')
        except Exception:
            pass

        return JsonResponse({
            'success': True,
            'message': 'Column order saved successfully',
            'migrated_card_rows': cards_updated,
            'migrated_media_rows': media_updated,
        })
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)
    except Exception:
        logger.exception('Table update fields error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


# ---------------------------------------------------------------------------
# NEW PAGE VIEWS — Card detail, Staff, Groups, Settings, Search
# ---------------------------------------------------------------------------

@require_mobile_client
def card_detail(request, card_id):
    """Full card detail page with all field data."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/app/login/')

    result = ClientCardService.get_card_detail(user, card_id)
    if not result.success:
        return redirect('mobile_app:home')

    card_data = result.data

    return render(request, 'mobile_app/card_detail.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'card': card_data,
        'card_json': json.dumps(card_data, default=str),
        **perms,
    })


@require_mobile_client
def staff_manage(request):
    """Staff management page.

    Client role manages client_staff; super_admin manages admin_staff.
    """
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/app/login/')

    # Super admin can always manage admin staff.
    # Client role must also hold Manage Client permission (website parity).
    if not PermissionService.is_super_admin(user) and not _can_manage_client_staff_surface(user):
        return redirect('mobile_app:home')

    # For client role, use the service; super_admin sees admin staff only.
    staff_list = []
    if PermissionService.is_client(user):
        result = ClientStaffService.list_staff(user)
        if result.success:
            staff_list = result.data.get('staff', [])
    elif PermissionService.is_super_admin(user):
        # Admin management view should only include admin_staff.
        staff_list = _list_mobile_admin_staff(limit=200)

    # Get groups for assignment dropdown
    groups = IDCardGroup.objects.filter(client=client).values('id', 'name')

    return render(request, 'mobile_app/staff_manage.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'staff_list': staff_list,
        'staff_json': staff_list,
        'groups': list(groups),
        'groups_json': list(groups),
        **perms,
    })


@require_mobile_client
def groups_overview(request):
    """Groups & tables overview page."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return _mobile_no_client_redirect()

    tables = IDCardTable.objects.filter(group__client=client).select_related('group')

    if PermissionService.is_client_staff(user):
        staff = getattr(user, 'staff_profile', None)
        if staff:
            assigned_table_ids = _normalize_positive_int_ids(staff.assigned_table_ids or [])
            assigned_group_ids = _staff_assigned_group_ids_for_access(staff)
            if assigned_table_ids and assigned_group_ids:
                tables = tables.filter(Q(id__in=assigned_table_ids) | Q(group_id__in=assigned_group_ids))
            elif assigned_table_ids:
                tables = tables.filter(id__in=assigned_table_ids)
            elif assigned_group_ids:
                tables = tables.filter(group_id__in=assigned_group_ids)

    scoped_table_ids = tables.values('id')
    scoped_group_ids = tables.values('group_id')

    groups = IDCardGroup.objects.filter(id__in=scoped_group_ids).annotate(
        table_count=Count('tables', filter=Q(tables__id__in=scoped_table_ids), distinct=True),
        total_cards=Count('tables__id_cards', filter=Q(tables__id__in=scoped_table_ids)),
        pending_cards=Count('tables__id_cards', filter=Q(tables__id__in=scoped_table_ids, tables__id_cards__status='pending')),
        verified_cards=Count('tables__id_cards', filter=Q(tables__id__in=scoped_table_ids, tables__id_cards__status='verified')),
        approved_cards=Count('tables__id_cards', filter=Q(tables__id__in=scoped_table_ids, tables__id_cards__status='approved')),
        download_cards=Count('tables__id_cards', filter=Q(tables__id__in=scoped_table_ids, tables__id_cards__status='download')),
    ).order_by('name')

    tables = tables.annotate(
        total_cards=Count('id_cards'),
        pending_cards=Count('id_cards', filter=Q(id_cards__status='pending')),
        verified_cards=Count('id_cards', filter=Q(id_cards__status='verified')),
        approved_cards=Count('id_cards', filter=Q(id_cards__status='approved')),
        download_cards=Count('id_cards', filter=Q(id_cards__status='download')),
    ).order_by('group__name', 'name')

    return render(request, 'mobile_app/groups.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'groups': groups,
        'tables': tables,
        **perms,
    })


@require_mobile_client
def settings_page(request):
    """Settings — 4 tabbed sections: Notifications / Logs / Email / System Info."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/app/login/')

    ctx = {
        'user_name': user.get_full_name() or user.username,
        'user_email': user.email or '',
        'client': client,
        **perms,
    }

    # Counts (client-scoped)
    ctx['table_count'] = IDCardTable.objects.filter(group__client=client, is_active=True).count()
    ctx['group_count'] = IDCardGroup.objects.filter(client=client).count()
    ctx['total_cards'] = IDCard.objects.filter(table__group__client=client).count()

    # Admin-specific counts
    if PermissionService.is_any_admin(user):
        from client.models import Client
        accessible_ids = _admin_accessible_client_ids(user)
        scoped_clients = Client.objects.filter(status='active')
        scoped_tables = IDCardTable.objects.filter(is_active=True)
        scoped_cards = IDCard.objects.all()
        scoped_staff = Staff.objects.all()
        if accessible_ids is not None:
            scoped_clients = scoped_clients.filter(id__in=accessible_ids)
            scoped_tables = scoped_tables.filter(group__client_id__in=accessible_ids)
            scoped_cards = scoped_cards.filter(table__group__client_id__in=accessible_ids)
            scoped_staff = scoped_staff.filter(
                Q(client_id__in=accessible_ids) |
                Q(staff_type='admin_staff', assigned_clients__id__in=accessible_ids)
            ).distinct()
        ctx['admin_client_count'] = scoped_clients.count()
        ctx['admin_staff_count'] = scoped_staff.count()
        ctx['admin_table_count'] = scoped_tables.count()
        ctx['admin_total_cards'] = scoped_cards.count()

    # ── TAB: Notifications ───────────────────────────────────────────────
    ctx['system_notifications'], ctx['unread_system_count'] = _get_system_notifications(
        user,
        limit=20,
        mark_visible_as_read=False,
    )

    # ── TAB: Logs ────────────────────────────────────────────────────────
    from django.utils.timesince import timesince as _timesince
    from django.utils import timezone as _tz
    _now = _tz.now()
    _cards_for_logs = []
    can_view_logs = PermissionService.is_any_admin(user) or PermissionService.has(user, 'perm_idcard_info')

    if can_view_logs:
        if PermissionService.is_any_admin(user):
            _cards_scope = IDCard.objects.all()
            if PermissionService.is_admin_staff(user):
                accessible_ids = _admin_accessible_client_ids(user)
                _cards_scope = _cards_scope.filter(table__group__client_id__in=accessible_ids)
            _cards_for_logs = list(
                _cards_scope.select_related('table', 'table__group').order_by('-updated_at')[:30]
            )
        elif PermissionService.is_client_staff(user):
            _tables_scope = IDCardTable.objects.filter(group__client=client, is_active=True)
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_table_ids = _normalize_positive_int_ids(staff.assigned_table_ids or [])
                assigned_group_ids = _staff_assigned_group_ids_for_access(staff)
                if assigned_table_ids and assigned_group_ids:
                    _tables_scope = _tables_scope.filter(Q(id__in=assigned_table_ids) | Q(group_id__in=assigned_group_ids))
                elif assigned_table_ids:
                    _tables_scope = _tables_scope.filter(id__in=assigned_table_ids)
                elif assigned_group_ids:
                    _tables_scope = _tables_scope.filter(group_id__in=assigned_group_ids)
            else:
                _tables_scope = _tables_scope.none()

            # Pull a larger candidate set, then apply per-card row scope checks.
            _candidate_cards = (
                IDCard.objects
                .filter(table_id__in=_tables_scope.values('id'))
                .select_related('table', 'table__group')
                .order_by('-updated_at')[:200]
            )
            for _card in _candidate_cards:
                if _can_access_card_with_row_scope(user, _card):
                    _cards_for_logs.append(_card)
                    if len(_cards_for_logs) >= 30:
                        break
        else:
            _cards_for_logs = list(
                IDCard.objects
                .filter(table__group__client=client)
                .select_related('table', 'table__group')
                .order_by('-updated_at')[:30]
            )

    _log_acts = []
    for _card in _cards_for_logs:
        _fd = _card.field_data or {}
        _name = _fd.get('NAME') or _fd.get('name') or _fd.get('Name') or f'Card #{_card.id}'
        _log_acts.append({
            'name': _name,
            'status': _card.status,
            'status_display': _card.status.replace('_', ' ').title(),
            'updated_at': _timesince(_card.updated_at, _now) if _card.updated_at else '—',
            'table_name': _card.table.name if _card.table else '',
            'group_name': _card.table.group.name if _card.table and _card.table.group else '',
        })
    ctx['log_activities'] = _log_acts

    # ── TAB: System Info ─────────────────────────────────────────────────
    import django as _django
    import sys as _sys
    import os as _os
    try:
        _vpath = _os.path.join(settings.BASE_DIR, 'VERSION.txt')
        with open(_vpath) as _vf:
            ctx['app_version'] = _vf.read().strip()
    except Exception:
        ctx['app_version'] = str(getattr(settings, 'APP_VERSION', 'v0.00.00') or 'v0.00.00')
    ctx['django_version'] = _django.__version__
    ctx['python_version'] = f'{_sys.version_info.major}.{_sys.version_info.minor}.{_sys.version_info.micro}'
    ctx['debug_mode'] = settings.DEBUG

    return render(request, 'mobile_app/settings.html', ctx)


@require_mobile_client
def search_page(request):
    """Search page — search across all cards in client's tables."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/app/login/')

    query = _sanitize_search_query(request.GET.get('q', ''))
    filter_type = str(request.GET.get('filter', 'all') or 'all').strip().lower()
    if filter_type not in ('all', 'name', 'address', 'mobile'):
        filter_type = 'all'
    raw_table_id = (request.GET.get('table_id') or '').strip()
    table_scope_id = None

    if raw_table_id.isdigit():
        parsed_table_id = int(raw_table_id)
        if parsed_table_id > 0:
            scoped_table = IDCardTable.objects.select_related('group').filter(id=parsed_table_id).first()
            if scoped_table and PermissionService.can_access_client(user, scoped_table.group.client_id):
                if user.role in ('client', 'client_staff'):
                    if ClientAccessService.can_access_table(user, scoped_table):
                        table_scope_id = parsed_table_id
                else:
                    table_scope_id = parsed_table_id

    results = []

    if query and len(query) >= 2:
        # Super admin searches all cards; admin_staff is assignment-scoped.
        if PermissionService.is_super_admin(user):
            base_qs = IDCard.objects.select_related('table', 'table__group', 'table__group__client').order_by('-updated_at')
        elif PermissionService.is_admin_staff(user):
            accessible_ids = _admin_accessible_client_ids(user)
            base_qs = IDCard.objects.filter(
                table__group__client_id__in=accessible_ids,
            ).select_related('table', 'table__group', 'table__group__client').order_by('-updated_at')
        else:
            base_qs = IDCard.objects.filter(
                table__group__client=client,
            ).select_related('table', 'table__group').order_by('-updated_at')

        base_qs = _apply_mobile_search_status_scope(user, base_qs)

        if table_scope_id:
            base_qs = base_qs.filter(table_id=table_scope_id)

        cards_qs = _search_cards_for_global_results(base_qs, query, limit=50, filter_type=filter_type)
        cards_qs = _filter_cards_for_client_staff_row_scope(user, cards_qs)

        for card in cards_qs:
            fd = card.field_data or {}
            name = _card_display_name(card, fd)
            roll_no = fd.get('ROLL NO') or fd.get('ROLL_NO') or fd.get('roll_no') or ''
            photo_url = card.photo.url if card.photo else None
            if not photo_url:
                for val in fd.values():
                    if isinstance(val, str) and ('adarshimg/' in val or val.endswith(('.jpg', '.jpeg', '.png', '.webp'))):
                        photo_url = (settings.MEDIA_URL + val) if not val.startswith(('/','http')) else val
                        break

            results.append({
                'id': card.id,
                'name': name,
                'roll_no': roll_no,
                'status': card.status,
                'table_name': card.table.name,
                'group_name': getattr(card.table.group, 'name', ''),
                'client_name': getattr(getattr(card.table.group, 'client', None), 'name', ''),
                'photo_url': photo_url,
                'table_id': card.table.id,
            })

    return render(request, 'mobile_app/search.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'query': query,
        'filter_type': filter_type,
        'table_scope_id': table_scope_id,
        'results': results,
        'result_count': len(results),
        **perms,
    })


# ---------------------------------------------------------------------------
# NEW API VIEWS
# ---------------------------------------------------------------------------

@require_mobile_client
@require_http_methods(["POST"])
def api_card_delete(request, card_id):
    """Delete a single card (move to pool or permanently delete)."""
    try:
        card = get_object_or_404(IDCard.objects.select_related('table__group'), id=card_id)
        user = request.user
        if not _can_access_card_with_row_scope(user, card):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
        data = json.loads(request.body) if request.body else {}
        permanent = data.get('permanent', False)

        if permanent:
            if not PermissionService.has(user, 'perm_idcard_delete_from_pool'):
                return JsonResponse({'success': False, 'message': 'No permanent delete permission'}, status=403)

            if card.status != 'pool':
                return JsonResponse({
                    'success': False,
                    'message': 'Only cards in pool can be permanently deleted',
                }, status=400)

            card_id_for_log = card.id
            table_id_for_cache = card.table_id
            client_id_for_cache = getattr(getattr(card.table, 'group', None), 'client_id', None)
            table_name = card.table.name if card.table_id else ''
            card.delete()
            try:
                CacheVersionService.bump('mob_filter', int(table_id_for_cache))
                if client_id_for_cache:
                    CacheVersionService.bump('class_section', int(client_id_for_cache))
                CacheVersionService.bump('global_search', 'all')
            except Exception:
                pass
            try:
                suffix = f' in table "{table_name}"' if table_name else ''
                ActivityService.log(
                    'bulk_delete',
                    f'1 card deleted via mobile{suffix}',
                    request=request,
                    target_model='IDCard',
                    target_id=card_id_for_log,
                    target_name=f'Card #{card_id_for_log}',
                )
            except Exception:
                logger.exception('Mobile card-delete activity logging failed')
            return JsonResponse({'success': True, 'message': 'Card permanently deleted'})
        else:
            if not PermissionService.has(user, 'perm_idcard_delete'):
                return JsonResponse({'success': False, 'message': 'No delete permission'}, status=403)

            card.status = 'pool'
            card.save(update_fields=['status'])
            try:
                CacheVersionService.bump('global_search', 'all')
                client_id_for_cache = getattr(getattr(card.table, 'group', None), 'client_id', None)
                if client_id_for_cache:
                    CacheVersionService.bump('client_dash_counts', f'client:{client_id_for_cache}')
            except Exception:
                pass
            return JsonResponse({'success': True, 'message': 'Card moved to pool'})
    except Exception:
        logger.exception('Card delete error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_staff_list(request):
    """List staff for the client.
    
    Authorized for 'client' role and 'admin_staff' with manage permission.
    """
    user = request.user
    
    # Check if user has surface-level permission
    if not _can_manage_client_staff_surface(user):
        return JsonResponse({'success': False, 'message': 'Manage Staff permission required'}, status=403)

    if PermissionService.is_client(user) or PermissionService.is_admin_staff(user):
        # admin_staff managing client staff must be in a client context
        result = ClientStaffService.list_staff(user)
        if result.success:
            return JsonResponse({'success': True, 'data': result.data})
        return JsonResponse({'success': False, 'message': result.message}, status=400)
    
    elif PermissionService.is_super_admin(user):
        # Super admin sees all admin_staff (system-wide)
        staff_data = _list_mobile_admin_staff(limit=200)
        return JsonResponse({'success': True, 'data': {'staff': staff_data}})
        
    return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)


@require_mobile_client
@require_http_methods(["POST"])
def api_staff_create(request):
    """Create a new staff member."""
    user = request.user
    if not _can_manage_client_staff_surface(user):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    if PermissionService.is_super_admin(user):
        payload = dict(data)
        first_name = str(payload.pop('first_name', '') or '').strip()
        last_name = str(payload.pop('last_name', '') or '').strip()
        full_name = f'{first_name} {last_name}'.strip() or str(payload.get('name', '') or '').strip()
        if not full_name:
            return JsonResponse({'success': False, 'message': 'First name is required'}, status=400)
        payload['name'] = full_name
        result = StaffService.create(payload, staff_type='admin_staff', request=request)
    else:
        result = ClientStaffService.create_staff(user, data)

    if result.success:
        return JsonResponse({'success': True, 'message': result.message, **(result.data or {})})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_mobile_client
@require_http_methods(["POST"])
def api_staff_update(request, staff_id):
    """Update a staff member."""
    user = request.user
    if not _can_manage_client_staff_surface(user):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    if PermissionService.is_super_admin(user):
        if not Staff.objects.filter(id=staff_id, staff_type='admin_staff').exists():
            return JsonResponse({'success': False, 'message': 'Staff not found'}, status=404)

        payload = dict(data)
        has_name_parts = ('first_name' in payload) or ('last_name' in payload)
        first_name = str(payload.pop('first_name', '') or '').strip()
        last_name = str(payload.pop('last_name', '') or '').strip()
        if has_name_parts:
            full_name = f'{first_name} {last_name}'.strip()
            if full_name:
                payload['name'] = full_name
            elif not str(payload.get('name', '') or '').strip():
                return JsonResponse({'success': False, 'message': 'First name is required'}, status=400)

        result = StaffService.update(staff_id, payload)
    else:
        result = ClientStaffService.update_staff(user, staff_id, data)

    if result.success:
        return JsonResponse({'success': True, 'message': result.message})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_mobile_client
@require_http_methods(["POST"])
def api_staff_toggle(request, staff_id):
    """Toggle staff active/inactive."""
    user = request.user
    if not _can_manage_client_staff_surface(user):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    if PermissionService.is_client(user) or PermissionService.is_admin_staff(user):
        result = ClientStaffService.toggle_staff_status(user, staff_id)
        if result.success:
            return JsonResponse({'success': True, 'message': result.message, **(result.data or {})})
        return JsonResponse({'success': False, 'message': result.message}, status=400)
    else:
        # Admin toggle — directly update the Staff user's is_active
        try:
            staff = Staff.objects.select_related('user').get(id=staff_id, staff_type='admin_staff')
            staff.user.is_active = not staff.user.is_active
            staff.user.save(update_fields=['is_active'])
            new_state = 'activated' if staff.user.is_active else 'deactivated'
            return JsonResponse({'success': True, 'message': f'{staff.user.get_full_name() or staff.user.username} {new_state}', 'is_active': staff.user.is_active})
        except Staff.DoesNotExist:
            return JsonResponse({'success': False, 'message': 'Staff not found'}, status=404)
        except Exception as exc:
            logger.exception('Admin staff toggle error')
            return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_mobile_client
@require_http_methods(["POST"])
def api_staff_delete(request, staff_id):
    """Delete a staff member."""
    user = request.user
    if not _can_manage_client_staff_surface(user):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    if PermissionService.is_client(user) or PermissionService.is_admin_staff(user):
        # admin_staff can delete client staff if they have permission
        result = ClientStaffService.delete_staff(user, staff_id)
        if result.success:
            return JsonResponse({'success': True, 'message': result.message})
        return JsonResponse({'success': False, 'message': result.message}, status=400)
    else:
        try:
            staff = Staff.objects.select_related('user').get(id=staff_id, staff_type='admin_staff')
            staff_id_for_log = staff.id
            name = staff.user.get_full_name() or staff.user.username
            staff.user.delete()  # cascade deletes staff profile
            try:
                ActivityService.log_staff_delete(request, name, staff_id_for_log)
            except Exception:
                logger.exception('Mobile staff-delete activity logging failed')
            return JsonResponse({'success': True, 'message': f'{name} deleted'})
        except Staff.DoesNotExist:
            return JsonResponse({'success': False, 'message': 'Staff not found'}, status=404)
        except Exception as exc:
            logger.exception('Admin staff delete error')
            return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_staff_assignable_items(request, staff_id):
    """Return groups and tables assignable to a staff member."""
    user = request.user
    if not _can_manage_client_staff_surface(user):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    try:
        staff = get_object_or_404(Staff, id=staff_id)
        # For client staff, we need their client context
        client_id = staff.client_id
        if not client_id:
            # If no client, they might be admin_staff; for now mostly used for client_staff
            return JsonResponse({'success': True, 'groups': [], 'tables': []})

        if not PermissionService.can_access_client(user, client_id):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)

        groups = IDCardGroup.objects.filter(client_id=client_id).values('id', 'name').order_by('name')
        tables = IDCardTable.objects.filter(group__client_id=client_id, is_active=True).values('id', 'name', 'group_id').order_by('group__name', 'name')

        return JsonResponse({
            'success': True,
            'groups': list(groups),
            'tables': list(tables)
        })
    except Exception:
        logger.exception('api_staff_assignable_items error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


@require_mobile_client
@require_http_methods(["POST"])
def api_staff_assign(request, staff_id):
    """Save assignments for a staff member."""
    user = request.user
    if not _can_manage_client_staff_surface(user):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    try:
        data = json.loads(request.body)
        if PermissionService.is_client(user) or PermissionService.is_admin_staff(user):
            # Use update_staff which handles assigned_groups and assigned_table_ids
            result = ClientStaffService.update_staff(user, staff_id, data)
            if result.success:
                return JsonResponse({'success': True, 'message': 'Assignments updated successfully'})
            return JsonResponse({'success': False, 'message': result.message}, status=400)
        elif PermissionService.is_super_admin(user):
            # Super admin managing admin_staff
            result = StaffService.update(staff_id, data)
            if result.success:
                return JsonResponse({'success': True, 'message': 'Assignments updated successfully'})
            return JsonResponse({'success': False, 'message': result.message}, status=400)
            
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)
    except Exception:
        logger.exception('api_staff_assign error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


# ─── Native App JSON APIs (for React Native) ────────────────────────────────

@require_mobile_client
@require_http_methods(["GET"])
def api_profile_data(request):
    """Return current user profile data as JSON for native app."""
    try:
        user = request.user
        client, perms = _client_ctx(user)
        return JsonResponse({
            'success': True,
            'data': {
                'name': user.get_full_name() or user.username,
                'email': user.email or '',
                'phone': getattr(user, 'phone', '') or '',
                'role': getattr(user, 'role', ''),
                'client_id': getattr(client, 'id', None) if client else None,
                'client_name': getattr(client, 'name', '') if client else '',
                'is_super_admin': PermissionService.is_super_admin(user),
                'is_client': PermissionService.is_client(user),
                'is_admin_staff': PermissionService.is_admin_staff(user),
                'can_manage_clients': _can_manage_clients_surface(user),
                'can_manage_staff': _can_manage_client_staff_surface(user),
                'permissions': perms,
            }
        })
    except Exception:
        logger.exception('api_profile_data error')
        return JsonResponse({'success': False, 'message': 'Unable to load profile.'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_notifications_list(request):
    """Return notification list as JSON for native app."""
    try:
        # Use the comprehensive notification helper
        notifs, _ = _get_system_notifications(request.user, limit=50, mark_visible_as_read=True)

        priority_to_color = {
            'low': 'blue',
            'normal': 'purple',
            'high': 'orange',
            'urgent': 'red'
        }

        items = []
        for n in notifs:
            items.append({
                'id': n['id'],
                'title': n['title'] or '',
                'message': n['message'] or '',
                'icon': n['icon_class'] or 'bell',
                'color': priority_to_color.get(n['priority'], 'blue'),
                'read': n['is_read'],
                'time': n['created_at'],
            })
        return JsonResponse({'success': True, 'data': items})
    except Exception:
        logger.exception('api_notifications_list error')
        return JsonResponse({'success': False, 'message': 'Unable to load notifications.'}, status=500)



@require_mobile_client
@require_http_methods(["GET"])
def api_tables_list(request):
    """Return list of accessible tables for mobile picker screen."""
    try:
        user = request.user
        status = (request.GET.get('status') or '').strip().lower()
        
        client, _ = _client_ctx(user)
        if not client:
            return JsonResponse({'success': False, 'message': 'No client context'}, status=400)

        # 1. Get accessible tables
        from idcards.models import IDCardTable
        tables_qs = IDCardTable.objects.filter(group__client=client, is_active=True, deleted_by_client=False)
        
        if PermissionService.is_client_staff(user):
            accessible_ids = ClientAccessService.get_accessible_table_ids(user)
            if accessible_ids is not None:
                tables_qs = tables_qs.filter(id__in=accessible_ids)

        # 2. Annotate with status count if status is provided
        # 'total' is a virtual status from the native app — treat like 'all'
        if status and status not in ('all', 'total'):
            tables_qs = tables_qs.annotate(
                status_count=Count('id_cards', filter=Q(id_cards__status=status))
            ).filter(status_count__gt=0)
        else:
            tables_qs = tables_qs.annotate(status_count=Count('id_cards'))

        items = []
        for t in tables_qs.select_related('group', 'group__client').order_by('name'):
            items.append({
                'id': t.id,
                'name': t.name,
                'group_name': t.group.name if t.group else '',
                'client_name': t.group.client.name if t.group and t.group.client else '',
                'status_count': t.status_count,
            })

        return JsonResponse({'success': True, 'data': items})
    except Exception:
        logger.exception('api_tables_list error')
        return JsonResponse({'success': False, 'message': 'Unable to load tables.'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_groups_list(request):
    """Return groups with tables + status counts as JSON for native groups screen."""
    try:
        user = request.user
        client, _ = _client_ctx(user)
        if not client:
            return JsonResponse({'success': False, 'message': 'No client context'}, status=400)

        # 1. Get accessible tables
        from idcards.models import IDCardTable, IDCardGroup
        tables_qs = IDCardTable.objects.filter(group__client=client, is_active=True, deleted_by_client=False)
        
        if PermissionService.is_client_staff(user):
            accessible_ids = ClientAccessService.get_accessible_table_ids(user)
            if accessible_ids is not None:
                tables_qs = tables_qs.filter(id__in=accessible_ids)

        tables_annotated = list(tables_qs.annotate(
            total_cards=Count('id_cards'),
            pending_cards=Count('id_cards', filter=Q(id_cards__status='pending')),
            verified_cards=Count('id_cards', filter=Q(id_cards__status='verified')),
            approved_cards=Count('id_cards', filter=Q(id_cards__status='approved')),
            download_cards=Count('id_cards', filter=Q(id_cards__status='download')),
            pool_cards=Count('id_cards', filter=Q(id_cards__status='pool')),
            reprint_cards=Count('id_cards', filter=Q(id_cards__status='reprint')),
        ).order_by('name'))

        # 2. Get groups that contain at least one accessible table
        accessible_group_ids = {t.group_id for t in tables_annotated}
        groups = IDCardGroup.objects.filter(id__in=accessible_group_ids).order_by('name')

        groups_data = []
        for g in groups:
            g_tables = [t for t in tables_annotated if t.group_id == g.id]
            groups_data.append({
                'id': g.id,
                'name': g.name,
                'table_count': len(g_tables),
                'total_cards': sum(t.total_cards for t in g_tables),
                'pending_cards': sum(t.pending_cards for t in g_tables),
                'verified_cards': sum(t.verified_cards for t in g_tables),
                'approved_cards': sum(t.approved_cards for t in g_tables),
                'download_cards': sum(t.download_cards for t in g_tables),
                'pool_cards': sum(t.pool_cards for t in g_tables),
                'reprint_cards': sum(t.reprint_cards for t in g_tables),
            })

        tables_data = [{
            'id': t.id,
            'name': t.name,
            'group_id': t.group_id,
            'total_cards': t.total_cards,
            'pending_cards': t.pending_cards,
            'verified_cards': t.verified_cards,
            'approved_cards': t.approved_cards,
            'download_cards': t.download_cards,
            'pool_cards': t.pool_cards,
            'reprint_cards': t.reprint_cards
        } for t in tables_annotated]

        return JsonResponse({'success': True, 'data': {'groups': groups_data, 'tables': tables_data}})
    except Exception:
        logger.exception('api_groups_list error')
        return JsonResponse({'success': False, 'message': 'Unable to load groups.'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_settings_data(request):
    """Return settings page data as JSON for native settings screen."""
    try:
        user = request.user
        client, perms = _client_ctx(user)
        if not client:
            return JsonResponse({'success': False, 'message': 'No client context'}, status=400)

        d = {}
        d['table_count'] = IDCardTable.objects.filter(group__client=client, is_active=True).count()
        d['group_count'] = IDCardGroup.objects.filter(client=client).count()
        d['total_cards'] = IDCard.objects.filter(table__group__client=client).count()

        if PermissionService.is_any_admin(user):
            from client.models import Client as _Client
            accessible_ids = _admin_accessible_client_ids(user)
            _c = _Client.objects.filter(status='active')
            _t = IDCardTable.objects.filter(is_active=True)
            _cd = IDCard.objects.all()
            _st = Staff.objects.all()
            if accessible_ids is not None:
                _c = _c.filter(id__in=accessible_ids)
                _t = _t.filter(group__client_id__in=accessible_ids)
                _cd = _cd.filter(table__group__client_id__in=accessible_ids)
                _st = _st.filter(Q(client_id__in=accessible_ids) | Q(staff_type='admin_staff', assigned_clients__id__in=accessible_ids)).distinct()
            d['admin_client_count'] = _c.count()
            d['admin_staff_count'] = _st.count()
            d['admin_table_count'] = _t.count()
            d['admin_total_cards'] = _cd.count()

        # Recent logs
        from django.utils.timesince import timesince as _timesince
        from django.utils import timezone as _tz
        _now = _tz.now()
        _cards = list(IDCard.objects.filter(table__group__client=client).select_related('table', 'table__group').order_by('-updated_at')[:15])
        d['log_activities'] = [{'name': (c.field_data or {}).get('NAME') or (c.field_data or {}).get('name') or f'Card #{c.id}', 'status': c.status, 'status_display': c.status.replace('_', ' ').title(), 'updated_at': _timesince(c.updated_at, _now) if c.updated_at else '—', 'table_name': c.table.name if c.table else '', 'group_name': c.table.group.name if c.table and c.table.group else ''} for c in _cards]

        # System info
        import django as _dj, sys as _sy, os as _o
        try:
            with open(_o.path.join(settings.BASE_DIR, 'VERSION.txt')) as _vf:
                d['app_version'] = _vf.read().strip()
        except Exception:
            d['app_version'] = str(getattr(settings, 'APP_VERSION', 'v0.00.00') or 'v0.00.00')
        d['django_version'] = _dj.__version__
        d['python_version'] = f'{_sy.version_info.major}.{_sy.version_info.minor}.{_sy.version_info.micro}'
        d['debug_mode'] = settings.DEBUG

        return JsonResponse({'success': True, 'data': d})
    except Exception:
        logger.exception('api_settings_data error')
        return JsonResponse({'success': False, 'message': 'Unable to load settings.'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_dashboard_data(request):
    """Return dashboard status counts as JSON for native home screen.
    
    For admin/operator: Returns clients list with nested tables.
    For client/assistant: Returns single client with tables.
    """
    try:
        user = request.user
        from django.core.cache import cache
        from core.services.cache_version_service import CacheVersionService
        from core.services.activity_service import ActivityService
        from client.models import Client
        
        is_admin = PermissionService.is_super_admin(user) or PermissionService.is_admin_staff(user)
        is_staff = PermissionService.is_client_staff(user)
        
        # Recent Activity (Always included for all roles)
        recent_activity = ActivityService.get_recent(limit=8, user=user)
        
        if is_admin:
            # ADMIN/OPERATOR: Return clients with nested tables
            cache_key = f"mob_dash_admin_{user.id}"
            cached_data = cache.get(cache_key)
            if cached_data:
                cached_data['recent_activity'] = recent_activity
                return JsonResponse({'success': True, 'data': cached_data})
            
            # Get accessible clients
            if PermissionService.is_super_admin(user):
                # Super admins see EVERYTHING (active or not) to match website truth
                clients_qs = Client.objects.all()
            else:  # admin_staff
                accessible_ids = PermissionService.get_accessible_client_ids(user) or []
                clients_qs = Client.objects.filter(id__in=accessible_ids)
            
            # --- Efficient Global Counts ---
            card_qs = IDCard.objects.all()
            if not PermissionService.is_super_admin(user):
                card_qs = card_qs.filter(table__group__client_id__in=accessible_ids)
            
            global_counts_agg = card_qs.aggregate(
                total=Count('id', filter=Q(status__in=['pending', 'verified', 'approved', 'download'])),
                pending=Count('id', filter=Q(status='pending')),
                verified=Count('id', filter=Q(status='verified')),
                approved=Count('id', filter=Q(status='approved')),
                download=Count('id', filter=Q(status='download')),
                pool=Count('id', filter=Q(status='pool')),
            )
            global_counts = {
                'pending': global_counts_agg.get('pending', 0),
                'verified': global_counts_agg.get('verified', 0),
                'approved': global_counts_agg.get('approved', 0),
                'download': global_counts_agg.get('download', 0),
                'pool': global_counts_agg.get('pool', 0),
                'total': global_counts_agg.get('total', 0)
            }
            
            clients_data = []
            
            # Order clients identically to the dashboard: latest approved cards first, then latest created.
            ordered_clients = clients_qs.annotate(
                latest_approved=Max(
                    'id_card_groups__tables__id_cards__updated_at',
                    filter=Q(id_card_groups__tables__id_cards__status='approved')
                )
            ).order_by(
                F('latest_approved').desc(nulls_last=True),
                F('created_at').desc(nulls_last=True),
                F('id').desc(),
            )[:50]
            
            for client in ordered_clients:
                tables_qs = IDCardTable.objects.filter(group__client=client, deleted_by_client=False)
                if not PermissionService.is_super_admin(user):
                    tables_qs = tables_qs.filter(is_active=True)
                
                table_ids = list(tables_qs.values_list('id', flat=True))
                
                client_counts = {'pending': 0, 'verified': 0, 'approved': 0, 'download': 0, 'pool': 0}
                if table_ids:
                    status_agg = IDCard.objects.filter(table_id__in=table_ids).values('status').annotate(n=Count('id'))
                    for row in status_agg:
                        st = row['status']
                        if st in client_counts:
                            client_counts[st] = row['n']
                
                tables_data = []
                # For nested list, only show active tables to keep it clean
                for t in tables_qs.filter(is_active=True)[:10]:
                    tables_data.append({
                        'id': t.id,
                        'name': t.name,
                        'p': IDCard.objects.filter(table=t, status='pending').count(),
                        'v': IDCard.objects.filter(table=t, status='verified').count(),
                    })
                
                clients_data.append({
                    'id': client.id,
                    'name': getattr(client, 'business_name', client.name),
                    'pending': client_counts['pending'],
                    'verified': client_counts['verified'],
                    'approved': client_counts['approved'],
                    'download': client_counts['download'],
                    'pool': client_counts['pool'],
                    'tables': tables_data,
                })
            
            counts = {
                **global_counts,
                'recent_clients': clients_data,
                'recent_activity': recent_activity,
                'is_admin': True
            }
            
            cache.set(cache_key, counts, timeout=600) # shorter timeout for admin
            return JsonResponse({'success': True, 'data': counts})
        
        else:
            # CLIENT/ASSISTANT: Return single client with tables
            client, _ = _client_ctx(user)
            if not client:
                return JsonResponse({'success': False, 'message': 'No client context'}, status=400)
            
            cache_key = f"mob_dash_{client.id}_{user.id}" if is_staff else f"mob_dash_{client.id}"
            cache_version = CacheVersionService.get('client_dash_counts', f'client:{client.id}')
            full_cache_key = f"{cache_key}_v{cache_version}"
            
            cached_data = cache.get(full_cache_key)
            if cached_data:
                cached_data['recent_activity'] = recent_activity
                return JsonResponse({'success': True, 'data': cached_data})
            
            # Get accessible tables
            tables_qs = IDCardTable.objects.filter(group__client=client, is_active=True, deleted_by_client=False)
            if is_staff:
                accessible_ids = ClientAccessService.get_accessible_table_ids(user)
                if accessible_ids is not None:
                    tables_qs = tables_qs.filter(id__in=accessible_ids)
            
            scoped_table_ids = list(tables_qs.values_list('id', flat=True))
            
            # Total Counts
            cards_qs = IDCard.objects.filter(table_id__in=scoped_table_ids)
            counts = {
                'client_id': client.id,
                'client_name': getattr(client, 'business_name', client.name),
                'pending': 0, 'verified': 0, 'approved': 0, 'download': 0, 'pool': 0, 'total': 0
            }
            for row in cards_qs.values('status').annotate(n=Count('id')):
                status_val = row['status']
                if status_val in counts:
                    counts[status_val] = row['n']
            
            # TOTAL definition (match website): Excludes pool
            counts['total'] = counts['pending'] + counts['verified'] + counts['approved'] + counts['download']
            
            # Tables with counts
            tables_data = []
            tables_annotated = tables_qs.annotate(
                cnt_p=Count('id_cards', filter=Q(id_cards__status='pending')),
                cnt_v=Count('id_cards', filter=Q(id_cards__status='verified')),
                cnt_a=Count('id_cards', filter=Q(id_cards__status='approved')),
                cnt_d=Count('id_cards', filter=Q(id_cards__status='download')),
                cnt_po=Count('id_cards', filter=Q(id_cards__status='pool')),
            ).order_by('name')
            
            for t in tables_annotated:
                tables_data.append({
                    'id': t.id,
                    'name': t.name,
                    'p': t.cnt_p,
                    'v': t.cnt_v,
                    'a': t.cnt_a,
                    'd': t.cnt_d,
                    'po': t.cnt_po,
                })
            counts['tables'] = tables_data
            counts['recent_activity'] = recent_activity
            
            # Save to cache
            cache.set(full_cache_key, counts, timeout=3600)
            return JsonResponse({'success': True, 'data': counts})
            
    except Exception:
        logger.exception('api_dashboard_data error')
        return JsonResponse({'success': False, 'message': 'Unable to load dashboard.'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_reprint_data(request, client_id):
    """Return reprint request/confirmed counts per table as JSON."""
    try:
        user = request.user
        if not PermissionService.can_access_client(user, client_id):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)

        tables_qs = IDCardTable.objects.filter(group__client_id=client_id, is_active=True).select_related('group').order_by('group__name', 'name')
        if PermissionService.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_table_ids = _normalize_positive_int_ids(staff.assigned_table_ids or [])
                assigned_group_ids = _staff_assigned_group_ids_for_access(staff)
                if assigned_table_ids and assigned_group_ids:
                    tables_qs = tables_qs.filter(Q(id__in=assigned_table_ids) | Q(group_id__in=assigned_group_ids))
                elif assigned_table_ids:
                    tables_qs = tables_qs.filter(id__in=assigned_table_ids)
                elif assigned_group_ids:
                    tables_qs = tables_qs.filter(group_id__in=assigned_group_ids)

        tables = list(tables_qs)
        table_ids = [t.id for t in tables]

        reprint_map = {}
        if table_ids:
            for row in ReprintRequest.objects.filter(table_id__in=table_ids, status__in=['requested', 'confirmed']).values('table_id', 'status').annotate(n=Count('id')):
                reprint_map.setdefault(row['table_id'], {})[row['status']] = row['n']

        download_map = {}
        if table_ids:
            for row in IDCard.objects.filter(table_id__in=table_ids, status='download').values('table_id').annotate(n=Count('id')):
                download_map[row['table_id']] = row['n']

        request_total = 0
        confirmed_total = 0
        download_total = 0
        items = []
        for t in tables:
            sm = reprint_map.get(t.id, {})
            requested = int(sm.get('requested', 0) or 0)
            confirmed = int(sm.get('confirmed', 0) or 0)
            request_total += requested
            confirmed_total += confirmed
            download_total += int(download_map.get(t.id, 0) or 0)
            items.append({'id': t.id, 'name': t.name, 'group_name': t.group.name, 'requested': requested, 'confirmed': confirmed})

        return JsonResponse({'success': True, 'data': {'tables': items, 'request_total': request_total, 'confirmed_total': confirmed_total, 'download_total': download_total}})
    except Exception:
        logger.exception('api_reprint_data error')
        return JsonResponse({'success': False, 'message': 'Unable to load reprint data.'}, status=500)


@require_mobile_client
@require_http_methods(["POST"])
def api_profile_update(request):
    """Update current user's profile."""
    user = request.user
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    try:
        if 'first_name' in data:
            user.first_name = data['first_name'].strip()
        if 'last_name' in data:
            user.last_name = data['last_name'].strip()
        if 'phone' in data and hasattr(user, 'phone'):
            user.phone = data['phone'].strip()

        # Handle combined name field
        name = data.get('name', '').strip()
        if name and 'first_name' not in data:
            parts = name.split()
            user.first_name = parts[0] if parts else ''
            user.last_name = ' '.join(parts[1:]) if len(parts) > 1 else ''

        user.save()
        return JsonResponse({
            'success': True,
            'message': 'Profile updated successfully',
            'name': user.get_full_name() or user.username,
        })
    except Exception:
        logger.exception('Profile update error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


@require_mobile_client
@require_http_methods(["POST"])
def api_profile_change_password(request):
    """Change current user's password."""
    user = request.user
    try:
        data = json.loads(request.body)
        current_password = data.get('current_password')
        new_password = data.get('new_password')
        
        if not current_password or not new_password:
            return JsonResponse({'success': False, 'message': 'Both current and new passwords are required'}, status=400)
            
        if not user.check_password(current_password):
            return JsonResponse({'success': False, 'message': 'Current password is incorrect'}, status=400)
            
        user.set_password(new_password)
        user.save()
        
        # Update session to prevent logout
        from django.contrib.auth import update_session_auth_hash
        update_session_auth_hash(request, user)
        
        return JsonResponse({'success': True, 'message': 'Password updated successfully'})
    except Exception:
        logger.exception('Password change error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


@require_mobile_client
@require_http_methods(["POST"])
def api_profile_delete_request(request):
    """Submit a data deletion request for the current user.

    Google Play Store requires apps that collect user data to provide a visible
    mechanism for requesting data deletion. This endpoint records the request
    and notifies the admin team.
    """
    user = request.user
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        data = {}

    if not data.get('confirm'):
        return JsonResponse({
            'success': False,
            'message': 'Please confirm your deletion request.',
        }, status=400)

    user_email = getattr(user, 'email', '') or ''
    user_name = user.get_full_name() or getattr(user, 'username', '')
    user_role = getattr(user, 'role', 'unknown')

    # Log the request for audit trail
    logger.info(
        'Data deletion requested — user_id=%s name=%s email=%s role=%s',
        user.pk, user_name, user_email, user_role,
    )

    # Record activity if the service is available
    try:
        ActivityService.log(
            'other',
            f'User {user_name} ({user_email}) requested account and data deletion via mobile app.',
            user=user,
        )
    except Exception:
        pass  # Activity logging is best-effort

    # Send notification email to admin
    admin_email = getattr(settings, 'DEFAULT_FROM_EMAIL', '') or getattr(settings, 'ADMIN_EMAIL', '')
    if admin_email:
        try:
            from django.core.mail import send_mail as _send_mail
            _send_mail(
                subject=f'[Adarsh Admin] Data Deletion Request — {user_name}',
                message=(
                    f'A data deletion request has been submitted.\n\n'
                    f'User ID: {user.pk}\n'
                    f'Name: {user_name}\n'
                    f'Email: {user_email}\n'
                    f'Role: {user_role}\n\n'
                    f'Please process this request within 7 business days per our privacy policy.'
                ),
                from_email=admin_email,
                recipient_list=[admin_email],
                fail_silently=True,
            )
        except Exception:
            logger.warning('Failed to send data deletion notification email for user_id=%s', user.pk)

    return JsonResponse({
        'success': True,
        'message': 'Your data deletion request has been submitted. An administrator will process it within 7 business days.',
    })


@require_mobile_client
@require_http_methods(["GET"])
def api_search(request):
    """Global search API across all client cards."""
    user = request.user
    client, _ = _client_ctx(user)
    if not client:
        return JsonResponse({'success': False, 'message': 'No client'}, status=400)

    query = _sanitize_search_query(request.GET.get('q', ''))
    filter_type = str(request.GET.get('filter', 'all') or 'all').strip().lower()
    if filter_type not in ('all', 'name', 'address', 'mobile'):
        return JsonResponse({'success': False, 'message': 'Invalid search filter.'}, status=400)
    raw_table_id = (request.GET.get('table_id') or '').strip()
    if not query or len(query) < 2:
        return JsonResponse({'success': True, 'data': {'results': [], 'count': 0}})

    # Super admin searches all cards; admin_staff is assignment-scoped.
    if PermissionService.is_super_admin(user):
        base_qs = IDCard.objects.select_related(
            'table', 'table__group', 'table__group__client'
        ).order_by('-updated_at')
    elif PermissionService.is_admin_staff(user):
        accessible_ids = _admin_accessible_client_ids(user)
        base_qs = IDCard.objects.filter(
            table__group__client_id__in=accessible_ids,
        ).select_related('table', 'table__group', 'table__group__client').order_by('-updated_at')
    else:
        base_qs = IDCard.objects.filter(
            table__group__client=client,
        ).select_related('table', 'table__group').order_by('-updated_at')

    base_qs = _apply_mobile_search_status_scope(user, base_qs)

    if raw_table_id:
        if not raw_table_id.isdigit():
            return JsonResponse({'success': False, 'message': 'Invalid table scope.'}, status=400)

        scoped_table_id = int(raw_table_id)
        if scoped_table_id <= 0:
            return JsonResponse({'success': False, 'message': 'Invalid table scope.'}, status=400)

        scoped_table = IDCardTable.objects.select_related('group').filter(id=scoped_table_id).first()
        if not scoped_table:
            return JsonResponse({'success': False, 'message': 'Table not found.'}, status=404)

        if not PermissionService.can_access_client(user, scoped_table.group.client_id):
            return JsonResponse({'success': False, 'message': 'Access denied.'}, status=403)

        if user.role in ('client', 'client_staff') and not ClientAccessService.can_access_table(user, scoped_table):
            return JsonResponse({'success': False, 'message': 'Access denied.'}, status=403)

        base_qs = base_qs.filter(table_id=scoped_table_id)

    cards_qs = _search_cards_for_global_results(base_qs, query, limit=30, filter_type=filter_type)
    cards_qs = _filter_cards_for_client_staff_row_scope(user, cards_qs)

    results = []
    for card in cards_qs:
        fd = card.field_data or {}
        name = _card_display_name(card, fd)
        roll_no = fd.get('ROLL NO') or fd.get('ROLL_NO') or fd.get('roll_no') or ''
        photo_url = get_card_photo_url(card, fd)
        results.append({
            'id': card.id,
            'name': name,
            'roll_no': roll_no,
            'status': card.status,
            'table_name': card.table.name,
            'group_name': getattr(card.table.group, 'name', ''),
            'client_name': getattr(getattr(card.table.group, 'client', None), 'name', ''),
            'photo_url': photo_url,
            'table_id': card.table.id,
        })

    return JsonResponse({'success': True, 'data': {'results': results, 'count': len(results)}})


@require_mobile_client
@require_http_methods(["GET"])
def api_mobile_shell_config(request):
    """Returns Android shell policy (version/update/support URLs) for runtime checks."""
    app_build = _mobile_shell_safe_int(request.GET.get('app_build'), 0)
    payload = _mobile_shell_app_config_payload(app_build=app_build, request=request)
    return JsonResponse({'success': True, 'data': payload})


@require_mobile_client
@require_http_methods(["POST"])
def api_mobile_shell_device_register(request):
    """Upserts Android shell device metadata and optional push token."""
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)

    installation_id = str(data.get('installation_id') or '').strip()
    if not MOBILE_INSTALLATION_ID_RE.match(installation_id):
        return JsonResponse({'success': False, 'message': 'Valid installation_id is required.'}, status=400)

    platform_name = str(data.get('platform') or 'android').strip().lower() or 'android'
    if platform_name != 'android':
        return JsonResponse({'success': False, 'message': 'Only android platform is supported in current rollout.'}, status=400)

    app_build = max(0, _mobile_shell_safe_int(data.get('app_build'), 0))
    app_version = str(data.get('app_version') or '').strip()[:32]
    push_token = str(data.get('push_token') or '').strip()[:255]
    device_model = str(data.get('device_model') or '').strip()[:120]
    os_version = str(data.get('os_version') or '').strip()[:50]
    device_language = str(data.get('device_language') or '').strip()[:32]

    defaults = {
        'push_token': push_token,
        'app_build': app_build,
        'app_version': app_version,
        'device_model': device_model,
        'os_version': os_version,
        'device_language': device_language,
        'last_ip': _get_client_ip(request),
        'is_active': True,
    }

    device_obj, _ = MobileDevice.objects.update_or_create(
        user=request.user,
        platform='android',
        installation_id=installation_id,
        defaults=defaults,
    )

    # Invalidate dashboard cache on app update to ensure fresh stats on next load
    # This prevents stale zero-stats after app reload
    try:
        from core.services.cache_version_service import CacheVersionService
        from client.services_access import ClientAccessService
        
        client = ClientAccessService.get_client_for_user(request.user)
        if client:
            CacheVersionService.bump('client_dash_counts', f'client:{client.id}')
            CacheVersionService.bump('client_staff', f'client:{client.id}')
    except Exception as exc:
        logger.debug('Failed to invalidate dashboard cache after device registration: %s', exc)

    config_payload = _mobile_shell_app_config_payload(app_build=app_build, request=request)
    return JsonResponse({
        'success': True,
        'data': {
            'device_id': device_obj.id,
            'device_signature': _mobile_shell_device_payload_hash(
                installation_id=installation_id,
                app_build=app_build,
                app_version=app_version,
            ),
            'config': config_payload,
        },
    })


@require_mobile_client
@require_http_methods(["POST"])
def api_mobile_shell_device_ping(request):
    """Heartbeat endpoint to keep mobile device records active and up to date."""
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)

    installation_id = str(data.get('installation_id') or '').strip()
    if not MOBILE_INSTALLATION_ID_RE.match(installation_id):
        return JsonResponse({'success': False, 'message': 'Valid installation_id is required.'}, status=400)

    app_build = max(0, _mobile_shell_safe_int(data.get('app_build'), 0))
    app_version = str(data.get('app_version') or '').strip()[:32]

    updated = MobileDevice.objects.filter(
        user=request.user,
        platform='android',
        installation_id=installation_id,
    ).update(
        app_build=app_build,
        app_version=app_version,
        last_ip=_get_client_ip(request),
        is_active=True,
    )

    if not updated:
        MobileDevice.objects.create(
            user=request.user,
            platform='android',
            installation_id=installation_id,
            app_build=app_build,
            app_version=app_version,
            last_ip=_get_client_ip(request),
            is_active=True,
        )

    # Invalidate dashboard cache if app build/version changed
    # This ensures fresh stats on next dashboard load after app updates
    try:
        from core.services.cache_version_service import CacheVersionService
        from client.services_access import ClientAccessService
        
        # Only invalidate if this is a new app version/build (to avoid excessive cache busting)
        old_device = MobileDevice.objects.filter(
            user=request.user,
            platform='android',
            installation_id=installation_id,
        ).first()
        if old_device and (old_device.app_build != app_build or old_device.app_version != app_version):
            client = ClientAccessService.get_client_for_user(request.user)
            if client:
                CacheVersionService.bump('client_dash_counts', f'client:{client.id}')
                CacheVersionService.bump('client_staff', f'client:{client.id}')
    except Exception as exc:
        logger.debug('Failed to invalidate dashboard cache after device ping: %s', exc)

    config_payload = _mobile_shell_app_config_payload(app_build=app_build, request=request)
    return JsonResponse({'success': True, 'data': {'config': config_payload}})


@require_mobile_client
@require_http_methods(["GET"])
def api_mobile_shell_device_summary(request):
    """Rollout monitoring snapshot for shell devices (super/pro admin only)."""
    if not (PermissionService.is_super_admin(request.user) or PermissionService.is_pro_user(request.user)):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)

    include_inactive = _mobile_shell_safe_bool(request.GET.get('include_inactive'), False)
    now = timezone.now()
    base_qs = MobileDevice.objects.filter(platform='android')
    if not include_inactive:
        base_qs = base_qs.filter(is_active=True)

    summary = {
        'total_devices': base_qs.count(),
        'active_24h': base_qs.filter(last_seen_at__gte=now - timedelta(hours=24)).count(),
        'active_7d': base_qs.filter(last_seen_at__gte=now - timedelta(days=7)).count(),
        'stale_30d': base_qs.filter(last_seen_at__lt=now - timedelta(days=30)).count(),
        'last_seen_at': base_qs.aggregate(last_seen=Max('last_seen_at')).get('last_seen'),
        'top_builds': list(
            base_qs.exclude(app_build__lte=0)
            .values('app_build', 'app_version')
            .annotate(total=Count('id'))
            .order_by('-app_build', '-total')[:5]
        ),
    }
    return JsonResponse({'success': True, 'data': summary})


@require_mobile_client
@require_http_methods(["GET"])
def api_server_info(request):
    """Return lightweight server diagnostics for super/pro users only."""
    user = request.user
    if not PermissionService.is_super_admin(user):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)

    import os
    import platform
    import socket
    process_uptime_seconds = max(0, int(time.time() - APP_BOOT_TS))

    # Disk usage info
    try:
        import shutil
        total, used, free = shutil.disk_usage(os.getcwd())
        disk = {
            'total': total,
            'used': used,
            'free': free,
            'percent': round(used / total * 100, 1) if total else None,
        }
    except Exception as e:
        disk = None

    data = {
        'hostname': socket.gethostname(),
        'platform': platform.platform(),
        'python_version': platform.python_version(),
        'django_version': __import__('django').get_version(),
        'environment': 'Development' if settings.DEBUG else 'Production',
        'process_id': os.getpid(),
        'cwd': os.getcwd(),
        'process_uptime_seconds': process_uptime_seconds,
        'disk': disk,
    }
    return JsonResponse({'success': True, 'data': data})


@require_mobile_client
@require_http_methods(["GET"])
def api_impersonate_users(request):
    """Return pro-user impersonation targets filtered to mobile-eligible users."""
    from accounts.services_impersonate import ImpersonateService
    from django.contrib.auth import get_user_model

    if not ImpersonateService.can_impersonate(request.user):
        return JsonResponse({'success': False, 'message': 'Permission denied.'}, status=403)

    users = ImpersonateService.get_impersonation_targets(request)
    if not users:
        return JsonResponse({'success': True, 'users': []})

    user_ids = [int(item.get('id')) for item in users if str(item.get('id', '')).isdigit()]
    
    # Super Admins and Admin Staff should see ALL clients, regardless of mobile perm.
    # Pro Users (Clients) trying to impersonate their own staff might need filtering, but 
    # ImpersonateService.get_impersonation_targets already filters valid targets.
    # To maintain desktop parity, we remove the strict `perm_mobile_app` restriction.
    mobile_allowed_ids = set(user_ids)

    filtered = []
    for item in users:
        try:
            item_id = int(item.get('id') or 0)
        except (TypeError, ValueError):
            continue
        if item_id in mobile_allowed_ids:
            filtered.append(item)
    return JsonResponse({'success': True, 'users': filtered})


@require_mobile_client
@require_http_methods(["POST"])
def api_impersonate_start(request):
    """Start impersonation from mobile and keep the session on the mobile surface."""
    from accounts.services_impersonate import ImpersonateService
    from django.contrib.auth import get_user_model

    if not ImpersonateService.can_impersonate(request.user):
        return JsonResponse({'success': False, 'message': 'Permission denied.'}, status=403)

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)

    raw_user_id = payload.get('user_id')
    try:
        target_user_id = int(raw_user_id)
    except (TypeError, ValueError):
        return JsonResponse({'success': False, 'message': 'user_id is required'}, status=400)

    UserModel = get_user_model()
    target = UserModel.objects.filter(pk=target_user_id).first()
    if not target:
        return JsonResponse({'success': False, 'message': 'User not found.'}, status=404)

    valid_mobile_roles = {'pro_user', 'super_admin', 'admin_staff', 'client', 'client_staff'}
    if getattr(target, 'role', '') not in valid_mobile_roles:
        return JsonResponse({'success': False, 'message': 'Target user cannot access the mobile app.'}, status=400)

    if not PermissionService.has(target, 'perm_mobile_app'):
        return JsonResponse({'success': False, 'message': 'Target user has no mobile app access.'}, status=400)

    result = ImpersonateService.start(request, target_user_id)
    if not result.get('success'):
        return JsonResponse(result, status=403)

    request.session['mobile_auth_ok'] = True
    request.session['_auth_login_surface'] = 'mobile'
    request.session['_auth_browser_fp'] = AuthService.browser_fingerprint_from_request(request)
    request.session['selected_role'] = getattr(target, 'role', '')
    result['redirect_url'] = '/app/'
    return JsonResponse(result)


@require_mobile_client
@require_http_methods(["POST"])
def api_impersonate_stop(request):
    """Stop impersonation from mobile and return to pro user on mobile surface."""
    from accounts.services_impersonate import ImpersonateService

    next_url = ''
    try:
        data = json.loads(request.body)
        next_url = str(data.get('next', '') or '').strip()
    except (json.JSONDecodeError, TypeError):
        pass

    result = ImpersonateService.stop(request, next_url=next_url)
    if not result.get('success'):
        return JsonResponse(result, status=400)

    request.session['mobile_auth_ok'] = True
    request.session['_auth_login_surface'] = 'mobile'
    request.session['_auth_browser_fp'] = AuthService.browser_fingerprint_from_request(request)
    request.session['selected_role'] = getattr(request.user, 'role', '')
    # Only override to /app/ if we didn't get a specific next_url via stop()
    if not result.get('redirect_url') or result['redirect_url'] == '/panel/':
        result['redirect_url'] = '/app/'
    return JsonResponse(result)


# ─── Client Management APIs ────────────────────────────────────────────────────

@require_mobile_client
@require_http_methods(['POST'])
def api_client_toggle(request, client_id):
    """Toggle a client between active / inactive."""
    from client.models import Client
    if not PermissionService.is_any_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Admin access required'}, status=403)
    if not _can_manage_clients_surface(request.user):
        return JsonResponse({'success': False, 'message': 'Manage Client permission required'}, status=403)
    if PermissionService.is_admin_staff(request.user) and not PermissionService.can_access_client(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
    try:
        client = get_object_or_404(Client, id=client_id)
        if client.status == 'active':
            client.status = 'inactive'
            label = 'deactivated'
        else:
            client.status = 'active'
            label = 'activated'
        client.save(update_fields=['status'])
        return JsonResponse({'success': True, 'message': f'{client.name} {label}', 'new_status': client.status})
    except Exception as exc:
        logger.exception('api_client_toggle error: %s', exc)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_mobile_client
@require_http_methods(['POST'])
def api_client_delete(request, client_id):
    """Permanently delete a client (super_admin only)."""
    from client.models import Client
    if not PermissionService.is_super_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Only super admin can delete clients'}, status=403)
    try:
        client = get_object_or_404(Client, id=client_id)
        client_name = client.name
        result = ClientService.delete(client_id)
        if result.success:
            try:
                ActivityService.log_client_delete(request, client_name, client_id)
            except Exception:
                logger.exception('Mobile client-delete activity logging failed')
        return JsonResponse(
            {'success': result.success, 'message': result.message},
            status=200 if result.success else 400,
        )
    except Exception as exc:
        logger.exception('api_client_delete error: %s', exc)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_client_tables(request, client_id):
    """Return active tables with pending/verified counts for a client (admin only, lazy-loaded)."""
    if not PermissionService.is_any_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
    if not PermissionService.can_access_client(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
    from client.models import Client
    get_object_or_404(Client, id=client_id)
    tables_qs = (
        IDCardTable.objects
        .filter(group__client_id=client_id, is_active=True)
        .select_related('group')
        .annotate(
            pending_count=Count('id_cards', filter=Q(id_cards__status='pending')),
            verified_count=Count('id_cards', filter=Q(id_cards__status='verified')),
            approved_count=Count('id_cards', filter=Q(id_cards__status='approved')),
            download_count=Count('id_cards', filter=Q(id_cards__status='download')),
            pool_count=Count('id_cards', filter=Q(id_cards__status='pool')),
        )
        .order_by('group__name', 'name')
    )
    tables = [
        {
            'id': t.id,
            'name': t.name,
            'group_name': t.group.name,
            'pending_count': t.pending_count,
            'verified_count': t.verified_count,
            'approved_count': t.approved_count,
            'download_count': t.download_count,
            'pool_count': t.pool_count,
            'total_cards': t.pending_count + t.verified_count + t.approved_count + t.download_count + t.pool_count
        }
        for t in tables_qs
    ]
    return JsonResponse({'success': True, 'tables': tables})


@require_mobile_client
@require_http_methods(['GET'])
def api_client_detail(request, client_id):
    """Fetch client details for edit form (super_admin/pro_user or scoped admin_staff manager)."""
    if not PermissionService.is_any_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Admin access required'}, status=403)
    if not _can_manage_clients_surface(request.user):
        return JsonResponse({'success': False, 'message': 'Manage Client permission required'}, status=403)
    if PermissionService.is_admin_staff(request.user) and not PermissionService.can_access_client(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)

    result = ClientService.get(client_id, include_permissions=True)
    if not result.success:
        return JsonResponse({'success': False, 'message': result.message or 'Client not found'}, status=404)
    return JsonResponse({'success': True, 'client': result.data.get('client', {})})


@require_mobile_client
@require_http_methods(['POST'])
def api_client_create(request):
    """Create a client from mobile app for users with Manage Client access."""
    if not PermissionService.is_any_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Admin access required'}, status=403)
    if not _can_manage_clients_surface(request.user):
        return JsonResponse({'success': False, 'message': 'Manage Client permission required'}, status=403)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    # Inject default Power User permissions for mobile-created clients
    default_perms = {
        'perm_mobile_app': True,
        'perm_idcard_info': True,
        'perm_idcard_verify': True,
        'perm_idcard_approve': True,
        'perm_website_view': True,
        'perm_idcard_client_list': True,
        'perm_idcard_pending_list': True,
        'perm_idcard_verified_list': True,
        'perm_idcard_pool_list': True,
        'perm_idcard_approved_list': True,
    }
    for perm_key, perm_val in default_perms.items():
        if perm_key not in data:
            data[perm_key] = perm_val

    result = ClientService.create(data, request=request)
    if not result.success:
        return JsonResponse({'success': False, 'message': result.message or 'Failed to create client'}, status=400)

    if PermissionService.is_admin_staff(request.user):
        try:
            created_client_id = ((result.data or {}).get('client') or {}).get('id')
            if created_client_id:
                from client.models import Client
                created_client = Client.objects.filter(id=created_client_id).first()
                staff = getattr(request.user, 'staff_profile', None)
                if created_client and staff:
                    staff.assigned_clients.add(created_client)
        except Exception:
            logger.warning('Could not auto-assign newly created client to admin_staff user=%s', request.user.pk)

    client_payload = result.data.get('client', {}) if result.data else {}
    return JsonResponse({
        'success': True,
        'message': result.message or 'Client created successfully',
        'client': client_payload,
    })


@require_mobile_client
@require_http_methods(['POST'])
def api_client_update(request, client_id):
    """Update a client from mobile app for users with Manage Client access."""
    if not PermissionService.is_any_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Admin access required'}, status=403)
    if not _can_manage_clients_surface(request.user):
        return JsonResponse({'success': False, 'message': 'Manage Client permission required'}, status=403)
    if PermissionService.is_admin_staff(request.user) and not PermissionService.can_access_client(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    result = ClientService.update(client_id, data)
    if not result.success:
        return JsonResponse({'success': False, 'message': result.message or 'Failed to update client'}, status=400)

    client_payload = result.data.get('client', {}) if result.data else {}
    return JsonResponse({
        'success': True,
        'message': result.message or 'Client updated successfully',
        'client': client_payload,
    })


# ---------------------------------------------------------------------------
# WEBSITE MANAGEMENT (Portfolio Media — mobile upload)
# ---------------------------------------------------------------------------

@require_mobile_client
def website_manage(request):
    """Mobile website management page: portfolio categories + unified media upload."""
    user = request.user
    if not PermissionService.has(user, 'perm_website_view'):
        return render(request, 'mobile_app/no_access.html', {
            'user_name': user.get_full_name() or user.username,
        }, status=403)

    from website.models import PortfolioCategory

    # Fetch only the fields needed for JSON serialisation — no full ORM hydration
    from django.core.cache import cache
    if not cache.get('portfolio_defaults_ensured'):
        PortfolioCategory.ensure_defaults()
        cache.set('portfolio_defaults_ensured', True, 3600)

    bento_rank_case = Case(
        *[When(slug=slug, then=Value(idx)) for idx, slug in enumerate(MOBILE_PUBLIC_BENTO_ORDER)],
        default=Value(len(MOBILE_PUBLIC_BENTO_ORDER)),
        output_field=IntegerField(),
    )

    categories = (
        PortfolioCategory.objects
        .filter(is_active=True)
        .annotate(photo_count=Count('items', filter=Q(items__is_active=True)))
        .annotate(
            mobile_public_bento=Case(
                When(slug__in=MOBILE_PUBLIC_BENTO_EXCLUDE_SLUGS, then=Value(0)),
                When(slug__in=MOBILE_PUBLIC_BENTO_INCLUDE_SLUGS, then=Value(1)),
                When(is_bento=True, then=Value(1)),
                default=Value(0),
                output_field=IntegerField(),
            ),
            mobile_bento_rank=bento_rank_case,
        )
        .order_by('-mobile_public_bento', 'mobile_bento_rank', 'order', 'name')
        .only('id', 'name', 'icon', 'order', 'slug')
    )

    # Skip the client lookup — website_manage doesn’t need a client object
    perms = PermissionService.get_permission_context(user)

    categories_data = [
        {
            'id': c.id,
            'name': c.name,
            'icon': c.icon,
            'count': c.photo_count,
            'is_public_bento': bool(getattr(c, 'mobile_public_bento', 0)),
        }
        for c in categories
    ]

    return render(request, 'mobile_app/website_manage.html', {
        'user_name': user.get_full_name() or user.username,
        'categories_json': categories_data,
        **perms,
    })


@require_mobile_client
@require_http_methods(["POST"])
def api_client_update_permissions(request, client_user_id):
    """Admin-only: Update permissions for a specific client account."""
    user = request.user
    if not PermissionService.is_super_admin(user) and not PermissionService.is_admin_staff(user):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    try:
        from core.models import User
        client_user = get_object_or_404(User, id=client_user_id)
        profile = getattr(client_user, 'client_profile', None)
        if not profile:
            return JsonResponse({'success': False, 'message': 'Client profile not found'}, status=404)

        data = json.loads(request.body)
        updates = data.get('permissions', {})
        
        # Whitelist of permissions that can be toggled via mobile
        ALLOWED_TOGGLES = {
            'perm_idcard_info', 'perm_idcard_verify', 'perm_idcard_approve', 
            'perm_idcard_download', 'perm_website_view'
        }

        for key, value in updates.items():
            if key in ALLOWED_TOGGLES and hasattr(profile, key):
                setattr(profile, key, bool(value))
        
        profile.save()
        
        # Invalidate permission cache for this user
        cache_key = PermissionService._permission_context_cache_key(client_user)
        from django.core.cache import cache
        cache.delete(cache_key)

        return JsonResponse({'success': True, 'message': 'Permissions updated'})
    except Exception:
        logger.exception('api_client_update_permissions error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_client_permissions(request, client_user_id):
    """Admin-only: Get current permissions for a specific client account."""
    user = request.user
    if not PermissionService.is_super_admin(user) and not PermissionService.is_admin_staff(user):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    from core.models import User
    client_user = get_object_or_404(User, id=client_user_id)
    perms = PermissionService.get_permission_context(client_user)
    return JsonResponse({'success': True, 'data': perms.get('user_permissions', {})})
@require_mobile_client
@require_http_methods(['POST'])
def api_portfolio_upload(request):
    """Upload one or more media files (images/videos) into a portfolio category from mobile."""
    user = request.user
    # perm_website_edit required — view-only users must not be able to write content
    if not PermissionService.has(user, 'perm_website_edit'):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    from website.models import PortfolioCategory
    from website.services import PortfolioItemService
    from django.core.exceptions import ValidationError

    category_id = request.POST.get('category_id')
    files = request.FILES.getlist('files') or request.FILES.getlist('images')

    if not category_id:
        return JsonResponse({'success': False, 'message': 'category_id required'}, status=400)
    if not files:
        return JsonResponse({'success': False, 'message': 'No files provided'}, status=400)
    if len(files) > 20:
        return JsonResponse({'success': False, 'message': 'Maximum 20 files per upload'}, status=400)

    def _is_video_file(upload):
        content_type = (getattr(upload, 'content_type', '') or '').lower()
        if content_type.startswith('video/'):
            return True
        name = (getattr(upload, 'name', '') or '').lower()
        return name.endswith(('.mp4', '.webm', '.mov', '.avi'))

    try:
        get_object_or_404(PortfolioCategory, id=category_id, is_active=True)
        created = []
        failed = []
        for f in files:
            try:
                is_video = _is_video_file(f)
                media_type = 'reel' if is_video else 'image'
                item = PortfolioItemService.create(
                    category_id=category_id,
                    image=None if is_video else f,
                    video_file=f if is_video else None,
                    item_type=media_type,
                    is_active=True,
                )
                created.append(item.id)
            except ValidationError as e:
                failed.append(str(e))
            except Exception:
                logger.exception('Portfolio upload failed for a single file')
                failed.append('Internal error')

        return JsonResponse({
            'success': True,
            'created_count': len(created),
            'failed_count': len(failed),
            'errors': failed if failed else None
        })
    except Exception:
        logger.exception('api_portfolio_upload general error')
        return JsonResponse({'success': False, 'message': 'An error occurred during upload'}, status=500)




@require_mobile_client
@require_http_methods(['GET'])
def api_portfolio_category_items(request, category_id):
    """List recent uploaded portfolio media for a category (preview in mobile website manager)."""
    user = request.user
    if not PermissionService.has(user, 'perm_website_view'):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    from website.models import PortfolioCategory, PortfolioItem

