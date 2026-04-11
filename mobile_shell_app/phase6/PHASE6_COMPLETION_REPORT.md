# Phase 6 Completion Report

Date: 2026-04-11
Branch: feature/mobile-pwa-shell-phase1
Status: Completed

## Goal
Complete Phase 6 from Android conversion plan:
1. CI build pipeline for signed APK/AAB.
2. Stable artifact path policy for latest + rollback archive.
3. Release checklist for real-device smoke.
4. Staged rollout and crash/ANR monitoring plan.

## Delivered

1. Signed release pipeline in CI
- Updated .github/workflows/mobile-shell-android.yml to support on-demand signed release builds.
- Added workflow inputs for release control and artifact promotion.
- Added strict signing-secret checks before release build execution.

2. Signed APK/AAB outputs
- Release flow now builds:
  - app-release.apk
  - app-release.aab
- Outputs are uploaded as CI artifacts.

3. Stable artifact path policy
- Optional promotion step now produces:
  - static/website/apk/adarsh-admin.apk (latest)
  - static/website/apk/archive/adarsh-admin-<release-label>.apk|.aab (rollback archive)

4. Build signing integration
- Updated mobile_shell_app/android/app/build.gradle to use key.properties for release signing when provided.

5. Rollout and smoke process
- Added phase6/release_smoke_checklist.md.
- Added phase6/rollout_monitoring_plan.md with crash/ANR thresholds and stage gates.

6. Release contract docs
- Added phase6/release_pipeline_contract.md.
- Updated mobile_shell_app/README.md and docs/mobile-shell/ANDROID_RELEASE_PIPELINE.md.

## Validation
1. python manage.py test mobile_app.tests.MobileAppPhase6ReleasePipelineContractTests
2. python manage.py check

## Outcome
Phase 6 is fully implemented with an auditable signed release pipeline, stable artifact path policy, and staged rollout monitoring guidance.
