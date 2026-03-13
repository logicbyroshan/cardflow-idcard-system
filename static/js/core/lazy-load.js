/**
 * Lazy Loader  dynamic script/CSS injection for heavy vendor libraries.
 * Avoids loading ~740KB+ on every page load.
 *
 * Paths are resolved via window.__STATIC_URLS (set by Django {% static %} tags)
 * with fallback to /static/ for dev convenience.
 *
 * Usage:
 *   const XLSX = await LazyLoad.xlsx();
 *   const JSZip = await LazyLoad.jszip();
 *   const Cropper = await LazyLoad.cropper();
 *   const flatpickr = await LazyLoad.flatpickr();
 */
(function() {
'use strict';

var _cache = {};
var _urls = window.__STATIC_URLS || {};

function _url(key, fallback) {
    return _urls[key] || fallback;
}

function _loadScript(url, globalName) {
    if (_cache[url]) return _cache[url];
    _cache[url] = new Promise(function(resolve, reject) {
        // Already loaded (e.g. from earlier call or static include)?
        if (globalName && window[globalName]) {
            resolve(window[globalName]);
            return;
        }
        var s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = function() {
            resolve(globalName ? window[globalName] : true);
        };
        s.onerror = function() {
            delete _cache[url];
            reject(new Error('Failed to load script: ' + url));
        };
        document.head.appendChild(s);
    });
    return _cache[url];
}

function _loadCSS(url) {
    if (_cache['css:' + url]) return _cache['css:' + url];
    _cache['css:' + url] = new Promise(function(resolve, reject) {
        // Already in DOM?
        if (document.querySelector('link[href="' + url + '"]')) {
            resolve(true);
            return;
        }
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.onload = function() { resolve(true); };
        link.onerror = function() {
            delete _cache['css:' + url];
            reject(new Error('Failed to load CSS: ' + url));
        };
        document.head.appendChild(link);
    });
    return _cache['css:' + url];
}

window.LazyLoad = {
    /**
     * Load SheetJS (XLSX)  ~500KB
     * @returns {Promise<XLSX>}
     */
    xlsx: function() {
        return _loadScript(_url('xlsx', '/static/js/vendor/xlsx.full.min.js'), 'XLSX');
    },

    /**
     * Load JSZip  ~100KB
     * @returns {Promise<JSZip>}
     */
    jszip: function() {
        return _loadScript(_url('jszip', '/static/js/vendor/jszip.min.js'), 'JSZip');
    },

    /**
     * Load Cropper.js + CSS  ~90KB + 4KB CSS
     * @returns {Promise<Cropper>}
     */
    cropper: function() {
        return Promise.all([
            _loadCSS(_url('cropperCSS', '/static/css/vendor/cropper.min.css')),
            _loadScript(_url('cropperJS', '/static/js/vendor/cropper.min.js'), 'Cropper')
        ]).then(function(results) { return results[1]; });
    },

    /**
     * Load Flatpickr + CSS  ~50KB + 16KB CSS
     * @returns {Promise<flatpickr>}
     */
    flatpickr: function() {
        return Promise.all([
            _loadCSS(_url('flatpickrCSS', '/static/css/vendor/flatpickr.min.css')),
            _loadScript(_url('flatpickrJS', '/static/js/vendor/flatpickr.min.js'), 'flatpickr')
        ]).then(function(results) { return results[1]; });
    }
};

})();
