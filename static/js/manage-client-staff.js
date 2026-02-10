// Manage Client Staff Page JavaScript
// Mirrors admin manage-staff.js but uses client API endpoints
// and Group Assignment instead of Client Assignment

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
    
    // Profile elements (used in drawer)
    const profilePicInput = document.getElementById('profile-input');
    const profilePreview = document.getElementById('profile-preview');
    const profilePathDisplay = document.getElementById('staff-profile-path');
    
    let selectedStaffId = null;
    let selectedRow = null;
    let currentMode = 'add';
    let selectedProfileFile = null;

    // ==================== ROW SELECTION ====================
    
    function selectStaffRow(row) {
        if (!row || !row.dataset.staffId) return;
        
        if (tbody) {
            tbody.querySelectorAll('tr').forEach(r => {
                r.classList.remove('selected');
                const cb = r.querySelector('.row-checkbox');
                if (cb) cb.checked = false;
            });
        }
        
        row.classList.add('selected');
        const checkbox = row.querySelector('.row-checkbox');
        if (checkbox) checkbox.checked = true;
        
        selectedRow = row;
        selectedStaffId = row.dataset.staffId;
        enableActionButtons(true);
        updateActiveButtonState();
    }
    
    function clearStaffSelection() {
        if (tbody) {
            tbody.querySelectorAll('tr').forEach(r => {
                r.classList.remove('selected');
                const cb = r.querySelector('.row-checkbox');
                if (cb) cb.checked = false;
            });
        }
        selectedRow = null;
        selectedStaffId = null;
        enableActionButtons(false);
    }
    
    if (tbody) {
        tbody.addEventListener('click', function(e) {
            if (e.target.type === 'checkbox') return;
            const row = e.target.closest('tr');
            if (row && row.dataset.staffId && !row.classList.contains('no-data-row')) {
                selectStaffRow(row);
            }
        });
        
        tbody.addEventListener('change', function(e) {
            if (e.target.type === 'checkbox' && e.target.classList.contains('row-checkbox')) {
                const row = e.target.closest('tr');
                if (row && row.dataset.staffId) {
                    if (e.target.checked) {
                        selectStaffRow(row);
                    } else {
                        clearStaffSelection();
                    }
                }
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
        'perm-idcard-pending-list', 'perm-idcard-verified-list', 'perm-idcard-pool-list',
        'perm-idcard-approved-list', 'perm-idcard-download-list',
        'perm-idcard-add', 'perm-idcard-edit', 'perm-idcard-delete', 'perm-idcard-info',
        'perm-idcard-approve', 'perm-idcard-verify',
        'perm-idcard-created-at', 'perm-idcard-updated-at'
    ];

    // ==================== GROUP ASSIGNMENT MULTI-SELECT ====================
    const groupAssignmentSection = document.getElementById('group-assignment-section');
    const groupMultiselectToggle = document.getElementById('group-multiselect-toggle');
    const groupMultiselectDropdown = document.getElementById('group-multiselect-dropdown');
    const groupMultiselectList = document.getElementById('group-multiselect-list');
    const groupMultiselectText = document.getElementById('group-multiselect-text');
    const groupSearchInput = document.getElementById('group-search-input');
    const groupMultiselectEmpty = document.getElementById('group-multiselect-empty');

    let allGroups = [];
    let selectedGroupIds = new Set();

    async function fetchActiveGroups() {
        try {
            const response = await fetch('/panel/client/api/groups/active/');
            const data = await response.json();
            if (data.success) {
                allGroups = data.groups || [];
            }
        } catch (error) {
            allGroups = [];
        }
    }

    function renderGroupList(filter = '') {
        if (!groupMultiselectList) return;
        groupMultiselectList.innerHTML = '';

        const term = filter.toLowerCase().trim();
        let filtered = allGroups.filter(g =>
            !term || g.name.toLowerCase().includes(term)
        );

        filtered.sort((a, b) => {
            const aSelected = selectedGroupIds.has(a.id) ? 0 : 1;
            const bSelected = selectedGroupIds.has(b.id) ? 0 : 1;
            if (aSelected !== bSelected) return aSelected - bSelected;
            return a.name.localeCompare(b.name);
        });

        if (filtered.length === 0) {
            if (groupMultiselectEmpty) groupMultiselectEmpty.style.display = '';
            return;
        }
        if (groupMultiselectEmpty) groupMultiselectEmpty.style.display = 'none';

        filtered.forEach(group => {
            const item = document.createElement('div');
            item.className = 'client-multiselect-item' + (selectedGroupIds.has(group.id) ? ' selected' : '');
            item.innerHTML = `
                <input type="checkbox" ${selectedGroupIds.has(group.id) ? 'checked' : ''} data-group-id="${group.id}">
                <span class="client-name">${group.name}</span>
            `;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const cb = item.querySelector('input[type="checkbox"]');
                if (e.target !== cb) cb.checked = !cb.checked;
                if (cb.checked) {
                    selectedGroupIds.add(group.id);
                    item.classList.add('selected');
                } else {
                    selectedGroupIds.delete(group.id);
                    item.classList.remove('selected');
                }
                updateGroupSelectionText();
            });
            groupMultiselectList.appendChild(item);
        });
    }

    function updateGroupSelectionText() {
        if (!groupMultiselectText) return;
        const count = selectedGroupIds.size;
        if (count === 0) {
            groupMultiselectText.textContent = 'Select groups...';
            groupMultiselectText.classList.remove('has-selection');
        } else {
            if (count <= 2) {
                const names = allGroups
                    .filter(g => selectedGroupIds.has(g.id))
                    .map(g => g.name);
                groupMultiselectText.textContent = names.join(', ');
            } else {
                groupMultiselectText.textContent = `${count} groups selected`;
            }
            groupMultiselectText.classList.add('has-selection');
        }
    }

    if (groupMultiselectToggle) {
        groupMultiselectToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = groupMultiselectDropdown.style.display !== 'none';
            if (isOpen) {
                closeGroupDropdown();
            } else {
                openGroupDropdown();
            }
        });
    }

    function openGroupDropdown() {
        if (!groupMultiselectDropdown) return;
        groupMultiselectDropdown.style.display = '';
        groupMultiselectToggle.classList.add('open');
        if (groupSearchInput) {
            groupSearchInput.value = '';
            groupSearchInput.focus();
        }
        renderGroupList();
    }

    function closeGroupDropdown() {
        if (!groupMultiselectDropdown) return;
        groupMultiselectDropdown.style.display = 'none';
        groupMultiselectToggle.classList.remove('open');
    }

    if (groupSearchInput) {
        groupSearchInput.addEventListener('input', () => {
            renderGroupList(groupSearchInput.value);
        });
        groupSearchInput.addEventListener('click', (e) => e.stopPropagation());
    }

    document.addEventListener('click', (e) => {
        if (groupMultiselectDropdown && groupMultiselectDropdown.style.display !== 'none') {
            const container = document.getElementById('group-multiselect');
            if (container && !container.contains(e.target)) {
                closeGroupDropdown();
            }
        }
    });

    async function initGroupAssignment(preselectedIds = []) {
        if (!groupAssignmentSection) return;
        groupAssignmentSection.style.display = '';
        if (allGroups.length === 0) {
            await fetchActiveGroups();
        }
        selectedGroupIds = new Set(preselectedIds.map(id => parseInt(id)));
        updateGroupSelectionText();
        closeGroupDropdown();
    }

    function resetGroupAssignment() {
        selectedGroupIds = new Set();
        if (groupMultiselectText) {
            groupMultiselectText.textContent = 'Select groups...';
            groupMultiselectText.classList.remove('has-selection');
        }
        closeGroupDropdown();
    }

    // ==================== DRAWER FUNCTIONS ====================
    function openDrawer(mode = 'add', staffData = null) {
        currentMode = mode;
        staffForm.reset();
        
        selectedProfileFile = null;
        if (profilePreview) {
            profilePreview.innerHTML = '<i class="fa-solid fa-user"></i>';
            profilePreview.classList.remove('has-image');
        }
        if (profilePicInput) profilePicInput.value = '';
        
        if (profilePathDisplay) {
            profilePathDisplay.textContent = 'No image';
            profilePathDisplay.classList.remove('has-path', 'not-found');
            profilePathDisplay.classList.add('no-path');
        }
        
        permissionFields.forEach(field => {
            const el = document.getElementById(field);
            if (el) el.checked = false;
        });
        
        resetGroupAssignment();
        
        const submitBtnText = document.getElementById('submit-btn-text');
        
        if (mode === 'add') {
            drawerTitle.textContent = 'Add New Staff';
            drawerIcon.className = 'fa-solid fa-user-plus';
            if (submitBtnText) submitBtnText.textContent = 'Add Staff';
            submitBtn.style.display = 'inline-flex';
            enableFormInputs(true);
            initGroupAssignment([]);
            
            // Set default-ON permissions for new staff
            const defaultOnPerms = [
                'perm-idcard-pending-list', 'perm-idcard-verified-list',
                'perm-idcard-pool-list', 'perm-idcard-approved-list',
                'perm-idcard-download-list',
                'perm-idcard-add', 'perm-idcard-edit', 'perm-idcard-delete',
                'perm-idcard-info', 'perm-idcard-approve', 'perm-idcard-verify',
                'perm-idcard-created-at', 'perm-idcard-updated-at'
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
                
                if (staffData.profile_image_url && profilePreview) {
                    const img = document.createElement('img');
                    img.src = staffData.profile_image_url;
                    img.alt = 'Profile';
                    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
                    profilePreview.innerHTML = '';
                    profilePreview.appendChild(img);
                    profilePreview.classList.add('has-image');
                    if (profilePathDisplay) {
                        profilePathDisplay.textContent = staffData.profile_image_url;
                        profilePathDisplay.classList.remove('no-path', 'not-found');
                        profilePathDisplay.classList.add('has-path');
                    }
                }
                
                permissionFields.forEach(field => {
                    const el = document.getElementById(field);
                    const apiField = field.replace(/-/g, '_');
                    if (el) el.checked = staffData[apiField] === true;
                });
                
                initGroupAssignment(staffData.assigned_group_ids || []);
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
                
                if (staffData.profile_image_url && profilePreview) {
                    const img = document.createElement('img');
                    img.src = staffData.profile_image_url;
                    img.alt = 'Profile';
                    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
                    profilePreview.innerHTML = '';
                    profilePreview.appendChild(img);
                    profilePreview.classList.add('has-image');
                    if (profilePathDisplay) {
                        profilePathDisplay.textContent = staffData.profile_image_url;
                        profilePathDisplay.classList.remove('no-path', 'not-found');
                        profilePathDisplay.classList.add('has-path');
                    }
                }
                
                permissionFields.forEach(field => {
                    const el = document.getElementById(field);
                    const apiField = field.replace(/-/g, '_');
                    if (el) el.checked = staffData[apiField] === true;
                });
                
                initGroupAssignment(staffData.assigned_group_ids || []);
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
        
        if (groupMultiselectToggle) {
            if (!enable) {
                groupMultiselectToggle.style.pointerEvents = 'none';
                groupMultiselectToggle.style.opacity = '0.6';
                closeGroupDropdown();
            } else {
                groupMultiselectToggle.style.pointerEvents = '';
                groupMultiselectToggle.style.opacity = '';
            }
        }
    }

    // ==================== API CALLS (Client Endpoints) ====================
    
    function getCsrfToken() {
        // Use global getCSRFToken from ajax.js if available
        if (typeof window.getCSRFToken === 'function') return window.getCSRFToken();
        const cookie = document.cookie.split(';').find(c => c.trim().startsWith('csrftoken='));
        return cookie ? cookie.split('=')[1] : '';
    }
    
    async function fetchStaffDetails(staffId) {
        try {
            const response = await fetch(`/panel/client/api/staff/${staffId}/`);
            const data = await response.json();
            if (data.success) {
                return data.data;
            } else {
                showToast(data.error || 'Failed to fetch staff details', 'error');
                return null;
            }
        } catch (error) {
            showToast('Network error. Please try again.', 'error');
            return null;
        }
    }
    
    async function createStaff(formData, file = null) {
        try {
            if (file) {
                const data = new FormData();
                data.append('profile_image', file);
                Object.keys(formData).forEach(key => {
                    if (key === 'assigned_groups') {
                        data.append(key, JSON.stringify(formData[key]));
                    } else {
                        data.append(key, typeof formData[key] === 'boolean' ? (formData[key] ? 'true' : 'false') : formData[key]);
                    }
                });
                const response = await fetch('/panel/client/api/staff/', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() },
                    body: data
                });
                return await response.json();
            } else {
                const response = await fetch('/panel/client/api/staff/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                    body: JSON.stringify(formData)
                });
                return await response.json();
            }
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    }
    
    async function updateStaff(staffId, formData, file = null) {
        try {
            if (file) {
                const data = new FormData();
                data.append('profile_image', file);
                Object.keys(formData).forEach(key => {
                    if (key === 'assigned_groups') {
                        data.append(key, JSON.stringify(formData[key]));
                    } else {
                        data.append(key, typeof formData[key] === 'boolean' ? (formData[key] ? 'true' : 'false') : formData[key]);
                    }
                });
                const response = await fetch(`/panel/client/api/staff/${staffId}/`, {
                    method: 'PUT',
                    headers: { 'X-CSRFToken': getCsrfToken() },
                    body: data
                });
                return await response.json();
            } else {
                const response = await fetch(`/panel/client/api/staff/${staffId}/`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                    body: JSON.stringify(formData)
                });
                return await response.json();
            }
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    }
    
    async function deleteStaffApi(staffId) {
        try {
            const response = await fetch(`/panel/client/api/staff/${staffId}/`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() }
            });
            return await response.json();
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    }
    
    async function toggleStaffStatus(staffId) {
        try {
            const response = await fetch(`/panel/client/api/staff/${staffId}/toggle-status/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() }
            });
            return await response.json();
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
            if (!selectedStaffId || !selectedRow) return;
            const staffName = selectedRow.querySelector('td:nth-child(2)').textContent;
            openDeleteModal(staffName);
        });
    }
    
    if (activeStaffBtn) {
        activeStaffBtn.addEventListener('click', async () => {
            if (!selectedStaffId) return;
            const result = await toggleStaffStatus(selectedStaffId);
            if (result.success) {
                showToast(result.message, 'success');
                selectedRow.dataset.staffStatus = result.status;
                const statusBadge = selectedRow.querySelector('.status-badge');
                statusBadge.textContent = result.status_display;
                statusBadge.className = 'status-badge ' + (result.status === 'active' ? 'active' : 'inactive');
                updateActiveButtonState();
            } else {
                showToast(result.message || 'Failed to update status', 'error');
            }
        });
    }
    
    if (staffForm) {
        staffForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
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
            
            // Add all permissions (skip disabled = client doesn't have it)
            permissionFields.forEach(field => {
                const el = document.getElementById(field);
                const apiField = field.replace(/-/g, '_');
                if (el) {
                    formData[apiField] = el.disabled ? false : el.checked;
                }
            });
            
            // Add assigned group IDs
            formData.assigned_groups = Array.from(selectedGroupIds);
            
            let result;
            
            try {
                if (currentMode === 'edit' && selectedStaffId) {
                    result = await updateStaff(selectedStaffId, formData, selectedProfileFile);
                } else {
                    result = await createStaff(formData, selectedProfileFile);
                }
                
                if (result.success) {
                    showToast(result.message || 'Operation successful', 'success');
                    selectedProfileFile = null;
                    closeDrawer();
                    setTimeout(() => location.reload(), 500);
                } else {
                    showToast(result.error || result.message || 'Operation failed', 'error');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                }
            } catch (error) {
                showToast('An error occurred', 'error');
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
    
    if (staffDrawerOverlay) {
        staffDrawerOverlay.addEventListener('click', closeDrawer);
    }

    // ==================== SELECT ALL CHECKBOX ====================
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    
    if (selectAllCheckbox && tbody) {
        selectAllCheckbox.addEventListener('change', function() {
            const checkboxes = tbody.querySelectorAll('.row-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = this.checked;
            });
            
            if (this.checked) {
                const firstRow = tbody.querySelector('tr[data-staff-id]');
                if (firstRow) selectStaffRow(firstRow);
            } else {
                clearStaffSelection();
            }
        });
    }

    // ==================== PROFILE PICTURE UPLOAD ====================
    if (profilePicInput && profilePreview) {
        profilePicInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                if (file.size > 2 * 1024 * 1024) {
                    showToast('Image size must be less than 2MB', 'error');
                    profilePicInput.value = '';
                    return;
                }
                
                if (!file.type.startsWith('image/')) {
                    showToast('Please select a valid image file', 'error');
                    profilePicInput.value = '';
                    return;
                }
                
                selectedProfileFile = file;
                const reader = new FileReader();
                reader.onload = function(event) {
                    profilePreview.innerHTML = `<img src="${event.target.result}" alt="Profile" style="width: 100%; height: 100%; object-fit: cover;">`;
                    profilePreview.classList.add('has-image');
                    if (profilePathDisplay) {
                        profilePathDisplay.textContent = file.name;
                        profilePathDisplay.classList.remove('no-path', 'not-found');
                        profilePathDisplay.classList.add('has-path');
                    }
                };
                reader.onerror = function(error) {
                    console.error('FileReader error:', error);
                    showToast('Failed to read image file', 'error');
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // ==================== FILTER & SEARCH ====================
    const dropdownToggle = document.getElementById('statusToggle');
    const dropdownOptions = document.getElementById('statusOptions');
    const filterDropdown = document.getElementById('status-dropdown');
    const selectedText = document.getElementById('statusSelectedText');
    const searchInput = document.getElementById('search-input');
    
    let currentFilter = '';
    
    function performSearch() {
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const rows = document.querySelectorAll('.data-table tbody tr');
        
        rows.forEach(row => {
            if (row.classList.contains('no-data-row')) return;
            
            const cells = row.querySelectorAll('td');
            let matchSearch = false;
            let matchStatus = true;
            
            if (currentFilter === 'active' || currentFilter === 'inactive') {
                const rowStatus = row.dataset.staffStatus;
                matchStatus = rowStatus === currentFilter;
            }
            
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
    
    // Search clear button
    const searchClearBtn = document.getElementById('searchClearBtn');
    if (searchClearBtn && searchInput) {
        searchClearBtn.addEventListener('click', function() {
            searchInput.value = '';
            performSearch();
        });
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
    const closeDeleteModalBtn = document.getElementById('closeDeleteModal');
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

    if (closeDeleteModalBtn) {
        closeDeleteModalBtn.addEventListener('click', closeDeleteModalFn);
    }

    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', closeDeleteModalFn);
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            if (!selectedStaffId) return;

            const result = await deleteStaffApi(selectedStaffId);
            if (result.success) {
                showToast(result.message || 'Staff deleted successfully', 'success');
                closeDeleteModalFn();
                selectedRow.remove();
                selectedStaffId = null;
                selectedRow = null;
                enableActionButtons(false);
            } else {
                showToast(result.error || result.message || 'Failed to delete staff', 'error');
            }
        });
    }

    if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) {
                closeDeleteModalFn();
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
        allRows = Array.from(tbody.querySelectorAll('tr:not(.no-data-row)'));
        filteredRows = [...allRows];
        updatePagination();
    }
    
    function updatePagination() {
        filteredRows = allRows.filter(row => row.style.display !== 'none');
        
        const totalRows = filteredRows.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
        
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        
        const startIndex = (currentPage - 1) * rowsPerPage;
        const endIndex = Math.min(startIndex + rowsPerPage, totalRows);
        
        allRows.forEach(row => {
            row.style.display = 'none';
        });
        
        filteredRows.slice(startIndex, endIndex).forEach(row => {
            row.style.display = '';
        });
        
        if (rowCountEl) {
            if (totalRows === 0) {
                rowCountEl.innerHTML = 'Showing <strong>0</strong> results';
            } else {
                rowCountEl.innerHTML = `Showing <strong>${startIndex + 1}-${endIndex}</strong> of <strong>${totalRows}</strong> results`;
            }
        }
        
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
    
    if (firstPageBtn) firstPageBtn.addEventListener('click', () => goToPage(1));
    if (prevPageBtn) prevPageBtn.addEventListener('click', () => goToPage(currentPage - 1));
    if (nextPageBtn) nextPageBtn.addEventListener('click', () => goToPage(currentPage + 1));
    if (lastPageBtn) {
        lastPageBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredRows.length / rowsPerPage);
            goToPage(totalPages);
        });
    }
    
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
        
        allRows.forEach(row => {
            const cells = row.querySelectorAll('td');
            let matchSearch = false;
            let matchStatus = true;
            
            if (currentFilter === 'active' || currentFilter === 'inactive') {
                const rowStatus = row.dataset.staffStatus;
                matchStatus = rowStatus === currentFilter;
            }
            
            if (!searchTerm) {
                matchSearch = true;
            } else {
                cells.forEach(cell => {
                    if (cell.textContent.toLowerCase().includes(searchTerm)) {
                        matchSearch = true;
                    }
                });
            }
            
            row.dataset.filtered = (matchSearch && matchStatus) ? 'true' : 'false';
            row.style.display = (matchSearch && matchStatus) ? '' : 'none';
        });
        
        currentPage = 1;
        updatePagination();
    }
    
    performSearch = performSearchWithPagination;
    
    if (searchInput) {
        searchInput.removeEventListener('input', originalPerformSearch);
        searchInput.addEventListener('input', performSearchWithPagination);
    }
    
    // Initialize pagination on page load
    initPagination();
});
