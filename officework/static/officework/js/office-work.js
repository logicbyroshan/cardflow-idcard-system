(function () {
  'use strict';

  var cfg = window.OfficeWorkConfig || {};
  var endpoints = cfg.endpoints || {};
  if (!endpoints.chatList || !window.ApiClient) {
    return;
  }

  var state = {
    activeTab: 'chat',
    chatLastId: 0,
    members: [],
    taskItems: [],
    fileItems: [],
    pollTimer: null,
    chatLoaded: false,
  };

  var ui = {
    tabButtons: Array.prototype.slice.call(document.querySelectorAll('.office-tab-btn')),
    panels: Array.prototype.slice.call(document.querySelectorAll('.office-panel')),
    chatList: document.getElementById('officeChatList'),
    chatForm: document.getElementById('officeChatForm'),
    chatInput: document.getElementById('officeChatInput'),
    taskForm: document.getElementById('officeTaskForm'),
    taskTitle: document.getElementById('officeTaskTitle'),
    taskDescription: document.getElementById('officeTaskDescription'),
    taskAssignee: document.getElementById('officeTaskAssignee'),
    taskPriority: document.getElementById('officeTaskPriority'),
    taskDueDate: document.getElementById('officeTaskDueDate'),
    taskTableBody: document.querySelector('#officeTaskTable tbody'),
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
      btn.classList.toggle('btn-primary', isActive);
      btn.classList.toggle('btn-neutral', !isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    ui.panels.forEach(function (panel) {
      var isActive = panel.getAttribute('data-panel') === tabName;
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    });
  }

  function appendChatMessage(item) {
    var row = document.createElement('article');
    row.className = 'client-message-row';
    row.innerHTML = '' +
      '<div class="client-message-bubble">' +
      '  <div class="client-message-bubble-head">' +
      '    <span class="client-message-sender">' + escapeHtml(item.sender_name || 'Unknown') + '</span>' +
      '    <span class="client-message-time">' + escapeHtml(formatDateTime(item.created_at)) + '</span>' +
      '  </div>' +
      '  <div class="client-message-text">' + escapeHtml(item.message || '') + '</div>' +
      '</div>' +
      '';
    ui.chatList.appendChild(row);
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
    var empty = document.createElement('div');
    empty.className = 'client-message-thread-state';
    empty.textContent = 'No chat yet. Start the conversation.';
    ui.chatList.appendChild(empty);
  }

  async function loadChat(options) {
    var forceInitial = !!(options && options.forceInitial);
    var query = forceInitial ? '?limit=180' : ('?after_id=' + encodeURIComponent(state.chatLastId));

    try {
      var data = await ApiClient.get(endpoints.chatList + query);
      if (!data || !data.success) {
        return;
      }

      var messages = Array.isArray(data.messages) ? data.messages : [];
      if (messages.length === 0) {
        if (!state.chatLoaded) {
          renderChatEmptyState();
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

  function renderTaskRows() {
    if (!ui.taskTableBody) {
      return;
    }

    if (!state.taskItems.length) {
      ui.taskTableBody.innerHTML = '<tr><td colspan="6">No tasks yet.</td></tr>';
      return;
    }

    var rows = state.taskItems.map(function (task) {
      return '' +
        '<tr data-task-id="' + escapeHtml(task.id) + '">' +
        '  <td><input type="text" class="office-task-title office-input" value="' + escapeHtml(task.title || '') + '" maxlength="180"></td>' +
        '  <td>' +
        '    <select class="office-task-status form-select form-select-sm">' +
        '      <option value="todo"' + (task.status === 'todo' ? ' selected' : '') + '>Todo</option>' +
        '      <option value="in_progress"' + (task.status === 'in_progress' ? ' selected' : '') + '>In Progress</option>' +
        '      <option value="done"' + (task.status === 'done' ? ' selected' : '') + '>Done</option>' +
        '    </select>' +
        '  </td>' +
        '  <td>' +
        '    <select class="office-task-priority form-select form-select-sm">' +
        '      <option value="low"' + (task.priority === 'low' ? ' selected' : '') + '>Low</option>' +
        '      <option value="normal"' + (task.priority === 'normal' ? ' selected' : '') + '>Normal</option>' +
        '      <option value="high"' + (task.priority === 'high' ? ' selected' : '') + '>High</option>' +
        '    </select>' +
        '  </td>' +
        '  <td><select class="office-task-assigned form-select form-select-sm">' + getMemberOptionsHtml(task.assigned_to_id) + '</select></td>' +
        '  <td><input type="date" class="office-task-due office-input" value="' + escapeHtml(task.due_date || '') + '"></td>' +
        '  <td>' +
        '    <div class="office-row-actions">' +
        '      <button type="button" class="btn btn-sm btn-neutral" data-action="save-task">Save</button>' +
        '      <button type="button" class="btn btn-sm btn-danger" data-action="delete-task">Delete</button>' +
        '    </div>' +
        '  </td>' +
        '</tr>';
    });

    ui.taskTableBody.innerHTML = rows.join('');
  }

  async function loadTasks() {
    try {
      var data = await ApiClient.get(endpoints.tasksList);
      if (!data || !data.success) {
        return;
      }
      state.taskItems = Array.isArray(data.tasks) ? data.tasks : [];
      state.members = Array.isArray(data.members) ? data.members : [];
      if (ui.taskAssignee) {
        ui.taskAssignee.innerHTML = getMemberOptionsHtml(0);
      }
      renderTaskRows();
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
      loadChat({ forceInitial: false });
    }, 8000);
  }

  function bindTabs() {
    ui.tabButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tabName = btn.getAttribute('data-tab') || 'chat';
        setActiveTab(tabName);
      });
    });
  }

  function bindChatForm() {
    if (!ui.chatForm) {
      return;
    }
    ui.chatForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var text = String(ui.chatInput.value || '').trim();
      if (!text) {
        notify('Please write a message first.', 'error');
        return;
      }

      try {
        var data = await ApiClient.post(endpoints.chatSend, { message: text });
        if (!data || !data.success || !data.item) {
          notify((data && data.message) || 'Failed to send message.', 'error');
          return;
        }

        clearChatEmptyState();
        appendChatMessage(data.item);
        state.chatLastId = Math.max(state.chatLastId, Number(data.item.id || 0));
        ui.chatInput.value = '';
        ui.chatList.scrollTop = ui.chatList.scrollHeight;
      } catch (error) {
        notify((error && error.message) || 'Failed to send message.', 'error');
      }
    });
  }

  function bindTaskForm() {
    if (!ui.taskForm) {
      return;
    }

    ui.taskForm.addEventListener('submit', async function (event) {
      event.preventDefault();

      var payload = {
        title: String(ui.taskTitle.value || '').trim(),
        description: String(ui.taskDescription.value || '').trim(),
        priority: String(ui.taskPriority.value || 'normal').trim(),
        assigned_to_id: String(ui.taskAssignee.value || '').trim(),
        due_date: String(ui.taskDueDate.value || '').trim(),
      };

      if (!payload.title) {
        notify('Task title is required.', 'error');
        return;
      }

      try {
        var data = await ApiClient.post(endpoints.taskCreate, payload);
        if (!data || !data.success) {
          notify((data && data.message) || 'Failed to create task.', 'error');
          return;
        }

        ui.taskForm.reset();
        if (ui.taskPriority) {
          ui.taskPriority.value = 'normal';
        }
        notify('Task created.', 'success');
        await loadTasks();
      } catch (error) {
        notify((error && error.message) || 'Failed to create task.', 'error');
      }
    });

    if (ui.taskTableBody) {
      ui.taskTableBody.addEventListener('click', async function (event) {
        var actionNode = event.target.closest('[data-action]');
        if (!actionNode) {
          return;
        }
        var row = actionNode.closest('tr[data-task-id]');
        if (!row) {
          return;
        }
        var taskId = row.getAttribute('data-task-id');
        if (!taskId) {
          return;
        }

        var action = actionNode.getAttribute('data-action');
        if (action === 'save-task') {
          var updatePayload = {
            title: String(row.querySelector('.office-task-title').value || '').trim(),
            status: String(row.querySelector('.office-task-status').value || 'todo').trim(),
            priority: String(row.querySelector('.office-task-priority').value || 'normal').trim(),
            assigned_to_id: String(row.querySelector('.office-task-assigned').value || '').trim(),
            due_date: String(row.querySelector('.office-task-due').value || '').trim(),
          };

          if (!updatePayload.title) {
            notify('Task title cannot be empty.', 'error');
            return;
          }

          try {
            var updateUrl = endpoints.taskUpdateBase + encodeURIComponent(taskId) + '/update/';
            var updateData = await ApiClient.post(updateUrl, updatePayload);
            if (!updateData || !updateData.success) {
              notify((updateData && updateData.message) || 'Failed to update task.', 'error');
              return;
            }
            notify('Task updated.', 'success');
            await loadTasks();
          } catch (error) {
            notify((error && error.message) || 'Failed to update task.', 'error');
          }
          return;
        }

        if (action === 'delete-task') {
          if (!window.confirm('Delete this task?')) {
            return;
          }
          try {
            var deleteUrl = endpoints.taskUpdateBase + encodeURIComponent(taskId) + '/delete/';
            var deleteData = await ApiClient.post(deleteUrl, {});
            if (!deleteData || !deleteData.success) {
              notify((deleteData && deleteData.message) || 'Failed to delete task.', 'error');
              return;
            }
            notify('Task deleted.', 'success');
            await loadTasks();
          } catch (error) {
            notify((error && error.message) || 'Failed to delete task.', 'error');
          }
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
    bindChatForm();
    bindTaskForm();
    bindShareForm();
    setActiveTab('chat');

    await Promise.all([
      loadChat({ forceInitial: true }),
      loadTasks(),
      loadSharedFiles(),
    ]);

    startChatPolling();
  }

  init();
})();
