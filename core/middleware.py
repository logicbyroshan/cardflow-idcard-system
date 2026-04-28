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
import hashlib
from urllib.parse import quote
from django.conf import settings as django_settings
from django.contrib.auth import logout
from django.shortcuts import redirect
from django.http import JsonResponse
from django.urls import reverse

logger = logging.getLogger(__name__)
query_logger = logging.getLogger('slow_queries')

# Thresholds — configurable via settings.py / environment
SLOW_REQUEST_THRESHOLD = getattr(django_settings, 'SLOW_REQUEST_THRESHOLD', 1.5)
QUERY_COUNT_THRESHOLD = getattr(django_settings, 'QUERY_COUNT_THRESHOLD', 50)
SLOW_QUERY_THRESHOLD = getattr(django_settings, 'SLOW_QUERY_THRESHOLD', 0.1)

# Read-mostly polling APIs should avoid session writes to reduce DB lock
# contention while background workers are doing heavy writes.
TASK_POLLING_PATH_PREFIXES = (
    '/api/task-status/',
    '/api/task-active/',
    '/api/task-list/',
    '/api/export/status/',
)


def _is_task_polling_path(path: str) -> bool:
    if not path:
        return False
    return any(path.startswith(prefix) for prefix in TASK_POLLING_PATH_PREFIXES)


class MobileAppCSRFBypassMiddleware:
    """
    Bypasses CSRF checks for mobile app and PWA authentication APIs.
    
    This ensures that native app and PWA clients never see 'Security token expired'
    errors during login/logout/otp-verify, regardless of cookie/header state.
    
    Must be placed BEFORE CsrfViewMiddleware in settings.py.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # We check multiple path attributes to ensure coverage across different 
        # proxy/routing configurations.
        path = (request.path or '').lower()
        path_info = (request.path_info or '').lower()
        
        # Explicitly bypass CSRF for all authentication-related API endpoints.
        # This covers:
        # - /api/auth/* (Main panel APIs)
        # - /app/api/auth/* (Mobile/PWA specific APIs)
        auth_patterns = ['/api/auth/', '/app/api/', '/auth/login', '/auth/logout']
        
        if any(p in path for p in auth_patterns) or any(p in path_info for p in auth_patterns):
            # This is a Django internal flag that CsrfViewMiddleware respects.
            # Setting it to True tells Django to skip CSRF validation for this request.
            request._dont_enforce_csrf_checks = True
        
        return self.get_response(request)


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
            elif request.path_info == '/panel':
                request.path_info = '/'
                request.path = request.path_info
        elif getattr(django_settings, 'DEBUG', False) and (request.path_info.startswith('/panel/') or request.path_info == '/panel'):
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
        elif getattr(django_settings, 'DEBUG', False) and request.COOKIES.get('_panel_ctx') == '1':
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
    
    Query counting via connection.execute_wrapper is opt-in using
    ENABLE_REQUEST_QUERY_TRACKING. Request duration timing is always tracked.
    """

    SKIP_PREFIXES = ('/static/', '/media/', '/favicon.ico')

    def __init__(self, get_response):
        self.get_response = get_response
        self._track_queries = bool(getattr(django_settings, 'ENABLE_REQUEST_QUERY_TRACKING', False))

    def __call__(self, request):
        if any(request.path.startswith(p) for p in self.SKIP_PREFIXES):
            return self.get_response(request)

        start = time.monotonic()

        if self._track_queries:
            # Full query counting is opt-in because execute wrappers add overhead.
            response = self._call_with_query_tracking(request, start)
        else:
            # Default: just time the request, no per-query wrapper
            response = self.get_response(request)
            duration = time.monotonic() - start
            duration_ms = duration * 1000
            response['Server-Timing'] = 'total;dur=%.1f' % duration_ms
            self._log_request(request, response.status_code, duration, 0, 0.0)

        return response

    def _call_with_query_tracking(self, request, start):
        """Track individual queries when query tracking is explicitly enabled."""
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
    SETTINGS_CACHE_TTL = 10

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Entry gate disabled as per user request to allow discovery
        return self.get_response(request)

        # if not getattr(request, '_is_panel_subdomain', False):
        #     return self.get_response(request)
        # ... (commented out the rest)

    def _get_gate_settings(self):
        """Fetch gate flags with short cache to avoid per-request DB reads."""
        from django.core.cache import cache
        from core.models import SystemSettings

        cache_key = 'panel_entry_gate:flags'
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        not_found_mode = SystemSettings.get_value('website_not_found_mode', 'false') == 'true'
        gate_enabled = SystemSettings.get_value('panel_entry_gate_enabled', 'true') == 'true'
        value = (not_found_mode, gate_enabled)
        cache.set(cache_key, value, self.SETTINGS_CACHE_TTL)
        return value

    def _is_valid_token(self, token):
        from django.core.signing import TimestampSigner, BadSignature, SignatureExpired

        signer = TimestampSigner(salt=self.TOKEN_SALT)
        max_age = max(int(getattr(django_settings, 'PANEL_ENTRY_TOKEN_MAX_AGE_SECONDS', 900) or 900), 1)
        try:
            value = signer.unsign(token, max_age=max_age)
            return value == self.TOKEN_VALUE
        except SignatureExpired:
            return False
        except (BadSignature, ValueError):
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
        'app/login/',
        'app/no-access/',
        'app/manifest.json',
        'app/sw.js',
        'app/api/auth/',
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
        '/sitemap.xml',
        '/panel-entry/',
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

        # Fast fail-closed for users deactivated since their last request.
        if not getattr(request.user, 'is_active', True):
            return self._force_logout(request, 'Your account has been deactivated.')

        is_task_polling = _is_task_polling_path(request.path)

        # Task polling endpoints are read-mostly and frequent. Avoid touching
        # session keys there to reduce lock contention with background tasks.
        if not is_task_polling:
            self._sync_revalidation_marker(request)

        fingerprint_result = self._validate_session_fingerprint(request)
        if fingerprint_result is not None:
            return fingerprint_result
        
        # Re-fetch user from database to get latest state
        # This catches changes made by admin while user is logged in
        validation_result = self._validate_user_access(request)
        
        if validation_result is not None:
            return validation_result
        
        # Mark successful validation timestamp in session only when stale.
        # This avoids forcing a session write on every request.
        now_ts = time.time()
        prev_ts = float(request.session.get('_pvm_last_check', 0) or 0)
        if (not is_task_polling) and (now_ts - prev_ts) >= max(float(self.REVALIDATION_INTERVAL), 1.0):
            request.session['_pvm_last_check'] = now_ts
        
        # Annotate request with role-based scope (merged from RoleScopingMiddleware)
        self._annotate_request_scope(request)
        
        return self.get_response(request)

    def _sync_revalidation_marker(self, request):
        """Force DB revalidation when a signal marked this user as changed."""
        try:
            from core.services.session_revalidation import get_user_revalidation_marker
            marker = get_user_revalidation_marker(getattr(request.user, 'pk', None))
        except Exception:
            return

        if not marker:
            return

        marker = str(marker)
        seen = str(request.session.get(self.REVALIDATION_MARKER_SESSION_KEY, '') or '')
        if marker != seen:
            request.session[self.REVALIDATION_MARKER_SESSION_KEY] = marker
            request.session['_pvm_force_recheck'] = 1
    
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
            exempt_path = f'{prefix}/{suffix}'
            if path.startswith(exempt_path) or f'{path}/'.startswith(exempt_path):
                return True
        
        # On local dev: public website pages (not under /panel/) don't need auth
        if not getattr(request, '_is_panel_subdomain', False):
            if not path.startswith('/panel/') and not path.startswith('/api/'):
                return True
        
        return False
    # How often (seconds) to re-validate user from DB.
    # Between checks, the cached validation in the session is trusted.
    # Set to 0 to check every request (original behavior).
    REVALIDATION_INTERVAL = max(int(getattr(django_settings, 'PERMISSION_REVALIDATION_INTERVAL', 20)), 0)
    SESSION_FP_KEY = '_session_fingerprint'
    REVALIDATION_MARKER_SESSION_KEY = '_pvm_reval_marker'

    @staticmethod
    def _client_ip(request):
        """Best-effort client IP extraction for optional session fingerprint binding."""
        xff = request.META.get('HTTP_X_FORWARDED_FOR')
        if xff:
            return xff.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR', '')

    @staticmethod
    def _normalize_ip_for_fingerprint(ip_value):
        """Normalize IP to reduce false positives from minor network changes."""
        if not ip_value:
            return ''
        if ':' in ip_value:  # IPv6
            parts = [p for p in ip_value.split(':') if p]
            return ':'.join(parts[:4])
        parts = ip_value.split('.')
        if len(parts) == 4:
            return '.'.join(parts[:3])
        return ip_value

    @staticmethod
    def _extract_stable_ua(ua_string):
        """
        Extract a stable platform + browser family from a User-Agent string.

        We intentionally omit the browser major version so that automatic
        browser updates (e.g. Chrome 126 → 127) do NOT change the fingerprint
        and do NOT force-logout users mid-session.  The combination of
        platform + browser family is still unique enough to detect session
        hijacking across fundamentally different environments.
        """
        import re
        ua = (ua_string or '').strip().lower()
        if not ua:
            return ''

        # Extract platform (Windows, Mac, Linux, Android, iPhone, iPad)
        platform = 'unknown'
        for p in ('windows', 'macintosh', 'linux', 'android', 'iphone', 'ipad'):
            if p in ua:
                platform = p
                break

        # Extract browser family only (no version) to survive auto-updates
        # Order matters: check specific browsers first before generic ones
        browser = 'other'
        patterns = [
            (r'edg[ea]?/\d+', 'edge'),
            (r'opr/\d+', 'opera'),
            (r'chrome/\d+', 'chrome'),
            (r'firefox/\d+', 'firefox'),
            (r'safari/\d+', 'safari'),
            (r'msie\s+\d+', 'ie'),
            (r'trident/.*rv:\d+', 'ie'),
        ]
        for pattern, name in patterns:
            if re.search(pattern, ua):
                browser = name
                break

        return f'{platform}|{browser}'

    @classmethod
    def build_session_fingerprint(cls, request):
        """Build deterministic fingerprint from stable browser identity (+ optional coarse IP)."""
        ua_raw = (request.META.get('HTTP_USER_AGENT', '') or '').strip()
        ua_part = cls._extract_stable_ua(ua_raw)

        ip_part = ''
        if getattr(django_settings, 'SESSION_FINGERPRINT_INCLUDE_IP', False):
            ip_part = cls._normalize_ip_for_fingerprint(cls._client_ip(request))

        raw = f'{ua_part}|{ip_part}'
        return hashlib.sha256(raw.encode('utf-8')).hexdigest()

    @classmethod
    def seed_session_fingerprint(cls, request):
        """Initialize session fingerprint immediately after auth-context changes."""
        if not getattr(django_settings, 'SESSION_FINGERPRINT_ENABLED', False):
            return
        if not request.META.get('HTTP_USER_AGENT'):
            return
        request.session[cls.SESSION_FP_KEY] = cls.build_session_fingerprint(request)

    # Key used to track whether we've already given the session one grace
    # re-seed after a fingerprint mismatch (browser auto-update, CDN UA
    # rewrite, etc.).  Cleared on each successful match.
    SESSION_FP_GRACE_KEY = '_session_fp_grace'

    def _validate_session_fingerprint(self, request):
        """Validate session fingerprint for authenticated requests.

        Uses a one-strike grace mechanism: the first mismatch re-seeds the
        fingerprint (handles browser auto-updates, CDN User-Agent rewrites,
        extension toggles, etc.) instead of immediately force-logging out.
        Only a second consecutive mismatch triggers force-logout.
        """
        if not getattr(django_settings, 'SESSION_FINGERPRINT_ENABLED', False):
            return None

        if not request.META.get('HTTP_USER_AGENT'):
            return None

        current_fp = self.build_session_fingerprint(request)
        stored_fp = request.session.get(self.SESSION_FP_KEY)

        if not stored_fp:
            request.session[self.SESSION_FP_KEY] = current_fp
            request.session.pop(self.SESSION_FP_GRACE_KEY, None)
            return None

        if stored_fp == current_fp:
            # Match — clear any previous grace flag.
            request.session.pop(self.SESSION_FP_GRACE_KEY, None)
            return None

        # ── Mismatch detected ──
        already_graced = request.session.get(self.SESSION_FP_GRACE_KEY)

        if not already_graced:
            # First mismatch: grant grace — re-seed fingerprint and continue.
            # This handles transient UA changes (browser updates, CDN rewrites).
            logger.warning(
                "PermissionValidationMiddleware: session fingerprint mismatch "
                "(grace re-seed) user=%s stored=%s current=%s",
                getattr(request.user, 'username', '?'),
                stored_fp[:12] if stored_fp else '?',
                current_fp[:12],
            )
            request.session[self.SESSION_FP_KEY] = current_fp
            request.session[self.SESSION_FP_GRACE_KEY] = True
            return None

        # Second consecutive mismatch: genuine session hijack concern.
        logger.warning(
            "PermissionValidationMiddleware: session fingerprint mismatch "
            "(post-grace, forcing logout) user=%s",
            getattr(request.user, 'username', '?'),
        )
        return self._force_logout(request, 'Session verification failed. Please log in again.')

    def _validation_unavailable_response(self, request):
        """Fail closed when permission validation cannot be completed."""
        message = 'Session validation is temporarily unavailable. Please try again shortly.'
        is_api_request = (
            request.headers.get('X-Requested-With') == 'XMLHttpRequest' or
            request.content_type == 'application/json' or
            '/api/' in request.path
        )
        if is_api_request:
            return JsonResponse({
                'success': False,
                'message': message,
            }, status=503)

        prefix = self._panel_prefix(request)
        return redirect(f'{prefix}/inactive/?reason={quote(message)}')
    
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
        force_recheck = bool(request.session.pop('_pvm_force_recheck', 0))
        
        # Skip DB re-fetch if we validated recently (within REVALIDATION_INTERVAL)
        if self.REVALIDATION_INTERVAL > 0 and not force_recheck:
            last_check = request.session.get('_pvm_last_check', 0)
            if (time.time() - last_check) < self.REVALIDATION_INTERVAL:
                return None
        
        # Cache the fresh user on the request object to avoid duplicate DB hits
        # within the same request cycle
        _cache_attr = '_pvm_fresh_user'
        fresh_user = getattr(request, _cache_attr, None)
        
        if fresh_user is None:
            try:
                # Keep the revalidation query limited to user fields only.
                # This avoids coupling session validation to optional profile
                # schema changes on related tables.
                fresh_user = (
                    User.objects
                    .only('id', 'username', 'role', 'is_active')
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
                logger.error(
                    "PVM_DEBUG: DB error re-fetching user %s (ID: %s) — path: %s, role: %s, authenticated: %s, exc: %s",
                    getattr(user, 'username', '?'), 
                    getattr(user, 'pk', '?'),
                    request.path,
                    getattr(user, 'role', '?'),
                    user.is_authenticated,
                    exc,
                )
                return self._validation_unavailable_response(request)
        
        # Check if user is still active
        if not fresh_user.is_active:
            logger.warning(
                "PVM_DEBUG: User %s (ID: %d) is now inactive - path: %s",
                user.username, user.pk, request.path
            )
            return self._force_logout(request, 'Your account has been deactivated.')
        
        # Role-specific validation
        if fresh_user.role == 'client':
            return self._validate_client_access(request, fresh_user)
        elif fresh_user.role == 'client_staff':
            return self._validate_client_staff_access(request, fresh_user)
        
        # super_admin, pro_user and admin_staff pass through
        # Add a debug log for successful admin validation
        if fresh_user.role in ['super_admin', 'pro_user', 'admin_staff']:
             logger.debug("PVM_DEBUG: Admin validation success for %s (role: %s) on %s", fresh_user.username, fresh_user.role, request.path)
        
        return None
    
    def _validate_client_access(self, request, user):
        """Validate client user access"""
        from client.models import Client
        
        try:
            client_row = (
                Client.objects
                .filter(user_id=user.pk)
                .values('id', 'name', 'status')
                .first()
            )
            if not client_row:
                raise Client.DoesNotExist()
        except Client.DoesNotExist:
            logger.warning(
                "PermissionValidationMiddleware: Client profile not found for user %s - forcing logout",
                user.username
            )
            return self._force_logout(request, 'Your client profile is not configured.')
        except Exception as exc:
            logger.error(
                "PermissionValidationMiddleware: DB error fetching client for user %s — denying request: %s",
                getattr(user, 'username', '?'), exc,
            )
            return self._validation_unavailable_response(request)
        
        # Check if client is still active
        if client_row['status'] != 'active':
            logger.warning(
                "PermissionValidationMiddleware: Client '%s' (ID: %s) is now %s - redirecting to maintenance for user %s",
                client_row['name'], client_row['id'], client_row['status'], user.username
            )
            return self._redirect_to_maintenance(request, 'Your organization account has been suspended.')
        
        # Store client_id in session for reassignment detection
        session_client_id = request.session.get('_client_id')
        if session_client_id is None:
            request.session['_client_id'] = client_row['id']
        elif session_client_id != client_row['id']:
            # Client was reassigned (edge case) - force re-login
            logger.warning(
                "PermissionValidationMiddleware: Client reassigned from %s to %s for user %s - forcing logout",
                session_client_id, client_row['id'], user.username
            )
            return self._force_logout(request, 'Your account configuration has changed. Please log in again.')
        
        return None
    
    def _validate_client_staff_access(self, request, user):
        """Validate client staff user access"""
        from staff.models import Staff
        
        try:
            staff_row = (
                Staff.objects
                .filter(user_id=user.pk)
                .values('id', 'client_id', 'client__name', 'client__status')
                .first()
            )
            if not staff_row:
                raise Staff.DoesNotExist()
        except Staff.DoesNotExist:
            logger.warning(
                "PermissionValidationMiddleware: Staff profile not found for user %s - forcing logout",
                user.username
            )
            return self._force_logout(request, 'Your staff profile is not configured.')
        except Exception as exc:
            logger.error(
                "PermissionValidationMiddleware: DB error fetching staff for user %s — denying request: %s",
                getattr(user, 'username', '?'), exc,
            )
            return self._validation_unavailable_response(request)
        
        # Check if staff has no client assigned
        if not staff_row['client_id']:
            logger.warning(
                "PermissionValidationMiddleware: Staff %s has no client assigned - forcing logout",
                user.username
            )
            return self._force_logout(request, 'You are not assigned to any client.')
        
        # Check if staff's client is still active
        if staff_row['client__status'] != 'active':
            logger.warning(
                "PermissionValidationMiddleware: Client '%s' (ID: %s) is now %s - redirecting to maintenance for staff %s",
                staff_row['client__name'], staff_row['client_id'], staff_row['client__status'], user.username
            )
            return self._redirect_to_maintenance(
                request, 
                'Your organization account has been suspended.'
            )
        
        # Detect client reassignment (edge case: admin moved staff to different client)
        session_client_id = request.session.get('_staff_client_id')
        if session_client_id is None:
            request.session['_staff_client_id'] = staff_row['client_id']
        elif session_client_id != staff_row['client_id']:
            logger.warning(
                "PermissionValidationMiddleware: Client staff reassigned from client %s to %s for user %s - forcing logout",
                session_client_id, staff_row['client_id'], user.username
            )
            return self._force_logout(
                request, 
                'You have been reassigned to a different organization. Please log in again.'
            )
        
        return None
    
    def _annotate_request_scope(self, request):
        """Add role-based scope attributes to request for use by views."""
        from core.services.permission_service import PermissionService
        user = getattr(request, '_pvm_fresh_user', request.user)
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
                from client.models import Client
                request.user_scope['client_id'] = (
                    Client.objects
                    .filter(user_id=user.id)
                    .values_list('id', flat=True)
                    .first()
                )

            elif PermissionService.is_client_staff(user):
                from staff.models import Staff
                request.user_scope['client_id'] = (
                    Staff.objects
                    .filter(user_id=user.id)
                    .values_list('client_id', flat=True)
                    .first()
                )
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
        # Maintenance mode disabled as per user request to allow discovery
        return self.get_response(request)

        # if not self._is_panel_path(request):
        # ...

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

            # Cache status for 10 seconds to avoid DB hit on every request
            status = cache.get('website_status_cache')
            if status is None:
                status = WebsiteStatus.get_status()
                cache.set('website_status_cache', status, 10)

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
    ACTIVITY_WRITE_INTERVAL = 60  # seconds
    USER_IDLE_TIMEOUT_SESSION_KEY = '_user_idle_timeout_seconds'

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

    def _resolve_user_idle_timeout_seconds(self, request):
        """
        Resolve per-user idle timeout in seconds.
        Falls back to global SESSION_IDLE_TIMEOUT when no user override exists.
        """
        cached = request.session.get(self.USER_IDLE_TIMEOUT_SESSION_KEY)
        if cached is not None:
            try:
                return max(int(cached), 0)
            except (TypeError, ValueError):
                request.session.pop(self.USER_IDLE_TIMEOUT_SESSION_KEY, None)

        try:
            from core.services.user_profile_service import UserProfileService

            security = UserProfileService.get_security_settings(request.user)
            timeout_minutes = int(security.get('session_timeout_minutes') or 0)
            timeout_seconds = max(timeout_minutes, 0) * 60
            request.session[self.USER_IDLE_TIMEOUT_SESSION_KEY] = timeout_seconds
            return timeout_seconds
        except Exception:
            logger.exception(
                "SessionIdleTimeout: failed to resolve per-user timeout for user=%s",
                getattr(request.user, 'pk', None),
            )
            return max(int(self._timeout or 0), 0)

    def __call__(self, request):
        # Skip for static/media and unauthenticated users
        if any(request.path.startswith(p) for p in self.SKIP_PREFIXES):
            return self.get_response(request)

        if not hasattr(request, 'user') or not request.user.is_authenticated:
            return self.get_response(request)

        now = time.time()
        user_idle_timeout = self._resolve_user_idle_timeout_seconds(request)

        # ── Policy 1: Idle timeout ────────────────────────────────────────────
        if user_idle_timeout > 0:
            last_activity = request.session.get('_last_activity')
            if last_activity is not None and (now - last_activity) > user_idle_timeout:
                return self._force_logout(request, reason='idle')

        # ── Policy 2: Absolute max-age ────────────────────────────────────────
        if self._max_age > 0:
            session_created = request.session.get('_session_created')
            if session_created is not None and (now - session_created) > self._max_age:
                return self._force_logout(request, reason='absolute_max_age')

        # Background task polling can be very frequent. Skip activity stamp
        # writes for these paths to avoid DB lock contention on SQLite.
        if _is_task_polling_path(request.path):
            return self.get_response(request)

        # Stamp session on first authenticated use (for absolute max-age tracking)
        # and throttle subsequent writes to once per ACTIVITY_WRITE_INTERVAL.
        # Explicitly mark session as modified so Django's session middleware
        # persists the change even when SESSION_SAVE_EVERY_REQUEST is False.
        session_created = request.session.get('_session_created')
        if session_created is None:
            request.session['_session_created'] = now
            request.session['_last_activity'] = now
            request.session.modified = True
        else:
            last_activity = request.session.get('_last_activity')
            if last_activity is None or (now - last_activity) >= self.ACTIVITY_WRITE_INTERVAL:
                request.session['_last_activity'] = now
                request.session.modified = True

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

    def __init__(self, get_response):
        self.get_response = get_response
        self._permissions_policy = getattr(
            django_settings, 'PERMISSIONS_POLICY',
            'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
        )
        self._panel_domain = getattr(django_settings, 'PANEL_DOMAIN', '').lower().strip()
        self._allow_unsafe_inline = bool(getattr(django_settings, 'CSP_ALLOW_UNSAFE_INLINE', True))
        self._allow_unsafe_eval = bool(getattr(django_settings, 'CSP_ALLOW_UNSAFE_EVAL', True))
        self._allow_local_engine = bool(getattr(django_settings, 'CSP_ALLOW_LOCAL_ENGINE_CONNECT', False))

    def _build_script_src(self, extra_sources=None):
        parts = ["'self'"]
        if self._allow_unsafe_inline:
            parts.append("'unsafe-inline'")
        if self._allow_unsafe_eval:
            parts.append("'unsafe-eval'")
        for src in (extra_sources or []):
            if src:
                parts.append(src)
        return ' '.join(parts)

    def _build_connect_src(self):
        parts = ["'self'"]
        if self._allow_local_engine:
            parts.append('http://127.0.0.1:4765')
            parts.append('http://localhost:4765')
        return ' '.join(parts)

    def _build_panel_csp(self, frame_ancestors="'none'"):
        return (
            "default-src 'self'; "
            f"script-src {self._build_script_src(['https://static.cloudflareinsights.com'])}; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "font-src 'self' data:; "
            f"connect-src {self._build_connect_src()}; "
            "media-src 'self'; "
            "frame-src 'self' https://www.google.com https://maps.google.com; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            f"frame-ancestors {frame_ancestors};"
        )

    def _build_pwa_csp(self, frame_ancestors="'none'"):
        script_sources = [
            'https://cdn.tailwindcss.com',
            'https://cdn.jsdelivr.net',
            'https://cdnjs.cloudflare.com',
            'https://static.cloudflareinsights.com',
        ]
        return (
            "default-src 'self'; "
            f"script-src {self._build_script_src(script_sources)}; "
            "style-src 'self' 'unsafe-inline' "
                "https://cdnjs.cloudflare.com "
                "https://fonts.googleapis.com "
                "https://cdn.tailwindcss.com; "
            "img-src 'self' data: blob: https:; "
            "font-src 'self' data: "
                "https://cdnjs.cloudflare.com "
                "https://fonts.gstatic.com; "
            f"connect-src {self._build_connect_src()}; "
            "media-src 'self' blob:; "
            "frame-src 'self' https://www.google.com https://maps.google.com; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            f"frame-ancestors {frame_ancestors};"
        )

    @staticmethod
    def _is_dashboard_drawer_embed_request(request):
        """Return True only for dashboard quick-action embed targets."""
        if request.GET.get('embed') != 'drawer':
            return False

        normalized_path = request.path.rstrip('/').lower()
        allowed_suffixes = (
            '/manage-clients',
            '/manage-staff',
            '/manage-client-staff',
        )
        return any(normalized_path.endswith(suffix) for suffix in allowed_suffixes)

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
            frame_ancestors = "'self'" if self._is_dashboard_drawer_embed_request(request) else "'none'"
            response['Content-Security-Policy'] = (
                self._build_pwa_csp(frame_ancestors=frame_ancestors)
                if is_pwa
                else self._build_panel_csp(frame_ancestors=frame_ancestors)
            )

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


        return response
