// ID Card Actions - Download Modals Sub-module
// Individual modal open/close handlers (images, docx, xlsx, pdf)
// Part of IDCardApp module system — registers functions on window.IDCardApp

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

// ==========================================
// DOWNLOAD MODAL STATE
// ==========================================

let pendingDownloadCardIds = [];
let currentDownloadType = null; // 'pdf', 'xlsx', 'img'

// Modal DOM references (set in initDownloadModals)
let downloadPdfModal = null;
let downloadXlsxModal = null;
let downloadImgModal = null;

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

    downloadImgModal.style.display = 'flex';
}

function closeDownloadImgModal() {
    if (downloadImgModal) {
        downloadImgModal.style.display = 'none';
    }
    pendingDownloadCardIds = [];
    currentDownloadType = null;
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
    document.getElementById('downloadImgConfirm')?.addEventListener('click', function() {
        closeDownloadImgModal();
        window.IDCardApp.downloadImages(pendingDownloadCardIds);
    });

    // Close on backdrop click
    downloadImgModal = document.getElementById('downloadImgModal');
    if (downloadImgModal) {
        downloadImgModal.addEventListener('click', function(e) {
            if (e.target === downloadImgModal) closeDownloadImgModal();
        });
    }
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
        // Disabled — prevent accidental closure on outside click
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
    document.getElementById('downloadDocxConfirm')?.addEventListener('click', function() {
        const templateSelect = document.getElementById('downloadDocxTemplate');
        const templateId = templateSelect ? templateSelect.value : '';
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

    if (listNameEl) listNameEl.textContent = _getStatusLabel() + ' List';
    // Show "All" if no specific cards selected, otherwise show the count
    if (cardCountEl) cardCountEl.textContent = cardIds.length > 0 ? cardIds.length : 'All';

    downloadXlsxModal.style.display = 'flex';
}

function closeDownloadXlsxModal() {
    if (downloadXlsxModal) {
        downloadXlsxModal.style.display = 'none';
    }
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
    document.getElementById('downloadXlsxConfirm')?.addEventListener('click', function() {
        closeDownloadXlsxModal();
        window.IDCardApp.downloadXlsx(pendingDownloadCardIds);
    });

    // Close on backdrop click
    downloadXlsxModal = document.getElementById('downloadXlsxModal');
    if (downloadXlsxModal) {
        downloadXlsxModal.addEventListener('click', function(e) {
            if (e.target === downloadXlsxModal) closeDownloadXlsxModal();
        });
    }
}

// ==========================================
// DOWNLOAD PDF MODAL (with template selection)
// ==========================================

let pendingPdfCardIds = [];
let selectedPdfTemplate = 'default';

function openDownloadPdfModal(cardIds) {
    pendingPdfCardIds = cardIds;
    downloadPdfModal = document.getElementById('downloadPdfModal');

    if (!downloadPdfModal) {
        // Fallback: download directly if modal not found
        window.IDCardApp.downloadPdf(cardIds, '');
        return;
    }

    const listNameEl = document.getElementById('downloadPdfListName');
    const cardCountEl = document.getElementById('downloadPdfCardCount');

    if (listNameEl) listNameEl.textContent = _getStatusLabel() + ' List';
    // Show "All" if no specific cards selected, otherwise show the count
    if (cardCountEl) cardCountEl.textContent = cardIds.length > 0 ? cardIds.length : 'All';

    // Load templates dynamically (from init sub-module)
    if (window.IDCardApp._loadExportTemplates) window.IDCardApp._loadExportTemplates(false);

    downloadPdfModal.style.display = 'flex';
}

function closeDownloadPdfModal() {
    if (downloadPdfModal) {
        downloadPdfModal.style.display = 'none';
    }
    pendingPdfCardIds = [];
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
    document.getElementById('downloadPdfConfirm')?.addEventListener('click', function() {
        const templateSelect = document.getElementById('downloadPdfTemplate');
        const templateId = templateSelect ? templateSelect.value : '';
        closeDownloadPdfModal();
        window.IDCardApp.downloadPdf(pendingPdfCardIds, templateId);
    });

    // Close on backdrop click
    downloadPdfModal = document.getElementById('downloadPdfModal');
    if (downloadPdfModal) {
        downloadPdfModal.addEventListener('click', function(e) {
            if (e.target === downloadPdfModal) closeDownloadPdfModal();
        });
    }
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
