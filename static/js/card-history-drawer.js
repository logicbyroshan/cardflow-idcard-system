(function() {
  'use strict';

  if (!document.querySelector('main.idcard-actions-page')) {
    return;
  }

  var showToast = window.showToast || function() {};

  // Client and assistent must not see the history info column.
  if (typeof IS_CLIENT_USER !== 'undefined' && IS_CLIENT_USER) {
    return;
  }

  function escapeHtml(value) {
    var text = String(value == null ? '' : value);
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function panelBasePath() {
    return window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';
  }

  function historyApiUrl(cardId) {
    return panelBasePath() + '/api/card/' + encodeURIComponent(String(cardId)) + '/history/';
  }

  function ensureDrawer() {
    if (document.getElementById('cardHistoryDrawer')) {
      return;
    }

    var overlay = document.createElement('div');
    overlay.id = 'cardHistoryOverlay';
    overlay.className = 'drawer-overlay card-history-overlay';

    var drawer = document.createElement('aside');
    drawer.id = 'cardHistoryDrawer';
    drawer.className = 'side-drawer card-history-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = '' +
      '<div class="drawer-header card-history-header">' +
        '<div>' +
          '<div class="card-history-title">Card History</div>' +
          '<div class="card-history-subtitle" id="cardHistorySubtitle">Who, what, when</div>' +
        '</div>' +
        '<button type="button" class="drawer-close card-history-close" id="cardHistoryClose" aria-label="Close history">' +
          '<i class="fa-solid fa-xmark"></i>' +
        '</button>' +
      '</div>' +
      '<div class="drawer-body card-history-body" id="cardHistoryBody">' +
        '<div class="card-history-empty">Select a card to view history.</div>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    overlay.addEventListener('click', closeDrawer);
    var closeBtn = document.getElementById('cardHistoryClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeDrawer);
    }

    document.addEventListener('keydown', function(evt) {
      if (evt.key === 'Escape') {
        closeDrawer();
      }
    });
  }

  function openDrawer() {
    ensureDrawer();
    var overlay = document.getElementById('cardHistoryOverlay');
    var drawer = document.getElementById('cardHistoryDrawer');
    if (!overlay || !drawer) return;

    overlay.classList.add('active');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    var overlay = document.getElementById('cardHistoryOverlay');
    var drawer = document.getElementById('cardHistoryDrawer');
    if (!overlay || !drawer) return;

    overlay.classList.remove('active');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function renderLoading(cardId) {
    ensureDrawer();
    var subtitle = document.getElementById('cardHistorySubtitle');
    var body = document.getElementById('cardHistoryBody');
    if (subtitle) subtitle.textContent = 'Card #' + cardId;
    if (body) {
      body.innerHTML = '<div class="card-history-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading history...</div>';
    }
  }

  function renderEvents(cardId, payload) {
    ensureDrawer();
    var subtitle = document.getElementById('cardHistorySubtitle');
    var body = document.getElementById('cardHistoryBody');
    if (!body) return;

    var statusText = payload && payload.card_status_display ? (' - ' + payload.card_status_display) : '';
    if (subtitle) subtitle.textContent = 'Card #' + cardId + statusText;

    var events = (payload && Array.isArray(payload.events)) ? payload.events : [];
    if (!events.length) {
      body.innerHTML = '<div class="card-history-empty">No history available yet.</div>';
      return;
    }

    var html = '<div class="card-history-list">';
    for (var i = 0; i < events.length; i++) {
      var item = events[i] || {};
      html += '' +
        '<div class="card-history-item">' +
          '<div class="card-history-when">' + escapeHtml(item.when || '') + '</div>' +
          '<div class="card-history-what">' + escapeHtml(item.what || item.action || '') + '</div>' +
          '<div class="card-history-meta">By: ' + escapeHtml(item.who || 'System') + '</div>' +
        '</div>';
    }
    html += '</div>';
    body.innerHTML = html;
  }

  function renderError(message) {
    ensureDrawer();
    var body = document.getElementById('cardHistoryBody');
    if (body) {
      body.innerHTML = '<div class="card-history-error">' + escapeHtml(message || 'Unable to load history.') + '</div>';
    }
  }

  function fetchAndOpenHistory(cardId) {
    if (!cardId) return;

    openDrawer();
    renderLoading(cardId);

    fetch(historyApiUrl(cardId), {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    })
      .then(function(resp) {
        if (!resp.ok) {
          return resp.json().then(function(data) {
            var msg = (data && data.message) ? data.message : 'Failed to load history.';
            throw new Error(msg);
          }).catch(function() {
            throw new Error('Failed to load history.');
          });
        }
        return resp.json();
      })
      .then(function(data) {
        if (!data || !data.success) {
          throw new Error((data && data.message) ? data.message : 'Failed to load history.');
        }
        renderEvents(cardId, data);
      })
      .catch(function(err) {
        renderError(err && err.message ? err.message : 'Failed to load history.');
        showToast('Unable to load card history.', 'error');
      });
  }

  function ensureHistoryColumnForTable(table) {
    if (!table) return;

    var headRow = table.querySelector('thead tr');
    if (!headRow) return;

    var existingHead = headRow.querySelector('th.card-history-col-head');
    if (!existingHead) {
      var th = document.createElement('th');
      th.className = 'card-history-col-head';
      th.setAttribute('title', 'Card history');
      th.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
      headRow.appendChild(th);
    }

    var rows = table.querySelectorAll('tbody tr[data-card-id]');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var cardId = row.getAttribute('data-card-id');
      if (!cardId) continue;
      if (row.querySelector('td.card-history-col-cell')) continue;

      var td = document.createElement('td');
      td.className = 'card-history-col-cell';
      td.innerHTML = '' +
        '<button type="button" class="card-history-trigger" data-card-id="' + escapeHtml(cardId) + '" title="View card history" aria-label="View card history">' +
          '<i class="fa-solid fa-circle-info"></i>' +
        '</button>';
      row.appendChild(td);
    }
  }

  function syncAllTables() {
    var tables = document.querySelectorAll('main.idcard-actions-page .table-container.idcard-table table');
    for (var i = 0; i < tables.length; i++) {
      ensureHistoryColumnForTable(tables[i]);
    }
  }

  var syncTimer = null;
  function scheduleSync() {
    if (syncTimer) {
      window.clearTimeout(syncTimer);
    }
    syncTimer = window.setTimeout(function() {
      syncAllTables();
    }, 60);
  }

  document.addEventListener('click', function(evt) {
    var btn = evt.target.closest('.card-history-trigger');
    if (!btn) return;
    evt.preventDefault();
    evt.stopPropagation();
    fetchAndOpenHistory(btn.getAttribute('data-card-id'));
  });

  var observer = new MutationObserver(function() {
    scheduleSync();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  ensureDrawer();
  syncAllTables();
})();
