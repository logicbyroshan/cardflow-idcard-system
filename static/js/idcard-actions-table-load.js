// ID Card Actions - Table Loading & Init Module
// Contains: Lazy loading, IntersectionObserver, resetAndReload, initTableModule
// Part of: idcard-actions-table split (state  render  load)

(function() {
'use strict';

window.IDCardApp = window.IDCardApp || {};
var _ts = window.IDCardApp._ts;

// ==========================================
// LAZY LOADING FUNCTIONS
// ==========================================

function _pinLazyLoadSentinelToBottom() {
    var tableBody = document.getElementById('cardsTableBody');
    var sentinel = document.getElementById('lazyLoadSentinel');
    if (tableBody && sentinel) {
        tableBody.appendChild(sentinel);
    }
}

async function loadMoreData() {
    if (_ts.lazyLoadState.isLoading || !_ts.lazyLoadState.hasMore || !_ts.lazyLoadState.tableId) {
        return;
    }
    
    _ts.lazyLoadState.isLoading = true;
    var mySeq = _ts._loadRequestSeq;   // capture sequence to detect stale responses
    window.IDCardApp._showLazyLoadIndicator(true);
    
    try {
        const url = `/api/table/${_ts.lazyLoadState.tableId}/cards/?${window.IDCardApp._buildFilterParams()}`;
        
        const data = await ApiClient.get(url, { timeout: 120000 });
        
        // Guard against stale responses after a resetAndReload / search change
        if (mySeq !== _ts._loadRequestSeq) return;

        // Always update pagination state from server (even for empty results)
        _ts.lazyLoadState.hasMore = data.has_more !== undefined ? data.has_more : false;
        _ts.lazyLoadState.totalCount = data.total_count !== undefined ? data.total_count : 0;
        
        if (data.cards && data.cards.length > 0) {
            const tableBody = document.getElementById('cardsTableBody');
            
            var dbSelectActive = window.IDCardApp.allDbCardIds && window.IDCardApp.allDbCardIds.length > 0;
            data.cards.forEach((card, index) => {
                // Prevent duplicates  skip if card already loaded (Set lookup is O(1))
                if (_ts._loadedCardIds.has(card.id)) return;
                _ts._loadedCardIds.add(card.id);
                const row = window.IDCardApp._createRowFromCard(card, index);
                tableBody.appendChild(row);
                _ts.allRows.push(row);

                // If "Select All DB" is active, auto-check newly loaded rows
                if (dbSelectActive) {
                    var cb = row.querySelector('.rowCheckbox');
                    if (cb) {
                        cb.checked = true;
                        row.classList.add('selected');
                    }
                }
            });

            // Keep sentinel at the true end so observer-based infinite loading
            // continues to work after direct page-jump preloading.
            _pinLazyLoadSentinelToBottom();
            
            _ts.lazyLoadState.loadedCount += data.cards.length;
            
            _ts.filteredRows = [..._ts.allRows];
            if (_ts.endlessScrollMode) {
                // In endless mode new rows are already in the DOM  just update pagination UI.
                // Calling full renderTable() here would hide/show ALL rows causing scroll jumps.
                window.IDCardApp._updatePaginationInfoEndless(_ts.filteredRows.length);
            } else {
                window.IDCardApp.renderTable();
            }
            
            // Handle any broken images in newly loaded rows
            window.IDCardApp.handleBrokenImages();
            
            window.IDCardApp.updateLazyLoadPaginationInfo();
            
            const paginationBar = document.getElementById('paginationBar');
            if (paginationBar) {
                paginationBar.dataset.hasMore = data.has_more.toString();
                paginationBar.dataset.totalCount = data.total_count.toString();
                // Don't update data-initial-loaded here  it represents the
                // server-rendered count and is read by _initLazyLoadState().
                // Overwriting it caused loadedCount=100 on reinit, making
                // the first lazy-load fetch offset=100 (sr_no 101+).
            }
        } else {
            // No results  update pagination UI with zero state
            _ts.filteredRows = [];
            window.IDCardApp.updateLazyLoadPaginationInfo();
        }
        
    } catch (error) {
        if (mySeq !== _ts._loadRequestSeq) {
            return;
        }
        if (error && (error.code === 'TIMEOUT' || error.name === 'AbortError')) {
            console.warn('Lazy-load request cancelled or timed out during a reload:', error);
            return;
        }
        console.error('Error loading more data:', error);
        if (typeof window.showToast === 'function') window.showToast('Failed to load more data', false);
    } finally {
        // Only reset isLoading if this is still the active request sequence.
        // Prevents stale responses from clearing isLoading for a newer load.
        if (mySeq === _ts._loadRequestSeq) {
            _ts.lazyLoadState.isLoading = false;
            window.IDCardApp._showLazyLoadIndicator(false);
        }
    }
}

function checkLoadMore() {
    if (!_ts.lazyLoadState.hasMore || _ts.lazyLoadState.isLoading) {
        return;
    }
    
    if (_ts.lazyLoadState.loadedCount < 200 && _ts.lazyLoadState.hasMore) {
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
    if (!_ts.lazyLoadState.hasMore || _ts.lazyLoadState.isLoading || !_ts.lazyLoadState.tableId) {
        return;
    }
    
    window.IDCardApp.showTableLoadingOverlay(true);
    
    try {
        while (_ts.lazyLoadState.hasMore) {
            await loadMoreData();
        }
    } finally {
        window.IDCardApp.showTableLoadingOverlay(false);
    }
}

// ==========================================
// INTERSECTION OBSERVER FOR LAZY LOADING
// ==========================================

/**
 * Sets up IntersectionObserver on a sentinel element at the bottom of the table.
 * Replaces both setInterval(1000) polling and scroll-based checkLoadMore().
 * Ensures only one request is active at a time via isLoading + sequence guard.
 */
function _setupLazyLoadObserver() {
    if (_ts._sentinelObserver) { _ts._sentinelObserver.disconnect(); _ts._sentinelObserver = null; }
    
    if (!_ts.lazyLoadState.hasMore) return;
    
    var tableContainer = document.querySelector('.idcard-table');
    if (!tableContainer) return;
    
    // Create or reuse sentinel element at bottom of table body
    var tableBody = document.getElementById('cardsTableBody');
    if (!tableBody) return;
    
    var sentinel = document.getElementById('lazyLoadSentinel');
    if (!sentinel) {
        sentinel = document.createElement('tr');
        sentinel.id = 'lazyLoadSentinel';
        sentinel.setAttribute('aria-hidden', 'true');
        sentinel.innerHTML = '<td colspan="50" style="height:1px;padding:0;border:none;"></td>';
        tableBody.appendChild(sentinel);
    } else {
        // Ensure sentinel is always at the end
        tableBody.appendChild(sentinel);
    }
    
    _ts._sentinelObserver = new IntersectionObserver(function(entries) {
        var entry = entries[0];
        if (entry && entry.isIntersecting && _ts.lazyLoadState.hasMore && !_ts.lazyLoadState.isLoading) {
            _sequencedLoadMore();
        }
    }, {
        root: tableContainer,
        rootMargin: '0px 0px 800px 0px',  // Trigger 800px before sentinel is visible
        threshold: 0
    });
    
    _ts._sentinelObserver.observe(sentinel);
    
    // Also trigger an initial check  if table is short and sentinel is already visible
    if (_ts.lazyLoadState.hasMore && !_ts.lazyLoadState.isLoading) {
        // Use rAF to avoid synchronous layout
        requestAnimationFrame(function() {
            if (_ts.lazyLoadState.hasMore && !_ts.lazyLoadState.isLoading) {
                _sequencedLoadMore();
            }
        });
    }
}

/**
 * Sequence-guarded load: prevents duplicate offset fetches.
 * Only one loadMoreData() runs at a time; subsequent calls are dropped.
 */
async function _sequencedLoadMore() {
    if (_ts.lazyLoadState.isLoading || _ts._loadCooldown) return;
    
    var seq = ++_ts._loadRequestSeq;
    
    await loadMoreData();
    
    // Cooldown prevents the IntersectionObserver from rapid-firing after each load.
    // Without this, the observer sees the sentinel still within rootMargin after
    // rows are appended and immediately triggers another load, creating a loop
    // that fetches ALL data at maximum speed.
    _ts._loadCooldown = true;
    setTimeout(function() { _ts._loadCooldown = false; }, 300);
    
    // If this was the latest request and there's still more, re-check sentinel
    if (seq === _ts._loadRequestSeq && _ts.lazyLoadState.hasMore) {
        // Move sentinel to end (new rows were appended above it)
        _pinLazyLoadSentinelToBottom();
    }
    
    // If no more data, disconnect observer
    if (!_ts.lazyLoadState.hasMore && _ts._sentinelObserver) {
        _ts._sentinelObserver.disconnect();
        _ts._sentinelObserver = null;
        // Remove sentinel
        var s = document.getElementById('lazyLoadSentinel');
        if (s) s.remove();
    }
}

// ==========================================
// RESET AND RELOAD
// ==========================================

/**
 * Reset table state and reload data from server with current filters.
 * Used when a server-side filter/sort changes (search, class, section, sort, image).
 */
async function resetAndReload() {
    // Bump sequence so any in-flight loadMoreData calls are discarded
    _ts._loadRequestSeq = (_ts._loadRequestSeq || 0) + 1;

    if (_ts._sentinelObserver) {
        _ts._sentinelObserver.disconnect();
        _ts._sentinelObserver = null;
    }

    //  Clear selection state so stale "select all" doesn't persist 
    window.IDCardApp.allDbCardIds = null;
    var selectAllCb = document.getElementById('selectAll');
    if (selectAllCb) selectAllCb.checked = false;
    // Uncheck any still-checked row checkboxes (about to be removed, but be safe)
    document.querySelectorAll('#cardsTableBody .rowCheckbox:checked').forEach(function(cb) {
        cb.checked = false;
        var row = cb.closest('tr');
        if (row) row.classList.remove('selected');
    });
    // Reset shift-click anchor
    if (typeof window.IDCardApp.resetShiftClickIndex === 'function') {
        window.IDCardApp.resetShiftClickIndex();
    }
    window.IDCardApp.updateButtonStates();

    // Clear all loaded rows from DOM
    var tableBody = document.getElementById('cardsTableBody');
    if (tableBody) {
        tableBody.querySelectorAll('tr[data-card-id]').forEach(function(row) { row.remove(); });
        tableBody.querySelectorAll('.no-results-row').forEach(function(row) { row.remove(); });
    }
    _ts.allRows = [];
    _ts.filteredRows = [];
    _ts._loadedCardIds.clear();

    // Reset lazy load state
    _ts.lazyLoadState.loadedCount = 0;
    _ts.lazyLoadState.hasMore = true;
    _ts.lazyLoadState.isLoading = false;
    _ts.lazyLoadState.totalCount = 0;

    // Show loading overlay
    window.IDCardApp.showTableLoadingOverlay(true);

    try {
        await loadMoreData();
    } finally {
        window.IDCardApp.showTableLoadingOverlay(false);
    }

    // Re-setup infinite scroll observer
    if (typeof _setupLazyLoadObserver === 'function') {
        _setupLazyLoadObserver();
    }
}

// ==========================================
// INITIALIZATION (supports re-init after HTMX swap)
// ==========================================

function initTableModule() {
    //  Cleanup previous init 
    if (_ts._lazyLoadInterval) { clearInterval(_ts._lazyLoadInterval); _ts._lazyLoadInterval = null; }
    if (_ts._scrollHandler && _ts._scrollTarget) {
        _ts._scrollTarget.removeEventListener('scroll', _ts._scrollHandler);
    }
    if (_ts._sentinelObserver) { _ts._sentinelObserver.disconnect(); _ts._sentinelObserver = null; }
    _ts._loadCooldown = false;
    _ts._loadRequestSeq = 0;
    _ts.lazyLoadState.isLoading = false;  // Reset so stale in-flight loads don't block new fetches

    //  Clear stale rows from DOM (prevents loadedCount=100 on re-init) 
    var tableBody = document.getElementById('cardsTableBody');
    if (tableBody) {
        tableBody.querySelectorAll('tr[data-card-id]').forEach(function(row) { row.remove(); });
        tableBody.querySelectorAll('.no-results-row').forEach(function(row) { row.remove(); });
        var sentinel = document.getElementById('lazyLoadSentinel');
        if (sentinel) sentinel.remove();
    }

    // Reset data-initial-loaded to 0 so _initLazyLoadState reads correct value
    var pagBar = document.getElementById('paginationBar');
    if (pagBar) pagBar.dataset.initialLoaded = '0';

    // Reset state
    _ts.allRows = [];
    _ts.filteredRows = [];
    _ts._loadedCardIds.clear();
    _ts.currentPage = 1;
    _ts.searchQuery = '';
    _ts.currentFilter = 'all';
    _ts.currentFilterField = 'all';
    _ts.endlessScrollMode = true;

    // Read per_page from pagination bar data attribute
    const paginationBar = document.getElementById('paginationBar');
    if (paginationBar && paginationBar.dataset.perPage) {
        _ts.rowsPerPage = parseInt(paginationBar.dataset.perPage) || 100;
    }

    window.IDCardApp._earlyInitLazyLoadState();
    window.IDCardApp.initializeRows();
    _ts.lazyLoadState.loadedCount = _ts.allRows.length;
    window.IDCardApp._initLazyLoadState();
    window.IDCardApp.renderTable();  // Single render after full init
    window.IDCardApp._highlightSearchResult();
    
    // Handle broken images after table render
    window.IDCardApp.handleBrokenImages();
    
    // Populate class/section filter dropdowns from table data
    if (typeof window.IDCardApp.populateFilterOptions === 'function') {
        window.IDCardApp.populateFilterOptions();
    }

    
    //  Delegated click handler for row actions + editable cells 
    window.IDCardApp._initTableBodyDelegation();

    //  IntersectionObserver-based lazy loading (replaces setInterval + scroll) 
    _setupLazyLoadObserver();
    
    // Scroll listener ONLY for pagination UI updates (not for lazy loading)
    const idcardTable = document.querySelector('.idcard-table');
    if (idcardTable) {
        let _scrollRafPending = false;
        _ts._scrollHandler = function() {
            if (_scrollRafPending) return;
            _scrollRafPending = true;
            requestAnimationFrame(function() {
                _scrollRafPending = false;
                if (_ts.endlessScrollMode) {
                    window.IDCardApp._updatePageNumbersForEndless(_ts.filteredRows.length);
                }
            });
        };
        _ts._scrollTarget = idcardTable;
        idcardTable.addEventListener('scroll', _ts._scrollHandler, { passive: true });
    }
    
    // Pagination button handlers (new elements after HTMX swap)
    document.getElementById('firstPage')?.addEventListener('click', window.IDCardApp.goToFirstPage);
    document.getElementById('prevPage')?.addEventListener('click', window.IDCardApp.goToPrevPage);
    document.getElementById('nextPage')?.addEventListener('click', window.IDCardApp.goToNextPage);
    document.getElementById('lastPage')?.addEventListener('click', window.IDCardApp.goToLastPage);
}

// ==========================================
// EXPORTS
// ==========================================

// Public API (preserves original exports)
window.IDCardApp.initTableModule = initTableModule;
window.IDCardApp.loadMoreData = loadMoreData;
window.IDCardApp.checkLoadMore = checkLoadMore;
window.IDCardApp.loadAllData = loadAllData;
window.IDCardApp.resetAndReload = resetAndReload;

})();
