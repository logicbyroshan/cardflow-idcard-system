"""
Mediafiles Constants Module

Contains all image and media-related constants used across the application.
"""

# =============================================================================
# IMAGE FIELD TYPES
# =============================================================================

# Field types that should be treated as image fields
IMAGE_FIELD_TYPES = [
    'photo',
    'mother_photo',
    'father_photo',
    'barcode',
    'qr_code',
    'signature',
    'image',
]

# Field name patterns (for fields that might be labeled as 'text' but are images)
# NOTE: Must stay in sync with static/js/idcard-actions-upload.js IMAGE_FIELD_NAME_PATTERNS
IMAGE_FIELD_NAME_PATTERNS = [
    'photo',
    'f photo',
    'father photo',
    'm photo',
    'mother photo',
    'sign',
    'signature',
    'barcode',
    'qr',
    'qr_code',
    'image',
]

# =============================================================================
# FILE EXTENSIONS
# =============================================================================

# Valid image extensions supported for upload
VALID_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.heif']

# =============================================================================
# THUMBNAIL SETTINGS
# =============================================================================

# Default thumbnail dimensions (maintains aspect ratio)
THUMBNAIL_SIZE = (150, 150)

# Suffix added to thumbnail filenames
THUMBNAIL_SUFFIX = '_thumb'

# WebP quality for thumbnails (1-100)
THUMBNAIL_QUALITY = 85

# =============================================================================
# STORAGE PATHS
# =============================================================================

# Base folder for client images (relative to MEDIA_ROOT)
CLIENT_IMAGE_BASE_FOLDER = 'adarshimg'

# Upload paths for specific image types
UPLOAD_PATHS = {
    'staff_images': 'staff_imgs/',
    'client_images': 'clients_imgs/',
    'id_templates': 'id_templates/',
    'id_photos': 'id_photos/',
    'site_assets': 'site/',
}

# =============================================================================
# FILENAME PATTERNS
# =============================================================================

# Pattern for newly uploaded images: 14 digits (HHMMSSmmmuuuCC)
NEW_FILENAME_LENGTH = 14

# Pattern for updated images: original + underscore + 6-digit time (HHMMSS)
UPDATED_FILENAME_LENGTH = 21

# Legacy filename length (before upgrade)
LEGACY_FILENAME_LENGTH = 13
