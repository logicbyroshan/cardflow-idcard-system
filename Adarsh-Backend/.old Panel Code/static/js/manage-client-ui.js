/**
 * Manage Client Page  UI: state, elements, dropdowns, row selection, drawer, modals
 * Split from manage-client.js  loaded first
 * Dependencies: api.js, toast.js, modal.js, utils.js, init.js, Alpine.js
 */
window.ManageClientPage = {};

document.addEventListener('DOMContentLoaded', function() {
      var NS = window.ManageClientPage;

      // ==================== SHARED STATE ====================
      NS.selectedClientId = null;
      NS.selectedRow = null;
      NS.selectedProfileFile = null; // Kept for API compatibility

      // Capability flags for manage-clients actions
      NS.isSuperAdmin = window.isSuperAdmin || false;
      NS.canManageClients = window.canManageClients || NS.isSuperAdmin;

      // ==================== ELEMENTS ====================
      var clientDrawer = document.getElementById('client-drawer');
      var clientForm = document.getElementById('clientForm');
      var clientIdInput = document.getElementById('clientId');
      var drawerTitle = document.getElementById('drawerTitleText');
      var drawerIcon = document.getElementById('drawerIcon');
      var submitBtn = document.getElementById('submitClientBtn');
      var clientDrawerAvatar = document.getElementById('clientDrawerAvatar');
      
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
      var groupSettingBtn = document.getElementById('group-setting-btn');
      var idcardGroupBtn = document.getElementById('idcard-group-btn');
      
      var table = document.getElementById('clientsTable');
      var tbody = table ? table.querySelector('tbody') : null;

      // Phase 1: Profile photo upload removed - using avatar placeholder

      function resolveClientLogoUrl(clientData) {
        if (!clientData || typeof clientData !== 'object') return '';
        return clientData.logo_url || clientData.website_logo_url || clientData.photo_url || '';
      }

      function panelBasePath() {
        return window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';
      }

      function clientSettingsUrl(clientId) {
        return panelBasePath() + '/client/' + encodeURIComponent(String(clientId)) + '/settings/';
      }

      function renderClientDrawerAvatar(name, logoUrl) {
        if (!clientDrawerAvatar) return;
        if (logoUrl) {
          var safeName = String(name || 'Client').replace(/"/g, '&quot;');
          clientDrawerAvatar.innerHTML = '<img src="' + logoUrl + '" alt="' + safeName + '" style="width:56px;height:56px;object-fit:contain;border-radius:10px;border:1px solid #e2e8f0;background:#fff;padding:4px;">';
          return;
        }
        clientDrawerAvatar.innerHTML = '<div class="user-avatar-placeholder user-avatar-placeholder--client user-avatar-placeholder--lg"><i class="fa-solid fa-building"></i></div>';
      }

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
      var clientPasswordToggleBtn = document.getElementById('clientPasswordToggleBtn');
      var clientPasswordEyeIcon = document.getElementById('clientPasswordEyeIcon');

      function setClientPasswordHidden() {
        if (!clientPasswordInput) return;
        clientPasswordInput.type = 'password';
        if (clientPasswordEyeIcon) clientPasswordEyeIcon.className = 'fa-solid fa-eye';
      }

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
          setClientPasswordHidden();
        }
      };

      if (clientPasswordToggleBtn && clientPasswordInput) {
        clientPasswordToggleBtn.addEventListener('click', function() {
          if (clientPasswordInput.type === 'password') {
            clientPasswordInput.type = 'text';
            if (clientPasswordEyeIcon) clientPasswordEyeIcon.className = 'fa-solid fa-eye-slash';
          } else {
            setClientPasswordHidden();
          }
        });
      }

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
          var currentTbody = tbody;
          if (!currentTbody || !document.body.contains(currentTbody)) {
            var currentTable = document.getElementById('clientsTable');
            currentTbody = currentTable ? currentTable.querySelector('tbody') : null;
            tbody = currentTbody;
          }
          if (currentTbody) {
            currentTbody.querySelectorAll('tr').forEach(function(r) { r.classList.remove('selected'); });
          }
          row.classList.add('selected');
          NS.selectedClientId = row.dataset.clientId;
          NS.selectedRow = row;
          
          if (editClientBtn) editClientBtn.disabled = false;
          if (viewClientBtn) viewClientBtn.disabled = false;
          if (viewStaffBtn) viewStaffBtn.disabled = false;
          if (deleteClientBtn) {
            // Keep delete button interactive so we can show a helpful message
            // when deletion is blocked due to existing groups/media. Store
            // the has-data flag on the button for click-time handling.
            deleteClientBtn.disabled = false;
            deleteClientBtn.dataset.clientHasData = row.dataset.clientHasData || 'false';
          }
          if (activeClientBtn) activeClientBtn.disabled = false;
          if (groupSettingBtn) groupSettingBtn.disabled = false;
          if (idcardGroupBtn) idcardGroupBtn.disabled = false;
          
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
          if (e.target.closest('.client-message-btn')) return;
          var row = e.target.closest('tr');
          if (row && row.dataset.clientId) {
            window.location.href = clientSettingsUrl(row.dataset.clientId);
          }
        });
      }

      // ==================== PERMISSIONS LIST ====================
      NS.permissionFields = [
        'perm_idcard_client_list',
        'perm_idcard_setting_list', 'perm_idcard_setting_add', 'perm_idcard_setting_edit', 'perm_idcard_setting_delete', 'perm_idcard_setting_status',
        'perm_idcard_pending_list', 'perm_idcard_verified_list', 'perm_idcard_pool_list', 'perm_idcard_approved_list', 'perm_idcard_download_list',
        'perm_reprint_request_list', 'perm_confirmed_list',
        'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete', 'perm_idcard_info', 'perm_idcard_approve', 'perm_idcard_verify', 'perm_idcard_reprint_list',
        'perm_idcard_updated_at', 'perm_idcard_delete_from_pool', 'perm_idcard_retrieve',
        'perm_idcard_bulk_upload', 'perm_idcard_bulk_download', 'perm_idcard_download_image_rename_mode', 'perm_idcard_download_image_generate_mode', 'perm_idcard_upgrade_all',
        'perm_mobile_app', 'perm_set_temp_password'
      ];

      // ==================== DRAWER FUNCTIONS ====================
      NS.openDrawer = function(mode, clientData) {
        if (mode === undefined) mode = 'add';
        if (clientData === undefined) clientData = null;
        clientForm.reset();
        clientIdInput.value = '';
        // Fix: always re-enable submit button when opening drawer (may be disabled from previous submit)
        if (submitBtn) { submitBtn.disabled = false; }
        NS.setClientStatusDropdown('false'); // Default Inactive for new clients
        setClientPasswordHidden();
        renderClientDrawerAvatar('', '');
        
        // Phase 1: Photo upload removed - using avatar placeholder
        
        // Reset all permission toggles to default (OFF by default, except the 16 auto-on permissions for new clients)
        var defaultOnPerms = [
          'perm_idcard_pending_list', 'perm_idcard_verified_list', 'perm_idcard_approved_list',
          'perm_idcard_download_list', 'perm_idcard_pool_list', 'perm_idcard_add', 'perm_idcard_edit',
          'perm_idcard_info', 'perm_idcard_delete', 'perm_idcard_approve', 'perm_idcard_verify',
          'perm_idcard_updated_at', 'perm_idcard_retrieve', 'perm_idcard_bulk_download',
          'perm_idcard_client_list', 'perm_set_temp_password'
        ];
        NS.permissionFields.forEach(function(field) {
          var el = document.getElementById(field);
          if (el) {
            if (mode === 'add') {
              el.checked = defaultOnPerms.includes(field);
            } else {
              el.checked = false;
            }
          }
        });
        
        if (mode === 'add') {
          drawerTitle.textContent = 'Add New Client';
          drawerIcon.className = 'fa-solid fa-user-plus';
          submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Client';
          NS.setClientPasswordOption('custom');
          
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
          NS.setClientPasswordOption('phone');
          
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
            renderClientDrawerAvatar(clientData.name || '', resolveClientLogoUrl(clientData));
            
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

        // Attach data sanitizer (blur listener shows inline hint, removes bad chars)
        if (window.DataSanitizer) DataSanitizer.attachToForm(clientForm);
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
        var resolvedLogoUrl = resolveClientLogoUrl(clientData);
        if (resolvedLogoUrl) {
          avatarEl.innerHTML = '';
          var img = document.createElement('img');
          img.src = resolvedLogoUrl;
          img.alt = clientData.name || '';
          img.className = 'w-full h-full object-contain';
          img.style.cssText = 'width:48px;height:48px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;padding:4px;';
          avatarEl.appendChild(img);
        } else {
          avatarEl.innerHTML = '<div class="user-avatar-placeholder user-avatar-placeholder--client" style="width:48px;height:48px;border-radius:10px;font-size:20px;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-building"></i></div>';
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
            'perm_idcard_approved_list': 'Approved List', 'perm_idcard_download_list': 'Download List',
            'perm_reprint_request_list': 'Request List (Reprint)', 'perm_confirmed_list': 'Confirmed List (Reprint)',
            'perm_idcard_add': 'Add Card', 'perm_idcard_edit': 'Edit Card', 'perm_idcard_info': 'View Card Info',
            'perm_idcard_delete': 'Delete Card', 'perm_idcard_approve': 'Approve Card', 'perm_idcard_verify': 'Verify Card',
            'perm_idcard_reprint_list': 'Reprint Cards',
            'perm_idcard_updated_at': 'Last Updated & Updated By',
            'perm_idcard_retrieve': 'Retrieve from Pool',
            'perm_idcard_download_image_rename_mode': 'Download Images Rename Mode',
            'perm_idcard_download_image_generate_mode': 'Download Images Generate Mode',
            'perm_idcard_upgrade_all': 'Batch Class Upgrade',
            'perm_mobile_app': 'Mobile App Access', 'perm_idcard_client_list': 'Manage Assistant'
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
          statusNote.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> This will prevent the client from logging in.';
          confirmStatusBtn.className = 'btn btn-md btn-danger';
          confirmStatusBtn.style.background = '';
          confirmStatusBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Deactivate';
        } else {
          // Going to activate
          statusModalHeader.style.background = '#16a34a';
          statusModalIcon.innerHTML = '<i class="fa-solid fa-circle-check text-success text-sm"></i>';
          statusNote.innerHTML = '<i class="fa-solid fa-circle-info"></i> This will allow the client to log in.';
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
        if (groupSettingBtn) groupSettingBtn.disabled = true;
        if (idcardGroupBtn) idcardGroupBtn.disabled = true;
      };
});
