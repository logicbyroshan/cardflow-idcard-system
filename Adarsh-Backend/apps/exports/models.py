import uuid
from django.db import models
from apps.exports.constants import ExportType, ExportStatus, PageBreak, XlsxFieldScope


# ─────────────────────────────────────────────
# Template System
# ─────────────────────────────────────────────

class ExportTemplate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE, related_name='export_templates')
    table = models.ForeignKey('tables.Table', on_delete=models.CASCADE, related_name='export_templates')

    name = models.CharField(max_length=255)  # e.g. "Student ID Card"
    export_type = models.CharField(max_length=20, choices=[
        (ExportType.PDF, 'PDF'),
        (ExportType.DOCX, 'DOCX'),
    ], default=ExportType.PDF)
    description = models.TextField(blank=True, null=True)

    # HTML/DOCX body with placeholders like {{name}}, {{photo}}
    body = models.TextField(blank=True, null=True)

    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, related_name='export_templates_created')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'export_template'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['table']),
            models.Index(fields=['organization']),
        ]

    def __str__(self):
        return f"{self.name} ({self.export_type})"


class TemplateVersion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(ExportTemplate, on_delete=models.CASCADE, related_name='versions')
    version_number = models.IntegerField(default=1)
    body = models.TextField()
    changed_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, related_name='template_versions')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'template_version'
        ordering = ['-version_number']
        unique_together = ('template', 'version_number')


class TemplateAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(ExportTemplate, on_delete=models.CASCADE, related_name='assets')
    asset_name = models.CharField(max_length=255)  # e.g. "logo.png"
    stored_path = models.CharField(max_length=512)
    mime_type = models.CharField(max_length=100)
    file_size = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'template_asset'


# ─────────────────────────────────────────────
# Export Session
# ─────────────────────────────────────────────

class ExportSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, related_name='export_sessions')
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE, related_name='export_sessions')
    table = models.ForeignKey('tables.Table', on_delete=models.SET_NULL, null=True, related_name='export_sessions')
    template = models.ForeignKey(ExportTemplate, on_delete=models.SET_NULL, null=True, blank=True, related_name='export_sessions')

    export_type = models.CharField(max_length=20, choices=[
        (ExportType.PDF, 'PDF'),
        (ExportType.DOCX, 'DOCX'),
        (ExportType.XLSX, 'XLSX'),
        (ExportType.ZIP, 'ZIP'),
    ])
    status = models.CharField(max_length=20, choices=[
        (ExportStatus.PENDING, 'Pending'),
        (ExportStatus.PROCESSING, 'Processing'),
        (ExportStatus.COMPLETED, 'Completed'),
        (ExportStatus.FAILED, 'Failed'),
        (ExportStatus.PARTIAL, 'Partial'),
    ], default=ExportStatus.PENDING)

    # Export configuration stored as JSON
    # Contains: card_ids, filters, page_break, field_scope, rename_pattern, etc.
    options = models.JSONField(default=dict, blank=True)

    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    duration = models.FloatField(default=0.0)

    record_count = models.IntegerField(default=0)
    error_count = models.IntegerField(default=0)
    file_size = models.BigIntegerField(default=0)

    error_message = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'export_session'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['organization']),
            models.Index(fields=['table']),
            models.Index(fields=['status']),
        ]


class ExportResult(models.Model):
    """Per-record result during an export run."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    export_session = models.ForeignKey(ExportSession, on_delete=models.CASCADE, related_name='results')
    card = models.ForeignKey('cards.Card', on_delete=models.SET_NULL, null=True, related_name='export_results')
    success = models.BooleanField(default=True)
    error_message = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'export_result'
        ordering = ['created_at']


class ExportArtifact(models.Model):
    """The generated output file for an export session."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    export_session = models.ForeignKey(ExportSession, on_delete=models.CASCADE, related_name='artifacts')
    file_name = models.CharField(max_length=512)
    stored_path = models.CharField(max_length=512)
    mime_type = models.CharField(max_length=100)
    file_size = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'export_artifact'
        ordering = ['-created_at']
