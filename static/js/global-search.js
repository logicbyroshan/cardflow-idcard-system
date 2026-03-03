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
        btn.setAttribute('aria-label', 'Search ID cards (Ctrl+K)');
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
            <div class="global-search-modal" role="dialog" aria-modal="true" aria-label="Search ID cards">
                <div class="global-search-header">
                    <div class="search-input-group">
                        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                        <input type="text" id="globalSearchInput" placeholder="Search ID cards by name, address, mobile..." autocomplete="off" aria-label="Search ID cards">
                        <button class="clear-global-search" id="clearGlobalSearch" style="display: none;" aria-label="Clear search">
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </div>
                    <div class="search-filter-group">
                        <label for="globalSearchFilter">Filter:</label>
                        <select id="globalSearchFilter">
                            <option value="all">All Fields</option>
                            <option value="name">Name</option>
                            <option value="address">Address</option>
                            <option value="mobile">Mobile</option>
                        </select>
                    </div>
                    <button class="close-global-search" id="closeGlobalSearch" aria-label="Close search">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        <span>ESC</span>
                    </button>
                </div>
                <div class="global-search-body" id="globalSearchResults" aria-live="polite">
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

    let _searchTriggerEl = null;

    function openGlobalSearch() {
        _searchTriggerEl = document.activeElement;
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
        // Restore focus to trigger element (a11y)
        if (_searchTriggerEl && typeof _searchTriggerEl.focus === 'function') {
            _searchTriggerEl.focus();
            _searchTriggerEl = null;
        }
    }

    function performSearch(query) {
        const filter = getEl('globalSearchFilter')?.value || 'all';
        const results = getEl('globalSearchResults');

        ApiClient.get(`/api/global-search/?q=${encodeURIComponent(query)}&filter=${filter}`)
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
            
            let iconHtml;
            if (result.photo) {
                iconHtml = `<img src="${thumbSrc ? esc(thumbSrc) : esc(photoSrc)}" class="result-photo" alt="Photo" onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='flex';" ${thumbSrc ? `data-full="${esc(photoSrc)}"` : ''}>` +
                    `<div class="result-icon idcard" style="display:none"><i class="fa-solid fa-user"></i></div>`;
            } else {
                iconHtml = `<div class="result-icon idcard"><i class="fa-solid fa-user"></i></div>`;
            }

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
            // Focus trap inside search modal (a11y)
            if (e.key === 'Tab' && overlay?.classList.contains('active')) {
                const modal = overlay.querySelector('.global-search-modal');
                if (!modal) return;
                const focusable = modal.querySelectorAll('input:not([disabled]), button:not([disabled]):not([style*="display: none"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
                if (!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault(); last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault(); first.focus();
                }
            }
        });

        // Close button
        if (closeBtn) {
            closeBtn.addEventListener('click', closeGlobalSearch);
        }

        // Click outside modal — disabled to prevent accidental closure
        // if (overlay) {
        //     overlay.addEventListener('click', function (e) {
        //         if (e.target === this) closeGlobalSearch();
        //     });
        // }

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
