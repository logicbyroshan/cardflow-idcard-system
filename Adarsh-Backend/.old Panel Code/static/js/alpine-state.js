/**
 * Alpine.js Global State Module
 * Provides unified UI state management across all pages
 *
 * Components:
 *   layoutState()      - sidebar, modals, toasts, loading (every page)
 *   sideModalState()   - ID Card side modal (add/edit/view)
 *   tableSelection()   - checkbox selection for tables
 *   inlineEditState()  - inline cell editing
 *   uploadProgress()   - upload progress tracking
 *   permToggle()       - permission toggle with optimistic update
 *
 * @module alpine-state
 * @version 2.0.0
 */

// ==========================================
// LAYOUT STATE CONTROLLER
// ==========================================

function layoutState() {
    return {
        // ---- Sidebar ----
        sidebarOpen: localStorage.getItem('sidebarCollapsed') !== 'true',

        // ---- Modal state ----
        activeModal: null,
        modalData: null,
        confirmModal: null,

        // ---- Delete confirmation code ----
        deleteCode: '',
        deleteCodeInput: '',

        // ---- Toast queue ----
        toastQueue: [],

        // ---- Global loading ----
        loading: false,

        // ---- CSP-safe Alpine booleans used by x-show ----
        get hasToasts() {
            return Array.isArray(this.toastQueue) && this.toastQueue.length > 0;
        },

        get sidebarToggleIconClass() {
            return this.sidebarOpen ? 'fa-xmark' : 'fa-bars';
        },

        get isCreateXlsxModalOpen() {
            return this.activeModal === 'createXlsx';
        },

        get isDownloadAllModalOpen() {
            return this.activeModal === 'downloadAll';
        },

        get isDeleteAllModalOpen() {
            return this.activeModal === 'deleteAll';
        },

        get isUpgradeAllModalOpen() {
            return this.activeModal === 'upgradeAll';
        },

        get isReuploadModalOpen() {
            return this.activeModal === 'reupload';
        },

        get isDeleteModalOpen() {
            return this.activeModal === 'delete';
        },

        get isStatusModalOpen() {
            return this.activeModal === 'status';
        },

        get deleteVerificationCodeDisplay() {
            return this.deleteCode ? this.deleteCode : '----------';
        },

        get deleteCodeInputClass() {
            if (!this.deleteCodeInput) return '';
            return this.deleteCodeInput === this.deleteCode ? 'valid' : 'invalid';
        },

        get showDeleteCodeError() {
            return !!this.deleteCodeInput && this.deleteCodeInput.length === 10 && this.deleteCodeInput !== this.deleteCode;
        },

        get canDeleteConfirm() {
            return !!this.deleteCodeInput && this.deleteCodeInput.length === 10 && this.deleteCodeInput === this.deleteCode;
        },

        get disableDeleteConfirm() {
            return !this.canDeleteConfirm;
        },

        // ---- Filter / search state (bridged from vanilla JS) ----
        searchQuery: '',
        filterValue: '',

        // ================================================
        // INIT
        // ================================================
        init() {
            this.applySidebarState();
            this.initKeyboardShortcuts();
            this.bindSidebarToggle();
            this.initSidebarClock();
            this._bridgeLegacy();
        },

        // ================================================
        // SIDEBAR
        // ================================================
        toggleSidebar() {
            this.sidebarOpen = !this.sidebarOpen;
            localStorage.setItem('sidebarCollapsed', !this.sidebarOpen);
            this.applySidebarState();
        },

        applySidebarState() {
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            if (this.sidebarOpen) {
                sidebar.classList.remove('collapsed');
                document.body.classList.remove('sidebar-collapsed');
            } else {
                sidebar.classList.add('collapsed');
                document.body.classList.add('sidebar-collapsed');
            }
        },

        bindSidebarToggle() {
            const btn = document.getElementById('sidebarToggle');
            if (btn && !btn.hasAttribute('@click')) {
                btn.addEventListener('click', () => this.toggleSidebar());
            }
        },

        initSidebarClock() {
            const dateEl = document.getElementById('date');
            const timeEl = document.getElementById('time');
            if (!dateEl && !timeEl) return;
            var _lastSec = -1;
            var _rafId = null;
            const tick = () => {
                const now = new Date();
                const sec = now.getSeconds();
                if (sec !== _lastSec) {          // update DOM at most once per second
                    _lastSec = sec;
                    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                    if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                }
                _rafId = requestAnimationFrame(tick);
            };
            // Only tick when tab is visible
            const onVis = () => {
                if (document.hidden) {
                    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
                } else {
                    _lastSec = -1;               // force immediate update
                    if (!_rafId) _rafId = requestAnimationFrame(tick);
                }
            };
            document.addEventListener('visibilitychange', onVis);
            tick();
        },

        initKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                // Escape closes active modal first
                if (e.key === 'Escape' && this.activeModal) {
                    this.closeModal();
                    return;
                }
            });
        },

        // ================================================
        // MODAL MANAGEMENT
        // ================================================
        openModal(name, data) {
            this.activeModal = name;
            this.modalData = data || null;
            // Generate a fresh 10-digit verification code for Alpine-driven delete modals
            if (name === 'delete') {
                this.deleteCode = (typeof ConfirmationCode !== 'undefined') ? ConfirmationCode.generate() : (Math.floor(1000000000 + Math.random() * 9000000000)).toString();
                this.deleteCodeInput = '';
            }
            document.body.style.overflow = 'hidden';
        },

        closeModal() {
            this.activeModal = null;
            this.modalData = null;
            this.confirmModal = null;
            this.deleteCode = '';
            this.deleteCodeInput = '';
            document.body.style.overflow = '';
        },

        showConfirm(opts) {
            this.confirmModal = {
                title:       opts.title       || 'Confirm',
                message:     opts.message     || 'Are you sure?',
                confirmText: opts.confirmText || 'Yes',
                cancelText:  opts.cancelText  || 'Cancel',
                danger:      opts.danger      || false,
                onConfirm:   opts.onConfirm   || null,
                onCancel:    opts.onCancel     || null
            };
            this.activeModal = '__confirm__';
            document.body.style.overflow = 'hidden';
        },

        confirmAction() {
            if (this.confirmModal && typeof this.confirmModal.onConfirm === 'function') {
                this.confirmModal.onConfirm();
            }
            this.closeModal();
        },

        cancelConfirm() {
            if (this.confirmModal && typeof this.confirmModal.onCancel === 'function') {
                this.confirmModal.onCancel();
            }
            this.closeModal();
        },

        // ================================================
        // TOAST NOTIFICATIONS
        // ================================================
        showToast(message, type) {
            // Normalise boolean  string (matches core/toast.js behaviour)
            if (typeof type === 'boolean') type = type ? 'success' : 'error';
            type = type || 'success';
            // Deduplicate: skip if same message is already in the queue
            if (this.toastQueue.some(t => t.message === message)) return;
            const id = Date.now() + Math.random();
            this.toastQueue.push({
                id,
                message,
                type,
                toastClass: this.getToastClass(type),
                toastIcon: this.getToastIcon(type)
            });
            setTimeout(() => {
                this.toastQueue = this.toastQueue.filter(t => t.id !== id);
            }, 4000);
        },

        getToastIcon(type) {
            return { success: 'fa-solid fa-circle-check', error: 'fa-solid fa-circle-xmark', warning: 'fa-solid fa-exclamation-triangle', info: 'fa-solid fa-circle-info' }[type] || 'fa-solid fa-circle-check';
        },

        getToastClass(type) {
            return { success: 'toast-success', error: 'toast-error', warning: 'toast-warning', info: 'toast-info' }[type] || 'toast-success';
        },

        // ================================================
        // LOADING STATE
        // ================================================
        startLoading() { this.loading = true; },
        stopLoading()  { this.loading = false; },

        // ================================================
        // TABLE SELECTION STATE (bridged from vanilla JS)
        // ================================================
        selectionCount: 0,
        selectedIds: [],

        /**
         * Called by vanilla JS after any selection change.
         * Updates reactive state so Alpine :disabled, x-show, x-text
         * directives respond automatically.
         */
        updateSelection(ids) {
            this.selectedIds = Array.isArray(ids) ? ids : [];
            this.selectionCount = this.selectedIds.length;
        },

        clearSelection() {
            this.selectedIds = [];
            this.selectionCount = 0;
        },

        // ================================================
        // FILTER / SEARCH STATE (bridged from vanilla JS)
        // ================================================

        /**
         * Called by vanilla JS when search query changes.
         * Keeps Alpine in sync so templates can use x-text="searchQuery" etc.
         */
        updateSearchQuery(query) {
            this.searchQuery = query || '';
        },

        /**
         * Called by vanilla JS when a filter value changes.
         * @param {string} value - The new filter value (e.g. 'active', 'inactive', 'all', 'name')
         */
        updateFilterValue(value) {
            this.filterValue = value || '';
        },

        // ================================================
        // LEGACY BRIDGES
        // ================================================
        _bridgeLegacy() {
            window.alpineShowToast        = (message, type) => this.showToast(message, type);
            window.alpineOpenModal        = (name, data)    => this.openModal(name, data);
            window.alpineCloseModal       = ()              => this.closeModal();
            window.alpineShowConfirm      = (opts)          => this.showConfirm(opts);
            window.alpineUpdateSelection  = (ids)           => this.updateSelection(ids);
            window.alpineClearSelection   = ()              => this.clearSelection();
            window.alpineUpdateSearch     = (query)         => this.updateSearchQuery(query);
            window.alpineUpdateFilter     = (value)         => this.updateFilterValue(value);
            window.alpineShowLoading      = ()              => this.startLoading();
            window.alpineHideLoading      = ()              => this.stopLoading();

            // Upload progress bridges  vanilla JS can feed into
            // any Alpine uploadProgress() component via these globals.
            // Components self-register on init (see uploadProgress._bridgeGlobals).
        }
    };
}

// ==========================================
// SIDE MODAL STATE CONTROLLER (ID Card Add/Edit/View)
// ==========================================

function sideModalState() {
    return {
        isOpen: false,
        mode: 'add',

        openModal(newMode) {
            this.mode = newMode || 'add';
            this.isOpen = true;
            document.body.style.overflow = 'hidden';
        },

        closeModal() {
            this.isOpen = false;
            document.body.style.overflow = '';
            window.dispatchEvent(new CustomEvent('sideModalClosed'));
        },

        initGlobalBindings() {
            const self = this;
            window.openSideModal = (mode) => self.openModal(mode);
            window.closeSideModal = () => self.closeModal();
            window.addEventListener('openSideModalEvent', (e) => self.openModal(e.detail?.mode));
        }
    };
}

// ==========================================
// MODAL STATE CONTROLLER (generic, for x-data)
// ==========================================

function modalState() {
    return {
        open: false,
        loading: false,

        openModal() {
            this.open = true;
            document.body.style.overflow = 'hidden';
        },

        closeModal() {
            this.open = false;
            document.body.style.overflow = '';
            this.loading = false;
        },

        handleEscape(e) {
            if (e.key === 'Escape' && this.open) this.closeModal();
        }
    };
}

// ==========================================
// TABLE SELECTION CONTROLLER
// ==========================================

function tableSelection() {
    return {
        selected: [],
        allIds: [],

        toggle(id) {
            const idx = this.selected.indexOf(id);
            if (idx === -1) this.selected.push(id);
            else this.selected.splice(idx, 1);
        },

        toggleAll() {
            if (this.selected.length === this.allIds.length) {
                this.selected = [];
            } else {
                this.selected = [...this.allIds];
            }
        },

        isSelected(id) {
            return this.selected.indexOf(id) !== -1;
        },

        hasSelection() {
            return this.selected.length > 0;
        },

        clearSelection() {
            this.selected = [];
        },

        get selectionCount() {
            return this.selected.length;
        }
    };
}

// ==========================================
// INLINE EDIT STATE CONTROLLER
// ==========================================

function inlineEditState(initialValue, fieldName, cardId) {
    initialValue = initialValue || '';
    fieldName    = fieldName    || '';
    cardId       = cardId       || '';
    return {
        editing: false,
        value: initialValue,
        originalValue: initialValue,
        saving: false,

        startEdit() {
            this.editing = true;
            this.originalValue = this.value;
            this.$nextTick(() => {
                const input = this.$el.querySelector('input');
                if (input) { input.focus(); input.select(); }
            });
        },

        async saveEdit() {
            if (this.value === this.originalValue) { this.editing = false; return; }
            this.saving = true;
            try {
                if (typeof window.saveInlineEdit === 'function') {
                    const success = await window.saveInlineEdit(cardId, fieldName, this.value);
                    if (success) this.originalValue = this.value;
                    else this.value = this.originalValue;
                }
            } catch (err) {
                console.error('Inline edit save error:', err);
                this.value = this.originalValue;
            }
            this.saving = false;
            this.editing = false;
        },

        cancelEdit() {
            this.value = this.originalValue;
            this.editing = false;
        },

        handleKeydown(e) {
            if (e.key === 'Enter')  { e.preventDefault(); this.saveEdit(); }
            if (e.key === 'Escape') { this.cancelEdit(); }
        }
    };
}

// ==========================================
// UPLOAD PROGRESS CONTROLLER
// ==========================================

function uploadProgress() {
    return {
        percent: 0,
        status: 'idle',
        message: '',
        finished: false,
        _pollTimer: null,

        init() {
            // Self-register bridge globals so vanilla JS can drive this component.
            // The last initialized uploadProgress() instance wins (usually one per page).
            window.alpineUploadStart    = (msg)  => this.start(msg);
            window.alpineUploadProgress = (pct)  => this.updatePercent(pct);
            window.alpineUploadComplete = (msg)  => this.complete(msg);
            window.alpineUploadFail     = (msg)  => this.fail(msg);
            window.alpineUploadReset    = ()     => this.reset();
        },

        start(msg) {
            this.percent  = 0;
            this.status   = 'uploading';
            this.message  = msg || 'Uploading...';
            this.finished = false;
        },

        updatePercent(pct) {
            this.percent = Math.min(Math.max(pct, 0), 100);
            if (this.percent >= 100) this.status = 'processing';
        },

        complete(msg) {
            this.percent  = 100;
            this.status   = 'complete';
            this.message  = msg || 'Done!';
            this.finished = true;
            this.stopPolling();
        },

        fail(msg) {
            this.status   = 'error';
            this.message  = msg || 'Upload failed';
            this.finished = true;
            this.stopPolling();
        },

        reset() {
            this.percent  = 0;
            this.status   = 'idle';
            this.message  = '';
            this.finished = false;
            this.stopPolling();
        },

        startPolling(url, interval) {
            interval = interval || 1000;
            this.stopPolling();
            this._pollTimer = setInterval(async () => {
                try {
                    const res = await fetch(url, { credentials: 'same-origin' });
                    if (!res.ok) return;
                    const data = await res.json();
                    this.percent = data.percent || this.percent;
                    this.message = data.message || this.message;
                    if (data.status === 'complete') this.complete(data.message);
                    if (data.status === 'error')    this.fail(data.message);
                } catch (_) { /* silent */ }
            }, interval);
        },

        stopPolling() {
            if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
        }
    };
}

// ==========================================
// PERMISSION TOGGLE CONTROLLER
// ==========================================

function permToggle(initialValue, saveUrl, fieldName) {
    return {
        enabled: !!initialValue,
        saving: false,
        error: false,

        async toggle() {
            if (this.saving) return;
            const previous = this.enabled;
            this.enabled = !this.enabled;
            this.saving  = true;
            this.error   = false;

            try {
                const csrf = (typeof window.getCSRFToken === 'function') ? window.getCSRFToken() : '';
                const body = {};
                body[fieldName || 'enabled'] = this.enabled;
                const res = await fetch(saveUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
                    credentials: 'same-origin',
                    body: JSON.stringify(body)
                });
                if (!res.ok) throw new Error('Save failed');
            } catch (err) {
                this.enabled = previous;
                this.error   = true;
                console.error('Permission toggle failed:', err);
                if (window.alpineShowToast) window.alpineShowToast('Failed to update permission', 'error');
            }
            this.saving = false;
        }
    };
}

// ==========================================
// REGISTER WITH ALPINE
// ==========================================

document.addEventListener('alpine:init', () => {
    Alpine.data('layoutState',     layoutState);
    Alpine.data('sideModalState',  sideModalState);
    Alpine.data('modalState',      modalState);
    Alpine.data('tableSelection',  tableSelection);
    Alpine.data('inlineEditState', inlineEditState);
    Alpine.data('uploadProgress',  uploadProgress);
    Alpine.data('permToggle',      permToggle);

});
