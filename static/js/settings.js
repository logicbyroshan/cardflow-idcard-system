// Settings Page JavaScript - With API Integration

document.addEventListener('DOMContentLoaded', function() {
    // Load profile data on page load
    loadProfile();
    
    // ===== Avatar Upload =====
    const avatarUpload = document.getElementById('avatarUpload');
    const profileAvatar = document.getElementById('profileAvatar');

    if (avatarUpload) {
        avatarUpload.addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (file) {
                // Validate file type
                const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                if (!allowedTypes.includes(file.type)) {
                    showToast('Invalid file type. Please use JPEG, PNG, GIF, or WebP.', 'error');
                    return;
                }
                
                // Validate file size (5MB max)
                if (file.size > 5 * 1024 * 1024) {
                    showToast('File size too large. Maximum 5MB allowed.', 'error');
                    return;
                }
                
                // Upload to server
                const formData = new FormData();
                formData.append('profile_image', file);
                
                try {
                    const data = await ApiClient.upload('/panel/api/profile/upload-image/', formData);
                    
                    if (data.success) {
                        // Update avatar displays
                        if (profileAvatar) profileAvatar.src = data.image_url;
                        
                        // Update sidebar avatar if exists
                        const sidebarAvatar = document.querySelector('.sidebar-user img, .user-avatar img');
                        if (sidebarAvatar) sidebarAvatar.src = data.image_url;
                        
                        showToast('Profile picture updated!', 'success');
                    } else {
                        showToast(data.message || 'Failed to upload image', 'error');
                    }
                } catch (error) {
                    console.error('Upload error:', error);
                    showToast('Failed to upload image', 'error');
                }
            }
        });
    }

    // ===== Password Toggle =====
    const passwordToggles = document.querySelectorAll('.password-toggle');
    
    passwordToggles.forEach(toggle => {
        toggle.addEventListener('click', function() {
            const targetId = this.getAttribute('data-target');
            const input = document.getElementById(targetId);
            const icon = this.querySelector('i');
            
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        });
    });

    // ===== Profile Form Submit =====
    const profileForm = document.getElementById('profileForm');
    
    if (profileForm) {
        profileForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = {
                first_name: document.getElementById('firstName')?.value || '',
                last_name: document.getElementById('lastName')?.value || '',
                username: document.getElementById('username')?.value || '',
                email: document.getElementById('email')?.value || '',
                phone: document.getElementById('phone')?.value || ''
            };
            
            try {
                const data = await ApiClient.post('/panel/api/profile/update/', formData);
                
                if (data.success) {
                    showToast('Profile information updated successfully!', 'success');
                    
                    // Update displayed name
                    const profileName = document.querySelector('.profile-name');
                    if (profileName) {
                        profileName.textContent = data.profile.full_name;
                    }
                    
                    // Update sidebar user name if exists
                    const sidebarUserName = document.querySelector('.user-name');
                    if (sidebarUserName) {
                        sidebarUserName.textContent = data.profile.full_name;
                    }
                    
                    // Update email display
                    const profileEmail = document.querySelector('.profile-email');
                    if (profileEmail) {
                        profileEmail.textContent = '';
                        const icon = document.createElement('i');
                        icon.className = 'fa-solid fa-envelope';
                        profileEmail.appendChild(icon);
                        profileEmail.appendChild(document.createTextNode(' ' + data.profile.email));
                    }
                } else {
                    showToast(data.message || 'Failed to update profile', 'error');
                }
            } catch (error) {
                console.error('Update error:', error);
                showToast('Failed to update profile', 'error');
            }
        });
    }

    // ===== Password Form Submit =====
    const passwordForm = document.getElementById('passwordForm');
    
    if (passwordForm) {
        passwordForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            if (!currentPassword || !newPassword || !confirmPassword) {
                showToast('Please fill in all password fields', 'error');
                return;
            }
            
            if (newPassword !== confirmPassword) {
                showToast('New passwords do not match', 'error');
                return;
            }
            
            if (newPassword.length < 6) {
                showToast('Password must be at least 6 characters', 'error');
                return;
            }
            
            try {
                const data = await ApiClient.post('/panel/api/profile/change-password/', {
                    current_password: currentPassword,
                    new_password: newPassword,
                    confirm_password: confirmPassword
                });
                
                if (data.success) {
                    showToast('Password updated successfully!', 'success');
                    passwordForm.reset();
                } else {
                    showToast(data.message || 'Failed to change password', 'error');
                }
            } catch (error) {
                console.error('Password change error:', error);
                showToast('Failed to change password', 'error');
            }
        });
    }

    // ===== Logout Button =====
    const logoutBtn = document.getElementById('logoutBtn');
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            if (confirm('Are you sure you want to logout?')) {
                window.location.href = '/panel/auth/logout/';
            }
        });
    }

    // ===== Load Profile Data =====
    async function loadProfile() {
        try {
            const data = await ApiClient.get('/panel/api/profile/');
            
            if (data.success) {
                const profile = data.profile;
                
                // Update form fields
                const firstNameInput = document.getElementById('firstName');
                const lastNameInput = document.getElementById('lastName');
                const usernameInput = document.getElementById('username');
                const emailInput = document.getElementById('email');
                const phoneInput = document.getElementById('phone');
                
                if (firstNameInput) firstNameInput.value = profile.first_name || '';
                if (lastNameInput) lastNameInput.value = profile.last_name || '';
                if (usernameInput) usernameInput.value = profile.username || '';
                if (emailInput) emailInput.value = profile.email || '';
                if (phoneInput) phoneInput.value = profile.phone || '';
                
                // Update profile card
                const profileName = document.querySelector('.profile-name');
                const profileRole = document.querySelector('.profile-role');
                const profileEmail = document.querySelector('.profile-email');
                const memberSinceEl = document.querySelector('.stat-value.member-since');
                
                if (profileName) profileName.textContent = profile.full_name;
                if (profileRole) profileRole.textContent = profile.role_display;
                if (profileEmail) {
                    profileEmail.textContent = '';
                    const icon = document.createElement('i');
                    icon.className = 'fa-solid fa-envelope';
                    profileEmail.appendChild(icon);
                    profileEmail.appendChild(document.createTextNode(' ' + (profile.email || '')));
                }
                if (memberSinceEl) memberSinceEl.textContent = profile.member_since;
                
                // Update avatar if exists
                if (profile.profile_image) {
                    const profileAvatar = document.getElementById('profileAvatar');
                    if (profileAvatar) profileAvatar.src = profile.profile_image;
                    
                    const sidebarAvatar = document.querySelector('.sidebar-user img, .user-avatar img');
                    if (sidebarAvatar) sidebarAvatar.src = profile.profile_image;
                }
            }
        } catch (error) {
            console.error('Failed to load profile:', error);
        }
    }

    // Note: getCSRFToken is now available globally from common/ajax.js
    // This local definition is kept only for backward compatibility
    // if the common module isn't loaded

    // ===== Security Toggle Changes (if present) =====
    const twoFactorToggle = document.getElementById('twoFactorToggle');
    const loginNotifyToggle = document.getElementById('loginNotifyToggle');
    const sessionTimeout = document.getElementById('sessionTimeout');

    if (twoFactorToggle) {
        twoFactorToggle.addEventListener('change', function() {
            if (this.checked) {
                showToast('Two-Factor Authentication enabled!', 'success');
            } else {
                showToast('Two-Factor Authentication disabled', 'success');
            }
        });
    }

    if (loginNotifyToggle) {
        loginNotifyToggle.addEventListener('change', function() {
            if (this.checked) {
                showToast('Login notifications enabled!', 'success');
            } else {
                showToast('Login notifications disabled', 'success');
            }
        });
    }

    if (sessionTimeout) {
        sessionTimeout.addEventListener('change', function() {
            const value = this.value;
            let message = '';
            
            if (value === '0') {
                message = 'Session timeout disabled';
            } else if (value === '60') {
                message = 'Session timeout set to 1 hour';
            } else if (value === '120') {
                message = 'Session timeout set to 2 hours';
            } else {
                message = `Session timeout set to ${value} minutes`;
            }
            
            showToast(message, 'success');
        });
    }

    // ===== Export Document Settings =====
    const exportSettingsForm = document.getElementById('exportSettingsForm');
    if (exportSettingsForm) {
        exportSettingsForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const saveBtn = exportSettingsForm.querySelector('.save-btn');
            const statusSpan = document.getElementById('exportSettingsStatus');
            
            const noteLine = document.getElementById('exportNoteLine').value.trim();
            const copyrightLine = document.getElementById('exportCopyrightLine').value.trim();
            
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving...';
            }
            if (statusSpan) statusSpan.textContent = '';
            
            try {
                const data = await ApiClient.post('/panel/api/export-settings/update/', {
                    export_note_line: noteLine,
                    export_copyright_line: copyrightLine
                });
                
                if (data.success) {
                    showToast('Export settings saved successfully!', 'success');
                    if (statusSpan) {
                        statusSpan.textContent = '✓ Saved';
                        statusSpan.style.color = 'var(--success-color, #28a745)';
                        setTimeout(() => { statusSpan.textContent = ''; }, 3000);
                    }
                } else {
                    showToast(data.message || 'Failed to save export settings', 'error');
                    if (statusSpan) {
                        statusSpan.textContent = '✗ Failed';
                        statusSpan.style.color = 'var(--danger-color, #dc3545)';
                    }
                }
            } catch (err) {
                console.error('Export settings save error:', err);
                showToast('Network error saving export settings', 'error');
                if (statusSpan) {
                    statusSpan.textContent = '✗ Error';
                    statusSpan.style.color = 'var(--danger-color, #dc3545)';
                }
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save Export Settings';
                }
            }
        });
    }
});
