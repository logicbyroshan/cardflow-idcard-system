/**
 * Global Search Module (global-search.js)
 * 
 * Self-contained module that provides global ID card search via Ctrl+K.
 * Auto-injects the search button into the topbar and the search overlay into the body.
 * Works on any page  just include this script.
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
                    <div class="search-filter-group" id="globalSearchFilterGroup">
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
                        <i class="fa-solid fa-magnifying-glass"></i>
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
    let searchSkeletonStart = 0;
    let searchRequestSeq = 0;
    let currentSearchMode = 'idcard';
    let clientQuickListCache = null;
    let clientQuickListPromise = null;
    const waitForMinDelay = window.waitForMinDelay || function () { return Promise.resolve(); };

    function getEl(id) { return document.getElementById(id); }

    function getPanelBasePath() {
        return window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';
    }

    function panelUrl(path) {
        if (!path) return path;
        if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) return path;
        const normalized = path.charAt(0) === '/' ? path : '/' + path;
        return getPanelBasePath() + normalized;
    }

    function getClientQuickScope() {
        return {
            title: 'Search clients to open ID Card Group',
            hint: 'Type a client name and jump directly to that client\'s ID Card Group page.',
        };
    }

    function getGlobalHomeUrl() {
        const sidebarHome = document.querySelector('.sidebar nav a[href] i.fa-house')?.closest('a[href]');
        if (sidebarHome) {
            return sidebarHome.getAttribute('href');
        }

        const breadcrumbHome = document.querySelector('.breadcrumb a[href]');
        if (breadcrumbHome) {
            return breadcrumbHome.getAttribute('href');
        }

        return panelUrl('/dashboard/');
    }

    function goHomeFromShortcut() {
        const homeUrl = getGlobalHomeUrl();
        if (homeUrl) {
            window.location.href = homeUrl;
        }
    }

    function parseCurrentActionsTableId() {
        const path = String(window.location.pathname || '');
        const match = path.match(/\/table\/(\d+)\/actions\/?$/i);
        if (!match) return null;
        const tableId = parseInt(match[1], 10);
        return Number.isFinite(tableId) && tableId > 0 ? tableId : null;
    }

    function getSearchScopeContext() {
        const onActionsPage = !!document.querySelector('main.idcard-actions-page');
        const tableId = onActionsPage ? parseCurrentActionsTableId() : null;
        if (onActionsPage && tableId) {
            return {
                mode: 'table',
                tableId,
                title: 'Search this list (all statuses)',
                hint: 'Searches this table across Pending, Verified, Pool, Approved, Download, Reprint.',
            };
        }

        return {
            mode: 'global',
            tableId: null,
            title: 'Search across all ID cards',
            hint: 'Enter at least 2 characters to search',
        };
    }

    function renderPlaceholder(container, scope, titleOverride) {
        if (!container) return;
        const title = titleOverride || scope.title;
        container.innerHTML = `
            <div class="search-placeholder">
                <i class="fa-solid fa-magnifying-glass"></i>
                <p>${title}</p>
                <span>${scope.hint}</span>
            </div>
        `;
    }

    function renderSearchLoadingSkeleton(container) {
        if (!container) return;
        container.innerHTML = `
            <div class="global-search-loading global-search-loading-skeleton" aria-hidden="true">
                <div class="global-search-skeleton-row">
                    <span class="global-search-skeleton-icon"></span>
                    <span class="global-search-skeleton-line global-search-skeleton-line-lg"></span>
                </div>
                <div class="global-search-skeleton-row">
                    <span class="global-search-skeleton-icon"></span>
                    <span class="global-search-skeleton-line global-search-skeleton-line-md"></span>
                </div>
                <div class="global-search-skeleton-row">
                    <span class="global-search-skeleton-icon"></span>
                    <span class="global-search-skeleton-line global-search-skeleton-line-sm"></span>
                </div>
            </div>
            <span class="sr-only">Searching...</span>
        `;
    }

    function buildGlobalSearchUrl(query, filter) {
        const scope = getSearchScopeContext();
        let url = `${panelUrl('/api/global-search/')}?q=${encodeURIComponent(query)}&filter=${encodeURIComponent(filter)}`;
        if (scope.mode === 'table' && scope.tableId) {
            url += `&table_id=${encodeURIComponent(String(scope.tableId))}`;
        }
        return url;
    }

    function setSearchMode(mode) {
        currentSearchMode = mode === 'client' ? 'client' : 'idcard';

        const input = getEl('globalSearchInput');
        const filterGroup = getEl('globalSearchFilterGroup');

        if (filterGroup) {
            filterGroup.style.display = currentSearchMode === 'client' ? 'none' : '';
        }

        if (input) {
            if (currentSearchMode === 'client') {
                input.placeholder = 'Search clients by name...';
                input.setAttribute('aria-label', 'Search clients');
            }
        }
    }

    function normalizeClientList(data) {
        const clients = Array.isArray(data && data.clients) ? data.clients : [];
        return clients
            .map(function (item) {
                const id = Number(item && item.id);
                const name = String(item && item.name ? item.name : '').trim();
                const status = String(item && item.status ? item.status : 'active').trim().toLowerCase();
                return {
                    id: Number.isFinite(id) ? id : null,
                    name,
                    status: status || 'active',
                };
            })
            .filter(function (item) {
                return item.id !== null && item.name.length > 0;
            })
            .sort(function (a, b) {
                return a.name.localeCompare(b.name);
            });
    }

    function fetchQuickClientList() {
        if (Array.isArray(clientQuickListCache)) {
            return Promise.resolve(clientQuickListCache);
        }

        if (clientQuickListPromise) {
            return clientQuickListPromise;
        }

        const allClientsUrl = panelUrl('/api/client/messages/targets/?limit=1000');
        const assignmentClientsUrl = (String(window.location.pathname || '').indexOf('/panel/client/') === 0)
            ? panelUrl('/client/api/groups/active/')
            : panelUrl('/api/client-staff/clients/');
        const activeUrl = panelUrl('/api/clients/active/');

        // If we're on a client-scoped page, skip the admin-only assignmentClientsUrl
        // which attempts `/panel/api/client-staff/clients/` and returns 403 for client users.
        const isClientPage = String(window.location.pathname || '').indexOf('/panel/client/') === 0;

        if (isClientPage) {
            clientQuickListPromise = ApiClient.get(allClientsUrl)
                .then(function (data) {
                    if (!data || !data.success) throw new Error('Failed to load clients');
                    clientQuickListCache = normalizeClientList(data);
                    return clientQuickListCache;
                })
                .catch(function () {
                    return ApiClient.get(activeUrl).then(function (data) {
                        if (!data || !data.success) throw new Error('Failed to load clients');
                        clientQuickListCache = normalizeClientList(data);
                        return clientQuickListCache;
                    });
                })
                .finally(function () {
                    clientQuickListPromise = null;
                });
        } else {
            clientQuickListPromise = ApiClient.get(allClientsUrl)
                .then(function (data) {
                    if (!data || !data.success) throw new Error('Failed to load clients');
                    clientQuickListCache = normalizeClientList(data);
                    return clientQuickListCache;
                })
                .catch(function () {
                    return ApiClient.get(assignmentClientsUrl).then(function (data) {
                        if (!data || !data.success) throw new Error('Failed to load clients');
                        clientQuickListCache = normalizeClientList(data);
                        return clientQuickListCache;
                    });
                })
                .catch(function () {
                    return ApiClient.get(activeUrl).then(function (data) {
                        if (!data || !data.success) throw new Error('Failed to load clients');
                        clientQuickListCache = normalizeClientList(data);
                        return clientQuickListCache;
                    });
                })
                .finally(function () {
                    clientQuickListPromise = null;
                });
        }

        return clientQuickListPromise;
    }

    function clientGroupUrl(clientId) {
        return panelUrl('/client/' + encodeURIComponent(String(clientId)) + '/groups/');
    }

    function displayClientQuickResults(results, query) {
        const container = getEl('globalSearchResults');
        if (!container) return;

        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

        if (!results.length) {
            container.innerHTML = `
                <div class="global-search-no-results">
                    <i class="fa-solid fa-users"></i>
                    <p>No clients found for "${esc(query)}"</p>
                </div>
            `;
            return;
        }

        let html = `<div class="global-search-results-header">${results.length} client${results.length > 1 ? 's' : ''} found</div>`;
        results.forEach(function (client) {
            const statusClass = esc(String(client.status || 'active').toLowerCase());
            const statusLabel = statusClass === 'active' ? 'Active' : esc(statusClass);
            html += `
                <div class="global-search-result-item" data-client-id="${esc(String(client.id))}">
                    <div class="result-icon idcard"><i class="fa-solid fa-building"></i></div>
                    <div class="result-info">
                        <div class="result-title">${esc(client.name)}</div>
                        <div class="result-subtitle">Open ID Card Group</div>
                        <div class="result-meta-row">
                            <span class="result-list-name">Client Quick Switch</span>
                            <span class="result-status-pill ${statusClass}">${statusLabel}</span>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right result-arrow"></i>
                </div>
            `;
        });

        container.innerHTML = html;
        container.querySelectorAll('.global-search-result-item').forEach(function (item) {
            item.addEventListener('click', function () {
                const clientId = parseInt(this.getAttribute('data-client-id'), 10);
                if (!Number.isFinite(clientId)) return;
                window.location.href = clientGroupUrl(clientId);
            });
        });
    }

    function performClientQuickSearch(query) {
        const results = getEl('globalSearchResults');
        const requestSeq = ++searchRequestSeq;
        const skeletonStart = searchSkeletonStart || Date.now();

        fetchQuickClientList()
            .then(function (clients) {
                return waitForMinDelay(skeletonStart).then(function () {
                    return clients;
                });
            })
            .then(function (clients) {
                if (requestSeq !== searchRequestSeq || currentSearchMode !== 'client') return;
                searchSkeletonStart = 0;
                const normalizedQuery = String(query || '').trim().toLowerCase();
                const filtered = clients.filter(function (client) {
                    return client.name.toLowerCase().includes(normalizedQuery);
                });
                displayClientQuickResults(filtered, query);
            })
            .catch(function () {
                waitForMinDelay(skeletonStart).then(function () {
                    if (requestSeq !== searchRequestSeq || currentSearchMode !== 'client') return;
                    searchSkeletonStart = 0;
                    if (results) {
                        results.innerHTML = `
                            <div class="global-search-no-results">
                                <i class="fa-solid fa-circle-exclamation"></i>
                                <p>Unable to load client list right now.</p>
                            </div>
                        `;
                    }
                });
            });
    }

    let _searchTriggerEl = null;

    function openGlobalSearch(options) {
        const mode = options && options.mode === 'client' ? 'client' : 'idcard';
        _searchTriggerEl = document.activeElement;
        const overlay = getEl('globalSearchOverlay');
        if (overlay) {
            overlay.classList.add('active');
            setSearchMode(mode);
            const scope = mode === 'client' ? getClientQuickScope() : getSearchScopeContext();
            const input = getEl('globalSearchInput');
            if (input) {
                if (mode === 'idcard') {
                    input.placeholder = scope.mode === 'table'
                        ? 'Search this list across all statuses...'
                        : 'Search ID cards by name, address, mobile...';
                }
                input.setAttribute('aria-label', scope.title);
            }
            renderPlaceholder(getEl('globalSearchResults'), scope);
            setTimeout(() => {
                const focusInput = getEl('globalSearchInput');
                if (focusInput) focusInput.focus();
            }, 100);
        }
    }

    function closeGlobalSearch() {
        const overlay = getEl('globalSearchOverlay');
        const input = getEl('globalSearchInput');
        const clearBtn = getEl('clearGlobalSearch');
        const results = getEl('globalSearchResults');
        const scope = currentSearchMode === 'client' ? getClientQuickScope() : getSearchScopeContext();

        if (overlay) overlay.classList.remove('active');
        if (input) input.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        searchSkeletonStart = 0;
        searchRequestSeq += 1;
        if (searchTimeout) {
            clearTimeout(searchTimeout);
            searchTimeout = null;
        }
        renderPlaceholder(results, scope);
        setSearchMode('idcard');
        // Restore focus to trigger element (a11y)
        if (_searchTriggerEl && typeof _searchTriggerEl.focus === 'function') {
            _searchTriggerEl.focus();
            _searchTriggerEl = null;
        }
    }

    function isGenerateEditorModalOpen() {
        const modal = document.getElementById('gcEditorModal');
        if (!modal) return false;
        if (modal.classList && modal.classList.contains('hidden')) return false;
        if (modal.getAttribute('aria-hidden') === 'true') return false;
        if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            const style = window.getComputedStyle(modal);
            if (style && (style.display === 'none' || style.visibility === 'hidden')) {
                return false;
            }
        }
        return true;
    }

    function performSearch(query) {
        if (currentSearchMode === 'client') {
            performClientQuickSearch(query);
            return;
        }

        const skeletonStart = searchSkeletonStart || Date.now();
        const filter = getEl('globalSearchFilter')?.value || 'all';
        const results = getEl('globalSearchResults');
        const requestSeq = ++searchRequestSeq;

        ApiClient.get(buildGlobalSearchUrl(query, filter))
            .then(data => {
                return waitForMinDelay(skeletonStart).then(() => data);
            })
            .then(data => {
                if (requestSeq !== searchRequestSeq) return;
                searchSkeletonStart = 0;
                if (data.success) {
                    displayResults(data.results || [], query);
                } else if (results) {
                    const _esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                    results.innerHTML = `
                        <div class="global-search-no-results">
                            <i class="fa-solid fa-circle-exclamation"></i>
                            <p>${_esc(data.message || 'Search failed')}</p>
                        </div>
                    `;
                }
            })
            .catch(() => {
                waitForMinDelay(skeletonStart).then(() => {
                    if (requestSeq !== searchRequestSeq) return;
                    searchSkeletonStart = 0;
                    if (results) {
                        results.innerHTML = `
                            <div class="global-search-no-results">
                                <i class="fa-solid fa-circle-exclamation"></i>
                                <p>Something went wrong. Please try again.</p>
                            </div>
                        `;
                    }
                });
            });
    }

    function displayResults(results, query) {
        const container = getEl('globalSearchResults');
        if (!container) return;

        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

        if (results.length === 0) {
            container.innerHTML = `
                <div class="global-search-no-results">
                    <i class="fa-solid fa-magnifying-glass"></i>
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

            const statusClass = esc(String(result.status || '').toLowerCase());
            const statusDisplay = esc(result.status_display || 'Unknown');
            const listName = esc(result.table_name || 'Unknown List');

            html += `
                <div class="global-search-result-item" data-url="${esc(result.url)}" data-status="${statusClass}" data-card-id="${esc(String(result.id || ''))}" data-table-id="${esc(String(result.table_id || ''))}">
                    ${iconHtml}
                    <div class="result-info">
                        <div class="result-title">${esc(result.title)}</div>
                        <div class="result-subtitle">${esc(result.subtitle)}</div>
                        <div class="result-meta-row">
                            <span class="result-list-name">${listName}</span>
                            <span class="result-status-pill ${statusClass}">${statusDisplay}</span>
                        </div>
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
                const resultStatus = String(this.getAttribute('data-status') || '').toLowerCase();
                const cardId = parseInt(this.getAttribute('data-card-id'), 10);
                const resultTableId = parseInt(this.getAttribute('data-table-id'), 10);
                const currentScope = getSearchScopeContext();

                if (
                    currentScope.mode === 'table'
                    && Number.isFinite(resultTableId)
                    && resultTableId === currentScope.tableId
                    && window.IDCardPage
                    && typeof window.IDCardPage.navigateStatusNoReload === 'function'
                    && resultStatus
                    && Number.isFinite(cardId)
                ) {
                    closeGlobalSearch();
                    window.IDCardPage.navigateStatusNoReload(resultStatus, cardId);
                    return;
                }

                if (url && url !== '#') {
                    this.innerHTML = `
                        <div class="result-icon result-skeleton-icon" aria-hidden="true"></div>
                        <div class="result-info result-skeleton-info" aria-hidden="true">
                            <div class="result-skeleton-line result-skeleton-title"></div>
                            <div class="result-skeleton-line result-skeleton-subtitle"></div>
                        </div>
                        <span class="sr-only">Navigating to the record...</span>
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
            if (isGenerateEditorModalOpen()) {
                // Let generate-card modal own its shortcuts (Ctrl+K, etc.).
                return;
            }

            if (e.ctrlKey && e.shiftKey && (e.code === 'Space' || e.key === ' ')) {
                e.preventDefault();
                goHomeFromShortcut();
                return;
            }

            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                openGlobalSearch({ mode: 'client' });
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                openGlobalSearch();
                return;
            }
            if (e.key === 'Escape' && overlay?.classList.contains('active')) {
                closeGlobalSearch();
                return;
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
        }, true);

        // Close button
        if (closeBtn) {
            closeBtn.addEventListener('click', closeGlobalSearch);
        }

        // Click outside modal  disabled to prevent accidental closure
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
                searchSkeletonStart = 0;
                searchRequestSeq += 1;
                if (input) input.focus();
                renderPlaceholder(resultsEl, getSearchScopeContext());
            });
        }

        // Search input
        if (input) {
            input.addEventListener('input', function () {
                const query = this.value.trim();
                const minChars = currentSearchMode === 'client' ? 1 : 2;

                if (clearBtn) {
                    clearBtn.style.display = query.length > 0 ? 'flex' : 'none';
                }

                if (searchTimeout) clearTimeout(searchTimeout);

                if (query.length < minChars) {
                    searchSkeletonStart = 0;
                    searchRequestSeq += 1;
                    if (resultsEl) {
                        const scope = currentSearchMode === 'client' ? getClientQuickScope() : getSearchScopeContext();
                        renderPlaceholder(
                            resultsEl,
                            scope,
                            query.length === 0 ? scope.title : `Enter at least ${minChars} character${minChars > 1 ? 's' : ''}`
                        );
                    }
                    return;
                }

                if (resultsEl) {
                    searchSkeletonStart = Date.now();
                    renderSearchLoadingSkeleton(resultsEl);
                }

                searchTimeout = setTimeout(function () {
                    performSearch(query);
                }, 200);
            });
        }

        // Filter change
        if (filter) {
            filter.addEventListener('change', function () {
                if (currentSearchMode !== 'idcard') return;
                const query = input?.value.trim();
                if (query && query.length >= 2) {
                    if (resultsEl) {
                        searchSkeletonStart = Date.now();
                        renderSearchLoadingSkeleton(resultsEl);
                    }
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
