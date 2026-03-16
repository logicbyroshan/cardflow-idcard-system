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
    var pickerTable = pickerTableHead ? pickerTableHead.closest('table') : null;
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
    var sourceHeaderWidths = {};
    var selectedIds = new Set();
    var lastQuery = '';
    var pendingEditIds = [];
    var confirmEditing = false;
    var confirmEditingCardId = null;
    var searchTimer = null;
    var columnSizes = null;

    function esc(text) {
        var div = document.createElement('div');
        div.textContent = String(text || '');
        return div.innerHTML;
    }

    function normalizeFieldKey(value) {
        return String(value || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
    }

    function getField(item, keys) {
        var fields = item && item.ordered_fields ? item.ordered_fields : [];
        var keyMap = {};
        keys.forEach(function(k) {
            keyMap[normalizeFieldKey(k)] = true;
        });
        var i;
        for (i = 0; i < fields.length; i += 1) {
            var name = normalizeFieldKey(fields[i].name || '');
            if (keyMap[name]) return fields[i].value || '';
        }
        return '';
    }

    function getFieldByName(item, fieldName) {
        var fields = item && item.ordered_fields ? item.ordered_fields : [];
        var key = normalizeFieldKey(fieldName || '');
        var i;
        for (i = 0; i < fields.length; i += 1) {
            var name = normalizeFieldKey(fields[i].name || '');
            if (name === key) return fields[i].value || '';
        }
        return '';
    }

    function getCardById(cardId) {
        return rows.find(function(r) {
            return String(r.card_id) === String(cardId);
        }) || null;
    }

    function resolveFields(items) {
        var headerFields = [];
        var cardsBody = document.getElementById('cardsTableBody');
        var sourceTable = cardsBody ? cardsBody.closest('table') : document.getElementById('data-table');
        sourceHeaderWidths = {};
        if (sourceTable) {
            sourceTable.querySelectorAll('thead th[data-field-name]').forEach(function(th) {
            var name = (th.getAttribute('data-field-name') || '').trim();
            if (!name) return;
            var measured = Math.round(th.getBoundingClientRect().width || th.offsetWidth || 0);
            if (measured > 0) {
                sourceHeaderWidths[String(name).toUpperCase()] = measured;
            }
            headerFields.push({
                name: name,
                type: (th.getAttribute('data-field-type') || 'text').trim(),
                label: (th.textContent || name).trim().replace(/\s+/g, ' '),
            });
            });
        }

        if (headerFields.length > 0) {
            resolvedFields = headerFields;
            return;
        }

        if (Array.isArray(tableFields) && tableFields.length > 0) {
            resolvedFields = tableFields.map(function(f) {
                return { name: f.name, type: f.type || 'text', label: f.name };
            });
            return;
        }
        var first = (items || []).find(function(it) {
            return Array.isArray(it.ordered_fields) && it.ordered_fields.length > 0;
        });
        if (first) {
            resolvedFields = first.ordered_fields.map(function(f) {
                return { name: f.name, type: f.type || 'text', label: f.name };
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

    function toCellText(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/\s+/g, ' ').trim();
    }

    function computeColumnSizes(items) {
        var size = {
            checkbox: { preferred: 34, min: 34, max: 34 },
            sr: { preferred: 40, min: 38, max: 42 },
            status: { preferred: 88, min: 78, max: 110 },
            fields: []
        };
        var sample = Array.isArray(items) ? items.slice(0, 160) : [];

        resolvedFields.forEach(function(field) {
            var isImg = isImageFieldLocal(field.type, field.name);
            if (isImg) {
                size.fields.push({ preferred: 50, min: 44, max: 56, isImage: true });
                return;
            }

            var label = toCellText(field.label || field.name);
            var best = label.length;
            sample.forEach(function(item) {
                var text = toCellText(getFieldByName(item, field.name));
                if (!text) return;
                if (text.length > best) best = text.length;
            });

            var nameLower = String(field.name || '').toLowerCase();
            var isAddressLike = /address|addr|location/.test(nameLower);
            var isNameLike = /name/.test(nameLower);
            var isPhoneLike = /phone|mobile|contact|whatsapp|tel|mob/.test(nameLower);
            var sourceWidth = sourceHeaderWidths[String(field.name || '').toUpperCase()] || 0;

            var width = Math.min(320, Math.max(78, Math.round(best * 7.1) + 20));
            if (sourceWidth > 0) {
                width = Math.max(60, Math.min(360, sourceWidth));
            }
            var minWidth = 68;
            var maxWidth = 320;
            if (isAddressLike) {
                minWidth = 110;
                maxWidth = 360;
                width = Math.min(maxWidth, Math.max(140, width));
            }
            if (isNameLike) {
                minWidth = Math.max(minWidth, 95);
                maxWidth = Math.min(maxWidth, 260);
                width = Math.min(260, Math.max(120, width));
            }
            if (isPhoneLike) {
                minWidth = Math.max(minWidth, 94);
                maxWidth = Math.min(maxWidth, 190);
                width = Math.min(190, Math.max(112, width));
            }

            size.fields.push({ preferred: width, min: minWidth, max: maxWidth, isImage: false });
        });

        return size;
    }

    function _fitColumnWidthsToContainer(containerWidth) {
        var cols = [];

        cols.push({ key: 'checkbox', min: columnSizes.checkbox.min, max: columnSizes.checkbox.max, preferred: columnSizes.checkbox.preferred, growWeight: 0, shrinkWeight: 0 });
        cols.push({ key: 'sr', min: columnSizes.sr.min, max: columnSizes.sr.max, preferred: columnSizes.sr.preferred, growWeight: 0, shrinkWeight: 0 });

        columnSizes.fields.forEach(function(meta, index) {
            cols.push({
                key: 'field-' + index,
                min: meta.min,
                max: meta.max,
                preferred: meta.preferred,
                growWeight: meta.isImage ? 0 : Math.max(meta.preferred, 70),
                shrinkWeight: meta.isImage ? 0.3 : 1
            });
        });

        cols.push({ key: 'status', min: columnSizes.status.min, max: columnSizes.status.max, preferred: columnSizes.status.preferred, growWeight: 0.25, shrinkWeight: 0.5 });

        var minTotal = cols.reduce(function(sum, c) { return sum + c.min; }, 0);
        var prefTotal = cols.reduce(function(sum, c) { return sum + c.preferred; }, 0);
        var target = Math.max(0, Math.floor(containerWidth || 0));

        var widths = cols.map(function(c) { return c.preferred; });

        if (target <= 0) {
            return { widths: widths, overflow: true, minTotal: minTotal, finalTotal: prefTotal };
        }

        if (prefTotal < target) {
            var extra = target - prefTotal;
            var growTotal = cols.reduce(function(sum, c) {
                return sum + ((c.max > c.preferred) ? c.growWeight : 0);
            }, 0);
            if (growTotal > 0) {
                cols.forEach(function(c, i) {
                    if (c.max <= c.preferred || c.growWeight <= 0) return;
                    var inc = (extra * c.growWeight) / growTotal;
                    widths[i] = Math.min(c.max, c.preferred + inc);
                });
            }
        } else if (prefTotal > target) {
            var deficit = prefTotal - target;
            var shrinkTotal = cols.reduce(function(sum, c) {
                return sum + ((c.preferred > c.min) ? c.shrinkWeight : 0);
            }, 0);
            if (shrinkTotal > 0) {
                cols.forEach(function(c, i) {
                    if (c.preferred <= c.min || c.shrinkWeight <= 0) return;
                    var dec = (deficit * c.shrinkWeight) / shrinkTotal;
                    widths[i] = Math.max(c.min, c.preferred - dec);
                });
            }
        }

        widths = widths.map(function(v) { return Math.round(v); });
        var finalTotal = widths.reduce(function(sum, w) { return sum + w; }, 0);

        // If we still overflow and we are above minima, shrink from widest columns first.
        if (finalTotal > target && target >= minTotal) {
            var over = finalTotal - target;
            var order = cols.map(function(c, i) { return { i: i, flex: widths[i] - c.min }; })
                .filter(function(it) { return it.flex > 0; })
                .sort(function(a, b) { return b.flex - a.flex; });

            for (var oi = 0; oi < order.length && over > 0; oi += 1) {
                var idx = order[oi].i;
                var reducible = widths[idx] - cols[idx].min;
                var cut = Math.min(reducible, over);
                widths[idx] -= cut;
                over -= cut;
            }
            finalTotal = widths.reduce(function(sum, w) { return sum + w; }, 0);
        }

        return {
            widths: widths,
            overflow: finalTotal > target && minTotal > target,
            minTotal: minTotal,
            finalTotal: finalTotal
        };
    }

    function applyTableColumnWidths() {
        if (!pickerTable || !columnSizes) return;
        var wrap = pickerTable.closest('.reprint-picker-table-wrap') || pickerTable.parentElement;
        var wrapWidth = wrap ? Math.floor(wrap.clientWidth || 0) : 0;
        var fit = _fitColumnWidthsToContainer(wrapWidth);
        var widths = fit.widths;

        var colgroupHtml = '<colgroup>';
        var totalWidth = 0;
        var cursor = 0;

        colgroupHtml += '<col style="width:' + widths[cursor] + 'px">';
        totalWidth += widths[cursor];
        cursor += 1;

        colgroupHtml += '<col style="width:' + widths[cursor] + 'px">';
        totalWidth += widths[cursor];
        cursor += 1;

        columnSizes.fields.forEach(function() {
            colgroupHtml += '<col style="width:' + widths[cursor] + 'px">';
            totalWidth += widths[cursor];
            cursor += 1;
        });

        colgroupHtml += '<col style="width:' + widths[cursor] + 'px">';
        totalWidth += widths[cursor];
        colgroupHtml += '</colgroup>';

        var oldColgroup = pickerTable.querySelector('colgroup');
        if (oldColgroup) oldColgroup.remove();
        pickerTable.insertAdjacentHTML('afterbegin', colgroupHtml);
        pickerTable.style.minWidth = fit.overflow ? Math.max(fit.minTotal, totalWidth) + 'px' : '100%';
        pickerTable.style.width = fit.overflow ? Math.max(fit.minTotal, totalWidth) + 'px' : '100%';
    }

    function buildTableHead() {
        if (!pickerTableHead) return;
        var html = '<tr>';
        html += '<th class="center-cell checkbox-col"></th>';
        html += '<th class="center-cell sr-col">Sr</th>';
        resolvedFields.forEach(function(field, idx) {
            var isImg = isImageFieldLocal(field.type, field.name);
            if (isImg) {
                html += '<th class="center-cell image-col">' + esc(field.label || field.name) + '</th>';
            } else {
                html += '<th class="dynamic-col">' + esc(field.label || field.name) + '</th>';
            }
        });
        html += '<th class="center-cell">Status</th>';
        html += '</tr>';
        pickerTableHead.innerHTML = html;
        applyTableColumnWidths();
        pickerSelectAll = document.getElementById('reprintPickerSelectAll');
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

    function getPhotoPath(item) {
        return getField(item, ['PHOTO', 'IMAGE', 'PICTURE', 'PIC', 'STUDENT PHOTO']) || '';
    }

    function getPreviewRows(item) {
        return [
            { label: 'Name', value: getStudentName(item) },
            { label: 'Class', value: getClassName(item) },
            { label: 'Section', value: getSectionName(item) },
            { label: 'Roll No', value: getField(item, ['ROLL NO', 'ROLL', 'ROLL NUMBER', 'ROLL_NO']) || '-' },
            { label: 'Admission No', value: getField(item, ['ADMISSION NO', 'ADMISSION NUMBER', 'ADM NO', 'ADMISSION_NO', 'SCH NO', 'SCHOLAR NO']) || '-' },
            { label: 'DOB', value: getField(item, ['DOB', 'DATE OF BIRTH', 'BIRTH DATE']) || '-' },
            { label: 'Father Name', value: getField(item, ['FATHER NAME', "FATHER'S NAME", 'FATHER_NAME', 'FATHER']) || '-' },
            { label: 'Father Contact', value: getField(item, ['FATHER CONTACT', "FATHER'S CONTACT", 'FATHER MOBILE', "FATHER'S MOBILE", 'FATHER PHONE', 'FATHER CONTACT NO', 'FATHER_PHONE']) || '-' },
            { label: 'Mother Name', value: getField(item, ['MOTHER NAME', "MOTHER'S NAME", 'MOTHER_NAME', 'MOTHER']) || '-' },
            { label: 'Mother Contact', value: getField(item, ['MOTHER CONTACT', "MOTHER'S CONTACT", 'MOTHER MOBILE', "MOTHER'S MOBILE", 'MOTHER PHONE', 'MOTHER CONTACT NO', 'MOTHER_PHONE']) || '-' }
        ];
    }

    function buildPreviewHtml(item) {
        if (!item) return '';
        var photoPath = String(getPhotoPath(item) || '');
        var photoHtml = '';
        if (photoPath && photoPath !== 'NOT_FOUND' && photoPath.indexOf('PENDING:') !== 0) {
            photoHtml = '<img src="/media/' + esc(photoPath) + '" alt="Student photo" loading="lazy">';
        } else {
            photoHtml = '<div class="reprint-preview-photo-placeholder"><i class="fa-solid fa-user"></i></div>';
        }

        var metaRows = getPreviewRows(item);
        var metaHtml = '';
        metaRows.forEach(function(row) {
            metaHtml += '<div class="reprint-preview-meta-item">'
                + '<span class="reprint-preview-meta-label">' + esc(row.label) + '</span>'
                + '<span class="reprint-preview-meta-value">' + esc(row.value || '-') + '</span>'
                + '</div>';
        });

        return '<div class="reprint-preview-card">'
            + '<div class="reprint-preview-photo">' + photoHtml + '</div>'
            + '<div class="reprint-preview-meta">' + metaHtml + '</div>'
            + '</div>';
    }

    function renderConfirmPreview(item) {
        if (!confirmPreview) return;
        if (!item) {
            confirmPreview.style.display = 'none';
            confirmPreview.innerHTML = '';
            return;
        }
        confirmPreview.style.display = 'block';
        confirmPreview.innerHTML = buildPreviewHtml(item);
    }

    function setConfirmEditingState(isEditing) {
        var sideModalOverlay = document.getElementById('sideModalOverlay');
        confirmEditing = !!isEditing;
        if (confirmEditing) {
            confirmModal.classList.add('is-editing');
            if (confirmClose) confirmClose.disabled = true;
            if (confirmCancel) confirmCancel.disabled = true;
            if (confirmEditBtn) confirmEditBtn.disabled = true;
            if (confirmSubmitBtn) confirmSubmitBtn.disabled = true;
            if (sideModalOverlay) sideModalOverlay.classList.add('reprint-edit-layer');
        } else {
            confirmModal.classList.remove('is-editing');
            if (confirmClose) confirmClose.disabled = false;
            if (confirmCancel) confirmCancel.disabled = false;
            if (confirmEditBtn) {
                confirmEditBtn.disabled = pendingEditIds.length !== 1;
                confirmEditBtn.title = pendingEditIds.length === 1
                    ? 'Edit selected card before requesting reprint'
                    : 'Want to Edit is available for single selection only';
            }
            if (confirmSubmitBtn) {
                confirmSubmitBtn.disabled = false;
                confirmSubmitBtn.title = 'Continue without editing and request reprint';
            }
            if (sideModalOverlay) sideModalOverlay.classList.remove('reprint-edit-layer');
        }
    }

    function updateSelectionUi() {
        var count = selectedIds.size;
        if (pickerSelectedInfo) pickerSelectedInfo.textContent = count + ' selected';
        if (pickerRequestBtn) pickerRequestBtn.disabled = count !== 1;
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
        columnSizes = computeColumnSizes(rows);
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
            html += '<td class="center-cell checkbox-col"><input type="checkbox" class="reprint-picker-row" data-card-id="' + esc(id) + '"' + checked + '></td>';
            html += '<td class="center-cell sr-col">' + (idx + 1) + '</td>';
            resolvedFields.forEach(function(field) {
                var rawVal = getFieldByName(item, field.name);
                if (isImageFieldLocal(field.type, field.name)) {
                    var value = String(rawVal || '');
                    if (value && value !== 'NOT_FOUND' && value.indexOf('PENDING:') !== 0) {
                        var thumbPath = value.replace(/\/([^\/]+)$/, '/thumbnails/$1');
                        html += '<td class="center-cell photo-cell image-cell"><img class="table-image" src="/media/' + esc(thumbPath) + '" alt="' + esc(field.name) + '" loading="lazy" onerror="this.onerror=null;this.src=\'/media/' + esc(value) + '\'" /></td>';
                    } else {
                        html += '<td class="center-cell photo-cell image-cell">-</td>';
                    }
                } else {
                    html += '<td class="dynamic-field">' + esc(rawVal || '-') + '</td>';
                }
            });
            html += '<td class="center-cell"><span class="status-badge status-' + esc(item.status || 'download') + '">' + esc(item.status_display || 'Download') + '</span></td>';
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
        var item = getCardById(cardId);
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
        if (ids.length !== 1) {
            if (typeof showToast === 'function') showToast('Please select exactly one card for reprint', 'warning');
            return;
        }
        pendingEditIds = ids.slice();
        confirmEditingCardId = ids[0];
        setConfirmEditingState(false);
        if (confirmCount) confirmCount.textContent = String(ids.length);
        if (confirmEditBtn) {
            confirmEditBtn.disabled = false;
            confirmEditBtn.title = 'Edit selected card before requesting reprint';
        }
        if (confirmSubmitBtn) {
            confirmSubmitBtn.disabled = false;
            confirmSubmitBtn.title = 'Continue without editing and request reprint';
        }
        renderConfirmPreview(getCardById(ids[0]));
        confirmModal.style.display = 'flex';
    }

    function closeConfirm() {
        if (confirmEditing) return;
        setConfirmEditingState(false);
        confirmEditingCardId = null;
        confirmModal.style.display = 'none';
    }

    function submitReprintRequest() {
        var ids = pendingEditIds.length ? pendingEditIds.slice() : selectedCardIdsAsNumbers();
        if (!ids.length) return;
        ApiClient.post(endpoints.requestCreate, { card_ids: ids })
            .then(function(data) {
                if (data && data.status === 'ok') {
                    if (typeof showToast === 'function') showToast(data.message || 'Successfully sent for reprint', 'success');
                    selectedIds.clear();
                    closeConfirm();
                    fetchList(lastQuery);
                } else {
                    if (typeof showToast === 'function') showToast((data && data.message) || 'Could not create reprint request', 'error');
                }
            })
            .catch(function() {
                if (typeof showToast === 'function') showToast('Could not create reprint request', 'error');
            });
    }

    triggerBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
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
        if (cb.checked) {
            selectedIds.clear();
            selectedIds.add(id);
            pickerTableBody.querySelectorAll('.reprint-picker-row').forEach(function(rowCb) {
                rowCb.checked = rowCb === cb;
            });
        } else {
            selectedIds.delete(id);
        }
        updateSelectionUi();
    });

    if (pickerRequestBtn) pickerRequestBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        openConfirm();
    });

    confirmClose.addEventListener('click', closeConfirm);
    confirmCancel.addEventListener('click', closeConfirm);
    confirmModal.addEventListener('click', function(e) {
        if (e.target === confirmModal && !confirmEditing) closeConfirm();
    });

    if (confirmSubmitBtn) {
        confirmSubmitBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            submitReprintRequest();
        });
    }

    if (confirmEditBtn) {
        confirmEditBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (pendingEditIds.length !== 1) {
                if (typeof showToast === 'function') showToast('Select one card to edit', 'warning');
                return;
            }
            var cardId = pendingEditIds[0];
            confirmEditingCardId = cardId;
            setConfirmEditingState(true);
            if (typeof window.IDCardApp.fetchCardAndOpenModal === 'function') {
                window.IDCardApp.fetchCardAndOpenModal('edit', cardId);
            } else {
                setConfirmEditingState(false);
            }
        });
    }

    var sideModalOverlay = document.getElementById('sideModalOverlay');
    if (sideModalOverlay) {
        var sideModalObserver = new MutationObserver(function() {
            if (!confirmEditing) return;
            var stillOpen = sideModalOverlay.classList.contains('active');
            if (!stillOpen) {
                setConfirmEditingState(false);
                if (confirmModal) confirmModal.style.display = 'flex';
            }
        });
        sideModalObserver.observe(sideModalOverlay, { attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('idcard:card-updated', function(e) {
        var detail = e && e.detail ? e.detail : {};
        var updatedId = Number(detail.cardId);
        if (!Number.isFinite(updatedId)) return;
        if (pendingEditIds.length !== 1 || pendingEditIds[0] !== updatedId) return;

        fetchList(lastQuery);
        var updatedCard = detail.card || null;
        var previewItem = null;
        var previewText = '';
        if (updatedCard && Array.isArray(updatedCard.ordered_fields)) {
            previewText = 'Preview: ' + getStudentName(updatedCard) + ' | Class ' + getClassName(updatedCard) + ' | Section ' + getSectionName(updatedCard);
            previewItem = updatedCard;
        } else {
            previewText = formatPreviewText(updatedId);
            previewItem = getCardById(updatedId);
        }
        if (pickerPreview) {
            pickerPreview.textContent = previewText || 'Card updated successfully. Please confirm reprint.';
            pickerPreview.style.display = 'block';
        }
        renderConfirmPreview(previewItem);
        setConfirmEditingState(false);
        confirmEditingCardId = null;
        confirmModal.style.display = 'flex';
    });

    window.addEventListener('resize', function() {
        if (!pickerModal || pickerModal.style.display !== 'flex') return;
        applyTableColumnWidths();
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
