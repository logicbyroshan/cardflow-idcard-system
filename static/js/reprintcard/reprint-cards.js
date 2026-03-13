/**
 * Reprint Cards - 3-step workflow JS.
 * Reprint List (approved/download source) -> Request List -> Confirmed List
 */
(function() {
'use strict';

var TABLE_ID = window.TABLE_ID;
var ENDPOINTS = window.REPRINT_ENDPOINTS || {};
if (!TABLE_ID || !ENDPOINTS.stepCounts) return;

var IS_CLIENT_USER = !!window.IS_CLIENT_USER;
var IS_CLIENT_STAFF_USER = !!window.IS_CLIENT_STAFF_USER;
var IS_ADMIN_CONTEXT = !(IS_CLIENT_USER || IS_CLIENT_STAFF_USER);

var showToast = window.showToast || function() {};
var escapeHtml = window.escapeHtml || function(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
};

function isImageField(type, name) {
  if (!type && !name) return false;
  var t = (type || '').toLowerCase();
  var n = (name || '').toLowerCase();
  return t === 'image' || t === 'photo' || t === 'file' ||
         n === 'photo' || n === 'image' || n === 'picture' || n === 'pic' || n === 'img';
}

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

function renderTextCell(f) {
  var widthClass = (window.FieldClassifier) ? window.FieldClassifier.tdClass(f.name, f.type) : '';
  return '<td class="dynamic-field ' + widthClass + ' px-[1px] py-1 align-middle" data-field="' + escapeHtml(f.name) + '" data-field-name="' + escapeHtml(f.name) + '" data-field-type="' + escapeHtml(f.type || 'text') + '" data-original-value="' + escapeHtml(f.value || '') + '"><span class="cell-value">' + escapeHtml(f.value || '-') + '</span></td>';
}

function renderOrderedFields(fields) {
  if (!fields) return '';
  var html = '';
  fields.forEach(function(f) { if (!isImageField(f.type, f.name)) html += renderTextCell(f); });
  fields.forEach(function(f) { if (isImageField(f.type, f.name)) html += renderImageCell(f); });
  return html;
}

function updateTabCount(sel, count) {
  var el = document.querySelector(sel);
  if (el) el.textContent = count;
}

function refreshStepCounts() {
  ApiClient.get(ENDPOINTS.stepCounts)
    .then(function(data) {
      if (data.status !== 'ok') return;
      updateTabCount('.reprint-requests-tab .tab-count', data.reprint_list || 0);
      updateTabCount('.reprint-confirm-tab .tab-count', data.request_list || 0);
      updateTabCount('.reprint-pool-tab .tab-count', data.confirmed || 0);
    })
    .catch(function() {});
}

function createPaginator(opts) {
  var currentPage = 1;
  var rowsPerPage = 50;

  var bar = document.getElementById(opts.barId);
  if (!bar) return null;

  var showingRange = document.getElementById(opts.prefix + 'ShowingRange');
  var totalCountEl = document.getElementById(opts.prefix + 'TotalCount');
  var firstBtn = document.getElementById(opts.prefix + 'FirstPage');
  var prevBtn = document.getElementById(opts.prefix + 'PrevPage');
  var nextBtn = document.getElementById(opts.prefix + 'NextPage');
  var lastBtn = document.getElementById(opts.prefix + 'LastPage');
  var pageNumsEl = document.getElementById(opts.prefix + 'PageNumbers');
  var selInfoEl = document.getElementById(opts.prefix + 'SelectionInfo');
  var selCountEl = document.getElementById(opts.prefix + 'SelectedCount');
  var rowsDropdown = document.getElementById(opts.prefix + 'RowsDropdown');
  var rowsToggle = document.getElementById(opts.prefix + 'RowsToggle');
  var rowsOptions = document.getElementById(opts.prefix + 'RowsOptions');
  var rowsSelText = document.getElementById(opts.prefix + 'RowsSelectedText');

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
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    if (lastBtn) lastBtn.disabled = currentPage >= totalPages;
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
    if (!selInfoEl || !selCountEl) return;
    if (count > 0) {
      selCountEl.textContent = count;
      selInfoEl.style.display = '';
    } else {
      selInfoEl.style.display = 'none';
    }
  }

  if (firstBtn) firstBtn.addEventListener('click', function() { goToPage(1); });
  if (prevBtn) prevBtn.addEventListener('click', function() { goToPage(currentPage - 1); });
  if (nextBtn) nextBtn.addEventListener('click', function() { goToPage(currentPage + 1); });
  if (lastBtn) {
    lastBtn.addEventListener('click', function() {
      var rows = getAllRows();
      var total = rows.length;
      var rpp = (rowsPerPage === 'all') ? total : rowsPerPage;
      goToPage(Math.max(1, Math.ceil(total / rpp)));
    });
  }

  if (pageNumsEl) {
    pageNumsEl.addEventListener('click', function(e) {
      var btn = e.target.closest('.page-num');
      if (btn) goToPage(parseInt(btn.dataset.page, 10));
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
      rowsPerPage = (val === 'all') ? 'all' : parseInt(val, 10);
      currentPage = 1;
      rowsOptions.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
      option.classList.add('selected');
      if (rowsSelText) rowsSelText.textContent = (val === 'all') ? 'All' : val;
      if (rowsDropdown) rowsDropdown.classList.remove('open');
      paginate();
    });
  }

  document.addEventListener('click', function(e) {
    if (rowsDropdown && !rowsDropdown.contains(e.target)) rowsDropdown.classList.remove('open');
  });

  return {
    paginate: paginate,
    reset: reset,
    updateSelectionCount: updateSelectionCount,
  };
}

function updateEmptyTable(tableBody, iconClass, text, totalCountEl, showingRange) {
  tableBody.innerHTML = '<tr class="no-data-row"><td colspan="50" class="no-data-cell"><div class="no-data"><i class="' + iconClass + '"></i><span>' + text + '</span></div></td></tr>';
  if (showingRange) showingRange.textContent = '0';
  if (totalCountEl) totalCountEl.textContent = '0';
}

(function reprintListStep() {
  var tableBody = document.getElementById('reprintListTableBody');
  if (!tableBody) return;

  var selectAllCb = document.getElementById('reprintListSelectAll');
  var searchInput = document.getElementById('reprintListSearchInput');
  var searchClearBtn = document.getElementById('reprintListSearchClearBtn');
  var sendToRequestBtn = document.getElementById('sendToRequestBtn');
  var viewBtn = document.getElementById('reprintListViewBtn');
  var showingRange = document.getElementById('reprintListShowingRange');
  var totalCountEl = document.getElementById('reprintListTotalCount');

  var paginator = createPaginator({
    barId: 'reprintListPaginationBar',
    prefix: 'reprintList',
    getTableBody: function() { return tableBody; },
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.reprintListRowCheckbox:not(:disabled)'));
  }

  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId, 10); });
  }

  function updateSelectionUI() {
    var count = getSelectedCardIds().length;
    if (sendToRequestBtn) sendToRequestBtn.disabled = count === 0;
    if (viewBtn) viewBtn.disabled = count !== 1;
    if (paginator) paginator.updateSelectionCount(count);

    if (selectAllCb) {
      var cbs = getCheckboxes();
      var allChecked = cbs.length > 0 && cbs.every(function(cb) { return cb.checked; });
      var someChecked = cbs.some(function(cb) { return cb.checked; });
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

  tableBody.addEventListener('change', function(e) {
    if (e.target.classList.contains('reprintListRowCheckbox')) updateSelectionUI();
  });

  var modal = document.getElementById('reprintConfirmModal');
  var countEl = document.getElementById('reprintConfirmCount');
  var reasonEl = document.getElementById('reprintReasonInput');
  var submitBtn = document.getElementById('reprintConfirmSubmit');
  var cancelBtn = document.getElementById('reprintConfirmCancel');
  var closeBtn = document.getElementById('reprintConfirmClose');
  var wantEditBtn = document.getElementById('reprintWantEditBtn');
  var pendingCardIds = [];

  function openModal(cardIds) {
    pendingCardIds = cardIds;
    if (countEl) countEl.textContent = cardIds.length;
    if (reasonEl) reasonEl.value = '';
    if (modal) modal.classList.add('show');
  }

  function closeModal() {
    if (modal) modal.classList.remove('show');
    pendingCardIds = [];
  }

  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closeModal();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', function() {
      if (!pendingCardIds.length) return;
      var reason = reasonEl ? reasonEl.value.trim() : '';
      closeModal();
      ApiClient.post(ENDPOINTS.requestCreate, { card_ids: pendingCardIds, reason: reason })
        .then(function(data) {
          if (data.status === 'ok') {
            showToast(data.message || 'Added to Request List', 'success');
            refreshStepCounts();
          } else {
            showToast(data.message || 'Could not add to Request List', 'error');
          }
        })
        .catch(function(err) {
          showToast('Request failed. Please try again.', 'error');
          console.error('[ReprintList] request create failed:', err);
        });
    });
  }

  if (wantEditBtn) {
    wantEditBtn.addEventListener('click', function() {
      if (pendingCardIds.length !== 1) {
        showToast('Select one card to edit.', 'warning');
        return;
      }
      if (typeof fetchCardAndOpenModal === 'function') {
        fetchCardAndOpenModal('edit', pendingCardIds[0]);
        closeModal();
      } else {
        showToast('Edit drawer is unavailable right now.', 'warning');
      }
    });
  }

  tableBody.addEventListener('click', function(e) {
    var sendSingle = e.target.closest('.btn-send-to-request-single');
    if (sendSingle) {
      var cardId = parseInt(sendSingle.dataset.cardId, 10);
      if (cardId) openModal([cardId]);
    }
  });

  if (sendToRequestBtn) {
    sendToRequestBtn.addEventListener('click', function() {
      var ids = getSelectedCardIds();
      if (!ids.length) return;
      openModal(ids);
    });
  }

  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      var ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') fetchCardAndOpenModal('view', ids[0]);
    });
  }

  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchItems(q); }, 300);
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      fetchItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  function fetchItems(query) {
    ApiClient.get(ENDPOINTS.reprintList + '?q=' + encodeURIComponent(query || '') + '&limit=200')
      .then(function(data) {
        if (data.status !== 'ok') return;
        renderItems(data.items || [], data.total || 0);
      })
      .catch(function(err) {
        console.error('[ReprintList] fetch failed:', err);
      });
  }

  function renderItems(items, total) {
    if (!items.length) {
      updateEmptyTable(tableBody, 'fa-solid fa-id-card', 'No cards in Reprint List', totalCountEl, showingRange);
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
      html += '<button class="btn-send-to-request-single" data-card-id="' + item.card_id + '" title="Send to Request list"><i class="fa-solid fa-check"></i> <span>Request</span></button>';
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
})();

(function requestListStep() {
  var tableBody = document.getElementById('requestTableBody');
  if (!tableBody) return;

  var selectAllCb = document.getElementById('requestSelectAll');
  var searchInput = document.getElementById('requestSearchInput');
  var searchClearBtn = document.getElementById('requestSearchClearBtn');
  var sendToPrintBtn = document.getElementById('requestSendToPrintBtn');
  var rejectBtn = document.getElementById('requestRejectBtn');
  var viewBtn = document.getElementById('requestViewBtn');
  var showingRange = document.getElementById('requestShowingRange');
  var totalCountEl = document.getElementById('requestTotalCount');

  var paginator = createPaginator({
    barId: 'requestPaginationBar',
    prefix: 'request',
    getTableBody: function() { return tableBody; },
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.requestRowCheckbox:not(:disabled)'));
  }

  function getSelectedRrIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.rrId, 10); });
  }

  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId, 10); });
  }

  function updateSelectionUI() {
    var count = getSelectedRrIds().length;
    if (sendToPrintBtn) sendToPrintBtn.disabled = count === 0;
    if (rejectBtn) rejectBtn.disabled = count === 0;
    if (viewBtn) viewBtn.disabled = count !== 1;
    if (paginator) paginator.updateSelectionCount(count);

    if (selectAllCb) {
      var cbs = getCheckboxes();
      var allChecked = cbs.length > 0 && cbs.every(function(cb) { return cb.checked; });
      var someChecked = cbs.some(function(cb) { return cb.checked; });
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

  tableBody.addEventListener('change', function(e) {
    if (e.target.classList.contains('requestRowCheckbox')) updateSelectionUI();
  });

  tableBody.addEventListener('click', async function(e) {
    var printBtn = e.target.closest('.btn-request-print-single');
    if (printBtn && IS_ADMIN_CONTEXT) {
      var rrId = parseInt(printBtn.dataset.rrId, 10);
      if (rrId) performSendToPrint([rrId]);
      return;
    }

    var rejectSingle = e.target.closest('.btn-request-reject-single');
    if (rejectSingle && IS_ADMIN_CONTEXT) {
      var rrId2 = parseInt(rejectSingle.dataset.rrId, 10);
      if (rrId2) {
        var ok = await showConfirm({
          title: 'Reject Request?',
          text: 'Reject this reprint request? Card will move to pool.',
          icon: 'fa-solid fa-ban',
          confirmLabel: 'Reject',
          hideWarning: true,
        });
        if (ok) performReject([rrId2]);
      }
    }
  });

  if (sendToPrintBtn) {
    sendToPrintBtn.addEventListener('click', async function() {
      var ids = getSelectedRrIds();
      if (!ids.length) return;
      var ok = await showConfirm({
        title: 'Send to Print?',
        text: 'Send ' + ids.length + ' item(s) to Print List and move to Confirmed List?',
        icon: 'fa-solid fa-print',
        confirmLabel: 'Send',
        hideWarning: true,
      });
      if (!ok) return;
      performSendToPrint(ids);
    });
  }

  if (rejectBtn) {
    rejectBtn.addEventListener('click', async function() {
      var ids = getSelectedRrIds();
      if (!ids.length) return;
      var ok = await showConfirm({
        title: 'Reject Requests?',
        text: 'Reject ' + ids.length + ' reprint request(s)? Cards will move to pool.',
        icon: 'fa-solid fa-ban',
        confirmLabel: 'Reject',
        hideWarning: true,
      });
      if (!ok) return;
      performReject(ids);
    });
  }

  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      var ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') fetchCardAndOpenModal('view', ids[0]);
    });
  }

  function removeRowsByIds(rrIds) {
    rrIds.forEach(function(id) {
      var row = tableBody.querySelector('tr[data-rr-id="' + id + '"]');
      if (row) row.remove();
    });

    if (!tableBody.querySelector('tr:not(.no-data-row)')) {
      updateEmptyTable(tableBody, 'fa-solid fa-list-check', 'No reprint requests', totalCountEl, showingRange);
      var pBar = document.getElementById('requestPaginationBar');
      if (pBar) pBar.style.display = 'none';
    } else if (paginator) {
      paginator.paginate();
    }

    updateSelectionUI();
  }

  function performSendToPrint(rrIds) {
    ApiClient.post(ENDPOINTS.sendToPrint, { rr_ids: rrIds })
      .then(function(data) {
        if (data.status !== 'ok') {
          showToast(data.message || 'Could not print selected requests', 'error');
          return;
        }
        showToast(data.message || 'Printed and moved to Confirmed List', 'success');
        removeRowsByIds(rrIds);
        refreshStepCounts();
      })
      .catch(function(err) {
        showToast('Request failed. Please try again.', 'error');
        console.error('[RequestList] send-to-print failed:', err);
      });
  }

  function performReject(rrIds) {
    ApiClient.post(ENDPOINTS.reject, { rr_ids: rrIds })
      .then(function(data) {
        if (data.status !== 'ok') {
          showToast(data.message || 'Could not reject selected requests', 'error');
          return;
        }
        showToast(data.message || 'Rejected', 'success');
        removeRowsByIds(rrIds);
        refreshStepCounts();
      })
      .catch(function(err) {
        showToast('Request failed. Please try again.', 'error');
        console.error('[RequestList] reject failed:', err);
      });
  }

  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchItems(q); }, 300);
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      fetchItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  function fetchItems(query) {
    ApiClient.get(ENDPOINTS.requestList + '?q=' + encodeURIComponent(query || '') + '&limit=200')
      .then(function(data) {
        if (data.status !== 'ok') return;
        renderItems(data.items || [], data.total || 0);
      })
      .catch(function(err) {
        console.error('[RequestList] fetch failed:', err);
      });
  }

  function renderItems(items, total) {
    if (!items.length) {
      updateEmptyTable(tableBody, 'fa-solid fa-list-check', 'No items in Request List', totalCountEl, showingRange);
      updateSelectionUI();
      return;
    }

    var html = '';
    items.forEach(function(item, idx) {
      html += '<tr data-rr-id="' + item.rr_id + '" data-card-id="' + item.card_id + '" data-sr-no="' + (idx + 1) + '">';
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="requestRowCheckbox"></td>';
      html += '<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">' + (idx + 1) + '</td>';
      html += renderOrderedFields(item.ordered_fields);
      html += '<td class="min-w-[80px] px-[1px] py-1 align-middle reason-cell whitespace-normal break-words text-left">' + escapeHtml(item.reason || '-') + '</td>';
      html += '<td class="w-[65px] px-[1px] py-1 align-middle user-cell whitespace-normal break-words text-center">' + escapeHtml(item.requested_by_name || '-') + '</td>';
      html += '<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">' + escapeHtml(item.requested_at || '-') + '</td>';
      html += '<td class="w-[100px] px-[1px] py-1 text-center align-middle action-cell"><div class="confirm-action-btns">';
      if (IS_ADMIN_CONTEXT) {
        html += '<button class="btn-request-print-single" data-rr-id="' + item.rr_id + '" title="Send to Print List"><i class="fa-solid fa-print"></i> <span>Print</span></button>';
        html += '<button class="btn-request-reject-single" data-rr-id="' + item.rr_id + '" title="Reject"><i class="fa-solid fa-xmark"></i></button>';
      }
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
})();

(function confirmedListStep() {
  var tableBody = document.getElementById('confirmedTableBody');
  if (!tableBody) return;

  var selectAllCb = document.getElementById('confirmedSelectAll');
  var searchInput = document.getElementById('confirmedSearchInput');
  var searchClearBtn = document.getElementById('confirmedSearchClearBtn');
  var viewBtn = document.getElementById('confirmedViewBtn');
  var showingRange = document.getElementById('confirmedShowingRange');
  var totalCountEl = document.getElementById('confirmedTotalCount');

  var paginator = createPaginator({
    barId: 'confirmedPaginationBar',
    prefix: 'confirmed',
    getTableBody: function() { return tableBody; },
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.confirmedRowCheckbox:not(:disabled)'));
  }

  function getSelectedCardIds() {
    return getCheckboxes().filter(function(cb) { return cb.checked; })
      .map(function(cb) { return parseInt(cb.closest('tr').dataset.cardId, 10); });
  }

  function updateSelectionUI() {
    var count = getCheckboxes().filter(function(cb) { return cb.checked; }).length;
    if (viewBtn) viewBtn.disabled = count !== 1;
    if (paginator) paginator.updateSelectionCount(count);

    if (selectAllCb) {
      var cbs = getCheckboxes();
      var allChecked = cbs.length > 0 && cbs.every(function(cb) { return cb.checked; });
      var someChecked = cbs.some(function(cb) { return cb.checked; });
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

  tableBody.addEventListener('change', function(e) {
    if (e.target.classList.contains('confirmedRowCheckbox')) updateSelectionUI();
  });

  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      var ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') fetchCardAndOpenModal('view', ids[0]);
    });
  }

  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(function() { fetchItems(q); }, 300);
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      fetchItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  function fetchItems(query) {
    ApiClient.get(ENDPOINTS.confirmedList + '?q=' + encodeURIComponent(query || '') + '&limit=200')
      .then(function(data) {
        if (data.status !== 'ok') return;
        renderItems(data.items || [], data.total || 0);
      })
      .catch(function(err) {
        console.error('[ConfirmedList] fetch failed:', err);
      });
  }

  function renderItems(items, total) {
    if (!items.length) {
      updateEmptyTable(tableBody, 'fa-solid fa-clipboard-check', 'No items in Confirmed List', totalCountEl, showingRange);
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
      html += '<td class="w-[65px] px-[1px] py-1 align-middle text-center"><span class="status-badge status-' + (item.status || 'pending') + '">' + escapeHtml(item.status_display || '-') + '</span></td>';
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
