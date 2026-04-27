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
 *   DownloadManager.start(options)    downloadId
 *   DownloadManager.cancel(id)
 *   DownloadManager.cancelAll()
 *   DownloadManager.getActive()       [{id, name, progress, ...}]
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
    var _active = {};    // id  { id, name, xhr, startTime, loaded, total, toastEl, status }
    var _queue = [];     // [{ id, options }]  waiting to start
    var _currentOverlayId = null;   // ID of the download currently shown in blocking overlay
    var _overlayStartTime = null;   // Track start time for ETA calculation
    var _bulkUiLockActive = false;
    var _bulkUiLockDepth = 0;

    function _isBulkLockAllowedRoot(node) {
        if (!node || !node.nodeType || node.nodeType !== 1) return false;
        if (node.id === 'blockingOverlay' || node.id === 'downloadToastContainer') return true;
        if (node.classList && node.classList.contains('alpine-toast-wrapper')) return true;
        return false;
    }

    function _toggleBulkLockInert(active) {
        if (!document || !document.body || !document.body.children) return;
        var roots = document.body.children;
        for (var i = 0; i < roots.length; i++) {
            var node = roots[i];
            if (_isBulkLockAllowedRoot(node)) continue;

            if (active) {
                if (!node.hasAttribute('inert')) {
                    node.setAttribute('inert', '');
                    node.setAttribute('data-bulk-lock-inert', '1');
                }
            } else if (node.getAttribute('data-bulk-lock-inert') === '1') {
                node.removeAttribute('inert');
                node.removeAttribute('data-bulk-lock-inert');
            }
        }
    }

    function _setBulkUiLock(active) {
        if (!document || !document.body) return;

        if (active) {
            _bulkUiLockDepth += 1;
        } else {
            _bulkUiLockDepth = Math.max(0, _bulkUiLockDepth - 1);
        }

        var shouldLock = _bulkUiLockDepth > 0;
        document.body.classList.toggle('bulk-operation-active', shouldLock);
        _toggleBulkLockInert(shouldLock);

        if (shouldLock && document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
    }

    function _consumeBulkUiLockFlag() {
        window.IDCardApp = window.IDCardApp || {};
        if (window.IDCardApp._nextBulkUiLock === true) {
            window.IDCardApp._nextBulkUiLock = false;
            return true;
        }
        return false;
    }

    // =========================================
    // BLOCKING OVERLAY HELPERS (Enhanced)
    // =========================================
    function _showBlockingOverlay(id, name, itemCount, lockUi) {
        var overlay = document.getElementById('blockingOverlay');
        if (!overlay) return;
        _currentOverlayId = id;
        _overlayStartTime = Date.now();
        _bulkUiLockActive = !!lockUi || _consumeBulkUiLockFlag();
        if (_bulkUiLockActive) _setBulkUiLock(true);

        var content = overlay.querySelector('#blockingOverlayContent');
        var iconEl = overlay.querySelector('#blockingOverlayIconInner');
        var titleEl = overlay.querySelector('#blockingOverlayTitle');
        var msgEl = overlay.querySelector('#blockingOverlayMessage');
        var barEl = overlay.querySelector('#blockingOverlayBar');
        var pctEl = overlay.querySelector('#blockingOverlayPercent');
        var timeEl = overlay.querySelector('#blockingOverlayTime');
        var sizeEl = overlay.querySelector('#blockingOverlaySize');
        var badgeEl = overlay.querySelector('#blockingOverlayBadge');
        var badgeCount = overlay.querySelector('#blockingOverlayBadgeCount');
        var cancelBtn = overlay.querySelector('#blockingOverlayCancelBtn');
        var doneBtn = overlay.querySelector('#blockingOverlayDoneBtn');

        // Set preparing state
        if (content) content.className = 'blocking-overlay-content preparing';
        if (iconEl) iconEl.className = 'fa-solid fa-gear';
        if (titleEl) titleEl.textContent = 'Preparing Download';
        if (msgEl) msgEl.textContent = 'Generating ' + name + '...';
        if (barEl) { barEl.style.width = '0%'; barEl.classList.add('indeterminate'); }
        if (pctEl) pctEl.textContent = '';
        if (timeEl) timeEl.textContent = itemCount ? '~' + Math.ceil(itemCount * 0.5) + 's' : '';
        if (sizeEl) sizeEl.textContent = '';

        // Show badge if item count provided
        if (badgeEl && itemCount && itemCount > 0) {
            badgeEl.style.display = 'inline-flex';
            if (badgeCount) badgeCount.textContent = itemCount + ' item' + (itemCount > 1 ? 's' : '');
        } else if (badgeEl) {
            badgeEl.style.display = 'none';
        }

        // Wire cancel button
        if (cancelBtn) {
            cancelBtn.style.display = 'inline-flex';
            cancelBtn.querySelector('span').textContent = 'Cancel';
            cancelBtn.onclick = function() { _cancel(id); };
        }
        if (doneBtn) doneBtn.style.display = 'none';

        overlay.style.display = 'flex';
    }

    function _updateBlockingOverlay(id, pct, message, sizeInfo) {
        if (_currentOverlayId !== id) return;
        var overlay = document.getElementById('blockingOverlay');
        if (!overlay) return;

        var content = overlay.querySelector('#blockingOverlayContent');
        var iconEl = overlay.querySelector('#blockingOverlayIconInner');
        var titleEl = overlay.querySelector('#blockingOverlayTitle');
        var msgEl = overlay.querySelector('#blockingOverlayMessage');
        var barEl = overlay.querySelector('#blockingOverlayBar');
        var pctEl = overlay.querySelector('#blockingOverlayPercent');
        var timeEl = overlay.querySelector('#blockingOverlayTime');
        var sizeElm = overlay.querySelector('#blockingOverlaySize');

        // Switch to downloading state
        if (content && !content.classList.contains('downloading')) {
            content.className = 'blocking-overlay-content downloading';
            if (iconEl) iconEl.className = 'fa-solid fa-download';
            if (titleEl) titleEl.textContent = 'Downloading...';
        }

        if (msgEl && message) msgEl.textContent = message;
        if (barEl) {
            barEl.classList.remove('indeterminate');
            barEl.style.width = Math.min(pct, 100) + '%';
        }
        if (pctEl) pctEl.textContent = Math.round(pct) + '%';

        // Calculate ETA based on progress
        if (timeEl && _overlayStartTime && pct > 5) {
            var elapsed = (Date.now() - _overlayStartTime) / 1000;
            var totalEst = elapsed / (pct / 100);
            var remaining = Math.ceil(totalEst - elapsed);
            if (remaining > 0 && remaining < 3600) {
                timeEl.textContent = remaining < 60 ? '~' + remaining + 's' : '~' + Math.ceil(remaining / 60) + 'm';
            } else {
                timeEl.textContent = '';
            }
        }

        if (sizeElm && sizeInfo) sizeElm.textContent = sizeInfo;
    }

    function _completeBlockingOverlay(id, success, message) {
        if (_currentOverlayId !== id) return;
        var overlay = document.getElementById('blockingOverlay');
        if (!overlay) return;

        var content = overlay.querySelector('#blockingOverlayContent');
        var iconEl = overlay.querySelector('#blockingOverlayIconInner');
        var titleEl = overlay.querySelector('#blockingOverlayTitle');
        var msgEl = overlay.querySelector('#blockingOverlayMessage');
        var barEl = overlay.querySelector('#blockingOverlayBar');
        var pctEl = overlay.querySelector('#blockingOverlayPercent');
        var timeEl = overlay.querySelector('#blockingOverlayTime');
        var cancelBtn = overlay.querySelector('#blockingOverlayCancelBtn');
        var doneBtn = overlay.querySelector('#blockingOverlayDoneBtn');

        if (success) {
            if (content) content.className = 'blocking-overlay-content complete';
            if (iconEl) iconEl.className = 'fa-solid fa-check';
            if (titleEl) titleEl.textContent = 'Download Complete!';
            if (msgEl) msgEl.textContent = message || 'File saved to your device';
            if (barEl) barEl.style.width = '100%';
            if (pctEl) pctEl.textContent = '100%';
            if (timeEl) timeEl.textContent = '';
            if (cancelBtn) cancelBtn.style.display = 'none';
            if (doneBtn) {
                doneBtn.style.display = 'inline-flex';
                doneBtn.onclick = function() { _hideBlockingOverlay(id); };
            }
            // Auto-close after 3s
            setTimeout(function() { _hideBlockingOverlay(id); }, 3000);
        } else {
            if (content) content.className = 'blocking-overlay-content error';
            if (iconEl) iconEl.className = 'fa-solid fa-xmark';
            if (titleEl) titleEl.textContent = 'Download Failed';
            if (msgEl) msgEl.textContent = message || 'Something went wrong';
            if (barEl) barEl.style.width = '0%';
            if (pctEl) pctEl.textContent = '';
            if (timeEl) timeEl.textContent = '';
            if (cancelBtn) {
                cancelBtn.style.display = 'inline-flex';
                cancelBtn.querySelector('span').textContent = 'Close';
                cancelBtn.onclick = function() { _hideBlockingOverlay(id); };
            }
            if (doneBtn) doneBtn.style.display = 'none';
        }
    }

    function _hideBlockingOverlay(id) {
        if (_currentOverlayId !== id) return;
        var overlay = document.getElementById('blockingOverlay');
        if (overlay) overlay.style.display = 'none';
        _currentOverlayId = null;
        _overlayStartTime = null;
        if (_bulkUiLockActive) {
            _setBulkUiLock(false);
            _bulkUiLockActive = false;
        }
    }

    // =========================================
    // TOAST CONTAINER (stacks download toasts)
    // =========================================
    function _ensureContainer() {
        var c = document.getElementById(TOAST_CONTAINER_ID);
        if (c) return c;
        c = document.createElement('div');
        c.id = TOAST_CONTAINER_ID;
        c.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:99999;' +
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

        var spinner = document.createElement('span');
        spinner.className = 'dl-toast-skeleton-icon';
        spinner.setAttribute('aria-hidden', 'true');
        spinner.style.cssText = 'flex-shrink:0;';
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
            'border-radius: 8px;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
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
        // Complete blocking overlay with success/error state
        var overlaySuccess = status === 'complete';
        var overlayMsg = message || (overlaySuccess ? 'Downloaded successfully!' : 'Download failed');
        _completeBlockingOverlay(dl.id, overlaySuccess, overlayMsg);
        
        var el = dl.toastEl;
        if (!el) return;

        dl.status = status;

        function applyFinish() {
            var icon = el.querySelector('i:first-child');
            var nameEl = el.querySelector('.dl-toast-name');
            var pctEl = el.querySelector('.dl-toast-pct');
            var bar = el.querySelector('.dl-toast-bar');
            var etaEl = el.querySelector('.dl-toast-eta');
            var cancelBtn = el.querySelector('.dl-toast-cancel');

            // Update icon
            if (icon) {
                icon.className = status === 'complete'
                    ? 'fa-solid fa-circle-check'
                    : status === 'cancelled'
                        ? 'fa-solid fa-ban'
                        : 'fa-solid fa-circle-xmark';
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

        if ((status === 'complete' || status === 'error') && dl.skeletonStart && typeof window.waitForMinDelay === 'function') {
            var start = dl.skeletonStart;
            dl.skeletonStart = null;
            window.waitForMinDelay(start).then(function () {
                if (dl.status !== status) return;
                applyFinish();
            });
            return;
        }
        applyFinish();
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
            // Check size threshold  if active bytes > 500MB, don't start another
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

        // Extract item count from body if available (card_ids array)
        var itemCount = 0;
        if (opts.body) {
            var bodyObj = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
            if (bodyObj.card_ids && Array.isArray(bodyObj.card_ids)) {
                itemCount = bodyObj.card_ids.length;
            }
        }

        // Show blocking overlay with item count
        _showBlockingOverlay(id, dl.name, itemCount, !!opts.lockUi);

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
        // Disable compression to ensure Content-Length is readable for progress tracking
        xhr.setRequestHeader('Accept-Encoding', 'identity');

        xhr.onprogress = function (e) {
            if (e.lengthComputable) {
                _updateToast(dl, e.loaded, e.total);
                var pct = Math.min(Math.round((e.loaded / e.total) * 100), 100);
                var sizeInfo = _formatBytes(e.loaded) + ' / ' + _formatBytes(e.total);
                _updateBlockingOverlay(dl.id, pct, 'Downloading ' + dl.name + '...', sizeInfo);
                // Clear indeterminate timer if we now have real progress
                if (dl._indeterminateTimer) {
                    clearInterval(dl._indeterminateTimer);
                    dl._indeterminateTimer = null;
                    var bar2 = dl.toastEl ? dl.toastEl.querySelector('.dl-toast-bar') : null;
                    if (bar2) { bar2.style.animation = ''; bar2.dataset.indeterminate = ''; }
                }
            } else if (!dl._indeterminateTimer) {
                // No Content-Length  use time-based estimation (exponential approach to 85%)
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
                    _updateBlockingOverlay(dl.id, estPct, 'Generating ' + dl.name + '...', null);
                }, 500);
            }
        };

        xhr.onload = function () {
            if (dl._indeterminateTimer) { clearInterval(dl._indeterminateTimer); dl._indeterminateTimer = null; }
            if (dl.status !== 'downloading') return; // was cancelled

            if (xhr.status === 200 || xhr.status === 202) {
                var contentType = (xhr.getResponseHeader('Content-Type') || '').toLowerCase();
                if (contentType.indexOf('application/json') !== -1) {
                    var readerJson = new FileReader();
                    readerJson.onload = function () {
                        try {
                            var data = JSON.parse(readerJson.result || '{}');
                            if (data && data.success && data.async && data.task_id) {
                                _updateBlockingOverlay(dl.id, 5, 'Queued for background generation...', null);
                                _pollAsyncExportTask(data.task_id, dl, opts);
                                return;
                            }
                            var jErr = (data && data.message) ? data.message : 'Download failed';
                            _finishToast(dl, 'error', jErr);
                            if (typeof opts.onError === 'function') opts.onError(jErr);
                        } catch (_e) {
                            _finishToast(dl, 'error', 'Failed to parse server response');
                            if (typeof opts.onError === 'function') opts.onError('Invalid server response');
                        }
                    };
                    readerJson.readAsText(xhr.response);
                    return;
                }

                // Success  trigger download
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
            _finishToast(dl, 'error', 'Network error  download failed');
            if (typeof opts.onError === 'function') opts.onError('Network error');
        };

        xhr.ontimeout = function () {
            if (dl._indeterminateTimer) { clearInterval(dl._indeterminateTimer); dl._indeterminateTimer = null; }
            if (dl.status !== 'downloading') return;
            _finishToast(dl, 'error', 'Download timed out  the server took too long to respond. Please try again.');
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
         *   name           display name for toast (e.g. "ID Cards DOCX")
         *   url            endpoint URL
         *   method         HTTP method (default: POST)
         *   body           request body (object or string)
         *   headers        extra headers
         *   filename       override filename (optional)
         *   fallbackExt    fallback extension if no Content-Disposition (default: zip)
         *   completeMessage  toast message on success
         *   onComplete     callback(blob, filename)
         *   onError        callback(errorMsg)
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
            status: 'pending',
            skeletonStart: Date.now()
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
                // Queue it  will start when current finishes
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
            status: 'downloading',
            skeletonStart: Date.now()
        };

        var dl = _active[id];

        // Extract item count from body if available
        var itemCount = 0;
        if (options.body) {
            var bodyObj = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
            if (bodyObj.card_ids && Array.isArray(bodyObj.card_ids)) {
                itemCount = bodyObj.card_ids.length;
            }
        }

        // Show blocking overlay for image download with item count
        _showBlockingOverlay(id, name, itemCount, !!options.lockUi);

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
                var pct = Math.min(Math.round((e.loaded / e.total) * 100), 100);
                _updateBlockingOverlay(dl.id, pct, 'Downloading images... ' + pct + '%');
            }
        };

        xhr.onload = function () {
            if (dl.status !== 'downloading') return;

            if (xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    var fileList = [];
                    if (Array.isArray(response.files) && response.files.length > 0) {
                        fileList = response.files;
                    } else if (Array.isArray(response.zip_files) && response.zip_files.length > 0) {
                        fileList = response.zip_files;
                    } else if (response.download_url) {
                        fileList = [{
                            download_url: response.download_url,
                            filename: response.filename || 'images.zip'
                        }];
                    }

                    if (response.success && fileList.length > 0) {
                        var totalZips = fileList.length;
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

                            var zipInfo = fileList[downloadIndex];
                            _updateToast(dl, downloadIndex, totalZips);

                            try {
                                if (zipInfo.download_url) {
                                    _triggerUrlDownload(zipInfo.download_url, zipInfo.filename || 'images.zip');
                                } else if (zipInfo.data) {
                                    // Backward compatibility for older base64 payloads.
                                    var bin = atob(zipInfo.data);
                                    var bytes = new Uint8Array(bin.length);
                                    for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
                                    var blob = new Blob([bytes], { type: 'application/zip' });
                                    _triggerBlobDownload(blob, zipInfo.filename || 'images.zip');
                                } else {
                                    throw new Error('Missing image file payload');
                                }
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
            _finishToast(dl, 'error', 'Network error  download failed');
        };

        xhr.ontimeout = function () {
            if (dl.status !== 'downloading') return;
            _finishToast(dl, 'error', 'Image download timed out  too many images or slow connection. Try fewer cards.');
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

    function _triggerUrlDownload(url, filename) {
        if (!url) return;
        var a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        if (filename) a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            if (a.parentNode) a.parentNode.removeChild(a);
        }, 100);
    }

    function _pollAsyncExportTask(taskId, dl, opts) {
        var pollCount = 0;
        var maxPolls = 300; // 10 minutes at 2 second interval

        function poll() {
            if (dl.status !== 'downloading') return;

            pollCount++;
            if (pollCount > maxPolls) {
                _finishToast(dl, 'error', 'Export timed out. Please try again.');
                if (typeof opts.onError === 'function') opts.onError('Timeout');
                return;
            }

            fetch('/api/export/status/' + taskId + '/', {
                headers: {
                    'X-CSRFToken': (typeof getCSRFToken === 'function') ? getCSRFToken() : ''
                }
            })
                .then(function (resp) { return resp.json(); })
                .then(function (data) {
                    if (!data.success) {
                        _finishToast(dl, 'error', data.message || 'Export status failed');
                        if (typeof opts.onError === 'function') opts.onError(data.message || 'Export status failed');
                        return;
                    }

                    if (data.state === 'completed') {
                        _triggerUrlDownload(data.download_url, data.filename || (opts.fallbackExt ? ('export.' + opts.fallbackExt) : 'export'));
                        _finishToast(dl, 'complete', opts.completeMessage || 'Downloaded successfully');
                        if (typeof opts.onComplete === 'function') {
                            try { opts.onComplete(null, data.filename || 'export'); } catch (e) { console.error(e); }
                        }
                        return;
                    }

                    if (data.state === 'failed') {
                        _finishToast(dl, 'error', data.message || 'Export failed');
                        if (typeof opts.onError === 'function') opts.onError(data.message || 'Export failed');
                        return;
                    }

                    var progress = Math.max(5, Math.min(95, Number(data.progress || 0)));
                    _updateToast(dl, progress, 100);
                    _updateBlockingOverlay(dl.id, progress, data.message || ('Generating ' + dl.name + '...'), null);
                    setTimeout(poll, 2000);
                })
                .catch(function () {
                    setTimeout(poll, 4000);
                });
        }

        setTimeout(poll, 1000);
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

    function _formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        i = Math.min(i, units.length - 1);
        var val = bytes / Math.pow(1024, i);
        return val.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
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
        },
        // Public API for Upload blocking overlay (can be called from any upload code)
        showUploadOverlay: function(message, cancelFn) {
            var overlay = document.getElementById('blockingOverlay');
            if (!overlay) return;
            _currentOverlayId = 'upload-' + Date.now();
            _bulkUiLockActive = true;
            _setBulkUiLock(true);
            var msgEl = overlay.querySelector('#blockingOverlayMessage');
            var barEl = overlay.querySelector('#blockingOverlayBar');
            var cancelBtn = overlay.querySelector('#blockingOverlayCancelBtn');
            if (msgEl) msgEl.textContent = message || 'Uploading...';
            if (barEl) barEl.style.width = '0%';
            if (cancelBtn) {
                cancelBtn.onclick = function() {
                    if (typeof cancelFn === 'function') cancelFn();
                    DownloadManager.hideUploadOverlay();
                };
            }
            overlay.style.display = 'flex';
            return _currentOverlayId;
        },
        updateUploadOverlay: function(pct, message) {
            var overlay = document.getElementById('blockingOverlay');
            if (!overlay) return;
            var msgEl = overlay.querySelector('#blockingOverlayMessage');
            var barEl = overlay.querySelector('#blockingOverlayBar');
            if (msgEl && message) msgEl.textContent = message;
            if (barEl) barEl.style.width = pct + '%';
        },
        hideUploadOverlay: function() {
            var overlay = document.getElementById('blockingOverlay');
            if (overlay) overlay.style.display = 'none';
            _currentOverlayId = null;
            if (_bulkUiLockActive) {
                _setBulkUiLock(false);
                _bulkUiLockActive = false;
            }
        }
    };

    window.DownloadManager = DownloadManager;
    window.IDCardApp = window.IDCardApp || {};
    window.IDCardApp.DownloadManager = DownloadManager;
    window.IDCardApp.applyBulkUiLock = _setBulkUiLock;
    window.IDCardApp.isBulkUiLocked = function () {
        return !!(document && document.body && document.body.classList.contains('bulk-operation-active'));
    };
    window.IDCardApp.getBulkUiLockDepth = function () {
        return _bulkUiLockDepth;
    };

    // Global shortcuts for upload overlay (convenience for vanilla JS upload code)
    window.showBlockingOverlay = DownloadManager.showUploadOverlay;
    window.updateBlockingOverlay = DownloadManager.updateUploadOverlay;
    window.hideBlockingOverlay = DownloadManager.hideUploadOverlay;

})();
