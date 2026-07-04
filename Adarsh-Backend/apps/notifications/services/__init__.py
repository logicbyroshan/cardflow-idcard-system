import logging
from django.utils import timezone
from datetime import timedelta
from django.db import transaction
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache

from apps.organizations.models import Organization
from shared.constants import Role
from apps.auditlogs.models import AuditLog, AuditEvent
from apps.notifications.models import (
    NotificationLevel, TargetType, ReadState,
    NotificationTemplate, NotificationEvent, Notification, NotificationDelivery, NotificationPreference
)

logger = logging.getLogger(__name__)

# Map AuditEvent string constants to category preferences
NOTIF_PREF_MAP = {
    # System notifications
    'CREATE_CLIENT': 'system_notifications',
    'DELETE_CLIENT': 'system_notifications',
    'BACKUP_VERIFIED': 'system_notifications',
    'BACKUP_FAILED': 'system_notifications',
    'RESTORE_SIMULATION': 'system_notifications',
    'MIGRATION_WARNING': 'system_notifications',
    'DEPLOYMENT_VALIDATION': 'system_notifications',
    'DISK_WARNING': 'system_notifications',
    'MEMORY_WARNING': 'system_notifications',
    'ANNOUNCEMENT_CREATED': 'system_notifications',
    'CLIENT_ACTIVATED': 'system_notifications',
    'CLIENT_DEACTIVATED': 'system_notifications',
    
    # Workflow notifications
    'CARD_CREATED': 'workflow_notifications',
    'CARD_UPDATED': 'workflow_notifications',
    'CARD_DELETED': 'workflow_notifications',
    'CARD_VERIFIED': 'workflow_notifications',
    'CARD_UNVERIFIED': 'workflow_notifications',
    'CARD_APPROVED': 'workflow_notifications',
    'CARD_UNAPPROVED': 'workflow_notifications',
    'CARD_RESTORED': 'workflow_notifications',
    'BULK_WORKFLOW_ACTION': 'workflow_notifications',
    'CARD_DOWNLOADED': 'workflow_notifications',
    'CARDS_PRINTED': 'workflow_notifications',  # Custom
    'REPRINT_REQUESTED': 'workflow_notifications',
    'REPRINT_APPROVED': 'workflow_notifications',
    'REPRINT_REJECTED': 'workflow_notifications',
    'REPRINT_PRINTED': 'workflow_notifications',
    
    # Import notifications
    'IMPORT_START': 'import_notifications',
    'IMPORT_COMPLETE': 'import_notifications',
    'IMPORT_FAIL': 'import_notifications',
    
    # Export notifications
    'EXPORT_COMPLETE': 'export_notifications',
    'EXPORT_FAIL': 'export_notifications',
    
    # Maintenance notifications
    'MAINTENANCE_ENABLED': 'maintenance_notifications',
    'MAINTENANCE_DISABLED': 'maintenance_notifications',
    
    # Desktop notifications
    'DESKTOP_SYNC_COMPLETE': 'desktop_notifications',
    'DESKTOP_SYNC_FAIL': 'desktop_notifications',
}

def _log_notif_audit(event_type, user, details=None):
    try:
        AuditLog.objects.create(
            event_type=event_type,
            actor=user,
            details=details or {}
        )
    except Exception as e:
        logger.error(f"Failed to log notification audit: {e}")

class NotificationService:
    
    @staticmethod
    @transaction.atomic
    def create_notification_from_event(event_type: str, source_user=None, source_org=None, data=None) -> Notification:
        """Creates a NotificationEvent and compiles a Notification using templates."""
        data = data or {}
        
        # 1. Create NotificationEvent
        event = NotificationEvent.objects.create(
            event_type=event_type,
            source_user=source_user,
            source_org=source_org,
            data=data
        )
        
        # 2. Try fetching template, fallback to defaults
        try:
            template = NotificationTemplate.objects.get(event_type=event_type)
            title = template.title_template.format(**data)
            message = template.message_template.format(**data)
            level = template.level
        except (NotificationTemplate.DoesNotExist, KeyError, IndexError):
            # Fallback mappings
            title = f"System Event: {event_type}"
            message = f"An event of type {event_type} occurred in the system."
            level = NotificationLevel.INFO
            
            # Map default levels
            if 'FAIL' in event_type or 'WARNING' in event_type or 'DISK' in event_type or 'MEMORY' in event_type:
                level = NotificationLevel.WARNING
            if 'FAIL' in event_type:
                level = NotificationLevel.ERROR
            if 'CRITICAL' in event_type:
                level = NotificationLevel.CRITICAL
            if 'COMPLETE' in event_type or 'SUCCESS' in event_type:
                level = NotificationLevel.SUCCESS
                
        # 3. Determine target scope & ID
        target_type = TargetType.ORGANIZATION
        target_id = str(source_org.id) if source_org else None
        
        # Override target parameters for special events
        if event_type in ['MAINTENANCE_ENABLED', 'MAINTENANCE_DISABLED', 'ANNOUNCEMENT_CREATED']:
            target_type = TargetType.GLOBAL
            target_id = None
        elif event_type in ['BACKUP_VERIFIED', 'BACKUP_FAILED', 'MIGRATION_WARNING', 'DEPLOYMENT_VALIDATION', 'DISK_WARNING', 'MEMORY_WARNING']:
            target_type = TargetType.ROLE
            target_id = Role.PRO_USER
        elif event_type == 'SANDBOX_EXPIRY_WARNING' and 'user_id' in data:
            target_type = TargetType.USER
            target_id = str(data['user_id'])
        elif event_type == 'EXPORT_COMPLETE' and 'user_id' in data:
            target_type = TargetType.USER
            target_id = str(data['user_id'])
            
        # 4. Set visibility window (default: visible from now, expires in 30 days)
        now = timezone.now()
        visible_from = data.get('visible_from', now)
        visible_until = data.get('visible_until', now + timedelta(days=30))
        
        # Create Notification
        notif = Notification.objects.create(
            event=event,
            title=title,
            message=message,
            level=level,
            target_type=target_type,
            target_id=target_id,
            visible_from=visible_from,
            visible_until=visible_until
        )
        
        # Log Audit event
        _log_notif_audit('NOTIFICATION_CREATED', source_user, details={
            'notification_id': str(notif.id),
            'event_type': event_type
        })
        
        # Trigger async delivery
        from apps.notifications.tasks import deliver_notification_task
        deliver_notification_task.delay(str(notif.id))
        
        return notif

    @staticmethod
    def deliver_notification(notification_id: str):
        """Resolves target users, checks preferences, creates delivery rows, and pushes websockets."""
        try:
            notif = Notification.objects.get(id=notification_id)
        except Notification.DoesNotExist:
            logger.error(f"Cannot deliver notification: ID {notification_id} not found.")
            return
            
        User = get_user_model()
        users_to_receive = User.objects.filter(is_active=True)
        
        # 1. Filter users based on target criteria
        if notif.target_type == TargetType.ORGANIZATION:
            users_to_receive = users_to_receive.filter(organization_id=notif.target_id)
        elif notif.target_type == TargetType.CLIENT:
            users_to_receive = users_to_receive.filter(organization_id=notif.target_id, role=Role.CLIENT)
        elif notif.target_type == TargetType.ROLE:
            users_to_receive = users_to_receive.filter(role=notif.target_id)
        elif notif.target_type == TargetType.USER:
            users_to_receive = users_to_receive.filter(id=notif.target_id)
            
        # Determine pref category
        pref_field = 'system_notifications'
        if notif.event:
            pref_field = NOTIF_PREF_MAP.get(notif.event.event_type, 'system_notifications')
            
        # 2. Iterate and check preferences
        deliveries = []
        for user in users_to_receive:
            pref, _ = NotificationPreference.objects.get_or_create(user=user)
            
            # Check if user accepts this notification class
            if getattr(pref, pref_field, True):
                delivery = NotificationDelivery(
                    notification=notif,
                    user=user,
                    read_state=ReadState.UNREAD,
                    channels=["WEB", "MOBILE", "DESKTOP"]
                )
                deliveries.append(delivery)
                
        # Bulk create deliveries
        if deliveries:
            NotificationDelivery.objects.bulk_create(deliveries, ignore_conflicts=True)
            
            # 3. WebSocket Realtime pushes
            for d in deliveries:
                NotificationService.push_websocket_notification(d.user.id, {
                    'notification_id': str(notif.id),
                    'title': notif.title,
                    'message': notif.message,
                    'level': notif.level,
                    'created_at': notif.created_at.isoformat()
                })

    # ─── WebSocket Session Simulation ──────────────────────────────────────────
    
    @staticmethod
    def simulate_websocket_connection(user_id: str, active: bool = True):
        """Mocks user websocket connectivity status in cache."""
        cache_key = f"active_ws_session:{user_id}"
        if active:
            cache.set(cache_key, 'online', timeout=3600)  # 1 hour lease
        else:
            cache.delete(cache_key)

    @staticmethod
    def push_websocket_notification(user_id, notification_data):
        """Pushes alerts immediately if user has an active session in the cache registry."""
        cache_key = f"active_ws_session:{user_id}"
        if cache.get(cache_key) == 'online':
            logger.info(f"WebSocket Push dispatched to user {user_id}: {notification_data['title']}")
            pushes_key = f"ws_pushes:{user_id}"
            existing = cache.get(pushes_key) or []
            existing.append(notification_data)
            cache.set(pushes_key, existing, timeout=600)
            return True
        return False

    # ─── Delivery State Updates ───────────────────────────────────────────────

    @staticmethod
    def update_delivery_state(delivery_id: str, user, state: str) -> NotificationDelivery:
        """Updates delivery state (READ, ARCHIVED, DISMISSED) and logs audit log."""
        try:
            delivery = NotificationDelivery.objects.select_related('notification').get(id=delivery_id, user=user)
        except NotificationDelivery.DoesNotExist:
            raise ValidationError("Notification delivery record not found for this user.")
            
        old_state = delivery.read_state
        delivery.read_state = state
        
        now = timezone.now()
        if state == ReadState.READ:
            delivery.read_at = now
            _log_notif_audit('NOTIFICATION_READ', user, details={'delivery_id': delivery_id})
        elif state == ReadState.ARCHIVED:
            delivery.archived_at = now
            _log_notif_audit('NOTIFICATION_ARCHIVED', user, details={'delivery_id': delivery_id})
        elif state == ReadState.DISMISSED:
            delivery.dismissed_at = now
            _log_notif_audit('NOTIFICATION_DISMISSED', user, details={'delivery_id': delivery_id})
            
        delivery.save()
        return delivery

    # ─── Archive & Expiry Management ──────────────────────────────────────────

    @staticmethod
    def archive_expired_notifications() -> int:
        """Updates notifications outside visibility window to is_archived=True."""
        now = timezone.now()
        expired_notifs = Notification.objects.filter(
            visible_until__lt=now,
            is_archived=False
        )
        
        count = expired_notifs.count()
        if count > 0:
            for notif in expired_notifs:
                notif.is_archived = True
                notif.save()
                # Update all deliveries to ARCHIVED
                NotificationDelivery.objects.filter(
                    notification=notif,
                    read_state=ReadState.UNREAD
                ).update(read_state=ReadState.ARCHIVED, archived_at=now)
                
            logger.info(f"Automatically archived {count} expired notifications.")
        return count

    @staticmethod
    def purge_expired_notifications(retention_days: int = 30) -> int:
        """Deletes archived/expired notifications older than the configurable retention period."""
        limit_date = timezone.now() - timedelta(days=retention_days)
        
        # Fetch expired notifications that are archived
        target_notifs = Notification.objects.filter(
            visible_until__lt=limit_date,
            is_archived=True
        )
        
        count = target_notifs.count()
        if count > 0:
            target_notifs.delete()  # Cascade deletes NotificationEvent/Deliveries
            logger.info(f"Purged {count} notifications older than {retention_days} days.")
            
        return count
