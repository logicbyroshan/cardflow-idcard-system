# Android QA and Security Checklist (Shell + PWA)

## A. Authentication and Session
- [ ] Mobile shell login succeeds for allowed roles.
- [ ] Mobile shell login blocks revoked `perm_mobile_app` users.
- [ ] Force takeover flow still works with shell user-agent.
- [ ] Browser and shell concurrent session policy behaves as expected.

## B. Device Registry and Heartbeat
- [x] Register endpoint creates a device record on first launch.
- [x] Re-register updates existing record (same installation_id).
- [x] Ping endpoint updates `last_seen_at` and app version/build.
- [x] Invalid installation IDs are rejected with 400.

## C. App Update Policy
- [x] `MOBILE_SHELL_ANDROID_MIN_BUILD` enforces hard update.
- [x] `MOBILE_SHELL_ANDROID_LATEST_BUILD` triggers recommendation state.
- [x] Force update toggle works regardless of build value.

## D. Push Integration
- [ ] Push permission prompt appears on Android 13+.
- [ ] Token registration reaches backend endpoint.
- [ ] Notification tap deep-links to in-app route.

## E. Security Baseline
- [ ] App only loads allowed navigation hosts.
- [ ] PWA URL is HTTPS in production.
- [ ] CSRF header included on register/ping posts.
- [ ] No secrets/tokens logged in client console or server logs.

## F. UX and Navigation
- [ ] External links open in system browser.
- [ ] Android back behavior is predictable (double press to exit).
- [ ] Offline fallback screen appears when remote URL fails.

## G. Pre-release Exit Criteria
- [ ] No blocker bugs in auth, upload, card list, status update flows.
- [ ] Crash-free closed test sessions >= 99% target window.
- [ ] Version/update policy verified in staging and production config.

## H. Device Hygiene and Lifecycle
- [x] Stale active devices can be marked inactive with management command.
- [x] Old inactive device rows can be purged with explicit delete flag.
- [ ] Production scheduler is configured to run cleanup command daily.

## Automated Coverage Notes
- Mobile shell API regression tests now include register/ping upsert behavior and invalid installation ID rejection.
- Update-policy regression tests now cover required, recommended, and force-update paths.
- CI workflow runs `mobile_app.tests.MobileAppShellApiTests` alongside Android shell build checks.
- Cleanup command behavior is covered for deactivate, dry-run, and purge paths in backend tests.
