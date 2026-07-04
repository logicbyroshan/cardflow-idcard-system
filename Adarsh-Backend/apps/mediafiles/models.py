import uuid
from django.db import models

class MediaFile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE, related_name='media_files')
    table = models.ForeignKey('tables.Table', on_delete=models.CASCADE, related_name='media_files')
    card = models.ForeignKey('cards.Card', on_delete=models.SET_NULL, null=True, blank=True, related_name='media_files')
    field = models.ForeignKey('fields.Field', on_delete=models.SET_NULL, null=True, blank=True, related_name='media_files')
    
    original_name = models.CharField(max_length=255)
    stored_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=100)
    extension = models.CharField(max_length=10)
    file_size = models.BigIntegerField()
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    checksum = models.CharField(max_length=64)
    storage_provider = models.CharField(max_length=50)
    
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, related_name='media_files_created')

    class Meta:
        db_table = 'media_file'

class MediaVariant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    media_file = models.ForeignKey(MediaFile, on_delete=models.CASCADE, related_name='variants')
    variant_name = models.CharField(max_length=50)  # e.g., 'thumbnail'
    stored_name = models.CharField(max_length=255)
    file_size = models.BigIntegerField()
    width = models.IntegerField()
    height = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'media_variant'

class MediaReference(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    media_file = models.ForeignKey(MediaFile, on_delete=models.CASCADE, related_name='references')
    card = models.ForeignKey('cards.Card', on_delete=models.CASCADE, related_name='media_references')
    field = models.ForeignKey('fields.Field', on_delete=models.CASCADE, related_name='media_references')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'media_reference'
        unique_together = ('card', 'field')  # enforces one image per image field
