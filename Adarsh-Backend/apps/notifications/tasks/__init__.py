from celery import shared_task
from django.utils import timezone
from datetime import timedelta
import logging

from apps.notifications.services import NotificationService

logger = logging.getLogger(__name__)

@shared_task(queue='notifications')
def deliver_notification_task(notification_id: str):
    """Asynchronously resolves recipients and dispatches notification deliveries."""
    logger.info(f"Asynchronously delivering notification {notification_id}")
    NotificationService.deliver_notification(notification_id)


@shared_task(queue='notifications')
def check_expiring_sandboxes_task():
    """Periodic task looking for active sandbox sessions expiring within 15 minutes."""
    from apps.sandbox.models import SandboxSession
    
    now = timezone.now()
    threshold = now + timedelta(minutes=15)
    
    # Fetch active sandbox sessions expiring in <= 15 minutes that haven't been warned yet
    expiring_sessions = SandboxSession.objects.filter(
        is_active=True,
        expires_at__gt=now,
        expires_at__lte=threshold
    )
    
    for session in expiring_sessions:
        warning_cache_key = f"sandbox_warned:{session.id}"
        from django.core.cache import cache
        if not cache.get(warning_cache_key):
            # Dispatch warning notification
            NotificationService.create_notification_from_event(
                event_type='SANDBOX_EXPIRY_WARNING',
                source_user=session.user,
                source_org=session.user.organization if session.user else None,
                data={
                    'session_id': str(session.id),
                    'user_id': str(session.user.id) if session.user else '',
                    'expires_at': session.expires_at.isoformat()
                }
            )
            cache.set(warning_cache_key, 'true', timeout=900)  # Suppress warning for 15 mins


@shared_task(queue='notifications')
def archive_and_purge_notifications_task():
    """Periodic task to auto-archive expired notifications and purge historical records."""
    # 1. Archive expired
    archived_count = NotificationService.archive_expired_notifications()
    
    # 2. Purge old (e.g., retention limit of 30 days)
    purged_count = NotificationService.purge_expired_notifications(retention_days=30)
    
    logger.info(f"Completed periodic notifications sweep: Archived {archived_count}, Purged {purged_count}")
