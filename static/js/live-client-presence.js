(function () {
    'use strict';

    var HEARTBEAT_MS = 60000;
    var HEARTBEAT_MOBILE_MS = 180000;

    function panelUrl(path) {
        if (!path) return path;
        if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) return path;
        var pathname = String(window.location.pathname || '');
        var needsPanelPrefix = pathname.indexOf('/panel/') === 0
            || pathname === '/panel'
            || pathname.indexOf('/app/') === 0
            || pathname === '/app';
        var base = needsPanelPrefix ? '/panel' : '';
        var normalized = path.charAt(0) === '/' ? path : '/' + path;
        return base + normalized;
    }

    function getCSRFToken() {
        if (typeof window.getCSRFToken === 'function') {
            return window.getCSRFToken() || '';
        }

        var meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) return meta.getAttribute('content') || '';

        var match = (document.cookie || '').match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function getOrCreateTabId() {
        var key = 'adarsh_presence_tab_id';
        try {
            var existing = sessionStorage.getItem(key);
            if (existing) return existing;
            var next = 'tab_' + Math.random().toString(36).slice(2, 12) + '_' + Date.now().toString(36);
            sessionStorage.setItem(key, next);
            return next;
        } catch (_err) {
            return 'tab_fallback_' + Date.now().toString(36);
        }
    }

    function postPresence(action, tabId, useBeacon) {
        var url = panelUrl('/api/presence/track/');
        var csrf = getCSRFToken();
        var shouldUseBeacon = !!useBeacon && !!navigator.sendBeacon;

        if (shouldUseBeacon) {
            try {
                var params = new URLSearchParams();
                params.append('action', action);
                params.append('tab_id', tabId);
                params.append('csrfmiddlewaretoken', csrf);
                navigator.sendBeacon(url, params);
            } catch (_err) {
                // Ignore beacon errors and rely on keepalive fetch fallback.
            }
        }

        fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            keepalive: !!useBeacon,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrf,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ action: action, tab_id: tabId })
        }).catch(function () {
            // Presence transport should never block UI flows.
        });

        return true;
    }

    function startClientPresenceTracking() {
        var body = document.body;
        var role = String((body && body.getAttribute('data-user-role')) || '').toLowerCase();
        if (role !== 'client' && role !== 'client_staff') return;

        var pathname = String(window.location.pathname || '');
        var isMobileSurface = pathname.indexOf('/app/') === 0 || pathname === '/app';
        var heartbeatMs = isMobileSurface ? HEARTBEAT_MOBILE_MS : HEARTBEAT_MS;

        var tabId = getOrCreateTabId();
        var heartbeatTimer = null;

        function startHeartbeat() {
            if (heartbeatTimer) return;
            heartbeatTimer = window.setInterval(function () {
                // Always send periodic heartbeats. When the page is backgrounded,
                // prefer beacon transport so the OS can deliver them reliably.
                var useBeacon = !!document.hidden;
                postPresence('heartbeat', tabId, useBeacon);
            }, heartbeatMs);
        }

        function stopHeartbeat() {
            if (!heartbeatTimer) return;
            window.clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }

        postPresence('start', tabId, false);
        startHeartbeat();

        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                // Send an immediate beaconed heartbeat when backgrounding.
                postPresence('heartbeat', tabId, true);
                // Keep the interval running so periodic beacon heartbeats continue
                // while backgrounded (important for long-running work).
                return;
            }
            postPresence('heartbeat', tabId, false);
            startHeartbeat();
        });

        window.addEventListener('pageshow', function () {
            postPresence('start', tabId, false);
            startHeartbeat();
        });

        window.addEventListener('pagehide', function () {
            stopHeartbeat();
            // Always attempt to send a stop via beacon so server marks session closed.
            postPresence('stop', tabId, true);
        });

        if (!isMobileSurface) {
            window.addEventListener('beforeunload', function () {
                postPresence('stop', tabId, true);
                stopHeartbeat();
            });

            window.addEventListener('unload', function () {
                postPresence('stop', tabId, true);
                stopHeartbeat();
            });
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        startClientPresenceTracking();
    });
})();
