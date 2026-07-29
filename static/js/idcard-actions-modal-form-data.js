// ID Card Actions - Modal Form Data Module
// Contains: Form data collection, image field processing helpers
// Split from idcard-actions-modal-form.js

(function() {
'use strict';

// ==========================================
// FORM DATA COLLECTION
// ==========================================

function getFormData() {
    const fieldData = {};
    const imageFiles = {};
    
    // Get all inputs from the entire cardForm (including modal-images-section AND formFieldsContainer)
    const cardForm = document.getElementById('cardForm');
    if (!cardForm) {
        console.error('cardForm not found!');
        return { fieldData, imageFiles };
    }
    
    const inputs = cardForm.querySelectorAll('.form-control, .image-input');
    
    
    inputs.forEach(input => {
        const fieldName = input.getAttribute('data-field-name');
        const fieldType = input.getAttribute('data-field-type');
        if (fieldName) {
            // PHOTO now uses the same unified image grid as other image fields
            // (formPhotoInput element no longer exists  all images go through image_<fieldName>)
            
            if (IDCardApp._isImageFieldModal(fieldType, fieldName) || input.type === 'file') {
                if (input._croppedFile) {
                    // Use cropped file if DataTransfer fallback was used
                    imageFiles[fieldName] = input._croppedFile;
                    // Clear any marked-for-removal state when a new file is present
                    try { input.dataset.markedRemoved = ''; } catch (e) {}
                } else if (input.files && input.files[0]) {
                    // New file selected - add to imageFiles
                    imageFiles[fieldName] = input.files[0];
                    // Clear any marked-for-removal state when a new file is present
                    try { input.dataset.markedRemoved = ''; } catch (e) {}
                } else {
                    // No file selected - send existing path or empty for removal
                    // Backend handles PENDING detection and file validation
                    const fieldCard = input.closest('.image-field-card');
                    const pathInput = fieldCard?.querySelector('.image-path-input');
                    if (pathInput) {
                        const pathValue = (pathInput.value || '').trim();
                        const originalPath = pathInput.dataset.originalPath || '';
                        // originalFilename is the filename portion displayed in the input
                        // (stripped from the full path when modal loaded)
                        const originalFilename = originalPath ? originalPath.split('/').pop() : '';
                        
                        if (pathValue === '') {
                            // Path was cleared  send empty for backend to handle removal
                            fieldData[fieldName] = '';
                        } else if (originalPath && pathValue === originalFilename) {
                            // User didn't change the displayed filename  keep original path
                            fieldData[fieldName] = originalPath;
                        } else {
                            // User typed a new value (different from original filename)
                            // or there was no original path  send as-is.
                            // Backend will validate: if file exists  store path,
                            // if not  mark as PENDING:{value}
                            fieldData[fieldName] = pathValue;
                        }
                    } else {
                        // No admin path input present (client/client_staff view).
                        // Check for a client-side explicit removal marker on the file input.
                        try {
                            if (input.dataset && (input.dataset.markedRemoved === '1' || input.dataset.markedRemoved === 'true')) {
                                fieldData[fieldName] = '';
                            }
                        } catch (e) {
                            // noop
                        }
                    }
                }
            } else {
                // Text fields - sanitize before sending (backend also uppercases)
                var rawValue = input.value || '';
                var sanitizedValue = (window.DataSanitizer && fieldType !== 'email')
                    ? DataSanitizer.sanitizeText(rawValue).value
                    : rawValue;
                fieldData[fieldName] = sanitizedValue;
            }
        }
    });
    
    return { fieldData, imageFiles };
}

function getMainPhotoFile() {
    const formPhotoInput = document.getElementById('formPhotoInput');
    if (formPhotoInput && formPhotoInput.files && formPhotoInput.files[0]) {
            return formPhotoInput.files[0];
    }
    return null;
}

function isHeifLikeFile(file) {
    if (!file) return false;
    const name = String(file.name || '').toLowerCase();
    const type = String(file.type || '').toLowerCase();
    return (
        name.endsWith('.heic') ||
        name.endsWith('.heif') ||
        name.endsWith('.hei') ||
        type.indexOf('heic') !== -1 ||
        type.indexOf('heif') !== -1
    );
}

function showDeferredHeifPreview(previewEl) {
    if (!previewEl) return;
    previewEl.classList.remove('no-path', 'has-image', 'path-not-found');
    previewEl.classList.add('pending-image');
    previewEl.innerHTML = '<i class="fa-solid fa-clock"></i><span style="display:block;margin-top:6px;font-size:11px;line-height:1.2;">Preview after save</span>';
}

function showPreparingHeifPreview(previewEl) {
    if (!previewEl) return;
    previewEl.classList.remove('no-path', 'has-image', 'path-not-found');
    previewEl.classList.add('pending-image', 'pending-image-skeleton');
    previewEl.innerHTML = '<div class="image-preview-skeleton" aria-hidden="true"><span class="image-preview-skeleton-block image-preview-skeleton-thumb"></span><span class="image-preview-skeleton-block image-preview-skeleton-line"></span></div><span class="image-preview-skeleton-text">Preparing preview...</span>';
}

function showPreviewNotAvailable(previewEl) {
    if (!previewEl) return;
    previewEl.classList.remove('has-image', 'pending-image', 'path-not-found');
    previewEl.classList.add('no-path');
    previewEl.innerHTML = '<i class="fa-solid fa-image"></i>';
}

function fileToDataUrl(file) {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onload = function(ev) {
            resolve(ev.target.result);
        };
        reader.onerror = function() {
            reject(new Error('Failed to read file for preview'));
        };
        reader.readAsDataURL(file);
    });
}

function blobToDataUrl(blob) {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onload = function(ev) {
            resolve(ev.target.result);
        };
        reader.onerror = function() {
            reject(new Error('Failed to read converted blob for preview'));
        };
        reader.readAsDataURL(blob);
    });
}

function getHeic2AnyBlob(result) {
    if (Array.isArray(result)) {
        return result.length ? result[0] : null;
    }
    return result || null;
}

function getHeifMimeByName(fileName) {
    var name = String(fileName || '').toLowerCase();
    if (name.endsWith('.heif')) return 'image/heif';
    if (name.endsWith('.heic') || name.endsWith('.hei')) return 'image/heic';
    return 'image/heic';
}

function buildHeifDecodeBlob(file) {
    if (!file) return file;
    var type = String(file.type || '').toLowerCase();
    if (type.indexOf('heic') !== -1 || type.indexOf('heif') !== -1) {
        return file;
    }
    return new Blob([file], { type: getHeifMimeByName(file.name) });
}

function buildCsrfHeaders() {
    var headers = {};
    if (typeof getCSRFToken === 'function') {
        var token = getCSRFToken();
        if (token) {
            headers['X-CSRFToken'] = token;
        }
    }
    return headers;
}

var _imagePickerStartHandle = null;
var _imagePickerStartHandleLoaded = false;
var _imagePickerStartHandleLoadPromise = null;

function _supportsNativeImageFilePicker() {
    return typeof window.showOpenFilePicker === 'function';
}

function _readImagePickerStartHandleFromDb() {
    if (!window.indexedDB) return Promise.resolve(null);
    if (_imagePickerStartHandleLoaded) return Promise.resolve(_imagePickerStartHandle);
    if (_imagePickerStartHandleLoadPromise) return _imagePickerStartHandleLoadPromise;

    _imagePickerStartHandleLoadPromise = new Promise(function(resolve) {
        var request = indexedDB.open('adarsh-admin-image-picker', 1);

        request.onupgradeneeded = function() {
            var db = request.result;
            if (db.objectStoreNames.contains('handles')) return;
            db.createObjectStore('handles');
        };

        request.onsuccess = function() {
            try {
                var db = request.result;
                var tx = db.transaction('handles', 'readonly');
                var store = tx.objectStore('handles');
                var getRequest = store.get('last-file-handle');

                getRequest.onsuccess = function() {
                    _imagePickerStartHandle = getRequest.result || null;
                    _imagePickerStartHandleLoaded = true;
                    try { db.close(); } catch (e) {}
                    resolve(_imagePickerStartHandle);
                };
                getRequest.onerror = function() {
                    _imagePickerStartHandleLoaded = true;
                    try { db.close(); } catch (e) {}
                    resolve(null);
                };
            } catch (err) {
                _imagePickerStartHandleLoaded = true;
                try { request.result && request.result.close(); } catch (e) {}
                resolve(null);
            }
        };

        request.onerror = function() {
            _imagePickerStartHandleLoaded = true;
            resolve(null);
        };

        request.onblocked = function() {
            _imagePickerStartHandleLoaded = true;
            resolve(null);
        };
    });

    return _imagePickerStartHandleLoadPromise;
}

function _storeImagePickerStartHandle(handle) {
    if (!handle || !window.indexedDB) return;
    _imagePickerStartHandle = handle;
    _imagePickerStartHandleLoaded = true;

    try {
        var request = indexedDB.open('adarsh-admin-image-picker', 1);

        request.onupgradeneeded = function() {
            var db = request.result;
            if (!db.objectStoreNames.contains('handles')) {
                db.createObjectStore('handles');
            }
        };

        request.onsuccess = function() {
            try {
                var db = request.result;
                var tx = db.transaction('handles', 'readwrite');
                tx.objectStore('handles').put(handle, 'last-file-handle');
                tx.oncomplete = function() {
                    try { db.close(); } catch (e) {}
                };
                tx.onerror = function() {
                    try { db.close(); } catch (e) {}
                };
            } catch (err) {
                try { request.result && request.result.close(); } catch (e) {}
            }
        };
    } catch (err) {
        console.warn('Could not store remembered image picker folder:', err);
    }
}

function _setInputFileFromSelection(input, file) {
    if (!input || !file) return;
    try {
        if (typeof DataTransfer !== 'undefined') {
            var dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }
    } catch (err) {
        console.warn('DataTransfer assignment failed; falling back to stored file.', err);
    }

    try {
        input._croppedFile = file;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
        console.error('Unable to apply selected file to input:', e);
    }
}

async function openRememberedImagePicker(input) {
    if (!input) return;

    if (!_supportsNativeImageFilePicker()) {
        input.click();
        return;
    }

    var pickerOptions = {
        multiple: false,
        startIn: _imagePickerStartHandle || 'pictures',
        types: [{
            description: 'Image files',
            accept: {
                'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.heic', '.heif', '.hei']
            }
        }]
    };

    try {
        var handles = await window.showOpenFilePicker(pickerOptions);
        if (!handles || !handles.length) return;
        var fileHandle = handles[0];
        var file = await fileHandle.getFile();
        _storeImagePickerStartHandle(fileHandle);
        _setInputFileFromSelection(input, file);
    } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.warn('Native image picker failed, falling back to file input:', err);
        input.click();
    }
}

async function convertHeifPreviewViaServer(file) {
    var formData = new FormData();
    formData.append('file', file, file.name || 'image.heic');

    var response = await withTimeout(fetch('/api/image/preview-convert/', {
        method: 'POST',
        credentials: 'same-origin',
        headers: buildCsrfHeaders(),
        body: formData,
    }), 12000, 'Server preview conversion timed out');

    if (!response.ok) {
        throw new Error('Server preview conversion failed');
    }

    var previewBlob = await response.blob();
    if (!previewBlob || !previewBlob.size) {
        throw new Error('Server preview response was empty');
    }
    return blobToDataUrl(previewBlob);
}

function withTimeout(promise, timeoutMs, message) {
    return new Promise(function(resolve, reject) {
        var settled = false;
        var timer = setTimeout(function() {
            if (settled) return;
            settled = true;
            reject(new Error(message || 'Operation timed out'));
        }, timeoutMs);

        Promise.resolve(promise).then(function(value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        }).catch(function(err) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });
    });
}

async function getPreviewDataUrl(file) {
    if (!isHeifLikeFile(file)) {
        return fileToDataUrl(file);
    }
    // Prefer server-side conversion to avoid creating blob-based web workers
    // which may be blocked by a restrictive Content Security Policy. Fall
    // back to the in-browser `heic2any` decoder only if the server path
    // fails or times out.
    try {
        return await convertHeifPreviewViaServer(file);
    } catch (err) {
        console.warn('Server HEIF preview conversion failed or timed out; falling back to client conversion.', err);
    }

    if (typeof window.heic2any === 'function') {
        try {
            var heifBlob = buildHeifDecodeBlob(file);
            const converted = await withTimeout(window.heic2any({
                blob: heifBlob,
                toType: 'image/jpeg',
                quality: 0.9,
            }), 5000, 'HEIF conversion timed out');
            const convertedBlob = getHeic2AnyBlob(converted);
            if (convertedBlob) {
                return blobToDataUrl(convertedBlob);
            }
        } catch (err) {
            console.warn('HEIF preview conversion failed in browser fallback.', err);
        }
    }

    return fileToDataUrl(file);
}

async function setPreviewFromFile(previewEl, file, altText) {
    if (!previewEl || !file) return;
    const heifLike = isHeifLikeFile(file);
    const requestId = String(Date.now()) + '-' + String(Math.random()).slice(2);
    previewEl.dataset.previewRequestId = requestId;
    var skeletonStart = null;

    if (heifLike) {
        showPreparingHeifPreview(previewEl);
        skeletonStart = Date.now();
    }

    try {
        const dataUrl = await getPreviewDataUrl(file);
        if (previewEl.dataset.previewRequestId !== requestId) return;

        if (skeletonStart != null && typeof window.waitForMinDelay === 'function') {
            await window.waitForMinDelay(skeletonStart);
        }

        previewEl.classList.remove('no-path', 'pending-image', 'path-not-found');
        previewEl.classList.add('has-image');
        previewEl.innerHTML = '';

        var img = document.createElement('img');
        img.onerror = function() {
            if (heifLike) {
                showDeferredHeifPreview(previewEl);
            } else {
                showPreviewNotAvailable(previewEl);
            }
        };
        img.src = dataUrl;
        img.alt = altText || 'Preview';
        previewEl.appendChild(img);
    } catch (err) {
        if (previewEl.dataset.previewRequestId !== requestId) return;
        if (skeletonStart != null && typeof window.waitForMinDelay === 'function') {
            await window.waitForMinDelay(skeletonStart);
        }
        if (heifLike) {
            showDeferredHeifPreview(previewEl);
        } else {
            showPreviewNotAvailable(previewEl);
        }
    }
}

// ==========================================
// IMAGE FIELD PROCESSING HELPERS
// ==========================================

/**
 * Helper: Apply an image File to the field's preview, path input, and buttons.
 */
function applyImageToField(input, file) {
    const previewId = input.getAttribute('data-preview-id');
    const previewEl = document.getElementById(previewId);
    const fieldCard = input.closest('.image-field-card');
    const pathInput = fieldCard?.querySelector('.image-path-input');
    const removeBtn = fieldCard?.querySelector('.btn-remove-field');
    const downloadBtn = fieldCard?.querySelector('.btn-download-field');
    
    if (previewEl) {
        setPreviewFromFile(previewEl, file, 'Preview');
    }
    
    // Update path input to show new file name
    if (pathInput) {
        pathInput.value = file.name;
        pathInput.classList.remove('no-path', 'pending', 'not-found');
        pathInput.classList.add('has-image');
        pathInput.dataset.directory = '';
        pathInput.dataset.originalPath = '';
        pathInput.dataset.hasNewFile = 'true';
    }
    
    // Show remove button
    if (removeBtn) {
        removeBtn.style.display = '';
    }
    // Hide download button (new file not yet saved)
    if (downloadBtn) {
        downloadBtn.style.display = 'none';
    }
    // Clear any marked-for-removal flag when a new file is applied
    try { input.dataset.markedRemoved = ''; } catch (e) {}
}

/**
 * Initialize form-related event handlers:
 * - Photo upload preview
 * - Image field upload with cropper integration
 * - Remove button handlers for image fields
 */
function initFormDataHandlers() {
    const formPhotoInput = document.getElementById('formPhotoInput');
    const formPhotoPreview = document.getElementById('formPhotoPreview');

    _readImagePickerStartHandleFromDb().catch(function() {
        // Best-effort cache warmup only.
    });
    
    // Photo upload preview
    if (formPhotoInput) {
        formPhotoInput.addEventListener('change', function() {
            if (this.files && this.files[0]) {
                const selectedFile = this.files[0];
                if (formPhotoPreview) {
                    setPreviewFromFile(formPhotoPreview, selectedFile, 'Photo');
                }
            }
        });
    }
    
    // Image field upload previews  use event delegation on cardForm
    // so it works even if inputs are re-rendered or initially disabled
    // Integrates with ImageCropper when available
    const cardFormEl = document.getElementById('cardForm');
    if (cardFormEl) {
        cardFormEl.addEventListener('click', function(e) {
            // Do not intercept click events originating directly on the file input,
            // as calling preventDefault() on them cancels the file dialog opening.
            if (e.target.tagName === 'INPUT' && e.target.type === 'file') {
                return;
            }

            const uploadBtn = e.target.closest('.image-upload-btn');
            if (!uploadBtn) return;

            const input = uploadBtn.querySelector('.image-input');
            if (!input) return;

            e.preventDefault();
            e.stopPropagation();
            openRememberedImagePicker(input);
        });

        cardFormEl.addEventListener('change', function(e) {
            const input = e.target;
            if (!input.classList.contains('image-input')) return;
            if (!input.files || !input.files[0]) return;
            
            const originalFile = input.files[0];

            // Only offer crop for actual image files (not for path/reference changes)
            const isImage = originalFile.type && originalFile.type.startsWith('image/');
            
            if (isImage && window.ImageCropper) {
                // Open crop modal  use result to populate preview & file input
                window.ImageCropper.open(originalFile).then(function(result) {
                    if (result === null) {
                        // User cancelled  clear the file input
                        input.value = '';
                        return;
                    }
                    
                    // result is 'skip' (use original) or a cropped File
                    const fileToUse = (result === 'skip') ? originalFile : result;
                    
                    // If cropped, replace the file input's files with the cropped version
                    if (result !== 'skip') {
                        try {
                            const dt = new DataTransfer();
                            dt.items.add(fileToUse);
                            input.files = dt.files;
                        } catch(err) {
                            // Fallback: store on input as custom property
                            input._croppedFile = fileToUse;
                        }
                    }

                    applyImageToField(input, fileToUse);
                });
            } else {
                // Not an image or no cropper  apply directly
                applyImageToField(input, originalFile);
            }
        });
    }

    // Undo button handlers for image fields
    document.querySelectorAll('.btn-undo-image-field').forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.preventDefault();
            const cardId = window.currentSideModalCardId;
            const fieldName = this.getAttribute('data-field-name') || 'PHOTO';
            if (!cardId) {
                if (window.showToast) window.showToast('Undo is available when editing an existing card.', 'warning');
                return;
            }
            try {
                const getCsrf = () => (document.querySelector('[name=csrfmiddlewaretoken]') || {}).value || '';
                const res = await fetch(`/api/card/${cardId}/undo-image/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf() },
                    body: JSON.stringify({ field_name: fieldName })
                });
                const data = await res.json();
                if (data.success) {
                    const fieldCard = this.closest('.image-field-card');
                    const pathInput = fieldCard?.querySelector('.image-path-input');
                    const previewEl = fieldCard?.querySelector('.image-preview-box');
                    if (pathInput) {
                        pathInput.value = data.restored_path;
                        pathInput.classList.remove('no-path', 'not-found');
                        pathInput.classList.add('has-image');
                    }
                    if (previewEl && data.restored_path) {
                        previewEl.innerHTML = `<img src="${encodeURI(data.restored_path)}" alt="${fieldName}" />`;
                        previewEl.classList.remove('no-path', 'pending-image');
                        previewEl.classList.add('has-image');
                    }
                    if (window.showToast) window.showToast(`Restored version ${data.version}`, 'success');
                } else {
                    if (window.showToast) window.showToast(data.message || 'Undo not available', 'error');
                }
            } catch (err) {
                console.error('Error undoing image version:', err);
            }
        });
    });

    // Redo button handlers for image fields
    document.querySelectorAll('.btn-redo-image-field').forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.preventDefault();
            const cardId = window.currentSideModalCardId;
            const fieldName = this.getAttribute('data-field-name') || 'PHOTO';
            if (!cardId) {
                if (window.showToast) window.showToast('Redo is available when editing an existing card.', 'warning');
                return;
            }
            try {
                const getCsrf = () => (document.querySelector('[name=csrfmiddlewaretoken]') || {}).value || '';
                const res = await fetch(`/api/card/${cardId}/redo-image/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf() },
                    body: JSON.stringify({ field_name: fieldName })
                });
                const data = await res.json();
                if (data.success) {
                    const fieldCard = this.closest('.image-field-card');
                    const pathInput = fieldCard?.querySelector('.image-path-input');
                    const previewEl = fieldCard?.querySelector('.image-preview-box');
                    if (pathInput) {
                        pathInput.value = data.restored_path;
                        pathInput.classList.remove('no-path', 'not-found');
                        pathInput.classList.add('has-image');
                    }
                    if (previewEl && data.restored_path) {
                        previewEl.innerHTML = `<img src="${encodeURI(data.restored_path)}" alt="${fieldName}" />`;
                        previewEl.classList.remove('no-path', 'pending-image');
                        previewEl.classList.add('has-image');
                    }
                    if (window.showToast) window.showToast(`Restored version ${data.version}`, 'success');
                } else {
                    if (window.showToast) window.showToast(data.message || 'Redo not available', 'error');
                }
            } catch (err) {
                console.error('Error redoing image version:', err);
            }
        });
    });

    // Remove button handlers for image fields
    document.querySelectorAll('.btn-remove-field').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const fieldName = this.getAttribute('data-field-name');
            const fieldCard = this.closest('.image-field-card');
            
            // Find related elements
            const previewEl = fieldCard?.querySelector('.image-preview-box');
            const pathInput = fieldCard?.querySelector('.image-path-input');
            const fileInput = fieldCard?.querySelector('.image-input');
            
            // Clear file input
            if (fileInput) {
                fileInput.value = '';
                try { fileInput._croppedFile = null; } catch (e) {}
                // Mark this input as explicitly removed so client views (which
                // don't show the admin path input) still send removal markers
                try { fileInput.dataset.markedRemoved = '1'; } catch (e) {}
            }
            
            // Reset preview
            if (previewEl) {
                previewEl.classList.remove('has-image', 'pending-image', 'path-not-found');
                previewEl.classList.add('no-path');
                previewEl.innerHTML = `<i class="fa-solid fa-image"></i>`;
            }
            
            // Reset path input
            if (pathInput) {
                pathInput.value = '';
                pathInput.classList.remove('has-image', 'pending', 'not-found');
                pathInput.classList.add('no-path');
                pathInput.placeholder = 'Enter image path or reference...';
                // Clear data attributes
                pathInput.dataset.directory = '';
                pathInput.dataset.originalPath = '';
                pathInput.dataset.hasNewFile = '';
            }
            
            // Hide remove button
            this.style.display = 'none';
            
            // Hide download button
            const downloadBtn = fieldCard?.querySelector('.btn-download-field');
            if (downloadBtn) {
                downloadBtn.style.display = 'none';
                downloadBtn.href = '#';
                downloadBtn.removeAttribute('download');
            }
        });
    });
}

// ==========================================
// EXPORTS
// ==========================================

window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.getFormData = getFormData;
window.IDCardApp.getMainPhotoFile = getMainPhotoFile;
window.IDCardApp.applyImageToField = applyImageToField;
window.IDCardApp.initFormDataHandlers = initFormDataHandlers;

})();
