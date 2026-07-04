/**
 * Web Worker: XLSX parse offload
 * Receives an ArrayBuffer, parses it with SheetJS, returns JSON rows.
 * Keeps the main thread free during large-file parsing.
 */

/* global importScripts, XLSX */
importScripts('/static/js/vendor/xlsx.full.min.js');

self.addEventListener('message', function(e) {
    try {
        var buf = e.data;                                     // ArrayBuffer
        var workbook = XLSX.read(buf, { type: 'array' });
        var firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        var jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        self.postMessage({ success: true, jsonData: jsonData });
    } catch (err) {
        self.postMessage({ success: false, error: err.message || String(err) });
    }
});
