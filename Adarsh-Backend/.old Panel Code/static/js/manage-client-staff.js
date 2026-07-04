// Manage Assistent Page  config wrapper for manage-staff-common.js
// Uses client API endpoints and Group Assignment instead of Client Assignment.

document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    // NOTE: removed temporary fetch interceptor; root cause fixed in core bundle.

    function panelBasePath() {
        return window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';
    }

    function isClientPortalPath() {
        var path = String(window.location.pathname || '');
        return path.indexOf('/client/') === 0 && path.indexOf('/panel/') !== 0;
    }

    function isPanelClientPath() {
        var path = String(window.location.pathname || '');
        return path.indexOf('/panel/client/') === 0;
    }

    function apiBasePath() {
        var base = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL.trim())
            ? window.API_BASE_URL.trim()
            : panelBasePath();
        if (base.length > 1 && base.charAt(base.length - 1) === '/') {
            base = base.slice(0, -1);
        }
        return base;
    }

    function apiPath(path) {
        var normalized = String(path || '');
        if (!normalized.startsWith('/')) normalized = '/' + normalized;
        return apiBasePath() + normalized;
    }

    // ==================== CLASS/SECTION MULTI-SELECT ====================
    var allClasses = [];
    var allSections = [];
    var allBranches = [];
    var classSectionMap = {};
    var classCountMap = {};
    var sectionCountMap = {};
    var classSectionCountMap = {};
    var fieldCapabilities = {
        hasClass: false,
        hasSection: false,
        hasBranch: false,
    };
    var allClients = [];
    var selectedClientId = null;
    var activeAssignmentClientId = null;
    var selectedClasses = new Set();
    var selectedSections = new Set();
    var selectedBranches = new Set();
    var csOptionsCache = {};
    var assignmentIdSource = 'auto';
    var USE_CHIP_SCOPED_FILTERS = false;

    var _esc = window.escapeHtml || function (s) {
        return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    };

    function formatDateTimeDisplay(dateInput) {
        var d = dateInput ? new Date(dateInput) : new Date();
        if (isNaN(d.getTime())) d = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    async function fetchAssignableClients() {
        if (allClients.length) return;

        // If we're on the client portal, avoid calling the admin-only
        // `/panel/api/client-staff/clients/` endpoint which returns 403.
        if (isClientPortalPath() || isPanelClientPath()) {
            allClients = [];
            return;
        }

        try {
            var url = apiPath('/api/client-staff/clients/');
            console.debug('[staff] fetchAssignableClients ->', url);
            var data = await ApiClient.get(url);
            console.debug('[staff] fetchAssignableClients response ->', data && typeof data === 'object' ? data.success : data);
            if (data && data.success) {
                allClients = Array.isArray(data.clients) ? data.clients : [];
            }
        } catch (_) {}
    }

    function updateClientSelectionText() {
        var textEl = document.getElementById('client-multiselect-text');
        if (!textEl) return;

        if (!selectedClientId) {
            textEl.textContent = 'Select client...';
            textEl.classList.remove('has-selection');
            return;
        }

        var selected = allClients.find(function (item) {
            return String(item && item.id) === String(selectedClientId);
        });
        textEl.textContent = selected ? selected.name : 'Selected client';
        textEl.classList.add('has-selection');
    }

    function closeClientDropdown() {
        var dropdown = document.getElementById('client-multiselect-dropdown');
        var toggle = document.getElementById('client-multiselect-toggle');
        if (!dropdown || !toggle) return;
        dropdown.style.display = 'none';
        toggle.classList.remove('open');
    }

    function renderClientDropdown(filterText) {
        var listEl = document.getElementById('client-multiselect-list');
        var emptyEl = document.getElementById('client-multiselect-empty');
        if (!listEl) return;

        var term = String(filterText || '').toLowerCase().trim();
        var filtered = allClients.filter(function (item) {
            var name = String(item && item.name ? item.name : '').toLowerCase();
            return !term || name.indexOf(term) !== -1;
        });

        filtered.sort(function (a, b) {
            var aSelected = String(a && a.id) === String(selectedClientId) ? 0 : 1;
            var bSelected = String(b && b.id) === String(selectedClientId) ? 0 : 1;
            if (aSelected !== bSelected) return aSelected - bSelected;
            return String(a && a.name ? a.name : '').localeCompare(String(b && b.name ? b.name : ''));
        });

        listEl.innerHTML = '';
        if (!filtered.length) {
            if (emptyEl) emptyEl.style.display = '';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        filtered.forEach(function (item) {
            var row = document.createElement('div');
            row.className = 'client-multiselect-item' + (String(item.id) === String(selectedClientId) ? ' selected' : '');
            row.innerHTML = '<input type="radio" name="client-selection" ' + (String(item.id) === String(selectedClientId) ? 'checked' : '') + '><span class="client-name">' + _esc(item.name) + '</span>';
            row.addEventListener('click', function (e) {
                e.stopPropagation();
                setSelectedClientId(item.id);
                closeClientDropdown();
            });
            listEl.appendChild(row);
        });
    }

    function openClientDropdown() {
        var dropdown = document.getElementById('client-multiselect-dropdown');
        var toggle = document.getElementById('client-multiselect-toggle');
        var searchInput = document.getElementById('client-search-input');
        if (!dropdown || !toggle) return;
        dropdown.style.display = '';
        toggle.classList.add('open');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
        renderClientDropdown('');
    }

    function setSelectedClientId(clientId) {
        selectedClientId = clientId ? parseInt(clientId, 10) : null;
        if (!Number.isFinite(selectedClientId)) selectedClientId = null;
        setActiveAssignmentClientId(selectedClientId);
        updateClientSelectionText();
        renderClientDropdown(document.getElementById('client-search-input') ? document.getElementById('client-search-input').value : '');
        // Clear any previously selected groups when changing client so
        // class/section filters don't show for the previously-selected group.
        if (window._staffDrawerApi && typeof window._staffDrawerApi.refreshAssignmentItems === 'function') {
            window._staffDrawerApi.refreshAssignmentItems([]);
        }
    }

    function resetClientSelection() {
        selectedClientId = null;
        setActiveAssignmentClientId(null);
        updateClientSelectionText();
        closeClientDropdown();
    }

    function setActiveAssignmentClientId(clientId) {
        var nextId = clientId ? parseInt(clientId, 10) : null;
        if (!Number.isFinite(nextId) || nextId <= 0) nextId = null;
        if (activeAssignmentClientId === nextId) return;

        activeAssignmentClientId = nextId;
        csOptionsCache = {};
        _assignmentGroupsLoaded = false;
        assignmentGroupsById = {};
        assignmentGroupMetaById = {};
    }

    function getActiveAssignmentClientId() {
        if (Number.isFinite(activeAssignmentClientId) && activeAssignmentClientId > 0) return activeAssignmentClientId;
        if (Number.isFinite(selectedClientId) && selectedClientId > 0) return selectedClientId;
        // Try to auto-detect client id from common panel contexts
        try {
            if (typeof window.CLIENT_ID !== 'undefined' && Number.isFinite(Number(window.CLIENT_ID))) {
                return Number(window.CLIENT_ID);
            }
            if (typeof window.PANEL_CLIENT_ID !== 'undefined' && Number.isFinite(Number(window.PANEL_CLIENT_ID))) {
                return Number(window.PANEL_CLIENT_ID);
            }
            var el = document.querySelector('[data-client-id]');
            if (el) {
                var val = parseInt(el.getAttribute('data-client-id'), 10);
                if (Number.isFinite(val) && val > 0) return val;
            }
        } catch (e) { /* ignore dom parse errors */ }
        return null;
    }

    var clientToggle = document.getElementById('client-multiselect-toggle');
    var clientSearchInput = document.getElementById('client-search-input');
    if (clientToggle) {
        clientToggle.addEventListener('click', function (e) {
            e.stopPropagation();
            var dropdown = document.getElementById('client-multiselect-dropdown');
            if (dropdown && dropdown.style.display !== 'none') closeClientDropdown();
            else openClientDropdown();
        });
    }
    if (clientSearchInput) {
        clientSearchInput.addEventListener('input', function () {
            renderClientDropdown(clientSearchInput.value);
        });
        clientSearchInput.addEventListener('click', function (e) { e.stopPropagation(); });
    }
    document.addEventListener('click', function (e) {
        var container = document.getElementById('client-multiselect');
        var dropdown = document.getElementById('client-multiselect-dropdown');
        if (dropdown && dropdown.style.display !== 'none' && container && !container.contains(e.target)) {
            closeClientDropdown();
        }
    });

    async function initClientAssignment(clientId) {
        var section = document.getElementById('client-assignment-section');
        if (section) section.style.display = '';
        if (allClients.length === 0) {
            await fetchAssignableClients();
        }
        setSelectedClientId(clientId);
    }

    function _normalizeStringListForTable(values) {
        if (!Array.isArray(values)) return [];
        var seen = new Set();
        var out = [];
        values.forEach(function (v) {
            var text = String(v == null ? '' : v).trim();
            if (!text) return;
            var key = text.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            out.push(text);
        });
        return out;
    }

    function buildAssignmentCellHtml(detail) {
        var classes = _normalizeStringListForTable(detail && detail.allowed_classes);
        var sections = _normalizeStringListForTable(detail && detail.allowed_sections);
        var maxVisible = 3;
        var chips = [];

        if (classes.length && sections.length) {
            for (var ci = 0; ci < classes.length; ci += 1) {
                for (var si = 0; si < sections.length; si += 1) {
                    chips.push(
                        '<span class="staff-assignment-chip" style="display:inline-flex;align-items:center;justify-content:center;min-width:56px;font-size:var(--ui-font-size-2xs,10px);font-weight:700;color:#1e3a8a;background:var(--color-indigo-50);border:1px solid var(--color-indigo-200);border-radius:6px;padding:2px 8px;">' +
                        _esc(classes[ci]) + ' "' + _esc(sections[si]) + '"</span>'
                    );
                    if (chips.length >= maxVisible) break;
                }
                if (chips.length >= maxVisible) break;
            }

            var totalPairs = classes.length * sections.length;
            if (totalPairs > maxVisible) {
                chips.push(
                    '<button type="button" class="staff-assignment-view-more" data-staff-id="' + _esc(String(detail && detail.id || '')) + '" style="display:inline-flex;align-items:center;justify-content:center;min-width:72px;font-size:var(--ui-font-size-2xs,10px);font-weight:700;color:#1e3a8a;background:var(--color-white);border:1px dashed var(--color-blue-300);border-radius:6px;padding:2px 8px;cursor:pointer;">View More</button>'
                );
            }
        } else if (classes.length) {
            classes.slice(0, maxVisible).forEach(function (cls) {
                chips.push(
                    '<span class="staff-assignment-chip" style="display:inline-flex;align-items:center;justify-content:center;min-width:56px;font-size:var(--ui-font-size-2xs,10px);font-weight:700;color:#1e3a8a;background:var(--color-indigo-50);border:1px solid var(--color-indigo-200);border-radius:6px;padding:2px 8px;">' + _esc(cls) + '</span>'
                );
            });
            if (classes.length > maxVisible) {
                chips.push(
                    '<button type="button" class="staff-assignment-view-more" data-staff-id="' + _esc(String(detail && detail.id || '')) + '" style="display:inline-flex;align-items:center;justify-content:center;min-width:72px;font-size:var(--ui-font-size-2xs,10px);font-weight:700;color:#1e3a8a;background:var(--color-white);border:1px dashed var(--color-blue-300);border-radius:6px;padding:2px 8px;cursor:pointer;">View More</button>'
                );
            }
        } else if (sections.length) {
            sections.slice(0, maxVisible).forEach(function (sec) {
                chips.push(
                    '<span class="staff-assignment-chip" style="display:inline-flex;align-items:center;justify-content:center;min-width:56px;font-size:var(--ui-font-size-2xs,10px);font-weight:700;color:#1e3a8a;background:var(--color-indigo-50);border:1px solid var(--color-indigo-200);border-radius:6px;padding:2px 8px;">"' + _esc(sec) + '"</span>'
                );
            });
            if (sections.length > maxVisible) {
                chips.push(
                    '<button type="button" class="staff-assignment-view-more" data-staff-id="' + _esc(String(detail && detail.id || '')) + '" style="display:inline-flex;align-items:center;justify-content:center;min-width:72px;font-size:var(--ui-font-size-2xs,10px);font-weight:700;color:#1e3a8a;background:var(--color-white);border:1px dashed var(--color-blue-300);border-radius:6px;padding:2px 8px;cursor:pointer;">View More</button>'
                );
            }
        } else {
            chips.push(
                '<span class="staff-assignment-chip" style="display:inline-flex;align-items:center;justify-content:center;min-width:56px;font-size:var(--ui-font-size-2xs,10px);font-weight:700;color:#991b1b;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:2px 8px;">No Classes Assigned</span>'
            );
            chips.push(
                '<span class="staff-assignment-chip" style="display:inline-flex;align-items:center;justify-content:center;min-width:56px;font-size:var(--ui-font-size-2xs,10px);font-weight:700;color:#991b1b;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:2px 8px;">No Sections Assigned</span>'
            );
        }

        return '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;">' + chips.join('') + '</div>';
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
                '<td class="text-gray-500"></td>',
                '<td class="text-left" style="min-width: 250px;"></td>'
            ].join('');
            tbody.insertBefore(row, tbody.firstChild);
        }

        var isActive = (detail.status === 'active') || detail.is_active === true;
        row.setAttribute('data-staff-status', isActive ? 'active' : 'inactive');
        row.setAttribute('data-staff-name', String(detail.name || '').trim());

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
        if (cells[6]) {
            cells[6].innerHTML = buildAssignmentCellHtml(detail);
        }
    }

    async function fetchStaffDetailById(staffId) {
        if (!staffId) return null;
        try {
            var json = await ApiClient.get('/client/api/staff/' + staffId + '/');
            if (!json.success) return null;
            return json.staff || json.data || null;
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

    function _getAssignedSelectionIds(data) {
        if (!data || typeof data !== 'object') return [];
        var tableIds = _normalizeGroupIds(data.assigned_table_ids || []);
        var groupIds = _normalizeGroupIds(data.assigned_group_ids || []);

        if (assignmentIdSource === 'table') {
            return tableIds.length ? tableIds : groupIds;
        }
        if (assignmentIdSource === 'group') {
            return groupIds.length ? groupIds : tableIds;
        }

        // Auto mode fallback for transitional/stale data:
        // prefer the richer set and bias toward group IDs on ties.
        if (groupIds.length >= tableIds.length && groupIds.length) {
            return groupIds;
        }
        return tableIds;
    }

    function _buildGroupScopedOptionsUrl(groupIds) {
        var normalized = _normalizeGroupIds(groupIds);
        var baseUrl = null;
        if (isClientPortalPath() || isPanelClientPath()) {
            baseUrl = apiPath('/client/api/class-section-options/');
        } else {
            var clientId = getActiveAssignmentClientId();
            if (!clientId) return null;
            baseUrl = apiPath('/api/client/' + clientId + '/class-section-options/');
        }

        if (!normalized.length) return baseUrl;
        var url = baseUrl + '?group_ids=' + encodeURIComponent(normalized.join(','));
        if (assignmentIdSource === 'group' || assignmentIdSource === 'table') {
            url += '&id_source=' + encodeURIComponent(assignmentIdSource);
        }
        return url;
    }

    function _normalizeCountMap(raw) {
        var out = {};
        Object.keys(raw || {}).forEach(function (k) {
            var key = String(k);
            var val = parseInt(raw[k], 10);
            out[key] = Number.isFinite(val) && val >= 0 ? val : 0;
        });
        return out;
    }

    function _normalizeNestedCountMap(raw) {
        var out = {};
        Object.keys(raw || {}).forEach(function (k) {
            out[String(k)] = _normalizeCountMap(raw[k] || {});
        });
        return out;
    }

    function _applyClassSectionOptions(data) {
        allClasses = data.classes || [];
        allSections = data.sections || [];
        allBranches = data.branches || [];
        classSectionMap = data.class_sections || {};
        classCountMap = _normalizeCountMap(data.class_counts || {});
        sectionCountMap = _normalizeCountMap(data.section_counts || {});
        classSectionCountMap = _normalizeNestedCountMap(data.class_section_counts || {});
        fieldCapabilities.hasClass = data.has_class_field === true || allClasses.length > 0;
        fieldCapabilities.hasSection = data.has_section_field === true || allSections.length > 0;
        fieldCapabilities.hasBranch = data.has_branch_field === true || allBranches.length > 0;
    }

    async function fetchClassSectionOptions(groupIds) {
        if (typeof loadAssignGroups === 'function') {
            await loadAssignGroups();
        }

        var optionsUrl = _buildGroupScopedOptionsUrl(groupIds);
        if (!optionsUrl) {
            _applyClassSectionOptions({
                classes: [],
                sections: [],
                branches: [],
                class_sections: {},
                class_counts: {},
                section_counts: {},
                class_section_counts: {}
            });
            return;
        }

        var normalized = _normalizeGroupIds(groupIds);
        var cacheKey = (assignmentIdSource || 'auto') + ':' + (normalized.length ? normalized.join(',') : 'all');

        if (csOptionsCache[cacheKey]) {
            _applyClassSectionOptions(csOptionsCache[cacheKey]);
            return;
        }

        try {
            var data = await ApiClient.get(optionsUrl);
            if (data.success) {
                csOptionsCache[cacheKey] = {
                    classes: data.classes || [],
                    sections: data.sections || [],
                    branches: data.branches || [],
                    class_sections: data.class_sections || {},
                    class_counts: data.class_counts || {},
                    section_counts: data.section_counts || {},
                    class_section_counts: data.class_section_counts || {}
                };
                _applyClassSectionOptions(csOptionsCache[cacheKey]);
            }
        } catch (_) { /* silently fail */ }
    }

    function showClientAssignmentSection() {
        var section = document.getElementById('client-assignment-section');
        if (section) section.style.display = '';
    }

    function _pruneSelectedValues(selectedSet, allowedValues) {
        if (!selectedSet) return;
        var allowed = new Set((allowedValues || []).map(function (v) { return String(v); }));
        Array.from(selectedSet).forEach(function (v) {
            if (!allowed.has(String(v))) selectedSet.delete(v);
        });
    }

    function _pruneScopedSelections(classSet, sectionSet, branchSet) {
        _pruneSelectedValues(classSet, allClasses);
        _pruneSectionsBySelectedClasses(sectionSet, classSet);
        if (!fieldCapabilities.hasClass) {
            _pruneSelectedValues(sectionSet, allSections);
        }
        _pruneSelectedValues(branchSet, allBranches);
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
        if (!fieldCapabilities.hasClass) return;
        if (!sectionSet || !classSet || classSet.size === 0) return;
        var allowed = new Set(_getSectionsForSelectedClasses(classSet));
        Array.from(sectionSet).forEach(function (sec) {
            if (!allowed.has(sec)) sectionSet.delete(sec);
        });
    }

    function _replaceSetValues(targetSet, values) {
        if (!targetSet) return;
        targetSet.clear();
        (values || []).forEach(function (v) {
            targetSet.add(v);
        });
    }

    function updateDrawerFilterVisibility(hasGroupSelection) {
        var filterSection = document.getElementById('class-section-filter-section');
        var classGroup = document.getElementById('class-filter-group');
        var sectionGroup = document.getElementById('section-filter-group');
        var branchRow = document.getElementById('branch-filter-row');

        if (USE_CHIP_SCOPED_FILTERS) {
            if (filterSection) filterSection.style.display = 'none';
            if (classGroup) classGroup.style.display = 'none';
            if (sectionGroup) sectionGroup.style.display = 'none';
            if (branchRow) branchRow.style.display = 'none';
            return;
        }

        var showClass = fieldCapabilities.hasClass;
        var showSection = fieldCapabilities.hasSection;
        var showBranch = fieldCapabilities.hasBranch;
        var showAny = hasGroupSelection && (showClass || showSection || showBranch);

        if (!showClass) selectedClasses.clear();
        if (!showSection) selectedSections.clear();
        if (!showBranch) selectedBranches.clear();

        if (filterSection) filterSection.style.display = showAny ? '' : 'none';
        if (classGroup) classGroup.style.display = showClass ? '' : 'none';
        if (sectionGroup) sectionGroup.style.display = showSection ? '' : 'none';
        if (branchRow) branchRow.style.display = showBranch ? '' : 'none';
    }

    var currentAssignedGroupIds = [];
    var currentDraftGroupId = null;
    var assignmentGroupsById = {};
    var assignmentGroupMetaById = {};
    var assignmentScopeChips = {};

    function renderCheckboxOptions(containerId, options, selectedSet, onToggle) {
        var container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';
        var normalized = (options || []).map(function (v) { return String(v); });
        if (!normalized.length) {
            container.innerHTML = '<div class="assignment-options-empty">No options available.</div>';
            return;
        }

        normalized.forEach(function (value) {
            var safeId = containerId + '-' + value.replace(/[^a-zA-Z0-9_-]/g, '_');
            var label = document.createElement('label');
            label.className = 'assignment-checkbox-item';
            label.setAttribute('for', safeId);

            var input = document.createElement('input');
            input.type = 'checkbox';
            input.id = safeId;
            input.checked = selectedSet.has(value);
            input.addEventListener('change', function () {
                if (input.checked) selectedSet.add(value);
                else selectedSet.delete(value);
                if (typeof onToggle === 'function') onToggle(value, input.checked);
            });

            var text = document.createElement('span');
            text.textContent = value;

            label.appendChild(input);
            label.appendChild(text);
            container.appendChild(label);
        });
    }

    function _normalizeStringList(values) {
        return Array.from(new Set((values || []).map(function (v) {
            return String(v || '').trim();
        }).filter(function (v) {
            return !!v;
        })));
    }

    function _cloneClassSectionMap(mapObj) {
        var out = {};
        Object.keys(mapObj || {}).forEach(function (k) {
            out[String(k)] = (mapObj[k] || []).map(function (v) { return String(v); });
        });
        return out;
    }

    function _cloneClassSectionSelections(mapObj) {
        var out = {};
        Object.keys(mapObj || {}).forEach(function (k) {
            out[String(k)] = _normalizeStringList(mapObj[k] || []);
        });
        return out;
    }

    function _syncChipSelections(chip) {
        if (!chip) return;

        var classNames = [];
        var sectionNames = [];
        var seenClasses = new Set();
        var seenSections = new Set();

        Object.keys(chip.classSectionSelections || {}).forEach(function (cls) {
            var selectedSections = _normalizeStringList(chip.classSectionSelections[cls] || []);
            if (!selectedSections.length) return;

            var classKey = String(cls).trim().toLowerCase();
            if (classKey && !seenClasses.has(classKey)) {
                seenClasses.add(classKey);
                classNames.push(String(cls).trim());
            }

            selectedSections.forEach(function (sec) {
                var secKey = String(sec).trim().toLowerCase();
                if (secKey && !seenSections.has(secKey)) {
                    seenSections.add(secKey);
                    sectionNames.push(String(sec).trim());
                }
            });
        });

        chip.classes = _normalizeStringList(classNames);
        chip.sections = _normalizeStringList(sectionNames);
    }

    function _setChipClassSections(chip, cls, sections) {
        if (!chip) return;
        if (!chip.classSectionSelections) chip.classSectionSelections = {};
        chip.classSectionSelections[String(cls)] = _normalizeStringList(sections || []);
        _syncChipSelections(chip);
    }

    function _chipKey(groupId) {
        return String(parseInt(groupId, 10));
    }

    function _getGroupName(groupId) {
        var key = _chipKey(groupId);
        return assignmentGroupsById[key] || ('Group #' + key);
    }

    function _pruneChipSelection(chip) {
        if (!chip) return;

        chip.classes = _normalizeStringList(chip.classes).filter(function (v) {
            return !chip.classOptions.length || chip.classOptions.indexOf(v) !== -1;
        });

        var allowedSections = chip.sectionOptions.slice();
        if (chip.hasClass && chip.classes.length) {
            var allowedFromClass = new Set();
            chip.classes.forEach(function (cls) {
                (chip.classSectionMap[cls] || []).forEach(function (sec) {
                    allowedFromClass.add(String(sec));
                });
            });
            allowedSections = allowedSections.filter(function (sec) {
                return allowedFromClass.has(String(sec));
            });
        }

        chip.sections = _normalizeStringList(chip.sections).filter(function (v) {
            return allowedSections.indexOf(v) !== -1;
        });

        chip.branches = _normalizeStringList(chip.branches).filter(function (v) {
            return !chip.branchOptions.length || chip.branchOptions.indexOf(v) !== -1;
        });
    }

    function _getChipAvailableSections(chip) {
        if (!chip) return [];
        if (!chip.hasClass || !chip.classes.length) return chip.sectionOptions.slice();

        var out = new Set();
        chip.classes.forEach(function (cls) {
            (chip.classSectionMap[cls] || []).forEach(function (sec) {
                out.add(String(sec));
            });
        });

        var allSectionsForGroup = chip.sectionOptions.slice();
        if (!allSectionsForGroup.length) {
            return Array.from(out).sort(function (a, b) { return a.localeCompare(b); });
        }
        return allSectionsForGroup.filter(function (sec) {
            return out.has(String(sec));
        });
    }

    function _getChipClassCount(chip, cls) {
        if (!chip || !chip.classCounts) return 0;
        var raw = chip.classCounts[String(cls)];
        var num = parseInt(raw, 10);
        return Number.isFinite(num) && num > 0 ? num : 0;
    }

    function _getChipSectionCount(chip, sec) {
        if (!chip) return 0;
        var section = String(sec);

        if (chip.classes && chip.classes.length && chip.classSectionCounts) {
            var total = 0;
            chip.classes.forEach(function (cls) {
                var bucket = chip.classSectionCounts[String(cls)] || {};
                var raw = bucket[section];
                var num = parseInt(raw, 10);
                if (Number.isFinite(num) && num > 0) total += num;
            });
            if (total > 0) return total;
        }

        var fallback = chip.sectionCounts ? chip.sectionCounts[section] : 0;
        var fallbackNum = parseInt(fallback, 10);
        return Number.isFinite(fallbackNum) && fallbackNum > 0 ? fallbackNum : 0;
    }

    function _ensureChip(groupId) {
        var key = _chipKey(groupId);
        if (assignmentScopeChips[key]) return assignmentScopeChips[key];

        assignmentScopeChips[key] = {
            groupId: parseInt(groupId, 10),
            groupName: _getGroupName(groupId),
            scopeType: (assignmentIdSource === 'group' || assignmentIdSource === 'table') ? assignmentIdSource : 'group',
            classes: [],
            sections: [],
            branches: [],
            classOptions: [],
            sectionOptions: [],
            branchOptions: [],
            classSectionMap: {},
            classSectionSelections: {},
            classCounts: {},
            sectionCounts: {},
            classSectionCounts: {},
            hasClass: true,
            hasSection: true,
            hasBranch: true,
            optionsLoaded: false,
            isEditing: false,
            pendingGlobalClasses: null,
            pendingGlobalSections: null,
            pendingGlobalBranches: null,
            initializedFromGlobal: true,
        };
        return assignmentScopeChips[key];
    }

    async function ensureChipOptionsLoaded(chip) {
        if (!chip || chip.optionsLoaded) return;
        try {
            await loadAssignGroups();
            var scopedUrl = _buildGroupScopedOptionsUrl([chip.groupId]);
            if (!scopedUrl) return;
            var data = await ApiClient.get(scopedUrl);
            if (!data.success) return;

            chip.classOptions = _normalizeStringList(data.classes || []);
            chip.sectionOptions = _normalizeStringList(data.sections || []);
            chip.branchOptions = _normalizeStringList(data.branches || []);
            chip.classSectionMap = _cloneClassSectionMap(data.class_sections || {});
            chip.classCounts = _normalizeCountMap(data.class_counts || {});
            chip.sectionCounts = _normalizeCountMap(data.section_counts || {});
            chip.classSectionCounts = _normalizeNestedCountMap(data.class_section_counts || {});
            chip.hasClass = data.has_class_field === true || chip.classOptions.length > 0;
            chip.hasSection = data.has_section_field === true || chip.sectionOptions.length > 0;
            chip.hasBranch = data.has_branch_field === true || chip.branchOptions.length > 0;

            if (chip.initializedFromGlobal === false) {
                var pendingClasses = _normalizeStringList(chip.pendingGlobalClasses || []);
                var pendingSections = _normalizeStringList(chip.pendingGlobalSections || []);
                var pendingBranches = _normalizeStringList(chip.pendingGlobalBranches || []);

                chip.classes = pendingClasses.filter(function (v) {
                    return chip.classOptions.indexOf(v) !== -1;
                });
                chip.sections = pendingSections.filter(function (v) {
                    return chip.sectionOptions.indexOf(v) !== -1;
                });
                chip.branches = pendingBranches.filter(function (v) {
                    return chip.branchOptions.indexOf(v) !== -1;
                });

                if (!Object.keys(chip.classSectionSelections || {}).length) {
                    chip.classSectionSelections = {};
                    var selectedClasses = chip.classes.length ? chip.classes.slice() : pendingClasses.slice();
                    var selectedSections = chip.sections.length ? chip.sections.slice() : pendingSections.slice();

                    selectedClasses.forEach(function (cls) {
                        chip.classSectionSelections[cls] = [];
                    });

                    selectedSections.forEach(function (sec) {
                        var targetClass = null;
                        selectedClasses.forEach(function (cls) {
                            if (targetClass) return;
                            var available = _normalizeStringList(chip.classSectionMap[cls] || []);
                            if (available.indexOf(sec) !== -1) targetClass = cls;
                        });
                        if (!targetClass && selectedClasses.length) {
                            targetClass = selectedClasses[0];
                        }
                        if (targetClass) {
                            chip.classSectionSelections[targetClass] = chip.classSectionSelections[targetClass] || [];
                            if (chip.classSectionSelections[targetClass].indexOf(sec) === -1) {
                                chip.classSectionSelections[targetClass].push(sec);
                            }
                        }
                    });
                }

                chip.pendingGlobalClasses = null;
                chip.pendingGlobalSections = null;
                chip.pendingGlobalBranches = null;
                chip.initializedFromGlobal = true;
            }

            chip.optionsLoaded = true;
            _pruneChipSelection(chip);
        } catch (_) {}
    }

    function hydrateChipOptionsInBackground() {
        var keys = Object.keys(assignmentScopeChips);
        if (!keys.length) return;

        (async function () {
            var changed = false;
            for (var i = 0; i < keys.length; i += 1) {
                var chip = assignmentScopeChips[keys[i]];
                if (!chip) continue;
                var beforeLoaded = chip.optionsLoaded;
                await ensureChipOptionsLoaded(chip);
                if (!beforeLoaded && chip.optionsLoaded) changed = true;
            }
            if (changed) renderAssignmentScopeChips();
        })();
    }

    function updateCurrentChipActionLabel() {
        var btn = document.getElementById('save-current-assignment-chip-btn');
        if (!btn) return;
        if (!currentDraftGroupId) {
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Group Assignment';
            return;
        }

        var key = _chipKey(currentDraftGroupId);
        if (assignmentScopeChips[key]) {
            btn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Update Group Assignment';
        } else {
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Group Assignment';
        }
    }

    function renderAssignmentScopeChips() {
        var chipList = document.getElementById('group-assignment-chip-list');
        if (!chipList) return;

        var keys = Object.keys(assignmentScopeChips).sort(function (a, b) {
            var aName = (assignmentScopeChips[a].groupName || '').toLowerCase();
            var bName = (assignmentScopeChips[b].groupName || '').toLowerCase();
            return aName.localeCompare(bName);
        });

        chipList.innerHTML = '';
        if (!keys.length) {
            chipList.innerHTML = '<div class="assignment-options-empty" id="group-assignment-chip-empty">No group assignments added yet.</div>';
            updateCurrentChipActionLabel();
            return;
        }

        function addClassSectionGroup(container, chip) {
            var classValues;
            if (chip.isEditing) {
                classValues = _normalizeStringList(
                    chip.classOptions.length ? chip.classOptions : (chip.classes.length ? chip.classes : Object.keys(chip.classSectionSelections || {}))
                );
            } else {
                classValues = _normalizeStringList(chip.classes.length ? chip.classes : Object.keys(chip.classSectionSelections || {}));
            }
            var hasClassRows = classValues.length || (chip.classSectionSelections && Object.keys(chip.classSectionSelections).length);
            if (!hasClassRows && !chip.hasSection && !(chip.sections && chip.sections.length)) return;

            var wrap = document.createElement('div');
            wrap.className = 'assignment-scope-chip-group assignment-scope-chip-group--matrix';

            var label = document.createElement('div');
            label.className = 'assignment-scope-chip-group-label';
            label.textContent = 'Classes & Sections';
            wrap.appendChild(label);

            var table = document.createElement('div');
            table.className = 'assignment-class-section-table';

            if (!classValues.length) {
                var empty = document.createElement('div');
                empty.className = 'assignment-options-empty';
                empty.textContent = chip.isEditing ? 'No classes available.' : 'No classes selected.';
                table.appendChild(empty);
            }

            classValues.forEach(function (cls) {
                var availableSections = _normalizeStringList(chip.classSectionMap[cls] || []);
                if (!availableSections.length && chip.sectionOptions.length) {
                    availableSections = chip.sectionOptions.slice();
                }
                var selectedSections = _normalizeStringList((chip.classSectionSelections && chip.classSectionSelections[cls]) || []);
                var isAssignedClass = selectedSections.length > 0;
                var isClassFullySelected = availableSections.length > 0 && availableSections.every(function (s) {
                    return selectedSections.indexOf(s) !== -1;
                });

                var row = document.createElement('div');
                row.className = 'assignment-class-section-row' + (isAssignedClass ? ' is-assigned' : ' is-unassigned');

                var classCell = document.createElement('div');
                classCell.className = 'assignment-class-section-row-class';

                    if (chip.isEditing) {
                        var classInput = document.createElement('input');
                    classInput.type = 'checkbox';
                    classInput.checked = isAssignedClass;
                    classInput.indeterminate = false;
                    classInput.id = String(chip.groupId) + '-class-' + cls.replace(/[^a-zA-Z0-9_-]/g, '_');
                    classInput.addEventListener('change', function () {
                        if (classInput.checked) {
                            _setChipClassSections(chip, cls, availableSections);
                        } else {
                            _setChipClassSections(chip, cls, []);
                        }
                        _pruneChipSelection(chip);
                        renderAssignmentScopeChips();
                    });
                    classCell.appendChild(classInput);
                } else {
                    var classIcon = document.createElement('i');
                    classIcon.className = isAssignedClass
                        ? 'fa-solid fa-circle-check assignment-status-icon assignment-status-icon--assigned'
                        : 'fa-solid fa-ban assignment-status-icon assignment-status-icon--unassigned';
                    classCell.appendChild(classIcon);
                }

                var className = document.createElement('span');
                className.className = 'assignment-class-section-row-name';
                className.textContent = cls;
                classCell.appendChild(className);

                row.appendChild(classCell);

                var sectionCell = document.createElement('div');
                sectionCell.className = 'assignment-class-section-row-sections';

                if (!availableSections.length) {
                    var sectionEmpty = document.createElement('span');
                    sectionEmpty.className = 'assignment-class-section-empty';
                    sectionEmpty.textContent = 'No sections';
                    sectionCell.appendChild(sectionEmpty);
                } else {
                    availableSections.forEach(function (sec) {
                        var isAssignedSection = selectedSections.indexOf(sec) !== -1;
                        var sectionItem = document.createElement('div');
                        sectionItem.className = 'assignment-chip-checkbox-item assignment-chip-checkbox-item--section ' + (isAssignedSection ? 'is-assigned' : 'is-unassigned');

                            if (chip.isEditing) {
                            var sectionInput = document.createElement('input');
                            sectionInput.type = 'checkbox';
                            sectionInput.checked = isAssignedSection;
                            sectionInput.id = String(chip.groupId) + '-section-' + cls.replace(/[^a-zA-Z0-9_-]/g, '_') + '-' + sec.replace(/[^a-zA-Z0-9_-]/g, '_');
                            sectionInput.addEventListener('change', function () {
                                var currentSections = _normalizeStringList((chip.classSectionSelections && chip.classSectionSelections[cls]) || []);
                                var nextSections = currentSections.slice();
                                if (sectionInput.checked) {
                                    if (nextSections.indexOf(sec) === -1) nextSections.push(sec);
                                } else {
                                    nextSections = nextSections.filter(function (val) { return val !== sec; });
                                }
                                _setChipClassSections(chip, cls, nextSections);
                                var currentSelected = _normalizeStringList((chip.classSectionSelections && chip.classSectionSelections[cls]) || []);
                                classInput.checked = currentSelected.length > 0;
                                classInput.indeterminate = false;
                                renderAssignmentScopeChips();
                            });
                            sectionItem.appendChild(sectionInput);
                        } else {
                            var sectionIcon = document.createElement('i');
                            sectionIcon.className = isAssignedSection
                                ? 'fa-solid fa-circle-check assignment-status-icon assignment-status-icon--assigned'
                                : 'fa-solid fa-ban assignment-status-icon assignment-status-icon--unassigned';
                            sectionItem.appendChild(sectionIcon);
                        }

                        var sectionText = document.createElement('span');
                        sectionText.className = 'assignment-chip-option-text';
                        // Show only the section name on the right side (class shown on left)
                        sectionText.textContent = sec;
                        sectionItem.appendChild(sectionText);

                        sectionCell.appendChild(sectionItem);
                    });
                }

                row.appendChild(sectionCell);
                table.appendChild(row);
            });

            wrap.appendChild(table);
            container.appendChild(wrap);
        }

        function addChipGroup(container, chip, labelText, values, selectedValues, valueKey, countResolver) {
            if (!values.length && !selectedValues.length) return;

            var wrap = document.createElement('div');
            wrap.className = 'assignment-scope-chip-group';

            var label = document.createElement('div');
            label.className = 'assignment-scope-chip-group-label';
            label.textContent = labelText;
            wrap.appendChild(label);

            var list = document.createElement('div');
            list.className = 'assignment-chip-checkbox-list';

            var normalizedValues = _normalizeStringList(values.length ? values : selectedValues);
            if (!normalizedValues.length) {
                var empty = document.createElement('div');
                empty.className = 'assignment-options-empty';
                empty.textContent = 'No values selected.';
                list.appendChild(empty);
            } else {
                normalizedValues.forEach(function (val) {
                    var safe = String(chip.groupId) + '-' + valueKey + '-' + val.replace(/[^a-zA-Z0-9_-]/g, '_');
                    var isAssigned = selectedValues.indexOf(val) !== -1;
                    var row = document.createElement('div');
                    row.className = 'assignment-chip-checkbox-item ' + (isAssigned ? 'is-assigned' : 'is-unassigned');

                    if (chip.isEditing) {
                        var input = document.createElement('input');
                        input.type = 'checkbox';
                        input.id = safe;
                        input.checked = isAssigned;
                        input.addEventListener('change', function () {
                            var target = chip[valueKey];
                            if (input.checked) {
                                if (target.indexOf(val) === -1) target.push(val);
                            } else {
                                chip[valueKey] = target.filter(function (x) { return x !== val; });
                            }

                            row.classList.toggle('is-assigned', input.checked);
                            row.classList.toggle('is-unassigned', !input.checked);

                            if (valueKey === 'classes') {
                                // Keep data consistent while editing, but avoid full rerender
                                // on every click so multi-select interactions stay stable.
                                _pruneChipSelection(chip);
                            }
                        });
                        row.appendChild(input);
                    } else {
                        var icon = document.createElement('i');
                        icon.className = isAssigned
                            ? 'fa-solid fa-circle-check assignment-status-icon assignment-status-icon--assigned'
                            : 'fa-solid fa-ban assignment-status-icon assignment-status-icon--unassigned';
                        row.appendChild(icon);
                    }

                    var text = document.createElement('span');
                    text.className = 'assignment-chip-option-text';
                    text.textContent = val;

                    row.appendChild(text);

                    if (typeof countResolver === 'function') {
                        var count = parseInt(countResolver(val, chip), 10);
                        if (Number.isFinite(count) && count > 0) {
                            var badge = document.createElement('span');
                            badge.className = 'assignment-chip-count-badge assignment-chip-count-badge--' + valueKey;
                            badge.textContent = String(count);
                            badge.title = count + ' cards';
                            row.appendChild(badge);
                        }
                    }

                    list.appendChild(row);
                });
            }

            wrap.appendChild(list);
            container.appendChild(wrap);
        }

        keys.forEach(function (key) {
            var chip = assignmentScopeChips[key];
            chip.groupName = _getGroupName(chip.groupId);

            var card = document.createElement('div');
            card.className = 'assignment-scope-chip-card';

            var head = document.createElement('div');
            head.className = 'assignment-scope-chip-head';

            var title = document.createElement('div');
            title.className = 'assignment-scope-chip-title';
            title.textContent = chip.groupName;

            var tools = document.createElement('div');
            tools.className = 'assignment-scope-chip-tools';

            var editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'assignment-scope-chip-edit';
            editBtn.textContent = chip.isEditing ? 'Save' : 'Edit';
            editBtn.addEventListener('click', async function () {
                if (!chip.isEditing) {
                    chip.isEditing = true;
                    await ensureChipOptionsLoaded(chip);
                    renderAssignmentScopeChips();
                    return;
                }
                chip.isEditing = false;
                _pruneChipSelection(chip);
                renderAssignmentScopeChips();
            });

            var removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'assignment-scope-chip-remove';
            removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            removeBtn.title = 'Remove assignment';
            removeBtn.addEventListener('click', function () {
                delete assignmentScopeChips[key];
                renderAssignmentScopeChips();
                updateCurrentChipActionLabel();
            });

            tools.appendChild(editBtn);
            tools.appendChild(removeBtn);
            head.appendChild(title);
            head.appendChild(tools);
            card.appendChild(head);

            // Mark card as editing when chip.isEditing so CSS can show/hide class names
            if (chip.isEditing) {
                card.classList.add('is-editing');
            } else {
                card.classList.remove('is-editing');
            }

            if (chip.isEditing && (chip.hasClass || chip.hasSection)) {
                var bulkActions = document.createElement('div');
                bulkActions.className = 'assignment-scope-chip-bulk-actions';

                if (chip.hasClass) {
                    var assignAllClassBtn = document.createElement('button');
                    assignAllClassBtn.type = 'button';
                    assignAllClassBtn.className = 'assignment-scope-chip-bulk-btn';
                    assignAllClassBtn.textContent = 'Assign All Classes';
                    assignAllClassBtn.disabled = !chip.classOptions.length;
                    assignAllClassBtn.addEventListener('click', function () {
                        chip.classes = _normalizeStringList(chip.classOptions || []);
                        _pruneChipSelection(chip);
                        renderAssignmentScopeChips();
                    });
                    bulkActions.appendChild(assignAllClassBtn);
                }

                if (chip.hasSection) {
                    var assignAllSectionBtn = document.createElement('button');
                    assignAllSectionBtn.type = 'button';
                    assignAllSectionBtn.className = 'assignment-scope-chip-bulk-btn';
                    assignAllSectionBtn.textContent = 'Assign All Sections';
                    var allSectionsForChip = _normalizeStringList(_getChipAvailableSections(chip));
                    assignAllSectionBtn.disabled = !allSectionsForChip.length;
                    assignAllSectionBtn.addEventListener('click', function () {
                        chip.sections = _normalizeStringList(_getChipAvailableSections(chip));
                        _pruneChipSelection(chip);
                        renderAssignmentScopeChips();
                    });
                    bulkActions.appendChild(assignAllSectionBtn);
                }

                if (bulkActions.childElementCount > 0) {
                    card.appendChild(bulkActions);
                }
            }

            var groups = document.createElement('div');
            groups.className = 'assignment-scope-chip-groups';

            if (chip.isEditing) {
                if (chip.hasClass || chip.classes.length || chip.classOptions.length || chip.hasSection || chip.sections.length) {
                    addClassSectionGroup(groups, chip);
                }
            } else {
                var summaryClasses = [];
                var summarySections = [];
                if (chip.classSectionSelections && Object.keys(chip.classSectionSelections).length) {
                    summaryClasses = Object.keys(chip.classSectionSelections || {});
                    Object.keys(chip.classSectionSelections || {}).forEach(function (cls) {
                        summarySections = summarySections.concat(_normalizeStringList(chip.classSectionSelections[cls] || []));
                    });
                    summarySections = _normalizeStringList(summarySections);
                }
                if (!summaryClasses.length) {
                    summaryClasses = _normalizeStringList(chip.classes || []);
                }
                if (!summarySections.length) {
                    summarySections = _normalizeStringList(chip.sections || []);
                }

                if (summaryClasses.length) {
                    addChipGroup(groups, chip, 'Classes', summaryClasses, summaryClasses, 'classes');
                }
                if (summarySections.length) {
                    addChipGroup(groups, chip, 'Sections', summarySections, summarySections, 'sections');
                }
            }

            if (chip.hasBranch || chip.branches.length) {
                addChipGroup(groups, chip, 'Branches / Courses', chip.branchOptions, chip.branches, 'branches');
            }

            if (groups.childElementCount > 0) {
                card.appendChild(groups);
                card.classList.remove('assignment-scope-chip-card--compact');
            } else {
                card.classList.add('assignment-scope-chip-card--compact');
            }
            chipList.appendChild(card);
        });

        updateCurrentChipActionLabel();
    }

    function upsertCurrentDraftAsChip(showNotification) {
        if (!currentDraftGroupId) {
            if (showNotification && typeof showToast === 'function') {
                showToast('Select one group first', 'error');
            }
            return false;
        }

        var chip = _ensureChip(currentDraftGroupId);
        chip.groupName = _getGroupName(currentDraftGroupId);
        var meta = assignmentGroupMetaById[_chipKey(currentDraftGroupId)] || {};
        var inferredSource = String(meta.source || '').toLowerCase();
        chip.scopeType = (inferredSource === 'group' || inferredSource === 'table')
            ? inferredSource
            : ((assignmentIdSource === 'group' || assignmentIdSource === 'table') ? assignmentIdSource : 'group');
        chip.classes = _normalizeStringList(Array.from(selectedClasses));
        chip.sections = _normalizeStringList(Array.from(selectedSections));
        chip.branches = _normalizeStringList(Array.from(selectedBranches));
        chip.classOptions = _normalizeStringList(allClasses);
        chip.sectionOptions = _normalizeStringList(allSections);
        chip.branchOptions = _normalizeStringList(allBranches);
        chip.classSectionMap = _cloneClassSectionMap(classSectionMap);
        if (!chip.classSectionSelections || !Object.keys(chip.classSectionSelections).length) {
            chip.classSectionSelections = {};
            var selectedClasses = _normalizeStringList(chip.classes || []);
            var selectedSections = _normalizeStringList(chip.sections || []);

            selectedClasses.forEach(function (cls) {
                chip.classSectionSelections[cls] = [];
            });

            selectedSections.forEach(function (sec) {
                var targetClass = null;
                selectedClasses.forEach(function (cls) {
                    if (targetClass) return;
                    var available = _normalizeStringList(chip.classSectionMap[cls] || []);
                    if (available.indexOf(sec) !== -1) {
                        targetClass = cls;
                    }
                });
                if (!targetClass && selectedClasses.length) {
                    targetClass = selectedClasses[0];
                }
                if (targetClass) {
                    chip.classSectionSelections[targetClass] = chip.classSectionSelections[targetClass] || [];
                    if (chip.classSectionSelections[targetClass].indexOf(sec) === -1) {
                        chip.classSectionSelections[targetClass].push(sec);
                    }
                }
            });
        }
        _syncChipSelections(chip);
        chip.classCounts = _normalizeCountMap(classCountMap);
        chip.sectionCounts = _normalizeCountMap(sectionCountMap);
        chip.classSectionCounts = _normalizeNestedCountMap(classSectionCountMap);
        chip.hasClass = fieldCapabilities.hasClass;
        chip.hasSection = fieldCapabilities.hasSection;
        chip.hasBranch = fieldCapabilities.hasBranch;
        chip.optionsLoaded = true;
        chip.isEditing = false;

        _pruneChipSelection(chip);
        renderAssignmentScopeChips();

        if (showNotification && typeof showToast === 'function') {
            showToast('Group assignment saved in chip', 'success');
        }
        return true;
    }

    function getAssignmentPayloadFromChips() {
        var payload = {
            assigned_groups: [],
            allowed_classes: [],
            allowed_sections: [],
            allowed_branches: [],
            assignment_scopes: [],
        };

        Object.keys(assignmentScopeChips).forEach(function (key) {
            var chip = assignmentScopeChips[key];
            if (!chip) return;
            var gid = parseInt(chip.groupId, 10);
            if (!Number.isFinite(gid) || gid <= 0) return;

            payload.assigned_groups.push(gid);
            payload.allowed_classes = payload.allowed_classes.concat(chip.classes || []);
            payload.allowed_sections = payload.allowed_sections.concat(chip.sections || []);
            payload.allowed_branches = payload.allowed_branches.concat(chip.branches || []);

            var scopeType = String(chip.scopeType || '').toLowerCase();
            if (scopeType !== 'group' && scopeType !== 'table') {
                scopeType = (assignmentIdSource === 'table') ? 'table' : 'group';
            }

            var classSections = {};
            Object.keys(chip.classSectionSelections || {}).forEach(function (cls) {
                var selectedSections = _normalizeStringList(chip.classSectionSelections[cls] || []);
                if (selectedSections.length) {
                    classSections[cls] = selectedSections;
                }
            });

            if (!Object.keys(classSections).length) {
                if ((chip.classes || []).length === 1 && (chip.sections || []).length) {
                    classSections[chip.classes[0]] = _normalizeStringList(chip.sections || []);
                } else if ((chip.sections || []).length === 1 && (chip.classes || []).length) {
                    (chip.classes || []).forEach(function (cls) {
                        classSections[cls] = [chip.sections[0]];
                    });
                }
            }

            payload.assignment_scopes.push({
                scope_type: scopeType,
                scope_id: gid,
                classes: _normalizeStringList(chip.classes || []),
                sections: _normalizeStringList(chip.sections || []),
                branches: _normalizeStringList(chip.branches || []),
                class_sections: classSections,
            });
        });

        payload.assigned_groups = _normalizeGroupIds(payload.assigned_groups);
        payload.allowed_classes = _normalizeStringList(payload.allowed_classes);
        payload.allowed_sections = _normalizeStringList(payload.allowed_sections);
        payload.allowed_branches = _normalizeStringList(payload.allowed_branches);
        payload.assignment_scopes = payload.assignment_scopes.sort(function (a, b) {
            var at = String(a.scope_type || '');
            var bt = String(b.scope_type || '');
            if (at !== bt) return at.localeCompare(bt);
            return parseInt(a.scope_id, 10) - parseInt(b.scope_id, 10);
        });
        return payload;
    }

    function hydrateChipsFromStaffData(data) {
        assignmentScopeChips = {};

        var rawScopes = Array.isArray(data && data.assignment_scopes) ? data.assignment_scopes : [];
        if (rawScopes.length) {
            var inferredScopeType = String((rawScopes[0] && rawScopes[0].scope_type) || '').toLowerCase();
            if ((inferredScopeType === 'group' || inferredScopeType === 'table') && assignmentIdSource !== inferredScopeType) {
                assignmentIdSource = inferredScopeType;
                csOptionsCache = {};
            }

            rawScopes.forEach(function (scope) {
                if (!scope || typeof scope !== 'object') return;
                var gid = parseInt(scope.scope_id, 10);
                if (!Number.isFinite(gid) || gid <= 0) return;

                var scopeType = String(scope.scope_type || '').toLowerCase();
                if (scopeType !== 'group' && scopeType !== 'table') {
                    scopeType = (assignmentIdSource === 'table') ? 'table' : 'group';
                }

                assignmentScopeChips[_chipKey(gid)] = {
                    groupId: gid,
                    groupName: _getGroupName(gid),
                    scopeType: scopeType,
                    classes: _normalizeStringList(scope.classes || []),
                    sections: _normalizeStringList(scope.sections || []),
                    branches: _normalizeStringList(scope.branches || []),
                    classSectionSelections: _cloneClassSectionSelections(scope.class_sections || {}),
                    classOptions: [],
                    sectionOptions: [],
                    branchOptions: [],
                    classSectionMap: {},
                    classCounts: {},
                    sectionCounts: {},
                    classSectionCounts: {},
                    hasClass: true,
                    hasSection: true,
                    hasBranch: true,
                    optionsLoaded: false,
                    isEditing: false,
                    pendingGlobalClasses: null,
                    pendingGlobalSections: null,
                    pendingGlobalBranches: null,
                    initializedFromGlobal: true,
                };

                _syncChipSelections(assignmentScopeChips[_chipKey(gid)]);
            });

            renderAssignmentScopeChips();
            hydrateChipOptionsInBackground();
            return;
        }

        var assignedIds = _getAssignedSelectionIds(data);
        var classes = _normalizeStringList(data.allowed_classes || []);
        var sections = _normalizeStringList(data.allowed_sections || []);
        var branches = _normalizeStringList(data.allowed_branches || []);

        assignedIds.forEach(function (gid) {
            assignmentScopeChips[_chipKey(gid)] = {
                groupId: gid,
                groupName: _getGroupName(gid),
                scopeType: (assignmentIdSource === 'table') ? 'table' : 'group',
                classes: [],
                sections: [],
                branches: [],
                classOptions: [],
                sectionOptions: [],
                branchOptions: [],
                classSectionMap: {},
                classSectionSelections: {},
                classCounts: {},
                sectionCounts: {},
                classSectionCounts: {},
                hasClass: true,
                hasSection: true,
                hasBranch: true,
                optionsLoaded: false,
                isEditing: false,
                pendingGlobalClasses: classes.slice(),
                pendingGlobalSections: sections.slice(),
                pendingGlobalBranches: branches.slice(),
                initializedFromGlobal: false,
            };
        });

        renderAssignmentScopeChips();
        hydrateChipOptionsInBackground();
    }

    function renderScopedCheckboxes() {
        var hasGroupSelection = currentAssignedGroupIds.length > 0;
        updateDrawerFilterVisibility(hasGroupSelection);

        if (!hasGroupSelection) {
            renderCheckboxOptions('class-options-list', [], selectedClasses);
            renderCheckboxOptions('section-options-list', [], selectedSections);
            renderCheckboxOptions('branch-options-list', [], selectedBranches);
            return;
        }

        _pruneScopedSelections(selectedClasses, selectedSections, selectedBranches);

        if (fieldCapabilities.hasClass) {
            renderCheckboxOptions('class-options-list', allClasses, selectedClasses, function () {
                _pruneSectionsBySelectedClasses(selectedSections, selectedClasses);
                renderScopedCheckboxes();
            });
        } else {
            selectedClasses.clear();
            renderCheckboxOptions('class-options-list', [], selectedClasses);
        }

        var availableSections = fieldCapabilities.hasClass
            ? _getSectionsForSelectedClasses(selectedClasses)
            : allSections;

        if (fieldCapabilities.hasSection) {
            renderCheckboxOptions('section-options-list', availableSections, selectedSections);
        } else {
            selectedSections.clear();
            renderCheckboxOptions('section-options-list', [], selectedSections);
        }

        if (fieldCapabilities.hasBranch) {
            renderCheckboxOptions('branch-options-list', allBranches, selectedBranches);
        } else {
            selectedBranches.clear();
            renderCheckboxOptions('branch-options-list', [], selectedBranches);
        }
    }

    async function initClassSection(preClasses, preSections, preBranches, groupIds) {
        currentAssignedGroupIds = _normalizeGroupIds(groupIds || []);

        _replaceSetValues(selectedClasses, preClasses);
        _replaceSetValues(selectedSections, preSections);
        _replaceSetValues(selectedBranches, preBranches);

        if (!currentAssignedGroupIds.length) {
            selectedClasses.clear();
            selectedSections.clear();
            selectedBranches.clear();
            renderScopedCheckboxes();
            return;
        }

        await fetchClassSectionOptions(currentAssignedGroupIds);
        renderScopedCheckboxes();
    }

    async function refreshDrawerClassSectionByGroups(groupIds) {
        currentAssignedGroupIds = _normalizeGroupIds(groupIds || []);

        if (!currentAssignedGroupIds.length) {
            selectedClasses.clear();
            selectedSections.clear();
            selectedBranches.clear();
            renderScopedCheckboxes();
            return;
        }

        await fetchClassSectionOptions(currentAssignedGroupIds);
        renderScopedCheckboxes();
    }

    function resetClassSection() {
        currentAssignedGroupIds = [];
        currentDraftGroupId = null;
        selectedClasses.clear();
        selectedSections.clear();
        selectedBranches.clear();
        renderScopedCheckboxes();
        updateCurrentChipActionLabel();
    }

    // ==================== DELETE MODAL (Alpine-first, bridge fallback) ====================
    var deleteModal       = document.getElementById('delete-modal');
    var cancelDeleteBtn   = document.getElementById('cancelDeleteBtn');

    function closeDeleteModalFn() {
        if (window.alpineCloseModal) {
            window.alpineCloseModal();
            return;
        }
        if (!deleteModal) return;
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
            window.AdarshModalBridge.close('delete-modal', { overlayClass: 'show' });
        } else {
            deleteModal.classList.remove('show');
            document.body.style.overflow = '';
        }
    }

    if (cancelDeleteBtn)   cancelDeleteBtn.addEventListener('click', closeDeleteModalFn);

    // Keep assignment id source aligned with active group metadata for drawer filters.
    var _assignmentGroupsLoaded = false;
    async function loadAssignGroups() {
        if (_assignmentGroupsLoaded) return;
        var clientId = getActiveAssignmentClientId();
        var groupsUrl = null;
        if (isClientPortalPath()) {
            groupsUrl = apiPath('/client/api/groups/active/');
        } else if (isPanelClientPath()) {
            groupsUrl = apiPath('/client/api/groups/active/');
        } else if (clientId) {
            groupsUrl = apiPath('/api/client/' + clientId + '/groups/');
        } else {
            return;
        }

        try {
            var data = await ApiClient.get(groupsUrl);
            console.debug('[staff] loadAssignGroups ->', groupsUrl, data && (data.success || 'no-success'));
            // If the active endpoint returned no data or was forbidden, try the
            // more permissive client groups endpoint which nests groups under
            // `data.groups` for legacy callers.
            if (!(data && data.success) && isClientPortalPath()) {
                try {
                    var fallback = await ApiClient.get(apiPath('/client/api/groups/'));
                    if (fallback && fallback.success) data = { success: true, groups: (fallback.data && fallback.data.groups) || [] };
                } catch (__) { /* ignore fallback error */ }
            }

            if (data && data.success) {
                _assignmentGroupsLoaded = true;
                var groups = data.groups || [];

                assignmentGroupsById = {};
                assignmentGroupMetaById = {};
                groups.forEach(function (item) {
                    var id = parseInt((item && item.id), 10);
                    if (!Number.isFinite(id)) return;
                    assignmentGroupsById[String(id)] = String((item && item.name) || ('Group #' + id));
                    assignmentGroupMetaById[String(id)] = {
                        source: String((item && item.source) || '').toLowerCase(),
                        groupId: parseInt((item && item.group_id), 10),
                    };
                });

                var sources = Array.from(new Set(groups.map(function (item) {
                    return String((item && item.source) || '').toLowerCase();
                }).filter(function (v) { return v === 'group' || v === 'table'; })));

                var nextSource = 'auto';
                if (sources.length === 1) nextSource = sources[0];
                if (assignmentIdSource !== nextSource) {
                    assignmentIdSource = nextSource;
                    csOptionsCache = {};
                }
            }
        } catch (_) {}
    }

    var saveCurrentAssignmentChipBtn = document.getElementById('save-current-assignment-chip-btn');
    if (saveCurrentAssignmentChipBtn && USE_CHIP_SCOPED_FILTERS) {
        var legacyActionRow = saveCurrentAssignmentChipBtn.closest('.assignment-builder-action-row');
        if (legacyActionRow) legacyActionRow.style.display = 'none';
    }
    if (saveCurrentAssignmentChipBtn) {
        saveCurrentAssignmentChipBtn.addEventListener('click', function () {
            upsertCurrentDraftAsChip(true);
        });
    }

    // Wire up the Assign button in action bar
    var assignStaffBtn = document.getElementById('assignStaffBtn');
    if (assignStaffBtn) {
        assignStaffBtn.addEventListener('click', async function () {
            if (!mgr || !mgr.getSelectedStaffId) return;

            var selectedId = mgr.getSelectedStaffId();
            if (!selectedId) return;

            var detail = await fetchStaffDetailById(selectedId);
            if (!detail) {
                if (typeof showToast === 'function') showToast('Failed to load staff data', 'error');
                return;
            }

            mgr.openDrawer('assign', detail);
        });
    }

    window.openStaffAssignmentDrawerFromTable = async function (staffId) {
        if (!staffId || !mgr) return;

        var targetId = String(staffId);
        if (typeof mgr.selectRowById === 'function') {
            mgr.selectRowById(targetId);
        }

        var detail = await fetchStaffDetailById(targetId);
        if (!detail) {
            if (typeof showToast === 'function') showToast('Failed to load staff data', 'error');
            return;
        }

        mgr.openDrawer('assign', detail);
    };

    // ==================== INITIALIZE SHARED MODULE ====================
    var mgr = window.initStaffPage({

        tableDelegateId: 'staff-table-body',
        nameColumnIndex: 1,
        skipHiddenInputs: false,
        respectDisabledPerms: true,
        labels: {
            addTitle: 'Add New Assistent',
            editTitle: 'Edit Assistent',
            viewTitle: 'View Assistent Details',
            assignTitle: 'Assign Assistent Groups, Classes & Sections',
            addSubmit: 'Add Assistent',
            editSubmit: 'Save Assistent',
            assignSubmit: 'Save Assignment',
        },

        // Assignment: groups
        assignment: {
            prefix:          'group',
            apiUrl:          function () {
                if (isClientPortalPath() || isPanelClientPath()) {
                    return apiPath('/client/api/groups/active/');
                }
                var clientId = getActiveAssignmentClientId();
                if (!clientId) return null;
                return apiPath('/api/client/' + clientId + '/groups/');
            },
            responseKey:     'groups',
            payloadKey:      'assigned_groups',
            preselectedKey:  '__none__',
            placeholder:     'Select one group...',
            pluralLabel:     'groups',
            singleSelect:    true,
            matchByParentId: false,
            getExcludedIds: function () {
                return Object.keys(assignmentScopeChips).map(function (k) {
                    return parseInt(k, 10);
                }).filter(function (v) {
                    return Number.isFinite(v);
                });
            },
        },

        // Permissions  full set mirroring STAFF_PERMISSION_FIELDS in services_staff.py
        permissionFields: [
            // ID Card List Tabs
            'perm-idcard-pending-list', 'perm-idcard-verified-list', 'perm-idcard-pool-list',
            'perm-idcard-approved-list', 'perm-idcard-download-list',
            // Export & Download
            'perm-idcard-bulk-download',
            // Card Actions
            'perm-idcard-add', 'perm-idcard-edit', 'perm-idcard-delete', 'perm-idcard-info',
            'perm-idcard-verify',
            'perm-idcard-created-at', 'perm-idcard-updated-at', 'perm-idcard-retrieve',
            // App & Access
            'perm-mobile-app'
        ],
        defaultOnPerms: [],

            // API endpoints (client-scoped)
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
            resetClientSelection();
            showClientAssignmentSection();
            resetClassSection();
            assignmentScopeChips = {};
            renderAssignmentScopeChips();
            fetchAssignableClients().then(function () {
                renderClientDropdown(document.getElementById('client-search-input') ? document.getElementById('client-search-input').value : '');
            });
        },
        onBeforeAssignmentInit: function (data) {
            setActiveAssignmentClientId(data && data.client_id ? data.client_id : null);
        },
        onPopulateForm: function (data, meta) {
            initClientAssignment(data && (data.client_id || (Array.isArray(data.assigned_client_ids) ? data.assigned_client_ids[0] : null)));
            if (!meta || meta.mode !== 'assign') return;

            hydrateChipsFromStaffData(data);
            resetClassSection();
            updateCurrentChipActionLabel();

            // Late-bind proper names if groups metadata arrives after chip hydration.
            loadAssignGroups().then(function () {
                renderAssignmentScopeChips();
            });
        },
        onAssignmentSelectionChange: async function (selectedGroupIds, meta) {
            if (!meta || meta.mode !== 'assign') return;

            var normalizedGroupIds = _normalizeGroupIds(selectedGroupIds || []);
            currentDraftGroupId = normalizedGroupIds.length ? normalizedGroupIds[0] : null;

            if (!currentDraftGroupId) {
                resetClassSection();
                return;
            }

            var key = _chipKey(currentDraftGroupId);
            var existingChip = assignmentScopeChips[key] || null;
            if (existingChip) {
                _replaceSetValues(selectedClasses, existingChip.classes || []);
                _replaceSetValues(selectedSections, existingChip.sections || []);
                _replaceSetValues(selectedBranches, existingChip.branches || []);
                existingChip.isEditing = true;
            } else {
                selectedClasses.clear();
                selectedSections.clear();
                selectedBranches.clear();
            }

            // Auto-create a full assignment chip immediately for selected group.
            await refreshDrawerClassSectionByGroups([currentDraftGroupId]);

            if (!assignmentScopeChips[key]) {
                var draftMeta = assignmentGroupMetaById[key] || {};
                var draftSource = String(draftMeta.source || '').toLowerCase();
                assignmentScopeChips[key] = {
                    groupId: currentDraftGroupId,
                    groupName: _getGroupName(currentDraftGroupId),
                    scopeType: (draftSource === 'group' || draftSource === 'table')
                        ? draftSource
                        : ((assignmentIdSource === 'table') ? 'table' : 'group'),
                    classes: [],
                    sections: [],
                    branches: [],
                    classOptions: _normalizeStringList(allClasses),
                    sectionOptions: _normalizeStringList(allSections),
                    branchOptions: _normalizeStringList(allBranches),
                    classSectionMap: _cloneClassSectionMap(classSectionMap),
                    classCounts: _normalizeCountMap(classCountMap),
                    sectionCounts: _normalizeCountMap(sectionCountMap),
                    classSectionCounts: _normalizeNestedCountMap(classSectionCountMap),
                    hasClass: fieldCapabilities.hasClass,
                    hasSection: fieldCapabilities.hasSection,
                    hasBranch: fieldCapabilities.hasBranch,
                    optionsLoaded: true,
                    isEditing: true,
                };
                _pruneChipSelection(assignmentScopeChips[key]);
                if (typeof showToast === 'function') {
                    showToast('Group assignment chip created. Select classes/sections or use Assign All.', 'success');
                }
            }

            renderAssignmentScopeChips();
            updateCurrentChipActionLabel();
        },
        onBeforeSubmit: function (formData, meta) {
            if (!meta || meta.mode !== 'assign') {
                    if (!selectedClientId) {
                        // Try to auto-resolve the client id from common contexts (impersonation, client page, single-client list)
                        var autoClientId = null;
                        if (typeof window.CLIENT_ID !== 'undefined' && window.CLIENT_ID) {
                            autoClientId = parseInt(window.CLIENT_ID, 10);
                        }
                        if (!Number.isFinite(autoClientId)) {
                            var el = document.querySelector('[data-client-id]');
                            if (el) {
                                autoClientId = parseInt(el.getAttribute('data-client-id'), 10);
                            }
                        }
                        if (!Number.isFinite(autoClientId) && Array.isArray(allClients) && allClients.length === 1) {
                            autoClientId = parseInt(allClients[0].id, 10);
                        }

                        if (!Number.isFinite(autoClientId)) {
                            // No client could be auto-resolved on the frontend.
                            // Previously we threw an error here requiring manual
                            // client selection. Instead, allow the backend to
                            // auto-assign the creating client (server-side).
                            selectedClientId = null;
                        } else {
                            selectedClientId = autoClientId;
                        }
                    }

                    if (Number.isFinite(selectedClientId)) {
                        formData.client_id = selectedClientId;
                    }

                    return;
            }

            if (!meta || meta.mode !== 'assign') return;

            var payload = getAssignmentPayloadFromChips();
            formData.assigned_groups = payload.assigned_groups;
            formData.assignment_id_source = (
                assignmentIdSource === 'group' || assignmentIdSource === 'table'
            ) ? assignmentIdSource : 'auto';
            formData.allowed_classes = payload.allowed_classes;
            formData.allowed_sections = payload.allowed_sections;
            formData.allowed_branches = payload.allowed_branches;
            formData.assignment_scopes = payload.assignment_scopes;
        },
        onSetStatus:        null,
        onEnableFormInputs: function (enable) {
            var toggle = document.getElementById('client-multiselect-toggle');
            if (!toggle) return;
            toggle.style.pointerEvents = enable ? '' : 'none';
            toggle.style.opacity = enable ? '' : '0.6';
            if (!enable) {
                closeClientDropdown();
            }
        },
        onStatusToggle:     null,

        // Delete modal
        openDeleteModal: function (name) {
            var el = document.getElementById('deleteStaffName');
            if (el) el.textContent = name;

            if (window.alpineOpenModal) {
                window.alpineOpenModal('delete');
                return;
            }

            if (!deleteModal) return;
            if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
                window.AdarshModalBridge.open('delete-modal', { overlayClass: 'show', focusSelector: '#confirmDeleteBtn' });
            } else {
                deleteModal.classList.add('show');
                document.body.style.overflow = 'hidden';
            }
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

            if (typeof htmx !== 'undefined' && htmx && typeof htmx.trigger === 'function') {
                htmx.trigger(document.body, 'refreshTable');
            }
        },
    });

    // Do not fetch assignment APIs on page load.
    // These endpoints depend on selected/active client context and should run lazily.

    // Temp password modal (client portal staff only)
    var tempPwVerificationCode = '';
    var tempPwTargetId = null;
    var tempPwTargetName = '';

    window.openTempPasswordModal = function () {
        tempPwTargetId = mgr && mgr.getSelectedStaffId ? mgr.getSelectedStaffId() : null;
        tempPwTargetName = (document.getElementById('staff-name') || {}).value || 'this staff';

        if (!tempPwTargetId) {
            if (typeof showToast === 'function') showToast('No staff selected', 'error');
            return;
        }

        var modal = document.getElementById('temp-password-modal');
        var step1 = document.getElementById('tempPwStep1');
        var step2 = document.getElementById('tempPwStep2');
        var codeEl = document.getElementById('tempPwVerifyCode');
        var codeInput = document.getElementById('tempPwCodeInput');
        var codeErr = document.getElementById('tempPwCodeError');
        var pwInput = document.getElementById('tempPwNewPassword');
        var pwErr = document.getElementById('tempPwError');
        var userNameEl = document.getElementById('tempPwUserName');

        if (!modal || !step1 || !step2 || !codeEl || !codeInput || !codeErr || !pwInput || !pwErr || !userNameEl) {
            if (typeof showToast === 'function') showToast('Temp password modal is not available', 'error');
            return;
        }

        tempPwVerificationCode = (typeof ConfirmationCode !== 'undefined' && ConfirmationCode.generate)
            ? ConfirmationCode.generate()
            : String(Math.floor(1000000000 + Math.random() * 9000000000));

        step1.style.display = '';
        step2.style.display = 'none';
        codeEl.textContent = tempPwVerificationCode;
        codeInput.value = '';
        if (typeof window.renderTempPwCodeBoxes === 'function') window.renderTempPwCodeBoxes('');
        if (typeof window.setTempPwCodeState === 'function') window.setTempPwCodeState('');
        codeErr.style.display = 'none';
        pwInput.value = '';
        pwInput.type = 'password';
        pwErr.style.display = 'none';
        userNameEl.textContent = tempPwTargetName;
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
            window.AdarshModalBridge.open('temp-password-modal', { overlayClass: 'show' });
        } else {
            modal.style.display = 'flex';
        }
    };

    window.closeTempPasswordModal = function () {
        var modal = document.getElementById('temp-password-modal');
        if (modal) {
            if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
                window.AdarshModalBridge.close('temp-password-modal', { overlayClass: 'show' });
            } else {
                modal.style.display = 'none';
            }
        }
        tempPwVerificationCode = '';
        tempPwTargetId = null;
        if (typeof window.setTempPwCodeState === 'function') window.setTempPwCodeState('');
    };

    window.verifyTempPwCode = function () {
        var codeInput = document.getElementById('tempPwCodeInput');
        var codeErr = document.getElementById('tempPwCodeError');
        var step1 = document.getElementById('tempPwStep1');
        var step2 = document.getElementById('tempPwStep2');
        var pwInput = document.getElementById('tempPwNewPassword');
        if (!codeInput || !codeErr || !step1 || !step2) return;

        var input = (codeInput.value || '').replace(/\D/g, '').slice(0, 10);
        codeInput.value = input;
        if (typeof window.renderTempPwCodeBoxes === 'function') window.renderTempPwCodeBoxes(input);

        if (input === tempPwVerificationCode) {
            if (typeof window.setTempPwCodeState === 'function') window.setTempPwCodeState('is-valid');
            codeErr.style.display = 'none';
            step1.style.display = 'none';
            step2.style.display = '';
            if (pwInput) pwInput.focus();
            return;
        }
        if (typeof window.setTempPwCodeState === 'function') window.setTempPwCodeState(input.length === 10 ? 'is-invalid' : '');
        codeErr.style.display = '';
    };

    window.toggleTempPwVisibility = function () {
        var pwInput = document.getElementById('tempPwNewPassword');
        var eyeIcon = document.getElementById('tempPwEyeIcon');
        if (!pwInput) return;
        if (pwInput.type === 'password') {
            pwInput.type = 'text';
            if (eyeIcon) eyeIcon.className = 'fa-solid fa-eye-slash';
        } else {
            pwInput.type = 'password';
            if (eyeIcon) eyeIcon.className = 'fa-solid fa-eye';
        }
    };

    window.saveTempPassword = async function () {
        var pwInput = document.getElementById('tempPwNewPassword');
        var pwErr = document.getElementById('tempPwError');
        var saveBtn = document.getElementById('tempPwSaveBtn');
        if (!pwInput || !pwErr || !saveBtn) return;

        var password = (pwInput.value || '').trim();
        if (!password || password.length < 8) {
            pwErr.textContent = 'Password must be at least 8 characters.';
            pwErr.style.display = '';
            return;
        }
        pwErr.style.display = 'none';

        if (!tempPwTargetId) {
            if (typeof showToast === 'function') showToast('No staff selected', 'error');
            return;
        }

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        try {
            var result = await ApiClient.post('/client/api/staff/' + tempPwTargetId + '/set-temp-password/', {
                password: password,
            });
            if (result && result.success) {
                window.closeTempPasswordModal();
                if (typeof showToast === 'function') showToast(result.message || 'Temporary password set successfully!', 'success');
            } else if (typeof showToast === 'function') {
                showToast((result && (result.message || result.error)) || 'Failed to set password', 'error');
            }
        } catch (err) {
            if (typeof showToast === 'function') {
                showToast((err && err.message) || 'Network error. Please try again.', 'error');
            }
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Save Password';
        }
    };

    // Expose manager for temp password modal access
    window._staffPageMgr = mgr;
});
