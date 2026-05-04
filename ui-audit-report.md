# UI Componentization and Reuse Audit

## Scope and Exclusions

- Files scanned: 366
- File types: .html, .htm, .js, .jsx, .ts, .tsx, .css, .scss, .sass
- Excluded directories:
  - .git
  - .venv
  - __pycache__
  - adarsh_native_app
  - build
  - dist
  - logs
  - media
  - mediafiles
  - mobile_app
  - node_modules
  - officework
  - scratch
  - staticfiles
  - tmp
  - vendor
  - venv
- Excluded path substrings:
  - /website/
  - \website\
  - /cardprint/
  - \cardprint\
  - /reprintcard/
  - \reprintcard\
  - /printcards/
  - \printcards\
  - adarsh engin
  - adarsh_engine
  - adarsh-engine
  - adarsh corpor
  - adarsh_corpor
  - adarsh-corpor
  - /adarsh_native_app/
  - \adarsh_native_app\
  - /officework/
  - \officework\
  - /mobile_app/
  - \mobile_app\

## Methodology

- Component counts are based on literal tag and class tokens found in source files.
- Tag-based detection: form/table/nav/dialog/button/input/select/textarea/label/svg/i.
- Class token detection: modal/drawer/navbar/tabs/toolbar/card/breadcrumb/pagination/search/filter/dropdown/badge/toggle.
- ARIA detection: role=tablist, aria-label=breadcrumb, aria-label=pagination.
- Utility token extraction: h-/w-/p-/px-/py-/rounded-/text-/bg-/border- class tokens.

## Frontend Framework Signals

- HTMX attributes: 95 in 14 files
- Alpine attributes: 215 in 28 files

## Large Reusable Components

### SideDrawer

- Total occurrences: 15
- Files:
- [static/js/card-history-drawer.js](static/js/card-history-drawer.js) (x1)
- [static/js/manage-client-login-history.js](static/js/manage-client-login-history.js) (x1)
- [static/js/manage-client-staff-admin.js](static/js/manage-client-staff-admin.js) (x2)
- [static/js/manage-staff-login-history.js](static/js/manage-staff-login-history.js) (x2)
- [templates/index.html](templates/index.html) (x1)
- [templates/partials/client-message-drawer.html](templates/partials/client-message-drawer.html) (x1)
- [templates/partials/client-sidebar.html](templates/partials/client-sidebar.html) (x1)
- [templates/partials/client_staff/staff-drawer.html](templates/partials/client_staff/staff-drawer.html) (x1)
- [templates/partials/components/drawer.html](templates/partials/components/drawer.html) (x1)
- [templates/partials/sidebar.html](templates/partials/sidebar.html) (x1)
- [templates/partials/staff/client-staff-drawer.html](templates/partials/staff/client-staff-drawer.html) (x1)
- [templates/partials/staff/staff-drawer.html](templates/partials/staff/staff-drawer.html) (x1)
- [templates/partials/unified-sidebar.html](templates/partials/unified-sidebar.html) (x1)

- Recommendation: Create <SideDrawer /> with header/body/footer slots and optional overlay/backdrop.

### Modal

- Total occurrences: 13
- Files:
- [templates/components/delete-modal.html](templates/components/delete-modal.html) (x1)
- [templates/components/status-modal.html](templates/components/status-modal.html) (x1)
- [templates/components/workflow-modal.html](templates/components/workflow-modal.html) (x1)
- [templates/manage-panel.html](templates/manage-panel.html) (x1)
- [templates/partials/client/delete-modal.html](templates/partials/client/delete-modal.html) (x1)
- [templates/partials/client/status-modal.html](templates/partials/client/status-modal.html) (x1)
- [templates/partials/dashboard/delete-modal.html](templates/partials/dashboard/delete-modal.html) (x1)
- [templates/partials/dashboard/reupload-modal.html](templates/partials/dashboard/reupload-modal.html) (x1)
- [templates/partials/dashboard/upgrade-modal.html](templates/partials/dashboard/upgrade-modal.html) (x1)
- [templates/partials/panel/tab-backups.html](templates/partials/panel/tab-backups.html) (x1)
- [templates/partials/staff/staff-confirm-modal.html](templates/partials/staff/staff-confirm-modal.html) (x1)
- [templates/partials/staff/staff-form-modal.html](templates/partials/staff/staff-form-modal.html) (x1)
- [templates/partials/staff/temp-password-modal.html](templates/partials/staff/temp-password-modal.html) (x1)

- Recommendation: Create <Modal /> with size, title, body, and footer slots; support focus trap.

### DataTable

- Total occurrences: 41
- Files:
- [templates/client/cards.html](templates/client/cards.html) (x1)
- [templates/client/dashboard.html](templates/client/dashboard.html) (x1)
- [templates/components/table-wrapper.html](templates/components/table-wrapper.html) (x1)
- [templates/dashboard/client_admin.html](templates/dashboard/client_admin.html) (x1)
- [templates/dashboard/client_staff.html](templates/dashboard/client_staff.html) (x1)
- [templates/dashboard/owner.html](templates/dashboard/owner.html) (x1)
- [templates/dashboard/staff.html](templates/dashboard/staff.html) (x1)
- [templates/exports/pdf_report.html](templates/exports/pdf_report.html) (x1)
- [templates/impersonate/login-as-user.html](templates/impersonate/login-as-user.html) (x1)
- [templates/partials/client/table-container.html](templates/partials/client/table-container.html) (x1)
- [templates/partials/client_staff/table.html](templates/partials/client_staff/table.html) (x1)
- [templates/partials/components/create-xlsx-modal.html](templates/partials/components/create-xlsx-modal.html) (x1)
- [templates/partials/dashboard/print-overview-card.html](templates/partials/dashboard/print-overview-card.html) (x1)
- [templates/partials/dashboard/print-reprint-overview.html](templates/partials/dashboard/print-reprint-overview.html) (x2)
- [templates/partials/dashboard/recent-updates.html](templates/partials/dashboard/recent-updates.html) (x1)
- [templates/partials/dashboard/reprint-overview-card.html](templates/partials/dashboard/reprint-overview-card.html) (x1)
- [templates/partials/group-setting/table-container.html](templates/partials/group-setting/table-container.html) (x1)
- [templates/partials/idcard-group/table.html](templates/partials/idcard-group/table.html) (x1)
- [templates/partials/idcard/modal-downloads.html](templates/partials/idcard/modal-downloads.html) (x1)
- [templates/partials/idcard/table.html](templates/partials/idcard/table.html) (x1)
- [templates/partials/panel/tab-download-templates.html](templates/partials/panel/tab-download-templates.html) (x1)
- [templates/partials/panel/tab-email-logs.html](templates/partials/panel/tab-email-logs.html) (x1)
- [templates/partials/panel/tab-log-history.html](templates/partials/panel/tab-log-history.html) (x1)
- [templates/partials/panel/tab-monitoring.html](templates/partials/panel/tab-monitoring.html) (x1)
- [templates/partials/panel/tab-notifications.html](templates/partials/panel/tab-notifications.html) (x1)
- [templates/partials/staff/manage-staff-table.html](templates/partials/staff/manage-staff-table.html) (x1)
- [templates/partials/staff/table.html](templates/partials/staff/table.html) (x1)
- [templates/pro_user/super-mode-manager.html](templates/pro_user/super-mode-manager.html) (x1)
- [templates/tutorial.html](templates/tutorial.html) (x12)

- Recommendation: Create <DataTable /> with columns, empty state, and row actions slots.

### FormLayout

- Total occurrences: 13
- Files:
- [templates/auth/secure_credential_vault.html](templates/auth/secure_credential_vault.html) (x1)
- [templates/components/modal-side.html](templates/components/modal-side.html) (x2)
- [templates/partials/client/client-drawer.html](templates/partials/client/client-drawer.html) (x1)
- [templates/partials/client_staff/staff-drawer.html](templates/partials/client_staff/staff-drawer.html) (x1)
- [templates/partials/idcard/side-modal.html](templates/partials/idcard/side-modal.html) (x1)
- [templates/partials/panel/create-notification-modal.html](templates/partials/panel/create-notification-modal.html) (x1)
- [templates/partials/panel/tab-email-logs.html](templates/partials/panel/tab-email-logs.html) (x1)
- [templates/partials/staff/client-staff-drawer.html](templates/partials/staff/client-staff-drawer.html) (x1)
- [templates/partials/staff/staff-drawer.html](templates/partials/staff/staff-drawer.html) (x1)
- [templates/partials/staff/staff-form-modal.html](templates/partials/staff/staff-form-modal.html) (x1)
- [templates/settings.html](templates/settings.html) (x2)

- Recommendation: Create <FormLayout /> with Field, FieldRow, and FormActions subcomponents.

### NavbarTopbar

- Total occurrences: 14
- Files:
- [templates/base.html](templates/base.html) (x1)
- [templates/client/base.html](templates/client/base.html) (x1)
- [templates/dashboard/client_admin.html](templates/dashboard/client_admin.html) (x1)
- [templates/dashboard/client_staff.html](templates/dashboard/client_staff.html) (x1)
- [templates/dashboard/staff.html](templates/dashboard/staff.html) (x1)
- [templates/partials/client-sidebar.html](templates/partials/client-sidebar.html) (x1)
- [templates/partials/common/topbar.html](templates/partials/common/topbar.html) (x1)
- [templates/partials/dashboard/topbar.html](templates/partials/dashboard/topbar.html) (x1)
- [templates/partials/idcard-group/topbar.html](templates/partials/idcard-group/topbar.html) (x1)
- [templates/partials/idcard/topbar.html](templates/partials/idcard/topbar.html) (x1)
- [templates/partials/panel/topbar.html](templates/partials/panel/topbar.html) (x1)
- [templates/partials/sidebar.html](templates/partials/sidebar.html) (x1)
- [templates/partials/unified-sidebar.html](templates/partials/unified-sidebar.html) (x1)
- [templates/settings.html](templates/settings.html) (x1)

- Recommendation: Create <Topbar /> with brand, primary nav, and user/action slots.

### Tabs

- Total occurrences: 3
- Files:
- [templates/partials/pro-feature-tabs.html](templates/partials/pro-feature-tabs.html) (x1)
- [templates/tutorial.html](templates/tutorial.html) (x2)

- Recommendation: Create <Tabs /> with TabList and TabPanel, controlled and uncontrolled modes.

### ActionBarToolbar

- Total occurrences: 26
- Files:
- [templates/auth/inactive.html](templates/auth/inactive.html) (x1)
- [templates/auth/maintenance.html](templates/auth/maintenance.html) (x1)
- [templates/components/action-bar.html](templates/components/action-bar.html) (x1)
- [templates/errors/base_error_page.html](templates/errors/base_error_page.html) (x1)
- [templates/impersonate/login-as-user.html](templates/impersonate/login-as-user.html) (x1)
- [templates/partials/client/action-bar-right.html](templates/partials/client/action-bar-right.html) (x4)
- [templates/partials/group-setting/action-bar.html](templates/partials/group-setting/action-bar.html) (x5)
- [templates/partials/idcard-group/action-bar-right.html](templates/partials/idcard-group/action-bar-right.html) (x2)
- [templates/partials/idcard/action-bar.html](templates/partials/idcard/action-bar.html) (x1)
- [templates/partials/idcard/search-filter-bar.html](templates/partials/idcard/search-filter-bar.html) (x1)
- [templates/partials/staff/action-bar-right.html](templates/partials/staff/action-bar-right.html) (x4)
- [templates/pro_user/log-deletion-guard.html](templates/pro_user/log-deletion-guard.html) (x1)
- [templates/pro_user/user-deep-history-detail.html](templates/pro_user/user-deep-history-detail.html) (x1)
- [templates/product-gallery.html](templates/product-gallery.html) (x1)
- [templates/system-maintenance.html](templates/system-maintenance.html) (x1)

- Recommendation: Create <Toolbar /> with left/right slots and responsive overflow.

### LayoutWrappers

- Total occurrences: 103
- Files:
- [static/js/backup-panel.js](static/js/backup-panel.js) (x1)
- [static/js/group-setting-ui.js](static/js/group-setting-ui.js) (x1)
- [static/js/idcard-actions-edit-ui.js](static/js/idcard-actions-edit-ui.js) (x1)
- [static/js/idcard-actions-table-render-main.js](static/js/idcard-actions-table-render-main.js) (x4)
- [static/js/idcard/table-render.js](static/js/idcard/table-render.js) (x1)
- [static/js/manage-panel.js](static/js/manage-panel.js) (x5)
- [static/js/manage-staff-common-list.js](static/js/manage-staff-common-list.js) (x1)
- [static/js/manage-staff-search.js](static/js/manage-staff-search.js) (x1)
- [templates/base.html](templates/base.html) (x1)
- [templates/client/cards.html](templates/client/cards.html) (x3)
- [templates/client/groups.html](templates/client/groups.html) (x2)
- [templates/client/messages.html](templates/client/messages.html) (x1)
- [templates/components/pagination.html](templates/components/pagination.html) (x3)
- [templates/components/table-wrapper.html](templates/components/table-wrapper.html) (x1)
- [templates/components/toast.html](templates/components/toast.html) (x1)
- [templates/errors/base_error_page.html](templates/errors/base_error_page.html) (x1)
- [templates/group-setting.html](templates/group-setting.html) (x1)
- [templates/idcard-group.html](templates/idcard-group.html) (x1)
- [templates/impersonate/login-as-user.html](templates/impersonate/login-as-user.html) (x2)
- [templates/partials/client/group-message-drawer.html](templates/partials/client/group-message-drawer.html) (x1)
- [templates/partials/client/table-container.html](templates/partials/client/table-container.html) (x7)
- [templates/partials/client_staff/table-container.html](templates/partials/client_staff/table-container.html) (x6)
- [templates/partials/client_staff/table.html](templates/partials/client_staff/table.html) (x1)
- [templates/partials/dashboard/print-overview-card.html](templates/partials/dashboard/print-overview-card.html) (x2)
- [templates/partials/dashboard/print-reprint-overview.html](templates/partials/dashboard/print-reprint-overview.html) (x4)
- [templates/partials/dashboard/recent-updates.html](templates/partials/dashboard/recent-updates.html) (x2)
- [templates/partials/dashboard/reprint-overview-card.html](templates/partials/dashboard/reprint-overview-card.html) (x2)
- [templates/partials/group-setting/table-container.html](templates/partials/group-setting/table-container.html) (x7)
- [templates/partials/htmx-config.html](templates/partials/htmx-config.html) (x1)
- [templates/partials/idcard-group/topbar.html](templates/partials/idcard-group/topbar.html) (x1)
- [templates/partials/idcard/modal-delete-permanent.html](templates/partials/idcard/modal-delete-permanent.html) (x1)
- [templates/partials/idcard/modal-search-all.html](templates/partials/idcard/modal-search-all.html) (x1)
- [templates/partials/idcard/pagination.html](templates/partials/idcard/pagination.html) (x2)
- [templates/partials/idcard/side-modal.html](templates/partials/idcard/side-modal.html) (x1)
- [templates/partials/idcard/table-container.html](templates/partials/idcard/table-container.html) (x2)
- [templates/partials/idcard/table.html](templates/partials/idcard/table.html) (x2)
- [templates/partials/notification-bell.html](templates/partials/notification-bell.html) (x1)
- [templates/partials/panel/tab-email-logs.html](templates/partials/panel/tab-email-logs.html) (x3)
- [templates/partials/panel/tab-log-history.html](templates/partials/panel/tab-log-history.html) (x2)
- [templates/partials/panel/tab-notifications.html](templates/partials/panel/tab-notifications.html) (x2)
- [templates/partials/panel/tab-server-info.html](templates/partials/panel/tab-server-info.html) (x1)
- [templates/partials/staff/table-container.html](templates/partials/staff/table-container.html) (x6)
- [templates/partials/staff/table.html](templates/partials/staff/table.html) (x1)
- [templates/pro_user/super-mode-manager.html](templates/pro_user/super-mode-manager.html) (x1)
- [templates/services/adarsh-cropper.html](templates/services/adarsh-cropper.html) (x3)
- [templates/settings.html](templates/settings.html) (x4)
- [templates/staff/manage.html](templates/staff/manage.html) (x2)
- [templates/tutorial.html](templates/tutorial.html) (x2)

- Recommendation: Create <PageShell /> and <ContentLayout /> to standardize wrappers.

## Medium Reusable Components

### SearchBar

- Total occurrences: 1
- Files:
- [static/js/init.js](static/js/init.js) (x1)

- Recommendation: Create <SearchInput /> with optional icon, debounce, and clear action.

### Pagination

- Total occurrences: 1
- Files:
- [templates/client/cards.html](templates/client/cards.html) (x1)

- Recommendation: Create <Pagination /> with page size, total, and first/last controls.

### Breadcrumbs

- Total occurrences: 11
- Files:
- [templates/base.html](templates/base.html) (x1)
- [templates/client/base.html](templates/client/base.html) (x1)
- [templates/dashboard/client_admin.html](templates/dashboard/client_admin.html) (x1)
- [templates/dashboard/client_staff.html](templates/dashboard/client_staff.html) (x1)
- [templates/dashboard/staff.html](templates/dashboard/staff.html) (x1)
- [templates/partials/common/topbar.html](templates/partials/common/topbar.html) (x1)
- [templates/partials/dashboard/topbar.html](templates/partials/dashboard/topbar.html) (x1)
- [templates/partials/idcard-group/topbar.html](templates/partials/idcard-group/topbar.html) (x1)
- [templates/partials/idcard/topbar.html](templates/partials/idcard/topbar.html) (x1)
- [templates/partials/panel/topbar.html](templates/partials/panel/topbar.html) (x1)
- [templates/settings.html](templates/settings.html) (x1)

- Recommendation: Create <Breadcrumbs /> with overflow handling.

### FilterPanel

- Total occurrences: 0
- Files:
- None

- Recommendation: Create <FilterPanel /> with collapsible sections and apply/reset actions.

### CardLayout

- Total occurrences: 1
- Files:
- [templates/partials/staff/manage-staff-table.html](templates/partials/staff/manage-staff-table.html) (x1)

- Recommendation: Create <Card /> with header/body/footer and surface variants.

### DropdownMenu

- Total occurrences: 0
- Files:
- None

- Recommendation: Create <DropdownMenu /> with trigger and menu item slots.

## Small UI Elements

### Buttons

- Total occurrences: 713
- Files:
- [static/js/backup-panel.js](static/js/backup-panel.js) (x2)
- [static/js/card-history-drawer.js](static/js/card-history-drawer.js) (x2)
- [static/js/client-message-drawer.js](static/js/client-message-drawer.js) (x1)
- [static/js/core/confirm.js](static/js/core/confirm.js) (x2)
- [static/js/core/toast.js](static/js/core/toast.js) (x1)
- [static/js/create-xlsx.js](static/js/create-xlsx.js) (x1)
- [static/js/dashboard-client-message-drawer.js](static/js/dashboard-client-message-drawer.js) (x1)
- [static/js/global-search.js](static/js/global-search.js) (x2)
- [static/js/group-setting-ui.js](static/js/group-setting-ui.js) (x1)
- [static/js/idcard-actions-api-bulk.js](static/js/idcard-actions-api-bulk.js) (x3)
- [static/js/idcard-actions-api-status.js](static/js/idcard-actions-api-status.js) (x3)
- [static/js/idcard-actions-download-modals.js](static/js/idcard-actions-download-modals.js) (x2)
- [static/js/idcard-actions-table-render-row.js](static/js/idcard-actions-table-render-row.js) (x7)
- [static/js/idcard-actions-upload-logic.js](static/js/idcard-actions-upload-logic.js) (x1)
- [static/js/manage-client-handlers.js](static/js/manage-client-handlers.js) (x2)
- [static/js/manage-client-login-history.js](static/js/manage-client-login-history.js) (x1)
- [static/js/manage-client-staff-admin.js](static/js/manage-client-staff-admin.js) (x3)
- [static/js/manage-client-staff.js](static/js/manage-client-staff.js) (x3)
- [static/js/manage-panel.js](static/js/manage-panel.js) (x14)
- [static/js/manage-staff-login-history.js](static/js/manage-staff-login-history.js) (x2)
- [static/js/mobile/list-app.js](static/js/mobile/list-app.js) (x1)
- [static/js/reprint-cards-confirm.js](static/js/reprint-cards-confirm.js) (x2)
- [static/js/reprint-cards-download.js](static/js/reprint-cards-download.js) (x1)
- [static/js/staff-manage.js](static/js/staff-manage.js) (x4)
- [templates/auth/maintenance.html](templates/auth/maintenance.html) (x1)
- [templates/auth/secure_credential_vault.html](templates/auth/secure_credential_vault.html) (x2)
- [templates/backup-select-clients.html](templates/backup-select-clients.html) (x5)
- [templates/base.html](templates/base.html) (x4)
- [templates/client/base.html](templates/client/base.html) (x1)
- [templates/client/cards.html](templates/client/cards.html) (x4)
- [templates/client/dashboard.html](templates/client/dashboard.html) (x5)
- [templates/client/groups.html](templates/client/groups.html) (x1)
- [templates/client/messages.html](templates/client/messages.html) (x1)
- [templates/components/center-modal.html](templates/components/center-modal.html) (x1)
- [templates/components/delete-modal.html](templates/components/delete-modal.html) (x3)
- [templates/components/empty-state.html](templates/components/empty-state.html) (x1)
- [templates/components/filter-dropdown.html](templates/components/filter-dropdown.html) (x1)
- [templates/components/modal-side.html](templates/components/modal-side.html) (x1)
- [templates/components/pagination.html](templates/components/pagination.html) (x6)
- [templates/components/search-box.html](templates/components/search-box.html) (x1)
- [templates/components/status-modal.html](templates/components/status-modal.html) (x3)
- [templates/components/status-tabs.html](templates/components/status-tabs.html) (x4)
- [templates/components/workflow-modal.html](templates/components/workflow-modal.html) (x3)
- [templates/dashboard/client_admin.html](templates/dashboard/client_admin.html) (x4)
- [templates/dashboard/client_staff.html](templates/dashboard/client_staff.html) (x4)
- [templates/dashboard/owner.html](templates/dashboard/owner.html) (x3)
- [templates/dashboard/staff.html](templates/dashboard/staff.html) (x4)
- [templates/engine_modal.html](templates/engine_modal.html) (x14)
- [templates/impersonate/login-as-user.html](templates/impersonate/login-as-user.html) (x10)
- [templates/index.html](templates/index.html) (x1)
- [templates/manage-panel.html](templates/manage-panel.html) (x10)
- [templates/notifications.html](templates/notifications.html) (x2)
- [templates/partials/auth/login-step1-role.html](templates/partials/auth/login-step1-role.html) (x1)
- [templates/partials/auth/login-step2-email.html](templates/partials/auth/login-step2-email.html) (x1)
- [templates/partials/auth/login-step3-password.html](templates/partials/auth/login-step3-password.html) (x4)
- [templates/partials/auth/login-step4-otp.html](templates/partials/auth/login-step4-otp.html) (x3)
- [templates/partials/auth/login-step5-reset.html](templates/partials/auth/login-step5-reset.html) (x2)
- [templates/partials/client-message-drawer.html](templates/partials/client-message-drawer.html) (x2)
- [templates/partials/client-message-strip.html](templates/partials/client-message-strip.html) (x2)
- [templates/partials/client/action-bar-right.html](templates/partials/client/action-bar-right.html) (x9)
- [templates/partials/client/client-drawer.html](templates/partials/client/client-drawer.html) (x7)
- [templates/partials/client/delete-modal.html](templates/partials/client/delete-modal.html) (x3)
- [templates/partials/client/group-message-drawer.html](templates/partials/client/group-message-drawer.html) (x5)
- [templates/partials/client/staff-drawer.html](templates/partials/client/staff-drawer.html) (x2)
- [templates/partials/client/status-modal.html](templates/partials/client/status-modal.html) (x3)
- [templates/partials/client/table-container.html](templates/partials/client/table-container.html) (x12)
- [templates/partials/client/view-modal.html](templates/partials/client/view-modal.html) (x3)
- [templates/partials/client_staff/staff-drawer.html](templates/partials/client_staff/staff-drawer.html) (x1)
- [templates/partials/client_staff/table-container.html](templates/partials/client_staff/table-container.html) (x11)
- [templates/partials/client_staff/table.html](templates/partials/client_staff/table.html) (x5)
- [templates/partials/common/topbar.html](templates/partials/common/topbar.html) (x1)
- [templates/partials/components/create-xlsx-modal.html](templates/partials/components/create-xlsx-modal.html) (x11)
- [templates/partials/components/drawer.html](templates/partials/components/drawer.html) (x1)
- [templates/partials/dashboard/backup-modal.html](templates/partials/dashboard/backup-modal.html) (x5)
- [templates/partials/dashboard/bulk-actions.html](templates/partials/dashboard/bulk-actions.html) (x4)
- [templates/partials/dashboard/delete-modal.html](templates/partials/dashboard/delete-modal.html) (x3)
- [templates/partials/dashboard/notification-bar.html](templates/partials/dashboard/notification-bar.html) (x2)
- [templates/partials/dashboard/quick-actions.html](templates/partials/dashboard/quick-actions.html) (x1)
- [templates/partials/dashboard/reupload-modal.html](templates/partials/dashboard/reupload-modal.html) (x4)
- [templates/partials/dashboard/search-modal.html](templates/partials/dashboard/search-modal.html) (x2)
- [templates/partials/dashboard/section-tabs.html](templates/partials/dashboard/section-tabs.html) (x4)
- [templates/partials/dashboard/topbar.html](templates/partials/dashboard/topbar.html) (x2)
- [templates/partials/dashboard/upgrade-modal.html](templates/partials/dashboard/upgrade-modal.html) (x3)
- [templates/partials/dashboard/welcome-notification-banner.html](templates/partials/dashboard/welcome-notification-banner.html) (x2)
- [templates/partials/group-setting/action-bar.html](templates/partials/group-setting/action-bar.html) (x8)
- [templates/partials/group-setting/drawer.html](templates/partials/group-setting/drawer.html) (x5)
- [templates/partials/group-setting/table-container.html](templates/partials/group-setting/table-container.html) (x12)
- [templates/partials/idcard-group/action-bar-right.html](templates/partials/idcard-group/action-bar-right.html) (x1)
- [templates/partials/idcard-group/modal-delete-all.html](templates/partials/idcard-group/modal-delete-all.html) (x3)
- [templates/partials/idcard-group/modal-download-all.html](templates/partials/idcard-group/modal-download-all.html) (x4)
- [templates/partials/idcard-group/modal-reupload.html](templates/partials/idcard-group/modal-reupload.html) (x4)
- [templates/partials/idcard-group/modal-upgrade-all.html](templates/partials/idcard-group/modal-upgrade-all.html) (x3)
- [templates/partials/idcard-group/table.html](templates/partials/idcard-group/table.html) (x4)
- [templates/partials/idcard-group/topbar.html](templates/partials/idcard-group/topbar.html) (x1)
- [templates/partials/idcard/action-bar-left.html](templates/partials/idcard/action-bar-left.html) (x47)
- [templates/partials/idcard/action-bar-right.html](templates/partials/idcard/action-bar-right.html) (x3)
- [templates/partials/idcard/action-bar.html](templates/partials/idcard/action-bar.html) (x50)
- [templates/partials/idcard/modal-delete-permanent.html](templates/partials/idcard/modal-delete-permanent.html) (x3)
- [templates/partials/idcard/modal-delete-simple.html](templates/partials/idcard/modal-delete-simple.html) (x3)
- [templates/partials/idcard/modal-doc-format.html](templates/partials/idcard/modal-doc-format.html) (x2)
- [templates/partials/idcard/modal-downloads.html](templates/partials/idcard/modal-downloads.html) (x22)
- [templates/partials/idcard/modal-image-sort.html](templates/partials/idcard/modal-image-sort.html) (x3)
- [templates/partials/idcard/modal-reupload-images.html](templates/partials/idcard/modal-reupload-images.html) (x4)
- [templates/partials/idcard/modal-search-all.html](templates/partials/idcard/modal-search-all.html) (x2)
- [templates/partials/idcard/modal-upload-wizard.html](templates/partials/idcard/modal-upload-wizard.html) (x9)
- [templates/partials/idcard/pagination.html](templates/partials/idcard/pagination.html) (x5)
- [templates/partials/idcard/search-filter-bar.html](templates/partials/idcard/search-filter-bar.html) (x9)
- [templates/partials/idcard/search-filter-left.html](templates/partials/idcard/search-filter-left.html) (x2)
- [templates/partials/idcard/search-filter-right.html](templates/partials/idcard/search-filter-right.html) (x1)
- [templates/partials/idcard/side-modal.html](templates/partials/idcard/side-modal.html) (x9)
- [templates/partials/idcard/table-container.html](templates/partials/idcard/table-container.html) (x5)
- [templates/partials/idcard/topbar.html](templates/partials/idcard/topbar.html) (x1)
- [templates/partials/impersonate-bar.html](templates/partials/impersonate-bar.html) (x1)
- [templates/partials/impersonate-modal.html](templates/partials/impersonate-modal.html) (x6)
- [templates/partials/notification-bell.html](templates/partials/notification-bell.html) (x2)
- [templates/partials/panel/create-notification-modal.html](templates/partials/panel/create-notification-modal.html) (x4)
- [templates/partials/panel/global-search-overlay.html](templates/partials/panel/global-search-overlay.html) (x2)
- [templates/partials/panel/tab-backups.html](templates/partials/panel/tab-backups.html) (x6)
- [templates/partials/panel/tab-batch-jobs.html](templates/partials/panel/tab-batch-jobs.html) (x1)
- [templates/partials/panel/tab-download-templates.html](templates/partials/panel/tab-download-templates.html) (x17)
- [templates/partials/panel/tab-email-logs.html](templates/partials/panel/tab-email-logs.html) (x10)
- [templates/partials/panel/tab-log-history.html](templates/partials/panel/tab-log-history.html) (x7)
- [templates/partials/panel/tab-maintenance.html](templates/partials/panel/tab-maintenance.html) (x6)
- [templates/partials/panel/tab-monitoring.html](templates/partials/panel/tab-monitoring.html) (x1)
- [templates/partials/panel/tab-notifications.html](templates/partials/panel/tab-notifications.html) (x20)
- [templates/partials/panel/tab-server-info.html](templates/partials/panel/tab-server-info.html) (x2)
- [templates/partials/panel/topbar.html](templates/partials/panel/topbar.html) (x2)
- [templates/partials/staff/action-bar-right.html](templates/partials/staff/action-bar-right.html) (x6)
- [templates/partials/staff/client-staff-drawer.html](templates/partials/staff/client-staff-drawer.html) (x5)
- [templates/partials/staff/staff-confirm-modal.html](templates/partials/staff/staff-confirm-modal.html) (x3)
- [templates/partials/staff/staff-drawer-footer.html](templates/partials/staff/staff-drawer-footer.html) (x3)
- [templates/partials/staff/staff-drawer-info.html](templates/partials/staff/staff-drawer-info.html) (x3)
- [templates/partials/staff/staff-drawer.html](templates/partials/staff/staff-drawer.html) (x1)
- [templates/partials/staff/staff-form-modal.html](templates/partials/staff/staff-form-modal.html) (x5)
- [templates/partials/staff/table-container.html](templates/partials/staff/table-container.html) (x11)
- [templates/partials/staff/table.html](templates/partials/staff/table.html) (x5)
- [templates/partials/staff/temp-password-modal.html](templates/partials/staff/temp-password-modal.html) (x7)
- [templates/partials/unified-sidebar.html](templates/partials/unified-sidebar.html) (x1)
- [templates/pro_user/data-deletion-guard.html](templates/pro_user/data-deletion-guard.html) (x8)
- [templates/pro_user/log-deletion-guard.html](templates/pro_user/log-deletion-guard.html) (x3)
- [templates/pro_user/user-deep-history-detail.html](templates/pro_user/user-deep-history-detail.html) (x2)
- [templates/services/adarsh-cropper.html](templates/services/adarsh-cropper.html) (x31)
- [templates/settings.html](templates/settings.html) (x8)
- [templates/staff/manage.html](templates/staff/manage.html) (x1)
- [templates/system-maintenance.html](templates/system-maintenance.html) (x1)
- [templates/tutorial-personal-guide.html](templates/tutorial-personal-guide.html) (x1)
- [templates/tutorial.html](templates/tutorial.html) (x13)

### Inputs

- Total occurrences: 366
- Files:
- [static/js/core/htmx-filters.js](static/js/core/htmx-filters.js) (x1)
- [static/js/core/sanitizer.js](static/js/core/sanitizer.js) (x1)
- [static/js/global-search.js](static/js/global-search.js) (x1)
- [static/js/group-setting-ui.js](static/js/group-setting-ui.js) (x2)
- [static/js/idcard-actions-api-bulk.js](static/js/idcard-actions-api-bulk.js) (x1)
- [static/js/idcard-actions-download-modals.js](static/js/idcard-actions-download-modals.js) (x2)
- [static/js/idcard-actions-table-render-row.js](static/js/idcard-actions-table-render-row.js) (x1)
- [static/js/manage-client-staff-admin.js](static/js/manage-client-staff-admin.js) (x1)
- [static/js/manage-panel.js](static/js/manage-panel.js) (x1)
- [static/js/manage-staff-common-drawer.js](static/js/manage-staff-common-drawer.js) (x1)
- [static/js/manage-staff-drawer.js](static/js/manage-staff-drawer.js) (x1)
- [static/js/mobile/list-app.js](static/js/mobile/list-app.js) (x1)
- [static/js/pro-user-super-mode.js](static/js/pro-user-super-mode.js) (x2)
- [static/js/reprint-cards-confirm.js](static/js/reprint-cards-confirm.js) (x1)
- [static/js/reprint-cards-download.js](static/js/reprint-cards-download.js) (x1)
- [static/js/staff-manage.js](static/js/staff-manage.js) (x2)
- [templates/auth/secure_credential_vault.html](templates/auth/secure_credential_vault.html) (x1)
- [templates/backup-select-clients.html](templates/backup-select-clients.html) (x1)
- [templates/client/cards.html](templates/client/cards.html) (x1)
- [templates/components/delete-modal.html](templates/components/delete-modal.html) (x1)
- [templates/components/search-box.html](templates/components/search-box.html) (x2)
- [templates/components/workflow-modal.html](templates/components/workflow-modal.html) (x1)
- [templates/dashboard/client_admin.html](templates/dashboard/client_admin.html) (x2)
- [templates/dashboard/client_staff.html](templates/dashboard/client_staff.html) (x2)
- [templates/dashboard/owner.html](templates/dashboard/owner.html) (x2)
- [templates/dashboard/staff.html](templates/dashboard/staff.html) (x2)
- [templates/engine_modal.html](templates/engine_modal.html) (x6)
- [templates/impersonate/login-as-user.html](templates/impersonate/login-as-user.html) (x1)
- [templates/partials/auth/login-step1-role.html](templates/partials/auth/login-step1-role.html) (x4)
- [templates/partials/auth/login-step2-email.html](templates/partials/auth/login-step2-email.html) (x1)
- [templates/partials/auth/login-step3-password.html](templates/partials/auth/login-step3-password.html) (x1)
- [templates/partials/auth/login-step4-otp.html](templates/partials/auth/login-step4-otp.html) (x6)
- [templates/partials/auth/login-step5-reset.html](templates/partials/auth/login-step5-reset.html) (x2)
- [templates/partials/client/client-drawer.html](templates/partials/client/client-drawer.html) (x35)
- [templates/partials/client/delete-modal.html](templates/partials/client/delete-modal.html) (x1)
- [templates/partials/client/group-message-drawer.html](templates/partials/client/group-message-drawer.html) (x5)
- [templates/partials/client/view-modal.html](templates/partials/client/view-modal.html) (x6)
- [templates/partials/client_staff/staff-drawer-client-assignment.html](templates/partials/client_staff/staff-drawer-client-assignment.html) (x1)
- [templates/partials/client_staff/staff-drawer-permissions.html](templates/partials/client_staff/staff-drawer-permissions.html) (x14)
- [templates/partials/client_staff/staff-drawer.html](templates/partials/client_staff/staff-drawer.html) (x1)
- [templates/partials/components/create-xlsx-modal.html](templates/partials/components/create-xlsx-modal.html) (x5)
- [templates/partials/components/image-upload.html](templates/partials/components/image-upload.html) (x1)
- [templates/partials/dashboard/backup-modal.html](templates/partials/dashboard/backup-modal.html) (x1)
- [templates/partials/dashboard/delete-modal.html](templates/partials/dashboard/delete-modal.html) (x1)
- [templates/partials/dashboard/print-overview-card.html](templates/partials/dashboard/print-overview-card.html) (x1)
- [templates/partials/dashboard/recent-updates.html](templates/partials/dashboard/recent-updates.html) (x1)
- [templates/partials/dashboard/reprint-overview-card.html](templates/partials/dashboard/reprint-overview-card.html) (x1)
- [templates/partials/dashboard/reupload-modal.html](templates/partials/dashboard/reupload-modal.html) (x3)
- [templates/partials/dashboard/search-modal.html](templates/partials/dashboard/search-modal.html) (x1)
- [templates/partials/dashboard/upgrade-modal.html](templates/partials/dashboard/upgrade-modal.html) (x1)
- [templates/partials/group-setting/drawer.html](templates/partials/group-setting/drawer.html) (x4)
- [templates/partials/idcard-group/modal-delete-all.html](templates/partials/idcard-group/modal-delete-all.html) (x1)
- [templates/partials/idcard-group/modal-reupload.html](templates/partials/idcard-group/modal-reupload.html) (x3)
- [templates/partials/idcard-group/modal-upgrade-all.html](templates/partials/idcard-group/modal-upgrade-all.html) (x1)
- [templates/partials/idcard/modal-delete-permanent.html](templates/partials/idcard/modal-delete-permanent.html) (x1)
- [templates/partials/idcard/modal-downloads.html](templates/partials/idcard/modal-downloads.html) (x16)
- [templates/partials/idcard/modal-reupload-images.html](templates/partials/idcard/modal-reupload-images.html) (x3)
- [templates/partials/idcard/modal-search-all.html](templates/partials/idcard/modal-search-all.html) (x1)
- [templates/partials/idcard/modal-upload-wizard.html](templates/partials/idcard/modal-upload-wizard.html) (x4)
- [templates/partials/idcard/search-filter-bar.html](templates/partials/idcard/search-filter-bar.html) (x3)
- [templates/partials/idcard/search-filter-right.html](templates/partials/idcard/search-filter-right.html) (x2)
- [templates/partials/idcard/side-modal.html](templates/partials/idcard/side-modal.html) (x6)
- [templates/partials/idcard/table.html](templates/partials/idcard/table.html) (x1)
- [templates/partials/impersonate-modal.html](templates/partials/impersonate-modal.html) (x1)
- [templates/partials/panel/create-notification-modal.html](templates/partials/panel/create-notification-modal.html) (x4)
- [templates/partials/panel/global-search-overlay.html](templates/partials/panel/global-search-overlay.html) (x1)
- [templates/partials/panel/tab-backups.html](templates/partials/panel/tab-backups.html) (x4)
- [templates/partials/panel/tab-download-templates.html](templates/partials/panel/tab-download-templates.html) (x6)
- [templates/partials/panel/tab-email-logs.html](templates/partials/panel/tab-email-logs.html) (x6)
- [templates/partials/panel/tab-log-history.html](templates/partials/panel/tab-log-history.html) (x1)
- [templates/partials/panel/tab-maintenance.html](templates/partials/panel/tab-maintenance.html) (x1)
- [templates/partials/panel/tab-notifications.html](templates/partials/panel/tab-notifications.html) (x3)
- [templates/partials/staff/client-staff-drawer.html](templates/partials/staff/client-staff-drawer.html) (x20)
- [templates/partials/staff/staff-drawer-client-assignment.html](templates/partials/staff/staff-drawer-client-assignment.html) (x1)
- [templates/partials/staff/staff-drawer-info.html](templates/partials/staff/staff-drawer-info.html) (x6)
- [templates/partials/staff/staff-drawer-permissions.html](templates/partials/staff/staff-drawer-permissions.html) (x37)
- [templates/partials/staff/staff-drawer.html](templates/partials/staff/staff-drawer.html) (x1)
- [templates/partials/staff/staff-form-modal.html](templates/partials/staff/staff-form-modal.html) (x7)
- [templates/partials/staff/temp-password-modal.html](templates/partials/staff/temp-password-modal.html) (x2)
- [templates/pro_user/data-deletion-guard.html](templates/pro_user/data-deletion-guard.html) (x10)
- [templates/pro_user/log-deletion-guard.html](templates/pro_user/log-deletion-guard.html) (x1)
- [templates/pro_user/super-mode-manager.html](templates/pro_user/super-mode-manager.html) (x3)
- [templates/services/adarsh-cropper.html](templates/services/adarsh-cropper.html) (x20)
- [templates/settings.html](templates/settings.html) (x11)
- [templates/tutorial-personal-guide.html](templates/tutorial-personal-guide.html) (x1)
- [templates/tutorial.html](templates/tutorial.html) (x38)

### Selects

- Total occurrences: 60
- Files:
- [static/js/global-search.js](static/js/global-search.js) (x1)
- [static/js/group-setting-ui.js](static/js/group-setting-ui.js) (x1)
- [static/js/idcard-actions-upload-ui.js](static/js/idcard-actions-upload-ui.js) (x1)
- [static/js/manage-staff-common-drawer.js](static/js/manage-staff-common-drawer.js) (x1)
- [static/js/pro-user-super-mode.js](static/js/pro-user-super-mode.js) (x1)
- [templates/client/cards.html](templates/client/cards.html) (x1)
- [templates/dashboard/client_admin.html](templates/dashboard/client_admin.html) (x1)
- [templates/dashboard/client_staff.html](templates/dashboard/client_staff.html) (x1)
- [templates/dashboard/owner.html](templates/dashboard/owner.html) (x1)
- [templates/dashboard/staff.html](templates/dashboard/staff.html) (x1)
- [templates/engine_modal.html](templates/engine_modal.html) (x1)
- [templates/partials/client/group-message-drawer.html](templates/partials/client/group-message-drawer.html) (x1)
- [templates/partials/dashboard/bulk-actions.html](templates/partials/dashboard/bulk-actions.html) (x2)
- [templates/partials/dashboard/search-modal.html](templates/partials/dashboard/search-modal.html) (x1)
- [templates/partials/idcard-group/modal-download-all.html](templates/partials/idcard-group/modal-download-all.html) (x1)
- [templates/partials/idcard/modal-downloads.html](templates/partials/idcard/modal-downloads.html) (x7)
- [templates/partials/idcard/modal-image-sort.html](templates/partials/idcard/modal-image-sort.html) (x2)
- [templates/partials/panel/create-notification-modal.html](templates/partials/panel/create-notification-modal.html) (x3)
- [templates/partials/panel/global-search-overlay.html](templates/partials/panel/global-search-overlay.html) (x1)
- [templates/partials/panel/tab-backups.html](templates/partials/panel/tab-backups.html) (x1)
- [templates/partials/panel/tab-download-templates.html](templates/partials/panel/tab-download-templates.html) (x2)
- [templates/partials/panel/tab-email-logs.html](templates/partials/panel/tab-email-logs.html) (x5)
- [templates/partials/panel/tab-log-history.html](templates/partials/panel/tab-log-history.html) (x5)
- [templates/partials/panel/tab-notifications.html](templates/partials/panel/tab-notifications.html) (x1)
- [templates/partials/staff/client-staff-drawer.html](templates/partials/staff/client-staff-drawer.html) (x2)
- [templates/pro_user/data-deletion-guard.html](templates/pro_user/data-deletion-guard.html) (x7)
- [templates/pro_user/super-mode-manager.html](templates/pro_user/super-mode-manager.html) (x1)
- [templates/pro_user/user-deep-history-detail.html](templates/pro_user/user-deep-history-detail.html) (x1)
- [templates/product-gallery.html](templates/product-gallery.html) (x1)
- [templates/services/adarsh-cropper.html](templates/services/adarsh-cropper.html) (x4)
- [templates/settings.html](templates/settings.html) (x1)

### Textareas

- Total occurrences: 11
- Files:
- [static/js/core/sanitizer.js](static/js/core/sanitizer.js) (x1)
- [templates/partials/client/client-drawer.html](templates/partials/client/client-drawer.html) (x1)
- [templates/partials/client/group-message-drawer.html](templates/partials/client/group-message-drawer.html) (x1)
- [templates/partials/idcard/side-modal.html](templates/partials/idcard/side-modal.html) (x1)
- [templates/partials/panel/create-notification-modal.html](templates/partials/panel/create-notification-modal.html) (x1)
- [templates/partials/panel/tab-download-templates.html](templates/partials/panel/tab-download-templates.html) (x1)
- [templates/partials/panel/tab-email-logs.html](templates/partials/panel/tab-email-logs.html) (x1)
- [templates/partials/panel/tab-maintenance.html](templates/partials/panel/tab-maintenance.html) (x1)
- [templates/partials/panel/tab-notifications.html](templates/partials/panel/tab-notifications.html) (x1)
- [templates/partials/staff/client-staff-drawer.html](templates/partials/staff/client-staff-drawer.html) (x1)
- [templates/partials/staff/staff-drawer-info.html](templates/partials/staff/staff-drawer-info.html) (x1)

### Checkboxes

- Total occurrences: 173
- Files:
- [static/js/group-setting-ui.js](static/js/group-setting-ui.js) (x1)
- [static/js/idcard-actions-download-modals.js](static/js/idcard-actions-download-modals.js) (x1)
- [static/js/idcard-actions-table-render-row.js](static/js/idcard-actions-table-render-row.js) (x1)
- [static/js/manage-client-staff-admin.js](static/js/manage-client-staff-admin.js) (x1)
- [static/js/manage-panel.js](static/js/manage-panel.js) (x1)
- [static/js/manage-staff-common-drawer.js](static/js/manage-staff-common-drawer.js) (x1)
- [static/js/manage-staff-drawer.js](static/js/manage-staff-drawer.js) (x1)
- [static/js/mobile/list-app.js](static/js/mobile/list-app.js) (x1)
- [static/js/pro-user-super-mode.js](static/js/pro-user-super-mode.js) (x2)
- [static/js/reprint-cards-confirm.js](static/js/reprint-cards-confirm.js) (x1)
- [static/js/reprint-cards-download.js](static/js/reprint-cards-download.js) (x1)
- [static/js/staff-manage.js](static/js/staff-manage.js) (x2)
- [templates/backup-select-clients.html](templates/backup-select-clients.html) (x1)
- [templates/partials/client/client-drawer.html](templates/partials/client/client-drawer.html) (x28)
- [templates/partials/client_staff/staff-drawer-permissions.html](templates/partials/client_staff/staff-drawer-permissions.html) (x14)
- [templates/partials/group-setting/drawer.html](templates/partials/group-setting/drawer.html) (x1)
- [templates/partials/idcard/modal-downloads.html](templates/partials/idcard/modal-downloads.html) (x12)
- [templates/partials/idcard/table.html](templates/partials/idcard/table.html) (x1)
- [templates/partials/panel/create-notification-modal.html](templates/partials/panel/create-notification-modal.html) (x1)
- [templates/partials/panel/tab-download-templates.html](templates/partials/panel/tab-download-templates.html) (x1)
- [templates/partials/staff/client-staff-drawer.html](templates/partials/staff/client-staff-drawer.html) (x14)
- [templates/partials/staff/staff-drawer-permissions.html](templates/partials/staff/staff-drawer-permissions.html) (x37)
- [templates/pro_user/super-mode-manager.html](templates/pro_user/super-mode-manager.html) (x1)
- [templates/services/adarsh-cropper.html](templates/services/adarsh-cropper.html) (x7)
- [templates/settings.html](templates/settings.html) (x3)
- [templates/tutorial.html](templates/tutorial.html) (x38)

### Toggles

- Total occurrences: 0
- Files:
- None

### Badges

- Total occurrences: 0
- Files:
- None

### Labels

- Total occurrences: 341
- Files:
- [static/js/global-search.js](static/js/global-search.js) (x1)
- [static/js/group-setting-ui.js](static/js/group-setting-ui.js) (x1)
- [static/js/manage-panel.js](static/js/manage-panel.js) (x1)
- [static/js/mobile/list-app.js](static/js/mobile/list-app.js) (x1)
- [static/js/pro-user-super-mode.js](static/js/pro-user-super-mode.js) (x2)
- [static/js/staff-manage.js](static/js/staff-manage.js) (x2)
- [templates/auth/secure_credential_vault.html](templates/auth/secure_credential_vault.html) (x1)
- [templates/client/cards.html](templates/client/cards.html) (x12)
- [templates/components/pagination.html](templates/components/pagination.html) (x1)
- [templates/dashboard/client_admin.html](templates/dashboard/client_admin.html) (x1)
- [templates/dashboard/client_staff.html](templates/dashboard/client_staff.html) (x1)
- [templates/dashboard/owner.html](templates/dashboard/owner.html) (x1)
- [templates/dashboard/staff.html](templates/dashboard/staff.html) (x1)
- [templates/partials/auth/login-step1-role.html](templates/partials/auth/login-step1-role.html) (x4)
- [templates/partials/auth/login-step2-email.html](templates/partials/auth/login-step2-email.html) (x1)
- [templates/partials/auth/login-step3-password.html](templates/partials/auth/login-step3-password.html) (x1)
- [templates/partials/auth/login-step5-reset.html](templates/partials/auth/login-step5-reset.html) (x2)
- [templates/partials/client/client-drawer.html](templates/partials/client/client-drawer.html) (x35)
- [templates/partials/client/group-message-drawer.html](templates/partials/client/group-message-drawer.html) (x4)
- [templates/partials/client/table-container.html](templates/partials/client/table-container.html) (x1)
- [templates/partials/client/view-modal.html](templates/partials/client/view-modal.html) (x6)
- [templates/partials/client_staff/staff-drawer-client-assignment.html](templates/partials/client_staff/staff-drawer-client-assignment.html) (x1)
- [templates/partials/client_staff/staff-drawer-permissions.html](templates/partials/client_staff/staff-drawer-permissions.html) (x14)
- [templates/partials/client_staff/table-container.html](templates/partials/client_staff/table-container.html) (x1)
- [templates/partials/components/create-xlsx-modal.html](templates/partials/components/create-xlsx-modal.html) (x2)
- [templates/partials/components/image-upload.html](templates/partials/components/image-upload.html) (x2)
- [templates/partials/dashboard/search-modal.html](templates/partials/dashboard/search-modal.html) (x1)
- [templates/partials/group-setting/drawer.html](templates/partials/group-setting/drawer.html) (x4)
- [templates/partials/group-setting/table-container.html](templates/partials/group-setting/table-container.html) (x1)
- [templates/partials/idcard-group/modal-download-all.html](templates/partials/idcard-group/modal-download-all.html) (x1)
- [templates/partials/idcard/modal-downloads.html](templates/partials/idcard/modal-downloads.html) (x22)
- [templates/partials/idcard/modal-image-sort.html](templates/partials/idcard/modal-image-sort.html) (x2)
- [templates/partials/idcard/pagination.html](templates/partials/idcard/pagination.html) (x1)
- [templates/partials/idcard/search-filter-bar.html](templates/partials/idcard/search-filter-bar.html) (x2)
- [templates/partials/idcard/search-filter-right.html](templates/partials/idcard/search-filter-right.html) (x2)
- [templates/partials/idcard/side-modal.html](templates/partials/idcard/side-modal.html) (x6)
- [templates/partials/idcard/table-container.html](templates/partials/idcard/table-container.html) (x1)
- [templates/partials/panel/create-notification-modal.html](templates/partials/panel/create-notification-modal.html) (x8)
- [templates/partials/panel/global-search-overlay.html](templates/partials/panel/global-search-overlay.html) (x1)
- [templates/partials/panel/tab-download-templates.html](templates/partials/panel/tab-download-templates.html) (x3)
- [templates/partials/panel/tab-email-logs.html](templates/partials/panel/tab-email-logs.html) (x6)
- [templates/partials/panel/tab-log-history.html](templates/partials/panel/tab-log-history.html) (x1)
- [templates/partials/panel/tab-notifications.html](templates/partials/panel/tab-notifications.html) (x5)
- [templates/partials/staff/client-staff-drawer.html](templates/partials/staff/client-staff-drawer.html) (x25)
- [templates/partials/staff/staff-drawer-client-assignment.html](templates/partials/staff/staff-drawer-client-assignment.html) (x1)
- [templates/partials/staff/staff-drawer-info.html](templates/partials/staff/staff-drawer-info.html) (x7)
- [templates/partials/staff/staff-drawer-permissions.html](templates/partials/staff/staff-drawer-permissions.html) (x37)
- [templates/partials/staff/staff-form-modal.html](templates/partials/staff/staff-form-modal.html) (x8)
- [templates/partials/staff/table-container.html](templates/partials/staff/table-container.html) (x1)
- [templates/partials/staff/temp-password-modal.html](templates/partials/staff/temp-password-modal.html) (x2)
- [templates/pro_user/data-deletion-guard.html](templates/pro_user/data-deletion-guard.html) (x17)
- [templates/pro_user/log-deletion-guard.html](templates/pro_user/log-deletion-guard.html) (x2)
- [templates/pro_user/super-mode-manager.html](templates/pro_user/super-mode-manager.html) (x5)
- [templates/product-gallery.html](templates/product-gallery.html) (x1)
- [templates/services/adarsh-cropper.html](templates/services/adarsh-cropper.html) (x18)
- [templates/settings.html](templates/settings.html) (x11)
- [templates/tutorial-personal-guide.html](templates/tutorial-personal-guide.html) (x1)
- [templates/tutorial.html](templates/tutorial.html) (x38)

### IconsSVG

- Total occurrences: 4
- Files:
- [templates/errors/base_error_page.html](templates/errors/base_error_page.html) (x4)

### IconsITag

- Total occurrences: 1661
- Files:
- [static/js/adarshengine-nav.js](static/js/adarshengine-nav.js) (x5)
- [static/js/backup-panel.js](static/js/backup-panel.js) (x6)
- [static/js/card-history-drawer.js](static/js/card-history-drawer.js) (x4)
- [static/js/client-message-drawer.js](static/js/client-message-drawer.js) (x2)
- [static/js/core/confirm.js](static/js/core/confirm.js) (x8)
- [static/js/core/sanitizer.js](static/js/core/sanitizer.js) (x1)
- [static/js/core/toast.js](static/js/core/toast.js) (x2)
- [static/js/core/utils.js](static/js/core/utils.js) (x1)
- [static/js/create-xlsx.js](static/js/create-xlsx.js) (x2)
- [static/js/dashboard-actions.js](static/js/dashboard-actions.js) (x13)
- [static/js/dashboard-client-message-drawer.js](static/js/dashboard-client-message-drawer.js) (x8)
- [static/js/global-search.js](static/js/global-search.js) (x16)
- [static/js/group-setting-api.js](static/js/group-setting-api.js) (x5)
- [static/js/group-setting-events.js](static/js/group-setting-events.js) (x1)
- [static/js/group-setting-ui.js](static/js/group-setting-ui.js) (x7)
- [static/js/idcard-actions-api-bulk.js](static/js/idcard-actions-api-bulk.js) (x8)
- [static/js/idcard-actions-api-status.js](static/js/idcard-actions-api-status.js) (x8)
- [static/js/idcard-actions-core-state.js](static/js/idcard-actions-core-state.js) (x1)
- [static/js/idcard-actions-crop.js](static/js/idcard-actions-crop.js) (x3)
- [static/js/idcard-actions-download-modals.js](static/js/idcard-actions-download-modals.js) (x3)
- [static/js/idcard-actions-modal-delete.js](static/js/idcard-actions-modal-delete.js) (x7)
- [static/js/idcard-actions-modal-form-data.js](static/js/idcard-actions-modal-form-data.js) (x3)
- [static/js/idcard-actions-modal-form-ops.js](static/js/idcard-actions-modal-form-ops.js) (x1)
- [static/js/idcard-actions-modal-view-helpers.js](static/js/idcard-actions-modal-view-helpers.js) (x6)
- [static/js/idcard-actions-modal-view-render.js](static/js/idcard-actions-modal-view-render.js) (x5)
- [static/js/idcard-actions-search-filters.js](static/js/idcard-actions-search-filters.js) (x8)
- [static/js/idcard-actions-search-input.js](static/js/idcard-actions-search-input.js) (x7)
- [static/js/idcard-actions-table-render-main.js](static/js/idcard-actions-table-render-main.js) (x2)
- [static/js/idcard-actions-table-render-row.js](static/js/idcard-actions-table-render-row.js) (x3)
- [static/js/idcard-actions-upload-logic.js](static/js/idcard-actions-upload-logic.js) (x4)
- [static/js/idcard-actions-upload-ui.js](static/js/idcard-actions-upload-ui.js) (x17)
- [static/js/idcard-group.js](static/js/idcard-group.js) (x2)
- [static/js/manage-client-api.js](static/js/manage-client-api.js) (x2)
- [static/js/manage-client-handlers.js](static/js/manage-client-handlers.js) (x21)
- [static/js/manage-client-login-history.js](static/js/manage-client-login-history.js) (x13)
- [static/js/manage-client-staff-admin.js](static/js/manage-client-staff-admin.js) (x26)
- [static/js/manage-client-staff.js](static/js/manage-client-staff.js) (x6)
- [static/js/manage-client-ui.js](static/js/manage-client-ui.js) (x13)
- [static/js/manage-panel.js](static/js/manage-panel.js) (x63)
- [static/js/manage-staff-api.js](static/js/manage-staff-api.js) (x2)
- [static/js/manage-staff-common-drawer.js](static/js/manage-staff-common-drawer.js) (x1)
- [static/js/manage-staff-common-list.js](static/js/manage-staff-common-list.js) (x2)
- [static/js/manage-staff-handlers.js](static/js/manage-staff-handlers.js) (x7)
- [static/js/manage-staff-login-history.js](static/js/manage-staff-login-history.js) (x15)
- [static/js/manage-staff-state.js](static/js/manage-staff-state.js) (x2)
- [static/js/mobile/list-app.js](static/js/mobile/list-app.js) (x8)
- [static/js/notification-bell.js](static/js/notification-bell.js) (x2)
- [static/js/pro-user-super-mode.js](static/js/pro-user-super-mode.js) (x1)
- [static/js/reprint-cards-confirm.js](static/js/reprint-cards-confirm.js) (x6)
- [static/js/reprint-cards-download.js](static/js/reprint-cards-download.js) (x5)
- [static/js/staff-manage.js](static/js/staff-manage.js) (x5)
- [templates/auth/inactive.html](templates/auth/inactive.html) (x1)
- [templates/auth/maintenance.html](templates/auth/maintenance.html) (x2)
- [templates/auth/secure_credential_vault.html](templates/auth/secure_credential_vault.html) (x7)
- [templates/backup-select-clients.html](templates/backup-select-clients.html) (x19)
- [templates/base.html](templates/base.html) (x8)
- [templates/client/base.html](templates/client/base.html) (x2)
- [templates/client/cards.html](templates/client/cards.html) (x17)
- [templates/client/dashboard.html](templates/client/dashboard.html) (x24)
- [templates/client/groups.html](templates/client/groups.html) (x11)
- [templates/client/messages.html](templates/client/messages.html) (x6)
- [templates/client/staff.html](templates/client/staff.html) (x2)
- [templates/components/breadcrumb.html](templates/components/breadcrumb.html) (x3)
- [templates/components/center-modal.html](templates/components/center-modal.html) (x2)
- [templates/components/delete-modal.html](templates/components/delete-modal.html) (x8)
- [templates/components/empty-state.html](templates/components/empty-state.html) (x2)
- [templates/components/filter-dropdown.html](templates/components/filter-dropdown.html) (x1)
- [templates/components/modal-side.html](templates/components/modal-side.html) (x2)
- [templates/components/pagination.html](templates/components/pagination.html) (x4)
- [templates/components/search-box.html](templates/components/search-box.html) (x2)
- [templates/components/stat-card.html](templates/components/stat-card.html) (x1)
- [templates/components/status-modal.html](templates/components/status-modal.html) (x6)
- [templates/components/toast.html](templates/components/toast.html) (x2)
- [templates/components/workflow-modal.html](templates/components/workflow-modal.html) (x9)
- [templates/dashboard/client_admin.html](templates/dashboard/client_admin.html) (x32)
- [templates/dashboard/client_staff.html](templates/dashboard/client_staff.html) (x31)
- [templates/dashboard/owner.html](templates/dashboard/owner.html) (x32)
- [templates/dashboard/staff.html](templates/dashboard/staff.html) (x23)
- [templates/engine_modal.html](templates/engine_modal.html) (x16)
- [templates/group-setting.html](templates/group-setting.html) (x7)
- [templates/idcard-group.html](templates/idcard-group.html) (x8)
- [templates/impersonate/login-as-user.html](templates/impersonate/login-as-user.html) (x7)
- [templates/index.html](templates/index.html) (x1)
- [templates/manage-client-staff.html](templates/manage-client-staff.html) (x2)
- [templates/manage-client.html](templates/manage-client.html) (x3)
- [templates/manage-panel.html](templates/manage-panel.html) (x13)
- [templates/manage-staff.html](templates/manage-staff.html) (x2)
- [templates/notifications.html](templates/notifications.html) (x7)
- [templates/partials/auth/login-header.html](templates/partials/auth/login-header.html) (x1)
- [templates/partials/auth/login-step1-role.html](templates/partials/auth/login-step1-role.html) (x9)
- [templates/partials/auth/login-step2-email.html](templates/partials/auth/login-step2-email.html) (x1)
- [templates/partials/auth/login-step3-password.html](templates/partials/auth/login-step3-password.html) (x4)
- [templates/partials/auth/login-step4-otp.html](templates/partials/auth/login-step4-otp.html) (x1)
- [templates/partials/auth/login-step5-reset.html](templates/partials/auth/login-step5-reset.html) (x3)
- [templates/partials/client-message-drawer.html](templates/partials/client-message-drawer.html) (x4)
- [templates/partials/client-message-strip.html](templates/partials/client-message-strip.html) (x1)
- [templates/partials/client-sidebar.html](templates/partials/client-sidebar.html) (x10)
- [templates/partials/client/action-bar-right.html](templates/partials/client/action-bar-right.html) (x9)
- [templates/partials/client/client-drawer.html](templates/partials/client/client-drawer.html) (x16)
- [templates/partials/client/delete-modal.html](templates/partials/client/delete-modal.html) (x7)
- [templates/partials/client/group-message-drawer.html](templates/partials/client/group-message-drawer.html) (x4)
- [templates/partials/client/staff-drawer.html](templates/partials/client/staff-drawer.html) (x8)
- [templates/partials/client/status-modal.html](templates/partials/client/status-modal.html) (x6)
- [templates/partials/client/table-container.html](templates/partials/client/table-container.html) (x11)
- [templates/partials/client/view-modal.html](templates/partials/client/view-modal.html) (x7)
- [templates/partials/client_staff/staff-drawer-client-assignment.html](templates/partials/client_staff/staff-drawer-client-assignment.html) (x3)
- [templates/partials/client_staff/staff-drawer-permissions.html](templates/partials/client_staff/staff-drawer-permissions.html) (x5)
- [templates/partials/client_staff/staff-drawer.html](templates/partials/client_staff/staff-drawer.html) (x2)
- [templates/partials/client_staff/table-container.html](templates/partials/client_staff/table-container.html) (x8)
- [templates/partials/client_staff/table.html](templates/partials/client_staff/table.html) (x2)
- [templates/partials/common/topbar.html](templates/partials/common/topbar.html) (x2)
- [templates/partials/components/create-xlsx-modal.html](templates/partials/components/create-xlsx-modal.html) (x17)
- [templates/partials/components/drawer.html](templates/partials/components/drawer.html) (x2)
- [templates/partials/components/image-upload.html](templates/partials/components/image-upload.html) (x2)
- [templates/partials/components/user-avatar.html](templates/partials/components/user-avatar.html) (x6)
- [templates/partials/dashboard/backup-modal.html](templates/partials/dashboard/backup-modal.html) (x9)
- [templates/partials/dashboard/bulk-actions.html](templates/partials/dashboard/bulk-actions.html) (x5)
- [templates/partials/dashboard/delete-modal.html](templates/partials/dashboard/delete-modal.html) (x5)
- [templates/partials/dashboard/notification-bar.html](templates/partials/dashboard/notification-bar.html) (x6)
- [templates/partials/dashboard/print-overview-card.html](templates/partials/dashboard/print-overview-card.html) (x4)
- [templates/partials/dashboard/print-reprint-overview.html](templates/partials/dashboard/print-reprint-overview.html) (x3)
- [templates/partials/dashboard/quick-actions.html](templates/partials/dashboard/quick-actions.html) (x5)
- [templates/partials/dashboard/recent-activity.html](templates/partials/dashboard/recent-activity.html) (x4)
- [templates/partials/dashboard/recent-updates.html](templates/partials/dashboard/recent-updates.html) (x7)
- [templates/partials/dashboard/reprint-overview-card.html](templates/partials/dashboard/reprint-overview-card.html) (x4)
- [templates/partials/dashboard/reupload-modal.html](templates/partials/dashboard/reupload-modal.html) (x6)
- [templates/partials/dashboard/search-modal.html](templates/partials/dashboard/search-modal.html) (x4)
- [templates/partials/dashboard/section-tabs.html](templates/partials/dashboard/section-tabs.html) (x5)
- [templates/partials/dashboard/side-overview-stats.html](templates/partials/dashboard/side-overview-stats.html) (x7)
- [templates/partials/dashboard/topbar.html](templates/partials/dashboard/topbar.html) (x3)
- [templates/partials/dashboard/upgrade-modal.html](templates/partials/dashboard/upgrade-modal.html) (x5)
- [templates/partials/dashboard/welcome-notification-js.html](templates/partials/dashboard/welcome-notification-js.html) (x1)
- [templates/partials/group-setting/action-bar.html](templates/partials/group-setting/action-bar.html) (x8)
- [templates/partials/group-setting/drawer.html](templates/partials/group-setting/drawer.html) (x12)
- [templates/partials/group-setting/table-container.html](templates/partials/group-setting/table-container.html) (x9)
- [templates/partials/idcard-group/action-bar-right.html](templates/partials/idcard-group/action-bar-right.html) (x1)
- [templates/partials/idcard-group/modal-delete-all.html](templates/partials/idcard-group/modal-delete-all.html) (x5)
- [templates/partials/idcard-group/modal-download-all.html](templates/partials/idcard-group/modal-download-all.html) (x3)
- [templates/partials/idcard-group/modal-reupload.html](templates/partials/idcard-group/modal-reupload.html) (x4)
- [templates/partials/idcard-group/modal-upgrade-all.html](templates/partials/idcard-group/modal-upgrade-all.html) (x5)
- [templates/partials/idcard-group/table.html](templates/partials/idcard-group/table.html) (x11)
- [templates/partials/idcard-group/topbar.html](templates/partials/idcard-group/topbar.html) (x9)
- [templates/partials/idcard/action-bar-left.html](templates/partials/idcard/action-bar-left.html) (x47)
- [templates/partials/idcard/action-bar-right.html](templates/partials/idcard/action-bar-right.html) (x3)
- [templates/partials/idcard/action-bar.html](templates/partials/idcard/action-bar.html) (x50)
- [templates/partials/idcard/modal-delete-permanent.html](templates/partials/idcard/modal-delete-permanent.html) (x5)
- [templates/partials/idcard/modal-delete-simple.html](templates/partials/idcard/modal-delete-simple.html) (x5)
- [templates/partials/idcard/modal-doc-format.html](templates/partials/idcard/modal-doc-format.html) (x6)
- [templates/partials/idcard/modal-downloads.html](templates/partials/idcard/modal-downloads.html) (x16)
- [templates/partials/idcard/modal-image-sort.html](templates/partials/idcard/modal-image-sort.html) (x6)
- [templates/partials/idcard/modal-reupload-images.html](templates/partials/idcard/modal-reupload-images.html) (x4)
- [templates/partials/idcard/modal-search-all.html](templates/partials/idcard/modal-search-all.html) (x6)
- [templates/partials/idcard/modal-upload-wizard.html](templates/partials/idcard/modal-upload-wizard.html) (x20)
- [templates/partials/idcard/pagination.html](templates/partials/idcard/pagination.html) (x4)
- [templates/partials/idcard/search-filter-bar.html](templates/partials/idcard/search-filter-bar.html) (x14)
- [templates/partials/idcard/search-filter-left.html](templates/partials/idcard/search-filter-left.html) (x2)
- [templates/partials/idcard/search-filter-right.html](templates/partials/idcard/search-filter-right.html) (x5)
- [templates/partials/idcard/side-modal.html](templates/partials/idcard/side-modal.html) (x14)
- [templates/partials/idcard/table-container.html](templates/partials/idcard/table-container.html) (x4)
- [templates/partials/idcard/topbar.html](templates/partials/idcard/topbar.html) (x9)
- [templates/partials/impersonate-bar.html](templates/partials/impersonate-bar.html) (x2)
- [templates/partials/impersonate-modal.html](templates/partials/impersonate-modal.html) (x4)
- [templates/partials/notification-bell.html](templates/partials/notification-bell.html) (x3)
- [templates/partials/panel/create-notification-modal.html](templates/partials/panel/create-notification-modal.html) (x6)
- [templates/partials/panel/global-search-overlay.html](templates/partials/panel/global-search-overlay.html) (x4)
- [templates/partials/panel/tab-backups.html](templates/partials/panel/tab-backups.html) (x10)
- [templates/partials/panel/tab-batch-jobs.html](templates/partials/panel/tab-batch-jobs.html) (x3)
- [templates/partials/panel/tab-download-templates.html](templates/partials/panel/tab-download-templates.html) (x19)
- [templates/partials/panel/tab-email-logs.html](templates/partials/panel/tab-email-logs.html) (x15)
- [templates/partials/panel/tab-log-history.html](templates/partials/panel/tab-log-history.html) (x9)
- [templates/partials/panel/tab-maintenance.html](templates/partials/panel/tab-maintenance.html) (x6)
- [templates/partials/panel/tab-monitoring.html](templates/partials/panel/tab-monitoring.html) (x11)
- [templates/partials/panel/tab-notifications.html](templates/partials/panel/tab-notifications.html) (x24)
- [templates/partials/panel/tab-server-info.html](templates/partials/panel/tab-server-info.html) (x11)
- [templates/partials/panel/tab-system.html](templates/partials/panel/tab-system.html) (x4)
- [templates/partials/panel/topbar.html](templates/partials/panel/topbar.html) (x4)
- [templates/partials/pro-feature-tabs.html](templates/partials/pro-feature-tabs.html) (x4)
- [templates/partials/sidebar.html](templates/partials/sidebar.html) (x17)
- [templates/partials/staff/action-bar-right.html](templates/partials/staff/action-bar-right.html) (x6)
- [templates/partials/staff/client-staff-drawer.html](templates/partials/staff/client-staff-drawer.html) (x31)
- [templates/partials/staff/manage-staff-table.html](templates/partials/staff/manage-staff-table.html) (x1)
- [templates/partials/staff/staff-confirm-modal.html](templates/partials/staff/staff-confirm-modal.html) (x5)
- [templates/partials/staff/staff-drawer-client-assignment.html](templates/partials/staff/staff-drawer-client-assignment.html) (x3)
- [templates/partials/staff/staff-drawer-footer.html](templates/partials/staff/staff-drawer-footer.html) (x3)
- [templates/partials/staff/staff-drawer-info.html](templates/partials/staff/staff-drawer-info.html) (x4)
- [templates/partials/staff/staff-drawer-permissions.html](templates/partials/staff/staff-drawer-permissions.html) (x9)
- [templates/partials/staff/staff-drawer.html](templates/partials/staff/staff-drawer.html) (x2)
- [templates/partials/staff/staff-form-modal.html](templates/partials/staff/staff-form-modal.html) (x4)
- [templates/partials/staff/table-container.html](templates/partials/staff/table-container.html) (x8)
- [templates/partials/staff/table.html](templates/partials/staff/table.html) (x2)
- [templates/partials/staff/temp-password-modal.html](templates/partials/staff/temp-password-modal.html) (x11)
- [templates/partials/unified-sidebar.html](templates/partials/unified-sidebar.html) (x19)
- [templates/pro_user/data-deletion-guard.html](templates/pro_user/data-deletion-guard.html) (x17)
- [templates/pro_user/log-deletion-guard.html](templates/pro_user/log-deletion-guard.html) (x17)
- [templates/pro_user/super-mode-manager.html](templates/pro_user/super-mode-manager.html) (x5)
- [templates/pro_user/user-deep-history-detail.html](templates/pro_user/user-deep-history-detail.html) (x11)
- [templates/product-gallery.html](templates/product-gallery.html) (x5)
- [templates/services/adarsh-cropper.html](templates/services/adarsh-cropper.html) (x70)
- [templates/settings.html](templates/settings.html) (x17)
- [templates/staff/manage.html](templates/staff/manage.html) (x2)
- [templates/system-maintenance.html](templates/system-maintenance.html) (x3)
- [templates/tutorial-personal-guide.html](templates/tutorial-personal-guide.html) (x11)
- [templates/tutorial.html](templates/tutorial.html) (x24)

### Button Variants

- Class tokens on buttons:
- btn (x349)
- btn-md (x107)
- btn-neutral (x93)
- btn-sm (x78)
- btn-primary (x54)
- btn-purple (x48)
- btn-danger (x27)
- btn-blue (x22)
- btn-outline-primary (x18)
- btn-amber (x12)
- btn-warning (x11)
- btn-gray (x10)
- btn-settings (x10)
- btn-icon (x9)
- btn-green (x8)
- btn-secondary (x6)
- btn-red (x6)
- btn-outline-secondary (x4)
- btn-success (x3)
- btn-save (x2)
- btn-danger-zone (x2)
- btn-upload-zip (x2)
- btn-outline-danger (x2)
- btn-dismiss-error (x2)
- btn-confirm-single (x1)
- btn-reject-single (x1)
- btn-download-single (x1)
- btn-logout (x1)
- btn-xs (x1)
- btn-lg (x1)
- btn-clear-file (x1)
- btn-remove-field (x1)
- btn-download-field (x1)
- btn-engine-dl (x1)
- Size tokens on buttons (h-*):
- h-8 (x1)

### Input Variants

- Input class tokens:
- form-input (x34)
- input-readonly (x6)
- Input size tokens (h-*):
- h-4 (x11)
- Select class tokens:
- form-select (x37)
- form-select-sm (x14)
- center-modal-select (x8)
- panel-form-select (x6)
- form-input (x2)
- pipeline-select (x2)
- field-type-select (x1)
- sm-ram-select (x1)
- ae-preset-select (x1)
- pg-category-select (x1)
- session-select (x1)
- template-font-select (x1)
- template-size-select (x1)
- client-dropdown (x1)
- rename-select (x1)
- Textarea class tokens:
- form-textarea (x4)
- panel-form-input (x4)
- form-control (x1)
- form-input (x1)

### Checkbox Variants

- Checkbox class tokens:
- w-4 (x11)
- h-4 (x11)
- rounded (x11)
- border-gray-400 (x11)
- accent-purple-600 (x11)
- cursor-pointer (x11)
- mt-0.5 (x3)
- field-mandatory-checkbox (x1)
- reprint-picker-row (x1)
- rowCheckbox (x1)
- sm-assign-toggle (x1)
- sm-runtime-toggle (x1)
- confirmRowCheckbox (x1)
- downloadRowCheckbox (x1)
- backup-client-check (x1)
- download-xlsx-option-checkbox (x1)
- checkbox-input (x1)

### Badge Variants

- Badge tokens:
- None

### Icon Tokens

- Icon class tokens:
- fa-solid (x1703)
- fa-xmark (x138)
- fa-spin (x66)
- fa-spinner (x64)
- fa-magnifying-glass (x59)
- fa-house (x56)
- fa-chevron-right (x54)
- fa-check (x44)
- fa-eye (x39)
- fa-circle-check (x38)
- fa-id-card (x35)
- fa-circle-info (x29)
- fa-layer-group (x28)
- fa-trash (x27)
- fa-triangle-exclamation (x26)
- fa-arrows-rotate (x26)
- fa-download (x25)
- fa-clock (x24)
- fa-images (x24)
- fa-circle-exclamation (x23)
- fa-plus (x21)
- fa-arrow-right (x21)
- fa-chevron-down (x21)
- fa-lock (x21)
- fa-file-excel (x21)
- fa-users (x20)
- fa-user (x20)
- fa-paper-plane (x19)
- fa-building (x17)
- fa-shield-halved (x17)
- fa-chevron-left (x16)
- fa-file-pdf (x16)
- fa-image (x15)
- fa-trash-can (x15)
- fa-gear (x15)
- fa-file-word (x15)
- fa-folder-open (x14)
- fa-ban (x14)
- fa-pen (x14)
- fa-angles-left (x14)
- fa-angles-right (x14)
- fa-pen-to-square (x13)
- fa-upload (x13)
- fa-database (x12)
- fa-sort (x12)
- fa-eye-slash (x12)
- fa-arrow-left (x12)
- fa-bars (x11)
- fa-arrow-up (x11)
- fa-table-list (x10)
- fa-circle-xmark (x10)
- fa-rotate (x10)
- fa-rotate-left (x10)
- fa-floppy-disk (x9)
- fa-user-astronaut (x9)
- fa-envelope (x9)
- fa-user-plus (x9)
- fa-bell (x9)
- fa-inbox (x8)
- fa-user-shield (x8)
- fa-print (x8)
- fa-power-off (x8)
- fa-key (x8)
- fa-list-check (x8)
- fa-thumbs-up (x8)
- fa-user-tie (x8)
- fa-file-zipper (x7)
- fa-exclamation-triangle (x7)
- fa-user-gear (x7)
- fa-crop-simple (x6)
- fa-table (x6)
- fa-save (x6)
- fa-file-lines (x6)
- fa-history (x6)
- fa-toggle-on (x6)
- fa-bolt (x6)
- fa-filter-circle-xmark (x5)
- fa-desktop (x5)
- fa-mobile-screen-button (x5)
- fa-bell-slash (x5)
- fa-rocket (x5)
- fa-wand-magic-sparkles (x5)
- fa-right-from-bracket (x5)
- fa-copy (x5)
- fa-brands (x5)
- fa-user-check (x5)
- fa-sliders (x5)
- fa-image-slash (x4)
- fa-wave-square (x4)
- fa-users-gear (x4)
- fa-youtube (x4)
- fa-code-branch (x4)
- fa-globe (x4)
- fa-cog (x4)
- fa-list (x4)
- fa-play (x3)
- fa-folder-tree (x3)
- fa-laptop (x3)
- fa-network-wired (x3)
- fa-envelope-open-text (x3)
- fa-check-double (x3)
- fa-file-arrow-down (x3)
- fa-circle-question (x3)
- fa-message (x3)
- fa-box-archive (x3)
- fa-book-open (x3)
- fa-crop (x3)
- fa-mobile-screen (x3)
- fa-filter (x3)
- fa-rotate-right (x3)
- fa-hashtag (x3)
- fa-i-cursor (x3)
- fa-users-slash (x2)
- fa-grip-vertical (x2)
- fa-minus-circle (x2)
- fa-circle (x2)
- fa-envelope-open (x2)
- fa-link (x2)
- fa-clipboard-check (x2)
- fa-user-slash (x2)
- fa-expand (x2)
- fa-bars-progress (x2)
- fa-server (x2)
- fa-right-to-bracket (x2)
- fa-language (x2)
- fa-regular (x2)
- fa-chart-line (x2)
- fa-clock-rotate-left (x2)
- fa-calendar-days (x2)
- fa-shield (x2)
- fa-gem (x2)
- fa-screwdriver-wrench (x2)
- fa-crown (x2)
- fa-building-user (x2)
- fa-cloud-arrow-up (x2)
- fa-table-columns (x2)
- fa-hourglass-half (x2)
- fa-microchip (x2)
- fa-folder (x2)
- fa-phone (x1)
- fa-calendar-plus (x1)
- fa-location-dot (x1)
- fa-user-pen (x1)
- fa-cloud-arrow-down (x1)
- fa-$ (x1)
- fa-graduation-cap (x1)
- fa-hourglass-start (x1)
- fa-font (x1)
- fa-arrow-down (x1)
- fa-tag (x1)
- fa-file-export (x1)
- fa-vault (x1)
- fa-lock-open (x1)
- fa-circle-notch (x1)
- fa-comments (x1)
- fa-question-circle (x1)
- fa-chart-pie (x1)
- fa-whatsapp (x1)
- fa-up-right-from-square (x1)
- fa-wrench (x1)
- fa-mask (x1)
- fa-user-secret (x1)
- fa-gauge-high (x1)
- fa-briefcase (x1)
- fa-user-circle (x1)
- fa-ellipsis-vertical (x1)
- fa-user-xmark (x1)
- fa-calendar (x1)
- fa-gears (x1)
- fa-compass (x1)
- fa-retweet (x1)
- fa-chart-simple (x1)
- fa-plus-circle (x1)
- fa-asterisk (x1)
- fa- (x1)
- fa-id-badge (x1)
- fa-bold (x1)
- fa-italic (x1)
- fa-underline (x1)
- fa-align-left (x1)
- fa-align-center (x1)
- fa-align-right (x1)
- fa-list-ul (x1)
- fa-list-ol (x1)
- fa-eraser (x1)
- fa-heart-pulse (x1)
- fa-columns (x1)
- fa-vial-circle-check (x1)
- fa-file-shield (x1)
- fa-angle-down (x1)
- fa-arrow-up-from-bracket (x1)
- fa-file-image (x1)
- fa-compress (x1)
- fa-stop (x1)
- fa-chart-bar (x1)

## Design Tokens (Repeated Utilities)

### Heights

- h-4 (x11)
- h-full (x9)
- h-10 (x6)
- h-12 (x4)
- h-[22px] (x4)
- h-9 (x2)

### Widths

- w-full (x38)
- w-4 (x11)
- w-[90px] (x10)
- w-[60px] (x8)
- w-[65px] (x8)
- w-10 (x6)
- w-[24px] (x5)
- w-[36px] (x5)
- w-9 (x5)
- w-[28px] (x4)
- w-[22px] (x4)
- w-24 (x3)

### Padding

- p-0 (x14)
- p-3 (x7)
- p-5 (x2)
- p-4 (x2)
- p-1 (x2)

### Padding X

- px-[1px] (x27)
- px-2.5 (x10)
- px-3.5 (x5)
- px-4 (x4)
- px-5 (x4)
- px-2 (x3)
- px-1 (x2)

### Padding Y

- py-1 (x34)
- py-2.5 (x16)
- py-2 (x8)
- py-3 (x6)
- py-8 (x4)
- py-0.5 (x3)
- py-4 (x2)

### Border Radius

- rounded (x19)
- rounded-lg (x18)
- rounded-md (x10)
- rounded-xl (x7)
- rounded-sm (x3)

### Font Size / Text

- text-center (x159)
- text-sm (x48)
- text-xs (x46)
- text-left (x35)
- text-gray-500 (x18)
- text-[#f8fafc] (x18)
- text-white (x17)
- text-[#718096] (x17)
- text-gray-400 (x15)
- text-[#a0aec0] (x13)
- text-gray-700 (x9)
- text-[13px] (x7)
- text-[15px] (x7)
- text-gray-800 (x6)
- text-green-400 (x5)
- text-[17px] (x5)
- text-base (x4)
- text-[11px] (x3)
- text-gray-300 (x3)
- text-amber-700 (x3)
- text-2xl (x3)
- text-gray-600 (x2)
- text-amber-400 (x2)
- text-right (x2)
- text-indigo-700 (x2)
- text-3xl (x2)
- text-lg (x2)
- text-xl (x2)
- text-red-400 (x2)
- text-[#667eea] (x2)
- text-error (x2)

### Background Colors

- bg-gradient-to-br (x11)
- bg-[rgba(102,126,234,0.05)] (x8)
- bg-transparent (x5)
- bg-amber-50 (x3)
- bg-[rgba(30,32,48,0.95)] (x2)
- bg-gray-900 (x2)
- bg-opacity-20 (x2)
- bg-white (x2)

### Border Colors

- border-[rgba(102,126,234,0.2)] (x18)
- border-gray-400 (x11)
- border-none (x8)
- border-2 (x5)
- border-b (x3)
- border-[rgba(102,126,234,0.3)] (x2)
- border-gray-600 (x2)
- border-[rgba(255,255,255,0.08)] (x2)
- border-t (x2)

## Duplication and Consistency Issues

- Multiple surface tokens used for cards and panels (card/panel/tile). Unify into a single <Card /> API.
- Multiple action container tokens (toolbar/action-bar/actions/btn-group). Replace with <Toolbar />.
- Button styling fragmented across btn-* and raw utility classes. Consolidate into <Button variant size />.
- Input styling varies (input/form-input plus raw utilities). Consolidate into <Input />, <Select />, <Textarea />.
- Layout wrappers use layout/shell/wrapper/page-* tokens. Standardize on <PageShell /> and <ContentLayout />.
- Drawer vs sidebar tokens overlap. Normalize into <SideDrawer /> and <SidebarNav /> if both exist.

## Proposed React Component Architecture

src/
  components/
    ui/
      Button/
      Input/
      Select/
      Textarea/
      Checkbox/
      Toggle/
      Badge/
      Icon/
    layout/
      PageShell/
      Sidebar/
      Topbar/
      Toolbar/
      Tabs/
    common/
      Card/
      Modal/
      SideDrawer/
      Pagination/
      Breadcrumbs/
      SearchInput/
      FilterPanel/
      DataTable/
    features/
      (feature-specific composites derived from the above)

## Top 10 Components to Build First

- IconsITag: used 1661 times
- Buttons: used 713 times
- Inputs: used 366 times
- Labels: used 341 times
- Checkboxes: used 173 times
- LayoutWrappers: used 103 times
- Selects: used 60 times
- DataTable: used 41 times
- ActionBarToolbar: used 26 times
- SideDrawer: used 15 times

## Migration Priority Order

1. Buttons, Inputs, Selects, Textareas, Checkboxes, Toggles
2. Cards and Layout Wrappers
3. Toolbars and Action Bars
4. DataTables
5. Search, Filters, Pagination, Breadcrumbs
6. Modals and SideDrawers
7. Tabs
8. Feature-specific composites
