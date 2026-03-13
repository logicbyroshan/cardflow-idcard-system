/**
 * perf-monitor.js  Minimal performance namespace stub
 *
 * NOTE: This file is NOT loaded in any page template.
 * Server-Timing headers from RequestTimingMiddleware are visible
 * natively in browser DevTools  Network  Timing tab.
 *
 * This stub only exists to keep the window.Adarsh.perf namespace
 * intact in case any console debugging code references it.
 */
(function () {
    'use strict';
    var ns = window.Adarsh = window.Adarsh || {};
    ns.perf = {
        navigation: function () { return null; },
        htmx:       function () { return []; },
        longTasks:  function () { return []; },
        summary:    function () { return 'Use browser DevTools  Network  Timing tab for Server-Timing data.'; }
    };
})();
