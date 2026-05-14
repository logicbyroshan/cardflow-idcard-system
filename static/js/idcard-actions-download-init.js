// ID Card Actions - Download Init Sub-module
// Template loading, reupload section, initDownloadModule, shared helpers
// Part of IDCardApp module system  registers functions on window.IDCardApp

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

var _fallbackBulkUiLockDepth = 0;

function _setBulkUiLock(active) {
    if (window.IDCardApp && typeof window.IDCardApp.applyBulkUiLock === 'function') {
        window.IDCardApp.applyBulkUiLock(!!active);
        return;
    }
    if (!document || !document.body) return;

    if (active) {
        _fallbackBulkUiLockDepth += 1;
    } else {
        _fallbackBulkUiLockDepth = Math.max(0, _fallbackBulkUiLockDepth - 1);
    }

    document.body.classList.toggle('bulk-operation-active', _fallbackBulkUiLockDepth > 0);
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
        sel.innerHTML = '<option value="">Default (No Footer Text)</option>';
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
let reuploadActionsFolderInput = null;
let reuploadActionsFolderBrowse = null;
let reuploadActionsFolderName = null;
let reuploadActionsFolderPath = null;
let reuploadActionsConfirmBtn = null;
let reuploadActionsCancelBtn = null;
let reuploadActionsListName = null;
let reuploadActionsCardCount = null;
let reuploadActionsProgress = null;
let reuploadActionsBar = null;
let reuploadActionsStatus = null;
let reuploadActiveTaskId = null;
let reuploadPollTimer = null;
let reuploadInProgress = false;
let reuploadCancelRequested = false;
let reuploadPollErrorCount = 0;

function _isProUserFolderUploadEnabled() {
    var role = '';
    if (document && document.body) {
        role = String(document.body.getAttribute('data-user-role') || '').toLowerCase();
    }
    return role === 'pro_user';
}

function _updateReuploadActionsConfirmState() {
    const hasZip = !!(reuploadActionsFileInput && reuploadActionsFileInput.files && reuploadActionsFileInput.files.length);
    const hasFolderFiles = !!(
        _isProUserFolderUploadEnabled() &&
        reuploadActionsFolderInput &&
        reuploadActionsFolderInput.files &&
        Array.from(reuploadActionsFolderInput.files).some(function(f) {
            return /\.(jpe?g|png|gif|bmp|webp|heic|heif|hei)$/i.test(f.name || '');
        })
    );
    const hasFolderPath = !!(_isProUserFolderUploadEnabled() && reuploadActionsFolderPath && reuploadActionsFolderPath.value && reuploadActionsFolderPath.value.trim());
    if (reuploadActionsConfirmBtn) {
        reuploadActionsConfirmBtn.disabled = !(hasZip || hasFolderFiles || hasFolderPath);
    }
}

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
    if (reuploadActionsFolderInput) reuploadActionsFolderInput.value = '';
    if (reuploadActionsFolderName) reuploadActionsFolderName.textContent = 'No folder selected';
    if (reuploadActionsFolderPath) reuploadActionsFolderPath.value = '';
    if (reuploadActionsConfirmBtn) {
        reuploadActionsConfirmBtn.disabled = true;
        reuploadActionsConfirmBtn.textContent = 'Start Reupload';
    }
    if (reuploadActionsProgress) reuploadActionsProgress.style.display = 'none';
    if (reuploadActionsBar) reuploadActionsBar.style.width = '0%';
    reuploadActionsModal.style.display = 'flex';
}

function closeReuploadActionsModal() {
    if (window.IDCardApp && typeof window.IDCardApp.cancelActiveReupload === 'function') {
        window.IDCardApp.cancelActiveReupload({ notify: false, closeModal: false });
    }
    if (!reuploadActionsModal) return;
    reuploadActionsModal.style.display = 'none';
    if (reuploadActionsFileInput) reuploadActionsFileInput.value = '';
    if (reuploadActionsFolderInput) reuploadActionsFolderInput.value = '';
    pendingReuploadCardIds = [];
}

function initReuploadHandlers() {
    // Get modal elements
    reuploadActionsModal = document.getElementById('reuploadActionsModal');
    reuploadActionsFileInput = document.getElementById('reuploadActionsFileInput');
    reuploadActionsDropZone = document.getElementById('reuploadActionsDropZone');
    reuploadActionsFileName = document.getElementById('reuploadActionsFileName');
    reuploadActionsFolderInput = document.getElementById('reuploadActionsFolderInput');
    reuploadActionsFolderBrowse = document.getElementById('reuploadActionsFolderBrowse');
    reuploadActionsFolderName = document.getElementById('reuploadActionsFolderName');
    reuploadActionsFolderPath = document.getElementById('reuploadActionsFolderPath');
    reuploadActionsConfirmBtn = document.getElementById('reuploadActionsConfirm');
    reuploadActionsCancelBtn = document.getElementById('reuploadActionsCancel');
    reuploadActionsListName = document.getElementById('reuploadActionsListName');
    reuploadActionsCardCount = document.getElementById('reuploadActionsCardCount');
    reuploadActionsProgress = document.getElementById('reuploadActionsProgress');
    reuploadActionsBar = document.getElementById('reuploadActionsBar');
    reuploadActionsStatus = document.getElementById('reuploadActionsStatus');
    let reuploadTaskLockActive = false;

    function _releaseReuploadTaskLock() {
        if (!reuploadTaskLockActive) return;
        _setBulkUiLock(false);
        reuploadTaskLockActive = false;
    }

    function _clearReuploadPollTimer() {
        if (reuploadPollTimer) {
            clearTimeout(reuploadPollTimer);
            reuploadPollTimer = null;
        }
    }

    function _cancelActiveReupload(options) {
        var opts = options || {};

        if (!reuploadInProgress && !reuploadActiveTaskId && !reuploadPollTimer) {
            if (opts.closeModal) closeReuploadActionsModal();
            return;
        }

        reuploadCancelRequested = true;
        _clearReuploadPollTimer();

        if (reuploadActiveTaskId) {
            fetch('/api/task-cancel/' + reuploadActiveTaskId + '/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': (typeof getCSRFToken === 'function' ? getCSRFToken() : ''),
                    'X-Requested-With': 'XMLHttpRequest'
                }
            }).catch(function(err) {
                console.error('Cancel reupload task failed:', err);
            });
        }

        reuploadActiveTaskId = null;
        reuploadInProgress = false;
        reuploadPollErrorCount = 0;
        _setReuploadButton('Start Reupload', false);
        _releaseReuploadTaskLock();

        if (opts.closeModal) closeReuploadActionsModal();
        if (opts.notify !== false && typeof showToast === 'function') showToast('Reupload cancelled', 'warning');
    }

    window.IDCardApp = window.IDCardApp || {};
    window.IDCardApp.cancelActiveReupload = _cancelActiveReupload;

    // Drop zone  click opens file picker
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

    // File input change  validate ZIP and enable confirm
    if (reuploadActionsFileInput) {
        reuploadActionsFileInput.addEventListener('change', function() {
            if (this.files.length) {
                const file = this.files[0];
                if (!file.name.toLowerCase().endsWith('.zip')) {
                    if (typeof showToast === 'function') showToast('Only ZIP files are allowed', 'warning');
                    this.value = '';
                    if (reuploadActionsFileName) reuploadActionsFileName.textContent = 'Click or drag & drop a ZIP file';
                    _updateReuploadActionsConfirmState();
                    return;
                }
                var _maxZip = 950 * 1024 * 1024;
                if (file.size > _maxZip) {
                    var _sizeMB = (file.size / (1024 * 1024)).toFixed(0);
                    if (typeof showToast === 'function') showToast('ZIP is ' + _sizeMB + ' MB  maximum allowed is 950 MB. Please split into smaller ZIPs.', 'error');
                    this.value = '';
                    if (reuploadActionsFileName) reuploadActionsFileName.textContent = 'Click or drag & drop a ZIP file';
                    _updateReuploadActionsConfirmState();
                    return;
                }
                if (reuploadActionsFileName) reuploadActionsFileName.textContent = file.name;
                if (reuploadActionsConfirmBtn) {
                    reuploadActionsConfirmBtn.textContent = 'Start Reupload';
                }
                _updateReuploadActionsConfirmState();
            }
        });
    }

    if (reuploadActionsFolderBrowse && reuploadActionsFolderInput) {
        reuploadActionsFolderBrowse.addEventListener('click', function() {
            if (!_isProUserFolderUploadEnabled()) {
                if (typeof showToast === 'function') showToast('Select Folder is available only for Pro User accounts.', 'warning');
                return;
            }
            reuploadActionsFolderInput.click();
        });
    }

    if (reuploadActionsFolderInput) {
        reuploadActionsFolderInput.addEventListener('change', function() {
            if (!_isProUserFolderUploadEnabled()) {
                this.value = '';
                if (reuploadActionsFolderName) reuploadActionsFolderName.textContent = 'No folder selected';
                if (typeof showToast === 'function') showToast('Select Folder is available only for Pro User accounts.', 'warning');
                _updateReuploadActionsConfirmState();
                return;
            }
            const files = Array.from(this.files || []).filter(function(f) {
                return /\.(jpe?g|png|gif|bmp|webp|heic|heif|hei)$/i.test(f.name || '');
            });
            if (reuploadActionsFolderName) {
                reuploadActionsFolderName.textContent = files.length ? (files.length + ' image file(s) selected from folder') : 'No valid image files found in selected folder';
            }
            _updateReuploadActionsConfirmState();
        });
    }

    if (reuploadActionsFolderPath) {
        reuploadActionsFolderPath.addEventListener('input', _updateReuploadActionsConfirmState);
    }

    // Cancel & close button handlers (no backdrop close)
    if (reuploadActionsCancelBtn) reuploadActionsCancelBtn.addEventListener('click', closeReuploadActionsModal);
    const reuploadActionsCloseBtn = document.getElementById('reuploadActionsClose');
    if (reuploadActionsCloseBtn) reuploadActionsCloseBtn.addEventListener('click', closeReuploadActionsModal);
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && reuploadActionsModal && reuploadActionsModal.style.display === 'flex') closeReuploadActionsModal();
    });

    function _setReuploadButton(label, disabled) {
        if (!reuploadActionsConfirmBtn) return;
        reuploadActionsConfirmBtn.textContent = label;
        reuploadActionsConfirmBtn.disabled = !!disabled;
    }

    function _pollReuploadTask(taskId) {
        reuploadActiveTaskId = taskId;
        reuploadPollErrorCount = 0;

        function pollOnce() {
            if (reuploadCancelRequested || !reuploadInProgress) return;

            fetch('/api/task-status/' + taskId + '/')
                .then(function(r) { return r.json(); })
                .then(function(t) {
                    if (reuploadCancelRequested || !reuploadInProgress) return;

                    if (!t || t.success === false) {
                        reuploadPollErrorCount++;
                        if (reuploadPollErrorCount >= 6) {
                            if (reuploadActionsStatus) reuploadActionsStatus.textContent = (t && t.message) || 'Could not read reupload status. Please refresh to verify.';
                            if (typeof showToast === 'function') showToast((t && t.message) || 'Lost connection while tracking reupload progress.', false);
                            _setReuploadButton('Start Reupload', false);
                            reuploadInProgress = false;
                            reuploadCancelRequested = false;
                            reuploadActiveTaskId = null;
                            _releaseReuploadTaskLock();
                            return;
                        }
                        reuploadPollTimer = setTimeout(pollOnce, 3000);
                        return;
                    }

                    reuploadPollErrorCount = 0;

                    if (t.status === 'completed') {
                        _clearReuploadPollTimer();
                        reuploadInProgress = false;
                        reuploadCancelRequested = false;
                        reuploadActiveTaskId = null;
                        if (reuploadActionsBar) reuploadActionsBar.style.width = '100%';
                        const matched = (t.result && t.result.matched_count != null) ? t.result.matched_count : '';
                        const updated = (t.result && t.result.updated_count != null) ? t.result.updated_count : '';
                        const msg = 'Done! Matched ' + matched + ', updated ' + updated + '.';
                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = msg;
                        if (typeof showToast === 'function') showToast(msg, true);
                        setTimeout(function() {
                            closeReuploadActionsModal();
                            _releaseReuploadTaskLock();
                            if (window.IDCardApp && typeof window.IDCardApp.refreshCardTable === 'function') {
                                window.IDCardApp.refreshCardTable();
                            } else if (window.IDCardPage && typeof window.IDCardPage.navigateStatusNoReload === 'function') {
                                window.IDCardPage.navigateStatusNoReload((typeof CURRENT_STATUS !== 'undefined' && CURRENT_STATUS) ? CURRENT_STATUS : 'pending');
                            } else {
                                console.warn('reupload completion fallback skipped: no refresh bridge available');
                            }
                        }, 1500);
                    } else if (t.status === 'failed' || t.status === 'cancelled') {
                        _clearReuploadPollTimer();
                        reuploadInProgress = false;
                        reuploadCancelRequested = false;
                        reuploadActiveTaskId = null;
                        const errMsg = t.error_message || 'Reupload failed. Please try again.';
                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = errMsg;
                        if (typeof showToast === 'function') showToast(errMsg, false);
                        _setReuploadButton('Start Reupload', false);
                        _releaseReuploadTaskLock();
                    } else {
                        const pct = 80 + Math.round((t.progress_percentage || 0) * 0.19);
                        if (reuploadActionsBar) reuploadActionsBar.style.width = Math.min(pct, 99) + '%';
                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Processing: ' + (t.progress || 0) + '/' + (t.total || '?') + ' images...';
                        reuploadPollTimer = setTimeout(pollOnce, 2000);
                    }
                })
                .catch(function(err) {
                    if (reuploadCancelRequested || !reuploadInProgress) return;

                    reuploadPollErrorCount++;
                    console.warn('[Reupload] Poll error #' + reuploadPollErrorCount + ':', err);
                    if (reuploadPollErrorCount >= 6) {
                        _clearReuploadPollTimer();
                        reuploadInProgress = false;
                        reuploadCancelRequested = false;
                        reuploadActiveTaskId = null;
                        if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Lost connection to server. Task may still be running  refresh to check.';
                        if (typeof showToast === 'function') showToast('Lost connection while tracking progress. Please refresh.', false);
                        _setReuploadButton('Start Reupload', false);
                        _releaseReuploadTaskLock();
                        return;
                    }
                    reuploadPollTimer = setTimeout(pollOnce, 4000);
                });
        }

        reuploadPollTimer = setTimeout(pollOnce, 1200);
    }

    function _startReuploadTask(tableId) {
        const hasZip = !!(reuploadActionsFileInput && reuploadActionsFileInput.files && reuploadActionsFileInput.files.length);
        const hasFolderFiles = !!(
            _isProUserFolderUploadEnabled() &&
            reuploadActionsFolderInput &&
            reuploadActionsFolderInput.files &&
            Array.from(reuploadActionsFolderInput.files).some(function(f) {
                return /\.(jpe?g|png|gif|bmp|webp|heic|heif|hei)$/i.test(f.name || '');
            })
        );
        const hasFolderPath = !!(_isProUserFolderUploadEnabled() && reuploadActionsFolderPath && reuploadActionsFolderPath.value && reuploadActionsFolderPath.value.trim());
        if (!(hasZip || hasFolderFiles || hasFolderPath)) return;
        if (reuploadInProgress) {
            if (typeof showToast === 'function') showToast('Reupload already in progress.', 'warning');
            return;
        }

        reuploadCancelRequested = false;
        reuploadInProgress = true;
        reuploadActiveTaskId = null;
        reuploadPollErrorCount = 0;
        _clearReuploadPollTimer();

        reuploadTaskLockActive = true;
        _setBulkUiLock(true);
        _setReuploadButton('Uploading ZIP...', true);
        if (reuploadActionsProgress) reuploadActionsProgress.style.display = 'block';
        if (reuploadActionsBar) reuploadActionsBar.style.width = '10%';
        if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Uploading ZIP...';

        const formData = new FormData();
        if (hasZip) {
            formData.append('photos_zip', reuploadActionsFileInput.files[0]);
        }
        if (_isProUserFolderUploadEnabled() && hasFolderFiles) {
            Array.from(reuploadActionsFolderInput.files).filter(function(f) {
                return /\.(jpe?g|png|gif|bmp|webp|heic|heif|hei)$/i.test(f.name || '');
            }).forEach(function(f) {
                formData.append('photos_folder_files', f, f.webkitRelativePath || f.name);
            });
        }
        if (_isProUserFolderUploadEnabled() && hasFolderPath) {
            formData.append('photos_folder_path', reuploadActionsFolderPath.value.trim());
        }
        formData.append('card_ids', JSON.stringify(pendingReuploadCardIds));
        formData.append('status', _getCurrentStatus());

        fetch(`/api/table/${tableId}/reupload-task/`, {
            method: 'POST',
            body: formData,
            headers: {
                'X-CSRFToken': (typeof getCSRFToken === 'function' ? getCSRFToken() : ''),
                'X-Requested-With': 'XMLHttpRequest'
            }
        })
            .then(function(resp) {
                return resp.json().then(function(data) {
                    return { status: resp.status, data: data };
                });
            })
            .then(function(result) {
                if (result.status === 200 && result.data && result.data.success) {
                    if (reuploadCancelRequested) {
                        if (result.data.task_id) {
                            fetch('/api/task-cancel/' + result.data.task_id + '/', {
                                method: 'POST',
                                headers: {
                                    'X-CSRFToken': (typeof getCSRFToken === 'function' ? getCSRFToken() : ''),
                                    'X-Requested-With': 'XMLHttpRequest'
                                }
                            }).catch(function(err) {
                                console.error('Cancel delayed reupload task failed:', err);
                            });
                        }
                        reuploadInProgress = false;
                        _setReuploadButton('Start Reupload', false);
                        _releaseReuploadTaskLock();
                        return;
                    }

                    if (reuploadActionsBar) reuploadActionsBar.style.width = '80%';
                    if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Processing images...';
                    _pollReuploadTask(result.data.task_id);
                    return;
                }
                const msg = (result.data && result.data.message) ? result.data.message : 'Failed to create reupload task.';
                if (reuploadActionsStatus) reuploadActionsStatus.textContent = msg;
                if (typeof showToast === 'function') showToast(msg, false);
                _setReuploadButton('Start Reupload', false);
                reuploadInProgress = false;
                reuploadCancelRequested = false;
                reuploadActiveTaskId = null;
                _releaseReuploadTaskLock();
            })
            .catch(function(err) {
                console.error('Error creating reupload task:', err);
                if (reuploadActionsStatus) reuploadActionsStatus.textContent = 'Network error while creating task.';
                if (typeof showToast === 'function') showToast('Network error while creating reupload task.', false);
                _setReuploadButton('Start Reupload', false);
                reuploadInProgress = false;
                reuploadCancelRequested = false;
                reuploadActiveTaskId = null;
                _releaseReuploadTaskLock();
            });
    }

    if (reuploadActionsConfirmBtn) {
        reuploadActionsConfirmBtn.addEventListener('click', function() {
            const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
            if (!tableId) {
                if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
                return;
            }

            _startReuploadTask(tableId);
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
    if (typeof window.IDCardApp.initReprintPickerHandlers === 'function') {
        window.IDCardApp.initReprintPickerHandlers();
    }
    initReuploadHandlers();
}

// Expose globally
window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.initDownloadModule = initDownloadModule;
window.IDCardApp.reuploadImages = reuploadImages;
window.IDCardApp._loadExportTemplates = _loadExportTemplates;

})();
