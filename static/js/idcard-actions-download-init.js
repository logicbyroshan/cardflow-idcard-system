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
    if (pendingReuploadCardIds.length === 0 && typeof window.IDCardApp.getAllVisibleCardIds === 'function') {
        pendingReuploadCardIds = window.IDCardApp.getAllVisibleCardIds();
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
                if (typeof showToast === 'function') showToast('Only ZIP files are allowed', 'warning');
            }
        });
    }

    // File input change — validate ZIP and enable confirm
    if (reuploadActionsFileInput) {
        reuploadActionsFileInput.addEventListener('change', function() {
            if (this.files.length) {
                const file = this.files[0];
                if (!file.name.toLowerCase().endsWith('.zip')) {
                    if (typeof showToast === 'function') showToast('Only ZIP files are allowed', 'warning');
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
            if (reuploadActionsBar) reuploadActionsBar.style.width = '0%';
            if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Starting upload...';
            var _reuploadProcessingTimer = null;

            const formData = new FormData();
            formData.append('photos_zip', reuploadActionsFileInput.files[0]);
            formData.append('card_ids', JSON.stringify(pendingReuploadCardIds));
            formData.append('status', _getCurrentStatus());

            let _reuploadRetryCount = 0;
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/panel/api/table/${tableId}/cards/reupload-images/`, true);
            xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
            xhr.timeout = 600000; // 10-minute timeout

            xhr.upload.onprogress = function(event) {
                if (event.lengthComputable) {
                    const uploadPct = Math.round((event.loaded / event.total) * 85);
                    if (reuploadActionsBar) reuploadActionsBar.style.width = uploadPct + '%';
                    if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Uploading... ' + Math.round((event.loaded / event.total) * 100) + '%';
                }
            };
            xhr.upload.onloadend = function() {
                if (reuploadActionsBar) reuploadActionsBar.style.width = '85%';
                if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Processing images on server...';
                var _procStart = Date.now();
                _reuploadProcessingTimer = setInterval(function() {
                    var el = (Date.now() - _procStart) / 1000;
                    var pct = 85 + Math.round(10 * (1 - Math.exp(-el / 8)));
                    if (reuploadActionsBar) reuploadActionsBar.style.width = Math.min(pct, 95) + '%';
                }, 400);
            };

            xhr.onload = function() {
                if (_reuploadProcessingTimer) { clearInterval(_reuploadProcessingTimer); _reuploadProcessingTimer = null; }
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
                    } else if (xhr.status === 429) {
                        // Rate limited / duplicate request — retry after delay
                        const retryMsg = result.message || 'Server is busy. Retrying...';
                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = retryMsg;
                        _reuploadRetryCount++;
                        if (_reuploadRetryCount <= 2) {
                            setTimeout(function() {
                                if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Retrying...';
                                if (reuploadActionsBar) reuploadActionsBar.style.width = '0%';
                                const retryXhr = new XMLHttpRequest();
                                retryXhr.open('POST', `/panel/api/table/${tableId}/cards/reupload-images/`, true);
                                retryXhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
                                retryXhr.timeout = 600000;
                                retryXhr.onload = xhr.onload;
                                retryXhr.onerror = xhr.onerror;
                                retryXhr.ontimeout = xhr.ontimeout;
                                retryXhr.upload.onprogress = xhr.upload.onprogress;
                                retryXhr.upload.onloadend = xhr.upload.onloadend;
                                retryXhr.send(formData);
                            }, 5000);
                        } else {
                            if (typeof showToast === 'function') showToast('Server is busy. Please try again in a minute.', 'warning');
                            reuploadActionsConfirmBtn.disabled = false;
                            reuploadActionsConfirmBtn.textContent = 'Upload & Match';
                        }
                    } else {
                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = result.message || 'Failed';
                        if (typeof showToast === 'function') showToast(result.message || 'Reupload failed', result.level || false);
                        reuploadActionsConfirmBtn.disabled = false;
                        reuploadActionsConfirmBtn.textContent = 'Upload & Match';
                    }
                } catch (e) {
                    console.error('Reupload parse error:', e, 'Status:', xhr.status, 'Response:', xhr.responseText ? xhr.responseText.substring(0, 200) : '(empty)');
                    let errMsg = 'Error processing response';
                    if (xhr.status === 413) errMsg = 'ZIP file too large. Please reduce the file size.';
                    else if (xhr.status === 502 || xhr.status === 504) errMsg = 'Server timeout — try with a smaller ZIP file.';
                    else if (xhr.status === 500) errMsg = 'Server error during reupload. Please try again.';
                    else if (xhr.status === 0) errMsg = 'Connection lost. Check your internet and try again.';
                    else errMsg = 'Error processing response (HTTP ' + xhr.status + ')';
                    if (typeof showToast === 'function') showToast(errMsg, (xhr.status === 413 || xhr.status === 502 || xhr.status === 504) ? 'warning' : false);
                    reuploadActionsConfirmBtn.disabled = false;
                    reuploadActionsConfirmBtn.textContent = 'Upload & Match';
                }
            };

            xhr.onerror = function() {
                if (_reuploadProcessingTimer) { clearInterval(_reuploadProcessingTimer); _reuploadProcessingTimer = null; }
                _reuploadRetryCount++;
                if (_reuploadRetryCount <= 2) {
                    if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Network error. Retrying in 5s...';
                    if (typeof showToast === 'function') showToast('Network error. Retrying automatically...', false);
                    setTimeout(function() {
                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Retrying...';
                        if (reuploadActionsBar) reuploadActionsBar.style.width = '0%';
                        const retryXhr = new XMLHttpRequest();
                        retryXhr.open('POST', `/panel/api/table/${tableId}/cards/reupload-images/`, true);
                        retryXhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
                        retryXhr.timeout = 600000;
                        retryXhr.onload = xhr.onload;
                        retryXhr.onerror = xhr.onerror;
                        retryXhr.ontimeout = xhr.ontimeout;
                        retryXhr.upload.onprogress = xhr.upload.onprogress;
                        retryXhr.upload.onloadend = xhr.upload.onloadend;
                        retryXhr.send(formData);
                    }, 5000);
                } else {
                    if (typeof showToast === 'function') showToast('Upload failed after retries. Please check your connection.', false);
                    reuploadActionsConfirmBtn.disabled = false;
                    reuploadActionsConfirmBtn.textContent = 'Upload & Match';
                    if (reuploadActionsProgress) reuploadActionsProgress.style.display = 'none';
                }
            };

            xhr.ontimeout = function() {                if (_reuploadProcessingTimer) { clearInterval(_reuploadProcessingTimer); _reuploadProcessingTimer = null; }                if (typeof showToast === 'function') showToast('Reupload timed out — the server took too long. Please try with a smaller ZIP.', 'warning');
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
