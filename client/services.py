"""
Client Services — barrel re-export module.

Individual service classes live in their own files for modularity.
Import from here for backward compatibility.
"""
from .services_access import ClientAccessService
from .services_dashboard import ClientDashboardService
from .services_staff import ClientStaffService
from .services_card import ClientCardService
from .services_image import ClientImageService

__all__ = [
    'ClientAccessService',
    'ClientDashboardService',
    'ClientStaffService',
    'ClientCardService',
    'ClientImageService',
]
