"""
Notification Service
====================
Central authority for all notification operations:
- Create / broadcast / target notifications
- Query notifications for a user (with read/unread status)
- Mark notifications as read
- Send optional email alerts via threaded email

ARCHITECTURE: Service layer only — no direct model mutations in views.
"""

import logging
from datetime import timedelta

from django.db import transaction
from django.db.models import Q, Exists, OuterRef, Subquery, Value, BooleanField
from django.utils import timezone
from django.utils.timesince import timesince

from core.models import Notification, NotificationRead, User
from .base import ServiceResult

logger = logging.getLogger(__name__)


class NotificationService:
    """Service for creating, querying, and managing notifications."""

    # ── creation ────────────────────────────────────────────

    @classmethod
    def create_notification(cls, *, title, message, priority='normal',
                            category='general', target='all',
                            target_user_ids=None, created_by=None,
                            send_email=False):
        """
        Create a notification and optionally send email alerts.

        Args:
            title: Notification title (max 200 chars)
            message: Notification body text
            priority: low / normal / high / urgent
            category: general / announcement / update / maintenance / alert
            target: all / super_admin / admin_staff / client / client_staff / selected
            target_user_ids: list of user IDs when target='selected'
            created_by: User who created the notification
            send_email: Whether to also send email to targeted users

        Returns:
            ServiceResult with notification data on success
        """
        # Validate
        if not title or not title.strip():
            return ServiceResult(success=False, message='Title is required.')
        if not message or not message.strip():
            return ServiceResult(success=False, message='Message is required.')
        if target == 'selected' and not target_user_ids:
            return ServiceResult(success=False, message='Select at least one user.')

        try:
            with transaction.atomic():
                notif = Notification.objects.create(
                    title=title.strip(),
                    message=message.strip(),
                    priority=priority,
                    category=category,
                    target=target,
                    created_by=created_by,
                )

                # If selected users, add M2M
                if target == 'selected' and target_user_ids:
                    users = User.objects.filter(
                        id__in=target_user_ids, is_active=True
                    )
                    notif.target_users.set(users)
                    recipient_count = users.count()
                else:
                    recipient_count = cls._count_target_users(target)

            # Optional email alert (fire-and-forget in background thread)
            if send_email:
                cls._send_email_alerts(notif)

            logger.info(
                "Notification created: '%s' → %s (%d recipients) by %s",
                title, target, recipient_count,
                created_by.username if created_by else 'system'
            )

            return ServiceResult(
                success=True,
                message=f'Notification sent to {recipient_count} user(s).',
                data={
                    'notification': cls._serialize(notif),
                    'recipient_count': recipient_count,
                }
            )

        except Exception as exc:
            logger.error("Failed to create notification: %s", exc)
            return ServiceResult(success=False, message='Failed to create notification.')

    # ── querying ────────────────────────────────────────────

    @classmethod
    def get_notifications_for_user(cls, user, limit=20, offset=0,
                                   unread_only=False):
        """
        Get notifications visible to a user, annotated with read status.

        Returns list of dicts with 'is_read' flag and 'time_ago' string.
        """
        qs = Notification.objects.filter(is_active=True).select_related('created_by')

        # Filter by target scope
        role_filter = Q(target='all') | Q(target=user.role)
        if user.role in ('super_admin',):
            # Super admin sees everything
            role_filter = Q(target='all') | Q(target='super_admin')
        selected_filter = Q(target='selected', target_users=user)
        qs = qs.filter(role_filter | selected_filter).distinct()

        # Annotate read status
        qs = qs.annotate(
            is_read=Exists(
                NotificationRead.objects.filter(
                    notification=OuterRef('pk'),
                    user=user,
                )
            )
        )

        if unread_only:
            qs = qs.filter(is_read=False)

        qs = qs.order_by('-created_at')
        total = qs.count()
        notifications = list(qs[offset:offset + limit])

        return {
            'notifications': [cls._serialize(n, user) for n in notifications],
            'total': total,
            'unread_count': qs.filter(is_read=False).count() if not unread_only else total,
        }

    @classmethod
    def get_unread_count(cls, user):
        """Fast count of unread notifications for badge display."""
        qs = Notification.objects.filter(is_active=True)

        role_filter = Q(target='all') | Q(target=user.role)
        selected_filter = Q(target='selected', target_users=user)
        qs = qs.filter(role_filter | selected_filter).distinct()

        read_ids = NotificationRead.objects.filter(user=user).values_list(
            'notification_id', flat=True
        )
        return qs.exclude(id__in=read_ids).count()

    # ── read tracking ───────────────────────────────────────

    @classmethod
    def mark_as_read(cls, user, notification_id):
        """Mark a single notification as read for a user."""
        try:
            NotificationRead.objects.get_or_create(
                user=user,
                notification_id=notification_id,
            )
            return ServiceResult(success=True)
        except Notification.DoesNotExist:
            return ServiceResult(success=False, message='Notification not found.')

    @classmethod
    def mark_all_as_read(cls, user):
        """Mark all visible notifications as read for a user."""
        qs = Notification.objects.filter(is_active=True)
        role_filter = Q(target='all') | Q(target=user.role)
        selected_filter = Q(target='selected', target_users=user)
        qs = qs.filter(role_filter | selected_filter).distinct()

        read_ids = set(
            NotificationRead.objects.filter(user=user).values_list(
                'notification_id', flat=True
            )
        )
        unread = qs.exclude(id__in=read_ids)

        new_reads = [
            NotificationRead(user=user, notification_id=nid)
            for nid in unread.values_list('id', flat=True)
        ]
        if new_reads:
            NotificationRead.objects.bulk_create(new_reads, ignore_conflicts=True)

        return ServiceResult(
            success=True,
            message=f'Marked {len(new_reads)} notification(s) as read.'
        )

    # ── admin management ────────────────────────────────────

    @classmethod
    def list_all_notifications(cls, limit=50, offset=0, search=''):
        """List all notifications (admin panel view)."""
        qs = Notification.objects.filter(is_active=True).select_related('created_by').order_by('-created_at')
        if search:
            qs = qs.filter(
                Q(title__icontains=search) | Q(message__icontains=search)
            )
        total = qs.count()
        notifications = list(qs[offset:offset + limit])
        return {
            'notifications': [cls._serialize_admin(n) for n in notifications],
            'total': total,
        }

    @classmethod
    def delete_notification(cls, notification_id):
        """Soft-delete a notification (deactivate)."""
        try:
            notif = Notification.objects.get(id=notification_id)
            notif.is_active = False
            notif.save(update_fields=['is_active'])
            return ServiceResult(success=True, message='Notification deleted.')
        except Notification.DoesNotExist:
            return ServiceResult(success=False, message='Notification not found.')

    @classmethod
    def get_target_user_options(cls):
        """
        Get users grouped by role for the target user picker.
        Returns dict of role → list of {id, name, username}.
        """
        users = User.objects.filter(is_active=True).order_by('role', 'first_name')
        grouped = {}
        for u in users:
            role = u.role
            if role not in grouped:
                grouped[role] = []
            grouped[role].append({
                'id': u.id,
                'name': u.get_full_name() or u.username,
                'username': u.username,
                'role_display': u.get_role_display(),
            })
        return grouped

    # ── cleanup ─────────────────────────────────────────────

    @classmethod
    def cleanup_old_notifications(cls, days=90):
        """Delete notifications older than N days and their read records."""
        threshold = timezone.now() - timedelta(days=days)
        count, _ = Notification.objects.filter(created_at__lt=threshold).delete()
        if count:
            logger.info("Cleaned up %d old notifications", count)
        return count

    # ── private helpers ─────────────────────────────────────

    @classmethod
    def _count_target_users(cls, target):
        """Count how many active users match a target scope."""
        if target == 'all':
            return User.objects.filter(is_active=True).count()
        return User.objects.filter(is_active=True, role=target).count()

    @classmethod
    def _serialize(cls, notif, user=None):
        """Serialize notification for API response."""
        data = {
            'id': notif.id,
            'title': notif.title,
            'message': notif.message,
            'priority': notif.priority,
            'priority_color': notif.priority_color,
            'category': notif.category,
            'category_display': notif.get_category_display(),
            'icon_class': notif.icon_class,
            'created_at': notif.created_at.isoformat(),
            'time_ago': timesince(notif.created_at, timezone.now()),
        }
        if user and hasattr(notif, 'is_read'):
            data['is_read'] = notif.is_read
        return data

    @classmethod
    def _serialize_admin(cls, notif):
        """Serialize notification for admin panel list."""
        data = cls._serialize(notif)
        data.update({
            'target': notif.target,
            'target_display': notif.get_target_display(),
            'created_by': (
                notif.created_by.get_full_name() or notif.created_by.username
            ) if notif.created_by else 'System',
            'is_active': notif.is_active,
            'read_count': notif.reads.count(),
        })
        return data

    @classmethod
    def _send_email_alerts(cls, notif):
        """
        Send email alerts for a notification in background thread.
        Each recipient gets an individual email so addresses aren't exposed.
        """
        try:
            from core.utils.threaded_email import send_mail_async
            from django.conf import settings

            # Skip if email is not configured
            if not getattr(settings, 'EMAIL_HOST_USER', ''):
                logger.debug("Skipping notification email — EMAIL_HOST_USER not set")
                return

            # Determine recipients
            if notif.target == 'selected':
                recipients = list(
                    notif.target_users.filter(
                        is_active=True, email__isnull=False
                    ).exclude(email='').values_list('email', flat=True)
                )
            elif notif.target == 'all':
                recipients = list(
                    User.objects.filter(
                        is_active=True, email__isnull=False
                    ).exclude(email='').values_list('email', flat=True)
                )
            else:
                recipients = list(
                    User.objects.filter(
                        is_active=True, role=notif.target, email__isnull=False
                    ).exclude(email='').values_list('email', flat=True)
                )

            if not recipients:
                return

            from_email = settings.DEFAULT_FROM_EMAIL
            priority_label = f"[{notif.get_priority_display()}] " if notif.priority != 'normal' else ''
            subject = f"{priority_label}{notif.title}"

            # Send individually so recipients don't see each other's addresses
            for email_addr in recipients:
                send_mail_async(
                    subject=subject,
                    message=notif.message,
                    from_email=from_email,
                    recipient_list=[email_addr],
                    fail_silently=True,
                )

            logger.info("Email alerts queued for notification #%d to %d recipients",
                        notif.id, len(recipients))

        except Exception as exc:
            logger.error("Failed to send email alerts for notification #%d: %s",
                         notif.id, exc)
