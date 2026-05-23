/**
 * Manage Panel  Notification Management JS
 * Handles: CRUD notifications, tab switching, user picker, search
 */

/* ============ State ============ */
let panelNotifications = [];
let panelTotal = 0;
let _notifPage = 1;
let _notifPerPage = 25;
let _notifTotalPages = 1;
let allUsers = {};       // { role: [{id, name, username, role_display}] }
let selectedUserIds = new Set();
let _createNotifStep = 1;
let searchTimer = null;
let serverInfoSnapshot = null;
let serverInfoHasFetched = false;
let serverInfoLoading = false;
let _maintenanceEnabled = false;
let _domainNotFoundEnabled = false;
let _domainCanSendProAccess = false;
let _domainStatusLoading = false;
let _domainToggleBusy = false;
let _domainEmailBusy = false;
let _batchJobsAutoRefreshTimer = null;
let _templateEditorBound = false;
const MANAGE_PANEL_TAB_KEY = 'managePanel:lastTab';
const SERVER_INFO_LOCAL_CACHE_KEY = 'managePanel:serverInfoSnapshot:v2';
const SERVER_INFO_LOCAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MANAGE_PANEL_BATCH_REFRESH_MS = 30000;
const MANAGE_PANEL_BASE = window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';

function managePanelUrl(path) {
  if (!path) return path;
  const raw = String(path);
  if (raw.indexOf('http://') === 0 || raw.indexOf('https://') === 0) return raw;
  if (raw.indexOf('/panel/') === 0) return raw;
  const normalized = raw.charAt(0) === '/' ? raw : ('/' + raw);
  if (MANAGE_PANEL_BASE) return MANAGE_PANEL_BASE + normalized;
  return normalized;
}

function _isPageReloadNavigation() {
  try {
    const navEntries = (performance && performance.getEntriesByType)
      ? performance.getEntriesByType('navigation')
      : [];
    if (navEntries && navEntries.length) return navEntries[0].type === 'reload';
    if (performance && performance.navigation) return performance.navigation.type === 1;
  } catch (e) {
    // Ignore and fall back to default false
  }
  return false;
}

function _saveManagePanelTab(tabName) {
  if (!tabName) return;
  try {
    localStorage.setItem(MANAGE_PANEL_TAB_KEY, tabName);
  } catch (e) {
    // localStorage may be unavailable in strict privacy mode
  }
}

function _restoreManagePanelTabOnReload() {
  if (!_isPageReloadNavigation()) return '';
  let saved = '';
  try {
    saved = localStorage.getItem(MANAGE_PANEL_TAB_KEY) || '';
  } catch (e) {
    saved = '';
  }
  if (!saved) return '';
  if (saved === 'monitoring') saved = 'log-history';
  if (!document.querySelector(`.panel-tab[data-tab="${saved}"]`)) return '';
  switchTab(saved);
  return saved;
}

function _getAvailablePanelTabs() {
  return Array.from(document.querySelectorAll('.panel-tab[data-tab]'))
    .map(function (el) { return el.getAttribute('data-tab') || ''; })
    .filter(Boolean);
}

function _formatBatchJobDuration(totalSeconds) {
  const seconds = Number(totalSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function _formatBatchJobUpdatedAt() {
  const now = new Date();
  return `Updated ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

function _batchJobStatusClass(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return '';
  return 'is-' + normalized;
}

function _renderManagePanelBatchJobRows(tasks) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return '<div class="batch-job-empty"><i class="fa-solid fa-circle-info"></i>No batch jobs found yet.</div>';
  }

  return tasks.map((task) => {
    const status = String(task.status || '').toLowerCase();
    const statusDisplay = escHtml(task.status_display || task.status || 'Unknown');
    const typeDisplay = escHtml(task.task_type_display || task.task_type || 'Task');
    const owner = escHtml(task.owner_name || 'You');
    const stage = escHtml(task.stage_label || statusDisplay);
    const progress = Number(task.progress) || 0;
    const total = Number(task.total) || 0;
    const progressPercentage = Math.max(0, Math.min(100, Number(task.progress_percentage) || 0));
    const elapsed = _formatBatchJobDuration(task.elapsed_seconds);
    const eta = task.eta_seconds == null ? '-' : _formatBatchJobDuration(task.eta_seconds);
    const metaProgress = total > 0 ? `${progress.toLocaleString()} / ${total.toLocaleString()}` : `${progress.toLocaleString()}`;
    const createdAt = task.created_at ? new Date(task.created_at).toLocaleString() : '-';

    const taskId = Number(task.task_id || 0);
    const canCancel = !!task.can_cancel && Number.isInteger(taskId) && taskId > 0;
    const cancelBtn = canCancel
      ? `<button type="button" class="batch-job-action-btn" data-batch-job-cancel="${taskId}">Cancel</button>`
      : '';
    const downloadUrl = String(task.download_url || '').trim();
    const downloadBtn = downloadUrl
      ? `<button type="button" class="batch-job-action-btn" data-batch-job-download="${escAttr(downloadUrl)}">Download</button>`
      : '';

    return `
      <div class="batch-job-item">
        <div class="batch-job-row">
          <div>
            <div class="batch-job-title">${typeDisplay}</div>
            <div class="batch-job-owner">Owner: ${owner}</div>
          </div>
          <span class="batch-job-status-pill ${_batchJobStatusClass(status)}">${statusDisplay}</span>
        </div>
        <div class="batch-job-progress-line">
          <div class="batch-job-progress-fill" style="width: ${progressPercentage}%;"></div>
        </div>
        <div class="batch-job-meta">
          <span><strong>${metaProgress}</strong> (${progressPercentage}%)</span>
          <span>Stage: ${stage}</span>
          <span>Elapsed: ${elapsed}</span>
          <span>ETA: ${eta}</span>
          <span>Created: ${escHtml(createdAt)}</span>
          <span class="batch-job-actions">${cancelBtn}${downloadBtn}</span>
        </div>
      </div>
    `;
  }).join('');
}

function _bindManagePanelBatchJobActions() {
  const listEl = document.getElementById('batchJobProgressList');
  if (!listEl || listEl.dataset.boundBatchActions === '1') return;

  listEl.addEventListener('click', async function(event) {
    const cancelBtn = event.target.closest('[data-batch-job-cancel]');
    if (cancelBtn) {
      event.preventDefault();
      const taskId = Number(cancelBtn.getAttribute('data-batch-job-cancel') || 0);
      if (!Number.isInteger(taskId) || taskId <= 0) return;

      cancelBtn.disabled = true;
      try {
        const res = await fetch(managePanelUrl(`/api/task-cancel/${taskId}/`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken(),
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (res.ok && data && data.success) {
          if (typeof showToast === 'function') showToast(data.message || 'Task cancel requested', 'success');
        } else if (typeof showToast === 'function') {
          showToast((data && data.message) || 'Unable to cancel task', 'error');
        }
      } catch (err) {
        console.error('batch job cancel failed:', err);
        if (typeof showToast === 'function') showToast('Unable to cancel task', 'error');
      } finally {
        window.loadManagePanelBatchJobProgressCenter(false);
      }
      return;
    }

    const downloadBtn = event.target.closest('[data-batch-job-download]');
    if (downloadBtn) {
      event.preventDefault();
      const downloadUrl = downloadBtn.getAttribute('data-batch-job-download') || '';
      if (!downloadUrl) return;
      window.location.href = managePanelUrl(downloadUrl);
    }
  });

  listEl.dataset.boundBatchActions = '1';
}

function _syncBatchJobsAutoRefresh(shouldRun) {
  if (!shouldRun) {
    if (_batchJobsAutoRefreshTimer) {
      clearInterval(_batchJobsAutoRefreshTimer);
      _batchJobsAutoRefreshTimer = null;
    }
    return;
  }

  if (_batchJobsAutoRefreshTimer) return;

  _batchJobsAutoRefreshTimer = setInterval(function () {
    const activeTab = document.querySelector('.panel-tab.active')?.dataset?.tab;
    if (activeTab === 'batch-jobs' && !document.hidden) {
      window.loadManagePanelBatchJobProgressCenter(false);
    }
  }, MANAGE_PANEL_BATCH_REFRESH_MS);
}

window.loadManagePanelBatchJobProgressCenter = async function(showLoadingState) {
  const listEl = document.getElementById('batchJobProgressList');
  if (!listEl) return;

  const activeCountEl = document.getElementById('batchJobActiveCount');
  const pendingCountEl = document.getElementById('batchJobPendingCount');
  const processingCountEl = document.getElementById('batchJobProcessingCount');
  const completedCountEl = document.getElementById('batchJobCompletedCount');
  const failedCountEl = document.getElementById('batchJobFailedCount');
  const updatedAtEl = document.getElementById('batchJobLastUpdated');
  const refreshBtn = document.getElementById('batchJobRefreshBtn');
  const shouldShowLoading = showLoadingState !== false;

  _bindManagePanelBatchJobActions();

  if (shouldShowLoading) {
    listEl.innerHTML = '<div class="batch-job-empty"><i class="fa-solid fa-spinner fa-spin"></i>Loading batch jobs...</div>';
  }

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing';
  }

  try {
    const res = await fetch(managePanelUrl('/api/task-progress-center/?limit=8'), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!res.ok) throw new Error('Failed to load task progress center');

    const data = await res.json();
    if (!data || !data.success) {
      throw new Error((data && data.message) || 'Failed to load task progress center');
    }

    const stats = data.stats || {};
    const activeCount = Number(stats.active) || 0;
    const pendingCount = Number(stats.pending) || 0;
    const processingCount = Number(stats.processing) || 0;
    const completed24hCount = Number(stats.completed_24h) || 0;
    const failed24hCount = Number(stats.failed_24h) || 0;

    if (activeCountEl) activeCountEl.textContent = activeCount.toLocaleString();
    if (pendingCountEl) pendingCountEl.textContent = pendingCount.toLocaleString();
    if (processingCountEl) processingCountEl.textContent = processingCount.toLocaleString();
    if (completedCountEl) completedCountEl.textContent = completed24hCount.toLocaleString();
    if (failedCountEl) failedCountEl.textContent = failed24hCount.toLocaleString();
    if (updatedAtEl) updatedAtEl.textContent = _formatBatchJobUpdatedAt();

    listEl.innerHTML = _renderManagePanelBatchJobRows(data.tasks || []);
  } catch (error) {
    console.error('Error loading batch jobs:', error);
    if (activeCountEl) activeCountEl.textContent = '0';
    if (pendingCountEl) pendingCountEl.textContent = '0';
    if (processingCountEl) processingCountEl.textContent = '0';
    if (completedCountEl) completedCountEl.textContent = '0';
    if (failedCountEl) failedCountEl.textContent = '0';
    if (updatedAtEl) updatedAtEl.textContent = 'Update failed';
    listEl.innerHTML = '<div class="batch-job-empty"><i class="fa-solid fa-triangle-exclamation"></i>Unable to load batch jobs right now.</div>';
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh';
    }
  }
};

function _loadInitialManagePanelTabData(tabName) {
  if (!tabName) return;
  if (tabName === 'notifications') {
    loadNotifications();
    return;
  }
  if (tabName === 'download-templates') {
    loadTemplates();
    return;
  }
  if (tabName === 'log-history') {
    loadOperationsFeed(1);
    return;
  }
  if (tabName === 'email-logs') {
    loadEmailLogs(1);
    return;
  }
  if (tabName === 'server-info') {
    initServerInfoTab();
    return;
  }
  if (tabName === 'sessions') {
    initSessionsTab();
    return;
  }
  if (tabName === 'maintenance' && typeof loadMaintenanceStatus === 'function') {
    loadMaintenanceStatus();
  }
}

function initSessionsTab() {
  const section = document.getElementById('panelSessionsSection');
  if (!section) return;
}

/* ============ Init ============ */
document.addEventListener('DOMContentLoaded', function() {
  const restoredTab = _restoreManagePanelTabOnReload();
  if (restoredTab) {
    _loadInitialManagePanelTabData(restoredTab);
    return;
  }

  const tabs = _getAvailablePanelTabs();
  if (!tabs.length) return;
  const initialTab = tabs[0];
  switchTab(initialTab);
  _loadInitialManagePanelTabData(initialTab);
});

/* ============ Tabs ============ */
function switchTab(tabName) {
  const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
  const tabPane = document.getElementById(`tab-${tabName}`);
  if (!tabBtn || !tabPane) return false;

  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  // Also strip inline display overrides so the CSS .active rule always wins
  document.querySelectorAll('.panel-tab-content').forEach(c => {
    c.classList.remove('active');
    c.style.removeProperty('display');
  });
  tabBtn.classList.add('active');
  tabPane.classList.add('active');
  if (tabName === 'notifications' && typeof loadMaintenanceStatus === 'function') {
    loadMaintenanceStatus();
  }
  if (tabName === 'notifications' && typeof loadDomainNotFoundStatus === 'function') {
    loadDomainNotFoundStatus();
  }
  if (tabName === 'download-templates') {
    loadTemplates();
  }
  _saveManagePanelTab(tabName);
  return true;
}

/* Expose select functions to global scope for inline onclick handlers (defensive) */
(function () {
  try {
    if (typeof switchTab === 'function') window.switchTab = switchTab;
    if (typeof initSessionsTab === 'function') window.initSessionsTab = initSessionsTab;
    if (typeof initServerInfoTab === 'function') window.initServerInfoTab = initServerInfoTab;
    if (typeof loadEmailLogs === 'function') window.loadEmailLogs = loadEmailLogs;
    if (typeof loadOperationsFeed === 'function') window.loadOperationsFeed = loadOperationsFeed;
    if (typeof loadTemplates === 'function') window.loadTemplates = loadTemplates;
  } catch (err) {
    // ignore; we'll retry shortly
  }

  // Defensive: if some module system or bundler wraps definitions, re-check soon
  // and ensure globals are assigned once functions become available.
  try {
    setTimeout(function () {
      try {
        if (typeof switchTab === 'function') window.switchTab = switchTab;
        if (typeof initSessionsTab === 'function') window.initSessionsTab = initSessionsTab;
        if (typeof initServerInfoTab === 'function') window.initServerInfoTab = initServerInfoTab;
        if (typeof loadEmailLogs === 'function') window.loadEmailLogs = loadEmailLogs;
        if (typeof loadOperationsFeed === 'function') window.loadOperationsFeed = loadOperationsFeed;
        if (typeof loadTemplates === 'function') window.loadTemplates = loadTemplates;
      } catch (e) {
        // final no-op
      }
    }, 0);
  } catch (e) {
    // ignore
  }
})();

/* ============ Load Notifications ============ */
async function loadNotifications(page) {
  if (page !== undefined && page !== null) {
    if (typeof page === 'number') {
      _notifPage = Math.max(1, Number(page || 1));
    } else if (page === false) {
      _notifPage = 1;
    }
  }

  const panelOffset = (_notifPage - 1) * _notifPerPage;
  let skeletonStart = null;
  skeletonStart = setPanelTableSkeleton('notifTableBody', {
    colCount: 8,
    columns: ['0.7fr', '2.7fr', '1.2fr', '1fr', '1.3fr', '0.9fr', '1.2fr', '1fr'],
    rows: 3,
    ariaLabel: 'Loading notifications...',
  });
  try {
    const search = document.getElementById('notifSearch')?.value || '';
    const res = await fetch(`/api/notifications/admin/list/?limit=${_notifPerPage}&offset=${panelOffset}&search=${encodeURIComponent(search)}`);
    if (!res.ok) {
      console.error('Failed to load notifications: HTTP', res.status);
      await waitForPanelSkeletonDelay(skeletonStart);
      setPanelTableError(
        'notifTableBody',
        8,
        'fa-bell-slash',
        'Unable to load notifications',
        'Please refresh and try again.'
      );
      return;
    }
    const data = await res.json();
    if (!data.success) {
      await waitForPanelSkeletonDelay(skeletonStart);
      setPanelTableError(
        'notifTableBody',
        8,
        'fa-bell-slash',
        'Unable to load notifications',
        'Please refresh and try again.'
      );
      return;
    }

    panelNotifications = data.notifications || [];
    panelTotal = data.total;
    _notifTotalPages = Math.max(1, Math.ceil(Math.max(0, panelTotal) / _notifPerPage));

    if (_notifPage > _notifTotalPages) {
      _notifPage = _notifTotalPages;
      return loadNotifications(_notifPage);
    }

    // Cache server-side aggregate stats so updateStats() is accurate
    if (data.stats) window._panelNotifStats = data.stats;

    await waitForPanelSkeletonDelay(skeletonStart);
    renderTable();
    _updateNotifPagination(panelNotifications.length);
    updateStats();
    var totalEl = document.getElementById('totalNotifCount');
    if (totalEl) totalEl.textContent = panelTotal;
  } catch (err) {
    console.error('Failed to load notifications:', err);
    await waitForPanelSkeletonDelay(skeletonStart);
    setPanelTableError(
      'notifTableBody',
      8,
      'fa-bell-slash',
      'Unable to load notifications',
      'Network issue. Please refresh and try again.'
    );
  }
}

function _buildNotifPageNumbers(currentPage, totalPages) {
  if (!totalPages || totalPages < 1) return '';
  const maxVisible = 5;
  let start = Math.max(1, currentPage - 2);
  let end = Math.min(totalPages, start + maxVisible - 1);
  if ((end - start + 1) < maxVisible) {
    start = Math.max(1, end - maxVisible + 1);
  }

  let html = '';
  for (let p = start; p <= end; p++) {
    html += '<button class="page-num' + (p === currentPage ? ' active' : '') + '" onclick="notifSetPage(' + p + ')">' + p + '</button>';
  }
  return html;
}

function _updateNotifPagination(rowsOnPage) {
  const safeTotal = Math.max(0, Number(panelTotal || 0));
  const safeRows = Math.max(0, Number(rowsOnPage || 0));
  const start = safeTotal ? ((_notifPage - 1) * _notifPerPage) + 1 : 0;
  const end = safeTotal ? (start + safeRows - 1) : 0;

  const info = document.getElementById('notifPaginationInfo');
  const pageNumbers = document.getElementById('notifPageNumbers');
  const firstBtn = document.getElementById('notifFirstBtn');
  const prevBtn = document.getElementById('notifPrevBtn');
  const nextBtn = document.getElementById('notifNextBtn');
  const lastBtn = document.getElementById('notifLastBtn');
  const rowsSelect = document.getElementById('notifRowsPerPage');

  if (info) {
    info.innerHTML = 'Showing <strong>' + start + '-' + end + '</strong> of <strong>' + safeTotal + '</strong> results';
  }
  if (pageNumbers) {
    pageNumbers.innerHTML = _buildNotifPageNumbers(_notifPage, _notifTotalPages);
  }

  if (firstBtn) firstBtn.disabled = _notifPage <= 1;
  if (prevBtn) prevBtn.disabled = _notifPage <= 1;
  if (nextBtn) nextBtn.disabled = _notifPage >= _notifTotalPages;
  if (lastBtn) lastBtn.disabled = _notifPage >= _notifTotalPages;
  if (rowsSelect && String(rowsSelect.value) !== String(_notifPerPage)) {
    rowsSelect.value = String(_notifPerPage);
  }
}

window.notifSetPage = function (page) {
  const requested = page === -1 ? _notifTotalPages : Number(page || 1);
  const nextPage = Math.max(1, Math.min(requested, _notifTotalPages));
  if (nextPage === _notifPage) return;
  loadNotifications(nextPage);
};

window.notifPage = function (delta) {
  notifSetPage(_notifPage + Number(delta || 0));
};

window.onNotifRowsPerPageChange = function (value) {
  const next = Number(value || 25);
  _notifPerPage = [10, 25, 50, 100].includes(next) ? next : 25;
  _notifPage = 1;
  loadNotifications(1);
};

/* ============ Render Table ============ */
function renderTable() {
  const tbody = document.getElementById('notifTableBody');
  if (!panelNotifications.length) {
    tbody.innerHTML = `<tr class="notif-table-empty"><td colspan="8">
      <div class="empty-state">
        <i class="fa-solid fa-bell-slash"></i>
        <p>No notifications yet</p>
        <span>Create your first notification to get started</span>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = panelNotifications.map((n, i) => {
    const msgPreview = n.message.length > 60 ? n.message.substring(0, 60) + '...' : n.message;
    const rowNumber = ((_notifPage - 1) * _notifPerPage) + i + 1;
    return `<tr>
      <td class="text-center text-xs text-gray-400">${rowNumber}</td>
      <td>
        <div class="notif-title-cell">
          <strong>${escHtml(n.title)}</strong>
          <span>${escHtml(msgPreview)}</span>
        </div>
      </td>
      <td><span class="notif-badge-cat"><i class="fa-solid ${n.icon_class}"></i> ${escHtml(n.category_display)}</span></td>
      <td><span class="notif-badge-priority ${n.priority}">${capitalize(n.priority)}</span></td>
      <td><span class="notif-badge-target">${escHtml(n.target_display)}</span></td>
      <td><span class="notif-reads">${n.read_count || 0}</span></td>
      <td><span class="notif-time">${n.time_ago} ago</span></td>
      <td>
        <div class="notif-actions-cell">
          <button class="btn btn-icon btn-neutral" title="Hide" onclick="hideNotification(${n.id})">
            <i class="fa-solid fa-eye-slash"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function updateStats() {
  const totalEl = document.getElementById('statTotal');
  if (totalEl) totalEl.textContent = panelTotal;
  // Use server-side aggregates (returned by API) for accurate full-dataset counts
  const s = window._panelNotifStats || {};
  const broadcastEl = document.getElementById('statBroadcast');
  const targetedEl = document.getElementById('statTargeted');
  const urgentEl = document.getElementById('statUrgent');
  if (broadcastEl) broadcastEl.textContent = s.broadcast != null ? s.broadcast : 0;
  if (targetedEl) targetedEl.textContent = s.targeted != null ? s.targeted : 0;
  if (urgentEl) urgentEl.textContent = s.urgent != null ? s.urgent : 0;
}

/* ============ Notifications Top Bar Actions ============ */
window.refreshNotificationsPanel = function () {
  loadNotifications(false);
  if (typeof loadMaintenanceStatus === 'function') loadMaintenanceStatus();
  if (typeof loadDomainNotFoundStatus === 'function') loadDomainNotFoundStatus();
};

/* ============ Domain Not Found Controls ============ */
function _updateDomainQuickBadges(enabled) {
  const text = enabled ? 'Domain Mode: On' : 'Domain Mode: Off';
  const quickBadge = document.getElementById('domainNotFoundQuickBadge');
  const modalBadge = document.getElementById('domainModeStatusText');
  const quickBtn = document.getElementById('domainQuickControlBtn');

  [quickBadge, modalBadge].forEach(function(el) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-active', !!enabled);
  });

  if (quickBtn) quickBtn.classList.toggle('is-active', !!enabled);
}

function _setDomainSyncText(message, tone) {
  const syncEl = document.getElementById('domainModeLastSyncText');
  if (!syncEl) return;
  syncEl.textContent = message || 'Status not synced yet.';
  syncEl.style.color = tone === 'error' ? '#b91c1c' : '#64748b';
}

function _setDomainEmailValidation(message) {
  const validationEl = document.getElementById('domainRecoveryValidation');
  if (!validationEl) return;
  if (!message) {
    validationEl.style.display = 'none';
    validationEl.textContent = '';
    return;
  }
  validationEl.textContent = message;
  validationEl.style.display = '';
}

function _setDomainControlAvailability() {
  const input = document.getElementById('domainRecoveryEmailInput');
  const sendBtn = document.getElementById('domainRecoverySendBtn');
  const toggleBtn = document.getElementById('domainModeToggleBtn');
  const refreshBtn = document.getElementById('domainModeRefreshBtn');
  const canUseEmailAction = _domainNotFoundEnabled && _domainCanSendProAccess;

  if (refreshBtn) {
    refreshBtn.disabled = !!_domainStatusLoading;
    refreshBtn.innerHTML = _domainStatusLoading
      ? '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing...'
      : '<i class="fa-solid fa-rotate"></i> Refresh';
  }

  if (toggleBtn) {
    toggleBtn.disabled = !!_domainStatusLoading || !!_domainToggleBusy;
  }

  if (input) {
    input.disabled = !canUseEmailAction || !!_domainStatusLoading || !!_domainEmailBusy;
    input.placeholder = _domainCanSendProAccess
      ? 'Enter account email'
      : 'Pro User permission required';
  }

  if (sendBtn) {
    sendBtn.disabled = !canUseEmailAction || !!_domainStatusLoading || !!_domainEmailBusy;
    sendBtn.title = _domainCanSendProAccess
      ? (_domainNotFoundEnabled ? '' : 'Enable Domain Not Found mode first')
      : 'Pro User permission required';
    sendBtn.innerHTML = _domainEmailBusy
      ? '<i class="fa-solid fa-spinner fa-spin"></i> Sending...'
      : '<i class="fa-solid fa-paper-plane"></i> Send Emergency Email';
  }
}

function _isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function _updateDomainNotFoundUi(status) {
  const hasWebsiteMode = status && Object.prototype.hasOwnProperty.call(status, 'website_not_found_mode');
  const enabled = !!(hasWebsiteMode ? status.website_not_found_mode : status && status.enabled);
  _domainNotFoundEnabled = enabled;

  if (status && Object.prototype.hasOwnProperty.call(status, 'can_send_pro_access_link')) {
    _domainCanSendProAccess = !!status.can_send_pro_access_link;
  }

  _updateDomainQuickBadges(enabled);

  const websiteStatusRaw = ((status && (status.website_status || status.status)) || '').toString().toLowerCase();
  const websiteStatusText = websiteStatusRaw ? capitalize(websiteStatusRaw) : 'Unknown';
  const websiteStatusEl = document.getElementById('websiteStatusText');
  if (websiteStatusEl) {
    const iconCls = websiteStatusRaw === 'live' ? 'fa-globe' : 'fa-eye-slash';
    websiteStatusEl.innerHTML = '<i class="fa-solid ' + iconCls + '"></i> Website status: ' + escHtml(websiteStatusText);
  }

  const toggleBtn = document.getElementById('domainModeToggleBtn');
  if (toggleBtn) {
    toggleBtn.classList.toggle('btn-danger', !enabled);
    toggleBtn.classList.toggle('btn-success', enabled);
    toggleBtn.innerHTML = enabled
      ? '<i class="fa-solid fa-power-off"></i> Disable Not Found Mode'
      : '<i class="fa-solid fa-triangle-exclamation"></i> Enable Not Found Mode';
  }

  const input = document.getElementById('domainRecoveryEmailInput');
  const helpText = document.getElementById('domainRecoveryHelpText');
  const proNote = document.getElementById('domainProOnlyNote');
  _setDomainControlAvailability();
  if (helpText) {
    helpText.textContent = enabled
      ? 'Send a tokenized emergency panel access link while Domain Not Found mode is active.'
      : 'Enable Domain Not Found mode first, then send emergency access link email.';
  }
  if (proNote) {
    proNote.style.display = _domainCanSendProAccess ? 'none' : '';
  }
}

window.loadDomainNotFoundStatus = async function () {
  const statusUrl = window.WEBSITE_STATUS_SUMMARY_API_URL || '';
  if (!statusUrl) return;

  _domainStatusLoading = true;
  _setDomainControlAvailability();

  try {
    const res = await fetch(statusUrl, { method: 'GET', credentials: 'same-origin' });
    if (!res.ok) {
      if (res.status === 403) {
        _domainCanSendProAccess = false;
        _updateDomainNotFoundUi({ website_not_found_mode: false, website_status: 'unknown', can_send_pro_access_link: false });
        _setDomainSyncText('Permission denied while syncing domain mode.', 'error');
      } else {
        _setDomainSyncText('Unable to sync status right now.', 'error');
      }
      return;
    }
    const data = await res.json();
    if (data && data.success !== false) {
      _updateDomainNotFoundUi(data);
      _setDomainSyncText('Last synced: ' + new Date().toLocaleTimeString());
    }
  } catch (err) {
    console.error('loadDomainNotFoundStatus failed:', err);
    _setDomainSyncText('Network issue while syncing status.', 'error');
  } finally {
    _domainStatusLoading = false;
    _setDomainControlAvailability();
  }
};

window.openDomainNotFoundModal = function () {
  const modal = document.getElementById('domainNotFoundModal');
  if (!modal) return;
  _setDomainEmailValidation('');
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
    window.AdarshModalBridge.open('domainNotFoundModal', { overlayClass: 'show', focusSelector: '#domainRecoveryEmailInput' });
  } else {
    modal.style.display = 'flex';
    modal.classList.add('show');
  }
  if (typeof loadDomainNotFoundStatus === 'function') loadDomainNotFoundStatus();
};

window.closeDomainNotFoundModal = function () {
  const modal = document.getElementById('domainNotFoundModal');
  if (!modal) return;
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
    window.AdarshModalBridge.close('domainNotFoundModal', { overlayClass: 'show' });
  } else {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
};

window.toggleDomainNotFoundMode = async function () {
  const apiUrl = window.WEBSITE_NOT_FOUND_TOGGLE_API_URL || '';
  if (!apiUrl) return;

  const nextEnabled = !_domainNotFoundEnabled;
  const confirmTitle = nextEnabled ? 'Enable Domain Not Found Mode?' : 'Disable Domain Not Found Mode?';
  const confirmText = nextEnabled
    ? 'Public website routes will return 404 until this mode is disabled.'
    : 'Public website routes will become reachable again.';

  let ok = true;
  if (typeof window.waConfirm === 'function') {
    ok = await window.waConfirm({
      title: confirmTitle,
      text: confirmText,
      icon: 'fa-solid fa-triangle-exclamation',
      confirmLabel: nextEnabled ? 'Enable' : 'Disable',
      btnClass: nextEnabled ? 'btn-danger' : 'btn-success',
      hideWarning: true,
    });
  }
  if (!ok) return;

  const toggleBtn = document.getElementById('domainModeToggleBtn');
  _domainToggleBusy = true;
  _setDomainControlAvailability();

  if (toggleBtn) toggleBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-CSRFToken': getCSRFToken(),
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ enabled: String(nextEnabled) }),
    });
    const data = await res.json();

    if (res.ok && data && data.success) {
      if (typeof showToast === 'function') {
        showToast(nextEnabled ? 'Domain Not Found mode enabled.' : 'Domain Not Found mode disabled.', 'success');
      }
      await loadDomainNotFoundStatus();
      return;
    }

    if (typeof showToast === 'function') {
      showToast((data && data.message) || 'Failed to update domain mode.', 'error');
    }
  } catch (err) {
    console.error('toggleDomainNotFoundMode failed:', err);
    if (typeof showToast === 'function') showToast('Network error while updating domain mode.', 'error');
  } finally {
    _domainToggleBusy = false;
    _setDomainControlAvailability();
    if (typeof loadDomainNotFoundStatus === 'function') loadDomainNotFoundStatus();
  }
};

window.sendDomainRecoveryAccessLink = async function () {
  const apiUrl = window.WEBSITE_PRO_ACCESS_API_URL || '';
  if (!apiUrl) return;

  if (!_domainNotFoundEnabled) {
    if (typeof showToast === 'function') showToast('Enable Domain Not Found mode first.', 'error');
    return;
  }
  if (!_domainCanSendProAccess) {
    if (typeof showToast === 'function') showToast('Pro User permission required for emergency access emails.', 'error');
    return;
  }

  const input = document.getElementById('domainRecoveryEmailInput');
  const email = (input && input.value ? input.value : '').trim();
  _setDomainEmailValidation('');

  if (!email) {
    if (typeof showToast === 'function') showToast('Please enter an email address.', 'error');
    _setDomainEmailValidation('Please enter a valid email address.');
    if (input) input.focus();
    return;
  }

  if (!_isValidEmailAddress(email)) {
    if (typeof showToast === 'function') showToast('Enter a valid email address format.', 'error');
    _setDomainEmailValidation('Email format looks invalid. Example: name@example.com');
    if (input) input.focus();
    return;
  }

  _domainEmailBusy = true;
  _setDomainControlAvailability();

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-CSRFToken': getCSRFToken(),
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ email: email }),
    });
    const data = await res.json();

    if (res.ok && data && data.success) {
      if (typeof showToast === 'function') showToast(data.message || 'Access link sent.', 'success');
      if (input) input.value = '';
      return;
    }

    if (typeof showToast === 'function') {
      showToast((data && data.message) || 'Failed to send access link.', 'error');
    }
  } catch (err) {
    console.error('sendDomainRecoveryAccessLink failed:', err);
    if (typeof showToast === 'function') showToast('Network error while sending access link.', 'error');
  } finally {
    _domainEmailBusy = false;
    _setDomainControlAvailability();
  }
};

/* ============ Maintenance Quick Controls ============ */
function _updateMaintenanceQuickUi(status) {
  const badge = document.getElementById('mtQuickStatusBadge');
  const toggleBtn = document.getElementById('mtQuickToggleBtn');
  if (!badge || !toggleBtn) return;

  const enabled = !!(status && status.enabled);
  _maintenanceEnabled = enabled;

  badge.textContent = enabled ? 'Maintenance: Active' : 'Maintenance: Inactive';
  badge.classList.toggle('is-active', enabled);

  if (enabled) {
    toggleBtn.classList.remove('btn-danger');
    toggleBtn.classList.add('btn-success');
    toggleBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Disable Maintenance';
    toggleBtn.setAttribute('onclick', "toggleMaintenance('disable')");
  } else {
    toggleBtn.classList.remove('btn-success');
    toggleBtn.classList.add('btn-danger');
    toggleBtn.innerHTML = '<i class="fa-solid fa-power-off"></i> Enable Maintenance';
    toggleBtn.setAttribute('onclick', 'openMaintenanceModeModal()');
  }
}

window.setMtDuration = function (min) {
  const hidden = document.getElementById('mtDuration');
  if (hidden) hidden.value = String(min);
  document.querySelectorAll('.mt-dur-btn').forEach(function (btn) {
    const isActive = parseInt(btn.dataset.min || '0', 10) === parseInt(min, 10);
    btn.classList.toggle('btn-primary', isActive);
    btn.classList.toggle('btn-neutral', !isActive);
  });
};

window.openMaintenanceModeModal = function () {
  const modal = document.getElementById('maintenanceModeModal');
  if (!modal) return;
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
    window.AdarshModalBridge.open('maintenanceModeModal', { overlayClass: 'show', focusSelector: '#mtModalMessage' });
  } else {
    modal.style.display = 'flex';
    modal.classList.add('show');
  }
};

window.closeMaintenanceModeModal = function () {
  const modal = document.getElementById('maintenanceModeModal');
  if (!modal) return;
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
    window.AdarshModalBridge.close('maintenanceModeModal', { overlayClass: 'show' });
  } else {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
};

window.submitMaintenanceModeModal = function () {
  window.toggleMaintenance('enable');
};

window.toggleMaintenance = async function (action) {
  const apiUrl = window.MAINTENANCE_TOGGLE_API_URL || '';
  if (!apiUrl) return;

  const submitBtn = document.getElementById('mtModalSubmitBtn');
  if (action === 'enable' && submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enabling...';
  }

  try {
    const body = { action: action };
    if (action === 'enable') {
      const duration = parseInt(document.getElementById('mtDuration')?.value || '60', 10);
      const message = (document.getElementById('mtModalMessage')?.value || '').trim();
      body.duration_minutes = Number.isFinite(duration) && duration > 0 ? duration : 60;
      body.message = message;
    }

    const res = await fetch(apiUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken(),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data && data.success) {
      _updateMaintenanceQuickUi(data.status || { enabled: action === 'enable' });
      if (action === 'enable') closeMaintenanceModeModal();
      if (typeof showToast === 'function') showToast(data.message || 'Maintenance status updated.', 'success');
    } else if (typeof showToast === 'function') {
      showToast((data && data.message) || 'Failed to update maintenance mode.', 'error');
    }
  } catch (err) {
    console.error('toggleMaintenance failed:', err);
    if (typeof showToast === 'function') showToast('Network error while updating maintenance mode.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-power-off"></i> Enable Maintenance';
    }
  }
};

window.loadMaintenanceStatus = async function () {
  const statusUrl = window.MAINTENANCE_STATUS_API_URL || '';
  const badge = document.getElementById('mtQuickStatusBadge');
  if (!statusUrl || !badge) return;

  try {
    const res = await fetch(statusUrl, { method: 'GET', credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    _updateMaintenanceQuickUi(data || { enabled: false });
  } catch (err) {
    console.error('loadMaintenanceStatus failed:', err);
  }
};

/* ============ Search ============ */
function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadNotifications(1), 350);
}

/* ============ Delete ============ */
let _panelConfirmCallback = null;

function _panelConfirm(title, message, onConfirm, options) {
  const modal = document.getElementById('panelDeleteConfirmModal');
  const titleEl = document.getElementById('panelConfirmTitleText');
  const msgEl = document.getElementById('panelConfirmMessage');
  const okBtn = document.getElementById('panelConfirmOkBtn');
  if (!modal) { if (onConfirm) onConfirm(); return; }
  const warningItems = modal.querySelectorAll('.alert-box-list li');
  const defaultWarnings = [
    'This action cannot be undone',
    'The item will be permanently removed',
  ];
  const lines = (options && Array.isArray(options.warningLines) && options.warningLines.length)
    ? options.warningLines
    : defaultWarnings;

  warningItems.forEach(function (item, idx) {
    const text = lines[idx] || defaultWarnings[idx] || '';
    item.textContent = text;
    item.style.display = text ? '' : 'none';
  });

  titleEl.textContent = title;
  msgEl.textContent = message;
  _panelConfirmCallback = onConfirm;
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
    window.AdarshModalBridge.open('panelDeleteConfirmModal', { overlayClass: 'show', focusSelector: '#panelConfirmOkBtn' });
  } else {
    modal.style.display = 'flex';
    okBtn.focus();
  }
}

window.closePanelConfirmModal = function () {
  const modal = document.getElementById('panelDeleteConfirmModal');
  if (modal) {
    if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
      window.AdarshModalBridge.close('panelDeleteConfirmModal', { overlayClass: 'show' });
    } else {
      modal.style.display = 'none';
    }
  }
  _panelConfirmCallback = null;
};

document.addEventListener('DOMContentLoaded', function () {
  const okBtn = document.getElementById('panelConfirmOkBtn');
  if (okBtn) {
    okBtn.addEventListener('click', function () {
      const cb = _panelConfirmCallback;
      closePanelConfirmModal();
      if (typeof cb === 'function') cb();
    });
  }
  // Close on overlay click
  const modal = document.getElementById('panelDeleteConfirmModal');
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closePanelConfirmModal();
    });
  }
  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      const m = document.getElementById('panelDeleteConfirmModal');
      if (m && (m.classList.contains('show') || m.style.display !== 'none')) closePanelConfirmModal();
    }
  });

  const maintenanceModal = document.getElementById('maintenanceModeModal');
  if (maintenanceModal) {
    maintenanceModal.addEventListener('click', function (e) {
      if (e.target === maintenanceModal) closeMaintenanceModeModal();
    });
    window.setMtDuration(parseInt(document.getElementById('mtDuration')?.value || '60', 10));
  }

  const domainModal = document.getElementById('domainNotFoundModal');
  if (domainModal) {
    domainModal.addEventListener('click', function (e) {
      if (e.target === domainModal) closeDomainNotFoundModal();
    });

    const domainInput = document.getElementById('domainRecoveryEmailInput');
    if (domainInput) {
      domainInput.addEventListener('input', function () {
        _setDomainEmailValidation('');
      });
      domainInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendDomainRecoveryAccessLink();
        }
      });
    }
  }
});

async function hideNotification(id) {
  _panelConfirm(
    'Hide Notification',
    'Hide this notification? It will no longer be visible to users.',
    async function () {
      try {
        const res = await fetch(`/api/notifications/admin/${id}/delete/`, {
          method: 'DELETE',
          headers: { 'X-CSRFToken': getCSRFToken() },
        });
        if (!res.ok) { if (window.showToast) showToast('Hide failed (HTTP ' + res.status + ')', 'error'); return; }
        const data = await res.json();
        if (data.success) {
          if (window.showToast) showToast(data.message || 'Notification hidden', 'success');
          loadNotifications(false);
        } else {
          if (window.showToast) showToast(data.message || 'Failed', 'error');
        }
      } catch (err) {
        console.error('Hide failed:', err);
      }
    },
    {
      warningLines: [
        'Users will no longer see this notification',
        'Read history will be kept for audit',
      ],
    }
  );
}

async function deleteNotification(id) {
  // Backward-compatible alias for older inline handlers.
  return hideNotification(id);
}

/* ============ Create Modal ============ */
function setCreateNotifStep(step) {
  _createNotifStep = step === 2 ? 2 : 1;
  const isAudienceStep = _createNotifStep === 2;

  const step1Panel = document.getElementById('createNotifStep1Panel');
  const step2Panel = document.getElementById('createNotifStep2Panel');
  const step1Badge = document.getElementById('createNotifStep1Badge');
  const step2Badge = document.getElementById('createNotifStep2Badge');
  const backBtn = document.getElementById('createNotifBackBtn');
  const actionBtn = document.getElementById('createNotifBtn');

  if (step1Panel) step1Panel.style.display = isAudienceStep ? 'none' : 'block';
  if (step2Panel) step2Panel.style.display = isAudienceStep ? 'block' : 'none';
  if (step1Badge) step1Badge.classList.add('is-active');
  if (step2Badge) step2Badge.classList.toggle('is-active', isAudienceStep);
  if (backBtn) backBtn.style.display = isAudienceStep ? 'inline-flex' : 'none';

  if (actionBtn) {
    actionBtn.dataset.mode = isAudienceStep ? 'submit' : 'next';
    actionBtn.innerHTML = isAudienceStep
      ? '<i class="fa-solid fa-paper-plane"></i> Send Notification'
      : 'Next <i class="fa-solid fa-arrow-right"></i>';
  }
}

function _bindCreateNotifWizardControls() {
  const actionBtn = document.getElementById('createNotifBtn');
  const backBtn = document.getElementById('createNotifBackBtn');

  if (actionBtn && !actionBtn.dataset.wizardBound) {
    actionBtn.dataset.wizardBound = '1';
    actionBtn.addEventListener('click', function () {
      if ((actionBtn.dataset.mode || 'next') === 'next') {
        const title = document.getElementById('notifTitle')?.value.trim() || '';
        const message = document.getElementById('notifMessage')?.value.trim() || '';
        if (!title || !message) {
          if (window.showToast) showToast('Add title and message before continuing.', 'error');
          if (!title) {
            document.getElementById('notifTitle')?.focus();
          } else {
            document.getElementById('notifMessage')?.focus();
          }
          return;
        }
        setCreateNotifStep(2);
        return;
      }

      const form = document.getElementById('createNotifForm');
      if (form) form.requestSubmit();
    });
  }

  if (backBtn && !backBtn.dataset.wizardBound) {
    backBtn.dataset.wizardBound = '1';
    backBtn.addEventListener('click', function () {
      setCreateNotifStep(1);
    });
  }
}

function openCreateModal() {
  _bindCreateNotifWizardControls();
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
    window.AdarshModalBridge.open('createNotifModal', { overlayClass: 'show' });
  } else {
    document.getElementById('createNotifModal').classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  document.getElementById('createNotifForm').reset();
  document.getElementById('userPickerWrap').style.display = 'none';
  const visibilityInput = document.getElementById('notifVisibilityHours');
  if (visibilityInput) visibilityInput.value = '24';
  selectedUserIds.clear();
  renderSelectedChips();
  setCreateNotifStep(1);
}

function closeCreateModal() {
  setCreateNotifStep(1);
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
    window.AdarshModalBridge.close('createNotifModal', { overlayClass: 'show' });
  } else {
    document.getElementById('createNotifModal').classList.remove('show');
    document.body.style.overflow = '';
  }
}

/* Escape key */
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  closeCreateModal();
  if (typeof closeMaintenanceModeModal === 'function') closeMaintenanceModeModal();
  if (typeof closeDomainNotFoundModal === 'function') closeDomainNotFoundModal();
});

/* ============ Target Change ============ */
function handleTargetChange() {
  const target = document.getElementById('notifTarget').value;
  const wrap = document.getElementById('userPickerWrap');
  if (target === 'selected') {
    wrap.style.display = 'block';
    loadTargetUsers();
  } else {
    wrap.style.display = 'none';
  }
}

/* ============ Load Target Users ============ */
async function loadTargetUsers() {
  if (Object.keys(allUsers).length > 0) {
    renderUserPicker();
    return;
  }

  var list = document.getElementById('userPickerList');
  var skeletonStart = null;
  if (list) {
    list.innerHTML = `
      <div class="user-picker-skeleton" aria-hidden="true">
        ${Array.from({ length: 4 }).map(() => `
          <div class="user-picker-skeleton-row">
            <span class="user-picker-skeleton-block user-picker-skeleton-check"></span>
            <span class="user-picker-skeleton-block user-picker-skeleton-name"></span>
            <span class="user-picker-skeleton-block user-picker-skeleton-role"></span>
          </div>
        `).join('')}
      </div>
      <span class="sr-only">Loading users...</span>
    `;
    skeletonStart = Date.now();
  }

  try {
    const res = await fetch('/api/notifications/admin/target-users/');
    if (!res.ok) {
      console.error('Failed to load users: HTTP', res.status);
      if (list) {
        if (skeletonStart != null) await waitForMinDelay(skeletonStart);
        list.innerHTML = '<div class="user-picker-empty">Failed to load users</div>';
      }
      return;
    }
    const data = await res.json();
    if (data.success) {
      allUsers = data.users;
      if (skeletonStart != null) await waitForMinDelay(skeletonStart);
      renderUserPicker();
    } else if (list) {
      if (skeletonStart != null) await waitForMinDelay(skeletonStart);
      list.innerHTML = '<div class="user-picker-empty">Failed to load users</div>';
    }
  } catch (err) {
    console.error('Failed to load users:', err);
    if (list) {
      if (skeletonStart != null) await waitForMinDelay(skeletonStart);
      list.innerHTML = '<div class="user-picker-empty">Network error loading users</div>';
    }
  }
}

function renderUserPicker(filter) {
  const list = document.getElementById('userPickerList');
  const filterLower = (filter || '').toLowerCase();
  let html = '';

  const roleLabels = {
    pro_user: 'Pro User',
    super_admin: 'Super Admin',
    admin_staff: 'Operator',
    client: 'Client',
    client_staff: 'Assistent',
  };

  for (const [role, users] of Object.entries(allUsers)) {
    const filtered = filterLower
      ? users.filter(u => u.name.toLowerCase().includes(filterLower) || u.username.toLowerCase().includes(filterLower))
      : users;

    if (!filtered.length) continue;

    html += `<div style="padding:4px 12px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-top:4px;">
      ${roleLabels[role] || role} (${filtered.length})
    </div>`;

    for (const u of filtered) {
      const checked = selectedUserIds.has(u.id) ? 'checked' : '';
      const selClass = selectedUserIds.has(u.id) ? ' selected' : '';
      html += `<label class="user-picker-item${selClass}">
        <input type="checkbox" ${checked} onchange="toggleUser(${u.id}, '${escAttr(u.name)}', this.checked)">
        <span class="upi-name">${escHtml(u.name)}</span>
        <span class="upi-role">${escHtml(u.role_display)}</span>
      </label>`;
    }
  }

  list.innerHTML = html || '<div class="user-picker-empty">No users found</div>';
}

function filterUserPicker(val) {
  renderUserPicker(val);
}

function toggleUser(id, name, checked) {
  if (checked) {
    selectedUserIds.add(id);
  } else {
    selectedUserIds.delete(id);
  }
  renderSelectedChips();
}

function removeUser(id) {
  selectedUserIds.delete(id);
  renderSelectedChips();
  renderUserPicker(document.querySelector('.user-picker-search input')?.value);
}

function renderSelectedChips() {
  const el = document.getElementById('userPickerSelected');
  if (!selectedUserIds.size) {
    el.innerHTML = '';
    return;
  }
  // Find names from allUsers
  const nameMap = {};
  for (const users of Object.values(allUsers)) {
    for (const u of users) nameMap[u.id] = u.name;
  }
  el.innerHTML = Array.from(selectedUserIds).map(id => {
    const name = nameMap[id] || `User #${id}`;
    return `<span class="user-picker-chip">${escHtml(name)}<button type="button" onclick="removeUser(${id})">&times;</button></span>`;
  }).join('');
}

/* ============ Submit Create ============ */
async function handleCreateNotif(e) {
  e.preventDefault();
  if (_createNotifStep !== 2) {
    return false;
  }
  const btn = document.getElementById('createNotifBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

  const payload = {
    title: document.getElementById('notifTitle').value.trim(),
    message: document.getElementById('notifMessage').value.trim(),
    category: document.getElementById('notifCategory').value,
    priority: document.getElementById('notifPriority').value,
    target: document.getElementById('notifTarget').value,
    send_email: document.getElementById('notifSendEmail').checked,
  };

  const visibilityHoursRaw = Number(document.getElementById('notifVisibilityHours')?.value || 24);
  payload.visibility_hours = Number.isFinite(visibilityHoursRaw)
    ? Math.max(24, Math.min(Math.trunc(visibilityHoursRaw), 8760))
    : 24;

  if (payload.target === 'selected') {
    payload.target_user_ids = Array.from(selectedUserIds);
    if (!payload.target_user_ids.length) {
      if (window.showToast) showToast('Select at least one user.', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Notification';
      return false;
    }
  }

  try {
    const res = await fetch('/api/notifications/admin/create/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken(),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok && !(res.headers.get('content-type') || '').includes('application/json')) {
      if (window.showToast) showToast('Server error (' + res.status + '). Please try again.', 'error');
      return false;
    }
    const data = await res.json();
    if (data.success) {
      if (window.showToast) showToast(data.message || 'Notification sent!', 'success');
      closeCreateModal();
      loadNotifications(false);
    } else {
      if (window.showToast) showToast(data.message || 'Failed to create notification.', 'error');
    }
  } catch (err) {
    console.error('Create failed:', err);
    if (window.showToast) showToast('Network error.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = _createNotifStep === 2
      ? '<i class="fa-solid fa-paper-plane"></i> Send Notification'
      : 'Next <i class="fa-solid fa-arrow-right"></i>';
  }
  return false;
}

/* ============ Helpers ============ */
// Read CSRF token directly from cookie / meta / hidden input
function getCSRFToken() {
  const cookie = document.cookie.split(';').find(c => c.trim().startsWith('csrftoken='));
  if (cookie) return cookie.split('=')[1];
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta) return meta.getAttribute('content');
  const hidden = document.querySelector('input[name="csrfmiddlewaretoken"]');
  if (hidden) return hidden.value;
  return '';
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function waitForPanelSkeletonDelay(startTs) {
  if (startTs == null) return Promise.resolve();
  if (typeof waitForMinDelay === 'function') {
    return waitForMinDelay(startTs);
  }
  return Promise.resolve();
}

function setPanelTableSkeleton(tbodyId, options) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return null;

  const cfg = options || {};
  const colCount = Math.max(1, Number(cfg.colCount || 1));
  const rows = Math.max(2, Number(cfg.rows || 3));
  const columns = Array.isArray(cfg.columns) && cfg.columns.length
    ? cfg.columns.slice(0, colCount)
    : Array.from({ length: colCount }, function () { return '1fr'; });
  const gridTemplate = columns.join(' ');

  const rowHtml = Array.from({ length: rows }, function () {
    return '<div class="panel-table-skeleton-row" style="grid-template-columns:' + gridTemplate + ';">' +
      columns.map(function () {
        return '<span class="panel-table-skeleton-block"></span>';
      }).join('') +
      '</div>';
  }).join('');

  const ariaLabel = String(cfg.ariaLabel || 'Loading data...');
  tbody.innerHTML =
    '<tr><td colspan="' + colCount + '" class="notif-table-empty-cell">' +
      '<div class="panel-table-skeleton" role="status" aria-label="' + escAttr(ariaLabel) + '">' + rowHtml + '</div>' +
    '</td></tr>';

  return Date.now();
}

function setPanelTableError(tbodyId, colCount, iconClass, title, subtitle) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const cols = Math.max(1, Number(colCount || 1));
  tbody.innerHTML =
    '<tr class="notif-table-empty"><td colspan="' + cols + '">' +
      '<div class="empty-state">' +
        '<i class="fa-solid ' + escAttr(iconClass || 'fa-circle-exclamation') + '"></i>' +
        '<p>' + escHtml(title || 'Unable to load data') + '</p>' +
        '<span>' + escHtml(subtitle || 'Please try again.') + '</span>' +
      '</div>' +
    '</td></tr>';
}


/* ================================================================
   DOWNLOAD TEMPLATES TAB
   ================================================================ */
let panelTemplates = [];
let panelTemplateFiltered = [];
let _templateBoldState = false;
let _templateSearchText = '';
let _templatePage = 1;
let _templatePerPage = 25;
let _templatePagerBound = false;

function _setTemplateRowsDropdownValue(value) {
  const rowsText = document.getElementById('templateRowsSelectedText');
  const rowsOptions = document.getElementById('templateRowsOptions');
  if (rowsText) rowsText.textContent = String(value);
  if (!rowsOptions) return;

  rowsOptions.querySelectorAll('.dropdown-option').forEach(function (opt) {
    opt.classList.toggle('selected', Number(opt.dataset.value) === Number(value));
  });
}

function _bindTemplatePaginationControls() {
  if (_templatePagerBound) return;
  _templatePagerBound = true;

  const firstBtn = document.getElementById('templateFirstPage');
  const prevBtn = document.getElementById('templatePrevPage');
  const nextBtn = document.getElementById('templateNextPage');
  const lastBtn = document.getElementById('templateLastPage');
  const pageNums = document.getElementById('templatePageNumbers');
  const rowsDropdown = document.getElementById('templateRowsDropdown');
  const rowsToggle = document.getElementById('templateRowsToggle');
  const rowsOptions = document.getElementById('templateRowsOptions');

  if (firstBtn) firstBtn.addEventListener('click', function () { templateGoPage(1); });
  if (prevBtn) prevBtn.addEventListener('click', function () { templateGoPage(_templatePage - 1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { templateGoPage(_templatePage + 1); });
  if (lastBtn) {
    lastBtn.addEventListener('click', function () {
      const totalPages = Math.max(1, Math.ceil(panelTemplateFiltered.length / _templatePerPage));
      templateGoPage(totalPages);
    });
  }

  if (pageNums) {
    pageNums.addEventListener('click', function (event) {
      const btn = event.target.closest('.page-num');
      if (!btn) return;
      const page = parseInt(btn.dataset.page || '', 10);
      if (!Number.isFinite(page)) return;
      templateGoPage(page);
    });
  }

  if (rowsDropdown && rowsToggle && rowsOptions) {
    rowsToggle.addEventListener('click', function (event) {
      event.stopPropagation();
      rowsDropdown.classList.toggle('open');
    });

    rowsOptions.querySelectorAll('.dropdown-option').forEach(function (option) {
      option.addEventListener('click', function () {
        const value = parseInt(this.dataset.value || '', 10);
        if (!Number.isFinite(value) || value <= 0) return;
        _templatePerPage = value;
        _templatePage = 1;
        _setTemplateRowsDropdownValue(_templatePerPage);
        rowsDropdown.classList.remove('open');
        renderTemplateTable();
      });
    });

    document.addEventListener('click', function (event) {
      if (!rowsDropdown.contains(event.target)) {
        rowsDropdown.classList.remove('open');
      }
    });
  }

  _setTemplateRowsDropdownValue(_templatePerPage);
}

function _renderTemplatePagination(totalRows) {
  const wrapper = document.getElementById('templatePaginationWrap');
  const info = document.getElementById('templatePaginationInfo');
  const pageNumbers = document.getElementById('templatePageNumbers');
  const firstBtn = document.getElementById('templateFirstPage');
  const prevBtn = document.getElementById('templatePrevPage');
  const nextBtn = document.getElementById('templateNextPage');
  const lastBtn = document.getElementById('templateLastPage');

  if (!wrapper || !info || !pageNumbers) return;

  if (totalRows <= 0) {
    wrapper.style.display = 'none';
    return;
  }

  wrapper.style.display = '';

  const totalPages = Math.max(1, Math.ceil(totalRows / _templatePerPage));
  if (_templatePage > totalPages) _templatePage = totalPages;
  if (_templatePage < 1) _templatePage = 1;

  const startIndex = (_templatePage - 1) * _templatePerPage;
  const endIndex = Math.min(startIndex + _templatePerPage, totalRows);
  info.innerHTML = 'Showing <strong>' + (startIndex + 1) + '-' + endIndex + '</strong> of <strong>' + totalRows + '</strong> results';

  pageNumbers.innerHTML = '';
  const maxVisiblePages = 5;
  let startPage = Math.max(1, _templatePage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  if ((endPage - startPage + 1) < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  for (let i = startPage; i <= endPage; i += 1) {
    pageNumbers.insertAdjacentHTML(
      'beforeend',
      '<button class="page-num' + (i === _templatePage ? ' active' : '') + '" data-page="' + i + '">' + i + '</button>'
    );
  }

  if (firstBtn) firstBtn.disabled = _templatePage <= 1;
  if (prevBtn) prevBtn.disabled = _templatePage <= 1;
  if (nextBtn) nextBtn.disabled = _templatePage >= totalPages;
  if (lastBtn) lastBtn.disabled = _templatePage >= totalPages;
}

function _filterTemplates() {
  const q = String(_templateSearchText || '').trim().toLowerCase();
  if (!q) {
    panelTemplateFiltered = panelTemplates.slice();
    return panelTemplateFiltered;
  }

  panelTemplateFiltered = panelTemplates.filter(function (tpl) {
    const fontLabel = tpl.font_name === 'hindi' ? 'hindi abbasi' : 'english arial';
    const haystack = [tpl.name, tpl.instructions_plain || '', fontLabel, tpl.is_default ? 'default' : '', tpl.is_bold ? 'bold' : '']
      .join(' ')
      .toLowerCase();
    return haystack.indexOf(q) !== -1;
  });
  return panelTemplateFiltered;
}

function templateSetSearch(value) {
  _templateSearchText = value || '';
  _templatePage = 1;
  renderTemplateTable();
}

function templateGoPage(page) {
  const totalPages = Math.max(1, Math.ceil(panelTemplateFiltered.length / _templatePerPage));
  _templatePage = Number(page || 1);
  if (!Number.isFinite(_templatePage)) _templatePage = 1;
  if (_templatePage < 1) _templatePage = 1;
  if (_templatePage > totalPages) _templatePage = totalPages;
  renderTemplateTable();
}

function _templateHtmlToPlainText(value) {
  const raw = String(value || '');
  if (!raw) return '';

  const holder = document.createElement('div');
  holder.innerHTML = raw;
  return String(holder.textContent || holder.innerText || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _templateLooksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ''));
}

function _templatePlainTextToHtml(value) {
  const text = String(value || '');
  if (!text.trim()) return '<p><br></p>';
  const lines = text.split(/\r?\n/);
  return lines
    .map(function (line) {
      const content = escHtml(line);
      return '<p>' + (content || '<br>') + '</p>';
    })
    .join('');
}

function _sanitizeTemplateInlineStyle(styleValue) {
  const style = String(styleValue || '');
  if (!style) return '';

  const allowedProps = {
    'font-weight': true,
    'font-style': true,
    'text-decoration': true,
    'text-align': true,
    'font-size': true,
    'font-family': true,
    'color': true,
  };

  const cleaned = [];
  style.split(';').forEach(function (chunk) {
    const pair = chunk.split(':');
    if (pair.length < 2) return;
    const prop = String(pair[0] || '').trim().toLowerCase();
    const value = String(pair.slice(1).join(':') || '').trim();
    if (!allowedProps[prop]) return;
    if (/expression\s*\(|url\s*\(\s*javascript:/i.test(value)) return;
    cleaned.push(prop + ':' + value);
  });

  return cleaned.join(';');
}

function _sanitizeTemplateHtml(rawHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString('<div>' + String(rawHtml || '') + '</div>', 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';

  const allowedTags = {
    p: true,
    br: true,
    strong: true,
    b: true,
    em: true,
    i: true,
    u: true,
    span: true,
    div: true,
    ul: true,
    ol: true,
    li: true,
    a: true,
    img: true,
    h1: true,
    h2: true,
    h3: true,
    h4: true,
    h5: true,
    h6: true,
    table: true,
    thead: true,
    tbody: true,
    tr: true,
    th: true,
    td: true,
    blockquote: true,
  };

  root.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,textarea,select').forEach(function (el) {
    el.remove();
  });

  Array.from(root.querySelectorAll('*')).forEach(function (el) {
    const tag = String(el.tagName || '').toLowerCase();
    if (!allowedTags[tag]) {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      return;
    }

    Array.from(el.attributes).forEach(function (attr) {
      const name = String(attr.name || '').toLowerCase();
      const value = String(attr.value || '');

      if (name.indexOf('on') === 0) {
        el.removeAttribute(attr.name);
        return;
      }

      if (name === 'style') {
        const cleanStyle = _sanitizeTemplateInlineStyle(value);
        if (cleanStyle) {
          el.setAttribute('style', cleanStyle);
        } else {
          el.removeAttribute(attr.name);
        }
        return;
      }

      if (name === 'href') {
        if (!/^\s*(https?:|mailto:|#|\/)/i.test(value)) {
          el.removeAttribute(attr.name);
        }
        return;
      }

      if (name === 'src') {
        if (tag === 'img') {
          if (!/^\s*(data:image\/|https?:|\/media\/|\/static\/)/i.test(value)) {
            el.removeAttribute(attr.name);
          }
        } else {
          el.removeAttribute(attr.name);
        }
        return;
      }

      if (tag === 'img' && (name === 'alt' || name === 'title')) return;
      if (tag === 'a' && (name === 'target' || name === 'rel' || name === 'title')) return;

      el.removeAttribute(attr.name);
    });

    if (tag === 'a') {
      if (!el.getAttribute('rel')) el.setAttribute('rel', 'noopener noreferrer');
      if (!el.getAttribute('target')) el.setAttribute('target', '_blank');
    }
  });

  return root.innerHTML.trim();
}

function _setTemplateEditorHtml(value) {
  const editor = document.getElementById('templateInstructionsEditor');
  const hiddenInput = document.getElementById('templateInstructions');
  if (!editor || !hiddenInput) return;

  const raw = String(value || '');
  const html = _templateLooksLikeHtml(raw)
    ? _sanitizeTemplateHtml(raw)
    : _templatePlainTextToHtml(raw);

  editor.innerHTML = html || '<p><br></p>';
  hiddenInput.value = html || '';
  _templateBoldState = /<(strong|b)\b/i.test(editor.innerHTML);
  _syncTemplatePreviewFont();
  _syncTemplateBoldBtn();
}

function _getTemplateEditorHtml() {
  const editor = document.getElementById('templateInstructionsEditor');
  if (!editor) return '';
  const rawHtml = editor.innerHTML || '';
  const cleanHtml = _sanitizeTemplateHtml(rawHtml);
  // Do not reassign editor.innerHTML here, it ruins cursor position while typing
  const hiddenInput = document.getElementById('templateInstructions');
  if (hiddenInput) hiddenInput.value = cleanHtml;
  return cleanHtml;
}

/* Live-preview: update editor font based on language selection */
function _syncTemplatePreviewFont() {
  const editor = document.getElementById('templateInstructionsEditor');
  const sel = document.getElementById('templateFontName');
  if (!editor || !sel) return;

  const isHindi = sel.value === 'hindi';
  editor.style.fontFamily = isHindi
    ? "'AbbasiNatraj', 'AbbasiNagari', sans-serif"
    : 'Arial, sans-serif';
  editor.style.fontSize = isHindi ? '15px' : '13px';
}

function _syncTemplateBoldBtn() {
  const btn = document.getElementById('templateBoldBtn');
  if (!btn) return;
  btn.classList.toggle('is-active', !!_templateBoldState);
}

function _refreshTemplateToolbarState() {
  const editor = document.getElementById('templateInstructionsEditor');
  if (!editor) return;
  const hasFocus = editor === document.activeElement || editor.contains(document.activeElement);
  if (hasFocus) {
    try {
      _templateBoldState = !!document.queryCommandState('bold');
    } catch (e) {
      _templateBoldState = /<(strong|b)\b/i.test(editor.innerHTML || '');
    }
  }
  _syncTemplateBoldBtn();
}

function _focusTemplateEditorEnd() {
  const editor = document.getElementById('templateInstructionsEditor');
  if (!editor) return;
  editor.focus();

  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function _insertHtmlAtCursor(html) {
  const editor = document.getElementById('templateInstructionsEditor');
  if (!editor) return;
  editor.focus();
  try {
    document.execCommand('insertHTML', false, String(html || ''));
  } catch (e) {
    editor.innerHTML += String(html || '');
  }
  _getTemplateEditorHtml();
}

function toggleTemplateBold() {
  templateExecCommand('bold');
}

function templateExecCommand(command, value) {
  const editor = document.getElementById('templateInstructionsEditor');
  if (!editor) return;

  editor.focus();
  try {
    document.execCommand(command, false, value || null);
  } catch (e) {
    console.warn('Template editor command failed:', command, e);
  }

  const html = _getTemplateEditorHtml();
  _templateBoldState = /<(strong|b)\b/i.test(html);
  _syncTemplateBoldBtn();
}

function templateApplyFontSize(sizeValue) {
  const editor = document.getElementById('templateInstructionsEditor');
  if (!editor) return;
  const px = parseInt(String(sizeValue || ''), 10);
  if (!Number.isFinite(px) || px < 8 || px > 72) return;

  editor.focus();
  try {
    document.execCommand('fontSize', false, '7');
    editor.querySelectorAll('font[size="7"]').forEach(function (fontEl) {
      const span = document.createElement('span');
      span.style.fontSize = px + 'px';
      while (fontEl.firstChild) span.appendChild(fontEl.firstChild);
      fontEl.parentNode.replaceChild(span, fontEl);
    });
  } catch (e) {
    console.warn('templateApplyFontSize failed:', e);
  }

  _getTemplateEditorHtml();
}

function openTemplateImagePicker() {
  const input = document.getElementById('templateImageUploadInput');
  if (!input) return;
  input.click();
}

function openTemplateDocImportPicker() {
  const input = document.getElementById('templateDocImportInput');
  if (!input) return;
  input.click();
}

async function _importTemplateDocFile(file) {
  if (!file) return;
  const importBtn = document.getElementById('templateImportDocBtn');
  const originalBtnHtml = importBtn ? importBtn.innerHTML : '';

  if (importBtn) {
    importBtn.disabled = true;
    importBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Importing...</span>';
  }

  try {
    const formData = new FormData();
    formData.append('file', file);

    const resp = await fetch('/api/export-templates/import-doc/', {
      method: 'POST',
      headers: { 'X-CSRFToken': getCSRFToken() },
      body: formData,
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) {
      if (window.showToast) showToast((data && data.message) || 'Could not import Word document', 'error');
      return;
    }

    _setTemplateEditorHtml(String(data.html || ''));
    _focusTemplateEditorEnd();
    if (window.showToast) showToast('Word content imported successfully', 'success');
  } catch (err) {
    console.error('importTemplateDoc:', err);
    if (window.showToast) showToast('Import failed. Please try again.', 'error');
  } finally {
    if (importBtn) {
      importBtn.disabled = false;
      importBtn.innerHTML = originalBtnHtml;
    }
  }
}

function _bindTemplateEditorHandlers() {
  if (_templateEditorBound) return;
  _templateEditorBound = true;

  const editor = document.getElementById('templateInstructionsEditor');
  const docInput = document.getElementById('templateDocImportInput');
  const imageInput = document.getElementById('templateImageUploadInput');
  const fontSel = document.getElementById('templateFontName');

  if (editor) {
    editor.addEventListener('input', function () {
      _getTemplateEditorHtml();
      _refreshTemplateToolbarState();
    });
    editor.addEventListener('keyup', _refreshTemplateToolbarState);
    editor.addEventListener('mouseup', _refreshTemplateToolbarState);
    editor.addEventListener('blur', _refreshTemplateToolbarState);

    editor.addEventListener('paste', function (event) {
      const clip = event.clipboardData || window.clipboardData;
      if (!clip) return;

      const htmlPayload = clip.getData('text/html');
      if (htmlPayload) {
        event.preventDefault();
        _insertHtmlAtCursor(_sanitizeTemplateHtml(htmlPayload));
        return;
      }

      const textPayload = clip.getData('text/plain');
      if (textPayload) {
        event.preventDefault();
        document.execCommand('insertText', false, textPayload);
      }
    });
  }

  if (docInput) {
    docInput.addEventListener('change', async function () {
      const file = this.files && this.files[0] ? this.files[0] : null;
      if (!file) return;

      if (!/\.docx$/i.test(file.name || '')) {
        if (window.showToast) showToast('Please select a .docx file', 'error');
        this.value = '';
        return;
      }

      if (file.size > 12 * 1024 * 1024) {
        if (window.showToast) showToast('File too large. Maximum allowed size is 12 MB.', 'error');
        this.value = '';
        return;
      }

      await _importTemplateDocFile(file);
      this.value = '';
    });
  }

  if (imageInput) {
    imageInput.addEventListener('change', function () {
      const file = this.files && this.files[0] ? this.files[0] : null;
      if (!file) return;

      if (!String(file.type || '').toLowerCase().startsWith('image/')) {
        if (window.showToast) showToast('Please choose an image file', 'error');
        this.value = '';
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        if (window.showToast) showToast('Image too large. Maximum allowed size is 5 MB.', 'error');
        this.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = function (ev) {
        const src = String((ev && ev.target && ev.target.result) || '');
        if (!src) return;
        _insertHtmlAtCursor('<img src="' + escAttr(src) + '" alt="Template image">');
      };
      reader.readAsDataURL(file);
      this.value = '';
    });
  }

  if (fontSel) {
    fontSel.addEventListener('change', function () {
      const isHindi = fontSel.value === 'hindi';
      templateExecCommand('fontName', isHindi ? 'AbbasiNatraj' : 'Arial');
      _syncTemplatePreviewFont();
    });
  }
}

/* Attach editor and pagination listeners once DOM is ready */
document.addEventListener('DOMContentLoaded', function () {
  _bindTemplateEditorHandlers();
  _syncTemplatePreviewFont();
  _syncTemplateBoldBtn();

  _bindTemplatePaginationControls();
  _setTemplateRowsDropdownValue(_templatePerPage);
});

async function loadTemplates() {
  _bindTemplatePaginationControls();
  const skeletonStart = setPanelTableSkeleton('templateTableBody', {
    colCount: 6,
    columns: ['0.6fr', '2fr', '3fr', '1.3fr', '1fr', '1fr'],
    rows: 3,
    ariaLabel: 'Loading templates...',
  });
  try {
    const res = await fetch('/api/export-templates/');
    if (!res.ok) {
      await waitForPanelSkeletonDelay(skeletonStart);
      setPanelTableError(
        'templateTableBody',
        6,
        'fa-file-lines',
        'Unable to load templates',
        'Please refresh and try again.'
      );
      const wrap = document.getElementById('templatePaginationWrap');
      if (wrap) wrap.style.display = 'none';
      return;
    }
    const data = await res.json();
    if (data.success) {
      await waitForPanelSkeletonDelay(skeletonStart);
      panelTemplates = (data.templates || []).map(function (tpl) {
        const instructionsValue = String(tpl.instructions || '');
        return {
          id: Number(tpl.id),
          name: String(tpl.name || ''),
          instructions: instructionsValue,
          instructions_plain: _templateHtmlToPlainText(instructionsValue),
          font_name: String(tpl.font_name || 'arial').toLowerCase() === 'hindi' ? 'hindi' : 'arial',
          is_bold: Boolean(tpl.is_bold),
          is_default: Boolean(tpl.is_default),
        };
      });
      renderTemplateTable();
      return;
    }
    await waitForPanelSkeletonDelay(skeletonStart);
    setPanelTableError(
      'templateTableBody',
      6,
      'fa-file-lines',
      'Unable to load templates',
      'Please refresh and try again.'
    );
    const wrap = document.getElementById('templatePaginationWrap');
    if (wrap) wrap.style.display = 'none';
  } catch (err) {
    console.error('loadTemplates:', err);
    await waitForPanelSkeletonDelay(skeletonStart);
    setPanelTableError(
      'templateTableBody',
      6,
      'fa-file-lines',
      'Unable to load templates',
      'Network issue. Please refresh and try again.'
    );
    const wrap = document.getElementById('templatePaginationWrap');
    if (wrap) wrap.style.display = 'none';
  }
}

function renderTemplateTable() {
  const tbody = document.getElementById('templateTableBody');
  if (!tbody) return;

  _filterTemplates();
  const total = panelTemplateFiltered.length;

  if (!total) {
    tbody.innerHTML = `<tr class="notif-table-empty"><td colspan="6">
      <div class="empty-state"><i class="fa-solid fa-file-lines"></i>
        <p>No templates found</p><span>Try a different search or create a new template</span></div></td></tr>`;
    _renderTemplatePagination(0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / _templatePerPage));
  if (_templatePage > totalPages) _templatePage = totalPages;
  if (_templatePage < 1) _templatePage = 1;
  const startIndex = (_templatePage - 1) * _templatePerPage;
  const pageRows = panelTemplateFiltered.slice(startIndex, startIndex + _templatePerPage);

  tbody.innerHTML = pageRows.map((t, i) => {
    const previewSource = t.instructions_plain || '';
    const preview = previewSource.length > 80 ? previewSource.substring(0, 80) + '...' : previewSource;
    const fontLabel = t.font_name === 'hindi' ? 'Hindi' : 'Arial';
    const boldLabel = t.is_bold ? '<span class="template-style-pill">Bold</span>' : '<span class="template-style-pill muted">Normal</span>';
    return `<tr>
      <td class="text-center text-xs text-gray-400">${startIndex + i + 1}</td>
      <td>
        <div class="notif-title-cell">
          <strong class="text-sm">${escHtml(t.name)}</strong>
        </div>
      </td>
      <td><span class="text-xs text-gray-600">${escHtml(preview)}</span></td>
      <td>
        <div class="template-style-cell">
          <span class="template-style-pill">${fontLabel}</span>
          ${boldLabel}
        </div>
      </td>
      <td class="text-center">${t.is_default ? '<span class="notif-badge-priority normal">Default</span>' : ''}</td>
      <td>
        <div class="notif-actions-cell">
          <button class="btn btn-icon btn-neutral" title="Edit" onclick="editTemplate(${t.id})"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-icon btn-danger" title="Delete" onclick="deleteTemplate(${t.id})"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');

  _renderTemplatePagination(total);
}

async function openCreateTemplateModal() {
  document.getElementById('templateEditId').value = '';
  document.getElementById('templateName').value = '';
  _setTemplateEditorHtml('');
  document.getElementById('templateIsDefault').checked = false;
  document.getElementById('templateFontName').value = 'arial';
  _templateBoldState = false;
  _syncTemplateBoldBtn();
  _syncTemplatePreviewFont();
  document.getElementById('templateModalTitle').innerHTML = '<i class="fa-solid fa-file-lines"></i> New Template';
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
    window.AdarshModalBridge.open('templateModal', { overlayClass: 'show' });
  } else {
    document.getElementById('templateModal').classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  setTimeout(_focusTemplateEditorEnd, 30);
}

async function editTemplate(id) {
  const t = panelTemplates.find(x => x.id === id);
  if (!t) return;
  document.getElementById('templateEditId').value = id;
  document.getElementById('templateName').value = t.name;
  _setTemplateEditorHtml(t.instructions || '');
  document.getElementById('templateIsDefault').checked = t.is_default;
  document.getElementById('templateFontName').value = t.font_name || 'arial';
  _templateBoldState = /<(strong|b)\b/i.test(String(t.instructions || '')) || !!t.is_bold;
  _syncTemplateBoldBtn();
  _syncTemplatePreviewFont();
  document.getElementById('templateModalTitle').innerHTML = '<i class="fa-solid fa-file-lines"></i> Edit Template';
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
    window.AdarshModalBridge.open('templateModal', { overlayClass: 'show' });
  } else {
    document.getElementById('templateModal').classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  setTimeout(_focusTemplateEditorEnd, 30);
}

function closeTemplateModal() {
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
    window.AdarshModalBridge.close('templateModal', { overlayClass: 'show' });
  } else {
    document.getElementById('templateModal').classList.remove('show');
    document.body.style.overflow = '';
  }
}

async function saveTemplate() {
  const editId = document.getElementById('templateEditId').value;
  const name = document.getElementById('templateName').value.trim();
  const instructions = _getTemplateEditorHtml();
  const instructionsText = _templateHtmlToPlainText(instructions);
  const hasImage = /<img\b/i.test(instructions);
  const is_default = document.getElementById('templateIsDefault').checked;
  const font_name = document.getElementById('templateFontName').value;
  const is_bold = /<(strong|b)\b/i.test(instructions);
  const saveBtn = document.getElementById('templateHeaderSaveBtn');
  const originalSaveHtml = saveBtn ? saveBtn.innerHTML : '';

  if (!name) { if (window.showToast) showToast('Template name is required', 'error'); return; }
  if (!instructionsText && !hasImage) { if (window.showToast) showToast('Footer content is required', 'error'); return; }
  if (instructions.length > 250000) { if (window.showToast) showToast('Content is too large. Keep it under 250000 characters.', 'error'); return; }

  const url = editId
    ? `/api/export-templates/${editId}/update/`
    : '/api/export-templates/create/';

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
      body: JSON.stringify({ name, instructions, is_default, font_name, is_bold }),
    });
    const data = await res.json();
    if (!data.success) {
      if (window.showToast) showToast(data.message || 'Failed', 'error');
      return;
    }

    if (window.showToast) {
      showToast(editId ? 'Template updated' : 'Template created', 'success');
    }

    closeTemplateModal();
    loadTemplates();
  } catch (err) {
    console.error('saveTemplate:', err);
    if (window.showToast) showToast('Network error', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalSaveHtml;
    }
  }
}

async function deleteTemplate(id) {
  _panelConfirm(
    'Delete Template',
    'Delete this template? This action cannot be undone.',
    async function () {
      try {
        const res = await fetch(`/api/export-templates/${id}/delete/`, {
          method: 'POST',
          headers: { 'X-CSRFToken': getCSRFToken() },
        });
        const data = await res.json();
        if (data.success) {
          if (window.showToast) showToast('Template deleted', 'success');
          loadTemplates();
        } else {
          if (window.showToast) showToast(data.message || 'Failed', 'error');
        }
      } catch (err) { console.error('deleteTemplate:', err); }
    }
  );
}


/* ================================================================
  LOGS & UPDATES TAB (Monitoring + Logs)
   ================================================================ */
let operationsFeed = [];
let _opsPerPage = 25;
let _opsPage = 1;
let _opsTotalPages = 1;
let operationsTotal = 0;
let opsSearchTimer = null;
let opsAutoRefreshTimer = null;

function handleOpsSourceChange() {
  const source = document.getElementById('opsSourceFilter')?.value || 'logs';
  const taskStatusFilter = document.getElementById('opsTaskStatusFilter');
  const actionFilter = document.getElementById('opsActionFilter');
  const userRoleFilter = document.getElementById('opsUserTypeFilter');

  if (taskStatusFilter) {
    const taskOnly = source === 'tasks' || source === 'backups';
    taskStatusFilter.disabled = source === 'logs';
    taskStatusFilter.style.opacity = source === 'logs' ? '0.65' : '1';
    if (!taskOnly) taskStatusFilter.value = '';
  }

  if (actionFilter) {
    const disableAction = source === 'tasks' || source === 'backups';
    actionFilter.disabled = disableAction;
    actionFilter.style.opacity = disableAction ? '0.65' : '1';
    if (source !== 'logs') actionFilter.value = '';
  }

  if (userRoleFilter) {
    userRoleFilter.disabled = false;
    userRoleFilter.style.opacity = '1';
  }

  loadOperationsFeed(1);
}

function resetOperationsFilters() {
  const ids = ['opsSearch', 'opsSourceFilter', 'opsUserTypeFilter', 'opsTaskStatusFilter', 'opsActionFilter'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') {
      el.selectedIndex = 0;
    } else {
      el.value = '';
    }
  });
  handleOpsSourceChange();
}

async function clearActivityLogsManual() {
  const clearEnabled = window.ACTIVITY_LOG_CLEAR_ENABLED === true || window.ACTIVITY_LOG_CLEAR_ENABLED === 'true';
  if (!clearEnabled) {
    if (typeof showToast === 'function') {
      showToast('Log clearing is disabled for safety. Enable it in server settings only when needed.', 'error');
    }
    return;
  }

  const confirmPhrase = String(window.ACTIVITY_LOG_CLEAR_CONFIRM_PHRASE || 'DELETE ALL LOGS').trim();
  const clearBtn = document.getElementById('opsClearLogsBtn');
  const ok = await showConfirm({
    title: 'Clear Logs?',
    text: 'This will permanently delete all system logs. This action cannot be undone.',
    icon: 'fa-solid fa-trash-can',
    confirmLabel: 'Clear Logs',
    btnClass: 'btn-danger',
  });
  if (!ok) return;

  const typedPhrase = window.prompt(`Type exactly: ${confirmPhrase}`);
  if (typedPhrase === null) return;
  if (String(typedPhrase).trim() !== confirmPhrase) {
    if (typeof showToast === 'function') {
      showToast('Confirmation text did not match. Logs were not cleared.', 'error');
    }
    return;
  }

  const originalHtml = clearBtn ? clearBtn.innerHTML : '';
  if (clearBtn) {
    clearBtn.disabled = true;
    clearBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Clearing';
  }

  try {
    const res = await fetch('/api/activity-logs/clear/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ confirm_phrase: confirmPhrase }),
    });
    const data = await res.json();
    if (res.ok && data && data.success) {
      if (typeof showToast === 'function') {
        showToast(data.message || 'System logs cleared.', 'success');
      }
      _opsPage = 1;
      await loadOperationsFeed(1);
      return;
    }
    if (typeof showToast === 'function') {
      showToast((data && data.message) || 'Failed to clear logs.', 'error');
    }
  } catch (err) {
    console.error('clearActivityLogsManual:', err);
    if (typeof showToast === 'function') {
      showToast('Network error while clearing logs.', 'error');
    }
  } finally {
    if (clearBtn) {
      clearBtn.disabled = false;
      clearBtn.innerHTML = originalHtml || '<i class="fa-solid fa-trash-can"></i> Clear Logs';
    }
  }
}

function _syncOpsAutoRefresh(shouldRun) {
  if (!shouldRun) {
    if (opsAutoRefreshTimer) {
      clearInterval(opsAutoRefreshTimer);
      opsAutoRefreshTimer = null;
    }
    return;
  }
  if (opsAutoRefreshTimer) return;
  opsAutoRefreshTimer = setInterval(() => {
    const activeTab = document.querySelector('.panel-tab.active')?.dataset?.tab;
    if (activeTab === 'log-history' && !document.hidden) {
      loadOperationsFeed();
    }
  }, 45000);
}

function debounceOpsSearch() {
  clearTimeout(opsSearchTimer);
  opsSearchTimer = setTimeout(() => loadOperationsFeed(1), 300);
}

function _opsSourceBadge(sourceType, sourceLabel) {
  const label = sourceLabel || 'Event';
  const cls = sourceType === 'background_task'
    ? 'ops-source-badge task'
    : sourceType === 'backup_task'
      ? 'ops-source-badge backup'
      : 'ops-source-badge log';
  const icon = sourceType === 'background_task'
    ? 'fa-gears'
    : sourceType === 'backup_task'
      ? 'fa-database'
      : 'fa-clock-rotate-left';
  return `<span class="${cls}"><i class="fa-solid ${icon}"></i> ${escHtml(label)}</span>`;
}

function _opsStatusCell(item) {
  if (item.source_type === 'activity_log') {
    return `<span class="log-action-badge ${item.icon_color || 'edit'}"><i class="fa-solid ${item.icon_class || 'fa-circle-info'}"></i> ${escHtml(item.action_display || item.action || 'Event')}</span>`;
  }
  return _statusBadge(item.status, item.status_display || item.status || 'Unknown');
}

function _opsDeviceMeta(item) {
  if (!item || item.source_type !== 'activity_log') return null;
  const action = String(item.action || '').trim().toLowerCase();
  const isAuthEvent = action === 'login' || action === 'logout';

  let surface = String(item.device_surface || '').trim().toLowerCase();
  if (!surface || surface === 'unknown') {
    const text = String(item.description || '').toLowerCase();
    if (/(mobile app|android|iphone|ipad|ipod|\bmobile\b|\bios\b)/.test(text)) {
      surface = 'mobile';
    } else if (/(desktop|browser|windows|mac|linux|\bweb\b)/.test(text)) {
      surface = 'desktop';
    }
  }

  if (surface === 'mobile') return { icon: 'fa-mobile-screen-button', label: 'Mobile' };
  if (surface === 'desktop') return { icon: 'fa-desktop', label: 'Desktop' };

  if (!isAuthEvent) return null;

  const fallbackLabel = String(item.device_surface_label || '').trim() || 'Unknown';
  const fallbackIcon = String(item.device_surface_icon || '').trim() || 'fa-circle-question';
  return { icon: fallbackIcon, label: fallbackLabel };
}

function _opsCancelAction(item) {
  const taskId = Number(item?.task_id || 0);
  if (!item || !item.can_cancel || !Number.isInteger(taskId) || taskId <= 0) {
    return '';
  }
  const btnId = `opsCancelTaskBtn-${taskId}`;
  return `<div class="ops-row-action"><button type="button" class="btn btn-sm btn-danger ops-cancel-btn" id="${btnId}" onclick="cancelOperationsLatestTask(${taskId})" title="Cancel latest active task"><i class="fa-solid fa-ban"></i> Cancel Task</button></div>`;
}

window.cancelOperationsLatestTask = async function (taskId) {
  const parsedTaskId = Number(taskId || 0);
  if (!Number.isInteger(parsedTaskId) || parsedTaskId <= 0) return;

  const ok = await showConfirm({
    title: 'Cancel Latest Active Task?',
    text: 'This will stop the latest running background task from Logs & Updates.',
    icon: 'fa-solid fa-ban',
    confirmLabel: 'Cancel Task',
    btnClass: 'btn-danger',
  });
  if (!ok) return;

  const btn = document.getElementById(`opsCancelTaskBtn-${parsedTaskId}`);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cancelling';
  }

  try {
    const res = await fetch(`/api/task-cancel/${parsedTaskId}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ latest_only: true }),
    });
    const data = await res.json();

    if (res.ok && data?.success) {
      if (typeof showToast === 'function') {
        showToast(data.message || 'Task cancelled.', 'success');
      }
      await loadOperationsFeed(_opsPage);
      return;
    }

    if (typeof showToast === 'function') {
      showToast((data && data.message) || 'Failed to cancel task.', 'error');
    }
  } catch (err) {
    console.error('cancelOperationsLatestTask:', err);
    if (typeof showToast === 'function') {
      showToast('Network error while cancelling task.', 'error');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml || '<i class="fa-solid fa-ban"></i> Cancel Task';
    }
  }
};

function renderOperationsTable() {
  const tbody = document.getElementById('opsTableBody');
  if (!tbody) return;
  if (!operationsFeed.length) {
    tbody.innerHTML = `<tr class="notif-table-empty"><td colspan="7">
      <div class="empty-state"><i class="fa-solid fa-wave-square"></i>
      <p>No logs or updates found</p><span>Adjust filters or wait for new activity.</span></div></td></tr>`;
    return;
  }

  tbody.innerHTML = operationsFeed.map((item, i) => {
    const detailMain = item.description || item.current_client || item.target_name || '';
    const detailMeta = [];
    const deviceMeta = _opsDeviceMeta(item);
    if (item.target_name) detailMeta.push(`Target: ${item.target_name}`);
    if (item.progress_text) detailMeta.push(item.progress_text);
    if (item.ip_address) detailMeta.push(`IP: ${item.ip_address}`);
    if (item.error) detailMeta.push(`Error: ${item.error}`);
    const deviceLine = deviceMeta
      ? `<div class="ops-detail-meta"><i class="fa-solid ${escHtml(deviceMeta.icon)}"></i> Device: ${escHtml(deviceMeta.label)}</div>`
      : '';
    const rowNumber = ((_opsPage - 1) * _opsPerPage) + i + 1;

    return `<tr>
      <td class="text-center text-xs text-gray-400">${rowNumber}</td>
      <td>${_opsSourceBadge(item.source_type, item.source_label)}</td>
      <td>
        <div class="ops-event-title">${escHtml(item.event_title || '-')}</div>
        <div class="ops-event-sub">${escHtml(item.event_subtitle || '')}</div>
      </td>
      <td>${_opsStatusCell(item)}${_opsCancelAction(item)}</td>
      <td><span class="text-xs font-medium">${escHtml(item.user || 'System')}</span></td>
      <td>
        <div class="ops-detail-main">${escHtml(detailMain || '-')}</div>
        <div class="ops-detail-meta">${escHtml(detailMeta.join(' | '))}</div>
        ${deviceLine}
      </td>
      <td>
        <span class="notif-time">${escHtml(item.created_at || '')}</span>
        <div class="ops-time-sub">${escHtml(item.time_ago || '')}</div>
      </td>
    </tr>`;
  }).join('');
}

function _buildOpsPageNumbers(currentPage, totalPages) {
  if (!totalPages || totalPages < 1) return '';
  const maxVisible = 5;
  let start = Math.max(1, currentPage - 2);
  let end = Math.min(totalPages, start + maxVisible - 1);
  if ((end - start + 1) < maxVisible) {
    start = Math.max(1, end - maxVisible + 1);
  }

  let html = '';
  for (let p = start; p <= end; p++) {
    html += `<button class="page-num${p === currentPage ? ' active' : ''}" onclick="opsSetPage(${p})">${p}</button>`;
  }
  return html;
}

function _updateOpsPagination(rowsOnPage) {
  const total = Math.max(0, Number(operationsTotal || 0));
  const start = total ? ((_opsPage - 1) * _opsPerPage) + 1 : 0;
  const end = total ? (start + Math.max(0, Number(rowsOnPage || 0)) - 1) : 0;

  const info = document.getElementById('opsPaginationInfo');
  const pageNumbers = document.getElementById('opsPageNumbers');
  const firstBtn = document.getElementById('opsFirstBtn');
  const prevBtn = document.getElementById('opsPrevBtn');
  const nextBtn = document.getElementById('opsNextBtn');
  const lastBtn = document.getElementById('opsLastBtn');
  const rowsSelect = document.getElementById('opsRowsPerPage');

  if (info) {
    info.innerHTML = `Showing <strong>${start}-${end}</strong> of <strong>${total}</strong> results`;
  }
  if (pageNumbers) {
    pageNumbers.innerHTML = _buildOpsPageNumbers(_opsPage, _opsTotalPages);
  }

  if (firstBtn) firstBtn.disabled = _opsPage <= 1;
  if (prevBtn) prevBtn.disabled = _opsPage <= 1;
  if (nextBtn) nextBtn.disabled = _opsPage >= _opsTotalPages;
  if (lastBtn) lastBtn.disabled = _opsPage >= _opsTotalPages;
  if (rowsSelect && String(rowsSelect.value) !== String(_opsPerPage)) {
    rowsSelect.value = String(_opsPerPage);
  }
}

window.opsSetPage = function (page) {
  const requested = page === -1 ? _opsTotalPages : Number(page || 1);
  const nextPage = Math.max(1, Math.min(requested, _opsTotalPages));
  if (nextPage === _opsPage) return;
  loadOperationsFeed(nextPage);
};

window.opsPage = function (delta) {
  opsSetPage(_opsPage + Number(delta || 0));
};

window.onOpsRowsPerPageChange = function (value) {
  const next = Number(value || 25);
  _opsPerPage = [10, 25, 50, 100].includes(next) ? next : 25;
  _opsPage = 1;
  loadOperationsFeed(1);
};

async function loadOperationsFeed(page) {
  if (page !== undefined) _opsPage = Math.max(1, Number(page || 1));
  const refreshBtn = document.getElementById('opsRefreshBtn');
  const skeletonStart = setPanelTableSkeleton('opsTableBody', {
    colCount: 7,
    columns: ['0.5fr', '1fr', '1.3fr', '1.3fr', '1.2fr', '2.4fr', '1.3fr'],
    rows: 3,
    ariaLabel: 'Loading logs and updates...',
  });
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Loading';
  }

  try {
    const search = document.getElementById('opsSearch')?.value || '';
    const source = document.getElementById('opsSourceFilter')?.value || 'logs';
    const userRole = document.getElementById('opsUserTypeFilter')?.value || '';
    const taskStatus = document.getElementById('opsTaskStatusFilter')?.value || '';
    const action = document.getElementById('opsActionFilter')?.value || '';

    const taskStatusFilter = document.getElementById('opsTaskStatusFilter');
    const actionFilter = document.getElementById('opsActionFilter');
    const userRoleFilter = document.getElementById('opsUserTypeFilter');
    if (taskStatusFilter) {
      taskStatusFilter.disabled = source === 'logs';
      taskStatusFilter.style.opacity = source === 'logs' ? '0.65' : '1';
    }
    if (actionFilter) {
      const disableAction = source === 'tasks' || source === 'backups';
      actionFilter.disabled = disableAction;
      actionFilter.style.opacity = disableAction ? '0.65' : '1';
    }
    if (userRoleFilter) {
      userRoleFilter.disabled = false;
      userRoleFilter.style.opacity = '1';
    }

    const offset = (_opsPage - 1) * _opsPerPage;
    let url = `/api/operations-feed/?limit=${_opsPerPage}&offset=${offset}&source=${encodeURIComponent(source)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (userRole) url += `&user_role=${encodeURIComponent(userRole)}`;
    if (taskStatus) url += `&task_status=${encodeURIComponent(taskStatus)}`;
    if (action) url += `&action=${encodeURIComponent(action)}`;

    const res = await fetch(url);
    if (!res.ok) {
      console.error('loadOperationsFeed HTTP', res.status);
      await waitForPanelSkeletonDelay(skeletonStart);
      setPanelTableError(
        'opsTableBody',
        7,
        'fa-wave-square',
        'Unable to load logs and updates',
        'Please refresh and try again.'
      );
      return;
    }
    const data = await res.json();
    if (!data.success) {
      await waitForPanelSkeletonDelay(skeletonStart);
      setPanelTableError(
        'opsTableBody',
        7,
        'fa-wave-square',
        'Unable to load logs and updates',
        'Please refresh and try again.'
      );
      return;
    }

    operationsFeed = data.items || [];
    operationsTotal = Number(data.total || operationsFeed.length || 0);
    _opsTotalPages = Math.max(1, Math.ceil(operationsTotal / _opsPerPage));

    if (_opsPage > _opsTotalPages) {
      _opsPage = _opsTotalPages;
      return loadOperationsFeed(_opsPage);
    }

    await waitForPanelSkeletonDelay(skeletonStart);
    renderOperationsTable();
    _updateOpsPagination(operationsFeed.length);
  } catch (err) {
    console.error('loadOperationsFeed:', err);
    await waitForPanelSkeletonDelay(skeletonStart);
    setPanelTableError(
      'opsTableBody',
      7,
      'fa-wave-square',
      'Unable to load logs and updates',
      'Network issue. Please refresh and try again.'
    );
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh';
    }
  }
}

function loadLogs() {
  return loadOperationsFeed();
}

function debounceLogSearch() {
  debounceOpsSearch();
}

/* ================================================================
   EMAIL MANAGEMENT TAB
   (Previously embedded in tab-email-logs.html  moved here for
    proper file-based caching, linting and CSP compliance)
   ================================================================ */
let _emailPage = 1;
let _emailPerPage = 50;
let _emailTotalPages = 1;
let _emailTotal = 0;
let _emailLogsById = {};
let _emailComposePreviewBound = false;
let _emailSearchTimer = null;
let _emailSortOrder = 'latest';

const EMAIL_STATUS_FILTER_LABELS = {
  on_hold: 'On Hold',
  pending: 'Pending',
  sent: 'Sent',
  failed: 'Failed',
};

function _normalizeEmailSortOrder(value) {
  return String(value || '').toLowerCase() === 'oldest' ? 'oldest' : 'latest';
}

function _syncEmailStatusFilterBadges(activeStatus) {
  const normalized = String(activeStatus || '');
  const badges = document.querySelectorAll('.email-status-filter[data-email-status]');
  badges.forEach(function (badge) {
    const badgeStatus = badge.getAttribute('data-email-status') || '';
    const isActive = !!normalized && badgeStatus === normalized;
    const label = EMAIL_STATUS_FILTER_LABELS[badgeStatus] || 'Status';
    badge.classList.toggle('is-active', isActive);
    badge.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    badge.setAttribute('title', isActive ? ('Active filter: ' + label + ' (click to clear)') : ('Filter: ' + label));
  });
}

window.setEmailStatusQuickFilter = function (statusValue) {
  const nextStatus = String(statusValue || '').trim();
  const statusSelect = document.getElementById('emailStatusFilter');
  if (!statusSelect || !nextStatus) return;
  statusSelect.value = statusSelect.value === nextStatus ? '' : nextStatus;
  _syncEmailStatusFilterBadges(statusSelect.value || '');
  loadEmailLogs(1);
};

window.debounceEmailSearch = function () {
  clearTimeout(_emailSearchTimer);
  _emailSearchTimer = setTimeout(function () {
    loadEmailLogs(1);
  }, 300);
};

const EMAIL_TEMPLATE_CONFIG = {
  system: {
    label: 'System / Custom',
    subject: 'Message from Adarsh Admin',
    body: 'Hello User,\n\nThis is a message from Adarsh Admin.\n\nRegards,\nAdarsh Admin Team',
    icon: 'fa-paper-plane',
    badge: '#0f766e',
    accent: '#0d9488',
    gradient: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
  },
  welcome: {
    label: 'Welcome / Activation',
    subject: 'Welcome to Adarsh Admin - Your Account is Ready',
    body: 'Hello User,\n\nWelcome to Adarsh Admin. Your account has been created successfully.\n\nPlease login and update your password after first sign in.\n\nRegards,\nAdarsh Admin Team',
    icon: 'fa-hand-sparkles',
    badge: '#1d4ed8',
    accent: '#2563eb',
    gradient: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
  },
  temp_password: {
    label: 'Temp Password',
    subject: 'Temporary Password for Your Account',
    body: 'Hello User,\n\nA temporary password has been issued for your account.\n\nPlease login immediately and change your password for security.\n\nRegards,\nAdarsh Admin Team',
    icon: 'fa-key',
    badge: '#7c3aed',
    accent: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
  },
  password_change: {
    label: 'Password Change Notice',
    subject: 'Your Password Was Changed',
    body: 'Hello User,\n\nYour account password has been changed by an administrator.\n\nIf you did not request this, please contact support immediately.\n\nRegards,\nAdarsh Admin Team',
    icon: 'fa-shield-halved',
    badge: '#b45309',
    accent: '#d97706',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
  },
  otp_reset: {
    label: 'Password Reset OTP',
    subject: 'Password Reset OTP',
    body: 'Hello User,\n\nUse your OTP to reset your password. The OTP is valid for a limited time only.\n\nIf you did not request this, ignore this email.\n\nRegards,\nAdarsh Admin Team',
    icon: 'fa-lock',
    badge: '#be123c',
    accent: '#e11d48',
    gradient: 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)',
  },
};

function _normalizeEmailType(type) {
  return EMAIL_TEMPLATE_CONFIG[type] ? type : 'system';
}

function _defaultEmailSubject(emailType) {
  const t = EMAIL_TEMPLATE_CONFIG[_normalizeEmailType(emailType)];
  return t.subject;
}

function _defaultEmailBody(emailType, recipientName) {
  const t = EMAIL_TEMPLATE_CONFIG[_normalizeEmailType(emailType)];
  const name = (recipientName || 'User').trim() || 'User';
  return (t.body || '').replace(/\bUser\b/g, name);
}

function _messageTextToBlocks(text) {
  const raw = (text || '').trim();
  if (!raw) return '<p style="margin:0;">No message provided.</p>';
  return escHtml(raw)
    .split(/\n\s*\n/g)
    .map(function (chunk) {
      const lineHtml = chunk.replace(/\n/g, '<br>');
      return '<p style="margin:0 0 14px;line-height:1.68;">' + lineHtml + '</p>';
    })
    .join('');
}

function _buildEmailTemplateHtml(payload, asDocument) {
  const emailType = _normalizeEmailType(payload.email_type);
  const cfg = EMAIL_TEMPLATE_CONFIG[emailType];
  const name = (payload.recipient_name || 'User').trim() || 'User';
  const email = (payload.recipient_email || '').trim();
  const subject = (payload.subject || _defaultEmailSubject(emailType)).trim() || _defaultEmailSubject(emailType);
  const messageHtml = _messageTextToBlocks(payload.body_text || _defaultEmailBody(emailType, name));
  const year = new Date().getFullYear();

  const css = '<style>' +
    '*{box-sizing:border-box}' +
    'body{margin:0;padding:0;background:#eef2f7;font-family:"Saira Semi Condensed","Segoe UI",Arial,sans-serif;color:#0f172a}' +
    '.mail-shell{width:100%;padding:24px 12px;background:#eef2f7}' +
    '.mail-card{width:100%;max-width:1200px;min-width:300px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ef;border-radius:8px;overflow:hidden}' +
    '.mail-header{padding:26px 26px 22px;background:' + cfg.gradient + ';color:#fff}' +
    '.mail-badge{display:inline-block;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:rgba(255,255,255,.2);margin-bottom:14px}' +
    '.mail-title{margin:0;font-size:26px;line-height:1.2;font-weight:700}' +
    '.mail-sub{margin:8px 0 0;font-size:14px;opacity:.95}' +
    '.mail-body{padding:28px 26px 24px}' +
    '.mail-meta{border:1px solid #e5e7eb;border-radius:6px;background:#f8fafc;padding:14px 16px;margin:0 0 18px}' +
    '.mail-meta-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:0 0 5px;font-weight:700}' +
    '.mail-meta-value{font-size:14px;color:#0f172a;font-weight:600;word-break:break-word;margin:0}' +
    '.mail-message{border:1px solid #e2e8f0;border-left:4px solid ' + cfg.accent + ';background:#ffffff;border-radius:6px;padding:16px 16px 2px;font-size:15px;color:#334155}' +
    '.mail-footer{padding:16px 26px 22px;border-top:1px solid #e5e7eb;background:#f8fafc;font-size:12px;color:#64748b}' +
    '.mail-footer p{margin:0 0 4px}' +
    '@media (max-width:760px){.mail-shell{padding:12px 8px}.mail-card{min-width:300px;border-radius:8px}.mail-header{padding:18px 16px}.mail-title{font-size:21px}.mail-body{padding:18px 16px}.mail-footer{padding:14px 16px}}' +
    '</style>';

  const body = '<div class="mail-shell">' +
    '<div class="mail-card">' +
      '<div class="mail-header">' +
        '<div class="mail-badge"><i class="fa-solid ' + cfg.icon + '"></i> ' + escHtml(cfg.label) + '</div>' +
        '<h1 class="mail-title">' + escHtml(subject) + '</h1>' +
        '<p class="mail-sub">Prepared by Adarsh Admin Mail Center</p>' +
      '</div>' +
      '<div class="mail-body">' +
        '<div class="mail-meta">' +
          '<p class="mail-meta-label">Recipient</p>' +
          '<p class="mail-meta-value">' + escHtml(name) + (email ? '  (' + escHtml(email) + ')' : '') + '</p>' +
        '</div>' +
        '<div class="mail-message">' + messageHtml + '</div>' +
      '</div>' +
      '<div class="mail-footer">' +
        '<p>This is an automated email from Adarsh Admin.</p>' +
        '<p>Copyright ' + year + ' Adarsh Admin. All rights reserved.</p>' +
      '</div>' +
    '</div>' +
  '</div>';

  if (!asDocument) return css + body;
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' + css + '</head><body>' + body + '</body></html>';
}

function _renderEmailComposePreview() {
  const previewEl = document.getElementById('emailComposePreview');
  const htmlEl = document.getElementById('emailComposeBodyHtml');
  if (!previewEl || !htmlEl) return;

  const payload = {
    recipient_name: (document.getElementById('emailComposeRecipientName')?.value || '').trim(),
    recipient_email: (document.getElementById('emailComposeRecipientEmail')?.value || '').trim(),
    email_type: (document.getElementById('emailComposeType')?.value || 'system').trim(),
    subject: (document.getElementById('emailComposeSubject')?.value || '').trim(),
    body_text: (document.getElementById('emailComposeBodyText')?.value || '').trim(),
  };

  previewEl.innerHTML = _buildEmailTemplateHtml(payload, false);
  htmlEl.value = _buildEmailTemplateHtml(payload, true);
}

function _bindEmailComposePreview() {
  if (_emailComposePreviewBound) return;

  const bind = function (id, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  };

  bind('emailComposeRecipientName', _renderEmailComposePreview);
  bind('emailComposeRecipientEmail', _renderEmailComposePreview);
  bind('emailComposeSubject', _renderEmailComposePreview);
  bind('emailComposeBodyText', _renderEmailComposePreview);
  bind('emailComposeType', function () {
    const type = _normalizeEmailType(document.getElementById('emailComposeType')?.value || 'system');
    const isEdit = !!(document.getElementById('emailComposeLogId')?.value || '').trim();
    if (!isEdit) {
      const name = (document.getElementById('emailComposeRecipientName')?.value || '').trim();
      const subjectEl = document.getElementById('emailComposeSubject');
      const bodyEl = document.getElementById('emailComposeBodyText');
      if (subjectEl) subjectEl.value = _defaultEmailSubject(type);
      if (bodyEl) bodyEl.value = _defaultEmailBody(type, name || 'User');
    }
    _renderEmailComposePreview();
  });

  _emailComposePreviewBound = true;
}

function _buildEmailActionButtons(log) {
  const id = Number(log.id || 0);
  const type = escAttr(log.email_type || 'system');
  return '<div class="email-actions-stack">' +
    '<button class="btn btn-sm btn-outline-primary email-action-btn" onclick="openEditEmailModal(' + id + ')" title="Edit and resend with custom content">' +
      '<i class="fa-solid fa-pen-to-square"></i> Edit' +
    '</button>' +
    '<button class="btn btn-sm btn-primary email-action-btn" onclick="resendEmail(' + id + ',\'' + type + '\')" title="Resend email">' +
      '<i class="fa-solid fa-paper-plane"></i> Resend' +
    '</button>' +
  '</div>';
}

function _buildEmailPageNumbers(currentPage, totalPages) {
  if (!totalPages || totalPages < 1) return '';
  const maxVisible = 5;
  let start = Math.max(1, currentPage - 2);
  let end = Math.min(totalPages, start + maxVisible - 1);
  if ((end - start + 1) < maxVisible) {
    start = Math.max(1, end - maxVisible + 1);
  }

  let html = '';
  for (let p = start; p <= end; p++) {
    html += '<button class="page-num' + (p === currentPage ? ' active' : '') + '" onclick="emailSetPage(' + p + ')">' + p + '</button>';
  }
  return html;
}

function _updateEmailPagination(total, totalPages, rowsOnPage) {
  const safeTotal = Math.max(0, Number(total || 0));
  const safePages = Math.max(1, Number(totalPages || 1));
  const safeRows = Math.max(0, Number(rowsOnPage || 0));
  const start = safeTotal ? ((_emailPage - 1) * _emailPerPage) + 1 : 0;
  const end = safeTotal ? (start + safeRows - 1) : 0;

  const label = document.getElementById('emailLogCountLabel');
  const pageNumbers = document.getElementById('emailPageNumbers');
  const firstBtn = document.getElementById('emailFirstBtn');
  const prevBtn = document.getElementById('emailPrevBtn');
  const nextBtn = document.getElementById('emailNextBtn');
  const lastBtn = document.getElementById('emailLastBtn');
  const rowsSelect = document.getElementById('emailRowsPerPage');

  if (label) {
    label.innerHTML = 'Showing <strong>' + start + '-' + end + '</strong> of <strong>' + safeTotal + '</strong> results';
  }
  if (pageNumbers) {
    pageNumbers.innerHTML = _buildEmailPageNumbers(_emailPage, safePages);
  }

  if (firstBtn) firstBtn.disabled = _emailPage <= 1;
  if (prevBtn) prevBtn.disabled = _emailPage <= 1;
  if (nextBtn) nextBtn.disabled = _emailPage >= safePages;
  if (lastBtn) lastBtn.disabled = _emailPage >= safePages;
  if (rowsSelect && String(rowsSelect.value) !== String(_emailPerPage)) {
    rowsSelect.value = String(_emailPerPage);
  }
}

window.emailSetPage = function (page) {
  const requested = page === -1 ? _emailTotalPages : Number(page || 1);
  const nextPage = Math.max(1, Math.min(requested, _emailTotalPages));
  if (nextPage === _emailPage) return;
  loadEmailLogs(nextPage);
};

window.onEmailRowsPerPageChange = function (value) {
  const next = Number(value || 50);
  _emailPerPage = [10, 25, 50, 100].includes(next) ? next : 50;
  _emailPage = 1;
  loadEmailLogs(1);
};

window.loadEmailLogs = function (page) {
  if (page !== undefined) _emailPage = Math.max(1, Number(page || 1));

  const search = document.getElementById('emailSearch')?.value?.trim() || '';
  const status = document.getElementById('emailStatusFilter')?.value || '';
  const type   = document.getElementById('emailTypeFilter')?.value   || '';
  const sortSelect = document.getElementById('emailSortFilter');
  const sort = _normalizeEmailSortOrder(sortSelect?.value || _emailSortOrder);
  _emailSortOrder = sort;
  if (sortSelect && sortSelect.value !== sort) sortSelect.value = sort;
  _syncEmailStatusFilterBadges(status);

  let url = (window.EMAIL_LOGS_API_URL || '/api/email-logs/') + '?page=' + _emailPage + '&per_page=' + _emailPerPage;
  if (search) url += '&search=' + encodeURIComponent(search);
  if (status) url += '&status='     + encodeURIComponent(status);
  if (type)   url += '&email_type=' + encodeURIComponent(type);
  url += '&sort=' + encodeURIComponent(sort);

  const tbody = document.getElementById('emailLogsBody');
  var skeletonStart = null;
  if (tbody) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="notif-table-empty-cell">' +
      '<div class="email-logs-skeleton" aria-hidden="true">' +
      '<div class="email-logs-skeleton-row"><span class="email-logs-skeleton-block email-logs-skeleton-id"></span><span class="email-logs-skeleton-block email-logs-skeleton-name"></span><span class="email-logs-skeleton-block email-logs-skeleton-email"></span><span class="email-logs-skeleton-block email-logs-skeleton-type"></span><span class="email-logs-skeleton-block email-logs-skeleton-status"></span><span class="email-logs-skeleton-block email-logs-skeleton-time"></span><span class="email-logs-skeleton-block email-logs-skeleton-action"></span></div>' +
      '<div class="email-logs-skeleton-row"><span class="email-logs-skeleton-block email-logs-skeleton-id"></span><span class="email-logs-skeleton-block email-logs-skeleton-name"></span><span class="email-logs-skeleton-block email-logs-skeleton-email"></span><span class="email-logs-skeleton-block email-logs-skeleton-type"></span><span class="email-logs-skeleton-block email-logs-skeleton-status"></span><span class="email-logs-skeleton-block email-logs-skeleton-time"></span><span class="email-logs-skeleton-block email-logs-skeleton-action"></span></div>' +
      '<div class="email-logs-skeleton-row"><span class="email-logs-skeleton-block email-logs-skeleton-id"></span><span class="email-logs-skeleton-block email-logs-skeleton-name"></span><span class="email-logs-skeleton-block email-logs-skeleton-email"></span><span class="email-logs-skeleton-block email-logs-skeleton-type"></span><span class="email-logs-skeleton-block email-logs-skeleton-status"></span><span class="email-logs-skeleton-block email-logs-skeleton-time"></span><span class="email-logs-skeleton-block email-logs-skeleton-action"></span></div>' +
      '</div><span class="sr-only">Loading email logs...</span></td></tr>';
    skeletonStart = Date.now();
  }

  fetch(url, { headers: { 'X-CSRFToken': getCSRFToken() } })
    .then(r => r.json())
    .then(function (data) {
      if (!data.success) return null;
      var delay = skeletonStart != null ? waitForMinDelay(skeletonStart) : Promise.resolve();
      return delay.then(function () { return data; });
    })
    .then(function (data) {
      if (!data) return;
      _emailLogsById = {};
      (data.logs || []).forEach(function (log) { _emailLogsById[log.id] = log; });

      // Update count badges
      const counts = data.status_counts || {};
      const setC = function (id, v) {
        const el = document.getElementById(id);
        if (el) el.textContent = v || 0;
      };
      setC('emailCountOnHold',  counts.on_hold);
      setC('emailCountPending', counts.pending);
      setC('emailCountSent',    counts.sent);
      setC('emailCountFailed',  counts.failed);

      const tBody = document.getElementById('emailLogsBody');
      if (!tBody) return;

      const logs = Array.isArray(data.logs) ? data.logs : [];
      const total = Number(data.total || 0);
      const totalPages = Math.max(1, Number(data.total_pages || 1));
      _emailTotal = total;
      _emailTotalPages = totalPages;
      if (_emailPage > _emailTotalPages) _emailPage = _emailTotalPages;

      if (!logs.length) {
        tBody.innerHTML =
          '<tr class="notif-table-empty"><td colspan="7">' +
          '<div class="empty-state"><i class="fa-solid fa-envelope-open"></i>' +
          '<p>No email logs found</p>' +
          '<span>Logs appear here after emails are sent</span></div></td></tr>';
      } else {
        const statusClassMap = { on_hold: 'on-hold', pending: 'pending', sent: 'sent', failed: 'failed' };
        tBody.innerHTML = logs.map(function (log, i) {
          const statusCls = statusClassMap[log.status] || '';
          const errorMeta = log.error_message
            ? '<div class="email-error-meta" title="' + escAttr(log.error_message) + '"><i class="fa-solid fa-circle-info"></i> Failed details</div>'
            : '';
          const actionHtml = _buildEmailActionButtons(log);
          return '<tr id="email-log-row-' + log.id + '">' +
            '<td class="text-center text-xs text-gray-400">' + (((_emailPage - 1) * _emailPerPage) + i + 1) + '</td>' +
            '<td><strong style="font-size:12.5px;color:#1e293b;">' + escHtml(log.recipient_name || '') + '</strong></td>' +
            '<td class="notif-time">' + escHtml(log.recipient_email) + '</td>' +
            '<td><span class="notif-badge-cat">' + escHtml(log.email_type_display) + '</span></td>' +
            '<td><span class="email-status-badge ' + statusCls + '" id="email-log-status-' + log.id + '">' + escHtml(log.status_display) + '</span></td>' +
            '<td class="notif-time">' + escHtml(log.created_at) + errorMeta + '</td>' +
            '<td id="email-log-action-' + log.id + '">' + actionHtml + '</td>' +
            '</tr>';
        }).join('');
      }

      _updateEmailPagination(total, totalPages, logs.length);
    })
    .catch(function (err) { console.error('Email logs load error:', err); });
};

window.emailLogPage = function (delta) {
  emailSetPage(_emailPage + Number(delta || 0));
};

window.resendEmail = async function (logId, emailType) {
  var isOtpType = emailType === 'otp_reset';
  var ok = await showConfirm({
    title: isOtpType ? 'Resend OTP Email?' : 'Resend Welcome Email?',
    text: isOtpType
      ? 'Send a fresh password reset OTP email for this entry?'
      : 'Resend welcome email for this log entry? A new temporary password will be generated for the user.',
    icon: 'fa-solid fa-paper-plane',
    confirmLabel: 'Resend',
    btnClass: 'btn-primary',
    hideWarning: true
  });
  if (!ok) return;
  const actionCell = document.getElementById('email-log-action-' + logId);
  if (actionCell) actionCell.innerHTML = '<div class="email-actions-stack"><button class="btn btn-sm btn-primary email-action-btn" disabled><i class="fa-solid fa-spinner fa-spin"></i> Sending</button></div>';
  fetch((window.EMAIL_RESEND_BASE_URL || '/api/email-resend/') + logId + '/', {
    method: 'POST',
    headers: { 'X-CSRFToken': getCSRFToken(), 'X-Requested-With': 'XMLHttpRequest' }
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.success) {
        const statusEl = document.getElementById('email-log-status-' + logId);
        if (statusEl) {
          var st = (data.new_status || '').toLowerCase();
          var cls = st === 'failed' ? 'failed' : (st === 'on_hold' ? 'on-hold' : (st === 'pending' ? 'pending' : 'sent'));
          statusEl.className = 'email-status-badge ' + cls;
          statusEl.textContent = data.new_status_display || 'Sent';
        }
        if (_emailLogsById[logId]) _emailLogsById[logId].status = (data.new_status || _emailLogsById[logId].status);
        if (actionCell) actionCell.innerHTML = _buildEmailActionButtons(_emailLogsById[logId] || { id: logId, email_type: emailType || 'system' });
        if (typeof showToast === 'function') showToast('Email resent successfully.', 'success');
      } else {
        if (actionCell) actionCell.innerHTML = _buildEmailActionButtons(_emailLogsById[logId] || { id: logId, email_type: emailType || (isOtpType ? 'otp_reset' : 'system') });
        if (typeof showToast === 'function') showToast(data.message || 'Resend failed.', 'error');
        else showToast(data.message || 'Resend failed.', 'error');
      }
    })
    .catch(function (err) {
      if (actionCell) actionCell.innerHTML = _buildEmailActionButtons(_emailLogsById[logId] || { id: logId, email_type: emailType || (isOtpType ? 'otp_reset' : 'system') });
      console.error('resendEmail error:', err);
    });
};

window.openNewEmailModal = async function () {
  const titleEl = document.getElementById('emailComposeTitle');
  const logIdEl = document.getElementById('emailComposeLogId');
  const nameEl = document.getElementById('emailComposeRecipientName');
  const emailEl = document.getElementById('emailComposeRecipientEmail');
  const typeEl = document.getElementById('emailComposeType');
  const subjectEl = document.getElementById('emailComposeSubject');
  const bodyTextEl = document.getElementById('emailComposeBodyText');
  const bodyHtmlEl = document.getElementById('emailComposeBodyHtml');
  if (!titleEl || !logIdEl || !nameEl || !emailEl || !subjectEl || !bodyTextEl || !bodyHtmlEl || !typeEl) return;

  _bindEmailComposePreview();

  titleEl.innerHTML = '<i class="fa-solid fa-envelope-open-text"></i> Add New Email';
  logIdEl.value = '';
  nameEl.value = '';
  emailEl.value = '';
  typeEl.value = 'system';
  subjectEl.value = _defaultEmailSubject('system');
  bodyTextEl.value = _defaultEmailBody('system', 'User');
  bodyHtmlEl.value = '';

  _renderEmailComposePreview();

  const modal = document.getElementById('emailComposeModal');
  if (modal) {
    if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
      window.AdarshModalBridge.open('emailComposeModal', { overlayClass: 'show' });
    } else {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  }
};

window.openEditEmailModal = function (logId) {
  const log = _emailLogsById[logId];
  if (!log) {
    if (typeof showToast === 'function') showToast('Email record not found. Please refresh.', 'error');
    return;
  }

  const titleEl = document.getElementById('emailComposeTitle');
  const logIdEl = document.getElementById('emailComposeLogId');
  const nameEl = document.getElementById('emailComposeRecipientName');
  const emailEl = document.getElementById('emailComposeRecipientEmail');
  const typeEl = document.getElementById('emailComposeType');
  const subjectEl = document.getElementById('emailComposeSubject');
  const bodyTextEl = document.getElementById('emailComposeBodyText');
  const bodyHtmlEl = document.getElementById('emailComposeBodyHtml');
  if (!titleEl || !logIdEl || !nameEl || !emailEl || !subjectEl || !bodyTextEl || !bodyHtmlEl || !typeEl) return;

  _bindEmailComposePreview();

  titleEl.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Edit & Resend Email';
  logIdEl.value = String(logId);
  nameEl.value = log.recipient_name || '';
  emailEl.value = log.recipient_email || '';
  typeEl.value = log.email_type || 'system';
  subjectEl.value = log.subject || '';
  bodyTextEl.value = (log.body_text && log.body_text.trim())
    ? log.body_text
    : ('Hello ' + (log.recipient_name || 'User') + ',\n\nThis is a follow-up message from Adarsh Admin.\n\nRegards,\nAdarsh Admin Team');
  bodyHtmlEl.value = log.body_html || '';

  _renderEmailComposePreview();

  const modal = document.getElementById('emailComposeModal');
  if (modal) {
    if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
      window.AdarshModalBridge.open('emailComposeModal', { overlayClass: 'show' });
    } else {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  }
};

window.closeEmailComposeModal = function () {
  const modal = document.getElementById('emailComposeModal');
  if (modal) {
    if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
      window.AdarshModalBridge.close('emailComposeModal', { overlayClass: 'show' });
    } else {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  }
};

window.submitEmailCompose = async function (event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  const logId = (document.getElementById('emailComposeLogId')?.value || '').trim();
  const payload = {
    recipient_name: (document.getElementById('emailComposeRecipientName')?.value || '').trim(),
    recipient_email: (document.getElementById('emailComposeRecipientEmail')?.value || '').trim(),
    email_type: _normalizeEmailType((document.getElementById('emailComposeType')?.value || 'system').trim()),
    subject: (document.getElementById('emailComposeSubject')?.value || '').trim(),
    body_text: (document.getElementById('emailComposeBodyText')?.value || '').trim(),
    body_html: '',
  };

  if (!payload.recipient_email || !payload.subject || !payload.body_text) {
    if (typeof showToast === 'function') showToast('Recipient email, subject, and message are required.', 'error');
    return false;
  }

  payload.body_html = _buildEmailTemplateHtml(payload, true);
  const bodyHtmlEl = document.getElementById('emailComposeBodyHtml');
  if (bodyHtmlEl) bodyHtmlEl.value = payload.body_html;

  const sendBtn = document.getElementById('emailComposeSendBtn');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
  }

  try {
    const isEdit = !!logId;
    const endpoint = isEdit
      ? ((window.EMAIL_RESEND_BASE_URL || '/api/email-resend/') + logId + '/')
      : (window.EMAIL_SEND_NEW_URL || '/api/email-send/');
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (data.success) {
      if (typeof showToast === 'function') showToast(data.message || 'Email sent successfully.', 'success');
      closeEmailComposeModal();
      loadEmailLogs(1);
    } else {
      if (typeof showToast === 'function') showToast(data.message || 'Failed to send email.', 'error');
    }
  } catch (err) {
    console.error('submitEmailCompose error:', err);
    if (typeof showToast === 'function') showToast('Network error while sending email.', 'error');
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Email';
    }
  }
  return false;
};

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  const modal = document.getElementById('emailComposeModal');
  if (modal && modal.style.display !== 'none' && modal.style.display !== '') {
    closeEmailComposeModal();
  }
});

/* ============ Tab switch hook  lazy-load data ============ */
const _origSwitchTab = switchTab;
switchTab = function(tabName) {
  _origSwitchTab(tabName);
  if (tabName === 'batch-jobs') window.loadManagePanelBatchJobProgressCenter(false);
  if (tabName === 'download-templates' && !panelTemplates.length) loadTemplates();
  if (tabName === 'log-history' && !operationsFeed.length) loadOperationsFeed();
  _syncOpsAutoRefresh(tabName === 'log-history');
  _syncBatchJobsAutoRefresh(tabName === 'batch-jobs');
};

/* ============ Monitoring (legacy alias -> Logs & Updates) ============ */

const STATUS_BADGE = {
  pending:    { color: '#92400e', bg: '#fef3c7', label: 'Pending' },
  processing: { color: '#1e40af', bg: '#dbeafe', label: 'Processing' },
  completed:  { color: '#166534', bg: '#dcfce7', label: 'Completed' },
  failed:     { color: '#991b1b', bg: '#fee2e2', label: 'Failed' },
  cancelled:  { color: '#374151', bg: '#f3f4f6', label: 'Cancelled' },
};

function _statusBadge(status, displayText) {
  const s = STATUS_BADGE[status] || { color: '#374151', bg: '#f3f4f6', label: displayText };
  const label = displayText || s.label;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;color:${s.color};background:${s.bg};">${escHtml(label)}</span>`;
}

async function loadMonitoring() {
  return loadOperationsFeed();
}

document.addEventListener('visibilitychange', function () {
  const activeTab = document.querySelector('.panel-tab.active')?.dataset?.tab;
  if (activeTab === 'log-history' && !document.hidden) {
    _syncOpsAutoRefresh(true);
    _syncBatchJobsAutoRefresh(false);
    return;
  }
  if (activeTab === 'batch-jobs' && !document.hidden) {
    _syncOpsAutoRefresh(false);
    _syncBatchJobsAutoRefresh(true);
    window.loadManagePanelBatchJobProgressCenter(false);
    return;
  }
  if (document.hidden) {
    _syncOpsAutoRefresh(false);
    _syncBatchJobsAutoRefresh(false);
  }
});


/* ============ Server Info Tab ============ */

const SERVER_INFO_DYNAMIC_VALUE_IDS = [
  'serverStoragePct',
  'serverDiskTotal',
  'serverDiskUsed',
  'serverDiskFree',
  'serverProjectTotal',
  'serverOtherUsed',
  'serverDiskTracked',
  'serverCpuCores',
  'serverMemoryUsed',
  'serverMemoryTotal',
  'serverMemoryPct',
  'serverDbBackend',
  'serverDbName',
  'serverDbSize',
  'serverDbStatus',
];

function _readServerInfoLocalCache() {
  try {
    const raw = localStorage.getItem(SERVER_INFO_LOCAL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const savedAt = Number(parsed && parsed.saved_at ? parsed.saved_at : 0);
    const snapshot = parsed && parsed.snapshot ? parsed.snapshot : null;
    if (!savedAt || !snapshot || typeof snapshot !== 'object') {
      localStorage.removeItem(SERVER_INFO_LOCAL_CACHE_KEY);
      return null;
    }
    if ((Date.now() - savedAt) > SERVER_INFO_LOCAL_CACHE_TTL_MS) {
      localStorage.removeItem(SERVER_INFO_LOCAL_CACHE_KEY);
      return null;
    }
    return snapshot;
  } catch (e) {
    return null;
  }
}

function _saveServerInfoLocalCache(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  try {
    localStorage.setItem(SERVER_INFO_LOCAL_CACHE_KEY, JSON.stringify({
      saved_at: Date.now(),
      snapshot,
    }));
  } catch (e) {
    // localStorage may be unavailable in strict privacy mode
  }
}

function _syncServerInfoButtons() {
  const fetchBtn = document.getElementById('serverInfoFetchBtn');
  const refreshBtn = document.getElementById('serverInfoRefreshBtn');

  if (fetchBtn) {
    fetchBtn.disabled = false;
    fetchBtn.innerHTML = '<i class="fa-solid fa-download"></i> Fetch Snapshot';
    fetchBtn.style.display = serverInfoSnapshot ? 'none' : '';
  }

  if (refreshBtn) {
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh Latest';
    refreshBtn.style.display = serverInfoSnapshot ? '' : 'none';
  }
}

function buildServerInfoListSkeleton(sectionLabel) {
  const safeLabel = escHtml(sectionLabel || 'Loading');
  return (
    '<div class="server-list-skeleton" role="status" aria-label="' + safeLabel + '">' +
      '<div class="server-list-skeleton-row">' +
        '<span class="server-list-skeleton-block server-list-skeleton-title"></span>' +
        '<span class="server-list-skeleton-block server-list-skeleton-size"></span>' +
      '</div>' +
      '<span class="server-list-skeleton-block server-list-skeleton-bar"></span>' +
      '<span class="server-list-skeleton-block server-list-skeleton-meta"></span>' +
    '</div>' +
    '<div class="server-list-skeleton" aria-hidden="true">' +
      '<div class="server-list-skeleton-row">' +
        '<span class="server-list-skeleton-block server-list-skeleton-title"></span>' +
        '<span class="server-list-skeleton-block server-list-skeleton-size"></span>' +
      '</div>' +
      '<span class="server-list-skeleton-block server-list-skeleton-bar"></span>' +
      '<span class="server-list-skeleton-block server-list-skeleton-meta"></span>' +
    '</div>' +
    '<div class="server-list-skeleton" aria-hidden="true">' +
      '<div class="server-list-skeleton-row">' +
        '<span class="server-list-skeleton-block server-list-skeleton-title"></span>' +
        '<span class="server-list-skeleton-block server-list-skeleton-size"></span>' +
      '</div>' +
      '<span class="server-list-skeleton-block server-list-skeleton-bar"></span>' +
      '<span class="server-list-skeleton-block server-list-skeleton-meta"></span>' +
    '</div>'
  );
}

function setServerInfoLoadingState(isLoading, options) {
  const opts = options || {};
  const initialLoad = !!opts.initialLoad;
  const tabRoot = document.getElementById('tab-server-info');
  const contentShell = document.getElementById('serverInfoContentShell');
  const donutWrap = document.querySelector('.server-donut-wrap');
  const rows = document.getElementById('serverInfoPathRows');
  const otherRows = document.getElementById('serverOtherBreakdownRows');

  if (tabRoot) {
    tabRoot.classList.toggle('is-loading', !!isLoading);
  }
  if (contentShell) {
    contentShell.classList.toggle('is-loading', !!isLoading && initialLoad);
  }
  if (donutWrap) {
    donutWrap.classList.toggle('is-loading', !!isLoading && initialLoad);
  }

  SERVER_INFO_DYNAMIC_VALUE_IDS.forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('server-value-skeleton', !!isLoading && initialLoad);
  });

  if (isLoading) {
    if (rows) rows.innerHTML = buildServerInfoListSkeleton('Loading panel usage details');
    if (otherRows) otherRows.innerHTML = buildServerInfoListSkeleton('Loading system usage details');
  }
}

function initServerInfoTab() {
  const rows = document.getElementById('serverInfoPathRows');
  const otherRows = document.getElementById('serverOtherBreakdownRows');
  if (!rows || !otherRows) return;

  if (!serverInfoSnapshot) {
    const cachedSnapshot = _readServerInfoLocalCache();
    if (cachedSnapshot) {
      serverInfoSnapshot = cachedSnapshot;
      serverInfoHasFetched = true;
    }
  }

  if (serverInfoSnapshot) {
    renderServerInfo(serverInfoSnapshot, true);
    _syncServerInfoButtons();
    return;
  }

  if (!serverInfoHasFetched) {
    rows.innerHTML = `<div class="empty-state" style="padding:18px 16px;"><i class="fa-solid fa-cloud-arrow-down"></i><p>Snapshot not loaded</p><span>Click "Fetch Snapshot" to load current server usage.</span></div>`;
    otherRows.innerHTML = `<div class="empty-state" style="padding:18px 16px;"><i class="fa-solid fa-layer-group"></i><p>System usage details not loaded</p><span>Fetch snapshot to load system usage categories.</span></div>`;
  }

  _syncServerInfoButtons();
}

async function loadServerInfo(forceRefresh) {
  if (serverInfoLoading) return;

  const fetchBtn = document.getElementById('serverInfoFetchBtn');
  const refreshBtn = document.getElementById('serverInfoRefreshBtn');
  const rows = document.getElementById('serverInfoPathRows');
  if (!rows) return;

  if (!forceRefresh && !serverInfoSnapshot) {
    const cachedSnapshot = _readServerInfoLocalCache();
    if (cachedSnapshot) {
      serverInfoSnapshot = cachedSnapshot;
      serverInfoHasFetched = true;
      renderServerInfo(serverInfoSnapshot, true);
      _syncServerInfoButtons();
      return;
    }
  }

  serverInfoLoading = true;
  serverInfoHasFetched = true;
  let loadedSuccessfully = false;
  const isInitialLoad = !serverInfoSnapshot;
  const skeletonStart = Date.now();
  setServerInfoLoadingState(true, { initialLoad: isInitialLoad });

  if (fetchBtn) {
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
  }
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing...';
  }

  try {
    const qs = forceRefresh ? '?force_refresh=1' : '';
    const res = await fetch('/api/server-info/' + qs);
    if (!res.ok) {
      window.showToast && showToast('Failed to load server info', 'error');
      return;
    }

    const data = await res.json();
    if (!data.success || !data.snapshot) {
      window.showToast && showToast('Server info is unavailable right now', 'error');
      return;
    }

    serverInfoSnapshot = data.snapshot;
    _saveServerInfoLocalCache(serverInfoSnapshot);
    renderServerInfo(serverInfoSnapshot, data.cached === true);
    loadedSuccessfully = true;
  } catch (err) {
    console.error('Server info load error:', err);
    window.showToast && showToast('Unable to fetch server info', 'error');
  } finally {
    await waitForPanelSkeletonDelay(skeletonStart);
    serverInfoLoading = false;
    setServerInfoLoadingState(false, { initialLoad: false });

    if (!loadedSuccessfully) {
      if (serverInfoSnapshot) {
        renderServerInfo(serverInfoSnapshot, true);
      } else {
        initServerInfoTab();
      }
    }

    _syncServerInfoButtons();
  }
}

function renderServerInfo(snapshot, fromCache) {
  const storage = snapshot.storage || {};
  const database = snapshot.database || {};
  const systemUsageDetails = Array.isArray(snapshot.system_usage_details) ? snapshot.system_usage_details : [];
  const panelUsageDetails = Array.isArray(snapshot.panel_usage_details) ? snapshot.panel_usage_details : [];
  const memory = snapshot.memory || {};
  const cpu = snapshot.cpu || {};
  const rows = document.getElementById('serverInfoPathRows');
  const otherRows = document.getElementById('serverOtherBreakdownRows');
  if (!rows || !otherRows) return;

  const formatBytesHuman = (sizeBytes) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let value = Number(sizeBytes || 0);
    if (!Number.isFinite(value) || value < 0) value = 0;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    return `${value.toFixed(1)} ${units[idx]}`;
  };

  const setUsageTotalBadge = (id, totalBytes) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (totalBytes == null) {
      el.textContent = 'Total Used: -';
      return;
    }
    el.textContent = `Total Used: ${formatBytesHuman(totalBytes)}`;
  };

  const systemTotalBytes = systemUsageDetails.reduce((acc, item) => {
    return acc + Number((item && item.size_bytes) || 0);
  }, 0);
  const panelTotalBytes = panelUsageDetails.reduce((acc, item) => {
    return acc + Number((item && item.size_bytes) || 0);
  }, 0);
  setUsageTotalBadge('serverSystemUsageTotalBadge', systemUsageDetails.length ? systemTotalBytes : null);
  setUsageTotalBadge('serverPanelUsageTotalBadge', panelUsageDetails.length ? panelTotalBytes : null);

  const usedPct = Number(storage.used_pct || 0);
  const donut = document.getElementById('serverStorageDonut');
  const donutPct = document.getElementById('serverStoragePct');
  if (donut) donut.style.setProperty('--pct', String(usedPct));
  if (donutPct) donutPct.textContent = `${usedPct.toFixed(1)}%`;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value == null || value === '' ? '-' : String(value);
  };

  setText('serverDiskTotal', storage.total_human || '-');
  setText('serverDiskUsed', storage.used_human || '-');
  setText('serverDiskFree', storage.free_human || '-');
  setText('serverDiskTracked', storage.tracked_total_human || '-');
  setText('serverProjectTotal', storage.project_total_human || '-');
  setText('serverDatabaseTotal', storage.database_total_human || '-');
  setText('serverOtherUsed', storage.other_system_used_human || '-');
  setText('serverCpuCores', cpu.logical_cores || '-');
  setText('serverMemoryUsed', memory.used_human || '-');
  setText('serverMemoryTotal', memory.total_human || '-');
  setText('serverMemoryPct', (memory.used_pct != null ? `${memory.used_pct}%` : '-'));
  setText('serverDbBackend', database.backend || '-');
  setText('serverDbName', database.name || '-');
  setText('serverDbSize', database.size_human || '-');
  setText('serverDbStatus', database.status || '-');

  const updatedEl = document.getElementById('serverInfoLastUpdated');
  if (updatedEl) {
    const cacheText = fromCache ? ' (cached up to 24h)' : '';
    updatedEl.textContent = `Last fetched: ${snapshot.fetched_at_human || '-'}${cacheText}`;
  }

  if (!systemUsageDetails.length) {
    otherRows.innerHTML = `<div class="empty-state" style="padding:18px 16px;"><i class="fa-solid fa-layer-group"></i><p>System usage details unavailable</p><span>No system usage categories could be estimated.</span></div>`;
  } else {
    otherRows.innerHTML = systemUsageDetails.map(item => {
      const pctValue = Number(item.pct_of_used_disk || 0);
      return `<div class="server-path-row">
        <div class="server-path-main">
          <div class="server-path-name">${escHtml(item.name || '')}</div>
          <div class="server-path-size">${escHtml(item.size_human || '-')}</div>
        </div>
        <div class="server-path-bar-bg"><div class="server-path-bar-fill" style="width:${Math.max(0, Math.min(100, pctValue))}%;"></div></div>
        <div class="server-path-meta">${pctValue.toFixed(1)}% of used disk${item.meta ? ` | ${escHtml(item.meta)}` : ''}</div>
      </div>`;
    }).join('');
  }

  if (!panelUsageDetails.length) {
    rows.innerHTML = `<div class="empty-state" style="padding:18px 16px;"><i class="fa-solid fa-folder-open"></i><p>Panel usage details unavailable</p><span>No panel usage breakdown could be estimated.</span></div>`;
    return;
  }

  rows.innerHTML = panelUsageDetails.map(item => {
    const pctProject = Number(item.pct_of_project || 0);
    return `<div class="server-path-row">
      <div class="server-path-main">
        <div class="server-path-name">${escHtml(item.name || '')}</div>
        <div class="server-path-size">${escHtml(item.size_human || '-')}</div>
      </div>
      <div class="server-path-bar-bg"><div class="server-path-bar-fill" style="width:${Math.max(0, Math.min(100, pctProject))}%;"></div></div>
      <div class="server-path-meta">${pctProject.toFixed(1)}% of project usage${item.meta ? ` | ${escHtml(item.meta)}` : ''}</div>
    </div>`;
  }).join('');

  if (database.status === 'error' && database.error) {
    window.showToast && showToast(`DB size read failed: ${database.error}`, 'warning');
  }
}

