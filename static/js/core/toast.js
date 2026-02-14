/**
 * Core Toast Module
 * Single authority for all toast / notification display.
 *
 * Public API:
 *   Toast.success(msg, duration?)
 *   Toast.error(msg, duration?)
 *   Toast.info(msg, duration?)
 *   Toast.warning(msg, duration?)
 *   Toast.progress(msg, percent?)     // percent = -1 → indeterminate
 *   Toast.complete(msg?)
 *   Toast.hide()
 *
 * @module core/toast
 * @version 3.0.0
 */

(function () {
    'use strict';

    // ------------------------------------------
    // STATE
    // ------------------------------------------
    var _toastTimeout    = null;
    var _progressTimeout = null;

    // ------------------------------------------
    // ICON MAP
    // ------------------------------------------
    var ICONS = {
        success: 'fa-check-circle',
        error:   'fa-times-circle',
        info:    'fa-info-circle',
        warning: 'fa-exclamation-triangle'
    };

    // ------------------------------------------
    // ENSURE DOM ELEMENT EXISTS
    // ------------------------------------------
    function _ensureEl() {
        var toast = document.getElementById('toast');
        if (toast) return toast;
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        toast.innerHTML =
            '<i id="toastIcon" class="fa-solid fa-check-circle"></i>' +
            '<span id="toastMessage">Success!</span>' +
            '<span id="toastPercent" style="display:none;margin-left:8px;font-weight:600;"></span>' +
            '<div id="toastProgress" class="toast-progress" style="display:none;">' +
            '  <div id="toastProgressBar" class="toast-progress-bar"></div>' +
            '</div>';
        document.body.appendChild(toast);
        return toast;
    }

    // ------------------------------------------
    // LOW-LEVEL: showToast
    // ------------------------------------------
    function showToast(message, type, duration) {
        // Normalise type (boolean → string)
        if (typeof type === 'boolean') type = type ? 'success' : 'error';
        type     = type || 'success';
        duration = (duration !== undefined) ? duration : 3000;

        if (_toastTimeout) { clearTimeout(_toastTimeout); _toastTimeout = null; }

        var toast       = _ensureEl();
        var msgEl       = document.getElementById('toastMessage')     || toast.querySelector('span');
        var iconEl      = document.getElementById('toastIcon')        || toast.querySelector('i');
        var progressEl  = document.getElementById('toastProgress');
        var barEl       = document.getElementById('toastProgressBar');

        if (msgEl)  msgEl.textContent = message;
        if (iconEl) iconEl.className  = 'fa-solid ' + (ICONS[type] || ICONS.success);

        if (progressEl) progressEl.style.display = 'none';
        if (barEl) { barEl.classList.remove('indeterminate'); barEl.style.width = '0%'; }

        toast.className = 'toast show ' + type;

        _toastTimeout = setTimeout(function () { toast.classList.remove('show'); }, duration);
    }

    // ------------------------------------------
    // PROGRESS TOAST
    // ------------------------------------------
    function showProgressToast(message, progress) {
        if (progress === undefined) progress = -1;
        if (_progressTimeout) { clearTimeout(_progressTimeout); _progressTimeout = null; }

        var toast      = _ensureEl();
        var msgEl      = document.getElementById('toastMessage')      || toast.querySelector('span');
        var iconEl     = document.getElementById('toastIcon')         || toast.querySelector('i');
        var progressEl = document.getElementById('toastProgress');
        var barEl      = document.getElementById('toastProgressBar');
        var pctEl      = document.getElementById('toastPercent');

        if (msgEl)  msgEl.textContent = message;
        if (iconEl) iconEl.className  = 'fa-solid fa-spinner fa-spin';
        if (progressEl) progressEl.style.display = 'block';

        if (pctEl) {
            if (progress >= 0) {
                pctEl.style.display = 'inline';
                pctEl.textContent   = Math.round(progress) + '%';
            } else {
                pctEl.style.display = 'none';
            }
        }

        if (barEl) {
            if (progress < 0) {
                barEl.classList.add('indeterminate');
                barEl.style.width = '30%';
            } else {
                barEl.classList.remove('indeterminate');
                barEl.style.width = Math.min(progress, 100) + '%';
            }
        }

        toast.className = 'toast show downloading';
    }

    // ------------------------------------------
    // COMPLETE TOAST
    // ------------------------------------------
    function showDownloadComplete(message) {
        message = message || 'Successfully downloaded!';
        if (_progressTimeout) { clearTimeout(_progressTimeout); _progressTimeout = null; }

        var toast      = _ensureEl();
        var msgEl      = document.getElementById('toastMessage')      || toast.querySelector('span');
        var iconEl     = document.getElementById('toastIcon')         || toast.querySelector('i');
        var progressEl = document.getElementById('toastProgress');
        var barEl      = document.getElementById('toastProgressBar');
        var pctEl      = document.getElementById('toastPercent');

        if (msgEl)  msgEl.textContent = message;
        if (iconEl) iconEl.className  = 'fa-solid fa-check-circle';
        if (progressEl) progressEl.style.display = 'block';
        if (barEl)  { barEl.classList.remove('indeterminate'); barEl.style.width = '100%'; }
        if (pctEl)  { pctEl.style.display = 'inline'; pctEl.textContent = '100%'; }

        toast.className = 'toast show success';

        _progressTimeout = setTimeout(function () {
            toast.classList.remove('show');
            if (progressEl) progressEl.style.display = 'none';
            if (barEl) barEl.style.width = '0%';
        }, 3000);
    }

    // ------------------------------------------
    // HIDE
    // ------------------------------------------
    function hideToast() {
        var toast = document.getElementById('toast');
        if (toast) toast.classList.remove('show');
        if (_toastTimeout)    { clearTimeout(_toastTimeout);    _toastTimeout    = null; }
        if (_progressTimeout) { clearTimeout(_progressTimeout); _progressTimeout = null; }
    }

    // ------------------------------------------
    // PUBLIC CLASS
    // ------------------------------------------
    var Toast = {
        success:  function (msg, dur) { showToast(msg, 'success', dur); },
        error:    function (msg, dur) { showToast(msg, 'error',   dur); },
        info:     function (msg, dur) { showToast(msg, 'info',    dur); },
        warning:  function (msg, dur) { showToast(msg, 'warning', dur); },
        progress: showProgressToast,
        complete: showDownloadComplete,
        hide:     hideToast
    };

    // ------------------------------------------
    // EXPOSE
    // ------------------------------------------
    window.Toast = Toast;

    // Namespaced alias
    window.AdarshToast = {
        show:         showToast,
        showProgress: showProgressToast,
        showComplete: showDownloadComplete,
        hide:         hideToast
    };

    // Legacy globals
    window.showToast            = showToast;
    window.showProgressToast    = showProgressToast;
    window.showDownloadComplete = showDownloadComplete;
    window.hideToast            = hideToast;
    window.hideProgressToast    = hideToast;

})();
