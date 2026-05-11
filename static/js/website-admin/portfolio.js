/**
 * Website Admin  Portfolio Module (v3)
 * CRUD for Portfolio items + Category management
 * Orientation is auto-detected server-side for image uploads.
 */
(function () {
    const BASE = '/website/api';
    const portfolioForm = document.getElementById('portfolioForm');
    const currentMediaGroup = document.getElementById('pf_current_media_group');
    const currentMediaBox = document.getElementById('pf_current_media');
    const itemTypeField = document.getElementById('pf_item_type');
    const videoUrlField = document.getElementById('pf_video_url');

    /* ================================================================
       PORTFOLIO ITEM  MODAL
    ================================================================ */

    function resetCurrentMediaPreview() {
        if (!currentMediaGroup || !currentMediaBox) return;
        currentMediaBox.innerHTML = '';
        currentMediaGroup.style.display = 'none';
    }

    function mediaTypeLabel(itemType) {
        if (itemType === 'video') return 'Video';
        if (itemType === 'reel') return 'Reel';
        return 'Image';
    }

    function appendMediaLink(url, text) {
        if (!url || !currentMediaBox) return;
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'media-link';
        link.textContent = text;
        currentMediaBox.appendChild(link);
    }

    function renderCurrentMediaPreview(item) {
        if (!currentMediaGroup || !currentMediaBox) return;
        currentMediaBox.innerHTML = '';

        const type = (item.item_type || 'image').toLowerCase();
        const imageUrl = item.image || '';
        const videoFileUrl = item.video_file || '';
        const videoUrl = item.video_url || '';
        const hasAnyMedia = Boolean(imageUrl || videoFileUrl || videoUrl);

        if (!hasAnyMedia) {
            currentMediaGroup.style.display = 'none';
            return;
        }

        let previewEl = null;
        if ((type === 'video' || type === 'reel') && videoFileUrl) {
            previewEl = document.createElement('video');
            previewEl.src = videoFileUrl;
            previewEl.controls = true;
            previewEl.preload = 'metadata';
            previewEl.className = 'media-preview';
            previewEl.setAttribute('playsinline', '');
        } else if (imageUrl) {
            previewEl = document.createElement('img');
            previewEl.src = imageUrl;
            previewEl.alt = 'Current media preview';
            previewEl.className = 'media-preview';
            previewEl.loading = 'lazy';
            previewEl.decoding = 'async';
        }

        if (previewEl) currentMediaBox.appendChild(previewEl);

        const meta = document.createElement('div');
        meta.className = 'media-meta';

        const typeTag = document.createElement('span');
        typeTag.className = 'media-type';
        typeTag.textContent = 'Current type: ' + mediaTypeLabel(type);
        meta.appendChild(typeTag);

        currentMediaBox.appendChild(meta);

        if (videoFileUrl) appendMediaLink(videoFileUrl, 'Open uploaded video');
        if (!videoFileUrl && videoUrl) appendMediaLink(videoUrl, 'Open linked video URL');
        if (!previewEl && imageUrl) appendMediaLink(imageUrl, 'Open current image');

        currentMediaGroup.style.display = 'block';
    }

    function initPortfolioVideoThumbPreviews() {
        document.querySelectorAll('#portfolioBody video.portfolio-thumb-video').forEach(function (videoEl) {
            if (videoEl.dataset.previewReady === '1') return;
            videoEl.dataset.previewReady = '1';

            const fallbackId = videoEl.getAttribute('data-preview-fallback-id');
            const fallbackEl = fallbackId ? document.getElementById(fallbackId) : null;

            function showFallback() {
                videoEl.style.display = 'none';
                if (fallbackEl) fallbackEl.style.display = 'inline-flex';
            }

            function seekPreviewFrame() {
                try {
                    const duration = videoEl.duration;
                    if (!Number.isFinite(duration) || duration <= 0) return;
                    const previewTime = Math.min(0.1, duration / 4);
                    if (previewTime > 0) videoEl.currentTime = previewTime;
                } catch (_) {
                    // Ignore seek errors and let browser keep default frame.
                }
            }

            videoEl.addEventListener('error', showFallback, { once: true });
            videoEl.addEventListener('loadedmetadata', seekPreviewFrame, { once: true });
            videoEl.addEventListener('seeked', function () {
                try { videoEl.pause(); } catch (_) { /* no-op */ }
            }, { once: true });

            if (videoEl.readyState >= 1) seekPreviewFrame();
        });
    }

    window.openPortfolioModal = function (id) {
        document.getElementById('portfolioModalTitle').textContent = id ? 'Edit Portfolio Item' : 'Add Portfolio Item';
        portfolioForm.reset();
        document.getElementById('portfolioId').value = id || '';
        document.getElementById('pf_item_type').value = 'image';
        if (videoUrlField) videoUrlField.value = '';
        resetCurrentMediaPreview();

        if (id) {
            ApiClient.get(`${BASE}/portfolio/${id}/`)
                .then(d => {
                    if (!d.success) return;
                    const p = d.item;
                    document.getElementById('pf_category').value = p.category_id || '';
                    document.getElementById('pf_order').value = p.order || 0;
                    document.getElementById('pf_item_type').value = p.item_type || 'image';
                    if (videoUrlField) videoUrlField.value = p.video_url || '';
                    document.getElementById('pf_active').checked = p.is_active;
                    document.getElementById('pf_featured').checked = p.is_featured;
                    renderCurrentMediaPreview(p);
                });
        }

        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
            window.AdarshModalBridge.open('portfolioModal', { overlayClass: 'show' });
        } else {
            document.getElementById('portfolioModal').classList.add('show');
        }
    };
    window.closePortfolioModal = function () {
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
            window.AdarshModalBridge.close('portfolioModal', { overlayClass: 'show' });
        } else {
            document.getElementById('portfolioModal').classList.remove('show');
        }
    };
    window.editPortfolio = function (id) { openPortfolioModal(id); };

    /* FORM SUBMIT */
    portfolioForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const id = document.getElementById('portfolioId').value;
        const fd = new FormData(this);
        const url = id ? `${BASE}/portfolio/${id}/update/` : `${BASE}/portfolio/create/`;
        const imageInput = document.getElementById('pf_image');
        const videoInput = document.getElementById('pf_video_file');
        const imageFile = imageInput && imageInput.files && imageInput.files[0] ? imageInput.files[0] : null;
        const videoFile = videoInput && videoInput.files && videoInput.files[0] ? videoInput.files[0] : null;

        const selectedType = itemTypeField ? (itemTypeField.value || 'image') : 'image';
        fd.set('item_type', selectedType);
        fd.set('is_active', document.getElementById('pf_active').checked ? 'true' : 'false');
        fd.set('is_featured', document.getElementById('pf_featured').checked ? 'true' : 'false');

        if (selectedType === 'image') {
            if (!imageFile) {
                showToast('Please select an image file.', 'error');
                return;
            }
            fd.set('video_url', '');
            fd.delete('video_file');
        } else if (!videoFile) {
            showToast('Please select a video file for Video or Reel items.', 'error');
            return;
        }

        if (selectedType === 'image' && imageFile && imageFile.size > 10 * 1024 * 1024) {
            showToast('Image is too large. Maximum size is 10 MB.', 'error');
            return;
        }
        if (selectedType !== 'image' && videoFile && videoFile.size > 100 * 1024 * 1024) {
            showToast('Video is too large. Maximum size is 100 MB.', 'error');
            return;
        }

        ApiClient.upload(url, fd)
            .then(d => {
                if (d.success) { showToast(d.message, 'success'); location.reload(); }
                else showToast(d.message || 'Error', 'error');
            })
            .catch(err => {
                if (err && err.status === 413) {
                    showToast('Upload blocked by the server size limit. Increase request body/upload limits.', 'error');
                    return;
                }
                showToast('Network error', 'error');
            });
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

    initPortfolioVideoThumbPreviews();

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
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
            window.AdarshModalBridge.open('bulkUploadModal', { overlayClass: 'show' });
        } else {
            document.getElementById('bulkUploadModal').classList.add('show');
        }
    };
    window.closeBulkUploadModal = function () {
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
            window.AdarshModalBridge.close('bulkUploadModal', { overlayClass: 'show' });
        } else {
            document.getElementById('bulkUploadModal').classList.remove('show');
        }
    };

    function updateBulkFileCount() {
        var imageInput = document.getElementById('bulk_images');
        var videoInput = document.getElementById('bulk_videos');
        var countEl = document.getElementById('bulkFileCount');
        var imageCount = imageInput && imageInput.files ? imageInput.files.length : 0;
        var videoCount = videoInput && videoInput.files ? videoInput.files.length : 0;

        if (imageCount > 0 && videoCount > 0) {
            countEl.textContent = imageCount + ' image(s) and ' + videoCount + ' video(s) selected (upload one media type per batch)';
            countEl.style.display = 'block';
            return;
        }

        if (imageCount > 0) {
            countEl.textContent = imageCount + ' image' + (imageCount !== 1 ? 's' : '') + ' selected';
            if (imageCount > 50) countEl.textContent += ' (max 50)';
            countEl.style.display = 'block';
            return;
        }

        if (videoCount > 0) {
            countEl.textContent = videoCount + ' video' + (videoCount !== 1 ? 's' : '') + ' selected';
            if (videoCount > 10) countEl.textContent += ' (max 10)';
            countEl.style.display = 'block';
            return;
        }

        countEl.style.display = 'none';
    }

    var bulkImagesInput = document.getElementById('bulk_images');
    var bulkVideosInput = document.getElementById('bulk_videos');
    if (bulkImagesInput) bulkImagesInput.addEventListener('change', updateBulkFileCount);
    if (bulkVideosInput) bulkVideosInput.addEventListener('change', updateBulkFileCount);

    // Bulk upload form submit
    document.getElementById('bulkUploadForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var imageInput = document.getElementById('bulk_images');
        var videoInput = document.getElementById('bulk_videos');
        var category = document.getElementById('bulk_category').value;
        var videoItemType = (document.getElementById('bulk_video_item_type') || {}).value || 'video';
        if (!category) { showToast('Please select a category', 'error'); return; }

        var imageCount = imageInput && imageInput.files ? imageInput.files.length : 0;
        var videoCount = videoInput && videoInput.files ? videoInput.files.length : 0;

        if (imageCount > 0 && videoCount > 0) {
            showToast('Please upload either images or videos in one batch.', 'error');
            return;
        }

        if (imageCount === 0 && videoCount === 0) {
            showToast('Please select images or videos', 'error');
            return;
        }

        var mode = imageCount > 0 ? 'images' : 'videos';
        var files = Array.from(mode === 'images' ? imageInput.files : videoInput.files);
        var maxFiles = mode === 'images' ? 50 : 10;
        var mediaLabel = mode === 'images' ? 'image' : 'video';

        if (files.length > maxFiles) {
            showToast('Maximum ' + maxFiles + ' ' + mediaLabel + (maxFiles === 1 ? '' : 's') + ' allowed per upload.', 'error');
            return;
        }

        //  Client-side validation: file type + size 
        var allowedExts = mode === 'images'
            ? ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
            : ['mp4', 'webm', 'mov', 'avi'];
        var maxSingleMB = mode === 'images' ? 10 : 100;
        for (var vi = 0; vi < files.length; vi++) {
            var fname = files[vi].name.toLowerCase();
            var fext = fname.split('.').pop();
            if (allowedExts.indexOf(fext) === -1) {
                showToast(fname + ': Invalid type. Allowed: ' + allowedExts.join(', '), 'error');
                return;
            }
            if (files[vi].size > maxSingleMB * 1024 * 1024) {
                showToast(fname + ': Too large (' + (files[vi].size / 1024 / 1024).toFixed(1) + ' MB). Max ' + maxSingleMB + ' MB per ' + mediaLabel + '.', 'error');
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
        progressText.textContent = 'Uploading 0/' + files.length + ' ' + mediaLabel + '(s)...';
        var _portfolioProcessingTimer = null;
        var _portfolioUploadDone = false;

        //  Stall detection: abort if no progress for 60 seconds 
        // (Raised from 30s because server-side processing can be synchronous)
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
        if (mode === 'images') {
            for (var i = 0; i < files.length; i++) {
                fd.append('images', files[i]);
            }
        } else {
            for (var j = 0; j < files.length; j++) {
                fd.append('videos', files[j]);
            }
            fd.append('video_item_type', videoItemType);
        }

        var uploadUrl = BASE + '/portfolio/bulk-upload/';
        var xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl, true);
        var csrfToken = document.querySelector('[name=csrfmiddlewaretoken]');
        if (csrfToken) xhr.setRequestHeader('X-CSRFToken', csrfToken.value);
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        console.log('[Portfolio] Starting bulk upload to', uploadUrl, '| Mode:', mode, '| Files:', files.length, '| Total size:', Math.round(files.reduce(function(s,f){return s+f.size;},0) / 1024) + 'KB');

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
            progressText.textContent = 'Upload timed out  try smaller batches.';
            showToast('Upload timed out after 5 minutes. Try uploading fewer files at once.', 'error');
            btn.disabled = false;
        };

        // Phase 2: Upload done  server processing (80%  95%)
        xhr.upload.onloadend = function () {
            // CRITICAL: Reset stall timer so it doesn't fire during server processing
            _pfLastProgress = Date.now();
            progressBar.style.width = '80%';
            progressText.textContent = 'Processing ' + files.length + ' ' + mediaLabel + '(s) on server...';
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
                else if (xhr.status === 502 || xhr.status === 504) errMsg = 'Server timeout  try fewer files.';
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
        document.getElementById('cat_icon').value = 'fa-solid fa-folder';
        document.getElementById('cat_is_bento').checked = false;
        document.getElementById('cat_bento_size').value = 'normal';
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
            window.AdarshModalBridge.open('categoryModal', { overlayClass: 'show' });
        } else {
            document.getElementById('categoryModal').classList.add('show');
        }
    };
    window.closeCategoryModal = function () {
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
            window.AdarshModalBridge.close('categoryModal', { overlayClass: 'show' });
        } else {
            document.getElementById('categoryModal').classList.remove('show');
        }
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
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
            window.AdarshModalBridge.open('categoryModal', { overlayClass: 'show' });
        } else {
            document.getElementById('categoryModal').classList.add('show');
        }
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
