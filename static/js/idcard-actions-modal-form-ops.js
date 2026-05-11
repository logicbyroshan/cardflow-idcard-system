// ID Card Actions - Modal Form Operations Module
// Contains: API calls (fetch/create/update), modal event handling, initialization
// Split from idcard-actions-modal-form.js

(function() {
'use strict';

// ==========================================
// API OPERATIONS
// ==========================================

function fetchCardAndOpenModal(mode, cardId) {
    ApiClient.get(`/api/card/${cardId}/`)
        .then(data => {
            if (data.success) {
                IDCardApp.openSideModal(mode, data.card);
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
    
    ApiClient.upload(`/api/table/${tableId}/card/create/`, formData)
    .then(data => {
        if (data.success) {
            if (typeof showToast === 'function') showToast('Card added successfully!');
            IDCardApp.closeSideModal();
            
            // Try to prepend new card to table without full refresh
            var handled = false;
            
            // First try: prepend to table (new implementation)
            if (window.IDCardApp && typeof window.IDCardApp.prependCardRowToTable === 'function' && data.card) {
                try {
                    window.IDCardApp.prependCardRowToTable(data.card);
                    handled = true;
                    console.log('Card prepended successfully');
                } catch (err) {
                    console.error('prependCardRowToTable failed:', err);
                    handled = false;
                }
            }

            if (!handled) {
                console.error('Card insert failed and no local fallback was applied');
            }
        } else {
            if (typeof showToast === 'function') showToast(data.message || 'Error adding card', false);
            if (IDCardApp._restoreSaveBtn) IDCardApp._restoreSaveBtn();
        }
    })
    .catch(error => {
        console.error('Error:', error);
        if (typeof showToast === 'function') showToast('Error adding card', false);
        if (IDCardApp._restoreSaveBtn) IDCardApp._restoreSaveBtn();
    });
}

function updateExistingCard(cardId, fieldData, imageFiles, mainPhoto) {
    
    // Send field data as-is - backend handles selective uppercase
    // (uppercasing text fields while preserving image paths)
    const formData = new FormData();
    formData.append('field_data', JSON.stringify(fieldData));
    
    // Optimistic concurrency: send the timestamp from when we loaded the card
    if (IDCardApp.currentEditUpdatedAt) {
        formData.append('expected_updated_at', IDCardApp.currentEditUpdatedAt);
    }
    
    if (mainPhoto) {
        formData.append('photo', mainPhoto);
    }
    
    for (const [fieldName, file] of Object.entries(imageFiles)) {
        formData.append(`image_${fieldName}`, file);
    }
    
    ApiClient.upload(`/api/card/${cardId}/update/`, formData)
    .then(data => {
        if (data.success) {
            if (typeof showToast === 'function') showToast('Card updated successfully!');
            IDCardApp.closeSideModal();
            // Update the row in-place instead of full page reload.
            // This preserves scroll position and avoids losing user context.
            IDCardApp._updateRowInPlace(cardId, data.card);
            document.dispatchEvent(new CustomEvent('idcard:card-updated', {
                detail: {
                    cardId: cardId,
                    card: data.card || null,
                }
            }));
            if (IDCardApp._restoreSaveBtn) IDCardApp._restoreSaveBtn();
        } else {
            // Check for concurrency conflict
            if (data.conflict) {
                if (typeof showToast === 'function') showToast('This card was modified by another user. Please close and reopen to see latest data.', false);
            } else {
                if (typeof showToast === 'function') showToast(data.message || 'Error updating card', false);
            }
            if (IDCardApp._restoreSaveBtn) IDCardApp._restoreSaveBtn();
        }
    })
    .catch(error => {
        console.error('Error:', error);
        if (typeof showToast === 'function') showToast('Error updating card', false);
        if (IDCardApp._restoreSaveBtn) IDCardApp._restoreSaveBtn();
    });
}

// ==========================================
// INITIALIZATION
// ==========================================

function initModalModule() {
    try {
        const sideModalOverlay = document.getElementById('sideModalOverlay');
        const saveSideModalBtn = document.getElementById('saveSideModal');
        
        // Close side modal handlers
        const closeSideModalBtn = document.getElementById('closeSideModal');
        const cancelSideModalBtn = document.getElementById('cancelSideModal');
        
        if (closeSideModalBtn) {
            closeSideModalBtn.addEventListener('click', function() {
                IDCardApp.closeSideModal();
            });
        }
        if (cancelSideModalBtn) {
            cancelSideModalBtn.addEventListener('click', function() {
                IDCardApp.closeSideModal();
            });
        }
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && sideModalOverlay?.classList.contains('active')) {
            IDCardApp.closeSideModal();
        }
    });
    
    // Initialize form data handlers (photo preview, image fields, remove buttons)
    IDCardApp.initFormDataHandlers();
    
    // Add button
    const addBtn = document.getElementById('addBtn');
    if (addBtn) {
        addBtn.addEventListener('click', function() {
            IDCardApp.openSideModal('add');
        });
    }
    
    // Edit buttons
    const editBtnIds = ['editBtn', 'editBtnV', 'editBtnA', 'editBtnD'];
    editBtnIds.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', function() {
                const selectedIds = (window.IDCardApp && typeof window.IDCardApp.getSelectedCardIds === 'function') ? window.IDCardApp.getSelectedCardIds() : [];
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
                const selectedIds = (window.IDCardApp && typeof window.IDCardApp.getSelectedCardIds === 'function') ? window.IDCardApp.getSelectedCardIds() : [];
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
            IDCardApp._restoreSaveBtn = function() {
                clearTimeout(reEnableTimeout);
                saveSideModalBtn.disabled = false;
                saveSideModalBtn.innerHTML = originalHTML;
            };

            const { fieldData, imageFiles } = IDCardApp.getFormData();
            const mainPhoto = IDCardApp.getMainPhotoFile();
            
            //  Validate text fields via FieldClassifier 
            if (window.FieldClassifier) {
                var errors = [];
                var cardForm = document.getElementById('cardForm');
                if (cardForm) {
                    var inputs = cardForm.querySelectorAll('.form-control:not([type="file"])');
                    inputs.forEach(function(input) {
                        var fn = input.getAttribute('data-field-name');
                        var ft = input.getAttribute('data-field-type') || '';
                        var val = input.value || '';
                        if (fn && val.trim()) {
                            var vr = FieldClassifier.validate(fn, ft, val);
                            if (!vr.valid) errors.push(fn + ': ' + vr.message);
                        }
                    });
                }
                if (errors.length > 0) {
                    if (typeof showToast === 'function') showToast(errors[0], 'error');
                    if (IDCardApp._restoreSaveBtn) IDCardApp._restoreSaveBtn();
                    return;
                }
            }
            
            if (IDCardApp.currentModalMode === 'add') {
                createNewCard(fieldData, imageFiles, mainPhoto);
            } else if (IDCardApp.currentModalMode === 'edit' && IDCardApp.currentEditCardId) {
                updateExistingCard(IDCardApp.currentEditCardId, fieldData, imageFiles, mainPhoto);
            } else {
                // Edge case: invalid mode, re-enable
                if (IDCardApp._restoreSaveBtn) IDCardApp._restoreSaveBtn();
            }
        });
    }
    
    // Initialize delete modal
    IDCardApp.initDeleteModal();
    
    // Initialize simple delete modal (for pending/verified)
    IDCardApp.initSimpleDeleteModal();
    
    // Delete key handler
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Delete') return;
        
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) return;
        if (sideModalOverlay?.classList.contains('active')) return;
        if (document.getElementById('uploadModalOverlay')?.classList.contains('active')) return;
        if (document.getElementById('deleteModalOverlay')?.classList.contains('active')) return;
        if (document.getElementById('simpleDeleteModalOverlay')?.classList.contains('active')) return;
        
        const selectedIds = (window.IDCardApp && typeof window.IDCardApp.getSelectedCardIds === 'function') ? window.IDCardApp.getSelectedCardIds() : [];
        if (selectedIds.length === 0) return;
        
        e.preventDefault();
        
        const currentStatus = typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : 'pending';
        
        if (currentStatus === 'pool') {
            // Pool list: use permanent delete with verification code
            IDCardApp.openPermanentDeleteModal(selectedIds);
        } else {
            // Other lists: use simple delete (move to pool) with confirmation
            IDCardApp.openSimpleDeleteModal(selectedIds);
        }
    });
    
    } catch (error) {
        console.error('initModalModule: Error during initialization:', error);
    }
}

// ==========================================
// EXPORTS
// ==========================================

window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.initModalModule = initModalModule;
window.IDCardApp.fetchCardAndOpenModal = fetchCardAndOpenModal;

})();
