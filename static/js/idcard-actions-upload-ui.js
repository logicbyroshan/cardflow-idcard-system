// ID Card Actions - Upload UI Sub-module
// Constants, helpers, wizard navigation, field mapping UI, modal management
// Part of IDCardApp module system  registers functions on window.IDCardApp

(function() {
'use strict';

// ==========================================
// CONSTANTS
// NOTE: Must stay in sync with mediafiles/constants.py
// ==========================================
var IMAGE_FIELD_TYPES = ['photo', 'rel_photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature', 'image'];
var IMAGE_FIELD_NAME_PATTERNS = ['photo', 'rel photo', 'relation photo', 'relation image', 'relation pic', 'f photo', 'father photo', 'm photo', 'mother photo', 'sign', 'signature', 'barcode', 'qr', 'qr_code', 'image'];
var VALID_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.heif', '.hei'];

// Populate on upload  currently empty (populated during XLSX validation)
window.currentImageFields = [];

// ==========================================
// SHARED STATE (accessed by both UI and Logic sub-modules)
// ==========================================
var _us = {
    pendingUploadFile: null,
    pendingZipFiles: {},
    zipFileNamesMap: {},
    uploadedHeaders: [],
    autoFieldMapping: {},
    currentDataRowCount: 0,
    unifiedZipFiles: []
};

// ==========================================
// IMAGE FIELD DETECTION FUNCTIONS
// ==========================================

function isImageFieldType(fieldType) {
    if (!fieldType) return false;
    return IMAGE_FIELD_TYPES.includes(fieldType.toLowerCase());
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
    const patterns = ['photo', 'sign', 'signature', 'barcode', 'qr'];
    for (const pattern of patterns) {
        const regex = new RegExp('\\b' + pattern + '\\b');
        if (regex.test(spacedName)) {
            return true;
        }
    }
    return IMAGE_FIELD_NAME_PATTERNS.some(pattern => normalizedName === pattern || spacedName === pattern);
}

function isImageField(field) {
    if (!field) return false;
    return isImageFieldType(field.type) || isImageFieldByName(field.name);
}

function normalizeImageIdentifier(identifier) {
    if (identifier === null || identifier === undefined) return '';
    let result = String(identifier).trim();
    if (!result) return '';
    const numVal = parseFloat(result);
    if (!isNaN(numVal) && numVal === Math.floor(numVal)) {
        result = String(Math.floor(numVal));
    }
    const lowerResult = result.toLowerCase();
    for (const ext of VALID_IMAGE_EXTENSIONS) {
        if (lowerResult.endsWith(ext)) {
            result = result.slice(0, -ext.length);
            break;
        }
    }
    result = result.split(/\s+/).join(' ');
    return result.toUpperCase();
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }
    return dp[m][n];
}

function normalizeFieldName(name) {
    return name.toLowerCase()
        .replace(/[\s_\-\.]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

function findBestMatch(uploadedHeader, tableFields) {
    const normalizedUploaded = normalizeFieldName(uploadedHeader);
    for (const field of tableFields) {
        if (normalizeFieldName(field) === normalizedUploaded) {
            return { field, type: 'exact' };
        }
    }
    let bestMatch = null;
    let bestDistance = Infinity;
    for (const field of tableFields) {
        const normalizedField = normalizeFieldName(field);
        const distance = levenshteinDistance(normalizedUploaded, normalizedField);
        const maxDistance = normalizedField.length < 5 ? 1 : 2;
        if (distance <= maxDistance && distance < bestDistance) {
            bestDistance = distance;
            bestMatch = field;
        }
    }
    if (bestMatch) return { field: bestMatch, type: 'fuzzy' };
    return null;
}

function escHtml(s) {
    return (window.escapeHtml || function(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    })(s);
}

// ==========================================
// WIZARD NAVIGATION
// ==========================================

let currentWizardStep = 1;

function setWizardStep(step) {
    currentWizardStep = step;

    const step1Panel = document.getElementById('wizardStep1');
    const step2Panel = document.getElementById('wizardStep2');
    const nextBtn = document.getElementById('nextToStep2');
    const backBtn = document.getElementById('backToStep1');
    const uploadBtn = document.getElementById('confirmUploadModal');
    const stepIndicators = document.querySelectorAll('.wizard-step');
    const stepLine = document.querySelector('.wizard-step-line');

    if (step === 1) {
        if (step1Panel) step1Panel.style.display = '';
        if (step2Panel) step2Panel.style.display = 'none';
        if (backBtn) backBtn.style.display = 'none';
        if (uploadBtn) uploadBtn.style.display = 'none';
        // Show Next only if validation stage is visible (file has been validated)
        const validationStage = document.getElementById('validationStage');
        if (nextBtn) nextBtn.style.display = (validationStage && validationStage.style.display !== 'none') ? '' : 'none';
    } else {
        if (step1Panel) step1Panel.style.display = 'none';
        if (step2Panel) step2Panel.style.display = '';
        if (nextBtn) nextBtn.style.display = 'none';
        if (backBtn) backBtn.style.display = '';
        if (uploadBtn) uploadBtn.style.display = '';
    }

    // Update step indicators
    stepIndicators.forEach(el => {
        const s = parseInt(el.dataset.step);
        el.classList.toggle('active', s === step);
        el.classList.toggle('completed', s < step);
    });
    if (stepLine) stepLine.classList.toggle('completed', step === 2);
}

// ==========================================
// FIELD MAPPING UI
// ==========================================

/**
 * Build the manual field mapping table.
 * Each table field gets a <select> dropdown with all Excel headers + "-- Not Mapped --".
 * Auto-matched fields are pre-selected.
 */
function populateFieldMappingTable(matchedFields, missingFields, ignoredFields, dataRowCount, isError) {
    const mappingList = document.getElementById('fieldMappingList');
    const uploadStatus = document.getElementById('uploadStatus');
    const dataRowsCount = document.getElementById('dataRowsCount');
    const matchedCountEl = document.getElementById('matchedCount');
    const missingCountEl = document.getElementById('missingCount');
    const ignoredCountEl = document.getElementById('ignoredCount');
    const modalHeader = document.querySelector('.upload-modal-header');
    const nextBtn = document.getElementById('nextToStep2');

    if (!mappingList) return;

    // Update status bar
    if (isError) {
        if (uploadStatus) {
            uploadStatus.className = 'upload-status error';
            uploadStatus.innerHTML = '<i class="fa-solid fa-circle-xmark error-icon"></i><span id="uploadStatusText">No matching fields found! Map fields manually below.</span>';
        }
        if (modalHeader) modalHeader.classList.add('error');
    } else {
        if (uploadStatus) {
            uploadStatus.className = 'upload-status';
            uploadStatus.innerHTML = '<i class="fa-solid fa-circle-check success-icon"></i><span id="uploadStatusText">Fields matched successfully!</span>';
        }
        if (modalHeader) modalHeader.classList.remove('error');
    }

    // Summary badges
    if (matchedCountEl) matchedCountEl.innerHTML = '<i class="fa-solid fa-check"></i> ' + matchedFields.length + ' Matched';
    if (missingCountEl) missingCountEl.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> ' + missingFields.length + ' Missing';
    if (ignoredCountEl) ignoredCountEl.innerHTML = '<i class="fa-solid fa-eye-slash"></i> ' + ignoredFields.length + ' Ignored';

    // Show/hide badges based on counts
    if (matchedCountEl) matchedCountEl.style.display = matchedFields.length > 0 ? '' : 'none';
    if (missingCountEl) missingCountEl.style.display = missingFields.length > 0 ? '' : 'none';
    if (ignoredCountEl) ignoredCountEl.style.display = ignoredFields.length > 0 ? '' : 'none';

    // Data rows
    if (dataRowsCount) dataRowsCount.textContent = dataRowCount + ' data row' + (dataRowCount !== 1 ? 's' : '') + ' found';

    // Build mapping table
    var tableFields = (typeof TABLE_FIELDS !== 'undefined' ? TABLE_FIELDS : [])
        .filter(function(f) { return !isImageField(f); });

    // Build a lookup: tableFieldName -> matched excel header
    var autoMap = {};
    matchedFields.forEach(function(m) { autoMap[m.tableField] = m.uploaded; });

    mappingList.innerHTML = '';

    tableFields.forEach(function(field) {
        var row = document.createElement('div');
        row.className = 'field-mapping-row';

        var autoMatch = autoMap[field.name] || null;

        // Table field label
        var labelCell = document.createElement('div');
        labelCell.className = 'fm-cell fm-label';
        labelCell.textContent = field.name;

        // Dropdown cell
        var selectCell = document.createElement('div');
        selectCell.className = 'fm-cell fm-select';

        var select = document.createElement('select');
        select.className = 'field-map-select';
        select.dataset.tableField = field.name;

        // "Not Mapped" option
        var emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '-- Not Mapped --';
        select.appendChild(emptyOpt);

        // Add all uploaded headers as options
        _us.uploadedHeaders.forEach(function(header) {
            var opt = document.createElement('option');
            opt.value = header;
            opt.textContent = header;
            if (autoMatch && header === autoMatch) opt.selected = true;
            select.appendChild(opt);
        });

        select.addEventListener('change', onFieldMappingChange);
        selectCell.appendChild(select);

        // Status icon cell
        var statusCell = document.createElement('div');
        statusCell.className = 'fm-cell fm-status-icon ' + (autoMatch ? 'mapped' : 'unmapped');
        statusCell.innerHTML = autoMatch
            ? '<i class="fa-solid fa-circle-check"></i>'
            : '<i class="fa-solid fa-minus-circle"></i>';

        row.appendChild(labelCell);
        row.appendChild(selectCell);
        row.appendChild(statusCell);
        mappingList.appendChild(row);
    });

    // Show Next button if at least 1 field is mapped
    updateNextButtonState();

    // Update image columns info for step 2
    var imageColumnsList = document.getElementById('imageColumnsList');
    var allTableFields = typeof TABLE_FIELDS !== 'undefined' ? TABLE_FIELDS : [];
    var imageFields = allTableFields.filter(function(f) { return isImageField(f); });
    window.currentImageFields = imageFields;

    var photoZipSection = document.getElementById('photoZipSection');
    var noImagesNotice = document.getElementById('noImagesNotice');

    if (imageFields.length > 0) {
        if (photoZipSection) photoZipSection.style.display = '';
        if (noImagesNotice) noImagesNotice.style.display = 'none';
        if (imageColumnsList) {
            imageColumnsList.textContent = imageFields.map(function(f) { return f.name.toUpperCase(); }).join(', ');
        }
    } else {
        if (photoZipSection) photoZipSection.style.display = 'none';
        if (noImagesNotice) noImagesNotice.style.display = '';
    }
}

/** Called when user changes a dropdown */
function onFieldMappingChange() {
    updateMappingStatusIcons();
    updateNextButtonState();
}

/** Refresh all status icons + summary badges based on current dropdown values */
function updateMappingStatusIcons() {
    var selects = document.querySelectorAll('.field-map-select');
    var matchedCount = 0;
    var missingCount = 0;
    var usedHeaders = new Set();

    selects.forEach(function(sel) {
        var statusIcon = sel.closest('.field-mapping-row').querySelector('.fm-status-icon');
        if (sel.value) {
            matchedCount++;
            usedHeaders.add(sel.value);
            if (statusIcon) {
                statusIcon.className = 'fm-cell fm-status-icon mapped';
                statusIcon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
            }
        } else {
            missingCount++;
            if (statusIcon) {
                statusIcon.className = 'fm-cell fm-status-icon unmapped';
                statusIcon.innerHTML = '<i class="fa-solid fa-minus-circle"></i>';
            }
        }
    });

    // Count ignored headers (not mapped to any field)
    var ignoredCount = _us.uploadedHeaders.filter(function(h) { return !usedHeaders.has(h); }).length;

    var matchedCountEl = document.getElementById('matchedCount');
    var missingCountEl = document.getElementById('missingCount');
    var ignoredCountEl = document.getElementById('ignoredCount');

    if (matchedCountEl) { matchedCountEl.innerHTML = '<i class="fa-solid fa-check"></i> ' + matchedCount + ' Matched'; matchedCountEl.style.display = matchedCount > 0 ? '' : 'none'; }
    if (missingCountEl) { missingCountEl.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> ' + missingCount + ' Missing'; missingCountEl.style.display = missingCount > 0 ? '' : 'none'; }
    if (ignoredCountEl) { ignoredCountEl.innerHTML = '<i class="fa-solid fa-eye-slash"></i> ' + ignoredCount + ' Ignored'; ignoredCountEl.style.display = ignoredCount > 0 ? '' : 'none'; }

    // Update header error/success
    var uploadStatus = document.getElementById('uploadStatus');
    var modalHeader = document.querySelector('.upload-modal-header');
    if (matchedCount > 0) {
        if (uploadStatus) {
            uploadStatus.className = 'upload-status';
            uploadStatus.innerHTML = '<i class="fa-solid fa-circle-check success-icon"></i><span id="uploadStatusText">Fields matched  ' + matchedCount + ' of ' + selects.length + '</span>';
        }
        if (modalHeader) modalHeader.classList.remove('error');
    } else {
        if (uploadStatus) {
            uploadStatus.className = 'upload-status error';
            uploadStatus.innerHTML = '<i class="fa-solid fa-circle-xmark error-icon"></i><span id="uploadStatusText">No fields mapped yet</span>';
        }
        if (modalHeader) modalHeader.classList.add('error');
    }
}

/** Enable / disable Next button */
function updateNextButtonState() {
    var nextBtn = document.getElementById('nextToStep2');
    var selects = document.querySelectorAll('.field-map-select');
    var anyMapped = false;
    selects.forEach(function(sel) { if (sel.value) anyMapped = true; });
    if (nextBtn) {
        nextBtn.disabled = !anyMapped;
        nextBtn.style.display = '';
    }
}

/** Collect the current field mapping from dropdowns */
function getCurrentFieldMapping() {
    var mapping = {};
    document.querySelectorAll('.field-map-select').forEach(function(sel) {
        if (sel.value) {
            mapping[sel.dataset.tableField] = sel.value;
        }
    });
    return mapping;
}

// ==========================================
// UPLOAD MODAL FUNCTIONS
// ==========================================

function resetUploadModal() {
    var fileSelectStage = document.getElementById('fileSelectStage');
    var validationStage = document.getElementById('validationStage');
    var xlsxFileInput = document.getElementById('xlsxFileInput');
    var selectedFileName = document.getElementById('selectedFileName');
    var selectXlsxFileBtn = document.getElementById('selectXlsxFileBtn');
    var uploadProgressSection = document.getElementById('uploadProgressSection');
    var step1Progress = document.getElementById('step1Progress');

    // Reset stages
    if (fileSelectStage) fileSelectStage.style.display = '';
    if (validationStage) validationStage.style.display = 'none';
    if (uploadProgressSection) uploadProgressSection.style.display = 'none';
    if (step1Progress) step1Progress.style.display = 'none';

    // Reset file selection
    if (xlsxFileInput) xlsxFileInput.value = '';
    if (selectedFileName) selectedFileName.style.display = 'none';
    if (selectXlsxFileBtn) {
        selectXlsxFileBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i> Browse Files';
        selectXlsxFileBtn.style.display = '';
    }

    // Reset state
    _us.pendingUploadFile = null;
    _us.pendingZipFiles = {};
    _us.zipFileNamesMap = {};
    _us.uploadedHeaders = [];
    _us.autoFieldMapping = {};
    _us.currentDataRowCount = 0;
    currentWizardStep = 1;

    // Reset ZIP inputs
    _us.unifiedZipFiles = [];
    _us.unifiedFolderFiles = [];
    // Clear ZIP list display (inline to avoid circular dep with logic sub-module)
    var selectedZipsList = document.getElementById('selectedZipsList');
    if (selectedZipsList) { selectedZipsList.style.display = 'none'; selectedZipsList.innerHTML = ''; }
    var selectedFolderSummary = document.getElementById('selectedFolderSummary');
    if (selectedFolderSummary) { selectedFolderSummary.style.display = 'none'; selectedFolderSummary.innerHTML = ''; }
    var unifiedFolderInput = document.getElementById('unifiedFolderInput');
    if (unifiedFolderInput) unifiedFolderInput.value = '';
    var unifiedFolderPathInput = document.getElementById('unifiedFolderPathInput');
    if (unifiedFolderPathInput) unifiedFolderPathInput.value = '';

    document.querySelectorAll('.zip-file-name').forEach(function(el) {
        el.textContent = 'No file selected';
        el.classList.remove('selected');
    });
    document.querySelectorAll('.zip-file-status').forEach(function(el) {
        el.style.display = 'none';
    });
    document.querySelectorAll('.photo-zip-input').forEach(function(el) {
        el.value = '';
    });

    // Reset mapping list
    var mappingList = document.getElementById('fieldMappingList');
    if (mappingList) mappingList.innerHTML = '';

    // Reset wizard to step 1
    setWizardStep(1);
}

function resetFileSelection() {
    var selectXlsxFileBtn = document.getElementById('selectXlsxFileBtn');
    var selectedFileName = document.getElementById('selectedFileName');
    if (selectXlsxFileBtn) {
        selectXlsxFileBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i> Browse Files';
        selectXlsxFileBtn.style.display = '';
    }
    if (selectedFileName) selectedFileName.style.display = 'none';
}

function showValidationResults(matchedFields, missingFields, ignoredFields, dataRowCount, isError) {
    var fileSelectStage = document.getElementById('fileSelectStage');
    var validationStage = document.getElementById('validationStage');
    var selectXlsxFileBtn = document.getElementById('selectXlsxFileBtn');

    if (selectXlsxFileBtn) {
        selectXlsxFileBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i> Browse Files';
    }

    if (fileSelectStage) fileSelectStage.style.display = 'none';
    if (validationStage) validationStage.style.display = '';

    // Populate the mapping table
    populateFieldMappingTable(matchedFields, missingFields, ignoredFields, dataRowCount, isError);

    // Make sure we're on step 1 and Next is visible (even if isError, allow manual mapping)
    setWizardStep(1);
}

// Legacy compat
function openUploadModal(matchedFields, missingFields, ignoredFields, dataRowCount, isError) {
    var uploadModalOverlay = document.getElementById('uploadModalOverlay');
    showValidationResults(matchedFields, missingFields, ignoredFields, dataRowCount, isError);
    if (uploadModalOverlay && !uploadModalOverlay.classList.contains('active')) {
        uploadModalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeUploadModalFn() {
    if (window.IDCardApp && typeof window.IDCardApp.cancelActiveUpload === 'function') {
        window.IDCardApp.cancelActiveUpload({ notify: false, closeModal: false });
    }

    var uploadModalOverlay = document.getElementById('uploadModalOverlay');
    if (uploadModalOverlay) {
        uploadModalOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    resetUploadModal();
}

window.closeUploadModal = closeUploadModalFn;

// ==========================================
// EXPOSE ON IDCardApp
// ==========================================

window.IDCardApp = window.IDCardApp || {};
// Shared state for logic sub-module
window.IDCardApp._uploadState = _us;
// Shared functions for logic sub-module
window.IDCardApp._uploadFns = {
    isImageField: isImageField,
    normalizeImageIdentifier: normalizeImageIdentifier,
    findBestMatch: findBestMatch,
    escHtml: escHtml,
    setWizardStep: setWizardStep,
    getCurrentFieldMapping: getCurrentFieldMapping,
    resetFileSelection: resetFileSelection,
    showValidationResults: showValidationResults,
    closeUploadModalFn: closeUploadModalFn,
    resetUploadModal: resetUploadModal,
    updateNextButtonState: updateNextButtonState
};
window.IDCardApp.closeUploadModal = closeUploadModalFn;

})();
