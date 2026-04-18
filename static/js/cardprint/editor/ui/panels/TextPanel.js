(function () {
  'use strict';

  function renderTextPanel(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};
    return d.renderTextPanelHtml ? d.renderTextPanelHtml() : '';
  }

  window.GcEditorTextPanel = {
    render: renderTextPanel,
  };
})();
