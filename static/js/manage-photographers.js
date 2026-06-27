document.addEventListener('DOMContentLoaded', function() {
    var NS = {
        selectedStaffId: null,
        selectedRow: null,
        currentMode: 'add',
    };

    // ==================== DRAWER ELEMENTS ====================
    var staffDrawer = document.getElementById('staff-drawer');
    var staffDrawerOverlay = document.getElementById('staff-drawer-overlay');
    var staffForm = document.getElementById('staff-form');
    var drawerTitle = document.getElementById('drawer-title-text');
    var drawerIcon = document.getElementById('drawer-icon');
    var submitBtn = document.getElementById('drawer-submit-btn');
    var statusDropdown = document.getElementById('staffStatusDropdown');

    var permissionFields = [
        'perm-idcard-pending-list',
        'perm-idcard-verified-list',
        'perm-idcard-add',
        'perm-idcard-info',
        'perm-mobile-app',
        'perm-idcard-bulk-download'
    ];

    // ==================== BUTTON ELEMENTS ====================
    var addStaffBtn = document.getElementById('addStaffBtn');
    var editStaffBtn = document.getElementById('editStaffBtn');
    var viewStaffBtn = document.getElementById('viewStaffBtn');
    var assignStaffBtn = document.getElementById('assignStaffBtn');
    var deleteStaffBtn = document.getElementById('deleteStaffBtn');
    var activeStaffBtn = document.getElementById('activeStaffBtn');
    var closeStaffDrawer = document.getElementById('drawer-close-btn');
    var cancelStaffDrawer = document.getElementById('drawer-cancel-btn');

    // ==================== ROW SELECTION ====================
    function setupRowSelection() {
        var tbody = document.getElementById('staff-table-body');
        if (!tbody) return;

        tbody.addEventListener('click', function(e) {
            var row = e.target.closest('tr');
            if (!row || !row.dataset.staffId) return;

            // Toggle selection
            if (NS.selectedRow === row) {
                deselectAllRows();
            } else {
                deselectAllRows();
                NS.selectedRow = row;
                NS.selectedStaffId = parseInt(row.dataset.staffId);
                row.classList.add('selected');
                updateActionButtonsState(true);
            }
        });
    }

    function deselectAllRows() {
        var selected = document.querySelectorAll('#staff-table-body tr.selected');
        selected.forEach(function(r) { r.classList.remove('selected'); });
        NS.selectedRow = null;
        NS.selectedStaffId = null;
        updateActionButtonsState(false);
    }

    function updateActionButtonsState(enabled) {
        if (editStaffBtn) editStaffBtn.disabled = !enabled;
        if (viewStaffBtn) viewStaffBtn.disabled = !enabled;
        if (assignStaffBtn) assignStaffBtn.disabled = !enabled;
        if (deleteStaffBtn) deleteStaffBtn.disabled = !enabled;
        if (activeStaffBtn) {
            activeStaffBtn.disabled = !enabled;
            if (enabled && NS.selectedRow) {
                var isAct = NS.selectedRow.dataset.staffStatus === 'active';
                activeStaffBtn.innerHTML = isAct ? '<i class="fa-solid fa-toggle-on"></i> Active' : '<i class="fa-solid fa-toggle-off"></i> Inactive';
            }
        }
    }

    // ==================== CLIENT ROW INTERACTION ====================
    function setupClientRowInteractions() {
        var container = document.querySelector('.photographer-client-assignment-container');
        if (!container) return;

        container.addEventListener('change', function(e) {
            if (e.target.classList.contains('photographer-client-cb')) {
                var row = e.target.closest('.photographer-client-row');
                var optContainer = row.querySelector('.expiry-options-container');
                var expiryInput = row.querySelector('.photographer-client-expiry');
                
                if (e.target.checked) {
                    row.classList.add('selected');
                    if (optContainer) optContainer.style.display = 'flex';
                    if (expiryInput) { expiryInput.disabled = false; expiryInput.focus(); }
                } else {
                    row.classList.remove('selected');
                    if (optContainer) optContainer.style.display = 'none';
                    if (expiryInput) { expiryInput.disabled = true; expiryInput.value = ''; }
                }
                renderAssignedClientChips();
            }
        });
    }

    // ==================== DROPDOWN HELPER ====================
    function setupDropdowns() {
        var dropdowns = document.querySelectorAll('.custom-dropdown');
        dropdowns.forEach(function(dd) {
            var toggle = dd.querySelector('.dropdown-toggle');
            var options = dd.querySelector('.dropdown-options');
            var input = dd.nextElementSibling; // Hidden input should follow immediately

            if (!toggle || !options) return;

            toggle.addEventListener('click', function(e) {
                e.stopPropagation();
                dd.classList.toggle('open');
            });

            options.addEventListener('click', function(e) {
                var opt = e.target.closest('.dropdown-option');
                if (!opt) return;

                // Select option
                options.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
                opt.classList.add('selected');
                toggle.querySelector('span').textContent = opt.textContent.trim();
                if (input) {
                    input.value = opt.dataset.value;
                    input.dispatchEvent(new Event('change'));
                }
                dd.classList.remove('open');
            });
        });

        document.addEventListener('click', function() {
            dropdowns.forEach(function(dd) { dd.classList.remove('open'); });
        });
    }

    function setStatusDropdownValue(val) {
        var dd = document.getElementById('staffStatusDropdown');
        if (!dd) return;
        var toggleSpan = dd.querySelector('.dropdown-toggle span');
        var input = document.getElementById('staff-status');
        dd.querySelectorAll('.dropdown-option').forEach(function(opt) {
            if (opt.dataset.value === String(val)) {
                opt.classList.add('selected');
                if (toggleSpan) toggleSpan.textContent = opt.textContent.trim();
                if (input) input.value = opt.dataset.value;
            } else {
                opt.classList.remove('selected');
            }
        });
    }

    function setPasswordOptionValue(val) {
        var dd = document.getElementById('staffPasswordOptionDropdown');
        if (!dd) return;
        var toggleSpan = dd.querySelector('.dropdown-toggle span');
        var input = document.getElementById('staff-password-option');
        dd.querySelectorAll('.dropdown-option').forEach(function(opt) {
            if (opt.dataset.value === String(val)) {
                opt.classList.add('selected');
                if (toggleSpan) toggleSpan.textContent = opt.textContent.trim();
                if (input) input.value = opt.dataset.value;
            } else {
                opt.classList.remove('selected');
            }
        });
        
        var customGroup = document.getElementById('staffCustomPasswordGroup');
        if (customGroup) {
            customGroup.style.display = (val === 'custom') ? '' : 'none';
        }
    }

    // ==================== DRAWER OPEN/CLOSE ====================
    function openDrawer(mode, data) {
        NS.currentMode = mode;
        staffForm.reset();
        setStatusDropdownValue('false');
        setPasswordOptionValue('custom');

        // Clear client assignments
        document.querySelectorAll('.photographer-client-cb').forEach(function(cb) {
            cb.checked = false;
            var row = cb.closest('.photographer-client-row');
            row.classList.remove('selected');
            var optContainer = row.querySelector('.expiry-options-container');
            if (optContainer) optContainer.style.display = 'none';
            var expiry = row.querySelector('.photographer-client-expiry');
            if (expiry) { expiry.disabled = true; expiry.value = ''; }
        });

        // Reset search field
        var searchInput = document.getElementById('client-search-input');
        if (searchInput) {
            searchInput.value = '';
            document.querySelectorAll('.photographer-client-row').forEach(function(row) {
                row.style.display = 'flex';
            });
        }

        // Render empty chips
        renderAssignedClientChips();

        // Always enable inputs first
        enableFormInputs(true);
        submitBtn.disabled = false;
        
        var tempPwBtn = document.getElementById('tempPasswordStaffBtn');

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
            drawerTitle.textContent = 'Add New Photographer';
            drawerIcon.className = 'fa-solid fa-user-plus';
            submitBtn.querySelector('span').textContent = 'Add Photographer';
            submitBtn.style.display = 'inline-flex';
            if (tempPwBtn) tempPwBtn.style.display = 'none';
            
            // Reset all photographer permission toggles to checked by default
            permissionFields.forEach(function(field) {
                var el = document.getElementById(field);
                if (el) el.checked = true;
            });
            
            var pwRow = document.getElementById('staffPasswordOptionRow');
            if (pwRow) pwRow.style.display = '';
        } else {
            if (tempPwBtn) tempPwBtn.style.display = (mode === 'edit') ? '' : 'none';
            var pwRow = document.getElementById('staffPasswordOptionRow');
            if (pwRow) pwRow.style.display = 'none';

            if (data) {
                document.getElementById('staff-id').value = data.id;
                document.getElementById('staff-name').value = data.name;
                document.getElementById('staff-email').value = data.email;
                document.getElementById('staff-phone').value = data.phone;
                var photographerAddressInput = document.getElementById('staff-address');
                if (photographerAddressInput) photographerAddressInput.value = data.address || '';
                setStatusDropdownValue(data.status === 'active' ? 'true' : 'false');

                // Set permissions from data
                permissionFields.forEach(function(field) {
                    var el = document.getElementById(field);
                    var apiField = field.replace(/-/g, '_');
                    if (el) el.checked = data[apiField] === true;
                });

                // Populate assignments
                if (data.assigned_clients) {
                    data.assigned_clients.forEach(function(ass) {
                        var cb = document.querySelector('.photographer-client-cb[value="' + ass.client_id + '"]');
                        if (cb) {
                            cb.checked = true;
                            var row = cb.closest('.photographer-client-row');
                            row.classList.add('selected');
                            
                            var optContainer = row.querySelector('.expiry-options-container');
                            if (optContainer) optContainer.style.display = 'flex';
                            
                            if (ass.expires_at) {
                                var expiresAt = new Date(ass.expires_at);
                                var hoursRemaining = Math.max(0, Math.ceil((expiresAt - new Date()) / 3600000));
                                
                                // Pick closest preset if within tolerance, else custom
                                var optionInput = row.querySelector('.photographer-client-option');
                                var expiryInput = row.querySelector('.photographer-client-expiry');
                                var selectedPreset = 'custom';
                                
                                row.querySelectorAll('.expiry-preset-btn').forEach(function(btn) {
                                    if (btn.dataset.value === selectedPreset) {
                                        btn.classList.add('selected');
                                        btn.style.background = 'var(--color-indigo-600)';
                                        btn.style.color = '#fff';
                                    } else {
                                        btn.classList.remove('selected');
                                        btn.style.background = 'transparent';
                                        btn.style.color = 'var(--color-slate-600)';
                                    }
                                });
                                
                                if (optionInput) optionInput.value = 'custom';
                                if (expiryInput) {
                                    expiryInput.disabled = false;
                                    expiryInput.style.display = '';
                                    expiryInput.value = hoursRemaining > 0 ? String(hoursRemaining) : '';
                                }
                            } else {
                                // No existing expiry — leave hours blank
                                var expiryInput = row.querySelector('.photographer-client-expiry');
                                if (expiryInput) { expiryInput.disabled = false; expiryInput.value = ''; }
                            }
                        }
                    });
                }
                renderAssignedClientChips();
            }

            if (mode === 'edit') {
                drawerTitle.textContent = 'Edit Photographer';
                drawerIcon.className = 'fa-solid fa-pen-to-square';
                submitBtn.querySelector('span').textContent = 'Save Changes';
                submitBtn.style.display = 'inline-flex';
            } else if (mode === 'assign') {
                drawerTitle.textContent = 'Assign Clients - ' + (data ? data.name : '');
                drawerIcon.className = 'fa-solid fa-link';
                submitBtn.querySelector('span').textContent = 'Save Assignments';
                submitBtn.style.display = 'inline-flex';
            } else {
                drawerTitle.textContent = 'View Photographer Details';
                drawerIcon.className = 'fa-solid fa-eye';
                submitBtn.style.display = 'none';
                enableFormInputs(false);
            }
        }

        staffDrawer.classList.add('open');
        if (staffDrawerOverlay) staffDrawerOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
        staffDrawer.classList.remove('open');
        if (staffDrawerOverlay) staffDrawerOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    function enableFormInputs(enable) {
        var inputs = staffDrawer.querySelectorAll('input, select, textarea');
        inputs.forEach(function(input) {
            if (input.type === 'hidden') return;
            input.disabled = !enable;
            input.style.backgroundColor = enable ? '' : '#f5f5f5';
            input.style.cursor = enable ? '' : 'not-allowed';
        });

        // Custom status dropdown
        if (statusDropdown) {
            var toggle = statusDropdown.querySelector('.dropdown-toggle');
            if (toggle) {
                toggle.style.pointerEvents = enable ? '' : 'none';
                toggle.style.opacity = enable ? '' : '0.6';
                toggle.style.backgroundColor = enable ? '' : '#f5f5f5';
            }
        }

        // Custom client list inputs
        document.querySelectorAll('.photographer-client-cb').forEach(function(cb) {
            cb.disabled = !enable;
        });
        document.querySelectorAll('.photographer-client-expiry').forEach(function(exp) {
            var cb = exp.closest('.photographer-client-row').querySelector('.photographer-client-cb');
            exp.disabled = !enable || !cb.checked;
        });
    }

    // ==================== API ACTIONS ====================
    async function fetchPhotographerDetails(id) {
        try {
            var res = await ApiClient.get('/panel/api/photographer/' + id + '/');
            if (res.success) return res.staff;
            showToast(res.message || 'Failed to fetch details', 'error');
        } catch (err) {
            showToast('Network error', 'error');
        }
        return null;
    }

    // Submit handler
    if (staffForm) {
        staffForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            if (submitBtn.disabled) return;

            var originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

            var isCreate = (NS.currentMode === 'add');

            // Gather client assignments
            var assignedClients = [];
            document.querySelectorAll('.photographer-client-cb:checked').forEach(function(cb) {
                var row = cb.closest('.photographer-client-row');
                var hoursVal = parseFloat(row.querySelector('.photographer-client-expiry').value);
                var expiresAt = null;
                if (hoursVal && hoursVal > 0) {
                    var d = new Date();
                    d.setTime(d.getTime() + hoursVal * 3600 * 1000);
                    expiresAt = d.toISOString();
                }
                assignedClients.push({
                    client_id: parseInt(cb.value),
                    expires_at: expiresAt
                });
            });

            var payload = {
                name: document.getElementById('staff-name').value.trim(),
                email: document.getElementById('staff-email').value.trim(),
                phone: document.getElementById('staff-phone').value.trim(),
                address: document.getElementById('staff-address') ? document.getElementById('staff-address').value.trim() : '',
                is_active: document.getElementById('staff-status').value === 'true',
                assigned_clients: assignedClients,
            };

            // Add all permissions to payload
            permissionFields.forEach(function(field) {
                var el = document.getElementById(field);
                var apiField = field.replace(/-/g, '_');
                if (el) payload[apiField] = el.checked;
            });

            if (isCreate) {
                var pwOption = document.getElementById('staff-password-option').value;
                if (pwOption === 'custom') {
                    payload.password = document.getElementById('staff-password').value.trim();
                }
            }

            try {
                var url, res;
                if (NS.currentMode === 'assign') {
                    // Dedicated assign-only endpoint — no name/email needed
                    url = '/panel/api/photographer/' + document.getElementById('staff-id').value + '/assign-clients/';
                    res = await ApiClient.post(url, { assigned_clients: assignedClients });
                } else if (isCreate) {
                    url = '/panel/api/photographer/create/';
                    res = await ApiClient.post(url, payload);
                } else {
                    url = '/panel/api/photographer/' + document.getElementById('staff-id').value + '/update/';
                    res = await ApiClient.post(url, payload);
                }

                if (res.success) {
                    showToast(res.message || 'Saved successfully', 'success');
                    closeDrawer();
                    deselectAllRows();
                    setTimeout(function() {
                        htmx.trigger(document.body, 'refreshTable');
                    }, 300);
                } else {
                    showToast(res.message || 'Failed to save', 'error');
                }
            } catch (err) {
                showToast('Network error', 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        });
    }

    // Add / Edit / View event handlers
    if (addStaffBtn) {
        addStaffBtn.addEventListener('click', function() { openDrawer('add'); });
    }
    if (editStaffBtn) {
        editStaffBtn.addEventListener('click', async function() {
            if (!NS.selectedStaffId) return;
            var data = await fetchPhotographerDetails(NS.selectedStaffId);
            if (data) openDrawer('edit', data);
        });
    }
    if (assignStaffBtn) {
        assignStaffBtn.addEventListener('click', async function() {
            if (!NS.selectedStaffId) return;
            var data = await fetchPhotographerDetails(NS.selectedStaffId);
            if (data) openDrawer('assign', data);
        });
    }
    if (viewStaffBtn) {
        viewStaffBtn.addEventListener('click', async function() {
            if (!NS.selectedStaffId) return;
            var data = await fetchPhotographerDetails(NS.selectedStaffId);
            if (data) openDrawer('view', data);
        });
    }

    // Toggle Active Status
    if (activeStaffBtn) {
        activeStaffBtn.addEventListener('click', function() {
            if (!NS.selectedStaffId || !NS.selectedRow) return;
            var name = NS.selectedRow.dataset.staffName;
            var currentStatus = NS.selectedRow.dataset.staffStatus;
            openStatusModal(name, currentStatus);
        });
    }

    // Delete Modal
    if (deleteStaffBtn) {
        deleteStaffBtn.addEventListener('click', function() {
            if (!NS.selectedStaffId || !NS.selectedRow) return;
            var name = NS.selectedRow.dataset.staffName;
            openDeleteModal(name);
        });
    }

    // Footer buttons close
    if (closeStaffDrawer) closeStaffDrawer.addEventListener('click', closeDrawer);
    if (cancelStaffDrawer) cancelStaffDrawer.addEventListener('click', function(e) {
        e.preventDefault();
        closeDrawer();
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeDrawer();
            closeDeleteModal();
            closeStatusModal();
        }
    });

    // ==================== MODAL OVERRIDES ====================
    window.openDeleteModal = function(name) {
        var modal = document.getElementById('delete-modal');
        var nameEl = document.getElementById('deleteStaffName');
        if (nameEl) nameEl.textContent = name;
        if (modal) modal.style.display = 'flex';
    };

    window.closeDeleteModal = function() {
        var modal = document.getElementById('delete-modal');
        if (modal) modal.style.display = 'none';
    };

    window.openStatusModal = function(name, currentStatus) {
        var modal = document.getElementById('status-modal');
        var nameEl = document.getElementById('statusStaffName');
        if (nameEl) nameEl.textContent = name;
        
        var actionText = (currentStatus === 'active') ? 'deactivate' : 'activate';
        var actionTextEl = document.getElementById('statusActionText');
        if (actionTextEl) actionTextEl.textContent = actionText;

        if (modal) modal.style.display = 'flex';
    };

    window.closeStatusModal = function() {
        var modal = document.getElementById('status-modal');
        if (modal) modal.style.display = 'none';
    };

    // Modal submit handlers
    var confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async function() {
            if (!NS.selectedStaffId) return;
            confirmDeleteBtn.disabled = true;
            try {
                var res = await ApiClient.post('/panel/api/photographer/' + NS.selectedStaffId + '/delete/');
                if (res.success) {
                    showToast(res.message || 'Photographer deleted successfully', 'success');
                    closeDeleteModal();
                    deselectAllRows();
                    setTimeout(function() {
                        htmx.trigger(document.body, 'refreshTable');
                    }, 300);
                } else {
                    showToast(res.message || 'Delete failed', 'error');
                }
            } catch (err) {
                showToast('Network error', 'error');
            } finally {
                confirmDeleteBtn.disabled = false;
            }
        });
    }

    var confirmStatusBtn = document.getElementById('confirmStatusBtn');
    if (confirmStatusBtn) {
        confirmStatusBtn.addEventListener('click', async function() {
            if (!NS.selectedStaffId) return;
            confirmStatusBtn.disabled = true;
            try {
                var res = await ApiClient.post('/panel/api/photographer/' + NS.selectedStaffId + '/toggle-status/');
                if (res.success) {
                    showToast(res.message || 'Status updated successfully', 'success');
                    closeStatusModal();
                    deselectAllRows();
                    setTimeout(function() {
                        htmx.trigger(document.body, 'refreshTable');
                    }, 300);
                } else {
                    showToast(res.message || 'Status update failed', 'error');
                }
            } catch (err) {
                showToast('Network error', 'error');
            } finally {
                confirmStatusBtn.disabled = false;
            }
        });
    }

    // ==================== TEMP PASSWORD OVERRIDES ====================
    var tempPwVerificationCode = '';
    var tempPwTargetId = null;

    window.openTempPasswordModal = function(type) {
        tempPwTargetId = NS.selectedStaffId;
        var name = document.getElementById('staff-name').value || 'this photographer';

        if (!tempPwTargetId) {
            showToast('No photographer selected', 'error');
            return;
        }

        tempPwVerificationCode = (typeof ConfirmationCode !== 'undefined') ? ConfirmationCode.generate() : String(Math.floor(1000000000 + Math.random() * 9000000000));

        var modal = document.getElementById('temp-password-modal');
        document.getElementById('tempPwStep1').style.display = '';
        document.getElementById('tempPwStep2').style.display = 'none';
        document.getElementById('tempPwVerifyCode').textContent = tempPwVerificationCode;
        document.getElementById('tempPwCodeInput').value = '';
        if (typeof window.renderTempPwCodeBoxes === 'function') window.renderTempPwCodeBoxes('');
        if (typeof window.setTempPwCodeState === 'function') window.setTempPwCodeState('');
        document.getElementById('tempPwCodeError').style.display = 'none';
        document.getElementById('tempPwNewPassword').value = '';
        document.getElementById('tempPwError').style.display = 'none';
        document.getElementById('tempPwUserName').textContent = name;

        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
            window.AdarshModalBridge.open('temp-password-modal', { overlayClass: 'show' });
        } else {
            modal.style.display = 'flex';
        }
    };

    window.closeTempPasswordModal = function() {
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
            window.AdarshModalBridge.close('temp-password-modal', { overlayClass: 'show' });
        } else {
            document.getElementById('temp-password-modal').style.display = 'none';
        }
        tempPwVerificationCode = '';
        tempPwTargetId = null;
        if (typeof window.setTempPwCodeState === 'function') window.setTempPwCodeState('');
    };

    window.verifyTempPwCode = function() {
        var codeInputEl = document.getElementById('tempPwCodeInput');
        var input = (codeInputEl ? codeInputEl.value : '').replace(/\D/g, '').slice(0, 10);
        if (codeInputEl) codeInputEl.value = input;
        if (typeof window.renderTempPwCodeBoxes === 'function') window.renderTempPwCodeBoxes(input);
        var errEl = document.getElementById('tempPwCodeError');
        if (input === tempPwVerificationCode) {
            if (typeof window.setTempPwCodeState === 'function') window.setTempPwCodeState('is-valid');
            errEl.style.display = 'none';
            document.getElementById('tempPwStep1').style.display = 'none';
            document.getElementById('tempPwStep2').style.display = '';
            document.getElementById('tempPwNewPassword').focus();
        } else {
            if (typeof window.setTempPwCodeState === 'function') window.setTempPwCodeState(input.length === 10 ? 'is-invalid' : '');
            errEl.style.display = '';
        }
    };

    window.toggleTempPwVisibility = function() {
        var pwInput = document.getElementById('tempPwNewPassword');
        var eyeIcon = document.getElementById('tempPwEyeIcon');
        if (pwInput.type === 'password') {
            pwInput.type = 'text';
            eyeIcon.className = 'fa-solid fa-eye-slash';
        } else {
            pwInput.type = 'password';
            eyeIcon.className = 'fa-solid fa-eye';
        }
    };

    window.saveTempPassword = async function() {
        var password = document.getElementById('tempPwNewPassword').value;
        var errEl = document.getElementById('tempPwError');
        if (!password || password.length < 8) {
            errEl.style.display = '';
            errEl.textContent = 'Password must be at least 8 characters.';
            return;
        }
        errEl.style.display = 'none';

        var saveBtn = document.getElementById('tempPwSaveBtn');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        try {
            var url = '/api/staff/' + tempPwTargetId + '/set-temp-password/';
            var result = await ApiClient.post(url, { password: password });
            if (result.success) {
                closeTempPasswordModal();
                showToast(result.message || 'Temporary password set successfully!', 'success');
            } else {
                showToast(result.message || 'Failed to set password', 'error');
            }
        } catch (err) {
            showToast('Network error. Please try again.', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Save Password';
        }
    };

    // ==================== INITIALIZATION ====================
    setupRowSelection();
    setupDropdowns();
    setupClientRowInteractions();
    startCountdownTimers();
 
    var pwOptionInput = document.getElementById('staff-password-option');
    if (pwOptionInput) {
        pwOptionInput.addEventListener('change', function() {
            var customGroup = document.getElementById('staffCustomPasswordGroup');
            if (customGroup) {
                customGroup.style.display = (this.value === 'custom') ? '' : 'none';
            }
        });
    }

    // Setup search filter
    var clientSearchInput = document.getElementById('client-search-input');
    if (clientSearchInput) {
        clientSearchInput.addEventListener('input', function() {
            var val = this.value.toLowerCase().trim();
            document.querySelectorAll('.photographer-client-row').forEach(function(row) {
                var name = row.dataset.clientName.toLowerCase();
                if (name.indexOf(val) > -1) {
                    row.style.display = 'flex';
                } else {
                    row.style.display = 'none';
                }
            });
        });
    }


    // Expiry input change listener — re-render chips when hours value changes
    document.querySelectorAll('.photographer-client-expiry').forEach(function(input) {
        input.addEventListener('input', function() {
            renderAssignedClientChips();
        });
    });


    function renderAssignedClientChips() {
        var container = document.getElementById('photographer-assigned-chips-container');
        if (!container) return;
        
        container.innerHTML = '';
        var checkedCbs = document.querySelectorAll('.photographer-client-cb:checked');
        
        if (checkedCbs.length === 0) {
            container.innerHTML = '<div style="font-size: 12px; color: var(--color-slate-400); font-style: italic;">No client assignments added yet.</div>';
            return;
        }
        
        var canEdit = (NS.currentMode !== 'view');
        
        checkedCbs.forEach(function(cb) {
            var row = cb.closest('.photographer-client-row');
            var clientName = row.dataset.clientName;
            var hoursVal = parseFloat(row.querySelector('.photographer-client-expiry').value);
            var timeText = (hoursVal && hoursVal > 0) ? 'Expires in ' + hoursVal + 'h' : 'No expiry set';
            
            var chip = document.createElement('div');
            chip.className = 'assignment-chip';
            chip.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; background: #eef2ff; border: 1px solid #c7d2fe; color: #3730a3; padding: 4px 10px; border-radius: 100px; font-size: 12px; font-weight: 600;';
            
            var textSpan = document.createElement('span');
            textSpan.textContent = clientName + ' — ' + timeText;
            chip.appendChild(textSpan);
            
            if (canEdit) {
                var removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                removeBtn.style.cssText = 'border: none; background: transparent; color: #818cf8; cursor: pointer; padding: 2px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; margin-left: 2px;';
                removeBtn.addEventListener('click', function() {
                    cb.checked = false;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                });
                chip.appendChild(removeBtn);
            }
            
            container.appendChild(chip);
        });
    }

    function startCountdownTimers() {
        if (window.photographerCountdownInterval) {
            clearInterval(window.photographerCountdownInterval);
        }
        
        function updateTimers() {
            var nowMs = Date.now();
            var timerElements = document.querySelectorAll('.photographer-timer-chip');
            timerElements.forEach(function(el) {
                // Use Unix timestamp in seconds (from data-expires-ts) — timezone-safe
                var expiresTs = parseInt(el.dataset.expiresTs, 10);
                if (!expiresTs || isNaN(expiresTs)) return;
                
                var diffMs = (expiresTs * 1000) - nowMs;
                var timerSpan = el.querySelector('.countdown-timer');
                if (!timerSpan) return;
                
                if (diffMs <= 0) {
                    timerSpan.textContent = 'Expired';
                    timerSpan.style.color = '#ef4444';
                    timerSpan.style.background = 'rgba(239,68,68,0.12)';
                    el.style.background = '#fef2f2';
                    el.style.borderColor = '#fca5a5';
                    el.style.color = '#991b1b';
                } else {
                    var totalSecs = Math.floor(diffMs / 1000);
                    var hours = Math.floor(totalSecs / 3600);
                    var mins = Math.floor((totalSecs % 3600) / 60);
                    var secs = totalSecs % 60;
                    
                    var timeStr;
                    if (hours >= 1) {
                        timeStr = hours + 'h ' + String(mins).padStart(2, '0') + 'm';
                    } else {
                        timeStr = String(mins).padStart(2, '0') + 'm ' + String(secs).padStart(2, '0') + 's';
                    }
                    
                    timerSpan.textContent = timeStr;
                    // Color: red < 30min, amber < 3h, normal otherwise
                    if (totalSecs < 1800) {
                        timerSpan.style.color = '#ef4444';
                        timerSpan.style.background = 'rgba(239,68,68,0.10)';
                    } else if (hours < 3) {
                        timerSpan.style.color = '#d97706';
                        timerSpan.style.background = 'rgba(217,119,6,0.10)';
                    } else {
                        timerSpan.style.color = '#1e40af';
                        timerSpan.style.background = 'rgba(30,64,175,0.08)';
                    }
                }
            });
        }
        
        updateTimers();
        window.photographerCountdownInterval = setInterval(updateTimers, 1000);
    }

    document.body.addEventListener('htmx:afterSwap', function(e) {
        if (e.detail.target.id === 'staff-table-container') {
            deselectAllRows();
            setupRowSelection();
            startCountdownTimers();
        }
    });
});
