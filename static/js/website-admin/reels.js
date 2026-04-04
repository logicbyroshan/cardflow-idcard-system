/**
 * Reels Admin  CRUD
 * v1.0
 */
(function () {
    const API = window.API_BASE_URL || '/website/';
    const csrf = document.querySelector('[name=csrfmiddlewaretoken]')?.value;

    /*  Modal helpers  */
    function openReelModal(data) {
        const modal = document.getElementById('reelModal');
        document.getElementById('reelModalTitle').textContent = data ? 'Edit Reel' : 'Add Reel';
        document.getElementById('reelId').value = data?.id || '';
        document.getElementById('rl_title').value = data?.title || '';
        document.getElementById('rl_order').value = data?.order ?? 0;
        document.getElementById('rl_active').checked = data ? !!data.is_active : true;
        document.getElementById('rl_video').value = '';
        document.getElementById('rl_thumbnail').value = '';
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.open === 'function') {
            window.AdarshModalBridge.open('reelModal', { overlayClass: 'show' });
        } else if (modal) {
            modal.classList.add('show');
        }
    }
    window.openReelModal = function (data) { openReelModal(data); };

    function closeReelModal() {
        if (window.AdarshModalBridge && typeof window.AdarshModalBridge.close === 'function') {
            window.AdarshModalBridge.close('reelModal', { overlayClass: 'show' });
        } else {
            document.getElementById('reelModal').classList.remove('show');
        }
        document.getElementById('reelForm').reset();
    }
    window.closeReelModal = closeReelModal;

    /*  Edit  */
    window.editReel = async function (id) {
        try {
            const res = await fetch(API + 'api/reels/' + id + '/', {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (!res.ok) { window.showToast?.('Error loading reel (HTTP ' + res.status + ')', 'error'); return; }
            const json = await res.json();
            if (json.success) openReelModal(json.reel);
            else window.showToast?.(json.message || 'Error loading reel', 'error');
        } catch { window.showToast?.('Network error', 'error'); }
    };

    /*  Toggle  */
    window.toggleReel = async function (id, el) {
        try {
            const res = await fetch(API + 'api/reels/' + id + '/toggle/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (!res.ok) { window.showToast?.('Toggle failed (HTTP ' + res.status + ')', 'error'); return; }
            const json = await res.json();
            if (json.success) {
                el.textContent = json.is_active ? 'Active' : 'Inactive';
                el.className = 'wa-status-badge ' + (json.is_active ? 'active' : 'inactive');
            } else window.showToast?.(json.message || 'Toggle failed', 'error');
        } catch { window.showToast?.('Network error', 'error'); }
    };

    /*  Delete  */
    window.deleteReel = async function (id) {
        const yes = await window.waConfirm({
            title: 'Delete Reel?',
            text: 'This will permanently remove the reel and its files.',
            confirmLabel: 'Delete',
            btnClass: 'btn-danger',
            icon: 'fa-solid fa-trash'
        });
        if (!yes) return;
        try {
            const res = await fetch(API + 'api/reels/' + id + '/delete/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (!res.ok) { window.showToast?.('Delete failed (HTTP ' + res.status + ')', 'error'); return; }
            const json = await res.json();
            if (json.success) {
                const row = document.querySelector('#reelsBody tr[data-id="' + id + '"]');
                if (row) row.remove();
                window.showToast?.('Reel deleted', 'success');
                updateCount();
            } else window.showToast?.(json.message || 'Delete failed', 'error');
        } catch { window.showToast?.('Network error', 'error'); }
    };

    /*  Save (create / update)  */
    document.getElementById('reelForm')?.addEventListener('submit', async function (e) {
        e.preventDefault();
        const id = document.getElementById('reelId').value;
        const fd = new FormData(this);
        fd.set('is_active', document.getElementById('rl_active').checked ? 'true' : 'false');

        const url = id ? API + 'api/reels/' + id + '/update/' : API + 'api/reels/create/';
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' },
                body: fd
            });
            if (!res.ok) { window.showToast?.('Save failed (HTTP ' + res.status + ')', 'error'); return; }
            const json = await res.json();
            if (json.success) {
                window.showToast?.(json.message || 'Saved', 'success');
                closeReelModal();
                location.reload();
            } else window.showToast?.(json.message || 'Save failed', 'error');
        } catch { window.showToast?.('Network error', 'error'); }
    });

    /*  Helpers  */
    function updateCount() {
        const badge = document.querySelector('.wa-count-badge');
        if (badge) {
            const rows = document.querySelectorAll('#reelsBody tr[data-id]').length;
            badge.textContent = rows + ' reel' + (rows !== 1 ? 's' : '');
        }
    }

    /* Close modal on backdrop click */
    document.getElementById('reelModal')?.addEventListener('click', function (e) {
        if (e.target === this) closeReelModal();
    });
})();
