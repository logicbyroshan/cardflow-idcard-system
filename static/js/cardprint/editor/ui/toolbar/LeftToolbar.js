(function () {
  'use strict';

  function renderLeftToolbar(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};
    return d.renderLeftToolbarHtml ? d.renderLeftToolbarHtml() : '';
  }

  window.GcEditorLeftToolbar = {
    render: renderLeftToolbar,
  };
})();
