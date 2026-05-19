(function () {
	var cfg = window.MOBILE_LOGIN || {};
	var loginApiUrl = String(cfg.loginApiUrl || '/app/api/auth/login/');
	var defaultRedirect = String(cfg.defaultRedirect || '/app/');
	var apkUrl = String(cfg.apkDownloadUrl || '').trim();

	function isNativeShell() {
		var ua = String(navigator.userAgent || '');
		return /Android|iPhone|iPad|iPod/i.test(ua);
	}

	function byId(id) {
		return document.getElementById(id);
	}

	var form = byId('mobileLoginForm');
	var emailEl = byId('email');
	var passEl = byId('password');
	var loginBtn = byId('loginBtn');
	var msgEl = byId('loginMessage');
	var installActions = byId('installActions');
	var downloadCta = byId('downloadApkCta');
	var installBtn = byId('installBtn');
	var deferredInstallPrompt = null;

	if (downloadCta && apkUrl) {
		downloadCta.href = apkUrl;
	}

	if (isNativeShell() && installActions) {
		installActions.classList.add('hidden');
	}

	if (installBtn) {
		installBtn.addEventListener('click', function () {
			if (deferredInstallPrompt) {
				deferredInstallPrompt.prompt();
			}
		});
	}

	window.addEventListener('beforeinstallprompt', function (evt) {
		evt.preventDefault();
		deferredInstallPrompt = evt;
		if (isNativeShell() && installActions) {
			installActions.classList.add('hidden');
		}
	});

	function setMessage(text, ok) {
		if (!msgEl) return;
		msgEl.textContent = text || '';
		msgEl.classList.toggle('success', !!ok);
	}

	if (!form) return;

	form.addEventListener('submit', function (evt) {
		evt.preventDefault();

		var email = emailEl ? String(emailEl.value || '').trim() : '';
		var password = passEl ? String(passEl.value || '') : '';
		if (!email || !password) {
			setMessage('Email and password are required.', false);
			return;
		}

		if (loginBtn) {
			loginBtn.disabled = true;
			loginBtn.textContent = 'Signing In...';
		}
		setMessage('', false);

		fetch(loginApiUrl, {
			method: 'POST',
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
				'X-Requested-With': 'XMLHttpRequest'
			},
			body: JSON.stringify({
				email: email,
				password: password
			})
		})
			.then(function (resp) {
				return resp.json().catch(function () {
					return { success: false, message: 'Invalid server response.' };
				});
			})
			.then(function (data) {
				if (data && data.success) {
					setMessage('Login successful. Redirecting...', true);
					var redirectTo = String(data.redirect_url || defaultRedirect || '/app/');
					window.location.href = redirectTo;
					return;
				}
				setMessage((data && data.message) || 'Login failed. Please try again.', false);
			})
			.catch(function () {
				setMessage('Network error. Please check your connection and try again.', false);
			})
			.finally(function () {
				if (loginBtn) {
					loginBtn.disabled = false;
					loginBtn.textContent = 'Sign In';
				}
			});
	});
})();
