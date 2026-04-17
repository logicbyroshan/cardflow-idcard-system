(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getCsrfToken() {
    var cookie = document.cookie.split(';').find(function (item) {
      return item.trim().indexOf('csrftoken=') === 0;
    });
    return cookie ? cookie.split('=')[1] : '';
  }

  function showMessage(message, level) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, level || 'info');
      return;
    }
    if (message) {
      window.alert(message);
    }
  }

  async function requestJson(url, options) {
    var fetchOptions = Object.assign({
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    }, options || {});

    var response = await fetch(url, fetchOptions);
    var payload = {};
    try {
      payload = await response.json();
    } catch (e) {
      payload = {};
    }

    if (!response.ok || payload.success === false) {
      var message = payload.message || 'Request failed';
      var error = new Error(message);
      error.payload = payload;
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('superModeRoot');
    if (!root) {
      return;
    }

    var usersApi = root.getAttribute('data-users-api') || '';
    var assignApi = root.getAttribute('data-assign-api') || '';
    var selfApi = root.getAttribute('data-self-api') || '';

    var usersBody = document.getElementById('smUsersBody');
    var searchInput = document.getElementById('smSearch');
    var selfRam = document.getElementById('smSelfRam');
    var selfEnabled = document.getElementById('smSelfEnabled');
    var selfInfo = document.getElementById('smSelfInfo');
    var selfStatus = document.getElementById('smSelfStatus');
    var selfHint = document.getElementById('smSelfHint');
    var selfSaveBtn = document.getElementById('smSelfSaveBtn');

    var state = {
      users: [],
      selfStatus: null,
      savingSelf: false,
      savingUserIds: {}
    };

    function statusMarkup(superMode) {
      var mode = superMode || {};
      if (mode.effective_enabled) {
        return '<span class="sm-status on">Running</span>';
      }
      if (mode.is_assigned) {
        return '<span class="sm-status assigned">Assigned</span>';
      }
      return '<span class="sm-status off">Off</span>';
    }

    function renderSelfStatus() {
      var status = state.selfStatus || {};
      if (!selfStatus) {
        return;
      }

      var label = 'Off';
      var klass = 'off';
      if (status.effective_enabled) {
        label = 'Running';
        klass = 'on';
      } else if (status.is_assigned) {
        label = 'Assigned';
        klass = 'assigned';
      }

      selfStatus.className = 'sm-status ' + klass;
      selfStatus.textContent = label;

      if (selfInfo) {
        var ram = parseInt(status.ram_allocation_mb || 0, 10) || 0;
        selfInfo.value = ram > 0 ? (ram + ' MB') : 'Not assigned';
      }

      if (selfHint) {
        selfHint.textContent = status.message || 'Save to apply your own Pro allocation.';
      }

      if (selfEnabled) {
        selfEnabled.checked = !!status.is_enabled;
        selfEnabled.disabled = !status.is_assigned;
      }

      if (selfSaveBtn) {
        selfSaveBtn.disabled = !!state.savingSelf;
      }
    }

    function renderUsers() {
      if (!usersBody) {
        return;
      }

      var needle = (searchInput && searchInput.value ? searchInput.value : '').trim().toLowerCase();
      var filtered = state.users.filter(function (user) {
        if (!needle) {
          return true;
        }
        var haystack = [
          user.full_name,
          user.username,
          user.email,
          user.role_display,
          user.role
        ].join(' ').toLowerCase();
        return haystack.indexOf(needle) !== -1;
      });

      if (!filtered.length) {
        usersBody.innerHTML = '<tr><td colspan="6" class="sm-empty">No matching users found.</td></tr>';
        return;
      }

      var html = '';
      filtered.forEach(function (user) {
        var sm = user.super_mode || {};
        var options = Array.isArray(sm.allowed_options_mb) ? sm.allowed_options_mb : [];
        var currentRam = parseInt(sm.ram_allocation_mb || 0, 10);
        if (!currentRam && options.length) {
          currentRam = options[0];
        }

        var optionHtml = options.map(function (mb) {
          var selected = Number(mb) === Number(currentRam) ? ' selected' : '';
          return '<option value="' + mb + '"' + selected + '>' + mb + ' MB</option>';
        }).join('');

        var disabled = !user.is_active ? ' disabled' : '';
        var isSaving = !!state.savingUserIds[user.id];
        var saveDisabled = (isSaving || !user.is_active) ? ' disabled' : '';

        html += ''
          + '<tr data-user-id="' + user.id + '">'
          + '  <td>'
          + '    <div style="font-weight:700;color:#0f172a;">' + escapeHtml(user.full_name) + '</div>'
          + '    <div class="sm-muted">' + escapeHtml(user.email || user.username || '-') + '</div>'
          + '  </td>'
          + '  <td><span class="sm-role">' + escapeHtml(user.role_display || user.role) + '</span></td>'
          + '  <td>'
          + '    <select class="sm-ram-select"' + disabled + '>' + optionHtml + '</select>'
          + '  </td>'
          + '  <td>'
          + '    <label class="sm-toggle">'
          + '      <input type="checkbox" class="sm-assign-toggle"' + (sm.is_assigned ? ' checked' : '') + disabled + '>'
          + '      Assigned'
          + '    </label>'
          + '  </td>'
          + '  <td>' + statusMarkup(sm) + '</td>'
          + '  <td>'
          + '    <button class="btn btn-sm btn-primary sm-user-save" type="button"' + saveDisabled + '>'
          + (isSaving ? '<i class="fa-solid fa-spinner fa-spin"></i> Saving' : '<i class="fa-solid fa-floppy-disk"></i> Save')
          + '    </button>'
          + '  </td>'
          + '</tr>';
      });

      usersBody.innerHTML = html;
    }

    function updateUserRow(updatedUser) {
      state.users = state.users.map(function (item) {
        if (Number(item.id) !== Number(updatedUser.id)) {
          return item;
        }
        return {
          id: updatedUser.id,
          full_name: updatedUser.full_name,
          username: updatedUser.username || item.username,
          email: updatedUser.email || item.email,
          role: updatedUser.role || item.role,
          role_display: updatedUser.role_display || item.role_display,
          is_active: updatedUser.is_active,
          super_mode: Object.assign({}, item.super_mode || {}, updatedUser.super_mode || {})
        };
      });
    }

    async function loadData() {
      usersBody.innerHTML = '<tr><td colspan="6" class="sm-empty">Loading users...</td></tr>';
      try {
        var payload = await requestJson(usersApi, { method: 'GET' });
        state.users = Array.isArray(payload.users) ? payload.users : [];
        state.selfStatus = payload.self_super_mode || null;
        renderSelfStatus();
        renderUsers();
      } catch (error) {
        console.error('Failed loading super mode data:', error);
        usersBody.innerHTML = '<tr><td colspan="6" class="sm-empty">Failed to load users.</td></tr>';
        showMessage(error.message || 'Failed to load Super Mode data', 'error');
      }
    }

    async function saveSelfConfig() {
      if (state.savingSelf) {
        return;
      }

      state.savingSelf = true;
      renderSelfStatus();

      try {
        var payload = {
          ram_allocation_mb: parseInt(selfRam && selfRam.value ? selfRam.value : '0', 10),
          enabled: !!(selfEnabled && selfEnabled.checked)
        };

        var response = await requestJson(selfApi, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken(),
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify(payload)
        });

        state.selfStatus = response.super_mode || state.selfStatus;
        renderSelfStatus();
        showMessage(response.message || 'Super Mode updated', 'success');
      } catch (error) {
        console.error('Failed saving self super mode:', error);
        showMessage(error.message || 'Failed to save Super Mode', 'error');
      } finally {
        state.savingSelf = false;
        renderSelfStatus();
      }
    }

    async function saveUserAssignment(userId, enabled, ramMb) {
      state.savingUserIds[userId] = true;
      renderUsers();

      try {
        var response = await requestJson(assignApi, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken(),
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({
            user_id: userId,
            enabled: enabled,
            ram_allocation_mb: ramMb
          })
        });

        if (response && response.user) {
          updateUserRow(response.user);
        }
        showMessage(response.message || 'Assignment updated', 'success');
      } catch (error) {
        console.error('Failed saving user assignment:', error);
        showMessage(error.message || 'Failed to update assignment', 'error');
      } finally {
        delete state.savingUserIds[userId];
        renderUsers();
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', renderUsers);
    }

    if (selfSaveBtn) {
      selfSaveBtn.addEventListener('click', saveSelfConfig);
    }

    if (usersBody) {
      usersBody.addEventListener('click', function (event) {
        var button = event.target.closest('.sm-user-save');
        if (!button) {
          return;
        }

        var row = button.closest('tr[data-user-id]');
        if (!row) {
          return;
        }

        var userId = parseInt(row.getAttribute('data-user-id') || '0', 10);
        if (!userId) {
          return;
        }

        var assignToggle = row.querySelector('.sm-assign-toggle');
        var ramSelect = row.querySelector('.sm-ram-select');
        var enabled = !!(assignToggle && assignToggle.checked);
        var ramMb = parseInt(ramSelect && ramSelect.value ? ramSelect.value : '0', 10);

        saveUserAssignment(userId, enabled, ramMb);
      });
    }

    loadData();
  });
})();
