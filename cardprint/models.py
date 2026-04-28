"""
Card Print Models
=================
Tracks print requests for ID cards (approved → generate_list → finalized → pool).
Modelled after ReprintRequest but for the print workflow.

The PrintRequest is a SEPARATE model that references the original IDCard
without modifying it — the card's main status stays 'approved'.
"""
import logging
import re

from django.conf import settings
from django.db import models
from django.db.models import Q

logger = logging.getLogger(__name__)


def _looks_like_supported_image_src(value):
    raw = str(value or '').strip().lower()
    if not raw:
        return False
    return (
        raw.startswith('data:image/')
        or raw.startswith('/media/')
        or raw.startswith('media/')
        or raw.startswith('http://')
        or raw.startswith('https://')
        or raw.endswith('.png')
        or raw.endswith('.jpg')
        or raw.endswith('.jpeg')
        or raw.endswith('.webp')
        or raw.endswith('.gif')
        or bool(re.search(r'\.(png|jpe?g|webp|gif)(\?.*)?$', raw))
    )


class PrintRequest(models.Model):
    """
    Tracks print requests for approved ID cards.
    Workflow: generate_list (queued for generation) → finalized (via Generate Card PDF) → pool
    """
    PRINT_STATUS_CHOICES = [
        ('generate_list', 'Generate List'),
        ('finalized', 'Finalized'),
        ('pool', 'Pool'),
    ]

    card = models.ForeignKey(
        'core.IDCard',
        on_delete=models.CASCADE,
        related_name='print_requests',
    )
    table = models.ForeignKey(
        'core.IDCardTable',
        on_delete=models.CASCADE,
        related_name='print_requests',
    )
    status = models.CharField(
        max_length=20,
        choices=PRINT_STATUS_CHOICES,
        default='generate_list',
        db_index=True,
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='print_requests',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Print #{self.id} — Card #{self.card_id} ({self.status})"

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['table', 'status']),
            models.Index(fields=['table', 'status', '-created_at']),
            models.Index(fields=['card']),
            models.Index(fields=['created_at']),
        ]


def validate_field_mappings(mappings):
    """Validate field_mappings structure. Returns error string or None if valid.

    Expected shape:
    {
      "front": {"FieldName": {"x_mm": N, "y_mm": N, "w_mm": N, "h_mm": N}},
      "back":  {"FieldName": {"x_mm": N, "y_mm": N, "w_mm": N, "h_mm": N}}
    }
    """
    if not isinstance(mappings, dict):
        return 'field_mappings must be a JSON object'

    allowed_sides = {'front', 'back'}
    if set(mappings.keys()) - allowed_sides:
        return f'field_mappings may only contain keys: {sorted(allowed_sides)}'

    required_keys = {'x_mm', 'y_mm', 'w_mm', 'h_mm'}
    for side in ('front', 'back'):
        side_data = mappings.get(side)
        if side_data is None:
            continue
        if not isinstance(side_data, dict):
            return f'field_mappings["{side}"] must be a JSON object'
        for field_name, coords in side_data.items():
            if not isinstance(coords, dict):
                return f'{side} > "{field_name}": expected coordinate object'
            missing = required_keys - set(coords.keys())
            if missing:
                return f'{side} > "{field_name}": missing {sorted(missing)}'
            for key in required_keys:
                val = coords[key]
                if not isinstance(val, (int, float)):
                    return f'{side} > "{field_name}" > {key}: must be a number'
    return None


def default_template_json():
    return {
        'canvas': {
            'width': 350,
            'height': 200,
            'unit': 'px',
            'realWidthMM': 85.6,
            'realHeightMM': 54.0,
            'safeMargin': 10,
            'bleed': 5,
            'printLayout': {
                'mode': '1',
                'columns': 1,
                'rows': 1,
                'marginMM': 8,
                'gapXMM': 4,
                'gapYMM': 4,
                'pageSize': 'a4',
            },
        },
        'elements': [],
    }


def validate_template_json(template_json):
    """Validate template_json structure. Returns error string or None if valid.

    Expected shape:
    {
            "canvas": {
                "width": 350,
                "height": 200,
                "unit": "px",
                "realWidthMM": 85.6,
                "realHeightMM": 54,
                "safeMargin": 10,
                "bleed": 5
            },
      "elements": [
        {
                    "type": "text" | "image" | "background" | "rectangle",
          "field": "name",
          "label": "Name",
          "x": 20,
          "y": 40,
          "width": 120,
          "height": 24,
          "fontSize": 12,
          "align": "left" | "center" | "right",
          "color": "#111111",
                    "side": "front" | "back" | "both",
                    "src": "/media/template-bg.png",
                    "locked": true
        }
      ]
    }
    """
    if not isinstance(template_json, dict):
        return 'template_json must be a JSON object'

    canvas = template_json.get('canvas')
    if canvas is None:
        return None
    if not isinstance(canvas, dict):
        return 'template_json.canvas must be a JSON object'
    for key in ('width', 'height', 'realWidthMM', 'realHeightMM', 'safeMargin', 'bleed'):
        if key in canvas and not isinstance(canvas.get(key), (int, float)):
            return f'template_json.canvas.{key} must be a number'
    if 'unit' in canvas and str(canvas.get('unit') or '').strip().lower() not in ('', 'px'):
        return 'template_json.canvas.unit must be px'

    elements = template_json.get('elements')
    if elements is None:
        return None
    if not isinstance(elements, list):
        return 'template_json.elements must be an array'

    for idx, elem in enumerate(elements):
        if not isinstance(elem, dict):
            return f'template_json.elements[{idx}] must be an object'

        elem_type = str(elem.get('type') or '').strip().lower()
        if elem_type not in ('text', 'image', 'background', 'rectangle'):
            return f'template_json.elements[{idx}].type must be text, image, background, or rectangle'

        field_name = str(elem.get('field') or '').strip()
        if elem_type == 'text' and not field_name:
            static_text = str(elem.get('label') or '').strip()
            if not static_text:
                return f'template_json.elements[{idx}] text requires field or label'

        if elem_type == 'image' and not field_name:
            static_src = str(elem.get('src') or elem.get('data_url') or '').strip()
            if not _looks_like_supported_image_src(static_src):
                return f'template_json.elements[{idx}] image requires field or valid src'

        if elem_type == 'background':
            src = str(elem.get('src') or '').strip()
            if not src:
                return f'template_json.elements[{idx}].src is required for background'

        for key in ('x', 'y', 'width', 'height'):
            if key in elem and not isinstance(elem.get(key), (int, float)):
                return f'template_json.elements[{idx}].{key} must be a number'

        if 'fontSize' in elem and not isinstance(elem.get('fontSize'), (int, float)):
            return f'template_json.elements[{idx}].fontSize must be a number'

        if 'side' in elem:
            side = str(elem.get('side') or '').strip().lower()
            if side not in ('front', 'back', 'both'):
                return f'template_json.elements[{idx}].side must be front, back, or both'

        if 'locked' in elem and not isinstance(elem.get('locked'), bool):
            return f'template_json.elements[{idx}].locked must be a boolean'

    return None


class CardTemplate(models.Model):
    """
    Stores design PDFs and coordinate mappings for Generate Card.
    Multiple templates can exist per IDCardTable.

    field_mappings format:
    {
      "front": {"FieldName": {"x_mm": 10.5, "y_mm": 5.0, "w_mm": 30.0, "h_mm": 8.0}},
      "back":  {"FieldName": {"x_mm": 5.0,  "y_mm": 5.0, "w_mm": 30.0, "h_mm": 8.0}}
    }
    Coordinates are top-left origin in millimetres.
    """
    FONT_CHOICES = [
        ('Helvetica-Bold', 'Arial Bold'),
        ('Helvetica', 'Arial Regular'),
    ]

    table = models.ForeignKey(
        'core.IDCardTable',
        on_delete=models.CASCADE,
        related_name='card_templates',
    )
    name = models.CharField(max_length=120, default='Default Template')
    version = models.PositiveIntegerField(default=1, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    is_default = models.BooleanField(default=False, db_index=True)
    parent_template = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='child_versions',
    )
    usage_count = models.PositiveIntegerField(default=0)
    last_used_at = models.DateTimeField(null=True, blank=True)
    template_json = models.JSONField(
        default=default_template_json,
        blank=True,
        help_text='Template-driven canvas data for field elements rendering.',
    )
    front_pdf = models.FileField(
        upload_to='card_templates/front/',
        null=True, blank=True,
        help_text='Front-side PDF template (87mm × 57mm)',
    )
    back_pdf = models.FileField(
        upload_to='card_templates/back/',
        null=True, blank=True,
        help_text='Back-side PDF template (87mm × 57mm)',
    )
    is_two_sided = models.BooleanField(default=False)
    field_config = models.JSONField(
        default=dict,
        blank=True,
        help_text='Pre-selected fields per side: {"is_two_sided": bool, "front_fields": [...], "back_fields": [...]}',
    )
    field_mappings = models.JSONField(
        default=dict,
        help_text='Coordinate mappings per side: {"front": {field: {x_mm, y_mm, w_mm, h_mm}}}',
    )
    font_size = models.IntegerField(default=8, help_text='Font size in points (7–10)')
    font_family = models.CharField(
        max_length=50,
        default='Helvetica-Bold',
        choices=FONT_CHOICES,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.name} v{self.version} ({self.table.name})'

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(fields=['table', 'version'], name='uniq_template_version_per_table'),
            models.UniqueConstraint(
                fields=['table'],
                condition=Q(is_default=True),
                name='uniq_default_template_per_table',
            ),
        ]

