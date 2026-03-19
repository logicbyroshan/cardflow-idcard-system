// ID Card Actions - Table Render & Pagination Module
// Contains: Table rendering, pagination UI, broken image handling, loading indicators
// Part of: idcard-actions-table split (state  render-row  render-main  load)

(function() {
'use strict';

window.IDCardApp = window.IDCardApp || {};
var _ts = window.IDCardApp._ts;

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
    
    const totalRows = _ts.filteredRows.length;
    
    if (_ts.endlessScrollMode) {
        // Use a Set for O(1) lookup so we set display in a single pass.
        // Avoids the old hide-all-then-show pattern that briefly collapsed
        // the table, triggering scroll-position jumps and observer re-fires.
        const filteredSet = new Set(_ts.filteredRows);
        let visCount = 0;
        _ts.allRows.forEach(row => {
            const vis = filteredSet.has(row);
            row.style.display = vis ? '' : 'none';
            if (vis) visCount++;
        });
        _ts._cachedVisibleCount = visCount;
        updatePaginationInfoEndless(totalRows);
    } else {
        _ts.allRows.forEach(row => row.style.display = 'none');
        
        const totalPages = Math.ceil(totalRows / _ts.rowsPerPage) || 1;
        
        if (_ts.currentPage > totalPages) _ts.currentPage = totalPages;
        if (_ts.currentPage < 1) _ts.currentPage = 1;
        
        const startIndex = (_ts.currentPage - 1) * _ts.rowsPerPage;
        const endIndex = Math.min(startIndex + _ts.rowsPerPage, totalRows);
        
        for (let i = startIndex; i < endIndex; i++) {
            if (_ts.filteredRows[i]) {
                _ts.filteredRows[i].style.display = '';
            }
        }
        
        updatePaginationInfo(totalRows > 0 ? startIndex + 1 : 0, endIndex, totalRows, totalPages);
    }
    
    if (totalRows === 0 && _ts.allRows.length > 0) {
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
        const totalCount = _ts.lazyLoadState.totalCount || totalLoaded;
        const hasMore = _ts.lazyLoadState.hasMore;
        const hasFilter = IDCardApp.currentClassFilter || IDCardApp.currentSectionFilter || _ts.searchQuery;
        
        if (hasMore) {
            paginationInfo.innerHTML = `Showing <strong>1-${totalLoaded}</strong> of <strong>${totalLoaded}</strong> loaded (${totalCount} total)`;
        } else if (hasFilter && totalLoaded < totalCount) {
            // Filters active  show filtered count out of total
            paginationInfo.innerHTML = `Showing <strong>${totalLoaded}</strong> of <strong>${totalCount}</strong> results (filtered)`;
        } else {
            paginationInfo.innerHTML = `Showing <strong>all ${totalLoaded}</strong> results`;
        }
    }
    
    updatePageNumbersForEndless(totalLoaded);
}

function updatePageNumbersForEndless(totalLoaded) {
    // Use cached visible count (updated in renderTable / applyFilters) for O(1)
    const visibleCount = (_ts._cachedVisibleCount != null ? _ts._cachedVisibleCount : totalLoaded) || totalLoaded;
    const totalPages = Math.ceil(visibleCount / _ts.rowsPerPage) || 1;
    
    const tableContainer = document.querySelector('.idcard-table');
    let virtualPage = 1;
    if (tableContainer && visibleCount > 0) {
        // Calculate virtual page from approximate first visible row index
        const avgRowHeight = tableContainer.scrollHeight / (visibleCount || 1);
        const firstVisibleRowIndex = Math.floor(tableContainer.scrollTop / (avgRowHeight || 1));
        virtualPage = Math.min(totalPages, Math.max(1, Math.floor(firstVisibleRowIndex / _ts.rowsPerPage) + 1));
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
        
        let startPage = Math.max(1, _ts.currentPage - 2);
        let endPage = Math.min(totalPages, _ts.currentPage + 2);
        
        if (endPage - startPage < 4) {
            if (startPage === 1) {
                endPage = Math.min(totalPages, 5);
            } else if (endPage === totalPages) {
                startPage = Math.max(1, totalPages - 4);
            }
        }
        
        for (let i = startPage; i <= endPage; i++) {
            const btn = document.createElement('button');
            btn.className = 'page-num' + (i === _ts.currentPage ? ' active' : '');
            btn.textContent = i;
            btn.addEventListener('click', () => goToPage(i));
            pageNumbersContainer.appendChild(btn);
        }
    }
    
    const firstBtn = document.getElementById('firstPage');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const lastBtn = document.getElementById('lastPage');
    
    if (firstBtn) firstBtn.disabled = _ts.currentPage === 1;
    if (prevBtn) prevBtn.disabled = _ts.currentPage === 1;
    if (nextBtn) nextBtn.disabled = _ts.currentPage === totalPages || totalPages === 0;
    if (lastBtn) lastBtn.disabled = _ts.currentPage === totalPages || totalPages === 0;
}

function updateLazyLoadPaginationInfo() {
    if (!_ts.endlessScrollMode) return;
    
    const paginationInfo = document.querySelector('.pagination-info');
    if (paginationInfo) {
        if (_ts.lazyLoadState.hasMore) {
            paginationInfo.innerHTML = `Showing <strong>1-${_ts.lazyLoadState.loadedCount}</strong> of <strong>${_ts.lazyLoadState.loadedCount}</strong> loaded (${_ts.lazyLoadState.totalCount} total)`;
        } else {
            paginationInfo.innerHTML = `Showing <strong>all ${_ts.lazyLoadState.loadedCount}</strong> results`;
        }
    }
    
    updatePageNumbersForEndless(_ts.lazyLoadState.loadedCount);
}

// ==========================================
// PAGINATION NAVIGATION
// ==========================================

function jumpToPage(page) {
    const rowsPerPageValue = _ts.rowsPerPage;
    const targetRowIndex = (page - 1) * rowsPerPageValue;
    
    if (targetRowIndex >= _ts.filteredRows.length && _ts.lazyLoadState.hasMore) {
        _ts.endlessScrollMode = false;
        _ts.currentPage = page;
        goToPage(page);
        return;
    }
    
    if (_ts.filteredRows[targetRowIndex]) {
        _ts.filteredRows[targetRowIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function goToPage(page) {
    const rowsNeeded = page * _ts.rowsPerPage;
    
    if (rowsNeeded > _ts.lazyLoadState.loadedCount && _ts.lazyLoadState.hasMore) {
        showTableLoadingOverlay(true);
        
        while (_ts.lazyLoadState.loadedCount < rowsNeeded && _ts.lazyLoadState.hasMore) {
            await window.IDCardApp.loadMoreData();
        }
        
        showTableLoadingOverlay(false);
    }
    
    if (_ts.endlessScrollMode) {
        const targetRowIndex = (page - 1) * _ts.rowsPerPage;
        const totalPages = Math.ceil(_ts.lazyLoadState.totalCount / _ts.rowsPerPage) || 1;
        
        if (page >= 1 && page <= totalPages) {
            if (_ts.filteredRows[targetRowIndex]) {
                _ts.filteredRows[targetRowIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            _ts.currentPage = page;
            renderTable();
        }
    } else {
        const totalPages = Math.ceil(_ts.filteredRows.length / _ts.rowsPerPage) || 1;
        if (page >= 1 && page <= totalPages) {
            _ts.currentPage = page;
            renderTable();
            window.IDCardApp.checkLoadMore();
        }
    }
}

function goToFirstPage() {
    if (_ts.endlessScrollMode) {
        const tableContainer = document.querySelector('.idcard-table');
        if (tableContainer) {
            tableContainer.scrollTo({ top: 0, behavior: 'smooth' });
        }
    } else {
        goToPage(1);
    }
}

function goToPrevPage() {
    if (_ts.endlessScrollMode) {
        const tableContainer = document.querySelector('.idcard-table');
        if (tableContainer) {
            const visibleRows = _ts.filteredRows.filter(r => r.style.display !== 'none');
            const totalRows = visibleRows.length || 1;
            const avgRowHeight = tableContainer.scrollHeight / totalRows;
            const jumpPx = avgRowHeight * _ts.rowsPerPage;
            tableContainer.scrollBy({ top: -jumpPx, behavior: 'smooth' });
        }
    } else {
        goToPage(_ts.currentPage - 1);
    }
}

function goToNextPage() {
    if (_ts.endlessScrollMode) {
        const tableContainer = document.querySelector('.idcard-table');
        if (tableContainer) {
            const visibleRows = _ts.filteredRows.filter(r => r.style.display !== 'none');
            const totalRows = visibleRows.length || 1;
            const avgRowHeight = tableContainer.scrollHeight / totalRows;
            const jumpPx = avgRowHeight * _ts.rowsPerPage;
            tableContainer.scrollBy({ top: jumpPx, behavior: 'smooth' });
        }
    } else {
        goToPage(_ts.currentPage + 1);
    }
}

async function goToLastPage() {
    if (_ts.lazyLoadState.hasMore) {
        await window.IDCardApp.loadAllData();
    }
    if (_ts.endlessScrollMode) {
        const tableContainer = document.querySelector('.idcard-table');
        if (tableContainer) {
            tableContainer.scrollTo({ top: tableContainer.scrollHeight, behavior: 'smooth' });
        }
    } else {
        const totalPages = Math.ceil(_ts.filteredRows.length / _ts.rowsPerPage) || 1;
        goToPage(totalPages);
    }
}

function setRowsPerPage(count) {
    _ts.rowsPerPage = parseInt(count) || 10;
    _ts.currentPage = 1;
    renderTable();
}

// ==========================================
// LOADING INDICATORS
// ==========================================

function showLazyLoadIndicator(show) {
    const indicator = document.getElementById('lazyLoadIndicator');
    if (!indicator) return;

    if (!indicator.dataset.skeletonInit) {
        indicator.dataset.skeletonInit = '1';
        indicator.innerHTML = [
            '<div class="lazy-skeleton-shell" aria-hidden="true">',
            '  <span class="lazy-skeleton-cell"></span>',
            '  <span class="lazy-skeleton-cell"></span>',
            '  <span class="lazy-skeleton-cell"></span>',
            '  <span class="lazy-skeleton-cell"></span>',
            '</div>'
        ].join('');
    }

    indicator.classList.toggle('is-visible', !!show);
    indicator.style.display = show ? 'block' : 'none';
}

function showTableLoadingOverlay(show) {
    const tableWrapper = document.querySelector('.table-wrapper');
    if (!tableWrapper) return;
    
    let overlay = tableWrapper.querySelector('.table-loading-overlay');
    
    if (show) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'table-loading-overlay table-skeleton-overlay';
            overlay.setAttribute('aria-hidden', 'true');
            overlay.style.setProperty('--sk-cols', '8');
            overlay.innerHTML = [
                '<div class="table-skeleton-shell">',
                '  <div class="table-skeleton-head">',
                '    <span class="table-skeleton-block table-skeleton-th"></span>',
                '    <span class="table-skeleton-block table-skeleton-th"></span>',
                '    <span class="table-skeleton-block table-skeleton-th"></span>',
                '    <span class="table-skeleton-block table-skeleton-th"></span>',
                '    <span class="table-skeleton-block table-skeleton-th"></span>',
                '    <span class="table-skeleton-block table-skeleton-th"></span>',
                '    <span class="table-skeleton-block table-skeleton-th"></span>',
                '    <span class="table-skeleton-block table-skeleton-th"></span>',
                '  </div>',
                '  <div class="table-skeleton-row">',
                '    <span class="table-skeleton-block table-skeleton-td"></span>'.repeat(8),
                '  </div>',
                '  <div class="table-skeleton-row">',
                '    <span class="table-skeleton-block table-skeleton-td"></span>'.repeat(8),
                '  </div>',
                '  <div class="table-skeleton-row">',
                '    <span class="table-skeleton-block table-skeleton-td"></span>'.repeat(8),
                '  </div>',
                '  <div class="table-skeleton-row">',
                '    <span class="table-skeleton-block table-skeleton-td"></span>'.repeat(8),
                '  </div>',
                '</div>'
            ].join('');
            tableWrapper.appendChild(overlay);
        }
        tableWrapper.classList.add('table-skeleton-host', 'table-skeleton-loading');
        overlay.style.display = 'flex';
    } else if (overlay) {
        tableWrapper.classList.remove('table-skeleton-loading');
        overlay.style.display = 'none';
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
// EXPORTS
// ==========================================

// Public API (preserves original exports)
window.IDCardApp.renderTable = renderTable;
window.IDCardApp.goToPage = goToPage;
window.IDCardApp.goToFirstPage = goToFirstPage;
window.IDCardApp.goToPrevPage = goToPrevPage;
window.IDCardApp.goToNextPage = goToNextPage;
window.IDCardApp.goToLastPage = goToLastPage;
window.IDCardApp.setRowsPerPage = setRowsPerPage;
window.IDCardApp.showTableLoadingOverlay = showTableLoadingOverlay;
window.IDCardApp.handleBrokenImages = handleBrokenImages;

// Internal helpers for other table sub-modules
window.IDCardApp._showLazyLoadIndicator = showLazyLoadIndicator;
window.IDCardApp.updateLazyLoadPaginationInfo = updateLazyLoadPaginationInfo;
window.IDCardApp._updatePaginationInfoEndless = updatePaginationInfoEndless;
window.IDCardApp._updatePageNumbersForEndless = updatePageNumbersForEndless;

})();
