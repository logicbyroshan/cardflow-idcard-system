/* Phase 7: Re-initialize handlers after HTMX table swap */
document.body.addEventListener('htmx:afterSwap', function(evt) {
  if (evt.target.id === 'card-table-container') {
    if (typeof window._savedScrollTop === 'number') {
      // Action refresh (verify/edit/delete)  restore previous scroll position
      requestAnimationFrame(function() {
        window.scrollTo(0, window._savedScrollTop);
        var tableContainer = document.getElementById('card-table-container');
        var scrollParent = tableContainer ? tableContainer.closest('.main-content') || tableContainer.parentElement : null;
        if (scrollParent && typeof window._savedScrollParentTop === 'number') {
          scrollParent.scrollTop = window._savedScrollParentTop;
        }
        delete window._savedScrollTop;
        delete window._savedScrollParentTop;
      });
    } else {
      // Pagination / filter change  scroll to top of table
      requestAnimationFrame(function() {
        var tableContainer = document.getElementById('card-table-container');
        if (tableContainer) {
          tableContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }

    // Re-init TABLE module (lazy load state, scroll listener, pagination buttons)
    try {
      if (window.IDCardApp && typeof window.IDCardApp.initTableModule === 'function') {
        window.IDCardApp.initTableModule();
      }
    } catch (e) { console.error('afterSwap: initTableModule error', e); }

    // Re-init checkboxes (select all, shift+click, button states)
    try {
      if (window.IDCardApp && typeof window.IDCardApp.initCoreModule === 'function') {
        window.IDCardApp.initCoreModule();
      }
    } catch (e) { console.error('afterSwap: initCoreModule error', e); }

    // Re-init inline editing on new DOM
    try {
      if (window.IDCardApp && typeof window.IDCardApp.initEditModule === 'function') {
        window.IDCardApp.initEditModule();
      }
    } catch (e) { console.error('afterSwap: initEditModule error', e); }

    // Reset shift-click anchor index
    if (window.IDCardApp && typeof window.IDCardApp.resetShiftClickIndex === 'function') {
      window.IDCardApp.resetShiftClickIndex();
    }

    // Re-attach edit-photo-btn delegation on the NEW #data-table
    // (initModalModule is only called once on page load; #data-table lives
    //  inside the swap target so its old listener is destroyed on swap)
    var dataTable = document.getElementById('data-table');
    if (dataTable && !dataTable._editPhotoBtnInit) {
      dataTable._editPhotoBtnInit = true;
      dataTable.addEventListener('click', function(e) {
        var editBtn = e.target.closest('.edit-photo-btn');
        if (!editBtn) return;
        e.stopPropagation();
        var cardId = editBtn.getAttribute('data-card-id');
        if (cardId && window.IDCardApp && typeof window.IDCardApp.fetchCardAndOpenModal === 'function') {
          window.IDCardApp.fetchCardAndOpenModal('edit', cardId);
        }
      });
    }

    // Row action buttons  delegation is already handled by
    // initTableModule()  _initTableBodyDelegation().  Do NOT add
    // a duplicate listener here; the old block caused double-fire.
    // (Bug #2 fix: removed duplicate _rowActionHandlersInit block)
  }
});
