/**
 * Core Modal Module
 * Single authority for every modal / drawer in the application.
 *
 * Rules enforced by this module:
 *    Overlay click does NOT close (only close-button or Escape).
 *    Escape closes the topmost open modal / drawer.
 *    No duplicate listeners  each modal is registered once.
 *    Body scroll is locked while any modal / drawer is open.
 *
 * Public API:
 *   ModalManager.open(id, data?)
 *   ModalManager.close(id)
 *   ModalManager.closeAll()
 *   ModalManager.register(id, options?)   auto-called by open() if needed
 *   ModalManager.isOpen(id)
 *   ModalManager.get(id)
 *
 * Low-level (for advanced pages):
 *   new ModalController(id, options)
 *   new DrawerController(id, options)
 *
 * @module core/modal
 * @version 3.0.0
 */

(function () {
    'use strict';

    // ==========================================
    // REGISTRIES
    // ==========================================
    var modalRegistry  = new Map();
    var drawerRegistry = new Map();

    // ==========================================
    // FOCUS TRAP HELPER (a11y)
    // ==========================================
    var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    function _trapFocus(container, e) {
        var focusable = container.querySelectorAll(FOCUSABLE);
        if (!focusable.length) return;
        var first = focusable[0];
        var last  = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    function _autoFocus(container) {
        var el = container.querySelector('[autofocus]') || container.querySelector(FOCUSABLE);
        if (el) setTimeout(function () { el.focus(); }, 50);
    }

    // ==========================================
    // MODAL CONTROLLER
    // ==========================================
    function ModalController(modalId, options) {
        this.modalId = modalId;
        this.modal   = document.getElementById(modalId);
        this.options = Object.assign({
            overlayClass:       'active',
            lockBodyScroll:     true,
            closeOnOverlayClick: false,   //  CHANGED from true
            closeOnEscape:      true,
            onOpen:  null,
            onClose: null
        }, options || {});

        this._bound = false;
        this._bindEvents();
        modalRegistry.set(modalId, this);
    }

    ModalController.prototype._bindEvents = function () {
        if (!this.modal || this._bound) return;
        this._bound = true;
        var self = this;

        // Close button(s)
        this.modal.querySelectorAll('[data-modal-close], .modal-close, .close-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) { e.preventDefault(); self.close(); });
        });

        // Cancel button(s)
        this.modal.querySelectorAll('[data-modal-cancel], .modal-cancel, .cancel-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) { e.preventDefault(); self.close(); });
        });

        // Overlay click  disabled by default
        if (this.options.closeOnOverlayClick) {
            this.modal.addEventListener('click', function (e) {
                if (e.target === self.modal) self.close();
            });
        }
    };

    ModalController.prototype.open = function (data) {
        if (!this.modal) return false;
        // Save trigger element for focus restore (a11y)
        this._triggerEl = document.activeElement;
        this.modal.classList.add(this.options.overlayClass);
        // Set ARIA dialog attributes (a11y)
        this.modal.setAttribute('role', 'dialog');
        this.modal.setAttribute('aria-modal', 'true');
        if (this.options.lockBodyScroll) document.body.style.overflow = 'hidden';
        if (this.options.onOpen) this.options.onOpen(data);
        this.modal.dispatchEvent(new CustomEvent('modal:open', { detail: data }));
        // Focus trap (a11y)
        var self = this;
        this._focusTrapHandler = function (e) { if (e.key === 'Tab') _trapFocus(self.modal, e); };
        document.addEventListener('keydown', this._focusTrapHandler);
        _autoFocus(this.modal);
        return true;
    };

    ModalController.prototype.close = function () {
        if (!this.modal) return false;
        this.modal.classList.remove(this.options.overlayClass);
        // Remove ARIA and focus trap (a11y)
        this.modal.removeAttribute('aria-modal');
        if (this._focusTrapHandler) {
            document.removeEventListener('keydown', this._focusTrapHandler);
            this._focusTrapHandler = null;
        }
        if (this.options.lockBodyScroll) {
            var anyOpen = false;
            modalRegistry.forEach(function (m) { if (m.isOpen()) anyOpen = true; });
            if (!anyOpen) document.body.style.overflow = '';
        }
        if (this.options.onClose) this.options.onClose();
        this.modal.dispatchEvent(new CustomEvent('modal:close'));
        // Restore focus to trigger element (a11y)
        if (this._triggerEl && typeof this._triggerEl.focus === 'function') {
            this._triggerEl.focus();
            this._triggerEl = null;
        }
        return true;
    };

    ModalController.prototype.isOpen = function () {
        return this.modal ? this.modal.classList.contains(this.options.overlayClass) : false;
    };

    ModalController.prototype.toggle = function () {
        return this.isOpen() ? this.close() : this.open();
    };

    // ==========================================
    // DRAWER CONTROLLER
    // ==========================================
    function DrawerController(drawerId, options) {
        this.drawerId = drawerId;
        this.drawer   = document.getElementById(drawerId);
        options = options || {};
        this.overlay  = document.getElementById(drawerId + '-overlay') ||
                        document.getElementById(options.overlayId || '');
        this.options  = Object.assign({
            openClass:           'open',
            overlayActiveClass:  'active',
            lockBodyScroll:      true,
            closeOnOverlayClick: false,   //  CHANGED from true
            closeOnEscape:       true,
            onOpen:  null,
            onClose: null,
            onModeChange: null,
            modes: {
                add:  { icon: 'fa-plus',          title: 'Add New', submitText: 'Add' },
                edit: { icon: 'fa-pen-to-square',  title: 'Edit',    submitText: 'Save Changes' },
                view: { icon: 'fa-eye',            title: 'View',    submitText: null }
            }
        }, options);

        this.currentMode = 'add';
        this.currentData = null;

        this._cacheElements();
        this._bound = false;
        this._bindEvents();
        drawerRegistry.set(drawerId, this);
    }

    DrawerController.prototype._cacheElements = function () {
        if (!this.drawer) return;
        this.elements = {
            closeBtn:  this.drawer.querySelector('[data-drawer-close], .drawer-close, .close-btn'),
            cancelBtn: this.drawer.querySelector('[data-drawer-cancel], .drawer-cancel, .cancel-btn'),
            submitBtn: this.drawer.querySelector('[data-drawer-submit], .drawer-submit, [type="submit"]'),
            title:     this.drawer.querySelector('[data-drawer-title], .drawer-title span'),
            icon:      this.drawer.querySelector('[data-drawer-icon], .drawer-title i'),
            form:      this.drawer.querySelector('form')
        };
    };

    DrawerController.prototype._bindEvents = function () {
        if (!this.drawer || this._bound) return;
        this._bound = true;
        var self = this;

        if (this.elements.closeBtn) {
            this.elements.closeBtn.addEventListener('click', function (e) { e.preventDefault(); self.close(); });
        }
        if (this.elements.cancelBtn) {
            this.elements.cancelBtn.addEventListener('click', function (e) { e.preventDefault(); self.close(); });
        }
        if (this.overlay && this.options.closeOnOverlayClick) {
            this.overlay.addEventListener('click', function () { self.close(); });
        }
    };

    DrawerController.prototype.open = function (mode, data) {
        if (!this.drawer) return false;
        mode = mode || 'add';
        this.currentMode = mode;
        this.currentData = data || null;
        // Save trigger element for focus restore (a11y)
        this._triggerEl = document.activeElement;

        var cfg = this.options.modes[mode] || this.options.modes.add;

        if (this.elements.icon) this.elements.icon.className = 'fa-solid ' + cfg.icon;

        if (this.elements.submitBtn) {
            if (cfg.submitText) {
                this.elements.submitBtn.style.display = '';
                var txt = this.elements.submitBtn.querySelector('span') || this.elements.submitBtn;
                if (txt.tagName !== 'I') txt.textContent = cfg.submitText;
            } else {
                this.elements.submitBtn.style.display = 'none';
            }
        }

        this.drawer.classList.add(this.options.openClass);
        if (this.overlay) this.overlay.classList.add(this.options.overlayActiveClass);
        if (this.options.lockBodyScroll) document.body.style.overflow = 'hidden';
        // Set ARIA dialog attributes (a11y)
        this.drawer.setAttribute('role', 'dialog');
        this.drawer.setAttribute('aria-modal', 'true');
        if (this.options.onModeChange) this.options.onModeChange(mode);
        if (this.options.onOpen) this.options.onOpen(mode, data);
        this.drawer.dispatchEvent(new CustomEvent('drawer:open', { detail: { mode: mode, data: data } }));
        // Focus trap (a11y)
        var self = this;
        this._focusTrapHandler = function (e) { if (e.key === 'Tab') _trapFocus(self.drawer, e); };
        document.addEventListener('keydown', this._focusTrapHandler);
        _autoFocus(this.drawer);
        return true;
    };

    DrawerController.prototype.close = function () {
        if (!this.drawer) return false;
        this.drawer.classList.remove(this.options.openClass);
        if (this.overlay) this.overlay.classList.remove(this.options.overlayActiveClass);
        // Remove ARIA and focus trap (a11y)
        this.drawer.removeAttribute('aria-modal');
        if (this._focusTrapHandler) {
            document.removeEventListener('keydown', this._focusTrapHandler);
            this._focusTrapHandler = null;
        }
        if (this.options.lockBodyScroll) {
            var anyOpen = false;
            drawerRegistry.forEach(function (d) { if (d.isOpen()) anyOpen = true; });
            if (!anyOpen) document.body.style.overflow = '';
        }
        if (this.options.onClose) this.options.onClose();
        this.drawer.dispatchEvent(new CustomEvent('drawer:close'));
        // Restore focus to trigger element (a11y)
        if (this._triggerEl && typeof this._triggerEl.focus === 'function') {
            this._triggerEl.focus();
            this._triggerEl = null;
        }
        return true;
    };

    DrawerController.prototype.isOpen = function () {
        return this.drawer ? this.drawer.classList.contains(this.options.openClass) : false;
    };

    DrawerController.prototype.setTitle = function (title) {
        if (this.elements.title) this.elements.title.textContent = title;
    };

    DrawerController.prototype.setSubmitText = function (text) {
        if (this.elements.submitBtn) {
            var t = this.elements.submitBtn.querySelector('span') || this.elements.submitBtn;
            t.textContent = text;
        }
    };

    DrawerController.prototype.setLoading = function (loading) {
        if (!this.elements.submitBtn) return;
        this.elements.submitBtn.disabled = loading;
        var icon = this.elements.submitBtn.querySelector('i');
        if (icon) {
            if (loading) {
                icon.dataset.originalClass = icon.className;
                icon.className = 'fa-solid fa-spinner fa-spin';
            } else if (icon.dataset.originalClass) {
                icon.className = icon.dataset.originalClass;
            }
        }
    };

    DrawerController.prototype.resetForm = function () {
        if (this.elements.form) this.elements.form.reset();
    };

    DrawerController.prototype.enableInputs = function (enabled) {
        if (!this.drawer) return;
        this.drawer.querySelectorAll('input, select, textarea').forEach(function (el) {
            el.disabled = !enabled;
            el.readOnly = !enabled;
        });
    };

    // ==========================================
    // GLOBAL ESCAPE KEY  single listener
    // ==========================================
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;

        // Close modals (most-recent first)
        var entries = Array.from(modalRegistry.entries()).reverse();
        for (var i = 0; i < entries.length; i++) {
            var m = entries[i][1];
            if (m.isOpen() && m.options.closeOnEscape) {
                m.close();
                e.preventDefault();
                return;
            }
        }

        // Then drawers
        var dEntries = Array.from(drawerRegistry.entries()).reverse();
        for (var j = 0; j < dEntries.length; j++) {
            var d = dEntries[j][1];
            if (d.isOpen() && d.options.closeOnEscape) {
                d.close();
                e.preventDefault();
                return;
            }
        }
    });

    // ==========================================
    // ModalManager  high-level faade
    // ==========================================
    function _getOrRegister(id, options) {
        var existing = modalRegistry.get(id) || drawerRegistry.get(id);
        if (existing) return existing;
        // Auto-detect: if element has class "drawer" treat it as drawer
        var el = document.getElementById(id);
        if (!el) return null;
        if (el.classList.contains('drawer') || el.classList.contains('side-drawer')) {
            return new DrawerController(id, options);
        }
        return new ModalController(id, options);
    }

    var ModalManager = {
        /** Register a modal/drawer before first use (optional  open() auto-registers). */
        register: function (id, options) { return _getOrRegister(id, options); },

        /** Open a modal/drawer by element ID. */
        open: function (id, data) {
            var ctrl = _getOrRegister(id);
            if (!ctrl) return false;
            // DrawerController.open accepts (mode, data), ModalController.open accepts (data)
            if (ctrl instanceof DrawerController) return ctrl.open(data);
            return ctrl.open(data);
        },

        /** Close a modal/drawer by element ID. */
        close: function (id) {
            var ctrl = modalRegistry.get(id) || drawerRegistry.get(id);
            if (ctrl) return ctrl.close();
            // Fallback: remove active class directly
            var el = document.getElementById(id);
            if (el) { el.classList.remove('active', 'open', 'show'); return true; }
            return false;
        },

        /** Close every open modal and drawer. */
        closeAll: function () {
            modalRegistry.forEach(function (m)  { m.close(); });
            drawerRegistry.forEach(function (d) { d.close(); });
        },

        /** Check if a specific modal/drawer is open. */
        isOpen: function (id) {
            var ctrl = modalRegistry.get(id) || drawerRegistry.get(id);
            return ctrl ? ctrl.isOpen() : false;
        },

        /** Retrieve a registered controller. */
        get: function (id) {
            return modalRegistry.get(id) || drawerRegistry.get(id) || null;
        },

        /** Raw registries (for debugging). */
        _modals:  modalRegistry,
        _drawers: drawerRegistry
    };

    // ==========================================
    // EXPOSE
    // ==========================================
    window.ModalManager = ModalManager;

    // Namespaced alias (backward compat)
    window.AdarshModal = {
        ModalController:  ModalController,
        DrawerController: DrawerController,
        getModal:         function (id) { return modalRegistry.get(id) || null; },
        getDrawer:        function (id) { return drawerRegistry.get(id) || null; },
        openModal:        ModalManager.open,
        closeModal:       ModalManager.close,
        closeAllModals:   function () { modalRegistry.forEach(function (m) { m.close(); }); },
        closeAllDrawers:  function () { drawerRegistry.forEach(function (d) { d.close(); }); },
        registry: { modals: modalRegistry, drawers: drawerRegistry }
    };

    // Legacy globals
    window.ModalController  = ModalController;
    window.DrawerController = DrawerController;

})();
