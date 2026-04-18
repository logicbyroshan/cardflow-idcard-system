(function () {
  'use strict';

  function createHistoryService(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    function ensureDraftHistoryState() {
      var state = d.state;
      if (!state.draftHistory || typeof state.draftHistory !== 'object') {
        state.draftHistory = {
          undo: [],
          redo: [],
          applying: false,
          inTxn: false,
          txnCaptured: false,
          maxDepth: 15,
          lastSig: '',
        };
      }
      return state.draftHistory;
    }

    function draftHistorySnapshot() {
      var state = d.state;
      d.ensureStep2DraftInitialized();
      d.normalizeDraftElementSelection();
      return {
        templateDraft: d.deepCloneJson(state.templateDraft, d.defaultTemplateJson()),
        templateDraftName: String(state.templateDraftName || ''),
        draftSelectedElementId: String(state.draftSelectedElementId || ''),
        draftSelectedElementIds: Array.from(d.selectedDraftElementSet()).map(function (id) {
          return String(id || '');
        }).sort(),
        draftSelectedGuideId: String(state.draftSelectedGuideId || ''),
        draftMergePreview: !!state.draftMergePreview,
        draftActiveSide: state.draftActiveSide === 'back' ? 'back' : 'front',
        draftAlignReference: d.normalizeDraftAlignReference(state.draftAlignReference),
        draftDistributeMode: d.normalizeDraftDistributeMode(state.draftDistributeMode),
        draftKeyObjectId: String(state.draftKeyObjectId || ''),
        draftTool: String(state.draftTool || 'select'),
        draftUnit: d.currentDraftUnit(),
        draftSnapMm: d.normalizeDraftSnapMm(state.draftSnapMm),
        orientation: d.normalizeOrientation(state.orientation || 'landscape'),
        isTwoSided: !!state.isTwoSided,
        draftZoom: Number(state.draftZoom || 1),
        draftZoomOriginX: Number(state.draftZoomOriginX || 50),
        draftZoomOriginY: Number(state.draftZoomOriginY || 50),
      };
    }

    function draftHistorySignature(snapshot) {
      return JSON.stringify(snapshot || {});
    }

    function captureDraftHistoryPoint() {
      var state = d.state;
      if (state.step !== 2) {
        return false;
      }

      var hist = ensureDraftHistoryState();
      if (hist.applying) {
        return false;
      }

      var snap = draftHistorySnapshot();
      var sig = draftHistorySignature(snap);
      if (sig === hist.lastSig) {
        return false;
      }

      hist.undo.push(snap);
      while (hist.undo.length > Math.max(1, Number(hist.maxDepth || 15))) {
        hist.undo.shift();
      }
      hist.redo = [];
      hist.lastSig = sig;
      if (hist.inTxn) {
        hist.txnCaptured = true;
      }
      return true;
    }

    function beginDraftHistoryTransaction() {
      var state = d.state;
      if (state.step !== 2) {
        return;
      }
      var hist = ensureDraftHistoryState();
      if (!hist.inTxn) {
        hist.inTxn = true;
        hist.txnCaptured = false;
      }
    }

    function endDraftHistoryTransaction() {
      var state = d.state;
      var hist = ensureDraftHistoryState();
      if (!hist.inTxn) {
        return;
      }
      hist.inTxn = false;
      hist.txnCaptured = false;
      if (state.step === 2) {
        hist.lastSig = draftHistorySignature(draftHistorySnapshot());
      }
    }

    function prepareDraftHistoryMutation() {
      var state = d.state;
      if (state.step !== 2) {
        return;
      }
      var hist = ensureDraftHistoryState();
      if (hist.applying) {
        return;
      }
      if (hist.inTxn) {
        if (!hist.txnCaptured) {
          captureDraftHistoryPoint();
        }
        return;
      }
      captureDraftHistoryPoint();
    }

    function applyDraftHistorySnapshot(snapshot) {
      var state = d.state;
      if (!snapshot || typeof snapshot !== 'object') {
        return false;
      }

      state.templateDraft = d.deepCloneJson(snapshot.templateDraft, d.defaultTemplateJson());
      state.templateDraftName = String(snapshot.templateDraftName || '');
      state.draftSelectedElementId = String(snapshot.draftSelectedElementId || '');
      state.draftSelectedElementIds = new Set(Array.isArray(snapshot.draftSelectedElementIds)
        ? snapshot.draftSelectedElementIds.map(function (id) { return String(id || ''); })
        : []);
      state.draftSelectedGuideId = String(snapshot.draftSelectedGuideId || '');
      state.draftMergePreview = !!snapshot.draftMergePreview;
      state.draftActiveSide = snapshot.draftActiveSide === 'back' ? 'back' : 'front';
      state.draftAlignReference = d.normalizeDraftAlignReference(snapshot.draftAlignReference);
      state.draftDistributeMode = d.normalizeDraftDistributeMode(snapshot.draftDistributeMode);
      state.draftKeyObjectId = String(snapshot.draftKeyObjectId || '');
      state.draftAlignPreviewMode = '';

      var tool = String(snapshot.draftTool || 'select');
      if (tool !== 'select' && tool !== 'text' && tool !== 'photo' && tool !== 'rectangle') {
        tool = 'select';
      }
      state.draftTool = tool;

      state.orientation = d.normalizeOrientation(snapshot.orientation || state.orientation || 'landscape');
      state.isTwoSided = !!snapshot.isTwoSided;

      var unit = String(snapshot.draftUnit || 'mm').toLowerCase();
      if (unit !== 'mm' && unit !== 'cm' && unit !== 'in') {
        unit = 'mm';
      }
      state.draftUnit = unit;
      state.draftSnapMm = d.normalizeDraftSnapMm(snapshot.draftSnapMm);

      d.setDraftZoom(Number(snapshot.draftZoom || 1));
      var originX = Number(snapshot.draftZoomOriginX);
      var originY = Number(snapshot.draftZoomOriginY);
      state.draftZoomOriginX = Number.isFinite(originX) ? Math.max(0, Math.min(100, originX)) : 50;
      state.draftZoomOriginY = Number.isFinite(originY) ? Math.max(0, Math.min(100, originY)) : 50;

      state.draftDragging = null;
      state.draftResizeDragging = null;
      state.draftGuideDragging = null;
      state.draftTextDrag = null;
      state.draftRectDrag = null;
      state.draftSelectDrag = null;
      state.draftLayerDragId = '';
      d.clearDraftInlineTextEditing();
      state.draftInlineEditHistoryActive = false;

      d.normalizeDraftElementZOrder(false);
      d.normalizeDraftElementSelection();
      state.draftDirty = true;
      d.syncDraftToSelectedTemplate();
      return true;
    }

    function undoDraftHistory() {
      var state = d.state;
      if (state.step !== 2) {
        return false;
      }
      var hist = ensureDraftHistoryState();
      if (!hist.undo.length) {
        return false;
      }

      var current = draftHistorySnapshot();
      var previous = hist.undo.pop();
      hist.redo.push(current);
      while (hist.redo.length > Math.max(1, Number(hist.maxDepth || 15))) {
        hist.redo.shift();
      }

      hist.applying = true;
      try {
        applyDraftHistorySnapshot(previous);
      } finally {
        hist.applying = false;
      }

      hist.lastSig = draftHistorySignature(draftHistorySnapshot());
      return true;
    }

    function redoDraftHistory() {
      var state = d.state;
      if (state.step !== 2) {
        return false;
      }
      var hist = ensureDraftHistoryState();
      if (!hist.redo.length) {
        return false;
      }

      var current = draftHistorySnapshot();
      var next = hist.redo.pop();
      hist.undo.push(current);
      while (hist.undo.length > Math.max(1, Number(hist.maxDepth || 15))) {
        hist.undo.shift();
      }

      hist.applying = true;
      try {
        applyDraftHistorySnapshot(next);
      } finally {
        hist.applying = false;
      }

      hist.lastSig = draftHistorySignature(draftHistorySnapshot());
      return true;
    }

    return {
      ensureDraftHistoryState: ensureDraftHistoryState,
      draftHistorySnapshot: draftHistorySnapshot,
      draftHistorySignature: draftHistorySignature,
      captureDraftHistoryPoint: captureDraftHistoryPoint,
      beginDraftHistoryTransaction: beginDraftHistoryTransaction,
      endDraftHistoryTransaction: endDraftHistoryTransaction,
      prepareDraftHistoryMutation: prepareDraftHistoryMutation,
      applyDraftHistorySnapshot: applyDraftHistorySnapshot,
      undoDraftHistory: undoDraftHistory,
      redoDraftHistory: redoDraftHistory,
    };
  }

  window.GcEditorHistoryService = {
    create: createHistoryService,
  };
})();
