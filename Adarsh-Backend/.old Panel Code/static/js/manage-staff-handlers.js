// Manage Staff Page  Handlers: button clicks, form submit, delete/status modals, close/escape
// Split from manage-staff-events.js  loaded fourth (after api)

document.addEventListener('DOMContentLoaded', function() {
    var NS = window.ManageStaffPage;

    // ==================== LOCAL ELEMENTS ====================
    var staffDrawer = document.getElementById('staff-drawer');
    var staffForm = document.getElementById('staff-form');
    var addStaffBtn = document.getElementById('addStaffBtn');
    var editStaffBtn = document.getElementById('editStaffBtn');
    var viewStaffBtn = document.getElementById('viewStaffBtn');
    var deleteStaffBtn = document.getElementById('deleteStaffBtn');
    var activeStaffBtn = document.getElementById('activeStaffBtn');
    var closeStaffDrawer = document.getElementById('drawer-close-btn');
    var cancelStaffDrawer = document.getElementById('drawer-cancel-btn');

    // ==================== BUTTON HANDLERS ====================
    if (addStaffBtn && !addStaffBtn.dataset.drawerAttached) {
        addStaffBtn.addEventListener('click', function() { NS.openDrawer('add'); });
        addStaffBtn.dataset.drawerAttached = '1';
    }

    if (editStaffBtn) {
        editStaffBtn.addEventListener('click', async function() {
            if (!NS.selectedStaffId) return;
            var staffData = await NS.fetchStaffDetails(NS.selectedStaffId);
            if (staffData) NS.openDrawer('edit', staffData);
        });
    }

    if (viewStaffBtn) {
        viewStaffBtn.addEventListener('click', async function() {
            if (!NS.selectedStaffId) return;
            var staffData = await NS.fetchStaffDetails(NS.selectedStaffId);
            if (staffData) NS.openDrawer('view', staffData);
        });
    }

    window.openStaffAssignmentDrawerFromTable = async function(staffId) {
        var targetId = staffId || NS.selectedStaffId;
        if (!targetId) return;

        var row = document.querySelector('#staff-table-body tr[data-staff-id="' + String(targetId) + '"]');
        if (row && typeof NS.selectStaffRow === 'function') {
            NS.selectStaffRow(row);
            targetId = row.dataset.staffId;
        }

        var staffData = await NS.fetchStaffDetails(targetId);
        if (staffData) NS.openDrawer('view', staffData);
    };

    if (deleteStaffBtn) {
        deleteStaffBtn.addEventListener('click', function() {
            if (!NS.selectedStaffId || !NS.selectedRow) {
                return;
            }

            // Name is in the 1st column
            var staffName = NS.selectedRow.querySelector('td:nth-child(1)').textContent;
            openDeleteModal(staffName);
        });
    }

    if (activeStaffBtn) {
        activeStaffBtn.addEventListener('click', function() {
            if (!NS.selectedStaffId || !NS.selectedRow) return;

            // Name is in the 1st column
            var staffName = NS.selectedRow.querySelector('td:nth-child(1)').textContent;
            var currentStatus = NS.selectedRow.dataset.staffStatus;
            pendingStatusStaffId = NS.selectedStaffId;
            openStatusModal(staffName, currentStatus);
        });
    }

    // ==================== FORM SUBMIT ====================
    if (staffForm) {
        staffForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            // Prevent double submission
            var submitBtn = staffForm.querySelector('button[type="submit"]');
            if (submitBtn.disabled) return;
            submitBtn.disabled = true;
            var originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

            var formData = {
                name: document.getElementById('staff-name').value.trim(),
                email: document.getElementById('staff-email').value.trim(),
                phone: document.getElementById('staff-phone').value.trim(),
                address: document.getElementById('staff-address')?.value || '',
                is_active: document.getElementById('staff-status').value === 'true',
            };

            var isCreateMode = !(NS.currentMode === 'edit' && NS.selectedStaffId);

            if (!formData.name) {
                showToast('Name is required', 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
                return;
            }

            // Validate/create password strategy
            var pwOpt = document.getElementById('staff-password-option');
            var pwVal = document.getElementById('staff-password');
            if (isCreateMode && pwOpt) {
                if (pwOpt.value === 'custom') {
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

            // Add all permissions (convert hyphen-case to underscore for API)
            NS.permissionFields.forEach(function(field) {
                var el = document.getElementById(field);
                var apiField = field.replace(/-/g, '_');
                if (el) formData[apiField] = el.checked;
            });

            // Add assigned client IDs
            formData.assigned_clients = Array.from(NS.selectedClientIds);

            var result;

            try {
                if (NS.currentMode === 'edit' && NS.selectedStaffId) {
                    result = await NS.updateStaff(NS.selectedStaffId, formData);
                } else {
                    result = await NS.createStaff(formData);
                }

                if (result.success) {
                    showToast(result.message, 'success');
                    NS.closeDrawer();
                    // Refresh table via HTMX instead of full page reload
                    if (typeof htmx !== 'undefined' && document.getElementById('staff-table-container')) {
                        setTimeout(function() { htmx.trigger(document.body, 'refreshTable'); }, 300);
                    } else {
                        setTimeout(function() { location.reload(); }, 500);
                    }
                } else {
                    showToast(result.message || 'Operation failed', 'error');
                    // Re-enable button on error
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                }
            } catch (error) {
                console.error('Staff form submission error:', error);
                showToast(error.message || 'An error occurred. Please try again.', 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        });
    }

    // ==================== CLOSE / ESCAPE ====================
    if (closeStaffDrawer) {
        closeStaffDrawer.addEventListener('click', function() { NS.closeDrawer(); });
    }
    if (cancelStaffDrawer) {
        cancelStaffDrawer.addEventListener('click', function(e) {
            e.preventDefault();
            NS.closeDrawer();
        });
    }

    // Close drawer on overlay click  disabled to prevent accidental closure
    // if (staffDrawerOverlay) {
    //     staffDrawerOverlay.addEventListener('click', NS.closeDrawer);
    // }

    // Close drawer on Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && staffDrawer && staffDrawer.classList.contains('open')) {
            NS.closeDrawer();
        }
    });

    // Phase 1: Profile picture upload removed - using avatar placeholder

    // ==================== DELETE MODAL ====================
    var confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    var deleteStaffNameEl = document.getElementById('deleteStaffName');

    function openDeleteModal(staffName) {
        if (deleteStaffNameEl) {
            deleteStaffNameEl.textContent = staffName;
        }
        if (window.alpineOpenModal) window.alpineOpenModal('delete');
    }

    function closeDeleteModalFn() {
        if (window.alpineCloseModal) window.alpineCloseModal();
    }

    // Close handlers now managed by Alpine @click in template

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async function() {
            if (!NS.selectedStaffId) return;

            var result = await NS.deleteStaffApi(NS.selectedStaffId);
            if (result.success) {
                showToast(result.message, 'success');
                closeDeleteModalFn();
                NS.selectedRow.remove();
                NS.selectedStaffId = null;
                NS.selectedRow = null;
                NS.enableActionButtons(false);
            } else {
                showToast(result.message || 'Failed to delete operator', 'error');
            }
        });
    }

    // ==================== STATUS MODAL ====================
    var confirmStatusBtn = document.getElementById('confirmStatusBtn');
    var statusStaffNameEl = document.getElementById('statusItemName');
    var statusModalHeader = document.getElementById('statusModalHeader');
    var statusModalIcon = document.getElementById('statusModalIcon');
    var statusNote = document.getElementById('statusNote');

    var pendingStatusStaffId = null;
    var pendingStatusCurrentStatus = null;

    function openStatusModal(staffName, currentStatus) {
        if (statusStaffNameEl) {
            statusStaffNameEl.textContent = staffName;
        }
        pendingStatusCurrentStatus = currentStatus;

        // Update modal appearance based on action
        if (currentStatus === 'active') {
            // Going to deactivate
            if (statusModalHeader) statusModalHeader.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
            if (statusModalIcon) statusModalIcon.innerHTML = '<i class="fa-solid fa-ban" style="font-size: 48px; color: #ef4444;"></i>';
            if (statusNote) statusNote.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> This will prevent the operator from logging in.';
            if (confirmStatusBtn) {
                confirmStatusBtn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
                confirmStatusBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Deactivate';
            }
        } else {
            // Going to activate
            if (statusModalHeader) statusModalHeader.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
            if (statusModalIcon) statusModalIcon.innerHTML = '<i class="fa-solid fa-circle-check" style="font-size: 48px; color: #22c55e;"></i>';
            if (statusNote) statusNote.innerHTML = '<i class="fa-solid fa-circle-info"></i> This will allow the operator to log in.';
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
        pendingStatusCurrentStatus = null;
    }

    // Close handlers now managed by Alpine @click in template

    if (confirmStatusBtn) {
        confirmStatusBtn.addEventListener('click', async function() {
            if (!pendingStatusStaffId) return;

            var result = await NS.toggleStaffStatus(pendingStatusStaffId);
            if (result.success) {
                showToast(result.message, 'success');
                closeStatusModalFn();

                if (NS.selectedRow) {
                    NS.selectedRow.dataset.staffStatus = result.status;
                    var statusBadge = NS.selectedRow.querySelector('.status-badge');
                    if (statusBadge) {
                        statusBadge.textContent = result.status_display;
                        statusBadge.className = 'status-badge ' + (result.status === 'active' ? 'active' : 'inactive');
                    }
                    NS.updateActiveButtonState();
                }
            } else {
                showToast(result.message || 'Failed to update status', 'error');
            }
        });
    }
});
