"""Image Service Module - BACKWARD COMPATIBILITY PROXY

DEPRECATED: Import directly from mediafiles instead:
    from mediafiles.services import ImageService

This proxy will be removed in a future version.
"""
import warnings

warnings.warn(
    "Importing ImageService from core.services.image_service is deprecated. "
    "Use 'from mediafiles.services import ImageService' instead.",
    DeprecationWarning,
    stacklevel=2,
)

from mediafiles.services import ImageService, MediaResult

ServiceResult = MediaResult

__all__ = ['ImageService', 'ServiceResult']
