const API_BASE = '/staff/api';
let availablePermissions = [];
let availableClients = [];
let confirmAction = null;
let _staffFormStep = 1;

// Permission categories
const PERMISSION_CATEGORIES = {
  client: ['can_view_clients', 'can_add_clients', 'can_edit_clients', 'can_delete_clients', 'can_toggle_client_status'],
  idcard: ['can_view_idcard_data', 'can_add_idcard_data', 'can_edit_idcard_data', 'can_delete_idcard_data', 'can_verify_idcard', 'can_approve_idcard'],
  settings: ['can_view_idcard_settings', 'can_add_idcard_settings', 'can_edit_idcard_settings', 'can_delete_idcard_settings', 'can_upload_images', 'can_reupload_images', 'can_bulk_upload', 'can_bulk_download', 'can_export_data', 'can_download_cards', 'can_view_workflow', 'can_manage_workflow']
};

// CSRF token  use centralized ApiClient.getCSRFToken()
function getCSRFToken() {
  return ApiClient.getCSRFToken();
}

// Show alert
function showAlert(message, type = 'success') {
  const container = document.getElementById('alertContainer');
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
  setTimeout(() => container.innerHTML = '', 5000);
}

// Load available permissions
async function loadPermissions() {
  try {
    const data = await ApiClient.get(`${API_BASE}/permissions/available/`);
    if (data.success) {
      availablePermissions = data.permissions;
      renderPermissionCheckboxes();
    }
  } catch (error) {
    console.error('Error loading permissions:', error);
  }
}

// Load available clients
async function loadClients() {
  try {
    const data = await ApiClient.get(`${API_BASE}/clients/available/`);
    if (data.success) {
      availableClients = data.clients;
      renderClientCheckboxes();
    }
  } catch (error) {
    console.error('Error loading clients:', error);
  }
}

// Render permission checkboxes
function renderPermissionCheckboxes() {
  const containers = {
    client: document.getElementById('clientPermissions'),
    idcard: document.getElementById('idcardPermissions'),
    settings: document.getElementById('settingsPermissions')
  };

  Object.values(containers).forEach(c => c.innerHTML = '');

  availablePermissions.forEach(perm => {
    let category = 'settings';
    for (const [cat, codes] of Object.entries(PERMISSION_CATEGORIES)) {
      if (codes.includes(perm.codename)) {
        category = cat;
        break;
      }
    }

    const html = `
      <label class="permission-item">
        <input type="checkbox" name="permissions" value="${perm.codename}">
        ${perm.name.replace('Can ', '')}
      </label>
    `;
    if (containers[category]) {
      containers[category].innerHTML += html;
    }
  });
}

// Render client checkboxes
function renderClientCheckboxes() {
  const container = document.getElementById('clientsContainer');
  container.innerHTML = availableClients.map(client => `
    <label class="client-item">
      <input type="checkbox" name="clients" value="${client.id}">
      ${client.name}
    </label>
  `).join('');
}

// Load staff list
async function loadStaff() {
  try {
    const data = await ApiClient.get(`${API_BASE}/admin-staff/`);
    
    const tbody = document.getElementById('staffTableBody');
    
    if (!data.success || data.staff.length === 0) {
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="7">
            <div class="empty-state">
              <i class="fa-solid fa-users-gear"></i>
              <p>No operator yet. Click "Add Operator" to create one.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data.staff.map(staff => `
      <tr>
        <td>${staff.name}</td>
        <td>${staff.email}</td>
        <td>${staff.designation || '-'}</td>
        <td>
          <div class="client-badges">
            ${staff.assigned_clients.slice(0, 3).map(c => `<span class="client-badge">${c.name}</span>`).join('')}
            ${staff.assigned_clients.length > 3 ? `<span class="client-badge">+${staff.assigned_clients.length - 3}</span>` : ''}
          </div>
        </td>
        <td>
          <span class="staff-badge ${staff.is_active ? 'badge-active' : 'badge-inactive'}">
            ${staff.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td>${staff.permissions_count} permissions</td>
        <td>
          <div class="staff-actions">
            <button class="btn btn-icon" onclick="editStaff(${staff.id})" title="Edit" aria-label="Edit">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn btn-icon" onclick="toggleStatus(${staff.id})" title="${staff.is_active ? 'Deactivate' : 'Activate'}" aria-label="${staff.is_active ? 'Deactivate' : 'Activate'}">
              <i class="fa-solid fa-${staff.is_active ? 'ban' : 'check'}"></i>
            </button>
            <button class="btn btn-icon" onclick="confirmResetPassword(${staff.id}, '${staff.name}')" title="Reset Password" aria-label="Reset Password">
              <i class="fa-solid fa-key"></i>
            </button>
            <button class="btn btn-icon danger" onclick="confirmDelete(${staff.id}, '${staff.name}')" title="Delete" aria-label="Delete">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error loading staff:', error);
    showAlert('Error loading staff list', 'error');
  }
}

function setStaffFormStep(step) {
  _staffFormStep = step === 2 ? 2 : 1;
  const isAccessStep = _staffFormStep === 2;

  const step1Panel = document.getElementById('staffStep1Panel');
  const step2Panel = document.getElementById('staffStep2Panel');
  const step1Badge = document.getElementById('staffStep1Badge');
  const step2Badge = document.getElementById('staffStep2Badge');
  const backBtn = document.getElementById('staffStepBackBtn');
  const nextBtn = document.getElementById('staffStepNextBtn');
  const submitBtn = document.getElementById('submitBtn');

  if (step1Panel) step1Panel.style.display = isAccessStep ? 'none' : 'block';
  if (step2Panel) step2Panel.style.display = isAccessStep ? 'block' : 'none';
  if (step1Badge) step1Badge.classList.add('is-active');
  if (step2Badge) step2Badge.classList.toggle('is-active', isAccessStep);
  if (backBtn) backBtn.style.display = isAccessStep ? 'inline-flex' : 'none';
  if (nextBtn) nextBtn.style.display = isAccessStep ? 'none' : 'inline-flex';
  if (submitBtn) submitBtn.style.display = isAccessStep ? 'inline-flex' : 'none';
}

function _validateStaffStepOne() {
  const requiredFieldIds = ['firstName', 'lastName', 'email'];
  for (const fieldId of requiredFieldIds) {
    const field = document.getElementById(fieldId);
    if (!field) continue;
    if (!String(field.value || '').trim()) {
      field.focus();
      showAlert('Fill all required basic details before continuing.', 'error');
      return false;
    }
    if (fieldId === 'email' && !field.disabled && !field.checkValidity()) {
      field.focus();
      showAlert('Enter a valid email before continuing.', 'error');
      return false;
    }
  }
  return true;
}

function _bindStaffWizardControls() {
  const nextBtn = document.getElementById('staffStepNextBtn');
  const backBtn = document.getElementById('staffStepBackBtn');

  if (nextBtn && !nextBtn.dataset.wizardBound) {
    nextBtn.dataset.wizardBound = '1';
    nextBtn.addEventListener('click', function () {
      if (!_validateStaffStepOne()) return;
      setStaffFormStep(2);
    });
  }

  if (backBtn && !backBtn.dataset.wizardBound) {
    backBtn.dataset.wizardBound = '1';
    backBtn.addEventListener('click', function () {
      setStaffFormStep(1);
    });
  }
}

// Open create modal
function openCreateModal() {
  document.getElementById('modalTitle').textContent = 'Add Operator';
  document.getElementById('submitBtn').textContent = 'Create Staff';
  document.getElementById('staffId').value = '';
  document.getElementById('staffForm').reset();
  document.getElementById('email').removeAttribute('disabled');
  _bindStaffWizardControls();
  setStaffFormStep(1);
  document.querySelectorAll('input[name="permissions"]').forEach(cb => cb.checked = false);
  document.querySelectorAll('input[name="clients"]').forEach(cb => cb.checked = false);
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
    window.AdarshModalBridge.open('staffModal', { overlayClass: 'show' });
  } else {
    document.getElementById('staffModal').classList.add('show');
  }
}

// Edit staff
async function editStaff(id) {
  try {
    const data = await ApiClient.get(`${API_BASE}/admin-staff/${id}/`);
    
    if (data.success) {
      _bindStaffWizardControls();
      setStaffFormStep(1);
      const staff = data.staff;
      document.getElementById('modalTitle').textContent = 'Edit Operator';
      document.getElementById('submitBtn').textContent = 'Update Staff';
      document.getElementById('staffId').value = staff.id;
      document.getElementById('firstName').value = staff.first_name;
      document.getElementById('lastName').value = staff.last_name;
      document.getElementById('email').value = staff.email;
      document.getElementById('email').setAttribute('disabled', 'disabled');
      document.getElementById('phone').value = staff.phone || '';
      document.getElementById('designation').value = staff.designation || '';
      document.getElementById('department').value = staff.department || '';
      
      // Set permissions
      document.querySelectorAll('input[name="permissions"]').forEach(cb => {
        cb.checked = staff.permissions.includes(cb.value);
      });
      
      // Set clients
      const clientIds = staff.assigned_clients.map(c => c.id);
      document.querySelectorAll('input[name="clients"]').forEach(cb => {
        cb.checked = clientIds.includes(parseInt(cb.value));
      });
      
      if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
        window.AdarshModalBridge.open('staffModal', { overlayClass: 'show' });
      } else {
        document.getElementById('staffModal').classList.add('show');
      }
    }
  } catch (error) {
    console.error('Error loading staff details:', error);
    showAlert('Error loading staff details', 'error');
  }
}

// Close modal
function closeModal() {
  setStaffFormStep(1);
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
    window.AdarshModalBridge.close('staffModal', { overlayClass: 'show' });
  } else {
    document.getElementById('staffModal').classList.remove('show');
  }
}

// Handle form submit
async function handleSubmit(event) {
  event.preventDefault();
  
  const staffId = document.getElementById('staffId').value;
  const isEdit = !!staffId;
  if (_staffFormStep !== 2) {
    if (!_validateStaffStepOne()) return;
    setStaffFormStep(2);
    return;
  }
  
  const permissions = Array.from(document.querySelectorAll('input[name="permissions"]:checked'))
    .map(cb => cb.value);
  
  const clients = Array.from(document.querySelectorAll('input[name="clients"]:checked'))
    .map(cb => parseInt(cb.value));
  
  const formData = {
    first_name: document.getElementById('firstName').value,
    last_name: document.getElementById('lastName').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    designation: document.getElementById('designation').value,
    department: document.getElementById('department').value,
    permissions: permissions,
    assigned_clients: clients
  };
  
  try {
    const url = isEdit ? `${API_BASE}/admin-staff/${staffId}/` : `${API_BASE}/admin-staff/`;
    const method = isEdit ? 'PUT' : 'POST';
    
    const data = await (method === 'PUT' 
      ? ApiClient.put(url, formData) 
      : ApiClient.post(url, formData));
    
    if (data.success) {
      showAlert(data.message);
      closeModal();
      loadStaff();
    } else {
      showAlert(data.error || 'Operation failed', 'error');
    }
  } catch (error) {
    console.error('Error saving staff:', error);
    showAlert('Error saving staff', 'error');
  }
}

// Toggle staff status
async function toggleStatus(id) {
  try {
    const data = await ApiClient.post(`${API_BASE}/admin-staff/${id}/toggle-status/`, {});
    
    if (data.success) {
      showAlert(data.message);
      loadStaff();
    } else {
      showAlert(data.error || 'Failed to toggle status', 'error');
    }
  } catch (error) {
    console.error('Error toggling status:', error);
    showAlert('Error toggling status', 'error');
  }
}

// Confirm modal
function openConfirmModal(title, message, action) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  confirmAction = action;
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
    window.AdarshModalBridge.open('confirmModal', { overlayClass: 'show', focusSelector: '#confirmActionBtn' });
  } else {
    document.getElementById('confirmModal').classList.add('show');
  }
}

function closeConfirmModal() {
  if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
    window.AdarshModalBridge.close('confirmModal', { overlayClass: 'show' });
  } else {
    document.getElementById('confirmModal').classList.remove('show');
  }
  confirmAction = null;
}

function executeConfirmAction() {
  if (confirmAction) confirmAction();
  closeConfirmModal();
}

// Confirm delete
function confirmDelete(id, name) {
  openConfirmModal(
    'Delete Operator',
    `Are you sure you want to delete "${name}"? This cannot be undone.`,
    async () => {
      try {
        const data = await ApiClient.delete(`${API_BASE}/admin-staff/${id}/`);
        if (data.success) {
          showAlert(data.message);
          loadStaff();
        } else {
          showAlert(data.error || 'Failed to delete', 'error');
        }
      } catch (error) {
        showAlert('Error deleting staff', 'error');
      }
    }
  );
}

// Confirm reset password
function confirmResetPassword(id, name) {
  openConfirmModal(
    'Reset Password',
    `Reset password for "${name}"? A new password will be sent to their email.`,
    async () => {
      try {
        const data = await ApiClient.post(`${API_BASE}/admin-staff/${id}/reset-password/`, {});
        if (data.success) {
          showAlert(data.message);
        } else {
          showAlert(data.error || 'Failed to reset password', 'error');
        }
      } catch (error) {
        showAlert('Error resetting password', 'error');
      }
    }
  );
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadPermissions();
  loadClients();
  loadStaff();
  _bindStaffWizardControls();
  setStaffFormStep(1);
});
