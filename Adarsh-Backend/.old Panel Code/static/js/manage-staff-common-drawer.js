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

    var labels = cfg.labels || {};

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
    var selectedChipWrap = document.getElementById(prefix + '-selected-chip-container');
    var selectedChipLabel = document.getElementById(prefix + '-selected-chip-label');
    var selectedChipClearBtn = document.getElementById(prefix + '-selected-chip-clear');
    var isSingleSelect = cfg.assignment && cfg.assignment.singleSelect === true;

    var classSectionFilterSection = document.getElementById('class-section-filter-section');
    var staffInfoSection          = document.getElementById('staff-info-section');
    var staffPermissionsSection   = document.getElementById('staff-permissions-section');

    function setDrawerSectionVisibility(mode) {
        var assignmentOnly = mode === 'assign';

        if (assignSection) assignSection.style.display = assignmentOnly ? '' : 'none';
        if (classSectionFilterSection) classSectionFilterSection.style.display = assignmentOnly ? '' : 'none';
        if (staffInfoSection) staffInfoSection.style.display = assignmentOnly ? 'none' : '';
        if (staffPermissionsSection) staffPermissionsSection.style.display = assignmentOnly ? 'none' : '';

        var nameInput = document.getElementById('staff-name');
        var emailInput = document.getElementById('staff-email');
        var passwordInput = document.getElementById('staff-password');

        if (nameInput) nameInput.required = !assignmentOnly;
        if (emailInput) emailInput.required = !assignmentOnly;
        if (passwordInput) passwordInput.required = false;
    }

    var allItems    = [];          // { id, name }
    var selectedIds = new Set();

    async function fetchItems() {
        allItems = await ctx._api.fetchAssignmentItems(cfg);
    }

    async function refreshAssignmentItems(preselectedIds) {
        await fetchItems();

        var nextSelectedIds = Array.isArray(preselectedIds) ? preselectedIds : Array.from(selectedIds);
        selectedIds = new Set((nextSelectedIds || []).map(function (id) { return parseInt(id, 10); }).filter(function (id) { return Number.isFinite(id); }));
        updateSelectionText();
        renderList(msSearch ? msSearch.value : '');
        if (typeof cfg.onAssignmentSelectionChange === 'function') {
            cfg.onAssignmentSelectionChange(Array.from(selectedIds), { mode: currentMode });
        }
    }

    function renderList(filter) {
        if (!msList) return;
        msList.innerHTML = '';

        var excludedIdSet = new Set();
        if (cfg.assignment && typeof cfg.assignment.getExcludedIds === 'function') {
            try {
                (cfg.assignment.getExcludedIds() || []).forEach(function (rawId) {
                    var id = parseInt(rawId, 10);
                    if (Number.isFinite(id)) excludedIdSet.add(id);
                });
            } catch (_) {}
        }

        var term = (filter || '').toLowerCase().trim();
        var filtered = allItems.filter(function (it) {
            var itemId = parseInt(it.id, 10);
            if (excludedIdSet.has(itemId)) return false;
            return !term || it.name.toLowerCase().includes(term);
        });

        filtered.sort(function (a, b) {
            var aid = parseInt(a.id, 10);
            var bid = parseInt(b.id, 10);
            var as = selectedIds.has(aid) ? 0 : 1;
            var bs = selectedIds.has(bid) ? 0 : 1;
            if (as !== bs) return as - bs;
            return a.name.localeCompare(b.name);
        });

        if (filtered.length === 0) { if (msEmpty) msEmpty.style.display = ''; return; }
        if (msEmpty) msEmpty.style.display = 'none';

        var _esc = window.escapeHtml || function (s) {
            return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
        };

        filtered.forEach(function (item) {
            var itemId = parseInt(item.id, 10);
            var div = document.createElement('div');
            div.className = 'client-multiselect-item' + (selectedIds.has(itemId) ? ' selected' : '');
            div.innerHTML = '<input type="checkbox" ' + (selectedIds.has(itemId) ? 'checked' : '') +
                ' data-' + prefix + '-id="' + item.id + '"><span class="client-name">' + _esc(item.name) + '</span>';
            div.addEventListener('click', function (e) {
                e.stopPropagation();
                var cb = div.querySelector('input[type="checkbox"]');
                if (e.target !== cb) cb.checked = !cb.checked;
                if (cb.checked) {
                    if (isSingleSelect) {
                        selectedIds = new Set([itemId]);
                        renderList(msSearch ? msSearch.value : '');
                        closeMsDropdown();
                    } else {
                        selectedIds.add(itemId);
                        div.classList.add('selected');
                    }
                } else {
                    selectedIds.delete(itemId);
                    if (isSingleSelect) {
                        renderList(msSearch ? msSearch.value : '');
                    } else {
                        div.classList.remove('selected');
                    }
                }
                updateSelectionText();
                if (typeof cfg.onAssignmentSelectionChange === 'function') {
                    cfg.onAssignmentSelectionChange(Array.from(selectedIds), { mode: currentMode });
                }
            });
            msList.appendChild(div);
        });
    }

    function updateSelectedChip() {
        if (!selectedChipWrap || !selectedChipLabel) return;
        if (selectedIds.size === 0) {
            selectedChipWrap.style.display = 'none';
            selectedChipLabel.textContent = '-';
            return;
        }
        var selectedId = Array.from(selectedIds)[0];
        var selectedItem = allItems.find(function (it) { return parseInt(it.id, 10) === parseInt(selectedId, 10); });
        selectedChipLabel.textContent = selectedItem ? selectedItem.name : String(selectedId);
        selectedChipWrap.style.display = '';
    }

    function updateSelectionText() {
        if (!msText) return;
        var count = selectedIds.size;
        if (count === 0) {
            msText.textContent = cfg.assignment.placeholder;
            msText.classList.remove('has-selection');
        } else {
            if (isSingleSelect || count <= 2) {
                var names = allItems
                    .filter(function (it) { return selectedIds.has(parseInt(it.id, 10)); })
                    .map(function (it) { return it.name; });
                msText.textContent = names.join(', ');
            } else {
                msText.textContent = count + ' ' + cfg.assignment.pluralLabel + ' selected';
            }
            msText.classList.add('has-selection');
        }
        updateSelectedChip();
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

        var preselectedSet = new Set((preselectedIds || []).map(function (id) { return parseInt(id, 10); }));
        var matchByParentId = cfg.assignment && cfg.assignment.matchByParentId === true;
        selectedIds = new Set();

        allItems.forEach(function (item) {
            var itemId = parseInt(item.id, 10);
            var groupId = parseInt(item.group_id, 10);
            if (
                preselectedSet.has(itemId)
                || (matchByParentId && Number.isFinite(groupId) && preselectedSet.has(groupId))
            ) {
                selectedIds.add(itemId);
            }
        });

        if (isSingleSelect && selectedIds.size > 1) {
            var firstSelected = Array.from(selectedIds)[0];
            selectedIds = new Set([firstSelected]);
        }

        updateSelectionText();
        closeMsDropdown();
        if (typeof cfg.onAssignmentSelectionChange === 'function') {
            cfg.onAssignmentSelectionChange(Array.from(selectedIds), { mode: currentMode });
        }
    }

    function resetAssignment() {
        selectedIds = new Set();
        if (msText) { msText.textContent = cfg.assignment.placeholder; msText.classList.remove('has-selection'); }
        updateSelectedChip();
        closeMsDropdown();
    }

    function clearAssignmentSelection(options) {
        selectedIds = new Set();
        updateSelectionText();
        renderList(msSearch ? msSearch.value : '');
        if (!options || options.silent !== true) {
            if (typeof cfg.onAssignmentSelectionChange === 'function') {
                cfg.onAssignmentSelectionChange([], { mode: currentMode });
            }
        }
    }

    if (selectedChipClearBtn) {
        selectedChipClearBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            selectedIds = new Set();
            updateSelectionText();
            renderList(msSearch ? msSearch.value : '');
            if (typeof cfg.onAssignmentSelectionChange === 'function') {
                cfg.onAssignmentSelectionChange([], { mode: currentMode });
            }
        });
    }

    fetchItems();

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
        if (staffData && (mode === 'edit' || mode === 'assign' || mode === 'view')) {
            var resolvedStaffId = parseInt(staffData.id, 10);
            if (Number.isFinite(resolvedStaffId) && resolvedStaffId > 0) {
                ctx.selectedStaffId = resolvedStaffId;
            }
        }
        staffForm.reset();

        // Let page-specific hook run (e.g. reset status dropdown)
        if (cfg.onDrawerReset) cfg.onDrawerReset();

        cfg.permissionFields.forEach(function (f) { var el = document.getElementById(f); if (el) el.checked = false; });
        resetAssignment();
        resetPasswordOption();
        setDrawerSectionVisibility(currentMode);

        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span id="submit-btn-text">Add Staff</span>';
        var submitBtnText = document.getElementById('submit-btn-text');

        if (mode === 'add') {
            drawerTitle.textContent = labels.addTitle || 'Add New Staff';
            drawerIcon.className = 'fa-solid fa-user-plus';
            if (submitBtnText) submitBtnText.textContent = labels.addSubmit || 'Add Staff';
            submitBtn.style.display = 'inline-flex';
            enableFormInputs(true);
            if (pwOptionSelect) {
                pwOptionSelect.value = 'custom';
                if (pwGroup) pwGroup.style.display = '';
                if (pwInput) pwInput.required = true;
            }
            // Show password option for new staff
            if (pwRow) pwRow.style.display = '';
            // Hide temp password button in add mode
            var tempPwBtn = document.getElementById('tempPasswordStaffBtn');
            if (tempPwBtn) tempPwBtn.style.display = 'none';
            // Permissions stay OFF by default for new staff (already reset above)
        } else if (mode === 'edit') {
            drawerTitle.textContent = labels.editTitle || 'Edit Staff';
            drawerIcon.className = 'fa-solid fa-pen-to-square';
            if (submitBtnText) submitBtnText.textContent = labels.editSubmit || 'Save Changes';
            submitBtn.style.display = 'inline-flex';
            enableFormInputs(true);
            if (pwOptionSelect) {
                pwOptionSelect.value = 'phone';
                if (pwGroup) pwGroup.style.display = 'none';
                if (pwInput) pwInput.required = false;
            }
            // Hide password option when editing
            if (pwRow) pwRow.style.display = 'none';
            // Show temp password button in edit mode
            var tempPwBtn = document.getElementById('tempPasswordStaffBtn');
            if (tempPwBtn) tempPwBtn.style.display = '';
            if (staffData) {
                populateForm(staffData);
                setDrawerSectionVisibility(mode);
            }
        } else if (mode === 'assign') {
            drawerTitle.textContent = labels.assignTitle || 'Assign Groups, Classes & Sections';
            drawerIcon.className = 'fa-solid fa-link';
            if (submitBtnText) submitBtnText.textContent = labels.assignSubmit || 'Save Assignment';
            submitBtn.style.display = 'inline-flex';
            enableFormInputs(true);
            // Hide password option in assign mode
            if (pwRow) pwRow.style.display = 'none';
            // Hide temp password button in assign mode
            var tempPwBtn = document.getElementById('tempPasswordStaffBtn');
            if (tempPwBtn) tempPwBtn.style.display = 'none';
            if (staffData) populateForm(staffData);
        } else if (mode === 'view') {
            drawerTitle.textContent = labels.viewTitle || 'View Staff Details';
            drawerIcon.className = 'fa-solid fa-eye';
            submitBtn.style.display = 'none';
            enableFormInputs(false);
            // Hide password option in view mode
            if (pwRow) pwRow.style.display = 'none';
            // Hide temp password button in view mode
            var tempPwBtn = document.getElementById('tempPasswordStaffBtn');
            if (tempPwBtn) tempPwBtn.style.display = 'none';
            if (staffData) {
                populateForm(staffData);
                setDrawerSectionVisibility(mode);
            }
        }

        staffDrawer.classList.add('open');
        if (staffOverlay) staffOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        if (currentMode === 'add' || currentMode === 'assign') {
            refreshAssignmentItems([]);
        }

        // Attach sanitizer (shows inline hint on blur, strips bad chars)
        if (window.DataSanitizer) DataSanitizer.attachToForm(staffForm);
    }

    function populateForm(d) {
        document.getElementById('staff-name').value    = d.name    || '';
        document.getElementById('staff-email').value   = d.email   || '';
        document.getElementById('staff-phone').value   = d.phone   || '';
        document.getElementById('staff-address').value = d.address || '';

        // Status  page-specific hook sets the dropdown or hidden input
        if (cfg.onSetStatus) cfg.onSetStatus(d.status === 'active' ? 'true' : 'false');
        else document.getElementById('staff-status').value = d.status === 'active' ? 'true' : 'false';

        cfg.permissionFields.forEach(function (f) {
            var el = document.getElementById(f);
            var api = f.replace(/-/g, '_');
            if (el) el.checked = d[api] === true;
        });

        if (cfg.onBeforeAssignmentInit) {
            cfg.onBeforeAssignmentInit(d, { mode: currentMode });
        }

        initAssignment(d[cfg.assignment.preselectedKey] || []);

        // Allow page-specific extensions to populate custom fields
        if (cfg.onPopulateForm) cfg.onPopulateForm(d, { mode: currentMode });
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
    if (addStaffBtn && !addStaffBtn.dataset.drawerAttached)  {
        addStaffBtn.addEventListener('click', function () { openDrawer('add'); });
        addStaffBtn.dataset.drawerAttached = '1';
    }
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
    
    // ==================== ASSIGN BUTTON HANDLER ====================
    var assignStaffBtn = document.getElementById('assignStaffBtn');
    if (assignStaffBtn) {
        assignStaffBtn.addEventListener('click', async function () {
            if (!ctx.selectedStaffId) return;
            try {
                var d = await ctx._api.fetchStaffDetails(cfg, ctx.selectedStaffId);
                if (d) {
                    openDrawer('assign', d);
                } else {
                    showToast('Failed to load staff data', 'error');
                }
            } catch (err) {
                showToast(err.message || 'Failed to load staff data', 'error');
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

            var isAssignMode = currentMode === 'assign';
            var isUpdateMode = (currentMode === 'edit' || currentMode === 'assign') && ctx.selectedStaffId;
            var isCreateMode = !isUpdateMode;
            var formData = {};

            if (!isAssignMode) {
                formData = {
                    name:      document.getElementById('staff-name').value.trim(),
                    email:     document.getElementById('staff-email').value.trim(),
                    phone:     document.getElementById('staff-phone').value.trim(),
                    address:   (document.getElementById('staff-address') || {}).value || '',
                    is_active: document.getElementById('staff-status').value === 'true',
                };

                if (!formData.name) {
                    showToast('Name is required', 'error');
                    btn.disabled = false;
                    btn.innerHTML = origHtml;
                    return;
                }

                // Sanitize text fields before submission; email exempt from char rules
                if (window.DataSanitizer) {
                    var _sanitized = DataSanitizer.sanitizeFormData(formData, ['email']);
                    formData = _sanitized.data;
                }

                // Validate/create password strategy
                if (isCreateMode && pwOptionSelect) {
                    if (pwOptionSelect.value === 'custom') {
                        if (!pwInput || !pwInput.value.trim()) {
                            showToast('Custom password is required when phone password is not used', 'error');
                            btn.disabled = false;
                            btn.innerHTML = origHtml;
                            return;
                        }
                        formData.password = pwInput.value.trim();
                    } else if (!formData.phone) {
                        showToast('Phone is required when using phone number as password', 'error');
                        btn.disabled = false;
                        btn.innerHTML = origHtml;
                        return;
                    }
                }

                cfg.permissionFields.forEach(function (f) {
                    var el  = document.getElementById(f);
                    var api = f.replace(/-/g, '_');
                    if (el) formData[api] = cfg.respectDisabledPerms ? (el.disabled ? false : el.checked) : el.checked;
                });
            }

            if (isAssignMode && cfg.assignment && cfg.assignment.payloadKey) {
                formData[cfg.assignment.payloadKey] = Array.from(selectedIds);
            }

            // Allow page-specific extensions to add custom data
            try {
                if (cfg.onBeforeSubmit) cfg.onBeforeSubmit(formData, { mode: currentMode });
            } catch (err) {
                showToast(err.message || 'Please complete the required fields', 'error');
                btn.disabled = false;
                btn.innerHTML = origHtml;
                return;
            }

            var result;
            try {
                result = isUpdateMode
                    ? await ctx._api.updateStaff(cfg, ctx.selectedStaffId, formData)
                    : await ctx._api.createStaff(cfg, formData);

                if (result.success) {
                    showToast(result.message || 'Operation successful', 'success');
                    closeDrawer();
                    if (cfg.onFormSuccess) {
                        cfg.onFormSuccess(result, {
                            mode: currentMode,
                            selectedStaffId: ctx.selectedStaffId,
                        });
                    }
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
    // Outside click close disabled  prevent accidental closure

    // ==================== RETURN DRAWER API ====================
    return {
        openDrawer:  openDrawer,
        closeDrawer: closeDrawer,
        clearAssignmentSelection: clearAssignmentSelection,
        refreshAssignmentItems: refreshAssignmentItems,
    };
};

})();
