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

# Extended uppercase name patterns for export matching
IMAGE_FIELD_NAMES = [
    'PHOTO', 'SIGNATURE', 'IMAGE', 'PIC', 'PICTURE', 'SIGN',
    'MOTHER PHOTO', 'FATHER PHOTO', 'M PHOTO', 'F PHOTO',
    'BARCODE', 'QR CODE', 'QR'
]


# =============================================================================
# FIELD CLASSIFICATION
# =============================================================================

def is_image_field(field: Dict[str, Any]) -> bool:
    """
    Check if a field is an image field.
    
    Args:
        field: Field configuration dict with 'name' and 'type' keys
        
    Returns:
        True if field is image type, False otherwise
    """
    field_name = field.get('name', '').upper()
    field_type = field.get('type', 'text').lower()
    
    return (
        field_type in IMAGE_FIELD_TYPES or 
        field_name in IMAGE_FIELD_NAMES
    )


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
        field_info = {
            'name': field.get('name', ''),
            'type': field.get('type', 'text'),
            'is_image': is_image_field(field)
        }
        
        if field_info['is_image']:
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
    
    Args:
        value: Raw value
        uppercase: Whether to convert to uppercase
        
    Returns:
        Formatted string value
    """
    if value is None:
        return ''
    
    str_value = str(value).strip()
    
    if uppercase:
        return str_value.upper()
    
    return str_value


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
      • If a CLASS field exists  → primary sort by Class (A→Z),
                                    secondary sort by Name (A→Z)
      • If CLASS does NOT exist  → sort only by Name  (A→Z)
      • If neither is found      → return original order

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
    name_field = _find_field_name(field_names, _NAME_PATTERNS)

    # Nothing to sort by
    if not class_field and not name_field:
        return cards_list

    def _sort_key(card):
        fd = card.field_data or {}

        cls_val = str(fd.get(class_field, '') or '').strip().upper() if class_field else ''
        name_val = str(fd.get(name_field, '') or '').strip().upper() if name_field else ''

        if class_field:
            return (cls_val, name_val)
        return (name_val,)

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
