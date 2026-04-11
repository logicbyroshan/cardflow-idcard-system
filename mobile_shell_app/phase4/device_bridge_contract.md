# Phase 4 Device Bridge Contract

Date: 2026-04-11
Branch: feature/mobile-pwa-shell-phase1

## Objective
Expand native device capability bridge without changing UI layouts.

## Contract Surface
Global bridge on window:
- adarshDeviceBridge.pickImage(options)
- adarshDeviceBridge.enqueueCriticalJson(url, payload, options)
- adarshDeviceBridge.flushCriticalQueue()
- adarshDeviceBridge.uploadFormDataWithRetry(url, formDataFactory, options)

Source file:
- static/mobile/js/device-bridge.js

## Required Runtime Behavior
1. Camera/gallery picker interop
- Native shell should attempt Capacitor camera/gallery picker first.
- Browser fallback must continue using file inputs.

2. Critical JSON queue
- Device registration/ping/push-token updates queue when offline.
- Queue flushes on reconnect, interval, and app resume.

3. Push lifecycle hardening
- Registration listeners bind once.
- Registration refresh runs on app resume and periodic interval.
- Registration errors do not break UX.

4. Upload reliability
- Camera and website media uploads use retry-capable upload helper.
- Offline upload failure returns deterministic user-safe error message.

## Files Covered
1. static/mobile/js/device-bridge.js
2. static/mobile/js/app.js
3. templates/mobile_app/camera.html
4. templates/mobile_app/website_manage.html
5. templates/mobile_app/base.html

## Validation Entry Point
- mobile_app.tests.MobileAppPhase4DeviceBridgeContractTests
