import logging

from django.conf import settings
from django.db import models
from client.models import Client

# Import canonical constants
from mediafiles.constants import IMAGE_FIELD_TYPES

logger = logging.getLogger(__name__)


class IDCardGroup(models.Model):
    """
    ID Card Group/Template for a client
    
    NOTE: app_label='core' preserved for migration compatibility.
    Model code moved from core/models.py to workflows/models.py
    
    DEPRECATION NOTICE (Phase 4 - Media Refactor):
    - template_front and template_back ImageFields are DEPRECATED
    - New uploads should create CardMedia records in mediafiles app
    - These fields are kept for backward compatibility with existing data
    - Do NOT add new code that writes directly to these fields
    - Instead, use ImageService.create_media_record() for new uploads
    """
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='id_card_groups')
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True)
    
    # DEPRECATED: Use CardMedia model in mediafiles app instead
    # These fields are kept for backward compatibility - do not remove without migration
    template_front = models.ImageField(
        upload_to='id_templates/', 
        blank=True, 
        null=True,
        help_text='DEPRECATED: Use CardMedia model for new templates'
    )
    template_back = models.ImageField(
        upload_to='id_templates/', 
        blank=True, 
        null=True,
        help_text='DEPRECATED: Use CardMedia model for new templates'
    )
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} - {self.client.name}"
    
    def delete_all_table_images(self):
        """Delete all images from all tables in this group"""
        for table in self.tables.all():
            table.delete_all_card_images()
    
    def delete(self, *args, **kwargs):
        # Delete all images before deleting group
        self.delete_all_table_images()
        # Delete template images
        if self.template_front:
            self.template_front.delete(save=False)
        if self.template_back:
            self.template_back.delete(save=False)
        super().delete(*args, **kwargs)
    
    class Meta:
        app_label = 'core'  # Keep migration compatibility - model stays in core migrations
        ordering = ['-created_at']
        indexes = [
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
        ('mother_photo', 'Mother Photo'),
        ('father_photo', 'Father Photo'),
        ('barcode', 'Barcode'),
        ('qr_code', 'QR Code'),
        ('signature', 'Signature'),
    ]
    
    group = models.ForeignKey(IDCardGroup, on_delete=models.CASCADE, related_name='tables')
    name = models.CharField(max_length=255)
    fields = models.JSONField(default=list, help_text='List of field configurations: [{name, type, order}]')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} - {self.group.name}"
    
    def has_class_field(self):
        """Check if this table has a class field"""
        return any(f.get('type') == 'class' or f.get('name', '').lower() == 'class' for f in self.fields)
    
    def has_section_field(self):
        """Check if this table has a section field"""
        return any(f.get('type') == 'section' or f.get('name', '').lower() == 'section' for f in self.fields)
    
    def has_image_fields(self):
        """Check if this table has any image fields (uses canonical IMAGE_FIELD_TYPES)"""
        return any(f.get('type') in IMAGE_FIELD_TYPES for f in self.fields)
    
    def get_image_fields(self):
        """Get list of image field names (uses canonical IMAGE_FIELD_TYPES)"""
        return [f.get('name') for f in self.fields if f.get('type') in IMAGE_FIELD_TYPES]
    
    def delete_all_card_images(self):
        """Delete all images associated with cards in this table"""
        from django.core.files.storage import default_storage
        
        for card in self.id_cards.all():
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
        ]
    
    def clean(self):
        from django.core.exceptions import ValidationError
        if len(self.fields) > 20:
            raise ValidationError('Maximum 20 fields allowed per table.')


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
    original_photo_name = models.CharField(max_length=255, blank=True, null=True, help_text='Original photo name from Excel for matching')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        # Try to get a name field from field_data (with null safety)
        field_data = self.field_data or {}
        name = field_data.get('name', field_data.get('Name', f'Card #{self.id}'))
        table_name = self.table.name if self.table else 'Unknown Table'
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
    
    class Meta:
        app_label = 'core'  # Keep migration compatibility - model stays in core migrations
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['table', 'status']),
            models.Index(fields=['created_at']),
        ]


class ReprintRequest(models.Model):
    """
    Tracks reprint requests for ID cards.
    References the original card without modifying it.
    Workflow: requested → confirmed → downloaded
    """
    REPRINT_STATUS_CHOICES = [
        ('requested', 'Requested'),
        ('confirmed', 'Confirmed'),
        ('downloaded', 'Downloaded'),
    ]

    card = models.ForeignKey(IDCard, on_delete=models.CASCADE, related_name='reprint_requests')
    table = models.ForeignKey(IDCardTable, on_delete=models.CASCADE, related_name='reprint_requests')
    status = models.CharField(max_length=20, choices=REPRINT_STATUS_CHOICES, default='requested', db_index=True)
    reason = models.TextField(blank=True, default='')
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='reprint_requests',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Reprint #{self.id} — Card #{self.card_id} ({self.status})"

    class Meta:
        app_label = 'core'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['table', 'status']),
            models.Index(fields=['created_at']),
        ]
