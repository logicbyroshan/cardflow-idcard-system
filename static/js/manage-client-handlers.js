/**
 * Manage Client Page — Button click handlers, form submit, delete/status confirm,
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
          name: document.getElementById('clientName').value,
          email: document.getElementById('clientEmail').value,
          phone: document.getElementById('clientPhone').value,
          address: document.getElementById('clientAddress').value,
          is_active: document.getElementById('clientStatus').value === 'true',
        };

        // Add custom password if selected
        var pwOption = document.getElementById('clientPasswordOption');
        if (pwOption && pwOption.value === 'custom') {
          var pwVal = document.getElementById('clientPassword');
          if (pwVal && pwVal.value.trim()) {
            formData.password = pwVal.value.trim();
          }
        }

        // Add all permissions (only if super admin)
        if (NS.isSuperAdmin) {
          NS.permissionFields.forEach(function(field) {
            var el = document.getElementById(field);
            if (el) formData[field] = el.checked;
          });
        }

        var clientId = clientIdInput.value;
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
          console.error('Form submission error:', error); // Debug log
          showToast('An error occurred', 'error');
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

      // Outside click close disabled — prevent accidental closure

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
        'perm_idcard_client_list': 'Manage Staff',
        'perm_idcard_setting_list': 'View Templates',
        'perm_idcard_setting_add': 'Add Template',
        'perm_idcard_setting_edit': 'Edit Template',
        'perm_idcard_setting_delete': 'Delete Template',
        'perm_idcard_setting_status': 'Toggle Template Status'
      };

      async function fetchClientStaff(clientId) {
        try {
          var data = await ApiClient.get('/panel/api/client/' + clientId + '/staff/');
          if (data.success) {
            return data;
          } else {
            showToast(data.message || 'Failed to fetch staff', 'error');
            return null;
          }
        } catch (error) {
          showToast('Network error. Please try again.', 'error');
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

      async function openStaffDrawer() {
        if (!NS.selectedClientId || !NS.selectedRow) return;

        var clientName = NS.selectedRow.querySelector('td:first-child').textContent;
        staffDrawerClientName.textContent = clientName;

        // Show loading state
        staffList.innerHTML = '<div class="loading-staff"><i class="fa-solid fa-spinner fa-spin"></i> Loading staff...</div>';
        staffList.style.display = 'flex';
        noStaffMessage.style.display = 'none';

        staffDrawer.classList.add('open');
        document.body.style.overflow = 'hidden';

        var data = await fetchClientStaff(NS.selectedClientId);

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
                  (NS.isSuperAdmin ? '<div class="staff-actions"><button class="btn btn-sm ' + toggleBtnClass + '" onclick="toggleClientStaffStatus(' + staff.id + ')" title="' + toggleBtnText + '"><i class="fa-solid ' + toggleBtnIcon + '"></i> ' + toggleBtnText + '</button></div>' : '') +
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

      // Toggle client staff status (Super Admin only)
      window.toggleClientStaffStatus = async function(staffId) {
        if (!NS.selectedClientId || !NS.isSuperAdmin) return;

        try {
          var result = await ApiClient.post('/panel/api/client/' + NS.selectedClientId + '/staff/' + staffId + '/toggle-status/', {});

          if (result.success) {
            showToast(result.message, 'success');
            // Refresh the staff drawer to show updated status
            await openStaffDrawer();
          } else {
            showToast(result.message || 'Failed to toggle staff status', 'error');
          }
        } catch (error) {
          showToast('Network error. Please try again.', 'error');
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
          if (staffDrawer && staffDrawer.classList.contains('open')) { closeStaffDrawerFn(); return; }
          if (viewModal && viewModal.classList.contains('open')) { NS.closeViewModalFn(); return; }
          if (clientDrawer && clientDrawer.classList.contains('open')) { NS.closeDrawerFn(); return; }
        }
      });
    });
