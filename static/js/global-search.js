/**
 * Global Search Module (global-search.js)
 * 
 * Self-contained module that provides global ID card search via Ctrl+K.
 * Auto-injects the search button into the topbar and the search overlay into the body.
 * Works on any page — just include this script.
 */
(function () {
    'use strict';

    // ==========================================
    // AUTO-INJECT HTML
    // ==========================================

    function injectSearchButton() {
        // Don't inject if button already exists (backwards compat with dashboard pages)
        if (document.getElementById('globalSearchBtn')) return;

        // Only show the visible search button on dashboard pages.
        // Other pages still get Ctrl+K via the overlay + keyboard shortcut.
        const isDashboard = !!document.querySelector('.dashboard-content');
        if (!isDashboard) return;

        const topbar = document.querySelector('.topbar');
        if (!topbar) return;

        let navRight = topbar.querySelector('.nav-right');

        if (!navRight) {
            navRight = document.createElement('div');
            navRight.className = 'nav-right';
            topbar.appendChild(navRight);
        }

        const btn = document.createElement('button');
        btn.className = 'global-search-btn';
        btn.id = 'globalSearchBtn';
        btn.innerHTML = `
            <i class="fa-solid fa-magnifying-glass"></i>
            <span>Search ID cards...</span>
            <kbd>Ctrl+K</kbd>
        `;
        navRight.insertBefore(btn, navRight.firstChild);
    }

    function injectSearchOverlay() {
        // Don't inject if overlay already exists
        if (document.getElementById('globalSearchOverlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 'global-search-overlay';
        overlay.id = 'globalSearchOverlay';
        overlay.innerHTML = `
            <div class="global-search-modal">
                <div class="global-search-header">
                    <div class="search-input-group">
                        <i class="fa-solid fa-magnifying-glass"></i>
                        <input type="text" id="globalSearchInput" placeholder="Search ID cards by name, address, mobile..." autocomplete="off">
                        <button class="clear-global-search" id="clearGlobalSearch" style="display: none;">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="search-filter-group">
                        <label>Filter:</label>
                        <select id="globalSearchFilter">
                            <option value="all">All Fields</option>
                            <option value="name">Name</option>
                            <option value="address">Address</option>
                            <option value="mobile">Mobile</option>
                        </select>
                    </div>
                    <button class="close-global-search" id="closeGlobalSearch">
                        <i class="fa-solid fa-xmark"></i>
                        <span>ESC</span>
                    </button>
                </div>
                <div class="global-search-body" id="globalSearchResults">
                    <div class="search-placeholder">
                        <i class="fa-solid fa-search"></i>
                        <p>Search across all ID cards</p>
                        <span>Enter at least 2 characters to search</span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    // ==========================================
    // SEARCH LOGIC
    // ==========================================

    let searchTimeout = null;

    function getEl(id) { return document.getElementById(id); }

    function openGlobalSearch() {
        const overlay = getEl('globalSearchOverlay');
        if (overlay) {
            overlay.classList.add('active');
            setTimeout(() => {
                const input = getEl('globalSearchInput');
                if (input) input.focus();
            }, 100);
        }
    }

    function closeGlobalSearch() {
        const overlay = getEl('globalSearchOverlay');
        const input = getEl('globalSearchInput');
        const clearBtn = getEl('clearGlobalSearch');
        const results = getEl('globalSearchResults');

        if (overlay) overlay.classList.remove('active');
        if (input) input.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        if (results) {
            results.innerHTML = `
                <div class="search-placeholder">
                    <i class="fa-solid fa-search"></i>
                    <p>Search across all ID cards</p>
                    <span>Enter at least 2 characters to search</span>
                </div>
            `;
        }
    }

    function performSearch(query) {
        const filter = getEl('globalSearchFilter')?.value || 'all';
        const results = getEl('globalSearchResults');

        ApiClient.get(`/panel/api/global-search/?q=${encodeURIComponent(query)}&filter=${filter}`)
            .then(data => {
                if (data.success) {
                    displayResults(data.results, query);
                } else if (results) {
                    const _esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                    results.innerHTML = `
                        <div class="global-search-no-results">
                            <i class="fa-solid fa-exclamation-circle"></i>
                            <p>Error: ${_esc(data.message)}</p>
                        </div>
                    `;
                }
            })
            .catch(() => {
                if (results) {
                    results.innerHTML = `
                        <div class="global-search-no-results">
                            <i class="fa-solid fa-exclamation-circle"></i>
                            <p>Error searching. Please try again.</p>
                        </div>
                    `;
                }
            });
    }

    function displayResults(results, query) {
        const container = getEl('globalSearchResults');
        if (!container) return;

        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

        if (results.length === 0) {
            container.innerHTML = `
                <div class="global-search-no-results">
                    <i class="fa-solid fa-search"></i>
                    <p>No results found for "${esc(query)}"</p>
                </div>
            `;
            return;
        }

        let html = `<div class="global-search-results-header">${results.length} result${results.length > 1 ? 's' : ''} found</div>`;

        results.forEach(function (result) {
            // Use thumbnail for search results for faster loading
            let photoSrc = result.photo;
            let thumbSrc = null;
            if (result.photo && window.getThumbPath) {
                // Extract path from /media/... URL
                const mediaPath = result.photo.replace(/^\/media\//, '');
                const thumbPath = window.getThumbPath(mediaPath);
                if (thumbPath) {
                    thumbSrc = `/media/${thumbPath}`;
                }
            }
            
            const iconHtml = result.photo
                ? `<img src="${thumbSrc ? esc(thumbSrc) : esc(photoSrc)}" class="result-photo" alt="Photo" ${thumbSrc ? `onerror="this.onerror=null; this.src='${esc(photoSrc)}';"` : ''}>`
                : `<div class="result-icon ${esc(result.type)}"><i class="fa-solid ${esc(result.icon)}"></i></div>`;

            html += `
                <div class="global-search-result-item" data-url="${esc(result.url)}">
                    ${iconHtml}
                    <div class="result-info">
                        <div class="result-title">${esc(result.title)}</div>
                        <div class="result-subtitle">${esc(result.subtitle)}</div>
                        <div class="result-match">Match: <strong>${esc(result.matched_field)}</strong> = "${esc(result.matched_value)}"</div>
                    </div>
                    <i class="fa-solid fa-chevron-right result-arrow"></i>
                </div>
            `;
        });

        container.innerHTML = html;

        container.querySelectorAll('.global-search-result-item').forEach(function (item) {
            item.addEventListener('click', function () {
                const url = this.getAttribute('data-url');
                if (url && url !== '#') {
                    this.innerHTML = `
                        <div class="result-icon"><i class="fa-solid fa-spinner fa-spin"></i></div>
                        <div class="result-info">
                            <div class="result-title">Loading...</div>
                            <div class="result-subtitle">Navigating to the record</div>
                        </div>
                    `;
                    this.style.pointerEvents = 'none';
                    window.location.href = url;
                }
            });
        });
    }

    // ==========================================
    // EVENT WIRING
    // ==========================================

    function initEvents() {
        const searchBtn = getEl('globalSearchBtn');
        const overlay = getEl('globalSearchOverlay');
        const input = getEl('globalSearchInput');
        const filter = getEl('globalSearchFilter');
        const clearBtn = getEl('clearGlobalSearch');
        const closeBtn = getEl('closeGlobalSearch');
        const resultsEl = getEl('globalSearchResults');

        // Button click
        if (searchBtn) {
            searchBtn.addEventListener('click', openGlobalSearch);
        }

        // Ctrl+K / Cmd+K
        document.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                openGlobalSearch();
            }
            if (e.key === 'Escape' && overlay?.classList.contains('active')) {
                closeGlobalSearch();
            }
        });

        // Close button
        if (closeBtn) {
            closeBtn.addEventListener('click', closeGlobalSearch);
        }

        // Click outside modal
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === this) closeGlobalSearch();
            });
        }

        // Clear search
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                if (input) input.value = '';
                this.style.display = 'none';
                if (input) input.focus();
                if (resultsEl) {
                    resultsEl.innerHTML = `
                        <div class="search-placeholder">
                            <i class="fa-solid fa-search"></i>
                            <p>Search across all ID cards</p>
                            <span>Enter at least 2 characters to search</span>
                        </div>
                    `;
                }
            });
        }

        // Search input
        if (input) {
            input.addEventListener('input', function () {
                const query = this.value.trim();

                if (clearBtn) {
                    clearBtn.style.display = query.length > 0 ? 'flex' : 'none';
                }

                if (searchTimeout) clearTimeout(searchTimeout);

                if (query.length < 2) {
                    if (resultsEl) {
                        resultsEl.innerHTML = `
                            <div class="search-placeholder">
                                <i class="fa-solid fa-search"></i>
                                <p>${query.length === 0 ? 'Search across all ID cards' : 'Enter at least 2 characters'}</p>
                                <span>Enter at least 2 characters to search</span>
                            </div>
                        `;
                    }
                    return;
                }

                if (resultsEl) {
                    resultsEl.innerHTML = `
                        <div class="global-search-loading">
                            <i class="fa-solid fa-spinner fa-spin"></i>
                            <p>Searching...</p>
                        </div>
                    `;
                }

                searchTimeout = setTimeout(function () {
                    performSearch(query);
                }, 200);
            });
        }

        // Filter change
        if (filter) {
            filter.addEventListener('change', function () {
                const query = input?.value.trim();
                if (query && query.length >= 2) {
                    performSearch(query);
                }
            });
        }
    }

    // ==========================================
    // BOOTSTRAP
    // ==========================================

    function init() {
        injectSearchButton();
        injectSearchOverlay();
        initEvents();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for external use
    window.GlobalSearch = {
        open: openGlobalSearch,
        close: closeGlobalSearch
    };
})();
