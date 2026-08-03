# Android-Only Execution Plan and Completion Notes (Phase 2 to 7)

This document tracks execution after Phase 1 for Android rollout only.

iOS scope is intentionally deferred.

## Phase 2 - PWA Hardening for Shell Runtime
Status: Implemented

Delivered:
1. Android shell bridge integration in mobile PWA script:
   - external-link handling via system browser
   - app update policy check against backend config endpoint
   - device registration and heartbeat hooks
2. Backend policy endpoint for app version/build validation.
3. Backend device registry model for authenticated Android installations.

Validation:
1. Mobile shell API tests added.
2. Capacitor Android sync verified.

## Phase 3 - App Shell Setup
Status: Implemented (extended)

Delivered:
1. Capacitor Android project scaffold committed.
2. Environment-driven app identity and URL config.
3. Android intent-filter for deep-link host and path.
4. Branded launch and offline fallback screens with retry/support actions and live network state.

Validation:
1. `npm run verify` succeeds in mobile shell app folder.

## Phase 4 - Native Integrations
Status: Implemented (Android)

Delivered:
1. Push notification runtime registration flow in mobile PWA bridge.
2. Push token upload to backend registry endpoint.
3. Android back-button handling with double-press exit UX.
4. External HTTP/HTTPS links forced to system browser.

Deferred:
1. FCM server-side outbound message orchestration.
2. Any iOS-specific capability.

## Phase 5 - QA and Security
Status: Implemented (extended)

Delivered:
1. API-level tests for shell config/register/ping routes.
2. Device record model with per-user+installation uniqueness.
3. Server policy settings for minimum and latest Android build.
4. API tests for invalid installation IDs and update-required/recommended policy behavior.
5. API tests for force-update toggle behavior.
6. CI workflow now runs backend shell API regression tests.

Operational checklist:
1. Run targeted mobile tests in CI/staging.
2. Validate login/session behavior for shell + browser parallel usage.
3. Validate forced update behavior using low app build values.

## Phase 6 - Release Pipeline
Status: Implemented (Android)

Delivered:
1. Android-focused npm scripts:
   - sync:android
   - open:android
   - run:android
   - build:android:debug
2. Release runbook documented in `ANDROID_RELEASE_PIPELINE.md`.

## Phase 7 - Rollout and Monitoring
Status: Implemented (extended + automation)

Delivered:
1. Device heartbeat endpoint for active-install tracking.
2. Mobile device metadata storage (model/version/build/ip/last_seen).
3. Rollout monitoring playbook documented in `ANDROID_QA_SECURITY_CHECKLIST.md`.
4. Device summary monitoring endpoint for elevated roles:
   - active 24h / 7d
   - stale 30d
   - top observed build versions
5. Management command added to deactivate stale devices and purge aged inactive rows.

Go-live recommendation:
1. Closed testing (Play internal/closed track) for first 20-50 users.
2. Promote after 7 days of stable crash and auth metrics.

## Deferred Scope Register
1. iOS packaging and TestFlight flow.
2. Apple review compliance workflows.
3. CocoaPods/Xcode build hardening.
