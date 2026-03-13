/**
 * Print Cards  Single-file JS for the Print Cards workflow.
 * Steps: Print List  (Configure & Generate)  Finalized
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
        updateTabCount('.print-list-tab .tab-count', data.print_list || 0);
        updateTabCount('.print-generate-tab .tab-count', data.generate_list || 0);
        updateTabCount('.print-finalized-tab .tab-count', data.finalized || 0);
      }
    }).catch(function() {});
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
   CONFIGURE & PRINT MODAL
    */
(function configureModal() {
  var modal      = document.getElementById('configureModal');
  var closeBtn   = document.getElementById('configureModalClose');
  var cancelBtn  = document.getElementById('configureModalCancel');
  var generateBtn = document.getElementById('configureModalGenerate');
  var printAllBtn = document.getElementById('printAllBtn');

  if (!modal || !printAllBtn) return;

  var TABLE_FIELDS = window.TABLE_FIELDS || [];
  var FIELD_CONFIG = window.FIELD_CONFIG || {};
  var isTwoSided  = !!(FIELD_CONFIG.is_two_sided);

  var singleBtn = document.getElementById('cfgSingleBtn');
  var doubleBtn = document.getElementById('cfgDoubleBtn');
  var backSection = document.getElementById('cfgBackSection');
  var backPdfRow  = document.getElementById('cfgBackPdfRow');
  var frontFieldsDiv = document.getElementById('cfgFrontFields');
  var backFieldsDiv  = document.getElementById('cfgBackFields');

  var frontPdfInput  = document.getElementById('cfgFrontPdfInput');
  var backPdfInput   = document.getElementById('cfgBackPdfInput');
  var frontPdfStatus = document.getElementById('cfgFrontPdfStatus');
  var backPdfStatus  = document.getElementById('cfgBackPdfStatus');

  // Build field checkboxes
  function buildFieldCheckboxes(container, side) {
    var selectedFields = (side === 'front') ? (FIELD_CONFIG.front_fields || []) : (FIELD_CONFIG.back_fields || []);
    container.innerHTML = '';
    TABLE_FIELDS.forEach(function(f) {
      var checked = selectedFields.indexOf(f.name) >= 0;
      var isImg = isImageField(f.type, f.name);
      var label = document.createElement('label');
      label.className = 'cfg-field-item';
      label.innerHTML =
        '<input type="checkbox" value="' + escapeHtml(f.name) + '"' + (checked ? ' checked' : '') + '>' +
        '<span>' + escapeHtml(f.name) + (isImg ? ' <i class="fa-solid fa-image text-gray-400 text-[10px]"></i>' : '') + '</span>';
      container.appendChild(label);
    });
  }

  function getCheckedFields(container) {
    return Array.from(container.querySelectorAll('input[type=checkbox]:checked')).map(function(cb) { return cb.value; });
  }

  // Side toggle
  function setSides(two) {
    isTwoSided = two;
    singleBtn.classList.toggle('active', !two);
    doubleBtn.classList.toggle('active', two);
    backSection.classList.toggle('hidden', !two);
    backPdfRow.classList.toggle('hidden', !two);
  }

  singleBtn.addEventListener('click', function() { setSides(false); });
  doubleBtn.addEventListener('click', function() { setSides(true); });

  // Open modal
  function openModal() {
    buildFieldCheckboxes(frontFieldsDiv, 'front');
    buildFieldCheckboxes(backFieldsDiv, 'back');
    setSides(isTwoSided);
    // Reset file inputs
    frontPdfInput.value = '';
    backPdfInput.value = '';
    modal.classList.add('show');
  }

  function closeModal() {
    modal.classList.remove('show');
  }

  printAllBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeModal();
  });

  // Update label when PDF file selected
  if (frontPdfInput) {
    frontPdfInput.addEventListener('change', function() {
      var label = document.getElementById('cfgFrontPdfLabel');
      if (label) label.textContent = this.files[0] ? this.files[0].name : 'Upload Front PDF';
    });
  }
  if (backPdfInput) {
    backPdfInput.addEventListener('change', function() {
      var label = document.getElementById('cfgBackPdfLabel');
      if (label) label.textContent = this.files[0] ? this.files[0].name : 'Upload Back PDF';
    });
  }

  // Upload PDF helper (sequential, returns Promise)
  function uploadPdf(file, side) {
    return new Promise(function(resolve, reject) {
      var formData = new FormData();
      formData.append('pdf', file);
      fetch('/print/api/generate-card/table/' + TABLE_ID + '/template/upload-pdf/' + side + '/', {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCSRFToken(),
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: formData,
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.status === 'ok') {
          // Keep global editor URLs in sync with freshly uploaded template files.
          if (side === 'front' && data.pdf_url) window.FRONT_PDF_URL = data.pdf_url;
          if (side === 'back' && data.pdf_url) window.BACK_PDF_URL = data.pdf_url;
          resolve(data);
        }
        else reject(new Error(data.message || 'Upload failed'));
      })
      .catch(reject);
    });
  }

  // Generate button handler
  generateBtn.addEventListener('click', function() {
    var frontFields = getCheckedFields(frontFieldsDiv);
    var backFields  = isTwoSided ? getCheckedFields(backFieldsDiv) : [];

    if (frontFields.length === 0) {
      showToast('Select at least one front side field.', 'warning');
      return;
    }

    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing';

    // Step 1: Save field_config
    ApiClient.post('/print/api/table/' + TABLE_ID + '/field-config/', {
      is_two_sided: isTwoSided,
      front_fields: frontFields,
      back_fields: backFields,
    })
    .then(function(data) {
      if (data.status !== 'ok') throw new Error(data.message || 'Failed to save config');

      // Keep runtime field config in sync so generate editor dropdowns use latest selections.
      window.FIELD_CONFIG = {
        is_two_sided: isTwoSided,
        front_fields: frontFields,
        back_fields: backFields,
      };

      // Step 2: Upload PDFs if file selected
      var uploads = [];
      if (frontPdfInput.files[0]) {
        uploads.push(uploadPdf(frontPdfInput.files[0], 'front').then(function() {
          frontPdfStatus.innerHTML = '<i class="fa-solid fa-check" style="color:#10b981;"></i> Uploaded';
        }));
      }
      if (isTwoSided && backPdfInput.files[0]) {
        uploads.push(uploadPdf(backPdfInput.files[0], 'back').then(function() {
          backPdfStatus.innerHTML = '<i class="fa-solid fa-check" style="color:#10b981;"></i> Uploaded';
        }));
      }
      return Promise.all(uploads);
    })
    .then(function() {
      // Step 3: Move all print_list  generate_list
      return ApiClient.post('/print/api/table/' + TABLE_ID + '/generate-all/', {});
    })
    .then(function(data) {
      if (data.status !== 'ok') throw new Error(data.message || 'Failed to send to generate');
      showToast(data.message || 'Cards sent to generate list!', 'success');
      // Step 4: Open the generate-card editor modal (instead of navigating away)
      closeModal();
      if (typeof window.openGcEditorModal === 'function') {
        // Always pass latest known template URLs so editor renders current files.
        var newFrontUrl = window.FRONT_PDF_URL || undefined;
        var newBackUrl  = window.BACK_PDF_URL || undefined;
        window.openGcEditorModal();
        if (typeof window.gcEditorRefresh === 'function') {
          window.gcEditorRefresh(newFrontUrl, newBackUrl);
        }
      } else {
        // Fallback: navigate to editor page
        window.location.href = data.redirect_url || ('/print/generate-card/table/' + TABLE_ID + '/');
      }
    })
    .catch(function(err) {
      showToast(err.message || 'Something went wrong', 'error');
      console.error('[ConfigureModal] Error:', err);
      generateBtn.disabled = false;
      generateBtn.innerHTML = '<i class="fa-solid fa-print"></i> Generate';
    });
  });
})();


/* 
   STEP 1: PRINT LIST (status = print_list)
   Actions: Print All (opens modal), Remove (bulk + single)
    */
(function printListStep() {
  var tableBody     = document.getElementById('printListTableBody');
  var selectAllCb   = document.getElementById('printListSelectAll');
  var searchInput   = document.getElementById('printListSearchInput');
  var searchClearBtn = document.getElementById('printListSearchClearBtn');
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

  // Single-row remove
  if (tableBody) {
    tableBody.addEventListener('click', async function(e) {
      var rmBtn = e.target.closest('.btn-remove-single');
      if (rmBtn) {
        var prId = parseInt(rmBtn.dataset.prId);
        if (prId) {
          var ok = await showConfirm({ title: 'Remove Card?', text: 'Remove this card from the print list?', icon: 'fa-solid fa-xmark', confirmLabel: 'Remove', hideWarning: true });
          if (ok) performRemove([prId]);
        }
      }
    });
  }

  // Bulk Remove
  if (removeBtn) {
    removeBtn.addEventListener('click', async function() {
      var ids = getSelectedPrIds();
      if (ids.length === 0) return;
      var ok = await showConfirm({ title: 'Remove Items?', text: 'Remove ' + ids.length + ' item(s) from the print list?', icon: 'fa-solid fa-xmark', confirmLabel: 'Remove', hideWarning: true });
      if (!ok) return;
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

  // Remove API
  function performRemove(prIds) {
    ApiClient.post('/print/api/table/' + TABLE_ID + '/remove/', { request_ids: prIds })
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
    var url = '/print/api/table/' + TABLE_ID + '/list/?q=' + encodeURIComponent(query || '') + '&limit=200';
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


/* 
   STEP 2: GENERATE LIST (status = generate_list)
   Actions: Continue Generate (bulk selected), View
    */
(function generateListStep() {
  var tableBody      = document.getElementById('generateListTableBody');
  var selectAllCb    = document.getElementById('generateListSelectAll');
  var searchInput    = document.getElementById('generateListSearchInput');
  var searchClearBtn = document.getElementById('generateListSearchClearBtn');
  var continueBtn    = document.getElementById('continueGenerateBtn');
  var viewBtn        = document.getElementById('generateListViewBtn');
  var showingRange   = document.getElementById('generateListShowingRange');
  var totalCountEl   = document.getElementById('generateListTotalCount');

  if (!tableBody) return;

  var paginator = createPaginator({
    barId: 'generateListPaginationBar',
    prefix: 'generateList',
    getTableBody: function() { return tableBody; }
  });
  if (paginator) paginator.paginate();

  function getCheckboxes() {
    return Array.from(tableBody.querySelectorAll('.generateListRowCheckbox:not(:disabled)'));
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
    if (continueBtn) continueBtn.disabled = count === 0;
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

  function openGeneratorWithSelection(prIds) {
    window.GEN_PRESELECT_PR_IDS = prIds.slice();
    if (typeof window.openGcEditorModal === 'function') {
      window.openGcEditorModal();
      if (typeof window.gcEditorRefresh === 'function') {
        window.gcEditorRefresh(window.FRONT_PDF_URL || undefined, window.BACK_PDF_URL || undefined);
      }
    } else {
      window.location.href = '/print/generate-card/table/' + TABLE_ID + '/';
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
      if (e.target.classList.contains('generateListRowCheckbox')) updateSelectionUI();
    });
  }

  if (continueBtn) {
    continueBtn.addEventListener('click', function() {
      var ids = getSelectedPrIds();
      if (ids.length === 0) return;
      openGeneratorWithSelection(ids);
    });
  }

  if (viewBtn) {
    viewBtn.addEventListener('click', function() {
      var cardIds = getSelectedCardIds();
      if (cardIds.length !== 1) return;
      if (typeof fetchCardAndOpenModal === 'function') fetchCardAndOpenModal('view', cardIds[0]);
    });
  }

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
      html += '<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="generateListRowCheckbox"></td>';
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
   STEP 3: FINALIZED LIST (status = finalized)
   Actions: Move to Pool (bulk + single)
    */
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
