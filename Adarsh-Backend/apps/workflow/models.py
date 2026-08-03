import uuid
from django.db import models
from django.core.serializers.json import DjangoJSONEncoder

class WorkflowHistory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey('cards.Card', on_delete=models.CASCADE, related_name='workflow_histories')
    old_status = models.CharField(max_length=50)
    new_status = models.CharField(max_length=50)
    user = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='workflow_histories')
    timestamp = models.DateTimeField(auto_now_add=True)
    reason = models.TextField(blank=True, null=True)

    class Meta:
        db_table = 'workflow_history'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['card', 'timestamp']),
            models.Index(fields=['old_status']),
            models.Index(fields=['new_status']),
        ]
