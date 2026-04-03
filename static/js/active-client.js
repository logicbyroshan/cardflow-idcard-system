/**
 * Active Client JavaScript Module
 * Handles client selection, search/filter, and navigation to groups/settings
 */

(function() {
    'use strict';

    // ==================== STATE VARIABLES ====================
    let selectedClientId = null;
    let selectedRow = null;
    let expandedRow = null;
    let expandedDetailRow = null;
    let expandRequestToken = 0;
    let clientDetailsPromise = null;
    let clientDetailsMap = null;
    let currentFilter = 'all';
    let currentStatusFilter = new URLSearchParams(window.location.search).get('status') || '';
    const activeClientPerms = window.ACTIVE_CLIENT_PERMS || {};

    // ==================== DOM ELEMENTS ====================
    const elements = {
        // Table
        tbody: document.getElementById('client-table-body'),
        
        // Action Buttons
        groupSettingBtn: document.getElementById('group-setting-btn'),
        idcardGroupBtn: document.getElementById('idcard-group-btn'),
        
        // Search & Filter
        searchInput: document.getElementById('search-input'),
        searchClear: document.getElementById('search-clear') || document.getElementById('searchClearBtn'),
        filterDropdown: document.getElementById('filter-dropdown'),
        dropdownToggle: document.getElementById('dropdown-toggle'),
        dropdownOptions: document.getElementById('dropdown-options'),
        selectedText: document.getElementById('selected-text'),
        
        // Empty State
        emptyState: document.getElementById('empty-state')
    };

    function escapeHtml(value) {
        const text = String(value == null ? '' : value);
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function panelBasePath() {
        return window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';
    }

    function panelUrl(path) {
        if (!path) return path;
        if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) return path;
        const normalized = path.charAt(0) === '/' ? path : `/${path}`;
        return `${panelBasePath()}${normalized}`;
    }

    function clientGroupsUrl(clientId) {
        return `${panelBasePath()}/client/${encodeURIComponent(String(clientId))}/groups/`;
    }

    function clientSettingsUrl(clientId) {
        return `${panelBasePath()}/client/${encodeURIComponent(String(clientId))}/settings/`;
    }

    function idcardActionsUrl(tableId, status) {
        const safeStatus = encodeURIComponent(String(status || 'pending'));
        return `${panelBasePath()}/table/${encodeURIComponent(String(tableId))}/cards/?status=${safeStatus}`;
    }

    function idcardGroupBulkActionUrl(clientId, tableId, action) {
        return clientGroupsUrl(clientId);
    }

    function hasPerm(key) {
        if (activeClientPerms.isSuperAdmin) return true;
        return !!activeClientPerms[key];
    }

    function getClientRows() {
        return Array.from(document.querySelectorAll('#client-table-body tr.client-main-row'));
    }

    function clientHistoryApiUrl(clientId) {
        return `${panelBasePath()}/api/client/${encodeURIComponent(String(clientId))}/login-history/?limit=80`;
    }

    function ensureClientHistoryDrawer() {
        if (document.getElementById('clientHistoryDrawer')) return;

        const overlay = document.createElement('div');
        overlay.id = 'clientHistoryOverlay';
        overlay.className = 'drawer-overlay card-history-overlay';

        const drawer = document.createElement('aside');
        drawer.id = 'clientHistoryDrawer';
        drawer.className = 'side-drawer card-history-drawer';
        drawer.setAttribute('aria-hidden', 'true');
        drawer.innerHTML = '' +
            '<div class="drawer-header card-history-header">' +
                '<div>' +
                    '<div class="card-history-title">Client Login History</div>' +
                    '<div class="card-history-subtitle" id="clientHistorySubtitle">Login, logout, and devices</div>' +
                '</div>' +
                '<button type="button" class="drawer-close card-history-close" id="clientHistoryClose" aria-label="Close history">' +
                    '<i class="fa-solid fa-xmark"></i>' +
                '</button>' +
            '</div>' +
            '<div class="drawer-body card-history-body" id="clientHistoryBody">' +
                '<div class="card-history-empty">Select a client to view login history.</div>' +
            '</div>';

        document.body.appendChild(overlay);
        document.body.appendChild(drawer);

        function closeDrawer() {
            overlay.classList.remove('active');
            drawer.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        }

        overlay.addEventListener('click', closeDrawer);
        const closeBtn = document.getElementById('clientHistoryClose');
        if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

        document.addEventListener('keydown', function(evt) {
            if (evt.key === 'Escape') closeDrawer();
        });
    }

    function openClientHistoryDrawer() {
        ensureClientHistoryDrawer();
        const overlay = document.getElementById('clientHistoryOverlay');
        const drawer = document.getElementById('clientHistoryDrawer');
        if (!overlay || !drawer) return;
        overlay.classList.add('active');
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function renderClientHistoryLoading(clientName) {
        const subtitle = document.getElementById('clientHistorySubtitle');
        const body = document.getElementById('clientHistoryBody');
        if (subtitle) subtitle.textContent = clientName ? `Client: ${clientName}` : 'Loading';
        if (body) {
            body.innerHTML = '<div class="card-history-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading login history...</div>';
        }
    }

    function renderClientHistoryError(message) {
        const body = document.getElementById('clientHistoryBody');
        if (body) {
            body.innerHTML = `<div class="card-history-error">${escapeHtml(message || 'Unable to load login history.')}</div>`;
        }
    }

    function renderClientHistory(clientName, payload) {
        const subtitle = document.getElementById('clientHistorySubtitle');
        const body = document.getElementById('clientHistoryBody');
        if (!body) return;

        const activeDevices = Number(payload.active_devices || 0);
        if (subtitle) {
            subtitle.textContent = `${clientName || 'Client'} - Active devices: ${activeDevices}`;
        }

        const events = Array.isArray(payload.events) ? payload.events : [];
        if (!events.length) {
            body.innerHTML = '<div class="card-history-empty">No login history available for this client yet.</div>';
            return;
        }

        const fps = Array.isArray(payload.device_fingerprints) ? payload.device_fingerprints : [];

        const html = events.map(function(item) {
            const actionLabel = escapeHtml(item.action_display || item.action || 'Event');
            const description = escapeHtml(item.description || '');
            const ip = escapeHtml(item.ip_address || '-');
            const when = escapeHtml(item.created_at || '');
            const ago = escapeHtml(item.time_ago || '');
            const icon = escapeHtml(item.icon_class || 'fa-circle-info');

            let fpChips = '';
            if (fps.length) {
                fpChips = fps.slice(0, 3).map(function(fp) {
                    const shortFp = fp.length > 14 ? `${fp.slice(0, 14)}...` : fp;
                    return `<span class="client-history-chip client-history-chip--meta"><i class="fa-solid fa-laptop"></i> ${escapeHtml(shortFp)}</span>`;
                }).join('');
            }

            return '' +
                '<div class="card-history-item">' +
                    `<div class="card-history-when">${when}</div>` +
                    `<div class="card-history-what">${description || actionLabel}</div>` +
                    `<div class="card-history-meta">${ago}</div>` +
                    '<div class="client-history-chip-row">' +
                        `<span class="client-history-chip client-history-chip--action"><i class="fa-solid ${icon}"></i> ${actionLabel}</span>` +
                        `<span class="client-history-chip client-history-chip--meta"><i class="fa-solid fa-network-wired"></i> ${ip}</span>` +
                        `<span class="client-history-chip client-history-chip--meta"><i class="fa-solid fa-mobile-screen-button"></i> Active: ${activeDevices}</span>` +
                        fpChips +
                    '</div>' +
                '</div>';
        }).join('');

        body.innerHTML = `<div class="card-history-list">${html}</div>`;
    }

    function openClientHistory(clientId, clientName) {
        if (!clientId) return;

        openClientHistoryDrawer();
        renderClientHistoryLoading(clientName || 'Client');

        fetch(clientHistoryApiUrl(clientId), {
            method: 'GET',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin'
        })
            .then(function(resp) {
                return resp.json().then(function(data) {
                    if (!resp.ok || !data || !data.success) {
                        const message = data && data.message ? data.message : 'Failed to load login history.';
                        throw new Error(message);
                    }
                    return data;
                });
            })
            .then(function(data) {
                renderClientHistory(clientName || (data.client && data.client.name) || 'Client', data);
            })
            .catch(function(err) {
                renderClientHistoryError(err && err.message ? err.message : 'Failed to load login history.');
                if (typeof window.showToast === 'function') {
                    window.showToast('Unable to load client login history', 'error');
                }
            });
    }

    function removeExpandedDetailRow() {
        if (expandedDetailRow && expandedDetailRow.parentNode) {
            expandedDetailRow.parentNode.removeChild(expandedDetailRow);
        }
        if (expandedRow) {
            expandedRow.classList.remove('expanded');
        }
        expandedRow = null;
        expandedDetailRow = null;
    }

    function renderExpandMessage(type, message) {
        const safeClass = type === 'error' ? 'client-expand-error' : (type === 'loading' ? 'client-expand-loading' : 'client-expand-empty');
        return `<div class="${safeClass}">${escapeHtml(message || '')}</div>`;
    }

    function buildListLink(tableId, status, label, count, iconClass, permKey) {
        if (!hasPerm(permKey)) return '';
        return '' +
            `<a class="client-expand-pill ${escapeHtml(status)}" href="${idcardActionsUrl(tableId, status)}" title="Open ${escapeHtml(label)} list">` +
                `<i class="fa-solid ${escapeHtml(iconClass)}"></i>` +
                `${escapeHtml(label)}` +
                `<span class="count">${Number(count || 0)}</span>` +
            '</a>';
    }

    function buildBulkButton(clientId, tableId, action, label, iconClass, permKey, enabled) {
        if (!hasPerm(permKey)) return '';
        const disabled = !enabled;
        const className = `client-expand-bulk-btn${disabled ? ' disabled' : ''}`;
        const href = disabled ? '#' : idcardGroupBulkActionUrl(clientId, tableId, action);
        const title = disabled
            ? 'Open ID Card Group and select a table with data to run this action'
            : `Open ID Card Group to run ${label}`;
        return '' +
            `<a class="${className}" href="${href}" title="${escapeHtml(title)}">` +
                `<i class="fa-solid ${escapeHtml(iconClass)}"></i>` +
                `${escapeHtml(label)}` +
            '</a>';
    }

    function buildTableExpandHtml(clientId, clientName, groupsUrl, settingsUrl, tables) {
        const tableList = Array.isArray(tables) ? tables : [];
        const tableCount = tableList.length;

        const topActions = [];
        if (hasPerm('idcardSettingList')) {
            topActions.push(
                `<a class="client-expand-action-btn" href="${escapeHtml(settingsUrl)}"><i class="fa-solid fa-gear"></i> Group Setting</a>`
            );
            topActions.push(
                `<a class="client-expand-action-btn" href="${escapeHtml(groupsUrl)}"><i class="fa-solid fa-layer-group"></i> ID Card Group</a>`
            );
        }

        if (!tableCount) {
            return '' +
                '<div class="client-expand-panel">' +
                    '<div class="client-expand-header">' +
                        '<div>' +
                            `<h4 class="client-expand-title">${escapeHtml(clientName)} workflow</h4>` +
                            '<div class="client-expand-subtitle">No tables found for this client yet.</div>' +
                        '</div>' +
                        `<div class="client-expand-actions">${topActions.join('')}</div>` +
                    '</div>' +
                    renderExpandMessage('empty', 'Create tables in Group Settings to unlock list and bulk actions.') +
                '</div>';
        }

        const tableHtml = tableList.map((table) => {
            const pending = Number(table.pending || 0);
            const verified = Number(table.verified || 0);
            const approved = Number(table.approved || 0);
            const downloaded = Number(table.downloaded || 0);
            const pool = Number(table.pool || 0);
            const total = pending + verified + approved + downloaded + pool;

            const listLinks = [
                buildListLink(table.id, 'pending', 'Pending', pending, 'fa-clock', 'pendingList'),
                buildListLink(table.id, 'verified', 'Verified', verified, 'fa-circle-check', 'verifiedList'),
                buildListLink(table.id, 'approved', 'Approved', approved, 'fa-thumbs-up', 'approvedList'),
                buildListLink(table.id, 'download', 'Downloaded', downloaded, 'fa-download', 'downloadList'),
                buildListLink(table.id, 'pool', 'Pool', pool, 'fa-layer-group', 'poolList')
            ].join('');

            const bulkButtons = [
                buildBulkButton(clientId, table.id, 'reupload', 'Reupload', 'fa-upload', 'bulkReupload', total > 0),
                buildBulkButton(clientId, table.id, 'download-all', 'Download All', 'fa-id-card', 'bulkDownload', total > 0),
                buildBulkButton(clientId, table.id, 'delete-all', 'Delete All', 'fa-trash', 'deleteAll', total > 0),
                buildBulkButton(clientId, table.id, 'upgrade', 'Upgrade All', 'fa-arrow-up', 'upgradeAll', downloaded > 0)
            ].join('');

            return '' +
                '<div class="client-expand-table-item">' +
                    '<div class="client-expand-table-head">' +
                        `<div class="client-expand-table-name"><i class="fa-solid fa-table"></i> ${escapeHtml(table.name || 'Table')}</div>` +
                        `<a class="client-expand-action-btn" href="${idcardActionsUrl(table.id, 'pending')}"><i class="fa-solid fa-arrow-right"></i> Open Table</a>` +
                    '</div>' +
                    `<div class="client-expand-table-links">${listLinks || renderExpandMessage('empty', 'No list permissions')}</div>` +
                    `<div class="client-expand-table-bulk">${bulkButtons || ''}</div>` +
                '</div>';
        }).join('');

        return '' +
            '<div class="client-expand-panel">' +
                '<div class="client-expand-header">' +
                    '<div>' +
                        `<h4 class="client-expand-title">${escapeHtml(clientName)} workflow</h4>` +
                        `<div class="client-expand-subtitle">${tableCount} table${tableCount === 1 ? '' : 's'} with list, action, and bulk-action shortcuts</div>` +
                    '</div>' +
                    `<div class="client-expand-actions">${topActions.join('')}</div>` +
                '</div>' +
                `<div class="client-expand-table-list">${tableHtml}</div>` +
            '</div>';
    }

    function fetchClientDetailsMap() {
        if (clientDetailsMap) {
            return Promise.resolve(clientDetailsMap);
        }
        if (clientDetailsPromise) {
            return clientDetailsPromise;
        }

        clientDetailsPromise = fetch(panelUrl('/api/recent-client-updates/?limit=500'), {
            method: 'GET',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin'
        })
            .then((resp) => resp.json().then((data) => ({ ok: resp.ok, data })))
            .then(({ ok, data }) => {
                if (!ok || !data || !data.success || !Array.isArray(data.clients)) {
                    throw new Error((data && data.error) || 'Failed to load client table details.');
                }
                const map = new Map();
                data.clients.forEach((client) => {
                    map.set(String(client.client_id || client.id), client);
                });
                clientDetailsMap = map;
                return map;
            })
            .finally(() => {
                clientDetailsPromise = null;
            });

        return clientDetailsPromise;
    }

    function toggleClientExpand(row) {
        if (!row || !row.classList.contains('client-main-row')) return;

        const isSameRowOpen = expandedRow === row && expandedDetailRow;
        if (isSameRowOpen) {
            removeExpandedDetailRow();
            return;
        }

        removeExpandedDetailRow();

        const detailRow = document.createElement('tr');
        detailRow.className = 'client-expand-row';
        detailRow.innerHTML = `<td colspan="6">${renderExpandMessage('loading', 'Loading client tables...')}</td>`;

        row.insertAdjacentElement('afterend', detailRow);
        row.classList.add('expanded');
        expandedRow = row;
        expandedDetailRow = detailRow;

        const token = ++expandRequestToken;
        const clientId = String(row.dataset.clientId || '');
        const clientName = row.dataset.clientName || 'Client';
        const groupsUrl = row.dataset.groupsUrl || clientGroupsUrl(clientId);
        const settingsUrl = row.dataset.settingsUrl || clientSettingsUrl(clientId);

        fetchClientDetailsMap()
            .then((map) => {
                if (token !== expandRequestToken || expandedDetailRow !== detailRow) return;
                const client = map.get(clientId);
                const tables = client && Array.isArray(client.tables) ? client.tables : [];
                detailRow.innerHTML = `<td colspan="6">${buildTableExpandHtml(clientId, clientName, groupsUrl, settingsUrl, tables)}</td>`;
            })
            .catch((error) => {
                if (token !== expandRequestToken || expandedDetailRow !== detailRow) return;
                detailRow.innerHTML = `<td colspan="6">${renderExpandMessage('error', error && error.message ? error.message : 'Could not load client workflow details.')}</td>`;
            });
    }

    // ==================== ROW SELECTION ====================
    function selectRow(row) {
        if (!row || row.classList.contains('no-data-row')) return;
        
        // Remove previous selection
        document.querySelectorAll('#client-table-body tr.selected').forEach(r => {
            r.classList.remove('selected');
        });
        
        // Select new row
        row.classList.add('selected');
        selectedClientId = row.dataset.clientId;
        selectedRow = row;
        
        // Enable buttons
        updateActionButtons();

        // Bridge to Alpine reactive state
        if (typeof window.alpineUpdateSelection === 'function') {
            window.alpineUpdateSelection([selectedClientId]);
        }
    }

    function clearSelection() {
        document.querySelectorAll('#client-table-body tr.selected').forEach(r => {
            r.classList.remove('selected');
        });
        selectedClientId = null;
        selectedRow = null;
        updateActionButtons();

        // Bridge to Alpine reactive state
        if (typeof window.alpineClearSelection === 'function') {
            window.alpineClearSelection();
        }
    }

    function updateActionButtons() {
        const hasSelection = selectedClientId !== null;
        if (elements.groupSettingBtn) elements.groupSettingBtn.disabled = !hasSelection;
        if (elements.idcardGroupBtn) elements.idcardGroupBtn.disabled = !hasSelection;
    }

    // ==================== SEARCH & FILTER ====================
    function performSearch() {
        const searchTerm = elements.searchInput?.value.toLowerCase().trim() || '';
        const rows = getClientRows();
        let visibleCount = 0;
        
        // Column index mapping
        const filterColumnMap = {
            'all': null,
            'name': 0,
            'email': 1,
            'phone': 2
        };
        
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            let match = false;
            
            if (currentFilter === 'all' || !searchTerm) {
                // Search all columns
                const text = row.textContent.toLowerCase();
                match = searchTerm === '' || text.includes(searchTerm);
            } else {
                // Search specific column
                const columnIndex = filterColumnMap[currentFilter];
                if (columnIndex !== null && cells[columnIndex]) {
                    const cellText = cells[columnIndex].textContent.toLowerCase();
                    match = cellText.includes(searchTerm);
                }
            }
            
            row.style.display = match ? '' : 'none';
            if (match) visibleCount++;
        });
        
        // Update search clear button visibility
        if (elements.searchClear) {
            elements.searchClear.style.display = searchTerm ? 'flex' : 'none';
        }
        
        // Update empty state
        updateEmptyState(visibleCount === 0 && searchTerm !== '');
        
        // Update pagination info
        updateRowCount(visibleCount);
    }

    function updateEmptyState(showEmpty = false) {
        if (elements.emptyState) {
            elements.emptyState.style.display = showEmpty ? 'flex' : 'none';
        }
    }

    function updateRowCount(count) {
        const rowCountEl = document.getElementById('row-count');
        if (rowCountEl) {
            const total = getClientRows().length;
            rowCountEl.textContent = `Showing ${count} of ${total}`;
        }
    }

    // ==================== FILTER DROPDOWN ====================
    function setupFilterDropdown() {
        if (!elements.dropdownToggle || !elements.dropdownOptions) return;
        
        elements.dropdownToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            elements.filterDropdown.classList.toggle('open');
        });
        
        elements.dropdownOptions.querySelectorAll('.dropdown-option').forEach(option => {
            option.addEventListener('click', function() {
                // Update selected state
                elements.dropdownOptions.querySelectorAll('.dropdown-option').forEach(o => {
                    o.classList.remove('selected');
                });
                this.classList.add('selected');
                
                // Update display text
                elements.selectedText.textContent = this.textContent;
                currentFilter = this.dataset.value;
                
                // Update placeholder
                if (elements.searchInput) {
                    const filterText = this.dataset.value === 'all' ? 'All' : this.textContent;
                    elements.searchInput.placeholder = `Search ${filterText}...`;
                }
                
                // Close dropdown
                elements.filterDropdown.classList.remove('open');

                // Bridge to Alpine reactive state
                if (typeof window.alpineUpdateFilter === 'function') window.alpineUpdateFilter(currentFilter);
                
                // Re-run search with new filter
                performSearch();
            });
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', function() {
            elements.filterDropdown?.classList.remove('open');
        });
    }

    // ==================== URL HIGHLIGHT ====================
    function highlightFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const highlightId = urlParams.get('highlight');
        
        if (highlightId) {
            const targetRow = document.querySelector(`tr[data-client-id="${highlightId}"]`);
            
            if (targetRow) {
                selectRow(targetRow);
                
                setTimeout(() => {
                    targetRow.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center' 
                    });
                }, 100);
                
                // Add highlight animation
                targetRow.classList.add('highlight');
                
                setTimeout(() => {
                    targetRow.classList.remove('highlight');
                    const newUrl = new URL(window.location);
                    newUrl.searchParams.delete('highlight');
                    window.history.replaceState({}, '', newUrl);
                }, 2000);
            }
        }
    }

    // ==================== EVENT LISTENERS ====================
    function setupEventListeners() {
        // Status filter tabs
        var statusTabs = document.getElementById('status-tabs');
        if (statusTabs) {
            statusTabs.querySelectorAll('.status-tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    // Update active state
                    statusTabs.querySelectorAll('.status-tab').forEach(function(t) { t.classList.remove('active'); });
                    this.classList.add('active');

                    currentStatusFilter = this.dataset.status || '';

                    // Build HTMX request URL and swap table container
                    var params = new URLSearchParams();
                    if (currentStatusFilter) params.set('status', currentStatusFilter);
                    var searchVal = elements.searchInput ? elements.searchInput.value.trim() : '';
                    if (searchVal) params.set('search', searchVal);
                    params.set('per_page', new URLSearchParams(window.location.search).get('per_page') || '25');
                    params.set('page', '1');

                    var url = window.location.pathname + '?' + params.toString();

                    // Update browser URL
                    window.history.replaceState({}, '', url);

                    // HTMX swap
                    var container = document.getElementById('active-client-table-container');
                    if (container && window.htmx) {
                        window.htmx.ajax('GET', url, {target: container, swap: 'innerHTML'});
                    }
                });
            });
        }

        // Table row selection  delegate from stable container to survive HTMX swaps
        var tableContainer = document.getElementById('active-client-table-container');
        if (tableContainer) {
            // Row click handler (delegated)
            tableContainer.addEventListener('click', function(e) {
                const historyBtn = e.target.closest('.client-history-trigger');
                if (historyBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    openClientHistory(historyBtn.dataset.clientId, historyBtn.dataset.clientName);
                    return;
                }

                if (e.target.closest('.client-expand-panel')) {
                    return;
                }

                if (e.target.closest('a, button, input, textarea, select, label')) {
                    return;
                }

                const row = e.target.closest('tr');
                if (row && row.classList.contains('client-main-row')) {
                    selectRow(row);
                    toggleClientExpand(row);
                }
            });
            
            // Double-click to go to ID Card Groups (delegated)
            tableContainer.addEventListener('dblclick', function(e) {
                const row = e.target.closest('tr');
                if (row && row.dataset.clientId) {
                    window.location.href = clientGroupsUrl(row.dataset.clientId);
                }
            });

            document.body.addEventListener('htmx:afterSwap', function(evt) {
                if (!evt || !evt.target) return;
                if (evt.target.id === 'active-client-table-container' || evt.target.closest('#active-client-table-container')) {
                    removeExpandedDetailRow();
                    selectedRow = null;
                    selectedClientId = null;
                    updateActionButtons();
                }
            });
        }
        
        // Group Setting button
        if (elements.groupSettingBtn) {
            elements.groupSettingBtn.addEventListener('click', function() {
                if (selectedClientId) {
                    window.location.href = clientSettingsUrl(selectedClientId);
                }
            });
        }
        
        // ID Card Group button
        if (elements.idcardGroupBtn) {
            elements.idcardGroupBtn.addEventListener('click', function() {
                if (selectedClientId) {
                    window.location.href = clientGroupsUrl(selectedClientId);
                }
            });
        }
        
        // Search input
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', function() {
                performSearch();
                if (typeof window.alpineUpdateSearch === 'function') window.alpineUpdateSearch(elements.searchInput.value);
            });
        }
        
        // Search clear button
        if (elements.searchClear) {
            elements.searchClear.addEventListener('click', function() {
                elements.searchInput.value = '';
                performSearch();
                elements.searchInput.focus();
                if (typeof window.alpineUpdateSearch === 'function') window.alpineUpdateSearch('');
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            // Ctrl+F to focus search
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                elements.searchInput?.focus();
            }
            
            // Escape to clear search
            if (e.key === 'Escape') {
                if (elements.searchInput && elements.searchInput === document.activeElement) {
                    elements.searchInput.value = '';
                    performSearch();
                    elements.searchInput.blur();
                }
            }
            
            // Enter to go to groups when row is selected
            if (e.key === 'Enter' && selectedClientId) {
                // Don't navigate if user is typing in an input or the search overlay is open
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
                const searchOverlay = document.getElementById('globalSearchOverlay');
                if (searchOverlay && searchOverlay.classList.contains('active')) return;
                window.location.href = clientGroupsUrl(selectedClientId);
            }
        });
    }

    // ==================== INITIALIZATION ====================
    function init() {
        ensureClientHistoryDrawer();
        setupEventListeners();
        setupFilterDropdown();
        highlightFromUrl();
        
        // Initialize row count
        const totalRows = getClientRows().length;
        updateRowCount(totalRows);
        
        // Hide search clear initially
        if (elements.searchClear) {
            elements.searchClear.style.display = 'none';
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
