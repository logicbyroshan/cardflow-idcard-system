/**
 * Manage Client Page — API calls and temp password functions
 * Split from manage-client.js — loaded second
 */
document.addEventListener('DOMContentLoaded', function() {
      var NS = window.ManageClientPage;

      // ==================== API CALLS ====================
      NS.fetchClientDetails = async function(clientId) {
        try {
          var data = await ApiClient.get('/api/client/' + clientId + '/');
          if (data.success) {
            return data.client;
          } else {
            showToast(data.message || 'Failed to fetch client details', 'error');
            return null;
          }
        } catch (error) {
          showToast(error && error.message ? error.message : 'Network error. Please try again.', 'error');
          return null;
        }
      };
      
      NS.createClient = async function(formData, file) {
        if (file === undefined) file = null;
        try {
          // Use FormData if there's a file to upload
          if (file) {
            var data = new FormData();
            data.append('photo', file);
            // Add all other form fields
            Object.keys(formData).forEach(function(key) {
              data.append(key, typeof formData[key] === 'boolean' ? (formData[key] ? 'true' : 'false') : formData[key]);
            });
            return await ApiClient.upload('/api/client/create/', data);
          } else {
            return await ApiClient.post('/api/client/create/', formData);
          }
        } catch (error) {
          // If the server returned a structured error (from XHR upload or fetch), pass it through
          if (error && error.data && typeof error.data === 'object') return error.data;
          return { success: false, message: error && error.message ? error.message : 'Network error. Please try again.' };
        }
      };
      
      NS.updateClient = async function(clientId, formData, file) {
        if (file === undefined) file = null;
        try {
          // Use FormData if there's a file to upload
          if (file) {
            var data = new FormData();
            data.append('photo', file);
            // Add all other form fields
            Object.keys(formData).forEach(function(key) {
              data.append(key, typeof formData[key] === 'boolean' ? (formData[key] ? 'true' : 'false') : formData[key]);
            });
            return await ApiClient.upload('/api/client/' + clientId + '/update/', data);
          } else {
            return await ApiClient.post('/api/client/' + clientId + '/update/', formData);
          }
        } catch (error) {
          if (error && error.data && typeof error.data === 'object') return error.data;
          return { success: false, message: error && error.message ? error.message : 'Network error. Please try again.' };
        }
      };
      
      NS.deleteClientApi = async function(clientId) {
        try {
          return await ApiClient.post('/api/client/' + clientId + '/delete/', {});
        } catch (error) {
          if (error && error.data && typeof error.data === 'object') return error.data;
          return { success: false, message: error && error.message ? error.message : 'Network error. Please try again.' };
        }
      };
      
      NS.toggleClientStatus = async function(clientId) {
        try {
          return await ApiClient.post('/api/client/' + clientId + '/toggle-status/', {});
        } catch (error) {
          if (error && error.data && typeof error.data === 'object') return error.data;
          return { success: false, message: error && error.message ? error.message : 'Network error. Please try again.' };
        }
      };

      // ==================== TEMP PASSWORD FUNCTIONS ====================
      var tempPwVerificationCode = '';
      var tempPwTargetType = ''; // 'client' or 'staff'
      var tempPwTargetId = null;
      var tempPwTargetName = '';

      window.openTempPasswordModal = function(type) {
        tempPwTargetType = type || 'client';

        if (tempPwTargetType === 'staff') {
          // Client-staff drawer: get staff ID from the shared module
          tempPwTargetId = window._staffPageMgr ? window._staffPageMgr.getSelectedStaffId() : null;
          tempPwTargetName = document.getElementById('staff-name')?.value || 'this staff';
        } else {
          tempPwTargetId = NS.selectedClientId;
          tempPwTargetName = document.getElementById('clientName')?.value || 'this user';
        }

        if (!tempPwTargetId) {
          showToast('No user selected', 'error');
          return;
        }

        // Generate random 6-digit code
        tempPwVerificationCode = String(Math.floor(100000 + Math.random() * 900000));

        // Reset modal to step 1
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
          var url = tempPwTargetType === 'staff'
            ? '/api/staff/' + tempPwTargetId + '/set-temp-password/'
            : '/api/client/' + tempPwTargetId + '/set-temp-password/';

          var result = await ApiClient.post(url, { password: password });
          if (result.success) {
            closeTempPasswordModal();
            showToast(result.message || 'Temporary password set successfully!', 'success');
          } else {
            showToast(result.message || 'Failed to set password', 'error');
          }
        } catch (err) {
          showToast(err && err.message ? err.message : 'Network error. Please try again.', 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Save Password';
        }
      };
});
