(function () {
  'use strict';

  function createGuideService(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    return {
      addGuide: function (axis, pos) {
        return d.addDraftGuide(axis, pos);
      },
      updateGuidePosition: function (id, pos) {
        return d.updateDraftGuidePosition(id, pos);
      },
      removeGuide: function (id) {
        return d.removeDraftGuideById(id);
      },
      selectedGuide: function () {
        return d.selectedDraftGuide();
      },
    };
  }

  window.GcEditorGuideService = {
    create: createGuideService,
  };
})();
