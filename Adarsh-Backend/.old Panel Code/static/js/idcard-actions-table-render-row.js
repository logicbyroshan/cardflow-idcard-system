// ID Card Actions - Table Row Rendering Module
// Contains: Row creation, row action buttons, table body delegation, highlight search
// Part of: idcard-actions-table split (state  render-row  render-main  load)

(function() {
'use strict';

window.IDCardApp = window.IDCardApp || {};
var _ts = window.IDCardApp._ts;

// ==========================================
// ROW CREATION HELPERS
// ==========================================

// Mirror Python classify_column() via shared FieldClassifier for dynamic text fields
function getTdWidthClass(fieldName, fieldType) {
    if (window.FieldClassifier) return window.FieldClassifier.tdClass(fieldName, fieldType);
    // Fallback if FieldClassifier not loaded yet
    if (!fieldName) return 'min-w-[80px] whitespace-normal break-words';
    return 'min-w-[80px] text-left whitespace-normal break-words';
}

/**
 * Inject <wbr> after commas (but NOT after dots) to allow smart line-breaking
 * at comma positions without breaking within words or decimal numbers.
 * The original value is preserved in data-original-value for editing.
 */
function addCommaBreaks(text) {
    if (!text) return text;
    // Insert zero-width word-break opportunity after comma (and optional space)
    // so text wraps at "COLONY, NEW JAIL"  wraps after comma
    // Do NOT insert breaks after dots (avoids breaking "10.5" or "B.A.")
    return text.replace(/,(\s*)/g, ',<wbr>$1');
}

function createRowFromCard(card, index) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-card-id', card.id);
    tr.setAttribute('data-sr-no', card.sr_no);
    
    // Image field types
    // Use global IMAGE_FIELD_TYPES
    const localImageFieldTypes = (typeof IMAGE_FIELD_TYPES !== 'undefined') 
        ? IMAGE_FIELD_TYPES 
        : ['photo', 'rel_photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature', 'image'];
    
    // Image field name patterns (for detecting by name when type might not be set correctly)
    const imageFieldNamePatterns = ['photo', 'rel photo', 'relation photo', 'relation image', 'relation pic', 'f photo', 'father photo', 'm photo', 'mother photo', 'sign', 'signature', 'barcode', 'qr', 'qr_code', 'image'];
    
    function isImageFieldType(fieldType) {
        if (!fieldType) return false;
        return localImageFieldTypes.includes(fieldType.toLowerCase());
    }
    
    function isImageFieldByName(fieldName) {
        if (!fieldName) return false;
        const normalizedName = fieldName.toLowerCase().trim();
        const spacedName = normalizedName.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (/^(?:rel(?:ation)?)\s*(?:1|one|2|two)\s*(?:photo|image|pic|picture)$/.test(spacedName)) {
            return true;
        }
        if (/\b(?:father|mother)\b\s*(?:photo|image|pic|picture)\b/.test(spacedName)) {
            return true;
        }
        // Use word boundary matching to avoid false positives like 'designation' matching 'sign'
        const patterns = ['photo', 'sign', 'signature', 'barcode', 'qr'];
        for (const pattern of patterns) {
            const regex = new RegExp('\\b' + pattern + '\\b');
            if (regex.test(spacedName)) {
                return true;
            }
        }
        return imageFieldNamePatterns.some(pattern => normalizedName === pattern || spacedName === pattern);
    }
    
    function isImageField(fieldType, fieldName) {
        return isImageFieldType(fieldType) || isImageFieldByName(fieldName);
    }
    
    // Get CSS class based on field name for different image types
    function getImageTypeClass(fieldName) {
        if (!fieldName) return 'photo-type';
        const nameLower = fieldName.toLowerCase();
        // Use word boundary matching to avoid 'designation' matching 'sign'
        if (/\bsign\b|\bsignature\b/.test(nameLower)) return 'signature-type';
        if (/\bqr\b/.test(nameLower)) return 'qr-type';
        if (/\bbarcode\b/.test(nameLower)) return 'barcode-type';
        return 'photo-type';
    }
    
    function toMediaSrc(path) {
        if (!path) return '';
        const p = String(path).trim();
        if (!p) return '';
        if (p.startsWith('http://') || p.startsWith('https://')) return p;
        if (p.startsWith('/media/')) return p;
        return `/media/${p.replace(/^\/+/, '')}`;
    }

    let html = `<td class="w-[24px] px-[1px] py-1 text-center align-middle checkbox-cell"><input type="checkbox" class="rowCheckbox"></td>`;
    html += `<td class="w-[36px] px-[1px] py-1 text-center align-middle sr-no-cell">${card.sr_no}</td>`;
    
    if (card.ordered_fields) {
        const _esc = window.escapeHtml || function(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); };
        card.ordered_fields.forEach(field => {
            const fieldName = field.name;
            const fieldType = field.type;
            const fieldValue = field.value || '';
            const safeFieldName = _esc(fieldName);
            const safeFieldValue = _esc(fieldValue);
            
            if (isImageField(fieldType, fieldName)) {
                let imageHtml = '';
                const imageTypeClass = getImageTypeClass(fieldName);
                
                // Check if it's a PENDING reference
                const isPending = fieldValue && fieldValue.startsWith('PENDING:');
                const pendingRef = isPending ? fieldValue.substring(8) : null;
                
                // Create full path with /media/ prefix (only for actual paths, not PENDING)
                const fullImagePath = fieldValue && fieldValue !== '' && !isPending
                    ? (fieldValue.startsWith('/media/') || fieldValue.startsWith('http') ? fieldValue : `/media/${fieldValue}`)
                    : '';
                
                const isNotFound = fieldValue === 'NOT_FOUND';
                


                if (isPending) {
                    // PENDING - show waiting placeholder with clock icon
                    imageHtml = `<div class="no-image pending-placeholder" title="Waiting for upload: ${pendingRef}"><i class="fa-solid fa-clock"></i></div>`;
                } else if (isNotFound) {
                    // NOT_FOUND (legacy) - treat as empty
                    imageHtml = `<div class="no-image colorful-placeholder" title="Image not found"><i class="fa-solid fa-user-astronaut"></i></div>`;
                } else if (fieldValue && fieldValue !== '') {
                    // Valid image path - use thumbnail for table display, fallback to original
                    const cacheBuster = `?t=${Date.now()}`;
                    // Use thumbnail path for faster loading in tables
                    const thumbPath = window.getThumbPath ? window.getThumbPath(fieldValue) : fieldValue;
                    const thumbSrcBase = toMediaSrc(thumbPath);
                    const originalSrcBase = toMediaSrc(fieldValue);
                    const thumbSrc = thumbSrcBase ? `${thumbSrcBase}${cacheBuster}` : null;
                    const originalSrc = originalSrcBase ? `${originalSrcBase}${cacheBuster}` : '';
                    
                    // Use onError fallback to original if thumbnail doesn't exist
                    // Escape originalSrc for safe use inside the inline onerror attribute
                    const safeOriginalSrc = originalSrc.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const fallbackAttr = thumbPath ? `onerror="this.onerror=null; this.src='${safeOriginalSrc}';"` : '';
                    const imageSrc = thumbPath ? thumbSrc : originalSrc;
                    imageHtml = `<img src="${imageSrc}" alt="${safeFieldName}" class="table-image ${imageTypeClass}" loading="lazy" decoding="async" ${fallbackAttr}>`;
                } else {
                    // Empty/null - Colorful placeholder (no image)
                    imageHtml = `<div class="no-image colorful-placeholder"><i class="fa-solid fa-user-astronaut"></i></div>`;
                }
                
                // IMPORTANT: Store raw fieldValue (including PENDING:xxx) for Image Sort filter to work
                // This matches what template table.html stores
                html += `<td class="w-[28px] px-[1px] py-1 text-center align-middle image-field image-cell ${imageTypeClass}" 
                    data-field="${safeFieldName}"
                    data-field-name="${safeFieldName}" 
                    data-field-type="image"
                    data-original-value="${safeFieldValue}">
                    <div class="image-with-edit">
                        ${imageHtml}
                        ${(typeof PERMS !== 'undefined' && PERMS.idcard_edit && !(typeof IS_CLIENT_USER !== 'undefined' && IS_CLIENT_USER && typeof CLIENT_READONLY_STATUSES !== 'undefined' && CLIENT_READONLY_STATUSES.indexOf(_ts.lazyLoadState.currentStatus) !== -1)) ? `<button class="edit-photo-btn" data-card-id="${card.id}" title="Edit Card">Edit</button>` : ''}
                    </div>
                </td>`;
            } else {
                const widthAlignClass = getTdWidthClass(fieldName, fieldType);
                
                // Client users on approved/download: no inline editing
                const isLockedForClient = (typeof IS_CLIENT_USER !== 'undefined' && IS_CLIENT_USER
                    && typeof CLIENT_READONLY_STATUSES !== 'undefined'
                    && CLIENT_READONLY_STATUSES.indexOf(_ts.lazyLoadState.currentStatus) !== -1);
                const editableClass = isLockedForClient ? 'dynamic-field' : 'dynamic-field editable-cell';
                const editTitle = isLockedForClient ? '' : 'title="Click to edit"';
                
                // Display value: inject <wbr> after commas for smart wrapping.
                // data-original-value keeps the raw unmodified value for editing.
                const displayValue = addCommaBreaks(safeFieldValue);
                
                html += `<td class="${editableClass} ${widthAlignClass} px-[1px] py-1 align-middle" 
                    data-field="${safeFieldName}"
                    data-field-name="${safeFieldName}" 
                    data-field-type="${fieldType}"
                    data-original-value="${safeFieldValue}"
                    ${editTitle}>
                    <span class="cell-value">${displayValue}</span>
                </td>`;
            }
        });
    }
    
    // Status-dependent last column(s)
    const status = _ts.lazyLoadState.currentStatus;
    var isClientUser = (typeof IS_CLIENT_USER !== 'undefined' && IS_CLIENT_USER);
    if (status === 'pool') {
        // Pool list: show deleted_at for admins only (client/client_staff don't see admin delete info)
        if (!isClientUser) {
            html += `<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">${card.deleted_at || '-'}</td>`;
        }
    }

    const hasApprovedAction = (
        status === 'approved' &&
        !isClientUser &&
        typeof PERMS !== 'undefined' &&
        !!PERMS.idcard_approve
    );
    const hasDownloadRetrieveAction = (
        status === 'download' &&
        !isClientUser &&
        typeof PERMS !== 'undefined' &&
        !!PERMS.idcard_retrieve
    );
    const hasPoolRetrieveAction = (
        status === 'pool' &&
        typeof PERMS !== 'undefined' &&
        !!PERMS.idcard_retrieve
    );
    const showActionColumn = (
        hasDownloadRetrieveAction ||
        hasPoolRetrieveAction ||
        (status !== 'download' && status !== 'pool' && (status !== 'approved' || hasApprovedAction))
    );

    // Pending/Verified + Approved(disapprove) + Download/Pool(retrieve): show action buttons
    if (showActionColumn) {
        html += `<td class="w-[60px] px-[1px] py-1 text-center align-middle action-cell">
            <div class="action-buttons inline-flex flex-col gap-[2px]">
                ${getRowActionButtons(status, card.id)}
            </div>
        </td>`;
    }
    // Approved: for non-client users with permission, row action now includes single-card disapprove
    
    // Last Updated / Updated By
    // Admin users: shown on all statuses
    // Client users: shown only on pending/verified, and only if modified by a client/client_staff
    if (typeof PERMS === 'undefined' || PERMS.idcard_updated_at) {
        if (!isClientUser) {
            // Admin view  show all updated_at/modified_by as-is
            html += `<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">${card.updated_at || ''}</td>`;
            const rawUser = (card.modified_by && card.modified_by.trim()) ? card.modified_by : 'Admin';
            const updatedByLabel = window.FieldClassifier ? window.FieldClassifier.truncateUser(rawUser, 7) : rawUser;
            html += `<td class="w-[65px] px-[1px] py-1 align-middle user-cell whitespace-normal break-words text-center" title="${rawUser}">${updatedByLabel}</td>`;
        } else if (status === 'pending' || status === 'verified') {
            // Client view  only pending/verified; API already filters admin edits out
            html += `<td class="w-[90px] px-[1px] py-1 align-middle date-cell whitespace-nowrap text-center">${card.updated_at || ''}</td>`;
            const rawUserC = card.modified_by || '';
            const clientByLabel = window.FieldClassifier ? window.FieldClassifier.truncateUser(rawUserC, 7) : rawUserC;
            html += `<td class="w-[65px] px-[1px] py-1 align-middle user-cell whitespace-normal break-words text-center" title="${rawUserC}">${clientByLabel}</td>`;
        }
    }
    
    tr.innerHTML = html;
    return tr;
}

function getRowActionButtons(status, cardId) {
    var p = (typeof PERMS !== 'undefined') ? PERMS : {};
    var isClientUser = (typeof IS_CLIENT_USER !== 'undefined' && IS_CLIENT_USER);
    switch(status) {
        case 'pending':
            return p.idcard_verify ? `<button class="row-action-btn verify-row-btn" data-card-id="${cardId}" title="Verify this card"><span>Verify</span></button>` : '';
        case 'verified': {
            let btns = '';
            if (p.idcard_approve) btns += `<button class="row-action-btn approve-row-btn" data-card-id="${cardId}" title="Approve this card"><span>Approve</span></button>`;
            if (p.idcard_verify) btns += `<button class="row-action-btn unverify-row-btn" data-card-id="${cardId}" title="Move back to pending"><span>Unverify</span></button>`;
            return btns;
        }
        case 'approved':
            return p.idcard_approve ? `<button class="row-action-btn unapprove-row-btn" data-card-id="${cardId}" title="Move to verified list"><span>Disapprove</span></button>` : '';
        case 'download':
            return (!isClientUser && p.idcard_retrieve) ? `<button class="row-action-btn retrieve-row-btn" data-card-id="${cardId}" title="Move from download to pending"><span>Retrieve</span></button>` : '';
        case 'pool':
            return p.idcard_retrieve ? `<button class="row-action-btn retrieve-row-btn" data-card-id="${cardId}" title="Move from pool to pending"><span>Retrieve</span></button>` : '';
        default:
            return '';
    }
}

// ==========================================
// TABLE BODY DELEGATION
// ==========================================

/**
 * One-time delegated click handler on #cardsTableBody.
 * Covers .row-action-btn and .editable-cell clicks for all existing
 * and future (lazy-loaded / HTMX-swapped) rows.
 */
function _initTableBodyDelegation() {
    var tableBody = document.getElementById('cardsTableBody');
    if (!tableBody || tableBody._tblDelegationInit) return;
    tableBody._tblDelegationInit = true;

    tableBody.addEventListener('click', function(e) {
        // --- Row action buttons ---
        var btn = e.target.closest('.row-action-btn');
        if (btn) {
            e.stopPropagation();
            var cardId = btn.getAttribute('data-card-id');
            if (!cardId) return;
            if (btn.classList.contains('verify-row-btn') && window.IDCardApp && typeof window.IDCardApp.verifyCard === 'function') window.IDCardApp.verifyCard(cardId);
            else if (btn.classList.contains('approve-row-btn') && window.IDCardApp && typeof window.IDCardApp.approveCard === 'function') window.IDCardApp.approveCard(cardId);
            else if (btn.classList.contains('unverify-row-btn') && window.IDCardApp && typeof window.IDCardApp.unverifyCard === 'function') window.IDCardApp.unverifyCard(cardId);
            else if (btn.classList.contains('retrieve-row-btn') && window.IDCardApp && typeof window.IDCardApp.retrieveCard === 'function') window.IDCardApp.retrieveCard(cardId);
            else if (btn.classList.contains('unapprove-row-btn') && window.IDCardApp && typeof window.IDCardApp.disapproveCard === 'function') window.IDCardApp.disapproveCard(cardId);
            else if (btn.classList.contains('download-row-btn') && window.IDCardApp && typeof window.IDCardApp.moveToDownload === 'function') window.IDCardApp.moveToDownload(cardId);
            else if (btn.classList.contains('download-single-row-btn') && window.IDCardApp && typeof window.IDCardApp.moveToDownload === 'function') window.IDCardApp.moveToDownload(cardId);
            return;
        }

        // --- Editable cell single-click editing ---
        var cell = e.target.closest('.editable-cell:not(.image-field)');
        if (cell) {
            if (e.target.closest('button') || cell.classList.contains('editing')) return;
            if (typeof window.IDCardApp.startCellEdit === 'function') window.IDCardApp.startCellEdit(cell);
        }
    });
}

// ==========================================
// HIGHLIGHT SEARCH RESULT
// ==========================================

function highlightSearchResult() {
    const urlParams = new URLSearchParams(window.location.search);
    const highlightId = urlParams.get('highlight');
    
    if (!highlightId) return;

    function doHighlight() {
        const targetRow = document.querySelector(`tr[data-card-id="${highlightId}"]`);
        if (!targetRow) return false;

        // Use filteredRows (current view) for page calculation
        const rowIndex = _ts.filteredRows.indexOf(targetRow);
        const sourceRows = rowIndex !== -1 ? _ts.filteredRows : _ts.allRows;
        const idx = rowIndex !== -1 ? rowIndex : _ts.allRows.indexOf(targetRow);

        if (idx === -1) return false;

        // Switch to paginated mode so we can navigate to the correct page
        if (_ts.endlessScrollMode) {
            _ts.endlessScrollMode = false;
        }
        const targetPage = Math.floor(idx / _ts.rowsPerPage) + 1;
        _ts.currentPage = targetPage;
        window.IDCardApp.renderTable();

        // Small delay to let DOM settle before scrolling
        setTimeout(() => {
            // Re-query the row in case renderTable re-rendered it
            const row = document.querySelector(`tr[data-card-id="${highlightId}"]`);
            if (!row) return;

            row.classList.add('search-highlight');
            
            // Scroll the table container, not the whole page
            const scrollContainer = row.closest('.idcard-table') || row.closest('.table-container');
            if (scrollContainer) {
                const rowTop = row.offsetTop;
                const containerHeight = scrollContainer.clientHeight;
                scrollContainer.scrollTop = Math.max(0, rowTop - containerHeight / 3);
            }
            // Also use scrollIntoView as fallback
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Auto-check the checkbox
            const checkbox = row.querySelector('.rowCheckbox');
            if (checkbox) {
                checkbox.checked = true;
                checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Remove highlight after 10 seconds
            setTimeout(() => {
                row.classList.remove('search-highlight');
                const newUrl = new URL(window.location);
                newUrl.searchParams.delete('highlight');
                window.history.replaceState({}, '', newUrl);
            }, 10000);
        }, 150);
        
        return true;
    }

    // Try immediately  card may already be in DOM
    if (doHighlight()) return;

    // Card not in DOM yet  force load all data then highlight
    if (_ts.lazyLoadState.hasMore && _ts.lazyLoadState.tableId) {
        (async function() {
            try {
                await window.IDCardApp.loadAllData();
                // Re-initialize rows after all data loaded
                const tableBody = document.getElementById('cardsTableBody');
                if (tableBody) {
                    _ts.allRows = Array.from(tableBody.querySelectorAll('tr[data-card-id]'));
                    _ts.filteredRows = _ts.allRows.slice();
                }
                // Try highlight again
                if (!doHighlight()) {
                    console.warn('Highlight target not found after loading all data:', highlightId);
                }
            } catch (err) {
                console.error('Error loading data for highlight:', err);
            }
        })();
    } else {
        // No lazy load, but card not found  observe mutations as fallback
        var tableBody = document.getElementById('cardsTableBody');
        if (!tableBody) return;
        var _hlObserver = new MutationObserver(function() {
            _ts.allRows = Array.from(tableBody.querySelectorAll('tr[data-card-id]'));
            _ts.filteredRows = _ts.allRows.slice();
            if (doHighlight()) { _hlObserver.disconnect(); }
        });
        _hlObserver.observe(tableBody, { childList: true, subtree: true });
        setTimeout(function() { _hlObserver.disconnect(); }, 10000);
    }
}

// ==========================================
// EXPORTS
// ==========================================

window.IDCardApp._createRowFromCard = createRowFromCard;
window.IDCardApp._initTableBodyDelegation = _initTableBodyDelegation;
window.IDCardApp._highlightSearchResult = highlightSearchResult;

})();
