"""
Context Processors for Template Permissions

Automatically injects permission context into ALL templates.
This enables permission-based visibility in templates using:
  {% if is_super_admin %}
  {% if perm_idcard_client_list %}
  etc.

Also injects subdomain URLs (PANEL_URL, WEBSITE_URL) for cross-domain links.
"""
import logging

from django.conf import settings
from core.services.permission_service import PermissionService



logger = logging.getLogger(__name__)


def _resolve_mobile_android_download_url(request):
    """Return the configured Android app download URL or empty string.

    This used to be provided by the removed `mobile_app` app. Provide a
    safe fallback so templates and debug toolbar don't crash when it is
    referenced.
    """
    return getattr(settings, 'MOBILE_ANDROID_APP_DOWNLOAD_URL', '')


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
        'APP_VERSION': getattr(settings, 'APP_VERSION', 'v0.00.00'),
        'MOBILE_ANDROID_APP_DOWNLOAD_URL': _resolve_mobile_android_download_url(request),
        'API_BASE_URL': '/panel' if request.path.startswith('/panel/') else ('/app' if request.path.startswith('/app/') else ''),
    }

    if not request.user.is_authenticated:
        base_context.update({
            'is_pro_user': False,
            'is_super_admin': False,
            'is_admin_staff': False,
            'is_client': False,
            'is_client_staff': False,
            'is_client_admin': False,  # For backward compatibility
            'is_impersonating': False,
            'impersonation_original_name': '',
            'user_role': None,
        })
        return base_context
    
    # Return cached result if already computed this request
    cached = getattr(request, '_cached_permissions', None)
    if cached is not None:
        return cached
    
    # Get all permissions from the centralized PermissionService.
    # Wrapped in try/except because a transient DB error here would crash
    # every single page render (this processor runs on every template).
    try:
        context = PermissionService.get_permission_context(request.user)
    except Exception:
        import logging as _log
        _log.getLogger(__name__).exception(
            'PermissionService.get_permission_context failed for user %s',
            request.user.pk,
        )
        context = {
            'is_pro_user': False,
            'is_super_admin': False, 'is_admin_staff': False,
            'is_client': False, 'is_client_staff': False,
            'user_role': getattr(request.user, 'role', None),
        }
    
    # Add is_client_admin for backward compatibility with client-sidebar.html
    context['is_client_admin'] = context.get('is_client', False)

    # Add impersonation session state for template/UI controls.
    context['is_impersonating'] = bool(request.session.get('_pro_original_user_id'))
    context['impersonation_original_name'] = request.session.get('_pro_original_user_name', '')
    
    # Merge subdomain URLs
    context.update(base_context)

    current_client = None
    try:
        if context.get('is_client'):
            current_client = getattr(request.user, 'client_profile', None)
        elif context.get('is_client_staff'):
            staff_profile = getattr(request.user, 'staff_profile', None)
            current_client = getattr(staff_profile, 'client', None)
    except Exception:
        current_client = None

    context['current_client'] = current_client
    context['current_client_logo_url'] = current_client.logo.url if current_client and current_client.logo else None

    
    # Cache on request for this request lifecycle
    request._cached_permissions = context
    
    return context
