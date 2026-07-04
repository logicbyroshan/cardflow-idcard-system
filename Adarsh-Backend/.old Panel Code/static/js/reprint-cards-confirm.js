/**
 * Reprint Cards - Confirm/Reject (Step 2)
 * Split from reprint-cards-actions.js
 */
(function() {
'use strict';

/*  Pull shared utilities from namespace  */
var NS = window.ReprintCardsPage || {};
var createReprintPaginator = NS.createPaginator;
var _getCSRFToken  = NS._getCSRFToken;
var _showToast     = NS._showToast;
var _escapeHtml    = NS._escapeHtml;
var _isImageField  = NS._isImageField;
var _updateTabCount = NS._updateTabCount;
var _refreshStepCounts = NS._refreshStepCounts;

/* 
   STEP 2: CONFIRM REPRINT  Phase 3
    */
(function() {
  'use strict';

  const TABLE_ID_VAL = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
  const STEP = typeof CURRENT_STEP !== 'undefined' ? CURRENT_STEP : 'requests';

  if (!TABLE_ID_VAL) return;
  if (STEP !== 'confirm') return;

  //  DOM refs 
  const selectAllCb = document.getElementById('confirmSelectAll');
  const tableBody = document.getElementById('confirmTableBody');
  const searchInput = document.getElementById('confirmSearchInput');
  const searchClearBtn = document.getElementById('confirmSearchClearBtn');
  const confirmBtn = document.getElementById('confirmReprintBtn');
  const rejectBtn = document.getElementById('rejectReprintBtn');
  const viewBtn = document.getElementById('confirmViewBtn');
  const showingRange = document.getElementById('confirmShowingRange');
  const totalCountEl = document.getElementById('confirmTotalCount');

  //  Paginator 
  const paginator = createReprintPaginator({
    barId: 'confirmPaginationBar',
    prefix: 'confirm',
    getTableBody: function() { return tableBody; }
  });

  // Initial pagination on page load
  if (paginator) paginator.paginate();

  //  Helpers (aliases to shared file-scope helpers) 
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

  //  Select All 
  if (selectAllCb) {
    selectAllCb.addEventListener('change', function() {
      const checked = this.checked;
      getCheckboxes().forEach(cb => { cb.checked = checked; });
      updateSelectionUI();
    });
  }

  //  Row Checkboxes (delegated) 
  if (tableBody) {
    tableBody.addEventListener('change', function(e) {
      if (e.target.classList.contains('confirmRowCheckbox')) {
        updateSelectionUI();
      }
    });
  }

  //  Single Confirm/Reject Buttons (delegated) 
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

  //  Bulk Confirm Button 
  if (confirmBtn) {
    confirmBtn.addEventListener('click', function() {
      const ids = getSelectedRrIds();
      if (ids.length === 0) return;
      performConfirm(ids);
    });
  }

  //  Bulk Reject Button 
  if (rejectBtn) {
    rejectBtn.addEventListener('click', async function() {
      const ids = getSelectedRrIds();
      if (ids.length === 0) return;
      const ok = await showConfirm({ title: 'Reject Requests?', text: 'Reject ' + ids.length + ' reprint request' + (ids.length > 1 ? 's' : '') + '? This will remove them.', icon: 'fa-solid fa-ban', confirmLabel: 'Reject', hideWarning: true });
      if (!ok) return;
      performReject(ids);
    });
  }

  //  View Button 
  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      const cardIds = getSelectedCardIds();
      if (cardIds.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') {
        fetchCardAndOpenModal('view', cardIds[0]);
      }
    });
  }

  //  Confirm API Call 
  function performConfirm(rrIds) {
    ApiClient.post(`/api/table/${TABLE_ID_VAL}/reprint/confirm/`, { rr_ids: rrIds })
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
      showToast('Network error  please try again', 'error');
      console.error('[Reprint Confirm] Error:', err);
    });
  }

  //  Reject API Call 
  function performReject(rrIds) {
    ApiClient.post(`/api/table/${TABLE_ID_VAL}/reprint/reject/`, { rr_ids: rrIds })
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
      showToast('Network error  please try again', 'error');
      console.error('[Reprint Reject] Error:', err);
    });
  }

  //  Search 
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

  //  Fetch Confirm Items API 
  function fetchConfirmItems(query) {
    const url = `/api/table/${TABLE_ID_VAL}/reprint/confirm-list/?q=${encodeURIComponent(query || '')}&limit=200`;

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

  //  Render Confirm Items into Table 
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

  //  Update Pagination 
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

})();
