/**
 * list-app.js  Alpine.js component for mobile list page
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
        downloadModal: {
            show: false,
            state: 'preparing', // preparing | downloading | complete | error
            title: 'Preparing Download',
            subtitle: '',
            itemCount: 0,
            progress: -1, // -1 = indeterminate
            estimatedTime: '',
            sizeInfo: '',
            statusText: '',
            cancelling: false,
            abortController: null,
        },
        filters: { photo: 'all', selectedClass: '', selectedSection: '', dateFrom: '', dateTo: '' },
        filtersActive: false,
        classOptions: [],
        sectionOptions: [],
        classToSections: {},
        loadingAllForFilters: false,
        supportsInfiniteObserver: typeof window !== 'undefined' && 'IntersectionObserver' in window,
        infiniteObserver: null,
        scrollFallbackHandler: null,

        // Add/Edit Form state
        showAddForm: false,
        showImagePicker: false,
        showCropModal: false,
        cropSourceUrl: null,
        cropSourceFile: null,
        cropperInstance: null,
        viewMode: false,
        editMode: false,
        editingId: null,
        studentsData: typeof STUDENTS_DATA !== 'undefined' ? STUDENTS_DATA : [],
        hasMore: typeof HAS_MORE !== 'undefined' ? HAS_MORE : false,
        loadMoreOffset: typeof STUDENTS_DATA !== 'undefined' ? STUDENTS_DATA.length : 0,
        loadMorePage: 1,
        visibleCount: typeof STUDENTS_DATA !== 'undefined' ? STUDENTS_DATA.length : 0,
        allClassesRaw: (typeof ALL_CLASSES !== 'undefined' && Array.isArray(ALL_CLASSES)) ? ALL_CLASSES : [],
        allSectionsRaw: (typeof ALL_SECTIONS !== 'undefined' && Array.isArray(ALL_SECTIONS)) ? ALL_SECTIONS : [],
        allClassToSectionsRaw: (typeof ALL_CLASS_TO_SECTIONS !== 'undefined' && ALL_CLASS_TO_SECTIONS && typeof ALL_CLASS_TO_SECTIONS === 'object') ? ALL_CLASS_TO_SECTIONS : {},
        tableFields: Array.isArray(TABLE_FIELDS) ? TABLE_FIELDS : [],
        dynamicFormFields: [],
        tabCounts: TAB_COUNTS || { pending: 0, verified: 0, approved: 0, download: 0 },
        form: {
            dynamicValues: {},
            photoFile: null,
            photoPreview: null,
        },

        init() {
            this.rebuildClassSectionOptions();
            this._wirePhotoFallbacks(document);

            this.$nextTick(() => {
                this.initInfiniteLoader();
            });

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

            // Deep-link support from search page: ?focus_card=<id>
            const params = new URLSearchParams(window.location.search || '');
            const focusCardId = parseInt(params.get('focus_card') || '', 10);
            if (focusCardId) {
                this.$nextTick(() => {
                    this.focusCardById(focusCardId);
                });
            }
        },

        initInfiniteLoader() {
            const sentinel = document.getElementById('list-infinite-sentinel');
            const scrollRoot = document.getElementById('students-scroll');
            if (!sentinel || !scrollRoot) return;

            if (this.supportsInfiniteObserver) {
                if (this.infiniteObserver) this.infiniteObserver.disconnect();
                this.infiniteObserver = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting && this.hasMore && !this.loading) {
                            this.loadMore();
                        }
                    });
                }, {
                    root: scrollRoot,
                    rootMargin: '320px 0px 320px 0px',
                    threshold: 0.01,
                });
                this.infiniteObserver.observe(sentinel);
                return;
            }

            if (this.scrollFallbackHandler) {
                scrollRoot.removeEventListener('scroll', this.scrollFallbackHandler);
            }

            this.scrollFallbackHandler = () => {
                if (!this.hasMore || this.loading) return;
                const remaining = scrollRoot.scrollHeight - (scrollRoot.scrollTop + scrollRoot.clientHeight);
                if (remaining < 260) {
                    this.loadMore();
                }
            };
            scrollRoot.addEventListener('scroll', this.scrollFallbackHandler, { passive: true });
        },

        async focusCardById(cardId) {
            const maxBatches = 25;
            let attempts = 0;

            const findCardEl = () => document.querySelector('[data-sid="' + cardId + '"]');

            let target = findCardEl();
            while (!target && this.hasMore && attempts < maxBatches) {
                // Keep fetching more rows until target card is rendered.
                await this.loadMore();
                attempts += 1;
                target = findCardEl();
            }

            if (!target) {
                this.showToast('Searched card not found in this list', 'error');
                return;
            }

            target.scrollIntoView({ behavior: 'smooth', block: 'center' });

            target.classList.add('ring-2', 'ring-brand-light', 'ring-offset-2', 'bg-amber-50');
            setTimeout(() => {
                target.classList.remove('ring-2', 'ring-brand-light', 'ring-offset-2', 'bg-amber-50');
            }, 3500);
        },

        toggleSelectAll() {
            if (this.selectAll) {
                // Only select visible (non-hidden) rows
                const visible = [];
                document.querySelectorAll('[data-sid]').forEach(el => {
                    if (el.style.display !== 'none') visible.push(parseInt(el.getAttribute('data-sid')));
                });
                this.selectedIds = visible;
            } else { this.selectedIds = []; }
            // Sync classes for dynamically loaded rows
            document.querySelectorAll('[data-sid]').forEach(el => {
                this._updateRowClass(parseInt(el.dataset.sid));
            });
        },
        toggleSelect(id) {
            const idx = this.selectedIds.indexOf(id);
            if (idx > -1) { this.selectedIds.splice(idx, 1); }
            else { this.selectedIds.push(id); }
            const visibleCount = Array.from(document.querySelectorAll('[data-sid]')).filter(el => el.style.display !== 'none').length;
            this.selectAll = this.selectedIds.length === visibleCount && visibleCount > 0;
            this._updateRowClass(id);
        },

        // --- Filtering & Sorting ---
        filterStudents() {
            // Debounced text search  also applies active filters
            this._applyAllFilters();
        },
        setClassFilter(classValue) {
            this.filters.selectedClass = classValue || '';
            const sectionOptions = this.getSectionOptions();
            if (this.filters.selectedSection && !sectionOptions.includes(this.filters.selectedSection)) {
                this.filters.selectedSection = '';
            }
        },
        getSectionOptions() {
            if (!this.filters.selectedClass) return this.sectionOptions || [];
            return this.classToSections[this.filters.selectedClass] || [];
        },
        _normalizeClassValue(value) {
            const raw = String(value || '').trim();
            if (!raw) return '';

            const upper = raw.toUpperCase().replace(/\./g, '').replace(/\s+/g, '').replace(/_/g, '').replace(/-/g, '');
            const aliasMap = {
                'LKG': 'KG1',
                'KG1': 'KG1',
                'KGI': 'KG1',
                'KGI1': 'KG1',
                'UKG': 'KG2',
                'KG2': 'KG2',
                'KGII': 'KG2',
                'KGI2': 'KG2',
            };

            if (aliasMap[upper]) return aliasMap[upper];
            return raw.toUpperCase();
        },
        _formatClassDisplay(canonical) {
            if (canonical === 'KG1') return 'KG-I';
            if (canonical === 'KG2') return 'KG-II';
            return canonical;
        },
        rebuildClassSectionOptions() {
            if (this.allClassesRaw.length || this.allSectionsRaw.length || Object.keys(this.allClassToSectionsRaw || {}).length) {
                const classSet = new Set();
                const sectionSet = new Set();
                const classToSections = {};

                (this.allClassesRaw || []).forEach((cls) => {
                    const norm = this._normalizeClassValue(cls);
                    if (norm) classSet.add(norm);
                });

                (this.allSectionsRaw || []).forEach((sec) => {
                    const s = String(sec || '').trim();
                    if (s) sectionSet.add(s);
                });

                Object.keys(this.allClassToSectionsRaw || {}).forEach((rawCls) => {
                    const normCls = this._normalizeClassValue(rawCls);
                    if (!normCls) return;
                    if (!classToSections[normCls]) classToSections[normCls] = new Set();
                    const sections = Array.isArray(this.allClassToSectionsRaw[rawCls]) ? this.allClassToSectionsRaw[rawCls] : [];
                    sections.forEach((sec) => {
                        const s = String(sec || '').trim();
                        if (!s) return;
                        classToSections[normCls].add(s);
                        sectionSet.add(s);
                    });
                    classSet.add(normCls);
                });

                this.classOptions = Array.from(classSet)
                    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                    .map((v) => ({ value: v, label: this._formatClassDisplay(v) }));

                this.sectionOptions = Array.from(sectionSet)
                    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

                this.classToSections = {};
                Object.keys(classToSections).forEach((k) => {
                    this.classToSections[k] = Array.from(classToSections[k])
                        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                });

                if (this.filters.selectedClass && !classSet.has(this.filters.selectedClass)) {
                    this.filters.selectedClass = '';
                }

                const sectionOptions = this.getSectionOptions();
                if (this.filters.selectedSection && !sectionOptions.includes(this.filters.selectedSection)) {
                    this.filters.selectedSection = '';
                }
                return;
            }

            const classSet = new Set();
            const sectionSet = new Set();
            const classToSections = {};

            (this.studentsData || []).forEach((s) => {
                const cls = this._normalizeClassValue(s.class_name);
                const sec = String(s.section || '').trim();

                if (cls) {
                    classSet.add(cls);
                    if (!classToSections[cls]) classToSections[cls] = new Set();
                    if (sec) classToSections[cls].add(sec);
                }
                if (sec) sectionSet.add(sec);
            });

            this.classOptions = Array.from(classSet)
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                .map((v) => ({ value: v, label: this._formatClassDisplay(v) }));

            this.sectionOptions = Array.from(sectionSet)
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

            this.classToSections = {};
            Object.keys(classToSections).forEach((k) => {
                this.classToSections[k] = Array.from(classToSections[k])
                    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
            });

            if (this.filters.selectedClass && !classSet.has(this.filters.selectedClass)) {
                this.filters.selectedClass = '';
            }

            const sectionOptions = this.getSectionOptions();
            if (this.filters.selectedSection && !sectionOptions.includes(this.filters.selectedSection)) {
                this.filters.selectedSection = '';
            }
        },
        resetFilters() {
            this.filters = { photo: 'all', selectedClass: '', selectedSection: '', dateFrom: '', dateTo: '' };
            this.filtersActive = false;
            this.searchQuery = '';
            this._applyAllFilters();
        },
        async applyFilters() {
            this.filtersActive = (
                this.filters.photo !== 'all' ||
                this.filters.selectedClass !== '' ||
                this.filters.selectedSection !== '' ||
                this.filters.dateFrom !== '' ||
                this.filters.dateTo !== ''
            );

            if ((this.filtersActive || (this.searchQuery || '').trim()) && this.hasMore) {
                this.loadingAllForFilters = true;
                this.showToast('Loading all records for accurate filtering...', 'info');
                await this.loadAllDataForFiltering();
                this.loadingAllForFilters = false;
            }

            this._applyAllFilters();
            this.showFilters = false;
        },
        async loadAllDataForFiltering() {
            let safety = 0;
            while (this.hasMore && safety < 80) {
                await this.loadMore(true);
                safety += 1;
            }
        },
        _applyAllFilters() {
            const q = (this.searchQuery || '').toLowerCase().trim();
            let filtered = this.studentsData.filter(s => {
                // Text search
                if (q) {
                    const fieldDataText = Object.values(s.field_data || {})
                        .map(v => String(v || ''))
                        .join(' ')
                        .toLowerCase();
                    const text = [
                        s.name,
                        s.roll_no,
                        s.father_name,
                        s.mother_name,
                        s.class_name,
                        s.section,
                        s.dob,
                        s.id,
                        s.id_number,
                        fieldDataText,
                    ]
                        .map(v => String(v || ''))
                        .join(' ')
                        .toLowerCase();
                    if (!text.includes(q)) return false;
                }
                // Photo filter
                if (this.filters.photo === 'with' && !s.has_photo) return false;
                if (this.filters.photo === 'without' && s.has_photo) return false;
                // Class filter
                if (this.filters.selectedClass && this._normalizeClassValue(s.class_name) !== this.filters.selectedClass) return false;
                // Section filter
                if (this.filters.selectedSection && s.section !== this.filters.selectedSection) return false;
                // Date range (DOB)  only active for download list
                if (this.filters.dateFrom && s.dob && s.dob < this.filters.dateFrom) return false;
                if (this.filters.dateTo && s.dob && s.dob > this.filters.dateTo) return false;
                return true;
            });
            const visibleIds = new Set(filtered.map(s => s.id));
            // Handle both static div[data-sid] cards and dynamic tr[data-sid] rows
            const allCards = document.querySelectorAll('[data-sid]');
            if (!allCards.length) return;
            allCards.forEach(el => {
                const id = parseInt(el.getAttribute('data-sid'));
                el.style.display = visibleIds.has(id) ? '' : 'none';
            });
            // Deselect items that are no longer visible
            this.selectedIds = this.selectedIds.filter(id => visibleIds.has(id));
            // Update visible count
            this.visibleCount = filtered.length;
            // Show count
            if (q || this.filtersActive) {
                this.showToast(filtered.length + ' of ' + this.studentsData.length + ' shown', 'info');
            }
        },

        showToast(msg, type='info') { this.toast = { show: true, message: msg, type }; setTimeout(() => { this.toast.show = false; }, 2500); },

        // ========== Download Modal Methods ==========
        showDownloadModal(type, itemCount) {
            this.downloadModal = {
                show: true,
                state: 'preparing',
                title: type === 'pdf' ? 'Generating PDF' : 'Preparing Images',
                subtitle: 'Please wait while we prepare your download...',
                itemCount: itemCount,
                progress: -1,
                estimatedTime: this._estimateDownloadTime(itemCount, type),
                sizeInfo: '',
                statusText: type === 'pdf' ? 'Rendering cards...' : 'Compressing images...',
                cancelling: false,
                abortController: new AbortController(),
            };
        },

        _estimateDownloadTime(count, type) {
            // Rough estimate: PDF ~0.5s/card, IMG ~1s/card
            const secondsPerItem = type === 'pdf' ? 0.5 : 1;
            const totalSecs = Math.ceil(count * secondsPerItem);
            if (totalSecs < 60) return '~' + totalSecs + 's remaining';
            const mins = Math.floor(totalSecs / 60);
            const secs = totalSecs % 60;
            return '~' + mins + 'm ' + secs + 's remaining';
        },

        updateDownloadProgress(progress, statusText = null, sizeInfo = null) {
            if (!this.downloadModal.show) return;
            this.downloadModal.progress = progress;
            this.downloadModal.state = 'downloading';
            if (statusText) this.downloadModal.statusText = statusText;
            if (sizeInfo) this.downloadModal.sizeInfo = sizeInfo;
            // Update estimated time based on progress
            if (progress > 0 && progress < 100) {
                const remaining = Math.ceil((100 - progress) / 10);
                this.downloadModal.estimatedTime = '~' + remaining + 's remaining';
            } else if (progress >= 100) {
                this.downloadModal.estimatedTime = '';
            }
        },

        completeDownload(success, message = '') {
            if (!this.downloadModal.show) return;
            this.downloadModal.state = success ? 'complete' : 'error';
            this.downloadModal.title = success ? 'Download Complete!' : 'Download Failed';
            this.downloadModal.subtitle = message || (success ? 'Your file is ready.' : 'Something went wrong.');
            this.downloadModal.progress = success ? 100 : 0;
            this.downloadModal.statusText = '';
            this.downloadModal.estimatedTime = '';
            // Auto-close on success after 2.5s
            if (success) {
                setTimeout(() => { if (this.downloadModal.state === 'complete') this.closeDownloadModal(); }, 2500);
            }
        },

        cancelDownload() {
            if (this.downloadModal.abortController) {
                this.downloadModal.cancelling = true;
                this.downloadModal.statusText = 'Cancelling...';
                this.downloadModal.abortController.abort();
                setTimeout(() => {
                    this.closeDownloadModal();
                    this.showToast('Download cancelled', 'info');
                }, 300);
            } else {
                this.closeDownloadModal();
            }
        },

        closeDownloadModal() {
            this.downloadModal.show = false;
            this.downloadModal.abortController = null;
            this.downloadModal.cancelling = false;
        },
        // ========== End Download Modal Methods ==========

        _escHtml(s) {
            return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        },

        _normalizeFieldName(name) {
            return String(name || '').trim().toLowerCase();
        },

        _normalizeFieldType(fieldType) {
            const t = String(fieldType || 'text').trim().toLowerCase();
            return t === 'class_section' ? 'text' : t;
        },

        _isImageFieldType(fieldType) {
            const t = this._normalizeFieldType(fieldType);
            return ['photo', 'image', 'mother_photo', 'father_photo', 'signature', 'barcode', 'qr_code'].includes(t);
        },

        _isImageLikeFieldName(name) {
            const n = this._normalizeFieldName(name);
            if (!n) return false;
            return n.includes('photo') || n.includes('image') || n.includes('signature') || n.includes('barcode') || n.includes('qr');
        },

        _isRenderableFormField(field) {
            const name = String(field?.name || '').trim();
            if (!name || name.startsWith('__')) return false;
            return !this._isImageFieldType(field?.type);
        },

        _fieldLabel(name) {
            return String(name || '')
                .replace(/_/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        },

        _fieldInputType(field) {
            const t = this._normalizeFieldType(field?.type);
            if (t === 'number') return 'number';
            if (t === 'date') return 'date';
            if (t === 'textarea') return 'textarea';
            if (t === 'select') return 'select';
            return 'text';
        },

        _fieldOptions(field) {
            const raw = field?.options ?? field?.choices ?? field?.values ?? [];
            if (Array.isArray(raw)) {
                return raw.map((v) => String(v || '').trim()).filter(Boolean);
            }
            if (typeof raw === 'string') {
                return raw.split(',').map((v) => v.trim()).filter(Boolean);
            }
            return [];
        },

        _isClassField(field) {
            const n = this._normalizeFieldName(field?.name);
            return n === 'class' || n === 'class name' || n === 'class_name' || n === 'std' || n === 'standard' || n === 'designation';
        },

        _isSectionField(field) {
            const n = this._normalizeFieldName(field?.name);
            return n === 'section' || n === 'sec';
        },

        _buildDynamicFormFields(sourceFieldData, includeAllTableFields = true) {
            const source = sourceFieldData || {};
            const ordered = [];
            const used = new Set();
            const sourceLookupKeys = new Set(
                Object.keys(source || {}).map((k) => this._normalizeLookupKey(k))
            );

            (this.tableFields || []).forEach((f) => {
                if (!this._isRenderableFormField(f)) return;
                const name = String(f.name || '').trim();
                const lk = this._normalizeLookupKey(name);
                if (!lk || used.has(lk)) return;
                if (!includeAllTableFields && !sourceLookupKeys.has(lk)) return;
                ordered.push({
                    name,
                    type: this._normalizeFieldType(f.type),
                    mandatory: !!f.mandatory,
                    options: this._fieldOptions(f),
                });
                used.add(lk);
            });

            Object.keys(source).forEach((rawKey) => {
                const key = String(rawKey || '').trim();
                if (!key || key.startsWith('__') || this._isImageLikeFieldName(key)) return;
                const lk = this._normalizeLookupKey(key);
                if (!lk || used.has(lk)) return;
                ordered.push({
                    name: key,
                    type: 'text',
                    mandatory: false,
                    options: [],
                });
                used.add(lk);
            });

            return ordered;
        },

        _initDynamicForm(sourceFieldData, includeAllTableFields = true) {
            const source = sourceFieldData || {};
            this.dynamicFormFields = this._buildDynamicFormFields(source, includeAllTableFields);
            const values = {};
            this.dynamicFormFields.forEach((field) => {
                let val = this._getFieldValue(source, [field.name], '');
                if (this._fieldInputType(field) === 'date') {
                    val = this._normalizeDateForInput(val);
                }
                values[field.name] = val;
            });
            this.form.dynamicValues = values;
        },

        _summarizeCardFromFieldData(fieldData) {
            const fd = fieldData || {};
            return {
                name: this._resolveStudentName(fd, ''),
                roll_no: this._getFieldValue(fd, ['ROLL NO', 'ROLL_NO', 'roll_no', 'ID NUMBER', 'ID_NUMBER', 'id_number', 'SCH NO', 'SCH_NO', 'SCHOOL NO', 'SCHOOL_NO', 'ADMISSION NO', 'ADMISSION_NO'], ''),
                father_name: this._getFieldValue(fd, ['FATHER NAME', "FATHER'S NAME", 'FATHER_NAME', 'father_name'], ''),
                mother_name: this._getFieldValue(fd, ['MOTHER NAME', "MOTHER'S NAME", 'MOTHER_NAME', 'mother_name'], ''),
                class_name: this._getFieldValue(fd, ['CLASS', 'CLASS NAME', 'CLASS_NAME', 'STD', 'STANDARD', 'class', 'DESIGNATION', 'designation'], ''),
                section: this._getFieldValue(fd, ['SECTION', 'SEC', 'section'], ''),
                dob: this._normalizeDateForInput(this._getFieldValue(fd, ['DOB', 'DATE OF BIRTH', 'DATE_OF_BIRTH', 'dob'], '')),
            };
        },

        _normalizeLookupKey(name) {
            return String(name || '')
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '');
        },

        _getFieldValue(fd, aliases, fallbackValue = '') {
            const source = fd || {};
            const keys = Object.keys(source);
            const lookup = {};
            keys.forEach((k) => {
                lookup[this._normalizeLookupKey(k)] = source[k];
            });

            for (const alias of aliases || []) {
                const exact = source[alias];
                if (exact !== undefined && exact !== null && String(exact).trim() !== '') {
                    return String(exact);
                }
                const normalized = lookup[this._normalizeLookupKey(alias)];
                if (normalized !== undefined && normalized !== null && String(normalized).trim() !== '') {
                    return String(normalized);
                }
            }
            return String(fallbackValue || '');
        },

        _normalizeDateForInput(value) {
            const raw = String(value || '').trim();
            if (!raw) return '';

            // Already in input[type=date] format.
            if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

            // Common legacy formats from field_data: DD-MM-YYYY or DD/MM/YYYY.
            let m = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
            if (m) {
                const dd = String(m[1]).padStart(2, '0');
                const mm = String(m[2]).padStart(2, '0');
                return m[3] + '-' + mm + '-' + dd;
            }

            // Alternate format: YYYY/MM/DD.
            m = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
            if (m) {
                const mm = String(m[2]).padStart(2, '0');
                const dd = String(m[3]).padStart(2, '0');
                return m[1] + '-' + mm + '-' + dd;
            }

            return '';
        },

        _isExcludedField(name) {
            const n = this._normalizeFieldName(name);
            if (!n) return true;
            if (n.includes('photo') || n.includes('image')) return true;
            return ['name', 'class', 'section', 'designation'].includes(n);
        },

        _buildDisplayFieldsFromData(fd) {
            const source = fd || {};
            const hasDisplayValue = (val) => val !== null && val !== undefined && String(val).trim() !== '';
            const byLower = {};
            Object.entries(source).forEach(([k, v]) => {
                const lower = this._normalizeFieldName(k);
                if (!lower || byLower[lower]) return;
                byLower[lower] = { key: k, value: v };
            });

            const ordered = [];
            const used = new Set();

            (this.tableFields || []).forEach((f) => {
                const lower = this._normalizeFieldName(f?.name);
                if (!lower || used.has(lower) || this._isExcludedField(lower)) return;
                const item = byLower[lower];
                if (!item || !hasDisplayValue(item.value)) return;
                ordered.push(item);
                used.add(lower);
            });

            Object.entries(source).forEach(([k, v]) => {
                const lower = this._normalizeFieldName(k);
                if (!lower || used.has(lower) || this._isExcludedField(lower) || !hasDisplayValue(v)) return;
                ordered.push({ key: k, value: v });
                used.add(lower);
            });

            return ordered;
        },

        _resolveStudentName(fd, fallbackValue = '') {
            return this._getFieldValue(
                fd,
                [
                    'NAME',
                    'name',
                    'FULL NAME',
                    'FULL_NAME',
                    'STUDENT NAME',
                    'STUDENT_NAME',
                    'STUDENT',
                ],
                fallbackValue
            );
        },

        _statusPhotoBorderClasses(status) {
            if (status === 'pending') return 'border border-gray-100 border-t-2 border-b-2 border-t-amber-300 border-b-amber-300';
            if (status === 'verified') return 'border border-gray-100 border-t-2 border-b-2 border-t-green-300 border-b-green-300';
            if (status === 'approved') return 'border border-gray-100 border-t-2 border-b-2 border-t-blue-300 border-b-blue-300';
            if (status === 'download') return 'border border-gray-100 border-t-2 border-b-2 border-t-purple-300 border-b-purple-300';
            return 'border border-gray-200';
        },

        _bumpTabCounts(fromStatus, toStatus, n) {
            const count = Number(n || 0);
            if (!count || count < 1) return;
            if (fromStatus && this.tabCounts[fromStatus] !== undefined) {
                this.tabCounts[fromStatus] = Math.max(0, Number(this.tabCounts[fromStatus] || 0) - count);
            }
            if (toStatus && this.tabCounts[toStatus] !== undefined) {
                this.tabCounts[toStatus] = Number(this.tabCounts[toStatus] || 0) + count;
            }
        },

        // Update class on a dynamically-added row (no Alpine :class binding)
        _updateRowClass(id) {
            const el = document.querySelector(`[data-sid="${id}"]`);
            if (!el || el.hasAttribute(':class') || el.hasAttribute('x-bind:class')) return;
            const sel = this.selectedIds.includes(id);
            el.classList.toggle('bg-indigo-50', sel);
            el.classList.toggle('border-l-2', sel);
            el.classList.toggle('border-l-brand-light', sel);
            el.classList.toggle('hover:bg-gray-50', !sel);
            const cb = el.querySelector('input[type=checkbox]');
            if (cb) cb.checked = sel;
        },

        _reindexSerialNumbers() {
            // Keep in-memory serial numbers contiguous after in-place deletions.
            this.studentsData.forEach((s, i) => {
                s.sr_no = i + 1;
            });

            // If any legacy table rows exist, update their visible Sr No column.
            const rows = Array.from(document.querySelectorAll('tr[data-sid]'));
            rows.forEach((row, idx) => {
                const srCell = row.querySelector('td:nth-child(2)');
                if (srCell) srCell.textContent = String(idx + 1);
            });
        },

        _removeCardsFromCurrentList(idsToRemove) {
            const removeSet = new Set((idsToRemove || []).map(Number));
            if (!removeSet.size) return;

            // Remove from backing list state.
            this.studentsData = this.studentsData.filter(s => !removeSet.has(Number(s.id)));

            // Remove rendered nodes for both static and dynamically loaded cards/rows.
            document.querySelectorAll('[data-sid]').forEach(el => {
                const sid = Number(el.getAttribute('data-sid'));
                if (removeSet.has(sid)) el.remove();
            });

            // Clear selection for removed items and recompute selection flags.
            this.selectedIds = this.selectedIds.filter(id => !removeSet.has(Number(id)));
            this.selectAll = false;

            // Keep pagination/load counters and visible count in sync.
            this.loadMoreOffset = this.studentsData.length;
            this.visibleCount = this.studentsData.length;

            // Re-run filters to maintain visibility rules and counts.
            this.rebuildClassSectionOptions();
            this._reindexSerialNumbers();
            this._applyAllFilters();
        },

        _findStudentIndex(cardId) {
            return this.studentsData.findIndex(s => Number(s.id) === Number(cardId));
        },

        _mapCardDetailToStudent(detail, fallbackId = null) {
            const data = detail || {};
            const fd = data.field_data || {};
            const photoUrl = data.photo_url || null;
            return {
                id: Number(data.id || fallbackId || 0),
                sr_no: 0,
                name: String(this._resolveStudentName(fd, data.name || '')),
                roll_no: String(data.id_number || this._getFieldValue(fd, ['ROLL NO', 'ROLL_NO', 'roll_no', 'ID NUMBER', 'ID_NUMBER', 'id_number'])),
                father_name: String(data.father_name || this._getFieldValue(fd, ['FATHER NAME', "FATHER'S NAME", 'FATHER_NAME', 'father_name'])),
                mother_name: String(data.mother_name || this._getFieldValue(fd, ['MOTHER NAME', "MOTHER'S NAME", 'MOTHER_NAME', 'mother_name'])),
                class_name: String(data.class_designation || this._getFieldValue(fd, ['CLASS', 'class', 'DESIGNATION', 'designation'])),
                section: String(this._getFieldValue(fd, ['SECTION', 'section'])),
                dob: String(data.dob || this._getFieldValue(fd, ['DOB', 'DATE OF BIRTH', 'DATE_OF_BIRTH', 'dob'])),
                photo_url: photoUrl,
                photo_urls: photoUrl ? [photoUrl] : [],
                has_photo: !!photoUrl,
                status: String(data.status || LIST_TYPE),
                field_data: fd,
                display_fields: this._buildDisplayFieldsFromData(fd),
            };
        },

        async _fetchCardSnapshot(cardId) {
            const res = await fetch('/app/api/card/' + cardId + '/detail/', {
                method: 'GET',
                headers: { 'X-CSRFToken': CSRF },
            });
            const json = await res.json();
            if (!json.success || !json.data) {
                throw new Error(json.message || 'Unable to fetch latest card data');
            }
            return this._mapCardDetailToStudent(json.data, cardId);
        },

        _replaceRenderedCard(card) {
            if (!card || !card.id) return;
            const current = document.querySelector('[data-sid="' + card.id + '"]');
            if (!current) return;
            const replacement = this._buildCardDiv(card);
            current.parentNode.replaceChild(replacement, current);
            this._updateRowClass(card.id);
        },

        _appendRenderedCard(card) {
            if (!card || !card.id) return;
            const mountEl = document.getElementById('dynamic-cards-mount');
            if (mountEl) {
                mountEl.appendChild(this._buildCardDiv(card));
                return;
            }
            const existing = document.querySelector('[data-sid]');
            if (existing && existing.parentNode) {
                existing.parentNode.appendChild(this._buildCardDiv(card));
            }
        },

        _upsertStudentCard(card, mode) {
            if (!card || !card.id) return;
            const idx = this._findStudentIndex(card.id);
            if (idx > -1) {
                card.sr_no = this.studentsData[idx].sr_no || idx + 1;
                this.studentsData[idx] = card;
                this._replaceRenderedCard(card);
                this.rebuildClassSectionOptions();
                this._applyAllFilters();
                return;
            }
            if (mode !== 'add') return;
            card.sr_no = this.studentsData.length + 1;
            this.studentsData.push(card);
            this.loadMoreOffset = this.studentsData.length;
            this.visibleCount = this.studentsData.length;
            this._appendRenderedCard(card);
            this.rebuildClassSectionOptions();
            this._applyAllFilters();
        },

        _wirePhotoFallbacks(rootEl) {
            const root = rootEl || document;
            root.querySelectorAll('.js-card-photo').forEach((img) => {
                if (img.dataset.fallbackBound === '1') return;
                img.dataset.fallbackBound = '1';
                img.addEventListener('error', () => {
                    img.style.display = 'none';
                    const fallback = img.nextElementSibling;
                    if (fallback && fallback.classList.contains('js-card-photo-fallback')) {
                        fallback.style.display = 'flex';
                    }
                }, { once: true });
            });
        },

        // Build a <div> card element for a dynamically loaded card (loadMore)
        _buildCardDiv(card) {
            const fd = card.field_data || {};
            const photoBorderClass = this._statusPhotoBorderClasses(card.status);
            const noPhotoToneByStatus = {
                pending: 'bg-amber-50 text-amber-400',
                verified: 'bg-green-50 text-green-400',
                approved: 'bg-blue-50 text-blue-400',
                download: 'bg-purple-50 text-purple-400',
            };
            const noPhotoToneClass = noPhotoToneByStatus[card.status] || 'bg-gray-100 text-gray-300';

            const photoUrls = (card.photo_urls && card.photo_urls.length) ? card.photo_urls : (card.photo_url ? [card.photo_url] : []);
            const photoHtml = photoUrls.length
                ? photoUrls.map(url => `<div class="rounded-xl overflow-hidden ${photoBorderClass} w-full" style="height:68px;"><img src="${this._escHtml(url)}" class="js-card-photo w-full h-full object-cover object-top" alt="" loading="lazy"><div class="js-card-photo-fallback w-full h-full bg-amber-50 flex items-center justify-center text-amber-400" style="font-size:16px;display:none;"><i class="fa-solid fa-user-astronaut"></i></div></div>`).join('')
                : `<div class="rounded-xl overflow-hidden ${photoBorderClass} w-full" style="height:68px;"><div class="w-full h-full ${noPhotoToneClass} flex items-center justify-center" style="font-size:16px;"><i class="fa-solid fa-user-slash"></i></div></div>`;

            const displayFields = Array.isArray(card.display_fields) && card.display_fields.length
                ? card.display_fields
                : this._buildDisplayFieldsFromData(fd);
            const fieldRows = displayFields
                .map(item => `<span class="text-gray-400 font-semibold pr-1.5 whitespace-nowrap py-0.5" style="font-size:11px;">${this._escHtml(String(item.key))}</span><span class="text-gray-700 py-0.5" style="font-size:11px;">${this._escHtml(String(item.value))}</span>`)
                .join('');

            const classPill = (card.class_name || card.section)
                ? `<span class="inline-flex items-center gap-1 mt-1 text-[11px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-0.5 w-fit"><i class="fa-solid fa-graduation-cap text-[8px]"></i>${this._escHtml(card.class_name || '')}${card.class_name && card.section ? ' &bull; ' : ''}${this._escHtml(card.section || '')}</span>`
                : '';

            const nameHtml = card.name
                ? `<p class="font-bold text-gray-800 leading-tight" style="font-size:14px;">${this._escHtml(card.name)}</p>`
                : `<p class="font-semibold text-gray-300 leading-tight italic" style="font-size:13px;"></p>`;

            const cbHtml = !IS_VIEW_ONLY
                ? `<label class="custom-checkbox custom-checkbox-lg dyn-cb" style="cursor:pointer;"><input type="checkbox"><span class="checkmark"></span></label>`
                : '';

            const div = document.createElement('div');
            div.setAttribute('data-sid', String(card.id));
            div.className = 'bg-white rounded-2xl border border-gray-100 overflow-hidden transition-all shadow-sm hover:shadow-md';
            div.innerHTML = `<div class="flex gap-3 p-3"><div class="flex flex-col items-center gap-1.5 flex-shrink-0" style="width:56px;">${cbHtml}${photoHtml}</div><div class="flex-1 min-w-0 flex flex-col">${nameHtml}${classPill}<div class="mt-2"><div class="grid text-[11px] leading-snug" style="grid-template-columns:40% 1fr;">${fieldRows}</div></div><div class="mt-2.5"><a href="/app/card/${card.id}/" class="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-500 bg-indigo-50 border border-indigo-100 rounded-lg px-2.5 py-1 active:opacity-70 transition-all js-view-details" data-view-id="${card.id}">View Details <i class="fa-solid fa-arrow-right text-[9px]"></i></a></div></div></div>`;

            const viewLink = div.querySelector('.js-view-details');
            if (viewLink) {
                viewLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openViewById(card.id);
                });
            }

            if (!IS_VIEW_ONLY) {
                const cb = div.querySelector('input[type=checkbox]');
                if (cb) {
                    cb.addEventListener('change', (e) => { e.stopPropagation(); this.toggleSelect(card.id); });
                    cb.closest('label').addEventListener('click', e => e.stopPropagation());
                }
            }

            this._wirePhotoFallbacks(div);
            return div;
        },

        // Legacy <tr>-based row builder (kept for reference, no longer used by loadMore)
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
                const truncKey = key.length > 12 ? key.slice(0, 11) + '' : key;
                const valStr = String(val);
                const truncVal = valStr.length > 16 ? valStr.slice(0, 15) + '' : valStr;
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

        async loadMore(silent) {
            if (this.loading || !this.hasMore) return;
            this.loading = true;
            try {
                const page = this.loadMorePage + 1;
                const url = `/app/api/table/${TABLE_ID}/cards/?status=${LIST_TYPE}&per_page=50&page=${page}`;
                const res = await fetch(url, { headers: { 'X-CSRFToken': CSRF } });
                const json = await res.json();
                if (!json.success) { this.showToast('Failed to load more', 'error'); this.loading = false; return; }
                const apiData = json.data;
                const existingIds = new Set(this.studentsData.map(s => s.id));
                const rawCards = apiData.cards || [];
                this.loadMorePage = page;
                const newCards = rawCards
                    .filter(c => !existingIds.has(c.id))
                    .map((c, i) => {
                        const f = c.field_data || {};
                        return {
                            id: c.id,
                            sr_no: this.studentsData.length + i + 1,
                            name: this._resolveStudentName(f, c.name || ''),
                            roll_no: c.id_number || f['ROLL NO'] || f['ROLL_NO'] || f['roll_no'] || '',
                            father_name: f['FATHER NAME'] || f["FATHER'S NAME"] || f['FATHER_NAME'] || f['father_name'] || '',
                            mother_name: f['MOTHER NAME'] || f['MOTHER_NAME'] || f['mother_name'] || '',
                            class_name: c.class_designation || f['CLASS'] || f['class'] || '',
                            section: f['SECTION'] || f['section'] || '',
                            dob: f['DOB'] || f['dob'] || f['DATE OF BIRTH'] || f['DATE_OF_BIRTH'] || '',
                            photo_url: c.photo_url || null,
                            photo_urls: c.photo_url ? [c.photo_url] : [],
                            has_photo: !!c.photo_url,
                            status: c.status,
                            field_data: f,
                            display_fields: this._buildDisplayFieldsFromData(f),
                        };
                    });
                if (!newCards.length) {
                    // Keep pagination moving even if this page contained duplicate IDs.
                    this.hasMore = !!apiData.has_more;
                    this.loadMoreOffset += rawCards.length || 50;
                    if (!silent && !this.hasMore) this.showToast('All records loaded', 'info');
                    this.loading = false;
                    return;
                }
                this.studentsData.push(...newCards);
                this.loadMoreOffset += rawCards.length || newCards.length;
                const mountEl = document.getElementById('dynamic-cards-mount');
                if (mountEl) {
                    newCards.forEach(card => mountEl.appendChild(this._buildCardDiv(card)));
                }
                this.hasMore = apiData.has_more;
                if (!this.hasMore) {
                    if (!silent) this.showToast('All ' + this.studentsData.length + ' records loaded', 'info');
                } else if (!silent) {
                    this.showToast('+' + newCards.length + ' loaded', 'success');
                }
                this.rebuildClassSectionOptions();
                this._applyAllFilters();
            } catch (e) { this.showToast('Load failed', 'error'); }
            this.loading = false;
        },

        // --------- API helpers ---------
        async apiAction(status, label) {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            const actedIds = [...this.selectedIds];
            let keepSelected = [];
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
                    this.showToast(data.message || (actedIds.length + ' ' + label), 'success');

                    const skippedSet = new Set((data.skipped_ids || []).map(Number));
                    const movedIds = actedIds.filter(id => !skippedSet.has(Number(id)));
                    keepSelected = actedIds.filter(id => skippedSet.has(Number(id)));
                    const movedCount = movedIds.length;

                    // Update top badge counts immediately without waiting for reload.
                    if (status !== LIST_TYPE && movedCount > 0) {
                        this._bumpTabCounts(LIST_TYPE, status, movedCount);
                    }

                    // If status changed away from the current list, remove rows in-place.
                    if (status !== LIST_TYPE && movedCount > 0) {
                        this._removeCardsFromCurrentList(movedIds);
                    }
                } else {
                    this.showToast(data.message || 'Action failed', 'error');
                }
            } catch (e) { this.showToast(e.name === 'AbortError' ? 'Request timed out' : 'Network error', 'error'); }
            this.loading = false;
            this.selectedIds = keepSelected;
            document.querySelectorAll('[data-sid]').forEach(el => {
                this._updateRowClass(Number(el.getAttribute('data-sid')));
            });
        },

        // Add/Edit form methods
        addNew() {
            this.viewMode = false;
            this.editMode = false;
            this.editingId = null;
            this.resetForm();
            this.showAddForm = true;
            document.body.style.overflow = 'hidden';
        },
        populateFormFromStudent(student) {
            const fd = (student && student.field_data) || {};
            this._initDynamicForm(fd, false);
            this.form.photoFile = null;
            this.form.photoPreview = (student && student.photo_url) || null;
        },
        async openViewById(cardId) {
            const viewId = Number(cardId);
            let student = this.studentsData.find(s => Number(s.id) === viewId);
            if (!student) { this.showToast('Card not found in current list', 'error'); return; }

            try {
                const latestCard = await this._fetchCardSnapshot(viewId);
                this._upsertStudentCard(latestCard, 'edit');
                student = latestCard;
            } catch (e) {
                // Fall back to currently loaded list data if snapshot fetch fails.
            }

            this.selectedIds = [viewId];
            this.viewMode = true;
            this.editMode = false;
            this.editingId = null;
            this.populateFormFromStudent(student);
            this.showAddForm = true;
            document.body.style.overflow = 'hidden';
        },
        async editSelected() {
            if (!this.selectedIds.length) { this.showToast('Select a card first', 'error'); return; }
            const editId = this.selectedIds[0];
            let student = this.studentsData.find(s => Number(s.id) === Number(editId));
            if (!student) { this.showToast('Card not found', 'error'); return; }

            try {
                const latestCard = await this._fetchCardSnapshot(editId);
                this._upsertStudentCard(latestCard, 'edit');
                student = latestCard;
            } catch (e) {
                // Fall back to currently loaded list data if snapshot fetch fails.
            }

            this.viewMode = false;
            this.editMode = true;
            this.editingId = editId;
            this.populateFormFromStudent(student);
            this.showAddForm = true;
            document.body.style.overflow = 'hidden';
        },
        closeAddForm() {
            this.showAddForm = false;
            this.showImagePicker = false;
            this.viewMode = false;
            this.editMode = false;
            this.editingId = null;
            document.body.style.overflow = '';
        },
        resetForm() {
            this.form = {
                dynamicValues: {},
                photoFile: null,
                photoPreview: null,
            };
            this._initDynamicForm({});
            this.showImagePicker = false;
        },
        openImagePicker() {
            if (this.viewMode) return;
            this.showImagePicker = !this.showImagePicker;
        },
        takePhoto() {
            if (this.viewMode) return;
            if (this.editMode && this.editingId) {
                // Redirect to full camera.html  same as top-bar camera button
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
            if (this.viewMode) return;
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
            if (this.viewMode) {
                this.closeAddForm();
                return;
            }
            this.loading = true;
            const url = this.editMode
                ? '/app/api/table/' + TABLE_ID + '/card/' + this.editingId + '/update/'
                : '/app/api/table/' + TABLE_ID + '/card/add/';
            const fd = new FormData();
            const fieldData = {};
            Object.entries(this.form.dynamicValues || {}).forEach(([key, value]) => {
                if (value === null || value === undefined) return;
                fieldData[key] = String(value).trim();
            });

            const missingMandatory = (this.dynamicFormFields || []).find((field) => {
                if (!field.mandatory) return false;
                const val = fieldData[field.name];
                return String(val || '').trim() === '';
            });
            if (missingMandatory) {
                this.showToast(this._fieldLabel(missingMandatory.name) + ' is required', 'error');
                this.loading = false;
                return;
            }

            const hasNameField = (this.dynamicFormFields || []).some((field) => {
                const n = this._normalizeFieldName(field.name);
                return n === 'name' || n.includes('name');
            });
            const resolvedName = this._resolveStudentName(fieldData, '').trim();
            if (hasNameField && !resolvedName) {
                this.showToast('Name is required', 'error');
                this.loading = false;
                return;
            }

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
                    const cardId = this.editMode ? this.editingId : data.card_id;

                    if (cardId) {
                        try {
                            const latestCard = await this._fetchCardSnapshot(cardId);
                            if (latestCard.status === LIST_TYPE) {
                                this._upsertStudentCard(latestCard, this.editMode ? 'edit' : 'add');
                            } else if (this.editMode) {
                                // If edited card moved to a different status, remove from current list.
                                this._removeCardsFromCurrentList([cardId]);
                            }
                        } catch (snapshotErr) {
                            const summary = this._summarizeCardFromFieldData(fieldData);
                            if (this.editMode) {
                                // Fall back to in-memory update when snapshot endpoint fails.
                                const idx = this._findStudentIndex(cardId);
                                if (idx > -1) {
                                    const existing = this.studentsData[idx];
                                    const mergedFieldData = Object.assign({}, existing.field_data || {}, fieldData);
                                    const fallbackCard = Object.assign({}, existing, {
                                        name: summary.name,
                                        roll_no: summary.roll_no,
                                        father_name: summary.father_name,
                                        mother_name: summary.mother_name,
                                        class_name: summary.class_name,
                                        section: summary.section,
                                        dob: summary.dob,
                                        field_data: mergedFieldData,
                                        display_fields: this._buildDisplayFieldsFromData(mergedFieldData),
                                    });
                                    this._upsertStudentCard(fallbackCard, 'edit');
                                }
                            } else if (LIST_TYPE === 'pending' && cardId) {
                                const fallbackSummary = this._summarizeCardFromFieldData(fieldData);
                                const fallbackFieldData = Object.assign({}, fieldData);
                                const fallbackCard = {
                                    id: Number(cardId),
                                    sr_no: this.studentsData.length + 1,
                                    name: fallbackSummary.name,
                                    roll_no: fallbackSummary.roll_no,
                                    father_name: fallbackSummary.father_name,
                                    mother_name: fallbackSummary.mother_name,
                                    class_name: fallbackSummary.class_name,
                                    section: fallbackSummary.section,
                                    dob: fallbackSummary.dob,
                                    photo_url: this.form.photoPreview || null,
                                    photo_urls: this.form.photoPreview ? [this.form.photoPreview] : [],
                                    has_photo: !!this.form.photoPreview,
                                    status: 'pending',
                                    field_data: fallbackFieldData,
                                    display_fields: this._buildDisplayFieldsFromData(fallbackFieldData),
                                };
                                this._upsertStudentCard(fallbackCard, 'add');
                            }
                        }

                        if (!this.editMode) {
                            this.tabCounts.pending = Number(this.tabCounts.pending || 0) + 1;
                        }
                    }

                    this.closeAddForm();
                } else { this.showToast(data.message || 'Failed', 'error'); }
            } catch (e) { this.showToast('Network error', 'error'); }
            this.loading = false;
        },

        // List action methods  wired to real APIs
        viewSelected() {
            if (!this.selectedIds.length) { this.showToast('Select an item first', 'error'); return; }
            if (this.selectedIds.length > 1) { this.showToast('Select only 1 item to view', 'error'); return; }
            this.openViewById(this.selectedIds[0]);
        },
        async deleteSelected() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            var ok = await showConfirm({
                title: 'Move To Pool?',
                text: 'Move ' + this.selectedIds.length + ' card(s) to pool? You can retrieve them later.',
                icon: 'fa-solid fa-box-archive',
                confirmLabel: 'Move To Pool',
                hideWarning: true,
            });
            if (!ok) return;
            this.apiAction('pool', 'moved to pool');
        },
        verifySelected() { this.apiAction('verified', 'verified'); },
        approveSelected() { this.apiAction('approved', 'approved'); },
        unapproveSelected() { this.apiAction('verified', 'unapproved'); },
        async downloadPDF() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            this.showDownloadModal('pdf', this.selectedIds.length);
            try {
                const pollTask = async (taskId) => {
                    for (let i = 0; i < 300; i++) {
                        if (this.downloadModal.abortController?.signal?.aborted) {
                            throw new Error('AbortError');
                        }
                        const statusRes = await fetch('/api/export/status/' + taskId + '/', {
                            headers: { 'X-CSRFToken': CSRF },
                            signal: this.downloadModal.abortController?.signal,
                        });
                        const statusData = await statusRes.json().catch(() => ({}));

                        if (statusData.state === 'completed' && statusData.download_url) {
                            this.updateDownloadProgress(95, 'Saving file...');
                            const a = document.createElement('a');
                            a.href = statusData.download_url;
                            a.download = statusData.filename || ('cards_' + TABLE_ID + '_' + LIST_TYPE + '.pdf');
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            this.completeDownload(true, 'PDF saved to your device');
                            return;
                        }

                        if (statusData.state === 'failed') {
                            this.completeDownload(false, statusData.message || 'PDF generation failed');
                            return;
                        }

                        const p = Math.max(10, Math.min(90, Number(statusData.progress || 0)));
                        this.updateDownloadProgress(p, statusData.message || 'Generating PDF...');
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    this.completeDownload(false, 'PDF generation timed out');
                };

                this.updateDownloadProgress(10, 'Sending request...');
                const res = await fetch('/panel/exports/pdf/' + TABLE_ID + '/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                    body: JSON.stringify({ card_ids: this.selectedIds, status: LIST_TYPE }),
                    signal: this.downloadModal.abortController?.signal,
                });
                this.updateDownloadProgress(50, 'Processing PDF...');
                const ct = res.headers.get('content-type') || '';
                if (res.ok && ct.includes('application/pdf')) {
                    this.updateDownloadProgress(70, 'Downloading file...');
                    const blob = await res.blob();
                    const sizeKB = Math.round(blob.size / 1024);
                    this.updateDownloadProgress(90, 'Saving file...', sizeKB > 1024 ? (sizeKB/1024).toFixed(1) + ' MB' : sizeKB + ' KB');
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'cards_' + TABLE_ID + '_' + LIST_TYPE + '.pdf';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    this.completeDownload(true, 'PDF saved to your device');
                } else if ((res.status === 202 || res.ok) && ct.includes('application/json')) {
                    const data = await res.json().catch(() => ({}));
                    if (data.success && data.async && data.task_id) {
                        this.updateDownloadProgress(20, data.message || 'Queued for background generation...');
                        await pollTask(data.task_id);
                    } else {
                        this.completeDownload(false, data.message || 'PDF generation failed');
                    }
                } else {
                    const data = await res.json().catch(() => ({}));
                    this.completeDownload(false, data.message || 'PDF generation failed');
                }
            } catch (e) {
                if (e.name === 'AbortError' || e.message === 'AbortError') return; // Cancelled by user
                this.completeDownload(false, 'PDF download failed');
            }
        },
        async downloadIMG() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            this.showDownloadModal('img', this.selectedIds.length);
            try {
                this.updateDownloadProgress(10, 'Preparing images...');
                const res = await fetch('/panel/api/table/' + TABLE_ID + '/cards/download-images/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                    body: JSON.stringify({ card_ids: this.selectedIds, status: LIST_TYPE }),
                    signal: this.downloadModal.abortController?.signal,
                });
                this.updateDownloadProgress(40, 'Processing response...');
                const data = await res.json();
                const zipFiles = (Array.isArray(data.files) && data.files.length > 0)
                    ? data.files
                    : (Array.isArray(data.zip_files) && data.zip_files.length > 0)
                        ? data.zip_files
                        : (data.download_url ? [{
                            download_url: data.download_url,
                            filename: data.filename || 'images.zip'
                        }] : []);

                if (data.success && zipFiles.length > 0) {
                    const totalZips = zipFiles.length;
                    let downloaded = 0;
                    // Download each ZIP file
                    for (const zipInfo of zipFiles) {
                        const progress = 40 + Math.round((downloaded / totalZips) * 50);
                        this.updateDownloadProgress(progress, 'Downloading ' + (downloaded + 1) + ' of ' + totalZips + '...');
                        const a = document.createElement('a');
                        document.body.appendChild(a);

                        if (zipInfo.download_url) {
                            a.href = zipInfo.download_url;
                            a.download = zipInfo.filename || 'images.zip';
                            a.click();
                        } else if (zipInfo.data) {
                            const bin = atob(zipInfo.data);
                            const bytes = new Uint8Array(bin.length);
                            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                            const blob = new Blob([bytes], { type: 'application/zip' });
                            const url = URL.createObjectURL(blob);
                            a.href = url;
                            a.download = zipInfo.filename || 'images.zip';
                            a.click();
                            URL.revokeObjectURL(url);
                        } else {
                            throw new Error('Missing image file payload');
                        }

                        document.body.removeChild(a);
                        downloaded++;
                    }
                    const totalSize = zipFiles.reduce((sum, z) => sum + (z.data?.length || 0) * 0.75, 0);
                    const sizeKB = Math.round(totalSize / 1024);
                    this.completeDownload(true, 'Downloaded ' + data.total_images + ' images (' + (sizeKB > 1024 ? (sizeKB/1024).toFixed(1) + ' MB' : sizeKB + ' KB') + ')');
                } else {
                    this.completeDownload(false, data.message || 'No images to download');
                }
            } catch (e) {
                if (e.name === 'AbortError') return; // Cancelled by user
                this.completeDownload(false, 'Download failed');
            }
        },
        downloadAgain() { this.apiAction('download', 're-downloaded'); },
        async permanentlyDelete() {
            if (LIST_TYPE !== 'pool') {
                this.deleteSelected();
                return;
            }
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            var ok = await showConfirm({ title: 'Permanently Delete?', text: 'Permanently delete ' + this.selectedIds.length + ' card(s)? This cannot be undone!', icon: 'fa-solid fa-trash', confirmLabel: 'Delete', hideWarning: true });
            if (!ok) return;
            const requestedIds = [...this.selectedIds];
            const deletedIds = [];
            this.loading = true;
            let success = 0, failed = 0;
            for (const id of requestedIds) {
                try {
                    const res = await fetch('/app/api/card/' + id + '/delete/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                        body: JSON.stringify({ permanent: true }),
                    });
                    const data = await res.json();
                    if (data.success) {
                        success++;
                        deletedIds.push(id);
                    } else failed++;
                } catch (e) { failed++; }
            }
            this.loading = false;
            if (success > 0) {
                this.showToast(success + ' card(s) deleted', 'success');

                this._bumpTabCounts(LIST_TYPE, null, success);

                // Remove deleted rows immediately without page reload.
                this._removeCardsFromCurrentList(deletedIds);
            } else { this.showToast('Failed to delete cards', 'error'); }
            this.selectedIds = [];
        },
        retrieveSelected() { this.apiAction('pending', 'retrieved to pending'); },
    }
}
