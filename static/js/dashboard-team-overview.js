// Dashboard Team Overview panel and drawer workflow
window.DashboardPage = window.DashboardPage || {};

document.addEventListener('DOMContentLoaded', function () {
    const panelSection = document.querySelector('[data-dashboard-panel="team-overview"]');
    if (!panelSection || typeof ApiClient === 'undefined') return;

    const panelBase = window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';
    function panelUrl(path) {
        if (!path) return path;
        if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) return path;
        const normalized = path.charAt(0) === '/' ? path : '/' + path;
        return panelBase + normalized;
    }

    const esc = typeof escapeHtml === 'function'
        ? escapeHtml
        : function (value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        };

    const scopeButtons = Array.from(document.querySelectorAll('[data-dashboard-team-scope]'));
    const quickActionButtons = Array.from(document.querySelectorAll('[data-dashboard-quick-action]'));
    const dashboardTabButtons = Array.from(document.querySelectorAll('[data-dashboard-tab]'));
    const dashboardTabCountTeamOverview = document.getElementById('dashboardTabCountTeamOverview');

    const panelTitle = document.getElementById('teamOverviewPanelTitle');
    const tableBody = document.getElementById('teamOverviewBody');
    const searchInputs = Array.from(document.querySelectorAll('[data-team-overview-search]'));
    const primarySearchInput = document.getElementById('teamOverviewSearch');

    const editBtn = document.getElementById('teamOverviewActionEdit');
    const viewStaffBtn = document.getElementById('teamOverviewActionViewStaff');
    const toggleBtn = document.getElementById('teamOverviewActionToggle');
    const deleteBtn = document.getElementById('teamOverviewActionDelete');

    const drawer = document.getElementById('teamOverviewDrawer');
    const drawerOverlay = document.getElementById('teamOverviewDrawerOverlay');
    const drawerTitleText = document.getElementById('teamOverviewDrawerTitleText');
    const drawerIcon = document.getElementById('teamOverviewDrawerIcon');
    const drawerCloseBtn = document.getElementById('teamOverviewDrawerClose');

    const form = document.getElementById('teamOverviewForm');
    const formModeInput = document.getElementById('teamOverviewFormMode');
    const formScopeInput = document.getElementById('teamOverviewFormScope');
    const formEntityIdInput = document.getElementById('teamOverviewFormEntityId');

    const formName = document.getElementById('teamOverviewFormName');
    const formEmail = document.getElementById('teamOverviewFormEmail');
    const formMobile = document.getElementById('teamOverviewFormMobile');
    const formAddress = document.getElementById('teamOverviewFormAddress');
    const formPassword = document.getElementById('teamOverviewFormPassword');

    const formStatusHidden = document.getElementById('teamOverviewFormStatus');
    const formPasswordOptionHidden = document.getElementById('teamOverviewFormPasswordOption');

    const statusDropdown = document.getElementById('teamOverviewStatusDropdown');
    const passwordOptionDropdown = document.getElementById('teamOverviewPasswordOptionDropdown');
    const passwordOptionField = document.getElementById('teamOverviewPasswordOptionField');

    const addressField = document.getElementById('teamOverviewAddressField');
    const passwordField = document.getElementById('teamOverviewPasswordField');
    const permissionsGrid = document.getElementById('teamOverviewPermissionsGrid');
    const infoSectionTitle = document.getElementById('teamOverviewInfoSectionTitle');
    const avatarLabel = document.getElementById('teamOverviewAvatarLabel');

    const assignmentField = document.getElementById('teamOverviewAssignmentField');
    const assignmentLabel = document.getElementById('teamOverviewAssignmentLabel');
    const assignmentHint = document.getElementById('teamOverviewAssignmentHint');
    const assignmentContainer = document.getElementById('teamOverviewClientMultiselect');
    const assignmentToggle = document.getElementById('teamOverviewClientMultiselectToggle');
    const assignmentDropdown = document.getElementById('teamOverviewClientMultiselectDropdown');
    const assignmentText = document.getElementById('teamOverviewClientMultiselectText');
    const assignmentSearchInput = document.getElementById('teamOverviewClientSearchInput');
    const assignmentList = document.getElementById('teamOverviewClientMultiselectList');
    const assignmentEmpty = document.getElementById('teamOverviewClientMultiselectEmpty');

    const passwordToggleBtn = document.getElementById('teamOverviewPasswordToggle');
    const passwordToggleIcon = document.getElementById('teamOverviewPasswordToggleIcon');

    const formCancelBtn = document.getElementById('teamOverviewFormCancel');
    const formSaveBtn = document.getElementById('teamOverviewFormSave');
    const formSaveText = document.getElementById('teamOverviewFormSaveText');

    const staffPanel = document.getElementById('teamOverviewStaffPanel');
    const staffBody = document.getElementById('teamOverviewStaffBody');

    const state = {
        scope: 'clients',
        items: [],
        selectedId: null,
        searchQuery: '',
        capabilities: {
            can_manage_clients: false,
            can_manage_staff: false,
            can_manage_client_staff: false,
        },
        assignmentCache: {
            operator: null,
            assistent: null,
        },
        assignment: {
            scope: 'clients',
            items: [],
            selectedIds: new Set(),
            singleSelect: false,
            placeholder: 'Select clients...',
        },
    };

    const PERMISSION_LAYOUTS = {
        clients: [
            {
                title: 'Group Settings',
                icon: 'fa-cog',
                fields: [
                    ['perm_idcard_setting_add', 'Create Template'],
                    ['perm_idcard_setting_edit', 'Edit Template'],
                    ['perm_idcard_setting_list', 'View Template'],
                    ['perm_idcard_setting_delete', 'Delete Template'],
                    ['perm_idcard_setting_status', 'Status Template'],
                ],
            },
            {
                title: 'ID Card Action List',
                icon: 'fa-list',
                fields: [
                    ['perm_idcard_pending_list', 'Pending List'],
                    ['perm_idcard_verified_list', 'Verified List'],
                    ['perm_idcard_pool_list', 'Pool List'],
                    ['perm_idcard_approved_list', 'Approved List'],
                    ['perm_idcard_download_list', 'Download List'],
                ],
            },
            {
                title: 'Print & Reprint Lists',
                icon: 'fa-print',
                fields: [
                    ['perm_reprint_request_list', 'Request List (Reprint)'],
                    ['perm_confirmed_list', 'Confirmed List (Reprint)'],
                ],
            },
            {
                title: 'Card Actions',
                icon: 'fa-id-card',
                fields: [
                    ['perm_idcard_add', 'Add Card'],
                    ['perm_idcard_edit', 'Edit Card'],
                    ['perm_idcard_info', 'View Card Info'],
                    ['perm_idcard_delete', 'Delete Card'],
                    ['perm_idcard_approve', 'Approve Card'],
                    ['perm_idcard_verify', 'Verify Card'],
                    ['perm_idcard_reprint_list', 'Reprint Cards'],
                    ['perm_idcard_updated_at', 'Last Updated & Updated By'],
                    ['perm_idcard_retrieve', 'Retrieve from Pool'],
                ],
            },
            {
                title: 'Bulk Actions',
                icon: 'fa-layer-group',
                fields: [
                    ['perm_idcard_bulk_upload', 'Bulk Upload (XLSX / ZIP)'],
                    ['perm_idcard_bulk_download', 'Bulk Download (PDF)'],
                ],
            },
            {
                title: 'Other Actions',
                icon: 'fa-ellipsis-vertical',
                fields: [
                    ['perm_mobile_app', 'Mobile App Access'],
                    ['perm_idcard_client_list', 'Manage Client'],
                    ['perm_set_temp_password', 'Set Temp Password (Staff)'],
                ],
            },
        ],
        operator: [
            {
                title: 'Group Settings',
                icon: 'fa-cog',
                fields: [
                    ['perm_idcard_setting_add', 'Create Template'],
                    ['perm_idcard_setting_edit', 'Edit Template'],
                    ['perm_idcard_setting_list', 'View Template'],
                    ['perm_idcard_setting_delete', 'Delete Template'],
                    ['perm_idcard_setting_status', 'Status Template'],
                ],
            },
            {
                title: 'ID Card Action List',
                icon: 'fa-list',
                fields: [
                    ['perm_idcard_pending_list', 'Pending List'],
                    ['perm_idcard_verified_list', 'Verified List'],
                    ['perm_idcard_pool_list', 'Pool List'],
                    ['perm_idcard_approved_list', 'Approved List'],
                    ['perm_idcard_download_list', 'Download List'],
                ],
            },
            {
                title: 'Print & Reprint Lists',
                icon: 'fa-print',
                fields: [
                    ['perm_reprint_request_list', 'Request List (Reprint)'],
                    ['perm_confirmed_list', 'Confirmed List (Reprint)'],
                    ['perm_print_list', 'Generate List (Print Cards)'],
                    ['perm_finalized_list', 'Finalized List (Print Cards)'],
                ],
            },
            {
                title: 'Card Actions',
                icon: 'fa-id-card',
                fields: [
                    ['perm_idcard_add', 'Add Card'],
                    ['perm_idcard_edit', 'Edit Card'],
                    ['perm_idcard_info', 'View Card Info'],
                    ['perm_idcard_delete', 'Delete Card'],
                    ['perm_idcard_approve', 'Approve Card'],
                    ['perm_idcard_verify', 'Verify Card'],
                    ['perm_idcard_reprint_list', 'Reprint Cards'],
                    ['perm_idcard_updated_at', 'Last Updated & Updated By'],
                    ['perm_idcard_delete_from_pool', 'Permanent Delete from Pool'],
                    ['perm_idcard_retrieve', 'Retrieve from Download'],
                ],
            },
            {
                title: 'Bulk Actions',
                icon: 'fa-layer-group',
                fields: [
                    ['perm_idcard_bulk_upload', 'Bulk Upload (XLSX + ZIP Images)'],
                    ['perm_idcard_bulk_download', 'Bulk Download (All Formats)'],
                    ['perm_idcard_bulk_reupload', 'Bulk Reupload Images (ZIP)'],
                    ['perm_idcard_upgrade_all', 'Upgrade All Classes'],
                ],
            },
            {
                title: 'App & Access',
                icon: 'fa-mobile-screen',
                fields: [
                    ['perm_mobile_app', 'Mobile App Login'],
                    ['perm_idcard_client_list', 'Manage Client'],
                    ['perm_manage_client_staff', 'Manage Assistent'],
                ],
            },
            {
                title: 'Manage Panel',
                icon: 'fa-sliders',
                fields: [
                    ['perm_manage_panel_backup', 'Backup'],
                    ['perm_manage_panel_email', 'Email Management'],
                ],
            },
            {
                title: 'Manage Website',
                icon: 'fa-globe',
                fields: [
                    ['perm_manage_website_clients', 'Clients'],
                    ['perm_manage_website_portfolio', 'Portfolio'],
                ],
            },
        ],
        assistent: [
            {
                title: 'ID Card List Tabs',
                icon: 'fa-list',
                fields: [
                    ['perm_idcard_pending_list', 'Pending List'],
                    ['perm_idcard_verified_list', 'Verified List'],
                    ['perm_idcard_pool_list', 'Pool List'],
                    ['perm_idcard_approved_list', 'Approved List'],
                    ['perm_idcard_download_list', 'Download List'],
                    ['perm_reprint_request_list', 'Request List (Reprint)'],
                    ['perm_confirmed_list', 'Confirmed List (Reprint)'],
                ],
            },
            {
                title: 'Export & Download',
                icon: 'fa-file-arrow-down',
                fields: [
                    ['perm_idcard_bulk_download', 'Download / Export'],
                ],
            },
            {
                title: 'Card Actions',
                icon: 'fa-id-card',
                fields: [
                    ['perm_idcard_add', 'Add Card'],
                    ['perm_idcard_edit', 'Edit Card'],
                    ['perm_idcard_delete', 'Delete Card'],
                    ['perm_idcard_info', 'View Card Info'],
                    ['perm_idcard_verify', 'Verify Card'],
                    ['perm_idcard_reprint_list', 'Reprint Cards'],
                    ['perm_idcard_updated_at', 'Last Updated & Updated By'],
                ],
            },
            {
                title: 'App & Access',
                icon: 'fa-mobile-screen',
                fields: [
                    ['perm_mobile_app', 'Mobile App Login'],
                ],
            },
        ],
    };

    const PERMISSIONS_BY_SCOPE = Object.fromEntries(
        Object.keys(PERMISSION_LAYOUTS).map(function (scope) {
            const allFields = [];
            (PERMISSION_LAYOUTS[scope] || []).forEach(function (group) {
                (group.fields || []).forEach(function (entry) {
                    if (entry && entry[0] && allFields.indexOf(entry[0]) === -1) {
                        allFields.push(entry[0]);
                    }
                });
            });
            return [scope, allFields];
        })
    );

    function showToastSafe(message, type) {
        if (typeof showToast === 'function') {
            showToast(message, type || 'info');
            return;
        }
        if (message) window.alert(message);
    }

    function normalizeClientIdList(rawValues) {
        if (!Array.isArray(rawValues)) return [];
        return rawValues
            .map(function (value) { return Number(value); })
            .filter(function (value) { return Number.isFinite(value) && value > 0; });
    }

    function normalizeScope(scope) {
        const token = String(scope || '').toLowerCase();
        if (token === 'operator') return 'operator';
        if (token === 'assistent') return 'assistent';
        return 'clients';
    }

    function scopeLabel(scope) {
        if (scope === 'operator') return 'Operator';
        if (scope === 'assistent') return 'Assistent';
        return 'Clients';
    }

    function scopeSingularLabel(scope) {
        if (scope === 'operator') return 'Operator';
        if (scope === 'assistent') return 'Assistent';
        return 'Client';
    }

    function scopeKind(scope) {
        if (scope === 'operator') return 'operator';
        if (scope === 'assistent') return 'assistant';
        return 'client';
    }

    function getSelectedItem() {
        if (!state.selectedId) return null;
        return state.items.find(function (item) { return Number(item.id) === Number(state.selectedId); }) || null;
    }

    function canManageKind(kind) {
        if (kind === 'client') return !!state.capabilities.can_manage_clients;
        if (kind === 'operator') return !!state.capabilities.can_manage_staff;
        if (kind === 'assistant') return !!state.capabilities.can_manage_client_staff;
        return false;
    }

    function renderStatusBadge(status) {
        const normalized = String(status || '').toLowerCase();
        if (!normalized) return '';
        let cssClass = 'is-inactive';
        if (normalized === 'active') cssClass = 'is-active';
        if (normalized === 'suspended') cssClass = 'is-suspended';
        const label = normalized.charAt(0).toUpperCase() + normalized.slice(1);
        return '<span class="dashboard-client-status-badge ' + cssClass + '">' + esc(label) + '</span>';
    }

    function updateScopeButtons(scope) {
        const teamOverviewPanel = document.querySelector('[data-dashboard-panel="team-overview"]');
        const isPanelActive = !!(teamOverviewPanel && teamOverviewPanel.classList.contains('is-active'));
        scopeButtons.forEach(function (button) {
            const isActive = isPanelActive && normalizeScope(button.getAttribute('data-dashboard-team-scope')) === scope;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    async function showCenteredConfirm(options) {
        if (typeof showConfirm === 'function') {
            try {
                return !!(await showConfirm(options || {}));
            } catch (_error) {
                // Fall through to native confirm fallback.
            }
        }
        const fallbackText = (options && (options.text || options.title)) || 'Are you sure?';
        return window.confirm(fallbackText);
    }

    function applyToolbarState() {
        const selected = getSelectedItem();
        const selectedKind = selected ? String(selected.kind || scopeKind(state.scope)).toLowerCase() : '';
        const canManageSelected = !!selected && canManageKind(selectedKind);

        if (editBtn) editBtn.disabled = !canManageSelected;
        if (toggleBtn) toggleBtn.disabled = !canManageSelected;
        if (deleteBtn) deleteBtn.disabled = !canManageSelected;

        if (viewStaffBtn) {
            const canViewStaff = !!selected && selectedKind === 'client' && canManageKind('client');
            viewStaffBtn.disabled = !canViewStaff;
        }
    }

    function setSearchQuery(nextQuery, sourceInput) {
        const normalizedQuery = String(nextQuery || '').trim();
        state.searchQuery = normalizedQuery;

        searchInputs.forEach(function (input) {
            if (!input || input === sourceInput) return;
            if (String(input.value || '') !== normalizedQuery) {
                input.value = normalizedQuery;
            }
        });

        renderRows();
    }

    function setQuickActionActive(actionToken) {
        const activeToken = String(actionToken || '');
        quickActionButtons.forEach(function (button) {
            const token = String(button.getAttribute('data-dashboard-quick-action') || '');
            button.classList.toggle('is-active', !!activeToken && token === activeToken);
        });
    }

    if (window.DashboardPage && typeof window.DashboardPage === 'object') {
        window.DashboardPage.setQuickActionActive = setQuickActionActive;
    }

    function setPanelLoading() {
        if (!tableBody) return;
        const rows = [];
        for (let i = 0; i < 5; i++) {
            rows.push(
                '<tr class="dashboard-table-skeleton-row">'
                + '<td><span class="dash-skeleton dash-skeleton-line" style="width:72%;"></span></td>'
                + '<td><span class="dash-skeleton dash-skeleton-pill"></span></td>'
                + '<td><span class="dash-skeleton dash-skeleton-pill"></span></td>'
                + '<td><span class="dash-skeleton dash-skeleton-pill"></span></td>'
                + '<td><span class="dash-skeleton dash-skeleton-pill"></span></td>'
                + '</tr>'
            );
        }
        tableBody.innerHTML = rows.join('');
    }

    function filteredItems() {
        const query = String(state.searchQuery || '').toLowerCase();
        if (!query) return state.items.slice();
        return state.items.filter(function (item) {
            const name = String(item.name || '').toLowerCase();
            const email = String(item.email || '').toLowerCase();
            const mobile = String(item.mobile || '').toLowerCase();
            const clientName = String(item.client_name || '').toLowerCase();
            return name.indexOf(query) !== -1
                || email.indexOf(query) !== -1
                || mobile.indexOf(query) !== -1
                || clientName.indexOf(query) !== -1;
        });
    }

    function renderRows() {
        if (!tableBody) return;

        const rows = filteredItems();
        if (!rows.length) {
            tableBody.innerHTML = '<tr><td colspan="5" class="muted-row">No matching records found.</td></tr>';
            applyToolbarState();
            return;
        }

        tableBody.innerHTML = rows.map(function (item) {
            const id = Number(item.id);
            const isSelected = Number(state.selectedId) === id;
            const statusBadge = renderStatusBadge(item.status);
            const nameLabel = ''
                + '<div class="team-overview-name-cell">'
                + statusBadge
                + '<span class="client-name-text team-overview-name-text">' + esc(item.name || '-') + '</span>'
                + '</div>';
            return ''
                + '<tr class="team-overview-row' + (isSelected ? ' is-selected' : '') + '" data-team-row-id="' + id + '">'
                + '<td>' + nameLabel + '</td>'
                + '<td>' + esc(item.email || '-') + '</td>'
                + '<td class="team-overview-mobile-cell">' + esc(item.mobile || '-') + '</td>'
                + '<td>' + esc(item.created_at || '-') + '</td>'
                + '<td>' + esc(item.updated_at || '-') + '</td>'
                + '</tr>';
        }).join('');

        applyToolbarState();
    }

    function setSelectedId(nextId) {
        state.selectedId = nextId ? Number(nextId) : null;
        renderRows();
    }

    async function loadScope(scope, options) {
        const normalizedScope = normalizeScope(scope);
        const keepSelection = !!(options && options.keepSelection);
        const requestedSelectedId = options && options.preferredId ? Number(options.preferredId) : null;
        const previousSelection = keepSelection ? Number(state.selectedId) : null;

        state.scope = normalizedScope;
        if (panelTitle) panelTitle.innerHTML = '<i class="fa-solid fa-users"></i> Team Overview - ' + scopeLabel(normalizedScope);
        updateScopeButtons(normalizedScope);
        setPanelLoading();

        try {
            const data = await ApiClient.get(panelUrl('/api/dashboard/team-overview/?scope=' + encodeURIComponent(normalizedScope) + '&limit=500'));
            if (!data || !data.success) {
                throw new Error((data && data.error) || 'Failed to load data');
            }

            state.items = Array.isArray(data.items) ? data.items : [];
            state.capabilities = data.capabilities || state.capabilities;
            if (dashboardTabCountTeamOverview) {
                dashboardTabCountTeamOverview.textContent = String(state.items.length || 0);
            }

            if (requestedSelectedId) {
                state.selectedId = requestedSelectedId;
            } else if (previousSelection && state.items.some(function (item) { return Number(item.id) === previousSelection; })) {
                state.selectedId = previousSelection;
            } else {
                state.selectedId = null;
            }

            renderRows();
        } catch (error) {
            console.error('Team overview load failed:', error);
            state.items = [];
            state.selectedId = null;
            if (tableBody) {
                tableBody.innerHTML = '<tr><td colspan="5" class="muted-row">Unable to load team overview.</td></tr>';
            }
            applyToolbarState();
        }
    }

    function setDrawerTitle(iconClass, text) {
        if (drawerIcon) drawerIcon.className = 'fa-solid ' + iconClass;
        if (drawerTitleText) drawerTitleText.textContent = text;
    }

    function openDrawer() {
        if (!drawer || !drawerOverlay) return;
        drawerOverlay.hidden = false;
        drawerOverlay.classList.add('active');
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        document.body.classList.add('drawer-open');
    }

    function closeAssignmentDropdown() {
        if (!assignmentDropdown || !assignmentToggle) return;
        assignmentDropdown.style.display = 'none';
        assignmentToggle.classList.remove('open');
    }

    function closeCustomDropdown(dropdown) {
        if (dropdown) dropdown.classList.remove('open');
    }

    function closeDrawer() {
        if (!drawer || !drawerOverlay) return;
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        drawerOverlay.classList.remove('active');
        closeAssignmentDropdown();
        closeCustomDropdown(statusDropdown);
        closeCustomDropdown(passwordOptionDropdown);
        window.setTimeout(function () {
            drawerOverlay.hidden = true;
        }, 180);
        document.body.classList.remove('drawer-open');
    }

    function setDropdownSelection(dropdown, value) {
        if (!dropdown) return;
        const options = dropdown.querySelectorAll('.dropdown-option');
        const toggleLabel = dropdown.querySelector('.dropdown-toggle span');
        options.forEach(function (option) {
            option.classList.remove('selected');
        });
        const selected = dropdown.querySelector('.dropdown-option[data-value="' + String(value) + '"]');
        if (selected) {
            selected.classList.add('selected');
            if (toggleLabel) toggleLabel.textContent = selected.textContent;
        }
    }

    function closeOtherCustomDropdowns(currentDropdown) {
        [statusDropdown, passwordOptionDropdown].forEach(function (dropdown) {
            if (dropdown && dropdown !== currentDropdown) {
                dropdown.classList.remove('open');
            }
        });
    }

    function bindCustomDropdown(dropdown, onSelect) {
        if (!dropdown) return;
        const toggle = dropdown.querySelector('.dropdown-toggle');
        const options = dropdown.querySelectorAll('.dropdown-option');

        if (toggle) {
            toggle.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopPropagation();
                closeOtherCustomDropdowns(dropdown);
                dropdown.classList.toggle('open');
            });
        }

        options.forEach(function (option) {
            option.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopPropagation();
                const value = String(option.getAttribute('data-value') || '');
                setDropdownSelection(dropdown, value);
                dropdown.classList.remove('open');
                if (typeof onSelect === 'function') {
                    onSelect(value);
                }
            });
        });
    }

    function setStatusValue(value) {
        if (formStatusHidden) formStatusHidden.value = String(value);
        setDropdownSelection(statusDropdown, String(value));
    }

    function setPasswordOptionValue(value) {
        if (formPasswordOptionHidden) formPasswordOptionHidden.value = String(value);
        setDropdownSelection(passwordOptionDropdown, String(value));
        syncPasswordOptionVisibility();
    }

    function syncPasswordOptionVisibility() {
        if (!passwordField || !formPasswordOptionHidden || !formModeInput || !formPassword) return;
        const isAddMode = String(formModeInput.value || 'add') === 'add';
        const option = String(formPasswordOptionHidden.value || 'phone').toLowerCase();
        const showCustom = isAddMode && option === 'custom';
        passwordField.style.display = showCustom ? '' : 'none';
        formPassword.required = showCustom;
        if (!showCustom) formPassword.value = '';
    }

    function normalizeAssignmentItems(clients) {
        if (!Array.isArray(clients)) return [];
        return clients
            .map(function (client) {
                const id = Number(client && client.id);
                if (!Number.isFinite(id) || id <= 0) return null;
                const name = String(client.name || ('Client #' + id)).trim();
                const isActive = typeof client.is_active === 'boolean'
                    ? client.is_active
                    : String(client.status || '').toLowerCase() === 'active';
                return {
                    id: id,
                    name: name || ('Client #' + id),
                    status: isActive ? 'active' : 'inactive',
                };
            })
            .filter(function (entry) { return !!entry; });
    }

    async function fetchAssignmentItems(scope) {
        if (scope !== 'operator' && scope !== 'assistent') return [];
        const endpoint = scope === 'operator'
            ? '/api/clients/for-staff-assignment/'
            : '/api/client-staff/clients/';
        try {
            const data = await ApiClient.get(panelUrl(endpoint));
            if (!data || !data.success || !Array.isArray(data.clients)) return [];
            return normalizeAssignmentItems(data.clients);
        } catch (error) {
            console.error('Failed to fetch assignment clients:', error);
            return [];
        }
    }

    async function ensureAssignmentItems(scope) {
        if (scope !== 'operator' && scope !== 'assistent') return [];
        if (Array.isArray(state.assignmentCache[scope])) {
            return state.assignmentCache[scope];
        }
        const items = await fetchAssignmentItems(scope);
        state.assignmentCache[scope] = items;
        return items;
    }

    function updateAssignmentText() {
        if (!assignmentText) return;
        const selectedIds = Array.from(state.assignment.selectedIds);
        if (!selectedIds.length) {
            assignmentText.textContent = state.assignment.placeholder;
            assignmentText.classList.remove('has-selection');
            return;
        }

        const selectedNames = state.assignment.items
            .filter(function (item) { return state.assignment.selectedIds.has(item.id); })
            .map(function (item) { return item.name; });

        if (state.assignment.singleSelect || selectedNames.length <= 2) {
            assignmentText.textContent = selectedNames.join(', ');
        } else {
            assignmentText.textContent = selectedNames.length + ' clients selected';
        }
        assignmentText.classList.add('has-selection');
    }

    function renderAssignmentList(filterText) {
        if (!assignmentList) return;

        const query = String(filterText || '').trim().toLowerCase();
        const rows = state.assignment.items
            .filter(function (item) {
                if (!query) return true;
                return item.name.toLowerCase().indexOf(query) !== -1;
            })
            .sort(function (a, b) {
                const aSelected = state.assignment.selectedIds.has(a.id) ? 0 : 1;
                const bSelected = state.assignment.selectedIds.has(b.id) ? 0 : 1;
                if (aSelected !== bSelected) return aSelected - bSelected;
                if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });

        assignmentList.innerHTML = '';
        if (!rows.length) {
            if (assignmentEmpty) assignmentEmpty.style.display = '';
            return;
        }
        if (assignmentEmpty) assignmentEmpty.style.display = 'none';

        rows.forEach(function (item) {
            const selected = state.assignment.selectedIds.has(item.id);
            const isInactive = item.status === 'inactive';
            const node = document.createElement('div');
            node.className = 'client-multiselect-item'
                + (selected ? ' selected' : '')
                + (isInactive ? ' client-inactive' : '');

            const statusBadge = isInactive
                ? '<span class="client-status-badge inactive">Inactive</span>'
                : '';

            node.innerHTML = ''
                + '<input type="checkbox" ' + (selected ? 'checked' : '') + ' data-client-id="' + item.id + '">'
                + '<span class="client-name">' + esc(item.name) + statusBadge + '</span>';

            node.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopPropagation();

                if (state.assignment.singleSelect) {
                    state.assignment.selectedIds = new Set([item.id]);
                    updateAssignmentText();
                    renderAssignmentList(assignmentSearchInput ? assignmentSearchInput.value : '');
                    closeAssignmentDropdown();
                    return;
                }

                if (state.assignment.selectedIds.has(item.id)) {
                    state.assignment.selectedIds.delete(item.id);
                } else {
                    state.assignment.selectedIds.add(item.id);
                }
                updateAssignmentText();
                renderAssignmentList(assignmentSearchInput ? assignmentSearchInput.value : '');
            });

            assignmentList.appendChild(node);
        });
    }

    function openAssignmentDropdown() {
        if (!assignmentDropdown || !assignmentToggle) return;
        assignmentDropdown.style.display = '';
        assignmentToggle.classList.add('open');
        if (assignmentSearchInput) {
            assignmentSearchInput.value = '';
            assignmentSearchInput.focus();
        }
        renderAssignmentList('');
    }

    function setAssignmentSelected(rawIds) {
        const normalizedIds = normalizeClientIdList(rawIds || []);
        let selectedIds = new Set(normalizedIds);
        if (state.assignment.singleSelect && selectedIds.size > 1) {
            selectedIds = new Set([normalizedIds[0]]);
        }
        state.assignment.selectedIds = selectedIds;
    }

    function getAssignmentSelectedIds() {
        return Array.from(state.assignment.selectedIds)
            .map(function (id) { return Number(id); })
            .filter(function (id) { return Number.isFinite(id) && id > 0; });
    }

    async function configureAssignmentField(scope, preselectedIds) {
        if (!assignmentField) return;

        if (scope === 'clients') {
            assignmentField.style.display = 'none';
            state.assignment.scope = scope;
            state.assignment.items = [];
            state.assignment.selectedIds = new Set();
            closeAssignmentDropdown();
            return;
        }

        assignmentField.style.display = '';
        state.assignment.scope = scope;
        state.assignment.singleSelect = scope === 'assistent';
        state.assignment.placeholder = state.assignment.singleSelect ? 'Select client...' : 'Select clients...';

        if (assignmentLabel) {
            assignmentLabel.textContent = state.assignment.singleSelect ? 'Assign Client *' : 'Assign Clients';
        }
        if (assignmentHint) {
            assignmentHint.textContent = state.assignment.singleSelect
                ? 'Select exactly one client for this staff member.'
                : 'Select one or more clients this staff can manage.';
        }

        state.assignment.items = await ensureAssignmentItems(scope);
        setAssignmentSelected(preselectedIds || []);
        updateAssignmentText();
        renderAssignmentList(assignmentSearchInput ? assignmentSearchInput.value : '');
        closeAssignmentDropdown();
    }

    function getPermissionGroups(scope) {
        return PERMISSION_LAYOUTS[scope] || [];
    }

    function renderPermissionGrid(scope, entity) {
        if (!permissionsGrid) return;

        const groups = getPermissionGroups(scope);
        const categories = groups.map(function (group) {
            const rows = (group.fields || []).map(function (entry) {
                const field = entry[0];
                const label = entry[1];
                const checked = !!(entity && entity[field] === true);
                const inputId = 'teamOverviewPerm_' + field;
                return ''
                    + '<div class="permission-row">'
                    + '<label class="toggle-switch">'
                    + '<input type="checkbox" id="' + esc(inputId) + '" data-permission-field="' + esc(field) + '"' + (checked ? ' checked' : '') + '>'
                    + '<span class="toggle-slider"></span>'
                    + '</label>'
                    + '<span class="permission-label">' + esc(label) + '</span>'
                    + '</div>';
            }).join('');

            return ''
                + '<div class="permission-category">'
                + '<div class="category-title"><i class="fa-solid ' + esc(group.icon || 'fa-cog') + '"></i> ' + esc(group.title || 'Permissions') + '</div>'
                + '<div class="permissions-grid">' + rows + '</div>'
                + '</div>';
        }).join('');

        permissionsGrid.innerHTML = ''
            + '<div class="permission-header"><i class="fa-solid fa-shield-halved"></i> User Permission</div>'
            + categories;
    }

    function collectPermissionPayload(scope) {
        const payload = {};
        const fields = PERMISSIONS_BY_SCOPE[scope] || [];
        fields.forEach(function (field) {
            const checkbox = document.getElementById('teamOverviewPerm_' + field);
            if (checkbox) payload[field] = checkbox.checked;
        });
        return payload;
    }

    function getFallbackEntityForEdit(scope, entityId) {
        const selected = getSelectedItem();
        if (!selected || Number(selected.id) !== Number(entityId)) return null;
        return {
            id: selected.id,
            name: selected.name || '',
            email: selected.email || '',
            phone: selected.mobile || '',
            mobile: selected.mobile || '',
            status: selected.status || 'inactive',
            is_active: String(selected.status || '').toLowerCase() === 'active',
            client_id: selected.client_id || null,
            assigned_client_ids: [],
            address: '',
        };
    }

    function resetDrawerPanels() {
        if (staffPanel) staffPanel.hidden = true;
        if (form) form.hidden = false;
    }

    async function setFormMode(scope, mode, preselectedAssignmentIds) {
        const normalizedScope = normalizeScope(scope);
        if (formModeInput) formModeInput.value = mode;
        if (formScopeInput) formScopeInput.value = normalizedScope;

        if (addressField) addressField.style.display = normalizedScope === 'clients' ? '' : 'none';
        if (passwordOptionField) passwordOptionField.style.display = mode === 'add' ? '' : 'none';

        if (normalizedScope === 'clients') {
            if (infoSectionTitle) infoSectionTitle.innerHTML = '<i class="fa-solid fa-info-circle"></i> Client Information';
            if (avatarLabel) avatarLabel.textContent = 'Client avatar';
        } else {
            if (infoSectionTitle) infoSectionTitle.innerHTML = '<i class="fa-solid fa-info-circle"></i> Staff Information';
            if (avatarLabel) avatarLabel.textContent = 'Staff avatar';
        }

        setStatusValue('false');
        setPasswordOptionValue('phone');
        if (formPassword) formPassword.value = '';
        syncPasswordOptionVisibility();

        renderPermissionGrid(normalizedScope, null);
        await configureAssignmentField(normalizedScope, preselectedAssignmentIds || []);

        resetDrawerPanels();
    }

    function entityDetailsUrl(scope, entityId) {
        if (scope === 'operator') return '/api/staff/' + entityId + '/';
        if (scope === 'assistent') return '/api/client-staff/' + entityId + '/';
        return '/api/client/' + entityId + '/';
    }

    function entityActionUrl(scope, action, entityId) {
        if (scope === 'operator') {
            if (action === 'create') return '/api/staff/create/';
            if (action === 'update') return '/api/staff/' + entityId + '/update/';
            if (action === 'toggle') return '/api/staff/' + entityId + '/toggle-status/';
            if (action === 'delete') return '/api/staff/' + entityId + '/delete/';
        }
        if (scope === 'assistent') {
            if (action === 'create') return '/api/client-staff/create/';
            if (action === 'update') return '/api/client-staff/' + entityId + '/update/';
            if (action === 'toggle') return '/api/client-staff/' + entityId + '/toggle-status/';
            if (action === 'delete') return '/api/client-staff/' + entityId + '/delete/';
        }
        if (action === 'create') return '/api/client/create/';
        if (action === 'update') return '/api/client/' + entityId + '/update/';
        if (action === 'toggle') return '/api/client/' + entityId + '/toggle-status/';
        if (action === 'delete') return '/api/client/' + entityId + '/delete/';
        return '';
    }

    function entityFromResponse(scope, data) {
        if (!data || typeof data !== 'object') return null;
        if (scope === 'clients') return data.client || null;
        return data.staff || null;
    }

    function entityIsActive(scope, entity) {
        if (!entity) return false;
        if (typeof entity.is_active === 'boolean') return entity.is_active;
        return String(entity.status || '').toLowerCase() === 'active';
    }

    async function openFormForAdd(scope) {
        if (!form || !formName || !formEmail || !formMobile || !formEntityIdInput || !formAddress || !formPassword) return;
        const normalizedScope = normalizeScope(scope);

        await setFormMode(normalizedScope, 'add', []);
        setDrawerTitle('fa-user-plus', 'Add New ' + scopeSingularLabel(normalizedScope));

        if (formSaveText) formSaveText.textContent = 'Add ' + scopeSingularLabel(normalizedScope);

        formEntityIdInput.value = '';
        formName.value = '';
        formEmail.value = '';
        formMobile.value = '';
        formAddress.value = '';
        formPassword.value = '';

        renderPermissionGrid(normalizedScope, null);
        openDrawer();
    }

    async function openFormForEdit(scope, entityId) {
        if (!form || !formName || !formEmail || !formMobile || !formEntityIdInput || !formAddress || !formPassword) return;
        const normalizedScope = normalizeScope(scope);

        try {
            let entity = null;
            try {
                const data = await ApiClient.get(panelUrl(entityDetailsUrl(normalizedScope, entityId)));
                if (data && data.success) {
                    entity = entityFromResponse(normalizedScope, data);
                }
            } catch (loadError) {
                console.warn('Detail endpoint failed, using row fallback:', loadError);
            }

            if (!entity) entity = getFallbackEntityForEdit(normalizedScope, entityId);
            if (!entity) throw new Error('Missing entity details');

            const assignmentIds = normalizedScope === 'operator'
                ? (entity.assigned_client_ids || entity.assigned_clients || [])
                : (normalizedScope === 'assistent' ? [entity.client_id || 0] : []);

            await setFormMode(normalizedScope, 'edit', assignmentIds);
            setDrawerTitle('fa-pen-to-square', 'Edit ' + scopeSingularLabel(normalizedScope));
            if (formSaveText) formSaveText.textContent = 'Save Changes';

            formEntityIdInput.value = String(entity.id || entityId || '');
            formName.value = entity.name || '';
            formEmail.value = entity.email || '';
            formMobile.value = entity.phone || entity.mobile || '';
            formAddress.value = entity.address || '';
            formPassword.value = '';

            setStatusValue(entityIsActive(normalizedScope, entity) ? 'true' : 'false');
            renderPermissionGrid(normalizedScope, entity);

            openDrawer();
        } catch (error) {
            console.error('Failed to load entity details:', error);
            showToastSafe('Unable to open edit drawer right now.', 'error');
        }
    }

    async function openClientStaffView(clientId, clientName) {
        if (!staffPanel || !staffBody || !form) return;

        form.hidden = true;
        staffPanel.hidden = false;
        setDrawerTitle('fa-users-gear', 'Staff - ' + (clientName || 'Client'));
        staffBody.innerHTML = '<tr><td colspan="4" class="muted-row">Loading staff...</td></tr>';
        openDrawer();

        try {
            const data = await ApiClient.get(panelUrl('/api/client/' + clientId + '/staff/'));
            if (!data || !data.success) {
                throw new Error((data && data.error) || 'Failed to load staff');
            }

            const staffRows = Array.isArray(data.staff) ? data.staff : [];
            if (!staffRows.length) {
                staffBody.innerHTML = '<tr><td colspan="4" class="muted-row">No staff assigned to this client.</td></tr>';
                return;
            }

            staffBody.innerHTML = staffRows.map(function (staff) {
                const status = staff.is_active ? 'active' : 'inactive';
                return ''
                    + '<tr>'
                    + '<td>' + esc(staff.name || '-') + '</td>'
                    + '<td>' + esc(staff.email || '-') + '</td>'
                    + '<td>' + esc(staff.phone || '-') + '</td>'
                    + '<td>' + renderStatusBadge(status) + '</td>'
                    + '</tr>';
            }).join('');
        } catch (error) {
            console.error('Failed loading client staff list:', error);
            staffBody.innerHTML = '<tr><td colspan="4" class="muted-row">Unable to load staff list.</td></tr>';
        }
    }

    async function submitForm(event) {
        event.preventDefault();
        if (!form || !formSaveBtn) return;

        const mode = formModeInput ? String(formModeInput.value || 'add') : 'add';
        const scope = normalizeScope(formScopeInput ? formScopeInput.value : state.scope);
        const entityId = formEntityIdInput ? Number(formEntityIdInput.value || 0) : 0;

        const payload = {
            name: formName ? String(formName.value || '').trim() : '',
            email: formEmail ? String(formEmail.value || '').trim() : '',
            phone: formMobile ? String(formMobile.value || '').trim() : '',
        };

        if (!payload.name) {
            showToastSafe('Name is required.', 'error');
            return;
        }

        payload.is_active = String(formStatusHidden ? formStatusHidden.value : 'false') === 'true';

        if (scope === 'clients') {
            payload.address = formAddress ? String(formAddress.value || '').trim() : '';
        }

        Object.assign(payload, collectPermissionPayload(scope));

        const password = formPassword ? String(formPassword.value || '').trim() : '';
        if (mode === 'add') {
            const passwordOption = formPasswordOptionHidden
                ? String(formPasswordOptionHidden.value || 'phone').toLowerCase()
                : 'phone';

            if (passwordOption === 'custom') {
                if (!password) {
                    showToastSafe('Custom password is required when phone password is not used.', 'error');
                    return;
                }
                payload.password = password;
            } else if (!payload.phone) {
                showToastSafe('Phone is required when using phone number as password.', 'error');
                return;
            }
        }

        if (scope === 'assistent') {
            const selectedClientIds = getAssignmentSelectedIds();
            if (!selectedClientIds.length) {
                showToastSafe('Please select a client.', 'error');
                return;
            }
            payload.client_id = selectedClientIds[0];
        } else if (scope === 'operator') {
            payload.assigned_clients = getAssignmentSelectedIds();
        }

        const action = mode === 'edit' ? 'update' : 'create';
        const endpoint = entityActionUrl(scope, action, entityId || '');
        if (!endpoint) {
            showToastSafe('Unable to submit this action.', 'error');
            return;
        }

        const defaultButtonText = mode === 'edit' ? 'Save Changes' : ('Add ' + scopeSingularLabel(scope));
        if (formSaveText && !formSaveText.textContent) formSaveText.textContent = defaultButtonText;

        const originalText = formSaveText ? formSaveText.textContent : defaultButtonText;
        formSaveBtn.disabled = true;
        if (formSaveText) formSaveText.textContent = mode === 'edit' ? 'Updating...' : 'Creating...';

        try {
            const response = await ApiClient.post(panelUrl(endpoint), payload);
            if (!response || !response.success) {
                throw new Error((response && response.error) || (response && response.message) || 'Save failed');
            }

            closeDrawer();
            showToastSafe(response.message || 'Saved successfully.', 'success');

            const newEntity = entityFromResponse(scope, response);
            const preferredId = newEntity && newEntity.id ? Number(newEntity.id) : null;
            await loadScope(scope, { keepSelection: true, preferredId: preferredId });
        } catch (error) {
            console.error('Save failed:', error);
            showToastSafe(error.message || 'Unable to save changes.', 'error');
        } finally {
            formSaveBtn.disabled = false;
            if (formSaveText) formSaveText.textContent = originalText || defaultButtonText;
        }
    }

    async function toggleSelectedStatus() {
        const selected = getSelectedItem();
        if (!selected) return;

        const scope = selected.kind === 'assistant' ? 'assistent' : (selected.kind === 'operator' ? 'operator' : 'clients');
        const endpoint = entityActionUrl(scope, 'toggle', selected.id);
        if (!endpoint) return;

        const isCurrentlyActive = String(selected.status || '').toLowerCase() === 'active';
        const targetLabel = isCurrentlyActive ? 'inactive' : 'active';
        const selectedName = String(selected.name || scopeSingularLabel(scope));
        const confirmed = await showCenteredConfirm({
            title: (isCurrentlyActive ? 'Set Inactive?' : 'Set Active?'),
            text: 'Change ' + selectedName + ' status to ' + targetLabel + '?',
            icon: isCurrentlyActive ? 'fa-solid fa-toggle-off' : 'fa-solid fa-toggle-on',
            confirmLabel: isCurrentlyActive ? 'Set Inactive' : 'Set Active',
            cancelLabel: 'Cancel',
            btnClass: isCurrentlyActive ? 'btn-danger' : 'btn-primary',
            hideWarning: true,
        });
        if (!confirmed) return;

        try {
            const response = await ApiClient.post(panelUrl(endpoint));
            if (!response || !response.success) {
                throw new Error((response && response.error) || (response && response.message) || 'Toggle failed');
            }
            showToastSafe(response.message || 'Status updated.', 'success');
            await loadScope(state.scope, { keepSelection: true, preferredId: selected.id });
        } catch (error) {
            console.error('Status toggle failed:', error);
            showToastSafe(error.message || 'Unable to update status.', 'error');
        }
    }

    async function deleteSelectedEntity() {
        const selected = getSelectedItem();
        if (!selected) return;

        const scope = selected.kind === 'assistant' ? 'assistent' : (selected.kind === 'operator' ? 'operator' : 'clients');
        const endpoint = entityActionUrl(scope, 'delete', selected.id);
        if (!endpoint) return;

        const name = String(selected.name || 'this record');
        const entityLabel = scopeSingularLabel(scope).toLowerCase();
        const confirmed = await showCenteredConfirm({
            title: 'Delete ' + scopeSingularLabel(scope) + '?',
            text: 'Delete ' + name + '? This action cannot be undone.',
            icon: 'fa-solid fa-trash',
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            btnClass: 'btn-danger',
            warnings: [
                'This will permanently remove the selected ' + entityLabel + '.',
                'This action cannot be undone.'
            ],
        });
        if (!confirmed) return;

        try {
            const response = await ApiClient.post(panelUrl(endpoint));
            if (!response || !response.success) {
                throw new Error((response && response.error) || (response && response.message) || 'Delete failed');
            }
            showToastSafe(response.message || 'Deleted successfully.', 'success');
            await loadScope(state.scope, { keepSelection: false });
        } catch (error) {
            console.error('Delete failed:', error);
            showToastSafe(error.message || 'Unable to delete record.', 'error');
        }
    }

    if (tableBody) {
        tableBody.addEventListener('click', function (event) {
            const row = event.target.closest('tr[data-team-row-id]');
            if (!row) return;
            const rowId = Number(row.getAttribute('data-team-row-id'));
            if (!Number.isFinite(rowId)) return;
            setSelectedId(rowId);
        });
    }

    searchInputs.forEach(function (input) {
        input.addEventListener('input', function () {
            setSearchQuery(input.value, input);
        });
    });

    if (searchInputs.length) {
        const initialSearch = primarySearchInput
            ? primarySearchInput.value
            : (searchInputs[0] ? searchInputs[0].value : '');
        setSearchQuery(initialSearch, null);
    }

    scopeButtons.forEach(function (button) {
        button.addEventListener('click', async function (event) {
            event.preventDefault();
            const scope = normalizeScope(button.getAttribute('data-dashboard-team-scope'));
            setQuickActionActive('');

            if (window.DashboardPage && typeof window.DashboardPage.activateDashboardPanel === 'function') {
                window.DashboardPage.activateDashboardPanel('team-overview');
            }

            await loadScope(scope, { keepSelection: false });
        });
    });

    dashboardTabButtons.forEach(function (button) {
        button.addEventListener('click', function () {
            window.setTimeout(function () {
                updateScopeButtons(state.scope);
                const panel = document.querySelector('[data-dashboard-panel="team-overview"]');
                const isPanelActive = !!(panel && panel.classList.contains('is-active'));
                if (!isPanelActive) {
                    setQuickActionActive('');
                }
            }, 0);
        });
    });

    quickActionButtons.forEach(function (button) {
        button.addEventListener('click', async function (event) {
            const action = String(button.getAttribute('data-dashboard-quick-action') || '');
            const actionToScope = {
                'add-client': 'clients',
                'add-operator': 'operator',
                'add-assistent': 'assistent',
            };
            const targetScope = actionToScope[action];
            if (!targetScope) return;

            event.preventDefault();
            setQuickActionActive(action);

            if (window.DashboardPage && typeof window.DashboardPage.activateDashboardPanel === 'function') {
                window.DashboardPage.activateDashboardPanel('team-overview');
            }

            await loadScope(targetScope, { keepSelection: false });
            await openFormForAdd(targetScope);
        });
    });

    if (editBtn) {
        editBtn.addEventListener('click', async function () {
            const selected = getSelectedItem();
            if (!selected) return;
            const scope = selected.kind === 'assistant' ? 'assistent' : (selected.kind === 'operator' ? 'operator' : 'clients');
            await openFormForEdit(scope, selected.id);
        });
    }

    if (viewStaffBtn) {
        viewStaffBtn.addEventListener('click', async function () {
            const selected = getSelectedItem();
            if (!selected || String(selected.kind || '') !== 'client') return;
            await openClientStaffView(selected.id, selected.name || 'Client');
        });
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', function () {
            toggleSelectedStatus();
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', function () {
            deleteSelectedEntity();
        });
    }

    if (form) {
        form.addEventListener('submit', submitForm);
    }

    if (assignmentToggle) {
        assignmentToggle.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            const isOpen = assignmentDropdown && assignmentDropdown.style.display !== 'none';
            if (isOpen) {
                closeAssignmentDropdown();
            } else {
                openAssignmentDropdown();
            }
        });
    }

    if (assignmentSearchInput) {
        assignmentSearchInput.addEventListener('input', function () {
            renderAssignmentList(assignmentSearchInput.value);
        });
        assignmentSearchInput.addEventListener('click', function (event) {
            event.stopPropagation();
        });
    }

    if (assignmentList) {
        assignmentList.addEventListener('click', function (event) {
            event.stopPropagation();
        });
    }

    bindCustomDropdown(statusDropdown, function (value) {
        setStatusValue(value);
    });

    bindCustomDropdown(passwordOptionDropdown, function (value) {
        setPasswordOptionValue(value);
    });

    if (passwordToggleBtn && formPassword) {
        passwordToggleBtn.addEventListener('click', function () {
            const currentType = formPassword.getAttribute('type') || 'password';
            const nextType = currentType === 'password' ? 'text' : 'password';
            formPassword.setAttribute('type', nextType);
            if (passwordToggleIcon) {
                passwordToggleIcon.className = nextType === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
            }
        });
    }

    if (formCancelBtn) {
        formCancelBtn.addEventListener('click', function () {
            closeDrawer();
        });
    }

    if (drawerCloseBtn) {
        drawerCloseBtn.addEventListener('click', function () {
            closeDrawer();
        });
    }

    if (drawerOverlay) {
        drawerOverlay.addEventListener('click', function () {
            closeDrawer();
        });
    }

    document.addEventListener('click', function (event) {
        if (!event.target.closest('.custom-dropdown')) {
            closeCustomDropdown(statusDropdown);
            closeCustomDropdown(passwordOptionDropdown);
        }

        if (assignmentDropdown && assignmentDropdown.style.display !== 'none') {
            if (!assignmentContainer || !assignmentContainer.contains(event.target)) {
                closeAssignmentDropdown();
            }
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && drawer && drawer.classList.contains('open')) {
            closeDrawer();
        }
    });

    loadScope('clients', { keepSelection: false });
});
