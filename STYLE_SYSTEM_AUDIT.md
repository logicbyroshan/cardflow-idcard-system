# Global Styling and Component Audit

Date: 2026-03-13
Scope: templates + static CSS for admin/client/website surfaces

## Summary

The project has a strong base design system (Tailwind + core bundle), but multiple legacy include paths and inline styling hotspots are still active.

## Measured Hotspots

- Inline style attributes in templates: 514
- Inline <style> blocks in templates: 17
- Legacy common includes still in use:
  - partials/common/toast.html: 2
  - partials/common/pagination.html: 2
  - partials/common/delete-modal.html: 2
- New component includes in use:
  - components/toast.html: 14
  - components/pagination.html: 3
  - components/delete-modal.html: 3

## Findings

1. Duplicate component templates are active in parallel.
- The same UI primitives (toast, pagination, delete modal) exist under multiple include paths.
- This can cause style drift and behavior drift over time.

2. Mixed modal class contracts are present.
- Some dialogs use modal-backdrop/modal-center; others use center-modal-overlay/center-modal.
- Both work, but increase maintenance and consistency risk.

3. Inline styling is still heavily used.
- This reduces global style governance and can bypass shared tokens.

## Changes Applied in This Pass

1. Canonicalized pagination include.
- templates/partials/common/pagination.html now wraps components/pagination.html.

2. Canonicalized toast include.
- templates/components/toast.html now wraps partials/components/toast.html.

3. Aligned legacy delete modal to global modal contract without breaking legacy JS.
- templates/partials/common/delete-modal.html now includes:
  - modal-backdrop on overlay
  - modal-center + modal-danger on dialog container
  - dialog accessibility attributes (role/aria)

## Phase 2 Completed (Safe De-inline Pass)

1. Settings page inline style cleanup.
- templates/settings.html: replaced export/template inline styles with semantic classes.
- static/css/settings.css: added matching class rules.

2. Client dashboard inline style cleanup.
- templates/client/dashboard.html: replaced table/header/empty-state inline styles with classes.
- static/css/dashboard-table.css: added reprint-history utility classes.

3. Cardprint partial inline style cleanup.
- templates/cardprint/partials/topbar.html: removed inline nav-right layout styles.
- templates/cardprint/partials/step-print-list.html: removed inline banner/link/icon/text styles.
- static/css/cardprint/generate-card.css: added cardprint helper classes.

4. Validation status.
- No file-level errors reported after edits in all touched files.

## Recommended Next Phase (Safe Migration Plan)

1. Remove inline style hotspots from admin/client pages first.
- Priority templates:
  - templates/client/dashboard.html
  - templates/settings.html
  - templates/cardprint/partials/*.html

2. Normalize remaining center-modal* implementations.
- Keep one canonical modal markup contract.
- Use adapter classes only where legacy JS requires compatibility.

3. Move page-local style blocks to CSS modules.
- Replace template <style> blocks with file-based styles under static/css.

4. Add style guardrails.
- Add lint checks for inline style usage in templates.
- Add a component include policy in developer docs.

## Governance Rule Proposed

- Shared components must be imported only from one canonical path.
- Legacy paths should remain wrappers only; no duplicated markup logic.
- New shared components must use global tokenized classes and no inline style attributes.
