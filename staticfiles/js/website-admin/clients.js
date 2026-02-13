/**
 * Website Admin — Clients Module
 * CRUD operations for Trusted Clients / Partners
 */
(function () {
    const BASE = '/panel/website/api';

    /* ===== MODAL ===== */

    window.openClientModal = function (id) {
        document.getElementById('clientModalTitle').textContent = id ? 'Edit Client' : 'Add Client';
        document.getElementById('clientForm').reset();
        document.getElementById('clientId').value = id || '';
        if (id) {
            fetch(`${BASE}/clients/${id}/`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                .then(r => r.json())
                .then(d => {
                    if (!d.success) return;
                    const c = d.client;
                    document.getElementById('cl_name').value = c.name || '';
                    document.getElementById('cl_order').value = c.order || 0;
                    document.getElementById('cl_active').checked = c.is_active;
                });
        }
        document.getElementById('clientModal').classList.add('show');
    };

    window.closeClientModal = function () {
        document.getElementById('clientModal').classList.remove('show');
    };

    window.editClient = function (id) { openClientModal(id); };

    /* ===== FORM SUBMIT ===== */
    document.getElementById('clientForm').addEventListener('submit', function (e) {
        e.preventDefault();
        const id = document.getElementById('clientId').value;
        const fd = new FormData(this);
        const url = id ? `${BASE}/clients/${id}/update/` : `${BASE}/clients/create/`;
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

    window.deleteClient = function (id) {
        if (!confirm('Delete this client?')) return;
        fetch(`${BASE}/clients/${id}/delete/`, {
            method: 'POST',
            headers: { 'X-CSRFToken': getCSRFToken(), 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(r => r.json())
            .then(d => { if (d.success) { showToast(d.message, 'success'); location.reload(); } else showToast(d.message, 'error'); })
            .catch(() => showToast('Network error', 'error'));
    };

    window.toggleClient = function (id, badge) {
        fetch(`${BASE}/clients/${id}/toggle/`, {
            method: 'POST',
            headers: { 'X-CSRFToken': getCSRFToken(), 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    badge.textContent = d.is_active ? 'Active' : 'Inactive';
                    badge.className = 'wa-status-badge ' + (d.is_active ? 'active' : 'inactive');
                }
            });
    };
})();
