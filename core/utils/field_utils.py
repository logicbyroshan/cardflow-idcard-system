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

# Valid class values (preserved as-is during import)
# KG1 = LKG and KG2 = UKG — different schools use different names for the same level.
VALID_CLASS_VALUES = {
    'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
    'KG1', 'KG2', 'LKG', 'UKG', 'NURSERY', 'PRE-NURSERY', 'UG',
}

# Class upgrade progression: current → next
# Hierarchy: PRE-NURSERY → NURSERY → KG1/LKG → KG2/UKG → I → II → ... → XII → UG
# Schools using LKG/UKG naming: NURSERY → LKG → UKG → I
# Schools using KG1/KG2 naming: NURSERY → KG1 → KG2 → I
CLASS_UPGRADE_MAP = {
    'PRE-NURSERY': 'NURSERY',
    'PRE NURSERY': 'NURSERY',
    'PRENURSERY': 'NURSERY',
    'NURSERY': 'KG1',
    'LKG': 'UKG',
    'KG1': 'KG2',
    'UKG': 'I',
    'KG2': 'I',
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
    'XII': 'UG',
}

# Logical class ordering (lower index = earlier). Used for sorting/filtering.
# KG1=LKG and KG2=UKG are at the same level (aliases).
CLASS_ORDER = {
    'PRE-NURSERY': 0, 'PRE NURSERY': 0, 'PRENURSERY': 0,
    'NURSERY': 1, 'NUR': 1,
    'LKG': 2, 'KG1': 2, 'L.K.G': 2, 'L.K.G.': 2,
    'UKG': 3, 'KG2': 3, 'U.K.G': 3, 'U.K.G.': 3,
    'I': 4, '1': 4,
    'II': 5, '2': 5,
    'III': 6, '3': 6,
    'IV': 7, '4': 7,
    'V': 8, '5': 8,
    'VI': 9, '6': 9,
    'VII': 10, '7': 10,
    'VIII': 11, '8': 11,
    'IX': 12, '9': 12,
    'X': 13, '10': 13,
    'XI': 14, '11': 14,
    'XII': 15, '12': 15,
    'UG': 16,
}
CLASS_ORDER_UNKNOWN = 99


# ==================== CONVERSION FUNCTIONS ====================

def validate_image_bytes(image_bytes):
    """Validate that image bytes represent a valid image."""
    from mediafiles.services import ImageService
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
