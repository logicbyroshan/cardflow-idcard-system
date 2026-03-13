/**
 * error-monitor.js  Minimal client-side error namespace stub
 *
 * NOTE: This file is NOT loaded in any page template.
 * HTMX errors are already handled by htmx-config.html (shows toast on 4xx/5xx).
 * JS errors can be monitored via browser DevTools Console.
 *
 * The server endpoint POST /api/client-errors/ still exists
 * if you ever want to re-enable client-side error reporting.
 *
 * This stub keeps the window.Adarsh.errors namespace intact
 * so any console debugging code referencing it won't throw.
 */
(function () {
    'use strict';
    var ns = window.Adarsh = window.Adarsh || {};
    ns.errors = {
        list:    function () { return []; },
        summary: function () { return 'No errors captured. Error monitoring is handled by htmx-config.html and browser DevTools.'; },
        flush:   function () { return Promise.resolve({ sent: 0 }); },
        clear:   function () {}
    };
})();
