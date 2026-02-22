// ID Card Actions - Search Module
// Contains: Search input, filter dropdown, sort dropdown, rows per page, search all modal

(function() {
'use strict';

// ==========================================
// SEARCH STATE (searchQuery is defined in table module)
// ==========================================

// ==========================================
// SEARCH INPUT HANDLERS
// ==========================================

function initSearchHandlers() {
    const searchInput = document.getElementById('searchInput');
    const searchClearBtn = document.getElementById('searchClearBtn');
    
    if (searchInput) {
        let searchTimeout;
        
        function updateClearButton() {
            if (searchClearBtn) {
                searchClearBtn.style.display = searchInput.value.trim() ? 'flex' : 'none';
            }
        }
        
        searchInput.addEventListener('input', function() {
            updateClearButton();
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const query = this.value.trim();
                if (typeof window.alpineUpdateSearch === 'function') window.alpineUpdateSearch(query);
                if (typeof IDCardApp.searchRows === 'function') {
                    IDCardApp.searchRows(query);
                } else {
                    applyClassSectionFilters();
                }
            }, 300);
        });
        
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                clearTimeout(searchTimeout);
                const query = this.value.trim();
                if (typeof IDCardApp.searchRows === 'function') {
                    IDCardApp.searchRows(query);
                } else {
                    applyClassSectionFilters();
                }
            }
        });
        
        if (searchClearBtn) {
            searchClearBtn.addEventListener('click', function() {
                searchInput.value = '';
                updateClearButton();
                if (typeof window.alpineUpdateSearch === 'function') window.alpineUpdateSearch('');
                if (typeof IDCardApp.searchRows === 'function') {
                    IDCardApp.searchRows('');
                } else {
                    applyClassSectionFilters();
                }
                searchInput.focus();
            });
        }
    }
}

// ==========================================
// CLASS AND SECTION FILTER HANDLERS
// ==========================================

// Current filter values (on IDCardApp namespace for cross-module access)
let currentClassFilter = '';
let currentSectionFilter = '';
IDCardApp.currentClassFilter = '';
IDCardApp.currentSectionFilter = '';

function initFilterHandlers() {
    initClassFilterDropdown();
    initSectionFilterDropdown();
    initClearFiltersButton();
    // Populate options from table data after a short delay to let table render
    setTimeout(populateFilterOptions, 500);
}

/** Show/hide the clear-filters button based on whether any filter is active */
function updateClearFiltersVisibility() {
    const btn = document.getElementById('clearFiltersBtn');
    if (!btn) return;
    const hasFilter = currentClassFilter || currentSectionFilter || IDCardApp._activeImageSort;
    if (hasFilter) {
        btn.classList.add('visible');
    } else {
        btn.classList.remove('visible');
    }
}

/** Clear all class/section filters and refresh */
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
        // Reset image sort filter
        clearImageSortFilter();
        // Hide clear button
        updateClearFiltersVisibility();
        // Refresh table
        applyClassSectionFilters();
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
        // Close other filter dropdown
        const other = document.getElementById('sectionFilterDropdown');
        if (other) other.classList.remove('open');
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
        updateClearFiltersVisibility();
        applyClassSectionFilters();
    });

    document.addEventListener('click', function(e) {
        if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
    });
}

function initSectionFilterDropdown() {
    const dropdown = document.getElementById('sectionFilterDropdown');
    const toggle = document.getElementById('sectionFilterToggle');
    const options = document.getElementById('sectionFilterOptions');
    const text = document.getElementById('sectionFilterText');
    if (!dropdown || !toggle || !options) return;

    toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        // Close other filter dropdown
        const other = document.getElementById('classFilterDropdown');
        if (other) other.classList.remove('open');
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
        updateClearFiltersVisibility();
        applyClassSectionFilters();
    });

    document.addEventListener('click', function(e) {
        if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
    });
}

/**
 * Populate class/section filter dropdowns from the server-side API.
 * Calls /panel/api/table/{id}/filter-options/ to get ALL distinct values from the database,
 * not just from loaded rows.
 */
function populateFilterOptions() {
    // Virtual table mode: table-render.js calls _populateFilterOptions()
    // after every fetch — no DOM scanning needed here.
    if (window.USE_VIRTUAL_TABLE && window.IDCardApp && window.IDCardApp.virtualTable) {
        return;
    }

    var tableId = (IDCardApp.lazyLoadState && IDCardApp.lazyLoadState.tableId) ||
                  (typeof TABLE_ID !== 'undefined' ? TABLE_ID : null);
    if (!tableId) return;

    var status = (IDCardApp.lazyLoadState && IDCardApp.lazyLoadState.currentStatus) ||
                 (typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : '');

    ApiClient.get('/panel/api/table/' + tableId + '/filter-options/?status=' + encodeURIComponent(status))
        .then(function(data) {
            if (!data || !data.success) return;

            var classValues = data.class_values || [];
            var sectionValues = data.section_values || [];

            // Populate class dropdown
            var classOptions = document.getElementById('classFilterOptions');
            if (classOptions) {
                var sorted = classValues; // Already sorted by server
                classOptions.innerHTML = '<div class="dropdown-option selected" data-value="">All Classes</div>' +
                    sorted.map(function(v) { return '<div class="dropdown-option" data-value="' + v + '">' + v + '</div>'; }).join('');
                if (currentClassFilter) {
                    var match = classOptions.querySelector('[data-value="' + currentClassFilter + '"]');
                    if (match) {
                        classOptions.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
                        match.classList.add('selected');
                    } else {
                        currentClassFilter = '';
                        IDCardApp.currentClassFilter = '';
                        var text = document.getElementById('classFilterText');
                        if (text) text.textContent = 'All Classes';
                    }
                }
            }

            // Populate section dropdown
            var sectionOptions = document.getElementById('sectionFilterOptions');
            if (sectionOptions) {
                var sortedS = sectionValues;
                sectionOptions.innerHTML = '<div class="dropdown-option selected" data-value="">All Sections</div>' +
                    sortedS.map(function(v) { return '<div class="dropdown-option" data-value="' + v + '">' + v + '</div>'; }).join('');
                if (currentSectionFilter) {
                    var matchS = sectionOptions.querySelector('[data-value="' + currentSectionFilter + '"]');
                    if (matchS) {
                        sectionOptions.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
                        matchS.classList.add('selected');
                    } else {
                        currentSectionFilter = '';
                        IDCardApp.currentSectionFilter = '';
                        var textS = document.getElementById('sectionFilterText');
                        if (textS) textS.textContent = 'All Sections';
                    }
                }
            }
        })
        .catch(function(err) {
            console.error('Failed to load filter options:', err);
        });
}

// Expose on IDCardApp namespace for table module integration
IDCardApp.populateFilterOptions = populateFilterOptions;

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
    // Virtual table mode: server handles search/class/section filtering.
    // Just trigger a single re-fetch — the JSON API includes filter params.
    // Image-sort is applied client-side inside the virtual table's _applyFilters().
    if (window.USE_VIRTUAL_TABLE && typeof IDCardApp.applyFiltersAndSort === 'function') {
        IDCardApp.applyFiltersAndSort();
        return;
    }

    // Server-side filter: reset table and reload with current filter params.
    // The server handles search, class, section, image sort, and sort order.
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
// SEARCH ALL MODAL
// ==========================================

let searchAllTimeout = null;

function initSearchAllModal() {
    const searchAllBtn = document.getElementById('searchAllBtn');
    const searchAllModalOverlay = document.getElementById('searchAllModalOverlay');
    const closeSearchAllModal = document.getElementById('closeSearchAllModal');
    const searchAllInput = document.getElementById('searchAllInput');
    const clearSearchInput = document.getElementById('clearSearchInput');
    const searchResultsContainer = document.getElementById('searchResultsContainer');
    
    function openSearchAllModal() {
        if (searchAllModalOverlay) {
            searchAllModalOverlay.classList.add('active');
            document.body.style.overflow = 'hidden'; // Lock body scroll
            setTimeout(() => {
                if (searchAllInput) searchAllInput.focus();
            }, 100);
        }
    }
    
    function closeSearchAllModalFn() {
        if (searchAllModalOverlay) {
            searchAllModalOverlay.classList.remove('active');
            document.body.style.overflow = ''; // Restore body scroll
        }
        if (searchAllInput) searchAllInput.value = '';
        if (clearSearchInput) clearSearchInput.style.display = 'none';
        if (searchResultsContainer) {
            searchResultsContainer.innerHTML = `
                <div class="search-placeholder">
                    <i class="fa-solid fa-search"></i>
                    <p>Type to search across all lists</p>
                </div>
            `;
        }
    }
    
    function performSearch(query) {
        const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', 'error');
            return;
        }
        
        ApiClient.get(`/panel/api/table/${tableId}/cards/search/?q=${encodeURIComponent(query)}`)
            .then(data => {
                if (data.success) {
                    displaySearchResults(data.results, query, searchResultsContainer, closeSearchAllModalFn);
                } else {
                    if (searchResultsContainer) {
                        searchResultsContainer.innerHTML = `
                            <div class="search-no-results">
                                <i class="fa-solid fa-exclamation-circle"></i>
                                <p>Error: ${data.message}</p>
                            </div>
                        `;
                    }
                }
            })
            .catch(error => {
                console.error('Search error:', error);
                if (searchResultsContainer) {
                    searchResultsContainer.innerHTML = `
                        <div class="search-no-results">
                            <i class="fa-solid fa-exclamation-circle"></i>
                            <p>Error searching. Please try again.</p>
                        </div>
                    `;
                }
            });
    }
    
    if (searchAllBtn) {
        searchAllBtn.addEventListener('click', openSearchAllModal);
    }
    
    if (closeSearchAllModal) {
        closeSearchAllModal.addEventListener('click', closeSearchAllModalFn);
    }
    
    if (searchAllModalOverlay) {
        // Disabled — prevent accidental closure on outside click
    }
    
    if (clearSearchInput) {
        clearSearchInput.addEventListener('click', function() {
            if (searchAllInput) searchAllInput.value = '';
            this.style.display = 'none';
            if (searchResultsContainer) {
                searchResultsContainer.innerHTML = `
                    <div class="search-placeholder">
                        <i class="fa-solid fa-search"></i>
                        <p>Type to search across all lists</p>
                    </div>
                `;
            }
            if (searchAllInput) searchAllInput.focus();
        });
    }
    
    if (searchAllInput) {
        searchAllInput.addEventListener('input', function() {
            const query = this.value.trim();
            
            if (clearSearchInput) {
                clearSearchInput.style.display = query.length > 0 ? 'flex' : 'none';
            }
            
            if (searchAllTimeout) clearTimeout(searchAllTimeout);
            
            if (query.length < 2) {
                if (searchResultsContainer) {
                    searchResultsContainer.innerHTML = `
                        <div class="search-placeholder">
                            <i class="fa-solid fa-search"></i>
                            <p>${query.length === 0 ? 'Type to search across all lists' : 'Enter at least 2 characters'}</p>
                        </div>
                    `;
                }
                return;
            }
            
            if (searchResultsContainer) {
                searchResultsContainer.innerHTML = `
                    <div class="search-loading">
                        <i class="fa-solid fa-spinner fa-spin"></i>
                        <p>Searching...</p>
                    </div>
                `;
            }
            
            searchAllTimeout = setTimeout(() => {
                performSearch(query);
            }, 300);
        });
    }
    
    // Expose close function on IDCardApp namespace
    IDCardApp.closeSearchAllModal = closeSearchAllModalFn;
}

function displaySearchResults(results, query, container, closeModalFn) {
    if (!container) return;
    const _esc = window.escapeHtml || function(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); };
    
    if (results.length === 0) {
        container.innerHTML = `
            <div class="search-no-results">
                <i class="fa-solid fa-search"></i>
                <p>No results found for "${_esc(query)}"</p>
            </div>
        `;
        return;
    }
    
    let html = `<div class="search-results-count">${results.length} result${results.length > 1 ? 's' : ''} found</div>`;
    html += '<div class="search-results-list">';
    
    results.forEach(result => {
        const photoHtml = result.photo 
            ? `<img src="${_esc(result.photo)}" class="search-result-photo" alt="Photo">`
            : `<div class="search-result-photo-placeholder"><i class="fa-solid fa-user"></i></div>`;
        
        html += `
            <div class="search-result-item" data-card-id="${result.id}" data-status="${_esc(result.status)}">
                ${photoHtml}
                <div class="search-result-info">
                    <div class="search-result-name">${_esc(result.display_name)}</div>
                    <div class="search-result-match">Match: <strong>${_esc(result.matched_field)}</strong> = "${_esc(result.matched_value)}"</div>
                    <span class="search-result-status ${_esc(result.status)}">${_esc(result.status_display)}</span>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
    
    container.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', function() {
            const cardId = this.getAttribute('data-card-id');
            const status = this.getAttribute('data-status');
            
            if (closeModalFn) closeModalFn();
            
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set('status', status);
            currentUrl.searchParams.set('highlight', cardId);
            window.location.href = currentUrl.toString();
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
        btn.title = 'Image filter: ' + columnName.toUpperCase() + ' — ' + conditionText;
    } else {
        btn.innerHTML = '<i class="fa-solid fa-image"></i> Image Sort';
        btn.classList.remove('filter-active');
        btn.title = 'Filter by image status';
    }
}

/** Clear image sort filter — resets rows, button text, and state */
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
    
    // Click outside to close — disabled to prevent accidental closure
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
// INITIALIZATION
// ==========================================

function initSearchModule() {
    initSearchHandlers();
    initFilterHandlers();
    initSortHandlers();
    initRowsPerPageHandlers();
    initSearchAllModal();
    initImageSortModal();
}

// Expose on IDCardApp namespace
window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.initSearchModule = initSearchModule;
window.IDCardApp.initSearchAllModal = initSearchAllModal;
window.IDCardApp.initImageSortModal = initImageSortModal;
window.IDCardApp.populateFilterOptions = populateFilterOptions;

})();
