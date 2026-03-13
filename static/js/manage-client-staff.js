// Manage Client Staff Page — config wrapper for manage-staff-common.js
// Uses client API endpoints and Group Assignment instead of Client Assignment.

document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    // ==================== CLASS/SECTION MULTI-SELECT ====================
    var allClasses = [];
    var allSections = [];
    var allBranches = [];
    var classSectionMap = {};
    var selectedClasses = new Set();
    var selectedSections = new Set();
    var selectedBranches = new Set();
    var csOptionsCache = {};

    var _esc = window.escapeHtml || function (s) {
        return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    };

    function formatDateTimeDisplay(dateInput) {
        var d = dateInput ? new Date(dateInput) : new Date();
        if (isNaN(d.getTime())) d = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function upsertStaffRow(detail, mode) {
        if (!detail || !detail.id) return;
        var tbody = document.getElementById('staff-table-body');
        if (!tbody) return;

        var emptyRow = tbody.querySelector('tr:not([data-staff-id])');
        if (emptyRow) emptyRow.remove();

        var row = tbody.querySelector('tr[data-staff-id="' + String(detail.id) + '"]');
        var isNew = !row;
        if (!row) {
            row = document.createElement('tr');
            row.setAttribute('data-staff-id', String(detail.id));
            row.innerHTML = [
                '<td class="font-medium text-gray-800"></td>',
                '<td class="email-cell"></td>',
                '<td class="phone-cell"></td>',
                '<td class="text-center"></td>',
                '<td class="text-gray-500"></td>',
                '<td class="text-gray-500"></td>'
            ].join('');
            tbody.insertBefore(row, tbody.firstChild);
        }

        var isActive = (detail.status === 'active') || detail.is_active === true;
        row.setAttribute('data-staff-status', isActive ? 'active' : 'inactive');

        var cells = row.children;
        if (cells[0]) cells[0].textContent = detail.name || '-';
        if (cells[1]) cells[1].textContent = detail.email || '-';
        if (cells[2]) cells[2].textContent = detail.phone || '-';
        if (cells[3]) {
            cells[3].innerHTML = '<span class="status-badge ' + (isActive ? 'active' : 'inactive') + '">' + (isActive ? 'Active' : 'Inactive') + '</span>';
        }

        if (cells[4] && (isNew || mode === 'add')) {
            cells[4].textContent = formatDateTimeDisplay(detail.created_at);
        }
        if (cells[5]) {
            cells[5].textContent = formatDateTimeDisplay(new Date());
        }
    }

    async function fetchStaffDetailById(staffId) {
        if (!staffId) return null;
        try {
            var resp = await fetch('/client/api/staff/' + staffId + '/', { credentials: 'same-origin' });
            if (!resp.ok) return null;
            var json = await resp.json();
            if (!json.success) return null;
            return json.data || null;
        } catch (_) {
            return null;
        }
    }

    function _normalizeGroupIds(groupIds) {
        if (!Array.isArray(groupIds) || groupIds.length === 0) return [];
        return Array.from(new Set(groupIds
            .map(function (v) { return parseInt(v, 10); })
            .filter(function (v) { return Number.isFinite(v) && v > 0; })))
            .sort(function (a, b) { return a - b; });
    }

    function _buildGroupScopedOptionsUrl(groupIds) {
        var normalized = _normalizeGroupIds(groupIds);
        if (!normalized.length) return '/client/api/class-section-options/';
        return '/client/api/class-section-options/?group_ids=' + encodeURIComponent(normalized.join(','));
    }

    function _applyClassSectionOptions(data) {
        allClasses = data.classes || [];
        allSections = data.sections || [];
        allBranches = data.branches || [];
        classSectionMap = data.class_sections || {};
    }

    async function fetchClassSectionOptions(groupIds) {
        var normalized = _normalizeGroupIds(groupIds);
        var cacheKey = normalized.length ? normalized.join(',') : 'all';

        if (csOptionsCache[cacheKey]) {
            _applyClassSectionOptions(csOptionsCache[cacheKey]);
            return;
        }

        try {
            var resp = await fetch(_buildGroupScopedOptionsUrl(normalized), { credentials: 'same-origin' });
            if (!resp.ok) return;
            var data = await resp.json();
            if (data.success) {
                csOptionsCache[cacheKey] = {
                    classes: data.classes || [],
                    sections: data.sections || [],
                    branches: data.branches || [],
                    class_sections: data.class_sections || {}
                };
                _applyClassSectionOptions(csOptionsCache[cacheKey]);
            }
        } catch (_) { /* silently fail */ }
    }

    function _getSectionsForSelectedClasses(classSet) {
        if (!classSet || classSet.size === 0) {
            return allSections.slice();
        }
        var out = new Set();
        classSet.forEach(function (cls) {
            var secList = classSectionMap[cls] || [];
            secList.forEach(function (sec) { out.add(sec); });
        });
        return Array.from(out).sort(function (a, b) { return a.localeCompare(b); });
    }

    function _pruneSectionsBySelectedClasses(sectionSet, classSet) {
        if (!sectionSet || !classSet || classSet.size === 0) return;
        var allowed = new Set(_getSectionsForSelectedClasses(classSet));
        Array.from(sectionSet).forEach(function (sec) {
            if (!allowed.has(sec)) sectionSet.delete(sec);
        });
    }

    function buildCsMultiselect(prefix, allItems, selectedSet, getItemsFn, onSelectionChange) {
        var toggle   = document.getElementById(prefix + '-multiselect-toggle');
        var dropdown = document.getElementById(prefix + '-multiselect-dropdown');
        var list     = document.getElementById(prefix + '-multiselect-list');
        var text     = document.getElementById(prefix + '-multiselect-text');
        var search   = document.getElementById(prefix + '-search-input');
        var empty    = document.getElementById(prefix + '-multiselect-empty');
        if (!toggle || !list) return;

        function _items() {
            return typeof getItemsFn === 'function' ? (getItemsFn() || []) : (allItems || []);
        }

        function render(filter) {
            list.innerHTML = '';
            var term = (filter || '').toLowerCase().trim();
            var sourceItems = _items();
            var filtered = sourceItems.filter(function (v) { return !term || v.toLowerCase().includes(term); });
            filtered.sort(function (a, b) {
                var sa = selectedSet.has(a) ? 0 : 1, sb = selectedSet.has(b) ? 0 : 1;
                if (sa !== sb) return sa - sb;
                return a.localeCompare(b);
            });
            if (filtered.length === 0) { if (empty) empty.style.display = ''; return; }
            if (empty) empty.style.display = 'none';
            filtered.forEach(function (val) {
                var div = document.createElement('div');
                div.className = 'client-multiselect-item' + (selectedSet.has(val) ? ' selected' : '');
                div.innerHTML = '<input type="checkbox" ' + (selectedSet.has(val) ? 'checked' : '') + '><span class="client-name">' + _esc(val) + '</span>';
                div.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var cb = div.querySelector('input[type="checkbox"]');
                    if (e.target !== cb) cb.checked = !cb.checked;
                    if (cb.checked) { selectedSet.add(val); div.classList.add('selected'); }
                    else            { selectedSet.delete(val); div.classList.remove('selected'); }
                    updateText();
                    if (typeof onSelectionChange === 'function') onSelectionChange(val, cb.checked);
                });
                list.appendChild(div);
            });
        }

        function updateText() {
            if (!text) return;
            var count = selectedSet.size;
            if (count === 0) { text.textContent = prefix === 'class' ? 'All classes' : (prefix === 'branch' ? 'All branches' : 'All sections'); text.classList.remove('has-selection'); }
            else if (count <= 2) { text.textContent = Array.from(selectedSet).join(', '); text.classList.add('has-selection'); }
            else { text.textContent = count + ' selected'; text.classList.add('has-selection'); }
        }

        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            if (dropdown.style.display !== 'none') { dropdown.style.display = 'none'; toggle.classList.remove('open'); }
            else { dropdown.style.display = ''; toggle.classList.add('open'); if (search) { search.value = ''; search.focus(); } render(); }
        });
        if (search) {
            search.addEventListener('input', function () { render(search.value); });
            search.addEventListener('click', function (e) { e.stopPropagation(); });
        }
        document.addEventListener('click', function (e) {
            if (dropdown.style.display !== 'none') {
                var container = document.getElementById(prefix + '-multiselect');
                if (container && !container.contains(e.target)) { dropdown.style.display = 'none'; toggle.classList.remove('open'); }
            }
        });

        return { render: render, updateText: updateText };
    }

    var classMs = null;
    var sectionMs = null;
    var branchMs = null;

    async function initClassSection(preClasses, preSections, preBranches, groupIds) {
        await fetchClassSectionOptions(groupIds || []);
        selectedClasses = new Set(preClasses || []);
        selectedSections = new Set(preSections || []);
        selectedBranches = new Set(preBranches || []);

        _pruneSectionsBySelectedClasses(selectedSections, selectedClasses);

        if (!classMs) {
            classMs = buildCsMultiselect('class', allClasses, selectedClasses, null, function () {
                _pruneSectionsBySelectedClasses(selectedSections, selectedClasses);
                if (sectionMs) {
                    sectionMs.render('');
                    sectionMs.updateText();
                }
            });
        }
        if (!sectionMs) {
            sectionMs = buildCsMultiselect('section', allSections, selectedSections, function () {
                return _getSectionsForSelectedClasses(selectedClasses);
            });
        }
        if (classMs) { classMs.render(); classMs.updateText(); }
        if (sectionMs) { sectionMs.render(); sectionMs.updateText(); }

        // Branch: auto-show if branches exist
        var branchRow = document.getElementById('branch-filter-row');
        if (allBranches.length > 0) {
            if (branchRow) branchRow.style.display = '';
            if (!branchMs) branchMs = buildCsMultiselect('branch', allBranches, selectedBranches);
            if (branchMs) { branchMs.render(); branchMs.updateText(); }
        } else {
            if (branchRow) branchRow.style.display = 'none';
        }
    }

    async function refreshDrawerClassSectionByGroups(groupIds) {
        await fetchClassSectionOptions(groupIds || []);
        _pruneSectionsBySelectedClasses(selectedSections, selectedClasses);

        if (classMs) { classMs.render(''); classMs.updateText(); }
        if (sectionMs) { sectionMs.render(''); sectionMs.updateText(); }

        var branchRow = document.getElementById('branch-filter-row');
        if (allBranches.length > 0) {
            if (branchRow) branchRow.style.display = '';
            if (!branchMs) branchMs = buildCsMultiselect('branch', allBranches, selectedBranches);
            if (branchMs) { branchMs.render(''); branchMs.updateText(); }
        } else {
            if (branchRow) branchRow.style.display = 'none';
            selectedBranches.clear();
        }
    }

    function resetClassSection() {
        selectedClasses = new Set();
        selectedSections = new Set();
        selectedBranches = new Set();
        var ct = document.getElementById('class-multiselect-text');
        var st = document.getElementById('section-multiselect-text');
        var bt = document.getElementById('branch-multiselect-text');
        if (ct) { ct.textContent = 'All classes'; ct.classList.remove('has-selection'); }
        if (st) { st.textContent = 'All sections'; st.classList.remove('has-selection'); }
        if (bt) { bt.textContent = 'All branches'; bt.classList.remove('has-selection'); }
    }

    // ==================== VANILLA JS DELETE MODAL (client-only) ====================
    var deleteModal       = document.getElementById('delete-modal');
    var closeDeleteModalB = document.getElementById('closeDeleteModal');
    var cancelDeleteBtn   = document.getElementById('cancelDeleteBtn');

    function closeDeleteModalFn() {
        if (deleteModal) { deleteModal.classList.remove('show'); document.body.style.overflow = ''; }
    }

    if (closeDeleteModalB) closeDeleteModalB.addEventListener('click', closeDeleteModalFn);
    if (cancelDeleteBtn)   cancelDeleteBtn.addEventListener('click', closeDeleteModalFn);

    // ==================== ASSIGN MODAL (Group / Class / Section) ====================
    var assignOverlay  = document.getElementById('assign-modal-overlay');
    var assignCloseBtn = document.getElementById('assign-modal-close');
    var assignCancelBtn = document.getElementById('assign-modal-cancel');
    var assignSaveBtn   = document.getElementById('assign-modal-save');
    var assignStaffName = document.getElementById('assign-staff-name');
    var _assignStaffId  = null;

    // Separate Sets for the assign-modal multi-selects
    var assignSelectedGroups   = new Set();
    var assignSelectedClasses  = new Set();
    var assignSelectedSections = new Set();
    var assignSelectedBranches = new Set();
    var _assignAllGroups   = [];
    var _assignGroupsLoaded = false;

    function openAssignModal() { if (assignOverlay) { assignOverlay.style.display = 'flex'; document.body.style.overflow = 'hidden'; } }
    function closeAssignModal() { if (assignOverlay) { assignOverlay.style.display = 'none'; document.body.style.overflow = ''; } }

    if (assignCloseBtn)  assignCloseBtn.addEventListener('click', closeAssignModal);
    if (assignCancelBtn) assignCancelBtn.addEventListener('click', closeAssignModal);

    // Reusable multi-select builder for the assign modal
    function buildAssignMultiselect(prefix, allItems, selectedSet, getItemsFn, onSelectionChange) {
        var toggle   = document.getElementById('assign-' + prefix + '-toggle');
        var dropdown = document.getElementById('assign-' + prefix + '-dropdown');
        var list     = document.getElementById('assign-' + prefix + '-list');
        var text     = document.getElementById('assign-' + prefix + '-text');
        var search   = document.getElementById('assign-' + prefix + '-search');
        var empty    = document.getElementById('assign-' + prefix + '-empty');
        if (!toggle || !list) return null;

        var defaultLabel = prefix === 'group' ? 'Select groups...' : (prefix === 'class' ? 'All classes' : (prefix === 'branch' ? 'All branches' : 'All sections'));

        function _items() {
            return typeof getItemsFn === 'function' ? (getItemsFn() || []) : (allItems || []);
        }

        function render(filter) {
            list.innerHTML = '';
            var term = (filter || '').toLowerCase().trim();
            var sourceItems = _items();
            var filtered = sourceItems.filter(function (item) {
                var label = typeof item === 'object' ? item.name : item;
                return !term || label.toLowerCase().includes(term);
            });
            // Sort: selected first
            filtered.sort(function (a, b) {
                var idA = typeof a === 'object' ? String(a.id) : a;
                var idB = typeof b === 'object' ? String(b.id) : b;
                var sa = selectedSet.has(idA) ? 0 : 1, sb = selectedSet.has(idB) ? 0 : 1;
                if (sa !== sb) return sa - sb;
                var la = typeof a === 'object' ? a.name : a;
                var lb = typeof b === 'object' ? b.name : b;
                return la.localeCompare(lb);
            });
            if (filtered.length === 0) { if (empty) empty.style.display = ''; return; }
            if (empty) empty.style.display = 'none';
            filtered.forEach(function (item) {
                var id    = typeof item === 'object' ? String(item.id) : item;
                var label = typeof item === 'object' ? item.name : item;
                var div = document.createElement('div');
                div.className = 'client-multiselect-item' + (selectedSet.has(id) ? ' selected' : '');
                div.innerHTML = '<input type="checkbox" ' + (selectedSet.has(id) ? 'checked' : '') + '><span class="client-name">' + _esc(label) + '</span>';
                div.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var cb = div.querySelector('input[type="checkbox"]');
                    if (e.target !== cb) cb.checked = !cb.checked;
                    if (cb.checked) { selectedSet.add(id); div.classList.add('selected'); }
                    else            { selectedSet.delete(id); div.classList.remove('selected'); }
                    updateText();
                    if (typeof onSelectionChange === 'function') onSelectionChange(id, cb.checked);
                });
                list.appendChild(div);
            });
        }

        function updateText() {
            if (!text) return;
            var count = selectedSet.size;
            if (count === 0) { text.textContent = defaultLabel; text.classList.remove('has-selection'); }
            else if (count <= 2) {
                var labels = [];
                _items().forEach(function (item) {
                    var id = typeof item === 'object' ? String(item.id) : item;
                    if (selectedSet.has(id)) labels.push(typeof item === 'object' ? item.name : item);
                });
                text.textContent = labels.join(', ');
                text.classList.add('has-selection');
            }
            else { text.textContent = count + ' selected'; text.classList.add('has-selection'); }
        }

        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            if (dropdown.style.display !== 'none') { dropdown.style.display = 'none'; toggle.classList.remove('open'); }
            else { dropdown.style.display = ''; toggle.classList.add('open'); if (search) { search.value = ''; search.focus(); } render(); }
        });
        if (search) {
            search.addEventListener('input', function () { render(search.value); });
            search.addEventListener('click', function (e) { e.stopPropagation(); });
        }
        document.addEventListener('click', function (e) {
            if (dropdown.style.display !== 'none') {
                var container = document.getElementById('assign-' + prefix + '-multiselect');
                if (container && !container.contains(e.target)) { dropdown.style.display = 'none'; toggle.classList.remove('open'); }
            }
        });

        return { render: render, updateText: updateText };
    }

    var assignGroupMs   = null;
    var assignClassMs   = null;
    var assignSectionMs = null;
    var assignBranchMs  = null;

    async function refreshAssignClassSectionByGroups(groupIds) {
        await fetchClassSectionOptions(groupIds || []);
        _pruneSectionsBySelectedClasses(assignSelectedSections, assignSelectedClasses);

        if (assignClassMs) { assignClassMs.render(''); assignClassMs.updateText(); }
        if (assignSectionMs) { assignSectionMs.render(''); assignSectionMs.updateText(); }

        var branchBlock = document.getElementById('assign-branch-block');
        if (allBranches.length > 0) {
            if (branchBlock) branchBlock.style.display = '';
            if (!assignBranchMs) assignBranchMs = buildAssignMultiselect('branch', allBranches, assignSelectedBranches);
            if (assignBranchMs) { assignBranchMs.render(''); assignBranchMs.updateText(); }
        } else {
            if (branchBlock) branchBlock.style.display = 'none';
            assignSelectedBranches.clear();
        }
    }

    async function loadAssignGroups() {
        if (_assignGroupsLoaded) return;
        try {
            var resp = await fetch('/client/api/groups/active/', { credentials: 'same-origin' });
            if (!resp.ok) return;
            var data = await resp.json();
            if (data.success) { _assignAllGroups = data.groups || []; _assignGroupsLoaded = true; }
        } catch (_) {}
    }

    async function openAssignForStaff(staffId) {
        _assignStaffId = staffId;

        // Load options in parallel
        await Promise.all([loadAssignGroups()]);

        // Fetch current staff data
        try {
            var resp = await fetch('/client/api/staff/' + staffId + '/', { credentials: 'same-origin' });
            if (!resp.ok) { if (typeof showToast === 'function') showToast('Failed to load staff data', 'error'); return; }
            var json = await resp.json();
            if (!json.success) { if (typeof showToast === 'function') showToast(json.error || 'Failed to load staff data', 'error'); return; }
            var data = json.data;

            // Set header name
            if (assignStaffName) assignStaffName.textContent = data.name || 'Staff';

            // Populate selections — clear and refill (NOT replace) to keep closure refs intact
            assignSelectedGroups.clear();
            (data.assigned_group_ids || []).forEach(function (id) { assignSelectedGroups.add(String(id)); });
            assignSelectedClasses.clear();
            (data.allowed_classes || []).forEach(function (v) { assignSelectedClasses.add(v); });
            assignSelectedSections.clear();
            (data.allowed_sections || []).forEach(function (v) { assignSelectedSections.add(v); });
            assignSelectedBranches.clear();
            (data.allowed_branches || []).forEach(function (v) { assignSelectedBranches.add(v); });

            await fetchClassSectionOptions(Array.from(assignSelectedGroups).map(function (id) { return parseInt(id, 10); }));

            _pruneSectionsBySelectedClasses(assignSelectedSections, assignSelectedClasses);

            // Build/update multi-selects
            if (!assignGroupMs) {
                assignGroupMs = buildAssignMultiselect('group', _assignAllGroups, assignSelectedGroups, null, function () {
                    refreshAssignClassSectionByGroups(Array.from(assignSelectedGroups).map(function (id) { return parseInt(id, 10); }));
                });
            }
            if (!assignClassMs) {
                assignClassMs = buildAssignMultiselect('class', allClasses, assignSelectedClasses, null, function () {
                    _pruneSectionsBySelectedClasses(assignSelectedSections, assignSelectedClasses);
                    if (assignSectionMs) {
                        assignSectionMs.render('');
                        assignSectionMs.updateText();
                    }
                });
            }
            if (!assignSectionMs) {
                assignSectionMs = buildAssignMultiselect('section', allSections, assignSelectedSections, function () {
                    return _getSectionsForSelectedClasses(assignSelectedClasses);
                });
            }

            // Branch multi-select: only show if branches exist (auto-detect college)
            var branchBlock = document.getElementById('assign-branch-block');
            if (allBranches.length > 0) {
                if (branchBlock) branchBlock.style.display = '';
                if (!assignBranchMs) assignBranchMs = buildAssignMultiselect('branch', allBranches, assignSelectedBranches);
                if (assignBranchMs) { assignBranchMs.render(); assignBranchMs.updateText(); }
            } else {
                if (branchBlock) branchBlock.style.display = 'none';
            }

            // Render with current selections
            if (assignGroupMs)   { assignGroupMs.render();   assignGroupMs.updateText(); }
            if (assignClassMs)   { assignClassMs.render();   assignClassMs.updateText(); }
            if (assignSectionMs) { assignSectionMs.render();  assignSectionMs.updateText(); }

            openAssignModal();

        } catch (err) {
            if (typeof showToast === 'function') showToast('Network error', 'error');
        }
    }

    // Save assignment
    if (assignSaveBtn) {
        assignSaveBtn.addEventListener('click', async function () {
            if (!_assignStaffId) return;
            assignSaveBtn.disabled = true;
            assignSaveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

            var payload = {
                assigned_groups:   Array.from(assignSelectedGroups).map(Number),
                allowed_classes:   Array.from(assignSelectedClasses),
                allowed_sections:  Array.from(assignSelectedSections),
                allowed_branches:  Array.from(assignSelectedBranches),
            };

            try {
                var csrfToken = '';
                var csrfEl = document.querySelector('[name=csrfmiddlewaretoken]') || document.querySelector('meta[name="csrf-token"]');
                if (csrfEl) csrfToken = csrfEl.value || csrfEl.getAttribute('content') || '';

                var resp = await fetch('/client/api/staff/' + _assignStaffId + '/', {
                    method: 'PUT',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken
                    },
                    body: JSON.stringify(payload)
                });

                var json = await resp.json();
                if (json.success) {
                    if (typeof showToast === 'function') showToast('Assignment saved successfully!', 'success');
                    closeAssignModal();
                } else {
                    if (typeof showToast === 'function') showToast(json.error || 'Failed to save assignment', 'error');
                }
            } catch (err) {
                if (typeof showToast === 'function') showToast('Network error', 'error');
            }

            assignSaveBtn.disabled = false;
            assignSaveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Save Assignment';
        });
    }

    // Wire up the Assign button in action bar
    var assignStaffBtn = document.getElementById('assignStaffBtn');
    if (assignStaffBtn) {
        assignStaffBtn.addEventListener('click', function () {
            var mgr = window._staffPageMgr;
            if (mgr && mgr.getSelectedStaffId && mgr.getSelectedStaffId()) {
                openAssignForStaff(mgr.getSelectedStaffId());
            }
        });
    }

    // ==================== INITIALIZE SHARED MODULE ====================
    var mgr = window.initStaffPage({

        tableDelegateId: 'staff-table-body',
        nameColumnIndex: 1,
        skipHiddenInputs: false,
        respectDisabledPerms: true,

        // Assignment: groups
        assignment: {
            prefix:          'group',
            apiUrl:          '/client/api/groups/active/',
            responseKey:     'groups',
            payloadKey:      'assigned_groups',
            preselectedKey:  'assigned_group_ids',
            placeholder:     'Select groups...',
            pluralLabel:     'groups',
        },

        // Permissions — full set mirroring STAFF_PERMISSION_FIELDS in services_staff.py
        permissionFields: [
            // ID Card List Tabs
            'perm-idcard-pending-list', 'perm-idcard-verified-list', 'perm-idcard-pool-list',
            'perm-idcard-approved-list', 'perm-idcard-download-list',
            // Card Actions
            'perm-idcard-add', 'perm-idcard-edit', 'perm-idcard-delete', 'perm-idcard-info',
            'perm-idcard-approve', 'perm-idcard-verify',
            'perm-idcard-created-at', 'perm-idcard-updated-at',
            'perm-idcard-delete-from-pool',
            // App & Access
            'perm-mobile-app'
        ],
        defaultOnPerms: [],

        // API endpoints (RESTful)
        api: {
            fetchUrl:          function (id) { return '/client/api/staff/' + id + '/'; },
            fetchResponseKey:  'data',
            errorKey:          'error',
            createUrl:         '/client/api/staff/',
            createMethod:      'post',
            updateEndpoint:    function (id) { return { url: '/client/api/staff/' + id + '/', method: 'put' }; },
            deleteEndpoint:    function (id) { return { url: '/client/api/staff/' + id + '/', method: 'delete' }; },
            toggleUrl:         function (id) { return '/client/api/staff/' + id + '/toggle-status/'; },
        },

        onDrawerReset: function () {
            resetClassSection();
            initClassSection([], [], [], []);
        },
        onPopulateForm: function (data) {
            initClassSection(data.allowed_classes, data.allowed_sections, data.allowed_branches, data.assigned_group_ids || []);
        },
        onAssignmentSelectionChange: function (selectedGroupIds) {
            refreshDrawerClassSectionByGroups(selectedGroupIds || []);
        },
        onBeforeSubmit: function (formData) {
            formData.allowed_classes = Array.from(selectedClasses);
            formData.allowed_sections = Array.from(selectedSections);
            formData.allowed_branches = Array.from(selectedBranches);
        },
        onSetStatus:        null,
        onEnableFormInputs: null,
        onStatusToggle:     null,

        // Delete modal (vanilla JS)
        openDeleteModal: function (name) {
            var el = document.getElementById('deleteStaffName');
            if (el) el.textContent = name;
            if (deleteModal) { deleteModal.classList.add('show'); document.body.style.overflow = 'hidden'; }
        },
        closeDeleteModal: closeDeleteModalFn,

        // Form success -> update table in-place (no full page reload)
        onFormSuccess: async function (result, meta) {
            var mode = meta && meta.mode ? meta.mode : 'edit';
            var editedId = meta && meta.selectedStaffId ? parseInt(meta.selectedStaffId, 10) : null;
            var createdId = result && result.data && result.data.staff_id ? parseInt(result.data.staff_id, 10) : null;
            var targetId = mode === 'add' ? createdId : editedId;

            if (!targetId) {
                setTimeout(function () { location.reload(); }, 250);
                return;
            }

            var detail = await fetchStaffDetailById(targetId);
            if (!detail) {
                setTimeout(function () { location.reload(); }, 250);
                return;
            }

            upsertStaffRow(detail, mode);

            if (mgr && typeof mgr.refreshTableState === 'function') {
                mgr.refreshTableState();
            }
            if (mgr && typeof mgr.selectRowById === 'function') {
                mgr.selectRowById(targetId);
            }
        },
    });

    // Init class/section on page load for "add" drawer
    fetchClassSectionOptions([]);

    // Expose manager for temp password modal access
    window._staffPageMgr = mgr;
});
