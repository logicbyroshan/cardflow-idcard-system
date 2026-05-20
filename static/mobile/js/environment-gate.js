(function initAdarshMobileEnv(window) {
    function getCapacitor() {
        return window.Capacitor || null;
    }

    function getPlatform() {
        var cap = getCapacitor();
        if (!cap || typeof cap.getPlatform !== 'function') return '';
        try {
            return String(cap.getPlatform() || '').toLowerCase();
        } catch (err) {
            return '';
        }
    }

    function isNativeShell() {
        var cap = getCapacitor();
        if (!cap || typeof cap.isNativePlatform !== 'function') return false;
        try {
            return !!cap.isNativePlatform();
        } catch (err) {
            return false;
        }
    }

    function isStandalonePwa() {
        var standalone = false;
        try {
            standalone = window.navigator && window.navigator.standalone === true;
        } catch (err) {
            standalone = false;
        }

        var displayMode = false;
        try {
            displayMode = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        } catch (err) {
            displayMode = false;
        }

        return !!(standalone || displayMode);
    }

    function isLikelyMobileBrowserContext() {
        var ua = '';
        try {
            ua = String(window.navigator && window.navigator.userAgent || '');
        } catch (err) {
            ua = '';
        }

        var mobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        var narrowViewport = false;
        try {
            narrowViewport = window.innerWidth <= 768;
        } catch (err) {
            narrowViewport = false;
        }

        return !!(mobileUa || narrowViewport);
    }

    function isMobileBrowser() {
        return isLikelyMobileBrowserContext() && !isNativeShell();
    }

    function canShowInstallCta() {
        return isMobileBrowser() && !isStandalonePwa() && !isNativeShell();
    }

    function shouldUseNativeUpdateUi() {
        return isNativeShell();
    }

    window.adarshMobileEnv = {
        getPlatform: getPlatform,
        isNativeShell: isNativeShell,
        isStandalonePwa: isStandalonePwa,
        isLikelyMobileBrowserContext: isLikelyMobileBrowserContext,
        isMobileBrowser: isMobileBrowser,
        canShowInstallCta: canShowInstallCta,
        shouldUseNativeUpdateUi: shouldUseNativeUpdateUi,
    };

    try {
        var mode = isNativeShell() ? 'native-shell' : (isStandalonePwa() ? 'standalone-pwa' : (isMobileBrowser() ? 'mobile-browser' : 'desktop-browser'));
        if (window.document && window.document.documentElement) {
            window.document.documentElement.setAttribute('data-mobile-env-mode', mode);
        }
    } catch (err) {}

    try {
        window.dispatchEvent(new CustomEvent('adarsh:mobile-env-ready'));
    } catch (err) {}
})(window);
