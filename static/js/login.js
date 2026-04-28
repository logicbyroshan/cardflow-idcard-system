document.addEventListener('DOMContentLoaded', function() {
    // State
    let currentStep = 1;
    let email = '';
    let userName = '';
    let resetToken = '';
    let resendCountdown = 0;
    
    // Elements
    const steps = document.querySelectorAll('.login-step');
    const stepDots = document.querySelectorAll('.step-dot');
    const messageBox = document.getElementById('messageBox');
    
    // Email step
    const emailInput = document.getElementById('emailInput');
    const btnStep1Next = document.getElementById('btnStep1Next');
    
    // Password step
    const passwordInput = document.getElementById('passwordInput');
    const btnLogin = document.getElementById('btnLogin');
    const btnStep2Back = document.getElementById('btnStep2Back');
    const btnForgotPassword = document.getElementById('btnForgotPassword');
    const togglePassword = document.getElementById('togglePassword');
    
    // OTP step
    const otpInputs = document.querySelectorAll('#otpInputs input');
    const btnVerifyOtp = document.getElementById('btnVerifyOtp');
    const btnStep3Back = document.getElementById('btnStep3Back');
    const btnResendOtp = document.getElementById('btnResendOtp');
    const resendTimerEl = document.getElementById('resendTimer');
    const devOtpDisplay = document.getElementById('devOtpDisplay');
    const devOtpValue = document.getElementById('devOtpValue');
    
    // Reset password step
    const newPasswordInput = document.getElementById('newPasswordInput');
    const confirmPasswordInput = document.getElementById('confirmPasswordInput');
    const btnResetPassword = document.getElementById('btnResetPassword');
    const toggleNewPassword = document.getElementById('toggleNewPassword');
    
    // Functions
    function getCSRFToken() {
        return document.cookie
            .split('; ')
            .find(row => row.startsWith('csrftoken='))
            ?.split('=')[1] || '';
    }

    /**
     * Safe JSON POST  handles redirects, non-JSON responses, and CSRF errors
     * gracefully instead of showing a generic "Network error".
     */
    async function safePost(url, body) {
        const csrf = getCSRFToken();
        const headers = { 'Content-Type': 'application/json' };
        if (csrf) headers['X-CSRFToken'] = csrf;

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        const ct = response.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            // Server returned HTML instead of JSON
            if (response.status === 403) {
                // Step 6: Frontend Auto-Recovery (Reload ONCE only)
                if (!window.__csrfRetry) {
                    window.__csrfRetry = true;
                    try { sessionStorage.setItem('__csrf_retry', '1'); } catch(e) {}
                    window.location.reload();
                    return new Promise(() => {}); // stop execution
                }
            }
            throw new Error('Server error (' + response.status + '). Please refresh and try again.');
        }
        const data = await response.json();
        if (response.status === 429) {
            throw new Error(data.message || 'Too many requests. Please wait and try again.');
        }
        if (response.status >= 500) {
            throw new Error(data.message || 'Server error. Please try again.');
        }
        return data;
    }

    function showMessage(message, type = 'error') {
        messageBox.textContent = message;
        messageBox.className = 'message ' + type;
        setTimeout(() => {
            messageBox.className = 'message';
        }, 5000);
    }

    function formatActiveDeviceList(devices) {
        if (!Array.isArray(devices) || !devices.length) return '';
        return devices.slice(0, 3).map(function(item) {
            var label = String((item && item.device_label) || 'Unknown device').trim();
            var ip = String((item && item.ip_address) || '').trim();
            return ip ? (label + ' [' + ip + ']') : label;
        }).join(', ');
    }
    
    function goToStep(step) {
        steps.forEach(s => s.classList.remove('active'));
        document.getElementById('step' + step).classList.add('active');
        
        stepDots.forEach((dot, index) => {
            dot.classList.remove('active', 'completed');
            dot.removeAttribute('aria-current');
            if (index + 1 < step) dot.classList.add('completed');
            if (index + 1 === step) {
                dot.classList.add('active');
                dot.setAttribute('aria-current', 'step');
            }
        });
        
        currentStep = step;
        messageBox.className = 'message';
    }
    
    function setButtonLoading(btn, loading) {
        const text = btn.querySelector('.btn-text');
        const spinner = btn.querySelector('.spinner');
        if (text) text.style.display = loading ? 'none' : 'inline';
        if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
        btn.disabled = loading;
    }
    
    // Email Step
    btnStep1Next.addEventListener('click', async function() {
        email = emailInput.value.trim();
        if (!email) {
            showMessage('Please enter your email, username, or phone');
            return;
        }
        
        setButtonLoading(this, true);
        
        try {
            const data = await safePost('/api/auth/check-email/', { email });
            if (data.success) {
                userName = data.user_name;
                document.getElementById('displayUserName').textContent = userName;
                document.getElementById('displayUserEmail').textContent = email;
                goToStep(2);
                passwordInput.focus();
            } else {
                showMessage(data.message);
            }
        } catch (error) {
            showMessage(error.message || 'Network error. Please try again.');
        }
        
        setButtonLoading(this, false);
    });
    
    emailInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') btnStep1Next.click();
    });
    
    // Password Step
    togglePassword.addEventListener('click', function() {
        const type = passwordInput.type === 'password' ? 'text' : 'password';
        passwordInput.type = type;
        this.querySelector('i').className = type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
    });
    
    btnLogin.addEventListener('click', async function() {
        const password = passwordInput.value;
        if (!password) {
            showMessage('Please enter your password');
            return;
        }
        
        setButtonLoading(this, true);
        
        try {
            let data = await safePost('/api/auth/login/', { email, password });

            if (!data.success && data.session_limit_hit && data.can_force_logout_other) {
                const deviceText = formatActiveDeviceList(data.active_session_devices);
                const promptText = deviceText
                    ? ('Already logged in on: ' + deviceText + '. Logout other device and continue here?')
                    : 'Already logged in on another device. Logout other device and continue here?';

                const shouldTakeover = window.confirm(promptText);
                if (shouldTakeover) {
                    data = await safePost('/api/auth/login/', {
                        email,
                        password,
                        force_logout_other: true,
                    });
                }
            }

            if (data.success) {
                showMessage('Login successful! Redirecting...', 'success');
                // Respect ?next= param (e.g. from PWA  login redirect)
                const nextUrl = new URLSearchParams(window.location.search).get('next');
                const safeNext = nextUrl && nextUrl.startsWith('/') && !nextUrl.startsWith('//') ? nextUrl : null;

                // Auto-detect mobile: if on a phone and no explicit ?next=, go to /app/
                let redirectTo = safeNext || data.redirect_url;
                if (!safeNext) {
                    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                    if (isMobile) {
                        redirectTo = '/app/';
                    }
                }

                setTimeout(() => {
                    window.location.href = redirectTo;
                }, 500);
            } else {
                showMessage(data.message);
                setButtonLoading(this, false);
            }
        } catch (error) {
            showMessage(error.message || 'Network error. Please try again.');
            setButtonLoading(this, false);
        }
    });
    
    passwordInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') btnLogin.click();
    });
    
    btnStep2Back.addEventListener('click', function() {
        passwordInput.value = '';
        goToStep(1);
    });
    
    // Forgot Password
    btnForgotPassword.addEventListener('click', async function() {
        setButtonLoading(btnLogin, true);
        
        try {
            const data = await safePost('/api/auth/forgot-password/', { email });
            if (data.success) {
                // Show OTP step
                goToStep(3);
                otpInputs[0].focus();
                startResendTimer();
                
                // Show dev OTP if available
                if (data.dev_otp) {
                    devOtpDisplay.style.display = 'block';
                    devOtpValue.textContent = data.dev_otp;
                }
            } else {
                showMessage(data.message);
            }
        } catch (error) {
            showMessage(error.message || 'Network error. Please try again.');
        }
        
        setButtonLoading(btnLogin, false);
    });
    
    // OTP Input handling
    otpInputs.forEach((input, index) => {
        input.addEventListener('input', function() {
            this.value = this.value.replace(/[^0-9]/g, '');
            if (this.value && index < otpInputs.length - 1) {
                otpInputs[index + 1].focus();
            }
        });
        
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Backspace' && !this.value && index > 0) {
                otpInputs[index - 1].focus();
            }
        });
        
        input.addEventListener('paste', function(e) {
            e.preventDefault();
            const paste = (e.clipboardData || window.clipboardData).getData('text');
            const digits = paste.replace(/[^0-9]/g, '').split('');
            otpInputs.forEach((inp, i) => {
                if (digits[i]) inp.value = digits[i];
            });
        });
    });
    
    function startResendTimer() {
        resendCountdown = 60;
        btnResendOtp.disabled = true;
        // Rebuild button structure to restore the timer span
        btnResendOtp.innerHTML = 'Resend in <span id="resendTimer">' + resendCountdown + '</span>s';
        
        const interval = setInterval(() => {
            resendCountdown--;
            var timerSpan = document.getElementById('resendTimer');
            if (timerSpan) timerSpan.textContent = resendCountdown;
            
            if (resendCountdown <= 0) {
                clearInterval(interval);
                btnResendOtp.disabled = false;
                btnResendOtp.textContent = 'Resend OTP';
            }
        }, 1000);
    }
    
    btnResendOtp.addEventListener('click', async function() {
        try {
            const data = await safePost('/api/auth/forgot-password/', { email });
            if (data.success) {
                showMessage('OTP sent successfully!', 'success');
                startResendTimer();
                
                if (data.dev_otp) {
                    devOtpValue.textContent = data.dev_otp;
                }
            }
        } catch (error) {
            showMessage(error.message || 'Failed to resend OTP');
        }
    });
    
    btnVerifyOtp.addEventListener('click', async function() {
        const otp = Array.from(otpInputs).map(i => i.value).join('');
        if (otp.length !== 6) {
            showMessage('Please enter complete 6-digit OTP');
            return;
        }
        
        setButtonLoading(this, true);
        
        try {
            const data = await safePost('/api/auth/verify-otp/', { email, otp });
            if (data.success) {
                resetToken = data.reset_token;
                goToStep(4);
                newPasswordInput.focus();
            } else {
                showMessage(data.message);
            }
        } catch (error) {
            showMessage(error.message || 'Network error. Please try again.');
        }
        
        setButtonLoading(this, false);
    });
    
    btnStep3Back.addEventListener('click', function() {
        otpInputs.forEach(i => i.value = '');
        devOtpDisplay.style.display = 'none';
        goToStep(2);
    });
    
    // Reset Password
    toggleNewPassword.addEventListener('click', function() {
        const type = newPasswordInput.type === 'password' ? 'text' : 'password';
        newPasswordInput.type = type;
        this.querySelector('i').className = type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
    });
    
    btnResetPassword.addEventListener('click', async function() {
        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;
        
        if (!newPassword || !confirmPassword) {
            showMessage('Please fill in both password fields');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            showMessage('Passwords do not match');
            return;
        }
        
        if (newPassword.length < 6) {
            showMessage('Password must be at least 6 characters');
            return;
        }
        
        setButtonLoading(this, true);
        
        try {
            const data = await safePost('/api/auth/reset-password/', {
                email,
                reset_token: resetToken,
                new_password: newPassword,
                confirm_password: confirmPassword
            });
            if (data.success) {
                showMessage(data.message, 'success');
                setTimeout(() => {
                    // Reset and go back to login
                    newPasswordInput.value = '';
                    confirmPasswordInput.value = '';
                    passwordInput.value = '';
                    goToStep(2);
                }, 2000);
            } else {
                showMessage(data.message);
            }
        } catch (error) {
            showMessage(error.message || 'Network error. Please try again.');
        }
        
        setButtonLoading(this, false);
    });
});
