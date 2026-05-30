// Group Setting Page - Event Handlers & Initialization
// Loaded last: binds all event listeners and runs initial setup

document.addEventListener('DOMContentLoaded', function() {
    const GSP = window.GroupSettingPage;

    // ==================== ROW SELECTION ====================
    // Delegate from stable container to survive HTMX swaps
    var gsTableContainer = document.getElementById('gs-table-container') || GSP.tablesBody;
    if (gsTableContainer) {
        gsTableContainer.addEventListener('click', function(e) {
            // Handle download button click
            if (e.target.closest('.download-btn')) {
                e.stopPropagation();
                const btn = e.target.closest('.download-btn');
                const tableId = btn.dataset.tableId;
                GSP.downloadTableFields(tableId);
                return;
            }

            const row = e.target.closest('tr');
            if (!row || !row.dataset.tableId || row.classList.contains('no-data-row')) return;

            if (GSP.selectedRow === row) {
                row.classList.remove('selected');
                GSP.selectedRow = null;
                GSP.selectedTableId = null;
            } else {
                if (GSP.selectedRow) GSP.selectedRow.classList.remove('selected');
                row.classList.add('selected');
                GSP.selectedRow = row;
                GSP.selectedTableId = row.dataset.tableId;
            }
            GSP.updateActionButtons();
        });

        // Double-click on a row  navigate to that table's pending cards
        gsTableContainer.addEventListener('dblclick', function(e) {
            var row = e.target.closest('tr[data-table-id]');
            if (!row || row.classList.contains('no-data-row')) return;
            // Don't navigate when double-clicking action buttons
            if (e.target.closest('.download-btn')) return;
            var tableId = row.dataset.tableId;
            // Use template-set flag (URL-based detection fails for admin on /client/<id>/settings/)
            var isClient = typeof IS_CLIENT_ROLE !== 'undefined' ? IS_CLIENT_ROLE : false;
            var prefix = window.API_BASE_URL || '';
            var basePath = isClient
                ? prefix + '/client/table/' + tableId + '/actions/'
                : prefix + '/table/' + tableId + '/cards/';
            window.location.href = basePath + '?status=pending';
        });
    }

    // ==================== BUTTON HANDLERS ====================

    if (GSP.addBtn) GSP.addBtn.addEventListener('click', () => GSP.openDrawer('add'));

    if (GSP.downloadFieldsBtn) {
        GSP.downloadFieldsBtn.addEventListener('click', () => {
            if (!GSP.selectedTableId) {
                showToast('Please select a table first.', 'warning');
                return;
            }
            GSP.downloadTableFieldsTxt(GSP.selectedTableId);
        });
    }

    if (GSP.editBtn) {
        GSP.editBtn.addEventListener('click', async () => {
            if (GSP.selectedTableId) {
                const tableData = await GSP.fetchTableData(GSP.selectedTableId);
                if (tableData) GSP.openDrawer('edit', tableData);
            }
        });
    }

    if (GSP.viewBtn) {
        GSP.viewBtn.addEventListener('click', async () => {
            if (GSP.selectedTableId) {
                const tableData = await GSP.fetchTableData(GSP.selectedTableId);
                if (tableData) GSP.openDrawer('view', tableData);
            }
        });
    }

    if (GSP.toggleStatusBtn) {
        GSP.toggleStatusBtn.addEventListener('click', () => {
            if (!GSP.selectedRow) return;
            const name = GSP.selectedRow.dataset.tableName;
            const currentStatus = GSP.selectedRow.dataset.tableStatus;
            const newStatus = currentStatus === 'active' ? 'Inactive' : 'Active';

            if (GSP.statusItemName) GSP.statusItemName.textContent = `"${name}"`;
            if (GSP.statusNote) GSP.statusNote.innerHTML = `<i class="fa-solid fa-circle-info"></i> Table will be set to ${newStatus}.`;
            if (window.alpineOpenModal) window.alpineOpenModal('status');
        });
    }

    // Delete button click handler
    if (GSP.deleteBtn) {
        GSP.deleteBtn.addEventListener('click', async () => {
            if (!GSP.selectedRow) return;
            const tableId = GSP.selectedTableId || GSP.selectedRow.dataset.tableId;
            const name = GSP.selectedRow.dataset.tableName;

            // Check table status counts before allowing deletion
            try {
                const resp = await ApiClient.get(`/api/table/${tableId}/status-counts/`);
                const total = resp && resp.status_counts ? (resp.status_counts.total || 0) : 0;
                if (total > 0) {
                    showToast('Cannot delete table: it contains cards. Please move or delete all cards first.', 'error');
                    return;
                }
            } catch (err) {
                // If the check fails, fall back to showing server-side validation when attempting delete
                console.warn('Could not verify table counts before delete', err);
            }

            if (GSP.deleteStaffName) GSP.deleteStaffName.textContent = name;
            if (window.alpineOpenModal) window.alpineOpenModal('delete');
        });
    }

    // ==================== MODAL HANDLERS ====================

    // Delete modal confirm
    // Close handlers now managed by Alpine x-show + @click in template
    if (GSP.confirmDeleteBtn) {
        GSP.confirmDeleteBtn.addEventListener('click', async () => {
            if (window.alpineCloseModal) window.alpineCloseModal();
            if (!GSP.selectedTableId) return;

            // Prevent double-click
            GSP.confirmDeleteBtn.disabled = true;

            try {
                const data = await ApiClient.delete(`/api/table/${GSP.selectedTableId}/delete/`);

                if (data.success) {
                    showToast(data.message || 'Table deleted successfully!', 'success');
                    // Remove the row from DOM
                    if (GSP.selectedRow) GSP.selectedRow.remove();
                    GSP.selectedRow = null;
                    GSP.selectedTableId = null;
                    GSP.updateActionButtons();
                } else {
                    showToast(data.message || 'Error deleting table', 'error');
                }
            } catch (error) {
                console.error('Error deleting table:', error);
                showToast('Error deleting table', 'error');
                GSP.confirmDeleteBtn.disabled = false;
            }
        });
    }

    // Overlay click-to-close + cancel/close buttons now handled by Alpine @click in template
    if (GSP.modalConfirm) GSP.modalConfirm.addEventListener('click', () => {
        if (window.alpineCloseModal) window.alpineCloseModal();
        GSP.toggleStatus();
    });

    // ==================== DRAWER HANDLERS ====================

    if (GSP.closeDrawerEl) GSP.closeDrawerEl.addEventListener('click', GSP.closeDrawerModal);
    if (GSP.cancelDrawer) GSP.cancelDrawer.addEventListener('click', GSP.closeDrawerModal);
    if (GSP.saveDrawer) GSP.saveDrawer.addEventListener('click', GSP.saveTable);
    // Outside click close disabled  prevent accidental closure

    // Escape key closes drawer (modals now handled by Alpine layoutState)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (GSP.addDrawer && GSP.addDrawer.classList.contains('open')) {
                GSP.closeDrawerModal();
            }
            // Alpine handles Escape for activeModal in layoutState()
        }
    });

    // ==================== ADD FIELD HANDLER ====================

    if (GSP.addFieldBtnEl) {
        GSP.addFieldBtnEl.addEventListener('click', () => {
            const type = GSP.newFieldType.value;
            const isMandatory = GSP.newFieldMandatory ? GSP.newFieldMandatory.checked : false;

            // Handle Class & Section: auto-add two fields
            if (type === 'class_section') {
                if (GSP.currentFields.length + 2 > GSP.MAX_FIELDS) {
                    showToast(`Not enough room! Need 2 slots but only ${GSP.MAX_FIELDS - GSP.currentFields.length} left.`, 'warning');
                    return;
                }
                if (GSP.currentFields.some(f => f.name.toLowerCase() === 'class' || f.name.toLowerCase() === 'section')) {
                    showToast('Class or Section field already exists!', 'error');
                    return;
                }
                GSP.currentFields.push({ name: 'CLASS', type: 'class', order: GSP.currentFields.length, mandatory: isMandatory });
                GSP.currentFields.push({ name: 'SECTION', type: 'section', order: GSP.currentFields.length, mandatory: isMandatory });
                GSP.renderFieldList();
                GSP.newFieldName.value = '';
                if (GSP.newFieldMandatory) GSP.newFieldMandatory.checked = false;
                GSP.resetFieldTypeDropdown();
                showToast('Class & Section fields added!', 'success');
                return;
            }

            const name = GSP.newFieldName.value.trim();

            if (!name) { showToast('Please enter a field name!', 'error'); GSP.newFieldName.focus(); return; }
            if (GSP.currentFields.length >= GSP.MAX_FIELDS) { showToast(`Maximum ${GSP.MAX_FIELDS} fields allowed!`, 'warning'); return; }
            if (GSP.currentFields.some(f => f.name.toLowerCase() === name.toLowerCase())) { showToast('Field with this name already exists!', 'error'); return; }

            // Auto-detect field type from name when type is left as default "text"
            let finalType = type;
            if (type === 'text') {
                const detected = GSP.detectFieldTypeFromName(name);
                if (detected) {
                    finalType = detected;
                    const typeLabel = GSP.getFieldTypeLabel(detected);
                    showToast(`Auto-detected "${name}" as ${typeLabel} type`, 'info');
                }
            }

            // Auto-set mandatory for image-type fields
            let finalMandatory = isMandatory;
            if (GSP.imageFieldTypes.includes(finalType)) {
                finalMandatory = true;
            }

            GSP.currentFields.push({ name: name, type: finalType, order: GSP.currentFields.length, mandatory: finalMandatory });
            GSP.renderFieldList();
            GSP.newFieldName.value = '';
            if (GSP.newFieldMandatory) GSP.newFieldMandatory.checked = false;
            GSP.resetFieldTypeDropdown();
            showToast('Field added!', 'success');
        });
    }

    if (GSP.newFieldName) GSP.newFieldName.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); GSP.addFieldBtnEl.click(); } });

    // ==================== FIELD TYPE CUSTOM DROPDOWN ====================

    if (GSP.fieldTypeDropdown && GSP.fieldTypeToggle) {
        // Toggle dropdown on button click
        GSP.fieldTypeToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            GSP.fieldTypeDropdown.classList.toggle('open');
        });

        // Handle option selection
        GSP.fieldTypeDropdown.querySelectorAll('.dropdown-option').forEach(option => {
            option.addEventListener('click', function(e) {
                e.stopPropagation();
                // Update selected state
                GSP.fieldTypeDropdown.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
                this.classList.add('selected');

                // Update toggle button text
                GSP.fieldTypeToggle.querySelector('span').textContent = this.textContent;

                // Update hidden input value
                const selectedType = this.dataset.value;
                if (GSP.newFieldType) GSP.newFieldType.value = selectedType;

                // Update name input based on field type
                GSP.updateFieldNameInput(selectedType);

                // Close dropdown
                GSP.fieldTypeDropdown.classList.remove('open');
            });
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!GSP.fieldTypeDropdown.contains(e.target)) {
                GSP.fieldTypeDropdown.classList.remove('open');
            }
        });
    }

    // ==================== FIELD LIST EVENT HANDLERS ====================

    if (GSP.fieldList) {
        GSP.fieldList.addEventListener('click', (e) => {
            if (e.target.closest('.remove-field-btn')) {
                const idx = parseInt(e.target.closest('.remove-field-btn').dataset.idx);
                GSP.currentFields.splice(idx, 1);
                GSP.renderFieldList();
                showToast('Field removed!', 'info');
            }
        });

        GSP.fieldList.addEventListener('change', (e) => {
            if (e.target.classList.contains('field-type-select')) {
                const idx = parseInt(e.target.dataset.idx);
                GSP.currentFields[idx].type = e.target.value;
                // Auto-set mandatory for image-type fields
                if (GSP.imageFieldTypes.includes(e.target.value)) {
                    GSP.currentFields[idx].mandatory = true;
                    GSP.renderFieldList();
                }
            }
            // Handle mandatory checkbox changes
            if (e.target.classList.contains('field-mandatory-checkbox')) {
                const idx = parseInt(e.target.dataset.idx);
                GSP.currentFields[idx].mandatory = e.target.checked;
            }
        });

        // Sync field name edits back to currentFields
        GSP.fieldList.addEventListener('input', (e) => {
            if (e.target.classList.contains('field-name-input')) {
                const idx = parseInt(e.target.dataset.idx);
                GSP.currentFields[idx].name = e.target.value.trim();
            }
        });
    }

    // ==================== SEARCH & FILTER HANDLERS ====================

    if (GSP.searchInput) GSP.searchInput.addEventListener('input', GSP.performSearch);

    if (GSP.dropdownToggle && GSP.dropdownOptions && GSP.filterDropdown) {
        GSP.dropdownToggle.addEventListener('click', (e) => { e.stopPropagation(); GSP.filterDropdown.classList.toggle('open'); });

        GSP.dropdownOptions.querySelectorAll('.dropdown-option').forEach(option => {
            option.addEventListener('click', function() {
                GSP.dropdownOptions.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
                this.classList.add('selected');
                GSP.selectedText.textContent = this.textContent;
                GSP.currentFilter = this.dataset.value;
                GSP.filterDropdown.classList.remove('open');
                GSP.searchInput.placeholder = `Search by ${this.textContent}...`;
                GSP.performSearch();
            });
        });

        document.addEventListener('click', () => GSP.filterDropdown.classList.remove('open'));
    }

    // ==================== PAGINATION HANDLERS ====================

    document.getElementById('gsFirstPage')?.addEventListener('click', () => { GSP.gsCurrentPage = 1; GSP.renderPagination(); });
    document.getElementById('gsPrevPage')?.addEventListener('click', () => { GSP.gsCurrentPage = Math.max(1, GSP.gsCurrentPage - 1); GSP.renderPagination(); });
    document.getElementById('gsNextPage')?.addEventListener('click', () => { GSP.gsCurrentPage++; GSP.renderPagination(); });
    document.getElementById('gsLastPage')?.addEventListener('click', () => {
        const total = GSP.getVisibleRows().length;
        GSP.gsCurrentPage = Math.max(1, Math.ceil(total / GSP.gsRowsPerPage));
        GSP.renderPagination();
    });

    // Rows-per-page dropdown
    const rowsToggle = document.getElementById('rowsToggle');
    const rowsOptions = document.getElementById('rowsOptions');
    const rowsDropdown = document.getElementById('rowsDropdown');
    const rowsLabel = document.getElementById('rowsLabel');

    if (rowsToggle && rowsOptions) {
        rowsToggle.addEventListener('click', (e) => { e.stopPropagation(); rowsDropdown.classList.toggle('open'); });
        rowsOptions.querySelectorAll('.dropdown-option').forEach(opt => {
            opt.addEventListener('click', function() {
                rowsOptions.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
                this.classList.add('selected');
                if (rowsLabel) rowsLabel.textContent = this.dataset.value;
                GSP.gsRowsPerPage = parseInt(this.dataset.value);
                GSP.gsCurrentPage = 1;
                rowsDropdown.classList.remove('open');
                GSP.renderPagination();
            });
        });
        document.addEventListener('click', (e) => { if (!rowsDropdown.contains(e.target)) rowsDropdown.classList.remove('open'); });
    }

    // ==================== INITIALIZATION ====================
    GSP.updateActionButtons();
    GSP.updateFieldCount();
    GSP.renderPagination();
});
