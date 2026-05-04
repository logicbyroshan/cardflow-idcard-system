# Panel Frontend Audit

Date: 2026-05-03
Scope: frontend for the **Manage Panel** pages only (files included from `templates/manage-panel.html` and `templates/partials/panel/*`). Print-cards / `cardprint` frontend is intentionally excluded.

Summary
- I scanned the panel templates and included partials and components used directly by the panel pages (manage-panel + panel partials).
- Below is a component-level inventory: unique component types, canonical template file(s), how many instances/places they appear in the panel UI, and the CSS files that style the panel and these components.

Notes / assumptions
- "Usage count" means how many instances/places the component appears within the Manage Panel page and its included partials (templates/manage-panel.html and templates/partials/panel/* and the dashboard backup modal included by the panel).
- CSS mapping lists the stylesheet files loaded by `templates/manage-panel.html` and obvious per-tab CSS (e.g., `css/backup.css`) or inline styles inside tab partials.
- JS assets that operate these components are listed in the assets section below; the runtime behavior is implemented in `dist/js/core.min.js`, `js/manage-panel.js`, and `js/backup-panel.js`.

-- COMPONENTS INVENTORY (panel-only)

| Component | Type | Template file(s) (panel) | Panel usage count | CSS files (used by panel) | Notes |
|---|---:|---|---:|---|---|
| Sidebar | Navigation / site menu | [templates/partials/sidebar.html](templates/partials/sidebar.html#L1) | 1 (included in `manage-panel.html`) | `css/manage-panel.css`, `dist/css/core.min.css`, `css/tailwind.css` | Also includes `partials/components/user-avatar.html`.
| Topbar | Header / toolbar | [templates/partials/panel/topbar.html](templates/partials/panel/topbar.html#L1) | 1 | `css/manage-panel.css`, `dist/css/core.min.css`, `css/tailwind.css` | Contains the global search toggle (`#globalSearchBtn`) and sidebar toggle.
| Global Search Overlay | Full-page search overlay / modal | [templates/partials/panel/global-search-overlay.html](templates/partials/panel/global-search-overlay.html#L1) | 1 | `css/manage-panel.css`, `dist/css/core.min.css`, `css/tailwind.css` | Kept in DOM via include in `manage-panel.html`.
| Toast | Toast notifications (Alpine + DOM fallback) | [templates/components/toast.html](templates/components/toast.html#L1) (included via `partials/components/toast.html`) | 1 (included in `manage-panel.html`) | `dist/css/core.min.css`, `css/tailwind.css` | Preferred runtime via Alpine (`toastQueue`) or DOM `#toast` element.
| Pagination (component) | Pagination bar + rows-dropdown | [templates/components/pagination.html](templates/components/pagination.html#L1) | 2 (tab-backups, tab-download-templates) | `css/manage-panel.css`, `dist/css/core.min.css` | Uses `components/filter-dropdown` (rows dropdown) and JS contract (ids) expected by panel JS.
| User Avatar | Small role-based avatar placeholder | [templates/partials/components/user-avatar.html](templates/partials/components/user-avatar.html#L1) | 1 (in sidebar) | `dist/css/core.min.css`, `css/manage-panel.css` | Included from sidebar; used elsewhere across repo but only once in panel.
| Center Modal ("center-modal-overlay") | Reusable centered modal/card pattern used for forms, compose, confirm, create flows | Files: [templates/partials/panel/create-notification-modal.html](templates/partials/panel/create-notification-modal.html#L1), [templates/partials/panel/tab-email-logs.html](templates/partials/panel/tab-email-logs.html#L1) (emailComposeModal), [templates/partials/panel/tab-download-templates.html](templates/partials/panel/tab-download-templates.html#L1) (templateModal), [templates/partials/panel/tab-backups.html](templates/partials/panel/tab-backups.html#L1) (deleteNowModal), [templates/partials/panel/tab-notifications.html](templates/partials/panel/tab-notifications.html#L1) (domainNotFoundModal, maintenanceModeModal), [templates/manage-panel.html](templates/manage-panel.html#L1) (panelDeleteConfirmModal), [templates/partials/dashboard/backup-modal.html](templates/partials/dashboard/backup-modal.html#L1) (backupModal) | 8 instances total across panel templates | `css/manage-panel.css`, `dist/css/core.min.css`, `css/tailwind.css` (backup-specific styles in `css/backup.css` and inline styles in backup modal) | Modal stepper pattern (`modal-stepper`) appears in multiple modals.
| Modal Backdrop / Confirm ("modal-backdrop" / `modal-center`) | Confirm / warning dialog style | Inline in [templates/manage-panel.html](templates/manage-panel.html#L1), [templates/partials/panel/tab-backups.html](templates/partials/panel/tab-backups.html#L1) | 2 (confirm dialog, delete-now backup dialog) | `css/manage-panel.css`, `dist/css/core.min.css` | Used for destructive confirmations.
| Notification table / `notif-table` | Table + empty-state pattern used across panel tabs | [templates/partials/panel/tab-notifications.html](templates/partials/panel/tab-notifications.html#L1), [templates/partials/panel/tab-email-logs.html](templates/partials/panel/tab-email-logs.html#L1), [templates/partials/panel/tab-log-history.html](templates/partials/panel/tab-log-history.html#L1), [templates/partials/panel/tab-download-templates.html](templates/partials/panel/tab-download-templates.html#L1), [templates/partials/panel/tab-monitoring.html](templates/partials/panel/tab-monitoring.html#L1) | 5 occurrences (same table class reused across tabs) | `css/manage-panel.css`, `dist/css/core.min.css`, `css/tailwind.css` | Common layout & empty-state markup repeated for consistency.
| Batch Jobs / Stats cards (`system-card` / `system-grid`) | Stat cards / small dashboard widgets | [templates/partials/panel/tab-system.html](templates/partials/panel/tab-system.html#L1), [templates/partials/panel/tab-monitoring.html](templates/partials/panel/tab-monitoring.html#L1), [templates/partials/panel/tab-batch-jobs.html](templates/partials/panel/tab-batch-jobs.html#L1) | 3 places (system, monitoring, batch-jobs) | `css/manage-panel.css`, `dist/css/core.min.css` | Card grid shared UI pattern used in system/monitoring views.
| Backup-specific modal/patterns | Backup modal with stepper, confirm-code flow | [templates/partials/dashboard/backup-modal.html](templates/partials/dashboard/backup-modal.html#L1), [templates/partials/panel/tab-backups.html](templates/partials/panel/tab-backups.html#L1) | 2 (backup modal include + delete-confirm) | `css/backup.css`, `css/manage-panel.css`, `dist/css/core.min.css` | `backup-modal` has inline styles and custom JS (see same file) and relies on `backup.css`.
| Template editor / rich editor | Template compose / WYSIWYG-like editor inside template modal | [templates/partials/panel/tab-download-templates.html](templates/partials/panel/tab-download-templates.html#L1) | 1 | `css/manage-panel.css`, inline `@font-face` (tab) | Template modal uses `template-rich-editor` and file inputs; fonts are loaded inline in the tab partial.


-- STYLESHEETS (loaded by `manage-panel.html`)

Primary CSS assets loaded by the Manage Panel page:
- `css/tailwind.css` (project Tailwind utilities)  — [templates/manage-panel.html](templates/manage-panel.html#L1)
- `dist/css/core.min.css` (core shared UI styles)  — [templates/manage-panel.html](templates/manage-panel.html#L1)
- `css/dropdown-unified.css` (unified dropdown / filter styles)  — [templates/manage-panel.html](templates/manage-panel.html#L1)
- `css/manage-panel.css` (panel-specific overrides & layout)  — [templates/manage-panel.html](templates/manage-panel.html#L1)
- `css/backup.css` (backup tab specific styles)  — [templates/manage-panel.html](templates/manage-panel.html#L1)
- `css/vendor/fontawesome/all.min.css` (icons) — [templates/manage-panel.html](templates/manage-panel.html#L1)

Additionally:
- Some partials add inline styles (e.g., `tab-backups.html` skeleton CSS, `tab-download-templates.html` font-face declarations).
- Component templates may rely primarily on the core & manage-panel styles (`dist/css/core.min.css` + `css/manage-panel.css`) and on Tailwind utilities.

-- JAVASCRIPT (panel runtime files referenced)
- `dist/js/core.min.js` — global/core utilities and component foundations (included deferred in `manage-panel.html`).
- `js/core/unified-select-dropdown.js` — dropdown behaviors referenced by panel.
- `js/manage-panel.js` — panel-specific behaviors, event bindings (tab switching, loading API data, notification CRUD, search overlays, modal open/close helpers).
- `js/backup-panel.js` — backup tab behaviors and backup-modal interactions.

All above are included in: [templates/manage-panel.html](templates/manage-panel.html#L1).

-- QUICK FINDINGS / RECOMMENDATIONS
- The panel uses a consistent set of visual primitives: `center-modal-overlay` / `modal-*` classes, `notif-table` for tables, `system-card` for stat cards, and `pagination` component. Focus refactors on these primitives to affect broad parts of the panel UI.
- `components/drawer.html` exists but is not used inside the Manage Panel includes — if you plan to unify drawer behavior, confirm whether panel pages should adopt the shared drawer or keep sidebar static.
- CSS mapping is coarse: many components inherit from `dist/css/core.min.css` and `css/manage-panel.css`. If you need component-scoped styles, consider isolating or documenting which CSS variables/classes each primitive uses.

-- COMPONENTS & PARTIALS USED > 2 TIMES (PANEL-ONLY)

Below are the components, partials, and repeated markup patterns that appear more than twice across the Manage Panel page and its included panel partials. For each item I list the occurrence count (how many places within the panel templates it appears) and the exact template files where it appears.

| Component / Partial | Count | Templates / locations (panel scope) |
|---|---:|---|
| `notif-table` (table + empty-state pattern) | 5 | `templates/partials/panel/tab-notifications.html`, `templates/partials/panel/tab-email-logs.html`, `templates/partials/panel/tab-log-history.html`, `templates/partials/panel/tab-download-templates.html`, `templates/partials/panel/tab-monitoring.html` |
| `center-modal-overlay` (centered modal wrapper: `.center-modal-overlay`) | 5 | `templates/partials/panel/create-notification-modal.html`, `templates/partials/panel/tab-email-logs.html` (emailComposeModal), `templates/partials/panel/tab-download-templates.html` (templateModal), `templates/partials/panel/tab-notifications.html` (domainNotFoundModal, maintenanceModeModal) |
| `notif-actions-bar` (top action / filter bar used by tabs) | 9 | `templates/partials/panel/tab-notifications.html`, `templates/partials/panel/tab-email-logs.html`, `templates/partials/panel/tab-log-history.html`, `templates/partials/panel/tab-download-templates.html`, `templates/partials/panel/tab-monitoring.html`, `templates/partials/panel/tab-batch-jobs.html`, `templates/partials/panel/tab-backups.html`, `templates/partials/panel/tab-maintenance.html`, `templates/partials/panel/tab-server-info.html` |
| `pagination-bar` / pagination component (incl. `components/pagination.html` usage) | 6 | `templates/partials/panel/tab-notifications.html`, `templates/partials/panel/tab-email-logs.html`, `templates/partials/panel/tab-log-history.html`, `templates/partials/panel/tab-backups.html` (via include), `templates/partials/panel/tab-download-templates.html` (via include) |
| `system-card` / `system-grid` (stat cards & dashboard card pattern) | 10+ | `templates/partials/panel/tab-system.html` (multiple cards), `templates/partials/panel/tab-server-info.html` (multiple server cards), `templates/partials/panel/tab-monitoring.html` (monitoring stats & task card) and `templates/partials/panel/tab-maintenance.html` (maintenance cards) |
| `empty-state` (empty table/list placeholder) | 6 | `templates/partials/panel/tab-notifications.html`, `templates/partials/panel/tab-email-logs.html`, `templates/partials/panel/tab-log-history.html`, `templates/partials/panel/tab-download-templates.html`, `templates/partials/panel/tab-server-info.html` (two places) |

Notes:
- Counts are the number of distinct places the pattern or partial appears within files that make up the Manage Panel UI (the `manage-panel.html` page plus `templates/partials/panel/*` and the `dashboard/backup-modal` that is included by the panel).
- I focused on visible UI primitives (modals, tables, action bars, cards, pagination, empty-states) rather than every utility class (e.g., `panel-form-input`) because primitives are higher-value for refactors and documentation.
- If you prefer a broader search (e.g., include shared components from `templates/partials/*` used by panel pages or count class usages in CSS files), I can extend the scan and produce a CSV/JSON cross-reference.

-- WHAT I WROTE TO DISK
I saved this audit as: `panel-frontend-audit.md` at repository root.

If you want, next I can:
- produce a CSV/JSON export of the table for import into spreadsheets, or
- create a cross-reference that lists exact line numbers for each component occurrence, or
- run a deeper static analysis to list JS functions that open/close each modal and map them to DOM IDs.


