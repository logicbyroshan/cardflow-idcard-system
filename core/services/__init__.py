# =============================================================================
# ADARSH ADMIN - SERVICE LAYER
# =============================================================================
# 
# Services contain reusable business logic separated from views.
# Views should be thin - only handling HTTP request/response.
# 
# FOLDER STRUCTURE:
# services/
#     __init__.py          - Exports all services
#     base.py              - Base service class, common utilities
#     client_service.py    - Client CRUD operations
#     staff_service.py     - Staff CRUD operations
#     idcard_service.py    - ID Card CRUD, status management
#     image_service.py     - Image upload, processing, filename generation
#     permission_service.py - Permission checking utilities
# =============================================================================

from .base import ServiceResult, BaseService
from .image_service import ImageService
from .client_service import ClientService
from .staff_service import StaffService
from .idcard_service import IDCardService
from .permission_service import PermissionService
from .activity_service import ActivityService

__all__ = [
    'ServiceResult',
    'BaseService',
    'ImageService',
    'ClientService',
    'StaffService',
    'IDCardService',
    'PermissionService',
    'ActivityService',
]
