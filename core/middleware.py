"""
Core Middleware Module

Contains middleware for:
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


class RequestTimingMiddleware:
    """
    Logs every request with duration, path, user, role, and status code.
    
    - Requests slower than SLOW_REQUEST_THRESHOLD seconds → WARNING
    - All others → DEBUG (so they only appear when DEBUG=True)
    
    MUST be placed early in MIDDLEWARE (after AuthenticationMiddleware)
    so that request.user is available.
    """

    # Skip timing for static/media assets to reduce noise
    SKIP_PREFIXES = ('/static/', '/media/', '/favicon.ico')

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Skip static/media
        if any(request.path.startswith(p) for p in self.SKIP_PREFIXES):
            return self.get_response(request)

        start = time.monotonic()

        # ── Query counting (works in ALL environments) ──
        # Uses a lightweight callback on the connection — no dependency on DEBUG.
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

        # ── Server-Timing header ──
        duration_ms = duration * 1000
        db_ms = query_time * 1000
        response['Server-Timing'] = (
            'total;dur=%.1f, db;dur=%.1f;desc="%d queries"'
            % (duration_ms, db_ms, query_count)
        )

        user = getattr(request, 'user', None)
        username = getattr(user, 'username', 'anonymous') if user and getattr(user, 'is_authenticated', False) else 'anonymous'
        role = getattr(user, 'role', '-') if user and getattr(user, 'is_authenticated', False) else '-'
        status = response.status_code

        # ── Request-level log ──
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

        # ── Individual slow query log ──
        for sql, ms in slow_queries:
            query_logger.warning(
                "SLOW QUERY path=%s time=%dms sql=%s",
                request.path, ms, sql
            )

        return response


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
    """
    
    # URLs that should be exempt from permission checking
    EXEMPT_URLS = [
        '/panel/auth/login/',
        '/panel/auth/logout/',
        '/panel/auth/password-reset/',
        '/panel/api/auth/',
        '/panel/inactive/',
        '/static/',
        '/media/',
        '/admin/',
        '/favicon.ico',
    ]
    
    # URL patterns for public website (exempt from auth)
    PUBLIC_URL_PATTERNS = [
        '/contact/',
        '/about/',
        '/services/',
        '/portfolio/',
        '/gallery/',
        '/why-choose-us/',
        '/our-works/',
    ]
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        # Skip for exempt URLs
        if self._is_exempt_url(request.path):
            return self.get_response(request)
        
        # Safety net: redirect unauthenticated users away from /panel/ routes
        if not request.user.is_authenticated:
            if request.path.startswith('/panel/'):
                from django.shortcuts import redirect
                return redirect('/panel/auth/login/')
            return self.get_response(request)
        
        # Re-fetch user from database to get latest state
        # This catches changes made by admin while user is logged in
        validation_result = self._validate_user_access(request)
        
        if validation_result is not None:
            return validation_result
        
        return self.get_response(request)
    
    def _is_exempt_url(self, path):
        """Check if URL is exempt from permission validation"""
        # Public website pages (not under /panel/) don't need auth validation
        if not path.startswith('/panel/') and not path.startswith('/api/'):
            return True
        for exempt in self.EXEMPT_URLS:
            if path.startswith(exempt):
                return True
        return False
    
    def _validate_user_access(self, request):
        """
        Validate user's access.
        
        Returns:
            None if access is valid
            HttpResponse if access should be denied (redirect/logout)
        """
        from core.models import User
        
        user = request.user
        
        # Cache the fresh user on the request object to avoid duplicate DB hits
        # within the same request cycle (e.g., RoleScopingMiddleware also accesses user)
        _cache_attr = '_pvm_fresh_user'
        fresh_user = getattr(request, _cache_attr, None)
        
        if fresh_user is None:
            try:
                # Re-fetch from DB to get latest state
                fresh_user = User.objects.select_related().get(pk=user.pk)
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
    
    def _force_logout(self, request, message):
        """Force logout user and redirect to inactive page"""
        from urllib.parse import quote
        # Log out the user
        logout(request)
        
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
                'redirect': f'/panel/inactive/?reason={quote(message)}'
            }, status=401)
        
        # Regular page request - redirect to inactive page
        return redirect(f'/panel/inactive/?reason={quote(message)}')


class RoleScopingMiddleware:
    """
    Middleware to ensure users can only access data within their scope.
    
    This is a defense-in-depth layer that adds request annotations
    for use by views in building scoped queries.
    """
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        # Add scoping attributes to request for use by views
        if request.user.is_authenticated:
            self._annotate_request_scope(request)
        
        return self.get_response(request)
    
    def _annotate_request_scope(self, request):
        """Add role-based scope attributes to request — delegates to PermissionService."""
        from core.services.permission_service import PermissionService
        user = request.user
        
        # Initialize scope attributes (via single authority)
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


class WebsiteOfflineMiddleware:
    """
    Intercepts all PUBLIC website requests when WebsiteStatus is 'draft'.
    
    Shows a styled offline page with a link to the admin panel login.
    Only affects public routes (the 'website' app at /).
    Admin panel (/panel/), static, media, and API routes are NOT affected.
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
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
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
                    'redirect': '/panel/auth/login/',
                }, status=401)
            return redirect('/panel/auth/login/')

        # Update last-activity timestamp
        request.session['_last_activity'] = now

        return self.get_response(request)


class SecurityHeadersMiddleware:
    """
    Adds extra security headers that Django's SecurityMiddleware does not cover.

    Currently adds:
    - Permissions-Policy: restricts browser APIs (camera, microphone, etc.)
    """

    SKIP_PREFIXES = ('/static/', '/media/')

    def __init__(self, get_response):
        self.get_response = get_response
        self._permissions_policy = getattr(
            django_settings, 'PERMISSIONS_POLICY',
            'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
        )

    def __call__(self, request):
        response = self.get_response(request)

        # Skip for static/media (served by WhiteNoise which handles its own headers)
        if any(request.path.startswith(p) for p in self.SKIP_PREFIXES):
            return response

        if self._permissions_policy:
            response['Permissions-Policy'] = self._permissions_policy

        return response
