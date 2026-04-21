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
from website.services import TestimonialService


logger = logging.getLogger(__name__)


def _resolve_mobile_android_download_url(request):
    raw = str(getattr(settings, 'MOBILE_SHELL_ANDROID_UPDATE_URL', '') or '').strip()
    if not raw:
        return ''

    lowered = raw.lower()
    if lowered.startswith('http://') or lowered.startswith('https://'):
        return raw

    if raw.startswith('//'):
        return f'https:{raw}'

    panel_url = str(getattr(settings, 'PANEL_URL', '') or '').strip().rstrip('/')
    if raw.startswith('/'):
        if panel_url:
            return f'{panel_url}{raw}'
        try:
            return request.build_absolute_uri(raw)
        except Exception:
            return raw

    if panel_url:
        return f'{panel_url}/{raw.lstrip("/")}'
    return raw


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
        'APP_VERSION': getattr(settings, 'APP_VERSION', 'v0.00.00'),
        'MOBILE_ANDROID_APP_DOWNLOAD_URL': _resolve_mobile_android_download_url(request),
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
    context['current_client_logo_url'] = (
        current_client.website_logo.url
        if current_client and getattr(current_client, 'website_logo', None)
        else ''
    )

    client_ip = (request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip() or request.META.get('REMOTE_ADDR', '')).strip()
    public_review_email = (getattr(request.user, 'email', '') or '').strip() if request.user.is_authenticated else ''
    review_lookup_ip = '' if public_review_email else client_ip
    try:
        context['can_submit_public_review'] = not TestimonialService.has_public_review(
            reviewer_email=public_review_email,
            reviewer_ip=review_lookup_ip,
        )
    except Exception as exc:
        logger.warning('Failed computing can_submit_public_review: %s', exc)
        context['can_submit_public_review'] = True
    
    # Cache on request for this request lifecycle
    request._cached_permissions = context
    
    return context
