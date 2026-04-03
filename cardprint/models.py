"""
Card Print Models
=================
Tracks print requests for ID cards (approved → generate_list → finalized → pool).
Modelled after ReprintRequest but for the print workflow.

The PrintRequest is a SEPARATE model that references the original IDCard
without modifying it — the card's main status stays 'approved'.
"""
import logging

from django.conf import settings
from django.db import models

logger = logging.getLogger(__name__)


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


class CardTemplate(models.Model):
    """
    Stores design PDFs and coordinate mappings for Generate Card.
    One template per IDCardTable (one-to-one).

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

    table = models.OneToOneField(
        'core.IDCardTable',
        on_delete=models.CASCADE,
        related_name='card_template',
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
        return f'Template for {self.table.name}'

    class Meta:
        ordering = ['-created_at']
