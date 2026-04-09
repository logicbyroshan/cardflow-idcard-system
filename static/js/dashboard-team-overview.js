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

    const panelTitle = document.getElementById('teamOverviewPanelTitle');
    const tableBody = document.getElementById('teamOverviewBody');
    const searchInput = document.getElementById('teamOverviewSearch');

    const addBtn = document.getElementById('teamOverviewActionAdd');
    const editBtn = document.getElementById('teamOverviewActionEdit');
    const viewStaffBtn = document.getElementById('teamOverviewActionViewStaff');
    const toggleBtn = document.getElementById('teamOverviewActionToggle');
    const deleteBtn = document.getElementById('teamOverviewActionDelete');

    const drawer = document.getElementById('teamOverviewDrawer');
    const drawerOverlay = document.getElementById('teamOverviewDrawerOverlay');
    const drawerTitle = document.getElementById('teamOverviewDrawerTitle');
    const drawerCloseBtn = document.getElementById('teamOverviewDrawerClose');

    const form = document.getElementById('teamOverviewForm');
    const formModeInput = document.getElementById('teamOverviewFormMode');
    const formScopeInput = document.getElementById('teamOverviewFormScope');
    const formEntityIdInput = document.getElementById('teamOverviewFormEntityId');

    const formName = document.getElementById('teamOverviewFormName');
    const formEmail = document.getElementById('teamOverviewFormEmail');
    const formMobile = document.getElementById('teamOverviewFormMobile');
    const formClient = document.getElementById('teamOverviewFormClient');
    const formAssignedClients = document.getElementById('teamOverviewFormAssignedClients');
    const formAddress = document.getElementById('teamOverviewFormAddress');
    const formStatus = document.getElementById('teamOverviewFormStatus');
    const formPasswordOption = document.getElementById('teamOverviewFormPasswordOption');
    const formPassword = document.getElementById('teamOverviewFormPassword');

    const clientField = document.getElementById('teamOverviewClientField');
    const operatorClientsField = document.getElementById('teamOverviewOperatorClientsField');
    const addressField = document.getElementById('teamOverviewAddressField');
    const passwordOptionField = document.getElementById('teamOverviewPasswordOptionField');
    const passwordField = document.getElementById('teamOverviewPasswordField');
    const permissionsGrid = document.getElementById('teamOverviewPermissionsGrid');

    const formCancelBtn = document.getElementById('teamOverviewFormCancel');
    const formSaveBtn = document.getElementById('teamOverviewFormSave');

    const staffPanel = document.getElementById('teamOverviewStaffPanel');
    const staffBody = document.getElementById('teamOverviewStaffBody');

    const state = {
        scope: 'clients',
        items: [],
        selectedId: null,
        capabilities: {
            can_manage_clients: false,
            can_manage_staff: false,
            can_manage_client_staff: false,
        },
    };

    const PERMISSIONS_BY_SCOPE = {
        clients: [
            'perm_idcard_client_list',
            'perm_idcard_setting_list',
            'perm_idcard_setting_add',
            'perm_idcard_setting_edit',
            'perm_idcard_setting_delete',
            'perm_idcard_setting_status',
            'perm_idcard_pending_list',
            'perm_idcard_verified_list',
            'perm_idcard_pool_list',
            'perm_idcard_approved_list',
            'perm_idcard_download_list',
            'perm_reprint_request_list',
            'perm_confirmed_list',
            'perm_idcard_add',
            'perm_idcard_edit',
            'perm_idcard_delete',
            'perm_idcard_info',
            'perm_idcard_approve',
            'perm_idcard_verify',
            'perm_idcard_reprint_list',
            'perm_idcard_updated_at',
            'perm_idcard_delete_from_pool',
            'perm_idcard_retrieve',
            'perm_idcard_bulk_upload',
            'perm_idcard_bulk_download',
            'perm_idcard_upgrade_all',
            'perm_mobile_app',
            'perm_set_temp_password',
        ],
        operator: [
            'perm_idcard_client_list',
            'perm_manage_client_staff',
            'perm_idcard_setting_list',
            'perm_idcard_setting_add',
            'perm_idcard_setting_edit',
            'perm_idcard_setting_delete',
            'perm_idcard_setting_status',
            'perm_idcard_group_create',
            'perm_idcard_group_delete',
            'perm_idcard_pending_list',
            'perm_idcard_verified_list',
            'perm_idcard_pool_list',
            'perm_idcard_approved_list',
            'perm_idcard_download_list',
            'perm_reprint_request_list',
            'perm_confirmed_list',
            'perm_print_list',
            'perm_finalized_list',
            'perm_idcard_add',
            'perm_idcard_edit',
            'perm_idcard_delete',
            'perm_idcard_info',
            'perm_idcard_approve',
            'perm_idcard_verify',
            'perm_idcard_reprint_list',
            'perm_idcard_bulk_upload',
            'perm_idcard_bulk_download',
            'perm_idcard_bulk_reupload',
            'perm_idcard_upgrade_all',
            'perm_idcard_created_at',
            'perm_idcard_updated_at',
            'perm_idcard_delete_from_pool',
            'perm_delete_all_idcard',
            'perm_idcard_retrieve',
            'perm_mobile_app',
            'perm_manage_panel_backup',
            'perm_manage_panel_email',
            'perm_manage_website_clients',
            'perm_manage_website_portfolio',
        ],
        assistent: [
            'perm_idcard_pending_list',
            'perm_idcard_verified_list',
            'perm_idcard_pool_list',
            'perm_idcard_approved_list',
            'perm_idcard_download_list',
            'perm_idcard_bulk_download',
            'perm_idcard_add',
            'perm_idcard_edit',
            'perm_idcard_delete',
            'perm_idcard_info',
            'perm_idcard_verify',
            'perm_idcard_created_at',
            'perm_idcard_updated_at',
            'perm_mobile_app',
        ],
    };

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
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0);
    }

    function permissionLabel(permissionKey) {
        return String(permissionKey || '')
            .replace(/^perm_/, '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (ch) => ch.toUpperCase());
    }

    function renderPermissionGrid(scope, entity) {
        if (!permissionsGrid) return;

        const fields = PERMISSIONS_BY_SCOPE[scope] || [];
        permissionsGrid.innerHTML = fields.map((field) => {
            const checked = !!(entity && entity[field] === true);
            const id = 'teamOverviewPerm_' + field;
            return ''
                + '<label class="team-overview-perm-item" for="' + esc(id) + '">'
                + '<input type="checkbox" id="' + esc(id) + '" data-permission-field="' + esc(field) + '"' + (checked ? ' checked' : '') + '>'
                + '<span>' + esc(permissionLabel(field)) + '</span>'
                + '</label>';
        }).join('');
    }

    function collectPermissionPayload(scope) {
        const payload = {};
        const fields = PERMISSIONS_BY_SCOPE[scope] || [];
        fields.forEach((field) => {
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

    function syncPasswordOptionVisibility() {
        if (!passwordField || !formPasswordOption || !formPassword) return;
        const option = String(formPasswordOption.value || 'phone').toLowerCase();
        const isCustom = option === 'custom';
        passwordField.hidden = !isCustom;
        if (!isCustom) formPassword.value = '';
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
        return state.items.find((item) => Number(item.id) === Number(state.selectedId)) || null;
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
        scopeButtons.forEach((button) => {
            const isActive = normalizeScope(button.getAttribute('data-dashboard-team-scope')) === scope;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    function applyToolbarState() {
        const selected = getSelectedItem();
        const selectedKind = selected ? String(selected.kind || scopeKind(state.scope)).toLowerCase() : '';
        const canManageSelected = !!selected && canManageKind(selectedKind);

        if (addBtn) {
            const addEnabled = canManageKind(scopeKind(state.scope));
            addBtn.disabled = !addEnabled;
        }
        if (editBtn) editBtn.disabled = !canManageSelected;
        if (toggleBtn) toggleBtn.disabled = !canManageSelected;
        if (deleteBtn) deleteBtn.disabled = !canManageSelected;

        if (viewStaffBtn) {
            const canViewStaff = !!selected && selectedKind === 'client' && canManageKind('client');
            viewStaffBtn.disabled = !canViewStaff;
        }
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
        const query = searchInput ? String(searchInput.value || '').trim().toLowerCase() : '';
        if (!query) return state.items.slice();
        return state.items.filter((item) => {
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

        tableBody.innerHTML = rows.map((item) => {
            const id = Number(item.id);
            const isSelected = Number(state.selectedId) === id;
            const statusBadge = renderStatusBadge(item.status);
            const nameLabel = statusBadge + '<span class="client-name-text">' + esc(item.name || '-') + '</span>';
            return ''
                + '<tr class="team-overview-row' + (isSelected ? ' is-selected' : '') + '" data-team-row-id="' + id + '">'
                + '<td>' + nameLabel + '</td>'
                + '<td>' + esc(item.email || '-') + '</td>'
                + '<td>' + esc(item.mobile || '-') + '</td>'
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

            if (requestedSelectedId) {
                state.selectedId = requestedSelectedId;
            } else if (previousSelection && state.items.some((item) => Number(item.id) === previousSelection)) {
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

    function openDrawer() {
        if (!drawer || !drawerOverlay) return;
        drawerOverlay.hidden = false;
        drawerOverlay.classList.add('active');
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        document.body.classList.add('drawer-open');
    }

    function closeDrawer() {
        if (!drawer || !drawerOverlay) return;
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        drawerOverlay.classList.remove('active');
        window.setTimeout(function () {
            drawerOverlay.hidden = true;
        }, 180);
        document.body.classList.remove('drawer-open');
    }

    function setFormMode(scope, mode) {
        const normalizedScope = normalizeScope(scope);
        if (formModeInput) formModeInput.value = mode;
        if (formScopeInput) formScopeInput.value = normalizedScope;

        if (clientField) clientField.hidden = normalizedScope !== 'assistent';
        if (operatorClientsField) operatorClientsField.hidden = normalizedScope !== 'operator';
        if (addressField) addressField.hidden = normalizedScope !== 'clients';
        if (passwordOptionField) passwordOptionField.hidden = mode !== 'add';
        if (passwordField) passwordField.hidden = mode !== 'add';

        if (formPasswordOption) {
            formPasswordOption.value = 'phone';
        }
        syncPasswordOptionVisibility();

        if (formStatus) {
            const statuses = ['active', 'inactive'];
            formStatus.innerHTML = statuses
                .map((status) => '<option value="' + status + '">' + status.charAt(0).toUpperCase() + status.slice(1) + '</option>')
                .join('');
        }

        renderPermissionGrid(normalizedScope, null);

        if (staffPanel) staffPanel.hidden = true;
        if (form) form.hidden = false;
    }

    async function populateAssistantClients(selectedClientId) {
        if (!formClient) return;

        formClient.innerHTML = '<option value="">Select Client</option>';
        try {
            const data = await ApiClient.get(panelUrl('/api/client-staff/clients/'));
            if (!data || !data.success || !Array.isArray(data.clients)) return;
            data.clients.forEach((client) => {
                const option = document.createElement('option');
                option.value = String(client.id);
                option.textContent = client.name || ('Client #' + client.id);
                if (selectedClientId && Number(client.id) === Number(selectedClientId)) {
                    option.selected = true;
                }
                formClient.appendChild(option);
            });
        } catch (error) {
            console.error('Failed to load assistant clients:', error);
        }
    }

    async function populateOperatorClients(selectedClientIds) {
        if (!formAssignedClients) return;

        const selectedSet = new Set(normalizeClientIdList(selectedClientIds || []));
        formAssignedClients.innerHTML = '';

        try {
            const data = await ApiClient.get(panelUrl('/api/clients/for-staff-assignment/'));
            if (!data || !data.success || !Array.isArray(data.clients)) return;

            data.clients.forEach((client) => {
                const option = document.createElement('option');
                option.value = String(client.id);
                option.textContent = client.name || ('Client #' + client.id);
                if (selectedSet.has(Number(client.id))) {
                    option.selected = true;
                }
                formAssignedClients.appendChild(option);
            });
        } catch (error) {
            console.error('Failed to load operator clients:', error);
        }
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

    async function openFormForAdd(scope) {
        if (!form || !formName || !formEmail || !formMobile || !formEntityIdInput || !formAddress || !formPassword || !formStatus) return;
        const normalizedScope = normalizeScope(scope);

        setFormMode(normalizedScope, 'add');
        if (drawerTitle) drawerTitle.innerHTML = '<i class="fa-solid fa-user-plus"></i> Add ' + scopeSingularLabel(normalizedScope);

        formEntityIdInput.value = '';
        formName.value = '';
        formEmail.value = '';
        formMobile.value = '';
        formAddress.value = '';
        formPassword.value = '';
        formStatus.value = 'inactive';

        if (formPasswordOption) formPasswordOption.value = 'phone';
        renderPermissionGrid(normalizedScope, null);
        syncPasswordOptionVisibility();

        if (normalizedScope === 'assistent') {
            await populateAssistantClients(null);
        } else if (normalizedScope === 'operator') {
            await populateOperatorClients([]);
        }

        openDrawer();
    }

    async function openFormForEdit(scope, entityId) {
        if (!form || !formName || !formEmail || !formMobile || !formEntityIdInput || !formAddress || !formPassword || !formStatus) return;
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

            setFormMode(normalizedScope, 'edit');
            if (drawerTitle) drawerTitle.innerHTML = '<i class="fa-solid fa-user-pen"></i> Edit ' + scopeSingularLabel(normalizedScope);

            formEntityIdInput.value = String(entity.id || entityId || '');
            formName.value = entity.name || '';
            formEmail.value = entity.email || '';
            formMobile.value = entity.phone || entity.mobile || '';
            formAddress.value = entity.address || '';
            formPassword.value = '';
            renderPermissionGrid(normalizedScope, entity);

            if (normalizedScope === 'clients') {
                formStatus.value = String(entity.status || 'active').toLowerCase();
            } else {
                formStatus.value = entity.is_active ? 'active' : 'inactive';
            }

            if (normalizedScope === 'assistent') {
                await populateAssistantClients(entity.client_id || null);
            } else if (normalizedScope === 'operator') {
                await populateOperatorClients(entity.assigned_client_ids || entity.assigned_clients || []);
            }

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
        if (drawerTitle) drawerTitle.innerHTML = '<i class="fa-solid fa-users-gear"></i> Staff - ' + esc(clientName || 'Client');
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

            staffBody.innerHTML = staffRows.map((staff) => {
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

        const mode = formModeInput ? formModeInput.value : 'add';
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

        const statusValue = formStatus ? String(formStatus.value || 'active').toLowerCase() : 'active';
        if (scope === 'clients') {
            payload.is_active = statusValue === 'active';
            payload.address = formAddress ? String(formAddress.value || '').trim() : '';
        } else {
            payload.is_active = statusValue === 'active';
        }

        Object.assign(payload, collectPermissionPayload(scope));

        const password = formPassword ? String(formPassword.value || '').trim() : '';
        if (mode === 'add') {
            const passwordOption = formPasswordOption ? String(formPasswordOption.value || 'phone').toLowerCase() : 'phone';
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
            const clientId = formClient ? Number(formClient.value || 0) : 0;
            if (!clientId) {
                showToastSafe('Please select a client.', 'error');
                return;
            }
            payload.client_id = clientId;
        } else if (scope === 'operator' && formAssignedClients) {
            payload.assigned_clients = Array.from(formAssignedClients.selectedOptions || [])
                .map((option) => Number(option.value || 0))
                .filter((value) => Number.isFinite(value) && value > 0);
        }

        const action = mode === 'edit' ? 'update' : 'create';
        const endpoint = entityActionUrl(scope, action, entityId || '');
        if (!endpoint) {
            showToastSafe('Unable to submit this action.', 'error');
            return;
        }

        const originalText = formSaveBtn.textContent;
        formSaveBtn.disabled = true;
        formSaveBtn.textContent = mode === 'edit' ? 'Updating...' : 'Creating...';

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
            formSaveBtn.textContent = originalText;
        }
    }

    async function toggleSelectedStatus() {
        const selected = getSelectedItem();
        if (!selected) return;

        const scope = selected.kind === 'assistant' ? 'assistent' : (selected.kind === 'operator' ? 'operator' : 'clients');
        const endpoint = entityActionUrl(scope, 'toggle', selected.id);
        if (!endpoint) return;

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
        const confirmed = window.confirm('Delete ' + name + '? This action cannot be undone.');
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

    if (searchInput) {
        searchInput.addEventListener('input', function () {
            renderRows();
        });
    }

    scopeButtons.forEach((button) => {
        button.addEventListener('click', async function (event) {
            event.preventDefault();
            const scope = normalizeScope(button.getAttribute('data-dashboard-team-scope'));

            if (window.DashboardPage && typeof window.DashboardPage.activateDashboardPanel === 'function') {
                window.DashboardPage.activateDashboardPanel('team-overview');
            }

            await loadScope(scope, { keepSelection: false });
        });
    });

    quickActionButtons.forEach((button) => {
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

            if (window.DashboardPage && typeof window.DashboardPage.activateDashboardPanel === 'function') {
                window.DashboardPage.activateDashboardPanel('team-overview');
            }

            await loadScope(targetScope, { keepSelection: false });
            await openFormForAdd(targetScope);
        });
    });

    if (addBtn) {
        addBtn.addEventListener('click', async function () {
            await openFormForAdd(state.scope);
        });
    }

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

    if (formPasswordOption) {
        formPasswordOption.addEventListener('change', function () {
            syncPasswordOptionVisibility();
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

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && drawer && drawer.classList.contains('open')) {
            closeDrawer();
        }
    });

    loadScope('clients', { keepSelection: false });
});
