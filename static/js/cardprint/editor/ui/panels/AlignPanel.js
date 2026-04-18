(function () {
  'use strict';

  function renderAlignPanel(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};
    return d.renderAlignPanelHtml ? d.renderAlignPanelHtml() : '';
  }

  window.GcEditorAlignPanel = {
    render: renderAlignPanel,
  };
})();
