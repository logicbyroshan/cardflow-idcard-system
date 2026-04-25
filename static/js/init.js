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
        
        if (window.Adarsh.debug && status.missing.length > 0) {
            console.warn('Missing modules:', status.missing.join(', '));
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
    // MODAL BRIDGE (shared helper for legacy/custom modals)
    // ==========================================

    function getModalBridgeDefaults(opts) {
        const cfg = Object.assign({
            overlayClass: 'show',
            closeOnEscape: true,
            closeOnOverlayClick: false,
            lockBodyScroll: true,
            focusSelector: null,
            focusDelayMs: 40
        }, opts || {});
        return cfg;
    }

    function openModalViaBridge(id, opts) {
        const cfg = getModalBridgeDefaults(opts);
        const el = document.getElementById(id);
        if (!el) return false;

        if (el.style && el.style.display === 'none') {
            el.dataset.inlineHiddenAtInit = '1';
            el.style.display = '';
        }

        if (window.ModalManager && typeof window.ModalManager.register === 'function') {
            try {
                const ctrl = window.ModalManager.register(id, {
                    overlayClass: cfg.overlayClass,
                    closeOnEscape: cfg.closeOnEscape,
                    closeOnOverlayClick: cfg.closeOnOverlayClick,
                    lockBodyScroll: cfg.lockBodyScroll
                });
                if (ctrl && typeof ctrl.open === 'function') {
                    ctrl.open(cfg.data);
                } else {
                    el.classList.add(cfg.overlayClass);
                }
            } catch (err) {
                el.classList.add(cfg.overlayClass);
            }
        } else {
            el.classList.add(cfg.overlayClass);
        }

        if (cfg.focusSelector) {
            setTimeout(function () {
                const target = el.querySelector(cfg.focusSelector);
                if (target && typeof target.focus === 'function') target.focus();
            }, cfg.focusDelayMs);
        }
        return true;
    }

    function closeModalViaBridge(id, opts) {
        const cfg = getModalBridgeDefaults(opts);
        const el = document.getElementById(id);
        if (!el) return false;

        if (window.ModalManager && typeof window.ModalManager.close === 'function') {
            const closed = window.ModalManager.close(id);
            if (!closed) {
                el.classList.remove(cfg.overlayClass, 'active', 'show', 'open');
            }
        } else {
            el.classList.remove(cfg.overlayClass, 'active', 'show', 'open');
        }

        if (el.dataset.inlineHiddenAtInit === '1' && el.style) {
            el.style.display = 'none';
        }
        return true;
    }

    window.AdarshModalBridge = window.AdarshModalBridge || {
        open: openModalViaBridge,
        close: closeModalViaBridge,
    };

    // ==========================================
    // GLOBAL KEYBOARD SHORTCUTS
    // ==========================================

    function isVisibleElement(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function getOpenModalContainers() {
        const selectors = [
            '.wa-confirm-overlay.show',
            '#coreConfirmOverlay.show',
            '.modal.show',
            '.modal.active',
            '.modal-backdrop',
            '.modal-overlay',
            '.confirm-modal',
            '[role="dialog"][aria-modal="true"]',
            '.drawer.open',
            '.side-drawer.open'
        ];
        const set = new Set();
        selectors.forEach((sel) => {
            document.querySelectorAll(sel).forEach((el) => {
                if (isVisibleElement(el)) set.add(el);
            });
        });
        return Array.from(set);
    }

    function isDismissButton(btn) {
        if (!btn) return true;
        const cls = btn.className || '';
        if (/cancel|close|modal-close|modal-cancel/i.test(cls)) return true;
        const txt = (btn.textContent || '').trim();
        return /^(cancel|close|back|no)$/i.test(txt);
    }

    function scorePrimaryButton(btn) {
        if (!btn || btn.disabled || isDismissButton(btn) || !isVisibleElement(btn)) return -1;
        const id = (btn.id || '').toLowerCase();
        const cls = (btn.className || '').toLowerCase();
        const txt = (btn.textContent || '').toLowerCase();
        const type = (btn.getAttribute('type') || '').toLowerCase();
        let score = 0;

        if (btn.dataset.hotkeyEnter === 'primary') score += 200;
        if (btn.hasAttribute('data-modal-primary') || btn.hasAttribute('data-confirm')) score += 140;
        if (/(confirm|delete|save|submit|apply|move|upgrade|reupload|start|done|ok|yes)/.test(id)) score += 90;
        if (/(btn-danger|btn-primary|btn-save|btn-confirm|danger|primary|confirm)/.test(cls)) score += 80;
        if (type === 'submit' || btn.hasAttribute('data-drawer-submit')) score += 60;
        if (/(confirm|delete|save|submit|apply|move|upgrade|reupload|start|done|ok|yes)/.test(txt)) score += 40;
        if (/(neutral|secondary)/.test(cls)) score -= 20;

        return score;
    }

    function findPrimaryButton(container) {
        if (!container) return null;
        const candidates = container.querySelectorAll('button, input[type="submit"], [type="submit"], a[role="button"], [data-modal-primary], [data-confirm], [data-action="confirm"]');
        let winner = null;
        let best = -1;
        candidates.forEach((btn) => {
            const s = scorePrimaryButton(btn);
            if (s >= best) {
                best = s;
                winner = btn;
            }
        });
        return best > 0 ? winner : null;
    }

    function findDismissButton(container) {
        if (!container) return null;
        const btn = container.querySelector('[data-modal-cancel], .modal-cancel, .cancel-btn, [data-modal-close], .modal-close, .close-btn, .btn-neutral');
        return btn && isVisibleElement(btn) ? btn : null;
    }

    function isConfirmLikeModal(container) {
        if (!container) return false;
        const meta = ((container.id || '') + ' ' + (container.className || '')).toLowerCase();
        if (/(confirm|delete|warning|danger)/.test(meta)) return true;
        if (container.querySelector('.cc-warning, .wa-confirm-warning, .modal-alert, #ccWarning, #waConfirmWarning')) return true;
        const hasNeutral = !!container.querySelector('.btn-neutral, .cancel-btn, .modal-cancel');
        const hasAction = !!container.querySelector('.btn-danger, .btn-primary, .btn-confirm, .btn-save, [data-confirm], [data-modal-primary], [data-drawer-submit], [type="submit"]');
        return hasNeutral && hasAction;
    }

    function initModalActionHotkeys() {
        document.addEventListener('keydown', function (e) {
            if (e.defaultPrevented || e.isComposing) return;
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            if (e.key !== 'Enter' && e.key !== 'Escape') return;

            const openModals = getOpenModalContainers();
            if (!openModals.length) return;
            const activeModal = openModals[openModals.length - 1];

            if (e.key === 'Escape') {
                const dismissBtn = findDismissButton(activeModal);
                if (dismissBtn) {
                    e.preventDefault();
                    dismissBtn.click();
                }
                return;
            }

            const target = e.target;
            if (target && (target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
            if (target && target.closest('button, a, [role="button"]')) return;
            if (!isConfirmLikeModal(activeModal)) return;

            const primaryBtn = findPrimaryButton(activeModal);
            if (primaryBtn) {
                e.preventDefault();
                primaryBtn.click();
            }
        });
    }

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
     * Error handling is managed by htmx-config.html (shows toasts on server errors)
     * and browser DevTools Console for JS errors.
     * No custom error monitoring JS needed.
     */
    function initErrorHandling() {
        // htmx-config.html handles HTMX errors (4xx/5xx  toast)
        // Browser DevTools Console catches JS errors natively
    }

    // ==========================================
    // GLOBAL SESSION INTERCEPTOR (401/403)
    // ==========================================

    /**
     * Intercept 401 Unauthorized errors globally and trigger a page reload.
     * This ensures that when a session expires (e.g. in another tab), the user 
     * is redirected to the login page on their next interaction.
     */
    function initSessionInterceptor() {
        // Intercept native Fetch API
        if (typeof window.fetch === 'function') {
            const originalFetch = window.fetch;
            window.fetch = async function(...args) {
                try {
                    const response = await originalFetch.apply(this, args);
                    if (response.status === 401) {
                        window.location.reload();
                    }
                    return response;
                } catch (err) {
                    throw err;
                }
            };
        }

        // Intercept XMLHttpRequest (for jQuery, HTMX, etc.)
        if (typeof XMLHttpRequest !== 'undefined') {
            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function() {
                this.addEventListener('load', function() {
                    if (this.status === 401) {
                        window.location.reload();
                    }
                });
                return originalOpen.apply(this, arguments);
            }
        }
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

        // Initialize session interceptor (401/403 handling)
        initSessionInterceptor();

        // Initialize global keyboard shortcuts
        initKeyboardShortcuts();

        // Enter/Escape behavior for confirm-style modals across pages
        initModalActionHotkeys();

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
