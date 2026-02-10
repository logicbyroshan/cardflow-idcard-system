"""
Permission Service Module
Contains: Role-based permission checking for all user types
"""
from typing import Dict
from functools import wraps

from django.http import JsonResponse
from django.shortcuts import redirect

from .base import ServiceResult


class PermissionService:
    """
    Service for handling role-based permissions.
    
    User Roles:
    - super_admin: Full access to everything
    - admin_staff: Access based on Staff permissions
    - client: Access to their own data + based on Client permissions
    - client_staff: Access based on their client's Staff permissions
    
    Usage in views:
        # Check permission
        if not PermissionService.has_permission(request.user, 'perm_idcard_client_list'):
            return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
        
        # Get context for templates
        context = PermissionService.get_permission_context(request.user)
    """
    
    # Permission categories

    IDCARD_CLIENT_PERMISSIONS = [
        'perm_idcard_client_list',
    ]
    
    IDCARD_SETTING_PERMISSIONS = [
        'perm_idcard_setting_list', 'perm_idcard_setting_add', 
        'perm_idcard_setting_edit', 'perm_idcard_setting_delete', 
        'perm_idcard_setting_status',
        'perm_idcard_group_create', 'perm_idcard_group_delete'
    ]
    
    IDCARD_LIST_PERMISSIONS = [
        'perm_idcard_pending_list', 'perm_idcard_verified_list', 
        'perm_idcard_pool_list', 'perm_idcard_approved_list', 
        'perm_idcard_download_list', 'perm_idcard_reprint_list'
    ]
    
    IDCARD_ACTION_PERMISSIONS = [
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete',
        'perm_idcard_info', 'perm_idcard_approve', 'perm_idcard_verify',
        'perm_idcard_bulk_upload', 'perm_idcard_bulk_download',
        'perm_idcard_created_at', 'perm_idcard_updated_at',
        'perm_idcard_delete_from_pool', 'perm_delete_all_idcard',
        'perm_reupload_idcard_image', 'perm_idcard_retrieve'
    ]
    
    WEBSITE_PERMISSIONS = [
        'perm_website_view', 'perm_website_add', 'perm_website_edit',
        'perm_website_delete', 'perm_website_publish',
    ]
    
    @staticmethod
    def is_super_admin(user) -> bool:
        """
        Check if user is super admin.
        Accepts EITHER Django is_superuser=True OR business role='super_admin'
        for consistency with auth decorators.
        """
        return user.is_authenticated and (user.is_superuser or user.role == 'super_admin')
    
    @staticmethod
    def is_admin_staff(user) -> bool:
        """Check if user is admin staff"""
        return user.is_authenticated and user.role == 'admin_staff'
    
    @staticmethod
    def is_client(user) -> bool:
        """Check if user is a client"""
        return user.is_authenticated and user.role == 'client'
    
    @staticmethod
    def is_client_staff(user) -> bool:
        """Check if user is client staff"""
        return user.is_authenticated and user.role == 'client_staff'
    
    @classmethod
    def get_profile(cls, user):
        """
        Get the permission profile for a user.
        Returns Staff or Client object that has permission fields.
        
        Note: For client_staff, returns the Staff object (not Client).
        Use has_permission() for proper permission chaining.
        """
        if cls.is_super_admin(user):
            return None  # Super admin has all permissions
        
        if cls.is_admin_staff(user):
            return getattr(user, 'staff_profile', None)
        
        if cls.is_client(user):
            return getattr(user, 'client_profile', None)
        
        if cls.is_client_staff(user):
            # Return staff profile directly
            # Permission chaining is handled in has_permission()
            return getattr(user, 'staff_profile', None)
        
        return None
    
    @classmethod
    def has_permission(cls, user, permission_name: str) -> bool:
        """
        Check if user has a specific permission.
        
        Args:
            user: User instance
            permission_name: Name of permission (e.g., 'perm_idcard_add')
        
        Returns:
            True if user has permission, False otherwise
        
        Note: For client_staff, assignable permissions (idcard_client_* and idcard_setting_*)
        are checked on the Staff model. For other permissions (idcard_list_*, idcard_action_*),
        they inherit from their parent Client.
        """
        # Super admin has all permissions
        if cls.is_super_admin(user):
            return True
        
        # Special handling for client_staff to properly chain permissions
        if cls.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if not staff:
                return False
            
            # Client staff checks Staff model first for all permissions
            # that exist as fields on the Staff model (the 13 assignable perms)
            if hasattr(staff, permission_name):
                staff_value = getattr(staff, permission_name, False)
                # Double-gate: staff must have it AND their parent client must have it
                if staff.client:
                    client_value = getattr(staff.client, permission_name, False)
                    return staff_value and client_value
                return staff_value
            
            # For permissions not on Staff model, inherit from client
            if staff.client:
                return getattr(staff.client, permission_name, False)
            return False
        
        profile = cls.get_profile(user)
        if profile is None:
            return False
        
        return getattr(profile, permission_name, False)
    
    @classmethod
    def get_permission_context(cls, user) -> Dict[str, bool]:
        """
        Get all permissions as a dict for template context.
        
        Returns:
            Dict with all permission names as keys and bool values
        """
        all_permissions = (
            cls.IDCARD_CLIENT_PERMISSIONS +
            cls.IDCARD_SETTING_PERMISSIONS + 
            cls.IDCARD_LIST_PERMISSIONS + 
            cls.IDCARD_ACTION_PERMISSIONS +
            cls.WEBSITE_PERMISSIONS
        )
        
        context = {
            'is_super_admin': cls.is_super_admin(user),
            'is_admin_staff': cls.is_admin_staff(user),
            'is_client': cls.is_client(user),
            'is_client_staff': cls.is_client_staff(user),
            'user_role': user.role if user.is_authenticated else None,
        }
        
        # Add all individual permissions
        for perm in all_permissions:
            context[perm] = cls.has_permission(user, perm)
        
        return context
    
    # ==================== Convenience Methods ====================
    
    @classmethod
    def can_view_client_list(cls, user) -> bool:
        return cls.has_permission(user, 'perm_idcard_client_list')
    
    @classmethod
    def can_view_idcard_settings(cls, user) -> bool:
        return cls.has_permission(user, 'perm_idcard_setting_list')
    
    @classmethod
    def can_add_idcard(cls, user) -> bool:
        return cls.has_permission(user, 'perm_idcard_add')
    
    @classmethod
    def can_edit_idcard(cls, user) -> bool:
        return cls.has_permission(user, 'perm_idcard_edit')
    
    @classmethod
    def can_delete_idcard(cls, user) -> bool:
        return cls.has_permission(user, 'perm_idcard_delete')
    
    @classmethod
    def can_bulk_upload(cls, user) -> bool:
        return cls.has_permission(user, 'perm_idcard_bulk_upload')
    
    @classmethod
    def can_bulk_download(cls, user) -> bool:
        return cls.has_permission(user, 'perm_idcard_bulk_download')
    
    @classmethod
    def can_approve_idcard(cls, user) -> bool:
        return cls.has_permission(user, 'perm_idcard_approve')
    
    @classmethod
    def can_verify_idcard(cls, user) -> bool:
        return cls.has_permission(user, 'perm_idcard_verify')
    
    @classmethod
    def can_view_status(cls, user, status: str) -> bool:
        """Check if user can view cards with specific status"""
        status_perm_map = {
            'pending': 'perm_idcard_pending_list',
            'verified': 'perm_idcard_verified_list',
            'pool': 'perm_idcard_pool_list',
            'approved': 'perm_idcard_approved_list',
            'download': 'perm_idcard_download_list',
            'reprint': 'perm_idcard_reprint_list',
        }
        perm = status_perm_map.get(status)
        if perm:
            return cls.has_permission(user, perm)
        return False


# ==================== Decorators ====================

def require_permission(permission_name: str, redirect_url: str = None):
    """
    Decorator to require a specific permission.
    
    Usage:
        @require_permission('perm_idcard_client_list')
        def add_staff_view(request):
            ...
    """
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            if not PermissionService.has_permission(request.user, permission_name):
                if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                    return JsonResponse({
                        'success': False, 
                        'message': 'Permission denied'
                    }, status=403)
                if redirect_url:
                    return redirect(redirect_url)
                return JsonResponse({
                    'success': False, 
                    'message': 'Permission denied'
                }, status=403)
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator


def require_super_admin(view_func):
    """Decorator to require super admin role"""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not PermissionService.is_super_admin(request.user):
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({
                    'success': False, 
                    'message': 'Super admin access required'
                }, status=403)
            return redirect('login')
        return view_func(request, *args, **kwargs)
    return wrapper


def require_any_admin(view_func):
    """Decorator to require super admin or admin staff role"""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not (PermissionService.is_super_admin(user) or PermissionService.is_admin_staff(user)):
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({
                    'success': False, 
                    'message': 'Admin access required'
                }, status=403)
            return redirect('login')
        return view_func(request, *args, **kwargs)
    return wrapper


# ==================== API Decorators (JSON responses) ====================

def api_require_permission(permission_name: str):
    """
    API Decorator to require a specific permission.
    Returns JSON 403 on failure.
    
    Usage:
        @api_require_permission('perm_idcard_client_list')
        def api_add_staff(request):
            ...
    """
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({
                    'success': False,
                    'message': 'Authentication required'
                }, status=401)
            if not PermissionService.has_permission(request.user, permission_name):
                return JsonResponse({
                    'success': False, 
                    'message': 'Permission denied'
                }, status=403)
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator


def api_require_any_authenticated(view_func):
    """
    API Decorator to require any authenticated user (all four roles).
    Returns JSON 401 on failure.
    Individual views handle their own permission and scope checks.
    """
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({
                'success': False,
                'message': 'Authentication required'
            }, status=401)
        return view_func(request, *args, **kwargs)
    return wrapper


def api_require_any_admin(view_func):
    """
    API Decorator to require super admin or admin staff role.
    Returns JSON 403 on failure.
    """
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({
                'success': False,
                'message': 'Authentication required'
            }, status=401)
        user = request.user
        if not (PermissionService.is_super_admin(user) or PermissionService.is_admin_staff(user)):
            return JsonResponse({
                'success': False, 
                'message': 'Admin access required'
            }, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper


def api_require_super_admin(view_func):
    """
    API Decorator to require super admin role.
    Returns JSON 403 on failure.
    """
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({
                'success': False,
                'message': 'Authentication required'
            }, status=401)
        if not PermissionService.is_super_admin(request.user):
            return JsonResponse({
                'success': False, 
                'message': 'Super admin access required'
            }, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper
