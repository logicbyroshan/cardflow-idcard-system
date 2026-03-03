// Manage Staff Page — API calls and temp password functions
// Split from manage-staff.js — loaded second

document.addEventListener('DOMContentLoaded', function() {
    var NS = window.ManageStaffPage;

    // ==================== API CALLS ====================
    NS.fetchStaffDetails = async function(staffId) {
        try {
            var data = await ApiClient.get('/api/staff/' + staffId + '/');
            if (data.success) {
                return data.staff;
            } else {
                showToast(data.message || 'Failed to fetch staff details', 'error');
                return null;
            }
        } catch (error) {
            var msg = (error && error.message) ? error.message : 'Network error. Please try again.';
            showToast(msg, 'error');
            return null;
        }
    };
    
    NS.createStaff = async function(formData) {
        try {
            // Phase 1: File upload removed - always use JSON
            var data = await ApiClient.post('/api/staff/create/', formData);
            return data;
        } catch (error) {
            // Preserve server error message if available
            if (error && error.data && typeof error.data === 'object') return error.data;
            var msg = (error && error.message) ? error.message : 'Network error. Please try again.';
            return { success: false, message: msg };
        }
    };
    
    NS.updateStaff = async function(staffId, formData) {
        try {
            // Phase 1: File upload removed - always use JSON
            var data = await ApiClient.post('/api/staff/' + staffId + '/update/', formData);
            return data;
        } catch (error) {
            if (error && error.data && typeof error.data === 'object') return error.data;
            var msg = (error && error.message) ? error.message : 'Network error. Please try again.';
            return { success: false, message: msg };
        }
    };
    
    NS.deleteStaffApi = async function(staffId) {
        try {
            var data = await ApiClient.post('/api/staff/' + staffId + '/delete/');
            return data;
        } catch (error) {
            if (error && error.data && typeof error.data === 'object') return error.data;
            var msg = (error && error.message) ? error.message : 'Network error. Please try again.';
            return { success: false, message: msg };
        }
    };
    
    NS.toggleStaffStatus = async function(staffId) {
        try {
            var data = await ApiClient.post('/api/staff/' + staffId + '/toggle-status/');
            return data;
        } catch (error) {
            if (error && error.data && typeof error.data === 'object') return error.data;
            var msg = (error && error.message) ? error.message : 'Network error. Please try again.';
            return { success: false, message: msg };
        }
    };

    // ==================== TEMP PASSWORD FUNCTIONS ====================
    var tempPwVerificationCode = '';
    var tempPwTargetType = 'staff';
    var tempPwTargetId = null;
    var tempPwTargetName = '';

    window.openTempPasswordModal = function(type) {
        tempPwTargetType = type || 'staff';
        tempPwTargetId = NS.selectedStaffId;
        tempPwTargetName = document.getElementById('staff-name')?.value || 'this user';

        if (!tempPwTargetId) {
            showToast('No staff selected', 'error');
            return;
        }

        tempPwVerificationCode = String(Math.floor(100000 + Math.random() * 900000));

        var modal = document.getElementById('temp-password-modal');
        document.getElementById('tempPwStep1').style.display = '';
        document.getElementById('tempPwStep2').style.display = 'none';
        document.getElementById('tempPwVerifyCode').textContent = tempPwVerificationCode;
        document.getElementById('tempPwCodeInput').value = '';
        document.getElementById('tempPwCodeError').style.display = 'none';
        document.getElementById('tempPwNewPassword').value = '';
        document.getElementById('tempPwError').style.display = 'none';
        document.getElementById('tempPwUserName').textContent = tempPwTargetName;

        modal.style.display = 'flex';
    };

    window.closeTempPasswordModal = function() {
        document.getElementById('temp-password-modal').style.display = 'none';
        tempPwVerificationCode = '';
        tempPwTargetId = null;
    };

    window.verifyTempPwCode = function() {
        var input = document.getElementById('tempPwCodeInput').value.trim();
        var errEl = document.getElementById('tempPwCodeError');
        if (input === tempPwVerificationCode) {
            errEl.style.display = 'none';
            document.getElementById('tempPwStep1').style.display = 'none';
            document.getElementById('tempPwStep2').style.display = '';
            document.getElementById('tempPwNewPassword').focus();
        } else {
            errEl.style.display = '';
        }
    };

    window.toggleTempPwVisibility = function() {
        var pwInput = document.getElementById('tempPwNewPassword');
        var eyeIcon = document.getElementById('tempPwEyeIcon');
        if (pwInput.type === 'password') {
            pwInput.type = 'text';
            eyeIcon.className = 'fa-solid fa-eye-slash';
        } else {
            pwInput.type = 'password';
            eyeIcon.className = 'fa-solid fa-eye';
        }
    };

    window.saveTempPassword = async function() {
        var password = document.getElementById('tempPwNewPassword').value;
        var errEl = document.getElementById('tempPwError');
        if (!password || password.length < 6) {
            errEl.style.display = '';
            return;
        }
        errEl.style.display = 'none';

        var saveBtn = document.getElementById('tempPwSaveBtn');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        try {
            var url = '/api/staff/' + tempPwTargetId + '/set-temp-password/';
            var result = await ApiClient.post(url, { password: password });
            if (result.success) {
                closeTempPasswordModal();
                showToast(result.message || 'Temporary password set successfully!', 'success');
            } else {
                showToast(result.message || 'Failed to set password', 'error');
            }
        } catch (err) {
            showToast('Network error. Please try again.', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Save Password';
        }
    };
});
