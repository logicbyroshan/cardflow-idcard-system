(function () {
  'use strict';

  function byId(id) {
    return document.getElementById(String(id || ''));
  }

  function closest(target, selector) {
    if (!target || !selector || !target.closest) {
      return null;
    }
    return target.closest(selector);
  }

  window.GcEditorDom = {
    byId: byId,
    closest: closest,
  };
})();
