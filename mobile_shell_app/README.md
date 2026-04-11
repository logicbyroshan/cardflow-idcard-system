# Adarsh Mobile Shell App (Capacitor)

This folder contains a native app shell that loads the existing mobile PWA URL.

Current scope: Android-first rollout. iOS work is intentionally deferred.

## Why this approach
- One primary feature surface stays in the PWA.
- Users install from Play Store and get app-like behavior.
- Native bridge remains available for push notifications and device capabilities.

## Prerequisites
- Node.js 18+
- npm 9+
- Android Studio (for Android builds)

## Quick start
1. Copy environment file:
   - `.env.example` -> `.env`
2. Install dependencies:
   - `npm install`
3. Validate config:
   - `npm run doctor`
4. Add Android platform (first time only):
   - `npx cap add android`
5. Sync and open native project:
   - `npm run open:android`

## Environment variables
- `APP_NAME`: display name for native app
- `APP_ID`: native bundle identifier/package ID
- `PWA_URL`: production PWA URL loaded in the shell
- `PWA_DEV_URL`: optional local debug URL
- `CAP_SHELL_USE_DEV_URL`: set `1` to load `PWA_DEV_URL`
- `ANDROID_SCHEME`: default `https`

## Behavior currently implemented
1. Remote PWA URL loading via Capacitor `server.url`.
2. Strict navigation allowlist for known domains.
3. Branded local fallback screens (`index.html` + `offline.html`) with retry, support, and web-open actions.
4. Android back behavior with double-tap exit when no history is available.
5. Android deep-link intent routing for `panel.adarshbhopal.in/app`.
6. Push-notification token capture and backend device registration (through PWA bridge).
7. External links open in system browser from app shell context.

## Release flow
### Android
1. `npm run sync:android`
2. `npx cap open android`
3. Build signed `AAB` in Android Studio.
4. Upload to Play Console internal testing.

### GitHub Actions signed release (Phase 6)
1. Run workflow: `Android Mobile Shell CI` via `workflow_dispatch`.
2. Set `release_build=true`.
3. Optionally set:
   - `release_version` (example: `1.0.0-build12`)
   - `promote_latest_apk=true`
4. Required repository secrets:
   - `ANDROID_KEYSTORE_B64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`
5. Workflow outputs:
   - Signed release APK + AAB artifact upload.
   - When promotion is enabled:
     - Latest APK policy path: `static/website/apk/adarsh-admin.apk`
     - Versioned rollback archive: `static/website/apk/archive/adarsh-admin-<release-label>.apk|.aab`

## Backend dependencies
The shell bridge expects these endpoints in Django mobile app:
1. `GET /app/api/mobile-shell/config/`
2. `POST /app/api/mobile-shell/device/register/`
3. `POST /app/api/mobile-shell/device/ping/`

## Security baseline
1. Keep `PWA_URL` as HTTPS only.
2. Keep `allowNavigation` restricted to owned domains.
3. Avoid enabling cleartext in production.
