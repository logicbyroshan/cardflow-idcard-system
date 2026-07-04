/**
 * Core Utilities Module
 * Shared helpers: HTML escape, image thumbnails, empty-state,
 * string fuzzy-matching, date/time, debounce/throttle, validation.
 *
 * @module core/utils
 * @version 3.0.0
 */

(function () {
    'use strict';

    // ==========================================
    // HTML ESCAPE (XSS prevention)
    // ==========================================
    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = String(str == null ? '' : str);
        return div.innerHTML;
    }

    // ==========================================
    // THUMBNAIL UTILITIES
    // ==========================================
    function getThumbPath(imagePath) {
        if (!imagePath || imagePath === '' || imagePath === 'NOT_FOUND') return null;
        if (imagePath.startsWith('PENDING:')) return null;

        var normalizedPath = String(imagePath).replace(/\\/g, '/');
        normalizedPath = normalizedPath.replace(/^\/media\//, '').replace(/^media\//, '');

        // Reject values that don't look like real file paths (no extension)
        if (normalizedPath.indexOf('.') === -1) return null;

        var parts = normalizedPath.split('/');
        // Change extension to .webp for thumbnail
        var last = parts[parts.length - 1];
        var dotIdx = last.lastIndexOf('.');
        if (dotIdx !== -1) last = last.substring(0, dotIdx) + '.webp';
        parts[parts.length - 1] = last;

        if (parts.length < 2) return 'thumbs/' + parts.join('/');

        return parts[0] + '/thumbs/' + parts.slice(1).join('/');
    }

    function getImageUrl(imagePath, preferThumbnail) {
        if (preferThumbnail === undefined) preferThumbnail = true;
        if (!imagePath || imagePath === '' || imagePath === 'NOT_FOUND') {
            return { src: null, isThumbnail: false, isPlaceholder: true };
        }
        if (imagePath.startsWith('PENDING:')) {
            return { src: null, isThumbnail: false, isPlaceholder: true, isPending: true, pendingRef: imagePath.substring(8) };
        }
        var normalizedPath = String(imagePath).replace(/\\/g, '/').replace(/^\/media\//, '').replace(/^media\//, '');
        var thumbPath = preferThumbnail ? getThumbPath(normalizedPath) : null;
        return {
            src: '/media/' + normalizedPath,
            thumbSrc: thumbPath ? '/media/' + thumbPath : null,
            isThumbnail: false,
            isPlaceholder: false,
            originalPath: normalizedPath
        };
    }

    function loadImageWithFallback(imgEl, imagePath, options) {
        options = options || {};
        var useThumbnail = options.useThumbnail !== false;
        var onLoad  = options.onLoad  || null;
        var onError = options.onError || null;
        var info = getImageUrl(imagePath, useThumbnail);

        if (info.isPlaceholder) { if (onError) onError(info); return; }

        if (useThumbnail && info.thumbSrc) {
            imgEl.onerror = function () {
                imgEl.onerror = function () { if (onError) onError(info); };
                imgEl.src = info.src;
            };
            imgEl.onload = function () { if (onLoad) onLoad(info, true); };
            imgEl.src = info.thumbSrc;
        } else {
            imgEl.onerror = function () { if (onError) onError(info); };
            imgEl.onload  = function () { if (onLoad) onLoad(info, false); };
            imgEl.src = info.src;
        }
    }

    function getShortPath(imagePath) {
        if (!imagePath) return '';
        if (imagePath.startsWith('PENDING:')) return 'Pending: ' + imagePath.substring(8);
        var parts = imagePath.split('/');
        return parts.length >= 2 ? '../' + parts.slice(-2).join('/') : imagePath;
    }

    // ==========================================
    // EMPTY STATE
    // ==========================================
    var EMPTY_STATE_CONFIG = {
        staff:          { icon: 'fa-user-slash',        title: 'No Staff Found',          message: 'Try adjusting your search or filter criteria', actionText: 'Add Staff' },
        clients:        { icon: 'fa-building-slash',    title: 'No Clients Found',        message: 'Try adjusting your search or filter criteria', actionText: 'Add Client' },
        activeClients:  { icon: 'fa-users-slash',       title: 'No Active Clients Found', message: 'No clients are currently active' },
        idCards:        { icon: 'fa-id-card-clip',      title: 'No ID Cards Found',       message: 'Upload ID cards using the bulk upload feature', actionText: 'Upload Cards' },
        groups:         { icon: 'fa-folder-open',       title: 'No Groups Found',         message: 'Create a group to start managing ID cards', actionText: 'Add Group' },
        tables:         { icon: 'fa-table',             title: 'No Tables Found',         message: 'Create a table to define ID card structure', actionText: 'Create Table' },
        searchResults:  { icon: 'fa-magnifying-glass',  title: 'No Results Found',        message: 'Try adjusting your search criteria' }
    };

    function showEmptyState(containerId, contextType, options) {
        contextType = contextType || 'searchResults';
        options = options || {};
        var container = document.getElementById(containerId);
        if (!container) return;
        var cfg = EMPTY_STATE_CONFIG[contextType] || EMPTY_STATE_CONFIG.searchResults;

        var icon = container.querySelector('i');
        if (icon) icon.className = 'fa-solid ' + (options.icon || cfg.icon);

        var title = container.querySelector('h3');
        if (title) title.textContent = options.title || cfg.title;

        var msg = container.querySelector('p');
        if (msg) msg.textContent = options.message || cfg.message;

        var actionBtn = container.querySelector('.empty-state-action');
        if (actionBtn) {
            if (options.showAction && cfg.actionText) {
                actionBtn.style.display = '';
                var btnText = actionBtn.querySelector('span') || actionBtn;
                if (btnText.tagName !== 'I') btnText.textContent = options.actionText || cfg.actionText;
            } else {
                actionBtn.style.display = 'none';
            }
        }
        container.style.display = '';
    }

    function hideEmptyState(containerId) {
        var el = document.getElementById(containerId);
        if (el) el.style.display = 'none';
    }

    // ==========================================
    // STRING UTILITIES
    // ==========================================
    function normalizeFieldName(name) {
        if (!name) return '';
        return name.toLowerCase().replace(/[\s_\-\.]/g, '').replace(/[^a-z0-9]/g, '');
    }

    function levenshteinDistance(a, b) {
        var m = a.length, n = b.length;
        var dp = Array(m + 1).fill(null).map(function () { return Array(n + 1).fill(0); });
        for (var i = 0; i <= m; i++) dp[i][0] = i;
        for (var j = 0; j <= n; j++) dp[0][j] = j;
        for (i = 1; i <= m; i++) {
            for (j = 1; j <= n; j++) {
                dp[i][j] = (a[i - 1] === b[j - 1])
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
        return dp[m][n];
    }

    function findBestMatch(header, tableFields) {
        var norm = normalizeFieldName(header);
        for (var k = 0; k < tableFields.length; k++) {
            if (normalizeFieldName(tableFields[k]) === norm) return { field: tableFields[k], type: 'exact' };
        }
        var best = null, bestDist = Infinity;
        for (k = 0; k < tableFields.length; k++) {
            var nf = normalizeFieldName(tableFields[k]);
            var d  = levenshteinDistance(norm, nf);
            var max = nf.length < 5 ? 1 : 2;
            if (d <= max && d < bestDist) { bestDist = d; best = tableFields[k]; }
        }
        return best ? { field: best, type: 'fuzzy' } : null;
    }

    function normalizeImageIdentifier(identifier) {
        if (identifier == null) return '';
        var result = String(identifier).trim();
        if (!result) return '';
        var num = parseFloat(result);
        if (!isNaN(num) && num === Math.floor(num)) result = String(Math.floor(num));
        var exts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.heif', '.hei'];
        var lower = result.toLowerCase();
        for (var i = 0; i < exts.length; i++) {
            if (lower.endsWith(exts[i])) { result = result.slice(0, -exts[i].length); break; }
        }
        return result.split(/\s+/).join(' ').toUpperCase();
    }

    // ==========================================
    // DATE / TIME
    // ==========================================
    function formatDate(date, options) {
        var d = typeof date === 'string' ? new Date(date) : date;
        var def = { weekday: 'long', year: 'numeric', month: 'short', day: '2-digit' };
        return d.toLocaleDateString('en-US', Object.assign(def, options || {}));
    }

    function formatTime(date) {
        var d = typeof date === 'string' ? new Date(date) : date;
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }

    function generateTimestamp() {
        var n = new Date();
        return '' + n.getFullYear() +
            String(n.getMonth() + 1).padStart(2, '0') +
            String(n.getDate()).padStart(2, '0') + '_' +
            String(n.getHours()).padStart(2, '0') +
            String(n.getMinutes()).padStart(2, '0') +
            String(n.getSeconds()).padStart(2, '0');
    }

    // ==========================================
    // DEBOUNCE / THROTTLE
    // ==========================================
    function debounce(func, wait) {
        wait = wait || 300;
        var timeout;
        return function () {
            var args = arguments, self = this;
            clearTimeout(timeout);
            timeout = setTimeout(function () { func.apply(self, args); }, wait);
        };
    }

    function throttle(func, limit) {
        limit = limit || 300;
        var blocked = false;
        return function () {
            if (blocked) return;
            func.apply(this, arguments);
            blocked = true;
            setTimeout(function () { blocked = false; }, limit);
        };
    }

    // ==========================================
    // SKELETON MINIMUM DISPLAY DELAY
    // ==========================================
    var DEFAULT_SKELETON_DELAY_MS = 350;

    function getSkeletonDelayMs(custom) {
        if (typeof custom === 'number' && !isNaN(custom)) return custom;
        if (typeof window.UI_MIN_SKELETON_MS === 'number' && !isNaN(window.UI_MIN_SKELETON_MS)) {
            return window.UI_MIN_SKELETON_MS;
        }
        return DEFAULT_SKELETON_DELAY_MS;
    }

    function waitForMinDelay(startTime, minMs) {
        var start = typeof startTime === 'number' ? startTime : Date.now();
        var minDelay = getSkeletonDelayMs(minMs);
        var elapsed = Date.now() - start;
        var remaining = Math.max(0, minDelay - elapsed);
        return new Promise(function (resolve) { setTimeout(resolve, remaining); });
    }

    if (typeof window.UI_MIN_SKELETON_MS !== 'number') {
        window.UI_MIN_SKELETON_MS = DEFAULT_SKELETON_DELAY_MS;
    }

    // ==========================================
    // BUTTON LOADING STATE
    // ==========================================
    function setButtonLoading(btn, loading, originalText) {
        if (!btn) return;
        btn.disabled = loading;
        if (loading) {
            btn.dataset._origText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
        } else {
            btn.innerHTML = originalText || btn.dataset._origText || btn.textContent;
        }
    }

    // ==========================================
    // VALIDATION HELPERS
    // ==========================================
    var patterns = {
        email:        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        phone:        /^[\d\s\-+()]{7,20}$/,
        url:          /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([\/\w .-]*)*\/?$/,
        alphanumeric: /^[a-zA-Z0-9]+$/,
        alpha:        /^[a-zA-Z]+$/,
        numeric:      /^[0-9]+$/,
        decimal:      /^[0-9]+(\.[0-9]+)?$/,
        date:         /^\d{4}-\d{2}-\d{2}$/,
        time:         /^\d{2}:\d{2}(:\d{2})?$/
    };

    function isEmpty(v) {
        if (v == null) return true;
        if (typeof v === 'string') return v.trim() === '';
        if (Array.isArray(v)) return v.length === 0;
        if (typeof v === 'object') return Object.keys(v).length === 0;
        return false;
    }

    function isValidEmail(e)   { return !isEmpty(e) && patterns.email.test(e.trim()); }
    function isValidPhone(p)   { return !isEmpty(p) && patterns.phone.test(p.trim()); }
    function isValidUrl(u)     { return !isEmpty(u) && patterns.url.test(u.trim());   }

    function isValidLength(s, min, max) {
        if (typeof s !== 'string') return false;
        var len = s.trim().length;
        return len >= min && len <= (max || Infinity);
    }

    function matchesPattern(value, pat) {
        if (isEmpty(value)) return false;
        var re = typeof pat === 'string' ? patterns[pat] : pat;
        return re ? re.test(value) : false;
    }

    function isValidExtension(filename, allowed) {
        if (isEmpty(filename)) return false;
        var ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
        return allowed.map(function (e) { return e.toLowerCase(); }).includes(ext);
    }

    function isValidFileSize(bytes, maxMB) { return bytes <= maxMB * 1024 * 1024; }

    function validateForm(form, rules) {
        var el = typeof form === 'string' ? document.getElementById(form) : form;
        if (!el) return { valid: false, errors: { form: ['Form not found'] } };
        var errors = {}, valid = true;
        Object.keys(rules).forEach(function (fn) {
            var field = el.querySelector('[name="' + fn + '"]') || el.querySelector('#' + fn);
            if (!field) return;
            var v = field.value, fe = [], r = rules[fn];
            if (r.required && isEmpty(v))          fe.push(r.requiredMessage  || fn + ' is required');
            if (!isEmpty(v)) {
                if (r.email     && !isValidEmail(v))  fe.push(r.emailMessage     || 'Invalid email format');
                if (r.phone     && !isValidPhone(v))  fe.push(r.phoneMessage     || 'Invalid phone number');
                if (r.minLength && v.length < r.minLength) fe.push(r.minLengthMessage || 'Minimum ' + r.minLength + ' characters required');
                if (r.maxLength && v.length > r.maxLength) fe.push(r.maxLengthMessage || 'Maximum ' + r.maxLength + ' characters allowed');
                if (r.pattern   && !matchesPattern(v, r.pattern)) fe.push(r.patternMessage || 'Invalid format');
                if (r.custom    && typeof r.custom === 'function') {
                    var cr = r.custom(v, el);
                    if (cr !== true) fe.push(cr || 'Validation failed');
                }
            }
            if (fe.length) { errors[fn] = fe; valid = false; }
        });
        return { valid: valid, errors: errors };
    }

    function displayErrors(form, errors) {
        var el = typeof form === 'string' ? document.getElementById(form) : form;
        if (!el) return;
        clearErrors(el);
        Object.keys(errors).forEach(function (fn) {
            var field = el.querySelector('[name="' + fn + '"]') || el.querySelector('#' + fn);
            if (!field) return;
            field.classList.add('is-invalid', 'error');
            var c = field.parentElement.querySelector('.error-message, .invalid-feedback');
            if (!c) { c = document.createElement('div'); c.className = 'error-message invalid-feedback'; field.parentElement.appendChild(c); }
            c.textContent = errors[fn][0];
            c.style.display = 'block';
        });
    }

    function clearErrors(form) {
        var el = typeof form === 'string' ? document.getElementById(form) : form;
        if (!el) return;
        el.querySelectorAll('.is-invalid, .error').forEach(function (f) { f.classList.remove('is-invalid', 'error'); });
        el.querySelectorAll('.error-message, .invalid-feedback').forEach(function (m) { m.style.display = 'none'; m.textContent = ''; });
    }

    // ==========================================
    // EXPOSE
    // ==========================================
    window.AdarshUtils = {
        // Image
        getThumbPath: getThumbPath, getImageUrl: getImageUrl,
        loadImageWithFallback: loadImageWithFallback, getShortPath: getShortPath,
        // Empty state
        EMPTY_STATE_CONFIG: EMPTY_STATE_CONFIG,
        showEmptyState: showEmptyState, hideEmptyState: hideEmptyState,
        // Strings
        normalizeFieldName: normalizeFieldName, levenshteinDistance: levenshteinDistance,
        findBestMatch: findBestMatch, normalizeImageIdentifier: normalizeImageIdentifier,
        // Date/time
        formatDate: formatDate, formatTime: formatTime, generateTimestamp: generateTimestamp,
        // Functional
        debounce: debounce, throttle: throttle,
        getSkeletonDelayMs: getSkeletonDelayMs, waitForMinDelay: waitForMinDelay,
        // Buttons
        setButtonLoading: setButtonLoading,
        // Validation
        isEmpty: isEmpty, isValidEmail: isValidEmail, isValidPhone: isValidPhone,
        isValidUrl: isValidUrl, isValidLength: isValidLength, matchesPattern: matchesPattern,
        isValidExtension: isValidExtension, isValidFileSize: isValidFileSize,
        validateForm: validateForm, displayErrors: displayErrors, clearErrors: clearErrors,
        patterns: patterns
    };

    // Namespaced validation alias
    window.AdarshValidation = {
        isEmpty: isEmpty, isValidEmail: isValidEmail, isValidPhone: isValidPhone,
        isValidUrl: isValidUrl, isValidLength: isValidLength, matchesPattern: matchesPattern,
        isValidExtension: isValidExtension, isValidFileSize: isValidFileSize,
        validateForm: validateForm, displayErrors: displayErrors, clearErrors: clearErrors,
        patterns: patterns
    };

    // Legacy globals
    window.escapeHtml              = escapeHtml;
    window.getThumbPath            = getThumbPath;
    window.getImageUrl             = getImageUrl;
    window.loadImageWithFallback   = loadImageWithFallback;
    window.getShortPath            = getShortPath;
    window.EMPTY_STATE_CONFIG      = EMPTY_STATE_CONFIG;
    window.showEmptyState          = showEmptyState;
    window.hideEmptyState          = hideEmptyState;
    window.normalizeFieldName      = normalizeFieldName;
    window.levenshteinDistance      = levenshteinDistance;
    window.findBestMatch           = findBestMatch;
    window.normalizeImageIdentifier = normalizeImageIdentifier;
    window.debounce                = debounce;
    window.throttle                = throttle;
    window.getSkeletonDelayMs      = getSkeletonDelayMs;
    window.waitForMinDelay         = waitForMinDelay;
    window.setButtonLoading        = setButtonLoading;
    window.validateForm            = validateForm;

})();
