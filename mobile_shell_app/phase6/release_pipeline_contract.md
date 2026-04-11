# Phase 6 Release Pipeline Contract

Date: 2026-04-11
Branch: feature/mobile-pwa-shell-phase1

## Objective
Ship a repeatable Android release pipeline that produces signed APK/AAB artifacts with stable distribution paths and rollback support.

## CI Contract
Workflow:
- .github/workflows/mobile-shell-android.yml

Required workflow_dispatch inputs:
1. release_build (boolean)
2. release_version (string, optional)
3. promote_latest_apk (boolean)

Required signing secrets:
1. ANDROID_KEYSTORE_B64
2. ANDROID_KEYSTORE_PASSWORD
3. ANDROID_KEY_ALIAS
4. ANDROID_KEY_PASSWORD

## Build Outputs
When release_build=true:
1. Signed APK: mobile_shell_app/android/app/build/outputs/apk/release/app-release.apk
2. Signed AAB: mobile_shell_app/android/app/build/outputs/bundle/release/app-release.aab

## Artifact Path Policy
When promote_latest_apk=true:
1. Latest APK:
- static/website/apk/adarsh-admin.apk
2. Versioned rollback archives:
- static/website/apk/archive/adarsh-admin-<release-label>.apk
- static/website/apk/archive/adarsh-admin-<release-label>.aab

Release label source:
1. workflow input release_version when provided
2. fallback run label: run-<run_number>-<run_attempt>

## Rollback Policy
1. Never overwrite archives.
2. Only overwrite latest path:
- static/website/apk/adarsh-admin.apk
3. Roll back by redeploying a known archived artifact.

## Security Policy
1. Keystore material exists only during workflow run.
2. key.properties and release keystore are deleted in cleanup step.
3. No signing secrets committed to repository.
