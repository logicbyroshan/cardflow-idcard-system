import uuid
from django.db import models
from django.core.serializers.json import DjangoJSONEncoder

class AuditEvent(models.TextChoices):
    CREATE_CLIENT = 'CREATE_CLIENT', 'Create Client'
    DELETE_CLIENT = 'DELETE_CLIENT', 'Delete Client'
    CREATE_ASSISTANT = 'CREATE_ASSISTANT', 'Create Assistant'
    DELETE_ASSISTANT = 'DELETE_ASSISTANT', 'Delete Assistant'
    CREATE_OPERATOR = 'CREATE_OPERATOR', 'Create Operator'
    ASSIGN_OPERATOR = 'ASSIGN_OPERATOR', 'Assign Operator'
    PERMISSION_CHANGE = 'PERMISSION_CHANGE', 'Permission Change'
    IMPERSONATION = 'IMPERSONATION', 'Impersonation'
    TABLE_CREATED = 'TABLE_CREATED', 'Table Created'
    TABLE_UPDATED = 'TABLE_UPDATED', 'Table Updated'
    FIELD_CREATED = 'FIELD_CREATED', 'Field Created'
    FIELD_UPDATED = 'FIELD_UPDATED', 'Field Updated'
    CARD_CREATED = 'CARD_CREATED', 'Card Created'
    CARD_UPDATED = 'CARD_UPDATED', 'Card Updated'
    CARD_DELETED = 'CARD_DELETED', 'Card Deleted'
    CARD_VERIFIED = 'CARD_VERIFIED', 'Card Verified'
    CARD_UNVERIFIED = 'CARD_UNVERIFIED', 'Card Unverified'
    CARD_APPROVED = 'CARD_APPROVED', 'Card Approved'
    CARD_UNAPPROVED = 'CARD_UNAPPROVED', 'Card Unapproved'
    CARD_DOWNLOADED = 'CARD_DOWNLOADED', 'Card Downloaded'
    CARD_RESTORED = 'CARD_RESTORED', 'Card Restored'
    BULK_WORKFLOW_ACTION = 'BULK_WORKFLOW_ACTION', 'Bulk Workflow Action'
    MEDIA_UPLOAD = 'MEDIA_UPLOAD', 'Media Uploaded'
    MEDIA_REPLACE = 'MEDIA_REPLACE', 'Media Replaced'
    MEDIA_DELETE = 'MEDIA_DELETE', 'Media Deleted'
    JOB_START = 'JOB_START', 'Job Started'
    JOB_COMPLETE = 'JOB_COMPLETE', 'Job Completed'
    JOB_FAIL = 'JOB_FAIL', 'Job Failed'
    IMPORT_START = 'IMPORT_START', 'Import Started'
    IMPORT_COMPLETE = 'IMPORT_COMPLETE', 'Import Completed'
    IMPORT_FAIL = 'IMPORT_FAIL', 'Import Failed'
    IMPORT_WARNING = 'IMPORT_WARNING', 'Import Warning'
    REUPLOAD_START = 'REUPLOAD_START', 'Reupload Started'
    REUPLOAD_COMPLETE = 'REUPLOAD_COMPLETE', 'Reupload Completed'
    BACKUP_VERIFIED = 'BACKUP_VERIFIED', 'Backup Verified'
    BACKUP_FAILED = 'BACKUP_FAILED', 'Backup Failed'
    RESTORE_SIMULATION = 'RESTORE_SIMULATION', 'Restore Simulation'
    MIGRATION_WARNING = 'MIGRATION_WARNING', 'Migration Warning'
    DEPLOYMENT_VALIDATION = 'DEPLOYMENT_VALIDATION', 'Deployment Validation'
    DISK_WARNING = 'DISK_WARNING', 'Disk Warning'
    MEMORY_WARNING = 'MEMORY_WARNING', 'Memory Warning'
    REPRINT_REQUESTED = 'REPRINT_REQUESTED', 'Reprint Requested'
    REPRINT_APPROVED = 'REPRINT_APPROVED', 'Reprint Approved'
    REPRINT_REJECTED = 'REPRINT_REJECTED', 'Reprint Rejected'
    REPRINT_PRINTED = 'REPRINT_PRINTED', 'Reprint Printed'
    CARD_UPDATED_REPRINT = 'CARD_UPDATED_REPRINT', 'Card Updated Through Reprint'

class AuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=50, choices=AuditEvent.choices)
    actor = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, related_name='audit_logs_created')
    target_user = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs_targeted')
    target_organization = models.ForeignKey('organizations.Organization', on_delete=models.SET_NULL, null=True, blank=True)
    details = models.JSONField(null=True, blank=True, encoder=DjangoJSONEncoder)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'auditlogs_audit_log'
        indexes = [
            models.Index(fields=['event_type']),
            models.Index(fields=['created_at']),
        ]

    def save(self, *args, **kwargs):
        try:
            from apps.hardening.context import get_request_id
            rid = get_request_id()
            if rid:
                if self.details is None:
                    self.details = {}
                if isinstance(self.details, dict):
                    self.details['request_id'] = rid
        except ImportError:
            pass
        super().save(*args, **kwargs)
