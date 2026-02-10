"""
Image Service Module - BACKWARD COMPATIBILITY PROXY

This module re-exports ImageService from mediafiles.services to maintain
backward compatibility with existing imports.

DEPRECATED: Import directly from mediafiles instead:
    from mediafiles.services import ImageService
    
This proxy will continue to work, but direct imports are preferred.
"""

# =============================================================================
# BACKWARD COMPATIBILITY PROXY
# =============================================================================
# All image service logic has been moved to mediafiles.services
# This file provides backward compatibility for existing imports

from mediafiles.services import ImageService, MediaResult

# Re-export ServiceResult alias for compatibility
ServiceResult = MediaResult

__all__ = ['ImageService', 'ServiceResult']
