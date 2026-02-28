"""
Client Views — decorators and helpers.

Access-control decorators for client-facing views and a helper
to resolve the client profile from the current user.
"""
from functools import wraps

from django.shortcuts import redirect
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required

from core.services.permission_service import PermissionService

from .services import ClientAccessService


# =============================================================================
# DECORATORS
# =============================================================================

def require_client_user(view_func):
    """
    Decorator to require client or client_staff role.
    Delegates role check to PermissionService (single authority).
    """
    @wraps(view_func)
    @login_required(login_url='/panel/auth/login/')
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not PermissionService.is_client_role(user):
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({
                    'success': False,
                    'message': 'Client access required'
                }, status=403)
            return redirect('/panel/auth/login/')
        return view_func(request, *args, **kwargs)
    return wrapper


def require_client_admin(view_func):
    """
    Decorator to require client role (not client_staff).
    Delegates role check to PermissionService (single authority).
    """
    @wraps(view_func)
    @login_required(login_url='/panel/auth/login/')
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not PermissionService.is_client(user):
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({
                    'success': False,
                    'message': 'Client Admin access required'
                }, status=403)
            return redirect('/panel/client/dashboard/')
        return view_func(request, *args, **kwargs)
    return wrapper


def _get_client_for_request(user):
    """Helper to get client profile for the logged-in client/client_staff user."""
    return ClientAccessService.get_client_for_user(user)
