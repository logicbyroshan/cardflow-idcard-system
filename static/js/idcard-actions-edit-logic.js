// ID Card Actions - Edit Logic Sub-module
// Contains: Save cell edit, make cells editable, Alpine bridge, init
// Split from: idcard-actions-edit.js

(function() {
'use strict';

window.IDCardApp = window.IDCardApp || {};

// ==========================================
// SAVE CELL EDIT
// ==========================================

function saveCellEdit(cell, newValue, cardId, field) {
    const originalValue = cell.getAttribute('data-original-value') || '';
    
    // Check if this is an image field — image paths must NOT be uppercased
    const fieldType = (cell.getAttribute('data-field-type') || '').toLowerCase();
    const IMAGE_TYPES = ['photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature', 'image'];
    const isImageField = IMAGE_TYPES.includes(fieldType);
    
    // Convert to uppercase only for non-image text fields
    const finalValue = (typeof newValue === 'string' && !isImageField) ? newValue.toUpperCase() : newValue;
    
    // ── Basic field validation via FieldClassifier ──
    if (window.FieldClassifier && typeof newValue === 'string' && !isImageField) {
        var vResult = window.FieldClassifier.validate(field, fieldType, finalValue);
        if (!vResult.valid) {
            // Show error, restore cell
            if (typeof showToast === 'function') showToast(vResult.message, 'error');
            cell.style.backgroundColor = '#f8d7da';
            setTimeout(function() { cell.style.backgroundColor = ''; }, 2000);
            const esc = window.escapeHtml || ((s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; });
            cell.innerHTML = `<span class="cell-value">${esc(originalValue)}</span>`;
            cell.style.position = '';
            cell.style.overflow = '';
            cell.style.padding = '';
            cell.style.minWidth = '';
            cell.style.minHeight = '';
            cell.style.width = '';
            cell.style.height = '';
            cell.removeAttribute('data-original-value');
            cell.classList.remove('editing');
            return;
        }
    }
    
    // If no change, just restore
    if (finalValue === originalValue) {
        const esc = window.escapeHtml || ((s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; });
        cell.innerHTML = `<span class="cell-value">${esc(originalValue)}</span>`;
        cell.style.position = '';
        cell.style.overflow = '';
        cell.style.padding = '';
        cell.style.minWidth = '';
        cell.style.minHeight = '';
        cell.style.width = '';
        cell.style.height = '';
        cell.removeAttribute('data-original-value');
        cell.classList.remove('editing');
        return;
    }
    
    // Show loading state
    cell.innerHTML = '<span class="saving-indicator">Saving...</span>';
    cell.querySelector('.saving-indicator').style.cssText = `
        color: #666;
        font-style: italic;
    `;
    
    // Save via API
    ApiClient.post(`/api/card/${cardId}/update-field/`, {
        field: field,
        value: finalValue
    })
    .then(data => {
        const esc = window.escapeHtml || ((s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; });
        cell.innerHTML = `<span class="cell-value">${esc(finalValue)}</span>`;
        cell.style.position = '';
        cell.style.overflow = '';
        cell.style.padding = '';
        cell.style.minWidth = '';
        cell.style.minHeight = '';
        cell.style.width = '';
        cell.style.height = '';
        cell.classList.remove('editing');
        // Update data-original-value so next edit reads the new value
        cell.setAttribute('data-original-value', finalValue);
        
        // Show success feedback
        cell.style.backgroundColor = '#d4edda';
        setTimeout(() => {
            cell.style.backgroundColor = '';
        }, 1000);
        
        if (typeof showToast === 'function') {
            showToast('Field updated successfully', 'success');
        }
        
        // Re-apply filters so edited row hides/shows correctly
        // e.g. if user changes section from A→C while filter is "A", row disappears
        if (typeof IDCardApp.applyFiltersAndSort === 'function') {
            IDCardApp.applyFiltersAndSort();
        } else if (typeof applyFiltersAndSort === 'function') {
            applyFiltersAndSort();
        }
        
        // Refresh filter dropdown options in case new values were introduced
        if (typeof IDCardApp.populateFilterOptions === 'function') {
            IDCardApp.populateFilterOptions();
        } else if (typeof populateFilterOptions === 'function') {
            populateFilterOptions();
        }
    })
    .catch(error => {
        console.error('Error updating field:', error);
        const esc = window.escapeHtml || ((s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; });
        cell.innerHTML = `<span class="cell-value">${esc(originalValue)}</span>`;
        cell.style.position = '';
        cell.style.overflow = '';
        cell.style.padding = '';
        cell.style.minWidth = '';
        cell.style.minHeight = '';
        cell.style.width = '';
        cell.style.height = '';
        cell.classList.remove('editing');
        cell.removeAttribute('data-original-value');
        
        // Show error feedback
        cell.style.backgroundColor = '#f8d7da';
        setTimeout(() => {
            cell.style.backgroundColor = '';
        }, 2000);
        
        if (typeof showToast === 'function') {
            showToast('Failed to update field', 'error');
        }
    });
}

// ==========================================
// EDITABLE CELLS INITIALIZATION
// ==========================================

function makeTableCellsEditable() {
    const table = document.getElementById('data-table');
    if (!table) return;
    
    // Single click to edit for faster editing
    table.addEventListener('click', function(e) {
        const cell = e.target.closest('td[data-field]');
        if (!cell) return;
        
        // Check if cell is editable
        const field = cell.getAttribute('data-field');
        if (!field) return;
        
        // Don't edit checkbox or action columns
        if (cell.classList.contains('checkbox-column') || 
            cell.classList.contains('action-column') ||
            cell.querySelector('input[type="checkbox"]')) {
            return;
        }
        
        // Don't edit image fields via inline edit
        const ft = (cell.getAttribute('data-field-type') || '').toLowerCase();
        if (ft === 'image' ||
            field.toLowerCase().includes('photo') || 
            field.toLowerCase().includes('image') ||
            field.toLowerCase().includes('picture')) {
            return;
        }
        
        // Prevent re-triggering if already editing
        if (cell.classList.contains('editing')) {
            return;
        }
        
        // startCellEdit is in edit-ui sub-module
        IDCardApp.startCellEdit(cell);
    });
}

// ==========================================
// ALPINE BRIDGE
// ==========================================

/**
 * Alpine inlineEditState() bridge.
 * Called by the Alpine component's saveEdit() method.
 * Uses the same API endpoint as the vanilla JS production code.
 *
 * @param {string|number} cardId
 * @param {string} fieldName
 * @param {string} value
 * @returns {Promise<boolean>} true on success
 */
window.saveInlineEdit = async function (cardId, fieldName, value) {
    try {
        // Uppercase non-image text fields (same logic as saveCellEdit)
        var IMAGE_TYPES = ['photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature', 'image'];
        var finalValue = (!IMAGE_TYPES.includes(fieldName) && typeof value === 'string') ? value.toUpperCase() : value;

        var data = await ApiClient.post('/api/card/' + cardId + '/update-field/', {
            field: fieldName,
            value: finalValue
        });

        if (typeof showToast === 'function') showToast('Field updated', 'success');
        return true;
    } catch (err) {
        console.error('saveInlineEdit error:', err);
        if (typeof showToast === 'function') showToast('Failed to save', 'error');
        return false;
    }
};

// ==========================================
// INITIALIZATION
// ==========================================

function initEditModule() {
    makeTableCellsEditable();
    IDCardApp.addEditableHints();
    IDCardApp.initImageCellHandlers();
}

// ==========================================
// EXPORTS
// ==========================================

IDCardApp.saveCellEdit = saveCellEdit;
IDCardApp.makeTableCellsEditable = makeTableCellsEditable;
IDCardApp.initEditModule = initEditModule;
IDCardApp.saveInlineEdit = window.saveInlineEdit;

})();
