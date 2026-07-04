import uuid
from django.db import models
from django.conf import settings
from apps.organizations.models import Organization

class NotificationLevel(models.TextChoices):
    INFO = 'INFO', 'Info'
    SUCCESS = 'SUCCESS', 'Success'
    WARNING = 'WARNING', 'Warning'
    ERROR = 'ERROR', 'Error'
    CRITICAL = 'CRITICAL', 'Critical'


class TargetType(models.TextChoices):
    GLOBAL = 'GLOBAL', 'Global'
    ORGANIZATION = 'ORGANIZATION', 'Organization'
    CLIENT = 'CLIENT', 'Client'
    ROLE = 'ROLE', 'Role'
    USER = 'USER', 'User'


class ReadState(models.TextChoices):
    UNREAD = 'UNREAD', 'Unread'
    READ = 'READ', 'Read'
    ARCHIVED = 'ARCHIVED', 'Archived'
    DISMISSED = 'DISMISSED', 'Dismissed'


class NotificationTemplate(models.Model):
    """System template for generating standardized notifications based on event types."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=100, unique=True)
    title_template = models.CharField(max_length=255)
    message_template = models.TextField()
    level = models.CharField(max_length=20, choices=NotificationLevel.choices, default=NotificationLevel.INFO)

    class Meta:
        db_table = 'notif_templates'


class NotificationEvent(models.Model):
    """Logs the system audit event or trigger that caused notifications."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=100)
    source_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='notifications_triggered')
    source_org = models.ForeignKey(Organization, on_delete=models.SET_NULL, null=True, blank=True)
    data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'notif_events'


class Notification(models.Model):
    """Unified system notification instance detailing context, severity, scope, and visibility windows."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(NotificationEvent, on_delete=models.SET_NULL, null=True, blank=True, related_name='notifications')
    title = models.CharField(max_length=255)
    message = models.TextField()
    level = models.CharField(max_length=20, choices=NotificationLevel.choices)
    target_type = models.CharField(max_length=20, choices=TargetType.choices)
    target_id = models.CharField(max_length=100, null=True, blank=True)  # Holds Org UUID, User UUID, or Role string
    visible_from = models.DateTimeField()
    visible_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_archived = models.BooleanField(default=False)

    class Meta:
        db_table = 'notif_notifications'
        ordering = ['-created_at']


class NotificationDelivery(models.Model):
    """Tracks state, read logs, and channel delivery parameters per target User."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    notification = models.ForeignKey(Notification, on_delete=models.CASCADE, related_name='deliveries')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notification_deliveries')
    read_state = models.CharField(max_length=20, choices=ReadState.choices, default=ReadState.UNREAD)
    read_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    dismissed_at = models.DateTimeField(null=True, blank=True)
    channels = models.JSONField(default=list, blank=True)  # e.g., ["WEB", "MOBILE", "DESKTOP"]

    class Meta:
        db_table = 'notif_deliveries'
        unique_together = ('notification', 'user')
        ordering = ['-notification__created_at']


class NotificationPreference(models.Model):
    """Individual User preferences determining which notification categories are delivered."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notification_preference')
    system_notifications = models.BooleanField(default=True)
    workflow_notifications = models.BooleanField(default=True)
    import_notifications = models.BooleanField(default=True)
    export_notifications = models.BooleanField(default=True)
    maintenance_notifications = models.BooleanField(default=True)
    desktop_notifications = models.BooleanField(default=True)

    class Meta:
        db_table = 'notif_preferences'
