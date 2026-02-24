/**
 * Reprint Cards - Table & Shared Utilities
 * Shared pagination factory, helpers, and Step 1 (Reprint Requests)
 * Split from reprint-cards.js
 */
(function() {
'use strict';

/* â”€â”€ Namespace â”€â”€ */
window.ReprintCardsPage = window.ReprintCardsPage || {};

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   SHARED PAGINATION FACTORY
   Creates a paginator for any reprint step (requests/confirm/download).
   Returns { paginate, reset, updateSelectionCount }.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
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

  // â”€â”€ Event listeners â”€â”€
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

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   SHARED HELPERS (used by all 3 step IIFEs)
   Delegates to core modules loaded before this file.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
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

/* â”€â”€ Expose shared utilities on namespace for other sub-files â”€â”€ */
window.ReprintCardsPage.createPaginator = createReprintPaginator;
window.ReprintCardsPage._getCSRFToken = _getCSRFToken;
window.ReprintCardsPage._showToast = _showToast;
window.ReprintCardsPage._escapeHtml = _escapeHtml;
window.ReprintCardsPage._isImageField = _isImageField;
window.ReprintCardsPage._updateTabCount = _updateTabCount;
window.ReprintCardsPage._refreshStepCounts = _refreshStepCounts;

})();
