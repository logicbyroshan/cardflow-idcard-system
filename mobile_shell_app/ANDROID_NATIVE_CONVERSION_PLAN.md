# Android Full-App Conversion Plan (No UI Change)

## Objective
Convert the current `mobile_app` PWA experience into an Android app experience with the same screens, same styling, and same behavior.

## Critical Reality
If we rewrite screens in XML/Jetpack Compose, it is not possible to guarantee 1:1 pixel-perfect parity with the current HTML/CSS/JS behavior.

For strict "same-to-same" output, the safest architecture is:
1. Keep existing web UI as source of truth.
2. Render UI in Android through a controlled app container.
3. Move app-specific controls (navigation, files, camera, notifications, offline) into native bridge modules.

This gives native app packaging with near-zero UI drift.

## Recommended Architecture
Use a Hybrid Native Container v2 (Capacitor-based, Android-first):

1. Keep `templates/mobile_app/*` + `static/mobile/*` unchanged as primary UI layer.
2. Keep Django as backend and screen-rendering engine.
3. Android app provides:
   - app packaging/install/update
   - push notifications
   - permissions and device APIs
   - controlled back behavior
   - deep links and external URL routing
4. Add route-level app mode flags to disable browser-only prompts in native app.

## Scope Breakdown

### Phase 0: Freeze Current Baseline
1. Create golden baseline videos/screenshots for each mobile page.
2. Capture route list and feature matrix for all `mobile_app` pages.
3. Freeze CSS tokens and font assets used in mobile app.

Deliverables:
1. Baseline screenshot pack (route-by-route).
2. Page inventory and behavior checklist.

### Phase 1: Route Inventory and Test Harness
1. Enumerate all routes under `/app/` and classify:
   - auth routes
   - dashboard/data routes
   - camera/upload routes
   - admin/manage routes
2. Add automated smoke checks for render + API success for each route.
3. Add visual regression checks for critical screens.

Deliverables:
1. Route manifest JSON.
2. Automated smoke + visual baseline tests.

### Phase 2: Native Container Hardening
1. Keep Capacitor shell but harden launch/back lifecycle.
2. Implement startup guardrails:
   - ignore phantom back events
   - require user interaction before app-exit path
3. Ensure external links always open in system browser.
4. Ensure deep links route into exact screen paths.

Deliverables:
1. Stable startup behavior.
2. No unexpected app close after launch.

### Phase 3: Browser-Only Feature Isolation
1. Centralize app mode detection:
   - `isNativeShell`
   - `isStandalonePwa`
   - `isMobileBrowser`
2. Keep install/download prompts only for browser/PWA context.
3. Keep native-only update prompts and force-update overlays in app context.

Deliverables:
1. One unified environment gate used across templates/scripts.
2. No install CTA visible inside Android app.

### Phase 4: Device Capability Bridge Expansion
1. Move camera/file-select/upload pipelines to robust native bridge where needed.
2. Add resilient file picker/cropper interop.
3. Harden notification registration and token refresh lifecycle.
4. Add network-aware retry queues for critical actions.

Deliverables:
1. Camera/upload reliability parity with PWA.
2. Push and offline-retry lifecycle docs.

### Phase 5: Offline and Caching Strategy
1. Define offline policy per route:
   - read-only cached
   - online-required
2. Version app assets with `APP_VERSION`.
3. Add rollback-safe cache invalidation for releases.

Deliverables:
1. Offline behavior matrix.
2. Deterministic cache/update flow.

### Phase 6: Release and Rollout
1. CI build pipeline for signed APK/AAB.
2. Stable artifact path policy:
   - `static/website/apk/adarsh-admin.apk` (latest)
   - optional versioned archive files for rollback
3. Release checklist with smoke tests on real devices.
4. Staged rollout and crash/ANR monitoring.

Deliverables:
1. Repeatable release process.
2. Production monitoring dashboard.

## "No UI Change" Guardrails
To maintain exact look and behavior:

1. Do not reimplement screens in native UI framework.
2. Reuse same HTML templates, Tailwind output, icons, and JS logic.
3. Track visual diff threshold per screen before release.
4. Block release if major diff exceeds approved threshold.

## Risks and Mitigation
1. Risk: Native lifecycle events can close app unexpectedly.
   - Mitigation: startup debounce + interaction-required exit logic.
2. Risk: Browser-only prompt logic leaks into app.
   - Mitigation: centralized app-mode gate.
3. Risk: Cached APK/static assets serve stale versions.
   - Mitigation: `?v={{ APP_VERSION }}` + release checklist.
4. Risk: Full native rewrite causes UX drift and slow delivery.
   - Mitigation: keep web UI source of truth and bridge native capabilities.

## Estimated Delivery (Android-first)
1. Phase 0-1: 3-5 days
2. Phase 2-3: 4-7 days
3. Phase 4-5: 5-9 days
4. Phase 6: 2-3 days

Total: ~2 to 4 weeks depending on QA depth and device matrix.

## Next Action (Immediate)
1. Approve this architecture decision: keep web UI as source of truth (no Compose/XML rewrite).
2. Start Phase 0 by generating route inventory and baseline screenshots.
3. Then execute Phase 2 startup/back hardening verification on 3 physical Android devices.

## Phase 0 Kickoff (2026-04-11)
Artifacts created under `mobile_shell_app/phase0/`:
1. `mobile_routes_manifest.json` (55-route baseline with decorators/templates)
2. `mobile_assets_baseline.json` (SHA256 freeze for CSS/JS/fonts)
3. `mobile_screenshot_checklist.md` (route-role-device capture plan)
4. `PHASE0_EXECUTION_LOG.md` (what was done, no-runtime-change proof)
