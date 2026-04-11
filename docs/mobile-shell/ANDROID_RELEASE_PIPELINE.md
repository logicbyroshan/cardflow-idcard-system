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
   - `MOBILE_SHELL_ANDROID_UPDATE_URL`
   - `MOBILE_SHELL_ANDROID_MIN_BUILD` (only when forcing cutoff)

## 3.1 In-App Profile Update Button
1. Profile page button calls runtime update flow and opens `MOBILE_SHELL_ANDROID_UPDATE_URL` in native shell.
2. Keep this URL pointed to the latest approved APK or managed update landing page.
3. If URL is missing/unreachable, app falls back to in-app cache refresh only.

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

## 9. Signed Release Automation (Phase 6)
1. Use `workflow_dispatch` on `Android Mobile Shell CI` with `release_build=true`.
2. Configure repository secrets:
   - `ANDROID_KEYSTORE_B64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`
3. Workflow builds signed outputs:
   - `app-release.apk`
   - `app-release.aab`
4. Optional policy path promotion (`promote_latest_apk=true`):
   - Latest: `static/website/apk/adarsh-admin.apk`
   - Rollback archive: `static/website/apk/archive/adarsh-admin-<release-label>.apk|.aab`

## 10. Staged Rollout and Monitoring Targets
1. Stage percentages:
   - 5% (4-6 hours)
   - 20% (24 hours)
   - 50% (24 hours)
   - 100% after stability checks
2. Halt criteria:
   - Crash-free sessions < 99.0%
   - ANR rate > 0.47%
   - Login/auth API failures > 2x baseline
3. Promotion criteria:
   - No P0/P1 regression in smoke checklist
   - Crash and ANR trend stable for 24 hours at current stage

## 11. Phase 7 Rollout Guard Automation
1. Run executable gate check before each stage promotion:
   - `python manage.py mobile_rollout_guard --crash-free-sessions <value> --anr-rate <value> --auth-failure-rate <value> --auth-failure-baseline <value> --upload-failure-rate <value> --upload-failure-baseline <value> --strict`
2. Optional heartbeat guard:
   - add `--max-stale-30d <count>` to cap stale-device drift.
3. Use `--include-inactive` for broader trend review when triaging incidents.
4. Command emits JSON report for release notes evidence.
5. In strict mode, any failed gate returns non-zero and blocks promotion.

## 12. Phase 8 Final Preflight and Nice-to-Have Closure
1. Run final preflight immediately before production stage promotion:
   - `python manage.py mobile_release_preflight --strict --require-local-apk`
2. Archive JSON output in release notes with rollout guard output.
3. Keep profile-page update status card enabled for operator self-check.
4. If preflight fails, block promotion and fix env/build policy mismatch first.

## 8. Device Lifecycle Cleanup
1. Dry-run audit:
   - `python manage.py cleanup_mobile_devices --stale-days 30 --delete-days 120 --delete-inactive --dry-run`
2. Apply cleanup:
   - `python manage.py cleanup_mobile_devices --stale-days 30 --delete-days 120 --delete-inactive`
3. Recommended production schedule:
   - run once daily during low-traffic window.
