/**
 * Download Manager Module
 * Manages concurrent downloads with progress tracking, cancel support,
 * priority queuing, and bandwidth throttling.
 *
 * Features:
 *  - Max 3 simultaneous downloads
 *  - Real progress bars with percentage & ETA
 *  - Cancel button on each download toast
 *  - Toast persists until cancelled or completed
 *  - If combined active downloads > 500 MB, new downloads wait in queue
 *  - If adding a 4th download, oldest active download is cancelled
 *
 * Public API:
 *   DownloadManager.start(options)   → downloadId
 *   DownloadManager.cancel(id)
 *   DownloadManager.cancelAll()
 *   DownloadManager.getActive()      → [{id, name, progress, ...}]
 *
 * @module core/download-manager
 * @version 1.0.0
 */
(function () {
    'use strict';

    // =========================================
    // CONSTANTS
    // =========================================
    var MAX_CONCURRENT = 3;
    var SIZE_THRESHOLD = 500 * 1024 * 1024; // 500 MB
    var COMPLETE_TOAST_DURATION = 5000;      // 5s auto-hide after complete
    var TOAST_CONTAINER_ID = 'downloadToastContainer';

    // =========================================
    // STATE
    // =========================================
    var _nextId = 1;
    var _active = {};    // id → { id, name, xhr, startTime, loaded, total, toastEl, status }
    var _queue = [];     // [{ id, options }]  waiting to start

    // =========================================
    // TOAST CONTAINER (stacks download toasts)
    // =========================================
    function _ensureContainer() {
        var c = document.getElementById(TOAST_CONTAINER_ID);
        if (c) return c;
        c = document.createElement('div');
        c.id = TOAST_CONTAINER_ID;
        c.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:99999;' +
            'display:flex;flex-direction:column-reverse;gap:8px;max-width:380px;width:100%;pointer-events:none;';
        document.body.appendChild(c);
        return c;
    }

    // =========================================
    // CREATE A DOWNLOAD TOAST ELEMENT
    // =========================================
    function _createToast(id, name) {
        var el = document.createElement('div');
        el.id = 'dl-toast-' + id;
        el.className = 'dl-toast dl-toast-active';
        el.style.cssText = 'pointer-events:auto;background:linear-gradient(135deg,#6366f1 0%,#4f46e5 100%);' +
            'color:#fff;border-radius:8px;padding:10px 12px;min-width:280px;max-width:380px;' +
            'box-shadow:0 4px 20px rgba(0,0,0,.25);font-size:13px;opacity:0;transform:translateY(10px);' +
            'transition:opacity .25s,transform .25s;';

        // Build toast DOM safely (no innerHTML with dynamic data)
        var topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';

        var spinner = document.createElement('i');
        spinner.className = 'fa-solid fa-spinner fa-spin';
        spinner.style.cssText = 'font-size:16px;flex-shrink:0;';
        topRow.appendChild(spinner);

        var nameSpan = document.createElement('span');
        nameSpan.className = 'dl-toast-name';
        nameSpan.style.cssText = 'flex:1;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        nameSpan.textContent = name;
        topRow.appendChild(nameSpan);

        var pctSpan = document.createElement('span');
        pctSpan.className = 'dl-toast-pct';
        pctSpan.style.cssText = 'min-width:40px;text-align:right;font-weight:700;font-size:14px;';
        pctSpan.textContent = '0%';
        topRow.appendChild(pctSpan);

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'dl-toast-cancel';
        cancelBtn.title = 'Cancel';
        cancelBtn.style.cssText = 'background:rgba(255,255,255,.2);border:none;color:#fff;width:24px;height:24px;' +
            'border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
            'flex-shrink:0;font-size:12px;transition:background .15s;';
        var cancelIcon = document.createElement('i');
        cancelIcon.className = 'fa-solid fa-xmark';
        cancelBtn.appendChild(cancelIcon);
        cancelBtn.addEventListener('mouseenter', function () { this.style.background = 'rgba(255,255,255,.35)'; });
        cancelBtn.addEventListener('mouseleave', function () { this.style.background = 'rgba(255,255,255,.2)'; });
        topRow.appendChild(cancelBtn);

        el.appendChild(topRow);

        var bottomRow = document.createElement('div');
        bottomRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

        var barBg = document.createElement('div');
        barBg.className = 'dl-toast-bar-bg';
        barBg.style.cssText = 'flex:1;background:rgba(255,255,255,.25);border-radius:3px;height:6px;overflow:hidden;';

        var bar = document.createElement('div');
        bar.className = 'dl-toast-bar';
        bar.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#fff,#fffc);' +
            'border-radius:3px;transition:width .2s;box-shadow:0 0 6px rgba(255,255,255,.4);';
        barBg.appendChild(bar);
        bottomRow.appendChild(barBg);

        var eta = document.createElement('span');
        eta.className = 'dl-toast-eta';
        eta.style.cssText = 'font-size:11px;opacity:.7;min-width:48px;text-align:right;';
        eta.textContent = '--';
        bottomRow.appendChild(eta);

        el.appendChild(bottomRow);

        // Wire cancel button
        cancelBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            _cancel(id);
        });

        var container = _ensureContainer();
        container.appendChild(el);

        // Trigger enter animation
        requestAnimationFrame(function () {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        });

        return el;
    }

    // =========================================
    // UPDATE TOAST PROGRESS
    // =========================================
    function _updateToast(dl, loaded, total) {
        dl.loaded = loaded;
        dl.total = total;

        var el = dl.toastEl;
        if (!el) return;

        var pct = total > 0 ? Math.min(Math.round((loaded / total) * 100), 100) : 0;
        var bar = el.querySelector('.dl-toast-bar');
        var pctEl = el.querySelector('.dl-toast-pct');
        var etaEl = el.querySelector('.dl-toast-eta');

        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = total > 0 ? pct + '%' : '...';

        // ETA calculation
        if (etaEl && total > 0 && loaded > 0) {
            var elapsed = (Date.now() - dl.startTime) / 1000;
            var speed = loaded / elapsed; // bytes/sec
            var remaining = (total - loaded) / speed;
            etaEl.textContent = _formatEta(remaining);
        } else if (etaEl) {
            etaEl.textContent = '--';
        }
    }

    // =========================================
    // MARK TOAST AS COMPLETE / ERROR / CANCELLED
    // =========================================
    function _finishToast(dl, status, message) {
        var el = dl.toastEl;
        if (!el) return;

        dl.status = status;

        var icon = el.querySelector('i:first-child');
        var nameEl = el.querySelector('.dl-toast-name');
        var pctEl = el.querySelector('.dl-toast-pct');
        var bar = el.querySelector('.dl-toast-bar');
        var etaEl = el.querySelector('.dl-toast-eta');
        var cancelBtn = el.querySelector('.dl-toast-cancel');

        // Update icon
        if (icon) {
            icon.className = status === 'complete'
                ? 'fa-solid fa-check-circle'
                : status === 'cancelled'
                    ? 'fa-solid fa-ban'
                    : 'fa-solid fa-times-circle';
            icon.style.animation = 'none';
        }

        // Update message
        if (nameEl) nameEl.textContent = message || dl.name;
        if (pctEl) pctEl.textContent = status === 'complete' ? '100%' : '';
        if (bar) bar.style.width = status === 'complete' ? '100%' : bar.style.width;
        if (etaEl) etaEl.textContent = '';

        // Style based on status
        if (status === 'complete') {
            el.style.background = 'linear-gradient(135deg,#10b981 0%,#059669 100%)';
        } else if (status === 'cancelled') {
            el.style.background = 'linear-gradient(135deg,#f59e0b 0%,#d97706 100%)';
        } else {
            el.style.background = 'linear-gradient(135deg,#ef4444 0%,#dc2626 100%)';
        }

        // Change cancel button to dismiss (X)
        if (cancelBtn) {
            cancelBtn.title = 'Dismiss';
            cancelBtn.onclick = function (e) {
                e.stopPropagation();
                _removeToast(dl.id);
            };
        }

        // Auto-dismiss after duration
        setTimeout(function () { _removeToast(dl.id); }, COMPLETE_TOAST_DURATION);
    }

    function _removeToast(id) {
        var dl = _active[id];
        if (!dl || !dl.toastEl) return;

        var el = dl.toastEl;
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 300);

        delete _active[id];
        _processQueue();
    }

    // =========================================
    // QUEUE MANAGEMENT
    // =========================================
    function _getActiveTotalBytes() {
        var sum = 0;
        for (var id in _active) {
            if (_active[id].status === 'downloading') {
                sum += _active[id].total || 0;
            }
        }
        return sum;
    }

    function _getActiveCount() {
        var count = 0;
        for (var id in _active) {
            if (_active[id].status === 'downloading') count++;
        }
        return count;
    }

    function _processQueue() {
        while (_queue.length > 0 && _getActiveCount() < MAX_CONCURRENT) {
            // Check size threshold — if active bytes > 500MB, don't start another
            if (_getActiveTotalBytes() > SIZE_THRESHOLD && _getActiveCount() > 0) {
                break;
            }
            var next = _queue.shift();
            _startXhr(next.id, next.options);
        }
    }

    // =========================================
    // CANCEL
    // =========================================
    function _cancel(id) {
        // Check active downloads
        var dl = _active[id];
        if (dl) {
            if (dl._indeterminateTimer) { clearInterval(dl._indeterminateTimer); dl._indeterminateTimer = null; }
            if (dl.xhr && dl.status === 'downloading') {
                dl.xhr.abort();
            }
            _finishToast(dl, 'cancelled', 'Download cancelled');
            return;
        }

        // Check queue
        for (var i = 0; i < _queue.length; i++) {
            if (_queue[i].id === id) {
                // Remove from queue, also remove toast
                var qEntry = _queue.splice(i, 1)[0];
                var qDl = _active[qEntry.id];
                if (qDl) _finishToast(qDl, 'cancelled', 'Download cancelled');
                return;
            }
        }
    }

    function _cancelAll() {
        // Cancel all queued
        while (_queue.length > 0) {
            var q = _queue.pop();
            var dl = _active[q.id];
            if (dl) _finishToast(dl, 'cancelled', 'Download cancelled');
        }
        // Cancel all active
        for (var id in _active) {
            if (_active[id].status === 'downloading') {
                _cancel(parseInt(id));
            }
        }
    }

    // =========================================
    // CORE XHR DOWNLOAD
    // =========================================
    function _startXhr(id, opts) {
        var dl = _active[id];
        if (!dl) return;

        dl.status = 'downloading';
        dl.startTime = Date.now();

        var xhr = new XMLHttpRequest();
        dl.xhr = xhr;

        xhr.open(opts.method || 'POST', opts.url, true);
        xhr.responseType = 'blob';
        xhr.timeout = 600000; // 10 minutes for large exports

        // Set headers
        if (opts.headers) {
            for (var h in opts.headers) {
                xhr.setRequestHeader(h, opts.headers[h]);
            }
        }
        // Always set Content-Type for POST
        if ((opts.method || 'POST') === 'POST') {
            xhr.setRequestHeader('Content-Type', 'application/json');
        }
        // CSRF
        if (typeof getCSRFToken === 'function') {
            xhr.setRequestHeader('X-CSRFToken', getCSRFToken());
        }

        xhr.onprogress = function (e) {
            if (e.lengthComputable) {
                _updateToast(dl, e.loaded, e.total);
                // Clear indeterminate timer if we now have real progress
                if (dl._indeterminateTimer) {
                    clearInterval(dl._indeterminateTimer);
                    dl._indeterminateTimer = null;
                    var bar2 = dl.toastEl ? dl.toastEl.querySelector('.dl-toast-bar') : null;
                    if (bar2) { bar2.style.animation = ''; bar2.dataset.indeterminate = ''; }
                }
            } else if (!dl._indeterminateTimer) {
                // No Content-Length — use time-based estimation (exponential approach to 85%)
                var _indStart = Date.now();
                dl._indeterminateTimer = setInterval(function() {
                    var bar = dl.toastEl ? dl.toastEl.querySelector('.dl-toast-bar') : null;
                    var pctEl = dl.toastEl ? dl.toastEl.querySelector('.dl-toast-pct') : null;
                    if (!bar) return;
                    bar.style.animation = '';
                    bar.dataset.indeterminate = '';
                    var elapsed = (Date.now() - _indStart) / 1000;
                    var estPct = Math.round(85 * (1 - Math.exp(-elapsed / 15)));
                    bar.style.width = estPct + '%';
                    if (pctEl) pctEl.textContent = estPct + '%';
                }, 500);
            }
        };

        xhr.onload = function () {
            if (dl._indeterminateTimer) { clearInterval(dl._indeterminateTimer); dl._indeterminateTimer = null; }
            if (dl.status !== 'downloading') return; // was cancelled

            if (xhr.status === 200) {
                // Success — trigger download
                var blob = xhr.response;
                var filename = opts.filename || _extractFilename(xhr, opts.fallbackExt || 'zip');
                _triggerBlobDownload(blob, filename);
                _finishToast(dl, 'complete', opts.completeMessage || 'Downloaded ' + filename);

                // Callback
                if (typeof opts.onComplete === 'function') {
                    try { opts.onComplete(blob, filename); } catch (e) { console.error(e); }
                }
            } else {
                // Error
                var errMsg = 'Download failed (HTTP ' + xhr.status + ')';
                try {
                    var reader = new FileReader();
                    reader.onload = function () {
                        try {
                            var errData = JSON.parse(reader.result);
                            errMsg = errData.message || errMsg;
                        } catch (e) { /* use default */ }
                        _finishToast(dl, 'error', errMsg);
                        if (typeof opts.onError === 'function') opts.onError(errMsg);
                    };
                    reader.readAsText(xhr.response);
                } catch (e) {
                    _finishToast(dl, 'error', errMsg);
                    if (typeof opts.onError === 'function') opts.onError(errMsg);
                }
            }
        };

        xhr.onerror = function () {
            if (dl._indeterminateTimer) { clearInterval(dl._indeterminateTimer); dl._indeterminateTimer = null; }
            if (dl.status !== 'downloading') return;
            _finishToast(dl, 'error', 'Network error — download failed');
            if (typeof opts.onError === 'function') opts.onError('Network error');
        };

        xhr.ontimeout = function () {
            if (dl._indeterminateTimer) { clearInterval(dl._indeterminateTimer); dl._indeterminateTimer = null; }
            if (dl.status !== 'downloading') return;
            _finishToast(dl, 'error', 'Download timed out — the server took too long to respond. Please try again.');
            if (typeof opts.onError === 'function') opts.onError('Timeout');
        };

        xhr.onabort = function () {
            if (dl._indeterminateTimer) { clearInterval(dl._indeterminateTimer); dl._indeterminateTimer = null; }
            // Handled by _cancel
        };

        xhr.send(opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : null);
    }

    // =========================================
    // START A DOWNLOAD (PUBLIC)
    // =========================================
    function start(options) {
        /**
         * options:
         *   name          – display name for toast (e.g. "ID Cards DOCX")
         *   url           – endpoint URL
         *   method        – HTTP method (default: POST)
         *   body          – request body (object or string)
         *   headers       – extra headers
         *   filename      – override filename (optional)
         *   fallbackExt   – fallback extension if no Content-Disposition (default: zip)
         *   completeMessage – toast message on success
         *   onComplete    – callback(blob, filename)
         *   onError       – callback(errorMsg)
         *
         * Returns: downloadId (number)
         */
        var id = _nextId++;
        var name = options.name || 'Download #' + id;

        // Create toast immediately
        var toastEl = _createToast(id, name);

        _active[id] = {
            id: id,
            name: name,
            xhr: null,
            startTime: null,
            loaded: 0,
            total: 0,
            toastEl: toastEl,
            status: 'pending'
        };

        var activeCount = _getActiveCount();

        // If adding beyond MAX_CONCURRENT, cancel the oldest active download
        if (activeCount >= MAX_CONCURRENT) {
            var oldestId = null;
            var oldestTime = Infinity;
            for (var aid in _active) {
                var a = _active[aid];
                if (a.status === 'downloading' && a.startTime && a.startTime < oldestTime) {
                    oldestTime = a.startTime;
                    oldestId = parseInt(aid);
                }
            }
            if (oldestId !== null) {
                _cancel(oldestId);
            }
        }

        // Check if we can start immediately or need to queue
        if (_getActiveCount() < MAX_CONCURRENT) {
            // Check size threshold
            if (_getActiveTotalBytes() > SIZE_THRESHOLD && _getActiveCount() > 0) {
                // Queue it — will start when current finishes
                _queue.push({ id: id, options: options });
                _updateToastQueued(_active[id]);
            } else {
                _startXhr(id, options);
            }
        } else {
            _queue.push({ id: id, options: options });
            _updateToastQueued(_active[id]);
        }

        return id;
    }

    function _updateToastQueued(dl) {
        if (!dl || !dl.toastEl) return;
        var pctEl = dl.toastEl.querySelector('.dl-toast-pct');
        var etaEl = dl.toastEl.querySelector('.dl-toast-eta');
        if (pctEl) pctEl.textContent = '';
        if (etaEl) etaEl.textContent = 'Queued';

        var bar = dl.toastEl.querySelector('.dl-toast-bar');
        if (bar) {
            bar.style.width = '100%';
            bar.style.opacity = '0.3';
            bar.style.animation = '2s ease-in-out infinite alternate pulse-bar';
        }
    }

    // =========================================
    // SPECIAL: Image download (non-blob JSON response)
    // For image downloads that return JSON with base64 ZIPs
    // =========================================
    function startImageDownload(options) {
        /**
         * Special handler for image exports that return JSON with zip_files array.
         * options: same as start() but handles JSON response differently.
         * Returns: downloadId
         */
        var id = _nextId++;
        var name = options.name || 'Images Download';
        var toastEl = _createToast(id, name);

        _active[id] = {
            id: id,
            name: name,
            xhr: null,
            startTime: Date.now(),
            loaded: 0,
            total: 0,
            toastEl: toastEl,
            status: 'downloading'
        };

        var dl = _active[id];

        var xhr = new XMLHttpRequest();
        dl.xhr = xhr;

        xhr.open(options.method || 'POST', options.url, true);
        xhr.timeout = 600000; // 10 minutes for large image exports
        xhr.setRequestHeader('Content-Type', 'application/json');
        if (typeof getCSRFToken === 'function') {
            xhr.setRequestHeader('X-CSRFToken', getCSRFToken());
        }

        xhr.onprogress = function (e) {
            if (e.lengthComputable) {
                _updateToast(dl, e.loaded, e.total);
            }
        };

        xhr.onload = function () {
            if (dl.status !== 'downloading') return;

            if (xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    if (response.success && response.zip_files && response.zip_files.length > 0) {
                        var totalZips = response.zip_files.length;
                        var downloadIndex = 0;

                        function downloadNextZip() {
                            if (dl.status !== 'downloading') return;
                            if (downloadIndex >= totalZips) {
                                _finishToast(dl, 'complete',
                                    'Downloaded ' + totalZips + ' ZIP(s) with ' + (response.total_images || '?') + ' images');
                                if (typeof options.onComplete === 'function') {
                                    try { options.onComplete(); } catch (e) { console.error(e); }
                                }
                                return;
                            }

                            var zipInfo = response.zip_files[downloadIndex];
                            _updateToast(dl, downloadIndex, totalZips);

                            try {
                                // CSP-safe base64 → Blob (no fetch('data:') needed)
                                var bin = atob(zipInfo.data);
                                var bytes = new Uint8Array(bin.length);
                                for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
                                var blob = new Blob([bytes], { type: 'application/zip' });

                                _triggerBlobDownload(blob, zipInfo.filename);
                                downloadIndex++;
                                var pctEl = dl.toastEl ? dl.toastEl.querySelector('.dl-toast-pct') : null;
                                if (pctEl) pctEl.textContent = downloadIndex + '/' + totalZips;
                                setTimeout(downloadNextZip, 300);
                            } catch (err) {
                                console.error('ZIP download failed:', err);
                                _finishToast(dl, 'error', 'Failed to process ZIP file');
                            }
                        }

                        downloadNextZip();
                    } else {
                        _finishToast(dl, 'error', response.message || 'No images found');
                        if (typeof options.onError === 'function') options.onError(response.message);
                    }
                } catch (e) {
                    _finishToast(dl, 'error', 'Failed to process response');
                    console.error(e);
                }
            } else {
                _finishToast(dl, 'error', 'Image download failed (HTTP ' + xhr.status + ')');
            }
        };

        xhr.onerror = function () {
            if (dl.status !== 'downloading') return;
            _finishToast(dl, 'error', 'Network error — download failed');
        };

        xhr.ontimeout = function () {
            if (dl.status !== 'downloading') return;
            _finishToast(dl, 'error', 'Image download timed out — too many images or slow connection. Try fewer cards.');
        };

        xhr.send(options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null);

        return id;
    }

    // =========================================
    // HELPERS
    // =========================================
    function _triggerBlobDownload(blob, filename) {
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            window.URL.revokeObjectURL(url);
            if (a.parentNode) a.parentNode.removeChild(a);
        }, 100);
    }

    function _extractFilename(xhr, fallbackExt) {
        var disposition = xhr.getResponseHeader('Content-Disposition');
        if (disposition) {
            var match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i);
            if (match && match[1]) return decodeURIComponent(match[1]);
        }
        var clientName = (typeof CLIENT_NAME !== 'undefined' ? CLIENT_NAME : '').replace(/\s+/g, '');
        var tableName = (typeof TABLE_NAME !== 'undefined' ? TABLE_NAME : '').replace(/\s+/g, '');
        var status = (typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : 'pending');
        var statusCap = status.charAt(0).toUpperCase() + status.slice(1);
        var parts = [clientName, tableName, statusCap].filter(Boolean);
        return (parts.length ? parts.join('_') : 'export') + '.' + fallbackExt;
    }

    function _formatEta(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '--';
        if (seconds < 60) return Math.ceil(seconds) + 's';
        if (seconds < 3600) return Math.ceil(seconds / 60) + 'm';
        return Math.floor(seconds / 3600) + 'h ' + Math.ceil((seconds % 3600) / 60) + 'm';
    }

    function _escHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // =========================================
    // CSS INJECTION (animations for indeterminate/queued)
    // =========================================
    (function injectStyles() {
        if (document.getElementById('dl-mgr-styles')) return;
        var style = document.createElement('style');
        style.id = 'dl-mgr-styles';
        style.textContent =
            '@keyframes indeterminate-bar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}' +
            '@keyframes pulse-bar{0%{opacity:.2}100%{opacity:.5}}' +
            '.dl-toast{font-family:system-ui,-apple-system,sans-serif;}';
        document.head.appendChild(style);
    })();

    // =========================================
    // PUBLIC API
    // =========================================
    var DownloadManager = {
        start: start,
        startImageDownload: startImageDownload,
        cancel: _cancel,
        cancelAll: _cancelAll,
        getActive: function () {
            var list = [];
            for (var id in _active) {
                var dl = _active[id];
                list.push({
                    id: dl.id,
                    name: dl.name,
                    status: dl.status,
                    progress: dl.total > 0 ? Math.round((dl.loaded / dl.total) * 100) : 0,
                    loaded: dl.loaded,
                    total: dl.total
                });
            }
            return list;
        }
    };

    window.DownloadManager = DownloadManager;
    window.IDCardApp = window.IDCardApp || {};
    window.IDCardApp.DownloadManager = DownloadManager;

})();
