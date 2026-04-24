/**
 * Notification Bell  Client-side JS
 * Handles: polling unread count, loading dropdown, mark read, mark all read
 * Include on any page that has the notification-bell.html partial.
 */

(function() {
  'use strict';

  let notifDropdownOpen = false;
  let notifData = [];
  const POLL_INTERVAL = 60000; // 60 seconds

  let notifPollTimer = null;

  /*  Init  */
  document.addEventListener('DOMContentLoaded', function() {
    // Skip polling entirely when the bell partial is not rendered (e.g. admin users)
    if (!document.getElementById('notifWrapper')) return;

    pollUnreadCount();
    startNotifPolling();

    // Pause polling when tab is hidden, resume on visible
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        stopNotifPolling();
      } else {
        pollUnreadCount();
        startNotifPolling();
      }
    });

    // Close dropdown on outside click
    document.addEventListener('click', function(e) {
      const wrapper = document.getElementById('notifWrapper');
      if (wrapper && !wrapper.contains(e.target) && notifDropdownOpen) {
        closeNotifDropdown();
      }
    });

    // Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && notifDropdownOpen) closeNotifDropdown();
    });
  });

  function startNotifPolling() {
    if (notifPollTimer) return;
    notifPollTimer = setInterval(pollUnreadCount, POLL_INTERVAL);
  }

  function stopNotifPolling() {
    if (notifPollTimer) {
      clearInterval(notifPollTimer);
      notifPollTimer = null;
    }
  }

  /*  Toggle  */
  window.toggleNotifDropdown = function() {
    if (notifDropdownOpen) {
      closeNotifDropdown();
    } else {
      openNotifDropdown();
    }
  };

  function openNotifDropdown() {
    const dd = document.getElementById('notifDropdown');
    if (dd) {
      dd.classList.add('open');
      notifDropdownOpen = true;
      loadNotifications();
    }
  }

  function closeNotifDropdown() {
    const dd = document.getElementById('notifDropdown');
    if (dd) {
      dd.classList.remove('open');
      notifDropdownOpen = false;
    }
  }

  /*  Poll Unread Count  */
  async function pollUnreadCount() {
    try {
      const res = await fetch('/api/notifications/unread-count/');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        updateBadge(data.unread_count);
      }
    } catch (err) {
      // Silently fail  non-critical
    }
  }

  function updateBadge(count) {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (count > 0) {
      badge.classList.add('has-updates');
      badge.title = count + ' unread';
    } else {
      badge.classList.remove('has-updates');
      badge.title = '';
    }
  }

  /*  Load Notifications  */
  async function loadNotifications() {
    const list = document.getElementById('notifList');
    if (!list) return;

    try {
      const res = await fetch('/api/notifications/list/?limit=15');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success) return;

      notifData = data.notifications;
      updateBadge(data.unread_count);

      if (!notifData.length) {
        list.innerHTML = `<div class="notif-empty">
          <i class="fa-solid fa-bell-slash"></i>
          No notifications yet
        </div>`;
        return;
      }

      list.innerHTML = notifData.map(n => {
        const unreadClass = n.is_read ? '' : ' unread';
        const unreadDot = n.is_read ? '' : '<span class="notif-unread-dot"></span>';
        return `<div class="notif-item${unreadClass}" onclick="openNotificationFromBell(${n.id}, this)" onkeydown="handleBellNotificationKeydown(event, ${n.id}, this)" tabindex="0" role="button" aria-label="Open notification">
          <div class="notif-icon" style="background:${hexToRgba(n.priority_color, 0.12)};color:${n.priority_color};">
            <i class="fa-solid ${n.icon_class}"></i>
          </div>
          <div class="notif-body">
            <div class="notif-title">${escHtmlBell(n.title)}</div>
            <div class="notif-text">${escHtmlBell(n.message.length > 80 ? n.message.substring(0, 80) + '...' : n.message)}</div>
            <div class="notif-time">${n.time_ago} ago</div>
          </div>
          ${unreadDot}
        </div>`;
      }).join('');

    } catch (err) {
      console.error('Failed to load notifications:', err);
    }
  }

  /*  Mark Read  */
  async function markNotificationReadRequest(id) {
    return fetch(`/api/notifications/${id}/read/`, {
      method: 'POST',
      headers: { 'X-CSRFToken': getCsrfTokenBell() },
    });
  }

  window.markNotificationRead = async function(id, el) {
    try {
      await markNotificationReadRequest(id);
      if (el) {
        el.classList.remove('unread');
        const dot = el.querySelector('.notif-unread-dot');
        if (dot) dot.remove();
      }
      pollUnreadCount();
    } catch (err) {
      // Non-critical
    }
  };

  window.openNotificationFromBell = async function(id, el) {
    try {
      await markNotificationRead(id, el);
    } finally {
      window.location.href = buildNotificationTargetUrl(id);
    }
  };

  window.handleBellNotificationKeydown = function(event, id, el) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openNotificationFromBell(id, el);
  };

  /*  Mark All Read  */
  window.markAllNotificationsRead = async function() {
    try {
      await fetch('/api/notifications/mark-all-read/', {
        method: 'POST',
        headers: { 'X-CSRFToken': getCsrfTokenBell() },
      });
      // Refresh
      pollUnreadCount();
      loadNotifications();
    } catch (err) {
      console.error('Mark all read failed:', err);
    }
  };

  /*  Helpers  */
  // Use canonical getCSRFToken from core/api.js (exposed as window.getCSRFToken)
  function getCsrfTokenBell() {
    return (typeof window.getCSRFToken === 'function') ? window.getCSRFToken() : '';
  }

  function escHtmlBell(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function hexToRgba(hex, alpha) {
    if (!hex || hex.charAt(0) !== '#') return 'rgba(102,126,234,' + alpha + ')';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function getNotificationsPageUrl() {
    const wrapper = document.getElementById('notifWrapper');
    return (wrapper && wrapper.dataset.notificationsUrl) || '/notifications/';
  }

  function buildNotificationTargetUrl(notificationId) {
    const baseUrl = getNotificationsPageUrl();
    try {
      const targetUrl = new URL(baseUrl, window.location.origin);
      targetUrl.searchParams.set('highlight', String(notificationId));
      return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
    } catch (_err) {
      const separator = baseUrl.indexOf('?') === -1 ? '?' : '&';
      return `${baseUrl}${separator}highlight=${encodeURIComponent(String(notificationId))}`;
    }
  }

})();
