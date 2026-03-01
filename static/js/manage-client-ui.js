/**
 * Manage Client Page — UI: state, elements, dropdowns, row selection, drawer, modals
 * Split from manage-client.js — loaded first
 * Dependencies: api.js, toast.js, modal.js, utils.js, init.js, Alpine.js
 */
window.ManageClientPage = {};

document.addEventListener('DOMContentLoaded', function() {
      var NS = window.ManageClientPage;

      // ==================== SHARED STATE ====================
      NS.selectedClientId = null;
      NS.selectedRow = null;
      NS.selectedProfileFile = null; // Kept for API compatibility

      // Super Admin flag for client staff management
      NS.isSuperAdmin = window.isSuperAdmin || false;

      // ==================== ELEMENTS ====================
      var clientDrawer = document.getElementById('client-drawer');
      var clientForm = document.getElementById('clientForm');
      var clientIdInput = document.getElementById('clientId');
      var drawerTitle = document.getElementById('drawerTitleText');
      var drawerIcon = document.getElementById('drawerIcon');
      var submitBtn = document.getElementById('submitClientBtn');
      
      var viewModal = document.getElementById('view-modal');
      var deleteModal = document.getElementById('delete-modal');
      var toast = document.getElementById('toast');
      var toastMessage = document.getElementById('toastMessage');
      
      var addClientBtn = document.getElementById('addClientBtn');
      var editClientBtn = document.getElementById('editClientBtn');
      var viewClientBtn = document.getElementById('viewClientBtn');
      var viewStaffBtn = document.getElementById('viewStaffBtn');
      var deleteClientBtn = document.getElementById('deleteClientBtn');
      var activeClientBtn = document.getElementById('activeClientBtn');
      
      var table = document.getElementById('clientsTable');
      var tbody = table.querySelector('tbody');

      // Phase 1: Profile photo upload removed - using avatar placeholder

      // ==================== FORM STATUS DROPDOWN ====================
      var clientStatusDropdown = document.getElementById('clientStatusDropdown');
      var clientStatusInput = document.getElementById('clientStatus');

      NS.setClientStatusDropdown = function(val) {
        if (!clientStatusInput) return;
        clientStatusInput.value = val;
        if (!clientStatusDropdown) return;
        var toggle = clientStatusDropdown.querySelector('.dropdown-toggle span');
        var options = clientStatusDropdown.querySelectorAll('.dropdown-option');
        options.forEach(function(o) { o.classList.remove('selected'); });
        var match = clientStatusDropdown.querySelector('.dropdown-option[data-value="' + val + '"]');
        if (match) {
          match.classList.add('selected');
          if (toggle) toggle.textContent = match.textContent;
        }
      };

      if (clientStatusDropdown && clientStatusInput) {
        var toggleBtn = clientStatusDropdown.querySelector('.dropdown-toggle');
        var options = clientStatusDropdown.querySelectorAll('.dropdown-option');
        if (toggleBtn) {
          toggleBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            document.querySelectorAll('.custom-dropdown.open').forEach(function(d) { if (d !== clientStatusDropdown) d.classList.remove('open'); });
            clientStatusDropdown.classList.toggle('open');
          });
        }
        options.forEach(function(option) {
          option.addEventListener('click', function() {
            NS.setClientStatusDropdown(this.dataset.value);
            clientStatusDropdown.classList.remove('open');
          });
        });
        document.addEventListener('click', function(e) {
          if (!e.target.closest('.custom-dropdown')) clientStatusDropdown.classList.remove('open');
        });
      }

      // ==================== TOAST FUNCTIONS ====================
      // Using shared showToast from utils.js

      // ==================== PASSWORD OPTION DROPDOWN ====================
      var clientPasswordOptionDropdown = document.getElementById('clientPasswordOptionDropdown');
      var clientPasswordOptionInput = document.getElementById('clientPasswordOption');
      var clientCustomPasswordGroup = document.getElementById('clientCustomPasswordGroup');
      var clientPasswordInput = document.getElementById('clientPassword');

      NS.setClientPasswordOption = function(val) {
        if (!clientPasswordOptionInput) return;
        clientPasswordOptionInput.value = val;
        if (clientPasswordOptionDropdown) {
          var toggle = clientPasswordOptionDropdown.querySelector('.dropdown-toggle span');
          var options = clientPasswordOptionDropdown.querySelectorAll('.dropdown-option');
          options.forEach(function(o) { o.classList.remove('selected'); });
          var match = clientPasswordOptionDropdown.querySelector('.dropdown-option[data-value="' + val + '"]');
          if (match) {
            match.classList.add('selected');
            if (toggle) toggle.textContent = match.textContent;
          }
        }
        // Show/hide custom password field
        if (clientCustomPasswordGroup) {
          clientCustomPasswordGroup.style.display = val === 'custom' ? '' : 'none';
        }
        if (clientPasswordInput) {
          clientPasswordInput.required = val === 'custom';
          if (val !== 'custom') clientPasswordInput.value = '';
        }
      };

      if (clientPasswordOptionDropdown && clientPasswordOptionInput) {
        var pwToggleBtn = clientPasswordOptionDropdown.querySelector('.dropdown-toggle');
        var pwOptions = clientPasswordOptionDropdown.querySelectorAll('.dropdown-option');
        if (pwToggleBtn) {
          pwToggleBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            document.querySelectorAll('.custom-dropdown.open').forEach(function(d) { if (d !== clientPasswordOptionDropdown) d.classList.remove('open'); });
            clientPasswordOptionDropdown.classList.toggle('open');
          });
        }
        pwOptions.forEach(function(option) {
          option.addEventListener('click', function() {
            NS.setClientPasswordOption(this.dataset.value);
            clientPasswordOptionDropdown.classList.remove('open');
          });
        });
        document.addEventListener('click', function(e) {
          if (!e.target.closest('.custom-dropdown')) clientPasswordOptionDropdown.classList.remove('open');
        });
      }

      // ==================== SELECT ROW FUNCTION ====================
      NS.selectRow = function(row) {
        if (row && row.dataset.clientId) {
          tbody.querySelectorAll('tr').forEach(function(r) { r.classList.remove('selected'); });
          row.classList.add('selected');
          NS.selectedClientId = row.dataset.clientId;
          NS.selectedRow = row;
          
          if (editClientBtn) editClientBtn.disabled = false;
          if (viewClientBtn) viewClientBtn.disabled = false;
          if (viewStaffBtn) viewStaffBtn.disabled = false;
          if (deleteClientBtn) deleteClientBtn.disabled = false;
          if (activeClientBtn) activeClientBtn.disabled = false;
          
          var status = row.dataset.clientStatus;
          if (activeClientBtn) {
            if (status === 'active') {
              activeClientBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Inactive';
              activeClientBtn.classList.remove('btn-active');
              activeClientBtn.classList.add('btn-inactive');
            } else {
              activeClientBtn.innerHTML = '<i class="fa-solid fa-check"></i> Active';
              activeClientBtn.classList.remove('btn-inactive');
              activeClientBtn.classList.add('btn-active');
            }
          }
        }
      };

      // ==================== HIGHLIGHT FROM SEARCH ====================
      function highlightSearchResult() {
        var urlParams = new URLSearchParams(window.location.search);
        var highlightId = urlParams.get('highlight');
        
        if (highlightId) {
          // Find the row with this client ID
          var targetRow = document.querySelector('tr[data-client-id="' + highlightId + '"]');
          
          if (targetRow) {
            // Select the row (this uses the existing selection mechanism)
            NS.selectRow(targetRow);
            
            // Scroll to the row with a small delay to ensure page is loaded
            setTimeout(function() {
              targetRow.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center' 
              });
            }, 100);
            
            // Clean URL without highlight param after a short delay
            setTimeout(function() {
              var newUrl = new URL(window.location);
              newUrl.searchParams.delete('highlight');
              window.history.replaceState({}, '', newUrl);
            }, 1000);
          }
        }
      }
      
      // Call highlight function on page load
      highlightSearchResult();

      // ==================== ROW SELECTION ====================
      // Delegate from stable container to survive HTMX swaps
      var clientTableContainer = document.getElementById('client-table-container');
      if (clientTableContainer) {
        clientTableContainer.addEventListener('click', function(e) {
          var row = e.target.closest('tr');
          NS.selectRow(row);
        });

        // ==================== ROW DOUBLE-CLICK NAVIGATION ====================
        clientTableContainer.addEventListener('dblclick', function(e) {
          var row = e.target.closest('tr');
          if (row && row.dataset.clientId) {
            window.location.href = '/panel/client/' + row.dataset.clientId + '/settings/';
          }
        });
      }

      // ==================== PERMISSIONS LIST ====================
      NS.permissionFields = [
        'perm_idcard_client_list',
        'perm_idcard_setting_list', 'perm_idcard_setting_add', 'perm_idcard_setting_edit', 'perm_idcard_setting_delete', 'perm_idcard_setting_status',
        'perm_idcard_pending_list', 'perm_idcard_verified_list', 'perm_idcard_pool_list', 'perm_idcard_approved_list', 'perm_idcard_download_list', 'perm_idcard_reprint_list',
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete', 'perm_idcard_info', 'perm_idcard_approve', 'perm_idcard_verify',
        'perm_idcard_created_at', 'perm_idcard_updated_at', 'perm_idcard_delete_from_pool', 'perm_idcard_retrieve',
        'perm_idcard_upgrade_all',
        'perm_mobile_app'
      ];

      // ==================== DRAWER FUNCTIONS ====================
      NS.openDrawer = function(mode, clientData) {
        if (mode === undefined) mode = 'add';
        if (clientData === undefined) clientData = null;
        clientForm.reset();
        clientIdInput.value = '';
        NS.setClientStatusDropdown('false'); // Default Inactive for new clients
        NS.setClientPasswordOption('phone'); // Reset password option to phone
        
        // Phase 1: Photo upload removed - using avatar placeholder
        
        // Reset all permission toggles to unchecked (OFF by default for new clients)
        NS.permissionFields.forEach(function(field) {
          var el = document.getElementById(field);
          if (el) el.checked = false;
        });
        
        if (mode === 'add') {
          drawerTitle.textContent = 'Add New Client';
          drawerIcon.className = 'fa-solid fa-user-plus';
          submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Client';
          
          // Show password option for new clients
          var pwRow = document.getElementById('clientPasswordOptionRow');
          if (pwRow) pwRow.style.display = '';
          
          // Hide temp password button in add mode
          var tempPwBtn = document.getElementById('tempPasswordClientBtn');
          if (tempPwBtn) tempPwBtn.style.display = 'none';
          
          // Permissions stay OFF by default for new clients (already reset above)
        } else {
          drawerTitle.textContent = 'Edit Client';
          drawerIcon.className = 'fa-solid fa-user-pen';
          submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Update Client';
          
          // Hide password option when editing (change via settings/forgot password)
          var pwRow = document.getElementById('clientPasswordOptionRow');
          if (pwRow) pwRow.style.display = 'none';
          
          // Show temp password button in edit mode
          var tempPwBtn = document.getElementById('tempPasswordClientBtn');
          if (tempPwBtn) tempPwBtn.style.display = '';
          
          if (clientData) {
            clientIdInput.value = clientData.id;
            document.getElementById('clientName').value = clientData.name || '';
            document.getElementById('clientEmail').value = clientData.email || '';
            document.getElementById('clientPhone').value = clientData.phone || '';
            document.getElementById('clientAddress').value = clientData.address || '';
            NS.setClientStatusDropdown(clientData.status === 'active' ? 'true' : 'false');
            
            // Phase 1: Photo upload removed - using avatar placeholder
            
            // Set permissions from client data
            NS.permissionFields.forEach(function(field) {
              var el = document.getElementById(field);
              if (el) el.checked = clientData[field] === true;
            });
          }
        }
        
        clientDrawer.classList.add('open');
        document.body.style.overflow = 'hidden';
      };
      
      NS.closeDrawerFn = function() {
        clientDrawer.classList.remove('open');
        document.body.style.overflow = '';
      };

      // ==================== MODAL FUNCTIONS ====================
      NS.openViewModal = function(clientData) {
        document.getElementById('viewClientName').textContent = clientData.name || '-';
        document.getElementById('viewClientEmail').value = clientData.email || '-';
        document.getElementById('viewClientPhone').value = clientData.phone || '-';
        document.getElementById('viewClientAddress').value = clientData.address || '-';
        document.getElementById('viewClientStatusText').value = clientData.status === 'active' ? 'Active' : 'Inactive';
        document.getElementById('viewClientCreated').value = clientData.created_at || '-';
        document.getElementById('viewClientUpdated').value = clientData.updated_at || '-';
        
        // Update avatar with photo if available
        var avatarEl = document.getElementById('viewClientAvatar');
        if (clientData.photo_url) {
          avatarEl.innerHTML = '';
          var img = document.createElement('img');
          img.src = clientData.photo_url;
          img.alt = clientData.name || '';
          img.className = 'w-full h-full object-cover';
          img.style.cssText = 'width:48px;height:48px;border-radius:50%;';
          avatarEl.appendChild(img);
        } else {
          avatarEl.innerHTML = '<div class="user-avatar-placeholder user-avatar-placeholder--client" style="width:48px;height:48px;border-radius:50%;font-size:22px;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-building"></i></div>';
        }
        
        var statusEl = document.getElementById('viewClientStatus');
        statusEl.textContent = clientData.status === 'active' ? 'Active' : 'Inactive';
        statusEl.className = 'status-badge ' + (clientData.status === 'active' ? 'active' : 'inactive');

        // Populate permissions (read-only toggle display)
        var permGrid = document.getElementById('viewPermissionsGrid');
        if (permGrid) {
          var permLabels = {
            'perm_idcard_setting_add': 'Create Template', 'perm_idcard_setting_edit': 'Edit Template',
            'perm_idcard_setting_list': 'View Template', 'perm_idcard_setting_delete': 'Delete Template',
            'perm_idcard_setting_status': 'Status Template',
            'perm_idcard_pending_list': 'Pending List', 'perm_idcard_verified_list': 'Verified List', 'perm_idcard_pool_list': 'Pool List',
            'perm_idcard_approved_list': 'Approved List', 'perm_idcard_download_list': 'Download List', 'perm_idcard_reprint_list': 'Reprint List',
            'perm_idcard_add': 'Add Card', 'perm_idcard_edit': 'Edit Card', 'perm_idcard_info': 'View Card Info',
            'perm_idcard_delete': 'Delete Card', 'perm_idcard_approve': 'Approve Card', 'perm_idcard_verify': 'Verify Card',
            'perm_idcard_created_at': 'Created Date', 'perm_idcard_updated_at': 'Updated Date',
            'perm_idcard_retrieve': 'Retrieve from Pool',
            'perm_idcard_upgrade_all': 'Batch Class Upgrade',
            'perm_mobile_app': 'Mobile App Access', 'perm_idcard_client_list': 'Manage Staff'
          };
          var html = '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
          NS.permissionFields.forEach(function(field) {
            var label = permLabels[field] || field.replace(/^perm_/, '').replace(/_/g, ' ');
            var active = clientData[field] === true;
            html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:3px;font-size:11px;font-weight:500;' +
              (active ? 'background:#dcfce7;color:#15803d;' : 'background:#f1f5f9;color:#94a3b8;text-decoration:line-through;') + '">' +
              '<i class="fa-solid ' + (active ? 'fa-check' : 'fa-xmark') + '" style="font-size:9px;"></i> ' + label + '</span>';
          });
          html += '</div>';
          permGrid.innerHTML = html;
        }
        
        viewModal.classList.add('open');
        document.body.style.overflow = 'hidden';
      };
      
      NS.closeViewModalFn = function() {
        viewModal.classList.remove('open');
        document.body.style.overflow = '';
      };
      
      NS.openDeleteModalFn = function(clientName) {
        document.getElementById('deleteClientName').textContent = clientName;
        if (window.alpineOpenModal) window.alpineOpenModal('delete');
      };
      
      NS.closeDeleteModalFn = function() {
        if (window.alpineCloseModal) window.alpineCloseModal();
      };
      
      // Status modal open/close functions
      NS.pendingStatusClientId = null;
      NS.pendingStatusCurrentStatus = null;
      
      NS.openStatusModalFn = function(clientName, currentStatus) {
        var statusClientName = document.getElementById('statusClientName');
        var statusNote = document.getElementById('statusNote');
        var statusModalHeader = document.getElementById('statusModalHeader');
        var statusModalIcon = document.getElementById('statusModalIcon');
        var confirmStatusBtn = document.getElementById('confirmStatusBtn');

        statusClientName.textContent = clientName;
        NS.pendingStatusCurrentStatus = currentStatus;
        
        // Update modal appearance based on action
        if (currentStatus === 'active') {
          // Going to deactivate
          statusModalHeader.style.background = '#dc2626';
          statusModalIcon.innerHTML = '<i class="fa-solid fa-ban text-danger text-sm"></i>';
          statusNote.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> This will prevent the client from logging in.';
          confirmStatusBtn.className = 'btn btn-md btn-danger';
          confirmStatusBtn.style.background = '';
          confirmStatusBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Deactivate';
        } else {
          // Going to activate
          statusModalHeader.style.background = '#16a34a';
          statusModalIcon.innerHTML = '<i class="fa-solid fa-check-circle text-success text-sm"></i>';
          statusNote.innerHTML = '<i class="fa-solid fa-info-circle"></i> This will allow the client to log in.';
          confirmStatusBtn.className = 'btn btn-md btn-success';
          confirmStatusBtn.style.background = '';
          confirmStatusBtn.innerHTML = '<i class="fa-solid fa-check"></i> Activate';
        }
        
        if (window.alpineOpenModal) window.alpineOpenModal('status');
      };
      
      NS.closeStatusModalFn = function() {
        if (window.alpineCloseModal) window.alpineCloseModal();
        NS.pendingStatusClientId = null;
        NS.pendingStatusCurrentStatus = null;
      };

      // ==================== DISABLE BUTTONS HELPER ====================
      NS.disableActionButtons = function() {
        if (editClientBtn) editClientBtn.disabled = true;
        if (viewClientBtn) viewClientBtn.disabled = true;
        if (viewStaffBtn) viewStaffBtn.disabled = true;
        if (deleteClientBtn) deleteClientBtn.disabled = true;
        if (activeClientBtn) activeClientBtn.disabled = true;
      };
});
