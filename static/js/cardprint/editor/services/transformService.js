(function () {
  'use strict';

  function createTransformService(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    return {
      applyResizeDrag: function (resizeDrag, event) {
        return d.applyDraftResizeDrag(resizeDrag, event);
      },
      nudgeSelected: function (dx, dy) {
        return d.nudgeSelectedDraftElement(dx, dy);
      },
      updateSelected: function (patch) {
        return d.updateSelectedDraftElement(patch);
      },
      setZoomWithAnchor: function (zoom, anchorEvent) {
        return d.setDraftZoomWithAnchor(zoom, anchorEvent);
      },
    };
  }

  window.GcEditorTransformService = {
    create: createTransformService,
  };
})();
