import uuid
from django.db import models
from django.core.serializers.json import DjangoJSONEncoder

class ReprintStatus(models.TextChoices):
    REQUESTED = 'REQUESTED', 'Requested'
    CONFIRMED = 'CONFIRMED', 'Confirmed'
    REJECTED = 'REJECTED', 'Rejected'
    PRINTED = 'PRINTED', 'Printed'

class ReprintRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey('cards.Card', on_delete=models.CASCADE, related_name='reprint_requests')
    table = models.ForeignKey('tables.Table', on_delete=models.CASCADE, related_name='reprint_requests')
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE, related_name='reprint_requests')
    
    # The client to whom the card/request belongs
    client = models.ForeignKey('users.User', on_delete=models.CASCADE, related_name='client_reprint_requests')
    
    requested_by = models.ForeignKey('users.User', on_delete=models.CASCADE, related_name='requested_reprints')
    approved_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='approved_reprints')
    printed_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='printed_reprints')
    
    status = models.CharField(max_length=50, choices=ReprintStatus.choices, default=ReprintStatus.REQUESTED)
    
    # Store draft changes (draft_data: dict, draft_media_changes: dict)
    draft_data = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)
    draft_media_changes = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)
    
    request_count = models.IntegerField(default=1)
    
    created_at = models.DateTimeField(auto_now_add=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    printed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'reprints_reprint_request'
        indexes = [
            models.Index(fields=['organization']),
            models.Index(fields=['table']),
            models.Index(fields=['status']),
            models.Index(fields=['created_at']),
        ]

class ReprintHistory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reprint_request = models.ForeignKey(ReprintRequest, on_delete=models.CASCADE, related_name='history')
    card = models.ForeignKey('cards.Card', on_delete=models.CASCADE, related_name='reprint_history')
    action = models.CharField(max_length=50) # e.g. REQUESTED, APPROVED, REJECTED, PRINTED, DRAFT_UPDATED
    performed_by = models.ForeignKey('users.User', on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    details = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)

    class Meta:
        db_table = 'reprints_reprint_history'
        ordering = ['-created_at']

class ReprintExportSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reprint_requests = models.ManyToManyField(ReprintRequest, related_name='export_sessions')
    export_format = models.CharField(max_length=10) # e.g. PDF, DOCX, XLSX, ZIP
    status = models.CharField(max_length=50, default='PENDING') # e.g. PENDING, PROCESSING, COMPLETED, FAILED
    created_by = models.ForeignKey('users.User', on_delete=models.CASCADE)
    download_url = models.CharField(max_length=1000, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'reprints_reprint_export_session'
