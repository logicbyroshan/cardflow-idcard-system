/**
 * modal-loader.js  Lazy-loads modals HTML on first user interaction.
 *
 * Instead of pre-rendering all 11 modals in the initial page HTML (~424 lines,
 * ~300 DOM nodes), this module fetches them on demand from the server and
 * injects them into #modals-container.
 *
 * Strategy:
 *  1. On first user interaction (pointermove, click, touchstart, keydown,
 *     focus on any input), fire off the fetch.
 *  2. After injection, re-run all modal init functions so event listeners
 *     get bound to the freshly-injected elements.
 *  3. Expose window.ensureModalsLoaded()  Promise for any code path that
 *     must guarantee modals exist before proceeding.
 *
 * All existing init functions use `if (element)` guards, so they already
 * no-op during the initial init when modals aren't in the DOM yet. The
 * re-init after injection is safe  the only side-effect is a few extra
 * harmless document-level keydown listeners whose closure-captured
 * references are null and thus never fire.
 */
(function () {
    'use strict';

    var _loaded = false;
    var _loading = false;
    var _promise = null;
    var _container = null;

    // Resolve TABLE_ID from global scope (set by idcard-actions.html)
    function _getTableId() {
        if (typeof TABLE_ID !== 'undefined') return TABLE_ID;
        if (window.IDCardApp && window.IDCardApp.tableId) return window.IDCardApp.tableId;
        return null;
    }

    /**
     * Fetch modals HTML from the server and inject into the container.
     * Returns a Promise that resolves once modals are in the DOM and inited.
     */
    function _loadModals() {
        if (_loaded) return Promise.resolve();
        if (_loading) return _promise;

        _loading = true;
        var tableId = _getTableId();
        if (!tableId) {
            console.warn('[modal-loader] TABLE_ID not available, cannot load modals.');
            _loading = false;
            return Promise.resolve();
        }

        _container = document.getElementById('modals-container');
        if (!_container) {
            console.warn('[modal-loader] #modals-container not found.');
            _loading = false;
            return Promise.resolve();
        }

        var url = '/api/table/' + tableId + '/modals-html/';

        _promise = fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
        .then(function (resp) {
            if (!resp.ok) throw new Error('Modal fetch failed: ' + resp.status);
            return resp.text();
        })
        .then(function (html) {
            _container.innerHTML = html;
            _loaded = true;
            _loading = false;
            _initModalsAfterLoad();
        })
        .catch(function (err) {
            console.error('[modal-loader] Failed to load modals:', err);
            _loading = false;
            // Allow retry on next interaction
            _promise = null;
        });

        return _promise;
    }

    /**
     * Re-run all modal-specific init functions after injection.
     * These functions already exist on window.IDCardApp, registered by
     * idcard-actions-upload.js, idcard-actions-download.js,
     * idcard-actions-search.js, and idcard-actions-modal.js.
     */
    function _initModalsAfterLoad() {
        var app = window.IDCardApp || {};

        // Upload module  binds to #uploadModalOverlay
        if (typeof app.initUploadModule === 'function') {
            try { app.initUploadModule(); } catch (e) { console.error('[modal-loader] initUploadModule error:', e); }
        }

        // Download module  binds all download/reupload/docformat modals
        if (typeof app.initDownloadModule === 'function') {
            try { app.initDownloadModule(); } catch (e) { console.error('[modal-loader] initDownloadModule error:', e); }
        }

        // Search module modal inits  Image Sort + Search All
        if (typeof app.initSearchAllModal === 'function') {
            try { app.initSearchAllModal(); } catch (e) { console.error('[modal-loader] initSearchAllModal error:', e); }
        }
        if (typeof app.initImageSortModal === 'function') {
            try { app.initImageSortModal(); } catch (e) { console.error('[modal-loader] initImageSortModal error:', e); }
        }

        // Modal module  Delete modal + Simple Delete modal
        // We call the specific sub-inits rather than the full initModalModule
        // because initModalModule also handles the side-modal which is already in DOM.
        if (typeof app.initDeleteModal === 'function') {
            try { app.initDeleteModal(); } catch (e) { console.error('[modal-loader] initDeleteModal error:', e); }
        }
        if (typeof app.initSimpleDeleteModal === 'function') {
            try { app.initSimpleDeleteModal(); } catch (e) { console.error('[modal-loader] initSimpleDeleteModal error:', e); }
        }

        // Dispatch event for any other code that needs to know modals are ready
        document.dispatchEvent(new CustomEvent('modals-loaded'));
    }

    // ==========================================
    // PUBLIC API
    // ==========================================

    /**
     * Ensure modals are loaded. Returns a Promise.
     * Use before any code that must interact with a modal element.
     *
     * Example:
     *   ensureModalsLoaded().then(function() { openUploadModal(); });
     */
    window.ensureModalsLoaded = function () {
        if (_loaded) return Promise.resolve();
        return _loadModals();
    };

    // ==========================================
    // INTERACTION-BASED PRELOAD
    // ==========================================

    var _preloadTriggered = false;
    var _interactionEvents = ['pointermove', 'click', 'touchstart', 'keydown'];

    function _onFirstInteraction() {
        if (_preloadTriggered) return;
        _preloadTriggered = true;

        // Remove all listeners
        _interactionEvents.forEach(function (evt) {
            document.removeEventListener(evt, _onFirstInteraction, { capture: true });
        });

        // Trigger load
        _loadModals();
    }

    // Also preload via requestIdleCallback if available (low-priority background)
    function _schedulePreload() {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(function () {
                if (!_preloadTriggered) {
                    _preloadTriggered = true;
                    _interactionEvents.forEach(function (evt) {
                        document.removeEventListener(evt, _onFirstInteraction, { capture: true });
                    });
                    _loadModals();
                }
            }, { timeout: 3000 });
        }
    }

    // Attach interaction listeners
    _interactionEvents.forEach(function (evt) {
        document.addEventListener(evt, _onFirstInteraction, { capture: true, once: false, passive: true });
    });

    // Also schedule idle preload as backup
    if (document.readyState === 'complete') {
        _schedulePreload();
    } else {
        window.addEventListener('load', _schedulePreload);
    }

})();
