// ID Card Actions - Download Logic Sub-module
// Core download functions: Images, DOCX, XLSX, PDF, and status management
// Part of IDCardApp module system  registers functions on window.IDCardApp
// Uses DownloadManager for concurrent downloads with progress, cancel, queuing

(function() {
'use strict';

// ==========================================
// INTERNAL HELPERS
// ==========================================

/**
 * Get current status label for request body.
 */
function _getCurrentStatus() {
    return typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : '';
}

/**
 * After a successful export from the Approved list, move the exported cards
 * to 'download' status so they appear in the Download list.
 * Does nothing if current status is not 'approved'.
 */
function _moveCardsToDownloadIfApproved(cardIds) {
    if (_getCurrentStatus() !== 'approved') return;
    var tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) return;

    // If cardIds is empty, we exported ALL approved cards  fetch them from backend first
    if (!cardIds || cardIds.length === 0) {
        // Use the all-ids endpoint to get every approved card
        var idsUrl = '/api/table/' + tableId + '/cards/all-ids/?status=approved';
        var filters = _getActiveFilters();
        var params = [];
        if (filters.search) params.push('search=' + encodeURIComponent(filters.search));
        if (filters['class']) params.push('class=' + encodeURIComponent(filters['class']));
        if (filters.section) params.push('section=' + encodeURIComponent(filters.section));
        if (filters.course) params.push('course=' + encodeURIComponent(filters.course));
        if (filters.branch) params.push('branch=' + encodeURIComponent(filters.branch));
        if (params.length) idsUrl += '&' + params.join('&');

        fetch(idsUrl, {
            headers: { 'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : '' }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var allIds = data.card_ids || [];
            if (allIds.length > 0) _doBulkMoveToDownload(tableId, allIds);
        })
        .catch(function(err) { console.error('Failed to fetch all approved IDs:', err); });
    } else {
        _doBulkMoveToDownload(tableId, cardIds);
    }
}

function _doBulkMoveToDownload(tableId, cardIds) {
    if (typeof apiCall === 'function') {
        apiCall('/api/table/' + tableId + '/cards/bulk-status/', 'POST', {
            card_ids: cardIds,
            status: 'download'
        }, { timeout: 120000 })
        .then(function(data) {
            if (data.success === false) {
                // Permission denied or validation error  silently log, don't interrupt UX
                console.warn('Move to download skipped:', data.message);
                return;
            }
            var count = data.updated_count || cardIds.length;
            if (typeof showToast === 'function') showToast(data.message || count + ' card(s) moved to Download list', true);
            // Refresh table and status counts via the unified helper
            if (window.IDCardApp && typeof window.IDCardApp.refreshCardTable === 'function') {
                window.IDCardApp.refreshCardTable();
            } else if (typeof htmx !== 'undefined' && document.getElementById('card-table-container')) {
                htmx.trigger(document.body, 'refreshTable');
                if (typeof window.alpineClearSelection === 'function') window.alpineClearSelection();
            } else {
                var status = (typeof CURRENT_STATUS !== 'undefined' && CURRENT_STATUS) ? CURRENT_STATUS : 'pending';
                if (window.IDCardPage && typeof window.IDCardPage.navigateStatusNoReload === 'function') {
                    window.IDCardPage.navigateStatusNoReload(status);
                } else {
                    console.warn('bulk-status fallback skipped: no refresh bridge available');
                }
            }
        })
        .catch(function(err) {
            // Don't show error toast  the export itself succeeded, this is a secondary action
            console.error('Failed to move cards to download:', err);
        });
    }
}

/**
 * Build filter params object for download request bodies.
 * Includes search/class/section/course/branch so backend fallback respects active filters.
 */
function _getActiveFilters() {
    const filters = {};
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.value.trim()) filters.search = searchInput.value.trim();
    if (IDCardApp.currentClassFilter) filters['class'] = IDCardApp.currentClassFilter;
    if (IDCardApp.currentSectionFilter) filters.section = IDCardApp.currentSectionFilter;
    if (IDCardApp.currentCourseFilter) filters.course = IDCardApp.currentCourseFilter;
    if (IDCardApp.currentBranchFilter) filters.branch = IDCardApp.currentBranchFilter;
    // DateTime range (download list)
    const fromDate = document.getElementById('fromDateFilter');
    const toDate = document.getElementById('toDateFilter');
    if (fromDate && fromDate.value) filters.from = fromDate.value;
    if (toDate && toDate.value) filters.to = toDate.value;
    return filters;
}

function _formatSizeLabel(sizeBytes) {
    var value = Number(sizeBytes || 0);
    if (!isFinite(value) || value <= 0) return '';

    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
        value = value / 1024;
        idx += 1;
    }

    return value.toFixed(idx === 0 ? 0 : 1) + ' ' + units[idx];
}

function _getExportSizeLabel(data) {
    if (!data || typeof data !== 'object') return '';

    var fromServer = String(data.file_size_label || '').trim();
    if (fromServer) return fromServer;

    return _formatSizeLabel(data.file_size_bytes);
}

/**
 * Compute effective export count.
 * If explicit card_ids is empty, treat as "all cards" and use table total.
 */
function _getEffectiveExportCount(cardIds) {
    var totalCards = (window.IDCardApp && window.IDCardApp.lazyLoadState)
        ? (window.IDCardApp.lazyLoadState.totalCount || 0)
        : 0;
    return (cardIds && cardIds.length > 0) ? cardIds.length : totalCards;
}

function _resolveAsyncExportKind(options, data) {
    var fromOptions = String((options && options.exportType) || '').trim().toLowerCase();
    if (fromOptions) return fromOptions;

    var taskType = String((data && data.task_type) || '').trim().toLowerCase();
    if (!taskType) return 'export';
    if (taskType.indexOf('docx') !== -1 || taskType.indexOf('doc') !== -1) return 'docx';
    if (taskType.indexOf('excel') !== -1 || taskType.indexOf('xlsx') !== -1) return 'xlsx';
    if (taskType.indexOf('zip') !== -1) return 'zip';
    if (taskType.indexOf('pdf') !== -1) return 'pdf';
    return 'export';
}

function _estimateAsyncExportSeconds(exportType, cardCount) {
    var n = Math.max(1, Number(cardCount || 0));
    if (exportType === 'docx') return Math.max(50, Math.min(2400, 70 + (n * 0.24)));
    if (exportType === 'xlsx') return Math.max(20, Math.min(1200, 22 + (n * 0.08)));
    if (exportType === 'zip') return Math.max(35, Math.min(1800, 38 + (n * 0.13)));
    if (exportType === 'pdf') return Math.max(35, Math.min(2400, 50 + (n * 0.18)));
    return Math.max(30, Math.min(1800, 35 + (n * 0.12)));
}

function _formatEtaLabel(totalSeconds) {
    var seconds = Math.max(0, Math.round(Number(totalSeconds || 0)));
    var mins = Math.floor(seconds / 60);
    var rem = seconds % 60;
    if (mins >= 60) {
        var hours = Math.floor(mins / 60);
        var remMins = mins % 60;
        return hours + 'h ' + remMins + 'm';
    }
    if (mins > 0) return mins + 'm ' + rem + 's';
    return rem + 's';
}

function _consumeNextBulkUiLockFlag() {
    window.IDCardApp = window.IDCardApp || {};
    if (window.IDCardApp._nextBulkUiLock === true) {
        window.IDCardApp._nextBulkUiLock = false;
        return true;
    }
    return false;
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

/**
 * Start a generic async export task (xlsx/docx/zip) and poll task-status.
 */
function _downloadExportAsync(tableId, exportType, cardIds, options) {
    options = options || {};
    var _asyncCancelled = false;
    var _activeTaskId = null;
    var _cancelRequested = false;
    var _bulkUiLockActive = _consumeNextBulkUiLockFlag();
    if (options.lockUi !== false) _bulkUiLockActive = true;

    function _releaseBulkUiLock() {
        if (!_bulkUiLockActive) return;
        _setBulkUiLock(false);
        _bulkUiLockActive = false;
    }

    if (_bulkUiLockActive) _setBulkUiLock(true);

    var _effectiveCount = _getEffectiveExportCount(cardIds);
    var _pollOptions = Object.assign({}, options, {
        exportType: options.exportType || exportType,
        cardCount: options.cardCount || _effectiveCount,
        onFinalize: _releaseBulkUiLock
    });

    var cancelFn = function () {
        _asyncCancelled = true;
        _releaseBulkUiLock();
        if (_activeTaskId && !_cancelRequested) {
            _cancelRequested = true;
            fetch('/api/task-cancel/' + _activeTaskId + '/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : '',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (typeof showToast === 'function') {
                        showToast((data && data.message) || ((options.cancelLabel || 'Export') + ' cancelled'), 'info');
                    }
                })
                .catch(function (err) {
                    if (typeof showToast === 'function') {
                        showToast((options.cancelLabel || 'Export') + ' cancel request sent', 'info');
                    }
                    console.error('Cancel export task failed:', err);
                });
        } else if (typeof showToast === 'function') {
            showToast((options.cancelLabel || 'Export') + ' cancelled', 'info');
        }
    };

    if (typeof showProgressToast === 'function') {
        showProgressToast(options.startMessage || 'Starting export...', 5, cancelFn);
    }

    var body = Object.assign({
        export_type: exportType,
        card_ids: cardIds,
        status: _getCurrentStatus(),
        replace_active: true
    }, _getActiveFilters(), (options.extraPayload || {}));

    var startReq;
    if (typeof apiCall === 'function') {
        startReq = apiCall('/api/table/' + tableId + '/export-task/', 'POST', body, { timeout: 30000 });
    } else {
        startReq = fetch('/api/table/' + tableId + '/export-task/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : ''
            },
            body: JSON.stringify(body)
        }).then(function (r) { return r.json(); });
    }

    startReq
        .then(function (data) {
            if (!data || !data.success || !data.task_id) {
                if (typeof hideProgressToast === 'function') hideProgressToast();

                if (data && data.active_task_id) {
                    _activeTaskId = data.active_task_id;
                    if (typeof showToast === 'function') {
                        showToast((data.message || 'An export is already running. Tracking existing task.'), 'info');
                    }
                    if (typeof showProgressToast === 'function') {
                        showProgressToast(options.startMessage || 'Resuming export...', 5, cancelFn);
                    }
                    _pollGenericTaskStatus(data.active_task_id, _pollOptions, function () { return _asyncCancelled; }, cancelFn);
                    return;
                }

                if (typeof showToast === 'function') showToast((data && data.message) || 'Failed to start export task', false);
                _releaseBulkUiLock();
                return;
            }
            _activeTaskId = data.task_id;
            _pollGenericTaskStatus(data.task_id, _pollOptions, function () { return _asyncCancelled; }, cancelFn);
        })
        .catch(function (err) {
            if (typeof hideProgressToast === 'function') hideProgressToast();

            var errData = (err && err.data && typeof err.data === 'object') ? err.data : null;
            var errMessage = (errData && errData.message) || (err && err.message) || 'Failed to start export. Please try again.';

            if (errData && errData.active_task_id) {
                _activeTaskId = errData.active_task_id;
                if (typeof showToast === 'function') showToast(errMessage, 'info');
                if (typeof showProgressToast === 'function') {
                    showProgressToast(options.startMessage || 'Resuming export...', 5, cancelFn);
                }
                _pollGenericTaskStatus(errData.active_task_id, _pollOptions, function () { return _asyncCancelled; }, cancelFn);
                return;
            }

            if (typeof showToast === 'function') showToast(errMessage, false);
            console.error('Async export start error:', err);
            _releaseBulkUiLock();
        });
}

/**
 * Poll /api/task-status/<id>/ until completed/failed.
 */
function _pollGenericTaskStatus(taskId, options, isCancelled, cancelFn) {
    options = options || {};
    var pollCount = 0;
    var maxPolls = options.maxPolls || 300; // up to 10 minutes at 2s interval
    var pollErrorCount = 0;
    var maxPollErrors = options.maxPollErrors || 6;
    var pollStartedAt = Date.now();
    var displayPct = 5;
    var lastBackendPct = 0;
    var lastBackendUpdateAt = pollStartedAt;
    var exportKind = _resolveAsyncExportKind(options, null);
    var estimatedTotalSec = _estimateAsyncExportSeconds(exportKind, options.cardCount || 0);
    var finalized = false;

    function finalizeOnce() {
        if (finalized) return;
        finalized = true;
        if (typeof options.onFinalize === 'function') {
            try { options.onFinalize(); } catch (e) { console.error(e); }
        }
    }

    function poll() {
        if (typeof isCancelled === 'function' && isCancelled()) {
            if (typeof hideProgressToast === 'function') hideProgressToast();
            finalizeOnce();
            return;
        }

        pollCount++;
        if (pollCount > maxPolls) {
            if (typeof hideProgressToast === 'function') hideProgressToast();
            if (typeof showToast === 'function') showToast(options.timeoutMessage || 'Export timed out. Please try again with fewer cards.', false);
            finalizeOnce();
            return;
        }

        fetch('/api/task-status/' + taskId + '/', {
            headers: {
                'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : ''
            }
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                pollErrorCount = 0;

                if (!data || !data.success) {
                    if (typeof hideProgressToast === 'function') hideProgressToast();
                    if (typeof showToast === 'function') showToast((data && data.message) || 'Export task not found', false);
                    finalizeOnce();
                    return;
                }

                if (data.status === 'completed') {
                    if (!data.download_url) {
                        if (typeof hideProgressToast === 'function') hideProgressToast();
                        if (typeof showToast === 'function') showToast('Export completed but download link is missing', false);
                        finalizeOnce();
                        return;
                    }

                    if (typeof showProgressToast === 'function') {
                        showProgressToast(options.readyMessage || 'Export ready! Starting download...', 100);
                    }

                    setTimeout(function () {
                        var a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = data.download_url;
                        a.download = (data.result && data.result.filename) || options.fallbackFilename || 'export';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);

                        if (typeof showDownloadComplete === 'function') {
                            showDownloadComplete(options.completeMessage || 'File downloaded successfully!');
                        }
                        if (typeof options.onComplete === 'function') {
                            try { options.onComplete(); } catch (e) { console.error(e); }
                        }
                        finalizeOnce();
                    }, 400);
                    return;
                }

                if (data.status === 'failed' || data.status === 'cancelled') {
                    if (typeof hideProgressToast === 'function') hideProgressToast();
                    if (typeof showToast === 'function') showToast(data.error_message || options.failMessage || 'Export failed', false);
                    finalizeOnce();
                    return;
                }

                exportKind = _resolveAsyncExportKind(options, data);

                var backendPct = Number(data.progress_percentage || 0);
                if (!isFinite(backendPct)) backendPct = 0;
                backendPct = Math.max(0, Math.min(95, backendPct));

                if (backendPct > lastBackendPct + 0.1) {
                    lastBackendPct = backendPct;
                    lastBackendUpdateAt = Date.now();
                }

                var elapsedSec = Math.max(1, (Date.now() - pollStartedAt) / 1000);
                if (backendPct >= 8) {
                    var observedTotal = elapsedSec / Math.max(backendPct / 100, 0.08);
                    estimatedTotalSec = Math.max(estimatedTotalSec, observedTotal);
                }

                var timeDrivenPct = Math.min(92, (elapsedSec / Math.max(estimatedTotalSec, 1)) * 100);
                var stalledSec = Math.max(0, (Date.now() - lastBackendUpdateAt) / 1000);
                var stalledBoost = stalledSec > 8 ? Math.min(10, (stalledSec - 8) * 0.8) : 0;

                var blendedPct = Math.max(
                    backendPct,
                    timeDrivenPct,
                    Math.min(94, backendPct + stalledBoost)
                );
                displayPct = Math.max(displayPct, Math.min(95, blendedPct));

                var baseRemaining = Math.max(0, estimatedTotalSec - elapsedSec);
                if (displayPct >= 10) {
                    var paceBasedTotal = elapsedSec / (displayPct / 100);
                    baseRemaining = Math.max(baseRemaining, paceBasedTotal - elapsedSec);
                }
                // Show slightly conservative ETA so users have a safe wait window.
                var bufferedEta = Math.max(5, Math.ceil((baseRemaining * 1.18) + 12));

                var msg = options.processingMessage
                    ? options.processingMessage(data, Math.round(displayPct), bufferedEta)
                    : ('Processing export... ' + (data.progress || 0) + '/' + (data.total || '?'));
                msg = msg + ' | Est. wait: ' + _formatEtaLabel(bufferedEta);

                if (typeof showProgressToast === 'function') {
                    showProgressToast(msg, Math.round(displayPct), cancelFn);
                }
                setTimeout(poll, _POLL_INTERVAL);
            })
            .catch(function (err) {
                console.error('Task status poll error:', err);
                pollErrorCount++;
                if (pollErrorCount >= maxPollErrors) {
                    if (typeof hideProgressToast === 'function') hideProgressToast();
                    if (typeof showToast === 'function') showToast('Lost connection while tracking export progress. Please refresh to verify result.', 'warning');
                    finalizeOnce();
                    return;
                }
                setTimeout(poll, _POLL_INTERVAL * 2);
            });
    }

    setTimeout(poll, 1000);
}

// ==========================================
// DOWNLOAD IMAGES (Separate ZIP per image column)
// Uses DownloadManager.startImageDownload for JSON-based response
// ==========================================

function downloadImages(cardIds, renameOptions) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }

    const requestBody = Object.assign({ card_ids: cardIds, status: _getCurrentStatus() }, _getActiveFilters());
    if (renameOptions && renameOptions.enabled === true && renameOptions.image_name_fields) {
        requestBody.rename_options = renameOptions;
    }
    const isPdfZipMode = !!(renameOptions && renameOptions.enabled === true && renameOptions.output_format === 'pdf_zip');
    const effectiveCount = _getEffectiveExportCount(cardIds);

    // For large standard image exports, use background task flow.
    // Keep sync mode for rename/pdf-zip so existing behavior remains unchanged.
    if (effectiveCount >= _ASYNC_EXPORT_THRESHOLD && !renameOptions && !isPdfZipMode) {
        _downloadExportAsync(tableId, 'zip', cardIds, {
            startMessage: 'Starting image export...',
            readyMessage: 'Image ZIP ready! Starting download...',
            completeMessage: 'Image ZIP downloaded successfully!',
            timeoutMessage: 'Image export timed out. Please try again with fewer cards.',
            failMessage: 'Image export failed',
            cancelLabel: 'Image export',
            fallbackFilename: 'images.zip',
            processingMessage: function (data, displayPct) {
                var progressText = (data.total && data.total > 0)
                    ? (data.progress || 0) + '/' + data.total
                    : (data.progress || 0) + '/?';
                return (data.status_display || 'Preparing image ZIP...') + ' ' + Math.round(displayPct || 0) + '% (' + progressText + ')';
            }
        });
        return;
    }

    // Use DownloadManager if available
    if (window.DownloadManager) {
        window.DownloadManager.startImageDownload({
            name: isPdfZipMode ? 'Images PDF ZIP' : 'Images ZIP',
            url: `/api/table/${tableId}/cards/download-images/`,
            body: requestBody,
            lockUi: true,
            onComplete: function() {
                // Image export: do NOT move cards to download list
            },
            onError: function(msg) {
                console.error('Image download error:', msg);
            }
        });
        return;
    }

    // Legacy fallback (no DownloadManager)
    var _legacyImgLockActive = true;
    _setBulkUiLock(true);

    function _releaseLegacyImgLock() {
        if (!_legacyImgLockActive) return;
        _setBulkUiLock(false);
        _legacyImgLockActive = false;
    }

    if (typeof showProgressToast === 'function') showProgressToast('Preparing images...', -1);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/table/${tableId}/cards/download-images/`, true);
    xhr.timeout = 600000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
    
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                const response = JSON.parse(xhr.responseText);

                const fileList = (Array.isArray(response.files) && response.files.length > 0)
                    ? response.files
                    : (Array.isArray(response.zip_files) && response.zip_files.length > 0)
                        ? response.zip_files
                        : (response.download_url ? [{
                            download_url: response.download_url,
                            filename: response.filename || 'images.zip'
                        }] : []);

                if (response.success && fileList.length > 0) {
                    let downloadIndex = 0;
                    const totalZips = fileList.length;
                    
                    function downloadNextZip() {
                        if (downloadIndex >= totalZips) {
                            if (typeof showDownloadComplete === 'function') {
                                showDownloadComplete(`Downloaded ${totalZips} ZIP file(s) with ${response.total_images} images!`);
                            }
                            _releaseLegacyImgLock();
                            return;
                        }
                        
                        const zipInfo = fileList[downloadIndex];

                        try {
                            const a = document.createElement('a');
                            a.style.display = 'none';

                            if (zipInfo.download_url) {
                                a.href = zipInfo.download_url;
                                a.download = zipInfo.filename || 'images.zip';
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                            } else if (zipInfo.data) {
                                // Backward compatibility for older base64 payloads.
                                var bin = atob(zipInfo.data);
                                var bytes = new Uint8Array(bin.length);
                                for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                                var blob = new Blob([bytes], { type: 'application/zip' });

                                const url = window.URL.createObjectURL(blob);
                                a.href = url;
                                a.download = zipInfo.filename || 'images.zip';
                                document.body.appendChild(a);
                                a.click();
                                window.URL.revokeObjectURL(url);
                                document.body.removeChild(a);
                            } else {
                                throw new Error('Missing image file payload');
                            }

                            downloadIndex++;

                            if (typeof showProgressToast === 'function') {
                                showProgressToast(`Downloading ${downloadIndex}/${totalZips} ZIPs...`, Math.round((downloadIndex / totalZips) * 100));
                            }

                            setTimeout(downloadNextZip, 300);
                        } catch (err) {
                            console.error('ZIP download failed:', err);
                            if (typeof showToast === 'function') showToast('Failed to download ZIP file', false);
                            _releaseLegacyImgLock();
                        }
                    }
                    
                    downloadNextZip();
                    
                } else {
                    if (typeof hideProgressToast === 'function') hideProgressToast();
                    if (typeof showToast === 'function') showToast(response.message || 'No images found!', false);
                    _releaseLegacyImgLock();
                }
            } catch(e) {
                if (typeof hideProgressToast === 'function') hideProgressToast();
                if (typeof showToast === 'function') showToast('Failed to process download response', false);
                console.error('Download error:', e);
                _releaseLegacyImgLock();
            }
        } else {
            if (typeof hideProgressToast === 'function') hideProgressToast();
            try {
                const error = JSON.parse(xhr.responseText);
                if (typeof showToast === 'function') showToast(error.message || 'Failed to download images', false);
            } catch(e) {
                if (typeof showToast === 'function') showToast('Failed to download images', false);
            }
            _releaseLegacyImgLock();
        }
    };
    
    xhr.onerror = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Failed to download images', false);
        _releaseLegacyImgLock();
    };
    
    xhr.ontimeout = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Image download timed out. Try selecting fewer cards.', false);
        _releaseLegacyImgLock();
    };
    
    xhr.send(JSON.stringify(requestBody));
}

// ==========================================
// DOWNLOAD DOCX
// Uses DownloadManager for blob-based response
// ==========================================

function downloadDocx(cardIds, format, templateId) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    
    // Do not close/hide the modal here; if a modal presenter is active
    // it will manage the UI. Keep modal open so the stepper stays visible.

    const effectiveCount = _getEffectiveExportCount(cardIds);
    if (effectiveCount >= _ASYNC_EXPORT_THRESHOLD) {
        _downloadExportAsync(tableId, 'docx', cardIds, {
            startMessage: 'Starting ' + format.toUpperCase() + ' export...',
            readyMessage: format.toUpperCase() + ' ready! Starting download...',
            completeMessage: 'Document downloaded successfully!',
            timeoutMessage: 'Document export timed out. Please try again with fewer cards.',
            failMessage: 'Document export failed',
            cancelLabel: 'Document export',
            fallbackFilename: format === 'doc' ? 'export.doc' : 'export.docx',
            extraPayload: {
                format: format || 'docx',
                template_id: templateId || ''
            },
            onComplete: function() {
                _moveCardsToDownloadIfApproved(cardIds);
            },
            processingMessage: function (data, displayPct) {
                var progressText = (data.total && data.total > 0)
                    ? (data.progress || 0) + '/' + data.total
                    : (data.progress || 0) + '/?';
                return (data.status_display || ('Preparing ' + format.toUpperCase() + '...')) + ' ' + Math.round(displayPct || 0) + '% (' + progressText + ')';
            }
        });
        return;
    }

    // Use DownloadManager if available
    if (window.DownloadManager) {
        window.DownloadManager.start({
            name: format.toUpperCase() + ' Document',
            url: `/api/table/${tableId}/cards/download-docx/`,
            body: Object.assign({ card_ids: cardIds, format: format, template_id: templateId || '', status: _getCurrentStatus() }, _getActiveFilters()),
            lockUi: true,
            modalType: 'docx',
            fallbackExt: format,
            completeMessage: 'Document downloaded successfully!',
            onComplete: function() {
                _moveCardsToDownloadIfApproved(cardIds);
            },
            onError: function(msg) {
                console.error('DOCX download error:', msg);
            }
        });
        return;
    }

    // Legacy fallback
    var _legacyDocxLockActive = true;
    _setBulkUiLock(true);

    function _releaseLegacyDocxLock() {
        if (!_legacyDocxLockActive) return;
        _setBulkUiLock(false);
        _legacyDocxLockActive = false;
    }

    if (typeof showProgressToast === 'function') showProgressToast(`Preparing ${format.toUpperCase()} document...`, -1);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/table/${tableId}/cards/download-docx/`, true);
    xhr.timeout = 600000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
    xhr.responseType = 'blob';
    
    xhr.onprogress = function(event) {
        if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            if (typeof showProgressToast === 'function') showProgressToast(`Downloading... ${percentComplete}%`, percentComplete);
        } else {
            if (typeof showProgressToast === 'function') showProgressToast('Downloading...', -1);
        }
    };
    
    xhr.onload = function() {
        if (xhr.status === 200) {
            const blob = xhr.response;
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = _getDownloadFilename(xhr, format);
            
            document.body.appendChild(a);
            a.click();
            
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            if (typeof showDownloadComplete === 'function') showDownloadComplete('Document downloaded successfully!');
            _moveCardsToDownloadIfApproved(cardIds);
            _releaseLegacyDocxLock();
        } else {
            if (typeof hideProgressToast === 'function') hideProgressToast();
            const reader = new FileReader();
            reader.onload = function() {
                try {
                    const error = JSON.parse(reader.result);
                    if (typeof showToast === 'function') showToast(error.message || 'Failed to download document', false);
                } catch(e) {
                    if (typeof showToast === 'function') showToast('Failed to download document', false);
                }
                _releaseLegacyDocxLock();
            };
            reader.readAsText(xhr.response);
        }
    };
    
    xhr.onerror = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Failed to download document', false);
        _releaseLegacyDocxLock();
    };
    
    xhr.ontimeout = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Document download timed out. Try selecting fewer cards.', false);
        _releaseLegacyDocxLock();
    };
    
    xhr.send(JSON.stringify(Object.assign({ card_ids: cardIds, format: format, template_id: templateId || '', status: _getCurrentStatus() }, _getActiveFilters())));
}

// ==========================================
// DOWNLOAD XLSX
// Uses DownloadManager for blob-based response
// ==========================================

function downloadXlsx(cardIds, options) {
    options = options || {};
    const includeImagesZip = !!options.includeImagesZip;
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }

    const effectiveCount = _getEffectiveExportCount(cardIds);
    if (effectiveCount >= _ASYNC_EXPORT_THRESHOLD) {
        _downloadExportAsync(tableId, 'xlsx', cardIds, {
            startMessage: 'Starting Excel export...',
            readyMessage: 'Excel ready! Starting download...',
            completeMessage: 'Excel file downloaded successfully!',
            timeoutMessage: 'Excel export timed out. Please try again with fewer cards.',
            failMessage: 'Excel export failed',
            cancelLabel: 'Excel export',
            fallbackFilename: 'export.xlsx',
            onComplete: function() {
                if (includeImagesZip) {
                    downloadImages(cardIds);
                }
                _moveCardsToDownloadIfApproved(cardIds);
            },
            processingMessage: function (data, displayPct) {
                var progressText = (data.total && data.total > 0)
                    ? (data.progress || 0) + '/' + data.total
                    : (data.progress || 0) + '/?';
                return (data.status_display || 'Preparing Excel...') + ' ' + Math.round(displayPct || 0) + '% (' + progressText + ')';
            }
        });
        return;
    }

    // Use DownloadManager if available
    if (window.DownloadManager) {
        window.DownloadManager.start({
            name: 'Excel Spreadsheet',
            url: `/api/table/${tableId}/cards/download-xlsx/`,
            body: Object.assign({ card_ids: cardIds, status: _getCurrentStatus() }, _getActiveFilters()),
            lockUi: true,
            modalType: 'xlsx',
            fallbackExt: 'xlsx',
            completeMessage: 'Excel file downloaded successfully!',
            onComplete: function() {
                if (includeImagesZip) {
                    downloadImages(cardIds);
                }
                _moveCardsToDownloadIfApproved(cardIds);
            },
            onError: function(msg) {
                console.error('XLSX download error:', msg);
            }
        });
        return;
    }

    // Legacy fallback
    var _legacyXlsxLockActive = true;
    _setBulkUiLock(true);

    function _releaseLegacyXlsxLock() {
        if (!_legacyXlsxLockActive) return;
        _setBulkUiLock(false);
        _legacyXlsxLockActive = false;
    }

    if (typeof showProgressToast === 'function') showProgressToast('Preparing Excel file...', -1);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/table/${tableId}/cards/download-xlsx/`, true);
    xhr.timeout = 600000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
    xhr.responseType = 'blob';
    
    xhr.onprogress = function(event) {
        if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            if (typeof showProgressToast === 'function') showProgressToast(`Downloading... ${percentComplete}%`, percentComplete);
        } else {
            if (typeof showProgressToast === 'function') showProgressToast('Downloading...', -1);
        }
    };
    
    xhr.onload = function() {
        if (xhr.status === 200) {
            const blob = xhr.response;
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = _getDownloadFilename(xhr, 'xlsx');
            
            document.body.appendChild(a);
            a.click();
            
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            if (typeof showDownloadComplete === 'function') showDownloadComplete('Excel file downloaded successfully!');
            if (includeImagesZip) {
                downloadImages(cardIds);
            }
            _moveCardsToDownloadIfApproved(cardIds);
            _releaseLegacyXlsxLock();
        } else {
            if (typeof hideProgressToast === 'function') hideProgressToast();
            const reader = new FileReader();
            reader.onload = function() {
                try {
                    const error = JSON.parse(reader.result);
                    if (typeof showToast === 'function') showToast(error.message || 'Failed to download Excel file', false);
                } catch(e) {
                    if (typeof showToast === 'function') showToast('Failed to download Excel file', false);
                }
                _releaseLegacyXlsxLock();
            };
            reader.readAsText(xhr.response);
        }
    };
    
    xhr.onerror = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Failed to download Excel file', false);
        _releaseLegacyXlsxLock();
    };
    
    xhr.ontimeout = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Excel download timed out. Try selecting fewer cards.', false);
        _releaseLegacyXlsxLock();
    };
    
    xhr.send(JSON.stringify(Object.assign({ card_ids: cardIds, status: _getCurrentStatus() }, _getActiveFilters())));
}

// ==========================================
// DOWNLOAD PDF
// Uses DownloadManager for blob-based response
// For large exports (500+ cards or no selection), uses async background generation
// ==========================================

/**
 * Threshold: if exporting more cards than this (or all cards),
 * use async/background PDF generation to avoid proxy timeouts.
 */
var _ASYNC_PDF_THRESHOLD = 500;

/**
 * Threshold for async XLSX/DOCX/ZIP task routing.
 */
var _ASYNC_EXPORT_THRESHOLD = 500;

/**
 * Poll interval for checking async export status (ms).
 */
var _POLL_INTERVAL = 2000;

function downloadPdf(cardIds, templateId, fontMode, shortenTitles, breakMode) {
    templateId = templateId || '';
    fontMode = fontMode || 'auto';
    shortenTitles = !!shortenTitles;
    breakMode = (breakMode === 'class_only') ? 'class_only' : 'class_section';
    
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }

    // Use DownloadManager if available. The PDF modal now prefers the stable
    // direct download path so the progress UI stays in sync with one request.
    if (window.DownloadManager) {
        window.DownloadManager.start({
            name: 'PDF Document',
            url: `/api/table/${tableId}/cards/download-pdf/`,
            body: Object.assign({ card_ids: cardIds, status: _getCurrentStatus(), template_id: templateId || '', font_mode: fontMode, shorten_titles: shortenTitles, break_mode: breakMode, prefer_sync: true }, _getActiveFilters()),
            lockUi: true,
            modalType: 'pdf',
            fallbackExt: 'pdf',
            completeMessage: 'PDF file downloaded successfully!',
            onComplete: function() {
                // PDF export: do NOT move cards to download list
            },
            onError: function(msg) {
                console.error('PDF download error:', msg);
            }
        });
        return;
    }

    // Legacy fallback
    _downloadPdfLegacy(tableId, cardIds, templateId, fontMode, shortenTitles, breakMode);
}

/**
 * Async PDF export: starts background generation + polls for completion.
 * Used for large datasets (500+ cards) to avoid Cloudflare's ~100s timeout.
 */
function _downloadPdfAsync(tableId, cardIds, templateId, fontMode, shortenTitles, breakMode) {
    // Cancellation flag for the polling loop
    var _pdfAsyncCancelled = false;
    var _pdfCancelRequested = false;
    var _pdfActiveTaskId = null;
    var _bulkUiLockActive = _consumeNextBulkUiLockFlag();
    _bulkUiLockActive = true;

    function _releaseBulkUiLock() {
        if (!_bulkUiLockActive) return;
        _setBulkUiLock(false);
        _bulkUiLockActive = false;
    }

    if (_bulkUiLockActive) _setBulkUiLock(true);

    function _requestPdfTaskCancel(taskId) {
        if (!taskId) return;
        fetch('/api/task-cancel/' + taskId + '/', {
            method: 'POST',
            headers: {
                'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : '',
                'X-Requested-With': 'XMLHttpRequest'
            }
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (typeof showToast === 'function') {
                    showToast((data && data.message) || 'PDF export cancelled', 'info');
                }
            })
            .catch(function (err) {
                if (typeof showToast === 'function') showToast('PDF cancel request sent', 'info');
                console.error('Cancel PDF export task failed:', err);
            });
    }

    var cancelFn = function () {
        if (_pdfCancelRequested) return;
        _pdfCancelRequested = true;
        _pdfAsyncCancelled = true;
        _releaseBulkUiLock();

        if (_pdfActiveTaskId) {
            _requestPdfTaskCancel(_pdfActiveTaskId);
        } else if (typeof showToast === 'function') {
            showToast('PDF export cancelled', 'info');
        }
    };

    if (typeof showProgressToast === 'function') {
        showProgressToast('Starting PDF generation...', 5, cancelFn);
    }

    var body = Object.assign({
        card_ids: cardIds,
        status: _getCurrentStatus(),
        template_id: templateId || '',
        font_mode: fontMode || 'auto',
        shorten_titles: !!shortenTitles,
        break_mode: (breakMode === 'class_only') ? 'class_only' : 'class_section'
    }, _getActiveFilters());

    // Start async export
    if (typeof apiCall === 'function') {
        apiCall('/api/table/' + tableId + '/cards/download-pdf-async/', 'POST', body, { timeout: 30000 })
            .then(function(data) {
                if (!data.success) {
                    if (typeof hideProgressToast === 'function') hideProgressToast();
                    if (typeof showToast === 'function') showToast(data.message || 'Failed to start PDF export', false);
                    _releaseBulkUiLock();
                    return;
                }

                _pdfActiveTaskId = data.task_id;
                if (_pdfAsyncCancelled) {
                    _requestPdfTaskCancel(data.task_id);
                    return;
                }

                // Start polling for completion
                _pollExportStatus(data.task_id, data.card_count || 0, function() { return _pdfAsyncCancelled; }, cancelFn, function() {
                    _pdfActiveTaskId = null;
                    _pdfCancelRequested = false;
                    _releaseBulkUiLock();
                });
            })
            .catch(function(err) {
                if (typeof hideProgressToast === 'function') hideProgressToast();
                if (typeof showToast === 'function') showToast('Failed to start PDF export. Please try again.', false);
                console.error('Async PDF start error:', err);
                _releaseBulkUiLock();
            });
    } else {
        // Fallback: use fetch
        fetch('/api/table/' + tableId + '/cards/download-pdf-async/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : ''
            },
            body: JSON.stringify(body)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                if (typeof hideProgressToast === 'function') hideProgressToast();
                if (typeof showToast === 'function') showToast(data.message || 'Failed to start PDF export', false);
                _releaseBulkUiLock();
                return;
            }

            _pdfActiveTaskId = data.task_id;
            if (_pdfAsyncCancelled) {
                _requestPdfTaskCancel(data.task_id);
                return;
            }

            _pollExportStatus(data.task_id, data.card_count || 0, function() { return _pdfAsyncCancelled; }, cancelFn, function() {
                _pdfActiveTaskId = null;
                _pdfCancelRequested = false;
                _releaseBulkUiLock();
            });
        })
        .catch(function(err) {
            if (typeof hideProgressToast === 'function') hideProgressToast();
            if (typeof showToast === 'function') showToast('Failed to start PDF export. Please try again.', false);
            console.error('Async PDF start error:', err);
            _releaseBulkUiLock();
        });
    }
}

/**
 * Poll the export status endpoint until the PDF is ready or fails.
 * Uses time-based estimation when backend reports 0% to keep the bar moving.
 * @param {string} taskId
 * @param {number} cardCount
 * @param {Function} isCancelled - returns true if user cancelled
 * @param {Function} cancelFn - passed to showProgressToast for cancel button
 */
function _pollExportStatus(taskId, cardCount, isCancelled, cancelFn, onFinalize) {
    var pollCount = 0;
    var maxPolls = 300; // 300 * 2s = 10 minutes max
    var pollErrorCount = 0;
    var maxPollErrors = 6;
    var _pollStartTime = Date.now();
    // Estimate processing time: ~0.3s per card for PDF, min 10s, max 300s
    var _estSeconds = Math.max(10, Math.min(300, (cardCount || 100) * 0.3));
    var finalized = false;

    function finalizeOnce() {
        if (finalized) return;
        finalized = true;
        if (typeof onFinalize === 'function') {
            try { onFinalize(); } catch (e) { console.error(e); }
        }
    }

    function poll() {
        // Check if user cancelled
        if (typeof isCancelled === 'function' && isCancelled()) {
            if (typeof hideProgressToast === 'function') hideProgressToast();
            finalizeOnce();
            return;
        }

        pollCount++;
        if (pollCount > maxPolls) {
            if (typeof hideProgressToast === 'function') hideProgressToast();
            if (typeof showToast === 'function') showToast('PDF generation timed out. Please try again with fewer cards.', false);
            finalizeOnce();
            return;
        }

        fetch('/api/export/status/' + taskId + '/', {
            headers: {
                'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : ''
            }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            pollErrorCount = 0;

            if (!data.success) {
                if (typeof hideProgressToast === 'function') hideProgressToast();
                if (typeof showToast === 'function') showToast(data.message || 'Export task not found', false);
                finalizeOnce();
                return;
            }

            if (data.state === 'completed') {
                var sizeLabel = _getExportSizeLabel(data);
                var readyMessage = sizeLabel
                    ? ('PDF ready (' + sizeLabel + ')! Starting download...')
                    : 'PDF ready! Starting download...';

                if (typeof showProgressToast === 'function') {
                    showProgressToast(readyMessage, 100);
                }
                // Trigger download
                setTimeout(function() {
                    var a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = data.download_url;
                    a.download = data.filename || 'export.pdf';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    if (typeof showDownloadComplete === 'function') {
                        var doneMessage = sizeLabel
                            ? ('PDF file downloaded successfully! (' + sizeLabel + ')')
                            : 'PDF file downloaded successfully!';
                        showDownloadComplete(doneMessage);
                    }
                    finalizeOnce();
                }, 500);
            } else if (data.state === 'failed' || data.state === 'cancelled') {
                if (typeof hideProgressToast === 'function') hideProgressToast();
                if (typeof showToast === 'function') {
                    showToast(data.message || (data.state === 'cancelled' ? 'PDF export cancelled' : 'PDF generation failed'), data.state === 'cancelled' ? 'info' : false);
                }
                finalizeOnce();
            } else {
                // Still processing  compute display progress
                var serverPct = data.progress || 0;
                // Time-based estimation: exponential approach to 90%
                var elapsed = (Date.now() - _pollStartTime) / 1000;
                var tau = _estSeconds / 3; // reaches ~95% at 3tau
                var estimatedPct = Math.round(90 * (1 - Math.exp(-elapsed / tau)));
                // Use whichever is higher (server or estimated), cap at 95%
                var displayPct = Math.min(Math.max(serverPct, estimatedPct), 95);

                var msg = data.message || ('Generating PDF' + (cardCount ? ' (' + cardCount + ' cards)' : '') + '...');
                if (typeof showProgressToast === 'function') {
                    showProgressToast(msg, displayPct, cancelFn);
                }
                setTimeout(poll, _POLL_INTERVAL);
            }
        })
        .catch(function(err) {
            console.error('Export status poll error:', err);
            pollErrorCount++;
            if (pollErrorCount >= maxPollErrors) {
                if (typeof hideProgressToast === 'function') hideProgressToast();
                if (typeof showToast === 'function') showToast('Lost connection while tracking PDF export. Please refresh to verify result.', 'warning');
                finalizeOnce();
                return;
            }
            // Retry on transient network errors.
            setTimeout(poll, _POLL_INTERVAL * 2);
        });
    }

    // Start polling after a short delay (give server time to start)
    setTimeout(poll, 1000);
}

/**
 * Legacy synchronous PDF download (for small exports without DownloadManager).
 */
function _downloadPdfLegacy(tableId, cardIds, templateId, fontMode, shortenTitles, breakMode) {
    var _legacyPdfLockActive = true;
    _setBulkUiLock(true);

    function _releaseLegacyPdfLock() {
        if (!_legacyPdfLockActive) return;
        _setBulkUiLock(false);
        _legacyPdfLockActive = false;
    }

    const xhr = new XMLHttpRequest();
    var cancelFn = function () {
        xhr.abort();
        _releaseLegacyPdfLock();
        if (typeof showToast === 'function') showToast('PDF download cancelled', 'info');
    };
    if (typeof showProgressToast === 'function') showProgressToast('Preparing PDF file...', -1, cancelFn);
    xhr.open('POST', `/api/table/${tableId}/cards/download-pdf/`, true);
    xhr.timeout = 600000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
    xhr.responseType = 'blob';
    
    xhr.onprogress = function(event) {
        if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            if (typeof showProgressToast === 'function') showProgressToast(`Downloading... ${percentComplete}%`, percentComplete);
        } else {
            if (typeof showProgressToast === 'function') showProgressToast('Downloading...', -1);
        }
    };
    
    xhr.onload = function() {
        if (xhr.status === 200) {
            const blob = xhr.response;
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = _getDownloadFilename(xhr, 'pdf');
            
            document.body.appendChild(a);
            a.click();
            
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            if (typeof showDownloadComplete === 'function') showDownloadComplete('PDF file downloaded successfully!');
            _releaseLegacyPdfLock();
        } else {
            if (typeof hideProgressToast === 'function') hideProgressToast();
            const reader = new FileReader();
            reader.onload = function() {
                try {
                    const error = JSON.parse(reader.result);
                    if (typeof showToast === 'function') showToast(error.message || 'Failed to download PDF file', false);
                } catch(e) {
                    if (typeof showToast === 'function') showToast('Failed to download PDF file', false);
                }
                _releaseLegacyPdfLock();
            };
            reader.readAsText(xhr.response);
        }
    };
    
    xhr.onerror = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Failed to download PDF file', false);
        _releaseLegacyPdfLock();
    };
    
    xhr.ontimeout = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('PDF download timed out. Try selecting fewer cards.', false);
        _releaseLegacyPdfLock();
    };

    xhr.onabort = function() {
        _releaseLegacyPdfLock();
    };
    
    xhr.send(JSON.stringify(Object.assign({ card_ids: cardIds, status: _getCurrentStatus(), template_id: templateId || '', font_mode: fontMode || 'auto', shorten_titles: !!shortenTitles, break_mode: (breakMode === 'class_only') ? 'class_only' : 'class_section' }, _getActiveFilters())));
}

/**
 * Extract filename from Content-Disposition header, or use fallback.
 * (Legacy helper  used only by fallback XHR paths)
 */
function _getDownloadFilename(xhr, fallbackExt) {
    const disposition = xhr.getResponseHeader('Content-Disposition');
    if (disposition) {
        let match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i);
        if (match && match[1]) return decodeURIComponent(match[1]);
    }
    const clientName = (typeof CLIENT_NAME !== 'undefined' ? CLIENT_NAME : '').replace(/\s+/g, '');
    const tableName = (typeof TABLE_NAME !== 'undefined' ? TABLE_NAME : '').replace(/\s+/g, '');
    const status = (typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : 'pending');
    const statusCap = status.charAt(0).toUpperCase() + status.slice(1);
    const parts = [clientName, tableName, statusCap].filter(Boolean);
    return (parts.length ? parts.join('_') : 'export') + '.' + fallbackExt;
}

// ==========================================
// EXPOSE ON IDCardApp
// ==========================================

window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.downloadImages = downloadImages;
window.IDCardApp.downloadDocx = downloadDocx;
window.IDCardApp.downloadXlsx = downloadXlsx;
window.IDCardApp.downloadPdf = downloadPdf;

})();
