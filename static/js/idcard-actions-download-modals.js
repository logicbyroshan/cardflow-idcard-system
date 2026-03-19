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
let _dlAvailableRenameImageKeys = {};

// Modal DOM references (set in initDownloadModals)
let downloadPdfModal = null;
let downloadXlsxModal = null;
let downloadImgModal = null;

function _dlNormalizeFieldKey(value) {
    return String(value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

function _dlLooksImageField(field) {
    const type = String((field && field.type) || '').toLowerCase();
    const name = String((field && field.name) || '').toLowerCase();
    if (type === 'image' || type === 'photo' || type === 'file' || type === 'signature' || type === 'father_photo' || type === 'mother_photo' || type === 'qr_code' || type === 'barcode') {
        return true;
    }
    return name.indexOf('photo') !== -1 ||
           name.indexOf('image') !== -1 ||
           name.indexOf('picture') !== -1 ||
           name.indexOf('signature') !== -1 ||
           name.indexOf('barcode') !== -1 ||
           name.indexOf('qr') !== -1;
}

function _dlGetTextFields() {
    const fields = Array.isArray(window.TABLE_FIELDS) ? window.TABLE_FIELDS : [];
    return fields.filter(function(field) {
        const name = String((field && field.name) || '').trim();
        if (!name) return false;
        return !_dlLooksImageField(field);
    });
}

function _dlFindFieldNameByHint(textFields, hints) {
    const keys = (hints || []).map(_dlNormalizeFieldKey);
    let i;
    for (i = 0; i < textFields.length; i += 1) {
        const candidate = textFields[i];
        const normalized = _dlNormalizeFieldKey(candidate.name);
        if (!normalized) continue;
        if (keys.some(function(key) { return normalized.indexOf(key) !== -1; })) {
            return candidate.name;
        }
    }
    return '';
}

function _dlPopulateRenameSelect(selectEl, textFields, preferredName) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'Do not rename';
    selectEl.appendChild(noneOpt);

    textFields.forEach(function(field) {
        const option = document.createElement('option');
        option.value = field.name;
        option.textContent = field.name;
        selectEl.appendChild(option);
    });

    if (preferredName && textFields.some(function(field) { return field.name === preferredName; })) {
        selectEl.value = preferredName;
    } else {
        selectEl.value = '';
    }
}

function _dlResolveRenameableImageKey(field) {
    const typeNorm = _dlNormalizeFieldKey((field && field.type) || '');
    const nameRaw = String((field && field.name) || '').toUpperCase();
    const nameNorm = _dlNormalizeFieldKey(nameRaw);

    if (typeNorm === 'MOTHERPHOTO' || (nameRaw.indexOf('MOTHER') !== -1 && nameRaw.indexOf('PHOTO') !== -1)) {
        return 'MOTHER_PHOTO';
    }
    if (typeNorm === 'FATHERPHOTO' || (nameRaw.indexOf('FATHER') !== -1 && nameRaw.indexOf('PHOTO') !== -1)) {
        return 'FATHER_PHOTO';
    }
    if (typeNorm === 'PHOTO' || typeNorm === 'IMAGE' || nameNorm.indexOf('PHOTO') !== -1) {
        return 'PHOTO';
    }
    return '';
}

function _dlGetAvailableRenameImageKeys() {
    const fields = Array.isArray(window.TABLE_FIELDS) ? window.TABLE_FIELDS : [];
    const available = {
        PHOTO: false,
        FATHER_PHOTO: false,
        MOTHER_PHOTO: false,
    };

    fields.forEach(function(field) {
        if (!_dlLooksImageField(field)) return;
        const key = _dlResolveRenameableImageKey(field);
        if (key && Object.prototype.hasOwnProperty.call(available, key)) {
            available[key] = true;
        }
    });

    return available;
}

function _dlInitializeImageRenamePanel() {
    const toggleEl = document.getElementById('downloadImgRenameToggle');
    const panelEl = document.getElementById('downloadImgRenamePanel');
    const photoSelect = document.getElementById('downloadImgMapPhoto');
    const fatherSelect = document.getElementById('downloadImgMapFather');
    const motherSelect = document.getElementById('downloadImgMapMother');
    const photoRow = document.getElementById('downloadImgMapPhotoRow');
    const fatherRow = document.getElementById('downloadImgMapFatherRow');
    const motherRow = document.getElementById('downloadImgMapMotherRow');

    if (!toggleEl || !panelEl || !photoSelect || !fatherSelect || !motherSelect) return;

    _dlAvailableRenameImageKeys = _dlGetAvailableRenameImageKeys();

    const hasAnyRenameableImage = !!(_dlAvailableRenameImageKeys.PHOTO || _dlAvailableRenameImageKeys.FATHER_PHOTO || _dlAvailableRenameImageKeys.MOTHER_PHOTO);

    if (photoRow) photoRow.style.display = _dlAvailableRenameImageKeys.PHOTO ? '' : 'none';
    if (fatherRow) fatherRow.style.display = _dlAvailableRenameImageKeys.FATHER_PHOTO ? '' : 'none';
    if (motherRow) motherRow.style.display = _dlAvailableRenameImageKeys.MOTHER_PHOTO ? '' : 'none';

    toggleEl.disabled = !hasAnyRenameableImage;
    if (!hasAnyRenameableImage) {
        toggleEl.checked = false;
        panelEl.style.display = 'none';
        return;
    }

    const textFields = _dlGetTextFields();
    const nameField = _dlFindFieldNameByHint(textFields, ['studentname', 'name', 'empname']);
    const fatherNameField = _dlFindFieldNameByHint(textFields, ['fathername', 'fname', 'father']);
    const motherNameField = _dlFindFieldNameByHint(textFields, ['mothername', 'mname', 'mother']);

    if (_dlAvailableRenameImageKeys.PHOTO) {
        _dlPopulateRenameSelect(photoSelect, textFields, nameField);
    } else {
        photoSelect.innerHTML = '';
    }
    if (_dlAvailableRenameImageKeys.FATHER_PHOTO) {
        _dlPopulateRenameSelect(fatherSelect, textFields, fatherNameField);
    } else {
        fatherSelect.innerHTML = '';
    }
    if (_dlAvailableRenameImageKeys.MOTHER_PHOTO) {
        _dlPopulateRenameSelect(motherSelect, textFields, motherNameField);
    } else {
        motherSelect.innerHTML = '';
    }

    panelEl.style.display = toggleEl.checked ? 'block' : 'none';
}

function _dlResetImageRenameControls() {
    const toggleEl = document.getElementById('downloadImgRenameToggle');
    const panelEl = document.getElementById('downloadImgRenamePanel');
    if (toggleEl) toggleEl.checked = false;
    if (panelEl) panelEl.style.display = 'none';
    _dlInitializeImageRenamePanel();
}

function _dlGetImageRenameOptionsFromModal() {
    const toggleEl = document.getElementById('downloadImgRenameToggle');
    const photoSelect = document.getElementById('downloadImgMapPhoto');
    const fatherSelect = document.getElementById('downloadImgMapFather');
    const motherSelect = document.getElementById('downloadImgMapMother');

    if (!toggleEl || !toggleEl.checked) return null;

    const imageNameFields = {};
    const photoField = photoSelect ? String(photoSelect.value || '').trim() : '';
    const fatherField = fatherSelect ? String(fatherSelect.value || '').trim() : '';
    const motherField = motherSelect ? String(motherSelect.value || '').trim() : '';

    if (_dlAvailableRenameImageKeys.PHOTO && photoField) imageNameFields.PHOTO = photoField;
    if (_dlAvailableRenameImageKeys.FATHER_PHOTO && fatherField) imageNameFields.FATHER_PHOTO = fatherField;
    if (_dlAvailableRenameImageKeys.MOTHER_PHOTO && motherField) imageNameFields.MOTHER_PHOTO = motherField;

    if (!Object.keys(imageNameFields).length) return null;

    return {
        enabled: true,
        image_name_fields: imageNameFields
    };
}

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
    var imageUploadInput = document.getElementById('reprintPickerImageUploadInput');

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
    var inlineEditMode = false;
    var inlineOriginalFieldData = {};
    var inlineDirtyCount = 0;
    var inlineSaveInFlight = false;
    var searchTimer = null;
    var columnSizes = null;

    function refreshReprintStepCounts() {
        if (!endpoints.stepCounts) return;
        ApiClient.get(endpoints.stepCounts)
            .then(function(data) {
                if (!data || data.status !== 'ok') return;
                var reqCount = document.getElementById('downloadRequestCount');
                var confCount = document.getElementById('downloadConfirmedCount');
                if (reqCount) reqCount.textContent = String(data.request_list || 0);
                if (confCount) confCount.textContent = String(data.confirmed || 0);
            })
            .catch(function() {});
    }

    function esc(text) {
        var div = document.createElement('div');
        div.textContent = String(text || '');
        return div.innerHTML;
    }

    function normalizeMediaPath(rawPath) {
        var value = String(rawPath || '').trim();
        if (!value) return '';
        if (value === 'NOT_FOUND' || value.indexOf('PENDING:') === 0) return value;

        // Accept full URL, absolute /media path, or plain relative media path.
        if (/^https?:\/\//i.test(value)) {
            try {
                var parsed = new URL(value);
                value = parsed.pathname || value;
            } catch (_e) {}
        }

        value = value.replace(/\\/g, '/');

        // If path contains /media/ anywhere (including absolute FS paths), keep only the media-relative part.
        var lower = value.toLowerCase();
        var marker = '/media/';
        var markerIndex = lower.indexOf(marker);
        if (markerIndex !== -1) {
            value = value.slice(markerIndex + marker.length);
        }

        value = value.replace(/^\/+/, '');
        if (value.toLowerCase().indexOf('media/') === 0) {
            value = value.slice(6);
        }
        return value;
    }

    function toMediaUrl(rawPath) {
        var normalized = normalizeMediaPath(rawPath);
        if (!normalized || normalized === 'NOT_FOUND' || normalized.indexOf('PENDING:') === 0) return '';
        return '/media/' + normalized;
    }

    function toThumbnailPath(rawPath) {
        var normalized = normalizeMediaPath(rawPath);
        if (!normalized || normalized === 'NOT_FOUND' || normalized.indexOf('PENDING:') === 0) return '';
        return normalized.replace(/\/([^\/]+)$/, '/thumbnails/$1');
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
        if (t === 'image' || t === 'photo' || t === 'file') return true;
        if (n.indexOf('designation') !== -1) return false;
        if (t.indexOf('image') !== -1 || t.indexOf('photo') !== -1 || t.indexOf('file') !== -1 || t.indexOf('upload') !== -1) return true;
        return n.indexOf('photo') !== -1 ||
               n.indexOf('image') !== -1 ||
               n.indexOf('picture') !== -1 ||
               n.indexOf('pic') !== -1 ||
               n.indexOf('img') !== -1 ||
               n.indexOf('signature') !== -1 ||
               n.indexOf('barcode') !== -1 ||
               n.indexOf('qr') !== -1;
    }

    function isKnownImageFieldName(fieldName) {
        var normalized = normalizeFieldKey(fieldName || '');
        if (!normalized) return false;
        var i;
        for (i = 0; i < resolvedFields.length; i += 1) {
            var f = resolvedFields[i] || {};
            if (normalizeFieldKey(f.name || '') === normalized) {
                return isImageFieldLocal(f.type, f.name);
            }
        }
        return isImageFieldLocal('', fieldName);
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

    function getImageRows(item) {
        var ordered = Array.isArray(item && item.ordered_fields) ? item.ordered_fields : [];
        if (!ordered.length) return [];
        return ordered
            .filter(function(field) {
                return isImageFieldLocal(field && field.type, field && field.name);
            })
            .map(function(field) {
                return {
                    key: field.name || '',
                    label: field.label || field.name || 'Image',
                    value: field.value || ''
                };
            })
            .filter(function(row) {
                return String(row.key || '').trim().length > 0;
            });
    }

    function getPhotoPath(item) {
        var imageRows = getImageRows(item);
        if (!imageRows.length) {
            return getField(item, ['PHOTO', 'IMAGE', 'PICTURE', 'PIC', 'STUDENT PHOTO']) || '';
        }
        var preferred = imageRows.find(function(row) {
            var k = normalizeFieldKey(row.key);
            return k === 'PHOTO' || k === 'STUDENTPHOTO' || k === 'IMAGE' || k === 'PICTURE' || k === 'PIC';
        }) || imageRows[0];
        return preferred ? (preferred.value || '') : '';
    }

    function buildImageCell(fieldName, fieldLabel, value, isEditing, isMain) {
        var val = String(value || '');
        var imageUrl = toMediaUrl(val);
        var canShow = !!imageUrl;
        var cls = isMain ? 'reprint-preview-photo' : 'reprint-preview-extra-image';
        var html = '<div class="' + cls + '" data-image-field="' + esc(fieldName) + '">';
        if (canShow) {
            html += '<img src="' + esc(imageUrl) + '" alt="' + esc(fieldLabel || fieldName) + '" loading="lazy">';
        } else {
            html += '<div class="reprint-preview-photo-placeholder"><i class="fa-solid fa-image"></i></div>';
        }
        if (isEditing) {
            html += '<div class="reprint-preview-image-actions">'
                + '<button type="button" class="reprint-preview-image-btn upload" data-img-action="upload" data-field-name="' + esc(fieldName) + '" title="Upload image"><i class="fa-solid fa-upload"></i></button>'
                + '<button type="button" class="reprint-preview-image-btn remove" data-img-action="remove" data-field-name="' + esc(fieldName) + '" title="Remove image"><i class="fa-solid fa-trash"></i></button>'
                + '</div>';
        }
        html += '</div>';
        return html;
    }

    function getPreviewRows(item) {
        var ordered = Array.isArray(item && item.ordered_fields) ? item.ordered_fields : [];
        if (ordered.length) {
            return ordered
                .filter(function(field) {
                    return !isImageFieldLocal(field && field.type, field && field.name);
                })
                .map(function(field) {
                    return {
                        label: field.label || field.name || '-',
                        key: field.name || '',
                        value: field.value || ''
                    };
                })
                .filter(function(row) {
                    return String(row.key || '').trim().length > 0;
                });
        }

        var detailRows = [];
        resolvedFields.forEach(function(field) {
            if (isImageFieldLocal(field.type, field.name)) return;
            detailRows.push({
                label: field.label || field.name,
                key: field.name,
                value: getFieldByName(item, field.name) || ''
            });
        });

        if (!detailRows.length) {
            detailRows.push({ label: 'Name', key: 'NAME', value: getStudentName(item) || '' });
            detailRows.push({ label: 'Class', key: 'CLASS', value: getClassName(item) || '' });
            detailRows.push({ label: 'Section', key: 'SECTION', value: getSectionName(item) || '' });
        }
        return detailRows;
    }

    function buildPreviewHtml(item, isEditing) {
        if (!item) return '';
        var photoPath = String(getPhotoPath(item) || '');
        var imageRows = getImageRows(item);
        var mainImageField = imageRows.find(function(row) {
            return String(row.value || '') === photoPath;
        }) || imageRows[0] || { key: 'PHOTO', label: 'Photo', value: photoPath };
        var extraImages = imageRows.filter(function(row) {
            return normalizeFieldKey(row.key) !== normalizeFieldKey(mainImageField.key);
        });

        var photoHtml = buildImageCell(mainImageField.key, mainImageField.label, mainImageField.value, isEditing, true);
        var extraHtml = '';
        if (extraImages.length) {
            extraHtml = '<div class="reprint-preview-extra-images">';
            extraImages.forEach(function(img) {
                extraHtml += buildImageCell(img.key, img.label, img.value, isEditing, false);
            });
            extraHtml += '</div>';
        }

        var metaRows = getPreviewRows(item);
        var metaHtml = '';
        metaRows.forEach(function(row) {
            var valueText = String(row.value || '').trim();
            var displayValue = valueText || 'Not provided';
            var valueNode;
            if (isEditing) {
                valueNode = '<input class="reprint-preview-input" type="text" data-field-name="' + esc(row.key || '') + '" data-original-value="' + esc(valueText) + '" value="' + esc(valueText) + '" placeholder="Not provided">';
            } else {
                var emptyClass = valueText ? '' : ' is-empty';
                valueNode = '<span class="reprint-preview-meta-value' + emptyClass + '">' + esc(displayValue) + '</span>';
            }
            metaHtml += '<div class="reprint-preview-meta-item">'
                + '<span class="reprint-preview-meta-label">' + esc(row.label) + '</span>'
                + valueNode
                + '</div>';
        });

        var metaClass = isEditing ? 'reprint-preview-meta edit-grid' : 'reprint-preview-meta';
        return '<div class="reprint-preview-card">'
            + '<div class="reprint-preview-photo-stack">' + photoHtml + extraHtml + '</div>'
            + '<div class="' + metaClass + '">' + metaHtml + '</div>'
            + '</div>';
    }

    function syncCardFromApi(cardId, apiCard) {
        if (!apiCard || !apiCard.field_data) return;
        var card = getCardById(cardId);
        if (!card || !Array.isArray(card.ordered_fields)) return;
        var fd = apiCard.field_data || {};
        var upper = {};
        Object.keys(fd).forEach(function(k) { upper[normalizeFieldKey(k)] = fd[k]; });
        card.ordered_fields.forEach(function(f) {
            var key = normalizeFieldKey(f.name || '');
            if (upper.hasOwnProperty(key)) {
                f.value = upper[key] || '';
            }
        });
    }

    function renderConfirmPreview(item) {
        if (!confirmPreview) return;
        if (!item) {
            confirmPreview.style.display = 'none';
            confirmPreview.innerHTML = '';
            return;
        }
        confirmPreview.style.display = 'block';
        confirmPreview.innerHTML = buildPreviewHtml(item, inlineEditMode);
    }

    function updateDirtyCountLabel() {
        var dirtyCountEl = document.getElementById('reprintPickerDirtyCount');
        if (dirtyCountEl) dirtyCountEl.textContent = String(inlineDirtyCount);
    }

    function resetInlineDirtyState() {
        inlineOriginalFieldData = {};
        inlineDirtyCount = 0;
        updateDirtyCountLabel();
    }

    function initializeInlineOriginalsFromDom() {
        resetInlineDirtyState();
        var inputs = confirmPreview ? confirmPreview.querySelectorAll('.reprint-preview-input[data-field-name]') : [];
        inputs.forEach(function(inputEl) {
            var key = String(inputEl.getAttribute('data-field-name') || '').trim();
            if (!key) return;
            var originalValue = String(inputEl.getAttribute('data-original-value') || '').trim();
            inlineOriginalFieldData[key] = originalValue;
        });
    }

    function recomputeInlineDirtyState() {
        var count = 0;
        var inputs = confirmPreview ? confirmPreview.querySelectorAll('.reprint-preview-input[data-field-name]') : [];
        inputs.forEach(function(inputEl) {
            var key = String(inputEl.getAttribute('data-field-name') || '').trim();
            if (!key) return;
            var currentVal = String(inputEl.value || '').trim();
            var originalVal = String(inlineOriginalFieldData[key] || '').trim();
            var isDirty = currentVal !== originalVal;
            var wrap = inputEl.closest('.reprint-preview-meta-item');
            if (wrap) wrap.classList.toggle('is-dirty', isDirty);
            if (isDirty) count += 1;
        });
        inlineDirtyCount = count;
        updateDirtyCountLabel();
    }

    function setInlineEditMode(enabled) {
        inlineEditMode = !!enabled;
        // Keep confirm modal as the only active editor layer.
        if (inlineEditMode) {
            try {
                if (typeof window.IDCardApp !== 'undefined' && typeof window.IDCardApp.closeCardSideModal === 'function') {
                    window.IDCardApp.closeCardSideModal();
                }
                var sideModalOverlay = document.getElementById('sideModalOverlay');
                if (sideModalOverlay) sideModalOverlay.classList.remove('active');
            } catch (_e) {}
        }
        if (confirmModal) {
            confirmModal.classList.toggle('edit-mode', inlineEditMode);
        }
        if (confirmEditBtn) {
            confirmEditBtn.textContent = inlineEditMode ? 'Cancel Edit' : 'Want to Edit';
            confirmEditBtn.title = inlineEditMode
                ? 'Discard inline edits and return to preview'
                : 'Edit selected card inside this modal';
        }
        if (confirmSubmitBtn) {
            confirmSubmitBtn.textContent = inlineEditMode ? 'Save and Request' : 'Next Without Edit';
            confirmSubmitBtn.title = inlineEditMode
                ? 'Save changes and create reprint request'
                : 'Continue without editing and request reprint';
        }
        var noteEl = document.getElementById('reprintPickerConfirmNote');
        if (noteEl) {
            noteEl.textContent = inlineEditMode
                ? 'Edit details below in this modal, then click Save and Request.'
                : 'Do you want to edit selected card data first, or print as it is?';
        }
        renderConfirmPreview(getCardById(pendingEditIds[0]));
        if (inlineEditMode) {
            initializeInlineOriginalsFromDom();
            recomputeInlineDirtyState();
        } else {
            resetInlineDirtyState();
        }
    }

    function collectInlineFieldData(cardId) {
        var fieldData = {};
        var inputs = confirmPreview ? confirmPreview.querySelectorAll('.reprint-preview-input[data-field-name]') : [];
        inputs.forEach(function(inputEl) {
            var key = String(inputEl.getAttribute('data-field-name') || '').trim();
            if (!key) return;
            if (isKnownImageFieldName(key)) return;
            fieldData[key] = String(inputEl.value || '').trim();
        });

        // Preserve image values from current row state during inline text save.
        // This keeps images stable even if a backend update path treats payload as replace.
        var card = getCardById(cardId);
        var imageRows = getImageRows(card);
        imageRows.forEach(function(img) {
            var key = String(img.key || '').trim();
            if (!key) return;
            fieldData[key] = String(img.value || '').trim();
        });

        return fieldData;
    }

    function updateCardInline(cardId, fieldData) {
        var formData = new FormData();
        formData.append('field_data', JSON.stringify(fieldData || {}));
        return ApiClient.upload('/api/card/' + cardId + '/update/', formData)
            .then(function(data) {
                if (data && data.success) return data.card || null;
                throw new Error((data && data.message) || 'Could not save card changes');
            });
    }

    function uploadImageInline(cardId, fieldName, file) {
        var formData = new FormData();
        formData.append('field_data', JSON.stringify({}));
        formData.append(fieldName, file);
        return ApiClient.upload('/api/card/' + cardId + '/update/', formData)
            .then(function(data) {
                if (data && data.success) return data.card || null;
                throw new Error((data && data.message) || 'Could not upload image');
            });
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
                    var mainUrl = toMediaUrl(value);
                    var thumbUrl = toMediaUrl(toThumbnailPath(value));
                    if (mainUrl) {
                        var firstUrl = thumbUrl || mainUrl;
                        html += '<td class="center-cell photo-cell image-cell"><img class="table-image" src="' + esc(firstUrl) + '" alt="' + esc(field.name) + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + esc(mainUrl) + '\'" /></td>';
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
        ApiClient.get(endpoints.list + '?available_only=1&q=' + encodeURIComponent(q) + '&limit=500')
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

    function openPicker() {
        pickerModal.style.display = 'flex';
        fetchList(lastQuery);
    }

    function maybeAutoOpenFromQuery() {
        try {
            var params = new URLSearchParams(window.location.search || '');
            if (params.get('open_reprint_modal') !== '1') return;
            openPicker();
            params.delete('open_reprint_modal');
            var nextQuery = params.toString();
            var nextUrl = window.location.pathname + (nextQuery ? ('?' + nextQuery) : '');
            window.history.replaceState({}, '', nextUrl);
        } catch (_e) {}
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
        setInlineEditMode(false);
        if (confirmCount) confirmCount.textContent = String(ids.length);
        if (confirmEditBtn) {
            confirmEditBtn.disabled = false;
            confirmEditBtn.title = 'Edit selected card before requesting reprint';
        }
        if (confirmSubmitBtn) {
            confirmSubmitBtn.disabled = false;
            confirmSubmitBtn.title = 'Continue without editing and request reprint';
        }
        try {
            if (typeof window.IDCardApp !== 'undefined' && typeof window.IDCardApp.closeCardSideModal === 'function') {
                window.IDCardApp.closeCardSideModal();
            }
            var sideModalOverlay = document.getElementById('sideModalOverlay');
            if (sideModalOverlay) sideModalOverlay.classList.remove('active');
        } catch (_e) {}
        renderConfirmPreview(getCardById(ids[0]));
        confirmModal.style.display = 'flex';
    }

    function closeConfirm() {
        setInlineEditMode(false);
        confirmModal.style.display = 'none';
    }

    function submitReprintRequest() {
        if (inlineSaveInFlight) return;
        var ids = pendingEditIds.length ? pendingEditIds.slice() : selectedCardIdsAsNumbers();
        if (!ids.length) return;
        var cardId = ids[0];
        var submitPromise;
        if (inlineEditMode) {
            if (inlineDirtyCount > 0) {
                submitPromise = updateCardInline(cardId, collectInlineFieldData(cardId))
                    .then(function() { return ApiClient.post(endpoints.requestCreate, { card_ids: ids }); });
            } else {
                submitPromise = ApiClient.post(endpoints.requestCreate, { card_ids: ids });
            }
        } else {
            submitPromise = ApiClient.post(endpoints.requestCreate, { card_ids: ids });
        }

        inlineSaveInFlight = true;
        if (confirmSubmitBtn) {
            confirmSubmitBtn.disabled = true;
            confirmSubmitBtn.textContent = 'Saving...';
        }

        submitPromise
            .then(function(data) {
                if (data && data.status === 'ok') {
                    if (typeof showToast === 'function') showToast(data.message || 'Successfully sent for reprint', 'success');
                    selectedIds.clear();
                    closeConfirm();
                    fetchList(lastQuery);
                    document.body.dispatchEvent(new CustomEvent('refreshTable', { bubbles: true }));
                    refreshReprintStepCounts();
                } else {
                    if (typeof showToast === 'function') showToast((data && data.message) || 'Could not create reprint request', 'error');
                }
            })
            .catch(function() {
                if (typeof showToast === 'function') showToast('Could not create reprint request', 'error');
            })
            .finally(function() {
                inlineSaveInFlight = false;
                if (confirmSubmitBtn) {
                    confirmSubmitBtn.disabled = false;
                    confirmSubmitBtn.textContent = inlineEditMode ? 'Save and Request' : 'Next Without Edit';
                }
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
        if (e.target === confirmModal) closeConfirm();
    });

    maybeAutoOpenFromQuery();

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
            setInlineEditMode(!inlineEditMode);
        });
    }

    if (confirmPreview) {
        confirmPreview.addEventListener('click', function(e) {
            if (!inlineEditMode || !pendingEditIds.length) return;
            var btn = e.target.closest('[data-img-action]');
            if (!btn) return;
            var action = btn.getAttribute('data-img-action');
            var fieldName = btn.getAttribute('data-field-name');
            var cardId = pendingEditIds[0];
            if (!fieldName || !cardId) return;

            if (action === 'upload') {
                if (!imageUploadInput) return;
                imageUploadInput.value = '';
                imageUploadInput.dataset.targetField = fieldName;
                imageUploadInput.click();
                return;
            }

            if (action === 'remove') {
                updateCardInline(cardId, (function() {
                    var payload = {};
                    payload[fieldName] = '';
                    return payload;
                })())
                    .then(function(cardData) {
                        syncCardFromApi(cardId, cardData);
                        renderConfirmPreview(getCardById(cardId));
                        if (typeof showToast === 'function') showToast('Image removed', 'success');
                    })
                    .catch(function(err) {
                        if (typeof showToast === 'function') showToast((err && err.message) ? err.message : 'Could not remove image', 'error');
                    });
            }
        });

        confirmPreview.addEventListener('input', function(e) {
            if (!inlineEditMode) return;
            if (!e.target.classList.contains('reprint-preview-input')) return;
            recomputeInlineDirtyState();
        });
    }

    if (imageUploadInput) {
        imageUploadInput.addEventListener('change', function() {
            if (!inlineEditMode || !pendingEditIds.length) return;
            var file = imageUploadInput.files && imageUploadInput.files[0];
            if (!file) return;
            var fieldName = imageUploadInput.dataset.targetField || '';
            var cardId = pendingEditIds[0];
            if (!fieldName || !cardId) return;

            uploadImageInline(cardId, fieldName, file)
                .then(function(cardData) {
                    syncCardFromApi(cardId, cardData);
                    renderConfirmPreview(getCardById(cardId));
                    if (typeof showToast === 'function') showToast('Image uploaded', 'success');
                })
                .catch(function(err) {
                    if (typeof showToast === 'function') showToast((err && err.message) ? err.message : 'Could not upload image', 'error');
                })
                .finally(function() {
                    imageUploadInput.value = '';
                    imageUploadInput.dataset.targetField = '';
                });
        });
    }

    refreshReprintStepCounts();

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

    _dlResetImageRenameControls();

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
    document.getElementById('downloadImgRenameToggle')?.addEventListener('change', function() {
        const panelEl = document.getElementById('downloadImgRenamePanel');
        if (!panelEl) return;
        panelEl.style.display = this.checked ? 'block' : 'none';
        if (this.checked) _dlInitializeImageRenamePanel();
    });
    document.getElementById('downloadImgConfirm')?.addEventListener('click', function() {
        const selectedCardIds = Array.isArray(pendingDownloadCardIds) ? pendingDownloadCardIds.slice() : [];
        const renameOptions = _dlGetImageRenameOptionsFromModal();
        closeDownloadImgModal();
        window.IDCardApp.downloadImages(selectedCardIds, renameOptions);
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
