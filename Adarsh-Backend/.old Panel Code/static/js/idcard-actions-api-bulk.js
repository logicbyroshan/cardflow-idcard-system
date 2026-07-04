// ID Card Actions - API Bulk Sub-module
// Contains: Bulk status operations, row action handlers, bulk action handlers
// Split from: idcard-actions-api.js

(function() {
'use strict';

window.IDCardApp = window.IDCardApp || {};
var panelBase = window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';

function panelUrl(path) {
    if (!path) return path;
    if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) return path;
    var normalized = path.charAt(0) === '/' ? path : '/' + path;
    return panelBase + normalized;
}

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
            apiCall(panelUrl(`/api/table/${tableId}/cards/bulk-status/`), 'POST', { card_ids: cardIds, status: 'verified' }, { timeout: 120000 })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot verify cards', false);
                        return;
                    }
                    if (typeof showToast === 'function') {
                        showToast(data.message || `${data.updated_count} card(s) verified`, !data.skipped_count);
                    }
                    if (typeof IDCardApp.removeCardRows === 'function') {
                        IDCardApp.removeCardRows(cardIds, { removedCount: data.updated_count });
                    }
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
            apiCall(panelUrl(`/api/table/${tableId}/cards/bulk-status/`), 'POST', { card_ids: cardIds, status: 'approved' }, { timeout: 120000 })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot approve cards', false);
                        return;
                    }
                    if (typeof showToast === 'function') {
                        showToast(data.message || `${data.updated_count} card(s) approved`, !data.skipped_count);
                    }
                    if (typeof IDCardApp.removeCardRows === 'function') {
                        IDCardApp.removeCardRows(cardIds, { removedCount: data.updated_count });
                    }
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Bulk approve failed', false);
                });
        }
    }, { actionType: 'approve', count: cardIds.length });
}

function bulkUnverify(cardIds) {
    IDCardApp.showWorkflowConfirm(`Are you sure you want to move ${cardIds.length} selected record(s) from Verified to Pending?`, function() {
        const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
            return;
        }
        if (typeof apiCall === 'function') {
            apiCall(panelUrl(`/api/table/${tableId}/cards/bulk-status/`), 'POST', { card_ids: cardIds, status: 'pending' }, { timeout: 120000 })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot unverify cards', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast(data.message || `${data.updated_count} card(s) moved to pending`);
                    if (typeof IDCardApp.removeCardRows === 'function') {
                        IDCardApp.removeCardRows(cardIds, { removedCount: data.updated_count });
                    }
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Bulk unverify failed', false);
                });
        }
    }, {
        actionType: 'unverify',
        count: cardIds.length,
        note: 'This will move selected records from Verified to Pending list.'
    });
}

function bulkDisapprove(cardIds) {
    IDCardApp.showWorkflowConfirm(`Are you sure you want to move ${cardIds.length} selected record(s) from Approved to Verified list?`, function() {
        const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
            return;
        }
        if (typeof apiCall === 'function') {
            apiCall(panelUrl(`/api/table/${tableId}/cards/bulk-status/`), 'POST', { card_ids: cardIds, status: 'verified' }, { timeout: 120000 })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot disapprove cards', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast(data.message || `${data.updated_count} card(s) moved to verified`);
                    if (typeof IDCardApp.removeCardRows === 'function') {
                        IDCardApp.removeCardRows(cardIds, { removedCount: data.updated_count });
                    }
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Bulk disapprove failed', false);
                });
        }
    }, {
        actionType: 'disapprove',
        count: cardIds.length,
        note: 'This will move selected records from Approved to Verified list.'
    });
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
                apiCall(panelUrl(`/api/table/${tableId}/cards/bulk-status/`), 'POST', { card_ids: cardIds, status: 'pool' }, { timeout: 120000 })
                    .then(data => {
                        if (data.success === false) {
                            if (typeof showToast === 'function') showToast(data.message || 'Cannot delete cards', false);
                            return;
                        }
                        if (typeof showToast === 'function') showToast(data.message || `${data.updated_count} card(s) moved to pool`);
                        if (typeof IDCardApp.removeCardRows === 'function') {
                            IDCardApp.removeCardRows(cardIds, { removedCount: data.updated_count });
                        }
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
    const currentStatus = (typeof CURRENT_STATUS !== 'undefined' ? String(CURRENT_STATUS).toLowerCase() : 'pool');
    const isDownloadList = currentStatus === 'download';
    const sourceLabel = isDownloadList ? 'Download' : 'Pool';
    var tableId = null;

    function performBulkRetrieve(payload) {
        apiCall(panelUrl(`/api/table/${tableId}/cards/bulk-status/`), 'POST', payload, { timeout: 120000 })
            .then(function(data) {
                if (data.success === false) {
                    var extractFn = window.IDCardApp && window.IDCardApp.extractRetrieveClassChangeDetails;
                    var promptFn = window.IDCardApp && window.IDCardApp.promptRetrieveClassAndConfirm;
                    var details = (typeof extractFn === 'function') ? extractFn(data) : null;
                    if (
                        details
                        && cardIds.length === 1
                        && typeof promptFn === 'function'
                    ) {
                        promptFn(details, sourceLabel, function(selectedClass) {
                            var updatePayload = {
                                card_ids: cardIds,
                                status: 'pending',
                                apply_class_change: true,
                                pool_retrieve_class_updates: {},
                            };
                            updatePayload.pool_retrieve_class_updates[String(cardIds[0])] = selectedClass;
                            performBulkRetrieve(updatePayload);
                        });
                        return;
                    }
                    if (
                        data.requires_class_change
                        && cardIds.length > 1
                        && typeof showToast === 'function'
                    ) {
                        showToast('Select one record at a time to change class and retrieve.', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast(data.message || 'Cannot retrieve cards', false);
                    return;
                }
                if (typeof showToast === 'function') showToast(data.message || `${data.updated_count} card(s) retrieved to pending`);
                if (typeof IDCardApp.removeCardRows === 'function') {
                    IDCardApp.removeCardRows(cardIds, { removedCount: data.updated_count });
                }
            })
            .catch(function(err) {
                var extractFn = window.IDCardApp && window.IDCardApp.extractRetrieveClassChangeDetails;
                var promptFn = window.IDCardApp && window.IDCardApp.promptRetrieveClassAndConfirm;
                var details = (typeof extractFn === 'function') ? extractFn(err && err.data) : null;
                if (
                    details
                    && cardIds.length === 1
                    && typeof promptFn === 'function'
                ) {
                    promptFn(details, sourceLabel, function(selectedClass) {
                        var updatePayload = {
                            card_ids: cardIds,
                            status: 'pending',
                            apply_class_change: true,
                            pool_retrieve_class_updates: {},
                        };
                        updatePayload.pool_retrieve_class_updates[String(cardIds[0])] = selectedClass;
                        performBulkRetrieve(updatePayload);
                    });
                    return;
                }
                if (typeof showToast === 'function') showToast((err && err.message) || 'Bulk retrieve failed', false);
            });
    }

    IDCardApp.showWorkflowConfirm(`Are you sure you want to move ${cardIds.length} selected record(s) from ${sourceLabel} to Pending list?`, function() {
        tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
            return;
        }
        if (typeof apiCall === 'function') {
            performBulkRetrieve({ card_ids: cardIds, status: 'pending' });
        }
    }, {
        actionType: isDownloadList ? 'retrieveDownload' : 'retrievePool',
        count: cardIds.length,
        note: `This will move selected records from ${sourceLabel} to Pending list.`
    });
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

    // Delete button  Verified list
    document.getElementById('deleteBtnV')?.addEventListener('click', function() {
        const selectedIds = _getIds();
        if (selectedIds.length > 0) {
            bulkDelete(selectedIds);
        }
    });

    // Delete button  Approved list
    document.getElementById('deleteBtnA')?.addEventListener('click', function() {
        const selectedIds = _getIds();
        if (selectedIds.length > 0) {
            bulkDelete(selectedIds);
        }
    });

    // Delete button  Download list
    document.getElementById('deleteBtnD')?.addEventListener('click', function() {
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
    
    // Disapprove Selected button (Approved list  move to verified)
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
