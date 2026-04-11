# Phase 6 Release Smoke Checklist

Date: 2026-04-11

## Device Matrix
1. Android 13+ phone (primary)
2. Android 12 phone (secondary)
3. Android tablet (optional)

## Pre-Release Checks
- [ ] Signed APK and AAB artifacts exist in CI run outputs.
- [ ] Backend version policy vars are set:
  - [ ] MOBILE_SHELL_ANDROID_LATEST_BUILD
  - [ ] MOBILE_SHELL_ANDROID_LATEST_VERSION
  - [ ] MOBILE_SHELL_ANDROID_MIN_BUILD (only when force cutoff needed)
- [ ] Latest APK policy path is published:
  - [ ] static/website/apk/adarsh-admin.apk
- [ ] Archive artifacts are preserved under static/website/apk/archive/.

## Functional Smoke
- [ ] App launches without immediate close.
- [ ] Login works for supported roles.
- [ ] Core routes load:
  - [ ] /app/
  - [ ] /app/clients/
  - [ ] /app/table/<id>/<status>/
  - [ ] /app/camera/<table_id>/
- [ ] Push registration succeeds on Android 13+.
- [ ] Camera/gallery upload works.
- [ ] Offline-required pages show deterministic offline response.

## Security and Stability
- [ ] External links open in system browser.
- [ ] Back button behavior follows shell guardrails.
- [ ] No fatal JS bridge errors in runtime logs.
- [ ] No crash/ANR spike during internal rollout.

## Rollout Gates
- [ ] 5% rollout complete with stable metrics.
- [ ] 20% rollout complete with stable metrics.
- [ ] 50% rollout complete with stable metrics.
- [ ] 100% rollout approved after 24h stable window.
