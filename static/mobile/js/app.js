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

(function initAndroidShellBridge() {
    var cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) {
        return;
    }
    if (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'android') {
        return;
    }

    var plugins = cap.Plugins || {};
    var App = plugins.App;
    var Device = plugins.Device;
    var Browser = plugins.Browser;
    var PushNotifications = plugins.PushNotifications;
    var Toast = plugins.Toast;

    var INSTALL_ID_KEY = 'adarsh.mobile.installation.id';
    var pingIntervalId = null;
    var backPressedAt = 0;
    var backHandlerReadyAt = Date.now() + 2200;
    var userInteractedAt = 0;

    function markUserInteraction() {
        userInteractedAt = Date.now();
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
        wrap.style.background = 'rgba(15,23,42,.94)';
        wrap.style.color = '#fff';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.justifyContent = 'center';
        wrap.style.padding = '20px';

        var latestVersion = (configPayload && configPayload.latest_version) || '';
        var supportUrl = (configPayload && configPayload.support_url) || '/app/profile/';

        wrap.innerHTML = '' +
            '<div style="max-width:360px;width:100%;text-align:center;">' +
            '<div style="font-size:24px;font-weight:700;margin-bottom:8px;">Update Required</div>' +
            '<p style="font-size:13px;line-height:1.45;opacity:.92;margin:0 0 14px;">' +
            'Your Adarsh Panel app version is no longer supported. Please update to continue.' +
            '</p>' +
            (latestVersion ? '<p style="font-size:12px;opacity:.82;margin:0 0 16px;">Latest version: ' + latestVersion + '</p>' : '') +
            '<a href="' + supportUrl + '" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:10px;background:#fff;color:#0f172a;text-decoration:none;font-size:13px;font-weight:700;">Open Support</a>' +
            '</div>';

        document.body.appendChild(wrap);
    }

    function showUpdateRecommendedBanner(configPayload, currentBuild) {
        var current = document.getElementById('mobile-shell-recommended-update');
        if (current) return;

        var latestBuild = parseInt(configPayload && configPayload.latest_build, 10) || 0;
        var latestVersion = String(configPayload && configPayload.latest_version || '').trim();
        var supportUrl = String(configPayload && configPayload.support_url || '/app/profile/').trim();
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
        wrap.style.background = '#0f172a';
        wrap.style.color = '#fff';
        wrap.style.borderRadius = '12px';
        wrap.style.padding = '12px 14px';
        wrap.style.boxShadow = '0 12px 24px rgba(0,0,0,.3)';

        var message = latestVersion
            ? 'A newer app version (' + latestVersion + ') is available.'
            : 'A newer app build is available.';

        wrap.innerHTML = '' +
            '<div style="display:flex;gap:10px;align-items:flex-start;">' +
            '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:13px;font-weight:700;line-height:1.25;">Update Available</div>' +
            '<div style="font-size:12px;opacity:.9;line-height:1.35;margin-top:2px;">' + message + '</div>' +
            (currentBuild > 0 && latestBuild > 0
                ? '<div style="font-size:11px;opacity:.75;margin-top:4px;">Current build ' + currentBuild + ' -> Latest build ' + latestBuild + '</div>'
                : '') +
            '</div>' +
            '<div style="display:flex;gap:8px;">' +
            '<a id="mobile-shell-recommended-open" href="' + supportUrl + '" style="display:inline-flex;align-items:center;justify-content:center;padding:8px 10px;border-radius:8px;background:#fff;color:#0f172a;text-decoration:none;font-size:12px;font-weight:700;">Update</a>' +
            '<button id="mobile-shell-recommended-dismiss" type="button" style="display:inline-flex;align-items:center;justify-content:center;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.18);border:0;color:#fff;font-size:12px;font-weight:600;">Later</button>' +
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

            if (window.mobileOverlay && typeof window.mobileOverlay.isActive === 'function' && window.mobileOverlay.isActive()) {
                window.mobileOverlay.close();
                return;
            }

            if (evt && evt.canGoBack) {
                window.history.back();
                return;
            }

            // Prevent phantom startup back events from closing the app.
            if (!userInteractedAt || (now - userInteractedAt) > 12 * 60 * 1000) {
                backPressedAt = 0;
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

    async function registerPushToken(payloadBase) {
        if (!PushNotifications || typeof PushNotifications.requestPermissions !== 'function') {
            return;
        }

        try {
            var perm = await PushNotifications.requestPermissions();
            if (!perm || perm.receive !== 'granted') return;

            PushNotifications.addListener('registration', function(token) {
                var pushToken = token && token.value ? String(token.value) : '';
                if (!pushToken) return;

                postJson('/app/api/mobile-shell/device/register/', Object.assign({}, payloadBase, {
                    push_token: pushToken,
                })).catch(function() {});
            });

            PushNotifications.addListener('pushNotificationActionPerformed', function(notification) {
                var data = notification && notification.notification && notification.notification.data || {};
                var targetUrl = String(data.url || data.path || '').trim();
                if (!targetUrl) return;

                if (/^https?:\/\//i.test(targetUrl) || targetUrl.startsWith('/')) {
                    window.location.href = targetUrl;
                }
            });

            await PushNotifications.register();
        } catch (err) {}
    }

    function setupHeartbeat(payloadBase) {
        if (pingIntervalId) return;

        var sendPing = function() {
            postJson('/app/api/mobile-shell/device/ping/', {
                installation_id: payloadBase.installation_id,
                app_build: payloadBase.app_build,
                app_version: payloadBase.app_version,
            }).catch(function() {});
        };

        sendPing();
        pingIntervalId = window.setInterval(sendPing, 5 * 60 * 1000);
    }

    async function bootstrap() {
        setupExternalLinkBridge();
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

        try {
            var registerResp = await postJson('/app/api/mobile-shell/device/register/', payloadBase);
            var configPayload = registerResp && registerResp.data && registerResp.data.config;
            if (configPayload && configPayload.update_required) {
                showUpdateRequiredOverlay(configPayload);
            } else if (configPayload && configPayload.update_recommended) {
                showUpdateRecommendedBanner(configPayload, nativeInfo.appBuild);
            }
        } catch (err) {}

        setupHeartbeat(payloadBase);
        registerPushToken(payloadBase);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }
})();
