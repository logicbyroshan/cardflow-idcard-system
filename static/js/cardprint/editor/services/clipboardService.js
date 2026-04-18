(function () {
  'use strict';

  function createClipboardService(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    function selectedDraftElementsSortedByZIndex() {
      var selected = d.selectedDraftElements();
      if (!selected.length) {
        return [];
      }
      return d.sortDraftElementsByZIndex(selected);
    }

    function copySelectedDraftElements(options) {
      var opts = options && typeof options === 'object' ? options : {};
      var quiet = !!opts.quiet;
      var selected = selectedDraftElementsSortedByZIndex();
      if (!selected.length) {
        if (!quiet) {
          d.showToast('Select at least one element to copy.', 'warning');
        }
        return false;
      }

      d.state.clipboard = selected.map(function (item) {
        var snapshot = d.deepCloneJson(item, {});
        if (snapshot && typeof snapshot === 'object') {
          delete snapshot.__id;
        }
        return snapshot;
      });
      d.state.clipboardPasteCount = 0;

      if (!quiet) {
        d.showToast('Copied ' + String(selected.length) + ' element(s).', 'success');
      }
      return true;
    }

    function pasteClipboardElements(inPlace) {
      d.ensureStep2DraftInitialized();
      var clipboard = Array.isArray(d.state.clipboard) ? d.state.clipboard : [];
      if (!clipboard.length) {
        d.showToast('Clipboard is empty.', 'warning');
        return false;
      }

      var placeInOriginalPosition = !!inPlace;
      var offsetStep = 0;
      if (!placeInOriginalPosition) {
        var pasteCount = Math.max(0, Number(d.state.clipboardPasteCount || 0));
        offsetStep = (pasteCount + 1) * 10;
      }

      var pastedIds = [];
      d.beginDraftHistoryTransaction();
      try {
        d.prepareDraftHistoryMutation();
        var zSeed = d.maxDraftElementZIndex();
        clipboard.forEach(function (item, idx) {
          var draft = d.deepCloneJson(item, {});
          if (!draft || typeof draft !== 'object') {
            return;
          }
          delete draft.__id;

          draft.x = Number(draft.x || 0) + offsetStep;
          draft.y = Number(draft.y || 0) + offsetStep;
          draft.zIndex = zSeed + idx + 1;

          var nextIndex = d.state.templateDraft.elements.length;
          var normalized = d.normalizeDraftElement(draft, nextIndex);
          d.state.templateDraft.elements.push(normalized);
          pastedIds.push(String(normalized.__id || ''));
        });

        d.normalizeDraftElementZOrder(false);
        d.setDraftSelectedElementIds(new Set(pastedIds), pastedIds[0] || '');
        d.clearDraftInlineTextEditing();
        d.state.draftSelectedGuideId = '';
        d.markDraftDirty();
      } finally {
        d.endDraftHistoryTransaction();
      }

      if (!pastedIds.length) {
        return false;
      }

      if (!placeInOriginalPosition) {
        d.state.clipboardPasteCount = Math.max(0, Number(d.state.clipboardPasteCount || 0)) + 1;
      }
      d.showToast('Pasted ' + String(pastedIds.length) + ' element(s).', 'success');
      return true;
    }

    function cutSelectedDraftElements() {
      if (!copySelectedDraftElements({ quiet: true })) {
        d.showToast('Select at least one element to cut.', 'warning');
        return false;
      }

      d.beginDraftHistoryTransaction();
      try {
        d.removeDraftElement();
      } finally {
        d.endDraftHistoryTransaction();
      }
      d.showToast('Cut selected element(s).', 'success');
      return true;
    }

    return {
      selectedDraftElementsSortedByZIndex: selectedDraftElementsSortedByZIndex,
      copySelectedDraftElements: copySelectedDraftElements,
      pasteClipboardElements: pasteClipboardElements,
      cutSelectedDraftElements: cutSelectedDraftElements,
    };
  }

  window.GcEditorClipboardService = {
    create: createClipboardService,
  };
})();
