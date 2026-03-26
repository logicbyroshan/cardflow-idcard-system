"""
Mediafiles Utilities Module

Contains helper functions for media file handling:
- Folder code generation
- Filename generation (delegated to services.image_rename)
- Path utilities

NO STUBS. Real implementations only.
"""
import os
import re
import random
import string
import uuid
from datetime import datetime
from typing import Optional

from .constants import VALID_IMAGE_EXTENSIONS


# =============================================================================
# FOLDER CODE GENERATION
# =============================================================================

def generate_folder_code_from_name(name: str) -> str:
    """Generate a 5-character code from client name."""
    if not name:
        return generate_unique_suffix()
    words = re.sub(r'[^a-zA-Z0-9\s]', '', name).split()
    words = [w for w in words if w]
    if not words:
        return generate_unique_suffix()
    code = ''
    if len(words) >= 3:
        for word in words[:5]:
            if word:
                code += word[0].upper()
    elif len(words) == 2:
        code = words[0][:3].upper() + words[1][:2].upper()
    else:
        code = words[0][:5].upper()
    code = code[:5].ljust(5, 'X')
    return code


def generate_unique_suffix(length: int = 5) -> str:
    """Generate random alphanumeric suffix for folder codes."""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))


# =============================================================================
# FILENAME GENERATION (restored from backup — critical for unique filenames)
# =============================================================================

def generate_image_filename(batch_counter: int = 1, extension: str = '.jpg') -> str:
    """
    Generate a unique filename for newly uploaded images.
    Format: {HHMMSSmmmuuuCC}.ext (14 digits total)
    
    Args:
        batch_counter: Sequential number within current upload batch (1-99)
        extension: File extension including dot
    
    Returns:
        New filename string (14 digits + extension)
    """
    try:
        ext = _normalize_extension(extension)
        now = datetime.now()
        time_part = now.strftime('%H%M%S')
        microseconds = now.microsecond
        milliseconds = microseconds // 1000
        micros = microseconds % 1000
        mmm = str(milliseconds).zfill(3)
        uuu = str(micros).zfill(3)
        counter = batch_counter % 100
        filename = f"{time_part}{mmm}{uuu}{counter:02d}{ext}"
        return filename
    except Exception:
        return f"img{uuid.uuid4().hex[:10]}{extension or '.jpg'}"


def generate_updated_filename(existing_path: str, new_extension: Optional[str] = None) -> str:
    """
    Generate updated filename for existing images (update/reupload).
    Keeps the ORIGINAL 14-digit timestamp and adds underscore + 6-digit HHMMSS.
    """
    try:
        if existing_path and existing_path not in ['NOT_FOUND', '', 'PENDING']:
            filename = os.path.basename(existing_path)
        else:
            return generate_image_filename(1, new_extension or '.jpg')
        
        base_name, current_ext = os.path.splitext(filename)
        ext = _normalize_extension(new_extension) if new_extension else current_ext
        
        # If it already has underscore updates, extract original base
        if '_' in base_name:
            original_base = base_name.split('_')[0]
        else:
            original_base = base_name
        
        now = datetime.now()
        update_time = now.strftime('%H%M%S')
        new_filename = f"{original_base}_{update_time}{ext}"
        return new_filename
    except Exception:
        return generate_image_filename(1, new_extension or '.jpg')


def _normalize_extension(ext: str) -> str:
    """Normalize file extension to lowercase with leading dot."""
    if not ext:
        return '.jpg'
    ext = ext.lower()
    if not ext.startswith('.'):
        ext = '.' + ext
    if ext not in VALID_IMAGE_EXTENSIONS:
        return '.jpg'
    return ext


# =============================================================================
# PATH UTILITIES
# =============================================================================

def get_client_folder_path(folder_code: str) -> str:
    """Get the folder path for client images."""
    from .constants import CLIENT_IMAGE_BASE_FOLDER
    return f"{CLIENT_IMAGE_BASE_FOLDER}/{folder_code}"


def normalize_image_identifier(identifier: str) -> str:
    """Normalize an image identifier for consistent matching."""
    if not identifier:
        return ''
    result = str(identifier).strip()
    for ext in VALID_IMAGE_EXTENSIONS:
        if result.lower().endswith(ext):
            result = result[:-len(ext)]
            break
    try:
        num = float(result)
        if num == int(num):
            result = str(int(num))
    except (ValueError, TypeError):
        pass
    result = ' '.join(result.split()).upper()
    return result


def is_valid_image_path(path: Optional[str]) -> bool:
    """Check if a path represents a valid image path (not a placeholder)."""
    if not path:
        return False
    if path in ['NOT_FOUND', '', 'PENDING', None]:
        return False
    if path.startswith('PENDING:'):
        return False
    return True


def get_card_photo_url(card, field_data: Optional[dict] = None) -> Optional[str]:
    """
    Get the display photo URL for an IDCard, checking field_data first
    then falling back to the deprecated card.photo ImageField.

    Returns a URL string like '/media/adarshimg/...' or None.
    """
    from django.conf import settings
    from .constants import IMAGE_FIELD_TYPES

    fd = field_data if field_data is not None else (card.field_data or {})

    # 1. Check image fields in field_data (canonical source)
    #    Try well-known photo field names first, then scan all values
    for key in ('PHOTO', 'Photo', 'photo'):
        val = fd.get(key, '')
        if val and is_valid_image_path(val):
            return _ensure_media_url(val, settings.MEDIA_URL)

    # Scan remaining fields for image-like paths
    for val in fd.values():
        if isinstance(val, str) and is_valid_image_path(val):
            if 'adarshimg/' in val or val.endswith(('.jpg', '.jpeg', '.png', '.webp')):
                return _ensure_media_url(val, settings.MEDIA_URL)

    # 2. Legacy fallback: deprecated photo ImageField
    if card.photo:
        try:
            return card.photo.url
        except Exception:
            pass

    return None


def _ensure_media_url(path: str, media_url: str = '/media/') -> str:
    """Ensure a relative media path has the proper /media/ prefix."""
    if path.startswith(('/', 'http://', 'https://')):
        return path
    return f'{media_url}{path}'
