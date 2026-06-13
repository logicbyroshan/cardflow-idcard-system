import logging
import re

from django.conf import settings
from django.db import models
from client.models import Client

# Import canonical constants
from mediafiles.constants import IMAGE_FIELD_TYPES

logger = logging.getLogger(__name__)


def _field_name_tokens(name):
    """Return normalized alphanumeric tokens from a field label."""
    return {tok for tok in re.split(r'[^a-z0-9]+', str(name or '').strip().lower()) if tok}


# ---------------------------------------------------------------------------
#   Text sanitizer — strips non-Latin-1 characters that cause ■ in PDF
# ---------------------------------------------------------------------------
_MULTI_SPACE_RE = re.compile(r' {2,}')

# Image-like values that should NOT be sanitized (contain paths/markers)
_IMAGE_PREFIXES = ('PENDING:', 'NOT_FOUND', 'adarshimg/', 'clients_imgs/',
                   'id_card_images/', 'id_photos/', 'staff_imgs/')

# Pre-compiled regex patterns for fast sanitization (10-50x faster than
# character-by-character Python loop).
# Step 1: Replace whitespace control chars (\t \n \r \x0b \x0c) with space
_WS_CTRL_RE = re.compile(r'[\t\n\r\x0b\x0c]')
# Step 2: Remove C0 control characters (0x00-0x1F) + DEL (0x7F) not caught above
_C0_CTRL_RE = re.compile(r'[\x00-\x1f\x7f]')
# Step 3: Replace C1 control characters (0x80-0x9F) and everything above
#          Latin-1 Supplement (U+00FF) with space.
#          Keeps: 0x20-0x7E (Basic Latin) and 0xA0-0xFF (Latin-1 Supplement)
_NON_LATIN1_RE = re.compile(r'[\x80-\x9f\u0100-\U0010ffff]')


def sanitize_text_for_storage(value: str) -> str:
    """Strip characters outside Helvetica's renderable range (0x20-0xFF).

    Called during IDCard.save() so that *every* write path is covered.
    Image paths / PENDING markers are passed through unchanged.

    Only TEXT values are cleaned — this keeps the stored data in a safe
    subset (Basic Latin + Latin-1 Supplement) that fonts used in PDF,
    Word and Excel exports can render without ■ black boxes.

    Performance: uses pre-compiled regex patterns instead of character-by-
    character Python iteration (10-50x faster for typical field values).
    """
    if not value or not isinstance(value, str):
        return value

    # Don't touch image paths / pending markers
    if '/' in value and any(value.startswith(p) for p in _IMAGE_PREFIXES):
        return value
    for prefix in _IMAGE_PREFIXES:
        if value.startswith(prefix):
            return value

    # Regex-based sanitization (replaces the old char-by-char loop)
    result = _WS_CTRL_RE.sub(' ', value)       # whitespace controls → space
    result = _C0_CTRL_RE.sub('', result)        # remaining C0 controls → remove
    result = _NON_LATIN1_RE.sub(' ', result)    # C1 + non-Latin-1 → space
    return _MULTI_SPACE_RE.sub(' ', result).strip()


class IDCardGroup(models.Model):
    """id-card-group-model
    ID Card Group/Template for a client

    NOTE: app_label='core' preserved for migration compatibility.
    Model code moved from core/models.py to idcards/models.py
    """
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='id_card_groups')
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True)
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        client_name = self.client.name if self.client_id else 'No Client'
        return f"{self.name} - {client_name}"
    
    def delete_all_table_images(self):
        """Delete all images from all tables in this group"""
        for table in self.tables.all():
            table.delete_all_card_images()
    
    def delete(self, *args, **kwargs):
        # Delete all images before deleting group
        self.delete_all_table_images()
        super().delete(*args, **kwargs)
    
    class Meta:
        app_label = 'core'  # Keep migration compatibility - model stays in core migrations
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['client', 'is_active']),
            models.Index(fields=['is_active']),
            models.Index(fields=['created_at']),
        ]


class IDCardTable(models.Model):
    """
    ID Card Table - stores field configuration for a group
    Client can have max 20 fields of any type
    
    NOTE: app_label='core' preserved for migration compatibility.
    Model code moved from core/models.py to workflows/models.py
    """
    FIELD_TYPE_CHOICES = [
        ('text', 'Text'),
        ('email', 'Email'),
        ('class', 'Class'),
        ('section', 'Section'),
        ('photo', 'Photo'),
        ('rel_photo', 'Relation Photo'),
        # Legacy aliases kept for existing table configurations
        ('mother_photo', 'Mother Photo (Legacy)'),
        ('father_photo', 'Father Photo (Legacy)'),
        ('barcode', 'Barcode'),
        ('qr_code', 'QR Code'),
        ('signature', 'Signature'),
    ]
    
    group = models.ForeignKey(IDCardGroup, on_delete=models.CASCADE, related_name='tables')
    name = models.CharField(max_length=255)
    fields = models.JSONField(default=list, help_text='List of field configurations: [{name, type, order}]')
    is_active = models.BooleanField(default=True)
    deleted_by_client = models.BooleanField(
        default=False,
        help_text='True when the client soft-deletes this table. Hidden from client views; '
                  'still visible in admin as "User Deleted".'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} - {self.group.name}"
    
    def has_class_field(self):
        """Check if this table has a class field"""
        class_tokens = {'class', 'std', 'standard', 'grade'}
        return any(
            f.get('type') == 'class' or bool(_field_name_tokens(f.get('name', '')) & class_tokens)
            for f in self.fields
        )
    
    def has_section_field(self):
        """Check if this table has a section field"""
        section_tokens = {'section', 'sec', 'div', 'division'}
        return any(
            f.get('type') == 'section' or bool(_field_name_tokens(f.get('name', '')) & section_tokens)
            for f in self.fields
        )

    def has_course_field(self):
        """Check if this table has a course field."""
        course_tokens = {'course', 'program', 'programme'}
        return any(
            f.get('type') == 'course' or bool(_field_name_tokens(f.get('name', '')) & course_tokens)
            for f in self.fields
        )

    def has_branch_field(self):
        """Check if this table has a branch/stream field."""
        branch_tokens = {'branch', 'stream', 'dept', 'department'}
        return any(
            f.get('type') == 'branch' or bool(_field_name_tokens(f.get('name', '')) & branch_tokens)
            for f in self.fields
        )
    
    def has_image_fields(self):
        """Check if this table has any image fields (uses canonical IMAGE_FIELD_TYPES)"""
        return any(f.get('type') in IMAGE_FIELD_TYPES for f in self.fields)
    
    def get_image_fields(self):
        """Get list of image field names (uses canonical IMAGE_FIELD_TYPES)"""
        return [f.get('name') for f in self.fields if f.get('type') in IMAGE_FIELD_TYPES]
    
    def delete_all_card_images(self):
        """Delete all images associated with cards in this table.
        Uses .iterator() to avoid loading all cards into memory at once."""
        for card in self.id_cards.all().iterator(chunk_size=200):
            card.delete_images()
    
    def delete(self, *args, **kwargs):
        # Delete all card images before deleting table
        self.delete_all_card_images()
        super().delete(*args, **kwargs)
    
    class Meta:
        app_label = 'core'  # Keep migration compatibility - model stays in core migrations
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['is_active']),
            models.Index(fields=['created_at']),
            models.Index(fields=['group', 'is_active']),  # composite for filtered table lists
        ]
    
    def clean(self):
        from django.core.exceptions import ValidationError
        if len(self.fields) > 20:
            raise ValidationError('Maximum 20 fields allowed per table.')
    
    def save(self, *args, **kwargs):
        # Enforce field limit on every save, not just via full_clean()
        if len(self.fields) > 20:
            from django.core.exceptions import ValidationError
            raise ValidationError('Maximum 20 fields allowed per table.')
        super().save(*args, **kwargs)


class IDCard(models.Model):
    """
    Individual ID Card - linked to a specific table within a group
    
    NOTE: app_label='core' preserved for migration compatibility.
    Model code moved from core/models.py to workflows/models.py
    
    DEPRECATION NOTICE (Phase 4 - Media Refactor):
    - The 'photo' ImageField is DEPRECATED for new uploads
    - Images in 'field_data' JSONField (e.g., field_data['photo_path']) are DEPRECATED
    - New uploads create CardMedia records in mediafiles app (dual-write for now)
    - Read operations should use ImageService.get_image_path_for_card() which
      checks CardMedia first, then falls back to field_data for backward compatibility
    - Do NOT add new code that writes directly to photo or field_data image fields
    - Instead, use ImageService.save_image_with_media_record() or create_media_record()
    """
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('verified', 'Verified'),
        ('pool', 'In Pool'),
        ('approved', 'Approved'),
        ('download', 'Downloaded'),
        ('reprint', 'Reprint'),
    ]
    
    table = models.ForeignKey(IDCardTable, on_delete=models.CASCADE, related_name='id_cards')
    
    # Dynamic field data stored as JSON (based on table's field configuration)
    # DEPRECATION NOTICE: Image paths stored in field_data are deprecated
    # New code should use CardMedia model in mediafiles app for image storage
    # Reads still fall back to field_data for backward compatibility
    field_data = models.JSONField(default=dict, help_text='Dynamic field values based on table fields. NOTE: Image paths here are deprecated - use CardMedia model.')
    
    # DEPRECATED: Use CardMedia model in mediafiles app instead
    # This field is kept for backward compatibility - do not remove without migration
    photo = models.ImageField(
        upload_to='id_photos/', 
        blank=True, 
        null=True,
        help_text='DEPRECATED: Use CardMedia model for new photos'
    )
    # Original photo name from Excel (for matching during image reupload)
    original_photo_name = models.CharField(max_length=255, blank=True, null=True, db_index=True, help_text='Original photo name from Excel for matching')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_index=True)
    downloaded_at = models.DateTimeField(null=True, blank=True, help_text='Timestamp when card was moved to downloaded status')
    deleted_at = models.DateTimeField(null=True, blank=True, help_text='Timestamp when card was moved to pool')
    status_changed_at = models.DateTimeField(null=True, blank=True, help_text='Timestamp when card status last changed (not updated by field edits — used for default list sort)')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    modified_by = models.CharField(
        max_length=150,
        blank=True,
        default='',
        help_text='Username of the user who last modified this card',
    )

    def __str__(self):
        # Try to get a name field from field_data (with null safety)
        field_data = self.field_data or {}
        name = field_data.get('name', field_data.get('Name', f'Card #{self.id}'))
        table_name = self.table.name if self.table_id else 'Unknown Table'
        return f"{name} - {table_name}"
    
    @property
    def group(self):
        """Get the group this card belongs to via table (null-safe)"""
        return self.table.group if self.table else None
    
    @property
    def client(self):
        """Get the client this card belongs to via table -> group (null-safe)"""
        if self.table and self.table.group:
            return self.table.group.client
        return None
    
    def delete_images(self):
        """Delete all image files associated with this card (incl. thumbnails)"""
        from mediafiles.services import ImageService
        
        # Delete images from field_data (uses ImageService to also clean thumbnails)
        if self.field_data:
            for field_name, value in self.field_data.items():
                if value and isinstance(value, str) and value not in ['NOT_FOUND', '']:
                    if 'adarshimg/' in value or 'id_card_images/' in value:
                        try:
                            ImageService.delete_image(value)
                        except Exception as e:
                            logger.warning("Could not delete image %s: %s", value, e)
        
        # Delete legacy photo field if exists
        if self.photo:
            try:
                from django.core.files.storage import default_storage
                if default_storage.exists(self.photo.name):
                    default_storage.delete(self.photo.name)
                    logger.debug("Deleted photo: %s", self.photo.name)
            except Exception as e:
                logger.warning("Could not delete photo: %s", e)
    
    def delete(self, *args, **kwargs):
        # Delete images before deleting card
        self.delete_images()
        super().delete(*args, **kwargs)

    def save(self, *args, **kwargs):
        """Auto-sanitize field_data text values before every save.
        
        Strips characters outside the Helvetica-safe Latin range (0x20-0xFF)
        so PDFs never render ■ black boxes.  Image paths are left untouched.
        """
        if self.field_data and isinstance(self.field_data, dict):
            for key, value in self.field_data.items():
                if isinstance(value, str):
                    self.field_data[key] = sanitize_text_for_storage(value)
        super().save(*args, **kwargs)
    
    class Meta:
        app_label = 'core'  # Keep migration compatibility - model stays in core migrations
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['table', 'status']),
            models.Index(fields=['status', 'created_at']),
            models.Index(fields=['table', 'created_at']),
            models.Index(fields=['created_at']),
            models.Index(fields=['updated_at']),
            # Performance indexes added in Block 1 audit
            models.Index(fields=['table', 'status', '-id'], name='idcard_tbl_status_id_desc'),
            models.Index(fields=['table', 'status', '-status_changed_at', '-id'], name='idc_tbl_st_chg_id_idx'),
            models.Index(fields=['table', 'status', '-downloaded_at', '-id'], name='idc_tbl_st_dld_id_idx'),
            models.Index(fields=['table', 'status', '-deleted_at', '-id'], name='idc_tbl_st_del_id_idx'),
            models.Index(fields=['downloaded_at'], name='idcard_downloaded_at_idx'),
            models.Index(fields=['deleted_at'], name='idcard_deleted_at_idx'),
            models.Index(fields=['status_changed_at'], name='idcard_status_changed_at_idx'),
            # GIN index for fast JSON search is added via migration 0024 (PostgreSQL only)
        ]

# Legacy import for reprintcard (Phase 4 Cleanup)
try:
    from reprintcard.models import ReprintRequest
except ImportError:
    pass


# ── Row Scoping distinct cache invalidation signals ──
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

@receiver(post_save, sender=IDCard)
@receiver(post_delete, sender=IDCard)
def clear_idcard_distinct_values_cache(sender, instance, **kwargs):
    """Clear distinct values cache when card data changes."""
    table_id = getattr(instance, 'table_id', None)
    if table_id:
        from core.views.idcard_helpers import invalidate_table_distinct_cache
        invalidate_table_distinct_cache(table_id)



