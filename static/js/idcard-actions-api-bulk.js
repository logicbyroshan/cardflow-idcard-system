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
            apiCall(`/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'verified' }, { timeout: 120000 })
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
                    } else {
                        IDCardApp.refreshCardTable();
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
            apiCall(`/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'approved' }, { timeout: 120000 })
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
                    } else {
                        IDCardApp.refreshCardTable();
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
            apiCall(`/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'pending' }, { timeout: 120000 })
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
            apiCall(`/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'verified' }, { timeout: 120000 })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot disapprove cards', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast(data.message || `${data.updated_count} card(s) moved to verified`);
                    IDCardApp.refreshCardTable();
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
                apiCall(`/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'pool' }, { timeout: 120000 })
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
    const currentStatus = (typeof CURRENT_STATUS !== 'undefined' ? String(CURRENT_STATUS).toLowerCase() : 'pool');
    const isDownloadList = currentStatus === 'download';
    const sourceLabel = isDownloadList ? 'Download' : 'Pool';

    IDCardApp.showWorkflowConfirm(`Are you sure you want to move ${cardIds.length} selected record(s) from ${sourceLabel} to Pending list?`, function() {
        const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
            return;
        }
        if (typeof apiCall === 'function') {
            apiCall(`/api/table/${tableId}/cards/bulk-status/`, 'POST', { card_ids: cardIds, status: 'pending' }, { timeout: 120000 })
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

function generatePrintVerificationCode() {
    return (typeof ConfirmationCode !== 'undefined' && typeof ConfirmationCode.generate === 'function')
        ? ConfirmationCode.generate()
        : String(Math.floor(1000000000 + Math.random() * 9000000000));
}

function showPrintCodeConfirm(cardCount, onConfirm) {
    var expectedCode = generatePrintVerificationCode();

    var old = document.getElementById('printCodeConfirmOverlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'printCodeConfirmOverlay';
    overlay.className = 'wf-confirm-overlay';
    overlay.innerHTML = `
        <div class="wf-confirm-card">
            <div class="wf-confirm-header" style="background:#fff7ed">
                <div class="wf-confirm-icon-wrap" style="background:#f59e0b">
                    <i class="fa-solid fa-print"></i>
                </div>
                <div class="wf-confirm-title">Print Confirmation</div>
                <button class="wf-confirm-close" id="printCodeConfirmClose" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="wf-confirm-body">
                <p class="wf-confirm-msg">Move ${cardCount} selected card(s) from Approved List to Generate List?</p>
                <div class="wf-status-flow">
                    <span class="wf-status-badge" style="background:#3b82f615;color:#3b82f6;border:1px solid #3b82f630">Approved</span>
                    <i class="fa-solid fa-arrow-right wf-flow-arrow" style="color:#f59e0b"></i>
                    <span class="wf-status-badge" style="background:#f59e0b15;color:#f59e0b;border:1px solid #f59e0b30">Generate List</span>
                </div>
                <div class="wf-count-badge" style="background:#f59e0b10;color:#f59e0b;border:1px solid #f59e0b25">
                    <i class="fa-solid fa-layer-group"></i> ${cardCount} record(s) selected
                </div>
                <div class="wf-confirm-note" style="display:block">
                    <i class="fa-solid fa-shield-halved"></i>
                    <span>Type this 10-digit verification code to confirm:</span>
                </div>
                <div style="margin-top:8px;display:flex;justify-content:center">
                    <div style="font-weight:700;letter-spacing:0.28em;font-size:16px;padding:8px 12px;border:1px dashed #f59e0b66;border-radius:10px;background:#fff">${expectedCode}</div>
                </div>
                <div style="margin-top:10px;display:flex;justify-content:center">
                    <input type="text" id="printCodeConfirmInput" maxlength="10" inputmode="numeric" pattern="[0-9]{10}" placeholder="Enter 10-digit code"
                           style="width:100%;max-width:280px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;text-align:center;letter-spacing:0.08em;font-weight:600;"
                           autocomplete="off">
                </div>
                <div id="printCodeConfirmError" style="display:none;margin-top:8px;color:#ef4444;font-size:12px;text-align:center;">
                    <i class="fa-solid fa-circle-xmark"></i> Incorrect code. Please enter the exact 10-digit code.
                </div>
            </div>
            <div class="wf-confirm-footer">
                <button class="wf-btn wf-btn-cancel" id="printCodeConfirmCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
                <button class="wf-btn wf-btn-confirm" id="printCodeConfirmOk" style="background:#f59e0b" disabled>
                    <i class="fa-solid fa-check"></i> Send to Generate List
                </button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('wf-active'); });
    document.body.style.overflow = 'hidden';

    var inputEl = document.getElementById('printCodeConfirmInput');
    var okBtn = document.getElementById('printCodeConfirmOk');
    var errorEl = document.getElementById('printCodeConfirmError');

    function cleanup() {
        overlay.classList.remove('wf-active');
        overlay.classList.add('wf-closing');
        setTimeout(function() {
            overlay.remove();
            document.body.style.overflow = '';
        }, 200);
    }

    function updateInputState() {
        var raw = (inputEl && inputEl.value) ? inputEl.value : '';
        var sanitized = raw.replace(/[^0-9]/g, '').slice(0, 10);
        if (inputEl && raw !== sanitized) inputEl.value = sanitized;
        var matched = sanitized.length === 10 && sanitized === expectedCode;
        if (okBtn) okBtn.disabled = !matched;
        if (errorEl) {
            errorEl.style.display = (sanitized.length === 10 && !matched) ? '' : 'none';
        }
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') {
            cleanup();
            document.removeEventListener('keydown', onKeyDown);
        }
    }

    document.addEventListener('keydown', onKeyDown);

    document.getElementById('printCodeConfirmClose').onclick = function() {
        cleanup();
        document.removeEventListener('keydown', onKeyDown);
    };
    document.getElementById('printCodeConfirmCancel').onclick = function() {
        cleanup();
        document.removeEventListener('keydown', onKeyDown);
    };
    document.getElementById('printCodeConfirmOk').onclick = function() {
        if (!okBtn || okBtn.disabled) return;
        cleanup();
        document.removeEventListener('keydown', onKeyDown);
        onConfirm();
    };

    if (inputEl) {
        inputEl.addEventListener('input', updateInputState);
        inputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && okBtn && !okBtn.disabled) {
                e.preventDefault();
                okBtn.click();
            }
        });
        setTimeout(function() { inputEl.focus(); }, 40);
    }
}

function bulkPrintSend(cardIds) {
    showPrintCodeConfirm(cardIds.length, function() {
        const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
        if (!tableId) {
            if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
            return;
        }
        if (typeof apiCall === 'function') {
            apiCall(`/print/api/table/${tableId}/send/`, 'POST', { card_ids: cardIds }, { timeout: 120000 })
                .then(data => {
                    if (data.status === 'error') {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot send to generate list', false);
                        return;
                    }
                    if (typeof showToast === 'function') {
                        showToast(data.message || `${data.created} card(s) added to generate list`, true);
                    }
                    IDCardApp.refreshCardTable();
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Print send failed', false);
                });
        }
    });
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

    // Print Selected button (Approved list)
    document.getElementById('printSelectedBtn')?.addEventListener('click', function() {
        const selectedIds = _getIds();
        if (selectedIds.length > 0) {
            bulkPrintSend(selectedIds);
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
IDCardApp.bulkPrintSend = bulkPrintSend;

})();
