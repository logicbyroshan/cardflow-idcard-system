/**
 * ID Card Group page logic
 * Handles: search, filter dropdown, delete-all, download-all, reupload, upgrade-all modals
 *
 * Usage (from template):
 *   initIdcardGroup({ clientId: <int>, isClientRole: <bool> });
 */
function initIdcardGroup(config) {
  var clientId = config.clientId;
  var isClientRole = config.isClientRole;

  var switchToGroupSettingBtn = document.getElementById('switchToGroupSetting');
  var searchInput = document.getElementById('searchInput');
  var tableBody = document.querySelector('.idcard-table tbody');

  // ==================== GROUP SETTING NAV ====================
  if (switchToGroupSettingBtn) {
    switchToGroupSettingBtn.addEventListener('click', function(e) {
      e.preventDefault();
      window.location.href = '/panel/client/' + clientId + '/settings/';
    });
  }

  // ==================== SEARCH ====================
  if (searchInput) {
    searchInput.addEventListener('input', function(e) {
      var searchTerm = e.target.value.toLowerCase();
      var rows = tableBody.querySelectorAll('tr[data-table-id]');

      rows.forEach(function(row) {
        var tableName = row.querySelector('td:first-child').textContent.toLowerCase();
        row.style.display = tableName.includes(searchTerm) ? '' : 'none';
      });
    });
  }

  // ==================== FILTER DROPDOWN ====================
  var dropdownToggle = document.getElementById('dropdownToggle');
  var dropdownOptions = document.getElementById('dropdownOptions');
  var selectedText = document.getElementById('selectedText');
  var filterDropdown = document.getElementById('filterDropdown');

  if (dropdownToggle && dropdownOptions && filterDropdown) {
    dropdownToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      filterDropdown.classList.toggle('open');
    });

    dropdownOptions.querySelectorAll('.dropdown-option').forEach(function(option) {
      option.addEventListener('click', function() {
        dropdownOptions.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
        this.classList.add('selected');
        selectedText.textContent = this.textContent;
        filterDropdown.classList.remove('open');
      });
    });

    document.addEventListener('click', function(e) {
      if (!filterDropdown.contains(e.target)) {
        filterDropdown.classList.remove('open');
      }
    });
  }

  // ==================== DELETE ALL SECURE MODAL ====================
  var deleteAllCodeDisplay = document.getElementById('deleteAllCode');
  var deleteAllCodeInput = document.getElementById('deleteAllCodeInput');
  var deleteAllConfirmBtn = document.getElementById('deleteAllConfirm');
  var deleteAllCancelBtn = document.getElementById('deleteAllCancel');
  var deleteAllTableNameEl = document.getElementById('deleteAllTableName');
  var deleteAllCountEl = document.getElementById('deleteAllCount');
  var deleteAllTableId = null;
  var deleteAllExpectedCode = '';

  function openDeleteAllModal(tableId) {
    deleteAllTableId = tableId;
    deleteAllCodeInput.value = '';
    deleteAllConfirmBtn.disabled = true;

    fetch('/panel/api/table/' + tableId + '/cards/generate-delete-code/', {
      method: 'POST',
      headers: { 'X-CSRFToken': window.getCSRFToken ? window.getCSRFToken() : '' }
    })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(data) {
        if (data.success) {
          deleteAllExpectedCode = data.code;
          deleteAllCodeDisplay.textContent = data.code;
          deleteAllTableNameEl.textContent = data.table_name;
          deleteAllCountEl.textContent = data.total_cards;
          if (window.alpineOpenModal) window.alpineOpenModal('deleteAll');
          deleteAllCodeInput.focus();
        } else {
          window.showToast(data.message || 'Failed to generate code', 'error');
        }
      })
      .catch(function(err) { console.error('Delete code generation error:', err); window.showToast('Error generating confirmation code', 'error'); });
  }

  function closeDeleteAllModal() {
    if (window.alpineCloseModal) window.alpineCloseModal();
    deleteAllTableId = null;
    deleteAllExpectedCode = '';
    deleteAllCodeInput.value = '';
  }

  if (deleteAllCodeInput) {
    deleteAllCodeInput.addEventListener('input', function() {
      var match = this.value.trim() === deleteAllExpectedCode;
      deleteAllConfirmBtn.disabled = !match;
    });
  }

  if (deleteAllCancelBtn) deleteAllCancelBtn.addEventListener('click', closeDeleteAllModal);

  if (deleteAllConfirmBtn) {
    deleteAllConfirmBtn.addEventListener('click', function() {
      if (!deleteAllTableId || deleteAllConfirmBtn.disabled) return;
      deleteAllConfirmBtn.disabled = true;
      deleteAllConfirmBtn.textContent = 'Deleting...';

      fetch('/panel/api/table/' + deleteAllTableId + '/cards/bulk-delete/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': window.getCSRFToken ? window.getCSRFToken() : '' },
        body: JSON.stringify({
          delete_all: true,
          confirmation_code: deleteAllCodeInput.value.trim()
        })
      })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(data) {
        closeDeleteAllModal();
        if (data.success) {
          window.showToast(data.message || 'All cards deleted successfully!', 'success');
          setTimeout(function() { location.reload(); }, 1000);
        } else {
          window.showToast(data.message || 'Delete failed', 'error');
        }
      })
      .catch(function(err) {
        console.error('Bulk delete error:', err);
        closeDeleteAllModal();
        window.showToast('Error deleting cards', 'error');
      });
    });
  }

  // ==================== DOWNLOAD ALL ID CARDS ====================
  var downloadAllPendingTableId = null;

  function openDownloadAllModal(tableId) {
    downloadAllPendingTableId = tableId;
    var row = document.querySelector('.bulk-btn[data-table="' + tableId + '"]');
    var tableName = row ? (row.closest('tr')?.querySelector('td:first-child')?.textContent?.trim() || 'Table') : 'Table';

    document.getElementById('downloadAllConfirmStep').style.display = '';
    document.getElementById('downloadAllProgressStep').style.display = 'none';
    document.getElementById('downloadAllTableLabel').textContent = 'Download all cards from "' + tableName + '"?';
    if (window.alpineOpenModal) window.alpineOpenModal('downloadAll');
  }

  var downloadAllStartBtn = document.getElementById('downloadAllStartBtn');
  if (downloadAllStartBtn) {
    downloadAllStartBtn.addEventListener('click', function() {
      if (!downloadAllPendingTableId) return;
      startDownloadAll(downloadAllPendingTableId);
    });
  }

  function startDownloadAll(tableId) {
    document.getElementById('downloadAllConfirmStep').style.display = 'none';
    document.getElementById('downloadAllProgressStep').style.display = '';

    var btn = document.querySelector('.download-all-btn[data-table="' + tableId + '"]');
    var dlBar = document.getElementById('downloadAllBar');
    var dlStatus = document.getElementById('downloadAllStatus');
    var dlLabel = document.getElementById('downloadAllProgressLabel');
    var dlActions = document.getElementById('downloadAllActions');

    var row = document.querySelector('.bulk-btn[data-table="' + tableId + '"]');
    var tableName = row ? (row.closest('tr')?.querySelector('td:first-child')?.textContent?.trim() || 'Table') : 'Table';

    dlLabel.textContent = 'Table: ' + tableName;
    dlBar.style.width = '0%';
    dlBar.style.background = '';
    dlStatus.textContent = 'Connecting to server...';
    dlActions.style.display = 'none';

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing...';
    }

    dlBar.style.width = '15%';
    dlStatus.textContent = 'Generating ID Cards...';

    var progressSteps = [
      { pct: '30%', text: 'Processing cards...', delay: 2000 },
      { pct: '50%', text: 'Building files...', delay: 5000 },
      { pct: '65%', text: 'Almost ready...', delay: 9000 },
    ];
    var progressTimers = progressSteps.map(function(step) {
      return setTimeout(function() { dlBar.style.width = step.pct; dlStatus.textContent = step.text; }, step.delay);
    });

    fetch('/panel/api/table/' + tableId + '/cards/download-all/', {
      method: 'POST',
      headers: {
        'X-CSRFToken': window.getCSRFToken ? window.getCSRFToken() : '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })
    .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function(data) {
      progressTimers.forEach(function(t) { clearTimeout(t); });
      if (data.success && data.files && data.files.length > 0) {
        dlBar.style.width = '85%';
        dlStatus.textContent = 'Downloading ' + data.total_files + ' file(s)...';

        data.files.forEach(function(file, index) {
          setTimeout(function() {
            triggerBase64Download(file.data, file.filename, file.type === 'xlsx'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'application/zip'
            );
            var filePct = 85 + ((index + 1) / data.files.length) * 15;
            dlBar.style.width = filePct + '%';
            if (index === data.files.length - 1) {
              dlBar.style.width = '100%';
              dlStatus.textContent = 'Download complete!';
              dlActions.style.display = '';
            }
          }, index * 500);
        });

        window.showToast('Downloading ' + data.total_files + ' file(s)...', 'success');
      } else {
        dlBar.style.width = '100%';
        dlBar.style.background = '#ef4444';
        dlStatus.textContent = data.message || 'No files to download';
        dlActions.style.display = '';
        window.showToast(data.message || 'No files to download', 'error');
      }
    })
    .catch(function(err) {
      progressTimers.forEach(function(t) { clearTimeout(t); });
      console.error('Download all error:', err);
      dlBar.style.width = '100%';
      dlBar.style.background = '#ef4444';
      dlStatus.textContent = 'Error downloading files';
      dlActions.style.display = '';
      window.showToast('Error downloading files', 'error');
    })
    .finally(function() {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-id-card"></i> Download All ID Card';
      }
    });
  }

  function triggerBase64Download(base64Data, filename, mimeType) {
    var byteChars = atob(base64Data);
    var byteNumbers = new Array(byteChars.length);
    for (var i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    var byteArray = new Uint8Array(byteNumbers);
    var blob = new Blob([byteArray], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==================== REUPLOAD IMAGES ====================
  var reuploadFileInput = document.getElementById('reuploadFileInput');
  var reuploadDropZone = document.getElementById('reuploadDropZone');
  var reuploadFileName = document.getElementById('reuploadFileName');
  var reuploadConfirmBtn = document.getElementById('reuploadConfirm');
  var reuploadCancelBtn = document.getElementById('reuploadCancel');
  var reuploadTableNameEl = document.getElementById('reuploadTableName');
  var reuploadProgress = document.getElementById('reuploadProgress');
  var reuploadBar = document.getElementById('reuploadBar');
  var reuploadStatus = document.getElementById('reuploadStatus');
  var reuploadTableId = null;

  function openReuploadModal(tableId) {
    reuploadTableId = tableId;
    var row = document.querySelector('tr[data-table-id="' + tableId + '"]') || document.querySelector('.reupload-btn[data-table="' + tableId + '"]');
    var tableName = row ? (row.closest('tr')?.querySelector('td:first-child')?.textContent?.trim() || 'Table') : 'Table';
    reuploadTableNameEl.textContent = tableName;
    reuploadFileInput.value = '';
    reuploadFileName.textContent = 'Click or drag & drop a ZIP file';
    reuploadConfirmBtn.disabled = true;
    reuploadProgress.style.display = 'none';
    reuploadBar.style.width = '0%';
    reuploadConfirmBtn.textContent = 'Upload & Match';
    if (window.alpineOpenModal) window.alpineOpenModal('reupload');
  }

  function closeReuploadModal() {
    if (window.alpineCloseModal) window.alpineCloseModal();
    reuploadTableId = null;
    reuploadFileInput.value = '';
  }

  if (reuploadDropZone) {
    reuploadDropZone.addEventListener('click', function() { reuploadFileInput.click(); });
    reuploadDropZone.addEventListener('drop', function(e) {
      e.preventDefault();
      this.style.borderColor = '#d1d5db';
      this.style.backgroundColor = '';
      if (e.dataTransfer.files.length && e.dataTransfer.files[0].name.toLowerCase().endsWith('.zip')) {
        reuploadFileInput.files = e.dataTransfer.files;
        reuploadFileInput.dispatchEvent(new Event('change'));
      } else {
        window.showToast('Only ZIP files are allowed', 'error');
      }
    });
  }

  if (reuploadFileInput) {
    reuploadFileInput.addEventListener('change', function() {
      if (this.files.length) {
        var file = this.files[0];
        if (!file.name.toLowerCase().endsWith('.zip')) {
          window.showToast('Only ZIP files are allowed', 'error');
          this.value = '';
          reuploadFileName.textContent = 'Click or drag & drop a ZIP file';
          reuploadConfirmBtn.disabled = true;
          return;
        }
        reuploadFileName.textContent = file.name;
        reuploadConfirmBtn.disabled = false;
      }
    });
  }

  if (reuploadCancelBtn) reuploadCancelBtn.addEventListener('click', closeReuploadModal);

  if (reuploadConfirmBtn) {
    reuploadConfirmBtn.addEventListener('click', function() {
      if (!reuploadTableId || !reuploadFileInput.files.length) return;
      reuploadConfirmBtn.disabled = true;
      reuploadConfirmBtn.textContent = 'Uploading...';
      reuploadProgress.style.display = 'block';
      reuploadBar.style.width = '30%';
      reuploadStatus.textContent = 'Uploading ZIP...';

      var formData = new FormData();
      formData.append('photos_zip', reuploadFileInput.files[0]);

      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/panel/api/table/' + reuploadTableId + '/cards/reupload-images/');
      if (window.getCSRFToken) xhr.setRequestHeader('X-CSRFToken', window.getCSRFToken());

      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
          var pct = Math.round((e.loaded / e.total) * 60) + 30;
          reuploadBar.style.width = pct + '%';
          reuploadStatus.textContent = 'Uploading... ' + Math.round(e.loaded / e.total * 100) + '%';
        }
      };

      xhr.onload = function() {
        reuploadBar.style.width = '100%';
        try {
          var data = JSON.parse(xhr.responseText);
          if (data.success) {
            reuploadStatus.textContent = data.message || 'Done!';
            window.showToast(data.message || 'Images reuploaded!', 'success');
            setTimeout(function() { closeReuploadModal(); location.reload(); }, 1500);
          } else {
            reuploadStatus.textContent = data.message || 'Failed';
            window.showToast(data.message || 'Reupload failed', 'error');
            reuploadConfirmBtn.disabled = false;
            reuploadConfirmBtn.textContent = 'Upload & Match';
          }
        } catch (parseErr) {
          console.error('Reupload parse error:', parseErr);
          window.showToast('Unexpected error during reupload', 'error');
          reuploadConfirmBtn.disabled = false;
          reuploadConfirmBtn.textContent = 'Upload & Match';
        }
      };

      xhr.onerror = function() {
        console.error('Reupload XHR error');
        window.showToast('Network error during reupload', 'error');
        reuploadConfirmBtn.disabled = false;
        reuploadConfirmBtn.textContent = 'Upload & Match';
        reuploadProgress.style.display = 'none';
      };

      xhr.send(formData);
    });
  }

  // ==================== UPGRADE ALL CLASSES ====================
  var upgradeAllCodeDisplay = document.getElementById('upgradeAllCode');
  var upgradeAllCodeInput = document.getElementById('upgradeAllCodeInput');
  var upgradeAllConfirmBtn = document.getElementById('upgradeAllConfirm');
  var upgradeAllCancelBtn = document.getElementById('upgradeAllCancel');
  var upgradeAllTableNameEl = document.getElementById('upgradeAllTableName');
  var upgradeAllCountEl = document.getElementById('upgradeAllCount');
  var upgradeAllTableId = null;
  var upgradeAllExpectedCode = '';

  function openUpgradeAllModal(tableId) {
    upgradeAllTableId = tableId;
    upgradeAllCodeInput.value = '';
    upgradeAllConfirmBtn.disabled = true;
    upgradeAllConfirmBtn.textContent = 'Upgrade All Classes';

    fetch('/panel/api/table/' + tableId + '/cards/generate-upgrade-code/', {
      method: 'POST',
      headers: { 'X-CSRFToken': window.getCSRFToken ? window.getCSRFToken() : '' }
    })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(data) {
        if (data.success) {
          upgradeAllExpectedCode = data.code;
          upgradeAllCodeDisplay.textContent = data.code;
          upgradeAllTableNameEl.textContent = data.table_name;
          upgradeAllCountEl.textContent = data.download_count;
          if (window.alpineOpenModal) window.alpineOpenModal('upgradeAll');
          upgradeAllCodeInput.focus();
        } else {
          window.showToast(data.message || 'Failed to generate code', 'error');
        }
      })
      .catch(function(err) { console.error('Upgrade code generation error:', err); window.showToast('Error generating confirmation code', 'error'); });
  }

  function closeUpgradeAllModal() {
    if (window.alpineCloseModal) window.alpineCloseModal();
    upgradeAllTableId = null;
    upgradeAllExpectedCode = '';
    upgradeAllCodeInput.value = '';
  }

  if (upgradeAllCodeInput) {
    upgradeAllCodeInput.addEventListener('input', function() {
      var match = this.value.trim() === upgradeAllExpectedCode;
      upgradeAllConfirmBtn.disabled = !match;
    });
  }

  if (upgradeAllCancelBtn) upgradeAllCancelBtn.addEventListener('click', closeUpgradeAllModal);

  if (upgradeAllConfirmBtn) {
    upgradeAllConfirmBtn.addEventListener('click', function() {
      if (!upgradeAllTableId || upgradeAllConfirmBtn.disabled) return;
      upgradeAllConfirmBtn.disabled = true;
      upgradeAllConfirmBtn.textContent = 'Upgrading...';

      fetch('/panel/api/table/' + upgradeAllTableId + '/cards/upgrade-classes/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': window.getCSRFToken ? window.getCSRFToken() : '' },
        body: JSON.stringify({
          confirmation_code: upgradeAllCodeInput.value.trim()
        })
      })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(data) {
        closeUpgradeAllModal();
        if (data.success) {
          window.showToast(data.message || 'Classes upgraded!', 'success');
          setTimeout(function() { location.reload(); }, 1200);
        } else {
          window.showToast(data.message || 'Upgrade failed', 'error');
        }
      })
      .catch(function(err) {
        console.error('Upgrade classes error:', err);
        closeUpgradeAllModal();
        window.showToast('Error upgrading classes', 'error');
      });
    });
  }

  // ==================== BULK ACTION BUTTONS ====================
  document.querySelectorAll('.bulk-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      var action = this.dataset.action;
      var tableId = this.dataset.table;

      if (action === 'delete-all') {
        openDeleteAllModal(tableId);
      } else if (action === 'download-all') {
        openDownloadAllModal(tableId);
      } else if (action === 'upgrade') {
        openUpgradeAllModal(tableId);
      } else if (action === 'reupload') {
        openReuploadModal(tableId);
      } else if (action === 'reprint') {
        if (isClientRole) {
          window.location.href = '/panel/client/table/' + tableId + '/reprint/';
        } else {
          window.location.href = '/panel/table/' + tableId + '/reprint/';
        }
      } else {
        window.showToast('This action is not available yet.', 'info');
      }
    });
  });
}
