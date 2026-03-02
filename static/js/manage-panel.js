/**
 * Manage Panel — Notification Management JS
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

/* ============ Init ============ */
document.addEventListener('DOMContentLoaded', function() {
  loadNotifications();
});

/* ============ Tabs ============ */
function switchTab(tabName) {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');
}

/* ============ Load Notifications ============ */
async function loadNotifications(append) {
  if (!append) panelOffset = 0;
  try {
    const search = document.getElementById('notifSearch')?.value || '';
    const res = await fetch(`/panel/api/notifications/admin/list/?limit=${PANEL_LIMIT}&offset=${panelOffset}&search=${encodeURIComponent(search)}`);
    if (!res.ok) { console.error('Failed to load notifications: HTTP', res.status); return; }
    const data = await res.json();
    if (!data.success) return;

    if (append) {
      panelNotifications = panelNotifications.concat(data.notifications);
    } else {
      panelNotifications = data.notifications;
    }
    panelTotal = data.total;

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
  const broadcasts = panelNotifications.filter(n => n.target === 'all').length;
  const targeted = panelNotifications.filter(n => n.target === 'selected').length;
  const urgent = panelNotifications.filter(n => n.priority === 'urgent').length;
  document.getElementById('statBroadcast').textContent = broadcasts;
  document.getElementById('statTargeted').textContent = targeted;
  document.getElementById('statUrgent').textContent = urgent;
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
        const res = await fetch(`/panel/api/notifications/admin/${id}/delete/`, {
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
  try {
    const res = await fetch('/panel/api/notifications/admin/target-users/');
    if (!res.ok) { console.error('Failed to load users: HTTP', res.status); return; }
    const data = await res.json();
    if (data.success) {
      allUsers = data.users;
      renderUserPicker();
    }
  } catch (err) {
    console.error('Failed to load users:', err);
  }
}

function renderUserPicker(filter) {
  const list = document.getElementById('userPickerList');
  const filterLower = (filter || '').toLowerCase();
  let html = '';

  const roleLabels = {
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
    const res = await fetch('/panel/api/notifications/admin/create/', {
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

async function loadTemplates() {
  try {
    const res = await fetch('/panel/api/export-templates/');
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
    return `<tr>
      <td class="text-center text-xs text-gray-400">${i + 1}</td>
      <td><strong class="text-sm">${escHtml(t.name)}</strong></td>
      <td><span class="text-xs text-gray-600">${escHtml(preview)}</span></td>
      <td class="text-center">${t.is_default ? '<span class="notif-badge-priority normal">Default</span>' : '—'}</td>
      <td class="text-center text-xs text-gray-400">${t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}</td>
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
  document.getElementById('templateModalTitle').innerHTML = '<i class="fa-solid fa-file-lines"></i> New Template';
  document.getElementById('templateModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function editTemplate(id) {
  const t = panelTemplates.find(x => x.id === id);
  if (!t) return;
  document.getElementById('templateEditId').value = id;
  document.getElementById('templateName').value = t.name;
  document.getElementById('templateInstructions').value = t.instructions;
  document.getElementById('templateIsDefault').checked = t.is_default;
  document.getElementById('templateModalTitle').innerHTML = '<i class="fa-solid fa-file-lines"></i> Edit Template';
  document.getElementById('templateModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeTemplateModal() {
  document.getElementById('templateModal').style.display = 'none';
  document.body.style.overflow = '';
}

async function saveTemplate() {
  const editId = document.getElementById('templateEditId').value;
  const name = document.getElementById('templateName').value.trim();
  const instructions = document.getElementById('templateInstructions').value.trim();
  const is_default = document.getElementById('templateIsDefault').checked;

  if (!name) { if (window.showToast) showToast('Template name is required', 'error'); return; }
  if (!instructions) { if (window.showToast) showToast('Instructions text is required', 'error'); return; }

  const url = editId
    ? `/panel/api/export-templates/${editId}/update/`
    : '/panel/api/export-templates/create/';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
      body: JSON.stringify({ name, instructions, is_default }),
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
        const res = await fetch(`/panel/api/export-templates/${id}/delete/`, {
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
   LOG HISTORY TAB
   ================================================================ */
let panelLogs = [];
let logOffset = 0;
const LOG_LIMIT = 500;  // Load all logs at once — table scrolls natively
let logTotal = 0;
let logSearchTimer = null;

async function loadLogs(append) {
  if (!append) logOffset = 0;
  try {
    const search = document.getElementById('logSearch')?.value || '';
    const userRole = document.getElementById('logUserTypeFilter')?.value || '';
    let url = `/panel/api/activity-logs/?limit=${LOG_LIMIT}&offset=${logOffset}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (userRole) url += `&user_role=${encodeURIComponent(userRole)}`;

    const res = await fetch(url);
    if (!res.ok) { console.error('loadLogs HTTP', res.status); return; }
    const data = await res.json();
    if (!data.success) return;

    if (append) {
      panelLogs = panelLogs.concat(data.logs);
    } else {
      panelLogs = data.logs;
    }
    logTotal = data.total;
    renderLogTable();
    const label = document.getElementById('logCountLabel');
    if (label) label.textContent = `${panelLogs.length} of ${logTotal} logs`;
  } catch (err) { console.error('loadLogs:', err); }
}

function loadMoreLogs() {
  logOffset += LOG_LIMIT;
  loadLogs(true);
}

function debounceLogSearch() {
  clearTimeout(logSearchTimer);
  logSearchTimer = setTimeout(() => loadLogs(false), 350);
}

function renderLogTable() {
  const tbody = document.getElementById('logTableBody');
  if (!tbody) return;
  if (!panelLogs.length) {
    tbody.innerHTML = `<tr class="notif-table-empty"><td colspan="7">
      <div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i>
      <p>No logs found</p><span>Activity logs will appear here</span></div></td></tr>`;
    return;
  }
  tbody.innerHTML = panelLogs.map((l, i) => {
    const actionLabel = l.action_display || l.action;
    const colorClass = l.icon_color || 'edit';
    return `<tr>
      <td class="text-center text-xs text-gray-400">${i + 1}</td>
      <td><span class="text-xs font-medium">${escHtml(l.user_name || 'System')}</span></td>
      <td><span class="log-action-badge ${colorClass}"><i class="fa-solid ${l.icon_class || 'fa-circle-info'}"></i> ${escHtml(actionLabel)}</span></td>
      <td><span class="text-xs text-gray-600">${escHtml(l.description || '')}</span></td>
      <td><span class="text-xs text-gray-500">${escHtml(l.target_name || '—')}</span></td>
      <td><span class="text-xs text-gray-400">${escHtml(l.ip_address || '—')}</span></td>
      <td><span class="notif-time">${l.time_ago || '—'}</span></td>
    </tr>`;
  }).join('');
}

/* ============ Tab switch hook — lazy-load data ============ */
const _origSwitchTab = switchTab;
switchTab = function(tabName) {
  _origSwitchTab(tabName);
  if (tabName === 'download-templates' && !panelTemplates.length) loadTemplates();
  if (tabName === 'log-history' && !panelLogs.length) loadLogs();
};

/* ============ Monitoring Tab ============ */

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
  const refreshBtn = document.getElementById('monitoringRefreshBtn');
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Loading…'; }

  try {
    const res = await fetch('/panel/api/monitoring/');
    if (!res.ok) { window.showToast && showToast('Failed to load monitoring data', 'error'); return; }
    const data = await res.json();
    if (!data.success) return;

    // Stats
    const el = id => document.getElementById(id);
    if (el('statActiveTasks')) el('statActiveTasks').textContent = data.stats.active_tasks;
    if (el('statPendingTasks')) el('statPendingTasks').textContent = data.stats.pending_tasks;
    if (el('statCompleted24h')) el('statCompleted24h').textContent = data.stats.completed_24h;
    if (el('statFailed24h')) el('statFailed24h').textContent = data.stats.failed_24h;

    // Timestamp
    const ts = el('monitoringLastUpdated');
    if (ts) ts.textContent = 'Updated ' + new Date().toLocaleTimeString();

    // Backup tasks
    const backupSection = el('monitoringBackups');
    const backupBody = el('monitoringBackupBody');
    if (backupSection && backupBody) {
      if (data.backup_tasks.length > 0) {
        backupSection.style.display = '';
        backupBody.innerHTML = data.backup_tasks.map(b => `
          <div class="system-row">
            <span class="system-label">#${b.id} — ${escHtml(b.status_display)}</span>
            <span class="system-value">
              ${escHtml(b.current_client || 'Queued')}
              <span style="color:#94a3b8;margin-left:6px;">(${b.progress}/${b.total})</span>
              ${b.progress_pct > 0 ? `<div style="width:100px;height:4px;background:#e2e8f0;border-radius:999px;display:inline-block;vertical-align:middle;margin-left:8px;overflow:hidden;"><div style="width:${b.progress_pct}%;height:100%;background:#667eea;border-radius:999px;"></div></div>` : ''}
            </span>
          </div>
        `).join('');
      } else {
        backupSection.style.display = 'none';
      }
    }

    // Tasks table
    const tbody = el('monitoringTasksBody');
    const countBadge = el('monitoringTaskCount');
    if (countBadge) countBadge.textContent = data.recent_tasks.length;

    if (!tbody) return;
    if (!data.recent_tasks.length) {
      tbody.innerHTML = `<tr class="notif-table-empty"><td colspan="8"><div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No background tasks yet</p><span>Tasks will appear here when processing starts</span></div></td></tr>`;
      return;
    }

    tbody.innerHTML = data.recent_tasks.map((t, i) => {
      const pct = t.progress_pct;
      const progressCell = pct > 0
        ? `<div style="display:flex;align-items:center;gap:6px;"><div style="width:50px;height:4px;background:#e2e8f0;border-radius:999px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:#667eea;"></div></div><span style="font-size:11px;color:#64748b;">${pct}%</span></div>`
        : `<span style="font-size:11px;color:#94a3b8;">—</span>`;

      const errTip = t.error ? ` title="${escHtml(t.error)}"` : '';
      const errIcon = t.error ? ` <i class="fa-solid fa-circle-info" style="color:#ef4444;cursor:help;" title="${escHtml(t.error)}"></i>` : '';

      return `<tr${errTip}>
        <td class="text-center text-xs text-gray-400">${i + 1}</td>
        <td><span class="text-xs font-medium">${escHtml(t.task_type)}</span></td>
        <td>${_statusBadge(t.status, t.status_display)}${errIcon}</td>
        <td><span class="text-xs text-gray-600">${escHtml(t.user)}</span></td>
        <td>${progressCell}</td>
        <td><span class="notif-time">${escHtml(t.created_at)}</span></td>
        <td><span class="notif-time">${t.completed_at ? escHtml(t.completed_at) : '<span style="color:#94a3b8;">—</span>'}</span></td>
        <td></td>
      </tr>`;
    }).join('');

  } catch (err) {
    console.error('Monitoring load error:', err);
  } finally {
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh'; }
  }
}

