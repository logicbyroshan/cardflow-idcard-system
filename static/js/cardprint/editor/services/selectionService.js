(function () {
  'use strict';

  function createSelectionService(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    return {
      selectByBox: function (box, appendSelection, mode, baseSelectionIds) {
        return d.selectDraftElementsByBox(box, appendSelection, mode, baseSelectionIds);
      },
      selectedSet: function () {
        return d.selectedDraftElementSet();
      },
      selectedElements: function () {
        return d.selectedDraftElements();
      },
      setSelectedIds: function (ids, primaryId) {
        return d.setDraftSelectedElementIds(ids, primaryId);
      },
    };
  }

  window.GcEditorSelectionService = {
    create: createSelectionService,
  };
})();
