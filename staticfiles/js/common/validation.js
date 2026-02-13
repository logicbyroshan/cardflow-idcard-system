/**
 * Common Validation Module
 * Provides form validation utilities across all pages
 * 
 * @module common/validation
 * @version 1.0.0
 */

(function() {
    'use strict';

    // ==========================================
    // VALIDATION PATTERNS
    // ==========================================

    const patterns = {
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        phone: /^[\d\s\-+()]{7,20}$/,
        url: /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([\/\w .-]*)*\/?$/,
        alphanumeric: /^[a-zA-Z0-9]+$/,
        alpha: /^[a-zA-Z]+$/,
        numeric: /^[0-9]+$/,
        decimal: /^[0-9]+(\.[0-9]+)?$/,
        date: /^\d{4}-\d{2}-\d{2}$/,
        time: /^\d{2}:\d{2}(:\d{2})?$/
    };

    // ==========================================
    // VALIDATION FUNCTIONS
    // ==========================================

    /**
     * Check if a value is empty
     * @param {*} value - Value to check
     * @returns {boolean}
     */
    function isEmpty(value) {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string') return value.trim() === '';
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') return Object.keys(value).length === 0;
        return false;
    }

    /**
     * Validate email format
     * @param {string} email - Email to validate
     * @returns {boolean}
     */
    function isValidEmail(email) {
        if (isEmpty(email)) return false;
        return patterns.email.test(email.trim());
    }

    /**
     * Validate phone number format
     * @param {string} phone - Phone number to validate
     * @returns {boolean}
     */
    function isValidPhone(phone) {
        if (isEmpty(phone)) return false;
        return patterns.phone.test(phone.trim());
    }

    /**
     * Validate URL format
     * @param {string} url - URL to validate
     * @returns {boolean}
     */
    function isValidUrl(url) {
        if (isEmpty(url)) return false;
        return patterns.url.test(url.trim());
    }

    /**
     * Validate string length
     * @param {string} str - String to validate
     * @param {number} min - Minimum length
     * @param {number} max - Maximum length (optional)
     * @returns {boolean}
     */
    function isValidLength(str, min, max = Infinity) {
        if (typeof str !== 'string') return false;
        const len = str.trim().length;
        return len >= min && len <= max;
    }

    /**
     * Validate against a pattern
     * @param {string} value - Value to validate
     * @param {string|RegExp} pattern - Pattern name or RegExp
     * @returns {boolean}
     */
    function matchesPattern(value, pattern) {
        if (isEmpty(value)) return false;
        const regex = typeof pattern === 'string' ? patterns[pattern] : pattern;
        if (!regex) return false;
        return regex.test(value);
    }

    /**
     * Validate file extension
     * @param {string} filename - Filename to check
     * @param {string[]} allowedExtensions - Array of allowed extensions (e.g., ['.jpg', '.png'])
     * @returns {boolean}
     */
    function isValidExtension(filename, allowedExtensions) {
        if (isEmpty(filename)) return false;
        const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
        return allowedExtensions.map(e => e.toLowerCase()).includes(ext);
    }

    /**
     * Validate file size
     * @param {number} sizeInBytes - File size in bytes
     * @param {number} maxSizeInMB - Maximum allowed size in MB
     * @returns {boolean}
     */
    function isValidFileSize(sizeInBytes, maxSizeInMB) {
        return sizeInBytes <= maxSizeInMB * 1024 * 1024;
    }

    // ==========================================
    // FORM VALIDATION
    // ==========================================

    /**
     * Validate a form based on rules
     * @param {HTMLFormElement|string} form - Form element or ID
     * @param {Object} rules - Validation rules object
     * @returns {Object} { valid: boolean, errors: { fieldName: string[] } }
     */
    function validateForm(form, rules) {
        const formEl = typeof form === 'string' ? document.getElementById(form) : form;
        if (!formEl) return { valid: false, errors: { form: ['Form not found'] } };

        const errors = {};
        let valid = true;

        for (const [fieldName, fieldRules] of Object.entries(rules)) {
            const field = formEl.querySelector(`[name="${fieldName}"]`) || 
                          formEl.querySelector(`#${fieldName}`);
            
            if (!field) continue;

            const value = field.value;
            const fieldErrors = [];

            // Required check
            if (fieldRules.required && isEmpty(value)) {
                fieldErrors.push(fieldRules.requiredMessage || `${fieldName} is required`);
            }

            // Only validate further if value exists
            if (!isEmpty(value)) {
                // Email validation
                if (fieldRules.email && !isValidEmail(value)) {
                    fieldErrors.push(fieldRules.emailMessage || 'Invalid email format');
                }

                // Phone validation
                if (fieldRules.phone && !isValidPhone(value)) {
                    fieldErrors.push(fieldRules.phoneMessage || 'Invalid phone number');
                }

                // Min length
                if (fieldRules.minLength && value.length < fieldRules.minLength) {
                    fieldErrors.push(fieldRules.minLengthMessage || `Minimum ${fieldRules.minLength} characters required`);
                }

                // Max length
                if (fieldRules.maxLength && value.length > fieldRules.maxLength) {
                    fieldErrors.push(fieldRules.maxLengthMessage || `Maximum ${fieldRules.maxLength} characters allowed`);
                }

                // Pattern validation
                if (fieldRules.pattern && !matchesPattern(value, fieldRules.pattern)) {
                    fieldErrors.push(fieldRules.patternMessage || 'Invalid format');
                }

                // Custom validation function
                if (fieldRules.custom && typeof fieldRules.custom === 'function') {
                    const customResult = fieldRules.custom(value, formEl);
                    if (customResult !== true) {
                        fieldErrors.push(customResult || 'Validation failed');
                    }
                }
            }

            if (fieldErrors.length > 0) {
                errors[fieldName] = fieldErrors;
                valid = false;
            }
        }

        return { valid, errors };
    }

    /**
     * Display validation errors on form
     * @param {HTMLFormElement|string} form - Form element or ID
     * @param {Object} errors - Errors object from validateForm
     */
    function displayErrors(form, errors) {
        const formEl = typeof form === 'string' ? document.getElementById(form) : form;
        if (!formEl) return;

        // Clear previous errors
        clearErrors(formEl);

        for (const [fieldName, fieldErrors] of Object.entries(errors)) {
            const field = formEl.querySelector(`[name="${fieldName}"]`) || 
                          formEl.querySelector(`#${fieldName}`);
            
            if (!field) continue;

            // Add error class to field
            field.classList.add('is-invalid', 'error');

            // Find or create error container
            let errorContainer = field.parentElement.querySelector('.error-message, .invalid-feedback');
            if (!errorContainer) {
                errorContainer = document.createElement('div');
                errorContainer.className = 'error-message invalid-feedback';
                field.parentElement.appendChild(errorContainer);
            }

            errorContainer.textContent = fieldErrors[0];
            errorContainer.style.display = 'block';
        }
    }

    /**
     * Clear validation errors from form
     * @param {HTMLFormElement|string} form - Form element or ID
     */
    function clearErrors(form) {
        const formEl = typeof form === 'string' ? document.getElementById(form) : form;
        if (!formEl) return;

        formEl.querySelectorAll('.is-invalid, .error').forEach(el => {
            el.classList.remove('is-invalid', 'error');
        });

        formEl.querySelectorAll('.error-message, .invalid-feedback').forEach(el => {
            el.textContent = '';
            el.style.display = 'none';
        });
    }

    /**
     * Set up real-time validation on form inputs
     * @param {HTMLFormElement|string} form - Form element or ID
     * @param {Object} rules - Validation rules
     */
    function setupRealtimeValidation(form, rules) {
        const formEl = typeof form === 'string' ? document.getElementById(form) : form;
        if (!formEl) return;

        for (const fieldName of Object.keys(rules)) {
            const field = formEl.querySelector(`[name="${fieldName}"]`) || 
                          formEl.querySelector(`#${fieldName}`);
            
            if (!field) continue;

            field.addEventListener('blur', function() {
                const result = validateForm(formEl, { [fieldName]: rules[fieldName] });
                if (!result.valid) {
                    displayErrors(formEl, result.errors);
                } else {
                    // Clear error for this field
                    field.classList.remove('is-invalid', 'error');
                    const errorContainer = field.parentElement.querySelector('.error-message, .invalid-feedback');
                    if (errorContainer) {
                        errorContainer.textContent = '';
                        errorContainer.style.display = 'none';
                    }
                }
            });
        }
    }

    // ==========================================
    // EXPOSE API
    // ==========================================

    window.AdarshValidation = {
        // Utility validators
        isEmpty,
        isValidEmail,
        isValidPhone,
        isValidUrl,
        isValidLength,
        matchesPattern,
        isValidExtension,
        isValidFileSize,
        
        // Form validation
        validateForm,
        displayErrors,
        clearErrors,
        setupRealtimeValidation,
        
        // Patterns for custom use
        patterns
    };

    // Legacy compatibility
    window.validateForm = validateForm;

})();
