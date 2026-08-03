/**
 * Staff List & Page Init Module
 * Row selection, search, filter, pagination, delete confirmation,
 * auto-open drawer, and window.initStaffPage export wrapper.
 *
 * Requires manage-staff-common-api.js    (window._StaffCommonAPI)   and
 *          manage-staff-common-drawer.js  (window._StaffDrawerSetup) to be loaded first.
 */
(function () {
'use strict';

window.initStaffPage = function (cfg) {

    // ==================== SHARED CONTEXT ====================
    var _api = window._StaffCommonAPI;
    var ctx = {
        _api:                   _api,
        selectedStaffId:        null,
        selectedRow:            null,
        enableActionButtons:    null,   // set below
        updateActiveButtonState: null,  // set below
    };

    // ==================== ELEMENTS ====================
    const tableDelegate = document.getElementById(cfg.tableDelegateId || 'staff-table-body');

    // ==================== ROW SELECTION ====================
    function getTbody() {
        return document.getElementById('staff-table-body');
    }

    function selectStaffRow(row) {
        if (!row || !row.dataset.staffId) return;
        var tb = getTbody();
        if (tb) tb.querySelectorAll('tr').forEach(function (r) { r.classList.remove('selected'); });
        row.classList.add('selected');
        ctx.selectedRow     = row;
        ctx.selectedStaffId = row.dataset.staffId;
        enableActionButtons(true);
        updateActiveButtonState();
        if (typeof window.alpineUpdateSelection === 'function') window.alpineUpdateSelection([ctx.selectedStaffId]);
    }

    function clearStaffSelection() {
        var tb = getTbody();
        if (tb) tb.querySelectorAll('tr').forEach(function (r) { r.classList.remove('selected'); });
        ctx.selectedRow     = null;
        ctx.selectedStaffId = null;
        enableActionButtons(false);
        if (typeof window.alpineClearSelection === 'function') window.alpineClearSelection();
    }

    if (tableDelegate) {
        tableDelegate.addEventListener('click', function (e) {
            var viewMoreBtn = e.target.closest('.staff-assignment-view-more');
            if (viewMoreBtn) {
                e.preventDefault();
                e.stopPropagation();

                var viewRow = viewMoreBtn.closest('tr');
                if (viewRow && viewRow.dataset.staffId && !viewRow.classList.contains('no-data-row')) {
                    selectStaffRow(viewRow);
                }

                if (typeof window.openStaffAssignmentDrawerFromTable === 'function') {
                    window.openStaffAssignmentDrawerFromTable(viewMoreBtn.dataset.staffId);
                } else {
                    var assignStaffBtn = document.getElementById('assignStaffBtn');
                    var viewStaffBtn = document.getElementById('viewStaffBtn');
                    if (assignStaffBtn && !assignStaffBtn.disabled) assignStaffBtn.click();
                    else if (viewStaffBtn && !viewStaffBtn.disabled) viewStaffBtn.click();
                }
                return;
            }

            var row = e.target.closest('tr');
            if (row && row.dataset.staffId && !row.classList.contains('no-data-row')) selectStaffRow(row);
        });
    }

    function enableActionButtons(enable) {
        var editStaffBtn   = document.getElementById('editStaffBtn');
        var activeStaffBtn = document.getElementById('activeStaffBtn');
        var deleteStaffBtn = document.getElementById('deleteStaffBtn');
        var viewStaffBtn   = document.getElementById('viewStaffBtn');
        var assignStaffBtn = document.getElementById('assignStaffBtn');
        if (editStaffBtn)   editStaffBtn.disabled   = !enable;
        if (activeStaffBtn) activeStaffBtn.disabled = !enable;
        if (deleteStaffBtn) deleteStaffBtn.disabled = !enable;
        if (viewStaffBtn)   viewStaffBtn.disabled   = !enable;
        if (assignStaffBtn) assignStaffBtn.disabled = !enable;
    }

    function updateActiveButtonState() {
        var activeStaffBtn = document.getElementById('activeStaffBtn');
        if (!ctx.selectedRow || !activeStaffBtn) return;
        var status   = ctx.selectedRow.dataset.staffStatus;
        var isActive = status === 'active';
        if (isActive) {
            activeStaffBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Inactive';
            activeStaffBtn.classList.remove('btn-active');
            activeStaffBtn.classList.add('btn-inactive');
        } else {
            activeStaffBtn.innerHTML = '<i class="fa-solid fa-check"></i> Active';
            activeStaffBtn.classList.remove('btn-inactive');
            activeStaffBtn.classList.add('btn-active');
        }
    }

    // Expose to ctx for drawer module
    ctx.enableActionButtons     = enableActionButtons;
    ctx.updateActiveButtonState = updateActiveButtonState;

    // ==================== DRAWER SETUP ====================
    var drawerApi = window._StaffDrawerSetup(cfg, ctx);
    window._staffDrawerApi = drawerApi;
    if (drawerApi && typeof drawerApi.refreshAssignmentItems === 'function') {
        drawerApi.refreshAssignmentItems([]);
    }

    // ==================== FILTER & SEARCH ====================
    var dropdownToggle  = document.getElementById('statusToggle');
    var dropdownOptions = document.getElementById('statusOptions');
    var filterDropdown  = document.getElementById('status-dropdown');
    var selectedText    = document.getElementById('statusSelectedText');
    var searchInput     = document.getElementById('searchInput');

    var currentFilter = '';

    function performSearch() {
        var term = searchInput ? searchInput.value.toLowerCase().trim() : '';
        document.querySelectorAll('.data-table tbody tr').forEach(function (row) {
            if (row.classList.contains('no-data-row')) return;
            var matchSearch = false, matchStatus = true;
            if (currentFilter === 'active' || currentFilter === 'inactive') matchStatus = row.dataset.staffStatus === currentFilter;
            if (!term) { matchSearch = true; } else { row.querySelectorAll('td').forEach(function (c) { if (c.textContent.toLowerCase().includes(term)) matchSearch = true; }); }
            row.style.display = (matchSearch && matchStatus) ? '' : 'none';
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', function () {
            performSearch();
            if (typeof window.alpineUpdateSearch === 'function') window.alpineUpdateSearch(searchInput.value);
        });
    }

    // Optional search clear button (client page)
    var searchClearBtn = document.getElementById('searchClearBtn');
    if (searchClearBtn && searchInput) {
        searchClearBtn.addEventListener('click', function () {
            searchInput.value = '';
            performSearch();
            if (typeof window.alpineUpdateSearch === 'function') window.alpineUpdateSearch('');
        });
    }

    if (dropdownToggle && dropdownOptions && filterDropdown) {
        dropdownToggle.addEventListener('click', function (e) { e.stopPropagation(); filterDropdown.classList.toggle('open'); });
        dropdownOptions.querySelectorAll('.dropdown-option').forEach(function (opt) {
            opt.addEventListener('click', function () {
                dropdownOptions.querySelectorAll('.dropdown-option').forEach(function (o) { o.classList.remove('selected'); });
                this.classList.add('selected');
                var val  = this.dataset.value;
                var text = this.textContent;
                selectedText.textContent = text;
                currentFilter = val;
                if (searchInput) searchInput.placeholder = val === '' ? 'Search All...' : 'Search ' + text + '...';
                filterDropdown.classList.remove('open');
                if (typeof window.alpineUpdateFilter === 'function') window.alpineUpdateFilter(val);
                performSearch();
            });
        });
        document.addEventListener('click', function () { filterDropdown.classList.remove('open'); });
    }

    // ==================== AUTO-OPEN DRAWER FROM URL ====================
    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('add') === '1') {
        drawerApi.openDrawer('add');
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // ==================== DELETE CONFIRMATION ====================
    var confirmDeleteBtn  = document.getElementById('confirmDeleteBtn');
    var deleteStaffNameEl = document.getElementById('deleteStaffName');

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async function () {
            if (!ctx.selectedStaffId) return;
            var result = await _api.deleteStaffApi(cfg, ctx.selectedStaffId);
            if (result.success) {
                showToast(result.message || 'Staff deleted successfully', 'success');
                if (cfg.closeDeleteModal) cfg.closeDeleteModal();
                if (ctx.selectedRow) ctx.selectedRow.remove();
                ctx.selectedStaffId = null;
                ctx.selectedRow = null;
                enableActionButtons(false);
            } else {
                showToast(result[cfg.api.errorKey] || result.message || 'Failed to delete staff', 'error');
            }
        });
    }

    // ==================== PAGINATION ====================
    var rowCountEl    = document.getElementById('row-count');
    var pageNumbersEl = document.getElementById('page-numbers');
    var firstPageBtn  = document.getElementById('firstPage');
    var prevPageBtn   = document.getElementById('prevPage');
    var nextPageBtn   = document.getElementById('nextPage');
    var lastPageBtn   = document.getElementById('lastPage');
    var rowsDropdown  = document.getElementById('rowsDropdown');
    var rowsToggle    = document.getElementById('rowsToggle');
    var rowsOptions   = document.getElementById('rowsOptions');
    var rowsSelText   = document.getElementById('rowsSelectedText');

    var currentPage  = 1;
    var rowsPerPage  = parseInt((rowsSelText && rowsSelText.textContent) || '25', 10);
    if (!rowsPerPage || rowsPerPage < 1) rowsPerPage = 25;
    var allRows      = [];
    var filteredRows = [];

    function initPagination() {
        var tb = getTbody();
        if (!tb) return;
        allRows      = Array.from(tb.querySelectorAll('tr:not(.no-data-row)'));
        filteredRows = allRows.slice();
        updatePagination();
    }

    function updatePagination() {
        filteredRows = allRows.filter(function (r) { return r.style.display !== 'none'; });
        var total      = filteredRows.length;
        var totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        var start = (currentPage - 1) * rowsPerPage;
        var end   = Math.min(start + rowsPerPage, total);

        allRows.forEach(function (r) { r.style.display = 'none'; });
        filteredRows.slice(start, end).forEach(function (r) { r.style.display = ''; });

        if (rowCountEl) {
            rowCountEl.innerHTML = total === 0
                ? 'Showing <strong>0</strong> results'
                : 'Showing <strong>' + (start + 1) + '-' + end + '</strong> of <strong>' + total + '</strong> results';
        }

        if (pageNumbersEl) {
            pageNumbersEl.innerHTML = '';
            var maxVis    = 5;
            var startPage = Math.max(1, currentPage - Math.floor(maxVis / 2));
            var endPage   = Math.min(totalPages, startPage + maxVis - 1);
            if (endPage - startPage < maxVis - 1) startPage = Math.max(1, endPage - maxVis + 1);
            for (var i = startPage; i <= endPage; i++) {
                var btn = document.createElement('button');
                btn.className = 'page-num' + (i === currentPage ? ' active' : '');
                btn.textContent = i;
                btn.addEventListener('click', (function (p) { return function () { goToPage(p); }; })(i));
                pageNumbersEl.appendChild(btn);
            }
        }

        if (firstPageBtn) firstPageBtn.disabled = currentPage === 1;
        if (prevPageBtn)  prevPageBtn.disabled  = currentPage === 1;
        if (nextPageBtn)  nextPageBtn.disabled  = currentPage === totalPages;
        if (lastPageBtn)  lastPageBtn.disabled  = currentPage === totalPages;
    }

    function goToPage(p) { currentPage = p; clearStaffSelection(); updatePagination(); }

    if (firstPageBtn) firstPageBtn.addEventListener('click', function () { goToPage(1); });
    if (prevPageBtn)  prevPageBtn.addEventListener('click',  function () { goToPage(currentPage - 1); });
    if (nextPageBtn)  nextPageBtn.addEventListener('click',  function () { goToPage(currentPage + 1); });
    if (lastPageBtn)  lastPageBtn.addEventListener('click',  function () { goToPage(Math.ceil(filteredRows.length / rowsPerPage)); });

    if (rowsDropdown && rowsToggle && rowsOptions) {
        rowsToggle.addEventListener('click', function (e) { e.stopPropagation(); rowsDropdown.classList.toggle('open'); });
        rowsOptions.querySelectorAll('.dropdown-option').forEach(function (opt) {
            opt.addEventListener('click', function () {
                rowsOptions.querySelectorAll('.dropdown-option').forEach(function (o) { o.classList.remove('selected'); });
                this.classList.add('selected');
                rowsPerPage = parseInt(this.dataset.value);
                if (rowsSelText) rowsSelText.textContent = rowsPerPage;
                currentPage = 1;
                rowsDropdown.classList.remove('open');
                updatePagination();
            });
        });
        document.addEventListener('click', function (e) { if (!rowsDropdown.contains(e.target)) rowsDropdown.classList.remove('open'); });
    }

    // Override search to integrate with pagination
    var origSearch = performSearch;
    function searchWithPagination() {
        var term = searchInput ? searchInput.value.toLowerCase().trim() : '';
        allRows.forEach(function (row) {
            var matchSearch = false, matchStatus = true;
            if (currentFilter === 'active' || currentFilter === 'inactive') matchStatus = row.dataset.staffStatus === currentFilter;
            if (!term) { matchSearch = true; } else { row.querySelectorAll('td').forEach(function (c) { if (c.textContent.toLowerCase().includes(term)) matchSearch = true; }); }
            row.dataset.filtered = (matchSearch && matchStatus) ? 'true' : 'false';
            row.style.display    = (matchSearch && matchStatus) ? '' : 'none';
        });
        currentPage = 1;
        updatePagination();
    }
    performSearch = searchWithPagination;
    if (searchInput) {
        searchInput.removeEventListener('input', origSearch);
        searchInput.addEventListener('input', searchWithPagination);
    }

    initPagination();

    function refreshTableState() {
        var tb = getTbody();
        if (!tb) return;
        allRows = Array.from(tb.querySelectorAll('tr[data-staff-id]'));
        performSearch();
    }

    function selectRowById(staffId) {
        if (!staffId) return;
        var tb = getTbody();
        if (!tb) return;
        var row = tb.querySelector('tr[data-staff-id="' + String(staffId) + '"]');
        if (row) selectStaffRow(row);
    }

    // ==================== PUBLIC API ====================
    return {
        openDrawer:          drawerApi.openDrawer,
        closeDrawer:         drawerApi.closeDrawer,
        toggleStaffStatus:   function (id) { return _api.toggleStaffStatus(cfg, id); },
        updateActiveButtonState: updateActiveButtonState,
        getSelectedStaffId:  function () { return ctx.selectedStaffId; },
        getSelectedRow:      function () { return ctx.selectedRow; },
        setDeleteStaffName:  function (n) { if (deleteStaffNameEl) deleteStaffNameEl.textContent = n; },
        refreshTableState:   refreshTableState,
        selectRowById:       selectRowById,
    };
};

})();
