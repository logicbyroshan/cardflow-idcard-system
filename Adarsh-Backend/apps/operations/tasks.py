import logging
from celery import shared_task
from django.core.cache import cache

from apps.operations.services import (
    BackupVerificationService,
    BackupRetentionPolicy,
    EnvironmentDiagnosticService,
    DiskHealthService,
    MemoryHealthService,
)

logger = logging.getLogger(__name__)

@shared_task(name='apps.operations.tasks.verify_backups_task')
def verify_backups_task():
    logger.info("Starting scheduled backup verification check.")
    results = BackupVerificationService.verify_all_backups()
    logger.info(f"Completed backup verification. Verified {len(results)} backups.")
    return len(results)

@shared_task(name='apps.operations.tasks.retention_cleanup_task')
def retention_cleanup_task():
    logger.info("Starting scheduled backup retention cleanup.")
    res = BackupRetentionPolicy.run_retention_cleanup()
    logger.info(f"Retention policy cleanup complete. Result: {res}")
    return res

@shared_task(name='apps.operations.tasks.env_diagnostics_task')
def env_diagnostics_task():
    logger.info("Starting scheduled environment diagnostics run.")
    # Set Celery Beat heartbeat key in Redis
    cache.set('celery_beat_heartbeat', 'alive', timeout=300)
    
    report = EnvironmentDiagnosticService.run_diagnostics()
    logger.info("Scheduled diagnostics run complete.")
    return report

@shared_task(name='apps.operations.tasks.disk_checks_task')
def disk_checks_task():
    logger.info("Starting scheduled disk health checks.")
    res = DiskHealthService.check_disk_health()
    logger.info(f"Disk health checks completed: {res['status']} status.")
    return res

@shared_task(name='apps.operations.tasks.memory_checks_task')
def memory_checks_task():
    logger.info("Starting scheduled memory health checks.")
    res = MemoryHealthService.check_memory_health()
    logger.info(f"Memory health checks completed: {res['status']} status.")
    return res
