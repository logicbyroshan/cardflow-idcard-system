(function () {
  'use strict';

  function createTextTool(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    return {
      onMouseDown: function (event) {
        return d.onTextMouseDown ? d.onTextMouseDown(event) : false;
      },
      onMouseMove: function (event) {
        return d.onTextMouseMove ? d.onTextMouseMove(event) : false;
      },
      onMouseUp: function (event) {
        return d.onTextMouseUp ? d.onTextMouseUp(event) : false;
      },
    };
  }

  window.GcEditorTextTool = {
    create: createTextTool,
  };
})();
