// ID Card Actions - Modal Delete Module
// Contains: Permanent delete modal (pool list), simple delete modal (pending/verified)
// Split from idcard-actions-modal.js

(function() {
'use strict';

// ==========================================
// DELETE MODAL (Permanent Delete - Pool List)
// ==========================================

// Generate random 10-digit numeric code
function generateVerificationCode() {
    return (typeof ConfirmationCode !== 'undefined') ? ConfirmationCode.generate() : String(Math.floor(1000000000 + Math.random() * 9000000000));
}

// Current verification code for permanent delete
let currentVerificationCode = null;

function sanitizeCodeInputValue(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 10);
}

function renderVerificationBoxes(value) {
    const clean = sanitizeCodeInputValue(value);
    const boxes = document.querySelectorAll('#deleteVerificationBoxes .confirm-code-box');
    boxes.forEach(function(box, idx) {
        const ch = clean[idx] || '';
        box.textContent = ch;
        box.classList.toggle('is-filled', !!ch);
        box.classList.toggle('is-active', clean.length < 10 && clean.length === idx);
    });
    return clean;
}

function setVerificationWrapState(state) {
    const wrap = document.getElementById('deleteVerificationWrap');
    if (!wrap) return;
    wrap.classList.remove('is-valid', 'is-invalid');
    if (state) wrap.classList.add(state);
}

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
        renderVerificationBoxes('');
    }
    setVerificationWrapState('');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete Permanently';
    }
    const verificationStatus = document.getElementById('verificationStatus');
    if (verificationStatus) {
        verificationStatus.textContent = '';
        verificationStatus.classList.remove('match', 'no-match');
    }
    IDCardApp.pendingDeleteCardIds = null;
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
    IDCardApp.pendingDeleteCardIds = cardIds;
    
    // Reset and show modal
    const verificationInput = document.getElementById('deleteVerificationInput');
    if (verificationInput) {
        verificationInput.value = '';
        renderVerificationBoxes('');
    }
    setVerificationWrapState('');
    
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
        // Disabled  prevent accidental closure on outside click
    }
    
    // Verification code input handler
    if (verificationInput) {
        verificationInput.addEventListener('input', function() {
            const entered = renderVerificationBoxes(this.value);
            this.value = entered;
            const confirmBtn = document.getElementById('confirmDeleteModal');
            const verificationStatus = document.getElementById('verificationStatus');
            
            if (entered.length === 10) {
                if (entered === currentVerificationCode) {
                    setVerificationWrapState('is-valid');
                    if (confirmBtn) confirmBtn.disabled = false;
                    if (verificationStatus) {
                        verificationStatus.textContent = ' Code matched';
                        verificationStatus.classList.remove('no-match');
                        verificationStatus.classList.add('match');
                    }
                } else {
                    setVerificationWrapState('is-invalid');
                    if (confirmBtn) confirmBtn.disabled = true;
                    if (verificationStatus) {
                        verificationStatus.textContent = ' Code does not match';
                        verificationStatus.classList.remove('match');
                        verificationStatus.classList.add('no-match');
                    }
                }
            } else {
                setVerificationWrapState('');
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
            
            const cardIds = IDCardApp.pendingDeleteCardIds;
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
            
            ApiClient.post(`/api/table/${tableId}/cards/bulk-delete/`, { card_ids: cardIds })
            .then(data => {
                closeDeleteModalFn();
                if (data.success) {
                    if (typeof showToast === 'function') showToast(`${data.deleted_count} card(s) permanently deleted`);
                    if (window.IDCardApp && typeof window.IDCardApp.removeCardRows === 'function') {
                        window.IDCardApp.removeCardRows(cardIds, { removedCount: data.deleted_count });
                    } else {
                        console.warn('permanent delete local update skipped: removeCardRows unavailable');
                    }
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
    IDCardApp.pendingSimpleDeleteCardIds = null;
}

function openSimpleDeleteModal(cardIds) {
    IDCardApp.pendingSimpleDeleteCardIds = cardIds;
    
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
        // Disabled  prevent accidental closure on outside click
    }
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && modal?.classList.contains('active')) {
            closeSimpleDeleteModalFn();
        }
    });
    
    if (confirmBtn) {
        confirmBtn.addEventListener('click', function() {
            const cardIds = IDCardApp.pendingSimpleDeleteCardIds;
            const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
            
            if (!cardIds || cardIds.length === 0 || !tableId) {
                if (typeof showToast === 'function') showToast('Error: No cards selected', false);
                closeSimpleDeleteModalFn();
                return;
            }
            
            this.disabled = true;
            this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
            
            // Delete cards (moves to pool status)
            ApiClient.post(`/api/table/${tableId}/cards/bulk-status/`, { card_ids: cardIds, status: 'pool' }, { timeout: 120000 })
            .then(data => {
                closeSimpleDeleteModalFn();
                if (data.success) {
                    if (typeof showToast === 'function') showToast(`${data.updated_count} card(s) deleted`);
                    if (window.IDCardApp && typeof window.IDCardApp.removeCardRows === 'function') {
                        window.IDCardApp.removeCardRows(cardIds, { removedCount: data.updated_count });
                    } else {
                        console.warn('simple delete local update skipped: removeCardRows unavailable');
                    }
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
// EXPORTS
// ==========================================

window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.initDeleteModal = initDeleteModal;
window.IDCardApp.initSimpleDeleteModal = initSimpleDeleteModal;
window.IDCardApp.openSimpleDeleteModal = openSimpleDeleteModal;
window.IDCardApp.openPermanentDeleteModal = openPermanentDeleteModal;
window.IDCardApp.closeDeleteModalFn = closeDeleteModalFn;
window.IDCardApp.closeSimpleDeleteModalFn = closeSimpleDeleteModalFn;
window.openSimpleDeleteModal = openSimpleDeleteModal;
window.openPermanentDeleteModal = openPermanentDeleteModal;

})();
