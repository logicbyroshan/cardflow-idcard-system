(function (window, document) {
  'use strict';

  var OfficeTasks = {
    state: {
      items: [],
      commentsByTaskId: {},
      dragId: 0,
      currentItem: null,
      members: [],
    },

    ui: {
      board: document.getElementById('officeTaskBoard'),
      columns: Array.prototype.slice.call(document.querySelectorAll('.office-kanban-column[data-status]')),
      modal: document.getElementById('officeTaskModal'),
      modalBackdrop: document.getElementById('officeTaskModalBackdrop'),
      modalClose: document.getElementById('officeTaskModalClose'),
      form: document.getElementById('officeTaskForm'),
      title: document.getElementById('officeTaskTitle'),
      description: document.getElementById('officeTaskDescription'),
      status: document.getElementById('officeTaskStatus'),
      assignee: document.getElementById('officeTaskAssignee'),
      priority: document.getElementById('officeTaskPriority'),
      dueDate: document.getElementById('officeTaskDueDate'),
      checklistItems: document.getElementById('officeTaskChecklistItems'),
      checklistInput: document.getElementById('officeTaskChecklistInput'),
      checklistAddBtn: document.getElementById('officeTaskChecklistAddBtn'),
      commentsList: document.getElementById('officeTaskCommentsList'),
      commentInput: document.getElementById('officeTaskCommentInput'),
      commentSendBtn: document.getElementById('officeTaskCommentSendBtn'),
      editId: document.getElementById('officeTaskEditId'),
    },

    init: function () {
      this.bindEvents();
      this.load();
    },

    load: async function () {
      var endpoints = window.OfficeWorkConfig.endpoints;
      try {
        var res = await window.ApiClient.get(endpoints.tasksList);
        if (res.success) {
          this.state.items = res.tasks || [];
          this.state.members = res.members || [];
          this.renderBoard();
        }
      } catch (e) {
        if (window.OfficeWork) window.OfficeWork.notify('Failed to load tasks', 'error');
      }
    },

    upsertItem: function (item) {
      if (!item || !item.id) return;
      var idx = this.state.items.findIndex(t => Number(t.id) === Number(item.id));
      if (idx >= 0) this.state.items[idx] = item; else this.state.items.push(item);
      this.renderBoard();
    },

    removeItem: function (taskId) {
      this.state.items = this.state.items.filter(t => Number(t.id) !== Number(taskId));
      this.renderBoard();
    },

    renderCard: function (t) {
      var p = String(t.priority || 'normal').toLowerCase();
      var priorityLabels = { low: 'LOW', normal: 'NORMAL', high: 'HIGH' };
      return `
        <article class="office-task-card" draggable="true" data-task-id="${t.id}">
          <div class="office-task-card-top">
            <span class="office-task-chip priority-${p}">${priorityLabels[p] || 'NORMAL'}</span>
            <button type="button" class="office-task-edit-trigger"><i class="fa-solid fa-pencil"></i></button>
          </div>
          <h5 class="office-task-card-title">${this.escapeHtml(t.title)}</h5>
        </article>`;
    },

    renderBoard: function () {
      if (!this.ui.board) return;
      var self = this;
      ['todo', 'in_progress', 'done', 'pending'].forEach(function (s) {
        var list = self.ui.board.querySelector(`[data-list-for="${s}"]`);
        var items = self.state.items.filter(t => t.status === s);
        if (list) list.innerHTML = items.length ? items.map(t => self.renderCard(t)).join('') : '<div class="office-task-empty">No cards.</div>';
      });
    },

    getMemberOptionsHtml: function (sel) {
      var h = '<option value="">Unassigned</option>';
      var selected = Number(sel || 0);
      this.state.members.forEach(m => {
        h += `<option value="${m.id}" ${Number(m.id) === selected ? 'selected' : ''}>${this.escapeHtml(m.name)}</option>`;
      });
      return h;
    },

    setEditor: function (item) {
      this.state.currentItem = item;
      this.ui.editId.value = item.id;
      this.ui.title.value = item.title;
      this.ui.description.value = item.description || '';
      this.ui.status.value = item.status;
      this.ui.status.disabled = false;
      this.ui.priority.value = item.priority;
      this.ui.assignee.innerHTML = this.getMemberOptionsHtml(item.assigned_to_id);
      this.ui.dueDate.value = item.due_date || '';
      
      this.renderChecklist();
      this.loadComments(item.id);
      
      this.ui.modal.classList.add('is-edit-mode');
      this.ui.modal.hidden = false;
      this.ui.modalBackdrop.hidden = false;
    },

    closeModal: function () {
      this.ui.modal.hidden = true;
      this.ui.modalBackdrop.hidden = true;
      this.ui.form.reset();
      this.state.currentItem = null;
      this.ui.modal.classList.remove('is-edit-mode');
    },

    renderChecklist: function () {
      if (!this.ui.checklistItems) return;
      var self = this;
      var checklist = this.state.currentItem && this.state.currentItem.checklist_items || [];
      if (!checklist.length) {
        this.ui.checklistItems.innerHTML = '<div class="office-task-checklist-empty">No checklist items yet.</div>';
        return;
      }
      this.ui.checklistItems.innerHTML = checklist.map(function (ci) {
        return `
          <div class="office-task-checklist-row" data-checklist-id="${self.escapeHtml(ci.id)}">
            <input class="office-task-checklist-toggle" type="checkbox" ${ci.is_done ? 'checked' : ''}>
            <span class="office-task-checklist-title ${ci.is_done ? 'is-done' : ''}">${self.escapeHtml(ci.title)}</span>
            <button type="button" class="btn btn-xs btn-neutral" data-action="remove-checklist-item">Remove</button>
          </div>`;
      }).join('');
    },

    loadComments: async function (id) {
      try {
        var res = await window.ApiClient.get(window.OfficeWorkConfig.endpoints.taskUpdateBase + id + '/comments/');
        if (res.success) {
          this.state.commentsByTaskId[id] = res.comments || [];
          if (this.state.currentItem && Number(this.state.currentItem.id) === Number(id)) {
            this.renderComments();
          }
        }
      } catch (e) {}
    },

    renderComments: function () {
      if (!this.ui.commentsList) return;
      var comments = this.state.commentsByTaskId[this.state.currentItem.id] || [];
      if (!comments.length) {
        this.ui.commentsList.innerHTML = '<div class="office-task-comments-empty">No activity yet.</div>';
        return;
      }
      var self = this;
      this.ui.commentsList.innerHTML = comments.map(function (c) {
        return `
          <article class="office-task-comment-row">
            <div class="office-task-comment-avatar">${self.escapeHtml((c.sender_name || 'U').charAt(0).toUpperCase())}</div>
            <div class="office-task-comment-content">
              <div class="office-task-comment-head">
                <span class="office-task-comment-author">${self.escapeHtml(c.sender_name || 'Unknown')}</span>
              </div>
              <div class="office-task-comment-body">
                <div class="office-task-comment-text">${self.escapeHtml(c.message)}</div>
              </div>
            </div>
          </article>`;
      }).join('');
    },

    bindEvents: function () {
      var self = this;
      if (!this.ui.board) return;

      this.ui.board.addEventListener('click', function (e) {
        var addBtn = e.target.closest('[data-add-task-status]');
        if (addBtn) return self.openInlineCreator(addBtn.dataset.addTaskStatus);

        var editBtn = e.target.closest('.office-task-edit-trigger');
        if (editBtn) {
          var item = self.state.items.find(t => Number(t.id) === Number(editBtn.closest('.office-task-card').dataset.taskId));
          if (item) self.setEditor(item);
        }
      });

      this.ui.form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var id = self.ui.editId.value;
        var payload = {
          title: self.ui.title.value,
          description: self.ui.description.value,
          status: self.ui.status.value,
          priority: self.ui.priority.value,
          assigned_to_id: self.ui.assignee.value,
          due_date: self.ui.dueDate.value
        };
        var url = id ? (window.OfficeWorkConfig.endpoints.taskUpdateBase + id + '/update/') : window.OfficeWorkConfig.endpoints.taskCreate;
        try {
          var res = await window.ApiClient.post(url, payload);
          if (res.success) {
            self.upsertItem(res.task);
            self.closeModal();
            if (window.OfficeWork) window.OfficeWork.notify(id ? 'Task updated' : 'Task created', 'success');
          }
        } catch (err) {
          if (window.OfficeWork) window.OfficeWork.notify('Error saving task', 'error');
        }
      });

      if (this.ui.commentSendBtn) {
        this.ui.commentSendBtn.addEventListener('click', async function () {
          var id = self.ui.editId.value;
          if (!id) return;
          var msg = self.ui.commentInput.value.trim();
          if (!msg) return;
          try {
            var res = await window.ApiClient.post(window.OfficeWorkConfig.endpoints.taskUpdateBase + id + '/comments/create/', { message: msg });
            if (res.success) {
              self.ui.commentInput.value = '';
              self.loadComments(id);
            }
          } catch (e) {}
        });
      }

      if (this.ui.checklistAddBtn) {
        this.ui.checklistAddBtn.addEventListener('click', async function () {
          var id = self.ui.editId.value;
          if (!id || !self.state.currentItem) return;
          var title = self.ui.checklistInput.value.trim();
          if (!title) return;
          var checklist = (self.state.currentItem.checklist_items || []).slice();
          checklist.push({ id: 'new_' + Date.now(), title: title, is_done: false });
          try {
            var res = await window.ApiClient.post(window.OfficeWorkConfig.endpoints.taskUpdateBase + id + '/update/', { checklist_items: checklist });
            if (res.success) {
              self.ui.checklistInput.value = '';
              self.upsertItem(res.task);
              self.state.currentItem = res.task;
              self.renderChecklist();
            }
          } catch (e) {}
        });
      }

      if (this.ui.checklistItems) {
        this.ui.checklistItems.addEventListener('change', async function (e) {
          var toggle = e.target.closest('.office-task-checklist-toggle');
          if (!toggle) return;
          var id = self.ui.editId.value;
          var checklistId = toggle.closest('[data-checklist-id]').dataset.checklistId;
          var checklist = self.state.currentItem.checklist_items.map(function (ci) {
            if (String(ci.id) === String(checklistId)) ci.is_done = toggle.checked;
            return ci;
          });
          try {
            var res = await window.ApiClient.post(window.OfficeWorkConfig.endpoints.taskUpdateBase + id + '/update/', { checklist_items: checklist });
            if (res.success) { self.upsertItem(res.task); self.state.currentItem = res.task; self.renderChecklist(); }
          } catch (e) {}
        });
      }

      this.ui.board.addEventListener('dragstart', function (e) {
        var card = e.target.closest('.office-task-card');
        if (card) {
          self.state.dragId = card.dataset.taskId;
          e.dataTransfer.setData('text/plain', card.dataset.taskId);
        }
      });

      this.ui.board.addEventListener('dragover', function (e) {
        var col = e.target.closest('.office-kanban-column');
        if (col) { e.preventDefault(); col.classList.add('is-drop-target'); }
      });

      this.ui.board.addEventListener('dragleave', function (e) {
        var col = e.target.closest('.office-kanban-column');
        if (col) col.classList.remove('is-drop-target');
      });

      this.ui.board.addEventListener('drop', function (e) {
        var col = e.target.closest('.office-kanban-column');
        if (col) {
          col.classList.remove('is-drop-target');
          self.moveToStatus(self.state.dragId, col.dataset.status);
        }
      });

      if (this.ui.modalClose) this.ui.modalClose.addEventListener('click', function () { self.closeModal(); });
    },

    moveToStatus: async function (id, status) {
      var item = this.state.items.find(t => Number(t.id) === Number(id));
      if (!item || item.status === status) return;
      var prev = item.status;
      item.status = status;
      this.renderBoard();
      try {
        var res = await window.ApiClient.post(window.OfficeWorkConfig.endpoints.taskUpdateBase + id + '/update/', { status: status });
        if (res.success) this.upsertItem(res.task);
        else throw new Error(res.message);
      } catch (e) {
        item.status = prev;
        this.renderBoard();
        if (window.OfficeWork) window.OfficeWork.notify(e.message || 'Failed to move task', 'error');
      }
    },

    openInlineCreator: function (status) {
      var self = this;
      this.ui.columns.forEach(function (col) {
        var btn = col.querySelector('.office-kanban-add-btn');
        var inline = col.querySelector('.office-kanban-inline-create');
        if (inline) inline.remove();
        if (btn) btn.hidden = false;
      });
      var col = this.ui.board.querySelector(`.office-kanban-column[data-status="${status}"]`);
      var btn = col.querySelector('.office-kanban-add-btn');
      btn.hidden = true;
      var inline = document.createElement('div');
      inline.className = 'office-kanban-inline-create';
      inline.innerHTML = `
        <input type="text" class="office-input" placeholder="Title..." data-inline-input="${status}">
        <div class="office-kanban-inline-actions">
          <button class="btn btn-sm btn-primary" data-action="save">Add</button>
          <button class="btn btn-sm btn-neutral" data-action="cancel">Cancel</button>
        </div>`;
      col.querySelector('.office-kanban-add-wrap').appendChild(inline);
      var input = inline.querySelector('input');
      input.focus();

      inline.addEventListener('click', function (e) {
        var saveBtn = e.target.closest('[data-action="save"]');
        if (saveBtn) {
          if (input.value.trim()) {
            window.ApiClient.post(window.OfficeWorkConfig.endpoints.taskCreate, { title: input.value, status: status }).then(res => {
              if (res.success) { self.upsertItem(res.task); self.ui.columns.forEach(c => { var b = c.querySelector('.office-kanban-add-btn'); if(b) b.hidden=false; var i = c.querySelector('.office-kanban-inline-create'); if(i) i.remove(); }); }
            });
          }
        }
        if (e.target.closest('[data-action="cancel"]')) { btn.hidden = false; inline.remove(); }
      });
    },

    handleRealtime: function (p) {
      if (p.event === 'officework.task.deleted') {
        this.removeItem(p.payload.task_id);
      } else if (p.payload && p.payload.task) {
        this.upsertItem(p.payload.task);
      }
    },

    escapeHtml: function (val) {
      return String(val || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  };

  window.OfficeTasks = OfficeTasks;

})(window, document);
