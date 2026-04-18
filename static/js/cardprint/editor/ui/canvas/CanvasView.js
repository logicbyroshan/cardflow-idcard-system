(function () {
  'use strict';

  function renderCanvasView(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};
    return d.renderCanvasHtml ? d.renderCanvasHtml() : '';
  }

  window.GcEditorCanvasView = {
    render: renderCanvasView,
  };
})();
