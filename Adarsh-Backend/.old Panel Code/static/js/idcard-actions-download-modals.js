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

function _dlHasPermissionFlag(key) {
    if (!window.PERMS || typeof window.PERMS !== 'object') return true;
    if (!Object.prototype.hasOwnProperty.call(window.PERMS, key)) return true;
    return !!window.PERMS[key];
}

function _dlCanUseRenameMode() {
    return _dlHasPermissionFlag('idcard_download_image_rename_mode');
}

function _dlCanUseGenerateMode() {
    return _dlHasPermissionFlag('idcard_download_image_generate_mode');
}

// ==========================================
// DOWNLOAD MODAL STATE
// ==========================================

let pendingDownloadCardIds = [];
let currentDownloadType = null; // 'pdf', 'xlsx', 'img'
let _dlImageRenameState = {
    imageFields: [],
    textFields: [],
    selectedImageField: '',
    selectedNameFields: [],
    mode: '',
    compressEnabled: false,
    targetSizeKb: 40,
    generateSizePreset: 'size_23x34',
    generateNameField: '',
    generateDetailMode: 'class_only',
    generateClassField: '',
    generateSectionField: '',
    generateCustomDate: ''
};
let _dlImageWizardStep = 1;

// Modal DOM references (set in initDownloadModals)
let downloadPdfModal = null;
let downloadXlsxModal = null;
let downloadImgModal = null;

function _dlGetProgressModalConfig(type) {
    var modalId = '';
    var stepId = '';
    var bodySelector = '.download-modal-settings-content';
    var cancelId = '';
    var confirmId = '';
    var statusId = '';
    var barId = '';
    var percentId = '';
    var etaId = '';
    var step1BadgeId = '';
    var step2BadgeId = '';

    if (type === 'pdf') {
        modalId = 'downloadPdfModal';
        stepId = 'downloadPdfProgressStep';
        cancelId = 'downloadPdfCancel';
        confirmId = 'downloadPdfConfirm';
        statusId = 'downloadPdfStatus';
        barId = 'downloadPdfBar';
        percentId = 'downloadPdfPercent';
        etaId = 'downloadPdfEta';
        step1BadgeId = 'downloadPdfStep1Badge';
        step2BadgeId = 'downloadPdfStep2Badge';
    } else if (type === 'xlsx') {
        modalId = 'downloadXlsxModal';
        stepId = 'downloadXlsxProgressStep';
        cancelId = 'downloadXlsxCancel';
        confirmId = 'downloadXlsxConfirm';
        statusId = 'downloadXlsxStatus';
        barId = 'downloadXlsxBar';
        percentId = 'downloadXlsxPercent';
        etaId = 'downloadXlsxEta';
        step1BadgeId = 'downloadXlsxStep1Badge';
        step2BadgeId = 'downloadXlsxStep2Badge';
    } else if (type === 'docx') {
        modalId = 'downloadDocxModal';
        stepId = 'downloadDocxProgressStep';
        cancelId = 'downloadDocxCancel';
        confirmId = 'downloadDocxConfirm';
        statusId = 'downloadDocxStatus';
        barId = 'downloadDocxBar';
        percentId = 'downloadDocxPercent';
        etaId = 'downloadDocxEta';
        step1BadgeId = 'downloadDocxStep1Badge';
        step2BadgeId = 'downloadDocxStep2Badge';
    } else if (type === 'img') {
        modalId = 'downloadImgModal';
        stepId = 'downloadImgProgressStep';
        cancelId = 'downloadImgCancel';
        confirmId = 'downloadImgConfirm';
        statusId = 'downloadImgStatus';
        barId = 'downloadImgBar';
        percentId = 'downloadImgPercent';
        etaId = 'downloadImgEta';
        step1BadgeId = 'downloadImgStep1Badge';
        step2BadgeId = 'downloadImgStep2Badge';
    }

    return {
        type: type,
        modalId: modalId,
        stepId: stepId,
        bodySelector: bodySelector,
        cancelId: cancelId,
        confirmId: confirmId,
        statusId: statusId,
        barId: barId,
        percentId: percentId,
        etaId: etaId,
        step1BadgeId: step1BadgeId,
        step2BadgeId: step2BadgeId,
    };
}

var _dlProgressState = {
    type: '',
    cancelFn: null,
};

function _dlSetFooterCancelLabel(type, label) {
    var cfg = _dlGetProgressModalConfig(type);
    var cancelBtn = document.getElementById(cfg.cancelId);
    if (cancelBtn) cancelBtn.textContent = label;
}

function _dlSetStepperState(type, activeStep) {
    var cfg = _dlGetProgressModalConfig(type);
    var step1 = document.getElementById(cfg.step1BadgeId);
    var step2 = document.getElementById(cfg.step2BadgeId);

    if (step1) {
        step1.classList.toggle('is-active', activeStep === 1);
        step1.classList.toggle('is-complete', activeStep > 1);
    }
    if (step2) {
        step2.classList.toggle('is-active', activeStep === 2);
        step2.classList.toggle('is-complete', false);
    }
}

function _dlSetProgressVisible(type, visible) {
    var cfg = _dlGetProgressModalConfig(type);
    var modal = document.getElementById(cfg.modalId);
    var body = modal ? modal.querySelector(cfg.bodySelector) : null;
    var step = document.getElementById(cfg.stepId);
    // Ensure modal remains visible when showing progress step.
    if (modal && visible) {
        modal.style.display = 'flex';
    }
    if (body) body.style.display = visible ? 'none' : '';
    if (step) step.style.display = visible ? 'block' : 'none';
    _dlSetStepperState(type, visible ? 2 : 1);
}

function _dlUpdateProgressUi(type, message, progress, etaText) {
    var cfg = _dlGetProgressModalConfig(type);
    var statusEl = document.getElementById(cfg.statusId);
    var barEl = document.getElementById(cfg.barId);
    var percentEl = document.getElementById(cfg.percentId);
    var etaEl = document.getElementById(cfg.etaId);

    if (statusEl && message) statusEl.textContent = message;
    if (barEl) {
        if (progress < 0) {
            barEl.classList.add('indeterminate');
            barEl.style.width = '30%';
        } else {
            barEl.classList.remove('indeterminate');
            barEl.style.width = Math.max(0, Math.min(100, Math.round(progress))) + '%';
        }
    }
    if (percentEl) {
        percentEl.textContent = progress >= 0 ? Math.max(0, Math.min(100, Math.round(progress))) + '%' : '...';
    }
    if (etaEl) etaEl.textContent = etaText || '--';
}

function _dlFinishProgressUi(type, message, isError) {
    var cfg = _dlGetProgressModalConfig(type);
    var modal = document.getElementById(cfg.modalId);
    var body = modal ? modal.querySelector(cfg.bodySelector) : null;
    var step = document.getElementById(cfg.stepId);
    var cancelBtn = document.getElementById(cfg.cancelId);
    var confirmBtn = document.getElementById(cfg.confirmId);
    var statusEl = document.getElementById(cfg.statusId);
    var barEl = document.getElementById(cfg.barId);
    var percentEl = document.getElementById(cfg.percentId);
    var etaEl = document.getElementById(cfg.etaId);

    if (body) body.style.display = 'none';
    if (step) step.style.display = 'block';
    if (barEl) {
        barEl.classList.remove('indeterminate');
        barEl.style.width = '100%';
    }
    if (percentEl) percentEl.textContent = '100%';
    if (etaEl) etaEl.textContent = '--';
    if (statusEl) statusEl.textContent = message || (isError ? 'Download failed' : 'Download complete');
    if (cancelBtn) cancelBtn.textContent = isError ? 'Close' : 'Close';
    if (confirmBtn) confirmBtn.style.display = 'none';
    _dlSetStepperState(type, 2);
    _dlProgressState.cancelFn = null;
}

function _dlClearProgressUi(type) {
    var cfg = _dlGetProgressModalConfig(type);
    var modal = document.getElementById(cfg.modalId);
    var body = modal ? modal.querySelector(cfg.bodySelector) : null;
    var step = document.getElementById(cfg.stepId);
    var cancelBtn = document.getElementById(cfg.cancelId);
    var confirmBtn = document.getElementById(cfg.confirmId);
    var barEl = document.getElementById(cfg.barId);
    var percentEl = document.getElementById(cfg.percentId);
    var etaEl = document.getElementById(cfg.etaId);
    var statusEl = document.getElementById(cfg.statusId);

    if (body) body.style.display = '';
    if (step) step.style.display = 'none';
    if (cancelBtn) cancelBtn.textContent = 'Cancel';
    if (confirmBtn) confirmBtn.style.display = '';
    if (barEl) {
        barEl.classList.remove('indeterminate');
        barEl.style.width = '0%';
    }
    if (percentEl) percentEl.textContent = '0%';
    if (etaEl) etaEl.textContent = '--';
    if (statusEl) statusEl.textContent = 'Preparing...';
    _dlSetStepperState(type, 1);
}

function _dlHideProgressModal(type) {
    var cfg = _dlGetProgressModalConfig(type);
    var modal = document.getElementById(cfg.modalId);
    if (modal) modal.style.display = 'none';
}

window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.downloadProgressPresenter = {
    isActive: function() {
        return !!_dlProgressState.type;
    },
    setType: function(type) {
        _dlProgressState.type = type || '';
    },
    prepare: function(message, progress, onCancel) {
        if (!_dlProgressState.type) return;
        _dlSetProgressVisible(_dlProgressState.type, true);
        _dlSetFooterCancelLabel(_dlProgressState.type, 'Cancel Download');
        var cfgPrepare = _dlGetProgressModalConfig(_dlProgressState.type);
        var confirmBtnPrepare = document.getElementById(cfgPrepare.confirmId);
        if (confirmBtnPrepare) confirmBtnPrepare.style.display = 'none';
        _dlProgressState.cancelFn = (typeof onCancel === 'function') ? onCancel : _dlProgressState.cancelFn;
        _dlUpdateProgressUi(_dlProgressState.type, message || 'Preparing...', typeof progress === 'number' ? progress : -1, '--');
    },
    update: function(message, progress, etaText, onCancel) {
        if (!_dlProgressState.type) return;
        if (typeof onCancel === 'function') _dlProgressState.cancelFn = onCancel;
        _dlUpdateProgressUi(_dlProgressState.type, message || 'Downloading...', typeof progress === 'number' ? progress : -1, etaText || '--');
    },
    complete: function(message) {
        if (!_dlProgressState.type) return;
        var completedType = _dlProgressState.type;
        _dlFinishProgressUi(completedType, message || 'Download complete', false);
        setTimeout(function() {
            if (_dlProgressState.type !== completedType) return;
            _dlClearProgressUi(completedType);
            _dlHideProgressModal(completedType);
            _dlProgressState.type = '';
            _dlProgressState.cancelFn = null;
        }, 1200);
    },
    error: function(message) {
        if (!_dlProgressState.type) return;
        _dlFinishProgressUi(_dlProgressState.type, message || 'Download failed', true);
    },
    cancel: function() {
        if (typeof _dlProgressState.cancelFn === 'function') {
            var cancelFn = _dlProgressState.cancelFn;
            _dlProgressState.cancelFn = null;
            cancelFn();
            return;
        }
        if (_dlProgressState.type) {
            _dlClearProgressUi(_dlProgressState.type);
            _dlProgressState.type = '';
        }
    },
    clear: function() {
        if (_dlProgressState.type) {
            _dlClearProgressUi(_dlProgressState.type);
        }
        _dlProgressState.type = '';
        _dlProgressState.cancelFn = null;
    }
};

function _dlNormalizeFieldKey(value) {
    return String(value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

function _dlLooksImageField(field) {
    const type = String((field && field.type) || '').toLowerCase();
    const name = String((field && field.name) || '').toLowerCase();
    if (type === 'image' || type === 'photo' || type === 'rel_photo' || type === 'file' || type === 'signature' || type === 'father_photo' || type === 'mother_photo' || type === 'qr_code' || type === 'barcode') {
        return true;
    }
    if (/\b(?:rel(?:ation)?)\s*[_-]?\s*(?:1|one|2|two)\s*(?:photo|image|pic|picture)\b/.test(name)) {
        return true;
    }
    return name.indexOf('photo') !== -1 ||
           name.indexOf('image') !== -1 ||
           name.indexOf('picture') !== -1 ||
           name.indexOf('signature') !== -1 ||
           name.indexOf('barcode') !== -1 ||
           name.indexOf('qr') !== -1;
}

function _dlLooksRenameTargetImageField(field) {
    const type = String((field && field.type) || '').toLowerCase();
    const name = String((field && field.name) || '').toLowerCase();

    if (type === 'photo' || type === 'rel_photo' || type === 'image' || type === 'father_photo' || type === 'mother_photo') {
        return true;
    }

    if (type === 'signature' || type === 'qr_code' || type === 'barcode') {
        return false;
    }

    return name.indexOf('photo') !== -1 ||
           name.indexOf('image') !== -1 ||
            name.indexOf('picture') !== -1 ||
            /\b(?:rel(?:ation)?)\s*[_-]?\s*(?:1|one|2|two)\s*(?:photo|image|pic|picture)\b/.test(name);
}

function _dlGetRenameTargetImageFields() {
    const fields = Array.isArray(window.TABLE_FIELDS) ? window.TABLE_FIELDS : [];
    const uniqueByNormalizedName = {};

    fields.forEach(function(field) {
        const name = String((field && field.name) || '').trim();
        if (!name) return;
        if (!_dlLooksRenameTargetImageField(field)) return;

        const normalized = _dlNormalizeFieldKey(name);
        if (!normalized || uniqueByNormalizedName[normalized]) return;
        uniqueByNormalizedName[normalized] = {
            name: name,
            type: String((field && field.type) || '').trim()
        };
    });

    return Object.keys(uniqueByNormalizedName).map(function(key) {
        return uniqueByNormalizedName[key];
    });
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

function _dlPopulateRenameTargetSelect(selectEl, imageFields, preferredFieldName) {
    if (!selectEl) return;
    selectEl.innerHTML = '';

    imageFields.forEach(function(field) {
        const option = document.createElement('option');
        option.value = field.name;
        option.textContent = field.name;
        if (field.name === preferredFieldName) option.selected = true;
        selectEl.appendChild(option);
    });
}

function _dlClampTargetSizeKb(value) {
    const parsed = parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return 40;
    return Math.max(10, Math.min(200, parsed));
}

function _dlPopulateTextFieldSelect(selectEl, textFields, preferredFieldName, emptyOptionLabel) {
    if (!selectEl) return;

    const preferred = String(preferredFieldName || '').trim();
    const normalizedPreferred = _dlNormalizeFieldKey(preferred);
    selectEl.innerHTML = '';

    if (emptyOptionLabel) {
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = String(emptyOptionLabel);
        selectEl.appendChild(emptyOption);
    }

    let selectedValue = '';
    (textFields || []).forEach(function(field) {
        const option = document.createElement('option');
        const name = String((field && field.name) || '').trim();
        if (!name) return;

        option.value = name;
        option.textContent = name;
        if (normalizedPreferred && _dlNormalizeFieldKey(name) === normalizedPreferred) {
            option.selected = true;
            selectedValue = name;
        }
        selectEl.appendChild(option);
    });

    if (!selectedValue && !emptyOptionLabel && selectEl.options.length > 0) {
        selectEl.options[0].selected = true;
        selectedValue = String(selectEl.options[0].value || '').trim();
    }

    if (!selectedValue && emptyOptionLabel && selectEl.options.length > 0) {
        selectEl.options[0].selected = true;
    }
}

function _dlGetGenerateSizePreset() {
    const smallEl = document.getElementById('downloadImgGenerateSizeSmall');
    const largeEl = document.getElementById('downloadImgGenerateSizeLarge');

    if (largeEl && largeEl.checked) return 'size_37x53';
    if (smallEl && smallEl.checked) return 'size_23x34';
    return _dlImageRenameState.generateSizePreset || 'size_23x34';
}

function _dlSetGenerateSizePreset(preset) {
    const normalized = preset === 'size_37x53' ? 'size_37x53' : 'size_23x34';
    const smallEl = document.getElementById('downloadImgGenerateSizeSmall');
    const largeEl = document.getElementById('downloadImgGenerateSizeLarge');

    if (smallEl) smallEl.checked = normalized === 'size_23x34';
    if (largeEl) largeEl.checked = normalized === 'size_37x53';
    _dlImageRenameState.generateSizePreset = normalized;
}

function _dlGetGenerateDetailMode() {
    const classOnlyEl = document.getElementById('downloadImgGenerateDetailClassOnly');
    const classSectionEl = document.getElementById('downloadImgGenerateDetailClassSection');
    const customDateEl = document.getElementById('downloadImgGenerateDetailCustomDate');

    if (customDateEl && customDateEl.checked) return 'custom_date';
    if (classSectionEl && classSectionEl.checked) return 'class_section';
    if (classOnlyEl && classOnlyEl.checked) return 'class_only';
    return _dlImageRenameState.generateDetailMode || 'class_only';
}

function _dlSetGenerateDetailMode(mode) {
    const normalized = mode === 'custom_date' || mode === 'class_section' ? mode : 'class_only';
    const classOnlyEl = document.getElementById('downloadImgGenerateDetailClassOnly');
    const classSectionEl = document.getElementById('downloadImgGenerateDetailClassSection');
    const customDateEl = document.getElementById('downloadImgGenerateDetailCustomDate');

    if (classOnlyEl) classOnlyEl.checked = normalized === 'class_only';
    if (classSectionEl) classSectionEl.checked = normalized === 'class_section';
    if (customDateEl) customDateEl.checked = normalized === 'custom_date';

    _dlImageRenameState.generateDetailMode = normalized;
}

function _dlSyncGenerateFieldUi() {
    const mode = _dlGetActiveImageMode();
    const classWrapEl = document.getElementById('downloadImgGenerateClassWrap');
    const sectionWrapEl = document.getElementById('downloadImgGenerateSectionWrap');
    const customDateWrapEl = document.getElementById('downloadImgGenerateCustomDateWrap');

    const detailMode = _dlGetGenerateDetailMode();
    _dlImageRenameState.generateDetailMode = detailMode;
    _dlImageRenameState.generateSizePreset = _dlGetGenerateSizePreset();

    const isGenerateMode = mode === 'generate';
    if (classWrapEl) classWrapEl.style.display = (isGenerateMode && detailMode !== 'custom_date') ? 'block' : 'none';
    if (sectionWrapEl) sectionWrapEl.style.display = (isGenerateMode && detailMode === 'class_section') ? 'block' : 'none';
    if (customDateWrapEl) customDateWrapEl.style.display = (isGenerateMode && detailMode === 'custom_date') ? 'block' : 'none';
}

function _dlGetActiveImageMode() {
    const generateToggleEl = document.getElementById('downloadImgGenerateByFieldToggle');
    const renameToggleEl = document.getElementById('downloadImgRenameToggle');
    if (generateToggleEl && !generateToggleEl.disabled && generateToggleEl.checked && _dlCanUseGenerateMode()) return 'generate';
    if (renameToggleEl && !renameToggleEl.disabled && renameToggleEl.checked && _dlCanUseRenameMode()) return 'rename';
    return '';
}

function _dlSetActiveImageMode(mode) {
    const renameToggleEl = document.getElementById('downloadImgRenameToggle');
    const generateToggleEl = document.getElementById('downloadImgGenerateByFieldToggle');

    let resolvedMode = mode;
    if (resolvedMode === 'rename' && !_dlCanUseRenameMode()) resolvedMode = '';
    if (resolvedMode === 'generate' && !_dlCanUseGenerateMode()) resolvedMode = '';

    if (renameToggleEl) renameToggleEl.checked = resolvedMode === 'rename';
    if (generateToggleEl) generateToggleEl.checked = resolvedMode === 'generate';
    _dlImageRenameState.mode = resolvedMode;

    if (!resolvedMode) {
        _dlImageWizardStep = 1;
    } else if (_dlImageWizardStep < 2) {
        _dlImageWizardStep = 2;
    }

    _dlSyncModeUi();
}

function _dlGetImageWizardMaxStep() {
    const mode = _dlGetActiveImageMode();
    if (mode === 'generate') return 4;
    if (mode === 'rename') return 3;
    return 1;
}

function _dlSetImageWizardStep(step) {
    const parsed = parseInt(String(step || 1), 10);
    _dlImageWizardStep = Number.isFinite(parsed) ? parsed : 1;
    _dlImageWizardStep = Math.max(1, Math.min(_dlImageWizardStep, _dlGetImageWizardMaxStep()));
    _dlSyncImageWizardUi();
}

function _dlValidateImageWizardStep(step) {
    const mode = _dlGetActiveImageMode();

    if (step === 1 && !mode) {
        return 'Please choose Rename or Generate mode.';
    }

    if (step === 2) {
        const selectedImageField = String(_dlImageRenameState.selectedImageField || '').trim();
        if (!selectedImageField) {
            return 'Please select one image column to download.';
        }
    }

    if (step === 3) {
        if (mode === 'rename' && !_dlImageRenameState.selectedNameFields.length) {
            return 'Please select at least one filename field.';
        }

        if (mode === 'generate') {
            const options = _dlGetImageRenameOptionsFromModal();
            if (options && options.__error) {
                return options.__error;
            }
        }
    }

    return '';
}

function _dlSyncImageWizardUi() {
    const step1El = document.getElementById('downloadImgWizardStep1');
    const step2El = document.getElementById('downloadImgWizardStep2');
    const renameStepEl = document.getElementById('downloadImgRenameFieldsSection');
    const generateStepEl = document.getElementById('downloadImgWizardStep3Generate');
    const step4El = document.getElementById('downloadImgWizardStep4');
    const wizardProgressEl = document.getElementById('downloadImgWizardProgress');
    const wizardNavEl = document.querySelector('#downloadImgRenamePanel .download-img-wizard-nav');
    const step1HeadingEl = document.querySelector('#downloadImgWizardStep1 .download-img-section-heading');
    const modeHelperEl = document.querySelector('#downloadImgWizardStep1 .download-img-mode-helper');
    const stepLabelEl = document.getElementById('downloadImgWizardStepLabel');
    const backBtn = document.getElementById('downloadImgWizardBack');
    const nextBtn = document.getElementById('downloadImgWizardNext');
    const confirmBtn = document.getElementById('downloadImgConfirm');
    const chips = document.querySelectorAll('[data-dl-wizard-chip]');

    const mode = _dlGetActiveImageMode();
    const hasMode = !!mode;
    const maxStep = _dlGetImageWizardMaxStep();

    if (_dlImageWizardStep > maxStep) _dlImageWizardStep = maxStep;
    if (_dlImageWizardStep < 1) _dlImageWizardStep = 1;

    // Simplified UI: show all relevant option panels together (no per-step progression)
    if (step1El) step1El.style.display = 'block';
    if (step2El) step2El.style.display = mode ? 'block' : 'none';
    if (renameStepEl) renameStepEl.style.display = (mode === 'rename') ? 'block' : 'none';
    if (generateStepEl) generateStepEl.style.display = (mode === 'generate') ? 'block' : 'none';
    if (step4El) step4El.style.display = (mode === 'generate') ? 'block' : 'none';

    // Hide wizard chips and navigation; present all options in a single combined panel
    if (wizardProgressEl) wizardProgressEl.style.display = 'none';
    if (wizardNavEl) wizardNavEl.style.display = 'none';

    if (step1HeadingEl) step1HeadingEl.textContent = hasMode ? 'Choose Mode & Options' : 'Optional: Choose Mode';
    if (modeHelperEl) modeHelperEl.textContent = hasMode ? 'Select options below then click Download.' : 'Leave both unchecked to download all image columns normally.';

    // Mark chips disabled visually if present
    chips.forEach(function(chip) {
        chip.classList.remove('is-active');
        chip.classList.remove('is-complete');
        chip.classList.add('is-disabled');
    });

    if (stepLabelEl) {
        stepLabelEl.textContent = '';
    }

    if (backBtn) backBtn.disabled = true;
    if (nextBtn) { nextBtn.disabled = true; nextBtn.style.display = 'none'; }

    if (confirmBtn) {
        // Allow immediate confirm; validation will run on click
        confirmBtn.disabled = false;
        // Keep the template label authoritative; use concise image label here.
        confirmBtn.textContent = 'Download Imgs';
    }
    console.log('[DownloadWizard] UI synced to combined view (Mode: ' + (mode || 'none') + ')');
}

function _dlSyncModeUi() {
    const panelEl = document.getElementById('downloadImgRenamePanel');
    const renameToggleEl = document.getElementById('downloadImgRenameToggle');
    const generateToggleEl = document.getElementById('downloadImgGenerateByFieldToggle');
    const helpTextEl = document.getElementById('downloadImgFieldHelpText');
    const formatSelect = document.getElementById('downloadImgFormatSelect');
    const compressToggleEl = document.getElementById('downloadImgCompressToggle');
    const compressTargetWrapEl = document.getElementById('downloadImgCompressTargetWrap');

    const mode = _dlGetActiveImageMode();
    _dlImageRenameState.mode = mode;

    const hasAnyModeToggle = !!renameToggleEl || !!generateToggleEl;
    const hasUsableModeToggle = !!(
        (renameToggleEl && !renameToggleEl.disabled) ||
        (generateToggleEl && !generateToggleEl.disabled)
    );
    if (panelEl) panelEl.style.display = (hasAnyModeToggle && hasUsableModeToggle) ? 'block' : 'none';

    if (helpTextEl) {
        helpTextEl.textContent = mode === 'generate'
            ? 'Generate mode: select Name field, card size, and Class/Class+Section/Custom Date.'
            : 'Click one or more fields. Selected values are joined with underscore (_).';
    }

    if (mode !== 'generate') {
        _dlImageRenameState.compressEnabled = false;
        if (compressToggleEl) compressToggleEl.checked = false;
    } else {
        _dlImageRenameState.compressEnabled = !!(compressToggleEl && compressToggleEl.checked);
    }

    if (compressTargetWrapEl) {
        compressTargetWrapEl.style.display = (mode === 'generate' && _dlImageRenameState.compressEnabled) ? 'block' : 'none';
    }

    if (formatSelect && !String(formatSelect.value || '').trim()) {
        formatSelect.value = 'zip';
    }

    _dlSyncGenerateFieldUi();

    _dlUpdateRenamePreview();
    _dlSyncImageWizardUi();
}

function _dlSanitizePreviewPart(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60);
}

function _dlRenderSelectedNameFieldChips() {
    const selectedWrap = document.getElementById('downloadImgNameFieldSelected');
    if (!selectedWrap) return;

    selectedWrap.innerHTML = '';
    if (!_dlImageRenameState.selectedNameFields.length) {
        const empty = document.createElement('span');
        empty.className = 'download-img-selected-empty';
        empty.textContent = 'No filename fields selected.';
        selectedWrap.appendChild(empty);
        return;
    }

    _dlImageRenameState.selectedNameFields.forEach(function(fieldName) {
        const chip = document.createElement('span');
        chip.className = 'download-img-selected-chip';

        const textNode = document.createElement('span');
        textNode.textContent = fieldName;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'download-img-selected-remove';
        removeBtn.setAttribute('aria-label', 'Remove field');
        removeBtn.setAttribute('data-dl-selected-remove', fieldName);
        removeBtn.textContent = 'x';

        chip.appendChild(textNode);
        chip.appendChild(removeBtn);
        selectedWrap.appendChild(chip);
    });
}

function _dlRenderNameFieldPicker() {
    const picker = document.getElementById('downloadImgNameFieldPicker');
    if (!picker) return;

    picker.innerHTML = '';
    if (!_dlImageRenameState.textFields.length) {
        const none = document.createElement('span');
        none.className = 'download-img-selected-empty';
        none.textContent = 'No text fields available for filename.';
        picker.appendChild(none);
        return;
    }

    const activeSet = new Set(_dlImageRenameState.selectedNameFields);
    _dlImageRenameState.textFields.forEach(function(field) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'download-img-field-chip';
        if (activeSet.has(field.name)) {
            button.classList.add('is-active');
        }
        button.setAttribute('data-dl-field-chip', field.name);
        button.textContent = field.name;
        picker.appendChild(button);
    });
}

function _dlUpdateRenamePreview() {
    const previewEl = document.getElementById('downloadImgRenamePreview');
    const formatSelect = document.getElementById('downloadImgFormatSelect');
    if (!previewEl) return;

    const mode = _dlGetActiveImageMode();
    const ext = formatSelect && String(formatSelect.value || '').trim() === 'pdf_zip' ? '.pdf' : '.jpg';
    const stemParts = _dlImageRenameState.selectedNameFields
        .map(_dlSanitizePreviewPart)
        .filter(Boolean);
    const stem = stemParts.length ? stemParts.join('_') : 'NAME';
    const selectedImageField = _dlImageRenameState.selectedImageField || 'PHOTO';
    if (mode === 'generate') {
        const nameField = _dlSanitizePreviewPart(_dlImageRenameState.generateNameField || 'NAME');
        const sizeTag = _dlGetGenerateSizePreset() === 'size_37x53' ? '37x53' : '23x34';
        previewEl.textContent = selectedImageField + ' -> GENERATED_' + (nameField || 'NAME') + '_' + sizeTag + ext;
        return;
    }
    previewEl.textContent = selectedImageField + ' -> ' + stem + ext;
}

function _dlSetSelectedNameFields(fields) {
    const validSet = new Set(_dlImageRenameState.textFields.map(function(field) { return field.name; }));
    const seen = new Set();
    _dlImageRenameState.selectedNameFields = (fields || [])
        .map(function(value) { return String(value || '').trim(); })
        .filter(function(value) {
            if (!value || !validSet.has(value)) return false;
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

    _dlRenderNameFieldPicker();
    _dlRenderSelectedNameFieldChips();
    _dlUpdateRenamePreview();
}

function _dlBindRenamePanelEvents() {
    const targetSelect = document.getElementById('downloadImgRenameTarget');
    const picker = document.getElementById('downloadImgNameFieldPicker');
    const selectedWrap = document.getElementById('downloadImgNameFieldSelected');
    const formatSelect = document.getElementById('downloadImgFormatSelect');
    const compressToggleEl = document.getElementById('downloadImgCompressToggle');
    const compressTargetInputEl = document.getElementById('downloadImgCompressTargetKb');
    const sizeSmallEl = document.getElementById('downloadImgGenerateSizeSmall');
    const sizeLargeEl = document.getElementById('downloadImgGenerateSizeLarge');
    const generateNameFieldEl = document.getElementById('downloadImgGenerateNameField');
    const detailClassOnlyEl = document.getElementById('downloadImgGenerateDetailClassOnly');
    const detailClassSectionEl = document.getElementById('downloadImgGenerateDetailClassSection');
    const detailCustomDateEl = document.getElementById('downloadImgGenerateDetailCustomDate');
    const generateClassFieldEl = document.getElementById('downloadImgGenerateClassField');
    const generateSectionFieldEl = document.getElementById('downloadImgGenerateSectionField');
    const generateCustomDateEl = document.getElementById('downloadImgGenerateCustomDate');

    if (targetSelect && targetSelect.dataset.bound !== '1') {
        targetSelect.addEventListener('change', function() {
            _dlImageRenameState.selectedImageField = String(this.value || '').trim();
            _dlUpdateRenamePreview();
        });
        targetSelect.dataset.bound = '1';
    }

    if (picker && picker.dataset.bound !== '1') {
        picker.addEventListener('click', function(event) {
            const eventTarget = event.target instanceof Element ? event.target : null;
            if (!eventTarget) return;
            const chip = eventTarget.closest('[data-dl-field-chip]');
            if (!chip) return;

            const fieldName = String(chip.getAttribute('data-dl-field-chip') || '').trim();
            if (!fieldName) return;

            const current = _dlImageRenameState.selectedNameFields.slice();
            const idx = current.indexOf(fieldName);
            if (idx >= 0) {
                current.splice(idx, 1);
            } else {
                current.push(fieldName);
            }
            _dlSetSelectedNameFields(current);
        });
        picker.dataset.bound = '1';
    }

    if (selectedWrap && selectedWrap.dataset.bound !== '1') {
        selectedWrap.addEventListener('click', function(event) {
            const eventTarget = event.target instanceof Element ? event.target : null;
            if (!eventTarget) return;
            const removeBtn = eventTarget.closest('[data-dl-selected-remove]');
            if (!removeBtn) return;
            const fieldName = String(removeBtn.getAttribute('data-dl-selected-remove') || '').trim();
            if (!fieldName) return;

            _dlSetSelectedNameFields(_dlImageRenameState.selectedNameFields.filter(function(item) {
                return item !== fieldName;
            }));
        });
        selectedWrap.dataset.bound = '1';
    }

    if (formatSelect && formatSelect.dataset.bound !== '1') {
        formatSelect.addEventListener('change', _dlSyncModeUi);
        formatSelect.dataset.bound = '1';
    }

    if (sizeSmallEl && sizeSmallEl.dataset.bound !== '1') {
        sizeSmallEl.addEventListener('change', function() {
            if (this.checked) {
                _dlSetGenerateSizePreset('size_23x34');
            } else if (!(sizeLargeEl && sizeLargeEl.checked)) {
                _dlSetGenerateSizePreset('size_23x34');
            }
            _dlSyncModeUi();
        });
        sizeSmallEl.dataset.bound = '1';
    }

    if (sizeLargeEl && sizeLargeEl.dataset.bound !== '1') {
        sizeLargeEl.addEventListener('change', function() {
            if (this.checked) {
                _dlSetGenerateSizePreset('size_37x53');
            } else if (!(sizeSmallEl && sizeSmallEl.checked)) {
                _dlSetGenerateSizePreset('size_23x34');
            }
            _dlSyncModeUi();
        });
        sizeLargeEl.dataset.bound = '1';
    }

    if (generateNameFieldEl && generateNameFieldEl.dataset.bound !== '1') {
        generateNameFieldEl.addEventListener('change', function() {
            _dlImageRenameState.generateNameField = String(this.value || '').trim();
            _dlUpdateRenamePreview();
        });
        generateNameFieldEl.dataset.bound = '1';
    }

    if (generateClassFieldEl && generateClassFieldEl.dataset.bound !== '1') {
        generateClassFieldEl.addEventListener('change', function() {
            _dlImageRenameState.generateClassField = String(this.value || '').trim();
        });
        generateClassFieldEl.dataset.bound = '1';
    }

    if (generateSectionFieldEl && generateSectionFieldEl.dataset.bound !== '1') {
        generateSectionFieldEl.addEventListener('change', function() {
            _dlImageRenameState.generateSectionField = String(this.value || '').trim();
        });
        generateSectionFieldEl.dataset.bound = '1';
    }

    if (generateCustomDateEl && generateCustomDateEl.dataset.bound !== '1') {
        generateCustomDateEl.addEventListener('input', function() {
            _dlImageRenameState.generateCustomDate = String(this.value || '').trim().slice(0, 40);
        });
        generateCustomDateEl.dataset.bound = '1';
    }

    if (detailClassOnlyEl && detailClassOnlyEl.dataset.bound !== '1') {
        detailClassOnlyEl.addEventListener('change', function() {
            if (this.checked) {
                _dlSetGenerateDetailMode('class_only');
            } else if (!(detailClassSectionEl && detailClassSectionEl.checked) && !(detailCustomDateEl && detailCustomDateEl.checked)) {
                _dlSetGenerateDetailMode('class_only');
            }
            _dlSyncModeUi();
        });
        detailClassOnlyEl.dataset.bound = '1';
    }

    if (detailClassSectionEl && detailClassSectionEl.dataset.bound !== '1') {
        detailClassSectionEl.addEventListener('change', function() {
            if (this.checked) {
                _dlSetGenerateDetailMode('class_section');
            } else if (!(detailClassOnlyEl && detailClassOnlyEl.checked) && !(detailCustomDateEl && detailCustomDateEl.checked)) {
                _dlSetGenerateDetailMode('class_only');
            }
            _dlSyncModeUi();
        });
        detailClassSectionEl.dataset.bound = '1';
    }

    if (detailCustomDateEl && detailCustomDateEl.dataset.bound !== '1') {
        detailCustomDateEl.addEventListener('change', function() {
            if (this.checked) {
                _dlSetGenerateDetailMode('custom_date');
            } else if (!(detailClassOnlyEl && detailClassOnlyEl.checked) && !(detailClassSectionEl && detailClassSectionEl.checked)) {
                _dlSetGenerateDetailMode('class_only');
            }
            _dlSyncModeUi();
        });
        detailCustomDateEl.dataset.bound = '1';
    }

    if (compressToggleEl && compressToggleEl.dataset.bound !== '1') {
        compressToggleEl.addEventListener('change', function() {
            _dlImageRenameState.compressEnabled = !!this.checked;
            _dlSyncModeUi();
        });
        compressToggleEl.dataset.bound = '1';
    }

    if (compressTargetInputEl && compressTargetInputEl.dataset.bound !== '1') {
        const clampTargetSize = function() {
            const value = _dlClampTargetSizeKb(compressTargetInputEl.value);
            _dlImageRenameState.targetSizeKb = value;
            compressTargetInputEl.value = String(value);
        };
        compressTargetInputEl.addEventListener('change', clampTargetSize);
        compressTargetInputEl.addEventListener('blur', clampTargetSize);
        compressTargetInputEl.dataset.bound = '1';
    }
}

function _dlBindImageWizardControls() {
    const backBtn = document.getElementById('downloadImgWizardBack');
    const nextBtn = document.getElementById('downloadImgWizardNext');
    const chips = document.querySelectorAll('[data-dl-wizard-chip]');

    if (backBtn && backBtn.dataset.bound !== '1') {
        backBtn.addEventListener('click', function() {
            _dlSetImageWizardStep(_dlImageWizardStep - 1);
        });
        backBtn.dataset.bound = '1';
    }

    if (nextBtn && nextBtn.dataset.bound !== '1') {
        nextBtn.addEventListener('click', function() {
            const maxStep = _dlGetImageWizardMaxStep();
            if (_dlImageWizardStep >= maxStep) return;

            const validationError = _dlValidateImageWizardStep(_dlImageWizardStep);
            if (validationError) {
                if (typeof showToast === 'function') {
                    showToast(validationError, 'warning');
                }
                return;
            }

            _dlSetImageWizardStep(_dlImageWizardStep + 1);
        });
        nextBtn.dataset.bound = '1';
    }

    chips.forEach(function(chip) {
        if (chip.dataset.bound === '1') return;

        chip.addEventListener('click', function() {
            const maxStep = _dlGetImageWizardMaxStep();
            const raw = chip.getAttribute('data-dl-wizard-chip');
            let targetStep = parseInt(String(raw || ''), 10);
            if (!Number.isFinite(targetStep)) return;
            targetStep = Math.max(1, Math.min(targetStep, maxStep));

            if (targetStep <= _dlImageWizardStep) {
                _dlSetImageWizardStep(targetStep);
                return;
            }

            let cursor = _dlImageWizardStep;
            while (cursor < targetStep) {
                const validationError = _dlValidateImageWizardStep(cursor);
                if (validationError) {
                    if (typeof showToast === 'function') {
                        showToast(validationError, 'warning');
                    }
                    return;
                }
                cursor += 1;
            }

            _dlSetImageWizardStep(targetStep);
        });

        chip.dataset.bound = '1';
    });
}

function _dlInitializeImageRenamePanel() {
    const renameToggleEl = document.getElementById('downloadImgRenameToggle');
    const generateToggleEl = document.getElementById('downloadImgGenerateByFieldToggle');
    const panelEl = document.getElementById('downloadImgRenamePanel');
    const targetSelect = document.getElementById('downloadImgRenameTarget');
    const generateNameFieldEl = document.getElementById('downloadImgGenerateNameField');
    const generateClassFieldEl = document.getElementById('downloadImgGenerateClassField');
    const generateSectionFieldEl = document.getElementById('downloadImgGenerateSectionField');
    const generateCustomDateEl = document.getElementById('downloadImgGenerateCustomDate');

    if (!panelEl || !targetSelect) return;

    _dlImageRenameState.imageFields = _dlGetRenameTargetImageFields();
    _dlImageRenameState.textFields = _dlGetTextFields();

    const canRenameMode = !!renameToggleEl && _dlCanUseRenameMode();
    const canGenerateMode = !!generateToggleEl && _dlCanUseGenerateMode();
    
    // We only need BOTH image and text fields for Rename mode. 
    // Generate mode only strictly needs an image field to start.
    const hasImageFields = _dlImageRenameState.imageFields.length > 0;
    const hasTextFields = _dlImageRenameState.textFields.length > 0;
    const hasRenameData = hasImageFields && hasTextFields;

    console.log('[DownloadWizard] Initializing rename panel...', {
        canRenameMode,
        canGenerateMode,
        hasImageFields,
        hasTextFields,
        imageFieldCount: _dlImageRenameState.imageFields.length,
        textFieldCount: _dlImageRenameState.textFields.length
    });

    if (!canRenameMode && !canGenerateMode) {
        if (panelEl) {
            panelEl.dataset.initialized = '0';
            panelEl.style.display = 'none';
        }
        return;
    }

    // Always show the panel if permissions are there, so the user sees the options.
    if (panelEl) panelEl.style.display = 'block';

    const warningEl = document.getElementById('downloadImgWizardDataWarning');
    if (warningEl) {
        if (!hasImageFields) {
            warningEl.textContent = 'No image columns found in this table. Rename/Generate modes are disabled.';
            warningEl.style.display = 'block';
        } else if (!hasTextFields && canRenameMode) {
            warningEl.textContent = 'No text columns found to use for renaming. Rename mode is disabled.';
            warningEl.style.display = 'block';
        } else {
            warningEl.style.display = 'none';
        }
    }

    if (renameToggleEl) {
        renameToggleEl.disabled = !hasRenameData || !canRenameMode;
        if (!hasRenameData || !canRenameMode) renameToggleEl.checked = false;
    }
    if (generateToggleEl) {
        generateToggleEl.disabled = !hasImageFields || !canGenerateMode;
        if (!hasImageFields || !canGenerateMode) generateToggleEl.checked = false;
    }

    if (renameToggleEl && renameToggleEl.checked) {
        _dlSetActiveImageMode('rename');
    } else if (generateToggleEl && generateToggleEl.checked) {
        _dlSetActiveImageMode('generate');
    } else {
        _dlSetActiveImageMode('');
    }

    const currentSelectedImage = _dlImageRenameState.selectedImageField;
    const preferredImageField = _dlImageRenameState.imageFields.some(function(field) {
        return field.name === currentSelectedImage;
    }) ? currentSelectedImage : _dlImageRenameState.imageFields[0].name;

    _dlImageRenameState.selectedImageField = preferredImageField;
    _dlPopulateRenameTargetSelect(targetSelect, _dlImageRenameState.imageFields, preferredImageField);

    const validTextSet = new Set(_dlImageRenameState.textFields.map(function(field) {
        return String(field.name || '').trim();
    }).filter(Boolean));

    const defaultNameField = _dlFindFieldNameByHint(_dlImageRenameState.textFields, ['studentname', 'name', 'custname', 'customername', 'empname']);
    const defaultClassField = _dlFindFieldNameByHint(_dlImageRenameState.textFields, ['class', 'std', 'grade']);
    const defaultSectionField = _dlFindFieldNameByHint(_dlImageRenameState.textFields, ['section', 'sec', 'division']);

    if (!validTextSet.has(_dlImageRenameState.generateNameField)) {
        _dlImageRenameState.generateNameField = defaultNameField || _dlImageRenameState.textFields[0].name;
    }
    if (!validTextSet.has(_dlImageRenameState.generateClassField)) {
        _dlImageRenameState.generateClassField = defaultClassField || _dlImageRenameState.textFields[0].name;
    }
    if (_dlImageRenameState.generateSectionField && !validTextSet.has(_dlImageRenameState.generateSectionField)) {
        _dlImageRenameState.generateSectionField = '';
    }
    if (!_dlImageRenameState.generateSectionField && defaultSectionField && validTextSet.has(defaultSectionField)) {
        _dlImageRenameState.generateSectionField = defaultSectionField;
    }

    if (_dlImageRenameState.generateDetailMode !== 'class_only' && _dlImageRenameState.generateDetailMode !== 'class_section' && _dlImageRenameState.generateDetailMode !== 'custom_date') {
        _dlImageRenameState.generateDetailMode = 'class_only';
    }

    if (_dlImageRenameState.generateSizePreset !== 'size_37x53') {
        _dlImageRenameState.generateSizePreset = 'size_23x34';
    }

    _dlSetGenerateSizePreset(_dlImageRenameState.generateSizePreset);
    _dlSetGenerateDetailMode(_dlImageRenameState.generateDetailMode);

    _dlPopulateTextFieldSelect(generateNameFieldEl, _dlImageRenameState.textFields, _dlImageRenameState.generateNameField);
    _dlPopulateTextFieldSelect(generateClassFieldEl, _dlImageRenameState.textFields, _dlImageRenameState.generateClassField);
    _dlPopulateTextFieldSelect(generateSectionFieldEl, _dlImageRenameState.textFields, _dlImageRenameState.generateSectionField, 'Select section field');

    if (generateNameFieldEl) _dlImageRenameState.generateNameField = String(generateNameFieldEl.value || '').trim();
    if (generateClassFieldEl) _dlImageRenameState.generateClassField = String(generateClassFieldEl.value || '').trim();
    if (generateSectionFieldEl) _dlImageRenameState.generateSectionField = String(generateSectionFieldEl.value || '').trim();
    if (generateCustomDateEl) generateCustomDateEl.value = _dlImageRenameState.generateCustomDate || '';

    const selectedNameFields = _dlImageRenameState.selectedNameFields.length
        ? _dlImageRenameState.selectedNameFields
        : [defaultNameField || _dlImageRenameState.textFields[0].name];

    _dlBindRenamePanelEvents();
    _dlBindImageWizardControls();
    _dlSetSelectedNameFields(selectedNameFields);

    if (!_dlGetActiveImageMode()) {
        _dlImageWizardStep = 1;
    } else if (_dlImageWizardStep < 2) {
        _dlImageWizardStep = 2;
    }

    _dlSyncModeUi();
}

function _dlResetImageRenameControls() {
    const renameToggleEl = document.getElementById('downloadImgRenameToggle');
    const generateToggleEl = document.getElementById('downloadImgGenerateByFieldToggle');
    const panelEl = document.getElementById('downloadImgRenamePanel');
    const formatSelect = document.getElementById('downloadImgFormatSelect');
    const compressToggleEl = document.getElementById('downloadImgCompressToggle');
    const compressTargetInputEl = document.getElementById('downloadImgCompressTargetKb');
    const compressTargetWrapEl = document.getElementById('downloadImgCompressTargetWrap');
    const sizeSmallEl = document.getElementById('downloadImgGenerateSizeSmall');
    const sizeLargeEl = document.getElementById('downloadImgGenerateSizeLarge');
    const detailClassOnlyEl = document.getElementById('downloadImgGenerateDetailClassOnly');
    const detailClassSectionEl = document.getElementById('downloadImgGenerateDetailClassSection');
    const detailCustomDateEl = document.getElementById('downloadImgGenerateDetailCustomDate');
    const generateCustomDateEl = document.getElementById('downloadImgGenerateCustomDate');

    _dlImageRenameState.selectedImageField = '';
    _dlImageRenameState.selectedNameFields = [];
    _dlImageRenameState.mode = '';
    _dlImageRenameState.compressEnabled = false;
    _dlImageRenameState.targetSizeKb = 40;
    _dlImageRenameState.generateSizePreset = 'size_23x34';
    _dlImageRenameState.generateNameField = '';
    _dlImageRenameState.generateDetailMode = 'class_only';
    _dlImageRenameState.generateClassField = '';
    _dlImageRenameState.generateSectionField = '';
    _dlImageRenameState.generateCustomDate = '';
    _dlImageWizardStep = 1;

    if (renameToggleEl) renameToggleEl.checked = false;
    if (generateToggleEl) generateToggleEl.checked = false;
    if (panelEl) panelEl.style.display = 'none';
    if (formatSelect) formatSelect.value = 'zip';
    if (compressToggleEl) compressToggleEl.checked = false;
    if (compressTargetWrapEl) compressTargetWrapEl.style.display = 'none';
    if (compressTargetInputEl) compressTargetInputEl.value = '40';
    if (sizeSmallEl) sizeSmallEl.checked = true;
    if (sizeLargeEl) sizeLargeEl.checked = false;
    if (detailClassOnlyEl) detailClassOnlyEl.checked = true;
    if (detailClassSectionEl) detailClassSectionEl.checked = false;
    if (detailCustomDateEl) detailCustomDateEl.checked = false;
    if (generateCustomDateEl) generateCustomDateEl.value = '';

    _dlInitializeImageRenamePanel();
}

function _dlGetImageRenameOptionsFromModal() {
    const mode = _dlGetActiveImageMode();
    const formatSelect = document.getElementById('downloadImgFormatSelect');
    const compressToggleEl = document.getElementById('downloadImgCompressToggle');
    const compressTargetInputEl = document.getElementById('downloadImgCompressTargetKb');
    const generateNameFieldEl = document.getElementById('downloadImgGenerateNameField');
    const generateClassFieldEl = document.getElementById('downloadImgGenerateClassField');
    const generateSectionFieldEl = document.getElementById('downloadImgGenerateSectionField');
    const generateCustomDateEl = document.getElementById('downloadImgGenerateCustomDate');

    if (!mode) return null;

    const selectedImageField = String(_dlImageRenameState.selectedImageField || '').trim();
    if (!selectedImageField) {
        return {
            __error: 'Please select one image column to download.'
        };
    }

    const selectedFormat = formatSelect ? String(formatSelect.value || '').trim() : 'zip';
    const outputFormat = selectedFormat === 'pdf_zip' ? 'pdf_zip' : 'zip';

    const options = {
        enabled: true,
        mode: mode,
        selected_image_field: selectedImageField,
        output_format: outputFormat
    };

    if (mode === 'generate') {
        const nameField = String(
            generateNameFieldEl
                ? generateNameFieldEl.value
                : _dlImageRenameState.generateNameField
        ).trim();
        if (!nameField) {
            return {
                __error: 'Please select at least one field for name.'
            };
        }

        const detailMode = _dlGetGenerateDetailMode();
        const classField = String(
            generateClassFieldEl
                ? generateClassFieldEl.value
                : _dlImageRenameState.generateClassField
        ).trim();
        const sectionField = String(
            generateSectionFieldEl
                ? generateSectionFieldEl.value
                : _dlImageRenameState.generateSectionField
        ).trim();
        const customDate = String(
            generateCustomDateEl
                ? generateCustomDateEl.value
                : _dlImageRenameState.generateCustomDate
        ).trim().slice(0, 40);

        if (detailMode !== 'custom_date' && !classField) {
            return {
                __error: 'Please select class field.'
            };
        }
        if (detailMode === 'class_section' && !sectionField) {
            return {
                __error: 'Please select section field.'
            };
        }
        if (detailMode === 'custom_date' && !customDate) {
            return {
                __error: 'Please enter custom date.'
            };
        }

        const detailFields = [];
        if (detailMode === 'class_only' || detailMode === 'class_section') {
            if (classField && detailFields.indexOf(classField) === -1) detailFields.push(classField);
        }
        if (detailMode === 'class_section') {
            if (sectionField && detailFields.indexOf(sectionField) === -1) detailFields.push(sectionField);
        }

        const imageNameFields = {};
        imageNameFields[selectedImageField] = [nameField].concat(detailFields);
        options.image_name_fields = imageNameFields;

        _dlImageRenameState.generateNameField = nameField;
        _dlImageRenameState.generateClassField = classField;
        _dlImageRenameState.generateSectionField = sectionField;
        _dlImageRenameState.generateCustomDate = customDate;
        _dlImageRenameState.generateDetailMode = detailMode;
        _dlImageRenameState.generateSizePreset = _dlGetGenerateSizePreset();

        const compressEnabled = !!(compressToggleEl && compressToggleEl.checked);
        const targetSizeKb = _dlClampTargetSizeKb(
            compressTargetInputEl
                ? compressTargetInputEl.value
                : _dlImageRenameState.targetSizeKb
        );
        _dlImageRenameState.targetSizeKb = targetSizeKb;
        if (compressTargetInputEl) compressTargetInputEl.value = String(targetSizeKb);

        options.generate_options = {
            enabled: true,
            name_field: nameField,
            detail_fields: detailFields,
            max_detail_lines: 1,
            detail_mode: detailMode,
            class_field: classField,
            section_field: sectionField,
            custom_date: customDate,
            size_preset: _dlImageRenameState.generateSizePreset,
            compress_enabled: compressEnabled,
            target_size_kb: targetSizeKb,
            maintain_dimensions: true
        };

        return options;
    }

    const selectedNameFields = (_dlImageRenameState.selectedNameFields || [])
        .map(function(value) { return String(value || '').trim(); })
        .filter(Boolean);

    if (!selectedNameFields.length) {
        return {
            __error: 'Please select at least one field.'
        };
    }

    const imageNameFields = {};
    imageNameFields[selectedImageField] = selectedNameFields;
    options.image_name_fields = imageNameFields;

    return options;
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
        value = value.replace(/\/{2,}/g, '/');

        // If path contains /media/ or /mediafiles/ anywhere (including absolute FS paths),
        // keep only the marker-relative part.
        var lower = value.toLowerCase();
        var mediaMarker = '/media/';
        var mediafilesMarker = '/mediafiles/';
        var markerIndexMediafiles = lower.indexOf(mediafilesMarker);
        if (markerIndexMediafiles !== -1) {
            value = value.slice(markerIndexMediafiles + mediafilesMarker.length);
            value = 'mediafiles/' + value;
        } else {
            var markerIndexMedia = lower.indexOf(mediaMarker);
            if (markerIndexMedia !== -1) {
                value = value.slice(markerIndexMedia + mediaMarker.length);
                value = 'media/' + value;
            }
        }

        value = value.replace(/^\/+/, '');
        value = value.replace(/\/{2,}/g, '/');
        return value;
    }

    function toMediaUrl(rawPath) {
        var original = String(rawPath || '').trim();
        if (!original || original === 'NOT_FOUND' || original.indexOf('PENDING:') === 0) return '';
        if (/^https?:\/\//i.test(original)) return original;

        var normalized = normalizeMediaPath(original);
        if (!normalized || normalized === 'NOT_FOUND' || normalized.indexOf('PENDING:') === 0) return '';

        normalized = normalized.replace(/^\/+/, '');
        var lower = normalized.toLowerCase();

        // Django serves uploads via /media/<path>; map both legacy "media/"
        // and new "mediafiles/" relative values under that route.
        if (lower.indexOf('media/') === 0) {
            normalized = normalized.slice('media/'.length);
        }

        return '/media/' + normalized;
    }

    function toThumbnailPath(rawPath) {
        var normalized = normalizeMediaPath(rawPath);
        if (!normalized || normalized === 'NOT_FOUND' || normalized.indexOf('PENDING:') === 0) return '';

        normalized = normalized.replace(/^\/+/, '');
        var lower = normalized.toLowerCase();
        if (lower.indexOf('media/') === 0) {
            normalized = normalized.slice('media/'.length);
            lower = normalized.toLowerCase();
        }

        if (lower.indexOf('thumbs/') === 0 || lower.indexOf('/thumbs/') !== -1) {
            return normalized;
        }

        var parts = normalized.split('/');
        if (parts.length < 2) return normalized;

        var baseFolder = parts.shift();
        var rest = parts.join('/');
        var dot = rest.lastIndexOf('.');
        if (dot > 0) {
            rest = rest.slice(0, dot) + '.webp';
        }
        return baseFolder + '/thumbs/' + rest;
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

        return fieldData;
    }

    function updateCardInline(cardId, fieldData) {
        var formData = new FormData();
        formData.append('field_data', JSON.stringify(fieldData || {}));
        formData.append('reprint_modal_edit', '1');
        return ApiClient.upload('/api/card/' + cardId + '/update/', formData)
            .then(function(data) {
                if (data && data.success) return data.card || null;
                throw new Error((data && data.message) || 'Could not save card changes');
            });
    }

    function uploadImageInline(cardId, fieldName, file) {
        var normalizedFieldName = String(fieldName || '').trim();
        if (!normalizedFieldName) {
            return Promise.reject(new Error('Image field is missing'));
        }

        var formData = new FormData();
        var fieldDataPayload = {};
        // Keep the image field present in payload so backend image-field loop runs.
        fieldDataPayload[normalizedFieldName] = null;
        formData.append('field_data', JSON.stringify(fieldDataPayload));
        formData.append('reprint_modal_edit', '1');

        // Backend update service expects multipart file keys as image_<field_name>.
        formData.append('image_' + normalizedFieldName, file);

        // Backward-compatible fallback for legacy PHOTO handling.
        if (normalizedFieldName.toUpperCase() === 'PHOTO') {
            formData.append('photo', file);
        }

        return ApiClient.upload('/api/card/' + cardId + '/update/', formData)
            .then(function(data) {
                if (data && data.success) return data.card || null;
                throw new Error((data && data.message) || 'Could not upload image');
            });
    }

    function isClientEditLockedStatus() {
        if (!window.IS_CLIENT_USER) return false;

        var currentStatus = String(typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : '').toLowerCase();
        var lockedStatuses = Array.isArray(window.CLIENT_READONLY_STATUSES)
            ? window.CLIENT_READONLY_STATUSES.map(function(v) { return String(v || '').toLowerCase(); })
            : ['approved', 'download', 'reprint'];

        return lockedStatuses.indexOf(currentStatus) !== -1;
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
        var requestPayload = { card_ids: ids };
        var submitPromise;
        if (inlineEditMode) {
            if (inlineDirtyCount > 0) {
                requestPayload.inline_field_data = collectInlineFieldData(cardId);
                if (isClientEditLockedStatus()) {
                    submitPromise = ApiClient.post(endpoints.requestCreate, requestPayload);
                } else {
                    submitPromise = updateCardInline(cardId, collectInlineFieldData(cardId))
                        .then(function() { return ApiClient.post(endpoints.requestCreate, requestPayload); });
                }
            } else {
                submitPromise = ApiClient.post(endpoints.requestCreate, requestPayload);
            }
        } else {
            submitPromise = ApiClient.post(endpoints.requestCreate, requestPayload);
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
            .catch(function(err) {
                var msg = (err && err.data && err.data.message) || (err && err.message) || 'Could not create reprint request';
                if (typeof showToast === 'function') showToast(msg, 'error');
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
                    var msg = (err && err.data && err.data.message) || (err && err.message) || 'Could not upload image';
                    if (typeof showToast === 'function') showToast(msg, 'error');
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
    if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter) {
        window.IDCardApp.downloadProgressPresenter.setType('img');
    }
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
    _dlSetImageWizardStep(1);

    downloadImgModal.style.display = 'flex';
}

function closeDownloadImgModal() {
    if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter && window.IDCardApp.downloadProgressPresenter.isActive()) {
        window.IDCardApp.downloadProgressPresenter.cancel();
    }
    if (downloadImgModal) {
        downloadImgModal.style.display = 'none';
    }
    if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter) {
        window.IDCardApp.downloadProgressPresenter.clear();
    }
    pendingDownloadCardIds = [];
    currentDownloadType = null;
}

function markNextBulkUiLock() {
    window.IDCardApp = window.IDCardApp || {};
    window.IDCardApp._nextBulkUiLock = true;
}

function initDownloadImagesHandlers() {
    try {
        console.log('[DL] initDownloadImagesHandlers start');
    } catch (e) {}
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
    _dlBindImageWizardControls();

    const renameToggleEl = document.getElementById('downloadImgRenameToggle');
    const generateToggleEl = document.getElementById('downloadImgGenerateByFieldToggle');

    if (renameToggleEl && renameToggleEl.dataset.modeBound !== '1') {
        renameToggleEl.addEventListener('change', function() {
            if (this.checked) {
                if (generateToggleEl) generateToggleEl.checked = false;
                _dlSetActiveImageMode('rename');
                _dlInitializeImageRenamePanel();
                _dlSetImageWizardStep(2);
                return;
            }

            if (generateToggleEl && generateToggleEl.checked) {
                _dlSetActiveImageMode('generate');
                _dlSetImageWizardStep(2);
            } else {
                _dlSetActiveImageMode('');
                _dlSetImageWizardStep(1);
            }
            _dlInitializeImageRenamePanel();
        });
        renameToggleEl.dataset.modeBound = '1';
    }

    if (generateToggleEl && generateToggleEl.dataset.modeBound !== '1') {
        generateToggleEl.addEventListener('change', function() {
            if (this.checked) {
                if (renameToggleEl) renameToggleEl.checked = false;
                _dlSetActiveImageMode('generate');
                _dlInitializeImageRenamePanel();
                _dlSetImageWizardStep(2);
                return;
            }

            if (renameToggleEl && renameToggleEl.checked) {
                _dlSetActiveImageMode('rename');
                _dlSetImageWizardStep(2);
            } else {
                _dlSetActiveImageMode('');
                _dlSetImageWizardStep(1);
            }
            _dlInitializeImageRenamePanel();
        });
        generateToggleEl.dataset.modeBound = '1';
    }

    document.getElementById('downloadImgConfirm')?.addEventListener('click', function() {
        try {
            console.log('[DL] downloadImgConfirm clicked');
        } catch (e) {}
        const mode = _dlGetActiveImageMode();
        if (mode) {
            const maxStep = _dlGetImageWizardMaxStep();
            const validationError = _dlValidateImageWizardStep(maxStep);
            if (validationError) {
                if (typeof showToast === 'function') {
                    showToast(validationError, 'warning');
                }
                return;
            }
        }

        const selectedCardIds = Array.isArray(pendingDownloadCardIds) ? pendingDownloadCardIds.slice() : [];
        const renameOptions = mode ? _dlGetImageRenameOptionsFromModal() : null;

        if (renameOptions && renameOptions.__error) {
            if (typeof showToast === 'function') {
                showToast(renameOptions.__error, 'warning');
            }
            return;
        }

        if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter) {
            window.IDCardApp.downloadProgressPresenter.prepare('Preparing download...', -1);
        }
        markNextBulkUiLock();
        window.IDCardApp.downloadImages(selectedCardIds, renameOptions);
    });
    try {
        console.log('[DL] initDownloadImagesHandlers bound handlers');
    } catch (e) {}
}

// ==========================================
// DOWNLOAD DOCX MODAL
// ==========================================

let pendingDocxDownloadIds = [];
let pendingDocxFormat = 'docx';

function _setDocxFormatSelection(format) {
    const normalizedFormat = format === 'doc' ? 'doc' : 'docx';
    pendingDocxFormat = normalizedFormat;

    const docxCard = document.getElementById('downloadDocxFormatCardDocx');
    const docCard = document.getElementById('downloadDocxFormatCardDoc');

    if (docxCard) {
        docxCard.classList.toggle('is-active', normalizedFormat === 'docx');
    }
    if (docCard) {
        docCard.classList.toggle('is-active', normalizedFormat === 'doc');
    }
}

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
    try { console.log('[DL] openDownloadDocxModal', {cardIdsCount: Array.isArray(cardIds)?cardIds.length:0, format: format}); } catch (e) {}
    pendingDocxDownloadIds = cardIds;
    pendingDocxFormat = format || 'docx';
    currentDownloadType = 'docx';
    if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter) {
        window.IDCardApp.downloadProgressPresenter.setType('docx');
    }
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
    _setDocxFormatSelection(pendingDocxFormat);
    // Load templates dynamically (from init sub-module)
    if (window.IDCardApp._loadExportTemplates) window.IDCardApp._loadExportTemplates(false);
    modal.style.display = 'flex';
}

function closeDownloadDocxModal() {
    const modal = document.getElementById('downloadDocxModal');
    // If a bulk-download flow was just initiated, avoid closing the modal immediately.
    if (window.IDCardApp && window.IDCardApp._nextBulkUiLock) {
        try { console.log('[DL] skip closeDownloadDocxModal due to _nextBulkUiLock'); } catch (e) {}
        return;
    }

    if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter && window.IDCardApp.downloadProgressPresenter.isActive()) {
        window.IDCardApp.downloadProgressPresenter.cancel();
    }
    if (modal) modal.style.display = 'none';
    if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter) {
        window.IDCardApp.downloadProgressPresenter.clear();
    }
    currentDownloadType = null;
}

function initDownloadDocxHandlers() {
    try { console.log('[DL] initDownloadDocxHandlers start'); } catch (e) {}
    try {
    document.querySelectorAll('[data-docx-format]').forEach(card => {
        const activateFormat = function() {
            const format = card.getAttribute('data-docx-format');
            if (format) _setDocxFormatSelection(format);
        };

        card.addEventListener('click', activateFormat);
        card.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activateFormat();
            }
        });
    });

    // Docx template modal handlers
    document.getElementById('downloadDocxCancel')?.addEventListener('click', closeDownloadDocxModal);
    document.getElementById('downloadDocxClose')?.addEventListener('click', closeDownloadDocxModal);
    document.getElementById('downloadDocxConfirm')?.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const templateSelect = document.getElementById('downloadDocxTemplate');
        const templateId = templateSelect ? templateSelect.value : '';
        if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter) {
            // Ensure presenter type is set before preparing so isActive() returns true
            try { window.IDCardApp.downloadProgressPresenter.setType('docx'); } catch (err) {}
            window.IDCardApp.downloadProgressPresenter.prepare('Preparing download...', -1);
        }
        markNextBulkUiLock();
        window.IDCardApp.downloadDocx(pendingDocxDownloadIds, pendingDocxFormat, templateId);
    });

    const downloadDocxBtnIds = ['downloadDocxBtn', 'downloadDocxBtnV', 'downloadDocxBtnP', 'downloadDocxBtnA', 'downloadDocxBtnD'];

    downloadDocxBtnIds.forEach(btnId => {
        document.getElementById(btnId)?.addEventListener('click', async function() {
            this.disabled = true;
            try {
                let cardIds = (window.IDCardApp && typeof window.IDCardApp.getAllCardIdsForAction === 'function') ? await window.IDCardApp.getAllCardIdsForAction() : [];
                openDownloadDocxModal(cardIds, 'docx');
            } catch (error) {
                console.error('Error getting card IDs for download:', error);
                openDownloadDocxModal([], 'docx');
            } finally {
                this.disabled = false;
            }
        });
    });
    } catch (err) { console.error('[DL] initDownloadDocxHandlers error', err); }
    try { console.log('[DL] initDownloadDocxHandlers bound handlers'); } catch (e) {}
}

// ==========================================
// DOWNLOAD XLSX MODAL
// ==========================================

function openDownloadXlsxModal(cardIds) {
    pendingDownloadCardIds = cardIds;
    currentDownloadType = 'xlsx';
    if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter) {
        window.IDCardApp.downloadProgressPresenter.setType('xlsx');
    }
    downloadXlsxModal = document.getElementById('downloadXlsxModal');

    if (!downloadXlsxModal) {
        // Fallback: download directly if modal not found
        window.IDCardApp.downloadXlsx(cardIds);
        return;
    }

    const listNameEl = document.getElementById('downloadXlsxListName');
    const cardCountEl = document.getElementById('downloadXlsxCardCount');
    const includeImagesEl = document.getElementById('downloadXlsxIncludeImages');

    if (listNameEl) listNameEl.textContent = _getStatusLabel() + ' List';
    // Show "All" if no specific cards selected, otherwise show the count
    if (cardCountEl) cardCountEl.textContent = cardIds.length > 0 ? cardIds.length : 'All';
    if (includeImagesEl) includeImagesEl.checked = false;

    downloadXlsxModal.style.display = 'flex';
}

function closeDownloadXlsxModal() {
    if (window.IDCardApp && window.IDCardApp._nextBulkUiLock) {
        try { console.log('[DL] skip closeDownloadXlsxModal due to _nextBulkUiLock'); } catch (e) {}
        return;
    }

    if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter && window.IDCardApp.downloadProgressPresenter.isActive()) {
        window.IDCardApp.downloadProgressPresenter.cancel();
    }
    if (downloadXlsxModal) {
        downloadXlsxModal.style.display = 'none';
    }
    const includeImagesEl = document.getElementById('downloadXlsxIncludeImages');
    if (includeImagesEl) includeImagesEl.checked = false;
    if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter) {
        window.IDCardApp.downloadProgressPresenter.clear();
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
    document.getElementById('downloadXlsxConfirm')?.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const includeImagesEl = document.getElementById('downloadXlsxIncludeImages');
        const includeImagesZip = !!(includeImagesEl && includeImagesEl.checked);
        const cardIds = Array.isArray(pendingDownloadCardIds) ? pendingDownloadCardIds.slice() : [];
        if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter) {
            try { window.IDCardApp.downloadProgressPresenter.setType('xlsx'); } catch (err) {}
            window.IDCardApp.downloadProgressPresenter.prepare('Preparing download...', -1);
        }
        markNextBulkUiLock();
        window.IDCardApp.downloadXlsx(cardIds, { includeImagesZip: includeImagesZip });
    });
}

// ==========================================
// DOWNLOAD PDF MODAL (with template selection)
// ==========================================

let pendingPdfCardIds = [];
let selectedPdfTemplate = 'default';

function setPdfBreakModeSelection(mode) {
    var breakSectionCb = document.getElementById('downloadPdfBreakClassSection');
    var breakClassOnlyCb = document.getElementById('downloadPdfBreakClassOnly');
    var resolved = (mode === 'class_only') ? 'class_only' : 'class_section';

    if (breakSectionCb) breakSectionCb.checked = (resolved === 'class_section');
    if (breakClassOnlyCb) breakClassOnlyCb.checked = (resolved === 'class_only');
}

function readPdfBreakModeSelection() {
    var breakClassOnlyCb = document.getElementById('downloadPdfBreakClassOnly');
    return (breakClassOnlyCb && breakClassOnlyCb.checked) ? 'class_only' : 'class_section';
}

function bindPdfBreakModeCheckboxes() {
    var breakSectionCb = document.getElementById('downloadPdfBreakClassSection');
    var breakClassOnlyCb = document.getElementById('downloadPdfBreakClassOnly');
    if (!breakSectionCb || !breakClassOnlyCb) return;

    breakSectionCb.addEventListener('change', function() {
        if (breakSectionCb.checked) {
            breakClassOnlyCb.checked = false;
        } else if (!breakClassOnlyCb.checked) {
            breakSectionCb.checked = true;
        }
    });

    breakClassOnlyCb.addEventListener('change', function() {
        if (breakClassOnlyCb.checked) {
            breakSectionCb.checked = false;
        } else if (!breakSectionCb.checked) {
            breakClassOnlyCb.checked = true;
        }
    });
}

function openDownloadPdfModal(cardIds) {
    pendingPdfCardIds = cardIds;
    currentDownloadType = 'pdf';
    if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter) {
        window.IDCardApp.downloadProgressPresenter.setType('pdf');
    }
    downloadPdfModal = document.getElementById('downloadPdfModal');

    if (!downloadPdfModal) {
        // Fallback: download directly if modal not found
        window.IDCardApp.downloadPdf(cardIds, '', 'auto', false, 'class_section');
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

    // Default break mode for each open: class + section
    setPdfBreakModeSelection('class_section');

    // Load templates dynamically (from init sub-module)
    if (window.IDCardApp._loadExportTemplates) window.IDCardApp._loadExportTemplates(false);

    downloadPdfModal.style.display = 'flex';
}

function closeDownloadPdfModal() {
    if (window.IDCardApp && window.IDCardApp._nextBulkUiLock) {
        try { console.log('[DL] skip closeDownloadPdfModal due to _nextBulkUiLock'); } catch (e) {}
        return;
    }

    if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter && window.IDCardApp.downloadProgressPresenter.isActive()) {
        window.IDCardApp.downloadProgressPresenter.cancel();
    }
    if (downloadPdfModal) {
        downloadPdfModal.style.display = 'none';
    }
    pendingPdfCardIds = [];
    // Reset shorten-titles checkbox for next open
    var shortenCb = document.getElementById('downloadPdfShortenTitles');
    if (shortenCb) shortenCb.checked = false;
    // Reset break-mode checkboxes for next open (default: class + section)
    setPdfBreakModeSelection('class_section');
    if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter) {
        window.IDCardApp.downloadProgressPresenter.clear();
    }
    currentDownloadType = null;
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
    document.getElementById('downloadPdfConfirm')?.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const templateSelect = document.getElementById('downloadPdfTemplate');
        const templateId = templateSelect ? templateSelect.value : '';
        var fontMode = 'auto';
        // Read shorten-titles checkbox
        var shortenCb = document.getElementById('downloadPdfShortenTitles');
        var shortenTitles = shortenCb ? shortenCb.checked : false;
        // Read break-mode checkboxes
        var breakMode = readPdfBreakModeSelection();
        var cardIdsToDownload = Array.isArray(pendingPdfCardIds) ? pendingPdfCardIds.slice() : [];
        if (window.IDCardApp && window.IDCardApp.downloadProgressPresenter) {
            try { window.IDCardApp.downloadProgressPresenter.setType('pdf'); } catch (err) {}
            window.IDCardApp.downloadProgressPresenter.prepare('Preparing download...', -1);
        }
        markNextBulkUiLock();
        window.IDCardApp.downloadPdf(cardIdsToDownload, templateId, fontMode, shortenTitles, breakMode);
    });

    bindPdfBreakModeCheckboxes();

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
