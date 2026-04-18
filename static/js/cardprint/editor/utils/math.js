(function () {
  'use strict';

  function clamp(value, min, max) {
    var v = Number(value);
    if (!Number.isFinite(v)) {
      v = Number(min || 0);
    }
    return Math.max(Number(min || 0), Math.min(Number(max || 0), v));
  }

  function rectsIntersect(a, b) {
    if (!a || !b) {
      return false;
    }

    var aLeft = Number(a.x || 0);
    var aTop = Number(a.y || 0);
    var aRight = aLeft + Math.max(0, Number(a.width || 0));
    var aBottom = aTop + Math.max(0, Number(a.height || 0));
    var bLeft = Number(b.x || 0);
    var bTop = Number(b.y || 0);
    var bRight = bLeft + Math.max(0, Number(b.width || 0));
    var bBottom = bTop + Math.max(0, Number(b.height || 0));

    return aLeft <= bRight && aRight >= bLeft && aTop <= bBottom && aBottom >= bTop;
  }

  window.GcEditorMath = {
    clamp: clamp,
    rectsIntersect: rectsIntersect,
  };
})();
