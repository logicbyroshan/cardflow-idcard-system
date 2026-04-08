// Dashboard Page  Bulk actions, API calls, modals, data loading
// Split from dashboard.js  see also dashboard-ui.js

window.DashboardPage = window.DashboardPage || {};

document.addEventListener('DOMContentLoaded', function() {
    const waitForMinDelay = window.waitForMinDelay || function () { return Promise.resolve(); };
    const DASHBOARD_LIVE_REFRESH_MS = 30000;
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
    const printOverviewSearchInput = document.getElementById('printOverviewSearch');
    const reprintOverviewSearchInput = document.getElementById('reprintOverviewSearch');
    const recentActivityTimeFilter = document.getElementById('recentActivityTimeFilter');
    const dashboardTabCountRecentClients = document.getElementById('dashboardTabCountRecentClients');
    const dashboardTabCountRecentUpdates = document.getElementById('dashboardTabCountRecentUpdates');
    const dashboardTabCountReprint = document.getElementById('dashboardTabCountReprint');
    const dashboardTabCountPrint = document.getElementById('dashboardTabCountPrint');

    function setDashboardTabCount(element, value) {
        if (!element) return;
        const count = Number(value);
        element.textContent = Number.isFinite(count) ? count.toLocaleString() : '0';
    }

    function setRecentClientUpdatesActiveBadge(count) {
        if (!recentClientUpdatesActiveBadge) return;
        const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
        recentClientUpdatesActiveBadge.textContent = `Active: ${safeCount.toLocaleString()}`;
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
                <tr class="recent-table-no-search-results">
                    <td colspan="${headerColumns}">
                        <i class="fa-solid fa-magnifying-glass"></i>
                        No clients matched "${query.replace(/"/g, '&quot;')}"
                    </td>
                </tr>
            `
        );
    }

    if (recentClientUpdatesSearchInput) {
        recentClientUpdatesSearchInput.addEventListener('input', applyRecentClientUpdatesSearch);
    }

    function applyOverviewSearch(scope) {
        const tbody = scope === 'print'
            ? document.getElementById('printOverviewBody')
            : document.getElementById('reprintOverviewBody');
        const inputEl = scope === 'print' ? printOverviewSearchInput : reprintOverviewSearchInput;
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
            const searchable = `${clientName} ${tableNames}`.trim();
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

    if (printOverviewSearchInput) {
        printOverviewSearchInput.addEventListener('input', function() {
            applyOverviewSearch('print');
        });
    }

    if (reprintOverviewSearchInput) {
        reprintOverviewSearchInput.addEventListener('input', function() {
            applyOverviewSearch('reprint');
        });
    }

    // ====================
    // Load Recent Client Updates
    // ====================
    function loadRecentClientUpdates() {
        const tbody = document.getElementById('recentClientUpdatesBody');
        if (!tbody) return;
        const headerColumns = tbody.closest('table')?.querySelectorAll('thead th')?.length || 5;
        const showPool = headerColumns >= 6;
        setDashboardTabCount(dashboardTabCountRecentClients, 0);
        setRecentClientUpdatesActiveBadge(0);
        setDashboardTableSkeleton(tbody, headerColumns, 3);
        const skeletonStart = Date.now();
        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        
        ApiClient.get(panelUrl('/api/recent-client-updates/'))
            .then(data => {
                waitForMinDelay(skeletonStart).then(() => {
                    if (data.success && data.clients.length > 0) {
                        const activeClients = data.clients.filter(function(client) {
                            return String(client.status || '').toLowerCase() === 'active';
                        }).length;
                        setRecentClientUpdatesActiveBadge(activeClients);
                        setDashboardTabCount(dashboardTabCountRecentClients, data.clients.length);
                        tbody.innerHTML = data.clients.map((client, i) => {
                            const tables = client.tables || [];
                            const inactiveBadge = client.status && client.status !== 'active'
                                ? ` <span class="count-badge" style="background:#fee2e2;color:#dc2626;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px;">${esc(client.status)}</span>`
                                : '';
                            // Build sub-rows for each table (same column structure)
                            const tableSubRows = tables.map(t => `
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
                            `).join('');

                            return `
                            <tr class="client-row" data-idx="${i}" onclick="toggleClientExpandRow(this)">
                                <td>
                                    <a href="${panelUrl('/client/' + client.client_id + '/groups/')}" class="client-name-link" onclick="event.stopPropagation()">${esc(client.name)}${inactiveBadge}</a>
                                </td>
                                <td class="text-center">
                                    <span class="count-badge pending">${client.pending}</span>
                                </td>
                                <td class="text-center">
                                    <span class="count-badge verified">${client.verified}</span>
                                </td>
                                <td class="text-center">
                                    <span class="count-badge approved">${client.approved}</span>
                                </td>
                                <td class="text-center">
                                    <span class="count-badge downloaded">${client.downloaded}</span>
                                </td>
                                ${showPool ? `
                                <td class="text-center">
                                    <span class="count-badge pool">${client.pool}</span>
                                </td>
                                ` : ''}
                            </tr>
                            ${tableSubRows}
                        `}).join('');
                        applyRecentClientUpdatesSearch();
                    } else {
                        setRecentClientUpdatesActiveBadge(0);
                        setDashboardTabCount(dashboardTabCountRecentClients, 0);
                        tbody.innerHTML = `
                            <tr>
                                <td colspan="${headerColumns}" class="text-center" style="padding: 40px; color: #888;">
                                    <i class="fa-solid fa-users-slash"></i> No recent client updates
                                </td>
                            </tr>
                        `;
                        applyRecentClientUpdatesSearch();
                    }
                });
            })
            .catch(error => {
                console.error('Error loading recent client updates:', error);
                waitForMinDelay(skeletonStart).then(() => {
                    setRecentClientUpdatesActiveBadge(0);
                    setDashboardTabCount(dashboardTabCountRecentClients, 0);
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="${headerColumns}" class="text-center" style="padding: 40px; color: #dc2626;">
                                <i class="fa-solid fa-exclamation-triangle"></i> Error loading data
                            </td>
                        </tr>
                    `;
                    applyRecentClientUpdatesSearch();
                });
            });
    }
    
    // Load recent client updates on page load
    loadRecentClientUpdates();

    // ====================
    // Live Dashboard Stats (Auto Refresh)
    // ====================
    function setDashboardStatValue(el, value) {
        if (!el) return;
        const n = Number(value);
        el.textContent = Number.isFinite(n) ? n.toLocaleString() : '0';
    }

    function loadDashboardCardStats() {
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
        const activityList = document.getElementById('recentActivityList');
        if (!activityList) return;
        const timeWindow = (recentActivityTimeFilter && recentActivityTimeFilter.value)
            ? recentActivityTimeFilter.value
            : 'all';

        const esc = typeof escapeHtml === 'function'
            ? escapeHtml
            : (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');

        ApiClient.get(panelUrl(`/api/recent-activity/?limit=100&window=${encodeURIComponent(timeWindow)}`))
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

    if (recentActivityTimeFilter) {
        recentActivityTimeFilter.addEventListener('change', function() {
            loadRecentActivity();
        });
    }

    function refreshLiveDashboardSections() {
        loadDashboardCardStats();
        loadRecentActivity();
    }

    let liveRefreshTimer = null;
    function startLiveDashboardRefresh() {
        if (liveRefreshTimer || document.hidden) return;
        liveRefreshTimer = setInterval(refreshLiveDashboardSections, DASHBOARD_LIVE_REFRESH_MS);
    }

    function stopLiveDashboardRefresh() {
        if (!liveRefreshTimer) return;
        clearInterval(liveRefreshTimer);
        liveRefreshTimer = null;
    }

    if (document.getElementById('recentActivityList') || document.getElementById('pendingCards')) {
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
    const dashReuploadConfirmBtn = document.getElementById('dashReuploadConfirm');
    const dashReuploadCancelBtn = document.getElementById('dashReuploadCancel');
    const dashReuploadProgress = document.getElementById('dashReuploadProgress');
    const dashReuploadBar = document.getElementById('dashReuploadBar');
    const dashReuploadStatus = document.getElementById('dashReuploadStatus');

    function dashOpenReuploadModal(tableId) {
        dashReuploadTableId = tableId;
        if (dashReuploadFileInput) dashReuploadFileInput.value = '';
        if (dashReuploadFileName) dashReuploadFileName.textContent = 'Click or drag & drop a ZIP file';
        if (dashReuploadConfirmBtn) { dashReuploadConfirmBtn.disabled = true; dashReuploadConfirmBtn.style.opacity = '0.5'; dashReuploadConfirmBtn.textContent = 'Upload & Match'; }
        if (dashReuploadProgress) dashReuploadProgress.style.display = 'none';
        if (dashReuploadBar) dashReuploadBar.style.width = '0%';
        if (window.alpineOpenModal) window.alpineOpenModal('dashReupload');
    }

    function dashCloseReuploadModal() {
        if (window.alpineCloseModal) window.alpineCloseModal();
        dashReuploadTableId = null;
        if (dashReuploadFileInput) dashReuploadFileInput.value = '';
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
                if (dashReuploadConfirmBtn) { dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.style.opacity = '1'; }
            }
        });
    }

    if (dashReuploadCancelBtn) dashReuploadCancelBtn.addEventListener('click', dashCloseReuploadModal);
    if (dashReuploadModal) dashReuploadModal.addEventListener('click', function(e) { if (e.target === dashReuploadModal) dashCloseReuploadModal(); });

    if (dashReuploadConfirmBtn) {
        dashReuploadConfirmBtn.addEventListener('click', function() {
            if (!dashReuploadTableId || !dashReuploadFileInput || !dashReuploadFileInput.files.length) return;
            dashReuploadConfirmBtn.disabled = true;
            dashReuploadConfirmBtn.textContent = 'Uploading...';
            if (dashReuploadProgress) dashReuploadProgress.style.display = 'block';
            if (dashReuploadBar) dashReuploadBar.style.width = '0%';
            if (dashReuploadStatus) dashReuploadStatus.textContent = 'Starting upload...';
            let _dashPollInterval = null;

            const formData = new FormData();
            formData.append('photos_zip', dashReuploadFileInput.files[0]);

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
    function loadPrintReprintOverview() {
        const printBody = document.getElementById('printOverviewBody');
        const reprintBody = document.getElementById('reprintOverviewBody');
        const reprintTotalBadge = document.getElementById('reprintOverviewTotalRequested');
        if (!printBody && !reprintBody) return;

        setDashboardTabCount(dashboardTabCountPrint, 0);
        setDashboardTabCount(dashboardTabCountReprint, 0);

        setDashboardTableSkeleton(printBody, 3, 3);
        setDashboardTableSkeleton(reprintBody, 3, 3);
        const skeletonStart = Date.now();

        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

        ApiClient.get(panelUrl('/api/print-reprint-overview/?limit=500'))
            .then(data => {
                if (!data.success) throw new Error(data.error || 'Failed');
                waitForMinDelay(skeletonStart).then(() => {
                    //  Render Print table
                    if (printBody) {
                        const clients = data.print_clients || [];
                        const totalPrintGenerate = clients.reduce((sum, client) => {
                            return sum + (Number(client.generate_list) || 0);
                        }, 0);
                        setDashboardTabCount(dashboardTabCountPrint, totalPrintGenerate);
                        if (clients.length > 0) {
                            printBody.innerHTML = clients.map((client, i) => {
                                const tables = client.tables || [];
                                const iBadge = client.status && client.status !== 'active'
                                    ? ` <span class="count-badge" style="background:#fee2e2;color:#dc2626;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px;">${esc(client.status)}</span>`
                                    : '';
                                const subRows = tables.map(t => `
                                    <tr class="client-sub-row print-expand-group-${i}" style="display:none">
                                        <td>
                                            <a href="${panelUrl('/print/table/' + t.id + '/')}" class="sub-row-name"><i class="fa-solid fa-table"></i> ${esc(t.name)}</a>
                                        </td>
                                        <td class="text-center"><a href="${panelUrl('/print/table/' + t.id + '/')}" class="count-badge pending">${t.generate_list}</a></td>
                                        <td class="text-center"><a href="${panelUrl('/print/table/' + t.id + '/')}" class="count-badge verified">${t.finalized}</a></td>
                                    </tr>
                                `).join('');
                                return `
                                    <tr class="client-row" data-idx="${i}" data-scope="print" onclick="toggleScopedExpandRow(this)">
                                        <td>
                                            <a href="${panelUrl('/client/' + client.id + '/groups/')}" class="client-name-link" onclick="event.stopPropagation()">${esc(client.name)}${iBadge}</a>
                                        </td>
                                        <td class="text-center"><span class="count-badge pending">${client.generate_list}</span></td>
                                        <td class="text-center"><span class="count-badge verified">${client.finalized}</span></td>
                                    </tr>
                                    ${subRows}
                                `;
                            }).join('');
                            applyOverviewSearch('print');
                        } else {
                            printBody.innerHTML = `<tr><td colspan="3" class="text-center" style="padding:40px;color:#888;"><i class="fa-solid fa-inbox"></i> No print records</td></tr>`;
                            applyOverviewSearch('print');
                        }
                    }

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
                                const iBadge = client.status && client.status !== 'active'
                                    ? ` <span class="count-badge" style="background:#fee2e2;color:#dc2626;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px;">${esc(client.status)}</span>`
                                    : '';
                                const subRows = tables.map(t => `
                                    <tr class="client-sub-row reprint-expand-group-${i}" style="display:none">
                                        <td>
                                            <a href="${panelUrl('/reprint/table/' + t.id + '/')}" class="sub-row-name"><i class="fa-solid fa-table"></i> ${esc(t.name)}</a>
                                        </td>
                                        <td class="text-center"><a href="${panelUrl('/reprint/table/' + t.id + '/?step=request_list')}" class="count-badge pending">${t.requested}</a></td>
                                        <td class="text-center"><a href="${panelUrl('/reprint/table/' + t.id + '/?step=confirmed')}" class="count-badge verified">${t.confirmed}</a></td>
                                    </tr>
                                `).join('');
                                return `
                                    <tr class="client-row" data-idx="${i}" data-scope="reprint" onclick="toggleScopedExpandRow(this)">
                                        <td>
                                            <a href="${panelUrl('/client/' + client.id + '/groups/')}" class="client-name-link" onclick="event.stopPropagation()">${esc(client.name)}${iBadge}</a>
                                        </td>
                                        <td class="text-center"><span class="count-badge pending">${client.requested}</span></td>
                                        <td class="text-center"><span class="count-badge verified">${client.confirmed}</span></td>
                                    </tr>
                                    ${subRows}
                                `;
                            }).join('');
                            applyOverviewSearch('reprint');
                        } else {
                            reprintBody.innerHTML = `<tr><td colspan="3" class="text-center" style="padding:40px;color:#888;"><i class="fa-solid fa-inbox"></i> No reprint records</td></tr>`;
                            applyOverviewSearch('reprint');
                        }
                    }
                });
            })
            .catch(err => {
                console.error('Error loading print/reprint overview:', err);
                setDashboardTabCount(dashboardTabCountPrint, 0);
                setDashboardTabCount(dashboardTabCountReprint, 0);
                const errHtml = (cols) => `<tr><td colspan="${cols}" class="text-center" style="padding:40px;color:#dc2626;"><i class="fa-solid fa-exclamation-triangle"></i> Error loading data</td></tr>`;
                waitForMinDelay(skeletonStart).then(() => {
                    if (printBody)   printBody.innerHTML = errHtml(3);
                    if (reprintBody) reprintBody.innerHTML = errHtml(3);
                });
            });
    }

    loadPrintReprintOverview();
});
