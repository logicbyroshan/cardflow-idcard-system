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
  var panelBase = window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';
  var allowFolderUpload = (document.body && String(document.body.getAttribute('data-user-role') || '').toLowerCase() === 'pro_user');

  function panelUrl(path) {
    if (!path) return path;
    if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) return path;
    var normalized = path.charAt(0) === '/' ? path : '/' + path;
    return panelBase + normalized;
  }

  var switchToGroupSettingBtn = document.getElementById('switchToGroupSetting');
  var searchInput = document.getElementById('searchInput');
  var tableBody = document.querySelector('.idcard-table tbody');
  var tableContainer = document.querySelector('.idcard-table');

  function refreshGroupTableInPlace() {
    if (!tableBody || !tableContainer) return;
    fetch(window.location.href, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    })
      .then(function(res) { return res.text(); })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var nextBody = doc.querySelector('.idcard-table tbody');
        if (nextBody) {
          tableBody.innerHTML = nextBody.innerHTML;
          tableBody.querySelectorAll('tr.selected').forEach(function(r) { r.classList.remove('selected'); });
        }
      })
      .catch(function(err) {
        console.warn('In-place table refresh failed:', err);
      });
  }

  window.IDCardGroup = window.IDCardGroup || {};
  window.IDCardGroup.refreshTable = refreshGroupTableInPlace;

  function broadcastClassesUpgraded(tableId) {
    var payload = { tableId: Number(tableId) || null, ts: Date.now() };
    try {
      window.dispatchEvent(new CustomEvent('idcard-classes-upgraded', { detail: payload }));
    } catch (_err) {}
    try {
      localStorage.setItem('idcard:classes-upgraded', JSON.stringify(payload));
    } catch (_err2) {}
  }

  // ==================== SINGLE-CLICK ROW SELECTION ====================
  if (tableBody) {
    tableBody.addEventListener('click', function(e) {
      var row = e.target.closest('tr[data-table-id]');
      if (!row) return;
      // Toggle selection
      if (row.classList.contains('selected')) {
        row.classList.remove('selected');
      } else {
        tableBody.querySelectorAll('tr.selected').forEach(function(r) { r.classList.remove('selected'); });
        row.classList.add('selected');
      }
    });
  }

  // ==================== GROUP SETTING NAV ====================
  if (switchToGroupSettingBtn) {
    switchToGroupSettingBtn.addEventListener('click', function(e) {
      e.preventDefault();
      window.location.href = panelUrl('/client/' + clientId + '/settings/');
    });
  }

  // ==================== DOUBLE-CLICK  PENDING LIST ====================
  if (tableBody) {
    tableBody.addEventListener('dblclick', function(e) {
      var row = e.target.closest('tr[data-table-id]');
      if (!row) return;
      var tableId = row.getAttribute('data-table-id');
      if (!tableId) return;
      var basePath = isClientRole
        ? panelUrl('/client/table/' + tableId + '/actions/')
        : panelUrl('/table/' + tableId + '/cards/');
      window.location.href = basePath + '?status=pending';
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

  function sanitizeCodeInputValue(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 10);
  }

  function renderCodeBoxes(container, value) {
    if (!container) return;
    var clean = sanitizeCodeInputValue(value);
    var boxes = container.querySelectorAll('.confirm-code-box');
    boxes.forEach(function(box, idx) {
      var ch = clean[idx] || '';
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

  // ==================== DELETE ALL SECURE MODAL ====================
  var deleteAllCodeDisplay = document.getElementById('deleteAllCode');
  var deleteAllCodeInput = document.getElementById('deleteAllCodeInput');
  var deleteAllCodeBoxes = document.getElementById('deleteAllCodeBoxes');
  var deleteAllCodeWrap = document.getElementById('deleteAllCodeWrap');
  var deleteAllConfirmBtn = document.getElementById('deleteAllConfirm');
  var deleteAllCancelBtn = document.getElementById('deleteAllCancel');
  var deleteAllTableNameEl = document.getElementById('deleteAllTableName');
  var deleteAllCountEl = document.getElementById('deleteAllCount');
  var deleteAllTableId = null;
  var deleteAllExpectedCode = '';

  function openDeleteAllModal(tableId) {
    deleteAllTableId = tableId;
    deleteAllCodeInput.value = '';
    renderCodeBoxes(deleteAllCodeBoxes, '');
    setCodeWrapState(deleteAllCodeWrap, false, false);
    deleteAllConfirmBtn.disabled = true;

    fetch(panelUrl('/api/table/' + tableId + '/cards/generate-delete-code/'), {
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
    renderCodeBoxes(deleteAllCodeBoxes, '');
    setCodeWrapState(deleteAllCodeWrap, false, false);
  }

  if (deleteAllCodeInput) {
    deleteAllCodeInput.addEventListener('input', function() {
      this.value = sanitizeCodeInputValue(this.value);
      renderCodeBoxes(deleteAllCodeBoxes, this.value);
      var isComplete = this.value.length === 10;
      var match = isComplete && this.value === deleteAllExpectedCode;
      setCodeWrapState(deleteAllCodeWrap, match, isComplete);
      deleteAllConfirmBtn.disabled = !match;
    });
  }

  if (deleteAllCancelBtn) deleteAllCancelBtn.addEventListener('click', closeDeleteAllModal);

  if (deleteAllConfirmBtn) {
    deleteAllConfirmBtn.addEventListener('click', function() {
      if (!deleteAllTableId || deleteAllConfirmBtn.disabled) return;
      deleteAllConfirmBtn.disabled = true;
      deleteAllConfirmBtn.textContent = 'Deleting...';

      fetch(panelUrl('/api/table/' + deleteAllTableId + '/cards/bulk-delete/'), {
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
          setTimeout(function() { refreshGroupTableInPlace(); }, 300);
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

    document.getElementById('downloadAllConfirmStep').style.display = 'block';
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
    document.getElementById('downloadAllProgressStep').style.display = 'block';

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

    var _dlAbort = new AbortController();
    setTimeout(function() { _dlAbort.abort(); }, 600000); // 10 min timeout

    fetch(panelUrl('/api/table/' + tableId + '/cards/download-all/'), {
      method: 'POST',
      headers: {
        'X-CSRFToken': window.getCSRFToken ? window.getCSRFToken() : '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      signal: _dlAbort.signal,
    })
    .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function(data) {
      progressTimers.forEach(function(t) { clearTimeout(t); });
      if (data.success && data.download_url) {
        // New streaming mode: single combined ZIP on disk
        dlBar.style.width = '90%';
        dlStatus.textContent = 'Downloading ' + (data.filename || 'AllCards.zip') + '...';
        
        var a = document.createElement('a');
        a.href = data.download_url;
        a.download = data.filename || 'AllCards.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        dlBar.style.width = '100%';
        dlStatus.textContent = 'Download complete! (' + (data.total_cards || 0) + ' cards, ' + (data.total_files || 0) + ' files)';
        dlActions.style.display = 'flex';
        window.showToast('Download started: ' + (data.filename || 'AllCards.zip'), 'success');
      } else if (data.success && data.files && data.files.length > 0) {
        // Legacy base64 mode (backward compatibility)
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
              dlActions.style.display = 'flex';
            }
          }, index * 500);
        });

        window.showToast('Downloading ' + data.total_files + ' file(s)...', 'success');
      } else {
        dlBar.style.width = '100%';
        dlBar.style.background = '#ef4444';
        dlStatus.textContent = data.message || 'No files to download';
        dlActions.style.display = 'flex';
        window.showToast(data.message || 'No files to download', 'error');
      }
    })
    .catch(function(err) {
      progressTimers.forEach(function(t) { clearTimeout(t); });
      console.error('Download all error:', err);
      var errMsg = (err.name === 'AbortError') ? 'Download timed out  the server took too long. Try again later.' : 'Error downloading files';
      dlBar.style.width = '100%';
      dlBar.style.background = '#ef4444';
      dlStatus.textContent = errMsg;
      dlActions.style.display = 'flex';
      window.showToast(errMsg, err.name === 'AbortError' ? 'warning' : 'error');
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
  var reuploadFolderInput = document.getElementById('reuploadFolderInput');
  var reuploadFolderBrowse = document.getElementById('reuploadFolderBrowse');
  var reuploadFolderName = document.getElementById('reuploadFolderName');
  var reuploadFolderPath = document.getElementById('reuploadFolderPath');
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
    if (reuploadFolderInput) reuploadFolderInput.value = '';
    if (reuploadFolderName) reuploadFolderName.textContent = 'No folder selected';
    if (reuploadFolderPath) reuploadFolderPath.value = '';
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
    if (reuploadFolderInput) reuploadFolderInput.value = '';
  }

  function _updateGroupReuploadConfirmState() {
    var hasZip = !!(reuploadFileInput && reuploadFileInput.files && reuploadFileInput.files.length);
    var hasFolderFiles = !!(
      allowFolderUpload &&
      reuploadFolderInput &&
      reuploadFolderInput.files &&
      Array.from(reuploadFolderInput.files).some(function(f) {
        return /\.(jpe?g|png|gif|bmp|webp|heic|heif|hei)$/i.test(f.name || '');
      })
    );
    var hasFolderPath = !!(allowFolderUpload && reuploadFolderPath && reuploadFolderPath.value && reuploadFolderPath.value.trim());
    reuploadConfirmBtn.disabled = !(hasZip || hasFolderFiles || hasFolderPath);
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
        window.showToast('Only ZIP files are allowed', 'warning');
      }
    });
  }

  if (reuploadFileInput) {
    reuploadFileInput.addEventListener('change', function() {
      if (this.files.length) {
        var file = this.files[0];
        if (!file.name.toLowerCase().endsWith('.zip')) {
          window.showToast('Only ZIP files are allowed', 'warning');
          this.value = '';
          reuploadFileName.textContent = 'Click or drag & drop a ZIP file';
          reuploadConfirmBtn.disabled = true;
          return;
        }
        var _maxZip = 950 * 1024 * 1024;
        if (file.size > _maxZip) {
          var _sizeMB = (file.size / (1024 * 1024)).toFixed(0);
          window.showToast('ZIP is ' + _sizeMB + ' MB  maximum allowed is 950 MB. Please split into smaller ZIPs.', 'error');
          this.value = '';
          reuploadFileName.textContent = 'Click or drag & drop a ZIP file';
          reuploadConfirmBtn.disabled = true;
          return;
        }
        reuploadFileName.textContent = file.name;
        _updateGroupReuploadConfirmState();
      }
    });
  }

  if (reuploadFolderBrowse && reuploadFolderInput) {
    reuploadFolderBrowse.addEventListener('click', function() {
      if (!allowFolderUpload) {
        if (window.showToast) window.showToast('Select Folder is available only for Pro User accounts.', 'warning');
        return;
      }
      reuploadFolderInput.click();
    });
  }

  if (reuploadFolderInput) {
    reuploadFolderInput.addEventListener('change', function() {
      if (!allowFolderUpload) {
        this.value = '';
        if (reuploadFolderName) reuploadFolderName.textContent = 'No folder selected';
        if (window.showToast) window.showToast('Select Folder is available only for Pro User accounts.', 'warning');
        _updateGroupReuploadConfirmState();
        return;
      }
      var files = Array.from(this.files || []).filter(function(f) {
        return /\.(jpe?g|png|gif|bmp|webp|heic|heif|hei)$/i.test(f.name || '');
      });
      if (reuploadFolderName) {
        reuploadFolderName.textContent = files.length ? (files.length + ' image file(s) selected from folder') : 'No valid image files found in selected folder';
      }
      _updateGroupReuploadConfirmState();
    });
  }

  if (reuploadFolderPath) {
    reuploadFolderPath.addEventListener('input', _updateGroupReuploadConfirmState);
  }

  if (reuploadCancelBtn) reuploadCancelBtn.addEventListener('click', closeReuploadModal);

  if (reuploadConfirmBtn) {
    reuploadConfirmBtn.addEventListener('click', function() {
      if (!reuploadTableId) return;
      reuploadConfirmBtn.disabled = true;
      reuploadConfirmBtn.textContent = 'Uploading...';
      reuploadProgress.style.display = 'block';
      reuploadBar.style.width = '0%';
      reuploadStatus.textContent = 'Starting upload...';
      var _grpPollInterval = null;
      var _uploadDone = false; // guard against duplicate handler calls

      //  Stall detection: abort if no progress for 30 seconds 
      var _lastProgressTime = Date.now();
      var _stallTimer = setInterval(function() {
        if (_uploadDone) { clearInterval(_stallTimer); return; }
        if (Date.now() - _lastProgressTime > 30000) {
          clearInterval(_stallTimer);
          if (!_uploadDone) {
            _uploadDone = true;
            xhr.abort();
            reuploadStatus.textContent = 'Upload stalled  server may have rejected the file.';
            window.showToast(
              'Upload stalled. Check that Nginx client_max_body_size is large enough (1000M) and the server is running.',
              'error'
            );
            reuploadConfirmBtn.disabled = false;
            reuploadConfirmBtn.textContent = 'Upload & Match';
          }
        }
      }, 5000);

      function _cleanupReuploadGroup() {
        _uploadDone = true;
        clearInterval(_stallTimer);
      }

      var formData = new FormData();
      if (reuploadFileInput && reuploadFileInput.files && reuploadFileInput.files.length) {
        formData.append('photos_zip', reuploadFileInput.files[0]);
      }
      if (allowFolderUpload && reuploadFolderInput && reuploadFolderInput.files && reuploadFolderInput.files.length) {
        Array.from(reuploadFolderInput.files).filter(function(f) {
          return /\.(jpe?g|png|gif|bmp|webp|heic|heif|hei)$/i.test(f.name || '');
        }).forEach(function(f) {
          formData.append('photos_folder_files', f, f.webkitRelativePath || f.name);
        });
      }
      if (allowFolderUpload && reuploadFolderPath && reuploadFolderPath.value && reuploadFolderPath.value.trim()) {
        formData.append('photos_folder_path', reuploadFolderPath.value.trim());
      }

      var uploadUrl = panelUrl('/api/table/' + reuploadTableId + '/reupload-task/');
      var xhr = new XMLHttpRequest();
      xhr.open('POST', uploadUrl);
      if (window.getCSRFToken) xhr.setRequestHeader('X-CSRFToken', window.getCSRFToken());
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.timeout = 300000;

      xhr.upload.onprogress = function(e) {
        _lastProgressTime = Date.now();
        if (e.lengthComputable) {
          var uploadPct = Math.round((e.loaded / e.total) * 80);
          reuploadBar.style.width = uploadPct + '%';
          reuploadStatus.textContent = 'Uploading... ' + Math.round(e.loaded / e.total * 100) + '%';
        }
      };

      //  Catch early server error (e.g. Nginx 413) before upload finishes 
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4 && !_uploadDone) {
          if (xhr.status !== 200) {
            _cleanupReuploadGroup();
            var errMsg = 'Server rejected the upload (HTTP ' + xhr.status + ').';
            if (xhr.status === 413) errMsg = 'ZIP file too large.';
            else if (xhr.status === 403) errMsg = 'Forbidden (403). Try reloading the page.';
            else if (xhr.status === 502 || xhr.status === 504) errMsg = 'Server timeout  try a smaller ZIP.';
            else if (xhr.status === 0) errMsg = 'Connection lost. Check your internet.';
            reuploadStatus.textContent = errMsg;
            window.showToast(errMsg, 'error');
            reuploadConfirmBtn.disabled = false;
            reuploadConfirmBtn.textContent = 'Upload & Match';
          }
        }
      };

      xhr.onload = function() {
        if (_uploadDone) return;
        _cleanupReuploadGroup();
        try {
          var data = JSON.parse(xhr.responseText);
          if (xhr.status === 200 && data.success) {
            reuploadBar.style.width = '80%';
            reuploadStatus.textContent = 'Processing images...';
            // Poll for real task progress
            var _pollErrors = 0;
            _grpPollInterval = setInterval(function() {
              fetch(panelUrl('/api/task-status/' + data.task_id + '/'))
                .then(function(r) { return r.json(); })
                .then(function(t) {
                  _pollErrors = 0; // reset on success
                  if (t.status === 'completed') {
                    clearInterval(_grpPollInterval);
                    reuploadBar.style.width = '100%';
                    var matched = (t.result && t.result.matched_count != null) ? t.result.matched_count : '';
                    var msg = matched !== '' ? ('Done! ' + matched + ' images matched.') : 'Done!';
                    reuploadStatus.textContent = msg;
                    window.showToast(msg, 'success');
                      setTimeout(function() {
                        closeReuploadModal();
                        refreshGroupTableInPlace();
                      }, 300);
                  } else if (t.status === 'failed' || t.status === 'cancelled') {
                    clearInterval(_grpPollInterval);
                    var errMsg = t.error_message || 'Reupload failed. Please try again.';
                    reuploadStatus.textContent = errMsg;
                    window.showToast(errMsg, 'error');
                    reuploadConfirmBtn.disabled = false;
                    reuploadConfirmBtn.textContent = 'Upload & Match';
                  } else {
                    var pct = 80 + Math.round((t.progress_percentage || 0) * 0.19);
                    reuploadBar.style.width = Math.min(pct, 99) + '%';
                    reuploadStatus.textContent = 'Processing: ' + (t.progress || 0) + '/' + (t.total || '?') + ' images...';
                  }
                })
                .catch(function(err) {
                  _pollErrors++;
                  console.warn('[Reupload] Poll error #' + _pollErrors + ':', err);
                  if (_pollErrors >= 5) {
                    clearInterval(_grpPollInterval);
                    reuploadStatus.textContent = 'Lost connection to server. The task may still be running  refresh the page to check.';
                    window.showToast('Lost connection while tracking progress. Please refresh.', 'error');
                    reuploadConfirmBtn.disabled = false;
                    reuploadConfirmBtn.textContent = 'Upload & Match';
                  }
                });
            }, 2000);
          } else {
            reuploadStatus.textContent = data.message || 'Failed';
            window.showToast(data.message || 'Reupload failed', data.level || 'error');
            reuploadConfirmBtn.disabled = false;
            reuploadConfirmBtn.textContent = 'Upload & Match';
          }
        } catch (parseErr) {
          console.error('Reupload parse error:', parseErr, 'Status:', xhr.status, 'Response:', xhr.responseText ? xhr.responseText.substring(0, 300) : '(empty)');
          var errMsg = 'Unexpected error during reupload';
          if (xhr.status === 413) errMsg = 'ZIP file too large. Increase Nginx client_max_body_size (need 1000M).';
          else if (xhr.status === 502 || xhr.status === 504) errMsg = 'Server timeout  try a smaller ZIP file.';
          else if (xhr.status === 500) errMsg = 'Server error. Please try again.';
          else if (xhr.status === 0) errMsg = 'Connection lost. Check your internet and server status.';
          window.showToast(errMsg, (xhr.status === 413 || xhr.status === 502 || xhr.status === 504) ? 'warning' : 'error');
          reuploadConfirmBtn.disabled = false;
          reuploadConfirmBtn.textContent = 'Upload & Match';
        }
      };

      xhr.onerror = function() {
        if (_uploadDone) return;
        _cleanupReuploadGroup();
        var errMsg = 'Upload failed. ';
        if (xhr.status === 413) errMsg += 'File too large.';
        else if (xhr.status === 0) errMsg += 'Connection was reset.';
        else errMsg += 'Check your connection and try again.';
        window.showToast(errMsg, 'error');
        reuploadStatus.textContent = errMsg;
        reuploadConfirmBtn.disabled = false;
        reuploadConfirmBtn.textContent = 'Upload & Match';
        reuploadProgress.style.display = 'none';
      };

      xhr.ontimeout = function() {
        if (_uploadDone) return;
        _cleanupReuploadGroup();
        window.showToast('Upload timed out  try a smaller ZIP.', 'warning');
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
  var upgradeAllCodeBoxes = document.getElementById('upgradeAllCodeBoxes');
  var upgradeAllCodeWrap = document.getElementById('upgradeAllCodeWrap');
  var upgradeAllConfirmBtn = document.getElementById('upgradeAllConfirm');
  var upgradeAllCancelBtn = document.getElementById('upgradeAllCancel');
  var upgradeAllTableNameEl = document.getElementById('upgradeAllTableName');
  var upgradeAllCountEl = document.getElementById('upgradeAllCount');
  var upgradeAllTableId = null;
  var upgradeAllExpectedCode = '';

  function openUpgradeAllModal(tableId) {
    upgradeAllTableId = tableId;
    upgradeAllCodeInput.value = '';
    renderCodeBoxes(upgradeAllCodeBoxes, '');
    setCodeWrapState(upgradeAllCodeWrap, false, false);
    upgradeAllConfirmBtn.disabled = true;
    upgradeAllConfirmBtn.textContent = 'Upgrade All Classes';

    fetch(panelUrl('/api/table/' + tableId + '/cards/generate-upgrade-code/'), {
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
    renderCodeBoxes(upgradeAllCodeBoxes, '');
    setCodeWrapState(upgradeAllCodeWrap, false, false);
  }

  if (upgradeAllCodeInput) {
    upgradeAllCodeInput.addEventListener('input', function() {
      this.value = sanitizeCodeInputValue(this.value);
      renderCodeBoxes(upgradeAllCodeBoxes, this.value);
      var isComplete = this.value.length === 10;
      var match = isComplete && this.value === upgradeAllExpectedCode;
      setCodeWrapState(upgradeAllCodeWrap, match, isComplete);
      upgradeAllConfirmBtn.disabled = !match;
    });
  }

  if (upgradeAllCancelBtn) upgradeAllCancelBtn.addEventListener('click', closeUpgradeAllModal);

  if (upgradeAllConfirmBtn) {
    upgradeAllConfirmBtn.addEventListener('click', function() {
      if (!upgradeAllTableId || upgradeAllConfirmBtn.disabled) return;
      upgradeAllConfirmBtn.disabled = true;
      upgradeAllConfirmBtn.textContent = 'Upgrading...';

      fetch(panelUrl('/api/table/' + upgradeAllTableId + '/cards/upgrade-classes/'), {
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
          broadcastClassesUpgraded(upgradeAllTableId);
          window.showToast(data.message || 'Classes upgraded!', 'success');
          setTimeout(function() { refreshGroupTableInPlace(); }, 300);
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
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.bulk-btn');
    if (!btn) return;
    if (btn.disabled) return;

    e.stopPropagation();
    e.preventDefault();

    var action = btn.dataset.action;
    var tableId = btn.dataset.table;

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
        window.location.href = panelUrl('/client/table/' + tableId + '/reprint/');
      } else {
        window.location.href = panelUrl('/reprint/table/' + tableId + '/');
      }
    } else {
      window.showToast('This action is not available yet.', 'info');
    }
  });

}
