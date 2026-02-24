"""
Context Processors for Template Permissions

Automatically injects permission context into ALL templates.
This enables permission-based visibility in templates using:
  {% if is_super_admin %}
  {% if perm_idcard_client_list %}
  etc.

Also injects subdomain URLs (PANEL_URL, WEBSITE_URL) for cross-domain links.
"""
from django.conf import settings
from core.services.permission_service import PermissionService


def permissions(request):
    """
    Inject permission context into ALL templates.
    
    Returns dict with:
        - is_super_admin, is_admin_staff, is_client, is_client_staff: Role checks
        - user_role: User's role string
        - All individual permissions: perm_idcard_client_list, perm_idcard_setting_list, etc.
        - PANEL_URL / WEBSITE_URL: Absolute URLs for cross-domain links
    
    For unauthenticated users, returns empty dict with all values as False.
    
    Performance: caches the result on request._cached_permissions so that
    repeated calls within the same request are free.
    """
    # Always-available context (works for both authenticated and anonymous)
    base_context = {
        'PANEL_URL': getattr(settings, 'PANEL_URL', ''),
        'WEBSITE_URL': getattr(settings, 'WEBSITE_URL', ''),
    }

    if not request.user.is_authenticated:
        base_context.update({
            'is_super_admin': False,
            'is_admin_staff': False,
            'is_client': False,
            'is_client_staff': False,
            'is_client_admin': False,  # For backward compatibility
            'user_role': None,
        })
        return base_context
    
    # Return cached result if already computed this request
    cached = getattr(request, '_cached_permissions', None)
    if cached is not None:
        return cached
    
    # Get all permissions from the centralized PermissionService
    context = PermissionService.get_permission_context(request.user)
    
    # Add is_client_admin for backward compatibility with client-sidebar.html
    context['is_client_admin'] = context.get('is_client', False)
    
    # Add app version
    context['APP_VERSION'] = getattr(settings, 'APP_VERSION', 'v1.1.0')

    # Merge subdomain URLs
    context.update(base_context)
    
    # Cache on request for this request lifecycle
    request._cached_permissions = context
    
    return context
