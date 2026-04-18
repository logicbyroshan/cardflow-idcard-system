(function () {
  'use strict';

  function createPhotoTool(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    return {
      onMouseDown: function (event) {
        return d.onPhotoMouseDown ? d.onPhotoMouseDown(event) : false;
      },
      onMouseMove: function (event) {
        return d.onPhotoMouseMove ? d.onPhotoMouseMove(event) : false;
      },
      onMouseUp: function (event) {
        return d.onPhotoMouseUp ? d.onPhotoMouseUp(event) : false;
      },
    };
  }

  window.GcEditorPhotoTool = {
    create: createPhotoTool,
  };
})();
