// ID Card Actions - Inline Edit Module
// Contains: Inline cell editing functionality
// Note: Uses shared getCSRFToken from utils.js

(function() {
'use strict';

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function getAdjacentCell(currentCell, direction) {
    const row = currentCell.closest('tr');
    const allCells = Array.from(row.querySelectorAll('td[data-field]'));
    const currentIndex = allCells.indexOf(currentCell);
    
    if (direction === 'next') {
        // Try next cell in same row
        if (currentIndex + 1 < allCells.length) {
            return allCells[currentIndex + 1];
        }
        // Wrap to first editable cell of next row
        var nextRow = row.nextElementSibling;
        while (nextRow && nextRow.tagName === 'TR') {
            var nextCells = nextRow.querySelectorAll('td[data-field]');
            if (nextCells.length > 0) {
                // Scroll the next row into view so the user can see it
                nextRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return nextCells[0];
            }
            nextRow = nextRow.nextElementSibling;
        }
        return null;
    } else if (direction === 'prev') {
        // Try previous cell in same row
        if (currentIndex - 1 >= 0) {
            return allCells[currentIndex - 1];
        }
        // Wrap to last editable cell of previous row
        var prevRow = row.previousElementSibling;
        while (prevRow && prevRow.tagName === 'TR') {
            var prevCells = prevRow.querySelectorAll('td[data-field]');
            if (prevCells.length > 0) {
                prevRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return prevCells[prevCells.length - 1];
            }
            prevRow = prevRow.previousElementSibling;
        }
        return null;
    }
    return null;
}

// ==========================================
// INLINE CELL EDITING
// ==========================================

function startCellEdit(cell) {
    if (cell.querySelector('input, textarea, select')) return; // Already editing
    if (cell.classList.contains('editing')) return; // Already in edit mode
    
    // Mark cell as editing to prevent duplicate clicks (Phase 5)
    cell.classList.add('editing');
    
    const field = cell.getAttribute('data-field');
    const fieldType = cell.getAttribute('data-field-type') || '';
    const cardId = cell.closest('tr').getAttribute('data-card-id');
    // Read from .cell-value span if present, otherwise fallback to textContent
    const valueSpan = cell.querySelector('.cell-value');
    const currentValue = valueSpan ? valueSpan.textContent.trim() : cell.textContent.trim();
    const originalWidth = cell.offsetWidth;
    const originalHeight = cell.offsetHeight;

    // Lock cell dimensions to prevent column/row shrinking when content is replaced
    cell.style.minWidth = originalWidth + 'px';
    cell.style.minHeight = originalHeight + 'px';
    cell.style.width = originalWidth + 'px';
    cell.style.height = originalHeight + 'px';
    
    let editElement;
    
    // Detect multi-line based on actual cell rendering height (not char count)
    const computedStyle = getComputedStyle(cell);
    const cellLineHeight = parseFloat(computedStyle.lineHeight) || 18;
    const vertPad = parseFloat(computedStyle.paddingTop) + parseFloat(computedStyle.paddingBottom);
    const contentHeight = originalHeight - vertPad;
    const isMultiLine = contentHeight > (cellLineHeight * 1.5) || currentValue.includes('\n');
    
    // Store original value
    cell.setAttribute('data-original-value', currentValue);
    
    if (isMultiLine) {
        // Flex wrapper fills cell and vertically centers the textarea
        const wrapper = document.createElement('div');
        wrapper.className = 'inline-edit-wrapper';
        wrapper.style.cssText = `
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            display: flex;
            align-items: center;
            z-index: 5;
            background: white;
            border: 2px solid #007bff;
            box-shadow: inset 0 0 5px rgba(0, 123, 255, 0.3);
            padding: 2px;
        `;
        
        editElement = document.createElement('textarea');
        editElement.value = currentValue;
        editElement.className = 'inline-edit-textarea';
        editElement.style.cssText = `
            width: 100%;
            max-height: 100%;
            box-sizing: border-box;
            padding: 1px 4px;
            border: none !important;
            box-shadow: none !important;
            font-size: inherit;
            font-family: inherit;
            background: transparent;
            outline: none;
            text-transform: uppercase;
            text-align: left;
            resize: none;
            overflow-y: auto;
            white-space: pre-wrap;
            word-wrap: break-word;
            line-height: 1.3;
        `;
        
        cell.style.position = 'relative';
        cell.style.overflow = 'hidden';
        cell.innerHTML = '';
        wrapper.appendChild(editElement);
        cell.appendChild(wrapper);
        
        // Auto-size textarea height to fit content
        editElement.style.height = 'auto';
        editElement.style.height = editElement.scrollHeight + 'px';
        
        // Re-size on input so textarea grows/shrinks with content
        editElement.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
        });
        
        editElement.focus();
        var len = editElement.value.length;
        editElement.setSelectionRange(len, len);
    } else {
        editElement = document.createElement('input');
        editElement.type = 'text';
        editElement.value = currentValue;
        editElement.className = 'inline-edit-input';
        editElement.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            padding: 2px 6px;
            border: 2px solid #007bff;
            border-radius: 0;
            font-size: inherit;
            font-family: inherit;
            background: white;
            outline: none;
            box-shadow: inset 0 0 5px rgba(0, 123, 255, 0.3);
            text-transform: uppercase;
            text-align: left;
            display: block;
            margin: 0;
            z-index: 5;
        `;
        
        cell.style.position = 'relative';
        cell.style.overflow = 'hidden';
        cell.innerHTML = '';
        cell.appendChild(editElement);
        editElement.focus();
        var len = editElement.value.length;
        editElement.setSelectionRange(len, len);
    }
    
    // Handle blur - save on focus out
    editElement.addEventListener('blur', function() {
        const newVal = editElement.tagName === 'SELECT' ? editElement.value : editElement.value;
        saveCellEdit(cell, newVal, cardId, field);
    });
    
    // Handle keydown
    editElement.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            // Always save on Enter (no newline needed for inline cell edit)
            e.preventDefault();
            editElement.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelCellEdit(cell);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            editElement.blur();
            const adjacentCell = getAdjacentCell(cell, e.shiftKey ? 'prev' : 'next');
            if (adjacentCell) {
                startCellEdit(adjacentCell);
            }
        }
    });
}

function cancelCellEdit(cell) {
    const originalValue = cell.getAttribute('data-original-value') || '';
    const esc = window.escapeHtml || ((s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; });
    cell.innerHTML = `<span class="cell-value">${esc(originalValue)}</span>`;
    cell.style.position = '';
    cell.style.overflow = '';
    cell.style.padding = '';
    // Unlock cell dimensions
    cell.style.minWidth = '';
    cell.style.minHeight = '';
    cell.style.width = '';
    cell.style.height = '';
    cell.removeAttribute('data-original-value');
    cell.classList.remove('editing');
}

function saveCellEdit(cell, newValue, cardId, field) {
    const originalValue = cell.getAttribute('data-original-value') || '';
    
    // Check if this is an image field — image paths must NOT be uppercased
    const fieldType = (cell.getAttribute('data-field-type') || '').toLowerCase();
    const IMAGE_TYPES = ['photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature', 'image'];
    const isImageField = IMAGE_TYPES.includes(fieldType);
    
    // Convert to uppercase only for non-image text fields
    const finalValue = (typeof newValue === 'string' && !isImageField) ? newValue.toUpperCase() : newValue;
    
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
    ApiClient.post(`/panel/api/card/${cardId}/update-field/`, {
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
        
        startCellEdit(cell);
    });
}

// Add tooltip hint for editable cells
function addEditableHints() {
    const style = document.createElement('style');
    style.textContent = `
        td.editable-cell:hover,
        td[data-field]:not(.checkbox-column):not(.action-column):not(.image-field):hover {
            cursor: text;
            background-color: rgba(0, 123, 255, 0.05);
        }
        
        td.editable-cell,
        td[data-field]:not(.checkbox-column):not(.action-column):not(.image-field) {
            position: relative;
        }
        
        td.editable-cell::after,
        td[data-field]:not(.checkbox-column):not(.action-column):not(.image-field)::after {
            content: '';
            position: absolute;
            right: 2px;
            top: 2px;
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-top: 6px solid rgba(0, 123, 255, 0.3);
            opacity: 0;
            transition: opacity 0.2s;
        }
        
        td.editable-cell:hover::after,
        td[data-field]:not(.checkbox-column):not(.action-column):not(.image-field):hover::after {
            opacity: 1;
        }
        
        .inline-edit-input:focus {
            outline: none;
            border-color: #0056b3;
        }
        
        .saving-indicator {
            animation: pulse 1s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    `;
    document.head.appendChild(style);
}

// ==========================================
// IMAGE CELLS - CLICK TO VIEW
// ==========================================

function initImageCellHandlers() {
    document.querySelectorAll('.photo-thumbnail, .id-photo-cell img').forEach(img => {
        img.style.cursor = 'pointer';
        img.addEventListener('click', function(e) {
            e.stopPropagation();
            const fullSrc = this.src.replace('/thumbnails/', '/');
            openImagePreview(fullSrc);
        });
    });
}

function openImagePreview(src) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'image-preview-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        cursor: pointer;
    `;
    
    // Create image
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = `
        max-width: 90vw;
        max-height: 90vh;
        object-fit: contain;
        border-radius: 8px;
        box-shadow: 0 10px 50px rgba(0, 0, 0, 0.5);
    `;
    
    // Close hint
    const hint = document.createElement('div');
    hint.textContent = 'Click anywhere to close';
    hint.style.cssText = `
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        color: white;
        font-size: 14px;
        opacity: 0.7;
    `;
    
    overlay.appendChild(img);
    overlay.appendChild(hint);
    document.body.appendChild(overlay);
    
    // Close on click
    overlay.addEventListener('click', function() {
        document.body.removeChild(overlay);
    });
    
    // Close on escape
    document.addEventListener('keydown', function closeOnEscape(e) {
        if (e.key === 'Escape') {
            if (document.body.contains(overlay)) {
                document.body.removeChild(overlay);
            }
            document.removeEventListener('keydown', closeOnEscape);
        }
    });
}

// ==========================================
// INITIALIZATION
// ==========================================

function initEditModule() {
    makeTableCellsEditable();
    addEditableHints();
    initImageCellHandlers();
}

// Expose on IDCardApp namespace (window.saveInlineEdit kept for Alpine bridge)
window.IDCardApp = window.IDCardApp || {};
window.IDCardApp.startCellEdit = startCellEdit;
window.IDCardApp.cancelCellEdit = cancelCellEdit;
window.IDCardApp.saveCellEdit = saveCellEdit;
window.IDCardApp.openImagePreview = openImagePreview;

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

        var data = await ApiClient.post('/panel/api/card/' + cardId + '/update-field/', {
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

window.IDCardApp.initEditModule = initEditModule;
window.IDCardApp.saveInlineEdit = window.saveInlineEdit;

})();
