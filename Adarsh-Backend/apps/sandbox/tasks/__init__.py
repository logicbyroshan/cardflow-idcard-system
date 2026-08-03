"""Sandbox Celery cleanup tasks."""
from celery import shared_task
import logging

logger = logging.getLogger(__name__)


@shared_task(name='sandbox.cleanup_expired_sessions')
def cleanup_expired_sandbox_sessions():
    """
    Periodic task: delete all expired sandbox sessions and cascade-delete
    all their associated changes, cards, imports, and exports.
    Scheduled via Celery beat (every hour).
    """
    from apps.sandbox.services import SandboxCleanupService
    count = SandboxCleanupService.cleanup_expired_sessions()
    return f"Cleaned up {count} expired sandbox sessions."
