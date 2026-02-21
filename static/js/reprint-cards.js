/**
 * Reprint Cards - Page Script
 * Handles: checkbox selection, search, request reprint API, reason modal,
 *          confirm/reject, download, client-side pagination
 */
(function() {
'use strict';

/* ══════════════════════════════════════════════════════════════════
   SHARED PAGINATION FACTORY
   Creates a paginator for any reprint step (requests/confirm/download).
   Returns { paginate, reset, updateSelectionCount }.
   ══════════════════════════════════════════════════════════════════ */
function createReprintPaginator(opts) {
  // opts: { barId, prefix, getTableBody }
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

  function reset() {
    currentPage = 1;
  }

  function updateSelectionCount(count) {
    if (selInfoEl && selCountEl) {
      if (count > 0) {
        selCountEl.textContent = count;
        selInfoEl.style.display = '';
      } else {
        selInfoEl.style.display = 'none';
      }
    }
  }

  // ── Event listeners ──
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

  // Close dropdown on outside click
  document.addEventListener('click', function(e) {
    if (rowsDropdown && !rowsDropdown.contains(e.target)) {
      rowsDropdown.classList.remove('open');
    }
  });

  return { paginate: paginate, reset: reset, updateSelectionCount: updateSelectionCount, goToPage: goToPage };
}

/* ══════════════════════════════════════════════════════════════════
   SHARED HELPERS (used by all 3 step IIFEs)
   Delegates to core modules loaded before this file.
   ══════════════════════════════════════════════════════════════════ */
var _getCSRFToken  = window.getCSRFToken  || function() { return ''; };
var _showToast     = window.showToast     || function() {};
var _escapeHtml    = window.escapeHtml    || function(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

function _isImageField(type, name) {
  if (!type && !name) return false;
  var t = (type || '').toLowerCase();
  var n = (name || '').toLowerCase();
  return t === 'image' || t === 'photo' || t === 'file' ||
         n === 'photo' || n === 'image' || n === 'picture' || n === 'pic' || n === 'img';
}

function _updateTabCount(sel, count) {
  var el = document.querySelector(sel);
  if (el) el.textContent = count;
}

function _refreshStepCounts(tableId) {
  ApiClient.get('/panel/api/table/' + tableId + '/reprint/step-counts/')
    .then(function(data) {
      if (data.status === 'success') {
        var c = data.counts;
        _updateTabCount('.reprint-requests-tab .tab-count', c.requested || 0);
        _updateTabCount('.reprint-confirm-tab .tab-count', c.confirmed || 0);
        _updateTabCount('.reprint-download-tab .tab-count', c.downloaded || 0);
      }
    }).catch(function() {});
}

/* ══════════════════════════════════════════════════════════════════
   STEP 1: REPRINT REQUESTS
   ══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  const TABLE_ID_VAL = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
  const STEP = typeof CURRENT_STEP !== 'undefined' ? CURRENT_STEP : 'requests';

  if (!TABLE_ID_VAL) return;

  // Only run step-1 logic on 'requests' step
  if (STEP !== 'requests') return;

  // ── DOM refs ──
  const selectAllCb = document.getElementById('reprintSelectAll');
  const tableBody = document.getElementById('reprintTableBody');
  const searchInput = document.getElementById('reprintSearchInput');
  const searchClearBtn = document.getElementById('reprintSearchClearBtn');
  const reprintBtn = document.getElementById('reprintRequestBtn');
  const editBtn = document.getElementById('reprintEditBtn');
  const viewBtn = document.getElementById('reprintViewBtn');
  const showingRange = document.getElementById('reprintShowingRange');
  const totalCountEl = document.getElementById('reprintTotalCount');

  // ── Paginator ──
  const paginator = createReprintPaginator({
    barId: 'reprintPaginationBar',
    prefix: 'reprint',
    getTableBody: function() { return tableBody; }
  });

  // Initial pagination on page load
  if (paginator) paginator.paginate();

  // ── Helpers (aliases to shared file-scope helpers) ──
  const getCSRFToken = _getCSRFToken, escapeHtml = _escapeHtml, isImageField = _isImageField;

  function getCheckboxes() {
    return tableBody ? Array.from(tableBody.querySelectorAll('.reprintRowCheckbox:not(:disabled)')) : [];
  }

  function getSelectedCardIds() {
    return getCheckboxes()
      .filter(cb => cb.checked)
      .map(cb => parseInt(cb.closest('tr').dataset.cardId));
  }

  function updateSelectionUI() {
    const checked = getSelectedCardIds();
    const count = checked.length;

    // Update buttons
    if (reprintBtn) reprintBtn.disabled = count === 0;
    if (editBtn) editBtn.disabled = count !== 1;
    if (viewBtn) viewBtn.disabled = count !== 1;

    // Update selection info in pagination bar
    if (paginator) paginator.updateSelectionCount(count);

    // Update select-all state
    if (selectAllCb) {
      const allCbs = getCheckboxes();
      const allChecked = allCbs.length > 0 && allCbs.every(cb => cb.checked);
      const someChecked = allCbs.some(cb => cb.checked);
      selectAllCb.checked = allChecked;
      selectAllCb.indeterminate = someChecked && !allChecked;
    }

    // Bridge to Alpine reactive state
    if (typeof window.alpineUpdateSelection === 'function') {
      window.alpineUpdateSelection(checked.map(String));
    }
  }

  // ── Select All ──
  if (selectAllCb) {
    selectAllCb.addEventListener('change', function() {
      const checked = this.checked;
      getCheckboxes().forEach(cb => { cb.checked = checked; });
      updateSelectionUI();
    });
  }

  // ── Row Checkboxes (delegated) ──
  if (tableBody) {
    tableBody.addEventListener('change', function(e) {
      if (e.target.classList.contains('reprintRowCheckbox')) {
        updateSelectionUI();
      }
    });
  }

  // ── Single Reprint Buttons (delegated) ──
  if (tableBody) {
    tableBody.addEventListener('click', function(e) {
      const btn = e.target.closest('.btn-reprint-single');
      if (!btn) return;
      const cardId = parseInt(btn.dataset.cardId);
      if (cardId) openReasonModal([cardId]);
    });
  }

  // ── Bulk Request Reprint Button ──
  if (reprintBtn) {
    reprintBtn.addEventListener('click', function() {
      const ids = getSelectedCardIds();
      if (ids.length === 0) return;
      openReasonModal(ids);
    });
  }

  // ── Edit Button — opens side modal on this page ──
  if (editBtn) {
    editBtn.addEventListener('click', function() {
      const ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') {
        fetchCardAndOpenModal('edit', ids[0]);
      }
    });
  }

  // ── View Button — opens side modal in view mode ──
  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      const ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') {
        fetchCardAndOpenModal('view', ids[0]);
      }
    });
  }

  // ── Override updateExistingCard to refresh row in-place instead of full reload ──
  (function overrideUpdateCard() {
    // Wait for modal.js to define the function, then patch it
    const origUpdate = window.updateExistingCard || (typeof updateExistingCard !== 'undefined' ? updateExistingCard : null);

    window.updateExistingCard = function(cardId, fieldData, imageFiles, mainPhoto) {
      // Send field data as-is - backend handles selective uppercase
      // (uppercasing text fields while preserving image paths)
      const formData = new FormData();
      formData.append('field_data', JSON.stringify(fieldData));

      if (mainPhoto) {
        formData.append('photo', mainPhoto);
      }

      for (const [fieldName, file] of Object.entries(imageFiles)) {
        formData.append(`image_${fieldName}`, file);
      }

      ApiClient.upload(`/panel/api/card/${cardId}/update/`, formData)
      .then(data => {
        if (data.success) {
          if (typeof showToast === 'function') showToast('Card updated successfully!');
          if (typeof closeSideModal === 'function') closeSideModal();
          // Refresh the edited row in the reprint table
          refreshRowAfterEdit(cardId, data.card);
        } else {
          if (typeof showToast === 'function') showToast(data.message || 'Error updating card', false);
          if (window._restoreSaveBtn) window._restoreSaveBtn();
        }
      })
      .catch(error => {
        console.error('[Reprint] Update failed:', error);
        if (typeof showToast === 'function') showToast('Error updating card', false);
        if (window._restoreSaveBtn) window._restoreSaveBtn();
      });
    };
    // Also patch the global ref used by initModalModule's save handler
    if (typeof updateExistingCard !== 'undefined') {
      updateExistingCard = window.updateExistingCard;
    }
  })();

  // ── Refresh a single row after edit ──
  function refreshRowAfterEdit(cardId, updatedCard) {
    const row = tableBody ? tableBody.querySelector(`tr[data-card-id="${cardId}"]`) : null;
    if (!row || !updatedCard) return;

    // Update text cells from field_data
    const fd = updatedCard.field_data || {};
    row.querySelectorAll('td[data-field]').forEach(td => {
      const fieldName = td.getAttribute('data-field');
      if (fieldName && !td.classList.contains('image-field')) {
        // Case-insensitive lookup
        const val = fd[fieldName] || fd[fieldName.toUpperCase()] || fd[fieldName.toLowerCase()] || '-';
        const cellValue = td.querySelector('.cell-value');
        if (cellValue) cellValue.textContent = val;
        else td.textContent = val;
      }
    });

    // Update status badge
    const statusBadge = row.querySelector('.status-badge');
    if (statusBadge && updatedCard.status) {
      statusBadge.className = `status-badge status-${updatedCard.status}`;
      statusBadge.textContent = updatedCard.status_display || updatedCard.status;
    }
  }

  // ── Search ──
  let searchTimer = null;

  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      const q = this.value.trim();

      // Show/hide clear button
      if (searchClearBtn) {
        searchClearBtn.style.display = q ? '' : 'none';
      }

      searchTimer = setTimeout(() => {
        fetchCards(q);
      }, 350);
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      searchInput.focus();
      fetchCards('');
    });
    // Hide initially if empty
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  // ── Fetch Cards API ──
  function fetchCards(query) {
    const url = `/panel/api/table/${TABLE_ID_VAL}/reprint/cards/?q=${encodeURIComponent(query || '')}&limit=200`;

    ApiClient.get(url)
    .then(data => {
      if (data.status === 'success') {
        renderCards(data.cards || [], data.total || 0);
      }
    })
    .catch(err => {
      console.error('[Reprint] Search failed:', err);
    });
  }

  // ── Render Cards into Table ──
  function renderCards(cards, total) {
    if (!tableBody) return;

    if (cards.length === 0) {
      tableBody.innerHTML = `
        <tr class="no-data-row">
          <td colspan="20" class="no-data">
            <div style="padding: 48px 0; text-align: center;">
              <i class="fa-solid fa-magnifying-glass" style="font-size: 48px; color: #d1d5db; margin-bottom: 12px; display: block;"></i>
              <span style="font-size: 14px; color: #6b7280; font-weight: 500;">No matching cards found</span>
            </div>
          </td>
        </tr>`;
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = total;
      updateSelectionUI();
      return;
    }

    let html = '';
    cards.forEach((card, idx) => {
      const hasReprint = card.has_reprint;
      const rowClass = hasReprint ? 'class="reprint-requested"' : '';
      const cbDisabled = hasReprint ? 'disabled title="Already requested"' : '';

      html += `<tr data-card-id="${card.id}" data-sr-no="${idx + 1}" ${rowClass}>`;
      html += `<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="reprintRowCheckbox" ${cbDisabled}></td>`;
      html += `<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">${idx + 1}</td>`;

      // Dynamic text fields
      if (card.ordered_fields) {
        card.ordered_fields.forEach(f => {
          if (!isImageField(f.type, f.name)) {
            html += `<td class="dynamic-field px-[1px] py-1 align-middle" data-field="${escapeHtml(f.name)}" data-field-name="${escapeHtml(f.name)}" data-field-type="${escapeHtml(f.type || 'text')}" data-original-value="${escapeHtml(f.value || '')}"><span class="cell-value">${escapeHtml(f.value || '-')}</span></td>`;
          }
        });
      }

      // Image fields
      if (card.ordered_fields) {
        card.ordered_fields.forEach(f => {
          if (isImageField(f.type, f.name)) {
            html += `<td class="w-[28px] px-[1px] py-1 text-center align-middle image-field image-cell" data-field="${escapeHtml(f.name)}" data-field-name="${escapeHtml(f.name)}" data-field-type="image" data-original-value="${escapeHtml(f.value || '')}">`;
            html += `<div class="image-with-edit">`;
            if (f.value && f.value !== '' && f.value !== 'NOT_FOUND' && !f.value.startsWith('PENDING:')) {
              const thumbPath = f.value.replace(/\/([^\/]+)$/, '/thumbnails/$1');
              html += `<img src="/media/${thumbPath}" alt="${escapeHtml(f.name)}" class="table-image" loading="lazy" onerror="this.onerror=null; this.src='/media/${f.value}'">`;
            } else if (f.value && f.value.startsWith('PENDING:')) {
              html += `<div class="no-image pending-placeholder" title="Waiting for upload"><i class="fa-solid fa-clock"></i></div>`;
            } else {
              html += `<div class="no-image colorful-placeholder" title="No image"><i class="fa-solid fa-user-astronaut"></i></div>`;
            }
            html += `</div></td>`;
          }
        });
      }

      // Action
      if (hasReprint) {
        html += `<td class="w-[60px] px-[1px] py-1 text-center align-middle action-cell"><span class="reprint-badge-requested" title="Reprint already requested"><i class="fa-solid fa-check-circle"></i> Requested</span></td>`;
      } else {
        html += `<td class="w-[60px] px-[1px] py-1 text-center align-middle action-cell"><button class="btn-reprint-single" data-card-id="${card.id}" title="Request reprint"><i class="fa-solid fa-print"></i></button></td>`;
      }

      // Status
      html += `<td class="w-[65px] px-[1px] py-1 align-middle text-center"><span class="status-badge status-${card.status}">${escapeHtml(card.status_display || card.status)}</span></td>`;

      // Last Updated + Updated By
      html += `<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">${escapeHtml(card.updated_at || '-')}</td>`;
      html += `<td class="w-[65px] px-[1px] py-1 align-middle user-cell whitespace-normal break-words text-center">Admin</td>`;

      html += '</tr>';
    });

    tableBody.innerHTML = html;
    if (showingRange) showingRange.textContent = `1-${cards.length}`;
    if (totalCountEl) totalCountEl.textContent = total;
    updateSelectionUI();
    if (paginator) { paginator.reset(); paginator.paginate(); }
  }

  // ── Reason Modal ──
  function openReasonModal(cardIds) {
    // Remove any existing modal
    const existing = document.querySelector('.reprint-reason-overlay');
    if (existing) existing.remove();

    const count = cardIds.length;
    const overlay = document.createElement('div');
    overlay.className = 'reprint-reason-overlay';
    overlay.innerHTML = `
      <div class="reprint-reason-modal">
        <div class="reprint-reason-header">
          <i class="fa-solid fa-print"></i>
          <h3>Request Reprint — ${count} card${count > 1 ? 's' : ''}</h3>
        </div>
        <div class="reprint-reason-body">
          <label for="reprintReasonText">Reason for reprint</label>
          <textarea id="reprintReasonText" placeholder="e.g. Name spelling error, wrong photo, damaged card..." rows="3"></textarea>
          <div class="reason-hint">A reason helps track why cards are reprinted</div>
        </div>
        <div class="reprint-reason-footer">
          <button class="btn-cancel" id="reprintCancelBtn">Cancel</button>
          <button class="btn-submit" id="reprintSubmitBtn">
            <i class="fa-solid fa-print"></i> Request Reprint
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    // Focus textarea
    const textarea = overlay.querySelector('#reprintReasonText');
    setTimeout(() => textarea && textarea.focus(), 100);

    // Cancel
    overlay.querySelector('#reprintCancelBtn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Submit
    overlay.querySelector('#reprintSubmitBtn').addEventListener('click', function() {
      const reason = (textarea.value || '').trim();
      this.disabled = true;
      this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';
      submitReprintRequest(cardIds, reason, overlay);
    });
  }

  // ── Submit Reprint Request ──
  function submitReprintRequest(cardIds, reason, overlay) {
    ApiClient.post(`/panel/api/table/${TABLE_ID_VAL}/reprint/request/`, { card_ids: cardIds, reason: reason })
    .then(data => {
      overlay.remove();

      if (data.status === 'success') {
        const msg = `Reprint requested for ${data.created_count} card${data.created_count !== 1 ? 's' : ''}` +
                    (data.skipped_count > 0 ? ` (${data.skipped_count} already requested)` : '');
        showToast(msg, 'success');

        // Mark the requested rows in the table without full reload
        cardIds.forEach(id => {
          const row = tableBody.querySelector(`tr[data-card-id="${id}"]`);
          if (row && !row.classList.contains('reprint-requested')) {
            row.classList.add('reprint-requested');
            // Disable checkbox
            const cb = row.querySelector('.reprintRowCheckbox');
            if (cb) { cb.checked = false; cb.disabled = true; cb.title = 'Already requested'; }
            // Replace action button with badge
            const actionCell = row.querySelector('.action-cell');
            if (actionCell) {
              actionCell.innerHTML = '<span class="reprint-badge-requested" title="Reprint already requested"><i class="fa-solid fa-check-circle"></i> Requested</span>';
            }
          }
        });

        updateSelectionUI();
        refreshStepCounts();
      } else {
        showToast(data.message || 'Failed to submit reprint request', 'error');
      }
    })
    .catch(err => {
      overlay.remove();
      showToast('Network error — please try again', 'error');
      console.error('[Reprint] Submit failed:', err);
    });
  }

  const showToast = _showToast;
  function refreshStepCounts() { _refreshStepCounts(TABLE_ID_VAL); }

})();

/* ══════════════════════════════════════════════════════════════════
   STEP 2: CONFIRM REPRINT — Phase 3
   ══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  const TABLE_ID_VAL = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
  const STEP = typeof CURRENT_STEP !== 'undefined' ? CURRENT_STEP : 'requests';

  if (!TABLE_ID_VAL) return;
  if (STEP !== 'confirm') return;

  // ── DOM refs ──
  const selectAllCb = document.getElementById('confirmSelectAll');
  const tableBody = document.getElementById('confirmTableBody');
  const searchInput = document.getElementById('confirmSearchInput');
  const searchClearBtn = document.getElementById('confirmSearchClearBtn');
  const confirmBtn = document.getElementById('confirmReprintBtn');
  const rejectBtn = document.getElementById('rejectReprintBtn');
  const viewBtn = document.getElementById('confirmViewBtn');
  const showingRange = document.getElementById('confirmShowingRange');
  const totalCountEl = document.getElementById('confirmTotalCount');

  // ── Paginator ──
  const paginator = createReprintPaginator({
    barId: 'confirmPaginationBar',
    prefix: 'confirm',
    getTableBody: function() { return tableBody; }
  });

  // Initial pagination on page load
  if (paginator) paginator.paginate();

  // ── Helpers (aliases to shared file-scope helpers) ──
  const getCSRFToken = _getCSRFToken, escapeHtml = _escapeHtml, isImageField = _isImageField, showToast = _showToast;
  function refreshStepCounts() { _refreshStepCounts(TABLE_ID_VAL); }

  function getCheckboxes() {
    return tableBody ? Array.from(tableBody.querySelectorAll('.confirmRowCheckbox')) : [];
  }

  function getSelectedRrIds() {
    return getCheckboxes()
      .filter(cb => cb.checked)
      .map(cb => parseInt(cb.closest('tr').dataset.rrId));
  }

  function getSelectedCardIds() {
    return getCheckboxes()
      .filter(cb => cb.checked)
      .map(cb => parseInt(cb.closest('tr').dataset.cardId));
  }

  function updateSelectionUI() {
    const ids = getSelectedRrIds();
    const count = ids.length;
    if (confirmBtn) confirmBtn.disabled = count === 0;
    if (rejectBtn) rejectBtn.disabled = count === 0;
    if (viewBtn) viewBtn.disabled = count !== 1;

    // Update selection info in pagination bar
    if (paginator) paginator.updateSelectionCount(count);

    if (selectAllCb) {
      const allCbs = getCheckboxes();
      const allChecked = allCbs.length > 0 && allCbs.every(cb => cb.checked);
      const someChecked = allCbs.some(cb => cb.checked);
      selectAllCb.checked = allChecked;
      selectAllCb.indeterminate = someChecked && !allChecked;
    }

    // Bridge to Alpine reactive state
    if (typeof window.alpineUpdateSelection === 'function') {
      window.alpineUpdateSelection(ids.map(String));
    }
  }

  // ── Select All ──
  if (selectAllCb) {
    selectAllCb.addEventListener('change', function() {
      const checked = this.checked;
      getCheckboxes().forEach(cb => { cb.checked = checked; });
      updateSelectionUI();
    });
  }

  // ── Row Checkboxes (delegated) ──
  if (tableBody) {
    tableBody.addEventListener('change', function(e) {
      if (e.target.classList.contains('confirmRowCheckbox')) {
        updateSelectionUI();
      }
    });
  }

  // ── Single Confirm/Reject Buttons (delegated) ──
  if (tableBody) {
    tableBody.addEventListener('click', function(e) {
      const confirmSingle = e.target.closest('.btn-confirm-single');
      if (confirmSingle) {
        const rrId = parseInt(confirmSingle.dataset.rrId);
        if (rrId) performConfirm([rrId]);
        return;
      }
      const rejectSingle = e.target.closest('.btn-reject-single');
      if (rejectSingle) {
        const rrId = parseInt(rejectSingle.dataset.rrId);
        if (rrId) performReject([rrId]);
        return;
      }
    });
  }

  // ── Bulk Confirm Button ──
  if (confirmBtn) {
    confirmBtn.addEventListener('click', function() {
      const ids = getSelectedRrIds();
      if (ids.length === 0) return;
      performConfirm(ids);
    });
  }

  // ── Bulk Reject Button ──
  if (rejectBtn) {
    rejectBtn.addEventListener('click', function() {
      const ids = getSelectedRrIds();
      if (ids.length === 0) return;
      if (!confirm(`Reject ${ids.length} reprint request${ids.length > 1 ? 's' : ''}? This will remove them.`)) return;
      performReject(ids);
    });
  }

  // ── View Button ──
  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      const cardIds = getSelectedCardIds();
      if (cardIds.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') {
        fetchCardAndOpenModal('view', cardIds[0]);
      }
    });
  }

  // ── Confirm API Call ──
  function performConfirm(rrIds) {
    ApiClient.post(`/panel/api/table/${TABLE_ID_VAL}/reprint/confirm/`, { rr_ids: rrIds })
    .then(data => {
      if (data.status === 'success') {
        showToast(`${data.confirmed_count} reprint${data.confirmed_count !== 1 ? 's' : ''} confirmed`, 'success');
        // Remove confirmed rows from table
        rrIds.forEach(id => {
          const row = tableBody.querySelector(`tr[data-rr-id="${id}"]`);
          if (row) row.remove();
        });
        updatePagination();
        updateSelectionUI();
        refreshStepCounts();
      } else {
        showToast(data.message || 'Failed to confirm', 'error');
      }
    })
    .catch(err => {
      showToast('Network error — please try again', 'error');
      console.error('[Reprint Confirm] Error:', err);
    });
  }

  // ── Reject API Call ──
  function performReject(rrIds) {
    ApiClient.post(`/panel/api/table/${TABLE_ID_VAL}/reprint/reject/`, { rr_ids: rrIds })
    .then(data => {
      if (data.status === 'success') {
        showToast(`${data.rejected_count} reprint${data.rejected_count !== 1 ? 's' : ''} rejected`, 'success');
        // Remove rejected rows from table
        rrIds.forEach(id => {
          const row = tableBody.querySelector(`tr[data-rr-id="${id}"]`);
          if (row) row.remove();
        });
        updatePagination();
        updateSelectionUI();
        refreshStepCounts();
      } else {
        showToast(data.message || 'Failed to reject', 'error');
      }
    })
    .catch(err => {
      showToast('Network error — please try again', 'error');
      console.error('[Reprint Reject] Error:', err);
    });
  }

  // ── Search ──
  let searchTimer = null;

  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      const q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(() => fetchConfirmItems(q), 350);
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', function() {
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      searchInput.focus();
      fetchConfirmItems('');
    });
    searchClearBtn.style.display = searchInput && searchInput.value ? '' : 'none';
  }

  // ── Fetch Confirm Items API ──
  function fetchConfirmItems(query) {
    const url = `/panel/api/table/${TABLE_ID_VAL}/reprint/confirm-list/?q=${encodeURIComponent(query || '')}&limit=200`;

    ApiClient.get(url)
    .then(data => {
      if (data.status === 'success') {
        renderConfirmItems(data.items || [], data.total || 0);
      }
    })
    .catch(err => {
      console.error('[Reprint Confirm] Search failed:', err);
    });
  }

  // ── Render Confirm Items into Table ──
  function renderConfirmItems(items, total) {
    if (!tableBody) return;

    if (items.length === 0) {
      tableBody.innerHTML = `
        <tr class="no-data-row">
          <td colspan="20" class="no-data">
            <div style="padding: 48px 0; text-align: center;">
              <i class="fa-solid fa-clipboard-check" style="font-size: 48px; color: #d1d5db; margin-bottom: 12px; display: block;"></i>
              <span style="font-size: 14px; color: #6b7280; font-weight: 500;">No reprints pending confirmation</span>
              <br><span style="font-size: 12px; color: #9ca3af;">Request reprints from Step 1 first</span>
            </div>
          </td>
        </tr>`;
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = total;
      updateSelectionUI();
      return;
    }

    let html = '';
    items.forEach((item, idx) => {
      html += `<tr data-rr-id="${item.rr_id}" data-card-id="${item.card_id}" data-sr-no="${idx + 1}">`;
      html += `<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="confirmRowCheckbox"></td>`;
      html += `<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">${idx + 1}</td>`;

      // Dynamic text fields
      if (item.ordered_fields) {
        item.ordered_fields.forEach(f => {
          if (!isImageField(f.type, f.name)) {
            html += `<td class="dynamic-field px-[1px] py-1 align-middle" data-field="${escapeHtml(f.name)}" data-field-name="${escapeHtml(f.name)}" data-field-type="${escapeHtml(f.type || 'text')}" data-original-value="${escapeHtml(f.value || '')}"><span class="cell-value">${escapeHtml(f.value || '-')}</span></td>`;
          }
        });
      }

      // Image fields
      if (item.ordered_fields) {
        item.ordered_fields.forEach(f => {
          if (isImageField(f.type, f.name)) {
            html += `<td class="w-[28px] px-[1px] py-1 text-center align-middle image-field image-cell" data-field="${escapeHtml(f.name)}" data-field-name="${escapeHtml(f.name)}" data-field-type="image" data-original-value="${escapeHtml(f.value || '')}">`;
            html += `<div class="image-with-edit">`;
            if (f.value && f.value !== '' && f.value !== 'NOT_FOUND' && !f.value.startsWith('PENDING:')) {
              const thumbPath = f.value.replace(/\/([^\/]+)$/, '/thumbnails/$1');
              html += `<img src="/media/${thumbPath}" alt="${escapeHtml(f.name)}" class="table-image" loading="lazy" onerror="this.onerror=null; this.src='/media/${f.value}'">`;
            } else if (f.value && f.value.startsWith('PENDING:')) {
              html += `<div class="no-image pending-placeholder" title="Waiting for upload"><i class="fa-solid fa-clock"></i></div>`;
            } else {
              html += `<div class="no-image colorful-placeholder" title="No image"><i class="fa-solid fa-user-astronaut"></i></div>`;
            }
            html += `</div></td>`;
          }
        });
      }

      // Reason
      const reason = escapeHtml(item.reason || '-');
      const shortReason = reason.length > 60 ? reason.substring(0, 57) + '...' : reason;
      html += `<td class="min-w-[80px] px-[1px] py-1 align-middle reason-cell whitespace-normal break-words text-left" title="${reason}">${shortReason}</td>`;

      // Requested By
      html += `<td class="w-[65px] px-[1px] py-1 align-middle user-cell whitespace-normal break-words text-center">${escapeHtml(item.requested_by_name || '-')}</td>`;

      // Requested At
      html += `<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">${escapeHtml(item.requested_at || '-')}</td>`;

      // Action
      html += `<td class="w-[60px] px-[1px] py-1 text-center align-middle action-cell">`;
      html += `<div class="confirm-action-btns">`;
      html += `<button class="btn-confirm-single" data-rr-id="${item.rr_id}" title="Confirm"><i class="fa-solid fa-check"></i></button>`;
      html += `<button class="btn-reject-single" data-rr-id="${item.rr_id}" title="Reject"><i class="fa-solid fa-xmark"></i></button>`;
      html += `</div></td>`;

      // Status
      html += `<td class="w-[65px] px-[1px] py-1 align-middle text-center"><span class="status-badge status-${item.status}">${escapeHtml(item.status_display || item.status)}</span></td>`;

      html += '</tr>';
    });

    tableBody.innerHTML = html;
    if (showingRange) showingRange.textContent = `1-${items.length}`;
    if (totalCountEl) totalCountEl.textContent = total;
    updateSelectionUI();
    if (paginator) { paginator.reset(); paginator.paginate(); }
  }

  // ── Update Pagination ──
  function updatePagination() {
    if (!tableBody) return;
    const rows = tableBody.querySelectorAll('tr:not(.no-data-row)');
    const count = rows.length;

    // Show empty state if no rows
    if (count === 0) {
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = '0';
      const paginationBar = document.getElementById('confirmPaginationBar');
      if (paginationBar) paginationBar.style.display = 'none';
      tableBody.innerHTML = `
        <tr class="no-data-row">
          <td colspan="20" class="no-data">
            <div style="padding: 48px 0; text-align: center;">
              <i class="fa-solid fa-clipboard-check" style="font-size: 48px; color: #d1d5db; margin-bottom: 12px; display: block;"></i>
              <span style="font-size: 14px; color: #6b7280; font-weight: 500;">No reprints pending confirmation</span>
              <br><span style="font-size: 12px; color: #9ca3af;">Request reprints from Step 1 first</span>
            </div>
          </td>
        </tr>`;
    } else {
      if (paginator) paginator.paginate();
    }
  }

})();

/* ══════════════════════════════════════════════════════════════════
   STEP 3: DOWNLOAD REPRINTS — Phase 4
   ══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  const TABLE_ID_VAL = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
  const STEP = typeof CURRENT_STEP !== 'undefined' ? CURRENT_STEP : 'requests';

  if (!TABLE_ID_VAL) return;
  if (STEP !== 'download') return;

  // ── DOM refs ──
  const selectAllCb = document.getElementById('downloadSelectAll');
  const tableBody = document.getElementById('downloadTableBody');
  const searchInput = document.getElementById('downloadSearchInput');
  const searchClearBtn = document.getElementById('downloadSearchClearBtn');
  const downloadBtn = document.getElementById('downloadReprintBtn');
  const viewBtn = document.getElementById('downloadViewBtn');
  const showingRange = document.getElementById('downloadShowingRange');
  const totalCountEl = document.getElementById('downloadTotalCount');

  // ── Paginator ──
  const paginator = createReprintPaginator({
    barId: 'downloadPaginationBar',
    prefix: 'download',
    getTableBody: function() { return tableBody; }
  });

  // Initial pagination on page load
  if (paginator) paginator.paginate();

  // ── Helpers (aliases to shared file-scope helpers) ──
  const getCSRFToken = _getCSRFToken, escapeHtml = _escapeHtml, isImageField = _isImageField, showToast = _showToast;
  function refreshStepCounts() { _refreshStepCounts(TABLE_ID_VAL); }

  function getCheckboxes() {
    return tableBody ? Array.from(tableBody.querySelectorAll('.downloadRowCheckbox')) : [];
  }

  function getSelectedRrIds() {
    return getCheckboxes()
      .filter(cb => cb.checked)
      .map(cb => parseInt(cb.closest('tr').dataset.rrId));
  }

  function getSelectedCardIds() {
    return getCheckboxes()
      .filter(cb => cb.checked)
      .map(cb => parseInt(cb.closest('tr').dataset.cardId));
  }

  function updateSelectionUI() {
    const ids = getSelectedRrIds();
    const count = ids.length;
    if (downloadBtn) downloadBtn.disabled = count === 0;
    if (viewBtn) viewBtn.disabled = count !== 1;

    // Update selection info in pagination bar
    if (paginator) paginator.updateSelectionCount(count);

    if (selectAllCb) {
      const allCbs = getCheckboxes();
      const allChecked = allCbs.length > 0 && allCbs.every(cb => cb.checked);
      const someChecked = allCbs.some(cb => cb.checked);
      selectAllCb.checked = allChecked;
      selectAllCb.indeterminate = someChecked && !allChecked;
    }

    // Bridge to Alpine reactive state
    if (typeof window.alpineUpdateSelection === 'function') {
      window.alpineUpdateSelection(ids.map(String));
    }
  }

  // ── Select All ──
  if (selectAllCb) {
    selectAllCb.addEventListener('change', function() {
      const checked = this.checked;
      getCheckboxes().forEach(cb => { cb.checked = checked; });
      updateSelectionUI();
    });
  }

  // ── Row Checkboxes (delegated) ──
  if (tableBody) {
    tableBody.addEventListener('change', function(e) {
      if (e.target.classList.contains('downloadRowCheckbox')) {
        updateSelectionUI();
      }
    });
  }

  // ── Single Download Button (delegated) ──
  if (tableBody) {
    tableBody.addEventListener('click', function(e) {
      const btn = e.target.closest('.btn-download-single');
      if (!btn) return;
      const rrId = parseInt(btn.dataset.rrId);
      if (rrId) performDownload([rrId]);
    });
  }

  // ── Bulk Download Button ──
  if (downloadBtn) {
    downloadBtn.addEventListener('click', function() {
      const ids = getSelectedRrIds();
      if (ids.length === 0) return;
      performDownload(ids);
    });
  }

  // ── View Button ──
  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      const cardIds = getSelectedCardIds();
      if (cardIds.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') {
        fetchCardAndOpenModal('view', cardIds[0]);
      }
    });
  }

  // ── Download (Mark as Downloaded) API Call ──
  function performDownload(rrIds) {
    ApiClient.post(`/panel/api/table/${TABLE_ID_VAL}/reprint/mark-downloaded/`, { rr_ids: rrIds })
    .then(data => {
      if (data.status === 'success') {
        showToast(`${data.downloaded_count} reprint${data.downloaded_count !== 1 ? 's' : ''} marked as downloaded`, 'success');
        // Remove downloaded rows from table
        rrIds.forEach(id => {
          const row = tableBody.querySelector(`tr[data-rr-id="${id}"]`);
          if (row) row.remove();
        });
        updatePagination();
        updateSelectionUI();
        refreshStepCounts();
      } else {
        showToast(data.message || 'Failed to download', 'error');
      }
    })
    .catch(err => {
      showToast('Network error — please try again', 'error');
      console.error('[Reprint Download] Error:', err);
    });
  }

  // ── Search ──
  let searchTimer = null;

  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      const q = this.value.trim();
      if (searchClearBtn) searchClearBtn.style.display = q ? '' : 'none';
      searchTimer = setTimeout(() => fetchDownloadItems(q), 350);
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

  // ── Fetch Download Items API ──
  function fetchDownloadItems(query) {
    const url = `/panel/api/table/${TABLE_ID_VAL}/reprint/download-list/?q=${encodeURIComponent(query || '')}&limit=200`;

    ApiClient.get(url)
    .then(data => {
      if (data.status === 'success') {
        renderDownloadItems(data.items || [], data.total || 0);
      }
    })
    .catch(err => {
      console.error('[Reprint Download] Search failed:', err);
    });
  }

  // ── Render Download Items into Table ──
  function renderDownloadItems(items, total) {
    if (!tableBody) return;

    if (items.length === 0) {
      tableBody.innerHTML = `
        <tr class="no-data-row">
          <td colspan="20" class="no-data">
            <div style="padding: 48px 0; text-align: center;">
              <i class="fa-solid fa-download" style="font-size: 48px; color: #d1d5db; margin-bottom: 12px; display: block;"></i>
              <span style="font-size: 14px; color: #6b7280; font-weight: 500;">No reprints ready for download</span>
              <br><span style="font-size: 12px; color: #9ca3af;">Confirm reprints in Step 2 first</span>
            </div>
          </td>
        </tr>`;
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = total;
      updateSelectionUI();
      return;
    }

    let html = '';
    items.forEach((item, idx) => {
      html += `<tr data-rr-id="${item.rr_id}" data-card-id="${item.card_id}" data-sr-no="${idx + 1}">`;
      html += `<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="downloadRowCheckbox"></td>`;
      html += `<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">${idx + 1}</td>`;

      // Dynamic text fields
      if (item.ordered_fields) {
        item.ordered_fields.forEach(f => {
          if (!isImageField(f.type, f.name)) {
            html += `<td class="dynamic-field px-[1px] py-1 align-middle" data-field="${escapeHtml(f.name)}" data-field-name="${escapeHtml(f.name)}" data-field-type="${escapeHtml(f.type || 'text')}" data-original-value="${escapeHtml(f.value || '')}"><span class="cell-value">${escapeHtml(f.value || '-')}</span></td>`;
          }
        });
      }

      // Image fields
      if (item.ordered_fields) {
        item.ordered_fields.forEach(f => {
          if (isImageField(f.type, f.name)) {
            html += `<td class="w-[28px] px-[1px] py-1 text-center align-middle image-field image-cell" data-field="${escapeHtml(f.name)}" data-field-name="${escapeHtml(f.name)}" data-field-type="image" data-original-value="${escapeHtml(f.value || '')}">`;
            html += `<div class="image-with-edit">`;
            if (f.value && f.value !== '' && f.value !== 'NOT_FOUND' && !f.value.startsWith('PENDING:')) {
              const thumbPath = f.value.replace(/\/([^\/]+)$/, '/thumbnails/$1');
              html += `<img src="/media/${thumbPath}" alt="${escapeHtml(f.name)}" class="table-image" loading="lazy" onerror="this.onerror=null; this.src='/media/${f.value}'">`;
            } else if (f.value && f.value.startsWith('PENDING:')) {
              html += `<div class="no-image pending-placeholder" title="Waiting for upload"><i class="fa-solid fa-clock"></i></div>`;
            } else {
              html += `<div class="no-image colorful-placeholder" title="No image"><i class="fa-solid fa-user-astronaut"></i></div>`;
            }
            html += `</div></td>`;
          }
        });
      }

      // Reason
      const reason = escapeHtml(item.reason || '-');
      const shortReason = reason.length > 60 ? reason.substring(0, 57) + '...' : reason;
      html += `<td class="min-w-[80px] px-[1px] py-1 align-middle reason-cell whitespace-normal break-words text-left" title="${reason}">${shortReason}</td>`;

      // Confirmed At
      html += `<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">${escapeHtml(item.confirmed_at || '-')}</td>`;

      // Action
      html += `<td class="w-[60px] px-[1px] py-1 text-center align-middle action-cell"><button class="btn-download-single" data-rr-id="${item.rr_id}" title="Download"><i class="fa-solid fa-download"></i></button></td>`;

      // Status
      html += `<td class="w-[65px] px-[1px] py-1 align-middle text-center"><span class="status-badge status-${item.status}">${escapeHtml(item.status_display || item.status)}</span></td>`;

      html += '</tr>';
    });

    tableBody.innerHTML = html;
    if (showingRange) showingRange.textContent = `1-${items.length}`;
    if (totalCountEl) totalCountEl.textContent = total;
    updateSelectionUI();
    if (paginator) { paginator.reset(); paginator.paginate(); }
  }

  // ── Update Pagination ──
  function updatePagination() {
    if (!tableBody) return;
    const rows = tableBody.querySelectorAll('tr:not(.no-data-row)');
    const count = rows.length;

    if (count === 0) {
      if (showingRange) showingRange.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = '0';
      const paginationBar = document.getElementById('downloadPaginationBar');
      if (paginationBar) paginationBar.style.display = 'none';
      tableBody.innerHTML = `
        <tr class="no-data-row">
          <td colspan="20" class="no-data">
            <div style="padding: 48px 0; text-align: center;">
              <i class="fa-solid fa-download" style="font-size: 48px; color: #d1d5db; margin-bottom: 12px; display: block;"></i>
              <span style="font-size: 14px; color: #6b7280; font-weight: 500;">No reprints ready for download</span>
              <br><span style="font-size: 12px; color: #9ca3af;">Confirm reprints in Step 2 first</span>
            </div>
          </td>
        </tr>`;
    } else {
      if (paginator) paginator.paginate();
    }
  }

})();

})(); // end outer IIFE