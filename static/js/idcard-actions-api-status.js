// ID Card Actions - API Status Sub-module
// Contains: Table refresh, workflow confirmation modal, single card status operations
// Split from: idcard-actions-api.js

(function() {
'use strict';

window.IDCardApp = window.IDCardApp || {};

function reindexVisibleSrNumbers() {
    var rows = document.querySelectorAll('#cardsTableBody tr[data-card-id]');
    var sr = 1;
    rows.forEach(function(row) {
        if (row.style.display === 'none') return;
        var srCell = row.querySelector('td:nth-child(2)');
        if (!srCell) return;
        srCell.textContent = String(sr);
        sr += 1;
    });
}

function _getCardSortName(cardData) {
    if (!cardData || !Array.isArray(cardData.ordered_fields)) return '';

    for (var i = 0; i < cardData.ordered_fields.length; i++) {
        var field = cardData.ordered_fields[i];
        if (field && field.type === 'name') {
            return String(field.value || '').toLowerCase().trim();
        }
    }

    var blocked = ['father', 'mother', 'guardian', 'parent', 'relation', 'spouse', 'husband', 'wife'];
    for (var j = 0; j < cardData.ordered_fields.length; j++) {
        var nameField = cardData.ordered_fields[j];
        if (!nameField || nameField.type === 'image') continue;
        var fieldName = String(nameField.name || '').toLowerCase().replace(/[_\-.]/g, ' ');
        if (fieldName.indexOf('name') === -1) continue;
        var blockedMatch = false;
        for (var b = 0; b < blocked.length; b++) {
            if (fieldName.indexOf(blocked[b]) !== -1) {
                blockedMatch = true;
                break;
            }
        }
        if (!blockedMatch) {
            return String(nameField.value || '').toLowerCase().trim();
        }
    }

    for (var k = 0; k < cardData.ordered_fields.length; k++) {
        var fallbackField = cardData.ordered_fields[k];
        if (fallbackField && fallbackField.type !== 'image') {
            return String(fallbackField.value || '').toLowerCase().trim();
        }
    }

    return '';
}

function _getCardSortDate(cardData) {
    if (!cardData) return '';
    return String(cardData.updated_at_iso || cardData.updated_at || '').trim();
}

function _getRowSortName(row) {
    if (!row) return '';
    var cells = row.querySelectorAll('td[data-field-name]');
    for (var i = 0; i < cells.length; i++) {
        var cell = cells[i];
        var fieldType = String(cell.getAttribute('data-field-type') || '').toLowerCase();
        var fieldName = String(cell.getAttribute('data-field-name') || '').toLowerCase();
        if (fieldType === 'image') continue;
        if (fieldName.indexOf('name') !== -1 && fieldName.indexOf('father') === -1 && fieldName.indexOf('mother') === -1 && fieldName.indexOf('guardian') === -1 && fieldName.indexOf('relation') === -1) {
            return String(cell.getAttribute('data-original-value') || cell.textContent || '').toLowerCase().trim();
        }
    }
    for (var j = 0; j < cells.length; j++) {
        var fallbackCell = cells[j];
        if (String(fallbackCell.getAttribute('data-field-type') || '').toLowerCase() !== 'image') {
            return String(fallbackCell.getAttribute('data-original-value') || fallbackCell.textContent || '').toLowerCase().trim();
        }
    }
    return '';
}

function _getRowSortDate(row) {
    if (!row) return '';
    var cells = row.querySelectorAll('td');
    if (cells.length >= 2) {
        var updatedCell = cells[cells.length - 2];
        return String(updatedCell.textContent || '').trim();
    }
    return '';
}

function _compareCardsForSort(a, b, sortMode) {
    var left = a || {};
    var right = b || {};
    var mode = String(sortMode || 'sr-asc').toLowerCase();

    switch (mode) {
        case 'sr-desc':
            return (Number(right.sr_no) || 0) - (Number(left.sr_no) || 0);
        case 'name-asc':
            return _getCardSortName(left).localeCompare(_getCardSortName(right));
        case 'name-desc':
            return _getCardSortName(right).localeCompare(_getCardSortName(left));
        case 'date-new':
            return String(_getCardSortDate(right)).localeCompare(_getCardSortDate(left));
        case 'date-old':
            return String(_getCardSortDate(left)).localeCompare(_getCardSortDate(right));
        case 'sr-asc':
        default:
            return (Number(left.sr_no) || 0) - (Number(right.sr_no) || 0);
    }
}

function _findInsertBeforeRow(cardData) {
    var tableBody = document.getElementById('cardsTableBody');
    if (!tableBody) return null;

    var sortMode = (IDCardApp._ts && IDCardApp._ts.currentSort) ? String(IDCardApp._ts.currentSort) : 'sr-asc';
    var rows = Array.prototype.slice.call(tableBody.querySelectorAll('tr[data-card-id]'));
    if (!rows.length) return null;

    var cardsState = null;
    if (IDCardApp._ts && Array.isArray(IDCardApp._ts.allRows)) {
        cardsState = IDCardApp._ts.allRows.map(function(row) {
            var rowId = row.getAttribute('data-card-id');
            if (rowId && String(rowId) === String(cardData.id)) return null;
            return row;
        }).filter(Boolean);
    }

    if (sortMode === 'sr-asc') {
        return rows[0];
    }

    if (sortMode === 'sr-desc') {
        return null;
    }

    for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        if (sortMode === 'name-asc' || sortMode === 'name-desc') {
            var compareName = _getRowSortName(row);
            var newName = _getCardSortName(cardData);
            if (sortMode === 'name-asc') {
                if (newName.localeCompare(compareName) < 0) return row;
            } else if (compareName.localeCompare(newName) < 0) {
                return row;
            }
        } else if (sortMode === 'date-new' || sortMode === 'date-old') {
            var compareDate = _getRowSortDate(row);
            var newDate = _getCardSortDate(cardData);
            if (sortMode === 'date-new') {
                if (newDate.localeCompare(compareDate) > 0) return row;
            } else if (newDate.localeCompare(compareDate) < 0) {
                return row;
            }
        }
    }

    return null;
}

/**
 * Prepend a newly created card row to the table without full refresh.
 * Updates SR numbers and internal state to match verify/delete/pool behavior.
 * @param {Object} cardData - Card data from API (with id, field_data, ordered_fields, sr_no, etc.)
 */
function prependCardRowToTable(cardData) {
    if (!cardData || !cardData.id) {
        console.error('prependCardRowToTable: invalid card data', cardData);
        return;
    }

    try {
        var tableBody = document.getElementById('cardsTableBody');
        if (!tableBody) {
            console.error('prependCardRowToTable: cardsTableBody not found');
            return;
        }

        // Create the row DOM element using the same function as table rendering
        var newRow = null;
        if (typeof IDCardApp._createRowFromCard === 'function') {
            newRow = IDCardApp._createRowFromCard(cardData);
        } else {
            console.error('prependCardRowToTable: _createRowFromCard not available on IDCardApp');
            console.error('Available on IDCardApp:', Object.keys(IDCardApp).filter(k => k.includes('create') || k.includes('row') || k.includes('render')));
            return;
        }

        if (!newRow) {
            console.error('prependCardRowToTable: failed to create row');
            return;
        }

        // Set initial state for animation
        newRow.style.opacity = '0';
        newRow.style.transform = 'translateY(-10px)';

        // Keep the row order aligned with the active sort mode.
        newRow._cardData = cardData;
        var insertBeforeRow = _findInsertBeforeRow(cardData);
        if (insertBeforeRow) {
            tableBody.insertBefore(newRow, insertBeforeRow);
        } else {
            tableBody.appendChild(newRow);
        }

        // Animate in
        requestAnimationFrame(function() {
            newRow.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            newRow.style.opacity = '1';
            newRow.style.transform = 'translateY(0)';
        });

        // Update internal state arrays if using table state module
        var _ts = IDCardApp._ts;
        if (_ts) {
            // Add to allRows and filteredRows (new rows should always be visible)
            if (Array.isArray(_ts.allRows)) {
                var allInsertIndex = _ts.allRows.length;
                var allRows = _ts.allRows;
                for (var a = 0; a < allRows.length; a++) {
                    if (allRows[a] === insertBeforeRow || allRows[a].getAttribute('data-card-id') === String(cardData.id)) {
                        allInsertIndex = a;
                        break;
                    }
                }
                _ts.allRows.splice(allInsertIndex, 0, newRow);
            }
            if (Array.isArray(_ts.filteredRows)) {
                var filteredInsertIndex = _ts.filteredRows.length;
                var filteredRows = _ts.filteredRows;
                for (var f = 0; f < filteredRows.length; f++) {
                    if (filteredRows[f] === insertBeforeRow || filteredRows[f].getAttribute('data-card-id') === String(cardData.id)) {
                        filteredInsertIndex = f;
                        break;
                    }
                }
                _ts.filteredRows.splice(filteredInsertIndex, 0, newRow);
            }

            // Track in loaded IDs
            if (_ts._loadedCardIds && typeof _ts._loadedCardIds.add === 'function') {
                _ts._loadedCardIds.add(Number(cardData.id));
            }

            // Update lazy load counters
            if (_ts.lazyLoadState) {
                if (typeof _ts.lazyLoadState.loadedCount === 'number') {
                    _ts.lazyLoadState.loadedCount++;
                }
                if (typeof _ts.lazyLoadState.totalCount === 'number') {
                    _ts.lazyLoadState.totalCount++;
                }
            }
        }

        // Re-index SR numbers for all visible rows
        reindexVisibleSrNumbers();

        // Update button states and counts
        if (typeof IDCardApp.updateButtonStates === 'function') {
            IDCardApp.updateButtonStates();
        }
        refreshStatusCounts();

        // Dispatch custom event for listeners
        document.dispatchEvent(new CustomEvent('idcard:card-added', {
            detail: { cardId: cardData.id, card: cardData }
        }));

        console.log('prependCardRowToTable: successfully added card', cardData.id);

    } catch (err) {
        console.error('prependCardRowToTable error:', err);
    }
}

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
        var status = (typeof CURRENT_STATUS !== 'undefined' && CURRENT_STATUS) ? CURRENT_STATUS : 'pending';
        if (window.IDCardPage && typeof window.IDCardPage.navigateStatusNoReload === 'function') {
            window.IDCardPage.navigateStatusNoReload(status);
        } else {
            console.warn('refreshCardTable fallback skipped: no refresh bridge available');
        }
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
        // Re-render (show/hide existing rows, update pagination)  no server call
        if (typeof IDCardApp.renderTable === 'function') IDCardApp.renderTable();
        reindexVisibleSrNumbers();
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
        // Row not in viewport / virtual table  just purge state
        _purgeFromState();
    }

    // Update tab badge counts live
    refreshStatusCounts();
    // Clear selection
    if (typeof window.alpineClearSelection === 'function') window.alpineClearSelection();
}

/**
 * Remove multiple card rows in one pass to avoid full table refresh after bulk actions.
 * Keeps SR numbering stable and clears selection state.
 * @param {Array<string|number>} cardIds
 * @param {Object} [options]
 * @param {number} [options.removedCount] - Number of rows updated on server (for total count sync).
 */
function removeCardRows(cardIds, options) {
    var _ts = IDCardApp._ts;
    var ids = Array.isArray(cardIds) ? cardIds.map(function(id) { return String(id); }) : [];
    if (!ids.length) return;

    var idSet = new Set(ids);
    var rows = ids
        .map(function(id) { return document.querySelector('tr[data-card-id="' + id + '"]'); })
        .filter(Boolean);

    rows.forEach(function(row) {
        row.style.transition = 'opacity 0.2s ease, transform 0.2s ease, max-height 0.24s ease';
        row.style.opacity = '0';
        row.style.transform = 'translateX(30px)';
        row.style.maxHeight = row.offsetHeight + 'px';
        row.style.overflow = 'hidden';
    });

    setTimeout(function() {
        rows.forEach(function(row) {
            row.style.maxHeight = '0';
            row.style.padding = '0';
            row.style.borderColor = 'transparent';
        });
    }, 160);

    setTimeout(function() {
        rows.forEach(function(row) {
            if (row.parentNode) row.parentNode.removeChild(row);
        });

        if (_ts) {
            _ts.allRows = _ts.allRows.filter(function(r) {
                return !idSet.has(String(r.getAttribute('data-card-id')));
            });
            _ts.filteredRows = _ts.filteredRows.filter(function(r) {
                return !idSet.has(String(r.getAttribute('data-card-id')));
            });

            if (_ts._loadedCardIds) {
                ids.forEach(function(id) { _ts._loadedCardIds.delete(Number(id)); });
            }

            if (_ts.lazyLoadState) {
                var removedVisible = rows.length;
                if (_ts.lazyLoadState.loadedCount > 0) {
                    _ts.lazyLoadState.loadedCount = Math.max(0, _ts.lazyLoadState.loadedCount - removedVisible);
                }
                var removedTotal = Number(options && options.removedCount);
                if (Number.isFinite(removedTotal) && removedTotal > 0 && _ts.lazyLoadState.totalCount > 0) {
                    _ts.lazyLoadState.totalCount = Math.max(0, _ts.lazyLoadState.totalCount - removedTotal);
                } else if (removedVisible > 0 && _ts.lazyLoadState.totalCount > 0) {
                    _ts.lazyLoadState.totalCount = Math.max(0, _ts.lazyLoadState.totalCount - removedVisible);
                }
            }

            if (typeof IDCardApp.renderTable === 'function') IDCardApp.renderTable();
        }

        reindexVisibleSrNumbers();
        refreshStatusCounts();

        // Clear selection and any DB-wide select-all flags.
        IDCardApp.allDbCardIds = null;
        var selectAll = document.getElementById('selectAll');
        if (selectAll) selectAll.checked = false;
        var selectAllDbBtn = document.getElementById('selectAllDbBtn');
        if (selectAllDbBtn) selectAllDbBtn.classList.remove('active');
        if (typeof window.alpineClearSelection === 'function') window.alpineClearSelection();
        if (typeof IDCardApp.updateButtonStates === 'function') IDCardApp.updateButtonStates();
    }, 420);
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

/* Action theme config  icon, colors, labels, status flow */
var _actionThemes = {
    verify:      { icon: 'fa-shield-check',     color: '#10b981', bg: '#ecfdf5', label: 'Verify',      confirmLabel: 'Verify',      from: 'Pending',   to: 'Verified',  fromColor: '#f59e0b', toColor: '#10b981' },
    approve:     { icon: 'fa-circle-check',      color: '#3b82f6', bg: '#eff6ff', label: 'Approve',     confirmLabel: 'Approve',     from: 'Verified',  to: 'Approved',  fromColor: '#10b981', toColor: '#3b82f6' },
    unverify:    { icon: 'fa-rotate-left',       color: '#f59e0b', bg: '#fffbeb', label: 'Unverify',    confirmLabel: 'Move to Pending', from: 'Verified',  to: 'Pending',   fromColor: '#10b981', toColor: '#f59e0b' },
    disapprove:  { icon: 'fa-rotate-left',       color: '#f59e0b', bg: '#fffbeb', label: 'Disapprove',  confirmLabel: 'Move to Verified', from: 'Approved',  to: 'Verified',  fromColor: '#3b82f6', toColor: '#10b981' },
    retrieve:    { icon: 'fa-arrow-rotate-left', color: '#6366f1', bg: '#eef2ff', label: 'Retrieve',    confirmLabel: 'Retrieve',    from: 'Pool',      to: 'Pending',   fromColor: '#ef4444', toColor: '#f59e0b' },
    retrievePool:{ icon: 'fa-arrow-rotate-left', color: '#6366f1', bg: '#eef2ff', label: 'Retrieve',    confirmLabel: 'Retrieve',    from: 'Pool',      to: 'Pending',   fromColor: '#ef4444', toColor: '#f59e0b' },
    retrieveDownload:{ icon: 'fa-arrow-rotate-left', color: '#2563eb', bg: '#eff6ff', label: 'Retrieve', confirmLabel: 'Retrieve',   from: 'Download',  to: 'Pending',   fromColor: '#3b82f6', toColor: '#f59e0b' },
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
        // One-sided flow (e.g. delete  Pool)
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
    overlay.addEventListener('click', function(e) { /* disabled  prevent accidental closure */ });
    document.getElementById('workflowConfirmOk').onclick = function() {
        cleanup();
        document.removeEventListener('keydown', onKeyDown);
        onConfirm();
    };
}

function _extractRetrieveClassChangeDetails(payload) {
    if (!payload || !payload.requires_class_change) return null;
    if (payload.card_id) return payload;
    if (Array.isArray(payload.cards) && payload.cards.length === 1) return payload.cards[0];
    return null;
}

function promptRetrieveClassAndConfirm(details, sourceLabel, onConfirmClass) {
    if (!details || typeof onConfirmClass !== 'function') return false;

    var allowedClasses = Array.isArray(details.allowed_classes)
        ? details.allowed_classes.map(function(value) { return String(value || '').trim(); }).filter(Boolean)
        : [];
    if (!allowedClasses.length) {
        if (typeof showToast === 'function') {
            showToast('No assigned class available. Ask admin to set your class assignment.', false);
        }
        return true;
    }

    var currentClass = String(details.current_class || '').trim();
    var promptLines = [
        'This record is outside your assigned class scope.',
        '',
        'Assigned classes: ' + allowedClasses.join(', '),
    ];
    if (currentClass) {
        promptLines.push('Current class: ' + currentClass);
    }
    promptLines.push('Enter one assigned class to continue:');

    var picked = window.prompt(promptLines.join('\n'), allowedClasses[0]);
    if (picked === null) {
        return true;
    }

    picked = String(picked || '').trim();
    if (!picked) {
        if (typeof showToast === 'function') showToast('Class is required to retrieve this card.', false);
        return true;
    }

    var matchedClass = null;
    var pickedLower = picked.toLowerCase();
    for (var i = 0; i < allowedClasses.length; i++) {
        if (allowedClasses[i].toLowerCase() === pickedLower) {
            matchedClass = allowedClasses[i];
            break;
        }
    }
    if (!matchedClass) {
        if (typeof showToast === 'function') {
            showToast('Select a class from your assigned classes only.', false);
        }
        return true;
    }

    showWorkflowConfirm(
        'Change class to "' + matchedClass + '" and move this record from ' + sourceLabel + ' to Pending list?',
        function() {
            onConfirmClass(matchedClass);
        },
        {
            actionType: sourceLabel === 'Download' ? 'retrieveDownload' : 'retrievePool',
            note: 'Class will be updated only after you confirm. Cancel keeps card unchanged in ' + sourceLabel + '.',
        }
    );

    return true;
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
    showWorkflowConfirm('Are you sure you want to move this record from Verified to Pending?', function() {
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
    }, {
        actionType: 'unverify',
        note: 'This will move the record from Verified to Pending list.'
    });
}

function retrieveCard(cardId) {
    const currentStatus = (typeof CURRENT_STATUS !== 'undefined' ? String(CURRENT_STATUS).toLowerCase() : 'pool');
    const isDownloadList = currentStatus === 'download';
    const sourceLabel = isDownloadList ? 'Download' : 'Pool';

    function performRetrieve(payload) {
        return apiCall(`/api/card/${cardId}/status/`, 'POST', payload)
            .then(function(data) {
                if (data.success === false) {
                    var details = _extractRetrieveClassChangeDetails(data);
                    if (details && promptRetrieveClassAndConfirm(details, sourceLabel, function(selectedClass) {
                        performRetrieve({ status: 'pending', apply_class_change: true, updated_class: selectedClass });
                    })) {
                        return;
                    }
                    if (typeof showToast === 'function') showToast(data.message || 'Error', false);
                    return;
                }
                if (typeof showToast === 'function') showToast('Card retrieved to pending list');
                removeCardRow(cardId);
            })
            .catch(function(err) {
                var details = _extractRetrieveClassChangeDetails(err && err.data);
                if (details && promptRetrieveClassAndConfirm(details, sourceLabel, function(selectedClass) {
                    performRetrieve({ status: 'pending', apply_class_change: true, updated_class: selectedClass });
                })) {
                    return;
                }
                if (typeof showToast === 'function') showToast((err && err.message) || 'Failed to retrieve card', false);
            });
    }

    showWorkflowConfirm(`Are you sure you want to move this record from ${sourceLabel} to Pending list?`, function() {
        if (typeof apiCall === 'function') {
            performRetrieve({ status: 'pending' });
        }
    }, {
        actionType: isDownloadList ? 'retrieveDownload' : 'retrievePool',
        note: `This will move the record from ${sourceLabel} to Pending list.`
    });
}

function disapproveCard(cardId) {
    showWorkflowConfirm('Are you sure you want to move this record from Approved to Verified list?', function() {
        if (typeof apiCall === 'function') {
            apiCall(`/api/card/${cardId}/status/`, 'POST', { status: 'verified' })
                .then(data => {
                    if (data.success === false) {
                        if (typeof showToast === 'function') showToast(data.message || 'Cannot disapprove card', false);
                        return;
                    }
                    if (typeof showToast === 'function') showToast('Card moved to verified list');
                    removeCardRow(cardId);
                })
                .catch(err => {
                    if (typeof showToast === 'function') showToast(err.message || 'Failed to disapprove card', false);
                });
        }
    }, {
        actionType: 'disapprove',
        note: 'This will move the record from Approved to Verified list.'
    });
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
IDCardApp.removeCardRows = removeCardRows;
IDCardApp.refreshStatusCounts = refreshStatusCounts;
IDCardApp.reindexVisibleSrNumbers = reindexVisibleSrNumbers;
IDCardApp.prependCardRowToTable = prependCardRowToTable;
IDCardApp.showWorkflowConfirm = showWorkflowConfirm;
IDCardApp.extractRetrieveClassChangeDetails = _extractRetrieveClassChangeDetails;
IDCardApp.promptRetrieveClassAndConfirm = promptRetrieveClassAndConfirm;
IDCardApp.verifyCard = verifyCard;
IDCardApp.approveCard = approveCard;
IDCardApp.unverifyCard = unverifyCard;
IDCardApp.retrieveCard = retrieveCard;
IDCardApp.disapproveCard = disapproveCard;
IDCardApp.moveToDownload = moveToDownload;

})();
