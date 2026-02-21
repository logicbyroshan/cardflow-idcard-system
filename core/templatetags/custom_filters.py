from django import template
from django.utils.html import escape
from django.utils.safestring import mark_safe
import json
import re

# Import canonical constants from mediafiles
from mediafiles.constants import IMAGE_FIELD_TYPES, IMAGE_FIELD_NAME_PATTERNS

register = template.Library()

# ---------------------------------------------------------------------------
# safe_html filter — whitelist-based HTML sanitiser (no external deps)
# ---------------------------------------------------------------------------
_SAFE_TAGS = frozenset([
    'span', 'br', 'b', 'i', 'em', 'strong', 'u', 'small', 'mark', 'sub', 'sup',
])
# Matches any HTML tag (opening, closing, self-closing)
_TAG_RE = re.compile(r'<(/?)(\w+)([^>]*)(/?)>', re.IGNORECASE | re.DOTALL)
# Dangerous attribute patterns (event handlers, javascript: URIs)
_BAD_ATTR_RE = re.compile(r'\bon\w+\s*=|javascript\s*:', re.IGNORECASE)


def _sanitize_tag(match):
    """Keep whitelisted tags, strip dangerous attributes, escape others."""
    slash_open, tag_name, attrs, slash_close = match.groups()
    if tag_name.lower() not in _SAFE_TAGS:
        return ''  # strip non-whitelisted tag entirely
    # Strip dangerous attributes (onclick=, onerror=, javascript:, etc.)
    if _BAD_ATTR_RE.search(attrs):
        # Only keep class="..." and style="..." attribute pairs
        safe_attrs = re.findall(r'\b(?:class|style)\s*=\s*"[^"]*"', attrs, re.IGNORECASE)
        attrs = (' ' + ' '.join(safe_attrs)) if safe_attrs else ''
    return f'<{slash_open}{tag_name}{attrs}{slash_close}>'


@register.filter(name='safe_html')
def safe_html(value):
    """
    Allow only whitelisted inline HTML tags; strip everything else.
    Usage: {{ business.hero_title|safe_html }}
    """
    if not value:
        return ''
    result = _TAG_RE.sub(_sanitize_tag, str(value))
    return mark_safe(result)

# Canonical image column order (for consistent display)
IMAGE_COLUMN_ORDER = ['photo', 'father photo', 'f photo', 'mother photo', 'm photo', 'signature', 'sign', 'barcode', 'qr code', 'qr_code', 'qr']


def is_image_field_by_name(field_name):
    """
    Check if a field name contains any image-related patterns.
    This helps detect fields like 'PHOTO', 'F PHOTO', 'M PHOTO', 'SIGN', etc.
    Uses word boundary matching to avoid false positives like 'designation' matching 'sign'.
    """
    if not field_name:
        return False
    name_lower = field_name.lower()
    for pattern in IMAGE_FIELD_NAME_PATTERNS:
        # Use word boundary regex to avoid false positives
        if re.search(r'\b' + re.escape(pattern) + r'\b', name_lower):
            return True
    return False


def _is_image_field(field):
    """Helper to check if field dict is an image field"""
    if isinstance(field, dict):
        field_type = field.get('type', '')
        field_name = field.get('name', '')
        return field_type in IMAGE_FIELD_TYPES or is_image_field_by_name(field_name)
    return False


def _get_image_sort_key(field_name):
    """
    Get sort order for image fields based on canonical display order.
    Photo(0) → Father Photo(1) → Mother Photo(2) → Signature(3) → Barcode(4) → QR(5)
    
    Must stay in sync with BaseService._get_image_sort_key in core/services/base.py.
    """
    name_lower = field_name.lower().strip()
    
    # Check specific qualifiers FIRST (before generic "photo" match)
    if 'father' in name_lower or re.match(r'^f\s+', name_lower):
        return 1   # Father Photo / F Photo
    if 'mother' in name_lower or re.match(r'^m\s+', name_lower):
        return 2   # Mother Photo / M Photo
    if re.search(r'\bsign\b|\bsignature\b', name_lower):
        return 3   # Signature / Sign
    if 'barcode' in name_lower:
        return 4   # Barcode
    if 'qr' in name_lower:
        return 5   # QR Code
    if 'photo' in name_lower or 'image' in name_lower or 'pic' in name_lower:
        return 0   # Photo (generic/standalone)
    if 'back' in name_lower:
        return 6   # Back photo
    return 999  # Unknown image types go last


@register.filter
def get_field(field_data, key):
    """
    Get a value from a dictionary by key.
    Usage: {{ card.field_data|get_field:field.key }}
    """
    if field_data is None:
        return ''
    if isinstance(field_data, str):
        try:
            field_data = json.loads(field_data)
        except (json.JSONDecodeError, TypeError):
            return ''
    if isinstance(field_data, dict):
        return field_data.get(key, '')
    return ''

@register.filter
def json_encode(value):
    """
    Convert a Python object to JSON string.
    Usage: {{ table.fields|json_encode }}
    """
    import json
    if value is None:
        return '[]'
    return json.dumps(value)

@register.filter
def is_image_field(field_type):
    """
    Check if a field type is an image field.
    Usage: {% if field.type|is_image_field %}
    """
    return field_type in IMAGE_FIELD_TYPES


@register.filter
def is_image_field_or_name(field):
    """
    Check if a field is an image field by type OR by name pattern.
    Accepts a field dict with 'type' and 'name' keys.
    Usage: {% if field|is_image_field_or_name %}
    """
    if isinstance(field, dict):
        field_type = field.get('type', '')
        field_name = field.get('name', '')
        return field_type in IMAGE_FIELD_TYPES or is_image_field_by_name(field_name)
    return False


@register.simple_tag
def is_image_type(field_type):
    """
    Check if a field type is an image field (for use in templates).
    Usage: {% is_image_type field.type as is_img %}
    """
    return field_type in IMAGE_FIELD_TYPES


@register.filter
def get_image_class(field_name):
    """
    Get CSS class based on field name for different image types.
    Returns: 'photo-type', 'signature-type', 'qr-type', 'barcode-type'
    Uses word boundary matching to avoid 'designation' matching 'sign'.
    Usage: {{ field.name|get_image_class }}
    """
    if not field_name:
        return 'photo-type'
    name_lower = field_name.lower()
    # Use word boundary matching to prevent false positives
    if re.search(r'\bsign\b|\bsignature\b', name_lower):
        return 'signature-type'
    elif re.search(r'\bqr\b', name_lower):
        return 'qr-type'
    elif re.search(r'\bbarcode\b', name_lower):
        return 'barcode-type'
    else:
        return 'photo-type'


@register.filter
def expand_field_name(field_name):
    """
    Expand short field names to full descriptive names.
    E.g., 'F PHOTO' -> 'FATHER PHOTO', 'M PHOTO' -> 'MOTHER PHOTO'
    Usage: {{ field.name|expand_field_name }}
    """
    if not field_name:
        return field_name
    
    name_upper = field_name.upper().strip()
    
    # Map of short names to full names
    expansions = {
        'F PHOTO': 'FATHER PHOTO',
        'M PHOTO': 'MOTHER PHOTO',
        'F_PHOTO': 'FATHER PHOTO',
        'M_PHOTO': 'MOTHER PHOTO',
        'FPHOTO': 'FATHER PHOTO',
        'MPHOTO': 'MOTHER PHOTO',
        'F SIGN': 'FATHER SIGN',
        'M SIGN': 'MOTHER SIGN',
        'SIGN': 'SIGNATURE',
    }
    
    return expansions.get(name_upper, field_name)


@register.simple_tag
def check_image_field(field_type, field_name):
    """
    Check if a field is an image field by type OR by name pattern.
    Usage: {% check_image_field field.type field.name as is_img %}
    """
    return field_type in IMAGE_FIELD_TYPES or is_image_field_by_name(field_name)


@register.filter
def get_thumbnail_path(image_path):
    """
    Convert an image path to its thumbnail path.
    Inserts '/thumbs/' after the base folder to match server storage structure.
    
    Usage: {{ field.value|get_thumbnail_path }}
    
    Example:
        Input:  'adarshimg/ABCDE12345/14325123456101.jpg'
        Output: 'adarshimg/thumbs/ABCDE12345/14325123456101.jpg'
    
    Returns original path if conversion fails (fallback safe).
    """
    if not image_path or image_path == '' or image_path == 'NOT_FOUND':
        return image_path
    
    # Handle PENDING: prefix - return as-is (no thumbnail for pending)
    if isinstance(image_path, str) and image_path.startswith('PENDING:'):
        return image_path
    
    # Split path and insert 'thumbs' after the base folder
    try:
        parts = image_path.replace('\\', '/').split('/')
        if len(parts) >= 2:
            # e.g. adarshimg/CLIENT/file.jpg -> adarshimg/thumbs/CLIENT/file.jpg
            base_folder = parts[0]
            rest = '/'.join(parts[1:])
            return f"{base_folder}/thumbs/{rest}"
        else:
            # Just a filename
            return f"thumbs/{image_path}"
    except Exception:
        pass
    
    # Fallback to original path
    return image_path


@register.simple_tag
def cache_bust():
    """
    Generate a cache-busting timestamp for image URLs.
    Usage: {% cache_bust as cb %}
           <img src="/media/{{ path }}?t={{ cb }}">
    """
    import time
    return int(time.time())


@register.filter
def reorder_fields_for_display(fields):
    """
    Reorder fields for table display: text fields first, then image fields in canonical order.
    Image column order: Photo → Father Photo → Mother Photo → Signature → Barcode → QR Code
    
    Usage: {% for field in table.fields|reorder_fields_for_display %}
    """
    if not fields:
        return fields
    
    text_fields = []
    image_fields = []
    
    for field in fields:
        if _is_image_field(field):
            image_fields.append(field)
        else:
            text_fields.append(field)
    
    # Sort image fields by canonical order
    image_fields.sort(key=lambda f: _get_image_sort_key(f.get('name', '')))
    
    return text_fields + image_fields


@register.filter
def get_image_icon_name(field_name):
    """
    Get Font Awesome icon name based on field name for image types.
    Uses word boundary matching to avoid 'designation' matching 'sign'.
    Returns: 'user', 'signature', 'qrcode', 'barcode', or 'image'
    Usage: {{ field.name|get_image_icon_name }}
    """
    if not field_name:
        return 'image'
    name_lower = field_name.lower()
    name_upper = field_name.upper()
    
    if name_upper == 'PHOTO':
        return 'user'
    elif re.search(r'\bsign\b|\bsignature\b', name_lower):
        return 'signature'
    elif re.search(r'\bqr\b', name_lower):
        return 'qrcode'
    elif re.search(r'\bbarcode\b', name_lower):
        return 'barcode'
    else:
        return 'image'


@register.filter
def reorder_card_fields_for_display(ordered_fields):
    """
    Reorder card's ordered_fields for table display: text fields first, then image fields.
    Image column order: Photo → Father Photo → Mother Photo → Signature → Barcode → QR Code
    
    Usage: {% for field in card.ordered_fields|reorder_card_fields_for_display %}
    """
    if not ordered_fields:
        return ordered_fields
    
    text_fields = []
    image_fields = []
    
    for field in ordered_fields:
        if _is_image_field(field):
            image_fields.append(field)
        else:
            text_fields.append(field)
    
    # Sort image fields by canonical order
    image_fields.sort(key=lambda f: _get_image_sort_key(f.get('name', '')))
    
    return text_fields + image_fields

@register.filter
def getattr_filter(obj, attr):
    """
    Get an attribute of an object dynamically.
    Usage: {{ object|getattr:"field_name" }}
    """
    if obj is None:
        return None
    try:
        return getattr(obj, attr, None)
    except Exception:
        return None

# Alias so templates can use |getattr:
register.filter('getattr', getattr_filter)


@register.filter
def concat(value, arg):
    """
    Concatenate two strings.
    Usage: {{ "hero_image"|concat:idx }}  →  "hero_image1"
    """
    return str(value) + str(arg)


@register.filter
def make_range(value):
    """
    Return a range list [1 .. value].
    Usage: {% for i in 5|make_range %}  →  [1, 2, 3, 4, 5]
    """
    try:
        return range(1, int(value) + 1)
    except (ValueError, TypeError):
        return []


@register.filter(is_safe=True)
def wrap_header(value):
    """
    Insert <br> between words in column headers so they wrap
    inside narrow table columns instead of being cut off.
    Usage: {{ field.name|wrap_header }}  →  "Mother<br>Photo"
    """
    if not value:
        return value
    from django.utils.html import escape
    parts = str(value).split()
    if len(parts) <= 1:
        return escape(value)
    return mark_safe('<br>'.join(escape(p) for p in parts))


@register.filter
def get_column_width_class(field):
    """
    Return Tailwind width class for a dynamic column based on field name/type.
    Phase 5: Smart dynamic column detection.
    Usage: {{ field|get_column_width_class }}
    """
    if not isinstance(field, dict):
        return 'min-w-[80px]'
    
    field_name = (field.get('name', '') or '').lower()
    field_type = (field.get('type', '') or '').lower()
    
    # Phone/mobile/contact → 100px
    if re.search(r'\bphone\b|\bmobile\b|\bcontact\b|\bwhatsapp\b', field_name):
        return 'w-[100px] min-w-[100px]'
    
    # Date fields → 80px
    if field_type == 'date' or re.search(r'\bdob\b|\bdate\b', field_name):
        return 'w-[80px] min-w-[80px]'
    
    # Class/Section → 40px
    if re.search(r'^class$|^section$|^div$', field_name):
        return 'w-[40px] min-w-[40px]'
    
    # Blood group → 45px
    if re.search(r'\bblood\b|\bgroup\b', field_name):
        return 'w-[45px] min-w-[45px]'
    
    # Name fields → min 100px
    if re.search(r'\bname\b', field_name):
        return 'min-w-[100px]'
    
    # Gender → 40px
    if re.search(r'^gender$|^sex$', field_name):
        return 'w-[40px] min-w-[40px]'
    
    # Address/textarea → wider but constrained
    if field_type == 'textarea' or re.search(r'\baddress\b', field_name):
        return 'min-w-[100px] max-w-[180px]'
    
    # Default text → min 80px
    return 'min-w-[80px]'


@register.filter
def get_td_width_class(field):
    """
    Return the td width/wrap/alignment classes for a dynamic field.
    Phase 5: Smart cell sizing with word wrap.
    Usage: {{ field|get_td_width_class }}
    """
    if not isinstance(field, dict):
        return 'min-w-[80px] whitespace-normal break-words'
    
    field_name = (field.get('name', '') or '').lower()
    field_type = (field.get('type', '') or '').lower()
    
    # Phone/mobile → center, allow wrap per line
    if re.search(r'\bphone\b|\bmobile\b|\bcontact\b|\bwhatsapp\b', field_name):
        return 'w-[100px] whitespace-normal text-center'
    
    # Date → center, fixed, no wrap
    if field_type == 'date' or re.search(r'\bdob\b|\bdate\b', field_name):
        return 'w-[80px] whitespace-nowrap text-center'
    
    # Class/Section → center, compact
    if re.search(r'^class$|^section$|^div$', field_name):
        return 'w-[40px] text-center'
    
    # Blood group → center
    if re.search(r'\bblood\b|\bgroup\b', field_name):
        return 'w-[45px] text-center'
    
    # Name → left
    if re.search(r'\bname\b', field_name):
        return 'min-w-[100px] text-left'
    
    # Gender → center, compact
    if re.search(r'^gender$|^sex$', field_name):
        return 'w-[40px] text-center'
    
    # Address/textarea → left, wrap at spaces
    if field_type == 'textarea' or re.search(r'\baddress\b', field_name):
        return 'min-w-[100px] max-w-[180px] text-left'
    
    # Default → left
    return 'min-w-[80px] text-left'


@register.filter
def get_column_align_class(field):
    """
    Return alignment class for <th> headings.
    Number/date/short fields → center, text fields → left.
    Usage: {{ field|get_column_align_class }}
    """
    if not isinstance(field, dict):
        return 'text-center'
    
    field_name = (field.get('name', '') or '').lower()
    field_type = (field.get('type', '') or '').lower()
    
    # Phone/contact/date/class/section/gender/blood → center
    if re.search(r'\bphone\b|\bmobile\b|\bcontact\b|\bwhatsapp\b', field_name):
        return 'text-center'
    if field_type == 'date' or re.search(r'\bdob\b|\bdate\b', field_name):
        return 'text-center'
    if re.search(r'^class$|^section$|^div$|^gender$|^sex$', field_name):
        return 'text-center'
    if re.search(r'\bblood\b|\bgroup\b', field_name):
        return 'text-center'
    
    # Name, address, textarea → left
    if re.search(r'\bname\b', field_name):
        return 'text-left'
    if field_type == 'textarea' or re.search(r'\baddress\b', field_name):
        return 'text-left'
    
    # Default → left
    return 'text-left'