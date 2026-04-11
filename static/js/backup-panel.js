/**
 * Backup Panel JS  Manage Panel "Backups" tab
 *
 * Handles:
 *  - Loading / polling backup tasks via API
 *  - Rendering backup cards with progress, downloads
 *  - Delete Now modal
 *  - Auto-switch to Backups tab via URL ?tab=backups
 */

(function () {
  'use strict';

  let _backups = [];
  let _backupFiltered = [];
  let _backupSearchText = '';
  let _backupStatusFilter = 'all';
  let _backupDateFrom = '';
  let _backupDateTo = '';
  let _pollTimer = null;
  let _activeModalTaskId = null;
  let _deleteNowCode = '';

  function _sanitizeCodeInput(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 10);
  }

  function _renderCodeBoxes(container, value) {
    if (!container) return;
    const clean = _sanitizeCodeInput(value);
    const boxes = container.querySelectorAll('.confirm-code-box');
    boxes.forEach(function (box, idx) {
      const ch = clean[idx] || '';
      box.textContent = ch;
      box.classList.toggle('is-filled', !!ch);
      box.classList.toggle('is-active', clean.length < 10 && clean.length === idx);
    });
  }

  function _setCodeWrapState(wrapEl, isMatch, isComplete) {
    if (!wrapEl) return;
    wrapEl.classList.remove('is-valid', 'is-invalid');
    if (!isComplete) return;
    wrapEl.classList.add(isMatch ? 'is-valid' : 'is-invalid');
  }

  /*  Init  */
  document.addEventListener('DOMContentLoaded', function () {
    // Auto-open backups tab if URL contains ?tab=backups
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'backups' && typeof switchTab === 'function') {
      switchTab('backups');
      loadBackups();
    }

    const deleteNowInput = document.getElementById('deleteNowCode');
    const deleteNowBoxes = document.getElementById('deleteNowCodeBoxes');
    const deleteNowWrap = document.getElementById('deleteNowCodeWrap');
    if (deleteNowInput) {
      _renderCodeBoxes(deleteNowBoxes, deleteNowInput.value);
      deleteNowInput.addEventListener('input', function () {
        this.value = _sanitizeCodeInput(this.value);
        _renderCodeBoxes(deleteNowBoxes, this.value);
        const isComplete = this.value.length === 10;
        const isMatch = isComplete && this.value === _deleteNowCode;
        _setCodeWrapState(deleteNowWrap, isMatch, isComplete);
        const errEl = document.getElementById('deleteNowError');
        if (errEl && this.value.length < 10) {
          errEl.style.display = 'none';
        }
      });
    }
  });

  /*  Hook into tab switching  lazy load  */
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

  /*  Load backups  */
  window.loadBackups = async function (options) {
    const container = document.getElementById('backupsList');
    if (!container) return;

    const cfg = (typeof options === 'boolean')
      ? { showSkeleton: options }
      : (options || {});
    const showSkeleton = cfg.showSkeleton !== false;
    const skeletonStart = showSkeleton ? _renderBackupsSkeleton(container, 3) : null;

    try {
      const response = await fetch('/api/backup/list/');
      const data = await response.json();

      if (!data.success) {
        if (skeletonStart != null && typeof waitForMinDelay === 'function') {
          await waitForMinDelay(skeletonStart);
        }
        return;
      }

      if (skeletonStart != null && typeof waitForMinDelay === 'function') {
        await waitForMinDelay(skeletonStart);
      }

      _backups = data.backups || [];
      _renderBackups();

      // If any backup is active, keep polling
      const hasActive = _backups.some(b => b.status === 'processing' || b.status === 'pending');
      if (hasActive) _startPolling();
      else _stopPolling();
    } catch (err) {
      if (skeletonStart != null && typeof waitForMinDelay === 'function') {
        await waitForMinDelay(skeletonStart);
      }
      container.innerHTML = '<div class="backup-empty-state"><p>Failed to load backups.</p></div>';
      console.error('loadBackups error', err);
    }
  };

  /*  Render  */
  function _renderBackups() {
    const container = document.getElementById('backupsList');
    if (!container) return;

    _syncBackupFiltersFromControls();
    _backupFiltered = _getFilteredBackups();

    if (!_backups.length) {
      container.innerHTML =
        '<div class="backup-empty-state">' +
        '<i class="fa-solid fa-database"></i>' +
        '<p>No backups yet. Use the <strong>Take Backup</strong> button on the Dashboard to create one.</p>' +
        '</div>';
      return;
    }

    if (!_backupFiltered.length) {
      container.innerHTML =
        '<div class="backup-empty-state">' +
        '<i class="fa-solid fa-filter-circle-xmark"></i>' +
        '<p>No backups match the selected filters.</p>' +
        '</div>';
      return;
    }

    container.innerHTML = _backupFiltered.map(b => _renderCard(b)).join('');
  }

  function _syncBackupFiltersFromControls() {
    const searchInput = document.getElementById('backupSearchInput');
    const statusInput = document.getElementById('backupStatusFilter');
    const dateFromInput = document.getElementById('backupDateFrom');
    const dateToInput = document.getElementById('backupDateTo');

    _backupSearchText = String(searchInput ? searchInput.value : '').trim().toLowerCase();
    _backupStatusFilter = String(statusInput ? statusInput.value : 'all').toLowerCase();
    _backupDateFrom = String(dateFromInput ? dateFromInput.value : '').trim();
    _backupDateTo = String(dateToInput ? dateToInput.value : '').trim();
  }

  function _getFilteredBackups() {
    return _backups.filter(function (backup) {
      const status = String(backup && backup.status || '').toLowerCase();
      if (_backupStatusFilter && _backupStatusFilter !== 'all' && status !== _backupStatusFilter) {
        return false;
      }

      const dateKey = _dateKey(backup && backup.created_at);
      if (_backupDateFrom && (!dateKey || dateKey < _backupDateFrom)) {
        return false;
      }
      if (_backupDateTo && (!dateKey || dateKey > _backupDateTo)) {
        return false;
      }

      if (!_backupSearchText) return true;

      const clientNames = backup && backup.client_names
        ? Object.values(backup.client_names).join(' ')
        : '';
      const haystack = [
        'backup',
        String(backup && backup.id || ''),
        status,
        String(backup && backup.current_client || ''),
        String(clientNames || ''),
        String(backup && backup.error_message || ''),
        String(backup && backup.combined_zip && backup.combined_zip.filename || ''),
      ].join(' ').toLowerCase();

      return haystack.indexOf(_backupSearchText) !== -1;
    });
  }

  function _dateKey(isoValue) {
    if (!isoValue) return '';
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  window.backupApplyFilters = function () {
    _syncBackupFiltersFromControls();
    _renderBackups();
  };

  window.backupClearFilters = function () {
    const searchInput = document.getElementById('backupSearchInput');
    const statusInput = document.getElementById('backupStatusFilter');
    const dateFromInput = document.getElementById('backupDateFrom');
    const dateToInput = document.getElementById('backupDateTo');

    if (searchInput) searchInput.value = '';
    if (statusInput) statusInput.value = 'all';
    if (dateFromInput) dateFromInput.value = '';
    if (dateToInput) dateToInput.value = '';

    _syncBackupFiltersFromControls();
    _renderBackups();
  };

  function _renderBackupsSkeleton(container, rows) {
    const count = Math.max(2, Number(rows || 3));
    const html = Array.from({ length: count }, function () {
      return '<div class="backup-skeleton-item" aria-hidden="true">' +
        '<div class="backup-skeleton-left">' +
          '<div class="backup-skeleton-block backup-skeleton-icon"></div>' +
          '<div>' +
            '<div class="backup-skeleton-block backup-skeleton-title"></div>' +
            '<div class="backup-skeleton-block backup-skeleton-subtitle"></div>' +
          '</div>' +
        '</div>' +
        '<div class="backup-skeleton-block backup-skeleton-btn"></div>' +
      '</div>';
    }).join('');
    container.innerHTML = html;
    return Date.now();
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

    // Error
    if (b.status === 'failed' && b.error_message) {
      html += '<div style="font-size:12px;color:#ef4444;margin-bottom:8px;">' + _esc(b.error_message) + '</div>';
    }

    // Downloads  single combined ZIP
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
      html += '<button class="backup-action-btn backup-action-delete-now" onclick="openDeleteNowModal(' + b.id + ')"><i class="fa-solid fa-trash"></i> Delete Now</button>';
      html += '</div>';
    }

    html += '</div>'; // card
    return html;
  }

  /*  Delete now modal  */
  window.openDeleteNowModal = function (taskId) {
    _activeModalTaskId = taskId;
    const freshCode = (typeof ConfirmationCode !== 'undefined') ? ConfirmationCode.generate() : String(Math.floor(1000000000 + Math.random() * 9000000000));
    _deleteNowCode = freshCode;
    document.getElementById('deleteNowCode').value = '';
    _renderCodeBoxes(document.getElementById('deleteNowCodeBoxes'), '');
    _setCodeWrapState(document.getElementById('deleteNowCodeWrap'), false, false);
    document.getElementById('deleteNowCodeDisplay').textContent = freshCode;
    document.getElementById('deleteNowError').style.display = 'none';
    if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
      window.AdarshModalBridge.open('deleteNowModal', { overlayClass: 'show', focusSelector: '#deleteNowCode' });
    } else {
      document.getElementById('deleteNowModal').style.display = 'flex';
    }
    setTimeout(() => document.getElementById('deleteNowCode').focus(), 100);
  };

  window.closeDeleteNowModal = function () {
    if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
      window.AdarshModalBridge.close('deleteNowModal', { overlayClass: 'show' });
    } else {
      document.getElementById('deleteNowModal').style.display = 'none';
    }
    _activeModalTaskId = null;
    _setCodeWrapState(document.getElementById('deleteNowCodeWrap'), false, false);
  };

  window.submitDeleteNow = function () {
    const entered = _sanitizeCodeInput(document.getElementById('deleteNowCode').value);
    document.getElementById('deleteNowCode').value = entered;
    _renderCodeBoxes(document.getElementById('deleteNowCodeBoxes'), entered);
    const errEl = document.getElementById('deleteNowError');

    if (entered !== _deleteNowCode) {
      _setCodeWrapState(document.getElementById('deleteNowCodeWrap'), false, entered.length === 10);
      errEl.textContent = 'Incorrect code. Please enter the code shown above.';
      errEl.style.display = 'block';
      return;
    }

    _setCodeWrapState(document.getElementById('deleteNowCodeWrap'), true, true);

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

  /*  Polling  */
  function _startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(function () { loadBackups({ showSkeleton: false }); }, 3000);
  }

  function _stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  /*  Utils  */
  function _esc(s) {
    const el = document.createElement('span');
    el.textContent = s || '';
    return el.innerHTML;
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
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
})();
