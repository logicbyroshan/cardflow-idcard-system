(function () {
    'use strict';

    var HEARTBEAT_MS = 20000;
    var LIVE_POLL_FALLBACK_MS = 5000;

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

        var tabId = getOrCreateTabId();
        var heartbeatTimer = null;

        function startHeartbeat() {
            if (heartbeatTimer) return;
            heartbeatTimer = window.setInterval(function () {
                postPresence('heartbeat', tabId, false);
            }, HEARTBEAT_MS);
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
                // Keep the session live for background tabs; only close on real page exit.
                postPresence('heartbeat', tabId, true);
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
            postPresence('stop', tabId, true);
            stopHeartbeat();
        });

        window.addEventListener('beforeunload', function () {
            postPresence('stop', tabId, true);
            stopHeartbeat();
        });

        window.addEventListener('unload', function () {
            postPresence('stop', tabId, true);
            stopHeartbeat();
        });
    }

    function updateLiveBadges(clientCount, assistantCount) {
        var clientBadge = document.getElementById('recentClientUpdatesActiveBadge');
        var assistantBadge = document.getElementById('recentClientUpdatesAssistantBadge');

        var clientSafeCount = Number.isFinite(Number(clientCount)) ? Number(clientCount) : 0;
        var assistantSafeCount = Number.isFinite(Number(assistantCount)) ? Number(assistantCount) : 0;

        if (clientBadge) {
            clientBadge.textContent = 'Live Working Clients: ' + clientSafeCount.toLocaleString();
        }

        if (assistantBadge) {
            assistantBadge.textContent = 'Live Working Assistants: ' + assistantSafeCount.toLocaleString();
        }
    }

    function refreshLiveCount() {
        var clientBadge = document.getElementById('recentClientUpdatesActiveBadge');
        var assistantBadge = document.getElementById('recentClientUpdatesAssistantBadge');
        if (!clientBadge && !assistantBadge) return;

        fetch(panelUrl('/api/presence/live-count/'), {
            method: 'GET',
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(function (resp) { return resp.ok ? resp.json() : null; })
            .then(function (data) {
                if (!data || !data.success) return;
                updateLiveBadges(data.active_clients_now, data.active_assistants_now);
            })
            .catch(function () {
                // Keep silent; this runs in the background.
            });
    }

    function startAdminLiveCountUpdates() {
        var clientBadge = document.getElementById('recentClientUpdatesActiveBadge');
        var assistantBadge = document.getElementById('recentClientUpdatesAssistantBadge');
        if (!clientBadge && !assistantBadge) return;

        var fallbackTimer = null;
        var eventSource = null;

        function startFallbackPolling() {
            if (fallbackTimer) return;
            fallbackTimer = window.setInterval(refreshLiveCount, LIVE_POLL_FALLBACK_MS);
        }

        function stopFallbackPolling() {
            if (!fallbackTimer) return;
            window.clearInterval(fallbackTimer);
            fallbackTimer = null;
        }

        function connectSSE() {
            if (typeof window.EventSource !== 'function') {
                startFallbackPolling();
                return;
            }

            eventSource = new EventSource(panelUrl('/api/presence/stream/'), { withCredentials: true });
            eventSource.addEventListener('presence', function (event) {
                try {
                    var payload = JSON.parse(event.data || '{}');
                    updateLiveBadges(payload.active_clients_now, payload.active_assistants_now);
                } catch (_err) {
                    // Ignore malformed SSE payloads.
                }
            });

            eventSource.onerror = function () {
                if (eventSource) {
                    eventSource.close();
                    eventSource = null;
                }
                window.setTimeout(connectSSE, 4000);
            };
        }

        refreshLiveCount();
        // Keep polling as a backstop for environments where SSE stays connected
        // but does not receive updates reliably (e.g., multi-worker cache split).
        startFallbackPolling();
        connectSSE();

        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                stopFallbackPolling();
                if (eventSource) {
                    eventSource.close();
                    eventSource = null;
                }
                return;
            }

            refreshLiveCount();
            startFallbackPolling();
            if (!eventSource) {
                connectSSE();
            }
        });

        window.addEventListener('beforeunload', function () {
            stopFallbackPolling();
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        startClientPresenceTracking();
        startAdminLiveCountUpdates();
    });
})();
