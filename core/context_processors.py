"""
Context Processors for Template Permissions

Automatically injects permission context into ALL templates.
This enables permission-based visibility in templates using:
  {% if is_super_admin %}
  {% if perm_idcard_client_list %}
  etc.
"""
from django.conf import settings
from core.services.permission_service import PermissionService
from django.conf import settings as django_settings


def permissions(request):
    """
    Inject permission context into ALL templates.
    
    Returns dict with:
        - is_super_admin, is_admin_staff, is_client, is_client_staff: Role checks
        - user_role: User's role string
        - All individual permissions: perm_idcard_client_list, perm_idcard_setting_list, etc.
    
    For unauthenticated users, returns empty dict with all values as False.
    """
    if not request.user.is_authenticated:
        return {
            'is_super_admin': False,
            'is_admin_staff': False,
            'is_client': False,
            'is_client_staff': False,
            'is_client_admin': False,  # For backward compatibility
            'user_role': None,
        }
    
    # Get all permissions from the centralized PermissionService
    context = PermissionService.get_permission_context(request.user)
    
    # Add is_client_admin for backward compatibility with client-sidebar.html
    context['is_client_admin'] = context.get('is_client', False)
    
    # Add app version
    context['APP_VERSION'] = getattr(settings, 'APP_VERSION', 'v1.0.0')
    
    return context
