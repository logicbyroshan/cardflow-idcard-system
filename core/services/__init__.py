# =============================================================================
# ADARSH ADMIN — SERVICE LAYER
# =============================================================================
#
# ARCHITECTURE RULES (enforced):
# - Views are ULTRA-THIN: parse request → call service → return response.
# - NO .save(), .create(), .delete(), .update() on ANY model in views.
# - All mutations MUST go through the appropriate service.
# - Services validate input, execute atomically, and return ServiceResult.
#
# SINGLE AUTHORITIES:
#   PermissionService  → all permission decisions
#   WorkflowService    → all IDCard status transitions   (idcards.services_workflow)
#   ReprintWorkflowService → all ReprintRequest status transitions
#   IDCardService      → all IDCard / IDCardTable / IDCardGroup mutations
#   ImageService       → all file I/O (save, replace, delete images)
#   ClientService      → all Client mutations (admin side)
#   StaffService       → all Staff mutations (admin side)
#   WebsiteService*    → all website-content mutations (in website/services.py)
#   UserProfileService → user profile / password mutations
#
# DEPENDENCY DIRECTION: Views → Services → Models (only).
# Services must NOT import from views.
# =============================================================================

from .base import ServiceResult, BaseService
from .client_service import ClientService
from .staff_service import StaffService
from .idcard_service import IDCardService
from .permission_service import PermissionService
from .activity_service import ActivityService
from .notification_service import NotificationService

__all__ = [
    'ServiceResult',
    'BaseService',
    'ClientService',
    'StaffService',
    'IDCardService',
    'PermissionService',
    'ActivityService',
    'NotificationService',
]


# Lazy re-exports for workflow services (avoids circular import)
def __getattr__(name):
    if name == 'WorkflowService':
        from idcards.services_workflow import WorkflowService
        return WorkflowService
    if name == 'ReprintWorkflowService':
        from reprintcard.services import ReprintWorkflowService
        return ReprintWorkflowService
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
