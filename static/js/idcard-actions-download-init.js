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
        const resp = await fetch('/api/export-templates/', {
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

    // Cancel & close button handlers (no backdrop close)
    if (reuploadActionsCancelBtn) reuploadActionsCancelBtn.addEventListener('click', closeReuploadActionsModal);
    const reuploadActionsCloseBtn = document.getElementById('reuploadActionsClose');
    if (reuploadActionsCloseBtn) reuploadActionsCloseBtn.addEventListener('click', closeReuploadActionsModal);
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && reuploadActionsModal && reuploadActionsModal.style.display === 'flex') closeReuploadActionsModal();
    });

    // Confirm — upload ZIP via XHR (background task + polling)
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
            var _actPollInterval = null;
            var _actUploadDone = false; // guard against duplicate handler calls

            // ── Stall detection: abort if no progress for 30 seconds ──
            var _actLastProgress = Date.now();
            var _actStallTimer = setInterval(function() {
                if (_actUploadDone) { clearInterval(_actStallTimer); return; }
                if (Date.now() - _actLastProgress > 30000) {
                    clearInterval(_actStallTimer);
                    if (!_actUploadDone) {
                        _actUploadDone = true;
                        xhr.abort();
                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Upload stalled — server may have rejected the file.';
                        if (typeof showToast === 'function') showToast(
                            'Upload stalled. Check that Nginx client_max_body_size is large enough (1000M) and the server is running.',
                            false
                        );
                        reuploadActionsConfirmBtn.disabled = false;
                        reuploadActionsConfirmBtn.textContent = 'Upload & Match';
                    }
                }
            }, 5000);

            function _cleanupReuploadActions() {
                _actUploadDone = true;
                clearInterval(_actStallTimer);
            }

            const formData = new FormData();
            formData.append('photos_zip', reuploadActionsFileInput.files[0]);
            formData.append('card_ids', JSON.stringify(pendingReuploadCardIds));
            formData.append('status', _getCurrentStatus());

            const uploadUrl = `/api/table/${tableId}/reupload-task/`;
            const xhr = new XMLHttpRequest();
            xhr.open('POST', uploadUrl, true);
            xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            xhr.timeout = 300000; // 5-minute timeout for upload phase only
            console.log('[Reupload] Starting upload to', uploadUrl, '| File:', reuploadActionsFileInput.files[0].name, '| Size:', Math.round(reuploadActionsFileInput.files[0].size / 1024) + 'KB');

            xhr.upload.onprogress = function(event) {
                _actLastProgress = Date.now();
                if (event.lengthComputable) {
                    const uploadPct = Math.round((event.loaded / event.total) * 80);
                    if (reuploadActionsBar) reuploadActionsBar.style.width = uploadPct + '%';
                    if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Uploading... ' + Math.round((event.loaded / event.total) * 100) + '%';
                }
            };

            // ── Catch early server error (e.g. Nginx 413) before upload finishes ──
            xhr.onreadystatechange = function() {
                if (xhr.readyState >= 2) {
                    console.log('[Reupload] XHR state:', xhr.readyState, '| HTTP:', xhr.status);
                }
                if (xhr.readyState === 4 && !_actUploadDone) {
                    if (xhr.status !== 200 && xhr.status !== 0) {
                        _cleanupReuploadActions();
                        let earlyErr = 'Server rejected the upload (HTTP ' + xhr.status + ').';
                        if (xhr.status === 413) earlyErr = 'ZIP file too large. Increase Nginx client_max_body_size.';
                        else if (xhr.status === 403) earlyErr = 'Forbidden (403). Possible causes: CSRF token expired, session expired, or insufficient permissions. Try reloading the page.';
                        else if (xhr.status === 502 || xhr.status === 504) earlyErr = 'Server timeout — try a smaller ZIP.';
                        console.error('[Reupload] Server rejection: HTTP', xhr.status, xhr.responseText ? xhr.responseText.substring(0, 500) : '(empty)');
                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = earlyErr;
                        if (typeof showToast === 'function') showToast(earlyErr, false);
                        reuploadActionsConfirmBtn.disabled = false;
                        reuploadActionsConfirmBtn.textContent = 'Upload & Match';
                    }
                }
            };

            xhr.onload = function() {
                if (_actUploadDone) return;
                _cleanupReuploadActions();
                try {
                    const result = JSON.parse(xhr.responseText);
                    if (xhr.status === 200 && result.success) {
                        if (reuploadActionsBar) reuploadActionsBar.style.width = '80%';
                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Processing images...';
                        // Poll for real task progress
                        let _actPollErrors = 0;
                        _actPollInterval = setInterval(function() {
                            fetch('/api/task-status/' + result.task_id + '/')
                                .then(function(r) { return r.json(); })
                                .then(function(t) {
                                    _actPollErrors = 0;
                                    if (t.status === 'completed') {
                                        clearInterval(_actPollInterval);
                                        if (reuploadActionsBar) reuploadActionsBar.style.width = '100%';
                                        const matched = (t.result && t.result.matched_count != null) ? t.result.matched_count : '';
                                        const msg = matched !== '' ? ('Done! ' + matched + ' images matched.') : 'Done!';
                                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = msg;
                                        if (typeof showToast === 'function') showToast(msg, true);
                                        setTimeout(function() {
                                            closeReuploadActionsModal();
                                            if (window.IDCardApp && typeof window.IDCardApp.refreshCardTable === 'function') {
                                                window.IDCardApp.refreshCardTable();
                                            } else {
                                                window.location.reload();
                                            }
                                        }, 1500);
                                    } else if (t.status === 'failed' || t.status === 'cancelled') {
                                        clearInterval(_actPollInterval);
                                        const errMsg = t.error_message || 'Reupload failed. Please try again.';
                                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = errMsg;
                                        if (typeof showToast === 'function') showToast(errMsg, false);
                                        reuploadActionsConfirmBtn.disabled = false;
                                        reuploadActionsConfirmBtn.textContent = 'Upload & Match';
                                    } else {
                                        const pct = 80 + Math.round((t.progress_percentage || 0) * 0.19);
                                        if (reuploadActionsBar) reuploadActionsBar.style.width = Math.min(pct, 99) + '%';
                                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Processing: ' + (t.progress || 0) + '/' + (t.total || '?') + ' images...';
                                    }
                                })
                                .catch(function(err) {
                                    _actPollErrors++;
                                    console.warn('[Reupload] Poll error #' + _actPollErrors + ':', err);
                                    if (_actPollErrors >= 5) {
                                        clearInterval(_actPollInterval);
                                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Lost connection to server. Task may still be running — refresh to check.';
                                        if (typeof showToast === 'function') showToast('Lost connection while tracking progress. Please refresh.', false);
                                        reuploadActionsConfirmBtn.disabled = false;
                                        reuploadActionsConfirmBtn.textContent = 'Upload & Match';
                                    }
                                });
                        }, 2000);
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
                if (_actUploadDone) return;
                _cleanupReuploadActions();
                console.error('Reupload XHR onerror — status:', xhr.status, 'readyState:', xhr.readyState);
                let errMsg = 'Upload failed. ';
                if (xhr.status === 413) errMsg += 'File too large for server (Nginx client_max_body_size).';
                else if (xhr.status === 0) errMsg += 'Connection was reset — server may have rejected the file size. Check Nginx client_max_body_size.';
                else errMsg += 'Check your connection and try again.';
                if (typeof showToast === 'function') showToast(errMsg, false);
                reuploadActionsConfirmBtn.disabled = false;
                reuploadActionsConfirmBtn.textContent = 'Upload & Match';
                if (reuploadActionsProgress) reuploadActionsProgress.style.display = 'none';
            };

            xhr.ontimeout = function() {
                if (_actUploadDone) return;
                _cleanupReuploadActions();
                if (typeof showToast === 'function') showToast('Upload timed out — try with a smaller ZIP.', 'warning');
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
