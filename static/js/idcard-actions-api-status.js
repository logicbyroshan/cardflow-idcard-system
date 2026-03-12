// ID Card Actions - API Status Sub-module
// Contains: Table refresh, workflow confirmation modal, single card status operations
// Split from: idcard-actions-api.js

(function() {
'use strict';

window.IDCardApp = window.IDCardApp || {};

// ==========================================
// HTMX TABLE REFRESH HELPER
// ==========================================

var _refreshPending = false;
/** Refresh the card table via HTMX (no full page reload). Falls back to reload.
 *  Throttled: ignores rapid-fire calls within 300ms.
 *  Preserves scroll position so the page doesn't jump to top. */
function refreshCardTable() {
    if (_refreshPending) return;         // de-dup rapid calls
    _refreshPending = true;
    setTimeout(function() { _refreshPending = false; }, 300);

    if (typeof htmx !== 'undefined' && document.getElementById('card-table-container')) {
        // Save scroll position before HTMX swap
        window._savedScrollTop = window.scrollY || document.documentElement.scrollTop;
        var tableContainer = document.getElementById('card-table-container');
        var scrollParent = tableContainer ? tableContainer.closest('.main-content') || tableContainer.parentElement : null;
        if (scrollParent) window._savedScrollParentTop = scrollParent.scrollTop;

        htmx.trigger(document.body, 'refreshTable');
        // Clear selection after table swap
        if (typeof window.alpineClearSelection === 'function') window.alpineClearSelection();
    } else {
        location.reload();
    }

    // Update navbar status counts in real-time
    refreshStatusCounts();
}

/**
 * Remove a single card row from the table with a smooth slide-out animation.
 * Updates internal state arrays so the row is gone without a full table reload.
 * @param {string|number} cardId - The card ID to remove
 */
function removeCardRow(cardId) {
    var _ts = IDCardApp._ts;
    var row = document.querySelector('tr[data-card-id="' + cardId + '"]');

    function _purgeFromState() {
        if (!_ts) return;
        // Remove from allRows and filteredRows
        _ts.allRows = _ts.allRows.filter(function(r) { return r.getAttribute('data-card-id') !== String(cardId); });
        _ts.filteredRows = _ts.filteredRows.filter(function(r) { return r.getAttribute('data-card-id') !== String(cardId); });
        // Update lazy-load bookkeeping
        if (_ts._loadedCardIds) _ts._loadedCardIds.delete(Number(cardId));
        if (_ts.lazyLoadState) {
            if (_ts.lazyLoadState.loadedCount > 0) _ts.lazyLoadState.loadedCount--;
            if (_ts.lazyLoadState.totalCount > 0) _ts.lazyLoadState.totalCount--;
        }
        // Re-render (show/hide existing rows, update pagination) — no server call
        if (typeof IDCardApp.renderTable === 'function') IDCardApp.renderTable();
    }

    if (row) {
        // Animate the row out
        row.style.transition = 'opacity 0.25s ease, transform 0.25s ease, max-height 0.3s ease';
        row.style.opacity = '0';
        row.style.transform = 'translateX(40px)';
        row.style.maxHeight = row.offsetHeight + 'px';
        row.style.overflow = 'hidden';
        // After opacity transition, collapse height
        setTimeout(function() {
            row.style.maxHeight = '0';
            row.style.padding = '0';
            row.style.borderColor = 'transparent';
        }, 200);
        // After full animation, remove from DOM and state
        setTimeout(function() {
            if (row.parentNode) row.parentNode.removeChild(row);
            _purgeFromState();
        }, 450);
    } else {
        // Row not in viewport / virtual table — just purge state
        _purgeFromState();
    }

    // Update tab badge counts live
    refreshStatusCounts();
    // Clear selection
    if (typeof window.alpineClearSelection === 'function') window.alpineClearSelection();
}

/** Fetch latest status counts from API and update the topbar tab badges */
function refreshStatusCounts() {
    if (typeof TABLE_ID === 'undefined') return;
    if (typeof apiCall !== 'function') return;
    apiCall('/api/table/' + TABLE_ID + '/status-counts/', 'GET')
        .then(function(data) {
            if (!data.success || !data.status_counts) return;
            var counts = data.status_counts;
            var tabs = document.querySelectorAll('.action-tabs .action-tab');
            tabs.forEach(function(tab) {
                var countEl = tab.querySelector('.tab-count');
                if (!countEl) return;
                // Determine which status this tab represents from its class
                var status = '';
                if (tab.classList.contains('pending-tab')) status = 'pending';
                else if (tab.classList.contains('verified-tab')) status = 'verified';
                else if (tab.classList.contains('approved-tab')) status = 'approved';
                else if (tab.classList.contains('download-tab')) status = 'download';
                else if (tab.classList.contains('pool-tab')) status = 'pool';
                else if (tab.classList.contains('reprint-tab')) status = 'reprint';
                if (status && counts[status] !== undefined) {
                    countEl.textContent = counts[status];
                }
            });
        })
        .catch(function() { /* silent fail */ });
}

// ==========================================
// CONFIRMATION MODAL UTILITY
// ==========================================

/* Action theme config — icon, colors, labels, status flow */
var _actionThemes = {
    verify:      { icon: 'fa-shield-check',     color: '#10b981', bg: '#ecfdf5', label: 'Verify',      confirmLabel: 'Verify',      from: 'Pending',   to: 'Verified',  fromColor: '#f59e0b', toColor: '#10b981' },
    approve:     { icon: 'fa-circle-check',      color: '#3b82f6', bg: '#eff6ff', label: 'Approve',     confirmLabel: 'Approve',     from: 'Verified',  to: 'Approved',  fromColor: '#10b981', toColor: '#3b82f6' },
    unverify:    { icon: 'fa-rotate-left',       color: '#f59e0b', bg: '#fffbeb', label: 'Unverify',    confirmLabel: 'Move Back',   from: 'Verified',  to: 'Pending',   fromColor: '#10b981', toColor: '#f59e0b' },
    disapprove:  { icon: 'fa-rotate-left',       color: '#f59e0b', bg: '#fffbeb', label: 'Disapprove',  confirmLabel: 'Move Back',   from: 'Approved',  to: 'Pending',   fromColor: '#3b82f6', toColor: '#f59e0b' },
    retrieve:    { icon: 'fa-arrow-rotate-left', color: '#6366f1', bg: '#eef2ff', label: 'Retrieve',    confirmLabel: 'Retrieve',    from: 'Pool',      to: 'Pending',   fromColor: '#ef4444', toColor: '#f59e0b' },
    'delete':    { icon: 'fa-trash-can',         color: '#f59e0b', bg: '#fffbeb', label: 'Delete',      confirmLabel: 'Delete',      from: '',          to: 'Pool',      fromColor: '#6b7280', toColor: '#ef4444' },
    'delete-permanent': { icon: 'fa-skull-crossbones', color: '#ef4444', bg: '#fef2f2', label: 'Permanent Delete', confirmLabel: 'Delete Forever', from: '', to: '', fromColor: '#ef4444', toColor: '#ef4444' },
    'default':   { icon: 'fa-circle-question',   color: '#6366f1', bg: '#eef2ff', label: 'Confirm',     confirmLabel: 'Confirm',     from: '',          to: '',          fromColor: '#6b7280', toColor: '#6b7280' }
};

/**
 * Show a beautifully designed workflow confirmation modal.
 * @param {string} message  - The confirmation question
 * @param {Function} onConfirm - Callback on confirm
 * @param {Object} [options]   - { actionType: 'verify'|'approve'|etc., count: N }
 */
function showWorkflowConfirm(message, onConfirm, options) {
    options = options || {};
    var actionType = options.actionType || 'default';
    var count = options.count || 1;
    var theme = _actionThemes[actionType] || _actionThemes['default'];

    // Remove old overlay if exists
    var old = document.getElementById('workflowConfirmOverlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'workflowConfirmOverlay';
    overlay.className = 'wf-confirm-overlay';

    // Build status flow HTML (skip for permanent delete which has no from/to)
    var flowHTML = '';
    if (theme.from && theme.to) {
        flowHTML = `
            <div class="wf-status-flow">
                <span class="wf-status-badge" style="background:${theme.fromColor}15;color:${theme.fromColor};border:1px solid ${theme.fromColor}30">${theme.from}</span>
                <i class="fa-solid fa-arrow-right wf-flow-arrow" style="color:${theme.color}"></i>
                <span class="wf-status-badge" style="background:${theme.toColor}15;color:${theme.toColor};border:1px solid ${theme.toColor}30">${theme.to}</span>
            </div>`;
    } else if (theme.to) {
        // One-sided flow (e.g. delete → Pool)
        flowHTML = `
            <div class="wf-status-flow">
                <i class="fa-solid fa-arrow-right wf-flow-arrow" style="color:${theme.color}"></i>
                <span class="wf-status-badge" style="background:${theme.toColor}15;color:${theme.toColor};border:1px solid ${theme.toColor}30">Moved to ${theme.to}</span>
            </div>`;
    }

    // Build count info for bulk
    var countHTML = '';
    if (count > 1) {
        countHTML = `<div class="wf-count-badge" style="background:${theme.color}10;color:${theme.color};border:1px solid ${theme.color}25"><i class="fa-solid fa-layer-group"></i> ${count} record(s) selected</div>`;
    }

    // Build note (custom override or default)
    var noteText = options.note || (count > 1 ? 'This will update all selected records.' : 'This will update the record status.');
    var noteIcon = options.noteIcon || 'fa-circle-info';
    var noteStyle = options.noteDanger ? 'color:#ef4444;' : '';

    overlay.innerHTML = `
        <div class="wf-confirm-card">
            <div class="wf-confirm-header" style="background:${theme.bg}">
                <div class="wf-confirm-icon-wrap" style="background:${theme.color}">
                    <i class="fa-solid ${theme.icon}"></i>
                </div>
                <div class="wf-confirm-title">${theme.label} Confirmation</div>
                <button class="wf-confirm-close" id="workflowConfirmClose" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="wf-confirm-body">
                <p class="wf-confirm-msg">${message}</p>
                ${flowHTML}
                ${countHTML}
                <div class="wf-confirm-note" style="${noteStyle}">
                    <i class="fa-solid ${noteIcon}"></i>
                    <span>${noteText}</span>
                </div>
            </div>
            <div class="wf-confirm-footer">
                <button class="wf-btn wf-btn-cancel" id="workflowConfirmCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
                <button class="wf-btn wf-btn-confirm" id="workflowConfirmOk" style="background:${theme.color}"><i class="fa-solid fa-check"></i> ${theme.confirmLabel}</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    // Trigger entrance animation
    requestAnimationFrame(function() {
        overlay.classList.add('wf-active');
    });

    document.body.style.overflow = 'hidden';

    function cleanup() {
        overlay.classList.remove('wf-active');
        overlay.classList.add('wf-closing');
        setTimeout(function() {
            overlay.remove();
            document.body.style.overflow = '';
        }, 200);
    }

    // Escape key
    function onKeyDown(e) {
        if (e.key === 'Escape') { cleanup(); document.removeEventListener('keydown', onKeyDown); }
    }
    document.addEventListener('keydown', onKeyDown);

    // Click handlers
    document.getElementById('workflowConfirmClose').onclick = function() { cleanup(); document.removeEventListener('keydown', onKeyDown); };
    document.getElementById('workflowConfirmCancel').onclick = function() { cleanup(); document.removeEventListener('keydown', onKeyDown); };
    overlay.addEventListener('click', function(e) { /* disabled — prevent accidental closure */ });
    document.getElementById('workflowConfirmOk').onclick = function() {
        cleanup();
        document.removeEventListener('keydown', onKeyDown);
        onConfirm();
    };
}

// ==========================================
// SINGLE CARD STATUS OPERATIONS
// ==========================================

function verifyCard(cardId) {
    showWorkflowConfirm('Are you sure you want to verify this record?', function() {
        if (typeof apiCall === 'function') {
            apiCall(`/api/card/${cardId}/status/`, 'POST', { status: 'verified' })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot verify card', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast('Card verified successfully');
                    removeCardRow(cardId);
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Failed to verify card', false);
                });
        }
    }, { actionType: 'verify' });
}

function approveCard(cardId) {
    showWorkflowConfirm('Are you sure you want to approve this record?', function() {
        if (typeof apiCall === 'function') {
            apiCall(`/api/card/${cardId}/status/`, 'POST', { status: 'approved' })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot approve card', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast('Card approved successfully');
                    removeCardRow(cardId);
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Failed to approve card', false);
                });
        }
    }, { actionType: 'approve' });
}

function unverifyCard(cardId) {
    showWorkflowConfirm('Are you sure you want to move this record back to pending?', function() {
        if (typeof apiCall === 'function') {
            apiCall(`/api/card/${cardId}/status/`, 'POST', { status: 'pending' })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Error', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast('Card moved back to pending');
                    removeCardRow(cardId);
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Failed to unverify card', false);
                });
        }
    }, { actionType: 'unverify' });
}

function retrieveCard(cardId) {
    showWorkflowConfirm('Are you sure you want to retrieve this record to pending?', function() {
        if (typeof apiCall === 'function') {
            apiCall(`/api/card/${cardId}/status/`, 'POST', { status: 'pending' })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Error', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast('Card retrieved to pending list');
                    removeCardRow(cardId);
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Failed to retrieve card', false);
                });
        }
    }, { actionType: 'retrieve' });
}

function disapproveCard(cardId) {
    showWorkflowConfirm('Are you sure you want to disapprove this record and move it back to pending?', function() {
        if (typeof apiCall === 'function') {
            apiCall(`/api/card/${cardId}/status/`, 'POST', { status: 'pending' })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot disapprove card', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast('Card moved back to pending');
                    removeCardRow(cardId);
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Failed to disapprove card', false);
                });
        }
    }, { actionType: 'disapprove' });
}

function moveToDownload(cardId) {
    showWorkflowConfirm('Are you sure you want to move this record to the download list?', function() {
        if (typeof apiCall === 'function') {
            apiCall(`/api/card/${cardId}/status/`, 'POST', { status: 'download' })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot move card', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast('Card moved to download list');
                    removeCardRow(cardId);
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Failed to move card', false);
                });
        }
    }, { actionType: 'approve' });
}

// ==========================================
// EXPORTS
// ==========================================

IDCardApp.refreshCardTable = refreshCardTable;
IDCardApp.removeCardRow = removeCardRow;
IDCardApp.refreshStatusCounts = refreshStatusCounts;
IDCardApp.showWorkflowConfirm = showWorkflowConfirm;
IDCardApp.verifyCard = verifyCard;
IDCardApp.approveCard = approveCard;
IDCardApp.unverifyCard = unverifyCard;
IDCardApp.retrieveCard = retrieveCard;
IDCardApp.disapproveCard = disapproveCard;
IDCardApp.moveToDownload = moveToDownload;

})();
