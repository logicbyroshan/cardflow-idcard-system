// ID Card Actions - Upload Logic Sub-module
// XLSX file parsing, validation, XHR upload, ZIP handling
// Part of IDCardApp module system  registers functions on window.IDCardApp

(function() {
'use strict';

// ==========================================
// ALIASES TO SHARED STATE & FUNCTIONS (from UI sub-module)
// ==========================================

var _us = window.IDCardApp._uploadState;
_us.unifiedFolderFiles = _us.unifiedFolderFiles || [];
var isImageField = window.IDCardApp._uploadFns.isImageField;
var normalizeImageIdentifier = window.IDCardApp._uploadFns.normalizeImageIdentifier;
var findBestMatch = window.IDCardApp._uploadFns.findBestMatch;
var escHtml = window.IDCardApp._uploadFns.escHtml;
var setWizardStep = window.IDCardApp._uploadFns.setWizardStep;
var getCurrentFieldMapping = window.IDCardApp._uploadFns.getCurrentFieldMapping;
var resetFileSelection = window.IDCardApp._uploadFns.resetFileSelection;
var showValidationResults = window.IDCardApp._uploadFns.showValidationResults;
var closeUploadModalFn = window.IDCardApp._uploadFns.closeUploadModalFn;
var updateNextButtonState = window.IDCardApp._uploadFns.updateNextButtonState;

function _isProUserFolderUploadEnabled() {
    var role = '';
    if (document && document.body) {
        role = String(document.body.getAttribute('data-user-role') || '').toLowerCase();
    }
    return role === 'pro_user';
}

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

    // Upload lifecycle state (shared across handlers)
    var _uploadXhr = null;
    var _uploadTaskId = null;
    var _taskPollTimer = null;
    var _retryTimer = null;
    var _uploadRetryCount = 0;
    var _pollErrorCount = 0;
    var _uploadInProgress = false;
    var _cancelRequested = false;
    var _activeResetUploadState = null;

    function _clearAsyncTimers() {
        if (_taskPollTimer) {
            clearTimeout(_taskPollTimer);
            _taskPollTimer = null;
        }
        if (_retryTimer) {
            clearTimeout(_retryTimer);
            _retryTimer = null;
        }
    }

    function _cancelActiveUpload(options) {
        var opts = options || {};
        if (!_uploadInProgress && !_uploadXhr && !_taskPollTimer && !_retryTimer && !_uploadTaskId) {
            if (opts.closeModal) closeUploadModalFn();
            return;
        }

        _cancelRequested = true;
        _clearAsyncTimers();

        if (_uploadXhr) {
            try {
                _uploadXhr.abort();
            } catch (_err) {
                // no-op
            }
            _uploadXhr = null;
        }

        if (_uploadTaskId) {
            fetch('/api/task-cancel/' + _uploadTaskId + '/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : '',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            }).catch(function(err) {
                console.error('Cancel upload task failed:', err);
            });
        }

        _uploadTaskId = null;
        _uploadRetryCount = 0;
        _pollErrorCount = 0;
        _uploadInProgress = false;

        if (typeof _activeResetUploadState === 'function') {
            _activeResetUploadState();
            _activeResetUploadState = null;
        } else if (typeof hideBlockingOverlay === 'function') {
            hideBlockingOverlay();
        }

        _cancelRequested = false;
        if (opts.closeModal) closeUploadModalFn();
        if (opts.notify !== false && typeof showToast === 'function') showToast('Upload cancelled', 'warning');
    }

    window.IDCardApp.cancelActiveUpload = _cancelActiveUpload;

    function handleModalCloseClick() {
        if (_uploadInProgress || _uploadXhr || _taskPollTimer || _retryTimer || _uploadTaskId) {
            _cancelActiveUpload({ notify: true, closeModal: true });
            return;
        }
        closeUploadModalFn();
    }

    // Modal close handlers
    if (closeUploadModal) closeUploadModal.addEventListener('click', handleModalCloseClick);
    if (cancelUploadModal) cancelUploadModal.addEventListener('click', handleModalCloseClick);
    if (uploadModalOverlay) {
        // Disabled  prevent accidental closure on outside click
    }

    // Upload XLSX button opens the modal (Step 1)
    if (uploadXlsxBtn) {
        uploadXlsxBtn.addEventListener('click', function() {
            window.IDCardApp._uploadFns.resetUploadModal();
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
            _us.pendingUploadFile = null;
            _us.uploadedHeaders = [];
            if (fileSelectStage) fileSelectStage.style.display = '';
            if (validationStage) validationStage.style.display = 'none';
            if (nextBtn) nextBtn.style.display = 'none';
        });
    }

    // File input change handler  validates and shows field mapping
    if (xlsxFileInput) {
        xlsxFileInput.addEventListener('change', async function() {
            var file = this.files[0];
            if (!file) return;

            var validTypes = ['.xlsx', '.xls', '.csv'];
            var fileName = file.name.toLowerCase();
            var isValid = validTypes.some(function(ext) { return fileName.endsWith(ext); });

            if (!isValid) {
                if (typeof showToast === 'function') showToast('Please upload an Excel (.xlsx, .xls) or CSV file', 'warning');
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

                _us.uploadedHeaders = (jsonData[0] || []).map(function(h) { return String(h || '').trim(); }).filter(function(h) { return h; });

                if (_us.uploadedHeaders.length === 0) {
                    if (typeof showToast === 'function') showToast('No headers found in the uploaded file!', false);
                    this.value = '';
                    resetFileSelection();
                    if (step1Progress) step1Progress.style.display = 'none';
                    return;
                }

                var matchedFields = [];
                var unmatchedUploadedFields = [];
                var usedTableFields = new Set();

                _us.uploadedHeaders.forEach(function(header) {
                    var match = findBestMatch(header, tableFieldNames.filter(function(f) { return !usedTableFields.has(f); }));
                    if (match) {
                        matchedFields.push({ uploaded: header, tableField: match.field, type: match.type });
                        usedTableFields.add(match.field);
                    } else {
                        unmatchedUploadedFields.push(header);
                    }
                });

                var missingTableFields = tableFieldNames.filter(function(f) { return !usedTableFields.has(f); });
                _us.currentDataRowCount = jsonData.slice(1).filter(function(row) {
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
                    _us.pendingUploadFile = file;
                    showValidationResults(
                        matchedFields,
                        missingTableFields,
                        unmatchedUploadedFields,
                        _us.currentDataRowCount,
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

    //  NEXT button (Step 1  Step 2) 
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

    //  BACK button (Step 2  Step 1) 
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            setWizardStep(1);
        });
    }

    //  UPLOAD button (Step 2  send to server) 
    if (confirmUploadModal) {
        confirmUploadModal.addEventListener('click', async function() {
            if (_uploadInProgress) {
                if (typeof showToast === 'function') showToast('Upload already in progress.', 'warning');
                return;
            }

            if (!_us.pendingUploadFile) {
                if (typeof showToast === 'function') showToast('No file to upload', false);
                closeUploadModalFn();
                return;
            }

            _uploadInProgress = true;
            _cancelRequested = false;
            _uploadRetryCount = 0;
            _pollErrorCount = 0;
            _clearAsyncTimers();

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
            if (backBtnEl) backBtnEl.disabled = true;

            if (progressSection) progressSection.style.display = 'block';

            // Show blocking overlay with cancel support
            if (typeof showBlockingOverlay === 'function') {
                showBlockingOverlay('Uploading data...', function() {
                    _cancelActiveUpload({ notify: true, closeModal: false });
                });
            }

            var formData = new FormData();
            formData.append('file', _us.pendingUploadFile);

            // Send the manual field mapping so backend uses it
            var fieldMapping = getCurrentFieldMapping();
            formData.append('field_mapping', JSON.stringify(fieldMapping));

            // Append multiple ZIP files with their field names (legacy per-field mode)
            Object.keys(_us.pendingZipFiles).forEach(function(fieldName) {
                if (_us.pendingZipFiles[fieldName]) {
                    formData.append('photos_zip_' + fieldName, _us.pendingZipFiles[fieldName]);
                }
            });
            formData.append('zip_field_names', JSON.stringify(Object.keys(_us.pendingZipFiles)));

            // Send unified ZIP files
            var unifiedZips = getUnifiedZipFiles();
            if (unifiedZips && unifiedZips.length > 0) {
                unifiedZips.forEach(function(file, index) {
                    formData.append('unified_zip_' + index, file);
                });
                formData.append('unified_zip_count', unifiedZips.length.toString());
            }

            if (_isProUserFolderUploadEnabled() && _us.unifiedFolderFiles && _us.unifiedFolderFiles.length > 0) {
                _us.unifiedFolderFiles.forEach(function(file) {
                    formData.append('photos_folder_files', file, file.webkitRelativePath || file.name);
                });
            }

            var unifiedFolderPathInput = document.getElementById('unifiedFolderPathInput');
            if (_isProUserFolderUploadEnabled() && unifiedFolderPathInput && unifiedFolderPathInput.value && unifiedFolderPathInput.value.trim()) {
                formData.append('photos_folder_path', unifiedFolderPathInput.value.trim());
            }

            function _buildBulkUploadResultMessage(taskData) {
                var result = (taskData && taskData.result) ? taskData.result : {};
                var cards = Number(result.cards_created);
                var photos = Number(result.photos_matched);
                var msg = [];
                if (isFinite(cards) && cards >= 0) msg.push('Created ' + cards + ' cards');
                if (isFinite(photos) && photos >= 0) msg.push(photos + ' photos matched');
                if (!msg.length && taskData && taskData.message) return taskData.message;
                return msg.length ? msg.join(' | ') : 'Bulk upload completed successfully';
            }

            function _pollBulkUploadTask(taskId) {
                function _pollOnce() {
                    if (_cancelRequested || !_uploadInProgress) return;

                    fetch('/api/task-status/' + taskId + '/', {
                        headers: {
                            'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : '',
                            'X-Requested-With': 'XMLHttpRequest'
                        }
                    })
                        .then(function(r) { return r.json(); })
                        .then(function(taskData) {
                            if (_cancelRequested || !_uploadInProgress) return;

                            if (!taskData || !taskData.success) {
                                _pollErrorCount++;
                                if (_pollErrorCount >= 6) {
                                    if (typeof showToast === 'function') showToast((taskData && taskData.message) || 'Could not read upload status.', false);
                                    resetUploadState();
                                    return;
                                }
                                _taskPollTimer = setTimeout(_pollOnce, 3000);
                                return;
                            }

                            _pollErrorCount = 0;

                            if (taskData.status === 'completed') {
                                if (progressBar) { progressBar.style.width = '100%'; progressBar.classList.remove('processing'); }
                                if (percentageText) percentageText.textContent = '100%';
                                if (sizeText) sizeText.textContent = 'Upload complete';
                                if (timeText) timeText.textContent = 'Complete!';
                                if (typeof hideBlockingOverlay === 'function') hideBlockingOverlay();
                                _uploadTaskId = null;
                                _taskPollTimer = null;

                                var successMessage = _buildBulkUploadResultMessage(taskData);
                                setTimeout(function() {
                                    closeUploadModalFn();
                                    if (typeof showToast === 'function') showToast(successMessage, true);
                                    setTimeout(function() {
                                        if (window.IDCardApp && typeof window.IDCardApp.refreshCardTable === 'function') {
                                            window.IDCardApp.refreshCardTable();
                                        } else if (window.IDCardPage && typeof window.IDCardPage.navigateStatusNoReload === 'function') {
                                            window.IDCardPage.navigateStatusNoReload((typeof CURRENT_STATUS !== 'undefined' && CURRENT_STATUS) ? CURRENT_STATUS : 'pending');
                                        } else {
                                            console.warn('upload completion fallback skipped: no refresh bridge available');
                                        }
                                    }, 1500);
                                }, 400);
                                return;
                            }

                            if (taskData.status === 'failed' || taskData.status === 'cancelled') {
                                var failMsg = taskData.error_message || 'Upload failed while processing data.';
                                if (typeof showToast === 'function') showToast(failMsg, false);
                                resetUploadState();
                                return;
                            }

                            var backendPct = Number(taskData.progress_percentage || 0);
                            if (!isFinite(backendPct)) backendPct = 0;
                            backendPct = Math.max(0, Math.min(100, backendPct));
                            var displayPct = Math.min(99, 65 + Math.round((backendPct * 35) / 100));

                            if (progressBar) { progressBar.style.width = displayPct + '%'; progressBar.classList.add('processing'); }
                            if (percentageText) percentageText.textContent = displayPct + '%';
                            if (sizeText) sizeText.textContent = 'Upload complete';
                            if (timeText) timeText.textContent = 'Processing rows: ' + (taskData.progress || 0) + '/' + (taskData.total || '?');
                            if (typeof updateBlockingOverlay === 'function') {
                                updateBlockingOverlay(displayPct, 'Processing... ' + displayPct + '%');
                            }

                            _taskPollTimer = setTimeout(_pollOnce, 2000);
                        })
                        .catch(function(err) {
                            if (_cancelRequested || !_uploadInProgress) return;
                            console.error('Bulk upload task poll error:', err);
                            _pollErrorCount++;
                            if (_pollErrorCount >= 6) {
                                if (typeof showToast === 'function') showToast('Lost connection while checking upload status. Please refresh and verify upload result.', 'warning');
                                resetUploadState();
                                return;
                            }
                            _taskPollTimer = setTimeout(_pollOnce, 4000);
                        });
                }

                _pollOnce();
            }

            //  Reusable upload sender (supports retry with fresh XHR) 
            function _createAndSendXhr() {
            var xhr = new XMLHttpRequest();
            _uploadXhr = xhr; // Store reference for cancel
            var startTime = Date.now();

            xhr.upload.addEventListener('progress', function(e) {
                if (e.lengthComputable) {
                    var rawPercentComplete = Math.round((e.loaded / e.total) * 100);
                    var percentComplete = Math.min(65, Math.round((rawPercentComplete * 65) / 100));
                    var elapsedTime = (Date.now() - startTime) / 1000;
                    var uploadSpeed = e.loaded / elapsedTime;
                    var remainingBytes = e.total - e.loaded;
                    var remainingTime = remainingBytes / uploadSpeed;

                    if (progressBar) progressBar.style.width = percentComplete + '%';
                    if (percentageText) percentageText.textContent = percentComplete + '%';

                    // Update blocking overlay
                    if (typeof updateBlockingOverlay === 'function') {
                        updateBlockingOverlay(percentComplete, 'Uploading... ' + percentComplete + '%');
                    }

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
                if (progressBar) progressBar.style.width = '65%';
                if (percentageText) percentageText.textContent = '65%';
                if (sizeText) sizeText.textContent = 'Upload complete';
                if (timeText) timeText.textContent = 'Server processing data...';
                if (progressBar) progressBar.classList.add('processing');
            });

            //  Retry helper: creates a fresh XHR with all handlers 
            function _retryUpload(reason) {
                if (_cancelRequested || !_uploadInProgress) return;

                if (reason === 'ratelimit') {
                    if (typeof showToast === 'function') showToast('Another upload is already running. Please wait and try again.', 'warning');
                    resetUploadState();
                    return;
                }

                _uploadRetryCount = _uploadRetryCount + 1;
                if (_uploadRetryCount > 2) {
                    if (reason === 'network') {
                        if (typeof showToast === 'function') showToast('Upload failed after multiple retries. Please check your connection and try again.', false);
                    }
                    resetUploadState();
                    return;
                }
                var delayMsg = reason === 'network' ? 'Network error. Retrying in 5s...' : 'Server is busy. Retrying...';
                if (timeText) timeText.textContent = delayMsg;
                if (reason === 'network' && typeof showToast === 'function') showToast('Network error. Retrying automatically...', false);
                _retryTimer = setTimeout(function() {
                    if (_cancelRequested || !_uploadInProgress) return;
                    if (timeText) timeText.textContent = 'Retrying upload...';
                    if (progressBar) { progressBar.style.width = '0%'; progressBar.classList.remove('processing'); }
                    _createAndSendXhr();  // Create a completely fresh XHR with all handlers
                }, 5000);
            }

            xhr.addEventListener('load', function() {
                try {
                    var result = JSON.parse(xhr.responseText);

                    if (xhr.status === 200 && result.success) {
                        _uploadXhr = null;

                        if (result.task_id) {
                            _uploadTaskId = result.task_id;
                            if (progressBar) { progressBar.style.width = '66%'; progressBar.classList.add('processing'); }
                            if (percentageText) percentageText.textContent = '66%';
                            if (sizeText) sizeText.textContent = 'Upload complete';
                            if (timeText) timeText.textContent = 'Queued for processing...';
                            _pollBulkUploadTask(result.task_id);
                            return;
                        }

                        // Legacy fallback if server returns immediate completion payload.
                        if (progressBar) { progressBar.style.width = '100%'; progressBar.classList.remove('processing'); }
                        if (percentageText) percentageText.textContent = '100%';
                        if (timeText) timeText.textContent = 'Complete!';
                        if (typeof hideBlockingOverlay === 'function') hideBlockingOverlay();

                        setTimeout(function() {
                            closeUploadModalFn();
                            if (typeof showToast === 'function') showToast(result.message || 'Upload completed successfully', true);
                            setTimeout(function() {
                                if (window.IDCardApp && typeof window.IDCardApp.refreshCardTable === 'function') {
                                    window.IDCardApp.refreshCardTable();
                                } else if (window.IDCardPage && typeof window.IDCardPage.navigateStatusNoReload === 'function') {
                                    window.IDCardPage.navigateStatusNoReload((typeof CURRENT_STATUS !== 'undefined' && CURRENT_STATUS) ? CURRENT_STATUS : 'pending');
                                } else {
                                    console.warn('upload completion fallback skipped: no refresh bridge available');
                                }
                            }, 1500);
                        }, 500);
                    } else if (xhr.status === 429) {
                        var retryMsg = result.message || 'Another upload is already running. Please wait and try again.';
                        if (typeof showToast === 'function') showToast(retryMsg, 'warning');
                        resetUploadState();
                    } else {
                        var errorMessage = result.message || 'Upload failed (status: ' + xhr.status + ')';
                        if (result.errors && Array.isArray(result.errors) && result.errors.length > 0) {
                            var errorList = result.errors.slice(0, 3).join('\n ');
                            errorMessage += '\n\n ' + errorList;
                            if (result.errors.length > 3) {
                                errorMessage += '\n... and ' + (result.errors.length - 3) + ' more errors';
                            }
                        }
                        if (typeof showToast === 'function') showToast(errorMessage, result.level || false);
                        resetUploadState();
                    }
                } catch (error) {
                    console.error('Parse error:', error, 'Response status:', xhr.status, 'Response text:', xhr.responseText ? xhr.responseText.substring(0, 200) : '(empty)');
                    var parseErrorMsg = 'Server error';
                    if (xhr.status === 413) parseErrorMsg = 'File too large. Please reduce the file size and try again.';
                    else if (xhr.status === 502 || xhr.status === 504) parseErrorMsg = 'Server timeout  the file may be too large. Please try again.';
                    else if (xhr.status === 500) parseErrorMsg = 'Server error while processing upload. Please try again.';
                    else if (xhr.status === 0) parseErrorMsg = 'Connection lost. Please check your internet and try again.';
                    else parseErrorMsg = 'Failed to process server response (HTTP ' + xhr.status + ')';
                    if (typeof showToast === 'function') showToast(parseErrorMsg, (xhr.status === 413 || xhr.status === 502 || xhr.status === 504) ? 'warning' : false);
                    resetUploadState();
                }
            });

            xhr.addEventListener('error', function() {
                if (_cancelRequested || !_uploadInProgress) return;
                console.error('Upload XHR error  network failure');
                _retryUpload('network');
            });

            xhr.addEventListener('abort', function() {
                if (_cancelRequested || !_uploadInProgress) return;
                resetUploadState();
                if (typeof showToast === 'function') showToast('Upload cancelled', 'warning');
            });

            xhr.addEventListener('timeout', function() {
                if (_cancelRequested || !_uploadInProgress) return;
                console.error('Upload XHR timeout after 10 minutes');
                if (typeof showToast === 'function') showToast('Upload timed out  the server took too long to respond. Please try with a smaller file.', 'warning');
                resetUploadState();
            });

            var tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
            xhr.open('POST', '/api/table/' + tableId + '/bulk-upload-task/');
            xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
            xhr.timeout = 600000; // 10-minute timeout for large uploads
            xhr.send(formData);
            }  // end _createAndSendXhr

            function resetUploadState() {
                _clearAsyncTimers();
                if (progressSection) progressSection.style.display = 'none';
                if (progressBar) { progressBar.style.width = '0%'; progressBar.classList.remove('processing'); }
                confirmUploadModal.innerHTML = originalText;
                confirmUploadModal.disabled = false;
                if (cancelBtn) cancelBtn.disabled = false;
                if (backBtnEl) backBtnEl.disabled = false;

                _uploadInProgress = false;
                _cancelRequested = false;
                _uploadRetryCount = 0;
                _pollErrorCount = 0;
                _uploadXhr = null;
                _uploadTaskId = null;
                _activeResetUploadState = null;

                // Hide blocking overlay
                if (typeof hideBlockingOverlay === 'function') hideBlockingOverlay();
            }

            _activeResetUploadState = resetUploadState;
            _createAndSendXhr();  // Initial send
        });
    }
}

// ==========================================
// UNIFIED ZIP UPLOAD HANDLERS
// ==========================================

function initUnifiedZipUpload() {
    var selectBtn = document.getElementById('selectZipFilesBtn');
    var fileInput = document.getElementById('unifiedZipInput');
    var selectedList = document.getElementById('selectedZipsList');
    var folderSelectBtn = document.getElementById('selectFolderFilesBtn');
    var folderInput = document.getElementById('unifiedFolderInput');
    var selectedFolderSummary = document.getElementById('selectedFolderSummary');

    if (!selectBtn || !fileInput) return;

    selectBtn.addEventListener('click', function() { fileInput.click(); });

    var MAX_ZIP_SIZE_BYTES = 950 * 1024 * 1024; // 950 MB limit (server max is 1 GB)

    fileInput.addEventListener('change', async function() {
        var files = Array.from(this.files);

        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            if (!file.name.toLowerCase().endsWith('.zip')) {
                if (typeof showToast === 'function') showToast(file.name + ' is not a ZIP file', 'warning');
                continue;
            }
            if (file.size > MAX_ZIP_SIZE_BYTES) {
                var sizeMB = (file.size / (1024 * 1024)).toFixed(0);
                if (typeof showToast === 'function') showToast(file.name + ' is ' + sizeMB + ' MB  maximum allowed is 950 MB. Please split into smaller ZIPs.', 'error');
                continue;
            }
            if (_us.unifiedZipFiles.some(function(f) { return f.name === file.name; })) {
                if (typeof showToast === 'function') showToast(file.name + ' already added', 'warning');
                continue;
            }
            _us.unifiedZipFiles.push(file);
        }

        updateSelectedZipsList();
        this.value = '';
    });

    if (selectedList) {
        selectedList.addEventListener('click', function(e) {
            var removeBtn = e.target.closest('.remove-zip');
            if (removeBtn) {
                var zipName = removeBtn.dataset.zipName;
                _us.unifiedZipFiles = _us.unifiedZipFiles.filter(function(f) { return f.name !== zipName; });
                updateSelectedZipsList();
            }
        });
    }

    if (folderSelectBtn && folderInput) {
        folderSelectBtn.addEventListener('click', function() {
            if (!_isProUserFolderUploadEnabled()) {
                if (typeof showToast === 'function') showToast('Select Folder is available only for Pro User accounts.', 'warning');
                return;
            }
            folderInput.click();
        });
    }

    if (folderInput) {
        folderInput.addEventListener('change', function() {
            if (!_isProUserFolderUploadEnabled()) {
                _us.unifiedFolderFiles = [];
                this.value = '';
                if (selectedFolderSummary) {
                    selectedFolderSummary.style.display = 'none';
                    selectedFolderSummary.innerHTML = '';
                }
                if (typeof showToast === 'function') showToast('Select Folder is available only for Pro User accounts.', 'warning');
                return;
            }
            var files = Array.from(this.files || []).filter(function(f) {
                return /\.(jpe?g|png|gif|bmp|webp|heic|heif|hei)$/i.test(f.name || '');
            });
            _us.unifiedFolderFiles = files;
            if (selectedFolderSummary) {
                if (files.length > 0) {
                    selectedFolderSummary.style.display = 'block';
                    selectedFolderSummary.innerHTML = '<div class="selected-zip-item"><span class="zip-name"><i class="fa-solid fa-folder-tree"></i> ' + files.length + ' image file(s) selected from folder</span></div>';
                } else {
                    selectedFolderSummary.style.display = 'none';
                    selectedFolderSummary.innerHTML = '';
                }
            }
            this.value = '';
        });
    }
}

function updateSelectedZipsList() {
    var selectedList = document.getElementById('selectedZipsList');
    if (!selectedList) return;

    if (_us.unifiedZipFiles.length === 0) {
        selectedList.style.display = 'none';
        selectedList.innerHTML = '';
        return;
    }

    selectedList.style.display = 'block';
    selectedList.innerHTML = _us.unifiedZipFiles.map(function(file) {
        return '<div class="selected-zip-item">' +
            '<span class="zip-name"><i class="fa-solid fa-file-zipper"></i> ' + escHtml(file.name) + '</span>' +
            '<button class="remove-zip" data-zip-name="' + escHtml(file.name) + '" title="Remove"><i class="fa-solid fa-xmark"></i></button>' +
            '</div>';
    }).join('');
}

function getUnifiedZipFiles() {
    return _us.unifiedZipFiles;
}

function clearUnifiedZipFiles() {
    _us.unifiedZipFiles = [];
    _us.unifiedFolderFiles = [];
    updateSelectedZipsList();
    var selectedFolderSummary = document.getElementById('selectedFolderSummary');
    if (selectedFolderSummary) {
        selectedFolderSummary.style.display = 'none';
        selectedFolderSummary.innerHTML = '';
    }
    var folderPathInput = document.getElementById('unifiedFolderPathInput');
    if (folderPathInput) folderPathInput.value = '';
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
            delete _us.pendingZipFiles[fieldName];
            delete _us.zipFileNamesMap[fieldName];
            return;
        }

        if (!file.name.toLowerCase().endsWith('.zip')) {
            if (typeof showToast === 'function') showToast('Please select a ZIP file', 'error');
            fileInput.value = '';
            return;
        }

        var _maxZip = 950 * 1024 * 1024;
        if (file.size > _maxZip) {
            var _sizeMB = (file.size / (1024 * 1024)).toFixed(0);
            if (typeof showToast === 'function') showToast('ZIP is ' + _sizeMB + ' MB  maximum allowed is 950 MB. Please split into smaller ZIPs.', 'error');
            fileInput.value = '';
            return;
        }

        _us.pendingZipFiles[fieldName] = file;
        if (zipFileName) { zipFileName.textContent = file.name; zipFileName.classList.add('selected'); }

        try {
            var zip = await JSZip.loadAsync(file);
            var imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif', '.hei'];
            var imageCount = 0;
            _us.zipFileNamesMap[fieldName] = [];
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

                        _us.zipFileNamesMap[fieldName].push({
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
