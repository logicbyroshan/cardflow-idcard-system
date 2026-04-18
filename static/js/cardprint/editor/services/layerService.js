(function () {
  'use strict';

  function createLayerService(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    return {
      moveSelectedLayers: function (mode) {
        return d.moveSelectedDraftLayers(mode);
      },
      reorderByIds: function (sourceId, targetId, placeAfter) {
        return d.reorderDraftLayerByIds(sourceId, targetId, placeAfter);
      },
      setVisibility: function (id, visible) {
        return d.setDraftLayerVisibility(id, visible);
      },
      setLocked: function (id, locked) {
        return d.setDraftLayerLocked(id, locked);
      },
    };
  }

  window.GcEditorLayerService = {
    create: createLayerService,
  };
})();
