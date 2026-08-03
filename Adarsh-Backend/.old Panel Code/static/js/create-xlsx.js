/**
 * Create with XLSX  3-step modal controller
 *
 * Step 1: Select XLSX/CSV file + optional table name
 * Step 2: Preview detected fields (columns, types, mandatory toggles)
 * Step 3: Optionally attach photo ZIP files, then upload
 *
 * Usage:
 *   initCreateWithXlsx({ apiUrl: '...', onSuccess: function() {} });
 *
 * Depends on: Alpine.js (for modal open/close), showToast(), SheetJS (XLSX global)
 */
function initCreateWithXlsx(opts) {
  var apiUrl     = opts.apiUrl;
  var onSuccess  = opts.onSuccess || function() {
    if (typeof htmx !== 'undefined') {
      htmx.trigger(document.body, 'refreshTable');
    } else {
      console.warn('Create with XLSX success fallback: no HTMX refresh target available');
    }
  };
  var csrfToken  = opts.csrfToken || '';

  //  Header  type map (mirrors backend _HEADER_TYPE_MAP) 
  var HEADER_TYPE_MAP = [
    { patterns: ['mother photo', 'm photo', 'mother_photo', 'mother pic'], type: 'rel_photo' },
    { patterns: ['father photo', 'f photo', 'father_photo', 'father pic'], type: 'rel_photo' },
    { patterns: ['relation photo', 'relation image', 'relation pic', 'rel photo'], type: 'rel_photo' },
    { patterns: ['relation 1 photo', 'relation1photo', 'relation one photo', 'rel 1 photo', 'rel1photo', 'rel_1photo'], type: 'rel_photo' },
    { patterns: ['relation 2 photo', 'relation2photo', 'relation two photo', 'rel 2 photo', 'rel2photo', 'rel_2photo'], type: 'rel_photo' },
    { patterns: ['photo', 'pic', 'picture', 'image', 'student photo', 'student image'], type: 'photo' },
    { patterns: ['signature', 'sign'], type: 'signature' },
    { patterns: ['barcode'], type: 'barcode' },
    { patterns: ['qr code', 'qr_code', 'qr'], type: 'qr_code' },
    { patterns: ['class'], type: 'class' },
    { patterns: ['section', 'sec'], type: 'section' },
    { patterns: ['email', 'e-mail', 'email id', 'email address'], type: 'email' }
  ];

  var SAMPLE_ROW_SCAN_LIMIT = 3;
  var RELATION_SLOT_RE = /^(?:rel(?:ation)?)\s*(?:1|one|2|two)$/i;
  var RELATION_PHOTO_RE = /^(?:rel(?:ation)?)\s*(?:1|one|2|two)\s*(?:photo|image|pic|picture)$/i;
  var IMAGE_EXT_RE = /\.(?:jpe?g|png|gif|bmp|webp|heic|heif)$/i;
  var FOLDER_UPLOAD_CONFIRM_THRESHOLD = 1000;
  var MAX_FOLDER_UPLOAD_FILES = 5000;

  function isProUserFolderUploadEnabled() {
    var role = '';
    if (document && document.body) {
      role = String(document.body.getAttribute('data-user-role') || '').toLowerCase();
    }
    return role === 'pro_user';
  }

  var ALL_TYPES = [
    { value: 'text',         label: 'Text' },
    { value: 'class',        label: 'Class' },
    { value: 'section',      label: 'Section' },
    { value: 'email',        label: 'Email' },
    { value: 'photo',        label: 'Photo' },
    { value: 'rel_photo',    label: 'Relation Photo' },
    { value: 'signature',    label: 'Signature' },
    { value: 'barcode',      label: 'Barcode' },
    { value: 'qr_code',      label: 'QR Code' }
  ];

  function isImageLikeRelationValue(value) {
    if (value === null || value === undefined) return false;
    var text = String(value).trim();
    if (!text) return false;

    var normalized = text.toLowerCase().replace(/\\/g, '/').trim();
    if (normalized.indexOf('pending:') === 0) normalized = normalized.slice(8).trim();

    if (IMAGE_EXT_RE.test(normalized)) return true;
    if ((normalized.indexOf('http://') === 0 || normalized.indexOf('https://') === 0) &&
        (normalized.indexOf('/media/') !== -1 || normalized.indexOf('/card_media/') !== -1 || IMAGE_EXT_RE.test(normalized))) {
      return true;
    }
    if (normalized.indexOf('/') !== -1 && /(photo|image|pic|card_media|id_photos)/.test(normalized)) {
      return true;
    }

    var compact = normalized.replace(/[\s_-]+/g, '');
    if (/^(?:img|image|photo|pic)\d{3,}$/.test(compact)) return true;
    if (/^[a-z]?\d{6,}$/.test(compact)) return true;

    return false;
  }

  function isTextLikeRelationValue(value) {
    if (value === null || value === undefined) return false;
    var text = String(value).trim();
    if (!text) return false;
    if (isImageLikeRelationValue(text)) return false;

    var letters = (text.match(/[A-Za-z]/g) || []).length;
    var digits = (text.match(/\d/g) || []).length;
    if (letters >= 2 && (digits === 0 || letters >= digits)) return true;
    if (text.indexOf(' ') !== -1 && letters >= 1) return true;
    return false;
  }

  function inferRelationSlotType(sampleValues) {
    var imageVotes = 0;
    var textVotes = 0;
    var values = Array.isArray(sampleValues) ? sampleValues.slice(0, SAMPLE_ROW_SCAN_LIMIT) : [];
    values.forEach(function(value) {
      if (isImageLikeRelationValue(value)) {
        imageVotes += 1;
      } else if (isTextLikeRelationValue(value)) {
        textVotes += 1;
      }
    });
    return (imageVotes > 0 && imageVotes >= textVotes) ? 'rel_photo' : 'text';
  }

  function inferFieldType(headerName, sampleValues) {
    var normalized = headerName.trim().toLowerCase().replace(/[_\-]+/g, ' ');
    normalized = normalized.replace(/\s+/g, ' ').trim();
    if (RELATION_PHOTO_RE.test(normalized)) {
      return 'rel_photo';
    }
    if (/\b(?:father|mother)\b\s*(?:photo|image|pic|picture)\b/.test(normalized)) {
      return 'rel_photo';
    }
    if (RELATION_SLOT_RE.test(normalized)) {
      return inferRelationSlotType(sampleValues);
    }
    for (var i = 0; i < HEADER_TYPE_MAP.length; i++) {
      if (HEADER_TYPE_MAP[i].patterns.indexOf(normalized) !== -1) {
        return HEADER_TYPE_MAP[i].type;
      }
    }
    return 'text';
  }

  function getByIdLatest(id) {
    var nodes = document.querySelectorAll('[id="' + id + '"]');
    return nodes.length ? nodes[nodes.length - 1] : null;
  }

  // Elements  Step 1
  var dropzone   = getByIdLatest('cxDropzone');
  var browse     = getByIdLatest('cxBrowse');
  var fileInput  = getByIdLatest('cxFileInput');
  var fileInfo   = getByIdLatest('cxFileInfo');
  var fileName   = getByIdLatest('cxFileName');
  var fileRemove = getByIdLatest('cxFileRemove');
  var nextBtn    = getByIdLatest('cxNextBtn');
  var tableNameInput = getByIdLatest('cxTableName');

  // Elements  Step 2 (Field Preview)
  var fieldsBody     = getByIdLatest('cxFieldsBody');
  var dataRowsCount  = getByIdLatest('cxDataRowsCount');
  var backToStep1Btn = getByIdLatest('cxBackToStep1');
  var nextToStep3Btn = getByIdLatest('cxNextToStep3');

  // Elements  Step 3 (ZIP)
  var zipDropzone = getByIdLatest('cxZipDropzone');
  var zipBrowse   = getByIdLatest('cxZipBrowse');
  var zipInput    = getByIdLatest('cxZipInput');
  var zipList     = getByIdLatest('cxZipList');
  var folderBrowse = getByIdLatest('cxFolderBrowse');
  var folderInput = getByIdLatest('cxFolderInput');
  var folderSummary = getByIdLatest('cxFolderSummary');
  var folderPathInput = getByIdLatest('cxFolderPathInput');
  var backBtn     = getByIdLatest('cxBackBtn');
  var skipBtn     = getByIdLatest('cxSkipBtn');
  var uploadBtn   = getByIdLatest('cxUploadBtn');

  // Step indicators (3-step)
  var step1Dot       = getByIdLatest('cxStep1Dot');
  var step2Dot       = getByIdLatest('cxStep2Dot');
  var step3Dot       = getByIdLatest('cxStep3Dot');
  var stepLineFill1  = getByIdLatest('cxStepLineFill1');
  var stepLineFill2  = getByIdLatest('cxStepLineFill2');

  // Progress
  var progress     = getByIdLatest('cxProgress');
  var progressText = getByIdLatest('cxProgressText');
  var progressCancelBtn = getByIdLatest('cxProgressCancelBtn');
  var headerCloseBtn = getByIdLatest('cxHeaderClose');

  var step1El = getByIdLatest('cxStep1');
  var step2El = getByIdLatest('cxStep2');
  var step3El = getByIdLatest('cxStep3');

  function bindTriggerButtons() {
    document.querySelectorAll('[id="createFromXlsxBtn"]').forEach(function(btn) {
      if (btn.dataset.cxTriggerBound === '1') return;
      btn.dataset.cxTriggerBound = '1';
      btn.addEventListener('click', function() {
        if (typeof window.__cxResetModal === 'function') {
          window.__cxResetModal();
        }
        if (window.alpineOpenModal) window.alpineOpenModal('createXlsx');
      });
    });
  }

  if (!dropzone || !fileInput) return;
  if (dropzone.dataset.cxInitBound === '1') {
    bindTriggerButtons();
    return;
  }
  dropzone.dataset.cxInitBound = '1';

  var selectedFile = null;
  var zipFiles = [];
  var folderFiles = [];
  var detectedFields = [];
  var parsedDataRowCount = 0;
  var activeXhr = null;
  var retryTimer = null;
  var processingTimer = null;
  var isUploading = false;
  var cancelRequested = false;
  var confirmedRiskyFolderPath = '';

  //  Helpers 
  function showStep(n) {
    step1El.style.display = n === 1 ? '' : 'none';
    step2El.style.display = n === 2 ? '' : 'none';
    step3El.style.display = n === 3 ? '' : 'none';
    progress.style.display = 'none';

    step1Dot.style.background = n >= 1 ? '#22c55e' : '#e5e7eb';
    step2Dot.style.background = n >= 2 ? '#22c55e' : '#e5e7eb';
    if (step3Dot) step3Dot.style.background = n >= 3 ? '#22c55e' : '#e5e7eb';

    stepLineFill1.style.width = n >= 2 ? '100%' : '0%';
    if (stepLineFill2) stepLineFill2.style.width = n >= 3 ? '100%' : '0%';
  }

  function clearUploadTimers() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (processingTimer) {
      clearInterval(processingTimer);
      processingTimer = null;
    }
  }

  function finishUploadFlow() {
    clearUploadTimers();
    activeXhr = null;
    isUploading = false;
    cancelRequested = false;
  }

  function abortCurrentUpload(options) {
    var opts = options || {};
    if (!isUploading && !activeXhr && !retryTimer) return;

    cancelRequested = true;
    clearUploadTimers();

    if (activeXhr) {
      try {
        activeXhr.abort();
      } catch (_err) {
        // no-op
      }
      activeXhr = null;
    }

    isUploading = false;
    if (opts.returnToStep) showStep(opts.returnToStep);
    if (!opts.silent && window.showToast) showToast('Upload cancelled.', 'warning');
  }

  function resetModal() {
    abortCurrentUpload({ silent: true });
    selectedFile = null;
    zipFiles = [];
    folderFiles = [];
    detectedFields = [];
    parsedDataRowCount = 0;
    fileInfo.style.display = 'none';
    dropzone.style.display = '';
    nextBtn.disabled = true;
    fileInput.value = '';
    zipInput.value = '';
    zipList.innerHTML = '';
    if (folderInput) folderInput.value = '';
    if (folderSummary) folderSummary.textContent = 'No folder selected';
    if (folderPathInput) folderPathInput.value = '';
    fieldsBody.innerHTML = '';
    if (tableNameInput) tableNameInput.value = '';
    showStep(1);
  }
  window.__cxResetModal = resetModal;

  function setFile(file) {
    if (!file) return;
    var name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) {
      if (window.showToast) showToast('Only .xlsx, .xls, .csv files are supported.', 'warning');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      if (window.showToast) showToast('File must be under 50 MB.', 'warning');
      return;
    }
    selectedFile = file;
    fileName.textContent = file.name;
    fileInfo.style.display = '';
    dropzone.style.display = 'none';
    nextBtn.disabled = false;
  }

  //  Parse XLSX and detect fields 
  function parseFileAndShowPreview() {
    if (!selectedFile) return;

    if (typeof XLSX === 'undefined') {
      if (window.showToast) showToast('Spreadsheet parser not loaded. Please refresh the page.', 'error');
      return;
    }

    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var data = new Uint8Array(e.target.result);
        var workbook = XLSX.read(data, { type: 'array' });
        var firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        var jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

        if (!jsonData || jsonData.length === 0) {
          if (window.showToast) showToast('The file appears to be empty.', 'error');
          return;
        }

        var headers = (jsonData[0] || [])
          .map(function(h) { return h != null ? String(h).trim() : ''; })
          .filter(function(h) { return h !== ''; });

        if (headers.length === 0) {
          if (window.showToast) showToast('No column headers found in the first row.', 'error');
          return;
        }

        parsedDataRowCount = jsonData.slice(1).filter(function(row) {
          if (!row || !Array.isArray(row)) return false;
          return row.some(function(cell) {
            return cell !== null && cell !== undefined && String(cell).trim() !== '';
          });
        }).length;

        var sampleRows = jsonData.slice(1, 1 + SAMPLE_ROW_SCAN_LIMIT);

        detectedFields = headers.map(function(header, idx) {
          var sampleValues = sampleRows.map(function(row) {
            return Array.isArray(row) ? row[idx] : null;
          });
          return {
            name: header.toUpperCase(),
            type: inferFieldType(header, sampleValues),
            mandatory: false,
            order: idx
          };
        });

        // Warn if any data cells contain characters that will be stripped on import
        (function() {
          var BAD_CHARS = /[\n\r\t"_\-@#$%^&*()\[\]{}<>|\\:;~`!?=]/;
          var dataRows = jsonData.slice(1);
          var foundBad = dataRows.some(function(row) {
            return Array.isArray(row) && row.some(function(cell) {
              return cell != null && BAD_CHARS.test(String(cell));
            });
          });
          if (foundBad && window.showToast) {
            showToast(
              'Your data contains characters that will be removed on import ' +
              '(e.g. newlines, _, -, @, double quotes). ' +
              'Only letters, numbers, spaces, commas, periods and + are allowed.',
              'warning'
            );
          }
        })();

        renderFieldPreview();
        showStep(2);
      } catch (err) {
        console.error('XLSX parse error:', err);
        if (window.showToast) showToast('Failed to read file: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(selectedFile);
  }

  function renderFieldPreview() {
    fieldsBody.innerHTML = '';
    dataRowsCount.textContent = parsedDataRowCount + ' data row' + (parsedDataRowCount !== 1 ? 's' : '') + ' found';

    detectedFields.forEach(function(field, idx) {
      var tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid #f1f5f9;';

      // # column
      var tdNum = document.createElement('td');
      tdNum.style.cssText = 'padding:7px 10px;color:#94a3b8;font-size:11px;font-weight:500;';
      tdNum.textContent = idx + 1;
      tr.appendChild(tdNum);

      // Column name (editable)
      var tdName = document.createElement('td');
      tdName.style.cssText = 'padding:7px 4px;';
      var nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = field.name;
      nameInput.setAttribute('data-field-idx', idx);
      nameInput.style.cssText = 'width:100%;font-size:12px;font-weight:600;color:#1e293b;padding:4px 6px;border:1px solid #e2e8f0;border-radius:4px;background:#fff;outline:none;';
      nameInput.addEventListener('focus', function() { this.style.borderColor = '#667eea'; });
      nameInput.addEventListener('blur', function() { this.style.borderColor = '#e2e8f0'; });
      nameInput.addEventListener('input', function() {
        detectedFields[idx].name = this.value.trimStart().toUpperCase();
      });
      tdName.appendChild(nameInput);
      tr.appendChild(tdName);

      // Type dropdown
      var tdType = document.createElement('td');
      tdType.style.cssText = 'padding:7px 10px;';
      var typeSelect = document.createElement('select');
      typeSelect.style.cssText = 'font-size:11px;padding:3px 6px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;color:#334155;cursor:pointer;font-weight:500;';
      typeSelect.setAttribute('data-field-idx', idx);
      ALL_TYPES.forEach(function(t) {
        var opt = document.createElement('option');
        opt.value = t.value;
        opt.textContent = t.label;
        if (t.value === field.type) opt.selected = true;
        typeSelect.appendChild(opt);
      });
      typeSelect.addEventListener('change', function() {
        detectedFields[idx].type = this.value;
      });
      tdType.appendChild(typeSelect);
      tr.appendChild(tdType);

      // Mandatory toggle
      var tdMandatory = document.createElement('td');
      tdMandatory.style.cssText = 'padding:7px 10px;text-align:center;';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = field.mandatory;
      checkbox.style.cssText = 'width:16px;height:16px;cursor:pointer;accent-color:#22c55e;';
      checkbox.setAttribute('data-field-idx', idx);
      checkbox.addEventListener('change', function() {
        detectedFields[idx].mandatory = this.checked;
      });
      tdMandatory.appendChild(checkbox);
      tr.appendChild(tdMandatory);

      fieldsBody.appendChild(tr);
    });
  }

  function renderZipList() {
    zipList.innerHTML = '';
    zipFiles.forEach(function(f, idx) {
      var div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:#eff6ff;border-radius:5px;border:1px solid #bfdbfe;margin-bottom:4px;';
      div.innerHTML = '<i class="fa-solid fa-file-zipper" style="color:#3b82f6;"></i>' +
        '<span style="font-size:12px;font-weight:500;color:#1e293b;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + f.name + '</span>' +
        '<span style="font-size:11px;color:#6b7280;">' + (f.size / (1024*1024)).toFixed(1) + ' MB</span>' +
        '<button type="button" data-idx="' + idx + '" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:13px;padding:2px;"><i class="fa-solid fa-xmark"></i></button>';
      div.querySelector('button').addEventListener('click', function() {
        zipFiles.splice(idx, 1);
        renderZipList();
      });
      zipList.appendChild(div);
    });
  }

  function isRootLikePath(folderPath) {
    var normalized = String(folderPath || '').trim().replace(/\\/g, '/');
    if (!normalized) return false;

    if (normalized === '/') return true;
    if (/^[A-Za-z]:\/?$/.test(normalized)) return true;
    if (/^\/mnt\/?$/i.test(normalized)) return true;
    if (/^\/media\/?$/i.test(normalized)) return true;
    if (/^\/Volumes\/?$/i.test(normalized)) return true;
    return false;
  }

  function deriveUploadErrorMessage(xhr, parsedResult) {
    if (parsedResult && typeof parsedResult.message === 'string' && parsedResult.message.trim()) {
      return parsedResult.message.trim();
    }

    var responseText = xhr && typeof xhr.responseText === 'string' ? xhr.responseText : '';

    if (xhr && xhr.status === 413) {
      return 'Upload is too large. Use ZIP files or Server Folder Path.';
    }
    if (xhr && xhr.status === 429) {
      return 'Another upload is already running. Please wait for it to finish.';
    }
    if (xhr && xhr.status === 400 && /toomanyfilessent|too many files/i.test(responseText)) {
      return 'Too many files were selected. Use a smaller folder, ZIP files, or Server Folder Path.';
    }

    if (responseText) {
      var compact = responseText
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (compact && compact.length <= 220) {
        return compact;
      }
    }

    if (xhr && xhr.status >= 500) {
      return 'Server error while processing upload. Please try again.';
    }
    if (xhr && xhr.status > 0) {
      return 'Upload failed (HTTP ' + xhr.status + '). Please try again.';
    }
    return 'Network error. Please try again.';
  }

  function doUpload() {
    if (!selectedFile || isUploading) return;

    var folderPathValue = folderPathInput ? folderPathInput.value.trim() : '';
    var allowFolderUpload = isProUserFolderUploadEnabled();

    if (!allowFolderUpload && (folderPathValue || folderFiles.length)) {
      folderFiles = [];
      if (folderInput) folderInput.value = '';
      if (folderPathInput) folderPathInput.value = '';
      folderPathValue = '';
      if (folderSummary) folderSummary.textContent = 'No folder selected';
      if (window.showToast) showToast('Select Folder is available only for Pro User accounts.', 'warning');
    }

    if (allowFolderUpload && folderPathValue && folderPathValue !== confirmedRiskyFolderPath && isRootLikePath(folderPathValue)) {
      if (typeof window.showConfirm === 'function') {
        window.showConfirm({
          title: 'Use Root Folder Path?',
          text: 'This path looks like a root folder and may include too many files. Continue only if this is intentional.',
          icon: 'fa-solid fa-triangle-exclamation',
          confirmLabel: 'Use This Path',
          btnClass: 'btn-warning',
          warnings: [
            'Root paths can take very long to scan.',
            'Prefer a specific image subfolder when possible.'
          ]
        }).then(function(ok) {
          if (!ok) return;
          confirmedRiskyFolderPath = folderPathValue;
          doUpload();
        });
        return;
      }
    }
    confirmedRiskyFolderPath = '';

    cancelRequested = false;
    isUploading = true;
    clearUploadTimers();

    step1El.style.display = 'none';
    step2El.style.display = 'none';
    step3El.style.display = 'none';
    progress.style.display = '';
    progressText.textContent = 'Preparing upload';

    var progressBar = getByIdLatest('cxProgressBar');
    var progressPct = getByIdLatest('cxProgressPct');
    var progressIcon = getByIdLatest('cxProgressIcon');

    if (progressBar) progressBar.style.width = '0%';
    if (progressPct) progressPct.textContent = '';
    if (progressIcon) {
      progressIcon.className = 'cx-progress-skeleton-icon';
      progressIcon.style.animation = '';
    }
    var progressSkeletonStart = progressIcon ? Date.now() : null;
    function waitForProgressSkeleton() {
      if (!progressSkeletonStart) return Promise.resolve();
      var start = progressSkeletonStart;
      progressSkeletonStart = null;
      if (typeof window.waitForMinDelay === 'function') {
        return window.waitForMinDelay(start);
      }
      return Promise.resolve();
    }

    var formData = new FormData();
    formData.append('file', selectedFile);
    var tn = tableNameInput ? tableNameInput.value.trim() : '';
    if (tn) formData.append('table_name', tn);

    // Send field config (types + mandatory selections) as JSON
    if (detectedFields.length > 0) {
      formData.append('field_config', JSON.stringify(detectedFields));
    }

    zipFiles.forEach(function(f, i) {
      formData.append('unified_zip_' + i, f);
    });
    if (zipFiles.length > 0) {
      formData.append('unified_zip_count', zipFiles.length);
    }

    var filesToUpload = (allowFolderUpload && !folderPathValue) ? folderFiles : [];

    filesToUpload.forEach(function(f) {
      formData.append('photos_folder_files', f, f.webkitRelativePath || f.name);
    });

    if (allowFolderUpload && folderPathValue && folderFiles.length && window.showToast) {
      showToast('Using Server Folder Path. Local folder selection will be skipped.', 'warning');
    }
    if (allowFolderUpload && folderPathValue) {
      formData.append('photos_folder_path', folderPathValue);
    }

    var _createRetryCount = 0;
    var MAX_RETRIES = 2;

    function attemptUpload() {
      if (cancelRequested) return;

      var xhr = new XMLHttpRequest();
      activeXhr = xhr;
      xhr.open('POST', apiUrl, true);
      xhr.setRequestHeader('X-CSRFToken', csrfToken);
      xhr.timeout = 600000; // 10-minute timeout

      // Phase 1: Upload progress (0%  70%)
      xhr.upload.onprogress = function(e) {
        if (cancelRequested) return;
        if (e.lengthComputable) {
          var uploadPct = Math.round((e.loaded / e.total) * 70);
          if (progressBar) progressBar.style.width = uploadPct + '%';
          if (progressPct) progressPct.textContent = Math.round((e.loaded / e.total) * 100) + '% uploaded';
          progressText.textContent = 'Uploading file';
        }
      };

      // Phase 2: Upload complete  server processing (70%  95%)
      xhr.upload.onloadend = function() {
        if (cancelRequested) return;
        if (progressBar) progressBar.style.width = '70%';
        if (progressPct) progressPct.textContent = '';
        progressText.textContent = 'Creating table and importing data';
        var _procStart = Date.now();
        processingTimer = setInterval(function() {
          var el = (Date.now() - _procStart) / 1000;
          var pct = 70 + Math.round(25 * (1 - Math.exp(-el / 10)));
          if (progressBar) progressBar.style.width = Math.min(pct, 95) + '%';
        }, 400);
      };

      xhr.onload = function() {
        clearUploadTimers();
        activeXhr = null;
        if (cancelRequested) {
          finishUploadFlow();
          return;
        }
        var result = null;
        try {
          result = JSON.parse(xhr.responseText);
        } catch (_parseErr) {
          result = null;
        }
        try {
          if (xhr.status >= 200 && xhr.status < 300 && result.success) {
            finishUploadFlow();
            waitForProgressSkeleton().then(function() {
              if (progressBar) progressBar.style.width = '100%';
              if (progressPct) progressPct.textContent = 'Done!';
              if (progressIcon) { progressIcon.className = 'fa-solid fa-circle-check'; progressIcon.style.animation = 'none'; }
              progressText.textContent = result.message || 'Table created successfully!';
              if (window.showToast) showToast(result.message || 'Table created successfully!', 'success');
              if (window.alpineCloseModal) window.alpineCloseModal();
              setTimeout(onSuccess, 800);
            });
          } else if (xhr.status === 429) {
            finishUploadFlow();
            waitForProgressSkeleton().then(function() {
              var retryMsg = deriveUploadErrorMessage(xhr, result);
              if (window.showToast) showToast(retryMsg, 'warning');
              showStep(1);
            });
          } else {
            finishUploadFlow();
            waitForProgressSkeleton().then(function() {
              var failureMsg = deriveUploadErrorMessage(xhr, result);
              var level = (result && result.level) ? result.level : 'error';
              if (window.showToast) showToast(failureMsg, level);
              showStep(1);
            });
          }
        } catch (e) {
          console.error('Create from XLSX parse error:', e);
          finishUploadFlow();
          waitForProgressSkeleton().then(function() {
            var parseFailureMsg = deriveUploadErrorMessage(xhr, result);
            if (window.showToast) showToast(parseFailureMsg, 'error');
            showStep(1);
          });
        }
      };

      xhr.onerror = function() {
        clearUploadTimers();
        activeXhr = null;
        if (cancelRequested) {
          finishUploadFlow();
          return;
        }
        if (_createRetryCount < MAX_RETRIES) {
          _createRetryCount++;
          if (progressBar) progressBar.style.width = '0%';
          progressText.textContent = 'Network error. Retrying in 5s...';
          if (window.showToast) showToast('Network error. Retrying automatically...', 'error');
          retryTimer = setTimeout(attemptUpload, 5000);
          return;
        }
        finishUploadFlow();
        waitForProgressSkeleton().then(function() {
          if (window.showToast) showToast('Network error. Please try again.', 'error');
          showStep(1);
        });
      };

      xhr.onabort = function() {
        clearUploadTimers();
        activeXhr = null;
        if (cancelRequested) {
          cancelRequested = false;
          isUploading = false;
          return;
        }
        finishUploadFlow();
        if (window.showToast) showToast('Upload cancelled.', 'warning');
        showStep(3);
      };

      xhr.ontimeout = function() {
        clearUploadTimers();
        activeXhr = null;
        if (cancelRequested) {
          finishUploadFlow();
          return;
        }
        finishUploadFlow();
        waitForProgressSkeleton().then(function() {
          if (window.showToast) showToast('Upload timed out  server took too long. Try a smaller file.', 'error');
          showStep(1);
        });
      };

      xhr.send(formData);
    }

    attemptUpload();
  }

  //  Event listeners  Step 1 
  browse.addEventListener('click', function() { fileInput.click(); });
  dropzone.addEventListener('click', function() { fileInput.click(); });
  dropzone.addEventListener('dragover', function(e) { e.preventDefault(); dropzone.style.borderColor = '#22c55e'; dropzone.style.background = '#f0fdf4'; });
  dropzone.addEventListener('dragleave', function() { dropzone.style.borderColor = '#d1d5db'; dropzone.style.background = ''; });
  dropzone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropzone.style.borderColor = '#d1d5db'; dropzone.style.background = '';
    if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', function() { if (fileInput.files[0]) setFile(fileInput.files[0]); });
  fileRemove.addEventListener('click', function() {
    selectedFile = null; fileInput.value = '';
    fileInfo.style.display = 'none'; dropzone.style.display = '';
    nextBtn.disabled = true;
  });
  // Step 1  Step 2: Parse file and show field preview
  nextBtn.addEventListener('click', function() {
    if (selectedFile) parseFileAndShowPreview();
  });

  //  Event listeners  Step 2 (Field Preview) 
  backToStep1Btn.addEventListener('click', function() { showStep(1); });
  nextToStep3Btn.addEventListener('click', function() { showStep(3); });

  //  Event listeners  Step 3 (ZIP) 
  zipBrowse.addEventListener('click', function() { zipInput.click(); });
  zipDropzone.addEventListener('click', function() { zipInput.click(); });
  zipDropzone.addEventListener('dragover', function(e) { e.preventDefault(); zipDropzone.style.borderColor = '#3b82f6'; zipDropzone.style.background = '#eff6ff'; });
  zipDropzone.addEventListener('dragleave', function() { zipDropzone.style.borderColor = '#d1d5db'; zipDropzone.style.background = ''; });
  zipDropzone.addEventListener('drop', function(e) {
    e.preventDefault();
    zipDropzone.style.borderColor = '#d1d5db'; zipDropzone.style.background = '';
    Array.from(e.dataTransfer.files).forEach(function(f) {
      if (f.name.toLowerCase().endsWith('.zip') && f.size <= 1024 * 1024 * 1024) {
        zipFiles.push(f);
      }
    });
    renderZipList();
  });
  zipInput.addEventListener('change', function() {
    Array.from(zipInput.files).forEach(function(f) { zipFiles.push(f); });
    zipInput.value = '';
    renderZipList();
  });
  if (folderBrowse && folderInput) {
    folderBrowse.addEventListener('click', function() {
      if (!isProUserFolderUploadEnabled()) {
        if (window.showToast) showToast('Select Folder is available only for Pro User accounts.', 'warning');
        return;
      }
      var proceed = function() { folderInput.click(); };
      if (typeof window.showConfirm !== 'function') {
        proceed();
        return;
      }
      window.showConfirm({
        title: 'Select Local Folder?',
        text: 'This uploads files from a local folder. For large datasets, Server Folder Path is usually faster and safer.',
        icon: 'fa-solid fa-folder-open',
        confirmLabel: 'Choose Folder',
        btnClass: 'btn-primary',
        warnings: [
          'Choosing a root drive may trigger extra browser confirmation.',
          'Only image files are used; other files are ignored.'
        ]
      }).then(function(ok) {
        if (!ok) return;
        proceed();
      });
    });
  }
  if (folderInput) {
    folderInput.addEventListener('change', function() {
      if (!isProUserFolderUploadEnabled()) {
        folderFiles = [];
        this.value = '';
        if (folderSummary) folderSummary.textContent = 'No folder selected';
        if (window.showToast) showToast('Select Folder is available only for Pro User accounts.', 'warning');
        return;
      }
      var files = Array.from(folderInput.files || []);
      if (files.length > MAX_FOLDER_UPLOAD_FILES) {
        folderFiles = [];
        folderInput.value = '';
        if (folderSummary) {
          folderSummary.textContent = 'Selection too large. Choose a smaller folder or use Server Folder Path.';
        }
        if (window.showToast) {
          showToast('Selected folder has too many files. Use ZIP files or Server Folder Path.', 'warning');
        }
        return;
      }
      folderFiles = files.filter(function(f) {
        return /\.(jpe?g|png|gif|bmp|webp|heic|heif|hei)$/i.test(f.name || '');
      });
      if (folderPathInput && folderPathInput.value.trim()) {
        folderPathInput.value = '';
      }
      if (folderSummary) {
        if (folderFiles.length) {
          folderSummary.textContent = folderFiles.length + ' image file(s) selected from folder';
          if (files.length >= FOLDER_UPLOAD_CONFIRM_THRESHOLD && window.showToast) {
            showToast('Large folder selected. If upload is slow, use ZIP files or Server Folder Path.', 'warning');
          }
        } else {
          folderSummary.textContent = 'No valid image files found in selected folder';
        }
      }
    });
  }
  if (folderPathInput) {
    folderPathInput.addEventListener('input', function() {
      if (!isProUserFolderUploadEnabled()) {
        this.value = '';
        return;
      }
      if (!this.value.trim() || !folderFiles.length) return;
      folderFiles = [];
      if (folderInput) folderInput.value = '';
      if (folderSummary) folderSummary.textContent = 'Using Server Folder Path';
    });
  }
  backBtn.addEventListener('click', function() { showStep(2); });
  skipBtn.addEventListener('click', function() {
    zipFiles = [];
    folderFiles = [];
    if (folderInput) folderInput.value = '';
    if (folderSummary) folderSummary.textContent = 'No folder selected';
    if (folderPathInput) folderPathInput.value = '';
    doUpload();
  });
  uploadBtn.addEventListener('click', function() { doUpload(); });
  if (progressCancelBtn) {
    progressCancelBtn.addEventListener('click', function() {
      abortCurrentUpload({ returnToStep: 3 });
    });
  }
  if (headerCloseBtn) {
    headerCloseBtn.addEventListener('click', function() {
      abortCurrentUpload({ silent: true });
    });
  }

  //  Button trigger 
  bindTriggerButtons();
}

(function bootstrapCreateWithXlsx() {
  function safeParseJson(el) {
    if (!el) return {};
    try {
      return JSON.parse(el.textContent || '{}');
    } catch (_err) {
      return {};
    }
  }

  function resolveApiConfig() {
    var cfg = safeParseJson(document.getElementById('page-config'));
    var isClientRole = !!(cfg.isClientRole || cfg.isClient || cfg.isClientStaff);
    var groupId = cfg.groupId;
    var apiUrl = isClientRole
      ? '/client/api/create-from-xlsx/'
      : (groupId ? ('/api/group/' + groupId + '/table/create-from-xlsx/') : null);
    var csrf = cfg.csrfToken
      || (window.getCSRFToken ? window.getCSRFToken() : '')
      || (document.querySelector('meta[name="csrf-token"]') ? document.querySelector('meta[name="csrf-token"]').getAttribute('content') : '');
    return { apiUrl: apiUrl, csrfToken: csrf };
  }

  function defaultRefreshBridge() {
    if (window.IDCardGroup && typeof window.IDCardGroup.refreshTable === 'function') {
      window.IDCardGroup.refreshTable();
    }
    if (typeof htmx !== 'undefined') {
      htmx.trigger(document.body, 'refreshTable');
    }
  }

  function maybeInit() {
    if (!document.querySelector('[id="cxDropzone"]')) return;
    if (!document.querySelector('[id="createFromXlsxBtn"]')) return;
    var cfg = resolveApiConfig();
    if (!cfg.apiUrl) return;
    initCreateWithXlsx({
      apiUrl: cfg.apiUrl,
      csrfToken: cfg.csrfToken || '',
      onSuccess: defaultRefreshBridge,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeInit);
  } else {
    maybeInit();
  }

  document.body.addEventListener('htmx:afterSwap', maybeInit);
})();
