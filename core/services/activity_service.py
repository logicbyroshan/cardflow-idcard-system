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
    # Group repeated non-auth activity rows when they occur in a short working burst.
    RECENT_ACTIVITY_SIMILAR_COMBINE_WINDOW_SECONDS = 3600
    RECENT_ACTIVITY_FETCH_MULTIPLIER = 10
    RECENT_ACTIVITY_FETCH_CAP = 300
    RECENT_ACTIVITY_SIMILAR_ACTIONS = {
        'client_update',
        'client_status',
        'notification_create',
        'notification_delete',
        'email_send',
        'email_resend',
        'backup_initiate',
        'backup_start',
        'backup_delete',
        'group_create',
        'group_update',
        'group_delete',
        'table_create',
        'table_update',
        'table_delete',
        'reprint_request',
        'staff_update',
        'staff_assignment',
        'staff_status',
        'card_update',
        'card_status',
        'card_bulk_status',
        'image_upload',
        'image_reupload',
        'table_update',
        'group_update',
        'reprint_status',
        'settings_update',
        'bulk_upgrade',
        'bulk_delete',
    }
    CARD_ACTIVITY_DESCRIPTION_RE = re.compile(
        r'^(?P<count>\d+)\s+cards?\s+(?P<status>[^\n]+?)(?:\s+for\s+(?P<client>.+))?$',
        re.IGNORECASE,
    )
    CARD_ACTIVITY_MOVE_RE = re.compile(
        r'^(?:(?P<count>\d+)\s+)?cards?\s+moved\s+from\s+(?P<from>[^\n]+?)\s+to\s+(?P<to>[^\n]+?)(?:\s+for\s+(?P<client>.+))?$',
        re.IGNORECASE,
    )
    STATUS_TO_RE = re.compile(r'\bstatus(?:\s+changed)?\s+to\s+([a-z0-9_\- ]+)\b', re.IGNORECASE)
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

    @staticmethod
    def _request_login_surface(request):
        """Infer login surface for auth logs: desktop or mobile."""
        if request is None:
            return 'desktop'

        session = getattr(request, 'session', None)
        if session is not None:
            try:
                surface = str(session.get('_auth_login_surface') or '').strip().lower()
                if surface in {'desktop', 'mobile'}:
                    return surface
                if bool(session.get('mobile_auth_ok')):
                    return 'mobile'
            except Exception:
                pass

        ua = str(getattr(request, 'META', {}).get('HTTP_USER_AGENT', '') or '').lower()
        mobile_tokens = ('android', 'iphone', 'ipad', 'ipod', 'mobile', 'iemobile', 'opera mini')
        if any(token in ua for token in mobile_tokens):
            return 'mobile'
        return 'desktop'

    @staticmethod
    def _surface_label(surface):
        normalized = str(surface or '').strip().lower()
        if normalized == 'mobile':
            return 'mobile app'
        return 'desktop web'

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
        surface = cls._request_login_surface(request)
        cls.log('login', f'{name} logged in from {cls._surface_label(surface)}', user=user, request=request)

    @classmethod
    def log_logout(cls, request, user):
        name = user.get_full_name() or user.username
        surface = cls._request_login_surface(request)
        cls.log('logout', f'{name} logged out from {cls._surface_label(surface)}', user=user, request=request)

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

    @staticmethod
    def _normalize_assignment_int_list(values, max_items=300):
        if not isinstance(values, (list, tuple, set)):
            return []
        normalized = []
        seen = set()
        for item in values:
            try:
                val = int(str(item).strip())
            except (TypeError, ValueError):
                continue
            if val <= 0 or val in seen:
                continue
            seen.add(val)
            normalized.append(val)
            if len(normalized) >= max_items:
                break
        normalized.sort()
        return normalized

    @staticmethod
    def _normalize_assignment_text_list(values, max_items=300):
        if not isinstance(values, (list, tuple, set)):
            return []
        normalized = []
        seen = set()
        for item in values:
            text = str(item or '').strip()
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(text)
            if len(normalized) >= max_items:
                break
        normalized.sort(key=lambda value: value.lower())
        return normalized

    @classmethod
    def log_staff_assignment_change(cls, request, staff, before_snapshot, after_snapshot, reason='updated'):
        """Write a focused assignment-change activity log entry when assignment state changes."""
        before = before_snapshot if isinstance(before_snapshot, dict) else {}
        after = after_snapshot if isinstance(after_snapshot, dict) else {}

        fields = [
            ('client_ids', 'clients', cls._normalize_assignment_int_list),
            ('group_ids', 'groups', cls._normalize_assignment_int_list),
            ('table_ids', 'tables', cls._normalize_assignment_int_list),
            ('classes', 'classes', cls._normalize_assignment_text_list),
            ('sections', 'sections', cls._normalize_assignment_text_list),
            ('branches', 'branches', cls._normalize_assignment_text_list),
        ]

        parts = []
        for key, label, normalizer in fields:
            before_values = normalizer(before.get(key, []))
            after_values = normalizer(after.get(key, []))
            if before_values != after_values:
                parts.append(f'{label} {len(before_values)}->{len(after_values)}')

        before_scope_count = int(before.get('scope_count') or 0)
        after_scope_count = int(after.get('scope_count') or 0)
        if before_scope_count != after_scope_count:
            parts.append(f'scopes {before_scope_count}->{after_scope_count}')

        if not parts:
            return

        name = staff.user.get_full_name() or staff.user.username
        action_word = 'initialized' if str(reason or '').strip().lower() == 'created' else 'updated'
        description = f'Staff "{name}" assignment {action_word}: ' + '; '.join(parts)
        if len(description) > 500:
            description = description[:497] + '...'

        cls.log(
            'staff_assignment',
            description,
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
    def log_cards_download(cls, request, card_ids, format_name):
        """Bulk log data download for individual cards to maintain deep history."""
        if not card_ids:
            return
            
        try:
            from core.models import ActivityLog
            user = getattr(request, 'user', None)
            ip_address = cls._get_ip(request)
            
            logs = []
            for cid in card_ids:
                logs.append(ActivityLog(
                    user=user if getattr(user, 'is_authenticated', False) else None,
                    action='card_bulk_download',
                    description=f'Data downloaded ({format_name})',
                    ip_address=ip_address,
                    target_model='IDCard',
                    target_id=cid,
                    target_name=f'Card #{cid}'
                ))
            
            # Use bulk_create for performance, batch size 1000
            ActivityLog.objects.bulk_create(logs, batch_size=1000)
        except Exception:
            import logging
            logging.getLogger(__name__).exception('Failed to bulk log card downloads')

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
    def get_recent(cls, limit=8, hours=24, user=None, hide_admin_names=False, merge_card_activity=True):
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
            merge_card_activity: If True, collapse similar card-status rows into grouped entries.
        
        Returns:
            List of dicts ready for template rendering.
        """
        now = timezone.now()

        # Unbounded history queries are used for audit-style views and tests that
        # expect exact rows to remain visible instead of being collapsed.
        if hours is None:
            merge_card_activity = False

        # Base queryset (no time filter when hours is None)
        qs = ActivityLog.objects.select_related('user', 'user__client_profile', 'user__staff_profile__client').order_by('-created_at')
        if hours is not None:
            cutoff = now - timezone.timedelta(hours=hours)
            qs = qs.filter(created_at__gte=cutoff)
        
        # Apply role-based filtering
        if user and user.is_authenticated:
            qs = cls._apply_role_filter(qs, user)
            # Always hide admin names for client-side users (defense in depth)
            if user.role in ('client', 'client_staff'):
                hide_admin_names = True
        
        if merge_card_activity:
            fetch_limit = min(
                max(limit * cls.RECENT_ACTIVITY_FETCH_MULTIPLIER, limit),
                cls.RECENT_ACTIVITY_FETCH_CAP,
            )
        else:
            fetch_limit = max(limit, 1)

        raw_results = []
        for entry in qs[:fetch_limit]:
            actor = cls._get_actor_display(entry, user, hide_admin_names)
            actor_role = getattr(entry.user, 'role', '') if entry.user else ''
            client_context = cls._resolve_activity_client_context(entry)
            description = entry.description

            if entry.action == 'password_reset' and entry.user and getattr(entry.user, 'email', ''):
                # Ensure dashboard recent activity always shows full email for reset actions.
                description = f'Password reset completed for {entry.user.email}'

            raw_results.append({
                'id': entry.pk,
                'user_id': entry.user_id,
                'actor': actor,
                'actor_role': actor_role,
                'action': entry.action,
                'description': description,
                'target_model': entry.target_model,
                'target_id': entry.target_id,
                'target_name': entry.target_name,
                'client_context': client_context,
                'icon_class': entry.icon_class,
                'icon_color': entry.icon_color,
                'created_at_dt': entry.created_at,
            })

        card_merged_results = cls._merge_recent_card_activities(raw_results) if merge_card_activity else raw_results
        merged_results = cls._merge_recent_similar_activities(card_merged_results)

        results = []
        for item in merged_results[:limit]:
            created_at_dt = item['created_at_dt']
            results.append({
                'id': item['id'],
                'actor': item['actor'],
                'actor_role': item.get('actor_role', ''),
                'action': item['action'],
                'description': item['description'],
                'display_text': cls._build_activity_display_text(item),
                'target_model': item.get('target_model', ''),
                'target_id': item.get('target_id'),
                'target_name': item.get('target_name', ''),
                'client_context': item.get('client_context', ''),
                'icon_class': item['icon_class'],
                'icon_color': item['icon_color'],
                'time_ago': timesince(created_at_dt, now),
                'created_at': created_at_dt.isoformat(),
                'created_at_display': timezone.localtime(created_at_dt).strftime('%d-%m-%Y %H:%M'),
            })
        return results

    @classmethod
    def _build_activity_display_text(cls, item):
        """Build richer activity chip text without mutating canonical description."""
        text = str(item.get('description') or '').strip() or 'Activity update'
        action = str(item.get('action') or '').strip().lower()
        actor = str(item.get('actor') or '').strip()
        actor_role = str(item.get('actor_role') or '').strip().lower()
        client_context = str(item.get('client_context') or '').strip()
        actor_descriptor = cls._format_actor_descriptor(actor, actor_role, client_context)
        target_model = str(item.get('target_model') or '').strip().lower()
        target_id = item.get('target_id')
        target_name = cls._resolve_display_target_name(
            target_model=target_model,
            target_name=item.get('target_name'),
            target_id=target_id,
            client_context=client_context,
        )
        merge_count = max(int(item.get('_merged_event_count') or 1), 1)
        merge_span_seconds = max(int(item.get('_merged_span_seconds') or 0), 0)

        def _with_merge_suffix(base_text):
            if merge_count <= 1:
                return base_text
            duration = cls._format_merge_duration(merge_span_seconds)
            suffix = f' ({merge_count} actions'
            if duration:
                suffix += f' in {duration}'
            suffix += ')'
            return f'{base_text}{suffix}'

        if action.startswith('staff_') and target_name and target_name.lower() not in text.lower():
            text = f'{text} (Staff: {target_name})'

        if action.startswith('client_') and target_name and target_name.lower() not in text.lower():
            text = f'{text} (Client: {target_name})'

        if action in ('login', 'logout'):
            surface = cls._extract_login_surface_from_description(text)
            if actor_descriptor != 'System':
                verb = 'logged in' if action == 'login' else 'logged out'
                base = f'{actor_descriptor} {verb}'
                if surface:
                    base += f' via {surface}'
                return _with_merge_suffix(base)
            return _with_merge_suffix(text)

        if action in ('password_reset', 'staff_password_reset'):
            target = target_name or (f'User #{target_id}' if target_id else 'user account')
            if actor_descriptor != 'System':
                return _with_merge_suffix(f'{actor_descriptor} reset password for {target}')
            return _with_merge_suffix(f'Password reset completed for {target}')

        if action in ('impersonate_start', 'impersonate_stop'):
            verb = 'started impersonation for' if action == 'impersonate_start' else 'stopped impersonation for'
            target = target_name or (f'User #{target_id}' if target_id else 'a user')
            if actor_descriptor != 'System':
                return _with_merge_suffix(f'{actor_descriptor} {verb} {target}')
            return _with_merge_suffix(text)

        status_label = cls._extract_status_from_description(text)
        if action == 'client_status':
            target = target_name or client_context or (f'Client #{target_id}' if target_id else 'client')
            status_phrase = cls._humanize_status_change('client', status_label)
            if actor_descriptor != 'System':
                return _with_merge_suffix(f'{actor_descriptor} {status_phrase} {target}')
            return _with_merge_suffix(f'{status_phrase.capitalize()} {target}')

        if action == 'staff_status':
            target = target_name or (f'Staff #{target_id}' if target_id else 'staff member')
            status_phrase = cls._humanize_status_change('staff', status_label)
            if actor_descriptor != 'System':
                return _with_merge_suffix(f'{actor_descriptor} {status_phrase} {target}')
            return _with_merge_suffix(f'{status_phrase.capitalize()} {target}')

        if action in {'client_update', 'client_create', 'client_delete'}:
            verb_map = {
                'client_update': 'updated client profile',
                'client_create': 'created client account',
                'client_delete': 'removed client account',
            }
            target = target_name or client_context or (f'Client #{target_id}' if target_id else 'client')
            if actor_descriptor != 'System':
                return _with_merge_suffix(f'{actor_descriptor} {verb_map.get(action)} for {target}')
            return _with_merge_suffix(f'{verb_map.get(action).capitalize()} for {target}')

        if action in {'staff_update', 'staff_create', 'staff_delete', 'staff_assignment'}:
            verb_map = {
                'staff_update': 'updated staff profile',
                'staff_create': 'created staff account',
                'staff_delete': 'removed staff account',
                'staff_assignment': 'updated staff assignment scope',
            }
            target = target_name or (f'Staff #{target_id}' if target_id else 'staff member')
            if actor_descriptor != 'System':
                return _with_merge_suffix(f'{actor_descriptor} {verb_map.get(action)} for {target}')
            return _with_merge_suffix(f'{verb_map.get(action).capitalize()} for {target}')

        if action in {'group_create', 'group_update', 'group_delete', 'table_create', 'table_update', 'table_delete'}:
            label_map = {
                'group_create': 'created group',
                'group_update': 'updated group',
                'group_delete': 'deleted group',
                'table_create': 'created table',
                'table_update': 'updated table',
                'table_delete': 'deleted table',
            }
            target = target_name or (f'{target_model.title()} #{target_id}' if target_id else target_model)
            if actor_descriptor != 'System':
                return _with_merge_suffix(f'{actor_descriptor} {label_map.get(action, "updated")} {target}'.strip())
            return _with_merge_suffix(text)

        if action in {'settings_update', 'website_update'}:
            detail = cls._extract_detail_after_colon(text)
            phrase = 'updated system settings' if action == 'settings_update' else 'updated website content'
            if actor_descriptor != 'System':
                base = f'{actor_descriptor} {phrase}'
                if detail:
                    base += f' ({detail})'
                return _with_merge_suffix(base)
            return _with_merge_suffix(text)

        if action in {'notification_create', 'notification_delete'}:
            verb = 'created notification' if action == 'notification_create' else 'deleted notification'
            target = target_name or 'broadcast message'
            if actor_descriptor != 'System':
                return _with_merge_suffix(f'{actor_descriptor} {verb}: {target}')
            return _with_merge_suffix(text)

        if action in {'email_send', 'email_resend'}:
            verb = 'sent email' if action == 'email_send' else 'resent email'
            target = target_name or cls._extract_detail_after_colon(text)
            if actor_descriptor != 'System':
                if target:
                    return _with_merge_suffix(f'{actor_descriptor} {verb}: {target}')
                return _with_merge_suffix(f'{actor_descriptor} {verb}')
            return _with_merge_suffix(text)

        if action in {'backup_initiate', 'backup_start', 'backup_delete'}:
            verb_map = {
                'backup_initiate': 'initiated backup',
                'backup_start': 'started backup pipeline',
                'backup_delete': 'deleted backup archive',
            }
            target = target_name or cls._extract_detail_after_colon(text)
            if actor_descriptor != 'System':
                base = f'{actor_descriptor} {verb_map.get(action)}'
                if target:
                    base += f' ({target})'
                return _with_merge_suffix(base)
            return _with_merge_suffix(text)

        if action in {'reprint_request', 'reprint_status'}:
            verb = 'submitted reprint request' if action == 'reprint_request' else 'updated reprint status'
            target = target_name or client_context or (f'Reprint #{target_id}' if target_id else '')
            if actor_descriptor != 'System':
                base = f'{actor_descriptor} {verb}'
                if target:
                    base += f' for {target}'
                return _with_merge_suffix(base)
            return _with_merge_suffix(text)

        if action in {'image_upload', 'image_reupload'}:
            verb = 'uploaded images' if action == 'image_upload' else 're-uploaded images'
            target = target_name or client_context
            if actor_descriptor != 'System':
                if target:
                    return _with_merge_suffix(f'{actor_descriptor} {verb} for {target}')
                return _with_merge_suffix(f'{actor_descriptor} {verb}')
            return _with_merge_suffix(text)

        if action in {'card_update', 'card_status', 'card_bulk_status', 'card_create', 'bulk_upgrade', 'bulk_delete'}:
            if actor_descriptor != 'System' and actor_descriptor.lower() not in text.lower():
                text = f'{actor_descriptor}: {text}'
            if client_context and client_context.lower() not in text.lower() and actor_role not in ('client', 'client_staff'):
                text = f'{text} | Client: {client_context}'
            return _with_merge_suffix(text)

        if actor_descriptor != 'System' and actor_descriptor.lower() not in text.lower():
            text = f'{actor_descriptor}: {text}'

        if client_context and client_context.lower() not in text.lower() and actor_role not in ('client', 'client_staff'):
            text = f'{text} | Client: {client_context}'

        return _with_merge_suffix(text)

    @classmethod
    def _format_actor_descriptor(cls, actor, actor_role, client_context=''):
        """Return actor label with role context for richer dashboard activity chips."""
        actor_name = str(actor or '').strip()
        role = str(actor_role or '').strip().lower()
        client_name = str(client_context or '').strip()

        if not actor_name or actor_name == 'System':
            return 'System'

        if role == 'super_admin':
            return f'Admin "{actor_name}"'
        if role == 'admin_staff':
            return f'Operator "{actor_name}"'
        if role == 'client':
            return f'Client "{actor_name}"'
        if role == 'client_staff':
            if client_name:
                return f'Assistant "{actor_name}" for "{client_name}"'
            return f'Assistant "{actor_name}"'
        if role == 'pro_user':
            return f'Pro User "{actor_name}"'

        return actor_name

    @staticmethod
    def _format_activity_role(role):
        """Return compact human labels for activity role hints."""
        labels = {
            'super_admin': 'Super Admin',
            'admin_staff': 'Admin Staff',
            'client': 'Client',
            'client_staff': 'Client Staff',
            'pro_user': 'Pro User',
        }
        return labels.get(str(role or '').strip().lower(), '')

    @classmethod
    def _resolve_activity_client_context(cls, entry):
        """Best-effort client label for activity chips (staff/client/login actions)."""
        target_model = str(getattr(entry, 'target_model', '') or '').strip().lower()
        target_name = str(getattr(entry, 'target_name', '') or '').strip()
        target_id = getattr(entry, 'target_id', None)

        if target_model == 'client' and target_name:
            return target_name

        if target_model == 'client' and target_id:
            try:
                from client.models import Client

                client_name = (
                    Client.objects
                    .filter(id=target_id)
                    .values_list('name', flat=True)
                    .first()
                )
                if client_name:
                    return str(client_name).strip()
            except Exception:
                pass

        user = getattr(entry, 'user', None)
        if user:
            if user.role == 'client':
                client_profile = getattr(user, 'client_profile', None)
                if client_profile and client_profile.name:
                    return client_profile.name
            if user.role == 'client_staff':
                staff_profile = getattr(user, 'staff_profile', None)
                client = getattr(staff_profile, 'client', None) if staff_profile else None
                if client and client.name:
                    return client.name

        if target_model != 'staff':
            return ''

        target_id = getattr(entry, 'target_id', None)
        if not target_id:
            return ''

        try:
            from staff.models import Staff

            staff_obj = (
                Staff.objects
                .select_related('client')
                .only('id', 'client__name')
                .filter(id=target_id)
                .first()
            )
            if staff_obj and staff_obj.client and staff_obj.client.name:
                return staff_obj.client.name
        except Exception:
            return ''

        return ''

    @classmethod
    def _resolve_display_target_name(cls, *, target_model, target_name, target_id, client_context=''):
        """Resolve the best human target label for activity text."""
        raw_target_name = str(target_name or '').strip()
        if raw_target_name:
            return raw_target_name

        if target_model == 'client':
            if client_context:
                return str(client_context).strip()
            if target_id:
                try:
                    from client.models import Client

                    client_name = (
                        Client.objects
                        .filter(id=target_id)
                        .values_list('name', flat=True)
                        .first()
                    )
                    if client_name:
                        return str(client_name).strip()
                except Exception:
                    pass
            return ''

        if target_model == 'staff' and target_id:
            try:
                from staff.models import Staff

                staff_obj = (
                    Staff.objects
                    .select_related('user')
                    .filter(id=target_id)
                    .first()
                )
                if staff_obj and staff_obj.user:
                    return (staff_obj.user.get_full_name() or staff_obj.user.username or '').strip()
            except Exception:
                pass
            return ''

        if target_model == 'idcard' and target_id:
            return f'ID Card #{target_id}'

        return ''

    @classmethod
    def _extract_status_from_description(cls, description):
        """Extract terminal status text from legacy status-change descriptions."""
        text = str(description or '').strip()
        if not text:
            return ''
        match = cls.STATUS_TO_RE.search(text)
        if not match:
            return ''
        return ' '.join(str(match.group(1) or '').strip().split())

    @staticmethod
    def _extract_detail_after_colon(description):
        text = str(description or '').strip()
        if ':' not in text:
            return ''
        detail = text.split(':', 1)[1].strip()
        return detail

    @staticmethod
    def _extract_login_surface_from_description(description):
        text = str(description or '').strip().lower()
        if 'mobile app' in text:
            return 'mobile app'
        if 'desktop web' in text:
            return 'desktop web'
        if 'desktop' in text:
            return 'desktop'
        if 'mobile' in text:
            return 'mobile'
        return ''

    @staticmethod
    def _humanize_status_change(subject, status_label):
        status = str(status_label or '').strip().lower()
        subject_text = str(subject or '').strip().lower() or 'item'
        if status == 'active':
            return f'activated {subject_text}'
        if status in {'inactive', 'disabled'}:
            return f'deactivated {subject_text}'
        if status in {'blocked', 'suspended'}:
            return f'blocked {subject_text}'
        if status:
            return f'changed {subject_text} status to {status}'
        return f'changed {subject_text} status for'

    @staticmethod
    def _format_merge_duration(seconds):
        """Compact merge-window formatter (e.g. 45m, 1h 10m)."""
        total_seconds = max(int(seconds or 0), 0)
        if total_seconds < 60:
            return ''
        total_minutes = total_seconds // 60
        if total_minutes < 60:
            return f'{total_minutes}m'
        hours = total_minutes // 60
        minutes = total_minutes % 60
        if minutes:
            return f'{hours}h {minutes}m'
        return f'{hours}h'

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
    def _build_similar_merge_key(cls, item):
        """Return a merge key for adjacent similar activity rows."""
        action = str(item.get('action') or '').strip().lower()
        if action not in cls.RECENT_ACTIVITY_SIMILAR_ACTIONS:
            return None, 1

        def _safe_int(value):
            try:
                return int(value)
            except (TypeError, ValueError):
                raw = str(value or '').strip()
                return f'bad:{raw}' if raw else 0

        user_id = item.get('user_id') or 0
        target_model = str(item.get('target_model') or '').strip().lower()
        target_id = item.get('target_id') or 0
        target_name = str(item.get('target_name') or '').strip().lower()
        client_context = str(item.get('client_context') or '').strip().lower()
        description = ' '.join(str(item.get('description') or '').strip().lower().split())

        card_unit_count = 1
        detail_discriminator = ''

        if action in {'card_status', 'card_bulk_status'}:
            parsed = cls._parse_card_activity_description(description)
            if parsed:
                card_unit_count = max(int(parsed[0] or 1), 1)
                detail_discriminator = f'{parsed[1]}|{parsed[2].strip().lower()}'
            else:
                detail_discriminator = description[:160]
        elif action in {'client_status', 'staff_status', 'reprint_status'}:
            detail_discriminator = cls._extract_status_from_description(description) or description[:160]
        elif not target_id:
            detail_discriminator = description[:160]

        key = (
            user_id,
            action,
            target_model,
            _safe_int(target_id),
            target_name if not target_id else '',
            client_context,
            detail_discriminator,
        )
        return key, card_unit_count

    @classmethod
    def _merge_recent_similar_activities(cls, items):
        """Collapse adjacent repeated actions from the same actor within a one-hour work burst."""
        if not items:
            return []

        merged = []

        for item in items:
            merge_key, card_units = cls._build_similar_merge_key(item)
            item['_merged_event_count'] = 1
            item['_merged_span_seconds'] = 0
            item['_merged_card_units'] = max(int(card_units or 1), 1)
            item['_similar_merge_key'] = merge_key
            item['_oldest_created_at_dt'] = item.get('created_at_dt')

            if merge_key and merged:
                last = merged[-1]
                last_key = last.get('_similar_merge_key')
                last_dt = last.get('created_at_dt')
                item_dt = item.get('created_at_dt')

                can_merge = (
                    last_key == merge_key
                    and last_dt is not None
                    and item_dt is not None
                    and (last_dt - item_dt).total_seconds() <= cls.RECENT_ACTIVITY_SIMILAR_COMBINE_WINDOW_SECONDS
                )

                if can_merge:
                    last['_merged_event_count'] = int(last.get('_merged_event_count') or 1) + 1
                    last['_oldest_created_at_dt'] = item_dt
                    last['_merged_span_seconds'] = max(int((last_dt - item_dt).total_seconds()), 0)

                    if str(last.get('action') or '').strip().lower() in {'card_status', 'card_bulk_status'}:
                        total_cards = int(last.get('_merged_card_units') or 1) + int(item.get('_merged_card_units') or 1)
                        last['_merged_card_units'] = total_cards
                        parsed = cls._parse_card_activity_description(last.get('description', ''))
                        if parsed:
                            status = parsed[1]
                            client = parsed[2]
                            suffix = f' for {client}' if client else ''
                            noun = 'card' if total_cards == 1 else 'cards'
                            last['description'] = f'{total_cards} {noun} {status}{suffix}'
                            last['action'] = 'card_bulk_status' if total_cards > 1 else 'card_status'
                    continue

            merged.append(item)

        for row in merged:
            row.pop('_similar_merge_key', None)
            row.pop('_oldest_created_at_dt', None)
            row.pop('_merged_card_units', None)

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
                # Keep this as a single SQL query by filtering through joins,
                # instead of first fetching staff user IDs in a separate query.
                return queryset.filter(
                    Q(user_id=user.pk) |
                    Q(user__role='client_staff', user__staff_profile__client_id=client.id)
                )
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
        if not bool(getattr(settings, 'ACTIVITY_LOG_AUTOCLEAN_ENABLED', False)):
            logger.warning(
                'Activity log cleanup skipped because ACTIVITY_LOG_AUTOCLEAN_ENABLED is disabled.'
            )
            return 0

        min_days = max(int(getattr(settings, 'ACTIVITY_LOG_MIN_RETENTION_DAYS', 30) or 30), 1)
        try:
            requested_days = int(days)
        except (TypeError, ValueError):
            requested_days = min_days
        safe_days = max(requested_days, min_days)

        if safe_days != requested_days:
            logger.warning(
                'Activity log cleanup days=%s below minimum retention=%s; clamped to %s.',
                requested_days,
                min_days,
                safe_days,
            )

        cutoff = timezone.now() - timezone.timedelta(days=safe_days)
        deleted, _ = ActivityLog.objects.filter(created_at__lt=cutoff).delete()
        if deleted:
            logger.info(f'Cleaned up {deleted} old activity log entries')
        return deleted
