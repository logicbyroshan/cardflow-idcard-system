// Dashboard Page  Bulk actions, API calls, modals, data loading
// Split from dashboard.js  see also dashboard-ui.js

window.DashboardPage = window.DashboardPage || {};

document.addEventListener('DOMContentLoaded', function() {

    // ====================
    // Load Recent Client Updates
    // ====================
    function loadRecentClientUpdates() {
        const tbody = document.getElementById('recentClientUpdatesBody');
        if (!tbody) return;
        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        
        ApiClient.get('/api/recent-client-updates/')
            .then(data => {
                if (data.success && data.clients.length > 0) {
                    tbody.innerHTML = data.clients.map((client, i) => {
                        const tables = client.tables || [];
                        const inactiveBadge = client.status && client.status !== 'active'
                            ? ` <span class="count-badge" style="background:#fee2e2;color:#dc2626;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px;">${esc(client.status)}</span>`
                            : '';
                        // Build sub-rows for each table (same column structure)
                        const tableSubRows = tables.map(t => `
                            <tr class="client-sub-row expand-group-${i}" style="display:none">
                                <td>
                                    <a href="/table/${t.id}/cards/" class="sub-row-name"><i class="fa-solid fa-table"></i> ${esc(t.name)}</a>
                                </td>
                                <td class="text-center">
                                    <a href="/table/${t.id}/cards/?status=pending" class="count-badge pending">${t.pending}</a>
                                </td>
                                <td class="text-center">
                                    <a href="/table/${t.id}/cards/?status=verified" class="count-badge verified">${t.verified}</a>
                                </td>
                                <td class="text-center">
                                    <a href="/table/${t.id}/cards/?status=approved" class="count-badge approved">${t.approved}</a>
                                </td>
                                <td class="text-center">
                                    <a href="/table/${t.id}/cards/?status=download" class="count-badge downloaded">${t.downloaded}</a>
                                </td>
                            </tr>
                        `).join('');

                        return `
                        <tr class="client-row" data-idx="${i}" onclick="toggleClientExpandRow(this)">
                            <td>
                                <a href="/client/${client.client_id}/groups/" class="client-name-link" onclick="event.stopPropagation()">${esc(client.name)}${inactiveBadge}</a>
                            </td>
                            <td class="text-center">
                                <span class="count-badge pending">${client.pending}</span>
                            </td>
                            <td class="text-center">
                                <span class="count-badge verified">${client.verified}</span>
                            </td>
                            <td class="text-center">
                                <span class="count-badge approved">${client.approved}</span>
                            </td>
                            <td class="text-center">
                                <span class="count-badge downloaded">${client.downloaded}</span>
                            </td>
                        </tr>
                        ${tableSubRows}
                    `}).join('');
                } else {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="5" class="text-center" style="padding: 40px; color: #888;">
                                <i class="fa-solid fa-users-slash"></i> No recent client updates
                            </td>
                        </tr>
                    `;
                }
            })
            .catch(error => {
                console.error('Error loading recent client updates:', error);
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" class="text-center" style="padding: 40px; color: #dc2626;">
                            <i class="fa-solid fa-exclamation-triangle"></i> Error loading data
                        </td>
                    </tr>
                `;
            });
    }
    
    // Load recent client updates on page load
    loadRecentClientUpdates();
    
    // ====================
    // Bulk Actions Panel - Cascading Dropdowns
    // ====================
    const bulkClientSelect = document.getElementById('bulkClientSelect');
    const bulkTableSelect = document.getElementById('bulkTableSelect');
    const bulkActionBtns = document.querySelectorAll('#bulkActionsButtons .bulk-action-btn');

    // Populate client dropdown with active clients
    async function loadBulkClients() {
        if (!bulkClientSelect) return;
        try {
            const data = await ApiClient.get('/api/clients/active/');
            if (data.success && data.clients) {
                data.clients.forEach(client => {
                    const opt = document.createElement('option');
                    opt.value = client.id;
                    opt.textContent = client.name;
                    bulkClientSelect.appendChild(opt);
                });
            }
        } catch (e) {
            console.error('Failed to load clients for bulk actions:', e);
        }
    }

    // When client changes, load tables
    if (bulkClientSelect) {
        bulkClientSelect.addEventListener('change', async function() {
            const clientId = this.value;
            
            // Reset table dropdown
            bulkTableSelect.innerHTML = '<option value="">Select Table</option>';
            bulkTableSelect.disabled = true;
            setBulkActionsEnabled(false);

            if (!clientId) return;

            try {
                const data = await ApiClient.get(`/api/group/${clientId}/tables/`);
                if (data.success && data.tables) {
                    data.tables.forEach(table => {
                        const opt = document.createElement('option');
                        opt.value = table.id;
                        opt.textContent = table.name;
                        bulkTableSelect.appendChild(opt);
                    });
                    bulkTableSelect.disabled = false;
                }
            } catch (e) {
                console.error('Failed to load tables:', e);
            }
        });
    }

    // When table changes, enable/disable action buttons
    if (bulkTableSelect) {
        bulkTableSelect.addEventListener('change', function() {
            setBulkActionsEnabled(!!this.value);
        });
    }

    function setBulkActionsEnabled(enabled) {
        bulkActionBtns.forEach(btn => {
            btn.disabled = !enabled;
        });
    }

    // Bulk action button click handlers
    bulkActionBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            if (this.disabled) return;
            const action = this.dataset.action;
            const tableId = bulkTableSelect.value;
            if (!tableId) return;

            if (action === 'delete-all') {
                dashOpenDeleteAllModal(tableId);
            } else if (action === 'download-all') {
                dashDownloadAll(tableId, this);
            } else if (action === 'upgrade') {
                dashOpenUpgradeAllModal(tableId);
            } else if (action === 'reupload') {
                dashOpenReuploadModal(tableId);
            } else {
                if (typeof showToast === 'function') {
                    showToast(`${action} action coming soon!`, 'info');
                }
            }
        });
    });

    // ====================
    // Delete All (Secure 6-digit code) on Dashboard
    // ====================
    let dashDeleteTableId = null;
    let dashDeleteExpectedCode = '';
    const dashDeleteModal = document.getElementById('dashDeleteAllModal');
    const dashDeleteCodeInput = document.getElementById('dashDeleteCodeInput');
    const dashDeleteConfirmBtn = document.getElementById('dashDeleteConfirm');
    const dashDeleteCancelBtn = document.getElementById('dashDeleteCancel');
    const dashDeleteCodeDisplay = document.getElementById('dashDeleteCode');
    const dashDeleteTableNameEl = document.getElementById('dashDeleteTableName');
    const dashDeleteCountEl = document.getElementById('dashDeleteCount');

    function dashOpenDeleteAllModal(tableId) {
        dashDeleteTableId = tableId;
        dashDeleteExpectedCode = '';
        if (dashDeleteCodeInput) dashDeleteCodeInput.value = '';
        if (dashDeleteConfirmBtn) { dashDeleteConfirmBtn.disabled = true; dashDeleteConfirmBtn.style.opacity = '0.5'; dashDeleteConfirmBtn.textContent = 'Delete All Cards'; }

        ApiClient.post(`/api/table/${tableId}/cards/generate-delete-code/`)
          .then(data => {
            if (data.success) {
              dashDeleteExpectedCode = data.code;
              if (dashDeleteCodeDisplay) dashDeleteCodeDisplay.textContent = data.code;
              if (dashDeleteTableNameEl) dashDeleteTableNameEl.textContent = data.table_name;
              if (dashDeleteCountEl) dashDeleteCountEl.textContent = data.total_cards;
              if (window.alpineOpenModal) window.alpineOpenModal('dashDelete');
              if (dashDeleteCodeInput) dashDeleteCodeInput.focus();
            } else {
              if (typeof showToast === 'function') showToast(data.message || 'Failed to generate code', 'error');
            }
          })
          .catch(() => { if (typeof showToast === 'function') showToast('Error generating confirmation code', 'error'); });
    }

    function dashCloseDeleteAllModal() {
        if (window.alpineCloseModal) window.alpineCloseModal();
        dashDeleteTableId = null;
        dashDeleteExpectedCode = '';
        if (dashDeleteCodeInput) dashDeleteCodeInput.value = '';
    }

    if (dashDeleteCodeInput) {
        dashDeleteCodeInput.addEventListener('input', function() {
            const match = this.value.trim() === dashDeleteExpectedCode;
            if (dashDeleteConfirmBtn) { dashDeleteConfirmBtn.disabled = !match; dashDeleteConfirmBtn.style.opacity = match ? '1' : '0.5'; }
        });
    }
    if (dashDeleteCancelBtn) dashDeleteCancelBtn.addEventListener('click', dashCloseDeleteAllModal);
    // Overlay click-to-close now handled by Alpine @click.self in template

    if (dashDeleteConfirmBtn) {
        dashDeleteConfirmBtn.addEventListener('click', function() {
            if (!dashDeleteTableId || dashDeleteConfirmBtn.disabled) return;
            dashDeleteConfirmBtn.disabled = true;
            dashDeleteConfirmBtn.textContent = 'Deleting...';

            ApiClient.post(`/api/table/${dashDeleteTableId}/cards/bulk-delete/`, { delete_all: true, confirmation_code: dashDeleteCodeInput.value.trim() })
            .then(data => {
                dashCloseDeleteAllModal();
                if (typeof showToast === 'function') showToast(data.message || (data.success ? 'Deleted!' : 'Failed'), data.success ? 'success' : 'error');
            })
            .catch(() => {
                dashCloseDeleteAllModal();
                if (typeof showToast === 'function') showToast('Error deleting cards', 'error');
            });
        });
    }

    // ====================
    // Download All on Dashboard
    // ====================
    function dashDownloadAll(tableId, btn) {
        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Preparing...</span>';

        ApiClient.post(`/api/table/${tableId}/cards/download-all/`)
        .then(data => {
            if (data.success && data.download_url) {
                // New streaming mode: single combined ZIP on disk
                if (typeof showToast === 'function') showToast(`Downloading ${data.filename || 'AllCards.zip'}...`, 'success');
                const a = document.createElement('a');
                a.href = data.download_url;
                a.download = data.filename || 'AllCards.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } else if (data.success && data.files && data.files.length > 0) {
                // Legacy base64 mode (backward compatibility)
                if (typeof showToast === 'function') showToast(`Downloading ${data.total_files} file(s)...`, 'success');
                data.files.forEach((file, i) => {
                    setTimeout(() => {
                        dashTriggerBase64Download(file.data, file.filename, file.type === 'xlsx'
                            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                            : 'application/zip');
                    }, i * 500);
                });
            } else {
                if (typeof showToast === 'function') showToast(data.message || 'No files to download', 'error');
            }
        })
        .catch(() => { if (typeof showToast === 'function') showToast('Error downloading files', 'error'); })
        .finally(() => { btn.disabled = false; btn.innerHTML = origHtml; });
    }

    function dashTriggerBase64Download(base64, filename, mimeType) {
        ApiClient.downloadBase64(base64, filename, mimeType);
    }

    // ====================
    // Upgrade All Classes (Secure 6-digit code) on Dashboard
    // ====================
    let dashUpgradeTableId = null;
    let dashUpgradeExpectedCode = '';
    const dashUpgradeModal = document.getElementById('dashUpgradeAllModal');
    const dashUpgradeCodeInput = document.getElementById('dashUpgradeCodeInput');
    const dashUpgradeConfirmBtn = document.getElementById('dashUpgradeConfirm');
    const dashUpgradeCancelBtn = document.getElementById('dashUpgradeCancel');
    const dashUpgradeCodeDisplay = document.getElementById('dashUpgradeCode');
    const dashUpgradeTableNameEl = document.getElementById('dashUpgradeTableName');
    const dashUpgradeCountEl = document.getElementById('dashUpgradeCount');

    function dashOpenUpgradeAllModal(tableId) {
        dashUpgradeTableId = tableId;
        dashUpgradeExpectedCode = '';
        if (dashUpgradeCodeInput) dashUpgradeCodeInput.value = '';
        if (dashUpgradeConfirmBtn) { dashUpgradeConfirmBtn.disabled = true; dashUpgradeConfirmBtn.style.opacity = '0.5'; dashUpgradeConfirmBtn.textContent = 'Upgrade All Classes'; }

        ApiClient.post(`/api/table/${tableId}/cards/generate-upgrade-code/`)
          .then(data => {
            if (data.success) {
              dashUpgradeExpectedCode = data.code;
              if (dashUpgradeCodeDisplay) dashUpgradeCodeDisplay.textContent = data.code;
              if (dashUpgradeTableNameEl) dashUpgradeTableNameEl.textContent = data.table_name;
              if (dashUpgradeCountEl) dashUpgradeCountEl.textContent = data.download_count;
              if (window.alpineOpenModal) window.alpineOpenModal('dashUpgrade');
              if (dashUpgradeCodeInput) dashUpgradeCodeInput.focus();
            } else {
              if (typeof showToast === 'function') showToast(data.message || 'Failed to generate code', 'error');
            }
          })
          .catch(() => { if (typeof showToast === 'function') showToast('Error generating confirmation code', 'error'); });
    }

    function dashCloseUpgradeAllModal() {
        if (window.alpineCloseModal) window.alpineCloseModal();
        dashUpgradeTableId = null;
        dashUpgradeExpectedCode = '';
        if (dashUpgradeCodeInput) dashUpgradeCodeInput.value = '';
    }

    if (dashUpgradeCodeInput) {
        dashUpgradeCodeInput.addEventListener('input', function() {
            const match = this.value.trim() === dashUpgradeExpectedCode;
            if (dashUpgradeConfirmBtn) { dashUpgradeConfirmBtn.disabled = !match; dashUpgradeConfirmBtn.style.opacity = match ? '1' : '0.5'; }
        });
    }
    if (dashUpgradeCancelBtn) dashUpgradeCancelBtn.addEventListener('click', dashCloseUpgradeAllModal);
    // Overlay click-to-close now handled by Alpine @click.self in template

    if (dashUpgradeConfirmBtn) {
        dashUpgradeConfirmBtn.addEventListener('click', function() {
            if (!dashUpgradeTableId || dashUpgradeConfirmBtn.disabled) return;
            dashUpgradeConfirmBtn.disabled = true;
            dashUpgradeConfirmBtn.textContent = 'Upgrading...';

            ApiClient.post(`/api/table/${dashUpgradeTableId}/cards/upgrade-classes/`, { confirmation_code: dashUpgradeCodeInput.value.trim() })
            .then(data => {
                dashCloseUpgradeAllModal();
                if (typeof showToast === 'function') showToast(data.message || (data.success ? 'Upgraded!' : 'Failed'), data.success ? 'success' : 'error');
            })
            .catch(() => {
                dashCloseUpgradeAllModal();
                if (typeof showToast === 'function') showToast('Error upgrading classes', 'error');
            });
        });
    }

    // ====================
    // Reupload Images on Dashboard
    // ====================
    let dashReuploadTableId = null;
    const dashReuploadModal = document.getElementById('dashReuploadModal');
    const dashReuploadFileInput = document.getElementById('dashReuploadFileInput');
    const dashReuploadDropZone = document.getElementById('dashReuploadDropZone');
    const dashReuploadFileName = document.getElementById('dashReuploadFileName');
    const dashReuploadConfirmBtn = document.getElementById('dashReuploadConfirm');
    const dashReuploadCancelBtn = document.getElementById('dashReuploadCancel');
    const dashReuploadProgress = document.getElementById('dashReuploadProgress');
    const dashReuploadBar = document.getElementById('dashReuploadBar');
    const dashReuploadStatus = document.getElementById('dashReuploadStatus');

    function dashOpenReuploadModal(tableId) {
        dashReuploadTableId = tableId;
        if (dashReuploadFileInput) dashReuploadFileInput.value = '';
        if (dashReuploadFileName) dashReuploadFileName.textContent = 'Click or drag & drop a ZIP file';
        if (dashReuploadConfirmBtn) { dashReuploadConfirmBtn.disabled = true; dashReuploadConfirmBtn.style.opacity = '0.5'; dashReuploadConfirmBtn.textContent = 'Upload & Match'; }
        if (dashReuploadProgress) dashReuploadProgress.style.display = 'none';
        if (dashReuploadBar) dashReuploadBar.style.width = '0%';
        if (window.alpineOpenModal) window.alpineOpenModal('dashReupload');
    }

    function dashCloseReuploadModal() {
        if (window.alpineCloseModal) window.alpineCloseModal();
        dashReuploadTableId = null;
        if (dashReuploadFileInput) dashReuploadFileInput.value = '';
    }

    if (dashReuploadDropZone) {
        dashReuploadDropZone.addEventListener('click', () => dashReuploadFileInput && dashReuploadFileInput.click());
        dashReuploadDropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            this.style.borderColor = '#d1d5db'; this.style.backgroundColor = '';
            if (e.dataTransfer.files.length && e.dataTransfer.files[0].name.endsWith('.zip')) {
                dashReuploadFileInput.files = e.dataTransfer.files;
                dashReuploadFileInput.dispatchEvent(new Event('change'));
            } else {
                if (typeof showToast === 'function') showToast('Please drop a .zip file', 'error');
            }
        });
    }

    if (dashReuploadFileInput) {
        dashReuploadFileInput.addEventListener('change', function() {
            if (this.files.length) {
                var _file = this.files[0];
                var _maxZip = 950 * 1024 * 1024;
                if (_file.size > _maxZip) {
                    var _sizeMB = (_file.size / (1024 * 1024)).toFixed(0);
                    if (typeof showToast === 'function') showToast('ZIP is ' + _sizeMB + ' MB  maximum allowed is 950 MB. Please split into smaller ZIPs.', 'error');
                    this.value = '';
                    if (dashReuploadFileName) dashReuploadFileName.textContent = 'Click or drag & drop a ZIP file';
                    if (dashReuploadConfirmBtn) { dashReuploadConfirmBtn.disabled = true; dashReuploadConfirmBtn.style.opacity = '0.5'; }
                    return;
                }
                if (dashReuploadFileName) dashReuploadFileName.textContent = _file.name;
                if (dashReuploadConfirmBtn) { dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.style.opacity = '1'; }
            }
        });
    }

    if (dashReuploadCancelBtn) dashReuploadCancelBtn.addEventListener('click', dashCloseReuploadModal);
    if (dashReuploadModal) dashReuploadModal.addEventListener('click', function(e) { if (e.target === dashReuploadModal) dashCloseReuploadModal(); });

    if (dashReuploadConfirmBtn) {
        dashReuploadConfirmBtn.addEventListener('click', function() {
            if (!dashReuploadTableId || !dashReuploadFileInput || !dashReuploadFileInput.files.length) return;
            dashReuploadConfirmBtn.disabled = true;
            dashReuploadConfirmBtn.textContent = 'Uploading...';
            if (dashReuploadProgress) dashReuploadProgress.style.display = 'block';
            if (dashReuploadBar) dashReuploadBar.style.width = '0%';
            if (dashReuploadStatus) dashReuploadStatus.textContent = 'Starting upload...';
            let _dashPollInterval = null;

            const formData = new FormData();
            formData.append('photos_zip', dashReuploadFileInput.files[0]);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/table/${dashReuploadTableId}/reupload-task/`);
            xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');
            xhr.timeout = 300000;

            xhr.upload.onprogress = function(e) {
                if (e.lengthComputable) {
                    const uploadPct = Math.round((e.loaded / e.total) * 80);
                    if (dashReuploadBar) dashReuploadBar.style.width = uploadPct + '%';
                    if (dashReuploadStatus) dashReuploadStatus.textContent = `Uploading... ${Math.round(e.loaded / e.total * 100)}%`;
                }
            };

            xhr.onload = function() {
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (xhr.status === 200 && data.success) {
                        if (dashReuploadBar) dashReuploadBar.style.width = '80%';
                        if (dashReuploadStatus) dashReuploadStatus.textContent = 'Processing images...';
                        // Poll for real task progress
                        _dashPollInterval = setInterval(function() {
                            fetch('/api/task-status/' + data.task_id + '/')
                                .then(function(r) { return r.json(); })
                                .then(function(t) {
                                    if (t.status === 'completed') {
                                        clearInterval(_dashPollInterval);
                                        if (dashReuploadBar) dashReuploadBar.style.width = '100%';
                                        const matched = (t.result && t.result.matched_count != null) ? t.result.matched_count : '';
                                        const msg = matched !== '' ? ('Done! ' + matched + ' images matched.') : 'Done!';
                                        if (dashReuploadStatus) dashReuploadStatus.textContent = msg;
                                        if (typeof showToast === 'function') showToast(msg, 'success');
                                        setTimeout(() => dashCloseReuploadModal(), 1500);
                                    } else if (t.status === 'failed' || t.status === 'cancelled') {
                                        clearInterval(_dashPollInterval);
                                        const errMsg = t.error_message || 'Reupload failed. Please try again.';
                                        if (dashReuploadStatus) dashReuploadStatus.textContent = errMsg;
                                        if (typeof showToast === 'function') showToast(errMsg, 'error');
                                        dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                                    } else {
                                        const pct = 80 + Math.round((t.progress_percentage || 0) * 0.19);
                                        if (dashReuploadBar) dashReuploadBar.style.width = Math.min(pct, 99) + '%';
                                        if (dashReuploadStatus) dashReuploadStatus.textContent = 'Processing: ' + (t.progress || 0) + '/' + (t.total || '?') + ' images...';
                                    }
                                })
                                .catch(function() {}); // ignore transient network errors during polling
                        }, 2000);
                    } else {
                        if (dashReuploadStatus) dashReuploadStatus.textContent = data.message || 'Failed';
                        if (typeof showToast === 'function') showToast(data.message || 'Reupload failed', 'error');
                        dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                    }
                } catch (parseErr) {
                    console.error('Dashboard reupload parse error:', parseErr, 'Status:', xhr.status);
                    let errMsg = 'Unexpected error';
                    if (xhr.status === 413) errMsg = 'ZIP file too large.';
                    else if (xhr.status === 502 || xhr.status === 504) errMsg = 'Server timeout  try a smaller ZIP.';
                    else if (xhr.status === 500) errMsg = 'Server error. Please try again.';
                    else if (xhr.status === 0) errMsg = 'Connection lost. Check your internet.';
                    if (typeof showToast === 'function') showToast(errMsg, 'error');
                    dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                }
            };

            xhr.onerror = function() {
                const errMsg = 'Upload failed. Check your connection and try again.';
                if (typeof showToast === 'function') showToast(errMsg, 'error');
                if (dashReuploadStatus) dashReuploadStatus.textContent = errMsg;
                dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                if (dashReuploadProgress) dashReuploadProgress.style.display = 'none';
            };

            xhr.ontimeout = function() {
                if (typeof showToast === 'function') showToast('Upload timed out  try a smaller ZIP.', 'warning');
                dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                if (dashReuploadProgress) dashReuploadProgress.style.display = 'none';
            };

            xhr.send(formData);
        });
    }

    // Load bulk clients on page load
    loadBulkClients();

    // ====================
    // Load Print & Reprint Overview
    // ====================
    function loadPrintReprintOverview() {
        const printBody = document.getElementById('printOverviewBody');
        const reprintBody = document.getElementById('reprintOverviewBody');
        if (!printBody && !reprintBody) return;

        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

        ApiClient.get('/api/print-reprint-overview/?limit=500')
            .then(data => {
                if (!data.success) throw new Error(data.error || 'Failed');

                //  Render Print table 
                if (printBody) {
                    const clients = data.print_clients || [];
                    if (clients.length > 0) {
                        printBody.innerHTML = clients.map((client, i) => {
                            const tables = client.tables || [];
                            const iBadge = client.status && client.status !== 'active'
                                ? ` <span class="count-badge" style="background:#fee2e2;color:#dc2626;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px;">${esc(client.status)}</span>`
                                : '';
                            const subRows = tables.map(t => `
                                <tr class="client-sub-row print-expand-group-${i}" style="display:none">
                                    <td>
                                        <a href="/print/table/${t.id}/" class="sub-row-name"><i class="fa-solid fa-table"></i> ${esc(t.name)}</a>
                                    </td>
                                    <td class="text-center"><a href="/print/table/${t.id}/" class="count-badge pending">${t.print_list}</a></td>
                                    <td class="text-center"><a href="/print/table/${t.id}/" class="count-badge verified">${t.finalized}</a></td>
                                </tr>
                            `).join('');
                            return `
                                <tr class="client-row" data-idx="${i}" data-scope="print" onclick="toggleScopedExpandRow(this)">
                                    <td>
                                        <a href="/client/${client.id}/groups/" class="client-name-link" onclick="event.stopPropagation()">${esc(client.name)}${iBadge}</a>
                                    </td>
                                    <td class="text-center"><span class="count-badge pending">${client.print_list}</span></td>
                                    <td class="text-center"><span class="count-badge verified">${client.finalized}</span></td>
                                </tr>
                                ${subRows}
                            `;
                        }).join('');
                    } else {
                        printBody.innerHTML = `<tr><td colspan="3" class="text-center" style="padding:40px;color:#888;"><i class="fa-solid fa-inbox"></i> No print records</td></tr>`;
                    }
                }

                //  Render Reprint table 
                if (reprintBody) {
                    const clients = data.reprint_clients || [];
                    if (clients.length > 0) {
                        reprintBody.innerHTML = clients.map((client, i) => {
                            const tables = client.tables || [];
                            const iBadge = client.status && client.status !== 'active'
                                ? ` <span class="count-badge" style="background:#fee2e2;color:#dc2626;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px;">${esc(client.status)}</span>`
                                : '';
                            const subRows = tables.map(t => `
                                <tr class="client-sub-row reprint-expand-group-${i}" style="display:none">
                                    <td>
                                        <a href="/reprint/table/${t.id}/" class="sub-row-name"><i class="fa-solid fa-table"></i> ${esc(t.name)}</a>
                                    </td>
                                    <td class="text-center"><a href="/reprint/table/${t.id}/?step=request_list" class="count-badge pending">${t.requested}</a></td>
                                    <td class="text-center"><a href="/reprint/table/${t.id}/?step=confirmed" class="count-badge verified">${t.confirmed}</a></td>
                                </tr>
                            `).join('');
                            return `
                                <tr class="client-row" data-idx="${i}" data-scope="reprint" onclick="toggleScopedExpandRow(this)">
                                    <td>
                                        <a href="/client/${client.id}/groups/" class="client-name-link" onclick="event.stopPropagation()">${esc(client.name)}${iBadge}</a>
                                    </td>
                                    <td class="text-center"><span class="count-badge pending">${client.requested}</span></td>
                                    <td class="text-center"><span class="count-badge verified">${client.confirmed}</span></td>
                                </tr>
                                ${subRows}
                            `;
                        }).join('');
                    } else {
                        reprintBody.innerHTML = `<tr><td colspan="3" class="text-center" style="padding:40px;color:#888;"><i class="fa-solid fa-inbox"></i> No reprint records</td></tr>`;
                    }
                }
            })
            .catch(err => {
                console.error('Error loading print/reprint overview:', err);
                const errHtml = (cols) => `<tr><td colspan="${cols}" class="text-center" style="padding:40px;color:#dc2626;"><i class="fa-solid fa-exclamation-triangle"></i> Error loading data</td></tr>`;
                if (printBody)   printBody.innerHTML = errHtml(3);
                if (reprintBody) reprintBody.innerHTML = errHtml(3);
            });
    }

    loadPrintReprintOverview();
});
