(function () {
  'use strict';

  function createStageEventBindings(deps) {
    var d = deps && typeof deps === 'object' ? deps : {};
    var listeners = [];

    function on(target, type, handler, options) {
      if (!target || typeof target.addEventListener !== 'function') {
        return;
      }
      target.addEventListener(type, handler, options || false);
      listeners.push(function () {
        target.removeEventListener(type, handler, options || false);
      });
    }

    function clearDragOverRows(flowRoot) {
      Array.prototype.forEach.call(flowRoot.querySelectorAll('[data-layer-row="1"].is-drag-over'), function (el) {
        el.classList.remove('is-drag-over');
      });
    }

    function bind() {
      var flowRoot = d.flowRoot;
      var win = d.windowObj || window;
      if (!flowRoot || !win) {
        return function () {};
      }

      on(flowRoot, 'dragstart', function (event) {
        if (d.state.step !== 2) {
          return;
        }
        var row = event.target && event.target.closest
          ? event.target.closest('[data-layer-row="1"]')
          : null;
        if (!row) {
          return;
        }
        var id = String(row.getAttribute('data-el-id') || '');
        if (!id) {
          return;
        }
        d.state.draftLayerDragId = id;
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', id);
        }
      });

      on(flowRoot, 'dragover', function (event) {
        if (d.state.step !== 2 || !d.state.draftLayerDragId) {
          return;
        }
        var row = event.target && event.target.closest
          ? event.target.closest('[data-layer-row="1"]')
          : null;
        if (!row) {
          return;
        }
        event.preventDefault();
        row.classList.add('is-drag-over');
      });

      on(flowRoot, 'dragleave', function (event) {
        var row = event.target && event.target.closest
          ? event.target.closest('[data-layer-row="1"]')
          : null;
        if (!row) {
          return;
        }
        row.classList.remove('is-drag-over');
      });

      on(flowRoot, 'drop', function (event) {
        if (d.state.step !== 2) {
          return;
        }
        var row = event.target && event.target.closest
          ? event.target.closest('[data-layer-row="1"]')
          : null;
        if (!row) {
          return;
        }

        event.preventDefault();
        var sourceId = String(d.state.draftLayerDragId || '');
        if (!sourceId && event.dataTransfer) {
          sourceId = String(event.dataTransfer.getData('text/plain') || '');
        }
        var targetId = String(row.getAttribute('data-el-id') || '');
        if (!sourceId || !targetId || sourceId === targetId) {
          d.state.draftLayerDragId = '';
          row.classList.remove('is-drag-over');
          return;
        }

        var rect = row.getBoundingClientRect();
        var placeAfter = Number(event.clientY || 0) > (rect.top + (rect.height / 2));
        if (d.reorderDraftLayerByIds(sourceId, targetId, placeAfter)) {
          d.render();
        }

        d.state.draftLayerDragId = '';
        clearDragOverRows(flowRoot);
      });

      on(flowRoot, 'dragend', function () {
        d.state.draftLayerDragId = '';
        clearDragOverRows(flowRoot);
      });

      on(flowRoot, 'wheel', function (event) {
        if (d.state.step !== 2 || event.ctrlKey || !event.altKey) {
          return;
        }

        var stage = event.target && event.target.closest
          ? event.target.closest('.gc-step2-canvas-stage')
          : null;
        if (!stage) {
          return;
        }

        d.applySmoothZoomFromWheel(event);
        event.preventDefault();
        d.renderStep2OnNextFrame();
      }, { passive: false });

      on(flowRoot, 'mouseover', function (event) {
        if (d.state.step !== 2) {
          return;
        }
        var btn = event.target && event.target.closest
          ? event.target.closest('[data-action="align-selected"]')
          : null;
        if (!btn) {
          return;
        }
        var mode = String(btn.getAttribute('data-mode') || '').toLowerCase();
        if (d.state.draftAlignPreviewMode === mode) {
          return;
        }
        d.state.draftAlignPreviewMode = mode;
        d.render();
      });

      on(flowRoot, 'mouseout', function (event) {
        if (d.state.step !== 2 || !d.state.draftAlignPreviewMode) {
          return;
        }
        var fromBtn = event.target && event.target.closest
          ? event.target.closest('[data-action="align-selected"]')
          : null;
        if (!fromBtn) {
          return;
        }
        var toBtn = event.relatedTarget && event.relatedTarget.closest
          ? event.relatedTarget.closest('[data-action="align-selected"]')
          : null;
        if (toBtn) {
          return;
        }
        d.state.draftAlignPreviewMode = '';
        d.render();
      });

      on(win, 'wheel', function (event) {
        if (!d.modalEl || d.modalEl.classList.contains('hidden') || !event.ctrlKey) {
          return;
        }

        var target = event.target;
        var inModal = target && target.closest ? target.closest('#gcEditorModal') : null;
        if (!inModal) {
          return;
        }

        var stage = target && target.closest ? target.closest('.gc-step2-canvas-stage') : null;
        if (stage && d.state.step === 2) {
          d.applySmoothZoomFromWheel(event);
          d.renderStep2OnNextFrame();
        }

        event.preventDefault();
      }, { passive: false, capture: true });

      return unbind;
    }

    function unbind() {
      listeners.splice(0).forEach(function (dispose) {
        try {
          dispose();
        } catch (_err) {
          // Ignore teardown failures.
        }
      });
    }

    return {
      bind: bind,
      unbind: unbind,
    };
  }

  window.GcEditorStageEventBindings = {
    create: createStageEventBindings,
  };
})();
