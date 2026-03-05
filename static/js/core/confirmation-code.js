/**
 * Confirmation Code Utility
 * Centralised 10-digit numeric code generation & verification
 * used by all confirmation modals across the application.
 *
 * Usage:
 *   const code = ConfirmationCode.generate();   // "3847291056"
 *   ConfirmationCode.verify(input, expected);    // true / false
 *
 * @module core/confirmation-code
 * @version 1.0.0
 */
(function () {
    'use strict';

    var CODE_LENGTH = 10;
    var CODE_MIN    = 1000000000;  // 10-digit minimum
    var CODE_MAX    = 9000000000;  // range so result is always 10 digits

    /**
     * Generate a random 10-digit numeric string.
     * @returns {string} e.g. "4829103756"
     */
    function generate() {
        return String(Math.floor(CODE_MIN + Math.random() * CODE_MAX));
    }

    /**
     * Verify that the user-entered value matches the expected code.
     * Trims whitespace and coerces both to strings before comparing.
     * @param {string} input    - value entered by user
     * @param {string} expected - the code that was displayed
     * @returns {boolean}
     */
    function verify(input, expected) {
        if (!input || !expected) return false;
        return String(input).trim() === String(expected).trim();
    }

    /**
     * Check whether a string looks like a valid 10-digit numeric code.
     * @param {string} value
     * @returns {boolean}
     */
    function isValid(value) {
        if (!value) return false;
        var v = String(value).trim();
        return v.length === CODE_LENGTH && /^\d{10}$/.test(v);
    }

    // Public API
    var ConfirmationCode = {
        generate: generate,
        verify:   verify,
        isValid:  isValid,
        CODE_LENGTH: CODE_LENGTH
    };

    // Expose globally
    window.ConfirmationCode = ConfirmationCode;

})();
