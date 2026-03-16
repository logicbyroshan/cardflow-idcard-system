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
        visibleCount: typeof STUDENTS_DATA !== 'undefined' ? STUDENTS_DATA.length : 0,
        tableFields: Array.isArray(TABLE_FIELDS) ? TABLE_FIELDS : [],
        tabCounts: TAB_COUNTS || { pending: 0, verified: 0, approved: 0, download: 0 },
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

            // Deep-link support from search page: ?focus_card=<id>
            const params = new URLSearchParams(window.location.search || '');
            const focusCardId = parseInt(params.get('focus_card') || '', 10);
            if (focusCardId) {
                this.$nextTick(() => {
                    this.focusCardById(focusCardId);
                });
            }
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
        resetFilters() {
            this.filters = { photo: 'all', selectedClass: '', selectedSection: '', dateFrom: '', dateTo: '' };
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
                this.filters.dateTo !== ''
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

        _isExcludedField(name) {
            const n = this._normalizeFieldName(name);
            if (!n) return true;
            if (n.includes('photo') || n.includes('image')) return true;
            return ['name', 'class', 'section', 'designation'].includes(n);
        },

        _buildDisplayFieldsFromData(fd) {
            const source = fd || {};
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
                if (!item || !item.value) return;
                ordered.push(item);
                used.add(lower);
            });

            Object.entries(source).forEach(([k, v]) => {
                const lower = this._normalizeFieldName(k);
                if (!lower || used.has(lower) || this._isExcludedField(lower) || !v) return;
                ordered.push({ key: k, value: v });
                used.add(lower);
            });

            return ordered;
        },

        _statusPhotoBorderClasses(status) {
            if (status === 'pending') return 'border border-gray-200 border-t-4 border-b-4 border-t-amber-400 border-b-amber-400';
            if (status === 'verified') return 'border border-gray-200 border-t-4 border-b-4 border-t-green-400 border-b-green-400';
            if (status === 'approved') return 'border border-gray-200 border-t-4 border-b-4 border-t-blue-400 border-b-blue-400';
            if (status === 'download') return 'border border-gray-200 border-t-4 border-b-4 border-t-purple-400 border-b-purple-400';
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
            this._reindexSerialNumbers();
            this._applyAllFilters();
        },

        // Build a <div> card element for a dynamically loaded card (loadMore)
        _buildCardDiv(card) {
            const fd = card.field_data || {};
            const photoBorderClass = this._statusPhotoBorderClasses(card.status);

            const photoUrls = (card.photo_urls && card.photo_urls.length) ? card.photo_urls : (card.photo_url ? [card.photo_url] : []);
            const photoHtml = photoUrls.length
                ? photoUrls.map(url => `<div class="rounded-xl overflow-hidden ${photoBorderClass} w-full" style="height:68px;"><img src="${this._escHtml(url)}" class="w-full h-full object-cover object-top" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="w-full h-full bg-amber-50 flex items-center justify-center text-amber-400" style="font-size:16px;display:none;"><i class="fa-solid fa-user-astronaut"></i></div></div>`).join('')
                : `<div class="rounded-xl overflow-hidden ${photoBorderClass} w-full" style="height:68px;"><div class="w-full h-full bg-gray-100 flex items-center justify-center text-gray-300" style="font-size:16px;"><i class="fa-solid fa-user-slash"></i></div></div>`;

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
            div.className = 'bg-white rounded-2xl border border-gray-100 overflow-hidden transition-all shadow-sm hover:shadow-md' + (!IS_VIEW_ONLY ? ' cursor-pointer' : '');
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
                div.addEventListener('click', (e) => {
                    if (e.target.closest('label, input, a')) return;
                    this.toggleSelect(card.id);
                });
                const cb = div.querySelector('input[type=checkbox]');
                if (cb) {
                    cb.addEventListener('change', (e) => { e.stopPropagation(); this.toggleSelect(card.id); });
                    cb.closest('label').addEventListener('click', e => e.stopPropagation());
                }
            }
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
                            photo_urls: c.photo_url ? [c.photo_url] : [],
                            has_photo: !!c.photo_url,
                            status: c.status,
                            field_data: f,
                            display_fields: this._buildDisplayFieldsFromData(f),
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
                const mountEl = document.getElementById('dynamic-cards-mount');
                if (mountEl) {
                    newCards.forEach(card => mountEl.appendChild(this._buildCardDiv(card)));
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
            const actedIds = [...this.selectedIds];
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

                    // Update top badge counts immediately without waiting for reload.
                    if (status !== LIST_TYPE) {
                        this._bumpTabCounts(LIST_TYPE, status, actedIds.length);
                    }

                    // If status changed away from the current list, remove rows in-place.
                    if (status !== LIST_TYPE) {
                        this._removeCardsFromCurrentList(actedIds);
                    }
                } else {
                    this.showToast(data.message || 'Action failed', 'error');
                }
            } catch (e) { this.showToast(e.name === 'AbortError' ? 'Request timed out' : 'Network error', 'error'); }
            this.loading = false;
            this.selectedIds = [];
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
            this.form = {
                name: (student && student.name) || '',
                fatherName: fd['FATHER NAME'] || fd["FATHER'S NAME"] || fd['FATHER_NAME'] || fd['father_name'] || student.father_name || '',
                motherName: fd['MOTHER NAME'] || fd["MOTHER'S NAME"] || fd['MOTHER_NAME'] || fd['mother_name'] || '',
                rollNo: (student && student.roll_no) || '',
                dob: (student && student.dob) || '',
                className: (student && student.class_name) || '',
                section: (student && student.section) || '',
                phone: fd['PHONE'] || fd['MOBILE'] || fd['MOBILE NO'] || fd['phone'] || '',
                address: fd['ADDRESS'] || fd['PERMANENT ADDRESS'] || fd['address'] || '',
                bloodGroup: fd['BLOOD GROUP'] || fd['blood_group'] || '',
                aadhar: fd['AADHAR'] || fd['AADHAAR'] || fd['AADHAR NO'] || fd['aadhar'] || '',
                photoFile: null,
                photoPreview: (student && student.photo_url) || null,
            };
        },
        openViewById(cardId) {
            const viewId = Number(cardId);
            const student = this.studentsData.find(s => Number(s.id) === viewId);
            if (!student) { this.showToast('Card not found in current list', 'error'); return; }
            this.selectedIds = [viewId];
            this.viewMode = true;
            this.editMode = false;
            this.editingId = null;
            this.populateFormFromStudent(student);
            this.showAddForm = true;
            document.body.style.overflow = 'hidden';
        },
        editSelected() {
            if (!this.selectedIds.length) { this.showToast('Select a card first', 'error'); return; }
            const editId = this.selectedIds[0];
            const student = this.studentsData.find(s => s.id === editId);
            if (!student) { this.showToast('Card not found', 'error'); return; }
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
                name: '', fatherName: '', motherName: '', rollNo: '', dob: '',
                className: '', section: '', phone: '', address: '',
                bloodGroup: '', aadhar: '', photoFile: null, photoPreview: null,
            };
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
                    setTimeout(() => { window.location.href = window.location.pathname + '?t=' + Date.now(); }, 800);
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
        deleteSelected() { this.permanentlyDelete(); },
        verifySelected() { this.apiAction('verified', 'verified'); },
        approveSelected() { this.apiAction('approved', 'approved'); },
        unapproveSelected() { this.apiAction('verified', 'unapproved'); },
        async downloadPDF() {
            if (!this.selectedIds.length) { this.showToast('Select items first', 'error'); return; }
            this.showDownloadModal('pdf', this.selectedIds.length);
            try {
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
                } else {
                    const data = await res.json().catch(() => ({}));
                    this.completeDownload(false, data.message || 'PDF generation failed');
                }
            } catch (e) {
                if (e.name === 'AbortError') return; // Cancelled by user
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
                if (data.success && data.zip_files && data.zip_files.length > 0) {
                    const totalZips = data.zip_files.length;
                    let downloaded = 0;
                    // Download each ZIP file
                    for (const zipInfo of data.zip_files) {
                        const progress = 40 + Math.round((downloaded / totalZips) * 50);
                        this.updateDownloadProgress(progress, 'Downloading ' + (downloaded + 1) + ' of ' + totalZips + '...');
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
                        downloaded++;
                    }
                    const totalSize = data.zip_files.reduce((sum, z) => sum + (z.data?.length || 0) * 0.75, 0);
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
