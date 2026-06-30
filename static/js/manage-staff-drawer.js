// Manage Staff Page  Drawer: client assignment multi-select, drawer open/close/populate
// Split from manage-staff-ui.js  loaded second (after state)

document.addEventListener('DOMContentLoaded', function() {
    var NS = window.ManageStaffPage;

    // ==================== DRAWER ELEMENTS ====================
    var staffDrawer = document.getElementById('staff-drawer');
    var staffDrawerOverlay = document.getElementById('staff-drawer-overlay');
    var staffForm = document.getElementById('staff-form');
    var drawerTitle = document.getElementById('drawer-title-text');
    var drawerIcon = document.getElementById('drawer-icon');
    var submitBtn = document.getElementById('drawer-submit-btn');
    var statusDropdown = document.getElementById('staffStatusDropdown');

    // ==================== CLIENT ASSIGNMENT MULTI-SELECT ====================
    // ==================== CLIENT ASSIGNMENT MULTI-SELECT ====================
    var clientAssignmentSection = document.getElementById('client-assignment-section');
    var clientSearchInput = document.getElementById('client-search-input');
    var clientAssignmentList = document.getElementById('client-assignment-list');
    var clientMultiselectEmpty = document.getElementById('client-multiselect-empty');

    // Fetch all clients (active + inactive) for staff assignment
    async function fetchActiveClients() {
        try {
            var data = await ApiClient.get('/api/clients/for-staff-assignment/');
            if (data.success) {
                NS.allClients = data.clients || [];
            }
        } catch (error) {
            NS.allClients = [];
        }
    }

    // Render checkbox items, selected first, then alphabetical
    function renderClientList(filter) {
        if (filter === undefined) filter = '';
        if (!clientAssignmentList) return;
        clientAssignmentList.innerHTML = '';

        var term = filter.toLowerCase().trim();
        var filtered = NS.allClients.filter(function(c) {
            return !term || c.name.toLowerCase().includes(term);
        });

        // Sort: selected first, then active before inactive, then alphabetical
        filtered.sort(function(a, b) {
            var aSelected = NS.selectedClientIds.has(a.id) ? 0 : 1;
            var bSelected = NS.selectedClientIds.has(b.id) ? 0 : 1;
            if (aSelected !== bSelected) return aSelected - bSelected;
            // Active clients before inactive
            if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        if (filtered.length === 0) {
            if (clientMultiselectEmpty) clientMultiselectEmpty.style.display = '';
            return;
        }
        if (clientMultiselectEmpty) clientMultiselectEmpty.style.display = 'none';

        var canEdit = (NS.currentMode !== 'view');

        filtered.forEach(function(client) {
            var _esc = window.escapeHtml || function(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); };
            var isInactive = client.status === 'inactive';
            
            var row = document.createElement('div');
            row.className = 'photographer-client-row';
            row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border: 1px solid var(--color-slate-100); border-radius: 6px; background: var(--color-slate-50); transition: all 0.2s ease;';
            if (NS.selectedClientIds.has(client.id)) {
                row.classList.add('selected');
                row.style.borderColor = 'var(--color-indigo-200)';
                row.style.background = '#f0f2ff';
            }

            var leftDiv = document.createElement('div');
            leftDiv.style.cssText = 'display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;';

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'operator-client-cb';
            cb.id = 'client-checkbox-' + client.id;
            cb.value = client.id;
            cb.checked = NS.selectedClientIds.has(client.id);
            cb.disabled = !canEdit;
            cb.style.cssText = 'width: 16px; height: 16px; cursor: pointer;';

            var label = document.createElement('label');
            label.htmlFor = cb.id;
            label.style.cssText = 'font-weight: 500; font-size: 13px; color: var(--color-slate-800); cursor: pointer; user-select: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px;';
            label.textContent = client.name;
            if (isInactive) {
                var badge = document.createElement('span');
                badge.className = 'client-status-badge inactive';
                badge.style.cssText = 'font-size: 9px; padding: 1px 4px; border-radius: 3px; background: var(--color-slate-200); color: var(--color-slate-600);';
                badge.textContent = 'Inactive';
                label.appendChild(badge);
            }

            leftDiv.appendChild(cb);
            leftDiv.appendChild(label);
            row.appendChild(leftDiv);

            cb.addEventListener('change', function() {
                if (cb.checked) {
                    NS.selectedClientIds.add(client.id);
                    row.classList.add('selected');
                    row.style.borderColor = 'var(--color-indigo-200)';
                    row.style.background = '#f0f2ff';
                } else {
                    NS.selectedClientIds.delete(client.id);
                    row.classList.remove('selected');
                    row.style.borderColor = 'var(--color-slate-100)';
                    row.style.background = 'var(--color-slate-50)';
                }
                renderSelectedClientChips();
            });

            // Clicking row toggles check
            row.addEventListener('click', function(e) {
                if (e.target !== cb && e.target !== label && !leftDiv.contains(e.target)) {
                    if (!canEdit) return;
                    cb.checked = !cb.checked;
                    cb.dispatchEvent(new Event('change'));
                }
            });

            clientAssignmentList.appendChild(row);
        });
    }

    function renderSelectedClientChips() {
        var container = document.getElementById('client-selected-chips-container');
        if (!container) return;
        container.innerHTML = '';

        var clientMap = {};
        NS.allClients.forEach(function(c) { clientMap[c.id] = c; });
        
        // Sets maintain insertion order. Get array and reverse for 'latest first'
        var selectedIds = Array.from(NS.selectedClientIds).reverse();
        var selected = selectedIds.map(function(id) { return clientMap[id]; }).filter(Boolean);

        if (selected.length === 0) {
            container.innerHTML = '<div style="font-size: 12px; color: var(--color-slate-400); font-style: italic;">No clients assigned yet.</div>';
            return;
        }

        var canEdit = (NS.currentMode !== 'view');

        selected.forEach(function(client) {
            var chip = document.createElement('div');
            chip.className = 'operator-client-chip';
            chip.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 12px; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 6px; font-size: 12px; color: #3730a3; font-weight: 600; width: 100%;';
            
            var textSpan = document.createElement('span');
            textSpan.style.cssText = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;';
            textSpan.textContent = client.name;
            chip.appendChild(textSpan);

            if (canEdit) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.style.cssText = 'border:none; background:transparent; padding:0; cursor:pointer; color:var(--color-indigo-400); display:inline-flex; align-items:center; justify-content:center; font-size:12px; margin-left: 2px;';
                btn.title = 'Remove assignment';
                btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    NS.selectedClientIds.delete(client.id);
                    renderSelectedClientChips();
                    renderClientList(); // Refresh checkboxes
                });
                chip.appendChild(btn);
            }

            container.appendChild(chip);
        });
    }

    // Search filter
    if (clientSearchInput) {
        clientSearchInput.addEventListener('input', function() {
            renderClientList(clientSearchInput.value);
        });
    }

    // Initialize client assignment for drawer open
    NS.initClientAssignment = async function(preselectedIds) {
        if (preselectedIds === undefined) preselectedIds = [];
        if (!clientAssignmentSection) return;

        // Show the section only in assign mode
        clientAssignmentSection.style.display = (NS.currentMode === 'assign') ? '' : 'none';

        // Fetch clients if not loaded
        if (NS.allClients.length === 0) {
            await fetchActiveClients();
        }

        // Set preselected
        NS.selectedClientIds = new Set(preselectedIds.map(function(id) { return parseInt(id); }));
        
        // Reset search field
        if (clientSearchInput) clientSearchInput.value = '';
        
        renderClientList();
        renderSelectedClientChips();
    };

    function resetClientAssignment() {
        NS.selectedClientIds = new Set();
        if (clientSearchInput) clientSearchInput.value = '';
        renderSelectedClientChips();
    }

    // ==================== DRAWER FUNCTIONS ====================
    NS.openDrawer = function(mode, staffData) {
        if (mode === undefined) mode = 'add';
        if (staffData === undefined) staffData = null;
        NS.currentMode = mode;
        staffForm.reset();
        NS.setStatusDropdown('false'); // Default Inactive for new staff
        NS.setPasswordOption('custom'); // Reset password option to custom by default

        // Phase 1: Profile image upload removed - using avatar placeholder

        // Reset all permission toggles to checked by default in add mode, unchecked in other modes
        NS.permissionFields.forEach(function(field) {
            var el = document.getElementById(field);
            if (el) {
                el.checked = (mode === 'add') ? true : false;
            }
        });

        // Reset client assignment
        resetClientAssignment();

        // Always restore submit button to non-loading state when opening drawer
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span id="submit-btn-text">Add Operator</span>';
        var submitBtnText = document.getElementById('submit-btn-text');

        // Toggle sections based on mode
        var clientAssignmentSection = document.getElementById('client-assignment-section');
        var staffInfoSection = document.getElementById('staff-info-section');
        var staffPermissionsSection = document.getElementById('staff-permissions-section');
        var profileSection = document.querySelector('.profile-upload-section');
        var isAssign = (mode === 'assign');

        if (clientAssignmentSection) clientAssignmentSection.style.display = isAssign ? '' : 'none';
        if (staffInfoSection) staffInfoSection.style.display = isAssign ? 'none' : '';
        if (staffPermissionsSection) staffPermissionsSection.style.display = isAssign ? 'none' : '';
        if (profileSection) profileSection.style.display = isAssign ? 'none' : '';

        // Toggles required attribute so validation works correctly
        var nameInput = document.getElementById('staff-name');
        var emailInput = document.getElementById('staff-email');
        if (nameInput) nameInput.required = !isAssign;
        if (emailInput) emailInput.required = !isAssign;

        if (mode === 'add') {
            drawerTitle.textContent = 'Add New Operator';
            drawerIcon.className = 'fa-solid fa-user-plus';
            if (submitBtnText) submitBtnText.textContent = 'Add Operator';
            submitBtn.style.display = 'inline-flex';
            NS.enableFormInputs(true);
            NS.initClientAssignment([]);

            // Show password option for new staff
            var pwRow = document.getElementById('staffPasswordOptionRow');
            if (pwRow) pwRow.style.display = '';

            // Hide temp password button in add mode
            var tempPwBtn = document.getElementById('tempPasswordStaffBtn');
            if (tempPwBtn) tempPwBtn.style.display = 'none';

            // Permissions stay OFF by default for new staff (already reset above)
        } else {
            // Hide password option when editing/assigning/viewing
            var pwRow = document.getElementById('staffPasswordOptionRow');
            if (pwRow) pwRow.style.display = 'none';

            // Show temp password button only in edit mode
            var tempPwBtn = document.getElementById('tempPasswordStaffBtn');
            if (tempPwBtn) tempPwBtn.style.display = (mode === 'edit') ? '' : 'none';

            if (staffData) {
                document.getElementById('staff-id').value = staffData.id || '';
                document.getElementById('staff-name').value = staffData.name || '';
                document.getElementById('staff-email').value = staffData.email || '';
                document.getElementById('staff-phone').value = staffData.phone || '';
                var staffAddressInput = document.getElementById('staff-address');
                if (staffAddressInput) staffAddressInput.value = staffData.address || '';
                NS.setStatusDropdown(staffData.status === 'active' ? 'true' : 'false');

                // Set permissions from staff data
                NS.permissionFields.forEach(function(field) {
                    var el = document.getElementById(field);
                    var apiField = field.replace(/-/g, '_');
                    if (el) el.checked = staffData[apiField] === true;
                });

                // Pre-select assigned clients
                NS.initClientAssignment(staffData.assigned_client_ids || []);
            }

            if (mode === 'edit') {
                drawerTitle.textContent = 'Edit Operator';
                drawerIcon.className = 'fa-solid fa-pen-to-square';
                if (submitBtnText) submitBtnText.textContent = 'Save Changes';
                submitBtn.style.display = 'inline-flex';
                NS.enableFormInputs(true);
            } else if (mode === 'assign') {
                drawerTitle.textContent = 'Assign Clients - ' + (staffData ? staffData.name : '');
                drawerIcon.className = 'fa-solid fa-link';
                if (submitBtnText) submitBtnText.textContent = 'Save Assignments';
                submitBtn.style.display = 'inline-flex';
                NS.enableFormInputs(true);
            } else if (mode === 'view') {
                drawerTitle.textContent = 'View Operator Details';
                drawerIcon.className = 'fa-solid fa-eye';
                submitBtn.style.display = 'none';
                NS.enableFormInputs(false);
            }
        }

        staffDrawer.classList.add('open');
        if (staffDrawerOverlay) staffDrawerOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    };

    NS.closeDrawer = function() {
        staffDrawer.classList.remove('open');
        if (staffDrawerOverlay) staffDrawerOverlay.classList.remove('active');
        document.body.style.overflow = '';
    };

    NS.enableFormInputs = function(enable) {
        var inputs = staffDrawer.querySelectorAll('input, select, textarea');
        inputs.forEach(function(input) {
            if (input.type === 'hidden') return; // Skip hidden inputs
            input.disabled = !enable;
            if (!enable) {
                input.style.backgroundColor = '#f5f5f5';
                input.style.cursor = 'not-allowed';
            } else {
                input.style.backgroundColor = '';
                input.style.cursor = '';
            }
        });

        // Enable/disable custom status dropdown
        if (statusDropdown) {
            var sdToggleBtn = statusDropdown.querySelector('.dropdown-toggle');
            if (sdToggleBtn) {
                if (!enable) {
                    sdToggleBtn.style.pointerEvents = 'none';
                    sdToggleBtn.style.opacity = '0.6';
                    sdToggleBtn.style.backgroundColor = '#f5f5f5';
                    sdToggleBtn.style.cursor = 'not-allowed';
                    statusDropdown.classList.remove('open');
                } else {
                    sdToggleBtn.style.pointerEvents = '';
                    sdToggleBtn.style.opacity = '';
                    sdToggleBtn.style.backgroundColor = '';
                    sdToggleBtn.style.cursor = '';
                }
            }
        }

        // Enable/disable custom client checkboxes and search inputs
        document.querySelectorAll('.operator-client-cb').forEach(function(cb) {
            cb.disabled = !enable;
        });
        if (clientSearchInput) {
            clientSearchInput.disabled = !enable;
        }
    };
});
