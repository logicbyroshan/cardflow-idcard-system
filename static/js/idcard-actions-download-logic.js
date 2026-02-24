// ID Card Actions - Download Logic Sub-module
// Core download functions: Images, DOCX, XLSX, PDF, and status management
// Part of IDCardApp module system — registers functions on window.IDCardApp

(function() {
'use strict';

// ==========================================
// INTERNAL HELPERS
// ==========================================

/**
 * Extract filename from Content-Disposition header, or use fallback.
 */
function _getDownloadFilename(xhr, fallbackExt) {
    const disposition = xhr.getResponseHeader('Content-Disposition');
    if (disposition) {
        // Try filename*= (RFC 5987) first, then filename=
        let match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i);
        if (match && match[1]) return decodeURIComponent(match[1]);
    }
    // Fallback: ClientName_TableName_Status.ext (from globals)
    const clientName = (typeof CLIENT_NAME !== 'undefined' ? CLIENT_NAME : '').replace(/\s+/g, '');
    const tableName = (typeof TABLE_NAME !== 'undefined' ? TABLE_NAME : '').replace(/\s+/g, '');
    const status = (typeof CURRENT_STATUS !== 'undefined' ? CURRENT_STATUS : 'pending');
    const statusCap = status.charAt(0).toUpperCase() + status.slice(1);
    const parts = [clientName, tableName, statusCap].filter(Boolean);
    return (parts.length ? parts.join('_') : 'export') + '.' + fallbackExt;
}

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
        })
        .then(function(data) {
            if (data.success === false) {
                // Permission denied or validation error — silently log, don't interrupt UX
                console.warn('Move to download skipped:', data.message);
                return;
            }
            var count = data.updated_count || cardIds.length;
            if (typeof showToast === 'function') showToast(data.message || count + ' card(s) moved to Download list', true);
            // Refresh table via HTMX (same pattern as refreshCardTable in api module)
            if (typeof htmx !== 'undefined' && document.getElementById('card-table-container')) {
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
// ==========================================

function downloadImages(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    
    // Note: If cardIds is empty, backend will fetch all cards for current status
    
    if (typeof showProgressToast === 'function') showProgressToast('Preparing images...', -1);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/panel/api/table/${tableId}/cards/download-images/`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
    
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                const response = JSON.parse(xhr.responseText);
                
                if (response.success && response.zip_files && response.zip_files.length > 0) {
                    // Download each ZIP file with a small delay between each
                    let downloadIndex = 0;
                    const totalZips = response.zip_files.length;
                    
                    function downloadNextZip() {
                        if (downloadIndex >= totalZips) {
                            if (typeof showDownloadComplete === 'function') {
                                showDownloadComplete(`Downloaded ${totalZips} ZIP file(s) with ${response.total_images} images!`);
                            }
                            // Image export: do NOT move cards to download list
                            return;
                        }
                        
                        const zipInfo = response.zip_files[downloadIndex];
                        
                        // Convert base64 to blob via fetch (non-blocking, avoids byte-by-byte loop)
                        fetch('data:application/zip;base64,' + zipInfo.data)
                        .then(function(r) { return r.blob(); })
                        .then(function(blob) {
                            // Create download link
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
                            
                            // Update progress
                            if (typeof showProgressToast === 'function') {
                                showProgressToast(`Downloading ${downloadIndex}/${totalZips} ZIPs...`, Math.round((downloadIndex / totalZips) * 100));
                            }
                            
                            // Download next ZIP after a small delay (to allow browser to process)
                            setTimeout(downloadNextZip, 300);
                        }).catch(function(err) {
                            console.error('ZIP download failed:', err);
                            if (typeof showToast === 'function') showToast('Failed to download ZIP file', false);
                        });
                    }
                    
                    // Start downloading
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
    
    xhr.send(JSON.stringify(Object.assign({ card_ids: cardIds, status: _getCurrentStatus() }, _getActiveFilters())));
}

// ==========================================
// DOWNLOAD DOCX
// ==========================================

function downloadDocx(cardIds, format, templateId) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    
    // Note: If cardIds is empty, backend will fetch all cards for current status
    
    // Close modals via DOM (modal state functions are in UI sub-module)
    var _docFormatOverlay = document.getElementById('docFormatModalOverlay');
    if (_docFormatOverlay) { _docFormatOverlay.classList.remove('active'); document.body.style.overflow = ''; }
    var _docxModal = document.getElementById('downloadDocxModal');
    if (_docxModal) _docxModal.style.display = 'none';
    
    if (typeof showProgressToast === 'function') showProgressToast(`Preparing ${format.toUpperCase()} document...`, -1);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/panel/api/table/${tableId}/cards/download-docx/`, true);
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
            // Move exported cards from approved → download
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
    
    xhr.send(JSON.stringify(Object.assign({ card_ids: cardIds, format: format, template_id: templateId || '', status: _getCurrentStatus() }, _getActiveFilters())));
}

// ==========================================
// DOWNLOAD XLSX
// ==========================================

function downloadXlsx(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    
    // Note: If cardIds is empty, backend will fetch all cards for current status
    
    if (typeof showProgressToast === 'function') showProgressToast('Preparing Excel file...', -1);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/panel/api/table/${tableId}/cards/download-xlsx/`, true);
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
            // Move exported cards from approved → download
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
    
    xhr.send(JSON.stringify(Object.assign({ card_ids: cardIds, status: _getCurrentStatus() }, _getActiveFilters())));
}

// ==========================================
// DOWNLOAD PDF
// ==========================================

function downloadPdf(cardIds, templateId) {
    templateId = templateId || '';
    
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : (window.IDCardApp?.tableId || null);
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    
    // Note: If cardIds is empty, backend will fetch all cards for current status
    
    if (typeof showProgressToast === 'function') showProgressToast('Preparing PDF file...', -1);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/panel/api/table/${tableId}/cards/download-pdf/`, true);
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
            // PDF export: do NOT move cards to download list
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
    
    xhr.send(JSON.stringify(Object.assign({ card_ids: cardIds, status: _getCurrentStatus(), template_id: templateId || '' }, _getActiveFilters())));
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
