// Group Setting Page JavaScript - Table Layout

document.addEventListener('DOMContentLoaded', function() {

    // ==================== ELEMENTS ====================
    const tablesBody = document.getElementById('tablesBody');
    
    const addBtn = document.getElementById('addBtn');
    const editBtn = document.getElementById('editBtn');
    const viewBtn = document.getElementById('viewBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const toggleStatusBtn = document.getElementById('toggle-status-btn');
    
    const addDrawer = document.getElementById('add-drawer');
    const closeDrawer = document.getElementById('closeDrawer');
    const cancelDrawer = document.getElementById('cancelDrawer');
    const saveDrawer = document.getElementById('saveDrawer');
    const drawerTitle = document.getElementById('drawerTitle');
    const drawerIcon = document.getElementById('drawerIcon');
    const tableNameInput = document.getElementById('tableName');
    const fieldList = document.getElementById('field-list');
    const fieldCountSpan = document.getElementById('fieldCount');
    const noFieldsMessage = document.getElementById('no-fields-message');
    const addFieldSection = document.querySelector('.add-field-section');
    
    const newFieldName = document.getElementById('new-field-name');
    const newFieldType = document.getElementById('new-field-type');
    const newFieldMandatory = document.getElementById('new-field-mandatory');
    const addFieldBtn = document.getElementById('add-field-btn');
    
    const statusModal = document.getElementById('status-modal');
    const modalClose = document.getElementById('modal-close');
    const modalCancel = document.getElementById('modal-cancel');
    const modalConfirm = document.getElementById('modal-confirm');
    const modalMessage = document.getElementById('modal-message');
    const modalIcon = document.getElementById('modalIcon');
    
    const deleteModal = document.getElementById('delete-modal');
    const closeDeleteModal = document.getElementById('closeDeleteModal');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const deleteTableName = document.getElementById('deleteTableName');
    
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    
    const searchInput = document.getElementById('searchInput');
    const filterDropdown = document.getElementById('filterDropdown');
    const dropdownToggle = document.getElementById('dropdownToggle');
    const dropdownOptions = document.getElementById('dropdownOptions');
    const selectedText = document.getElementById('selectedText');
    
    let selectedRow = null;
    let selectedTableId = null;
    let currentMode = 'add';
    let currentFields = [];
    const MAX_FIELDS = 20;

    const groupId = typeof GROUP_ID !== 'undefined' ? GROUP_ID : null;

    // ==================== TOAST FUNCTIONS ====================
    // Using shared showToast from utils.js

    function updateFieldCount() {
        if (fieldCountSpan) fieldCountSpan.textContent = currentFields.length;
        if (noFieldsMessage) noFieldsMessage.style.display = currentFields.length === 0 ? 'block' : 'none';
        if (addFieldBtn) addFieldBtn.disabled = currentFields.length >= MAX_FIELDS;
    }

    // Reset field type dropdown to default (Text) and enable name input
    function resetFieldTypeDropdown() {
        const fieldTypeDropdown = document.getElementById('fieldTypeDropdown');
        const fieldTypeToggle = document.getElementById('fieldTypeToggle');
        if (fieldTypeDropdown) {
            fieldTypeDropdown.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
            const textOption = fieldTypeDropdown.querySelector('.dropdown-option[data-value="text"]');
            if (textOption) textOption.classList.add('selected');
            if (fieldTypeToggle) fieldTypeToggle.querySelector('span').textContent = 'Text';
            if (newFieldType) newFieldType.value = 'text';
        }
        // Re-enable name input when resetting to text type
        if (newFieldName) {
            newFieldName.disabled = false;
            newFieldName.classList.remove('disabled');
        }
    }

    // ==================== ROW SELECTION ====================
    if (tablesBody) {
        tablesBody.addEventListener('click', function(e) {
            // Handle download button click
            if (e.target.closest('.download-btn')) {
                e.stopPropagation();
                const btn = e.target.closest('.download-btn');
                const tableId = btn.dataset.tableId;
                downloadTableFields(tableId);
                return;
            }
            
            const row = e.target.closest('tr');
            if (!row || !row.dataset.tableId || row.classList.contains('no-data-row')) return;
            
            if (selectedRow === row) {
                row.classList.remove('selected');
                selectedRow = null;
                selectedTableId = null;
            } else {
                if (selectedRow) selectedRow.classList.remove('selected');
                row.classList.add('selected');
                selectedRow = row;
                selectedTableId = row.dataset.tableId;
            }
            updateActionButtons();
        });
    }

    function updateActionButtons() {
        const hasSelection = selectedRow !== null;
        if (editBtn) editBtn.disabled = !hasSelection;
        if (viewBtn) viewBtn.disabled = !hasSelection;
        if (deleteBtn) deleteBtn.disabled = !hasSelection;
        if (toggleStatusBtn) toggleStatusBtn.disabled = !hasSelection;
        
        // Update toggle status button text and class based on current status
        if (hasSelection && toggleStatusBtn) {
            const currentStatus = selectedRow.dataset.tableStatus;
            if (currentStatus === 'active') {
                // Row is Active, so button should show "Inactive" to deactivate
                toggleStatusBtn.innerHTML = '<i class="fa-solid fa-times"></i> Inactive';
                toggleStatusBtn.classList.remove('btn-active');
                toggleStatusBtn.classList.add('btn-inactive');
            } else {
                // Row is Inactive, so button should show "Active" to activate
                toggleStatusBtn.innerHTML = '<i class="fa-solid fa-check"></i> Active';
                toggleStatusBtn.classList.remove('btn-inactive');
                toggleStatusBtn.classList.add('btn-active');
            }
        } else if (toggleStatusBtn) {
            toggleStatusBtn.innerHTML = '<i class="fa-solid fa-check"></i> Active';
            toggleStatusBtn.classList.remove('btn-inactive');
            toggleStatusBtn.classList.add('btn-active');
        }
    }

    // ==================== DOWNLOAD EXCEL FUNCTION ====================
    async function downloadTableFields(tableId) {
        try {
            const response = await fetch(`/panel/api/table/${tableId}/`);
            const data = await response.json();
            
            if (!data.success) {
                showToast(data.message || 'Error fetching table data', 'error');
                return;
            }
            
            const table = data.table;
            const fields = table.fields || [];
            
            if (fields.length === 0) {
                showToast('No fields to download!', 'error');
                return;
            }
            
            // Create Excel workbook using SheetJS
            const headers = fields.map(f => f.name);
            
            // Create worksheet with headers only
            const wsData = [headers];
            const ws = XLSX.utils.aoa_to_sheet(wsData);
            
            // Set column widths based on header lengths
            const colWidths = headers.map(h => ({ wch: Math.max(h.length + 5, 15) }));
            ws['!cols'] = colWidths;
            
            // Create workbook
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Template');
            
            // Generate filename
            const filename = `${table.name.replace(/[^a-z0-9]/gi, '_')}_template.xlsx`;
            
            // Download the Excel file
            XLSX.writeFile(wb, filename);
            
            showToast('Excel template downloaded successfully!', 'success');
        } catch (error) {
            console.error('Download error:', error);
            showToast('Error downloading template', 'error');
        }
    }

    // ==================== DRAWER FUNCTIONS ====================
    
    // Auto-detect field type from name using strict exact-match only.
    // Prevents misdetection (e.g. "Designation" will NOT match "Signature").
    function detectFieldTypeFromName(name) {
        const n = name.toLowerCase().trim();
        const typeMap = {
            // Class variants
            'class': 'class',
            'std': 'class',
            'standard': 'class',
            'grade': 'class',
            // Section variants
            'section': 'section',
            'sec': 'section',
            'division': 'section',
            'div': 'section',
            // Email variants
            'email': 'email',
            'e-mail': 'email',
            'e mail': 'email',
            'mail': 'email',
            'email id': 'email',
            'mail id': 'email',
            'email address': 'email',
            // Photo variants
            'photo': 'photo',
            'photograph': 'photo',
            'student photo': 'photo',
            'student image': 'photo',
            // Mother Photo variants
            'mother photo': 'mother_photo',
            "mother's photo": 'mother_photo',
            'mother image': 'mother_photo',
            // Father Photo variants
            'father photo': 'father_photo',
            "father's photo": 'father_photo',
            'father image': 'father_photo',
            // Barcode variants
            'barcode': 'barcode',
            'bar code': 'barcode',
            // QR Code variants
            'qr code': 'qr_code',
            'qrcode': 'qr_code',
            'qr': 'qr_code',
            // Signature
            'signature': 'signature',
        };
        return typeMap[n] || null;
    }

    // Field type options with display labels
    const fieldTypeOptions = [
        { value: 'text', label: 'Text' },
        { value: 'email', label: 'Email' },
        { value: 'class', label: 'Class' },
        { value: 'section', label: 'Section' },
        { value: 'photo', label: 'Photo' },
        { value: 'mother_photo', label: 'Mother Photo' },
        { value: 'father_photo', label: 'Father Photo' },
        { value: 'barcode', label: 'Barcode' },
        { value: 'qr_code', label: 'QR Code' },
        { value: 'signature', label: 'Signature' }
    ];
    
    function getFieldTypeLabel(value) {
        const option = fieldTypeOptions.find(o => o.value === value);
        return option ? option.label : value;
    }
    
    function renderFieldList() {
        if (!fieldList) return;
        fieldList.innerHTML = '';
        
        currentFields.forEach((field, idx) => {
            const li = document.createElement('li');
            li.className = 'field-list-item';
            li.dataset.idx = idx;
            li.draggable = currentMode !== 'view';
            
            const typeOptionsHtml = fieldTypeOptions.map(t => 
                `<option value="${t.value}" ${field.type === t.value ? 'selected' : ''}>${t.label}</option>`
            ).join('');
            
            // In add/edit mode, field name is an editable input; in view mode it's plain text
            const fieldNameHtml = currentMode !== 'view'
                ? `<span class="field-name"><input type="text" class="field-name-input" data-idx="${idx}" value="${field.name}" placeholder="Field name">${field.mandatory ? '<span class="mandatory-indicator" title="Required field">*</span>' : ''}</span>`
                : `<span class="field-name">${field.name}${field.mandatory ? '<span class="mandatory-indicator" title="Required field">*</span>' : ''}</span>`;
            
            // Mandatory checkbox for edit mode
            const mandatoryHtml = currentMode !== 'view'
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
                    <select class="field-type-select" data-idx="${idx}" ${currentMode === 'view' ? 'disabled' : ''}>
                        ${typeOptionsHtml}
                    </select>
                </span>
                ${mandatoryHtml}
                <span class="field-action">
                    ${currentMode !== 'view' ? `<button class="remove-field-btn" data-idx="${idx}"><i class="fa-solid fa-xmark"></i></button>` : ''}
                </span>
            `;
            fieldList.appendChild(li);
        });
        
        updateFieldCount();
        if (currentMode !== 'view') setupDragAndDrop();
    }

    function setupDragAndDrop() {
        const items = fieldList.querySelectorAll('.field-list-item');
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
                updateFieldOrder();
            });

            item.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const afterElement = getDragAfterElement(fieldList, e.clientY);
                if (afterElement == null) {
                    fieldList.appendChild(draggedItem);
                } else {
                    fieldList.insertBefore(draggedItem, afterElement);
                }
            });
        });
    }

    function getDragAfterElement(container, y) {
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
    }

    function updateFieldOrder() {
        const items = fieldList.querySelectorAll('.field-list-item');
        const newFields = [];
        items.forEach((item, idx) => {
            const oldIdx = parseInt(item.dataset.idx);
            if (currentFields[oldIdx]) newFields.push({...currentFields[oldIdx], order: idx});
        });
        currentFields = newFields;
        renderFieldList();
    }

    function openDrawer(mode, data = null) {
        currentMode = mode;
        addDrawer.classList.remove('view-mode');
        
        if (mode === 'add') {
            drawerTitle.textContent = 'Create New Table';
            drawerIcon.className = 'fa-solid fa-table-list';
            tableNameInput.value = '';
            tableNameInput.disabled = false;
            currentFields = [];
            saveDrawer.style.display = 'inline-flex';
            saveDrawer.innerHTML = '<i class="fa-solid fa-plus"></i> Create';
            saveDrawer.className = 'btn btn-save';
            if (addFieldSection) addFieldSection.style.display = 'block';
        } else if (mode === 'edit') {
            drawerTitle.textContent = 'Edit Table';
            drawerIcon.className = 'fa-solid fa-pen-to-square';
            tableNameInput.value = data.name || '';
            tableNameInput.disabled = false;
            currentFields = data.fields || [];
            saveDrawer.style.display = 'inline-flex';
            saveDrawer.innerHTML = '<i class="fa-solid fa-check"></i> Update';
            saveDrawer.className = 'btn btn-update';
            if (addFieldSection) addFieldSection.style.display = 'block';
        } else if (mode === 'view') {
            drawerTitle.textContent = 'View Table';
            drawerIcon.className = 'fa-solid fa-eye';
            tableNameInput.value = data.name || '';
            tableNameInput.disabled = true;
            currentFields = data.fields || [];
            saveDrawer.style.display = 'none';
            if (addFieldSection) addFieldSection.style.display = 'none';
            addDrawer.classList.add('view-mode');
        }
        
        renderFieldList();
        addDrawer.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeDrawerModal() {
        addDrawer.classList.remove('open');
        addDrawer.classList.remove('view-mode');
        document.body.style.overflow = '';
        currentFields = [];
        if (newFieldName) newFieldName.value = '';
        resetFieldTypeDropdown();
    }

    // ==================== API FUNCTIONS ====================
    async function fetchTableData(tableId) {
        try {
            const response = await fetch(`/panel/api/table/${tableId}/`);
            const data = await response.json();
            if (data.success) return data.table;
            showToast(data.message || 'Error fetching table data', 'error');
            return null;
        } catch (error) {
            showToast('Error fetching table data', 'error');
            return null;
        }
    }

    async function saveTable() {
        const name = tableNameInput.value.trim();
        if (!name) {
            showToast('Please enter a table name!', 'error');
            tableNameInput.focus();
            return;
        }

        if (currentFields.length === 0) {
            showToast('Please add at least one field!', 'error');
            return;
        }

        // Prevent double-click
        if (saveDrawer) {
            saveDrawer.disabled = true;
            saveDrawer.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        }

        const payload = {
            name: name,
            fields: currentFields.map((f, idx) => ({ name: f.name, type: f.type, order: idx }))
        };

        try {
            let url = currentMode === 'add' ? `/panel/api/group/${groupId}/table/create/` : `/panel/api/table/${selectedTableId}/update/`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();

            if (data.success) {
                showToast(data.message || 'Table saved successfully!', 'success');
                closeDrawerModal();
                setTimeout(() => window.location.reload(), 500);
            } else {
                showToast(data.message || 'Error saving table', 'error');
                // Re-enable button on error
                if (saveDrawer) {
                    saveDrawer.disabled = false;
                    saveDrawer.innerHTML = currentMode === 'add'
                        ? '<i class="fa-solid fa-plus"></i> Create'
                        : '<i class="fa-solid fa-check"></i> Update';
                }
            }
        } catch (error) {
            showToast('Error saving table', 'error');
            // Re-enable button on error
            if (saveDrawer) {
                saveDrawer.disabled = false;
                saveDrawer.innerHTML = currentMode === 'add'
                    ? '<i class="fa-solid fa-plus"></i> Create'
                    : '<i class="fa-solid fa-check"></i> Update';
            }
        }
    }

    async function toggleStatus() {
        if (!selectedTableId) return;

        // Prevent double-click
        if (modalConfirm) modalConfirm.disabled = true;

        try {
            const response = await fetch(`/panel/api/table/${selectedTableId}/toggle-status/`, { method: 'POST' });
            const data = await response.json();

            if (data.success) {
                showToast(data.message || 'Status updated!', 'success');
                setTimeout(() => window.location.reload(), 500);
            } else {
                showToast(data.message || 'Error updating status', 'error');
                if (modalConfirm) modalConfirm.disabled = false;
            }
        } catch (error) {
            showToast('Error updating status', 'error');
            if (modalConfirm) modalConfirm.disabled = false;
        }
    }

    // ==================== EVENT HANDLERS ====================
    if (addBtn) addBtn.addEventListener('click', () => openDrawer('add'));

    if (editBtn) {
        editBtn.addEventListener('click', async () => {
            if (selectedTableId) {
                const tableData = await fetchTableData(selectedTableId);
                if (tableData) openDrawer('edit', tableData);
            }
        });
    }

    if (viewBtn) {
        viewBtn.addEventListener('click', async () => {
            if (selectedTableId) {
                const tableData = await fetchTableData(selectedTableId);
                if (tableData) openDrawer('view', tableData);
            }
        });
    }

    if (toggleStatusBtn) {
        toggleStatusBtn.addEventListener('click', () => {
            if (!selectedRow) return;
            const name = selectedRow.dataset.tableName;
            const currentStatus = selectedRow.dataset.tableStatus;
            const newStatus = currentStatus === 'active' ? 'Inactive' : 'Active';
            
            if (modalMessage) modalMessage.textContent = `Are you sure you want to set "${name}" to ${newStatus}?`;
            if (modalIcon) {
                if (currentStatus === 'active') {
                    modalIcon.innerHTML = '<i class="fa-solid fa-toggle-off"></i>';
                } else {
                    modalIcon.innerHTML = '<i class="fa-solid fa-toggle-on"></i>';
                }
            }
            if (statusModal) statusModal.classList.add('show');
        });
    }

    // Delete button click handler
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (!selectedRow) return;
            const name = selectedRow.dataset.tableName;
            if (deleteTableName) deleteTableName.textContent = name;
            if (deleteModal) deleteModal.classList.add('show');
        });
    }

    // Delete modal handlers
    if (closeDeleteModal) closeDeleteModal.addEventListener('click', () => deleteModal.classList.remove('show'));
    if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', () => deleteModal.classList.remove('show'));
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            deleteModal.classList.remove('show');
            if (!selectedTableId) return;
            
            // Prevent double-click
            confirmDeleteBtn.disabled = true;

            try {
                const response = await fetch(`/panel/api/table/${selectedTableId}/delete/`, { method: 'DELETE' });
                const data = await response.json();
                
                if (data.success) {
                    showToast(data.message || 'Table deleted successfully!', 'success');
                    // Remove the row from DOM
                    if (selectedRow) selectedRow.remove();
                    selectedRow = null;
                    selectedTableId = null;
                    updateActionButtons();
                } else {
                    showToast(data.message || 'Error deleting table', 'error');
                }
            } catch (error) {
                console.error('Error deleting table:', error);
                showToast('Error deleting table', 'error');
                confirmDeleteBtn.disabled = false;
            }
        });
    }
    if (deleteModal) deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) deleteModal.classList.remove('show'); });

    if (modalClose) modalClose.addEventListener('click', () => statusModal.classList.remove('show'));
    if (modalCancel) modalCancel.addEventListener('click', () => statusModal.classList.remove('show'));
    if (modalConfirm) modalConfirm.addEventListener('click', () => {
        statusModal.classList.remove('show');
        toggleStatus();
    });
    if (statusModal) statusModal.addEventListener('click', (e) => { if (e.target === statusModal) statusModal.classList.remove('show'); });

    if (closeDrawer) closeDrawer.addEventListener('click', closeDrawerModal);
    if (cancelDrawer) cancelDrawer.addEventListener('click', closeDrawerModal);
    if (saveDrawer) saveDrawer.addEventListener('click', saveTable);
    if (addDrawer) addDrawer.addEventListener('click', (e) => { if (e.target === addDrawer) closeDrawerModal(); });

    // Escape key closes drawer and modals
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (addDrawer && addDrawer.classList.contains('open')) {
                closeDrawerModal();
            } else if (deleteModal && deleteModal.classList.contains('show')) {
                deleteModal.classList.remove('show');
            } else if (statusModal && statusModal.classList.contains('show')) {
                statusModal.classList.remove('show');
            }
        }
    });

    if (addFieldBtn) {
        addFieldBtn.addEventListener('click', () => {
            const type = newFieldType.value;
            const isMandatory = newFieldMandatory ? newFieldMandatory.checked : false;
            
            // Handle Class & Section: auto-add two fields
            if (type === 'class_section') {
                if (currentFields.length + 2 > MAX_FIELDS) {
                    showToast(`Not enough room! Need 2 slots but only ${MAX_FIELDS - currentFields.length} left.`, 'error');
                    return;
                }
                if (currentFields.some(f => f.name.toLowerCase() === 'class' || f.name.toLowerCase() === 'section')) {
                    showToast('Class or Section field already exists!', 'error');
                    return;
                }
                currentFields.push({ name: 'CLASS', type: 'class', order: currentFields.length, mandatory: isMandatory });
                currentFields.push({ name: 'SECTION', type: 'section', order: currentFields.length, mandatory: isMandatory });
                renderFieldList();
                newFieldName.value = '';
                if (newFieldMandatory) newFieldMandatory.checked = false;
                resetFieldTypeDropdown();
                showToast('Class & Section fields added!', 'success');
                return;
            }
            
            const name = newFieldName.value.trim();

            if (!name) { showToast('Please enter a field name!', 'error'); newFieldName.focus(); return; }
            if (currentFields.length >= MAX_FIELDS) { showToast(`Maximum ${MAX_FIELDS} fields allowed!`, 'error'); return; }
            if (currentFields.some(f => f.name.toLowerCase() === name.toLowerCase())) { showToast('Field with this name already exists!', 'error'); return; }

            // Auto-detect field type from name when type is left as default "text"
            let finalType = type;
            if (type === 'text') {
                const detected = detectFieldTypeFromName(name);
                if (detected) {
                    finalType = detected;
                    const typeLabel = getFieldTypeLabel(detected);
                    showToast(`Auto-detected "${name}" as ${typeLabel} type`, 'info');
                }
            }

            currentFields.push({ name: name, type: finalType, order: currentFields.length, mandatory: isMandatory });
            renderFieldList();
            newFieldName.value = '';
            if (newFieldMandatory) newFieldMandatory.checked = false;
            resetFieldTypeDropdown();
            showToast('Field added!', 'success');
        });
    }

    if (newFieldName) newFieldName.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFieldBtn.click(); } });

    // ==================== FIELD TYPE CUSTOM DROPDOWN ====================
    const fieldTypeDropdown = document.getElementById('fieldTypeDropdown');
    const fieldTypeToggle = document.getElementById('fieldTypeToggle');
    
    // Image types that have fixed names (not editable)
    const imageFieldTypes = ['photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature'];
    
    // Map of image types to their fixed display names
    const imageFieldNames = {
        'photo': 'Photo',
        'mother_photo': 'Mother Photo',
        'father_photo': 'Father Photo',
        'barcode': 'Barcode',
        'qr_code': 'QR Code',
        'signature': 'Signature'
    };
    
    // Types with auto-generated names (name input disabled)
    const autoNameTypes = ['class_section', ...imageFieldTypes];
    
    function updateFieldNameInput(fieldType) {
        if (!newFieldName) return;
        
        if (fieldType === 'class_section') {
            // Class & Section: auto-generate, disable input
            newFieldName.value = 'Class & Section (auto)';
            newFieldName.disabled = true;
            newFieldName.classList.add('disabled');
        } else if (imageFieldTypes.includes(fieldType)) {
            // Image type: auto-fill name and disable input
            newFieldName.value = imageFieldNames[fieldType];
            newFieldName.disabled = true;
            newFieldName.classList.add('disabled');
        } else {
            // Text/Email: enable input and clear if it was auto-filled
            if (newFieldName.disabled) {
                newFieldName.value = '';
            }
            newFieldName.disabled = false;
            newFieldName.classList.remove('disabled');
        }
    }
    
    if (fieldTypeDropdown && fieldTypeToggle) {
        // Toggle dropdown on button click
        fieldTypeToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            fieldTypeDropdown.classList.toggle('open');
        });
        
        // Handle option selection
        fieldTypeDropdown.querySelectorAll('.dropdown-option').forEach(option => {
            option.addEventListener('click', function(e) {
                e.stopPropagation();
                // Update selected state
                fieldTypeDropdown.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
                this.classList.add('selected');
                
                // Update toggle button text
                fieldTypeToggle.querySelector('span').textContent = this.textContent;
                
                // Update hidden input value
                const selectedType = this.dataset.value;
                if (newFieldType) newFieldType.value = selectedType;
                
                // Update name input based on field type
                updateFieldNameInput(selectedType);
                
                // Close dropdown
                fieldTypeDropdown.classList.remove('open');
            });
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!fieldTypeDropdown.contains(e.target)) {
                fieldTypeDropdown.classList.remove('open');
            }
        });
    }

    if (fieldList) {
        fieldList.addEventListener('click', (e) => {
            if (e.target.closest('.remove-field-btn')) {
                const idx = parseInt(e.target.closest('.remove-field-btn').dataset.idx);
                currentFields.splice(idx, 1);
                renderFieldList();
                showToast('Field removed!', 'info');
            }
        });

        fieldList.addEventListener('change', (e) => {
            if (e.target.classList.contains('field-type-select')) {
                const idx = parseInt(e.target.dataset.idx);
                currentFields[idx].type = e.target.value;
            }
            // Handle mandatory checkbox changes
            if (e.target.classList.contains('field-mandatory-checkbox')) {
                const idx = parseInt(e.target.dataset.idx);
                currentFields[idx].mandatory = e.target.checked;
            }
        });

        // Sync field name edits back to currentFields
        fieldList.addEventListener('input', (e) => {
            if (e.target.classList.contains('field-name-input')) {
                const idx = parseInt(e.target.dataset.idx);
                currentFields[idx].name = e.target.value.trim();
            }
        });
    }

    // ==================== SEARCH, FILTER & PAGINATION ====================
    let currentFilter = 'all';
    let gsCurrentPage = 1;
    let gsRowsPerPage = 10;

    function getVisibleRows() {
        // Returns rows that match the current search/filter (not hidden by search)
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const allRows = tablesBody ? Array.from(tablesBody.querySelectorAll('tr:not(.no-data-row)')) : [];
        if (!searchTerm) return allRows;
        
        return allRows.filter(row => {
            const name = row.querySelector('td:first-child')?.textContent.toLowerCase() || '';
            const status = row.dataset.tableStatus || '';
            const createdAt = row.querySelector('td:nth-child(3)')?.textContent.toLowerCase() || '';
            const updatedAt = row.querySelector('td:nth-child(4)')?.textContent.toLowerCase() || '';
            
            if (currentFilter === 'all') {
                return name.includes(searchTerm) || status.includes(searchTerm) || createdAt.includes(searchTerm) || updatedAt.includes(searchTerm);
            } else if (currentFilter === 'name') {
                return name.includes(searchTerm);
            } else if (currentFilter === 'status') {
                return status.includes(searchTerm);
            }
            return true;
        });
    }

    function renderPagination() {
        const matched = getVisibleRows();
        const totalRows = matched.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / gsRowsPerPage));
        if (gsCurrentPage > totalPages) gsCurrentPage = totalPages;

        const startIdx = (gsCurrentPage - 1) * gsRowsPerPage;
        const endIdx = Math.min(startIdx + gsRowsPerPage, totalRows);

        // Hide all rows first, then show only matched rows in the current page range
        const allRows = tablesBody ? tablesBody.querySelectorAll('tr:not(.no-data-row)') : [];
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
            let startPage = Math.max(1, gsCurrentPage - Math.floor(maxVisible / 2));
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            if (endPage - startPage + 1 < maxVisible) startPage = Math.max(1, endPage - maxVisible + 1);

            for (let p = startPage; p <= endPage; p++) {
                const btn = document.createElement('button');
                btn.className = 'page-num' + (p === gsCurrentPage ? ' active' : '');
                btn.textContent = p;
                btn.addEventListener('click', () => { gsCurrentPage = p; renderPagination(); });
                pageNums.appendChild(btn);
            }
        }

        // Nav buttons
        const firstBtn = document.getElementById('gsFirstPage');
        const prevBtn = document.getElementById('gsPrevPage');
        const nextBtn = document.getElementById('gsNextPage');
        const lastBtn = document.getElementById('gsLastPage');
        if (firstBtn) firstBtn.disabled = gsCurrentPage <= 1;
        if (prevBtn) prevBtn.disabled = gsCurrentPage <= 1;
        if (nextBtn) nextBtn.disabled = gsCurrentPage >= totalPages;
        if (lastBtn) lastBtn.disabled = gsCurrentPage >= totalPages;
    }

    // Pagination nav button handlers
    document.getElementById('gsFirstPage')?.addEventListener('click', () => { gsCurrentPage = 1; renderPagination(); });
    document.getElementById('gsPrevPage')?.addEventListener('click', () => { gsCurrentPage = Math.max(1, gsCurrentPage - 1); renderPagination(); });
    document.getElementById('gsNextPage')?.addEventListener('click', () => { gsCurrentPage++; renderPagination(); });
    document.getElementById('gsLastPage')?.addEventListener('click', () => {
        const total = getVisibleRows().length;
        gsCurrentPage = Math.max(1, Math.ceil(total / gsRowsPerPage));
        renderPagination();
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
                gsRowsPerPage = parseInt(this.dataset.value);
                gsCurrentPage = 1;
                rowsDropdown.classList.remove('open');
                renderPagination();
            });
        });
        document.addEventListener('click', (e) => { if (!rowsDropdown.contains(e.target)) rowsDropdown.classList.remove('open'); });
    }

    function performSearch() {
        gsCurrentPage = 1;
        renderPagination();
    }

    if (searchInput) searchInput.addEventListener('input', performSearch);

    if (dropdownToggle && dropdownOptions && filterDropdown) {
        dropdownToggle.addEventListener('click', (e) => { e.stopPropagation(); filterDropdown.classList.toggle('open'); });

        dropdownOptions.querySelectorAll('.dropdown-option').forEach(option => {
            option.addEventListener('click', function() {
                dropdownOptions.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
                this.classList.add('selected');
                selectedText.textContent = this.textContent;
                currentFilter = this.dataset.value;
                filterDropdown.classList.remove('open');
                searchInput.placeholder = `Search by ${this.textContent}...`;
                performSearch();
            });
        });

        document.addEventListener('click', () => filterDropdown.classList.remove('open'));
    }

    updateActionButtons();
    updateFieldCount();
    renderPagination();
});
