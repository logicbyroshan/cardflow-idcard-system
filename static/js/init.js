/**
 * Adarsh ID Cards - Main Initialization Module
 * 
 * This file serves as the entry point for the application's JavaScript.
 * It ensures all common modules are loaded and provides a global namespace.
 * 
 * Load Order:
 * 1. core/api.js       - CSRF token, API calls (ApiClient)
 * 2. core/toast.js     - Toast notifications (Toast)
 * 3. core/modal.js     - Modal/Drawer management (ModalManager)
 * 4. core/utils.js     - Image utilities, validation, helpers
 * 5. init.js           - This file (orchestration)
 * 
 * Then page-specific scripts:
 * - dashboard.js        - Dashboard page
 * - manage-staff.js     - Staff management page
 * - group-setting.js    - Group/Table settings page
 * - active-client.js    - Active clients page
 * - idcard-group.js     - ID card groups page
 * - settings.js         - User settings page
 * - idcard-actions-*.js - ID card actions modules
 * 
 * @module init
 * @version 1.0.0
 */

(function() {
    'use strict';

    // ==========================================
    // GLOBAL NAMESPACE
    // ==========================================

    /**
     * Global application namespace
     * All modules should attach to this namespace
     */
    window.Adarsh = window.Adarsh || {
        version: '2.0.0',
        debug: false,
        initialized: false,
        modules: {}
    };

    // ==========================================
    // MODULE VERIFICATION
    // ==========================================

    /**
     * Verify that all required common modules are loaded
     * @returns {Object} { loaded: string[], missing: string[] }
     */
    function verifyModules() {
        const requiredModules = [
            { name: 'Api', check: () => window.ApiClient || window.AdarshAjax },
            { name: 'Toast', check: () => window.Toast || window.AdarshToast || window.showToast },
            { name: 'Modal', check: () => window.ModalManager || window.AdarshModal },
            { name: 'Utils', check: () => window.AdarshUtils || window.escapeHtml }
        ];

        const loaded = [];
        const missing = [];

        requiredModules.forEach(module => {
            if (module.check()) {
                loaded.push(module.name);
            } else {
                missing.push(module.name);
            }
        });

        return { loaded, missing };
    }

    /**
     * Log module status to console (in debug mode)
     */
    function logModuleStatus() {
        const status = verifyModules();
        
        if (window.Adarsh.debug) {
            console.group('🚀 Adarsh ID Cards - Module Status');
            console.log('Loaded:', status.loaded.join(', ') || 'None');
            if (status.missing.length > 0) {
                console.warn('Missing:', status.missing.join(', '));
            }
            console.groupEnd();
        }

        return status;
    }

    // ==========================================
    // IDCARD APP NAMESPACE (Legacy support)
    // ==========================================

    /**
     * IDCardApp namespace for idcard-actions pages
     * Maintains backward compatibility with existing code
     */
    window.IDCardApp = window.IDCardApp || {
        tableId: null,
        currentStatus: 'pending',
        clientId: null,
        
        // Will be populated by idcard-actions-core.js
        getCSRFToken: function() {
            return window.getCSRFToken ? window.getCSRFToken() : '';
        },
        showToast: function(msg, type) {
            if (window.showToast) window.showToast(msg, type);
        },
        apiCall: function(url, method, data) {
            if (window.apiCall) return window.apiCall(url, method, data);
            return Promise.reject(new Error('apiCall not loaded'));
        }
    };

    // ==========================================
    // GLOBAL KEYBOARD SHORTCUTS
    // ==========================================

    /**
     * Initialize global keyboard shortcuts
     */
    function initKeyboardShortcuts() {
        // Escape key is handled by modal.js
        // C/V for sidebar is handled by sidebar.js
        
        document.addEventListener('keydown', function(e) {
            // Don't trigger if user is typing
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }

            // Ctrl/Cmd + F - Focus search (if exists)
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                const searchInput = document.getElementById('searchInput') || 
                                   document.getElementById('search-input') ||
                                   document.querySelector('input[type="search"]');
                if (searchInput) {
                    e.preventDefault();
                    searchInput.focus();
                    searchInput.select();
                }
            }

            // Debug mode toggle: Ctrl+Shift+D
            if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                window.Adarsh.debug = !window.Adarsh.debug;
                console.log(`Debug mode: ${window.Adarsh.debug ? 'ON' : 'OFF'}`);
                if (window.Adarsh.debug) {
                    logModuleStatus();
                }
            }
        });
    }

    // ==========================================
    // SEARCH CLEAR BUTTON (UNIVERSAL)
    // ==========================================

    /**
     * Wire up search clear buttons on any page.
     * Looks for .search-clear-btn inside .search-box and
     * pairs it with the sibling .search-input.
     * Skips pages where idcard-actions-search.js already handles it.
     */
    function initSearchClearButtons() {
        // If idcard-actions search module already loaded, skip
        if (typeof window.initSearchHandlers === 'function') return;

        document.querySelectorAll('.search-box').forEach(function(box) {
            const input = box.querySelector('.search-input');
            const clearBtn = box.querySelector('.search-clear-btn');
            if (!input || !clearBtn) return;

            function updateClear() {
                clearBtn.style.display = input.value.trim() ? 'flex' : 'none';
            }

            input.addEventListener('input', updateClear);

            clearBtn.addEventListener('click', function() {
                input.value = '';
                clearBtn.style.display = 'none';
                input.focus();
                // Fire input event so page-specific search logic re-runs
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });

            // Initial state
            updateClear();
        });
    }

    // ==========================================
    // ERROR HANDLING
    // ==========================================

    /**
     * Global error handler for uncaught errors
     */
    function initErrorHandling() {
        window.addEventListener('error', function(event) {
            if (window.Adarsh.debug) {
                console.error('Global error:', event.error);
            }
            // Don't show toast for script loading errors
            if (!event.filename || event.filename.includes('.js')) {
                return;
            }
        });

        window.addEventListener('unhandledrejection', function(event) {
            if (window.Adarsh.debug) {
                console.error('Unhandled promise rejection:', event.reason);
            }
        });
    }

    // ==========================================
    // INITIALIZATION
    // ==========================================

    /**
     * Main initialization function
     */
    function init() {
        if (window.Adarsh.initialized) return;

        // Log module status
        const status = logModuleStatus();

        // Initialize global keyboard shortcuts
        initKeyboardShortcuts();

        // Initialize search clear buttons (universal)
        initSearchClearButtons();

        // Initialize error handling
        initErrorHandling();

        // Dispatch ready event
        document.dispatchEvent(new CustomEvent('adarsh:ready', { 
            detail: { 
                version: window.Adarsh.version,
                modules: status.loaded
            } 
        }));

        window.Adarsh.initialized = true;

        if (window.Adarsh.debug) {
            console.log('✅ Adarsh ID Cards initialized');
        }
    }

    // ==========================================
    // AUTO-INITIALIZE
    // ==========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ==========================================
    // EXPOSE API
    // ==========================================

    window.Adarsh.verifyModules = verifyModules;
    window.Adarsh.logModuleStatus = logModuleStatus;
    window.Adarsh.init = init;

})();
