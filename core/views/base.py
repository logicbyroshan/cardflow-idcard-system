"""
base.py — Barrel re-export module.

All public symbols that were originally in this file are now split across:
  - base_helpers.py      (helpers, decorators, constants)
  - dashboard_views.py   (dashboard page + dashboard APIs)
  - admin_page_views.py  (admin page-rendering views)
  - export_settings_api.py (export settings/template APIs)
  - debug_api.py         (debug/health/activity APIs)

This barrel re-exports everything so that existing imports like
  ``from core.views.base import ...``
continue to work without changes.
"""

# ── Helpers, decorators, constants ──────────────────────────────────────
from .base_helpers import (                          # noqa: F401
    get_user_role,
    get_page_range,
    enrich_cards,
    super_admin_required,
    require_any_admin,
    _STATUS_LIST_PERM,
    _VALID_STATUSES,
    ACTIVITY_FEED_MAX,
    GLOBAL_SEARCH_DB_LIMIT,
    GLOBAL_SEARCH_RESULT_LIMIT,
    logger,
)

# ── Dashboard & cropper views ──────────────────────────────────────────
from .dashboard_views import (                       # noqa: F401
    adarsh_cropper,
    login_as_user_page,
    pro_user_activity_logs_page,
    pro_user_activity_logs_detail_page,
    dashboard,
    api_dashboard_card_stats,
    api_recent_client_updates,
    api_print_reprint_overview,
    api_recent_activity,
    api_global_search,
)

# ── Admin page views ──────────────────────────────────────────────────
from .admin_page_views import (                      # noqa: F401
    manage_staff,
    manage_clients,
    active_clients,
    api_client_login_history,
    idcard_group,
    build_idcard_actions_context,
    idcard_actions,
    group_settings,
    manage_website,
    notifications_page,
    manage_panel,
    api_email_logs,
    api_email_resend,
    api_email_send_new,
    api_email_compose_defaults,
    settings,
    tutorial,
)

# ── Export settings / template APIs ───────────────────────────────────
from .export_settings_api import (                   # noqa: F401
    api_export_settings_get,
    api_export_settings_update,
    api_export_templates_list,
    api_export_template_create,
    api_export_template_update,
    api_export_template_delete,
)

# ── Debug / health / activity APIs ───────────────────────────────────
from .debug_api import (                             # noqa: F401
    api_health,
    api_debug_permissions,
    api_debug_workflow,
    api_card_allowed_transitions,
    api_debug_image_integrity,
    api_activity_logs,
)
