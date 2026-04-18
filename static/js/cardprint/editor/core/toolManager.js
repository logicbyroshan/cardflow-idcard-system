(function () {
  'use strict';

  function createToolManager(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    function getActiveTool() {
      return String(d.state && d.state.draftTool || 'select');
    }

    function setActiveTool(toolName) {
      if (!d.state) {
        return 'select';
      }
      var wanted = String(toolName || 'select').toLowerCase();
      if (wanted !== 'select' && wanted !== 'text' && wanted !== 'photo' && wanted !== 'rectangle') {
        wanted = 'select';
      }
      d.state.draftTool = wanted;
      return wanted;
    }

    return {
      getActiveTool: getActiveTool,
      setActiveTool: setActiveTool,
    };
  }

  window.GcEditorToolManager = {
    create: createToolManager,
  };
})();
