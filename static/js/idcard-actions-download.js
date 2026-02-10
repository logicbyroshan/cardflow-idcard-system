// ID Card Actions - Download Module
// Contains: Download images, DOCX, XLSX, reupload images

// ==========================================
// DOWNLOAD IMAGES (Separate ZIP per image column)
// ==========================================

function downloadImages(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    
    if (cardIds.length === 0) {
        if (typeof showToast === 'function') showToast('No cards selected!', false);
        return;
    }
    
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
                            return;
                        }
                        
                        const zipInfo = response.zip_files[downloadIndex];
                        
                        // Convert base64 to blob
                        const binaryString = atob(zipInfo.data);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        const blob = new Blob([bytes], { type: 'application/zip' });
                        
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
    
    xhr.send(JSON.stringify({ card_ids: cardIds }));
}

function initDownloadImagesHandlers() {
    const downloadImgBtnIds = ['downloadImgBtn', 'downloadImgBtnV', 'downloadImgBtnP', 'downloadImgBtnA', 'downloadImgBtnD'];
    
    downloadImgBtnIds.forEach(btnId => {
        document.getElementById(btnId)?.addEventListener('click', function() {
            const cardIds = typeof getCardIdsForAction === 'function' ? getCardIdsForAction() : [];
            if (cardIds.length > 0) {
                downloadImages(cardIds);
            } else {
                if (typeof showToast === 'function') showToast('No cards available to download!', false);
            }
        });
    });
}

// ==========================================
// DOWNLOAD DOCX
// ==========================================

let pendingDocxDownloadIds = [];

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

function downloadDocx(cardIds, format) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    
    if (cardIds.length === 0) {
        if (typeof showToast === 'function') showToast('No cards selected!', false);
        return;
    }
    
    closeDocFormatModal();
    
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
            
            const now = new Date();
            const timestamp = now.getFullYear().toString() + 
                             (now.getMonth() + 1).toString().padStart(2, '0') + 
                             now.getDate().toString().padStart(2, '0') + '_' +
                             now.getHours().toString().padStart(2, '0') + 
                             now.getMinutes().toString().padStart(2, '0') + 
                             now.getSeconds().toString().padStart(2, '0');
            a.download = `idcards_${timestamp}.${format}`;
            
            document.body.appendChild(a);
            a.click();
            
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            if (typeof showDownloadComplete === 'function') showDownloadComplete('Document downloaded successfully!');
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
    
    xhr.send(JSON.stringify({ card_ids: cardIds, format: format }));
}

function initDownloadDocxHandlers() {
    const docFormatModalOverlay = document.getElementById('docFormatModalOverlay');
    
    document.getElementById('closeDocFormatModal')?.addEventListener('click', closeDocFormatModal);
    document.getElementById('cancelDocFormatModal')?.addEventListener('click', closeDocFormatModal);
    
    if (docFormatModalOverlay) {
        docFormatModalOverlay.addEventListener('click', function(e) {
            if (e.target === this) closeDocFormatModal();
        });
    }
    
    document.querySelectorAll('.format-card').forEach(card => {
        card.addEventListener('click', function() {
            const format = this.getAttribute('data-format');
            if (format && pendingDocxDownloadIds.length > 0) {
                downloadDocx(pendingDocxDownloadIds, format);
            }
        });
    });
    
    const downloadDocxBtnIds = ['downloadDocxBtn', 'downloadDocxBtnV', 'downloadDocxBtnP', 'downloadDocxBtnA', 'downloadDocxBtnD'];
    
    downloadDocxBtnIds.forEach(btnId => {
        document.getElementById(btnId)?.addEventListener('click', function() {
            const cardIds = typeof getCardIdsForAction === 'function' ? getCardIdsForAction() : [];
            if (cardIds.length > 0) {
                openDocFormatModal(cardIds);
            } else {
                if (typeof showToast === 'function') showToast('No cards available to download!', false);
            }
        });
    });
}

// ==========================================
// DOWNLOAD XLSX
// ==========================================

function downloadXlsx(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    
    if (cardIds.length === 0) {
        if (typeof showToast === 'function') showToast('No cards to download!', false);
        return;
    }
    
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
            
            const now = new Date();
            const timestamp = now.getFullYear().toString() + 
                             (now.getMonth() + 1).toString().padStart(2, '0') + 
                             now.getDate().toString().padStart(2, '0') + '_' +
                             now.getHours().toString().padStart(2, '0') + 
                             now.getMinutes().toString().padStart(2, '0') + 
                             now.getSeconds().toString().padStart(2, '0');
            a.download = `idcards_${timestamp}.xlsx`;
            
            document.body.appendChild(a);
            a.click();
            
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            if (typeof showDownloadComplete === 'function') showDownloadComplete('Excel file downloaded successfully!');
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
    
    xhr.send(JSON.stringify({ card_ids: cardIds }));
}

function initDownloadXlsxHandlers() {
    const downloadXlsxBtnIds = ['downloadXlsxBtn', 'downloadXlsxBtnV', 'downloadXlsxBtnP', 'downloadXlsxBtnA', 'downloadXlsxBtnD'];
    
    downloadXlsxBtnIds.forEach(btnId => {
        document.getElementById(btnId)?.addEventListener('click', function() {
            const cardIds = typeof getCardIdsForAction === 'function' ? getCardIdsForAction() : [];
            if (cardIds.length > 0) {
                downloadXlsx(cardIds);
            } else {
                if (typeof showToast === 'function') showToast('No cards available to download!', false);
            }
        });
    });
}

// ==========================================
// DOWNLOAD PDF
// ==========================================

function downloadPdf(cardIds) {
    const tableId = typeof TABLE_ID !== 'undefined' ? TABLE_ID : null;
    if (!tableId) {
        if (typeof showToast === 'function') showToast('Error: Table ID not found', false);
        return;
    }
    
    if (cardIds.length === 0) {
        if (typeof showToast === 'function') showToast('No cards selected!', false);
        return;
    }
    
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
            
            const now = new Date();
            const timestamp = now.getFullYear().toString() + 
                             (now.getMonth() + 1).toString().padStart(2, '0') + 
                             now.getDate().toString().padStart(2, '0') + '_' +
                             now.getHours().toString().padStart(2, '0') + 
                             now.getMinutes().toString().padStart(2, '0') + 
                             now.getSeconds().toString().padStart(2, '0');
            a.download = `idcards_${timestamp}.pdf`;
            
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
    
    xhr.send(JSON.stringify({ card_ids: cardIds }));
}

function initDownloadPdfHandlers() {
    const downloadPdfBtnIds = ['downloadPdfBtn', 'downloadPdfBtnV', 'downloadPdfBtnP', 'downloadPdfBtnA', 'downloadPdfBtnD'];
    
    downloadPdfBtnIds.forEach(btnId => {
        document.getElementById(btnId)?.addEventListener('click', function() {
            const cardIds = typeof getCardIdsForAction === 'function' ? getCardIdsForAction() : [];
            if (cardIds.length > 0) {
                downloadPdf(cardIds);
            } else {
                if (typeof showToast === 'function') showToast('No cards available to download!', false);
            }
        });
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
    // Collect card IDs fresh if not already set
    if (pendingReuploadCardIds.length === 0 && typeof getCardIdsForAction === 'function') {
        pendingReuploadCardIds = getCardIdsForAction();
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
                            window.location.reload();
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
            btn.addEventListener('click', function() {
                // Always open modal — card IDs collected inside openReuploadActionsModal
                pendingReuploadCardIds = typeof getCardIdsForAction === 'function' ? getCardIdsForAction() : [];
                openReuploadActionsModal();
            });
        }
    });
}

// ==========================================
// INITIALIZATION
// ==========================================

function initDownloadModule() {
    initDownloadImagesHandlers();
    initDownloadDocxHandlers();
    initDownloadXlsxHandlers();
    initDownloadPdfHandlers();
    initReuploadHandlers();
}

// Expose globally
window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.initDownloadModule = initDownloadModule;
window.IDCardApp.downloadImages = downloadImages;
window.IDCardApp.downloadDocx = downloadDocx;
window.IDCardApp.downloadXlsx = downloadXlsx;
window.IDCardApp.downloadPdf = downloadPdf;
window.IDCardApp.reuploadImages = reuploadImages;
