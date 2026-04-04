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

      var closeClientDrawer = document.getElementById('closeClientDrawer');
      var cancelClientDrawer = document.getElementById('cancelClientDrawer');
      var closeViewModal = document.getElementById('closeViewModal');
      var closeViewModalBtn = document.getElementById('closeViewModalBtn');
      var editFromViewBtn = document.getElementById('editFromViewBtn');
      var confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
      var confirmStatusBtn = document.getElementById('confirmStatusBtn');
      var clientTableContainer = document.getElementById('client-table-container');

      var clientMessageDrawer = document.getElementById('client-message-drawer');
      var closeClientMessageDrawer = document.getElementById('closeClientMessageDrawer');
      var cancelClientMessageBtn = document.getElementById('cancelClientMessageBtn');
      var sendClientMessageBtn = document.getElementById('sendClientMessageBtn');
      var refreshClientMessagesBtn = document.getElementById('refreshClientMessagesBtn');
      var clientMessageDrawerClientName = document.getElementById('clientMessageDrawerClientName');
      var clientMessageHistory = document.getElementById('clientMessageHistory');
      var clientMessageText = document.getElementById('clientMessageText');
      var clientMessageCounter = document.getElementById('clientMessageCounter');

      NS.messageDrawerClientId = null;

      function escapeHtmlLocal(value) {
        var text = String(value == null ? '' : value);
        return text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function renderClientMessageHistory(messages) {
        if (!clientMessageHistory) return;
        if (!messages || messages.length === 0) {
          clientMessageHistory.innerHTML = '<div style="text-align:center;padding:18px 10px;color:#64748b;font-size:13px;">No messages sent yet.</div>';
          return;
        }

        clientMessageHistory.innerHTML = messages.map(function(item) {
          return (
            '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">' +
                '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#2563eb;background:#eff6ff;border:1px solid #bfdbfe;border-radius:999px;padding:2px 8px;">' + escapeHtmlLocal(item.scope_display || item.scope || '-') + '</span>' +
                '<span style="font-size:11px;color:#64748b;">' + escapeHtmlLocal(item.created_at_display || '-') + '</span>' +
              '</div>' +
              '<div style="font-size:13px;line-height:1.5;color:#1e293b;white-space:pre-wrap;">' + escapeHtmlLocal(item.message || '') + '</div>' +
              '<div style="margin-top:8px;font-size:11px;color:#64748b;display:flex;justify-content:space-between;gap:8px;">' +
                '<span>By: ' + escapeHtmlLocal(item.sent_by_name || 'System') + '</span>' +
                '<span>Recipients: ' + escapeHtmlLocal(item.recipient_count || 0) + '</span>' +
              '</div>' +
            '</div>'
          );
        }).join('');
      }

      async function loadClientMessages() {
        if (!NS.messageDrawerClientId) return;
        if (clientMessageHistory) {
          clientMessageHistory.innerHTML = '<div style="text-align:center;padding:18px 10px;color:#64748b;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading history...</div>';
        }
        var response = await NS.fetchClientMessages(NS.messageDrawerClientId);
        if (!response || !response.success) {
          if (clientMessageHistory) {
            clientMessageHistory.innerHTML = '<div style="text-align:center;padding:18px 10px;color:#ef4444;font-size:13px;">Failed to load history.</div>';
          }
          showToast((response && response.message) || 'Failed to load message history', 'error');
          return;
        }
        renderClientMessageHistory(response.messages || []);
      }

      function openClientMessageDrawer(clientId, clientName) {
        if (!clientMessageDrawer) return;
        NS.messageDrawerClientId = clientId;
        if (clientMessageDrawerClientName) clientMessageDrawerClientName.textContent = clientName || '-';
        if (clientMessageText) {
          clientMessageText.value = '';
          clientMessageText.focus();
        }
        if (clientMessageCounter) clientMessageCounter.textContent = '0 / 2000';

        var selectedScope = document.querySelector('input[name="clientMessageScope"][value="client_only"]');
        if (selectedScope) selectedScope.checked = true;

        clientMessageDrawer.classList.add('open');
        document.body.style.overflow = 'hidden';
        loadClientMessages();
      }

      function closeClientMessageDrawerFn() {
        if (!clientMessageDrawer) return;
        clientMessageDrawer.classList.remove('open');
        NS.messageDrawerClientId = null;
        document.body.style.overflow = '';
      }

      // ==================== EVENT HANDLERS ====================
      if (addClientBtn) addClientBtn.addEventListener('click', function() { NS.openDrawer('add'); });

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

      if (clientTableContainer) {
        clientTableContainer.addEventListener('click', function(e) {
          var messageBtn = e.target.closest('.client-message-btn');
          if (!messageBtn) return;
          e.preventDefault();
          e.stopPropagation();

          var row = messageBtn.closest('tr');
          if (row) NS.selectRow(row);

          var targetClientId = messageBtn.dataset.clientId || (row && row.dataset.clientId);
          var targetClientName = messageBtn.dataset.clientName || (row ? row.querySelector('td:first-child').textContent.trim() : '');
          if (!targetClientId) {
            showToast('Client not found', 'error');
            return;
          }
          openClientMessageDrawer(targetClientId, targetClientName);
        });
      }

      if (deleteClientBtn) deleteClientBtn.addEventListener('click', function() {
        if (!NS.selectedClientId || !NS.selectedRow) return;
        var clientName = NS.selectedRow.querySelector('td:first-child').textContent;
        NS.openDeleteModalFn(clientName);
      });

      if (activeClientBtn) activeClientBtn.addEventListener('click', function() {
        if (!NS.selectedClientId || !NS.selectedRow) return;
        var clientName = NS.selectedRow.querySelector('td:first-child').textContent;
        var currentStatus = NS.selectedRow.dataset.clientStatus;
        NS.pendingStatusClientId = NS.selectedClientId;
        NS.openStatusModalFn(clientName, currentStatus);
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

      confirmDeleteBtn.addEventListener('click', async function() {
        if (!NS.selectedClientId) return;

        var result = await NS.deleteClientApi(NS.selectedClientId);
        if (result.success) {
          showToast(result.message, 'success');
          NS.closeDeleteModalFn();
          NS.selectedRow.remove();
          NS.selectedClientId = null;
          NS.selectedRow = null;
          NS.disableActionButtons();
        } else {
          showToast(result.message || 'Failed to delete client', 'error');
        }
      });

      // Status change confirmation handler
      confirmStatusBtn.addEventListener('click', async function() {
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

      editFromViewBtn.addEventListener('click', async function() {
        NS.closeViewModalFn();
        if (NS.selectedClientId) {
          var clientData = await NS.fetchClientDetails(NS.selectedClientId);
          if (clientData) NS.openDrawer('edit', clientData);
        }
      });

      closeClientDrawer.addEventListener('click', function() { NS.closeDrawerFn(); });
      cancelClientDrawer.addEventListener('click', function() { NS.closeDrawerFn(); });
      closeViewModal.addEventListener('click', function() { NS.closeViewModalFn(); });
      closeViewModalBtn.addEventListener('click', function() { NS.closeViewModalFn(); });
      // Close handlers for delete/status modals now managed by Alpine @click in template

      if (closeClientMessageDrawer) closeClientMessageDrawer.addEventListener('click', closeClientMessageDrawerFn);
      if (cancelClientMessageBtn) cancelClientMessageBtn.addEventListener('click', closeClientMessageDrawerFn);

      if (refreshClientMessagesBtn) {
        refreshClientMessagesBtn.addEventListener('click', function() {
          loadClientMessages();
        });
      }

      if (clientMessageText && clientMessageCounter) {
        clientMessageText.addEventListener('input', function() {
          clientMessageCounter.textContent = String(clientMessageText.value.length) + ' / 2000';
        });
      }

      if (sendClientMessageBtn) {
        sendClientMessageBtn.addEventListener('click', async function() {
          if (!NS.messageDrawerClientId) return;
          var textValue = (clientMessageText && clientMessageText.value ? clientMessageText.value : '').trim();
          if (!textValue) {
            showToast('Message is required', 'error');
            return;
          }

          var selectedScopeInput = document.querySelector('input[name="clientMessageScope"]:checked');
          var payload = {
            message: textValue,
            scope: selectedScopeInput ? selectedScopeInput.value : 'client_only'
          };

          var originalHtml = sendClientMessageBtn.innerHTML;
          sendClientMessageBtn.disabled = true;
          sendClientMessageBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

          var result = await NS.sendClientMessage(NS.messageDrawerClientId, payload);
          sendClientMessageBtn.disabled = false;
          sendClientMessageBtn.innerHTML = originalHtml;

          if (!result || !result.success) {
            showToast((result && result.message) || 'Failed to send message', 'error');
            return;
          }

          showToast(result.message || 'Message sent', 'success');
          if (clientMessageText) {
            clientMessageText.value = '';
            clientMessageText.focus();
          }
          if (clientMessageCounter) clientMessageCounter.textContent = '0 / 2000';
          loadClientMessages();
        });
      }

      // Outside click close disabled  prevent accidental closure

      // ==================== STAFF DRAWER ====================
      var staffDrawer = document.getElementById('staff-drawer');
      var closeStaffDrawer = document.getElementById('closeStaffDrawer');
      var closeStaffDrawerBtn = document.getElementById('closeStaffDrawerBtn');
      var staffDrawerClientName = document.getElementById('staffDrawerClientName');
      var staffList = document.getElementById('staffList');
      var noStaffMessage = document.getElementById('noStaffMessage');
      var totalStaffCount = document.getElementById('totalStaffCount');
      var activeStaffCount = document.getElementById('activeStaffCount');
      var inactiveStaffCount = document.getElementById('inactiveStaffCount');

      // Permission label mapping
      var permissionLabels = {
        'perm_idcard_client_list': 'Manage Client',
        'perm_idcard_setting_list': 'View Template List',
        'perm_idcard_setting_add': 'Create New Template',
        'perm_idcard_setting_edit': 'Edit Template',
        'perm_idcard_setting_delete': 'Delete Template',
        'perm_idcard_setting_status': 'Enable / Disable Template'
      };

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
        var permissions = [];
        Object.keys(permissionLabels).forEach(function(key) {
          if (staff[key]) {
            permissions.push(permissionLabels[key]);
          }
        });
        return permissions;
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
          '.staff-loading-skeleton-avatar { width: 34px; height: 34px; border-radius: 9999px; flex-shrink: 0; }',
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

        var clientName = NS.selectedRow.querySelector('td:first-child').textContent;
        staffDrawerClientName.textContent = clientName;

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

      // Toggle client staff status (requires full manage-clients capability)
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

      viewStaffBtn.addEventListener('click', openStaffDrawer);
      closeStaffDrawer.addEventListener('click', closeStaffDrawerFn);
      closeStaffDrawerBtn.addEventListener('click', closeStaffDrawerFn);

      // Close on Escape key
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          if (clientMessageDrawer && clientMessageDrawer.classList.contains('open')) { closeClientMessageDrawerFn(); return; }
          if (staffDrawer && staffDrawer.classList.contains('open')) { closeStaffDrawerFn(); return; }
          if (viewModal && viewModal.classList.contains('open')) { NS.closeViewModalFn(); return; }
          if (clientDrawer && clientDrawer.classList.contains('open')) { NS.closeDrawerFn(); return; }
        }
      });
    });
