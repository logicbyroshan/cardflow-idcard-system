/**
 * Website Admin  Reviews Module
 * CRUD operations for Testimonials / Reviews
 */
(function () {
    const BASE = '/website/api';

    /* ===== MODAL ===== */

    window.openReviewModal = function (id) {
        document.getElementById('reviewModalTitle').textContent = id ? 'Edit Review' : 'Add Review';
        document.getElementById('reviewForm').reset();
        document.getElementById('reviewId').value = id || '';
        if (id) {
            ApiClient.get(`${BASE}/reviews/${id}/`)
                .then(d => {
                    if (!d.success) return;
                    const r = d.review;
                    document.getElementById('rv_name').value = r.reviewer_name || '';
                    document.getElementById('rv_title').value = r.reviewer_title || '';
                    document.getElementById('rv_school').value = r.reviewer_school || '';
                    document.getElementById('rv_text').value = r.text || '';
                    document.getElementById('rv_tag').value = r.tag || '';
                    document.getElementById('rv_rating').value = r.rating || 5;
                    document.getElementById('rv_active').checked = r.is_active;
                });
        }
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
            window.AdarshModalBridge.open('reviewModal', { overlayClass: 'show' });
        } else {
            document.getElementById('reviewModal').classList.add('show');
        }
    };

    window.closeReviewModal = function () {
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
            window.AdarshModalBridge.close('reviewModal', { overlayClass: 'show' });
        } else {
            document.getElementById('reviewModal').classList.remove('show');
        }
    };

    window.editReview = function (id) { openReviewModal(id); };

    /* ===== FORM SUBMIT ===== */
    document.getElementById('reviewForm').addEventListener('submit', function (e) {
        e.preventDefault();
        const id = document.getElementById('reviewId').value;
        const fd = new FormData(this);
        const url = id ? `${BASE}/reviews/${id}/update/` : `${BASE}/reviews/create/`;
        if (!fd.has('is_active')) fd.append('is_active', 'false');
        else fd.set('is_active', 'true');
        ApiClient.upload(url, fd)
            .then(d => {
                if (d.success) { showToast(d.message, 'success'); location.reload(); }
                else showToast(d.message || 'Error', 'error');
            })
            .catch(() => showToast('Network error', 'error'));
    });

    /* ===== DELETE / TOGGLE ===== */

    window.deleteReview = async function (id) {
        const ok = await waConfirm({ title: 'Delete Review?', text: 'This review will be permanently removed.', icon: 'fa-solid fa-trash' });
        if (!ok) return;
        ApiClient.post(`${BASE}/reviews/${id}/delete/`)
            .then(d => { if (d.success) { showToast(d.message, 'success'); location.reload(); } else showToast(d.message, 'error'); })
            .catch(() => showToast('Network error', 'error'));
    };

    window.toggleReview = function (id, badge) {
        ApiClient.post(`${BASE}/reviews/${id}/toggle/`)
            .then(d => {
                if (d.success) {
                    badge.textContent = d.is_active ? 'Approved' : 'Pending';
                    badge.className = 'wa-status-badge ' + (d.is_active ? 'active' : 'pending');
                }
            });
    };
})();
