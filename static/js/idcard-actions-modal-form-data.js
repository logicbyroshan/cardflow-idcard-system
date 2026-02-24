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
            // (formPhotoInput element no longer exists — all images go through image_<fieldName>)
            
            if (IDCardApp._isImageFieldModal(fieldType, fieldName) || input.type === 'file') {
                if (input._croppedFile) {
                    // Use cropped file if DataTransfer fallback was used
                    imageFiles[fieldName] = input._croppedFile;
                } else if (input.files && input.files[0]) {
                    // New file selected - add to imageFiles
                    imageFiles[fieldName] = input.files[0];
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
                            // Path was cleared — send empty for backend to handle removal
                            fieldData[fieldName] = '';
                        } else if (originalPath && pathValue === originalFilename) {
                            // User didn't change the displayed filename — keep original path
                            fieldData[fieldName] = originalPath;
                        } else {
                            // User typed a new value (different from original filename)
                            // or there was no original path — send as-is.
                            // Backend will validate: if file exists → store path,
                            // if not → mark as PENDING:{value}
                            fieldData[fieldName] = pathValue;
                        }
                    }
                }
            } else {
                // Text fields - send as-is, backend handles uppercase
                const value = input.value || '';
                fieldData[fieldName] = value;
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
        const reader = new FileReader();
        reader.onload = function(ev) {
            previewEl.classList.remove('no-path', 'pending-image', 'path-not-found');
            previewEl.classList.add('has-image');
            previewEl.innerHTML = '';
            var img = document.createElement('img');
            img.src = ev.target.result;
            img.alt = 'Preview';
            previewEl.appendChild(img);
        };
        reader.readAsDataURL(file);
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
    
    // Photo upload preview
    if (formPhotoInput) {
        formPhotoInput.addEventListener('change', function() {
            if (this.files && this.files[0]) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    if (formPhotoPreview) {
                        formPhotoPreview.innerHTML = '';
                        var img = document.createElement('img');
                        img.src = e.target.result;
                        img.alt = 'Photo';
                        formPhotoPreview.appendChild(img);
                    }
                };
                reader.readAsDataURL(this.files[0]);
            }
        });
    }
    
    // Image field upload previews — use event delegation on cardForm
    // so it works even if inputs are re-rendered or initially disabled
    // Integrates with ImageCropper when available
    const cardFormEl = document.getElementById('cardForm');
    if (cardFormEl) {
        cardFormEl.addEventListener('change', function(e) {
            const input = e.target;
            if (!input.classList.contains('image-input')) return;
            if (!input.files || !input.files[0]) return;
            
            const originalFile = input.files[0];

            // Only offer crop for actual image files (not for path/reference changes)
            const isImage = originalFile.type && originalFile.type.startsWith('image/');
            
            if (isImage && window.ImageCropper) {
                // Open crop modal — use result to populate preview & file input
                window.ImageCropper.open(originalFile).then(function(result) {
                    if (result === null) {
                        // User cancelled — clear the file input
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
                // Not an image or no cropper — apply directly
                applyImageToField(input, originalFile);
            }
        });
    }

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
