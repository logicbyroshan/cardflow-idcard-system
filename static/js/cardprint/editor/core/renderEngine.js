(function () {
  'use strict';

  function createRenderEngine(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};

    function renderNow() {
      if (typeof d.render === 'function') {
        d.render();
      }
    }

    function renderOnNextFrame() {
      if (typeof d.renderStep2OnNextFrame === 'function') {
        d.renderStep2OnNextFrame();
        return;
      }
      renderNow();
    }

    return {
      renderNow: renderNow,
      renderOnNextFrame: renderOnNextFrame,
    };
  }

  window.GcEditorRenderEngine = {
    create: createRenderEngine,
  };
})();
