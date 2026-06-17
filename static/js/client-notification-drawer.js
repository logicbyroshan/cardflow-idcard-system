(function () {
  'use strict';

  var overlay = document.getElementById('clientNotificationDrawerOverlay');
  var drawer = document.getElementById('clientNotificationDrawer');
  if (!overlay || !drawer) return;

  var closeBtn = document.getElementById('clientNotificationDrawerClose');
  var threadEl = document.getElementById('clientNotificationThread');
  var unreadPill = document.getElementById('clientNotificationUnreadPill');
  var markAllBtn = document.getElementById('clientNotificationMarkAllReadBtn');
  var notificationsApi = drawer.getAttribute('data-notifications-api') || '/panel/api/notifications/list/';
  var markAllReadApi = drawer.getAttribute('data-mark-all-read-api') || '/panel/api/notifications/mark-all-read/';

  var state = {
    items: [],
    totalCount: 0,
    unreadCount: 0,
    isOpen: false,
    loading: false,
    pollTimer: null,
  };

  function escHtml(value) {
    var text = String(value == null ? '' : value);
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateTime(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getCsrfToken() {
    if (typeof window.getCSRFToken === 'function') {
      return window.getCSRFToken();
    }
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.getAttribute('content')) return meta.getAttribute('content');
    var cookie = document.cookie.split(';').find(function (item) {
      return item.trim().indexOf('csrftoken=') === 0;
    });
    return cookie ? cookie.split('=')[1] : '';
  }

  function getUnreadIds() {
    return state.items
      .filter(function (item) { return !item.is_read && item.id; })
      .map(function (item) { return item.id; });
  }

  function updateUnreadBadges() {
    var count = Number(state.unreadCount || 0);
    var label = count > 99 ? '99+' : String(count);
    var badgeEls = document.querySelectorAll('[data-client-notif-count]');

    badgeEls.forEach(function (el) {
      if (count > 0) {
        el.textContent = label;
        el.style.display = 'inline-flex';
      } else {
        el.textContent = '0';
        el.style.display = 'none';
      }
    });

    var wrapperEls = document.querySelectorAll('.client-notification-top-shortcut, [data-client-notification-open]');
    wrapperEls.forEach(function (el) {
      el.classList.toggle('has-unread', count > 0);
    });

    if (unreadPill) {
      unreadPill.textContent = count + ' unread';
      unreadPill.classList.toggle('has-unread', count > 0);
    }

    if (markAllBtn) {
      markAllBtn.disabled = count === 0;
    }
  }

  function renderThread() {
    if (!threadEl) return;

    if (!state.items.length) {
      threadEl.innerHTML = '<div class="client-message-thread-state"><i class="fa-solid fa-bell-slash"></i> No notifications found.</div>';
      return;
    }

    threadEl.innerHTML = state.items.map(function (item) {
      var unreadClass = item.is_read ? '' : ' unread';
      var category = String(item.category || 'general').toLowerCase();
      var categoryLabel = escHtml(item.category_display || item.category || 'general');
      
      var categoryBadge = '<span class="client-notification-category-badge ' + escHtml(category) + '">' + categoryLabel + '</span>';
      var readAction = item.is_read
        ? '<span class="client-notification-read-state">Read</span>'
        : '<button type="button" class="client-notification-read-btn" data-client-notif-read-btn="' + escHtml(item.id) + '">Mark read</button>';

      return '' +
        '<article class="client-notification-row' + unreadClass + '">' +
          '<div class="client-notification-bubble">' +
            '<div class="client-notification-bubble-head">' +
              '<span class="client-notification-title"><i class="fa-solid ' + escHtml(item.icon_class || 'fa-circle-info') + '"></i> ' + escHtml(item.title || 'Notification') + '</span>' +
              '<span class="client-notification-time">' + escHtml(formatDateTime(item.created_at)) + '</span>' +
            '</div>' +
            '<div class="client-notification-text">' + escHtml(item.message || '') + '</div>' +
            '<div class="client-notification-meta">' +
              categoryBadge +
              readAction +
            '</div>' +
          '</div>' +
        '</article>';
    }).join('');
  }

  function setLoadingState() {
    if (!threadEl) return;
    threadEl.innerHTML = '<div class="client-message-thread-state">Loading notifications...</div>';
  }

  function bindOpenTriggers() {
    var triggers = document.querySelectorAll('[data-client-notification-open]');
    triggers.forEach(function (el) {
      if (el.dataset.clientNotificationBound === '1') return;
      el.dataset.clientNotificationBound = '1';

      el.addEventListener('click', function (event) {
        event.preventDefault();
        openDrawer();
      });
    });
  }

  function setDrawerOpen(open) {
    state.isOpen = !!open;
    overlay.classList.toggle('active', !!open);
    drawer.classList.toggle('open', !!open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function openDrawer() {
    setDrawerOpen(true);
    loadNotifications(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  function updateFromPayload(payload) {
    state.items = Array.isArray(payload.notifications) ? payload.notifications : [];
    state.totalCount = Number(payload.total || 0);
    state.unreadCount = Number(payload.unread_count || 0);
    renderThread();
    updateUnreadBadges();
  }

  async function loadNotifications(forceLoading) {
    if (state.loading) return;
    state.loading = true;
    if (forceLoading) setLoadingState();

    try {
      var response = await fetch(notificationsApi + '?limit=40', { credentials: 'same-origin' });
      if (!response.ok) {
        throw new Error('Failed to fetch notifications.');
      }

      var data = await response.json();
      if (!data || !data.success) {
        throw new Error((data && data.message) || 'Failed to load notifications.');
      }

      updateFromPayload(data);
    } catch (error) {
      if (threadEl) {
        threadEl.innerHTML = '<div class="client-message-thread-state">' + escHtml(error && error.message ? error.message : 'Unable to load notifications.') + '</div>';
      }
    } finally {
      state.loading = false;
    }
  }

  async function markAsRead(notificationId) {
    if (!notificationId) return;

    var response = await fetch('/api/notifications/' + notificationId + '/read/', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-CSRFToken': getCsrfToken(),
      },
    });

    if (!response.ok) {
      throw new Error('Unable to mark this notification as read.');
    }

    var wasUnread = false;
    state.items = state.items.map(function (item) {
      if (String(item.id) === String(notificationId)) {
        wasUnread = !item.is_read;
        item.is_read = true;
      }
      return item;
    });

    if (wasUnread) {
      state.unreadCount = Math.max(0, Number(state.unreadCount || 0) - 1);
    }

    renderThread();
    updateUnreadBadges();
  }

  async function markAllVisibleRead() {
    var unreadIds = getUnreadIds();
    if (!unreadIds.length) return;

    markAllBtn.disabled = true;
    try {
      var response = await fetch(markAllReadApi, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'X-CSRFToken': getCsrfToken(),
        },
      });
      if (!response.ok) {
        throw new Error('Failed to mark all as read.');
      }
      var data = await response.json();
      if (!data || !data.success) {
        throw new Error((data && data.message) || 'Failed to mark all as read.');
      }

      state.items = state.items.map(function (item) {
        item.is_read = true;
        return item;
      });
      state.unreadCount = 0;

      if (typeof window.showToast === 'function') {
        window.showToast('All notifications marked as read.', 'success');
      }
    } catch (_error) {
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to mark all notifications as read.', 'error');
      }
    } finally {
      renderThread();
      updateUnreadBadges();
    }
  }

  document.addEventListener('click', function (event) {
    var readBtn = event.target.closest('[data-client-notif-read-btn]');
    if (readBtn) {
      var notificationId = readBtn.getAttribute('data-client-notif-read-btn');
      markAsRead(notificationId).catch(function () {
        if (typeof window.showToast === 'function') {
          window.showToast('Failed to mark notification as read.', 'error');
        }
      });
      return;
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', closeDrawer);
  }
  overlay.addEventListener('click', closeDrawer);

  if (markAllBtn) {
    markAllBtn.addEventListener('click', function () {
      markAllVisibleRead();
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.isOpen) {
      closeDrawer();
    }
  });

  bindOpenTriggers();
  loadNotifications(false);
  state.pollTimer = setInterval(function () {
    loadNotifications(false);
  }, 45000);

  window.clientNotificationDrawer = {
    open: openDrawer,
    close: closeDrawer,
    refresh: function () { loadNotifications(true); },
  };
})();
