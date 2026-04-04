/**
 * Website Admin  Clients Module
 * Logo updates for panel clients (names/details managed from Manage Clients)
 */
(function () {
    const BASE = '/website/api';

    /* ===== MODAL ===== */

    function setLogoPreview(logoUrl) {
        const preview = document.getElementById('cl_logo_preview');
        if (!preview) return;
        if (logoUrl) {
            preview.innerHTML = `<img src="${logoUrl}" alt="Current client logo">`;
        } else {
            preview.innerHTML = '<span>No logo uploaded</span>';
        }
    }

    window.openClientModal = function (id) {
        if (!id) {
            showToast('Client not found.', 'error');
            return;
        }

        document.getElementById('clientModalTitle').textContent = 'Update Client Logo';
        document.getElementById('clientForm').reset();
        document.getElementById('clientId').value = String(id);
        document.getElementById('cl_name').value = '';
        document.getElementById('cl_status').value = '';
        document.getElementById('cl_remove_logo').checked = false;
        setLogoPreview('');

        ApiClient.get(`${BASE}/clients/${id}/`)
            .then(d => {
                if (!d.success || !d.client) {
                    showToast(d.message || 'Failed to load client.', 'error');
                    return;
                }
                const c = d.client;
                document.getElementById('cl_name').value = c.name || '';
                document.getElementById('cl_status').value = c.status_display || c.status || '';
                setLogoPreview(c.logo || '');
            })
            .catch(() => {
                showToast('Network error', 'error');
            });

        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
            window.AdarshModalBridge.open('clientModal', { overlayClass: 'show' });
        } else {
            document.getElementById('clientModal').classList.add('show');
        }
    };

    window.closeClientModal = function () {
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
            window.AdarshModalBridge.close('clientModal', { overlayClass: 'show' });
        } else {
            document.getElementById('clientModal').classList.remove('show');
        }
    };

    window.editClient = function (id) { openClientModal(id); };

    /* ===== FORM SUBMIT ===== */
    document.getElementById('clientForm').addEventListener('submit', function (e) {
        e.preventDefault();
        const id = document.getElementById('clientId').value;
        if (!id) {
            showToast('Client ID missing.', 'error');
            return;
        }

        const fd = new FormData(this);
        const removeLogo = document.getElementById('cl_remove_logo').checked;
        if (removeLogo) {
            fd.set('remove_logo', 'true');
        } else {
            fd.delete('remove_logo');
        }

        const selectedLogo = document.getElementById('cl_logo').files;
        if (!removeLogo && (!selectedLogo || selectedLogo.length === 0)) {
            showToast('Select a logo file or choose remove logo.', 'error');
            return;
        }

        const url = `${BASE}/clients/${id}/update/`;
        ApiClient.upload(url, fd)
            .then(d => {
                if (d.success) { showToast(d.message, 'success'); location.reload(); }
                else showToast(d.message || 'Error', 'error');
            })
            .catch(() => showToast('Network error', 'error'));
    });
})();
