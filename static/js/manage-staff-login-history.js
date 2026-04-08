(function() {
  'use strict';

  function escapeHtml(value) {
    var text = String(value == null ? '' : value);
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function panelBasePath() {
    return window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';
  }

  function staffHistoryApiUrl(staffId) {
    return panelBasePath() + '/api/staff/' + encodeURIComponent(String(staffId)) + '/login-history/?limit=80';
  }

  function ensureStaffHistoryDrawer() {
    if (document.getElementById('staffHistoryDrawer')) return;

    var overlay = document.createElement('div');
    overlay.id = 'staffHistoryOverlay';
    overlay.className = 'drawer-overlay card-history-overlay';

    var drawer = document.createElement('aside');
    drawer.id = 'staffHistoryDrawer';
    drawer.className = 'side-drawer card-history-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = '' +
      '<div class="drawer-header card-history-header">' +
        '<div>' +
          '<div class="card-history-title">Operator Login History</div>' +
          '<div class="card-history-subtitle" id="staffHistorySubtitle">Login, logout, and devices</div>' +
        '</div>' +
        '<button type="button" class="drawer-close card-history-close" id="staffHistoryClose" aria-label="Close history">' +
          '<i class="fa-solid fa-xmark"></i>' +
        '</button>' +
      '</div>' +
      '<div class="drawer-body card-history-body" id="staffHistoryBody">' +
        '<div class="card-history-empty">Select an operator to view login history.</div>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    function closeDrawer() {
      overlay.classList.remove('active');
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    overlay.addEventListener('click', closeDrawer);

    var closeBtn = document.getElementById('staffHistoryClose');
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', function(evt) {
      if (evt.key === 'Escape') closeDrawer();
    });
  }

  function openStaffHistoryDrawer() {
    ensureStaffHistoryDrawer();

    var overlay = document.getElementById('staffHistoryOverlay');
    var drawer = document.getElementById('staffHistoryDrawer');
    if (!overlay || !drawer) return;

    overlay.classList.add('active');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function renderStaffHistoryLoading(staffName) {
    var subtitle = document.getElementById('staffHistorySubtitle');
    var body = document.getElementById('staffHistoryBody');

    if (subtitle) subtitle.textContent = staffName ? 'Operator: ' + staffName : 'Loading';
    if (body) {
      body.innerHTML = '<div class="card-history-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading login history...</div>';
    }
  }

  function renderStaffHistoryError(message) {
    var body = document.getElementById('staffHistoryBody');
    if (body) {
      body.innerHTML = '<div class="card-history-error">' + escapeHtml(message || 'Unable to load login history.') + '</div>';
    }
  }

  function renderStaffHistory(staffName, payload) {
    var subtitle = document.getElementById('staffHistorySubtitle');
    var body = document.getElementById('staffHistoryBody');
    if (!body) return;

    var activeDevices = Number(payload.active_devices || 0);
    if (subtitle) subtitle.textContent = (staffName || 'Operator') + ' - Active devices: ' + activeDevices;

    var events = Array.isArray(payload.events) ? payload.events : [];
    if (!events.length) {
      body.innerHTML = '<div class="card-history-empty">No login history available for this operator yet.</div>';
      return;
    }

    var fps = Array.isArray(payload.device_fingerprints) ? payload.device_fingerprints : [];

    var html = events.map(function(item) {
      var actionLabel = escapeHtml(item.action_display || item.action || 'Event');
      var description = escapeHtml(item.description || '');
      var ip = escapeHtml(item.ip_address || '-');
      var when = escapeHtml(item.created_at || '');
      var ago = escapeHtml(item.time_ago || '');
      var icon = escapeHtml(item.icon_class || 'fa-circle-info');

      var fpChips = '';
      if (fps.length) {
        fpChips = fps.slice(0, 3).map(function(fp) {
          var safeFp = String(fp || '');
          var shortFp = safeFp.length > 14 ? safeFp.slice(0, 14) + '...' : safeFp;
          return '<span class="operator-history-chip operator-history-chip--meta"><i class="fa-solid fa-laptop"></i> ' + escapeHtml(shortFp) + '</span>';
        }).join('');
      }

      return '' +
        '<div class="card-history-item">' +
          '<div class="card-history-when">' + when + '</div>' +
          '<div class="card-history-what">' + (description || actionLabel) + '</div>' +
          '<div class="card-history-meta">' + ago + '</div>' +
          '<div class="operator-history-chip-row">' +
            '<span class="operator-history-chip operator-history-chip--action"><i class="fa-solid ' + icon + '"></i> ' + actionLabel + '</span>' +
            '<span class="operator-history-chip operator-history-chip--meta"><i class="fa-solid fa-network-wired"></i> ' + ip + '</span>' +
            '<span class="operator-history-chip operator-history-chip--meta"><i class="fa-solid fa-mobile-screen-button"></i> Active: ' + activeDevices + '</span>' +
            fpChips +
          '</div>' +
        '</div>';
    }).join('');

    body.innerHTML = '<div class="card-history-list">' + html + '</div>';
  }

  function openStaffHistory(staffId, staffName) {
    if (!staffId) return;

    openStaffHistoryDrawer();
    renderStaffHistoryLoading(staffName || 'Operator');

    fetch(staffHistoryApiUrl(staffId), {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    })
      .then(function(resp) {
        return resp.json().then(function(data) {
          if (!resp.ok || !data || !data.success) {
            var message = data && data.message ? data.message : 'Failed to load login history.';
            throw new Error(message);
          }
          return data;
        });
      })
      .then(function(data) {
        var resolvedName = staffName || (data.staff && data.staff.name) || 'Operator';
        renderStaffHistory(resolvedName, data);
      })
      .catch(function(err) {
        renderStaffHistoryError(err && err.message ? err.message : 'Failed to load login history.');
        if (typeof window.showToast === 'function') {
          window.showToast('Unable to load operator login history', 'error');
        }
      });
  }

  function bindHistoryButtons() {
    var tableContainer = document.getElementById('staff-table-container');
    if (!tableContainer || tableContainer.dataset.operatorHistoryBound === '1') return;

    tableContainer.addEventListener('click', function(e) {
      var btn = e.target.closest('.operator-history-trigger');
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      var row = btn.closest('tr[data-staff-id]');
      if (row && window.ManageStaffPage && typeof window.ManageStaffPage.selectStaffRow === 'function') {
        window.ManageStaffPage.selectStaffRow(row);
      }

      openStaffHistory(btn.dataset.staffId, btn.dataset.staffName);
    });

    tableContainer.dataset.operatorHistoryBound = '1';
  }

  function init() {
    ensureStaffHistoryDrawer();
    bindHistoryButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
