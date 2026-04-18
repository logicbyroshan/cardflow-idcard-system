(function () {
  'use strict';

  function createAlignService(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    return {
      alignSelected: function (mode) {
        return d.alignSelectedDraftElements(mode);
      },
    };
  }

  window.GcEditorAlignService = {
    create: createAlignService,
  };
})();
