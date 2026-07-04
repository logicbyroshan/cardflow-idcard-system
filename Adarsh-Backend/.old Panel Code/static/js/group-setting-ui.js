// Group Setting Page - UI Rendering
// Loaded second: drawer, field list, pagination, and visual update functions

document.addEventListener('DOMContentLoaded', function() {
    const GSP = window.GroupSettingPage;

    // ==================== UTILITY FUNCTIONS ====================

    GSP.updateFieldCount = function() {
        if (GSP.fieldCountSpan) GSP.fieldCountSpan.textContent = GSP.currentFields.length;
        if (GSP.noFieldsMessage) GSP.noFieldsMessage.style.display = GSP.currentFields.length === 0 ? 'block' : 'none';
        if (GSP.addFieldBtnEl) GSP.addFieldBtnEl.disabled = GSP.currentFields.length >= GSP.MAX_FIELDS;
    };

    // Reset field type dropdown to default (Text) and enable name input
    GSP.resetFieldTypeDropdown = function() {
        if (GSP.fieldTypeDropdown) {
            GSP.fieldTypeDropdown.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
            const textOption = GSP.fieldTypeDropdown.querySelector('.dropdown-option[data-value="text"]');
            if (textOption) textOption.classList.add('selected');
            if (GSP.fieldTypeToggle) GSP.fieldTypeToggle.querySelector('span').textContent = 'Text';
            if (GSP.newFieldType) GSP.newFieldType.value = 'text';
        }
        // Re-enable name input when resetting to text type
        if (GSP.newFieldName) {
            GSP.newFieldName.disabled = false;
            GSP.newFieldName.classList.remove('disabled');
        }
    };

    // ==================== ACTION BUTTONS ====================

    GSP.updateActionButtons = function() {
        const hasSelection = GSP.selectedRow !== null;
        if (GSP.downloadFieldsBtn) GSP.downloadFieldsBtn.disabled = !hasSelection;
        if (GSP.editBtn) GSP.editBtn.disabled = !hasSelection;
        if (GSP.viewBtn) GSP.viewBtn.disabled = !hasSelection;
        if (GSP.deleteBtn) GSP.deleteBtn.disabled = !hasSelection;
        if (GSP.toggleStatusBtn) GSP.toggleStatusBtn.disabled = !hasSelection;

        // Reprint Cards button
        var isClient = typeof IS_CLIENT_ROLE !== 'undefined' ? IS_CLIENT_ROLE : false;
        var reprintCardsBtn = document.getElementById('reprintCardsBtn');
        if (reprintCardsBtn) {
            reprintCardsBtn.disabled = !hasSelection;
            if (hasSelection && GSP.selectedTableId) {
                var prefix = window.API_BASE_URL || '';
                var rUrl = isClient
                    ? prefix + '/client/table/' + GSP.selectedTableId + '/reprint/'
                    : prefix + '/table/' + GSP.selectedTableId + '/reprint/';
                reprintCardsBtn.onclick = function() { window.location.href = rUrl; };
            }
        }

        // Update toggle status button text and class based on current status
        if (hasSelection && GSP.toggleStatusBtn) {
            const currentStatus = GSP.selectedRow.dataset.tableStatus;
            if (currentStatus === 'active') {
                // Row is Active, so button should show "Inactive" to deactivate
                GSP.toggleStatusBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Inactive';
                GSP.toggleStatusBtn.classList.remove('btn-active');
                GSP.toggleStatusBtn.classList.add('btn-inactive');
            } else {
                // Row is Inactive, so button should show "Active" to activate
                GSP.toggleStatusBtn.innerHTML = '<i class="fa-solid fa-check"></i> Active';
                GSP.toggleStatusBtn.classList.remove('btn-inactive');
                GSP.toggleStatusBtn.classList.add('btn-active');
            }
        } else if (GSP.toggleStatusBtn) {
            GSP.toggleStatusBtn.innerHTML = '<i class="fa-solid fa-check"></i> Active';
            GSP.toggleStatusBtn.classList.remove('btn-inactive');
            GSP.toggleStatusBtn.classList.add('btn-active');
        }
    };

    // ==================== FIELD LIST RENDERING ====================

    GSP.renderFieldList = function() {
        if (!GSP.fieldList) return;
        GSP.fieldList.innerHTML = '';

        GSP.currentFields.forEach((field, idx) => {
            const li = document.createElement('li');
            li.className = 'field-list-item';
            li.dataset.idx = idx;
            li.draggable = GSP.currentMode !== 'view';

            const typeOptionsHtml = GSP.fieldTypeOptions.map(t =>
                `<option value="${t.value}" ${field.type === t.value ? 'selected' : ''}>${t.label}</option>`
            ).join('');

            const _esc = window.escapeHtml || function(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); };
            const requiredIndicatorHtml = field.mandatory
                ? '<span class="mandatory-indicator" title="Required field" aria-hidden="true">*</span>'
                : '';
            // In add/edit mode, field name is an editable input; in view mode it's plain text
            const fieldNameHtml = GSP.currentMode !== 'view'
                ? `<span class="field-name"><span class="field-name-input-wrap"><input type="text" class="field-name-input" data-idx="${idx}" value="${_esc(field.name)}" placeholder="Field name">${requiredIndicatorHtml}</span></span>`
                : `<span class="field-name">${_esc(field.name)}${requiredIndicatorHtml}</span>`;

            // Mandatory checkbox for edit mode
            const mandatoryHtml = GSP.currentMode !== 'view'
                ? `<span class="field-mandatory-cell">
                     <label class="mandatory-toggle" title="Required field">
                       <input type="checkbox" class="field-mandatory-checkbox" data-idx="${idx}" ${field.mandatory ? 'checked' : ''}>
                       <span class="toggle-slider"></span>
                     </label>
                   </span>`
                : '';

            li.innerHTML = `
                <span class="field-drag"><i class="fa-solid fa-grip-vertical"></i></span>
                ${fieldNameHtml}
                <span class="field-type-cell">
                    <select class="field-type-select" data-idx="${idx}" ${GSP.currentMode === 'view' ? 'disabled' : ''}>
                        ${typeOptionsHtml}
                    </select>
                </span>
                ${mandatoryHtml}
                <span class="field-action">
                    ${GSP.currentMode !== 'view' ? `<button class="remove-field-btn" data-idx="${idx}"><i class="fa-solid fa-xmark"></i></button>` : ''}
                </span>
            `;
            GSP.fieldList.appendChild(li);
        });

        GSP.updateFieldCount();
        if (GSP.currentMode !== 'view') GSP.setupDragAndDrop();
    };

    // ==================== DRAG AND DROP ====================

    GSP.setupDragAndDrop = function() {
        const items = GSP.fieldList.querySelectorAll('.field-list-item');
        let draggedItem = null;

        items.forEach(item => {
            item.addEventListener('dragstart', function(e) {
                draggedItem = this;
                this.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', function() {
                this.classList.remove('dragging');
                draggedItem = null;
                GSP.updateFieldOrder();
            });

            item.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const afterElement = GSP.getDragAfterElement(GSP.fieldList, e.clientY);
                if (afterElement == null) {
                    GSP.fieldList.appendChild(draggedItem);
                } else {
                    GSP.fieldList.insertBefore(draggedItem, afterElement);
                }
            });
        });
    };

    GSP.getDragAfterElement = function(container, y) {
        const draggableElements = [...container.querySelectorAll('.field-list-item:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    };

    GSP.updateFieldOrder = function() {
        const items = GSP.fieldList.querySelectorAll('.field-list-item');
        const newFields = [];
        items.forEach((item, idx) => {
            const oldIdx = parseInt(item.dataset.idx);
            if (GSP.currentFields[oldIdx]) newFields.push({...GSP.currentFields[oldIdx], order: idx});
        });
        GSP.currentFields = newFields;
        GSP.renderFieldList();
    };

    // ==================== DRAWER FUNCTIONS ====================

    GSP.openDrawer = function(mode, data = null) {
        GSP.currentMode = mode;
        GSP.addDrawer.classList.remove('view-mode');

        if (mode === 'add') {
            GSP.drawerTitle.textContent = 'Create New Table';
            GSP.drawerIcon.className = 'fa-solid fa-table-list';
            GSP.tableNameInput.value = '';
            GSP.tableNameInput.disabled = false;
            GSP.currentFields = [];
            GSP.saveDrawer.style.display = 'inline-flex';
            GSP.saveDrawer.innerHTML = '<i class="fa-solid fa-plus"></i> Create';
            GSP.saveDrawer.className = 'btn btn-md btn-primary';
            if (GSP.addFieldSection) GSP.addFieldSection.style.display = 'block';
        } else if (mode === 'edit') {
            GSP.drawerTitle.textContent = 'Edit Table';
            GSP.drawerIcon.className = 'fa-solid fa-pen-to-square';
            GSP.tableNameInput.value = data.name || '';
            GSP.tableNameInput.disabled = false;
            GSP.currentFields = data.fields || [];
            GSP.saveDrawer.style.display = 'inline-flex';
            GSP.saveDrawer.innerHTML = '<i class="fa-solid fa-check"></i> Update';
            GSP.saveDrawer.className = 'btn btn-md btn-primary';
            if (GSP.addFieldSection) GSP.addFieldSection.style.display = 'block';
        } else if (mode === 'view') {
            GSP.drawerTitle.textContent = 'View Table';
            GSP.drawerIcon.className = 'fa-solid fa-eye';
            GSP.tableNameInput.value = data.name || '';
            GSP.tableNameInput.disabled = true;
            GSP.currentFields = data.fields || [];
            GSP.saveDrawer.style.display = 'none';
            if (GSP.addFieldSection) GSP.addFieldSection.style.display = 'none';
            GSP.addDrawer.classList.add('view-mode');
        }

        GSP.renderFieldList();
        GSP.addDrawer.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    GSP.closeDrawerModal = function() {
        GSP.addDrawer.classList.remove('open');
        GSP.addDrawer.classList.remove('view-mode');
        document.body.style.overflow = '';
        GSP.currentFields = [];
        if (GSP.newFieldName) GSP.newFieldName.value = '';
        GSP.resetFieldTypeDropdown();
    };

    // ==================== FIELD NAME INPUT ====================

    GSP.updateFieldNameInput = function(fieldType) {
        if (!GSP.newFieldName) return;

        if (fieldType === 'class_section') {
            // Class & Section: auto-generate, disable input
            GSP.newFieldName.value = 'Class & Section (auto)';
            GSP.newFieldName.disabled = true;
            GSP.newFieldName.classList.add('disabled');
        } else if ((GSP.fixedNameImageFieldTypes || []).includes(fieldType)) {
            // Image type: auto-fill name and disable input
            GSP.newFieldName.value = GSP.imageFieldNames[fieldType];
            GSP.newFieldName.disabled = true;
            GSP.newFieldName.classList.add('disabled');
        } else {
            // Text/Email: enable input and clear if it was auto-filled
            if (GSP.newFieldName.disabled) {
                GSP.newFieldName.value = '';
            }
            GSP.newFieldName.disabled = false;
            GSP.newFieldName.classList.remove('disabled');
        }
    };

    // ==================== SEARCH, FILTER & PAGINATION ====================

    GSP.getVisibleRows = function() {
        // Returns rows that match the current search/filter (not hidden by search)
        const searchTerm = GSP.searchInput ? GSP.searchInput.value.toLowerCase().trim() : '';
        const allRows = GSP.tablesBody ? Array.from(GSP.tablesBody.querySelectorAll('tr:not(.no-data-row)')) : [];
        if (!searchTerm) return allRows;

        return allRows.filter(row => {
            const name = row.querySelector('td:first-child')?.textContent.toLowerCase() || '';
            const status = row.dataset.tableStatus || '';
            const createdAt = row.querySelector('td:nth-child(3)')?.textContent.toLowerCase() || '';
            const updatedAt = row.querySelector('td:nth-child(4)')?.textContent.toLowerCase() || '';

            if (GSP.currentFilter === 'all') {
                return name.includes(searchTerm) || status.includes(searchTerm) || createdAt.includes(searchTerm) || updatedAt.includes(searchTerm);
            } else if (GSP.currentFilter === 'name') {
                return name.includes(searchTerm);
            } else if (GSP.currentFilter === 'status') {
                return status.includes(searchTerm);
            }
            return true;
        });
    };

    GSP.renderPagination = function() {
        const matched = GSP.getVisibleRows();
        const totalRows = matched.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / GSP.gsRowsPerPage));
        if (GSP.gsCurrentPage > totalPages) GSP.gsCurrentPage = totalPages;

        const startIdx = (GSP.gsCurrentPage - 1) * GSP.gsRowsPerPage;
        const endIdx = Math.min(startIdx + GSP.gsRowsPerPage, totalRows);

        // Hide all rows first, then show only matched rows in the current page range
        const allRows = GSP.tablesBody ? GSP.tablesBody.querySelectorAll('tr:not(.no-data-row)') : [];
        allRows.forEach(r => r.style.display = 'none');
        matched.forEach((row, i) => {
            row.style.display = (i >= startIdx && i < endIdx) ? '' : 'none';
        });

        // Update info text
        const info = document.getElementById('paginationInfo');
        if (info) {
            if (totalRows === 0) {
                info.innerHTML = 'No tables found';
            } else {
                info.innerHTML = `Showing <strong>${startIdx + 1}-${endIdx}</strong> of <strong>${totalRows}</strong> tables`;
            }
        }

        // Page number buttons
        const pageNums = document.getElementById('gsPageNumbers');
        if (pageNums) {
            pageNums.innerHTML = '';
            const maxVisible = 5;
            let startPage = Math.max(1, GSP.gsCurrentPage - Math.floor(maxVisible / 2));
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            if (endPage - startPage + 1 < maxVisible) startPage = Math.max(1, endPage - maxVisible + 1);

            for (let p = startPage; p <= endPage; p++) {
                const btn = document.createElement('button');
                btn.className = 'page-num' + (p === GSP.gsCurrentPage ? ' active' : '');
                btn.textContent = p;
                btn.addEventListener('click', () => { GSP.gsCurrentPage = p; GSP.renderPagination(); });
                pageNums.appendChild(btn);
            }
        }

        // Nav buttons
        const firstBtn = document.getElementById('gsFirstPage');
        const prevBtn = document.getElementById('gsPrevPage');
        const nextBtn = document.getElementById('gsNextPage');
        const lastBtn = document.getElementById('gsLastPage');
        if (firstBtn) firstBtn.disabled = GSP.gsCurrentPage <= 1;
        if (prevBtn) prevBtn.disabled = GSP.gsCurrentPage <= 1;
        if (nextBtn) nextBtn.disabled = GSP.gsCurrentPage >= totalPages;
        if (lastBtn) lastBtn.disabled = GSP.gsCurrentPage >= totalPages;
    };

    GSP.performSearch = function() {
        GSP.gsCurrentPage = 1;
        GSP.renderPagination();
    };
});
