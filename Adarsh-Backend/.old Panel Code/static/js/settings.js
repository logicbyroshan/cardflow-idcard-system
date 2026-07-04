// Settings Page JavaScript - With API Integration

document.addEventListener('DOMContentLoaded', function() {
    // Load profile data on page load
    loadProfile();

    const profileSuperModeCard = document.getElementById('profileSuperMode');
    const profileSuperModeToggle = document.getElementById('profileSuperModeToggle');
    const profileSuperModeMeta = document.getElementById('profileSuperModeMeta');
    let superModeState = null;
    let superModeSaving = false;

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
        logoutBtn.addEventListener('click', async function() {
            var ok = await showConfirm({ title: 'Logout?', text: 'Are you sure you want to logout?', icon: 'fa-solid fa-right-from-bracket', confirmLabel: 'Logout', btnClass: 'btn-danger', hideWarning: true });
            if (ok) {
                const csrfToken = (typeof getCSRFToken === 'function') ? getCSRFToken() : (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
                logoutBtn.disabled = true;
                try {
                    const response = await fetch('/panel/auth/logout/', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': csrfToken,
                            'X-Requested-With': 'XMLHttpRequest'
                        },
                        body: '{}'
                    });

                    let data = {};
                    try {
                        data = await response.json();
                    } catch (parseError) {
                        data = {};
                    }

                    if (response.ok && data.success !== false) {
                        window.location.href = data.redirect || '/';
                        return;
                    }

                    showToast(data.message || 'Unable to logout right now. Retrying...', 'warning');
                } catch (error) {
                    console.error('Logout error:', error);
                }

                // Fallback form-submit keeps logout reliable if AJAX fails.
                var form = document.createElement('form');
                form.method = 'POST';
                form.action = '/panel/auth/logout/';
                var csrfInput = document.createElement('input');
                csrfInput.type = 'hidden';
                csrfInput.name = 'csrfmiddlewaretoken';
                csrfInput.value = csrfToken;
                form.appendChild(csrfInput);
                document.body.appendChild(form);
                form.submit();
            }
        });
    }

    // ===== Load Profile Data =====
    function renderSuperModeStatus() {
        if (!profileSuperModeCard || !profileSuperModeToggle || !profileSuperModeMeta) {
            return;
        }

        const sm = superModeState || {};
        const supported = !!sm.supported;

        if (!supported) {
            profileSuperModeCard.hidden = true;
            return;
        }

        profileSuperModeCard.hidden = false;

        const isAssigned = !!sm.is_assigned;
        const isEnabled = !!sm.is_enabled;
        const effectiveEnabled = !!sm.effective_enabled;
        const ramMb = parseInt(sm.ram_allocation_mb || 0, 10) || 0;

        profileSuperModeToggle.checked = isEnabled;
        profileSuperModeToggle.disabled = !sm.can_toggle || superModeSaving;

        if (effectiveEnabled) {
            profileSuperModeMeta.textContent = `Active at ${ramMb} MB`;
        } else if (isAssigned) {
            profileSuperModeMeta.textContent = `Assigned (${ramMb} MB) but currently off`;
        } else if (sm.message) {
            profileSuperModeMeta.textContent = sm.message;
        } else {
            profileSuperModeMeta.textContent = 'Not assigned';
        }
    }

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

                const securitySettings = profile.security_settings || {};
                const twoFactorToggleEl = document.getElementById('twoFactorToggle');
                const loginNotifyToggleEl = document.getElementById('loginNotifyToggle');
                const sessionTimeoutEl = document.getElementById('sessionTimeout');

                if (twoFactorToggleEl && typeof securitySettings.two_factor_enabled === 'boolean') {
                    twoFactorToggleEl.checked = securitySettings.two_factor_enabled;
                }
                if (loginNotifyToggleEl && typeof securitySettings.login_notifications_enabled === 'boolean') {
                    loginNotifyToggleEl.checked = securitySettings.login_notifications_enabled;
                }
                if (sessionTimeoutEl && securitySettings.session_timeout_minutes !== undefined && securitySettings.session_timeout_minutes !== null) {
                    const requestedValue = String(securitySettings.session_timeout_minutes);
                    const supportedOption = sessionTimeoutEl.querySelector('option[value="' + requestedValue + '"]');
                    sessionTimeoutEl.value = supportedOption ? requestedValue : '10080';
                    sessionTimeoutEl.dataset.previous = sessionTimeoutEl.value;
                    if (typeof window.syncUnifiedSelectDropdowns === 'function') {
                        window.syncUnifiedSelectDropdowns();
                    }
                }

                superModeState = profile.super_mode || null;
                renderSuperModeStatus();
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

    function getSessionTimeoutMessage(value) {
        if (value === '1440') {
            return 'Session timeout set to 1 day';
        }
        if (value === '2880') {
            return 'Session timeout set to 2 days';
        }
        if (value === '10080') {
            return 'Session timeout set to 7 days';
        }
        if (value === '21600') {
            return 'Session timeout set to 15 days';
        }
        if (value === '43200') {
            return 'Session timeout set to 30 days';
        }
        return 'Session timeout updated';
    }

    async function saveSecuritySettings(payload, successMessage) {
        try {
            const data = await ApiClient.post('/panel/api/profile/security-settings/update/', payload);
            if (!data.success) {
                showToast(data.message || 'Failed to update security settings', 'error');
                return false;
            }
            showToast(successMessage, 'success');
            return true;
        } catch (error) {
            console.error('Security settings update error:', error);
            showToast('Failed to update security settings', 'error');
            return false;
        }
    }

    if (twoFactorToggle) {
        twoFactorToggle.addEventListener('change', async function() {
            const nextValue = this.checked;
            const ok = await saveSecuritySettings(
                { two_factor_enabled: nextValue },
                nextValue ? 'Two-Factor Authentication enabled!' : 'Two-Factor Authentication disabled'
            );
            if (!ok) {
                this.checked = !nextValue;
            }
        });
    }

    if (loginNotifyToggle) {
        loginNotifyToggle.addEventListener('change', async function() {
            const nextValue = this.checked;
            const ok = await saveSecuritySettings(
                { login_notifications_enabled: nextValue },
                nextValue ? 'Login notifications enabled!' : 'Login notifications disabled'
            );
            if (!ok) {
                this.checked = !nextValue;
            }
        });
    }

    if (sessionTimeout) {
        sessionTimeout.dataset.previous = sessionTimeout.value;
        sessionTimeout.addEventListener('change', async function() {
            const value = this.value;
            const previousValue = this.dataset.previous || '10080';
            const ok = await saveSecuritySettings(
                { session_timeout_minutes: parseInt(value, 10) },
                getSessionTimeoutMessage(value)
            );
            if (ok) {
                this.dataset.previous = value;
            } else {
                this.value = previousValue;
            }
        });
    }

    if (profileSuperModeToggle) {
        profileSuperModeToggle.addEventListener('change', async function() {
            if (!superModeState || !superModeState.can_toggle) {
                this.checked = !!(superModeState && superModeState.is_enabled);
                return;
            }

            const nextValue = this.checked;
            superModeSaving = true;
            renderSuperModeStatus();

            try {
                const data = await ApiClient.post('/panel/api/profile/super-mode/toggle/', {
                    enabled: nextValue,
                });

                if (!data.success) {
                    this.checked = !nextValue;
                    showToast(data.message || 'Failed to update Super Mode', 'error');
                } else {
                    superModeState = data.super_mode || superModeState;
                    showToast(nextValue ? 'Super Mode enabled' : 'Super Mode disabled', 'success');
                }
            } catch (error) {
                console.error('Super mode toggle error:', error);
                this.checked = !nextValue;
                showToast('Failed to update Super Mode', 'error');
            } finally {
                superModeSaving = false;
                renderSuperModeStatus();
            }
        });
    }

});
