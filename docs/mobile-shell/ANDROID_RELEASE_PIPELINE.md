# Android Release Pipeline - Adarsh Panel Shell

## 1. Build Prerequisites
1. Java 17 installed.
2. Android Studio + SDK setup complete.
3. Play Console app created for package `in.adarshbhopal.panel1804`.
4. `.env` configured in `mobile_shell_app`.

## 2. Local Build Flow
1. Go to `mobile_shell_app`.
2. Install deps: `npm install`.
3. Verify setup: `npm run verify`.
4. Open Android Studio project: `npm run open:android`.
5. Build signed release AAB from Android Studio.

## 3. Versioning Rules
1. Increment Android `versionCode` every Play upload.
2. Keep `versionName` aligned with backend shell policy values.
3. Update backend env:
   - `MOBILE_SHELL_ANDROID_LATEST_BUILD`
   - `MOBILE_SHELL_ANDROID_LATEST_VERSION`
   - `MOBILE_SHELL_ANDROID_MIN_BUILD` (only when forcing cutoff)

## 4. Release Tracks
1. Internal testing: smoke test quickly.
2. Closed testing: limited real users.
3. Production rollout: staged percentage rollout.

## 5. Rollback Strategy
1. Keep previous stable AAB in Play track history.
2. If severe issue appears:
   - halt rollout
   - raise `MOBILE_SHELL_ANDROID_MIN_BUILD` only if needed
   - ship hotfix build with incremented versionCode

## 6. Observability During Rollout
1. Track auth failures, upload failures, and status update errors.
2. Track active device heartbeat counts and stale device records.
3. Track push registration success volume by day.

## 7. CI Quality Gates
1. Android shell workflow builds a debug APK artifact on every shell/backend change.
2. Backend gate runs `mobile_app.tests.MobileAppShellApiTests` to validate config/register/ping/summary behavior.
3. Merge only when both Android build and backend mobile-shell tests pass.

## 8. Device Lifecycle Cleanup
1. Dry-run audit:
   - `python manage.py cleanup_mobile_devices --stale-days 30 --delete-days 120 --delete-inactive --dry-run`
2. Apply cleanup:
   - `python manage.py cleanup_mobile_devices --stale-days 30 --delete-days 120 --delete-inactive`
3. Recommended production schedule:
   - run once daily during low-traffic window.
