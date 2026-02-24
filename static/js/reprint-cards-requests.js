/**
 * Reprint Cards - Step 1: Reprint Requests
 * Split from reprint-cards-table.js
 */
(function() {
'use strict';

/* -- Pull shared utilities from namespace -- */
var NS = window.ReprintCardsPage || {};
var createReprintPaginator = NS.createPaginator;
var _getCSRFToken  = NS._getCSRFToken;
var _showToast     = NS._showToast;
var _escapeHtml    = NS._escapeHtml;
var _isImageField  = NS._isImageField;
var _refreshStepCounts = NS._refreshStepCounts;

  const TABLE_ID_VAL = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
  const STEP = typeof CURRENT_STEP !== 'undefined' ? CURRENT_STEP : 'requests';

  if (!TABLE_ID_VAL) return;

  // Only run step-1 logic on 'requests' step
  if (STEP !== 'requests') return;

  // â”€â”€ DOM refs â”€â”€
  const selectAllCb = document.getElementById('reprintSelectAll');
  const tableBody = document.getElementById('reprintTableBody');
  const searchInput = document.getElementById('reprintSearchInput');
  const searchClearBtn = document.getElementById('reprintSearchClearBtn');
  const reprintBtn = document.getElementById('reprintRequestBtn');
  const editBtn = document.getElementById('reprintEditBtn');
  const viewBtn = document.getElementById('reprintViewBtn');
  const showingRange = document.getElementById('reprintShowingRange');
  const totalCountEl = document.getElementById('reprintTotalCount');

  // â”€â”€ Paginator â”€â”€
  const paginator = createReprintPaginator({
    barId: 'reprintPaginationBar',
    prefix: 'reprint',
    getTableBody: function() { return tableBody; }
  });

  // Initial pagination on page load
  if (paginator) paginator.paginate();

  // â”€â”€ Helpers (aliases to shared file-scope helpers) â”€â”€
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

  // â”€â”€ Select All â”€â”€
  if (selectAllCb) {
    selectAllCb.addEventListener('change', function() {
      const checked = this.checked;
      getCheckboxes().forEach(cb => { cb.checked = checked; });
      updateSelectionUI();
    });
  }

  // â”€â”€ Row Checkboxes (delegated) â”€â”€
  if (tableBody) {
    tableBody.addEventListener('change', function(e) {
      if (e.target.classList.contains('reprintRowCheckbox')) {
        updateSelectionUI();
      }
    });
  }

  // â”€â”€ Single Reprint Buttons (delegated) â”€â”€
  if (tableBody) {
    tableBody.addEventListener('click', function(e) {
      const btn = e.target.closest('.btn-reprint-single');
      if (!btn) return;
      const cardId = parseInt(btn.dataset.cardId);
      if (cardId) openReasonModal([cardId]);
    });
  }

  // â”€â”€ Bulk Request Reprint Button â”€â”€
  if (reprintBtn) {
    reprintBtn.addEventListener('click', function() {
      const ids = getSelectedCardIds();
      if (ids.length === 0) return;
      openReasonModal(ids);
    });
  }

  // â”€â”€ Edit Button â€” opens side modal on this page â”€â”€
  if (editBtn) {
    editBtn.addEventListener('click', function() {
      const ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') {
        fetchCardAndOpenModal('edit', ids[0]);
      }
    });
  }

  // â”€â”€ View Button â€” opens side modal in view mode â”€â”€
  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      const ids = getSelectedCardIds();
      if (ids.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') {
        fetchCardAndOpenModal('view', ids[0]);
      }
    });
  }

  // â”€â”€ Override updateExistingCard to refresh row in-place instead of full reload â”€â”€
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

  // â”€â”€ Refresh a single row after edit â”€â”€
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

  // â”€â”€ Search â”€â”€
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

  // â”€â”€ Fetch Cards API â”€â”€
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

  // â”€â”€ Render Cards into Table â”€â”€
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

  // â”€â”€ Reason Modal â”€â”€
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
          <h3>Request Reprint â€” ${count} card${count > 1 ? 's' : ''}</h3>
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
    // Disabled â€” prevent accidental closure on outside click

    // Submit
    overlay.querySelector('#reprintSubmitBtn').addEventListener('click', function() {
      const reason = (textarea.value || '').trim();
      this.disabled = true;
      this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';
      submitReprintRequest(cardIds, reason, overlay);
    });
  }

  // â”€â”€ Submit Reprint Request â”€â”€
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
      showToast('Network error â€” please try again', 'error');
      console.error('[Reprint] Submit failed:', err);
    });
  }

  const showToast = _showToast;
  function refreshStepCounts() { _refreshStepCounts(TABLE_ID_VAL); }

})();
