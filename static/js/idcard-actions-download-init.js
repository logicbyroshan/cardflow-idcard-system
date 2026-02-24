// ID Card Actions - Download Init Sub-module
// Template loading, reupload section, initDownloadModule, shared helpers
// Part of IDCardApp module system — registers functions on window.IDCardApp

(function() {
'use strict';

// ==========================================
// SHARED HELPERS
// ==========================================

/**
 * Get current status label for request body.
 */
function _getCurrentStatus() {
    return typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : '';
}

// ==========================================
// EXPORT TEMPLATE MANAGEMENT
// ==========================================

// Cached export templates (loaded once, refreshed on modal open)
let _cachedExportTemplates = null;

/**
 * Fetch export templates from the API and populate all template dropdowns.
 * Called lazily when a PDF or Word modal opens.
 */
async function _loadExportTemplates(force) {
    if (_cachedExportTemplates && !force) {
        _populateTemplateDropdowns(_cachedExportTemplates);
        return;
    }
    try {
        const resp = await fetch('/panel/api/export-templates/', {
            headers: { 'Accept': 'application/json' }
        });
        if (resp.ok) {
            const data = await resp.json();
            if (data.success) {
                _cachedExportTemplates = data.templates || [];
                _populateTemplateDropdowns(_cachedExportTemplates);
            }
        }
    } catch (e) {
        console.error('Failed to load export templates:', e);
    }
}

function _populateTemplateDropdowns(templates) {
    const selectors = ['downloadPdfTemplate', 'downloadDocxTemplate'];
    selectors.forEach(function(selId) {
        const sel = document.getElementById(selId);
        if (!sel) return;
        // Preserve current selection
        const prev = sel.value;
        sel.innerHTML = '<option value="">Default (No Footer Instructions)</option>';
        templates.forEach(function(tpl) {
            const opt = document.createElement('option');
            opt.value = String(tpl.id);
            opt.textContent = tpl.name;
            if (tpl.is_default) opt.setAttribute('data-default', '1');
            sel.appendChild(opt);
        });
        // Restore selection or pick default
        if (prev && sel.querySelector('option[value="' + prev + '"]')) {
            sel.value = prev;
        } else {
            // Auto-select the default template if any
            const defaultOpt = sel.querySelector('option[data-default="1"]');
            if (defaultOpt) sel.value = defaultOpt.value;
        }
    });
}

// ==========================================
// REUPLOAD IMAGES (Modal-based)
// ==========================================

let pendingReuploadCardIds = [];

// Modal DOM references (set in initReuploadHandlers)
let reuploadActionsModal = null;
let reuploadActionsFileInput = null;
let reuploadActionsDropZone = null;
let reuploadActionsFileName = null;
let reuploadActionsConfirmBtn = null;
let reuploadActionsCancelBtn = null;
let reuploadActionsListName = null;
let reuploadActionsCardCount = null;
let reuploadActionsProgress = null;
let reuploadActionsBar = null;
let reuploadActionsStatus = null;

const STATUS_LABELS = {
    pending: 'Pending',
    verified: 'Verified',
    approved: 'Approved',
    download: 'Download',
    pool: 'Pool'
};

function reuploadImages(cardIds) {
    pendingReuploadCardIds = cardIds || [];
    openReuploadActionsModal();
}

function openReuploadActionsModal() {
    if (!reuploadActionsModal) {
        console.error('Reupload modal not found in DOM (#reuploadActionsModal)');
        return;
    }
    // Card IDs should already be set by the button handler via getAllCardIdsForAction()
    // Only fallback to visible cards if something went wrong (should not happen normally)
    if (pendingReuploadCardIds.length === 0 && typeof getAllVisibleCardIds === 'function') {
        pendingReuploadCardIds = getAllVisibleCardIds();
    }
    const statusLabel = STATUS_LABELS[typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : 'pending'] || 'Current';
    if (reuploadActionsListName) reuploadActionsListName.textContent = statusLabel + ' List';
    if (reuploadActionsCardCount) reuploadActionsCardCount.textContent = pendingReuploadCardIds.length;
    if (reuploadActionsFileInput) reuploadActionsFileInput.value = '';
    if (reuploadActionsFileName) reuploadActionsFileName.textContent = 'Click or drag & drop a ZIP file';
    if (reuploadActionsConfirmBtn) {
        reuploadActionsConfirmBtn.disabled = true;
        reuploadActionsConfirmBtn.textContent = 'Upload & Match';
    }
    if (reuploadActionsProgress) reuploadActionsProgress.style.display = 'none';
    if (reuploadActionsBar) reuploadActionsBar.style.width = '0%';
    reuploadActionsModal.style.display = 'flex';
}

function closeReuploadActionsModal() {
    if (!reuploadActionsModal) return;
    reuploadActionsModal.style.display = 'none';
    if (reuploadActionsFileInput) reuploadActionsFileInput.value = '';
    pendingReuploadCardIds = [];
}

function initReuploadHandlers() {
    // Get modal elements
    reuploadActionsModal = document.getElementById('reuploadActionsModal');
    reuploadActionsFileInput = document.getElementById('reuploadActionsFileInput');
    reuploadActionsDropZone = document.getElementById('reuploadActionsDropZone');
    reuploadActionsFileName = document.getElementById('reuploadActionsFileName');
    reuploadActionsConfirmBtn = document.getElementById('reuploadActionsConfirm');
    reuploadActionsCancelBtn = document.getElementById('reuploadActionsCancel');
    reuploadActionsListName = document.getElementById('reuploadActionsListName');
    reuploadActionsCardCount = document.getElementById('reuploadActionsCardCount');
    reuploadActionsProgress = document.getElementById('reuploadActionsProgress');
    reuploadActionsBar = document.getElementById('reuploadActionsBar');
    reuploadActionsStatus = document.getElementById('reuploadActionsStatus');

    // Drop zone — click opens file picker
    if (reuploadActionsDropZone) {
        reuploadActionsDropZone.addEventListener('click', function() {
            if (reuploadActionsFileInput) reuploadActionsFileInput.click();
        });
        reuploadActionsDropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            this.style.borderColor = '#d1d5db';
            this.style.backgroundColor = '';
            if (e.dataTransfer.files.length && e.dataTransfer.files[0].name.toLowerCase().endsWith('.zip')) {
                reuploadActionsFileInput.files = e.dataTransfer.files;
                reuploadActionsFileInput.dispatchEvent(new Event('change'));
            } else {
                if (typeof showToast === 'function') showToast('Only ZIP files are allowed', false);
            }
        });
    }

    // File input change — validate ZIP and enable confirm
    if (reuploadActionsFileInput) {
        reuploadActionsFileInput.addEventListener('change', function() {
            if (this.files.length) {
                const file = this.files[0];
                if (!file.name.toLowerCase().endsWith('.zip')) {
                    if (typeof showToast === 'function') showToast('Only ZIP files are allowed', false);
                    this.value = '';
                    if (reuploadActionsFileName) reuploadActionsFileName.textContent = 'Click or drag & drop a ZIP file';
                    if (reuploadActionsConfirmBtn) {
                        reuploadActionsConfirmBtn.disabled = true;
                    }
                    return;
                }
                if (reuploadActionsFileName) reuploadActionsFileName.textContent = file.name;
                if (reuploadActionsConfirmBtn) {
                    reuploadActionsConfirmBtn.disabled = false;
                }
            }
        });
    }

    // Cancel & backdrop close
    if (reuploadActionsCancelBtn) reuploadActionsCancelBtn.addEventListener('click', closeReuploadActionsModal);
    if (reuploadActionsModal) reuploadActionsModal.addEventListener('click', function(e) { if (e.target === reuploadActionsModal) closeReuploadActionsModal(); });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && reuploadActionsModal && reuploadActionsModal.style.display === 'flex') closeReuploadActionsModal();
    });

    // Confirm — upload ZIP via XHR
    if (reuploadActionsConfirmBtn) {
        reuploadActionsConfirmBtn.addEventListener('click', function() {
            if (!reuploadActionsFileInput || !reuploadActionsFileInput.files.length) return;

            const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
            if (!tableId) {
                if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
                return;
            }

            reuploadActionsConfirmBtn.disabled = true;
            reuploadActionsConfirmBtn.textContent = 'Uploading...';
            if (reuploadActionsProgress) reuploadActionsProgress.style.display = 'block';
            if (reuploadActionsBar) reuploadActionsBar.style.width = '30%';
            if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Uploading ZIP...';

            const formData = new FormData();
            formData.append('photos_zip', reuploadActionsFileInput.files[0]);
            formData.append('card_ids', JSON.stringify(pendingReuploadCardIds));
            formData.append('status', _getCurrentStatus());

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/panel/api/table/${tableId}/cards/reupload-images/`, true);
            xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');

            xhr.upload.onprogress = function(event) {
                if (event.lengthComputable) {
                    const pct = Math.round((event.loaded / event.total) * 60) + 30;
                    if (reuploadActionsBar) reuploadActionsBar.style.width = pct + '%';
                    if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Uploading... ' + Math.round((event.loaded / event.total) * 100) + '%';
                }
            };

            xhr.onload = function() {
                if (reuploadActionsBar) reuploadActionsBar.style.width = '100%';
                try {
                    const result = JSON.parse(xhr.responseText);
                    if (xhr.status === 200 && result.success) {
                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = result.message || 'Done!';
                        if (typeof showToast === 'function') showToast(result.message || 'Images reuploaded successfully!', true);
                        setTimeout(function() {
                            closeReuploadActionsModal();
                            if (window.IDCardApp && typeof window.IDCardApp.refreshCardTable === 'function') {
                                window.IDCardApp.refreshCardTable();
                            } else {
                                window.location.reload();
                            }
                        }, 1500);
                    } else {
                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = result.message || 'Failed';
                        if (typeof showToast === 'function') showToast(result.message || 'Reupload failed', false);
                        reuploadActionsConfirmBtn.disabled = false;
                        reuploadActionsConfirmBtn.textContent = 'Upload & Match';
                    }
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Error processing response', false);
                    reuploadActionsConfirmBtn.disabled = false;
                    reuploadActionsConfirmBtn.textContent = 'Upload & Match';
                }
            };

            xhr.onerror = function() {
                if (typeof showToast === 'function') showToast('Failed to reupload images', false);
                reuploadActionsConfirmBtn.disabled = false;
                reuploadActionsConfirmBtn.textContent = 'Upload & Match';
                if (reuploadActionsProgress) reuploadActionsProgress.style.display = 'none';
            };

            xhr.send(formData);
        });
    }

    const reuploadBtnIds = ['reuploadImageBtn', 'reuploadImageBtnV', 'reuploadImageBtnP', 'reuploadImageBtnA', 'reuploadImageBtnD'];

    reuploadBtnIds.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', async function() {
                this.disabled = true;
                try {
                    pendingReuploadCardIds = (window.IDCardApp && typeof window.IDCardApp.getAllCardIdsForAction === 'function') ? await window.IDCardApp.getAllCardIdsForAction() : [];
                    openReuploadActionsModal();
                } finally {
                    this.disabled = false;
                }
            });
        }
    });
}

// ==========================================
// INITIALIZATION
// ==========================================

function initDownloadModule() {
    window.IDCardApp.initDownloadModals();
    window.IDCardApp.initDownloadImagesHandlers();
    window.IDCardApp.initDownloadDocxHandlers();
    window.IDCardApp.initDownloadXlsxHandlers();
    window.IDCardApp.initDownloadPdfHandlers();
    initReuploadHandlers();
}

// Expose globally
window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.initDownloadModule = initDownloadModule;
window.IDCardApp.reuploadImages = reuploadImages;
window.IDCardApp._loadExportTemplates = _loadExportTemplates;

})();
