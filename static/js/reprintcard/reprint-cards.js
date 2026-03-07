/**
 * Reprint Cards — Single-file JS for the 2-step Reprint Cards workflow.
 * Steps: Reprint List → Confirmed List
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
  ApiClient.get('/reprint/api/table/' + TABLE_ID + '/step-counts/')
    .then(function(data) {
      if (data.status === 'ok') {
        updateTabCount('.reprint-requests-tab .tab-count', data.reprint_list || 0);
        updateTabCount('.reprint-confirm-tab .tab-count', data.confirmed || 0);
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
   STEP 1: REPRINT LIST (all IDCards)
   ═══════════════════════════════════════════════════════════════════ */
(function reprintListStep() {
  var tableBody     = document.getElementById('reprintListTableBody');
  var selectAllCb   = document.getElementById('reprintListSelectAll');
  var searchInput   = document.getElementById('reprintListSearchInput');
  var searchClearBtn = document.getElementById('reprintListSearchClearBtn');
  var sendToConfirmedBtn = document.getElementById('sendToConfirmedBtn');
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
  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId); });
  }

  function updateSelectionUI() {
    var ids = getSelectedCardIds();
    var count = ids.length;
    if (sendToConfirmedBtn) sendToConfirmedBtn.disabled = count === 0;
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
      if (e.target.classList.contains('reprintListRowCheckbox')) updateSelectionUI();
    });
  }

  // ── Reprint Confirmation Modal ──
  var reprintModal     = document.getElementById('reprintConfirmModal');
  var reprintCountEl   = document.getElementById('reprintConfirmCount');
  var reprintReasonEl  = document.getElementById('reprintReasonInput');
  var reprintSubmitBtn = document.getElementById('reprintConfirmSubmit');
  var reprintCancelBtn = document.getElementById('reprintConfirmCancel');
  var reprintCloseBtn  = document.getElementById('reprintConfirmClose');
  var pendingCardIds   = [];

  function openReprintModal(cardIds) {
    pendingCardIds = cardIds;
    if (reprintCountEl) reprintCountEl.textContent = cardIds.length;
    if (reprintReasonEl) reprintReasonEl.value = '';
    if (reprintModal) reprintModal.classList.add('show');
  }
  function closeReprintModal() {
    if (reprintModal) reprintModal.classList.remove('show');
    pendingCardIds = [];
  }
  if (reprintCancelBtn) reprintCancelBtn.addEventListener('click', closeReprintModal);
  if (reprintCloseBtn) reprintCloseBtn.addEventListener('click', closeReprintModal);
  if (reprintModal) {
    reprintModal.addEventListener('click', function(e) {
      if (e.target === reprintModal) closeReprintModal();
    });
  }
  if (reprintSubmitBtn) {
    reprintSubmitBtn.addEventListener('click', function() {
      if (pendingCardIds.length === 0) return;
      var reason = reprintReasonEl ? reprintReasonEl.value.trim() : '';
      closeReprintModal();
      performSendToConfirmed(pendingCardIds, reason);
    });
  }

  // Single-row action button
  if (tableBody) {
    tableBody.addEventListener('click', function(e) {
      var sendSingle = e.target.closest('.btn-send-to-confirmed-single');
      if (sendSingle) {
        var cardId = parseInt(sendSingle.dataset.cardId);
        if (cardId) openReprintModal([cardId]);
      }
    });
  }

  // Bulk Send to Confirmed
  if (sendToConfirmedBtn) {
    sendToConfirmedBtn.addEventListener('click', function() {
      var ids = getSelectedCardIds();
      if (ids.length === 0) return;
      openReprintModal(ids);
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

  // Send to Confirmed API — creates ReprintRequest (goes directly to confirmed)
  function performSendToConfirmed(cardIds, reason) {
    var payload = { card_ids: cardIds };
    if (reason) payload.reason = reason;
    ApiClient.post('/reprint/api/table/' + TABLE_ID + '/request/', payload)
    .then(function(data) {
      if (data.status === 'ok') {
        showToast(data.message || 'Sent to confirmed', 'success');
        refreshStepCounts();
      } else {
        showToast(data.message || 'Failed', 'error');
      }
    }).catch(function(err) {
      showToast('Network error', 'error');
      console.error('[ReprintList] Send to confirmed error:', err);
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
    var url = '/reprint/api/table/' + TABLE_ID + '/reprint-list/?q=' + encodeURIComponent(query || '') + '&limit=200';
    ApiClient.get(url)
    .then(function(data) {
      if (data.status === 'ok') renderReprintListItems(data.items || [], data.total || 0);
    }).catch(function(err) { console.error('[ReprintList] Search failed:', err); });
  }

  function renderReprintListItems(items, total) {
    if (items.length === 0) {
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-id-card"></i><span>No ID Cards</span></div></td></tr>';
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = total;
      updateSelectionUI();
      return;
    }
    var html = '';
    items.forEach(function(item, idx) {
      html += '<tr data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="reprintListRowCheckbox"></td>';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields);
      html += '<td class="w-[120px] px-[1px] py-1 text-center align-middle action-cell"><div class="confirm-action-btns">';
      html += '<button class="btn-send-to-confirmed-single" data-card-id="' + item.card_id + '" title="Send to Confirmed list"><i class="fa-solid fa-check"></i> <span>Confirm</span></button>';
      html += '</div></td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle text-center"><span class="status-badge status-' + (item.status || 'pending') + '">' + escapeHtml(item.status_display || '-') + '</span></td>';
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
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-id-card"></i><span>No ID Cards</span></div></td></tr>';
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
  var rejectBtn      = document.getElementById('rejectConfirmedBtn');
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
    if (rejectBtn) rejectBtn.disabled = count === 0;
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
      var rejectSingle = e.target.closest('.btn-reject-confirmed-single');
      if (rejectSingle) {
        var rrId2 = parseInt(rejectSingle.dataset.rrId);
        if (rrId2 && confirm('Reject this reprint request? Card will move to pool.')) performReject([rrId2]);
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

  // Bulk Reject
  if (rejectBtn) {
    rejectBtn.addEventListener('click', function() {
      var ids = getSelectedRrIds();
      if (ids.length === 0) return;
      if (!confirm('Reject ' + ids.length + ' reprint request(s)? Cards will move to pool.')) return;
      performReject(ids);
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
    ApiClient.post('/reprint/api/table/' + TABLE_ID + '/send-to-print/', { rr_ids: rrIds })
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

  // Reject API — deletes ReprintRequests and moves cards to pool
  function performReject(rrIds) {
    ApiClient.post('/reprint/api/table/' + TABLE_ID + '/reject/', { rr_ids: rrIds })
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
      console.error('[Confirmed] Reject error:', err);
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
    var url = '/reprint/api/table/' + TABLE_ID + '/confirmed-list/?q=' + encodeURIComponent(query || '') + '&limit=200';
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


})();
