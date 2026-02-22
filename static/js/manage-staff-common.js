/**
 * Shared Staff Management Module
 * Config-driven factory used by both admin (manage-staff.js) and
 * client (manage-client-staff.js) pages.
 *
 * Eliminates ~700 lines of duplicated pagination, multi-select,
 * row-selection, search/filter, drawer, and form-submit logic.
 */
(function () {
'use strict';

window.initStaffPage = function (cfg) {

    // ==================== ELEMENTS ====================
    const staffDrawer   = document.getElementById('staff-drawer');
    const staffOverlay  = document.getElementById('staff-drawer-overlay');
    const staffForm     = document.getElementById('staff-form');
    const drawerTitle   = document.getElementById('drawer-title-text');
    const drawerIcon    = document.getElementById('drawer-icon');
    const submitBtn     = document.getElementById('drawer-submit-btn');

    const addStaffBtn    = document.getElementById('addStaffBtn');
    const editStaffBtn   = document.getElementById('editStaffBtn');
    const viewStaffBtn   = document.getElementById('viewStaffBtn');
    const deleteStaffBtn = document.getElementById('deleteStaffBtn');
    const activeStaffBtn = document.getElementById('activeStaffBtn');

    const closeDrawerBtn  = document.getElementById('drawer-close-btn');
    const cancelDrawerBtn = document.getElementById('drawer-cancel-btn');

    const tableDelegate = document.getElementById(cfg.tableDelegateId || 'staff-table-body');

    let selectedStaffId = null;
    let selectedRow     = null;
    let currentMode     = 'add';

    // ==================== ROW SELECTION ====================
    function getTbody() {
        return document.getElementById('staff-table-body');
    }

    function selectStaffRow(row) {
        if (!row || !row.dataset.staffId) return;
        var tb = getTbody();
        if (tb) tb.querySelectorAll('tr').forEach(function (r) { r.classList.remove('selected'); });
        row.classList.add('selected');
        selectedRow     = row;
        selectedStaffId = row.dataset.staffId;
        enableActionButtons(true);
        updateActiveButtonState();
        if (typeof window.alpineUpdateSelection === 'function') window.alpineUpdateSelection([selectedStaffId]);
    }

    function clearStaffSelection() {
        var tb = getTbody();
        if (tb) tb.querySelectorAll('tr').forEach(function (r) { r.classList.remove('selected'); });
        selectedRow     = null;
        selectedStaffId = null;
        enableActionButtons(false);
        if (typeof window.alpineClearSelection === 'function') window.alpineClearSelection();
    }

    if (tableDelegate) {
        tableDelegate.addEventListener('click', function (e) {
            var row = e.target.closest('tr');
            if (row && row.dataset.staffId && !row.classList.contains('no-data-row')) selectStaffRow(row);
        });
    }

    function enableActionButtons(enable) {
        if (editStaffBtn)   editStaffBtn.disabled   = !enable;
        if (activeStaffBtn) activeStaffBtn.disabled = !enable;
        if (deleteStaffBtn) deleteStaffBtn.disabled = !enable;
        if (viewStaffBtn)   viewStaffBtn.disabled   = !enable;
    }

    function updateActiveButtonState() {
        if (!selectedRow || !activeStaffBtn) return;
        var status   = selectedRow.dataset.staffStatus;
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

    // ==================== MULTI-SELECT ASSIGNMENT ====================
    var prefix = cfg.assignment.prefix;   // 'client' | 'group'

    var assignSection   = document.getElementById(prefix + '-assignment-section');
    var msToggle        = document.getElementById(prefix + '-multiselect-toggle');
    var msDropdown      = document.getElementById(prefix + '-multiselect-dropdown');
    var msList          = document.getElementById(prefix + '-multiselect-list');
    var msText          = document.getElementById(prefix + '-multiselect-text');
    var msSearch        = document.getElementById(prefix + '-search-input');
    var msEmpty         = document.getElementById(prefix + '-multiselect-empty');

    var allItems    = [];          // { id, name }
    var selectedIds = new Set();

    async function fetchItems() {
        try {
            var data = await ApiClient.get(cfg.assignment.apiUrl);
            if (data.success) allItems = data[cfg.assignment.responseKey] || [];
        } catch (_) { allItems = []; }
    }

    function renderList(filter) {
        if (!msList) return;
        msList.innerHTML = '';
        var term = (filter || '').toLowerCase().trim();
        var filtered = allItems.filter(function (it) { return !term || it.name.toLowerCase().includes(term); });

        filtered.sort(function (a, b) {
            var as = selectedIds.has(a.id) ? 0 : 1;
            var bs = selectedIds.has(b.id) ? 0 : 1;
            if (as !== bs) return as - bs;
            return a.name.localeCompare(b.name);
        });

        if (filtered.length === 0) { if (msEmpty) msEmpty.style.display = ''; return; }
        if (msEmpty) msEmpty.style.display = 'none';

        var _esc = window.escapeHtml || function (s) {
            return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
        };

        filtered.forEach(function (item) {
            var div = document.createElement('div');
            div.className = 'client-multiselect-item' + (selectedIds.has(item.id) ? ' selected' : '');
            div.innerHTML = '<input type="checkbox" ' + (selectedIds.has(item.id) ? 'checked' : '') +
                ' data-' + prefix + '-id="' + item.id + '"><span class="client-name">' + _esc(item.name) + '</span>';
            div.addEventListener('click', function (e) {
                e.stopPropagation();
                var cb = div.querySelector('input[type="checkbox"]');
                if (e.target !== cb) cb.checked = !cb.checked;
                if (cb.checked) { selectedIds.add(item.id); div.classList.add('selected'); }
                else            { selectedIds.delete(item.id); div.classList.remove('selected'); }
                updateSelectionText();
            });
            msList.appendChild(div);
        });
    }

    function updateSelectionText() {
        if (!msText) return;
        var count = selectedIds.size;
        if (count === 0) {
            msText.textContent = cfg.assignment.placeholder;
            msText.classList.remove('has-selection');
        } else {
            if (count <= 2) {
                var names = allItems.filter(function (it) { return selectedIds.has(it.id); }).map(function (it) { return it.name; });
                msText.textContent = names.join(', ');
            } else {
                msText.textContent = count + ' ' + cfg.assignment.pluralLabel + ' selected';
            }
            msText.classList.add('has-selection');
        }
    }

    function openMsDropdown()  { if (!msDropdown) return; msDropdown.style.display = ''; if (msToggle) msToggle.classList.add('open'); if (msSearch) { msSearch.value = ''; msSearch.focus(); } renderList(); }
    function closeMsDropdown() { if (!msDropdown) return; msDropdown.style.display = 'none'; if (msToggle) msToggle.classList.remove('open'); }

    if (msToggle) {
        msToggle.addEventListener('click', function (e) {
            e.stopPropagation();
            if (msDropdown && msDropdown.style.display !== 'none') closeMsDropdown(); else openMsDropdown();
        });
    }
    if (msSearch) {
        msSearch.addEventListener('input', function () { renderList(msSearch.value); });
        msSearch.addEventListener('click', function (e) { e.stopPropagation(); });
    }
    document.addEventListener('click', function (e) {
        if (msDropdown && msDropdown.style.display !== 'none') {
            var container = document.getElementById(prefix + '-multiselect');
            if (container && !container.contains(e.target)) closeMsDropdown();
        }
    });

    async function initAssignment(preselectedIds) {
        if (!assignSection) return;
        assignSection.style.display = '';
        if (allItems.length === 0) await fetchItems();
        selectedIds = new Set((preselectedIds || []).map(function (id) { return parseInt(id); }));
        updateSelectionText();
        closeMsDropdown();
    }

    function resetAssignment() {
        selectedIds = new Set();
        if (msText) { msText.textContent = cfg.assignment.placeholder; msText.classList.remove('has-selection'); }
        closeMsDropdown();
    }

    // ==================== DRAWER ====================
    // Password option helpers
    var pwOptionSelect = document.getElementById('staff-password-option');
    var pwGroup = document.getElementById('staffCustomPasswordGroup');
    var pwInput = document.getElementById('staff-password');
    var pwRow = document.getElementById('staffPasswordOptionRow');

    function resetPasswordOption() {
        if (pwOptionSelect) pwOptionSelect.value = 'phone';
        if (pwGroup) pwGroup.style.display = 'none';
        if (pwInput) { pwInput.value = ''; pwInput.required = false; }
    }

    // For client-staff page (plain <select>)
    if (pwOptionSelect && pwOptionSelect.tagName === 'SELECT') {
        pwOptionSelect.addEventListener('change', function () {
            var val = pwOptionSelect.value;
            if (pwGroup) pwGroup.style.display = val === 'custom' ? '' : 'none';
            if (pwInput) {
                pwInput.required = val === 'custom';
                if (val !== 'custom') pwInput.value = '';
            }
        });
    }

    function openDrawer(mode, staffData) {
        currentMode = mode || 'add';
        staffForm.reset();

        // Let page-specific hook run (e.g. reset status dropdown)
        if (cfg.onDrawerReset) cfg.onDrawerReset();

        cfg.permissionFields.forEach(function (f) { var el = document.getElementById(f); if (el) el.checked = false; });
        resetAssignment();
        resetPasswordOption();

        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span id="submit-btn-text">Add Staff</span>';
        var submitBtnText = document.getElementById('submit-btn-text');

        if (mode === 'add') {
            drawerTitle.textContent = 'Add New Staff';
            drawerIcon.className = 'fa-solid fa-user-plus';
            if (submitBtnText) submitBtnText.textContent = 'Add Staff';
            submitBtn.style.display = 'inline-flex';
            enableFormInputs(true);
            initAssignment([]);
            // Show password option for new staff
            if (pwRow) pwRow.style.display = '';
            // Hide temp password button in add mode
            var tempPwBtn = document.getElementById('tempPasswordStaffBtn');
            if (tempPwBtn) tempPwBtn.style.display = 'none';
            // Permissions stay OFF by default for new staff (already reset above)
        } else if (mode === 'edit') {
            drawerTitle.textContent = 'Edit Staff';
            drawerIcon.className = 'fa-solid fa-pen-to-square';
            if (submitBtnText) submitBtnText.textContent = 'Save Changes';
            submitBtn.style.display = 'inline-flex';
            enableFormInputs(true);
            // Hide password option when editing
            if (pwRow) pwRow.style.display = 'none';
            // Show temp password button in edit mode
            var tempPwBtn = document.getElementById('tempPasswordStaffBtn');
            if (tempPwBtn) tempPwBtn.style.display = '';
            if (staffData) populateForm(staffData);
        } else if (mode === 'view') {
            drawerTitle.textContent = 'View Staff Details';
            drawerIcon.className = 'fa-solid fa-eye';
            submitBtn.style.display = 'none';
            enableFormInputs(false);
            // Hide password option in view mode
            if (pwRow) pwRow.style.display = 'none';
            // Hide temp password button in view mode
            var tempPwBtn = document.getElementById('tempPasswordStaffBtn');
            if (tempPwBtn) tempPwBtn.style.display = 'none';
            if (staffData) populateForm(staffData);
        }

        staffDrawer.classList.add('open');
        if (staffOverlay) staffOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function populateForm(d) {
        document.getElementById('staff-name').value    = d.name    || '';
        document.getElementById('staff-email').value   = d.email   || '';
        document.getElementById('staff-phone').value   = d.phone   || '';
        document.getElementById('staff-address').value = d.address || '';

        // Status — page-specific hook sets the dropdown or hidden input
        if (cfg.onSetStatus) cfg.onSetStatus(d.status === 'active' ? 'true' : 'false');
        else document.getElementById('staff-status').value = d.status === 'active' ? 'true' : 'false';

        cfg.permissionFields.forEach(function (f) {
            var el = document.getElementById(f);
            var api = f.replace(/-/g, '_');
            if (el) el.checked = d[api] === true;
        });
        initAssignment(d[cfg.assignment.preselectedKey] || []);

        // Allow page-specific extensions to populate custom fields
        if (cfg.onPopulateForm) cfg.onPopulateForm(d);
    }

    function closeDrawer() {
        staffDrawer.classList.remove('open');
        if (staffOverlay) staffOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    function enableFormInputs(enable) {
        staffDrawer.querySelectorAll('input, select, textarea').forEach(function (input) {
            if (cfg.skipHiddenInputs && input.type === 'hidden') return;
            input.disabled = !enable;
            input.style.backgroundColor = enable ? '' : '#f5f5f5';
            input.style.cursor          = enable ? '' : 'not-allowed';
        });
        // Page-specific hook for status dropdown, etc.
        if (cfg.onEnableFormInputs) cfg.onEnableFormInputs(enable);

        if (msToggle) {
            if (!enable) { msToggle.style.pointerEvents = 'none'; msToggle.style.opacity = '0.6'; closeMsDropdown(); }
            else         { msToggle.style.pointerEvents = '';     msToggle.style.opacity = ''; }
        }
    }

    // ==================== API CALLS ====================
    async function fetchStaffDetails(id) {
        try {
            var data = await ApiClient.get(cfg.api.fetchUrl(id));
            if (data.success) return data[cfg.api.fetchResponseKey];
            showToast(data[cfg.api.errorKey] || 'Failed to fetch staff details', 'error');
            return null;
        } catch (_) { showToast('Network error. Please try again.', 'error'); return null; }
    }

    async function createStaff(formData) {
        try { return await ApiClient[cfg.api.createMethod](cfg.api.createUrl, formData); }
        catch (_) { return { success: false, message: 'Network error. Please try again.' }; }
    }

    async function updateStaff(id, formData) {
        var ep = cfg.api.updateEndpoint(id);
        try { return await ApiClient[ep.method](ep.url, formData); }
        catch (_) { return { success: false, message: 'Network error. Please try again.' }; }
    }

    async function deleteStaffApi(id) {
        var ep = cfg.api.deleteEndpoint(id);
        try { return await ApiClient[ep.method](ep.url); }
        catch (_) { return { success: false, message: 'Network error. Please try again.' }; }
    }

    async function toggleStaffStatus(id) {
        try { return await ApiClient.post(cfg.api.toggleUrl(id)); }
        catch (_) { return { success: false, message: 'Network error. Please try again.' }; }
    }

    // ==================== EVENT HANDLERS ====================
    if (addStaffBtn)  addStaffBtn.addEventListener('click', function () { openDrawer('add'); });
    if (editStaffBtn) editStaffBtn.addEventListener('click', async function () {
        if (!selectedStaffId) return;
        var d = await fetchStaffDetails(selectedStaffId);
        if (d) openDrawer('edit', d);
    });
    if (viewStaffBtn) viewStaffBtn.addEventListener('click', async function () {
        if (!selectedStaffId) return;
        var d = await fetchStaffDetails(selectedStaffId);
        if (d) openDrawer('view', d);
    });
    if (deleteStaffBtn) deleteStaffBtn.addEventListener('click', function () {
        if (!selectedStaffId || !selectedRow) return;
        var name = selectedRow.querySelector('td:nth-child(' + cfg.nameColumnIndex + ')').textContent;
        cfg.openDeleteModal(name);
    });
    if (activeStaffBtn) {
        activeStaffBtn.addEventListener('click', async function () {
            if (!selectedStaffId || !selectedRow) return;
            // Page-specific: admin opens confirmation modal, client toggles directly
            if (cfg.onStatusToggle) {
                cfg.onStatusToggle(selectedStaffId, selectedRow);
            } else {
                // Default: toggle directly
                try {
                    var result = await toggleStaffStatus(selectedStaffId);
                    if (result.success) {
                        showToast(result.message, 'success');
                        selectedRow.dataset.staffStatus = result.status;
                        var badge = selectedRow.querySelector('.status-badge');
                        if (badge) { badge.textContent = result.status_display; badge.className = 'status-badge ' + (result.status === 'active' ? 'active' : 'inactive'); }
                        updateActiveButtonState();
                    } else {
                        showToast(result[cfg.api.errorKey] || result.message || 'Failed to update status', 'error');
                    }
                } catch (err) { showToast(err.message || 'Failed to update status', 'error'); }
            }
        });
    }

    // Form submit
    if (staffForm) {
        staffForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            var btn = staffForm.querySelector('button[type="submit"]');
            if (btn.disabled) return;
            btn.disabled = true;
            var origHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

            var formData = {
                name:      document.getElementById('staff-name').value,
                email:     document.getElementById('staff-email').value,
                phone:     document.getElementById('staff-phone').value,
                address:   (document.getElementById('staff-address') || {}).value || '',
                is_active: document.getElementById('staff-status').value === 'true',
            };

            // Add custom password if selected
            if (pwOptionSelect && pwOptionSelect.value === 'custom' && pwInput && pwInput.value.trim()) {
                formData.password = pwInput.value.trim();
            }

            cfg.permissionFields.forEach(function (f) {
                var el  = document.getElementById(f);
                var api = f.replace(/-/g, '_');
                if (el) formData[api] = cfg.respectDisabledPerms ? (el.disabled ? false : el.checked) : el.checked;
            });
            formData[cfg.assignment.payloadKey] = Array.from(selectedIds);

            // Allow page-specific extensions to add custom data
            if (cfg.onBeforeSubmit) cfg.onBeforeSubmit(formData);

            var result;
            try {
                result = (currentMode === 'edit' && selectedStaffId)
                    ? await updateStaff(selectedStaffId, formData)
                    : await createStaff(formData);

                if (result.success) {
                    showToast(result.message || 'Operation successful', 'success');
                    closeDrawer();
                    if (cfg.onFormSuccess) cfg.onFormSuccess();
                    else setTimeout(function () { location.reload(); }, 500);
                } else {
                    showToast(result[cfg.api.errorKey] || result.message || 'Operation failed', 'error');
                    btn.disabled = false;
                    btn.innerHTML = origHtml;
                }
            } catch (err) {
                showToast(err.message || 'An error occurred. Please try again.', 'error');
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        });
    }

    // Close drawer events
    if (closeDrawerBtn)  closeDrawerBtn.addEventListener('click', closeDrawer);
    if (cancelDrawerBtn) cancelDrawerBtn.addEventListener('click', function (e) { e.preventDefault(); closeDrawer(); });
    // Outside click close disabled — prevent accidental closure

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
        openDrawer('add');
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // ==================== DELETE CONFIRMATION ====================
    var confirmDeleteBtn  = document.getElementById('confirmDeleteBtn');
    var deleteStaffNameEl = document.getElementById('deleteStaffName');

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async function () {
            if (!selectedStaffId) return;
            var result = await deleteStaffApi(selectedStaffId);
            if (result.success) {
                showToast(result.message || 'Staff deleted successfully', 'success');
                if (cfg.closeDeleteModal) cfg.closeDeleteModal();
                if (selectedRow) selectedRow.remove();
                selectedStaffId = null;
                selectedRow = null;
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
    var rowsPerPage  = 10;
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

    // ==================== PUBLIC API ====================
    return {
        openDrawer:          openDrawer,
        closeDrawer:         closeDrawer,
        toggleStaffStatus:   toggleStaffStatus,
        updateActiveButtonState: updateActiveButtonState,
        getSelectedStaffId:  function () { return selectedStaffId; },
        getSelectedRow:      function () { return selectedRow; },
        setDeleteStaffName:  function (n) { if (deleteStaffNameEl) deleteStaffNameEl.textContent = n; },
    };
};

})();
