/**
 * list-app.js  Alpine.js component for mobile list page
 * Globals expected: CSRF, TABLE_ID, LIST_TYPE, STUDENTS_DATA
 */
const MOBILE_ENDPOINTS = Object.freeze({
    appApi: '/app/api',
    panelApi: '/panel/api',
    panelReprintApi: '/panel/reprint/api',
});

const MOBILE_LIST_AUTO_FILTER_MAX_PAGES = 3;
const MOBILE_LIST_FOCUS_MAX_PAGES = 12;
const MOBILE_LIST_SEARCH_AUTO_EXPAND_PAGES = 8;

function normalizeMobileSortMode(rawValue) {
    const normalized = String(rawValue || 'sr-asc').trim().toLowerCase();
    if (normalized === 'name-asc' || normalized === 'name-desc' || normalized === 'sr-asc') {
        return normalized;
    }
    return 'sr-asc';
}

function buildEndpoint(base, path) {
    const normalizedBase = String(base || '').replace(/\/+$/, '');
    const normalizedPath = String(path || '').replace(/^\/+/, '');
    return normalizedBase + '/' + normalizedPath;
}

function estimateMobileUploadTimeoutMs(imageFiles) {
    const files = Object.values(imageFiles || {}).filter(Boolean);
    const totalBytes = files.reduce((sum, fileObj) => {
        const fileSize = Number(fileObj && fileObj.size);
        return sum + (Number.isFinite(fileSize) ? fileSize : 0);
    }, 0);
    const totalMB = totalBytes / (1024 * 1024);

    // Base timeout is 3 minutes. Add 12s/MB for slow mobile links.
    // Keep a hard ceiling to avoid indefinite hanging.
    const timeoutMs = 180000 + Math.ceil(totalMB * 12000);
    return Math.max(180000, Math.min(timeoutMs, 600000));
}

function listApp() {
    return {
        searchQuery: (typeof INITIAL_SEARCH_QUERY !== 'undefined' ? String(INITIAL_SEARCH_QUERY || '') : ''),
        showFilters: false,
        selectAll: false,
        selectedIds: [],
        actionLoading: false,
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
        filters: {
            photo: (function () {
                const raw = (typeof INITIAL_PHOTO_FILTER !== 'undefined') ? String(INITIAL_PHOTO_FILTER || '').toLowerCase().trim() : '';
                return (raw === 'with' || raw === 'without') ? raw : 'all';
            })(),
            selectedClass: (typeof INITIAL_SELECTED_CLASS !== 'undefined' ? String(INITIAL_SELECTED_CLASS || '') : ''),
            selectedSection: (typeof INITIAL_SELECTED_SECTION !== 'undefined' ? String(INITIAL_SELECTED_SECTION || '') : ''),
            sortMode: normalizeMobileSortMode(typeof INITIAL_SORT_MODE !== 'undefined' ? INITIAL_SORT_MODE : 'sr-asc'),
            dateFrom: (typeof INITIAL_FROM_DATE !== 'undefined' ? String(INITIAL_FROM_DATE || '') : ''),
            dateTo: (typeof INITIAL_TO_DATE !== 'undefined' ? String(INITIAL_TO_DATE || '') : ''),
        },
        serverFilterState: {
            searchQuery: (typeof INITIAL_SEARCH_QUERY !== 'undefined' ? String(INITIAL_SEARCH_QUERY || '') : ''),
            photo: (function () {
                const raw = (typeof INITIAL_PHOTO_FILTER !== 'undefined') ? String(INITIAL_PHOTO_FILTER || '').toLowerCase().trim() : '';
                return (raw === 'with' || raw === 'without') ? raw : 'all';
            })(),
            selectedClass: (typeof INITIAL_SELECTED_CLASS !== 'undefined' ? String(INITIAL_SELECTED_CLASS || '') : ''),
            selectedSection: (typeof INITIAL_SELECTED_SECTION !== 'undefined' ? String(INITIAL_SELECTED_SECTION || '') : ''),
            sortMode: normalizeMobileSortMode(typeof INITIAL_SORT_MODE !== 'undefined' ? INITIAL_SORT_MODE : 'sr-asc'),
            dateFrom: (typeof INITIAL_FROM_DATE !== 'undefined' ? String(INITIAL_FROM_DATE || '') : ''),
            dateTo: (typeof INITIAL_TO_DATE !== 'undefined' ? String(INITIAL_TO_DATE || '') : ''),
        },
        filtersActive: false,
        classOptions: [],
        sectionOptions: [],
        classToSections: {},
        loadingAllForFilters: false,
        supportsInfiniteObserver: typeof window !== 'undefined' && 'IntersectionObserver' in window,
        infiniteObserver: null,
        scrollFallbackHandler: null,
        overlayTokens: {},
        overlayWatchersBound: false,
        actionMenuOpen: false,
        reprintSearchTimer: null,
        searchFilterTimer: null,
        searchScopeHintShown: false,
        searchAutoExpandInFlight: false,
        lastSearchAutoExpandQuery: '',

        permanentDeleteModal: {
            show: false,
            code: '',
            input: '',
            count: 0,
            submitting: false,
        },

        activeImageField: null,
        showImagePicker: false,
        reprintPicker: {
            show: false,
            loading: false,
            query: '',
            rows: [],
            selectedId: null,
        },
        reprintConfirm: {
            show: false,
            card: null,
            fields: [],
            formData: {},
            originalData: {},
            photoUrl: '',
            mediaUrls: [],
            editMode: false,
            submitting: false,
        },
        reprintPendingAfterEdit: false,
        reprintPendingCardIds: [],

        // Add/Edit Form state
        showAddForm: false,
        addFormSubmitting: false,
        viewMode: false,
        editMode: false,
        editingId: null,
        studentsData: typeof STUDENTS_DATA !== 'undefined' ? STUDENTS_DATA : [],
        totalRecords: (typeof TOTAL_RECORDS !== 'undefined' && Number.isFinite(Number(TOTAL_RECORDS)))
            ? Number(TOTAL_RECORDS)
            : ((typeof STUDENTS_DATA !== 'undefined' && Array.isArray(STUDENTS_DATA)) ? STUDENTS_DATA.length : 0),
        hasMore: typeof HAS_MORE !== 'undefined' ? HAS_MORE : false,
        loadMoreOffset: typeof STUDENTS_DATA !== 'undefined' ? STUDENTS_DATA.length : 0,
        loadMorePage: 1,
        visibleCount: typeof STUDENTS_DATA !== 'undefined' ? STUDENTS_DATA.length : 0,
        pageSize: (typeof INITIAL_PAGE_SIZE !== 'undefined' && Number.isFinite(Number(INITIAL_PAGE_SIZE)))
            ? Math.max(10, Math.min(Number(INITIAL_PAGE_SIZE), 200))
            : 50,
        allClassesRaw: (typeof ALL_CLASSES !== 'undefined' && Array.isArray(ALL_CLASSES)) ? ALL_CLASSES : [],
        allSectionsRaw: (typeof ALL_SECTIONS !== 'undefined' && Array.isArray(ALL_SECTIONS)) ? ALL_SECTIONS : [],
        allClassToSectionsRaw: (typeof ALL_CLASS_TO_SECTIONS !== 'undefined' && ALL_CLASS_TO_SECTIONS && typeof ALL_CLASS_TO_SECTIONS === 'object') ? ALL_CLASS_TO_SECTIONS : {},
        filterOptionsLoading: false,
        filterOptionsHydrated: false,
        tableFields: Array.isArray(TABLE_FIELDS) ? TABLE_FIELDS : [],
        dynamicFormFields: [],
        imageFormFields: [],
        activeImageField: '',
        tabCounts: TAB_COUNTS || { pending: 0, verified: 0, approved: 0, download: 0, pool: 0 },
        form: {
            dynamicValues: {},
            imageFiles: {},
            imagePreviews: {},
            imageHasPath: {},
            imageRemoveFlags: {},
        },

        init() {
            this.totalRecords = Math.max(Number(this.totalRecords || 0), Number(this.studentsData.length || 0));
            this._syncPagingFromInitialData();
            this.filtersActive = this._computeFiltersActive();
            this.rebuildClassSectionOptions();
            this._wirePhotoFallbacks(document);
            this._bindOverlayWatchers();

            this.$nextTick(() => {
                this.initInfiniteLoader();
                this.refreshFilterOptionsFromServer();
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

        _remainingScrollDistance() {
            const scrollRoot = document.getElementById('students-scroll');
            if (!scrollRoot) return Number.POSITIVE_INFINITY;
            return scrollRoot.scrollHeight - (scrollRoot.scrollTop + scrollRoot.clientHeight);
        },

        _queueNextPageIfNeeded() {
            if (this.loading || !this.hasMore) return;

            const remaining = this._remainingScrollDistance();
            if (!Number.isFinite(remaining) || remaining > 260) return;

            const schedule = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
            schedule(() => {
                if (this.loading || !this.hasMore) return;
                const nextRemaining = this._remainingScrollDistance();
                if (Number.isFinite(nextRemaining) && nextRemaining <= 260) {
                    this.loadMore(true);
                }
            });
        },

        _bindOverlayWatchers() {
            if (this.overlayWatchersBound || typeof this.$watch !== 'function') return;
            this.overlayWatchersBound = true;

            this.$watch('showFilters', (isOpen) => {
                if (isOpen) {
                    this._openOverlay('filters', () => { this.showFilters = false; });
                } else {
                    this._closeOverlay('filters');
                }
            });

            this.$watch('showAddForm', (isOpen) => {
                if (isOpen) {
                    this._openOverlay('addForm', () => { this.closeAddForm(); });
                } else {
                    this._closeOverlay('addForm');
                }
            });

            this.$watch('downloadModal.show', (isOpen) => {
                if (isOpen) {
                    this._openOverlay('downloadModal', () => { this.closeDownloadModal(); });
                } else {
                    this._closeOverlay('downloadModal');
                }
            });

            this.$watch('permanentDeleteModal.show', (isOpen) => {
                if (isOpen) {
                    this._openOverlay('permanentDeleteModal', () => { this.closePermanentDeleteModal(); });
                } else {
                    this._closeOverlay('permanentDeleteModal');
                }
            });

            this.$watch('reprintPicker.show', (isOpen) => {
                if (isOpen) {
                    this._openOverlay('reprintPicker', () => { this.closeReprintPicker(); });
                } else {
                    this._closeOverlay('reprintPicker');
                }
            });

            this.$watch('reprintConfirm.show', (isOpen) => {
                if (isOpen) {
                    this._openOverlay('reprintConfirm', () => { this.closeReprintConfirm(); });
                } else {
                    this._closeOverlay('reprintConfirm');
                }
            });
        },

        _openOverlay(key, closeFn) {
            if (this.overlayTokens[key]) return;
            if (!window.mobileOverlay) {
                document.body.classList.add('overflow-hidden');
                return;
            }

            this.overlayTokens[key] = window.mobileOverlay.open(() => {
                if (typeof closeFn === 'function') closeFn();
                this._closeOverlay(key, true);
            });
        },

        _closeOverlay(key, fromPopstate) {
            const token = this.overlayTokens[key];
            if (!token) {
                if (!window.mobileOverlay) {
                    const anyOpen = this.showFilters || this.showAddForm || this.downloadModal.show || this.permanentDeleteModal.show || this.reprintPicker.show || this.reprintConfirm.show;
                    if (!anyOpen) document.body.classList.remove('overflow-hidden');
                }
                return;
            }

            if (window.mobileOverlay) {
                window.mobileOverlay.close(token, { fromPopstate: !!fromPopstate });
            }
            delete this.overlayTokens[key];
        },

        async focusCardById(cardId) {
            const targetId = Number(cardId);
            if (!targetId) return;

            // Try to find the card in loaded data
            const findCardEl = () => document.querySelector('[data-sid="' + targetId + '"]');
            let target = findCardEl();
            if (!target && this.hasMore) {
                // Search deep-links must scan beyond the initial page window.
                await this.loadAllDataForFiltering(MOBILE_LIST_FOCUS_MAX_PAGES);
                target = findCardEl();
            }

            if (!target) {
                try {
                    // Fallback to direct card fetch so deep-link open works even if
                    // the card sits far beyond currently loaded pagination chunks.
                    const latestCard = await this._fetchCardSnapshot(targetId);
                    if (String(latestCard.status || '').toLowerCase() !== String(LIST_TYPE || '').toLowerCase()) {
                        this.showToast('This card moved to another status list', 'info');
                        return;
                    }

                    this._upsertStudentCard(latestCard, 'add');
                    target = findCardEl();
                } catch (e) {
                    const errText = String((e && e.message) || '').toLowerCase();
                    if (errText.includes('access denied') || errText.includes('permission')) {
                        this.showToast('This card is outside your current access scope', 'error');
                    } else {
                        this.showToast('Searched card not found in this list', 'error');
                    }
                    return;
                }
            }

            if (!target) {
                this.showToast('Searched card not found in this list', 'error');
                return;
            }
            // Scroll and highlight
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('ring-2', 'ring-brand-light', 'ring-offset-2', 'bg-amber-50');
            setTimeout(() => {
                target.classList.remove('ring-2', 'ring-brand-light', 'ring-offset-2', 'bg-amber-50');
            }, 3500);
        },

        async toggleSelectAll() {
            if (this.selectAll) {
                const allMatchingIds = await this._fetchAllMatchingIds();
                if (Array.isArray(allMatchingIds)) {
                    this.selectedIds = allMatchingIds;
                } else {
                    // Fallback: if server-side select-all is unavailable, select visible rows.
                    const visible = [];
                    document.querySelectorAll('[data-sid]').forEach(el => {
                        if (el.style.display !== 'none') visible.push(parseInt(el.getAttribute('data-sid')));
                    });
                    this.selectedIds = visible;
                }
            } else { this.selectedIds = []; }
            if (!this.selectedIds.length) this.actionMenuOpen = false;
            // Sync classes for dynamically loaded rows
            document.querySelectorAll('[data-sid]').forEach(el => {
                this._updateRowClass(parseInt(el.dataset.sid));
            });
        },
        _buildAllIdsQueryParams() {
            const params = new URLSearchParams();
            params.set('status', LIST_TYPE);

            const q = String(this.searchQuery || '').trim();
            if (q) params.set('search', q);

            if (this.filters.selectedClass) params.set('class', this.filters.selectedClass);
            if (this.filters.selectedSection) params.set('section', this.filters.selectedSection);

            if (LIST_TYPE === 'download') {
                if (this.filters.dateFrom) params.set('from', this.filters.dateFrom);
                if (this.filters.dateTo) params.set('to', this.filters.dateTo);
            }

            if (this.filters.photo !== 'all') {
                params.set('photo', this.filters.photo);
            }

            const sortMode = normalizeMobileSortMode(this.filters.sortMode);
            if (sortMode !== 'sr-asc') {
                params.set('sort', sortMode);
            }

            return params;
        },
        async _fetchAllMatchingIds() {
            const params = this._buildAllIdsQueryParams();

            try {
                const url = buildEndpoint(MOBILE_ENDPOINTS.appApi, `table/${TABLE_ID}/cards/all-ids/`) + `?${params.toString()}`;
                const res = await fetch(url, { headers: { 'X-CSRFToken': CSRF } });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.success) {
                    this.showToast(data.message || 'Could not select all records', 'error');
                    this.selectAll = false;
                    return null;
                }

                const ids = Array.isArray(data.card_ids) ? data.card_ids.map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id)) : [];
                if (!ids.length) {
                    this.showToast('No records match current filters', 'info');
                }
                return ids;
            } catch (e) {
                this.showToast('Could not select all records', 'error');
                this.selectAll = false;
                return null;
            }
        },
        toggleSelect(id) {
            const idx = this.selectedIds.indexOf(id);
            if (idx > -1) { this.selectedIds.splice(idx, 1); }
            else { this.selectedIds.push(id); }
            const visibleCount = Array.from(document.querySelectorAll('[data-sid]')).filter(el => el.style.display !== 'none').length;
            this.selectAll = this.selectedIds.length === visibleCount && visibleCount > 0;
            if (!this.selectedIds.length) this.actionMenuOpen = false;
            this._updateRowClass(id);
        },

        // --- Filtering & Sorting ---
        filterStudents() {
            // Debounced server-backed search to ensure full-table matching.
            if (this.searchFilterTimer) {
                clearTimeout(this.searchFilterTimer);
                this.searchFilterTimer = null;
            }
            this.searchFilterTimer = setTimeout(() => {
                if (this._hasServerBackedFilterChange()) {
                    this._reloadWithServerFilters();
                    return;
                }
                if (this._computeFiltersActive()) {
                    this.visibleCount = this.studentsData.length;
                    return;
                }
                this._applyAllFilters({ showCountToast: false });
            }, 180);
        },
        async _maybeExpandSearchScope(query) {
            const normalizedQuery = String(query || '').trim().toLowerCase();
            if (!normalizedQuery || normalizedQuery.length < 2) return;
            if (!this.hasMore || this.searchAutoExpandInFlight) return;
            if (this.lastSearchAutoExpandQuery === normalizedQuery) return;

            this.lastSearchAutoExpandQuery = normalizedQuery;
            this.searchAutoExpandInFlight = true;
            try {
                if (!this.searchScopeHintShown) {
                    this.showToast('Searching more records in background...', 'info');
                    this.searchScopeHintShown = true;
                }

                await this.loadAllDataForFiltering(MOBILE_LIST_SEARCH_AUTO_EXPAND_PAGES);
                this._applyAllFilters({ showCountToast: false });
            } finally {
                this.searchAutoExpandInFlight = false;
            }
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
        _computeFiltersActive() {
            if (String(this.searchQuery || '').trim()) return true;
            if (this.filters.photo !== 'all') return true;
            if (this.filters.selectedClass !== '') return true;
            if (this.filters.selectedSection !== '') return true;
            if (normalizeMobileSortMode(this.filters.sortMode) !== 'sr-asc') return true;
            if (LIST_TYPE === 'download') {
                if (this.filters.dateFrom !== '') return true;
                if (this.filters.dateTo !== '') return true;
            }
            return false;
        },
        _syncPagingFromInitialData() {
            const loaded = Number(this.studentsData.length || 0);
            const pageSize = Number(this.pageSize || 50);
            this.loadMoreOffset = loaded;
            this.loadMorePage = Math.max(1, Math.floor(loaded / pageSize));
        },
        _hasServerBackedFilterChange() {
            if (String(this.searchQuery || '').trim() !== String(this.serverFilterState.searchQuery || '').trim()) return true;
            if (String(this.filters.photo || 'all') !== String(this.serverFilterState.photo || 'all')) return true;
            if (String(this.filters.selectedClass || '') !== String(this.serverFilterState.selectedClass || '')) return true;
            if (String(this.filters.selectedSection || '') !== String(this.serverFilterState.selectedSection || '')) return true;
            if (normalizeMobileSortMode(this.filters.sortMode) !== normalizeMobileSortMode(this.serverFilterState.sortMode)) return true;
            if (LIST_TYPE === 'download') {
                if (String(this.filters.dateFrom || '') !== String(this.serverFilterState.dateFrom || '')) return true;
                if (String(this.filters.dateTo || '') !== String(this.serverFilterState.dateTo || '')) return true;
            }
            return false;
        },
        _buildServerFilterUrl() {
            const parsed = new URL(window.location.href);
            const params = parsed.searchParams;

            params.delete('focus_card');

            const searchValue = String(this.searchQuery || '').trim();
            if (searchValue) params.set('search', searchValue);
            else params.delete('search');

            const photoValue = String(this.filters.photo || 'all').trim().toLowerCase();
            if (photoValue === 'with' || photoValue === 'without') params.set('photo', photoValue);
            else params.delete('photo');

            const classValue = String(this.filters.selectedClass || '').trim();
            const sectionValue = String(this.filters.selectedSection || '').trim();
            if (classValue) params.set('class', classValue);
            else params.delete('class');

            if (sectionValue) params.set('section', sectionValue);
            else params.delete('section');

            const sortValue = normalizeMobileSortMode(this.filters.sortMode);
            if (sortValue !== 'sr-asc') params.set('sort', sortValue);
            else params.delete('sort');

            if (LIST_TYPE === 'download') {
                const fromValue = String(this.filters.dateFrom || '').trim();
                const toValue = String(this.filters.dateTo || '').trim();
                if (fromValue) params.set('from', fromValue);
                else params.delete('from');
                if (toValue) params.set('to', toValue);
                else params.delete('to');
            } else {
                params.delete('from');
                params.delete('to');
            }

            const query = params.toString();
            return parsed.pathname + (query ? ('?' + query) : '');
        },
        _reloadWithServerFilters(options = {}) {
            const forceReloadWhenSame = !!(options && options.forceReloadWhenSame);
            const nextUrl = this._buildServerFilterUrl();
            const currentUrl = window.location.pathname + window.location.search;
            if (nextUrl === currentUrl) {
                if (forceReloadWhenSame) {
                    window.location.reload();
                    return true;
                }
                return false;
            }
            window.location.href = nextUrl;
            return true;
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
        async refreshFilterOptionsFromServer() {
            if (this.filterOptionsLoading) return;

            this.filterOptionsLoading = true;
            try {
                const params = new URLSearchParams();
                params.set('status', LIST_TYPE);

                const searchValue = String(this.searchQuery || '').trim();
                if (searchValue) params.set('search', searchValue);

                if (this.filters.photo === 'with' || this.filters.photo === 'without') {
                    params.set('photo', this.filters.photo);
                }

                if (LIST_TYPE === 'download') {
                    if (this.filters.dateFrom) params.set('from', this.filters.dateFrom);
                    if (this.filters.dateTo) params.set('to', this.filters.dateTo);
                }

                const url = buildEndpoint(MOBILE_ENDPOINTS.appApi, `table/${TABLE_ID}/filter-options/`) + `?${params.toString()}`;
                const res = await fetch(url, { headers: { 'X-CSRFToken': CSRF } });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || !json.success) return;

                const payload = (json && json.data) || {};
                const classes = Array.isArray(payload.classes) ? payload.classes : [];
                const sections = Array.isArray(payload.sections) ? payload.sections : [];
                const classToSections = payload.class_to_sections && typeof payload.class_to_sections === 'object'
                    ? payload.class_to_sections
                    : {};

                this.allClassesRaw = classes;
                this.allSectionsRaw = sections;
                this.allClassToSectionsRaw = classToSections;
                this.filterOptionsHydrated = true;
                this.rebuildClassSectionOptions();
            } catch (e) {
                // Keep existing options fallback without interrupting UX.
            } finally {
                this.filterOptionsLoading = false;
            }
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
            this.filters = { photo: 'all', selectedClass: '', selectedSection: '', sortMode: 'sr-asc', dateFrom: '', dateTo: '' };
            this.filtersActive = false;
            this.searchQuery = '';
            this.searchScopeHintShown = false;
            this.lastSearchAutoExpandQuery = '';

            const navigated = this._reloadWithServerFilters();
            if (navigated) {
                return;
            }

            this._applyAllFilters();
        },
        async applyFilters() {
            this.filtersActive = this._computeFiltersActive();

            // Always attempt server-backed apply; if URL is unchanged, force refresh so post-update filtering still applies.
            const navigated = this._reloadWithServerFilters({ forceReloadWhenSame: this.filtersActive });
            if (navigated) {
                return;
            }

            this.visibleCount = this.studentsData.length;
            this.showFilters = false;
        },
        async loadAllDataForFiltering(maxPages = MOBILE_LIST_AUTO_FILTER_MAX_PAGES) {
            let safety = 0;
            while (this.hasMore && safety < maxPages) {
                await this.loadMore(true);
                safety += 1;
            }
            if (this.hasMore) {
                this.showToast('Loaded a large chunk for filters. Refine filters for faster results.', 'info');
            }
        },
        _applyAllFilters(options = {}) {
            const q = (this.searchQuery || '').toLowerCase().trim();
            const hasStructuredFilters = (
                this.filters.photo !== 'all' ||
                this.filters.selectedClass !== '' ||
                this.filters.selectedSection !== '' ||
                (LIST_TYPE === 'download' && (this.filters.dateFrom !== '' || this.filters.dateTo !== ''))
            );

            if (!q && !hasStructuredFilters) {
                const allCards = document.querySelectorAll('[data-sid]');
                allCards.forEach((el) => {
                    el.style.display = '';
                });
                this.visibleCount = this.studentsData.length;
                return;
            }

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
                // Date range (download list): filter by downloaded date, not DOB.
                if (LIST_TYPE === 'download') {
                    const downloadedDate = String(s.downloaded_date || '').slice(0, 10);
                    if (this.filters.dateFrom) {
                        if (!downloadedDate || downloadedDate < this.filters.dateFrom) return false;
                    }
                    if (this.filters.dateTo) {
                        if (!downloadedDate || downloadedDate > this.filters.dateTo) return false;
                    }
                }
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
            // Deselect items that are no longer visible when not using Select All mode.
            if (!this.selectAll) {
                this.selectedIds = this.selectedIds.filter(id => visibleIds.has(id));
            }
            // Update visible count
            this.visibleCount = filtered.length;
            // Show count
            if ((q || this.filtersActive) && options.showCountToast) {
                this.showToast(filtered.length + ' of ' + this.totalRecords + ' shown', 'info');
            }
        },

        showToast(msg, type='info') { this.toast = { show: true, message: msg, type }; setTimeout(() => { this.toast.show = false; }, 2500); },

        // ========== Download Modal Methods ==========
        showDownloadModal(type, itemCount) {
            const titleByType = {
                pdf: 'Generating PDF',
                img: 'Preparing Images',
                xlsx: 'Preparing Excel',
            };
            const statusByType = {
                pdf: 'Rendering cards...',
                img: 'Compressing images...',
                xlsx: 'Building spreadsheet...',
            };
            this.downloadModal = {
                show: true,
                state: 'preparing',
                title: titleByType[type] || 'Preparing Download',
                subtitle: 'Please wait while we prepare your download...',
                itemCount: itemCount,
                progress: -1,
                estimatedTime: this._estimateDownloadTime(itemCount, type),
                sizeInfo: '',
                statusText: statusByType[type] || 'Preparing file...',
                cancelling: false,
                abortController: new AbortController(),
            };
        },

        _estimateDownloadTime(count, type) {
            // Rough estimate: PDF ~0.5s/card, IMG ~1s/card, XLSX ~0.35s/card
            const secondsPerItem = type === 'pdf' ? 0.5 : (type === 'xlsx' ? 0.35 : 1);
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

        async _pollMobileExportTask(taskId, options = {}) {
            for (let i = 0; i < 300; i++) {
                if (this.downloadModal.abortController?.signal?.aborted) {
                    throw new Error('AbortError');
                }

                const statusRes = await fetch(buildEndpoint(MOBILE_ENDPOINTS.panelApi, 'task-status/' + taskId + '/'), {
                    headers: { 'X-CSRFToken': CSRF },
                    signal: this.downloadModal.abortController?.signal,
                });
                const data = await statusRes.json().catch(() => ({}));

                if (data.status === 'completed' && data.download_url) {
                    this.updateDownloadProgress(95, options.readyText || 'Saving file...');
                    const a = document.createElement('a');
                    a.href = data.download_url;
                    const resultFilename = data.result && data.result.filename ? data.result.filename : '';
                    a.download = resultFilename || options.fallbackFilename || 'export';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();

                    if (typeof options.afterSuccess === 'function') {
                        await options.afterSuccess();
                    }

                    this.completeDownload(true, options.successText || 'File saved to your device');
                    return;
                }

                if (data.status === 'failed' || data.status === 'cancelled') {
                    this.completeDownload(false, data.error_message || options.failText || 'Export failed');
                    return;
                }

                const p = Math.max(10, Math.min(90, Number(data.progress_percentage || data.progress || 0)));
                this.updateDownloadProgress(p, data.status_display || options.progressText || 'Processing export...');
                await new Promise(r => setTimeout(r, 2000));
            }
            this.completeDownload(false, options.timeoutText || 'Export timed out');
        },

        async _startMobileAsyncExport(exportType, cardIds, options = {}, extraPayload = {}) {
            this.updateDownloadProgress(10, options.startText || 'Sending request...');

            const body = Object.assign({
                export_type: exportType,
                card_ids: cardIds,
                status: LIST_TYPE,
            }, extraPayload);

            const res = await fetch(buildEndpoint(MOBILE_ENDPOINTS.panelApi, 'table/' + TABLE_ID + '/export-task/'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                body: JSON.stringify(body),
                signal: this.downloadModal.abortController?.signal,
            });

            this.updateDownloadProgress(30, options.queueText || 'Queued for background export...');
            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.success || !data.task_id) {
                this.completeDownload(false, data.message || options.failText || 'Failed to start export task');
                return;
            }

            await this._pollMobileExportTask(data.task_id, options);
        },

        _generateNumericCode(len = 10) {
            let out = '';
            for (let i = 0; i < len; i += 1) {
                out += String(Math.floor(Math.random() * 10));
            }
            return out;
        },

        async openPermanentDeleteModal() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            if (LIST_TYPE !== 'pool') {
                this.showToast('Permanent delete is only available in pool list', 'error');
                return;
            }

            let code = this._generateNumericCode(10);
            try {
                const res = await fetch(buildEndpoint(MOBILE_ENDPOINTS.panelApi, 'table/' + TABLE_ID + '/cards/generate-delete-code/'), {
                    method: 'POST',
                    headers: { 'X-CSRFToken': CSRF },
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.success && data.code) code = String(data.code);
            } catch (e) {
                // Keep local fallback code when server code endpoint is unavailable for current role.
            }

            this.permanentDeleteModal.code = code;
            this.permanentDeleteModal.input = '';
            this.permanentDeleteModal.count = this.selectedIds.length;
            this.permanentDeleteModal.submitting = false;
            this.permanentDeleteModal.show = true;
        },

        closePermanentDeleteModal() {
            this.permanentDeleteModal.show = false;
            this.permanentDeleteModal.submitting = false;
            this.permanentDeleteModal.input = '';
        },

        async confirmPermanentDelete() {
            if (this.permanentDeleteModal.submitting) return;
            if (this.permanentDeleteModal.input !== this.permanentDeleteModal.code || this.permanentDeleteModal.input.length !== 10) {
                this.showToast('Confirmation code does not match', 'error');
                return;
            }

            this.permanentDeleteModal.submitting = true;
            await this._permanentlyDeleteSelected();
            this.permanentDeleteModal.submitting = false;
            this.closePermanentDeleteModal();
        },

        _normalizeReprintKey(value) {
            return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        },

        _reprintField(item, possibleKeys) {
            const fields = Array.isArray(item?.ordered_fields) ? item.ordered_fields : [];
            const keyMap = {};
            (possibleKeys || []).forEach(k => { keyMap[this._normalizeReprintKey(k)] = true; });
            for (let i = 0; i < fields.length; i += 1) {
                const name = this._normalizeReprintKey(fields[i]?.name || '');
                if (keyMap[name]) return String(fields[i]?.value || '');
            }
            return '';
        },

        _mapReprintItem(item) {
            return {
                card_id: Number(item?.card_id || 0),
                name: this._reprintField(item, ['NAME', 'STUDENT NAME', 'STUDENT_NAME']),
                roll_no: this._reprintField(item, ['ROLL NO', 'ROLL_NO', 'ID NUMBER', 'ID_NUMBER']),
                class_name: this._reprintField(item, ['CLASS', 'DESIGNATION', 'CLASS DESIGNATION']),
                section: this._reprintField(item, ['SECTION']),
                raw: item,
            };
        },

        _isReprintImageField(fieldName) {
            const n = this._normalizeReprintKey(fieldName);
            return n.includes('PHOTO') || n.includes('IMAGE') || n.includes('SIGNATURE') || n.includes('BARCODE') || n.includes('QR');
        },

        _reprintMediaUrl(rawPath) {
            const raw = String(rawPath || '').trim();
            if (!raw) return '';
            if (/^https?:\/\//i.test(raw)) return raw;
            let p = raw.replace(/\\/g, '/');
            const lower = p.toLowerCase();
            const marker = '/media/';
            const idx = lower.indexOf(marker);
            if (idx !== -1) p = p.slice(idx + marker.length);
            p = p.replace(/^\/+/, '');
            if (p.toLowerCase().startsWith('media/')) p = p.slice(6);
            if (!p || p === 'NOT_FOUND' || p.startsWith('PENDING:')) return '';
            return '/media/' + p;
        },

        _buildReprintConfirmPayload(card) {
            const ordered = Array.isArray(card?.raw?.ordered_fields) ? card.raw.ordered_fields : [];
            const fields = [];
            const formData = {};
            const originalData = {};
            let photoUrl = '';
            const mediaUrls = [];
            const mediaSeen = {};

            ordered.forEach((f) => {
                const name = String(f?.name || '').trim();
                if (!name) return;
                const value = String(f?.value || '');

                if (this._isReprintImageField(name)) {
                    const resolved = this._reprintMediaUrl(value);
                    if (resolved && !mediaSeen[resolved]) {
                        mediaSeen[resolved] = true;
                        mediaUrls.push(resolved);
                    }
                    if (!photoUrl && resolved) {
                        photoUrl = resolved;
                    }
                    return;
                }

                fields.push({ name });
                formData[name] = value;
                originalData[name] = value;
            });

            return { fields, formData, originalData, photoUrl, mediaUrls };
        },

        toggleReprintEditMode() {
            this.reprintConfirm.editMode = !this.reprintConfirm.editMode;
        },

        updateReprintField(fieldName, value) {
            const key = String(fieldName || '').trim();
            if (!key) return;
            this.reprintConfirm.formData[key] = String(value || '');
        },

        _reprintHasInlineChanges() {
            const current = this.reprintConfirm.formData || {};
            const original = this.reprintConfirm.originalData || {};
            const keys = Object.keys(current);
            for (let i = 0; i < keys.length; i += 1) {
                const k = keys[i];
                if (String(current[k] || '').trim() !== String(original[k] || '').trim()) {
                    return true;
                }
            }
            return false;
        },

        async _saveReprintInlineChanges(cardId) {
            const payload = {};
            Object.keys(this.reprintConfirm.formData || {}).forEach((key) => {
                payload[key] = String(this.reprintConfirm.formData[key] || '').trim();
            });

            const fd = new FormData();
            fd.append('field_data', JSON.stringify(payload));

            const res = await fetch(buildEndpoint(MOBILE_ENDPOINTS.appApi, 'table/' + TABLE_ID + '/card/' + cardId + '/update/'), {
                method: 'POST',
                headers: { 'X-CSRFToken': CSRF },
                body: fd,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.message || 'Could not save card changes');
            }
            this.reprintConfirm.originalData = Object.assign({}, this.reprintConfirm.formData || {});
        },

        async fetchReprintList() {
            this.reprintPicker.loading = true;
            try {
                const q = encodeURIComponent(String(this.reprintPicker.query || '').trim());
                const url = buildEndpoint(MOBILE_ENDPOINTS.panelReprintApi, 'table/' + TABLE_ID + '/reprint-list/') + '?available_only=1&limit=500&q=' + q;
                const res = await fetch(url, { headers: { 'X-CSRFToken': CSRF } });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.status !== 'ok') {
                    this.reprintPicker.rows = [];
                    this.showToast(data.message || 'Failed to load reprint list', 'error');
                    this.reprintPicker.loading = false;
                    return;
                }
                this.reprintPicker.rows = (data.items || []).map((it) => this._mapReprintItem(it));
                if (this.reprintPicker.selectedId) {
                    const found = this.reprintPicker.rows.some(r => Number(r.card_id) === Number(this.reprintPicker.selectedId));
                    if (!found) this.reprintPicker.selectedId = null;
                }
            } catch (e) {
                this.reprintPicker.rows = [];
                this.showToast('Failed to load reprint list', 'error');
            }
            this.reprintPicker.loading = false;
        },

        openReprintPicker() {
            if (LIST_TYPE !== 'download') {
                this.showToast('Reprint is available from download list only', 'error');
                return;
            }
            if (!this.studentsData.length) {
                this.showToast('No cards available for reprint', 'error');
                return;
            }
            this.reprintPicker.show = true;
            this.fetchReprintList();
        },

        closeReprintPicker() {
            this.reprintPicker.show = false;
        },

        onReprintSearchInput() {
            if (this.reprintSearchTimer) {
                clearTimeout(this.reprintSearchTimer);
                this.reprintSearchTimer = null;
            }
            this.reprintSearchTimer = setTimeout(() => {
                this.fetchReprintList();
            }, 250);
        },

        selectReprintCard(cardId) {
            this.reprintPicker.selectedId = Number(cardId);
        },

        openReprintConfirm() {
            const id = Number(this.reprintPicker.selectedId || 0);
            if (!id) { this.showToast('Select one card for reprint', 'error'); return; }
            const card = (this.reprintPicker.rows || []).find(r => Number(r.card_id) === id) || null;
            const payload = this._buildReprintConfirmPayload(card);
            this.reprintConfirm.card = card;
            this.reprintConfirm.fields = payload.fields;
            this.reprintConfirm.formData = payload.formData;
            this.reprintConfirm.originalData = payload.originalData;
            this.reprintConfirm.photoUrl = payload.photoUrl;
            this.reprintConfirm.mediaUrls = Array.isArray(payload.mediaUrls) ? payload.mediaUrls : [];
            this.reprintConfirm.editMode = false;
            this.reprintConfirm.submitting = false;
            this.reprintConfirm.show = true;
        },

        closeReprintConfirm() {
            this.reprintConfirm.show = false;
            this.reprintConfirm.submitting = false;
            this.reprintConfirm.card = null;
            this.reprintConfirm.fields = [];
            this.reprintConfirm.formData = {};
            this.reprintConfirm.originalData = {};
            this.reprintConfirm.photoUrl = '';
            this.reprintConfirm.mediaUrls = [];
            this.reprintConfirm.editMode = false;
        },

        async _createReprintRequest(cardIds) {
            const ids = Array.isArray(cardIds) ? cardIds.map(Number).filter(Boolean) : [];
            if (!ids.length) {
                this.showToast('No card selected for reprint request', 'error');
                return false;
            }
            try {
                const res = await fetch(buildEndpoint(MOBILE_ENDPOINTS.panelReprintApi, 'table/' + TABLE_ID + '/request/'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                    body: JSON.stringify({ card_ids: ids }),
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.status === 'ok') {
                    this.showToast(data.message || 'Successfully sent for reprint', 'success');
                    return true;
                }
                this.showToast(data.message || 'Could not create reprint request', 'error');
                return false;
            } catch (e) {
                this.showToast('Could not create reprint request', 'error');
                return false;
            }
        },

        async submitReprintRequest() {
            if (this.reprintConfirm.submitting) return;
            const cardId = Number(this.reprintConfirm.card?.card_id || this.reprintPicker.selectedId || 0);
            if (!cardId) { this.showToast('Select one card for reprint', 'error'); return; }

            this.reprintConfirm.submitting = true;
            if (this._reprintHasInlineChanges()) {
                try {
                    await this._saveReprintInlineChanges(cardId);
                } catch (e) {
                    this.reprintConfirm.submitting = false;
                    this.showToast(e.message || 'Could not save card changes', 'error');
                    return;
                }
            }

            const ok = await this._createReprintRequest([cardId]);
            this.reprintConfirm.submitting = false;
            if (!ok) return;

            this.closeReprintConfirm();
            this.closeReprintPicker();
            this.reprintPicker.selectedId = null;
            this.fetchReprintList();
        },

        async editThenSendReprint() {
            const cardId = Number(this.reprintConfirm.card?.card_id || this.reprintPicker.selectedId || 0);
            if (!cardId) { this.showToast('Select one card for reprint', 'error'); return; }

            this.reprintPendingAfterEdit = true;
            this.reprintPendingCardIds = [cardId];
            this.closeReprintConfirm();
            this.closeReprintPicker();

            try {
                const latestCard = await this._fetchCardSnapshot(cardId);
                if (latestCard.status === LIST_TYPE) {
                    this._upsertStudentCard(latestCard, 'add');
                }
                this.selectedIds = [cardId];
                this.viewMode = false;
                this.editMode = true;
                this.editingId = cardId;
                this.populateFormFromStudent(latestCard);
                this.showAddForm = true;
                this.showToast('Edit card and save to send reprint request', 'info');
            } catch (e) {
                this.reprintPendingAfterEdit = false;
                this.reprintPendingCardIds = [];
                this.showToast('Unable to open card for edit', 'error');
            }
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
            return ['photo', 'rel_photo', 'image', 'mother_photo', 'father_photo', 'signature', 'barcode', 'qr_code'].includes(t);
        },

        _isImageLikeFieldName(name) {
            const n = this._normalizeFieldName(name);
            if (!n || n.startsWith('ref') || n.startsWith('__') || n.startsWith('_')) return false;
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
            // Mobile requirement: every non-image field is a plain text input.
            // Image fields are handled separately via image slots, not dynamic inputs.
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
            const sourceLookupValues = {};
            Object.keys(source || {}).forEach((k) => {
                sourceLookupValues[this._normalizeLookupKey(k)] = source[k];
            });
            const sourceLookupKeys = new Set(
                Object.keys(sourceLookupValues || {})
            );

            (this.tableFields || []).forEach((f) => {
                if (!this._isRenderableFormField(f)) return;
                const name = String(f.name || '').trim();
                const lk = this._normalizeLookupKey(name);
                if (!lk || used.has(lk)) return;
                if (!includeAllTableFields) {
                    if (!sourceLookupKeys.has(lk)) return;
                    const srcVal = sourceLookupValues[lk];
                    const hasValue = srcVal !== null && srcVal !== undefined && String(srcVal).trim() !== '';
                    if (!hasValue && !f.mandatory) return;
                }
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
                if (!includeAllTableFields) {
                    const rawVal = source[rawKey];
                    if (rawVal === null || rawVal === undefined || String(rawVal).trim() === '') return;
                }
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
            if (n.includes('photo') || n.includes('image') || n.includes('signature') || n.includes('barcode') || n.includes('qr')) return true;
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
            if (status === 'pending') return 'ring-1 ring-amber-200';
            if (status === 'verified') return 'ring-1 ring-emerald-200';
            if (status === 'approved') return 'ring-1 ring-sky-200';
            if (status === 'download') return 'ring-1 ring-violet-200';
            return '';
        },

        _isPhotoFieldDef(fieldDef) {
            if (!fieldDef) return false;
            const name = String(fieldDef.name || '').trim().toLowerCase();
            const type = String(fieldDef.type || '').trim().toLowerCase();
            return this._isImageFieldType(type) || this._isImageLikeFieldName(name);
        },

        _normalizePhotoPath(raw) {
            const v = String(raw || '').trim();
            if (!v) return { url: null, hasPath: false };

            if (/^data:image\//i.test(v)) {
                return { url: v, hasPath: true };
            }

            const lowRaw = v.toLowerCase();
            if (lowRaw === 'not_found' || lowRaw.startsWith('pending:')) {
                return { url: null, hasPath: true };
            }

            if (v.startsWith('http://') || v.startsWith('https://')) {
                return { url: v, hasPath: true };
            }

            const mediaBase = window.MEDIA_URL || '/media/';
            const normalized = v.replace(/\\/g, '/');
            const lower = normalized.toLowerCase();

            const mediaMarker = '/media/';
            const mediaIdx = lower.lastIndexOf(mediaMarker);
            if (mediaIdx !== -1) {
                const rel = normalized.slice(mediaIdx + mediaMarker.length).replace(/^\/+/, '');
                return rel ? { url: mediaBase + rel, hasPath: true } : { url: null, hasPath: true };
            }

            if (normalized.startsWith('/')) {
                return { url: normalized, hasPath: true };
            }

            const mediaRoots = [
                'adarshimg/',
                'card_media/',
                'clients_imgs/',
                'clients_imgs_cropped/',
                'clients_imgs_failed/',
                'staff_imgs/',
                'images/',
            ];
            for (let i = 0; i < mediaRoots.length; i += 1) {
                const root = mediaRoots[i];
                const marker = '/' + root;
                const idx = lower.indexOf(marker);
                if (idx !== -1) {
                    return { url: mediaBase + normalized.slice(idx + 1).replace(/^\/+/, ''), hasPath: true };
                }
                if (lower.startsWith(root)) {
                    return { url: mediaBase + normalized.replace(/^\/+/, ''), hasPath: true };
                }
            }

            const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif', '.hei'];
            if (exts.some((ext) => lower.endsWith(ext)) || normalized.includes('/')) {
                return { url: mediaBase + normalized.replace(/^\/+/, ''), hasPath: true };
            }

            return { url: null, hasPath: true };
        },

        _buildPhotoSlotsFromCard(card) {
            const c = card || {};
            const fd = c.field_data || {};
            const fieldPhotoDefs = (this.tableFields || []).filter((f) => this._isPhotoFieldDef(f));
            const slots = [];
            const urls = [];

            const normalizedPrimary = this._normalizePhotoPath(c.photo_url);
            const primaryUrl = normalizedPrimary.url;

            const pushUrl = (url) => {
                if (!url) return;
                if (!urls.includes(url)) urls.push(url);
            };

            if (fieldPhotoDefs.length) {
                fieldPhotoDefs.forEach((f) => {
                    const rawVal = this._getFieldValue(fd, [String(f.name || '')], '');
                    const norm = this._normalizePhotoPath(rawVal);
                    slots.push({ url: norm.url, has_path: norm.hasPath });
                    pushUrl(norm.url);
                });

                if (primaryUrl && !urls.includes(primaryUrl)) {
                    const idx = slots.findIndex((s) => !s.url);
                    if (idx >= 0) {
                        slots[idx] = { url: primaryUrl, has_path: true };
                    } else {
                        slots.unshift({ url: primaryUrl, has_path: true });
                    }
                    pushUrl(primaryUrl);
                }

                return { slots, urls };
            }

            const rawPhotoUrls = Array.isArray(c.photo_urls) ? c.photo_urls : [];
            rawPhotoUrls.forEach((u) => {
                const norm = this._normalizePhotoPath(u);
                if (norm.url) {
                    slots.push({ url: norm.url, has_path: true });
                    pushUrl(norm.url);
                }
            });

            if (!slots.length && primaryUrl) {
                slots.push({ url: primaryUrl, has_path: true });
                pushUrl(primaryUrl);
            }

            if (!slots.length) {
                Object.entries(fd).forEach(([k, v]) => {
                    const kl = this._normalizeFieldName(k);
                    if (!kl || !this._isImageLikeFieldName(kl)) return;
                    const norm = this._normalizePhotoPath(v);
                    if (norm.url && !urls.includes(norm.url)) {
                        slots.push({ url: norm.url, has_path: true });
                        pushUrl(norm.url);
                    }
                });
            }

            if (!slots.length) slots.push({ url: null, has_path: false });
            return { slots, urls };
        },

        _defaultImageFieldName() {
            const defs = (this.tableFields || []).filter((f) => this._isPhotoFieldDef(f));
            if (defs.length) {
                return String(defs[0].name || 'PHOTO').trim() || 'PHOTO';
            }
            return 'PHOTO';
        },

        _getImageFormFields(sourceFieldData) {
            const source = sourceFieldData || {};
            const names = [];
            const seen = {};

            // 1. Prioritize explicit table definitions
            (this.tableFields || []).forEach((f) => {
                if (!this._isPhotoFieldDef(f)) return;
                const n = String(f.name || '').trim();
                if (!n) return;
                const lk = this._normalizeLookupKey(n);
                if (!lk || seen[lk]) return;
                seen[lk] = true;
                names.push(n);
            });

            // 2. Discover ad-hoc fields only if we haven't found enough in definitions
            //    or if they are very clearly intended (non-reference)
            const hasTablePhotos = names.length > 0;
            Object.keys(source).forEach((k) => {
                const key = String(k || '').trim();
                if (!key || !this._isImageLikeFieldName(key)) return;
                
                const lk = this._normalizeLookupKey(key);
                if (!lk || seen[lk]) return;

                // If table already defines photos, don't auto-add more from data keys 
                // unless it's a completely empty table definition.
                if (hasTablePhotos) return;

                seen[lk] = true;
                names.push(key);
            });

            if (!names.length) {
                names.push(this._defaultImageFieldName());
            }

            return names;
        },

        _initImageForm(sourceFieldData, sourceCard) {
            const fd = sourceFieldData || {};
            const card = sourceCard || {};
            this.imageFormFields = this._getImageFormFields(fd);

            const imageFiles = {};
            const imagePreviews = {};
            const imageHasPath = {};
            const imageRemoveFlags = {};

            this.imageFormFields.forEach((fieldName) => {
                const rawVal = this._getFieldValue(fd, [fieldName], '');
                const normalized = this._normalizePhotoPath(rawVal);
                imageFiles[fieldName] = null;
                imagePreviews[fieldName] = normalized.url || null;
                imageHasPath[fieldName] = !!normalized.hasPath;
                imageRemoveFlags[fieldName] = false;
            });

            const cardPhotoSlots = Array.isArray(card.photo_slots) ? card.photo_slots : [];
            if (cardPhotoSlots.length) {
                const slotsByField = {};
                cardPhotoSlots.forEach((slot) => {
                    if (!slot) return;
                    const slotField = slot.field_name || slot.field || slot.name || '';
                    const key = this._normalizeLookupKey(slotField);
                    if (key && !slotsByField[key]) {
                        slotsByField[key] = slot;
                    }
                });

                this.imageFormFields.forEach((fieldName, idx) => {
                    const key = this._normalizeLookupKey(fieldName);
                    const slot = (key && slotsByField[key]) || cardPhotoSlots[idx] || null;
                    if (!slot) return;
                    const normalizedSlot = this._normalizePhotoPath(slot.url || '');
                    imagePreviews[fieldName] = normalizedSlot.url || null;
                    imageHasPath[fieldName] = normalizedSlot.hasPath || !!slot.has_path;
                });
            }

            if (!Object.values(imagePreviews).some(Boolean) && card.photo_url) {
                const normalizedPrimary = this._normalizePhotoPath(card.photo_url);
                const first = this.imageFormFields[0];
                if (first) {
                    imagePreviews[first] = normalizedPrimary.url;
                    imageHasPath[first] = normalizedPrimary.hasPath;
                }
            }

            this.form.imageFiles = imageFiles;
            this.form.imagePreviews = imagePreviews;
            this.form.imageHasPath = imageHasPath;
            this.form.imageRemoveFlags = imageRemoveFlags;

            if (!this.activeImageField || !this.imageFormFields.includes(this.activeImageField)) {
                this.activeImageField = this.imageFormFields[0] || this._defaultImageFieldName();
            }
        },

        _imagePreview(fieldName) {
            return (this.form.imagePreviews || {})[fieldName] || null;
        },

        _imageHasPath(fieldName) {
            return !!((this.form.imageHasPath || {})[fieldName]);
        },

        _revokeBlobPreview(previewUrl) {
            if (!previewUrl || typeof previewUrl !== 'string') return;
            if (!previewUrl.startsWith('blob:')) return;
            try {
                URL.revokeObjectURL(previewUrl);
            } catch (_) {}
        },

        _clearImagePreview(fieldName) {
            if (!fieldName || !this.form || !this.form.imagePreviews) return;
            this._revokeBlobPreview(this.form.imagePreviews[fieldName]);
            this.form.imagePreviews[fieldName] = null;
        },

        _clearAllImagePreviews() {
            const previews = (this.form && this.form.imagePreviews) || {};
            Object.values(previews).forEach((previewUrl) => this._revokeBlobPreview(previewUrl));
        },

        removeImage(fieldName) {
            if (this.viewMode || this.addFormSubmitting) return;

            const targetField = fieldName || this.activeImageField || this._defaultImageFieldName();
            if (!targetField) return;

            if (!this.form.imageFiles) this.form.imageFiles = {};
            if (!this.form.imagePreviews) this.form.imagePreviews = {};
            if (!this.form.imageHasPath) this.form.imageHasPath = {};
            if (!this.form.imageRemoveFlags) this.form.imageRemoveFlags = {};

            const hadAnyValue = Boolean(
                this.form.imageFiles[targetField]
                || this.form.imagePreviews[targetField]
                || this.form.imageHasPath[targetField]
            );
            if (!hadAnyValue) {
                this.showToast('No photo to remove', 'info');
                return;
            }

            this.form.imageFiles[targetField] = null;
            this._clearImagePreview(targetField);
            this.form.imageHasPath[targetField] = false;
            this.form.imageRemoveFlags[targetField] = true;
            this.showImagePicker = false;
            this.showToast('Photo removed. Save changes to apply.', 'info');
        },

        startImageSelection(fieldName) {
            if (this.viewMode) return;
            this.activeImageField = fieldName || this.activeImageField || this._defaultImageFieldName();
            this.showImagePicker = true;
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
            el.classList.toggle('ring-2', sel);
            el.classList.toggle('ring-indigo-300', sel);
            el.classList.toggle('bg-indigo-100/55', sel);
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
            const photoMeta = this._buildPhotoSlotsFromCard({
                field_data: fd,
                photo_url: data.photo_url || null,
                photo_urls: Array.isArray(data.photo_urls) ? data.photo_urls : [],
            });
            const photoUrl = (photoMeta.urls && photoMeta.urls.length) ? photoMeta.urls[0] : null;
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
                photo_urls: photoMeta.urls || [],
                photo_slots: photoMeta.slots || [],
                has_photo: !!(photoMeta.urls && photoMeta.urls.length),
                status: String(data.status || LIST_TYPE),
                field_data: fd,
                display_fields: this._buildDisplayFieldsFromData(fd),
            };
        },

        async _fetchCardSnapshot(cardId) {
            const res = await fetch(buildEndpoint(MOBILE_ENDPOINTS.appApi, 'card/' + cardId + '/detail/'), {
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
            // New cards should appear first in the current list.
            this.studentsData.unshift(card);
            this._reindexSerialNumbers();
            this.loadMoreOffset = this.studentsData.length;
            this.visibleCount = this.studentsData.length;
            const mountEl = document.getElementById('dynamic-cards-mount');
            const firstCardEl = document.querySelector('[data-sid]');
            const newCardEl = this._buildCardDiv(card);
            if (firstCardEl && firstCardEl.parentNode) {
                firstCardEl.parentNode.insertBefore(newCardEl, firstCardEl);
            } else if (mountEl) {
                mountEl.prepend(newCardEl);
            } else {
                this._appendRenderedCard(card);
            }
            this.rebuildClassSectionOptions();
            this._applyAllFilters();
        },

        _wirePhotoFallbacks(rootEl) {
            const root = rootEl || document;
            root.querySelectorAll('.js-card-photo').forEach((img) => {
                if (img.dataset.fallbackBound === '1') return;
                img.dataset.fallbackBound = '1';

                const showFallback = () => {
                    img.style.display = 'none';
                    const fallback = img.nextElementSibling;
                    if (fallback && fallback.classList.contains('js-card-photo-fallback')) {
                        fallback.style.display = 'flex';
                    }
                };

                img.addEventListener('error', showFallback, { once: true });

                const src = String(img.getAttribute('src') || '').trim();
                if (!src) {
                    showFallback();
                    return;
                }

                // Catch failures that happened before handlers were bound.
                if (img.complete && img.naturalWidth === 0) {
                    showFallback();
                }
            });
        },

        // Build a <div> card element for a dynamically loaded card (loadMore)
        _buildCardDiv(card) {
            const fd = card.field_data || {};
            const photoBorderClass = this._statusPhotoBorderClasses(card.status);
            const noPhotoToneClass = 'bg-gray-100 text-gray-300';

            const photoMeta = this._buildPhotoSlotsFromCard(card);
            const photoSlots = photoMeta.slots || [];
            const photoHtml = photoSlots.length
                ? photoSlots.map((slot) => {
                    if (slot.url) {
                        return `<div class="rounded-xl overflow-hidden ${photoBorderClass} w-full" style="height:68px;"><img src="${this._escHtml(slot.url)}" class="js-card-photo w-full h-full object-cover object-top" alt="" loading="lazy"><div class="js-card-photo-fallback w-full h-full bg-amber-50 flex items-center justify-center text-amber-400" style="font-size:16px;display:none;"><i class="fa-solid fa-user-astronaut"></i></div></div>`;
                    }
                    if (slot.has_path) {
                        return `<div class="rounded-xl overflow-hidden ${photoBorderClass} w-full" style="height:68px;"><div class="w-full h-full bg-amber-50 text-amber-400 flex items-center justify-center" style="font-size:16px;"><i class="fa-solid fa-image"></i></div></div>`;
                    }
                    return `<div class="rounded-xl overflow-hidden ${photoBorderClass} w-full" style="height:68px;"><div class="w-full h-full ${noPhotoToneClass} flex items-center justify-center" style="font-size:16px;"><i class="fa-solid fa-user-slash"></i></div></div>`;
                }).join('')
                : `<div class="rounded-xl overflow-hidden ${photoBorderClass} w-full" style="height:68px;"><div class="w-full h-full ${noPhotoToneClass} flex items-center justify-center" style="font-size:16px;"><i class="fa-solid fa-user-slash"></i></div></div>`;

            const displayFields = Array.isArray(card.display_fields) && card.display_fields.length
                ? card.display_fields
                : this._buildDisplayFieldsFromData(fd);
            const fieldRows = displayFields
                .map(item => `<span class="text-gray-400 font-semibold pr-1.5 py-0.5 whitespace-normal break-words" style="font-size:11px;">${this._escHtml(String(item.key))}</span><span class="text-gray-700 py-0.5 text-right whitespace-normal break-words" style="font-size:11px;">${this._escHtml(String(item.value))}</span>`)
                .join('');

            const classPill = (card.class_name || card.section)
                ? `<span class="inline-flex items-center gap-1 mt-1 text-[11px] font-semibold text-indigo-700 bg-indigo-200/70 rounded-lg px-2 py-0.5 w-fit"><i class="fa-solid fa-graduation-cap text-[8px]"></i>${this._escHtml(card.class_name || '')}${card.class_name && card.section ? ' &bull; ' : ''}${this._escHtml(card.section || '')}</span>`
                : '';

            const nameHtml = card.name
                ? `<p class="font-bold text-gray-800 leading-tight" style="font-size:14px;">${this._escHtml(card.name)}</p>`
                : `<p class="font-semibold text-gray-300 leading-tight italic" style="font-size:13px;"> - </p>`;

            const cbHtml = !IS_VIEW_ONLY
                ? `<label class="custom-checkbox custom-checkbox-lg dyn-cb" style="cursor:pointer;"><input type="checkbox"><span class="checkmark"></span></label>`
                : '';
            const canEditCurrentList = (!IS_VIEW_ONLY && CAN_EDIT && !(typeof POOL_EDIT_LOCKED !== 'undefined' && POOL_EDIT_LOCKED));
            const editButtonHtml = canEditCurrentList
                ? `<div class="mt-2.5"><button type="button" class="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-200/70 rounded-lg px-2.5 py-1 active:opacity-70 transition-all js-edit-card" data-edit-id="${card.id}">Edit <i class="fa-solid fa-pen-to-square text-[9px]"></i></button></div>`
                : '';

            const div = document.createElement('div');
            div.setAttribute('data-sid', String(card.id));
            div.className = 'm-pop-card rounded-2xl overflow-hidden transition-all shadow-sm hover:shadow-md';
            div.innerHTML = `<div class="flex gap-3 p-3"><div class="flex flex-col items-center gap-1.5 flex-shrink-0" style="width:56px;">${cbHtml}${photoHtml}</div><div class="flex-1 min-w-0 flex flex-col">${nameHtml}${classPill}<div class="mt-2"><div class="grid text-[11px] leading-snug" style="grid-template-columns:minmax(0, 42%) minmax(0, 58%);">${fieldRows}</div></div>${editButtonHtml}</div></div>`;

            if (!IS_VIEW_ONLY && this.selectedIds.includes(Number(card.id))) {
                div.classList.add('ring-2', 'ring-indigo-300', 'bg-indigo-100/55');
            }

            const editButton = div.querySelector('.js-edit-card');
            if (editButton) {
                editButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openEditById(card.id);
                });
            }

            if (!IS_VIEW_ONLY) {
                const cb = div.querySelector('input[type=checkbox]');
                if (cb) {
                    cb.checked = this.selectedIds.includes(Number(card.id));
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
            let allowAutoChain = false;
            try {
                const page = this.loadMorePage + 1;
                const pageSize = Number(this.pageSize || 50);
                const params = new URLSearchParams();
                params.set('status', LIST_TYPE);
                params.set('per_page', String(pageSize));
                params.set('page', String(page));
                // Keep load-more pagination source aligned with first render.
                const searchValue = String(this.searchQuery || '').trim();
                if (searchValue) params.set('search', searchValue);
                if (this.filters.photo === 'with' || this.filters.photo === 'without') {
                    params.set('photo', this.filters.photo);
                }
                if (this.filters.selectedClass) params.set('class', this.filters.selectedClass);
                if (this.filters.selectedSection) params.set('section', this.filters.selectedSection);
                const sortMode = normalizeMobileSortMode(this.filters.sortMode);
                if (sortMode !== 'sr-asc') params.set('sort', sortMode);
                if (LIST_TYPE === 'download') {
                    if (this.filters.dateFrom) params.set('from', this.filters.dateFrom);
                    if (this.filters.dateTo) params.set('to', this.filters.dateTo);
                }

                const url = buildEndpoint(MOBILE_ENDPOINTS.appApi, `table/${TABLE_ID}/cards/`) + `?${params.toString()}`;
                const res = await fetch(url, { headers: { 'X-CSRFToken': CSRF } });
                const json = await res.json();
                if (!json.success) { this.showToast('Failed to load more', 'error'); return; }
                const apiData = json.data;
                allowAutoChain = true;
                const apiTotal = Number(apiData.total);
                if (Number.isFinite(apiTotal)) {
                    this.totalRecords = Math.max(0, apiTotal);
                }
                const existingIds = new Set(this.studentsData.map(s => s.id));
                const rawCards = apiData.cards || [];
                this.loadMorePage = page;
                const newCards = rawCards
                    .filter(c => !existingIds.has(c.id))
                    .map((c, i) => {
                        const f = c.field_data || {};
                        const rawPhotoUrls = Array.isArray(c.photo_urls) ? c.photo_urls : (c.photo_url ? [c.photo_url] : []);
                        const photoMeta = this._buildPhotoSlotsFromCard({
                            field_data: f,
                            photo_url: c.photo_url || null,
                            photo_urls: rawPhotoUrls,
                        });
                        const resolvedPhotoUrl = (photoMeta.urls && photoMeta.urls.length) ? photoMeta.urls[0] : null;
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
                            photo_url: resolvedPhotoUrl,
                            photo_urls: photoMeta.urls || [],
                            photo_slots: photoMeta.slots || [],
                            has_photo: !!(photoMeta.urls && photoMeta.urls.length),
                            status: c.status,
                            downloaded_date: c.downloaded_date || '',
                            field_data: f,
                            display_fields: this._buildDisplayFieldsFromData(f),
                        };
                    });
                if (!newCards.length) {
                    // Keep pagination moving even if this page contained duplicate IDs.
                    this.hasMore = !!apiData.has_more;
                    this.loadMoreOffset += rawCards.length || pageSize;
                    if (!silent && !this.hasMore) this.showToast('All records loaded', 'info');
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
                    if (!silent) this.showToast('All ' + this.totalRecords + ' records loaded', 'info');
                } else if (!silent) {
                    this.showToast('+' + newCards.length + ' loaded', 'success');
                }
                const hasServerFilters = this._computeFiltersActive();
                if (hasServerFilters) {
                    this.rebuildClassSectionOptions();
                    this.visibleCount = this.studentsData.length;
                } else {
                    this.visibleCount = this.studentsData.length;
                }
            } catch (e) { this.showToast('Load failed', 'error'); }
            finally {
                this.loading = false;
                if (allowAutoChain) {
                    this._queueNextPageIfNeeded();
                }
            }
        },

        // --------- API helpers ---------
        async apiAction(status, label) {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            const actedIds = [...this.selectedIds];
            let keepSelected = [];
            this.actionLoading = true;
            this.loading = true;
            var _ac = new AbortController();
            setTimeout(function() { _ac.abort(); }, 120000);
            try {
                const chunks = [];
                for (let i = 0; i < actedIds.length; i += 500) {
                    chunks.push(actedIds.slice(i, i + 500));
                }

                const processedSet = new Set();
                const skippedSet = new Set();
                let firstErrorMessage = '';
                let lastSuccessMessage = '';

                for (let i = 0; i < chunks.length; i += 1) {
                    const batch = chunks[i];
                    const res = await fetch(buildEndpoint(MOBILE_ENDPOINTS.appApi, 'table/' + TABLE_ID + '/bulk-status/'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                        body: JSON.stringify({ card_ids: batch, status: status }),
                        signal: _ac.signal,
                    });

                    if (!res.ok && !(res.headers.get('content-type') || '').includes('application/json')) {
                        firstErrorMessage = 'Server error (' + res.status + ')';
                        break;
                    }

                    const data = await res.json().catch(() => ({}));
                    if (!data.success) {
                        firstErrorMessage = data.message || 'Action failed';
                        break;
                    }

                    if (data.message) {
                        lastSuccessMessage = String(data.message);
                    }

                    batch.forEach((id) => processedSet.add(Number(id)));
                    (data.skipped_ids || []).forEach((id) => skippedSet.add(Number(id)));
                }

                if (!processedSet.size) {
                    this.showToast(firstErrorMessage || 'Action failed', 'error');
                } else {
                    const processedIds = actedIds.filter((id) => processedSet.has(Number(id)));
                    const movedIds = processedIds.filter((id) => !skippedSet.has(Number(id)));
                    keepSelected = actedIds.filter((id) => !processedSet.has(Number(id)) || skippedSet.has(Number(id)));
                    const movedCount = movedIds.length;
                    const skippedCount = skippedSet.size;

                    if (firstErrorMessage) {
                        this.showToast(`${movedCount} ${label}. Some records were not processed.`, 'info');
                    } else if (skippedCount > 0) {
                        this.showToast(lastSuccessMessage || `${movedCount} ${label}. ${skippedCount} skipped.`, 'info');
                    } else {
                        this.showToast(lastSuccessMessage || `${movedCount} ${label}`, 'success');
                    }

                    // Update top badge counts immediately without waiting for reload.
                    if (status !== LIST_TYPE && movedCount > 0) {
                        this._bumpTabCounts(LIST_TYPE, status, movedCount);
                    }

                    // If status changed away from the current list, remove rows in-place.
                    if (status !== LIST_TYPE && movedCount > 0) {
                        this._removeCardsFromCurrentList(movedIds);
                    }
                }
            } catch (e) { this.showToast(e.name === 'AbortError' ? 'Request timed out' : 'Network error', 'error'); }
            this.loading = false;
            this.selectedIds = keepSelected;
            if (!this.selectedIds.length) this.selectAll = false;
            document.querySelectorAll('[data-sid]').forEach(el => {
                this._updateRowClass(Number(el.getAttribute('data-sid')));
            });
            this.actionLoading = false;
        },

        // Add/Edit form methods
        addNew() {
            this.viewMode = false;
            this.editMode = false;
            this.editingId = null;
            this.resetForm();
            this.showAddForm = true;
        },
        populateFormFromStudent(student) {
            const fd = (student && student.field_data) || {};
            // In edit mode, expose all table fields so users can fill previously empty columns.
            this._initDynamicForm(fd, true);
            this._initImageForm(fd, student || {});
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
        },
        async openEditById(cardId) {
            const isEditLockedForList = IS_VIEW_ONLY || !CAN_EDIT || (typeof POOL_EDIT_LOCKED !== 'undefined' && POOL_EDIT_LOCKED);
            if (isEditLockedForList) {
                this.showToast('Edit is not allowed in this list', 'error');
                return;
            }
            const editId = Number(cardId);
            let student = this.studentsData.find(s => Number(s.id) === editId);
            if (!student) { this.showToast('Card not found', 'error'); return; }

            try {
                const latestCard = await this._fetchCardSnapshot(editId);
                this._upsertStudentCard(latestCard, 'edit');
                student = latestCard;
            } catch (e) {
                // Fall back to currently loaded list data if snapshot fetch fails.
            }

            this.selectedIds = [editId];
            this.viewMode = false;
            this.editMode = true;
            this.editingId = editId;
            this.populateFormFromStudent(student);
            this.showAddForm = true;
        },
        async editSelected() {
            const isEditLockedForList = IS_VIEW_ONLY || !CAN_EDIT || (typeof POOL_EDIT_LOCKED !== 'undefined' && POOL_EDIT_LOCKED);
            if (isEditLockedForList) {
                this.showToast('Edit is not allowed in this list', 'error');
                return;
            }
            if (!this.selectedIds.length) { this.showToast('Select a card first', 'error'); return; }
            return this.openEditById(this.selectedIds[0]);
        },
        closeAddForm(forceClose) {
            if (this.addFormSubmitting && !forceClose) return;
            this._clearAllImagePreviews();
            this.showAddForm = false;
            this.showImagePicker = false;
            this.viewMode = false;
            this.editMode = false;
            this.editingId = null;
            this.addFormSubmitting = false;
            this.reprintPendingAfterEdit = false;
            this.reprintPendingCardIds = [];
        },
        resetForm() {
            this._clearAllImagePreviews();
            this.form = {
                dynamicValues: {},
                imageFiles: {},
                imagePreviews: {},
                imageHasPath: {},
                imageRemoveFlags: {},
            };
            this._initDynamicForm({});
            this._initImageForm({}, {});
            this.showImagePicker = false;
        },
        openImagePicker(fieldName) {
            if (this.viewMode) return;
            this.activeImageField = fieldName || this.activeImageField || this._defaultImageFieldName();
            this.showImagePicker = !this.showImagePicker;
        },
        takePhoto() {
            if (this.viewMode || this.addFormSubmitting) return;
            
            // Always use the native OS camera input for both Add and Edit modes.
            // It reliably bypasses browser permission issues and orientation bugs.
            if (this.$refs.cameraInput) this.$refs.cameraInput.click();
            this.showImagePicker = false;
        },
        pickFromGallery() {
            if (this.viewMode || this.addFormSubmitting) return;
            if (this.$refs.galleryInput) this.$refs.galleryInput.click();
            this.showImagePicker = false;
        },
        handleImageSelected(event) {
            const file = event.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) { 
                this.showToast('Please select an image file', 'error'); 
                return; 
            }
            if (file.size > 15 * 1024 * 1024) { 
                this.showToast('Image is too large (max 15MB)', 'error'); 
                return; 
            }

            const targetField = this.activeImageField || this._defaultImageFieldName();
            if (!this.form.imageFiles) this.form.imageFiles = {};
            if (!this.form.imagePreviews) this.form.imagePreviews = {};
            if (!this.form.imageHasPath) this.form.imageHasPath = {};
            if (!this.form.imageRemoveFlags) this.form.imageRemoveFlags = {};

            this._clearImagePreview(targetField);

            let previewUrl = null;
            try {
                previewUrl = URL.createObjectURL(file);
            } catch (_) {
                previewUrl = null;
            }

            this.form.imageFiles[targetField] = file;
            this.form.imagePreviews[targetField] = previewUrl;
            this.form.imageHasPath[targetField] = true;
            this.form.imageRemoveFlags[targetField] = false;

            if (previewUrl) {
                this.showToast('Photo selected successfully', 'success');
            } else {
                this.showToast('Photo selected, but preview could not be created', 'info');
            }
            
            // Reset the input so the same file can be picked again if needed
            event.target.value = '';
        },
        async submitAddForm() {
            if (this.viewMode) {
                this.closeAddForm();
                return;
            }
            if (this.addFormSubmitting) return;
            this.addFormSubmitting = true;
            this.loading = true;
            try {
                const url = this.editMode
                    ? buildEndpoint(MOBILE_ENDPOINTS.appApi, 'table/' + TABLE_ID + '/card/' + this.editingId + '/update/')
                    : buildEndpoint(MOBILE_ENDPOINTS.appApi, 'table/' + TABLE_ID + '/card/add/');
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
                    return;
                }

                const hasNameField = (this.dynamicFormFields || []).some((field) => {
                    const n = this._normalizeFieldName(field.name);
                    return n === 'name' || n.includes('name');
                });
                const resolvedName = this._resolveStudentName(fieldData, '').trim();
                if (hasNameField && !resolvedName) {
                    this.showToast('Name is required', 'error');
                    return;
                }

                Object.entries(this.form.imageRemoveFlags || {}).forEach(([fieldName, shouldRemove]) => {
                    if (!shouldRemove) return;
                    fieldData[fieldName] = '';
                });
                fd.append('field_data', JSON.stringify(fieldData));
                Object.entries(this.form.imageFiles || {}).forEach(([fieldName, fileObj]) => {
                    if (!fileObj) return;
                    fd.append('image_' + fieldName, fileObj);
                });

                try {
                    const _ac2 = new AbortController();
                    const uploadTimeoutMs = estimateMobileUploadTimeoutMs(this.form.imageFiles || {});
                    const _submitTimeout = setTimeout(() => { _ac2.abort(); }, uploadTimeoutMs);
                    let res;
                    try {
                        res = await fetch(url, { method: 'POST', headers: { 'X-CSRFToken': CSRF }, body: fd, signal: _ac2.signal });
                    } finally {
                        clearTimeout(_submitTimeout);
                    }
                    if (!res.ok && !(res.headers.get('content-type') || '').includes('application/json')) {
                        this.showToast('Server error (' + res.status + ')', 'error');
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
                                        const fallbackSlots = (this.imageFormFields || []).map((fieldName, slotIdx) => {
                                            const wasRemoved = !!((this.form.imageRemoveFlags || {})[fieldName]);
                                            const previewUrl = (this.form.imagePreviews || {})[fieldName]
                                                || ((existing.photo_slots || [])[slotIdx] || {}).url
                                                || null;
                                            const hasPath = !!(
                                                !wasRemoved && (
                                                (this.form.imageHasPath || {})[fieldName]
                                                || ((existing.photo_slots || [])[slotIdx] || {}).has_path
                                                || previewUrl
                                                )
                                            );
                                            return {
                                                url: wasRemoved ? null : previewUrl,
                                                has_path: wasRemoved ? false : hasPath,
                                            };
                                        });
                                        const fallbackUrls = fallbackSlots.map((slot) => slot.url).filter(Boolean);
                                        const fallbackCard = Object.assign({}, existing, {
                                            name: summary.name,
                                            roll_no: summary.roll_no,
                                            father_name: summary.father_name,
                                            mother_name: summary.mother_name,
                                            class_name: summary.class_name,
                                            section: summary.section,
                                            dob: summary.dob,
                                            photo_url: fallbackUrls.length ? fallbackUrls[0] : existing.photo_url,
                                            photo_urls: fallbackUrls.length ? fallbackUrls : (existing.photo_urls || []),
                                            photo_slots: fallbackSlots.length ? fallbackSlots : (existing.photo_slots || []),
                                            has_photo: fallbackUrls.length ? true : !!(existing.has_photo),
                                            field_data: mergedFieldData,
                                            display_fields: this._buildDisplayFieldsFromData(mergedFieldData),
                                        });
                                        this._upsertStudentCard(fallbackCard, 'edit');
                                    }
                                } else if (LIST_TYPE === 'pending' && cardId) {
                                    const fallbackSummary = this._summarizeCardFromFieldData(fieldData);
                                    const fallbackFieldData = Object.assign({}, fieldData);
                                    const fallbackSlots = (this.imageFormFields || []).map((fieldName) => ({
                                        url: (this.form.imagePreviews || {})[fieldName] || null,
                                        has_path: !!((this.form.imageHasPath || {})[fieldName]),
                                    }));
                                    const fallbackUrls = fallbackSlots.map((slot) => slot.url).filter(Boolean);
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
                                        photo_url: fallbackUrls.length ? fallbackUrls[0] : null,
                                        photo_urls: fallbackUrls,
                                        photo_slots: fallbackSlots,
                                        has_photo: !!fallbackUrls.length,
                                        status: 'pending',
                                        field_data: fallbackFieldData,
                                        display_fields: this._buildDisplayFieldsFromData(fallbackFieldData),
                                    };
                                    this._upsertStudentCard(fallbackCard, 'add');
                                }
                            }

                            await this.refreshFilterOptionsFromServer();

                            if (!this.editMode) {
                                this.tabCounts.pending = Number(this.tabCounts.pending || 0) + 1;
                            }
                        }

                        const reprintAfterEdit = !!(this.reprintPendingAfterEdit && this.editMode && cardId);
                        this.closeAddForm(true);

                        if (reprintAfterEdit) {
                            const ok = await this._createReprintRequest([cardId]);
                            this.reprintPendingAfterEdit = false;
                            this.reprintPendingCardIds = [];
                            if (ok) this.fetchReprintList();
                        }
                    } else { this.showToast(data.message || 'Failed', 'error'); }
                } catch (e) {
                    if (e && e.name === 'AbortError') {
                        this.showToast('Upload timed out on mobile network. Please retry.', 'error');
                    } else {
                        this.showToast('Network error while uploading images', 'error');
                    }
                }
            } finally {
                this.loading = false;
                this.addFormSubmitting = false;
            }
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
        unverifySelected() { this.apiAction('pending', 'unverified'); },
        approveSelected() { this.apiAction('approved', 'approved'); },
        unapproveSelected() { this.apiAction('verified', 'unapproved'); },
        toggleActionMenu() {
            if (!this.selectedIds.length) {
                this.actionMenuOpen = false;
                this.showToast('Select items first', 'error');
                return;
            }
            this.actionMenuOpen = !this.actionMenuOpen;
        },
        closeActionMenu() {
            this.actionMenuOpen = false;
        },
        runActionMenu(action) {
            this.actionMenuOpen = false;
            if (action === 'verify') {
                this.verifySelected();
            } else if (action === 'unverify') {
                this.unverifySelected();
            } else if (action === 'approve') {
                this.approveSelected();
            } else if (action === 'disapprove') {
                this.unapproveSelected();
            } else if (action === 'retrieve') {
                this.retrieveSelected();
            }
        },
        async downloadPDF() {
            let idsToDownload = [...this.selectedIds];
            if (!idsToDownload.length) {
                // If nothing selected, download all (load all if needed)
                if (this.hasMore) {
                    this.showToast('Loading all records for download...', 'info');
                    await this.loadAllDataForFiltering();
                }
                idsToDownload = this.studentsData.map(s => s.id);
            }
            if (!idsToDownload.length) { this.showToast('No cards to download', 'error'); return; }
            this.showDownloadModal('pdf', idsToDownload.length);
            try {
                const pollTask = async (taskId) => {
                    for (let i = 0; i < 300; i++) {
                        if (this.downloadModal.abortController?.signal?.aborted) {
                            throw new Error('AbortError');
                        }
                        const statusRes = await fetch(buildEndpoint(MOBILE_ENDPOINTS.panelApi, 'export/status/' + taskId + '/'), {
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
                const res = await fetch(buildEndpoint(MOBILE_ENDPOINTS.panelApi, 'table/' + TABLE_ID + '/cards/download-pdf-async/'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                    body: JSON.stringify({ card_ids: idsToDownload, status: LIST_TYPE }),
                    signal: this.downloadModal.abortController?.signal,
                });
                this.updateDownloadProgress(50, 'Processing PDF...');
                const ct = res.headers.get('content-type') || '';
                if ((res.status === 202 || res.ok) && ct.includes('application/json')) {
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
            let idsToDownload = [...this.selectedIds];
            if (!idsToDownload.length) {
                // If nothing selected, download all (load all if needed)
                if (this.hasMore) {
                    this.showToast('Loading all records for download...', 'info');
                    await this.loadAllDataForFiltering();
                }
                idsToDownload = this.studentsData.map(s => s.id);
            }
            if (!idsToDownload.length) { this.showToast('No cards to download', 'error'); return; }
            this.showDownloadModal('img', idsToDownload.length);

            // Large exports: use async background task flow to avoid request timeouts.
            if (idsToDownload.length >= 500) {
                try {
                    await this._startMobileAsyncExport('zip', idsToDownload, {
                        startText: 'Starting image export...',
                        queueText: 'Queued for background image export...',
                        progressText: 'Preparing image ZIP...',
                        readyText: 'Saving image ZIP...',
                        successText: 'Image ZIP saved to your device',
                        failText: 'Image export failed',
                        timeoutText: 'Image export timed out',
                        fallbackFilename: 'images.zip',
                    });
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    this.completeDownload(false, 'Image export failed');
                }
                return;
            }

            try {
                this.updateDownloadProgress(10, 'Preparing images...');
                const res = await fetch(buildEndpoint(MOBILE_ENDPOINTS.panelApi, 'table/' + TABLE_ID + '/cards/download-images/'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                    body: JSON.stringify({ card_ids: idsToDownload, status: LIST_TYPE }),
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
        async _moveCardsToDownloadAfterXlsx(cardIds) {
            const ids = Array.isArray(cardIds) ? cardIds.map(Number).filter(Boolean) : [];
            if (LIST_TYPE !== 'approved' || !ids.length) return;

            try {
                const res = await fetch(buildEndpoint(MOBILE_ENDPOINTS.appApi, 'table/' + TABLE_ID + '/bulk-status/'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                    body: JSON.stringify({ card_ids: ids, status: 'download' }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    this.showToast(data.message || 'Downloaded, but move to Download list failed', 'error');
                    return;
                }

                const skippedSet = new Set((data.skipped_ids || []).map(Number));
                const movedIds = ids.filter(id => !skippedSet.has(Number(id)));
                if (movedIds.length) {
                    this._bumpTabCounts('approved', 'download', movedIds.length);
                    this._removeCardsFromCurrentList(movedIds);
                    this.selectedIds = this.selectedIds.filter(id => skippedSet.has(Number(id)));
                }
            } catch (e) {
                this.showToast('Downloaded, but failed to move cards to Download list', 'error');
            }
        },
        async downloadXLSX() {
            if (this.loading) return;

            let idsToDownload = [...this.selectedIds];
            if (!idsToDownload.length) {
                // No explicit selection: export all rows in current filtered list.
                if (this.hasMore) {
                    this.showToast('Loading all records for Excel export...', 'info');
                    await this.loadAllDataForFiltering();
                }
                idsToDownload = this.studentsData.map(s => Number(s.id)).filter(Boolean);
            }
            if (!idsToDownload.length) {
                this.showToast('No cards to export', 'error');
                return;
            }

            this.actionLoading = true;
            this.loading = true;

            // Large exports: use async background task flow like PDF.
            if (idsToDownload.length >= 500) {
                this.showDownloadModal('xlsx', idsToDownload.length);
                try {
                    await this._startMobileAsyncExport('xlsx', idsToDownload, {
                        startText: 'Starting Excel export...',
                        queueText: 'Queued for background Excel export...',
                        progressText: 'Building spreadsheet...',
                        readyText: 'Saving Excel file...',
                        successText: 'Excel file saved to your device',
                        failText: 'Excel export failed',
                        timeoutText: 'Excel export timed out',
                        fallbackFilename: 'export.xlsx',
                        afterSuccess: async () => {
                            if (LIST_TYPE === 'approved') {
                                await this._moveCardsToDownloadAfterXlsx(idsToDownload);
                            }
                        },
                    });
                } catch (e) {
                    if (e.name !== 'AbortError') {
                        this.completeDownload(false, 'Excel export failed');
                    }
                }
                this.loading = false;
                this.actionLoading = false;
                return;
            }

            try {
                const res = await fetch(buildEndpoint(MOBILE_ENDPOINTS.panelApi, 'table/' + TABLE_ID + '/cards/download-xlsx/'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
                    body: JSON.stringify({ card_ids: idsToDownload, status: LIST_TYPE }),
                });

                const ct = (res.headers.get('content-type') || '').toLowerCase();
                if (!res.ok || ct.includes('application/json')) {
                    const errData = await res.json().catch(() => ({}));
                    this.showToast(errData.message || 'Excel export failed', 'error');
                    this.loading = false;
                    this.actionLoading = false;
                    return;
                }

                const blob = await res.blob();
                const filename = 'cards_' + TABLE_ID + '_' + LIST_TYPE + '.xlsx';
                const link = document.createElement('a');
                const url = URL.createObjectURL(blob);
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);

                this.showToast('Excel file downloaded', 'success');

                // Desktop parity: Approved list exports should move cards to Download list.
                if (LIST_TYPE === 'approved') {
                    await this._moveCardsToDownloadAfterXlsx(idsToDownload);
                }
            } catch (e) {
                this.showToast('Excel export failed', 'error');
            }
            this.loading = false;
            this.actionLoading = false;
        },
        downloadAgain() { this.apiAction('download', 're-downloaded'); },
        async _permanentlyDeleteSelected() {
            if (LIST_TYPE !== 'pool') return;
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            const requestedIds = [...this.selectedIds];
            const deletedIds = [];
            this.actionLoading = true;
            this.loading = true;
            let success = 0, failed = 0;
            for (const id of requestedIds) {
                try {
                    const res = await fetch(buildEndpoint(MOBILE_ENDPOINTS.appApi, 'card/' + id + '/delete/'), {
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
            this.actionLoading = false;
        },
        async permanentlyDelete() {
            await this._permanentlyDeleteSelected();
        },
        retrieveSelected() { this.apiAction('pending', 'retrieved to pending'); },
    }
}
