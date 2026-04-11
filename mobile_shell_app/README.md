# Adarsh Mobile Shell App (Capacitor)

This folder contains a native app shell that loads the existing mobile PWA URL.

## Why this approach
- One primary feature surface stays in the PWA.
- Users install from Play Store/App Store and get app-like behavior.
- Native bridge remains available for push notifications and device capabilities.

## Prerequisites
- Node.js 18+
- npm 9+
- Android Studio (for Android builds)
- Xcode on macOS (for iOS builds)

## Quick start
1. Copy environment file:
   - `.env.example` -> `.env`
2. Install dependencies:
   - `npm install`
3. Validate config:
   - `npm run doctor`
4. Add platforms (first time only):
   - `npx cap add android`
   - `npx cap add ios`
5. Sync and open native projects:
   - `npm run open:android`
   - `npm run open:ios`

## Environment variables
- `APP_NAME`: display name for native app
- `APP_ID`: native bundle identifier/package ID
- `PWA_URL`: production PWA URL loaded in the shell
- `PWA_DEV_URL`: optional local debug URL
- `ANDROID_SCHEME`: default `https`

## Behavior currently implemented
1. Remote PWA URL loading via Capacitor `server.url`.
2. Strict navigation allowlist for known domains.
3. Local fallback page (`offline.html`) when remote URL fails.
4. Android back behavior with double-tap exit when no history is available.
5. Network listener hook for online/offline state diagnostics.

## Release flow
### Android
1. `npm run sync`
2. `npx cap open android`
3. Build signed `AAB` in Android Studio.
4. Upload to Play Console internal testing.

### iOS (macOS only)
1. `npm run sync`
2. `npx cap open ios`
3. Archive in Xcode.
4. Upload to TestFlight / App Store Connect.

## Security baseline
1. Keep `PWA_URL` as HTTPS only.
2. Keep `allowNavigation` restricted to owned domains.
3. Avoid enabling cleartext in production.
