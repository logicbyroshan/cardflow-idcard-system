/**
 * Website Admin  Portfolio Module (v3)
 * CRUD for Portfolio items + Category management
 * Type & orientation are auto-detected server-side.
 */
(function () {
    const BASE = '/website/api';

    /* ================================================================
       PORTFOLIO ITEM  MODAL
    ================================================================ */

    window.openPortfolioModal = function (id) {
        document.getElementById('portfolioModalTitle').textContent = id ? 'Edit Portfolio Item' : 'Add Portfolio Item';
        document.getElementById('portfolioForm').reset();
        document.getElementById('portfolioId').value = id || '';
        if (id) {
            ApiClient.get(`${BASE}/portfolio/${id}/`)
                .then(d => {
                    if (!d.success) return;
                    const p = d.item;
                    document.getElementById('pf_category').value = p.category_id || '';
                    document.getElementById('pf_order').value = p.order || 0;
                    document.getElementById('pf_active').checked = p.is_active;
                    document.getElementById('pf_featured').checked = p.is_featured;
                });
        }
        document.getElementById('portfolioModal').classList.add('show');
    };
    window.closePortfolioModal = function () {
        document.getElementById('portfolioModal').classList.remove('show');
    };
    window.editPortfolio = function (id) { openPortfolioModal(id); };

    /* FORM SUBMIT */
    document.getElementById('portfolioForm').addEventListener('submit', function (e) {
        e.preventDefault();
        const id = document.getElementById('portfolioId').value;
        const fd = new FormData(this);
        const url = id ? `${BASE}/portfolio/${id}/update/` : `${BASE}/portfolio/create/`;
        if (!fd.has('is_active')) fd.append('is_active', 'false');
        else fd.set('is_active', 'true');
        if (!fd.has('is_featured')) fd.append('is_featured', 'false');
        else fd.set('is_featured', 'true');
        ApiClient.upload(url, fd)
            .then(d => {
                if (d.success) { showToast(d.message, 'success'); location.reload(); }
                else showToast(d.message || 'Error', 'error');
            })
            .catch(() => showToast('Network error', 'error'));
    });

    /* DELETE / TOGGLE */
    window.deletePortfolio = async function (id) {
        const ok = await waConfirm({ title: 'Delete Portfolio Item?', text: 'This item will be permanently removed.', icon: 'fa-solid fa-trash' });
        if (!ok) return;
        ApiClient.post(`${BASE}/portfolio/${id}/delete/`)
            .then(d => { if (d.success) { showToast(d.message, 'success'); location.reload(); } else showToast(d.message, 'error'); })
            .catch(() => showToast('Network error', 'error'));
    };

    window.togglePortfolio = function (id, badge) {
        ApiClient.post(`${BASE}/portfolio/${id}/toggle/`)
            .then(d => {
                if (d.success) {
                    badge.textContent = d.is_active ? 'Active' : 'Inactive';
                    badge.className = 'wa-status-badge ' + (d.is_active ? 'active' : 'inactive');
                }
            });
    };

    /* FILTER */
    const filterBtns = document.querySelectorAll('#portfolioFilters .wa-filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            filterBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const cat = this.dataset.cat;
            document.querySelectorAll('#portfolioBody tr').forEach(row => {
                if (cat === 'all') row.style.display = '';
                else row.style.display = row.dataset.cat === cat ? '' : 'none';
            });
        });
    });

    /* ================================================================
       CATEGORY MANAGEMENT
    ================================================================ */

    /* ================================================================
       BULK UPLOAD
    ================================================================ */
    window.openBulkUploadModal = function () {
        document.getElementById('bulkUploadForm').reset();
        document.getElementById('bulkFileCount').style.display = 'none';
        document.getElementById('bulkProgress').style.display = 'none';
        document.getElementById('bulkUploadBtn').disabled = false;
        document.getElementById('bulkUploadModal').classList.add('show');
    };
    window.closeBulkUploadModal = function () {
        document.getElementById('bulkUploadModal').classList.remove('show');
    };

    // Show file count when user selects files
    document.getElementById('bulk_images').addEventListener('change', function () {
        var countEl = document.getElementById('bulkFileCount');
        var count = this.files ? this.files.length : 0;
        if (count > 0) {
            countEl.textContent = count + ' image' + (count !== 1 ? 's' : '') + ' selected';
            if (count > 50) countEl.textContent += ' (max 50  extra will be ignored)';
            countEl.style.display = 'block';
        } else {
            countEl.style.display = 'none';
        }
    });

    // Bulk upload form submit
    document.getElementById('bulkUploadForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var fileInput = document.getElementById('bulk_images');
        var category = document.getElementById('bulk_category').value;
        if (!category) { showToast('Please select a category', 'error'); return; }
        if (!fileInput.files || fileInput.files.length === 0) { showToast('Please select images', 'error'); return; }

        var files = Array.from(fileInput.files).slice(0, 50);

        //  Client-side validation: file type + size 
        var allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
        var maxSingleMB = 20;
        for (var vi = 0; vi < files.length; vi++) {
            var fname = files[vi].name.toLowerCase();
            var fext = fname.split('.').pop();
            if (allowedExts.indexOf(fext) === -1) {
                showToast(fname + ': Invalid type. Allowed: ' + allowedExts.join(', '), 'error');
                return;
            }
            if (files[vi].size > maxSingleMB * 1024 * 1024) {
                showToast(fname + ': Too large (' + (files[vi].size / 1024 / 1024).toFixed(1) + ' MB). Max ' + maxSingleMB + ' MB per image.', 'error');
                return;
            }
        }

        var btn = document.getElementById('bulkUploadBtn');
        var progressWrap = document.getElementById('bulkProgress');
        var progressBar = document.getElementById('bulkProgressBar');
        var progressText = document.getElementById('bulkProgressText');

        btn.disabled = true;
        progressWrap.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = 'Uploading 0/' + files.length + '...';
        var _portfolioProcessingTimer = null;
        var _portfolioUploadDone = false;

        //  Stall detection: abort if no progress for 60 seconds 
        // (Raised from 30s because server-side processing of 50 images is synchronous)
        var _pfLastProgress = Date.now();
        var _pfStallTimer = setInterval(function() {
            if (_portfolioUploadDone) { clearInterval(_pfStallTimer); return; }
            if (Date.now() - _pfLastProgress > 60000) {
                clearInterval(_pfStallTimer);
                if (!_portfolioUploadDone) {
                    _portfolioUploadDone = true;
                    xhr.abort();
                    if (_portfolioProcessingTimer) { clearInterval(_portfolioProcessingTimer); _portfolioProcessingTimer = null; }
                    progressText.textContent = 'Upload stalled  server may have rejected the files.';
                    showToast(
                        'Upload stalled. Check that Nginx client_max_body_size is large enough (1000M) and the server is running.',
                        'error'
                    );
                    btn.disabled = false;
                }
            }
        }, 5000);

        function _cleanupPortfolioUpload() {
            _portfolioUploadDone = true;
            clearInterval(_pfStallTimer);
        }

        var fd = new FormData();
        fd.append('category', category);
        for (var i = 0; i < files.length; i++) {
            fd.append('images', files[i]);
        }

        var uploadUrl = BASE + '/portfolio/bulk-upload/';
        var xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl, true);
        var csrfToken = document.querySelector('[name=csrfmiddlewaretoken]');
        if (csrfToken) xhr.setRequestHeader('X-CSRFToken', csrfToken.value);
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        console.log('[Portfolio] Starting bulk upload to', uploadUrl, '| Files:', files.length, '| Total size:', Math.round(files.reduce(function(s,f){return s+f.size;},0) / 1024) + 'KB');

        // Phase 1: Upload progress (0%  80%)
        xhr.upload.onprogress = function (ev) {
            _pfLastProgress = Date.now();
            if (ev.lengthComputable) {
                var rawPct = Math.round((ev.loaded / ev.total) * 100);
                var barPct = Math.round((ev.loaded / ev.total) * 80);
                progressBar.style.width = barPct + '%';
                progressText.textContent = 'Uploading... ' + rawPct + '%';
            }
        };

        // 5-minute timeout (matches reupload files)
        xhr.timeout = 300000;
        xhr.ontimeout = function() {
            if (_portfolioUploadDone) return;
            _cleanupPortfolioUpload();
            if (_portfolioProcessingTimer) { clearInterval(_portfolioProcessingTimer); _portfolioProcessingTimer = null; }
            progressText.textContent = 'Upload timed out  try fewer images.';
            showToast('Upload timed out after 5 minutes. Try uploading fewer images at once.', 'error');
            btn.disabled = false;
        };

        // Phase 2: Upload done  server processing (80%  95%)
        xhr.upload.onloadend = function () {
            // CRITICAL: Reset stall timer so it doesn't fire during server processing
            _pfLastProgress = Date.now();
            progressBar.style.width = '80%';
            progressText.textContent = 'Processing ' + files.length + ' image(s) on server...';
            var _procStart = Date.now();
            _portfolioProcessingTimer = setInterval(function () {
                var el = (Date.now() - _procStart) / 1000;
                var pct = 80 + Math.round(15 * (1 - Math.exp(-el / 6)));
                progressBar.style.width = Math.min(pct, 95) + '%';
            }, 400);
        };

        //  Catch early server error (e.g. Nginx 413) before upload finishes 
        xhr.onreadystatechange = function() {
            if (xhr.readyState >= 2) {
                console.log('[Portfolio] XHR state:', xhr.readyState, '| HTTP:', xhr.status);
            }
            if (xhr.readyState === 4 && !_portfolioUploadDone) {
                if (xhr.status !== 200 && xhr.status !== 0) {
                    _cleanupPortfolioUpload();
                    if (_portfolioProcessingTimer) { clearInterval(_portfolioProcessingTimer); _portfolioProcessingTimer = null; }
                    var earlyErr = 'Server rejected the upload (HTTP ' + xhr.status + ').';
                    if (xhr.status === 413) earlyErr = 'Files too large. Increase Nginx client_max_body_size.';
                    else if (xhr.status === 403) earlyErr = 'Forbidden (403). Possible causes: CSRF token expired, session expired, or no permission. Try reloading the page.';
                    console.error('[Portfolio] Upload rejection: HTTP', xhr.status, xhr.responseText ? xhr.responseText.substring(0, 500) : '(empty)');
                    progressText.textContent = earlyErr;
                    showToast(earlyErr, 'error');
                    btn.disabled = false;
                }
            }
        };

        xhr.onload = function () {
            if (_portfolioUploadDone) return;
            _cleanupPortfolioUpload();
            if (_portfolioProcessingTimer) { clearInterval(_portfolioProcessingTimer); _portfolioProcessingTimer = null; }
            progressBar.style.width = '100%';
            try {
                var data = JSON.parse(xhr.responseText);
                if (data.success) {
                    showToast(data.message, 'success');
                    setTimeout(function () { location.reload(); }, 800);
                } else {
                    showToast(data.message || 'Upload failed', 'error');
                    btn.disabled = false;
                }
            } catch (err) {
                console.error('Portfolio upload parse error:', err, 'Status:', xhr.status, 'Response:', xhr.responseText ? xhr.responseText.substring(0, 300) : '(empty)');
                var errMsg = 'Upload failed';
                if (xhr.status === 413) errMsg = 'Files too large. Increase Nginx client_max_body_size (need 1000M).';
                else if (xhr.status === 502 || xhr.status === 504) errMsg = 'Server timeout  try fewer images.';
                else if (xhr.status === 0) errMsg = 'Connection lost  server may have rejected the upload size.';
                showToast(errMsg, 'error');
                btn.disabled = false;
            }
        };
        xhr.onerror = function () {
            if (_portfolioUploadDone) return;
            _cleanupPortfolioUpload();
            if (_portfolioProcessingTimer) { clearInterval(_portfolioProcessingTimer); _portfolioProcessingTimer = null; }
            console.error('Portfolio XHR onerror  status:', xhr.status, 'readyState:', xhr.readyState);
            var errMsg = 'Upload failed. ';
            if (xhr.status === 0) errMsg += 'Connection was reset  server may have rejected the file size. Check Nginx client_max_body_size.';
            else errMsg += 'Network error during upload.';
            showToast(errMsg, 'error');
            btn.disabled = false;
        };
        xhr.send(fd);
    });

    /* ================================================================
       CATEGORY MANAGEMENT (continued)
    ================================================================ */
    window.openCategoryModal = function () {
        document.getElementById('categoryModalTitle').textContent = 'Add Category';
        document.getElementById('categoryForm').reset();
        document.getElementById('cat_id').value = '';
        document.getElementById('cat_icon').value = 'fas fa-folder';
        document.getElementById('cat_is_bento').checked = false;
        document.getElementById('cat_bento_size').value = 'normal';
        document.getElementById('categoryModal').classList.add('show');
    };
    window.closeCategoryModal = function () {
        document.getElementById('categoryModal').classList.remove('show');
    };

    window.editCategory = function (id, name, icon, desc, order, isBento, bentoSize) {
        document.getElementById('categoryModalTitle').textContent = 'Edit Category';
        document.getElementById('cat_id').value = id;
        document.getElementById('cat_name').value = name;
        document.getElementById('cat_icon').value = icon;
        document.getElementById('cat_desc').value = desc;
        document.getElementById('cat_order').value = order;
        document.getElementById('cat_is_bento').checked = !!isBento;
        document.getElementById('cat_bento_size').value = bentoSize || 'normal';
        document.getElementById('categoryModal').classList.add('show');
    };

    window.deleteCategory = async function (id) {
        const ok = await waConfirm({ title: 'Delete Category?', text: 'Items will keep their content but lose their category assignment.', icon: 'fa-solid fa-trash' });
        if (!ok) return;
        ApiClient.post(`${BASE}/portfolio-categories/${id}/delete/`)
            .then(d => { if (d.success) { showToast(d.message, 'success'); location.reload(); } else showToast(d.message, 'error'); })
            .catch(() => showToast('Network error', 'error'));
    };

    document.getElementById('categoryForm').addEventListener('submit', function (e) {
        e.preventDefault();
        const id = document.getElementById('cat_id').value;
        const payload = {
            name: document.getElementById('cat_name').value,
            icon: document.getElementById('cat_icon').value,
            description: document.getElementById('cat_desc').value,
            order: parseInt(document.getElementById('cat_order').value) || 0,
            is_bento: document.getElementById('cat_is_bento').checked,
            bento_size: document.getElementById('cat_bento_size').value || 'normal',
        };
        const url = id ? `${BASE}/portfolio-categories/${id}/update/` : `${BASE}/portfolio-categories/create/`;
        ApiClient.post(url, payload)
            .then(d => {
                if (d.success) { showToast(d.message, 'success'); location.reload(); }
                else showToast(d.message || 'Error', 'error');
            })
            .catch(() => showToast('Network error', 'error'));
    });
})();
