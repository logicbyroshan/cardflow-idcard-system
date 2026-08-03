(function () {
  'use strict';

  var overlay = document.getElementById('clientMessageDrawerOverlay');
  var drawer = document.getElementById('clientMessageDrawer');
  if (!overlay || !drawer) return;

  var closeBtn = document.getElementById('clientMessageDrawerClose');
  var threadEl = document.getElementById('clientMessageThread');
  var unreadPill = document.getElementById('clientMessageUnreadPill');
  var markAllBtn = document.getElementById('clientMessageMarkAllReadBtn');
  var messagesApi = drawer.getAttribute('data-messages-api') || '/panel/client/api/messages/drawer/';
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
      .filter(function (item) { return !item.is_read && item.notification_id; })
      .map(function (item) { return item.notification_id; });
  }

  function updateUnreadBadges() {
    var count = Number(state.unreadCount || 0);
    var label = count > 99 ? '99+' : String(count);
    var badgeEls = document.querySelectorAll('[data-client-msg-count]');

    badgeEls.forEach(function (el) {
      if (count > 0) {
        el.textContent = label;
        el.style.display = 'inline-flex';
      } else {
        el.textContent = '0';
        el.style.display = 'none';
      }
    });

    var wrapperEls = document.querySelectorAll('.client-message-nav-link, [data-client-message-open], .quick-action-message');
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
      threadEl.innerHTML = '<div class="client-message-thread-state"><i class="fa-solid fa-inbox"></i> No messages found.</div>';
      return;
    }

    threadEl.innerHTML = state.items.map(function (item) {
      var unreadClass = item.is_read ? '' : ' unread';
      var expiresText = (item.visibility === 'temporary' && item.expires_at)
        ? '<span class="client-message-meta-info">Visible until ' + escHtml(formatDateTime(item.expires_at)) + '</span>'
        : '';
      var readAction = item.is_read
        ? '<span class="client-message-read-state">Seen</span>'
        : '<button type="button" class="client-message-read-btn" data-client-msg-read-btn="' + escHtml(item.notification_id) + '">Mark read</button>';

      return '' +
        '<article class="client-message-row' + unreadClass + '">' +
          '<div class="client-message-bubble">' +
            '<div class="client-message-bubble-head">' +
              '<span class="client-message-sender"><i class="fa-solid fa-user-shield"></i> ' + escHtml(item.sent_by_name || 'Admin') + '</span>' +
              '<span class="client-message-time">' + escHtml(formatDateTime(item.created_at)) + '</span>' +
            '</div>' +
            '<div class="client-message-text">' + escHtml(item.message || '') + '</div>' +
            '<div class="client-message-meta">' +
              expiresText +
              readAction +
            '</div>' +
          '</div>' +
        '</article>';
    }).join('');
  }

  function setLoadingState() {
    if (!threadEl) return;
    threadEl.innerHTML = '<div class="client-message-thread-state">Loading messages...</div>';
  }

  function bindOpenTriggers() {
    var triggers = document.querySelectorAll('[data-client-message-open]');
    triggers.forEach(function (el) {
      if (el.dataset.clientMessageBound === '1') return;
      el.dataset.clientMessageBound = '1';

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
    loadMessages(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  function updateFromPayload(payload) {
    state.items = Array.isArray(payload.items) ? payload.items : [];
    state.totalCount = Number(payload.total_count || 0);
    state.unreadCount = Number(payload.unread_count || 0);
    renderThread();
    updateUnreadBadges();
  }

  async function loadMessages(forceLoading) {
    if (state.loading) return;
    state.loading = true;
    if (forceLoading) setLoadingState();

    try {
      var response = await fetch(messagesApi + '?limit=60', { credentials: 'same-origin' });
      if (!response.ok) {
        throw new Error('Failed to fetch messages.');
      }

      var data = await response.json();
      if (!data || !data.success) {
        throw new Error((data && data.message) || 'Failed to load messages.');
      }

      updateFromPayload(data);
    } catch (error) {
      if (threadEl) {
        threadEl.innerHTML = '<div class="client-message-thread-state">' + escHtml(error && error.message ? error.message : 'Unable to load messages.') + '</div>';
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
      throw new Error('Unable to mark this message as read.');
    }

    var wasUnread = false;
    state.items = state.items.map(function (item) {
      if (String(item.notification_id) === String(notificationId)) {
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
      await Promise.all(unreadIds.map(function (id) {
        return markAsRead(id);
      }));
      if (typeof window.showToast === 'function') {
        window.showToast('All message items marked as read.', 'success');
      }
    } catch (_error) {
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to mark all messages as read.', 'error');
      }
    } finally {
      updateUnreadBadges();
    }
  }

  document.addEventListener('click', function (event) {
    var readBtn = event.target.closest('[data-client-msg-read-btn]');
    if (readBtn) {
      var notificationId = readBtn.getAttribute('data-client-msg-read-btn');
      markAsRead(notificationId).catch(function () {
        if (typeof window.showToast === 'function') {
          window.showToast('Failed to mark message as read.', 'error');
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
  loadMessages(false);
  state.pollTimer = setInterval(function () {
    loadMessages(false);
  }, 45000);

  window.clientMessageDrawer = {
    open: openDrawer,
    close: closeDrawer,
    refresh: function () { loadMessages(true); },
  };
})();
