/**
 * Common Utilities Module (Refactored)
 * Contains: Image utilities, empty state helpers, and other shared utilities
 * 
 * Note: CSRF, Toast, and Modal functions are now in their respective modules:
 * - common/ajax.js - CSRF token and API calls
 * - common/toast.js - Toast notifications
 * - common/modal.js - Modal/Drawer management
 * - common/sidebar.js - Sidebar functionality
 * - common/validation.js - Form validation
 * 
 * @module common/utils
 * @version 2.0.0
 */

(function() {
    'use strict';

    // ==========================================
    // HTML ESCAPE UTILITY (XSS Prevention)
    // ==========================================

    /**
     * Escape HTML special characters to prevent XSS when inserting
     * user-supplied data via innerHTML.
     *
     * @param {*} str - Value to escape (coerced to string)
     * @returns {string} HTML-safe string
     */
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str ?? '');
        return div.innerHTML;
    }

    // Expose globally so every JS file can use it
    window.escapeHtml = escapeHtml;

    // ==========================================
    // THUMBNAIL UTILITIES
    // ==========================================

    /**
     * Convert an image path to its thumbnail path.
     * Follows the server structure: adrsh_img/thumbs/{client_code}/{filename}
     * 
     * @param {string} imagePath - Original image path (e.g., 'adarshimg/ABCDE12345/14325123456101.jpg')
     * @returns {string|null} Thumbnail path (e.g., 'adarshimg/thumbs/ABCDE12345/14325123456101.jpg')
     */
    function getThumbPath(imagePath) {
        if (!imagePath || imagePath === '' || imagePath === 'NOT_FOUND') {
            return null;
        }
        
        // Handle PENDING: prefix
        if (imagePath.startsWith('PENDING:')) {
            return null;
        }
        
        // Split path into parts
        const parts = imagePath.replace(/\\/g, '/').split('/');
        
        if (parts.length < 2) {
            // Just a filename - add thumbs folder
            return `thumbs/${imagePath}`;
        }
        
        // Insert 'thumbs' after the base folder
        // e.g., "adarshimg/ABCDE/123.jpg" -> "adarshimg/thumbs/ABCDE/123.jpg"
        const baseFolder = parts[0];
        const rest = parts.slice(1).join('/');
        
        return `${baseFolder}/thumbs/${rest}`;
    }

    /**
     * Get image URL with fallback to thumbnail or placeholder.
     * 
     * @param {string} imagePath - Image path from field_data
     * @param {boolean} preferThumbnail - Whether to prefer thumbnail (default: true for tables)
     * @returns {Object} Object with {src, isThumbnail, isPlaceholder}
     */
    function getImageUrl(imagePath, preferThumbnail = true) {
        if (!imagePath || imagePath === '' || imagePath === 'NOT_FOUND') {
            return { src: null, isThumbnail: false, isPlaceholder: true };
        }
        
        if (imagePath.startsWith('PENDING:')) {
            return { 
                src: null, 
                isThumbnail: false, 
                isPlaceholder: true, 
                isPending: true, 
                pendingRef: imagePath.substring(8) 
            };
        }
        
        const thumbPath = preferThumbnail ? getThumbPath(imagePath) : null;
        
        return {
            src: `/media/${imagePath}`,
            thumbSrc: thumbPath ? `/media/${thumbPath}` : null,
            isThumbnail: false,
            isPlaceholder: false,
            originalPath: imagePath
        };
    }

    /**
     * Load image with thumbnail fallback.
     * 
     * @param {HTMLImageElement} imgElement - The image element to load into
     * @param {string} imagePath - The image path from field_data
     * @param {Object} options - Options: { useThumbnail: true, onLoad: fn, onError: fn }
     */
    function loadImageWithFallback(imgElement, imagePath, options = {}) {
        const { useThumbnail = true, onLoad = null, onError = null } = options;
        
        const urlInfo = getImageUrl(imagePath, useThumbnail);
        
        if (urlInfo.isPlaceholder) {
            if (onError) onError(urlInfo);
            return;
        }
        
        // Try thumbnail first if available
        if (useThumbnail && urlInfo.thumbSrc) {
            imgElement.onerror = function() {
                // Thumbnail failed, try original
                imgElement.onerror = function() {
                    if (onError) onError(urlInfo);
                };
                imgElement.src = urlInfo.src;
            };
            imgElement.onload = function() {
                if (onLoad) onLoad(urlInfo, true); // true = loaded thumbnail
            };
            imgElement.src = urlInfo.thumbSrc;
        } else {
            // Load original directly
            imgElement.onerror = function() {
                if (onError) onError(urlInfo);
            };
            imgElement.onload = function() {
                if (onLoad) onLoad(urlInfo, false); // false = loaded original
            };
            imgElement.src = urlInfo.src;
        }
    }

    /**
     * Get the short display path from a full image path.
     * 
     * @param {string} imagePath - Full path like 'adarshimg/ABCDE12345/14325123456101.jpg'
     * @returns {string} Short path like '../ABCDE12345/14325123456101.jpg'
     */
    function getShortPath(imagePath) {
        if (!imagePath) return '';
        
        // Handle PENDING: prefix
        if (imagePath.startsWith('PENDING:')) {
            return `Pending: ${imagePath.substring(8)}`;
        }
        
        // Extract folder and filename
        const parts = imagePath.split('/');
        if (parts.length >= 2) {
            return `../${parts.slice(-2).join('/')}`;
        }
        return imagePath;
    }

    // ==========================================
    // EMPTY STATE CONFIGURATION
    // ==========================================

    const EMPTY_STATE_CONFIG = {
        staff: {
            icon: 'fa-user-slash',
            title: 'No Staff Found',
            message: 'Try adjusting your search or filter criteria',
            actionText: 'Add Staff'
        },
        clients: {
            icon: 'fa-building-slash', 
            title: 'No Clients Found',
            message: 'Try adjusting your search or filter criteria',
            actionText: 'Add Client'
        },
        activeClients: {
            icon: 'fa-users-slash',
            title: 'No Active Clients Found',
            message: 'No clients are currently active'
        },
        idCards: {
            icon: 'fa-id-card-clip',
            title: 'No ID Cards Found',
            message: 'Upload ID cards using the bulk upload feature',
            actionText: 'Upload Cards'
        },
        groups: {
            icon: 'fa-folder-open',
            title: 'No Groups Found',
            message: 'Create a group to start managing ID cards',
            actionText: 'Add Group'
        },
        tables: {
            icon: 'fa-table',
            title: 'No Tables Found',
            message: 'Create a table to define ID card structure',
            actionText: 'Create Table'
        },
        searchResults: {
            icon: 'fa-magnifying-glass',
            title: 'No Results Found',
            message: 'Try adjusting your search criteria'
        }
    };

    /**
     * Show empty state for a context
     * @param {string} containerId - ID of the empty state container
     * @param {string} contextType - One of: staff, clients, activeClients, idCards, groups, tables, searchResults
     * @param {Object} options - Optional overrides: { title, message, showAction }
     */
    function showEmptyState(containerId, contextType = 'searchResults', options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const config = EMPTY_STATE_CONFIG[contextType] || EMPTY_STATE_CONFIG.searchResults;
        
        // Update icon
        const icon = container.querySelector('i');
        if (icon) {
            icon.className = `fa-solid ${options.icon || config.icon}`;
        }
        
        // Update title
        const title = container.querySelector('h3');
        if (title) {
            title.textContent = options.title || config.title;
        }
        
        // Update message
        const message = container.querySelector('p');
        if (message) {
            message.textContent = options.message || config.message;
        }
        
        // Show/hide action button
        const actionBtn = container.querySelector('.empty-state-action');
        if (actionBtn) {
            if (options.showAction && config.actionText) {
                actionBtn.style.display = '';
                const btnText = actionBtn.querySelector('span') || actionBtn;
                if (btnText.tagName !== 'I') {
                    btnText.textContent = options.actionText || config.actionText;
                }
            } else {
                actionBtn.style.display = 'none';
            }
        }
        
        container.style.display = '';
    }

    /**
     * Hide empty state
     * @param {string} containerId - ID of the empty state container
     */
    function hideEmptyState(containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            container.style.display = 'none';
        }
    }

    // ==========================================
    // STRING UTILITIES
    // ==========================================

    /**
     * Normalize a field name for comparison
     * @param {string} name - Field name
     * @returns {string} Normalized name
     */
    function normalizeFieldName(name) {
        if (!name) return '';
        return name.toLowerCase()
            .replace(/[\s_\-\.]/g, '')
            .replace(/[^a-z0-9]/g, '');
    }

    /**
     * Levenshtein distance for fuzzy matching
     * @param {string} str1 
     * @param {string} str2 
     * @returns {number}
     */
    function levenshteinDistance(str1, str2) {
        const m = str1.length;
        const n = str2.length;
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
        
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                } else {
                    dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
                }
            }
        }
        return dp[m][n];
    }

    /**
     * Find best matching field with fuzzy logic
     * @param {string} uploadedHeader - Header from uploaded file
     * @param {string[]} tableFields - Available table fields
     * @returns {Object|null} { field, type: 'exact'|'fuzzy' } or null
     */
    function findBestMatch(uploadedHeader, tableFields) {
        const normalizedUploaded = normalizeFieldName(uploadedHeader);
        
        // Exact match first
        for (const field of tableFields) {
            if (normalizeFieldName(field) === normalizedUploaded) {
                return { field, type: 'exact' };
            }
        }
        
        // Fuzzy match
        let bestMatch = null;
        let bestDistance = Infinity;
        
        for (const field of tableFields) {
            const normalizedField = normalizeFieldName(field);
            const distance = levenshteinDistance(normalizedUploaded, normalizedField);
            
            const maxDistance = normalizedField.length < 5 ? 1 : 2;
            
            if (distance <= maxDistance && distance < bestDistance) {
                bestDistance = distance;
                bestMatch = field;
            }
        }
        
        if (bestMatch) {
            return { field: bestMatch, type: 'fuzzy' };
        }
        
        return null;
    }

    /**
     * Normalize an image identifier for consistent matching
     * @param {string|number} identifier - Raw identifier from Excel or ZIP filename
     * @returns {string} Normalized uppercase string for matching
     */
    function normalizeImageIdentifier(identifier) {
        if (identifier === null || identifier === undefined) return '';
        
        // Convert to string and trim
        let result = String(identifier).trim();
        if (!result) return '';
        
        // Handle numeric values (from Excel: 1.0 -> "1")
        const numVal = parseFloat(result);
        if (!isNaN(numVal) && numVal === Math.floor(numVal)) {
            result = String(Math.floor(numVal));
        }
        
        // Remove common image extensions if present
        const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
        const lowerResult = result.toLowerCase();
        for (const ext of validExtensions) {
            if (lowerResult.endsWith(ext)) {
                result = result.slice(0, -ext.length);
                break;
            }
        }
        
        // Normalize internal whitespace
        result = result.split(/\s+/).join(' ');
        
        // Convert to uppercase for consistent matching
        return result.toUpperCase();
    }

    // ==========================================
    // DATE/TIME UTILITIES
    // ==========================================

    /**
     * Format date for display
     * @param {Date|string} date - Date to format
     * @param {Object} options - Intl.DateTimeFormat options
     * @returns {string}
     */
    function formatDate(date, options = {}) {
        const d = typeof date === 'string' ? new Date(date) : date;
        const defaultOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'short',
            day: '2-digit'
        };
        return d.toLocaleDateString('en-US', { ...defaultOptions, ...options });
    }

    /**
     * Format time for display
     * @param {Date|string} date - Date to format
     * @returns {string}
     */
    function formatTime(date) {
        const d = typeof date === 'string' ? new Date(date) : date;
        return d.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    /**
     * Generate timestamp string for filenames
     * @returns {string} Format: YYYYMMDD_HHMMSS
     */
    function generateTimestamp() {
        const now = new Date();
        return now.getFullYear().toString() + 
               (now.getMonth() + 1).toString().padStart(2, '0') + 
               now.getDate().toString().padStart(2, '0') + '_' +
               now.getHours().toString().padStart(2, '0') + 
               now.getMinutes().toString().padStart(2, '0') + 
               now.getSeconds().toString().padStart(2, '0');
    }

    // ==========================================
    // DEBOUNCE/THROTTLE
    // ==========================================

    /**
     * Debounce function calls
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in ms
     * @returns {Function}
     */
    function debounce(func, wait = 300) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Throttle function calls
     * @param {Function} func - Function to throttle
     * @param {number} limit - Time limit in ms
     * @returns {Function}
     */
    function throttle(func, limit = 300) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func(...args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // ==========================================
    // EXPOSE API
    // ==========================================

    window.AdarshUtils = {
        // Image utilities
        getThumbPath,
        getImageUrl,
        loadImageWithFallback,
        getShortPath,
        
        // Empty state
        EMPTY_STATE_CONFIG,
        showEmptyState,
        hideEmptyState,
        
        // String utilities
        normalizeFieldName,
        levenshteinDistance,
        findBestMatch,
        normalizeImageIdentifier,
        
        // Date/time
        formatDate,
        formatTime,
        generateTimestamp,
        
        // Function utilities
        debounce,
        throttle
    };

    // Legacy global compatibility
    window.getThumbPath = getThumbPath;
    window.getImageUrl = getImageUrl;
    window.loadImageWithFallback = loadImageWithFallback;
    window.getShortPath = getShortPath;
    window.EMPTY_STATE_CONFIG = EMPTY_STATE_CONFIG;
    window.showEmptyState = showEmptyState;
    window.hideEmptyState = hideEmptyState;
    window.normalizeFieldName = normalizeFieldName;
    window.levenshteinDistance = levenshteinDistance;
    window.findBestMatch = findBestMatch;
    window.normalizeImageIdentifier = normalizeImageIdentifier;
    window.debounce = debounce;
    window.throttle = throttle;

})();
