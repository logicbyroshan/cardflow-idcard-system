// Dashboard Page JavaScript

// Global: toggle expandable client row
function toggleClientExpandRow(tr) {
    var idx = tr.getAttribute('data-idx');
    var subRows = document.querySelectorAll('.expand-group-' + idx);
    if (!subRows.length) return;
    var isOpen = tr.classList.contains('expanded');
    // Close all other expand groups
    document.querySelectorAll('.client-sub-row').forEach(function(r) { r.style.display = 'none'; });
    document.querySelectorAll('.client-row.expanded').forEach(function(r) { r.classList.remove('expanded'); });
    if (!isOpen) {
        subRows.forEach(function(r) { r.style.display = ''; });
        tr.classList.add('expanded');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    
    // ====================
    // Update Welcome Banner Date/Time
    // ====================
    const welcomeDate = document.getElementById('welcomeDate');
    const welcomeTime = document.getElementById('welcomeTime');
    
    function updateWelcomeDateTime() {
        const now = new Date();
        
        // Format date: Sunday, Feb 01, 2026
        const options = { weekday: 'long', year: 'numeric', month: 'short', day: '2-digit' };
        const dateStr = now.toLocaleDateString('en-US', options);
        
        // Format time: 00:00:00
        const timeStr = now.toLocaleTimeString('en-US', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
        
        if (welcomeDate) welcomeDate.textContent = dateStr;
        if (welcomeTime) welcomeTime.textContent = timeStr;
    }
    
    // Update immediately and then every second
    updateWelcomeDateTime();
    setInterval(updateWelcomeDateTime, 1000);
    
    // ====================
    // Animate Stat Cards on Load
    // ====================
    const statCards = document.querySelectorAll('.stat-card');
    statCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            card.style.transition = 'all 0.5s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 100);
    });
    
    // ====================
    // Animate Numbers
    // ====================
    function animateValue(element, start, end, duration) {
        const startTime = performance.now();
        const isFormatted = end.toString().includes(',');
        const endValue = parseInt(end.toString().replace(/,/g, ''));
        
        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            const current = Math.floor(start + (endValue - start) * easeOutQuart);
            
            if (isFormatted) {
                element.textContent = current.toLocaleString();
            } else {
                element.textContent = current;
            }
            
            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }
        
        requestAnimationFrame(update);
    }
    
    // Animate stat values - read actual values from DOM
    setTimeout(() => {
        const pendingCards = document.getElementById('pendingCards');
        const verifiedCards = document.getElementById('verifiedCards');
        const approvedCards = document.getElementById('approvedCards');
        const downloadedCards = document.getElementById('downloadedCards');
        
        // Read actual values from DOM, then animate from 0 to that value
        if (pendingCards) {
            const targetValue = parseInt(pendingCards.textContent.replace(/,/g, '')) || 0;
            animateValue(pendingCards, 0, targetValue, 1000);
        }
        if (verifiedCards) {
            const targetValue = parseInt(verifiedCards.textContent.replace(/,/g, '')) || 0;
            animateValue(verifiedCards, 0, targetValue, 1000);
        }
        if (approvedCards) {
            const targetValue = parseInt(approvedCards.textContent.replace(/,/g, '')) || 0;
            animateValue(approvedCards, 0, targetValue, 1200);
        }
        if (downloadedCards) {
            const targetValue = parseInt(downloadedCards.textContent.replace(/,/g, '')) || 0;
            animateValue(downloadedCards, 0, targetValue, 1500);
        }
    }, 500);
    
    // ====================
    // Quick Action Hover Effects
    // ====================
    const quickActionBtns = document.querySelectorAll('.quick-action-btn');
    quickActionBtns.forEach(btn => {
        btn.addEventListener('mouseenter', function() {
            this.querySelector('i').style.transform = 'scale(1.1)';
        });
        btn.addEventListener('mouseleave', function() {
            this.querySelector('i').style.transform = 'scale(1)';
        });
    });
    
    // ====================
    // Card Overview Hover
    // ====================
    const cardOverviewItems = document.querySelectorAll('.card-overview-item');
    cardOverviewItems.forEach(item => {
        item.style.cursor = 'pointer';
        item.addEventListener('mouseenter', function() {
            this.style.background = 'linear-gradient(135deg, rgba(102, 126, 234, 0.08) 0%, rgba(118, 75, 162, 0.08) 100%)';
            this.style.borderColor = 'rgba(102, 126, 234, 0.2)';
        });
        item.addEventListener('mouseleave', function() {
            this.style.background = '#fafbfc';
            this.style.borderColor = 'rgba(0, 0, 0, 0.04)';
        });
    });
    
    // ====================
    // Activity Item Hover
    // ====================
    const activityItems = document.querySelectorAll('.activity-item');
    activityItems.forEach(item => {
        item.addEventListener('mouseenter', function() {
            this.style.background = 'rgba(102, 126, 234, 0.04)';
            this.style.marginLeft = '-10px';
            this.style.marginRight = '-10px';
            this.style.paddingLeft = '10px';
            this.style.paddingRight = '10px';
            this.style.borderRadius = '8px';
        });
        item.addEventListener('mouseleave', function() {
            this.style.background = 'transparent';
            this.style.marginLeft = '0';
            this.style.marginRight = '0';
            this.style.paddingLeft = '0';
            this.style.paddingRight = '0';
        });
    });
    
    // ====================
    // Recent Table Row Hover
    // ====================
    const tableRows = document.querySelectorAll('.recent-table tbody tr');
    tableRows.forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', function() {
            // Could navigate to client details
        });
    });
    
    // ====================
    // Dashboard Cards Animation on Scroll
    // ====================
    const dashboardCards = document.querySelectorAll('.dashboard-card');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });
    
    dashboardCards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'all 0.5s ease';
        observer.observe(card);
    });
    
    // Trigger immediately for visible cards
    setTimeout(() => {
        dashboardCards.forEach(card => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        });
    }, 300);
    
    // NOTE: Global search (Ctrl+K) is now handled by global-search.js (standalone module)
    
    // ====================
    // Load Recent Client Updates
    // ====================
    function loadRecentClientUpdates() {
        const tbody = document.getElementById('recentClientUpdatesBody');
        if (!tbody) return;
        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        
        ApiClient.get('/panel/api/recent-client-updates/?limit=5')
            .then(data => {
                if (data.success && data.clients.length > 0) {
                    tbody.innerHTML = data.clients.map((client, i) => {
                        const tables = client.tables || [];
                        // Build sub-rows for each table (same column structure)
                        const tableSubRows = tables.map(t => `
                            <tr class="client-sub-row expand-group-${i}" style="display:none">
                                <td>
                                    <a href="/panel/table/${t.id}/cards/" class="sub-row-name"><i class="fa-solid fa-table"></i> ${esc(t.name)}</a>
                                </td>
                                <td class="text-center">
                                    <a href="/panel/table/${t.id}/cards/?status=pending" class="count-badge pending">${t.pending}</a>
                                </td>
                                <td class="text-center">
                                    <a href="/panel/table/${t.id}/cards/?status=verified" class="count-badge verified">${t.verified}</a>
                                </td>
                                <td class="text-center">
                                    <a href="/panel/table/${t.id}/cards/?status=approved" class="count-badge approved">${t.approved}</a>
                                </td>
                                <td class="text-center">
                                    <a href="/panel/table/${t.id}/cards/?status=download" class="count-badge downloaded">${t.downloaded}</a>
                                </td>
                            </tr>
                        `).join('');

                        return `
                        <tr class="client-row" data-idx="${i}" onclick="toggleClientExpandRow(this)">
                            <td>
                                <span class="client-name">${esc(client.name)}</span>
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
            const data = await ApiClient.get('/panel/api/clients/active/');
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
                const data = await ApiClient.get(`/panel/api/group/${clientId}/tables/`);
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

        ApiClient.post(`/panel/api/table/${tableId}/cards/generate-delete-code/`)
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

            ApiClient.post(`/panel/api/table/${dashDeleteTableId}/cards/bulk-delete/`, { delete_all: true, confirmation_code: dashDeleteCodeInput.value.trim() })
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

        ApiClient.post(`/panel/api/table/${tableId}/cards/download-all/`)
        .then(data => {
            if (data.success && data.files && data.files.length > 0) {
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

        ApiClient.post(`/panel/api/table/${tableId}/cards/generate-upgrade-code/`)
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

            ApiClient.post(`/panel/api/table/${dashUpgradeTableId}/cards/upgrade-classes/`, { confirmation_code: dashUpgradeCodeInput.value.trim() })
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
                if (dashReuploadFileName) dashReuploadFileName.textContent = this.files[0].name;
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
            if (dashReuploadBar) dashReuploadBar.style.width = '30%';
            if (dashReuploadStatus) dashReuploadStatus.textContent = 'Uploading ZIP...';

            const formData = new FormData();
            formData.append('photos_zip', dashReuploadFileInput.files[0]);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/panel/api/table/${dashReuploadTableId}/cards/reupload-images/`);
            xhr.setRequestHeader('X-CSRFToken', typeof getCSRFToken === 'function' ? getCSRFToken() : '');

            xhr.upload.onprogress = function(e) {
                if (e.lengthComputable) {
                    const pct = Math.round((e.loaded / e.total) * 60) + 30;
                    if (dashReuploadBar) dashReuploadBar.style.width = pct + '%';
                    if (dashReuploadStatus) dashReuploadStatus.textContent = `Uploading... ${Math.round(e.loaded / e.total * 100)}%`;
                }
            };

            xhr.onload = function() {
                if (dashReuploadBar) dashReuploadBar.style.width = '100%';
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (data.success) {
                        if (dashReuploadStatus) dashReuploadStatus.textContent = data.message || 'Done!';
                        if (typeof showToast === 'function') showToast(data.message || 'Images reuploaded!', 'success');
                        setTimeout(() => dashCloseReuploadModal(), 1500);
                    } else {
                        if (dashReuploadStatus) dashReuploadStatus.textContent = data.message || 'Failed';
                        if (typeof showToast === 'function') showToast(data.message || 'Reupload failed', 'error');
                        dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                    }
                } catch (_) {
                    if (typeof showToast === 'function') showToast('Unexpected error', 'error');
                    dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                }
            };

            xhr.onerror = function() {
                if (typeof showToast === 'function') showToast('Network error', 'error');
                dashReuploadConfirmBtn.disabled = false; dashReuploadConfirmBtn.textContent = 'Upload & Match';
                if (dashReuploadProgress) dashReuploadProgress.style.display = 'none';
            };

            xhr.send(formData);
        });
    }

    // Load bulk clients on page load
    loadBulkClients();
});
