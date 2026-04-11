(function () {
  'use strict';

  function withEmbedParam(rawUrl) {
    try {
      var resolved = new URL(rawUrl, window.location.origin);
      resolved.searchParams.set('embed', 'drawer');
      return resolved.toString();
    } catch (_err) {
      return rawUrl;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var overlay = document.getElementById('dashboardQuickActionOverlay');
    var drawer = document.getElementById('dashboardQuickActionDrawer');
    var frame = document.getElementById('dashboardQuickActionFrame');
    var closeBtn = document.getElementById('dashboardQuickActionClose');
    var titleEl = document.getElementById('dashboardQuickActionTitle');

    if (!overlay || !drawer || !frame) return;

    var actionMeta = {
      'add-client': { title: 'Create Client', hideOuterChrome: true },
      'add-operator': { title: 'Create Operator', hideOuterChrome: true },
      'add-assistent': { title: 'Create Assistent', hideOuterChrome: true }
    };

    function setOuterDrawerChromeHidden(hidden) {
      drawer.classList.toggle('dashboard-quick-action-drawer--compact', !!hidden);
    }

    function closeQuickActionDrawer() {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
      setOuterDrawerChromeHidden(false);
      window.setTimeout(function () {
        if (!overlay.classList.contains('active')) {
          frame.src = 'about:blank';
        }
      }, 220);
    }

    function openQuickActionDrawer(url, meta) {
      var resolvedMeta = meta || {};
      if (titleEl) titleEl.textContent = resolvedMeta.title || 'Quick Action';
      setOuterDrawerChromeHidden(!!resolvedMeta.hideOuterChrome);
      frame.src = withEmbedParam(url);
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    document.querySelectorAll('[data-dashboard-quick-action]').forEach(function (node) {
      var actionKey = String(node.getAttribute('data-dashboard-quick-action') || '');
      if (!actionMeta[actionKey]) return;

      node.addEventListener('click', function (event) {
        var href = node.getAttribute('href');
        if (!href) return;
        event.preventDefault();
        openQuickActionDrawer(href, actionMeta[actionKey]);
      });
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', closeQuickActionDrawer);
    }

    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) {
        closeQuickActionDrawer();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && overlay.classList.contains('active')) {
        closeQuickActionDrawer();
      }
    });

    window.addEventListener('message', function (event) {
      if (event.origin !== window.location.origin) return;
      var payload = event.data || {};
      if (payload.type === 'adarsh-dashboard-embed-drawer-close') {
        closeQuickActionDrawer();
      }
    });
  });
})();
