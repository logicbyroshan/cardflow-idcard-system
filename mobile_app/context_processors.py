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

    from core.services.permission_service import PermissionService

    # Keep mobile role gating aligned with PermissionService so role aliases
    # like pro_user (treated as super-admin) are never excluded here.
    if not (
        PermissionService.is_any_admin(user)
        or PermissionService.is_client(user)
        or PermissionService.is_client_staff(user)
    ):
        return {}

    ctx = {}

    # ── Unread notification count (cached 30s per user) ──────────────────────
    try:
        from core.services.notification_service import NotificationService

        ctx['notification_count'] = min(NotificationService.get_unread_count(user), 99)
    except Exception:
        logger.exception(
            'mobile_globals: notification_count query failed for user %s', user.pk,
        )
        ctx['notification_count'] = 0

    # ── Admin overview stats (hamburger drawer Team Overview 2×2 grid) ──────
    if PermissionService.is_any_admin(user):
        try:
            from client.models import Client
            from staff.models import Staff
            from idcards.models import IDCardTable, IDCard
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
