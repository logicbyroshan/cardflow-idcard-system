"""
Core Middleware Module

Contains middleware for:
- Permission validation on every request
- Session invalidation when permissions are revoked
- Active status enforcement
"""
import logging
from django.contrib.auth import logout
from django.shortcuts import redirect
from django.http import JsonResponse
from django.utils.functional import SimpleLazyObject
from django.urls import reverse

logger = logging.getLogger(__name__)


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
        '/static/',
        '/media/',
        '/admin/',
        '/favicon.ico',
        '/',  # Public website
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
        
        # Skip if user not authenticated
        if not request.user.is_authenticated:
            return self.get_response(request)
        
        # Re-fetch user from database to get latest state
        # This catches changes made by admin while user is logged in
        validation_result = self._validate_user_access(request)
        
        if validation_result is not None:
            return validation_result
        
        return self.get_response(request)
    
    def _is_exempt_url(self, path):
        """Check if URL is exempt from permission validation"""
        for exempt in self.EXEMPT_URLS:
            if path.startswith(exempt):
                return True
        for pattern in self.PUBLIC_URL_PATTERNS:
            if path.startswith(pattern):
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
        """Force logout user and redirect appropriately"""
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
                'redirect': '/panel/auth/login/'
            }, status=401)
        
        # Regular page request - redirect to login
        from django.contrib import messages
        messages.error(request, message)
        return redirect('/panel/auth/login/')


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
        """Add role-based scope attributes to request"""
        user = request.user
        
        # Initialize scope attributes
        request.user_scope = {
            'is_super_admin': user.is_superuser or user.role == 'super_admin',
            'is_admin_staff': user.role == 'admin_staff',
            'is_client': user.role == 'client',
            'is_client_staff': user.role == 'client_staff',
            'client_id': None,
            'accessible_client_ids': [],
        }
        
        if user.role == 'client':
            client = getattr(user, 'client_profile', None)
            if client:
                request.user_scope['client_id'] = client.id
                request.user_scope['accessible_client_ids'] = [client.id]
        
        elif user.role == 'client_staff':
            staff = getattr(user, 'staff_profile', None)
            if staff and staff.client:
                request.user_scope['client_id'] = staff.client.id
                request.user_scope['accessible_client_ids'] = [staff.client.id]
        
        elif user.role == 'admin_staff':
            staff = getattr(user, 'staff_profile', None)
            if staff:
                request.user_scope['accessible_client_ids'] = list(
                    staff.assigned_clients.values_list('id', flat=True)
                )
