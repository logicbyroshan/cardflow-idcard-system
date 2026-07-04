import uuid
from django.db import models

class JobStatus(models.TextChoices):
    QUEUED = 'QUEUED', 'Queued'
    RUNNING = 'RUNNING', 'Running'
    FAILED = 'FAILED', 'Failed'
    COMPLETED = 'COMPLETED', 'Completed'
    CANCELLED = 'CANCELLED', 'Cancelled'

class JobType(models.TextChoices):
    IMAGE_UPLOAD = 'IMAGE_UPLOAD', 'Image Upload'
    IMAGE_REPLACE = 'IMAGE_REPLACE', 'Image Replace'
    IMAGE_DELETE = 'IMAGE_DELETE', 'Image Delete'
    IMPORT_XLSX = 'IMPORT_XLSX', 'Import XLSX'
    IMPORT_XLSX_ZIP = 'IMPORT_XLSX_ZIP', 'Import XLSX with Zip'
    REUPLOAD_IMAGES = 'REUPLOAD_IMAGES', 'Reupload Images'
    EXPORT_PDF = 'EXPORT_PDF', 'Export PDF'
    EXPORT_DOCX = 'EXPORT_DOCX', 'Export DOCX'
    EXPORT_XLSX = 'EXPORT_XLSX', 'Export XLSX'
    EXPORT_ZIP = 'EXPORT_ZIP', 'Export Zip'

class Job(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    type = models.CharField(max_length=50, choices=JobType.choices)
    status = models.CharField(max_length=50, choices=JobStatus.choices, default=JobStatus.QUEUED)
    progress = models.IntegerField(default=0)  # 0 to 100 progress
    current_step = models.CharField(max_length=255, blank=True, null=True)
    error_details = models.TextField(blank=True, null=True)
    completion_metadata = models.JSONField(default=dict, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    celery_task_id = models.CharField(max_length=255, blank=True, null=True)
    
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='jobs_created')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'job'
        ordering = ['-created_at']

class JobLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(Job, on_delete=models.CASCADE, related_name='logs')
    message = models.TextField()
    level = models.CharField(max_length=10, default='INFO')  # INFO, WARNING, ERROR
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'job_log'
        ordering = ['created_at']

    def save(self, *args, **kwargs):
        try:
            from apps.hardening.context import get_request_id
            rid = get_request_id()
            if rid and rid not in self.message:
                self.message = f"[{rid}] {self.message}"
        except ImportError:
            pass
        super().save(*args, **kwargs)

class JobEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(Job, on_delete=models.CASCADE, related_name='events')
    event_type = models.CharField(max_length=50)  # QUEUED, STARTED, PROGRESS, COMPLETED, FAILED, CANCELLED
    timestamp = models.DateTimeField(auto_now_add=True)
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'job_event'
        ordering = ['timestamp']
