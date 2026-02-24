/**
 * list-app.js — Alpine.js component for mobile list page
 * Globals expected: CSRF, TABLE_ID, LIST_TYPE, ALL_STUDENT_IDS, TOTAL_COUNT, STUDENTS_DATA
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

        // Add/Edit Form state
        showAddForm: false,
        showImagePicker: false,
        editMode: false,
        editingId: null,
        studentsData: STUDENTS_DATA,
        form: {
            name: '', fatherName: '', motherName: '', rollNo: '', dob: '',
            className: '', section: '', phone: '', address: '',
            bloodGroup: '', aadhar: '', photoFile: null, photoPreview: null,
        },

        toggleSelectAll() {
            if (this.selectAll) {
                this.selectedIds = [...ALL_STUDENT_IDS];
            } else { this.selectedIds = []; }
        },
        toggleSelect(id) {
            const idx = this.selectedIds.indexOf(id);
            if (idx > -1) { this.selectedIds.splice(idx, 1); }
            else { this.selectedIds.push(id); }
            this.selectAll = this.selectedIds.length === TOTAL_COUNT;
        },
        filterStudents() {
            const q = this.searchQuery.toLowerCase();
            document.querySelectorAll('tbody tr').forEach(tr => {
                const text = tr.textContent.toLowerCase();
                tr.style.display = (!q || text.includes(q)) ? '' : 'none';
            });
        },
        resetFilters() { this.filters = { photo: 'all', sort: 'name_asc', selectedClass: '', selectedSection: '', dateFrom: '', dateTo: '' }; this.filterStudents(); },
        applyFilters() { this.showToast('Filters applied', 'info'); this.showFilters = false; },
        showToast(msg, type='info') { this.toast = { show: true, message: msg, type }; setTimeout(() => { this.toast.show = false; }, 2500); },

        // --------- API helpers ---------
        async apiAction(status, label) {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            this.loading = true;
            try {
                const res = await fetch('/app/api/table/' + TABLE_ID + '/bulk-status/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                    body: JSON.stringify({ card_ids: this.selectedIds, status: status }),
                });
                const data = await res.json();
                if (data.success) {
                    this.showToast(data.message || (this.selectedIds.length + ' ' + label), 'success');
                    setTimeout(() => location.reload(), 800);
                } else {
                    this.showToast(data.message || 'Action failed', 'error');
                }
            } catch (e) { this.showToast('Network error', 'error'); }
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
            this.editMode = true;
            this.editingId = editId;
            this.form = {
                name: student.name || '',
                fatherName: student.father_name || '',
                motherName: student.mother_name || '',
                rollNo: student.roll_no || '',
                dob: student.dob || '',
                className: student.class_name || '',
                section: student.section || '',
                phone: student.phone || '',
                address: student.address || '',
                bloodGroup: student.blood_group || '',
                aadhar: student.aadhar || '',
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
        takePhoto() { this.$refs.cameraInput.click(); this.showImagePicker = false; },
        pickFromGallery() { this.$refs.galleryInput.click(); this.showImagePicker = false; },
        handleImageSelected(event) {
            const file = event.target.files[0];
            if (!file) return;
            this.form.photoFile = file;
            const reader = new FileReader();
            reader.onload = (e) => { this.form.photoPreview = e.target.result; };
            reader.readAsDataURL(file);
            event.target.value = '';
        },
        async submitAddForm() {
            if (!this.form.name.trim()) { this.showToast('Name is required', 'error'); return; }
            const url = this.editMode
                ? '/panel/client/api/table/' + TABLE_ID + '/card/' + this.editingId + '/update/'
                : '/panel/client/api/table/' + TABLE_ID + '/card/add/';
            const fd = new FormData();
            const fieldData = {
                'NAME': this.form.name,
                'FATHER NAME': this.form.fatherName,
                'MOTHER NAME': this.form.motherName,
                'ROLL NO': this.form.rollNo,
                'DOB': this.form.dob,
                'CLASS': this.form.className,
                'SECTION': this.form.section,
                'PHONE': this.form.phone,
                'ADDRESS': this.form.address,
                'BLOOD GROUP': this.form.bloodGroup,
                'AADHAR': this.form.aadhar,
            };
            fd.append('field_data', JSON.stringify(fieldData));
            if (this.form.photoFile) fd.append('photo', this.form.photoFile);
            try {
                const res = await fetch(url, { method: 'POST', headers: { 'X-CSRFToken': CSRF }, body: fd });
                const data = await res.json();
                if (data.success) {
                    this.showToast(data.message || (this.editMode ? 'Updated!' : 'Added!'), 'success');
                    this.closeAddForm();
                    setTimeout(() => location.reload(), 800);
                } else { this.showToast(data.message || 'Failed', 'error'); }
            } catch (e) { this.showToast('Network error', 'error'); }
        },

        // List action methods — wired to real APIs
        deleteSelected() { this.apiAction('pool', 'moved to pool'); },
        verifySelected() { this.apiAction('verified', 'verified'); },
        approveSelected() { this.apiAction('approved', 'approved'); },
        unapproveSelected() { this.apiAction('verified', 'unapproved'); },
        downloadPDF() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            this.showToast('Generating PDF...', 'info');
            window.open('/panel/exports/pdf/?table_id=' + TABLE_ID + '&status=' + LIST_TYPE + '&ids=' + this.selectedIds.join(','), '_blank');
        },
        downloadIMG() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            this.showToast('Downloading images...', 'info');
            window.open('/panel/exports/images/?table_id=' + TABLE_ID + '&ids=' + this.selectedIds.join(','), '_blank');
        },
        downloadAgain() { this.apiAction('download', 're-downloaded'); },
        permanentlyDelete() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            if (!confirm('Permanently delete ' + this.selectedIds.length + ' card(s)?')) return;
            this.apiAction('pool', 'deleted');
        },
        retrieveSelected() { this.apiAction('pending', 'retrieved to pending'); },
    }
}
