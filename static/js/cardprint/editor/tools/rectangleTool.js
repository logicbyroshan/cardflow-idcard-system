(function () {
  'use strict';

  function createRectangleTool(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    return {
      onMouseDown: function (event) {
        return d.onRectangleMouseDown ? d.onRectangleMouseDown(event) : false;
      },
      onMouseMove: function (event) {
        return d.onRectangleMouseMove ? d.onRectangleMouseMove(event) : false;
      },
      onMouseUp: function (event) {
        return d.onRectangleMouseUp ? d.onRectangleMouseUp(event) : false;
      },
    };
  }

  window.GcEditorRectangleTool = {
    create: createRectangleTool,
  };
})();
