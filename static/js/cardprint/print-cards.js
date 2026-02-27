/**
 * Print Cards — Single-file JS for the 3-step Print Cards workflow.
 * Steps: Print List → Finalized List → Pool
 *
 * Self-contained for the cardprint app.
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
  ApiClient.get('/panel/print/api/table/' + TABLE_ID + '/step-counts/')
    .then(function(data) {
      if (data.status === 'ok') {
        updateTabCount('.print-list-tab .tab-count', data.print_list || 0);
        updateTabCount('.print-finalized-tab .tab-count', data.finalized || 0);
        updateTabCount('.print-pool-tab .tab-count', data.pool || 0);
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
   STEP 1: PRINT LIST (status = print_list)
   Actions: Generate (bulk + single), Remove (bulk + single)
   ═══════════════════════════════════════════════════════════════════ */
(function printListStep() {
  var tableBody     = document.getElementById('printListTableBody');
  var selectAllCb   = document.getElementById('printListSelectAll');
  var searchInput   = document.getElementById('printListSearchInput');
  var searchClearBtn = document.getElementById('printListSearchClearBtn');
  var generateBtn   = document.getElementById('generateBtn');
  var removeBtn     = document.getElementById('removeFromPrintBtn');
  var viewBtn       = document.getElementById('printListViewBtn');
  var showingRange  = document.getElementById('printListShowingRange');
  var totalCountEl  = document.getElementById('printListTotalCount');

  if (!tableBody) return;

  var paginator = createPaginator({
    barId: 'printListPaginationBar',
    prefix: 'printList',
    getTableBody: function() { return tableBody; }
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.printListRowCheckbox:not(:disabled)'));
  }
  function getSelectedPrIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.prId); });
  }
  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId); });
  }

  function updateSelectionUI() {
    var ids = getSelectedPrIds();
    var count = ids.length;
    if (generateBtn) generateBtn.disabled = count === 0;
    if (removeBtn)   removeBtn.disabled   = count === 0;
    if (viewBtn)     viewBtn.disabled     = count !== 1;
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
      if (e.target.classList.contains('printListRowCheckbox')) updateSelectionUI();
    });
  }

  // Single-row actions
  if (tableBody) {
    tableBody.addEventListener('click', function(e) {
      var genSingle = e.target.closest('.btn-generate-single');
      if (genSingle) {
        var prId = parseInt(genSingle.dataset.prId);
        if (prId) performGenerate([prId]);
        return;
      }
      var rmBtn = e.target.closest('.btn-remove-single');
      if (rmBtn) {
        var prId2 = parseInt(rmBtn.dataset.prId);
        if (prId2 && confirm('Remove this card from the print list?')) performRemove([prId2]);
      }
    });
  }

  // Bulk Generate
  if (generateBtn) {
    generateBtn.addEventListener('click', function() {
      var ids = getSelectedPrIds();
      if (ids.length === 0) return;
      if (!confirm('Generate ' + ids.length + ' item(s)?')) return;
      performGenerate(ids);
    });
  }

  // Bulk Remove
  if (removeBtn) {
    removeBtn.addEventListener('click', function() {
      var ids = getSelectedPrIds();
      if (ids.length === 0) return;
      if (!confirm('Remove ' + ids.length + ' item(s) from the print list?')) return;
      performRemove(ids);
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

  // Generate API (print_list → finalized)
  function performGenerate(prIds) {
    ApiClient.post('/panel/print/api/table/' + TABLE_ID + '/generate/', { request_ids: prIds })
    .then(function(data) {
      if (data.status === 'ok') {
        showToast(data.message || 'Generated successfully', 'success');
        prIds.forEach(function(id) {
          var row = tableBody.querySelector('tr[data-pr-id="' + id + '"]');
          if (row) row.remove();
        });
        updatePagination();
        updateSelectionUI();
        refreshStepCounts();
      } else {
        showToast(data.message || 'Failed to generate', 'error');
      }
    }).catch(function(err) {
      showToast('Network error', 'error');
      console.error('[PrintList] Generate error:', err);
    });
  }

  // Remove API
  function performRemove(prIds) {
    ApiClient.post('/panel/print/api/table/' + TABLE_ID + '/remove/', { request_ids: prIds })
    .then(function(data) {
      if (data.status === 'ok') {
        showToast(data.message || 'Removed from print list', 'success');
        prIds.forEach(function(id) {
          var row = tableBody.querySelector('tr[data-pr-id="' + id + '"]');
          if (row) row.remove();
        });
        updatePagination();
        updateSelectionUI();
        refreshStepCounts();
      } else {
        showToast(data.message || 'Failed to remove', 'error');
      }
    }).catch(function(err) {
      showToast('Network error', 'error');
      console.error('[PrintList] Remove error:', err);
    });
  }

  // Search
  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchPrintListItems(q); }, 350);
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      searchInput.focus();
      fetchPrintListItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  function fetchPrintListItems(query) {
    var url = '/panel/print/api/table/' + TABLE_ID + '/list/?q=' + encodeURIComponent(query || '') + '&limit=200';
    ApiClient.get(url)
    .then(function(data) {
      if (data.status === 'ok') renderPrintListItems(data.items || [], data.total || 0);
    }).catch(function(err) { console.error('[PrintList] Search failed:', err); });
  }

  function renderPrintListItems(items, total) {
    if (items.length === 0) {
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-print"></i><span>No cards in print list</span></div></td></tr>';
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = total;
      updateSelectionUI();
      return;
    }
    var html = '';
    items.forEach(function(item, idx) {
      html += '<tr data-pr-id="' + item.pr_id + '" data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="printListRowCheckbox"></td>';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields);
      html += '<td class="w-[65px] px-[1px] py-1 align-middle user-cell text-center">' + escapeHtml(item.requested_by_name || '-') + '</td>';
      html += '<td class="w-[90px] px-[1px] py-1 align-middle date-cell text-center">' + escapeHtml(item.requested_at || '-') + '</td>';
      html += '<td class="w-[60px] px-[1px] py-1 text-center align-middle action-cell"><div class="confirm-action-btns">';
      html += '<button class="btn-generate-single" data-pr-id="' + item.pr_id + '" title="Generate"><i class="fa-solid fa-gears"></i></button>';
      html += '<button class="btn-remove-single" data-pr-id="' + item.pr_id + '" title="Remove"><i class="fa-solid fa-trash"></i></button>';
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
      var pBar = document.getElementById('printListPaginationBar');
      if (pBar) pBar.style.display = 'none';
      tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="fa-solid fa-print"></i><span>No cards in print list</span></div></td></tr>';
    } else {
      if (paginator) paginator.paginate();
    }
  }
})();


/* ═══════════════════════════════════════════════════════════════════
   STEP 2: FINALIZED LIST (status = finalized)
   Actions: Move to Pool (bulk + single)
   ═══════════════════════════════════════════════════════════════════ */
(function finalizedStep() {
  var tableBody     = document.getElementById('finalizedTableBody');
  var selectAllCb   = document.getElementById('finalizedSelectAll');
  var searchInput   = document.getElementById('finalizedSearchInput');
  var searchClearBtn = document.getElementById('finalizedSearchClearBtn');
  var poolBtn       = document.getElementById('finalizedMoveToPoolBtn');
  var viewBtn       = document.getElementById('finalizedViewBtn');
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

  function updateSelectionUI() {
    var ids = getSelectedPrIds();
    var count = ids.length;
    if (poolBtn) poolBtn.disabled = count === 0;
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
    poolBtn.addEventListener('click', function() {
      var ids = getSelectedPrIds();
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

  // Move to Pool API (finalized → pool)
  function performMoveToPool(prIds) {
    ApiClient.post('/panel/print/api/table/' + TABLE_ID + '/mark-pool/', { request_ids: prIds })
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
    var url = '/panel/print/api/table/' + TABLE_ID + '/finalized-list/?q=' + encodeURIComponent(query || '') + '&limit=200';
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


/* ═══════════════════════════════════════════════════════════════════
   STEP 3: POOL (status = pool)
   View only, no action buttons
   ═══════════════════════════════════════════════════════════════════ */
(function poolStep() {
  var tableBody     = document.getElementById('printPoolTableBody');
  var selectAllCb   = document.getElementById('printPoolSelectAll');
  var searchInput   = document.getElementById('printPoolSearchInput');
  var searchClearBtn = document.getElementById('printPoolSearchClearBtn');
  var viewBtn       = document.getElementById('printPoolViewBtn');
  var showingRange  = document.getElementById('printPoolShowingRange');
  var totalCountEl  = document.getElementById('printPoolTotalCount');

  if (!tableBody) return;

  var paginator = createPaginator({
    barId: 'printPoolPaginationBar',
    prefix: 'printPool',
    getTableBody: function() { return tableBody; }
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.printPoolRowCheckbox:not(:disabled)'));
  }
  function getSelectedPrIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.prId); });
  }
  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId); });
  }

  function updateSelectionUI() {
    var ids = getSelectedPrIds();
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
      if (e.target.classList.contains('printPoolRowCheckbox')) updateSelectionUI();
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
    var url = '/panel/print/api/table/' + TABLE_ID + '/pool-list/?q=' + encodeURIComponent(query || '') + '&limit=200';
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
      html += '<tr data-pr-id="' + item.pr_id + '" data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="printPoolRowCheckbox"></td>';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields);
      html += '<td class="w-[65px] px-[1px] py-1 align-middle user-cell text-center">' + escapeHtml(item.requested_by_name || '-') + '</td>';
      html += '<td class="w-[90px] px-[1px] py-1 align-middle date-cell text-center">' + escapeHtml(item.pool_at || '-') + '</td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle text-center"><span class="status-badge status-' + item.status + '">' + escapeHtml(item.status_display || item.status || '-') + '</span></td>';
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
