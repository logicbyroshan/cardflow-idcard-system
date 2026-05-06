// Manage Staff Page  State: namespace, shared state, dropdowns, row selection
// Split from manage-staff-ui.js  loaded first

window.ManageStaffPage = {};

document.addEventListener('DOMContentLoaded', function() {
    var NS = window.ManageStaffPage;

    // ==================== SHARED STATE ====================
    NS.selectedStaffId = null;
    NS.selectedRow = null;
    NS.currentMode = 'add';
    NS.allClients = [];
    NS.selectedClientIds = new Set();

    // ==================== PERMISSION FIELDS ====================
    NS.permissionFields = [
        // Client
        'perm-idcard-client-list',
        'perm-manage-client-staff',
        // Settings
        'perm-idcard-setting-list', 'perm-idcard-setting-add', 'perm-idcard-setting-edit',
        'perm-idcard-setting-delete', 'perm-idcard-setting-status',
        // Group/Table Management
        'perm-idcard-group-create', 'perm-idcard-group-delete',
        // Status Lists
        'perm-idcard-pending-list', 'perm-idcard-verified-list', 'perm-idcard-pool-list',
        'perm-idcard-approved-list', 'perm-idcard-download-list',
        // Reprint Lists
        'perm-reprint-request-list', 'perm-confirmed-list',
        // Actions
        'perm-idcard-add', 'perm-idcard-edit', 'perm-idcard-delete', 'perm-idcard-info',
        'perm-idcard-approve', 'perm-idcard-verify',
        'perm-idcard-reprint-list',
        'perm-idcard-bulk-upload', 'perm-idcard-bulk-download',
        'perm-idcard-bulk-reupload', 'perm-idcard-upgrade-all',
        'perm-idcard-created-at', 'perm-idcard-updated-at',
        'perm-idcard-delete-from-pool', 'perm-delete-all-idcard',
        'perm-idcard-retrieve',
        'perm-mobile-app',
        'perm-idcard-download-image-rename-mode', 'perm-idcard-download-image-generate-mode',
        // Manage Panel
        'perm-manage-panel-backup', 'perm-manage-panel-email',
        // Manage Website sections
        'perm-manage-website-clients', 'perm-manage-website-portfolio'
    ];

    // ==================== FORM STATUS DROPDOWN ====================
    var statusDropdown = document.getElementById('staffStatusDropdown');
    var statusHiddenInput = document.getElementById('staff-status');

    NS.setStatusDropdown = function(val) {
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
    };

    if (statusDropdown && statusHiddenInput) {
        var toggleBtn = statusDropdown.querySelector('.dropdown-toggle');
        var options = statusDropdown.querySelectorAll('.dropdown-option');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                document.querySelectorAll('.custom-dropdown.open').forEach(function(d) { if (d !== statusDropdown) d.classList.remove('open'); });
                statusDropdown.classList.toggle('open');
            });
        }
        options.forEach(function(option) {
            option.addEventListener('click', function() {
                NS.setStatusDropdown(this.dataset.value);
                statusDropdown.classList.remove('open');
            });
        });
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.custom-dropdown')) statusDropdown.classList.remove('open');
        });
    }

    // ==================== TOAST FUNCTIONS ====================
    // Using shared showToast from utils.js

    // ==================== PASSWORD OPTION DROPDOWN ====================
    var passwordOptionDropdown = document.getElementById('staffPasswordOptionDropdown');
    var passwordOptionInput = document.getElementById('staff-password-option');
    var customPasswordGroup = document.getElementById('staffCustomPasswordGroup');
    var passwordInput = document.getElementById('staff-password');

    NS.setPasswordOption = function(val) {
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
    };

    if (passwordOptionDropdown && passwordOptionInput) {
        var pwToggleBtn = passwordOptionDropdown.querySelector('.dropdown-toggle');
        var pwOptions = passwordOptionDropdown.querySelectorAll('.dropdown-option');
        if (pwToggleBtn) {
            pwToggleBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                document.querySelectorAll('.custom-dropdown.open').forEach(function(d) { if (d !== passwordOptionDropdown) d.classList.remove('open'); });
                passwordOptionDropdown.classList.toggle('open');
            });
        }
        pwOptions.forEach(function(option) {
            option.addEventListener('click', function() {
                NS.setPasswordOption(this.dataset.value);
                passwordOptionDropdown.classList.remove('open');
            });
        });
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.custom-dropdown')) passwordOptionDropdown.classList.remove('open');
        });
    }

    // ==================== ROW SELECTION ====================
    var editStaffBtn = document.getElementById('editStaffBtn');
    var viewStaffBtn = document.getElementById('viewStaffBtn');
    var deleteStaffBtn = document.getElementById('deleteStaffBtn');
    var activeStaffBtn = document.getElementById('activeStaffBtn');
    var tableContainer = document.getElementById('staff-table-container');

    // Phase 1: Profile image upload removed - using avatar placeholder

    NS.selectStaffRow = function(row) {
        if (!row || !row.dataset.staffId) return;

        // Remove selection from all rows (re-query to handle swapped content)
        var currentTbody = document.getElementById('staff-table-body');
        if (currentTbody) {
            currentTbody.querySelectorAll('tr').forEach(function(r) {
                r.classList.remove('selected');
            });
        }

        // Select current row
        row.classList.add('selected');

        NS.selectedRow = row;
        NS.selectedStaffId = row.dataset.staffId;
        NS.enableActionButtons(true);
        NS.updateActiveButtonState();

        // Bridge to Alpine reactive state
        if (typeof window.alpineUpdateSelection === 'function') {
            window.alpineUpdateSelection([NS.selectedStaffId]);
        }
    };

    NS.clearStaffSelection = function() {
        var currentTbody = document.getElementById('staff-table-body');
        if (currentTbody) {
            currentTbody.querySelectorAll('tr').forEach(function(r) {
                r.classList.remove('selected');
            });
        }
        NS.selectedRow = null;
        NS.selectedStaffId = null;
        NS.enableActionButtons(false);

        // Bridge to Alpine reactive state
        if (typeof window.alpineClearSelection === 'function') {
            window.alpineClearSelection();
        }
    };

    // Set up row click handlers  delegate from stable container to survive HTMX swaps
    if (tableContainer) {
        // Row click - select row (delegated from stable parent)
        tableContainer.addEventListener('click', function(e) {
            var viewMoreBtn = e.target.closest('.staff-assignment-view-more');
            if (viewMoreBtn) {
                e.preventDefault();
                e.stopPropagation();

                var viewRow = viewMoreBtn.closest('tr');
                if (viewRow && viewRow.dataset.staffId && !viewRow.classList.contains('no-data-row')) {
                    NS.selectStaffRow(viewRow);
                }

                if (typeof window.openStaffAssignmentDrawerFromTable === 'function') {
                    window.openStaffAssignmentDrawerFromTable(viewMoreBtn.dataset.staffId);
                } else if (viewStaffBtn && !viewStaffBtn.disabled) {
                    viewStaffBtn.click();
                }
                return;
            }

            var row = e.target.closest('tr');
            if (row && row.dataset.staffId && !row.classList.contains('no-data-row')) {
                NS.selectStaffRow(row);
            }
        });
    }

    NS.enableActionButtons = function(enable) {
        if (editStaffBtn) editStaffBtn.disabled = !enable;
        if (activeStaffBtn) activeStaffBtn.disabled = !enable;
        if (deleteStaffBtn) deleteStaffBtn.disabled = !enable;
        if (viewStaffBtn) viewStaffBtn.disabled = !enable;
    };

    NS.updateActiveButtonState = function() {
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
    };
});
