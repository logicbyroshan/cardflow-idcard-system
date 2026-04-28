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
    var selfToggleLabel = document.getElementById('smSelfToggleLabel');

    var state = {
      users: [],
      selfStatus: null,
      savingSelf: false,
      savingUserIds: {},
      selfRequestSeq: 0,
      selfAutoApplyReady: false,
      pendingSelfSave: false
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

      if (selfRam) {
        var selectedRam = parseInt(status.ram_allocation_mb || 0, 10) || 0;
        if (selectedRam > 0 && selfRam.querySelector('option[value="' + selectedRam + '"]')) {
          selfRam.value = String(selectedRam);
        }
        selfRam.disabled = !!state.savingSelf;
      }

      if (selfHint) {
        selfHint.textContent = status.message || 'Changes auto-apply.';
      }

      if (selfEnabled) {
        selfEnabled.checked = !!status.is_enabled;
        selfEnabled.disabled = !status.is_assigned || !!state.savingSelf;
      }

      if (selfToggleLabel) {
        selfToggleLabel.textContent = (selfEnabled && selfEnabled.checked) ? 'Mode On' : 'Mode Off';
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
        var optionHtml = '';
        if (!currentRam) {
          optionHtml = '<option value="" disabled selected>Select RAM</option>';
        }
        optionHtml += options.map(function (mb) {
          var selected = Number(mb) === Number(currentRam) ? ' selected' : '';
          return '<option value="' + mb + '"' + selected + '>' + mb + ' MB</option>';
        }).join('');

        var isAssigned = !!sm.is_assigned;
        var isEnabled = !!sm.is_enabled;
        var isSaving = !!state.savingUserIds[user.id];
        var disabled = !user.is_active ? ' disabled' : '';
        var runtimeDisabled = (!user.is_active || !isAssigned || isSaving) ? ' disabled' : '';
        var runtimeLabel = (isAssigned && isEnabled) ? 'On' : 'Off';

        html += ''
          + '<tr data-user-id="' + user.id + '">'
          + '  <td>'
          + '    <div style="font-weight:700;color:#0f172a;">' + escapeHtml(user.full_name) + '</div>'
          + '    <div class="sm-muted">' + escapeHtml(user.email || user.username || '-') + '</div>'
          + '  </td>'
          + '  <td><span class="sm-role">' + escapeHtml(user.role_display || user.role) + '</span></td>'
          + '  <td>'
          + '    <select class="sm-ram-select"' + (disabled || (isSaving ? ' disabled' : '')) + '>' + optionHtml + '</select>'
          + '  </td>'
          + '  <td>'
          + '    <label class="sm-toggle">'
          + '      <input type="checkbox" class="sm-assign-toggle"' + (isAssigned ? ' checked' : '') + (disabled || (isSaving ? ' disabled' : '')) + '>'
          + '      Assigned'
          + '    </label>'
          + '  </td>'
          + '  <td>'
          + '    <label class="sm-switch">'
          + '      <input type="checkbox" class="sm-runtime-toggle"' + ((isAssigned && isEnabled) ? ' checked' : '') + runtimeDisabled + '>'
          + '      <span class="sm-switch-track" aria-hidden="true"></span>'
          + '      <span class="sm-runtime-label">' + runtimeLabel + '</span>'
          + '    </label>'
          + '  </td>'
          + '  <td>'
          + '    ' + statusMarkup(sm)
          + (isSaving ? ' <span class="sm-muted"><i class="fa-solid fa-spinner fa-spin"></i> Saving...</span>' : '')
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
        state.selfAutoApplyReady = false;
        var payload = await requestJson(usersApi, { method: 'GET' });
        state.users = Array.isArray(payload.users) ? payload.users : [];
        state.selfStatus = payload.self_super_mode || null;
        renderSelfStatus();
        renderUsers();
        state.selfAutoApplyReady = true;
      } catch (error) {
        console.error('Failed loading super mode data:', error);
        usersBody.innerHTML = '<tr><td colspan="6" class="sm-empty">Failed to load users.</td></tr>';
        showMessage(error.message || 'Failed to load Super Mode data', 'error');
      }
    }

    async function saveSelfConfig(quiet) {
      if (state.savingSelf) {
        state.pendingSelfSave = true;
        return;
      }

      state.pendingSelfSave = false;
      state.savingSelf = true;
      var requestSeq = ++state.selfRequestSeq;
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

        if (requestSeq !== state.selfRequestSeq) {
          return;
        }

        state.selfStatus = response.super_mode || state.selfStatus;
        renderSelfStatus();
        if (!quiet) {
          showMessage(response.message || 'Super Mode updated', 'success');
        }
      } catch (error) {
        console.error('Failed saving self super mode:', error);
        showMessage(error.message || 'Failed to save Super Mode', 'error');
      } finally {
        if (requestSeq === state.selfRequestSeq) {
          state.savingSelf = false;
          renderSelfStatus();
          if (state.pendingSelfSave) {
            saveSelfConfig(true);
          }
        }
      }
    }

    async function saveUserAssignment(userId, enabled, ramMb, runtimeEnabled) {
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
            ram_allocation_mb: ramMb,
            runtime_enabled: runtimeEnabled
          })
        });

        if (response && response.user) {
          updateUserRow(response.user);
        }
      } catch (error) {
        console.error('Failed saving user assignment:', error);
        showMessage(error.message || 'Failed to update assignment', 'error');
      } finally {
        delete state.savingUserIds[userId];
        renderUsers();
      }
    }

    function parseUserRowPayload(row) {
      var assignToggle = row.querySelector('.sm-assign-toggle');
      var ramSelect = row.querySelector('.sm-ram-select');
      var runtimeToggle = row.querySelector('.sm-runtime-toggle');

      var assigned = !!(assignToggle && assignToggle.checked);
      var ramMb = parseInt(ramSelect && ramSelect.value ? ramSelect.value : '0', 10);
      if (!ramMb || ramMb < 0) {
        ramMb = 0;
      }

      var runtimeEnabled = assigned && !!(runtimeToggle && runtimeToggle.checked);
      return {
        assigned: assigned,
        ramMb: ramMb,
        runtimeEnabled: runtimeEnabled,
      };
    }

    if (searchInput) {
      searchInput.addEventListener('input', renderUsers);
    }

    if (selfRam) {
      selfRam.addEventListener('change', function () {
        if (!state.selfAutoApplyReady) {
          return;
        }
        saveSelfConfig(true);
      });
    }

    if (selfEnabled) {
      selfEnabled.addEventListener('change', function () {
        if (selfToggleLabel) {
          selfToggleLabel.textContent = selfEnabled.checked ? 'Mode On' : 'Mode Off';
        }
        if (!state.selfAutoApplyReady) {
          return;
        }
        saveSelfConfig(true);
      });
    }

    if (usersBody) {
      usersBody.addEventListener('change', function (event) {
        var target = event.target;
        if (!target) {
          return;
        }

        var isTrackedControl = target.classList.contains('sm-assign-toggle')
          || target.classList.contains('sm-runtime-toggle')
          || target.classList.contains('sm-ram-select');

        if (!isTrackedControl) {
          return;
        }

        var row = target.closest('tr[data-user-id]');
        if (!row) {
          return;
        }

        var userId = parseInt(row.getAttribute('data-user-id') || '0', 10);
        if (!userId) {
          return;
        }

        var payload = parseUserRowPayload(row);

        if (target.classList.contains('sm-ram-select') && !payload.assigned) {
          return;
        }

        if (payload.assigned && !payload.ramMb) {
          showMessage('Please select a RAM allocation first.', 'warning');
          // Revert the checkbox
          var assignToggle = row.querySelector('.sm-assign-toggle');
          if (assignToggle) { assignToggle.checked = false; }
          return;
        }

        saveUserAssignment(userId, payload.assigned, payload.ramMb, payload.runtimeEnabled);
      });
    }

    loadData();
  });
})();
