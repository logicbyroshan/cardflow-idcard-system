// ID Card Actions - Search Module
// Contains: Search input, filter dropdown, sort dropdown, rows per page, search all modal

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
                // Use table module's searchRows function
                if (typeof searchRows === 'function') {
                    searchRows(query);
                } else if (typeof window.searchRows === 'function') {
                    window.searchRows(query);
                } else {
                    // Fallback to old method - update table state
                    if (window.IDCardApp?.tableState) {
                        window.IDCardApp.tableState.searchQuery = query;
                    }
                    applyClassSectionFilters();
                }
            }, 300);
        });
        
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                clearTimeout(searchTimeout);
                const query = this.value.trim();
                if (typeof searchRows === 'function') {
                    searchRows(query);
                } else if (typeof window.searchRows === 'function') {
                    window.searchRows(query);
                } else {
                    if (window.IDCardApp?.tableState) {
                        window.IDCardApp.tableState.searchQuery = query;
                    }
                    applyClassSectionFilters();
                }
            }
        });
        
        if (searchClearBtn) {
            searchClearBtn.addEventListener('click', function() {
                searchInput.value = '';
                updateClearButton();
                if (typeof searchRows === 'function') {
                    searchRows('');
                } else if (typeof window.searchRows === 'function') {
                    window.searchRows('');
                } else {
                    if (window.IDCardApp?.tableState) {
                        window.IDCardApp.tableState.searchQuery = '';
                    }
                    applyClassSectionFilters();
                }
                searchInput.focus();
            });
        }
    }
}

// ==========================================
// CLASS AND SECTION FILTER HANDLERS
// Phase 4: Updated to use text input filters instead of dropdowns
// ==========================================

// Current filter values (exposed globally for table module integration)
let currentClassFilter = '';
let currentSectionFilter = '';
window.currentClassFilter = '';
window.currentSectionFilter = '';

function initFilterHandlers() {
    initClassFilterDropdown();
    initSectionFilterDropdown();
    // Populate options from table data after a short delay to let table render
    setTimeout(populateFilterOptions, 500);
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
        window.currentClassFilter = val;
        text.textContent = opt.textContent.trim();
        dropdown.classList.remove('open');
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
        window.currentSectionFilter = val;
        text.textContent = opt.textContent.trim();
        dropdown.classList.remove('open');
        applyClassSectionFilters();
    });

    document.addEventListener('click', function(e) {
        if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
    });
}

/**
 * Scan table rows and populate class/section filter dropdowns with unique values.
 * Called after table renders and also after any data change (add/edit/delete/upload).
 */
function populateFilterOptions() {
    const { classIndex, sectionIndex } = getClassSectionColumnIndices();
    const tableBody = document.getElementById('cardsTableBody');
    if (!tableBody) return;

    const rows = tableBody.querySelectorAll('tr[data-card-id]');
    const classValues = new Set();
    const sectionValues = new Set();

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (classIndex >= 0 && classIndex < cells.length) {
            const cell = cells[classIndex];
            const span = cell.querySelector('.cell-value');
            const val = (span ? span.textContent : cell.textContent).trim();
            if (val) classValues.add(val);
        }
        if (sectionIndex >= 0 && sectionIndex < cells.length) {
            const cell = cells[sectionIndex];
            const span = cell.querySelector('.cell-value');
            const val = (span ? span.textContent : cell.textContent).trim();
            if (val) sectionValues.add(val);
        }
    });

    // Populate class dropdown
    const classOptions = document.getElementById('classFilterOptions');
    if (classOptions) {
        const sorted = [...classValues].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        classOptions.innerHTML = '<div class="dropdown-option selected" data-value="">All Classes</div>' +
            sorted.map(v => `<div class="dropdown-option" data-value="${v}">${v}</div>`).join('');
        // Restore current selection if still valid
        if (currentClassFilter) {
            const match = classOptions.querySelector(`[data-value="${currentClassFilter}"]`);
            if (match) {
                classOptions.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
                match.classList.add('selected');
            } else {
                // Previous value no longer exists, reset
                currentClassFilter = '';
                const text = document.getElementById('classFilterText');
                if (text) text.textContent = 'All Classes';
            }
        }
    }

    // Populate section dropdown
    const sectionOptions = document.getElementById('sectionFilterOptions');
    if (sectionOptions) {
        const sorted = [...sectionValues].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        sectionOptions.innerHTML = '<div class="dropdown-option selected" data-value="">All Sections</div>' +
            sorted.map(v => `<div class="dropdown-option" data-value="${v}">${v}</div>`).join('');
        if (currentSectionFilter) {
            const match = sectionOptions.querySelector(`[data-value="${currentSectionFilter}"]`);
            if (match) {
                sectionOptions.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
                match.classList.add('selected');
            } else {
                currentSectionFilter = '';
                const text = document.getElementById('sectionFilterText');
                if (text) text.textContent = 'All Sections';
            }
        }
    }
}

// Make populateFilterOptions globally available so table module can call it after data changes
window.populateFilterOptions = populateFilterOptions;

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
    // When a class/section filter is active, we must load ALL rows from the
    // server first — otherwise we'd only filter the ~200 rows in the DOM
    // while thousands more remain unloaded.
    const hasFilter = currentClassFilter || currentSectionFilter;
    const hasMore = window.lazyLoadState && window.lazyLoadState.hasMore;
    
    if (hasFilter && hasMore && typeof window.loadAllData === 'function') {
        // loadAllData is async — load everything then apply filters
        window.loadAllData().then(() => {
            // Re-read allRows after all data is loaded
            if (typeof initializeRows === 'function') initializeRows();
            else if (typeof window.initializeRows === 'function') window.initializeRows();
            // Now apply the main filter pipeline
            if (typeof applyFiltersAndSort === 'function') {
                applyFiltersAndSort();
            } else if (typeof window.applyFiltersAndSort === 'function') {
                window.applyFiltersAndSort();
            }
            // Re-populate filter options with all data now loaded
            populateFilterOptions();
        });
    } else {
        // All data already loaded or no filter — apply directly
        if (typeof applyFiltersAndSort === 'function') {
            applyFiltersAndSort();
        } else if (typeof window.applyFiltersAndSort === 'function') {
            window.applyFiltersAndSort();
        }
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
            if (typeof sortRows === 'function') {
                sortRows(value);
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
            if (typeof setRowsPerPage === 'function') {
                setRowsPerPage(value);
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
        
        fetch(`/panel/api/table/${tableId}/cards/search/?q=${encodeURIComponent(query)}`)
            .then(response => response.json())
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
        searchAllModalOverlay.addEventListener('click', function(e) {
            if (e.target === this) closeSearchAllModalFn();
        });
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
    
    // Expose close function
    window.closeSearchAllModal = closeSearchAllModalFn;
}

function displaySearchResults(results, query, container, closeModalFn) {
    if (!container) return;
    
    if (results.length === 0) {
        container.innerHTML = `
            <div class="search-no-results">
                <i class="fa-solid fa-search"></i>
                <p>No results found for "${query}"</p>
            </div>
        `;
        return;
    }
    
    let html = `<div class="search-results-count">${results.length} result${results.length > 1 ? 's' : ''} found</div>`;
    html += '<div class="search-results-list">';
    
    results.forEach(result => {
        const photoHtml = result.photo 
            ? `<img src="${result.photo}" class="search-result-photo" alt="Photo">`
            : `<div class="search-result-photo-placeholder"><i class="fa-solid fa-user"></i></div>`;
        
        html += `
            <div class="search-result-item" data-card-id="${result.id}" data-status="${result.status}">
                ${photoHtml}
                <div class="search-result-info">
                    <div class="search-result-name">${result.display_name}</div>
                    <div class="search-result-match">Match: <strong>${result.matched_field}</strong> = "${result.matched_value}"</div>
                    <span class="search-result-status ${result.status}">${result.status_display}</span>
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
    
    // Click outside to close
    if (imageSortModalOverlay) {
        imageSortModalOverlay.addEventListener('click', function(e) {
            if (e.target === this) closeImageSortModalFn();
        });
    }
    
    if (clearImageSort) {
        clearImageSort.addEventListener('click', function() {
            if (imageSortColumn) imageSortColumn.value = '';
            if (imageSortCondition) imageSortCondition.value = '';
            
            const rows = document.querySelectorAll('#cardsTableBody tr[data-card-id]');
            rows.forEach(row => {
                row.style.display = '';
            });
            
            closeImageSortModalFn();
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
            
            const rows = document.querySelectorAll('#cardsTableBody tr[data-card-id]');
            let visibleCount = 0;
            
            rows.forEach(row => {
                const imageCell = row.querySelector(`td.image-cell[data-field-name="${columnName}"]`);
                
                if (!imageCell) {
                    row.style.display = '';
                    return;
                }
                
                const hasImage = imageCell.querySelector('img.table-image') !== null;
                const originalValue = imageCell.getAttribute('data-original-value') || '';
                const isPending = originalValue.startsWith('PENDING:');
                const hasColorfulPlaceholder = imageCell.querySelector('.no-image.colorful-placeholder') !== null;
                const hasPendingPlaceholder = imageCell.querySelector('.no-image.pending-placeholder') !== null;
                
                let showRow = false;
                
                switch (condition) {
                    case 'complete':
                        // Has actual image uploaded (not pending, not placeholder)
                        showRow = hasImage && originalValue.trim() !== '' && !isPending;
                        break;
                    case 'pending':
                        // Has PENDING: prefix OR has pending placeholder
                        showRow = isPending || hasPendingPlaceholder;
                        break;
                    case 'incomplete':
                        // No image path at all (colorful placeholder)
                        showRow = hasColorfulPlaceholder || (!hasImage && !isPending && originalValue.trim() === '');
                        break;
                }
                
                row.style.display = showRow ? '' : 'none';
                if (showRow) visibleCount++;
            });
            
            closeImageSortModalFn();
            
            const conditionText = condition === 'complete' ? 'Complete' : 
                                  condition === 'pending' ? 'Pending' : 'Incomplete';
            if (typeof showToast === 'function') {
                showToast(`Showing ${visibleCount} cards with ${conditionText} images in "${columnName.toUpperCase()}"`);
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

// Expose globally
window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.initSearchModule = initSearchModule;
window.IDCardApp.initSearchAllModal = initSearchAllModal;
window.IDCardApp.initImageSortModal = initImageSortModal;
