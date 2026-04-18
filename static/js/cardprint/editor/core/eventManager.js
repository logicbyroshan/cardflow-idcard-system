(function () {
  'use strict';

  function createEventManager(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};
    var cleanups = [];

    function on(target, type, handler, options) {
      if (!target || typeof target.addEventListener !== 'function') {
        return;
      }
      target.addEventListener(type, handler, options || false);
      cleanups.push(function () {
        target.removeEventListener(type, handler, options || false);
      });
    }

    function teardown() {
      cleanups.splice(0).forEach(function (fn) {
        try {
          fn();
        } catch (_err) {
          // Ignore cleanup failures.
        }
      });
    }

    return {
      on: on,
      teardown: teardown,
      deps: d,
    };
  }

  window.GcEditorEventManager = {
    create: createEventManager,
  };
})();
