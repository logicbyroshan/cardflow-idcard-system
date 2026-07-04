"""Pro User Platform — Celery tasks."""
from celery import shared_task
import logging

logger = logging.getLogger(__name__)


@shared_task(name='pro.generate_statistics_snapshot')
def generate_statistics_snapshot():
    """Periodic task: generate a platform statistics snapshot."""
    from apps.pro.services import StatisticsService
    snap = StatisticsService.generate_snapshot()
    return f"Statistics snapshot {snap.id} created."


@shared_task(name='pro.create_backup', bind=True, max_retries=2)
def create_backup_task(self, backup_session_id: str):
    """Async backup creation (triggered by API, runs heavy I/O in background)."""
    from apps.pro.models import BackupSession
    from apps.pro.services import BackupService
    try:
        session = BackupSession.objects.get(id=backup_session_id)
        org = session.target_organization
        # Re-use the internal collector — skip pro_user check (already validated at API layer)
        data = BackupService._collect_data(org)
        zip_bytes, checksum = BackupService._build_zip(data)

        from apps.mediafiles.storage.factory import StorageFactory
        from io import BytesIO
        import uuid as _uuid
        uid = str(_uuid.uuid4())
        org_label = str(org.id) if org else 'platform'
        filename = f"backup_{org_label}_{uid[:8]}.zip"
        stored_path = f"backups/{uid[:2]}/{uid[2:4]}/{filename}"
        StorageFactory.get_storage().save(stored_path, BytesIO(zip_bytes))

        from django.utils import timezone
        from apps.pro.models import BackupArtifact
        from apps.pro.constants import BackupStatus
        completed = timezone.now()
        session.status = BackupStatus.COMPLETED
        session.completed_at = completed
        if session.started_at:
            session.duration = (completed - session.started_at).total_seconds()
        session.save(update_fields=['status', 'completed_at', 'duration'])
        BackupArtifact.objects.create(
            backup_session=session,
            file_name=filename,
            stored_path=stored_path,
            file_size=len(zip_bytes),
            checksum=checksum,
        )
        return f"Backup {backup_session_id} completed."
    except Exception as exc:
        logger.error(f"Backup task failed: {exc}")
        self.retry(exc=exc, countdown=30)


@shared_task(name='pro.aggregate_audit_logs')
def aggregate_audit_logs():
    """Periodic: prune audit logs older than 90 days (configurable)."""
    from django.utils import timezone
    from apps.auditlogs.models import AuditLog
    cutoff = timezone.now() - timezone.timedelta(days=90)
    deleted, _ = AuditLog.objects.filter(created_at__lt=cutoff).delete()
    logger.info(f"Audit aggregation: deleted {deleted} old records.")
    return f"Deleted {deleted} old audit records."
