// Group Setting Page - API, Shared State & Constants
// Loaded first: initializes namespace, DOM refs, state, and API/data functions

document.addEventListener('DOMContentLoaded', function() {
    const GSP = window.GroupSettingPage = window.GroupSettingPage || {};

    // ==================== ELEMENTS ====================
    GSP.tablesBody = document.getElementById('tablesBody');
    GSP.addBtn = document.getElementById('addBtn');
    GSP.editBtn = document.getElementById('editBtn');
    GSP.viewBtn = document.getElementById('viewBtn');
    GSP.deleteBtn = document.getElementById('deleteBtn');
    GSP.toggleStatusBtn = document.getElementById('toggle-status-btn');
    GSP.addDrawer = document.getElementById('add-drawer');
    GSP.closeDrawerEl = document.getElementById('closeDrawer');
    GSP.cancelDrawer = document.getElementById('cancelDrawer');
    GSP.saveDrawer = document.getElementById('saveDrawer');
    GSP.drawerTitle = document.getElementById('drawerTitle');
    GSP.drawerIcon = document.getElementById('drawerIcon');
    GSP.tableNameInput = document.getElementById('tableName');
    GSP.fieldList = document.getElementById('field-list');
    GSP.fieldCountSpan = document.getElementById('fieldCount');
    GSP.noFieldsMessage = document.getElementById('no-fields-message');
    GSP.addFieldSection = document.querySelector('.add-field-section');
    GSP.newFieldName = document.getElementById('new-field-name');
    GSP.newFieldType = document.getElementById('new-field-type');
    GSP.newFieldMandatory = document.getElementById('new-field-mandatory');
    GSP.addFieldBtnEl = document.getElementById('add-field-btn');
    GSP.modalConfirm = document.getElementById('confirmStatusBtn');
    GSP.statusItemName = document.getElementById('statusItemName');
    GSP.statusNote = document.getElementById('statusNote');
    GSP.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    GSP.deleteStaffName = document.getElementById('deleteStaffName');
    GSP.toast = document.getElementById('toast');
    GSP.toastMessage = document.getElementById('toastMessage');
    GSP.searchInput = document.getElementById('searchInput');
    GSP.filterDropdown = document.getElementById('filterDropdown');
    GSP.dropdownToggle = document.getElementById('dropdownToggle');
    GSP.dropdownOptions = document.getElementById('dropdownOptions');
    GSP.selectedText = document.getElementById('selectedText');
    GSP.fieldTypeDropdown = document.getElementById('fieldTypeDropdown');
    GSP.fieldTypeToggle = document.getElementById('fieldTypeToggle');

    // ==================== STATE ====================
    GSP.selectedRow = null;
    GSP.selectedTableId = null;
    GSP.currentMode = 'add';
    GSP.currentFields = [];
    GSP.MAX_FIELDS = 20;
    GSP.groupId = typeof GROUP_ID !== 'undefined' ? GROUP_ID : null;
    GSP.currentFilter = 'all';
    GSP.gsCurrentPage = 1;
    GSP.gsRowsPerPage = 10;

    // ==================== CONSTANTS ====================
    GSP.fieldTypeOptions = [
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

    // Image types that have fixed names (not editable)
    GSP.imageFieldTypes = ['photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature'];

    // Map of image types to their fixed display names
    GSP.imageFieldNames = {
        'photo': 'Photo',
        'mother_photo': 'Mother Photo',
        'father_photo': 'Father Photo',
        'barcode': 'Barcode',
        'qr_code': 'QR Code',
        'signature': 'Signature'
    };

    // Types with auto-generated names (name input disabled)
    GSP.autoNameTypes = ['class_section', ...GSP.imageFieldTypes];

    // ==================== DATA LOGIC ====================

    // Auto-detect field type from name using fuzzy keyword matching.
    // Uses priority-ordered rules: longer/more-specific patterns matched first.
    // Avoids false positives (e.g. "Designation" will NOT match "Signature")
    // by requiring word-boundary matches for short keywords.
    GSP.detectFieldTypeFromName = function(name) {
        const n = name.toLowerCase().trim().replace(/[_\-]+/g, ' ');
        if (!n) return null;

        // Priority-ordered rules (most specific first)
        // Each rule: [patterns[], fieldType, mode]
        // mode: 'exact' = full string match, 'keyword' = word-boundary match, 'includes' = substring
        const rules = [
            // Mother photo — must match before generic 'photo'
            { type: 'mother_photo', exact: ['mother photo', "mother's photo", 'mother image', 'mother pic', 'mother photograph', 'mom photo', 'maa photo', 'm photo'],
              keywords: ['mother photo', 'mother image', 'mother pic'] },
            // Father photo — must match before generic 'photo'
            { type: 'father_photo', exact: ['father photo', "father's photo", 'father image', 'father pic', 'father photograph', 'dad photo', 'papa photo', 'f photo'],
              keywords: ['father photo', 'father image', 'father pic'] },
            // Signature — word-boundary to avoid "designation"
            { type: 'signature', exact: ['signature', 'sign', 'student signature', 'child signature', 'student sign'],
              keywords: ['signature'] },
            // QR Code
            { type: 'qr_code', exact: ['qr code', 'qrcode', 'qr', 'qr image'],
              keywords: ['qr code', 'qrcode'] },
            // Barcode
            { type: 'barcode', exact: ['barcode', 'bar code', 'bar image'],
              keywords: ['barcode', 'bar code'] },
            // Generic photo (after mother/father)
            { type: 'photo', exact: ['photo', 'photograph', 'student photo', 'student image', 'student pic', 'child photo', 'pic', 'image', 'student photograph', 'passport photo'],
              keywords: ['photo', 'photograph', 'student image', 'student pic'] },
            // Class
            { type: 'class', exact: ['class', 'std', 'standard', 'grade', 'cls'],
              keywords: [] },
            // Section
            { type: 'section', exact: ['section', 'sec', 'division', 'div'],
              keywords: [] },
            // Email
            { type: 'email', exact: ['email', 'e-mail', 'e mail', 'mail', 'email id', 'mail id', 'email address'],
              keywords: ['email', 'e mail'] },
        ];

        // Pass 1: exact match (highest confidence)
        for (const rule of rules) {
            if (rule.exact && rule.exact.indexOf(n) !== -1) return rule.type;
        }

        // Pass 2: word-boundary keyword match (fuzzy but safe)
        for (const rule of rules) {
            for (const kw of (rule.keywords || [])) {
                try {
                    const re = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
                    if (re.test(n)) return rule.type;
                } catch(e) {}
            }
        }

        return null;
    };

    GSP.getFieldTypeLabel = function(value) {
        const option = GSP.fieldTypeOptions.find(o => o.value === value);
        return option ? option.label : value;
    };

    // ==================== API FUNCTIONS ====================

    GSP.downloadTableFields = async function(tableId) {
        try {
            const data = await ApiClient.get(`/panel/api/table/${tableId}/`);

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
    };

    GSP.fetchTableData = async function(tableId) {
        try {
            const data = await ApiClient.get(`/panel/api/table/${tableId}/`);
            if (data.success) return data.table;
            showToast(data.message || 'Error fetching table data', 'error');
            return null;
        } catch (error) {
            showToast('Error fetching table data', 'error');
            return null;
        }
    };

    GSP.saveTable = async function() {
        const name = GSP.tableNameInput.value.trim();
        if (!name) {
            showToast('Please enter a table name!', 'error');
            GSP.tableNameInput.focus();
            return;
        }

        if (GSP.currentFields.length === 0) {
            showToast('Please add at least one field!', 'error');
            return;
        }

        // Prevent double-click
        if (GSP.saveDrawer) {
            GSP.saveDrawer.disabled = true;
            GSP.saveDrawer.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        }

        const payload = {
            name: name,
            fields: GSP.currentFields.map((f, idx) => ({ name: f.name, type: f.type, order: idx, mandatory: f.mandatory || false }))
        };

        try {
            let url = GSP.currentMode === 'add' ? `/panel/api/group/${GSP.groupId}/table/create/` : `/panel/api/table/${GSP.selectedTableId}/update/`;
            const data = await ApiClient.post(url, payload);

            if (data.success) {
                showToast(data.message || 'Table saved successfully!', 'success');
                GSP.closeDrawerModal();
                setTimeout(() => window.location.reload(), 500);
            } else {
                showToast(data.message || 'Error saving table', 'error');
                // Re-enable button on error
                if (GSP.saveDrawer) {
                    GSP.saveDrawer.disabled = false;
                    GSP.saveDrawer.innerHTML = GSP.currentMode === 'add'
                        ? '<i class="fa-solid fa-plus"></i> Create'
                        : '<i class="fa-solid fa-check"></i> Update';
                }
            }
        } catch (error) {
            showToast('Error saving table', 'error');
            // Re-enable button on error
            if (GSP.saveDrawer) {
                GSP.saveDrawer.disabled = false;
                GSP.saveDrawer.innerHTML = GSP.currentMode === 'add'
                    ? '<i class="fa-solid fa-plus"></i> Create'
                    : '<i class="fa-solid fa-check"></i> Update';
            }
        }
    };

    GSP.toggleStatus = async function() {
        if (!GSP.selectedTableId) return;

        // Prevent double-click
        if (GSP.modalConfirm) GSP.modalConfirm.disabled = true;

        try {
            const data = await ApiClient.post(`/panel/api/table/${GSP.selectedTableId}/toggle-status/`);

            if (data.success) {
                showToast(data.message || 'Status updated!', 'success');
                setTimeout(() => window.location.reload(), 500);
            } else {
                showToast(data.message || 'Error updating status', 'error');
                if (GSP.modalConfirm) GSP.modalConfirm.disabled = false;
            }
        } catch (error) {
            showToast('Error updating status', 'error');
            if (GSP.modalConfirm) GSP.modalConfirm.disabled = false;
        }
    };
});
