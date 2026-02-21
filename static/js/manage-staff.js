// Manage Staff Page (Admin) — config wrapper for manage-staff-common.js

document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    // ==================== STATUS DROPDOWN (admin-only) ====================
    var statusDropdown    = document.getElementById('staffStatusDropdown');
    var statusHiddenInput = document.getElementById('staff-status');

    function setStatusDropdown(val) {
        if (!statusHiddenInput) return;
        statusHiddenInput.value = val;
        if (!statusDropdown) return;
        var toggle  = statusDropdown.querySelector('.dropdown-toggle span');
        var options = statusDropdown.querySelectorAll('.dropdown-option');
        options.forEach(function (o) { o.classList.remove('selected'); });
        var match = statusDropdown.querySelector('.dropdown-option[data-value="' + val + '"]');
        if (match) { match.classList.add('selected'); if (toggle) toggle.textContent = match.textContent; }
    }

    if (statusDropdown && statusHiddenInput) {
        var toggleBtn = statusDropdown.querySelector('.dropdown-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                document.querySelectorAll('.custom-dropdown.open').forEach(function (d) { if (d !== statusDropdown) d.classList.remove('open'); });
                statusDropdown.classList.toggle('open');
            });
        }
        statusDropdown.querySelectorAll('.dropdown-option').forEach(function (opt) {
            opt.addEventListener('click', function () {
                setStatusDropdown(this.dataset.value);
                statusDropdown.classList.remove('open');
            });
        });
        document.addEventListener('click', function (e) {
            if (!e.target.closest('.custom-dropdown')) statusDropdown.classList.remove('open');
        });
    }

    // ==================== STATUS CONFIRMATION MODAL (admin-only) ====================
    var confirmStatusBtn   = document.getElementById('confirmStatusBtn');
    var statusStaffNameEl  = document.getElementById('statusStaffName');
    var statusModalHeader  = document.getElementById('statusModalHeader');
    var statusModalIcon    = document.getElementById('statusModalIcon');
    var statusNote         = document.getElementById('statusNote');
    var pendingStatusStaffId      = null;
    var pendingStatusCurrentStatus = null;

    function openStatusModal(staffName, currentStatus) {
        if (statusStaffNameEl) statusStaffNameEl.textContent = staffName;
        pendingStatusCurrentStatus = currentStatus;

        if (currentStatus === 'active') {
            if (statusModalHeader) statusModalHeader.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
            if (statusModalIcon)   statusModalIcon.innerHTML = '<i class="fa-solid fa-ban" style="font-size: 48px; color: #ef4444;"></i>';
            if (statusNote)        statusNote.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> This will prevent the staff member from logging in.';
            if (confirmStatusBtn) { confirmStatusBtn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'; confirmStatusBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Deactivate'; }
        } else {
            if (statusModalHeader) statusModalHeader.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
            if (statusModalIcon)   statusModalIcon.innerHTML = '<i class="fa-solid fa-check-circle" style="font-size: 48px; color: #22c55e;"></i>';
            if (statusNote)        statusNote.innerHTML = '<i class="fa-solid fa-info-circle"></i> This will allow the staff member to log in.';
            if (confirmStatusBtn) { confirmStatusBtn.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'; confirmStatusBtn.innerHTML = '<i class="fa-solid fa-check"></i> Activate'; }
        }
        if (window.alpineOpenModal) window.alpineOpenModal('status');
    }

    function closeStatusModalFn() {
        if (window.alpineCloseModal) window.alpineCloseModal();
        pendingStatusStaffId = null;
        pendingStatusCurrentStatus = null;
    }

    // ==================== INITIALIZE SHARED MODULE ====================
    var mgr = window.initStaffPage({

        tableDelegateId: 'staff-table-container',
        nameColumnIndex: 1,
        skipHiddenInputs: true,
        respectDisabledPerms: false,

        // Assignment: clients
        assignment: {
            prefix:          'client',
            apiUrl:          '/panel/api/clients/active/',
            responseKey:     'clients',
            payloadKey:      'assigned_clients',
            preselectedKey:  'assigned_client_ids',
            placeholder:     'Select clients...',
            pluralLabel:     'clients',
        },

        // Permissions
        permissionFields: [
            'perm-idcard-client-list',
            'perm-idcard-setting-list', 'perm-idcard-setting-add', 'perm-idcard-setting-edit',
            'perm-idcard-setting-delete', 'perm-idcard-setting-status',
            'perm-idcard-group-create', 'perm-idcard-group-delete',
            'perm-idcard-pending-list', 'perm-idcard-verified-list', 'perm-idcard-pool-list',
            'perm-idcard-approved-list', 'perm-idcard-download-list', 'perm-idcard-reprint-list',
            'perm-idcard-add', 'perm-idcard-edit', 'perm-idcard-delete', 'perm-idcard-info',
            'perm-idcard-approve', 'perm-idcard-verify',
            'perm-idcard-bulk-upload', 'perm-idcard-bulk-download',
            'perm-idcard-bulk-reupload', 'perm-idcard-upgrade-all',
            'perm-idcard-created-at', 'perm-idcard-updated-at',
            'perm-idcard-delete-from-pool', 'perm-delete-all-idcard',
            'perm-reupload-idcard-image', 'perm-idcard-retrieve'
        ],
        defaultOnPerms: [
            'perm-idcard-client-list',
            'perm-idcard-pending-list', 'perm-idcard-verified-list',
            'perm-idcard-pool-list', 'perm-idcard-approved-list',
            'perm-idcard-download-list',
            'perm-idcard-group-create', 'perm-idcard-group-delete',
            'perm-idcard-add', 'perm-idcard-edit', 'perm-idcard-delete',
            'perm-idcard-info', 'perm-idcard-approve', 'perm-idcard-verify',
            'perm-idcard-bulk-upload', 'perm-idcard-bulk-download',
            'perm-reupload-idcard-image', 'perm-idcard-retrieve'
        ],

        // API endpoints (POST-based)
        api: {
            fetchUrl:          function (id) { return '/panel/api/staff/' + id + '/'; },
            fetchResponseKey:  'staff',
            errorKey:          'message',
            createUrl:         '/panel/api/staff/create/',
            createMethod:      'post',
            updateEndpoint:    function (id) { return { url: '/panel/api/staff/' + id + '/update/', method: 'post' }; },
            deleteEndpoint:    function (id) { return { url: '/panel/api/staff/' + id + '/delete/', method: 'post' }; },
            toggleUrl:         function (id) { return '/panel/api/staff/' + id + '/toggle-status/'; },
        },

        // Hooks
        onDrawerReset: function () { setStatusDropdown('true'); },
        onSetStatus:   function (v) { setStatusDropdown(v); },

        onEnableFormInputs: function (enable) {
            // Status dropdown disable/enable
            if (statusDropdown) {
                var tog = statusDropdown.querySelector('.dropdown-toggle');
                if (tog) {
                    if (!enable) {
                        tog.style.pointerEvents = 'none'; tog.style.opacity = '0.6';
                        tog.style.backgroundColor = '#f5f5f5'; tog.style.cursor = 'not-allowed';
                        statusDropdown.classList.remove('open');
                    } else {
                        tog.style.pointerEvents = ''; tog.style.opacity = '';
                        tog.style.backgroundColor = ''; tog.style.cursor = '';
                    }
                }
            }
        },

        // Status toggle -> open confirmation modal instead of direct toggle
        onStatusToggle: function (staffId, row) {
            var staffName = row.querySelector('td:nth-child(1)').textContent;
            var currentStatus = row.dataset.staffStatus;
            pendingStatusStaffId = staffId;
            openStatusModal(staffName, currentStatus);
        },

        // Delete modal (Alpine)
        openDeleteModal: function (name) {
            var el = document.getElementById('deleteStaffName');
            if (el) el.textContent = name;
            if (window.alpineOpenModal) window.alpineOpenModal('delete');
        },
        closeDeleteModal: function () {
            if (window.alpineCloseModal) window.alpineCloseModal();
        },

        // Form success -> HTMX refresh
        onFormSuccess: function () {
            if (typeof htmx !== 'undefined' && document.getElementById('staff-table-container')) {
                setTimeout(function () { htmx.trigger(document.body, 'refreshTable'); }, 300);
            } else {
                setTimeout(function () { location.reload(); }, 500);
            }
        },
    });

    // ==================== STATUS MODAL CONFIRM ====================
    if (confirmStatusBtn) {
        confirmStatusBtn.addEventListener('click', async function () {
            if (!pendingStatusStaffId) return;
            var result = await mgr.toggleStaffStatus(pendingStatusStaffId);
            if (result.success) {
                showToast(result.message, 'success');
                closeStatusModalFn();
                var row = mgr.getSelectedRow();
                if (row) {
                    row.dataset.staffStatus = result.status;
                    var badge = row.querySelector('.status-badge');
                    if (badge) { badge.textContent = result.status_display; badge.className = 'status-badge ' + (result.status === 'active' ? 'active' : 'inactive'); }
                    mgr.updateActiveButtonState();
                }
            } else {
                showToast(result.message || 'Failed to update status', 'error');
            }
        });
    }
});
