/**
 * Virtual Table Renderer for ID Card Actions
 *
 * Replaces the server-rendered table body with a virtualised view that
 * keeps only ~50 TR elements in the DOM regardless of total card count.
 * Fetches card data from the JSON API and renders on-demand as the user scrolls.
 *
 * Activation: Set  window.USE_VIRTUAL_TABLE = true  BEFORE this script loads.
 * Data source: GET /api/table/{id}/cards-json/
 *
 * Architecture:
 *   _allCards[]         all card objects fetched from server so fa-regular
 *   _filteredCards[]    subset after client-side image-sort / sort
 *   _pool[]             fixed array of pre-created TR elements
 *                         rebound to different card data as user scrolls
 *   spacerTop/Bottom    empty TR whose height represents un-rendered rows
 *   sentinel            TR at bottom; IntersectionObserver triggers next fetch
 *
 * @module idcard/table-render
 * @version 1.0.0
 */
(function () {
    'use strict';

    // 
    // FEATURE GATE
    // 
    if (!window.USE_VIRTUAL_TABLE) return;

    // 
    // TUNABLES
    // 
    var DEFAULT_ROW_HEIGHT = 57;   // px  refined after first paint
    var OVERSCAN           = 10;   // extra rows above & below viewport
    var FETCH_BATCH        = 100;  // cards per server request
    var FETCH_AHEAD        = 30;   // start fetch when within N rows of data end

    // 
    // STATE
    // 
    var _allCards       = [];
    var _filteredCards  = [];
    var _totalServer    = 0;
    var _serverHasMore  = false;
    var _isFetching     = false;
    var _nextOffset     = 0;
    var _fetchSeq       = 0;       // monotonic  stale-response guard
    var _rowHeight      = DEFAULT_ROW_HEIGHT;
    var _measured       = false;

    // Virtual scroll indices
    var _startIdx = 0;
    var _endIdx   = 0;
    var _rafId    = 0;

    // Selection tracking (survives scroll / rebind)
    var _selectedIds = new Set();

    // DOM
    var _scrollEl    = null;       // .idcard-table scroll container
    var _tbody       = null;       // #cardsTableBody
    var _spacerTopTd = null;
    var _spacerBotTd = null;
    var _sentinel    = null;
    var _pool        = [];         // Array of PoolEntry objects
    var _observer    = null;
    var _emptyRow    = null;

    // Column layout (built once from <thead>)
    var _cols      = [];           // [{ name, type, isImage, imgClass, widthClass }]
    var _totalCols = 0;

    // Page globals cache
    var _status          = '';
    var _tableId         = 0;
    var _perms           = {};
    var _isClientReadonly = false;

    // Client-side filter / sort state
    var _searchQuery    = '';
    var _imageSort      = null;    // { column, condition }
    var _sortMode       = 'sr-asc';
    var _searchTimer    = 0;

    // 
    // UTILITY HELPERS
    // 
    function _imageTypeClass(name) {
        if (!name) return 'photo-type';
        var n = name.toLowerCase();
        if (/\bsign\b|\bsignature\b/.test(n)) return 'signature-type';
        if (/\bqr\b/.test(n))                 return 'qr-type';
        if (/\bbarcode\b/.test(n))            return 'barcode-type';
        return 'photo-type';
    }

    function _tdWidthClass(name, type) {
        if (window.FieldClassifier) return window.FieldClassifier.tdClass(name, type);
        // Fallback if FieldClassifier not loaded yet
        if (!name) return 'min-w-[80px] whitespace-normal break-words';
        return 'min-w-[80px] text-left whitespace-normal break-words';
    }

    //  Phone / Email cell-break helpers 
    function _escHtml(s) {
        if (!s) return '';
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function _isPhoneCol(name) {
        if (window.FieldClassifier) {
            var cat = window.FieldClassifier.classify(name);
            return cat === 'phone' || cat === 'emergency_phone';
        }
        var n = (name || '').toLowerCase();
        return /(?:father|mother|guardian|parent|mama|nana|dada|nani|dadi)\s*(?:no\.?|num|mob|ph(?:one)?|cell|tel|contact)/.test(n) ||
               /\bphone\b|\bmobile\b|\bcontact\b|\bwhatsapp\b|\btel\b|\bmob\b/.test(n);
    }
    function _isEmailCol(name) {
        if (window.FieldClassifier) return window.FieldClassifier.classify(name) === 'email';
        var n = (name || '').toLowerCase();
        return /\be[\-\s]?mail\b/.test(n);
    }
    /** Insert <wbr> at digit-centre of a phone string */
    function _fmtPhone(val) {
        var safe = _escHtml(val);
        var digits = val.replace(/[^0-9]/g, '');
        if (digits.length < 6) return safe;
        var mid = Math.ceil(digits.length / 2);
        var cnt = 0;
        for (var i = 0; i < val.length; i++) {
            if (/[0-9]/.test(val[i])) cnt++;
            if (cnt === mid) {
                return _escHtml(val.substring(0, i + 1)) + '<wbr>' + _escHtml(val.substring(i + 1));
            }
        }
        return safe;
    }
    /** Insert <wbr> before @ in an email */
    function _fmtEmail(val) {
        var at = val.indexOf('@');
        if (at > 0) return _escHtml(val.substring(0, at)) + '<wbr>' + _escHtml(val.substring(at));
        return _escHtml(val);
    }

    function _getCardName(card) {
        var f = card.ordered_fields;
        if (!f || !f.length) return '';

        // Match server _get_name_field logic:
        // 1. Field with type='name'
        for (var i = 0; i < f.length; i++) {
            if (f[i].type === 'name') return (f[i].value || '').toLowerCase();
        }
        // 2. Field whose name contains 'name' (excluding father/mother/guardian etc.)
        var blocked = ['father', 'mother', 'guardian', 'parent', 'relation', 'spouse', 'husband', 'wife'];
        for (var j = 0; j < f.length; j++) {
            if (f[j].type === 'image') continue;
            var fn = (f[j].name || '').toLowerCase().replace(/[_\-\.]/g, ' ');
            if (fn.indexOf('name') === -1) continue;
            var isBlocked = false;
            for (var b = 0; b < blocked.length; b++) {
                if (fn.indexOf(blocked[b]) !== -1) { isBlocked = true; break; }
            }
            if (!isBlocked) return (f[j].value || '').toLowerCase();
        }
        // 3. Fallback: first text field
        for (var k = 0; k < f.length; k++) {
            if (f[k].type !== 'image') return (f[k].value || '').toLowerCase();
        }
        return '';
    }

    function _compareDates(a, b) {
        if (!a && !b) return 0;
        if (!a) return -1;
        if (!b) return 1;
        return new Date(a) - new Date(b);
    }

    // 
    // COLUMN CONFIG (read from <thead>)
    // 
    function _buildColumns() {
        _status = (typeof CURRENT_STATUS !== 'undefined') ? CURRENT_STATUS : 'pending';
        _tableId = (typeof TABLE_ID !== 'undefined') ? TABLE_ID : 0;
        _perms = (typeof PERMS !== 'undefined') ? PERMS : {};
        _isClientReadonly = !!(
            typeof IS_CLIENT_USER !== 'undefined' && IS_CLIENT_USER &&
            typeof CLIENT_READONLY_STATUSES !== 'undefined' &&
            CLIENT_READONLY_STATUSES.indexOf(_status) !== -1
        );

        var headerRow = document.querySelector('#data-table thead tr');
        if (!headerRow) return;

        var ths = headerRow.querySelectorAll('th');
        _cols = [];

        // Skip first 2 TH (checkbox + SR NO); skip trailing fixed columns
        for (var i = 2; i < ths.length; i++) {
            var th = ths[i];
            var fieldName = th.getAttribute('data-field-name');
            if (!fieldName) continue; // fixed column (Action / date / updated)

            var fieldType = th.getAttribute('data-field-type') || 'text';
            var isImage = (fieldType === 'image');
            _cols.push({
                name:       fieldName,
                type:       fieldType,
                isImage:    isImage,
                imgClass:   isImage ? _imageTypeClass(fieldName) : '',
                widthClass: isImage ? '' : _tdWidthClass(fieldName, fieldType)
            });
        }

        // Total <td> count per row
        _totalCols = 2 + _cols.length; // checkbox + srno + fields
        if (_status === 'download' || _status === 'pool') _totalCols += 1;
        else _totalCols += 1; // action column (pending/verified/approved all have it now)
        if (_perms.idcard_updated_at) _totalCols += 2;

        // Compact mode for tables with many columns (16+)
        var tableEl = document.querySelector('.idcard-table');
        if (tableEl) {
            if (_totalCols >= 16) tableEl.classList.add('compact-mode');
            else tableEl.classList.remove('compact-mode');
        }
    }

    // 
    // POOL ROW FACTORY  (pure DOM  no innerHTML)
    // 
    function _createPoolEntry() {
        var doc = document;
        var tr = doc.createElement('tr');
        tr.style.display = 'none';

        //  Checkbox cell 
        var tdCb = doc.createElement('td');
        tdCb.className = 'w-[24px] text-center checkbox-cell';
        var cbInput = doc.createElement('input');
        cbInput.type = 'checkbox';
        cbInput.className = 'rowCheckbox';
        cbInput.addEventListener('change', _onCheckboxChange);
        tdCb.appendChild(cbInput);
        tr.appendChild(tdCb);

        //  SR NO cell 
        var tdSr = doc.createElement('td');
        tdSr.className = 'w-[36px] text-center sr-no-cell';
        tr.appendChild(tdSr);

        //  Field cells 
        var fields = [];
        for (var c = 0; c < _cols.length; c++) {
            if (_cols[c].isImage) {
                fields.push(_createImageCell(doc, tr, _cols[c]));
            } else {
                fields.push(_createTextCell(doc, tr, _cols[c]));
            }
        }

        //  Status-dependent column 
        var actionBtns = null;
        var dateCell   = null;

        if (_status === 'download' || _status === 'pool') {
            dateCell = doc.createElement('td');
            dateCell.className = 'w-[90px] date-cell whitespace-nowrap text-center';
            tr.appendChild(dateCell);
        } else if (_status !== 'approved') {
            var actionTd = doc.createElement('td');
            actionTd.className = 'w-[60px] text-center action-cell inline-flex flex-col gap-[2px] justify-center items-center';
            actionBtns = {};

            if (_perms.idcard_verify) {
                actionBtns.verify = _makeActionBtn(doc, actionTd, 'row-action-btn verify-row-btn', 'Verify', 'Verify this card');
            }
            if (_perms.idcard_approve) {
                actionBtns.approve = _makeActionBtn(doc, actionTd, 'row-action-btn approve-row-btn', 'Approve', 'Approve this card');
            }
            if (_perms.idcard_verify) {
                actionBtns.unverify = _makeActionBtn(doc, actionTd, 'row-action-btn unverify-row-btn', 'Unverify', 'Move back to pending');
            }
            tr.appendChild(actionTd);
        }

        //  Updated At / By 
        var updatedAt = null;
        var updatedBy = null;
        if (_perms.idcard_updated_at) {
            updatedAt = doc.createElement('td');
            updatedAt.className = 'w-[90px] date-cell whitespace-nowrap text-center';
            tr.appendChild(updatedAt);

            updatedBy = doc.createElement('td');
            updatedBy.className = 'w-[65px] user-cell whitespace-normal break-words text-center';
            tr.appendChild(updatedBy);
        }

        return {
            tr: tr,
            checkbox: cbInput,
            srNo: tdSr,
            fields: fields,
            actionBtns: actionBtns,
            dateCell: dateCell,
            updatedAt: updatedAt,
            updatedBy: updatedBy,
            cardIndex: -1
        };
    }

    function _makeActionBtn(doc, parent, cls, label, title) {
        var btn = doc.createElement('button');
        btn.className = cls;
        btn.title = title;
        btn.style.display = 'none';
        btn.textContent = label;
        parent.appendChild(btn);
        return btn;
    }

    function _createTextCell(doc, tr, col) {
        var td = doc.createElement('td');
        var cls = 'dynamic-field ' + col.widthClass;
        if (!_isClientReadonly) {
            cls = cls.replace('dynamic-field', 'dynamic-field editable-cell');
            td.title = 'Click to edit';
        }
        td.className = cls;
        var span = doc.createElement('span');
        span.className = 'cell-value';
        td.appendChild(span);
        tr.appendChild(td);
        return { td: td, span: span, type: 'text' };
    }

    function _createImageCell(doc, tr, col) {
        var td = doc.createElement('td');
        td.className = 'w-[28px] text-center image-field image-cell ' + col.imgClass;

        var wrap = doc.createElement('div');
        wrap.className = 'image-with-edit';

        // Actual image (hidden until bound with valid src)
        var img = doc.createElement('img');
        img.className = 'table-image ' + col.imgClass;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = col.name;
        img.style.display = 'none';
        img.onerror = function () {
            this.onerror = null;
            var orig = this.dataset.vtOrig;
            if (orig) this.src = '/media/' + orig;
        };
        wrap.appendChild(img);

        // Pending placeholder
        var pendDiv = doc.createElement('div');
        pendDiv.className = 'no-image pending-placeholder';
        pendDiv.style.display = 'none';
        var pendIcon = doc.createElement('i');
        pendIcon.className = 'fa-solid fa-clock';
        pendDiv.appendChild(pendIcon);
        wrap.appendChild(pendDiv);

        // Empty placeholder
        var emptyDiv = doc.createElement('div');
        emptyDiv.className = 'no-image colorful-placeholder';
        emptyDiv.title = 'No image uploaded';
        emptyDiv.style.display = 'none';
        var emptyIcon = doc.createElement('i');
        emptyIcon.className = 'fa-solid fa-user-astronaut';
        emptyDiv.appendChild(emptyIcon);
        wrap.appendChild(emptyDiv);

        // Edit button
        var editBtn = doc.createElement('button');
        editBtn.className = 'edit-photo-btn';
        editBtn.title = 'Edit Card';
        editBtn.textContent = 'Edit';
        editBtn.style.display = 'none';
        wrap.appendChild(editBtn);

        td.appendChild(wrap);
        tr.appendChild(td);
        return { td: td, img: img, pending: pendDiv, empty: emptyDiv, editBtn: editBtn, type: 'image' };
    }

    // 
    // ROW BINDING / UNBINDING
    // 
    function _bindRow(entry, card, idx) {
        var tr = entry.tr;
        tr.style.display = '';
        tr.dataset.cardId = card.id;
        entry.cardIndex    = idx;

        // Checkbox  restore selection state
        var isSelected = _selectedIds.has(String(card.id));
        entry.checkbox.checked = isSelected;
        if (isSelected) tr.classList.add('selected');
        else            tr.classList.remove('selected');

        // SR NO
        entry.srNo.textContent = card.sr_no;

        // Field cells
        var ordered = card.ordered_fields;
        for (var i = 0; i < entry.fields.length && i < ordered.length; i++) {
            var f    = entry.fields[i];
            var data = ordered[i];
            var val  = data.value || '';

            f.td.dataset.field         = data.name;
            f.td.dataset.fieldType     = data.type;
            f.td.dataset.originalValue = val;

            if (f.type === 'text') {
                var colName = data.name || '';
                if (val && _isPhoneCol(colName)) {
                    f.span.innerHTML = _fmtPhone(val);
                } else if (val && _isEmailCol(colName)) {
                    f.span.innerHTML = _fmtEmail(val);
                } else {
                    f.span.textContent = val;
                }
            } else {
                // Image cell  show one of three states
                var isPending = val.indexOf('PENDING:') === 0;
                var isNotFound = val === 'NOT_FOUND';
                var looksLikePath = val.indexOf('.') !== -1;
                var hasValue = !!(val && val !== '' && !isPending && !isNotFound && looksLikePath);

                if (hasValue) {
                    f.img.style.display    = '';
                    f.pending.style.display = 'none';
                    f.empty.style.display   = 'none';
                    var thumbSrc = data.thumb ? ('/media/' + data.thumb) : ('/media/' + val);
                    f.img.dataset.vtOrig = val;
                    // Re-attach onerror each rebind: recycled rows lose it after first error
                    f.img.onerror = function () {
                        this.onerror = null;
                        var orig = this.dataset.vtOrig;
                        if (orig) this.src = '/media/' + orig;
                    };
                    f.img.src = thumbSrc;
                } else if (isPending) {
                    f.img.style.display    = 'none';
                    f.pending.style.display = '';
                    f.empty.style.display   = 'none';
                    f.pending.title = 'Waiting for upload: ' + val.substring(8);
                } else {
                    f.img.style.display    = 'none';
                    f.pending.style.display = 'none';
                    f.empty.style.display   = '';
                }

                // Edit button visibility
                var showEdit = !!(_perms.idcard_edit && !_isClientReadonly);
                f.editBtn.style.display = showEdit ? '' : 'none';
                if (showEdit) f.editBtn.dataset.cardId = card.id;
            }
        }

        // Status-dependent column
        if (entry.dateCell) {
            entry.dateCell.textContent = (_status === 'download')
                ? (card.downloaded_at || '-')
                : (card.deleted_at || '-');
        }

        if (entry.actionBtns) {
            var ab = entry.actionBtns;
            if (ab.verify)   { ab.verify.style.display   = (_status === 'pending')  ? '' : 'none'; ab.verify.dataset.cardId   = card.id; }
            if (ab.approve)  { ab.approve.style.display  = (_status === 'verified') ? '' : 'none'; ab.approve.dataset.cardId  = card.id; }
            if (ab.unverify) { ab.unverify.style.display = (_status === 'verified') ? '' : 'none'; ab.unverify.dataset.cardId = card.id; }
        }

        if (entry.updatedAt) entry.updatedAt.textContent = card.updated_at || '';
        if (entry.updatedBy) {
            var rawUser = (card.modified_by && card.modified_by.trim()) ? card.modified_by : 'Admin';
            entry.updatedBy.textContent = window.FieldClassifier ? window.FieldClassifier.truncateUser(rawUser, 7) : rawUser;
            entry.updatedBy.title = rawUser;
        }
    }

    function _hideRow(entry) {
        entry.tr.style.display = 'none';
        entry.cardIndex = -1;
    }

    // 
    // CHECKBOX / SELECTION
    // 
    function _onCheckboxChange() {
        var tr = this.closest('tr');
        var cardId = tr ? tr.dataset.cardId : null;
        if (!cardId) return;
        if (this.checked) { _selectedIds.add(cardId);    tr.classList.add('selected'); }
        else              { _selectedIds.delete(cardId); tr.classList.remove('selected'); }
        _updateSelectionUI();
    }

    function _setupSelectAll() {
        var cb = document.getElementById('selectAll');
        if (!cb) return;
        // Clone to remove old listeners
        var fresh = cb.cloneNode(true);
        cb.parentNode.replaceChild(fresh, cb);

        fresh.addEventListener('change', function () {
            if (this.checked) {
                for (var i = 0; i < _filteredCards.length; i++) {
                    _selectedIds.add(String(_filteredCards[i].id));
                }
            } else {
                _selectedIds.clear();
            }
            // Sync visible checkboxes + row highlight
            for (var j = 0; j < _pool.length; j++) {
                var e = _pool[j];
                if (e.cardIndex >= 0) {
                    var sel = _selectedIds.has(String(_filteredCards[e.cardIndex].id));
                    e.checkbox.checked = sel;
                    if (sel) e.tr.classList.add('selected');
                    else     e.tr.classList.remove('selected');
                }
            }
            _updateSelectionUI();
        });
    }

    function _updateSelectionUI() {
        var count = _selectedIds.size;
        var infoEl = document.getElementById('selectionInfo');
        var countEl = document.getElementById('selectedCount');
        if (infoEl) infoEl.style.display = count > 0 ? '' : 'none';
        if (countEl) countEl.textContent = count;

        // Update action-bar button states via Alpine bridge
        if (typeof window.alpineUpdateSelection === 'function') {
            window.alpineUpdateSelection(count);
        }
        if (typeof updateActionButtons === 'function') {
            updateActionButtons();
        }
    }

    // 
    // VIRTUAL SCROLL RENDER
    // 
    var _renderInProgress = false;  // guard against re-entrant render

    function _render(force) {
        if (!_scrollEl || !_tbody) return;
        if (_renderInProgress) return;
        _renderInProgress = true;

        try {
            _renderCore(force);
        } finally {
            _renderInProgress = false;
        }
    }

    function _renderCore(force) {
        var total = _filteredCards.length;
        if (total === 0) {
            _spacerTopTd.style.height = '0px';
            _spacerBotTd.style.height = '0px';
            for (var h = 0; h < _pool.length; h++) _hideRow(_pool[h]);
            _showEmptyState(true);
            _updatePaginationUI();
            return;
        }
        _showEmptyState(false);

        var scrollTop = _scrollEl.scrollTop;
        var viewH     = _scrollEl.clientHeight;

        // Visible range
        var newStart = Math.max(0, Math.floor(scrollTop / _rowHeight) - OVERSCAN);
        var visCount = Math.ceil(viewH / _rowHeight);
        var newEnd   = Math.min(total, newStart + visCount + OVERSCAN * 2);
        if (newEnd - newStart > _pool.length) newEnd = newStart + _pool.length;

        // Skip if visible range unchanged (prevents spacer  scroll feedback loop)
        if (!force && newStart === _startIdx && newEnd === _endIdx) {
            return;
        }

        _startIdx = newStart;
        _endIdx   = newEnd;

        // Spacers
        _spacerTopTd.style.height = (newStart * _rowHeight) + 'px';
        _spacerBotTd.style.height = (Math.max(0, total - newEnd) * _rowHeight) + 'px';

        // Bind pool rows
        var pi = 0;
        for (var i = newStart; i < newEnd && pi < _pool.length; i++, pi++) {
            _bindRow(_pool[pi], _filteredCards[i], i);
        }
        for (; pi < _pool.length; pi++) _hideRow(_pool[pi]);

        // Self-correct row height after first paint
        if (!_measured && _pool.length > 0 && _pool[0].tr.offsetHeight > 10) {
            _rowHeight = _pool[0].tr.offsetHeight;
            _measured = true;
            requestAnimationFrame(function () { _render(true); });
            return;
        }

        // Prefetch if user scrolled close to end of loaded data.
        // Guard: only prefetch if _endIdx is beyond 60% of loaded data
        // to avoid aggressive fetch chains when user is near the top.
        if (_serverHasMore && !_isFetching
            && _endIdx > _allCards.length * 0.6
            && _endIdx + FETCH_AHEAD >= _allCards.length) {
            _fetchBatch();
        }

        _updatePaginationUI();
    }

    // 
    // SCROLL HANDLER (rAF-throttled)
    // 
    function _onScroll() {
        if (_rafId) return;
        _rafId = requestAnimationFrame(function () {
            _rafId = 0;
            _render();
        });
    }

    // 
    // DATA FETCHING
    // 
    async function _fetchBatch() {
        if (_isFetching) return;
        if (!_serverHasMore || !_tableId) return;
        _isFetching = true;
        var mySeq = _fetchSeq;
        _showLoadingIndicator(true);

        try {
            var params = new URLSearchParams();
            params.set('status', _status);
            params.set('offset', String(_nextOffset));
            params.set('limit', String(FETCH_BATCH));

            // Include current server-side filters
            if (_searchQuery) params.set('search', _searchQuery);
            if (_sortMode && _sortMode !== 'sr-asc') params.set('sort', _sortMode);
            var classF = IDCardApp.currentClassFilter || '';
            var secF   = IDCardApp.currentSectionFilter || '';
            if (classF)  params.set('class', classF);
            if (secF)    params.set('section', secF);

            // Server-side image filter
            var imgSort = IDCardApp._activeImageSort;
            if (imgSort && imgSort.column && imgSort.condition) {
                params.set('image_column', imgSort.column);
                params.set('image_condition', imgSort.condition);
            }

            // DateTime (download status)
            var fromEl = document.getElementById('fromDateFilter');
            var toEl   = document.getElementById('toDateFilter');
            if (fromEl && fromEl.value) params.set('from', fromEl.value);
            if (toEl && toEl.value)     params.set('to', toEl.value);

            var url = '/api/table/' + _tableId + '/cards-json/?' + params.toString();
            var response;

            if (typeof ApiClient !== 'undefined' && typeof ApiClient.get === 'function') {
                response = await ApiClient.get(url);
            } else {
                var raw = await fetch(url, { credentials: 'same-origin' });
                response = await raw.json();
            }

            // Guard against stale responses after _resetAndFetch
            if (mySeq !== _fetchSeq) return;

            if (response.success && response.results) {
                for (var i = 0; i < response.results.length; i++) {
                    _allCards.push(response.results[i]);
                }
                _totalServer  = response.total;
                _serverHasMore = response.has_more;
                _nextOffset   = response.offset + response.results.length;

                // Sync legacy lazyLoadState for compat
                if (IDCardApp.lazyLoadState) {
                    IDCardApp.lazyLoadState.totalCount  = _totalServer;
                    IDCardApp.lazyLoadState.hasMore     = _serverHasMore;
                    IDCardApp.lazyLoadState.loadedCount  = _allCards.length;
                }

                _applyFilters();
                _render(true);

                // Populate filter dropdowns (API-based, once per status)

                // Update bulk-action button states
                if (typeof updateBulkActionButtons === 'function') updateBulkActionButtons();
            }
        } catch (err) {
            if (mySeq !== _fetchSeq) return;
            console.error('[VirtualTable] fetch error:', err);
            if (typeof showToast === 'function') showToast('Failed to load data', false);
        } finally {
            if (mySeq === _fetchSeq) {
                _isFetching = false;
                _showLoadingIndicator(false);
            }
        }
    }

    function _resetAndFetch() {
        _fetchSeq++;
        _allCards      = [];
        _filteredCards = [];
        _nextOffset    = 0;
        _serverHasMore = true;
        _isFetching    = false;
        _selectedIds.clear();
        _render(true);
        _fetchBatch();
        // Refresh filter options from API (lightweight separate query)
        _fetchFilterOptions();
    }

    // 
    // CLIENT-SIDE SORT (filters are now all server-side)
    // 
    function _applyFilters() {
        // Server handles search/class/section AND image filtering.
        // Client only applies sort order.
        _filteredCards = _allCards.slice();
        _applySortToFiltered();
    }

    function _applySortToFiltered() {
        var m = _sortMode;
        _filteredCards.sort(function (a, b) {
            switch (m) {
                case 'sr-asc':   return a.sr_no - b.sr_no;
                case 'sr-desc':  return b.sr_no - a.sr_no;
                case 'name-asc': return _getCardName(a).localeCompare(_getCardName(b));
                case 'name-desc':return _getCardName(b).localeCompare(_getCardName(a));
                case 'date-new': return _compareDates(b.updated_at_iso, a.updated_at_iso);
                case 'date-old': return _compareDates(a.updated_at_iso, b.updated_at_iso);
                default:         return 0;
            }
        });
    }

    // 
    // PAGINATION UI
    // 
    function _updatePaginationUI() {
        var total    = _filteredCards.length;
        var srvTotal = _totalServer;

        // Info text
        var infoEl = document.querySelector('.pagination-info');
        if (infoEl) {
            if (total === 0) {
                infoEl.innerHTML = 'Showing <strong>0</strong> results';
            } else if (_serverHasMore) {
                infoEl.innerHTML = 'Showing <strong>1-' + total + '</strong> of <strong>' + total + '</strong> loaded (' + srvTotal + ' total)';
            } else {
                infoEl.innerHTML = 'Showing <strong>all ' + total + '</strong> results';
            }
        }

        // Pagination bar data sync
        var pagBar = document.getElementById('paginationBar');
        if (pagBar) {
            pagBar.dataset.totalCount    = srvTotal;
            pagBar.dataset.initialLoaded = String(_allCards.length);
            pagBar.dataset.hasMore       = String(_serverHasMore);
        }

        // Page numbers
        var rowsPerPage = (pagBar && pagBar.dataset.perPage) ? (parseInt(pagBar.dataset.perPage) || 100) : 100;
        var totalPages = Math.ceil(total / rowsPerPage) || 1;
        var curPage    = Math.max(1, Math.min(totalPages, Math.floor(_startIdx / rowsPerPage) + 1));

        var pageNumsEl = document.querySelector('.page-numbers');
        if (pageNumsEl) {
            pageNumsEl.innerHTML = '';
            var sp = Math.max(1, curPage - 2);
            var ep = Math.min(totalPages, curPage + 2);
            if (ep - sp < 4) {
                if (sp === 1) ep = Math.min(totalPages, 5);
                else if (ep === totalPages) sp = Math.max(1, totalPages - 4);
            }
            for (var p = sp; p <= ep; p++) {
                var btn = document.createElement('button');
                btn.className = 'page-num' + (p === curPage ? ' active' : '');
                btn.textContent = p;
                (function (pg) { btn.addEventListener('click', function () { _jumpToPage(pg); }); })(p);
                pageNumsEl.appendChild(btn);
            }
        }

        var fb = document.getElementById('firstPage');
        var pb = document.getElementById('prevPage');
        var nb = document.getElementById('nextPage');
        var lb = document.getElementById('lastPage');
        if (fb) fb.disabled = curPage <= 1;
        if (pb) pb.disabled = curPage <= 1;
        if (nb) nb.disabled = curPage >= totalPages;
        if (lb) lb.disabled = curPage >= totalPages;
    }

    function _jumpToPage(page) {
        var pagBar = document.getElementById('paginationBar');
        var rpp = (pagBar && pagBar.dataset.perPage) ? (parseInt(pagBar.dataset.perPage) || 100) : 100;
        _scrollEl.scrollTo({ top: (page - 1) * rpp * _rowHeight });
    }

    // 
    // FILTER DROPDOWN POPULATION (from API)
    // 
    var _filterOptionsFetched = false;

    /**
     * Fetch all distinct class/section values from a lightweight API
     * instead of scanning the partially-loaded _allCards array.
     */
    async function _fetchFilterOptions(options) {
        options = options || {};
        var force = !!options.force;
        if (!_tableId) return;
        try {
            var url = '/api/table/' + _tableId + '/filter-options/';
            if (force) {
                url += '?_=' + Date.now();
            }
            var response;
            if (typeof ApiClient !== 'undefined' && typeof ApiClient.get === 'function') {
                response = await ApiClient.get(url);
            } else {
                var raw = await fetch(url, { credentials: 'same-origin' });
                response = await raw.json();
            }
            if (response.success) {
                _fillDropdownFromArray('classFilterOptions', response.class_values || [], IDCardApp.currentClassFilter || '');
                _fillDropdownFromArray('sectionFilterOptions', response.section_values || [], IDCardApp.currentSectionFilter || '');
                _filterOptionsFetched = true;
            }
        } catch (err) {
            console.error('[VirtualTable] filter options error:', err);
            // Fallback: scan loaded cards
            _populateFilterOptionsFromData();
        }
    }

    /** Legacy fallback: scan _allCards when API is unavailable. */
    function _populateFilterOptionsFromData() {
        var classes  = {};
        var sections = {};

        for (var i = 0; i < _allCards.length; i++) {
            var fd = _allCards[i].field_data || {};
            for (var key in fd) {
                var kl = key.toLowerCase();
                if (kl === 'class' || kl === 'std' || kl === 'standard' || kl === 'grade' || kl.indexOf('class') !== -1) {
                    var cv = String(fd[key] || '').trim();
                    if (cv) classes[cv] = true;
                }
                if (kl === 'section' || kl === 'sec' || kl === 'div' || kl === 'division' || kl.indexOf('section') !== -1) {
                    var sv = String(fd[key] || '').trim();
                    if (sv) sections[sv] = true;
                }
            }
        }

        _fillDropdown('classFilterOptions', classes, IDCardApp.currentClassFilter || '');
        _fillDropdown('sectionFilterOptions', sections, IDCardApp.currentSectionFilter || '');
    }

    function _formatFilterDisplayLabel(value) {
        var raw = String(value == null ? '' : value).trim();
        if (!raw) return '';
        if (/[A-Z]/.test(raw)) return raw;
        return raw.replace(/[A-Za-z]+/g, function(token) {
            if (token.length <= 3) return token.toUpperCase();
            return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
        });
    }

    /** Fill dropdown from a pre-sorted array (returned by filter-options API).
     *  Supports both old format (array of strings) and new format (array of {value, display} objects).
     */
    function _fillDropdownFromArray(elId, valuesArr, activeVal) {
        var el = document.getElementById(elId);
        if (!el) return;

        var allLabel = (elId.indexOf('class') !== -1) ? 'All Classes' : 'All Sections';
        el.innerHTML = '';
        var allOpt = document.createElement('div');
        allOpt.className = 'dropdown-option' + (!activeVal ? ' selected' : '');
        allOpt.dataset.value = '';
        allOpt.textContent = allLabel;
        el.appendChild(allOpt);

        for (var i = 0; i < valuesArr.length; i++) {
            var item = valuesArr[i];
            var opt = document.createElement('div');
            // Support objects with {value, display} or plain strings
            var val = (typeof item === 'object' && item !== null) ? (item.value || '') : item;
            var displayRaw = (typeof item === 'object' && item !== null) ? (item.display || val) : item;
            var display = _formatFilterDisplayLabel(displayRaw);
            opt.className = 'dropdown-option' + (val === activeVal ? ' selected' : '');
            opt.dataset.value = val;
            opt.textContent = display;
            el.appendChild(opt);
        }
    }

    /** Fill dropdown from an object-map (fallback path). */
    function _fillDropdown(elId, valuesObj, activeVal) {
        var el = document.getElementById(elId);
        if (!el) return;
        var existing = el.querySelector('.dropdown-option.selected');
        if (!existing) activeVal = '';

        var allLabel = (elId.indexOf('class') !== -1) ? 'All Classes' : 'All Sections';
        el.innerHTML = '';
        var allOpt = document.createElement('div');
        allOpt.className = 'dropdown-option' + (!activeVal ? ' selected' : '');
        allOpt.dataset.value = '';
        allOpt.textContent = allLabel;
        el.appendChild(allOpt);

        var sorted = Object.keys(valuesObj).sort();
        for (var i = 0; i < sorted.length; i++) {
            var opt = document.createElement('div');
            opt.className = 'dropdown-option' + (sorted[i] === activeVal ? ' selected' : '');
            opt.dataset.value = sorted[i];
            opt.textContent = _formatFilterDisplayLabel(sorted[i]);
            el.appendChild(opt);
        }
    }

    // 
    // EMPTY STATE / LOADING INDICATOR
    // 
    function _showEmptyState(show) {
        if (show) {
            if (!_emptyRow) {
                _emptyRow = document.createElement('tr');
                _emptyRow.className = 'no-data-row';
                var td = document.createElement('td');
                td.setAttribute('colspan', String(_totalCols || 50));
                td.className = 'no-data-cell';
                var div = document.createElement('div');
                div.className = 'no-data';
                var icon = document.createElement('i');
                icon.className = 'fa-solid fa-id-card';
                var span = document.createElement('span');
                span.textContent = 'No ID cards found';
                div.appendChild(icon);
                div.appendChild(span);
                td.appendChild(div);
                _emptyRow.appendChild(td);
            }
            if (!_emptyRow.parentNode) _tbody.appendChild(_emptyRow);
        } else if (_emptyRow && _emptyRow.parentNode) {
            _emptyRow.parentNode.removeChild(_emptyRow);
        }
    }

    function _showLoadingIndicator(show) {
        var el = document.getElementById('lazyLoadIndicator');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    // 
    // EVENT DELEGATION (tbody click)
    // 
    function _initDelegation() {
        if (!_tbody || _tbody._vtDelegation) return;
        _tbody._vtDelegation = true;

        _tbody.addEventListener('click', function (e) {
            // Row action buttons
            var btn = e.target.closest('.row-action-btn');
            if (btn) {
                e.stopPropagation();
                var cid = btn.getAttribute('data-card-id');
                if (!cid) return;
                if (btn.classList.contains('verify-row-btn')   && window.IDCardApp && typeof window.IDCardApp.verifyCard === 'function')   window.IDCardApp.verifyCard(cid);
                else if (btn.classList.contains('approve-row-btn')  && window.IDCardApp && typeof window.IDCardApp.approveCard === 'function')  window.IDCardApp.approveCard(cid);
                else if (btn.classList.contains('unverify-row-btn') && window.IDCardApp && typeof window.IDCardApp.unverifyCard === 'function') window.IDCardApp.unverifyCard(cid);
                else if (btn.classList.contains('retrieve-row-btn') && window.IDCardApp && typeof window.IDCardApp.retrieveCard === 'function') window.IDCardApp.retrieveCard(cid);
                else if (btn.classList.contains('unapprove-row-btn') && window.IDCardApp && typeof window.IDCardApp.disapproveCard === 'function') window.IDCardApp.disapproveCard(cid);
                return;
            }

            // Edit-photo button
            var epBtn = e.target.closest('.edit-photo-btn');
            if (epBtn) {
                e.stopPropagation();
                var c2 = epBtn.getAttribute('data-card-id');
                if (c2 && window.IDCardApp && typeof window.IDCardApp.fetchCardAndOpenModal === 'function') {
                    window.IDCardApp.fetchCardAndOpenModal('edit', c2);
                }
                return;
            }

            // Editable text cell
            var cell = e.target.closest('.editable-cell:not(.image-field)');
            if (cell) {
                if (e.target.closest('button') || cell.classList.contains('editing')) return;
                if (typeof startCellEdit === 'function') startCellEdit(cell);
            }
        });
    }

    // 
    // HTMX INTERCEPT
    // 
    // Prevent HTMX from swapping out the virtual-table container.
    // Instead, re-fetch data from the JSON API.
    function _installHtmxIntercept() {
        document.body.addEventListener('htmx:beforeSwap', function (evt) {
            if (!window.USE_VIRTUAL_TABLE) return;
            if (evt.detail && evt.detail.target && evt.detail.target.id === 'card-table-container') {
                evt.detail.shouldSwap = false;
                // Read filter state that may have changed
                _searchQuery = (document.getElementById('searchInput') || {}).value || '';
                _searchQuery = _searchQuery.trim();
                _resetAndFetch();
            }
        });
    }

    // 
    // OVERRIDE EXISTING MODULE FUNCTIONS
    // 
    function _installOverrides() {
        //  Search 
        IDCardApp.searchRows = function (query) {
            _searchQuery = (query || '').trim();
            // Debounced server re-fetch (server handles search filtering)
            clearTimeout(_searchTimer);
            _searchTimer = setTimeout(function () { _resetAndFetch(); }, 400);
        };

        //  Filter / sort 
        IDCardApp.applyFiltersAndSort = function () {
            // Class/section changes  server re-fetch
            _resetAndFetch();
        };

        IDCardApp.sortRows = function (sortValue) {
            var prev = _sortMode;
            _sortMode = sortValue;
            // Name/date sorts require server-side ordering for correct pagination.
            // Only sr-asc/sr-desc are safe to apply client-side on partial data.
            var needsServerSort = (sortValue === 'name-asc' || sortValue === 'name-desc'
                || sortValue === 'date-new' || sortValue === 'date-old');
            var prevNeeded = (prev === 'name-asc' || prev === 'name-desc'
                || prev === 'date-new' || prev === 'date-old');
            if (needsServerSort || prevNeeded) {
                _resetAndFetch();
            } else {
                _applyFilters();
                _scrollEl.scrollTop = 0;
                _render(true);
            }
        };

        //  Render 
        IDCardApp.renderTable = function () { _render(true); };

        //  Lazy-load overrides 
        IDCardApp.loadMoreData = function () { return _fetchBatch(); };
        IDCardApp.loadAllData  = async function () {
            while (_serverHasMore) await _fetchBatch();
        };
        IDCardApp.checkLoadMore = function () {};

        //  Pagination navigation 
        IDCardApp.goToPage = function (p) { _jumpToPage(p); };
        IDCardApp.goToFirstPage = function () { _scrollEl.scrollTo({ top: 0 }); };
        IDCardApp.goToPrevPage = function () {
            var rpp = _getRowsPerPage();
            _scrollEl.scrollBy({ top: -(rpp * _rowHeight) });
        };
        IDCardApp.goToNextPage = function () {
            var rpp = _getRowsPerPage();
            _scrollEl.scrollBy({ top: rpp * _rowHeight });
        };
        IDCardApp.goToLastPage = async function () {
            while (_serverHasMore) await _fetchBatch();
            _applyFilters();
            _render(true);
            _scrollEl.scrollTo({ top: _scrollEl.scrollHeight });
        };

        IDCardApp.setRowsPerPage = function () { _render(true); };
        IDCardApp.initializeRows = function () {};

        //  Selection 
        IDCardApp.getSelectedCardIds = function () { return Array.from(_selectedIds); };

        //  populateFilterOptions 
        IDCardApp.populateFilterOptions = function (options) { _fetchFilterOptions(options || {}); };
        IDCardApp.forceRefreshFilterOptions = function () { _fetchFilterOptions({ force: true }); };

        //  initTableModule override 
        if (window.IDCardApp) {
            window.IDCardApp.initTableModule = function () { _init(); };
        }

        //  Expose public API 
        window.IDCardApp = window.IDCardApp || {};
        window.IDCardApp.virtualTable = {
            get allCards()      { return _allCards; },
            get filteredCards() { return _filteredCards; },
            get totalServer()   { return _totalServer; },
            get serverHasMore() { return _serverHasMore; },
            get selectedIds()   { return _selectedIds; },
            refresh:             _resetAndFetch,
            render:              _render
        };
    }

    function _getRowsPerPage() {
        var pb = document.getElementById('paginationBar');
        return (pb && pb.dataset.perPage) ? (parseInt(pb.dataset.perPage) || 100) : 100;
    }

    // 
    // INITIALIZATION
    // 
    var _initialized = false;

    function _init() {
        _scrollEl = document.querySelector('.idcard-table');
        _tbody    = document.getElementById('cardsTableBody');
        if (!_scrollEl || !_tbody) return;

        // Build column map from <thead>
        _buildColumns();
        if (_cols.length === 0) return;

        // Read state from pagination bar
        var pagBar = document.getElementById('paginationBar');
        if (pagBar) {
            if (pagBar.dataset.tableId) _tableId = parseInt(pagBar.dataset.tableId);
            if (pagBar.dataset.status)  _status  = pagBar.dataset.status;
            _totalServer = parseInt(pagBar.dataset.totalCount) || 0;
        }

        // Read search input value (may have been set before init)
        var searchEl = document.getElementById('searchInput');
        _searchQuery = searchEl ? searchEl.value.trim() : '';

        // Reset data state
        _allCards      = [];
        _filteredCards = [];
        _nextOffset    = 0;
        _serverHasMore = true;
        _isFetching    = false;
        _measured      = false;
        _startIdx      = 0;
        _endIdx        = 0;
        _fetchSeq++;
        _pool          = [];
        _emptyRow      = null;
        _selectedIds.clear();

        // Remove old sentinel (from former initTableModule run)
        var oldSent = document.getElementById('lazyLoadSentinel');
        if (oldSent) oldSent.remove();

        // Disconnect old IntersectionObserver (if accessible)
        if (_observer) { _observer.disconnect(); _observer = null; }

        //  Clear server-rendered rows 
        _tbody.innerHTML = '';

        //  Spacer top 
        var spTopRow = document.createElement('tr');
        spTopRow.className = 'vt-spacer';
        spTopRow.setAttribute('aria-hidden', 'true');
        _spacerTopTd = document.createElement('td');
        _spacerTopTd.setAttribute('colspan', String(_totalCols || 50));
        _spacerTopTd.style.cssText = 'height:0px;padding:0;border:none;line-height:0;';
        spTopRow.appendChild(_spacerTopTd);
        _tbody.appendChild(spTopRow);

        //  Pool rows 
        var viewH     = _scrollEl.clientHeight || 600;
        var visCount  = Math.ceil(viewH / _rowHeight);
        var poolSize  = visCount + OVERSCAN * 2;
        if (poolSize < 50) poolSize = 50;

        for (var i = 0; i < poolSize; i++) {
            var entry = _createPoolEntry();
            _pool.push(entry);
            _tbody.appendChild(entry.tr);
        }

        //  Spacer bottom 
        var spBotRow = document.createElement('tr');
        spBotRow.className = 'vt-spacer';
        spBotRow.setAttribute('aria-hidden', 'true');
        _spacerBotTd = document.createElement('td');
        _spacerBotTd.setAttribute('colspan', String(_totalCols || 50));
        _spacerBotTd.style.cssText = 'height:0px;padding:0;border:none;line-height:0;';
        spBotRow.appendChild(_spacerBotTd);
        _tbody.appendChild(spBotRow);

        //  Sentinel 
        _sentinel = document.createElement('tr');
        _sentinel.id = 'vtSentinel';
        _sentinel.setAttribute('aria-hidden', 'true');
        var sentTd = document.createElement('td');
        sentTd.setAttribute('colspan', String(_totalCols || 50));
        sentTd.style.cssText = 'height:1px;padding:0;border:none;';
        _sentinel.appendChild(sentTd);
        _tbody.appendChild(_sentinel);

        //  Scroll listener 
        _scrollEl.removeEventListener('scroll', _onScroll);
        _scrollEl.addEventListener('scroll', _onScroll, { passive: true });

        //  IntersectionObserver for auto-fetch 
        // Only fetch when sentinel is actually close to viewport (not 800px away)
        _observer = new IntersectionObserver(function (entries) {
            if (entries[0] && entries[0].isIntersecting && _serverHasMore && !_isFetching
                && _endIdx > _allCards.length * 0.6) {
                _fetchBatch();
            }
        }, { root: _scrollEl, rootMargin: '0px 0px 200px 0px', threshold: 0 });
        _observer.observe(_sentinel);

        //  Select-all checkbox 
        _setupSelectAll();

        //  Delegation 
        _initDelegation();

        //  Install overrides (only once) 
        if (!_initialized) {
            _initialized = true;
            _installOverrides();
            _installHtmxIntercept();
        }

        //  Kick off first fetch 
        _fetchBatch();
    }

    // 
    // BOOT  wait for all other modules to init first
    // 
    document.addEventListener('idcard-actions-ready', function () {
        setTimeout(_init, 50);
    });

    // Fallback if event was already dispatched (e.g. script loaded late)
    if (document.readyState !== 'loading') {
        setTimeout(function () {
            if (!_initialized) _init();
        }, 500);
    }

})();
