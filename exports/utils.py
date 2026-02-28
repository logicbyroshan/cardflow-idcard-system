"""
Exports Utilities Module

Common helper functions used across all export formats.
This module is READ-ONLY - it never mutates data.
"""
import re
from typing import List, Dict, Any, Optional

# Import canonical constants from mediafiles
from mediafiles.constants import IMAGE_FIELD_TYPES


# =============================================================================
# FIELD TYPE CONSTANTS (Extended for export name matching)
# =============================================================================

# Keywords checked as substrings in field names (case-insensitive)
_IMAGE_NAME_KEYWORDS = [
    'photo', 'signature', 'sign', 'image', 'pic', 'picture', 'barcode', 'qr',
]

# Fixed dimensions for each image subtype (height × width in cm)
IMAGE_SUBTYPE_DIMENSIONS = {
    'photo':        {'height_cm': 2.5,  'width_cm': 1.95},
    'mother_photo': {'height_cm': 2.0,  'width_cm': 1.5},
    'father_photo': {'height_cm': 2.0,  'width_cm': 1.5},
    'signature':    {'height_cm': 0.5,  'width_cm': 1.9},
    'qr_code':      {'height_cm': 1.0,  'width_cm': 1.0},
    'barcode':      {'height_cm': 1.0,  'width_cm': 1.5},
}
_DEFAULT_IMAGE_DIMENSIONS = {'height_cm': 2.5, 'width_cm': 1.95}


# =============================================================================
# FIELD CLASSIFICATION
# =============================================================================

def is_image_field(field: Dict[str, Any]) -> bool:
    """
    Check if a field is an image field.
    
    Uses two strategies:
      1. Explicit type match (e.g. type='photo', 'mother_photo', 'signature')
      2. Substring match on field name (e.g. 'Student Photo' contains 'photo')
    
    Args:
        field: Field configuration dict with 'name' and 'type' keys
        
    Returns:
        True if field is image type, False otherwise
    """
    field_type = field.get('type', 'text').lower()
    if field_type in IMAGE_FIELD_TYPES:
        return True
    name_lower = field.get('name', '').lower().strip()
    return any(kw in name_lower for kw in _IMAGE_NAME_KEYWORDS)


def classify_image_subtype(field: Dict[str, Any]) -> Optional[str]:
    """
    Classify an image field into a specific subtype.
    
    Returns one of: 'photo', 'mother_photo', 'father_photo', 'signature',
                    'qr_code', 'barcode', or None if not an image field.
    
    The subtype determines fixed export dimensions (see IMAGE_SUBTYPE_DIMENSIONS).
    """
    field_type = field.get('type', 'text').lower()
    
    # Direct type mapping (most reliable — set explicitly in table config)
    _TYPE_MAP = {
        'photo': 'photo', 'mother_photo': 'mother_photo',
        'father_photo': 'father_photo', 'signature': 'signature',
        'barcode': 'barcode', 'qr_code': 'qr_code', 'image': 'photo',
    }
    if field_type in _TYPE_MAP:
        return _TYPE_MAP[field_type]
    
    # Name-based detection (fallback for type='text' with image-like name)
    name_lower = field.get('name', '').lower().strip()
    name_norm = re.sub(r'[\s_]+', ' ', name_lower)
    
    # Parent photos — check before generic 'photo' to avoid false match
    if ('mother' in name_lower and 'photo' in name_lower) or name_norm in ('m photo',):
        return 'mother_photo'
    if ('father' in name_lower and 'photo' in name_lower) or name_norm in ('f photo',):
        return 'father_photo'
    # Signature
    if 'sign' in name_lower:
        return 'signature'
    # Barcode
    if 'barcode' in name_lower:
        return 'barcode'
    # QR code
    if 'qr' in name_lower:
        return 'qr_code'
    # Generic photo (catch-all)
    if any(kw in name_lower for kw in ('photo', 'pic', 'picture', 'image')):
        return 'photo'
    return None


def get_image_dimensions(field: Dict[str, Any]) -> Dict[str, float]:
    """
    Get fixed height and width dimensions (cm) for an image field.
    
    Returns dict with 'height_cm' and 'width_cm' keys.
    Dimensions are determined by the image subtype (photo, signature, etc.).
    """
    subtype = classify_image_subtype(field)
    if subtype and subtype in IMAGE_SUBTYPE_DIMENSIONS:
        return IMAGE_SUBTYPE_DIMENSIONS[subtype].copy()
    return _DEFAULT_IMAGE_DIMENSIONS.copy()


def get_text_fields(fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filter to get only text fields (non-image fields).
    
    Args:
        fields: List of field configurations
        
    Returns:
        List of text-only fields
    """
    return [f for f in fields if not is_image_field(f)]


def get_image_fields(fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filter to get only image fields.
    
    Args:
        fields: List of field configurations
        
    Returns:
        List of image fields
    """
    return [f for f in fields if is_image_field(f)]


def get_image_field_names(fields: List[Dict[str, Any]]) -> List[str]:
    """
    Get list of image field names from field configuration.
    
    Args:
        fields: List of field configurations
        
    Returns:
        List of field names that are image fields
    """
    return [f['name'] for f in get_image_fields(fields)]


def separate_fields_by_type(fields: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Separate fields into text and image categories.
    
    Args:
        fields: List of field configurations
        
    Returns:
        Dict with 'text' and 'image' keys containing respective field lists
    """
    text_fields = []
    image_fields = []
    
    for field in fields:
        is_img = is_image_field(field)
        field_info = {
            'name': field.get('name', ''),
            'type': field.get('type', 'text'),
            'is_image': is_img,
        }
        
        if is_img:
            dims = get_image_dimensions(field)
            field_info['image_subtype'] = classify_image_subtype(field)
            field_info['image_height_cm'] = dims['height_cm']
            field_info['image_width_cm'] = dims['width_cm']
            image_fields.append(field_info)
        else:
            text_fields.append(field_info)
    
    return {
        'text': text_fields,
        'image': image_fields
    }


# =============================================================================
# FILENAME GENERATION
# =============================================================================

def generate_export_filename(base_name: str, extension: str, timestamp: bool = True, client_name: str = '', status: str = '') -> str:
    """
    Generate a clean filename for export.
    
    Format: ClientName_TableName_Status.ext
    
    Args:
        base_name: Base name for the file (e.g., table name / list name)
        extension: File extension (e.g., 'xlsx', 'docx', 'zip')
        timestamp: (kept for backward compat, ignored now)
        client_name: Client/institution name to prefix
        status: Status label (e.g., 'pending', 'verified', 'approved')
        
    Returns:
        Clean filename string like "RoshanDamor_StudentList_Pending.pdf"
    """
    clean_base = clean_filename(base_name)
    
    parts = []
    if client_name:
        parts.append(clean_filename(client_name))
    parts.append(clean_base)
    if status:
        parts.append(clean_filename(status.capitalize()))
    
    name_part = '_'.join(parts)
    
    # Cap total filename length (without extension) to 150
    if len(name_part) > 150:
        name_part = name_part[:150].rstrip('_.')
    
    return f"{name_part}.{extension.lower()}"


def clean_filename(name: str) -> str:
    """
    Clean a string for use in filenames.
    
    Args:
        name: Raw name string
        
    Returns:
        Cleaned string safe for filenames
    """
    if not name:
        return 'export'
    
    # Strip null bytes and control characters
    clean = re.sub(r'[\x00-\x1f\x7f]', '', name)
    # Remove or replace invalid characters
    clean = re.sub(r'[<>:"/\\|?*]', '', clean)
    # Replace multiple spaces/underscores with single underscore
    clean = re.sub(r'[\s_]+', '_', clean)
    # Remove leading/trailing underscores and dots (Windows issue)
    clean = clean.strip('_.')
    # Truncate if too long
    if len(clean) > 50:
        clean = clean[:50].rstrip('_.')
    # Block Windows reserved device names
    if re.match(r'^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$', clean, re.IGNORECASE):
        clean = f'_{clean}'
    
    return clean or 'export'


def get_readable_field_name(field_name: str) -> str:
    """
    Convert field name to readable format for filenames.
    
    Args:
        field_name: Original field name
        
    Returns:
        Readable version for use in filenames
    """
    name_upper = field_name.upper().strip()
    
    # Common mappings
    mappings = {
        'F PHOTO': 'FATHER_PHOTO',
        'M PHOTO': 'MOTHER_PHOTO',
        'SIGN': 'SIGNATURE',
    }
    
    return mappings.get(name_upper, name_upper.replace(' ', '_'))


# =============================================================================
# DATA FORMATTING
# =============================================================================

def format_field_value(value: Any, uppercase: bool = False) -> str:
    """
    Format a field value for export.
    
    Strips values that look like image paths or pending image references
    so they don't leak into text columns.
    
    Args:
        value: Raw value
        uppercase: Whether to convert to uppercase
        
    Returns:
        Formatted string value
    """
    if value is None:
        return ''
    
    str_value = str(value).strip()
    
    if not str_value:
        return ''
    
    # Strip image-like values that shouldn't appear in text columns
    if _looks_like_image_data(str_value):
        return ''
    
    if uppercase:
        return str_value.upper()
    
    return str_value


# Image file extensions used to detect leaked image paths in text fields
_IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg')


def _looks_like_image_data(value: str) -> bool:
    """
    Check if a value looks like image path data that shouldn't appear as text.
    
    Catches:
    - PENDING:filename.jpg references
    - NOT_FOUND markers
    - File paths with image extensions (e.g. adarshimg/client/12345.jpg)
    """
    val_upper = value.upper().strip()
    
    # PENDING:filename or bare PENDING
    if val_upper.startswith('PENDING:') or val_upper == 'PENDING':
        return True
    
    # NOT_FOUND marker
    if val_upper == 'NOT_FOUND':
        return True
    
    # File path with image extension (e.g. adarshimg/XYZ/12345.jpg)
    val_lower = value.lower().strip()
    if '/' in val_lower and val_lower.endswith(_IMAGE_EXTENSIONS):
        return True
    
    return False


def is_valid_image_path(path: Optional[str]) -> bool:
    """
    Check if a path represents a valid image reference.
    
    Args:
        path: Image path string (can be None)
        
    Returns:
        True if path is valid, False if placeholder/empty/traversal
    """
    if not path:
        return False
    
    invalid_values = ['NOT_FOUND', '', 'PENDING', 'null', 'None']
    
    if path in invalid_values:
        return False
    
    if path.startswith('PENDING:'):
        return False
    
    # Path traversal protection
    if '..' in path or path.startswith('/') or path.startswith('\\'):
        return False
    
    return True


# =============================================================================
# EXPORT SORTING
# =============================================================================

# Field name patterns used to detect sort-relevant columns
_CLASS_PATTERNS = ['CLASS']
_SECTION_PATTERNS = ['SECTION', 'SEC']
_NAME_PATTERNS = ['NAME', 'STUDENT', 'EMPNAME', 'STUDENT NAME', 'EMP NAME']

# Logical class ordering for exports (lower index = earlier in sort order)
# Uses the canonical CLASS_ORDER from field_utils.py.
from core.utils.field_utils import CLASS_ORDER as _CLASS_ORDER, CLASS_ORDER_UNKNOWN as _CLASS_ORDER_UNKNOWN


def _find_field_name(field_names: List[str], patterns: List[str]) -> Optional[str]:
    """
    Find the first field name that matches any of the given patterns.

    Matching is done on the UPPER-CASED field name:
      1. Exact match first  (e.g. 'CLASS' == 'CLASS')
      2. Substring match    (e.g. 'STUDENT NAME' contains 'NAME')

    Args:
        field_names: List of field names from the table config
        patterns:    List of uppercase patterns to search for

    Returns:
        Matched field name (original casing) or None
    """
    upper_map = {fn.upper(): fn for fn in field_names}

    # 1. Exact match
    for pat in patterns:
        if pat in upper_map:
            return upper_map[pat]

    # 2. Substring match (longer patterns first to prefer specific matches)
    sorted_patterns = sorted(patterns, key=len, reverse=True)
    for pat in sorted_patterns:
        for upper_name, orig_name in upper_map.items():
            if pat in upper_name:
                return orig_name

    return None


def sort_cards_for_export(
    cards_list: list,
    table_fields: Optional[List[Dict[str, Any]]] = None
) -> list:
    """
    Sort cards for export output.

    Sorting rules (applied to field_data values, case-insensitive):
      • Name (A→Z), then Section (A→Z), then Class (logical order)
      • If none of Name/Section/Class found → original order

    This function is the SINGLE source of export sort logic.
    Called by Word, Excel, and PDF exporters.

    Args:
        cards_list:   Python list of IDCard instances (already fetched)
        table_fields: The table.fields list (list of dicts with 'name' key)

    Returns:
        New sorted list (original list is not mutated)
    """
    if not cards_list or not table_fields:
        return cards_list

    field_names = [f.get('name', '') for f in table_fields]

    class_field = _find_field_name(field_names, _CLASS_PATTERNS)
    section_field = _find_field_name(field_names, _SECTION_PATTERNS)
    name_field = _find_field_name(field_names, _NAME_PATTERNS)

    # Nothing to sort by
    if not class_field and not section_field and not name_field:
        return cards_list

    def _sort_key(card):
        fd = card.field_data or {}

        cls_val = str(fd.get(class_field, '') or '').strip().upper() if class_field else ''
        sec_val = str(fd.get(section_field, '') or '').strip().upper() if section_field else ''
        name_val = str(fd.get(name_field, '') or '').strip().upper() if name_field else ''

        # Sort order: Name (A→Z), then Section (A→Z), then Class (logical order)
        cls_order = _CLASS_ORDER.get(cls_val, _CLASS_ORDER_UNKNOWN) if class_field else 0
        return (name_val, sec_val, cls_order, cls_val)

    return sorted(cards_list, key=_sort_key)


def get_class_field_name(table_fields: Optional[List[Dict[str, Any]]]) -> Optional[str]:
    """
    Return the CLASS field name from a table's field config, or None.

    Used by exporters that need class-based page breaks.

    Args:
        table_fields: The table.fields list (list of dicts with 'name' key)

    Returns:
        Matched CLASS field name (original casing) or None
    """
    if not table_fields:
        return None
    field_names = [f.get('name', '') for f in table_fields]
    return _find_field_name(field_names, _CLASS_PATTERNS)


# =============================================================================
# CHUNKED STREAMING DOWNLOAD
# =============================================================================

def stream_file_response(file_bytes, filename, content_type, chunk_size=1024 * 1024):
    """
    Stream a file download in chunks to keep memory usage low.

    For small files (<10 MB), returns a normal HttpResponse.
    For larger files, writes to a temp file on disk first,
    then streams from disk in ``chunk_size`` (default 1 MB) chunks
    using Django's StreamingHttpResponse.

    Args:
        file_bytes: The raw bytes of the file (bytes or BytesIO.getvalue()).
        filename:   Suggested download filename.
        content_type: MIME type for the response.
        chunk_size: Size of each chunk in bytes (default 1 MB).

    Returns:
        HttpResponse or StreamingHttpResponse
    """
    import os
    import tempfile
    from django.http import HttpResponse, StreamingHttpResponse

    size = len(file_bytes)

    # Small files: return directly — no disk I/O
    if size < 10 * 1024 * 1024:  # 10 MB
        response = HttpResponse(file_bytes, content_type=content_type)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        response['Content-Length'] = size
        return response

    # Large files: spool to temp file, then stream in chunks
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(filename)[1])
    try:
        tmp.write(file_bytes)
        tmp.flush()
        tmp.close()

        def _iter_chunks():
            try:
                with open(tmp.name, 'rb') as fh:
                    while True:
                        chunk = fh.read(chunk_size)
                        if not chunk:
                            break
                        yield chunk
            finally:
                # Clean up temp file after streaming is complete
                try:
                    os.unlink(tmp.name)
                except OSError:
                    pass

        response = StreamingHttpResponse(_iter_chunks(), content_type=content_type)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        response['Content-Length'] = size
        return response
    except Exception:
        # Cleanup on error
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        raise
