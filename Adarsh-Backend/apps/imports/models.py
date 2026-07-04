import uuid
from django.db import models

class ImportStatus(models.TextChoices):
    PENDING = 'PENDING', 'Pending'
    PROCESSING = 'PROCESSING', 'Processing'
    COMPLETED = 'COMPLETED', 'Completed'
    FAILED = 'FAILED', 'Failed'

class RowStatus(models.TextChoices):
    SUCCESS = 'SUCCESS', 'Success'
    WARNING = 'WARNING', 'Warning'
    FAILED = 'FAILED', 'Failed'

class ImportSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='import_sessions')
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE, related_name='import_sessions')
    table = models.ForeignKey('tables.Table', on_delete=models.SET_NULL, null=True, blank=True, related_name='import_sessions')
    status = models.CharField(max_length=50, choices=ImportStatus.choices, default=ImportStatus.PENDING)
    
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    total_rows = models.IntegerField(default=0)
    success_rows = models.IntegerField(default=0)
    warning_rows = models.IntegerField(default=0)
    failed_rows = models.IntegerField(default=0)
    
    duration = models.FloatField(default=0.0)  # in seconds
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'import_session'
        ordering = ['-created_at']

class ImportRowResult(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    import_session = models.ForeignKey(ImportSession, on_delete=models.CASCADE, related_name='row_results')
    row_number = models.IntegerField()
    status = models.CharField(max_length=50, choices=RowStatus.choices)
    error_message = models.TextField(null=True, blank=True)
    row_data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'import_row_result'
        ordering = ['row_number']

class ImportWarning(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    import_session = models.ForeignKey(ImportSession, on_delete=models.CASCADE, related_name='warnings')
    row_number = models.IntegerField(null=True, blank=True)
    warning_type = models.CharField(max_length=50)  # e.g., DUPLICATE, MISSING_IMAGE
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'import_warning'
        ordering = ['row_number', 'created_at']

class ReuploadSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='reupload_sessions')
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE, related_name='reupload_sessions')
    table = models.ForeignKey('tables.Table', on_delete=models.CASCADE, related_name='reupload_sessions')
    status = models.CharField(max_length=50, choices=ImportStatus.choices, default=ImportStatus.PENDING)
    
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    total_images = models.IntegerField(default=0)
    matched_images = models.IntegerField(default=0)
    failed_images = models.IntegerField(default=0)
    
    duration = models.FloatField(default=0.0)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'reupload_session'
        ordering = ['-created_at']
