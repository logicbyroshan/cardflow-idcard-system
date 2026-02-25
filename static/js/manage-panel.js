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
    document.getElementById('totalNotifCount').textContent = panelTotal;

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
async function deleteNotification(id) {
  if (!confirm('Delete this notification? It will no longer be visible to users.')) return;
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
