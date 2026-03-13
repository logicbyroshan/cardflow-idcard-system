"""
Core Middleware Module

Contains middleware for:
- Subdomain-based URL routing (www vs panel)
- Request timing, slow-request detection, and query monitoring
- Permission validation on every request
- Session invalidation when permissions are revoked
- Active status enforcement
"""
import logging
import time
from urllib.parse import quote
from django.conf import settings as django_settings
from django.contrib.auth import logout
from django.shortcuts import redirect
from django.http import JsonResponse
from django.utils.functional import SimpleLazyObject
from django.urls import reverse

logger = logging.getLogger(__name__)
query_logger = logging.getLogger('slow_queries')

# Thresholds — configurable via settings.py / environment
SLOW_REQUEST_THRESHOLD = getattr(django_settings, 'SLOW_REQUEST_THRESHOLD', 1.5)
QUERY_COUNT_THRESHOLD = getattr(django_settings, 'QUERY_COUNT_THRESHOLD', 50)
SLOW_QUERY_THRESHOLD = getattr(django_settings, 'SLOW_QUERY_THRESHOLD', 0.1)


class SubdomainRoutingMiddleware:
    """
    Routes requests to different URL configurations based on the subdomain.

    - WEBSITE_DOMAIN (e.g. www.adarshbhopal.in)  → config.urls_website
    - PANEL_DOMAIN   (e.g. panel.adarshbhopal.in) → config.urls_panel

    On the panel subdomain, any incoming path that starts with /panel/ is
    silently rewritten (prefix stripped) so that old bookmarks keep working.

    In local development (127.0.0.1, localhost, or any unknown host),
    paths starting with /panel/ are automatically routed through
    config.urls_panel with the prefix stripped — so /panel/auth/login/
    renders the page, and JS API calls like /api/auth/check-email/
    resolve correctly against urls_panel.

    Must be placed BEFORE WhiteNoiseMiddleware in MIDDLEWARE so that the
    urlconf is set before any downstream middleware resolves URLs.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.website_domain = getattr(django_settings, 'WEBSITE_DOMAIN', '').lower().strip()
        self.panel_domain = getattr(django_settings, 'PANEL_DOMAIN', '').lower().strip()

    def __call__(self, request):
        host = request.get_host().split(':')[0].lower()  # strip port
        _set_panel_cookie = False

        if self.website_domain and host == self.website_domain:
            request.urlconf = 'config.urls_website'
            request._is_panel_subdomain = False
        elif self.panel_domain and host == self.panel_domain:
            request.urlconf = 'config.urls_panel'
            request._is_panel_subdomain = True
            # Backward compat: strip /panel/ prefix so old bookmarks still work
            if request.path_info.startswith('/panel/'):
                request.path_info = request.path_info[len('/panel'):]
                request.path = request.path_info
        elif request.path_info.startswith('/panel/') or request.path_info == '/panel':
            # Local dev / unknown host accessing /panel/… paths:
            # Route through urls_panel and strip the prefix.  Also set a
            # context cookie so that subsequent JS fetch() calls (which use
            # root-relative paths like /api/…) are routed through urls_panel.
            request.urlconf = 'config.urls_panel'
            request._is_panel_subdomain = True
            _set_panel_cookie = True
            request.path_info = request.path_info[len('/panel'):]  # /panel/auth/… → /auth/…
            if not request.path_info:
                request.path_info = '/'
            request.path = request.path_info
        elif request.COOKIES.get('_panel_ctx') == '1':
            # Local dev: JS API calls from a panel page (e.g. /api/auth/…).
            # The cookie was set when the /panel/… page was first loaded.
            request.urlconf = 'config.urls_panel'
            request._is_panel_subdomain = True
        else:
            # Unknown host, non-panel path — use default ROOT_URLCONF
            request._is_panel_subdomain = False

        response = self.get_response(request)

        # Set / clear the panel context cookie for local dev routing
        if _set_panel_cookie:
            response.set_cookie(
                '_panel_ctx', '1',
                httponly=True, samesite='Lax', max_age=86400,
                secure=request.is_secure(),
            )

        return response


class RequestTimingMiddleware:
    """
    Logs request duration and adds Server-Timing header.
    
    - Requests slower than SLOW_REQUEST_THRESHOLD → WARNING
    - All others → DEBUG (only visible when DEBUG=True)
    - Server-Timing header visible in browser DevTools → Network → Timing tab
    
    Query counting uses connection.execute_wrapper only when DEBUG=True
    to avoid overhead in production. In production, only request duration
    is tracked.
    """

    SKIP_PREFIXES = ('/static/', '/media/', '/favicon.ico')

    def __init__(self, get_response):
        self.get_response = get_response
        self._debug = getattr(django_settings, 'DEBUG', False)

    def __call__(self, request):
        if any(request.path.startswith(p) for p in self.SKIP_PREFIXES):
            return self.get_response(request)

        start = time.monotonic()

        if self._debug:
            # Full query counting only in DEBUG mode (avoids production overhead)
            response = self._call_with_query_tracking(request, start)
        else:
            # Production: just time the request, no per-query wrapper
            response = self.get_response(request)
            duration = time.monotonic() - start
            duration_ms = duration * 1000
            response['Server-Timing'] = 'total;dur=%.1f' % duration_ms
            self._log_request(request, response.status_code, duration, 0, 0.0)

        return response

    def _call_with_query_tracking(self, request, start):
        """Track individual queries — DEBUG mode only."""
        from django.db import connection
        query_count = 0
        query_time = 0.0
        slow_queries = []

        def _query_callback(execute, sql, params, many, context):
            nonlocal query_count, query_time
            q_start = time.monotonic()
            result = execute(sql, params, many, context)
            q_dur = time.monotonic() - q_start
            query_count += 1
            query_time += q_dur
            if q_dur >= SLOW_QUERY_THRESHOLD:
                slow_queries.append((sql[:200], round(q_dur * 1000)))
            return result

        with connection.execute_wrapper(_query_callback):
            response = self.get_response(request)

        duration = time.monotonic() - start
        duration_ms = duration * 1000
        db_ms = query_time * 1000
        response['Server-Timing'] = (
            'total;dur=%.1f, db;dur=%.1f;desc="%d queries"'
            % (duration_ms, db_ms, query_count)
        )

        self._log_request(request, response.status_code, duration, query_count, query_time)

        for sql, ms in slow_queries:
            query_logger.warning("SLOW QUERY path=%s time=%dms sql=%s", request.path, ms, sql)

        return response

    def _log_request(self, request, status, duration, query_count, query_time):
        """Log the request at appropriate level."""
        user = getattr(request, 'user', None)
        username = getattr(user, 'username', 'anonymous') if user and getattr(user, 'is_authenticated', False) else 'anonymous'
        role = getattr(user, 'role', '-') if user and getattr(user, 'is_authenticated', False) else '-'

        msg = "method=%s path=%s status=%d duration=%.3fs user=%s role=%s queries=%d db_time=%.3fs"
        args = (request.method, request.path, status, duration, username, role, query_count, query_time)

        if query_count > QUERY_COUNT_THRESHOLD:
            logger.warning("EXCESSIVE QUERIES " + msg, *args)
            query_logger.warning(
                "EXCESSIVE QUERIES path=%s queries=%d db_time=%.3fs user=%s",
                request.path, query_count, query_time, username
            )
        elif duration >= SLOW_REQUEST_THRESHOLD:
            logger.warning("SLOW REQUEST " + msg, *args)
        else:
            logger.debug(msg, *args)


class PanelEntryGateMiddleware:
    """
    Restrict direct access to the panel subdomain.

    Anonymous users must enter via the website panel button flow, which
    provides a short-lived signed token. Once validated, a session flag
    allows normal panel navigation.
    """

    EXEMPT_PREFIXES = (
        '/static/',
        '/media/',
        '/favicon.ico',
        '/robots.txt',
        '/api/health/',
    )
    EXEMPT_PATHS = {
        '/admin/',
    }
    TOKEN_PARAM = 'panel_entry_token'
    SESSION_KEY = '_panel_entry_ok'
    TOKEN_SALT = 'panel-entry-gate'
    TOKEN_VALUE = 'website-panel-entry'

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not getattr(request, '_is_panel_subdomain', False):
            return self.get_response(request)

        if self._is_exempt(request.path):
            return self.get_response(request)

        from core.models import SystemSettings
        not_found_mode = SystemSettings.get_value('website_not_found_mode', 'false') == 'true'
        if not not_found_mode:
            return self.get_response(request)

        gate_enabled = SystemSettings.get_value('panel_entry_gate_enabled', 'true') == 'true'
        if not gate_enabled:
            return self.get_response(request)

        if request.session.get(self.SESSION_KEY) == '1':
            return self.get_response(request)

        if getattr(request.user, 'is_authenticated', False):
            request.session[self.SESSION_KEY] = '1'
            return self.get_response(request)

        token = request.GET.get(self.TOKEN_PARAM)
        if token and self._is_valid_token(token):
            request.session[self.SESSION_KEY] = '1'
            return self.get_response(request)

        from django.http import Http404
        raise Http404('Not found')

    def _is_valid_token(self, token):
        from django.core.signing import Signer, BadSignature

        signer = Signer(salt=self.TOKEN_SALT)
        try:
            value = signer.unsign(token)
            return value == self.TOKEN_VALUE
        except BadSignature:
            return False

    def _is_exempt(self, path):
        if path in self.EXEMPT_PATHS:
            return True
        for prefix in self.EXEMPT_PREFIXES:
            if path.startswith(prefix):
                return True
        return False


class PermissionValidationMiddleware:
    """
    Middleware to validate user permissions and active status on every request.
    
    CRITICAL SECURITY:
    - Re-fetches user data from DB to catch real-time changes
    - Logs out user immediately if account is deactivated
    - Logs out user immediately if client/staff is disabled
    - Redirects to appropriate page based on context
    
    Enforces:
    - User.is_active must be True
    - For client users: Client.status must be 'active'
    - For client_staff: Client.status must be 'active' and staff user must be active
    
    Prefix-aware: On the panel subdomain (where SubdomainRoutingMiddleware
    strips the /panel/ prefix), paths arrive without the prefix. On local
    dev, paths retain the /panel/ prefix. This middleware handles both.
    """
    
    # URL suffixes that are exempt from permission checking (prefix is prepended)
    EXEMPT_SUFFIXES = [
        'auth/login/',
        'auth/logout/',
        'auth/password-reset/',
        'api/auth/',
        'inactive/',
        'maintenance/',
    ]
    
    # Paths that are always exempt regardless of prefix
    ALWAYS_EXEMPT = [
        '/static/',
        '/media/',
        '/admin/',
        '/favicon.ico',
        '/api/health/',
        '/robots.txt',
    ]
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    @staticmethod
    def _panel_prefix(request):
        """Return the panel URL prefix: '' on panel subdomain, '/panel' on local dev."""
        if getattr(request, '_is_panel_subdomain', False):
            return ''
        return '/panel'
    
    @staticmethod
    def _is_panel_path(request):
        """Check if the current request is a panel route."""
        if getattr(request, '_is_panel_subdomain', False):
            # On the panel subdomain, all paths are panel paths
            # (SubdomainRoutingMiddleware already stripped /panel/ prefix)
            return True
        return request.path.startswith('/panel/')
    
    def __call__(self, request):
        # Skip for exempt URLs
        if self._is_exempt_url(request):
            return self.get_response(request)
        
        # Safety net: redirect unauthenticated users away from panel routes
        if not request.user.is_authenticated:
            if self._is_panel_path(request):
                from urllib.parse import quote
                prefix = self._panel_prefix(request)
                # Preserve the original URL in ?next= so user returns here after login
                next_url = request.get_full_path()
                return redirect(f'{prefix}/auth/login/?next={quote(next_url, safe="/")}')
            return self.get_response(request)
        
        # Re-fetch user from database to get latest state
        # This catches changes made by admin while user is logged in
        validation_result = self._validate_user_access(request)
        
        if validation_result is not None:
            return validation_result
        
        # Mark successful validation timestamp in session
        request.session['_pvm_last_check'] = time.time()
        
        # Annotate request with role-based scope (merged from RoleScopingMiddleware)
        self._annotate_request_scope(request)
        
        return self.get_response(request)
    
    def _is_exempt_url(self, request):
        """Check if URL is exempt from permission validation."""
        path = request.path
        
        # Always-exempt paths (static, media, admin, etc.)
        for exempt in self.ALWAYS_EXEMPT:
            if path.startswith(exempt):
                return True
        
        # Panel-specific exempt paths (with correct prefix)
        prefix = self._panel_prefix(request)
        for suffix in self.EXEMPT_SUFFIXES:
            if path.startswith(f'{prefix}/{suffix}'):
                return True
        
        # On local dev: public website pages (not under /panel/) don't need auth
        if not getattr(request, '_is_panel_subdomain', False):
            if not path.startswith('/panel/') and not path.startswith('/api/'):
                return True
        
        return False
    # How often (seconds) to re-validate user from DB.
    # Between checks, the cached validation in the session is trusted.
    # Set to 0 to check every request (original behavior).
    REVALIDATION_INTERVAL = 60  # seconds (P2: raised from 10 → 60 to reduce DB load)
    
    def _validate_user_access(self, request):
        """
        Validate user's access.
        
        Performance: caches the last-check timestamp in session so we only
        hit the DB once every REVALIDATION_INTERVAL seconds instead of on
        every single request.
        
        Returns:
            None if access is valid
            HttpResponse if access should be denied (redirect/logout)
        """
        from core.models import User
        
        user = request.user
        
        # Skip DB re-fetch if we validated recently (within REVALIDATION_INTERVAL)
        if self.REVALIDATION_INTERVAL > 0:
            last_check = request.session.get('_pvm_last_check', 0)
            if (time.time() - last_check) < self.REVALIDATION_INTERVAL:
                return None
        
        # Cache the fresh user on the request object to avoid duplicate DB hits
        # within the same request cycle (e.g., RoleScopingMiddleware also accesses user)
        _cache_attr = '_pvm_fresh_user'
        fresh_user = getattr(request, _cache_attr, None)
        
        if fresh_user is None:
            try:
                # Re-fetch from DB with related profiles in one query.
                # select_related('staff_profile', 'client_profile') means the
                # context processor and PermissionService.get_profile() calls
                # that happen later in the same request (template rendering)
                # will find the profiles already cached on the user object —
                # no additional DB queries needed.
                fresh_user = (
                    User.objects
                    .select_related('staff_profile', 'client_profile')
                    .get(pk=user.pk)
                )
                setattr(request, _cache_attr, fresh_user)
            except User.DoesNotExist:
                # User was deleted - force logout
                logger.warning(
                    "PermissionValidationMiddleware: User %s (ID: %d) no longer exists - forcing logout",
                    user.username, user.pk
                )
                return self._force_logout(request, 'Your account has been removed.')
            except Exception as exc:
                # Transient DB error (e.g. SQLite locked) — treat as valid and
                # let the request through so the page still loads.  The next
                # request will retry the DB check.
                logger.warning(
                    "PermissionValidationMiddleware: DB error re-fetching user %s — skipping check: %s",
                    getattr(user, 'username', '?'), exc,
                )
                return None
        
        # Check if user is still active
        if not fresh_user.is_active:
            logger.warning(
                "PermissionValidationMiddleware: User %s (ID: %d) is now inactive - forcing logout",
                user.username, user.pk
            )
            return self._force_logout(request, 'Your account has been deactivated.')
        
        # Role-specific validation
        if fresh_user.role == 'client':
            return self._validate_client_access(request, fresh_user)
        elif fresh_user.role == 'client_staff':
            return self._validate_client_staff_access(request, fresh_user)
        
        # super_admin, pro_user and admin_staff pass through
        return None
    
    def _validate_client_access(self, request, user):
        """Validate client user access"""
        from client.models import Client
        
        try:
            client = Client.objects.get(user=user)
        except Client.DoesNotExist:
            logger.warning(
                "PermissionValidationMiddleware: Client profile not found for user %s - forcing logout",
                user.username
            )
            return self._force_logout(request, 'Your client profile is not configured.')
        except Exception as exc:
            logger.warning(
                "PermissionValidationMiddleware: DB error fetching client for user %s — skipping check: %s",
                getattr(user, 'username', '?'), exc,
            )
            return None
        
        # Check if client is still active
        if client.status != 'active':
            logger.warning(
                "PermissionValidationMiddleware: Client '%s' (ID: %s) is now %s - redirecting to maintenance for user %s",
                client.name, client.pk, client.status, user.username
            )
            return self._redirect_to_maintenance(request, 'Your organization account has been suspended.')
        
        # Store client_id in session for reassignment detection
        session_client_id = request.session.get('_client_id')
        if session_client_id is None:
            request.session['_client_id'] = client.pk
        elif session_client_id != client.pk:
            # Client was reassigned (edge case) - force re-login
            logger.warning(
                "PermissionValidationMiddleware: Client reassigned from %s to %s for user %s - forcing logout",
                session_client_id, client.pk, user.username
            )
            return self._force_logout(request, 'Your account configuration has changed. Please log in again.')
        
        return None
    
    def _validate_client_staff_access(self, request, user):
        """Validate client staff user access"""
        from staff.models import Staff
        from client.models import Client
        
        try:
            staff = Staff.objects.select_related('client').get(user=user)
        except Staff.DoesNotExist:
            logger.warning(
                "PermissionValidationMiddleware: Staff profile not found for user %s - forcing logout",
                user.username
            )
            return self._force_logout(request, 'Your staff profile is not configured.')
        except Exception as exc:
            logger.warning(
                "PermissionValidationMiddleware: DB error fetching staff for user %s — skipping check: %s",
                getattr(user, 'username', '?'), exc,
            )
            return None
        
        # Check if staff has no client assigned
        if not staff.client:
            logger.warning(
                "PermissionValidationMiddleware: Staff %s has no client assigned - forcing logout",
                user.username
            )
            return self._force_logout(request, 'You are not assigned to any client.')
        
        # Check if staff's client is still active
        if staff.client.status != 'active':
            logger.warning(
                "PermissionValidationMiddleware: Client '%s' (ID: %s) is now %s - redirecting to maintenance for staff %s",
                staff.client.name, staff.client.pk, staff.client.status, user.username
            )
            return self._redirect_to_maintenance(
                request, 
                'Your organization account has been suspended.'
            )
        
        # Detect client reassignment (edge case: admin moved staff to different client)
        session_client_id = request.session.get('_staff_client_id')
        if session_client_id is None:
            request.session['_staff_client_id'] = staff.client.pk
        elif session_client_id != staff.client.pk:
            logger.warning(
                "PermissionValidationMiddleware: Client staff reassigned from client %s to %s for user %s - forcing logout",
                session_client_id, staff.client.pk, user.username
            )
            return self._force_logout(
                request, 
                'You have been reassigned to a different organization. Please log in again.'
            )
        
        return None
    
    def _annotate_request_scope(self, request):
        """Add role-based scope attributes to request for use by views."""
        from core.services.permission_service import PermissionService
        user = request.user
        try:
            request.user_scope = {
                'is_super_admin': PermissionService.is_super_admin(user),
                'is_admin_staff': PermissionService.is_admin_staff(user),
                'is_client': PermissionService.is_client(user),
                'is_client_staff': PermissionService.is_client_staff(user),
                'client_id': None,
                'accessible_client_ids': PermissionService.get_accessible_client_ids(user),
            }

            if PermissionService.is_client(user):
                client = getattr(user, 'client_profile', None)
                if client:
                    request.user_scope['client_id'] = client.id

            elif PermissionService.is_client_staff(user):
                staff = getattr(user, 'staff_profile', None)
                if staff and staff.client:
                    request.user_scope['client_id'] = staff.client.id
        except Exception as exc:
            logger.warning(
                "PermissionValidationMiddleware: _annotate_request_scope failed for user %s — using defaults: %s",
                getattr(user, 'username', '?'), exc,
            )
            # Provide safe fallback scope so views don't crash on missing attribute
            if not hasattr(request, 'user_scope'):
                request.user_scope = {
                    'is_super_admin': False,
                    'is_admin_staff': False,
                    'is_client': False,
                    'is_client_staff': False,
                    'client_id': None,
                    'accessible_client_ids': [],
                }
    
    def _redirect_to_maintenance(self, request, message):
        """Redirect to maintenance page WITHOUT logging out.
        
        Used when a client/staff's organization is suspended.
        The user stays logged in so they can seamlessly resume
        once the account is reactivated.
        """
        from urllib.parse import quote
        
        prefix = self._panel_prefix(request)
        maintenance_url = f'{prefix}/maintenance/?reason={quote(message)}'
        
        # Check if this is an API request
        is_api_request = (
            request.headers.get('X-Requested-With') == 'XMLHttpRequest' or
            request.content_type == 'application/json' or
            '/api/' in request.path
        )
        
        if is_api_request:
            return JsonResponse({
                'success': False,
                'message': message,
                'force_maintenance': True,
                'redirect': maintenance_url
            }, status=403)
        
        # Regular page request - redirect to maintenance page
        return redirect(maintenance_url)
    
    def _force_logout(self, request, message):
        """Force logout user and redirect to inactive page"""
        from urllib.parse import quote
        # Log out the user
        logout(request)
        
        prefix = self._panel_prefix(request)
        
        # Check if this is an API request
        is_api_request = (
            request.headers.get('X-Requested-With') == 'XMLHttpRequest' or
            request.content_type == 'application/json' or
            '/api/' in request.path
        )
        
        if is_api_request:
            return JsonResponse({
                'success': False,
                'message': message,
                'force_logout': True,
                'redirect': f'{prefix}/inactive/?reason={quote(message)}'
            }, status=401)
        
        # Regular page request - redirect to inactive page
        return redirect(f'{prefix}/inactive/?reason={quote(message)}')


class RoleScopingMiddleware:
    """
    DEPRECATED: Role scoping is now merged into PermissionValidationMiddleware.
    This middleware is kept as a pass-through for backward compatibility.
    It can be safely removed from MIDDLEWARE in settings.py.
    """
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        # Role scoping is now handled by PermissionValidationMiddleware._annotate_request_scope()
        return self.get_response(request)


class MaintenanceModeMiddleware:
    """
    Blocks panel access for non-super-admin users when system maintenance
    mode is enabled via SystemSettings.

    Super-admin and pro-user roles can still access the panel.
    Static, media, auth, and maintenance-status API paths are exempt.
    """

    EXEMPT_PREFIXES = (
        '/static/',
        '/media/',
        '/favicon.ico',
        '/admin/',
    )

    # Panel-relative suffixes that are exempt (prepended with panel prefix)
    EXEMPT_SUFFIXES = (
        'auth/login/',
        'auth/logout/',
        'api/auth/',
        'api/maintenance/',
        'maintenance/',
        'maintenance/system/',
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Only intercept panel routes
        if not self._is_panel_path(request):
            return self.get_response(request)

        if self._is_exempt(request):
            return self.get_response(request)

        # Check maintenance status
        from core.services.maintenance_service import MaintenanceService
        if not MaintenanceService.is_active():
            return self.get_response(request)

        # Allow super_admin / pro_user through
        user = request.user
        if user.is_authenticated and getattr(user, 'role', '') in ('super_admin', 'pro_user'):
            return self.get_response(request)

        # Block everyone else — redirect to maintenance page
        prefix = self._panel_prefix(request)
        return redirect(f'{prefix}/maintenance/system/')

    # ── helpers ──

    @staticmethod
    def _panel_prefix(request):
        if getattr(request, '_is_panel_subdomain', False):
            return ''
        return '/panel'

    @staticmethod
    def _is_panel_path(request):
        if getattr(request, '_is_panel_subdomain', False):
            return True
        return request.path.startswith('/panel/')

    def _is_exempt(self, request):
        path = request.path
        for pfx in self.EXEMPT_PREFIXES:
            if path.startswith(pfx):
                return True
        prefix = self._panel_prefix(request)
        for sfx in self.EXEMPT_SUFFIXES:
            if path.startswith(f'{prefix}/{sfx}'):
                return True
        return False


class WebsiteOfflineMiddleware:
    """
    Intercepts all PUBLIC website requests when WebsiteStatus is 'draft'.
    
    Shows a styled offline page with a link to the admin panel login.
    Only affects public routes (the 'website' app at /).
    Admin panel, static, media, and API routes are NOT affected.
    
    On the panel subdomain (request._is_panel_subdomain), all requests
    bypass this middleware since there are no public website pages.
    """

    # Paths that should NEVER be blocked (admin panel, static, media, etc.)
    BYPASS_PREFIXES = (
        '/panel/',
        '/panel-entry/',
        '/admin/',
        '/static/',
        '/media/',
        '/favicon.ico',
        '/robots.txt',
        '/sitemap.xml',
        '/api/',
        '/app/',
        '/manifest.json',
        '/sw.js',
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Panel subdomain has no public website routes — skip entirely
        if getattr(request, '_is_panel_subdomain', False):
            return self.get_response(request)

        # Only intercept public-facing website routes
        if self._is_public_website_route(request.path):
            from website.models import WebsiteStatus
            from core.models import SystemSettings
            from django.core.cache import cache
            from django.http import Http404

            # Cache status for 10 seconds to avoid DB hit on every request
            status = cache.get('website_status_cache')
            if status is None:
                status = WebsiteStatus.get_status()
                cache.set('website_status_cache', status, 10)

            not_found_mode = cache.get('website_not_found_mode_cache')
            if not_found_mode is None:
                not_found_mode = SystemSettings.get_value('website_not_found_mode', 'false') == 'true'
                cache.set('website_not_found_mode_cache', not_found_mode, 10)

            if not_found_mode:
                raise Http404('Not found')

            if status == 'draft':
                from django.shortcuts import render
                from website.models import BusinessDetails
                business = BusinessDetails.objects.first()
                return render(request, 'website/offline.html', {
                    'site_name': business.site_name if business else 'Adarsh ID Cards',
                }, status=503)

        return self.get_response(request)

    def _is_public_website_route(self, path):
        """Return True if the path is a public website route (not admin/static/media)."""
        for prefix in self.BYPASS_PREFIXES:
            if path.startswith(prefix):
                return False
        return True


class SessionIdleTimeoutMiddleware:
    """
    Enforces two session expiry policies for authenticated users:

    1. IDLE timeout (SESSION_IDLE_TIMEOUT): logs out after N seconds with no requests.
       Default: 30 days. Set to 0 to disable.

    2. ABSOLUTE max-age (SESSION_ABSOLUTE_MAX_AGE): logs out after N seconds from
       first login regardless of activity — prevents indefinitely-valid stolen tokens.
       Default: 90 days. Set to 0 to disable.
    """

    SKIP_PREFIXES = ('/static/', '/media/', '/favicon.ico')

    def __init__(self, get_response):
        self.get_response = get_response
        self._timeout = getattr(django_settings, 'SESSION_IDLE_TIMEOUT', 1800)
        self._max_age = getattr(django_settings, 'SESSION_ABSOLUTE_MAX_AGE', 60 * 60 * 24 * 90)

    def _force_logout(self, request, reason):
        """Log user out and redirect to login with a consistent response."""
        username = getattr(request.user, 'username', 'unknown')
        logger.info("SessionExpiry: user=%s reason=%s", username, reason)
        logout(request)

        prefix = '' if getattr(request, '_is_panel_subdomain', False) else '/panel'
        login_url = f'{prefix}/auth/login/'

        is_ajax = (
            request.headers.get('X-Requested-With') == 'XMLHttpRequest'
            or request.headers.get('HX-Request') == 'true'
            or request.content_type == 'application/json'
        )
        if is_ajax:
            return JsonResponse({
                'success': False,
                'message': 'Session expired. Please log in again.',
                'redirect': login_url,
            }, status=401)
        return redirect(login_url)

    def __call__(self, request):
        # Skip for static/media and unauthenticated users
        if any(request.path.startswith(p) for p in self.SKIP_PREFIXES):
            return self.get_response(request)

        if not hasattr(request, 'user') or not request.user.is_authenticated:
            return self.get_response(request)

        now = time.time()

        # ── Policy 1: Idle timeout ────────────────────────────────────────────
        if self._timeout > 0:
            last_activity = request.session.get('_last_activity')
            if last_activity is not None and (now - last_activity) > self._timeout:
                return self._force_logout(request, reason='idle')

        # ── Policy 2: Absolute max-age ────────────────────────────────────────
        if self._max_age > 0:
            session_created = request.session.get('_session_created')
            if session_created is not None and (now - session_created) > self._max_age:
                return self._force_logout(request, reason='absolute_max_age')

        # Stamp session on first authenticated use (for absolute max-age tracking)
        if '_session_created' not in request.session:
            request.session['_session_created'] = now

        # Update last-activity timestamp (for idle timeout tracking)
        request.session['_last_activity'] = now

        return self.get_response(request)


class SecurityHeadersMiddleware:
    """
    Adds extra security headers that Django's SecurityMiddleware does not cover.

    Adds:
    - Content-Security-Policy: restricts resource origins, blocks object/plugin injection
    - Permissions-Policy: restricts browser APIs (camera, microphone, etc.)
    - Cache-Control: prevents caching of authenticated HTML pages
    - X-Robots-Tag: noindex on panel subdomain (SEO isolation)
    """

    SKIP_PREFIXES = ('/static/', '/media/')

    # CSP for the panel / admin pages:
    # - 'unsafe-inline' required: HTMX hx-* attributes and Django template inline scripts
    # - 'unsafe-eval' required: Alpine.js evaluates x-data/x-show/x-text/x-bind expressions
    #   via new Function() which needs eval permission (confirmed via browser console CSP errors)
    # - img-src data:/blob: required: image previews and canvas operations
    # - font-src data: required: some icon fonts are base64-embedded
    # Strict protections still enforced:
    # - object-src 'none'    → blocks Flash/plugins entirely
    # - base-uri 'self'      → prevents <base href> injection attacks
    # - form-action 'self'   → prevents forms being hijacked to external targets
    # - frame-ancestors 'none' → belt-and-suspenders with X-Frame-Options: DENY
    _CSP_PANEL = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self' http://127.0.0.1:4765; "  # 127.0.0.1:4765 = local Face Cropper engine
        "media-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none';"
    )

    # CSP for the mobile PWA (/app/) which loads Tailwind CDN, Alpine.js,
    # Cropper.js, Google Fonts, and Font Awesome from CDNs.
    # 'unsafe-eval' required by Tailwind CSS Play CDN (runtime compiler).
    _CSP_PWA = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' "
            "https://cdn.tailwindcss.com "
            "https://cdn.jsdelivr.net "
            "https://cdnjs.cloudflare.com "
            "https://static.cloudflareinsights.com; "
        "style-src 'self' 'unsafe-inline' "
            "https://cdnjs.cloudflare.com "
            "https://fonts.googleapis.com "
            "https://cdn.tailwindcss.com; "
        "img-src 'self' data: blob: https:; "
        "font-src 'self' data: "
            "https://cdnjs.cloudflare.com "
            "https://fonts.gstatic.com; "
        "connect-src 'self' http://127.0.0.1:4765; "  # 127.0.0.1:4765 = local Face Cropper engine
        "media-src 'self' blob:; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none';"
    )

    def __init__(self, get_response):
        self.get_response = get_response
        self._permissions_policy = getattr(
            django_settings, 'PERMISSIONS_POLICY',
            'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
        )
        self._panel_domain = getattr(django_settings, 'PANEL_DOMAIN', '').lower().strip()

    def __call__(self, request):
        response = self.get_response(request)

        # Skip for static/media (served by WhiteNoise which handles its own headers)
        if any(request.path.startswith(p) for p in self.SKIP_PREFIXES):
            return response

        # Content-Security-Policy
        # Only apply to HTML responses (skip JSON API responses)
        content_type = response.get('Content-Type', '')
        if 'text/html' in content_type and 'Content-Security-Policy' not in response:
            is_pwa = request.path.startswith('/app/')
            response['Content-Security-Policy'] = self._CSP_PWA if is_pwa else self._CSP_PANEL

        if self._permissions_policy:
            # Mobile PWA needs camera access for photo capture
            if request.path.startswith('/app/'):
                response['Permissions-Policy'] = (
                    'camera=(self), microphone=(), geolocation=(), '
                    'payment=(), usb=()'
                )
            else:
                response['Permissions-Policy'] = self._permissions_policy

        # Prevent caching of authenticated panel pages (security best practice)
        is_panel = getattr(request, '_is_panel_subdomain', False) or request.path.startswith('/panel/')
        if is_panel and hasattr(request, 'user') and request.user.is_authenticated:
            if 'Cache-Control' not in response:
                response['Cache-Control'] = 'no-store, no-cache, must-revalidate, private'
                response['Pragma'] = 'no-cache'

        # SEO: block indexing on the panel subdomain (belt-and-suspenders with robots.txt)
        if self._panel_domain:
            host = request.get_host().split(':')[0].lower()
            if host == self._panel_domain:
                response['X-Robots-Tag'] = 'noindex, nofollow'

        return response
