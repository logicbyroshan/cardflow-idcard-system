// Service Worker for Mobile PWA (ID Card Manager)
// Scope: '/' — covers /app/ pages AND /auth/login/ so login stays in-app.
// Network-first strategy; only caches static shell assets for offline fallback.
const CACHE_NAME = 'idcard-mobile-v8';
const STATIC_ASSETS = [
    '/app/',
];

// Install: cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .catch(() => {}) // Don't block install if pre-cache fails
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch: network-first, only cache GET requests for static/app assets
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    // Skip cross-origin requests entirely (e.g., 127.0.0.1:4765 engine)
    const reqUrl = new URL(event.request.url);
    if (reqUrl.origin !== self.location.origin) return;

    // Never cache API calls, admin panel pages, media files, or auth pages
    if (reqUrl.pathname.includes('/api/') || reqUrl.pathname.includes('/admin/') || reqUrl.pathname.includes('/media/') || reqUrl.pathname.includes('/auth/')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() =>
                caches.match(event.request).then(cached =>
                    cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
                )
            )
    );
});
