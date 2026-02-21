// ID Card Actions - Upload Module (2-Step Wizard)
// Contains: XLSX upload, field matching (auto + manual), ZIP upload, progress

(function() {
'use strict';

// ==========================================
// CONSTANTS
// NOTE: Must stay in sync with mediafiles/constants.py
// ==========================================
var IMAGE_FIELD_TYPES = ['photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature', 'image'];
var IMAGE_FIELD_NAME_PATTERNS = ['photo', 'f photo', 'father photo', 'm photo', 'mother photo', 'sign', 'signature', 'barcode', 'qr', 'qr_code', 'image'];
var VALID_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

// Populate on upload — currently empty (populated during XLSX validation)
window.currentImageFields = [];

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
    const patterns = ['photo', 'sign', 'signature', 'barcode', 'qr'];
    for (const pattern of patterns) {
        const regex = new RegExp('\\b' + pattern + '\\b');
        if (regex.test(normalizedName)) {
            return true;
        }
    }
    return IMAGE_FIELD_NAME_PATTERNS.some(pattern => normalizedName === pattern);
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
// UPLOAD STATE
// ==========================================

let pendingUploadFile = null;
let pendingZipFiles = {};
let zipFileNamesMap = {};
let currentWizardStep = 1;
let uploadedHeaders = [];      // Excel headers from file
let autoFieldMapping = {};     // { tableFieldName: excelHeader } auto-matched
let currentDataRowCount = 0;

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
            uploadStatus.innerHTML = '<i class="fa-solid fa-times-circle error-icon"></i><span id="uploadStatusText">No matching fields found! Map fields manually below.</span>';
        }
        if (modalHeader) modalHeader.classList.add('error');
    } else {
        if (uploadStatus) {
            uploadStatus.className = 'upload-status';
            uploadStatus.innerHTML = '<i class="fa-solid fa-check-circle success-icon"></i><span id="uploadStatusText">Fields matched successfully!</span>';
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
        uploadedHeaders.forEach(function(header) {
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
            ? '<i class="fa-solid fa-check-circle"></i>'
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
                statusIcon.innerHTML = '<i class="fa-solid fa-check-circle"></i>';
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
    var ignoredCount = uploadedHeaders.filter(function(h) { return !usedHeaders.has(h); }).length;

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
            uploadStatus.innerHTML = '<i class="fa-solid fa-check-circle success-icon"></i><span id="uploadStatusText">Fields matched — ' + matchedCount + ' of ' + selects.length + '</span>';
        }
        if (modalHeader) modalHeader.classList.remove('error');
    } else {
        if (uploadStatus) {
            uploadStatus.className = 'upload-status error';
            uploadStatus.innerHTML = '<i class="fa-solid fa-times-circle error-icon"></i><span id="uploadStatusText">No fields mapped yet</span>';
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
    pendingUploadFile = null;
    pendingZipFiles = {};
    zipFileNamesMap = {};
    uploadedHeaders = [];
    autoFieldMapping = {};
    currentDataRowCount = 0;
    currentWizardStep = 1;

    // Reset ZIP inputs
    unifiedZipFiles = [];
    updateSelectedZipsList();

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
    var uploadModalOverlay = document.getElementById('uploadModalOverlay');
    if (uploadModalOverlay) {
        uploadModalOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    resetUploadModal();
}

window.closeUploadModal = closeUploadModalFn;

// ==========================================
// XLSX UPLOAD HANDLERS
// ==========================================

function initXlsxUpload() {
    var uploadXlsxBtn = document.getElementById('uploadXlsxBtn');
    var xlsxFileInput = document.getElementById('xlsxFileInput');
    var uploadModalOverlay = document.getElementById('uploadModalOverlay');
    var closeUploadModal = document.getElementById('closeUploadModal');
    var cancelUploadModal = document.getElementById('cancelUploadModal');
    var confirmUploadModal = document.getElementById('confirmUploadModal');
    var selectXlsxFileBtn = document.getElementById('selectXlsxFileBtn');
    var selectedFileName = document.getElementById('selectedFileName');
    var selectedFileNameText = document.getElementById('selectedFileNameText');
    var clearSelectedFile = document.getElementById('clearSelectedFile');
    var fileSelectStage = document.getElementById('fileSelectStage');
    var validationStage = document.getElementById('validationStage');
    var nextBtn = document.getElementById('nextToStep2');
    var backBtn = document.getElementById('backToStep1');

    // Modal close handlers
    if (closeUploadModal) closeUploadModal.addEventListener('click', closeUploadModalFn);
    if (cancelUploadModal) cancelUploadModal.addEventListener('click', closeUploadModalFn);
    if (uploadModalOverlay) {
        uploadModalOverlay.addEventListener('click', function(e) {
            if (e.target === uploadModalOverlay) closeUploadModalFn();
        });
    }

    // Upload XLSX button opens the modal (Step 1)
    if (uploadXlsxBtn) {
        uploadXlsxBtn.addEventListener('click', function() {
            resetUploadModal();
            if (uploadModalOverlay) {
                uploadModalOverlay.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        });
    }

    // Browse Files button
    if (selectXlsxFileBtn && xlsxFileInput) {
        selectXlsxFileBtn.addEventListener('click', function() {
            xlsxFileInput.click();
        });
    }

    // Clear selected file
    if (clearSelectedFile) {
        clearSelectedFile.addEventListener('click', function() {
            if (xlsxFileInput) xlsxFileInput.value = '';
            if (selectedFileName) selectedFileName.style.display = 'none';
            if (selectXlsxFileBtn) selectXlsxFileBtn.style.display = '';
            pendingUploadFile = null;
            uploadedHeaders = [];
            if (fileSelectStage) fileSelectStage.style.display = '';
            if (validationStage) validationStage.style.display = 'none';
            if (nextBtn) nextBtn.style.display = 'none';
        });
    }

    // File input change handler — validates and shows field mapping
    if (xlsxFileInput) {
        xlsxFileInput.addEventListener('change', async function() {
            var file = this.files[0];
            if (!file) return;

            var validTypes = ['.xlsx', '.xls', '.csv'];
            var fileName = file.name.toLowerCase();
            var isValid = validTypes.some(function(ext) { return fileName.endsWith(ext); });

            if (!isValid) {
                if (typeof showToast === 'function') showToast('Please upload an Excel (.xlsx, .xls) or CSV file', false);
                this.value = '';
                return;
            }

            // Show selected file name
            if (selectedFileName && selectedFileNameText) {
                selectedFileNameText.textContent = file.name;
                selectedFileName.style.display = 'flex';
            }
            if (selectXlsxFileBtn) selectXlsxFileBtn.textContent = 'Validating...';

            // Show step 1 progress
            var step1Progress = document.getElementById('step1Progress');
            var step1ProgressBar = document.getElementById('step1ProgressBar');
            var step1ProgressText = document.getElementById('step1ProgressText');
            if (step1Progress) step1Progress.style.display = '';
            if (step1ProgressBar) step1ProgressBar.style.width = '30%';
            if (step1ProgressText) step1ProgressText.textContent = 'Reading file...';

            try {
                var tableFieldNames = (typeof TABLE_FIELDS !== 'undefined' ? TABLE_FIELDS : [])
                    .filter(function(f) { return !isImageField(f); })
                    .map(function(f) { return f.name; });

                if (tableFieldNames.length === 0) {
                    if (typeof showToast === 'function') showToast('No fields defined in table!', false);
                    this.value = '';
                    resetFileSelection();
                    if (step1Progress) step1Progress.style.display = 'none';
                    return;
                }

                if (step1ProgressBar) step1ProgressBar.style.width = '50%';
                if (step1ProgressText) step1ProgressText.textContent = 'Parsing spreadsheet...';

                var fileData = await file.arrayBuffer();
                var workbook = XLSX.read(fileData, { type: 'array' });
                var firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                var jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

                if (jsonData.length === 0) {
                    if (typeof showToast === 'function') showToast('The uploaded file is empty!', false);
                    this.value = '';
                    resetFileSelection();
                    if (step1Progress) step1Progress.style.display = 'none';
                    return;
                }

                if (step1ProgressBar) step1ProgressBar.style.width = '70%';
                if (step1ProgressText) step1ProgressText.textContent = 'Matching fields...';

                uploadedHeaders = (jsonData[0] || []).map(function(h) { return String(h || '').trim(); }).filter(function(h) { return h; });

                if (uploadedHeaders.length === 0) {
                    if (typeof showToast === 'function') showToast('No headers found in the uploaded file!', false);
                    this.value = '';
                    resetFileSelection();
                    if (step1Progress) step1Progress.style.display = 'none';
                    return;
                }

                var matchedFields = [];
                var unmatchedUploadedFields = [];
                var usedTableFields = new Set();

                uploadedHeaders.forEach(function(header) {
                    var match = findBestMatch(header, tableFieldNames.filter(function(f) { return !usedTableFields.has(f); }));
                    if (match) {
                        matchedFields.push({ uploaded: header, tableField: match.field, type: match.type });
                        usedTableFields.add(match.field);
                    } else {
                        unmatchedUploadedFields.push(header);
                    }
                });

                var missingTableFields = tableFieldNames.filter(function(f) { return !usedTableFields.has(f); });
                currentDataRowCount = jsonData.slice(1).filter(function(row) {
                    if (!row || !Array.isArray(row)) return false;
                    return row.some(function(cell) { return cell !== null && cell !== undefined && String(cell).trim() !== ''; });
                }).length;

                if (step1ProgressBar) step1ProgressBar.style.width = '100%';
                if (step1ProgressText) step1ProgressText.textContent = 'Done!';

                var _self = this;
                setTimeout(function() {
                    if (step1Progress) step1Progress.style.display = 'none';
                    if (step1ProgressBar) step1ProgressBar.style.width = '0%';

                    // Even if no auto-matches, show the mapping table so user can map manually
                    pendingUploadFile = file;
                    showValidationResults(
                        matchedFields,
                        missingTableFields,
                        unmatchedUploadedFields,
                        currentDataRowCount,
                        matchedFields.length === 0
                    );
                }, 400);

            } catch (error) {
                console.error('Validation error:', error);
                if (typeof showToast === 'function') showToast('Failed to read file: ' + error.message, false);
                resetFileSelection();
                if (step1Progress) step1Progress.style.display = 'none';
            }
        });
    }

    // ── NEXT button (Step 1 → Step 2) ──
    if (nextBtn) {
        nextBtn.addEventListener('click', function() {
            var mapping = getCurrentFieldMapping();
            if (Object.keys(mapping).length === 0) {
                if (typeof showToast === 'function') showToast('Please map at least one field before proceeding', false);
                return;
            }
            setWizardStep(2);
        });
    }

    // ── BACK button (Step 2 → Step 1) ──
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            setWizardStep(1);
        });
    }

    // ── UPLOAD button (Step 2 — send to server) ──
    if (confirmUploadModal) {
        confirmUploadModal.addEventListener('click', async function() {
            if (!pendingUploadFile) {
                if (typeof showToast === 'function') showToast('No file to upload', false);
                closeUploadModalFn();
                return;
            }

            var progressSection = document.getElementById('uploadProgressSection');
            var progressBar = document.getElementById('uploadProgressBar');
            var percentageText = document.getElementById('uploadPercentage');
            var sizeText = document.getElementById('uploadProgressSize');
            var timeText = document.getElementById('uploadTimeRemaining');
            var cancelBtn = document.getElementById('cancelUploadModal');
            var backBtnEl = document.getElementById('backToStep1');

            var originalText = this.innerHTML;
            this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
            this.disabled = true;
            if (cancelBtn) cancelBtn.disabled = true;
            if (backBtnEl) backBtnEl.disabled = true;

            if (progressSection) progressSection.style.display = 'block';

            var formData = new FormData();
            formData.append('file', pendingUploadFile);

            // Send the manual field mapping so backend uses it
            var fieldMapping = getCurrentFieldMapping();
            formData.append('field_mapping', JSON.stringify(fieldMapping));

            // Append multiple ZIP files with their field names (legacy per-field mode)
            Object.keys(pendingZipFiles).forEach(function(fieldName) {
                if (pendingZipFiles[fieldName]) {
                    formData.append('photos_zip_' + fieldName, pendingZipFiles[fieldName]);
                }
            });
            formData.append('zip_field_names', JSON.stringify(Object.keys(pendingZipFiles)));

            // Send unified ZIP files
            var unifiedZips = getUnifiedZipFiles();
            if (unifiedZips && unifiedZips.length > 0) {
                unifiedZips.forEach(function(file, index) {
                    formData.append('unified_zip_' + index, file);
                });
                formData.append('unified_zip_count', unifiedZips.length.toString());
            }

            var xhr = new XMLHttpRequest();
            var startTime = Date.now();

            xhr.upload.addEventListener('progress', function(e) {
                if (e.lengthComputable) {
                    var percentComplete = Math.round((e.loaded / e.total) * 100);
                    var elapsedTime = (Date.now() - startTime) / 1000;
                    var uploadSpeed = e.loaded / elapsedTime;
                    var remainingBytes = e.total - e.loaded;
                    var remainingTime = remainingBytes / uploadSpeed;

                    if (progressBar) progressBar.style.width = percentComplete + '%';
                    if (percentageText) percentageText.textContent = percentComplete + '%';

                    var loadedMB = (e.loaded / (1024 * 1024));
                    var totalMB = (e.total / (1024 * 1024));
                    if (loadedMB >= 1) {
                        if (sizeText) sizeText.textContent = loadedMB.toFixed(1) + ' MB / ' + totalMB.toFixed(1) + ' MB';
                    } else {
                        var loadedKB = (e.loaded / 1024).toFixed(1);
                        var totalKB = (e.total / 1024).toFixed(1);
                        if (sizeText) sizeText.textContent = loadedKB + ' KB / ' + totalKB + ' KB';
                    }

                    if (timeText) {
                        if (remainingTime < 1) {
                            timeText.textContent = 'Almost done...';
                        } else if (remainingTime < 60) {
                            timeText.textContent = Math.ceil(remainingTime) + ' sec remaining';
                        } else {
                            var mins = Math.floor(remainingTime / 60);
                            var secs = Math.ceil(remainingTime % 60);
                            timeText.textContent = mins + 'm ' + secs + 's remaining';
                        }
                    }
                }
            });

            xhr.upload.addEventListener('load', function() {
                if (progressBar) progressBar.style.width = '100%';
                if (percentageText) percentageText.textContent = '100%';
                if (sizeText) sizeText.textContent = 'Upload complete';
                if (timeText) timeText.textContent = 'Server processing data...';
                if (progressBar) progressBar.classList.add('processing');
            });

            xhr.addEventListener('load', function() {
                try {
                    var result = JSON.parse(xhr.responseText);

                    if (xhr.status === 200 && result.success) {
                        if (progressBar) { progressBar.style.width = '100%'; progressBar.classList.remove('processing'); }
                        if (percentageText) percentageText.textContent = '100%';
                        if (timeText) timeText.textContent = 'Complete!';

                        setTimeout(function() {
                            closeUploadModalFn();
                            if (typeof showToast === 'function') showToast(result.message, true);
                            setTimeout(function() { window.location.reload(); }, 1500);
                        }, 500);
                    } else {
                        var errorMessage = result.message || 'Upload failed';
                        if (result.errors && Array.isArray(result.errors) && result.errors.length > 0) {
                            var errorList = result.errors.slice(0, 3).join('\n• ');
                            errorMessage += '\n\n• ' + errorList;
                            if (result.errors.length > 3) {
                                errorMessage += '\n... and ' + (result.errors.length - 3) + ' more errors';
                            }
                        }
                        if (typeof showToast === 'function') showToast(errorMessage, false);
                        resetUploadState();
                    }
                } catch (error) {
                    console.error('Parse error:', error);
                    if (typeof showToast === 'function') showToast('Failed to process server response', false);
                    resetUploadState();
                }
            });

            xhr.addEventListener('error', function() {
                console.error('Upload error');
                if (typeof showToast === 'function') showToast('Failed to upload file', false);
                resetUploadState();
            });

            function resetUploadState() {
                if (progressSection) progressSection.style.display = 'none';
                if (progressBar) { progressBar.style.width = '0%'; progressBar.classList.remove('processing'); }
                confirmUploadModal.innerHTML = originalText;
                confirmUploadModal.disabled = false;
                if (cancelBtn) cancelBtn.disabled = false;
                if (backBtnEl) backBtnEl.disabled = false;
            }

            var tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
            xhr.open('POST', '/panel/api/table/' + tableId + '/cards/bulk-upload/');
            xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
            xhr.send(formData);
        });
    }
}

// ==========================================
// UNIFIED ZIP UPLOAD HANDLERS
// ==========================================

let unifiedZipFiles = [];

function initUnifiedZipUpload() {
    var selectBtn = document.getElementById('selectZipFilesBtn');
    var fileInput = document.getElementById('unifiedZipInput');
    var selectedList = document.getElementById('selectedZipsList');

    if (!selectBtn || !fileInput) return;

    selectBtn.addEventListener('click', function() { fileInput.click(); });

    fileInput.addEventListener('change', async function() {
        var files = Array.from(this.files);

        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            if (!file.name.toLowerCase().endsWith('.zip')) {
                if (typeof showToast === 'function') showToast(file.name + ' is not a ZIP file', 'error');
                continue;
            }
            if (unifiedZipFiles.some(function(f) { return f.name === file.name; })) {
                if (typeof showToast === 'function') showToast(file.name + ' already added', 'warning');
                continue;
            }
            unifiedZipFiles.push(file);
        }

        updateSelectedZipsList();
        this.value = '';
    });

    if (selectedList) {
        selectedList.addEventListener('click', function(e) {
            var removeBtn = e.target.closest('.remove-zip');
            if (removeBtn) {
                var zipName = removeBtn.dataset.zipName;
                unifiedZipFiles = unifiedZipFiles.filter(function(f) { return f.name !== zipName; });
                updateSelectedZipsList();
            }
        });
    }
}

function updateSelectedZipsList() {
    var selectedList = document.getElementById('selectedZipsList');
    if (!selectedList) return;

    if (unifiedZipFiles.length === 0) {
        selectedList.style.display = 'none';
        selectedList.innerHTML = '';
        return;
    }

    selectedList.style.display = 'block';
    selectedList.innerHTML = unifiedZipFiles.map(function(file) {
        return '<div class="selected-zip-item">' +
            '<span class="zip-name"><i class="fa-solid fa-file-zipper"></i> ' + escHtml(file.name) + '</span>' +
            '<button class="remove-zip" data-zip-name="' + escHtml(file.name) + '" title="Remove"><i class="fa-solid fa-xmark"></i></button>' +
            '</div>';
    }).join('');
}

function getUnifiedZipFiles() {
    return unifiedZipFiles;
}

function clearUnifiedZipFiles() {
    unifiedZipFiles = [];
    updateSelectedZipsList();
}

// ==========================================
// ZIP UPLOAD HANDLERS (Legacy)
// ==========================================

function initZipUpload() {
    initUnifiedZipUpload();

    var zipInputsContainer = document.getElementById('zipInputsContainer');
    if (!zipInputsContainer) return;

    zipInputsContainer.addEventListener('click', function(e) {
        var btn = e.target.closest('.select-zip-btn');
        if (btn) {
            var fieldName = btn.dataset.field;
            var fileInput = zipInputsContainer.querySelector('.photo-zip-input[data-field="' + fieldName + '"]');
            if (fileInput) fileInput.click();
        }
    });

    zipInputsContainer.addEventListener('change', async function(e) {
        if (!e.target.classList.contains('photo-zip-input')) return;

        var fileInput = e.target;
        var fieldName = fileInput.dataset.field;
        var file = fileInput.files[0];

        var row = zipInputsContainer.querySelector('.zip-upload-row[data-field-name="' + fieldName + '"]');
        var zipFileName = row.querySelector('.zip-file-name[data-field="' + fieldName + '"]');
        var zipFileStatus = row.querySelector('.zip-file-status[data-field="' + fieldName + '"]');
        var zipFileCount = zipFileStatus ? zipFileStatus.querySelector('.zip-file-count') : null;

        if (!file) {
            if (zipFileName) { zipFileName.textContent = 'No file selected'; zipFileName.classList.remove('selected'); }
            if (zipFileStatus) zipFileStatus.style.display = 'none';
            delete pendingZipFiles[fieldName];
            delete zipFileNamesMap[fieldName];
            return;
        }

        if (!file.name.toLowerCase().endsWith('.zip')) {
            if (typeof showToast === 'function') showToast('Please select a ZIP file', 'error');
            fileInput.value = '';
            return;
        }

        pendingZipFiles[fieldName] = file;
        if (zipFileName) { zipFileName.textContent = file.name; zipFileName.classList.add('selected'); }

        try {
            var zip = await JSZip.loadAsync(file);
            var imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
            var imageCount = 0;
            zipFileNamesMap[fieldName] = [];
            var normalizedNames = new Set();
            var duplicates = [];

            zip.forEach(function(relativePath, zipEntry) {
                if (!zipEntry.dir) {
                    var ext = relativePath.toLowerCase().substring(relativePath.lastIndexOf('.'));
                    if (imageExtensions.includes(ext)) {
                        imageCount++;
                        var baseName = relativePath.split('/').pop();
                        var nameWithoutExt = baseName.substring(0, baseName.lastIndexOf('.'));
                        var normalizedKey = normalizeImageIdentifier(nameWithoutExt);

                        if (normalizedNames.has(normalizedKey)) {
                            duplicates.push(baseName);
                        } else {
                            normalizedNames.add(normalizedKey);
                        }

                        zipFileNamesMap[fieldName].push({
                            fullPath: relativePath,
                            nameWithoutExt: nameWithoutExt,
                            normalizedKey: normalizedKey,
                            originalName: baseName
                        });
                    }
                }
            });

            if (imageCount > 0) {
                if (zipFileStatus) zipFileStatus.style.display = 'flex';
                if (duplicates.length > 0) {
                    var dupMsg = duplicates.length <= 3
                        ? duplicates.join(', ')
                        : duplicates.slice(0, 3).join(', ') + ' and ' + (duplicates.length - 3) + ' more';
                    if (zipFileCount) zipFileCount.textContent = imageCount + ' images (\u26A0\uFE0F ' + duplicates.length + ' duplicates)';
                    if (typeof showToast === 'function') {
                        showToast('Warning: Duplicate filenames detected in ZIP: ' + dupMsg + '. Only one will be used.', 'warning');
                    }
                } else {
                    if (zipFileCount) zipFileCount.textContent = imageCount + ' image' + (imageCount > 1 ? 's' : '');
                }
            } else {
                if (zipFileStatus) zipFileStatus.style.display = 'none';
                if (typeof showToast === 'function') showToast('No images found in ZIP for ' + fieldName, 'error');
            }
        } catch (error) {
            console.error('Error reading ZIP:', error);
            if (zipFileStatus) zipFileStatus.style.display = 'none';
            if (typeof showToast === 'function') showToast('Error reading ZIP file', 'error');
        }
    });
}

// ==========================================
// INITIALIZATION
// ==========================================

function initUploadModule() {
    initXlsxUpload();
    initZipUpload();
}

window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.initUploadModule = initUploadModule;
window.IDCardApp.closeUploadModal = closeUploadModalFn;

})();
