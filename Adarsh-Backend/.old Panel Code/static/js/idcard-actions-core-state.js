// ID Card Actions - Core State Sub-module
// Contains: Global state, table ID, API helpers, checkbox state/selection, filter query builder
// Split from: idcard-actions-core.js

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
    // Use the DB-aware getter so Select All checkbox includes all 
    // database cards, not just the visible 100
    const selectedIds = (typeof getSelectedCardIdsWithDbSelect === 'function')
        ? getSelectedCardIdsWithDbSelect()
        : getSelectedCardIds();
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
    
    // Single select buttons (Edit, View)  use cached refs
    if (_cachedSingleBtns) {
        _cachedSingleBtns.forEach(btn => { btn.disabled = !singleSelected; });
    }
    
    // Multi select buttons  use cached refs
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
    
    // Select All checkbox  when checked, selects ALL cards in the database (not just loaded rows)
    if (selectAll) {
        selectAll.addEventListener("change", async function() {
            const rowCheckboxes = getRowCheckboxes();

            if (this.checked) {
                // Check all visible row checkboxes
                rowCheckboxes.forEach(cb => {
                    cb.checked = true;
                    const row = cb.closest('tr');
                    if (row) row.classList.add('selected');
                });

                // Fetch ALL card IDs from the database via API
                const tableId = window.IDCardApp.tableId;
                if (tableId) {
                    try {
                        const qs = _buildFilterQS();
                        const data = await ApiClient.get('/api/table/' + tableId + '/cards/all-ids/?' + qs);
                        if (data.success && data.card_ids) {
                            window.IDCardApp.allDbCardIds = data.card_ids;
                            showToast('Selected all ' + data.total_count + ' cards');
                        }
                    } catch (err) {
                        console.error('Error fetching all card IDs:', err);
                    }
                }
            } else {
                // Uncheck all visible row checkboxes
                rowCheckboxes.forEach(cb => {
                    cb.checked = false;
                    const row = cb.closest('tr');
                    if (row) row.classList.remove('selected');
                });
                // Clear DB-wide selection
                window.IDCardApp.allDbCardIds = null;
            }

            updateButtonStates();
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
                    // Also clear DB-wide selection if any checkbox is unchecked
                    window.IDCardApp.allDbCardIds = null;
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
    // Course
    if (IDCardApp.currentCourseFilter) params.set('course', IDCardApp.currentCourseFilter);
    // Branch
    if (IDCardApp.currentBranchFilter) params.set('branch', IDCardApp.currentBranchFilter);
    // Image sort filter
    if (IDCardApp._activeImageSort) {
        if (IDCardApp._activeImageSort.column) params.set('image_column', IDCardApp._activeImageSort.column);
        if (IDCardApp._activeImageSort.condition) params.set('image_condition', IDCardApp._activeImageSort.condition);
    }
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
            const data = await ApiClient.get(`/api/table/${tableId}/cards/all-ids/?${qs}`);
            
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
    // If Select All DB is active (via selectAllDbBtn OR selectAll checkbox), return all DB card IDs
    if (window.IDCardApp.allDbCardIds && window.IDCardApp.allDbCardIds.length > 0) {
        const selectAllDbBtn = document.getElementById('selectAllDbBtn');
        const selectAllCb = document.getElementById('selectAll');
        if ((selectAllDbBtn && selectAllDbBtn.classList.contains('active')) ||
            (selectAllCb && selectAllCb.checked)) {
            return window.IDCardApp.allDbCardIds;
        }
    }
    // Otherwise, return selected visible checkboxes
    return originalGetSelectedCardIds();
}

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

    // No explicit selection  fetch ALL card IDs from database (filter-aware)
    const tableId = window.IDCardApp.tableId || (typeof TABLE_ID !== 'undefined' ? TABLE_ID : null);

    if (!tableId) {
        console.error('getAllCardIdsForAction: TABLE_ID not found');
        return [];
    }

    try {
        const qs = _buildFilterQS();
        const data = await ApiClient.get(`/api/table/${tableId}/cards/all-ids/?${qs}`);
        if (data.success && data.card_ids) {
            return data.card_ids;
        }
        return [];
    } catch (error) {
        console.error('Error fetching all card IDs:', error);
        return [];
    }
}

// ==========================================
// EXPORTS
// ==========================================

window.IDCardApp.getRowCheckboxes = getRowCheckboxes;
window.IDCardApp.getSelectedCardIds = getSelectedCardIdsWithDbSelect;
window.IDCardApp.getAllVisibleCardIds = getAllVisibleCardIds;
window.IDCardApp.getCardIdsForAction = getCardIdsForAction;
window.IDCardApp.updateButtonStates = updateButtonStates;
window.IDCardApp.initCheckboxes = initCheckboxes;
window.IDCardApp.initSelectAllDbButton = initSelectAllDbButton;
window.IDCardApp.getAllCardIdsForAction = getAllCardIdsForAction;
window.IDCardApp._cacheToolbarButtons = _cacheToolbarButtons;
window.IDCardApp._buildFilterQS = _buildFilterQS;

})();
