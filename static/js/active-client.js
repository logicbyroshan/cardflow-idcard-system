/**
 * Active Client JavaScript Module
 * Handles client selection, search/filter, and navigation to groups/settings
 */

(function() {
    'use strict';

    // ==================== STATE VARIABLES ====================
    let selectedClientId = null;
    let selectedFirstGroupId = null;
    let selectedRow = null;
    let currentFilter = 'all';
    let currentStatusFilter = new URLSearchParams(window.location.search).get('status') || '';

    // ==================== DOM ELEMENTS ====================
    const elements = {
        // Table
        tbody: document.getElementById('client-table-body'),
        
        // Action Buttons
        groupSettingBtn: document.getElementById('group-setting-btn'),
        idcardGroupBtn: document.getElementById('idcard-group-btn'),
        
        // Search & Filter
        searchInput: document.getElementById('search-input'),
        searchClear: document.getElementById('search-clear'),
        filterDropdown: document.getElementById('filter-dropdown'),
        dropdownToggle: document.getElementById('dropdown-toggle'),
        dropdownOptions: document.getElementById('dropdown-options'),
        selectedText: document.getElementById('selected-text'),
        
        // Empty State
        emptyState: document.getElementById('empty-state')
    };

    // ==================== ROW SELECTION ====================
    function selectRow(row) {
        if (!row || row.classList.contains('no-data-row')) return;
        
        // Remove previous selection
        document.querySelectorAll('#client-table-body tr.selected').forEach(r => {
            r.classList.remove('selected');
        });
        
        // Select new row
        row.classList.add('selected');
        selectedClientId = row.dataset.clientId;
        selectedFirstGroupId = row.dataset.firstGroupId || null;
        selectedRow = row;
        
        // Enable buttons
        updateActionButtons();

        // Bridge to Alpine reactive state
        if (typeof window.alpineUpdateSelection === 'function') {
            window.alpineUpdateSelection([selectedClientId]);
        }
    }

    function clearSelection() {
        document.querySelectorAll('#client-table-body tr.selected').forEach(r => {
            r.classList.remove('selected');
        });
        selectedClientId = null;
        selectedFirstGroupId = null;
        selectedRow = null;
        updateActionButtons();

        // Bridge to Alpine reactive state
        if (typeof window.alpineClearSelection === 'function') {
            window.alpineClearSelection();
        }
    }

    function updateActionButtons() {
        const hasSelection = selectedClientId !== null;
        if (elements.groupSettingBtn) elements.groupSettingBtn.disabled = !hasSelection;
        if (elements.idcardGroupBtn) elements.idcardGroupBtn.disabled = !hasSelection;
    }

    // ==================== SEARCH & FILTER ====================
    function performSearch() {
        const searchTerm = elements.searchInput?.value.toLowerCase().trim() || '';
        const rows = document.querySelectorAll('#client-table-body tr:not(.no-data-row)');
        let visibleCount = 0;
        
        // Column index mapping
        const filterColumnMap = {
            'all': null,
            'name': 0,
            'email': 1,
            'phone': 2
        };
        
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            let match = false;
            
            if (currentFilter === 'all' || !searchTerm) {
                // Search all columns
                const text = row.textContent.toLowerCase();
                match = searchTerm === '' || text.includes(searchTerm);
            } else {
                // Search specific column
                const columnIndex = filterColumnMap[currentFilter];
                if (columnIndex !== null && cells[columnIndex]) {
                    const cellText = cells[columnIndex].textContent.toLowerCase();
                    match = cellText.includes(searchTerm);
                }
            }
            
            row.style.display = match ? '' : 'none';
            if (match) visibleCount++;
        });
        
        // Update search clear button visibility
        if (elements.searchClear) {
            elements.searchClear.style.display = searchTerm ? 'flex' : 'none';
        }
        
        // Update empty state
        updateEmptyState(visibleCount === 0 && searchTerm !== '');
        
        // Update pagination info
        updateRowCount(visibleCount);
    }

    function updateEmptyState(showEmpty = false) {
        if (elements.emptyState) {
            elements.emptyState.style.display = showEmpty ? 'flex' : 'none';
        }
    }

    function updateRowCount(count) {
        const rowCountEl = document.getElementById('row-count');
        if (rowCountEl) {
            const total = document.querySelectorAll('#client-table-body tr:not(.no-data-row)').length;
            rowCountEl.textContent = `Showing ${count} of ${total}`;
        }
    }

    // ==================== FILTER DROPDOWN ====================
    function setupFilterDropdown() {
        if (!elements.dropdownToggle || !elements.dropdownOptions) return;
        
        elements.dropdownToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            elements.filterDropdown.classList.toggle('open');
        });
        
        elements.dropdownOptions.querySelectorAll('.dropdown-option').forEach(option => {
            option.addEventListener('click', function() {
                // Update selected state
                elements.dropdownOptions.querySelectorAll('.dropdown-option').forEach(o => {
                    o.classList.remove('selected');
                });
                this.classList.add('selected');
                
                // Update display text
                elements.selectedText.textContent = this.textContent;
                currentFilter = this.dataset.value;
                
                // Update placeholder
                if (elements.searchInput) {
                    const filterText = this.dataset.value === 'all' ? 'All' : this.textContent;
                    elements.searchInput.placeholder = `Search ${filterText}...`;
                }
                
                // Close dropdown
                elements.filterDropdown.classList.remove('open');

                // Bridge to Alpine reactive state
                if (typeof window.alpineUpdateFilter === 'function') window.alpineUpdateFilter(currentFilter);
                
                // Re-run search with new filter
                performSearch();
            });
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', function() {
            elements.filterDropdown?.classList.remove('open');
        });
    }

    // ==================== URL HIGHLIGHT ====================
    function highlightFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const highlightId = urlParams.get('highlight');
        
        if (highlightId) {
            const targetRow = document.querySelector(`tr[data-client-id="${highlightId}"]`);
            
            if (targetRow) {
                selectRow(targetRow);
                
                setTimeout(() => {
                    targetRow.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center' 
                    });
                }, 100);
                
                // Add highlight animation
                targetRow.classList.add('highlight');
                
                setTimeout(() => {
                    targetRow.classList.remove('highlight');
                    const newUrl = new URL(window.location);
                    newUrl.searchParams.delete('highlight');
                    window.history.replaceState({}, '', newUrl);
                }, 2000);
            }
        }
    }

    // ==================== EVENT LISTENERS ====================
    function setupEventListeners() {
        // Status filter tabs
        var statusTabs = document.getElementById('status-tabs');
        if (statusTabs) {
            statusTabs.querySelectorAll('.status-tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    // Update active state
                    statusTabs.querySelectorAll('.status-tab').forEach(function(t) { t.classList.remove('active'); });
                    this.classList.add('active');

                    currentStatusFilter = this.dataset.status || '';

                    // Build HTMX request URL and swap table container
                    var params = new URLSearchParams();
                    if (currentStatusFilter) params.set('status', currentStatusFilter);
                    var searchVal = elements.searchInput ? elements.searchInput.value.trim() : '';
                    if (searchVal) params.set('search', searchVal);
                    params.set('per_page', new URLSearchParams(window.location.search).get('per_page') || '25');
                    params.set('page', '1');

                    var url = window.location.pathname + '?' + params.toString();

                    // Update browser URL
                    window.history.replaceState({}, '', url);

                    // HTMX swap
                    var container = document.getElementById('active-client-table-container');
                    if (container && window.htmx) {
                        window.htmx.ajax('GET', url, {target: container, swap: 'innerHTML'});
                    }
                });
            });
        }

        // Table row selection — delegate from stable container to survive HTMX swaps
        var tableContainer = document.getElementById('active-client-table-container');
        if (tableContainer) {
            // Row click handler (delegated)
            tableContainer.addEventListener('click', function(e) {
                const row = e.target.closest('tr');
                if (row && !row.classList.contains('no-data-row')) {
                    selectRow(row);
                }
            });
            
            // Double-click to go to ID Card Groups (delegated)
            tableContainer.addEventListener('dblclick', function(e) {
                const row = e.target.closest('tr');
                if (row && row.dataset.clientId) {
                    window.location.href = `/panel/client/${row.dataset.clientId}/groups/`;
                }
            });
        }
        
        // Group Setting button
        if (elements.groupSettingBtn) {
            elements.groupSettingBtn.addEventListener('click', function() {
                if (selectedClientId) {
                    window.location.href = `/panel/client/${selectedClientId}/settings/`;
                }
            });
        }
        
        // ID Card Group button
        if (elements.idcardGroupBtn) {
            elements.idcardGroupBtn.addEventListener('click', function() {
                if (selectedClientId) {
                    window.location.href = `/panel/client/${selectedClientId}/groups/`;
                }
            });
        }
        
        // Search input
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', function() {
                performSearch();
                if (typeof window.alpineUpdateSearch === 'function') window.alpineUpdateSearch(elements.searchInput.value);
            });
        }
        
        // Search clear button
        if (elements.searchClear) {
            elements.searchClear.addEventListener('click', function() {
                elements.searchInput.value = '';
                performSearch();
                elements.searchInput.focus();
                if (typeof window.alpineUpdateSearch === 'function') window.alpineUpdateSearch('');
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            // Ctrl+F to focus search
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                elements.searchInput?.focus();
            }
            
            // Escape to clear search
            if (e.key === 'Escape') {
                if (elements.searchInput && elements.searchInput === document.activeElement) {
                    elements.searchInput.value = '';
                    performSearch();
                    elements.searchInput.blur();
                }
            }
            
            // Enter to go to groups when row is selected
            if (e.key === 'Enter' && selectedClientId) {
                // Don't navigate if user is typing in an input or the search overlay is open
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
                const searchOverlay = document.getElementById('globalSearchOverlay');
                if (searchOverlay && searchOverlay.classList.contains('active')) return;
                window.location.href = `/panel/client/${selectedClientId}/groups/`;
            }
        });
    }

    // ==================== INITIALIZATION ====================
    function init() {
        setupEventListeners();
        setupFilterDropdown();
        highlightFromUrl();
        
        // Initialize row count
        const totalRows = document.querySelectorAll('#client-table-body tr:not(.no-data-row)').length;
        updateRowCount(totalRows);
        
        // Hide search clear initially
        if (elements.searchClear) {
            elements.searchClear.style.display = 'none';
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
