// ID Card Actions - Download Modals Sub-module
// Individual modal open/close handlers (images, docx, xlsx, pdf)
// Part of IDCardApp module system  registers functions on window.IDCardApp

(function() {
'use strict';

// ==========================================
// HELPERS
// ==========================================

/**
 * Get status label for modal display
 */
function _getStatusLabel() {
    const STATUS_LABELS = {
        pending: 'Pending',
        verified: 'Verified',
        approved: 'Approved',
        download: 'Download',
        pool: 'Pool'
    };
    return STATUS_LABELS[typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : 'pending'] || 'Current';
}

// ==========================================
// DOWNLOAD MODAL STATE
// ==========================================

let pendingDownloadCardIds = [];
let currentDownloadType = null; // 'pdf', 'xlsx', 'img'

// Modal DOM references (set in initDownloadModals)
let downloadPdfModal = null;
let downloadXlsxModal = null;
let downloadImgModal = null;

// ==========================================
// REPRINT PICKER MODAL (DOWNLOAD LIST)
// ==========================================

function initReprintPickerHandlers() {
    var triggerBtn = document.getElementById('openReprintModalBtn');
    var pickerModal = document.getElementById('reprintPickerModal');
    var pickerClose = document.getElementById('reprintPickerClose');
    var pickerCancel = document.getElementById('reprintPickerCancel');
    var pickerSearch = document.getElementById('reprintPickerSearchInput');
    var pickerSearchClear = document.getElementById('reprintPickerSearchClearBtn');
    var pickerTableBody = document.getElementById('reprintPickerTableBody');
    var pickerTableHead = document.getElementById('reprintPickerTableHead');
    var pickerSelectAll = document.getElementById('reprintPickerSelectAll');
    var pickerRequestBtn = document.getElementById('reprintPickerRequestBtn');
    var pickerSelectedInfo = document.getElementById('reprintPickerSelectedInfo');
    var pickerPreview = document.getElementById('reprintPickerPreview');

    var confirmModal = document.getElementById('reprintPickerConfirmModal');
    var confirmClose = document.getElementById('reprintPickerConfirmClose');
    var confirmCancel = document.getElementById('reprintPickerConfirmCancel');
    var confirmCount = document.getElementById('reprintPickerConfirmCount');
    var confirmEditBtn = document.getElementById('reprintPickerEditBtn');
    var confirmSubmitBtn = document.getElementById('reprintPickerConfirmBtn');
    var confirmPreview = document.getElementById('reprintPickerConfirmPreview');

    if (!triggerBtn || !pickerModal || !confirmModal) return;
    if (typeof CURRENT_STATUS !== 'undefined' && CURRENT_STATUS !== 'download') return;

    var endpoints = window.REPRINT_MODAL_ENDPOINTS || {};
    if (!endpoints.list || !endpoints.requestCreate) return;

    var rows = [];
    var tableFields = Array.isArray(window.TABLE_FIELDS) ? window.TABLE_FIELDS : [];
    var resolvedFields = [];
    var selectedIds = new Set();
    var lastQuery = '';
    var pendingEditIds = [];
    var searchTimer = null;

    function esc(text) {
        var div = document.createElement('div');
        div.textContent = String(text || '');
        return div.innerHTML;
    }

    function getField(item, keys) {
        var fields = item && item.ordered_fields ? item.ordered_fields : [];
        var i;
        for (i = 0; i < fields.length; i += 1) {
            var name = String(fields[i].name || '').toUpperCase();
            if (keys.indexOf(name) !== -1) return fields[i].value || '';
        }
        return '';
    }

    function getFieldByName(item, fieldName) {
        var fields = item && item.ordered_fields ? item.ordered_fields : [];
        var key = String(fieldName || '').toUpperCase();
        var i;
        for (i = 0; i < fields.length; i += 1) {
            var name = String(fields[i].name || '').toUpperCase();
            if (name === key) return fields[i].value || '';
        }
        return '';
    }

    function resolveFields(items) {
        if (Array.isArray(tableFields) && tableFields.length > 0) {
            resolvedFields = tableFields.map(function(f) {
                return { name: f.name, type: f.type || 'text' };
            });
            return;
        }
        var first = (items || []).find(function(it) {
            return Array.isArray(it.ordered_fields) && it.ordered_fields.length > 0;
        });
        if (first) {
            resolvedFields = first.ordered_fields.map(function(f) {
                return { name: f.name, type: f.type || 'text' };
            });
        } else {
            resolvedFields = [];
        }
    }

    function isImageFieldLocal(type, name) {
        var t = String(type || '').toLowerCase();
        var n = String(name || '').toLowerCase();
        return t === 'image' || t === 'photo' || t === 'file' ||
               n === 'photo' || n === 'image' || n === 'picture' || n === 'pic' || n === 'img';
    }

    function buildTableHead() {
        if (!pickerTableHead) return;
        var html = '<tr>';
        html += '<th class="center-cell" style="width:34px;"><input type="checkbox" id="reprintPickerSelectAll" aria-label="Select all"></th>';
        html += '<th class="center-cell" style="width:40px;">Sr</th>';
        resolvedFields.forEach(function(field) {
            var isImg = isImageFieldLocal(field.type, field.name);
            if (isImg) {
                html += '<th class="center-cell" style="width:52px;">' + esc(field.name) + '</th>';
            } else {
                html += '<th>' + esc(field.name) + '</th>';
            }
        });
        html += '<th>Status</th>';
        html += '</tr>';
        pickerTableHead.innerHTML = html;
        pickerSelectAll = document.getElementById('reprintPickerSelectAll');
        if (pickerSelectAll) {
            pickerSelectAll.addEventListener('change', function() {
                var checked = !!pickerSelectAll.checked;
                rows.forEach(function(item) {
                    var key = String(item.card_id);
                    if (checked) selectedIds.add(key);
                    else selectedIds.delete(key);
                });
                renderRows(rows);
            });
        }
    }

    function getStudentName(item) {
        return getField(item, ['NAME', 'STUDENT NAME', 'FULL NAME']) || ('Card #' + item.card_id);
    }

    function getClassName(item) {
        return getField(item, ['CLASS', 'STD', 'STANDARD', 'GRADE']) || '-';
    }

    function getSectionName(item) {
        return getField(item, ['SECTION', 'SEC', 'DIVISION', 'DIV']) || '-';
    }

    function updateSelectionUi() {
        var count = selectedIds.size;
        if (pickerSelectedInfo) pickerSelectedInfo.textContent = count + ' selected';
        if (pickerRequestBtn) pickerRequestBtn.disabled = count === 0;
        if (pickerSelectAll) {
            var enabledRows = rows.map(function(r) { return String(r.card_id); });
            var checkedCount = enabledRows.filter(function(id) { return selectedIds.has(id); }).length;
            pickerSelectAll.checked = enabledRows.length > 0 && checkedCount === enabledRows.length;
            pickerSelectAll.indeterminate = checkedCount > 0 && checkedCount < enabledRows.length;
        }
    }

    function renderRows(items) {
        rows = items || [];
        resolveFields(rows);
        buildTableHead();
        var html = '';
        var colCount = (resolvedFields.length || 0) + 3;
        if (!rows.length) {
            html = '<tr><td colspan="' + colCount + '" style="padding:24px;text-align:center;color:#6b7280;">No cards found in download list</td></tr>';
            pickerTableBody.innerHTML = html;
            updateSelectionUi();
            return;
        }

        rows.forEach(function(item, idx) {
            var id = String(item.card_id);
            var checked = selectedIds.has(id) ? ' checked' : '';
            html += '<tr data-card-id="' + esc(id) + '">';
            html += '<td class="center-cell"><input type="checkbox" class="reprint-picker-row" data-card-id="' + esc(id) + '"' + checked + '></td>';
            html += '<td class="center-cell">' + (idx + 1) + '</td>';
            resolvedFields.forEach(function(field) {
                var rawVal = getFieldByName(item, field.name);
                if (isImageFieldLocal(field.type, field.name)) {
                    var value = String(rawVal || '');
                    if (value && value !== 'NOT_FOUND' && value.indexOf('PENDING:') !== 0) {
                        var thumbPath = value.replace(/\/([^\/]+)$/, '/thumbnails/$1');
                        html += '<td class="center-cell photo-cell"><img src="/media/' + esc(thumbPath) + '" alt="' + esc(field.name) + '" loading="lazy" onerror="this.onerror=null;this.src=\'/media/' + esc(value) + '\'" /></td>';
                    } else {
                        html += '<td class="center-cell">-</td>';
                    }
                } else {
                    html += '<td>' + esc(rawVal || '-') + '</td>';
                }
            });
            html += '<td><span class="status-badge status-' + esc(item.status || 'download') + '">' + esc(item.status_display || 'Download') + '</span></td>';
            html += '</tr>';
        });
        pickerTableBody.innerHTML = html;
        updateSelectionUi();
    }

    function fetchList(query) {
        var q = query || '';
        lastQuery = q;
        ApiClient.get(endpoints.list + '?q=' + encodeURIComponent(q) + '&limit=500')
            .then(function(data) {
                if (!data || data.status !== 'ok') {
                    renderRows([]);
                    return;
                }
                renderRows(data.items || []);
            })
            .catch(function() {
                renderRows([]);
                if (typeof showToast === 'function') showToast('Failed to load reprint list', 'error');
            });
    }

    function selectedCardIdsAsNumbers() {
        return Array.from(selectedIds).map(function(id) { return parseInt(id, 10); }).filter(function(n) { return Number.isFinite(n); });
    }

    function formatPreviewText(cardId) {
        var item = rows.find(function(r) { return String(r.card_id) === String(cardId); });
        if (!item) return '';
        return 'Preview: ' + getStudentName(item) + ' | Class ' + getClassName(item) + ' | Section ' + getSectionName(item);
    }

    function openPicker() {
        pickerModal.style.display = 'flex';
        fetchList(lastQuery);
    }

    function closePicker() {
        pickerModal.style.display = 'none';
    }

    function openConfirm() {
        var ids = selectedCardIdsAsNumbers();
        if (!ids.length) return;
        pendingEditIds = ids.slice();
        if (confirmCount) confirmCount.textContent = String(ids.length);
        if (confirmEditBtn) {
            confirmEditBtn.disabled = ids.length !== 1;
            confirmEditBtn.title = ids.length === 1
                ? 'Edit selected card before requesting reprint'
                : 'Want to Edit is available for single selection only';
        }
        if (confirmSubmitBtn) {
            confirmSubmitBtn.disabled = false;
            confirmSubmitBtn.title = 'Continue without editing and request reprint';
        }
        var previewText = ids.length === 1 ? formatPreviewText(ids[0]) : '';
        if (confirmPreview) {
            if (previewText) {
                confirmPreview.textContent = previewText;
                confirmPreview.style.display = 'block';
            } else {
                confirmPreview.style.display = 'none';
                confirmPreview.textContent = '';
            }
        }
        confirmModal.style.display = 'flex';
    }

    function closeConfirm() {
        confirmModal.style.display = 'none';
    }

    function submitReprintRequest() {
        var ids = pendingEditIds.length ? pendingEditIds.slice() : selectedCardIdsAsNumbers();
        if (!ids.length) return;
        ApiClient.post(endpoints.requestCreate, { card_ids: ids })
            .then(function(data) {
                if (data && data.status === 'ok') {
                    if (typeof showToast === 'function') showToast(data.message || 'Reprint request created', 'success');
                    closeConfirm();
                    closePicker();
                    if (endpoints.requestListPage) {
                        window.location.href = endpoints.requestListPage;
                    }
                } else {
                    if (typeof showToast === 'function') showToast((data && data.message) || 'Could not create reprint request', 'error');
                }
            })
            .catch(function() {
                if (typeof showToast === 'function') showToast('Could not create reprint request', 'error');
            });
    }

    triggerBtn.addEventListener('click', function() {
        openPicker();
    });

    pickerClose.addEventListener('click', closePicker);
    pickerCancel.addEventListener('click', closePicker);
    pickerModal.addEventListener('click', function(e) {
        if (e.target === pickerModal) closePicker();
    });

    if (pickerSearch) {
        pickerSearch.addEventListener('input', function() {
            var q = pickerSearch.value.trim();
            if (pickerSearchClear) pickerSearchClear.style.display = q ? '' : 'none';
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function() { fetchList(q); }, 250);
        });
    }
    if (pickerSearchClear) {
        pickerSearchClear.addEventListener('click', function() {
            if (pickerSearch) pickerSearch.value = '';
            pickerSearchClear.style.display = 'none';
            fetchList('');
        });
    }

    pickerTableBody.addEventListener('change', function(e) {
        var cb = e.target.closest('.reprint-picker-row');
        if (!cb) return;
        var id = String(cb.getAttribute('data-card-id') || '');
        if (!id) return;
        if (cb.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        updateSelectionUi();
    });

    if (pickerRequestBtn) pickerRequestBtn.addEventListener('click', openConfirm);

    confirmClose.addEventListener('click', closeConfirm);
    confirmCancel.addEventListener('click', closeConfirm);
    confirmModal.addEventListener('click', function(e) {
        if (e.target === confirmModal) closeConfirm();
    });

    if (confirmSubmitBtn) {
        confirmSubmitBtn.addEventListener('click', function() {
            submitReprintRequest();
        });
    }

    if (confirmEditBtn) {
        confirmEditBtn.addEventListener('click', function() {
            if (pendingEditIds.length !== 1) {
                if (typeof showToast === 'function') showToast('Select one card to edit', 'warning');
                return;
            }
            var cardId = pendingEditIds[0];
            closeConfirm();
            if (typeof window.IDCardApp.fetchCardAndOpenModal === 'function') {
                window.IDCardApp.fetchCardAndOpenModal('edit', cardId);
            }
        });
    }

    document.addEventListener('idcard:card-updated', function(e) {
        var detail = e && e.detail ? e.detail : {};
        var updatedId = Number(detail.cardId);
        if (!Number.isFinite(updatedId)) return;
        if (pendingEditIds.length !== 1 || pendingEditIds[0] !== updatedId) return;

        fetchList(lastQuery);
        var updatedCard = detail.card || null;
        var previewText = '';
        if (updatedCard && Array.isArray(updatedCard.ordered_fields)) {
            previewText = 'Preview: ' + getStudentName(updatedCard) + ' | Class ' + getClassName(updatedCard) + ' | Section ' + getSectionName(updatedCard);
        } else {
            previewText = formatPreviewText(updatedId);
        }
        if (pickerPreview) {
            pickerPreview.textContent = previewText || 'Card updated successfully. Please confirm reprint.';
            pickerPreview.style.display = 'block';
        }
        if (confirmPreview) {
            confirmPreview.textContent = previewText || 'Card updated successfully. You can now confirm reprint.';
            confirmPreview.style.display = 'block';
        }
        confirmModal.style.display = 'flex';
    });
}

// ==========================================
// DOWNLOAD IMAGES MODAL
// ==========================================

function openDownloadImgModal(cardIds) {
    pendingDownloadCardIds = cardIds;
    currentDownloadType = 'img';
    downloadImgModal = document.getElementById('downloadImgModal');

    if (!downloadImgModal) {
        // Fallback: download directly if modal not found
        window.IDCardApp.downloadImages(cardIds);
        return;
    }

    const listNameEl = document.getElementById('downloadImgListName');
    const cardCountEl = document.getElementById('downloadImgCardCount');

    if (listNameEl) listNameEl.textContent = _getStatusLabel() + ' List';
    // Show "All" if no specific cards selected, otherwise show the count
    if (cardCountEl) cardCountEl.textContent = cardIds.length > 0 ? cardIds.length : 'All';

    downloadImgModal.style.display = 'flex';
}

function closeDownloadImgModal() {
    if (downloadImgModal) {
        downloadImgModal.style.display = 'none';
    }
    pendingDownloadCardIds = [];
    currentDownloadType = null;
}

function initDownloadImagesHandlers() {
    const downloadImgBtnIds = ['downloadImgBtn', 'downloadImgBtnV', 'downloadImgBtnP', 'downloadImgBtnA', 'downloadImgBtnD'];

    downloadImgBtnIds.forEach(btnId => {
        document.getElementById(btnId)?.addEventListener('click', async function() {
            this.disabled = true;
            try {
                let cardIds = (window.IDCardApp && typeof window.IDCardApp.getAllCardIdsForAction === 'function') ? await window.IDCardApp.getAllCardIdsForAction() : [];
                // If we couldn't get card IDs, proceed anyway - backend will use all cards for current status
                openDownloadImgModal(cardIds);
            } catch (error) {
                console.error('Error getting card IDs for download:', error);
                // Proceed with empty array - backend handles fallback
                openDownloadImgModal([]);
            } finally {
                this.disabled = false;
            }
        });
    });

    // Modal button handlers
    document.getElementById('downloadImgCancel')?.addEventListener('click', closeDownloadImgModal);
    document.getElementById('downloadImgClose')?.addEventListener('click', closeDownloadImgModal);
    document.getElementById('downloadImgConfirm')?.addEventListener('click', function() {
        closeDownloadImgModal();
        window.IDCardApp.downloadImages(pendingDownloadCardIds);
    });
}

// ==========================================
// DOWNLOAD DOCX MODAL
// ==========================================

let pendingDocxDownloadIds = [];
let pendingDocxFormat = 'docx';

function openDocFormatModal(cardIds) {
    pendingDocxDownloadIds = cardIds;
    const docFormatModalOverlay = document.getElementById('docFormatModalOverlay');
    if (docFormatModalOverlay) {
        docFormatModalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Lock body scroll
    }
}

function closeDocFormatModal() {
    const docFormatModalOverlay = document.getElementById('docFormatModalOverlay');
    if (docFormatModalOverlay) {
        docFormatModalOverlay.classList.remove('active');
        document.body.style.overflow = ''; // Restore body scroll
    }
    pendingDocxDownloadIds = [];
}

function openDownloadDocxModal(cardIds, format) {
    pendingDocxDownloadIds = cardIds;
    pendingDocxFormat = format || 'docx';
    const modal = document.getElementById('downloadDocxModal');
    if (!modal) {
        // Fallback: download directly if modal not found
        window.IDCardApp.downloadDocx(cardIds, pendingDocxFormat, '');
        return;
    }
    const listNameEl = document.getElementById('downloadDocxListName');
    const cardCountEl = document.getElementById('downloadDocxCardCount');
    if (listNameEl) listNameEl.textContent = _getStatusLabel() + ' List';
    if (cardCountEl) cardCountEl.textContent = cardIds.length > 0 ? cardIds.length : 'All';
    // Load templates dynamically (from init sub-module)
    if (window.IDCardApp._loadExportTemplates) window.IDCardApp._loadExportTemplates(false);
    modal.style.display = 'flex';
}

function closeDownloadDocxModal() {
    const modal = document.getElementById('downloadDocxModal');
    if (modal) modal.style.display = 'none';
}

function initDownloadDocxHandlers() {
    const docFormatModalOverlay = document.getElementById('docFormatModalOverlay');

    document.getElementById('closeDocFormatModal')?.addEventListener('click', closeDocFormatModal);
    document.getElementById('cancelDocFormatModal')?.addEventListener('click', closeDocFormatModal);

    if (docFormatModalOverlay) {
        // Disabled  prevent accidental closure on outside click
    }

    document.querySelectorAll('.format-card').forEach(card => {
        card.addEventListener('click', function() {
            const format = this.getAttribute('data-format');
            if (format) {
                closeDocFormatModal();
                openDownloadDocxModal(pendingDocxDownloadIds, format);
            }
        });
    });

    // Docx template modal handlers
    document.getElementById('downloadDocxCancel')?.addEventListener('click', closeDownloadDocxModal);
    document.getElementById('downloadDocxClose')?.addEventListener('click', closeDownloadDocxModal);
    document.getElementById('downloadDocxConfirm')?.addEventListener('click', function() {
        const templateSelect = document.getElementById('downloadDocxTemplate');
        const templateId = templateSelect ? templateSelect.value : '';
        window.IDCardApp.downloadDocx(pendingDocxDownloadIds, pendingDocxFormat, templateId);
    });

    const downloadDocxBtnIds = ['downloadDocxBtn', 'downloadDocxBtnV', 'downloadDocxBtnP', 'downloadDocxBtnA', 'downloadDocxBtnD'];

    downloadDocxBtnIds.forEach(btnId => {
        document.getElementById(btnId)?.addEventListener('click', async function() {
            this.disabled = true;
            try {
                let cardIds = (window.IDCardApp && typeof window.IDCardApp.getAllCardIdsForAction === 'function') ? await window.IDCardApp.getAllCardIdsForAction() : [];
                openDocFormatModal(cardIds);
            } catch (error) {
                console.error('Error getting card IDs for download:', error);
                openDocFormatModal([]);
            } finally {
                this.disabled = false;
            }
        });
    });
}

// ==========================================
// DOWNLOAD XLSX MODAL
// ==========================================

function openDownloadXlsxModal(cardIds) {
    pendingDownloadCardIds = cardIds;
    currentDownloadType = 'xlsx';
    downloadXlsxModal = document.getElementById('downloadXlsxModal');

    if (!downloadXlsxModal) {
        // Fallback: download directly if modal not found
        window.IDCardApp.downloadXlsx(cardIds);
        return;
    }

    const listNameEl = document.getElementById('downloadXlsxListName');
    const cardCountEl = document.getElementById('downloadXlsxCardCount');

    if (listNameEl) listNameEl.textContent = _getStatusLabel() + ' List';
    // Show "All" if no specific cards selected, otherwise show the count
    if (cardCountEl) cardCountEl.textContent = cardIds.length > 0 ? cardIds.length : 'All';

    downloadXlsxModal.style.display = 'flex';
}

function closeDownloadXlsxModal() {
    if (downloadXlsxModal) {
        downloadXlsxModal.style.display = 'none';
    }
    pendingDownloadCardIds = [];
    currentDownloadType = null;
}

function initDownloadXlsxHandlers() {
    const downloadXlsxBtnIds = ['downloadXlsxBtn', 'downloadXlsxBtnV', 'downloadXlsxBtnP', 'downloadXlsxBtnA', 'downloadXlsxBtnD'];

    downloadXlsxBtnIds.forEach(btnId => {
        document.getElementById(btnId)?.addEventListener('click', async function() {
            this.disabled = true;
            try {
                let cardIds = (window.IDCardApp && typeof window.IDCardApp.getAllCardIdsForAction === 'function') ? await window.IDCardApp.getAllCardIdsForAction() : [];
                openDownloadXlsxModal(cardIds);
            } catch (error) {
                console.error('Error getting card IDs for download:', error);
                openDownloadXlsxModal([]);
            } finally {
                this.disabled = false;
            }
        });
    });

    // Modal button handlers
    document.getElementById('downloadXlsxCancel')?.addEventListener('click', closeDownloadXlsxModal);
    document.getElementById('downloadXlsxClose')?.addEventListener('click', closeDownloadXlsxModal);
    document.getElementById('downloadXlsxConfirm')?.addEventListener('click', function() {
        closeDownloadXlsxModal();
        window.IDCardApp.downloadXlsx(pendingDownloadCardIds);
    });
}

// ==========================================
// DOWNLOAD PDF MODAL (with template selection)
// ==========================================

let pendingPdfCardIds = [];
let selectedPdfTemplate = 'default';

function openDownloadPdfModal(cardIds) {
    pendingPdfCardIds = cardIds;
    downloadPdfModal = document.getElementById('downloadPdfModal');

    if (!downloadPdfModal) {
        // Fallback: download directly if modal not found
        window.IDCardApp.downloadPdf(cardIds, '', 'auto');
        return;
    }

    const listNameEl = document.getElementById('downloadPdfListName');
    const cardCountEl = document.getElementById('downloadPdfCardCount');

    if (listNameEl) listNameEl.textContent = _getStatusLabel() + ' List';
    // Show "All" if no specific cards selected, otherwise show the count
    if (cardCountEl) cardCountEl.textContent = cardIds.length > 0 ? cardIds.length : 'All';

    // Detect column count from the displayed table header
    var DENSE_THRESHOLD = 15;
    var thElements = document.querySelectorAll('#id-card-table thead th, .idcard-table thead th, table.data-table thead th');
    var colCount = thElements.length || 0;
    var denseWarning = document.getElementById('downloadPdfDenseWarning');
    var colCountEl2 = document.getElementById('downloadPdfColCount');

    if (colCount > DENSE_THRESHOLD && denseWarning) {
        denseWarning.style.display = 'block';
        if (colCountEl2) colCountEl2.textContent = colCount;
    } else if (denseWarning) {
        denseWarning.style.display = 'none';
    }

    // Load templates dynamically (from init sub-module)
    if (window.IDCardApp._loadExportTemplates) window.IDCardApp._loadExportTemplates(false);

    downloadPdfModal.style.display = 'flex';
}

function closeDownloadPdfModal() {
    if (downloadPdfModal) {
        downloadPdfModal.style.display = 'none';
    }
    pendingPdfCardIds = [];
    // Reset shorten-titles checkbox for next open
    var shortenCb = document.getElementById('downloadPdfShortenTitles');
    if (shortenCb) shortenCb.checked = false;
}

function initDownloadPdfHandlers() {
    const downloadPdfBtnIds = ['downloadPdfBtn', 'downloadPdfBtnV', 'downloadPdfBtnP', 'downloadPdfBtnA', 'downloadPdfBtnD'];

    downloadPdfBtnIds.forEach(btnId => {
        document.getElementById(btnId)?.addEventListener('click', async function() {
            this.disabled = true;
            try {
                let cardIds = (window.IDCardApp && typeof window.IDCardApp.getAllCardIdsForAction === 'function') ? await window.IDCardApp.getAllCardIdsForAction() : [];
                openDownloadPdfModal(cardIds);
            } catch (error) {
                console.error('Error getting card IDs for download:', error);
                openDownloadPdfModal([]);
            } finally {
                this.disabled = false;
            }
        });
    });

    // Modal button handlers
    document.getElementById('downloadPdfCancel')?.addEventListener('click', closeDownloadPdfModal);
    document.getElementById('downloadPdfClose')?.addEventListener('click', closeDownloadPdfModal);
    document.getElementById('downloadPdfConfirm')?.addEventListener('click', function() {
        const templateSelect = document.getElementById('downloadPdfTemplate');
        const templateId = templateSelect ? templateSelect.value : '';
        var fontMode = 'auto';
        // Read shorten-titles checkbox
        var shortenCb = document.getElementById('downloadPdfShortenTitles');
        var shortenTitles = shortenCb ? shortenCb.checked : false;
        closeDownloadPdfModal();
        window.IDCardApp.downloadPdf(pendingPdfCardIds, templateId, fontMode, shortenTitles);
    });

    // Close on backdrop click removed  modal does not close on outside click
    downloadPdfModal = document.getElementById('downloadPdfModal');
}

// ==========================================
// MODAL INITIALIZATION (keyboard handlers)
// ==========================================

function initDownloadModals() {
    // Initialize modal references
    downloadPdfModal = document.getElementById('downloadPdfModal');
    downloadXlsxModal = document.getElementById('downloadXlsxModal');
    downloadImgModal = document.getElementById('downloadImgModal');

    // Add keyboard escape handler for all download modals
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (downloadPdfModal && downloadPdfModal.style.display === 'flex') {
                closeDownloadPdfModal();
            }
            if (downloadXlsxModal && downloadXlsxModal.style.display === 'flex') {
                closeDownloadXlsxModal();
            }
            if (downloadImgModal && downloadImgModal.style.display === 'flex') {
                closeDownloadImgModal();
            }
            const docxModal = document.getElementById('downloadDocxModal');
            if (docxModal && docxModal.style.display === 'flex') {
                closeDownloadDocxModal();
            }
        }
    });
}

// Expose on IDCardApp
window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.initDownloadModals = initDownloadModals;
window.IDCardApp.initDownloadImagesHandlers = initDownloadImagesHandlers;
window.IDCardApp.initDownloadDocxHandlers = initDownloadDocxHandlers;
window.IDCardApp.initDownloadXlsxHandlers = initDownloadXlsxHandlers;
window.IDCardApp.initDownloadPdfHandlers = initDownloadPdfHandlers;
window.IDCardApp.initReprintPickerHandlers = initReprintPickerHandlers;

})();
