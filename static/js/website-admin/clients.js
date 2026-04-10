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

    function setVisibilitySelectTheme(selectEl, value) {
        if (!selectEl) return;
        selectEl.classList.remove('status-visible', 'status-hidden');
        selectEl.classList.add(value === 'visible' ? 'status-visible' : 'status-hidden');
    }

    window.openClientModal = function (id) {
        if (!id) {
            showToast('Client not found.', 'error');
            return;
        }

        document.getElementById('clientModalTitle').textContent = 'Upload Client Logo';
        document.getElementById('clientForm').reset();
        document.getElementById('clientId').value = String(id);
        document.getElementById('cl_name').value = '';
        document.getElementById('cl_status').value = '';
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
                document.getElementById('clientModalTitle').textContent = c.logo ? 'Upload New Client Logo' : 'Upload Client Logo';
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
    window.openUploadClientLogo = function (id) { openClientModal(id); };

    window.removeClientLogo = async function (id, clientName) {
        if (!id) return;

        let ok = false;
        if (typeof waConfirm === 'function') {
            ok = await waConfirm({
                title: 'Remove Client Logo?',
                text: `Logo for ${clientName || 'this client'} will be removed from website assets.`,
                icon: 'fa-solid fa-trash',
                confirmLabel: 'Remove',
                btnClass: 'btn-danger',
            });
        } else {
            ok = window.confirm('Remove this client logo?');
        }
        if (!ok) return;

        const fd = new FormData();
        fd.set('remove_logo', 'true');

        ApiClient.upload(`${BASE}/clients/${id}/update/`, fd)
            .then(d => {
                if (d.success) {
                    showToast('Logo removed', 'success');
                    window.location.reload();
                } else {
                    showToast(d.message || 'Could not remove logo', 'error');
                }
            })
            .catch(() => showToast('Network error', 'error'));
    };

    window.setClientWebsiteVisibility = function (id, visibility, selectEl) {
        if (!id || !selectEl) return;
        const newValue = visibility === 'visible' ? 'visible' : 'hidden';
        const previous = selectEl.dataset.current || (newValue === 'visible' ? 'hidden' : 'visible');
        setVisibilitySelectTheme(selectEl, newValue);

        const fd = new FormData();
        fd.set('website_is_visible', newValue === 'visible' ? 'true' : 'false');

        ApiClient.upload(`${BASE}/clients/${id}/update/`, fd)
            .then(d => {
                if (d.success) {
                    selectEl.dataset.current = newValue;
                    showToast(`Client is now ${newValue} on landing page.`, 'success');
                } else {
                    selectEl.value = previous;
                    setVisibilitySelectTheme(selectEl, previous);
                    showToast(d.message || 'Could not update visibility', 'error');
                }
            })
            .catch(() => {
                selectEl.value = previous;
                setVisibilitySelectTheme(selectEl, previous);
                showToast('Network error', 'error');
            });
    };

    window.setClientWebsiteOrder = function (id, inputEl) {
        if (!id || !inputEl) return;

        const previousRaw = inputEl.dataset.currentOrder || '0';
        const previous = Number.parseInt(previousRaw, 10);
        const parsed = Number.parseInt(String(inputEl.value || '').trim(), 10);

        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9999) {
            inputEl.value = Number.isInteger(previous) ? String(previous) : '0';
            showToast('Order must be between 0 and 9999.', 'error');
            return;
        }

        inputEl.value = String(parsed);
        inputEl.disabled = true;

        const fd = new FormData();
        fd.set('website_display_order', String(parsed));

        ApiClient.upload(`${BASE}/clients/${id}/update/`, fd)
            .then(d => {
                if (d.success) {
                    inputEl.dataset.currentOrder = String(parsed);
                    showToast('Landing order updated.', 'success');
                } else {
                    inputEl.value = Number.isInteger(previous) ? String(previous) : '0';
                    showToast(d.message || 'Could not update order', 'error');
                }
            })
            .catch(() => {
                inputEl.value = Number.isInteger(previous) ? String(previous) : '0';
                showToast('Network error', 'error');
            })
            .finally(() => {
                inputEl.disabled = false;
            });
    };

    /* ===== FORM SUBMIT ===== */
    document.getElementById('clientForm').addEventListener('submit', function (e) {
        e.preventDefault();
        const id = document.getElementById('clientId').value;
        if (!id) {
            showToast('Client ID missing.', 'error');
            return;
        }

        const selectedLogo = document.getElementById('cl_logo').files;
        if (!selectedLogo || selectedLogo.length === 0) {
            showToast('Please select a logo image to upload.', 'error');
            return;
        }

        const fd = new FormData();
        fd.set('logo', selectedLogo[0]);

        const url = `${BASE}/clients/${id}/update/`;
        ApiClient.upload(url, fd)
            .then(d => {
                if (d.success) { showToast(d.message, 'success'); location.reload(); }
                else showToast(d.message || 'Error', 'error');
            })
            .catch(() => showToast('Network error', 'error'));
    });

    document.querySelectorAll('.client-visibility-select').forEach(function (selectEl) {
        const current = selectEl.value === 'visible' ? 'visible' : 'hidden';
        selectEl.dataset.current = current;
        setVisibilitySelectTheme(selectEl, current);
    });
})();
