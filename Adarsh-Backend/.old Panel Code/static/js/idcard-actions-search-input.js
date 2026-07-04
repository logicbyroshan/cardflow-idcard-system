// ID Card Actions - Search Input Sub-module
// Contains: Search input handlers, search all modal, display results
// Split from: idcard-actions-search.js

(function() {
'use strict';

window.IDCardApp = window.IDCardApp || {};

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
                if (searchInput.value.trim()) {
                    searchClearBtn.classList.add('visible');
                } else {
                    searchClearBtn.classList.remove('visible');
                }
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
                    IDCardApp.applyClassSectionFilters();
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
                    IDCardApp.applyClassSectionFilters();
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
                    IDCardApp.applyClassSectionFilters();
                }
                searchInput.focus();
            });
        }
    }
}

// ==========================================
// SEARCH ALL MODAL
// ==========================================

let searchAllTimeout = null;
let searchAllSkeletonStart = 0;
let searchAllRequestSeq = 0;

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
        if (searchAllTimeout) {
            clearTimeout(searchAllTimeout);
            searchAllTimeout = null;
        }
        searchAllSkeletonStart = 0;
        searchAllRequestSeq += 1;
        if (searchAllInput) searchAllInput.value = '';
        if (clearSearchInput) clearSearchInput.style.display = 'none';
        if (searchResultsContainer) {
            searchResultsContainer.innerHTML = `
                <div class="search-placeholder">
                    <i class="fa-solid fa-magnifying-glass"></i>
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

        const waitForMinDelay = window.waitForMinDelay || function () { return Promise.resolve(); };
        const skeletonStart = searchAllSkeletonStart || Date.now();
        const requestSeq = ++searchAllRequestSeq;
        
        ApiClient.get(`/api/table/${tableId}/cards/search/?q=${encodeURIComponent(query)}`)
            .then(data => {
                return waitForMinDelay(skeletonStart).then(() => data);
            })
            .then(data => {
                if (requestSeq !== searchAllRequestSeq) return;
                searchAllSkeletonStart = 0;
                if (data.success) {
                    displaySearchResults(data.results, query, searchResultsContainer, closeSearchAllModalFn);
                } else if (searchResultsContainer) {
                    searchResultsContainer.innerHTML = `
                        <div class="search-no-results">
                            <i class="fa-solid fa-circle-exclamation"></i>
                            <p>Error: ${data.message}</p>
                        </div>
                    `;
                }
            })
            .catch(error => {
                console.error('Search error:', error);
                waitForMinDelay(skeletonStart).then(() => {
                    if (requestSeq !== searchAllRequestSeq) return;
                    searchAllSkeletonStart = 0;
                    if (searchResultsContainer) {
                        searchResultsContainer.innerHTML = `
                            <div class="search-no-results">
                                <i class="fa-solid fa-circle-exclamation"></i>
                                <p>Error searching. Please try again.</p>
                            </div>
                        `;
                    }
                });
            });
    }
    
    if (searchAllBtn) {
        searchAllBtn.addEventListener('click', openSearchAllModal);
    }
    
    if (closeSearchAllModal) {
        closeSearchAllModal.addEventListener('click', closeSearchAllModalFn);
    }
    
    if (searchAllModalOverlay) {
        // Disabled  prevent accidental closure on outside click
    }
    
    if (clearSearchInput) {
        clearSearchInput.addEventListener('click', function() {
            if (searchAllInput) searchAllInput.value = '';
            this.style.display = 'none';
            searchAllSkeletonStart = 0;
            searchAllRequestSeq += 1;
            if (searchResultsContainer) {
                searchResultsContainer.innerHTML = `
                    <div class="search-placeholder">
                        <i class="fa-solid fa-magnifying-glass"></i>
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
                searchAllSkeletonStart = 0;
                searchAllRequestSeq += 1;
                if (searchResultsContainer) {
                    searchResultsContainer.innerHTML = `
                        <div class="search-placeholder">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <p>${query.length === 0 ? 'Type to search across all lists' : 'Enter at least 2 characters'}</p>
                        </div>
                    `;
                }
                return;
            }
            
            if (searchResultsContainer) {
                searchAllSkeletonStart = Date.now();
                searchResultsContainer.innerHTML = `
                    <div class="search-loading search-loading-skeleton" aria-hidden="true">
                        <div class="search-loading-skeleton-row">
                            <span class="search-loading-skeleton-avatar"></span>
                            <span class="search-loading-skeleton-line search-loading-skeleton-line-lg"></span>
                        </div>
                        <div class="search-loading-skeleton-row">
                            <span class="search-loading-skeleton-avatar"></span>
                            <span class="search-loading-skeleton-line search-loading-skeleton-line-md"></span>
                        </div>
                        <div class="search-loading-skeleton-row">
                            <span class="search-loading-skeleton-avatar"></span>
                            <span class="search-loading-skeleton-line search-loading-skeleton-line-sm"></span>
                        </div>
                    </div>
                    <span class="sr-only">Searching...</span>
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
                <i class="fa-solid fa-magnifying-glass"></i>
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
            <div class="search-result-item" data-card-id="${_esc(String(result.id))}" data-status="${_esc(result.status)}">
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
            
            if (window.IDCardPage && typeof window.IDCardPage.navigateStatusNoReload === 'function') {
                window.IDCardPage.navigateStatusNoReload(status, cardId);
            } else {
                const currentUrl = new URL(window.location.href);
                currentUrl.searchParams.set('status', status);
                currentUrl.searchParams.set('highlight', cardId);
                currentUrl.searchParams.set('_shell', '1');
                if (window.IDCardPage && typeof window.IDCardPage.swapMainShellNoReload === 'function') {
                    window.IDCardPage.swapMainShellNoReload(currentUrl).catch(function(err) {
                        console.warn('search-result no-reload fallback failed:', err);
                        if (typeof showToast === 'function') {
                            showToast('Unable to open result without reload right now. Please retry.', 'warning');
                        }
                    });
                } else {
                    console.warn('search-result no-reload fallback unavailable');
                }
            }
        });
    });
}

// ==========================================
// INITIALIZATION
// ==========================================

function initSearchModule() {
    initSearchHandlers();
    IDCardApp.initFilterHandlers();
    IDCardApp.initSortHandlers();
    IDCardApp.initRowsPerPageHandlers();
    initSearchAllModal();
    IDCardApp.initImageSortModal();
}

// Expose on IDCardApp namespace
IDCardApp.initSearchModule = initSearchModule;
IDCardApp.initSearchAllModal = initSearchAllModal;
IDCardApp.initSearchHandlers = initSearchHandlers;

})();
