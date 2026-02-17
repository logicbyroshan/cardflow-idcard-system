"""
Permission Service Module — SINGLE AUTHORITY FOR ALL PERMISSION DECISIONS.

All permission checks in the entire application MUST go through
PermissionService.has() (or the convenience aliases).  No view, template,
service, or middleware should inspect perm_* booleans directly.

Contains: Role-based permission checking, client scoping, decorators
"""
import logging
from typing import Dict, Optional, List
from functools import wraps

from django.http import JsonResponse
from django.shortcuts import redirect

logger = logging.getLogger(__name__)


class PermissionService:
    """
    Single authority for all permission decisions.

    Usage:
        # Primary API — use everywhere
        PermissionService.has(user, 'perm_idcard_add')
        PermissionService.has(user, 'perm_idcard_add', client=some_client)

        # Template context
        context = PermissionService.get_permission_context(user)

    Roles:
        super_admin  — always True
        admin_staff  — must have perm on Staff model + be assigned to client
        client       — must have perm on Client model + client active
        client_staff — double-gated: Staff perm AND parent Client perm
    """

    # ==================== Known Permission Keys ====================

    IDCARD_CLIENT_PERMISSIONS = [
        'perm_idcard_client_list',
    ]

    IDCARD_SETTING_PERMISSIONS = [
        'perm_idcard_setting_list', 'perm_idcard_setting_add',
        'perm_idcard_setting_edit', 'perm_idcard_setting_delete',
        'perm_idcard_setting_status',
        'perm_idcard_group_create', 'perm_idcard_group_delete',
    ]

    IDCARD_LIST_PERMISSIONS = [
        'perm_idcard_pending_list', 'perm_idcard_verified_list',
        'perm_idcard_pool_list', 'perm_idcard_approved_list',
        'perm_idcard_download_list', 'perm_idcard_reprint_list',
    ]

    IDCARD_ACTION_PERMISSIONS = [
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete',
        'perm_idcard_info', 'perm_idcard_approve', 'perm_idcard_verify',
        'perm_idcard_bulk_upload', 'perm_idcard_bulk_download',
        'perm_idcard_bulk_reupload',
        'perm_idcard_created_at', 'perm_idcard_updated_at',
        'perm_idcard_delete_from_pool', 'perm_delete_all_idcard',
        'perm_reupload_idcard_image', 'perm_idcard_retrieve',
        'perm_idcard_upgrade_all',
    ]

    WEBSITE_PERMISSIONS = [
        'perm_website_view', 'perm_website_add', 'perm_website_edit',
        'perm_website_delete', 'perm_website_publish',
    ]

    # All known perm keys (computed once at class-load time)
    ALL_PERMISSION_KEYS: List[str] = (
        IDCARD_CLIENT_PERMISSIONS
        + IDCARD_SETTING_PERMISSIONS
        + IDCARD_LIST_PERMISSIONS
        + IDCARD_ACTION_PERMISSIONS
        + WEBSITE_PERMISSIONS
    )

    # Status → list-permission mapping (shared across views)
    STATUS_LIST_PERM_MAP = {
        'pending': 'perm_idcard_pending_list',
        'verified': 'perm_idcard_verified_list',
        'approved': 'perm_idcard_approved_list',
        'download': 'perm_idcard_download_list',
        'pool': 'perm_idcard_pool_list',
        'reprint': 'perm_idcard_reprint_list',
    }

    # Status → action-permission mapping (for status transitions)
    STATUS_ACTION_PERM_MAP = {
        'pending': 'perm_idcard_verify',
        'verified': 'perm_idcard_verify',
        'approved': 'perm_idcard_approve',
        'download': 'perm_idcard_approve',
        'pool': 'perm_idcard_delete',
        'reprint': 'perm_idcard_reprint_list',
    }

    # ==================== Role Checks ====================

    @staticmethod
    def is_super_admin(user) -> bool:
        """Check if user is super admin (is_superuser OR role='super_admin')."""
        return user.is_authenticated and (user.is_superuser or user.role == 'super_admin')

    @staticmethod
    def is_admin_staff(user) -> bool:
        """Check if user is admin staff."""
        return user.is_authenticated and user.role == 'admin_staff'

    @staticmethod
    def is_client(user) -> bool:
        """Check if user is a client."""
        return user.is_authenticated and user.role == 'client'

    @staticmethod
    def is_client_staff(user) -> bool:
        """Check if user is client staff."""
        return user.is_authenticated and user.role == 'client_staff'

    @staticmethod
    def is_any_admin(user) -> bool:
        """Check if user is super_admin or admin_staff."""
        if not user.is_authenticated:
            return False
        return user.is_superuser or user.role in ('super_admin', 'admin_staff')

    @staticmethod
    def is_client_role(user) -> bool:
        """Check if user is client or client_staff."""
        return user.is_authenticated and user.role in ('client', 'client_staff')

    # ==================== Profile Lookup ====================

    @classmethod
    def get_profile(cls, user):
        """
        Get the permission-bearing profile for a user.
        Returns Staff or Client object that has permission fields.
        For client_staff returns the Staff object (permission chaining in has()).
        """
        if cls.is_super_admin(user):
            return None
        if cls.is_admin_staff(user):
            return getattr(user, 'staff_profile', None)
        if cls.is_client(user):
            return getattr(user, 'client_profile', None)
        if cls.is_client_staff(user):
            return getattr(user, 'staff_profile', None)
        return None

    # ==================== PRIMARY API ====================

    @classmethod
    def has(cls, user, perm_key: str, client=None) -> bool:
        """
        **Single authority** for all permission decisions.

        Args:
            user:      User instance (from request.user or model)
            perm_key:  Permission field name, e.g. 'perm_idcard_add'
            client:    Optional Client instance for scope validation
                       (admin_staff must be assigned to this client)

        Returns:
            True if the user holds the permission, False otherwise.

        Rules:
            1. Unauthenticated / inactive user → False
            2. super_admin → always True
            3. admin_staff → staff profile perm + (if client given) assigned-check
            4. client → client profile perm + client active
            5. client_staff → staff perm AND parent client perm + client active
            6. Unknown perm_key (not a field on the profile) → False + log
        """
        # --- Defensive: unauthenticated ---
        if not user.is_authenticated:
            return False

        # --- Defensive: inactive user ---
        if not user.is_active:
            return False

        # --- 1. Super admin always passes ---
        if cls.is_super_admin(user):
            return True

        # --- 2. admin_staff ---
        if cls.is_admin_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if not staff:
                logger.warning("PermissionService.has: admin_staff user %s has no staff_profile", user.pk)
                return False
            if not user.is_active:
                return False
            # Check the perm field on staff
            if not hasattr(staff, perm_key):
                logger.warning("PermissionService.has: unknown perm_key '%s' for admin_staff user %s", perm_key, user.pk)
                return False
            if not getattr(staff, perm_key, False):
                return False
            # Scope check: if a client is supplied, staff must be assigned to it
            if client is not None:
                if not staff.assigned_clients.filter(id=client.id).exists():
                    return False
            return True

        # --- 3. client ---
        if cls.is_client(user):
            client_profile = getattr(user, 'client_profile', None)
            if not client_profile:
                logger.warning("PermissionService.has: client user %s has no client_profile", user.pk)
                return False
            if client_profile.status != 'active':
                return False
            if not hasattr(client_profile, perm_key):
                logger.warning("PermissionService.has: unknown perm_key '%s' for client user %s", perm_key, user.pk)
                return False
            return bool(getattr(client_profile, perm_key, False))

        # --- 4. client_staff (double-gated) ---
        if cls.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if not staff:
                logger.warning("PermissionService.has: client_staff user %s has no staff_profile", user.pk)
                return False
            if not staff.client:
                return False
            if staff.client.status != 'active':
                return False
            # Staff perm
            if hasattr(staff, perm_key):
                staff_value = getattr(staff, perm_key, False)
            else:
                # Perm not on Staff model ⇒ inherit from client only
                staff_value = True  # no staff gate
            # Client perm
            if hasattr(staff.client, perm_key):
                client_value = getattr(staff.client, perm_key, False)
            else:
                logger.warning("PermissionService.has: unknown perm_key '%s' for client_staff user %s", perm_key, user.pk)
                return False
            return bool(staff_value and client_value)

        # Unknown role
        logger.warning("PermissionService.has: user %s has unrecognised role '%s'", user.pk, getattr(user, 'role', '?'))
        return False

    # Backward-compat alias — all existing callers still work
    has_permission = has

    # ==================== Client Scope Checking ====================

    @classmethod
    def get_accessible_clients(cls, user, base_qs=None):
        """
        Return Client queryset scoped to user's access level.
        super_admin → all clients; admin_staff → assigned clients only; others → none.
        If base_qs is provided, results are intersected with it.
        """
        from ..models import Client
        qs = base_qs if base_qs is not None else Client.objects.all()
        if not user.is_authenticated:
            return qs.none()
        if cls.is_super_admin(user):
            return qs
        if cls.is_admin_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                assigned_ids = staff.assigned_clients.values_list('id', flat=True)
                return qs.filter(id__in=assigned_ids)
            return qs.none()
        return qs.none()

    @classmethod
    def can_access_client(cls, user, client_id: int) -> bool:
        """
        Check if user can access a specific client's data.
        Works for all roles.
        """
        if not user.is_authenticated:
            return False
        if cls.is_super_admin(user):
            return True
        if cls.is_admin_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                return staff.assigned_clients.filter(id=client_id).exists()
            return False
        if cls.is_client(user):
            client_profile = getattr(user, 'client_profile', None)
            return client_profile is not None and client_profile.id == client_id
        if cls.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            return staff is not None and staff.client_id == client_id
        return False

    @classmethod
    def get_accessible_client_ids(cls, user) -> List[int]:
        """Return list of client IDs the user may access."""
        if not user.is_authenticated:
            return []
        if cls.is_super_admin(user):
            return []  # Empty means "all" for super_admin — caller should handle
        if cls.is_admin_staff(user):
            staff = getattr(user, 'staff_profile', None)
            if staff:
                return list(staff.assigned_clients.values_list('id', flat=True))
            return []
        if cls.is_client(user):
            cp = getattr(user, 'client_profile', None)
            return [cp.id] if cp else []
        if cls.is_client_staff(user):
            staff = getattr(user, 'staff_profile', None)
            return [staff.client_id] if staff and staff.client_id else []
        return []

    # ==================== Template Context ====================

    @classmethod
    def get_permission_context(cls, user) -> Dict[str, bool]:
        """
        Build dict of all permission flags + role booleans for template injection.
        Called by context_processors.permissions().

        Performance: fetches the permission-bearing profile ONCE and reads all
        boolean fields directly instead of calling has() N times.
        """
        is_sa = cls.is_super_admin(user)
        is_as = cls.is_admin_staff(user)
        is_cl = cls.is_client(user)
        is_cs = cls.is_client_staff(user)

        context: Dict[str, bool] = {
            'is_super_admin': is_sa,
            'is_admin_staff': is_as,
            'is_client': is_cl,
            'is_client_staff': is_cs,
            'user_role': user.role if user.is_authenticated else None,
        }

        # Super admin gets all permissions True — no profile lookup needed
        if is_sa:
            for perm in cls.ALL_PERMISSION_KEYS:
                context[perm] = True
        elif is_as:
            # Admin staff: read booleans from staff_profile in one shot
            staff = getattr(user, 'staff_profile', None)
            for perm in cls.ALL_PERMISSION_KEYS:
                if staff and hasattr(staff, perm):
                    context[perm] = bool(getattr(staff, perm, False))
                else:
                    context[perm] = False
        elif is_cl:
            # Client: read from client_profile
            profile = getattr(user, 'client_profile', None)
            active = profile.status == 'active' if profile else False
            for perm in cls.ALL_PERMISSION_KEYS:
                if active and profile and hasattr(profile, perm):
                    context[perm] = bool(getattr(profile, perm, False))
                else:
                    context[perm] = False
        elif is_cs:
            # Client staff: staff perm AND client perm (double-gated)
            staff = getattr(user, 'staff_profile', None)
            client_obj = staff.client if staff else None
            active = client_obj and client_obj.status == 'active'
            for perm in cls.ALL_PERMISSION_KEYS:
                if not active:
                    context[perm] = False
                    continue
                staff_val = bool(getattr(staff, perm, True)) if hasattr(staff, perm) else True
                client_val = bool(getattr(client_obj, perm, False)) if hasattr(client_obj, perm) else False
                context[perm] = staff_val and client_val
        else:
            for perm in cls.ALL_PERMISSION_KEYS:
                context[perm] = False

        # Convenience composite key used by templates
        context['user_permissions'] = {
            perm: context[perm] for perm in cls.ALL_PERMISSION_KEYS
        }

        return context

    # ==================== Convenience Methods ====================

    @classmethod
    def can_view_client_list(cls, user) -> bool:
        return cls.has(user, 'perm_idcard_client_list')

    @classmethod
    def can_view_idcard_settings(cls, user) -> bool:
        return cls.has(user, 'perm_idcard_setting_list')

    @classmethod
    def can_add_idcard(cls, user) -> bool:
        return cls.has(user, 'perm_idcard_add')

    @classmethod
    def can_edit_idcard(cls, user) -> bool:
        return cls.has(user, 'perm_idcard_edit')

    @classmethod
    def can_delete_idcard(cls, user) -> bool:
        return cls.has(user, 'perm_idcard_delete')

    @classmethod
    def can_bulk_upload(cls, user) -> bool:
        return cls.has(user, 'perm_idcard_bulk_upload')

    @classmethod
    def can_bulk_download(cls, user) -> bool:
        return cls.has(user, 'perm_idcard_bulk_download')

    @classmethod
    def can_approve_idcard(cls, user) -> bool:
        return cls.has(user, 'perm_idcard_approve')

    @classmethod
    def can_verify_idcard(cls, user) -> bool:
        return cls.has(user, 'perm_idcard_verify')

    @classmethod
    def can_view_status(cls, user, status: str) -> bool:
        """Check if user can view cards with a specific status."""
        perm = cls.STATUS_LIST_PERM_MAP.get(status)
        return cls.has(user, perm) if perm else False

    # ==================== Debug / Self-Check ====================

    @classmethod
    def debug_permissions(cls, user) -> dict:
        """
        Return a complete snapshot of the user's effective permissions.
        Intended for the /panel/api/debug/permissions/ endpoint (super_admin only).
        """
        info: dict = {
            'user_id': user.pk if user.is_authenticated else None,
            'username': user.username if user.is_authenticated else None,
            'role': getattr(user, 'role', None),
            'is_active': user.is_active if user.is_authenticated else False,
            'is_superuser': user.is_superuser if user.is_authenticated else False,
            'is_super_admin': cls.is_super_admin(user),
            'is_admin_staff': cls.is_admin_staff(user),
            'is_client': cls.is_client(user),
            'is_client_staff': cls.is_client_staff(user),
            'accessible_client_ids': cls.get_accessible_client_ids(user),
            'effective_permissions': {},
        }

        profile = cls.get_profile(user)
        if profile:
            info['profile_type'] = type(profile).__name__
            info['profile_id'] = profile.pk

        # Populate every known perm
        for perm in cls.ALL_PERMISSION_KEYS:
            info['effective_permissions'][perm] = cls.has(user, perm)

        return info


# ===========================================================================
# DECORATORS — standardised set (page + API)
# ===========================================================================

def _permission_denied_response(request, message='Permission denied', status=403):
    """
    Return the appropriate denied response depending on request type.
    API/AJAX → JSON 403     Page → redirect to login
    """
    is_api = (
        request.headers.get('X-Requested-With') == 'XMLHttpRequest'
        or request.content_type == 'application/json'
        or '/api/' in request.path
    )
    if is_api:
        return JsonResponse({'success': False, 'message': message}, status=status)
    return redirect('login')


def _auth_required_response(request):
    """Return 401/redirect for unauthenticated users."""
    is_api = (
        request.headers.get('X-Requested-With') == 'XMLHttpRequest'
        or request.content_type == 'application/json'
        or '/api/' in request.path
    )
    if is_api:
        return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
    return redirect('login')


# ---------- Page decorators ----------

def require_permission(permission_name: str, redirect_url: str = None):
    """
    Page decorator — requires a specific perm via PermissionService.has().
    Falls back to redirect on denial.
    """
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return _auth_required_response(request)
            if not PermissionService.has(request.user, permission_name):
                if redirect_url:
                    return redirect(redirect_url)
                return _permission_denied_response(request)
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator


def require_super_admin(view_func):
    """Page decorator — super_admin only."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return _auth_required_response(request)
        if not PermissionService.is_super_admin(request.user):
            return _permission_denied_response(request, 'Super admin access required')
        return view_func(request, *args, **kwargs)
    return wrapper


def require_any_admin(view_func):
    """Page decorator — super_admin or admin_staff."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return _auth_required_response(request)
        if not PermissionService.is_any_admin(request.user):
            return _permission_denied_response(request, 'Admin access required')
        return view_func(request, *args, **kwargs)
    return wrapper


def require_authenticated_role(allowed_roles: list):
    """
    Page decorator — requires user.role to be one of ``allowed_roles``.
    """
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return _auth_required_response(request)
            role = getattr(request.user, 'role', None)
            if role not in allowed_roles and not PermissionService.is_super_admin(request.user):
                return _permission_denied_response(request)
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator


# ---------- API decorators ----------

def api_require_permission(permission_name: str):
    """API decorator — requires a specific perm via PermissionService.has(). Returns JSON."""
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
            if not PermissionService.has(request.user, permission_name):
                logger.warning(
                    "PERMISSION_DENIED user=%s role=%s perm=%s path=%s",
                    request.user.username, getattr(request.user, 'role', '-'),
                    permission_name, request.path,
                )
                return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator


def api_require_any_authenticated(view_func):
    """API decorator — any authenticated user (all four roles). Returns JSON 401."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
        return view_func(request, *args, **kwargs)
    return wrapper


def api_require_any_admin(view_func):
    """API decorator — super_admin or admin_staff. Returns JSON 403."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
        if not PermissionService.is_any_admin(request.user):
            logger.warning(
                "PERMISSION_DENIED user=%s role=%s required=any_admin path=%s",
                request.user.username, getattr(request.user, 'role', '-'), request.path,
            )
            return JsonResponse({'success': False, 'message': 'Admin access required'}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper


def api_require_super_admin(view_func):
    """API decorator — super_admin only. Returns JSON 403."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
        if not PermissionService.is_super_admin(request.user):
            logger.warning(
                "PERMISSION_DENIED user=%s role=%s required=super_admin path=%s",
                request.user.username, getattr(request.user, 'role', '-'), request.path,
            )
            return JsonResponse({'success': False, 'message': 'Super admin access required'}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper
