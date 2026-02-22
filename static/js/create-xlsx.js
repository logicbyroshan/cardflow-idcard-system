/**
 * Create with XLSX — 2-step modal controller
 *
 * Usage:
 *   initCreateWithXlsx({ apiUrl: '...', onSuccess: function() {} });
 *
 * Depends on: Alpine.js (for modal open/close), showToast()
 */
function initCreateWithXlsx(opts) {
  var apiUrl     = opts.apiUrl;
  var onSuccess  = opts.onSuccess || function() { window.location.reload(); };
  var csrfToken  = opts.csrfToken || '';

  // Elements — Step 1
  var dropzone   = document.getElementById('cxDropzone');
  var browse     = document.getElementById('cxBrowse');
  var fileInput  = document.getElementById('cxFileInput');
  var fileInfo   = document.getElementById('cxFileInfo');
  var fileName   = document.getElementById('cxFileName');
  var fileRemove = document.getElementById('cxFileRemove');
  var nextBtn    = document.getElementById('cxNextBtn');
  var tableNameInput = document.getElementById('cxTableName');

  // Elements — Step 2
  var zipDropzone = document.getElementById('cxZipDropzone');
  var zipBrowse   = document.getElementById('cxZipBrowse');
  var zipInput    = document.getElementById('cxZipInput');
  var zipList     = document.getElementById('cxZipList');
  var backBtn     = document.getElementById('cxBackBtn');
  var skipBtn     = document.getElementById('cxSkipBtn');
  var uploadBtn   = document.getElementById('cxUploadBtn');

  // Step indicators
  var step1Dot   = document.getElementById('cxStep1Dot');
  var step2Dot   = document.getElementById('cxStep2Dot');
  var stepLineFill = document.getElementById('cxStepLineFill');

  // Progress
  var progress     = document.getElementById('cxProgress');
  var progressText = document.getElementById('cxProgressText');

  var step1El = document.getElementById('cxStep1');
  var step2El = document.getElementById('cxStep2');

  if (!dropzone || !fileInput) return;

  var selectedFile = null;
  var zipFiles = [];

  // ── Helpers ──
  function showStep(n) {
    step1El.style.display = n === 1 ? '' : 'none';
    step2El.style.display = n === 2 ? '' : 'none';
    progress.style.display = 'none';
    step1Dot.style.background = n >= 1 ? '#22c55e' : '#e5e7eb';
    step2Dot.style.background = n >= 2 ? '#22c55e' : '#e5e7eb';
    stepLineFill.style.width = n >= 2 ? '100%' : '0%';
  }

  function resetModal() {
    selectedFile = null;
    zipFiles = [];
    fileInfo.style.display = 'none';
    dropzone.style.display = '';
    nextBtn.disabled = true;
    fileInput.value = '';
    zipInput.value = '';
    zipList.innerHTML = '';
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
    progress.style.display = '';
    progressText.textContent = 'Creating table and importing data…';

    var formData = new FormData();
    formData.append('file', selectedFile);
    var tn = tableNameInput ? tableNameInput.value.trim() : '';
    if (tn) formData.append('table_name', tn);

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
  nextBtn.addEventListener('click', function() { if (selectedFile) showStep(2); });

  // ── Event listeners — Step 2 ──
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
  backBtn.addEventListener('click', function() { showStep(1); });
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
