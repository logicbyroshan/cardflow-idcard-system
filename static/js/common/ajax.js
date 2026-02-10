/**
 * Common AJAX/API Module
 * Provides unified API call handling with CSRF token support
 * 
 * @module common/ajax
 * @version 1.1.0
 */

// ==========================================
// GLOBAL 403 FETCH INTERCEPTOR
// Catches permission-denied responses from ALL fetch() calls
// and shows a user-friendly "Permission Denied" toast.
// ==========================================
(function() {
    'use strict';
    const _originalFetch = window.fetch;
    window.fetch = function() {
        return _originalFetch.apply(this, arguments).then(function(response) {
            if (response.status === 403) {
                response.clone().json()
                    .then(function(data) {
                        var msg = (data && data.message) || 'Permission denied';
                        if (typeof window.showToast === 'function') {
                            window.showToast(msg, 'error', 5000);
                        }
                    })
                    .catch(function() {
                        if (typeof window.showToast === 'function') {
                            window.showToast('Permission denied', 'error', 5000);
                        }
                    });
            }
            return response;
        });
    };
})();

(function() {
    'use strict';

    // ==========================================
    // CSRF TOKEN MANAGEMENT
    // ==========================================

    /**
     * Get CSRF token from cookies for Django form submissions
     * @returns {string} CSRF token value
     */
    function getCSRFToken() {
        // Try to get from cookie first
        const cookie = document.cookie.split(';').find(c => c.trim().startsWith('csrftoken='));
        if (cookie) {
            return cookie.split('=')[1];
        }
        
        // Fallback: try to get from DOM meta tag
        const metaTag = document.querySelector('meta[name="csrf-token"]');
        if (metaTag) {
            return metaTag.getAttribute('content');
        }
        
        // Fallback: try to get from hidden input
        const hiddenInput = document.querySelector('input[name="csrfmiddlewaretoken"]');
        if (hiddenInput) {
            return hiddenInput.value;
        }
        
        return '';
    }

    // ==========================================
    // API CALL HELPERS
    // ==========================================

    /**
     * Default request options
     */
    const defaultOptions = {
        timeout: 30000,
        retries: 0,
        retryDelay: 1000
    };

    /**
     * Make an API call with automatic CSRF token handling
     * @param {string} url - API endpoint URL
     * @param {string} method - HTTP method (GET, POST, PUT, DELETE, etc.)
     * @param {Object|null} data - Request body data (will be JSON stringified)
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Response data
     */
    async function apiCall(url, method = 'GET', data = null, options = {}) {
        const config = { ...defaultOptions, ...options };
        
        const fetchOptions = {
            method: method.toUpperCase(),
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken(),
                'X-Requested-With': 'XMLHttpRequest',
                ...config.headers
            }
        };

        if (data && method.toUpperCase() !== 'GET') {
            fetchOptions.body = JSON.stringify(data);
        }

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeout);
        fetchOptions.signal = controller.signal;

        let lastError;
        let attempts = 0;
        const maxAttempts = config.retries + 1;

        while (attempts < maxAttempts) {
            try {
                const response = await fetch(url, fetchOptions);
                clearTimeout(timeoutId);

                // Parse response
                const contentType = response.headers.get('content-type');
                let responseData;

                if (contentType && contentType.includes('application/json')) {
                    responseData = await response.json();
                } else {
                    responseData = await response.text();
                }

                // Handle HTTP errors
                if (!response.ok) {
                    const msg = (response.status === 403)
                        ? (responseData.message || 'Permission denied')
                        : (responseData.message || `HTTP ${response.status}`);
                    const error = new Error(msg);
                    error.status = response.status;
                    error.data = responseData;
                    throw error;
                }

                return responseData;

            } catch (error) {
                lastError = error;
                attempts++;

                if (error.name === 'AbortError') {
                    lastError = new Error('Request timeout');
                    lastError.code = 'TIMEOUT';
                    break;
                }

                if (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, config.retryDelay));
                }
            }
        }

        // Show error toast if showToast is available
        if (typeof window.showToast === 'function') {
            window.showToast(lastError.message || 'Network error', 'error');
        }

        throw lastError;
    }

    /**
     * Convenience method for GET requests
     */
    function get(url, options = {}) {
        return apiCall(url, 'GET', null, options);
    }

    /**
     * Convenience method for POST requests
     */
    function post(url, data, options = {}) {
        return apiCall(url, 'POST', data, options);
    }

    /**
     * Convenience method for PUT requests
     */
    function put(url, data, options = {}) {
        return apiCall(url, 'PUT', data, options);
    }

    /**
     * Convenience method for DELETE requests
     */
    function del(url, data = null, options = {}) {
        return apiCall(url, 'DELETE', data, options);
    }

    /**
     * Upload file(s) with FormData
     * @param {string} url - Upload endpoint
     * @param {FormData} formData - FormData containing files
     * @param {Object} options - Options including onProgress callback
     * @returns {Promise<Object>}
     */
    function upload(url, formData, options = {}) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            xhr.open('POST', url, true);
            xhr.setRequestHeader('X-CSRFToken', getCSRFToken());
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            
            // Progress handler
            if (options.onProgress) {
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percent = Math.round((event.loaded / event.total) * 100);
                        options.onProgress(percent, event.loaded, event.total);
                    }
                };
            }
            
            xhr.onload = function() {
                try {
                    const response = JSON.parse(xhr.responseText);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(response);
                    } else {
                        reject({ status: xhr.status, data: response });
                    }
                } catch (e) {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(xhr.responseText);
                    } else {
                        reject({ status: xhr.status, message: 'Failed to parse response' });
                    }
                }
            };
            
            xhr.onerror = function() {
                reject({ message: 'Network error' });
            };
            
            xhr.ontimeout = function() {
                reject({ message: 'Request timeout', code: 'TIMEOUT' });
            };
            
            if (options.timeout) {
                xhr.timeout = options.timeout;
            }
            
            xhr.send(formData);
        });
    }

    /**
     * Download file via XHR with progress tracking
     * @param {string} url - Download endpoint
     * @param {Object} options - Options including onProgress callback
     * @returns {Promise<Blob>}
     */
    function download(url, method = 'GET', data = null, options = {}) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            xhr.open(method, url, true);
            xhr.setRequestHeader('X-CSRFToken', getCSRFToken());
            
            if (data) {
                xhr.setRequestHeader('Content-Type', 'application/json');
            }
            
            xhr.responseType = 'blob';
            
            // Progress handler
            if (options.onProgress) {
                xhr.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percent = Math.round((event.loaded / event.total) * 100);
                        options.onProgress(percent, event.loaded, event.total);
                    }
                };
            }
            
            xhr.onload = function() {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.response);
                } else {
                    reject({ status: xhr.status, message: `HTTP ${xhr.status}` });
                }
            };
            
            xhr.onerror = function() {
                reject({ message: 'Network error' });
            };
            
            xhr.send(data ? JSON.stringify(data) : null);
        });
    }

    /**
     * Helper to trigger file download from blob
     * @param {Blob} blob - File blob
     * @param {string} filename - Download filename
     */
    function downloadBlob(blob, filename) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }

    /**
     * Helper to trigger file download from base64
     * @param {string} base64Data - Base64 encoded data
     * @param {string} filename - Download filename
     * @param {string} mimeType - MIME type
     */
    function downloadBase64(base64Data, filename, mimeType = 'application/octet-stream') {
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        downloadBlob(blob, filename);
    }

    // ==========================================
    // EXPOSE API
    // ==========================================

    window.AdarshAjax = {
        getCSRFToken,
        apiCall,
        get,
        post,
        put,
        delete: del,
        upload,
        download,
        downloadBlob,
        downloadBase64
    };

    // Legacy/global compatibility
    window.getCSRFToken = getCSRFToken;
    window.apiCall = apiCall;

})();
