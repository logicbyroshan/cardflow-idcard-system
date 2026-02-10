// Manage Client Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    
    // ====================
    // TOAST FUNCTIONS
    // ====================
    // Using shared showToast from utils.js

    // ====================
    // API FUNCTIONS
    // ====================
    async function fetchClientDetails(clientId) {
        try {
            const response = await fetch(`/panel/api/client/${clientId}/`);
            const data = await response.json();
            if (data.success) {
                return data.client;
            } else {
                showToast(data.message || 'Failed to load client details', 'error');
                return null;
            }
        } catch (error) {
            showToast('Network error. Please try again.', 'error');
            return null;
        }
    }
    
    async function createClient(formData) {
        try {
            const response = await fetch('/panel/api/client/create/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            return await response.json();
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    }
    
    async function updateClient(clientId, formData) {
        try {
            const response = await fetch(`/panel/api/client/${clientId}/update/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            return await response.json();
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    }
    
    async function toggleClientStatus(clientId) {
        try {
            const response = await fetch(`/panel/api/client/${clientId}/toggle-status/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            return await response.json();
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    }
    
    async function deleteClientApi(clientId) {
        try {
            const response = await fetch(`/panel/api/client/${clientId}/delete/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            return await response.json();
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    }
    
    async function fetchClientStaff(clientId) {
        try {
            const response = await fetch(`/panel/api/client/${clientId}/staff/`);
            return await response.json();
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    }

    // ====================
    // Filter Dropdown
    // ====================
    const dropdownToggle = document.getElementById('dropdownToggle');
    const dropdownOptions = document.getElementById('dropdownOptions');
    const selectedText = document.getElementById('selectedText');
    const searchInput = document.getElementById('searchInput');
    const filterDropdown = document.getElementById('filterDropdown');
    
    if (dropdownToggle && dropdownOptions && filterDropdown) {
        dropdownToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            filterDropdown.classList.toggle('open');
        });
        
        dropdownOptions.querySelectorAll('.dropdown-option').forEach(option => {
            option.addEventListener('click', function() {
                const value = this.dataset.value;
                const text = this.textContent;
                
                selectedText.textContent = text;
                
                if (searchInput) {
                    searchInput.placeholder = value === 'all' ? 'Search All...' : `Search ${text}...`;
                }
                
                dropdownOptions.querySelectorAll('.dropdown-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                this.classList.add('selected');
                
                filterDropdown.classList.remove('open');
            });
        });
        
        document.addEventListener('click', function(e) {
            if (!filterDropdown.contains(e.target)) {
                filterDropdown.classList.remove('open');
            }
        });
    }
    
    // ====================
    // Table Row Selection (Single select only)
    // ====================
    const tbody = document.getElementById('client-table-body');
    let selectedRow = null;
    let selectedClientId = null;

    if (tbody) {
        tbody.addEventListener('click', function(e) {
            const row = e.target.closest('tr');
            if (row && row.dataset.clientId && !row.classList.contains('no-data-row')) {
                // Remove selection from previous row
                if (selectedRow) {
                    selectedRow.classList.remove('selected');
                }
                
                // Select current row
                row.classList.add('selected');
                selectedRow = row;
                selectedClientId = row.dataset.clientId;
                enableActionButtons(true);
                updateActiveButtonState();
            }
        });
    }

    function enableActionButtons(enable) {
        const editBtn = document.getElementById('editClientBtn');
        const activeBtn = document.getElementById('activeClientBtn');
        const deleteBtn = document.getElementById('deleteClientBtn');
        const viewBtn = document.getElementById('viewClientBtn');
        const viewStaffBtn = document.getElementById('viewStaffBtn');
        
        // Action buttons are enabled when a row is selected
        if (editBtn) editBtn.disabled = !enable;
        if (activeBtn) activeBtn.disabled = !enable;
        if (deleteBtn) deleteBtn.disabled = !enable;
        if (viewBtn) viewBtn.disabled = !enable;
        if (viewStaffBtn) viewStaffBtn.disabled = !enable;
    }
    
    // ====================
    // Drawer Modal Logic
    // ====================
    const clientDrawer = document.getElementById('client-drawer');
    const closeClientDrawer = document.getElementById('closeClientDrawer');
    const cancelClientDrawer = document.getElementById('cancelClientDrawer');
    const clientForm = document.getElementById('clientForm');
    const drawerIcon = document.getElementById('drawerIcon');
    const drawerTitleText = document.getElementById('drawerTitleText');
    const submitClientBtn = document.getElementById('submitClientBtn');
    
    let currentMode = 'add'; // 'add', 'edit', 'view'
    
    function openDrawer(mode) {
        currentMode = mode;
        
        if (mode === 'add') {
            drawerIcon.className = 'fa-solid fa-user-plus';
            drawerTitleText.textContent = 'Add New Client';
            submitClientBtn.textContent = 'Add Client';
            submitClientBtn.style.display = 'inline-flex';
            clearForm();
            enableFormInputs(true);
        } else if (mode === 'edit') {
            drawerIcon.className = 'fa-solid fa-pen-to-square';
            drawerTitleText.textContent = 'Edit Client';
            submitClientBtn.textContent = 'Save Changes';
            submitClientBtn.style.display = 'inline-flex';
            populateFormFromRow();
            enableFormInputs(true);
        } else if (mode === 'view') {
            drawerIcon.className = 'fa-solid fa-eye';
            drawerTitleText.textContent = 'View Client Details';
            submitClientBtn.style.display = 'none';
            populateFormFromRow();
            enableFormInputs(false);
        }
        
        clientDrawer.classList.add('open');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
    
    function closeDrawer() {
        clientDrawer.classList.remove('open');
        document.body.style.overflow = ''; // Restore background scrolling
    }
    
    function clearForm() {
        document.getElementById('clientName').value = '';
        document.getElementById('clientAddress').value = '';
        document.getElementById('clientEmail').value = '';
        document.getElementById('clientPhone').value = '';
        
        // Reset profile preview
        const profilePreview = document.getElementById('profilePreview');
        profilePreview.innerHTML = '<i class="fa-solid fa-user"></i>';
        profilePreview.classList.remove('has-image');
        
        // Reset path display
        const profilePathDisplay = document.getElementById('clientProfilePath');
        if (profilePathDisplay) {
            profilePathDisplay.textContent = 'No image';
            profilePathDisplay.classList.remove('has-path', 'not-found');
            profilePathDisplay.classList.add('no-path');
        }
        
        // Reset all permission checkboxes to checked (default state)
        document.querySelectorAll('.permission-row input[type="checkbox"]').forEach(cb => cb.checked = true);
    }
    
    function populateForm(clientData) {
        if (!clientData) return;
        
        const nameInput = document.getElementById('clientName');
        const addressInput = document.getElementById('clientAddress');
        const emailInput = document.getElementById('clientEmail');
        const phoneInput = document.getElementById('clientPhone');
        
        if (nameInput) nameInput.value = clientData.name || '';
        if (addressInput) addressInput.value = clientData.address || '';
        if (emailInput) emailInput.value = clientData.email || '';
        if (phoneInput) phoneInput.value = clientData.phone || '';
        
        // Populate profile picture path display
        const profilePathDisplay = document.getElementById('clientProfilePath');
        const profilePreview = document.getElementById('profilePreview');
        if (clientData.profile_pic) {
            if (profilePathDisplay) {
                profilePathDisplay.textContent = clientData.profile_pic;
                profilePathDisplay.classList.remove('no-path', 'not-found');
                profilePathDisplay.classList.add('has-path');
            }
            if (profilePreview) {
                const img = document.createElement('img');
                img.src = clientData.profile_pic;
                img.alt = 'Profile';
                profilePreview.innerHTML = '';
                profilePreview.appendChild(img);
                profilePreview.classList.add('has-image');
            }
        }
        
        // Populate permissions (HTML IDs use underscores)
        const permissionFields = [
            'perm_idcard_client_list',
            'perm_idcard_setting_list', 'perm_idcard_setting_add', 'perm_idcard_setting_edit', 
            'perm_idcard_setting_delete', 'perm_idcard_setting_status',
            'perm_idcard_group_create', 'perm_idcard_group_delete',
            'perm_idcard_pending_list', 'perm_idcard_verified_list', 'perm_idcard_pool_list',
            'perm_idcard_approved_list', 'perm_idcard_download_list', 'perm_idcard_reprint_list',
            'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete', 'perm_idcard_info',
            'perm_idcard_approve', 'perm_idcard_verify', 'perm_idcard_bulk_upload', 
            'perm_idcard_bulk_download', 'perm_idcard_created_at', 'perm_idcard_updated_at',
            'perm_idcard_delete_from_pool', 'perm_delete_all_idcard', 'perm_reupload_idcard_image',
            'perm_idcard_retrieve'
        ];
        
        permissionFields.forEach(field => {
            const el = document.getElementById(field);
            if (el && clientData[field] !== undefined) {
                el.checked = clientData[field];
            }
        });
    }
    
    function getFormData() {
        const formData = {
            name: document.getElementById('clientName')?.value || '',
            address: document.getElementById('clientAddress')?.value || '',
            email: document.getElementById('clientEmail')?.value || '',
            phone: document.getElementById('clientPhone')?.value || '',
        };
        
        // Add password only if provided
        const passwordInput = document.getElementById('clientPassword');
        if (passwordInput && passwordInput.value) {
            formData.password = passwordInput.value;
        }
        
        // Collect permissions (HTML IDs use underscores)
        const permissionFields = [
            'perm_idcard_client_list',
            'perm_idcard_setting_list', 'perm_idcard_setting_add', 'perm_idcard_setting_edit', 
            'perm_idcard_setting_delete', 'perm_idcard_setting_status',
            'perm_idcard_group_create', 'perm_idcard_group_delete',
            'perm_idcard_pending_list', 'perm_idcard_verified_list', 'perm_idcard_pool_list',
            'perm_idcard_approved_list', 'perm_idcard_download_list', 'perm_idcard_reprint_list',
            'perm_idcard_add', 'perm_idcard_edit', 'perm_idcard_delete', 'perm_idcard_info',
            'perm_idcard_approve', 'perm_idcard_verify', 'perm_idcard_bulk_upload', 
            'perm_idcard_bulk_download', 'perm_idcard_created_at', 'perm_idcard_updated_at',
            'perm_idcard_delete_from_pool', 'perm_delete_all_idcard', 'perm_reupload_idcard_image',
            'perm_idcard_retrieve'
        ];
        
        permissionFields.forEach(field => {
            const el = document.getElementById(field);
            if (el) {
                formData[field] = el.checked;
            }
        });
        
        return formData;
    }
    
    function enableFormInputs(enable) {
        const inputs = clientDrawer.querySelectorAll('input, select, textarea');
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
    }
    
    // Add button - opens drawer in add mode (no selection needed)
    const addClientBtn = document.getElementById('addClientBtn');
    if (addClientBtn) {
        addClientBtn.addEventListener('click', function() {
            openDrawer('add');
        });
    }
    
    // Edit button - opens drawer in edit mode
    const editClientBtn = document.getElementById('editClientBtn');
    if (editClientBtn) {
        editClientBtn.addEventListener('click', async function() {
            if (!selectedClientId) return;
            const clientData = await fetchClientDetails(selectedClientId);
            if (clientData) {
                openDrawer('edit');
                populateForm(clientData);
            }
        });
    }
    
    // View button - opens drawer in view mode
    const viewClientBtn = document.getElementById('viewClientBtn');
    if (viewClientBtn) {
        viewClientBtn.addEventListener('click', async function() {
            if (!selectedClientId) return;
            const clientData = await fetchClientDetails(selectedClientId);
            if (clientData) {
                openDrawer('view');
                populateForm(clientData);
            }
        });
    }
    
    // Close drawer events
    if (closeClientDrawer) {
        closeClientDrawer.addEventListener('click', closeDrawer);
    }
    if (cancelClientDrawer) {
        cancelClientDrawer.addEventListener('click', function(e) {
            e.preventDefault();
            closeDrawer();
        });
    }
    
    // Form submission
    if (clientForm) {
        clientForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Prevent double submission
            const submitBtn = clientForm.querySelector('button[type="submit"]');
            if (submitBtn.disabled) return;
            submitBtn.disabled = true;
            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
            
            const formData = getFormData();
            let result;
            
            try {
                if (currentMode === 'edit' && selectedClientId) {
                    result = await updateClient(selectedClientId, formData);
                } else if (currentMode === 'add') {
                    result = await createClient(formData);
                }
                
                if (result && result.success) {
                    showToast(result.message, 'success');
                    closeDrawer();
                    setTimeout(() => location.reload(), 500);
                } else {
                    showToast(result?.message || 'Operation failed', 'error');
                    // Re-enable button on error
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
    
    // ====================
    // Profile Picture Upload Preview
    // ====================
    const profilePicInput = document.getElementById('clientProfilePic');
    const profilePreview = document.getElementById('profilePreview');
    const profilePathDisplay = document.getElementById('clientProfilePath');
    
    if (profilePicInput && profilePreview) {
        profilePicInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    profilePreview.innerHTML = `<img src="${event.target.result}" alt="Profile" style="width: 100%; height: 100%; object-fit: cover;">`;
                    profilePreview.classList.add('has-image');
                    // Update path display
                    if (profilePathDisplay) {
                        profilePathDisplay.textContent = file.name;
                        profilePathDisplay.classList.remove('no-path', 'not-found');
                        profilePathDisplay.classList.add('has-path');
                    }
                };
                reader.onerror = function(error) {
                    console.error('FileReader error:', error);
                };
                reader.readAsDataURL(file);
            }
        });
    }
    
    // ====================
    // Active/Inactive Toggle Button
    // ====================
    const activeClientBtn = document.getElementById('activeClientBtn');
    
    function updateActiveButtonState() {
        if (!selectedRow || !activeClientBtn) return;
        
        const statusBadge = selectedRow.querySelector('.status-badge');
        const isActive = statusBadge && statusBadge.classList.contains('active');
        
        if (isActive) {
            // Client is active, button should offer to deactivate (show red)
            activeClientBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Deactivate';
            activeClientBtn.classList.remove('btn-active');
            activeClientBtn.classList.add('btn-inactive');
        } else {
            // Client is inactive, button should offer to activate (show green)
            activeClientBtn.innerHTML = '<i class="fa-solid fa-check"></i> Activate';
            activeClientBtn.classList.remove('btn-inactive');
            activeClientBtn.classList.add('btn-active');
        }
    }
    
    if (activeClientBtn) {
        activeClientBtn.addEventListener('click', async function() {
            if (!selectedClientId) return;
            
            const result = await toggleClientStatus(selectedClientId);
            
            if (result.success) {
                showToast(result.message, 'success');
                
                // Update UI
                const statusBadge = selectedRow.querySelector('.status-badge');
                if (statusBadge) {
                    if (result.status === 'active') {
                        statusBadge.classList.remove('inactive');
                        statusBadge.classList.add('active');
                        statusBadge.textContent = 'Active';
                    } else {
                        statusBadge.classList.remove('active');
                        statusBadge.classList.add('inactive');
                        statusBadge.textContent = 'Inactive';
                    }
                }
                updateActiveButtonState();
            } else {
                showToast(result.message || 'Failed to update status', 'error');
            }
        });
    }
    
    // ====================
    // Delete Button
    // ====================
    const deleteClientBtn = document.getElementById('deleteClientBtn');
    if (deleteClientBtn) {
        deleteClientBtn.addEventListener('click', async function() {
            if (!selectedClientId || !selectedRow) return;
            
            const clientName = selectedRow.querySelector('td').textContent;
            if (confirm(`Are you sure you want to delete "${clientName}"?`)) {
                const result = await deleteClientApi(selectedClientId);
                
                if (result.success) {
                    showToast(result.message, 'success');
                    selectedRow.remove();
                    selectedRow = null;
                    selectedClientId = null;
                    enableActionButtons(false);
                } else {
                    showToast(result.message || 'Failed to delete client', 'error');
                }
            }
        });
    }
    
    // ====================
    // View Staff Drawer
    // ====================
    const viewStaffDrawer = document.getElementById('viewStaffDrawer');
    const viewStaffBtn = document.getElementById('viewStaffBtn');
    const closeStaffDrawer = document.getElementById('closeStaffDrawer');
    const closeStaffDrawerBtn = document.getElementById('closeStaffDrawerBtn');
    const staffClientName = document.getElementById('staffClientName');
    const staffList = document.getElementById('staffList');
    const noStaffMessage = document.getElementById('noStaffMessage');
    const totalStaffCount = document.getElementById('totalStaffCount');
    const activeStaffCount = document.getElementById('activeStaffCount');
    const inactiveStaffCount = document.getElementById('inactiveStaffCount');
    
    async function openStaffDrawer() {
        if (!selectedClientId || !selectedRow) return;
        
        const clientName = selectedRow.querySelector('td').textContent;
        if (staffClientName) staffClientName.textContent = clientName;
        
        const result = await fetchClientStaff(selectedClientId);
        
        if (result.success) {
            const staffData = result.staff || [];
            
            // Update summary counts
            if (totalStaffCount) totalStaffCount.textContent = result.total_count || staffData.length;
            if (activeStaffCount) activeStaffCount.textContent = result.active_count || 0;
            if (inactiveStaffCount) inactiveStaffCount.textContent = result.inactive_count || 0;
            
            if (staffData.length === 0) {
                if (staffList) staffList.style.display = 'none';
                if (noStaffMessage) noStaffMessage.style.display = 'flex';
            } else {
                if (staffList) staffList.style.display = 'flex';
                if (noStaffMessage) noStaffMessage.style.display = 'none';
                
                if (staffList) {
                    const esc = window.escapeHtml || ((s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; });
                    staffList.innerHTML = staffData.map(staff => `
                        <div class="staff-card">
                            <div class="staff-card-header">
                                <div class="staff-avatar ${esc(staff.status)}">
                                    <i class="fa-solid fa-user"></i>
                                </div>
                                <div class="staff-main-info">
                                    <div class="staff-name">${esc(staff.name)}</div>
                                    <div class="staff-role">${esc(staff.role || 'Staff')}</div>
                                </div>
                                <span class="staff-status-badge ${esc(staff.status)}">${staff.status === 'active' ? 'Active' : 'Inactive'}</span>
                            </div>
                            <div class="staff-card-body">
                                <div class="staff-detail-row">
                                    <div class="staff-detail">
                                        <i class="fa-solid fa-envelope"></i>
                                        <span>${esc(staff.email || 'N/A')}</span>
                                    </div>
                                    <div class="staff-detail">
                                        <i class="fa-solid fa-phone"></i>
                                        <span>${esc(staff.phone || 'N/A')}</span>
                                    </div>
                                </div>
                                <div class="staff-detail-row">
                                    <div class="staff-detail">
                                        <i class="fa-solid fa-calendar-plus"></i>
                                        <span>Created: ${esc(staff.created_at || 'N/A')}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('');
                }
            }
        } else {
            showToast(result.message || 'Failed to load staff', 'error');
            if (staffList) staffList.style.display = 'none';
            if (noStaffMessage) noStaffMessage.style.display = 'flex';
        }
        
        if (viewStaffDrawer) {
            viewStaffDrawer.classList.add('open');
            document.body.style.overflow = 'hidden';
        }
    }
    
    function closeStaffDrawerFn() {
        if (viewStaffDrawer) {
            viewStaffDrawer.classList.remove('open');
            document.body.style.overflow = '';
        }
    }
    
    if (viewStaffBtn) {
        viewStaffBtn.addEventListener('click', openStaffDrawer);
    }
    if (closeStaffDrawer) {
        closeStaffDrawer.addEventListener('click', closeStaffDrawerFn);
    }
    if (closeStaffDrawerBtn) {
        closeStaffDrawerBtn.addEventListener('click', closeStaffDrawerFn);
    }
    
    // Close drawer on overlay click
    if (viewStaffDrawer) {
        viewStaffDrawer.addEventListener('click', function(e) {
            if (e.target === viewStaffDrawer) {
                closeStaffDrawerFn();
            }
        });
    }
});
