// ID Card Actions - Table State & Filters Module
// Shared state, helpers, and filter/sort functions
// Part of: idcard-actions-table split (state  render  load)

(function() {
'use strict';

var _validSortModes = {
    'sr-asc': true,
    'sr-desc': true,
    'name-asc': true,
    'name-desc': true,
    'date-new': true,
    'date-old': true,
};

function _initialSortFromUrl() {
    try {
        var raw = new URLSearchParams(window.location.search || '').get('sort') || 'sr-asc';
        var normalized = String(raw || '').trim().toLowerCase();
        return _validSortModes[normalized] ? normalized : 'sr-asc';
    } catch (_err) {
        return 'sr-asc';
    }
}

// ==========================================
// SHARED STATE (used by all table sub-modules)
// ==========================================
window.IDCardApp = window.IDCardApp || {};

var _ts = {
    allRows: [],
    filteredRows: [],
    currentPage: 1,
    rowsPerPage: 100,
    currentFilter: 'all',
    currentSort: _initialSortFromUrl(),
    searchQuery: '',
    currentFilterField: 'all',
    endlessScrollMode: true,
    lazyLoadState: {
        isLoading: false,
        hasMore: false,
        totalCount: 0,
        loadedCount: 0,
        batchSize: 100,
        triggerOffset: 15,
        tableId: typeof TABLE_ID !== 'undefined' ? TABLE_ID : null,
        currentStatus: typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : 'pending'
    },
    // Cleanup tracking resources
    _lazyLoadInterval: null,
    _scrollHandler: null,
    _scrollTarget: null,
    _sentinelObserver: null,
    _loadRequestSeq: 0,
    _loadCooldown: false,
    _loadedCardIds: new Set()
};

window.IDCardApp._ts = _ts;

// Expose state globally (preserves original API)
window.IDCardApp.tableState = {
    get allRows() { return _ts.allRows; },
    get filteredRows() { return _ts.filteredRows; },
    get currentPage() { return _ts.currentPage; },
    set currentPage(val) { _ts.currentPage = val; },
    get rowsPerPage() { return _ts.rowsPerPage; },
    set rowsPerPage(val) { _ts.rowsPerPage = val; },
    get searchQuery() { return _ts.searchQuery; },
    set searchQuery(val) { _ts.searchQuery = val; },
    get lazyLoadState() { return _ts.lazyLoadState; }
};

// Expose lazyLoadState directly (preserves original API)
window.IDCardApp.lazyLoadState = _ts.lazyLoadState;

// ==========================================
// INITIALIZE ROWS
// ==========================================

function initializeRows() {
    const tableBody = document.getElementById('cardsTableBody');
    if (!tableBody) return;
    _ts.allRows = Array.from(tableBody.querySelectorAll('tr[data-card-id]'));
    _ts.filteredRows = [..._ts.allRows];
}

// ==========================================
// LAZY LOAD STATE INITIALIZATION
// ==========================================

function earlyInitLazyLoadState() {
    const paginationBar = document.getElementById('paginationBar');
    if (paginationBar) {
        _ts.lazyLoadState.totalCount = parseInt(paginationBar.dataset.totalCount) || 0;
        _ts.lazyLoadState.hasMore = paginationBar.dataset.hasMore === 'true';
        _ts.lazyLoadState.loadedCount = parseInt(paginationBar.dataset.initialLoaded) || 0;
        if (!_ts.lazyLoadState.tableId && paginationBar.dataset.tableId) {
            _ts.lazyLoadState.tableId = parseInt(paginationBar.dataset.tableId);
        }
        if (paginationBar.dataset.status) {
            _ts.lazyLoadState.currentStatus = paginationBar.dataset.status;
        }
        // Disable bulk buttons early if no cards
        setTimeout(updateBulkActionButtons, 0);
    }
}

function initLazyLoadState() {
    const paginationBar = document.getElementById('paginationBar');
    if (paginationBar) {
        _ts.lazyLoadState.totalCount = parseInt(paginationBar.dataset.totalCount) || 0;
        _ts.lazyLoadState.hasMore = paginationBar.dataset.hasMore === 'true';
        // Use nullish-safe parse: parseInt("0") is 0 (falsy), so || fallback
        // would skip it. Use explicit NaN check instead.
        var _initLoaded = parseInt(paginationBar.dataset.initialLoaded);
        _ts.lazyLoadState.loadedCount = isNaN(_initLoaded) ? _ts.allRows.length : _initLoaded;
        if (!_ts.lazyLoadState.tableId && paginationBar.dataset.tableId) {
            _ts.lazyLoadState.tableId = parseInt(paginationBar.dataset.tableId);
        }
        if (paginationBar.dataset.status) {
            _ts.lazyLoadState.currentStatus = paginationBar.dataset.status;
        }
    } else {
        _ts.lazyLoadState.loadedCount = _ts.allRows.length;
        _ts.lazyLoadState.totalCount = _ts.allRows.length;
        _ts.lazyLoadState.hasMore = false;
    }
    
    window.IDCardApp.updateLazyLoadPaginationInfo();
    updateBulkActionButtons();
}

// ==========================================
// BULK ACTION BUTTONS STATE
// ==========================================

/**
 * Updates bulk action buttons (download, reupload) based on whether there are cards.
 * Disables these buttons when totalCount is 0.
 */
function updateBulkActionButtons() {
    const hasCards = _ts.lazyLoadState.totalCount > 0;
    
    // Get all bulk download/reupload buttons across all status action bars
    const bulkButtons = [
        // Pending
        'downloadImgBtn', 'downloadDocxBtn', 'downloadXlsxBtn', 'downloadPdfBtn', 'reuploadImageBtn',
        // Verified
        'downloadImgBtnV', 'downloadDocxBtnV', 'downloadXlsxBtnV', 'downloadPdfBtnV', 'reuploadImageBtnV',
        // Approved
        'downloadImgBtnA', 'downloadDocxBtnA', 'downloadXlsxBtnA', 'downloadPdfBtnA', 'reuploadImageBtnA', 'downloadCardBtn',
        // Download
        'downloadImgBtnD', 'downloadDocxBtnD', 'downloadXlsxBtnD', 'downloadPdfBtnD', 'reuploadImageBtnD',
        // Pool
        'downloadImgBtnP', 'downloadDocxBtnP', 'downloadXlsxBtnP', 'downloadPdfBtnP', 'reuploadImageBtnP'
    ];
    
    bulkButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.disabled = !hasCards;
            if (!hasCards) {
                btn.title = 'No data available';
            }
        }
    });
}

// ==========================================
// DATE/NAME/SR HELPERS
// ==========================================

function getRowDate(row) {
    const cells = row.querySelectorAll('td');
    const dateCell = cells[cells.length - 2];
    if (!dateCell) return new Date(0);
    
    const dateText = dateCell.textContent.trim();
    const parsed = Date.parse(dateText.replace(/-/g, ' '));
    return isNaN(parsed) ? new Date(0) : new Date(parsed);
}

function getRowName(row) {
    const cells = row.querySelectorAll('td');
    if (cells.length > 2) {
        return cells[2].textContent.trim().toLowerCase();
    }
    return '';
}

function getRowSrNo(row) {
    const cells = row.querySelectorAll('td');
    if (cells.length > 1) {
        return parseInt(cells[1].textContent.trim()) || 0;
    }
    return 0;
}

function getFieldColumnIndex(fieldName) {
    const headerRow = document.querySelector('.idcard-table thead tr');
    if (!headerRow) return -1;
    
    const headers = headerRow.querySelectorAll('th');
    for (let i = 0; i < headers.length; i++) {
        const headerText = headers[i].textContent.trim().toUpperCase();
        if (headerText === fieldName.toUpperCase()) {
            return i;
        }
    }
    return -1;
}

// ==========================================
// FILTER AND SORT
// ==========================================

function searchRows(query) {
    _ts.searchQuery = query.toLowerCase().trim();
    // Server-side search: reset table and reload with search param
    window.IDCardApp.resetAndReload();
}

function filterByField(fieldName) {
    _ts.currentFilterField = fieldName;
    // Field filter is client-side only  just re-run local filter on loaded rows
    applyFiltersAndSort();
}

function sortRows(sortValue) {
    _ts.currentSort = sortValue;
    // Server-side sort: reset table and reload with sort param
    window.IDCardApp.resetAndReload();
}

/**
 * Build URL query params for server-side filtering.
 * Reads current filter state from module locals + IDCardApp namespace.
 */
function _buildFilterParams() {
    var params = new URLSearchParams();
    params.set('status', _ts.lazyLoadState.currentStatus || '');
    params.set('offset', _ts.lazyLoadState.loadedCount.toString());
    params.set('limit', _ts.lazyLoadState.batchSize.toString());

    if (_ts.searchQuery) params.set('search', _ts.searchQuery);
    if (IDCardApp.currentClassFilter) params.set('class', IDCardApp.currentClassFilter);
    if (IDCardApp.currentSectionFilter) params.set('section', IDCardApp.currentSectionFilter);
    if (IDCardApp.currentCourseFilter) params.set('course', IDCardApp.currentCourseFilter);
    if (IDCardApp.currentBranchFilter) params.set('branch', IDCardApp.currentBranchFilter);
    if (_ts.currentSort) params.set('sort', _ts.currentSort);
    if (IDCardApp._activeImageSort) {
        params.set('image_column', IDCardApp._activeImageSort.column || '');
        params.set('image_condition', IDCardApp._activeImageSort.condition || '');
    }
    // DateTime range (download list)  read from Flatpickr inputs
    var fromDate = document.getElementById('fromDateFilter');
    var toDate = document.getElementById('toDateFilter');
    if (fromDate && fromDate.value) params.set('from', fromDate.value);
    if (toDate && toDate.value) params.set('to', toDate.value);
    return params.toString();
}

/**
 * Client-side filter for date range only.
 * Search, class/section, image, and sort are all handled server-side now.
 * This function only applies the lightweight date filter (today/week/month)
 * on already-loaded rows.
 */
function applyFiltersAndSort() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    var monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    var hasDateFilter = _ts.currentFilter !== 'all' && (_ts.currentFilter === 'today' || _ts.currentFilter === 'week' || _ts.currentFilter === 'month');

    if (hasDateFilter) {
        _ts.filteredRows = _ts.allRows.filter(function(row) {
            var rowDate = getRowDate(row);
            rowDate.setHours(0, 0, 0, 0);
            if (_ts.currentFilter === 'today') {
                return rowDate.getTime() === today.getTime();
            } else if (_ts.currentFilter === 'week') {
                return rowDate >= weekAgo;
            } else if (_ts.currentFilter === 'month') {
                return rowDate >= monthAgo;
            }
            return true;
        });
    } else {
        _ts.filteredRows = _ts.allRows.slice();
    }

    _ts.currentPage = 1;
    window.IDCardApp.renderTable();
}

// ==========================================
// EXPORTS
// ==========================================

// Public API (preserves original exports)
window.IDCardApp.updateBulkActionButtons = updateBulkActionButtons;
window.IDCardApp.initializeRows = initializeRows;
window.IDCardApp.searchRows = searchRows;
window.IDCardApp.filterByField = filterByField;
window.IDCardApp.sortRows = sortRows;
window.IDCardApp.applyFiltersAndSort = applyFiltersAndSort;

// Internal helpers for other table sub-modules
window.IDCardApp._earlyInitLazyLoadState = earlyInitLazyLoadState;
window.IDCardApp._initLazyLoadState = initLazyLoadState;
window.IDCardApp._buildFilterParams = _buildFilterParams;
window.IDCardApp._getRowDate = getRowDate;
window.IDCardApp._getRowName = getRowName;
window.IDCardApp._getRowSrNo = getRowSrNo;
window.IDCardApp._getFieldColumnIndex = getFieldColumnIndex;

})();
