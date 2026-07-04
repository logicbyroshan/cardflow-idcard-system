import uuid
from django.db import models
from apps.pro.models import BackupArtifact

class BackupVerificationResult(models.Model):
    """Stores the results of individual backup validation checks."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    backup_artifact = models.ForeignKey(BackupArtifact, on_delete=models.CASCADE, related_name='verification_results')
    verification_time = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=20)  # success / failed
    error_details = models.TextField(blank=True, null=True)

    class Meta:
        db_table = 'ops_backup_verification'
        ordering = ['-verification_time']


class DiskHealthSnapshot(models.Model):
    """Stores periodic disk usage metrics to calculate growth rate."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    timestamp = models.DateTimeField(auto_now_add=True)
    total_space = models.BigIntegerField()
    free_space = models.BigIntegerField()
    used_space = models.BigIntegerField()

    class Meta:
        db_table = 'ops_disk_health'
        ordering = ['-timestamp']


class MemoryHealthSnapshot(models.Model):
    """Stores periodic memory usage metrics for operations dashboard."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    timestamp = models.DateTimeField(auto_now_add=True)
    total_memory = models.BigIntegerField()
    available_memory = models.BigIntegerField()
    used_memory = models.BigIntegerField()

    class Meta:
        db_table = 'ops_memory_health'
        ordering = ['-timestamp']
