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
from urllib.parse import urlencode
from functools import wraps

from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.conf import settings
from django.core.cache import cache
from django.contrib.auth import login as auth_login
from django.contrib.auth import logout as auth_logout
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from django.db import transaction
from django.db.models import Count, Q, Max, CharField
from django.db.models.functions import Cast
from django.db.models.fields.json import KeyTextTransform

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
from accounts.services import AuthService
from core.services.activity_service import ActivityService
from mediafiles.utils import normalize_uploaded_image

logger = logging.getLogger(__name__)
APP_BOOT_TS = time.time()
MAX_SEARCH_QUERY_LEN = 100
MAX_REPRINT_ACTION_IDS = 200


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def is_mobile(request):
    """Check if request comes from a mobile device."""
    ua = request.META.get('HTTP_USER_AGENT', '')
    return bool(re.search(
        r'Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini',
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
        if not is_mobile(request):
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
        from core.models import Notification, NotificationRead
        from django.db.models import Q as _Q
        role = getattr(user, 'role', 'all')
        active_ids = list(
            Notification.objects
            .filter(_Q(target='all') | _Q(target=role) | _Q(target='selected', target_users=user), is_active=True)
            .values_list('id', flat=True)
        )
        if not active_ids:
            return 0
        read_ids = set(
            NotificationRead.objects
            .filter(user=user, notification_id__in=active_ids)
            .values_list('notification_id', flat=True)
        )
        return min(len(set(active_ids) - read_ids), 99)
    except Exception:
        return 0


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
    else:
        result = []

    setattr(user, _cache_attr, result)
    return result


def _search_cards_queryset(base_qs, query, limit=None):
    """Apply performant card search over common JSON keys plus a few spaced-key annotations."""
    if not query or len(query) < 2:
        return base_qs.none()

    search_q = (
        Q(field_data__NAME__icontains=query) |
        Q(field_data__name__icontains=query) |
        Q(field_data__Name__icontains=query) |
        Q(field_data__ID__icontains=query) |
        Q(field_data__id__icontains=query) |
        Q(field_data__ID_NUMBER__icontains=query) |
        Q(field_data__id_number__icontains=query) |
        Q(field_data__ROLL_NO__icontains=query) |
        Q(field_data__roll_no__icontains=query) |
        Q(field_data__CLASS__icontains=query) |
        Q(field_data__class__icontains=query) |
        Q(field_data__SECTION__icontains=query) |
        Q(field_data__section__icontains=query) |
        Q(field_data__FATHER_NAME__icontains=query) |
        Q(field_data__MOTHER_NAME__icontains=query) |
        Q(field_data__CONTACT__icontains=query) |
        Q(field_data__PHONE__icontains=query)
    )
    if query.isdigit():
        search_q |= Q(id=int(query))

    qs = base_qs.annotate(
        _roll_no_sp=Cast(KeyTextTransform('ROLL NO', 'field_data'), CharField()),
        _father_name_sp=Cast(KeyTextTransform('FATHER NAME', 'field_data'), CharField()),
        _mother_name_sp=Cast(KeyTextTransform('MOTHER NAME', 'field_data'), CharField()),
    ).filter(
        search_q |
        Q(_roll_no_sp__icontains=query) |
        Q(_father_name_sp__icontains=query) |
        Q(_mother_name_sp__icontains=query)
    )

    if limit is not None:
        return qs[:limit]
    return qs


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


def _staff_can_access_table(staff, table):
    """Allow access if table is assigned directly or via assigned group."""
    assigned_table_ids = set(_normalize_positive_int_ids(getattr(staff, 'assigned_table_ids', None) or []))
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
    """Build and cache class/section filter metadata for list page."""
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
    _stamp = options_qs.aggregate(total=Count('id'), max_id=Max('id'))
    cache_key = f"mob_filter_meta:v2:{table.id}:{_stamp.get('total') or 0}:{_stamp.get('max_id') or 0}"
    cached = cache.get(cache_key)
    if cached:
        return cached

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
    cache.set(cache_key, payload, 300)
    return payload


# ── Image upload validation ──────────────────────────────────────────────────
_ALLOWED_IMAGE_TYPES = frozenset({
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
})
_ALLOWED_IMAGE_EXTS  = frozenset({'.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.hei'})
_MAX_IMAGE_SIZE = 15 * 1024 * 1024  # 15 MB

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
            return redirect('/app/')
    return render(request, 'mobile_app/login.html')


@ensure_csrf_cookie
def mobile_no_access(request):
    """Show explicit mobile permission-required page."""
    user = request.user if request.user.is_authenticated else None
    return render(request, 'mobile_app/no_access.html', {
        'user_name': (user.get_full_name() or user.username) if user else '',
    }, status=403)


@require_mobile_client
def desktop_required(request):
    """Inform users that this action/list is only available on desktop panel."""
    status = (request.GET.get('status') or '').strip().lower()
    return render(request, 'mobile_app/desktop_required.html', {
        'status': status,
        'status_display': status.replace('_', ' ').title() if status else 'This List',
    })


@require_http_methods(["POST"])
@rate_limit(max_requests=6, window_seconds=60, key_prefix='mob_login')
def api_mobile_login(request):
    """Mobile-only login: authenticate + enforce perm_mobile_app before session login."""
    identifier = None
    try:
        data = json.loads(request.body or '{}')
        identifier = (data.get('email') or '').strip()
        password = data.get('password', '')
        role = data.get('role')

        if not identifier or not password:
            return JsonResponse({'success': False, 'message': 'Email and password are required.'}, status=400)

        result = AuthService.authenticate_user(identifier, password, role)
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

        auth_login(request, user)
        request.session['selected_role'] = role
        request.session['mobile_auth_ok'] = True
        ActivityService.log_login(request, user)
        return JsonResponse({'success': True, 'redirect_url': '/app/', 'message': 'Login successful'})
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
        'background_color': '#667eea',
        'theme_color': '#667eea',
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
    sw_content = """\
/* Adarsh ID Cards — PWA Service Worker */
const CACHE = 'adarsh-app-v2';
const SHELL = ['/app/', '/app/login/', '/app/manifest.json'];

self.addEventListener('install', function(e) {
    e.waitUntil(
        caches.open(CACHE).then(async function(c) {
            await Promise.allSettled(
                SHELL.map(function(url) {
                    return c.add(url);
                })
            );
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', function(e) {
    e.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.filter(function(k) { return k !== CACHE; })
                    .map(function(k) { return caches.delete(k); })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', function(e) {
    /* Only intercept GET requests within /app/ */
    if (e.request.method !== 'GET') return;
    var url = new URL(e.request.url);
    if (!url.pathname.startsWith('/app/')) return;

    e.respondWith(
        fetch(e.request).catch(function() {
            return caches.match(e.request).then(function(cached) {
                return cached || caches.match('/app/');
            });
        })
    );
});
"""
    response = HttpResponse(sw_content, content_type='application/javascript')
    response['Service-Worker-Allowed'] = '/app/'
    response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return response


@require_mobile_client
def home(request):
    """Home dashboard with real card counts and recent activity."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/app/login/')

    # ── Compute accessible_ids ONCE for the entire view ──────────────────
    # Avoids 4+ redundant M2M queries for admin_staff users.
    _is_admin = PermissionService.is_any_admin(user)
    _is_admin_staff = PermissionService.is_admin_staff(user)
    accessible_ids = _admin_accessible_client_ids(user) if _is_admin else None

    result = ClientDashboardService.get_dashboard_data(user, client=client)

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

    # Admin-specific counts for dashboard management section (cached 5 min)
    if _is_admin:
        from client.models import Client
        from staff.models import Staff
        scoped_clients = Client.objects.filter(status='active')
        scoped_tables = IDCardTable.objects.filter(is_active=True)
        scoped_cards = IDCard.objects.all()
        if accessible_ids is not None:
            scoped_clients = scoped_clients.filter(id__in=accessible_ids)
            scoped_tables = scoped_tables.filter(group__client_id__in=accessible_ids)
            scoped_cards = scoped_cards.filter(table__group__client_id__in=accessible_ids)

        cache_key = 'mob_admin_home_counts' if accessible_ids is None else f'mob_admin_home_counts:{user.id}'
        _admin_counts = cache.get(cache_key)
        if _admin_counts is None:
            _admin_counts = {
                'admin_client_count': scoped_clients.count(),
                'admin_staff_count': Staff.objects.filter(staff_type='admin_staff').count(),
                'admin_table_count': scoped_tables.count(),
                'admin_total_cards': scoped_cards.count(),
            }
            cache.set(cache_key, _admin_counts, 300)
        ctx.update(_admin_counts)

    # ── Card status counts ───────────────────────────────────────────────
    # For admins: single cached aggregate across accessible scope.
    # For client/client_staff: use ClientDashboardService result (already computed).
    if _is_admin:
        # Super-admins all see the same global aggregate → shared cache key is intentional.
        _status_cache_key = 'mob_admin_status_counts' if accessible_ids is None else f'mob_admin_status_counts:{user.id}'
        _gcounts = cache.get(_status_cache_key)
        if _gcounts is None:
            _gcards = IDCard.objects.all()
            if accessible_ids is not None:
                _gcards = _gcards.filter(table__group__client_id__in=accessible_ids)
            _gcounts = {r['status']: r['n'] for r in _gcards.order_by().values('status').annotate(n=Count('id'))}
            cache.set(_status_cache_key, _gcounts, 30)
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
        ctx.update({
            'pending_count': counts.get('pending', 0),
            'verified_count': counts.get('verified', 0),
            'approved_count': counts.get('approved', 0),
            'download_count': counts.get('download', 0),
            'pool_count': counts.get('pool', 0),
            'total_cards': data.get('total_cards', 0),
        })
    else:
        ctx.update({
            'pending_count': 0, 'verified_count': 0,
            'approved_count': 0, 'download_count': 0,
            'pool_count': 0, 'total_cards': 0,
        })

    # Build card-based recent activity in the exact format the template expects
    # Admin: all cards across all clients; client roles: scoped to their client
    from django.utils.timesince import timesince as _timesince
    from django.utils import timezone as _tz
    _now = _tz.now()
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
    # For admins: show top 8 active clients ordered by most-recently updated card.
    # For client / client_staff: show the single client's groups as "clients".
    recent_client_updates = []
    try:
        if _is_admin:
            from client.models import Client as ClientModel
            # Clients that have cards, ordered by most recent card update
            clients_qs = (
                ClientModel.objects
                .filter(status='active')
                .annotate(last_update=Max('id_card_groups__tables__id_cards__updated_at'))
                .filter(last_update__isnull=False)
                .order_by('-last_update')
            )
            if accessible_ids is not None:
                clients_qs = clients_qs.filter(id__in=accessible_ids)
            client_list = list(clients_qs[:10])
            client_ids = [c.id for c in client_list]

            # 1 query: card counts by (client, status) for all visible clients
            _cc_raw = (
                IDCard.objects.filter(table__group__client_id__in=client_ids)
                .values('table__group__client_id', 'status')
                .annotate(n=Count('id'))
            )
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
                    'pending': _sm.get('pending', 0),
                    'verified': _sm.get('verified', 0),
                    'approved': _sm.get('approved', 0),
                    'download': _sm.get('download', 0),
                    'tables': _tables_data,
                })
        else:
            # Single client — show per-group breakdown
            # 2 queries total (groups list + one aggregate) instead of 1+N
            from idcards.models import IDCardGroup
            groups_list = list(IDCardGroup.objects.filter(client=client).order_by('name')[:6])
            group_ids = [g.id for g in groups_list]
            _gc_raw = (
                IDCard.objects.filter(table__group_id__in=group_ids)
                .values('table__group_id', 'status')
                .annotate(n=Count('id'))
            )
            _gc_map = {}
            for _row in _gc_raw:
                _gc_map.setdefault(_row['table__group_id'], {})[_row['status']] = _row['n']

            for grp in groups_list:
                status_map = _gc_map.get(grp.id, {})
                if not sum(status_map.values(), 0):
                    continue
                recent_client_updates.append({
                    'client_id': client.id,
                    'client_name': grp.name,
                    'group_id': grp.id,
                    'pending': status_map.get('pending', 0),
                    'verified': status_map.get('verified', 0),
                    'approved': status_map.get('approved', 0),
                    'download': status_map.get('download', 0),
                    'tables': [],
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

            clients_qs = (
                ClientModel.objects
                .filter(status='active')
                .annotate(last_reprint_update=Max('id_card_groups__tables__reprint_requests__updated_at'))
                .filter(last_reprint_update__isnull=False)
                .order_by('-last_reprint_update')
            )
            if accessible_ids is not None:
                clients_qs = clients_qs.filter(id__in=accessible_ids)

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
                    'requested': _requested,
                    'confirmed': _confirmed,
                    'tables': _tables_data,
                })
        else:
            _tables_qs = IDCardTable.objects.filter(group__client=client, is_active=True)
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

            _tables = list(_tables_qs.order_by('group__name', 'name')[:12])
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

            _tables_data = []
            for _tbl in _tables:
                _tm = _tr_map.get(_tbl.id, {})
                _requested = _tm.get('requested', 0)
                _confirmed = _tm.get('confirmed', 0)
                reprint_request_total += _requested
                reprint_confirmed_total += _confirmed
                _tables_data.append({
                    'id': _tbl.id,
                    'name': _tbl.name,
                    'requested': _requested,
                    'confirmed': _confirmed,
                })

            if _tables_data:
                recent_reprint_updates.append({
                    'client_id': client.id,
                    'client_name': client.name,
                    'requested': reprint_request_total,
                    'confirmed': reprint_confirmed_total,
                    'tables': _tables_data,
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
    base_qs = Client.objects.all()

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
    client_data = []
    for c in clients:
        client_data.append({
            'id': c.id,
            'name': c.name,
            'tables_count': c.tables_count,
            'cards_count': c.cards_count,
            'status': c.status,
        })

    # Tables are lazy-loaded per client on first expand — skip server-side preloading
    for _cd in client_data:
        _cd['tables'] = None

    return render(request, 'mobile_app/clients_list.html', {
        'user_name': user.get_full_name() or user.username,
        'clients': client_data,
        'clients_json': client_data,
        'client_count': len(client_data),
        'can_manage_clients': PermissionService.is_super_admin(user),
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

    # Keep initial server-rendered ordering aligned with api_cards()/ClientCardService.get_cards.
    if status == 'download':
        cards_qs = IDCard.objects.filter(table=table, status=status).order_by('-downloaded_at', '-id')
    elif status == 'pool':
        cards_qs = IDCard.objects.filter(table=table, status=status).order_by('-deleted_at', '-id')
    elif status in ('verified', 'approved'):
        cards_qs = IDCard.objects.filter(table=table, status=status).order_by('-status_changed_at', 'id')
    else:
        cards_qs = IDCard.objects.filter(table=table, status=status).order_by('-created_at', 'id')

    # Keep the first render query lean: only fields used by this view are loaded.
    cards_qs = cards_qs.only(
        'id', 'field_data', 'status', 'photo',
        'created_at', 'status_changed_at', 'downloaded_at', 'deleted_at',
    )

    _card_batch_raw = list(cards_qs[:51])
    _has_more_raw = len(_card_batch_raw) > 50
    cards_batch = _card_batch_raw[:50]

    # For client_staff: apply class/section filter
    allowed_classes = []
    allowed_sections = []
    if PermissionService.is_client_staff(user):
        staff = getattr(user, 'staff_profile', None)
        if staff:
            allowed_classes, allowed_sections = _staff_table_scope_filters(staff, table)

    table_fields = table.fields if hasattr(table, 'fields') and table.fields else []

    photo_exts = ('.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.hei')
    image_field_keywords = ('photo', 'image', 'signature', 'barcode', 'qr')
    image_field_types = ('photo', 'image', 'file', 'mother_photo', 'father_photo', 'signature', 'barcode', 'qr_code')

    def _is_image_like_name(raw_name):
        _name = str(raw_name).strip().lower()
        if not _name:
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
        _low = _raw.lower()
        if _raw.startswith('/') or _raw.startswith('http://') or _raw.startswith('https://'):
            return _raw, True
        if 'adarshimg/' in _low or _low.endswith(photo_exts):
            return settings.MEDIA_URL + _raw, True
        if '/' in _raw or '\\' in _raw:
            return settings.MEDIA_URL + _raw.lstrip('/\\'), True
        return None, False

    def _extract_photo_slots(fd, primary_photo_url, field_defs):
        _fd = fd or {}
        _fd_lookup = {
            str(_k).strip().lower(): _v
            for _k, _v in _fd.items()
            if _k is not None and str(_k).strip()
        }

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
                _val = _fd_lookup.get(_fname.lower())
                _url, _has_path = _normalize_photo_value(_val)
                slots.append({'url': _url, 'has_path': _has_path})
                if _url and _url not in urls:
                    urls.append(_url)

            if primary_photo_url and primary_photo_url not in urls:
                _empty_idx = next((i for i, _slot in enumerate(slots) if not _slot.get('url')), None)
                if _empty_idx is not None:
                    slots[_empty_idx] = {'url': primary_photo_url, 'has_path': True}
                else:
                    slots.insert(0, {'url': primary_photo_url, 'has_path': True})
                urls.append(primary_photo_url)

            return slots, urls

        if primary_photo_url:
            slots.append({'url': primary_photo_url, 'has_path': True})
            urls.append(primary_photo_url)

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
    for idx, card in enumerate(cards_batch):
        fd = card.field_data or {}
        name = fd.get('NAME') or fd.get('name') or fd.get('Name') or ''
        roll_no = fd.get('ROLL NO') or fd.get('ROLL_NO') or fd.get('roll_no') or fd.get('ID') or ''
        father_name = fd.get('FATHER NAME') or fd.get("FATHER'S NAME") or fd.get('FATHER_NAME') or fd.get('father_name') or ''
        mother_name = fd.get('MOTHER NAME') or fd.get("MOTHER'S NAME") or fd.get('MOTHER_NAME') or fd.get('mother_name') or ''
        class_name = fd.get('CLASS') or fd.get('class') or fd.get('DESIGNATION') or ''
        section = fd.get('SECTION') or fd.get('section') or ''
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
            'field_data': fd,
            'display_fields': _build_display_fields(fd, table_fields),
        })

    # Apply class/section filters for client_staff if restrictions are set
    if allowed_classes:
        cards = [c for c in cards if c['class_name'] in allowed_classes]
    if allowed_sections:
        cards = [c for c in cards if c['section'] in allowed_sections]

    # Re-number sr_no after filtering
    for i, c in enumerate(cards):
        c['sr_no'] = i + 1

    total_count = len(cards)

    # has_more: only meaningful when no client-side class/section filtering is applied
    has_more = _has_more_raw and not (allowed_classes or allowed_sections)

    # Build and cache filter options from full table data to avoid repeated full-table scans.
    filter_meta = _get_table_filter_metadata(table, table_fields)
    all_classes = list(filter_meta.get('all_classes') or [])
    all_sections = list(filter_meta.get('all_sections') or [])
    class_to_sections = dict(filter_meta.get('class_to_sections') or {})

    # Respect explicit client_staff restrictions in filter options.
    if allowed_classes:
        _allowed_set = set(allowed_classes)
        all_classes = [c for c in all_classes if c in _allowed_set]
    if allowed_sections:
        _allowed_set = set(allowed_sections)
        all_sections = [s for s in all_sections if s in _allowed_set]

    if allowed_classes:
        _allowed_cls_set = set(allowed_classes)
        class_to_sections = {
            _cls: _sections
            for _cls, _sections in class_to_sections.items()
            if _cls in _allowed_cls_set
        }
    if allowed_sections:
        _allowed_sec_set = set(allowed_sections)
        class_to_sections = {
            _cls: [s for s in _sections if s in _allowed_sec_set]
            for _cls, _sections in class_to_sections.items()
        }
    # Count badges — single aggregate query replaces 4 separate COUNTs
    tab_counts = {'pending': 0, 'verified': 0, 'approved': 0, 'download': 0, 'pool': 0}
    for _row in IDCard.objects.filter(table=table).values('status').annotate(n=Count('id')):
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

    response = render(request, 'mobile_app/list_page.html', {
        'user_name': user.get_full_name() or user.username,
        # Always show the table owner in list subtitle to avoid stale fallback client labels.
        'client': getattr(table.group, 'client', None) or client,
        'table': table,
        'table_id': table.id,
        'first_table_id': table.id,
        'group': table.group,
        'students': cards,
        'students_json': json.dumps(cards, default=str),
        'total_count': total_count,
        'has_more': has_more,
        'list_type': status,
        'classes': all_classes,
        'sections': all_sections,
        'class_to_sections': class_to_sections,
        'table_fields': json.dumps(table_fields, default=str),
        # View-only mode: clients on approved/download lists can only view, not act
        'view_only_list': status in ('approved', 'download') and not PermissionService.is_any_admin(user),
        'tab_counts': tab_counts,
        'reprint_counts': reprint_counts,
        'can_reprint_request_list': can_reprint_request_list,
        'can_reprint_confirmed_list': can_reprint_confirmed_list,
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
            from cardprint.services import PrintWorkflowService

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
                    result = PrintWorkflowService.create_requests(table, card_ids, user)
                    if not result.success:
                        notice = {'message': result.message or 'Could not send selected items to print list.', 'type': 'error'}
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

    counts_raw = (
        ReprintRequest.objects
        .filter(table=table, status__in=['requested', 'confirmed'], card__status='download')
        .values('status')
        .annotate(n=Count('id'))
    )
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
    image_field_types = ('photo', 'image', 'file', 'mother_photo', 'father_photo', 'signature', 'barcode', 'qr_code')

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

    # If no specific card_id provided, show card picker with all cards for name-based search
    all_cards = []
    if card_id is None:
        cards_qs = IDCard.objects.filter(table=table).only('id', 'field_data').order_by('id')[:300]
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
    """Notifications — shows real recent activity."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/app/login/')

    result = ClientDashboardService.get_dashboard_data(user, client=client)
    activities = []
    if result.success:
        for act in result.data.get('recent_activity', []):
            status = act.get('status', '')
            icon_map = {
                'pending': 'fa-clock', 'verified': 'fa-check-circle',
                'approved': 'fa-check-double', 'download': 'fa-download',
                'pool': 'fa-layer-group', 'reprint': 'fa-redo',
            }
            color_map = {
                'pending': 'yellow', 'verified': 'green',
                'approved': 'blue', 'download': 'purple',
                'pool': 'red', 'reprint': 'orange',
            }
            activities.append({
                'title': f"{act.get('name', 'Card')} — {act.get('status_display', status)}",
                'message': f"Table: {act.get('table_name', '')}",
                'time': act.get('updated_at', ''),
                'read': True,
                'icon': icon_map.get(status, 'fa-info-circle'),
                'color': color_map.get(status, 'gray'),
            })

    return render(request, 'mobile_app/notifications.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'notifications': activities,
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

    _ok, _err, photo = _validate_image(photo)
    if not _ok:
        return JsonResponse({'success': False, 'message': _err}, status=400)
    try:
        card = IDCard.objects.select_related('table__group').get(id=card_id_int, table_id=table_id)
        if not ClientAccessService.can_access_card(request.user, card):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
        import os, uuid
        ext = os.path.splitext(photo.name.lower())[1] or '.jpg'
        safe_name = f'{uuid.uuid4().hex}{ext}'
        card.photo.save(safe_name, photo, save=True)
        return JsonResponse({'success': True, 'message': 'Photo uploaded', 'photo_url': card.photo.url})
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
    return JsonResponse({'success': False, 'message': result.message}, status=404)


@require_mobile_client
@require_http_methods(["GET"])
def api_cards(request, table_id):
    """Get cards for a table (paginated)."""
    status_filter = request.GET.get('status', '')
    search = _sanitize_search_query(request.GET.get('search', ''))
    try:
        page = max(int(request.GET.get('page', 1)), 1)
        per_page = max(1, min(int(request.GET.get('per_page', 50)), 200))
    except (ValueError, TypeError):
        page, per_page = 1, 50

    offset = (page - 1) * per_page
    result = ClientCardService.get_cards(
        request.user, table_id,
        status_filter or None, offset, per_page,
        search or None,
    )
    if result.success:
        return JsonResponse({'success': True, 'data': result.data})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


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

        # Validate photo BEFORE writing card to DB
        photo = request.FILES.get('photo')
        if photo:
            _ok, _err, photo = _validate_image(photo)
            if not _ok:
                return JsonResponse({'success': False, 'message': _err}, status=400)

        card = IDCard.objects.create(table=table, field_data=field_data, status='pending')

        if photo:
            import os, uuid
            ext = os.path.splitext(photo.name.lower())[1] or '.jpg'
            safe_name = f'{uuid.uuid4().hex}{ext}'
            card.photo.save(safe_name, photo, save=True)

        return JsonResponse({'success': True, 'message': 'Card added successfully', 'card_id': card.id})
    except Exception:
        import logging as _log
        _log.getLogger(__name__).exception('Card add error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


@require_mobile_client
@require_http_methods(["POST"])
def api_card_update(request, table_id, card_id):
    """Update an existing card."""
    try:
        card = get_object_or_404(IDCard.objects.select_related('table__group'), id=card_id, table_id=table_id)
        if not ClientAccessService.can_access_card(request.user, card):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
        if not PermissionService.has(request.user, 'perm_idcard_edit'):
            return JsonResponse({'success': False, 'message': 'No permission to edit cards'}, status=403)

        field_data_raw = request.POST.get('field_data', '{}')
        try:
            field_data = json.loads(field_data_raw)
        except json.JSONDecodeError:
            field_data = {}
        if not isinstance(field_data, dict):
            field_data = {}

        if field_data:
            existing = card.field_data or {}
            existing.update(field_data)
            card.field_data = existing

        photo = request.FILES.get('photo')
        if photo:
            _ok, _err, photo = _validate_image(photo)
            if not _ok:
                return JsonResponse({'success': False, 'message': _err}, status=400)
            import os, uuid
            ext = os.path.splitext(photo.name.lower())[1] or '.jpg'
            safe_name = f'{uuid.uuid4().hex}{ext}'
            card.photo.save(safe_name, photo, save=False)

        card.save()
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
        # Require edit permission to modify table fields
        if not PermissionService.has(request.user, 'perm_idcard_edit'):
            return JsonResponse({'success': False, 'message': 'Edit permission required'}, status=403)

        body = json.loads(request.body or '{}')
        raw_fields = body.get('fields', [])

        if not isinstance(raw_fields, list):
            return JsonResponse({'success': False, 'message': 'fields must be a list'}, status=400)

        VALID_FIELD_TYPES = {
            'text', 'number', 'date', 'select', 'photo', 'signature', 'qr_code',
            'barcode', 'class_section', 'mother_photo', 'father_photo',
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
            validated.append({
                'name': name,
                'type': ftype,
                'order': idx,
                'mandatory': bool(f.get('mandatory', False)),
            })

        table.fields = validated
        table.save(update_fields=['fields'])
        return JsonResponse({'success': True, 'message': 'Column order saved successfully'})
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

    # Only client and super_admin can manage staff from mobile.
    if not PermissionService.is_client(user) and not PermissionService.is_super_admin(user):
        return redirect('mobile_app:home')

    # For client role, use the service; super_admin sees admin staff only.
    staff_list = []
    if PermissionService.is_client(user):
        result = ClientStaffService.list_staff(user)
        if result.success:
            staff_list = result.data.get('staff', [])
    elif PermissionService.is_super_admin(user):
        # Admin management view should only include admin_staff.
        all_staff = (
            Staff.objects
            .filter(staff_type='admin_staff')
            .select_related('user')
            .order_by('-created_at')[:200]
        )
        for s in all_staff:
            staff_list.append({
                'id': s.id,
                'name': s.user.get_full_name() or s.user.username,
                'email': s.user.email,
                'phone': getattr(s.user, 'phone', '') or '',
                'department': s.department or '',
                'designation': s.designation or '',
                'is_active': s.user.is_active,
                'staff_type': s.get_staff_type_display(),
                'created_at': s.created_at.strftime('%d %b %Y'),
            })

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
        return redirect('/app/login/')

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
        if accessible_ids is not None:
            scoped_clients = scoped_clients.filter(id__in=accessible_ids)
            scoped_tables = scoped_tables.filter(group__client_id__in=accessible_ids)
            scoped_cards = scoped_cards.filter(table__group__client_id__in=accessible_ids)
        ctx['admin_client_count'] = scoped_clients.count()
        ctx['admin_staff_count'] = Staff.objects.filter(staff_type='admin_staff').count()
        ctx['admin_table_count'] = scoped_tables.count()
        ctx['admin_total_cards'] = scoped_cards.count()

    # ── TAB: Notifications ───────────────────────────────────────────────
    from core.models import Notification, NotificationRead
    user_role = getattr(user, 'role', '')
    _notif_qs = (
        Notification.objects
        .filter(is_active=True)
        .filter(Q(target='all') | Q(target=user_role) | Q(target='selected', target_users=user))
        .order_by('-created_at')[:20]
    )
    _read_ids = set(
        NotificationRead.objects.filter(user=user).values_list('notification_id', flat=True)
    )
    ctx['system_notifications'] = [
        {
            'id': n.id,
            'title': n.title,
            'message': n.message,
            'priority': n.priority,
            'priority_color': n.priority_color,
            'category': n.get_category_display(),
            'icon_class': n.icon_class,
            'created_at': n.created_at.strftime('%d %b %Y'),
            'is_read': n.id in _read_ids,
        }
        for n in _notif_qs
    ]
    ctx['unread_system_count'] = sum(1 for n in ctx['system_notifications'] if not n['is_read'])

    # ── TAB: Logs ────────────────────────────────────────────────────────
    from django.utils.timesince import timesince as _timesince
    from django.utils import timezone as _tz
    _now = _tz.now()
    _cards_scope = (
        IDCard.objects.all() if PermissionService.is_any_admin(user)
        else IDCard.objects.filter(table__group__client=client)
    )
    if PermissionService.is_admin_staff(user):
        accessible_ids = _admin_accessible_client_ids(user)
        _cards_scope = _cards_scope.filter(table__group__client_id__in=accessible_ids)
    _log_acts = []
    for _card in _cards_scope.select_related('table', 'table__group').order_by('-updated_at')[:30]:
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
        ctx['app_version'] = 'v2.19.0'
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

        # Prefer key-based JSON search to avoid expensive full JSON text casts.
        cards_qs = _search_cards_queryset(base_qs, query)[:50]

        for card in cards_qs:
            fd = card.field_data or {}
            name = fd.get('NAME') or fd.get('name') or fd.get('Name') or f'Card #{card.id}'
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
        if not ClientAccessService.can_access_card(user, card):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
        if not PermissionService.has(user, 'perm_idcard_delete'):
            return JsonResponse({'success': False, 'message': 'No delete permission'}, status=403)

        data = json.loads(request.body) if request.body else {}
        permanent = data.get('permanent', False)

        if permanent:
            card.delete()
            return JsonResponse({'success': True, 'message': 'Card permanently deleted'})
        else:
            card.status = 'pool'
            card.save(update_fields=['status'])
            return JsonResponse({'success': True, 'message': 'Card moved to pool'})
    except Exception:
        logger.exception('Card delete error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_staff_list(request):
    """List staff for the client."""
    user = request.user
    if PermissionService.is_client(user):
        result = ClientStaffService.list_staff(user)
        if result.success:
            return JsonResponse({'success': True, 'data': result.data})
        return JsonResponse({'success': False, 'message': result.message}, status=400)
    elif PermissionService.is_super_admin(user):
        all_staff = (
            Staff.objects
            .filter(staff_type='admin_staff')
            .select_related('user')
            .order_by('-created_at')[:200]
        )
        staff_data = []
        for s in all_staff:
            staff_data.append({
                'id': s.id,
                'name': s.user.get_full_name() or s.user.username,
                'email': s.user.email,
                'phone': getattr(s.user, 'phone', '') or '',
                'department': s.department or '',
                'designation': s.designation or '',
                'is_active': s.user.is_active,
                'staff_type': s.get_staff_type_display(),
            })
        return JsonResponse({'success': True, 'data': {'staff': staff_data}})
    return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)


@require_mobile_client
@require_http_methods(["POST"])
def api_staff_create(request):
    """Create a new staff member."""
    user = request.user
    if not (PermissionService.is_client(user) or PermissionService.is_super_admin(user)):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    # For admin users, delegate via the client attached to their current context
    if PermissionService.is_super_admin(user):
        client, _ = _client_ctx(user)
        if not client:
            return JsonResponse({'success': False, 'message': 'No client context found for admin'}, status=400)
        # Use the client's user to drive the service
        acting_user = getattr(client, 'user', None)
        if acting_user is None:
            return JsonResponse({'success': False, 'message': 'Client has no associated user — please create staff from the desktop panel'}, status=400)
        result = ClientStaffService.create_staff(acting_user, data)
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
    if not (PermissionService.is_client(user) or PermissionService.is_super_admin(user)):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    if PermissionService.is_super_admin(user):
        client, _ = _client_ctx(user)
        acting_user = getattr(client, 'user', None) if client else None
        if acting_user is None:
            return JsonResponse({'success': False, 'message': 'Cannot update staff without client context'}, status=400)
        result = ClientStaffService.update_staff(acting_user, staff_id, data)
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
    if not (PermissionService.is_client(user) or PermissionService.is_super_admin(user)):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    if PermissionService.is_client(user):
        result = ClientStaffService.toggle_staff_status(user, staff_id)
        if result.success:
            return JsonResponse({'success': True, 'message': result.message, **(result.data or {})})
        return JsonResponse({'success': False, 'message': result.message}, status=400)
    else:
        # Admin toggle — directly update the Staff user's is_active
        try:
            staff = Staff.objects.select_related('user').get(id=staff_id)
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
    if not (PermissionService.is_client(user) or PermissionService.is_super_admin(user)):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    if PermissionService.is_client(user):
        result = ClientStaffService.delete_staff(user, staff_id)
        if result.success:
            return JsonResponse({'success': True, 'message': result.message})
        return JsonResponse({'success': False, 'message': result.message}, status=400)
    else:
        try:
            staff = Staff.objects.select_related('user').get(id=staff_id)
            name = staff.user.get_full_name() or staff.user.username
            staff.user.delete()  # cascade deletes staff profile
            return JsonResponse({'success': True, 'message': f'{name} deleted'})
        except Staff.DoesNotExist:
            return JsonResponse({'success': False, 'message': 'Staff not found'}, status=404)
        except Exception as exc:
            logger.exception('Admin staff delete error')
            return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


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
@require_http_methods(["GET"])
def api_search(request):
    """Global search API across all client cards."""
    user = request.user
    client, _ = _client_ctx(user)
    if not client:
        return JsonResponse({'success': False, 'message': 'No client'}, status=400)

    query = _sanitize_search_query(request.GET.get('q', ''))
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

    # Prefer key-based JSON search to avoid expensive full JSON text casts.
    cards_qs = _search_cards_queryset(base_qs, query)[:30]

    results = []
    for card in cards_qs:
        fd = card.field_data or {}
        name = fd.get('NAME') or fd.get('name') or fd.get('Name') or f'Card #{card.id}'
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


# ─── Client Management APIs ────────────────────────────────────────────────────

@require_mobile_client
@require_http_methods(['POST'])
def api_client_toggle(request, client_id):
    """Toggle a client between active / inactive."""
    from client.models import Client
    if not PermissionService.is_super_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Only super admin can change client status'}, status=403)
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
        client.delete()
        return JsonResponse({'success': True, 'message': f'{client_name} deleted permanently'})
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
        }
        for t in tables_qs
    ]
    return JsonResponse({'success': True, 'tables': tables})


@require_mobile_client
@require_http_methods(['GET'])
def api_client_detail(request, client_id):
    """Fetch client details for edit form (super_admin only)."""
    if not PermissionService.is_super_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Only super admin can edit clients'}, status=403)

    result = ClientService.get(client_id, include_permissions=True)
    if not result.success:
        return JsonResponse({'success': False, 'message': result.message or 'Client not found'}, status=404)
    return JsonResponse({'success': True, 'client': result.data.get('client', {})})


@require_mobile_client
@require_http_methods(['POST'])
def api_client_create(request):
    """Create a client from mobile app (super_admin only)."""
    if not PermissionService.is_super_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Only super admin can create clients'}, status=403)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    result = ClientService.create(data, request=request)
    if not result.success:
        return JsonResponse({'success': False, 'message': result.message or 'Failed to create client'}, status=400)

    client_payload = result.data.get('client', {}) if result.data else {}
    return JsonResponse({
        'success': True,
        'message': result.message or 'Client created successfully',
        'client': client_payload,
    })


@require_mobile_client
@require_http_methods(['POST'])
def api_client_update(request, client_id):
    """Update client from mobile app (super_admin only)."""
    if not PermissionService.is_super_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Only super admin can update clients'}, status=403)
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
# WEBSITE MANAGEMENT (Portfolio & Reels — mobile upload)
# ---------------------------------------------------------------------------

@require_mobile_client
def website_manage(request):
    """Mobile website management page: portfolio categories + reels upload."""
    user = request.user
    if not PermissionService.has(user, 'perm_website_view'):
        return render(request, 'mobile_app/no_access.html', {
            'user_name': user.get_full_name() or user.username,
        }, status=403)

    from website.models import PortfolioCategory, Reel

    # Fetch only the fields needed for JSON serialisation — no full ORM hydration
    categories = (
        PortfolioCategory.objects
        .filter(is_active=True)
        .annotate(photo_count=Count('items', filter=Q(items__is_active=True)))
        .order_by('order', 'name')
        .only('id', 'name', 'icon', 'order')
    )

    reels = (
        Reel.objects
        .filter(is_active=True)
        .order_by('order', '-created_at')
        .only('id', 'title', 'thumbnail', 'order')
    )

    # Skip the client lookup — website_manage doesn’t need a client object
    perms = PermissionService.get_permission_context(user)

    categories_data = [
        {'id': c.id, 'name': c.name, 'icon': c.icon, 'count': c.photo_count}
        for c in categories
    ]
    reels_data = [
        {
            'id': r.id,
            'title': r.title,
            'thumbnail_url': r.thumbnail.url if r.thumbnail else '',
            'video_url': (r.video_file.url if r.video_file else r.video_url),
        }
        for r in reels
    ]

    return render(request, 'mobile_app/website_manage.html', {
        'user_name': user.get_full_name() or user.username,
        'categories_json': categories_data,
        'reels_json': reels_data,
        **perms,
    })


@require_mobile_client
@require_http_methods(['POST'])
def api_portfolio_upload(request):
    """Upload one or more images into a portfolio category from mobile."""
    user = request.user
    # perm_website_edit required — view-only users must not be able to write content
    if not PermissionService.has(user, 'perm_website_edit'):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    from website.models import PortfolioCategory
    from website.services import PortfolioItemService
    from django.core.exceptions import ValidationError

    category_id = request.POST.get('category_id')
    files = request.FILES.getlist('images')

    if not category_id:
        return JsonResponse({'success': False, 'message': 'category_id required'}, status=400)
    if not files:
        return JsonResponse({'success': False, 'message': 'No images provided'}, status=400)
    if len(files) > 20:
        return JsonResponse({'success': False, 'message': 'Maximum 20 images per upload'}, status=400)

    try:
        get_object_or_404(PortfolioCategory, id=category_id, is_active=True)
        created = []
        failed = []
        for f in files:
            try:
                # Runs full pipeline: watermark → WebP → compress <500 KB
                item = PortfolioItemService.create(
                    category_id=category_id,
                    image=f,
                    item_type='image',
                    is_active=True,
                )
                created.append({'id': item.id, 'url': item.image.url if item.image else ''})
            except ValidationError as exc:
                msg = '; '.join(exc.messages) if getattr(exc, 'messages', None) else str(exc)
                failed.append({'name': getattr(f, 'name', 'file'), 'error': msg})
            except Exception:
                logger.exception('api_portfolio_upload item error for file: %s', getattr(f, 'name', 'file'))
                failed.append({'name': getattr(f, 'name', 'file'), 'error': 'Upload failed for this file'})

        if created:
            return JsonResponse({
                'success': True,
                'count': len(created),
                'items': created,
                'failed': failed,
                'failed_count': len(failed),
            }, status=207 if failed else 200)

        first_error = failed[0]['error'] if failed else 'An error occurred. Please try again.'
        return JsonResponse({
            'success': False,
            'message': first_error,
            'failed': failed,
            'failed_count': len(failed),
        }, status=400)
    except Exception as exc:
        logger.exception('api_portfolio_upload error: %s', exc)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_mobile_client
@require_http_methods(['GET'])
def api_portfolio_category_items(request, category_id):
    """List recent uploaded images for a portfolio category (preview in mobile website manager)."""
    user = request.user
    if not PermissionService.has(user, 'perm_website_view'):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    from website.models import PortfolioCategory, PortfolioItem

    category = get_object_or_404(PortfolioCategory, id=category_id, is_active=True)
    try:
        limit = int(request.GET.get('limit', 30) or 30)
    except (TypeError, ValueError):
        limit = 30
    limit = min(max(limit, 1), 100)

    items_qs = (
        PortfolioItem.objects
        .filter(category=category, is_active=True, image__isnull=False)
        .exclude(image='')
        .order_by('-created_at')[:limit]
    )

    items = [
        {
            'id': it.id,
            'title': it.title or category.name,
            'url': it.image.url if it.image else '',
        }
        for it in items_qs
    ]

    return JsonResponse({'success': True, 'category': {'id': category.id, 'name': category.name}, 'items': items})


@require_mobile_client
@require_http_methods(['POST'])
def api_reel_upload(request):
    """Create a new reel with a video file (and optional thumbnail)."""
    user = request.user
    # perm_website_edit required — view-only users must not be able to write content
    if not PermissionService.has(user, 'perm_website_edit'):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    from website.services import ReelService

    # Strip to plain text — prevent script injection via title field
    import html as _html
    raw_title = request.POST.get('title', '')
    title = _html.unescape(raw_title).strip()[:255]
    # Remove any HTML/script tags
    import re as _re
    title = _re.sub(r'<[^>]+>', '', title).strip()

    video_file = request.FILES.get('video')
    thumbnail = request.FILES.get('thumbnail')

    if not title:
        return JsonResponse({'success': False, 'message': 'Title is required'}, status=400)
    if not video_file:
        return JsonResponse({'success': False, 'message': 'Video file is required'}, status=400)

    try:
        # Runs full pipeline: compress video to <10 MB + watermark thumbnail
        reel = ReelService.create(
            title=title,
            video_file=video_file,
            thumbnail=thumbnail,
            is_active=True,
        )
        return JsonResponse({
            'success': True,
            'reel': {
                'id': reel.id,
                'title': reel.title,
                'thumbnail_url': reel.thumbnail.url if reel.thumbnail else '',
                'video_url': (reel.video_file.url if reel.video_file else reel.video_url),
            },
        })
    except Exception as exc:
        logger.exception('api_reel_upload error: %s', exc)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)

