/**
 * list-app.js — Alpine.js component for mobile list page
 * Globals expected: CSRF, TABLE_ID, LIST_TYPE, STUDENTS_DATA
 */
function listApp() {
    return {
        searchQuery: '',
        showFilters: false,
        selectAll: false,
        selectedIds: [],
        loading: false,
        toast: { show: false, message: '', type: 'info' },
        filters: { photo: 'all', sort: 'name_asc', selectedClass: '', selectedSection: '', dateFrom: '', dateTo: '' },
        filtersActive: false,

        // Add/Edit Form state
        showAddForm: false,
        showImagePicker: false,
        editMode: false,
        editingId: null,
        studentsData: typeof STUDENTS_DATA !== 'undefined' ? STUDENTS_DATA : [],
        form: {
            name: '', fatherName: '', motherName: '', rollNo: '', dob: '',
            className: '', section: '', phone: '', address: '',
            bloodGroup: '', aadhar: '', photoFile: null, photoPreview: null,
        },

        toggleSelectAll() {
            if (this.selectAll) {
                // Only select visible (non-hidden) rows
                const visible = [];
                document.querySelectorAll('tbody tr[data-sid]').forEach(tr => {
                    if (tr.style.display !== 'none') visible.push(parseInt(tr.getAttribute('data-sid')));
                });
                this.selectedIds = visible;
            } else { this.selectedIds = []; }
        },
        toggleSelect(id) {
            const idx = this.selectedIds.indexOf(id);
            if (idx > -1) { this.selectedIds.splice(idx, 1); }
            else { this.selectedIds.push(id); }
            const visibleCount = document.querySelectorAll('tbody tr[data-sid]:not([style*="display: none"])').length;
            this.selectAll = this.selectedIds.length === visibleCount && visibleCount > 0;
        },

        // --- Filtering & Sorting ---
        filterStudents() {
            // Debounced text search — also applies active filters
            this._applyAllFilters();
        },
        resetFilters() {
            this.filters = { photo: 'all', sort: 'name_asc', selectedClass: '', selectedSection: '', dateFrom: '', dateTo: '' };
            this.filtersActive = false;
            this.searchQuery = '';
            this._applyAllFilters();
        },
        applyFilters() {
            this.filtersActive = (
                this.filters.photo !== 'all' ||
                this.filters.selectedClass !== '' ||
                this.filters.selectedSection !== '' ||
                this.filters.dateFrom !== '' ||
                this.filters.dateTo !== '' ||
                this.filters.sort !== 'name_asc'
            );
            this._applyAllFilters();
            this.showFilters = false;
        },
        _applyAllFilters() {
            const q = (this.searchQuery || '').toLowerCase().trim();
            let filtered = this.studentsData.filter(s => {
                // Text search
                if (q) {
                    const text = ((s.name||'') + ' ' + (s.roll_no||'') + ' ' + (s.father_name||'') + ' ' + (s.class_name||'') + ' ' + (s.section||'')).toLowerCase();
                    if (!text.includes(q)) return false;
                }
                // Photo filter
                if (this.filters.photo === 'with' && !s.has_photo) return false;
                if (this.filters.photo === 'without' && s.has_photo) return false;
                // Class filter
                if (this.filters.selectedClass && s.class_name !== this.filters.selectedClass) return false;
                // Section filter
                if (this.filters.selectedSection && s.section !== this.filters.selectedSection) return false;
                // Date range (DOB)
                if (this.filters.dateFrom && s.dob && s.dob < this.filters.dateFrom) return false;
                if (this.filters.dateTo && s.dob && s.dob > this.filters.dateTo) return false;
                return true;
            });
            // Sorting
            filtered.sort((a, b) => {
                switch (this.filters.sort) {
                    case 'name_asc': return (a.name||'').localeCompare(b.name||'');
                    case 'name_desc': return (b.name||'').localeCompare(a.name||'');
                    case 'roll_asc': return (a.roll_no||'').localeCompare(b.roll_no||'', undefined, {numeric:true});
                    case 'roll_desc': return (b.roll_no||'').localeCompare(a.roll_no||'', undefined, {numeric:true});
                    case 'date_new': return ((b.dob||'') > (a.dob||'')) ? 1 : -1;
                    case 'date_old': return ((a.dob||'') > (b.dob||'')) ? 1 : -1;
                    default: return 0;
                }
            });
            const visibleIds = new Set(filtered.map(s => s.id));
            const tbody = document.querySelector('tbody');
            if (!tbody) return;
            const rows = tbody.querySelectorAll('tr[data-sid]');
            // Show/hide
            rows.forEach(tr => {
                const id = parseInt(tr.getAttribute('data-sid'));
                tr.style.display = visibleIds.has(id) ? '' : 'none';
            });
            // Reorder DOM to match sort
            const rowMap = {};
            rows.forEach(r => { rowMap[r.getAttribute('data-sid')] = r; });
            filtered.forEach(s => { if (rowMap[s.id]) tbody.appendChild(rowMap[s.id]); });
            // Append hidden rows at end
            rows.forEach(r => { if (!visibleIds.has(parseInt(r.getAttribute('data-sid')))) tbody.appendChild(r); });
            // Deselect items that are no longer visible
            this.selectedIds = this.selectedIds.filter(id => visibleIds.has(id));
            // Show count
            if (q || this.filtersActive) {
                this.showToast(filtered.length + ' of ' + this.studentsData.length + ' shown', 'info');
            }
        },

        showToast(msg, type='info') { this.toast = { show: true, message: msg, type }; setTimeout(() => { this.toast.show = false; }, 2500); },

        // --------- API helpers ---------
        async apiAction(status, label) {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            this.loading = true;
            var _ac = new AbortController();
            setTimeout(function() { _ac.abort(); }, 120000);
            try {
                const res = await fetch('/app/api/table/' + TABLE_ID + '/bulk-status/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                    body: JSON.stringify({ card_ids: this.selectedIds, status: status }),
                    signal: _ac.signal,
                });
                if (!res.ok && !(res.headers.get('content-type') || '').includes('application/json')) {
                    this.showToast('Server error (' + res.status + ')', 'error');
                    this.loading = false;
                    return;
                }
                const data = await res.json();
                if (data.success) {
                    this.showToast(data.message || (this.selectedIds.length + ' ' + label), 'success');
                    setTimeout(() => location.reload(), 800);
                } else {
                    this.showToast(data.message || 'Action failed', 'error');
                }
            } catch (e) { this.showToast(e.name === 'AbortError' ? 'Request timed out' : 'Network error', 'error'); }
            this.loading = false;
            this.selectedIds = [];
        },

        // Add/Edit form methods
        addNew() {
            this.editMode = false;
            this.editingId = null;
            this.resetForm();
            this.showAddForm = true;
            document.body.style.overflow = 'hidden';
        },
        editSelected() {
            if (!this.selectedIds.length) { this.showToast('Select a card first', 'error'); return; }
            const editId = this.selectedIds[0];
            const student = this.studentsData.find(s => s.id === editId);
            if (!student) { this.showToast('Card not found', 'error'); return; }
            const fd = student.field_data || {};
            this.editMode = true;
            this.editingId = editId;
            this.form = {
                name: student.name || '',
                fatherName: fd['FATHER NAME'] || fd["FATHER'S NAME"] || fd['FATHER_NAME'] || fd['father_name'] || student.father_name || '',
                motherName: fd['MOTHER NAME'] || fd["MOTHER'S NAME"] || fd['MOTHER_NAME'] || fd['mother_name'] || '',
                rollNo: student.roll_no || '',
                dob: student.dob || '',
                className: student.class_name || '',
                section: student.section || '',
                phone: fd['PHONE'] || fd['MOBILE'] || fd['MOBILE NO'] || fd['phone'] || '',
                address: fd['ADDRESS'] || fd['PERMANENT ADDRESS'] || fd['address'] || '',
                bloodGroup: fd['BLOOD GROUP'] || fd['blood_group'] || '',
                aadhar: fd['AADHAR'] || fd['AADHAAR'] || fd['AADHAR NO'] || fd['aadhar'] || '',
                photoFile: null,
                photoPreview: student.photo_url || null,
            };
            this.showAddForm = true;
            document.body.style.overflow = 'hidden';
        },
        closeAddForm() {
            this.showAddForm = false;
            this.showImagePicker = false;
            this.editMode = false;
            this.editingId = null;
            document.body.style.overflow = '';
        },
        resetForm() {
            this.form = {
                name: '', fatherName: '', motherName: '', rollNo: '', dob: '',
                className: '', section: '', phone: '', address: '',
                bloodGroup: '', aadhar: '', photoFile: null, photoPreview: null,
            };
            this.showImagePicker = false;
        },
        openImagePicker() { this.showImagePicker = !this.showImagePicker; },
        takePhoto() {
            if (this.$refs.cameraInput) this.$refs.cameraInput.click();
            this.showImagePicker = false;
        },
        pickFromGallery() {
            if (this.$refs.galleryInput) this.$refs.galleryInput.click();
            this.showImagePicker = false;
        },
        handleImageSelected(event) {
            const file = event.target.files[0];
            if (!file) return;
            // Validate file type and size
            if (!file.type.startsWith('image/')) { this.showToast('Please select an image file', 'error'); return; }
            if (file.size > 10 * 1024 * 1024) { this.showToast('Image must be less than 10MB', 'error'); return; }
            this.form.photoFile = file;
            const reader = new FileReader();
            reader.onload = (e) => { this.form.photoPreview = e.target.result; };
            reader.readAsDataURL(file);
            event.target.value = '';
        },
        async submitAddForm() {
            if (!this.form.name.trim()) { this.showToast('Name is required', 'error'); return; }
            this.loading = true;
            const url = this.editMode
                ? '/app/api/table/' + TABLE_ID + '/card/' + this.editingId + '/update/'
                : '/app/api/table/' + TABLE_ID + '/card/add/';
            const fd = new FormData();
            const fieldData = {
                'NAME': this.form.name.trim(),
                'FATHER NAME': this.form.fatherName.trim(),
                'MOTHER NAME': this.form.motherName.trim(),
                'ROLL NO': this.form.rollNo.trim(),
                'DOB': this.form.dob,
                'CLASS': this.form.className,
                'SECTION': this.form.section,
                'PHONE': this.form.phone.trim(),
                'ADDRESS': this.form.address.trim(),
                'BLOOD GROUP': this.form.bloodGroup,
                'AADHAR': this.form.aadhar.trim(),
            };
            fd.append('field_data', JSON.stringify(fieldData));
            if (this.form.photoFile) fd.append('photo', this.form.photoFile);
            try {
                var _ac2 = new AbortController();
                setTimeout(function() { _ac2.abort(); }, 120000);
                const res = await fetch(url, { method: 'POST', headers: { 'X-CSRFToken': CSRF }, body: fd, signal: _ac2.signal });
                if (!res.ok && !(res.headers.get('content-type') || '').includes('application/json')) {
                    this.showToast('Server error (' + res.status + ')', 'error');
                    this.loading = false;
                    return;
                }
                const data = await res.json();
                if (data.success) {
                    this.showToast(data.message || (this.editMode ? 'Updated!' : 'Added!'), 'success');
                    this.closeAddForm();
                    setTimeout(() => location.reload(), 800);
                } else { this.showToast(data.message || 'Failed', 'error'); }
            } catch (e) { this.showToast('Network error', 'error'); }
            this.loading = false;
        },

        // List action methods — wired to real APIs
        deleteSelected() { this.apiAction('pool', 'moved to pool'); },
        verifySelected() { this.apiAction('verified', 'verified'); },
        approveSelected() { this.apiAction('approved', 'approved'); },
        unapproveSelected() { this.apiAction('verified', 'unapproved'); },
        downloadPDF() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            this.showToast('Generating PDF...', 'info');
            window.open('/panel/api/table/' + TABLE_ID + '/cards/download-pdf/?status=' + LIST_TYPE + '&ids=' + this.selectedIds.join(','), '_blank');
        },
        downloadIMG() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            this.showToast('Downloading images...', 'info');
            window.open('/panel/api/table/' + TABLE_ID + '/cards/download-images/?ids=' + this.selectedIds.join(','), '_blank');
        },
        downloadAgain() { this.apiAction('download', 're-downloaded'); },
        async permanentlyDelete() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            if (!confirm('Permanently delete ' + this.selectedIds.length + ' card(s)? This cannot be undone!')) return;
            this.loading = true;
            let success = 0, failed = 0;
            for (const id of this.selectedIds) {
                try {
                    const res = await fetch('/app/api/card/' + id + '/delete/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                        body: JSON.stringify({ permanent: true }),
                    });
                    const data = await res.json();
                    if (data.success) success++; else failed++;
                } catch (e) { failed++; }
            }
            this.loading = false;
            if (success > 0) {
                this.showToast(success + ' card(s) permanently deleted', 'success');
                setTimeout(() => location.reload(), 800);
            } else { this.showToast('Failed to delete cards', 'error'); }
            this.selectedIds = [];
        },
        retrieveSelected() { this.apiAction('pending', 'retrieved to pending'); },
    }
}
