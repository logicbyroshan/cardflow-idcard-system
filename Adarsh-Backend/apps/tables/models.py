import uuid
from django.db import models

class TableStatus(models.TextChoices):
    ACTIVE = 'ACTIVE', 'Active'
    ARCHIVED = 'ARCHIVED', 'Archived'

class Table(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE, related_name='tables')
    name = models.CharField(max_length=255)
    status = models.CharField(max_length=50, choices=TableStatus.choices, default=TableStatus.ACTIVE)
    
    is_deleted = models.BooleanField(default=False)
    card_sequence = models.PositiveIntegerField(default=0)  # Atomic counter for display_id
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'tables_table'
        indexes = [
            models.Index(fields=['organization']),
            models.Index(fields=['name']),
            models.Index(fields=['status']),
            models.Index(fields=['is_deleted']),
        ]

    def soft_delete(self):
        self.is_deleted = True
        self.save()
