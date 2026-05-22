/**
 * Session Keepalive Module
 * ========================
 * Silently refreshes the authenticated session and CSRF token in the
 * background to prevent "security token expired" errors.
 *
 * Features:
 *   - Calls /panel/auth/api/auth/session-refresh/ every 5 minutes
 *   - Pauses when tab is hidden, resumes when visible
 *   - Updates CSRF token across all tabs via BroadcastChannel
 *   - Falls back to localStorage events for older browsers
 *   - Graceful logout redirect when session is truly expired
 *
 * @module core/session-keepalive
 * @version 1.0.0
 */
(function () {
    'use strict';

    // ── Configuration ──
    var REFRESH_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
    var LOGIN_URL = '/panel/auth/login/';
    var CHANNEL_NAME = 'adarsh_session_sync';

    function getRefreshUrl() {
        if (typeof window.getSessionRefreshUrl === 'function') {
            return window.getSessionRefreshUrl();
        }
        if (window.location.pathname.indexOf('/panel/') === 0) {
            return '/panel/auth/api/auth/session-refresh/';
        }
        if (window.location.pathname.indexOf('/app/') === 0) {
            return '/app/auth/api/auth/session-refresh/';
        }
        return '/auth/api/auth/session-refresh/';
    }

    // Skip on login page
    if (window.location.pathname.indexOf('/auth/login') !== -1) return;

    // ── State ──
    var _timerId = null;
    var _isRefreshing = false;
    var _channel = null;

    // ── BroadcastChannel (multi-tab sync) ──
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            _channel = new BroadcastChannel(CHANNEL_NAME);
            _channel.onmessage = function (event) {
                var data = event.data;
                if (!data || !data.type) return;

                if (data.type === 'csrf-update' && data.token) {
                    _applyCsrfToken(data.token);
                }
                if (data.type === 'session-expired') {
                    _handleSessionExpired('Another tab detected session expiry');
                }
            };
        }
    } catch (e) {
        // BroadcastChannel not supported — fall back to localStorage
    }

    // Fallback: listen for localStorage changes from other tabs
    if (!_channel) {
        try {
            window.addEventListener('storage', function (e) {
                if (e.key === '_adarsh_csrf_token' && e.newValue) {
                    _applyCsrfToken(e.newValue);
                }
                if (e.key === '_adarsh_session_expired' && e.newValue === 'true') {
                    _handleSessionExpired('Another tab detected session expiry');
                }
            });
        } catch (e) {
            // Storage not available
        }
    }

    // ── CSRF Token Helpers ──

    /**
     * Apply a new CSRF token everywhere it's used.
     * - Update the csrftoken cookie (Django reads it automatically)
     * - Update <meta name="csrf-token"> tag (used by getCSRFToken())
     * - Update hidden input (if present on a form)
     */
    function _applyCsrfToken(token) {
        if (!token) return;

        // Update meta tag
        var meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) meta.setAttribute('content', token);

        // Update any hidden inputs
        var hiddens = document.querySelectorAll('input[name="csrfmiddlewaretoken"]');
        for (var i = 0; i < hiddens.length; i++) {
            hiddens[i].value = token;
        }
    }

    /**
     * Broadcast CSRF token to other tabs.
     */
    function _broadcastCsrfUpdate(token) {
        if (_channel) {
            try { _channel.postMessage({ type: 'csrf-update', token: token }); } catch (e) {}
        } else {
            try { localStorage.setItem('_adarsh_csrf_token', token + '_' + Date.now()); } catch (e) {}
        }
    }

    /**
     * Broadcast session expired to other tabs.
     */
    function _broadcastSessionExpired() {
        if (_channel) {
            try { _channel.postMessage({ type: 'session-expired' }); } catch (e) {}
        } else {
            try { localStorage.setItem('_adarsh_session_expired', 'true'); } catch (e) {}
        }
    }

    // ── Session Expired Handler ──

    function _handleSessionExpired(reason) {
        if (typeof window.showToast === 'function') {
            window.showToast('Your session ended — you may have logged in on another device. Redirecting to login...', 'warning', 3000);
        }
        setTimeout(function () {
            window.location.href = LOGIN_URL;
        }, 2000);
    }

    // ── Core Refresh Logic ──

    function _refreshSession() {
        if (_isRefreshing) return;
        if (!navigator.onLine) return;

        _isRefreshing = true;

        var xhr = new XMLHttpRequest();
        xhr.open('GET', getRefreshUrl(), true);
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.timeout = 10000;

        xhr.onload = function () {
            _isRefreshing = false;

            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.success && data.csrf_token) {
                        _applyCsrfToken(data.csrf_token);
                        _broadcastCsrfUpdate(data.csrf_token);
                    }
                } catch (e) {
                    // JSON parse error — ignore, session is still valid
                }
            } else if (xhr.status === 401) {
                // Session truly expired — redirect to login
                _broadcastSessionExpired();
                _stopKeepalive();
                _handleSessionExpired('Session refresh returned 401');
            }
            // Other status codes (429, 500): silently ignore, retry on next interval
        };

        xhr.onerror = function () {
            _isRefreshing = false;
            // Network error — silently ignore, retry on next interval
        };

        xhr.ontimeout = function () {
            _isRefreshing = false;
        };

        xhr.send();
    }

    // ── Timer Management ──

    function _startKeepalive() {
        if (_timerId) return;
        _timerId = setInterval(_refreshSession, REFRESH_INTERVAL_MS);
    }

    function _stopKeepalive() {
        if (!_timerId) return;
        clearInterval(_timerId);
        _timerId = null;
    }

    // ── Visibility Handling ──
    // Pause polling when tab is hidden, resume + immediate refresh when visible

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            _stopKeepalive();
        } else {
            // Tab became visible — do an immediate refresh, then restart interval
            _refreshSession();
            _startKeepalive();
        }
    });

    // ── Initialization ──
    // Refresh once on load so an already-stale session is detected early.
    // Then continue with the normal 5-minute keepalive interval.
    _refreshSession();
    _startKeepalive();

    // Expose for external use (e.g., api.js CSRF recovery)
    window._sessionKeepalive = {
        refresh: _refreshSession,
        isRefreshing: function () { return _isRefreshing; }
    };

})();
