/**
 * Manage Client Page  API calls and temp password functions
 * Split from manage-client.js  loaded second
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

      NS.fetchClientMessages = async function(clientId) {
        try {
          return await ApiClient.get('/api/client/' + clientId + '/messages/');
        } catch (error) {
          if (error && error.data && typeof error.data === 'object') return error.data;
          return { success: false, message: error && error.message ? error.message : 'Network error. Please try again.' };
        }
      };

      NS.sendClientMessage = async function(clientId, payload) {
        try {
          return await ApiClient.post('/api/client/' + clientId + '/messages/send/', payload);
        } catch (error) {
          if (error && error.data && typeof error.data === 'object') return error.data;
          return { success: false, message: error && error.message ? error.message : 'Network error. Please try again.' };
        }
      };

      NS.deleteClientMessage = async function(clientId, messageId) {
        try {
          return await ApiClient.post('/api/client/' + clientId + '/messages/' + messageId + '/delete/', {});
        } catch (error) {
          if (error && error.data && typeof error.data === 'object') return error.data;
          return { success: false, message: error && error.message ? error.message : 'Network error. Please try again.' };
        }
      };

      NS.fetchClientMessageTargets = async function(queryText) {
        var query = encodeURIComponent((queryText || '').trim());
        var url = '/api/client/messages/targets/?limit=800';
        if (query) url += '&q=' + query;
        try {
          return await ApiClient.get(url);
        } catch (error) {
          if (error && error.data && typeof error.data === 'object') return error.data;
          return { success: false, message: error && error.message ? error.message : 'Network error. Please try again.' };
        }
      };

      NS.sendClientGroupMessage = async function(payload) {
        try {
          return await ApiClient.post('/api/client/messages/group-send/', payload);
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

        // Generate random 10-digit code
        tempPwVerificationCode = (typeof ConfirmationCode !== 'undefined') ? ConfirmationCode.generate() : String(Math.floor(1000000000 + Math.random() * 9000000000));

        // Reset modal to step 1
        var modal = document.getElementById('temp-password-modal');
        document.getElementById('tempPwStep1').style.display = '';
        document.getElementById('tempPwStep2').style.display = 'none';
        document.getElementById('tempPwVerifyCode').textContent = tempPwVerificationCode;
        document.getElementById('tempPwCodeInput').value = '';
        if (typeof window.renderTempPwCodeBoxes === 'function') window.renderTempPwCodeBoxes('');
        if (typeof window.setTempPwCodeState === 'function') window.setTempPwCodeState('');
        document.getElementById('tempPwCodeError').style.display = 'none';
        document.getElementById('tempPwNewPassword').value = '';
        document.getElementById('tempPwError').style.display = 'none';
        document.getElementById('tempPwUserName').textContent = tempPwTargetName;

        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
          window.AdarshModalBridge.open('temp-password-modal', { overlayClass: 'show' });
        } else {
          modal.style.display = 'flex';
        }
      };

      window.closeTempPasswordModal = function() {
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
          window.AdarshModalBridge.close('temp-password-modal', { overlayClass: 'show' });
        } else {
          document.getElementById('temp-password-modal').style.display = 'none';
        }
        tempPwVerificationCode = '';
        tempPwTargetId = null;
        if (typeof window.setTempPwCodeState === 'function') window.setTempPwCodeState('');
      };

      window.verifyTempPwCode = function() {
        var codeInputEl = document.getElementById('tempPwCodeInput');
        var input = (codeInputEl ? codeInputEl.value : '').replace(/\D/g, '').slice(0, 10);
        if (codeInputEl) codeInputEl.value = input;
        if (typeof window.renderTempPwCodeBoxes === 'function') window.renderTempPwCodeBoxes(input);
        var errEl = document.getElementById('tempPwCodeError');
        if (input === tempPwVerificationCode) {
          if (typeof window.setTempPwCodeState === 'function') window.setTempPwCodeState('is-valid');
          errEl.style.display = 'none';
          document.getElementById('tempPwStep1').style.display = 'none';
          document.getElementById('tempPwStep2').style.display = '';
          document.getElementById('tempPwNewPassword').focus();
        } else {
          if (typeof window.setTempPwCodeState === 'function') window.setTempPwCodeState(input.length === 10 ? 'is-invalid' : '');
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
