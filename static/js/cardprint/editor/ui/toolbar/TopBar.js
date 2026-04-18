(function () {
  'use strict';

  function renderTopBar(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};
    return d.renderTopBarHtml ? d.renderTopBarHtml() : '';
  }

  window.GcEditorTopBar = {
    render: renderTopBar,
  };
})();
