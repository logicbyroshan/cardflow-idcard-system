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
// ==========================================

// Current filter values
let currentClassFilter = 'all';
let currentSectionFilter = 'all';

function initFilterHandlers() {
    // Populate filter options from table data
    populateFilterOptions();
    
    // Attach click handlers to filter options
    attachClassFilterHandlers();
    attachSectionFilterHandlers();
}

function populateFilterOptions() {
    const tableBody = document.getElementById('cardsTableBody');
    if (!tableBody) {
        return;
    }
    
    const rows = tableBody.querySelectorAll('tr[data-card-id]');
    const classValues = new Set();
    const sectionValues = new Set();
    
    // Get header indices for Class and Section columns
    const headerRow = document.querySelector('#data-table thead tr');
    if (!headerRow) {
        return;
    }
    
    const headers = headerRow.querySelectorAll('th');
    let classColIndex = -1;
    let sectionColIndex = -1;
    
    headers.forEach((header, index) => {
        // Use data-field-name attribute if available, otherwise use text content
        const fieldName = header.getAttribute('data-field-name') || header.textContent.trim();
        const fieldNameUpper = fieldName.toUpperCase();
        
        // Match CLASS or similar names
        if (classColIndex === -1 && (fieldNameUpper === 'CLASS' || fieldNameUpper === 'STD' || fieldNameUpper === 'STANDARD' || fieldNameUpper === 'GRADE' || fieldNameUpper.includes('CLASS'))) {
            classColIndex = index;
        }
        // Match SECTION or similar names
        if (sectionColIndex === -1 && (fieldNameUpper === 'SECTION' || fieldNameUpper === 'SEC' || fieldNameUpper === 'DIV' || fieldNameUpper === 'DIVISION' || fieldNameUpper.includes('SECTION'))) {
            sectionColIndex = index;
        }
    });
    
    // Collect unique values from rows
    rows.forEach((row, rowIndex) => {
        const cells = row.querySelectorAll('td');
        
        if (classColIndex >= 0 && classColIndex < cells.length) {
            // Get the text content, handling span inside cell
            const cell = cells[classColIndex];
            const cellValue = cell.querySelector('.cell-value');
            const classVal = (cellValue ? cellValue.textContent : cell.textContent).trim();
            if (classVal && classVal !== '-' && classVal !== '') {
                classValues.add(classVal);
            }
        }
        
        if (sectionColIndex >= 0 && sectionColIndex < cells.length) {
            const cell = cells[sectionColIndex];
            const cellValue = cell.querySelector('.cell-value');
            const sectionVal = (cellValue ? cellValue.textContent : cell.textContent).trim();
            if (sectionVal && sectionVal !== '-' && sectionVal !== '') {
                sectionValues.add(sectionVal);
            }
        }
    });
    
    // Populate Class dropdown
    const classOptionsContainer = document.getElementById('classFilterOptions');
    if (classOptionsContainer && classValues.size > 0) {
        // Keep "All Classes" option, clear others
        const allOption = classOptionsContainer.querySelector('[data-value="all"]');
        classOptionsContainer.innerHTML = '';
        if (allOption) {
            classOptionsContainer.appendChild(allOption);
        } else {
            const opt = document.createElement('div');
            opt.className = 'dropdown-option selected';
            opt.setAttribute('data-value', 'all');
            opt.textContent = 'All Classes';
            classOptionsContainer.appendChild(opt);
        }
        
        const sortedClasses = Array.from(classValues).sort((a, b) => {
            // Try numeric sort first (for roman numerals, convert)
            const romanToNum = {'I':1,'II':2,'III':3,'IV':4,'V':5,'VI':6,'VII':7,'VIII':8,'IX':9,'X':10,'XI':11,'XII':12};
            const numA = romanToNum[a.toUpperCase()] || parseInt(a) || 999;
            const numB = romanToNum[b.toUpperCase()] || parseInt(b) || 999;
            return numA - numB;
        });
        
        sortedClasses.forEach(classVal => {
            const option = document.createElement('div');
            option.className = 'dropdown-option';
            option.setAttribute('data-value', classVal);
            option.textContent = classVal;
            classOptionsContainer.appendChild(option);
        });
    }
    
    // Populate Section dropdown
    const sectionOptionsContainer = document.getElementById('sectionFilterOptions');
    if (sectionOptionsContainer && sectionValues.size > 0) {
        // Keep "All Sections" option, clear others
        const allOption = sectionOptionsContainer.querySelector('[data-value="all"]');
        sectionOptionsContainer.innerHTML = '';
        if (allOption) {
            sectionOptionsContainer.appendChild(allOption);
        } else {
            const opt = document.createElement('div');
            opt.className = 'dropdown-option selected';
            opt.setAttribute('data-value', 'all');
            opt.textContent = 'All Sections';
            sectionOptionsContainer.appendChild(opt);
        }
        
        const sortedSections = Array.from(sectionValues).sort();
        
        sortedSections.forEach(sectionVal => {
            const option = document.createElement('div');
            option.className = 'dropdown-option';
            option.setAttribute('data-value', sectionVal);
            option.textContent = sectionVal;
            sectionOptionsContainer.appendChild(option);
        });
    }
    
    // Attach click handlers to the new options
    attachClassFilterHandlers();
    attachSectionFilterHandlers();
}

function attachClassFilterHandlers() {
    // Use event delegation instead of cloning to avoid removing existing dropdown listeners
    const classOptionsContainer = document.getElementById('classFilterOptions');
    
    if (classOptionsContainer && !classOptionsContainer.hasAttribute('data-filter-initialized')) {
        classOptionsContainer.setAttribute('data-filter-initialized', 'true');
        
        classOptionsContainer.addEventListener('click', function(e) {
            const option = e.target.closest('.dropdown-option');
            if (!option) return;
            
            currentClassFilter = option.getAttribute('data-value');
            
            const filterText = document.getElementById('classFilterText');
            if (filterText) {
                filterText.textContent = currentClassFilter === 'all' ? 'Class' : currentClassFilter;
            }
            
            classOptionsContainer.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            
            // Propagate: rebuild Section dropdown based on selected class
            updateSectionOptionsForClass(currentClassFilter);
            
            // Apply filters
            applyClassSectionFilters();
        });
    }
}

function attachSectionFilterHandlers() {
    // Use event delegation instead of cloning to avoid removing existing dropdown listeners
    const sectionOptionsContainer = document.getElementById('sectionFilterOptions');
    
    if (sectionOptionsContainer && !sectionOptionsContainer.hasAttribute('data-filter-initialized')) {
        sectionOptionsContainer.setAttribute('data-filter-initialized', 'true');
        
        sectionOptionsContainer.addEventListener('click', function(e) {
            const option = e.target.closest('.dropdown-option');
            if (!option) return;
            
            currentSectionFilter = option.getAttribute('data-value');
            
            const filterText = document.getElementById('sectionFilterText');
            if (filterText) {
                filterText.textContent = currentSectionFilter === 'all' ? 'Section' : currentSectionFilter;
            }
            
            sectionOptionsContainer.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            
            // Apply filters
            applyClassSectionFilters();
        });
    }
}

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

/**
 * Rebuild the Section dropdown to show only sections that exist
 * for the given class. If selectedClass is 'all', show all sections.
 * If the currently selected section is not available, reset to 'all'.
 */
function updateSectionOptionsForClass(selectedClass) {
    const sectionOptionsContainer = document.getElementById('sectionFilterOptions');
    if (!sectionOptionsContainer) return;

    const { classIndex, sectionIndex } = getClassSectionColumnIndices();
    if (sectionIndex < 0) return;

    const tableBody = document.getElementById('cardsTableBody');
    if (!tableBody) return;

    const rows = tableBody.querySelectorAll('tr[data-card-id]');
    const sectionValues = new Set();

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');

        // If filtering by a specific class, only collect sections from matching rows
        if (selectedClass !== 'all' && classIndex >= 0 && classIndex < cells.length) {
            const classCell = cells[classIndex];
            const classSpan = classCell.querySelector('.cell-value');
            const classVal = (classSpan ? classSpan.textContent : classCell.textContent).trim();
            if (classVal !== selectedClass) return; // skip non-matching rows
        }

        if (sectionIndex < cells.length) {
            const secCell = cells[sectionIndex];
            const secSpan = secCell.querySelector('.cell-value');
            const secVal = (secSpan ? secSpan.textContent : secCell.textContent).trim();
            if (secVal && secVal !== '-' && secVal !== '') {
                sectionValues.add(secVal);
            }
        }
    });

    // Rebuild section dropdown
    sectionOptionsContainer.innerHTML = '';

    const allOpt = document.createElement('div');
    allOpt.className = 'dropdown-option' + (currentSectionFilter === 'all' ? ' selected' : '');
    allOpt.setAttribute('data-value', 'all');
    allOpt.textContent = 'All Sections';
    sectionOptionsContainer.appendChild(allOpt);

    const sortedSections = Array.from(sectionValues).sort();

    sortedSections.forEach(secVal => {
        const option = document.createElement('div');
        option.className = 'dropdown-option' + (currentSectionFilter === secVal ? ' selected' : '');
        option.setAttribute('data-value', secVal);
        option.textContent = secVal;
        sectionOptionsContainer.appendChild(option);
    });

    // If the currently selected section is no longer available, reset to 'all'
    if (currentSectionFilter !== 'all' && !sectionValues.has(currentSectionFilter)) {
        currentSectionFilter = 'all';
        const filterText = document.getElementById('sectionFilterText');
        if (filterText) {
            filterText.textContent = 'Section';
        }
    }
}

function applyClassSectionFilters() {
    const { classIndex, sectionIndex } = getClassSectionColumnIndices();
    
    // Get all rows
    const tableBody = document.getElementById('cardsTableBody');
    if (!tableBody) {
        return;
    }
    
    const rows = tableBody.querySelectorAll('tr[data-card-id]');
    let visibleCount = 0;
    
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        let showRow = true;
        
        // Check class filter
        if (currentClassFilter !== 'all' && classIndex >= 0 && classIndex < cells.length) {
            const cell = cells[classIndex];
            const cellValueSpan = cell.querySelector('.cell-value');
            const val = (cellValueSpan ? cellValueSpan.textContent : cell.textContent).trim();
            if (val !== currentClassFilter) {
                showRow = false;
            }
        }
        
        // Check section filter
        if (showRow && currentSectionFilter !== 'all' && sectionIndex >= 0 && sectionIndex < cells.length) {
            const cell = cells[sectionIndex];
            const cellValueSpan = cell.querySelector('.cell-value');
            const val = (cellValueSpan ? cellValueSpan.textContent : cell.textContent).trim();
            if (val !== currentSectionFilter) {
                showRow = false;
            }
        }
        
        // Also apply search query if exists (get from table module's state)
        const searchQuery = window.IDCardApp?.tableState?.searchQuery || '';
        if (showRow && searchQuery) {
            const rowText = row.textContent.toLowerCase();
            if (!rowText.includes(searchQuery.toLowerCase())) {
                showRow = false;
            }
        }
        
        row.style.display = showRow ? '' : 'none';
        if (showRow) visibleCount++;
    });
    
    // Update pagination info
    updateFilteredCount(visibleCount);
}

function updateFilteredCount(count) {
    const showingCount = document.getElementById('showing-count');
    if (showingCount) {
        showingCount.textContent = count;
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
