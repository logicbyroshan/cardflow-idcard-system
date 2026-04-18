(function () {
  'use strict';

  function createInitialEditorState(options) {
    var opts = options && typeof options === 'object' ? options : {};
    return {
      step: 1,
      loading: false,
      generating: false,
      orientation: 'landscape',
      isTwoSided: false,
      frontFile: null,
      backFile: null,
      frontPreviewUrl: '',
      backPreviewUrl: '',
      localPreviewUrls: {
        front: '',
        back: '',
      },
      templates: [],
      selectedTemplateId: null,
      selectedTemplate: null,
      templateDraft: null,
      templateDraftName: '',
      draftSelectedElementId: '',
      draftSelectedElementIds: new Set(),
      draftInlineEditingElementId: '',
      draftPendingTextEdit: null,
      draftSelectedGuideId: '',
      draftGuidesLocked: false,
      draftMergePreview: false,
      draftAutoMapScope: 'active',
      draftAutoMapReport: null,
      draftAutoMapReportOpen: false,
      draftSaveModalOpen: false,
      draftSaveTemplateName: '',
      draftSaveTemplateError: '',
      draftActiveSide: 'front',
      draftAlignReference: 'selection',
      draftDistributeMode: 'spacing',
      draftKeyObjectId: '',
      draftAlignPreviewMode: '',
      uiPanels: opts.uiPanels,
      draftTool: 'select',
      draftTransformMode: 'resize',
      draftDragging: null,
      draftResizeDragging: null,
      draftGuideDragging: null,
      draftTextDrag: null,
      draftRectDrag: null,
      draftSelectDrag: null,
      draftLayerDragId: '',
      draftZoom: 2,
      draftZoomOriginX: 50,
      draftZoomOriginY: 50,
      clipboard: [],
      clipboardPasteCount: 0,
      draftUnit: 'mm',
      draftSnapMm: 0.1,
      draftDirty: false,
      draftHistory: null,
      draftInlineEditHistoryActive: false,
      pendingZoomAnchor: null,
      draftLastPointerClientX: null,
      draftLastPointerClientY: null,
      zoomWheelMode: false,
      spacePanMode: false,
      spacePanState: null,
      cards: [],
      selectedRequestIds: new Set(),
      lastPdfBlob: null,
      lastPdfName: 'cards.pdf',
    };
  }

  function createEditorStateStore(initialState) {
    var state = initialState && typeof initialState === 'object'
      ? initialState
      : createInitialEditorState({});
    var listeners = [];

    function getState() {
      return state;
    }

    function setState(next) {
      if (typeof next === 'function') {
        var updated = next(state);
        if (updated && typeof updated === 'object') {
          state = updated;
        }
      } else if (next && typeof next === 'object') {
        Object.keys(next).forEach(function (key) {
          state[key] = next[key];
        });
      }

      listeners.slice().forEach(function (listener) {
        try {
          listener(state);
        } catch (_err) {
          // Ignore subscriber errors to keep editor responsive.
        }
      });

      return state;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') {
        return function () {};
      }
      listeners.push(listener);
      return function () {
        listeners = listeners.filter(function (item) {
          return item !== listener;
        });
      };
    }

    return {
      getState: getState,
      setState: setState,
      subscribe: subscribe,
    };
  }

  window.GcEditorState = {
    createInitialEditorState: createInitialEditorState,
    createEditorStateStore: createEditorStateStore,
  };
})();
