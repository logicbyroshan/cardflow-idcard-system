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

    if (step1El) step1El.style.display = hasMode ? (_dlImageWizardStep === 1 ? 'block' : 'none') : 'block';
    if (step2El) step2El.style.display = (mode && _dlImageWizardStep === 2) ? 'block' : 'none';
    if (renameStepEl) renameStepEl.style.display = (mode === 'rename' && _dlImageWizardStep === 3) ? 'block' : 'none';
    if (generateStepEl) generateStepEl.style.display = (mode === 'generate' && _dlImageWizardStep === 3) ? 'block' : 'none';
    if (step4El) step4El.style.display = (mode === 'generate' && _dlImageWizardStep === 4) ? 'block' : 'none';

    if (wizardProgressEl) wizardProgressEl.style.display = hasMode ? 'grid' : 'none';
    if (wizardNavEl) wizardNavEl.style.display = hasMode ? 'flex' : 'none';
    if (step1HeadingEl) {
        step1HeadingEl.textContent = hasMode ? 'Step 1: Choose Mode' : 'Optional: Choose Mode';
    }
    if (modeHelperEl) {
        modeHelperEl.textContent = hasMode
            ? 'Choose one mode. Use Next to continue to base settings.'
            : 'Leave both unchecked to download all image columns normally.';
    }

    chips.forEach(function(chip) {
        const rawStep = chip.getAttribute('data-dl-wizard-chip');
        const stepNum = parseInt(String(rawStep || ''), 10);
        if (!Number.isFinite(stepNum)) return;

        chip.classList.toggle('is-active', stepNum === _dlImageWizardStep);
        chip.classList.toggle('is-complete', stepNum < _dlImageWizardStep && stepNum <= maxStep);
        chip.classList.toggle('is-disabled', stepNum > maxStep);
    });

    if (stepLabelEl) {
        stepLabelEl.textContent = hasMode ? ('Step ' + _dlImageWizardStep + ' of ' + maxStep) : '';
    }

    if (backBtn) {
        backBtn.disabled = _dlImageWizardStep <= 1;
    }

    if (nextBtn) {
        const isFinalStep = _dlImageWizardStep >= maxStep;
        nextBtn.disabled = isFinalStep;
        nextBtn.style.display = isFinalStep ? 'none' : '';
        nextBtn.textContent = 'Next';
    }

    if (confirmBtn) {
        confirmBtn.disabled = hasMode ? !(_dlImageWizardStep === maxStep) : false;
        confirmBtn.textContent = hasMode ? 'Download' : 'Download All Images';
    }
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
    const hasRenameData = _dlImageRenameState.imageFields.length > 0 && _dlImageRenameState.textFields.length > 0;

    if (renameToggleEl) {
        renameToggleEl.disabled = !hasRenameData || !canRenameMode;
        if (!canRenameMode) renameToggleEl.checked = false;
    }
    if (generateToggleEl) {
        generateToggleEl.disabled = !hasRenameData || !canGenerateMode;
        if (!canGenerateMode) generateToggleEl.checked = false;
    }

    if ((!canRenameMode && !canGenerateMode) || !hasRenameData) {
        if (renameToggleEl) renameToggleEl.checked = false;
        if (generateToggleEl) generateToggleEl.checked = false;
        _dlImageWizardStep = 1;
        panelEl.style.display = 'none';
        _dlImageRenameState.selectedImageField = '';
        _dlSetSelectedNameFields([]);
        _dlSyncModeUi();
        return;
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
// // ==========================================
// DOWNLOAD IMAGES MODAL
// ==========================================

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
    _dlSetImageWizardStep(1);

    downloadImgModal.style.display = 'flex';
}

function closeDownloadImgModal() {
    if (downloadImgModal) {
        downloadImgModal.style.display = 'none';
    }
    pendingDownloadCardIds = [];
    currentDownloadType = null;
}

function markNextBulkUiLock() {
    window.IDCardApp = window.IDCardApp || {};
    window.IDCardApp._nextBulkUiLock = true;
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
        const mode = _dlGetActiveImageMode();
        if (mode) {
            const maxStep = _dlGetImageWizardMaxStep();
            if (_dlImageWizardStep < maxStep) {
                if (typeof showToast === 'function') {
                    showToast('Please complete all steps before downloading.', 'warning');
                }
                return;
            }

            const validationError = _dlValidateImageWizardStep(Math.max(1, maxStep - 1));
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

        closeDownloadImgModal();
        markNextBulkUiLock();
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
        markNextBulkUiLock();
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
    const includeImagesEl = document.getElementById('downloadXlsxIncludeImages');

    if (listNameEl) listNameEl.textContent = _getStatusLabel() + ' List';
    // Show "All" if no specific cards selected, otherwise show the count
    if (cardCountEl) cardCountEl.textContent = cardIds.length > 0 ? cardIds.length : 'All';
    if (includeImagesEl) includeImagesEl.checked = false;

    downloadXlsxModal.style.display = 'flex';
}

function closeDownloadXlsxModal() {
    if (downloadXlsxModal) {
        downloadXlsxModal.style.display = 'none';
    }
    const includeImagesEl = document.getElementById('downloadXlsxIncludeImages');
    if (includeImagesEl) includeImagesEl.checked = false;
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
        const includeImagesEl = document.getElementById('downloadXlsxIncludeImages');
        const includeImagesZip = !!(includeImagesEl && includeImagesEl.checked);
        const cardIds = Array.isArray(pendingDownloadCardIds) ? pendingDownloadCardIds.slice() : [];
        closeDownloadXlsxModal();
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
    if (downloadPdfModal) {
        downloadPdfModal.style.display = 'none';
    }
    pendingPdfCardIds = [];
    // Reset shorten-titles checkbox for next open
    var shortenCb = document.getElementById('downloadPdfShortenTitles');
    if (shortenCb) shortenCb.checked = false;
    // Reset break-mode checkboxes for next open (default: class + section)
    setPdfBreakModeSelection('class_section');
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
        // Read break-mode checkboxes
        var breakMode = readPdfBreakModeSelection();
        var cardIdsToDownload = Array.isArray(pendingPdfCardIds) ? pendingPdfCardIds.slice() : [];
        closeDownloadPdfModal();
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

})();
