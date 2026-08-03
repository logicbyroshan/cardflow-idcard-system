import logging
from django.db.models.signals import post_save
from django.dispatch import receiver
from apps.auditlogs.models import AuditLog, AuditEvent
from apps.notifications.services import NotificationService

logger = logging.getLogger(__name__)

# List of AuditEvent types that automatically trigger notifications
NOTIFIABLE_EVENTS = {
    # Imports
    'IMPORT_COMPLETE',
    'IMPORT_FAIL',
    
    # Exports
    'EXPORT_COMPLETE',
    'EXPORT_FAIL',
    
    # Backups & Operations
    'BACKUP_VERIFIED',
    'BACKUP_FAILED',
    'MAINTENANCE_ENABLED',
    'MAINTENANCE_DISABLED',
    'ANNOUNCEMENT_CREATED',
    'CLIENT_DEACTIVATED',
    'FEATURE_FLAG_CHANGED',
    'DISK_WARNING',
    'MEMORY_WARNING',
    
    # Desktop
    'DESKTOP_SYNC_COMPLETE',
    'DESKTOP_SYNC_FAIL',
    'CARD_DOWNLOADED',
    'CARDS_PRINTED',
}

@receiver(post_save, sender=AuditLog)
def audit_log_notification_trigger(sender, instance, created, **kwargs):
    """Automatically intercepts AuditLog creation and compiles corresponding Notification entries."""
    if not created:
        return
        
    event_type = instance.event_type
    
    # Avoid recursion loop
    if event_type == 'NOTIFICATION_CREATED':
        return
        
    if event_type in NOTIFIABLE_EVENTS:
        source_org = instance.target_organization
        source_user = instance.actor
        details = instance.details or {}
        
        # Ensure we pass user_id/org_id properly in details context
        if source_user and 'user_id' not in details:
            details['user_id'] = str(source_user.id)
            details['username'] = source_user.username
            
        if source_org and 'org_name' not in details:
            details['org_name'] = source_org.name
            
        try:
            NotificationService.create_notification_from_event(
                event_type=event_type,
                source_user=source_user,
                source_org=source_org,
                data=details
            )
        except Exception as e:
            logger.error(f"Error auto-dispatching notification for event {event_type}: {e}", exc_info=True)
