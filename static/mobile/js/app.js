/**
 * ID Card Manager - Mobile PWA JavaScript
 */

// Service Worker is registered in base.html via Django-served endpoint
// (ensures Service-Worker-Allowed header is set for scope '/')

// Device restriction is handled in mobile_app/base.html via checkDevice().

// Prevent zoom on double-tap
let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    const target = event.target;
    if (!target) return;
    if (target && target.closest('input, textarea, select, [contenteditable="true"], a, button, label, [role="button"], [data-allow-double-tap]')) {
        return;
    }
    const enforceScope = target.closest('[data-no-doubletap-zoom], .no-doubletap-zoom');
    if (!enforceScope) return;

    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, { passive: false });

// Smooth scroll polyfill for older mobile browsers
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});

// Lightweight confirm helper used across mobile templates.
// Returns Promise<boolean> so existing `await showConfirm(...)` calls keep working.
window.showConfirm = function showConfirm(options) {
    var text = (options && options.text) || 'Are you sure?';
    var title = (options && options.title) || '';
    var message = title ? (title + '\n\n' + text) : text;
    return Promise.resolve(window.confirm(message));
};

(function setupSmoothPageTransitions() {
    if (!document || !document.body) return;

    var envGate = window.adarshMobileEnv || null;
    var isNativeShell = !!(envGate && typeof envGate.isNativeShell === 'function' && envGate.isNativeShell());

    var prefersReducedMotion = false;
    try {
        prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (err) {}
    if (prefersReducedMotion || isNativeShell) return;

    var ENTERING_CLASS = 'mobile-page-entering';
    var LEAVE_CLASS = 'mobile-page-leave';
    var TRANSITIONING_CLASS = 'mobile-page-transitioning';
    var ENTERING_FORWARD_CLASS = 'mobile-page-entering-forward';
    var ENTERING_BACK_CLASS = 'mobile-page-entering-back';
    var LEAVE_FORWARD_CLASS = 'mobile-page-leave-forward';
    var LEAVE_BACK_CLASS = 'mobile-page-leave-back';
    var NAV_DIRECTION_KEY = 'adarsh.mobile.nav.dir';
    var ENTER_ANIM_MS = 240;
    var LEAVE_GUARD_MS = 900;

    function saveNavDirection(direction) {
        try {
            sessionStorage.setItem(NAV_DIRECTION_KEY, direction === 'back' ? 'back' : 'forward');
        } catch (err) {}
    }

    function readAndClearNavDirection() {
        var nextDirection = 'forward';
        try {
            var stored = String(sessionStorage.getItem(NAV_DIRECTION_KEY) || '').trim().toLowerCase();
            if (stored === 'back') {
                nextDirection = 'back';
            }
            sessionStorage.removeItem(NAV_DIRECTION_KEY);
        } catch (err) {}
        return nextDirection;
    }

    function applyLeaveDirection(direction) {
        var safeDirection = direction === 'back' ? 'back' : 'forward';
        saveNavDirection(safeDirection);
        document.body.classList.remove(ENTERING_CLASS, ENTERING_FORWARD_CLASS, ENTERING_BACK_CLASS);
        document.body.classList.add(TRANSITIONING_CLASS, LEAVE_CLASS);
        document.body.classList.remove(LEAVE_FORWARD_CLASS, LEAVE_BACK_CLASS);
        document.body.classList.add(safeDirection === 'back' ? LEAVE_BACK_CLASS : LEAVE_FORWARD_CLASS);
    }

    function clearEnterClass() {
        document.body.classList.remove(ENTERING_CLASS, ENTERING_FORWARD_CLASS, ENTERING_BACK_CLASS, TRANSITIONING_CLASS);
    }

    function clearLeaveClass() {
        document.body.classList.remove(LEAVE_CLASS, LEAVE_FORWARD_CLASS, LEAVE_BACK_CLASS, TRANSITIONING_CLASS);
    }

    window.mobileSetNavDirection = function mobileSetNavDirection(direction) {
        saveNavDirection(direction);
    };

    window.mobileStartPageLeave = function mobileStartPageLeave(direction) {
        applyLeaveDirection(direction);
    };

    var incomingDirection = readAndClearNavDirection();
    document.body.classList.add(ENTERING_CLASS);
    document.body.classList.add(incomingDirection === 'back' ? ENTERING_BACK_CLASS : ENTERING_FORWARD_CLASS);
    document.body.classList.add(TRANSITIONING_CLASS);
    setTimeout(clearEnterClass, ENTER_ANIM_MS);

    document.addEventListener('click', function(event) {
        var target = event.target;
        if (!target || !target.closest) return;

        var anchor = target.closest('a[href]');
        if (!anchor) return;
        if (anchor.hasAttribute('download')) return;
        if (anchor.getAttribute('target') === '_blank') return;
        if (anchor.hasAttribute('data-no-page-transition')) return;
        if (event.defaultPrevented) return;

        var href = String(anchor.getAttribute('href') || '').trim();
        if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
            return;
        }

        try {
            var resolved = new URL(href, window.location.href);
            if (resolved.origin !== window.location.origin) return;
        } catch (err) {
            return;
        }

        var inlineHandler = String(anchor.getAttribute('onclick') || '');
        var isBackNav = anchor.hasAttribute('data-nav-back') || inlineHandler.indexOf('mobileGoBack') !== -1;
        applyLeaveDirection(isBackNav ? 'back' : 'forward');

        // If navigation is prevented or cancelled by app handlers,
        // remove stale blur state automatically.
        setTimeout(clearLeaveClass, LEAVE_GUARD_MS);
    }, true);

    window.addEventListener('pageshow', function() {
        clearLeaveClass();
    });

    window.addEventListener('pagehide', function() {
        clearLeaveClass();
    });

    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            clearLeaveClass();
        }
    });
})();

(function initAndroidShellBridge() {
    var envGate = window.adarshMobileEnv || null;
    function isNativeShellContext() {
        if (envGate && typeof envGate.isNativeShell === 'function') {
            return envGate.isNativeShell();
        }
        var cap = window.Capacitor;
        return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    }

    var cap = window.Capacitor;
    if (!cap || !isNativeShellContext()) {
        return;
    }

    var runtimePlatform = envGate && typeof envGate.getPlatform === 'function'
        ? envGate.getPlatform()
        : (typeof cap.getPlatform === 'function' ? cap.getPlatform() : '');
    if (String(runtimePlatform || '').toLowerCase() !== 'android') {
        return;
    }

    var plugins = cap.Plugins || {};
    var App = plugins.App;
    var Device = plugins.Device;
    var Browser = plugins.Browser;
    var PushNotifications = plugins.PushNotifications;
    var Toast = plugins.Toast;
    var bridge = window.adarshDeviceBridge || null;

    var INSTALL_ID_KEY = 'adarsh.mobile.installation.id';
    var LOGIN_BACK_SUPPRESS_KEY = 'adarsh.mobile.justLoggedInAt';
    var LOGIN_BACK_SUPPRESS_MS = 45 * 1000;
    var pingIntervalId = null;
    var pushRefreshIntervalId = null;
    var pushListenersBound = false;
    var lastKnownPushToken = '';
    var lastPushRegisterAttemptAt = 0;
    var backPressedAt = 0;
    var backHandlerReadyAt = Date.now() + 2200;
    var userInteractedAt = 0;

    function resetBackGuardAfterSystemDialog() {
        // Permission dialogs and resume transitions can emit phantom back events.
        backHandlerReadyAt = Date.now() + 5000;
        backPressedAt = 0;
        userInteractedAt = 0;
    }

    function markUserInteraction() {
        userInteractedAt = Date.now();
    }

    function shouldSuppressHistoryBackForRecentLogin(now) {
        try {
            var raw = sessionStorage.getItem(LOGIN_BACK_SUPPRESS_KEY) || '';
            var loginTs = parseInt(raw, 10) || 0;
            if (!loginTs) return false;
            if ((now - loginTs) <= LOGIN_BACK_SUPPRESS_MS) return true;
            sessionStorage.removeItem(LOGIN_BACK_SUPPRESS_KEY);
        } catch (err) {}
        return false;
    }

    ['pointerdown', 'touchstart', 'keydown'].forEach(function(evtName) {
        window.addEventListener(evtName, markUserInteraction, { passive: true, capture: true });
    });

    function getCsrfToken() {
        var m = (document.cookie || '').match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return m && m[1] ? decodeURIComponent(m[1]) : '';
    }

    function safeInt(raw, fallback) {
        var parsed = parseInt(raw, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function createInstallationId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return String(window.crypto.randomUUID()).replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 80);
        }
        return ('inst-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)).slice(0, 80);
    }

    function getInstallationId() {
        var existing = '';
        try {
            existing = localStorage.getItem(INSTALL_ID_KEY) || '';
        } catch (err) {
            existing = '';
        }
        if (existing) return existing;
        var generated = createInstallationId();
        try {
            localStorage.setItem(INSTALL_ID_KEY, generated);
        } catch (err) {}
        return generated;
    }

    function getCurrentOrigin(url) {
        try {
            return new URL(url, window.location.origin).origin;
        } catch (err) {
            return '';
        }
    }

    function isExternalHttpUrl(url) {
        if (!url || !/^https?:\/\//i.test(url)) return false;
        var currentOrigin = getCurrentOrigin(window.location.href);
        var targetOrigin = getCurrentOrigin(url);
        return !!targetOrigin && !!currentOrigin && targetOrigin !== currentOrigin;
    }

    async function postJson(url, payload) {
        var response = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify(payload || {}),
        });
        if (!response.ok) {
            throw new Error('Request failed: ' + response.status);
        }
        return response.json();
    }

    async function enqueueCriticalJson(url, payload, dedupeKey) {
        if (bridge && typeof bridge.enqueueCriticalJson === 'function') {
            return bridge.enqueueCriticalJson(url, payload, { dedupeKey: dedupeKey || '' });
        }

        try {
            var data = await postJson(url, payload);
            return { queued: false, data: data };
        } catch (err) {
            return { queued: true, error: err && err.message ? err.message : 'request_failed' };
        }
    }

    async function getNativeInfo() {
        var appInfo = { version: '', build: '0' };
        var deviceInfo = { model: '', osVersion: '', languageCode: '' };

        if (App && typeof App.getInfo === 'function') {
            try {
                appInfo = await App.getInfo();
            } catch (err) {}
        }
        if (Device && typeof Device.getInfo === 'function') {
            try {
                deviceInfo = await Device.getInfo();
            } catch (err) {}
        }

        return {
            appVersion: String(appInfo && appInfo.version || ''),
            appBuild: safeInt(appInfo && appInfo.build, 0),
            deviceModel: String(deviceInfo && deviceInfo.model || ''),
            osVersion: String(deviceInfo && (deviceInfo.osVersion || deviceInfo.operatingSystem) || ''),
            deviceLanguage: String(deviceInfo && (deviceInfo.languageCode || '') || ''),
        };
    }

    function showUpdateRequiredOverlay(configPayload) {
        var current = document.getElementById('mobile-shell-force-update');
        if (current) return;

        var wrap = document.createElement('div');
        wrap.id = 'mobile-shell-force-update';
        wrap.style.position = 'fixed';
        wrap.style.inset = '0';
        wrap.style.zIndex = '10080';
        wrap.style.background = 'rgba(12, 26, 52, .94)';
        wrap.style.color = '#fff';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.justifyContent = 'center';
        wrap.style.padding = '20px';

        var latestVersion = (configPayload && configPayload.latest_version) || '';
        var updateUrl = (configPayload && configPayload.update_url) || (configPayload && configPayload.support_url) || '/app/profile/';

        wrap.innerHTML = '' +
            '<div style="max-width:360px;width:100%;text-align:center;">' +
            '<div style="font-size:22px;font-weight:700;letter-spacing:.01em;margin-bottom:8px;">Update Required</div>' +
            '<p style="font-size:13px;line-height:1.45;opacity:.92;margin:0 0 14px;">' +
            'Your Adarsh Panel app version is no longer supported. Please update to continue.' +
            '</p>' +
            (latestVersion ? '<p style="font-size:12px;opacity:.82;margin:0 0 16px;">Latest version: ' + latestVersion + '</p>' : '') +
            '<a href="' + updateUrl + '" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:10px;background:linear-gradient(135deg,#33b7ef,#2f80ed 55%,#1f5fcf);color:#fff;text-decoration:none;font-size:13px;font-weight:700;box-shadow:0 10px 24px rgba(47,128,237,.34);">Update Now</a>' +
            '</div>';

        document.body.appendChild(wrap);
    }

    function showUpdateRecommendedBanner(configPayload, currentBuild) {
        var current = document.getElementById('mobile-shell-recommended-update');
        if (current) return;

        var latestBuild = parseInt(configPayload && configPayload.latest_build, 10) || 0;
        var latestVersion = String(configPayload && configPayload.latest_version || '').trim();
        var updateUrl = String(configPayload && (configPayload.update_url || configPayload.support_url) || '/app/profile/').trim();
        var reminderKey = 'adarsh.mobile.recommended.' + String(latestBuild || latestVersion || 'unknown');

        try {
            if (localStorage.getItem(reminderKey) === 'dismissed') {
                return;
            }
        } catch (err) {}

        var wrap = document.createElement('div');
        wrap.id = 'mobile-shell-recommended-update';
        wrap.style.position = 'fixed';
        wrap.style.left = '12px';
        wrap.style.right = '12px';
        wrap.style.bottom = '12px';
        wrap.style.zIndex = '10060';
        wrap.style.background = '#ffffff';
        wrap.style.color = '#182235';
        wrap.style.border = '1px solid #c5dcf7';
        wrap.style.borderRadius = '12px';
        wrap.style.padding = '12px 14px';
        wrap.style.boxShadow = '0 12px 28px rgba(31,95,207,.24)';

        var message = latestVersion
            ? 'A newer app version (' + latestVersion + ') is available.'
            : 'A newer app build is available.';

        wrap.innerHTML = '' +
            '<div style="display:flex;gap:10px;align-items:flex-start;">' +
            '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:13px;font-weight:700;line-height:1.25;">Update Available</div>' +
            '<div style="font-size:12px;color:#4a5c73;line-height:1.35;margin-top:2px;">' + message + '</div>' +
            (currentBuild > 0 && latestBuild > 0
                ? '<div style="font-size:11px;color:#70829b;margin-top:4px;">Current build ' + currentBuild + ' -> Latest build ' + latestBuild + '</div>'
                : '') +
            '</div>' +
            '<div style="display:flex;gap:8px;">' +
            '<a id="mobile-shell-recommended-open" href="' + updateUrl + '" style="display:inline-flex;align-items:center;justify-content:center;padding:8px 10px;border-radius:8px;background:linear-gradient(135deg,#33b7ef,#2f80ed 55%,#1f5fcf);color:#fff;text-decoration:none;font-size:12px;font-weight:700;">Update</a>' +
            '<button id="mobile-shell-recommended-dismiss" type="button" style="display:inline-flex;align-items:center;justify-content:center;padding:8px 10px;border-radius:8px;background:#edf4ff;border:1px solid #c5dcf7;color:#2f80ed;font-size:12px;font-weight:600;">Later</button>' +
            '</div>' +
            '</div>';

        document.body.appendChild(wrap);

        var dismissBtn = document.getElementById('mobile-shell-recommended-dismiss');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', function() {
                try {
                    localStorage.setItem(reminderKey, 'dismissed');
                } catch (err) {}
                wrap.remove();
            });
        }
    }

    function setupExternalLinkBridge() {
        if (!Browser || typeof Browser.open !== 'function') return;
        document.addEventListener('click', function(event) {
            var el = event.target;
            if (!el || !el.closest) return;
            var anchor = el.closest('a[href]');
            if (!anchor) return;
            var href = anchor.getAttribute('href') || '';
            if (!isExternalHttpUrl(href)) return;

            event.preventDefault();
            Browser.open({ url: href }).catch(function() {});
        }, true);
    }

    function setupAndroidBackBehavior() {
        if (!App || typeof App.addListener !== 'function') return;
        App.addListener('backButton', function(evt) {
            var now = Date.now();
            if (now < backHandlerReadyAt) {
                return;
            }

            // Reject stale/phantom back events before any history navigation.
            if (!userInteractedAt || (now - userInteractedAt) > 12 * 60 * 1000) {
                backPressedAt = 0;
                return;
            }

            if (window.mobileOverlay && typeof window.mobileOverlay.isActive === 'function' && window.mobileOverlay.isActive()) {
                window.mobileOverlay.close();
                return;
            }
            if (shouldSuppressHistoryBackForRecentLogin(now)) {
                backPressedAt = 0;
                return;
            }
            if (evt && evt.canGoBack) {
                if (typeof window.mobileStartPageLeave === 'function') {
                    window.mobileStartPageLeave('back');
                }
                window.history.back();
                return;
            }

            if (now - backPressedAt < 1200) {
                if (typeof App.exitApp === 'function') App.exitApp();
                return;
            }
            backPressedAt = now;

            if (Toast && typeof Toast.show === 'function') {
                Toast.show({ text: 'Press back again to exit' }).catch(function() {});
            }
        });
    }

    function normalizeInAppDeepLink(urlValue) {
        if (!urlValue) return '';
        try {
            var parsed = new URL(String(urlValue), window.location.origin);
            if (parsed.origin !== window.location.origin) return '';

            var path = String(parsed.pathname || '');
            if (!path.startsWith('/app')) return '/app/';
            return path + String(parsed.search || '') + String(parsed.hash || '');
        } catch (err) {
            return '';
        }
    }

    function setupDeepLinkBridge() {
        if (!App || typeof App.addListener !== 'function') return;
        App.addListener('appUrlOpen', function(event) {
            var incomingUrl = event && event.url ? String(event.url) : '';
            if (!incomingUrl) return;

            var nextPath = normalizeInAppDeepLink(incomingUrl);
            if (!nextPath) return;

            var currentPath = window.location.pathname + window.location.search + window.location.hash;
            if (currentPath === nextPath) return;
            if (typeof window.mobileStartPageLeave === 'function') {
                window.mobileStartPageLeave('forward');
            }
            window.location.href = nextPath;
        });
    }

    async function registerPushToken(payloadBase, configPayload) {
        if (!PushNotifications || typeof PushNotifications.requestPermissions !== 'function') {
            return;
        }

        var pushEnabledRaw = configPayload && configPayload.push_enabled;
        var pushEnabled = pushEnabledRaw === true || String(pushEnabledRaw || '').toLowerCase() === 'true' || String(pushEnabledRaw || '') === '1';
        if (!pushEnabled) {
            return;
        }

        try {
            resetBackGuardAfterSystemDialog();
            var perm = await PushNotifications.requestPermissions();
            resetBackGuardAfterSystemDialog();
            if (!perm || perm.receive !== 'granted') return;

            if (!pushListenersBound) {
                PushNotifications.addListener('registration', function(token) {
                    var pushToken = token && token.value ? String(token.value) : '';
                    if (!pushToken) return;
                    if (pushToken === lastKnownPushToken) return;
                    lastKnownPushToken = pushToken;

                    enqueueCriticalJson(
                        '/app/api/mobile-shell/device/register/',
                        Object.assign({}, payloadBase, { push_token: pushToken }),
                        'device_register_push_' + payloadBase.installation_id
                    ).catch(function() {});
                });

                PushNotifications.addListener('registrationError', function() {
                    // Keep silent for users; retry happens on resume/interval.
                });

                PushNotifications.addListener('pushNotificationActionPerformed', function(notification) {
                    var data = notification && notification.notification && notification.notification.data || {};
                    var targetUrl = String(data.url || data.path || '').trim();
                    if (!targetUrl) return;

                    if (/^https?:\/\//i.test(targetUrl) || targetUrl.startsWith('/')) {
                        window.location.href = targetUrl;
                    }
                });

                if (App && typeof App.addListener === 'function') {
                    App.addListener('appStateChange', function(state) {
                        if (state && state.isActive) {
                            resetBackGuardAfterSystemDialog();
                            var now = Date.now();
                            if (now - lastPushRegisterAttemptAt > 20000) {
                                lastPushRegisterAttemptAt = now;
                                PushNotifications.register().catch(function() {});
                            }
                        }
                    });
                }

                pushListenersBound = true;
            }

            lastPushRegisterAttemptAt = Date.now();
            await PushNotifications.register();

            if (!pushRefreshIntervalId) {
                pushRefreshIntervalId = window.setInterval(function() {
                    lastPushRegisterAttemptAt = Date.now();
                    PushNotifications.register().catch(function() {});
                }, 15 * 60 * 1000);
            }
        } catch (err) {}
    }

    function setupHeartbeat(payloadBase) {
        if (pingIntervalId) return;

        var sendPing = function() {
            enqueueCriticalJson('/app/api/mobile-shell/device/ping/', {
                installation_id: payloadBase.installation_id,
                app_build: payloadBase.app_build,
                app_version: payloadBase.app_version,
            }, 'device_ping_' + payloadBase.installation_id).catch(function() {});
        };

        sendPing();
        pingIntervalId = window.setInterval(sendPing, 5 * 60 * 1000);
    }

    async function bootstrap() {
        setupExternalLinkBridge();
        setupDeepLinkBridge();
        setupAndroidBackBehavior();

        var installId = getInstallationId();
        var nativeInfo = await getNativeInfo();
        var payloadBase = {
            platform: 'android',
            installation_id: installId,
            app_build: nativeInfo.appBuild,
            app_version: nativeInfo.appVersion,
            device_model: nativeInfo.deviceModel,
            os_version: nativeInfo.osVersion,
            device_language: nativeInfo.deviceLanguage,
        };
        var configPayload = null;

        try {
            var registerResult = await enqueueCriticalJson(
                '/app/api/mobile-shell/device/register/',
                payloadBase,
                'device_register_' + installId
            );
            var registerResp = registerResult && registerResult.data ? registerResult.data : null;
            configPayload = registerResp && registerResp.data && registerResp.data.config;
            if (configPayload && configPayload.update_required) {
                showUpdateRequiredOverlay(configPayload);
            } else if (configPayload && configPayload.update_recommended) {
                showUpdateRecommendedBanner(configPayload, nativeInfo.appBuild);
            }
        } catch (err) {}

        setupHeartbeat(payloadBase);
        registerPushToken(payloadBase, configPayload);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }
})();
