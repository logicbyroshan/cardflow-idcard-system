/**
 * HTMX Filter Bridge v1.1.0
 * 
 * Replaces client-side DOM show/hide filtering with server-side HTMX requests.
 * Layers on top of existing JS  does not modify page-specific code.
 *
 * v1.1.0: In-flight dedup guard, abort on new request, expose refresh/abort
 *
 * Usage:
 *   initHTMXFilters({
 *     baseUrl: '/manage-staff/',
 *     target:  '#staff-table-container',
 *     searchInputId: 'searchInput',
 *     filters: [{ name: 'status', optionsId: 'statusOptions' }],
 *     debounceMs: 400           // optional, default 400
 *   });
 *
 * Supported filter types:
 *   - Search input (text, debounced)
 *   - Custom dropdown (.dropdown-option with data-value)
 *   - Status tabs (.action-tab with data-status or href ?status=)
 */

(function () {
  'use strict';

  /**
   * @param {Object} config
   * @param {string}   config.baseUrl       Django view URL (no query string)
   * @param {string}   config.target        CSS selector for HTMX swap target
   * @param {string}   config.searchInputId  ID of the search <input>
   * @param {Array}    [config.filters]     [{name, optionsId}] custom dropdown filters
   * @param {Array}    [config.tabs]        [{name, selector}] status tab groups
   * @param {Object}   [config.staticParams]  {key: value|function}
   * @param {number}   [config.debounceMs]  debounce delay for search (default: 400)
   * @returns {{ refresh: Function, getParams: Function }}
   */
  function initHTMXFilters(config) {
    var baseUrl      = config.baseUrl;
    var target       = config.target;
    var searchInput  = document.getElementById(config.searchInputId);
    var filters      = config.filters || [];
    var tabs         = config.tabs || [];
    var staticParams = config.staticParams || {};
    var debounceMs   = config.debounceMs || 400;
    var bindEvents   = config.bindEvents !== false; // default true

    //  In-flight request guard (prevents duplicate network requests) 
    var _inFlight    = false;

    //  Collect current filter parameters 
    function getParams() {
      var params = new URLSearchParams();

      // Static/dynamic params (always included)
      for (var key in staticParams) {
        var val = staticParams[key];
        if (typeof val === 'function') val = val();
        if (val) params.set(key, val);
      }

      // Search text
      if (searchInput) {
        var q = searchInput.value.trim();
        if (q) params.set('search', q);
      }

      // Custom dropdown filters
      for (var i = 0; i < filters.length; i++) {
        var f = filters[i];
        var selected = document.querySelector('#' + f.optionsId + ' .dropdown-option.selected');
        if (selected && selected.dataset.value) {
          params.set(f.name, selected.dataset.value);
        }
      }

      // Active tab (first match wins)
      for (var t = 0; t < tabs.length; t++) {
        var activeTab = document.querySelector(tabs[t].selector + '.active');
        if (activeTab) {
          // Read from data-status OR extract from href
          var val = activeTab.dataset.status;
          if (!val && activeTab.href) {
            var u = new URL(activeTab.href, location.origin);
            val = u.searchParams.get(tabs[t].name);
          }
          if (val) params.set(tabs[t].name, val);
        }
      }

      // Preserve per_page from current pagination
      var perPageLabel = document.querySelector(
        target + ' #rowsLabel,' +
        target + ' [id$="rowsLabel"],' +
        target + ' #rowsSelectedText,' +
        target + ' [id$="rowsSelectedText"]'
      );
      var pp = '';
      if (perPageLabel) {
        pp = perPageLabel.textContent.trim();
      }
      if ((!pp || isNaN(pp)) && document.querySelector(target + ' #rowsOptions .dropdown-option.selected')) {
        pp = document.querySelector(target + ' #rowsOptions .dropdown-option.selected').dataset.value || '';
      }
      if (pp && !isNaN(pp)) params.set('per_page', pp);

      return params;
    }

    //  Fire HTMX request (with dedup + abort previous) 
    var _requestSeq = 0;  // Sequence counter to discard stale responses
    function refresh() {
      if (typeof htmx === 'undefined') return;

      // Abort any in-flight HTMX request on the target element
      var targetEl = document.querySelector(target);
      if (targetEl && _inFlight) {
        try { htmx.trigger(targetEl, 'htmx:abort'); } catch(e){}
      }

      var qs = getParams().toString();
      var url = baseUrl + (qs ? '?' + qs : '');

      _inFlight = true;
      var seq = ++_requestSeq;
      htmx.ajax('GET', url, { target: target, swap: 'innerHTML' }).then(function() {
        // Only clear in-flight if this is still the latest request
        if (seq === _requestSeq) { _inFlight = false; }
      }).catch(function() {
        if (seq === _requestSeq) { _inFlight = false; }
      });
    }

    //  Wire event listeners (skipped when bindEvents is false) 
    if (bindEvents) {
      //  Wire search input (debounced) 
      var timer;
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          clearTimeout(timer);
          timer = setTimeout(refresh, debounceMs);
        });

        // Clear button (inside .search-box ancestor)
        var searchBox = searchInput.closest('.search-box');
        if (searchBox) {
          var clearBtn = searchBox.querySelector('.search-clear-btn');
          if (clearBtn) {
            clearBtn.addEventListener('click', function () {
              // Existing JS clears the input; we just need to refresh
              setTimeout(refresh, 10);
            });
          }
        }
      }

      //  Wire dropdown filter option clicks (delegated) 
      for (var i = 0; i < filters.length; i++) {
        (function (f) {
          var optionsEl = document.getElementById(f.optionsId);
          if (!optionsEl) return;
          optionsEl.addEventListener('click', function (e) {
            if (e.target.closest('.dropdown-option')) {
              // Let existing handler update .selected class first
              setTimeout(refresh, 15);
            }
          });
        })(filters[i]);
      }

      //  Wire status tabs 
      for (var t = 0; t < tabs.length; t++) {
        (function (tabConfig) {
          var tabEls = document.querySelectorAll(tabConfig.selector);
          tabEls.forEach(function (tab) {
            tab.addEventListener('click', function (e) {
              e.preventDefault();
              // Update active class
              tabEls.forEach(function (t) { t.classList.remove('active'); });
              tab.classList.add('active');
              // Refresh with new tab value
              setTimeout(refresh, 10);
            });
          });
        })(tabs[t]);
      }
    } // end bindEvents

    return { refresh: refresh, getParams: getParams };
  }

  //  Expose globally 
  window.initHTMXFilters = initHTMXFilters;
})();
