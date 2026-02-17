// ID Card Actions - API Module
// Contains: Card status operations, bulk operations, row action handlers

(function() {
'use strict';

// ==========================================
// HTMX TABLE REFRESH HELPER
// ==========================================

var _refreshPending = false;
/** Refresh the card table via HTMX (no full page reload). Falls back to reload.
 *  Throttled: ignores rapid-fire calls within 300ms. */
function refreshCardTable() {
    if (_refreshPending) return;         // de-dup rapid calls
    _refreshPending = true;
    setTimeout(function() { _refreshPending = false; }, 300);

    if (typeof htmx !== 'undefined' && document.getElementById('card-table-container')) {
        htmx.trigger(document.body, 'refreshTable');
        // Clear selection after table swap
        if (typeof window.alpineClearSelection === 'function') window.alpineClearSelection();
    } else {
        location.reload();
    }
}

// ==========================================
// SINGLE CARD STATUS OPERATIONS
// ==========================================

function verifyCard(cardId) {
    if (typeof apiCall === 'function') {
        apiCall(`/panel/api/card/${cardId}/status/`, 'POST', { status: 'verified' })
            .then(data => {
                if (data.success === false) {
                    if (typeof showToast === 'function') showToast(data.message || 'Cannot verify card', false);
                    return;
                }
                if (typeof showToast === 'function') showToast('Card verified successfully');
                refreshCardTable();
            });
    }
}

function approveCard(cardId) {
    if (typeof apiCall === 'function') {
        apiCall(`/panel/api/card/${cardId}/status/`, 'POST', { status: 'approved' })
            .then(data => {
                if (data.success === false) {
                    if (typeof showToast === 'function') showToast(data.message || 'Cannot approve card', false);
                    return;
                }
                if (typeof showToast === 'function') showToast('Card approved successfully');
                refreshCardTable();
            });
    }
}

function unapproveCard(cardId) {
    if (typeof apiCall === 'function') {
        apiCall(`/panel/api/card/${cardId}/status/`, 'POST', { status: 'verified' })
            .then(data => {
                if (data.success === false) {
                    if (typeof showToast === 'function') showToast(data.message || 'Error', false);
                    return;
                }
                if (typeof showToast === 'function') showToast('Card moved back to verified');
                refreshCardTable();
            });
    }
}

function unverifyCard(cardId) {
    if (typeof apiCall === 'function') {
        apiCall(`/panel/api/card/${cardId}/status/`, 'POST', { status: 'pending' })
            .then(data => {
                if (data.success === false) {
                    if (typeof showToast === 'function') showToast(data.message || 'Error', false);
                    return;
                }
                if (typeof showToast === 'function') showToast('Card moved back to pending');
                refreshCardTable();
            });
    }
}

function downloadCard(cardId) {
    if (typeof apiCall === 'function') {
        apiCall(`/panel/api/card/${cardId}/status/`, 'POST', { status: 'download' })
            .then(data => {
                if (data.success === false) {
                    if (typeof showToast === 'function') showToast(data.message || 'Error', false);
                    return;
                }
                if (typeof showToast === 'function') showToast('Card moved to download list');
                refreshCardTable();
            });
    }
}

function retrieveCard(cardId) {
    if (typeof apiCall === 'function') {
        apiCall(`/panel/api/card/${cardId}/status/`, 'POST', { status: 'pending' })
            .then(data => {
                if (data.success === false) {
                    if (typeof showToast === 'function') showToast(data.message || 'Error', false);
                    return;
                }
                if (typeof showToast === 'function') showToast('Card retrieved to pending list');
                refreshCardTable();
            });
    }
}

// Single card download (download the actual image/card)
function downloadSingleCard(cardId) {
    // Get the row to find image data
    const row = document.querySelector(`tr[data-card-id="${cardId}"]`);
    if (!row) {
        if (typeof showToast === 'function') showToast('Card not found', false);
        return;
    }
    
    // Find the image in the row
    const img = row.querySelector('.table-image');
    if (img && img.src) {
        // Create download link
        const link = document.createElement('a');
        link.href = img.src;
        link.download = `card_${cardId}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if (typeof showToast === 'function') showToast('Card image downloaded');
    } else {
        if (typeof showToast === 'function') showToast('No image found for this card', false);
    }
}

// Move single card back to approved
function backToApprovedCard(cardId) {
    if (typeof apiCall === 'function') {
        apiCall(`/panel/api/card/${cardId}/status/`, 'POST', { status: 'approved' })
            .then(data => {
                if (data.success === false) {
                    if (typeof showToast === 'function') showToast(data.message || 'Error', false);
                    return;
                }
                if (typeof showToast === 'function') showToast('Card moved back to approved');
                refreshCardTable();
            });
    }
}

// ==========================================
// BULK STATUS OPERATIONS
// ==========================================

function bulkVerify(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    if (typeof apiCall === 'function') {
        apiCall(`/panel/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'verified' })
            .then(data => {
                if (data.success === false) {
                    if (typeof showToast === 'function') showToast(data.message || 'Cannot verify cards', false);
                    return;
                }
                if (typeof showToast === 'function') {
                    showToast(data.message || `${data.updated_count} card(s) verified`, !data.skipped_count);
                }
                refreshCardTable();
            });
    }
}

function bulkApprove(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    if (typeof apiCall === 'function') {
        apiCall(`/panel/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'approved' })
            .then(data => {
                if (data.success === false) {
                    if (typeof showToast === 'function') showToast(data.message || 'Cannot approve cards', false);
                    return;
                }
                if (typeof showToast === 'function') {
                    showToast(data.message || `${data.updated_count} card(s) approved`, !data.skipped_count);
                }
                refreshCardTable();
            });
    }
}

function bulkUnapprove(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    if (typeof apiCall === 'function') {
        apiCall(`/panel/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'verified' })
            .then(data => {
                if (data.success === false) {
                    if (typeof showToast === 'function') showToast(data.message || 'Cannot unapprove cards', false);
                    return;
                }
                if (typeof showToast === 'function') showToast(data.message || `${data.updated_count} card(s) moved to verified`);
                location.href = location.pathname + '?status=verified';
            });
    }
}

function bulkUnverify(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    if (typeof apiCall === 'function') {
        apiCall(`/panel/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'pending' })
            .then(data => {
                if (data.success === false) {
                    if (typeof showToast === 'function') showToast(data.message || 'Cannot unverify cards', false);
                    return;
                }
                if (typeof showToast === 'function') showToast(data.message || `${data.updated_count} card(s) moved to pending`);
                location.href = location.pathname + '?status=pending';
            });
    }
}

function bulkDelete(cardIds) {
    // Show confirmation modal before moving to pool
    if (typeof openSimpleDeleteModal === 'function') {
        openSimpleDeleteModal(cardIds);
    } else {
        // Fallback: direct move to pool (legacy behavior)
        const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
            return;
        }
        if (typeof apiCall === 'function') {
            apiCall(`/panel/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'pool' })
                .then(data => {
                    if (typeof showToast === 'function') showToast(`${data.updated_count} card(s) moved to pool`);
                    refreshCardTable();
                });
        }
    }
}

function bulkRetrieve(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    if (typeof apiCall === 'function') {
        apiCall(`/panel/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'pending' })
            .then(data => {
                if (data.success === false) {
                    if (typeof showToast === 'function') showToast(data.message || 'Cannot retrieve cards', false);
                    return;
                }
                if (typeof showToast === 'function') showToast(data.message || `${data.updated_count} card(s) retrieved to pending`);
                refreshCardTable();
            });
    }
}

function bulkDeletePermanent(cardIds) {
    // Use permanent delete modal with 6-digit verification code
    if (typeof openPermanentDeleteModal === 'function') {
        openPermanentDeleteModal(cardIds);
    } else {
        // Fallback: use old modal system
        const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
            return;
        }
        
        window.pendingDeleteCardIds = cardIds;
        
        const deleteCountText = document.getElementById('deleteCountText');
        if (deleteCountText) {
            deleteCountText.textContent = `${cardIds.length} card(s)`;
        }
        
        const deleteModalOverlay = document.getElementById('deleteModalOverlay');
        if (deleteModalOverlay) {
            deleteModalOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }
}

// ==========================================
// ROW ACTION BUTTON HANDLERS
// ==========================================

function initRowActionHandlers() {
    // Use event delegation on the table body for ALL row action buttons
    // This handles both initial rows AND dynamically loaded rows (lazy loading)
    const tableBody = document.getElementById('cardsTableBody');
    
    if (tableBody) {
        tableBody.addEventListener('click', function(e) {
            const btn = e.target.closest('.row-action-btn');
            if (!btn) return;
            
            e.stopPropagation();
            const cardId = btn.getAttribute('data-card-id');
            if (!cardId) return;
            
            // Determine action by button class
            if (btn.classList.contains('verify-row-btn')) {
                verifyCard(cardId);
            } else if (btn.classList.contains('approve-row-btn')) {
                approveCard(cardId);
            } else if (btn.classList.contains('unapprove-row-btn')) {
                unapproveCard(cardId);
            } else if (btn.classList.contains('unverify-row-btn')) {
                unverifyCard(cardId);
            } else if (btn.classList.contains('download-row-btn')) {
                downloadCard(cardId);
            } else if (btn.classList.contains('retrieve-row-btn')) {
                retrieveCard(cardId);
            } else if (btn.classList.contains('download-single-row-btn')) {
                downloadSingleCard(cardId);
            }
        });
    }
}

// ==========================================
// BULK DOWNLOAD (Move to download status)
// ==========================================

function bulkDownload(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    
    const csrfToken = typeof getCSRFToken === 'function' ? getCSRFToken() : '';
    
    ApiClient.post(`/panel/api/table/${tableId}/cards/bulk-status/`, {
        card_ids: cardIds,
        status: 'download'
    })
    .then(data => {
        if (data.success) {
            if (typeof showToast === 'function') showToast(`${data.updated_count} card(s) moved to download list`);
            window.location.href = `?status=download`;
        } else {
            if (typeof showToast === 'function') showToast(data.message || 'Error updating cards', false);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        if (typeof showToast === 'function') showToast('Error moving to download', false);
    });
}

// ==========================================
// BULK BACK TO APPROVED (Move from download back to approved)
// ==========================================

function bulkBackToApproved(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    
    const csrfToken = typeof getCSRFToken === 'function' ? getCSRFToken() : '';
    
    ApiClient.post(`/panel/api/table/${tableId}/cards/bulk-status/`, {
        card_ids: cardIds,
        status: 'approved'
    })
    .then(data => {
        if (data.success) {
            if (typeof showToast === 'function') showToast(`${data.updated_count} card(s) moved back to approved`);
            window.location.href = `?status=approved`;
        } else {
            if (typeof showToast === 'function') showToast(data.message || 'Error updating cards', false);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        if (typeof showToast === 'function') showToast('Error moving to approved', false);
    });
}

// ==========================================
// BULK ACTION BUTTON HANDLERS
// ==========================================

function initBulkActionHandlers() {
    // Verify Selected button
    document.getElementById('verifyBtn')?.addEventListener('click', function() {
        const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
        if (selectedIds.length > 0) {
            bulkVerify(selectedIds);
        }
    });
    
    // Delete button (moves to Pool)
    document.getElementById('deleteBtn')?.addEventListener('click', function() {
        const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
        if (selectedIds.length > 0) {
            bulkDelete(selectedIds);
        }
    });
    
    // Delete button in Verified list
    document.getElementById('deleteBtnV')?.addEventListener('click', function() {
        const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
        if (selectedIds.length > 0) {
            bulkDelete(selectedIds);
        }
    });
    
    // Approve Selected button
    document.getElementById('approveBtn')?.addEventListener('click', function() {
        const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
        if (selectedIds.length > 0) {
            bulkApprove(selectedIds);
        }
    });
    
    // Unapproved Selected button (works for verified and approved lists)
    const unapprovedBtnIds = ['unapprovedBtn', 'unapprovedBtnA'];
    unapprovedBtnIds.forEach(btnId => {
        document.getElementById(btnId)?.addEventListener('click', function() {
            const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
            if (selectedIds.length > 0) {
                bulkUnapprove(selectedIds);
            }
        });
    });
    
    // Unverified Selected button
    document.getElementById('unverifyBtn')?.addEventListener('click', function() {
        const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
        if (selectedIds.length > 0) {
            bulkUnverify(selectedIds);
        }
    });
    
    // Retrieve buttons
    const retrieveBtnIds = ['retrieveBtn', 'retrieveBtnP', 'retrieveBtnA', 'retrieveBtnD'];
    retrieveBtnIds.forEach(btnId => {
        document.getElementById(btnId)?.addEventListener('click', function() {
            const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
            if (selectedIds.length > 0) {
                bulkRetrieve(selectedIds);
            }
        });
    });
    
    // Delete Permanent button (Pool list only)
    document.getElementById('deletePermanentBtnP')?.addEventListener('click', function() {
        const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
        if (selectedIds.length > 0) {
            bulkDeletePermanent(selectedIds);
        }
    });
    
    // Download Card button (move to download status from Approved)
    document.getElementById('downloadCardBtn')?.addEventListener('click', function() {
        const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
        if (selectedIds.length > 0) {
            bulkDownload(selectedIds);
        }
    });
    
    // Back to Approved button (move from download back to approved)
    document.getElementById('unapprovedBtnD')?.addEventListener('click', function() {
        const selectedIds = typeof getSelectedCardIds === 'function' ? getSelectedCardIds() : [];
        if (selectedIds.length > 0) {
            bulkBackToApproved(selectedIds);
        }
    });
}

// ==========================================
// INITIALIZATION
// ==========================================

function initApiModule() {
    initRowActionHandlers();
    initBulkActionHandlers();
}

// Expose globally
window.verifyCard = verifyCard;
window.approveCard = approveCard;
window.unapproveCard = unapproveCard;
window.unverifyCard = unverifyCard;
window.downloadCard = downloadCard;
window.retrieveCard = retrieveCard;
window.downloadSingleCard = downloadSingleCard;
window.backToApprovedCard = backToApprovedCard;
window.bulkVerify = bulkVerify;
window.bulkApprove = bulkApprove;
window.bulkUnapprove = bulkUnapprove;
window.bulkUnverify = bulkUnverify;
window.bulkDelete = bulkDelete;
window.bulkRetrieve = bulkRetrieve;
window.bulkDeletePermanent = bulkDeletePermanent;
window.bulkDownload = bulkDownload;
window.bulkBackToApproved = bulkBackToApproved;

window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.initApiModule = initApiModule;
window.IDCardApp.verifyCard = verifyCard;
window.IDCardApp.approveCard = approveCard;
window.IDCardApp.bulkVerify = bulkVerify;
window.IDCardApp.bulkDelete = bulkDelete;

})();
