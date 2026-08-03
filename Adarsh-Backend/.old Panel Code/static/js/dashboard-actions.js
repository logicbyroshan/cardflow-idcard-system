// Dashboard Page  Bulk actions, API calls, modals, data loading
// Split from dashboard.js  see also dashboard-ui.js

window.DashboardPage = window.DashboardPage || {};

document.addEventListener('DOMContentLoaded', function() {
    const waitForMinDelay = window.waitForMinDelay || function () { return Promise.resolve(); };
    const DASHBOARD_LIVE_REFRESH_MS = 120000;
    // Add ±5s jitter to stagger polling across concurrent users (anti-thundering-herd)
    function jitteredRefreshMs() {
        return DASHBOARD_LIVE_REFRESH_MS + Math.floor(Math.random() * 10000) - 5000;
    }
    const DASHBOARD_PRESENCE_TOPIC = 'dashboard.working';
    const DASHBOARD_PRESENCE_SYNC_DEBOUNCE_MS = 5000;
    const panelBase = window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';
    function panelUrl(path) {
        if (!path) return path;
        if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) return path;
        const normalized = path.charAt(0) === '/' ? path : '/' + path;
        return panelBase + normalized;
    }

    function setDashboardTableSkeleton(tbody, columnCount, rowCount) {
        if (!tbody) return;
        const lineWidths = ['78%', '66%', '72%', '63%', '70%'];
        const rows = [];

        for (let i = 0; i < rowCount; i++) {
            const cells = [];
            for (let c = 0; c < columnCount; c++) {
                if (c === 0) {
                    cells.push(`<td><span class="dash-skeleton dash-skeleton-line" style="width: ${lineWidths[i % lineWidths.length]};"></span></td>`);
                } else {
                    cells.push('<td><span class="dash-skeleton dash-skeleton-pill"></span></td>');
                }
            }
            rows.push(`<tr class="dashboard-table-skeleton-row">${cells.join('')}</tr>`);
        }

        tbody.innerHTML = rows.join('');
    }

    const recentClientUpdatesSearchInput = document.getElementById('recentClientUpdatesSearch');
    const recentClientUpdatesActiveBadge = document.getElementById('recentClientUpdatesActiveBadge');
    const recentClientUpdatesAssistantBadge = document.getElementById('recentClientUpdatesAssistantBadge');
    const recentClientUpdatesSortHeaders = Array.from(document.querySelectorAll('th[data-recent-sort-key]'));
    const reprintOverviewSortHeaders = Array.from(document.querySelectorAll('th[data-overview-sort-scope="reprint"][data-overview-sort-key]'));
    let recentClientUpdatesLiveFilterMode = '';
    let recentClientUpdatesLiveClientIds = new Set();
    let recentClientUpdatesLiveAssistantClientIds = new Set();
    let dashboardPresenceSyncTimer = null;
    let dashboardPresenceRefreshTimer = null;
    let removeDashboardRealtimeListener = null;
    let recentClientUpdatesSortKey = '';
    let reprintOverviewSortKey = '';
    const reprintOverviewSearchInput = document.getElementById('reprintOverviewSearch');
    const dashboardTabCountRecentClients = document.getElementById('dashboardTabCountRecentClients');
    const dashboardTabCountRecentUpdates = document.getElementById('dashboardTabCountRecentUpdates');
    const dashboardTabCountReprint = document.getElementById('dashboardTabCountReprint');
    const isAdminRecentUpdatesContext = !!recentClientUpdatesActiveBadge || !!recentClientUpdatesAssistantBadge;
    const isAdminDashboardContext = isAdminRecentUpdatesContext
        || !!document.getElementById('reprintOverviewBody');

    function setDashboardTabCount(element, value) {
        if (!element) return;
        const count = Number(value);
        element.textContent = Number.isFinite(count) ? count.toLocaleString() : '0';
    }

    function setRecentClientUpdatesActiveBadge(count) {
        if (!recentClientUpdatesActiveBadge) return;
        const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
        recentClientUpdatesActiveBadge.textContent = `Live Working Clients: ${safeCount.toLocaleString()}`;
    }

    function setRecentClientUpdatesAssistantBadge(count) {
        if (!recentClientUpdatesAssistantBadge) return;
        const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
        recentClientUpdatesAssistantBadge.textContent = `Live Working Assistants: ${safeCount.toLocaleString()}`;
    }

    function setRecentClientUpdatesLiveFilterUI() {
        if (recentClientUpdatesActiveBadge) {
            recentClientUpdatesActiveBadge.classList.toggle('is-filter-active', recentClientUpdatesLiveFilterMode === 'client');
        }
        if (recentClientUpdatesAssistantBadge) {
            recentClientUpdatesAssistantBadge.classList.toggle('is-filter-active', recentClientUpdatesLiveFilterMode === 'assistant');
        }
    }

    function setRecentClientUpdatesSortUI() {
        if (!recentClientUpdatesSortHeaders.length) return;
        recentClientUpdatesSortHeaders.forEach((header) => {
            const key = header.getAttribute('data-recent-sort-key') || '';
            const isActive = key && key === recentClientUpdatesSortKey;
            header.classList.toggle('is-sort-active', isActive);
            header.setAttribute('aria-sort', isActive ? 'descending' : 'none');

            const icon = header.querySelector('.recent-sort-icon');
            if (icon) {
                icon.classList.remove('fa-sort', 'fa-sort-down');
                icon.classList.add(isActive ? 'fa-sort-down' : 'fa-sort');
            }
        });
    }

    function getRecentClientSortValue(row, key) {
        if (!key) return 0;
        const rawValue = Number(row.getAttribute(`data-sort-${key}`));
        return Number.isFinite(rawValue) ? rawValue : 0;
    }

    function normalizeIdList(values) {
        if (!Array.isArray(values)) return [];
        return values
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id));
    }

    function applyRecentClientLiveStatesToRows() {
        const tbody = document.getElementById('recentClientUpdatesBody');
        if (!tbody) return;

        const clientRows = Array.from(tbody.querySelectorAll('tr.client-row'));
        clientRows.forEach((row) => {
            const clientId = Number(row.getAttribute('data-client-id'));
            const isLiveClient = Number.isFinite(clientId) && recentClientUpdatesLiveClientIds.has(clientId);
            const isLiveAssistant = Number.isFinite(clientId) && recentClientUpdatesLiveAssistantClientIds.has(clientId);
            row.setAttribute('data-live-active', isLiveClient ? '1' : '0');
            row.setAttribute('data-live-assistant-active', isLiveAssistant ? '1' : '0');
        });
    }

    function refreshLivePresenceSnapshot() {
        if (!isAdminRecentUpdatesContext) return Promise.resolve();

        return ApiClient.get(panelUrl('/api/presence/live-count/?_ts=' + Date.now()))
            .then((data) => {
                if (!data || !data.success) return;

                recentClientUpdatesLiveClientIds = new Set(normalizeIdList(data.active_client_ids));
                recentClientUpdatesLiveAssistantClientIds = new Set(normalizeIdList(data.active_assistant_client_ids));

                const liveActiveClients = Number(data.active_clients_now);
                const liveActiveAssistants = Number(data.active_assistants_now);
                setRecentClientUpdatesActiveBadge(Number.isFinite(liveActiveClients) ? liveActiveClients : 0);
                setRecentClientUpdatesAssistantBadge(Number.isFinite(liveActiveAssistants) ? liveActiveAssistants : 0);

                applyRecentClientLiveStatesToRows();
                applyRecentClientUpdatesSearch();
            })
            .catch((error) => {
                console.error('Error loading live presence snapshot:', error);
            });
    }

    function applyRecentClientUpdatesSort() {
        const tbody = document.getElementById('recentClientUpdatesBody');
        if (!tbody) return;

        const existingNoResultRow = tbody.querySelector('.recent-table-no-search-results');
        if (existingNoResultRow) existingNoResultRow.remove();

        const clientRows = Array.from(tbody.querySelectorAll('tr.client-row'));
        if (!clientRows.length) return;

        const groupedRows = clientRows.map((row) => {
            const idx = row.getAttribute('data-idx');
            const subRows = idx ? Array.from(tbody.querySelectorAll(`tr.expand-group-${idx}`)) : [];
            const baseOrder = Number(row.getAttribute('data-base-order'));
            return {
                row,
                subRows,
                baseOrder: Number.isFinite(baseOrder) ? baseOrder : 0,
            };
        });

        groupedRows.sort((a, b) => {
            if (!recentClientUpdatesSortKey) {
                return a.baseOrder - b.baseOrder;
            }

            const aValue = getRecentClientSortValue(a.row, recentClientUpdatesSortKey);
            const bValue = getRecentClientSortValue(b.row, recentClientUpdatesSortKey);
            if (bValue !== aValue) {
                return bValue - aValue;
            }
            return a.baseOrder - b.baseOrder;
        });

        const fragment = document.createDocumentFragment();
        groupedRows.forEach((entry) => {
            fragment.appendChild(entry.row);
            entry.subRows.forEach((subRow) => {
                fragment.appendChild(subRow);
            });
        });
        tbody.appendChild(fragment);
    }

    function getOverviewSortHeaders(scope) {
        return reprintOverviewSortHeaders;
    }

    function getOverviewSortKey(scope) {
        return reprintOverviewSortKey;
    }

    function setOverviewSortKey(scope, nextKey) {
        reprintOverviewSortKey = nextKey;
    }

    function setOverviewSortUI(scope) {
        const headers = getOverviewSortHeaders(scope);
        if (!headers.length) return;
        const activeKey = getOverviewSortKey(scope);

        headers.forEach((header) => {
            const key = header.getAttribute('data-overview-sort-key') || '';
            const isActive = key && key === activeKey;
            header.classList.toggle('is-sort-active', isActive);
            header.setAttribute('aria-sort', isActive ? 'descending' : 'none');

            const icon = header.querySelector('.recent-sort-icon');
            if (icon) {
                icon.classList.remove('fa-sort', 'fa-sort-down');
                icon.classList.add(isActive ? 'fa-sort-down' : 'fa-sort');
            }
        });
    }

    function applyOverviewSort(scope) {
        const tbody = document.getElementById('reprintOverviewBody');
        if (!tbody) return;

        const noResultClass = `${scope}-table-no-search-results`;
        const existingNoResultRow = tbody.querySelector('.' + noResultClass);
        if (existingNoResultRow) existingNoResultRow.remove();

        const clientRows = Array.from(tbody.querySelectorAll('tr.client-row'));
        if (!clientRows.length) return;

        const activeKey = getOverviewSortKey(scope);
        const groupedRows = clientRows.map((row) => {
            const idx = row.getAttribute('data-idx');
            const subRows = idx ? Array.from(tbody.querySelectorAll(`tr.${scope}-expand-group-${idx}`)) : [];
            const baseOrder = Number(row.getAttribute('data-base-order'));
            return {
                row,
                subRows,
                baseOrder: Number.isFinite(baseOrder) ? baseOrder : 0,
            };
        });

        groupedRows.sort((a, b) => {
            if (!activeKey) {
                return a.baseOrder - b.baseOrder;
            }

            const aValue = Number(a.row.getAttribute(`data-sort-${activeKey}`));
            const bValue = Number(b.row.getAttribute(`data-sort-${activeKey}`));
            const safeA = Number.isFinite(aValue) ? aValue : 0;
            const safeB = Number.isFinite(bValue) ? bValue : 0;

            if (safeB !== safeA) {
                return safeB - safeA;
            }

            return a.baseOrder - b.baseOrder;
        });

        const fragment = document.createDocumentFragment();
        groupedRows.forEach((entry) => {
            fragment.appendChild(entry.row);
            entry.subRows.forEach((subRow) => {
                fragment.appendChild(subRow);
            });
        });
        tbody.appendChild(fragment);
    }

    function renderDashboardClientStatusBadge(status, esc) {
        const normalized = String(status || '').trim().toLowerCase();
        if (!normalized) return '';
        let stateClass = 'is-inactive';
        if (normalized === 'active') {
            stateClass = 'is-active';
        } else if (normalized === 'suspended') {
            stateClass = 'is-suspended';
        }
        const displayText = normalized.charAt(0).toUpperCase() + normalized.slice(1);
        return `<span class="dashboard-client-status-badge ${stateClass}">${esc(displayText)}</span>`;
    }

    function applyRecentClientUpdatesSearch() {
        const tbody = document.getElementById('recentClientUpdatesBody');
        if (!tbody) return;
        const headerColumns = tbody.closest('table')?.querySelectorAll('thead th')?.length || 5;

        const existingNoResultRow = tbody.querySelector('.recent-table-no-search-results');
        if (existingNoResultRow) existingNoResultRow.remove();

        const clientRows = Array.from(tbody.querySelectorAll('tr.client-row'));
        if (!clientRows.length) return;

        const query = (recentClientUpdatesSearchInput && recentClientUpdatesSearchInput.value
            ? recentClientUpdatesSearchInput.value.trim().toLowerCase()
            : '');

        let visibleClients = 0;

        clientRows.forEach(row => {
            const idx = row.getAttribute('data-idx');
            const subRows = idx ? Array.from(tbody.querySelectorAll('tr.expand-group-' + idx)) : [];

            const clientName = (row.querySelector('.client-name-link')?.textContent || '').trim().toLowerCase();
            const tableNames = subRows
                .map(subRow => (subRow.querySelector('.sub-row-name')?.textContent || '').trim().toLowerCase())
                .join(' ');
            const searchable = `${clientName} ${tableNames}`.trim();
            const isSearchMatch = !query || searchable.includes(query);
            const isLiveClientMatch = recentClientUpdatesLiveFilterMode !== 'client' || row.getAttribute('data-live-active') === '1';
            const isLiveAssistantMatch = recentClientUpdatesLiveFilterMode !== 'assistant' || row.getAttribute('data-live-assistant-active') === '1';
            const isLiveMatch = isLiveClientMatch && isLiveAssistantMatch;
            const isMatch = isSearchMatch && isLiveMatch;

            if (!isMatch) {
                row.style.display = 'none';
                row.classList.remove('expanded');
                subRows.forEach(subRow => { subRow.style.display = 'none'; });
                return;
            }

            visibleClients += 1;
            row.style.display = '';
            const isExpanded = row.classList.contains('expanded');
            subRows.forEach(subRow => {
                subRow.style.display = isExpanded ? '' : 'none';
            });
        });

        if ((!query && !recentClientUpdatesLiveFilterMode) || visibleClients > 0) return;

        let noResultMessage = 'No clients matched your filters';
        if (query && recentClientUpdatesLiveFilterMode === 'client') {
            noResultMessage = `No live working clients matched "${query.replace(/"/g, '&quot;')}"`;
        } else if (query && recentClientUpdatesLiveFilterMode === 'assistant') {
            noResultMessage = `No clients with live working assistants matched "${query.replace(/"/g, '&quot;')}"`;
        } else if (query) {
            noResultMessage = `No clients matched "${query.replace(/"/g, '&quot;')}"`;
        } else if (recentClientUpdatesLiveFilterMode === 'client') {
            noResultMessage = 'No live working clients found right now';
        } else if (recentClientUpdatesLiveFilterMode === 'assistant') {
            noResultMessage = 'No clients with live working assistants found right now';
        }

        tbody.insertAdjacentHTML(
            'beforeend',
            `
                <tr class="recent-table-no-search-results">
                    <td colspan="${headerColumns}">
                        <i class="fa-solid fa-magnifying-glass"></i>
                        ${noResultMessage}
                    </td>
                </tr>
            `
        );
    }

    if (isAdminRecentUpdatesContext && recentClientUpdatesSearchInput) {
        recentClientUpdatesSearchInput.addEventListener('input', applyRecentClientUpdatesSearch);
    }

    if (isAdminRecentUpdatesContext && recentClientUpdatesActiveBadge) {
        recentClientUpdatesActiveBadge.addEventListener('click', function() {
            recentClientUpdatesLiveFilterMode = recentClientUpdatesLiveFilterMode === 'client' ? '' : 'client';
            setRecentClientUpdatesLiveFilterUI();
            applyRecentClientUpdatesSearch();
        });
    }

    if (isAdminRecentUpdatesContext && recentClientUpdatesAssistantBadge) {
        recentClientUpdatesAssistantBadge.addEventListener('click', function() {
            recentClientUpdatesLiveFilterMode = recentClientUpdatesLiveFilterMode === 'assistant' ? '' : 'assistant';
            setRecentClientUpdatesLiveFilterUI();
            applyRecentClientUpdatesSearch();
        });
    }

    if (isAdminRecentUpdatesContext && recentClientUpdatesSortHeaders.length) {
        recentClientUpdatesSortHeaders.forEach((header) => {
            header.addEventListener('click', function() {
                const key = header.getAttribute('data-recent-sort-key') || '';
                if (!key) return;

                recentClientUpdatesSortKey = recentClientUpdatesSortKey === key ? '' : key;
                setRecentClientUpdatesSortUI();
                applyRecentClientUpdatesSort();
                applyRecentClientUpdatesSearch();
            });

            header.addEventListener('keydown', function(event) {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                header.click();
            });
        });
    }

    if (isAdminRecentUpdatesContext) {
        setRecentClientUpdatesLiveFilterUI();
        setRecentClientUpdatesSortUI();
    }

    function applyOverviewSearch(scope) {
        const tbody = document.getElementById('reprintOverviewBody');
        const inputEl = reprintOverviewSearchInput;
        if (!tbody) return;

        const noResultClass = `${scope}-table-no-search-results`;
        const existingNoResultRow = tbody.querySelector('.' + noResultClass);
        if (existingNoResultRow) existingNoResultRow.remove();

        const clientRows = Array.from(tbody.querySelectorAll('tr.client-row'));
        if (!clientRows.length) return;

        const query = (inputEl && inputEl.value ? inputEl.value.trim().toLowerCase() : '');
        let visibleClients = 0;

        clientRows.forEach(row => {
            const idx = row.getAttribute('data-idx');
            const subRows = idx ? Array.from(tbody.querySelectorAll(`tr.${scope}-expand-group-${idx}`)) : [];

            const clientName = (row.querySelector('.client-name-link')?.textContent || '').trim().toLowerCase();
            const tableNames = subRows
                .map(subRow => (subRow.querySelector('.sub-row-name')?.textContent || '').trim().toLowerCase())
                .join(' ');
            const rowText = (row.textContent || '').trim().toLowerCase();
            const searchable = `${clientName} ${tableNames} ${rowText}`.trim();
            const isMatch = !query || searchable.includes(query);

            if (!isMatch) {
                row.style.display = 'none';
                row.classList.remove('expanded');
                subRows.forEach(subRow => { subRow.style.display = 'none'; });
                return;
            }

            visibleClients += 1;
            row.style.display = '';
            const isExpanded = row.classList.contains('expanded');
            subRows.forEach(subRow => {
                subRow.style.display = isExpanded ? '' : 'none';
            });
        });

        if (!query || visibleClients > 0) return;

        tbody.insertAdjacentHTML(
            'beforeend',
            `
                <tr class="recent-table-no-search-results ${noResultClass}">
                    <td colspan="3">
                        <i class="fa-solid fa-magnifying-glass"></i>
                        No ${scope} clients matched "${query.replace(/"/g, '&quot;')}"
                    </td>
                </tr>
            `
        );
    }

    if (reprintOverviewSearchInput) {
        reprintOverviewSearchInput.addEventListener('input', function() {
            applyOverviewSearch('reprint');
        });
    }

    if (reprintOverviewSortHeaders.length) {
        reprintOverviewSortHeaders.forEach((header) => {
            header.addEventListener('click', function() {
                const key = header.getAttribute('data-overview-sort-key') || '';
                if (!key) return;

                const nextKey = reprintOverviewSortKey === key ? '' : key;
                setOverviewSortKey('reprint', nextKey);
                setOverviewSortUI('reprint');
                applyOverviewSort('reprint');
                applyOverviewSearch('reprint');
            });

            header.addEventListener('keydown', function(event) {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                header.click();
            });
        });
    }

    setOverviewSortUI('reprint');

    // ====================
    // Load Recent Client Updates
    // ====================
    function loadRecentClientUpdates() {
        if (!isAdminRecentUpdatesContext) return;

        const tbody = document.getElementById('recentClientUpdatesBody');
        if (!tbody) return;
        const headerColumns = tbody.closest('table')?.querySelectorAll('thead th')?.length || 5;
        const showPool = headerColumns >= 6;
        setDashboardTabCount(dashboardTabCountRecentClients, 0);
        setRecentClientUpdatesActiveBadge(0);
        setRecentClientUpdatesAssistantBadge(0);
        setDashboardTableSkeleton(tbody, headerColumns, 3);
        const skeletonStart = Date.now();
        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        
        ApiClient.get(panelUrl('/api/recent-client-updates/'))
            .then(data => {
                waitForMinDelay(skeletonStart).then(() => {
                    if (data.success && data.clients.length > 0) {
                        const liveClientIds = normalizeIdList(data.active_client_ids);
                        const liveAssistantClientIds = normalizeIdList(data.active_assistant_client_ids);
                        recentClientUpdatesLiveClientIds = new Set(liveClientIds);
                        recentClientUpdatesLiveAssistantClientIds = new Set(liveAssistantClientIds);
                        const liveActiveClients = Number(data.active_clients_now);
                        const liveActiveAssistants = Number(data.active_assistants_now);
                        setRecentClientUpdatesActiveBadge(Number.isFinite(liveActiveClients) ? liveActiveClients : 0);
                        setRecentClientUpdatesAssistantBadge(Number.isFinite(liveActiveAssistants) ? liveActiveAssistants : 0);
                        setDashboardTabCount(dashboardTabCountRecentClients, data.clients.length);
                        tbody.innerHTML = data.clients.map((client, i) => {
                            const tables = client.tables || [];
                            const statusBadge = renderDashboardClientStatusBadge(client.status, esc);
                            const hasSingleTable = tables.length === 1;
                            const singleTable = hasSingleTable ? tables[0] : null;
                            const clientId = Number(client.client_id);
                            const isLiveActive = Number.isFinite(clientId) && recentClientUpdatesLiveClientIds.has(clientId);
                            const isLiveAssistantActive = Number.isFinite(clientId) && recentClientUpdatesLiveAssistantClientIds.has(clientId);
                            const pendingCount = Number(client.pending);
                            const verifiedCount = Number(client.verified);
                            const approvedCount = Number(client.approved);
                            const downloadedCount = Number(client.downloaded);
                            const poolCount = Number(client.pool);
                            const safePending = Number.isFinite(pendingCount) ? pendingCount : 0;
                            const safeVerified = Number.isFinite(verifiedCount) ? verifiedCount : 0;
                            const safeApproved = Number.isFinite(approvedCount) ? approvedCount : 0;
                            const safeDownloaded = Number.isFinite(downloadedCount) ? downloadedCount : 0;
                            const safePool = Number.isFinite(poolCount) ? poolCount : 0;
                            const clientGroupsUrl = panelUrl('/client/' + client.client_id + '/groups/');
                            const directUrl = hasSingleTable ? panelUrl('/table/' + singleTable.id + '/cards/') : '';
                            const clientLinkUrl = hasSingleTable ? directUrl : clientGroupsUrl;

                            // Build sub-rows only for clients with multiple tables.
                            const tableSubRows = tables.length > 1 ? tables.map(t => `
                                <tr class="client-sub-row expand-group-${i}" style="display:none">
                                    <td>
                                        <a href="${panelUrl('/table/' + t.id + '/cards/')}" class="sub-row-name"><i class="fa-solid fa-table"></i> ${esc(t.name)}</a>
                                    </td>
                                    <td class="text-center">
                                        <a href="${panelUrl('/table/' + t.id + '/cards/?status=pending')}" class="count-badge pending">${t.pending}</a>
                                    </td>
                                    <td class="text-center">
                                        <a href="${panelUrl('/table/' + t.id + '/cards/?status=verified')}" class="count-badge verified">${t.verified}</a>
                                    </td>
                                    <td class="text-center">
                                        <a href="${panelUrl('/table/' + t.id + '/cards/?status=approved')}" class="count-badge approved">${t.approved}</a>
                                    </td>
                                    <td class="text-center">
                                        <a href="${panelUrl('/table/' + t.id + '/cards/?status=download')}" class="count-badge downloaded">${t.downloaded}</a>
                                    </td>
                                    ${showPool ? `
                                    <td class="text-center">
                                        <a href="${panelUrl('/table/' + t.id + '/cards/?status=pool')}" class="count-badge pool">${t.pool}</a>
                                    </td>
                                    ` : ''}
                                </tr>
                            `).join('') : '';

                            return `
                            <tr class="client-row" data-idx="${i}" data-base-order="${i}" data-client-id="${Number.isFinite(clientId) ? clientId : ''}" data-live-active="${isLiveActive ? '1' : '0'}" data-live-assistant-active="${isLiveAssistantActive ? '1' : '0'}" data-sort-pending="${safePending}" data-sort-verified="${safeVerified}" data-sort-approved="${safeApproved}" data-sort-downloaded="${safeDownloaded}" data-sort-pool="${safePool}" ${directUrl ? `data-direct-url="${directUrl}"` : ''} onclick="toggleClientExpandRow(this)">
                                <td>
                                    <a href="${clientLinkUrl}" class="client-name-link" onclick="event.stopPropagation()">${statusBadge}<span class="client-name-text">${esc(client.name)}</span></a>
                                </td>
                                <td class="text-center">
                                    ${directUrl ? `<a href="${directUrl}?status=pending" class="count-badge pending" onclick="event.stopPropagation()">${client.pending}</a>` : `<a href="${clientLinkUrl}" class="count-badge pending" onclick="event.stopPropagation()">${client.pending}</a>`}
                                </td>
                                <td class="text-center">
                                    ${directUrl ? `<a href="${directUrl}?status=verified" class="count-badge verified" onclick="event.stopPropagation()">${client.verified}</a>` : `<a href="${clientLinkUrl}" class="count-badge verified" onclick="event.stopPropagation()">${client.verified}</a>`}
                                </td>
                                <td class="text-center">
                                    ${directUrl ? `<a href="${directUrl}?status=approved" class="count-badge approved" onclick="event.stopPropagation()">${client.approved}</a>` : `<a href="${clientLinkUrl}" class="count-badge approved" onclick="event.stopPropagation()">${client.approved}</a>`}
                                </td>
                                <td class="text-center">
                                    ${directUrl ? `<a href="${directUrl}?status=download" class="count-badge downloaded" onclick="event.stopPropagation()">${client.downloaded}</a>` : `<a href="${clientLinkUrl}" class="count-badge downloaded" onclick="event.stopPropagation()">${client.downloaded}</a>`}
                                </td>
                                ${showPool ? `
                                <td class="text-center">
                                    ${directUrl ? `<a href="${directUrl}?status=pool" class="count-badge pool" onclick="event.stopPropagation()">${client.pool}</a>` : `<a href="${clientLinkUrl}" class="count-badge pool" onclick="event.stopPropagation()">${client.pool}</a>`}
                                </td>
                                ` : ''}
                            </tr>
                            ${tableSubRows}
                        `}).join('');
                        applyRecentClientLiveStatesToRows();
                        setRecentClientUpdatesLiveFilterUI();
                        setRecentClientUpdatesSortUI();
                        applyRecentClientUpdatesSort();
                        applyRecentClientUpdatesSearch();
                    } else {
                        recentClientUpdatesLiveClientIds = new Set();
                        recentClientUpdatesLiveAssistantClientIds = new Set();
                        setRecentClientUpdatesActiveBadge(0);
                        setRecentClientUpdatesAssistantBadge(0);
                        setDashboardTabCount(dashboardTabCountRecentClients, 0);
                        tbody.innerHTML = `
                            <tr>
                                <td colspan="${headerColumns}" class="text-center" style="padding: 40px; color: #888;">
                                    <i class="fa-solid fa-users-slash"></i> No recent client updates
                                </td>
                            </tr>
                        `;
                        setRecentClientUpdatesSortUI();
                        applyRecentClientUpdatesSearch();
                    }
                });
            })
            .catch(error => {
                console.error('Error loading recent client updates:', error);
                waitForMinDelay(skeletonStart).then(() => {
                    recentClientUpdatesLiveClientIds = new Set();
                    recentClientUpdatesLiveAssistantClientIds = new Set();
                    setRecentClientUpdatesActiveBadge(0);
                    setRecentClientUpdatesAssistantBadge(0);
                    setDashboardTabCount(dashboardTabCountRecentClients, 0);
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="${headerColumns}" class="text-center" style="padding: 40px; color: #dc2626;">
                                <i class="fa-solid fa-exclamation-triangle"></i> Error loading data
                            </td>
                        </tr>
                    `;
                    setRecentClientUpdatesSortUI();
                    applyRecentClientUpdatesSearch();
                });
            });
    }

    function scheduleLivePresenceSnapshotSync() {
        if (!isAdminRecentUpdatesContext) return;
        if (dashboardPresenceSyncTimer) return;

        dashboardPresenceSyncTimer = window.setTimeout(function() {
            dashboardPresenceSyncTimer = null;
            refreshLivePresenceSnapshot();
        }, DASHBOARD_PRESENCE_SYNC_DEBOUNCE_MS);
    }

    function startLivePresenceRefresh() {
        if (!isAdminRecentUpdatesContext || dashboardPresenceRefreshTimer || document.hidden) return;

        function scheduleNext() {
            dashboardPresenceRefreshTimer = window.setTimeout(function() {
                dashboardPresenceRefreshTimer = null;
                if (document.hidden || (typeof navigator.onLine !== 'undefined' && !navigator.onLine)) {
                    return;
                }
                refreshLivePresenceSnapshot();
                scheduleNext();
            }, jitteredRefreshMs());
        }

        scheduleNext();
    }

    function stopLivePresenceRefresh() {
        if (!dashboardPresenceRefreshTimer) return;
        window.clearTimeout(dashboardPresenceRefreshTimer);
        dashboardPresenceRefreshTimer = null;
    }

    function handleDashboardRealtimePacket(packet) {
        if (!packet || typeof packet !== 'object') return;

        if (packet.type === 'realtime.state' && packet.status === 'connected') {
            scheduleLivePresenceSnapshotSync();
            return;
        }

        if (packet.type !== 'realtime.event') return;
        if (packet.topic !== DASHBOARD_PRESENCE_TOPIC) return;
        if (packet.event !== 'dashboard.presence.changed') return;

        scheduleLivePresenceSnapshotSync();
    }

    function initDashboardPresenceRealtime() {
        if (!isAdminRecentUpdatesContext) return;
        if (!window.AppRealtimeService) return;

        removeDashboardRealtimeListener = window.AppRealtimeService.onMessage(handleDashboardRealtimePacket);
        window.AppRealtimeService.connect({
            wsPath: '/ws/panel/realtime/',
            topics: [DASHBOARD_PRESENCE_TOPIC],
        });

        document.addEventListener('visibilitychange', function() {
            if (document.hidden) return;
            scheduleLivePresenceSnapshotSync();
            refreshLivePresenceSnapshot();
            startLivePresenceRefresh();
        });

        window.addEventListener('beforeunload', function() {
            if (dashboardPresenceSyncTimer) {
                window.clearTimeout(dashboardPresenceSyncTimer);
                dashboardPresenceSyncTimer = null;
            }
            stopLivePresenceRefresh();
            if (typeof removeDashboardRealtimeListener === 'function') {
                removeDashboardRealtimeListener();
                removeDashboardRealtimeListener = null;
            }
        });
    }
    
    // Load recent client updates on page load
    loadRecentClientUpdates();
    initDashboardPresenceRealtime();
    refreshLivePresenceSnapshot();
    startLivePresenceRefresh();

    // ====================
    // Live Dashboard Stats (Auto Refresh)
    // ====================
    function setDashboardStatValue(el, value) {
        if (!el) return;
        const n = Number(value);
        el.textContent = Number.isFinite(n) ? n.toLocaleString() : '0';
    }

    function loadDashboardCardStats() {
        if (!isAdminDashboardContext) return;

        const pendingEl = document.getElementById('pendingCards');
        const verifiedEl = document.getElementById('verifiedCards');
        const approvedEl = document.getElementById('approvedCards');
        const downloadedEl = document.getElementById('downloadedCards');
        const poolEl = document.getElementById('poolCards');
        const totalEl = document.getElementById('totalCards');

        if (!pendingEl && !verifiedEl && !approvedEl && !downloadedEl && !poolEl && !totalEl) return;

        ApiClient.get(panelUrl('/api/dashboard-card-stats/'))
            .then(data => {
                if (!data || !data.success || !data.stats) return;
                const stats = data.stats;
                setDashboardStatValue(pendingEl, stats.pending);
                setDashboardStatValue(verifiedEl, stats.verified);
                setDashboardStatValue(approvedEl, stats.approved);
                setDashboardStatValue(downloadedEl, stats.downloaded);
                setDashboardStatValue(poolEl, stats.pool);
                setDashboardStatValue(totalEl, stats.total);
            })
            .catch(error => {
                console.error('Error loading dashboard card stats:', error);
            });
    }

    // ====================
    // Recent Activity (Auto Refresh)
    // ====================
    function loadRecentActivity() {
        if (!isAdminDashboardContext) return;

        const activityList = document.getElementById('recentActivityList');
        if (!activityList) return;

        const esc = typeof escapeHtml === 'function'
            ? escapeHtml
            : (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');

        ApiClient.get(panelUrl('/api/recent-activity/?limit=100'))
            .then(data => {
                if (!data || !data.success) return;

                const activities = Array.isArray(data.activities) ? data.activities : [];
                setDashboardTabCount(dashboardTabCountRecentUpdates, activities.length);
                if (!activities.length) {
                    activityList.innerHTML = `
                        <div class="activity-item" id="noActivityMessage">
                            <div class="activity-icon edit">
                                <i class="fa-solid fa-circle-info"></i>
                            </div>
                            <div class="activity-content">
                                <div class="activity-text">No recent activity to show</div>
                                <div class="activity-time">Activity will appear here as actions are performed</div>
                            </div>
                        </div>
                    `;
                    return;
                }

                activityList.innerHTML = activities.map(activity => {
                    const iconColor = esc(activity.icon_color || 'edit');
                    const iconClass = esc(activity.icon_class || 'fa-circle-info');
                    const description = esc(activity.display_text || activity.description || 'Activity update');
                    const rawTimeAgo = String(activity.time_ago || '').trim();
                    const rawTimestamp = String(activity.created_at_display || '').trim();
                    const detailUrl = String(activity.url || '').trim();
                    const timeAgo = rawTimeAgo
                        ? (/ago$/i.test(rawTimeAgo) ? rawTimeAgo : `${rawTimeAgo} ago`)
                        : 'just now';

                    const timeMeta = rawTimestamp
                        ? `${esc(timeAgo)} <span class="activity-time-dot">&bull;</span> <span class="activity-time-absolute">${esc(rawTimestamp)}</span>`
                        : esc(timeAgo);

                    const itemInner = `
                        <div class="activity-icon ${iconColor}">
                            <i class="fa-solid ${iconClass}"></i>
                        </div>
                        <div class="activity-content">
                            <div class="activity-text">${description}</div>
                            <div class="activity-time">${timeMeta}</div>
                        </div>
                    `;

                    if (detailUrl) {
                        return `<a href="${esc(detailUrl)}" class="activity-item activity-item-link">${itemInner}</a>`;
                    }

                    return `
                        <div class="activity-item">
                            ${itemInner}
                        </div>
                    `;
                }).join('');
            })
            .catch(error => {
                console.error('Error loading recent activity:', error);
                setDashboardTabCount(dashboardTabCountRecentUpdates, 0);
            });
    }

    function refreshLiveDashboardSections() {
        loadDashboardCardStats();
        loadRecentActivity();
    }

    let liveRefreshTimer = null;
    function startLiveDashboardRefresh() {
        if (liveRefreshTimer || document.hidden) return;
        // Use setTimeout with jitter instead of fixed setInterval to stagger
        // requests across concurrent users (anti-thundering-herd).
        function scheduleNext() {
            liveRefreshTimer = setTimeout(function() {
                liveRefreshTimer = null;
                // Skip if tab hidden or network offline
                if (document.hidden || (typeof navigator.onLine !== 'undefined' && !navigator.onLine)) {
                    return;
                }
                refreshLiveDashboardSections();
                scheduleNext();
            }, jitteredRefreshMs());
        }
        scheduleNext();
    }

    function stopLiveDashboardRefresh() {
        if (!liveRefreshTimer) return;
        clearTimeout(liveRefreshTimer);
        liveRefreshTimer = null;
    }

    if (isAdminDashboardContext && (document.getElementById('recentActivityList') || document.getElementById('pendingCards'))) {
        refreshLiveDashboardSections();
        startLiveDashboardRefresh();
        document.addEventListener('visibilitychange', function() {
            if (document.hidden) {
                stopLiveDashboardRefresh();
            } else {
                refreshLiveDashboardSections();
                startLiveDashboardRefresh();
            }
        });
        window.addEventListener('beforeunload', stopLiveDashboardRefresh);
    }
    
    // ====================
    // Bulk Actions Panel - Cascading Dropdowns
    // ====================
    const bulkClientSelect = document.getElementById('bulkClientSelect');
    const bulkTableSelect = document.getElementById('bulkTableSelect');
    const bulkActionBtns = document.querySelectorAll('#bulkActionsButtons .bulk-action-btn');

    // Populate client dropdown with active clients
    async function loadBulkClients() {
        if (!bulkClientSelect) return;
        try {
            const data = await ApiClient.get(panelUrl('/api/clients/active/'));
            if (data.success && data.clients) {
                data.clients.forEach(client => {
                    const opt = document.createElement('option');
                    opt.value = client.id;
                    opt.textContent = client.name;
                    bulkClientSelect.appendChild(opt);
                });
            }
        } catch (e) {
            console.error('Failed to load clients for bulk actions:', e);
        }
    }

    // When client changes, load tables
    if (bulkClientSelect) {
        bulkClientSelect.addEventListener('change', async function() {
            const clientId = this.value;
            
            // Reset table dropdown
            bulkTableSelect.innerHTML = '<option value="">Select Table</option>';
            bulkTableSelect.disabled = true;
            setBulkActionsEnabled(false);

            if (!clientId) return;

            try {
                const data = await ApiClient.get(panelUrl('/api/group/' + clientId + '/tables/'));
                if (data.success && data.tables) {
                    data.tables.forEach(table => {
                        const opt = document.createElement('option');
                        opt.value = table.id;
                        opt.textContent = table.name;
                        bulkTableSelect.appendChild(opt);
                    });
                    bulkTableSelect.disabled = false;
                }
            } catch (e) {
                console.error('Failed to load tables:', e);
            }
        });
    }

    // When table changes, enable/disable action buttons
    if (bulkTableSelect) {
        bulkTableSelect.addEventListener('change', function() {
            setBulkActionsEnabled(!!this.value);
        });
    }

    function setBulkActionsEnabled(enabled) {
        bulkActionBtns.forEach(btn => {
            btn.disabled = !enabled;
        });
    }

    // Bulk action button click handlers
    bulkActionBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            if (this.disabled) return;
            const action = this.dataset.action;
            const tableId = bulkTableSelect.value;
            if (!tableId) return;

            if (action === 'delete-all') {
                dashOpenDeleteAllModal(tableId);
            } else if (action === 'download-all') {
                dashDownloadAll(tableId, this);
            } else if (action === 'upgrade') {
                dashOpenUpgradeAllModal(tableId);
            } else if (action === 'reupload') {
                dashOpenReuploadModal(tableId);
            } else {
                if (typeof showToast === 'function') {
                    showToast(`${action} action coming soon!`, 'info');
                }
            }
        });
    });

    function sanitizeCodeInputValue(value) {
        return String(value || '').replace(/\D/g, '').slice(0, 10);
    }

    function renderCodeBoxes(container, value) {
        if (!container) return;
        const clean = sanitizeCodeInputValue(value);
        const boxes = container.querySelectorAll('.confirm-code-box');
        boxes.forEach((box, idx) => {
            const ch = clean[idx] || '';
            box.textContent = ch;
            box.classList.toggle('is-filled', !!ch);
            box.classList.toggle('is-active', clean.length < 10 && clean.length === idx);
        });
    }

    function setCodeWrapState(wrapEl, isMatch, isComplete) {
        if (!wrapEl) return;
        wrapEl.classList.remove('is-valid', 'is-invalid');
        if (!isComplete) return;
        wrapEl.classList.add(isMatch ? 'is-valid' : 'is-invalid');
    }

    // ====================
    // Delete All (Secure 10-digit code) on Dashboard
    // ====================
    let dashDeleteTableId = null;
    let dashDeleteExpectedCode = '';
    const dashDeleteModal = document.getElementById('dashDeleteAllModal');
    const dashDeleteCodeInput = document.getElementById('dashDeleteCodeInput');
    const dashDeleteConfirmBtn = document.getElementById('dashDeleteConfirm');
    const dashDeleteCancelBtn = document.getElementById('dashDeleteCancel');
    const dashDeleteCodeDisplay = document.getElementById('dashDeleteCode');
    const dashDeleteCodeBoxes = document.getElementById('dashDeleteCodeBoxes');
    const dashDeleteCodeWrap = document.getElementById('dashDeleteCodeWrap');
    const dashDeleteTableNameEl = document.getElementById('dashDeleteTableName');
    const dashDeleteCountEl = document.getElementById('dashDeleteCount');

    function dashOpenDeleteAllModal(tableId) {
        dashDeleteTableId = tableId;
        dashDeleteExpectedCode = '';
        if (dashDeleteCodeInput) {
            dashDeleteCodeInput.value = '';
            renderCodeBoxes(dashDeleteCodeBoxes, '');
        }
        setCodeWrapState(dashDeleteCodeWrap, false, false);
        if (dashDeleteConfirmBtn) { dashDeleteConfirmBtn.disabled = true; dashDeleteConfirmBtn.style.opacity = '0.5'; dashDeleteConfirmBtn.textContent = 'Delete All Cards'; }

        ApiClient.post(`/api/table/${tableId}/cards/generate-delete-code/`)
          .then(data => {
            if (data.success) {
              dashDeleteExpectedCode = data.code;
              if (dashDeleteCodeDisplay) dashDeleteCodeDisplay.textContent = data.code;
              if (dashDeleteTableNameEl) dashDeleteTableNameEl.textContent = data.table_name;
              if (dashDeleteCountEl) dashDeleteCountEl.textContent = data.total_cards;
              if (window.alpineOpenModal) window.alpineOpenModal('dashDelete');
              if (dashDeleteCodeInput) dashDeleteCodeInput.focus();
            } else {
              if (typeof showToast === 'function') showToast(data.message || 'Failed to generate code', 'error');
            }
          })
          .catch(() => { if (typeof showToast === 'function') showToast('Error generating confirmation code', 'error'); });
    }

    function dashCloseDeleteAllModal() {
        if (window.alpineCloseModal) window.alpineCloseModal();
        dashDeleteTableId = null;
        dashDeleteExpectedCode = '';
        if (dashDeleteCodeInput) {
            dashDeleteCodeInput.value = '';
            renderCodeBoxes(dashDeleteCodeBoxes, '');
        }
        setCodeWrapState(dashDeleteCodeWrap, false, false);
    }

    if (dashDeleteCodeInput) {
        dashDeleteCodeInput.addEventListener('input', function() {
            this.value = sanitizeCodeInputValue(this.value);
            renderCodeBoxes(dashDeleteCodeBoxes, this.value);
            const isComplete = this.value.length === 10;
            const match = isComplete && this.value === dashDeleteExpectedCode;
            setCodeWrapState(dashDeleteCodeWrap, match, isComplete);
            if (dashDeleteConfirmBtn) { dashDeleteConfirmBtn.disabled = !match; dashDeleteConfirmBtn.style.opacity = match ? '1' : '0.5'; }
        });
    }
    if (dashDeleteCancelBtn) dashDeleteCancelBtn.addEventListener('click', dashCloseDeleteAllModal);
    // Overlay click-to-close now handled by Alpine @click.self in template

    if (dashDeleteConfirmBtn) {
        dashDeleteConfirmBtn.addEventListener('click', function() {
            if (!dashDeleteTableId || dashDeleteConfirmBtn.disabled) return;
            dashDeleteConfirmBtn.disabled = true;
            dashDeleteConfirmBtn.textContent = 'Deleting...';

            ApiClient.post(`/api/table/${dashDeleteTableId}/cards/bulk-delete/`, { delete_all: true, confirmation_code: dashDeleteCodeInput.value.trim() })
            .then(data => {
                dashCloseDeleteAllModal();
                if (typeof showToast === 'function') showToast(data.message || (data.success ? 'Deleted!' : 'Failed'), data.success ? 'success' : 'error');
            })
            .catch(() => {
                dashCloseDeleteAllModal();
                if (typeof showToast === 'function') showToast('Error deleting cards', 'error');
            });
        });
    }

    // ====================
    // Download All on Dashboard
    // ====================
    function dashDownloadAll(tableId, btn) {
        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Preparing...</span>';

        ApiClient.post(`/api/table/${tableId}/cards/download-all/`)
        .then(data => {
            if (data.success && data.download_url) {
                // New streaming mode: single combined ZIP on disk
                if (typeof showToast === 'function') showToast(`Downloading ${data.filename || 'AllCards.zip'}...`, 'success');
                const a = document.createElement('a');
                a.href = data.download_url;
                a.download = data.filename || 'AllCards.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } else if (data.success && data.files && data.files.length > 0) {
                // Legacy base64 mode (backward compatibility)
                if (typeof showToast === 'function') showToast(`Downloading ${data.total_files} file(s)...`, 'success');
                data.files.forEach((file, i) => {
                    setTimeout(() => {
                        dashTriggerBase64Download(file.data, file.filename, file.type === 'xlsx'
                            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                            : 'application/zip');
                    }, i * 500);
                });
            } else {
                if (typeof showToast === 'function') showToast(data.message || 'No files to download', 'error');
            }
        })
        .catch(() => { if (typeof showToast === 'function') showToast('Error downloading files', 'error'); })
        .finally(() => { btn.disabled = false; btn.innerHTML = origHtml; });
    }

    function dashTriggerBase64Download(base64, filename, mimeType) {
        ApiClient.downloadBase64(base64, filename, mimeType);
    }

    // ====================
    // Upgrade All Classes (Secure 10-digit code) on Dashboard
    // ====================
    let dashUpgradeTableId = null;
    let dashUpgradeExpectedCode = '';
    const dashUpgradeModal = document.getElementById('dashUpgradeAllModal');
    const dashUpgradeCodeInput = document.getElementById('dashUpgradeCodeInput');
    const dashUpgradeConfirmBtn = document.getElementById('dashUpgradeConfirm');
    const dashUpgradeCancelBtn = document.getElementById('dashUpgradeCancel');
    const dashUpgradeCodeDisplay = document.getElementById('dashUpgradeCode');
    const dashUpgradeCodeBoxes = document.getElementById('dashUpgradeCodeBoxes');
    const dashUpgradeCodeWrap = document.getElementById('dashUpgradeCodeWrap');
    const dashUpgradeTableNameEl = document.getElementById('dashUpgradeTableName');
    const dashUpgradeCountEl = document.getElementById('dashUpgradeCount');

    function broadcastClassesUpgraded(tableId) {
        const payload = { tableId: Number(tableId) || null, ts: Date.now() };
        try {
            window.dispatchEvent(new CustomEvent('idcard-classes-upgraded', { detail: payload }));
        } catch (_err) {}
        try {
            localStorage.setItem('idcard:classes-upgraded', JSON.stringify(payload));
        } catch (_err2) {}
    }

    function dashOpenUpgradeAllModal(tableId) {
        dashUpgradeTableId = tableId;
        dashUpgradeExpectedCode = '';
        if (dashUpgradeCodeInput) {
            dashUpgradeCodeInput.value = '';
            renderCodeBoxes(dashUpgradeCodeBoxes, '');
        }
        setCodeWrapState(dashUpgradeCodeWrap, false, false);
        if (dashUpgradeConfirmBtn) { dashUpgradeConfirmBtn.disabled = true; dashUpgradeConfirmBtn.style.opacity = '0.5'; dashUpgradeConfirmBtn.textContent = 'Upgrade All Classes'; }

        ApiClient.post(`/api/table/${tableId}/cards/generate-upgrade-code/`)
          .then(data => {
            if (data.success) {
              dashUpgradeExpectedCode = data.code;
              if (dashUpgradeCodeDisplay) dashUpgradeCodeDisplay.textContent = data.code;
              if (dashUpgradeTableNameEl) dashUpgradeTableNameEl.textContent = data.table_name;
              if (dashUpgradeCountEl) dashUpgradeCountEl.textContent = data.download_count;
              if (window.alpineOpenModal) window.alpineOpenModal('dashUpgrade');
              if (dashUpgradeCodeInput) dashUpgradeCodeInput.focus();
            } else {
              if (typeof showToast === 'function') showToast(data.message || 'Failed to generate code', 'error');
            }
          })
          .catch(() => { if (typeof showToast === 'function') showToast('Error generating confirmation code', 'error'); });
    }

    function dashCloseUpgradeAllModal() {
        if (window.alpineCloseModal) window.alpineCloseModal();
        dashUpgradeTableId = null;
        dashUpgradeExpectedCode = '';
        if (dashUpgradeCodeInput) {
            dashUpgradeCodeInput.value = '';
            renderCodeBoxes(dashUpgradeCodeBoxes, '');
        }
        setCodeWrapState(dashUpgradeCodeWrap, false, false);
    }

    if (dashUpgradeCodeInput) {
        dashUpgradeCodeInput.addEventListener('input', function() {
            this.value = sanitizeCodeInputValue(this.value);
            renderCodeBoxes(dashUpgradeCodeBoxes, this.value);
            const isComplete = this.value.length === 10;
            const match = isComplete && this.value === dashUpgradeExpectedCode;
            setCodeWrapState(dashUpgradeCodeWrap, match, isComplete);
            if (dashUpgradeConfirmBtn) { dashUpgradeConfirmBtn.disabled = !match; dashUpgradeConfirmBtn.style.opacity = match ? '1' : '0.5'; }
        });
    }
    if (dashUpgradeCancelBtn) dashUpgradeCancelBtn.addEventListener('click', dashCloseUpgradeAllModal);
    // Overlay click-to-close now handled by Alpine @click.self in template

    if (dashUpgradeConfirmBtn) {
        dashUpgradeConfirmBtn.addEventListener('click', function() {
            if (!dashUpgradeTableId || dashUpgradeConfirmBtn.disabled) return;
            dashUpgradeConfirmBtn.disabled = true;
            dashUpgradeConfirmBtn.textContent = 'Upgrading...';

            ApiClient.post(`/api/table/${dashUpgradeTableId}/cards/upgrade-classes/`, { confirmation_code: dashUpgradeCodeInput.value.trim() })
            .then(data => {
                dashCloseUpgradeAllModal();
                if (data && data.success) {
                    broadcastClassesUpgraded(dashUpgradeTableId);
                }
                if (typeof showToast === 'function') showToast(data.message || (data.success ? 'Upgraded!' : 'Failed'), data.success ? 'success' : 'error');
            })
            .catch(() => {
                dashCloseUpgradeAllModal();
                if (typeof showToast === 'function') showToast('Error upgrading classes', 'error');
            });
        });
    }

    // ====================
    // Reupload Images on Dashboard
    // ====================
    let dashReuploadTableId = null;
    const dashReuploadModal = document.getElementById('dashReuploadModal');
    const dashReuploadFileInput = document.getElementById('dashReuploadFileInput');
    const dashReuploadDropZone = document.getElementById('dashReuploadDropZone');
    const dashReuploadFileName = document.getElementById('dashReuploadFileName');
    const dashReuploadFolderInput = document.getElementById('dashReuploadFolderInput');
    const dashReuploadFolderBrowse = document.getElementById('dashReuploadFolderBrowse');
    const dashReuploadFolderName = document.getElementById('dashReuploadFolderName');
    const dashReuploadFolderPath = document.getElementById('dashReuploadFolderPath');
    const dashReuploadConfirmBtn = document.getElementById('dashReuploadConfirm');
    const dashReuploadCancelBtn = document.getElementById('dashReuploadCancel');
    const dashReuploadProgress = document.getElementById('dashReuploadProgress');
    const dashReuploadBar = document.getElementById('dashReuploadBar');
    const dashReuploadStatus = document.getElementById('dashReuploadStatus');
    const dashAllowFolderUpload = (document.body && String(document.body.getAttribute('data-user-role') || '').toLowerCase() === 'pro_user');

    function dashOpenReuploadModal(tableId) {
        dashReuploadTableId = tableId;
        if (dashReuploadFileInput) dashReuploadFileInput.value = '';
        if (dashReuploadFileName) dashReuploadFileName.textContent = 'Click or drag & drop a ZIP file';
        if (dashReuploadFolderInput) dashReuploadFolderInput.value = '';
        if (dashReuploadFolderName) dashReuploadFolderName.textContent = 'No folder selected';
        if (dashReuploadFolderPath) dashReuploadFolderPath.value = '';
        if (dashReuploadConfirmBtn) { dashReuploadConfirmBtn.disabled = true; dashReuploadConfirmBtn.style.opacity = '0.5'; dashReuploadConfirmBtn.textContent = 'Upload & Match'; }
        if (dashReuploadProgress) dashReuploadProgress.style.display = 'none';
        if (dashReuploadBar) dashReuploadBar.style.width = '0%';
        if (window.alpineOpenModal) window.alpineOpenModal('dashReupload');
    }

    function dashCloseReuploadModal() {
        if (window.alpineCloseModal) window.alpineCloseModal();
        dashReuploadTableId = null;
        if (dashReuploadFileInput) dashReuploadFileInput.value = '';
        if (dashReuploadFolderInput) dashReuploadFolderInput.value = '';
    }

    function _dashUpdateReuploadConfirmState() {
        const hasZip = !!(dashReuploadFileInput && dashReuploadFileInput.files && dashReuploadFileInput.files.length);
        const hasFolderFiles = !!(
            dashAllowFolderUpload &&
            dashReuploadFolderInput &&
            dashReuploadFolderInput.files &&
            Array.from(dashReuploadFolderInput.files).some(function(f) {
                return /\.(jpe?g|png|gif|bmp|webp|heic|heif|hei)$/i.test(f.name || '');
            })
        );
        const hasFolderPath = !!(dashAllowFolderUpload && dashReuploadFolderPath && dashReuploadFolderPath.value && dashReuploadFolderPath.value.trim());
        if (dashReuploadConfirmBtn) {
            dashReuploadConfirmBtn.disabled = !(hasZip || hasFolderFiles || hasFolderPath);
            dashReuploadConfirmBtn.style.opacity = dashReuploadConfirmBtn.disabled ? '0.5' : '1';
        }
    }

    if (dashReuploadDropZone) {
        dashReuploadDropZone.addEventListener('click', () => dashReuploadFileInput && dashReuploadFileInput.click());
        dashReuploadDropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            this.style.borderColor = '#d1d5db'; this.style.backgroundColor = '';
            if (e.dataTransfer.files.length && e.dataTransfer.files[0].name.endsWith('.zip')) {
                dashReuploadFileInput.files = e.dataTransfer.files;
                dashReuploadFileInput.dispatchEvent(new Event('change'));
            } else {
                if (typeof showToast === 'function') showToast('Please drop a .zip file', 'error');
            }
        });
    }

    if (dashReuploadFileInput) {
        dashReuploadFileInput.addEventListener('change', function() {
            if (this.files.length) {
                var _file = this.files[0];
                var _maxZip = 950 * 1024 * 1024;
                if (_file.size > _maxZip) {
                    var _sizeMB = (_file.size / (1024 * 1024)).toFixed(0);
                    if (typeof showToast === 'function') showToast('ZIP is ' + _sizeMB + ' MB  maximum allowed is 950 MB. Please split into smaller ZIPs.', 'error');
                    this.value = '';
                    if (dashReuploadFileName) dashReuploadFileName.textContent = 'Click or drag & drop a ZIP file';
                    if (dashReuploadConfirmBtn) { dashReuploadConfirmBtn.disabled = true; dashReuploadConfirmBtn.style.opacity = '0.5'; }
                    return;
                }
                if (dashReuploadFileName) dashReuploadFileName.textContent = _file.name;
                _dashUpdateReuploadConfirmState();
            }
        });
    }

    if (dashReuploadFolderBrowse && dashReuploadFolderInput) {
        dashReuploadFolderBrowse.addEventListener('click', function() {
            if (!dashAllowFolderUpload) {
                if (typeof showToast === 'function') showToast('Select Folder is available only for Pro User accounts.', 'warning');
                return;
            }
            dashReuploadFolderInput.click();
        });
    }

    if (dashReuploadFolderInput) {
        dashReuploadFolderInput.addEventListener('change', function() {
            if (!dashAllowFolderUpload) {
                this.value = '';
                if (dashReuploadFolderName) dashReuploadFolderName.textContent = 'No folder selected';
                if (typeof showToast === 'function') showToast('Select Folder is available only for Pro User accounts.', 'warning');
                _dashUpdateReuploadConfirmState();
                return;
            }
            const files = Array.from(this.files || []).filter(function(f) {
                return /\.(jpe?g|png|gif|bmp|webp|heic|heif|hei)$/i.test(f.name || '');
            });
            if (dashReuploadFolderName) {
                dashReuploadFolderName.textContent = files.length ? (files.length + ' image file(s) selected from folder') : 'No valid image files found in selected folder';
            }
            _dashUpdateReuploadConfirmState();
        });
    }

    if (dashReuploadFolderPath) {
        dashReuploadFolderPath.addEventListener('input', _dashUpdateReuploadConfirmState);
    }

    if (dashReuploadCancelBtn) dashReuploadCancelBtn.addEventListener('click', dashCloseReuploadModal);
    if (dashReuploadModal) dashReuploadModal.addEventListener('click', function(e) { if (e.target === dashReuploadModal) dashCloseReuploadModal(); });

    if (dashReuploadConfirmBtn) {
        dashReuploadConfirmBtn.addEventListener('click', function() {
            if (!dashReuploadTableId) return;
            dashReuploadConfirmBtn.disabled = true;
            dashReuploadConfirmBtn.textContent = 'Uploading...';
            if (dashReuploadProgress) dashReuploadProgress.style.display = 'block';
            if (dashReuploadBar) dashReuploadBar.style.width = '0%';
            if (dashReuploadStatus) dashReuploadStatus.textContent = 'Starting upload...';
            let _dashPollInterval = null;

            const formData = new FormData();
            if (dashReuploadFileInput && dashReuploadFileInput.files && dashReuploadFileInput.files.length) {
                formData.append('photos_zip', dashReuploadFileInput.files[0]);
            }
            if (dashAllowFolderUpload && dashReuploadFolderInput && dashReuploadFolderInput.files && dashReuploadFolderInput.files.length) {
                Array.from(dashReuploadFolderInput.files).filter(function(f) {
                    return /\.(jpe?g|png|gif|bmp|webp|heic|heif|hei)$/i.test(f.name || '');
                }).forEach(function(f) {
                    formData.append('photos_folder_files', f, f.webkitRelativePath || f.name);
                });
            }
            if (dashAllowFolderUpload && dashReuploadFolderPath && dashReuploadFolderPath.value && dashReuploadFolderPath.value.trim()) {
                formData.append('photos_folder_path', dashReuploadFolderPath.value.trim());
            }

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/table/${dashReuploadTableId}/reupload-task/`);
            xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
            xhr.timeout = 300000;

            xhr.upload.onprogress = function(e) {
                if (e.lengthComputable) {
                    const uploadPct = Math.round((e.loaded / e.total) * 80);
                    if (dashReuploadBar) dashReuploadBar.style.width = uploadPct + '%';
                    if (dashReuploadStatus) dashReuploadStatus.textContent = `Uploading... ${Math.round(e.loaded / e.total * 100)}%`;
                }
            };

            xhr.onload = function() {
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (xhr.status === 200 && data.success) {
                        if (dashReuploadBar) dashReuploadBar.style.width = '80%';
                        if (dashReuploadStatus) dashReuploadStatus.textContent = 'Processing images...';
                        // Poll for real task progress
                        _dashPollInterval = setInterval(function() {
                            fetch(panelUrl('/api/task-status/' + data.task_id + '/'))
                                .then(function(r) { return r.json(); })
                                .then(function(t) {
                                    if (t.status === 'completed') {
                                        clearInterval(_dashPollInterval);
                                        if (dashReuploadBar) dashReuploadBar.style.width = '100%';
                                        const matched = (t.result && t.result.matched_count != null) ? t.result.matched_count : '';
                                        const msg = matched !== '' ? ('Done! ' + matched + ' images matched.') : 'Done!';
                                        if (dashReuploadStatus) dashReuploadStatus.textContent = msg;
                                        if (typeof showToast === 'function') showToast(msg, 'success');
                                        setTimeout(() => dashCloseReuploadModal(), 1500);
                                    } else if (t.status === 'failed' || t.status === 'cancelled') {
                                        clearInterval(_dashPollInterval);
                                        const errMsg = t.error_message || 'Reupload failed. Please try again.';
                                        if (dashReuploadStatus) dashReuploadStatus.textContent = errMsg;
                                        if (typeof showToast === 'function') showToast(errMsg, 'error');
                                        dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                                    } else {
                                        const pct = 80 + Math.round((t.progress_percentage || 0) * 0.19);
                                        if (dashReuploadBar) dashReuploadBar.style.width = Math.min(pct, 99) + '%';
                                        if (dashReuploadStatus) dashReuploadStatus.textContent = 'Processing: ' + (t.progress || 0) + '/' + (t.total || '?') + ' images...';
                                    }
                                })
                                .catch(function() {}); // ignore transient network errors during polling
                        }, 2000);
                    } else {
                        if (dashReuploadStatus) dashReuploadStatus.textContent = data.message || 'Failed';
                        if (typeof showToast === 'function') showToast(data.message || 'Reupload failed', 'error');
                        dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                    }
                } catch (parseErr) {
                    console.error('Dashboard reupload parse error:', parseErr, 'Status:', xhr.status);
                    let errMsg = 'Unexpected error';
                    if (xhr.status === 413) errMsg = 'ZIP file too large.';
                    else if (xhr.status === 502 || xhr.status === 504) errMsg = 'Server timeout  try a smaller ZIP.';
                    else if (xhr.status === 500) errMsg = 'Server error. Please try again.';
                    else if (xhr.status === 0) errMsg = 'Connection lost. Check your internet.';
                    if (typeof showToast === 'function') showToast(errMsg, 'error');
                    dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                }
            };

            xhr.onerror = function() {
                const errMsg = 'Upload failed. Check your connection and try again.';
                if (typeof showToast === 'function') showToast(errMsg, 'error');
                if (dashReuploadStatus) dashReuploadStatus.textContent = errMsg;
                dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                if (dashReuploadProgress) dashReuploadProgress.style.display = 'none';
            };

            xhr.ontimeout = function() {
                if (typeof showToast === 'function') showToast('Upload timed out  try a smaller ZIP.', 'warning');
                dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                if (dashReuploadProgress) dashReuploadProgress.style.display = 'none';
            };

            xhr.send(formData);
        });
    }

    // Load bulk clients on page load
    loadBulkClients();

    // ====================
    // Load Print & Reprint Overview
    // ====================
    function loadReprintOverview() {
        const reprintBody = document.getElementById('reprintOverviewBody');
        const reprintTotalBadge = document.getElementById('reprintOverviewTotalRequested');
        if (!reprintBody) return;

        setDashboardTabCount(dashboardTabCountReprint, 0);

        setDashboardTableSkeleton(reprintBody, 3, 3);
        const skeletonStart = Date.now();

        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

        ApiClient.get(panelUrl('/api/reprint-overview/?limit=500'))
            .then(data => {
                if (!data.success) throw new Error(data.error || 'Failed');
                waitForMinDelay(skeletonStart).then(() => {
                    //  Render Reprint table
                    if (reprintBody) {
                        const clients = data.reprint_clients || [];
                        if (reprintTotalBadge) {
                            reprintTotalBadge.textContent = String(data.reprint_total_requested || 0);
                        }
                        setDashboardTabCount(dashboardTabCountReprint, Number(data.reprint_total_requested) || 0);
                        if (clients.length > 0) {
                            reprintBody.innerHTML = clients.map((client, i) => {
                                const tables = client.tables || [];
                                const iBadge = renderDashboardClientStatusBadge(client.status, esc);
                                const requested = Number(client.requested);
                                const confirmed = Number(client.confirmed);
                                const safeRequested = Number.isFinite(requested) ? requested : 0;
                                const safeConfirmed = Number.isFinite(confirmed) ? confirmed : 0;
                                const subRows = tables.map(t => `
                                    <tr class="client-sub-row reprint-expand-group-${i}" style="display:none">
                                        <td>
                                            <a href="${panelUrl('/reprint/table/' + t.id + '/')}" class="sub-row-name"><i class="fa-solid fa-table"></i> ${esc(t.name)}</a>
                                        </td>
                                        <td class="text-center"><a href="${panelUrl('/reprint/table/' + t.id + '/?step=request_list')}" class="count-badge pending">${t.requested}</a></td>
                                        <td class="text-center"><a href="${panelUrl('/reprint/table/' + t.id + '/?step=confirmed')}" class="count-badge verified">${t.confirmed}</a></td>
                                    </tr>
                                `).join('');
                                const hasSingleTable = tables.length === 1;
                                const directUrl = hasSingleTable ? panelUrl('/reprint/table/' + tables[0].id + '/') : '';
                                return `
                                    <tr class="client-row" data-idx="${i}" data-base-order="${i}" data-scope="reprint" data-sort-pending="${safeRequested}" data-sort-verified="${safeConfirmed}" onclick="toggleScopedExpandRow(this)">
                                        <td>
                                            <a href="${panelUrl('/client/' + client.id + '/groups/')}" class="client-name-link" onclick="event.stopPropagation()">${iBadge}<span class="client-name-text">${esc(client.name)}</span></a>
                                        </td>
                                        <td class="text-center">
                                            ${directUrl ? `<a href="${directUrl}?step=request_list" class="count-badge pending" onclick="event.stopPropagation()">${client.requested}</a>` : `<span class="count-badge pending">${client.requested}</span>`}
                                        </td>
                                        <td class="text-center">
                                            ${directUrl ? `<a href="${directUrl}?step=confirmed" class="count-badge verified" onclick="event.stopPropagation()">${client.confirmed}</a>` : `<span class="count-badge verified">${client.confirmed}</span>`}
                                        </td>
                                    </tr>
                                    ${subRows}
                                `;
                            }).join('');
                            setOverviewSortUI('reprint');
                            applyOverviewSort('reprint');
                            applyOverviewSearch('reprint');
                        } else {
                            reprintBody.innerHTML = `<tr><td colspan="3" class="text-center" style="padding:40px;color:#888;"><i class="fa-solid fa-inbox"></i> No reprint records</td></tr>`;
                            setOverviewSortUI('reprint');
                            applyOverviewSearch('reprint');
                        }
                    }
                });
            })
            .catch(err => {
                console.error('Error loading reprint overview:', err);
                setDashboardTabCount(dashboardTabCountReprint, 0);
                const errHtml = (cols) => `<tr><td colspan="${cols}" class="text-center" style="padding:40px;color:#dc2626;"><i class="fa-solid fa-exclamation-triangle"></i> Error loading data</td></tr>`;
                waitForMinDelay(skeletonStart).then(() => {
                    if (reprintBody) reprintBody.innerHTML = errHtml(3);
                });
            });
    }

    if (isAdminDashboardContext) {
        loadReprintOverview();
    }
});
