document.addEventListener('DOMContentLoaded', function() {
    var NS = {
        selectedStaffId: null,
        selectedRow: null,
        currentMode: 'add',
        allClients: [],
        selectedClientIds: new Set(),
        permissionFields: [
            'perm-idcard-pending-list',
            'perm-idcard-verified-list',
            'perm-idcard-pool-list',
            'perm-idcard-approved-list',
            'perm-idcard-download-list',
            'perm-reprint-request-list',
            'perm-confirmed-list',
            'perm-idcard-bulk-download',
            'perm-idcard-add',
            'perm-idcard-edit',
            'perm-idcard-delete',
            'perm-idcard-info',
            'perm-idcard-verify',
            'perm-idcard-reprint-list',
            'perm-idcard-updated-at',
            'perm-mobile-app'
        ]
    };

    var staffDrawer = document.getElementById('staff-drawer');
    var staffDrawerOverlay = document.getElementById('staff-drawer-overlay');
    var staffForm = document.getElementById('staff-form');
    var drawerTitle = document.getElementById('drawer-title-text');
    var drawerIcon = document.getElementById('drawer-icon');
    var submitBtn = document.getElementById('drawer-submit-btn');

    var addStaffBtn = document.getElementById('addStaffBtn');
    var editStaffBtn = document.getElementById('editStaffBtn');
    var viewStaffBtn = document.getElementById('viewStaffBtn');
    var deleteStaffBtn = document.getElementById('deleteStaffBtn');
    var activeStaffBtn = document.getElementById('activeStaffBtn');

    var tableContainer = document.getElementById('staff-table-container');

    var closeStaffDrawer = document.getElementById('drawer-close-btn');
    var cancelStaffDrawer = document.getElementById('drawer-cancel-btn');

    var statusDropdown = document.getElementById('staffStatusDropdown');
    var statusHiddenInput = document.getElementById('staff-status');

    var passwordOptionDropdown = document.getElementById('staffPasswordOptionDropdown');
    var passwordOptionInput = document.getElementById('staff-password-option');
    var customPasswordGroup = document.getElementById('staffCustomPasswordGroup');
    var passwordInput = document.getElementById('staff-password');

    var clientAssignmentSection = document.getElementById('client-assignment-section');
    var clientMultiselectToggle = document.getElementById('client-multiselect-toggle');
    var clientMultiselectDropdown = document.getElementById('client-multiselect-dropdown');
    var clientMultiselectList = document.getElementById('client-multiselect-list');
    var clientMultiselectText = document.getElementById('client-multiselect-text');
    var clientSearchInput = document.getElementById('client-search-input');
    var clientMultiselectEmpty = document.getElementById('client-multiselect-empty');

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getSelectedClientId() {
        var first = NS.selectedClientIds.values().next();
        return first.done ? null : first.value;
    }

    function setStatusDropdown(val) {
        if (!statusHiddenInput) return;
        statusHiddenInput.value = val;
        if (!statusDropdown) return;
        var toggle = statusDropdown.querySelector('.dropdown-toggle span');
        var options = statusDropdown.querySelectorAll('.dropdown-option');
        options.forEach(function(o) { o.classList.remove('selected'); });
        var match = statusDropdown.querySelector('.dropdown-option[data-value="' + val + '"]');
        if (match) {
            match.classList.add('selected');
            if (toggle) toggle.textContent = match.textContent;
        }
    }

    if (statusDropdown && statusHiddenInput) {
        var statusToggleBtn = statusDropdown.querySelector('.dropdown-toggle');
        var statusOptions = statusDropdown.querySelectorAll('.dropdown-option');
        if (statusToggleBtn) {
            statusToggleBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                document.querySelectorAll('.custom-dropdown.open').forEach(function(d) {
                    if (d !== statusDropdown) d.classList.remove('open');
                });
                statusDropdown.classList.toggle('open');
            });
        }
        statusOptions.forEach(function(option) {
            option.addEventListener('click', function() {
                setStatusDropdown(this.dataset.value);
                statusDropdown.classList.remove('open');
            });
        });
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.custom-dropdown')) statusDropdown.classList.remove('open');
        });
    }

    function setPasswordOption(val) {
        if (!passwordOptionInput) return;
        passwordOptionInput.value = val;
        if (passwordOptionDropdown) {
            var toggle = passwordOptionDropdown.querySelector('.dropdown-toggle span');
            var options = passwordOptionDropdown.querySelectorAll('.dropdown-option');
            options.forEach(function(o) { o.classList.remove('selected'); });
            var match = passwordOptionDropdown.querySelector('.dropdown-option[data-value="' + val + '"]');
            if (match) {
                match.classList.add('selected');
                if (toggle) toggle.textContent = match.textContent;
            }
        }
        if (customPasswordGroup) {
            customPasswordGroup.style.display = val === 'custom' ? '' : 'none';
        }
        if (passwordInput) {
            passwordInput.required = val === 'custom';
            if (val !== 'custom') passwordInput.value = '';
        }
    }

    if (passwordOptionDropdown && passwordOptionInput) {
        var pwToggleBtn = passwordOptionDropdown.querySelector('.dropdown-toggle');
        var pwOptions = passwordOptionDropdown.querySelectorAll('.dropdown-option');
        if (pwToggleBtn) {
            pwToggleBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                document.querySelectorAll('.custom-dropdown.open').forEach(function(d) {
                    if (d !== passwordOptionDropdown) d.classList.remove('open');
                });
                passwordOptionDropdown.classList.toggle('open');
            });
        }
        pwOptions.forEach(function(option) {
            option.addEventListener('click', function() {
                setPasswordOption(this.dataset.value);
                passwordOptionDropdown.classList.remove('open');
            });
        });
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.custom-dropdown')) passwordOptionDropdown.classList.remove('open');
        });
    }

    function enableActionButtons(enable) {
        if (editStaffBtn) editStaffBtn.disabled = !enable;
        if (activeStaffBtn) activeStaffBtn.disabled = !enable;
        if (deleteStaffBtn) deleteStaffBtn.disabled = !enable;
        if (viewStaffBtn) viewStaffBtn.disabled = !enable;
    }

    function updateActiveButtonState() {
        if (!NS.selectedRow || !activeStaffBtn) return;
        var status = NS.selectedRow.dataset.staffStatus;
        var isActive = status === 'active';

        if (isActive) {
            activeStaffBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Inactive';
            activeStaffBtn.classList.remove('btn-active');
            activeStaffBtn.classList.add('btn-inactive');
        } else {
            activeStaffBtn.innerHTML = '<i class="fa-solid fa-check"></i> Active';
            activeStaffBtn.classList.remove('btn-inactive');
            activeStaffBtn.classList.add('btn-active');
        }
    }

    function clearStaffSelection() {
        var currentTbody = document.getElementById('staff-table-body');
        if (currentTbody) {
            currentTbody.querySelectorAll('tr').forEach(function(r) {
                r.classList.remove('selected');
            });
        }
        NS.selectedRow = null;
        NS.selectedStaffId = null;
        enableActionButtons(false);
        if (typeof window.alpineClearSelection === 'function') {
            window.alpineClearSelection();
        }
    }

    function selectStaffRow(row) {
        if (!row || !row.dataset.staffId) return;

        var currentTbody = document.getElementById('staff-table-body');
        if (currentTbody) {
            currentTbody.querySelectorAll('tr').forEach(function(r) {
                r.classList.remove('selected');
            });
        }

        row.classList.add('selected');
        NS.selectedRow = row;
        NS.selectedStaffId = row.dataset.staffId;
        enableActionButtons(true);
        updateActiveButtonState();

        if (typeof window.alpineUpdateSelection === 'function') {
            window.alpineUpdateSelection([NS.selectedStaffId]);
        }
    }

    if (tableContainer) {
        tableContainer.addEventListener('click', function(e) {
            var row = e.target.closest('tr');
            if (row && row.dataset.staffId && !row.classList.contains('no-data-row')) {
                selectStaffRow(row);
            }
        });
    }

    document.body.addEventListener('htmx:afterSwap', function(e) {
        if (e.target && e.target.id === 'staff-table-container') {
            clearStaffSelection();
        }
    });

    async function fetchClientsForAssignment() {
        try {
            var data = await ApiClient.get('/api/client-staff/clients/');
            if (data.success) {
                NS.allClients = data.clients || [];
            } else {
                NS.allClients = [];
            }
        } catch (error) {
            NS.allClients = [];
        }
    }

    function updateClientSelectionText() {
        if (!clientMultiselectText) return;
        var selectedId = getSelectedClientId();
        if (!selectedId) {
            clientMultiselectText.textContent = 'Select client...';
            clientMultiselectText.classList.remove('has-selection');
            return;
        }
        var selectedClient = NS.allClients.find(function(c) { return Number(c.id) === Number(selectedId); });
        if (selectedClient) {
            clientMultiselectText.textContent = selectedClient.name;
            clientMultiselectText.classList.add('has-selection');
        } else {
            clientMultiselectText.textContent = 'Select client...';
            clientMultiselectText.classList.remove('has-selection');
        }
    }

    function renderClientList(filter) {
        if (filter === undefined) filter = '';
        if (!clientMultiselectList) return;
        clientMultiselectList.innerHTML = '';

        var term = filter.toLowerCase().trim();
        var filtered = NS.allClients.filter(function(c) {
            return !term || String(c.name || '').toLowerCase().includes(term);
        });

        filtered.sort(function(a, b) {
            var aSelected = NS.selectedClientIds.has(a.id) ? 0 : 1;
            var bSelected = NS.selectedClientIds.has(b.id) ? 0 : 1;
            if (aSelected !== bSelected) return aSelected - bSelected;
            if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });

        if (filtered.length === 0) {
            if (clientMultiselectEmpty) clientMultiselectEmpty.style.display = '';
            return;
        }
        if (clientMultiselectEmpty) clientMultiselectEmpty.style.display = 'none';

        filtered.forEach(function(client) {
            var isInactive = client.status === 'inactive';
            var selected = NS.selectedClientIds.has(client.id);
            var item = document.createElement('div');
            item.className = 'client-multiselect-item' + (selected ? ' selected' : '') + (isInactive ? ' client-inactive' : '');
            var statusBadge = isInactive ? '<span class="client-status-badge inactive">Inactive</span>' : '';
            item.innerHTML =
                '<input type="checkbox" ' + (selected ? 'checked' : '') + ' data-client-id="' + client.id + '">' +
                '<span class="client-name">' + escapeHtml(client.name) + statusBadge + '</span>';

            item.addEventListener('click', function(e) {
                e.stopPropagation();
                NS.selectedClientIds.clear();
                NS.selectedClientIds.add(client.id);
                renderClientList(clientSearchInput ? clientSearchInput.value : '');
                updateClientSelectionText();
            });

            clientMultiselectList.appendChild(item);
        });
    }

    function openClientDropdown() {
        if (!clientMultiselectDropdown) return;
        clientMultiselectDropdown.style.display = '';
        if (clientMultiselectToggle) clientMultiselectToggle.classList.add('open');
        if (clientSearchInput) {
            clientSearchInput.value = '';
            clientSearchInput.focus();
        }
        renderClientList();
    }

    function closeClientDropdown() {
        if (!clientMultiselectDropdown) return;
        clientMultiselectDropdown.style.display = 'none';
        if (clientMultiselectToggle) clientMultiselectToggle.classList.remove('open');
    }

    function resetClientAssignment() {
        NS.selectedClientIds = new Set();
        updateClientSelectionText();
        closeClientDropdown();
    }

    async function initClientAssignment(selectedClientId) {
        if (!clientAssignmentSection) return;
        clientAssignmentSection.style.display = '';

        if (NS.allClients.length === 0) {
            await fetchClientsForAssignment();
        }

        NS.selectedClientIds = new Set();
        if (selectedClientId) {
            NS.selectedClientIds.add(Number(selectedClientId));
        }
        updateClientSelectionText();
        closeClientDropdown();
    }

    if (clientMultiselectToggle) {
        clientMultiselectToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            var isOpen = clientMultiselectDropdown && clientMultiselectDropdown.style.display !== 'none';
            if (isOpen) closeClientDropdown();
            else openClientDropdown();
        });
    }

    if (clientSearchInput) {
        clientSearchInput.addEventListener('input', function() {
            renderClientList(clientSearchInput.value);
        });
        clientSearchInput.addEventListener('click', function(e) { e.stopPropagation(); });
    }

    document.addEventListener('click', function(e) {
        if (clientMultiselectDropdown && clientMultiselectDropdown.style.display !== 'none') {
            var container = document.getElementById('client-multiselect');
            if (container && !container.contains(e.target)) closeClientDropdown();
        }
    });

    function enableFormInputs(enable) {
        if (!staffDrawer) return;

        var inputs = staffDrawer.querySelectorAll('input, select, textarea, button');
        inputs.forEach(function(input) {
            if (input.type === 'hidden') return;
            if (input.id === 'drawer-close-btn' || input.id === 'drawer-cancel-btn') return;
            if (input.id === 'drawer-submit-btn' || input.id === 'tempPasswordStaffBtn') return;

            input.disabled = !enable;
            if (!enable) {
                input.style.backgroundColor = '#f5f5f5';
                input.style.cursor = 'not-allowed';
            } else {
                input.style.backgroundColor = '';
                input.style.cursor = '';
            }
        });

        if (statusDropdown) {
            var sdToggleBtn = statusDropdown.querySelector('.dropdown-toggle');
            if (sdToggleBtn) {
                if (!enable) {
                    sdToggleBtn.style.pointerEvents = 'none';
                    sdToggleBtn.style.opacity = '0.6';
                    statusDropdown.classList.remove('open');
                } else {
                    sdToggleBtn.style.pointerEvents = '';
                    sdToggleBtn.style.opacity = '';
                }
            }
        }

        if (passwordOptionDropdown) {
            var pwToggleBtn = passwordOptionDropdown.querySelector('.dropdown-toggle');
            if (pwToggleBtn) {
                if (!enable) {
                    pwToggleBtn.style.pointerEvents = 'none';
                    pwToggleBtn.style.opacity = '0.6';
                    passwordOptionDropdown.classList.remove('open');
                } else {
                    pwToggleBtn.style.pointerEvents = '';
                    pwToggleBtn.style.opacity = '';
                }
            }
        }

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
    }

    function closeDrawer() {
        if (staffDrawer) staffDrawer.classList.remove('open');
        if (staffDrawerOverlay) staffDrawerOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    function openDrawer(mode, staffData) {
        if (!staffForm || !staffDrawer) return;

        NS.currentMode = mode || 'add';
        staffForm.reset();
        setStatusDropdown('false');
        setPasswordOption('phone');

        NS.permissionFields.forEach(function(field) {
            var el = document.getElementById(field);
            if (el) el.checked = false;
        });

        resetClientAssignment();

        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span id="submit-btn-text">Add Staff</span>';
        }

        var submitBtnText = document.getElementById('submit-btn-text');
        var tempPwBtn = document.getElementById('tempPasswordStaffBtn');
        var pwRow = document.getElementById('staffPasswordOptionRow');

        if (mode === 'add') {
            if (drawerTitle) drawerTitle.textContent = 'Add New Client Staff';
            if (drawerIcon) drawerIcon.className = 'fa-solid fa-user-plus';
            if (submitBtnText) submitBtnText.textContent = 'Add Staff';
            if (submitBtn) submitBtn.style.display = 'inline-flex';
            if (pwRow) pwRow.style.display = '';
            if (tempPwBtn) tempPwBtn.style.display = 'none';
            enableFormInputs(true);
            initClientAssignment(null);
        } else if (mode === 'edit') {
            if (drawerTitle) drawerTitle.textContent = 'Edit Client Staff';
            if (drawerIcon) drawerIcon.className = 'fa-solid fa-pen-to-square';
            if (submitBtnText) submitBtnText.textContent = 'Save Changes';
            if (submitBtn) submitBtn.style.display = 'inline-flex';
            if (pwRow) pwRow.style.display = 'none';
            if (tempPwBtn) tempPwBtn.style.display = '';
            enableFormInputs(true);

            if (staffData) {
                document.getElementById('staff-name').value = staffData.name || '';
                document.getElementById('staff-email').value = staffData.email || '';
                document.getElementById('staff-phone').value = staffData.phone || '';
                document.getElementById('staff-address').value = staffData.address || '';
                setStatusDropdown(staffData.status === 'active' ? 'true' : 'false');

                NS.permissionFields.forEach(function(field) {
                    var el = document.getElementById(field);
                    var apiField = field.replace(/-/g, '_');
                    if (el) el.checked = staffData[apiField] === true;
                });

                initClientAssignment(staffData.client_id || null);
            }
        } else {
            if (drawerTitle) drawerTitle.textContent = 'View Client Staff';
            if (drawerIcon) drawerIcon.className = 'fa-solid fa-eye';
            if (submitBtn) submitBtn.style.display = 'none';
            if (pwRow) pwRow.style.display = 'none';
            if (tempPwBtn) tempPwBtn.style.display = 'none';
            enableFormInputs(false);

            if (staffData) {
                document.getElementById('staff-name').value = staffData.name || '';
                document.getElementById('staff-email').value = staffData.email || '';
                document.getElementById('staff-phone').value = staffData.phone || '';
                document.getElementById('staff-address').value = staffData.address || '';
                setStatusDropdown(staffData.status === 'active' ? 'true' : 'false');

                NS.permissionFields.forEach(function(field) {
                    var el = document.getElementById(field);
                    var apiField = field.replace(/-/g, '_');
                    if (el) el.checked = staffData[apiField] === true;
                });

                initClientAssignment(staffData.client_id || null);
            }
        }

        staffDrawer.classList.add('open');
        if (staffDrawerOverlay) staffDrawerOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    async function fetchStaffDetails(staffId) {
        try {
            var data = await ApiClient.get('/api/client-staff/' + staffId + '/');
            if (data.success) return data.staff;
            showToast(data.message || 'Failed to fetch staff details', 'error');
            return null;
        } catch (error) {
            showToast((error && error.message) ? error.message : 'Network error. Please try again.', 'error');
            return null;
        }
    }

    async function createStaff(formData) {
        try {
            return await ApiClient.post('/api/client-staff/create/', formData);
        } catch (error) {
            if (error && error.data && typeof error.data === 'object') return error.data;
            return { success: false, message: (error && error.message) ? error.message : 'Network error. Please try again.' };
        }
    }

    async function updateStaff(staffId, formData) {
        try {
            return await ApiClient.post('/api/client-staff/' + staffId + '/update/', formData);
        } catch (error) {
            if (error && error.data && typeof error.data === 'object') return error.data;
            return { success: false, message: (error && error.message) ? error.message : 'Network error. Please try again.' };
        }
    }

    async function deleteStaffApi(staffId) {
        try {
            return await ApiClient.post('/api/client-staff/' + staffId + '/delete/');
        } catch (error) {
            if (error && error.data && typeof error.data === 'object') return error.data;
            return { success: false, message: (error && error.message) ? error.message : 'Network error. Please try again.' };
        }
    }

    async function toggleStaffStatus(staffId) {
        try {
            return await ApiClient.post('/api/client-staff/' + staffId + '/toggle-status/');
        } catch (error) {
            if (error && error.data && typeof error.data === 'object') return error.data;
            return { success: false, message: (error && error.message) ? error.message : 'Network error. Please try again.' };
        }
    }

    if (addStaffBtn) {
        addStaffBtn.addEventListener('click', function() {
            openDrawer('add');
        });
    }

    if (editStaffBtn) {
        editStaffBtn.addEventListener('click', async function() {
            if (!NS.selectedStaffId) return;
            var staffData = await fetchStaffDetails(NS.selectedStaffId);
            if (staffData) openDrawer('edit', staffData);
        });
    }

    if (viewStaffBtn) {
        viewStaffBtn.addEventListener('click', async function() {
            if (!NS.selectedStaffId) return;
            var staffData = await fetchStaffDetails(NS.selectedStaffId);
            if (staffData) openDrawer('view', staffData);
        });
    }

    var deleteStaffNameEl = document.getElementById('deleteStaffName');
    var confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

    function openDeleteModal(staffName) {
        if (deleteStaffNameEl) deleteStaffNameEl.textContent = staffName;
        if (window.alpineOpenModal) window.alpineOpenModal('delete');
    }

    function closeDeleteModalFn() {
        if (window.alpineCloseModal) window.alpineCloseModal();
    }

    if (deleteStaffBtn) {
        deleteStaffBtn.addEventListener('click', function() {
            if (!NS.selectedStaffId || !NS.selectedRow) return;
            var staffName = (NS.selectedRow.querySelector('td:nth-child(1)') || {}).textContent || 'staff';
            openDeleteModal(staffName.trim());
        });
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async function() {
            if (!NS.selectedStaffId) return;
            var result = await deleteStaffApi(NS.selectedStaffId);
            if (result.success) {
                showToast(result.message || 'Staff deleted successfully', 'success');
                closeDeleteModalFn();
                if (typeof htmx !== 'undefined') {
                    htmx.trigger(document.body, 'refreshTable');
                } else {
                    location.reload();
                }
            } else {
                showToast(result.message || 'Failed to delete staff', 'error');
            }
        });
    }

    var pendingStatusStaffId = null;
    var confirmStatusBtn = document.getElementById('confirmStatusBtn');
    var statusStaffNameEl = document.getElementById('statusItemName');
    var statusModalHeader = document.getElementById('statusModalHeader');
    var statusModalIcon = document.getElementById('statusModalIcon');
    var statusNote = document.getElementById('statusNote');

    function openStatusModal(staffName, currentStatus) {
        if (statusStaffNameEl) statusStaffNameEl.textContent = staffName;

        if (currentStatus === 'active') {
            if (statusModalHeader) statusModalHeader.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
            if (statusModalIcon) statusModalIcon.innerHTML = '<i class="fa-solid fa-ban" style="font-size: 48px; color: #ef4444;"></i>';
            if (statusNote) statusNote.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> This will prevent the staff member from logging in.';
            if (confirmStatusBtn) {
                confirmStatusBtn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
                confirmStatusBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Deactivate';
            }
        } else {
            if (statusModalHeader) statusModalHeader.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
            if (statusModalIcon) statusModalIcon.innerHTML = '<i class="fa-solid fa-check-circle" style="font-size: 48px; color: #22c55e;"></i>';
            if (statusNote) statusNote.innerHTML = '<i class="fa-solid fa-info-circle"></i> This will allow the staff member to log in.';
            if (confirmStatusBtn) {
                confirmStatusBtn.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
                confirmStatusBtn.innerHTML = '<i class="fa-solid fa-check"></i> Activate';
            }
        }

        if (window.alpineOpenModal) window.alpineOpenModal('status');
    }

    function closeStatusModalFn() {
        if (window.alpineCloseModal) window.alpineCloseModal();
        pendingStatusStaffId = null;
    }

    if (activeStaffBtn) {
        activeStaffBtn.addEventListener('click', function() {
            if (!NS.selectedStaffId || !NS.selectedRow) return;
            pendingStatusStaffId = NS.selectedStaffId;
            var staffName = (NS.selectedRow.querySelector('td:nth-child(1)') || {}).textContent || 'staff';
            openStatusModal(staffName.trim(), NS.selectedRow.dataset.staffStatus || 'inactive');
        });
    }

    if (confirmStatusBtn) {
        confirmStatusBtn.addEventListener('click', async function() {
            if (!pendingStatusStaffId) return;
            var result = await toggleStaffStatus(pendingStatusStaffId);
            if (result.success) {
                showToast(result.message || 'Status updated', 'success');
                closeStatusModalFn();
                if (NS.selectedRow) {
                    var status = result.status || ((result.data || {}).status) || 'inactive';
                    var statusDisplay = result.status_display || ((result.data || {}).status_display) || (status === 'active' ? 'Active' : 'Inactive');
                    NS.selectedRow.dataset.staffStatus = status;
                    var statusBadge = NS.selectedRow.querySelector('.status-badge');
                    if (statusBadge) {
                        statusBadge.textContent = statusDisplay;
                        statusBadge.className = 'status-badge ' + (status === 'active' ? 'active' : 'inactive');
                    }
                    updateActiveButtonState();
                }
            } else {
                showToast(result.message || 'Failed to update status', 'error');
            }
        });
    }

    if (closeStaffDrawer) {
        closeStaffDrawer.addEventListener('click', function() { closeDrawer(); });
    }
    if (cancelStaffDrawer) {
        cancelStaffDrawer.addEventListener('click', function(e) {
            e.preventDefault();
            closeDrawer();
        });
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && staffDrawer && staffDrawer.classList.contains('open')) {
            closeDrawer();
        }
    });

    if (staffForm) {
        staffForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            var submitButton = staffForm.querySelector('button[type="submit"]');
            if (!submitButton || submitButton.disabled) return;

            submitButton.disabled = true;
            var originalText = submitButton.innerHTML;
            submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

            var selectedClientId = getSelectedClientId();
            var isCreateMode = !(NS.currentMode === 'edit' && NS.selectedStaffId);

            var formData = {
                name: (document.getElementById('staff-name').value || '').trim(),
                email: (document.getElementById('staff-email').value || '').trim(),
                phone: (document.getElementById('staff-phone').value || '').trim(),
                address: document.getElementById('staff-address') ? document.getElementById('staff-address').value : '',
                is_active: document.getElementById('staff-status').value === 'true',
                client_id: selectedClientId
            };

            if (!formData.name) {
                showToast('Name is required', 'error');
                submitButton.disabled = false;
                submitButton.innerHTML = originalText;
                return;
            }

            if (!formData.client_id) {
                showToast('Please select a client', 'error');
                submitButton.disabled = false;
                submitButton.innerHTML = originalText;
                return;
            }

            var pwOpt = document.getElementById('staff-password-option');
            var pwVal = document.getElementById('staff-password');
            if (isCreateMode && pwOpt) {
                if (pwOpt.value === 'custom') {
                    if (!pwVal || !pwVal.value.trim()) {
                        showToast('Custom password is required when phone password is not used', 'error');
                        submitButton.disabled = false;
                        submitButton.innerHTML = originalText;
                        return;
                    }
                    formData.password = pwVal.value.trim();
                } else if (!formData.phone) {
                    showToast('Phone is required when using phone number as password', 'error');
                    submitButton.disabled = false;
                    submitButton.innerHTML = originalText;
                    return;
                }
            }

            NS.permissionFields.forEach(function(field) {
                var el = document.getElementById(field);
                var apiField = field.replace(/-/g, '_');
                if (el) formData[apiField] = !!el.checked;
            });

            var result;
            try {
                if (NS.currentMode === 'edit' && NS.selectedStaffId) {
                    result = await updateStaff(NS.selectedStaffId, formData);
                } else {
                    result = await createStaff(formData);
                }

                if (result.success) {
                    showToast(result.message || 'Saved successfully', 'success');
                    closeDrawer();
                    if (typeof htmx !== 'undefined' && document.getElementById('staff-table-container')) {
                        setTimeout(function() { htmx.trigger(document.body, 'refreshTable'); }, 250);
                    } else {
                        setTimeout(function() { location.reload(); }, 400);
                    }
                } else {
                    showToast(result.message || 'Operation failed', 'error');
                    submitButton.disabled = false;
                    submitButton.innerHTML = originalText;
                }
            } catch (error) {
                showToast((error && error.message) ? error.message : 'An error occurred. Please try again.', 'error');
                submitButton.disabled = false;
                submitButton.innerHTML = originalText;
            }
        });
    }

    var tempPwVerificationCode = '';
    var tempPwTargetId = null;

    window.openTempPasswordModal = function() {
        tempPwTargetId = NS.selectedStaffId;
        var targetName = document.getElementById('staff-name') ? document.getElementById('staff-name').value : 'this user';

        if (!tempPwTargetId) {
            showToast('No staff selected', 'error');
            return;
        }

        tempPwVerificationCode = (typeof ConfirmationCode !== 'undefined')
            ? ConfirmationCode.generate()
            : String(Math.floor(1000000000 + Math.random() * 9000000000));

        document.getElementById('tempPwStep1').style.display = '';
        document.getElementById('tempPwStep2').style.display = 'none';
        document.getElementById('tempPwVerifyCode').textContent = tempPwVerificationCode;
        document.getElementById('tempPwCodeInput').value = '';
        document.getElementById('tempPwCodeError').style.display = 'none';
        document.getElementById('tempPwNewPassword').value = '';
        document.getElementById('tempPwError').style.display = 'none';
        document.getElementById('tempPwUserName').textContent = targetName || 'this user';

        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
            window.AdarshModalBridge.open('temp-password-modal', { overlayClass: 'show' });
        } else {
            var modal = document.getElementById('temp-password-modal');
            if (modal) modal.style.display = 'flex';
        }
    };

    window.closeTempPasswordModal = function() {
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
            window.AdarshModalBridge.close('temp-password-modal', { overlayClass: 'show' });
        } else {
            var modal = document.getElementById('temp-password-modal');
            if (modal) modal.style.display = 'none';
        }
        tempPwVerificationCode = '';
        tempPwTargetId = null;
    };

    window.verifyTempPwCode = function() {
        var input = document.getElementById('tempPwCodeInput').value.trim();
        var errEl = document.getElementById('tempPwCodeError');
        if (input === tempPwVerificationCode) {
            errEl.style.display = 'none';
            document.getElementById('tempPwStep1').style.display = 'none';
            document.getElementById('tempPwStep2').style.display = '';
            document.getElementById('tempPwNewPassword').focus();
        } else {
            errEl.style.display = '';
        }
    };

    window.toggleTempPwVisibility = function() {
        var pwInput = document.getElementById('tempPwNewPassword');
        var eyeIcon = document.getElementById('tempPwEyeIcon');
        if (pwInput.type === 'password') {
            pwInput.type = 'text';
            if (eyeIcon) eyeIcon.className = 'fa-solid fa-eye-slash';
        } else {
            pwInput.type = 'password';
            if (eyeIcon) eyeIcon.className = 'fa-solid fa-eye';
        }
    };

    window.saveTempPassword = async function() {
        var password = document.getElementById('tempPwNewPassword').value;
        var errEl = document.getElementById('tempPwError');
        if (!password || password.length < 8) {
            errEl.style.display = '';
            return;
        }
        errEl.style.display = 'none';

        var saveBtn = document.getElementById('tempPwSaveBtn');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        try {
            var result = await ApiClient.post('/api/client-staff/' + tempPwTargetId + '/set-temp-password/', { password: password });
            if (result.success) {
                closeTempPasswordModal();
                showToast(result.message || 'Temporary password set successfully!', 'success');
            } else {
                showToast(result.message || 'Failed to set password', 'error');
            }
        } catch (error) {
            showToast('Network error. Please try again.', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Save Password';
        }
    };

    enableActionButtons(false);
    updateClientSelectionText();
});
