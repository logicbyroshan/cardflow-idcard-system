// Manage Staff Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    
    // ==================== ELEMENTS ====================
    const staffDrawer = document.getElementById('staff-drawer');
    const staffDrawerOverlay = document.getElementById('staff-drawer-overlay');
    const staffForm = document.getElementById('staff-form');
    const drawerTitle = document.getElementById('drawer-title-text');
    const drawerIcon = document.getElementById('drawer-icon');
    const submitBtn = document.getElementById('drawer-submit-btn');
    
    const addStaffBtn = document.getElementById('addStaffBtn');
    const editStaffBtn = document.getElementById('editStaffBtn');
    const viewStaffBtn = document.getElementById('viewStaffBtn');
    const deleteStaffBtn = document.getElementById('deleteStaffBtn');
    const activeStaffBtn = document.getElementById('activeStaffBtn');
    
    const closeStaffDrawer = document.getElementById('drawer-close-btn');
    const cancelStaffDrawer = document.getElementById('drawer-cancel-btn');
    
    const table = document.getElementById('staff-table');
    const tbody = document.getElementById('staff-table-body');
    
    // Phase 1: Profile image upload removed - using avatar placeholder
    
    let selectedStaffId = null;
    let selectedRow = null;
    let currentMode = 'add';

    // ==================== TOAST FUNCTIONS ====================
    // Using shared showToast from utils.js

    // ==================== ROW SELECTION ====================
    
    function selectStaffRow(row) {
        if (!row || !row.dataset.staffId) return;
        
        // Remove selection from all rows
        if (tbody) {
            tbody.querySelectorAll('tr').forEach(r => {
                r.classList.remove('selected');
            });
        }
        
        // Select current row
        row.classList.add('selected');
        
        selectedRow = row;
        selectedStaffId = row.dataset.staffId;
        enableActionButtons(true);
        updateActiveButtonState();
    }
    
    function clearStaffSelection() {
        if (tbody) {
            tbody.querySelectorAll('tr').forEach(r => {
                r.classList.remove('selected');
            });
        }
        selectedRow = null;
        selectedStaffId = null;
        enableActionButtons(false);
    }
    
    // Set up row click handlers
    if (tbody) {
        // Row click - select row
        tbody.addEventListener('click', function(e) {
            const row = e.target.closest('tr');
            if (row && row.dataset.staffId && !row.classList.contains('no-data-row')) {
                selectStaffRow(row);
            }
        });
    }

    function enableActionButtons(enable) {
        if (editStaffBtn) editStaffBtn.disabled = !enable;
        if (activeStaffBtn) activeStaffBtn.disabled = !enable;
        if (deleteStaffBtn) deleteStaffBtn.disabled = !enable;
        if (viewStaffBtn) viewStaffBtn.disabled = !enable;
    }

    function updateActiveButtonState() {
        if (!selectedRow || !activeStaffBtn) return;
        
        const status = selectedRow.dataset.staffStatus;
        const isActive = status === 'active';
        
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

    // ==================== PERMISSION FIELDS ====================
    const permissionFields = [
        // Client
        'perm-idcard-client-list',
        // Settings
        'perm-idcard-setting-list', 'perm-idcard-setting-add', 'perm-idcard-setting-edit',
        'perm-idcard-setting-delete', 'perm-idcard-setting-status',
        // Status Lists
        'perm-idcard-pending-list', 'perm-idcard-verified-list', 'perm-idcard-pool-list',
        'perm-idcard-approved-list', 'perm-idcard-download-list', 'perm-idcard-reprint-list',
        // Actions
        'perm-idcard-add', 'perm-idcard-edit', 'perm-idcard-delete', 'perm-idcard-info',
        'perm-idcard-approve', 'perm-idcard-verify',
        'perm-idcard-bulk-upload', 'perm-idcard-bulk-download',
        'perm-idcard-created-at', 'perm-idcard-updated-at',
        'perm-idcard-delete-from-pool', 'perm-delete-all-idcard',
        'perm-reupload-idcard-image', 'perm-idcard-retrieve'
    ];

    // ==================== CLIENT ASSIGNMENT MULTI-SELECT ====================
    const clientAssignmentSection = document.getElementById('client-assignment-section');
    const clientMultiselectToggle = document.getElementById('client-multiselect-toggle');
    const clientMultiselectDropdown = document.getElementById('client-multiselect-dropdown');
    const clientMultiselectList = document.getElementById('client-multiselect-list');
    const clientMultiselectText = document.getElementById('client-multiselect-text');
    const clientSearchInput = document.getElementById('client-search-input');
    const clientMultiselectEmpty = document.getElementById('client-multiselect-empty');

    let allClients = [];           // { id, name } from API
    let selectedClientIds = new Set();

    // Fetch active clients from API
    async function fetchActiveClients() {
        try {
            const data = await ApiClient.get('/panel/api/clients/active/');
            if (data.success) {
                allClients = data.clients || [];
            }
        } catch (error) {
            allClients = [];
        }
    }

    // Render checkbox items, selected first, then alphabetical
    function renderClientList(filter = '') {
        if (!clientMultiselectList) return;
        clientMultiselectList.innerHTML = '';

        const term = filter.toLowerCase().trim();
        let filtered = allClients.filter(c =>
            !term || c.name.toLowerCase().includes(term)
        );

        // Sort: selected first, then alphabetical
        filtered.sort((a, b) => {
            const aSelected = selectedClientIds.has(a.id) ? 0 : 1;
            const bSelected = selectedClientIds.has(b.id) ? 0 : 1;
            if (aSelected !== bSelected) return aSelected - bSelected;
            return a.name.localeCompare(b.name);
        });

        if (filtered.length === 0) {
            if (clientMultiselectEmpty) clientMultiselectEmpty.style.display = '';
            return;
        }
        if (clientMultiselectEmpty) clientMultiselectEmpty.style.display = 'none';

        filtered.forEach(client => {
            const item = document.createElement('div');
            item.className = 'client-multiselect-item' + (selectedClientIds.has(client.id) ? ' selected' : '');
            item.innerHTML = `
                <input type="checkbox" ${selectedClientIds.has(client.id) ? 'checked' : ''} data-client-id="${client.id}">
                <span class="client-name">${client.name}</span>
            `;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const cb = item.querySelector('input[type="checkbox"]');
                if (e.target !== cb) cb.checked = !cb.checked;
                if (cb.checked) {
                    selectedClientIds.add(client.id);
                    item.classList.add('selected');
                } else {
                    selectedClientIds.delete(client.id);
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
        const count = selectedClientIds.size;
        if (count === 0) {
            clientMultiselectText.textContent = 'Select clients...';
            clientMultiselectText.classList.remove('has-selection');
        } else {
            // Show names for 1-2, count for 3+
            if (count <= 2) {
                const names = allClients
                    .filter(c => selectedClientIds.has(c.id))
                    .map(c => c.name);
                clientMultiselectText.textContent = names.join(', ');
            } else {
                clientMultiselectText.textContent = `${count} clients selected`;
            }
            clientMultiselectText.classList.add('has-selection');
        }
    }

    // Toggle dropdown
    if (clientMultiselectToggle) {
        clientMultiselectToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = clientMultiselectDropdown.style.display !== 'none';
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
        clientSearchInput.addEventListener('input', () => {
            renderClientList(clientSearchInput.value);
        });
        // Prevent dropdown from closing when clicking in search
        clientSearchInput.addEventListener('click', (e) => e.stopPropagation());
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (clientMultiselectDropdown && clientMultiselectDropdown.style.display !== 'none') {
            const container = document.getElementById('client-multiselect');
            if (container && !container.contains(e.target)) {
                closeClientDropdown();
            }
        }
    });

    // Initialize client assignment for drawer open
    async function initClientAssignment(preselectedIds = []) {
        if (!clientAssignmentSection) return;
        
        // Show the section (always visible for admin staff management)
        clientAssignmentSection.style.display = '';

        // Fetch clients if not loaded
        if (allClients.length === 0) {
            await fetchActiveClients();
        }

        // Set preselected
        selectedClientIds = new Set(preselectedIds.map(id => parseInt(id)));
        updateClientSelectionText();
        closeClientDropdown();
    }

    function resetClientAssignment() {
        selectedClientIds = new Set();
        if (clientMultiselectText) {
            clientMultiselectText.textContent = 'Select clients...';
            clientMultiselectText.classList.remove('has-selection');
        }
        closeClientDropdown();
    }

    // ==================== DRAWER FUNCTIONS ====================
    function openDrawer(mode = 'add', staffData = null) {
        currentMode = mode;
        staffForm.reset();
        
        // Phase 1: Profile image upload removed - using avatar placeholder
        
        // Reset all permission toggles to unchecked
        permissionFields.forEach(field => {
            const el = document.getElementById(field);
            if (el) el.checked = false;
        });
        
        // Reset client assignment
        resetClientAssignment();
        
        const submitBtnText = document.getElementById('submit-btn-text');
        
        if (mode === 'add') {
            drawerTitle.textContent = 'Add New Staff';
            drawerIcon.className = 'fa-solid fa-user-plus';
            if (submitBtnText) submitBtnText.textContent = 'Add Staff';
            submitBtn.style.display = 'inline-flex';
            enableFormInputs(true);
            initClientAssignment([]);
            
            // Set default-ON permissions for new staff
            const defaultOnPerms = [
                'perm-idcard-client-list',
                'perm-idcard-pending-list', 'perm-idcard-verified-list',
                'perm-idcard-pool-list', 'perm-idcard-approved-list',
                'perm-idcard-download-list',
                'perm-idcard-add', 'perm-idcard-edit', 'perm-idcard-delete',
                'perm-idcard-info', 'perm-idcard-approve', 'perm-idcard-verify',
                'perm-idcard-bulk-upload', 'perm-idcard-bulk-download',
                'perm-reupload-idcard-image', 'perm-idcard-retrieve'
            ];
            defaultOnPerms.forEach(field => {
                const el = document.getElementById(field);
                if (el) el.checked = true;
            });
        } else if (mode === 'edit') {
            drawerTitle.textContent = 'Edit Staff';
            drawerIcon.className = 'fa-solid fa-pen-to-square';
            if (submitBtnText) submitBtnText.textContent = 'Save Changes';
            submitBtn.style.display = 'inline-flex';
            enableFormInputs(true);
            
            if (staffData) {
                document.getElementById('staff-name').value = staffData.name || '';
                document.getElementById('staff-email').value = staffData.email || '';
                document.getElementById('staff-phone').value = staffData.phone || '';
                document.getElementById('staff-address').value = staffData.address || '';
                document.getElementById('staff-status').value = staffData.status === 'active' ? 'true' : 'false';
                
                // Phase 1: Profile image loading removed - using avatar placeholder
                
                // Set permissions from staff data
                permissionFields.forEach(field => {
                    const el = document.getElementById(field);
                    const apiField = field.replace(/-/g, '_');
                    if (el) el.checked = staffData[apiField] === true;
                });
                
                // Pre-select assigned clients
                initClientAssignment(staffData.assigned_client_ids || []);
            }
        } else if (mode === 'view') {
            drawerTitle.textContent = 'View Staff Details';
            drawerIcon.className = 'fa-solid fa-eye';
            submitBtn.style.display = 'none';
            enableFormInputs(false);
            
            if (staffData) {
                document.getElementById('staff-name').value = staffData.name || '';
                document.getElementById('staff-email').value = staffData.email || '';
                document.getElementById('staff-phone').value = staffData.phone || '';
                document.getElementById('staff-address').value = staffData.address || '';
                document.getElementById('staff-status').value = staffData.status === 'active' ? 'true' : 'false';
                
                // Phase 1: Profile image loading removed - using avatar placeholder
                
                // Set permissions from staff data
                permissionFields.forEach(field => {
                    const el = document.getElementById(field);
                    const apiField = field.replace(/-/g, '_');
                    if (el) el.checked = staffData[apiField] === true;
                });
                
                // Show assigned clients (read-only view)
                initClientAssignment(staffData.assigned_client_ids || []);
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
        const inputs = staffDrawer.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.disabled = !enable;
            if (!enable) {
                input.style.backgroundColor = '#f5f5f5';
                input.style.cursor = 'not-allowed';
            } else {
                input.style.backgroundColor = '';
                input.style.cursor = '';
            }
        });
        
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
    }

    // ==================== API CALLS ====================
    async function fetchStaffDetails(staffId) {
        try {
            const data = await ApiClient.get(`/panel/api/staff/${staffId}/`);
            if (data.success) {
                return data.staff;
            } else {
                showToast(data.message || 'Failed to fetch staff details', 'error');
                return null;
            }
        } catch (error) {
            showToast('Network error. Please try again.', 'error');
            return null;
        }
    }
    
    async function createStaff(formData) {
        try {
            // Phase 1: File upload removed - always use JSON
            const data = await ApiClient.post('/panel/api/staff/create/', formData);
            return data;
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    }
    
    async function updateStaff(staffId, formData) {
        try {
            // Phase 1: File upload removed - always use JSON
            const data = await ApiClient.post(`/panel/api/staff/${staffId}/update/`, formData);
            return data;
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    }
    
    async function deleteStaffApi(staffId) {
        try {
            const data = await ApiClient.post(`/panel/api/staff/${staffId}/delete/`);
            return data;
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    }
    
    async function toggleStaffStatus(staffId) {
        try {
            const data = await ApiClient.post(`/panel/api/staff/${staffId}/toggle-status/`);
            return data;
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    }

    // ==================== EVENT HANDLERS ====================
    if (addStaffBtn) {
        addStaffBtn.addEventListener('click', () => openDrawer('add'));
    }
    
    if (editStaffBtn) {
        editStaffBtn.addEventListener('click', async () => {
            if (!selectedStaffId) return;
            const staffData = await fetchStaffDetails(selectedStaffId);
            if (staffData) openDrawer('edit', staffData);
        });
    }
    
    if (viewStaffBtn) {
        viewStaffBtn.addEventListener('click', async () => {
            if (!selectedStaffId) return;
            const staffData = await fetchStaffDetails(selectedStaffId);
            if (staffData) openDrawer('view', staffData);
        });
    }
    
    if (deleteStaffBtn) {
        deleteStaffBtn.addEventListener('click', () => {
            if (!selectedStaffId || !selectedRow) {
                return;
            }
            
            // Name is in the 2nd column (index 1), not first (checkbox is first)
            const staffName = selectedRow.querySelector('td:nth-child(2)').textContent;
            openDeleteModal(staffName);
        });
    }
    
    if (activeStaffBtn) {
        activeStaffBtn.addEventListener('click', () => {
            if (!selectedStaffId || !selectedRow) return;
            
            // Name is in the 2nd column (index 1), checkbox is first
            const staffName = selectedRow.querySelector('td:nth-child(2)').textContent;
            const currentStatus = selectedRow.dataset.staffStatus;
            pendingStatusStaffId = selectedStaffId;
            openStatusModal(staffName, currentStatus);
        });
    }
    
    if (staffForm) {
        staffForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Prevent double submission
            const submitBtn = staffForm.querySelector('button[type="submit"]');
            if (submitBtn.disabled) return;
            submitBtn.disabled = true;
            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
            
            const formData = {
                name: document.getElementById('staff-name').value,
                email: document.getElementById('staff-email').value,
                phone: document.getElementById('staff-phone').value,
                address: document.getElementById('staff-address')?.value || '',
                is_active: document.getElementById('staff-status').value === 'true',
            };
            
            // Add all permissions (convert hyphen-case to underscore for API)
            permissionFields.forEach(field => {
                const el = document.getElementById(field);
                const apiField = field.replace(/-/g, '_');
                if (el) formData[apiField] = el.checked;
            });
            
            // Add assigned client IDs
            formData.assigned_clients = Array.from(selectedClientIds);
            
            let result;
            
            try {
                if (currentMode === 'edit' && selectedStaffId) {
                    result = await updateStaff(selectedStaffId, formData);
                } else {
                    result = await createStaff(formData);
                }
                
                if (result.success) {
                    showToast(result.message, 'success');
                    closeDrawer();
                    setTimeout(() => location.reload(), 500);
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
    
    // Close drawer events
    if (closeStaffDrawer) {
        closeStaffDrawer.addEventListener('click', closeDrawer);
    }
    if (cancelStaffDrawer) {
        cancelStaffDrawer.addEventListener('click', function(e) {
            e.preventDefault();
            closeDrawer();
    });
    }
    
    // Close drawer on overlay click
    if (staffDrawerOverlay) {
        staffDrawerOverlay.addEventListener('click', closeDrawer);
    }

    // Phase 1: Profile picture upload removed - using avatar placeholder

    // ==================== FILTER & SEARCH ====================
    const dropdownToggle = document.getElementById('statusToggle');
    const dropdownOptions = document.getElementById('statusOptions');
    const filterDropdown = document.getElementById('status-dropdown');
    const selectedText = document.getElementById('statusSelectedText');
    const searchInput = document.getElementById('searchInput');
    
    let currentFilter = '';\n    \n    function performSearch() {
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const rows = document.querySelectorAll('.data-table tbody tr');
        
        rows.forEach(row => {
            if (row.classList.contains('no-data-row')) return;
            
            const cells = row.querySelectorAll('td');
            let matchSearch = false;
            let matchStatus = true;
            
            // Check status filter first
            if (currentFilter === 'active' || currentFilter === 'inactive') {
                const rowStatus = row.dataset.staffStatus;
                matchStatus = rowStatus === currentFilter;
            }
            
            // Then check search term
            if (!searchTerm) {
                matchSearch = true;
            } else {
                cells.forEach(cell => {
                    if (cell.textContent.toLowerCase().includes(searchTerm)) {
                        matchSearch = true;
                    }
                });
            }
            
            row.style.display = (matchSearch && matchStatus) ? '' : 'none';
        });
    }
    
    if (searchInput) {
        searchInput.addEventListener('input', performSearch);
    }
    
    if (dropdownToggle && dropdownOptions && filterDropdown) {
        dropdownToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            filterDropdown.classList.toggle('open');
        });
        
        dropdownOptions.querySelectorAll('.dropdown-option').forEach(option => {
            option.addEventListener('click', function() {
                dropdownOptions.querySelectorAll('.dropdown-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                this.classList.add('selected');
                
                const value = this.dataset.value;
                const text = this.textContent;
                
                selectedText.textContent = text;
                currentFilter = value;
                
                if (searchInput) {
                    searchInput.placeholder = value === '' ? 'Search All...' : `Search ${text}...`;
                }
                
                filterDropdown.classList.remove('open');
                // Will be overridden by performSearchWithPagination later
                performSearch();
            });
        });
        
        document.addEventListener('click', function() {
            filterDropdown.classList.remove('open');
        });
    }

    // ==================== AUTO-OPEN DRAWER FROM URL ====================
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('add') === '1') {
        openDrawer('add');
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // ==================== DELETE MODAL ====================
    const deleteModal = document.getElementById('delete-modal');
    const closeDeleteModal = document.getElementById('closeDeleteModal');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const deleteStaffNameEl = document.getElementById('deleteStaffName');

    function openDeleteModal(staffName) {
        if (deleteStaffNameEl) {
            deleteStaffNameEl.textContent = staffName;
        }
        if (deleteModal) {
            deleteModal.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeDeleteModalFn() {
        if (deleteModal) {
            deleteModal.classList.remove('show');
            document.body.style.overflow = '';
        }
    }

    if (closeDeleteModal) {
        closeDeleteModal.addEventListener('click', closeDeleteModalFn);
    }

    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', closeDeleteModalFn);
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            if (!selectedStaffId) return;

            const result = await deleteStaffApi(selectedStaffId);
            if (result.success) {
                showToast(result.message, 'success');
                closeDeleteModalFn();
                selectedRow.remove();
                selectedStaffId = null;
                selectedRow = null;
                enableActionButtons(false);
            } else {
                showToast(result.message || 'Failed to delete staff', 'error');
            }
        });
    }

    // Close modal on overlay click
    if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) {
                closeDeleteModalFn();
            }
        });
    }

    // ==================== STATUS MODAL ====================
    const statusModal = document.getElementById('status-modal');
    const closeStatusModal = document.getElementById('closeStatusModal');
    const cancelStatusBtn = document.getElementById('cancelStatusBtn');
    const confirmStatusBtn = document.getElementById('confirmStatusBtn');
    const statusStaffNameEl = document.getElementById('statusStaffName');
    const statusModalHeader = document.getElementById('statusModalHeader');
    const statusModalIcon = document.getElementById('statusModalIcon');
    const statusNote = document.getElementById('statusNote');
    
    let pendingStatusStaffId = null;
    let pendingStatusCurrentStatus = null;

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
            if (statusNote) statusNote.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> This will prevent the staff member from logging in.';
            if (confirmStatusBtn) {
                confirmStatusBtn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
                confirmStatusBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Deactivate';
            }
        } else {
            // Going to activate
            if (statusModalHeader) statusModalHeader.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
            if (statusModalIcon) statusModalIcon.innerHTML = '<i class="fa-solid fa-check-circle" style="font-size: 48px; color: #22c55e;"></i>';
            if (statusNote) statusNote.innerHTML = '<i class="fa-solid fa-info-circle"></i> This will allow the staff member to log in.';
            if (confirmStatusBtn) {
                confirmStatusBtn.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
                confirmStatusBtn.innerHTML = '<i class="fa-solid fa-check"></i> Activate';
            }
        }
        
        if (statusModal) {
            statusModal.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeStatusModalFn() {
        if (statusModal) {
            statusModal.classList.remove('show');
            document.body.style.overflow = '';
        }
        pendingStatusStaffId = null;
        pendingStatusCurrentStatus = null;
    }

    if (closeStatusModal) {
        closeStatusModal.addEventListener('click', closeStatusModalFn);
    }

    if (cancelStatusBtn) {
        cancelStatusBtn.addEventListener('click', closeStatusModalFn);
    }

    if (confirmStatusBtn) {
        confirmStatusBtn.addEventListener('click', async () => {
            if (!pendingStatusStaffId) return;

            const result = await toggleStaffStatus(pendingStatusStaffId);
            if (result.success) {
                showToast(result.message, 'success');
                closeStatusModalFn();
                
                if (selectedRow) {
                    selectedRow.dataset.staffStatus = result.status;
                    const statusBadge = selectedRow.querySelector('.status-badge');
                    if (statusBadge) {
                        statusBadge.textContent = result.status_display;
                        statusBadge.className = 'status-badge ' + (result.status === 'active' ? 'active' : 'inactive');
                    }
                    updateActiveButtonState();
                }
            } else {
                showToast(result.message || 'Failed to update status', 'error');
            }
        });
    }

    // Close status modal on overlay click
    if (statusModal) {
        statusModal.addEventListener('click', (e) => {
            if (e.target === statusModal) {
                closeStatusModalFn();
            }
        });
    }

    // ==================== PAGINATION ====================
    const rowCountEl = document.getElementById('row-count');
    const pageNumbersEl = document.getElementById('page-numbers');
    const firstPageBtn = document.getElementById('firstPage');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const lastPageBtn = document.getElementById('lastPage');
    const rowsDropdown = document.getElementById('rowsDropdown');
    const rowsToggle = document.getElementById('rowsToggle');
    const rowsOptions = document.getElementById('rowsOptions');
    const rowsSelectedText = document.getElementById('rowsSelectedText');
    
    let currentPage = 1;
    let rowsPerPage = 10;
    let allRows = [];
    let filteredRows = [];
    
    function initPagination() {
        if (!tbody) return;
        
        // Get all data rows (exclude no-data row)
        allRows = Array.from(tbody.querySelectorAll('tr:not(.no-data-row)'));
        filteredRows = [...allRows];
        
        updatePagination();
    }
    
    function updatePagination() {
        // Filter rows based on search and filter criteria
        filteredRows = allRows.filter(row => row.style.display !== 'none');
        
        const totalRows = filteredRows.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
        
        // Ensure current page is valid
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        
        const startIndex = (currentPage - 1) * rowsPerPage;
        const endIndex = Math.min(startIndex + rowsPerPage, totalRows);
        
        // Hide all rows first, then show only current page
        allRows.forEach(row => {
            row.style.display = 'none';
        });
        
        filteredRows.slice(startIndex, endIndex).forEach(row => {
            row.style.display = '';
        });
        
        // Update row count text
        if (rowCountEl) {
            if (totalRows === 0) {
                rowCountEl.innerHTML = 'Showing <strong>0</strong> results';
            } else {
                rowCountEl.innerHTML = `Showing <strong>${startIndex + 1}-${endIndex}</strong> of <strong>${totalRows}</strong> results`;
            }
        }
        
        // Update page numbers
        if (pageNumbersEl) {
            pageNumbersEl.innerHTML = '';
            const maxVisiblePages = 5;
            let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
            let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
            
            if (endPage - startPage < maxVisiblePages - 1) {
                startPage = Math.max(1, endPage - maxVisiblePages + 1);
            }
            
            for (let i = startPage; i <= endPage; i++) {
                const pageBtn = document.createElement('button');
                pageBtn.className = 'page-num' + (i === currentPage ? ' active' : '');
                pageBtn.textContent = i;
                pageBtn.addEventListener('click', () => goToPage(i));
                pageNumbersEl.appendChild(pageBtn);
            }
        }
        
        // Update button states
        if (firstPageBtn) firstPageBtn.disabled = currentPage === 1;
        if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;
        if (nextPageBtn) nextPageBtn.disabled = currentPage === totalPages;
        if (lastPageBtn) lastPageBtn.disabled = currentPage === totalPages;
    }
    
    function goToPage(page) {
        currentPage = page;
        clearStaffSelection();
        updatePagination();
    }
    
    // Pagination button events
    if (firstPageBtn) firstPageBtn.addEventListener('click', () => goToPage(1));
    if (prevPageBtn) prevPageBtn.addEventListener('click', () => goToPage(currentPage - 1));
    if (nextPageBtn) nextPageBtn.addEventListener('click', () => goToPage(currentPage + 1));
    if (lastPageBtn) {
        lastPageBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredRows.length / rowsPerPage);
            goToPage(totalPages);
        });
    }
    
    // Rows per page dropdown
    if (rowsDropdown && rowsToggle && rowsOptions) {
        rowsToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            rowsDropdown.classList.toggle('open');
        });
        
        rowsOptions.querySelectorAll('.dropdown-option').forEach(option => {
            option.addEventListener('click', function() {
                rowsOptions.querySelectorAll('.dropdown-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                this.classList.add('selected');
                
                rowsPerPage = parseInt(this.dataset.value);
                if (rowsSelectedText) rowsSelectedText.textContent = rowsPerPage;
                
                currentPage = 1;
                rowsDropdown.classList.remove('open');
                updatePagination();
            });
        });
        
        document.addEventListener('click', function(e) {
            if (!rowsDropdown.contains(e.target)) {
                rowsDropdown.classList.remove('open');
            }
        });
    }
    
    // Override performSearch to integrate with pagination
    const originalPerformSearch = performSearch;
    function performSearchWithPagination() {
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
        
        // Reset visibility for pagination recalculation
        allRows.forEach(row => {
            const cells = row.querySelectorAll('td');
            let matchSearch = false;
            let matchStatus = true;
            
            // Check status filter
            if (currentFilter === 'active' || currentFilter === 'inactive') {
                const rowStatus = row.dataset.staffStatus;
                matchStatus = rowStatus === currentFilter;
            }
            
            // Check search term
            if (!searchTerm) {
                matchSearch = true;
            } else {
                cells.forEach(cell => {
                    if (cell.textContent.toLowerCase().includes(searchTerm)) {
                        matchSearch = true;
                    }
                });
            }
            
            // Mark row as filtered or not (using data attribute instead of display)
            row.dataset.filtered = (matchSearch && matchStatus) ? 'true' : 'false';
            row.style.display = (matchSearch && matchStatus) ? '' : 'none';
        });
        
        // Reset to page 1 and update pagination
        currentPage = 1;
        updatePagination();
    }
    
    // Override the original performSearch globally
    performSearch = performSearchWithPagination;
    
    // Replace search handler
    if (searchInput) {
        searchInput.removeEventListener('input', originalPerformSearch);
        searchInput.addEventListener('input', performSearchWithPagination);
    }
    
    // Initialize pagination on page load
    initPagination();
});
