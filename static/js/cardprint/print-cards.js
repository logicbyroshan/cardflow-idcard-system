/**
 * Print Cards  Single-file JS for the Print Cards workflow.
 * Steps: Generate List  (Configure & Generate)  Finalized
 *
 * Self-contained for the cardprint app.
 */
(function() {
'use strict';

var TABLE_ID = window.TABLE_ID;
if (!TABLE_ID) return;

/* 
   SHARED HELPERS
    */
var getCSRFToken = window.getCSRFToken || function() { return ''; };
var showToast    = window.showToast    || function() {};
var escapeHtml   = window.escapeHtml   || function(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

function isImageField(type, name) {
  if (!type && !name) return false;
  var t = (type || '').toLowerCase();
  var n = (name || '').toLowerCase();
  return t === 'image' || t === 'photo' || t === 'file' ||
         n === 'photo' || n === 'image' || n === 'picture' || n === 'pic' || n === 'img';
}

function updateTabCount(sel, count) {
  var el = document.querySelector(sel);
  if (el) el.textContent = count;
}

function refreshStepCounts() {
  ApiClient.get('/print/api/table/' + TABLE_ID + '/step-counts/')
    .then(function(data) {
      if (data.status === 'ok') {
        updateTabCount('.print-approved-tab .tab-count', data.approved || 0);
        updateTabCount('.print-generate-tab .tab-count', data.generate_list || 0);
        updateTabCount('.print-finalized-tab .tab-count', data.finalized || 0);
      }
    }).catch(function() {});
}

function _filenameFromDisposition(disposition, fallbackName) {
  if (!disposition) return fallbackName;
  var m = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
  if (!m || !m[1]) return fallbackName;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, '%20'));
  } catch (e) {
    return m[1];
  }
}

function _triggerUrlDownload(url, filename) {
  var a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function _downloadBlobExport(url, payload, fallbackFilename, successMessage) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken(),
    },
    body: JSON.stringify(payload),
  }).then(function(resp) {
    var contentType = (resp.headers.get('Content-Type') || '').toLowerCase();
    if (!resp.ok) {
      if (contentType.indexOf('application/json') !== -1) {
        return resp.json().then(function(data) {
          throw new Error((data && data.message) || ('Export failed (HTTP ' + resp.status + ')'));
        });
      }
      throw new Error('Export failed (HTTP ' + resp.status + ')');
    }
    if (contentType.indexOf('application/json') !== -1) {
      return resp.json().then(function(data) {
        throw new Error((data && data.message) || 'Export failed');
      });
    }
    return resp.blob().then(function(blob) {
      var filename = _filenameFromDisposition(resp.headers.get('Content-Disposition'), fallbackFilename);
      if (typeof ApiClient !== 'undefined' && ApiClient.downloadBlob) {
        ApiClient.downloadBlob(blob, filename);
      } else {
        var blobUrl = window.URL.createObjectURL(blob);
        _triggerUrlDownload(blobUrl, filename);
        window.URL.revokeObjectURL(blobUrl);
      }
      showToast(successMessage || 'Download complete', 'success');
    });
  });
}

function _downloadImageExport(url, payload) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken(),
    },
    body: JSON.stringify(payload),
  }).then(function(resp) {
    return resp.json().then(function(data) {
      if (!resp.ok || !data || !data.success) {
        throw new Error((data && data.message) || ('Image export failed (HTTP ' + resp.status + ')'));
      }

      var files = [];
      if (Array.isArray(data.files) && data.files.length) files = data.files;
      else if (Array.isArray(data.zip_files) && data.zip_files.length) files = data.zip_files;
      else if (data.download_url) files = [{ download_url: data.download_url, filename: data.filename || 'images.zip' }];

      if (!files.length) {
        throw new Error('No image files available to download');
      }

      files.forEach(function(item) {
        if (item.download_url) {
          _triggerUrlDownload(item.download_url, item.filename || 'images.zip');
          return;
        }
        if (item.data && typeof ApiClient !== 'undefined' && ApiClient.downloadBase64) {
          ApiClient.downloadBase64(item.data, item.filename || 'images.zip', 'application/zip');
        }
      });
      showToast('Image download started', 'success');
    });
  });
}

/** Render a single image cell as HTML */
function renderImageCell(f) {
  var html = '<td class="w-[28px] px-[1px] py-1 text-center align-middle image-field image-cell" data-field="' + escapeHtml(f.name) + '" data-field-name="' + escapeHtml(f.name) + '" data-field-type="image" data-original-value="' + escapeHtml(f.value || '') + '">';
  html += '<div class="image-with-edit">';
  if (f.value && f.value !== '' && f.value !== 'NOT_FOUND' && !f.value.startsWith('PENDING:')) {
    var thumbPath = (typeof window.getThumbPath === 'function') ? window.getThumbPath(f.value) : null;
    var thumbSrc = thumbPath ? ('/media/' + thumbPath) : ('/media/' + f.value);
    html += '<img src="' + thumbSrc + '" alt="' + escapeHtml(f.name) + '" class="table-image" loading="lazy" onerror="this.onerror=null; this.src=\'/media/' + f.value + '\'">';
  } else if (f.value && f.value.startsWith('PENDING:')) {
    html += '<div class="no-image pending-placeholder" title="Waiting for upload"><i class="fa-solid fa-clock"></i></div>';
  } else {
    html += '<div class="no-image colorful-placeholder" title="No image"><i class="fa-solid fa-user-astronaut"></i></div>';
  }
  html += '</div></td>';
  return html;
}

/** Render a single text cell as HTML */
function renderTextCell(f) {
  var widthClass = (window.FieldClassifier) ? window.FieldClassifier.tdClass(f.name, f.type) : '';
  return '<td class="dynamic-field ' + widthClass + ' px-[1px] py-1 align-middle" data-field="' + escapeHtml(f.name) + '" data-field-name="' + escapeHtml(f.name) + '" data-field-type="' + escapeHtml(f.type || 'text') + '" data-original-value="' + escapeHtml(f.value || '') + '"><span class="cell-value">' + escapeHtml(f.value || '-') + '</span></td>';
}

/** Render ordered fields (text first, then images) */
function renderOrderedFields(fields) {
  if (!fields) return '';
  var html = '';
  fields.forEach(function(f) { if (!isImageField(f.type, f.name)) html += renderTextCell(f); });
  fields.forEach(function(f) { if (isImageField(f.type, f.name)) html += renderImageCell(f); });
  return html;
}


/* 
   PAGINATION FACTORY
    */
function createPaginator(opts) {
  var currentPage = 1;
  var rowsPerPage = 50;

  var bar = document.getElementById(opts.barId);
  if (!bar) return null;

  var showingRange = document.getElementById(opts.prefix + 'ShowingRange');
  var totalCountEl = document.getElementById(opts.prefix + 'TotalCount');
  var firstBtn = document.getElementById(opts.prefix + 'FirstPage');
  var prevBtn  = document.getElementById(opts.prefix + 'PrevPage');
  var nextBtn  = document.getElementById(opts.prefix + 'NextPage');
  var lastBtn  = document.getElementById(opts.prefix + 'LastPage');
  var pageNumsEl = document.getElementById(opts.prefix + 'PageNumbers');
  var selInfoEl  = document.getElementById(opts.prefix + 'SelectionInfo');
  var selCountEl = document.getElementById(opts.prefix + 'SelectedCount');
  var rowsDropdown = document.getElementById(opts.prefix + 'RowsDropdown');
  var rowsToggle   = document.getElementById(opts.prefix + 'RowsToggle');
  var rowsOptions  = document.getElementById(opts.prefix + 'RowsOptions');
  var rowsSelText  = document.getElementById(opts.prefix + 'RowsSelectedText');

  function getAllRows() {
    var tb = opts.getTableBody();
    return tb ? Array.from(tb.querySelectorAll('tr:not(.no-data-row)')) : [];
  }

  function paginate() {
    var rows = getAllRows();
    var total = rows.length;
    if (total === 0) {
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = '0';
      if (bar) bar.style.display = 'none';
      return;
    }
    if (bar) bar.style.display = '';
    var rpp = (rowsPerPage === 'all') ? total : rowsPerPage;
    var totalPages = Math.ceil(total / rpp);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    var startIdx = (currentPage - 1) * rpp;
    var endIdx = Math.min(startIdx + rpp, total);
    rows.forEach(function(row, idx) {
      row.style.display = (idx >= startIdx && idx < endIdx) ? '' : 'none';
    });
    if (showingRange) showingRange.textContent = (startIdx + 1) + '-' + endIdx;
    if (totalCountEl) totalCountEl.textContent = total;
    renderPageNumbers(totalPages);
    if (firstBtn) firstBtn.disabled = currentPage <= 1;
    if (prevBtn)  prevBtn.disabled  = currentPage <= 1;
    if (nextBtn)  nextBtn.disabled  = currentPage >= totalPages;
    if (lastBtn)  lastBtn.disabled  = currentPage >= totalPages;
  }

  function renderPageNumbers(totalPages) {
    if (!pageNumsEl) return;
    var html = '';
    var start = Math.max(1, currentPage - 2);
    var end = Math.min(totalPages, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (var i = start; i <= end; i++) {
      html += '<button class="page-num' + (i === currentPage ? ' active' : '') + '" data-page="' + i + '">' + i + '</button>';
    }
    pageNumsEl.innerHTML = html;
  }

  function goToPage(page) {
    var rows = getAllRows();
    var total = rows.length;
    var rpp = (rowsPerPage === 'all') ? total : rowsPerPage;
    var maxPage = Math.max(1, Math.ceil(total / rpp));
    currentPage = Math.max(1, Math.min(page, maxPage));
    paginate();
  }

  function reset() { currentPage = 1; }

  function updateSelectionCount(count) {
    if (selInfoEl && selCountEl) {
      if (count > 0) { selCountEl.textContent = count; selInfoEl.style.display = ''; }
      else { selInfoEl.style.display = 'none'; }
    }
  }

  if (firstBtn) firstBtn.addEventListener('click', function() { goToPage(1); });
  if (prevBtn)  prevBtn.addEventListener('click', function()  { goToPage(currentPage - 1); });
  if (nextBtn)  nextBtn.addEventListener('click', function()  { goToPage(currentPage + 1); });
  if (lastBtn)  lastBtn.addEventListener('click', function()  {
    var rows = getAllRows();
    var total = rows.length;
    var rpp = (rowsPerPage === 'all') ? total : rowsPerPage;
    goToPage(Math.max(1, Math.ceil(total / rpp)));
  });

  if (pageNumsEl) {
    pageNumsEl.addEventListener('click', function(e) {
      var btn = e.target.closest('.page-num');
      if (btn) goToPage(parseInt(btn.dataset.page));
    });
  }

  if (rowsToggle && rowsDropdown) {
    rowsToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      rowsDropdown.classList.toggle('open');
    });
  }

  if (rowsOptions) {
    rowsOptions.addEventListener('click', function(e) {
      var option = e.target.closest('.dropdown-option');
      if (!option) return;
      var val = option.dataset.value;
      rowsPerPage = (val === 'all') ? 'all' : parseInt(val);
      currentPage = 1;
      rowsOptions.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
      option.classList.add('selected');
      if (rowsSelText) rowsSelText.textContent = (val === 'all') ? 'All' : val;
      if (rowsDropdown) rowsDropdown.classList.remove('open');
      paginate();
    });
  }

  document.addEventListener('click', function(e) {
    if (rowsDropdown && !rowsDropdown.contains(e.target)) {
      rowsDropdown.classList.remove('open');
    }
  });

  return { paginate: paginate, reset: reset, updateSelectionCount: updateSelectionCount, goToPage: goToPage };
}


/* 
   STEP 1: GENERATE LIST (status = generate_list)
   Actions: Continue Generate (bulk selected), View
    */
(function generateListStep() {
  var tableBody      = document.getElementById('generateListTableBody');
  var searchInput    = document.getElementById('generateListSearchInput');
  var searchClearBtn = document.getElementById('generateListSearchClearBtn');
  var continueBtn    = document.getElementById('continueGenerateBtn');
  var viewBtn        = document.getElementById('generateListViewBtn');
  var retrieveBtn    = document.getElementById('generateRetrieveBtn');
  var dlImgBtn       = document.getElementById('generateDownloadImgBtn');
  var dlDocxBtn      = document.getElementById('generateDownloadDocxBtn');
  var dlXlsxBtn      = document.getElementById('generateDownloadXlsxBtn');
  var dlPdfBtn       = document.getElementById('generateDownloadPdfBtn');
  var showingRange   = document.getElementById('generateListShowingRange');
  var totalCountEl   = document.getElementById('generateListTotalCount');

  if (!tableBody) return;

  var paginator = createPaginator({
    barId: 'generateListPaginationBar',
    prefix: 'generateList',
    getTableBody: function() { return tableBody; }
  });
  if (paginator) paginator.paginate();

  function getRows() {
    return Array.from(tableBody.querySelectorAll('tr[data-pr-id]'));
  }
  function getAllPrIds() {
    return getRows().map(function(row) { return parseInt(row.dataset.prId, 10); })
      .filter(function(v) { return Number.isFinite(v); });
  }
  function getAllCardIds() {
    return getRows().map(function(row) { return parseInt(row.dataset.cardId, 10); })
      .filter(function(v) { return Number.isFinite(v); });
  }

  function updateSelectionUI() {
    var count = getAllPrIds().length;
    if (continueBtn) continueBtn.disabled = count === 0;
    if (viewBtn) viewBtn.disabled = count === 0;
    if (retrieveBtn) retrieveBtn.disabled = count === 0;
    if (dlImgBtn) dlImgBtn.disabled = count === 0;
    if (dlDocxBtn) dlDocxBtn.disabled = count === 0;
    if (dlXlsxBtn) dlXlsxBtn.disabled = count === 0;
    if (dlPdfBtn) dlPdfBtn.disabled = count === 0;
    if (paginator) paginator.updateSelectionCount(0);
  }

  // Initialize action states from current full-list rows (no checkbox dependency).
  updateSelectionUI();

  function openGeneratorWithSelection(prIds) {
    window.GEN_PRESELECT_PR_IDS = Array.isArray(prIds) ? prIds.slice() : [];
    if (typeof window.openGcEditorModal === 'function') {
      window.openGcEditorModal();
      if (typeof window.gcEditorRefresh === 'function') {
        window.gcEditorRefresh(window.FRONT_PDF_URL || undefined, window.BACK_PDF_URL || undefined);
      }
    } else {
      window.location.href = '/print/generate-card/table/' + TABLE_ID + '/';
    }
  }

  if (continueBtn) {
    continueBtn.addEventListener('click', function() {
      var ids = getAllPrIds();
      if (ids.length === 0) return;
      openGeneratorWithSelection(ids);
    });
  }

  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      var cardIds = getAllCardIds();
      if (cardIds.length === 0) return;
      if (typeof fetchCardAndOpenModal === 'function') fetchCardAndOpenModal('view', cardIds[0]);
    });
  }

  if (retrieveBtn) {
    retrieveBtn.addEventListener('click', async function() {
      var prIds = getAllPrIds();
      if (prIds.length === 0) return;
      var ok = true;
      if (typeof showConfirm === 'function') {
        ok = await showConfirm({
          title: 'Retrieve to Approved?',
          text: 'Move ' + prIds.length + ' item(s) from Generate List back to Approved List?',
          icon: 'fa-solid fa-arrow-rotate-left',
          confirmLabel: 'Retrieve',
          btnClass: 'btn-primary',
          hideWarning: true,
        });
      } else {
        ok = window.confirm('Move selected items back to Approved List?');
      }
      if (!ok) return;

      ApiClient.post('/print/api/table/' + TABLE_ID + '/retrieve-generate/', { request_ids: prIds })
        .then(function(data) {
          if (!data || data.status !== 'ok') {
            showToast((data && data.message) || 'Retrieve failed', 'error');
            return;
          }
          showToast(data.message || 'Moved back to approved list', 'success');
          fetchGenerateItems(searchInput ? searchInput.value.trim() : '');
          refreshStepCounts();
        })
        .catch(function(err) {
          showToast((err && err.message) || 'Retrieve failed', 'error');
        });
    });
  }

  function runGenerateDownload(kind) {
    var cardIds = getAllCardIds();
    if (cardIds.length === 0) {
      showToast('No cards available to download', 'error');
      return;
    }

    var payload = { card_ids: cardIds };
    if (kind === 'img') {
      _downloadImageExport('/api/table/' + TABLE_ID + '/cards/download-images/', payload)
        .catch(function(err) { showToast((err && err.message) || 'Image export failed', 'error'); });
      return;
    }
    if (kind === 'docx') {
      _downloadBlobExport('/api/table/' + TABLE_ID + '/cards/download-docx/', payload, 'cards.docx', 'Word download complete')
        .catch(function(err) { showToast((err && err.message) || 'Word export failed', 'error'); });
      return;
    }
    if (kind === 'xlsx') {
      _downloadBlobExport('/api/table/' + TABLE_ID + '/cards/download-xlsx/', payload, 'cards.xlsx', 'Excel download complete')
        .catch(function(err) { showToast((err && err.message) || 'Excel export failed', 'error'); });
      return;
    }
    if (kind === 'pdf') {
      _downloadBlobExport('/api/table/' + TABLE_ID + '/cards/download-pdf/', payload, 'cards.pdf', 'PDF download complete')
        .catch(function(err) { showToast((err && err.message) || 'PDF export failed', 'error'); });
    }
  }

  if (dlImgBtn) dlImgBtn.addEventListener('click', function() { runGenerateDownload('img'); });
  if (dlDocxBtn) dlDocxBtn.addEventListener('click', function() { runGenerateDownload('docx'); });
  if (dlXlsxBtn) dlXlsxBtn.addEventListener('click', function() { runGenerateDownload('xlsx'); });
  if (dlPdfBtn) dlPdfBtn.addEventListener('click', function() { runGenerateDownload('pdf'); });

  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchGenerateItems(q); }, 350);
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      searchInput.focus();
      fetchGenerateItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  function fetchGenerateItems(query) {
    var url = '/print/api/table/' + TABLE_ID + '/generate-list/?q=' + encodeURIComponent(query || '') + '&limit=200';
    ApiClient.get(url)
    .then(function(data) {
      if (data.status === 'ok') renderGenerateItems(data.items || [], data.total || 0);
    }).catch(function(err) { console.error('[GenerateList] Search failed:', err); });
  }

  function renderGenerateItems(items, total) {
    if (items.length === 0) {
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-gears"></i><span>No cards in generate list</span></div></td></tr>';
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = total;
      updateSelectionUI();
      return;
    }
    var html = '';
    items.forEach(function(item, idx) {
      html += '<tr data-pr-id="' + item.pr_id + '" data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields);
      html += '<td class="w-[65px] px-[1px] py-1 align-middle user-cell text-center">' + escapeHtml(item.requested_by_name || '-') + '</td>';
      html += '<td class="w-[90px] px-[1px] py-1 align-middle date-cell text-center">' + escapeHtml(item.moved_at || '-') + '</td>';
      html += '</tr>';
    });
    tableBody.innerHTML = html;
    if (showingRange) showingRange.textContent = '1-' + items.length;
    if (totalCountEl) totalCountEl.textContent = total;
    updateSelectionUI();
    if (paginator) { paginator.reset(); paginator.paginate(); }
  }

})();


/* 
  STEP 2: FINALIZED LIST (status = finalized)
   Actions: Move to Pool (bulk + single)
    */
(function finalizedStep() {
  var tableBody     = document.getElementById('finalizedTableBody');
  var selectAllCb   = document.getElementById('finalizedSelectAll');
  var searchInput   = document.getElementById('finalizedSearchInput');
  var searchClearBtn = document.getElementById('finalizedSearchClearBtn');
  var poolBtn       = document.getElementById('finalizedMoveToPoolBtn');
  var viewBtn       = document.getElementById('finalizedViewBtn');
  var retrieveBtn   = document.getElementById('finalizedRetrieveBtn');
  var dlImgBtn      = document.getElementById('finalizedDownloadImgBtn');
  var dlDocxBtn     = document.getElementById('finalizedDownloadDocxBtn');
  var dlXlsxBtn     = document.getElementById('finalizedDownloadXlsxBtn');
  var dlPdfBtn      = document.getElementById('finalizedDownloadPdfBtn');
  var showingRange  = document.getElementById('finalizedShowingRange');
  var totalCountEl  = document.getElementById('finalizedTotalCount');

  if (!tableBody) return;

  var paginator = createPaginator({
    barId: 'finalizedPaginationBar',
    prefix: 'finalized',
    getTableBody: function() { return tableBody; }
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.finalizedRowCheckbox:not(:disabled)'));
  }
  function getSelectedPrIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.prId); });
  }
  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId); });
  }
  function getAllPrIds() {
    return Array.from(tableBody.querySelectorAll('tr[data-pr-id]'))
      .map(function(row) { return parseInt(row.dataset.prId, 10); })
      .filter(function(v) { return Number.isFinite(v); });
  }
  function getAllCardIds() {
    return Array.from(tableBody.querySelectorAll('tr[data-card-id]'))
      .map(function(row) { return parseInt(row.dataset.cardId, 10); })
      .filter(function(v) { return Number.isFinite(v); });
  }
  function getCardIdsForDownload() {
    var selected = getSelectedCardIds();
    return selected.length > 0 ? selected : getAllCardIds();
  }

  function updateSelectionUI() {
    var ids = getSelectedPrIds();
    var count = ids.length;
    if (poolBtn) poolBtn.disabled = count === 0;
    if (viewBtn) viewBtn.disabled = count !== 1;
    if (retrieveBtn) retrieveBtn.disabled = count === 0;
    if (dlImgBtn) dlImgBtn.disabled = count === 0;
    if (dlDocxBtn) dlDocxBtn.disabled = count === 0;
    if (dlXlsxBtn) dlXlsxBtn.disabled = count === 0;
    if (dlPdfBtn) dlPdfBtn.disabled = count === 0;
    if (paginator) paginator.updateSelectionCount(count);
    if (selectAllCb) {
      var allCbs = getCheckboxes();
      var allChecked = allCbs.length > 0 && allCbs.every(function(cb) { return cb.checked; });
      var someChecked = allCbs.some(function(cb) { return cb.checked; });
      selectAllCb.checked = allChecked;
      selectAllCb.indeterminate = someChecked && !allChecked;
    }
  }

  if (selectAllCb) {
    selectAllCb.addEventListener('change', function() {
      var checked = this.checked;
      getCheckboxes().forEach(function(cb) { cb.checked = checked; });
      updateSelectionUI();
    });
  }
  if (tableBody) {
    tableBody.addEventListener('change', function(e) {
      if (e.target.classList.contains('finalizedRowCheckbox')) updateSelectionUI();
    });
  }

  // Single-row Move to Pool
  if (tableBody) {
    tableBody.addEventListener('click', function(e) {
      var poolSingle = e.target.closest('.btn-pool-single');
      if (poolSingle) {
        var prId = parseInt(poolSingle.dataset.prId);
        if (prId) performMoveToPool([prId]);
      }
    });
  }

  // Bulk Move to Pool
  if (poolBtn) {
    poolBtn.addEventListener('click', async function() {
      var ids = getSelectedPrIds();
      if (ids.length === 0) return;
      var ok = await showConfirm({ title: 'Move to Pool?', text: 'Move ' + ids.length + ' item(s) to pool?', icon: 'fa-solid fa-arrow-right', confirmLabel: 'Move', btnClass: 'btn-primary', hideWarning: true });
      if (!ok) return;
      performMoveToPool(ids);
    });
  }

  // View
  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      var cardIds = getSelectedCardIds();
      if (cardIds.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') fetchCardAndOpenModal('view', cardIds[0]);
    });
  }

  if (retrieveBtn) {
    retrieveBtn.addEventListener('click', async function() {
      var ids = getSelectedPrIds();
      if (ids.length === 0) return;
      var ok = true;
      if (typeof showConfirm === 'function') {
        ok = await showConfirm({
          title: 'Retrieve to Pending?',
          text: 'Move ' + ids.length + ' item(s) from Finalized List back to Pending List?',
          icon: 'fa-solid fa-arrow-rotate-left',
          confirmLabel: 'Retrieve',
          btnClass: 'btn-primary',
          hideWarning: true,
        });
      } else {
        ok = window.confirm('Move selected finalized items back to Pending List?');
      }
      if (!ok) return;

      ApiClient.post('/print/api/table/' + TABLE_ID + '/retrieve-finalized/', { request_ids: ids })
        .then(function(data) {
          if (!data || data.status !== 'ok') {
            showToast((data && data.message) || 'Retrieve failed', 'error');
            return;
          }
          showToast(data.message || 'Moved back to pending list', 'success');
          fetchFinalizedItems(searchInput ? searchInput.value.trim() : '');
          refreshStepCounts();
        })
        .catch(function(err) {
          showToast((err && err.message) || 'Retrieve failed', 'error');
        });
    });
  }

  function runFinalizedDownload(kind) {
    var cardIds = getCardIdsForDownload();
    if (cardIds.length === 0) {
      showToast('No cards selected for download', 'error');
      return;
    }

    var payload = { card_ids: cardIds };
    if (kind === 'img') {
      _downloadImageExport('/api/table/' + TABLE_ID + '/cards/download-images/', payload)
        .catch(function(err) { showToast((err && err.message) || 'Image export failed', 'error'); });
      return;
    }
    if (kind === 'docx') {
      _downloadBlobExport('/api/table/' + TABLE_ID + '/cards/download-docx/', payload, 'cards.docx', 'Word download complete')
        .catch(function(err) { showToast((err && err.message) || 'Word export failed', 'error'); });
      return;
    }
    if (kind === 'xlsx') {
      _downloadBlobExport('/api/table/' + TABLE_ID + '/cards/download-xlsx/', payload, 'cards.xlsx', 'Excel download complete')
        .catch(function(err) { showToast((err && err.message) || 'Excel export failed', 'error'); });
      return;
    }
    if (kind === 'pdf') {
      _downloadBlobExport('/api/table/' + TABLE_ID + '/cards/download-pdf/', payload, 'cards.pdf', 'PDF download complete')
        .catch(function(err) { showToast((err && err.message) || 'PDF export failed', 'error'); });
    }
  }

  if (dlImgBtn) dlImgBtn.addEventListener('click', function() { runFinalizedDownload('img'); });
  if (dlDocxBtn) dlDocxBtn.addEventListener('click', function() { runFinalizedDownload('docx'); });
  if (dlXlsxBtn) dlXlsxBtn.addEventListener('click', function() { runFinalizedDownload('xlsx'); });
  if (dlPdfBtn) dlPdfBtn.addEventListener('click', function() { runFinalizedDownload('pdf'); });

  // Move to Pool API (finalized  pool)
  function performMoveToPool(prIds) {
    ApiClient.post('/print/api/table/' + TABLE_ID + '/mark-pool/', { request_ids: prIds })
    .then(function(data) {
      if (data.status === 'ok') {
        showToast(data.message || 'Moved to pool', 'success');
        prIds.forEach(function(id) {
          var row = tableBody.querySelector('tr[data-pr-id="' + id + '"]');
          if (row) row.remove();
        });
        updatePagination();
        updateSelectionUI();
        refreshStepCounts();
      } else {
        showToast(data.message || 'Failed', 'error');
      }
    }).catch(function(err) {
      showToast('Network error', 'error');
      console.error('[Finalized] Move to pool error:', err);
    });
  }

  // Search
  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchFinalizedItems(q); }, 350);
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      searchInput.focus();
      fetchFinalizedItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  function fetchFinalizedItems(query) {
    var url = '/print/api/table/' + TABLE_ID + '/finalized-list/?q=' + encodeURIComponent(query || '') + '&limit=200';
    ApiClient.get(url)
    .then(function(data) {
      if (data.status === 'ok') renderFinalizedItems(data.items || [], data.total || 0);
    }).catch(function(err) { console.error('[Finalized] Search failed:', err); });
  }

  function renderFinalizedItems(items, total) {
    if (items.length === 0) {
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-clipboard-check"></i><span>No finalized items</span></div></td></tr>';
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = total;
      updateSelectionUI();
      return;
    }
    var html = '';
    items.forEach(function(item, idx) {
      html += '<tr data-pr-id="' + item.pr_id + '" data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="finalizedRowCheckbox"></td>';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields);
      html += '<td class="w-[65px] px-[1px] py-1 align-middle user-cell text-center">' + escapeHtml(item.requested_by_name || '-') + '</td>';
      html += '<td class="w-[90px] px-[1px] py-1 align-middle date-cell text-center">' + escapeHtml(item.finalized_at || '-') + '</td>';
      html += '<td class="w-[60px] px-[1px] py-1 text-center align-middle action-cell"><div class="confirm-action-btns">';
      html += '<button class="btn-pool-single" data-pr-id="' + item.pr_id + '" title="Move to pool"><i class="fa-solid fa-layer-group"></i></button>';
      html += '</div></td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle text-center"><span class="status-badge status-' + item.status + '">' + escapeHtml(item.status_display || item.status || '-') + '</span></td>';
      html += '</tr>';
    });
    tableBody.innerHTML = html;
    if (showingRange) showingRange.textContent = '1-' + items.length;
    if (totalCountEl) totalCountEl.textContent = total;
    updateSelectionUI();
    if (paginator) { paginator.reset(); paginator.paginate(); }
  }

  function updatePagination() {
    var rows = tableBody.querySelectorAll('tr:not(.no-data-row)');
    if (rows.length === 0) {
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = '0';
      var pBar = document.getElementById('finalizedPaginationBar');
      if (pBar) pBar.style.display = 'none';
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-clipboard-check"></i><span>No finalized items</span></div></td></tr>';
    } else {
      if (paginator) paginator.paginate();
    }
  }
})();


})();
