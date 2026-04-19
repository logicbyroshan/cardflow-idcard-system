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
    previousGroupId: 0,
    groups: [],
    availableMembers: [],
    canManageGroups: !!cfg.canManageGroups,
    chatLastId: 0,
    chatCount: 0,
    chatMessageIds: {},
    pendingAttachment: null,
    subscribedGroupTopic: '',
    realtimeConnected: false,
    members: [],
    taskItems: [],
    taskDragId: 0,
    fileItems: [],
    pollTimer: null,
    chatLoaded: false,
    chatLoadInFlight: false,
    chatLoadPending: false,
    chatLoadPendingForceInitial: false,
    lastChatSyncAtMs: 0,
    chatPollConnectedMs: 12000,
    chatPollDisconnectedMs: 4000,
  };

  var ui = {
    tabButtons: Array.prototype.slice.call(document.querySelectorAll('.office-tab-btn')),
    panels: Array.prototype.slice.call(document.querySelectorAll('.office-panel')),
    chatList: document.getElementById('officeChatList'),
    chatCountPill: document.getElementById('officeChatCountPill'),
    chatGroupSelect: document.getElementById('officeChatGroupSelect'),
    chatGroupSearch: document.getElementById('officeChatGroupSearch'),
    chatGroupsList: document.getElementById('officeChatGroupsList'),
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
    taskAssignee: document.getElementById('officeTaskAssignee'),
    taskPriority: document.getElementById('officeTaskPriority'),
    taskDueDate: document.getElementById('officeTaskDueDate'),
    taskFormHeading: document.getElementById('officeTaskFormHeading'),
    taskEditId: document.getElementById('officeTaskEditId'),
    taskSubmitBtn: document.getElementById('officeTaskSubmitBtn'),
    taskCancelBtn: document.getElementById('officeTaskCancelBtn'),
    taskDeleteBtn: document.getElementById('officeTaskDeleteBtn'),
    taskBoard: document.getElementById('officeTaskBoard'),
    taskColumns: Array.prototype.slice.call(document.querySelectorAll('.office-kanban-column[data-status]')),
    shareForm: document.getElementById('officeShareForm'),
    shareTitle: document.getElementById('officeShareTitle'),
    shareFile: document.getElementById('officeShareFile'),
    shareNote: document.getElementById('officeShareNote'),
    shareTableBody: document.querySelector('#officeShareTable tbody'),
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
    var members = memberListForGroup(group);
    if (!members.length) {
      return 'No members added yet';
    }
    var names = members.slice(0, 3).map(function (member) {
      return member && member.name ? String(member.name) : 'Member';
    });
    if (members.length > 3) {
      names.push('+' + String(members.length - 3) + ' more');
    }
    return names.join(', ');
  }

  function updateActiveGroupHeader() {
    var group = activeGroupItem();

    if (ui.chatActiveGroupName) {
      ui.chatActiveGroupName.textContent = group ? String(group.name || 'Team Message') : 'Team Message';
    }

    if (ui.chatActiveGroupMeta) {
      if (!group) {
        ui.chatActiveGroupMeta.textContent = 'Select a group to start messaging.';
      } else {
        ui.chatActiveGroupMeta.textContent = String(groupMemberCount(group)) + ' members';
      }
    }

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
    var visibleGroups = state.groups.filter(function (group) {
      if (!query) {
        return true;
      }

      if (String(group.name || '').toLowerCase().indexOf(query) >= 0) {
        return true;
      }

      return memberListForGroup(group).some(function (member) {
        var name = String(member && member.name || '').toLowerCase();
        var role = String(member && member.role_display || member && member.role || '').toLowerCase();
        return name.indexOf(query) >= 0 || role.indexOf(query) >= 0;
      });
    });

    if (!visibleGroups.length) {
      ui.chatGroupsList.innerHTML = '<div class="client-message-thread-state">No groups found.</div>';
      return;
    }

    ui.chatGroupsList.innerHTML = visibleGroups.map(function (group) {
      var groupId = Number(group.id || 0);
      var isActive = groupId === Number(state.activeGroupId || 0);
      var rowClass = isActive ? 'office-chat-group-row is-active' : 'office-chat-group-row';
      return '' +
        '<div class="' + rowClass + '" data-group-id="' + escapeHtml(groupId) + '">' +
        '  <div class="office-chat-group-row-head">' +
        '    <span class="office-chat-group-row-title">' + escapeHtml(group.name || 'Unnamed Group') + '</span>' +
        '    <span class="office-chat-group-row-count">' + escapeHtml(groupMemberCount(group)) + '</span>' +
        '  </div>' +
        '  <div class="office-chat-group-row-sub">' + escapeHtml(groupSubtitle(group)) + '</div>' +
        '</div>';
    }).join('');
  }

  function switchActiveGroup(nextGroupId) {
    var parsedId = Number(nextGroupId || 0);
    if (parsedId <= 0 || parsedId === Number(state.activeGroupId || 0)) {
      return;
    }

    state.previousGroupId = Number(state.activeGroupId || 0);
    state.activeGroupId = parsedId;
    if (ui.chatGroupSelect) {
      ui.chatGroupSelect.value = String(parsedId);
    }
    syncGroupSubscription();
    renderGroupList();
    updateActiveGroupHeader();
    resetChatState();
    loadChat({ forceInitial: true });
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

  function appendChatMessage(item) {
    var itemId = Number(item && item.id || 0);
    if (rememberChatId(itemId)) {
      return;
    }

    var isSelf = Number(item.sender_id || 0) === Number(cfg.currentUserId || 0);
    var row = document.createElement('article');
    row.className = isSelf ? 'client-message-row office-chat-row-self' : 'client-message-row';
    row.innerHTML = '' +
      '<div class="client-message-bubble">' +
      '  <div class="client-message-bubble-head">' +
      '    <span class="client-message-sender">' + escapeHtml(item.sender_name || 'Unknown') + '</span>' +
      '    <span class="client-message-time">' + escapeHtml(formatDateTime(item.created_at)) + '</span>' +
      '  </div>' +
      '  <div class="client-message-text">' + escapeHtml(item.message || '') + '</div>' +
      '  <div class="client-message-meta">' +
      '    <span class="client-message-chip scope">' + escapeHtml(formatRoleLabel(item.sender_role)) + '</span>' +
      (isSelf ? '    <span class="client-message-chip read">You</span>' : '') +
      '  </div>' +
      (item.attachment ? (
        '  <a class="office-chat-file-link" href="' + escapeHtml(item.attachment.download_url || '#') + '">' +
        '    <i class="fa-solid fa-file-arrow-down"></i>' +
        '    <span>' + escapeHtml(item.attachment.name || 'Attachment') + '</span>' +
        '    <span>(' + escapeHtml(formatBytes(item.attachment.size_bytes || 0)) + ')</span>' +
        '  </a>'
      ) : '') +
      '</div>' +
      '';
    ui.chatList.appendChild(row);
    state.chatCount += 1;
    if (itemId > state.chatLastId) {
      state.chatLastId = itemId;
    }
    updateChatCountPill();
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
    empty.textContent = 'No chat yet. Start the conversation.';
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
        appendChatMessage(item);
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
      if (ui.chatGroupSelect) {
        ui.chatGroupSelect.innerHTML = '<option value="">No groups</option>';
        ui.chatGroupSelect.disabled = true;
      }
      state.activeGroupId = 0;
      renderGroupList();
      updateActiveGroupHeader();
      return;
    }

    if (ui.chatGroupSelect) {
      ui.chatGroupSelect.disabled = false;
      ui.chatGroupSelect.innerHTML = state.groups.map(function (group) {
        var selected = Number(group.id) === Number(state.activeGroupId) ? ' selected' : '';
        return '<option value="' + escapeHtml(group.id) + '"' + selected + '>' + escapeHtml(group.name) + '</option>';
      }).join('');
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
    if (ui.chatAttachmentName) {
      ui.chatAttachmentName.textContent = String(file.name || 'Attachment') + ' (' + formatBytes(sizeBytes) + ')';
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
      'Enter member IDs separated by commas.\\n\\nAvailable members:\\n' + helperRows,
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

  var TASK_STATUS_META = {
    todo: { label: 'To Do' },
    in_progress: { label: 'In Progress' },
    done: { label: 'Done' },
  };

  var TASK_PRIORITY_META = {
    low: { label: 'Low' },
    normal: { label: 'Normal' },
    high: { label: 'High' },
  };

  function currentTasksTopic() {
    return String((cfg.realtime && cfg.realtime.tasksTopic) || 'officework.tasks').trim();
  }

  function currentShareTopic() {
    return String((cfg.realtime && cfg.realtime.shareTopic) || 'officework.share').trim();
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

  function resetTaskEditor() {
    if (!ui.taskForm) {
      return;
    }
    ui.taskForm.reset();
    if (ui.taskPriority) {
      ui.taskPriority.value = 'normal';
    }
    if (ui.taskEditId) {
      ui.taskEditId.value = '';
    }
    if (ui.taskFormHeading) {
      ui.taskFormHeading.innerHTML = '<i class="fa-solid fa-plus"></i> Create Card';
    }
    if (ui.taskSubmitBtn) {
      ui.taskSubmitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Card';
    }
    if (ui.taskCancelBtn) {
      ui.taskCancelBtn.hidden = true;
    }
    if (ui.taskDeleteBtn) {
      ui.taskDeleteBtn.hidden = true;
    }
  }

  function setTaskEditor(item) {
    if (!item || !ui.taskForm) {
      return;
    }
    if (ui.taskEditId) {
      ui.taskEditId.value = String(item.id || '');
    }
    if (ui.taskTitle) {
      ui.taskTitle.value = String(item.title || '');
    }
    if (ui.taskDescription) {
      ui.taskDescription.value = String(item.description || '');
    }
    if (ui.taskPriority) {
      ui.taskPriority.value = String(item.priority || 'normal');
    }
    if (ui.taskAssignee) {
      ui.taskAssignee.value = item.assigned_to_id ? String(item.assigned_to_id) : '';
    }
    if (ui.taskDueDate) {
      ui.taskDueDate.value = String(item.due_date || '');
    }
    if (ui.taskFormHeading) {
      ui.taskFormHeading.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Edit Card #' + escapeHtml(item.id) + '';
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
    if (ui.taskTitle && typeof ui.taskTitle.focus === 'function') {
      ui.taskTitle.focus();
    }
  }

  function renderTaskCard(task) {
    var priority = String(task.priority || 'normal').toLowerCase();
    var priorityMeta = TASK_PRIORITY_META[priority] || TASK_PRIORITY_META.normal;
    var statusMeta = TASK_STATUS_META[String(task.status || '').toLowerCase()] || TASK_STATUS_META.todo;
    var description = truncateTaskDescription(task.description || '');

    return '' +
      '<article class="office-task-card" draggable="true" data-task-id="' + escapeHtml(task.id) + '">' +
      '  <div class="office-task-card-head">' +
      '    <h5 class="office-task-card-title">' + escapeHtml(task.title || 'Untitled Task') + '</h5>' +
      '    <span class="office-task-chip priority-' + escapeHtml(priority) + '">' + escapeHtml(priorityMeta.label) + '</span>' +
      '  </div>' +
      (description ? '  <p class="office-task-card-desc">' + escapeHtml(description) + '</p>' : '') +
      '  <div class="office-task-card-meta">' +
      '    <span><i class="fa-solid fa-user"></i> ' + escapeHtml(task.assigned_to_name || 'Unassigned') + '</span>' +
      '    <span><i class="fa-regular fa-calendar"></i> ' + escapeHtml(task.due_date || 'No due date') + '</span>' +
      '  </div>' +
      '  <div class="office-task-card-footer">' +
      '    <span class="office-task-chip">' + escapeHtml(statusMeta.label) + '</span>' +
      '    <button type="button" class="btn btn-sm btn-neutral" data-action="edit-task">Edit</button>' +
      '  </div>' +
      '</article>';
  }

  function renderTaskBoard() {
    if (!ui.taskBoard) {
      return;
    }

    ['todo', 'in_progress', 'done'].forEach(function (status) {
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
        listNode.innerHTML = '<div class="office-task-empty">Drop a card here.</div>';
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
      renderTaskBoard();
    } catch (error) {
      notify((error && error.message) || 'Failed to load tasks.', 'error');
    }
  }

  function renderShareRows() {
    if (!ui.shareTableBody) {
      return;
    }
    if (!state.fileItems.length) {
      ui.shareTableBody.innerHTML = '<tr><td colspan="6">No shared files yet.</td></tr>';
      return;
    }

    var rows = state.fileItems.map(function (item) {
      return '' +
        '<tr data-file-id="' + escapeHtml(item.id) + '">' +
        '  <td>' + escapeHtml(item.title || '-') + '</td>' +
        '  <td><a href="' + escapeHtml(item.download_url || '#') + '">' + escapeHtml(item.original_name || '-') + '</a></td>' +
        '  <td>' + escapeHtml(formatBytes(item.size_bytes)) + '</td>' +
        '  <td>' + escapeHtml(item.uploaded_by_name || '-') + '</td>' +
        '  <td>' + escapeHtml(formatDateTime(item.created_at)) + '</td>' +
        '  <td><button type="button" class="btn btn-sm btn-danger" data-action="delete-file">Delete</button></td>' +
        '</tr>';
    });

    ui.shareTableBody.innerHTML = rows.join('');
  }

  async function loadSharedFiles() {
    try {
      var data = await ApiClient.get(endpoints.shareList);
      if (!data || !data.success) {
        return;
      }
      state.fileItems = Array.isArray(data.files) ? data.files : [];
      renderShareRows();
    } catch (error) {
      notify((error && error.message) || 'Failed to load shared files.', 'error');
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
      appendChatMessage(packet.item);
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
      if (Number(item.group_id || 0) > 0 && Number(state.activeGroupId || 0) > 0 && Number(item.group_id) !== Number(state.activeGroupId)) {
        return;
      }
      clearChatEmptyState();
      appendChatMessage(item);
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
        renderTaskBoard();
      }
      return;
    }

    if (packet.type === 'realtime.event' && packet.event === 'officework.task.deleted') {
      var deletedTaskId = Number(packet.payload && packet.payload.task_id || 0);
      if (deletedTaskId > 0) {
        removeTaskItem(deletedTaskId);
        if (deletedTaskId === getTaskEditId()) {
          resetTaskEditor();
        }
        renderTaskBoard();
      }
      return;
    }

    if (packet.type === 'realtime.event' && packet.event === 'officework.share.uploaded') {
      loadSharedFiles();
      return;
    }

    if (packet.type === 'realtime.event' && packet.event === 'officework.share.deleted') {
      loadSharedFiles();
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
    var initialTopics = [currentUserTopic(), currentTasksTopic(), currentShareTopic()].filter(function (topic) {
      return !!topic;
    });

    window.AppRealtimeService.connect({
      wsPath: cfg.realtime.wsPath,
      topics: initialTopics,
    });
  }

  async function sendChatViaApi(text, file) {
    var data;
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

    if (!data || !data.success || !data.item) {
      notify((data && data.message) || 'Failed to send message.', 'error');
      return false;
    }

    clearChatEmptyState();
    appendChatMessage(data.item);
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
    if (ui.chatGroupSelect) {
      ui.chatGroupSelect.addEventListener('change', function () {
        switchActiveGroup(ui.chatGroupSelect.value || 0);
      });
    }

    if (ui.chatGroupsList) {
      ui.chatGroupsList.addEventListener('click', function (event) {
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
        notify('Select a group first.', 'error');
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
  }

  async function persistTaskStatus(taskId, nextStatus) {
    var url = endpoints.taskUpdateBase + encodeURIComponent(taskId) + '/update/';
    var data = await ApiClient.post(url, { status: nextStatus });
    if (!data || !data.success || !data.task) {
      throw new Error((data && data.message) || 'Failed to move task.');
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
      renderTaskBoard();
    } catch (error) {
      item.status = previousStatus;
      renderTaskBoard();
      notify((error && error.message) || 'Failed to move task.', 'error');
    }
  }

  function bindTaskForm() {
    if (!ui.taskForm) {
      return;
    }

    ui.taskForm.addEventListener('submit', async function (event) {
      event.preventDefault();

      var payload = {
        title: String(ui.taskTitle && ui.taskTitle.value || '').trim(),
        description: String(ui.taskDescription && ui.taskDescription.value || '').trim(),
        priority: String(ui.taskPriority && ui.taskPriority.value || 'normal').trim(),
        assigned_to_id: String(ui.taskAssignee && ui.taskAssignee.value || '').trim(),
        due_date: String(ui.taskDueDate && ui.taskDueDate.value || '').trim(),
      };

      if (!payload.title) {
        notify('Card title is required.', 'error');
        return;
      }

      var editingId = getTaskEditId();

      try {
        if (editingId > 0) {
          var updateUrl = endpoints.taskUpdateBase + encodeURIComponent(editingId) + '/update/';
          var updateData = await ApiClient.post(updateUrl, payload);
          if (!updateData || !updateData.success || !updateData.task) {
            notify((updateData && updateData.message) || 'Failed to update card.', 'error');
            return;
          }
          upsertTaskItem(updateData.task);
          renderTaskBoard();
          notify('Card updated.', 'success');
          setTaskEditor(updateData.task);
          return;
        }

        var createData = await ApiClient.post(endpoints.taskCreate, payload);
        if (!createData || !createData.success || !createData.task) {
          notify((createData && createData.message) || 'Failed to create card.', 'error');
          return;
        }
        upsertTaskItem(createData.task);
        renderTaskBoard();
        resetTaskEditor();
        notify('Card created.', 'success');
      } catch (error) {
        notify((error && error.message) || 'Failed to save card.', 'error');
      }
    });

    if (ui.taskCancelBtn) {
      ui.taskCancelBtn.addEventListener('click', function () {
        resetTaskEditor();
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
          resetTaskEditor();
          notify('Card deleted.', 'success');
        } catch (error) {
          notify((error && error.message) || 'Failed to delete card.', 'error');
        }
      });
    }

    if (ui.taskBoard) {
      ui.taskBoard.addEventListener('click', function (event) {
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
          setTaskEditor(item);
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
  }

  function bindShareForm() {
    if (!ui.shareForm) {
      return;
    }

    ui.shareForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var selectedFile = ui.shareFile.files && ui.shareFile.files[0];
      if (!selectedFile) {
        notify('Please select a file first.', 'error');
        return;
      }

      var formData = new FormData();
      formData.append('title', String(ui.shareTitle.value || '').trim());
      formData.append('note', String(ui.shareNote.value || '').trim());
      formData.append('file', selectedFile);

      try {
        var data = await ApiClient.upload(endpoints.shareUpload, formData);
        if (!data || !data.success) {
          notify((data && data.message) || 'Failed to upload file.', 'error');
          return;
        }

        ui.shareForm.reset();
        notify('File shared successfully.', 'success');
        await loadSharedFiles();
      } catch (error) {
        var errMessage = (error && error.data && error.data.message) || (error && error.message) || 'Failed to upload file.';
        notify(errMessage, 'error');
      }
    });

    if (ui.shareTableBody) {
      ui.shareTableBody.addEventListener('click', async function (event) {
        var actionNode = event.target.closest('[data-action]');
        if (!actionNode || actionNode.getAttribute('data-action') !== 'delete-file') {
          return;
        }

        var row = actionNode.closest('tr[data-file-id]');
        if (!row) {
          return;
        }

        var fileId = row.getAttribute('data-file-id');
        if (!fileId) {
          return;
        }

        if (!window.confirm('Delete this shared file?')) {
          return;
        }

        try {
          var deleteUrl = endpoints.shareDeleteBase + encodeURIComponent(fileId) + '/delete/';
          var data = await ApiClient.post(deleteUrl, {});
          if (!data || !data.success) {
            notify((data && data.message) || 'Failed to delete shared file.', 'error');
            return;
          }
          notify('Shared file deleted.', 'success');
          await loadSharedFiles();
        } catch (error) {
          notify((error && error.message) || 'Failed to delete shared file.', 'error');
        }
      });
    }
  }

  async function init() {
    bindTabs();
    bindGroupTools();
    bindAttachmentTools();
    bindChatForm();
    bindTaskForm();
    bindShareForm();
    resetTaskEditor();
    setActiveTab('chat');
    updateChatCountPill();
    initRealtime();

    await loadGroups({ keepCurrent: true });
    resetChatState();

    await Promise.all([
      loadChat({ forceInitial: true }),
      loadTasks(),
      loadSharedFiles(),
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
