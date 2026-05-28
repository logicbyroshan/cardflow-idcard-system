/**
 * Core API Module
 * Single API wrapper  every fetch call in the app routes through here.
 *
 * Provides:
 *   ApiClient.get(url, options)
 *   ApiClient.post(url, data, options)
 *   ApiClient.put(url, data, options)
 *   ApiClient.delete(url, data, options)
 *   ApiClient.upload(url, formData, options)
 *   ApiClient.download(url, method, data, options)
 *   ApiClient.downloadBlob(blob, filename)
 *   ApiClient.downloadBase64(b64, filename, mime)
 *   ApiClient.getCSRFToken()
 *
 * Centralises: CSRF handling, JSON parsing, error formatting, toast display.
 *
 * @module core/api
 * @version 3.0.0
 */

/* ================================================
   GLOBAL 403/401 FETCH INTERCEPTOR
   Catches permission-denied and expired-session responses
   from ALL fetch() calls and handles them appropriately.
   ================================================ */
(function () {
    'use strict';
    var _originalFetch = window.fetch;
    
    // Auto-detect API base URL based on current path if not explicitly provided by Django templates
    if (typeof window.API_BASE_URL !== 'string') {
        window.API_BASE_URL = window.location.pathname.startsWith('/panel/') ? '/panel' : (window.location.pathname.startsWith('/app/') ? '/app' : '');
    }
    function _getSessionRefreshUrl() {
        var prefix = '';
        if (window.location.pathname.startsWith('/panel/')) {
            prefix = '/panel';
        } else if (window.location.pathname.startsWith('/app/')) {
            prefix = '/app';
        }
        return prefix + '/auth/api/auth/session-refresh/';
    }
    window.getSessionRefreshUrl = _getSessionRefreshUrl;
    /** True when the current page is the login page itself. */
    var _isLoginPage = window.location.pathname.indexOf('/auth/login') !== -1;

    window.fetch = function (url, options) {
        if (typeof url === 'string' && window.IS_CLIENT_USER === true) {
            if (url.startsWith('/api/card/') && url.indexOf('/status/') !== -1) {
                url = '/client' + url;
            } else if (url.startsWith('/api/table/') && url.indexOf('/cards/bulk-status/') !== -1) {
                url = '/client' + url;
            } else if (url.startsWith('/panel/api/table/') && url.indexOf('/cards/bulk-status/') !== -1) {
                url = url.replace('/panel/api/table/', '/panel/client/api/table/');
            } else if (url.startsWith('/panel/api/card/') && url.indexOf('/status/') !== -1) {
                url = url.replace('/panel/api/card/', '/panel/client/api/card/');
            }
        }
        // Prepend global API prefix if it exists and URL is a root-relative API call.
        // Do NOT prefix client-scoped or app-scoped API routes — they are intentionally root-scoped.
        if (typeof url === 'string' && url.startsWith('/') && url.indexOf('/api/') !== -1 && typeof window.API_BASE_URL === 'string' && !url.startsWith(window.API_BASE_URL) && !url.startsWith('/client/') && !url.startsWith('/app/')) {
            url = window.API_BASE_URL + url;
        }

        return _originalFetch.call(this, url, options).then(function (response) {
            //  Redirect detection 
            // If the server redirected (302  login page) and we're NOT
            // already on the login page, the session is expired/invalid.
            if (response.redirected && !_isLoginPage) {
                var finalUrl = response.url || '';
                if (finalUrl.indexOf('/auth/login') !== -1 || finalUrl.indexOf('/login') !== -1) {
                    window.location.href = '/auth/login/';
                    // Return a synthetic "session expired" JSON so callers
                    // don't fail with a JSON-parse error on the HTML body.
                    return new Response(JSON.stringify({
                        success: false,
                        message: 'Session expired. Redirecting to login'
                    }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            }

            if (response.status === 401) {
                // Session expired (e.g., logged out in another tab)
                response.clone().json()
                    .then(function (data) {
                        if (data && data.redirect) {
                            window.location.href = data.redirect;
                        } else {
                            window.location.href = '/auth/login/';
                        }
                    })
                    .catch(function () {
                        window.location.href = '/auth/login/';
                    });
            }
            if (response.status === 403) {
                response.clone().json()
                    .then(function (data) {
                        var msg = (data && data.message) || 'Permission denied';
                        // Don't show toast for CSRF failures — ApiClient._request
                        // will auto-retry with a fresh token silently.
                        if (_isCsrfError(msg)) return;
                        if (typeof window.showToast === 'function') {
                            window.showToast(msg, 'error', 5000);
                        }
                    })
                    .catch(function () {
                        if (typeof window.showToast === 'function') {
                            window.showToast('Permission denied', 'error', 5000);
                        }
                    });
            }
            return response;
        });
    };

    /** Check if a 403 error message is a CSRF/token-expired issue. */
    function _isCsrfError(msg) {
        if (!msg) return false;
        var lower = msg.toLowerCase();
        return lower.indexOf('csrf') !== -1
            || lower.indexOf('token expired') !== -1
            || lower.indexOf('security token') !== -1
            || lower.indexOf('session expired') !== -1
            || lower.indexOf('session may have expired') !== -1;
    }

    // Expose for use by ApiClient
    window._isCsrfError = _isCsrfError;
})();

/* ================================================
   ApiClient  the single authority for network IO
   ================================================ */
(function () {
    'use strict';

    // ------------------------------------------
    // CSRF TOKEN
    // ------------------------------------------
    function getCSRFToken() {
        // Priority: meta tag (updated by session-keepalive) > cookie > hidden input
        var meta = document.querySelector('meta[name="csrf-token"]');
        if (meta && meta.getAttribute('content')) return meta.getAttribute('content');

        var cookie = document.cookie.split(';').find(function (c) {
            return c.trim().startsWith('csrftoken=');
        });
        if (cookie) return cookie.split('=')[1];

        var hidden = document.querySelector('input[name="csrfmiddlewaretoken"]');
        if (hidden) return hidden.value;

        return '';
    }
    // Expose globally so logout forms and other non-bundled code can use it
    window.getCSRFToken = getCSRFToken;

    // ------------------------------------------
    // DEFAULTS
    // ------------------------------------------
    var DEFAULTS = { timeout: 30000, retries: 0, retryDelay: 1000 };

    // ------------------------------------------
    // CSRF AUTO-REFRESH (silent recovery)
    // ------------------------------------------
    var _csrfRefreshPromise = null;

    /**
     * Fetch a fresh CSRF token from the server.
     * Deduplicates: if a refresh is already in-flight, returns the same promise.
     */
    function _refreshCSRF() {
        if (_csrfRefreshPromise) return _csrfRefreshPromise;

        _csrfRefreshPromise = new Promise(function (resolve) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', _getSessionRefreshUrl(), true);
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            xhr.timeout = 8000;

            xhr.onload = function () {
                _csrfRefreshPromise = null;
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        if (data.csrf_token) {
                            // Update meta tag + hidden inputs
                            var meta = document.querySelector('meta[name="csrf-token"]');
                            if (meta) meta.setAttribute('content', data.csrf_token);
                            var hiddens = document.querySelectorAll('input[name="csrfmiddlewaretoken"]');
                            for (var i = 0; i < hiddens.length; i++) hiddens[i].value = data.csrf_token;
                            resolve(data.csrf_token);
                            return;
                        }
                    } catch (e) {}
                }
                resolve(null);
            };
            xhr.onerror = function () { _csrfRefreshPromise = null; resolve(null); };
            xhr.ontimeout = function () { _csrfRefreshPromise = null; resolve(null); };
            xhr.send();
        });

        return _csrfRefreshPromise;
    }

    // ------------------------------------------
    // LOW-LEVEL FETCH WRAPPER
    // ------------------------------------------
    async function _request(url, method, data, options) {
        if (typeof url === 'string' && window.IS_CLIENT_USER === true) {
            if (url.startsWith('/api/card/') && url.indexOf('/status/') !== -1) {
                url = '/client' + url;
            } else if (url.startsWith('/api/table/') && url.indexOf('/cards/bulk-status/') !== -1) {
                url = '/client' + url;
            } else if (url.startsWith('/panel/api/table/') && url.indexOf('/cards/bulk-status/') !== -1) {
                url = url.replace('/panel/api/table/', '/panel/client/api/table/');
            } else if (url.startsWith('/panel/api/card/') && url.indexOf('/status/') !== -1) {
                url = url.replace('/panel/api/card/', '/panel/client/api/card/');
            }
        }
        // Prepend global API prefix if it exists and URL is a root-relative API call.
        // Skip prefixing for client-/app-scoped routes which intentionally start with those prefixes.
        if (typeof window.API_BASE_URL === 'string' && url.startsWith('/') && url.indexOf('/api/') !== -1 && !url.startsWith(window.API_BASE_URL) && !url.startsWith('/client/') && !url.startsWith('/app/')) {
            url = window.API_BASE_URL + url;
        }

        // Safeguard: block requests to external origins (prevents credential leaking)
        if (url.indexOf('://') !== -1 && url.indexOf(window.location.origin) !== 0) {
            return Promise.reject(new Error('API request blocked: external URL not allowed'));
        }

        var config = Object.assign({}, DEFAULTS, options);

        var headers = Object.assign({
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken(),
            'X-Requested-With': 'XMLHttpRequest'
        }, config.headers || {});

        var fetchOpts = { method: method.toUpperCase(), headers: headers };

        if (data && method.toUpperCase() !== 'GET') {
            fetchOpts.body = JSON.stringify(data);
        }

        // Support external AbortSignal for manual cancellation
        var controller = config.signal ? null : new AbortController();
        var signal = config.signal || controller.signal;
        
        // Only set timeout if we are using our own controller
        var tid = controller ? setTimeout(function () { controller.abort(); }, config.timeout) : null;
        fetchOpts.signal = signal;


        var lastError;
        var attempts = 0;
        var maxAttempts = config.retries + 1;

        while (attempts < maxAttempts) {
            try {
                var response = await fetch(url, fetchOpts);
                clearTimeout(tid);

                var ct = response.headers.get('content-type');
                var body;
                if (ct && ct.indexOf('application/json') !== -1) {
                    body = await response.json();
                } else {
                    body = await response.text();
                }

                if (!response.ok) {
                    var msg = (response.status === 403)
                        ? ((body && body.message) || 'Permission denied')
                        : ((body && body.message) || 'HTTP ' + response.status);
                    var err = new Error(msg);
                    err.status = response.status;
                    err.data = body;

                    // ── CSRF auto-recovery ──
                    // If this is a CSRF failure, silently refresh the token
                    // and retry the request ONCE before failing.
                    if (response.status === 403
                        && !config._csrfRetried
                        && typeof window._isCsrfError === 'function'
                        && window._isCsrfError(msg)) {

                        var freshToken = await _refreshCSRF();
                        if (freshToken) {
                            // Retry with fresh CSRF token
                            var retryOpts = Object.assign({}, options, { _csrfRetried: true });
                            return _request(url, method, data, retryOpts);
                        }
                    }

                    throw err;
                }
                return body;

            } catch (error) {
                lastError = error;
                attempts++;
                if (error.name === 'AbortError') {
                    lastError = new Error('Request timeout');
                    lastError.code = 'TIMEOUT';
                    break;
                }
                if (attempts < maxAttempts) {
                    await new Promise(function (r) { setTimeout(r, config.retryDelay); });
                }
            }
        }

        // Show toast only for true network/timeout errors, NOT for API errors
        // (API errors like 400/403 are handled by the caller)
        if (typeof window.showToast === 'function' && !lastError.status) {
            window.showToast(lastError.message || 'Network error', 'error');
        }
        throw lastError;
    }

    // ------------------------------------------
    // UPLOAD (FormData + XHR for progress)
    // ------------------------------------------
    function _upload(url, formData, options) {
        options = options || {};
        
        // Prepend global API prefix if it exists and URL is a root-relative API call.
        // Skip prefixing for client-/app-scoped routes which intentionally start with those prefixes.
        if (typeof window.API_BASE_URL === 'string' && url.startsWith('/') && url.indexOf('/api/') !== -1 && !url.startsWith(window.API_BASE_URL) && !url.startsWith('/client/') && !url.startsWith('/app/')) {
            url = window.API_BASE_URL + url;
        }

        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('X-CSRFToken', getCSRFToken());
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

            if (options.onProgress) {
                xhr.upload.onprogress = function (e) {
                    if (e.lengthComputable) {
                        options.onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
                    }
                };
            }

            xhr.onload = function () {
                try {
                    var resp = JSON.parse(xhr.responseText);
                    if (xhr.status >= 200 && xhr.status < 300) { resolve(resp); }
                    else { reject({ status: xhr.status, data: resp }); }
                } catch (_e) {
                    if (xhr.status >= 200 && xhr.status < 300) { resolve(xhr.responseText); }
                    else { reject({ status: xhr.status, message: 'Failed to parse response' }); }
                }
            };
            xhr.onerror = function () { reject({ message: 'Network error' }); };
            xhr.ontimeout = function () { reject({ message: 'Request timeout', code: 'TIMEOUT' }); };

            if (options.timeout) xhr.timeout = options.timeout;
            xhr.send(formData);
        });
    }

    // ------------------------------------------
    // DOWNLOAD (XHR with progress  Blob)
    // ------------------------------------------
    function _download(url, method, data, options) {
        method = method || 'GET';
        options = options || {};
        
        // Prepend global API prefix if it exists and URL is a root-relative API call
        if (typeof window.API_BASE_URL === 'string' && url.startsWith('/') && url.indexOf('/api/') !== -1 && !url.startsWith(window.API_BASE_URL)) {
            url = window.API_BASE_URL + url;
        }

        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.setRequestHeader('X-CSRFToken', getCSRFToken());
            if (data) xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.responseType = 'blob';

            if (options.onProgress) {
                xhr.onprogress = function (e) {
                    if (e.lengthComputable) {
                        options.onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
                    }
                };
            }

            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) { resolve(xhr.response); }
                else { reject({ status: xhr.status, message: 'HTTP ' + xhr.status }); }
            };
            xhr.onerror = function () { reject({ message: 'Network error' }); };
            xhr.send(data ? JSON.stringify(data) : null);
        });
    }

    // ------------------------------------------
    // BLOB / BASE64 HELPERS
    // ------------------------------------------
    function downloadBlob(blob, filename) {
        var u = window.URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.style.display = 'none';
        a.href = u;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(u);
        document.body.removeChild(a);
    }

    function downloadBase64(b64, filename, mime) {
        mime = mime || 'application/octet-stream';
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        downloadBlob(new Blob([bytes], { type: mime }), filename);
    }

    // ------------------------------------------
    // PUBLIC CLASS
    // ------------------------------------------
    var ApiClient = {
        getCSRFToken: getCSRFToken,

        get: function (url, options)             { return _request(url, 'GET', null, options); },
        post: function (url, data, options)      { return _request(url, 'POST', data, options); },
        put: function (url, data, options)       { return _request(url, 'PUT', data, options); },
        delete: function (url, data, options)    { return _request(url, 'DELETE', data, options); },

        upload: _upload,
        download: _download,
        downloadBlob: downloadBlob,
        downloadBase64: downloadBase64,

        /** Low-level: any method */
        request: _request
    };

    // ------------------------------------------
    // EXPOSE
    // ------------------------------------------
    window.ApiClient  = ApiClient;

    // Namespaced alias
    window.AdarshAjax = {
        getCSRFToken:   getCSRFToken,
        apiCall:        _request,
        get:            ApiClient.get,
        post:           ApiClient.post,
        put:            ApiClient.put,
        'delete':       ApiClient.delete,
        upload:         _upload,
        download:       _download,
        downloadBlob:   downloadBlob,
        downloadBase64: downloadBase64
    };

    // Legacy globals (backward compat  will be removed)
    window.getCSRFToken = getCSRFToken;
    window.apiCall      = function (url, method, data, options) {
        return _request(url, method || 'GET', data, options);
    };

})();
