/**
 * Manage Client Page  Search/filter + HTMX refresh wiring.
 * Split from manage-client-events.js
 */
document.addEventListener('DOMContentLoaded', function() {
      var NS = window.ManageClientPage;
      var tableContainer = document.getElementById('client-table-container');
      var searchInput = document.getElementById('searchInput');
      var filterDropdown = document.getElementById('filterDropdown');
      var dropdownToggle = document.getElementById('dropdownToggle');
      var dropdownOptions = document.getElementById('dropdownOptions');
      var selectedText = document.getElementById('selectedText');

      if (!NS || !tableContainer || !searchInput || !filterDropdown || !dropdownToggle || !dropdownOptions || !selectedText) {
        return;
      }

      function getOptionByValue(value) {
        return dropdownOptions.querySelector('.dropdown-option[data-value="' + value + '"]');
      }

      function updateFilterDisplay(option) {
        if (!option) return;
        var optionText = option.textContent.trim();
        var optionValue = option.dataset.value || 'all';
        selectedText.textContent = optionText;
        searchInput.placeholder = optionValue === 'all' ? 'Search All...' : ('Search ' + optionText + '...');
      }

      function setSelectedFilter(filterValue) {
        var normalized = String(filterValue || 'all').toLowerCase();
        var nextOption = getOptionByValue(normalized) || getOptionByValue('all');
        dropdownOptions.querySelectorAll('.dropdown-option').forEach(function(option) {
          option.classList.remove('selected');
        });

        if (!nextOption) return 'all';

        nextOption.classList.add('selected');
        updateFilterDisplay(nextOption);
        if (typeof window.alpineUpdateFilter === 'function') {
          window.alpineUpdateFilter(nextOption.dataset.value || 'all');
        }

        return nextOption.dataset.value || 'all';
      }

      function bindRowsDropdown() {
        var rowsDropdown = document.getElementById('rowsDropdown');
        var rowsToggle = document.getElementById('rowsToggle');
        var rowsOptions = document.getElementById('rowsOptions');
        var rowsSelectedText = document.getElementById('rowsSelectedText');

        if (!rowsDropdown || !rowsToggle || !rowsOptions || rowsDropdown.dataset.bound === '1') {
          return;
        }

        rowsToggle.addEventListener('click', function(e) {
          e.stopPropagation();
          rowsDropdown.classList.toggle('open');
        });

        rowsOptions.addEventListener('click', function(e) {
          var option = e.target.closest('.dropdown-option');
          if (!option) return;

          rowsOptions.querySelectorAll('.dropdown-option').forEach(function(item) {
            item.classList.remove('selected');
          });
          option.classList.add('selected');

          if (rowsSelectedText) {
            rowsSelectedText.textContent = String(option.dataset.value || option.textContent || '').trim();
          }
          rowsDropdown.classList.remove('open');
        });

        rowsDropdown.dataset.bound = '1';
      }

      var urlParams = new URLSearchParams(window.location.search);
      var initialSearchField = String(urlParams.get('search_field') || 'all').toLowerCase();
      setSelectedFilter(initialSearchField);

      var initialSearchValue = urlParams.get('search');
      if (initialSearchValue) {
        searchInput.value = initialSearchValue;
        if (typeof window.alpineUpdateSearch === 'function') {
          window.alpineUpdateSearch(initialSearchValue);
        }
      }

      searchInput.addEventListener('input', function() {
        if (typeof window.alpineUpdateSearch === 'function') {
          window.alpineUpdateSearch(searchInput.value);
        }
      });

      dropdownToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        filterDropdown.classList.toggle('open');
      });

      dropdownOptions.addEventListener('click', function(e) {
          var option = e.target.closest('.dropdown-option');
          if (!option) return;

          setSelectedFilter(option.dataset.value || 'all');
          filterDropdown.classList.remove('open');
      });

      document.addEventListener('click', function(e) {
        if (!filterDropdown.contains(e.target)) {
          filterDropdown.classList.remove('open');
        }

        var rowsDropdown = document.getElementById('rowsDropdown');
        if (rowsDropdown && !rowsDropdown.contains(e.target)) {
          rowsDropdown.classList.remove('open');
        }
      });

      if (typeof window.initHTMXFilters === 'function' && !window.manageClientFilterBridge) {
        var baseUrl = tableContainer.getAttribute('hx-get') || window.location.pathname;
        window.manageClientFilterBridge = window.initHTMXFilters({
          baseUrl: baseUrl,
          target: '#client-table-container',
          searchInputId: 'searchInput',
          filters: [
            { name: 'search_field', optionsId: 'dropdownOptions' }
          ],
          tabs: [
            { name: 'status', selector: '#status-tabs .status-tab' }
          ],
          debounceMs: 300
        });
      }

      bindRowsDropdown();

      document.body.addEventListener('htmx:afterSwap', function(e) {
        if (e.target && e.target.id === 'client-table-container') {
          bindRowsDropdown();
        }
      });

      // Auto-open drawer if ?add=1 is in URL
      if (urlParams.get('add') === '1') {
        NS.openDrawer('add');
        urlParams.delete('add');
        var nextQuery = urlParams.toString();
        var nextUrl = window.location.pathname + (nextQuery ? ('?' + nextQuery) : '');
        window.history.replaceState({}, document.title, nextUrl);
      }
    });
