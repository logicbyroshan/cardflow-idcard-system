/**
 * Manage Panel  Notification Management JS
 * Handles: CRUD notifications, tab switching, user picker, search
 */

/* ============ State ============ */
let panelNotifications = [];
let panelOffset = 0;
const PANEL_LIMIT = 20;
let panelTotal = 0;
let allUsers = {};       // { role: [{id, name, username, role_display}] }
let selectedUserIds = new Set();
let searchTimer = null;
let serverInfoSnapshot = null;
let serverInfoHasFetched = false;
let serverInfoLoading = false;
const MANAGE_PANEL_TAB_KEY = 'managePanel:lastTab';

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

/* ============ Init ============ */
document.addEventListener('DOMContentLoaded', function() {
  const restoredTab = _restoreManagePanelTabOnReload();
  if (!restoredTab || restoredTab === 'notifications') {
    loadNotifications();
  } else if (restoredTab === 'download-templates') {
    loadTemplates();
  } else if (restoredTab === 'log-history') {
    loadOperationsFeed(false);
  } else if (restoredTab === 'email-logs') {
    loadEmailLogs(1);
  } else if (restoredTab === 'server-info') {
    initServerInfoTab();
  } else if (restoredTab === 'maintenance' && typeof loadMaintenanceStatus === 'function') {
    loadMaintenanceStatus();
  }
});

/* ============ Tabs ============ */
function switchTab(tabName) {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  // Also strip inline display overrides so the CSS .active rule always wins
  document.querySelectorAll('.panel-tab-content').forEach(c => {
    c.classList.remove('active');
    c.style.removeProperty('display');
  });
  const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
  const tabPane = document.getElementById(`tab-${tabName}`);
  if (tabBtn) tabBtn.classList.add('active');
  if (tabPane) tabPane.classList.add('active');
  if (tabName === 'notifications' && typeof loadMaintenanceStatus === 'function') {
    loadMaintenanceStatus();
  }
  _saveManagePanelTab(tabName);
}

/* ============ Load Notifications ============ */
async function loadNotifications(append) {
  if (!append) panelOffset = 0;
  try {
    const search = document.getElementById('notifSearch')?.value || '';
    const res = await fetch(`/api/notifications/admin/list/?limit=${PANEL_LIMIT}&offset=${panelOffset}&search=${encodeURIComponent(search)}`);
    if (!res.ok) { console.error('Failed to load notifications: HTTP', res.status); return; }
    const data = await res.json();
    if (!data.success) return;

    if (append) {
      panelNotifications = panelNotifications.concat(data.notifications);
    } else {
      panelNotifications = data.notifications;
    }
    panelTotal = data.total;

    // Cache server-side aggregate stats so updateStats() is accurate
    if (data.stats) window._panelNotifStats = data.stats;

    renderTable();
    updateStats();
    var totalEl = document.getElementById('totalNotifCount');
    if (totalEl) totalEl.textContent = panelTotal;

    const loadMoreEl = document.getElementById('notifLoadMore');
    if (loadMoreEl) {
      loadMoreEl.style.display = panelNotifications.length < panelTotal ? '' : 'none';
    }
  } catch (err) {
    console.error('Failed to load notifications:', err);
  }
}

function loadMoreNotifications() {
  panelOffset += PANEL_LIMIT;
  loadNotifications(true);
}

/* ============ Render Table ============ */
function renderTable() {
  const tbody = document.getElementById('notifTableBody');
  if (!panelNotifications.length) {
    tbody.innerHTML = `<tr class="notif-table-empty"><td colspan="7">
      <div class="empty-state">
        <i class="fa-solid fa-bell-slash"></i>
        <p>No notifications yet</p>
        <span>Create your first notification to get started</span>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = panelNotifications.map(n => {
    const msgPreview = n.message.length > 60 ? n.message.substring(0, 60) + '...' : n.message;
    return `<tr>
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
          <button class="btn btn-icon btn-danger" title="Delete" onclick="deleteNotification(${n.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function updateStats() {
  document.getElementById('statTotal').textContent = panelTotal;
  // Use server-side aggregates (returned by API) for accurate full-dataset counts
  const s = window._panelNotifStats || {};
  document.getElementById('statBroadcast').textContent = s.broadcast != null ? s.broadcast : 0;
  document.getElementById('statTargeted').textContent  = s.targeted  != null ? s.targeted  : 0;
  document.getElementById('statUrgent').textContent    = s.urgent    != null ? s.urgent    : 0;
}

/* ============ Search ============ */
function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadNotifications(false), 350);
}

/* ============ Delete ============ */
let _panelConfirmCallback = null;

function _panelConfirm(title, message, onConfirm) {
  const modal = document.getElementById('panelDeleteConfirmModal');
  const titleEl = document.getElementById('panelConfirmTitleText');
  const msgEl = document.getElementById('panelConfirmMessage');
  const okBtn = document.getElementById('panelConfirmOkBtn');
  if (!modal) { if (onConfirm) onConfirm(); return; }
  titleEl.textContent = title;
  msgEl.textContent = message;
  _panelConfirmCallback = onConfirm;
  modal.style.display = 'flex';
  okBtn.focus();
}

window.closePanelConfirmModal = function () {
  const modal = document.getElementById('panelDeleteConfirmModal');
  if (modal) modal.style.display = 'none';
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
      if (m && m.style.display !== 'none') closePanelConfirmModal();
    }
  });
});

async function deleteNotification(id) {
  _panelConfirm(
    'Delete Notification',
    'Delete this notification? It will no longer be visible to users.',
    async function () {
      try {
        const res = await fetch(`/api/notifications/admin/${id}/delete/`, {
          method: 'DELETE',
          headers: { 'X-CSRFToken': getCSRFToken() },
        });
        if (!res.ok) { if (window.showToast) showToast('Delete failed (HTTP ' + res.status + ')', 'error'); return; }
        const data = await res.json();
        if (data.success) {
          if (window.showToast) showToast('Notification deleted', 'success');
          loadNotifications(false);
        } else {
          if (window.showToast) showToast(data.message || 'Failed', 'error');
        }
      } catch (err) {
        console.error('Delete failed:', err);
      }
    }
  );
}

/* ============ Create Modal ============ */
function openCreateModal() {
  document.getElementById('createNotifModal').classList.add('show');
  document.getElementById('createNotifForm').reset();
  document.getElementById('userPickerWrap').style.display = 'none';
  selectedUserIds.clear();
  renderSelectedChips();
  document.body.style.overflow = 'hidden';
}

function closeCreateModal() {
  document.getElementById('createNotifModal').classList.remove('show');
  document.body.style.overflow = '';
}

/* Escape key */
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeCreateModal();
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
    admin_staff: 'Admin Staff',
    client: 'Client',
    client_staff: 'Client Staff',
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
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Notification';
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


/* ================================================================
   DOWNLOAD TEMPLATES TAB
   ================================================================ */
let panelTemplates = [];
let _templateBoldState = false;

/* Live-preview: update textarea font based on language + bold selection */
function _syncTemplatePreviewFont() {
  const ta = document.getElementById('templateInstructions');
  const sel = document.getElementById('templateFontName');
  if (!ta || !sel) return;
  const isHindi = sel.value === 'hindi';
  ta.style.fontFamily = isHindi ? "'AbbasiNatraj', 'AbbasiNagari', sans-serif" : "Arial, sans-serif";
  ta.style.fontWeight = _templateBoldState ? 'bold' : 'normal';
  ta.style.fontSize = isHindi ? '15px' : '13px';
}

function _syncTemplateBoldBtn() {
  const btn = document.getElementById('templateBoldBtn');
  if (!btn) return;
  btn.style.background = _templateBoldState ? '#4f46e5' : '';
  btn.style.color = _templateBoldState ? '#fff' : '';
}

function toggleTemplateBold() {
  _templateBoldState = !_templateBoldState;
  _syncTemplateBoldBtn();
  _syncTemplatePreviewFont();
}

/* Attach font selector change listener once DOM is ready */
document.addEventListener('DOMContentLoaded', function () {
  var sel = document.getElementById('templateFontName');
  if (sel) sel.addEventListener('change', _syncTemplatePreviewFont);
});

async function loadTemplates() {
  try {
    const res = await fetch('/api/export-templates/');
    if (!res.ok) return;
    const data = await res.json();
    if (data.success) {
      panelTemplates = data.templates || [];
      renderTemplateTable();
    }
  } catch (err) { console.error('loadTemplates:', err); }
}

function renderTemplateTable() {
  const tbody = document.getElementById('templateTableBody');
  if (!tbody) return;
  if (!panelTemplates.length) {
    tbody.innerHTML = `<tr class="notif-table-empty"><td colspan="6">
      <div class="empty-state"><i class="fa-solid fa-file-lines"></i>
      <p>No templates yet</p><span>Create your first export template</span></div></td></tr>`;
    return;
  }
  tbody.innerHTML = panelTemplates.map((t, i) => {
    const preview = t.instructions.length > 80 ? t.instructions.substring(0, 80) + '...' : t.instructions;
    const fontLabel = t.font_name === 'hindi' ? 'Hindi' : 'Arial';
    const boldLabel = t.is_bold ? '  <b>Bold</b>' : '';
    return `<tr>
      <td class="text-center text-xs text-gray-400">${i + 1}</td>
      <td><strong class="text-sm">${escHtml(t.name)}</strong><br><span class="text-xs text-gray-400">${fontLabel}${boldLabel}</span></td>
      <td><span class="text-xs text-gray-600">${escHtml(preview)}</span></td>
      <td class="text-center">${t.is_default ? '<span class="notif-badge-priority normal">Default</span>' : ''}</td>
      <td class="text-center text-xs text-gray-400">${t.created_at ? new Date(t.created_at).toLocaleDateString() : ''}</td>
      <td>
        <div class="notif-actions-cell">
          <button class="btn btn-icon btn-neutral" title="Edit" onclick="editTemplate(${t.id})"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-icon btn-danger" title="Delete" onclick="deleteTemplate(${t.id})"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openCreateTemplateModal() {
  document.getElementById('templateEditId').value = '';
  document.getElementById('templateName').value = '';
  document.getElementById('templateInstructions').value = '';
  document.getElementById('templateIsDefault').checked = false;
  document.getElementById('templateFontName').value = 'arial';
  _templateBoldState = false;
  _syncTemplateBoldBtn();
  _syncTemplatePreviewFont();
  document.getElementById('templateModalTitle').innerHTML = '<i class="fa-solid fa-file-lines"></i> New Template';
  document.getElementById('templateModal').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function editTemplate(id) {
  const t = panelTemplates.find(x => x.id === id);
  if (!t) return;
  document.getElementById('templateEditId').value = id;
  document.getElementById('templateName').value = t.name;
  document.getElementById('templateInstructions').value = t.instructions;
  document.getElementById('templateIsDefault').checked = t.is_default;
  document.getElementById('templateFontName').value = t.font_name || 'arial';
  _templateBoldState = !!t.is_bold;
  _syncTemplateBoldBtn();
  _syncTemplatePreviewFont();
  document.getElementById('templateModalTitle').innerHTML = '<i class="fa-solid fa-file-lines"></i> Edit Template';
  document.getElementById('templateModal').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeTemplateModal() {
  document.getElementById('templateModal').classList.remove('show');
  document.body.style.overflow = '';
}

async function saveTemplate() {
  const editId = document.getElementById('templateEditId').value;
  const name = document.getElementById('templateName').value.trim();
  const instructions = document.getElementById('templateInstructions').value.trim();
  const is_default = document.getElementById('templateIsDefault').checked;
  const font_name = document.getElementById('templateFontName').value;
  const is_bold = _templateBoldState;

  if (!name) { if (window.showToast) showToast('Template name is required', 'error'); return; }
  if (!instructions) { if (window.showToast) showToast('Instructions text is required', 'error'); return; }

  const url = editId
    ? `/api/export-templates/${editId}/update/`
    : '/api/export-templates/create/';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
      body: JSON.stringify({ name, instructions, is_default, font_name, is_bold }),
    });
    const data = await res.json();
    if (data.success) {
      if (window.showToast) showToast(editId ? 'Template updated' : 'Template created', 'success');
      closeTemplateModal();
      loadTemplates();
    } else {
      if (window.showToast) showToast(data.message || 'Failed', 'error');
    }
  } catch (err) {
    console.error('saveTemplate:', err);
    if (window.showToast) showToast('Network error', 'error');
  }
}

async function deleteTemplate(id) {
  _panelConfirm(
    'Delete Template',
    'Delete this template? This action cannot be undone.',
    async function () {
      try {
        const res = await fetch(`/api/export-templates/${id}/delete/`, {
          method: 'DELETE',
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
   OPERATIONS HUB TAB (Monitoring + Logs)
   ================================================================ */
let operationsFeed = [];
const OPS_LIMIT = 180;
let operationsTotal = 0;
let opsSearchTimer = null;
let opsAutoRefreshTimer = null;

function populateOpsClientFilter(clients) {
  const select = document.getElementById('opsClientFilter');
  if (!select) return;

  const selectedValue = String(select.value || '');
  const rows = Array.isArray(clients) ? clients : [];
  let optionsHtml = '<option value="">All Clients</option>';

  optionsHtml += rows.map((client) => {
    const id = String(client.id || '');
    if (!id) return '';
    const suffix = client.status ? ` (${client.status})` : '';
    return `<option value="${id}">${escHtml(client.name || 'Client')}${escHtml(suffix)}</option>`;
  }).join('');

  select.innerHTML = optionsHtml;
  if (selectedValue && rows.some((c) => String(c.id) === selectedValue)) {
    select.value = selectedValue;
  }
}

function handleOpsSourceChange() {
  const source = document.getElementById('opsSourceFilter')?.value || 'all';
  const taskStatusFilter = document.getElementById('opsTaskStatusFilter');
  const actionFilter = document.getElementById('opsActionFilter');
  const userRoleFilter = document.getElementById('opsUserTypeFilter');
  const clientFilter = document.getElementById('opsClientFilter');
  const clientMode = source === 'client_logs';

  if (taskStatusFilter) {
    const taskOnly = source === 'tasks' || source === 'backups';
    taskStatusFilter.disabled = source === 'logs' || clientMode;
    taskStatusFilter.style.opacity = source === 'logs' || clientMode ? '0.65' : '1';
    if (!taskOnly) taskStatusFilter.value = '';
  }

  if (actionFilter) {
    const disableAction = source === 'tasks' || source === 'backups' || clientMode;
    actionFilter.disabled = disableAction;
    actionFilter.style.opacity = disableAction ? '0.65' : '1';
    if (source !== 'logs' && !clientMode) actionFilter.value = '';
    if (clientMode) actionFilter.value = '';
  }

  if (userRoleFilter) {
    userRoleFilter.disabled = clientMode;
    userRoleFilter.style.opacity = clientMode ? '0.65' : '1';
    if (clientMode) userRoleFilter.value = '';
  }

  if (clientFilter) {
    clientFilter.disabled = !clientMode;
    clientFilter.style.opacity = clientMode ? '1' : '0.65';
    if (!clientMode) clientFilter.value = '';
  }

  loadOperationsFeed();
}

function resetOperationsFilters() {
  const ids = ['opsSearch', 'opsSourceFilter', 'opsClientFilter', 'opsUserTypeFilter', 'opsTaskStatusFilter', 'opsActionFilter'];
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
  opsSearchTimer = setTimeout(() => loadOperationsFeed(false), 300);
}

function _opsSourceBadge(sourceType, sourceLabel) {
  const label = sourceLabel || 'Event';
  const cls = sourceType === 'background_task'
    ? 'ops-source-badge task'
    : sourceType === 'backup_task'
      ? 'ops-source-badge backup'
      : sourceType === 'client_activity_log'
        ? 'ops-source-badge client'
        : 'ops-source-badge log';
  const icon = sourceType === 'background_task'
    ? 'fa-gears'
    : sourceType === 'backup_task'
      ? 'fa-database'
      : sourceType === 'client_activity_log'
        ? 'fa-building-user'
      : 'fa-clock-rotate-left';
  return `<span class="${cls}"><i class="fa-solid ${icon}"></i> ${escHtml(label)}</span>`;
}

function _opsStatusCell(item) {
  if (item.source_type === 'activity_log') {
    return `<span class="log-action-badge ${item.icon_color || 'edit'}"><i class="fa-solid ${item.icon_class || 'fa-circle-info'}"></i> ${escHtml(item.action_display || item.action || 'Event')}</span>`;
  }
  return _statusBadge(item.status, item.status_display || item.status || 'Unknown');
}

function renderOperationsTable() {
  const tbody = document.getElementById('opsTableBody');
  if (!tbody) return;
  if (!operationsFeed.length) {
    tbody.innerHTML = `<tr class="notif-table-empty"><td colspan="7">
      <div class="empty-state"><i class="fa-solid fa-wave-square"></i>
      <p>No operations found</p><span>Adjust filters or wait for new activity.</span></div></td></tr>`;
    return;
  }

  tbody.innerHTML = operationsFeed.map((item, i) => {
    const detailMain = item.description || item.current_client || item.target_name || '';
    const detailMeta = [];
    if (item.target_name) detailMeta.push(`Target: ${item.target_name}`);
    if (item.progress_text) detailMeta.push(item.progress_text);
    if (item.ip_address) detailMeta.push(`IP: ${item.ip_address}`);
    if (item.error) detailMeta.push(`Error: ${item.error}`);

    return `<tr>
      <td class="text-center text-xs text-gray-400">${i + 1}</td>
      <td>${_opsSourceBadge(item.source_type, item.source_label)}</td>
      <td>
        <div class="ops-event-title">${escHtml(item.event_title || '-')}</div>
        <div class="ops-event-sub">${escHtml(item.event_subtitle || '')}</div>
      </td>
      <td>${_opsStatusCell(item)}</td>
      <td><span class="text-xs font-medium">${escHtml(item.user || 'System')}</span></td>
      <td>
        <div class="ops-detail-main">${escHtml(detailMain || '-')}</div>
        <div class="ops-detail-meta">${escHtml(detailMeta.join(' | '))}</div>
      </td>
      <td>
        <span class="notif-time">${escHtml(item.created_at || '')}</span>
        <div class="ops-time-sub">${escHtml(item.time_ago || '')}</div>
      </td>
    </tr>`;
  }).join('');
}

async function loadOperationsFeed() {
  const refreshBtn = document.getElementById('opsRefreshBtn');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Loading';
  }

  try {
    const search = document.getElementById('opsSearch')?.value || '';
    const source = document.getElementById('opsSourceFilter')?.value || 'all';
    const clientMode = source === 'client_logs';
    const clientId = document.getElementById('opsClientFilter')?.value || '';
    const userRole = clientMode ? '' : (document.getElementById('opsUserTypeFilter')?.value || '');
    const taskStatus = clientMode ? '' : (document.getElementById('opsTaskStatusFilter')?.value || '');
    const action = clientMode ? '' : (document.getElementById('opsActionFilter')?.value || '');

    const taskStatusFilter = document.getElementById('opsTaskStatusFilter');
    const actionFilter = document.getElementById('opsActionFilter');
    const userRoleFilter = document.getElementById('opsUserTypeFilter');
    const clientFilter = document.getElementById('opsClientFilter');
    if (taskStatusFilter) {
      taskStatusFilter.disabled = source === 'logs' || clientMode;
      taskStatusFilter.style.opacity = source === 'logs' || clientMode ? '0.65' : '1';
    }
    if (actionFilter) {
      const disableAction = source === 'tasks' || source === 'backups' || clientMode;
      actionFilter.disabled = disableAction;
      actionFilter.style.opacity = disableAction ? '0.65' : '1';
    }
    if (userRoleFilter) {
      userRoleFilter.disabled = clientMode;
      userRoleFilter.style.opacity = clientMode ? '0.65' : '1';
    }
    if (clientFilter) {
      clientFilter.disabled = !clientMode;
      clientFilter.style.opacity = clientMode ? '1' : '0.65';
    }

    let url = `/api/operations-feed/?limit=${OPS_LIMIT}&offset=0&source=${encodeURIComponent(source)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (userRole) url += `&user_role=${encodeURIComponent(userRole)}`;
    if (taskStatus) url += `&task_status=${encodeURIComponent(taskStatus)}`;
    if (action) url += `&action=${encodeURIComponent(action)}`;
    if (clientMode && clientId) url += `&client_id=${encodeURIComponent(clientId)}`;

    const res = await fetch(url);
    if (!res.ok) {
      console.error('loadOperationsFeed HTTP', res.status);
      return;
    }
    const data = await res.json();
    if (!data.success) return;

    operationsFeed = data.items || [];
    operationsTotal = data.total || operationsFeed.length;
    if (Array.isArray(data.clients)) {
      populateOpsClientFilter(data.clients);
      if (clientMode && clientId) {
        const clientEl = document.getElementById('opsClientFilter');
        if (clientEl) clientEl.value = clientId;
      }
    }

    const stats = data.stats || {};
    const sourceCounts = data.source_counts || {};
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value != null ? value : 0;
    };
    setText('opsStatActiveTasks', stats.active_tasks || 0);
    setText('opsStatPendingTasks', stats.pending_tasks || 0);
    setText('opsStatCompleted24h', stats.completed_24h || 0);
    setText('opsStatFailed24h', stats.failed_24h || 0);
    setText('opsCountTasks', sourceCounts.background_task || 0);
    setText('opsCountBackups', sourceCounts.backup_task || 0);
    setText('opsCountLogs', sourceCounts.activity_log || 0);

    const label = document.getElementById('opsCountLabel');
    if (label) label.textContent = `${operationsFeed.length} of ${operationsTotal} events`;

    const updatedEl = document.getElementById('opsLastUpdated');
    if (updatedEl) {
      updatedEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
    }
    const sortHintEl = document.getElementById('opsSortHint');
    if (sortHintEl) sortHintEl.textContent = 'Newest First';

    renderOperationsTable();
  } catch (err) {
    console.error('loadOperationsFeed:', err);
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
let _emailLogsById = {};
let _emailComposePreviewBound = false;

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
    'body{margin:0;padding:0;background:#eef2f7;font-family:Segoe UI,Arial,sans-serif;color:#0f172a}' +
    '.mail-shell{width:100%;padding:24px 12px;background:#eef2f7}' +
    '.mail-card{width:100%;max-width:1200px;min-width:300px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ef;border-radius:18px;overflow:hidden}' +
    '.mail-header{padding:26px 26px 22px;background:' + cfg.gradient + ';color:#fff}' +
    '.mail-badge{display:inline-block;padding:6px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:rgba(255,255,255,.2);margin-bottom:14px}' +
    '.mail-title{margin:0;font-size:26px;line-height:1.2;font-weight:700}' +
    '.mail-sub{margin:8px 0 0;font-size:14px;opacity:.95}' +
    '.mail-body{padding:28px 26px 24px}' +
    '.mail-meta{border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;padding:14px 16px;margin:0 0 18px}' +
    '.mail-meta-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:0 0 5px;font-weight:700}' +
    '.mail-meta-value{font-size:14px;color:#0f172a;font-weight:600;word-break:break-word;margin:0}' +
    '.mail-message{border:1px solid #e2e8f0;border-left:4px solid ' + cfg.accent + ';background:#ffffff;border-radius:12px;padding:16px 16px 2px;font-size:15px;color:#334155}' +
    '.mail-footer{padding:16px 26px 22px;border-top:1px solid #e5e7eb;background:#f8fafc;font-size:12px;color:#64748b}' +
    '.mail-footer p{margin:0 0 4px}' +
    '@media (max-width:760px){.mail-shell{padding:12px 8px}.mail-card{min-width:300px;border-radius:14px}.mail-header{padding:18px 16px}.mail-title{font-size:21px}.mail-body{padding:18px 16px}.mail-footer{padding:14px 16px}}' +
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

window.loadEmailLogs = function (page) {
  if (page !== undefined) _emailPage = page;

  const status = document.getElementById('emailStatusFilter')?.value || '';
  const type   = document.getElementById('emailTypeFilter')?.value   || '';
  let url = (window.EMAIL_LOGS_API_URL || '/api/email-logs/') + '?page=' + _emailPage + '&per_page=50';
  if (status) url += '&status='     + encodeURIComponent(status);
  if (type)   url += '&email_type=' + encodeURIComponent(type);

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

      const total      = data.total;
      const totalPages = data.total_pages;

      if (!data.logs.length) {
        tBody.innerHTML =
          '<tr class="notif-table-empty"><td colspan="7">' +
          '<div class="empty-state"><i class="fa-solid fa-envelope-open"></i>' +
          '<p>No email logs found</p>' +
          '<span>Logs appear here after emails are sent</span></div></td></tr>';
      } else {
        const statusClassMap = { on_hold: 'on-hold', pending: 'pending', sent: 'sent', failed: 'failed' };
        tBody.innerHTML = data.logs.map(function (log, i) {
          const statusCls = statusClassMap[log.status] || '';
          const errorMeta = log.error_message
            ? '<div class="email-error-meta" title="' + escAttr(log.error_message) + '"><i class="fa-solid fa-circle-info"></i> Failed details</div>'
            : '';
          const actionHtml = _buildEmailActionButtons(log);
          return '<tr id="email-log-row-' + log.id + '">' +
            '<td class="text-center text-xs text-gray-400">' + (((_emailPage - 1) * 50) + i + 1) + '</td>' +
            '<td><strong style="font-size:12.5px;color:#1e293b;">' + escHtml(log.recipient_name || '') + '</strong></td>' +
            '<td class="notif-time">' + escHtml(log.recipient_email) + '</td>' +
            '<td><span class="notif-badge-cat">' + escHtml(log.email_type_display) + '</span></td>' +
            '<td><span class="email-status-badge ' + statusCls + '" id="email-log-status-' + log.id + '">' + escHtml(log.status_display) + '</span></td>' +
            '<td class="notif-time">' + escHtml(log.created_at) + errorMeta + '</td>' +
            '<td id="email-log-action-' + log.id + '">' + actionHtml + '</td>' +
            '</tr>';
        }).join('');
      }

      // Pagination controls
      const label     = document.getElementById('emailLogCountLabel');
      const pageLabel = document.getElementById('emailPageLabel');
      const prevBtn   = document.getElementById('emailPrevBtn');
      const nextBtn   = document.getElementById('emailNextBtn');
      if (label)     label.textContent     = 'Page ' + _emailPage + ' of ' + totalPages + ' (' + total + ' total)';
      if (pageLabel) pageLabel.textContent = _emailPage + ' / ' + totalPages;
      if (prevBtn)   prevBtn.disabled      = _emailPage <= 1;
      if (nextBtn)   nextBtn.disabled      = _emailPage >= totalPages;
    })
    .catch(function (err) { console.error('Email logs load error:', err); });
};

window.emailLogPage = function (delta) {
  _emailPage = Math.max(1, _emailPage + delta);
  loadEmailLogs();
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
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
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
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
};

window.closeEmailComposeModal = function () {
  const modal = document.getElementById('emailComposeModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
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
  if (tabName === 'download-templates' && !panelTemplates.length) loadTemplates();
  if (tabName === 'log-history' && !operationsFeed.length) loadOperationsFeed();
  _syncOpsAutoRefresh(tabName === 'log-history');
};

/* ============ Monitoring (legacy alias -> Operations Hub) ============ */

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
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;color:${s.color};background:${s.bg};">${escHtml(label)}</span>`;
}

async function loadMonitoring() {
  return loadOperationsFeed();
}

document.addEventListener('visibilitychange', function () {
  const activeTab = document.querySelector('.panel-tab.active')?.dataset?.tab;
  if (activeTab === 'log-history' && !document.hidden) {
    _syncOpsAutoRefresh(true);
    return;
  }
  if (document.hidden) {
    _syncOpsAutoRefresh(false);
  }
});


/* ============ Server Info Tab ============ */

function initServerInfoTab() {
  const rows = document.getElementById('serverInfoPathRows');
  const otherRows = document.getElementById('serverOtherBreakdownRows');
  if (!rows || !otherRows) return;

  if (serverInfoSnapshot) {
    renderServerInfo(serverInfoSnapshot);
    return;
  }

  if (!serverInfoHasFetched) {
    rows.innerHTML = `<div class="empty-state" style="padding:18px 16px;"><i class="fa-solid fa-cloud-arrow-down"></i><p>Snapshot not loaded</p><span>Click "Fetch Snapshot" to load current server usage.</span></div>`;
    otherRows.innerHTML = `<div class="empty-state" style="padding:18px 16px;"><i class="fa-solid fa-layer-group"></i><p>Other usage details not loaded</p><span>Fetch snapshot to see where "Other System" is likely used.</span></div>`;
  }
}

async function loadServerInfo(forceRefresh) {
  if (serverInfoLoading) return;

  const fetchBtn = document.getElementById('serverInfoFetchBtn');
  const refreshBtn = document.getElementById('serverInfoRefreshBtn');
  const rows = document.getElementById('serverInfoPathRows');
  if (!rows) return;

  serverInfoLoading = true;
  serverInfoHasFetched = true;

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
    renderServerInfo(serverInfoSnapshot, data.cached === true);
  } catch (err) {
    console.error('Server info load error:', err);
    window.showToast && showToast('Unable to fetch server info', 'error');
  } finally {
    serverInfoLoading = false;
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
}

function renderServerInfo(snapshot, fromCache) {
  const storage = snapshot.storage || {};
  const database = snapshot.database || {};
  const otherUsageBreakdown = Array.isArray(snapshot.other_usage_breakdown) ? snapshot.other_usage_breakdown : [];
  const memory = snapshot.memory || {};
  const cpu = snapshot.cpu || {};
  const rows = document.getElementById('serverInfoPathRows');
  const otherRows = document.getElementById('serverOtherBreakdownRows');
  if (!rows || !otherRows) return;

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
  setText('serverHostName', snapshot.host || '-');
  setText('serverPythonVersion', snapshot.python_version || '-');
  setText('serverPlatformText', snapshot.platform || '-');
  setText('serverDbBackend', database.backend || '-');
  setText('serverDbName', database.name || '-');
  setText('serverDbSize', database.size_human || '-');
  setText('serverDbStatus', database.status || '-');

  const updatedEl = document.getElementById('serverInfoLastUpdated');
  if (updatedEl) {
    const cacheText = fromCache ? ' (cached)' : '';
    updatedEl.textContent = `Last fetched: ${snapshot.fetched_at_human || '-'}${cacheText}`;
  }

  const pathUsage = Array.isArray(snapshot.path_usage) ? snapshot.path_usage : [];
  if (!otherUsageBreakdown.length) {
    otherRows.innerHTML = `<div class="empty-state" style="padding:18px 16px;"><i class="fa-solid fa-layer-group"></i><p>Other usage details unavailable</p><span>No extra system-level detail could be estimated.</span></div>`;
  } else {
    otherRows.innerHTML = otherUsageBreakdown.map(item => {
      const pctOther = Number(item.pct_of_other || 0);
      return `<div class="server-path-row">
        <div class="server-path-main">
          <div class="server-path-name">${escHtml(item.name || '')}</div>
          <div class="server-path-size">${escHtml(item.size_human || '-')}</div>
        </div>
        <div class="server-path-bar-bg"><div class="server-path-bar-fill" style="width:${Math.max(0, Math.min(100, pctOther))}%;"></div></div>
        <div class="server-path-meta">${pctOther.toFixed(1)}% of Other System usage</div>
      </div>`;
    }).join('');
  }

  if (!pathUsage.length) {
    rows.innerHTML = `<div class="empty-state" style="padding:18px 16px;"><i class="fa-solid fa-folder-open"></i><p>No tracked folders found</p><span>Tracked folders are missing or empty on this server.</span></div>`;
    return;
  }

  rows.innerHTML = pathUsage.map(item => {
    const pctTracked = Number(item.pct_of_tracked || 0);
    return `<div class="server-path-row">
      <div class="server-path-main">
        <div class="server-path-name">${escHtml(item.name || '')}</div>
        <div class="server-path-size">${escHtml(item.size_human || '-')}</div>
      </div>
      <div class="server-path-bar-bg"><div class="server-path-bar-fill" style="width:${Math.max(0, Math.min(100, pctTracked))}%;"></div></div>
      <div class="server-path-meta">${pctTracked.toFixed(1)}% of tracked storage</div>
    </div>`;
  }).join('');

  if (database.status === 'error' && database.error) {
    window.showToast && showToast(`DB size read failed: ${database.error}`, 'warning');
  }
}

