/**
 * error-monitor.js — Client-side error aggregation and reporting
 *
 * Captures:
 *   1. Uncaught JS errors (window 'error' event)
 *   2. Unhandled promise rejections
 *   3. HTMX response errors (4xx/5xx)
 *   4. Resource load failures (img/script/link)
 *
 * Stores last 50 errors in window.Adarsh.errors ring buffer.
 * Optional: POST to /panel/api/client-errors/ for server-side logging.
 *
 * Console API:
 *   Adarsh.errors.list()     — array of collected errors
 *   Adarsh.errors.summary()  — formatted text summary
 *   Adarsh.errors.flush()    — POST errors to server, clear buffer
 *   Adarsh.errors.clear()    — clear buffer without reporting
 */
(function () {
    'use strict';

    var ns = window.Adarsh = window.Adarsh || {};
    var MAX_ERRORS = 50;
    var _buffer = [];
    var REPORT_URL = '/panel/api/client-errors/';

    // ── Helpers ──
    function _push(entry) {
        entry.timestamp = new Date().toISOString();
        entry.url = window.location.pathname;
        entry.userAgent = navigator.userAgent;
        _buffer.push(entry);
        if (_buffer.length > MAX_ERRORS) _buffer.shift();
    }

    function _getCSRF() {
        var el = document.querySelector('[name=csrfmiddlewaretoken]');
        if (el) return el.value;
        var m = document.cookie.match(/csrftoken=([^;]+)/);
        return m ? m[1] : '';
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. UNCAUGHT JS ERRORS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    window.addEventListener('error', function (evt) {
        // Resource load errors (img, script, link) — different structure
        if (evt.target && evt.target !== window && evt.target.tagName) {
            _push({
                type: 'resource',
                tag: evt.target.tagName.toLowerCase(),
                src: evt.target.src || evt.target.href || '(unknown)',
            });
            return;
        }

        _push({
            type: 'error',
            message: evt.message || '(no message)',
            source: evt.filename || '(unknown)',
            line: evt.lineno || 0,
            col: evt.colno || 0,
            stack: evt.error && evt.error.stack ? evt.error.stack.substring(0, 500) : '',
        });
    }, true); // useCapture: true to catch resource errors on elements

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. UNHANDLED PROMISE REJECTIONS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    window.addEventListener('unhandledrejection', function (evt) {
        var reason = evt.reason;
        _push({
            type: 'rejection',
            message: reason && reason.message ? reason.message : String(reason || '(unknown)'),
            stack: reason && reason.stack ? reason.stack.substring(0, 500) : '',
        });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. HTMX RESPONSE ERRORS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    document.body.addEventListener('htmx:responseError', function (evt) {
        var xhr = evt.detail.xhr;
        _push({
            type: 'htmx',
            status: xhr ? xhr.status : 0,
            path: evt.detail.pathInfo?.requestPath || '(unknown)',
            method: (evt.detail.requestConfig?.verb || 'GET').toUpperCase(),
        });
    });

    document.body.addEventListener('htmx:sendError', function (evt) {
        _push({
            type: 'htmx-network',
            path: evt.detail.pathInfo?.requestPath || '(unknown)',
            method: (evt.detail.requestConfig?.verb || 'GET').toUpperCase(),
        });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. PUBLIC API — window.Adarsh.errors
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    ns.errors = {
        /** Return copy of error buffer */
        list: function () {
            return _buffer.slice();
        },

        /** Formatted text summary */
        summary: function () {
            if (_buffer.length === 0) return 'No errors captured.';

            var counts = {};
            for (var i = 0; i < _buffer.length; i++) {
                var t = _buffer[i].type;
                counts[t] = (counts[t] || 0) + 1;
            }

            var parts = ['── Error Summary (' + _buffer.length + ' total) ──'];
            for (var key in counts) {
                if (counts.hasOwnProperty(key)) {
                    parts.push('  ' + key + ': ' + counts[key]);
                }
            }

            // Show last 5 errors
            parts.push('');
            parts.push('Recent errors:');
            var start = Math.max(0, _buffer.length - 5);
            for (var j = start; j < _buffer.length; j++) {
                var e = _buffer[j];
                var desc = e.type;
                if (e.message) desc += ': ' + e.message;
                else if (e.status) desc += ' ' + e.status + ' ' + e.path;
                else if (e.src) desc += ' ' + e.tag + ' ' + e.src;
                parts.push('  [' + e.timestamp + '] ' + desc);
            }

            return parts.join('\n');
        },

        /** POST errors to server and clear buffer */
        flush: function () {
            if (_buffer.length === 0) return Promise.resolve({ sent: 0 });

            var payload = _buffer.slice();
            var csrf = _getCSRF();

            return fetch(REPORT_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrf,
                },
                body: JSON.stringify({ errors: payload }),
                credentials: 'same-origin',
            }).then(function (resp) {
                if (resp.ok) {
                    _buffer.length = 0;
                    return { sent: payload.length };
                }
                throw new Error('Server returned ' + resp.status);
            });
        },

        /** Clear buffer without reporting */
        clear: function () {
            _buffer.length = 0;
        },
    };

})();
