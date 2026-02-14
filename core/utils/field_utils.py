"""
Field Conversion & Validation Utilities
========================================
Canonical location for class/section conversion helpers and image validation.
These are pure utility functions with NO model or view dependencies.

Architecture rule: Services and views import FROM here.
NEVER import these from a views module.
"""

# ==================== CLASS/SECTION CONVERSION CONSTANTS ====================

# Mapping of numeric values to Roman numerals for class field conversion
NUMERIC_TO_ROMAN = {
    '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V',
    '6': 'VI', '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X',
    '11': 'XI', '12': 'XII',
}

# Valid Roman class values (preserved as-is during import)
VALID_CLASS_VALUES = {
    'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
    'KG', 'KG1', 'KG2', 'LKG', 'UKG', 'NURSERY',
}

# Class upgrade progression: current → next
CLASS_UPGRADE_MAP = {
    'NURSERY': 'LKG',
    'LKG': 'UKG',
    'UKG': 'KG',
    'KG': 'I',
    'I': 'II',
    'II': 'III',
    'III': 'IV',
    'IV': 'V',
    'V': 'VI',
    'VI': 'VII',
    'VII': 'VIII',
    'VIII': 'IX',
    'IX': 'X',
    'X': 'XI',
    'XI': 'XII',
    # XII is max — stays as XII
}


# ==================== CONVERSION FUNCTIONS ====================

def validate_image_bytes(image_bytes):
    """Validate that image bytes represent a valid image."""
    from core.services.image_service import ImageService
    return ImageService.validate_image_bytes(image_bytes)


def convert_class_value(value):
    """
    Convert a class value from XLSX:
    - Numeric (1-12) → Roman numeral
    - Existing Roman numerals → preserved
    - KG, LKG, UKG, Nursery → preserved (uppercased)
    """
    if not value:
        return value
    val = str(value).strip().upper()
    # If it's a numeric string, convert to Roman
    if val in NUMERIC_TO_ROMAN:
        return NUMERIC_TO_ROMAN[val]
    # If it's already a valid class value, preserve it
    if val in VALID_CLASS_VALUES:
        return val
    # Return as-is (uppercase) for unrecognized values
    return val


def convert_section_value(value):
    """
    Convert a section value from XLSX:
    - Always convert to uppercase
    """
    if not value:
        return value
    return str(value).strip().upper()
