// ID Card Actions - Download Logic Sub-module
// Core download functions: Images, DOCX, XLSX, PDF, and status management
// Part of IDCardApp module system — registers functions on window.IDCardApp
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

    // If cardIds is empty, we exported ALL approved cards — fetch them from backend first
    if (!cardIds || cardIds.length === 0) {
        // Use the all-ids endpoint to get every approved card
        var idsUrl = '/panel/api/table/' + tableId + '/cards/all-ids/?status=approved';
        var filters = _getActiveFilters();
        var params = [];
        if (filters.search) params.push('search=' + encodeURIComponent(filters.search));
        if (filters['class']) params.push('class=' + encodeURIComponent(filters['class']));
        if (filters.section) params.push('section=' + encodeURIComponent(filters.section));
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
        apiCall('/panel/api/table/' + tableId + '/cards/bulk-status/', 'POST', {
            card_ids: cardIds,
            status: 'download'
        }, { timeout: 120000 })
        .then(function(data) {
            if (data.success === false) {
                // Permission denied or validation error — silently log, don't interrupt UX
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
                location.reload();
            }
        })
        .catch(function(err) {
            // Don't show error toast — the export itself succeeded, this is a secondary action
            console.error('Failed to move cards to download:', err);
        });
    }
}

/**
 * Build filter params object for download request bodies.
 * Includes search, class, and section so backend fallback respects active filters.
 */
function _getActiveFilters() {
    const filters = {};
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.value.trim()) filters.search = searchInput.value.trim();
    if (IDCardApp.currentClassFilter) filters['class'] = IDCardApp.currentClassFilter;
    if (IDCardApp.currentSectionFilter) filters.section = IDCardApp.currentSectionFilter;
    // DateTime range (download list)
    const fromDate = document.getElementById('fromDateFilter');
    const toDate = document.getElementById('toDateFilter');
    if (fromDate && fromDate.value) filters.from = fromDate.value;
    if (toDate && toDate.value) filters.to = toDate.value;
    return filters;
}

// ==========================================
// DOWNLOAD IMAGES (Separate ZIP per image column)
// Uses DownloadManager.startImageDownload for JSON-based response
// ==========================================

function downloadImages(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }

    // Use DownloadManager if available
    if (window.DownloadManager) {
        window.DownloadManager.startImageDownload({
            name: 'Images ZIP',
            url: `/panel/api/table/${tableId}/cards/download-images/`,
            body: Object.assign({ card_ids: cardIds, status: _getCurrentStatus() }, _getActiveFilters()),
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
    if (typeof showProgressToast === 'function') showProgressToast('Preparing images...', -1);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/panel/api/table/${tableId}/cards/download-images/`, true);
    xhr.timeout = 600000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
    
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                const response = JSON.parse(xhr.responseText);
                
                if (response.success && response.zip_files && response.zip_files.length > 0) {
                    let downloadIndex = 0;
                    const totalZips = response.zip_files.length;
                    
                    function downloadNextZip() {
                        if (downloadIndex >= totalZips) {
                            if (typeof showDownloadComplete === 'function') {
                                showDownloadComplete(`Downloaded ${totalZips} ZIP file(s) with ${response.total_images} images!`);
                            }
                            return;
                        }
                        
                        const zipInfo = response.zip_files[downloadIndex];
                        
                        fetch('data:application/zip;base64,' + zipInfo.data)
                        .then(function(r) { return r.blob(); })
                        .then(function(blob) {
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.style.display = 'none';
                            a.href = url;
                            a.download = zipInfo.filename;
                            
                            document.body.appendChild(a);
                            a.click();
                            
                            window.URL.revokeObjectURL(url);
                            document.body.removeChild(a);
                            
                            downloadIndex++;
                            
                            if (typeof showProgressToast === 'function') {
                                showProgressToast(`Downloading ${downloadIndex}/${totalZips} ZIPs...`, Math.round((downloadIndex / totalZips) * 100));
                            }
                            
                            setTimeout(downloadNextZip, 300);
                        }).catch(function(err) {
                            console.error('ZIP download failed:', err);
                            if (typeof showToast === 'function') showToast('Failed to download ZIP file', false);
                        });
                    }
                    
                    downloadNextZip();
                    
                } else {
                    if (typeof hideProgressToast === 'function') hideProgressToast();
                    if (typeof showToast === 'function') showToast(response.message || 'No images found!', false);
                }
            } catch(e) {
                if (typeof hideProgressToast === 'function') hideProgressToast();
                if (typeof showToast === 'function') showToast('Failed to process download response', false);
                console.error('Download error:', e);
            }
        } else {
            if (typeof hideProgressToast === 'function') hideProgressToast();
            try {
                const error = JSON.parse(xhr.responseText);
                if (typeof showToast === 'function') showToast(error.message || 'Failed to download images', false);
            } catch(e) {
                if (typeof showToast === 'function') showToast('Failed to download images', false);
            }
        }
    };
    
    xhr.onerror = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Failed to download images', false);
    };
    
    xhr.ontimeout = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Image download timed out. Try selecting fewer cards.', false);
    };
    
    xhr.send(JSON.stringify(Object.assign({ card_ids: cardIds, status: _getCurrentStatus() }, _getActiveFilters())));
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
    
    // Close modals via DOM (modal state functions are in UI sub-module)
    var _docFormatOverlay = document.getElementById('docFormatModalOverlay');
    if (_docFormatOverlay) { _docFormatOverlay.classList.remove('active'); document.body.style.overflow = ''; }
    var _docxModal = document.getElementById('downloadDocxModal');
    if (_docxModal) _docxModal.style.display = 'none';

    // Use DownloadManager if available
    if (window.DownloadManager) {
        window.DownloadManager.start({
            name: format.toUpperCase() + ' Document',
            url: `/panel/api/table/${tableId}/cards/download-docx/`,
            body: Object.assign({ card_ids: cardIds, format: format, template_id: templateId || '', status: _getCurrentStatus() }, _getActiveFilters()),
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
    if (typeof showProgressToast === 'function') showProgressToast(`Preparing ${format.toUpperCase()} document...`, -1);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/panel/api/table/${tableId}/cards/download-docx/`, true);
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
            };
            reader.readAsText(xhr.response);
        }
    };
    
    xhr.onerror = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Failed to download document', false);
    };
    
    xhr.ontimeout = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Document download timed out. Try selecting fewer cards.', false);
    };
    
    xhr.send(JSON.stringify(Object.assign({ card_ids: cardIds, format: format, template_id: templateId || '', status: _getCurrentStatus() }, _getActiveFilters())));
}

// ==========================================
// DOWNLOAD XLSX
// Uses DownloadManager for blob-based response
// ==========================================

function downloadXlsx(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }

    // Use DownloadManager if available
    if (window.DownloadManager) {
        window.DownloadManager.start({
            name: 'Excel Spreadsheet',
            url: `/panel/api/table/${tableId}/cards/download-xlsx/`,
            body: Object.assign({ card_ids: cardIds, status: _getCurrentStatus() }, _getActiveFilters()),
            fallbackExt: 'xlsx',
            completeMessage: 'Excel file downloaded successfully!',
            onComplete: function() {
                // From Approved: also trigger separate ZIP photo download, then move to Download list
                if (_getCurrentStatus() === 'approved') {
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
    if (typeof showProgressToast === 'function') showProgressToast('Preparing Excel file...', -1);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/panel/api/table/${tableId}/cards/download-xlsx/`, true);
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
            // From Approved: also trigger separate ZIP photo download, then move to Download list
            if (_getCurrentStatus() === 'approved') {
                downloadImages(cardIds);
            }
            _moveCardsToDownloadIfApproved(cardIds);
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
            };
            reader.readAsText(xhr.response);
        }
    };
    
    xhr.onerror = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Failed to download Excel file', false);
    };
    
    xhr.ontimeout = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Excel download timed out. Try selecting fewer cards.', false);
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
 * Poll interval for checking async export status (ms).
 */
var _POLL_INTERVAL = 2000;

function downloadPdf(cardIds, templateId, fontMode, shortenTitles) {
    templateId = templateId || '';
    fontMode = fontMode || 'auto';
    shortenTitles = !!shortenTitles;
    
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }

    // Determine card count for async decision
    // If cardIds is empty, it means "all cards" — use async to be safe
    var totalCards = (window.IDCardApp && window.IDCardApp.lazyLoadState)
        ? (window.IDCardApp.lazyLoadState.totalCount || 0)
        : 0;
    var effectiveCount = (cardIds && cardIds.length > 0) ? cardIds.length : totalCards;

    // Use async export for large datasets to avoid Cloudflare timeout
    if (effectiveCount >= _ASYNC_PDF_THRESHOLD) {
        _downloadPdfAsync(tableId, cardIds, templateId, fontMode, shortenTitles);
        return;
    }

    // Use DownloadManager if available (small exports)
    if (window.DownloadManager) {
        window.DownloadManager.start({
            name: 'PDF Document',
            url: `/panel/api/table/${tableId}/cards/download-pdf/`,
            body: Object.assign({ card_ids: cardIds, status: _getCurrentStatus(), template_id: templateId || '', font_mode: fontMode, shorten_titles: shortenTitles }, _getActiveFilters()),
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

    // Legacy fallback for small exports
    _downloadPdfLegacy(tableId, cardIds, templateId, fontMode, shortenTitles);
}

/**
 * Async PDF export: starts background generation + polls for completion.
 * Used for large datasets (500+ cards) to avoid Cloudflare's ~100s timeout.
 */
function _downloadPdfAsync(tableId, cardIds, templateId, fontMode, shortenTitles) {
    if (typeof showProgressToast === 'function') {
        showProgressToast('Starting PDF generation...', 5);
    }

    var body = Object.assign({
        card_ids: cardIds,
        status: _getCurrentStatus(),
        template_id: templateId || '',
        font_mode: fontMode || 'auto',
        shorten_titles: !!shortenTitles
    }, _getActiveFilters());

    // Start async export
    if (typeof apiCall === 'function') {
        apiCall('/panel/api/table/' + tableId + '/cards/download-pdf-async/', 'POST', body, { timeout: 30000 })
            .then(function(data) {
                if (!data.success) {
                    if (typeof hideProgressToast === 'function') hideProgressToast();
                    if (typeof showToast === 'function') showToast(data.message || 'Failed to start PDF export', false);
                    return;
                }
                // Start polling for completion
                _pollExportStatus(data.task_id, data.card_count || 0);
            })
            .catch(function(err) {
                if (typeof hideProgressToast === 'function') hideProgressToast();
                if (typeof showToast === 'function') showToast('Failed to start PDF export. Please try again.', false);
                console.error('Async PDF start error:', err);
            });
    } else {
        // Fallback: use fetch
        fetch('/panel/api/table/' + tableId + '/cards/download-pdf-async/', {
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
                return;
            }
            _pollExportStatus(data.task_id, data.card_count || 0);
        })
        .catch(function(err) {
            if (typeof hideProgressToast === 'function') hideProgressToast();
            if (typeof showToast === 'function') showToast('Failed to start PDF export. Please try again.', false);
            console.error('Async PDF start error:', err);
        });
    }
}

/**
 * Poll the export status endpoint until the PDF is ready or fails.
 */
function _pollExportStatus(taskId, cardCount) {
    var pollCount = 0;
    var maxPolls = 300; // 300 * 2s = 10 minutes max

    function poll() {
        pollCount++;
        if (pollCount > maxPolls) {
            if (typeof hideProgressToast === 'function') hideProgressToast();
            if (typeof showToast === 'function') showToast('PDF generation timed out. Please try again with fewer cards.', false);
            return;
        }

        fetch('/panel/api/export/status/' + taskId + '/', {
            headers: {
                'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : ''
            }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                if (typeof hideProgressToast === 'function') hideProgressToast();
                if (typeof showToast === 'function') showToast(data.message || 'Export task not found', false);
                return;
            }

            if (data.state === 'completed') {
                if (typeof showProgressToast === 'function') {
                    showProgressToast('PDF ready! Starting download...', 100);
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
                        showDownloadComplete('PDF file downloaded successfully!');
                    }
                }, 500);
            } else if (data.state === 'failed') {
                if (typeof hideProgressToast === 'function') hideProgressToast();
                if (typeof showToast === 'function') showToast(data.message || 'PDF generation failed', false);
            } else {
                // Still processing — show progress and poll again
                var msg = data.message || ('Generating PDF' + (cardCount ? ' (' + cardCount + ' cards)' : '') + '...');
                if (typeof showProgressToast === 'function') {
                    showProgressToast(msg, data.progress || -1);
                }
                setTimeout(poll, _POLL_INTERVAL);
            }
        })
        .catch(function(err) {
            console.error('Export status poll error:', err);
            // Retry on network error (server might be busy)
            setTimeout(poll, _POLL_INTERVAL * 2);
        });
    }

    // Start polling after a short delay (give server time to start)
    setTimeout(poll, 1000);
}

/**
 * Legacy synchronous PDF download (for small exports without DownloadManager).
 */
function _downloadPdfLegacy(tableId, cardIds, templateId, fontMode, shortenTitles) {
    if (typeof showProgressToast === 'function') showProgressToast('Preparing PDF file...', -1);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/panel/api/table/${tableId}/cards/download-pdf/`, true);
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
            };
            reader.readAsText(xhr.response);
        }
    };
    
    xhr.onerror = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('Failed to download PDF file', false);
    };
    
    xhr.ontimeout = function() {
        if (typeof hideProgressToast === 'function') hideProgressToast();
        if (typeof showToast === 'function') showToast('PDF download timed out. Try selecting fewer cards.', false);
    };
    
    xhr.send(JSON.stringify(Object.assign({ card_ids: cardIds, status: _getCurrentStatus(), template_id: templateId || '', font_mode: fontMode || 'auto', shorten_titles: !!shortenTitles }, _getActiveFilters())));
}

/**
 * Extract filename from Content-Disposition header, or use fallback.
 * (Legacy helper — used only by fallback XHR paths)
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
