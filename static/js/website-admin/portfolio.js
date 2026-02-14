/**
 * Website Admin — Portfolio Module (v2)
 * CRUD for Portfolio items + Category management
 */
(function () {
    const BASE = '/panel/website/api';

    /* ================================================================
       PORTFOLIO ITEM — MODAL
    ================================================================ */
    window.toggleMediaFields = function () {
        const type = document.getElementById('pf_item_type').value;
        document.getElementById('videoFields').style.display = (type === 'video' || type === 'reel') ? '' : 'none';
    };

    window.openPortfolioModal = function (id) {
        document.getElementById('portfolioModalTitle').textContent = id ? 'Edit Portfolio Item' : 'Add Portfolio Item';
        document.getElementById('portfolioForm').reset();
        document.getElementById('portfolioId').value = id || '';
        document.getElementById('videoFields').style.display = 'none';
        if (id) {
            ApiClient.get(`${BASE}/portfolio/${id}/`)
                .then(d => {
                    if (!d.success) return;
                    const p = d.item;
                    document.getElementById('pf_category').value = p.category_id || '';
                    document.getElementById('pf_item_type').value = p.item_type || 'image';
                    document.getElementById('pf_orientation').value = p.orientation || '';
                    document.getElementById('pf_order').value = p.order || 0;
                    document.getElementById('pf_video_url').value = p.video_url || '';
                    document.getElementById('pf_active').checked = p.is_active;
                    document.getElementById('pf_featured').checked = p.is_featured;
                    toggleMediaFields();
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
    window.deletePortfolio = function (id) {
        if (!confirm('Delete this portfolio item?')) return;
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

    window.deleteCategory = function (id) {
        if (!confirm('Delete this category? Items will keep their content but lose category assignment.')) return;
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
