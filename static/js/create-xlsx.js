/**
 * Create with XLSX — 3-step modal controller
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
  var onSuccess  = opts.onSuccess || function() { window.location.reload(); };
  var csrfToken  = opts.csrfToken || '';

  // ── Header → type map (mirrors backend _HEADER_TYPE_MAP) ──
  var HEADER_TYPE_MAP = [
    { patterns: ['mother photo', 'm photo', 'mother_photo', 'mother pic'], type: 'mother_photo' },
    { patterns: ['father photo', 'f photo', 'father_photo', 'father pic'], type: 'father_photo' },
    { patterns: ['photo', 'pic', 'picture', 'image', 'student photo', 'student image'], type: 'photo' },
    { patterns: ['signature', 'sign'], type: 'signature' },
    { patterns: ['barcode'], type: 'barcode' },
    { patterns: ['qr code', 'qr_code', 'qr'], type: 'qr_code' },
    { patterns: ['class'], type: 'class' },
    { patterns: ['section', 'sec'], type: 'section' },
    { patterns: ['email', 'e-mail', 'email id', 'email address'], type: 'email' }
  ];

  var ALL_TYPES = [
    { value: 'text',         label: 'Text' },
    { value: 'class',        label: 'Class' },
    { value: 'section',      label: 'Section' },
    { value: 'email',        label: 'Email' },
    { value: 'photo',        label: 'Photo' },
    { value: 'mother_photo', label: 'Mother Photo' },
    { value: 'father_photo', label: 'Father Photo' },
    { value: 'signature',    label: 'Signature' },
    { value: 'barcode',      label: 'Barcode' },
    { value: 'qr_code',      label: 'QR Code' }
  ];

  function inferFieldType(headerName) {
    var normalized = headerName.trim().toLowerCase().replace(/_/g, ' ');
    for (var i = 0; i < HEADER_TYPE_MAP.length; i++) {
      if (HEADER_TYPE_MAP[i].patterns.indexOf(normalized) !== -1) {
        return HEADER_TYPE_MAP[i].type;
      }
    }
    return 'text';
  }

  // Elements — Step 1
  var dropzone   = document.getElementById('cxDropzone');
  var browse     = document.getElementById('cxBrowse');
  var fileInput  = document.getElementById('cxFileInput');
  var fileInfo   = document.getElementById('cxFileInfo');
  var fileName   = document.getElementById('cxFileName');
  var fileRemove = document.getElementById('cxFileRemove');
  var nextBtn    = document.getElementById('cxNextBtn');
  var tableNameInput = document.getElementById('cxTableName');

  // Elements — Step 2 (Field Preview)
  var fieldsBody     = document.getElementById('cxFieldsBody');
  var dataRowsCount  = document.getElementById('cxDataRowsCount');
  var backToStep1Btn = document.getElementById('cxBackToStep1');
  var nextToStep3Btn = document.getElementById('cxNextToStep3');

  // Elements — Step 3 (ZIP)
  var zipDropzone = document.getElementById('cxZipDropzone');
  var zipBrowse   = document.getElementById('cxZipBrowse');
  var zipInput    = document.getElementById('cxZipInput');
  var zipList     = document.getElementById('cxZipList');
  var backBtn     = document.getElementById('cxBackBtn');
  var skipBtn     = document.getElementById('cxSkipBtn');
  var uploadBtn   = document.getElementById('cxUploadBtn');

  // Step indicators (3-step)
  var step1Dot       = document.getElementById('cxStep1Dot');
  var step2Dot       = document.getElementById('cxStep2Dot');
  var step3Dot       = document.getElementById('cxStep3Dot');
  var stepLineFill1  = document.getElementById('cxStepLineFill1');
  var stepLineFill2  = document.getElementById('cxStepLineFill2');

  // Progress
  var progress     = document.getElementById('cxProgress');
  var progressText = document.getElementById('cxProgressText');

  var step1El = document.getElementById('cxStep1');
  var step2El = document.getElementById('cxStep2');
  var step3El = document.getElementById('cxStep3');

  if (!dropzone || !fileInput) return;

  var selectedFile = null;
  var zipFiles = [];
  var detectedFields = [];
  var parsedDataRowCount = 0;

  // ── Helpers ──
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

  function resetModal() {
    selectedFile = null;
    zipFiles = [];
    detectedFields = [];
    parsedDataRowCount = 0;
    fileInfo.style.display = 'none';
    dropzone.style.display = '';
    nextBtn.disabled = true;
    fileInput.value = '';
    zipInput.value = '';
    zipList.innerHTML = '';
    fieldsBody.innerHTML = '';
    if (tableNameInput) tableNameInput.value = '';
    showStep(1);
  }

  function setFile(file) {
    if (!file) return;
    var name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) {
      if (window.showToast) showToast('Only .xlsx, .xls, .csv files are supported.', 'error');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      if (window.showToast) showToast('File must be under 50 MB.', 'error');
      return;
    }
    selectedFile = file;
    fileName.textContent = file.name;
    fileInfo.style.display = '';
    dropzone.style.display = 'none';
    nextBtn.disabled = false;
  }

  // ── Parse XLSX and detect fields ──
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

        detectedFields = headers.map(function(header, idx) {
          return {
            name: header.toUpperCase(),
            type: inferFieldType(header),
            mandatory: false,
            order: idx
          };
        });

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

      // Column name
      var tdName = document.createElement('td');
      tdName.style.cssText = 'padding:7px 10px;font-weight:600;color:#1e293b;';
      tdName.textContent = field.name;
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

  function doUpload() {
    step1El.style.display = 'none';
    step2El.style.display = 'none';
    step3El.style.display = 'none';
    progress.style.display = '';
    progressText.textContent = 'Creating table and importing data…';

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

    fetch(apiUrl, {
      method: 'POST',
      headers: { 'X-CSRFToken': csrfToken },
      body: formData
    })
    .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
    .then(function(result) {
      if (result.data.success) {
        if (window.showToast) showToast(result.data.message || 'Table created successfully!', 'success');
        if (window.alpineCloseModal) window.alpineCloseModal();
        setTimeout(onSuccess, 800);
      } else {
        if (window.showToast) showToast(result.data.message || 'Failed to create table.', 'error');
        showStep(1);
      }
    })
    .catch(function(err) {
      console.error('Create from XLSX error:', err);
      if (window.showToast) showToast('Network error. Please try again.', 'error');
      showStep(1);
    });
  }

  // ── Event listeners — Step 1 ──
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
  // Step 1 → Step 2: Parse file and show field preview
  nextBtn.addEventListener('click', function() {
    if (selectedFile) parseFileAndShowPreview();
  });

  // ── Event listeners — Step 2 (Field Preview) ──
  backToStep1Btn.addEventListener('click', function() { showStep(1); });
  nextToStep3Btn.addEventListener('click', function() { showStep(3); });

  // ── Event listeners — Step 3 (ZIP) ──
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
  backBtn.addEventListener('click', function() { showStep(2); });
  skipBtn.addEventListener('click', function() { zipFiles = []; doUpload(); });
  uploadBtn.addEventListener('click', function() { doUpload(); });

  // ── Button trigger ──
  var btn = document.getElementById('createFromXlsxBtn');
  if (btn) {
    btn.addEventListener('click', function() {
      resetModal();
      if (window.alpineOpenModal) window.alpineOpenModal('createXlsx');
    });
  }
}
