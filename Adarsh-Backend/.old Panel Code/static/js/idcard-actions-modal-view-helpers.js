// ID Card Actions - Modal View Helpers
// Contains: Image field type constants, path helpers, form field population
// Part of idcard-actions-modal-view module split
(function() {
'use strict';

// IMAGE FIELD TYPES  Must stay in sync with mediafiles/constants.py and idcard-actions-upload.js
if (typeof IMAGE_FIELD_TYPES === 'undefined') {
    var IMAGE_FIELD_TYPES = ['photo', 'rel_photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature', 'image'];
}

function isImageFieldType(fieldType) {
    if (!fieldType) return false;
    return IMAGE_FIELD_TYPES.includes(fieldType.toLowerCase());
}

// Check if field name matches image patterns (with word boundary matching)
// Uses global isImageFieldByName from upload.js if available
function isImageFieldByNameModal(fieldName) {
    // Prefer global function from upload.js if available
    if (typeof isImageFieldByName === 'function') {
        return isImageFieldByName(fieldName);
    }
    // Fallback implementation with word boundary matching
    if (!fieldName) return false;
    const normalizedName = fieldName.toLowerCase().trim();
    const spacedName = normalizedName.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^(?:rel(?:ation)?)\s*(?:1|one|2|two)\s*(?:photo|image|pic|picture)$/.test(spacedName)) {
        return true;
    }
    if (/\b(?:father|mother)\b\s*(?:photo|image|pic|picture)\b/.test(spacedName)) {
        return true;
    }
    const patterns = ['photo', 'sign', 'signature', 'barcode', 'qr'];
    for (const pattern of patterns) {
        const regex = new RegExp('\\b' + pattern + '\\b');
        if (regex.test(spacedName)) {
            return true;
        }
    }
    return false;
}

// Combined check - by type OR by name
function isImageFieldModal(fieldType, fieldName) {
    return isImageFieldType(fieldType) || isImageFieldByNameModal(fieldName);
}

// Helper: extract short path (last folder + filename)
// Uses global getShortPath from utils.js if available, with fallback
function getShortPathLocal(fullPath) {
    if (typeof window.getShortPath === 'function') {
        return window.getShortPath(fullPath);
    }
    if (!fullPath) return '';
    if (fullPath.startsWith && fullPath.startsWith('PENDING:')) {
        return `Pending: ${fullPath.substring(8)}`;
    }
    let path = fullPath.replace(/^\/media\//, '');
    const parts = path.split('/');
    if (parts.length >= 2) {
        return parts.slice(-2).join('/');
    }
    return parts[parts.length - 1] || path;
}

// Helper: extract just the filename from a path
function getFilenameOnly(fullPath) {
    if (!fullPath) return '';
    if (fullPath.startsWith && fullPath.startsWith('PENDING:')) {
        return fullPath.substring(8);
    }
    let path = fullPath.replace(/^\/media\//, '');
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
}

// Helper: get the directory part of a path (without filename)
function getPathDirectory(fullPath) {
    if (!fullPath) return '';
    if (fullPath.startsWith && fullPath.startsWith('PENDING:')) {
        return '';
    }
    let path = fullPath.replace(/^\/media\//, '');
    const parts = path.split('/');
    if (parts.length > 1) {
        return parts.slice(0, -1).join('/') + '/';
    }
    return '';
}

// Populate form fields from card data
function populateFormFields(cardData) {
    const formPhotoPreview = document.getElementById('formPhotoPreview');
    const photoPathDisplay = document.getElementById('photoPathDisplay');

    // Reset photo preview classes
    if (formPhotoPreview) {
        formPhotoPreview.classList.remove('no-path', 'path-not-found', 'has-image', 'pending-image');
    }
    if (photoPathDisplay) {
        photoPathDisplay.classList.remove('no-path', 'not-found', 'pending');
    }

    // Populate main photo - check case-insensitively for PHOTO field
    let photoPath = null;
    if (cardData.field_data) {
        photoPath = cardData.field_data['PHOTO'] || 
                    cardData.field_data['Photo'] || 
                    cardData.field_data['photo'];
        if (!photoPath) {
            for (const [key, value] of Object.entries(cardData.field_data)) {
                if (key.toUpperCase() === 'PHOTO') {
                    photoPath = value;
                    break;
                }
            }
        }
    }

    // Check if it's a PENDING reference
    const isPending = photoPath && photoPath.startsWith('PENDING:');
    const pendingRef = isPending ? photoPath.substring(8) : null;

    if (photoPath && !isPending && photoPath !== 'NOT_FOUND') {
        // Valid image path - show the image (try thumbnail first, fallback to original)
        const cacheBuster = `?t=${Date.now()}`;
        const originalPath = photoPath.startsWith('/media/') || photoPath.startsWith('http') 
            ? photoPath 
            : `/media/${photoPath}`;
        const thumbPath = window.getThumbPath ? window.getThumbPath(photoPath) : null;
        const thumbSrc = thumbPath ? `/media/${thumbPath}${cacheBuster}` : null;
        const originalSrc = `${originalPath}${cacheBuster}`;
        if (formPhotoPreview) {
            formPhotoPreview.classList.add('has-image');
            formPhotoPreview.innerHTML = '';
            const img = document.createElement('img');
            img.alt = 'Photo';
            if (thumbSrc) {
                img.src = thumbSrc;
                img.onerror = function() { this.onerror = null; this.src = originalSrc; };
            } else {
                img.src = originalSrc;
            }
            formPhotoPreview.appendChild(img);
        }
        if (photoPathDisplay) {
            photoPathDisplay.textContent = getShortPathLocal(originalPath);
        }
    } else if (isPending) {
        if (formPhotoPreview) {
            formPhotoPreview.classList.add('pending-image');
            formPhotoPreview.innerHTML = `<i class="fa-solid fa-clock"></i>`;
        }
        if (photoPathDisplay) {
            photoPathDisplay.classList.add('pending');
            photoPathDisplay.textContent = `Waiting for: ${pendingRef}`;
        }
    } else if (photoPath === 'NOT_FOUND') {
        if (formPhotoPreview) {
            formPhotoPreview.classList.add('path-not-found');
            formPhotoPreview.innerHTML = `<i class="fa-solid fa-image-slash"></i>`;
        }
        if (photoPathDisplay) {
            photoPathDisplay.classList.add('not-found');
            photoPathDisplay.textContent = 'Path exists but image not found';
        }
    } else {
        // Empty/null - Gray placeholder
        if (formPhotoPreview) {
            formPhotoPreview.classList.add('no-path');
            formPhotoPreview.innerHTML = `<i class="fa-solid fa-user"></i>`;
        }
        if (photoPathDisplay) {
            photoPathDisplay.classList.add('no-path');
            photoPathDisplay.textContent = 'No image';
        }
    }

    // Fallback to cardData.photo
    if (!photoPath && cardData.photo && formPhotoPreview) {
        formPhotoPreview.classList.remove('no-path');
        formPhotoPreview.classList.add('has-image');
        formPhotoPreview.innerHTML = '';
        const img = document.createElement('img');
        img.src = cardData.photo;
        img.alt = 'Photo';
        formPhotoPreview.appendChild(img);
    }

    // Normalize field names for comparison (removes spaces, dots, underscores, hyphens)
    const normalizeFieldName = (name) => {
        if (!name) return '';
        return String(name).toUpperCase().replace(/[\s._\-]+/g, '');
    };

    // Find field value with flexible matching
    const findFieldValue = (fieldName) => {
        if (!fieldName || !cardData.field_data) return undefined;
        if (cardData.field_data[fieldName] !== undefined) {
            return cardData.field_data[fieldName];
        }
        if (cardData.field_data[fieldName.toUpperCase()] !== undefined) {
            return cardData.field_data[fieldName.toUpperCase()];
        }
        if (cardData.field_data[fieldName.toLowerCase()] !== undefined) {
            return cardData.field_data[fieldName.toLowerCase()];
        }
        const normalizedFieldName = normalizeFieldName(fieldName);
        for (const [key, value] of Object.entries(cardData.field_data)) {
            if (normalizeFieldName(key) === normalizedFieldName) {
                return value;
            }
        }
        return undefined;
    };

    // Populate form fields from field_data
    if (cardData.field_data) {
        const cardForm = document.getElementById('cardForm');
        if (!cardForm) {
            console.error('cardForm not found!');
            return;
        }
        const allInputs = cardForm.querySelectorAll('input, textarea, select');
        allInputs.forEach(input => {
            const fieldName = input.getAttribute('data-field-name') || input.getAttribute('name');
            const fieldType = input.getAttribute('data-field-type') || input.type;
            if (!fieldName) {
                return;
            }
            // Skip .image-path-input elements  they are already populated
            // when their sibling .image-input (file input) is processed above.
            if (input.classList.contains('image-path-input')) {
                return;
            }
            // Handle image/file inputs (check by type AND name to catch fields like 'SIGN')
            if (input.type === 'file' || isImageFieldModal(fieldType, fieldName)) {
                const previewId = input.getAttribute('data-preview-id');
                let previewContainer = previewId ? document.getElementById(previewId) : null;
                if (!previewContainer) {
                    previewContainer = input.closest('.image-field-card')?.querySelector('.image-preview-box') ||
                                       input.closest('.image-field-row')?.querySelector('.image-preview-small');
                }
                const pathInputId = previewId ? previewId.replace('preview_', 'path_') : null;
                let pathInput = pathInputId ? document.getElementById(pathInputId) : null;
                if (!pathInput) {
                    pathInput = input.closest('.image-field-card')?.querySelector('.image-path-input') ||
                                input.closest('.image-field-card')?.querySelector('.image-path-display');
                }
                const removeBtn = input.closest('.image-field-card')?.querySelector('.btn-remove-field') ||
                                  document.getElementById(`remove_${fieldName.toLowerCase().replace(/\s+/g, '-')}`);
                const downloadBtn = input.closest('.image-field-card')?.querySelector('.btn-download-field') ||
                                    document.getElementById(`download_${fieldName.toLowerCase().replace(/\s+/g, '-')}`);
                if (previewContainer) {
                    previewContainer.classList.remove('no-path', 'path-not-found', 'has-image', 'pending-image');
                }
                if (pathInput) {
                    pathInput.classList.remove('no-path', 'not-found', 'pending', 'has-image');
                }
                const imgPath = findFieldValue(fieldName);
                const isPendingImg = imgPath && imgPath.startsWith('PENDING:');
                const pendingRefImg = isPendingImg ? imgPath.substring(8) : null;

                if (imgPath && !isPendingImg && imgPath !== 'NOT_FOUND') {
                    // Valid image path - use thumbnail with fallback to original
                    const cacheBuster = `?t=${Date.now()}`;
                    const originalPath = imgPath.startsWith('/media/') || imgPath.startsWith('http') 
                        ? imgPath 
                        : `/media/${imgPath}`;
                    const thumbPath = window.getThumbPath ? window.getThumbPath(imgPath) : null;
                    const thumbSrc = thumbPath ? `/media/${thumbPath}${cacheBuster}` : null;
                    const originalSrc = `${originalPath}${cacheBuster}`;
                    if (previewContainer) {
                        previewContainer.classList.add('has-image');
                        previewContainer.innerHTML = '';
                        const img = document.createElement('img');
                        img.alt = fieldName || '';
                        if (thumbSrc) {
                            img.src = thumbSrc;
                            img.onerror = function() { this.onerror = null; this.src = originalSrc; };
                        } else {
                            img.src = originalSrc;
                        }
                        previewContainer.appendChild(img);
                    }
                    if (pathInput) {
                        if (pathInput.tagName === 'INPUT') {
                            const directory = getPathDirectory(imgPath);
                            const filename = getFilenameOnly(imgPath);
                            pathInput.value = filename;
                            pathInput.dataset.directory = directory;
                            pathInput.dataset.originalPath = imgPath;
                            pathInput.classList.add('has-image');
                        } else {
                            pathInput.textContent = getShortPathLocal(originalPath);
                        }
                    }
                    if (removeBtn) removeBtn.style.display = '';
                    if (downloadBtn) {
                        downloadBtn.style.display = '';
                        const cleanUrl = originalSrc.split('?')[0];
                        downloadBtn.href = cleanUrl;
                        const fileName = cleanUrl.split('/').pop() || fieldName;
                        downloadBtn.setAttribute('download', fileName);
                    }
                } else if (isPendingImg) {
                    // PENDING - waiting for image upload
                    if (previewContainer) {
                        previewContainer.classList.add('pending-image');
                        previewContainer.innerHTML = `<i class="fa-solid fa-clock"></i>`;
                    }
                    if (pathInput) {
                        if (pathInput.tagName === 'INPUT') {
                            pathInput.value = pendingRefImg;
                            pathInput.classList.add('pending');
                            pathInput.placeholder = 'Pending reference...';
                            pathInput.dataset.directory = '';
                            pathInput.dataset.originalPath = '';
                        } else {
                            pathInput.classList.add('pending');
                            pathInput.textContent = `Waiting for: ${pendingRefImg}`;
                        }
                    }
                    if (removeBtn) removeBtn.style.display = 'none';
                    if (downloadBtn) downloadBtn.style.display = 'none';
                } else if (imgPath === 'NOT_FOUND') {
                    if (previewContainer) {
                        previewContainer.classList.add('path-not-found');
                        previewContainer.innerHTML = `<i class="fa-solid fa-image-slash"></i>`;
                    }
                    if (pathInput) {
                        if (pathInput.tagName === 'INPUT') {
                            pathInput.value = '';
                            pathInput.classList.add('not-found');
                            pathInput.placeholder = 'Path not found...';
                            pathInput.dataset.directory = '';
                            pathInput.dataset.originalPath = '';
                        } else {
                            pathInput.classList.add('not-found');
                            pathInput.textContent = 'Path exists but image not found';
                        }
                    }
                    if (removeBtn) removeBtn.style.display = 'none';
                    if (downloadBtn) downloadBtn.style.display = 'none';
                } else {
                    // Empty - no image given
                    if (previewContainer) {
                        previewContainer.classList.add('no-path');
                        previewContainer.innerHTML = `<i class="fa-solid fa-image"></i>`;
                    }
                    if (pathInput) {
                        if (pathInput.tagName === 'INPUT') {
                            pathInput.value = '';
                            pathInput.classList.add('no-path');
                            pathInput.placeholder = 'Enter image path or reference...';
                            pathInput.dataset.directory = '';
                            pathInput.dataset.originalPath = '';
                        } else {
                            pathInput.classList.add('no-path');
                            pathInput.textContent = 'No image';
                        }
                    }
                    if (removeBtn) removeBtn.style.display = 'none';
                    if (downloadBtn) downloadBtn.style.display = 'none';
                }
                return;
            }
            // Handle text/date/number/email/textarea inputs
            const fieldValue = findFieldValue(fieldName);
            if (fieldValue !== undefined && fieldValue !== null) {
                if (fieldType === 'date' || input.type === 'date') {
                    const dateStr = String(fieldValue);
                    const ddmmyyyy = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
                    if (ddmmyyyy) {
                        const [, day, month, year] = ddmmyyyy;
                        input.value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                    } else {
                        input.value = fieldValue;
                    }
                } else {
                    input.value = fieldValue;
                }
            }
        });
    }
}

// EXPORTS
window.IDCardApp = window.IDCardApp || {};
window.IDCardApp._isImageFieldModal = isImageFieldModal;
window.IDCardApp.populateFormFields = populateFormFields;
})();
