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
    if (!currentCell) {
        var table = document.getElementById('data-table');
        if (!table) return null;
        return table.querySelector('tbody tr[data-card-id] td.editable-cell[data-field]:not(.image-field)');
    }

    const row = currentCell.closest('tr');
    if (!row) return null;

    const fieldName = currentCell.getAttribute('data-field');
    const allRowCells = Array.from(row.querySelectorAll('td.editable-cell[data-field]:not(.image-field)'));
    const currentIndex = allRowCells.indexOf(currentCell);

    // 1. Move Right / Forward (Tab or Right Arrow)
    if (direction === 'next' || direction === 'right') {
        if (currentIndex !== -1 && currentIndex + 1 < allRowCells.length) {
            return allRowCells[currentIndex + 1];
        }
        // Wrap to first editable cell of next row
        var nextRow = row.nextElementSibling;
        while (nextRow && nextRow.tagName === 'TR' && nextRow.getAttribute('data-card-id')) {
            var nextCells = nextRow.querySelectorAll('td.editable-cell[data-field]:not(.image-field)');
            if (nextCells.length > 0) {
                nextRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return nextCells[0];
            }
            nextRow = nextRow.nextElementSibling;
        }
        return null;
    } 
    
    // 2. Move Left / Backward (Shift + Tab or Left Arrow)
    if (direction === 'prev' || direction === 'left') {
        if (currentIndex !== -1 && currentIndex - 1 >= 0) {
            return allRowCells[currentIndex - 1];
        }
        // Wrap to last editable cell of previous row
        var prevRow = row.previousElementSibling;
        while (prevRow && prevRow.tagName === 'TR' && prevRow.getAttribute('data-card-id')) {
            var prevCells = prevRow.querySelectorAll('td.editable-cell[data-field]:not(.image-field)');
            if (prevCells.length > 0) {
                prevRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return prevCells[prevCells.length - 1];
            }
            prevRow = prevRow.previousElementSibling;
        }
        return null;
    }

    // 3. Move Down Column (Ctrl + Tab or Down Arrow)
    if (direction === 'down') {
        var targetRow = row.nextElementSibling;
        while (targetRow && targetRow.tagName === 'TR' && targetRow.getAttribute('data-card-id')) {
            if (fieldName) {
                var sameFieldCell = targetRow.querySelector(`td.editable-cell[data-field="${CSS.escape(fieldName)}"]`);
                if (sameFieldCell) {
                    targetRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    return sameFieldCell;
                }
            }
            var targetCells = targetRow.querySelectorAll('td.editable-cell[data-field]:not(.image-field)');
            if (targetCells.length > 0) {
                var idx = Math.min(currentIndex !== -1 ? currentIndex : 0, targetCells.length - 1);
                targetRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return targetCells[idx];
            }
            targetRow = targetRow.nextElementSibling;
        }
        return null;
    }

    // 4. Move Up Column (Alt + Tab or Up Arrow)
    if (direction === 'up') {
        var targetRowPrev = row.previousElementSibling;
        while (targetRowPrev && targetRowPrev.tagName === 'TR' && targetRowPrev.getAttribute('data-card-id')) {
            if (fieldName) {
                var sameFieldCellPrev = targetRowPrev.querySelector(`td.editable-cell[data-field="${CSS.escape(fieldName)}"]`);
                if (sameFieldCellPrev) {
                    targetRowPrev.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    return sameFieldCellPrev;
                }
            }
            var targetCellsPrev = targetRowPrev.querySelectorAll('td.editable-cell[data-field]:not(.image-field)');
            if (targetCellsPrev.length > 0) {
                var idxPrev = Math.min(currentIndex !== -1 ? currentIndex : 0, targetCellsPrev.length - 1);
                targetRowPrev.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return targetCellsPrev[idxPrev];
            }
            targetRowPrev = targetRowPrev.previousElementSibling;
        }
        return null;
    }

    return null;
}

// ==========================================
// INLINE CELL EDITING
// ==========================================

function startCellEdit(cell) {
    if (!cell) return;
    if (cell.querySelector('input, textarea, select')) return; // Already editing
    if (cell.classList.contains('editing')) return; // Already in edit mode
    
    // Skip image fields and non-editable cells
    if (cell.classList.contains('image-field')) return;
    if (!cell.classList.contains('editable-cell')) return;
    var ft = (cell.getAttribute('data-field-type') || '').toLowerCase();
    if (ft === 'image') return;
    var fn = (cell.getAttribute('data-field') || '').toLowerCase();
    if ((fn.includes('photo') || fn.includes('image') || fn.includes('picture')) && !fn.endsWith('path')) return;
    
    // Track last active cell for table-wide keyboard navigation
    window.IDCardApp._lastActiveCell = cell;

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
        
        editElement.setAttribute('autocorrect', 'off');
        editElement.setAttribute('autocapitalize', 'characters');
        editElement.setAttribute('spellcheck', 'false');
        
        cell.style.position = 'relative';
        cell.style.overflow = 'hidden';
        cell.innerHTML = '';
        wrapper.appendChild(editElement);
        cell.appendChild(wrapper);
        
        // Auto-size textarea height to fit content
        editElement.style.height = 'auto';
        editElement.style.height = editElement.scrollHeight + 'px';
        
        // Re-size and force uppercase live on input
        editElement.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
            var start = this.selectionStart;
            var end = this.selectionEnd;
            this.value = this.value.toUpperCase();
            if (start !== null && end !== null) {
                this.setSelectionRange(start, end);
            }
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
        
        editElement.setAttribute('autocorrect', 'off');
        editElement.setAttribute('autocapitalize', 'characters');
        editElement.setAttribute('spellcheck', 'false');
        
        editElement.addEventListener('input', function() {
            var start = this.selectionStart;
            var end = this.selectionEnd;
            this.value = this.value.toUpperCase();
            if (start !== null && end !== null) {
                this.setSelectionRange(start, end);
            }
        });
        
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
    
    // Handle keydown navigation
    editElement.addEventListener('keydown', function(e) {
        const isClient = (typeof IS_CLIENT_USER !== 'undefined' && IS_CLIENT_USER) || (window.IDCardApp && window.IDCardApp.isClientUser === true);

        if (e.key === 'Enter') {
            // Always save on Enter (no newline needed for inline cell edit)
            e.preventDefault();
            editElement.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelCellEdit(cell);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            editElement.blur();

            var dir = 'right';
            if (e.ctrlKey) {
                if (isClient) return; // Ctrl+Tab (column down) is ADMIN/OPERATOR ONLY
                dir = 'down';
            } else if (e.altKey) {
                if (isClient) return; // Alt+Tab (column up) is ADMIN/OPERATOR ONLY
                dir = 'up';
            } else if (e.shiftKey) {
                dir = 'left'; // Shift+Tab (row prev) allowed for ALL
            } else {
                dir = 'right'; // Tab (row next) allowed for ALL
            }

            const nextCell = getAdjacentCell(cell, dir);
            if (nextCell) {
                setTimeout(function() { startCellEdit(nextCell); }, 50);
            }
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            // Arrow key cell navigation is ADMIN/OPERATOR ONLY
            if (isClient) return;

            if (e.key === 'ArrowRight') {
                var isAtEnd = (editElement.selectionEnd === editElement.value.length);
                if (isAtEnd || e.ctrlKey || e.altKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    editElement.blur();
                    const nextCell = getAdjacentCell(cell, 'right');
                    if (nextCell) setTimeout(function() { startCellEdit(nextCell); }, 50);
                }
            } else if (e.key === 'ArrowLeft') {
                var isAtStart = (editElement.selectionStart === 0);
                if (isAtStart || e.ctrlKey || e.altKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    editElement.blur();
                    const prevCell = getAdjacentCell(cell, 'left');
                    if (prevCell) setTimeout(function() { startCellEdit(prevCell); }, 50);
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                editElement.blur();
                const downCell = getAdjacentCell(cell, 'down');
                if (downCell) setTimeout(function() { startCellEdit(downCell); }, 50);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                editElement.blur();
                const upCell = getAdjacentCell(cell, 'up');
                if (upCell) setTimeout(function() { startCellEdit(upCell); }, 50);
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
// GLOBAL TABLE KEYBOARD NAVIGATION
// ==========================================

document.addEventListener('keydown', function(e) {
    // If user is inside an input, textarea or select, keydown on that element handles it
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
        return;
    }

    const table = document.getElementById('data-table');
    if (!table) return;

    // Skip if modal, side drawer or photo cropper is open
    const modal = document.getElementById('sideModalOverlay');
    if (modal && modal.classList.contains('active')) return;

    const isClient = (typeof IS_CLIENT_USER !== 'undefined' && IS_CLIENT_USER) || (window.IDCardApp && window.IDCardApp.isClientUser === true);

    let targetDir = null;
    if (e.key === 'Tab') {
        if (e.ctrlKey) {
            if (isClient) return; // Blocked for client
            targetDir = 'down';
        } else if (e.altKey) {
            if (isClient) return; // Blocked for client
            targetDir = 'up';
        } else if (e.shiftKey) {
            targetDir = 'left'; // Allowed for client
        } else {
            targetDir = 'right'; // Allowed for client
        }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Arrow keys are ADMIN / OPERATOR ONLY
        if (isClient) return;

        if (e.key === 'ArrowRight') targetDir = 'right';
        else if (e.key === 'ArrowLeft') targetDir = 'left';
        else if (e.key === 'ArrowDown') targetDir = 'down';
        else if (e.key === 'ArrowUp') targetDir = 'up';
    }

    if (targetDir) {
        e.preventDefault();
        e.stopPropagation();

        let activeCell = window.IDCardApp._lastActiveCell;
        if (!activeCell || !document.body.contains(activeCell)) {
            activeCell = table.querySelector('tbody tr[data-card-id] td.editable-cell[data-field]:not(.image-field)');
        }

        if (activeCell) {
            const nextCell = getAdjacentCell(activeCell, targetDir);
            const target = nextCell || activeCell;
            if (target) {
                startCellEdit(target);
            }
        }
    }
});

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
