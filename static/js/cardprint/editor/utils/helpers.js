(function () {
  'use strict';

  function noop() {}

  function toNumber(value, fallback) {
    var v = Number(value);
    if (!Number.isFinite(v)) {
      return Number(fallback || 0);
    }
    return v;
  }

  window.GcEditorHelpers = {
    noop: noop,
    toNumber: toNumber,
  };
})();
