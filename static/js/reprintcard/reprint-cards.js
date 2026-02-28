/**
 * Reprint Cards — Single-file JS for the 4-step Reprint Cards workflow.
 * Steps: Reprint List → Confirmed List → Download → Pool
 *
 * Self-contained for the reprintcard app.
 */
(function() {
'use strict';

var TABLE_ID = window.TABLE_ID;
if (!TABLE_ID) return;

/* ═══════════════════════════════════════════════════════════════════
   SHARED HELPERS
   ═══════════════════════════════════════════════════════════════════ */
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
  ApiClient.get('/panel/reprint/api/table/' + TABLE_ID + '/step-counts/')
    .then(function(data) {
      if (data.status === 'ok') {
        updateTabCount('.reprint-requests-tab .tab-count', data.reprint_list || 0);
        updateTabCount('.reprint-confirm-tab .tab-count', data.confirmed || 0);
        updateTabCount('.reprint-download-tab .tab-count', data.download || 0);
        updateTabCount('.reprint-pool-tab .tab-count', data.pool || 0);
      }
    }).catch(function() {});
}

/** Render a single image cell as HTML */
function renderImageCell(f) {
  var html = '<td class="w-[28px] px-[1px] py-1 text-center align-middle image-field image-cell" data-field="' + escapeHtml(f.name) + '" data-field-name="' + escapeHtml(f.name) + '" data-field-type="image" data-original-value="' + escapeHtml(f.value || '') + '">';
  html += '<div class="image-with-edit">';
  if (f.value && f.value !== '' && f.value !== 'NOT_FOUND' && !f.value.startsWith('PENDING:')) {
    var thumbPath = f.value.replace(/\/([^\/]+)$/, '/thumbnails/$1');
    html += '<img src="/media/' + thumbPath + '" alt="' + escapeHtml(f.name) + '" class="table-image" loading="lazy" onerror="this.onerror=null; this.src=\'/media/' + f.value + '\'">';
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
  return '<td class="dynamic-field px-[1px] py-1 align-middle" data-field="' + escapeHtml(f.name) + '" data-field-name="' + escapeHtml(f.name) + '" data-field-type="' + escapeHtml(f.type || 'text') + '" data-original-value="' + escapeHtml(f.value || '') + '"><span class="cell-value">' + escapeHtml(f.value || '-') + '</span></td>';
}

/** Render ordered fields (text first, then images) */
function renderOrderedFields(fields) {
  if (!fields) return '';
  var html = '';
  fields.forEach(function(f) { if (!isImageField(f.type, f.name)) html += renderTextCell(f); });
  fields.forEach(function(f) { if (isImageField(f.type, f.name)) html += renderImageCell(f); });
  return html;
}


/* ═══════════════════════════════════════════════════════════════════
   PAGINATION FACTORY
   ═══════════════════════════════════════════════════════════════════ */
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

  // Event listeners
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


/* ═══════════════════════════════════════════════════════════════════
   STEP 1: REPRINT LIST (status = requested)
   ═══════════════════════════════════════════════════════════════════ */
(function reprintListStep() {
  var tableBody     = document.getElementById('reprintListTableBody');
  var selectAllCb   = document.getElementById('reprintListSelectAll');
  var searchInput   = document.getElementById('reprintListSearchInput');
  var searchClearBtn = document.getElementById('reprintListSearchClearBtn');
  var confirmBtn    = document.getElementById('confirmSelectedBtn');
  var rejectBtn     = document.getElementById('rejectSelectedBtn');
  var viewBtn       = document.getElementById('reprintListViewBtn');
  var showingRange  = document.getElementById('reprintListShowingRange');
  var totalCountEl  = document.getElementById('reprintListTotalCount');

  if (!tableBody) return;

  var paginator = createPaginator({
    barId: 'reprintListPaginationBar',
    prefix: 'reprintList',
    getTableBody: function() { return tableBody; }
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.reprintListRowCheckbox:not(:disabled)'));
  }
  function getSelectedRrIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.rrId); });
  }
  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId); });
  }

  function updateSelectionUI() {
    var ids = getSelectedRrIds();
    var count = ids.length;
    if (confirmBtn) confirmBtn.disabled = count === 0;
    if (rejectBtn)  rejectBtn.disabled  = count === 0;
    if (viewBtn)    viewBtn.disabled    = count !== 1;
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
      if (e.target.classList.contains('reprintListRowCheckbox')) updateSelectionUI();
    });
  }

  // Single-row action buttons
  if (tableBody) {
    tableBody.addEventListener('click', function(e) {
      var confirmSingle = e.target.closest('.btn-confirm-single');
      if (confirmSingle) {
        var rrId = parseInt(confirmSingle.dataset.rrId);
        if (rrId) performConfirm([rrId]);
        return;
      }
      var rejectSingle = e.target.closest('.btn-reject-single');
      if (rejectSingle) {
        var rrId2 = parseInt(rejectSingle.dataset.rrId);
        if (rrId2 && confirm('Reject this reprint request?')) performReject([rrId2]);
      }
    });
  }

  // Bulk Confirm
  if (confirmBtn) {
    confirmBtn.addEventListener('click', function() {
      var ids = getSelectedRrIds();
      if (ids.length === 0) return;
      if (!confirm('Confirm ' + ids.length + ' reprint request(s)?')) return;
      performConfirm(ids);
    });
  }

  // Bulk Reject
  if (rejectBtn) {
    rejectBtn.addEventListener('click', function() {
      var ids = getSelectedRrIds();
      if (ids.length === 0) return;
      if (!confirm('Reject ' + ids.length + ' reprint request(s)?')) return;
      performReject(ids);
    });
  }

  // View Button
  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      var cardIds = getSelectedCardIds();
      if (cardIds.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') fetchCardAndOpenModal('view', cardIds[0]);
    });
  }

  // Confirm API
  function performConfirm(rrIds) {
    ApiClient.post('/panel/reprint/api/table/' + TABLE_ID + '/confirm/', { rr_ids: rrIds })
    .then(function(data) {
      if (data.status === 'ok') {
        showToast(data.message || 'Confirmed', 'success');
        rrIds.forEach(function(id) {
          var row = tableBody.querySelector('tr[data-rr-id="' + id + '"]');
          if (row) row.remove();
        });
        updatePagination();
        updateSelectionUI();
        refreshStepCounts();
      } else {
        showToast(data.message || 'Failed to confirm', 'error');
      }
    }).catch(function(err) {
      showToast('Network error', 'error');
      console.error('[ReprintList] Confirm error:', err);
    });
  }

  // Reject API
  function performReject(rrIds) {
    ApiClient.post('/panel/reprint/api/table/' + TABLE_ID + '/reject/', { rr_ids: rrIds })
    .then(function(data) {
      if (data.status === 'ok') {
        showToast(data.message || 'Rejected', 'success');
        rrIds.forEach(function(id) {
          var row = tableBody.querySelector('tr[data-rr-id="' + id + '"]');
          if (row) row.remove();
        });
        updatePagination();
        updateSelectionUI();
        refreshStepCounts();
      } else {
        showToast(data.message || 'Failed to reject', 'error');
      }
    }).catch(function(err) {
      showToast('Network error', 'error');
      console.error('[ReprintList] Reject error:', err);
    });
  }

  // Search
  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchReprintListItems(q); }, 350);
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      searchInput.focus();
      fetchReprintListItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  function fetchReprintListItems(query) {
    var url = '/panel/reprint/api/table/' + TABLE_ID + '/reprint-list/?q=' + encodeURIComponent(query || '') + '&limit=200';
    ApiClient.get(url)
    .then(function(data) {
      if (data.status === 'ok') renderReprintListItems(data.items || [], data.total || 0);
    }).catch(function(err) { console.error('[ReprintList] Search failed:', err); });
  }

  function renderReprintListItems(items, total) {
    if (items.length === 0) {
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-rotate"></i><span>No reprint requests</span></div></td></tr>';
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = total;
      updateSelectionUI();
      return;
    }
    var html = '';
    items.forEach(function(item, idx) {
      html += '<tr data-rr-id="' + item.rr_id + '" data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="reprintListRowCheckbox"></td>';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields);
      html += '<td class="min-w-[80px] px-[1px] py-1 align-middle reason-cell whitespace-normal break-words text-left">' + escapeHtml(item.reason || '-') + '</td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle user-cell whitespace-normal break-words text-center">' + escapeHtml(item.requested_by_name || '-') + '</td>';
      html += '<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">' + escapeHtml(item.requested_at || '-') + '</td>';
      html += '<td class="w-[60px] px-[1px] py-1 text-center align-middle action-cell"><div class="confirm-action-btns">';
      html += '<button class="btn-confirm-single" data-rr-id="' + item.rr_id + '" title="Confirm"><i class="fa-solid fa-check"></i></button>';
      html += '<button class="btn-reject-single" data-rr-id="' + item.rr_id + '" title="Reject"><i class="fa-solid fa-xmark"></i></button>';
      html += '</div></td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle text-center"><span class="status-badge status-' + (item.card_status || 'pending') + '">' + escapeHtml(item.status_display || '-') + '</span></td>';
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
      var pBar = document.getElementById('reprintListPaginationBar');
      if (pBar) pBar.style.display = 'none';
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-rotate"></i><span>No reprint requests</span></div></td></tr>';
    } else {
      if (paginator) paginator.paginate();
    }
  }

})();


/* ═══════════════════════════════════════════════════════════════════
   STEP 2: CONFIRMED LIST (status = confirmed)
   ═══════════════════════════════════════════════════════════════════ */
(function confirmedListStep() {
  var tableBody     = document.getElementById('confirmedTableBody');
  var selectAllCb   = document.getElementById('confirmedSelectAll');
  var searchInput   = document.getElementById('confirmedSearchInput');
  var searchClearBtn = document.getElementById('confirmedSearchClearBtn');
  var sendToPrintBtn = document.getElementById('sendToPrintBtn');
  var markDlBtn     = document.getElementById('markDownloadedBtn');
  var viewBtn       = document.getElementById('confirmedViewBtn');
  var showingRange  = document.getElementById('confirmedShowingRange');
  var totalCountEl  = document.getElementById('confirmedTotalCount');

  if (!tableBody) return;

  var paginator = createPaginator({
    barId: 'confirmedPaginationBar',
    prefix: 'confirmed',
    getTableBody: function() { return tableBody; }
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.confirmedRowCheckbox:not(:disabled)'));
  }
  function getSelectedRrIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.rrId); });
  }
  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId); });
  }

  function updateSelectionUI() {
    var ids = getSelectedRrIds();
    var count = ids.length;
    if (sendToPrintBtn) sendToPrintBtn.disabled = count === 0;
    if (markDlBtn) markDlBtn.disabled = count === 0;
    if (viewBtn)   viewBtn.disabled   = count !== 1;
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
      if (e.target.classList.contains('confirmedRowCheckbox')) updateSelectionUI();
    });
  }

  // Single-row actions
  if (tableBody) {
    tableBody.addEventListener('click', function(e) {
      var printBtn = e.target.closest('.btn-send-to-print-single');
      if (printBtn) {
        var rrId = parseInt(printBtn.dataset.rrId);
        if (rrId) performSendToPrint([rrId]);
        return;
      }
      var markBtn = e.target.closest('.btn-markdl-single');
      if (markBtn) {
        var rrId = parseInt(markBtn.dataset.rrId);
        if (rrId) performMarkDownloaded([rrId]);
      }
    });
  }

  // Bulk Send to Print
  if (sendToPrintBtn) {
    sendToPrintBtn.addEventListener('click', function() {
      var ids = getSelectedRrIds();
      if (ids.length === 0) return;
      if (!confirm('Send ' + ids.length + ' item(s) to Print List?')) return;
      performSendToPrint(ids);
    });
  }

  // Bulk Mark Downloaded
  if (markDlBtn) {
    markDlBtn.addEventListener('click', function() {
      var ids = getSelectedRrIds();
      if (ids.length === 0) return;
      if (!confirm('Mark ' + ids.length + ' item(s) as downloaded?')) return;
      performMarkDownloaded(ids);
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

  // Send to Print API
  function performSendToPrint(rrIds) {
    ApiClient.post('/panel/reprint/api/table/' + TABLE_ID + '/send-to-print/', { rr_ids: rrIds })
    .then(function(data) {
      if (data.status === 'ok') {
        showToast(data.message || 'Sent to print list', 'success');
        // Remove rows — they moved to downloaded
        rrIds.forEach(function(id) {
          var row = tableBody.querySelector('tr[data-rr-id="' + id + '"]');
          if (row) row.remove();
        });
        updatePagination();
        updateSelectionUI();
        refreshStepCounts();
      } else {
        showToast(data.message || 'Failed to send to print', 'error');
      }
    }).catch(function(err) {
      showToast('Network error', 'error');
      console.error('[Confirmed] Send to print error:', err);
    });
  }

  // Mark Downloaded API
  function performMarkDownloaded(rrIds) {
    ApiClient.post('/panel/reprint/api/table/' + TABLE_ID + '/mark-downloaded/', { rr_ids: rrIds })
    .then(function(data) {
      if (data.status === 'ok') {
        showToast(data.message || 'Marked as downloaded', 'success');
        rrIds.forEach(function(id) {
          var row = tableBody.querySelector('tr[data-rr-id="' + id + '"]');
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
      console.error('[Confirmed] Mark downloaded error:', err);
    });
  }

  // Search
  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchConfirmedItems(q); }, 350);
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      searchInput.focus();
      fetchConfirmedItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  function fetchConfirmedItems(query) {
    var url = '/panel/reprint/api/table/' + TABLE_ID + '/confirmed-list/?q=' + encodeURIComponent(query || '') + '&limit=200';
    ApiClient.get(url)
    .then(function(data) {
      if (data.status === 'ok') renderConfirmedItems(data.items || [], data.total || 0);
    }).catch(function(err) { console.error('[Confirmed] Search failed:', err); });
  }

  function renderConfirmedItems(items, total) {
    if (items.length === 0) {
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-clipboard-check"></i><span>No confirmed reprints</span></div></td></tr>';
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = total;
      updateSelectionUI();
      return;
    }
    var html = '';
    items.forEach(function(item, idx) {
      html += '<tr data-rr-id="' + item.rr_id + '" data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="confirmedRowCheckbox"></td>';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields);
      html += '<td class="min-w-[80px] px-[1px] py-1 align-middle reason-cell whitespace-normal break-words text-left">' + escapeHtml(item.reason || '-') + '</td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle user-cell whitespace-normal break-words text-center">' + escapeHtml(item.requested_by_name || '-') + '</td>';
      html += '<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">' + escapeHtml(item.confirmed_at || '-') + '</td>';
      html += '<td class="w-[80px] px-[1px] py-1 text-center align-middle action-cell"><div class="confirm-action-btns">';
      html += '<button class="btn-send-to-print-single" data-rr-id="' + item.rr_id + '" title="Send to Print List"><i class="fa-solid fa-print"></i></button>';
      html += '<button class="btn-markdl-single" data-rr-id="' + item.rr_id + '" title="Mark downloaded"><i class="fa-solid fa-download"></i></button>';
      html += '</div></td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle text-center"><span class="status-badge status-' + (item.card_status || 'pending') + '">' + escapeHtml(item.status_display || '-') + '</span></td>';
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
      var pBar = document.getElementById('confirmedPaginationBar');
      if (pBar) pBar.style.display = 'none';
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-clipboard-check"></i><span>No confirmed reprints</span></div></td></tr>';
    } else {
      if (paginator) paginator.paginate();
    }
  }

})();


/* ═══════════════════════════════════════════════════════════════════
   STEP 3: DOWNLOAD (status = downloaded)
   ═══════════════════════════════════════════════════════════════════ */
(function downloadStep() {
  var tableBody     = document.getElementById('downloadTableBody');
  var selectAllCb   = document.getElementById('downloadSelectAll');
  var searchInput   = document.getElementById('downloadSearchInput');
  var searchClearBtn = document.getElementById('downloadSearchClearBtn');
  var poolBtn       = document.getElementById('moveToPoolBtn');
  var viewBtn       = document.getElementById('downloadViewBtn');
  var showingRange  = document.getElementById('downloadShowingRange');
  var totalCountEl  = document.getElementById('downloadTotalCount');

  if (!tableBody) return;

  var paginator = createPaginator({
    barId: 'downloadPaginationBar',
    prefix: 'download',
    getTableBody: function() { return tableBody; }
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.downloadRowCheckbox:not(:disabled)'));
  }
  function getSelectedRrIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.rrId); });
  }
  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId); });
  }

  function updateSelectionUI() {
    var ids = getSelectedRrIds();
    var count = ids.length;
    if (poolBtn)  poolBtn.disabled  = count === 0;
    if (viewBtn)  viewBtn.disabled  = count !== 1;
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
      if (e.target.classList.contains('downloadRowCheckbox')) updateSelectionUI();
    });
  }

  // Single-row Move to Pool
  if (tableBody) {
    tableBody.addEventListener('click', function(e) {
      var poolSingle = e.target.closest('.btn-pool-single');
      if (poolSingle) {
        var rrId = parseInt(poolSingle.dataset.rrId);
        if (rrId) performMoveToPool([rrId]);
      }
    });
  }

  // Bulk Move to Pool
  if (poolBtn) {
    poolBtn.addEventListener('click', function() {
      var ids = getSelectedRrIds();
      if (ids.length === 0) return;
      if (!confirm('Move ' + ids.length + ' item(s) to pool?')) return;
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

  // Move to Pool API
  function performMoveToPool(rrIds) {
    ApiClient.post('/panel/reprint/api/table/' + TABLE_ID + '/mark-pool/', { rr_ids: rrIds })
    .then(function(data) {
      if (data.status === 'ok') {
        showToast(data.message || 'Moved to pool', 'success');
        rrIds.forEach(function(id) {
          var row = tableBody.querySelector('tr[data-rr-id="' + id + '"]');
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
      console.error('[Download] Move to pool error:', err);
    });
  }

  // Search
  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchDownloadItems(q); }, 350);
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      searchInput.focus();
      fetchDownloadItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  function fetchDownloadItems(query) {
    var url = '/panel/reprint/api/table/' + TABLE_ID + '/download-list/?q=' + encodeURIComponent(query || '') + '&limit=200';
    ApiClient.get(url)
    .then(function(data) {
      if (data.status === 'ok') renderDownloadItems(data.items || [], data.total || 0);
    }).catch(function(err) { console.error('[Download] Search failed:', err); });
  }

  function renderDownloadItems(items, total) {
    if (items.length === 0) {
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-download"></i><span>No downloaded reprints</span></div></td></tr>';
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = total;
      updateSelectionUI();
      return;
    }
    var html = '';
    items.forEach(function(item, idx) {
      html += '<tr data-rr-id="' + item.rr_id + '" data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="downloadRowCheckbox"></td>';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields);
      html += '<td class="min-w-[80px] px-[1px] py-1 align-middle reason-cell whitespace-normal break-words text-left">' + escapeHtml(item.reason || '-') + '</td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle user-cell whitespace-normal break-words text-center">' + escapeHtml(item.requested_by_name || '-') + '</td>';
      html += '<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">' + escapeHtml(item.downloaded_at || '-') + '</td>';
      html += '<td class="w-[60px] px-[1px] py-1 text-center align-middle action-cell"><div class="confirm-action-btns">';
      html += '<button class="btn-pool-single" data-rr-id="' + item.rr_id + '" title="Move to pool"><i class="fa-solid fa-layer-group"></i></button>';
      html += '</div></td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle text-center"><span class="status-badge status-' + (item.card_status || 'pending') + '">' + escapeHtml(item.status_display || '-') + '</span></td>';
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
      var pBar = document.getElementById('downloadPaginationBar');
      if (pBar) pBar.style.display = 'none';
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-download"></i><span>No downloaded reprints</span></div></td></tr>';
    } else {
      if (paginator) paginator.paginate();
    }
  }

})();


/* ═══════════════════════════════════════════════════════════════════
   STEP 4: POOL (status = pool)
   ═══════════════════════════════════════════════════════════════════ */
(function poolStep() {
  var tableBody     = document.getElementById('poolTableBody');
  var selectAllCb   = document.getElementById('poolSelectAll');
  var searchInput   = document.getElementById('poolSearchInput');
  var searchClearBtn = document.getElementById('poolSearchClearBtn');
  var viewBtn       = document.getElementById('poolViewBtn');
  var showingRange  = document.getElementById('poolShowingRange');
  var totalCountEl  = document.getElementById('poolTotalCount');

  if (!tableBody) return;

  var paginator = createPaginator({
    barId: 'poolPaginationBar',
    prefix: 'pool',
    getTableBody: function() { return tableBody; }
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.poolRowCheckbox:not(:disabled)'));
  }
  function getSelectedRrIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.rrId); });
  }
  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId); });
  }

  function updateSelectionUI() {
    var ids = getSelectedRrIds();
    var count = ids.length;
    if (viewBtn) viewBtn.disabled = count !== 1;
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
      if (e.target.classList.contains('poolRowCheckbox')) updateSelectionUI();
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

  // Search
  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchPoolItems(q); }, 350);
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      searchInput.focus();
      fetchPoolItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  function fetchPoolItems(query) {
    var url = '/panel/reprint/api/table/' + TABLE_ID + '/pool-list/?q=' + encodeURIComponent(query || '') + '&limit=200';
    ApiClient.get(url)
    .then(function(data) {
      if (data.status === 'ok') renderPoolItems(data.items || [], data.total || 0);
    }).catch(function(err) { console.error('[Pool] Search failed:', err); });
  }

  function renderPoolItems(items, total) {
    if (items.length === 0) {
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-layer-group"></i><span>No items in pool</span></div></td></tr>';
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = total;
      updateSelectionUI();
      return;
    }
    var html = '';
    items.forEach(function(item, idx) {
      html += '<tr data-rr-id="' + item.rr_id + '" data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="poolRowCheckbox"></td>';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields);
      html += '<td class="min-w-[80px] px-[1px] py-1 align-middle reason-cell whitespace-normal break-words text-left">' + escapeHtml(item.reason || '-') + '</td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle user-cell whitespace-normal break-words text-center">' + escapeHtml(item.requested_by_name || '-') + '</td>';
      html += '<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">' + escapeHtml(item.pool_at || '-') + '</td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle text-center"><span class="status-badge status-' + (item.card_status || 'pending') + '">' + escapeHtml(item.status_display || '-') + '</span></td>';
      html += '</tr>';
    });
    tableBody.innerHTML = html;
    if (showingRange) showingRange.textContent = '1-' + items.length;
    if (totalCountEl) totalCountEl.textContent = total;
    updateSelectionUI();
    if (paginator) { paginator.reset(); paginator.paginate(); }
  }

})();

})();
