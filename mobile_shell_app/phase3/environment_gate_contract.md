# Phase 3 Environment Gate Contract

Date: 2026-04-11
Branch: feature/mobile-pwa-shell-phase1

## Objective
Centralize environment detection and isolate browser-only install prompts from native-only update surfaces.

## Unified Environment Gate
Global contract exposed on window:
- adarshMobileEnv.isNativeShell()
- adarshMobileEnv.isStandalonePwa()
- adarshMobileEnv.isMobileBrowser()
- adarshMobileEnv.canShowInstallCta()
- adarshMobileEnv.shouldUseNativeUpdateUi()

Source file:
- static/mobile/js/environment-gate.js

## Required Behavior
1. Install CTA is never shown inside native shell context.
2. Install CTA can appear only for browser context where install is valid.
3. Native update UI path is used only in native shell context.
4. Force-update and recommended-update overlays stay in native bridge flow.
5. Templates and scripts consume the same environment gate API.

## Files Covered
1. templates/mobile_app/base.html
2. templates/mobile_app/login.html
3. static/mobile/js/app.js
4. static/mobile/js/environment-gate.js

## Validation Entry Point
- mobile_app.tests.MobileAppPhase3EnvironmentGateContractTests
