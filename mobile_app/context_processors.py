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

    # ── Unread notification count ────────────────────────────────────────────
    try:
        from core.models import Notification, NotificationRead
        from django.db.models import Q

        active_ids = list(
            Notification.objects
            .filter(
                Q(target='all') | Q(target=role) | Q(target='selected', target_users=user),
                is_active=True,
            )
            .values_list('id', flat=True)
        )
        if active_ids:
            read_ids = set(
                NotificationRead.objects
                .filter(user=user, notification_id__in=active_ids)
                .values_list('notification_id', flat=True)
            )
            ctx['notification_count'] = min(len(set(active_ids) - read_ids), 99)
        else:
            ctx['notification_count'] = 0
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

            cache_key = 'mobile:admin:overview:counts:v1'
            cached_counts = cache.get(cache_key)
            if cached_counts is None:
                cached_counts = {
                    'admin_client_count': Client.objects.filter(status='active').count(),
                    'admin_staff_count': Staff.objects.count(),
                    'admin_table_count': IDCardTable.objects.filter(is_active=True).count(),
                    'admin_total_cards': IDCard.objects.count(),
                }
                cache.set(cache_key, cached_counts, 60)
            ctx.update(cached_counts)
        except Exception:
            logger.exception(
                'mobile_globals: admin stats query failed for user %s', user.pk,
            )
            ctx.setdefault('admin_client_count', 0)
            ctx.setdefault('admin_staff_count',  0)
            ctx.setdefault('admin_table_count',  0)
            ctx.setdefault('admin_total_cards',  0)

    return ctx
