// ID Card Actions - API Bulk Sub-module
// Contains: Bulk status operations, row action handlers, bulk action handlers
// Split from: idcard-actions-api.js

(function() {
'use strict';

window.IDCardApp = window.IDCardApp || {};

// ==========================================
// BULK STATUS OPERATIONS
// ==========================================

function bulkVerify(cardIds) {
    IDCardApp.showWorkflowConfirm(`Are you sure you want to verify ${cardIds.length} selected record(s)?`, function() {
        const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
            return;
        }
        if (typeof apiCall === 'function') {
            apiCall(`/panel/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'verified' }, { timeout: 120000 })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot verify cards', false);
                        return;
                    }
                    if (typeof showToast === 'function') {
                        showToast(data.message || `${data.updated_count} card(s) verified`, !data.skipped_count);
                    }
                    IDCardApp.refreshCardTable();
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Bulk verify failed', false);
                });
        }
    }, { actionType: 'verify', count: cardIds.length });
}

function bulkApprove(cardIds) {
    IDCardApp.showWorkflowConfirm(`Are you sure you want to approve ${cardIds.length} selected record(s)?`, function() {
        const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
            return;
        }
        if (typeof apiCall === 'function') {
            apiCall(`/panel/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'approved' }, { timeout: 120000 })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot approve cards', false);
                        return;
                    }
                    if (typeof showToast === 'function') {
                        showToast(data.message || `${data.updated_count} card(s) approved`, !data.skipped_count);
                    }
                    IDCardApp.refreshCardTable();
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Bulk approve failed', false);
                });
        }
    }, { actionType: 'approve', count: cardIds.length });
}

function bulkUnverify(cardIds) {
    IDCardApp.showWorkflowConfirm(`Are you sure you want to move ${cardIds.length} selected record(s) back to pending?`, function() {
        const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
            return;
        }
        if (typeof apiCall === 'function') {
            apiCall(`/panel/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'pending' }, { timeout: 120000 })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot unverify cards', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast(data.message || `${data.updated_count} card(s) moved to pending`);
                    IDCardApp.refreshCardTable();
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Bulk unverify failed', false);
                });
        }
    }, { actionType: 'unverify', count: cardIds.length });
}

function bulkDisapprove(cardIds) {
    IDCardApp.showWorkflowConfirm(`Are you sure you want to disapprove ${cardIds.length} selected record(s) and move them back to pending?`, function() {
        const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
            return;
        }
        if (typeof apiCall === 'function') {
            apiCall(`/panel/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'pending' }, { timeout: 120000 })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot disapprove cards', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast(data.message || `${data.updated_count} card(s) moved to pending`);
                    IDCardApp.refreshCardTable();
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Bulk disapprove failed', false);
                });
        }
    }, { actionType: 'disapprove', count: cardIds.length });
}

function bulkDelete(cardIds) {
    // Use workflow confirmation modal (consistent with verify/approve design)
    IDCardApp.showWorkflowConfirm(
        `Are you sure you want to delete ${cardIds.length} selected record(s)?`,
        function() {
            const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
            if (!tableId) {
                if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
                return;
            }
            if (typeof apiCall === 'function') {
                apiCall(`/panel/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'pool' }, { timeout: 120000 })
                    .then(data => {
                        if (data.success === false) {
                            if (typeof showToast === 'function') showToast(data.message || 'Cannot delete cards', false);
                            return;
                        }
                        if (typeof showToast === 'function') showToast(data.message || `${data.updated_count} card(s) moved to pool`);
                        IDCardApp.refreshCardTable();
                    })
                    .catch(err => {
                        if (typeof showToast === 'function') showToast(err.message || 'Bulk delete failed', false);
                    });
            }
        },
        {
            actionType: 'delete',
            count: cardIds.length,
            note: 'Deleted cards will be moved to Pool. You can retrieve them later.',
            noteIcon: 'fa-circle-info'
        }
    );
}

function bulkRetrieve(cardIds) {
    IDCardApp.showWorkflowConfirm(`Are you sure you want to retrieve ${cardIds.length} selected record(s) back to pending?`, function() {
        const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
            return;
        }
        if (typeof apiCall === 'function') {
            apiCall(`/panel/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'pending' }, { timeout: 120000 })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot retrieve cards', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast(data.message || `${data.updated_count} card(s) retrieved to pending`);
                    IDCardApp.refreshCardTable();
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Bulk retrieve failed', false);
                });
        }
    }, { actionType: 'retrieve', count: cardIds.length });
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
        
        IDCardApp.pendingDeleteCardIds = cardIds;
        
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
                IDCardApp.verifyCard(cardId);
            } else if (btn.classList.contains('approve-row-btn')) {
                IDCardApp.approveCard(cardId);
            } else if (btn.classList.contains('unverify-row-btn')) {
                IDCardApp.unverifyCard(cardId);
            } else if (btn.classList.contains('retrieve-row-btn')) {
                IDCardApp.retrieveCard(cardId);
            }
        });
    }
}



// ==========================================
// BULK ACTION BUTTON HANDLERS
// ==========================================

function initBulkActionHandlers() {
    // Helper: get selected IDs from virtual table's _selectedIds Set
    function _getIds() {
        if (window.IDCardApp && typeof window.IDCardApp.getSelectedCardIds === 'function') {
            return window.IDCardApp.getSelectedCardIds();
        }
        return [];
    }

    // Verify Selected button
    document.getElementById('verifyBtn')?.addEventListener('click', function() {
        const selectedIds = _getIds();
        if (selectedIds.length > 0) {
            bulkVerify(selectedIds);
        }
    });
    
    // Delete button (moves to Pool)
    document.getElementById('deleteBtn')?.addEventListener('click', function() {
        const selectedIds = _getIds();
        if (selectedIds.length > 0) {
            bulkDelete(selectedIds);
        }
    });
    
    // Approve Selected button
    document.getElementById('approveBtn')?.addEventListener('click', function() {
        const selectedIds = _getIds();
        if (selectedIds.length > 0) {
            bulkApprove(selectedIds);
        }
    });
    
    // Unverify Selected button (move back to pending)
    document.getElementById('unverifyBtn')?.addEventListener('click', function() {
        const selectedIds = _getIds();
        if (selectedIds.length > 0) {
            bulkUnverify(selectedIds);
        }
    });
    
    // Disapprove Selected button (Approved list → move to pending)
    document.getElementById('disapproveBtn')?.addEventListener('click', function() {
        const selectedIds = _getIds();
        if (selectedIds.length > 0) {
            bulkDisapprove(selectedIds);
        }
    });
    
    // Retrieve button (Pool list)
    document.getElementById('retrieveBtnP')?.addEventListener('click', function() {
        const selectedIds = _getIds();
        if (selectedIds.length > 0) {
            bulkRetrieve(selectedIds);
        }
    });

    // Retrieve button (Download list)
    document.getElementById('retrieveBtnD')?.addEventListener('click', function() {
        const selectedIds = _getIds();
        if (selectedIds.length > 0) {
            bulkRetrieve(selectedIds);
        }
    });
    
    // Delete Permanent button (Pool list only)
    document.getElementById('deletePermanentBtnP')?.addEventListener('click', function() {
        const selectedIds = _getIds();
        if (selectedIds.length > 0) {
            bulkDeletePermanent(selectedIds);
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

// ==========================================
// EXPORTS
// ==========================================

IDCardApp.initApiModule = initApiModule;
IDCardApp.bulkVerify = bulkVerify;
IDCardApp.bulkApprove = bulkApprove;
IDCardApp.bulkUnverify = bulkUnverify;
IDCardApp.bulkDisapprove = bulkDisapprove;
IDCardApp.bulkDelete = bulkDelete;
IDCardApp.bulkRetrieve = bulkRetrieve;
IDCardApp.bulkDeletePermanent = bulkDeletePermanent;

})();
