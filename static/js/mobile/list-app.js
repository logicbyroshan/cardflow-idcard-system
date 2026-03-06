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
        showCropModal: false,
        cropSourceUrl: null,
        cropSourceFile: null,
        cropperInstance: null,
        editMode: false,
        editingId: null,
        studentsData: typeof STUDENTS_DATA !== 'undefined' ? STUDENTS_DATA : [],
        hasMore: typeof HAS_MORE !== 'undefined' ? HAS_MORE : false,
        loadMoreOffset: typeof STUDENTS_DATA !== 'undefined' ? STUDENTS_DATA.length : 0,
        form: {
            name: '', fatherName: '', motherName: '', rollNo: '', dob: '',
            className: '', section: '', phone: '', address: '',
            bloodGroup: '', aadhar: '', photoFile: null, photoPreview: null,
        },

        init() {
            // Re-open edit form if we just returned from camera.html
            const camReturnEdit = sessionStorage.getItem('cam_return_edit');
            if (camReturnEdit) {
                sessionStorage.removeItem('cam_return_edit');
                const eid = parseInt(camReturnEdit, 10);
                if (eid) {
                    this.$nextTick(() => {
                        this.selectedIds = [eid];
                        this.editSelected();
                        this.showToast('Photo saved! Edit form re-opened.', 'success');
                    });
                }
            }
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
            // Sync classes for dynamically loaded rows
            document.querySelectorAll('tbody tr[data-sid]').forEach(tr => {
                this._updateRowClass(parseInt(tr.dataset.sid));
            });
        },
        toggleSelect(id) {
            const idx = this.selectedIds.indexOf(id);
            if (idx > -1) { this.selectedIds.splice(idx, 1); }
            else { this.selectedIds.push(id); }
            const visibleCount = document.querySelectorAll('tbody tr[data-sid]:not([style*="display: none"])').length;
            this.selectAll = this.selectedIds.length === visibleCount && visibleCount > 0;
            this._updateRowClass(id);
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

        _escHtml(s) {
            return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        },

        // Update class on a dynamically-added row (no Alpine :class binding)
        _updateRowClass(id) {
            const tr = document.querySelector(`tbody tr[data-sid="${id}"]`);
            if (!tr || tr.hasAttribute(':class') || tr.hasAttribute('x-bind:class')) return;
            const sel = this.selectedIds.includes(id);
            tr.classList.toggle('bg-indigo-50', sel);
            tr.classList.toggle('border-l-2', sel);
            tr.classList.toggle('border-l-brand-light', sel);
            tr.classList.toggle('hover:bg-gray-50', !sel);
            const cb = tr.querySelector('input[type=checkbox]');
            if (cb) cb.checked = sel;
        },

        // Build a <tr> DOM element for a dynamically loaded card
        _buildCardRow(card) {
            const isViewOnly = IS_VIEW_ONLY;
            const fd = card.field_data || {};

            const tr = document.createElement('tr');
            tr.setAttribute('data-sid', String(card.id));
            tr.className = 'transition-colors border-b border-gray-50';
            if (!isViewOnly) {
                tr.classList.add('cursor-pointer', 'hover:bg-gray-50');
                tr.addEventListener('click', (e) => {
                    if (e.target.closest('label, input')) return;
                    this.toggleSelect(card.id);
                });
            }

            // Checkbox td
            const tdCheck = document.createElement('td');
            tdCheck.className = 'px-2 py-2';
            if (!isViewOnly) {
                const lbl = document.createElement('label');
                lbl.className = 'custom-checkbox';
                lbl.addEventListener('click', e => e.stopPropagation());
                const inp = document.createElement('input');
                inp.type = 'checkbox';
                inp.addEventListener('change', () => this.toggleSelect(card.id));
                const span = document.createElement('span');
                span.className = 'checkmark';
                lbl.appendChild(inp);
                lbl.appendChild(span);
                tdCheck.appendChild(lbl);
            }
            tr.appendChild(tdCheck);

            // Sr no td
            const tdSr = document.createElement('td');
            tdSr.className = 'px-1 py-2 text-gray-400 font-medium text-center';
            tdSr.style.fontSize = '11px';
            tdSr.textContent = card.sr_no;
            tr.appendChild(tdSr);

            // Photo td
            const tdPhoto = document.createElement('td');
            tdPhoto.className = 'px-1 py-1.5';
            if (card.photo_url) {
                const img = document.createElement('img');
                img.src = card.photo_url;
                img.className = 'w-9 h-12 object-cover object-top border border-gray-100';
                img.style.borderRadius = '3px';
                img.alt = '';
                img.loading = 'lazy';
                const errDiv = document.createElement('div');
                errDiv.className = 'w-9 h-12 bg-red-50 flex items-center justify-center text-red-300';
                errDiv.style.cssText = 'border-radius:3px;font-size:9px;display:none;';
                errDiv.innerHTML = '<i class="fa-solid fa-image-slash"></i>';
                img.onerror = () => { img.style.display = 'none'; errDiv.style.display = 'flex'; };
                tdPhoto.appendChild(img);
                tdPhoto.appendChild(errDiv);
            } else {
                const noImg = document.createElement('div');
                noImg.className = 'w-9 h-12 bg-gray-100 flex items-center justify-center text-gray-300';
                noImg.style.cssText = 'border-radius:3px;font-size:9px;';
                noImg.innerHTML = '<i class="fa-solid fa-image"></i>';
                tdPhoto.appendChild(noImg);
            }
            tr.appendChild(tdPhoto);

            // Details td
            const tdDetails = document.createElement('td');
            tdDetails.className = 'px-2 py-2';
            const nameP = document.createElement('p');
            nameP.className = 'font-semibold text-gray-800 leading-tight';
            nameP.style.fontSize = '12px';
            nameP.textContent = card.name;
            tdDetails.appendChild(nameP);
            const detailsDiv = document.createElement('div');
            detailsDiv.className = 'flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5';
            for (const [key, val] of Object.entries(fd)) {
                if (!val) continue;
                const kl = key.toLowerCase();
                if (kl.includes('photo') || kl.includes('image') || kl === 'name') continue;
                const truncKey = key.length > 12 ? key.slice(0, 11) + '…' : key;
                const valStr = String(val);
                const truncVal = valStr.length > 16 ? valStr.slice(0, 15) + '…' : valStr;
                const sp = document.createElement('span');
                sp.className = 'text-gray-500';
                sp.style.cssText = 'font-size:10px;line-height:1.4;';
                sp.innerHTML = `<span class="font-semibold text-gray-600">${this._escHtml(truncKey)}:</span>&nbsp;${this._escHtml(truncVal)}`;
                detailsDiv.appendChild(sp);
            }
            tdDetails.appendChild(detailsDiv);
            tr.appendChild(tdDetails);
            return tr;
        },

        async loadMore() {
            if (this.loading || !this.hasMore) return;
            this.loading = true;
            try {
                const offset = this.loadMoreOffset;
                const page = Math.floor(offset / 50) + 1;
                const url = `/app/api/table/${TABLE_ID}/cards/?status=${LIST_TYPE}&per_page=50&page=${page}`;
                const res = await fetch(url, { headers: { 'X-CSRFToken': CSRF } });
                const json = await res.json();
                if (!json.success) { this.showToast('Failed to load more', 'error'); this.loading = false; return; }
                const apiData = json.data;
                const existingIds = new Set(this.studentsData.map(s => s.id));
                const rawCards = apiData.cards || [];
                const newCards = rawCards
                    .filter(c => !existingIds.has(c.id))
                    .map((c, i) => {
                        const f = c.field_data || {};
                        return {
                            id: c.id,
                            sr_no: offset + i + 1,
                            name: c.name || '',
                            roll_no: c.id_number || f['ROLL NO'] || f['ROLL_NO'] || f['roll_no'] || '',
                            father_name: f['FATHER NAME'] || f["FATHER'S NAME"] || f['FATHER_NAME'] || f['father_name'] || '',
                            mother_name: f['MOTHER NAME'] || f['MOTHER_NAME'] || f['mother_name'] || '',
                            class_name: c.class_designation || f['CLASS'] || f['class'] || '',
                            section: f['SECTION'] || f['section'] || '',
                            dob: f['DOB'] || f['dob'] || f['DATE OF BIRTH'] || f['DATE_OF_BIRTH'] || '',
                            photo_url: c.photo_url || null,
                            has_photo: !!c.photo_url,
                            status: c.status,
                            field_data: f,
                        };
                    });
                if (!newCards.length) {
                    this.hasMore = false;
                    this.showToast('All records loaded', 'info');
                    this.loading = false;
                    return;
                }
                this.studentsData.push(...newCards);
                this.loadMoreOffset += newCards.length;
                const tbody = document.querySelector('tbody');
                if (tbody) {
                    const emptyRow = tbody.querySelector('tr:not([data-sid])');
                    if (emptyRow) emptyRow.remove();
                    newCards.forEach(card => tbody.appendChild(this._buildCardRow(card)));
                }
                this.hasMore = apiData.has_more;
                if (!this.hasMore) this.showToast('All ' + this.studentsData.length + ' records loaded', 'info');
                else this.showToast('+' + newCards.length + ' loaded', 'success');
                this._applyAllFilters();
            } catch (e) { this.showToast('Load failed', 'error'); }
            this.loading = false;
        },

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
            if (this.editMode && this.editingId) {
                // Redirect to full camera.html — same as top-bar camera button
                sessionStorage.setItem('cam_return_edit', String(this.editingId));
                sessionStorage.setItem('cam_return_url', window.location.href);
                window.location.href = '/app/camera/' + TABLE_ID + '/' + this.editingId + '/';
            } else {
                // Add-new mode: use native camera input (no card_id yet)
                if (this.$refs.cameraInput) this.$refs.cameraInput.click();
                this.showImagePicker = false;
            }
        },
        pickFromGallery() {
            if (this.$refs.galleryInput) this.$refs.galleryInput.click();
            this.showImagePicker = false;
        },
        handleImageSelected(event) {
            const file = event.target.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) { this.showToast('Please select an image file', 'error'); return; }
            if (file.size > 10 * 1024 * 1024) { this.showToast('Image must be less than 10MB', 'error'); return; }
            this.cropSourceFile = file;
            const reader = new FileReader();
            reader.onload = (e) => {
                this.cropSourceUrl = e.target.result;
                this.showCropModal = true;
                this.$nextTick(() => this.initCropper());
            };
            reader.readAsDataURL(file);
            event.target.value = '';
        },
        initCropper() {
            const img = document.getElementById('crop-img-target');
            if (!img || typeof Cropper === 'undefined') return;
            if (this.cropperInstance) { this.cropperInstance.destroy(); this.cropperInstance = null; }
            this.cropperInstance = new Cropper(img, {
                aspectRatio: 3 / 4,
                viewMode: 1,
                dragMode: 'move',
                autoCropArea: 0.85,
                responsive: true,
                restore: false,
                background: false,
                movable: true,
                rotatable: true,
                scalable: false,
                zoomable: true,
                zoomOnTouch: true,
            });
        },
        cropAndUse() {
            if (!this.cropperInstance) { this.skipCrop(); return; }
            const canvas = this.cropperInstance.getCroppedCanvas({ width: 600, height: 800, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
            canvas.toBlob((blob) => {
                const fileName = (this.cropSourceFile && this.cropSourceFile.name) ? this.cropSourceFile.name : 'photo.jpg';
                const croppedFile = new File([blob], fileName, { type: 'image/jpeg' });
                this.form.photoFile = croppedFile;
                const reader = new FileReader();
                reader.onload = (e) => { this.form.photoPreview = e.target.result; };
                reader.readAsDataURL(croppedFile);
                this.closeCropModal();
            }, 'image/jpeg', 0.92);
        },
        skipCrop() {
            // Use original file without cropping
            this.form.photoFile = this.cropSourceFile;
            this.form.photoPreview = this.cropSourceUrl;
            this.closeCropModal();
        },
        closeCropModal() {
            if (this.cropperInstance) { this.cropperInstance.destroy(); this.cropperInstance = null; }
            this.showCropModal = false;
            this.cropSourceUrl = null;
            this.cropSourceFile = null;
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
        viewSelected() {
            if (!this.selectedIds.length) { this.showToast('Select an item first', 'error'); return; }
            if (this.selectedIds.length > 1) { this.showToast('Select only 1 item to view', 'error'); return; }
            window.location.href = '/app/card/' + this.selectedIds[0] + '/';
        },
        deleteSelected() { this.permanentlyDelete(); },
        verifySelected() { this.apiAction('verified', 'verified'); },
        approveSelected() { this.apiAction('approved', 'approved'); },
        unapproveSelected() { this.apiAction('verified', 'unapproved'); },
        async downloadPDF() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            this.showToast('Generating PDF…', 'info');
            try {
                const res = await fetch('/panel/exports/pdf/' + TABLE_ID + '/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                    body: JSON.stringify({ card_ids: this.selectedIds, status: LIST_TYPE }),
                });
                const ct = res.headers.get('content-type') || '';
                if (res.ok && ct.includes('application/pdf')) {
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'cards_' + TABLE_ID + '_' + LIST_TYPE + '.pdf';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    this.showToast('PDF downloaded!', 'success');
                } else {
                    const data = await res.json().catch(() => ({}));
                    this.showToast(data.message || 'PDF generation failed', 'error');
                }
            } catch (e) { this.showToast('PDF download failed', 'error'); }
        },
        async downloadIMG() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            this.showToast('Preparing images ZIP...', 'info');
            this.loading = true;
            try {
                const res = await fetch('/panel/api/table/' + TABLE_ID + '/cards/download-images/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                    body: JSON.stringify({ card_ids: this.selectedIds, status: LIST_TYPE }),
                });
                const data = await res.json();
                if (data.success && data.zip_files && data.zip_files.length > 0) {
                    // Download each ZIP file
                    for (const zipInfo of data.zip_files) {
                        const bin = atob(zipInfo.data);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        const blob = new Blob([bytes], { type: 'application/zip' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = zipInfo.filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }
                    this.showToast('Downloaded ' + data.total_images + ' images!', 'success');
                } else {
                    this.showToast(data.message || 'No images to download', 'error');
                }
            } catch (e) { this.showToast('Download failed', 'error'); }
            this.loading = false;
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
                this.showToast(success + ' card(s) deleted', 'success');
                setTimeout(() => location.reload(), 800);
            } else { this.showToast('Failed to delete cards', 'error'); }
            this.selectedIds = [];
        },
        retrieveSelected() { this.apiAction('pending', 'retrieved to pending'); },
    }
}
