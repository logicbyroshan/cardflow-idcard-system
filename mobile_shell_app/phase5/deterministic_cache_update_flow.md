# Phase 5 Deterministic Cache and Update Flow

Date: 2026-04-11
Branch: feature/mobile-pwa-shell-phase1

## Objective
Make mobile offline/cache behavior deterministic across releases while keeping rollback safety and no UI changes.

## Inputs
1. APP_VERSION from config/settings.py.
2. MOBILE_PWA_CACHE_GENERATION (integer, default 1).
3. MOBILE_PWA_CACHE_ROLLBACK_WINDOW (integer, default 2).

## Cache Namespace Contract
1. Build namespace as g{generation}-{normalized_app_version}.
2. Use cache names:
- adarsh-mobile-app-{namespace}
- adarsh-mobile-static-{namespace}
3. Keep static and shell cache keys deterministic per release.

## Route Policy Contract
1. read_only_cached routes:
- /app/manifest.json
- /app/login/
- /app/no-access/
- /app/desktop-required/
2. online_required routes:
- /app/sw.js
- all authenticated pages
- all /app/api/* routes

## Fetch Strategy Contract
1. /static/*:
- stale-while-revalidate from STATIC_CACHE.
2. /app/api/*:
- network required.
- offline fallback: deterministic JSON 503 payload.
3. read_only_cached routes:
- network-first and update APP_CACHE.
- offline fallback to cached response (or cached /app/login/).
4. all other /app/* routes:
- network required.
- offline fallback: deterministic HTML offline page.

## Rollback-Safe Invalidation Contract
1. On activate, remove old legacy caches from pre-Phase-5 naming.
2. Keep current namespace caches.
3. Keep recent namespaces within rollback window by generation.
4. Delete namespace caches older than (current_generation - rollback_window).

## Template Versioning Contract
1. Version mobile CSS/JS/manifest/SW URLs with APP_VERSION query in templates.
2. Register SW as /app/sw.js?v={{ APP_VERSION|urlencode }}.
3. Ensure static assets in SW pre-cache include deterministic ?v=<version.generation> suffixes.

## Verification
- mobile_app.tests.MobileAppPhase5OfflineCachingContractTests
