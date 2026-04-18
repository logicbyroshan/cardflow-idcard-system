(function () {
  'use strict';

  function createSelectTool(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    return {
      onMouseDown: function (event) {
        return d.onSelectMouseDown ? d.onSelectMouseDown(event) : false;
      },
      onMouseMove: function (event) {
        return d.onSelectMouseMove ? d.onSelectMouseMove(event) : false;
      },
      onMouseUp: function (event) {
        return d.onSelectMouseUp ? d.onSelectMouseUp(event) : false;
      },
    };
  }

  window.GcEditorSelectTool = {
    create: createSelectTool,
  };
})();
