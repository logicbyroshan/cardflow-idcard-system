// Manage Staff Page  Search: filter, search, pagination, initialization, auto-open from URL
// Split from manage-staff-events.js  loaded fifth (after handlers)

document.addEventListener('DOMContentLoaded', function() {
    var NS = window.ManageStaffPage;

    // ==================== FILTER & SEARCH ====================
    var dropdownToggle = document.getElementById('statusToggle');
    var dropdownOptions = document.getElementById('statusOptions');
    var filterDropdown = document.getElementById('status-dropdown');
    var selectedText = document.getElementById('statusSelectedText');
    var searchInput = document.getElementById('searchInput');

    var currentFilter = '';

    function performSearch() {
        var searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
        var rows = document.querySelectorAll('.data-table tbody tr');

        rows.forEach(function(row) {
            if (row.classList.contains('no-data-row')) return;

            var cells = row.querySelectorAll('td');
            var matchSearch = false;
            var matchStatus = true;

            // Check status filter first
            if (currentFilter === 'active' || currentFilter === 'inactive') {
                var rowStatus = row.dataset.staffStatus;
                matchStatus = rowStatus === currentFilter;
            }

            // Then check search term
            if (!searchTerm) {
                matchSearch = true;
            } else {
                cells.forEach(function(cell) {
                    if (cell.textContent.toLowerCase().includes(searchTerm)) {
                        matchSearch = true;
                    }
                });
            }

            row.style.display = (matchSearch && matchStatus) ? '' : 'none';
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', function() {
            performSearch();
            // Bridge to Alpine reactive state
            if (typeof window.alpineUpdateSearch === 'function') {
                window.alpineUpdateSearch(searchInput.value);
            }
        });
    }

    if (dropdownToggle && dropdownOptions && filterDropdown) {
        dropdownToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            filterDropdown.classList.toggle('open');
        });

        dropdownOptions.querySelectorAll('.dropdown-option').forEach(function(option) {
            option.addEventListener('click', function() {
                dropdownOptions.querySelectorAll('.dropdown-option').forEach(function(opt) {
                    opt.classList.remove('selected');
                });
                this.classList.add('selected');

                var value = this.dataset.value;
                var text = this.textContent;

                selectedText.textContent = text;
                currentFilter = value;

                if (searchInput) {
                    searchInput.placeholder = value === '' ? 'Search All...' : 'Search ' + text + '...';
                }

                filterDropdown.classList.remove('open');

                // Bridge to Alpine reactive state
                if (typeof window.alpineUpdateFilter === 'function') {
                    window.alpineUpdateFilter(value);
                }

                // Will be overridden by performSearchWithPagination later
                performSearch();
            });
        });

        document.addEventListener('click', function() {
            filterDropdown.classList.remove('open');
        });
    }

    // ==================== AUTO-OPEN DRAWER FROM URL ====================
    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('add') === '1') {
        NS.openDrawer('add');
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // ==================== PAGINATION ====================
    var rowCountEl = document.getElementById('row-count');
    var pageNumbersEl = document.getElementById('page-numbers');
    var firstPageBtn = document.getElementById('firstPage');
    var prevPageBtn = document.getElementById('prevPage');
    var nextPageBtn = document.getElementById('nextPage');
    var lastPageBtn = document.getElementById('lastPage');
    var rowsDropdown = document.getElementById('rowsDropdown');
    var rowsToggle = document.getElementById('rowsToggle');
    var rowsOptions = document.getElementById('rowsOptions');
    var rowsSelectedText = document.getElementById('rowsSelectedText');

    var currentPage = 1;
    var rowsPerPage = parseInt((rowsSelectedText && rowsSelectedText.textContent) || '25', 10);
    if (!rowsPerPage || rowsPerPage < 1) rowsPerPage = 25;
    var allRows = [];
    var filteredRows = [];
    var tbody = document.getElementById('staff-table-body');

    function initPagination() {
        if (!tbody) return;

        // Get all data rows (exclude no-data row)
        allRows = Array.from(tbody.querySelectorAll('tr:not(.no-data-row)'));
        filteredRows = allRows.slice();

        updatePagination();
    }

    function updatePagination() {
        // Filter rows based on search and filter criteria
        filteredRows = allRows.filter(function(row) { return row.style.display !== 'none'; });

        var totalRows = filteredRows.length;
        var totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));

        // Ensure current page is valid
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        var startIndex = (currentPage - 1) * rowsPerPage;
        var endIndex = Math.min(startIndex + rowsPerPage, totalRows);

        // Hide all rows first, then show only current page
        allRows.forEach(function(row) {
            row.style.display = 'none';
        });

        filteredRows.slice(startIndex, endIndex).forEach(function(row) {
            row.style.display = '';
        });

        // Update row count text
        if (rowCountEl) {
            if (totalRows === 0) {
                rowCountEl.innerHTML = 'Showing <strong>0</strong> results';
            } else {
                rowCountEl.innerHTML = 'Showing <strong>' + (startIndex + 1) + '-' + endIndex + '</strong> of <strong>' + totalRows + '</strong> results';
            }
        }

        // Update page numbers
        if (pageNumbersEl) {
            pageNumbersEl.innerHTML = '';
            var maxVisiblePages = 5;
            var startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
            var endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

            if (endPage - startPage < maxVisiblePages - 1) {
                startPage = Math.max(1, endPage - maxVisiblePages + 1);
            }

            for (var i = startPage; i <= endPage; i++) {
                (function(pageNum) {
                    var pageBtn = document.createElement('button');
                    pageBtn.className = 'page-num' + (pageNum === currentPage ? ' active' : '');
                    pageBtn.textContent = pageNum;
                    pageBtn.addEventListener('click', function() { goToPage(pageNum); });
                    pageNumbersEl.appendChild(pageBtn);
                })(i);
            }
        }

        // Update button states
        if (firstPageBtn) firstPageBtn.disabled = currentPage === 1;
        if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;
        if (nextPageBtn) nextPageBtn.disabled = currentPage === totalPages;
        if (lastPageBtn) lastPageBtn.disabled = currentPage === totalPages;
    }

    function goToPage(page) {
        currentPage = page;
        NS.clearStaffSelection();
        updatePagination();
    }

    // Pagination button events
    if (firstPageBtn) firstPageBtn.addEventListener('click', function() { goToPage(1); });
    if (prevPageBtn) prevPageBtn.addEventListener('click', function() { goToPage(currentPage - 1); });
    if (nextPageBtn) nextPageBtn.addEventListener('click', function() { goToPage(currentPage + 1); });
    if (lastPageBtn) {
        lastPageBtn.addEventListener('click', function() {
            var totalPages = Math.ceil(filteredRows.length / rowsPerPage);
            goToPage(totalPages);
        });
    }

    // Rows per page dropdown
    if (rowsDropdown && rowsToggle && rowsOptions) {
        rowsToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            rowsDropdown.classList.toggle('open');
        });

        rowsOptions.querySelectorAll('.dropdown-option').forEach(function(option) {
            option.addEventListener('click', function() {
                rowsOptions.querySelectorAll('.dropdown-option').forEach(function(opt) {
                    opt.classList.remove('selected');
                });
                this.classList.add('selected');

                rowsPerPage = parseInt(this.dataset.value);
                if (rowsSelectedText) rowsSelectedText.textContent = rowsPerPage;

                currentPage = 1;
                rowsDropdown.classList.remove('open');
                updatePagination();
            });
        });

        document.addEventListener('click', function(e) {
            if (!rowsDropdown.contains(e.target)) {
                rowsDropdown.classList.remove('open');
            }
        });
    }

    // Override performSearch to integrate with pagination
    var originalPerformSearch = performSearch;
    function performSearchWithPagination() {
        var searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

        // Reset visibility for pagination recalculation
        allRows.forEach(function(row) {
            var cells = row.querySelectorAll('td');
            var matchSearch = false;
            var matchStatus = true;

            // Check status filter
            if (currentFilter === 'active' || currentFilter === 'inactive') {
                var rowStatus = row.dataset.staffStatus;
                matchStatus = rowStatus === currentFilter;
            }

            // Check search term
            if (!searchTerm) {
                matchSearch = true;
            } else {
                cells.forEach(function(cell) {
                    if (cell.textContent.toLowerCase().includes(searchTerm)) {
                        matchSearch = true;
                    }
                });
            }

            // Mark row as filtered or not (using data attribute instead of display)
            row.dataset.filtered = (matchSearch && matchStatus) ? 'true' : 'false';
            row.style.display = (matchSearch && matchStatus) ? '' : 'none';
        });

        // Reset to page 1 and update pagination
        currentPage = 1;
        updatePagination();
    }

    // Override the original performSearch globally
    performSearch = performSearchWithPagination;

    // Replace search handler
    if (searchInput) {
        searchInput.removeEventListener('input', originalPerformSearch);
        searchInput.addEventListener('input', performSearchWithPagination);
    }

    // Initialize pagination on page load
    initPagination();
});
