// ID Card Actions - Core Utilities Module
// Contains: Active link highlight, checkbox functionality, API helpers
// Depends on: core/api.js (ApiClient), core/toast.js (Toast), core/utils.js

(function() {
'use strict';

// ==========================================
// GLOBAL STATE
// ==========================================
window.IDCardApp = window.IDCardApp || {};

// ==========================================
// TABLE ID HELPER
// ==========================================
function getTableId() {
    return typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
}

// Expose on IDCardApp namespace
window.IDCardApp.getTableId = getTableId;

// ==========================================
// EXPOSE UTILS FUNCTIONS TO IDCardApp
// (utils.js must be loaded before this file)
// ==========================================
if (typeof getCSRFToken === 'function') {
    window.IDCardApp.getCSRFToken = getCSRFToken;
}
if (typeof showToast === 'function') {
    window.IDCardApp.showToast = showToast;
}
if (typeof showProgressToast === 'function') {
    window.IDCardApp.showProgressToast = showProgressToast;
}
if (typeof showDownloadComplete === 'function') {
    window.IDCardApp.showDownloadComplete = showDownloadComplete;
}
if (typeof hideToast === 'function') {
    window.IDCardApp.hideProgressToast = hideToast;
}

// ==========================================
// API CALL HELPER (delegates to core/api.js ApiClient)
// ==========================================

function apiCall(url, method, data = null) {
    // Delegate to centralized ApiClient from core/api.js
    if (typeof ApiClient !== 'undefined') {
        return ApiClient.request(url, method, data);
    }
    // Fallback if ApiClient not loaded yet
    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken()
        }
    };
    if (data) options.body = JSON.stringify(data);
    return fetch(url, options).then(r => r.ok ? r.json() : r.json().catch(() => ({})).then(d => { throw new Error(d.message || 'Request failed'); }));
}

// Expose on IDCardApp namespace
window.IDCardApp.apiCall = apiCall;

// ==========================================
// SIDEBAR FUNCTIONALITY
// ==========================================

function initSidebar() {
    // Sidebar toggle is handled by Alpine.js layoutState() in alpine-state.js.
    // Only set the active sidebar link here — no toggle logic.
    const activeClientsLink = document.getElementById('activeClientsLink');
    const allClientsLink = document.getElementById('allClientsLink');
    if (activeClientsLink) activeClientsLink.classList.add('active');
    if (allClientsLink) allClientsLink.classList.remove('active');
}

// Expose globally
window.IDCardApp.initSidebar = initSidebar;

// ==========================================
// CHECKBOX FUNCTIONALITY
// ==========================================

// Track last clicked checkbox for Shift+Click range selection
let lastClickedCheckboxIndex = null;

// Function to get current row checkboxes (live query)
function getRowCheckboxes() {
    return document.querySelectorAll(".rowCheckbox");
}

function getSelectedCardIds() {
    const checked = document.querySelectorAll('.rowCheckbox:checked');
    return [...checked].map(cb => cb.closest('tr').getAttribute('data-card-id'));
}

// Get all visible card IDs from current list
function getAllVisibleCardIds() {
    const allRows = document.querySelectorAll('#cardsTableBody tr[data-card-id]');
    return [...allRows].map(row => row.getAttribute('data-card-id')).filter(id => id);
}

// Get card IDs - selected if any, otherwise all visible
function getCardIdsForAction() {
    const selectedIds = getSelectedCardIds();
    return selectedIds.length > 0 ? selectedIds : getAllVisibleCardIds();
}

// ==========================================
// CACHED TOOLBAR BUTTON REFS
// Populated once by _cacheToolbarButtons(), called from initCoreModule().
// ==========================================
var _cachedSingleBtns = null;   // editBtn*, viewBtn*
var _cachedMultiBtns  = null;   // deleteBtn*, verifyBtn*, approveBtn*, etc.
var _cachedAddBtn = null;
var _cachedUploadXlsxBtn = null;
var _cachedDeletePermanentBtn = null;

function _cacheToolbarButtons() {
    _cachedSingleBtns = document.querySelectorAll('[id^="editBtn"], [id^="viewBtn"]');
    _cachedMultiBtns  = document.querySelectorAll('[id^="deleteBtn"], [id^="verifyBtn"], [id^="approveBtn"], [id^="disapproveBtn"], [id^="unapprovedBtn"], [id^="retrieveBtn"], [id^="unverifyBtn"], #downloadCardBtn');
    _cachedAddBtn = document.getElementById('addBtn');
    _cachedUploadXlsxBtn = document.getElementById('uploadXlsxBtn');
    _cachedDeletePermanentBtn = document.getElementById('deletePermanentBtnP');
}

// Update button states when checkboxes change
function updateButtonStates() {
    const rowCheckboxes = getRowCheckboxes();
    const checkedBoxes = [...rowCheckboxes].filter(cb => cb.checked);
    const singleSelected = checkedBoxes.length === 1;
    const anySelected = checkedBoxes.length >= 1;
    const noneSelected = checkedBoxes.length === 0;
    
    // No-selection buttons (Add, Upload XLSX) - disabled when any row is selected
    if (_cachedAddBtn) _cachedAddBtn.disabled = anySelected;
    if (_cachedUploadXlsxBtn) _cachedUploadXlsxBtn.disabled = anySelected;
    
    // Single select buttons (Edit, View) — use cached refs
    if (_cachedSingleBtns) {
        _cachedSingleBtns.forEach(btn => { btn.disabled = !singleSelected; });
    }
    
    // Multi select buttons — use cached refs
    if (_cachedMultiBtns) {
        _cachedMultiBtns.forEach(btn => { btn.disabled = !anySelected; });
    }
    
    // Delete Permanent button (Pool list only)
    if (_cachedDeletePermanentBtn) _cachedDeletePermanentBtn.disabled = !anySelected;

    // Bridge selection state to Alpine for reactive UI bindings
    if (typeof window.alpineUpdateSelection === 'function') {
        window.alpineUpdateSelection(getSelectedCardIds());
    }
}

function initCheckboxes() {
    const selectAll = document.getElementById("selectAll");
    
    // Select All checkbox
    if (selectAll) {
        selectAll.addEventListener("change", function() {
            const rowCheckboxes = getRowCheckboxes();
            rowCheckboxes.forEach(cb => {
                cb.checked = this.checked;
                // Sync .selected class with checkbox state
                const row = cb.closest('tr');
                if (row) {
                    if (this.checked) row.classList.add('selected');
                    else row.classList.remove('selected');
                }
            });
            updateButtonStates();
            
            // If unchecking, also deactivate the Select All DB button
            if (!this.checked) {
                const selectAllDbBtn = document.getElementById('selectAllDbBtn');
                if (selectAllDbBtn) {
                    selectAllDbBtn.classList.remove('active');
                    window.IDCardApp.allDbCardIds = null;
                }
            }
        });
    }
    
    // Individual row checkboxes - use event delegation
    const tableBody = document.getElementById('cardsTableBody');
    if (tableBody) {
        // Handle Shift+Click for range selection
        tableBody.addEventListener('click', function(e) {
            if (e.target.classList.contains('rowCheckbox')) {
                const rowCheckboxes = [...getRowCheckboxes()];
                const currentIndex = rowCheckboxes.indexOf(e.target);
                
                if (e.shiftKey && lastClickedCheckboxIndex !== null && currentIndex !== lastClickedCheckboxIndex) {
                    // Shift+Click: Range selection
                    e.preventDefault(); // Prevent default checkbox behavior
                    
                    const start = Math.min(lastClickedCheckboxIndex, currentIndex);
                    const end = Math.max(lastClickedCheckboxIndex, currentIndex);
                    
                    // Check all checkboxes in range (from anchor to current, inclusive)
                    for (let i = start; i <= end; i++) {
                        if (rowCheckboxes[i]) {
                            rowCheckboxes[i].checked = true;
                            // Sync .selected class
                            const row = rowCheckboxes[i].closest('tr');
                            if (row) row.classList.add('selected');
                        }
                    }
                    
                    // Trigger change event for button state update
                    updateButtonStates();
                    
                    // Don't update lastClickedCheckboxIndex for shift+click 
                    // so user can continue selecting ranges from the original anchor
                } else {
                    // Normal click (without Shift): Toggle this checkbox and set as anchor
                    // Update last clicked index - this becomes the anchor for Shift+Click
                    lastClickedCheckboxIndex = currentIndex;
                    
                    // Also uncheck selectAll if unchecking a checkbox
                    if (!e.target.checked && selectAll) {
                        selectAll.checked = false;
                    }
                }
            }
        });
        
        // Handle checkbox state changes
        tableBody.addEventListener('change', function(e) {
            if (e.target.classList.contains('rowCheckbox')) {
                // Sync .selected class with checkbox state
                const row = e.target.closest('tr');
                if (row) {
                    if (e.target.checked) row.classList.add('selected');
                    else row.classList.remove('selected');
                }
                const rowCheckboxes = getRowCheckboxes();
                if (!e.target.checked) {
                    selectAll.checked = false;
                    // Also deactivate Select All DB if any checkbox is unchecked
                    const selectAllDbBtn = document.getElementById('selectAllDbBtn');
                    if (selectAllDbBtn) {
                        selectAllDbBtn.classList.remove('active');
                        window.IDCardApp.allDbCardIds = null;
                    }
                } else if ([...rowCheckboxes].every(c => c.checked)) {
                    selectAll.checked = true;
                }
                updateButtonStates();
            }
        });
    }
    
    // Reset last clicked index when page changes or data reloads
    window.IDCardApp.resetShiftClickIndex = function() {
        lastClickedCheckboxIndex = null;
    };
    
    // Select All Database button
    initSelectAllDbButton();
    
    // Initial button state
    updateButtonStates();
}

// Helper: build filter query string from current active filters
function _buildFilterQS() {
    const params = new URLSearchParams();
    const currentStatus = window.IDCardApp.currentStatus || new URLSearchParams(window.location.search).get('status') || 'pending';
    params.set('status', currentStatus);
    // Search
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.value.trim()) params.set('search', searchInput.value.trim());
    // Class
    if (IDCardApp.currentClassFilter) params.set('class', IDCardApp.currentClassFilter);
    // Section
    if (IDCardApp.currentSectionFilter) params.set('section', IDCardApp.currentSectionFilter);
    // DateTime range (download list)
    const fromDate = document.getElementById('fromDateFilter');
    const toDate = document.getElementById('toDateFilter');
    if (fromDate && fromDate.value) params.set('from', fromDate.value);
    if (toDate && toDate.value) params.set('to', toDate.value);
    return params.toString();
}

// Select All Database functionality
function initSelectAllDbButton() {
    const selectAllDbBtn = document.getElementById('selectAllDbBtn');
    if (!selectAllDbBtn) return;
    
    selectAllDbBtn.addEventListener('click', async function() {
        const tableId = window.IDCardApp.tableId;
        
        if (!tableId) {
            showToast('Table ID not found', false);
            return;
        }
        
        // If already active, deselect all
        if (this.classList.contains('active')) {
            this.classList.remove('active');
            window.IDCardApp.allDbCardIds = null;
            
            // Uncheck all visible checkboxes
            const selectAll = document.getElementById("selectAll");
            if (selectAll) {
                selectAll.checked = false;
                selectAll.dispatchEvent(new Event('change', { bubbles: true }));
            }
            showToast('Selection cleared');
            return;
        }
        
        // Show loading state
        const originalContent = this.innerHTML;
        this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
        this.disabled = true;
        
        try {
            const qs = _buildFilterQS();
            const data = await ApiClient.get(`/panel/api/table/${tableId}/cards/all-ids/?${qs}`);
            
            if (data.success && data.card_ids) {
                // Store all card IDs globally
                window.IDCardApp.allDbCardIds = data.card_ids;
                
                // Mark button as active
                this.classList.add('active');
                
                // Check all visible checkboxes
                const selectAll = document.getElementById("selectAll");
                if (selectAll) {
                    selectAll.checked = true;
                    const rowCheckboxes = getRowCheckboxes();
                    rowCheckboxes.forEach(cb => {
                        cb.checked = true;
                    });
                }
                
                updateButtonStates();
                showToast(`Selected all ${data.total_count} cards`);
            } else {
                showToast(data.message || 'Failed to get card IDs', false);
            }
        } catch (error) {
            console.error('Error fetching all card IDs:', error);
            showToast('Error fetching card IDs', false);
        } finally {
            this.innerHTML = originalContent;
            this.disabled = false;
        }
    });
}

// Override getSelectedCardIds to use all DB IDs when Select All DB is active
const originalGetSelectedCardIds = getSelectedCardIds;
function getSelectedCardIdsWithDbSelect() {
    // If Select All DB is active, return all DB card IDs
    if (window.IDCardApp.allDbCardIds && window.IDCardApp.allDbCardIds.length > 0) {
        const selectAllDbBtn = document.getElementById('selectAllDbBtn');
        if (selectAllDbBtn && selectAllDbBtn.classList.contains('active')) {
            return window.IDCardApp.allDbCardIds;
        }
    }
    // Otherwise, return selected visible checkboxes
    return originalGetSelectedCardIds();
}

// Expose on IDCardApp namespace
window.IDCardApp.getRowCheckboxes = getRowCheckboxes;
window.IDCardApp.getSelectedCardIds = getSelectedCardIdsWithDbSelect;
window.IDCardApp.getAllVisibleCardIds = getAllVisibleCardIds;
window.IDCardApp.getCardIdsForAction = getCardIdsForAction;
window.IDCardApp.updateButtonStates = updateButtonStates;
window.IDCardApp.initCheckboxes = initCheckboxes;
window.IDCardApp.initSelectAllDbButton = initSelectAllDbButton;

/**
 * Get ALL card IDs for bulk operations (download, reupload).
 * If specific rows are checked, returns those IDs (sync).
 * Otherwise, fetches ALL card IDs from the database for the current status,
 * respecting any active search/class/section filters.
 * Always returns a Promise.
 */
async function getAllCardIdsForAction() {
    // If user has explicitly selected rows (checked checkboxes), use those
    const selectedIds = getSelectedCardIdsWithDbSelect();
    if (selectedIds.length > 0) {
        return selectedIds;
    }

    // No explicit selection — fetch ALL card IDs from database (filter-aware)
    const tableId = window.IDCardApp.tableId || (typeof TABLE_ID !== 'undefined' ? TABLE_ID : null);

    if (!tableId) {
        console.error('getAllCardIdsForAction: TABLE_ID not found');
        return [];
    }

    try {
        const qs = _buildFilterQS();
        const data = await ApiClient.get(`/panel/api/table/${tableId}/cards/all-ids/?${qs}`);
        if (data.success && data.card_ids) {
            return data.card_ids;
        }
        return [];
    } catch (error) {
        console.error('Error fetching all card IDs:', error);
        return [];
    }
}

window.IDCardApp.getAllCardIdsForAction = getAllCardIdsForAction;

// ==========================================
// DROPDOWN FUNCTIONALITY
// ==========================================

function setupDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    
    const toggle = dropdown.querySelector('.dropdown-toggle');
    const options = dropdown.querySelectorAll('.dropdown-option');
    
    toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        // Close other dropdowns
        document.querySelectorAll('.custom-dropdown.open').forEach(d => {
            if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
    });
    
    options.forEach(option => {
        option.addEventListener('click', function() {
            options.forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            
            // Update toggle text if needed
            const selectedText = toggle.querySelector('span');
            if (selectedText) {
                selectedText.textContent = this.textContent;
            }
            
            dropdown.classList.remove('open');
        });
    });
}

function initDropdowns() {
    setupDropdown('filterDropdown');
    setupDropdown('rowsDropdown');
    setupDropdown('sortDropdown');
    // classFilterDropdown and sectionFilterDropdown are handled by initFilterHandlers()
    // in idcard-actions-search.js (with event delegation for dynamic options)
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', function(e) {
        // Don't close if clicking inside a dropdown
        if (e.target.closest('.custom-dropdown')) return;
        
        document.querySelectorAll('.custom-dropdown.open').forEach(d => {
            d.classList.remove('open');
        });
    });
}

// Expose globally
window.IDCardApp.setupDropdown = setupDropdown;
window.IDCardApp.initDropdowns = initDropdowns;

// ==========================================
// DYNAMIC TEXT ALIGNMENT
// ==========================================

function applyDynamicAlignment() {
    const table = document.querySelector('.idcard-table table');
    if (!table) return;
    
    const rows = table.querySelectorAll('tbody tr[data-card-id]');
    if (rows.length === 0) return;
    
    // Batch all writes in a single rAF to avoid interleaved read/write thrashing.
    // Column alignment is determined by CSS classes (get_td_width_class filter),
    // so we only need to clear stale inline overrides and center Sr No.
    requestAnimationFrame(function() {
        // Remove any stale inline textAlign so CSS classes take effect
        for (var i = 0; i < rows.length; i++) {
            var cells = rows[i].querySelectorAll('td.dynamic-field');
            for (var j = 0; j < cells.length; j++) {
                if (cells[j].style.textAlign) cells[j].style.textAlign = '';
            }
        }
        // Sr No column — center
        var srCells = document.querySelectorAll('.idcard-table td:nth-child(2)');
        for (var k = 0; k < srCells.length; k++) {
            srCells[k].style.textAlign = 'center';
        }
    });
}

// Expose on IDCardApp namespace
window.IDCardApp.applyDynamicAlignment = applyDynamicAlignment;

// ==========================================
// HORIZONTAL SCROLL WITH ALT + MOUSE WHEEL
// ==========================================

function initHorizontalScroll() {
    const tableContainer = document.querySelector('.idcard-table');
    if (tableContainer) {
        tableContainer.addEventListener('wheel', function(e) {
            // If Alt key is held, scroll horizontally
            if (e.altKey) {
                e.preventDefault();
                // Slow scroll speed - 25% for smoother scrolling
                this.scrollLeft += e.deltaY * 0.25;
            }
        }, { passive: false });
    }
}

// Expose globally
window.IDCardApp.initHorizontalScroll = initHorizontalScroll;

// ==========================================
// CORE MODULE INITIALIZATION
// ==========================================

function initCoreModule() {
    _cacheToolbarButtons();
    initSidebar();
    initCheckboxes();
    initDropdowns();
    initHorizontalScroll();
    applyDynamicAlignment();
}

// Expose globally
window.IDCardApp.initCoreModule = initCoreModule;

})();
