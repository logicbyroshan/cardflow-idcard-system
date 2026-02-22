// Manage Client Staff Page — config wrapper for manage-staff-common.js
// Uses client API endpoints and Group Assignment instead of Client Assignment.

document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    // ==================== CLASS/SECTION MULTI-SELECT ====================
    var allClasses = [];
    var allSections = [];
    var selectedClasses = new Set();
    var selectedSections = new Set();
    var csOptionsLoaded = false;

    var _esc = window.escapeHtml || function (s) {
        return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    };

    async function fetchClassSectionOptions() {
        if (csOptionsLoaded) return;
        try {
            var resp = await fetch('/panel/client/api/class-section-options/', { credentials: 'same-origin' });
            var data = await resp.json();
            if (data.success) {
                allClasses = data.classes || [];
                allSections = data.sections || [];
                csOptionsLoaded = true;
            }
        } catch (_) { /* silently fail */ }
    }

    function buildCsMultiselect(prefix, allItems, selectedSet) {
        var toggle   = document.getElementById(prefix + '-multiselect-toggle');
        var dropdown = document.getElementById(prefix + '-multiselect-dropdown');
        var list     = document.getElementById(prefix + '-multiselect-list');
        var text     = document.getElementById(prefix + '-multiselect-text');
        var search   = document.getElementById(prefix + '-search-input');
        var empty    = document.getElementById(prefix + '-multiselect-empty');
        if (!toggle || !list) return;

        function render(filter) {
            list.innerHTML = '';
            var term = (filter || '').toLowerCase().trim();
            var filtered = allItems.filter(function (v) { return !term || v.toLowerCase().includes(term); });
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
                });
                list.appendChild(div);
            });
        }

        function updateText() {
            if (!text) return;
            var count = selectedSet.size;
            if (count === 0) { text.textContent = prefix === 'class' ? 'All classes' : 'All sections'; text.classList.remove('has-selection'); }
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

    async function initClassSection(preClasses, preSections) {
        await fetchClassSectionOptions();
        selectedClasses = new Set(preClasses || []);
        selectedSections = new Set(preSections || []);
        if (!classMs) classMs = buildCsMultiselect('class', allClasses, selectedClasses);
        if (!sectionMs) sectionMs = buildCsMultiselect('section', allSections, selectedSections);
        if (classMs) { classMs.render(); classMs.updateText(); }
        if (sectionMs) { sectionMs.render(); sectionMs.updateText(); }
    }

    function resetClassSection() {
        selectedClasses = new Set();
        selectedSections = new Set();
        var ct = document.getElementById('class-multiselect-text');
        var st = document.getElementById('section-multiselect-text');
        if (ct) { ct.textContent = 'All classes'; ct.classList.remove('has-selection'); }
        if (st) { st.textContent = 'All sections'; st.classList.remove('has-selection'); }
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

    // ==================== INITIALIZE SHARED MODULE ====================
    var mgr = window.initStaffPage({

        tableDelegateId: 'staff-table-body',
        nameColumnIndex: 2,
        skipHiddenInputs: false,
        respectDisabledPerms: true,

        // Assignment: groups
        assignment: {
            prefix:          'group',
            apiUrl:          '/panel/client/api/groups/active/',
            responseKey:     'groups',
            payloadKey:      'assigned_groups',
            preselectedKey:  'assigned_group_ids',
            placeholder:     'Select groups...',
            pluralLabel:     'groups',
        },

        // Permissions (smaller set)
        permissionFields: [
            'perm-idcard-pending-list', 'perm-idcard-verified-list', 'perm-idcard-pool-list',
            'perm-idcard-approved-list', 'perm-idcard-download-list',
            'perm-idcard-add', 'perm-idcard-edit', 'perm-idcard-delete', 'perm-idcard-info',
            'perm-idcard-approve', 'perm-idcard-verify',
            'perm-idcard-created-at', 'perm-idcard-updated-at',
            'perm-mobile-app'
        ],
        defaultOnPerms: [],

        // API endpoints (RESTful)
        api: {
            fetchUrl:          function (id) { return '/panel/client/api/staff/' + id + '/'; },
            fetchResponseKey:  'data',
            errorKey:          'error',
            createUrl:         '/panel/client/api/staff/',
            createMethod:      'post',
            updateEndpoint:    function (id) { return { url: '/panel/client/api/staff/' + id + '/', method: 'put' }; },
            deleteEndpoint:    function (id) { return { url: '/panel/client/api/staff/' + id + '/', method: 'delete' }; },
            toggleUrl:         function (id) { return '/panel/client/api/staff/' + id + '/toggle-status/'; },
        },

        onDrawerReset: function () {
            resetClassSection();
            initClassSection([], []);
        },
        onPopulateForm: function (data) {
            initClassSection(data.allowed_classes, data.allowed_sections);
        },
        onBeforeSubmit: function (formData) {
            formData.allowed_classes = Array.from(selectedClasses);
            formData.allowed_sections = Array.from(selectedSections);
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

        // Form success -> always full reload
        onFormSuccess: function () {
            setTimeout(function () { location.reload(); }, 500);
        },
    });

    // Init class/section on page load for "add" drawer
    fetchClassSectionOptions();

    // Expose manager for temp password modal access
    window._staffPageMgr = mgr;
});
