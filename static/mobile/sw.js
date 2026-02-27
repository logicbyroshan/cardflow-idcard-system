// Service Worker for Mobile PWA (ID Card Manager)
// Scope: '/' — covers /app/ pages AND /auth/login/ so login stays in-app.
// Network-first strategy; only caches static shell assets for offline fallback.
const CACHE_NAME = 'idcard-mobile-v5';
const STATIC_ASSETS = [
    '/app/',
    '/static/mobile/css/mobile.css',
    '/static/mobile/js/app.js',
    '/static/js/mobile/list-app.js',
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

    const url = event.request.url;
    // Never cache API calls, admin panel pages, media files, or auth pages
    if (url.includes('/api/') || url.includes('/admin/') || url.includes('/media/') || url.includes('/auth/')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
