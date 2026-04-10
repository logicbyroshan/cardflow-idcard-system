/**
 * Manage Client Page  Search, filter, pagination, auto-open from URL, initialization
 * Split from manage-client-events.js
 */
document.addEventListener('DOMContentLoaded', function() {
      var NS = window.ManageClientPage;

      var table = document.getElementById('clientsTable');
      var tbody = table.querySelector('tbody');

      // ==================== SEARCH & FILTER ====================
      var searchInput = document.getElementById('searchInput');
      var filterDropdown = document.getElementById('filterDropdown');
      var dropdownToggle = document.getElementById('dropdownToggle');
      var dropdownOptions = document.getElementById('dropdownOptions');
      var selectedText = document.getElementById('selectedText');
      
      var currentFilter = 'all';
      
      // Column index mapping: 0=Name, 1=Email, 2=Mobile
      var filterColumnMap = {
        'all': null,
        'name': 0,
        'email': 1,
        'mobile': 2
      };
      
      function performSearch() {
        var searchTerm = searchInput.value.toLowerCase().trim();
        var rows = tbody.querySelectorAll('tr:not(.no-data-row)');
        
        rows.forEach(function(row) {
          var cells = row.querySelectorAll('td');
          var match = false;
          
          if (currentFilter === 'all' || !searchTerm) {
            // Search all columns
            var text = row.textContent.toLowerCase();
            match = text.includes(searchTerm);
          } else {
            // Search specific column
            var columnIndex = filterColumnMap[currentFilter];
            if (columnIndex !== null && cells[columnIndex]) {
              var cellText = cells[columnIndex].textContent.toLowerCase();
              match = cellText.includes(searchTerm);
            }
          }
          
          row.style.display = match ? '' : 'none';
        });
      }
      
      searchInput.addEventListener('input', function() {
        performSearch();
        if (typeof window.alpineUpdateSearch === 'function') window.alpineUpdateSearch(searchInput.value);
      });

      dropdownToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        filterDropdown.classList.toggle('open');
      });

      dropdownOptions.querySelectorAll('.dropdown-option').forEach(function(option) {
        option.addEventListener('click', function() {
          dropdownOptions.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
          this.classList.add('selected');
          selectedText.textContent = this.textContent;
          currentFilter = this.dataset.value;
          filterDropdown.classList.remove('open');
          searchInput.placeholder = 'Search ' + this.textContent + '...';
          if (typeof window.alpineUpdateFilter === 'function') window.alpineUpdateFilter(currentFilter);
          performSearch();
        });
      });

      // ==================== PAGINATION ====================
      var paginationInfo = document.querySelector('.pagination-info');
      var pageNumbers = document.querySelector('.page-numbers');
      var firstPageBtn = document.getElementById('firstPage');
      var prevPageBtn = document.getElementById('prevPage');
      var nextPageBtn = document.getElementById('nextPage');
      var lastPageBtn = document.getElementById('lastPage');
      var rowsDropdown = document.getElementById('rowsDropdown');
      var rowsToggle = document.getElementById('rowsToggle');
      var rowsOptions = document.getElementById('rowsOptions');
      var rowsSelectedText = document.getElementById('rowsSelectedText');

      document.addEventListener('click', function(e) {
        if (!filterDropdown.contains(e.target)) {
          filterDropdown.classList.remove('open');
        }
        if (rowsDropdown && !rowsDropdown.contains(e.target)) {
          rowsDropdown.classList.remove('open');
        }
      });
      
      var currentPage = 1;
      var rowsPerPage = parseInt((rowsSelectedText && rowsSelectedText.textContent) || '25', 10);
      if (!rowsPerPage || rowsPerPage < 1) rowsPerPage = 25;
      var allRows = Array.from(tbody.querySelectorAll('tr:not(.no-data-row)'));
      
      // Initialize all rows as filtered=true
      allRows.forEach(function(row) { row.dataset.filtered = 'true'; });
      
      function updatePagination() {
        // Get filtered rows (rows that match search criteria)
        var filteredRows = allRows.filter(function(row) { return row.dataset.filtered === 'true'; });
        var totalRows = filteredRows.length;
        var totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
        
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        
        var startIndex = (currentPage - 1) * rowsPerPage;
        var endIndex = Math.min(startIndex + rowsPerPage, totalRows);
        
        // Hide all rows first
        allRows.forEach(function(row) { row.style.display = 'none'; });
        
        // Show only current page rows from filtered results
        filteredRows.slice(startIndex, endIndex).forEach(function(row) { row.style.display = ''; });
        
        // Update pagination info
        if (paginationInfo) {
          if (totalRows === 0) {
            paginationInfo.innerHTML = 'Showing <strong>0</strong> results';
          } else {
            paginationInfo.innerHTML = 'Showing <strong>' + (startIndex + 1) + '-' + endIndex + '</strong> of <strong>' + totalRows + '</strong> results';
          }
        }
        
        // Update page numbers
        if (pageNumbers) {
          pageNumbers.innerHTML = '';
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
              pageNumbers.appendChild(pageBtn);
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
        // Clear selection when changing pages
        if (NS.selectedRow) {
          NS.selectedRow.classList.remove('selected');
          NS.selectedRow = null;
          NS.selectedClientId = null;
          NS.disableActionButtons();
        }
        updatePagination();
      }
      
      // Pagination button events
      if (firstPageBtn) firstPageBtn.addEventListener('click', function() { goToPage(1); });
      if (prevPageBtn) prevPageBtn.addEventListener('click', function() { goToPage(currentPage - 1); });
      if (nextPageBtn) nextPageBtn.addEventListener('click', function() { goToPage(currentPage + 1); });
      if (lastPageBtn) {
        lastPageBtn.addEventListener('click', function() {
          var filteredRows = allRows.filter(function(row) { return row.dataset.filtered === 'true'; });
          var totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
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
            rowsOptions.querySelectorAll('.dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
            this.classList.add('selected');
            rowsPerPage = parseInt(this.dataset.value);
            if (rowsSelectedText) rowsSelectedText.textContent = rowsPerPage;
            currentPage = 1;
            rowsDropdown.classList.remove('open');
            updatePagination();
          });
        });
      }
      
      // Override performSearch to work with pagination
      var originalPerformSearch = performSearch;
      performSearch = function() {
        var searchTerm = searchInput.value.toLowerCase().trim();
        
        allRows.forEach(function(row) {
          var cells = row.querySelectorAll('td');
          var match = false;
          
          if (currentFilter === 'all' || !searchTerm) {
            var text = row.textContent.toLowerCase();
            match = !searchTerm || text.includes(searchTerm);
          } else {
            var columnIndex = filterColumnMap[currentFilter];
            if (columnIndex !== null && cells[columnIndex]) {
              var cellText = cells[columnIndex].textContent.toLowerCase();
              match = cellText.includes(searchTerm);
            }
          }
          
          row.dataset.filtered = match ? 'true' : 'false';
        });
        
        currentPage = 1;
        updatePagination();
      };
      
      // Initialize pagination
      updatePagination();

      // Auto-open drawer if ?add=1 is in URL
      var urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('add') === '1') {
        NS.openDrawer();
        // Remove the query parameter from URL without reloading
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    });
