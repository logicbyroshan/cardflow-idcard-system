/**
 * Staff Drawer UI Module
 * Handles drawer open/close/populate, multi-select rendering,
 * form data collection, permission fields, status/password dropdowns,
 * button event handlers, and form submit.
 *
 * Called by manage-staff-common-list.js via window._StaffDrawerSetup(cfg, ctx).
 * Requires manage-staff-common-api.js (window._StaffCommonAPI) to be loaded first.
 */
(function () {
'use strict';

window._StaffDrawerSetup = function (cfg, ctx) {

    // ==================== DRAWER ELEMENTS ====================
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

    var currentMode = 'add';

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
        allItems = await ctx._api.fetchAssignmentItems(cfg);
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

    // ==================== PASSWORD OPTIONS ====================
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

    // ==================== DRAWER OPEN / CLOSE / POPULATE ====================
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

        // Attach sanitizer (shows inline hint on blur, strips bad chars)
        if (window.DataSanitizer) DataSanitizer.attachToForm(staffForm);
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
            // Don't re-enable permission checkboxes that are locked (client lacks this permission)
            if (enable && input.type === 'checkbox' && input.closest('.perm-locked')) return;
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

    // ==================== BUTTON EVENT HANDLERS ====================
    if (addStaffBtn)  addStaffBtn.addEventListener('click', function () { openDrawer('add'); });
    if (editStaffBtn) editStaffBtn.addEventListener('click', async function () {
        if (!ctx.selectedStaffId) return;
        var d = await ctx._api.fetchStaffDetails(cfg, ctx.selectedStaffId);
        if (d) openDrawer('edit', d);
    });
    if (viewStaffBtn) viewStaffBtn.addEventListener('click', async function () {
        if (!ctx.selectedStaffId) return;
        var d = await ctx._api.fetchStaffDetails(cfg, ctx.selectedStaffId);
        if (d) openDrawer('view', d);
    });
    if (deleteStaffBtn) deleteStaffBtn.addEventListener('click', function () {
        if (!ctx.selectedStaffId || !ctx.selectedRow) return;
        var name = ctx.selectedRow.querySelector('td:nth-child(' + cfg.nameColumnIndex + ')').textContent;
        cfg.openDeleteModal(name);
    });
    if (activeStaffBtn) {
        activeStaffBtn.addEventListener('click', async function () {
            if (!ctx.selectedStaffId || !ctx.selectedRow) return;
            // Page-specific: admin opens confirmation modal, client toggles directly
            if (cfg.onStatusToggle) {
                cfg.onStatusToggle(ctx.selectedStaffId, ctx.selectedRow);
            } else {
                // Default: toggle directly
                try {
                    var result = await ctx._api.toggleStaffStatus(cfg, ctx.selectedStaffId);
                    if (result.success) {
                        showToast(result.message, 'success');
                        ctx.selectedRow.dataset.staffStatus = result.status;
                        var badge = ctx.selectedRow.querySelector('.status-badge');
                        if (badge) { badge.textContent = result.status_display; badge.className = 'status-badge ' + (result.status === 'active' ? 'active' : 'inactive'); }
                        ctx.updateActiveButtonState();
                    } else {
                        showToast(result[cfg.api.errorKey] || result.message || 'Failed to update status', 'error');
                    }
                } catch (err) { showToast(err.message || 'Failed to update status', 'error'); }
            }
        });
    }

    // ==================== FORM SUBMIT ====================
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

            // Sanitize text fields before submission; email exempt from char rules
            if (window.DataSanitizer) {
                var _sanitized = DataSanitizer.sanitizeFormData(formData, ['email']);
                formData = _sanitized.data;
            }

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
                result = (currentMode === 'edit' && ctx.selectedStaffId)
                    ? await ctx._api.updateStaff(cfg, ctx.selectedStaffId, formData)
                    : await ctx._api.createStaff(cfg, formData);

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

    // ==================== RETURN DRAWER API ====================
    return {
        openDrawer:  openDrawer,
        closeDrawer: closeDrawer,
    };
};

})();
