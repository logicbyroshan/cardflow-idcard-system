// ID Card Actions - Edit UI Sub-module
// Contains: Cell editing UI (start/cancel), editable hints, image preview
// Split from: idcard-actions-edit.js

(function() {
'use strict';

window.IDCardApp = window.IDCardApp || {};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function getAdjacentCell(currentCell, direction) {
    const row = currentCell.closest('tr');
    // Only select text cells that are editable (excludes image-field, action, SR NO, dates)
    const allCells = Array.from(row.querySelectorAll('td.editable-cell[data-field]:not(.image-field)'));
    const currentIndex = allCells.indexOf(currentCell);
    
    if (direction === 'next') {
        // Try next cell in same row
        if (currentIndex + 1 < allCells.length) {
            return allCells[currentIndex + 1];
        }
        // Wrap to first editable cell of next row
        var nextRow = row.nextElementSibling;
        while (nextRow && nextRow.tagName === 'TR') {
            var nextCells = nextRow.querySelectorAll('td.editable-cell[data-field]:not(.image-field)');
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
            var prevCells = prevRow.querySelectorAll('td.editable-cell[data-field]:not(.image-field)');
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
    
    // Skip image fields and non-editable cells
    if (cell.classList.contains('image-field')) return;
    if (!cell.classList.contains('editable-cell')) return;
    var ft = (cell.getAttribute('data-field-type') || '').toLowerCase();
    if (ft === 'image') return;
    var fn = (cell.getAttribute('data-field') || '').toLowerCase();
    if (fn.includes('photo') || fn.includes('image') || fn.includes('picture')) return;
    
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
    // Ensure minimum editing width of ~20 chars (180px)
    const MIN_EDIT_WIDTH = 180;
    const effectiveWidth = Math.max(originalWidth, MIN_EDIT_WIDTH);

    // Lock cell dimensions to prevent column/row shrinking when content is replaced
    cell.style.minWidth = effectiveWidth + 'px';
    cell.style.minHeight = originalHeight + 'px';
    cell.style.width = effectiveWidth + 'px';
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
    
    // Handle blur - save on focus out (saveCellEdit is in edit-logic sub-module)
    editElement.addEventListener('blur', function() {
        const newVal = editElement.tagName === 'SELECT'
            ? editElement.options[editElement.selectedIndex].value
            : editElement.value;
        IDCardApp.saveCellEdit(cell, newVal, cardId, field);
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

// ==========================================
// EDITABLE CELL HINTS (CSS)
// ==========================================

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
// EXPORTS
// ==========================================

IDCardApp.startCellEdit = startCellEdit;
IDCardApp.cancelCellEdit = cancelCellEdit;
IDCardApp.getAdjacentCell = getAdjacentCell;
IDCardApp.addEditableHints = addEditableHints;
IDCardApp.openImagePreview = openImagePreview;
IDCardApp.initImageCellHandlers = initImageCellHandlers;

})();
