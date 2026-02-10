/**
 * Reprint Cards - Page Script
 * Handles: checkbox selection, search, request reprint API, reason modal,
 *          confirm/reject, download, client-side pagination
 */

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

  // ── Helpers ──
  function getCSRFToken() {
    const cookie = document.cookie.split(';').find(c => c.trim().startsWith('csrftoken='));
    return cookie ? cookie.split('=')[1] : '';
  }

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
      // Convert to uppercase
      const uppercaseFieldData = {};
      for (const [key, value] of Object.entries(fieldData)) {
        uppercaseFieldData[key] = typeof value === 'string' ? value.toUpperCase() : value;
      }

      const formData = new FormData();
      formData.append('field_data', JSON.stringify(uppercaseFieldData));

      if (mainPhoto) {
        formData.append('photo', mainPhoto);
      }

      for (const [fieldName, file] of Object.entries(imageFiles)) {
        formData.append(`image_${fieldName}`, file);
      }

      fetch(`/panel/api/card/${cardId}/update/`, {
        method: 'POST',
        headers: {
          'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : ''
        },
        body: formData
      })
      .then(r => r.json())
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
    row.querySelectorAll('td.dynamic-col').forEach(td => {
      const fieldName = td.getAttribute('data-field');
      if (fieldName) {
        // Case-insensitive lookup
        const val = fd[fieldName] || fd[fieldName.toUpperCase()] || fd[fieldName.toLowerCase()] || '-';
        td.textContent = val;
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

    fetch(url, {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(r => r.json())
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

      html += `<tr data-card-id="${card.id}" ${rowClass}>`;
      html += `<td class="checkbox-cell"><input type="checkbox" class="reprintRowCheckbox" ${cbDisabled}></td>`;
      html += `<td class="sr-no-cell">${idx + 1}</td>`;

      // Dynamic text fields
      if (card.ordered_fields) {
        card.ordered_fields.forEach(f => {
          if (!isImageField(f.type, f.name)) {
            html += `<td class="dynamic-col" data-field="${f.name}">${escapeHtml(f.value || '-')}</td>`;
          }
        });
      }

      // Image fields
      if (card.ordered_fields) {
        card.ordered_fields.forEach(f => {
          if (isImageField(f.type, f.name)) {
            html += `<td class="image-field image-cell" data-field="${f.name}" data-field-type="image">`;
            html += `<div class="image-with-edit">`;
            if (f.value && f.value !== '' && f.value !== 'NOT_FOUND' && !f.value.startsWith('PENDING:')) {
              const thumbPath = f.value.replace(/\/([^\/]+)$/, '/thumbnails/$1');
              html += `<img src="/media/${thumbPath}" alt="${f.name}" class="table-image" loading="lazy" onerror="this.onerror=null; this.src='/media/${f.value}'">`;
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
        html += `<td class="action-col"><span class="reprint-badge-requested" title="Reprint already requested"><i class="fa-solid fa-check-circle"></i> Requested</span></td>`;
      } else {
        html += `<td class="action-col"><button class="btn-reprint-single" data-card-id="${card.id}" title="Request reprint"><i class="fa-solid fa-print"></i></button></td>`;
      }

      // Status
      html += `<td class="fixed-col"><span class="status-badge status-${card.status}">${escapeHtml(card.status_display || card.status)}</span></td>`;

      // Last Updated + Updated By
      html += `<td class="date-cell">${escapeHtml(card.updated_at || '-')}</td>`;
      html += `<td class="user-cell">Admin</td>`;

      html += '</tr>';
    });

    tableBody.innerHTML = html;
    if (showingRange) showingRange.textContent = `1-${cards.length}`;
    if (totalCountEl) totalCountEl.textContent = total;
    updateSelectionUI();
    if (paginator) { paginator.reset(); paginator.paginate(); }
  }

  function isImageField(type, name) {
    if (!type && !name) return false;
    const t = (type || '').toLowerCase();
    const n = (name || '').toLowerCase();
    return t === 'image' || t === 'photo' || t === 'file' ||
           n === 'photo' || n === 'image' || n === 'picture' || n === 'pic' || n === 'img';
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
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
    fetch(`/panel/api/table/${TABLE_ID_VAL}/reprint/request/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken(),
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({ card_ids: cardIds, reason: reason })
    })
    .then(r => r.json())
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
            const actionCell = row.querySelector('.action-col');
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

  // ── Refresh Step Counts ──
  function refreshStepCounts() {
    fetch(`/panel/api/table/${TABLE_ID_VAL}/reprint/step-counts/`, {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(r => r.json())
    .then(data => {
      if (data.status === 'success') {
        const counts = data.counts;
        // Update tab badges
        updateTabCount('.reprint-requests-tab .tab-count', counts.requested || 0);
        updateTabCount('.reprint-confirm-tab .tab-count', counts.confirmed || 0);
        updateTabCount('.reprint-download-tab .tab-count', counts.downloaded || 0);
      }
    })
    .catch(() => {});
  }

  function updateTabCount(selector, count) {
    const el = document.querySelector(selector);
    if (el) el.textContent = count;
  }

  // ── Toast (reuse existing or inline) ──
  function showToast(message, type) {
    // Try existing toast system
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    // Try common toast container
    const container = document.getElementById('toast-container') || document.querySelector('.toast-container');
    if (container) {
      const toast = document.createElement('div');
      toast.className = `toast toast-${type || 'info'}`;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
      return;
    }
    // Fallback: simple alert
    alert(message);
  }

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

  // ── Helpers ──
  function getCSRFToken() {
    const cookie = document.cookie.split(';').find(c => c.trim().startsWith('csrftoken='));
    return cookie ? cookie.split('=')[1] : '';
  }

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
    const count = getSelectedRrIds().length;
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
    fetch(`/panel/api/table/${TABLE_ID_VAL}/reprint/confirm/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken(),
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({ rr_ids: rrIds })
    })
    .then(r => r.json())
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
    fetch(`/panel/api/table/${TABLE_ID_VAL}/reprint/reject/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken(),
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({ rr_ids: rrIds })
    })
    .then(r => r.json())
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

    fetch(url, {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(r => r.json())
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
      html += `<tr data-rr-id="${item.rr_id}" data-card-id="${item.card_id}">`;
      html += `<td class="checkbox-cell"><input type="checkbox" class="confirmRowCheckbox"></td>`;
      html += `<td class="sr-no-cell">${idx + 1}</td>`;

      // Dynamic text fields
      if (item.ordered_fields) {
        item.ordered_fields.forEach(f => {
          if (!isImageField(f.type, f.name)) {
            html += `<td class="dynamic-col" data-field="${f.name}">${escapeHtml(f.value || '-')}</td>`;
          }
        });
      }

      // Image fields
      if (item.ordered_fields) {
        item.ordered_fields.forEach(f => {
          if (isImageField(f.type, f.name)) {
            html += `<td class="image-field image-cell" data-field="${f.name}" data-field-type="image">`;
            html += `<div class="image-with-edit">`;
            if (f.value && f.value !== '' && f.value !== 'NOT_FOUND' && !f.value.startsWith('PENDING:')) {
              const thumbPath = f.value.replace(/\/([^\/]+)$/, '/thumbnails/$1');
              html += `<img src="/media/${thumbPath}" alt="${f.name}" class="table-image" loading="lazy" onerror="this.onerror=null; this.src='/media/${f.value}'">`;
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
      html += `<td class="reason-cell" title="${reason}">${shortReason}</td>`;

      // Requested By
      html += `<td class="user-cell">${escapeHtml(item.requested_by_name || '-')}</td>`;

      // Requested At
      html += `<td class="date-cell">${escapeHtml(item.requested_at || '-')}</td>`;

      // Action
      html += `<td class="action-col">`;
      html += `<div class="confirm-action-btns">`;
      html += `<button class="btn-confirm-single" data-rr-id="${item.rr_id}" title="Confirm"><i class="fa-solid fa-check"></i></button>`;
      html += `<button class="btn-reject-single" data-rr-id="${item.rr_id}" title="Reject"><i class="fa-solid fa-xmark"></i></button>`;
      html += `</div></td>`;

      // Status
      html += `<td class="fixed-col"><span class="status-badge status-${item.status}">${escapeHtml(item.status_display || item.status)}</span></td>`;

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

  // ── Shared Helpers ──
  function isImageField(type, name) {
    if (!type && !name) return false;
    const t = (type || '').toLowerCase();
    const n = (name || '').toLowerCase();
    return t === 'image' || t === 'photo' || t === 'file' ||
           n === 'photo' || n === 'image' || n === 'picture' || n === 'pic' || n === 'img';
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function refreshStepCounts() {
    fetch(`/panel/api/table/${TABLE_ID_VAL}/reprint/step-counts/`, {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(r => r.json())
    .then(data => {
      if (data.status === 'success') {
        const counts = data.counts;
        updateTabCount('.reprint-requests-tab .tab-count', counts.requested || 0);
        updateTabCount('.reprint-confirm-tab .tab-count', counts.confirmed || 0);
        updateTabCount('.reprint-download-tab .tab-count', counts.downloaded || 0);
      }
    })
    .catch(() => {});
  }

  function updateTabCount(selector, count) {
    const el = document.querySelector(selector);
    if (el) el.textContent = count;
  }

  function showToast(message, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    const container = document.getElementById('toast-container') || document.querySelector('.toast-container');
    if (container) {
      const toast = document.createElement('div');
      toast.className = `toast toast-${type || 'info'}`;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
      return;
    }
    alert(message);
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

  // ── Helpers ──
  function getCSRFToken() {
    const cookie = document.cookie.split(';').find(c => c.trim().startsWith('csrftoken='));
    return cookie ? cookie.split('=')[1] : '';
  }

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
    const count = getSelectedRrIds().length;
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
    fetch(`/panel/api/table/${TABLE_ID_VAL}/reprint/mark-downloaded/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken(),
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({ rr_ids: rrIds })
    })
    .then(r => r.json())
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

    fetch(url, {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(r => r.json())
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
      html += `<tr data-rr-id="${item.rr_id}" data-card-id="${item.card_id}">`;
      html += `<td class="checkbox-cell"><input type="checkbox" class="downloadRowCheckbox"></td>`;
      html += `<td class="sr-no-cell">${idx + 1}</td>`;

      // Dynamic text fields
      if (item.ordered_fields) {
        item.ordered_fields.forEach(f => {
          if (!isImageField(f.type, f.name)) {
            html += `<td class="dynamic-col" data-field="${f.name}">${escapeHtml(f.value || '-')}</td>`;
          }
        });
      }

      // Image fields
      if (item.ordered_fields) {
        item.ordered_fields.forEach(f => {
          if (isImageField(f.type, f.name)) {
            html += `<td class="image-field image-cell" data-field="${f.name}" data-field-type="image">`;
            html += `<div class="image-with-edit">`;
            if (f.value && f.value !== '' && f.value !== 'NOT_FOUND' && !f.value.startsWith('PENDING:')) {
              const thumbPath = f.value.replace(/\/([^\/]+)$/, '/thumbnails/$1');
              html += `<img src="/media/${thumbPath}" alt="${f.name}" class="table-image" loading="lazy" onerror="this.onerror=null; this.src='/media/${f.value}'">`;
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
      html += `<td class="reason-cell" title="${reason}">${shortReason}</td>`;

      // Confirmed At
      html += `<td class="date-cell">${escapeHtml(item.confirmed_at || '-')}</td>`;

      // Action
      html += `<td class="action-col"><button class="btn-download-single" data-rr-id="${item.rr_id}" title="Download"><i class="fa-solid fa-download"></i></button></td>`;

      // Status
      html += `<td class="fixed-col"><span class="status-badge status-${item.status}">${escapeHtml(item.status_display || item.status)}</span></td>`;

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

  // ── Shared Helpers ──
  function isImageField(type, name) {
    if (!type && !name) return false;
    const t = (type || '').toLowerCase();
    const n = (name || '').toLowerCase();
    return t === 'image' || t === 'photo' || t === 'file' ||
           n === 'photo' || n === 'image' || n === 'picture' || n === 'pic' || n === 'img';
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function refreshStepCounts() {
    fetch(`/panel/api/table/${TABLE_ID_VAL}/reprint/step-counts/`, {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(r => r.json())
    .then(data => {
      if (data.status === 'success') {
        const counts = data.counts;
        updateTabCount('.reprint-requests-tab .tab-count', counts.requested || 0);
        updateTabCount('.reprint-confirm-tab .tab-count', counts.confirmed || 0);
        updateTabCount('.reprint-download-tab .tab-count', counts.downloaded || 0);
      }
    })
    .catch(() => {});
  }

  function updateTabCount(selector, count) {
    const el = document.querySelector(selector);
    if (el) el.textContent = count;
  }

  function showToast(message, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    const container = document.getElementById('toast-container') || document.querySelector('.toast-container');
    if (container) {
      const toast = document.createElement('div');
      toast.className = `toast toast-${type || 'info'}`;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
      return;
    }
    alert(message);
  }

})();
