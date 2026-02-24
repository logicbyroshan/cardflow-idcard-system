document.addEventListener('DOMContentLoaded', function() {
    // State
    let currentStep = 1;
    let selectedRole = '';
    let email = '';
    let userName = '';
    let resetToken = '';
    let resendCountdown = 0;
    
    // Elements
    const steps = document.querySelectorAll('.login-step');
    const stepDots = document.querySelectorAll('.step-dot');
    const messageBox = document.getElementById('messageBox');
    
    // Role selection
    const roleOptions = document.querySelectorAll('.role-option');
    const btnStep1Next = document.getElementById('btnStep1Next');
    
    // Email step
    const emailInput = document.getElementById('emailInput');
    const btnStep2Next = document.getElementById('btnStep2Next');
    const btnStep2Back = document.getElementById('btnStep2Back');
    
    // Password step
    const passwordInput = document.getElementById('passwordInput');
    const btnLogin = document.getElementById('btnLogin');
    const btnStep3Back = document.getElementById('btnStep3Back');
    const btnForgotPassword = document.getElementById('btnForgotPassword');
    const togglePassword = document.getElementById('togglePassword');
    
    // OTP step
    const otpInputs = document.querySelectorAll('#otpInputs input');
    const btnVerifyOtp = document.getElementById('btnVerifyOtp');
    const btnStep4Back = document.getElementById('btnStep4Back');
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
        const cookie = document.cookie.split(';').find(c => c.trim().startsWith('csrftoken='));
        return cookie ? cookie.split('=')[1] : '';
    }

    function showMessage(message, type = 'error') {
        messageBox.textContent = message;
        messageBox.className = 'message ' + type;
        setTimeout(() => {
            messageBox.className = 'message';
        }, 5000);
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
    
    // Role Selection
    roleOptions.forEach(option => {
        option.addEventListener('click', function() {
            roleOptions.forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            this.querySelector('input').checked = true;
            selectedRole = this.dataset.role;
            btnStep1Next.disabled = false;
        });
    });
    
    btnStep1Next.addEventListener('click', function() {
        if (selectedRole) {
            goToStep(2);
            emailInput.focus();
        }
    });
    
    // Email Step
    btnStep2Next.addEventListener('click', async function() {
        email = emailInput.value.trim();
        if (!email) {
            showMessage('Please enter your email');
            return;
        }
        
        setButtonLoading(this, true);
        
        try {
            const response = await fetch('/panel/api/auth/check-email/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
                body: JSON.stringify({ email, role: selectedRole })
            });
            
            const data = await response.json();
            
            if (data.success) {
                userName = data.user_name;
                document.getElementById('displayUserName').textContent = userName;
                document.getElementById('displayUserEmail').textContent = email;
                goToStep(3);
                passwordInput.focus();
            } else {
                showMessage(data.message);
            }
        } catch (error) {
            showMessage('Network error. Please try again.');
        }
        
        setButtonLoading(this, false);
    });
    
    emailInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') btnStep2Next.click();
    });
    
    btnStep2Back.addEventListener('click', function() {
        goToStep(1);
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
            const response = await fetch('/panel/api/auth/login/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
                body: JSON.stringify({ email, password, role: selectedRole })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showMessage('Login successful! Redirecting...', 'success');
                setTimeout(() => {
                    window.location.href = data.redirect_url;
                }, 500);
            } else {
                showMessage(data.message);
                setButtonLoading(this, false);
            }
        } catch (error) {
            showMessage('Network error. Please try again.');
            setButtonLoading(this, false);
        }
    });
    
    passwordInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') btnLogin.click();
    });
    
    btnStep3Back.addEventListener('click', function() {
        passwordInput.value = '';
        goToStep(2);
    });
    
    // Forgot Password
    btnForgotPassword.addEventListener('click', async function() {
        setButtonLoading(btnLogin, true);
        
        try {
            const response = await fetch('/panel/api/auth/forgot-password/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
                body: JSON.stringify({ email, role: selectedRole })
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Show OTP step
                goToStep(4);
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
            showMessage('Network error. Please try again.');
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
            const response = await fetch('/panel/api/auth/forgot-password/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
                body: JSON.stringify({ email, role: selectedRole })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showMessage('OTP sent successfully!', 'success');
                startResendTimer();
                
                if (data.dev_otp) {
                    devOtpValue.textContent = data.dev_otp;
                }
            }
        } catch (error) {
            showMessage('Failed to resend OTP');
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
            const response = await fetch('/panel/api/auth/verify-otp/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
                body: JSON.stringify({ email, otp })
            });
            
            const data = await response.json();
            
            if (data.success) {
                resetToken = data.reset_token;
                goToStep(5);
                newPasswordInput.focus();
            } else {
                showMessage(data.message);
            }
        } catch (error) {
            showMessage('Network error. Please try again.');
        }
        
        setButtonLoading(this, false);
    });
    
    btnStep4Back.addEventListener('click', function() {
        otpInputs.forEach(i => i.value = '');
        devOtpDisplay.style.display = 'none';
        goToStep(3);
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
            const response = await fetch('/panel/api/auth/reset-password/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
                body: JSON.stringify({
                    email,
                    reset_token: resetToken,
                    new_password: newPassword,
                    confirm_password: confirmPassword
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showMessage(data.message, 'success');
                setTimeout(() => {
                    // Reset and go back to login
                    newPasswordInput.value = '';
                    confirmPasswordInput.value = '';
                    passwordInput.value = '';
                    goToStep(3);
                }, 2000);
            } else {
                showMessage(data.message);
            }
        } catch (error) {
            showMessage('Network error. Please try again.');
        }
        
        setButtonLoading(this, false);
    });
});
