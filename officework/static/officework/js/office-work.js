(function () {
  'use strict';

  var cfg = window.OfficeWorkConfig || {};
  var endpoints = cfg.endpoints || {};

  function normalizeEndpointUrl(rawUrl) {
    var url = String(rawUrl || '').trim();
    if (!url) {
      return url;
    }
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
      return url;
    }
    if (window.location.pathname.indexOf('/panel/') === 0 && url.indexOf('/api/') === 0) {
      return '/panel' + url;
    }
    return url;
  }

  Object.keys(endpoints).forEach(function (key) {
    endpoints[key] = normalizeEndpointUrl(endpoints[key]);
  });

  var officeWorkBoot = {
    started: false,
    attempts: 0,
  };

  function startOfficeWorkApp() {
    if (officeWorkBoot.started) {
      return true;
    }
    if (!endpoints.chatList || !endpoints.chatGroupsList || !window.ApiClient) {
      return false;
    }
    officeWorkBoot.started = true;

  var state = {
    activeTab: 'chat',
    activeGroupId: 0,
    activeChatMemberId: 0,
    previousGroupId: 0,
    groups: [],
    availableMembers: [],
    canManageGroups: !!cfg.canManageGroups,
    chatLastId: 0,
    chatCount: 0,
    chatMessageIds: {},
    chatNotifiedMessageIds: {},
    pendingAttachment: null,
    subscribedGroupTopic: '',
    realtimeConnected: false,
    members: [],
    taskItems: [],
    taskDragId: 0,
    taskInlineCreateStatus: '',
    taskModalOpen: false,
    taskCurrentItem: null,
    taskCommentsByTaskId: {},
    pollTimer: null,
    chatLoaded: false,
    chatLoadInFlight: false,
    chatLoadPending: false,
    chatLoadPendingForceInitial: false,
    lastChatSyncAtMs: 0,
    chatPollConnectedMs: 12000,
    chatPollDisconnectedMs: 4000,
    desktopPermissionBootstrapDone: false,
  };

  var ui = {
    tabButtons: Array.prototype.slice.call(document.querySelectorAll('.office-tab-btn')),
    panels: Array.prototype.slice.call(document.querySelectorAll('.office-panel')),
    chatList: document.getElementById('officeChatList'),
    chatCountPill: document.getElementById('officeChatCountPill'),
    chatGroupSelect: document.getElementById('officeChatGroupSelect'),
    chatGroupSearch: document.getElementById('officeChatGroupSearch'),
    chatGroupsList: document.getElementById('officeChatGroupsList'),
    chatActiveAvatar: document.getElementById('officeChatActiveAvatar'),
    chatActiveGroupName: document.getElementById('officeChatActiveGroupName'),
    chatActiveGroupMeta: document.getElementById('officeChatActiveGroupMeta'),
    chatMembersStrip: document.getElementById('officeChatMembersStrip'),
    createGroupBtn: document.getElementById('officeCreateGroupBtn'),
    chatForm: document.getElementById('officeChatForm'),
    chatInput: document.getElementById('officeChatInput'),
    chatAttachBtn: document.getElementById('officeChatAttachBtn'),
    chatFileInput: document.getElementById('officeChatFileInput'),
    chatAttachmentPreview: document.getElementById('officeChatAttachmentPreview'),
    chatAttachmentName: document.getElementById('officeChatAttachmentName'),
    chatAttachmentRemove: document.getElementById('officeChatAttachmentRemove'),
    taskForm: document.getElementById('officeTaskForm'),
    taskTitle: document.getElementById('officeTaskTitle'),
    taskDescription: document.getElementById('officeTaskDescription'),
    taskStatus: document.getElementById('officeTaskStatus'),
    taskAssignee: document.getElementById('officeTaskAssignee'),
    taskCollaborators: document.getElementById('officeTaskCollaborators'),
    taskFollowers: document.getElementById('officeTaskFollowers'),
    taskPriority: document.getElementById('officeTaskPriority'),
    taskDueDate: document.getElementById('officeTaskDueDate'),
    taskCreatedBy: document.getElementById('officeTaskCreatedBy'),
    taskCompletionState: document.getElementById('officeTaskCompletionState'),
    taskChecklistItems: document.getElementById('officeTaskChecklistItems'),
    taskChecklistInput: document.getElementById('officeTaskChecklistInput'),
    taskChecklistAssignee: document.getElementById('officeTaskChecklistAssignee'),
    taskChecklistAddBtn: document.getElementById('officeTaskChecklistAddBtn'),
    taskApprovalBox: document.getElementById('officeTaskApprovalBox'),
    taskApprovalText: document.getElementById('officeTaskApprovalText'),
    taskApproveBtn: document.getElementById('officeTaskApproveBtn'),
    taskRejectBtn: document.getElementById('officeTaskRejectBtn'),
    taskCommentsList: document.getElementById('officeTaskCommentsList'),
    taskCommentInput: document.getElementById('officeTaskCommentInput'),
    taskCommentSendBtn: document.getElementById('officeTaskCommentSendBtn'),
    taskCommentAttachBtn: document.getElementById('officeTaskCommentAttachBtn'),
    taskCommentFileInput: document.getElementById('officeTaskCommentFileInput'),
    taskCommentAttachmentPreview: document.getElementById('officeTaskCommentAttachmentPreview'),
    taskCommentAttachmentName: document.getElementById('officeTaskCommentAttachmentName'),
    taskCommentAttachmentRemove: document.getElementById('officeTaskCommentAttachmentRemove'),
    taskFormHeading: document.getElementById('officeTaskFormHeading'),
    taskEditId: document.getElementById('officeTaskEditId'),
    taskSubmitBtn: document.getElementById('officeTaskSubmitBtn'),
    taskCancelBtn: document.getElementById('officeTaskCancelBtn'),
    taskDeleteBtn: document.getElementById('officeTaskDeleteBtn'),
    taskModal: document.getElementById('officeTaskModal'),
    taskModalBackdrop: document.getElementById('officeTaskModalBackdrop'),
    taskModalClose: document.getElementById('officeTaskModalClose'),
    taskBoard: document.getElementById('officeTaskBoard'),
    taskColumns: Array.prototype.slice.call(document.querySelectorAll('.office-kanban-column[data-status]')),
  };

  function notify(message, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type || 'info');
      return;
    }
    if (type === 'error') {
      window.console.error(message);
    } else {
      window.console.log(message);
    }
  }

  function formatDateTime(raw) {
    if (!raw) {
      return '-';
    }
    var dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) {
      return raw;
    }
    return dt.toLocaleString();
  }

  function formatChatTime(raw) {
    if (!raw) {
      return '';
    }
    var dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) {
      return '';
    }
    var now = new Date();
    var isToday = dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate();
    if (isToday) {
      return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function formatChatClock(raw) {
    if (!raw) {
      return '';
    }
    var dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) {
      return '';
    }
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function parseDateSafe(raw) {
    if (!raw) {
      return null;
    }
    var dt = new Date(raw);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  function formatLastSeen(raw) {
    var dt = parseDateSafe(raw);
    if (!dt) {
      return '';
    }

    var now = new Date();
    var diffMs = Math.max(0, now.getTime() - dt.getTime());
    var diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) {
      return 'just now';
    }
    if (diffMin < 60) {
      return diffMin + ' min ago';
    }

    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var startTarget = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    var dayDelta = Math.round((startToday - startTarget) / 86400000);
    var timeLabel = formatChatClock(raw);
    if (dayDelta === 0) {
      return 'today ' + timeLabel;
    }
    if (dayDelta === 1) {
      return 'yesterday ' + timeLabel;
    }
    return dt.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + timeLabel;
  }

  function memberPresenceLabel(member) {
    if (!member) {
      return 'Select a user from the right sidebar to start messaging.';
    }
    if (member.is_online) {
      return 'online';
    }
    var lastSeen = formatLastSeen(member.last_seen_at);
    if (!lastSeen) {
      return 'last seen recently';
    }
    return 'last seen ' + lastSeen;
  }

  function activePeerCanConfirmRead() {
    var member = activeMemberItem();
    if (!member || !member.is_online) {
      return false;
    }
    var group = activeGroupItem();
    if (!group) {
      return false;
    }
    return groupMemberCount(group) <= 2;
  }

  function refreshSelfMessageDeliveryState() {
    if (!ui.chatList) {
      return;
    }
    var isRead = activePeerCanConfirmRead();
    var stateNodes = ui.chatList.querySelectorAll('.office-chat-msg-state[data-self-message="1"]');
    stateNodes.forEach(function (node) {
      node.classList.toggle('is-read', isRead);
      node.classList.toggle('is-sent', !isRead);
      node.title = isRead ? 'Read' : 'Sent';
      node.innerHTML = isRead
        ? '<i class="fa-solid fa-check-double" aria-hidden="true"></i>'
        : '<i class="fa-solid fa-check" aria-hidden="true"></i>';
    });
  }

  function formatBytes(bytes) {
    var size = Number(bytes || 0);
    if (!Number.isFinite(size) || size <= 0) {
      return '0 B';
    }
    var units = ['B', 'KB', 'MB', 'GB'];
    var unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size = size / 1024;
      unitIndex += 1;
    }
    return size.toFixed(unitIndex === 0 ? 0 : 1) + ' ' + units[unitIndex];
  }

  function currentGroupTopic() {
    if (!state.activeGroupId) {
      return '';
    }
    var prefix = String((cfg.realtime && cfg.realtime.chatTopicPrefix) || 'officework.chat.group.');
    return prefix + String(state.activeGroupId);
  }

  function currentUserTopic() {
    var prefix = String((cfg.realtime && cfg.realtime.userTopicPrefix) || 'officework.chat.user.');
    return prefix + String(cfg.currentUserId || 0);
  }

  function escapeHtml(value) {
    var text = String(value == null ? '' : value);
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function supportsDesktopNotifications() {
    return typeof window !== 'undefined' && typeof window.Notification === 'function';
  }

  function parseRouteIntent() {
    var params = new URLSearchParams(window.location.search || '');
    var tab = String(params.get('ow_tab') || '').trim();
    var groupId = Number(params.get('ow_group') || 0);
    return {
      tab: tab || '',
      groupId: Number.isFinite(groupId) && groupId > 0 ? groupId : 0,
    };
  }

  function buildOfficeWorkUrl(tabName, groupId) {
    var url = new URL(window.location.href);
    var tab = String(tabName || '').trim();
    var gid = Number(groupId || 0);
    if (tab) {
      url.searchParams.set('ow_tab', tab);
    } else {
      url.searchParams.delete('ow_tab');
    }
    if (gid > 0) {
      url.searchParams.set('ow_group', String(gid));
    } else {
      url.searchParams.delete('ow_group');
    }
    return url;
  }

  function persistRouteState(tabName, groupId) {
    if (!window.history || typeof window.history.replaceState !== 'function') {
      return;
    }
    var url = buildOfficeWorkUrl(tabName, groupId);
    var next = url.pathname + url.search + url.hash;
    var current = window.location.pathname + window.location.search + window.location.hash;
    if (next !== current) {
      window.history.replaceState({}, '', next);
    }
  }

  function maybeRequestDesktopNotificationPermission() {
    if (!supportsDesktopNotifications()) {
      return;
    }
    if (window.Notification.permission !== 'default') {
      return;
    }
    try {
      var maybePromise = window.Notification.requestPermission();
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(function () {
          return;
        });
      }
    } catch (error) {
      return;
    }
  }

  function bootstrapDesktopNotificationPermission() {
    if (state.desktopPermissionBootstrapDone) {
      return;
    }
    state.desktopPermissionBootstrapDone = true;
    if (!supportsDesktopNotifications()) {
      return;
    }

    var onUserAction = function () {
      maybeRequestDesktopNotificationPermission();
    };
    window.addEventListener('click', onUserAction, { once: true, capture: true });
    window.addEventListener('keydown', onUserAction, { once: true, capture: true });
  }

  function isWindowFocused() {
    var visible = document.visibilityState === 'visible';
    var focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    return visible && focused;
  }

  function chatNotificationBody(item) {
    var text = String(item && item.message || '').trim();
    if (text) {
      return text.length > 180 ? text.slice(0, 177) + '...' : text;
    }
    if (item && item.attachment) {
      return 'Attachment: ' + String(item.attachment.name || 'File');
    }
    return 'New message';
  }

  function openChatFromNotification(groupId) {
    var targetGroupId = Number(groupId || 0);
    setActiveTab('chat');
    if (targetGroupId > 0) {
      if (targetGroupId === Number(state.activeGroupId || 0)) {
        persistRouteState('chat', targetGroupId);
        if (!state.chatLoaded) {
          resetChatState();
          loadChat({ forceInitial: true });
        }
      } else {
        switchActiveGroup(targetGroupId);
      }
      return;
    }
    persistRouteState('chat', Number(state.activeGroupId || 0));
  }

  function shouldShowDesktopChatNotification(item) {
    var incoming = item || {};
    var senderId = Number(incoming.sender_id || 0);
    if (senderId > 0 && senderId === Number(cfg.currentUserId || 0)) {
      return false;
    }

    var incomingGroupId = Number(incoming.group_id || 0);
    var isSameOpenThread = state.activeTab === 'chat' && incomingGroupId > 0 && incomingGroupId === Number(state.activeGroupId || 0);
    if (isSameOpenThread && isWindowFocused()) {
      return false;
    }

    return true;
  }

  function notifyIncomingChatMessage(item) {
    var message = item || {};
    var messageId = Number(message.id || 0);
    if (messageId > 0 && state.chatNotifiedMessageIds[messageId]) {
      return;
    }
    if (!shouldShowDesktopChatNotification(message)) {
      return;
    }
    if (!supportsDesktopNotifications() || window.Notification.permission !== 'granted') {
      return;
    }

    var groupId = Number(message.group_id || 0);
    var title = String(message.sender_name || 'New message');
    var body = chatNotificationBody(message);
    var targetUrl = buildOfficeWorkUrl('chat', groupId);

    try {
      var notification = new window.Notification(title, {
        body: body,
        tag: 'officework-chat-' + String(groupId || 'general'),
        renotify: true,
        requireInteraction: true,
        data: {
          group_id: groupId,
          href: targetUrl.pathname + targetUrl.search + targetUrl.hash,
        },
      });

      notification.onclick = function () {
        try {
          window.focus();
        } catch (error) {
          // Continue to route even if focus is blocked by the browser.
        }
        var targetGroupId = Number(notification.data && notification.data.group_id || 0);
        openChatFromNotification(targetGroupId);
        notification.close();
      };

      if (messageId > 0) {
        state.chatNotifiedMessageIds[messageId] = true;
      }
    } catch (error) {
      return;
    }
  }

  function setActiveTab(tabName) {
    state.activeTab = tabName;
    ui.tabButtons.forEach(function (btn) {
      var isActive = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    ui.panels.forEach(function (panel) {
      var isActive = panel.getAttribute('data-panel') === tabName;
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    });
    persistRouteState(tabName, Number(state.activeGroupId || 0));
  }

  function resetChatState() {
    state.chatLastId = 0;
    state.chatCount = 0;
    state.chatMessageIds = {};
    state.chatLoaded = false;
    if (ui.chatList) {
      ui.chatList.innerHTML = '';
    }
    updateChatCountPill();
  }

  function updateChatCountPill() {
    if (!ui.chatCountPill) {
      return;
    }
    var label = state.chatCount === 1 ? 'message' : 'messages';
    ui.chatCountPill.textContent = state.chatCount + ' ' + label;
  }

  function formatRoleLabel(rawRole) {
    var role = String(rawRole || '').trim();
    if (!role) {
      return 'Team';
    }
    return role.replace(/_/g, ' ').replace(/\b\w/g, function (ch) {
      return ch.toUpperCase();
    });
  }

  function memberListForGroup(group) {
    if (!group || !Array.isArray(group.members)) {
      return [];
    }
    return group.members;
  }

  function memberById(memberId) {
    var targetId = Number(memberId || 0);
    if (targetId <= 0) {
      return null;
    }
    for (var i = 0; i < state.availableMembers.length; i += 1) {
      if (Number(state.availableMembers[i].id || 0) === targetId) {
        return state.availableMembers[i];
      }
    }
    return null;
  }

  function membersForSidebar() {
    var currentUserId = Number(cfg.currentUserId || 0);
    var members = state.availableMembers.filter(function (member) {
      return Number(member && member.id || 0) > 0 && Number(member.id || 0) !== currentUserId;
    });
    members.sort(function (left, right) {
      var leftName = String(left && left.name || '').toLowerCase();
      var rightName = String(right && right.name || '').toLowerCase();
      if (leftName < rightName) {
        return -1;
      }
      if (leftName > rightName) {
        return 1;
      }
      return Number(left && left.id || 0) - Number(right && right.id || 0);
    });
    return members;
  }

  function groupHasMember(group, memberId) {
    var members = memberListForGroup(group);
    var targetId = Number(memberId || 0);
    for (var i = 0; i < members.length; i += 1) {
      if (Number(members[i] && members[i].id || 0) === targetId) {
        return true;
      }
    }
    return false;
  }

  function isDirectGroupForMember(group, memberId) {
    if (!group) {
      return false;
    }
    var currentUserId = Number(cfg.currentUserId || 0);
    var members = memberListForGroup(group);
    if (!members.length) {
      return false;
    }
    var hasCurrent = false;
    var hasTarget = false;
    for (var i = 0; i < members.length; i += 1) {
      var id = Number(members[i] && members[i].id || 0);
      if (id === currentUserId) {
        hasCurrent = true;
      }
      if (id === Number(memberId || 0)) {
        hasTarget = true;
      }
    }
    return hasCurrent && hasTarget && members.length <= 2;
  }

  function inferMemberIdForGroup(group) {
    var members = memberListForGroup(group);
    var currentUserId = Number(cfg.currentUserId || 0);
    for (var i = 0; i < members.length; i += 1) {
      var id = Number(members[i] && members[i].id || 0);
      if (id > 0 && id !== currentUserId) {
        return id;
      }
    }
    return 0;
  }

  function bestGroupForMember(memberId) {
    var targetId = Number(memberId || 0);
    if (targetId <= 0) {
      return null;
    }
    var candidates = state.groups.filter(function (group) {
      return groupHasMember(group, targetId);
    });
    if (!candidates.length) {
      return null;
    }
    candidates.sort(function (left, right) {
      var leftIsDirect = isDirectGroupForMember(left, targetId) ? 1 : 0;
      var rightIsDirect = isDirectGroupForMember(right, targetId) ? 1 : 0;
      if (rightIsDirect !== leftIsDirect) {
        return rightIsDirect - leftIsDirect;
      }
      var leftTs = new Date(groupUpdatedAt(left) || 0).getTime();
      var rightTs = new Date(groupUpdatedAt(right) || 0).getTime();
      if (rightTs !== leftTs) {
        return rightTs - leftTs;
      }
      return Number(right.id || 0) - Number(left.id || 0);
    });
    return candidates[0] || null;
  }

  function activeMemberItem() {
    return memberById(state.activeChatMemberId);
  }

  function groupMemberCount(group) {
    if (!group || typeof group !== 'object') {
      return 0;
    }
    var count = Number(group.member_count || 0);
    if (count > 0) {
      return count;
    }
    return memberListForGroup(group).length;
  }

  function activeGroupItem() {
    var activeId = Number(state.activeGroupId || 0);
    for (var i = 0; i < state.groups.length; i += 1) {
      if (Number(state.groups[i].id || 0) === activeId) {
        return state.groups[i];
      }
    }
    return null;
  }

  function groupSubtitle(group) {
    var preview = String(
      group && (
        group.last_message_text ||
        group.last_message_preview ||
        group.last_message ||
        ''
      ) || ''
    ).trim();
    if (preview) {
      return preview;
    }
    return 'Tap to start chat';
  }

  function groupUpdatedAt(group) {
    return (
      group && (
        group.last_message_at ||
        group.updated_at ||
        group.modified_at ||
        group.created_at
      )
    ) || '';
  }

  function touchGroupWithMessage(groupId, item) {
    var targetId = Number(groupId || 0);
    if (targetId <= 0 || !item) {
      return;
    }
    for (var i = 0; i < state.groups.length; i += 1) {
      if (Number(state.groups[i].id || 0) !== targetId) {
        continue;
      }
      state.groups[i].last_message_text = String(item.message || (item.attachment && item.attachment.name) || 'Attachment');
      state.groups[i].last_message_at = item.created_at || new Date().toISOString();
      break;
    }
  }

  function sortGroupsByRecentActivity() {
    state.groups.sort(function (left, right) {
      var leftTs = new Date(groupUpdatedAt(left) || 0).getTime();
      var rightTs = new Date(groupUpdatedAt(right) || 0).getTime();
      if (rightTs !== leftTs) {
        return rightTs - leftTs;
      }
      return Number(right.id || 0) - Number(left.id || 0);
    });
  }

  function updateActiveGroupHeader() {
    var group = activeGroupItem();
    var member = activeMemberItem();
    var titleText = 'Select a chat';
    if (member) {
      titleText = String(member.name || 'Team Member');
    } else if (group) {
      titleText = String(group.name || 'Team Chat');
    }

    if (ui.chatActiveGroupName) {
      ui.chatActiveGroupName.textContent = titleText;
    }

    if (ui.chatActiveAvatar) {
      var avatarChar = titleText.trim().charAt(0).toUpperCase() || '?';
      ui.chatActiveAvatar.textContent = avatarChar;
    }

    if (ui.chatActiveGroupMeta) {
      if (!group) {
        ui.chatActiveGroupMeta.textContent = 'Pick a user from the right sidebar to start messaging.';
        ui.chatActiveGroupMeta.classList.remove('is-online');
        ui.chatActiveGroupMeta.classList.add('is-offline');
      } else if (member) {
        ui.chatActiveGroupMeta.textContent = memberPresenceLabel(member);
        ui.chatActiveGroupMeta.classList.toggle('is-online', !!member.is_online);
        ui.chatActiveGroupMeta.classList.toggle('is-offline', !member.is_online);
      } else {
        var count = groupMemberCount(group);
        ui.chatActiveGroupMeta.textContent = (count > 0 ? count + ' members' : 'Group conversation');
        ui.chatActiveGroupMeta.classList.remove('is-online');
        ui.chatActiveGroupMeta.classList.add('is-offline');
      }
    }

    refreshSelfMessageDeliveryState();

    if (!ui.chatMembersStrip) {
      return;
    }

    if (!group) {
      ui.chatMembersStrip.innerHTML = '<span class="office-chat-member-chip">No group selected</span>';
      return;
    }

    var members = memberListForGroup(group);
    if (!members.length) {
      ui.chatMembersStrip.innerHTML = '<span class="office-chat-member-chip">No members added</span>';
      return;
    }

    ui.chatMembersStrip.innerHTML = members.map(function (member) {
      var role = formatRoleLabel(member && member.role_display ? member.role_display : member && member.role);
      var name = member && member.name ? member.name : 'Member';
      return '<span class="office-chat-member-chip">' + escapeHtml(name) + ' (' + escapeHtml(role) + ')</span>';
    }).join('');
  }

  function renderGroupList() {
    if (!ui.chatGroupsList) {
      return;
    }

    var query = String(ui.chatGroupSearch && ui.chatGroupSearch.value || '').trim().toLowerCase();
    var members = membersForSidebar().filter(function (member) {
      if (!query) {
        return true;
      }

      var roleLabel = formatRoleLabel(member && (member.role_display || member.role));
      if (String(member && member.name || '').toLowerCase().indexOf(query) >= 0) {
        return true;
      }
      return String(roleLabel || '').toLowerCase().indexOf(query) >= 0;
    });

    if (!members.length) {
      ui.chatGroupsList.innerHTML = '<div class="client-message-thread-state">No admins/operators found.</div>';
      return;
    }

    ui.chatGroupsList.innerHTML = members.map(function (member) {
      var memberId = Number(member && member.id || 0);
      var linkedGroup = bestGroupForMember(memberId);
      var linkedGroupId = Number(linkedGroup && linkedGroup.id || 0);
      var isActive = memberId === Number(state.activeChatMemberId || 0) || (linkedGroupId > 0 && linkedGroupId === Number(state.activeGroupId || 0));
      var rowClass = isActive ? 'office-chat-group-row is-active' : 'office-chat-group-row';
      var avatar = String(member && member.name || 'U').trim().charAt(0).toUpperCase() || 'U';
      var preview = linkedGroup ? groupSubtitle(linkedGroup) : 'Click to start chat';
      var timeText = linkedGroup ? formatChatTime(groupUpdatedAt(linkedGroup)) : '';
      return '' +
        '<div class="' + rowClass + '" data-member-id="' + escapeHtml(memberId) + '">' +
        '  <div class="office-chat-group-avatar" aria-hidden="true">' + escapeHtml(avatar) + '</div>' +
        '  <div class="office-chat-group-main">' +
        '    <div class="office-chat-group-row-head">' +
        '      <span class="office-chat-group-row-title">' + escapeHtml(member && member.name || 'Member') + '</span>' +
        (timeText ? '      <span class="office-chat-group-row-time">' + escapeHtml(timeText) + '</span>' : '') +
        '    </div>' +
        '    <div class="office-chat-group-row-sub">' + escapeHtml(preview) + '</div>' +
        '  </div>' +
        '</div>';
    }).join('');
  }

  function renderAvailableMembersList() {
    return;
  }

  function switchActiveGroup(nextGroupId) {
    var parsedId = Number(nextGroupId || 0);
    if (parsedId <= 0 || parsedId === Number(state.activeGroupId || 0)) {
      return;
    }

    state.previousGroupId = Number(state.activeGroupId || 0);
    state.activeGroupId = parsedId;
    state.activeChatMemberId = inferMemberIdForGroup(activeGroupItem());
    persistRouteState('chat', parsedId);
    syncGroupSubscription();
    renderGroupList();
    updateActiveGroupHeader();
    resetChatState();
    loadChat({ forceInitial: true });
  }

  async function ensureGroupForMember(memberId) {
    var targetMember = memberById(memberId);
    if (!targetMember) {
      return null;
    }

    var existing = bestGroupForMember(memberId);
    if (existing) {
      return existing;
    }

    if (!state.canManageGroups) {
      notify('No chat found for this user and you cannot create groups.', 'error');
      return null;
    }

    var createData = await ApiClient.post(endpoints.chatGroupCreate, {
      name: String(targetMember.name || 'Direct Chat').trim() || 'Direct Chat',
      member_ids: [Number(targetMember.id || 0)],
    });

    if (!createData || !createData.success) {
      throw new Error((createData && createData.message) || 'Failed to start chat.');
    }

    await loadGroups({ keepCurrent: true });

    if (createData.group && createData.group.id) {
      var createdId = Number(createData.group.id || 0);
      for (var i = 0; i < state.groups.length; i += 1) {
        if (Number(state.groups[i].id || 0) === createdId) {
          return state.groups[i];
        }
      }
    }

    return bestGroupForMember(memberId);
  }

  async function switchActiveMember(memberId) {
    var parsedMemberId = Number(memberId || 0);
    if (parsedMemberId <= 0) {
      return;
    }

    state.activeChatMemberId = parsedMemberId;
    renderGroupList();
    updateActiveGroupHeader();

    try {
      var targetGroup = bestGroupForMember(parsedMemberId);
      if (!targetGroup) {
        targetGroup = await ensureGroupForMember(parsedMemberId);
      }
      if (!targetGroup || !targetGroup.id) {
        persistRouteState('chat', 0);
        resetChatState();
        renderChatEmptyState();
        return;
      }

      var targetGroupId = Number(targetGroup.id || 0);
      if (targetGroupId === Number(state.activeGroupId || 0)) {
        syncGroupSubscription();
        renderGroupList();
        updateActiveGroupHeader();
        if (!state.chatLoaded) {
          resetChatState();
          loadChat({ forceInitial: true });
        }
        return;
      }

      state.previousGroupId = Number(state.activeGroupId || 0);
      state.activeGroupId = targetGroupId;
      persistRouteState('chat', targetGroupId);
      syncGroupSubscription();
      renderGroupList();
      updateActiveGroupHeader();
      resetChatState();
      loadChat({ forceInitial: true });
    } catch (error) {
      notify((error && error.message) || 'Failed to open chat.', 'error');
    }
  }

  function rememberChatId(itemId) {
    var numericId = Number(itemId || 0);
    if (numericId <= 0) {
      return false;
    }
    if (state.chatMessageIds[numericId]) {
      return true;
    }
    state.chatMessageIds[numericId] = true;
    return false;
  }

  function appendChatMessage(item, options) {
    var itemId = Number(item && item.id || 0);
    if (rememberChatId(itemId)) {
      return;
    }

    var shouldNotifyIncoming = !!(options && options.notifyIncoming);

    var isSelf = Number(item.sender_id || 0) === Number(cfg.currentUserId || 0);
    var row = document.createElement('article');
    row.className = isSelf ? 'client-message-row office-chat-row-self' : 'client-message-row office-chat-row-peer';
    var timeText = formatChatClock(item.created_at);
    var showRead = isSelf && activePeerCanConfirmRead();
    var deliveryStateHtml = isSelf
      ? (
        '<span class="office-chat-msg-state ' + (showRead ? 'is-read' : 'is-sent') + '" data-self-message="1" title="' + (showRead ? 'Read' : 'Sent') + '">' +
        '  <i class="fa-solid ' + (showRead ? 'fa-check-double' : 'fa-check') + '" aria-hidden="true"></i>' +
        '</span>'
      )
      : '';
    var attachmentHtml = '';
    if (item.attachment) {
      var contentType = String(item.attachment.content_type || '').toLowerCase();
      var isImage = contentType.indexOf('image/') === 0;
      var isAudio = contentType.indexOf('audio/') === 0;

      if (isImage) {
        attachmentHtml = '' +
          '<div class="office-chat-attachment-item">' +
          '  <img class="office-chat-image-preview" src="' + escapeHtml(item.attachment.download_url) + '" alt="' + escapeHtml(item.attachment.name) + '" onclick="window.open(this.src, \'_blank\')">' +
          '  <a class="office-chat-file-link" href="' + escapeHtml(item.attachment.download_url) + '" title="Download original">' +
          '    <i class="fa-solid fa-download"></i>' +
          '    <span>' + escapeHtml(item.attachment.name) + ' (' + escapeHtml(formatBytes(item.attachment.size_bytes)) + ')</span>' +
          '  </a>' +
          '</div>';
      } else if (isAudio) {
        attachmentHtml = '' +
          '<div class="office-chat-attachment-item">' +
          '  <div class="office-chat-file-link">' +
          '    <i class="fa-solid fa-file-audio"></i>' +
          '    <span>' + escapeHtml(item.attachment.name) + ' (' + escapeHtml(formatBytes(item.attachment.size_bytes)) + ')</span>' +
          '  </div>' +
          '  <audio class="office-chat-audio-player" controls src="' + escapeHtml(item.attachment.download_url) + '"></audio>' +
          '  <a class="office-chat-file-link" href="' + escapeHtml(item.attachment.download_url) + '" title="Download original">' +
          '    <i class="fa-solid fa-download"></i>' +
          '    <span>Download</span>' +
          '  </a>' +
          '</div>';
      } else {
        attachmentHtml = '' +
          '<a class="office-chat-file-link" href="' + escapeHtml(item.attachment.download_url || '#') + '">' +
          '  <i class="fa-solid fa-file-arrow-down"></i>' +
          '  <span>' + escapeHtml(item.attachment.name || 'Attachment') + '</span>' +
          '  <span>(' + escapeHtml(formatBytes(item.attachment.size_bytes || 0)) + ')</span>' +
          '</a>';
      }
    }

    row.innerHTML = '' +
      '<div class="client-message-bubble">' +
      (item.message ? '  <div class="client-message-text">' + escapeHtml(item.message || '') + '</div>' : '') +
      attachmentHtml +
      '  <div class="office-chat-msg-footer">' +
      '    <span class="office-chat-msg-time">' + escapeHtml(timeText) + '</span>' +
      deliveryStateHtml +
      '  </div>' +
      '</div>' +
      '';
    ui.chatList.appendChild(row);
    state.chatCount += 1;
    touchGroupWithMessage(item && item.group_id, item || {});
    sortGroupsByRecentActivity();
    renderGroupList();
    if (itemId > state.chatLastId) {
      state.chatLastId = itemId;
    }
    updateChatCountPill();

    if (shouldNotifyIncoming) {
      notifyIncomingChatMessage(item || {});
    }
  }

  function clearChatEmptyState() {
    var emptyNode = ui.chatList.querySelector('.client-message-thread-state');
    if (emptyNode) {
      emptyNode.remove();
    }
  }

  function renderChatEmptyState() {
    if (ui.chatList.children.length > 0) {
      return;
    }
    state.chatCount = 0;
    updateChatCountPill();
    var empty = document.createElement('div');
    empty.className = 'client-message-thread-state';
    empty.textContent = state.groups.length ? 'No chat yet. Start the conversation.' : 'No chat group found yet. Pick a user to start a direct chat.';
    ui.chatList.appendChild(empty);
  }

  async function loadChat(options) {
    var forceInitial = !!(options && options.forceInitial);
    if (!state.activeGroupId) {
      renderChatEmptyState();
      return;
    }

    if (state.chatLoadInFlight) {
      state.chatLoadPending = true;
      if (forceInitial) {
        state.chatLoadPendingForceInitial = true;
      }
      return;
    }

    state.chatLoadInFlight = true;

    var query = forceInitial
      ? ('?limit=180&group_id=' + encodeURIComponent(state.activeGroupId))
      : ('?after_id=' + encodeURIComponent(state.chatLastId) + '&group_id=' + encodeURIComponent(state.activeGroupId));

    try {
      var data = await ApiClient.get(endpoints.chatList + query);
      if (!data || !data.success) {
        return;
      }
      state.lastChatSyncAtMs = Date.now();

      var messages = Array.isArray(data.messages) ? data.messages : [];
      if (messages.length === 0) {
        if (!state.chatLoaded) {
          renderChatEmptyState();
        } else {
          updateChatCountPill();
        }
        return;
      }

      clearChatEmptyState();
      messages.forEach(function (item) {
        appendChatMessage(item, { notifyIncoming: !forceInitial });
        var itemId = Number(item.id || 0);
        if (itemId > state.chatLastId) {
          state.chatLastId = itemId;
        }
      });

      if (forceInitial || state.activeTab === 'chat') {
        ui.chatList.scrollTop = ui.chatList.scrollHeight;
      }
      state.chatLoaded = true;
    } catch (error) {
      if (forceInitial) {
        notify((error && error.message) || 'Failed to load chat.', 'error');
      }
    } finally {
      state.chatLoadInFlight = false;
      if (state.chatLoadPending) {
        var pendingForceInitial = !!state.chatLoadPendingForceInitial;
        state.chatLoadPending = false;
        state.chatLoadPendingForceInitial = false;
        loadChat({ forceInitial: pendingForceInitial });
      }
    }
  }

  function renderGroupOptions() {
    if (!state.groups.length) {
      state.activeGroupId = 0;
      renderGroupList();
      updateActiveGroupHeader();
      return;
    }

    if (!memberById(state.activeChatMemberId)) {
      state.activeChatMemberId = inferMemberIdForGroup(activeGroupItem());
    }
    renderGroupList();
    updateActiveGroupHeader();
  }

  function syncGroupSubscription() {
    if (!window.AppRealtimeService) {
      return;
    }

    var nextTopic = currentGroupTopic();
    if (state.subscribedGroupTopic && state.subscribedGroupTopic !== nextTopic) {
      window.AppRealtimeService.unsubscribe([state.subscribedGroupTopic]);
      state.subscribedGroupTopic = '';
    }
    if (nextTopic && nextTopic !== state.subscribedGroupTopic) {
      window.AppRealtimeService.subscribe([nextTopic]);
      state.subscribedGroupTopic = nextTopic;
    }
  }

  async function loadGroups(options) {
    var keepCurrent = !!(options && options.keepCurrent);
    var previous = Number(state.activeGroupId || 0);

    try {
      var data = await ApiClient.get(endpoints.chatGroupsList);
      if (!data || !data.success) {
        return;
      }

      state.groups = Array.isArray(data.groups) ? data.groups : [];
      sortGroupsByRecentActivity();
      state.availableMembers = Array.isArray(data.available_members) ? data.available_members : [];
      state.canManageGroups = !!data.can_manage_groups;

      if (ui.createGroupBtn) {
        ui.createGroupBtn.disabled = !state.canManageGroups;
      }

      if (keepCurrent && previous > 0) {
        var stillThere = state.groups.some(function (group) {
          return Number(group.id) === previous;
        });
        state.activeGroupId = stillThere ? previous : Number(state.groups[0] && state.groups[0].id || 0);
      } else if (!state.activeGroupId || !state.groups.some(function (group) {
        return Number(group.id) === Number(state.activeGroupId);
      })) {
        state.activeGroupId = Number(state.groups[0] && state.groups[0].id || 0);
      }

      if (!memberById(state.activeChatMemberId)) {
        state.activeChatMemberId = inferMemberIdForGroup(activeGroupItem());
      }

      renderGroupOptions();
      syncGroupSubscription();

      if (Number(state.activeGroupId) !== Number(previous)) {
        resetChatState();
      }
    } catch (error) {
      notify((error && error.message) || 'Failed to load chat groups.', 'error');
    }
  }

  function setPendingAttachment(file) {
    if (!file) {
      state.pendingAttachment = null;
      if (ui.chatAttachmentPreview) {
        ui.chatAttachmentPreview.hidden = true;
      }
      if (ui.chatAttachmentName) {
        ui.chatAttachmentName.textContent = '';
      }
      if (ui.chatFileInput) {
        ui.chatFileInput.value = '';
      }
      return;
    }

    var sizeBytes = Number(file.size || 0);
    if (sizeBytes <= 0) {
      notify('Attachment is empty.', 'error');
      return;
    }
    if (sizeBytes > 50 * 1024 * 1024) {
      notify('Attachment too large (max 50 MB).', 'error');
      return;
    }

    state.pendingAttachment = file;
    var isImage = file.type.indexOf('image/') === 0;
    var previewHtml = '';
    
    if (isImage) {
      previewHtml = '<i class="fa-solid fa-image"></i> ';
    } else if (file.type.indexOf('audio/') === 0) {
      previewHtml = '<i class="fa-solid fa-file-audio"></i> ';
    } else {
      previewHtml = '<i class="fa-solid fa-file"></i> ';
    }

    if (ui.chatAttachmentName) {
      ui.chatAttachmentName.innerHTML = previewHtml + '<span>' + escapeHtml(file.name || 'Attachment') + ' (' + formatBytes(sizeBytes) + ')</span>';
    }
    if (ui.chatAttachmentPreview) {
      ui.chatAttachmentPreview.hidden = false;
    }
  }

  function promptGroupMemberIds() {
    if (!state.availableMembers.length) {
      return [];
    }

    var helperRows = state.availableMembers.slice(0, 20).map(function (member) {
      return member.id + ': ' + member.name + ' (' + member.role_display + ')';
    }).join('\n');

    var raw = window.prompt(
      'Enter participant IDs separated by commas.\\n\\nAvailable members:\\n' + helperRows,
      ''
    );
    if (raw === null) {
      return null;
    }

    var ids = [];
    String(raw || '').split(',').forEach(function (part) {
      var parsed = Number(String(part || '').trim());
      if (Number.isInteger(parsed) && parsed > 0) {
        ids.push(parsed);
      }
    });
    return ids;
  }

  async function createGroupFlow() {
    if (!state.canManageGroups) {
      notify('Only admins can create groups.', 'error');
      return;
    }

    var name = window.prompt('Enter group name:', 'New Group');
    if (name === null) {
      return;
    }
    name = String(name || '').trim();
    if (!name) {
      notify('Group name is required.', 'error');
      return;
    }

    var memberIds = promptGroupMemberIds();
    if (memberIds === null) {
      return;
    }

    try {
      var data = await ApiClient.post(endpoints.chatGroupCreate, {
        name: name,
        member_ids: memberIds,
      });
      if (!data || !data.success) {
        notify((data && data.message) || 'Failed to create group.', 'error');
        return;
      }

      await loadGroups({ keepCurrent: false });
      if (data.group && data.group.id) {
        state.activeGroupId = Number(data.group.id);
        state.activeChatMemberId = inferMemberIdForGroup(activeGroupItem());
        renderGroupOptions();
        syncGroupSubscription();
      }
      resetChatState();
      await loadChat({ forceInitial: true });
      notify('Group created.', 'success');
    } catch (error) {
      notify((error && error.message) || 'Failed to create group.', 'error');
    }
  }

  function getMemberOptionsHtml(selectedId) {
    var selected = Number(selectedId || 0);
    var html = '<option value="">Unassigned</option>';
    state.members.forEach(function (member) {
      var isSelected = Number(member.id) === selected ? ' selected' : '';
      html += '<option value="' + escapeHtml(member.id) + '"' + isSelected + '>' +
        escapeHtml(member.name + ' (' + member.role_display + ')') +
        '</option>';
    });
    return html;
  }

  function getMembersOnlyOptionsHtml(selectedId) {
    var selected = Number(selectedId || 0);
    var html = '<option value="">Select member</option>';
    state.members.forEach(function (member) {
      var isSelected = Number(member.id) === selected ? ' selected' : '';
      html += '<option value="' + escapeHtml(member.id) + '"' + isSelected + '>' +
        escapeHtml(member.name + ' (' + member.role_display + ')') +
        '</option>';
    });
    return html;
  }

  function getMembersLookup() {
    var lookup = {};
    state.members.forEach(function (member) {
      lookup[Number(member.id || 0)] = member;
    });
    return lookup;
  }

  function memberNameById(memberId) {
    var id = Number(memberId || 0);
    if (id <= 0) {
      return 'Unassigned';
    }
    for (var i = 0; i < state.members.length; i += 1) {
      if (Number(state.members[i].id || 0) === id) {
        return String(state.members[i].name || ('User ' + id));
      }
    }
    return 'User ' + id;
  }

  var TASK_STATUS_META = {
    todo: { label: 'To Do' },
    in_progress: { label: 'In Progress' },
    done: { label: 'Done' },
    pending: { label: 'Pending' },
  };

  var TASK_STATUS_ORDER = ['todo', 'in_progress', 'done', 'pending'];

  var TASK_PRIORITY_META = {
    low: { label: 'Low' },
    normal: { label: 'Normal' },
    high: { label: 'High' },
  };

  function currentTasksTopic() {
    return String((cfg.realtime && cfg.realtime.tasksTopic) || 'officework.tasks').trim();
  }

  function getTaskEditId() {
    return Number((ui.taskEditId && ui.taskEditId.value) || 0);
  }

  function taskById(taskId) {
    var id = Number(taskId || 0);
    for (var i = 0; i < state.taskItems.length; i += 1) {
      if (Number(state.taskItems[i].id || 0) === id) {
        return state.taskItems[i];
      }
    }
    return null;
  }

  function sortTasksInPlace() {
    state.taskItems.sort(function (left, right) {
      var leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
      var rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return Number(right.id || 0) - Number(left.id || 0);
    });
  }

  function upsertTaskItem(item) {
    if (!item || !item.id) {
      return;
    }
    var targetId = Number(item.id);
    var replaced = false;
    state.taskItems = state.taskItems.map(function (task) {
      if (Number(task.id || 0) === targetId) {
        replaced = true;
        return item;
      }
      return task;
    });
    if (!replaced) {
      state.taskItems.push(item);
    }
    sortTasksInPlace();
  }

  function removeTaskItem(taskId) {
    var targetId = Number(taskId || 0);
    if (targetId <= 0) {
      return;
    }
    state.taskItems = state.taskItems.filter(function (task) {
      return Number(task.id || 0) !== targetId;
    });
  }

  function truncateTaskDescription(text) {
    var raw = String(text || '').trim();
    if (raw.length <= 120) {
      return raw;
    }
    return raw.slice(0, 117) + '...';
  }

  function taskCommentsEndpoint(taskId) {
    return (endpoints.taskCommentsBase || endpoints.taskUpdateBase) + encodeURIComponent(taskId) + '/comments/';
  }

  function taskCommentCreateEndpoint(taskId) {
    return (endpoints.taskCommentsBase || endpoints.taskUpdateBase) + encodeURIComponent(taskId) + '/comments/create/';
  }

  function getSelectedCollaboratorIds() {
    if (!ui.taskCollaborators || !ui.taskCollaborators.options) {
      return [];
    }
    var ids = [];
    for (var i = 0; i < ui.taskCollaborators.options.length; i += 1) {
      var option = ui.taskCollaborators.options[i];
      if (!option.selected) {
        continue;
      }
      var parsedId = Number(option.value || 0);
      if (parsedId > 0) {
        ids.push(parsedId);
      }
    }
    return ids;
  }

  function renderFollowerStrip(item) {
    if (!ui.taskFollowers) {
      return;
    }
    var followerIds = Array.isArray(item && item.follower_ids) ? item.follower_ids : [];
    if (!followerIds.length) {
      ui.taskFollowers.innerHTML = '<span class="office-task-follower-chip">No followers</span>';
      return;
    }
    ui.taskFollowers.innerHTML = followerIds.map(function (followerId) {
      return '<span class="office-task-follower-chip">' + escapeHtml(memberNameById(followerId)) + '</span>';
    }).join('');
  }

  function renderTaskChecklistRows() {
    if (!ui.taskChecklistItems) {
      return;
    }
    var item = state.taskCurrentItem || {};
    var checklist = Array.isArray(item.checklist_items) ? item.checklist_items : [];
    if (!checklist.length) {
      ui.taskChecklistItems.innerHTML = '<div class="office-task-checklist-empty">No checklist items yet.</div>';
      return;
    }

    ui.taskChecklistItems.innerHTML = checklist.map(function (checkItem) {
      var id = String(checkItem && checkItem.id || '');
      var isDone = !!(checkItem && checkItem.is_done);
      return '' +
        '<div class="office-task-checklist-row" data-checklist-id="' + escapeHtml(id) + '">' +
        '  <input class="office-task-checklist-toggle" type="checkbox" ' + (isDone ? 'checked' : '') + '>' +
        '  <span class="office-task-checklist-title' + (isDone ? ' is-done' : '') + '">' + escapeHtml(checkItem && checkItem.title || 'Checklist Item') + '</span>' +
        '  <span class="office-task-checklist-assignee">' + escapeHtml(memberNameById(checkItem && checkItem.assigned_to_id)) + '</span>' +
        '  <button type="button" class="btn btn-xs btn-neutral" data-action="remove-checklist-item">Remove</button>' +
        '</div>';
    }).join('');
  }

  function updateTaskCompletionState(item) {
    if (!ui.taskCompletionState) {
      return;
    }
    if (!item || !item.id) {
      ui.taskCompletionState.textContent = 'No request yet';
      return;
    }
    if (item.status === 'pending') {
      var requester = String(item.completion_requested_by_name || 'A member');
      ui.taskCompletionState.textContent = 'Waiting creator approval. Requested by ' + requester + '.';
      return;
    }
    if (item.status === 'done') {
      var approver = String(item.completion_approved_by_name || 'Creator');
      ui.taskCompletionState.textContent = 'Approved by ' + approver + '.';
      return;
    }
    ui.taskCompletionState.textContent = 'No request yet';
  }

  function updateTaskApprovalBox(item) {
    if (!ui.taskApprovalBox || !ui.taskApprovalText) {
      return;
    }
    var canApprove = !!item && item.status === 'pending' && Number(cfg.currentUserId || 0) === Number(item.created_by_id || 0);
    ui.taskApprovalBox.hidden = !canApprove;
    if (!canApprove) {
      return;
    }
    var requester = String(item.completion_requested_by_name || 'A member');
    ui.taskApprovalText.textContent = requester + ' marked this card as done. Approve to move into Done list.';
  }

  function resetTaskCommentAttachment() {
    state.taskPendingCommentFile = null;
    if (ui.taskCommentFileInput) {
      ui.taskCommentFileInput.value = '';
    }
    if (ui.taskCommentAttachmentPreview) {
      ui.taskCommentAttachmentPreview.hidden = true;
    }
    if (ui.taskCommentAttachmentName) {
      ui.taskCommentAttachmentName.textContent = '';
    }
  }

  function setTaskCommentAttachment(file) {
    if (!file) {
      resetTaskCommentAttachment();
      return;
    }
    var sizeBytes = Number(file.size || 0);
    if (sizeBytes <= 0) {
      notify('Attachment is empty.', 'error');
      return;
    }
    if (sizeBytes > 50 * 1024 * 1024) {
      notify('Attachment too large (max 50 MB).', 'error');
      return;
    }
    state.taskPendingCommentFile = file;
    if (ui.taskCommentAttachmentName) {
      ui.taskCommentAttachmentName.textContent = String(file.name || 'Attachment') + ' (' + formatBytes(sizeBytes) + ')';
    }
    if (ui.taskCommentAttachmentPreview) {
      ui.taskCommentAttachmentPreview.hidden = false;
    }
  }

  function renderTaskComments(item) {
    if (!ui.taskCommentsList) {
      return;
    }
    var taskId = Number(item && item.id || 0);
    var comments = state.taskCommentsByTaskId[taskId] || [];
    if (!comments.length) {
      ui.taskCommentsList.innerHTML = '<div class="office-task-comments-empty">No activity yet.</div>';
      return;
    }

    ui.taskCommentsList.innerHTML = comments.map(function (comment) {
      var author = String(comment.sender_name || 'Unknown');
      var avatar = author.charAt(0).toUpperCase();
      var time = formatDateTime(comment.created_at);
      
      return '' +
        '<article class="office-task-comment-row">' +
        '  <div class="office-task-comment-avatar">' + escapeHtml(avatar) + '</div>' +
        '  <div class="office-task-comment-content">' +
        '    <div class="office-task-comment-head">' +
        '      <span class="office-task-comment-author">' + escapeHtml(author) + '</span>' +
        '      <span class="office-task-comment-time">' + escapeHtml(time) + '</span>' +
        '    </div>' +
        '    <div class="office-task-comment-body">' +
        (comment.message ? '      <div class="office-task-comment-text">' + escapeHtml(comment.message) + '</div>' : '') +
        (comment.attachment ? (
          '      <a class="office-chat-file-link" style="margin-top: 8px;" href="' + escapeHtml(comment.attachment.download_url || '#') + '">' +
          '        <i class="fa-solid fa-paperclip"></i>' +
          '        <span>' + escapeHtml(comment.attachment.name || 'Attachment') + '</span>' +
          '      </a>'
        ) : '') +
        '    </div>' +
        '    <div class="office-task-comment-footer">' +
        '      <span class="office-task-comment-action">Reply</span>' +
        '    </div>' +
        '  </div>' +
        '</article>';
    }).join('');
    ui.taskCommentsList.scrollTop = ui.taskCommentsList.scrollHeight;
  }

  async function loadTaskComments(taskId) {
    var id = Number(taskId || 0);
    if (id <= 0) {
      return;
    }
    try {
      var data = await ApiClient.get(taskCommentsEndpoint(id));
      if (!data || !data.success) {
        return;
      }
      state.taskCommentsByTaskId[id] = Array.isArray(data.comments) ? data.comments : [];
      if (state.taskCurrentItem && Number(state.taskCurrentItem.id || 0) === id) {
        renderTaskComments(state.taskCurrentItem);
      }
    } catch (error) {
      notify((error && error.message) || 'Failed to load task comments.', 'error');
    }
  }

  function resetTaskEditor() {
    if (!ui.taskForm) {
      return;
    }
    state.taskCurrentItem = null;
    ui.taskForm.reset();
    if (ui.taskStatus) {
      ui.taskStatus.value = 'todo';
      ui.taskStatus.disabled = true;
    }
    if (ui.taskPriority) {
      ui.taskPriority.value = 'normal';
    }
    if (ui.taskEditId) {
      ui.taskEditId.value = '';
    }
    if (ui.taskTitle) {
      ui.taskTitle.readOnly = false;
      ui.taskTitle.classList.remove('is-locked');
    }
    if (ui.taskAssignee) {
      ui.taskAssignee.innerHTML = getMemberOptionsHtml(0);
    }
    if (ui.taskCollaborators) {
      ui.taskCollaborators.innerHTML = getMembersOnlyOptionsHtml(0);
    }
    if (ui.taskChecklistAssignee) {
      ui.taskChecklistAssignee.innerHTML = getMembersOnlyOptionsHtml(0);
    }
    if (ui.taskChecklistItems) {
      ui.taskChecklistItems.innerHTML = '<div class="office-task-checklist-empty">No checklist items yet.</div>';
    }
    if (ui.taskFollowers) {
      ui.taskFollowers.innerHTML = '<span class="office-task-follower-chip">No followers</span>';
    }
    if (ui.taskCreatedBy) {
      ui.taskCreatedBy.textContent = 'You';
    }
    if (ui.taskCompletionState) {
      ui.taskCompletionState.textContent = 'No request yet';
    }
    if (ui.taskFormHeading) {
      ui.taskFormHeading.innerHTML = '<i class="fa-solid fa-plus"></i> Create Card';
    }
    if (ui.taskSubmitBtn) {
      ui.taskSubmitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Card';
    }
    if (ui.taskCancelBtn) {
      ui.taskCancelBtn.hidden = false;
    }
    if (ui.taskDeleteBtn) {
      ui.taskDeleteBtn.hidden = true;
    }
    if (ui.taskApprovalBox) {
      ui.taskApprovalBox.hidden = true;
    }
    if (ui.taskCommentsList) {
      ui.taskCommentsList.innerHTML = '<div class="office-task-comments-empty">Create the card first to start discussion.</div>';
    }
    if (ui.taskCommentInput) {
      ui.taskCommentInput.value = '';
      ui.taskCommentInput.disabled = true;
    }
    if (ui.taskCommentSendBtn) {
      ui.taskCommentSendBtn.disabled = true;
    }
    if (ui.taskCommentAttachBtn) {
      ui.taskCommentAttachBtn.disabled = true;
    }
    resetTaskCommentAttachment();
  }

  function setTaskEditor(item) {
    if (!item || !ui.taskForm) {
      return;
    }
    state.taskCurrentItem = item;
    if (ui.taskEditId) {
      ui.taskEditId.value = String(item.id || '');
    }
    if (ui.taskTitle) {
      ui.taskTitle.value = String(item.title || '');
    }
    if (ui.taskDescription) {
      ui.taskDescription.value = String(item.description || '');
    }
    if (ui.taskStatus) {
      ui.taskStatus.value = String(item.status || 'todo');
      ui.taskStatus.disabled = false;
    }
    if (ui.taskPriority) {
      ui.taskPriority.value = String(item.priority || 'normal');
    }
    if (ui.taskAssignee) {
      ui.taskAssignee.innerHTML = getMemberOptionsHtml(item.assigned_to_id || 0);
      ui.taskAssignee.value = item.assigned_to_id ? String(item.assigned_to_id) : '';
    }
    if (ui.taskCollaborators) {
      ui.taskCollaborators.innerHTML = state.members.map(function (member) {
        var memberId = Number(member.id || 0);
        var selected = (Array.isArray(item.collaborator_ids) && item.collaborator_ids.indexOf(memberId) >= 0) ? ' selected' : '';
        return '<option value="' + escapeHtml(memberId) + '"' + selected + '>' +
          escapeHtml(member.name + ' (' + member.role_display + ')') +
          '</option>';
      }).join('');
    }
    if (ui.taskDueDate) {
      ui.taskDueDate.value = String(item.due_date || '');
    }
    if (ui.taskChecklistAssignee) {
      ui.taskChecklistAssignee.innerHTML = getMembersOnlyOptionsHtml(0);
    }
    renderFollowerStrip(item);
    renderTaskChecklistRows();
    updateTaskCompletionState(item);
    updateTaskApprovalBox(item);

    if (ui.taskCreatedBy) {
      ui.taskCreatedBy.textContent = String(item.created_by_name || '-');
    }
    if (ui.taskFormHeading) {
      ui.taskFormHeading.innerHTML = '<i class="fa-solid fa-table-cells-large"></i> Task Card';
    }
    if (ui.taskSubmitBtn) {
      ui.taskSubmitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
    }
    if (ui.taskCancelBtn) {
      ui.taskCancelBtn.hidden = false;
    }
    if (ui.taskDeleteBtn) {
      ui.taskDeleteBtn.hidden = false;
    }
    if (ui.taskCommentsList) {
      ui.taskCommentsList.innerHTML = '<div class="office-task-comments-empty">Loading discussion...</div>';
    }
    if (ui.taskCommentInput) {
      ui.taskCommentInput.value = '';
      ui.taskCommentInput.disabled = false;
    }
    if (ui.taskCommentSendBtn) {
      ui.taskCommentSendBtn.disabled = false;
    }
    if (ui.taskCommentAttachBtn) {
      ui.taskCommentAttachBtn.disabled = false;
    }
    resetTaskCommentAttachment();
    loadTaskComments(item.id);

    if (ui.taskTitle && typeof ui.taskTitle.focus === 'function') {
      ui.taskTitle.focus();
    }
  }

  function renderTaskCard(task) {
    var priority = String(task.priority || 'normal').toLowerCase();
    var priorityMeta = TASK_PRIORITY_META[priority] || TASK_PRIORITY_META.normal;

    return '' +
      '<article class="office-task-card" draggable="true" data-task-id="' + escapeHtml(task.id) + '">' +
      '  <div class="office-task-card-top">' +
      '    <span class="office-task-chip priority-' + escapeHtml(priority) + '">' + escapeHtml(priorityMeta.label) + '</span>' +
      '    <button type="button" class="office-task-edit-trigger" title="Edit details"><i class="fa-solid fa-pencil"></i></button>' +
      '  </div>' +
      '  <h5 class="office-task-card-title" title="Click to edit title" data-task-title-id="' + escapeHtml(task.id) + '">' + escapeHtml(task.title || 'Untitled Task') + '</h5>' +
      '</article>';
  }

  function closeInlineTaskCreator() {
    state.taskInlineCreateStatus = '';
    if (!ui.taskBoard) {
      return;
    }
    var wraps = ui.taskBoard.querySelectorAll('.office-kanban-add-wrap');
    wraps.forEach(function (wrap) {
      var defaultBtn = wrap.querySelector('.office-kanban-add-btn[data-add-task-status]');
      var inline = wrap.querySelector('.office-kanban-inline-create');
      if (inline) {
        inline.remove();
      }
      if (defaultBtn) {
        defaultBtn.hidden = false;
      }
    });
  }

  function openInlineTaskCreator(status) {
    var nextStatus = String(status || 'todo').trim();
    if (!nextStatus || !ui.taskBoard) {
      return;
    }
    closeInlineTaskCreator();
    state.taskInlineCreateStatus = nextStatus;
    var wrap = ui.taskBoard.querySelector('.office-kanban-column[data-status="' + nextStatus + '"] .office-kanban-add-wrap');
    if (!wrap) {
      return;
    }
    var defaultBtn = wrap.querySelector('.office-kanban-add-btn[data-add-task-status]');
    if (defaultBtn) {
      defaultBtn.hidden = true;
    }

    var inline = document.createElement('div');
    inline.className = 'office-kanban-inline-create';
    inline.innerHTML = '' +
      '<input type="text" class="office-input office-kanban-inline-input" maxlength="180" placeholder="Card title..." data-inline-title-input="' + escapeHtml(nextStatus) + '">' +
      '<div class="office-kanban-inline-actions">' +
      '  <button type="button" class="btn btn-sm btn-primary" data-action="save-inline-task" data-inline-status="' + escapeHtml(nextStatus) + '">Add</button>' +
      '  <button type="button" class="btn btn-sm btn-neutral" data-action="cancel-inline-task">Cancel</button>' +
      '</div>';
    wrap.appendChild(inline);

    var input = inline.querySelector('[data-inline-title-input]');
    if (input && typeof input.focus === 'function') {
      input.focus();
    }
  }

  function startInlineTaskTitleEdit(node) {
    var taskId = Number(node.getAttribute('data-task-title-id') || 0);
    var item = taskById(taskId);
    if (!item) return;

    var originalValue = node.textContent.trim();
    node.classList.add('is-editing');
    node.contentEditable = 'true';
    node.focus();

    // Select all text
    var range = document.createRange();
    range.selectNodeContents(node);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function finish(save) {
      node.classList.remove('is-editing');
      node.contentEditable = 'false';
      node.removeEventListener('blur', onBlur);
      node.removeEventListener('keydown', onKey);

      var newValue = node.textContent.trim();
      if (save && newValue && newValue !== originalValue) {
        updateTaskTitleInline(taskId, newValue);
      } else {
        node.textContent = originalValue;
      }
    }

    function onBlur() {
      finish(true);
    }

    function onKey(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    }

    node.addEventListener('blur', onBlur);
    node.addEventListener('keydown', onKey);
  }

  async function updateTaskTitleInline(taskId, newTitle) {
    var item = taskById(taskId);
    if (!item) return;

    var payload = {
      title: newTitle,
      description: item.description || '',
      status: item.status || 'todo',
      priority: item.priority || 'normal',
      assigned_to_id: item.assigned_to_id || '',
      collaborator_ids: item.collaborator_ids || [],
      checklist_items: item.checklist_items || [],
      due_date: item.due_date || '',
    };

    try {
      var data = await ApiClient.post(endpoints.taskUpdate.replace('0', taskId), payload);
      if (data && data.success && data.task) {
        upsertTaskItem(data.task);
        renderTaskBoard();
        notify('Title updated.', 'success');
      } else {
        notify((data && data.message) || 'Failed to update title.', 'error');
        renderTaskBoard();
      }
    } catch (error) {
      notify('Failed to update title.', 'error');
      renderTaskBoard();
    }
  }

  async function createTaskInline(status, title) {
    var normalizedStatus = String(status || 'todo').trim();
    var normalizedTitle = String(title || '').trim();
    if (!normalizedTitle) {
      notify('Card title is required.', 'error');
      return;
    }

    var payload = {
      title: normalizedTitle,
      description: '',
      status: normalizedStatus,
      priority: 'normal',
      assigned_to_id: '',
      collaborator_ids: [],
      checklist_items: [],
      due_date: '',
    };

    try {
      var createData = await ApiClient.post(endpoints.taskCreate, payload);
      if (!createData || !createData.success || !createData.task) {
        notify((createData && createData.message) || 'Failed to create card.', 'error');
        return;
      }
      upsertTaskItem(createData.task);
      renderTaskBoard();
      closeInlineTaskCreator();
      notify('Card created.', 'success');
    } catch (error) {
      notify((error && error.message) || 'Failed to create card.', 'error');
    }
  }

  function renderTaskBoard() {
    if (!ui.taskBoard) {
      return;
    }

    TASK_STATUS_ORDER.forEach(function (status) {
      var listNode = ui.taskBoard.querySelector('[data-list-for="' + status + '"]');
      var countNode = ui.taskBoard.querySelector('[data-count-for="' + status + '"]');
      if (!listNode) {
        return;
      }

      var items = state.taskItems.filter(function (task) {
        return String(task.status || '') === status;
      });

      if (countNode) {
        countNode.textContent = String(items.length);
      }

      if (!items.length) {
        listNode.innerHTML = '<div class="office-task-empty">No cards here yet.</div>';
        return;
      }

      listNode.innerHTML = items.map(renderTaskCard).join('');
    });
  }

  async function loadTasks() {
    try {
      var data = await ApiClient.get(endpoints.tasksList);
      if (!data || !data.success) {
        return;
      }
      state.taskItems = Array.isArray(data.tasks) ? data.tasks : [];
      state.members = Array.isArray(data.members) ? data.members : [];
      sortTasksInPlace();
      if (ui.taskAssignee) {
        ui.taskAssignee.innerHTML = getMemberOptionsHtml(0);
      }
      if (ui.taskCollaborators) {
        ui.taskCollaborators.innerHTML = getMembersOnlyOptionsHtml(0);
      }
      if (ui.taskChecklistAssignee) {
        ui.taskChecklistAssignee.innerHTML = getMembersOnlyOptionsHtml(0);
      }
      renderTaskBoard();
    } catch (error) {
      notify((error && error.message) || 'Failed to load tasks.', 'error');
    }
  }

  function startChatPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
    }
    state.pollTimer = window.setInterval(function () {
      if (!state.activeGroupId) {
        return;
      }
      var nowMs = Date.now();
      var thresholdMs = state.realtimeConnected ? state.chatPollConnectedMs : state.chatPollDisconnectedMs;
      if ((nowMs - Number(state.lastChatSyncAtMs || 0)) < thresholdMs) {
        return;
      }
      loadChat({ forceInitial: false });
    }, 2000);
  }

  function handleRealtimePacket(packet) {
    if (!packet || typeof packet !== 'object') {
      return;
    }

    if (packet.type === 'realtime.state') {
      state.realtimeConnected = packet.status === 'connected';
      if (state.realtimeConnected) {
        syncGroupSubscription();
      }
      return;
    }

    if (packet.type === 'realtime.event' && packet.topic === 'officework.chat' && packet.event === 'officework.chat.message') {
      return;
    }

    if (packet.type === 'realtime.ack' && packet.event === 'officework.chat.send' && packet.item) {
      clearChatEmptyState();
      appendChatMessage(packet.item, { notifyIncoming: false });
      state.lastChatSyncAtMs = Date.now();
      if (state.activeTab === 'chat') {
        ui.chatList.scrollTop = ui.chatList.scrollHeight;
      }
      state.chatLoaded = true;
      return;
    }

    if (packet.type === 'realtime.event' && packet.event === 'officework.chat.groups.refresh') {
      loadGroups({ keepCurrent: true });
      return;
    }

    if (packet.type === 'realtime.event' && packet.event === 'officework.chat.message') {
      var isCurrentGroupTopic = packet.topic === currentGroupTopic();
      var isCurrentUserTopic = packet.topic === currentUserTopic();
      if (!isCurrentGroupTopic && !isCurrentUserTopic) {
        return;
      }
      var item = packet.payload && packet.payload.item;
      if (!item) {
        return;
      }
      var incomingGroupId = Number(item.group_id || 0);
      if (incomingGroupId > 0 && incomingGroupId !== Number(state.activeGroupId || 0)) {
        touchGroupWithMessage(incomingGroupId, item || {});
        sortGroupsByRecentActivity();
        renderGroupList();
        notifyIncomingChatMessage(item || {});
        state.lastChatSyncAtMs = Date.now();
        return;
      }
      clearChatEmptyState();
      appendChatMessage(item, { notifyIncoming: true });
      state.lastChatSyncAtMs = Date.now();
      if (state.activeTab === 'chat') {
        ui.chatList.scrollTop = ui.chatList.scrollHeight;
      }
      state.chatLoaded = true;
      return;
    }

    if (packet.type === 'realtime.event' && packet.event === 'officework.task.created') {
      var createdTask = packet.payload && packet.payload.task;
      if (createdTask && createdTask.id) {
        upsertTaskItem(createdTask);
        renderTaskBoard();
      }
      return;
    }

    if (packet.type === 'realtime.event' && packet.event === 'officework.task.updated') {
      var updatedTask = packet.payload && packet.payload.task;
      if (updatedTask && updatedTask.id) {
        upsertTaskItem(updatedTask);
        if (state.taskCurrentItem && Number(state.taskCurrentItem.id || 0) === Number(updatedTask.id || 0)) {
          state.taskCurrentItem = updatedTask;
          setTaskEditor(updatedTask);
        }
        renderTaskBoard();
      }
      return;
    }

    if (packet.type === 'realtime.event' && packet.event === 'officework.task.deleted') {
      var deletedTaskId = Number(packet.payload && packet.payload.task_id || 0);
      if (deletedTaskId > 0) {
        removeTaskItem(deletedTaskId);
        delete state.taskCommentsByTaskId[deletedTaskId];
        if (deletedTaskId === getTaskEditId()) {
          resetTaskEditor();
        }
        renderTaskBoard();
      }
      return;
    }

    if (packet.type === 'realtime.event' && packet.event === 'officework.task.comment.created') {
      var commentTaskId = Number(packet.payload && packet.payload.task_id || 0);
      var commentItem = packet.payload && packet.payload.comment;
      if (commentTaskId > 0 && commentItem && commentItem.id) {
        appendCommentToTaskCache(commentTaskId, commentItem);
        if (state.taskCurrentItem && Number(state.taskCurrentItem.id || 0) === commentTaskId) {
          renderTaskComments(state.taskCurrentItem);
        }
      }
      return;
    }

    if (packet.type === 'realtime.error' && packet.message) {
      notify(packet.message, 'error');
    }
  }

  function initRealtime() {
    if (!window.AppRealtimeService || !cfg.realtime || !cfg.realtime.wsPath) {
      return;
    }

    window.AppRealtimeService.onMessage(handleRealtimePacket);
    var initialTopics = [currentUserTopic(), currentTasksTopic()].filter(function (topic) {
      return !!topic;
    });

    window.AppRealtimeService.connect({
      wsPath: cfg.realtime.wsPath,
      topics: initialTopics,
    });
  }

  async function sendChatViaApi(text, file) {
    var data;
    var composer = ui.chatForm && ui.chatForm.querySelector('.office-chat-composer');

    if (composer) {
      composer.classList.add('is-loading');
    }

    try {
      if (file) {
        var formData = new FormData();
        formData.append('message', text || '');
        formData.append('group_id', String(state.activeGroupId || ''));
        formData.append('file', file);
        data = await ApiClient.upload(endpoints.chatSend, formData);
      } else {
        data = await ApiClient.post(endpoints.chatSend, {
          message: text,
          group_id: state.activeGroupId,
        });
      }
    } finally {
      if (composer) {
        composer.classList.remove('is-loading');
      }
    }

    if (!data || !data.success || !data.item) {
      notify((data && data.message) || 'Failed to send message.', 'error');
      return false;
    }

    clearChatEmptyState();
    appendChatMessage(data.item, { notifyIncoming: false });
    ui.chatList.scrollTop = ui.chatList.scrollHeight;
    return true;
  }

  function bindTabs() {
    ui.tabButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tabName = btn.getAttribute('data-tab') || 'chat';
        setActiveTab(tabName);
      });
    });
  }

  function bindGroupTools() {
    if (ui.chatGroupsList) {
      ui.chatGroupsList.addEventListener('click', async function (event) {
        var memberRow = event.target && event.target.closest('[data-member-id]');
        if (memberRow) {
          await switchActiveMember(memberRow.getAttribute('data-member-id') || 0);
          return;
        }

        var row = event.target && event.target.closest('[data-group-id]');
        if (!row) {
          return;
        }
        switchActiveGroup(row.getAttribute('data-group-id') || 0);
      });
    }

    if (ui.chatGroupSearch) {
      ui.chatGroupSearch.addEventListener('input', function () {
        renderGroupList();
      });
    }

    if (ui.createGroupBtn) {
      ui.createGroupBtn.addEventListener('click', createGroupFlow);
    }
  }

  function bindAttachmentTools() {
    if (ui.chatAttachBtn && ui.chatFileInput) {
      ui.chatAttachBtn.addEventListener('click', function () {
        ui.chatFileInput.click();
      });
      ui.chatFileInput.addEventListener('change', function () {
        var file = ui.chatFileInput.files && ui.chatFileInput.files[0];
        setPendingAttachment(file || null);
      });
    }

    if (ui.chatAttachmentRemove) {
      ui.chatAttachmentRemove.addEventListener('click', function () {
        setPendingAttachment(null);
      });
    }

    if (ui.chatInput) {
      ui.chatInput.addEventListener('paste', function (event) {
        var clipboard = event.clipboardData;
        if (!clipboard || !clipboard.items) {
          return;
        }

        var pickedFile = null;
        for (var i = 0; i < clipboard.items.length; i += 1) {
          var item = clipboard.items[i];
          if (item && item.kind === 'file') {
            pickedFile = item.getAsFile();
            if (pickedFile) {
              break;
            }
          }
        }

        if (pickedFile) {
          event.preventDefault();
          setPendingAttachment(pickedFile);
          notify('Attachment pasted. Ready to send.', 'success');
        }
      });
    }
  }

  function bindChatForm() {
    if (!ui.chatForm) {
      return;
    }
    ui.chatForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var text = String(ui.chatInput.value || '').trim();
      var hasFile = !!state.pendingAttachment;

      if (!state.activeGroupId) {
        notify('Select a chat first.', 'error');
        return;
      }

      if (!text && !hasFile) {
        notify('Please write a message or attach a file first.', 'error');
        return;
      }

      try {
        var sentBySocket = false;
        if (!hasFile && window.AppRealtimeService && window.AppRealtimeService.isConnected()) {
          sentBySocket = window.AppRealtimeService.send('officework.chat.send', {
            message: text,
            group_id: state.activeGroupId,
          });
        }

        if (sentBySocket) {
          ui.chatInput.value = '';
          setPendingAttachment(null);
          return;
        }

        var sentByApi = await sendChatViaApi(text, state.pendingAttachment);
        if (sentByApi) {
          ui.chatInput.value = '';
          setPendingAttachment(null);
        }
      } catch (error) {
        notify((error && error.message) || 'Failed to send message.', 'error');
      }
    });

    if (ui.chatInput) {
      ui.chatInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (typeof ui.chatForm.requestSubmit === 'function') {
            ui.chatForm.requestSubmit();
          } else {
            ui.chatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        }
      });
    }
  }

  async function persistTaskStatus(taskId, nextStatus) {
    var url = endpoints.taskUpdateBase + encodeURIComponent(taskId) + '/update/';
    var data = await ApiClient.post(url, { status: nextStatus });
    if (!data || !data.success || !data.task) {
      throw new Error((data && data.message) || 'Failed to move task.');
    }
    if (data.message) {
      notify(data.message, 'info');
    }
    return data.task;
  }

  async function updateTaskById(taskId, payload) {
    var url = endpoints.taskUpdateBase + encodeURIComponent(taskId) + '/update/';
    var data = await ApiClient.post(url, payload || {});
    if (!data || !data.success || !data.task) {
      throw new Error((data && data.message) || 'Failed to update task.');
    }
    upsertTaskItem(data.task);
    if (state.taskCurrentItem && Number(state.taskCurrentItem.id || 0) === Number(data.task.id || 0)) {
      state.taskCurrentItem = data.task;
      setTaskEditor(data.task);
    }
    renderTaskBoard();
    if (data.message) {
      notify(data.message, 'success');
    }
    return data.task;
  }

  async function deleteTaskById(taskId) {
    var url = endpoints.taskUpdateBase + encodeURIComponent(taskId) + '/delete/';
    var data = await ApiClient.post(url, {});
    if (!data || !data.success) {
      throw new Error((data && data.message) || 'Failed to delete task.');
    }
  }

  async function moveTaskToStatus(taskId, targetStatus) {
    var item = taskById(taskId);
    if (!item || !targetStatus || item.status === targetStatus) {
      return;
    }

    var previousStatus = item.status;
    item.status = targetStatus;
    item.updated_at = new Date().toISOString();
    renderTaskBoard();

    try {
      var saved = await persistTaskStatus(taskId, targetStatus);
      upsertTaskItem(saved);
      if (state.taskCurrentItem && Number(state.taskCurrentItem.id || 0) === Number(saved.id || 0)) {
        state.taskCurrentItem = saved;
      }
      renderTaskBoard();
    } catch (error) {
      item.status = previousStatus;
      renderTaskBoard();
      notify((error && error.message) || 'Failed to move task.', 'error');
    }
  }

  function setTaskModalOpen(open) {
    if (!ui.taskModal || !ui.taskModalBackdrop) {
      return;
    }
    state.taskModalOpen = !!open;
    ui.taskModal.hidden = !open;
    ui.taskModalBackdrop.hidden = !open;
  }

  function closeTaskModal() {
    setTaskModalOpen(false);
    if (ui.taskModal) {
      ui.taskModal.classList.remove('is-edit-mode');
    }
    resetTaskEditor();
  }

  function openTaskCreateModal(status) {
    closeInlineTaskCreator();
    resetTaskEditor();
    if (ui.taskModal) {
      ui.taskModal.classList.remove('is-edit-mode');
    }
    if (ui.taskStatus) {
      ui.taskStatus.value = String(status || 'todo');
      ui.taskStatus.disabled = true;
    }
    setTaskModalOpen(true);
    if (ui.taskTitle && typeof ui.taskTitle.focus === 'function') {
      ui.taskTitle.focus();
    }
  }

  function openTaskEditModal(item) {
    closeInlineTaskCreator();
    resetTaskEditor();
    if (ui.taskModal) {
      ui.taskModal.classList.add('is-edit-mode');
    }
    setTaskEditor(item);
    setTaskModalOpen(true);
  }

  function buildTaskFormPayload() {
    return {
      title: String(ui.taskTitle && ui.taskTitle.value || '').trim(),
      description: String(ui.taskDescription && ui.taskDescription.value || '').trim(),
      status: String(ui.taskStatus && ui.taskStatus.value || 'todo').trim(),
      priority: String(ui.taskPriority && ui.taskPriority.value || 'normal').trim(),
      assigned_to_id: String(ui.taskAssignee && ui.taskAssignee.value || '').trim(),
      collaborator_ids: getSelectedCollaboratorIds(),
      checklist_items: Array.isArray(state.taskCurrentItem && state.taskCurrentItem.checklist_items)
        ? state.taskCurrentItem.checklist_items
        : [],
      due_date: String(ui.taskDueDate && ui.taskDueDate.value || '').trim(),
    };
  }

  function appendCommentToTaskCache(taskId, comment) {
    var id = Number(taskId || 0);
    if (id <= 0 || !comment || !comment.id) {
      return;
    }
    if (!Array.isArray(state.taskCommentsByTaskId[id])) {
      state.taskCommentsByTaskId[id] = [];
    }
    var exists = state.taskCommentsByTaskId[id].some(function (item) {
      return Number(item.id || 0) === Number(comment.id || 0);
    });
    if (!exists) {
      state.taskCommentsByTaskId[id].push(comment);
    }
  }

  async function sendTaskComment(taskId) {
    var id = Number(taskId || 0);
    if (id <= 0) {
      return;
    }
    var text = String(ui.taskCommentInput && ui.taskCommentInput.value || '').trim();
    var file = state.taskPendingCommentFile;
    if (!text && !file) {
      notify('Write a message or attach a file first.', 'error');
      return;
    }

    var data;
    if (file) {
      var formData = new FormData();
      formData.append('message', text);
      formData.append('file', file);
      data = await ApiClient.upload(taskCommentCreateEndpoint(id), formData);
    } else {
      data = await ApiClient.post(taskCommentCreateEndpoint(id), { message: text });
    }

    if (!data || !data.success || !data.comment) {
      notify((data && data.message) || 'Failed to send comment.', 'error');
      return;
    }

    appendCommentToTaskCache(id, data.comment);
    if (ui.taskCommentInput) {
      ui.taskCommentInput.value = '';
    }
    resetTaskCommentAttachment();
    if (state.taskCurrentItem && Number(state.taskCurrentItem.id || 0) === id) {
      renderTaskComments(state.taskCurrentItem);
    }
    notify('Comment posted.', 'success');
  }

  async function addChecklistItemFromForm() {
    var taskId = getTaskEditId();
    if (taskId <= 0) {
      notify('Save the card first, then add checklist items.', 'error');
      return;
    }
    var item = state.taskCurrentItem;
    if (!item) {
      return;
    }
    var title = String(ui.taskChecklistInput && ui.taskChecklistInput.value || '').trim();
    if (!title) {
      notify('Checklist item title is required.', 'error');
      return;
    }
    var assigneeId = Number(ui.taskChecklistAssignee && ui.taskChecklistAssignee.value || 0);
    var checklist = Array.isArray(item.checklist_items) ? item.checklist_items.slice() : [];
    checklist.push({
      id: 'local_' + String(Date.now()) + '_' + String(Math.floor(Math.random() * 10000)),
      title: title,
      assigned_to_id: assigneeId > 0 ? assigneeId : null,
      is_done: false,
    });
    try {
      await updateTaskById(taskId, { checklist_items: checklist });
      if (ui.taskChecklistInput) {
        ui.taskChecklistInput.value = '';
      }
      if (ui.taskChecklistAssignee) {
        ui.taskChecklistAssignee.value = '';
      }
    } catch (error) {
      notify((error && error.message) || 'Failed to add checklist item.', 'error');
    }
  }

  async function toggleChecklistItem(checklistId, nextDone) {
    var taskId = getTaskEditId();
    if (taskId <= 0 || !state.taskCurrentItem) {
      return;
    }
    var checklist = Array.isArray(state.taskCurrentItem.checklist_items) ? state.taskCurrentItem.checklist_items.slice() : [];
    var updated = checklist.map(function (item) {
      if (String(item && item.id || '') !== String(checklistId || '')) {
        return item;
      }
      var next = Object.assign({}, item);
      next.is_done = !!nextDone;
      return next;
    });
    try {
      await updateTaskById(taskId, { checklist_items: updated });
    } catch (error) {
      notify((error && error.message) || 'Failed to update checklist item.', 'error');
    }
  }

  async function removeChecklistItem(checklistId) {
    var taskId = getTaskEditId();
    if (taskId <= 0 || !state.taskCurrentItem) {
      return;
    }
    var checklist = Array.isArray(state.taskCurrentItem.checklist_items) ? state.taskCurrentItem.checklist_items : [];
    var updated = checklist.filter(function (item) {
      return String(item && item.id || '') !== String(checklistId || '');
    });
    try {
      await updateTaskById(taskId, { checklist_items: updated });
    } catch (error) {
      notify((error && error.message) || 'Failed to remove checklist item.', 'error');
    }
  }

  function bindTaskForm() {
    if (!ui.taskForm) {
      return;
    }

    ui.taskForm.addEventListener('submit', async function (event) {
      event.preventDefault();

      var payload = buildTaskFormPayload();

      if (!payload.title) {
        notify('Card title is required.', 'error');
        return;
      }

      var editingId = getTaskEditId();

      try {
        if (editingId > 0) {
          var updatedTask = await updateTaskById(editingId, payload);
          if (updatedTask) {
            closeTaskModal();
          }
          return;
        }

        var createData = await ApiClient.post(endpoints.taskCreate, payload);
        if (!createData || !createData.success || !createData.task) {
          notify((createData && createData.message) || 'Failed to create card.', 'error');
          return;
        }
        upsertTaskItem(createData.task);
        renderTaskBoard();
        state.taskCurrentItem = createData.task;
        closeTaskModal();
        notify('Card created.', 'success');
      } catch (error) {
        notify((error && error.message) || 'Failed to save card.', 'error');
      }
    });

    ui.taskForm.addEventListener('click', function (event) {
      var quickBtn = event.target.closest('[data-task-focus]');
      if (!quickBtn) {
        return;
      }
      var targetId = quickBtn.getAttribute('data-task-focus') || '';
      if (!targetId) {
        return;
      }
      var target = document.getElementById(targetId);
      if (!target || typeof target.focus !== 'function') {
        return;
      }
      target.focus();
      if (typeof target.select === 'function' && target.tagName === 'INPUT') {
        target.select();
      }
    });

    if (ui.taskCancelBtn) {
      ui.taskCancelBtn.addEventListener('click', function () {
        closeTaskModal();
      });
    }

    if (ui.taskModalClose) {
      ui.taskModalClose.addEventListener('click', function () {
        closeTaskModal();
      });
    }

    if (ui.taskModalBackdrop) {
      ui.taskModalBackdrop.addEventListener('click', function () {
        closeTaskModal();
      });
    }

    if (ui.taskDeleteBtn) {
      ui.taskDeleteBtn.addEventListener('click', async function () {
        var taskId = getTaskEditId();
        if (taskId <= 0) {
          return;
        }
        if (!window.confirm('Delete this card?')) {
          return;
        }

        try {
          await deleteTaskById(taskId);
          removeTaskItem(taskId);
          renderTaskBoard();
          closeTaskModal();
          notify('Card deleted.', 'success');
        } catch (error) {
          notify((error && error.message) || 'Failed to delete card.', 'error');
        }
      });
    }

    if (ui.taskChecklistAddBtn) {
      ui.taskChecklistAddBtn.addEventListener('click', function () {
        addChecklistItemFromForm();
      });
    }

    if (ui.taskChecklistItems) {
      ui.taskChecklistItems.addEventListener('change', function (event) {
        var toggle = event.target.closest('.office-task-checklist-toggle');
        if (!toggle) {
          return;
        }
        var row = toggle.closest('[data-checklist-id]');
        if (!row) {
          return;
        }
        toggleChecklistItem(row.getAttribute('data-checklist-id') || '', !!toggle.checked);
      });

      ui.taskChecklistItems.addEventListener('click', function (event) {
        var removeBtn = event.target.closest('[data-action="remove-checklist-item"]');
        if (!removeBtn) {
          return;
        }
        var row = removeBtn.closest('[data-checklist-id]');
        if (!row) {
          return;
        }
        removeChecklistItem(row.getAttribute('data-checklist-id') || '');
      });
    }

    if (ui.taskApproveBtn) {
      ui.taskApproveBtn.addEventListener('click', async function () {
        var taskId = getTaskEditId();
        if (taskId <= 0) {
          return;
        }
        try {
          await updateTaskById(taskId, { approval_decision: 'approve' });
        } catch (error) {
          notify((error && error.message) || 'Failed to approve completion.', 'error');
        }
      });
    }

    if (ui.taskRejectBtn) {
      ui.taskRejectBtn.addEventListener('click', async function () {
        var taskId = getTaskEditId();
        if (taskId <= 0) {
          return;
        }
        try {
          await updateTaskById(taskId, { approval_decision: 'reject' });
        } catch (error) {
          notify((error && error.message) || 'Failed to send card back.', 'error');
        }
      });
    }

    if (ui.taskCommentAttachBtn && ui.taskCommentFileInput) {
      ui.taskCommentAttachBtn.addEventListener('click', function () {
        if (ui.taskCommentAttachBtn.disabled) {
          return;
        }
        ui.taskCommentFileInput.click();
      });
      ui.taskCommentFileInput.addEventListener('change', function () {
        var file = ui.taskCommentFileInput.files && ui.taskCommentFileInput.files[0];
        setTaskCommentAttachment(file || null);
      });
    }

    if (ui.taskCommentAttachmentRemove) {
      ui.taskCommentAttachmentRemove.addEventListener('click', function () {
        resetTaskCommentAttachment();
      });
    }

    if (ui.taskCommentInput) {
      ui.taskCommentInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
      });

      ui.taskCommentInput.addEventListener('paste', function (event) {
        if (ui.taskCommentInput.disabled) {
          return;
        }
        var clipboard = event.clipboardData;
        if (!clipboard || !clipboard.items) {
          return;
        }
        var pickedFile = null;
        for (var i = 0; i < clipboard.items.length; i += 1) {
          var item = clipboard.items[i];
          if (item && item.kind === 'file') {
            pickedFile = item.getAsFile();
            if (pickedFile) {
              break;
            }
          }
        }
        if (pickedFile) {
          event.preventDefault();
          setTaskCommentAttachment(pickedFile);
          notify('Attachment pasted. Ready to send.', 'success');
        }
      });
    }

    if (ui.taskCommentSendBtn) {
      ui.taskCommentSendBtn.addEventListener('click', function () {
        var taskId = getTaskEditId();
        if (taskId <= 0) {
          notify('Save the card first to start discussion.', 'error');
          return;
        }
        sendTaskComment(taskId);
      });
    }

    if (ui.taskBoard) {
      ui.taskBoard.addEventListener('click', function (event) {
        var addBtn = event.target.closest('[data-add-task-status]');
        if (addBtn) {
          openInlineTaskCreator(addBtn.getAttribute('data-add-task-status') || 'todo');
          return;
        }

        var saveInlineBtn = event.target.closest('[data-action="save-inline-task"]');
        if (saveInlineBtn) {
          var status = saveInlineBtn.getAttribute('data-inline-status') || 'todo';
          var wrap = saveInlineBtn.closest('.office-kanban-inline-create');
          var input = wrap && wrap.querySelector('[data-inline-title-input]');
          createTaskInline(status, input && input.value);
          return;
        }

        if (cancelInlineBtn) {
          closeInlineTaskCreator();
          return;
        }

        var editTrigger = event.target.closest('.office-task-edit-trigger');
        if (editTrigger) {
          var card = editTrigger.closest('.office-task-card');
          var tid = Number(card.getAttribute('data-task-id') || 0);
          var item = taskById(tid);
          if (item) {
            openTaskEditModal(item);
          }
          return;
        }

        var titleNode = event.target.closest('.office-task-card-title');
        if (titleNode && !titleNode.classList.contains('is-editing')) {
          startInlineTaskTitleEdit(titleNode);
          return;
        }

        if (event.target.closest('.office-task-card[data-task-id]')) {
          return;
        }
      });

      ui.taskBoard.addEventListener('dblclick', function (event) {
        var cardNode = event.target.closest('.office-task-card[data-task-id]');
        if (!cardNode) {
          return;
        }
        var taskId = Number(cardNode.getAttribute('data-task-id') || 0);
        if (taskId <= 0) {
          return;
        }
        var item = taskById(taskId);
        if (item) {
          openTaskEditModal(item);
        }
      });

      ui.taskBoard.addEventListener('keydown', function (event) {
        var input = event.target.closest('[data-inline-title-input]');
        if (!input) {
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          createTaskInline(input.getAttribute('data-inline-title-input') || 'todo', input.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeInlineTaskCreator();
        }
      });

      ui.taskBoard.addEventListener('dragstart', function (event) {
        var cardNode = event.target.closest('.office-task-card[data-task-id]');
        if (!cardNode) {
          return;
        }
        var taskId = Number(cardNode.getAttribute('data-task-id') || 0);
        if (taskId <= 0) {
          return;
        }
        state.taskDragId = taskId;
        cardNode.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(taskId));
        }
      });

      ui.taskBoard.addEventListener('dragend', function (event) {
        var cardNode = event.target.closest('.office-task-card[data-task-id]');
        if (cardNode) {
          cardNode.classList.remove('is-dragging');
        }
        state.taskDragId = 0;
        ui.taskColumns.forEach(function (column) {
          column.classList.remove('is-drop-target');
        });
      });

      ui.taskBoard.addEventListener('dragover', function (event) {
        var column = event.target.closest('.office-kanban-column[data-status]');
        if (!column) {
          return;
        }
        event.preventDefault();
        column.classList.add('is-drop-target');
      });

      ui.taskBoard.addEventListener('dragleave', function (event) {
        var column = event.target.closest('.office-kanban-column[data-status]');
        if (!column) {
          return;
        }
        column.classList.remove('is-drop-target');
      });

      ui.taskBoard.addEventListener('drop', function (event) {
        var column = event.target.closest('.office-kanban-column[data-status]');
        if (!column) {
          return;
        }
        event.preventDefault();
        column.classList.remove('is-drop-target');

        var targetStatus = String(column.getAttribute('data-status') || '').trim();
        if (!targetStatus) {
          return;
        }

        var taskId = state.taskDragId;
        if (!taskId && event.dataTransfer) {
          taskId = Number(event.dataTransfer.getData('text/plain') || 0);
        }
        if (taskId > 0) {
          moveTaskToStatus(taskId, targetStatus);
        }
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.taskModalOpen) {
        closeTaskModal();
      }
    });
  }

  async function init() {
    var routeIntent = parseRouteIntent();

    bootstrapDesktopNotificationPermission();
    bindTabs();
    bindGroupTools();
    bindAttachmentTools();
    bindChatForm();
    bindTaskForm();
    resetTaskEditor();
    setActiveTab(routeIntent.tab || 'chat');
    updateChatCountPill();
    initRealtime();
 
    await loadGroups({ keepCurrent: true });

    if (Number(routeIntent.groupId || 0) > 0) {
      var targetGroupId = Number(routeIntent.groupId || 0);
      var hasTargetGroup = state.groups.some(function (group) {
        return Number(group.id || 0) === targetGroupId;
      });
      if (hasTargetGroup) {
        state.activeGroupId = targetGroupId;
        state.activeChatMemberId = inferMemberIdForGroup(activeGroupItem());
        persistRouteState('chat', targetGroupId);
        syncGroupSubscription();
        renderGroupOptions();
      }
    }

    resetChatState();

    await Promise.all([
      loadChat({ forceInitial: true }),
      loadTasks(),
    ]);

    startChatPolling();
  }

  init();
  return true;
  }

  function attemptStartOfficeWork() {
    officeWorkBoot.attempts += 1;

    if (startOfficeWorkApp()) {
      return;
    }
    if (officeWorkBoot.attempts >= 50) {
      return;
    }
    window.setTimeout(attemptStartOfficeWork, 100);
  }

  attemptStartOfficeWork();
})();
