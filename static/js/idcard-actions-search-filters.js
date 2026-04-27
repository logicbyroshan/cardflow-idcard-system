// ID Card Actions - Search Filters Sub-module
// Contains: Class/section filter dropdowns, sort, rows per page, image sort
// Split from: idcard-actions-search.js

(function() {
'use strict';

window.IDCardApp = window.IDCardApp || {};

// ==========================================
// CLASS/SECTION/COURSE/BRANCH FILTER HANDLERS
// ==========================================

// Current filter values (on IDCardApp namespace for cross-module access)
let currentClassFilter = '';
let currentSectionFilter = '';
let currentCourseFilter = '';
let currentBranchFilter = '';
IDCardApp.currentClassFilter = '';
IDCardApp.currentSectionFilter = '';
IDCardApp.currentCourseFilter = '';
IDCardApp.currentBranchFilter = '';

let _allClassOptions = [];
let _allSectionOptions = [];
let _classToSections = {};
let _sectionToClasses = {};
let _allCourseOptions = [];
let _allBranchOptions = [];
let _courseToBranches = {};
let _branchToCourses = {};

// HTML-escape helper to prevent XSS in filter dropdown values
function _escFilterHtml(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function initFilterHandlers() {
    initClassFilterDropdown();
    initSectionFilterDropdown();
    initCourseFilterDropdown();
    initBranchFilterDropdown();
    initClearFiltersButton();
    // Populate options from table data after a short delay to let table render
    setTimeout(populateFilterOptions, 500);
}

function _classOptionValue(opt) {
    if (opt && typeof opt === 'object') return String(opt.value || '').trim();
    return String(opt || '').trim();
}

function _classOptionLabel(opt) {
    if (opt && typeof opt === 'object') {
        return _formatFilterDisplayLabel(opt.display || opt.value || '');
    }
    return _formatFilterDisplayLabel(opt || '');
}

function _formatFilterDisplayLabel(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    if (/[A-Z]/.test(raw)) return raw;
    return raw.replace(/[A-Za-z]+/g, function(token) {
        if (token.length <= 3) return token.toUpperCase();
        return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    });
}

function _renderDependentFilterOptions() {
    const classOptionsEl = document.getElementById('classFilterOptions');
    const sectionOptionsEl = document.getElementById('sectionFilterOptions');
    const courseOptionsEl = document.getElementById('courseFilterOptions');
    const branchOptionsEl = document.getElementById('branchFilterOptions');
    const classTextEl = document.getElementById('classFilterText');
    const sectionTextEl = document.getElementById('sectionFilterText');
    const courseTextEl = document.getElementById('courseFilterText');
    const branchTextEl = document.getElementById('branchFilterText');

    if (!classOptionsEl && !sectionOptionsEl && !courseOptionsEl && !branchOptionsEl) return;

    let allowedClassValues = _allClassOptions.map(_classOptionValue);
    let allowedSectionValues = _allSectionOptions.slice();
    let allowedCourseValues = _allCourseOptions.slice();
    let allowedBranchValues = _allBranchOptions.slice();

    if (currentSectionFilter) {
        const bySection = _sectionToClasses[currentSectionFilter] || [];
        if (bySection.length) allowedClassValues = bySection.slice();
    }
    if (currentClassFilter) {
        const byClass = _classToSections[currentClassFilter] || [];
        if (byClass.length) allowedSectionValues = byClass.slice();
    }

    if (currentBranchFilter) {
        const byBranch = _branchToCourses[currentBranchFilter] || [];
        if (byBranch.length) allowedCourseValues = byBranch.slice();
    }
    if (currentCourseFilter) {
        const byCourse = _courseToBranches[currentCourseFilter] || [];
        if (byCourse.length) allowedBranchValues = byCourse.slice();
    }

    const allowedClassSet = new Set(allowedClassValues.map(v => String(v)));
    const allowedSectionSet = new Set(allowedSectionValues.map(v => String(v)));
    const allowedCourseSet = new Set(allowedCourseValues.map(v => String(v)));
    const allowedBranchSet = new Set(allowedBranchValues.map(v => String(v)));

    const filteredClassOptions = _allClassOptions.filter(opt => allowedClassSet.has(_classOptionValue(opt)));
    const filteredSectionOptions = _allSectionOptions.filter(v => allowedSectionSet.has(String(v)));
    const filteredCourseOptions = _allCourseOptions.filter(v => allowedCourseSet.has(String(v)));
    const filteredBranchOptions = _allBranchOptions.filter(v => allowedBranchSet.has(String(v)));

    if (classOptionsEl) {
        classOptionsEl.innerHTML = '<div class="dropdown-option" data-value="">All Classes</div>' +
            filteredClassOptions.map(function(opt) {
                const value = _classOptionValue(opt);
                const label = _classOptionLabel(opt);
                return '<div class="dropdown-option" data-value="' + _escFilterHtml(value) + '">' + _escFilterHtml(label) + '</div>';
            }).join('');
    }

    if (sectionOptionsEl) {
        sectionOptionsEl.innerHTML = '<div class="dropdown-option" data-value="">All Sections</div>' +
            filteredSectionOptions.map(function(v) {
                var s = String(v);
                var label = _formatFilterDisplayLabel(s);
                return '<div class="dropdown-option" data-value="' + _escFilterHtml(s) + '">' + _escFilterHtml(label) + '</div>';
            }).join('');
    }

    if (courseOptionsEl) {
        courseOptionsEl.innerHTML = '<div class="dropdown-option" data-value="">All Courses</div>' +
            filteredCourseOptions.map(function(v) {
                var s = String(v);
                return '<div class="dropdown-option" data-value="' + _escFilterHtml(s) + '">' + _escFilterHtml(s) + '</div>';
            }).join('');
    }

    if (branchOptionsEl) {
        branchOptionsEl.innerHTML = '<div class="dropdown-option" data-value="">All Branches</div>' +
            filteredBranchOptions.map(function(v) {
                var s = String(v);
                return '<div class="dropdown-option" data-value="' + _escFilterHtml(s) + '">' + _escFilterHtml(s) + '</div>';
            }).join('');
    }

    const classStillValid = !currentClassFilter || filteredClassOptions.some(opt => _classOptionValue(opt) === currentClassFilter);
    const sectionStillValid = !currentSectionFilter || filteredSectionOptions.some(v => String(v) === currentSectionFilter);
    const courseStillValid = !currentCourseFilter || filteredCourseOptions.some(v => String(v) === currentCourseFilter);
    const branchStillValid = !currentBranchFilter || filteredBranchOptions.some(v => String(v) === currentBranchFilter);

    if (!classStillValid) {
        currentClassFilter = '';
        IDCardApp.currentClassFilter = '';
    }
    if (!sectionStillValid) {
        currentSectionFilter = '';
        IDCardApp.currentSectionFilter = '';
    }
    if (!courseStillValid) {
        currentCourseFilter = '';
        IDCardApp.currentCourseFilter = '';
    }
    if (!branchStillValid) {
        currentBranchFilter = '';
        IDCardApp.currentBranchFilter = '';
    }

    if (classOptionsEl) {
        classOptionsEl.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
    }
    if (sectionOptionsEl) {
        sectionOptionsEl.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
    }
    if (courseOptionsEl) {
        courseOptionsEl.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
    }
    if (branchOptionsEl) {
        branchOptionsEl.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
    }

    var classSel = classOptionsEl
        ? (classOptionsEl.querySelector('[data-value="' + CSS.escape(currentClassFilter) + '"]') || classOptionsEl.querySelector('[data-value=""]'))
        : null;
    var sectionSel = sectionOptionsEl
        ? (sectionOptionsEl.querySelector('[data-value="' + CSS.escape(currentSectionFilter) + '"]') || sectionOptionsEl.querySelector('[data-value=""]'))
        : null;
    var courseSel = courseOptionsEl
        ? (courseOptionsEl.querySelector('[data-value="' + CSS.escape(currentCourseFilter) + '"]') || courseOptionsEl.querySelector('[data-value=""]'))
        : null;
    var branchSel = branchOptionsEl
        ? (branchOptionsEl.querySelector('[data-value="' + CSS.escape(currentBranchFilter) + '"]') || branchOptionsEl.querySelector('[data-value=""]'))
        : null;

    if (classSel) classSel.classList.add('selected');
    if (sectionSel) sectionSel.classList.add('selected');
    if (courseSel) courseSel.classList.add('selected');
    if (branchSel) branchSel.classList.add('selected');

    if (classTextEl) {
        if (currentClassFilter && classSel) classTextEl.textContent = classSel.textContent.trim();
        else classTextEl.textContent = 'All Classes';
    }
    if (sectionTextEl) {
        if (currentSectionFilter && sectionSel) sectionTextEl.textContent = sectionSel.textContent.trim();
        else sectionTextEl.textContent = 'All Sections';
    }
    if (courseTextEl) {
        if (currentCourseFilter && courseSel) courseTextEl.textContent = courseSel.textContent.trim();
        else courseTextEl.textContent = 'All Courses';
    }
    if (branchTextEl) {
        if (currentBranchFilter && branchSel) branchTextEl.textContent = branchSel.textContent.trim();
        else branchTextEl.textContent = 'All Branches';
    }
}

/** Show/hide the clear-filters button based on whether any filter is active */
function updateClearFiltersVisibility() {
    const btn = document.getElementById('clearFiltersBtn');
    if (!btn) return;
    const currentSort = (IDCardApp._ts && IDCardApp._ts.currentSort) ? IDCardApp._ts.currentSort : 'sr-asc';
    const hasSortFilter = currentSort !== 'sr-asc';
    const hasFilter = currentClassFilter || currentSectionFilter || currentCourseFilter || currentBranchFilter || IDCardApp._activeImageSort || hasSortFilter;
    if (hasFilter) {
        btn.classList.add('visible');
    } else {
        btn.classList.remove('visible');
    }
}

/** Clear all dropdown filters and refresh */
function initClearFiltersButton() {
    const btn = document.getElementById('clearFiltersBtn');
    if (!btn) return;
    btn.addEventListener('click', function() {
        // Reset class filter
        currentClassFilter = '';
        IDCardApp.currentClassFilter = '';
        const classText = document.getElementById('classFilterText');
        if (classText) classText.textContent = 'All Classes';
        const classOptions = document.getElementById('classFilterOptions');
        if (classOptions) {
            classOptions.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
            var first = classOptions.querySelector('.dropdown-option[data-value=""]');
            if (first) first.classList.add('selected');
        }
        // Reset section filter
        currentSectionFilter = '';
        IDCardApp.currentSectionFilter = '';
        const sectionText = document.getElementById('sectionFilterText');
        if (sectionText) sectionText.textContent = 'All Sections';
        const sectionOptions = document.getElementById('sectionFilterOptions');
        if (sectionOptions) {
            sectionOptions.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
            var first = sectionOptions.querySelector('.dropdown-option[data-value=""]');
            if (first) first.classList.add('selected');
        }
        // Reset course filter
        currentCourseFilter = '';
        IDCardApp.currentCourseFilter = '';
        const courseText = document.getElementById('courseFilterText');
        if (courseText) courseText.textContent = 'All Courses';
        const courseOptions = document.getElementById('courseFilterOptions');
        if (courseOptions) {
            courseOptions.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
            var firstCourse = courseOptions.querySelector('.dropdown-option[data-value=""]');
            if (firstCourse) firstCourse.classList.add('selected');
        }
        // Reset branch filter
        currentBranchFilter = '';
        IDCardApp.currentBranchFilter = '';
        const branchText = document.getElementById('branchFilterText');
        if (branchText) branchText.textContent = 'All Branches';
        const branchOptions = document.getElementById('branchFilterOptions');
        if (branchOptions) {
            branchOptions.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
            var firstBranch = branchOptions.querySelector('.dropdown-option[data-value=""]');
            if (firstBranch) firstBranch.classList.add('selected');
        }
        // Reset image sort filter
        clearImageSortFilter();
        // Reset name sort filter
        if (IDCardApp._ts) {
            IDCardApp._ts.currentSort = 'sr-asc';
        }
        const sortToggle = document.getElementById('sortToggle');
        const sortOptions = document.querySelectorAll('#sortOptions .dropdown-option');
        sortOptions.forEach(function(o) {
            o.classList.remove('selected');
            if ((o.getAttribute('data-value') || '') === 'sr-asc') {
                o.classList.add('selected');
            }
        });
        if (sortToggle) {
            sortToggle.innerHTML = '<i class="fa-solid fa-sort"></i> Sort: Newest <i class="fa-solid fa-chevron-down"></i>';
        }
        // Hide clear button
        _renderDependentFilterOptions();
        updateClearFiltersVisibility();
        // Refresh table
        applyClassSectionFilters();
    });
}

function _closeAllFilterDropdowns(exceptId) {
    ['classFilterDropdown', 'sectionFilterDropdown', 'courseFilterDropdown', 'branchFilterDropdown'].forEach(function(id) {
        if (id === exceptId) return;
        var el = document.getElementById(id);
        if (el) el.classList.remove('open');
    });
}

function initClassFilterDropdown() {
    const dropdown = document.getElementById('classFilterDropdown');
    const toggle = document.getElementById('classFilterToggle');
    const options = document.getElementById('classFilterOptions');
    const text = document.getElementById('classFilterText');
    if (!dropdown || !toggle || !options) return;

    toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        _closeAllFilterDropdowns('classFilterDropdown');
        dropdown.classList.toggle('open');
    });

    options.addEventListener('click', function(e) {
        const opt = e.target.closest('.dropdown-option');
        if (!opt) return;
        options.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        const val = opt.dataset.value || '';
        currentClassFilter = val;
        IDCardApp.currentClassFilter = val;
        text.textContent = opt.textContent.trim();
        dropdown.classList.remove('open');
        _renderDependentFilterOptions();
        updateClearFiltersVisibility();
        applyClassSectionFilters();
    });

    // Guard: only add one document-level close listener per dropdown
    if (!dropdown._docClickInit) {
        dropdown._docClickInit = true;
        document.addEventListener('click', function(e) {
            if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
        });
    }
}

function initSectionFilterDropdown() {
    const dropdown = document.getElementById('sectionFilterDropdown');
    const toggle = document.getElementById('sectionFilterToggle');
    const options = document.getElementById('sectionFilterOptions');
    const text = document.getElementById('sectionFilterText');
    if (!dropdown || !toggle || !options) return;

    toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        _closeAllFilterDropdowns('sectionFilterDropdown');
        dropdown.classList.toggle('open');
    });

    options.addEventListener('click', function(e) {
        const opt = e.target.closest('.dropdown-option');
        if (!opt) return;
        options.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        const val = opt.dataset.value || '';
        currentSectionFilter = val;
        IDCardApp.currentSectionFilter = val;
        text.textContent = opt.textContent.trim();
        dropdown.classList.remove('open');
        _renderDependentFilterOptions();
        updateClearFiltersVisibility();
        applyClassSectionFilters();
    });

    // Guard: only add one document-level close listener per dropdown
    if (!dropdown._docClickInit) {
        dropdown._docClickInit = true;
        document.addEventListener('click', function(e) {
            if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
        });
    }
}

function initCourseFilterDropdown() {
    const dropdown = document.getElementById('courseFilterDropdown');
    const toggle = document.getElementById('courseFilterToggle');
    const options = document.getElementById('courseFilterOptions');
    const text = document.getElementById('courseFilterText');
    if (!dropdown || !toggle || !options) return;

    toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        _closeAllFilterDropdowns('courseFilterDropdown');
        dropdown.classList.toggle('open');
    });

    options.addEventListener('click', function(e) {
        const opt = e.target.closest('.dropdown-option');
        if (!opt) return;
        options.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        const val = opt.dataset.value || '';
        currentCourseFilter = val;
        IDCardApp.currentCourseFilter = val;
        text.textContent = opt.textContent.trim();
        dropdown.classList.remove('open');
        _renderDependentFilterOptions();
        updateClearFiltersVisibility();
        applyClassSectionFilters();
    });

    if (!dropdown._docClickInit) {
        dropdown._docClickInit = true;
        document.addEventListener('click', function(e) {
            if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
        });
    }
}

function initBranchFilterDropdown() {
    const dropdown = document.getElementById('branchFilterDropdown');
    const toggle = document.getElementById('branchFilterToggle');
    const options = document.getElementById('branchFilterOptions');
    const text = document.getElementById('branchFilterText');
    if (!dropdown || !toggle || !options) return;

    toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        _closeAllFilterDropdowns('branchFilterDropdown');
        dropdown.classList.toggle('open');
    });

    options.addEventListener('click', function(e) {
        const opt = e.target.closest('.dropdown-option');
        if (!opt) return;
        options.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        const val = opt.dataset.value || '';
        currentBranchFilter = val;
        IDCardApp.currentBranchFilter = val;
        text.textContent = opt.textContent.trim();
        dropdown.classList.remove('open');
        _renderDependentFilterOptions();
        updateClearFiltersVisibility();
        applyClassSectionFilters();
    });

    if (!dropdown._docClickInit) {
        dropdown._docClickInit = true;
        document.addEventListener('click', function(e) {
            if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
        });
    }
}

/**
 * Populate class/section/course/branch filter dropdowns from the server-side API.
 * Calls /api/table/{id}/filter-options/ to get ALL distinct values from the database,
 * not just from loaded rows.
 * 
 * Debounced: multiple rapid calls within 500ms coalesce into one request.
 */
var _populateFilterOptionsTimer = null;
var _populateFilterOptionsInFlight = false;
var _populateFilterOptionsPending = false;

function populateFilterOptions(options) {
    options = options || {};
    var immediate = !!options.immediate;
    var force = !!options.force;

    // Virtual table mode: table-render.js calls _populateFilterOptions()
    // after every fetch  no DOM scanning needed here.
    if (window.USE_VIRTUAL_TABLE && window.IDCardApp && window.IDCardApp.virtualTable) {
        return;
    }

    // Debounce normal updates, but allow immediate forced refreshes.
    if (_populateFilterOptionsTimer) {
        clearTimeout(_populateFilterOptionsTimer);
    }

    if (immediate) {
        _doPopulateFilterOptions({ force: force });
        return;
    }

    _populateFilterOptionsTimer = setTimeout(function() {
        _doPopulateFilterOptions({ force: force });
    }, 500);
}

function _doPopulateFilterOptions(options) {
    options = options || {};
    var force = !!options.force;
    _populateFilterOptionsTimer = null;
    
    // Avoid overlapping calls. If a forced refresh arrives while one is running,
    // queue one extra run so UI still gets the freshest options.
    if (_populateFilterOptionsInFlight) {
        if (force) _populateFilterOptionsPending = true;
        return;
    }

    var tableId = (IDCardApp.lazyLoadState && IDCardApp.lazyLoadState.tableId) ||
                  (typeof TABLE_ID !== 'undefined' ? TABLE_ID : null);
    if (!tableId) return;

    _populateFilterOptionsInFlight = true;

    // Fetch filter options for ALL statuses (no status param) so users can
    // see every class/section value across the entire table, not just the
    // current list.
    var url = '/api/table/' + tableId + '/filter-options/';
    if (force) {
        url += '?_=' + Date.now();
    }

    ApiClient.get(url)
        .then(function(data) {
            _populateFilterOptionsInFlight = false;
            if (!data || !data.success) return;

            _allClassOptions = Array.isArray(data.class_values) ? data.class_values.slice() : [];
            _allSectionOptions = Array.isArray(data.section_values) ? data.section_values.slice() : [];
            _classToSections = data.class_to_sections || {};
            _sectionToClasses = data.section_to_classes || {};
            _allCourseOptions = Array.isArray(data.course_values) ? data.course_values.slice() : [];
            _allBranchOptions = Array.isArray(data.branch_values) ? data.branch_values.slice() : [];
            _courseToBranches = data.course_to_branches || {};
            _branchToCourses = data.branch_to_courses || {};

            _renderDependentFilterOptions();
            if (_populateFilterOptionsPending) {
                _populateFilterOptionsPending = false;
                _doPopulateFilterOptions({ force: true });
            }
        })
        .catch(function(err) {
            _populateFilterOptionsInFlight = false;
            console.error('Failed to load filter options:', err);
            if (_populateFilterOptionsPending) {
                _populateFilterOptionsPending = false;
                _doPopulateFilterOptions({ force: true });
            }
        });
}

function forceRefreshFilterOptions() {
    populateFilterOptions({ immediate: true, force: true });
}

function _getCurrentTableIdForFilters() {
    var fromLazy = IDCardApp.lazyLoadState && IDCardApp.lazyLoadState.tableId;
    if (fromLazy) return Number(fromLazy);
    if (typeof TABLE_ID !== 'undefined' && TABLE_ID) return Number(TABLE_ID);
    return null;
}

function _handleClassesUpgradedEvent(tableId) {
    var currentTableId = _getCurrentTableIdForFilters();
    if (!currentTableId) return;
    if (tableId && Number(tableId) !== currentTableId) return;

    // Keep visible rows and dropdown options in sync immediately.
    if (typeof IDCardApp.resetAndReload === 'function') {
        IDCardApp.resetAndReload();
    } else if (typeof IDCardApp.refreshCardTable === 'function') {
        IDCardApp.refreshCardTable();
    }
    forceRefreshFilterOptions();
}

function initUpgradeAutoRefreshBridge() {
    if (window.__idcardUpgradeAutoRefreshBridgeInit) return;
    window.__idcardUpgradeAutoRefreshBridgeInit = true;

    window.addEventListener('idcard-classes-upgraded', function(e) {
        var detail = (e && e.detail) || {};
        _handleClassesUpgradedEvent(detail.tableId);
    });

    window.addEventListener('storage', function(e) {
        if (!e || e.key !== 'idcard:classes-upgraded' || !e.newValue) return;
        try {
            var payload = JSON.parse(e.newValue);
            _handleClassesUpgradedEvent(payload && payload.tableId);
        } catch (_err) {}
    });
}

initUpgradeAutoRefreshBridge();

function getClassSectionColumnIndices() {
    const headerRow = document.querySelector('#data-table thead tr');
    if (!headerRow) return { classIndex: -1, sectionIndex: -1 };
    
    const headers = headerRow.querySelectorAll('th');
    let classIndex = -1;
    let sectionIndex = -1;
    
    headers.forEach((header, index) => {
        const fieldName = header.getAttribute('data-field-name') || header.textContent.trim();
        const fieldNameUpper = fieldName.toUpperCase();
        // Match CLASS or similar names
        if (classIndex === -1 && (fieldNameUpper === 'CLASS' || fieldNameUpper === 'STD' || fieldNameUpper === 'STANDARD' || fieldNameUpper === 'GRADE' || fieldNameUpper.includes('CLASS'))) {
            classIndex = index;
        }
        // Match SECTION or similar names
        if (sectionIndex === -1 && (fieldNameUpper === 'SECTION' || fieldNameUpper === 'SEC' || fieldNameUpper === 'DIV' || fieldNameUpper === 'DIVISION' || fieldNameUpper.includes('SECTION'))) {
            sectionIndex = index;
        }
    });
    
    return { classIndex, sectionIndex };
}

function applyClassSectionFilters() {
    // Virtual table mode: server handles search/class/section/course/branch filtering.
    // Just trigger a single re-fetch  the JSON API includes filter params.
    // Image-sort is applied client-side inside the virtual table's _applyFilters().
    if (window.USE_VIRTUAL_TABLE && typeof IDCardApp.applyFiltersAndSort === 'function') {
        IDCardApp.applyFiltersAndSort();
        return;
    }

    // Server-side filter: reset table and reload with current filter params.
    // The server handles search, class, section, course, branch, image sort, and sort order.
    if (typeof IDCardApp.resetAndReload === 'function') {
        IDCardApp.resetAndReload();
    } else if (typeof IDCardApp.applyFiltersAndSort === 'function') {
        // Fallback to client-side filtering if resetAndReload not available
        IDCardApp.applyFiltersAndSort();
    }
}

// ==========================================
// SORT DROPDOWN HANDLERS
// ==========================================

function initSortHandlers() {
    const sortOptions = document.querySelectorAll('#sortOptions .dropdown-option');

    const activeSort = (IDCardApp._ts && IDCardApp._ts.currentSort) ? IDCardApp._ts.currentSort : 'sr-asc';
    sortOptions.forEach(option => {
        option.classList.remove('selected');
        if ((option.getAttribute('data-value') || '') === activeSort) {
            option.classList.add('selected');
            const sortToggle = document.getElementById('sortToggle');
            if (sortToggle) {
                const icon = '<i class="fa-solid fa-sort"></i> ';
                const chevron = ' <i class="fa-solid fa-chevron-down"></i>';
                sortToggle.innerHTML = icon + option.textContent.trim() + chevron;
            }
        }
    });
    
    sortOptions.forEach(option => {
        option.addEventListener('click', function() {
            const value = this.getAttribute('data-value');
            if (typeof IDCardApp.sortRows === 'function') {
                IDCardApp.sortRows(value);
            }
            
            const sortToggle = document.getElementById('sortToggle');
            if (sortToggle) {
                const icon = '<i class="fa-solid fa-sort"></i> ';
                const chevron = ' <i class="fa-solid fa-chevron-down"></i>';
                sortToggle.innerHTML = icon + this.textContent.trim() + chevron;
            }
            
            sortOptions.forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            updateClearFiltersVisibility();
        });
    });
}

// ==========================================
// ROWS PER PAGE HANDLERS
// ==========================================

function initRowsPerPageHandlers() {
    const rowsOptions = document.querySelectorAll('#rowsOptions .dropdown-option');
    
    rowsOptions.forEach(option => {
        option.addEventListener('click', function() {
            const value = this.getAttribute('data-value');
            if (typeof IDCardApp.setRowsPerPage === 'function') {
                IDCardApp.setRowsPerPage(value);
            }
            
            const rowsSelectedText = document.getElementById('rowsSelectedText');
            if (rowsSelectedText) {
                rowsSelectedText.textContent = value;
            }
            
            rowsOptions.forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
        });
    });
}

// ==========================================
// IMAGE SORT HELPERS
// ==========================================

/** Update the image sort button text to show the active filter */
function updateImageSortBtnText(columnName, conditionText) {
    var btn = document.getElementById('imageSortBtn');
    if (!btn) return;
    if (columnName && conditionText) {
        btn.innerHTML = '<i class="fa-solid fa-image"></i> ' + conditionText;
        btn.classList.add('filter-active');
        btn.title = 'Image filter: ' + columnName.toUpperCase() + '  ' + conditionText;
    } else {
        btn.innerHTML = '<i class="fa-solid fa-image"></i> Image Sort';
        btn.classList.remove('filter-active');
        btn.title = 'Filter by image status';
    }
}

/** Clear image sort filter  resets rows, button text, and state */
function clearImageSortFilter() {
    var imageSortColumn = document.getElementById('imageSortColumn');
    var imageSortCondition = document.getElementById('imageSortCondition');
    if (imageSortColumn) imageSortColumn.value = '';
    if (imageSortCondition) imageSortCondition.value = '';
    IDCardApp._activeImageSort = null;
    updateImageSortBtnText(null, null);
    updateClearFiltersVisibility();
}

// ==========================================
// IMAGE SORT MODAL
// ==========================================

function initImageSortModal() {
    const imageSortBtn = document.getElementById('imageSortBtn');
    const imageSortModalOverlay = document.getElementById('imageSortModalOverlay');
    const closeImageSortModalBtn = document.getElementById('closeImageSortModal');
    const clearImageSort = document.getElementById('clearImageSort');
    const applyImageSort = document.getElementById('applyImageSort');
    const imageSortColumn = document.getElementById('imageSortColumn');
    const imageSortCondition = document.getElementById('imageSortCondition');
    
    function openImageSortModal() {
        if (imageSortModalOverlay) {
            imageSortModalOverlay.classList.add('active');
            document.body.style.overflow = 'hidden'; // Lock body scroll
        }
    }
    
    function closeImageSortModalFn() {
        if (imageSortModalOverlay) {
            imageSortModalOverlay.classList.remove('active');
            document.body.style.overflow = ''; // Restore body scroll
        }
    }
    
    // Open button
    if (imageSortBtn) {
        imageSortBtn.addEventListener('click', openImageSortModal);
    }
    
    // Close button (X in header)
    if (closeImageSortModalBtn) {
        closeImageSortModalBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            closeImageSortModalFn();
        });
    }
    
    // Click outside to close  disabled to prevent accidental closure
    if (imageSortModalOverlay) {
        // Disabled
    }
    
    if (clearImageSort) {
        clearImageSort.addEventListener('click', function() {
            clearImageSortFilter();
            closeImageSortModalFn();
            // Re-apply filters pipeline to restore correct row visibility
            applyClassSectionFilters();
            if (typeof showToast === 'function') showToast('Image filter cleared');
        });
    }
    
    if (applyImageSort) {
        applyImageSort.addEventListener('click', function() {
            const columnName = imageSortColumn?.value;
            const condition = imageSortCondition?.value;
            
            if (!columnName) {
                if (typeof showToast === 'function') showToast('Please select an image column', 'error');
                return;
            }
            
            if (!condition) {
                if (typeof showToast === 'function') showToast('Please select a condition', 'error');
                return;
            }
            
            const conditionText = condition === 'complete' ? 'Complete' : 
                                  condition === 'pending' ? 'Pending' : 'Incomplete';

            // Track active image sort state and update button text
            IDCardApp._activeImageSort = { column: columnName, condition: condition };
            updateImageSortBtnText(columnName, conditionText);
            updateClearFiltersVisibility();
            
            closeImageSortModalFn();

            // Use central filter pipeline so image sort works WITH other filters
            applyClassSectionFilters();

            if (typeof showToast === 'function') {
                showToast(`Filtering by ${conditionText} images in "${columnName.toUpperCase()}"`);
            }
        });
    }
}

// ==========================================
// EXPORTS
// ==========================================

IDCardApp.initFilterHandlers = initFilterHandlers;
IDCardApp.initSortHandlers = initSortHandlers;
IDCardApp.initRowsPerPageHandlers = initRowsPerPageHandlers;
IDCardApp.initImageSortModal = initImageSortModal;
IDCardApp.populateFilterOptions = populateFilterOptions;
IDCardApp.forceRefreshFilterOptions = forceRefreshFilterOptions;
IDCardApp.applyClassSectionFilters = applyClassSectionFilters;
IDCardApp.clearImageSortFilter = clearImageSortFilter;
IDCardApp.updateClearFiltersVisibility = updateClearFiltersVisibility;
IDCardApp.getClassSectionColumnIndices = getClassSectionColumnIndices;

})();
