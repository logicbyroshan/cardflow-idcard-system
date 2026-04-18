(function () {
  'use strict';

  function renderLayerPanel(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};
    return d.renderLayerPanelHtml ? d.renderLayerPanelHtml() : '';
  }

  window.GcEditorLayerPanel = {
    render: renderLayerPanel,
  };
})();
