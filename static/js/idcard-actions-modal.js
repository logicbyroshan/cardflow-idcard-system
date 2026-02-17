// ID Card Actions - Modal Module
// Contains: Side modal (add/edit/view), delete modal

(function() {
'use strict';

// ==========================================
// IMAGE FIELD TYPES
// NOTE: Must stay in sync with mediafiles/constants.py and idcard-actions-upload.js
// ==========================================
// Use existing IMAGE_FIELD_TYPES from upload module or define if not exists
if (typeof IMAGE_FIELD_TYPES === 'undefined') {
    var IMAGE_FIELD_TYPES = ['photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature', 'image'];
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
    const patterns = ['photo', 'sign', 'signature', 'barcode', 'qr'];
    for (const pattern of patterns) {
        const regex = new RegExp('\\b' + pattern + '\\b');
        if (regex.test(normalizedName)) {
            return true;
        }
    }
    return false;
}

// Combined check - by type OR by name
function isImageFieldModal(fieldType, fieldName) {
    return isImageFieldType(fieldType) || isImageFieldByNameModal(fieldName);
}

// ==========================================
// SIDE MODAL STATE
// ==========================================

let currentModalMode = 'add';
let currentEditCardId = null;
let currentEditUpdatedAt = null;  // ISO timestamp for optimistic concurrency

// ==========================================
// SIDE MODAL FUNCTIONS
// ==========================================

function openSideModal(mode, cardData = null) {
    const sideModalOverlay = document.getElementById('sideModalOverlay');
    const sideModal = document.getElementById('sideModal');
    const sideModalTitle = document.getElementById('sideModalTitle');
    const saveSideModalBtn = document.getElementById('saveSideModal');
    const formPhotoPreview = document.getElementById('formPhotoPreview');
    const photoUploadLabel = document.getElementById('photoUploadLabel');
    
    if (!sideModalOverlay) {
        return;
    }
    
    currentModalMode = mode;
    currentEditCardId = cardData?.id || null;
    currentEditUpdatedAt = cardData?.updated_at_iso || null;
    
    // Reset form
    const form = document.getElementById('cardForm');
    if (form) form.reset();
    
    // Reset photo preview
    if (formPhotoPreview) {
        formPhotoPreview.classList.remove('no-path', 'path-not-found', 'has-image');
        formPhotoPreview.classList.add('no-path');
        formPhotoPreview.innerHTML = '<i class="fa-solid fa-user"></i>';
    }
    
    const photoPathDisplay = document.getElementById('photoPathDisplay');
    if (photoPathDisplay) {
        photoPathDisplay.classList.remove('not-found');
        photoPathDisplay.classList.add('no-path');
        photoPathDisplay.textContent = 'No image';
    }
    
    // Reset all image field previews (both old and new selectors)
    document.querySelectorAll('.image-preview-small, .image-preview-box').forEach(preview => {
        preview.classList.remove('no-path', 'path-not-found', 'has-image', 'pending-image');
        preview.classList.add('no-path');
        preview.innerHTML = '<i class="fa-solid fa-image"></i>';
    });
    document.querySelectorAll('.image-path-display, .image-path-text').forEach(pathDisplay => {
        pathDisplay.classList.remove('not-found', 'pending');
        pathDisplay.classList.add('no-path');
        pathDisplay.textContent = 'No image';
    });
    
    // Reset image path inputs (new structure)
    document.querySelectorAll('.image-path-input').forEach(pathInput => {
        pathInput.value = '';
        pathInput.classList.remove('has-image', 'pending', 'not-found');
        pathInput.classList.add('no-path');
        pathInput.disabled = false;
        pathInput.placeholder = 'Enter image path or reference...';
    });
    
    // Hide all remove buttons
    document.querySelectorAll('.btn-remove-field').forEach(btn => {
        btn.style.display = 'none';
    });
    
    // Update modal title
    if (sideModalTitle) {
        const titleSpan = sideModalTitle.querySelector('span');
        const titleIcon = sideModalTitle.querySelector('i');
        
        if (mode === 'add') {
            titleIcon.className = 'fa-solid fa-plus';
            titleSpan.textContent = 'Add New Card';
        } else if (mode === 'edit') {
            titleIcon.className = 'fa-solid fa-pen-to-square';
            titleSpan.textContent = 'Edit Card Details';
        } else if (mode === 'view') {
            titleIcon.className = 'fa-solid fa-eye';
            titleSpan.textContent = 'View Card Details';
        }
    }
    
    // Update save button
    if (saveSideModalBtn) {
        const btnSpan = saveSideModalBtn.querySelector('span');
        if (mode === 'add') {
            btnSpan.textContent = 'Add Card';
            saveSideModalBtn.style.display = '';
        } else if (mode === 'edit') {
            btnSpan.textContent = 'Save Changes';
            saveSideModalBtn.style.display = '';
        } else if (mode === 'view') {
            saveSideModalBtn.style.display = 'none';
        }
    }
    
    // Set form fields readonly in view mode
    if (sideModal) {
        sideModal.classList.toggle('view-mode', mode === 'view');
        const inputs = sideModal.querySelectorAll('.form-control');
        inputs.forEach(input => {
            input.readOnly = mode === 'view';
            input.disabled = mode === 'view';
        });
    }
    
    // Hide/show photo upload label (main photo)
    if (photoUploadLabel) {
        photoUploadLabel.style.display = mode === 'view' ? 'none' : '';
    }
    
    // Hide/show all other image upload buttons in view mode
    const allImageUploadBtns = document.querySelectorAll('.image-field-card .image-upload-btn, .image-field-card .image-field-controls');
    allImageUploadBtns.forEach(btn => {
        btn.style.display = mode === 'view' ? 'none' : '';
    });
    
    // Populate form fields
    if ((mode === 'edit' || mode === 'view') && cardData) {
        populateFormFields(cardData);
    }
    
    // Show modal - Update Alpine state if available, else fallback to class toggle
    const alpineComponent = sideModalOverlay._x_dataStack?.[0];
    if (alpineComponent && typeof alpineComponent.openModal === 'function') {
        // Alpine.js component is available - use its reactive state
        alpineComponent.openModal(mode);
    } else {
        // Fallback: direct class manipulation
        sideModalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeSideModal() {
    const sideModalOverlay = document.getElementById('sideModalOverlay');
    
    // Update Alpine state if available, else fallback to class toggle
    const alpineComponent = sideModalOverlay?._x_dataStack?.[0];
    if (alpineComponent && typeof alpineComponent.closeModal === 'function') {
        // Alpine.js component is available - use its reactive state
        alpineComponent.closeModal();
    } else if (sideModalOverlay) {
        // Fallback: direct class manipulation
        sideModalOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    
    currentModalMode = 'add';
    currentEditCardId = null;
}

// Helper function to extract short path (last folder + filename)
// Uses global getShortPath from utils.js if available, with fallback
function getShortPathLocal(fullPath) {
    // Prefer global utility from utils.js (handles PENDING: prefix properly)
    if (typeof window.getShortPath === 'function') {
        return window.getShortPath(fullPath);
    }
    
    // Fallback implementation
    if (!fullPath) return '';
    
    // Handle PENDING: prefix
    if (fullPath.startsWith && fullPath.startsWith('PENDING:')) {
        return `Pending: ${fullPath.substring(8)}`;
    }
    
    // Remove leading /media/ if present
    let path = fullPath.replace(/^\/media\//, '');
    // Split by / and get last 2 parts (folder + filename)
    const parts = path.split('/');
    if (parts.length >= 2) {
        return parts.slice(-2).join('/');
    }
    return parts[parts.length - 1] || path;
}

// Helper function to extract just the filename from a path
function getFilenameOnly(fullPath) {
    if (!fullPath) return '';
    
    // Handle PENDING: prefix
    if (fullPath.startsWith && fullPath.startsWith('PENDING:')) {
        return fullPath.substring(8); // Return just the reference part
    }
    
    // Remove leading /media/ if present
    let path = fullPath.replace(/^\/media\//, '');
    // Split by / and get just the filename
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
}

// Helper function to get the directory part of a path (without filename)
function getPathDirectory(fullPath) {
    if (!fullPath) return '';
    
    // Handle PENDING: prefix - no directory
    if (fullPath.startsWith && fullPath.startsWith('PENDING:')) {
        return '';
    }
    
    // Remove leading /media/ if present
    let path = fullPath.replace(/^\/media\//, '');
    // Split by / and get all but the last part
    const parts = path.split('/');
    if (parts.length > 1) {
        return parts.slice(0, -1).join('/') + '/';
    }
    return '';
}

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
        // Try different case variations for PHOTO field
        photoPath = cardData.field_data['PHOTO'] || 
                    cardData.field_data['Photo'] || 
                    cardData.field_data['photo'];
        
        // If still not found, search all keys case-insensitively
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
        
        // Get thumbnail path for faster loading
        const thumbPath = window.getThumbPath ? window.getThumbPath(photoPath) : null;
        const thumbSrc = thumbPath ? `/media/${thumbPath}${cacheBuster}` : null;
        const originalSrc = `${originalPath}${cacheBuster}`;
        
        if (formPhotoPreview) {
            formPhotoPreview.classList.add('has-image');
            // Use thumbnail with fallback to original
            if (thumbSrc) {
                formPhotoPreview.innerHTML = `<img src="${thumbSrc}" alt="Photo" onerror="this.onerror=null; this.src='${originalSrc}';">`;
            } else {
                formPhotoPreview.innerHTML = `<img src="${originalSrc}" alt="Photo">`;
            }
        }
        if (photoPathDisplay) {
            photoPathDisplay.textContent = getShortPathLocal(originalPath);
        }
    } else if (isPending) {
        // PENDING - Colorful placeholder (image reference exists but waiting for upload)
        if (formPhotoPreview) {
            formPhotoPreview.classList.add('pending-image');
            formPhotoPreview.innerHTML = `<i class="fa-solid fa-clock"></i>`;
        }
        if (photoPathDisplay) {
            photoPathDisplay.classList.add('pending');
            photoPathDisplay.textContent = `Waiting for: ${pendingRef}`;
        }
    } else if (photoPath === 'NOT_FOUND') {
        // Legacy NOT_FOUND - Colorful placeholder
        if (formPhotoPreview) {
            formPhotoPreview.classList.add('path-not-found');
            formPhotoPreview.innerHTML = `<i class="fa-solid fa-image-slash"></i>`;
        }
        if (photoPathDisplay) {
            photoPathDisplay.classList.add('not-found');
            photoPathDisplay.textContent = 'Path exists but image not found';
        }
    } else {
        // Empty/null - Gray placeholder (no image given at all)
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
        formPhotoPreview.innerHTML = `<img src="${cardData.photo}" alt="Photo">`;
    }
    
    // Helper function to normalize field names for comparison
    // Removes spaces, dots, underscores, hyphens and converts to uppercase
    const normalizeFieldName = (name) => {
        if (!name) return '';
        return String(name).toUpperCase().replace(/[\s._\-]+/g, '');
    };
    
    // Helper function to find field value with flexible matching
    const findFieldValue = (fieldName) => {
        if (!fieldName || !cardData.field_data) return undefined;
        
        // Direct match first
        if (cardData.field_data[fieldName] !== undefined) {
            return cardData.field_data[fieldName];
        }
        
        // Try uppercase/lowercase
        if (cardData.field_data[fieldName.toUpperCase()] !== undefined) {
            return cardData.field_data[fieldName.toUpperCase()];
        }
        if (cardData.field_data[fieldName.toLowerCase()] !== undefined) {
            return cardData.field_data[fieldName.toLowerCase()];
        }
        
        // Normalized matching (remove spaces, dots, etc.)
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
        
        // Get ALL inputs in the form (including image section and text fields section)
        const cardForm = document.getElementById('cardForm');
        if (!cardForm) {
            console.error('cardForm not found!');
            return;
        }
        
        // Get inputs from both modal-images-section AND formFieldsContainer
        const allInputs = cardForm.querySelectorAll('input, textarea, select');
        
        allInputs.forEach(input => {
            const fieldName = input.getAttribute('data-field-name') || input.getAttribute('name');
            const fieldType = input.getAttribute('data-field-type') || input.type;
            
            if (!fieldName) {
                return;
            }
            
            // Skip .image-path-input elements — they are already populated
            // when their sibling .image-input (file input) is processed above.
            // Without this, truncated field names like "MOTHER PHOT" fail the
            // isImageFieldByNameModal() regex and fall through to the text-field
            // branch, which overwrites the filename with the full path.
            if (input.classList.contains('image-path-input')) {
                return;
            }
            
            // PHOTO now uses the unified image grid — handled by the generic image path below
            
            // Handle image/file inputs (check by type AND name to catch fields like 'SIGN')
            if (input.type === 'file' || isImageFieldModal(fieldType, fieldName)) {
                const previewId = input.getAttribute('data-preview-id');
                let previewContainer = previewId ? document.getElementById(previewId) : null;
                if (!previewContainer) {
                    // Try new structure (.image-field-card) then old structure (.image-field-row)
                    previewContainer = input.closest('.image-field-card')?.querySelector('.image-preview-box') ||
                                       input.closest('.image-field-row')?.querySelector('.image-preview-small');
                }
                
                // Find path input field (new structure uses input, old uses display div)
                const pathInputId = previewId ? previewId.replace('preview_', 'path_') : null;
                let pathInput = pathInputId ? document.getElementById(pathInputId) : null;
                if (!pathInput) {
                    pathInput = input.closest('.image-field-card')?.querySelector('.image-path-input') ||
                                input.closest('.image-field-card')?.querySelector('.image-path-display');
                }
                
                // Find remove button
                const removeBtn = input.closest('.image-field-card')?.querySelector('.btn-remove-field') ||
                                  document.getElementById(`remove_${fieldName.toLowerCase().replace(/\s+/g, '-')}`);
                
                if (previewContainer) {
                    previewContainer.classList.remove('no-path', 'path-not-found', 'has-image', 'pending-image');
                }
                if (pathInput) {
                    pathInput.classList.remove('no-path', 'not-found', 'pending', 'has-image');
                }
                
                const imgPath = findFieldValue(fieldName);
                
                // Check if it's a PENDING reference
                const isPendingImg = imgPath && imgPath.startsWith('PENDING:');
                const pendingRefImg = isPendingImg ? imgPath.substring(8) : null;
                
                if (imgPath && !isPendingImg && imgPath !== 'NOT_FOUND') {
                    // Valid image path - use thumbnail with fallback to original
                    const cacheBuster = `?t=${Date.now()}`;
                    const originalPath = imgPath.startsWith('/media/') || imgPath.startsWith('http') 
                        ? imgPath 
                        : `/media/${imgPath}`;
                    
                    // Get thumbnail path for faster loading
                    const thumbPath = window.getThumbPath ? window.getThumbPath(imgPath) : null;
                    const thumbSrc = thumbPath ? `/media/${thumbPath}${cacheBuster}` : null;
                    const originalSrc = `${originalPath}${cacheBuster}`;
                    
                    if (previewContainer) {
                        previewContainer.classList.add('has-image');
                        // Use thumbnail with fallback to original
                        if (thumbSrc) {
                            previewContainer.innerHTML = `<img src="${thumbSrc}" alt="${fieldName}" onerror="this.onerror=null; this.src='${originalSrc}';">`;
                        } else {
                            previewContainer.innerHTML = `<img src="${originalSrc}" alt="${fieldName}">`;
                        }
                    }
                    if (pathInput) {
                        if (pathInput.tagName === 'INPUT') {
                            // Store directory part in data attribute, show only filename
                            const directory = getPathDirectory(imgPath);
                            const filename = getFilenameOnly(imgPath);
                            pathInput.value = filename;
                            pathInput.dataset.directory = directory;
                            pathInput.dataset.originalPath = imgPath;
                            pathInput.classList.add('has-image');
                            // Always keep editable - user can change filename
                        } else {
                            pathInput.textContent = getShortPathLocal(originalPath);
                        }
                    }
                    // Show remove button when image exists
                    if (removeBtn) removeBtn.style.display = '';
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
                            // No directory for pending - it's just a reference
                            pathInput.dataset.directory = '';
                            pathInput.dataset.originalPath = '';
                        } else {
                            pathInput.classList.add('pending');
                            pathInput.textContent = `Waiting for: ${pendingRefImg}`;
                        }
                    }
                    // Hide remove button for pending
                    if (removeBtn) removeBtn.style.display = 'none';
                } else if (imgPath === 'NOT_FOUND') {
                    // Legacy NOT_FOUND
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
                }
                return;
            }
            
            // Handle text/date/number/email/textarea inputs
            const fieldValue = findFieldValue(fieldName);
            
            if (fieldValue !== undefined && fieldValue !== null) {
                // Handle date fields - convert DD-MM-YYYY to YYYY-MM-DD for HTML date input
                if (fieldType === 'date' || input.type === 'date') {
                    const dateStr = String(fieldValue);
                    // Check if it's in DD-MM-YYYY format
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
            
            if (isImageFieldModal(fieldType, fieldName) || input.type === 'file') {
                if (input.files && input.files[0]) {
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

function fetchCardAndOpenModal(mode, cardId) {
    ApiClient.get(`/panel/api/card/${cardId}/`)
        .then(data => {
            if (data.success) {
                openSideModal(mode, data.card);
            } else {
                if (typeof showToast === 'function') showToast('Error loading card data', false);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            if (typeof showToast === 'function') showToast('Error loading card data', false);
        });
}

function createNewCard(fieldData, imageFiles, mainPhoto) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    
    // Send field data as-is - backend handles selective uppercase
    // (uppercasing text fields while preserving image paths)
    const formData = new FormData();
    formData.append('field_data', JSON.stringify(fieldData));
    
    if (mainPhoto) {
        formData.append('photo', mainPhoto);
    }
    
    for (const [fieldName, file] of Object.entries(imageFiles)) {
        formData.append(`image_${fieldName}`, file);
    }
    
    ApiClient.upload(`/panel/api/table/${tableId}/card/create/`, formData)
    .then(data => {
        if (data.success) {
            if (typeof showToast === 'function') showToast('Card added successfully!');
            closeSideModal();
            window.location.href = `?status=pending`;
        } else {
            if (typeof showToast === 'function') showToast(data.message || 'Error adding card', false);
            if (window._restoreSaveBtn) window._restoreSaveBtn();
        }
    })
    .catch(error => {
        console.error('Error:', error);
        if (typeof showToast === 'function') showToast('Error adding card', false);
        if (window._restoreSaveBtn) window._restoreSaveBtn();
    });
}

function updateExistingCard(cardId, fieldData, imageFiles, mainPhoto) {
    
    // Send field data as-is - backend handles selective uppercase
    // (uppercasing text fields while preserving image paths)
    const formData = new FormData();
    formData.append('field_data', JSON.stringify(fieldData));
    
    // Optimistic concurrency: send the timestamp from when we loaded the card
    if (currentEditUpdatedAt) {
        formData.append('expected_updated_at', currentEditUpdatedAt);
    }
    
    if (mainPhoto) {
        formData.append('photo', mainPhoto);
    }
    
    for (const [fieldName, file] of Object.entries(imageFiles)) {
        formData.append(`image_${fieldName}`, file);
    }
    
    ApiClient.upload(`/panel/api/card/${cardId}/update/`, formData)
    .then(data => {
        if (data.success) {
            if (typeof showToast === 'function') showToast('Card updated successfully!');
            closeSideModal();
            // Force reload without cache
            window.location.href = window.location.href.split('?')[0] + '?status=' + (typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : 'pending') + '&t=' + Date.now();
        } else {
            // Check for concurrency conflict
            if (data.conflict) {
                if (typeof showToast === 'function') showToast('This card was modified by another user. Please close and reopen to see latest data.', false);
            } else {
                if (typeof showToast === 'function') showToast(data.message || 'Error updating card', false);
            }
            if (window._restoreSaveBtn) window._restoreSaveBtn();
        }
    })
    .catch(error => {
        console.error('Error:', error);
        if (typeof showToast === 'function') showToast('Error updating card', false);
        if (window._restoreSaveBtn) window._restoreSaveBtn();
    });
}

// ==========================================
// DELETE MODAL (Permanent Delete - Pool List)
// ==========================================

// Generate random 6-digit numeric code
function generateVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

// Current verification code for permanent delete
let currentVerificationCode = null;

function closeDeleteModalFn() {
    const deleteModalOverlay = document.getElementById('deleteModalOverlay');
    if (deleteModalOverlay) {
        deleteModalOverlay.classList.remove('active');
        document.body.style.overflow = ''; // Restore body scroll
    }
    // Reset verification
    const verificationInput = document.getElementById('deleteVerificationInput');
    const confirmBtn = document.getElementById('confirmDeleteModal');
    if (verificationInput) {
        verificationInput.value = '';
        verificationInput.classList.remove('valid', 'invalid');
    }
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete Permanently';
    }
    const verificationStatus = document.getElementById('verificationStatus');
    if (verificationStatus) {
        verificationStatus.textContent = '';
        verificationStatus.classList.remove('match', 'no-match');
    }
    window.pendingDeleteCardIds = null;
    currentVerificationCode = null;
}

function openPermanentDeleteModal(cardIds) {
    // Generate new verification code
    currentVerificationCode = generateVerificationCode();
    
    // Update count text
    const deleteCountText = document.getElementById('deleteCountText');
    if (deleteCountText) {
        deleteCountText.textContent = `${cardIds.length} card(s)`;
    }
    
    // Display the verification code
    const codeDisplay = document.getElementById('deleteVerificationCode');
    if (codeDisplay) {
        codeDisplay.textContent = currentVerificationCode;
    }
    
    // Store card IDs
    window.pendingDeleteCardIds = cardIds;
    
    // Reset and show modal
    const verificationInput = document.getElementById('deleteVerificationInput');
    if (verificationInput) {
        verificationInput.value = '';
        verificationInput.classList.remove('valid', 'invalid');
    }
    
    const confirmBtn = document.getElementById('confirmDeleteModal');
    if (confirmBtn) {
        confirmBtn.disabled = true;
    }
    
    const deleteModalOverlay = document.getElementById('deleteModalOverlay');
    if (deleteModalOverlay) {
        deleteModalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        // Focus verification input
        setTimeout(() => verificationInput?.focus(), 100);
    }
}

function initDeleteModal() {
    const deleteModalOverlay = document.getElementById('deleteModalOverlay');
    const closeDeleteModal = document.getElementById('closeDeleteModal');
    const cancelDeleteModal = document.getElementById('cancelDeleteModal');
    const confirmDeleteModal = document.getElementById('confirmDeleteModal');
    const verificationInput = document.getElementById('deleteVerificationInput');
    
    // Close handlers
    if (closeDeleteModal) {
        closeDeleteModal.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            closeDeleteModalFn();
        });
    }
    if (cancelDeleteModal) {
        cancelDeleteModal.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            closeDeleteModalFn();
        });
    }
    
    if (deleteModalOverlay) {
        deleteModalOverlay.addEventListener('click', function(e) {
            if (e.target === this) closeDeleteModalFn();
        });
    }
    
    // Verification code input handler
    if (verificationInput) {
        verificationInput.addEventListener('input', function() {
            const entered = this.value.trim();
            const confirmBtn = document.getElementById('confirmDeleteModal');
            const verificationStatus = document.getElementById('verificationStatus');
            
            if (entered.length === 6) {
                if (entered === currentVerificationCode) {
                    this.classList.remove('invalid');
                    this.classList.add('valid');
                    if (confirmBtn) confirmBtn.disabled = false;
                    if (verificationStatus) {
                        verificationStatus.textContent = '✓ Code matched';
                        verificationStatus.classList.remove('no-match');
                        verificationStatus.classList.add('match');
                    }
                } else {
                    this.classList.remove('valid');
                    this.classList.add('invalid');
                    if (confirmBtn) confirmBtn.disabled = true;
                    if (verificationStatus) {
                        verificationStatus.textContent = '✗ Code does not match';
                        verificationStatus.classList.remove('match');
                        verificationStatus.classList.add('no-match');
                    }
                }
            } else {
                this.classList.remove('valid', 'invalid');
                if (confirmBtn) confirmBtn.disabled = true;
                if (verificationStatus) {
                    verificationStatus.textContent = '';
                    verificationStatus.classList.remove('match', 'no-match');
                }
            }
        });
    }
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && deleteModalOverlay?.classList.contains('active')) {
            closeDeleteModalFn();
        }
    });
    
    if (confirmDeleteModal) {
        confirmDeleteModal.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const cardIds = window.pendingDeleteCardIds;
            const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
            
            if (!cardIds || cardIds.length === 0 || !tableId) {
                if (typeof showToast === 'function') showToast('Error: No cards selected or Table ID not found', false);
                closeDeleteModalFn();
                return;
            }
            
            // Double-check verification code
            const verificationInput = document.getElementById('deleteVerificationInput');
            if (!verificationInput || verificationInput.value !== currentVerificationCode) {
                if (typeof showToast === 'function') showToast('Please enter the correct verification code', false);
                return;
            }
            
            this.disabled = true;
            this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
            
            ApiClient.post(`/panel/api/table/${tableId}/cards/bulk-delete/`, { card_ids: cardIds })
            .then(data => {
                closeDeleteModalFn();
                if (data.success) {
                    if (typeof showToast === 'function') showToast(`${data.deleted_count} card(s) permanently deleted`);
                    location.reload();
                } else {
                    if (typeof showToast === 'function') showToast(data.message || 'Error deleting cards', false);
                    confirmDeleteModal.disabled = false;
                    confirmDeleteModal.innerHTML = '<i class="fa-solid fa-trash"></i> Delete Permanently';
                }
            })
            .catch(error => {
                console.error('Error:', error);
                closeDeleteModalFn();
                if (typeof showToast === 'function') showToast('Error deleting cards', false);
                confirmDeleteModal.disabled = false;
                confirmDeleteModal.innerHTML = '<i class="fa-solid fa-trash"></i> Delete Permanently';
            });
        });
    }
}

// ==========================================
// SIMPLE DELETE MODAL (Move to Pool - Pending/Verified)
// ==========================================

function closeSimpleDeleteModalFn() {
    const modal = document.getElementById('simpleDeleteModalOverlay');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
    window.pendingSimpleDeleteCardIds = null;
}

function openSimpleDeleteModal(cardIds) {
    window.pendingSimpleDeleteCardIds = cardIds;
    
    const countText = document.getElementById('simpleDeleteCountText');
    if (countText) {
        countText.textContent = `${cardIds.length} card(s)`;
    }
    
    const modal = document.getElementById('simpleDeleteModalOverlay');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function initSimpleDeleteModal() {
    const modal = document.getElementById('simpleDeleteModalOverlay');
    const closeBtn = document.getElementById('closeSimpleDeleteModal');
    const cancelBtn = document.getElementById('cancelSimpleDeleteModal');
    const confirmBtn = document.getElementById('confirmSimpleDeleteModal');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', closeSimpleDeleteModalFn);
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeSimpleDeleteModalFn);
    }
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === this) closeSimpleDeleteModalFn();
        });
    }
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && modal?.classList.contains('active')) {
            closeSimpleDeleteModalFn();
        }
    });
    
    if (confirmBtn) {
        confirmBtn.addEventListener('click', function() {
            const cardIds = window.pendingSimpleDeleteCardIds;
            const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
            
            if (!cardIds || cardIds.length === 0 || !tableId) {
                if (typeof showToast === 'function') showToast('Error: No cards selected', false);
                closeSimpleDeleteModalFn();
                return;
            }
            
            this.disabled = true;
            this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
            
            // Delete cards (moves to pool status)
            ApiClient.post(`/panel/api/table/${tableId}/cards/bulk-status/`, { card_ids: cardIds, status: 'pool' })
            .then(data => {
                closeSimpleDeleteModalFn();
                if (data.success) {
                    if (typeof showToast === 'function') showToast(`${data.updated_count} card(s) deleted`);
                    location.reload();
                } else {
                    if (typeof showToast === 'function') showToast(data.message || 'Error deleting cards', false);
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Delete';
                }
            })
            .catch(error => {
                console.error('Error:', error);
                closeSimpleDeleteModalFn();
                if (typeof showToast === 'function') showToast('Error deleting cards', false);
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Delete';
            });
        });
    }
}

// ==========================================
// INITIALIZATION
// ==========================================

function initModalModule() {
    try {
        const sideModalOverlay = document.getElementById('sideModalOverlay');
        const saveSideModalBtn = document.getElementById('saveSideModal');
        const formPhotoInput = document.getElementById('formPhotoInput');
        const formPhotoPreview = document.getElementById('formPhotoPreview');
        
        // Close side modal handlers
        const closeSideModalBtn = document.getElementById('closeSideModal');
        const cancelSideModalBtn = document.getElementById('cancelSideModal');
        
        if (closeSideModalBtn) {
            closeSideModalBtn.addEventListener('click', function() {
                closeSideModal();
            });
        }
        if (cancelSideModalBtn) {
            cancelSideModalBtn.addEventListener('click', function() {
                closeSideModal();
            });
        }
    
    // NOTE: Removed click-outside-to-close behavior - modal should only close via X or Cancel button
    // if (sideModalOverlay) {
    //     sideModalOverlay.addEventListener('click', function(e) {
    //         if (e.target === this) closeSideModal();
    //     });
    // }
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && sideModalOverlay?.classList.contains('active')) {
            closeSideModal();
        }
    });
    
    // Photo upload preview
    if (formPhotoInput) {
        formPhotoInput.addEventListener('change', function() {
            if (this.files && this.files[0]) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    if (formPhotoPreview) {
                        formPhotoPreview.innerHTML = `<img src="${e.target.result}" alt="Photo">`;
                    }
                };
                reader.readAsDataURL(this.files[0]);
            }
        });
    }
    
    // Image field upload previews
    document.querySelectorAll('.image-input').forEach(input => {
        input.addEventListener('change', function() {
            if (this.files && this.files[0]) {
                const previewId = this.getAttribute('data-preview-id');
                const previewEl = document.getElementById(previewId);
                const fieldName = this.getAttribute('data-field-name');
                
                // Find path input and remove button
                const fieldCard = this.closest('.image-field-card');
                const pathInput = fieldCard?.querySelector('.image-path-input');
                const removeBtn = fieldCard?.querySelector('.btn-remove-field');
                
                if (previewEl) {
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        previewEl.classList.remove('no-path', 'pending-image', 'path-not-found');
                        previewEl.classList.add('has-image');
                        previewEl.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
                    };
                    reader.readAsDataURL(this.files[0]);
                }
                
                // Update path input to show new file name
                if (pathInput) {
                    pathInput.value = this.files[0].name;
                    pathInput.classList.remove('no-path', 'pending', 'not-found');
                    pathInput.classList.add('has-image');
                    // Clear directory since new file will be uploaded
                    pathInput.dataset.directory = '';
                    pathInput.dataset.originalPath = '';
                    pathInput.dataset.hasNewFile = 'true';
                }
                
                // Show remove button
                if (removeBtn) {
                    removeBtn.style.display = '';
                }
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
        });
    });
    
    // Add button
    const addBtn = document.getElementById('addBtn');
    if (addBtn) {
        addBtn.addEventListener('click', function() {
            openSideModal('add');
        });
    }
    
    // Edit buttons
    const editBtnIds = ['editBtn', 'editBtnV', 'editBtnA', 'editBtnD'];
    editBtnIds.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', function() {
                const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
                if (selectedIds.length === 1) {
                    fetchCardAndOpenModal('edit', selectedIds[0]);
                }
            });
        }
    });
    
    // View buttons
    const viewBtnIds = ['viewBtn', 'viewBtnV', 'viewBtnP', 'viewBtnA', 'viewBtnD'];
    viewBtnIds.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', function() {
                const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
                if (selectedIds.length === 1) {
                    fetchCardAndOpenModal('view', selectedIds[0]);
                }
            });
        }
    });
    
    // Edit photo buttons in table rows - use event delegation for dynamic rows
    const dataTable = document.getElementById('data-table');
    if (dataTable) {
        dataTable.addEventListener('click', function(e) {
            const editBtn = e.target.closest('.edit-photo-btn');
            if (!editBtn) return;
            
            e.stopPropagation();
            
            // Pencil button directly edits the card it's on, regardless of checkbox selection
            const cardId = editBtn.getAttribute('data-card-id');
            if (cardId) {
                fetchCardAndOpenModal('edit', cardId);
            }
        });
    }
    
    // Save button
    if (saveSideModalBtn) {
        saveSideModalBtn.addEventListener('click', function() {
            // Prevent double-click submission
            if (saveSideModalBtn.disabled) return;
            saveSideModalBtn.disabled = true;
            const originalHTML = saveSideModalBtn.innerHTML;
            saveSideModalBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Saving...</span>';

            // Re-enable on timeout (safety fallback)
            const reEnableTimeout = setTimeout(function() {
                saveSideModalBtn.disabled = false;
                saveSideModalBtn.innerHTML = originalHTML;
            }, 10000);

            // Store restore function globally so create/update can call it on error
            window._restoreSaveBtn = function() {
                clearTimeout(reEnableTimeout);
                saveSideModalBtn.disabled = false;
                saveSideModalBtn.innerHTML = originalHTML;
            };

            const { fieldData, imageFiles } = getFormData();
            const mainPhoto = getMainPhotoFile();
            
            if (currentModalMode === 'add') {
                createNewCard(fieldData, imageFiles, mainPhoto);
            } else if (currentModalMode === 'edit' && currentEditCardId) {
                updateExistingCard(currentEditCardId, fieldData, imageFiles, mainPhoto);
            } else {
                // Edge case: invalid mode, re-enable
                if (window._restoreSaveBtn) window._restoreSaveBtn();
            }
        });
    }
    
    // Initialize delete modal
    initDeleteModal();
    
    // Initialize simple delete modal (for pending/verified)
    initSimpleDeleteModal();
    
    // Delete key handler
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Delete') return;
        
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) return;
        if (sideModalOverlay?.classList.contains('active')) return;
        if (document.getElementById('uploadModalOverlay')?.classList.contains('active')) return;
        if (document.getElementById('deleteModalOverlay')?.classList.contains('active')) return;
        if (document.getElementById('simpleDeleteModalOverlay')?.classList.contains('active')) return;
        
        const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
        if (selectedIds.length === 0) return;
        
        e.preventDefault();
        
        const currentStatus = typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : 'pending';
        
        if (currentStatus === 'pool') {
            // Pool list: use permanent delete with verification code
            openPermanentDeleteModal(selectedIds);
        } else {
            // Other lists: use simple delete (move to pool) with confirmation
            openSimpleDeleteModal(selectedIds);
        }
    });
    
    } catch (error) {
        console.error('initModalModule: Error during initialization:', error);
    }
}

// Expose globally
window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.initModalModule = initModalModule;
window.IDCardApp.openSideModal = openSideModal;
window.IDCardApp.closeSideModal = closeSideModal;
window.IDCardApp.fetchCardAndOpenModal = fetchCardAndOpenModal;
window.IDCardApp.openSimpleDeleteModal = openSimpleDeleteModal;
window.IDCardApp.openPermanentDeleteModal = openPermanentDeleteModal;
// Only set global openSideModal/closeSideModal if Alpine hasn't already set them
// Alpine's version triggers reactive state; this version is fallback
if (typeof window.openSideModal !== 'function') {
    window.openSideModal = openSideModal;
}
if (typeof window.closeSideModal !== 'function') {
    window.closeSideModal = closeSideModal;
}
window.openSimpleDeleteModal = openSimpleDeleteModal;
window.openPermanentDeleteModal = openPermanentDeleteModal;
window.closeDeleteModalFn = closeDeleteModalFn;
window.closeSimpleDeleteModalFn = closeSimpleDeleteModalFn;

})();
