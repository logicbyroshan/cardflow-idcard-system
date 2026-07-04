import uuid
from django.db import models

class Organization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    owner_client = models.OneToOneField('users.User', on_delete=models.RESTRICT, related_name='owned_organization')
    client_information = models.JSONField(default=dict, blank=True)
    
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'organizations_organization'
        indexes = [
            models.Index(fields=['name']),
        ]

    def soft_delete(self):
        self.is_deleted = True
        self.save()
