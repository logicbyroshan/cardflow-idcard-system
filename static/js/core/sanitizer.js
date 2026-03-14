/**
 * Data Sanitizer Module
 * =====================
 * Enforces clean text-field rules across all forms and Excel imports.
 *
 * ALLOWED characters in plain text fields:
 *   Letters (az, AZ, Unicode/Devanagari etc.)
 *   Digits  (09)
 *   Spaces
 *   Comma   ,
 *   Period  .
 *   Plus    +
 *   Apostrophe ' (common in Indian surnames: D'Souza, O'Brien)
 *   Parentheses ( )
 *   Slash   /  (common in Indian addresses: Plot 1/2)
 *
 * ALWAYS REMOVED (from ALL fields, including email):
 *   Newline \n, carriage return \r, tab \t
 *   Double quote "
 *
 * NOT ALLOWED in plain text fields (but kept for email/url fields):
 *   @, _, #, $, %, ^, &, *, [, ], {, }, |, \, :, ;, <, >, ?, ~, `
 * ALLOWED (hyphen and slash are permitted):
 *   - (hyphen), / (slash)
 *
 * @module core/sanitizer
 * @version 1.0.0
 */
(function () {
    'use strict';

    /**
     * Sanitize a plain text field value.
     * @param {string} value               Raw input text
     * @param {boolean} [keepSlash=true]   Whether to keep '/' (addresses)
     * @returns {{ value: string, changed: boolean, removed: string[] }}
     */
    function sanitizeText(value, keepSlash) {
        if (value === null || value === undefined) return { value: '', changed: false, removed: [] };
        keepSlash = keepSlash !== false; // default true

        var original = String(value);
        var result = original;
        var removed = [];

        // Step 1: Remove control chars (newlines, carriage returns, tabs)
        if (/[\n\r\t]/.test(result)) {
            result = result.replace(/[\n\r\t]+/g, ' ').trim();
            removed.push('newlines/tabs');
        }

        // Step 2: Collapse multiple spaces to one
        result = result.replace(/  +/g, ' ').trim();

        // Step 3: Remove double quotes
        if (result.indexOf('"') !== -1) {
            result = result.replace(/"/g, '');
            removed.push('double quotes (")');
        }

        // Step 4: Remove disallowed special characters
        // Allowed special: , . + ' and optionally /
        var slashPart = keepSlash ? '\\/' : '';
        var forbiddenRe = new RegExp('[^\\w\\s,\\.\\+\'' + slashPart + ']', 'g');
        // But \w includes _ which we don't want  replace \w with explicit chars
        // Allow: letters (a-z, A-Z, Unicode via \p if supported), digits 0-9, space
        // Use a permissive "remove known bad" approach for broad Unicode support
        var badCharsRe = /[_@#$%^&*\[\]{}<>\|\\:;"~`!?=]/g;
        var stripped = result.replace(badCharsRe, '');
        if (stripped !== result) {
            removed.push('special characters (_ - @ # etc.)');
            result = stripped;
        }

        // Step 5: Collapse spaces again after removals
        result = result.replace(/  +/g, ' ').trim();

        return {
            value: result,
            changed: result !== original.replace(/[\n\r\t]+/g, ' ').trim().replace(/  +/g, ' ').trim() ? true : result !== original,
            removed: removed
        };
    }

    /**
     * Sanitize an email field  only remove newlines and double quotes.
     * @param {string} value
     * @returns {{ value: string, changed: boolean, removed: string[] }}
     */
    function sanitizeEmail(value) {
        if (!value) return { value: '', changed: false, removed: [] };
        var original = String(value);
        var result = original.replace(/[\n\r\t\s]+/g, '').replace(/"/g, '');
        return {
            value: result,
            changed: result !== original,
            removed: result !== original ? ['whitespace/newlines in email'] : []
        };
    }

    /**
     * Build a human-readable warning message from sanitizeText results.
     * @param {string[]} removedList
     * @returns {string}
     */
    function buildWarning(removedList) {
        if (!removedList || !removedList.length) return '';
        return 'Removed: ' + removedList.join(', ');
    }

    /**
     * Apply sanitizer to a single <input> or <textarea> element and show
     * an inline warning beneath it if content was changed.
     *
     * @param {HTMLElement} inputEl    The input/textarea element
     * @param {boolean}     isEmail    True for email fields  use sanitizeEmail
     */
    function sanitizeInputElement(inputEl, isEmail) {
        if (!inputEl) return;
        var raw = inputEl.value;
        var result = isEmail ? sanitizeEmail(raw) : sanitizeText(raw);
        if (result.changed) {
            inputEl.value = result.value;
            showInlineHint(inputEl, buildWarning(result.removed), 'warning');
        }
    }

    /**
     * Show (or clear) an inline hint/error message below an input element.
     * Creates a <p class="field-hint"> element on first call, reuses it after.
     *
     * @param {HTMLElement} inputEl
     * @param {string}      message   '' or null to hide
     * @param {string}      type      'warning' | 'error' | 'info'
     */
    function showInlineHint(inputEl, message, type) {
        if (!inputEl) return;
        type = type || 'warning';
        var hintId = 'hint-' + (inputEl.id || inputEl.name || Math.random().toString(36).slice(2));
        var hint = inputEl.parentElement && inputEl.parentElement.querySelector('.field-hint[data-for="' + hintId + '"]');
        if (!hint) {
            hint = document.createElement('p');
            hint.className = 'field-hint';
            hint.setAttribute('data-for', hintId);
            hint.style.cssText = 'font-size:11px;margin:2px 0 0;padding:2px 4px;border-radius:3px;';
            if (inputEl.parentElement) inputEl.parentElement.appendChild(hint);
        }
        if (!message) {
            hint.style.display = 'none';
            hint.textContent = '';
            return;
        }
        var colors = {
            warning: { bg: '#fffbeb', border: '#fde68a', color: '#92400e' },
            error:   { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c' },
            info:    { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af' },
        };
        var c = colors[type] || colors.warning;
        hint.style.background = c.bg;
        hint.style.border = '1px solid ' + c.border;
        hint.style.color = c.color;
        hint.style.display = 'block';
        hint.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="margin-right:3px;"></i>' + message;
    }

    /**
     * Attach live sanitization to all text-like inputs in a form.
     * Call once after the form/drawer is opened.
     *
     * @param {HTMLElement} formEl
     */
    function attachToForm(formEl) {
        if (!formEl) return;
        var inputs = formEl.querySelectorAll('input[type="text"], input[type="tel"], textarea, input:not([type])');
        inputs.forEach(function (el) {
            var isEmail = el.type === 'email' || (el.name && el.name.toLowerCase().includes('email'));
            // Sanitize on blur (after user finishes typing)
            el.addEventListener('blur', function () {
                sanitizeInputElement(el, isEmail);
            });
            // Clear hint when user starts editing again
            el.addEventListener('input', function () {
                showInlineHint(el, '');
            });
        });
        // Also handle email inputs
        var emailInputs = formEl.querySelectorAll('input[type="email"], input[name*="email"], input[id*="email"]');
        emailInputs.forEach(function (el) {
            el.addEventListener('blur', function () { sanitizeInputElement(el, true); });
            el.addEventListener('input', function () { showInlineHint(el, ''); });
        });
    }

    /**
     * Sanitize a plain JS object of form data before API submission.
     * Fields matching email patterns use sanitizeEmail; others use sanitizeText.
     *
     * @param {Object} data         Key-value form data
     * @param {string[]} emailKeys  Field names that are email addresses
     * @returns {{ data: Object, warnings: string[] }}
     */
    function sanitizeFormData(data, emailKeys) {
        emailKeys = emailKeys || ['email'];
        var warnings = [];
        var clean = {};
        Object.keys(data).forEach(function (key) {
            var val = data[key];
            if (typeof val !== 'string') { clean[key] = val; return; }
            var isEmail = emailKeys.some(function (k) { return key.toLowerCase().includes(k); });
            var result = isEmail ? sanitizeEmail(val) : sanitizeText(val);
            clean[key] = result.value;
            if (result.changed && result.removed.length) {
                warnings.push(key + ': ' + buildWarning(result.removed));
            }
        });
        return { data: clean, warnings: warnings };
    }

    /**
     * Sanitize an array of row objects from Excel import.
     * Returns sanitized rows and list of warnings per row.
     *
     * @param {Array<Object>} rows
     * @param {string[]}      emailKeys
     * @returns {{ rows: Array<Object>, warnings: Array<{row: number, field: string, msg: string}> }}
     */
    function sanitizeExcelRows(rows, emailKeys) {
        emailKeys = emailKeys || ['email'];
        var warnings = [];
        var cleaned = rows.map(function (row, idx) {
            var result = sanitizeFormData(row, emailKeys);
            result.warnings.forEach(function (w) {
                warnings.push({ row: idx + 1, field: w.split(':')[0], msg: w });
            });
            return result.data;
        });
        return { rows: cleaned, warnings: warnings };
    }

    //  Expose globally 
    window.DataSanitizer = {
        sanitizeText:        sanitizeText,
        sanitizeEmail:       sanitizeEmail,
        buildWarning:        buildWarning,
        sanitizeInputElement: sanitizeInputElement,
        showInlineHint:      showInlineHint,
        attachToForm:        attachToForm,
        sanitizeFormData:    sanitizeFormData,
        sanitizeExcelRows:   sanitizeExcelRows,
    };

})();
