/**
 * Website Admin — Reviews Module
 * CRUD operations for Testimonials / Reviews
 */
(function () {
    const BASE = '/panel/website/api';

    /* ===== MODAL ===== */

    window.openReviewModal = function (id) {
        document.getElementById('reviewModalTitle').textContent = id ? 'Edit Review' : 'Add Review';
        document.getElementById('reviewForm').reset();
        document.getElementById('reviewId').value = id || '';
        if (id) {
            fetch(`${BASE}/reviews/${id}/`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                .then(r => r.json())
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
        document.getElementById('reviewModal').classList.add('show');
    };

    window.closeReviewModal = function () {
        document.getElementById('reviewModal').classList.remove('show');
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
        fetch(url, {
            method: 'POST',
            headers: { 'X-CSRFToken': getCSRFToken(), 'X-Requested-With': 'XMLHttpRequest' },
            body: fd
        })
            .then(r => r.json())
            .then(d => {
                if (d.success) { showToast(d.message, 'success'); location.reload(); }
                else showToast(d.message || 'Error', 'error');
            })
            .catch(() => showToast('Network error', 'error'));
    });

    /* ===== DELETE / TOGGLE ===== */

    window.deleteReview = function (id) {
        if (!confirm('Delete this review?')) return;
        fetch(`${BASE}/reviews/${id}/delete/`, {
            method: 'POST',
            headers: { 'X-CSRFToken': getCSRFToken(), 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(r => r.json())
            .then(d => { if (d.success) { showToast(d.message, 'success'); location.reload(); } else showToast(d.message, 'error'); })
            .catch(() => showToast('Network error', 'error'));
    };

    window.toggleReview = function (id, badge) {
        fetch(`${BASE}/reviews/${id}/toggle/`, {
            method: 'POST',
            headers: { 'X-CSRFToken': getCSRFToken(), 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    badge.textContent = d.is_active ? 'Approved' : 'Pending';
                    badge.className = 'wa-status-badge ' + (d.is_active ? 'active' : 'pending');
                }
            });
    };
})();
