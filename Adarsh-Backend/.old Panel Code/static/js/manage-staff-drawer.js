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
    var clientAssignmentSection = document.getElementById('client-assignment-section');
    var clientMultiselectToggle = document.getElementById('client-multiselect-toggle');
    var clientMultiselectDropdown = document.getElementById('client-multiselect-dropdown');
    var clientMultiselectList = document.getElementById('client-multiselect-list');
    var clientMultiselectText = document.getElementById('client-multiselect-text');
    var clientSearchInput = document.getElementById('client-search-input');
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
        if (!clientMultiselectList) return;
        clientMultiselectList.innerHTML = '';

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

        filtered.forEach(function(client) {
            var _esc = window.escapeHtml || function(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); };
            var item = document.createElement('div');
            var isInactive = client.status === 'inactive';
            item.className = 'client-multiselect-item' + (NS.selectedClientIds.has(client.id) ? ' selected' : '') + (isInactive ? ' client-inactive' : '');
            var statusBadge = isInactive ? '<span class="client-status-badge inactive">Inactive</span>' : '';
            item.innerHTML = '<input type="checkbox" ' + (NS.selectedClientIds.has(client.id) ? 'checked' : '') + ' data-client-id="' + client.id + '">' +
                '<span class="client-name">' + _esc(client.name) + statusBadge + '</span>';
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                var cb = item.querySelector('input[type="checkbox"]');
                if (e.target !== cb) cb.checked = !cb.checked;
                if (cb.checked) {
                    NS.selectedClientIds.add(client.id);
                    item.classList.add('selected');
                } else {
                    NS.selectedClientIds.delete(client.id);
                    item.classList.remove('selected');
                }
                updateClientSelectionText();
            });
            clientMultiselectList.appendChild(item);
        });
    }

    // Update header text to show selection count
    function updateClientSelectionText() {
        if (!clientMultiselectText) return;
        var count = NS.selectedClientIds.size;
        if (count === 0) {
            clientMultiselectText.textContent = 'Select clients...';
            clientMultiselectText.classList.remove('has-selection');
        } else {
            // Show names for 1-2, count for 3+
            if (count <= 2) {
                var names = NS.allClients
                    .filter(function(c) { return NS.selectedClientIds.has(c.id); })
                    .map(function(c) { return c.name; });
                clientMultiselectText.textContent = names.join(', ');
            } else {
                clientMultiselectText.textContent = count + ' clients selected';
            }
            clientMultiselectText.classList.add('has-selection');
        }
    }

    // Toggle dropdown
    if (clientMultiselectToggle) {
        clientMultiselectToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            var isOpen = clientMultiselectDropdown.style.display !== 'none';
            if (isOpen) {
                closeClientDropdown();
            } else {
                openClientDropdown();
            }
        });
    }

    function openClientDropdown() {
        if (!clientMultiselectDropdown) return;
        clientMultiselectDropdown.style.display = '';
        clientMultiselectToggle.classList.add('open');
        if (clientSearchInput) {
            clientSearchInput.value = '';
            clientSearchInput.focus();
        }
        renderClientList();
    }

    function closeClientDropdown() {
        if (!clientMultiselectDropdown) return;
        clientMultiselectDropdown.style.display = 'none';
        clientMultiselectToggle.classList.remove('open');
    }

    // Search filter
    if (clientSearchInput) {
        clientSearchInput.addEventListener('input', function() {
            renderClientList(clientSearchInput.value);
        });
        // Prevent dropdown from closing when clicking in search
        clientSearchInput.addEventListener('click', function(e) { e.stopPropagation(); });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (clientMultiselectDropdown && clientMultiselectDropdown.style.display !== 'none') {
            var container = document.getElementById('client-multiselect');
            if (container && !container.contains(e.target)) {
                closeClientDropdown();
            }
        }
    });

    // Initialize client assignment for drawer open
    NS.initClientAssignment = async function(preselectedIds) {
        if (preselectedIds === undefined) preselectedIds = [];
        if (!clientAssignmentSection) return;

        // Show the section (always visible for operator management)
        clientAssignmentSection.style.display = '';

        // Fetch clients if not loaded
        if (NS.allClients.length === 0) {
            await fetchActiveClients();
        }

        // Set preselected
        NS.selectedClientIds = new Set(preselectedIds.map(function(id) { return parseInt(id); }));
        updateClientSelectionText();
        closeClientDropdown();
    };

    function resetClientAssignment() {
        NS.selectedClientIds = new Set();
        if (clientMultiselectText) {
            clientMultiselectText.textContent = 'Select clients...';
            clientMultiselectText.classList.remove('has-selection');
        }
        closeClientDropdown();
    }

    // ==================== DRAWER FUNCTIONS ====================
    NS.openDrawer = function(mode, staffData) {
        if (mode === undefined) mode = 'add';
        if (staffData === undefined) staffData = null;
        NS.currentMode = mode;
        staffForm.reset();
        NS.setStatusDropdown('false'); // Default Inactive for new staff
        NS.setPasswordOption('phone'); // Reset password option

        // Phase 1: Profile image upload removed - using avatar placeholder

        // Reset all permission toggles to unchecked
        NS.permissionFields.forEach(function(field) {
            var el = document.getElementById(field);
            if (el) el.checked = false;
        });

        // Reset client assignment
        resetClientAssignment();

        // Always restore submit button to non-loading state when opening drawer
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span id="submit-btn-text">Add Operator</span>';
        var submitBtnText = document.getElementById('submit-btn-text');

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
        } else if (mode === 'edit') {
            drawerTitle.textContent = 'Edit Operator';
            drawerIcon.className = 'fa-solid fa-pen-to-square';
            if (submitBtnText) submitBtnText.textContent = 'Save Changes';
            submitBtn.style.display = 'inline-flex';
            NS.enableFormInputs(true);

            // Hide password option when editing
            var pwRow = document.getElementById('staffPasswordOptionRow');
            if (pwRow) pwRow.style.display = 'none';

            // Show temp password button in edit mode
            var tempPwBtn = document.getElementById('tempPasswordStaffBtn');
            if (tempPwBtn) tempPwBtn.style.display = '';

            if (staffData) {
                document.getElementById('staff-name').value = staffData.name || '';
                document.getElementById('staff-email').value = staffData.email || '';
                document.getElementById('staff-phone').value = staffData.phone || '';
                document.getElementById('staff-address').value = staffData.address || '';
                NS.setStatusDropdown(staffData.status === 'active' ? 'true' : 'false');

                // Phase 1: Profile image loading removed - using avatar placeholder

                // Set permissions from staff data
                NS.permissionFields.forEach(function(field) {
                    var el = document.getElementById(field);
                    var apiField = field.replace(/-/g, '_');
                    if (el) el.checked = staffData[apiField] === true;
                });

                // Pre-select assigned clients
                NS.initClientAssignment(staffData.assigned_client_ids || []);
            }
        } else if (mode === 'view') {
            drawerTitle.textContent = 'View Operator Details';
            drawerIcon.className = 'fa-solid fa-eye';
            submitBtn.style.display = 'none';
            NS.enableFormInputs(false);

            // Hide password option in view mode
            var pwRow = document.getElementById('staffPasswordOptionRow');
            if (pwRow) pwRow.style.display = 'none';

            // Hide temp password button in view mode
            var tempPwBtn = document.getElementById('tempPasswordStaffBtn');
            if (tempPwBtn) tempPwBtn.style.display = 'none';

            if (staffData) {
                document.getElementById('staff-name').value = staffData.name || '';
                document.getElementById('staff-email').value = staffData.email || '';
                document.getElementById('staff-phone').value = staffData.phone || '';
                document.getElementById('staff-address').value = staffData.address || '';
                NS.setStatusDropdown(staffData.status === 'active' ? 'true' : 'false');

                // Phase 1: Profile image loading removed - using avatar placeholder

                // Set permissions from staff data
                NS.permissionFields.forEach(function(field) {
                    var el = document.getElementById(field);
                    var apiField = field.replace(/-/g, '_');
                    if (el) el.checked = staffData[apiField] === true;
                });

                // Show assigned clients (read-only view)
                NS.initClientAssignment(staffData.assigned_client_ids || []);
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

        // Enable/disable custom client multiselect
        if (clientMultiselectToggle) {
            if (!enable) {
                clientMultiselectToggle.style.pointerEvents = 'none';
                clientMultiselectToggle.style.opacity = '0.6';
                closeClientDropdown();
            } else {
                clientMultiselectToggle.style.pointerEvents = '';
                clientMultiselectToggle.style.opacity = '';
            }
        }
    };
});
