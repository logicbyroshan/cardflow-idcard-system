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

(function setupAndroidNativePerformanceLayer() {
    var envGate = window.adarshMobileEnv || null;
    var isNative = !!(envGate && typeof envGate.isNativeShell === 'function' && envGate.isNativeShell());
    var platform = envGate && typeof envGate.getPlatform === 'function'
        ? String(envGate.getPlatform() || '').toLowerCase()
        : '';
    if (!isNative || platform !== 'android') {
        return;
    }

    document.body.classList.add('mobile-fast-tap-ready');

    var pendingRouteHref = window.location.pathname + window.location.search;

    function ensureRouteSkeleton() {
        var existing = document.getElementById('mobile-route-skeleton');
        if (existing) return existing;

        var shell = document.createElement('div');
        shell.id = 'mobile-route-skeleton';
        shell.style.position = 'fixed';
        shell.style.inset = '0';
        shell.style.zIndex = '10050';
        shell.style.background = 'linear-gradient(180deg,#f6fbff 0%,#edf5ff 65%,#e6f0ff 100%)';
        shell.style.padding = '18px 14px 88px';
        shell.style.display = 'none';
        shell.style.pointerEvents = 'none';
        shell.innerHTML = '<div id="mobile-route-skeleton-content"></div>';

        var style = document.createElement('style');
        style.textContent = '' +
            '#mobile-route-skeleton .adarsh-skeleton-block{' +
                'background:linear-gradient(90deg,#dfeafb 20%,#eff5ff 45%,#dfeafb 70%);' +
                'background-size:220% 100%;' +
                'animation:adarshSkeletonShimmer 1.15s linear infinite;' +
                'box-shadow:inset 0 1px 0 rgba(255,255,255,0.6);' +
            '}' +
            '#mobile-route-skeleton .adarsh-skeleton-chip{' +
                'display:inline-block;' +
                'height:10px;' +
                'border-radius:999px;' +
                'background:linear-gradient(90deg,#dfeafb 20%,#eff5ff 45%,#dfeafb 70%);' +
                'background-size:220% 100%;' +
                'animation:adarshSkeletonShimmer 1.15s linear infinite;' +
            '}' +
            '#mobile-route-skeleton .adarsh-skeleton-grid2{' +
                'display:grid;' +
                'grid-template-columns:1fr 1fr;' +
                'gap:10px;' +
            '}' +
            '@keyframes adarshSkeletonShimmer{' +
                '0%{background-position:220% 0;}' +
                '100%{background-position:-220% 0;}' +
            '}';

        document.head.appendChild(style);
        document.body.appendChild(shell);
        return shell;
    }

    function normalizeSkeletonPath(rawHref) {
        var href = String(rawHref || '').trim();
        if (!href) return window.location.pathname;
        try {
            var resolved = new URL(href, window.location.href);
            return resolved.pathname || window.location.pathname;
        } catch (err) {
            return window.location.pathname;
        }
    }

    function inferSkeletonKindFromHref(rawHref) {
        var path = normalizeSkeletonPath(rawHref).toLowerCase();
        if (path === '/app' || path === '/app/') return 'home';
        if (path.indexOf('/app/search') === 0) return 'search';
        if (path.indexOf('/app/table/') === 0 || path.indexOf('/app/tables/') === 0) return 'list';
        if (path.indexOf('/app/card/') === 0) return 'detail';
        if (path.indexOf('/app/reprint/') === 0) return 'reprint';
        if (path.indexOf('/app/clients') === 0) return 'clients';
        if (path.indexOf('/app/groups') === 0) return 'groups';
        if (path.indexOf('/app/settings') === 0) return 'settings';
        if (path.indexOf('/app/profile') === 0) return 'profile';
        if (path.indexOf('/app/staff') === 0) return 'staff';
        if (path.indexOf('/app/website') === 0) return 'website';
        if (path.indexOf('/app/camera') === 0) return 'camera';
        if (path.indexOf('/app/notifications') === 0) return 'notifications';
        if (path.indexOf('/app/permissions') === 0) return 'permissions';
        return 'default';
    }

    function renderPageSkeleton(kind) {
        var top = '' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">' +
                '<span class="adarsh-skeleton-block" style="width:34px;height:34px;border-radius:12px;"></span>' +
                '<span class="adarsh-skeleton-block" style="height:14px;flex:1;border-radius:8px;"></span>' +
                '<span class="adarsh-skeleton-block" style="width:34px;height:34px;border-radius:12px;"></span>' +
            '</div>';

        if (kind === 'home') {
            return top +
                '<div class="adarsh-skeleton-grid2" style="margin-bottom:12px;">' +
                    '<div class="adarsh-skeleton-block" style="height:94px;border-radius:16px;"></div>' +
                    '<div class="adarsh-skeleton-block" style="height:94px;border-radius:16px;"></div>' +
                '</div>' +
                '<div class="adarsh-skeleton-grid2" style="margin-bottom:12px;">' +
                    '<div class="adarsh-skeleton-block" style="height:68px;border-radius:14px;"></div>' +
                    '<div class="adarsh-skeleton-block" style="height:68px;border-radius:14px;"></div>' +
                '</div>' +
                '<div class="adarsh-skeleton-block" style="height:84px;border-radius:14px;margin-bottom:10px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:84px;border-radius:14px;margin-bottom:10px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:84px;border-radius:14px;"></div>';
        }

        if (kind === 'list' || kind === 'search' || kind === 'reprint') {
            return top +
                '<div class="adarsh-skeleton-block" style="height:42px;border-radius:12px;margin-bottom:10px;"></div>' +
                '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
                    '<span class="adarsh-skeleton-chip" style="width:22%;"></span>' +
                    '<span class="adarsh-skeleton-chip" style="width:18%;"></span>' +
                    '<span class="adarsh-skeleton-chip" style="width:26%;"></span>' +
                '</div>' +
                '<div class="adarsh-skeleton-block" style="height:86px;border-radius:14px;margin-bottom:10px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:86px;border-radius:14px;margin-bottom:10px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:86px;border-radius:14px;margin-bottom:10px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:86px;border-radius:14px;"></div>';
        }

        if (kind === 'detail' || kind === 'profile') {
            return top +
                '<div class="adarsh-skeleton-block" style="height:182px;border-radius:18px;margin-bottom:12px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:14px;width:72%;border-radius:8px;margin-bottom:8px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:12px;width:44%;border-radius:8px;margin-bottom:14px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:54px;border-radius:12px;margin-bottom:8px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:54px;border-radius:12px;margin-bottom:8px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:54px;border-radius:12px;margin-bottom:8px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:44px;border-radius:12px;"></div>';
        }

        if (kind === 'settings' || kind === 'permissions') {
            return top +
                '<div class="adarsh-skeleton-block" style="height:112px;border-radius:16px;margin-bottom:12px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:56px;border-radius:12px;margin-bottom:8px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:56px;border-radius:12px;margin-bottom:8px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:56px;border-radius:12px;margin-bottom:8px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:56px;border-radius:12px;"></div>';
        }

        if (kind === 'clients' || kind === 'groups' || kind === 'staff' || kind === 'website') {
            return top +
                '<div class="adarsh-skeleton-block" style="height:42px;border-radius:12px;margin-bottom:10px;"></div>' +
                '<div class="adarsh-skeleton-grid2" style="margin-bottom:10px;">' +
                    '<div class="adarsh-skeleton-block" style="height:78px;border-radius:14px;"></div>' +
                    '<div class="adarsh-skeleton-block" style="height:78px;border-radius:14px;"></div>' +
                '</div>' +
                '<div class="adarsh-skeleton-block" style="height:74px;border-radius:14px;margin-bottom:10px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:74px;border-radius:14px;margin-bottom:10px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:74px;border-radius:14px;"></div>';
        }

        if (kind === 'camera' || kind === 'notifications') {
            return top +
                '<div class="adarsh-skeleton-block" style="height:240px;border-radius:18px;margin-bottom:12px;"></div>' +
                '<div class="adarsh-skeleton-grid2" style="margin-bottom:10px;">' +
                    '<div class="adarsh-skeleton-block" style="height:52px;border-radius:12px;"></div>' +
                    '<div class="adarsh-skeleton-block" style="height:52px;border-radius:12px;"></div>' +
                '</div>' +
                '<div class="adarsh-skeleton-block" style="height:68px;border-radius:14px;"></div>';
        }

        return top +
            '<div class="adarsh-skeleton-grid2" style="margin-bottom:14px;">' +
                '<div class="adarsh-skeleton-block" style="height:78px;border-radius:14px;"></div>' +
                '<div class="adarsh-skeleton-block" style="height:78px;border-radius:14px;"></div>' +
            '</div>' +
            '<div class="adarsh-skeleton-block" style="height:84px;border-radius:14px;margin-bottom:10px;"></div>' +
            '<div class="adarsh-skeleton-block" style="height:84px;border-radius:14px;margin-bottom:10px;"></div>' +
            '<div class="adarsh-skeleton-block" style="height:84px;border-radius:14px;"></div>';
    }

    function setRouteSkeletonForHref(rawHref) {
        var shell = ensureRouteSkeleton();
        if (!shell) return;
        var content = shell.querySelector('#mobile-route-skeleton-content');
        if (!content) return;
        var kind = inferSkeletonKindFromHref(rawHref);
        shell.setAttribute('data-route-kind', kind);
        content.innerHTML = renderPageSkeleton(kind);
    }

    var skeletonTimer = null;
    var progressGuardTimer = null;
    var progressHideTimer = null;
    var progressRampTimer = null;
    var actionProgressGuardTimer = null;
    var actionProgressHideTimer = null;
    var actionProgressRampTimer = null;
    var activeActionRequests = 0;
    var prefetchedRoutes = Object.create(null);
    var prefetchedRouteCount = 0;
    var PREFETCH_ROUTE_LIMIT = 6;

    function ensureRouteProgress() {
        var existing = document.getElementById('mobile-route-progress');
        if (existing) return existing;
        var bar = document.createElement('div');
        bar.id = 'mobile-route-progress';
        document.body.appendChild(bar);
        return bar;
    }

    function clearProgressTimers() {
        if (progressGuardTimer) {
            clearTimeout(progressGuardTimer);
            progressGuardTimer = null;
        }
        if (progressHideTimer) {
            clearTimeout(progressHideTimer);
            progressHideTimer = null;
        }
        if (progressRampTimer) {
            clearTimeout(progressRampTimer);
            progressRampTimer = null;
        }
    }

    function startRouteProgress() {
        var bar = ensureRouteProgress();
        clearProgressTimers();
        document.body.classList.add('mobile-route-progress-active');
        bar.style.transition = 'none';
        bar.style.width = '0%';
        bar.offsetWidth;
        bar.style.transition = 'width 560ms cubic-bezier(0.22,1,0.36,1)';
        bar.style.width = '70%';

        progressRampTimer = setTimeout(function() {
            bar.style.transition = 'width 1200ms linear';
            bar.style.width = '86%';
        }, 580);

        progressGuardTimer = setTimeout(function() {
            hideRouteProgress(true);
        }, 1700);
    }

    function finishRouteProgress() {
        var bar = ensureRouteProgress();
        clearProgressTimers();
        document.body.classList.add('mobile-route-progress-active');
        bar.style.transition = 'width 180ms ease-out';
        bar.style.width = '100%';
        progressHideTimer = setTimeout(function() {
            hideRouteProgress(true);
        }, 220);
    }

    function hideRouteProgress(immediate) {
        var bar = document.getElementById('mobile-route-progress');
        clearProgressTimers();
        if (!bar) return;
        if (!immediate) {
            finishRouteProgress();
            return;
        }
        document.body.classList.remove('mobile-route-progress-active');
        bar.style.transition = 'none';
        bar.style.width = '0%';
    }

    function ensureActionProgress() {
        var existing = document.getElementById('mobile-action-progress');
        if (existing) return existing;
        var bar = document.createElement('div');
        bar.id = 'mobile-action-progress';
        document.body.appendChild(bar);
        return bar;
    }

    function clearActionProgressTimers() {
        if (actionProgressGuardTimer) {
            clearTimeout(actionProgressGuardTimer);
            actionProgressGuardTimer = null;
        }
        if (actionProgressHideTimer) {
            clearTimeout(actionProgressHideTimer);
            actionProgressHideTimer = null;
        }
        if (actionProgressRampTimer) {
            clearTimeout(actionProgressRampTimer);
            actionProgressRampTimer = null;
        }
    }

    function startActionProgress() {
        var bar = ensureActionProgress();
        if (!bar) return;
        if (activeActionRequests === 0) {
            clearActionProgressTimers();
            document.body.classList.add('mobile-action-progress-active');
            bar.style.transition = 'none';
            bar.style.width = '0%';
            bar.offsetWidth;
            bar.style.transition = 'width 260ms ease-out';
            bar.style.width = '24%';

            actionProgressRampTimer = setTimeout(function() {
                bar.style.transition = 'width 1000ms linear';
                bar.style.width = '84%';
            }, 260);

            actionProgressGuardTimer = setTimeout(function() {
                finishActionProgress();
            }, 18000);
        }
        activeActionRequests += 1;
    }

    function finishActionProgress() {
        if (activeActionRequests > 0) {
            activeActionRequests -= 1;
        }
        if (activeActionRequests > 0) return;

        var bar = ensureActionProgress();
        if (!bar) return;
        clearActionProgressTimers();
        bar.style.transition = 'width 180ms ease-out';
        bar.style.width = '100%';
        actionProgressHideTimer = setTimeout(function() {
            document.body.classList.remove('mobile-action-progress-active');
            bar.style.transition = 'none';
            bar.style.width = '0%';
        }, 220);
    }

    function getRequestMethod(input, init) {
        var method = '';
        if (init && init.method) {
            method = init.method;
        } else if (input && typeof input === 'object' && input.method) {
            method = input.method;
        }
        return String(method || 'GET').toUpperCase();
    }

    function getHeaderValue(headers, key) {
        if (!headers) return '';
        var target = String(key || '').toLowerCase();

        if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            var found = headers.get(key);
            return String(found || '');
        }

        if (Array.isArray(headers)) {
            for (var i = 0; i < headers.length; i++) {
                var row = headers[i];
                if (!row || row.length < 2) continue;
                if (String(row[0] || '').toLowerCase() === target) {
                    return String(row[1] || '');
                }
            }
            return '';
        }

        if (typeof headers === 'object') {
            var keys = Object.keys(headers);
            for (var k = 0; k < keys.length; k++) {
                var name = keys[k];
                if (String(name || '').toLowerCase() === target) {
                    return String(headers[name] || '');
                }
            }
        }
        return '';
    }

    function shouldTrackActionRequest(input, init) {
        var method = getRequestMethod(input, init);
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;

        var headers = (init && init.headers) || (input && typeof input === 'object' ? input.headers : null);
        var skipHeader = getHeaderValue(headers, 'X-Skip-Action-Progress');
        if (String(skipHeader || '').toLowerCase() === '1' || String(skipHeader || '').toLowerCase() === 'true') {
            return false;
        }
        return true;
    }

    if (typeof window.fetch === 'function' && !window.__adarshMobileActionFetchWrapped) {
        var originalFetch = window.fetch;
        window.fetch = function wrappedMobileFetch(input, init) {
            var track = shouldTrackActionRequest(input, init);
            if (track) startActionProgress();

            var requestPromise;
            try {
                requestPromise = originalFetch.apply(this, arguments);
            } catch (err) {
                if (track) finishActionProgress();
                throw err;
            }

            if (!track || !requestPromise || typeof requestPromise.then !== 'function') {
                return requestPromise;
            }

            return requestPromise.then(function(result) {
                finishActionProgress();
                return result;
            }).catch(function(error) {
                finishActionProgress();
                throw error;
            });
        };
        window.__adarshMobileActionFetchWrapped = true;
    }

    if (window.XMLHttpRequest && !window.__adarshMobileActionXhrWrapped) {
        var originalXhrOpen = XMLHttpRequest.prototype.open;
        var originalXhrSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function wrappedMobileXhrOpen(method) {
            this.__adarshMobileMethod = String(method || 'GET').toUpperCase();
            return originalXhrOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function wrappedMobileXhrSend() {
            var method = String(this.__adarshMobileMethod || 'GET');
            var track = !(method === 'GET' || method === 'HEAD' || method === 'OPTIONS');
            if (track) {
                startActionProgress();
                this.addEventListener('loadend', finishActionProgress, { once: true });
            }
            return originalXhrSend.apply(this, arguments);
        };

        window.__adarshMobileActionXhrWrapped = true;
    }

    function canPrefetchRoutes() {
        if (!navigator.onLine) return false;
        var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!conn) return true;
        if (conn.saveData) return false;
        var effectiveType = String(conn.effectiveType || '').toLowerCase();
        if (effectiveType.indexOf('2g') !== -1 || effectiveType.indexOf('3g') !== -1) return false;
        var downlink = Number(conn.downlink || 0);
        if (downlink > 0 && downlink < 1.5) return false;
        return true;
    }

    function resolveTrackedRouteHref(rawHref) {
        var href = String(rawHref || '').trim();
        if (!href || href.charAt(0) === '#') return '';
        if (href.indexOf('javascript:') === 0 || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) {
            return '';
        }

        try {
            var resolved = new URL(href, window.location.href);
            if (resolved.origin !== window.location.origin) return '';
            if (resolved.pathname.indexOf('/app/') !== 0 && resolved.pathname !== '/app') return '';
            var normalized = resolved.pathname + resolved.search;
            var current = window.location.pathname + window.location.search;
            if (normalized === current) return '';
            return normalized;
        } catch (err) {
            return '';
        }
    }

    function prefetchRoute(href) {
        if (!canPrefetchRoutes()) return false;
        if (prefetchedRouteCount >= PREFETCH_ROUTE_LIMIT) return false;
        var normalizedHref = resolveTrackedRouteHref(href);
        if (!normalizedHref) return false;
        if (prefetchedRoutes[normalizedHref]) return false;
        prefetchedRoutes[normalizedHref] = true;

        try {
            var prefetchLink = document.createElement('link');
            prefetchLink.rel = 'prefetch';
            prefetchLink.as = 'document';
            prefetchLink.href = normalizedHref;
            document.head.appendChild(prefetchLink);
            prefetchedRouteCount += 1;
            return true;
        } catch (err) {
            return false;
        }
    }

    function warmupLikelyRoutes() {
        if (!canPrefetchRoutes()) return;
        var anchors = document.querySelectorAll('.pwa-bottom-nav a[href], .pwa-nav-search-btn[href], a[href^="/app/"]');
        var limit = 4;
        for (var i = 0; i < anchors.length && limit > 0; i++) {
            var anchor = anchors[i];
            if (!anchor || anchor.hasAttribute('data-no-prefetch')) continue;
            if (prefetchRoute(anchor.getAttribute('href'))) {
                limit -= 1;
            }
        }
    }

    function scheduleWarmupLikelyRoutes() {
        if (document.visibilityState === 'hidden') return;
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(warmupLikelyRoutes, { timeout: 1300 });
            return;
        }
        setTimeout(warmupLikelyRoutes, 480);
    }

    function runWhenIdle(task, timeoutMs) {
        if (typeof task !== 'function') return;
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(task, { timeout: timeoutMs || 1000 });
            return;
        }
        setTimeout(task, 120);
    }

    var activeTapEl = null;
    function clearTapState() {
        if (!activeTapEl) return;
        activeTapEl.classList.remove('mobile-tap-active');
        activeTapEl = null;
    }

    function updateTapState(event) {
        var target = event && event.target;
        if (!target || !target.closest) return;
        var tappable = target.closest('a,button,[role="button"],.pwa-nav-item,.pwa-nav-search-btn,.mab-nav-item,.mab-center-btn,label');
        if (!tappable || tappable.disabled || tappable.getAttribute('aria-disabled') === 'true') {
            clearTapState();
            return;
        }
        if (activeTapEl === tappable) return;
        clearTapState();
        activeTapEl = tappable;
        activeTapEl.classList.add('mobile-tap-active');
    }

    function showRouteSkeleton(rawHref) {
        var shell = ensureRouteSkeleton();
        setRouteSkeletonForHref(rawHref || pendingRouteHref || window.location.href);
        if (shell) shell.style.display = 'block';
    }

    function hideRouteSkeleton() {
        if (skeletonTimer) {
            clearTimeout(skeletonTimer);
            skeletonTimer = null;
        }
        var shell = document.getElementById('mobile-route-skeleton');
        if (shell) shell.style.display = 'none';
        pendingRouteHref = '';
        clearTapState();
    }

    function shouldTrackAnchor(anchor) {
        if (!anchor) return false;
        if (anchor.hasAttribute('download')) return false;
        if (anchor.getAttribute('target') === '_blank') return false;
        if (anchor.hasAttribute('data-no-page-transition')) return false;

        return !!resolveTrackedRouteHref(anchor.getAttribute('href'));
    }

    function handleAnchorPrefetchIntent(event) {
        var target = event && event.target;
        if (!target || !target.closest) return;
        var anchor = target.closest('a[href]');
        if (!shouldTrackAnchor(anchor)) return;
        prefetchRoute(anchor.getAttribute('href'));
    }

    document.addEventListener('click', function(event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var anchor = target.closest('a[href]');
        if (!shouldTrackAnchor(anchor)) return;
        if (event.defaultPrevented) return;

        pendingRouteHref = anchor.getAttribute('href') || '';
        prefetchRoute(pendingRouteHref);
        startRouteProgress();
        if (skeletonTimer) clearTimeout(skeletonTimer);
        skeletonTimer = setTimeout(function() {
            showRouteSkeleton(pendingRouteHref);
        }, 70);
        setTimeout(function() {
            hideRouteProgress(true);
        }, 1400);
    }, true);

    document.addEventListener('pointerdown', updateTapState, true);
    document.addEventListener('touchstart', updateTapState, true);
    document.addEventListener('pointerup', clearTapState, true);
    document.addEventListener('pointercancel', clearTapState, true);
    document.addEventListener('touchcancel', clearTapState, true);
    document.addEventListener('touchend', clearTapState, true);

    document.addEventListener('pointerdown', handleAnchorPrefetchIntent, { capture: true, passive: true });
    document.addEventListener('touchstart', handleAnchorPrefetchIntent, { capture: true, passive: true });
    document.addEventListener('focusin', handleAnchorPrefetchIntent, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleWarmupLikelyRoutes, { once: true });
    } else {
        scheduleWarmupLikelyRoutes();
    }

    // Prebuild the route skeleton during idle time to avoid first-navigation jank.
    runWhenIdle(function() {
        ensureRouteSkeleton();
    }, 900);

    window.addEventListener('pageshow', function() {
        hideRouteSkeleton();
        finishRouteProgress();
        scheduleWarmupLikelyRoutes();
    });
    window.addEventListener('pagehide', function() {
        hideRouteSkeleton();
        hideRouteProgress(true);
    });
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            hideRouteSkeleton();
            hideRouteProgress(true);
        }
    });

    function markMediaLazy(root) {
        var scope = root || document;
        if (!scope || !scope.querySelectorAll) return;

        scope.querySelectorAll('img').forEach(function(img) {
            if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
            if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
            if (img.hasAttribute('fetchpriority') && img.getAttribute('fetchpriority') === 'high') return;
            if (!img.hasAttribute('fetchpriority')) img.setAttribute('fetchpriority', 'low');
        });

        scope.querySelectorAll('video').forEach(function(video) {
            if (!video.hasAttribute('preload')) {
                video.setAttribute('preload', 'metadata');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            runWhenIdle(function() {
                markMediaLazy(document);
            }, 1200);
        }, { once: true });
    } else {
        runWhenIdle(function() {
            markMediaLazy(document);
        }, 1200);
    }

    var bridge = window.adarshDeviceBridge || null;
    if (!bridge || typeof bridge.getDeferredSyncState !== 'function') {
        return;
    }

    function canShowDeferredSyncBadgeForRole() {
        var role = '';
        try {
            role = String((document.body && document.body.getAttribute('data-user-role')) || '').trim().toLowerCase();
        } catch (err) {
            role = '';
        }

        // Show operational sync badge only for admin surfaces.
        return role === 'super_admin' || role === 'admin_staff';
    }

    if (!canShowDeferredSyncBadgeForRole()) {
        return;
    }

    function ensureSyncBadge() {
        var existing = document.getElementById('mobile-deferred-sync-badge');
        if (existing) return existing;

        var badge = document.createElement('div');
        badge.id = 'mobile-deferred-sync-badge';
        badge.style.position = 'fixed';
        badge.style.left = '50%';
        badge.style.bottom = '74px';
        badge.style.transform = 'translateX(-50%)';
        badge.style.padding = '7px 12px';
        badge.style.borderRadius = '999px';
        badge.style.background = 'rgba(16,24,40,0.92)';
        badge.style.color = '#ffffff';
        badge.style.fontSize = '11px';
        badge.style.fontWeight = '600';
        badge.style.boxShadow = '0 12px 30px rgba(2,8,23,0.28)';
        badge.style.zIndex = '10055';
        badge.style.display = 'none';
        badge.style.pointerEvents = 'none';
        document.body.appendChild(badge);
        return badge;
    }

    var badgeHideTimer = null;
    function renderSyncBadge(state) {
        var badge = ensureSyncBadge();
        if (!badge) return;

        var pending = Number(state && state.totalPending || 0);
        var online = !!(state && state.online);
        if (pending <= 0) {
            if (badgeHideTimer) clearTimeout(badgeHideTimer);
            badgeHideTimer = setTimeout(function() {
                badge.style.display = 'none';
            }, 850);
            return;
        }

        if (badgeHideTimer) {
            clearTimeout(badgeHideTimer);
            badgeHideTimer = null;
        }

        badge.style.display = 'block';
        badge.textContent = online
            ? ('Sync pending: ' + pending + ' saved change(s)')
            : ('Saved offline: ' + pending + ' change(s)');
    }

    async function refreshSyncBadge() {
        if (document.visibilityState === 'hidden') {
            return;
        }
        try {
            var state = await bridge.getDeferredSyncState();
            renderSyncBadge(state || {});
        } catch (err) {}
    }

    window.addEventListener('adarsh:deferred-sync-state', function(event) {
        renderSyncBadge(event && event.detail ? event.detail : {});
    });
    window.addEventListener('online', refreshSyncBadge);
    window.addEventListener('offline', refreshSyncBadge);
    setInterval(refreshSyncBadge, 90000);
    refreshSyncBadge();
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
    var lastPermissionToastAt = 0;

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

            var isApkLink = /\.apk(?:\?|#|$)/i.test(href);
            if (!isExternalHttpUrl(href) && !isApkLink) return;

            var targetUrl = href;
            if (isApkLink) {
                try {
                    var resolved = new URL(href, window.location.href);
                    resolved.searchParams.set('_ts', String(Date.now()));
                    targetUrl = resolved.toString();
                } catch (err) {
                    targetUrl = href;
                }
            }

            event.preventDefault();
            href = targetUrl;
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
                try {
                    window.history.back();
                } catch (err) {
                    window.mobileOverlay.close();
                }
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

    function showNativePermissionToast(message) {
        if (!Toast || typeof Toast.show !== 'function') return;
        var msg = String(message || '').trim();
        if (!msg) return;

        var now = Date.now();
        if (now - lastPermissionToastAt < 2000) {
            return;
        }
        lastPermissionToastAt = now;
        Toast.show({ text: msg }).catch(function() {});
    }

    function setupNativePermissionIssueListener() {
        window.addEventListener('adarsh:native-permission-issue', function(event) {
            var detail = event && event.detail ? event.detail : {};
            var fallback = 'Permission is required for this action. Please allow it from app settings.';
            showNativePermissionToast(detail.message || fallback);
        });
    }

    async function warmupAndroidPermissionState() {
        if (!bridge || typeof bridge.checkPermissionBundle !== 'function') return;
        try {
            var state = await bridge.checkPermissionBundle();
            if (state && (state.photos === 'denied' || state.camera === 'denied' || state.storage === 'denied')) {
                showNativePermissionToast('Camera, gallery, or storage permission is disabled. Enable it in app settings.');
            }
        } catch (err) {}
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

                    var mobileApiRegisterUrl = '/api/mobile/mobile-shell/device/register/';

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
            var mobileApiPingUrl = '/api/mobile/mobile-shell/device/ping/';
            // enqueueCriticalJson('/api/mobile/mobile-shell/device/ping/', { ... });
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
        setupNativePermissionIssueListener();

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
        warmupAndroidPermissionState();
        registerPushToken(payloadBase, configPayload);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }
})();
