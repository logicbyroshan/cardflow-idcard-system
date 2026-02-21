// Manage Client Staff Page — config wrapper for manage-staff-common.js
// Uses client API endpoints and Group Assignment instead of Client Assignment.

document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    // ==================== VANILLA JS DELETE MODAL (client-only) ====================
    var deleteModal       = document.getElementById('delete-modal');
    var closeDeleteModalB = document.getElementById('closeDeleteModal');
    var cancelDeleteBtn   = document.getElementById('cancelDeleteBtn');

    function closeDeleteModalFn() {
        if (deleteModal) { deleteModal.classList.remove('show'); document.body.style.overflow = ''; }
    }

    if (closeDeleteModalB) closeDeleteModalB.addEventListener('click', closeDeleteModalFn);
    if (cancelDeleteBtn)   cancelDeleteBtn.addEventListener('click', closeDeleteModalFn);
    if (deleteModal) {
        deleteModal.addEventListener('click', function (e) {
            if (e.target === deleteModal) closeDeleteModalFn();
        });
    }

    // ==================== INITIALIZE SHARED MODULE ====================
    var mgr = window.initStaffPage({

        tableDelegateId: 'staff-table-body',
        nameColumnIndex: 2,
        skipHiddenInputs: false,
        respectDisabledPerms: true,

        // Assignment: groups
        assignment: {
            prefix:          'group',
            apiUrl:          '/panel/client/api/groups/active/',
            responseKey:     'groups',
            payloadKey:      'assigned_groups',
            preselectedKey:  'assigned_group_ids',
            placeholder:     'Select groups...',
            pluralLabel:     'groups',
        },

        // Permissions (smaller set)
        permissionFields: [
            'perm-idcard-pending-list', 'perm-idcard-verified-list', 'perm-idcard-pool-list',
            'perm-idcard-approved-list', 'perm-idcard-download-list',
            'perm-idcard-add', 'perm-idcard-edit', 'perm-idcard-delete', 'perm-idcard-info',
            'perm-idcard-approve', 'perm-idcard-verify',
            'perm-idcard-created-at', 'perm-idcard-updated-at'
        ],
        defaultOnPerms: [
            'perm-idcard-pending-list', 'perm-idcard-verified-list',
            'perm-idcard-pool-list', 'perm-idcard-approved-list',
            'perm-idcard-download-list',
            'perm-idcard-add', 'perm-idcard-edit', 'perm-idcard-delete',
            'perm-idcard-info', 'perm-idcard-approve', 'perm-idcard-verify',
            'perm-idcard-created-at', 'perm-idcard-updated-at'
        ],

        // API endpoints (RESTful)
        api: {
            fetchUrl:          function (id) { return '/panel/client/api/staff/' + id + '/'; },
            fetchResponseKey:  'data',
            errorKey:          'error',
            createUrl:         '/panel/client/api/staff/',
            createMethod:      'post',
            updateEndpoint:    function (id) { return { url: '/panel/client/api/staff/' + id + '/', method: 'put' }; },
            deleteEndpoint:    function (id) { return { url: '/panel/client/api/staff/' + id + '/', method: 'delete' }; },
            toggleUrl:         function (id) { return '/panel/client/api/staff/' + id + '/toggle-status/'; },
        },

        // No status dropdown or modal hooks needed for client page
        onDrawerReset:      null,
        onSetStatus:        null,
        onEnableFormInputs: null,
        onStatusToggle:     null,   // Use default direct toggle

        // Delete modal (vanilla JS)
        openDeleteModal: function (name) {
            var el = document.getElementById('deleteStaffName');
            if (el) el.textContent = name;
            if (deleteModal) { deleteModal.classList.add('show'); document.body.style.overflow = 'hidden'; }
        },
        closeDeleteModal: closeDeleteModalFn,

        // Form success -> always full reload
        onFormSuccess: function () {
            setTimeout(function () { location.reload(); }, 500);
        },
    });
});
