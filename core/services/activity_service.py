"""
Activity Logging Service
========================
Provides a lightweight, non-blocking API for recording user actions.
All methods are classmethods/staticmethods following the project convention.
"""

import logging
import ipaddress
import re

from django.conf import settings
from django.core.cache import cache as django_cache
from django.utils import timezone
from django.utils.timesince import timesince

from core.models import ActivityLog

logger = logging.getLogger(__name__)


class ActivityService:
    """Service for creating and querying activity log entries."""

    # Avoid log flooding when users process cards one-by-one very quickly.
    SINGLE_CARD_STATUS_LOG_THROTTLE_SECONDS = 60
    # Keep similar card actions grouped for up to 15 minutes in Recent Activity.
    RECENT_ACTIVITY_CARD_COMBINE_WINDOW_SECONDS = 900
    RECENT_ACTIVITY_FETCH_MULTIPLIER = 10
    RECENT_ACTIVITY_FETCH_CAP = 300
    CARD_ACTIVITY_DESCRIPTION_RE = re.compile(
        r'^(?P<count>\d+)\s+cards?\s+(?P<status>[^\n]+?)(?:\s+for\s+(?P<client>.+))?$',
        re.IGNORECASE,
    )
    CARD_ACTIVITY_MOVE_RE = re.compile(
        r'^(?:(?P<count>\d+)\s+)?cards?\s+moved\s+from\s+(?P<from>[^\n]+?)\s+to\s+(?P<to>[^\n]+?)(?:\s+for\s+(?P<client>.+))?$',
        re.IGNORECASE,
    )
    EXPORT_LABELS = {
        'export_zip': 'IMAGES',
        'export_pdf': 'PDF',
        'export_docx': 'WORD',
        'export_excel': 'XLSX',
        'images': 'IMAGES',
        'pdf': 'PDF',
        'docx': 'WORD',
        'doc': 'WORD',
        'xlsx': 'XLSX',
        'download_all': 'DOWNLOAD-ALL',
        'pdf_zip': 'PDF-ZIP',
    }

    # ── helpers ──────────────────────────────────────────────

    @staticmethod
    def _normalize_ip(raw_value):
        """Normalize an IP value (strip ports/quotes) and validate it."""
        if not raw_value:
            return None

        value = str(raw_value).strip().strip('"').strip("'")
        if not value:
            return None

        # RFC 7239 may wrap IPv6 values in brackets, e.g. [2001:db8::1]:443
        if value.startswith('[') and ']' in value:
            value = value[1:value.index(']')]

        # Strip :port from IPv4-style values.
        if value.count(':') == 1 and '.' in value:
            maybe_ip, _sep, _port = value.partition(':')
            value = maybe_ip

        try:
            return str(ipaddress.ip_address(value))
        except ValueError:
            return None

    @classmethod
    def _extract_first_forwarded_ip(cls, forwarded_header):
        """Extract first valid client IP from RFC 7239 Forwarded header."""
        if not forwarded_header:
            return None

        for entry in str(forwarded_header).split(','):
            for part in entry.split(';'):
                token = part.strip()
                if not token.lower().startswith('for='):
                    continue

                ip_part = token.split('=', 1)[1].strip().strip('"').strip("'")
                # RFC 7239 allows obfuscated identifiers; skip those.
                if ip_part.startswith('_'):
                    continue
                normalized = cls._normalize_ip(ip_part)
                if normalized:
                    return normalized
        return None

    @staticmethod
    def _is_internal_ip(ip_value):
        """Return True for proxy/private/loopback style addresses."""
        try:
            parsed = ipaddress.ip_address(ip_value)
        except ValueError:
            return False

        return bool(
            parsed.is_private
            or parsed.is_loopback
            or parsed.is_link_local
            or parsed.is_reserved
        )

    @staticmethod
    def _get_ip(request):
        """Extract client IP from request, handling proxies."""
        if request is None:
            return None

        remote_addr = ActivityService._normalize_ip(request.META.get('REMOTE_ADDR'))
        x_real_ip = ActivityService._normalize_ip(request.META.get('HTTP_X_REAL_IP'))
        forwarded_ip = ActivityService._extract_first_forwarded_ip(request.META.get('HTTP_FORWARDED'))

        xff_raw = request.META.get('HTTP_X_FORWARDED_FOR')
        xff_ips = []
        if xff_raw:
            xff_ips = [
                ip
                for ip in (ActivityService._normalize_ip(part) for part in str(xff_raw).split(','))
                if ip
            ]

        trust_xff = bool(getattr(settings, 'RATE_LIMIT_TRUST_X_FORWARDED_FOR', False))
        if trust_xff:
            if xff_ips:
                return xff_ips[0]
            if x_real_ip:
                return x_real_ip
            if forwarded_ip:
                return forwarded_ip
            return remote_addr

        # Safe fallback for reverse-proxy setups where REMOTE_ADDR is internal.
        if remote_addr and not ActivityService._is_internal_ip(remote_addr):
            return remote_addr
        if x_real_ip:
            return x_real_ip
        if xff_ips:
            return xff_ips[0]
        if forwarded_ip:
            return forwarded_ip

        return remote_addr

    @classmethod
    def _should_log_single_card_status(cls, request, action_label, client_name=''):
        """Rate-limit repeated single-card status logs per user/action/client."""
        if request is None:
            return True

        user = getattr(request, 'user', None)
        user_id = getattr(user, 'pk', None) if user and getattr(user, 'is_authenticated', False) else 'anon'
        action_part = str(action_label or '').strip().lower()
        client_part = str(client_name or '').strip().lower()
        cache_key = f"activity:single-card-status:{user_id}:{action_part}:{client_part}"

        try:
            return bool(django_cache.add(cache_key, 1, timeout=cls.SINGLE_CARD_STATUS_LOG_THROTTLE_SECONDS))
        except Exception:
            # If cache fails, never block logging.
            return True

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
    def log_export_failed(
        cls,
        request=None,
        user=None,
        export_type='export',
        message='',
        table_id=None,
        table_name='',
        source='sync',
    ):
        label = cls.EXPORT_LABELS.get(export_type, '').strip()
        if not label:
            raw = str(export_type or 'export').replace('export_', '').strip().upper()
            label = raw or 'EXPORT'
        source_label = 'sync' if str(source or '').lower() != 'async' else 'async'
        desc = f'Export failed ({source_label}) [{label}]'
        if table_name:
            desc += f' for "{table_name}"'
        if message:
            desc += f': {message}'
        cls.log(
            'other',
            desc,
            user=user,
            request=request,
            target_model='Export',
            target_id=table_id,
            target_name=table_name,
        )

    @classmethod
    def log_card_status(cls, request, action_label, count, client_name=''):
        """Log single or bulk card status change.  action_label e.g. 'verified', 'approved'."""
        suffix = f' for {client_name}' if client_name else ''
        if count == 1:
            if not cls._should_log_single_card_status(request, action_label, client_name):
                return
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
    def get_recent(cls, limit=8, hours=24, user=None, hide_admin_names=False):
        """
        Return the most recent activity entries for the dashboard.
        Only shows entries from the last `hours` hours (default 24).
        
        Args:
            limit: Maximum number of entries to return
            hours: Only show entries from the last N hours
            user: If provided, filter activities based on user role:
                - super_admin: All activities
                - admin_staff: Activities for assigned clients only
                - client: Only activities performed by themselves or their own staff
                - client_staff: Only their own activities
            hide_admin_names: If True, replace admin/admin_staff names with "System".
                Automatically enabled for client and client_staff users.
        
        Returns:
            List of dicts ready for template rendering.
        """
        now = timezone.now()

        # Base queryset (no time filter when hours is None)
        qs = ActivityLog.objects.select_related('user').order_by('-created_at')
        if hours is not None:
            cutoff = now - timezone.timedelta(hours=hours)
            qs = qs.filter(created_at__gte=cutoff)
        
        # Apply role-based filtering
        if user and user.is_authenticated:
            qs = cls._apply_role_filter(qs, user)
            # Always hide admin names for client-side users (defense in depth)
            if user.role in ('client', 'client_staff'):
                hide_admin_names = True
        
        fetch_limit = min(
            max(limit * cls.RECENT_ACTIVITY_FETCH_MULTIPLIER, limit),
            cls.RECENT_ACTIVITY_FETCH_CAP,
        )

        raw_results = []
        for entry in qs[:fetch_limit]:
            actor = cls._get_actor_display(entry, user, hide_admin_names)

            raw_results.append({
                'id': entry.pk,
                'user_id': entry.user_id,
                'actor': actor,
                'action': entry.action,
                'description': entry.description,
                'icon_class': entry.icon_class,
                'icon_color': entry.icon_color,
                'created_at_dt': entry.created_at,
            })

        merged_results = cls._merge_recent_card_activities(raw_results)

        results = []
        for item in merged_results[:limit]:
            results.append({
                'id': item['id'],
                'actor': item['actor'],
                'action': item['action'],
                'description': item['description'],
                'icon_class': item['icon_class'],
                'icon_color': item['icon_color'],
                'time_ago': timesince(item['created_at_dt'], now),
                'created_at': item['created_at_dt'].isoformat(),
            })
        return results

    @classmethod
    def _parse_card_activity_description(cls, description):
        """Return parsed card activity tuple: (count, status, client) or None."""
        if not description:
            return None

        desc_text = str(description).strip()

        match = cls.CARD_ACTIVITY_DESCRIPTION_RE.match(desc_text)
        if match:
            try:
                count = int(match.group('count'))
            except (TypeError, ValueError):
                return None

            status = str(match.group('status') or '').strip().lower()
            client = str(match.group('client') or '').strip()
            if not status:
                return None
            return count, status, client

        # Backward-compat for older activity text format:
        # "Card moved from Pending to In Pool for <client>"
        move_match = cls.CARD_ACTIVITY_MOVE_RE.match(desc_text)
        if not move_match:
            return None

        try:
            count = int(move_match.group('count') or 1)
        except (TypeError, ValueError):
            return None

        from_label = str(move_match.group('from') or '').strip()
        to_label = str(move_match.group('to') or '').strip()
        client = str(move_match.group('client') or '').strip()

        if not from_label or not to_label:
            return None

        status = f'moved from {from_label} to {to_label}'.lower()
        if not status:
            return None
        return count, status, client

    @classmethod
    def _merge_recent_card_activities(cls, items):
        """Collapse adjacent card status entries into combined count rows."""
        if not items:
            return []

        merged = []

        for item in items:
            parsed = None
            if item.get('action') in ('card_status', 'card_bulk_status'):
                parsed = cls._parse_card_activity_description(item.get('description', ''))

            if not parsed:
                merged.append(item)
                continue

            count, status, client = parsed
            item_key = (item.get('user_id'), status, client.lower())

            if merged:
                last = merged[-1]
                last_key = last.get('_merge_key')
                last_dt = last.get('created_at_dt')
                item_dt = item.get('created_at_dt')

                can_merge = (
                    last_key == item_key and
                    last_dt is not None and
                    item_dt is not None and
                    (last_dt - item_dt).total_seconds() <= cls.RECENT_ACTIVITY_CARD_COMBINE_WINDOW_SECONDS
                )

                if can_merge:
                    last['_merge_count'] = last.get('_merge_count', 1) + count
                    total = last['_merge_count']
                    suffix = f' for {client}' if client else ''
                    noun = 'card' if total == 1 else 'cards'
                    last['description'] = f'{total} {noun} {status}{suffix}'
                    last['action'] = 'card_bulk_status' if total > 1 else 'card_status'
                    continue

            suffix = f' for {client}' if client else ''
            noun = 'card' if count == 1 else 'cards'
            item['description'] = f'{count} {noun} {status}{suffix}'
            item['_merge_key'] = item_key
            item['_merge_count'] = count
            merged.append(item)

        for row in merged:
            row.pop('_merge_key', None)
            row.pop('_merge_count', None)

        return merged
    
    @classmethod
    def _apply_role_filter(cls, queryset, user):
        """
        Apply role-based filtering to activity queryset.
        
        SECURITY: Client/client_staff must NEVER see admin-side activities.
        
        Role-based visibility:
        - super_admin: All activities
        - admin_staff: All activities (scoped to assigned clients + own)
        - client: ONLY activities performed by the client user themselves
                  or by their client_staff members — never admin actions
        - client_staff: ONLY their own activities — never admin or other
                        staff/client actions
        """
        from core.services.permission_service import PermissionService
        from django.db.models import Q
        
        # Super admin sees everything
        if PermissionService.is_super_admin(user):
            return queryset
        
        # Admin staff: filter by assigned clients + own activities
        if user.role == 'admin_staff':
            staff = getattr(user, 'staff_profile', None)
            if staff:
                client_ids = list(staff.assigned_clients.values_list('id', flat=True))
                if client_ids:
                    return queryset.filter(
                        Q(target_model='Client', target_id__in=client_ids) |
                        Q(user=user)
                    )
                return queryset.filter(user=user)
            return queryset.none()
        
        # ── Client isolation ────────────────────────────────────────
        # Clients only see activities performed by users in their own
        # organisation (role in client, client_staff + belonging to
        # the same client).  Admin/admin_staff activities are EXCLUDED.
        
        if user.role == 'client':
            client = getattr(user, 'client_profile', None)
            if client:
                # Collect all user PKs that belong to this client org
                from core.models import User as UserModel
                org_user_ids = set()
                org_user_ids.add(user.pk)  # the client user themselves
                # Add all client_staff belonging to this client
                staff_user_ids = list(
                    UserModel.objects.filter(
                        role='client_staff',
                        staff_profile__client_id=client.id,
                    ).values_list('pk', flat=True)
                )
                org_user_ids.update(staff_user_ids)
                
                return queryset.filter(user_id__in=org_user_ids)
            return queryset.none()
        
        # Client staff: see ONLY their own activities
        if user.role == 'client_staff':
            return queryset.filter(user=user)
        
        return queryset.none()
    
    @classmethod
    def _get_actor_display(cls, entry, viewing_user, hide_admin_names=False):
        """
        Get the display name for the activity actor.
        
        Always hides admin/admin_staff names from client/client_staff users
        (shows "System" instead). This is enforced regardless of the
        hide_admin_names flag when the viewing_user is a client-side role.
        """
        if not entry.user:
            return 'System'
        
        actor_role = entry.user.role
        actor_name = entry.user.get_full_name() or entry.user.username
        
        # Always hide admin identities from client-side users
        if viewing_user and viewing_user.is_authenticated:
            if viewing_user.role in ('client', 'client_staff'):
                if actor_role in ('super_admin', 'admin_staff') or entry.user.is_superuser:
                    return 'System'
        
        # Explicit hide_admin_names flag (for backward compatibility)
        if hide_admin_names:
            if actor_role in ('super_admin', 'admin_staff') or entry.user.is_superuser:
                return 'System'
        
        return actor_name

    @classmethod
    def cleanup_old(cls, days=7):
        """
        Delete activity log entries older than `days` days.
        Called periodically (e.g. via management command or scheduled task).
        Returns the number of entries deleted.
        """
        cutoff = timezone.now() - timezone.timedelta(days=days)
        deleted, _ = ActivityLog.objects.filter(created_at__lt=cutoff).delete()
        if deleted:
            logger.info(f'Cleaned up {deleted} old activity log entries')
        return deleted
