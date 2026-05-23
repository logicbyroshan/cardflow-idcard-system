# Phase 1 - Product and Compliance Plan (Mobile PWA App Shell)

## Objective
Build a store-distributed mobile app (Android and iOS) that loads the existing mobile PWA in a native shell, while preserving a single web-first feature surface.

## Phase 1 Scope
1. Finalize product behavior for shell + PWA boundaries.
2. Finalize app-store compliance and policy readiness.
3. Finalize minimum native value-add required for approval and user trust.
4. Freeze acceptance criteria to enter Phase 2.

## Technical Decision (Frozen for Phase 1)
- Use Capacitor as the native shell framework.
- Keep existing PWA as primary UI and business workflow layer.
- Output artifacts:
  - Android build: AAB (and optional APK for internal testing)
  - iOS build: IPA

## Product Behavior Decisions
### 1. App Entry and Navigation
- App launches to production PWA URL only.
- Internal links remain inside shell webview.
- External links open device browser.
- Android back button rules:
  - If webview can go back: navigate back.
  - If at root route: show "Press back again to exit".

### 2. Authentication and Session
- Login remains server-side (existing backend auth).
- Cookie/session model remains unchanged unless QA reveals webview-specific issues.
- Explicit UX states must be defined for:
  - Session expired
  - Forced logout by policy
  - Network unavailable

### 3. Offline and Recovery UX
- Show branded offline screen when network is unavailable.
- Provide actions:
  - Retry now
  - Open cached data (if service worker cache can satisfy route)
- Recovery rule: auto-retry route when connectivity returns.

### 4. Branding and Trust Signals
- Native icon, splash, package name, and app display name must be finalized in Phase 1.
- App must include "About" and "Version" entry visible to users.

## Compliance Workstream
### Android (Play)
- Privacy policy URL published and reachable.
- Data safety form drafted with exact collected data categories.
- Account deletion policy checked if app login provides account creation or managed accounts.

### iOS (App Store)
- Privacy policy and support URL ready.
- App Review note drafted to explain shell + business use case.
- Minimum native value-add documented for review confidence.

## Minimum Native Value-Add (for review + user value)
At least one of these must ship in initial store submission:
1. Push notifications for workflow events.
2. Camera/file integration optimized via native bridge.
3. Biometric gate for quick secure re-entry.

## Security and Policy Requirements
1. Production endpoint must be HTTPS only.
2. No mixed-content resources.
3. Disable arbitrary file access and unsafe webview flags.
4. Explicit allowlist for navigation domains.
5. Error/analytics telemetry must not log secrets.

## Deliverables
1. Final requirements sheet (owner-approved).
2. Store metadata draft package:
   - App title/subtitle
   - Description short/long
   - Privacy policy URL
   - Support URL
3. Legal/policy checklist signed off.
4. Native value-add selection signed off.
5. Phase 2 go/no-go review note.

## RACI (Suggested)
- Product Owner: scope, UX flows, store copy approvals.
- Tech Lead: architecture freeze, security constraints.
- Backend Lead: auth/session validation assumptions.
- Frontend Lead: PWA behavior matrix and responsive checks.
- QA Lead: acceptance criteria and test matrix draft.
- Release Owner: Play/App Store account readiness.

## Acceptance Criteria to Close Phase 1
1. Framework decision is approved (Capacitor).
2. Product behavior matrix approved (entry, nav, auth, offline, back handling).
3. Compliance checklist has no unresolved blockers.
4. Native value-add selected and committed.
5. Phase 2 backlog is prioritized and estimated.

## Exit Gate
Phase 1 is complete only when all acceptance criteria are checked and approved by Product + Tech Lead.
