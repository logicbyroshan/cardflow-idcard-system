"""
Mobile App Context Processor

Automatically injects two groups of globals into every mobile app template
(any URL under /app/).  No-ops for non-/app/ paths and unauthenticated users,
so it adds zero overhead to panel / website pages.

Injected keys:
  notification_count     — Unread notification count (capped at 99).
                           Used by navbar bell badge + profile drawer.
  admin_client_count     — Active client count         (admin roles only)
  admin_staff_count      — Total staff count           (admin roles only)
  admin_table_count      — Active table count          (admin roles only)
  admin_total_cards      — Total ID-card count         (admin roles only)

This fixes:
  C1 — Bell badge showing 0 on all pages except Home.
  C2 — Hamburger drawer "Team Overview" stats showing 0 on non-Home pages.
"""

import logging
from django.core.cache import cache

logger = logging.getLogger(__name__)


def mobile_globals(request):
    """
    Inject notification_count and (for admins) team-overview stats into
    every mobile app template.  The processor is scoped to /app/ paths and
    authenticated users with a valid mobile role.

    View-level context always wins over processor-level context in Django,
    so any view that already injects these keys keeps its own values.
    """
    # ── Guard: only run for /app/ paths ─────────────────────────────────────
    if not request.path.startswith('/app/'):
        return {}

    user = request.user
    if not user.is_authenticated:
        return {}

    role = getattr(user, 'role', None)
    if role not in ('super_admin', 'admin_staff', 'client', 'client_staff'):
        return {}

    ctx = {}

    # ── Unread notification count (cached 30s per user) ──────────────────────
    try:
        notif_cache_key = f'mobile:notif_count:{user.pk}'
        notif_count = cache.get(notif_cache_key)
        if notif_count is None:
            from core.models import Notification
            from django.db.models import Q
            from django.utils import timezone

            now = timezone.now()
            visible_notifications = (
                Notification.objects
                .filter(
                    Q(target='all') | Q(target=role) | Q(target='selected', target_users=user),
                    is_active=True,
                )
                .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
                .distinct()
            )
            notif_count = min(
                visible_notifications.exclude(reads__user=user).count(),
                99,
            )
            cache.set(notif_cache_key, notif_count, 30)
        ctx['notification_count'] = notif_count
    except Exception:
        logger.exception(
            'mobile_globals: notification_count query failed for user %s', user.pk,
        )
        ctx['notification_count'] = 0

    # ── Admin overview stats (hamburger drawer Team Overview 2×2 grid) ──────
    if role in ('super_admin', 'admin_staff'):
        try:
            from client.models import Client
            from staff.models import Staff
            from idcards.models import IDCardTable, IDCard
            from core.services.permission_service import PermissionService
            from django.db.models import Q

            accessible_ids = None
            if PermissionService.is_admin_staff(user):
                accessible_ids = PermissionService.get_accessible_client_ids(user)

            scoped_clients = Client.objects.filter(status='active')
            scoped_tables = IDCardTable.objects.filter(is_active=True)
            scoped_cards = IDCard.objects.all()
            scoped_staff = Staff.objects.all()
            if accessible_ids is not None:
                scoped_clients = scoped_clients.filter(id__in=accessible_ids)
                scoped_tables = scoped_tables.filter(group__client_id__in=accessible_ids)
                scoped_cards = scoped_cards.filter(table__group__client_id__in=accessible_ids)
                scoped_staff = scoped_staff.filter(
                    Q(client_id__in=accessible_ids) |
                    Q(staff_type='admin_staff', assigned_clients__id__in=accessible_ids)
                ).distinct()

            ctx.update({
                'admin_client_count': scoped_clients.count(),
                'admin_staff_count': scoped_staff.count(),
                'admin_table_count': scoped_tables.count(),
                'admin_total_cards': scoped_cards.count(),
            })
        except Exception:
            logger.exception(
                'mobile_globals: admin stats query failed for user %s', user.pk,
            )
            ctx.setdefault('admin_client_count', 0)
            ctx.setdefault('admin_staff_count',  0)
            ctx.setdefault('admin_table_count',  0)
            ctx.setdefault('admin_total_cards',  0)

    return ctx
