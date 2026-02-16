/**
 * Alpine.js Global State Module
 * Provides unified UI state management across all pages
 * 
 * @module alpine-state
 * @version 1.0.0
 * 
 * Phase 1: Production-Safe Alpine.js Base Integration
 */

// ==========================================
// LAYOUT STATE CONTROLLER
// ==========================================

function layoutState() {
    return {
        // Sidebar state - persisted to localStorage, default CLOSED
        sidebarOpen: localStorage.getItem('sidebarCollapsed') === 'false',
        
        // Toast queue for notifications
        toastQueue: [],
        
        // Initialize on page load
        init() {
            // Apply initial sidebar state
            this.applySidebarState();
            
            // Listen for keyboard shortcuts
            this.initKeyboardShortcuts();
            
            // Bind sidebar toggle button (for pages using id="sidebarToggle" instead of @click)
            this.bindSidebarToggle();
            
            // Start sidebar clock
            this.initSidebarClock();
            
            // Expose showToast globally for legacy JS compatibility
            window.alpineShowToast = (message, type) => this.showToast(message, type);
        },
        
        // Toggle sidebar open/collapsed
        toggleSidebar() {
            this.sidebarOpen = !this.sidebarOpen;
            localStorage.setItem('sidebarCollapsed', !this.sidebarOpen);
            this.applySidebarState();
        },
        
        // Apply sidebar state to DOM
        applySidebarState() {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                if (this.sidebarOpen) {
                    sidebar.classList.remove('collapsed');
                    document.body.classList.remove('sidebar-collapsed');
                } else {
                    sidebar.classList.add('collapsed');
                    document.body.classList.add('sidebar-collapsed');
                }
            }
        },
        
        // Bind click handler for #sidebarToggle button (works on all pages)
        bindSidebarToggle() {
            const btn = document.getElementById('sidebarToggle');
            if (btn && !btn.hasAttribute('@click')) {
                btn.addEventListener('click', () => this.toggleSidebar());
            }
        },

        // Sidebar date/time clock
        initSidebarClock() {
            const dateEl = document.getElementById('date');
            const timeEl = document.getElementById('time');
            if (!dateEl && !timeEl) return;

            const update = () => {
                const now = new Date();
                if (dateEl) {
                    dateEl.textContent = now.toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric'
                    });
                }
                if (timeEl) {
                    timeEl.textContent = now.toLocaleTimeString('en-IN', {
                        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
                    });
                }
            };
            update();
            setInterval(update, 1000);
        },

        // Keyboard shortcuts for sidebar
        initKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                // Don't trigger if user is typing
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                    return;
                }
                
                // C to collapse, V to expand
                if (e.key.toLowerCase() === 'c' && this.sidebarOpen) {
                    this.sidebarOpen = false;
                    localStorage.setItem('sidebarCollapsed', 'true');
                    this.applySidebarState();
                } else if (e.key.toLowerCase() === 'v' && !this.sidebarOpen) {
                    this.sidebarOpen = true;
                    localStorage.setItem('sidebarCollapsed', 'false');
                    this.applySidebarState();
                }
            });
        },
        
        // Show toast notification
        showToast(message, type = 'success') {
            const id = Date.now();
            this.toastQueue.push({ id, message, type });
            
            // Auto-remove after 4 seconds
            setTimeout(() => {
                this.toastQueue = this.toastQueue.filter(t => t.id !== id);
            }, 4000);
        },
        
        // Get toast icon based on type
        getToastIcon(type) {
            const icons = {
                'success': 'fa-solid fa-check-circle',
                'error': 'fa-solid fa-times-circle',
                'warning': 'fa-solid fa-exclamation-triangle',
                'info': 'fa-solid fa-info-circle'
            };
            return icons[type] || icons.success;
        },
        
        // Get toast color class based on type
        getToastClass(type) {
            const classes = {
                'success': 'toast-success',
                'error': 'toast-error',
                'warning': 'toast-warning',
                'info': 'toast-info'
            };
            return classes[type] || classes.success;
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
            // Dispatch event for legacy JS handlers
            window.dispatchEvent(new CustomEvent('sideModalClosed'));
        },
        
        initGlobalBindings() {
            // Expose Alpine close method to global scope for legacy JS compatibility
            // NOTE: Do NOT overwrite window.openSideModal - the original function in
            // idcard-actions-modal.js handles form population and already calls Alpine's openModal
            const self = this;
            window.closeSideModal = () => self.closeModal();
            // Listen for legacy open events (custom event dispatch)
            window.addEventListener('openSideModalEvent', (e) => self.openModal(e.detail?.mode));
        }
    };
}

// ==========================================
// MODAL STATE CONTROLLER
// ==========================================

function modalState(options = {}) {
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
        
        // Handle escape key
        handleEscape(e) {
            if (e.key === 'Escape' && this.open) {
                this.closeModal();
            }
        }
    };
}

// ==========================================
// INLINE EDIT STATE CONTROLLER
// ==========================================

function inlineEditState(initialValue = '', fieldName = '', cardId = '') {
    return {
        editing: false,
        value: initialValue,
        originalValue: initialValue,
        saving: false,
        
        startEdit() {
            this.editing = true;
            this.originalValue = this.value;
            // Focus input on next tick
            this.$nextTick(() => {
                const input = this.$el.querySelector('input');
                if (input) {
                    input.focus();
                    input.select();
                }
            });
        },
        
        async saveEdit() {
            if (this.value === this.originalValue) {
                this.editing = false;
                return;
            }
            
            this.saving = true;
            
            try {
                // Call the global save function if available
                // Send value as-is - backend handles selective uppercase
                if (typeof window.saveInlineEdit === 'function') {
                    const success = await window.saveInlineEdit(cardId, fieldName, this.value);
                    if (success) {
                        this.originalValue = this.value;
                    } else {
                        this.value = this.originalValue;
                    }
                }
            } catch (error) {
                console.error('Inline edit save error:', error);
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
            if (e.key === 'Enter') {
                e.preventDefault();
                this.saveEdit();
            } else if (e.key === 'Escape') {
                this.cancelEdit();
            }
        }
    };
}

// ==========================================
// EXPOSE GLOBALLY FOR ALPINE
// ==========================================

// Register with Alpine when it loads
document.addEventListener('alpine:init', () => {
    Alpine.data('layoutState', layoutState);
    Alpine.data('sideModalState', sideModalState);
    Alpine.data('modalState', modalState);
    Alpine.data('inlineEditState', inlineEditState);
    
    // Global Alpine store for modals
    Alpine.store('modals', {
        active: null,
        data: null,
        
        open(modalId, data = null) {
            this.active = modalId;
            this.data = data;
            document.body.style.overflow = 'hidden';
            // Also notify traditional modal system if available
            if (window.AdarshModal?.openModal) {
                window.AdarshModal.openModal(modalId, data);
            }
        },
        
        close() {
            const modalId = this.active;
            this.active = null;
            this.data = null;
            document.body.style.overflow = '';
            // Also notify traditional modal system if available
            if (modalId && window.AdarshModal?.closeModal) {
                window.AdarshModal.closeModal(modalId);
            }
        },
        
        isOpen(modalId) {
            return this.active === modalId;
        }
    });
});
