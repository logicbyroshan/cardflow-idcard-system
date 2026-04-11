# Phase 0 Screenshot + Behavior Checklist

Generated on: 2026-04-11
Branch: feature/mobile-pwa-shell-phase1
Goal: Freeze current mobile PWA visual and behavior baseline before any Android full-conversion work.

## Capture Rules
1. Device set:
- Android small phone (360x800)
- Android medium phone (393x873)
- Android tablet portrait (768x1024)

2. For each screen capture:
- Full screen screenshot
- 10-20 second interaction recording
- URL/route and user role in filename

3. Naming format:
- phase0_<role>_<route_slug>_<device>_<state>.png
- phase0_<role>_<route_slug>_<device>_<state>.mp4

4. No UI edits allowed during baseline capture.

## Route Coverage Matrix (Pages)

- [ ] /app/login/
- States: empty form, invalid credentials error, loading submit state
- Role: public

- [ ] /app/no-access/
- States: no-client-context reason, revoked reason if available
- Role: public

- [ ] /app/desktop-required/
- States: blocked message, back/fallback behavior
- Role: authenticated mobile account

- [ ] /app/
- States: initial load, data loaded, pull/refresh behavior, nav transitions
- Roles: super_admin, admin_staff, client, client_staff

- [ ] /app/clients/
- States: list loaded, empty state, search/filter if present
- Roles: super_admin/admin_staff only

- [ ] /app/clients/<id>/groups/
- States: groups list, empty groups
- Roles: super_admin/admin_staff

- [ ] /app/groups/
- States: default expanded sections, scroll behavior
- Roles: all authenticated roles with access

- [ ] /app/tables/<status>/
- States: each status tab expected by permissions
- Roles: client/client_staff + admin roles

- [ ] /app/table/<table_id>/<status>/
- States: list render, filters panel, action bar, pagination/infinite behavior
- Roles: all authenticated roles with table access

- [ ] /app/card/<card_id>/
- States: detail render, image render, locked/editable variations
- Roles: all authenticated roles with card access

- [ ] /app/reprint/<client_id>/
- States: list render, empty list, status chips
- Roles: roles with reprint access

- [ ] /app/reprint/table/<table_id>/
- States: request list, actions, query filtering
- Roles: roles with reprint access

- [ ] /app/camera/<table_id>/ and /app/camera/<table_id>/<card_id>/
- States: camera permission prompt, capture success, capture cancel, fallback path
- Roles: roles with upload permissions

- [ ] /app/notifications/
- States: unread/read display, empty state
- Roles: all authenticated roles

- [ ] /app/profile/
- States: profile render, update success, update validation error
- Roles: all authenticated roles

- [ ] /app/staff/
- States: list, create form, edit form, toggle active/inactive
- Roles: roles with staff management permission

- [ ] /app/settings/
- States: preferences render, save success, save error
- Roles: authenticated roles with page access

- [ ] /app/search/
- States: no query, results present, no results, table scoped search
- Roles: authenticated roles with search permission

- [ ] /app/website/
- States: portfolio upload success/failure, category item listing
- Roles: admin roles with website permission

## Shared Component Checklist

- [ ] templates/mobile_app/base.html
- [ ] templates/mobile_app/partials/navbar.html
- [ ] templates/mobile_app/partials/hamburger_drawer.html
- [ ] templates/mobile_app/partials/bottom_nav.html
- [ ] templates/mobile_app/partials/add_form_sheet.html
- [ ] templates/mobile_app/partials/list_filter_panel.html
- [ ] templates/mobile_app/partials/list_action_modals.html
- [ ] templates/mobile_app/partials/notification_drawer.html
- [ ] templates/mobile_app/partials/profile_drawer.html

## Behavioral Baseline Checklist

- [ ] Login flow works with mobile_auth checkpoint
- [ ] All protected pages redirect to /app/login/ when mobile_auth missing
- [ ] Back navigation works and does not auto-exit unexpectedly
- [ ] External links open expected target behavior
- [ ] Native-shell install CTA is hidden in APK context
- [ ] Browser/PWA install prompts appear only in browser context
- [ ] Toast, modal, drawer overlays do not block background incorrectly
- [ ] Search/filter states survive expected navigation transitions

## Evidence Storage

Save captures under:
- mobile_shell_app/phase0/evidence/screenshots/
- mobile_shell_app/phase0/evidence/videos/

(Directories intentionally not created yet to avoid binary churn in git until captures are produced.)
