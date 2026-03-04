/**
 * Backup Panel JS — Manage Panel "Backups" tab
 *
 * Handles:
 *  - Loading / polling backup tasks via API
 *  - Rendering backup cards with progress, timer, downloads
 *  - Cancel auto-delete and Delete Now modals
 *  - Auto-switch to Backups tab via URL ?tab=backups
 */

(function () {
  'use strict';

  let _backups = [];
  let _pollTimer = null;
  let _activeModalTaskId = null;
  let _cancelDeleteCode = '';
  let _deleteNowCode = '';

  /* ──── Init ──── */
  document.addEventListener('DOMContentLoaded', function () {
    // Auto-open backups tab if URL contains ?tab=backups
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'backups' && typeof switchTab === 'function') {
      switchTab('backups');
      loadBackups();
    }
  });

  /* ──── Hook into tab switching → lazy load ──── */
  if (typeof switchTab === 'function') {
    const _origSwitch = switchTab;
    switchTab = function (tabName) {
      _origSwitch(tabName);
      if (tabName === 'backups' && !_backups.length) {
        loadBackups();
      }
      // Start/stop polling
      if (tabName === 'backups') {
        _startPolling();
      } else {
        _stopPolling();
      }
    };
  }

  /* ──── Load backups ──── */
  window.loadBackups = function () {
    const container = document.getElementById('backupsList');
    if (!container) return;

    fetch('/api/backup/list/')
      .then(r => r.json())
      .then(data => {
        if (!data.success) return;
        _backups = data.backups || [];
        _renderBackups();

        // If any backup is active, keep polling
        const hasActive = _backups.some(b => b.status === 'processing' || b.status === 'pending');
        if (hasActive) _startPolling();
        else _stopPolling();
      })
      .catch(err => {
        container.innerHTML = '<div class="backup-empty-state"><p>Failed to load backups.</p></div>';
        console.error('loadBackups error', err);
      });
  };

  /* ──── Render ──── */
  function _renderBackups() {
    const container = document.getElementById('backupsList');
    if (!container) return;

    if (!_backups.length) {
      container.innerHTML =
        '<div class="backup-empty-state">' +
        '<i class="fa-solid fa-database"></i>' +
        '<p>No backups yet. Use the <strong>Take Backup</strong> button on the Dashboard to create one.</p>' +
        '</div>';
      return;
    }

    container.innerHTML = _backups.map(b => _renderCard(b)).join('');
  }

  function _renderCard(b) {
    const statusClass = 'backup-status-' + b.status;
    const statusLabel = b.status.charAt(0).toUpperCase() + b.status.slice(1);

    let html = '<div class="backup-card" data-backup-id="' + b.id + '" data-status="' + b.status + '">';

    // Header
    html += '<div class="backup-card-header">';
    html += '<span class="backup-card-title"><i class="fa-solid fa-database"></i> Backup #' + b.id + '</span>';
    html += '<span class="backup-card-status ' + statusClass + '">' + statusLabel + '</span>';
    html += '</div>';

    // Body
    html += '<div class="backup-card-body">';

    // Client tags
    const names = b.client_names || {};
    const nameKeys = Object.keys(names);
    if (nameKeys.length) {
      html += '<div class="backup-client-list">';
      nameKeys.forEach(k => {
        html += '<span class="backup-client-tag">' + _esc(names[k]) + '</span>';
      });
      html += '</div>';
    }

    // Progress (for processing or completed)
    if (b.status === 'processing' || (b.status === 'completed' && b.total > 0)) {
      html += '<div class="backup-progress-wrap">';
      html += '<div class="backup-progress-info">';
      if (b.status === 'processing' && b.current_client) {
        html += '<span>Processing: ' + _esc(b.current_client) + '</span>';
      } else {
        html += '<span>' + b.progress + '/' + b.total + ' clients</span>';
      }
      html += '<span>' + b.progress_pct + '%</span>';
      html += '</div>';
      html += '<div class="backup-progress-bar"><div class="backup-progress-fill" style="width:' + b.progress_pct + '%"></div></div>';
      html += '</div>';
    }

    // Timer
    if (b.status === 'completed') {
      html += '<div class="backup-timer">';
      if (b.is_auto_delete_cancelled) {
        html += '<i class="fa-solid fa-shield-halved"></i> <span class="backup-timer-cancelled">Auto-delete cancelled — files kept until manually deleted</span>';
      } else if (b.time_remaining != null) {
        html += '<i class="fa-solid fa-clock"></i> Auto-delete in: <span class="backup-timer-value">' + _formatTime(b.time_remaining) + '</span>';
      }
      html += '</div>';
    }

    // Error
    if (b.status === 'failed' && b.error_message) {
      html += '<div style="font-size:12px;color:#ef4444;margin-bottom:8px;">' + _esc(b.error_message) + '</div>';
    }

    // Downloads — single combined ZIP
    if (b.status === 'completed') {
      if (b.combined_zip) {
        const sizeStr = _formatBytes(b.combined_zip.size || 0);
        const fname = _esc(b.combined_zip.filename || 'Adarsh Backup.zip');
        html += '<div class="backup-download-list">';
        html += '<div class="backup-download-item">';
        html += '<span><span class="backup-download-name">' + fname + '</span><span class="backup-download-size"> (' + sizeStr + ')</span></span>';
        html += '<a href="/api/backup/download/' + b.id + '/" class="backup-download-link"><i class="fa-solid fa-download"></i> Download ZIP</a>';
        html += '</div>';
        html += '</div>';
      } else {
        html += '<p style="font-size:12px;color:#94a3b8;margin-bottom:8px;">No backup file available.</p>';
      }
    }

    // Created at
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:6px;">Created: ' + _formatDate(b.created_at) + '</div>';

    html += '</div>'; // body

    // Actions
    if (b.status === 'completed') {
      html += '<div class="backup-card-actions">';
      if (!b.is_auto_delete_cancelled) {
        html += '<button class="backup-action-btn backup-action-cancel-delete" onclick="openCancelDeleteModal(' + b.id + ')"><i class="fa-solid fa-ban"></i> Cancel Auto-Delete</button>';
      }
      html += '<button class="backup-action-btn backup-action-delete-now" onclick="openDeleteNowModal(' + b.id + ')"><i class="fa-solid fa-trash"></i> Delete Now</button>';
      html += '</div>';
    }

    html += '</div>'; // card
    return html;
  }

  /* ──── Cancel auto-delete modal ──── */
  window.openCancelDeleteModal = function (taskId) {
    _activeModalTaskId = taskId;
    const freshCode = String(Math.floor(1000000000 + Math.random() * 9000000000));
    _cancelDeleteCode = freshCode;
    document.getElementById('cancelDeleteCode').value = '';
    document.getElementById('cancelDeleteCodeDisplay').textContent = freshCode;
    document.getElementById('cancelDeleteError').style.display = 'none';
    document.getElementById('cancelDeleteModal').style.display = 'flex';
    setTimeout(() => document.getElementById('cancelDeleteCode').focus(), 100);
  };

  window.closeCancelDeleteModal = function () {
    document.getElementById('cancelDeleteModal').style.display = 'none';
    _activeModalTaskId = null;
  };

  window.submitCancelDelete = function () {
    const entered = document.getElementById('cancelDeleteCode').value.trim();
    const errEl = document.getElementById('cancelDeleteError');

    if (entered !== _cancelDeleteCode) {
      errEl.textContent = 'Incorrect code. Please enter the code shown above.';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('cancelDeleteBtn');
    btn.disabled = true;

    fetch('/api/backup/' + _activeModalTaskId + '/cancel-auto-delete/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': document.querySelector('meta[name="csrf-token"]')?.content || '',
      },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(data => {
        btn.disabled = false;
        if (data.success) {
          closeCancelDeleteModal();
          if (window.showToast) showToast(data.message, 'success');
          loadBackups();
        } else {
          errEl.textContent = data.message || 'Failed.';
          errEl.style.display = 'block';
        }
      })
      .catch(() => {
        btn.disabled = false;
        errEl.textContent = 'Network error.';
        errEl.style.display = 'block';
      });
  };

  /* ──── Delete now modal ──── */
  window.openDeleteNowModal = function (taskId) {
    _activeModalTaskId = taskId;
    const freshCode = String(Math.floor(1000000000 + Math.random() * 9000000000));
    _deleteNowCode = freshCode;
    document.getElementById('deleteNowCode').value = '';
    document.getElementById('deleteNowCodeDisplay').textContent = freshCode;
    document.getElementById('deleteNowError').style.display = 'none';
    document.getElementById('deleteNowModal').style.display = 'flex';
    setTimeout(() => document.getElementById('deleteNowCode').focus(), 100);
  };

  window.closeDeleteNowModal = function () {
    document.getElementById('deleteNowModal').style.display = 'none';
    _activeModalTaskId = null;
  };

  window.submitDeleteNow = function () {
    const entered = document.getElementById('deleteNowCode').value.trim();
    const errEl = document.getElementById('deleteNowError');

    if (entered !== _deleteNowCode) {
      errEl.textContent = 'Incorrect code. Please enter the code shown above.';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('deleteNowBtn');
    btn.disabled = true;

    fetch('/api/backup/' + _activeModalTaskId + '/delete-now/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': document.querySelector('meta[name="csrf-token"]')?.content || '',
      },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(data => {
        btn.disabled = false;
        if (data.success) {
          closeDeleteNowModal();
          if (window.showToast) showToast(data.message, 'success');
          loadBackups();
        } else {
          errEl.textContent = data.message || 'Failed.';
          errEl.style.display = 'block';
        }
      })
      .catch(() => {
        btn.disabled = false;
        errEl.textContent = 'Network error.';
        errEl.style.display = 'block';
      });
  };

  /* ──── Polling ──── */
  function _startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(loadBackups, 3000);
  }

  function _stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  /* ──── Utils ──── */
  function _esc(s) {
    const el = document.createElement('span');
    el.textContent = s || '';
    return el.innerHTML;
  }

  function _formatTime(seconds) {
    if (seconds == null || seconds <= 0) return 'Expired';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (h > 0) parts.push(h + 'h');
    if (m > 0) parts.push(m + 'm');
    if (h === 0) parts.push(s + 's');
    return parts.join(' ');
  }

  function _formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let b = bytes;
    while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
    return b.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  function _formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
})();
