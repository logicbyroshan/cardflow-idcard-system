/**
 * Manage Client Page  Button click handlers, form submit, delete/status confirm,
 * close/escape handlers, staff drawer
 * Split from manage-client-events.js
 */
document.addEventListener('DOMContentLoaded', function() {
      var NS = window.ManageClientPage;

      // ==================== LOCAL ELEMENTS ====================
      var clientDrawer = document.getElementById('client-drawer');
      var clientForm = document.getElementById('clientForm');
      var clientIdInput = document.getElementById('clientId');
      var viewModal = document.getElementById('view-modal');

      var addClientBtn = document.getElementById('addClientBtn');
      var editClientBtn = document.getElementById('editClientBtn');
      var viewClientBtn = document.getElementById('viewClientBtn');
      var viewStaffBtn = document.getElementById('viewStaffBtn');
      var deleteClientBtn = document.getElementById('deleteClientBtn');
      var activeClientBtn = document.getElementById('activeClientBtn');
      var groupSettingBtn = document.getElementById('group-setting-btn');
      var idcardGroupBtn = document.getElementById('idcard-group-btn');

      var closeClientDrawer = document.getElementById('closeClientDrawer');
      var cancelClientDrawer = document.getElementById('cancelClientDrawer');
      var closeViewModal = document.getElementById('closeViewModal');
      var closeViewModalBtn = document.getElementById('closeViewModalBtn');
      var editFromViewBtn = document.getElementById('editFromViewBtn');
      var confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
      var confirmStatusBtn = document.getElementById('confirmStatusBtn');
      var clientTableContainer = document.getElementById('client-table-container');

      var openGroupMessageBtn = document.getElementById('openGroupMessageBtn');
      var groupMessageDrawer = document.getElementById('group-message-drawer');
      var closeGroupMessageDrawer = document.getElementById('closeGroupMessageDrawer');
      var cancelGroupMessageBtn = document.getElementById('cancelGroupMessageBtn');
      var groupMessageClientSearch = document.getElementById('groupMessageClientSearch');
      var groupMessageClientsList = document.getElementById('groupMessageClientsList');
      var groupMessageSelectedCount = document.getElementById('groupMessageSelectedCount');
      var groupMessageTargetSummary = document.getElementById('groupMessageTargetSummary');
      var groupMessageHistory = document.getElementById('groupMessageHistory');
      var groupMessageSelectAllVisibleBtn = document.getElementById('groupMessageSelectAllVisibleBtn');
      var groupMessageClearSelectionBtn = document.getElementById('groupMessageClearSelectionBtn');
      var groupMessageText = document.getElementById('groupMessageText');
      var groupMessageCounter = document.getElementById('groupMessageCounter');
      var groupMessageDurationWrap = document.getElementById('groupMessageDurationWrap');
      var groupMessageTemporaryDuration = document.getElementById('groupMessageTemporaryDuration');
      var sendGroupMessageBtn = document.getElementById('sendGroupMessageBtn');

      NS.groupMessageSelectedClientIds = new Set();
      NS.groupMessageClients = [];
      NS.groupMessageFocusedClientId = null;
      NS.groupMessageLastClickedClientId = null;

      function escapeHtmlLocal(value) {
        var text = String(value == null ? '' : value);
        return text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function resolveClientLogoUrl(item) {
        if (!item || typeof item !== 'object') return '';
        return item.logo_url || item.website_logo_url || item.photo_url || '';
      }

      function panelBasePath() {
        return window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';
      }

      function clientGroupsUrl(clientId) {
        return panelBasePath() + '/client/' + encodeURIComponent(String(clientId)) + '/groups/';
      }

      function clientSettingsUrl(clientId) {
        return panelBasePath() + '/client/' + encodeURIComponent(String(clientId)) + '/settings/';
      }

      function getSelectedClientName() {
        if (!NS.selectedRow) return '';
        var fromDataset = NS.selectedRow.dataset ? NS.selectedRow.dataset.clientName : '';
        if (fromDataset) return String(fromDataset).trim();
        var firstCell = NS.selectedRow.querySelector('td:first-child');
        return firstCell ? String(firstCell.textContent || '').trim() : '';
      }

      function getSelectedClientLogo() {
        if (!NS.selectedRow || !NS.selectedRow.dataset) return '';
        return String(NS.selectedRow.dataset.clientLogo || '').trim();
      }

      function renderClientMessageHistory(messages, historyNode) {
        if (!historyNode) return;
        if (!messages || messages.length === 0) {
          historyNode.innerHTML = '<div class="group-msg-history-state">No messages sent yet.</div>';
          return;
        }

        historyNode.innerHTML = messages.map(function(item) {
          var expiryHtml = '';
          if (item.visibility === 'temporary' && item.expires_at_display) {
            expiryHtml = '<div class="group-msg-history-expiry">Temporary message. Expires: ' + escapeHtmlLocal(item.expires_at_display) + '</div>';
          }
          var statusText = item.notification_active
            ? 'Visible to recipients'
            : 'Manually removed from recipients';
          var rowClass = item.notification_active ? 'group-msg-history-item' : 'group-msg-history-item is-removed';
          var deleteBtnHtml = item.notification_active
            ? '<button type="button" class="group-msg-history-delete" title="Delete message" aria-label="Delete message" data-delete-client-message="' + escapeHtmlLocal(item.id) + '"><i class="fa-solid fa-trash"></i></button>'
            : '';

          return (
            '<article class="' + rowClass + '">' +
              '<div class="group-msg-history-top">' +
                '<div style="display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap;">' +
                  '<span class="group-msg-history-title">' + escapeHtmlLocal(item.sent_by_name || 'System') + '</span>' +
                  '<span class="group-msg-history-time">' + escapeHtmlLocal(item.created_at_display || '-') + '</span>' +
                '</div>' +
                deleteBtnHtml +
              '</div>' +
              '<div class="group-msg-history-text">' + escapeHtmlLocal(item.message || '') + '</div>' +
              '<div class="group-msg-history-meta">' +
                '<span>Recipients: ' + escapeHtmlLocal(item.recipient_count || 0) + '</span>' +
                '<span>' + escapeHtmlLocal(statusText) + '</span>' +
              '</div>' +
              expiryHtml +
            '</article>'
          );
        }).join('');
      }

      function renderGroupMessageSelectedCount() {
        if (!groupMessageSelectedCount) return;
        var selectedCount = NS.groupMessageSelectedClientIds ? NS.groupMessageSelectedClientIds.size : 0;
        groupMessageSelectedCount.textContent = String(selectedCount) + ' selected';
      }

      function renderGroupMessageTargetSummary() {
        var selectedCount = NS.groupMessageSelectedClientIds ? NS.groupMessageSelectedClientIds.size : 0;
        if (groupMessageTargetSummary) {
          if (selectedCount === 0) {
            groupMessageTargetSummary.textContent = 'Sending to all clients';
          } else if (selectedCount === 1) {
            groupMessageTargetSummary.textContent = 'Sending to 1 selected client';
          } else {
            groupMessageTargetSummary.textContent = 'Sending to ' + String(selectedCount) + ' selected clients';
          }
        }

        if (!sendGroupMessageBtn) return;
        if (selectedCount === 0) {
          sendGroupMessageBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send To All';
        } else if (selectedCount === 1) {
          sendGroupMessageBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send To 1 Client';
        } else {
          sendGroupMessageBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send To ' + String(selectedCount) + ' Clients';
        }
      }

      function renderGroupMessageHistoryPlaceholder(messageText) {
        if (!groupMessageHistory) return;
        groupMessageHistory.innerHTML = '<div class="group-msg-history-state">' + escapeHtmlLocal(messageText || 'Select a client to view history.') + '</div>';
      }

      function getVisibleClientById(clientId) {
        if (!NS.groupMessageClients || !NS.groupMessageClients.length) return null;
        var targetId = String(clientId);
        for (var i = 0; i < NS.groupMessageClients.length; i++) {
          if (String(NS.groupMessageClients[i].id) === targetId) return NS.groupMessageClients[i];
        }
        return null;
      }

      function selectGroupMessageClientRange(anchorId, targetId) {
        if (!NS.groupMessageClients || !NS.groupMessageClients.length) return;
        var orderedIds = NS.groupMessageClients.map(function(item) {
          return String(item.id);
        });
        var anchorIndex = orderedIds.indexOf(String(anchorId));
        var targetIndex = orderedIds.indexOf(String(targetId));
        if (anchorIndex < 0 || targetIndex < 0) return;

        var start = Math.min(anchorIndex, targetIndex);
        var end = Math.max(anchorIndex, targetIndex);
        for (var i = start; i <= end; i++) {
          NS.groupMessageSelectedClientIds.add(orderedIds[i]);
        }
      }

      async function loadFocusedClientMessages() {
        if (!groupMessageHistory) return;
        if (!NS.groupMessageFocusedClientId) {
          renderGroupMessageHistoryPlaceholder('Select a client from the left list to view message history.');
          return;
        }

        groupMessageHistory.innerHTML = '<div class="group-msg-history-state"><i class="fa-solid fa-spinner fa-spin"></i> Loading history...</div>';

        var response = await NS.fetchClientMessages(NS.groupMessageFocusedClientId);
        if (!response || !response.success) {
          groupMessageHistory.innerHTML = '<div class="group-msg-history-state" style="color:#ef4444;">Failed to load history.</div>';
          showToast((response && response.message) || 'Failed to load message history', 'error');
          return;
        }

        renderClientMessageHistory(response.messages || [], groupMessageHistory);
      }

      function setGroupMessageFocusedClient(clientId) {
        NS.groupMessageFocusedClientId = clientId ? String(clientId) : null;
        renderGroupMessageClientsList();
        loadFocusedClientMessages();
      }

      function renderGroupMessageClientsList() {
        if (!groupMessageClientsList) return;
        if (!NS.groupMessageClients || NS.groupMessageClients.length === 0) {
          groupMessageClientsList.innerHTML = '<div class="group-msg-history-state">No clients found.</div>';
          renderGroupMessageSelectedCount();
          renderGroupMessageTargetSummary();
          return;
        }

        groupMessageClientsList.innerHTML = NS.groupMessageClients.map(function(clientItem) {
          var clientId = String(clientItem.id);
          var isSelected = NS.groupMessageSelectedClientIds.has(clientId);
          var isFocused = String(NS.groupMessageFocusedClientId || '') === clientId;
          var rowClass = 'group-msg-client-row';
          if (isSelected) rowClass += ' selected';
          if (isFocused) rowClass += ' active';
          var statusText = clientItem.status === 'active' ? 'Active' : 'Inactive';
          var userText = clientItem.is_user_active ? 'Login active' : 'Login inactive';
          var logoUrl = resolveClientLogoUrl(clientItem);
          var logoHtml = logoUrl
            ? '<span class="group-msg-client-avatar"><img src="' + escapeHtmlLocal(logoUrl) + '" alt="' + escapeHtmlLocal(clientItem.name || 'Client') + ' logo" loading="lazy"></span>'
            : '<span class="group-msg-client-avatar"><i class="fa-solid fa-building"></i></span>';
          return (
            '<div class="' + rowClass + '" data-client-id="' + escapeHtmlLocal(clientId) + '">' +
              logoHtml +
              '<div class="group-msg-client-meta">' +
                '<span class="group-msg-client-name">' + escapeHtmlLocal(clientItem.name || '-') + '</span>' +
                '<span class="group-msg-client-sub">' + escapeHtmlLocal(statusText) + ' | ' + escapeHtmlLocal(userText) + '</span>' +
              '</div>' +
            '</div>'
          );
        }).join('');

        renderGroupMessageSelectedCount();
        renderGroupMessageTargetSummary();
      }

      function syncGroupMessageDurationVisibility() {
        var selectedVisibilityInput = document.querySelector('input[name="groupMessageVisibility"]:checked');
        var isTemporary = !!(selectedVisibilityInput && selectedVisibilityInput.value === 'temporary');
        if (groupMessageDurationWrap) groupMessageDurationWrap.style.display = isTemporary ? '' : 'none';
      }

      async function loadGroupMessageClients(queryText) {
        if (!groupMessageClientsList) return;
        groupMessageClientsList.innerHTML = '<div class="group-msg-history-state"><i class="fa-solid fa-spinner fa-spin"></i> Loading clients...</div>';

        var response = await NS.fetchClientMessageTargets(queryText || '');
        if (!response || !response.success) {
          groupMessageClientsList.innerHTML = '<div class="group-msg-history-state" style="color:#ef4444;">Failed to load clients.</div>';
          showToast((response && response.message) || 'Failed to load clients', 'error');
          return;
        }

        NS.groupMessageClients = Array.isArray(response.clients) ? response.clients : [];
        if (NS.groupMessageFocusedClientId && !getVisibleClientById(NS.groupMessageFocusedClientId)) {
          NS.groupMessageFocusedClientId = null;
        }
        renderGroupMessageClientsList();

        if (!NS.groupMessageFocusedClientId && NS.groupMessageSelectedClientIds.size === 1) {
          NS.groupMessageFocusedClientId = Array.from(NS.groupMessageSelectedClientIds)[0];
          renderGroupMessageClientsList();
        }

        if (NS.groupMessageFocusedClientId) {
          loadFocusedClientMessages();
        } else {
          renderGroupMessageHistoryPlaceholder('Select a client from the left list to view message history.');
        }
      }

      function openGroupMessageDrawerFn(preselectedClientIds, focusedClientId) {
        if (!groupMessageDrawer) return;

        var selectedIds = [];
        if (Array.isArray(preselectedClientIds) && preselectedClientIds.length) {
          selectedIds = preselectedClientIds;
        } else if (NS.selectedClientId) {
          selectedIds = [NS.selectedClientId];
        }

        NS.groupMessageSelectedClientIds = new Set(selectedIds.map(function(item) { return String(item); }));
        NS.groupMessageClients = [];
        NS.groupMessageFocusedClientId = focusedClientId
          ? String(focusedClientId)
          : (NS.groupMessageSelectedClientIds.size === 1 ? Array.from(NS.groupMessageSelectedClientIds)[0] : null);
        NS.groupMessageLastClickedClientId = NS.groupMessageFocusedClientId;

        if (groupMessageText) groupMessageText.value = '';
        if (groupMessageCounter) groupMessageCounter.textContent = '0 / 2000';
        if (groupMessageClientSearch) groupMessageClientSearch.value = '';
        if (groupMessageTemporaryDuration) groupMessageTemporaryDuration.value = '6h';

        var selectedScope = document.querySelector('input[name="groupMessageScope"][value="client_only"]');
        if (selectedScope) selectedScope.checked = true;
        var selectedVisibility = document.querySelector('input[name="groupMessageVisibility"][value="permanent"]');
        if (selectedVisibility) selectedVisibility.checked = true;
        syncGroupMessageDurationVisibility();
        renderGroupMessageSelectedCount();
        renderGroupMessageTargetSummary();
        renderGroupMessageHistoryPlaceholder('Select a client from the left list to view message history.');

        groupMessageDrawer.classList.add('open');
        document.body.style.overflow = 'hidden';
        loadGroupMessageClients('');
      }

      function closeGroupMessageDrawerFn() {
        if (!groupMessageDrawer) return;
        groupMessageDrawer.classList.remove('open');
        document.body.style.overflow = '';
      }

      // ==================== EVENT HANDLERS ====================
      if (addClientBtn && !addClientBtn.dataset.drawerAttached) {
        addClientBtn.addEventListener('click', function() { NS.openDrawer('add'); });
        addClientBtn.dataset.drawerAttached = '1';
      }
      if (openGroupMessageBtn) {
        openGroupMessageBtn.addEventListener('click', function() {
          openGroupMessageDrawerFn();
        });
      }

      if (editClientBtn) editClientBtn.addEventListener('click', async function() {
        if (!NS.selectedClientId) return;
        var clientData = await NS.fetchClientDetails(NS.selectedClientId);
        if (clientData) NS.openDrawer('edit', clientData);
      });

      if (viewClientBtn) viewClientBtn.addEventListener('click', async function() {
        if (!NS.selectedClientId) return;
        var clientData = await NS.fetchClientDetails(NS.selectedClientId);
        if (clientData) NS.openViewModal(clientData);
      });

      if (deleteClientBtn) deleteClientBtn.addEventListener('click', function() {
        if (!NS.selectedClientId || !NS.selectedRow) return;
        var clientName = getSelectedClientName();

        // If the selected client still has groups/lists/media, show a helpful
        // error instead of proceeding to the delete confirmation modal.
        var hasDataFlag = String(NS.selectedRow.dataset.clientHasData || deleteClientBtn.dataset.clientHasData || 'false');
        if (hasDataFlag === 'true') {
          var msg = 'Please delete all groups, lists, and media for ' + clientName + ' before deleting this client.';
          if (typeof showToast === 'function') {
            showToast(msg, 'error');
          } else {
            alert(msg);
          }
          return;
        }

        NS.openDeleteModalFn(clientName);
      });

      if (activeClientBtn) activeClientBtn.addEventListener('click', function() {
        if (!NS.selectedClientId || !NS.selectedRow) return;
        var clientName = getSelectedClientName();
        var currentStatus = NS.selectedRow.dataset.clientStatus;
        NS.pendingStatusClientId = NS.selectedClientId;
        NS.openStatusModalFn(clientName, currentStatus);
      });

      if (groupSettingBtn) groupSettingBtn.addEventListener('click', function() {
        if (!NS.selectedClientId) return;
        window.location.href = clientSettingsUrl(NS.selectedClientId);
      });

      if (idcardGroupBtn) idcardGroupBtn.addEventListener('click', function() {
        if (!NS.selectedClientId) return;
        window.location.href = clientGroupsUrl(NS.selectedClientId);
      });

      clientForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        // Prevent double submission
        var submitBtn = clientForm.querySelector('button[type="submit"]');
        if (submitBtn.disabled) return;
        submitBtn.disabled = true;
        var originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        var formData = {
          name: document.getElementById('clientName').value.trim(),
          email: document.getElementById('clientEmail').value.trim(),
          phone: document.getElementById('clientPhone').value.trim(),
          address: document.getElementById('clientAddress').value,
          is_active: document.getElementById('clientStatus').value === 'true',
        };

        var clientId = clientIdInput.value;
        var isCreateMode = !clientId;

        if (!formData.name) {
          showToast('Name is required', 'error');
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
          return;
        }

        // Sanitize text fields (strip newlines, forbidden chars); email is exempt from char rules
        if (window.DataSanitizer) {
          var sanitized = DataSanitizer.sanitizeFormData(formData, ['email']);
          formData = sanitized.data;
        }

        // Validate/create password strategy
        var pwOption = document.getElementById('clientPasswordOption');
        var pwVal = document.getElementById('clientPassword');
        if (isCreateMode && pwOption) {
          if (pwOption.value === 'custom') {
            if (!pwVal || !pwVal.value.trim()) {
              showToast('Custom password is required when phone password is not used', 'error');
              submitBtn.disabled = false;
              submitBtn.innerHTML = originalText;
              return;
            }
            formData.password = pwVal.value.trim();
          } else if (!formData.phone) {
            showToast('Phone is required when using phone number as password', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
            return;
          }
        }

        // Add all permissions for users with full manage-clients capability.
        if (NS.canManageClients) {
          NS.permissionFields.forEach(function(field) {
            var el = document.getElementById(field);
            if (el) formData[field] = el.checked;
          });
        }

        // Include client logo removal flag if set (remove_logo). If a new file is selected, ignore remove flag.
        try {
          var logoRemoveEl = document.getElementById('clientLogoRemove');
          var removeLogoVal = logoRemoveEl ? (logoRemoveEl.value === '1' || logoRemoveEl.value === 'true') : false;
          if (NS.selectedProfileFile) removeLogoVal = false;
          formData.remove_logo = removeLogoVal;
        } catch (ex) {
          // noop
        }

        var result;

        try {
          if (clientId) {
            result = await NS.updateClient(clientId, formData, NS.selectedProfileFile);
          } else {
            result = await NS.createClient(formData, NS.selectedProfileFile);
          }

          // Clear any previous email error
          var emailError = document.getElementById('clientEmailError');
          var emailInput = document.getElementById('clientEmail');
          if (emailError) emailError.style.display = 'none';
          if (emailInput) emailInput.style.borderColor = '';

          if (result.success) {
            showToast(result.message, 'success');
            NS.selectedProfileFile = null; // Reset after successful upload
            NS.closeDrawerFn();
            // Refresh table via HTMX instead of full page reload
            if (typeof htmx !== 'undefined' && document.getElementById('client-table-container')) {
              setTimeout(function() { htmx.trigger(document.body, 'refreshTable'); }, 300);
            } else {
              setTimeout(function() { location.reload(); }, 500);
            }
          } else {
            // Check if it's an email duplicate error
            if (result.message && result.message.toLowerCase().includes('email already exists')) {
              if (emailError) {
                emailError.textContent = result.message;
                emailError.style.display = 'block';
              }
              if (emailInput) {
                emailInput.style.borderColor = '#ef4444';
                emailInput.focus();
              }
            }
            showToast(result.message || 'Operation failed', 'error');
            // Re-enable button on error
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
          }
        } catch (error) {
          console.error('Form submission error:', error);
          showToast(error && error.message ? error.message : 'An error occurred', 'error');
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      });

      if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async function() {
          if (!NS.selectedClientId) return;

          var originalHtml = confirmDeleteBtn.innerHTML;
          confirmDeleteBtn.disabled = true;
          confirmDeleteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';

          try {
            var result = await NS.deleteClientApi(NS.selectedClientId);
            if (result && result.success) {
              showToast(result.message || 'Client deleted successfully', 'success');
              NS.closeDeleteModalFn();
              if (NS.selectedRow && typeof NS.selectedRow.remove === 'function') {
                NS.selectedRow.remove();
              }
              NS.selectedClientId = null;
              NS.selectedRow = null;
              NS.disableActionButtons();
            } else {
              showToast((result && result.message) || 'Failed to delete client', 'error');
            }
          } catch (err) {
            showToast((err && err.message) || 'Delete request failed', 'error');
          } finally {
            confirmDeleteBtn.disabled = false;
            confirmDeleteBtn.innerHTML = originalHtml;
          }
        });
      }

      // Status change confirmation handler
      if (confirmStatusBtn) confirmStatusBtn.addEventListener('click', async function() {
        if (!NS.pendingStatusClientId) return;

        var result = await NS.toggleClientStatus(NS.pendingStatusClientId);
        if (result.success) {
          showToast(result.message, 'success');
          NS.closeStatusModalFn();

          NS.selectedRow.dataset.clientStatus = result.status;
          var statusBadge = NS.selectedRow.querySelector('.status-badge');
          statusBadge.textContent = result.status_display;
          statusBadge.className = 'status-badge ' + (result.status === 'active' ? 'active' : 'inactive');

          if (result.status === 'active') {
            activeClientBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Inactive';
            activeClientBtn.classList.remove('btn-active');
            activeClientBtn.classList.add('btn-inactive');
          } else {
            activeClientBtn.innerHTML = '<i class="fa-solid fa-check"></i> Active';
            activeClientBtn.classList.remove('btn-inactive');
            activeClientBtn.classList.add('btn-active');
          }
        } else {
          showToast(result.message || 'Failed to update status', 'error');
        }
      });

      if (editFromViewBtn) editFromViewBtn.addEventListener('click', async function() {
        NS.closeViewModalFn();
        if (NS.selectedClientId) {
          var clientData = await NS.fetchClientDetails(NS.selectedClientId);
          if (clientData) NS.openDrawer('edit', clientData);
        }
      });

      if (closeClientDrawer) closeClientDrawer.addEventListener('click', function() { NS.closeDrawerFn(); });
      if (cancelClientDrawer) cancelClientDrawer.addEventListener('click', function() { NS.closeDrawerFn(); });
      if (closeViewModal) closeViewModal.addEventListener('click', function() { NS.closeViewModalFn(); });
      if (closeViewModalBtn) closeViewModalBtn.addEventListener('click', function() { NS.closeViewModalFn(); });
      // Close handlers for delete/status modals now managed by Alpine @click in template

      if (closeGroupMessageDrawer) closeGroupMessageDrawer.addEventListener('click', closeGroupMessageDrawerFn);
      if (cancelGroupMessageBtn) cancelGroupMessageBtn.addEventListener('click', closeGroupMessageDrawerFn);

      if (groupMessageText && groupMessageCounter) {
        groupMessageText.addEventListener('input', function() {
          groupMessageCounter.textContent = String(groupMessageText.value.length) + ' / 2000';
        });
      }

      if (groupMessageClientSearch) {
        var groupSearchTimer = null;
        groupMessageClientSearch.addEventListener('input', function() {
          if (groupSearchTimer) clearTimeout(groupSearchTimer);
          groupSearchTimer = setTimeout(function() {
            loadGroupMessageClients(groupMessageClientSearch.value || '');
          }, 250);
        });
      }

      if (groupMessageClientsList) {
        groupMessageClientsList.addEventListener('click', function(e) {
          var row = e.target.closest('.group-msg-client-row');
          if (!row) return;
          var clientId = row.getAttribute('data-client-id');
          if (!clientId) return;

          clientId = String(clientId);
          var isShiftSelect = !!e.shiftKey && !!NS.groupMessageLastClickedClientId;

          if (isShiftSelect) {
            selectGroupMessageClientRange(NS.groupMessageLastClickedClientId, clientId);
          } else {
            if (NS.groupMessageSelectedClientIds.has(clientId)) {
              NS.groupMessageSelectedClientIds.delete(clientId);
            } else {
              NS.groupMessageSelectedClientIds.add(clientId);
            }
          }

          NS.groupMessageFocusedClientId = clientId;
          NS.groupMessageLastClickedClientId = clientId;
          renderGroupMessageClientsList();
          loadFocusedClientMessages();
        });
      }

      if (groupMessageHistory) {
        groupMessageHistory.addEventListener('click', async function(e) {
          var deleteBtn = e.target.closest('[data-delete-client-message]');
          if (!deleteBtn) return;
          if (!NS.groupMessageFocusedClientId) return;

          var messageId = deleteBtn.getAttribute('data-delete-client-message');
          if (!messageId) return;

          deleteBtn.disabled = true;
          deleteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
          var result = await NS.deleteClientMessage(NS.groupMessageFocusedClientId, messageId);
          if (!result || !result.success) {
            showToast((result && result.message) || 'Failed to remove message', 'error');
          } else {
            showToast(result.message || 'Message removed from client inbox', 'success');
          }
          loadFocusedClientMessages();
        });
      }

      if (groupMessageSelectAllVisibleBtn) {
        groupMessageSelectAllVisibleBtn.addEventListener('click', function() {
          if (!NS.groupMessageClients || !NS.groupMessageClients.length) return;
          NS.groupMessageClients.forEach(function(item) {
            NS.groupMessageSelectedClientIds.add(String(item.id));
          });
          renderGroupMessageClientsList();
        });
      }

      if (groupMessageClearSelectionBtn) {
        groupMessageClearSelectionBtn.addEventListener('click', function() {
          NS.groupMessageSelectedClientIds = new Set();
          NS.groupMessageFocusedClientId = null;
          NS.groupMessageLastClickedClientId = null;
          renderGroupMessageClientsList();
          renderGroupMessageHistoryPlaceholder('Select a client from the left list to view message history.');
        });
      }

      var groupVisibilityInputs = document.querySelectorAll('input[name="groupMessageVisibility"]');
      if (groupVisibilityInputs && groupVisibilityInputs.length) {
        groupVisibilityInputs.forEach(function(el) {
          el.addEventListener('change', syncGroupMessageDurationVisibility);
        });
        syncGroupMessageDurationVisibility();
      }

      async function sendGroupMessage(triggerBtn) {
        var textValue = (groupMessageText && groupMessageText.value ? groupMessageText.value : '').trim();
        if (!textValue) {
          showToast('Message is required', 'error');
          return;
        }

        var selectedScopeInput = document.querySelector('input[name="groupMessageScope"]:checked');
        var selectedVisibilityInput = document.querySelector('input[name="groupMessageVisibility"]:checked');
        var visibilityValue = selectedVisibilityInput ? selectedVisibilityInput.value : 'permanent';
        var selectedClientIds = Array.from(NS.groupMessageSelectedClientIds || []);
        var targetMode = selectedClientIds.length ? 'selected' : 'all';

        var payload = {
          message: textValue,
          scope: selectedScopeInput ? selectedScopeInput.value : 'client_only',
          visibility: visibilityValue,
          target_mode: targetMode
        };

        if (visibilityValue === 'temporary') {
          payload.temporary_duration = groupMessageTemporaryDuration ? groupMessageTemporaryDuration.value : '';
          if (!payload.temporary_duration) {
            showToast('Please select temporary duration', 'error');
            return;
          }
        }

        if (targetMode === 'selected') {
          payload.client_ids = selectedClientIds;
        }

        if (triggerBtn) {
          triggerBtn.disabled = true;
          triggerBtn.dataset.originalHtml = triggerBtn.innerHTML;
          triggerBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
        }

        var result = await NS.sendClientGroupMessage(payload);

        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.innerHTML = triggerBtn.dataset.originalHtml || triggerBtn.innerHTML;
        }

        if (!result || !result.success) {
          showToast((result && result.message) || 'Failed to send group message', 'error');
          return;
        }

        showToast(result.message || 'Group message sent', 'success');
        if (groupMessageText) groupMessageText.value = '';
        if (groupMessageCounter) groupMessageCounter.textContent = '0 / 2000';
        if (NS.groupMessageFocusedClientId) loadFocusedClientMessages();
        renderGroupMessageTargetSummary();
      }

      if (sendGroupMessageBtn) {
        sendGroupMessageBtn.addEventListener('click', function() {
          sendGroupMessage(sendGroupMessageBtn);
        });
      }

      document.body.addEventListener('htmx:afterSwap', function(e) {
        if (e.target && e.target.id === 'client-table-container') {
          NS.selectedClientId = null;
          NS.selectedRow = null;
          if (typeof NS.disableActionButtons === 'function') {
            NS.disableActionButtons();
          }
        }
      });

      // Outside click close disabled  prevent accidental closure

      // ==================== STAFF DRAWER ====================
      var staffDrawer = document.getElementById('staff-drawer');
      var closeStaffDrawer = document.getElementById('closeStaffDrawer');
      var closeStaffDrawerBtn = document.getElementById('closeStaffDrawerBtn');
      var staffDrawerClientName = document.getElementById('staffDrawerClientName');
      var staffDrawerClientLogo = document.getElementById('staffDrawerClientLogo');
      var staffList = document.getElementById('staffList');
      var noStaffMessage = document.getElementById('noStaffMessage');
      var totalStaffCount = document.getElementById('totalStaffCount');
      var activeStaffCount = document.getElementById('activeStaffCount');
      var inactiveStaffCount = document.getElementById('inactiveStaffCount');

      // Permission label mapping
      var permissionLabels = {
        'perm_idcard_client_list': 'Manage Assistant',
        'perm_idcard_setting_list': 'View Template List',
        'perm_idcard_setting_add': 'Create New Template',
        'perm_idcard_setting_edit': 'Edit Template',
        'perm_idcard_setting_delete': 'Delete Template',
        'perm_idcard_setting_status': 'Enable / Disable Template',
        'perm_idcard_pending_list': 'Pending List',
        'perm_idcard_verified_list': 'Verified List',
        'perm_idcard_pool_list': 'Pool List',
        'perm_idcard_approved_list': 'Approved List',
        'perm_idcard_download_list': 'Download List',
        'perm_reprint_request_list': 'Reprint Request List',
        'perm_confirmed_list': 'Confirmed List',
        'perm_idcard_bulk_download': 'Bulk Download',
        'perm_idcard_download_image_rename_mode': 'Download Images Rename Mode',
        'perm_idcard_download_image_generate_mode': 'Download Images Generate Mode',
        'perm_idcard_add': 'Add Card',
        'perm_idcard_edit': 'Edit Card',
        'perm_idcard_delete': 'Delete Card',
        'perm_idcard_info': 'Card Info',
        'perm_idcard_verify': 'Verify Card',
        'perm_idcard_reprint_list': 'Reprint Cards',
        'perm_idcard_updated_at': 'Updated At Details',
        'perm_mobile_app': 'Mobile App Access'
      };

      function humanizePermissionKey(key) {
        return String(key || '')
          .replace(/^perm_/, '')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, function(ch) { return ch.toUpperCase(); });
      }

      async function fetchClientStaff(clientId) {
        try {
          var data = await ApiClient.get('/api/client/' + clientId + '/staff/');
          if (data.success) {
            return data;
          } else {
            showToast(data.message || 'Failed to fetch staff', 'error');
            return null;
          }
        } catch (error) {
          showToast(error && error.message ? error.message : 'Network error. Please try again.', 'error');
          return null;
        }
      }

      function formatPermissions(staff) {
        if (!staff || typeof staff !== 'object') return [];

        return Object.keys(staff)
          .filter(function(key) {
            return key.indexOf('perm_') === 0 && staff[key] === true;
          })
          .map(function(key) {
            return permissionLabels[key] || humanizePermissionKey(key);
          })
          .sort();
      }

      function ensureStaffSkeletonStyles() {
        if (document.getElementById('staffSkeletonStyles')) return;
        var style = document.createElement('style');
        style.id = 'staffSkeletonStyles';
        style.textContent = [
          '@keyframes staff-skeleton-shimmer {',
          '  0% { background-position: 200% 0; }',
          '  100% { background-position: -200% 0; }',
          '}',
          '.staff-loading-skeleton { display: flex; flex-direction: column; gap: 8px; width: 100%; }',
          '.staff-loading-skeleton-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; background: #fff; }',
          '.staff-loading-skeleton-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }',
          '.staff-loading-skeleton-row:last-child { margin-bottom: 0; }',
          '.staff-loading-skeleton-block {',
          '  border-radius: 8px;',
          '  background: linear-gradient(90deg, #e2e8f0 25%, #f8fafc 37%, #e2e8f0 63%);',
          '  background-size: 200% 100%;',
          '  animation: staff-skeleton-shimmer 1.25s linear infinite;',
          '}',
          '.staff-loading-skeleton-avatar { width: 34px; height: 34px; border-radius: 8px; flex-shrink: 0; }',
          '.staff-loading-skeleton-line-lg { width: 58%; height: 11px; }',
          '.staff-loading-skeleton-line-md { width: 36%; height: 10px; }',
          '.staff-loading-skeleton-line-full { width: 100%; height: 10px; }'
        ].join('');
        document.head.appendChild(style);
      }

      function getStaffSkeletonHtml() {
        var items = [];
        for (var i = 0; i < 3; i++) {
          items.push(
            '<div class="staff-loading-skeleton-card" aria-hidden="true">' +
              '<div class="staff-loading-skeleton-row">' +
                '<span class="staff-loading-skeleton-block staff-loading-skeleton-avatar"></span>' +
                '<span class="staff-loading-skeleton-block staff-loading-skeleton-line-lg"></span>' +
              '</div>' +
              '<div class="staff-loading-skeleton-row">' +
                '<span class="staff-loading-skeleton-block staff-loading-skeleton-line-md"></span>' +
              '</div>' +
              '<div class="staff-loading-skeleton-row">' +
                '<span class="staff-loading-skeleton-block staff-loading-skeleton-line-full"></span>' +
              '</div>' +
            '</div>'
          );
        }
        return '<div class="staff-loading-skeleton">' + items.join('') + '</div><span class="sr-only">Loading staff...</span>';
      }

      async function openStaffDrawer() {
        if (!NS.selectedClientId || !NS.selectedRow) return;

        var clientName = getSelectedClientName() || 'Client';
        var clientLogo = getSelectedClientLogo();
        if (staffDrawerClientName) {
          staffDrawerClientName.textContent = clientName;
        }
        if (staffDrawerClientLogo) {
          if (clientLogo) {
            staffDrawerClientLogo.innerHTML = '<img src="' + escapeHtmlLocal(clientLogo) + '" alt="' + escapeHtmlLocal(clientName) + ' logo" style="width:100%;height:100%;object-fit:contain;background:#fff;padding:3px;">';
          } else {
            staffDrawerClientLogo.innerHTML = '<i class="fa-solid fa-building" style="font-size:12px;"></i>';
          }
        }

        // Show loading state
        ensureStaffSkeletonStyles();
        staffList.innerHTML = getStaffSkeletonHtml();
        staffList.style.display = 'flex';
        noStaffMessage.style.display = 'none';
        var skeletonStart = Date.now();

        staffDrawer.classList.add('open');
        document.body.style.overflow = 'hidden';

        var data = await fetchClientStaff(NS.selectedClientId);
        await waitForMinDelay(skeletonStart);

        if (data && data.staff) {
          var staffData = data.staff;

          // Update summary counts
          totalStaffCount.textContent = data.total || 0;
          activeStaffCount.textContent = data.active || 0;
          inactiveStaffCount.textContent = data.inactive || 0;

          if (staffData.length === 0) {
            staffList.style.display = 'none';
            noStaffMessage.style.display = 'flex';
          } else {
            staffList.style.display = 'flex';
            noStaffMessage.style.display = 'none';

            staffList.innerHTML = staffData.map(function(staff) {
              var permissions = formatPermissions(staff);
              var statusClass = staff.is_active ? 'active' : 'inactive';
              var statusText = staff.is_active ? 'Active' : 'Inactive';
              var toggleBtnText = staff.is_active ? 'Deactivate' : 'Activate';
              var toggleBtnIcon = staff.is_active ? 'fa-user-slash' : 'fa-user-check';
              var toggleBtnClass = staff.is_active ? 'btn-deactivate' : 'btn-activate';

              return '<div class="staff-card" data-staff-id="' + staff.id + '">' +
                '<div class="staff-card-header">' +
                  '<div class="staff-avatar ' + statusClass + '">' +
                    '<i class="fa-solid fa-user"></i>' +
                  '</div>' +
                  '<div class="staff-main-info">' +
                    '<div class="staff-name">' + (staff.name || 'N/A') + '</div>' +
                    '<div class="staff-role">' + (staff.designation || 'Staff') + '</div>' +
                  '</div>' +
                  '<span class="staff-status-badge ' + statusClass + '">' + statusText + '</span>' +
                '</div>' +
                '<div class="staff-card-body">' +
                  '<div class="staff-detail-row">' +
                    '<div class="staff-detail">' +
                      '<i class="fa-solid fa-envelope"></i>' +
                      '<span>' + (staff.email || '-') + '</span>' +
                    '</div>' +
                    '<div class="staff-detail">' +
                      '<i class="fa-solid fa-phone"></i>' +
                      '<span>' + (staff.phone || '-') + '</span>' +
                    '</div>' +
                  '</div>' +
                  '<div class="staff-detail-row">' +
                    '<div class="staff-detail">' +
                      '<i class="fa-solid fa-building"></i>' +
                      '<span>' + (staff.department || '-') + '</span>' +
                    '</div>' +
                    '<div class="staff-detail">' +
                      '<i class="fa-solid fa-calendar-plus"></i>' +
                      '<span>Created: ' + (staff.created_at || '-') + '</span>' +
                    '</div>' +
                  '</div>' +
                  (staff.address ? '<div class="staff-detail-row"><div class="staff-detail col-span-2"><i class="fa-solid fa-location-dot"></i><span>' + staff.address + '</span></div></div>' : '') +
                  '<div class="staff-permissions">' +
                    '<div class="permissions-label"><i class="fa-solid fa-shield-halved"></i> Permissions:</div>' +
                    '<div class="permissions-tags">' +
                      (permissions.length > 0 
                        ? permissions.map(function(p) { return '<span class="permission-tag">' + p + '</span>'; }).join('') 
                        : '<span class="no-permissions">No permissions assigned</span>') +
                    '</div>' +
                  '</div>' +
                  (NS.canManageClients ? '<div class="staff-actions"><button class="btn btn-sm ' + toggleBtnClass + '" onclick="toggleClientStaffStatus(' + staff.id + ')" title="' + toggleBtnText + '"><i class="fa-solid ' + toggleBtnIcon + '"></i> ' + toggleBtnText + '</button></div>' : '') +
                '</div>' +
              '</div>';
            }).join('');
          }
        } else {
          staffList.style.display = 'none';
          noStaffMessage.style.display = 'flex';
          totalStaffCount.textContent = '0';
          activeStaffCount.textContent = '0';
          inactiveStaffCount.textContent = '0';
        }
      }

      // Toggle assistent status (requires full manage-clients capability)
      window.toggleClientStaffStatus = async function(staffId) {
        if (!NS.selectedClientId || !NS.canManageClients) return;

        try {
          var result = await ApiClient.post('/api/client/' + NS.selectedClientId + '/staff/' + staffId + '/toggle-status/', {});

          if (result.success) {
            showToast(result.message, 'success');
            // Refresh the staff drawer to show updated status
            await openStaffDrawer();
          } else {
            showToast(result.message || 'Failed to toggle staff status', 'error');
          }
        } catch (error) {
          showToast(error && error.message ? error.message : 'Network error. Please try again.', 'error');
        }
      };

      function closeStaffDrawerFn() {
        staffDrawer.classList.remove('open');
        document.body.style.overflow = '';
      }

      if (viewStaffBtn) viewStaffBtn.addEventListener('click', openStaffDrawer);
      if (closeStaffDrawer) closeStaffDrawer.addEventListener('click', closeStaffDrawerFn);
      if (closeStaffDrawerBtn) closeStaffDrawerBtn.addEventListener('click', closeStaffDrawerFn);

      // Close on Escape key
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          if (groupMessageDrawer && groupMessageDrawer.classList.contains('open')) { closeGroupMessageDrawerFn(); return; }
          if (staffDrawer && staffDrawer.classList.contains('open')) { closeStaffDrawerFn(); return; }
          if (viewModal && viewModal.classList.contains('open')) { NS.closeViewModalFn(); return; }
          if (clientDrawer && clientDrawer.classList.contains('open')) { NS.closeDrawerFn(); return; }
        }
      });
    });
