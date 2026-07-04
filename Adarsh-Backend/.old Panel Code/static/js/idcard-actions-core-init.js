// ID Card Actions - Core Init Sub-module
// Contains: Sidebar, dropdowns, dynamic alignment, horizontal scroll, module init
// Split from: idcard-actions-core.js

(function() {
'use strict';

window.IDCardApp = window.IDCardApp || {};

// ==========================================
// SIDEBAR FUNCTIONALITY
// ==========================================

function initSidebar() {
    // Sidebar toggle is handled by Alpine.js layoutState() in alpine-state.js.
    // Only set the active sidebar link here  no toggle logic.
    const activeClientsLink = document.getElementById('activeClientsLink');
    const allClientsLink = document.getElementById('allClientsLink');
    if (activeClientsLink) activeClientsLink.classList.add('active');
    if (allClientsLink) allClientsLink.classList.remove('active');
}

// Expose globally
window.IDCardApp.initSidebar = initSidebar;

// ==========================================
// DROPDOWN FUNCTIONALITY
// ==========================================

function setupDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    
    const toggle = dropdown.querySelector('.dropdown-toggle');
    const options = dropdown.querySelectorAll('.dropdown-option');
    
    toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        // Close other dropdowns
        document.querySelectorAll('.custom-dropdown.open').forEach(d => {
            if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
    });
    
    options.forEach(option => {
        option.addEventListener('click', function() {
            options.forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            
            // Update toggle text if needed
            const selectedText = toggle.querySelector('span');
            if (selectedText) {
                selectedText.textContent = this.textContent;
            }
            
            dropdown.classList.remove('open');
        });
    });
}

function initDropdowns() {
    setupDropdown('filterDropdown');
    setupDropdown('rowsDropdown');
    setupDropdown('sortDropdown');
    // class/section/course/branch filter dropdowns are handled by initFilterHandlers()
    // in idcard-actions-search.js (with event delegation for dynamic options)
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', function(e) {
        // Don't close if clicking inside a dropdown
        if (e.target.closest('.custom-dropdown')) return;
        
        document.querySelectorAll('.custom-dropdown.open').forEach(d => {
            d.classList.remove('open');
        });
    });
}

// Expose globally
window.IDCardApp.setupDropdown = setupDropdown;
window.IDCardApp.initDropdowns = initDropdowns;

// ==========================================
// DYNAMIC TEXT ALIGNMENT
// ==========================================

function applyDynamicAlignment() {
    const table = document.querySelector('.idcard-table table');
    if (!table) return;
    
    const rows = table.querySelectorAll('tbody tr[data-card-id]');
    if (rows.length === 0) return;
    
    // Batch all writes in a single rAF to avoid interleaved read/write thrashing.
    // Column alignment is determined by CSS classes (get_td_width_class filter),
    // so we only need to clear stale inline overrides and center Sr No.
    requestAnimationFrame(function() {
        // Remove any stale inline textAlign so CSS classes take effect
        for (var i = 0; i < rows.length; i++) {
            var cells = rows[i].querySelectorAll('td.dynamic-field');
            for (var j = 0; j < cells.length; j++) {
                if (cells[j].style.textAlign) cells[j].style.textAlign = '';
            }
        }
        // Sr No column  center
        var srCells = document.querySelectorAll('.idcard-table td:nth-child(2)');
        for (var k = 0; k < srCells.length; k++) {
            srCells[k].style.textAlign = 'center';
        }
    });
}

// Expose on IDCardApp namespace
window.IDCardApp.applyDynamicAlignment = applyDynamicAlignment;

// ==========================================
// HORIZONTAL SCROLL WITH ALT + MOUSE WHEEL
// ==========================================

function initHorizontalScroll() {
    const tableContainer = document.querySelector('.idcard-table');
    if (tableContainer) {
        tableContainer.addEventListener('wheel', function(e) {
            // If Alt key is held, scroll horizontally
            if (e.altKey) {
                e.preventDefault();
                // Slow scroll speed - 25% for smoother scrolling
                this.scrollLeft += e.deltaY * 0.25;
            }
        }, { passive: false });
    }
}

// Expose globally
window.IDCardApp.initHorizontalScroll = initHorizontalScroll;

// ==========================================
// CORE MODULE INITIALIZATION
// ==========================================

function initCoreModule() {
    IDCardApp._cacheToolbarButtons();
    initSidebar();
    IDCardApp.initCheckboxes();
    initDropdowns();
    initHorizontalScroll();
    applyDynamicAlignment();
}

// Expose globally
window.IDCardApp.initCoreModule = initCoreModule;

})();
