"""
Activity Logging Service
========================
Provides a lightweight, non-blocking API for recording user actions.
All methods are classmethods/staticmethods following the project convention.
"""

import logging

from django.utils import timezone
from django.utils.timesince import timesince

from core.models import ActivityLog

logger = logging.getLogger(__name__)


class ActivityService:
    """Service for creating and querying activity log entries."""

    # ── helpers ──────────────────────────────────────────────

    @staticmethod
    def _get_ip(request):
        """Extract client IP from request, handling proxies."""
        if request is None:
            return None
        xff = request.META.get('HTTP_X_FORWARDED_FOR')
        if xff:
            return xff.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR')

    # ── core logging ────────────────────────────────────────

    @classmethod
    def log(
        cls,
        action,
        description,
        user=None,
        request=None,
        target_model='',
        target_id=None,
        target_name='',
    ):
        """
        Create an activity log entry.

        Args:
            action: One of ActivityLog.ACTION_CHOICES keys.
            description: Human readable description (shown on dashboard).
            user: The User who performed the action (optional).
            request: The HttpRequest (used to extract IP; also fallback for user).
            target_model: E.g. 'Client', 'Staff', 'IDCard'.
            target_id: PK of the affected object (optional).
            target_name: Human-readable name (e.g. client name).
        """
        try:
            if user is None and request is not None:
                user = getattr(request, 'user', None)
                if user and not user.is_authenticated:
                    user = None

            ActivityLog.objects.create(
                user=user,
                action=action,
                description=description,
                target_model=target_model,
                target_id=target_id,
                target_name=target_name,
                ip_address=cls._get_ip(request),
            )
        except Exception:
            # Activity logging must never break the main flow
            logger.exception('Failed to write activity log')

    # ── convenience shortcuts ───────────────────────────────

    @classmethod
    def log_login(cls, request, user):
        name = user.get_full_name() or user.username
        cls.log('login', f'{name} logged in', user=user, request=request)

    @classmethod
    def log_logout(cls, request, user):
        name = user.get_full_name() or user.username
        cls.log('logout', f'{name} logged out', user=user, request=request)

    @classmethod
    def log_client_create(cls, request, client):
        cls.log(
            'client_create',
            f'New client "{client.name}" registered',
            request=request,
            target_model='Client',
            target_id=client.pk,
            target_name=client.name,
        )

    @classmethod
    def log_client_update(cls, request, client):
        cls.log(
            'client_update',
            f'Client "{client.name}" details updated',
            request=request,
            target_model='Client',
            target_id=client.pk,
            target_name=client.name,
        )

    @classmethod
    def log_client_delete(cls, request, client_name, client_id=None):
        cls.log(
            'client_delete',
            f'Client "{client_name}" deleted',
            request=request,
            target_model='Client',
            target_id=client_id,
            target_name=client_name,
        )

    @classmethod
    def log_client_status(cls, request, client, new_status):
        cls.log(
            'client_status',
            f'Client "{client.name}" status changed to {new_status}',
            request=request,
            target_model='Client',
            target_id=client.pk,
            target_name=client.name,
        )

    @classmethod
    def log_staff_create(cls, request, staff):
        name = staff.user.get_full_name() or staff.user.username
        cls.log(
            'staff_create',
            f'New staff member "{name}" added',
            request=request,
            target_model='Staff',
            target_id=staff.pk,
            target_name=name,
        )

    @classmethod
    def log_staff_update(cls, request, staff):
        name = staff.user.get_full_name() or staff.user.username
        cls.log(
            'staff_update',
            f'Staff "{name}" details updated',
            request=request,
            target_model='Staff',
            target_id=staff.pk,
            target_name=name,
        )

    @classmethod
    def log_staff_delete(cls, request, staff_name, staff_id=None):
        cls.log(
            'staff_delete',
            f'Staff "{staff_name}" removed',
            request=request,
            target_model='Staff',
            target_id=staff_id,
            target_name=staff_name,
        )

    @classmethod
    def log_staff_status(cls, request, staff, new_status):
        name = staff.user.get_full_name() or staff.user.username
        status_label = 'active' if new_status else 'inactive'
        cls.log(
            'staff_status',
            f'Staff "{name}" marked as {status_label}',
            request=request,
            target_model='Staff',
            target_id=staff.pk,
            target_name=name,
        )

    @classmethod
    def log_card_status(cls, request, action_label, count, client_name=''):
        """Log single or bulk card status change.  action_label e.g. 'verified', 'approved'."""
        suffix = f' for {client_name}' if client_name else ''
        if count == 1:
            cls.log(
                'card_status',
                f'1 card {action_label}{suffix}',
                request=request,
                target_model='IDCard',
            )
        else:
            cls.log(
                'card_bulk_status',
                f'{count} cards {action_label}{suffix}',
                request=request,
                target_model='IDCard',
            )

    @classmethod
    def log_card_create(cls, request, count, client_name=''):
        suffix = f' for {client_name}' if client_name else ''
        cls.log(
            'card_create',
            f'{count} new ID card{"s" if count != 1 else ""} added{suffix}',
            request=request,
            target_model='IDCard',
        )

    @classmethod
    def log_image_upload(cls, request, count, client_name=''):
        suffix = f' for {client_name}' if client_name else ''
        cls.log(
            'image_upload',
            f'{count} image{"s" if count != 1 else ""} uploaded{suffix}',
            request=request,
            target_model='IDCard',
        )

    @classmethod
    def log_bulk_delete(cls, request, target, count):
        cls.log(
            'bulk_delete',
            f'{count} {target} deleted',
            request=request,
        )

    @classmethod
    def log_bulk_upgrade(cls, request, count, client_name=''):
        suffix = f' for {client_name}' if client_name else ''
        cls.log(
            'bulk_upgrade',
            f'{count} card{"s" if count != 1 else ""} class upgraded{suffix}',
            request=request,
            target_model='IDCard',
        )

    @classmethod
    def log_website_update(cls, request, section=''):
        label = f'Website {section} updated' if section else 'Website content updated'
        cls.log('website_update', label, request=request)

    @classmethod
    def log_settings_update(cls, request, setting_name=''):
        label = f'Settings updated: {setting_name}' if setting_name else 'System settings updated'
        cls.log('settings_update', label, request=request)

    # ── query methods ───────────────────────────────────────

    @classmethod
    def get_recent(cls, limit=10):
        """
        Return the most recent activity entries for the dashboard.
        Returns a list of dicts ready for template rendering.
        """
        qs = (
            ActivityLog.objects
            .select_related('user')
            .order_by('-created_at')[:limit]
        )
        now = timezone.now()
        results = []
        for entry in qs:
            actor = ''
            if entry.user:
                actor = entry.user.get_full_name() or entry.user.username

            results.append({
                'id': entry.pk,
                'actor': actor,
                'action': entry.action,
                'description': entry.description,
                'icon_class': entry.icon_class,
                'icon_color': entry.icon_color,
                'time_ago': timesince(entry.created_at, now),
                'created_at': entry.created_at.isoformat(),
            })
        return results
