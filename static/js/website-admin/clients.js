/**
 * Website Admin — Clients Module
 * CRUD operations for Trusted Clients / Partners
 */
(function () {
    const BASE = '/website/api';

    /* ===== MODAL ===== */

    window.openClientModal = function (id) {
        document.getElementById('clientModalTitle').textContent = id ? 'Edit Client' : 'Add Client';
        document.getElementById('clientForm').reset();
        document.getElementById('clientId').value = id || '';
        if (id) {
            ApiClient.get(`${BASE}/clients/${id}/`)
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
        ApiClient.upload(url, fd)
            .then(d => {
                if (d.success) { showToast(d.message, 'success'); location.reload(); }
                else showToast(d.message || 'Error', 'error');
            })
            .catch(() => showToast('Network error', 'error'));
    });

    /* ===== DELETE / TOGGLE ===== */

    window.deleteClient = async function (id) {
        const ok = await waConfirm({ title: 'Delete Client?', text: 'This client will be permanently removed.', icon: 'fa-solid fa-trash' });
        if (!ok) return;
        ApiClient.post(`${BASE}/clients/${id}/delete/`)
            .then(d => { if (d.success) { showToast(d.message, 'success'); location.reload(); } else showToast(d.message, 'error'); })
            .catch(() => showToast('Network error', 'error'));
    };

    window.toggleClient = function (id, badge) {
        ApiClient.post(`${BASE}/clients/${id}/toggle/`)
            .then(d => {
                if (d.success) {
                    badge.textContent = d.is_active ? 'Active' : 'Inactive';
                    badge.className = 'wa-status-badge ' + (d.is_active ? 'active' : 'inactive');
                }
            });
    };
})();
