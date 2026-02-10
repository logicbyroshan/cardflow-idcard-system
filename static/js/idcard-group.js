/**
 * ID Card Group Page JavaScript
 * 
 * Handles table management for ID card groups.
 * Note: Sidebar and DateTime are now handled by common/sidebar.js
 * 
 * @module idcard-group
 * @version 2.0.0
 */

(function() {
    'use strict';

    // Set active sidebar link - only if common/sidebar.js hasn't run
    if (!window.AdarshSidebar) {
        const allClientsLink = document.getElementById('allClientsLink');
        const activeClientsLink = document.getElementById('activeClientsLink');
        
        if (activeClientsLink) activeClientsLink.classList.add('active');
        if (allClientsLink) allClientsLink.classList.remove('active');
    } else {
        // Use the sidebar module
        window.AdarshSidebar.setActiveLink('activeClientsLink');
    }

    // Get client name and ID card title from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const clientName = urlParams.get('client');
    const idCardTitle = urlParams.get('idcard');

    if (clientName) {
        const clientNameEl = document.getElementById('clientName');
        if (clientNameEl) clientNameEl.textContent = clientName;
    }

    if (idCardTitle) {
        const idCardTitleEl = document.getElementById('idCardTitle');
        if (idCardTitleEl) idCardTitleEl.textContent = idCardTitle;
    }

    // Table row selection
    const tableRows = document.querySelectorAll("tbody tr");
    let selectedRow = null;

    tableRows.forEach(row => {
        row.addEventListener("click", function(e) {
            // Don't select row if clicking on a button
            if (e.target.closest('.list-btn') || e.target.closest('.bulk-btn')) {
                return;
            }
            if (this.classList.contains("selected")) {
                this.classList.remove("selected");
                selectedRow = null;
            } else {
                if (selectedRow) {
                    selectedRow.classList.remove("selected");
                }
                this.classList.add("selected");
                selectedRow = this;
            }
        });

        // Make cells editable on double click (except action/bulk columns)
        row.querySelectorAll('td:not(.action-cell):not(.bulk-action-cell)').forEach(cell => {
            cell.addEventListener('dblclick', function(e) {
                if (cell.querySelector('input')) return;
                const oldValue = cell.textContent.trim();
                const input = document.createElement('input');
                input.type = 'text';
                input.value = oldValue;
                input.style.cssText = 'font-size:12px;border:1px solid #bbb;padding:2px 4px;width:90%;box-sizing:border-box;background:#fff;border-radius:3px;outline:none;';
                input.addEventListener('blur', finishEdit);
                input.addEventListener('keydown', function(ev) {
                    if (ev.key === 'Enter') {
                        input.blur();
                    } else if (ev.key === 'Escape') {
                        input.value = oldValue;
                        input.blur();
                    }
                });
                cell.textContent = '';
                cell.appendChild(input);
                input.focus();
                input.select();

                function finishEdit() {
                    cell.textContent = input.value.trim();
                }
            });
        });
    });

    // List button click handlers - Navigate to ID Card Actions page
    document.querySelectorAll('.list-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const row = this.closest('tr');
            const groupName = row.querySelector('td:first-child').textContent;
            
            // Determine action type from button class
            let actionType = 'pending';
            if (this.classList.contains('pending-btn')) actionType = 'pending';
            else if (this.classList.contains('verified-btn')) actionType = 'verified';
            else if (this.classList.contains('pool-btn')) actionType = 'pool';
            else if (this.classList.contains('approved-btn')) actionType = 'approved';
            else if (this.classList.contains('download-btn')) actionType = 'download';
            
            // Navigate via Django URL if data-url is set, otherwise fallback
            const url = this.dataset.url;
            if (url) {
                window.location.href = url;
            } else {
                // Fallback alert
                if (typeof showToast === 'function') {
                    showToast(`Navigating to ${actionType} for ${groupName}`, 'info');
                }
            }
        });
    });

    // Bulk action button click handlers
    document.querySelectorAll('.bulk-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const row = this.closest('tr');
            const name = row.querySelector('td:first-child').textContent;
            const action = this.textContent.trim();
            
            // Add your bulk action logic here
        });
    });

    // Function to update count badges dynamically
    window.updateCountBadge = function(row, buttonClass, newCount) {
        const badge = row.querySelector(`.${buttonClass} .count-badge`);
        if (badge) {
            badge.textContent = newCount;
        }
    };

})();
