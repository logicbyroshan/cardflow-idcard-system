// ID Card Actions - Modal View Render
// Contains: Side modal open/close, in-place row updates
// Part of idcard-actions-modal-view module split

(function() {
'use strict';

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
            if (input.type === 'file') {
                // File inputs: only toggle disabled (readOnly not supported)
                input.disabled = mode === 'view';
            } else {
                input.readOnly = mode === 'view';
                input.disabled = mode === 'view';
            }
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
    
    // Populate form fields (populateFormFields lives in helpers module)
    if ((mode === 'edit' || mode === 'view') && cardData) {
        try {
            window.IDCardApp.populateFormFields(cardData);
        } catch (e) {
            console.error('openSideModal: populateFormFields error', e);
        }
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

    // Attach data sanitizer to the card form in add/edit mode
    if (mode !== 'view' && window.DataSanitizer) {
        const cardForm = document.getElementById('cardForm');
        if (cardForm) DataSanitizer.attachToForm(cardForm);
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

// ==========================================
// IN-PLACE ROW UPDATE (avoids full page reload)
// ==========================================

/**
 * Update a single table row in-place after modal edit save.
 * Falls back to HTMX refreshTable if the row is not found in the DOM.
 */
function _updateRowInPlace(cardId, cardData) {
    const row = document.querySelector(`tr[data-card-id="${cardId}"]`);
    if (!row || !cardData || !cardData.field_data) {
        // Row not in DOM (filtered/paginated away) — do a soft table refresh
        if (typeof refreshCardTable === 'function') {
            refreshCardTable();
        } else if (window.IDCardApp && typeof window.IDCardApp.refreshCardTable === 'function') {
            window.IDCardApp.refreshCardTable();
        }
        return;
    }

    const fieldData = cardData.field_data;
    const _esc = window.escapeHtml || function(s) {
        return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    };

    // Update text/editable cells
    row.querySelectorAll('td[data-field-name]').forEach(function(td) {
        const fieldName = td.getAttribute('data-field-name');
        if (!fieldName) return;
        const newValue = fieldData[fieldName];
        if (newValue === undefined) return;

        td.setAttribute('data-original-value', _esc(newValue));

        // Image cell — update src
        if (td.classList.contains('image-field')) {
            const img = td.querySelector('img.table-image');
            const isPending = newValue && newValue.startsWith('PENDING:');
            const isNotFound = newValue === 'NOT_FOUND';
            const hasValidImage = newValue && newValue !== '' && !isPending && !isNotFound;

            if (hasValidImage) {
                // Valid image path — show thumbnail
                const cacheBuster = '?t=' + Date.now();
                const thumbPath = window.getThumbPath ? window.getThumbPath(newValue) : newValue;
                const thumbSrc = thumbPath ? '/media/' + thumbPath + cacheBuster : null;
                const originalSrc = '/media/' + newValue + cacheBuster;

                // Remove any placeholder that might exist
                const placeholder = td.querySelector('.no-image');
                if (placeholder) placeholder.remove();

                if (img) {
                    // Existing img element — just update src
                    img.src = thumbSrc || originalSrc;
                    img.onerror = function() { this.onerror = null; this.src = originalSrc; };
                    img.style.display = '';
                } else {
                    // No img element exists (was a placeholder) — create one
                    var wrapper = td.querySelector('.image-with-edit') || td;
                    var newImg = document.createElement('img');
                    newImg.src = thumbSrc || originalSrc;
                    newImg.alt = fieldName;
                    newImg.className = 'table-image';
                    newImg.loading = 'lazy';
                    newImg.decoding = 'async';
                    newImg.onerror = function() { this.onerror = null; this.src = originalSrc; };
                    wrapper.insertBefore(newImg, wrapper.firstChild);
                }

                // Show edit-photo button if it was hidden; recreate if missing
                var editBtn = td.querySelector('.edit-photo-btn');
                if (editBtn) {
                    editBtn.style.display = '';
                } else if (typeof PERMS !== 'undefined' && PERMS.idcard_edit) {
                    // Recreate the edit button if it was removed from the DOM
                    var wrapper2 = td.querySelector('.image-with-edit') || td;
                    var newEditBtn = document.createElement('button');
                    newEditBtn.className = 'edit-photo-btn';
                    newEditBtn.setAttribute('data-card-id', cardId);
                    newEditBtn.title = 'Edit Card';
                    newEditBtn.textContent = 'Edit';
                    wrapper2.appendChild(newEditBtn);
                }
            } else {
                // Image removed, empty, PENDING, or NOT_FOUND — hide img, show placeholder
                if (img) {
                    img.style.display = 'none';
                    img.removeAttribute('src');
                }
                // Hide edit-photo button
                const editBtn = td.querySelector('.edit-photo-btn');
                if (editBtn) editBtn.style.display = 'none';

                // Remove old placeholder if any
                var existingPlaceholder = td.querySelector('.no-image');
                if (existingPlaceholder) existingPlaceholder.remove();

                // Insert appropriate placeholder
                var wrapper = td.querySelector('.image-with-edit') || td;
                if (isPending) {
                    var pendRef = newValue.replace('PENDING:', '');
                    var ph = document.createElement('div');
                    ph.className = 'no-image pending-placeholder';
                    ph.title = 'Waiting for upload: ' + pendRef;
                    ph.innerHTML = '<i class="fa-solid fa-clock"></i>';
                    wrapper.insertBefore(ph, wrapper.firstChild);
                } else {
                    var ph = document.createElement('div');
                    ph.className = 'no-image colorful-placeholder';
                    ph.title = isNotFound ? 'Image not found' : '';
                    ph.innerHTML = '<i class="fa-solid fa-user-astronaut"></i>';
                    wrapper.insertBefore(ph, wrapper.firstChild);
                }
            }
        } else {
            // Text cell — update span
            const span = td.querySelector('.cell-value');
            if (span) {
                span.textContent = newValue;
            }
        }
    });

    // Update the updated_at cell if present
    if (cardData.updated_at) {
        const dateCells = row.querySelectorAll('.date-cell');
        if (dateCells.length > 0) {
            const lastDateCell = dateCells[dateCells.length - 1];
            // Only update if it looks like a timestamp cell (not downloaded_at/deleted_at)
            if (lastDateCell.previousElementSibling && !lastDateCell.previousElementSibling.classList.contains('action-cell')) {
                // The updated_at is typically the second to last cell
            }
        }
    }

    // Flash green to show success
    row.style.transition = 'background 0.3s';
    row.style.background = '#dcfce7';
    setTimeout(function() {
        row.style.background = '';
        setTimeout(function() { row.style.transition = ''; }, 300);
    }, 1500);

    // Re-apply filters if active
    if (window.IDCardApp && typeof window.IDCardApp.applyFiltersAndSort === 'function') {
        window.IDCardApp.applyFiltersAndSort();
    }

    // Handle broken images — delay to let freshly-set img.src start loading
    // Without delay, handleBrokenImages() races with the new image load
    // and can flag it as broken (naturalWidth === 0), hiding the edit button.
    if (window.IDCardApp && typeof window.IDCardApp.handleBrokenImages === 'function') {
        setTimeout(function() {
            window.IDCardApp.handleBrokenImages();
        }, 800);
    }
}

// ==========================================
// EXPORTS
// ==========================================

window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.openSideModal = openSideModal;
window.IDCardApp.closeSideModal = closeSideModal;
window.IDCardApp._updateRowInPlace = _updateRowInPlace;

// Expose modal state for form module (read/write via property accessors)
Object.defineProperties(IDCardApp, {
    currentModalMode: { get: function() { return currentModalMode; }, set: function(v) { currentModalMode = v; }, configurable: true },
    currentEditCardId: { get: function() { return currentEditCardId; }, set: function(v) { currentEditCardId = v; }, configurable: true },
    currentEditUpdatedAt: { get: function() { return currentEditUpdatedAt; }, set: function(v) { currentEditUpdatedAt = v; }, configurable: true }
});

// Only set global openSideModal/closeSideModal if Alpine hasn't already set them
// Alpine's version triggers reactive state; this version is fallback
if (typeof window.openSideModal !== 'function') {
    window.openSideModal = openSideModal;
}
if (typeof window.closeSideModal !== 'function') {
    window.closeSideModal = closeSideModal;
}

})();
