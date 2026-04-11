# Phase 2 Lifecycle Contract

Date: 2026-04-11
Branch: feature/mobile-pwa-shell-phase1

## Objectives
1. Harden launch/back lifecycle behavior.
2. Prevent unexpected app exit on startup.
3. Force external links to system browser.
4. Route deep links to exact in-app screen paths.

## Enforced Runtime Rules

### 1. Startup Back-Press Guard
- A back-handler warmup window is required after app start.
- During warmup, back events are ignored.

Contract markers:
- `backHandlerReadyAt = Date.now() + 2200`
- `if (now < backHandlerReadyAt) return`

### 2. Exit Requires Recent User Interaction
- If no recent interaction exists, back presses cannot trigger app exit.
- Double-back exit remains enabled only after interaction.

Contract markers:
- `userInteractedAt` or `lastUserInteractionMs` timestamp tracking
- stale window guard: `12 * 60 * 1000`

### 3. External Links Open System Browser
- Cross-origin HTTP/HTTPS links must not open inside app webview.
- They are delegated to Capacitor Browser plugin.

Contract marker:
- `Browser.open({ url: href })`

### 4. Deep-Link Route Normalization
- Incoming app URL intents map to an exact `/app/...` path.
- Non-app paths normalize to `/app/` fallback.

Contract markers:
- `App.addListener('appUrlOpen'`)
- path fallback to `/app/`

## Files Covered
1. `static/mobile/js/app.js`
2. `mobile_shell_app/www/shell.js`

## Validation Entry Point
- `mobile_app.tests.MobileAppPhase2LifecycleContractTests`
