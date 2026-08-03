import uuid
from django.db import models
from django.core.serializers.json import DjangoJSONEncoder
from django.contrib.postgres.indexes import GinIndex

class CardStatus(models.TextChoices):
    PENDING = 'PENDING', 'Pending'
    VERIFIED = 'VERIFIED', 'Verified'
    APPROVED = 'APPROVED', 'Approved'
    DOWNLOADED = 'DOWNLOADED', 'Downloaded'
    DELETED = 'DELETED', 'Deleted'
    # Legacy alias kept for migration safety
    ACTIVE = 'ACTIVE', 'Active'

class Card(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    table = models.ForeignKey('tables.Table', on_delete=models.CASCADE, related_name='cards')
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE, related_name='cards')
    display_id = models.CharField(max_length=100)
    
    status = models.CharField(max_length=50, choices=CardStatus.choices, default=CardStatus.PENDING)
    version = models.IntegerField(default=1) # Optimistic locking
    
    data = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)
    
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, related_name='cards_created')
    updated_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, related_name='cards_updated')
    deleted_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='cards_deleted')
    
    # Reprint counters
    reprint_count = models.IntegerField(default=0)
    total_print_count = models.IntegerField(default=1)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'cards_card'
        indexes = [
            models.Index(fields=['organization']),
            models.Index(fields=['table']),
            models.Index(fields=['status']),
            models.Index(fields=['created_at']),
            models.Index(fields=['deleted_at']),
            models.Index(fields=['version']),
            GinIndex(fields=['data']),
        ]

    def soft_delete(self, user=None):
        from django.utils import timezone
        self.status = CardStatus.DELETED
        self.deleted_at = timezone.now()
        if user:
            self.deleted_by = user
        self.save()

class CardUniqueValue(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name='unique_values')
    table = models.ForeignKey('tables.Table', on_delete=models.CASCADE)
    field = models.ForeignKey('fields.Field', on_delete=models.CASCADE)
    value_hash = models.CharField(max_length=255)

    class Meta:
        db_table = 'cards_card_unique_value'
        constraints = [
            models.UniqueConstraint(fields=['table', 'field', 'value_hash'], name='unique_card_field_value')
        ]

class AssistantFilter(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    assistant = models.ForeignKey('users.User', on_delete=models.CASCADE, related_name='filters')
    table = models.ForeignKey('tables.Table', on_delete=models.CASCADE)
    
    # {"<field_uuid>": ["A", "B"]}
    criteria = models.JSONField(default=dict, encoder=DjangoJSONEncoder)
    
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cards_assistant_filter'
        indexes = [
            models.Index(fields=['assistant', 'table']),
        ]
