/**
 * Common Modal Management Module
 * Provides unified modal/drawer handling across all pages
 * 
 * @module common/modal
 * @version 1.0.0
 */

(function() {
    'use strict';

    // ==========================================
    // MODAL REGISTRY
    // ==========================================
    
    const modalRegistry = new Map();
    const drawerRegistry = new Map();

    // ==========================================
    // GENERIC MODAL CONTROLLER
    // ==========================================

    /**
     * Modal Controller Class
     * Handles standard modal open/close behavior with proper body scroll locking
     */
    class ModalController {
        constructor(modalId, options = {}) {
            this.modalId = modalId;
            this.modal = document.getElementById(modalId);
            this.options = {
                overlayClass: 'active',
                lockBodyScroll: true,
                closeOnOverlayClick: true,
                closeOnEscape: true,
                onOpen: null,
                onClose: null,
                ...options
            };
            
            this._bindEvents();
            modalRegistry.set(modalId, this);
        }

        _bindEvents() {
            if (!this.modal) return;

            // Close button
            const closeBtn = this.modal.querySelector('[data-modal-close], .modal-close, .close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.close();
                });
            }

            // Cancel button
            const cancelBtn = this.modal.querySelector('[data-modal-cancel], .modal-cancel, .cancel-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.close();
                });
            }

            // Overlay click to close
            if (this.options.closeOnOverlayClick) {
                this.modal.addEventListener('click', (e) => {
                    if (e.target === this.modal) {
                        this.close();
                    }
                });
            }
        }

        open(data = null) {
            if (!this.modal) return false;

            this.modal.classList.add(this.options.overlayClass);
            
            if (this.options.lockBodyScroll) {
                document.body.style.overflow = 'hidden';
            }

            if (this.options.onOpen) {
                this.options.onOpen(data);
            }

            // Dispatch custom event
            this.modal.dispatchEvent(new CustomEvent('modal:open', { detail: data }));
            
            return true;
        }

        close() {
            if (!this.modal) return false;

            this.modal.classList.remove(this.options.overlayClass);
            
            if (this.options.lockBodyScroll) {
                // Only restore if no other modals are open
                const anyOpen = Array.from(modalRegistry.values()).some(m => m.isOpen() && m !== this);
                if (!anyOpen) {
                    document.body.style.overflow = '';
                }
            }

            if (this.options.onClose) {
                this.options.onClose();
            }

            // Dispatch custom event
            this.modal.dispatchEvent(new CustomEvent('modal:close'));
            
            return true;
        }

        isOpen() {
            return this.modal?.classList.contains(this.options.overlayClass) || false;
        }

        toggle() {
            return this.isOpen() ? this.close() : this.open();
        }
    }

    // ==========================================
    // DRAWER CONTROLLER
    // ==========================================

    /**
     * Drawer Controller Class
     * Handles side drawer/panel behavior with mode support (add/edit/view)
     */
    class DrawerController {
        constructor(drawerId, options = {}) {
            this.drawerId = drawerId;
            this.drawer = document.getElementById(drawerId);
            this.overlay = document.getElementById(`${drawerId}-overlay`) || 
                           document.getElementById(options.overlayId);
            
            this.options = {
                openClass: 'open',
                overlayActiveClass: 'active',
                lockBodyScroll: true,
                closeOnOverlayClick: true,
                closeOnEscape: true,
                onOpen: null,
                onClose: null,
                onModeChange: null,
                modes: {
                    add: { icon: 'fa-plus', title: 'Add New', submitText: 'Add' },
                    edit: { icon: 'fa-pen-to-square', title: 'Edit', submitText: 'Save Changes' },
                    view: { icon: 'fa-eye', title: 'View', submitText: null }
                },
                ...options
            };

            this.currentMode = 'add';
            this.currentData = null;

            // Cache DOM elements
            this._cacheElements();
            this._bindEvents();
            drawerRegistry.set(drawerId, this);
        }

        _cacheElements() {
            if (!this.drawer) return;

            this.elements = {
                closeBtn: this.drawer.querySelector('[data-drawer-close], .drawer-close, .close-btn'),
                cancelBtn: this.drawer.querySelector('[data-drawer-cancel], .drawer-cancel, .cancel-btn'),
                submitBtn: this.drawer.querySelector('[data-drawer-submit], .drawer-submit, [type="submit"]'),
                title: this.drawer.querySelector('[data-drawer-title], .drawer-title span'),
                icon: this.drawer.querySelector('[data-drawer-icon], .drawer-title i'),
                form: this.drawer.querySelector('form')
            };
        }

        _bindEvents() {
            if (!this.drawer) return;

            // Close button
            if (this.elements.closeBtn) {
                this.elements.closeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.close();
                });
            }

            // Cancel button
            if (this.elements.cancelBtn) {
                this.elements.cancelBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.close();
                });
            }

            // Overlay click
            if (this.overlay && this.options.closeOnOverlayClick) {
                this.overlay.addEventListener('click', () => this.close());
            }
        }

        open(mode = 'add', data = null) {
            if (!this.drawer) return false;

            this.currentMode = mode;
            this.currentData = data;

            // Apply mode configuration
            const modeConfig = this.options.modes[mode] || this.options.modes.add;
            
            if (this.elements.icon) {
                this.elements.icon.className = `fa-solid ${modeConfig.icon}`;
            }

            if (this.elements.submitBtn) {
                if (modeConfig.submitText) {
                    this.elements.submitBtn.style.display = '';
                    const textEl = this.elements.submitBtn.querySelector('span') || this.elements.submitBtn;
                    if (textEl.tagName !== 'I') {
                        textEl.textContent = modeConfig.submitText;
                    }
                } else {
                    this.elements.submitBtn.style.display = 'none';
                }
            }

            // Open drawer
            this.drawer.classList.add(this.options.openClass);
            if (this.overlay) {
                this.overlay.classList.add(this.options.overlayActiveClass);
            }

            if (this.options.lockBodyScroll) {
                document.body.style.overflow = 'hidden';
            }

            if (this.options.onModeChange) {
                this.options.onModeChange(mode);
            }

            if (this.options.onOpen) {
                this.options.onOpen(mode, data);
            }

            // Dispatch custom event
            this.drawer.dispatchEvent(new CustomEvent('drawer:open', { detail: { mode, data } }));

            return true;
        }

        close() {
            if (!this.drawer) return false;

            this.drawer.classList.remove(this.options.openClass);
            if (this.overlay) {
                this.overlay.classList.remove(this.options.overlayActiveClass);
            }

            if (this.options.lockBodyScroll) {
                const anyOpen = Array.from(drawerRegistry.values()).some(d => d.isOpen() && d !== this);
                if (!anyOpen) {
                    document.body.style.overflow = '';
                }
            }

            if (this.options.onClose) {
                this.options.onClose();
            }

            // Dispatch custom event
            this.drawer.dispatchEvent(new CustomEvent('drawer:close'));

            return true;
        }

        isOpen() {
            return this.drawer?.classList.contains(this.options.openClass) || false;
        }

        setTitle(title) {
            if (this.elements.title) {
                this.elements.title.textContent = title;
            }
        }

        setSubmitText(text) {
            if (this.elements.submitBtn) {
                const textEl = this.elements.submitBtn.querySelector('span') || this.elements.submitBtn;
                textEl.textContent = text;
            }
        }

        setLoading(loading) {
            if (this.elements.submitBtn) {
                this.elements.submitBtn.disabled = loading;
                const icon = this.elements.submitBtn.querySelector('i');
                if (icon) {
                    if (loading) {
                        icon.dataset.originalClass = icon.className;
                        icon.className = 'fa-solid fa-spinner fa-spin';
                    } else if (icon.dataset.originalClass) {
                        icon.className = icon.dataset.originalClass;
                    }
                }
            }
        }

        resetForm() {
            if (this.elements.form) {
                this.elements.form.reset();
            }
        }

        enableInputs(enabled) {
            if (!this.drawer) return;
            
            const inputs = this.drawer.querySelectorAll('input, select, textarea');
            inputs.forEach(input => {
                input.disabled = !enabled;
                input.readOnly = !enabled;
            });
        }
    }

    // ==========================================
    // GLOBAL ESCAPE KEY HANDLER
    // ==========================================

    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;

        // Close modals in reverse order (most recent first)
        for (const [id, modal] of [...modalRegistry.entries()].reverse()) {
            if (modal.isOpen() && modal.options.closeOnEscape) {
                modal.close();
                e.preventDefault();
                return;
            }
        }

        // Then try drawers
        for (const [id, drawer] of [...drawerRegistry.entries()].reverse()) {
            if (drawer.isOpen() && drawer.options.closeOnEscape) {
                drawer.close();
                e.preventDefault();
                return;
            }
        }
    });

    // ==========================================
    // UTILITY FUNCTIONS
    // ==========================================

    /**
     * Get a modal controller by ID
     * @param {string} modalId - The modal element ID
     * @returns {ModalController|null}
     */
    function getModal(modalId) {
        return modalRegistry.get(modalId) || null;
    }

    /**
     * Get a drawer controller by ID
     * @param {string} drawerId - The drawer element ID
     * @returns {DrawerController|null}
     */
    function getDrawer(drawerId) {
        return drawerRegistry.get(drawerId) || null;
    }

    /**
     * Close all open modals
     */
    function closeAllModals() {
        modalRegistry.forEach(modal => modal.close());
    }

    /**
     * Close all open drawers
     */
    function closeAllDrawers() {
        drawerRegistry.forEach(drawer => drawer.close());
    }

    /**
     * Simple function to open any modal by ID
     * Auto-creates controller if not exists
     */
    function openModal(modalId, data = null) {
        let modal = modalRegistry.get(modalId);
        if (!modal) {
            modal = new ModalController(modalId);
        }
        return modal.open(data);
    }

    /**
     * Simple function to close any modal by ID
     */
    function closeModal(modalId) {
        const modal = modalRegistry.get(modalId);
        if (modal) {
            return modal.close();
        }
        // Fallback: try to close directly
        const element = document.getElementById(modalId);
        if (element) {
            element.classList.remove('active');
            return true;
        }
        return false;
    }

    // ==========================================
    // EXPOSE API
    // ==========================================

    window.AdarshModal = {
        ModalController,
        DrawerController,
        getModal,
        getDrawer,
        openModal,
        closeModal,
        closeAllModals,
        closeAllDrawers,
        registry: {
            modals: modalRegistry,
            drawers: drawerRegistry
        }
    };

    // Legacy compatibility
    window.ModalController = ModalController;
    window.DrawerController = DrawerController;

})();
