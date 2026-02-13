// ID Card Actions - Table Management Module
// Contains: Pagination, lazy loading, row management, table rendering

// ==========================================
// STATE VARIABLES
// ==========================================
let allRows = [];
let filteredRows = [];
let currentPage = 1;
let rowsPerPage = 50;
let currentFilter = 'all';
let currentSort = 'sr-asc';
let searchQuery = '';
let currentFilterField = 'all';
let endlessScrollMode = true;

// Lazy loading state
const lazyLoadState = {
    isLoading: false,
    hasMore: false,
    totalCount: 0,
    loadedCount: 0,
    batchSize: 100,
    triggerOffset: 15,
    tableId: typeof TABLE_ID !== 'undefined' ? TABLE_ID : null,
    currentStatus: typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : 'pending'
};

// Expose state globally
window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.tableState = {
    get allRows() { return allRows; },
    get filteredRows() { return filteredRows; },
    get currentPage() { return currentPage; },
    set currentPage(val) { currentPage = val; },
    get rowsPerPage() { return rowsPerPage; },
    set rowsPerPage(val) { rowsPerPage = val; },
    get searchQuery() { return searchQuery; },
    set searchQuery(val) { searchQuery = val; },
    get lazyLoadState() { return lazyLoadState; }
};

// ==========================================
// INITIALIZE ROWS
// ==========================================

function initializeRows() {
    const tableBody = document.getElementById('cardsTableBody');
    if (!tableBody) return;
    allRows = Array.from(tableBody.querySelectorAll('tr[data-card-id]'));
    filteredRows = [...allRows];
}

// ==========================================
// LAZY LOAD STATE INITIALIZATION
// ==========================================

function earlyInitLazyLoadState() {
    const paginationBar = document.getElementById('paginationBar');
    if (paginationBar) {
        lazyLoadState.totalCount = parseInt(paginationBar.dataset.totalCount) || 0;
        lazyLoadState.hasMore = paginationBar.dataset.hasMore === 'true';
        lazyLoadState.loadedCount = parseInt(paginationBar.dataset.initialLoaded) || 0;
        if (!lazyLoadState.tableId && paginationBar.dataset.tableId) {
            lazyLoadState.tableId = parseInt(paginationBar.dataset.tableId);
        }
        if (paginationBar.dataset.status) {
            lazyLoadState.currentStatus = paginationBar.dataset.status;
        }
        // Disable bulk buttons early if no cards
        setTimeout(updateBulkActionButtons, 0);
    }
}

function initLazyLoadState() {
    const paginationBar = document.getElementById('paginationBar');
    if (paginationBar) {
        lazyLoadState.totalCount = parseInt(paginationBar.dataset.totalCount) || 0;
        lazyLoadState.hasMore = paginationBar.dataset.hasMore === 'true';
        lazyLoadState.loadedCount = parseInt(paginationBar.dataset.initialLoaded) || allRows.length;
        if (!lazyLoadState.tableId && paginationBar.dataset.tableId) {
            lazyLoadState.tableId = parseInt(paginationBar.dataset.tableId);
        }
        if (paginationBar.dataset.status) {
            lazyLoadState.currentStatus = paginationBar.dataset.status;
        }
    } else {
        lazyLoadState.loadedCount = allRows.length;
        lazyLoadState.totalCount = allRows.length;
        lazyLoadState.hasMore = false;
    }
    
    updateLazyLoadPaginationInfo();
    updateBulkActionButtons();
}

// ==========================================
// BULK ACTION BUTTONS STATE
// ==========================================

/**
 * Updates bulk action buttons (download, reupload) based on whether there are cards.
 * Disables these buttons when totalCount is 0.
 */
function updateBulkActionButtons() {
    const hasCards = lazyLoadState.totalCount > 0;
    
    // Get all bulk download/reupload buttons across all status action bars
    const bulkButtons = [
        // Pending
        'downloadImgBtn', 'downloadDocxBtn', 'downloadXlsxBtn', 'downloadPdfBtn', 'reuploadImageBtn',
        // Verified
        'downloadImgBtnV', 'downloadDocxBtnV', 'downloadXlsxBtnV', 'downloadPdfBtnV', 'reuploadImageBtnV',
        // Approved
        'downloadImgBtnA', 'downloadDocxBtnA', 'downloadXlsxBtnA', 'downloadPdfBtnA', 'reuploadImageBtnA', 'downloadCardBtn',
        // Download
        'downloadImgBtnD', 'downloadDocxBtnD', 'downloadXlsxBtnD', 'downloadPdfBtnD', 'reuploadImageBtnD',
        // Pool
        'downloadImgBtnP', 'downloadDocxBtnP', 'downloadXlsxBtnP', 'downloadPdfBtnP', 'reuploadImageBtnP'
    ];
    
    bulkButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.disabled = !hasCards;
            if (!hasCards) {
                btn.title = 'No data available';
            }
        }
    });
}

// Expose function for external calls (e.g., after status tab switch)
window.updateBulkActionButtons = updateBulkActionButtons;

// ==========================================
// DATE/NAME/SR HELPERS
// ==========================================

function getRowDate(row) {
    const cells = row.querySelectorAll('td');
    const dateCell = cells[cells.length - 2];
    if (!dateCell) return new Date(0);
    
    const dateText = dateCell.textContent.trim();
    const parsed = Date.parse(dateText.replace(/-/g, ' '));
    return isNaN(parsed) ? new Date(0) : new Date(parsed);
}

function getRowName(row) {
    const cells = row.querySelectorAll('td');
    if (cells.length > 2) {
        return cells[2].textContent.trim().toLowerCase();
    }
    return '';
}

function getRowSrNo(row) {
    const cells = row.querySelectorAll('td');
    if (cells.length > 1) {
        return parseInt(cells[1].textContent.trim()) || 0;
    }
    return 0;
}

function getFieldColumnIndex(fieldName) {
    const headerRow = document.querySelector('.idcard-table thead tr');
    if (!headerRow) return -1;
    
    const headers = headerRow.querySelectorAll('th');
    for (let i = 0; i < headers.length; i++) {
        const headerText = headers[i].textContent.trim().toUpperCase();
        if (headerText === fieldName.toUpperCase()) {
            return i;
        }
    }
    return -1;
}

// ==========================================
// FILTER AND SORT
// ==========================================

function searchRows(query) {
    searchQuery = query.toLowerCase().trim();
    applyFiltersAndSort();
}

function filterByField(fieldName) {
    currentFilterField = fieldName;
    applyFiltersAndSort();
}

function sortRows(sortValue) {
    currentSort = sortValue;
    applyFiltersAndSort();
}

function applyFiltersAndSort() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    
    const filterColumnIndex = currentFilterField !== 'all' ? getFieldColumnIndex(currentFilterField) : -1;
    
    // Get class/section filter state from search module (exposed globally)
    const classFilter = window.currentClassFilter || '';
    const sectionFilter = window.currentSectionFilter || '';
    
    // Resolve class/section column indices once (only if filters are active)
    let classColIndex = -1;
    let sectionColIndex = -1;
    if (classFilter || sectionFilter) {
        const headerRow = document.querySelector('#data-table thead tr');
        if (headerRow) {
            const headers = headerRow.querySelectorAll('th');
            headers.forEach((header, index) => {
                const fieldName = (header.getAttribute('data-field-name') || header.textContent.trim()).toUpperCase();
                if (classColIndex === -1 && (fieldName === 'CLASS' || fieldName === 'STD' || fieldName === 'STANDARD' || fieldName === 'GRADE' || fieldName.includes('CLASS'))) {
                    classColIndex = index;
                }
                if (sectionColIndex === -1 && (fieldName === 'SECTION' || fieldName === 'SEC' || fieldName === 'DIV' || fieldName === 'DIVISION' || fieldName.includes('SECTION'))) {
                    sectionColIndex = index;
                }
            });
        }
    }
    
    filteredRows = allRows.filter(row => {
        if (searchQuery) {
            if (currentFilterField === 'all') {
                const rowText = row.textContent.toLowerCase();
                if (!rowText.includes(searchQuery)) {
                    return false;
                }
            } else if (filterColumnIndex >= 0) {
                const cells = row.querySelectorAll('td');
                if (filterColumnIndex < cells.length) {
                    const cellText = cells[filterColumnIndex].textContent.toLowerCase();
                    if (!cellText.includes(searchQuery)) {
                        return false;
                    }
                } else {
                    return false;
                }
            }
        }
        
        if (currentFilter !== 'all' && (currentFilter === 'today' || currentFilter === 'week' || currentFilter === 'month')) {
            const rowDate = getRowDate(row);
            rowDate.setHours(0, 0, 0, 0);
            
            if (currentFilter === 'today') {
                if (rowDate.getTime() !== today.getTime()) return false;
            } else if (currentFilter === 'week') {
                if (rowDate < weekAgo) return false;
            } else if (currentFilter === 'month') {
                if (rowDate < monthAgo) return false;
            }
        }
        
        // Class filter — exact match on cell text
        if (classFilter && classColIndex >= 0) {
            const cells = row.querySelectorAll('td');
            if (classColIndex < cells.length) {
                const cell = cells[classColIndex];
                const span = cell.querySelector('.cell-value');
                const val = (span ? span.textContent : cell.textContent).trim();
                if (val !== classFilter) return false;
            } else {
                return false;
            }
        }
        
        // Section filter — exact match on cell text
        if (sectionFilter && sectionColIndex >= 0) {
            const cells = row.querySelectorAll('td');
            if (sectionColIndex < cells.length) {
                const cell = cells[sectionColIndex];
                const span = cell.querySelector('.cell-value');
                const val = (span ? span.textContent : cell.textContent).trim();
                if (val !== sectionFilter) return false;
            } else {
                return false;
            }
        }
        
        return true;
    });
    
    filteredRows.sort((a, b) => {
        switch (currentSort) {
            case 'name-asc':
                return getRowName(a).localeCompare(getRowName(b));
            case 'name-desc':
                return getRowName(b).localeCompare(getRowName(a));
            case 'date-new':
                return getRowDate(b) - getRowDate(a);
            case 'date-old':
                return getRowDate(a) - getRowDate(b);
            case 'sr-asc':
                return getRowSrNo(a) - getRowSrNo(b);
            case 'sr-desc':
                return getRowSrNo(b) - getRowSrNo(a);
            default:
                return 0;
        }
    });
    
    currentPage = 1;
    renderTable();
}

// ==========================================
// RENDER TABLE
// ==========================================

function renderTable() {
    const tableBody = document.getElementById('cardsTableBody');
    if (!tableBody) return;
    
    // Reset Shift+Click selection index when table is re-rendered
    if (window.IDCardApp && window.IDCardApp.resetShiftClickIndex) {
        window.IDCardApp.resetShiftClickIndex();
    }
    
    const existingNoResults = tableBody.querySelector('.no-results-row');
    if (existingNoResults) existingNoResults.remove();
    
    const totalRows = filteredRows.length;
    
    if (endlessScrollMode) {
        allRows.forEach(row => row.style.display = 'none');
        filteredRows.forEach(row => row.style.display = '');
        updatePaginationInfoEndless(totalRows);
    } else {
        allRows.forEach(row => row.style.display = 'none');
        
        const totalPages = Math.ceil(totalRows / rowsPerPage) || 1;
        
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        
        const startIndex = (currentPage - 1) * rowsPerPage;
        const endIndex = Math.min(startIndex + rowsPerPage, totalRows);
        
        for (let i = startIndex; i < endIndex; i++) {
            if (filteredRows[i]) {
                filteredRows[i].style.display = '';
            }
        }
        
        updatePaginationInfo(totalRows > 0 ? startIndex + 1 : 0, endIndex, totalRows, totalPages);
    }
    
    if (totalRows === 0 && allRows.length > 0) {
        const colCount = tableBody.closest('table').querySelectorAll('thead th').length;
        const noResultsRow = document.createElement('tr');
        noResultsRow.className = 'no-results-row';
        noResultsRow.innerHTML = `
            <td colspan="${colCount}" class="no-cards">
                <div class="empty-state">
                    <i class="fa-solid fa-search"></i>
                    <h3>No Results Found</h3>
                    <p>Try adjusting your search or filter criteria</p>
                </div>
            </td>
        `;
        tableBody.appendChild(noResultsRow);
    }
}

// ==========================================
// PAGINATION UI UPDATES
// ==========================================

function updatePaginationInfoEndless(totalLoaded) {
    const paginationInfo = document.querySelector('.pagination-info');
    if (paginationInfo) {
        const totalCount = lazyLoadState.totalCount || totalLoaded;
        const hasMore = lazyLoadState.hasMore;
        const hasFilter = window.currentClassFilter || window.currentSectionFilter || searchQuery;
        
        if (hasMore) {
            paginationInfo.innerHTML = `Showing <strong>1-${totalLoaded}</strong> of <strong>${totalLoaded}</strong> loaded (${totalCount} total)`;
        } else if (hasFilter && totalLoaded < totalCount) {
            // Filters active — show filtered count out of total
            paginationInfo.innerHTML = `Showing <strong>${totalLoaded}</strong> of <strong>${totalCount}</strong> results (filtered)`;
        } else {
            paginationInfo.innerHTML = `Showing <strong>all ${totalLoaded}</strong> results`;
        }
    }
    
    updatePageNumbersForEndless(totalLoaded);
}

function updatePageNumbersForEndless(totalLoaded) {
    // Use filtered count for pagination when filters are active
    const hasFilter = window.currentClassFilter || window.currentSectionFilter || searchQuery;
    const totalCount = (hasFilter ? totalLoaded : lazyLoadState.totalCount) || totalLoaded;
    const totalPages = Math.ceil(totalCount / rowsPerPage) || 1;
    
    const tableContainer = document.querySelector('.idcard-table');
    let virtualPage = 1;
    if (tableContainer) {
        const scrollPercentage = tableContainer.scrollTop / (tableContainer.scrollHeight - tableContainer.clientHeight || 1);
        virtualPage = Math.max(1, Math.ceil(scrollPercentage * totalPages));
    }
    
    const pageNumbersContainer = document.querySelector('.page-numbers');
    if (pageNumbersContainer) {
        pageNumbersContainer.innerHTML = '';
        
        let startPage = Math.max(1, virtualPage - 2);
        let endPage = Math.min(totalPages, virtualPage + 2);
        
        if (endPage - startPage < 4) {
            if (startPage === 1) {
                endPage = Math.min(totalPages, 5);
            } else if (endPage === totalPages) {
                startPage = Math.max(1, totalPages - 4);
            }
        }
        
        for (let i = startPage; i <= endPage; i++) {
            const btn = document.createElement('button');
            btn.className = 'page-num' + (i === virtualPage ? ' active' : '');
            btn.textContent = i;
            btn.addEventListener('click', () => jumpToPage(i));
            pageNumbersContainer.appendChild(btn);
        }
    }
    
    const firstBtn = document.getElementById('firstPage');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const lastBtn = document.getElementById('lastPage');
    
    if (firstBtn) firstBtn.disabled = virtualPage === 1;
    if (prevBtn) prevBtn.disabled = virtualPage === 1;
    if (nextBtn) nextBtn.disabled = virtualPage === totalPages || totalPages === 0;
    if (lastBtn) lastBtn.disabled = virtualPage === totalPages || totalPages === 0;
}

function updatePaginationInfo(start, end, total, totalPages) {
    const paginationInfo = document.querySelector('.pagination-info');
    if (paginationInfo) {
        if (total === 0) {
            paginationInfo.innerHTML = 'Showing <strong>0</strong> results';
        } else {
            paginationInfo.innerHTML = `Showing <strong>${start}-${end}</strong> of <strong>${total}</strong> results`;
        }
    }
    
    const pageNumbersContainer = document.querySelector('.page-numbers');
    if (pageNumbersContainer) {
        pageNumbersContainer.innerHTML = '';
        
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, currentPage + 2);
        
        if (endPage - startPage < 4) {
            if (startPage === 1) {
                endPage = Math.min(totalPages, 5);
            } else if (endPage === totalPages) {
                startPage = Math.max(1, totalPages - 4);
            }
        }
        
        for (let i = startPage; i <= endPage; i++) {
            const btn = document.createElement('button');
            btn.className = 'page-num' + (i === currentPage ? ' active' : '');
            btn.textContent = i;
            btn.addEventListener('click', () => goToPage(i));
            pageNumbersContainer.appendChild(btn);
        }
    }
    
    const firstBtn = document.getElementById('firstPage');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const lastBtn = document.getElementById('lastPage');
    
    if (firstBtn) firstBtn.disabled = currentPage === 1;
    if (prevBtn) prevBtn.disabled = currentPage === 1;
    if (nextBtn) nextBtn.disabled = currentPage === totalPages || totalPages === 0;
    if (lastBtn) lastBtn.disabled = currentPage === totalPages || totalPages === 0;
}

function updateLazyLoadPaginationInfo() {
    if (!endlessScrollMode) return;
    
    const paginationInfo = document.querySelector('.pagination-info');
    if (paginationInfo) {
        if (lazyLoadState.hasMore) {
            paginationInfo.innerHTML = `Showing <strong>1-${lazyLoadState.loadedCount}</strong> of <strong>${lazyLoadState.loadedCount}</strong> loaded (${lazyLoadState.totalCount} total)`;
        } else {
            paginationInfo.innerHTML = `Showing <strong>all ${lazyLoadState.loadedCount}</strong> results`;
        }
    }
    
    updatePageNumbersForEndless(lazyLoadState.loadedCount);
}

// ==========================================
// PAGINATION NAVIGATION
// ==========================================

function jumpToPage(page) {
    const rowsPerPageValue = rowsPerPage;
    const targetRowIndex = (page - 1) * rowsPerPageValue;
    
    if (targetRowIndex >= filteredRows.length && lazyLoadState.hasMore) {
        endlessScrollMode = false;
        currentPage = page;
        goToPage(page);
        return;
    }
    
    if (filteredRows[targetRowIndex]) {
        filteredRows[targetRowIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function goToPage(page) {
    const rowsNeeded = page * rowsPerPage;
    
    if (rowsNeeded > lazyLoadState.loadedCount && lazyLoadState.hasMore) {
        showTableLoadingOverlay(true);
        
        while (lazyLoadState.loadedCount < rowsNeeded && lazyLoadState.hasMore) {
            await loadMoreData();
        }
        
        showTableLoadingOverlay(false);
    }
    
    if (endlessScrollMode) {
        const targetRowIndex = (page - 1) * rowsPerPage;
        const totalPages = Math.ceil(lazyLoadState.totalCount / rowsPerPage) || 1;
        
        if (page >= 1 && page <= totalPages) {
            if (filteredRows[targetRowIndex]) {
                filteredRows[targetRowIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            currentPage = page;
            renderTable();
        }
    } else {
        const totalPages = Math.ceil(filteredRows.length / rowsPerPage) || 1;
        if (page >= 1 && page <= totalPages) {
            currentPage = page;
            renderTable();
            checkLoadMore();
        }
    }
}

function goToFirstPage() {
    if (endlessScrollMode) {
        const tableContainer = document.querySelector('.idcard-table');
        if (tableContainer) {
            tableContainer.scrollTo({ top: 0, behavior: 'smooth' });
        }
    } else {
        goToPage(1);
    }
}

function goToPrevPage() {
    if (endlessScrollMode) {
        const tableContainer = document.querySelector('.idcard-table');
        if (tableContainer) {
            tableContainer.scrollBy({ top: -tableContainer.clientHeight * 0.8, behavior: 'smooth' });
        }
    } else {
        goToPage(currentPage - 1);
    }
}

function goToNextPage() {
    if (endlessScrollMode) {
        const tableContainer = document.querySelector('.idcard-table');
        if (tableContainer) {
            tableContainer.scrollBy({ top: tableContainer.clientHeight * 0.8, behavior: 'smooth' });
        }
    } else {
        goToPage(currentPage + 1);
    }
}

async function goToLastPage() {
    if (lazyLoadState.hasMore) {
        await loadAllData();
    }
    if (endlessScrollMode) {
        const tableContainer = document.querySelector('.idcard-table');
        if (tableContainer) {
            tableContainer.scrollTo({ top: tableContainer.scrollHeight, behavior: 'smooth' });
        }
    } else {
        const totalPages = Math.ceil(filteredRows.length / rowsPerPage) || 1;
        goToPage(totalPages);
    }
}

function setRowsPerPage(count) {
    rowsPerPage = parseInt(count) || 10;
    currentPage = 1;
    renderTable();
}

// ==========================================
// LAZY LOADING FUNCTIONS
// ==========================================

function showLazyLoadIndicator(show) {
    const indicator = document.getElementById('lazyLoadIndicator');
    if (indicator) {
        indicator.style.display = show ? 'flex' : 'none';
    }
}

function showTableLoadingOverlay(show) {
    const tableWrapper = document.querySelector('.table-wrapper');
    if (!tableWrapper) return;
    
    let overlay = tableWrapper.querySelector('.table-loading-overlay');
    
    if (show) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'table-loading-overlay';
            overlay.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Loading data...</span>';
            tableWrapper.appendChild(overlay);
        }
        overlay.style.display = 'flex';
    } else if (overlay) {
        overlay.style.display = 'none';
    }
}

function createRowFromCard(card, index) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-card-id', card.id);
    tr.setAttribute('data-sr-no', card.sr_no);
    
    // Image field types
    // Use global IMAGE_FIELD_TYPES
    const localImageFieldTypes = (typeof IMAGE_FIELD_TYPES !== 'undefined') 
        ? IMAGE_FIELD_TYPES 
        : ['photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature', 'image'];
    
    // Image field name patterns (for detecting by name when type might not be set correctly)
    const imageFieldNamePatterns = ['photo', 'f photo', 'father photo', 'm photo', 'mother photo', 'sign', 'signature', 'barcode', 'qr', 'qr_code', 'image'];
    
    function isImageFieldType(fieldType) {
        if (!fieldType) return false;
        return localImageFieldTypes.includes(fieldType.toLowerCase());
    }
    
    function isImageFieldByName(fieldName) {
        if (!fieldName) return false;
        const normalizedName = fieldName.toLowerCase().trim();
        // Use word boundary matching to avoid false positives like 'designation' matching 'sign'
        const patterns = ['photo', 'sign', 'signature', 'barcode', 'qr'];
        for (const pattern of patterns) {
            const regex = new RegExp('\\b' + pattern + '\\b');
            if (regex.test(normalizedName)) {
                return true;
            }
        }
        return false;
    }
    
    function isImageField(fieldType, fieldName) {
        return isImageFieldType(fieldType) || isImageFieldByName(fieldName);
    }
    
    // Get CSS class based on field name for different image types
    function getImageTypeClass(fieldName) {
        if (!fieldName) return 'photo-type';
        const nameLower = fieldName.toLowerCase();
        // Use word boundary matching to avoid 'designation' matching 'sign'
        if (/\bsign\b|\bsignature\b/.test(nameLower)) return 'signature-type';
        if (/\bqr\b/.test(nameLower)) return 'qr-type';
        if (/\bbarcode\b/.test(nameLower)) return 'barcode-type';
        return 'photo-type';
    }
    
    let html = `<td class="checkbox-cell"><input type="checkbox" class="rowCheckbox"></td>`;
    html += `<td class="sr-no-cell">${card.sr_no}</td>`;
    
    if (card.ordered_fields) {
        card.ordered_fields.forEach(field => {
            const fieldName = field.name;
            const fieldType = field.type;
            const fieldValue = field.value || '';
            
            if (isImageField(fieldType, fieldName)) {
                let imageHtml = '';
                const imageTypeClass = getImageTypeClass(fieldName);
                
                // Check if it's a PENDING reference
                const isPending = fieldValue && fieldValue.startsWith('PENDING:');
                const pendingRef = isPending ? fieldValue.substring(8) : null;
                
                // Create full path with /media/ prefix (only for actual paths, not PENDING)
                const fullImagePath = fieldValue && fieldValue !== '' && !isPending
                    ? (fieldValue.startsWith('/media/') || fieldValue.startsWith('http') ? fieldValue : `/media/${fieldValue}`)
                    : '';
                
                const isNotFound = fieldValue === 'NOT_FOUND';
                


                if (isPending) {
                    // PENDING - show waiting placeholder with clock icon
                    imageHtml = `<div class="no-image pending-placeholder" title="Waiting for upload: ${pendingRef}"><i class="fa-solid fa-clock"></i></div>`;
                } else if (isNotFound) {
                    // NOT_FOUND (legacy) - treat as empty
                    imageHtml = `<div class="no-image colorful-placeholder" title="Image not found"><i class="fa-solid fa-user-astronaut"></i></div>`;
                } else if (fieldValue && fieldValue !== '') {
                    // Valid image path - use thumbnail for table display, fallback to original
                    const cacheBuster = `?t=${Date.now()}`;
                    // Use thumbnail path for faster loading in tables
                    const thumbPath = window.getThumbPath ? window.getThumbPath(fieldValue) : fieldValue;
                    const thumbSrc = thumbPath ? `/media/${thumbPath}${cacheBuster}` : null;
                    const originalSrc = `/media/${fieldValue}${cacheBuster}`;
                    
                    // Use onError fallback to original if thumbnail doesn't exist
                    const fallbackAttr = thumbPath ? `onerror="this.onerror=null; this.src='${originalSrc}';"` : '';
                    const imageSrc = thumbPath ? thumbSrc : originalSrc;
                    imageHtml = `<img src="${imageSrc}" alt="${fieldName}" class="table-image ${imageTypeClass}" loading="lazy" ${fallbackAttr}>`;
                } else {
                    // Empty/null - Colorful placeholder (no image)
                    imageHtml = `<div class="no-image colorful-placeholder"><i class="fa-solid fa-user-astronaut"></i></div>`;
                }
                
                // IMPORTANT: Store raw fieldValue (including PENDING:xxx) for Image Sort filter to work
                // This matches what template table.html stores
                html += `<td class="image-field image-cell ${imageTypeClass}" 
                    data-field="${fieldName}"
                    data-field-name="${fieldName}" 
                    data-field-type="image"
                    data-original-value="${fieldValue}">
                    <div class="image-with-edit">
                        ${imageHtml}
                        ${(typeof PERMS !== 'undefined' && PERMS.idcard_edit && !(typeof IS_CLIENT_USER !== 'undefined' && IS_CLIENT_USER && typeof CLIENT_READONLY_STATUSES !== 'undefined' && CLIENT_READONLY_STATUSES.indexOf(lazyLoadState.currentStatus) !== -1)) ? `<button class="edit-photo-btn" data-card-id="${card.id}" title="Edit Card"><i class="fa-solid fa-pen"></i></button>` : ''}
                    </div>
                </td>`;
            } else {
                const textClass = fieldType === 'textarea' ? 'long-text' : 
                                 (fieldType === 'date' || fieldType === 'number') ? 'short-text' :
                                 fieldValue.length <= 10 ? 'short-text' :
                                 fieldValue.length > 40 ? 'long-text' : 'medium-text';
                
                // Client users on approved/download/reprint: no inline editing
                const isLockedForClient = (typeof IS_CLIENT_USER !== 'undefined' && IS_CLIENT_USER
                    && typeof CLIENT_READONLY_STATUSES !== 'undefined'
                    && CLIENT_READONLY_STATUSES.indexOf(lazyLoadState.currentStatus) !== -1);
                const editableClass = isLockedForClient ? 'dynamic-field' : 'dynamic-field editable-cell';
                const editTitle = isLockedForClient ? '' : 'title="Double-click to edit"';
                
                html += `<td class="${editableClass} ${textClass}" 
                    data-field="${fieldName}"
                    data-field-name="${fieldName}" 
                    data-field-type="${fieldType}"
                    data-original-value="${fieldValue}"
                    ${editTitle}>
                    <span class="cell-value">${fieldValue}</span>
                </td>`;
            }
        });
    }
    
    html += `<td class="action-cell">
        <div class="action-buttons">
            ${getRowActionButtons(lazyLoadState.currentStatus, card.id)}
        </div>
    </td>`;
    
    if (typeof PERMS === 'undefined' || PERMS.idcard_updated_at) {
        html += `<td class="date-cell">${card.updated_at || ''}</td>`;
        html += `<td class="user-cell">Admin</td>`;
    }
    
    tr.innerHTML = html;
    return tr;
}

function getRowActionButtons(status, cardId) {
    var p = (typeof PERMS !== 'undefined') ? PERMS : {};
    // Client/client_staff: no action buttons on approved/download/reprint
    var isClientReadonly = (typeof IS_CLIENT_USER !== 'undefined' && IS_CLIENT_USER
        && typeof CLIENT_READONLY_STATUSES !== 'undefined'
        && CLIENT_READONLY_STATUSES.indexOf(status) !== -1);
    switch(status) {
        case 'pending':
            return p.idcard_verify ? `<button class="row-action-btn verify-row-btn" data-card-id="${cardId}" title="Verify this card"><i class="fa-solid fa-check"></i><span>Verify</span></button>` : '';
        case 'verified': {
            let btns = '';
            if (p.idcard_approve) btns += `<button class="row-action-btn approve-row-btn" data-card-id="${cardId}" title="Approve this card"><i class="fa-solid fa-check-double"></i><span>Approve</span></button>`;
            if (p.idcard_verify) btns += `<button class="row-action-btn unverify-row-btn" data-card-id="${cardId}" title="Move back to pending"><i class="fa-solid fa-rotate-left"></i><span>Unverify</span></button>`;
            return btns;
        }
        case 'approved': {
            if (isClientReadonly) return '';
            let btns = '';
            if (p.idcard_approve) btns += `<button class="row-action-btn download-row-btn" data-card-id="${cardId}" title="Move to download list"><i class="fa-solid fa-download"></i><span>Download</span></button>`;
            if (p.idcard_verify) btns += `<button class="row-action-btn unapprove-row-btn" data-card-id="${cardId}" title="Move back to verified"><i class="fa-solid fa-rotate-left"></i><span>Unapprove</span></button>`;
            return btns;
        }
        case 'download':
            return p.idcard_bulk_download ? `<button class="row-action-btn download-single-row-btn" data-card-id="${cardId}" title="Download this card's image"><i class="fa-solid fa-download"></i><span>Download</span></button>` : `<span class="status-badge download">Downloaded</span>`;
        case 'pool':
            return p.idcard_retrieve ? `<button class="row-action-btn retrieve-row-btn" data-card-id="${cardId}" title="Retrieve to pending"><i class="fa-solid fa-rotate-left"></i><span>Retrieve</span></button>` : '';
        default:
            return `<span class="status-badge ${status}">${status}</span>`;
    }
}

function attachRowEventHandlers(row) {
    row.querySelectorAll('.verify-row-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (typeof verifyCard === 'function') verifyCard(this.getAttribute('data-card-id'));
        });
    });
    
    row.querySelectorAll('.approve-row-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (typeof approveCard === 'function') approveCard(this.getAttribute('data-card-id'));
        });
    });
    
    row.querySelectorAll('.unapprove-row-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (typeof unapproveCard === 'function') unapproveCard(this.getAttribute('data-card-id'));
        });
    });
    
    row.querySelectorAll('.unverify-row-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (typeof unverifyCard === 'function') unverifyCard(this.getAttribute('data-card-id'));
        });
    });
    
    row.querySelectorAll('.download-row-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (typeof downloadCard === 'function') downloadCard(this.getAttribute('data-card-id'));
        });
    });
    
    row.querySelectorAll('.retrieve-row-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (typeof retrieveCard === 'function') retrieveCard(this.getAttribute('data-card-id'));
        });
    });
    
    row.querySelectorAll('.download-single-row-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (typeof downloadSingleCard === 'function') downloadSingleCard(this.getAttribute('data-card-id'));
        });
    });
    
    row.querySelectorAll('.back-approved-row-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (typeof backToApprovedCard === 'function') backToApprovedCard(this.getAttribute('data-card-id'));
        });
    });
    
    row.querySelectorAll('.editable-cell:not(.image-field)').forEach(cell => {
        // Single-click to start editing (Phase 6: Single Click Edit)
        cell.addEventListener('click', function(e) {
            // Skip if clicking on a button or already editing
            if (e.target.closest('button') || this.classList.contains('editing')) return;
            if (typeof startCellEdit === 'function') {
                startCellEdit(this);
            }
        });
    });
}

async function loadMoreData() {
    if (lazyLoadState.isLoading || !lazyLoadState.hasMore || !lazyLoadState.tableId) {
        return;
    }
    
    lazyLoadState.isLoading = true;
    showLazyLoadIndicator(true);
    
    try {
        const offset = lazyLoadState.loadedCount;
        const url = `/panel/api/table/${lazyLoadState.tableId}/cards/?status=${lazyLoadState.currentStatus}&offset=${offset}&limit=${lazyLoadState.batchSize}`;
        
        const response = await fetch(url, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load more data');
        }
        
        const data = await response.json();
        
        if (data.cards && data.cards.length > 0) {
            const tableBody = document.getElementById('cardsTableBody');
            
            data.cards.forEach((card, index) => {
                const row = createRowFromCard(card, index);
                tableBody.appendChild(row);
                allRows.push(row);
                attachRowEventHandlers(row);
            });
            
            lazyLoadState.loadedCount += data.cards.length;
            lazyLoadState.hasMore = data.has_more;
            lazyLoadState.totalCount = data.total_count;
            
            filteredRows = [...allRows];
            if (searchQuery) {
                applyFiltersAndSort();
            } else {
                renderTable();
            }
            
            // Handle any broken images in newly loaded rows
            handleBrokenImages();
            
            // Re-populate filter dropdowns with any new class/section values
            if (typeof populateFilterOptions === 'function') {
                populateFilterOptions();
            }
            
            updateLazyLoadPaginationInfo();
            
            const paginationBar = document.getElementById('paginationBar');
            if (paginationBar) {
                paginationBar.dataset.hasMore = data.has_more.toString();
                paginationBar.dataset.totalCount = data.total_count.toString();
                paginationBar.dataset.initialLoaded = lazyLoadState.loadedCount.toString();
            }
        }
        
    } catch (error) {
        console.error('Error loading more data:', error);
        if (typeof showToast === 'function') showToast('Failed to load more data', false);
    } finally {
        lazyLoadState.isLoading = false;
        showLazyLoadIndicator(false);
    }
}

function checkLoadMore() {
    if (!lazyLoadState.hasMore || lazyLoadState.isLoading) {
        return;
    }
    
    if (lazyLoadState.loadedCount < 200 && lazyLoadState.hasMore) {
        loadMoreData();
        return;
    }
    
    const tableContainer = document.querySelector('.idcard-table');
    if (tableContainer) {
        const scrollTop = tableContainer.scrollTop;
        const scrollHeight = tableContainer.scrollHeight;
        const clientHeight = tableContainer.clientHeight;
        const scrollRemaining = scrollHeight - scrollTop - clientHeight;
        
        const threshold = Math.max(800, scrollHeight * 0.2);
        if (scrollRemaining < threshold) {
            loadMoreData();
        }
    }
}

async function loadAllData() {
    if (!lazyLoadState.hasMore || lazyLoadState.isLoading || !lazyLoadState.tableId) {
        return;
    }
    
    showTableLoadingOverlay(true);
    
    try {
        while (lazyLoadState.hasMore) {
            await loadMoreData();
        }
    } finally {
        showTableLoadingOverlay(false);
    }
}

// ==========================================
// HIGHLIGHT SEARCH RESULT
// ==========================================

function highlightSearchResult() {
    const urlParams = new URLSearchParams(window.location.search);
    const highlightId = urlParams.get('highlight');
    
    if (highlightId) {
        const targetRow = document.querySelector(`tr[data-card-id="${highlightId}"]`);
        
        if (targetRow) {
            const rowIndex = allRows.indexOf(targetRow);
            
            if (rowIndex !== -1) {
                const targetPage = Math.floor(rowIndex / rowsPerPage) + 1;
                currentPage = targetPage;
                renderTable();
                
                requestAnimationFrame(() => {
                    targetRow.classList.add('search-highlight');
                    targetRow.scrollIntoView({ 
                        behavior: 'auto',
                        block: 'center' 
                    });
                    
                    const checkbox = targetRow.querySelector('.rowCheckbox');
                    if (checkbox) {
                        checkbox.checked = true;
                        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
                
                setTimeout(() => {
                    targetRow.classList.remove('search-highlight');
                    const newUrl = new URL(window.location);
                    newUrl.searchParams.delete('highlight');
                    window.history.replaceState({}, '', newUrl);
                }, 8000);
            }
        }
    }
}

// ==========================================
// HANDLE BROKEN IMAGES
// ==========================================

function handleBrokenImages() {
    // Add error handlers to all table images
    const tableImages = document.querySelectorAll('.table-image');
    tableImages.forEach(img => {
        // Skip if placeholder already exists (template already handled it)
        if (img.parentElement.querySelector('.no-image')) {
            img.style.display = 'none';
            return;
        }
        
        // Check if image already failed (no src or empty src)
        if (!img.src || img.src === window.location.href || img.src.includes('NOT_FOUND')) {
            showImagePlaceholder(img);
            return;
        }
        
        img.onerror = function() {
            showImagePlaceholder(this);
        };
        
        // Check if image already errored (naturalWidth is 0 for broken images)
        if (img.complete && img.naturalWidth === 0) {
            showImagePlaceholder(img);
        }
    });
}

function showImagePlaceholder(img) {
    // Skip if placeholder already exists
    if (img.parentElement.querySelector('.no-image')) {
        img.style.display = 'none';
        return;
    }
    
    // Create placeholder div
    const placeholder = document.createElement('div');
    placeholder.className = 'no-image colorful-placeholder';
    placeholder.title = 'Image not available';
    placeholder.innerHTML = '<i class="fa-solid fa-user-astronaut"></i>';
    
    // Replace img with placeholder
    img.style.display = 'none';
    img.parentElement.insertBefore(placeholder, img);
}

// ==========================================
// INITIALIZATION
// ==========================================

function initTableModule() {
    earlyInitLazyLoadState();
    initializeRows();
    lazyLoadState.loadedCount = allRows.length;
    renderTable();
    highlightSearchResult();
    initLazyLoadState();
    renderTable();
    
    // Handle broken images after table render
    handleBrokenImages();
    
    // Populate class/section filter dropdowns from table data
    if (typeof populateFilterOptions === 'function') {
        populateFilterOptions();
    }

    
    setTimeout(() => {
        checkLoadMore();
    }, 500);
    
    // Scroll listener
    const idcardTable = document.querySelector('.idcard-table');
    if (idcardTable) {
        idcardTable.addEventListener('scroll', function() {
            checkLoadMore();
            if (endlessScrollMode) {
                updatePageNumbersForEndless(filteredRows.length);
            }
        });
    }
    
    window.addEventListener('scroll', function() {
        checkLoadMore();
    });
    
    // Background loading interval
    const lazyLoadInterval = setInterval(() => {
        if (lazyLoadState.hasMore && !lazyLoadState.isLoading) {
            checkLoadMore();
        } else if (!lazyLoadState.hasMore) {
            clearInterval(lazyLoadInterval);
        }
    }, 1000);
    
    // Pagination button handlers
    document.getElementById('firstPage')?.addEventListener('click', goToFirstPage);
    document.getElementById('prevPage')?.addEventListener('click', goToPrevPage);
    document.getElementById('nextPage')?.addEventListener('click', goToNextPage);
    document.getElementById('lastPage')?.addEventListener('click', goToLastPage);
}

// Expose functions globally
window.initializeRows = initializeRows;
window.searchRows = searchRows;
window.filterByField = filterByField;
window.sortRows = sortRows;
window.applyFiltersAndSort = applyFiltersAndSort;
window.renderTable = renderTable;
window.goToPage = goToPage;
window.goToFirstPage = goToFirstPage;
window.goToPrevPage = goToPrevPage;
window.goToNextPage = goToNextPage;
window.goToLastPage = goToLastPage;
window.setRowsPerPage = setRowsPerPage;
window.loadMoreData = loadMoreData;
window.checkLoadMore = checkLoadMore;
window.loadAllData = loadAllData;
window.attachRowEventHandlers = attachRowEventHandlers;
window.handleBrokenImages = handleBrokenImages;
window.lazyLoadState = lazyLoadState;

window.IDCardApp.initTableModule = initTableModule;
window.IDCardApp.searchRows = searchRows;
window.IDCardApp.filterByField = filterByField;
window.IDCardApp.sortRows = sortRows;
window.IDCardApp.setRowsPerPage = setRowsPerPage;
