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

/* ============ Init ============ */
document.addEventListener('DOMContentLoaded', function() {
  loadNotifications();
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
  document.getElementById('statBroadcast').textContent = s.broadcast != null ? s.broadcast : '';
  document.getElementById('statTargeted').textContent  = s.targeted  != null ? s.targeted  : '';
  document.getElementById('statUrgent').textContent    = s.urgent    != null ? s.urgent    : '';
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
  try {
    const res = await fetch('/api/notifications/admin/target-users/');
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
   LOG HISTORY TAB
   ================================================================ */
let panelLogs = [];
let logOffset = 0;
const LOG_LIMIT = 500;  // Load all logs at once  table scrolls natively
let logTotal = 0;
let logSearchTimer = null;

async function loadLogs(append) {
  if (!append) logOffset = 0;
  try {
    const search = document.getElementById('logSearch')?.value || '';
    const userRole = document.getElementById('logUserTypeFilter')?.value || '';
    let url = `/api/activity-logs/?limit=${LOG_LIMIT}&offset=${logOffset}`;
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
      <td><span class="text-xs text-gray-500">${escHtml(l.target_name || '')}</span></td>
      <td><span class="text-xs text-gray-400">${escHtml(l.ip_address || '')}</span></td>
      <td><span class="notif-time">${l.time_ago || ''}</span></td>
    </tr>`;
  }).join('');
}

/* ================================================================
   EMAIL MANAGEMENT TAB
   (Previously embedded in tab-email-logs.html  moved here for
    proper file-based caching, linting and CSP compliance)
   ================================================================ */
let _emailPage = 1;
let _emailLogsById = {};

window.loadEmailLogs = function (page) {
  if (page !== undefined) _emailPage = page;

  const status = document.getElementById('emailStatusFilter')?.value || '';
  const type   = document.getElementById('emailTypeFilter')?.value   || '';
  let url = (window.EMAIL_LOGS_API_URL || '/api/email-logs/') + '?page=' + _emailPage + '&per_page=50';
  if (status) url += '&status='     + encodeURIComponent(status);
  if (type)   url += '&email_type=' + encodeURIComponent(type);

  const tbody = document.getElementById('emailLogsBody');
  if (tbody) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="notif-table-empty-cell">' +
      '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i>' +
      '<p>Loading</p></div></td></tr>';
  }

  fetch(url, { headers: { 'X-CSRFToken': getCSRFToken() } })
    .then(r => r.json())
    .then(function (data) {
      if (!data.success) return;
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
          '<tr class="notif-table-empty"><td colspan="8">' +
          '<div class="empty-state"><i class="fa-solid fa-envelope-open"></i>' +
          '<p>No email logs found</p>' +
          '<span>Logs appear here after emails are sent</span></div></td></tr>';
      } else {
        const statusClassMap = { on_hold: 'on-hold', pending: 'pending', sent: 'sent', failed: 'failed' };
        tBody.innerHTML = data.logs.map(function (log, i) {
          const statusCls = statusClassMap[log.status] || '';
          const noteHtml  = log.error_message
            ? '<span title="' + escAttr(log.error_message) + '" style="cursor:help;">' +
              '<i class="fa-solid fa-circle-info" style="color:#dc2626;"></i></span>'
            : '<span style="color:#9ca3af;"></span>';
          const isOtpType = log.email_type === 'otp_reset';
          const canResend = true;
          const actionTitle = isOtpType ? 'Resend OTP email' : 'Resend email';
          const quickResendHtml = canResend
            ? '<button class="btn btn-icon" style="width:28px;height:28px;padding:0;margin-left:4px;" ' +
              'onclick="resendEmail(' + log.id + ',\'' + escAttr(log.email_type || '') + '\')" title="' + actionTitle + '">' +
              '<i class="fa-solid fa-paper-plane" style="font-size:11px;"></i></button>'
            : '<span style="color:#9ca3af;"></span>';
          const editHtml = '<button class="btn btn-icon" style="width:28px;height:28px;padding:0;" ' +
            'onclick="openEditEmailModal(' + log.id + ')" title="Edit / resend with custom content">' +
            '<i class="fa-solid fa-pen-to-square" style="font-size:11px;"></i></button>';
          const actionHtml = editHtml + quickResendHtml;
          return '<tr id="email-log-row-' + log.id + '">' +
            '<td class="text-center text-xs text-gray-400">' + (((_emailPage - 1) * 50) + i + 1) + '</td>' +
            '<td><strong style="font-size:12.5px;color:#1e293b;">' + escHtml(log.recipient_name || '') + '</strong></td>' +
            '<td class="notif-time">' + escHtml(log.recipient_email) + '</td>' +
            '<td><span class="notif-badge-cat">' + escHtml(log.email_type_display) + '</span></td>' +
            '<td><span class="email-status-badge ' + statusCls + '" id="email-log-status-' + log.id + '">' + escHtml(log.status_display) + '</span></td>' +
            '<td class="notif-time">' + escHtml(log.created_at) + '</td>' +
            '<td style="text-align:center;">' + noteHtml + '</td>' +
            '<td style="text-align:center;" id="email-log-action-' + log.id + '">' + actionHtml + '</td>' +
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
  if (actionCell) actionCell.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="color:#667eea;"></i>';
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
        if (actionCell) {
          if (isOtpType) {
            actionCell.innerHTML = '<button class="btn btn-icon" style="width:28px;height:28px;padding:0;" ' +
              'onclick="resendEmail(' + logId + ',\'otp_reset\')" title="Resend OTP email">' +
              '<i class="fa-solid fa-paper-plane" style="font-size:11px;"></i></button>';
          } else {
            actionCell.innerHTML = '<span style="color:#9ca3af;">\u2014</span>';
          }
        }
        if (typeof showToast === 'function') showToast('Email resent successfully.', 'success');
      } else {
        if (actionCell) actionCell.innerHTML =
          '<button class="btn btn-icon" style="width:28px;height:28px;padding:0;" ' +
          'onclick="resendEmail(' + logId + ',\'' + (isOtpType ? 'otp_reset' : '') + '\')" title="Retry resend">' +
          '<i class="fa-solid fa-paper-plane" style="font-size:11px;"></i></button>';
        if (typeof showToast === 'function') showToast(data.message || 'Resend failed.', 'error');
        else showToast(data.message || 'Resend failed.', 'error');
      }
    })
    .catch(function (err) {
      if (actionCell) actionCell.innerHTML =
        '<button class="btn btn-icon" style="width:28px;height:28px;padding:0;" ' +
        'onclick="resendEmail(' + logId + ',\'' + (isOtpType ? 'otp_reset' : '') + '\')" title="Retry resend">' +
        '<i class="fa-solid fa-paper-plane" style="font-size:11px;"></i></button>';
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

  titleEl.innerHTML = '<i class="fa-solid fa-envelope-open-text"></i> Add New Email';
  logIdEl.value = '';
  nameEl.value = '';
  emailEl.value = '';
  typeEl.value = 'system';
  subjectEl.value = 'Message from Adarsh Admin';
  bodyTextEl.value = 'Hello User,\n\nThis is a message from Adarsh Admin.\n\nRegards,\nAdarsh Admin Team';
  bodyHtmlEl.value = '';

  try {
    const r = await fetch(window.EMAIL_COMPOSE_DEFAULTS_URL || '/api/email-compose-defaults/');
    const d = await r.json();
    if (d && d.success) {
      subjectEl.value = d.default_subject || subjectEl.value;
      bodyTextEl.value = d.default_body_text || bodyTextEl.value;
    }
  } catch (e) {
    console.warn('Compose defaults load failed:', e);
  }

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
    email_type: (document.getElementById('emailComposeType')?.value || 'system').trim(),
    subject: (document.getElementById('emailComposeSubject')?.value || '').trim(),
    body_text: (document.getElementById('emailComposeBodyText')?.value || '').trim(),
    body_html: (document.getElementById('emailComposeBodyHtml')?.value || '').trim(),
  };

  if (!payload.recipient_email || !payload.subject || !payload.body_text) {
    if (typeof showToast === 'function') showToast('Recipient email, subject, and message are required.', 'error');
    return false;
  }

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
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Loading'; }

  try {
    const res = await fetch('/api/monitoring/');
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
            <span class="system-label">#${b.id}  ${escHtml(b.status_display)}</span>
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
        : `<span style="font-size:11px;color:#94a3b8;"></span>`;

      const errTip = t.error ? ` title="${escHtml(t.error)}"` : '';
      const errIcon = t.error ? ` <i class="fa-solid fa-circle-info" style="color:#ef4444;cursor:help;" title="${escHtml(t.error)}"></i>` : '';

      return `<tr${errTip}>
        <td class="text-center text-xs text-gray-400">${i + 1}</td>
        <td><span class="text-xs font-medium">${escHtml(t.task_type)}</span></td>
        <td>${_statusBadge(t.status, t.status_display)}${errIcon}</td>
        <td><span class="text-xs text-gray-600">${escHtml(t.user)}</span></td>
        <td>${progressCell}</td>
        <td><span class="notif-time">${escHtml(t.created_at)}</span></td>
        <td><span class="notif-time">${t.completed_at ? escHtml(t.completed_at) : '<span style="color:#94a3b8;"></span>'}</span></td>
        <td></td>
      </tr>`;
    }).join('');

  } catch (err) {
    console.error('Monitoring load error:', err);
  } finally {
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh'; }
  }
}


/* ============ Server Info Tab ============ */

function initServerInfoTab() {
  const rows = document.getElementById('serverInfoPathRows');
  const breakdownRows = document.getElementById('serverInfoBreakdownRows');
  const otherRows = document.getElementById('serverOtherBreakdownRows');
  if (!rows || !breakdownRows || !otherRows) return;

  if (serverInfoSnapshot) {
    renderServerInfo(serverInfoSnapshot);
    return;
  }

  if (!serverInfoHasFetched) {
    rows.innerHTML = `<div class="empty-state" style="padding:18px 16px;"><i class="fa-solid fa-cloud-arrow-down"></i><p>Snapshot not loaded</p><span>Click "Fetch Snapshot" to load current server usage.</span></div>`;
    breakdownRows.innerHTML = `<div class="empty-state" style="padding:18px 16px;"><i class="fa-solid fa-chart-pie"></i><p>Breakdown not loaded</p><span>Fetch snapshot to see detailed used-space accounting.</span></div>`;
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
  const usageBreakdown = Array.isArray(snapshot.usage_breakdown) ? snapshot.usage_breakdown : [];
  const otherUsageBreakdown = Array.isArray(snapshot.other_usage_breakdown) ? snapshot.other_usage_breakdown : [];
  const memory = snapshot.memory || {};
  const cpu = snapshot.cpu || {};
  const rows = document.getElementById('serverInfoPathRows');
  const breakdownRows = document.getElementById('serverInfoBreakdownRows');
  const otherRows = document.getElementById('serverOtherBreakdownRows');
  if (!rows || !breakdownRows || !otherRows) return;

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
  if (!usageBreakdown.length) {
    breakdownRows.innerHTML = `<div class="empty-state" style="padding:18px 16px;"><i class="fa-solid fa-chart-pie"></i><p>Breakdown unavailable</p><span>Server could not calculate used-space categories.</span></div>`;
  } else {
    breakdownRows.innerHTML = usageBreakdown.map(item => {
      const pctUsed = Number(item.pct_of_used_disk || 0);
      return `<div class="server-path-row">
        <div class="server-path-main">
          <div class="server-path-name">${escHtml(item.name || '')}</div>
          <div class="server-path-size">${escHtml(item.size_human || '-')}</div>
        </div>
        <div class="server-path-bar-bg"><div class="server-path-bar-fill" style="width:${Math.max(0, Math.min(100, pctUsed))}%;"></div></div>
        <div class="server-path-meta">${pctUsed.toFixed(1)}% of used disk</div>
      </div>`;
    }).join('');
  }

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

