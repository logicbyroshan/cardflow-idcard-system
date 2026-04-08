// Settings Page JavaScript - With API Integration

document.addEventListener('DOMContentLoaded', function() {
    // Load profile data on page load
    loadProfile();

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
                const data = await ApiClient.post('/api/profile/update/', formData);
                
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
                const data = await ApiClient.post('/api/profile/change-password/', {
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
                const csrfToken = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
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
    async function loadProfile() {
        try {
            const data = await ApiClient.get('/api/profile/');
            
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
                    sessionTimeoutEl.value = String(securitySettings.session_timeout_minutes);
                    sessionTimeoutEl.dataset.previous = sessionTimeoutEl.value;
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

    function getSessionTimeoutMessage(value) {
        if (value === '0') {
            return 'Session timeout disabled';
        }
        if (value === '10080') {
            return 'Session timeout set to 7 days';
        }
        if (value === '60') {
            return 'Session timeout set to 1 hour';
        }
        if (value === '120') {
            return 'Session timeout set to 2 hours';
        }
        return `Session timeout set to ${value} minutes`;
    }

    async function saveSecuritySettings(payload, successMessage) {
        try {
            const data = await ApiClient.post('/api/profile/security-settings/update/', payload);
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

    // ===== Export Document Settings =====
    const exportSettingsForm = document.getElementById('exportSettingsForm');
    if (exportSettingsForm) {
        exportSettingsForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const saveBtn = document.getElementById('saveExportSettingsBtn');
            const statusSpan = document.getElementById('exportSettingsStatus');
            
            const noteLine = document.getElementById('exportNoteLine').value.trim();
            const copyrightLine = document.getElementById('exportCopyrightLine').value.trim();
            
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving...';
            }
            if (statusSpan) statusSpan.textContent = '';
            
            try {
                const data = await ApiClient.post('/api/export-settings/update/', {
                    export_note_line: noteLine,
                    export_copyright_line: copyrightLine
                });
                
                if (data.success) {
                    showToast('Export settings saved successfully!', 'success');
                    if (statusSpan) {
                        statusSpan.textContent = ' Saved';
                        statusSpan.style.color = 'var(--success-color, #28a745)';
                        setTimeout(() => { statusSpan.textContent = ''; }, 3000);
                    }
                } else {
                    showToast(data.message || 'Failed to save export settings', 'error');
                    if (statusSpan) {
                        statusSpan.textContent = ' Failed';
                        statusSpan.style.color = 'var(--danger-color, #dc3545)';
                    }
                }
            } catch (err) {
                console.error('Export settings save error:', err);
                showToast('Network error saving export settings', 'error');
                if (statusSpan) {
                    statusSpan.textContent = ' Error';
                    statusSpan.style.color = 'var(--danger-color, #dc3545)';
                }
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Save Export Settings';
                }
            }
        });
    }

    // ===== Export Templates Management =====
    const tplListEl = document.getElementById('exportTemplateList');
    const addTplForm = document.getElementById('addExportTemplateForm');

    async function loadExportTemplates() {
        if (!tplListEl) return;
        try {
            const data = await ApiClient.get('/api/export-templates/');
            if (data.success) {
                renderTemplateList(data.templates);
            } else {
                tplListEl.innerHTML = '<p style="color:#ef4444;font-size:13px;">Failed to load templates.</p>';
            }
        } catch (err) {
            console.error('Load templates error:', err);
            tplListEl.innerHTML = '<p style="color:#ef4444;font-size:13px;">Network error loading templates.</p>';
        }
    }

    function renderTemplateList(templates) {
        if (!templates || templates.length === 0) {
            tplListEl.innerHTML = '<p style="color:#94a3b8;font-size:13px;margin:0;">No templates created yet. Add one below.</p>';
            return;
        }
        let html = '';
        templates.forEach(function(tpl) {
            const defaultBadge = tpl.is_default ? '<span style="background:#8b5cf6;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:6px;">Default</span>' : '';
            html += '<div id="tpl-row-' + tpl.id + '" style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:8px;background:#fff;">';
            html += '  <div style="flex:1;min-width:0;">';
            html += '    <div style="font-weight:600;font-size:13px;color:#1e293b;">' + escapeHtml(tpl.name) + defaultBadge + '</div>';
            html += '    <div style="font-size:12px;color:#64748b;margin-top:4px;white-space:pre-wrap;word-break:break-word;">' + escapeHtml(tpl.instructions).substring(0, 200) + (tpl.instructions.length > 200 ? '...' : '') + '</div>';
            html += '  </div>';
            html += '  <div style="display:flex;gap:6px;flex-shrink:0;">';
            html += '    <button onclick="editExportTemplate(' + tpl.id + ')" class="btn btn-sm" style="font-size:11px;padding:4px 10px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;" title="Edit"><i class="fa-solid fa-pen"></i></button>';
            html += '    <button onclick="deleteExportTemplate(' + tpl.id + ',\'' + escapeHtml(tpl.name).replace(/'/g, "\\'") + '\')" class="btn btn-sm" style="font-size:11px;padding:4px 10px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;" title="Delete"><i class="fa-solid fa-trash"></i></button>';
            html += '  </div>';
            html += '</div>';
        });
        tplListEl.innerHTML = html;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Add template
    if (addTplForm) {
        addTplForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const name = document.getElementById('newTplName').value.trim();
            const instructions = document.getElementById('newTplInstructions').value.trim();
            const isDefault = document.getElementById('newTplDefault').checked;

            if (!name || !instructions) {
                showToast('Please fill in template name and instructions', 'error');
                return;
            }

            try {
                const data = await ApiClient.post('/api/export-templates/create/', {
                    name: name,
                    instructions: instructions,
                    is_default: isDefault
                });
                if (data.success) {
                    showToast('Template created successfully!', 'success');
                    document.getElementById('newTplName').value = '';
                    document.getElementById('newTplInstructions').value = '';
                    document.getElementById('newTplDefault').checked = false;
                    loadExportTemplates();
                } else {
                    showToast(data.message || 'Failed to create template', 'error');
                }
            } catch (err) {
                console.error('Create template error:', err);
                showToast('Network error creating template', 'error');
            }
        });
    }

    // Edit template (inline prompt)
    window.editExportTemplate = async function(id) {
        const row = document.getElementById('tpl-row-' + id);
        if (!row) return;

        // Fetch current data
        let tplData;
        try {
            const data = await ApiClient.get('/api/export-templates/');
            if (data.success) {
                tplData = data.templates.find(function(t) { return t.id === id; });
            }
        } catch (err) { return; }
        if (!tplData) return;

        const newName = prompt('Template Name:', tplData.name);
        if (newName === null) return;
        const newInstructions = prompt('Footer Instructions:', tplData.instructions);
        if (newInstructions === null) return;

        try {
            const data = await ApiClient.post('/api/export-templates/' + id + '/update/', {
                name: newName.trim(),
                instructions: newInstructions.trim()
            });
            if (data.success) {
                showToast('Template updated!', 'success');
                loadExportTemplates();
            } else {
                showToast(data.message || 'Failed to update template', 'error');
            }
        } catch (err) {
            console.error('Update template error:', err);
            showToast('Network error updating template', 'error');
        }
    };

    // Delete template
    window.deleteExportTemplate = async function(id, name) {
        var ok = await showConfirm({ title: 'Delete Template?', text: 'Delete template "' + name + '"?', icon: 'fa-solid fa-trash', confirmLabel: 'Delete', hideWarning: true });
        if (!ok) return;
        try {
            const data = await ApiClient.post('/api/export-templates/' + id + '/delete/');
            if (data.success) {
                showToast('Template deleted', 'success');
                loadExportTemplates();
            } else {
                showToast(data.message || 'Failed to delete template', 'error');
            }
        } catch (err) {
            console.error('Delete template error:', err);
            showToast('Network error deleting template', 'error');
        }
    };

    // Load on page init
    loadExportTemplates();
});
