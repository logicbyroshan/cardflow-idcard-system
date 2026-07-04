(function () {
    'use strict';

    if (window.__downloadPayloadSizePatchApplied) return;
    window.__downloadPayloadSizePatchApplied = true;

    var monitors = {};

    function formatBytes(bytes) {
        var value = Number(bytes || 0);
        if (!isFinite(value) || value <= 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var idx = Math.floor(Math.log(value) / Math.log(1024));
        idx = Math.min(idx, units.length - 1);
        var out = value / Math.pow(1024, idx);
        return out.toFixed(idx === 0 ? 0 : 1) + ' ' + units[idx];
    }

    function ensureSizeNode(toastEl) {
        var existing = toastEl.querySelector('.dl-toast-size');
        if (existing) return existing;

        var pctEl = toastEl.querySelector('.dl-toast-pct');
        if (!pctEl) return null;

        var sizeEl = document.createElement('span');
        sizeEl.className = 'dl-toast-size';
        sizeEl.style.cssText = 'font-size:11px;opacity:.9;margin-left:6px;white-space:nowrap;';
        pctEl.insertAdjacentElement('afterend', sizeEl);
        return sizeEl;
    }

    function stopMonitor(id) {
        if (!monitors[id]) return;
        clearInterval(monitors[id]);
        delete monitors[id];
    }

    function updateToastSize(id) {
        if (!window.DownloadManager || typeof window.DownloadManager.getActive !== 'function') {
            stopMonitor(id);
            return;
        }

        var toastEl = document.getElementById('dl-toast-' + id);
        var active = window.DownloadManager.getActive() || [];
        var info = null;

        for (var i = 0; i < active.length; i++) {
            if (Number(active[i].id) === Number(id)) {
                info = active[i];
                break;
            }
        }

        if (!toastEl) {
            if (!info || (info.status !== 'downloading' && info.status !== 'pending')) {
                stopMonitor(id);
            }
            return;
        }

        if (!info) {
            stopMonitor(id);
            return;
        }

        if (info.status !== 'downloading' && info.status !== 'pending') {
            stopMonitor(id);
            return;
        }

        var sizeEl = ensureSizeNode(toastEl);
        if (!sizeEl) return;

        var loaded = Number(info.loaded || 0);
        var total = Number(info.total || 0);

        if (total > 0) {
            sizeEl.textContent = formatBytes(loaded) + ' / ' + formatBytes(total);
        } else if (loaded > 0) {
            sizeEl.textContent = formatBytes(loaded);
        } else {
            sizeEl.textContent = '';
        }
    }

    function startMonitor(id) {
        if (!id) return;
        stopMonitor(id);

        updateToastSize(id);
        monitors[id] = setInterval(function () {
            updateToastSize(id);
        }, 250);

        setTimeout(function () {
            stopMonitor(id);
        }, 15 * 60 * 1000);
    }

    function patchDownloadManager() {
        var dm = window.DownloadManager;
        if (!dm) return false;
        if (dm.__payloadSizeToastPatched) return true;

        if (typeof dm.start === 'function') {
            var originalStart = dm.start;
            dm.start = function () {
                var id = originalStart.apply(this, arguments);
                startMonitor(id);
                return id;
            };
        }

        if (typeof dm.startImageDownload === 'function') {
            var originalStartImage = dm.startImageDownload;
            dm.startImageDownload = function () {
                var id = originalStartImage.apply(this, arguments);
                startMonitor(id);
                return id;
            };
        }

        dm.__payloadSizeToastPatched = true;
        return true;
    }

    function init() {
        if (patchDownloadManager()) return;

        var attempts = 0;
        var timer = setInterval(function () {
            attempts += 1;
            if (patchDownloadManager() || attempts >= 50) {
                clearInterval(timer);
            }
        }, 200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
