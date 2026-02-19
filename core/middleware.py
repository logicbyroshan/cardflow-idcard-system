"""
Core Middleware Module

Contains middleware for:
- Request timing and slow-request detection
- Permission validation on every request
- Session invalidation when permissions are revoked
- Active status enforcement
"""
import logging
import time
from django.contrib.auth import logout
from django.shortcuts import redirect
from django.http import JsonResponse
from django.utils.functional import SimpleLazyObject
from django.urls import reverse

logger = logging.getLogger(__name__)

# Threshold in seconds — requests slower than this are logged as WARNING
SLOW_REQUEST_THRESHOLD = getattr(
    __import__('django.conf', fromlist=['settings']).settings,
    'SLOW_REQUEST_THRESHOLD', 1.5
)

# Threshold for excessive query count warning
QUERY_COUNT_THRESHOLD = getattr(
    __import__('django.conf', fromlist=['settings']).settings,
    'QUERY_COUNT_THRESHOLD', 50
)


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

        # Query-count tracking — detect N+1 patterns
        # In DEBUG mode: always count. In production: count only to detect excessive queries.
        from django.conf import settings as _settings
        count_queries = _settings.DEBUG
        if count_queries:
            from django.db import connection
            initial_queries = len(connection.queries)

        response = self.get_response(request)
        duration = time.monotonic() - start

        user = getattr(request, 'user', None)
        username = getattr(user, 'username', 'anonymous') if user and getattr(user, 'is_authenticated', False) else 'anonymous'
        role = getattr(user, 'role', '-') if user and getattr(user, 'is_authenticated', False) else '-'
        status = response.status_code

        # Build base log message
        msg = "method=%s path=%s status=%d duration=%.3fs user=%s role=%s"
        args = (request.method, request.path, status, duration, username, role)

        if count_queries:
            num_queries = len(connection.queries) - initial_queries
            msg += " queries=%d"
            args = args + (num_queries,)
            if num_queries > QUERY_COUNT_THRESHOLD:
                logger.warning("EXCESSIVE QUERIES " + msg, *args)
            elif duration >= SLOW_REQUEST_THRESHOLD:
                logger.warning("SLOW REQUEST " + msg, *args)
            else:
                logger.debug(msg, *args)
        else:
            if duration >= SLOW_REQUEST_THRESHOLD:
                logger.warning("SLOW REQUEST " + msg, *args)
            else:
                logger.debug(msg, *args)

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
        
        try:
            # Re-fetch from DB to get latest state
            fresh_user = User.objects.select_related().get(pk=user.pk)
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
