// Service Worker for Adarsh Admin PWA (website install → panel login)
// Lightweight: caches only the shell assets, network-first for everything else.

const CACHE_NAME = 'adarsh-admin-pwa-v1';
const SHELL_ASSETS = [
    '/panel/auth/login/',
    '/static/website/images/adarsh.png',
    '/static/website/images/favicon.ico',
];

// Install: pre-cache shell
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(SHELL_ASSETS))
            .catch(() => {}) // Don't block install if pre-cache fails
    );
    self.skipWaiting();
});

// Activate: purge old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: network-first, fall back to cache
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    // Never cache API calls or admin mutations
    const url = event.request.url;
    if (url.includes('/api/') || url.includes('/admin/')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Cache successful responses for offline fallback
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
