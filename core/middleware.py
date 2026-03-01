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
    silently rewritten (prefix stripped) so that all existing hardcoded
    /panel/… URLs in JS, templates, and Python code keep working.

    In local development (when neither domain is set, or the Host header
    matches neither), the default ROOT_URLCONF is used (all routes).

    Must be placed BEFORE WhiteNoiseMiddleware in MIDDLEWARE so that the
    urlconf is set before any downstream middleware resolves URLs.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.website_domain = getattr(django_settings, 'WEBSITE_DOMAIN', '').lower().strip()
        self.panel_domain = getattr(django_settings, 'PANEL_DOMAIN', '').lower().strip()

    def __call__(self, request):
        # Skip routing if domains are not configured (local dev fallback)
        if not self.website_domain and not self.panel_domain:
            request._is_panel_subdomain = False
            return self.get_response(request)

        host = request.get_host().split(':')[0].lower()  # strip port

        if host == self.website_domain:
            request.urlconf = 'config.urls_website'
            request._is_panel_subdomain = False
        elif host == self.panel_domain:
            request.urlconf = 'config.urls_panel'
            request._is_panel_subdomain = True
            # Backward compat: strip /panel/ prefix so hardcoded URLs still work
            if request.path_info.startswith('/panel/'):
                request.path_info = request.path_info[len('/panel'):]  # /panel/auth/… → /auth/…
                # CRITICAL: Also update request.path so downstream middleware
                # (e.g. PermissionValidationMiddleware) sees the rewritten path.
                request.path = request.path_info
        else:
            # Unknown host — use default ROOT_URLCONF (local dev)
            request._is_panel_subdomain = False

        return self.get_response(request)


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
    ]
    
    # Paths that are always exempt regardless of prefix
    ALWAYS_EXEMPT = [
        '/static/',
        '/media/',
        '/admin/',
        '/favicon.ico',
        '/api/health/',
        '/robots.txt',
        '/manifest.json',
        '/sw.js',
        '/app/sw.js',
        '/app/manifest.json',
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
    REVALIDATION_INTERVAL = 10  # seconds
    
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
                # Re-fetch from DB to get latest state
                fresh_user = User.objects.only(
                    'pk', 'username', 'is_active', 'role', 'first_name', 'last_name'
                ).get(pk=user.pk)
                setattr(request, _cache_attr, fresh_user)
            except User.DoesNotExist:
                # User was deleted - force logout
                logger.warning(
                    "PermissionValidationMiddleware: User %s (ID: %d) no longer exists - forcing logout",
                    user.username, user.pk
                )
                return self._force_logout(request, 'Your account has been removed.')
        
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
        
        # super_admin and admin_staff pass through
        return None
    
    def _validate_client_access(self, request, user):
        """Validate client user access"""
        from core.models import Client
        
        try:
            client = Client.objects.get(user=user)
        except Client.DoesNotExist:
            logger.warning(
                "PermissionValidationMiddleware: Client profile not found for user %s - forcing logout",
                user.username
            )
            return self._force_logout(request, 'Your client profile is not configured.')
        
        # Check if client is still active
        if client.status != 'active':
            logger.warning(
                "PermissionValidationMiddleware: Client '%s' (ID: %s) is now %s - forcing logout for user %s",
                client.name, client.pk, client.status, user.username
            )
            return self._force_logout(request, 'Your organization account has been suspended.')
        
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
        from core.models import Staff, Client
        
        try:
            staff = Staff.objects.select_related('client').get(user=user)
        except Staff.DoesNotExist:
            logger.warning(
                "PermissionValidationMiddleware: Staff profile not found for user %s - forcing logout",
                user.username
            )
            return self._force_logout(request, 'Your staff profile is not configured.')
        
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
                "PermissionValidationMiddleware: Client '%s' (ID: %s) is now %s - forcing logout for staff %s",
                staff.client.name, staff.client.pk, staff.client.status, user.username
            )
            return self._force_logout(
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
            from django.core.cache import cache

            # Cache status for 10 seconds to avoid DB hit on every request
            status = cache.get('website_status_cache')
            if status is None:
                status = WebsiteStatus.get_status()
                cache.set('website_status_cache', status, 10)

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
    Logs out users after SESSION_IDLE_TIMEOUT seconds of inactivity.

    On every authenticated request, compares the current time with
    the last-activity timestamp stored in the session. If the gap
    exceeds the threshold, the session is flushed and the user is
    redirected to login.

    Set SESSION_IDLE_TIMEOUT=0 in settings to disable.
    """

    SKIP_PREFIXES = ('/static/', '/media/', '/favicon.ico')

    def __init__(self, get_response):
        self.get_response = get_response
        self._timeout = getattr(django_settings, 'SESSION_IDLE_TIMEOUT', 1800)

    def __call__(self, request):
        if self._timeout <= 0:
            return self.get_response(request)

        # Skip for static/media and unauthenticated users
        if any(request.path.startswith(p) for p in self.SKIP_PREFIXES):
            return self.get_response(request)

        if not hasattr(request, 'user') or not request.user.is_authenticated:
            return self.get_response(request)

        now = time.time()
        last_activity = request.session.get('_last_activity')

        if last_activity is not None and (now - last_activity) > self._timeout:
            username = getattr(request.user, 'username', 'unknown')
            logger.info(
                "SessionIdleTimeout: user=%s idle=%.0fs threshold=%ds — forcing logout",
                username, now - last_activity, self._timeout
            )
            logout(request)

            prefix = '' if getattr(request, '_is_panel_subdomain', False) else '/panel'
            login_url = f'{prefix}/auth/login/'

            # API/HTMX → JSON; browser → redirect
            is_ajax = (
                request.headers.get('X-Requested-With') == 'XMLHttpRequest'
                or request.headers.get('HX-Request') == 'true'
                or request.content_type == 'application/json'
            )
            if is_ajax:
                return JsonResponse({
                    'success': False,
                    'message': 'Session expired due to inactivity.',
                    'redirect': login_url,
                }, status=401)
            return redirect(login_url)

        # Update last-activity timestamp
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
    # - img-src data:/blob: required: image previews and canvas operations
    # - font-src data: required: some icon fonts are base64-embedded
    # Strict protections still enforced:
    # - object-src 'none'    → blocks Flash/plugins entirely
    # - base-uri 'self'      → prevents <base href> injection attacks
    # - form-action 'self'   → prevents forms being hijacked to external targets
    # - frame-ancestors 'none' → belt-and-suspenders with X-Frame-Options: DENY
    _CSP_PANEL = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "media-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none';"
    )

    # CSP for the mobile PWA (/app/) which loads Alpine.js and Cropper.js from CDNs
    _CSP_PWA = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data: https://cdnjs.cloudflare.com; "
        "connect-src 'self'; "
        "media-src 'self'; "
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
