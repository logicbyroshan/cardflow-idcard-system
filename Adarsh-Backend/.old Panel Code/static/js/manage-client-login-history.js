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

  function clientHistoryApiUrl(clientId) {
    return panelBasePath() + '/api/client/' + encodeURIComponent(String(clientId)) + '/login-history/?limit=80';
  }

  function ensureClientHistoryDrawer() {
    if (document.getElementById('clientHistoryDrawer')) return;

    var overlay = document.createElement('div');
    overlay.id = 'clientHistoryOverlay';
    overlay.className = 'drawer-overlay card-history-overlay';

    var drawer = document.createElement('aside');
    drawer.id = 'clientHistoryDrawer';
    drawer.className = 'side-drawer card-history-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = '' +
      '<div class="drawer-header card-history-header">' +
        '<div class="card-history-header-main">' +
          '<span class="card-history-client-logo" id="clientHistoryLogo" aria-hidden="true"><i class="fa-solid fa-building"></i></span>' +
          '<div>' +
            '<div class="card-history-title">Client Login History</div>' +
            '<div class="card-history-subtitle" id="clientHistorySubtitle">Login, logout, and devices</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="drawer-close card-history-close" id="clientHistoryClose" aria-label="Close history">' +
          '<i class="fa-solid fa-xmark"></i>' +
        '</button>' +
      '</div>' +
      '<div class="drawer-body card-history-body" id="clientHistoryBody">' +
        '<div class="card-history-empty">Select a client to view login history.</div>' +
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

    var closeBtn = document.getElementById('clientHistoryClose');
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', function(evt) {
      if (evt.key === 'Escape') closeDrawer();
    });
  }

  function openClientHistoryDrawer() {
    ensureClientHistoryDrawer();

    var overlay = document.getElementById('clientHistoryOverlay');
    var drawer = document.getElementById('clientHistoryDrawer');
    if (!overlay || !drawer) return;

    overlay.classList.add('active');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function renderClientHistoryHeaderLogo(logoUrl, clientName) {
    var logoEl = document.getElementById('clientHistoryLogo');
    if (!logoEl) return;

    if (logoUrl) {
      logoEl.innerHTML = '<img src="' + escapeHtml(logoUrl) + '" alt="' + escapeHtml(clientName || 'Client') + ' logo" loading="lazy">';
    } else {
      logoEl.innerHTML = '<i class="fa-solid fa-building"></i>';
    }
  }

  function renderClientHistoryLoading(clientName, logoUrl) {
    var subtitle = document.getElementById('clientHistorySubtitle');
    var body = document.getElementById('clientHistoryBody');

    renderClientHistoryHeaderLogo(logoUrl, clientName);
    if (subtitle) subtitle.textContent = clientName ? 'Client: ' + clientName : 'Loading';
    if (body) {
      body.innerHTML = '<div class="card-history-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading login history...</div>';
    }
  }

  function renderClientHistoryError(message) {
    var body = document.getElementById('clientHistoryBody');
    if (body) {
      body.innerHTML = '<div class="card-history-error">' + escapeHtml(message || 'Unable to load login history.') + '</div>';
    }
  }

  function resolveDeviceSurface(item) {
    var surface = String((item && item.device_surface) || '').trim().toLowerCase();
    if (!surface || surface === 'unknown') {
      var text = String((item && item.description) || '').toLowerCase();
      if (/(mobile app|android|iphone|ipad|ipod|\bmobile\b|\bios\b)/.test(text)) {
        surface = 'mobile';
      } else if (/(desktop|browser|windows|mac|linux|\bweb\b)/.test(text)) {
        surface = 'desktop';
      }
    }

    if (surface === 'mobile') {
      return { icon: 'fa-mobile-screen-button', label: 'Mobile' };
    }
    if (surface === 'desktop') {
      return { icon: 'fa-desktop', label: 'Desktop' };
    }

    var fallbackLabel = String((item && item.device_surface_label) || '').trim() || 'Unknown';
    var fallbackIcon = String((item && item.device_surface_icon) || '').trim() || 'fa-circle-question';
    return { icon: fallbackIcon, label: fallbackLabel };
  }

  function renderActiveDeviceChips(payload, chipClass) {
    var surfaceCounts = payload && payload.active_surface_counts ? payload.active_surface_counts : {};
    var activeDesktop = Number(surfaceCounts.desktop || 0);
    var activeMobile = Number(surfaceCounts.mobile || 0);
    var rows = [];

    if (activeDesktop > 0) {
      rows.push('<span class="' + chipClass + ' ' + chipClass + '--meta"><i class="fa-solid fa-desktop"></i> Desktop active</span>');
    }
    if (activeMobile > 0) {
      rows.push('<span class="' + chipClass + ' ' + chipClass + '--meta"><i class="fa-solid fa-mobile-screen-button"></i> Mobile active</span>');
    }

    if (!rows.length) {
      rows.push('<span class="' + chipClass + ' ' + chipClass + '--meta"><i class="fa-solid fa-circle-info"></i> No active sessions</span>');
    }

    var devices = Array.isArray(payload.active_devices_info) ? payload.active_devices_info : [];
    devices.slice(0, 6).forEach(function(device) {
      var label = escapeHtml((device && device.device_label) || 'Unknown device');
      var ip = escapeHtml((device && device.ip_address) || '');
      var surface = String((device && device.surface) || '').toLowerCase();
      var icon = surface === 'mobile' ? 'fa-mobile-screen-button' : 'fa-desktop';
      var text = label + (ip ? ' [' + ip + ']' : '');
      rows.push('<span class="' + chipClass + ' ' + chipClass + '--meta"><i class="fa-solid ' + icon + '"></i> ' + text + '</span>');
    });

    return rows.join('');
  }

  function renderClientHistory(clientName, payload, logoUrl) {
    var subtitle = document.getElementById('clientHistorySubtitle');
    var body = document.getElementById('clientHistoryBody');
    if (!body) return;

    renderClientHistoryHeaderLogo(logoUrl, clientName);

    var activeDevices = Number(payload.active_devices || 0);
    var surfaceCounts = payload && payload.active_surface_counts ? payload.active_surface_counts : {};
    var activeDesktop = Number(surfaceCounts.desktop || 0);
    var activeMobile = Number(surfaceCounts.mobile || 0);
    if (subtitle) {
      var activeSurfaces = [];
      if (activeDesktop > 0) activeSurfaces.push('Desktop');
      if (activeMobile > 0) activeSurfaces.push('Mobile');
      subtitle.textContent = activeSurfaces.length
        ? (clientName || 'Client') + ' - Active on ' + activeSurfaces.join(', ')
        : (clientName || 'Client') + ' - No active sessions';
    }

    var events = Array.isArray(payload.events) ? payload.events : [];
    if (!events.length) {
      body.innerHTML = '<div class="card-history-empty">No login history available for this client yet.</div>';
      return;
    }

    var activeSummaryHtml = '' +
      '<div class="card-history-item">' +
        '<div class="card-history-what">Currently active sessions</div>' +
        '<div class="client-history-chip-row">' + renderActiveDeviceChips(payload, 'client-history-chip') + '</div>' +
      '</div>';

    var fps = Array.isArray(payload.device_fingerprints) ? payload.device_fingerprints : [];

    var html = events.map(function(item) {
      var actionLabel = escapeHtml(item.action_display || item.action || 'Event');
      var description = escapeHtml(item.description || '');
      var ip = escapeHtml(item.ip_address || '-');
      var when = escapeHtml(item.created_at || '');
      var ago = escapeHtml(item.time_ago || '');
      var icon = escapeHtml(item.icon_class || 'fa-circle-info');
      var surfaceMeta = resolveDeviceSurface(item);
      var deviceChip = '<span class="client-history-chip client-history-chip--meta"><i class="fa-solid ' + escapeHtml(surfaceMeta.icon) + '"></i> ' + escapeHtml(surfaceMeta.label) + '</span>';

      var fpChips = '';
      if (fps.length) {
        fpChips = fps.slice(0, 3).map(function(fp) {
          var safeFp = String(fp || '');
          var shortFp = safeFp.length > 14 ? safeFp.slice(0, 14) + '...' : safeFp;
          return '<span class="client-history-chip client-history-chip--meta"><i class="fa-solid fa-laptop"></i> ' + escapeHtml(shortFp) + '</span>';
        }).join('');
      }

      return '' +
        '<div class="card-history-item">' +
          '<div class="card-history-when">' + when + '</div>' +
          '<div class="card-history-what">' + (description || actionLabel) + '</div>' +
          '<div class="card-history-meta">' + ago + '</div>' +
          '<div class="client-history-chip-row">' +
            '<span class="client-history-chip client-history-chip--action"><i class="fa-solid ' + icon + '"></i> ' + actionLabel + '</span>' +
            deviceChip +
            '<span class="client-history-chip client-history-chip--meta"><i class="fa-solid fa-network-wired"></i> ' + ip + '</span>' +
            (activeDesktop > 0 ? '<span class="client-history-chip client-history-chip--meta"><i class="fa-solid fa-desktop"></i> Desktop active</span>' : '') +
            (activeMobile > 0 ? '<span class="client-history-chip client-history-chip--meta"><i class="fa-solid fa-mobile-screen-button"></i> Mobile active</span>' : '') +
            fpChips +
          '</div>' +
        '</div>';
    }).join('');

    body.innerHTML = '<div class="card-history-list">' + activeSummaryHtml + html + '</div>';
  }

  function openClientHistory(clientId, clientName, logoUrl) {
    if (!clientId) return;

    openClientHistoryDrawer();
    renderClientHistoryLoading(clientName || 'Client', logoUrl || '');

    fetch(clientHistoryApiUrl(clientId), {
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
        renderClientHistory(clientName || (data.client && data.client.name) || 'Client', data, logoUrl || '');
      })
      .catch(function(err) {
        renderClientHistoryError(err && err.message ? err.message : 'Failed to load login history.');
        if (typeof window.showToast === 'function') {
          window.showToast('Unable to load client login history', 'error');
        }
      });
  }

  function bindHistoryButtons() {
    var tableContainer = document.getElementById('client-table-container');
    if (!tableContainer || tableContainer.dataset.historyBound === '1') return;

    tableContainer.addEventListener('click', function(e) {
      var btn = e.target.closest('.client-history-trigger');
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      var row = btn.closest('tr[data-client-id]');
      if (row && window.ManageClientPage && typeof window.ManageClientPage.selectRow === 'function') {
        window.ManageClientPage.selectRow(row);
      }

      var clientLogo = row && row.dataset ? row.dataset.clientLogo || '' : '';
      openClientHistory(btn.dataset.clientId, btn.dataset.clientName, clientLogo);
    });

    tableContainer.dataset.historyBound = '1';
  }

  function init() {
    ensureClientHistoryDrawer();
    bindHistoryButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
