// ID Card Actions - Main Entry Point
// This file orchestrates all module initializations
// 
// Module load order in HTML should be:
// 1. idcard-actions-core.js    - Core utilities, CSRF, toast, sidebar
// 2. idcard-actions-table.js   - Table rendering, pagination, lazy loading
// 3. idcard-actions-search.js  - Search, filter, sort functionality
// 4. idcard-actions-upload.js  - XLSX/ZIP upload functionality
// 5. idcard-actions-download.js - Download images, DOCX, XLSX
// 6. idcard-actions-modal.js   - Side modal, delete modal
// 7. idcard-actions-api.js     - API calls, bulk operations
// 8. idcard-actions-edit.js    - Inline cell editing
// 9. idcard-actions.js         - This file (main initialization)

(function() {
    'use strict';
    
    // ==========================================
    // MODULE VERIFICATION
    // ==========================================
    
    function verifyModulesLoaded() {
        const requiredModules = [
            'initCoreModule',
            'initTableModule', 
            'initSearchModule',
            'initUploadModule',
            'initDownloadModule',
            'initModalModule',
            'initApiModule',
            'initEditModule'
        ];
        
        const missingModules = [];
        
        requiredModules.forEach(moduleName => {
            if (!window.IDCardApp || typeof window.IDCardApp[moduleName] !== 'function') {
                missingModules.push(moduleName);
            }
        });
        
        if (missingModules.length > 0) {
            console.warn('IDCard Actions: Missing modules:', missingModules);
            return false;
        }
        
        return true;
    }
    
    // ==========================================
    // MAIN INITIALIZATION
    // ==========================================
    
    function initializeApp() {
        // Set global table ID from template variable
        if (typeof TABLE_ID !== 'undefined') {
            window.IDCardApp.tableId = TABLE_ID;
        }
        if (typeof CURRENT_STATUS !== 'undefined') {
            window.IDCardApp.currentStatus = CURRENT_STATUS;
        }
        if (typeof CLIENT_ID !== 'undefined') {
            window.IDCardApp.clientId = CLIENT_ID;
        }
        
        // Verify all modules are loaded
        if (!verifyModulesLoaded()) {
            console.error('IDCard Actions: Some modules failed to load. Check script order in HTML.');
        }
        
        // Initialize modules in order
        try {
            // Core module - CSRF, toast, sidebar, checkboxes, dropdowns
            if (window.IDCardApp && window.IDCardApp.initCoreModule) {
                window.IDCardApp.initCoreModule();
            }
            
            // Table module - Table rendering, pagination, lazy loading
            if (window.IDCardApp && window.IDCardApp.initTableModule) {
                window.IDCardApp.initTableModule();
            }
            
            // Search module - Search, filter, sort
            if (window.IDCardApp && window.IDCardApp.initSearchModule) {
                window.IDCardApp.initSearchModule();
            }
            
            // Upload module - XLSX, ZIP uploads
            if (window.IDCardApp && window.IDCardApp.initUploadModule) {
                window.IDCardApp.initUploadModule();
            }
            
            // Download module - Download images, DOCX, XLSX
            if (window.IDCardApp && window.IDCardApp.initDownloadModule) {
                window.IDCardApp.initDownloadModule();
            }
            
            // Modal module - Side modal, delete modal
            if (window.IDCardApp && window.IDCardApp.initModalModule) {
                window.IDCardApp.initModalModule();
            }
            
            // API module - Card status operations, bulk actions
            if (window.IDCardApp && window.IDCardApp.initApiModule) {
                window.IDCardApp.initApiModule();
            }
            
            // Edit module - Inline cell editing
            if (window.IDCardApp && window.IDCardApp.initEditModule) {
                window.IDCardApp.initEditModule();
            }
            
            // Dispatch custom event for other scripts that may depend on this
            document.dispatchEvent(new CustomEvent('idcard-actions-ready'));
            
        } catch (error) {
            console.error('IDCard Actions: Error during initialization:', error);
        }
    }
    
    // ==========================================
    // KEYBOARD SHORTCUTS
    // ==========================================
    
    function initKeyboardShortcuts() {
        document.addEventListener('keydown', function(e) {
            // Ctrl+F or Cmd+F - Focus search
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                const searchInput = document.getElementById('searchInput');
                if (searchInput) {
                    e.preventDefault();
                    searchInput.focus();
                    searchInput.select();
                }
            }
            
            // Escape - Close any open modal (unified handler)
            if (e.key === 'Escape') {
                // Close side modal
                const sideModal = document.getElementById('sideModalOverlay');
                if (sideModal && sideModal.classList.contains('active')) {
                    if (typeof closeSideModal === 'function') closeSideModal();
                    e.preventDefault();
                    return;
                }
                
                // Close permanent delete modal
                const deleteModal = document.getElementById('deleteModalOverlay');
                if (deleteModal && deleteModal.classList.contains('active')) {
                    if (typeof closeDeleteModalFn === 'function') closeDeleteModalFn();
                    else deleteModal.classList.remove('active');
                    document.body.style.overflow = '';
                    e.preventDefault();
                    return;
                }
                
                // Close simple delete modal
                const simpleDeleteModal = document.getElementById('simpleDeleteModalOverlay');
                if (simpleDeleteModal && simpleDeleteModal.classList.contains('active')) {
                    if (typeof closeSimpleDeleteModalFn === 'function') closeSimpleDeleteModalFn();
                    else simpleDeleteModal.classList.remove('active');
                    document.body.style.overflow = '';
                    e.preventDefault();
                    return;
                }
                
                // Close upload modal
                const uploadModal = document.getElementById('uploadModalOverlay');
                if (uploadModal && uploadModal.classList.contains('active')) {
                    uploadModal.classList.remove('active');
                    document.body.style.overflow = '';
                    e.preventDefault();
                    return;
                }
                
                // Close image sort modal
                const imageSortModal = document.getElementById('imageSortModalOverlay');
                if (imageSortModal && imageSortModal.classList.contains('active')) {
                    imageSortModal.classList.remove('active');
                    e.preventDefault();
                    return;
                }
                
                // Close search all modal
                const searchAllModal = document.getElementById('searchAllModalOverlay');
                if (searchAllModal && searchAllModal.classList.contains('active')) {
                    searchAllModal.classList.remove('active');
                    e.preventDefault();
                    return;
                }
                
                // Close doc format modal
                const docFormatModal = document.getElementById('docFormatModalOverlay');
                if (docFormatModal && docFormatModal.classList.contains('active')) {
                    docFormatModal.classList.remove('active');
                    e.preventDefault();
                    return;
                }
            }
            
            // Ctrl+A or Cmd+A - Select all in table
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                const activeElement = document.activeElement;
                // Only if not in an input/textarea
                if (!activeElement.matches('input, textarea')) {
                    const selectAllCheckbox = document.getElementById('selectAll');
                    if (selectAllCheckbox) {
                        e.preventDefault();
                        selectAllCheckbox.checked = true;
                        selectAllCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            }
            
            // N key - Add new card (when not in input)
            if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const activeElement = document.activeElement;
                if (!activeElement.matches('input, textarea')) {
                    const addBtn = document.getElementById('addNewBtn');
                    if (addBtn) {
                        e.preventDefault();
                        addBtn.click();
                    }
                }
            }
            
            // T key - Go to top of list (first row)
            if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const activeElement = document.activeElement;
                if (!activeElement.matches('input, textarea')) {
                    e.preventDefault();
                    goToTableTop();
                }
            }
            
            // B key - Go to bottom of list (last row)
            if (e.key === 'b' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const activeElement = document.activeElement;
                if (!activeElement.matches('input, textarea')) {
                    e.preventDefault();
                    goToTableBottom();
                }
            }
        });
    }
    
    // Go to top of table (SR No. 1)
    function goToTableTop() {
        const tableBody = document.getElementById('cardsTableBody');
        const tableContainer = document.querySelector('.table-container');
        
        if (tableBody && tableContainer) {
            // Scroll to top
            tableContainer.scrollTop = 0;
            
            // Select first row
            const firstRow = tableBody.querySelector('tr');
            if (firstRow) {
                // Clear any existing selection
                document.querySelectorAll('#cardsTableBody tr.selected').forEach(row => {
                    row.classList.remove('selected');
                    const checkbox = row.querySelector('.rowCheckbox');
                    if (checkbox) checkbox.checked = false;
                });
                
                // Select first row
                firstRow.classList.add('selected');
                const checkbox = firstRow.querySelector('.rowCheckbox');
                if (checkbox) checkbox.checked = true;
                
                // Update selection count
                if (typeof updateActionButtons === 'function') {
                    updateActionButtons();
                }
                
                // Scroll into view
                firstRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
    
    // Go to bottom of table (last SR No.)
    function goToTableBottom() {
        const tableBody = document.getElementById('cardsTableBody');
        const tableContainer = document.querySelector('.table-container');
        
        if (tableBody && tableContainer) {
            // First, load all remaining data if lazy loading is active
            if (window.IDCardApp && window.IDCardApp.lazyLoadState) {
                const state = window.IDCardApp.lazyLoadState;
                if (state.hasMore && typeof loadMoreData === 'function') {
                    // Load all remaining data first
                    loadAllRemainingData().then(() => {
                        scrollToLastRow();
                    });
                } else {
                    scrollToLastRow();
                }
            } else {
                scrollToLastRow();
            }
        }
    }
    
    // Helper to scroll to and select last row
    function scrollToLastRow() {
        const tableBody = document.getElementById('cardsTableBody');
        const tableContainer = document.querySelector('.table-container');
        
        if (tableBody && tableContainer) {
            const rows = tableBody.querySelectorAll('tr');
            const lastRow = rows[rows.length - 1];
            
            if (lastRow) {
                // Scroll to bottom
                tableContainer.scrollTop = tableContainer.scrollHeight;
                
                // Clear any existing selection
                document.querySelectorAll('#cardsTableBody tr.selected').forEach(row => {
                    row.classList.remove('selected');
                    const checkbox = row.querySelector('.rowCheckbox');
                    if (checkbox) checkbox.checked = false;
                });
                
                // Select last row
                lastRow.classList.add('selected');
                const checkbox = lastRow.querySelector('.rowCheckbox');
                if (checkbox) checkbox.checked = true;
                
                // Update selection count
                if (typeof updateActionButtons === 'function') {
                    updateActionButtons();
                }
                
                // Scroll into view
                lastRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
    
    // Load all remaining data for going to bottom
    async function loadAllRemainingData() {
        if (!window.IDCardApp || !window.IDCardApp.lazyLoadState) return;
        
        const state = window.IDCardApp.lazyLoadState;
        while (state.hasMore && typeof loadMoreData === 'function') {
            await new Promise(resolve => {
                loadMoreData();
                setTimeout(resolve, 100); // Wait a bit between loads
            });
        }
    }
    
    // ==========================================
    // WINDOW RESIZE HANDLER
    // ==========================================
    
    let resizeTimeout;
    function initResizeHandler() {
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function() {
                // Re-adjust table alignment
                if (typeof setupDynamicTextAlignment === 'function') {
                    setupDynamicTextAlignment();
                }
                
                // Re-check lazy loading
                if (typeof checkLoadMore === 'function') {
                    checkLoadMore();
                }
            }, 250);
        });
    }
    
    // ==========================================
    // PERFORMANCE MONITORING
    // ==========================================
    
    function logPerformance() {
        // Performance logging disabled in production
    }
    
    // ==========================================
    // DOM READY HANDLER
    // ==========================================
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            initializeApp();
            initKeyboardShortcuts();
            initResizeHandler();
            logPerformance();
        });
    } else {
        // DOM already loaded
        initializeApp();
        initKeyboardShortcuts();
        initResizeHandler();
        logPerformance();
    }
    
    // ==========================================
    // PUBLIC API
    // ==========================================
    
    // Expose a clean public API
    window.IDCardActions = {
        version: '2.0.0',
        modules: window.IDCardApp || {},
        
        // Utility functions
        showToast: function(message, type) {
            if (typeof showToast === 'function') {
                showToast(message, type);
            }
        },
        
        // Refresh table
        refreshTable: function() {
            location.reload();
        },
        
        // Get selected card IDs
        getSelected: function() {
            if (typeof getSelectedCardIds === 'function') {
                return getSelectedCardIds();
            }
            return [];
        },
        
        // Open add modal
        openAddModal: function() {
            if (typeof openSideModal === 'function') {
                openSideModal('add');
            }
        },
        
        // Reinitialize (useful after dynamic content changes)
        reinitialize: function() {
            initializeApp();
        }
    };
    
// IDCard Actions: Main module loaded (v2.0.0)
    
})();
