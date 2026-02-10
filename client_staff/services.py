"""
Client Staff Services — DEPRECATED

This module is deprecated. All client staff management has been moved to:
  - client/services.py (ClientStaffService)
  - core/services/permission_service.py (PermissionService)

The old Django Group/Permission system has been replaced by BooleanField-based
permissions on the Staff model (core.models.Staff).

This file is kept as a stub to prevent import errors from the management command.
"""

# Kept for backward compat with setup_client_staff_permissions command
CLIENT_STAFF_PERMISSIONS = {}
CLIENT_ADMIN_ONLY_PERMISSIONS = {}


class ClientStaffPermissionService:
    """Deprecated — use core.services.permission_service.PermissionService instead."""
    pass


class ClientStaffCreationService:
    """Deprecated — use client.services.ClientStaffService instead."""
    pass


class ClientStaffAccessService:
    """Deprecated — use client.services.ClientAccessService instead."""
    pass
