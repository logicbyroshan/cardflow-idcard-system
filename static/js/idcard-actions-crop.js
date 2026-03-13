/**
 * IDCard Actions  Crop Selected Images Module
 *
 * Orchestrates the "Crop Selected" workflow:
 *   1. Prepare   copies card images to a temp batch folder
 *   2. Process   sends the batch to the Face Cropper engine
 *   3. Preview   shows cropped / failed / original grids
 *   4. Reupload  pushes cropped images back to the cards
 *
 * Depends on: IDCardApp (global namespace), apiCall(), showToast()
 */
;(function () {
    'use strict';

    //  Constants 
    const TABLE_ID_FN = () =>
        typeof TABLE_ID !== 'undefined'
            ? TABLE_ID
            : window.IDCardApp?.tableId || null;

    //  State 
    let _batchId = null;
    let _currentTab = 'cropped';
    let _pendingIds = [];    // card IDs waiting for user to confirm
    let _pendingTableId = null;
    let _confirmCode = '';   // 4-digit code shown in Step 0

    //  DOM references (cached on first use) 
    const $ = (id) => document.getElementById(id);

    function _overlay()   { return $('cropModalOverlay'); }
    function _step(n)     { return $(`cropStep${n}`); }

    //  Show / hide helpers 
    function _show(el)  { if (el) el.style.display = ''; }
    function _hide(el)  { if (el) el.style.display = 'none'; }

    function _showOnly(stepNumber) {
        for (const n of [0, 1, 2, 3, 'Error', 'Done']) _hide(_step(n));
        _show(_step(stepNumber));
    }

    function _openModal() {
        const overlay = _overlay();
        if (overlay) {
            overlay.style.display = '';
            document.body.style.overflow = 'hidden';
        }
    }

    function _closeModal() {
        const overlay = _overlay();
        if (overlay) {
            overlay.style.display = 'none';
            document.body.style.overflow = '';
        }
        // Cleanup batch if not yet reuploaded
        if (_batchId) {
            _cleanupBatch(_batchId);
            _batchId = null;
        }
    }

    //  API helpers 
    function _post(url, body) {
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': _getCSRF(),
            },
            body: JSON.stringify(body),
        }).then((r) => {
            if (!r.ok) return r.json().then((d) => Promise.reject(d));
            return r.json();
        });
    }

    function _get(url) {
        return fetch(url).then((r) => {
            if (!r.ok) return r.json().then((d) => Promise.reject(d));
            return r.json();
        });
    }

    function _getCSRF() {
        const cookie = document.cookie.match(/csrftoken=([^;]+)/);
        return cookie ? cookie[1] : '';
    }

    function _cleanupBatch(batchId) {
        // Fire-and-forget cleanup
        _post(`/api/crop-batch/${batchId}/cleanup/`, {}).catch(() => {});
    }

    //  Main flow 

    /**
     * Entry point  called when "Crop Selected" button is clicked.
     * Shows Step 0 (path input) first; the user clicks Start Crop to proceed.
     */
    function startCropFlow() {
        // Get selected card IDs
        const ids = window.IDCardApp?.getSelectedCardIds
            ? window.IDCardApp.getSelectedCardIds()
            : [];

        if (ids.length === 0) {
            if (typeof showToast === 'function')
                showToast('Please select at least one card to crop', false);
            return;
        }

        const tableId = TABLE_ID_FN();
        if (!tableId) {
            if (typeof showToast === 'function')
                showToast('Error: Table ID not found', false);
            return;
        }

        // Save for when user clicks Start Crop
        _pendingIds = ids;
        _pendingTableId = tableId;
        _batchId = null;

        // Generate 10-digit confirmation code
        _confirmCode = (typeof ConfirmationCode !== 'undefined') ? ConfirmationCode.generate() : String(Math.floor(1000000000 + Math.random() * 9000000000));
        const codeDisplay = $('cropConfirmCodeDisplay');
        if (codeDisplay) codeDisplay.textContent = _confirmCode;

        // Set selected count text
        const countText = $('cropSelectedCountText');
        if (countText) countText.textContent = ids.length + ' card' + (ids.length !== 1 ? 's' : '');

        // Reset input & error
        const codeInput = $('cropConfirmCodeInput');
        if (codeInput) { codeInput.value = ''; setTimeout(() => codeInput.focus(), 100); }
        const codeError = $('cropConfirmCodeError');
        if (codeError) codeError.style.display = 'none';

        // Show modal on Step 0
        _openModal();
        _showOnly(0);
        _show($('cropStartBtn'));
        _hide($('cropReuploadBtn'));
        _hide($('cropDoneCloseBtn'));
    }

    /**
     * Called when user clicks "Start Crop" after entering the confirmation code.
     * Validates code then kicks off the prepare  process  preview flow.
     */
    function _startWithConfirmCode() {
        const codeInput = $('cropConfirmCodeInput');
        const entered = codeInput ? codeInput.value.trim() : '';
        const codeError = $('cropConfirmCodeError');

        if (entered !== _confirmCode) {
            if (codeError) codeError.style.display = '';
            if (codeInput) codeInput.select();
            return;
        }

        if (codeError) codeError.style.display = 'none';

        const ids = _pendingIds;
        const tableId = _pendingTableId;

        // Hide Start, show Cancel; move to preparing step
        _hide($('cropStartBtn'));
        _showOnly(1);

        // Update status
        const status1 = $('cropStatus1');
        const progress1 = $('cropProgress1');
        if (status1) status1.textContent = `Preparing ${ids.length} card(s)`;
        if (progress1) progress1.style.width = '20%';

        // No output_path  backend auto-creates a temp folder inside MEDIA_ROOT
        _post(`/api/table/${tableId}/cards/prepare-crop/`, { card_ids: ids })
            .then((data) => {
                if (!data.success) {
                    _showError(data.message || 'Failed to prepare images');
                    return;
                }

                _batchId = data.batch_id;
                if (progress1) progress1.style.width = '100%';
                if (status1) status1.textContent =
                    `${data.images_copied} image(s) copied, ${data.skipped} skipped`;

                setTimeout(() => _processStep(tableId), 600);
            })
            .catch((err) => {
                _showError(err.message || 'Failed to prepare images');
            });
    }

    /**
     * Step 2  Send batch to engine for cropping.
     */
    function _processStep(tableId) {
        _showOnly(2);
        const status2 = $('cropStatus2');
        if (status2) status2.textContent = 'Sending to Face Cropper engine';

        _post(`/api/table/${tableId}/cards/process-crop/`, {
            batch_id: _batchId,
        })
            .then((data) => {
                if (!data.success) {
                    _showError(data.message || 'Engine processing failed');
                    return;
                }

                if (status2) status2.textContent = 'Processing complete!';

                // Fetch preview
                setTimeout(() => _previewStep(), 400);
            })
            .catch((err) => {
                _showError(
                    err.message ||
                        'Cannot connect to Face Cropper engine. Is it running?'
                );
            });
    }

    /**
     * Step 3  Load preview of cropped / failed / original images.
     */
    function _previewStep() {
        _showOnly(3);
        _show($('cropReuploadBtn'));

        _get(`/api/crop-batch/${_batchId}/preview/`)
            .then((data) => {
                if (!data.success) {
                    _showError(data.message || 'Failed to load preview');
                    return;
                }

                // Update stats
                const cropped = data.cropped || [];
                const failed = data.failed || [];
                const original = data.original || [];

                const sc = $('cropSuccessCount');
                const fc = $('cropFailCount');
                const tc = $('cropTotalCount');
                if (sc) sc.textContent = cropped.length;
                if (fc) fc.textContent = failed.length;
                if (tc) tc.textContent = original.length;

                // Render grids
                _renderGrid('cropGridCropped', cropped, 'cropped');
                _renderGrid('cropGridFailed', failed, 'failed');
                _renderGrid('cropGridOriginal', original, 'original');

                // Show folder path
                if (data.cropped_folder) {
                    const pathEl = $('cropFolderPath');
                    const pathText = $('cropFolderPathText');
                    if (pathEl && pathText) {
                        pathText.textContent = data.cropped_folder;
                        _show(pathEl);
                    }
                }

                // Default tab
                _switchTab('cropped');

                // If no cropped images, hide reupload btn
                if (cropped.length === 0) {
                    _hide($('cropReuploadBtn'));
                }
            })
            .catch((err) => {
                _showError(err.message || 'Failed to load preview');
            });
    }

    /**
     * Render an image grid.
     */
    function _renderGrid(containerId, files, type) {
        const container = $(containerId);
        if (!container) return;
        container.innerHTML = '';

        if (files.length === 0) return;

        files.forEach((filename) => {
            const card = document.createElement('div');
            card.className = 'crop-image-card';
            const imgUrl = `/api/crop-batch/${_batchId}/serve-image/?type=${type}&name=${encodeURIComponent(filename)}`;
            card.innerHTML = `
                <img src="${imgUrl}" alt="${filename}" loading="lazy" />
                <div class="crop-image-name" title="${filename}">${_prettyName(filename)}</div>
            `;
            // Click to zoom
            card.addEventListener('click', () => _zoomImage(imgUrl));
            container.appendChild(card);
        });
    }

    /**
     * Pretty-print filename: strip the ___FIELD part and extension.
     */
    function _prettyName(filename) {
        // Format: {card_id}___{FIELD}.ext
        const noExt = filename.replace(/\.[^.]+$/, '');
        const parts = noExt.split('___');
        if (parts.length === 2) return `#${parts[0]}  ${parts[1]}`;
        return filename;
    }

    /**
     * Zoom image in a fullscreen overlay.
     */
    function _zoomImage(url) {
        const overlay = document.createElement('div');
        overlay.className = 'crop-zoom-overlay';
        overlay.innerHTML = `<img src="${url}" alt="Zoomed" />`;
        overlay.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
    }

    /**
     * Switch between cropped / failed / original tabs.
     */
    function _switchTab(tab) {
        _currentTab = tab;

        // Update tab buttons
        document.querySelectorAll('.crop-tab').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // Show/hide grids
        const grids = {
            cropped: $('cropGridCropped'),
            failed: $('cropGridFailed'),
            original: $('cropGridOriginal'),
        };
        const emptyMsg = $('cropEmptyMsg');

        for (const [key, grid] of Object.entries(grids)) {
            if (key === tab) {
                _show(grid);
                // Show empty message if grid is empty
                if (grid && grid.children.length === 0) {
                    _show(emptyMsg);
                } else {
                    _hide(emptyMsg);
                }
            } else {
                _hide(grid);
            }
        }
    }

    /**
     * Step 4  Re-upload cropped images back to cards.
     */
    function _reuploadCropped() {
        const tableId = TABLE_ID_FN();
        if (!tableId || !_batchId) return;

        const btn = $('cropReuploadBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Re-uploading';
        }

        _post(`/api/table/${tableId}/cards/reupload-cropped/`, {
            batch_id: _batchId,
            use_edited: false,
        })
            .then((data) => {
                if (!data.success) {
                    _showError(data.message || 'Re-upload failed');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML =
                            '<i class="fa-solid fa-upload"></i> Re-upload to Pending';
                    }
                    return;
                }

                // Success  batch is already cleaned up by the service
                _batchId = null; // prevent double cleanup on close

                _showOnly('Done');
                _hide($('cropReuploadBtn'));
                _hide($('cropCancelBtn'));
                _show($('cropDoneCloseBtn'));

                const doneMsg = $('cropDoneMsg');
                if (doneMsg) {
                    let msg = `${data.updated_count} card image(s) updated.`;
                    if (data.error_count > 0) {
                        msg += ` ${data.error_count} error(s).`;
                    }
                    doneMsg.textContent = msg;
                }

                // Refresh the table
                if (typeof IDCardApp !== 'undefined' && IDCardApp.refreshCardTable) {
                    IDCardApp.refreshCardTable();
                }

                if (typeof showToast === 'function') {
                    showToast(
                        `${data.updated_count} cropped image(s) re-uploaded successfully`,
                        true
                    );
                }
            })
            .catch((err) => {
                _showError(err.message || 'Re-upload failed');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML =
                        '<i class="fa-solid fa-upload"></i> Re-upload to Pending';
                }
            });
    }

    /**
     * Show error step.
     */
    function _showError(msg) {
        _showOnly('Error');
        const el = $('cropErrorMsg');
        if (el) el.textContent = msg;
    }

    //  Event listeners 

    function initCropModule() {
        // Crop Selected button in action bar
        const cropBtn = $('cropSelectedBtn');
        if (cropBtn) {
            cropBtn.addEventListener('click', startCropFlow);
        }

        // Start Crop button (Step 0)
        $('cropStartBtn')?.addEventListener('click', _startWithConfirmCode);

        // Allow Enter key in confirmation input to trigger Start Crop
        const codeInput = $('cropConfirmCodeInput');
        if (codeInput) {
            codeInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); _startWithConfirmCode(); }
            });
        }

        // Modal close / cancel
        $('cropModalCloseBtn')?.addEventListener('click', _closeModal);
        $('cropCancelBtn')?.addEventListener('click', _closeModal);
        $('cropDoneCloseBtn')?.addEventListener('click', () => {
            _batchId = null; // already cleaned up
            _closeModal();
        });

        // Re-upload button
        $('cropReuploadBtn')?.addEventListener('click', _reuploadCropped);

        // Retry button
        $('cropRetryBtn')?.addEventListener('click', () => {
            _closeModal();
            // Re-trigger with same selection
            setTimeout(startCropFlow, 200);
        });

        // Tab switching
        document.querySelectorAll('.crop-tab').forEach((btn) => {
            btn.addEventListener('click', () => _switchTab(btn.dataset.tab));
        });

        // ESC to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Close zoom overlay first if open
                const zoom = document.querySelector('.crop-zoom-overlay');
                if (zoom) {
                    zoom.remove();
                    return;
                }
                // Then close modal
                if (_overlay()?.style.display !== 'none') {
                    _closeModal();
                }
            }
        });
    }

    //  Enable/disable crop button based on selection 
    function _updateCropButtonState() {
        const cropBtn = $('cropSelectedBtn');
        if (!cropBtn) return;

        const ids = window.IDCardApp?.getSelectedCardIds
            ? window.IDCardApp.getSelectedCardIds()
            : [];
        cropBtn.disabled = ids.length === 0;
    }

    // Listen for selection changes (IDCardApp fires custom event)
    document.addEventListener('idcard-selection-changed', _updateCropButtonState);
    // Also poll periodically as fallback
    setInterval(_updateCropButtonState, 500);

    //  Exports 
    IDCardApp.initCropModule = initCropModule;
    IDCardApp.startCropFlow = startCropFlow;
})();
