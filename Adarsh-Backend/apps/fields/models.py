import uuid
from django.db import models
from django.core.serializers.json import DjangoJSONEncoder

class FieldType(models.TextChoices):
    TEXT = 'TEXT', 'Text'
    NUMBER = 'NUMBER', 'Number'
    DATE = 'DATE', 'Date'
    IMAGE = 'IMAGE', 'Image'
    BOOLEAN = 'BOOLEAN', 'Boolean'

class Field(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    table = models.ForeignKey('tables.Table', on_delete=models.CASCADE, related_name='fields')
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=50, choices=FieldType.choices)
    
    is_unique = models.BooleanField(default=False)
    is_required = models.BooleanField(default=False)
    
    default_value = models.JSONField(null=True, blank=True, encoder=DjangoJSONEncoder)
    validation_rules = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)
    
    display_order = models.IntegerField(default=0)
    
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'fields_field'
        ordering = ['display_order', 'created_at']
        indexes = [
            models.Index(fields=['table']),
            models.Index(fields=['type']),
            models.Index(fields=['is_deleted']),
        ]

    def soft_delete(self):
        self.is_deleted = True
        self.save()
