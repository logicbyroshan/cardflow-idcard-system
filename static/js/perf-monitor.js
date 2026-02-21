/**
 * perf-monitor.js — Lightweight runtime performance monitor
 *
 * Tracks:
 *   1. Navigation Timing (page-load metrics)
 *   2. HTMX request durations (flags slow requests >1s)
 *   3. Long Tasks (>50ms main-thread blocks)
 *   4. Server-Timing header from responses
 *
 * All data stored in window.Adarsh.perf — zero UI.
 * Access via console: Adarsh.perf.summary()
 *
 * Activated automatically. Debug-level console output only when
 * window.Adarsh.debug === true.
 */
(function () {
    'use strict';

    var ns = window.Adarsh = window.Adarsh || {};

    // ── Config ──
    var SLOW_HTMX_MS = 1000;       // warn threshold for HTMX requests
    var MAX_ENTRIES = 100;          // ring-buffer size per category
    var LONG_TASK_MS = 50;          // PerformanceObserver threshold (browser default)

    // ── State ──
    var _navTiming = null;
    var _htmxLog = [];              // { url, method, ms, serverMs, slow }
    var _longTasks = [];            // { start, duration }
    var _pendingHtmx = new Map();   // elt → { url, method, t0 }

    // ── Helpers ──
    function _push(arr, entry) {
        arr.push(entry);
        if (arr.length > MAX_ENTRIES) arr.shift();
    }

    function _debug() {
        if (ns.debug && typeof console !== 'undefined') {
            console.warn.apply(console, arguments);
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. NAVIGATION TIMING
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function _captureNavTiming() {
        var entries = performance.getEntriesByType('navigation');
        if (!entries || !entries.length) return;
        var nav = entries[0];
        _navTiming = {
            dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
            tcp: Math.round(nav.connectEnd - nav.connectStart),
            ttfb: Math.round(nav.responseStart - nav.requestStart),
            download: Math.round(nav.responseEnd - nav.responseStart),
            domParse: Math.round(nav.domInteractive - nav.responseEnd),
            domReady: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
            load: Math.round(nav.loadEventEnd - nav.startTime),
            transferSize: nav.transferSize || 0,
        };
    }

    // Capture after load event completes
    if (document.readyState === 'complete') {
        _captureNavTiming();
    } else {
        window.addEventListener('load', function () {
            // Wait one frame so loadEventEnd is populated
            requestAnimationFrame(function () {
                requestAnimationFrame(_captureNavTiming);
            });
        });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. HTMX REQUEST TIMING
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    document.body.addEventListener('htmx:beforeRequest', function (evt) {
        var elt = evt.detail.elt;
        var path = evt.detail.pathInfo?.requestPath || evt.detail.path || '';
        var method = (evt.detail.verb || evt.detail.requestConfig?.verb || 'GET').toUpperCase();
        _pendingHtmx.set(elt, { url: path, method: method, t0: performance.now() });
    });

    document.body.addEventListener('htmx:afterRequest', function (evt) {
        var elt = evt.detail.elt;
        var pending = _pendingHtmx.get(elt);
        if (!pending) return;
        _pendingHtmx.delete(elt);

        var ms = Math.round(performance.now() - pending.t0);
        var slow = ms >= SLOW_HTMX_MS;

        // Parse Server-Timing header if available
        // Format: total;dur=X, db;dur=Y;desc="N queries"
        var serverMs = null;
        var dbMs = null;
        var queryCount = null;
        var xhr = evt.detail.xhr;
        if (xhr) {
            var st = xhr.getResponseHeader('Server-Timing');
            if (st) {
                var totalMatch = st.match(/total;dur=(\d+(?:\.\d+)?)/);
                if (totalMatch) serverMs = Math.round(parseFloat(totalMatch[1]));
                var dbMatch = st.match(/db;dur=(\d+(?:\.\d+)?)/);
                if (dbMatch) dbMs = Math.round(parseFloat(dbMatch[1]));
                var qMatch = st.match(/desc="(\d+) queries?"/);
                if (qMatch) queryCount = parseInt(qMatch[1], 10);
            }
        }

        var entry = {
            url: pending.url,
            method: pending.method,
            ms: ms,
            serverMs: serverMs,
            dbMs: dbMs,
            queryCount: queryCount,
            slow: slow,
        };
        _push(_htmxLog, entry);

        if (slow) {
            _debug('[perf] Slow HTMX request:', pending.method, pending.url,
                ms + 'ms' + (serverMs !== null ? ' (server: ' + serverMs + 'ms, db: ' + dbMs + 'ms, queries: ' + queryCount + ')' : ''));
        }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. LONG TASK OBSERVER
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (typeof PerformanceObserver !== 'undefined') {
        try {
            var _ltObs = new PerformanceObserver(function (list) {
                var entries = list.getEntries();
                for (var i = 0; i < entries.length; i++) {
                    var e = entries[i];
                    _push(_longTasks, {
                        start: Math.round(e.startTime),
                        duration: Math.round(e.duration),
                    });
                    if (e.duration > 100) {
                        _debug('[perf] Long task:', Math.round(e.duration) + 'ms at ' + Math.round(e.startTime) + 'ms');
                    }
                }
            });
            _ltObs.observe({ type: 'longtask', buffered: true });
        } catch (_e) {
            // longtask not supported in this browser — silently skip
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. PUBLIC API — window.Adarsh.perf
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    ns.perf = {
        /** Navigation timing snapshot */
        navigation: function () { return _navTiming; },

        /** HTMX request log (most recent MAX_ENTRIES) */
        htmx: function () { return _htmxLog.slice(); },

        /** Long task log (most recent MAX_ENTRIES) */
        longTasks: function () { return _longTasks.slice(); },

        /** Formatted summary — call from console */
        summary: function () {
            var nav = _navTiming;
            var parts = ['── Performance Summary ──'];

            if (nav) {
                parts.push('Page Load:');
                parts.push('  TTFB: ' + nav.ttfb + 'ms');
                parts.push('  DOM Ready: ' + nav.domReady + 'ms');
                parts.push('  Full Load: ' + nav.load + 'ms');
                parts.push('  Transfer: ' + (nav.transferSize / 1024).toFixed(1) + ' KB');
            } else {
                parts.push('Page Load: (not yet captured)');
            }

            parts.push('');
            parts.push('HTMX Requests: ' + _htmxLog.length + ' total');
            var slowCount = 0;
            var totalMs = 0;
            for (var i = 0; i < _htmxLog.length; i++) {
                totalMs += _htmxLog[i].ms;
                if (_htmxLog[i].slow) slowCount++;
            }
            if (_htmxLog.length > 0) {
                parts.push('  Avg: ' + Math.round(totalMs / _htmxLog.length) + 'ms');
                parts.push('  Slow (>' + SLOW_HTMX_MS + 'ms): ' + slowCount);
            }

            parts.push('');
            parts.push('Long Tasks: ' + _longTasks.length);
            if (_longTasks.length > 0) {
                var maxLt = 0;
                for (var j = 0; j < _longTasks.length; j++) {
                    if (_longTasks[j].duration > maxLt) maxLt = _longTasks[j].duration;
                }
                parts.push('  Longest: ' + maxLt + 'ms');
            }

            return parts.join('\n');
        },
    };

})();
