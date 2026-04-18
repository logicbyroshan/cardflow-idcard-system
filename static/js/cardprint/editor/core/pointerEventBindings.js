(function () {
  'use strict';

  function createPointerEventBindings(deps) {
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

    function bind() {
      var flowRoot = d.flowRoot;
      var win = d.windowObj || window;
      if (!flowRoot || !win) {
        return function () {};
      }

      on(flowRoot, 'dblclick', function (event) {
        var dblTarget = event.target && event.target.nodeType === 1
          ? event.target
          : (event.target && event.target.parentElement ? event.target.parentElement : null);
        if (!dblTarget || !dblTarget.closest) {
          return;
        }

        var guideEl = dblTarget.closest('.gc-draft-guide');
        if (guideEl) {
          if (d.state.draftGuidesLocked) {
            event.preventDefault();
            return;
          }
          var guideId = String(guideEl.getAttribute('data-guide-id') || '');
          if (guideId) {
            d.removeDraftGuideById(guideId);
            d.state.draftSelectedGuideId = '';
            event.preventDefault();
            d.render();
          }
          return;
        }

        if (d.state.step === 2 && d.state.draftTool === 'select') {
          var textEl = dblTarget.closest('.gc-draft-el.gc-draft-el-text');
          if (textEl && !dblTarget.closest('.gc-draft-selection-handle')) {
            var textId = String(textEl.getAttribute('data-el-id') || '');
            if (textId && d.setDraftInlineTextEditing(textId)) {
              d.state.draftPendingTextEdit = null;
              d.state.draftDragging = null;
              d.state.draftResizeDragging = null;
              event.preventDefault();
              d.render();
              return;
            }
          }

        }

        if (d.state.step !== 2) {
          return;
        }

        var canvasEl = dblTarget.closest('.gc-step2-canvas');
        if (!canvasEl || dblTarget !== canvasEl) {
          return;
        }

        if (d.state.draftTool === 'rectangle') {
          var rectPoint = d.canvasEventToDraftPoint(canvasEl, event);
          d.state.draftActiveSide = d.normalizeDraftEditorSide(rectPoint.side);
          var metrics = d.draftCanvasMetrics();
          var count = (d.state.templateDraft && d.state.templateDraft.elements ? d.state.templateDraft.elements.length : 0) + 1;
          d.addDraftElement('rectangle', {
            x: 0,
            y: 0,
            width: Number(metrics.width || 0),
            height: Number(metrics.height || 0),
            side: d.state.draftActiveSide,
            color: '#2563eb',
            label: 'Rectangle ' + String(count),
          });
          event.preventDefault();
          d.render();
          return;
        }

        if (d.state.draftTool !== 'photo') {
          return;
        }

        var point = d.canvasEventToDraftPoint(canvasEl, event);
        d.state.draftActiveSide = d.normalizeDraftEditorSide(point.side);
        d.addPhotoPlaceholderElement({
          atPoint: true,
          x: point.x,
          y: point.y,
          side: d.state.draftActiveSide,
        });
        d.state.draftTool = 'select';
        event.preventDefault();
        d.render();
      });

      on(win, 'mousemove', function (event) {
        if (d.state.step === 2) {
          var pointerTarget = event && event.target;
          var pointerInStage = pointerTarget && pointerTarget.closest
            ? pointerTarget.closest('.gc-step2-canvas-stage')
            : null;
          if (pointerInStage) {
            d.state.draftLastPointerClientX = Number(event.clientX || 0);
            d.state.draftLastPointerClientY = Number(event.clientY || 0);
          } else {
            d.state.draftLastPointerClientX = null;
            d.state.draftLastPointerClientY = null;
          }
        }

        var panState = d.state.spacePanState;
        if (panState) {
          var panStage = d.resolveStageContentEl(panState.stageEl);
          if (!panStage) {
            return;
          }
          panState.stageEl = panStage;
          var dx = Number(event.clientX || 0) - panState.startClientX;
          var dy = Number(event.clientY || 0) - panState.startClientY;
          panStage.scrollLeft = panState.startScrollLeft - dx;
          panStage.scrollTop = panState.startScrollTop - dy;
          return;
        }

        var resizeDrag = d.state.draftResizeDragging;
        if (resizeDrag) {
          d.applyDraftResizeDrag(resizeDrag, event);
          d.renderStep2OnNextFrame();
          return;
        }

        var guideDrag = d.state.draftGuideDragging;
        if (guideDrag) {
          if (d.state.draftGuidesLocked) {
            d.state.draftGuideDragging = null;
            d.renderStep2OnNextFrame();
            return;
          }
          var guideCanvas = d.resolveDraftCanvasEl(guideDrag.canvasEl);
          if (!guideCanvas) {
            return;
          }
          guideDrag.canvasEl = guideCanvas;
          var guidePoint = d.canvasEventToDraftPoint(guideCanvas, event, { allowOutside: true });
          var nextPos = guideDrag.axis === 'x' ? guidePoint.x : guidePoint.y;
          nextPos = d.snapCanvasValueToGrid(nextPos, guideDrag.axis);
          d.updateDraftGuidePosition(guideDrag.id, nextPos);
          d.renderStep2OnNextFrame();
          return;
        }

        var textDrag = d.state.draftTextDrag;
        if (textDrag) {
          var textCanvas = d.resolveDraftCanvasEl(textDrag.canvasEl);
          if (!textCanvas) {
            return;
          }
          textDrag.canvasEl = textCanvas;
          var livePoint = d.canvasEventToDraftPoint(textCanvas, event);
          textDrag.currentX = d.snapCanvasValueToGrid(livePoint.x, 'x');
          textDrag.currentY = d.snapCanvasValueToGrid(livePoint.y, 'y');
          d.renderStep2OnNextFrame();
          return;
        }

        var rectDrag = d.state.draftRectDrag;
        if (rectDrag) {
          var rectCanvas = d.resolveDraftCanvasEl(rectDrag.canvasEl);
          if (!rectCanvas) {
            return;
          }
          rectDrag.canvasEl = rectCanvas;
          var rectPoint = d.canvasEventToDraftPoint(rectCanvas, event, { allowOutside: true });
          rectDrag.currentX = d.snapCanvasValueToGrid(rectPoint.x, 'x');
          rectDrag.currentY = d.snapCanvasValueToGrid(rectPoint.y, 'y');
          rectDrag.lockSquare = !!event.shiftKey;
          d.renderStep2OnNextFrame();
          return;
        }

        var selectDrag = d.state.draftSelectDrag;
        if (selectDrag) {
          var selectCanvas = d.resolveDraftCanvasEl(selectDrag.canvasEl);
          if (!selectCanvas) {
            return;
          }
          selectDrag.canvasEl = selectCanvas;
          var selectPoint = d.canvasEventToDraftPoint(selectCanvas, event, { allowOutside: true });
          selectDrag.currentX = Number(selectPoint.x || selectDrag.startX || 0);
          selectDrag.currentY = Number(selectPoint.y || selectDrag.startY || 0);

          var liveSelectBox = d.draftDragBox(
            Number(selectDrag.startX || 0),
            Number(selectDrag.startY || 0),
            Number(selectDrag.currentX || selectDrag.startX || 0),
            Number(selectDrag.currentY || selectDrag.startY || 0),
            false
          );
          liveSelectBox.side = d.normalizeDraftEditorSide(selectDrag.side || d.state.draftActiveSide);
          if (liveSelectBox.width >= 2 || liveSelectBox.height >= 2) {
            d.selectDraftElementsByBox(
              liveSelectBox,
              !!selectDrag.appendSelection,
              'intersect',
              Array.isArray(selectDrag.baseSelectionIds) ? new Set(selectDrag.baseSelectionIds) : null
            );
          }
          d.renderStep2OnNextFrame();
          return;
        }

        var drag = d.state.draftDragging;
        if (!drag) {
          return;
        }

        var scaleX = drag.metrics.width / Math.max(1, d.draftCanvasSideDisplayWidthPx(drag.canvasRect));
        var scaleY = drag.metrics.height / Math.max(1, drag.canvasRect.height);
        var rawDx = (Number(event.clientX || 0) - drag.startMouseX) * scaleX;
        var rawDy = (Number(event.clientY || 0) - drag.startMouseY) * scaleY;

        if (Math.abs(rawDx) > 2 || Math.abs(rawDy) > 2) {
          drag.moved = true;
        }

        if (event.shiftKey) {
          if (!drag.lockAxis) {
            drag.lockAxis = Math.abs(rawDx) >= Math.abs(rawDy) ? 'x' : 'y';
          }
          if (drag.lockAxis === 'x') {
            rawDy = 0;
          } else if (drag.lockAxis === 'y') {
            rawDx = 0;
          }
        } else {
          drag.lockAxis = '';
        }

        var x = drag.startX + rawDx;
        var y = drag.startY + rawDy;
        x = d.snapCanvasValueToGrid(x, 'x');
        y = d.snapCanvasValueToGrid(y, 'y');

        if (d.state.draftPendingTextEdit && d.state.draftPendingTextEdit.id === drag.id) {
          var moveDx = Number(event.clientX || 0) - Number(d.state.draftPendingTextEdit.startMouseX || 0);
          var moveDy = Number(event.clientY || 0) - Number(d.state.draftPendingTextEdit.startMouseY || 0);
          if (Math.abs(moveDx) > 2 || Math.abs(moveDy) > 2) {
            d.state.draftPendingTextEdit.moved = true;
          }
        }

        if (Array.isArray(drag.dragIds) && drag.dragIds.length > 1 && drag.startPositions && typeof drag.startPositions === 'object') {
          var anchorStartX = Number(drag.startX || 0);
          var anchorStartY = Number(drag.startY || 0);
          var snappedAnchorX = d.snapCanvasValueToGrid(anchorStartX + rawDx, 'x');
          var snappedAnchorY = d.snapCanvasValueToGrid(anchorStartY + rawDy, 'y');
          var deltaX = snappedAnchorX - anchorStartX;
          var deltaY = snappedAnchorY - anchorStartY;

          d.ensureStep2DraftInitialized();
          d.prepareDraftHistoryMutation();
          var changed = false;
          d.state.templateDraft.elements = d.state.templateDraft.elements.map(function (item, idx) {
            if (!item) {
              return item;
            }
            var sid = String(item.__id || '');
            var startPos = drag.startPositions[sid];
            if (!startPos) {
              return item;
            }

            var draft = Object.assign({}, item);
            draft.x = Number(startPos.x || 0) + deltaX;
            draft.y = Number(startPos.y || 0) + deltaY;

            var normalized = d.normalizeDraftElement(draft, idx);
            normalized.__id = item.__id;
            changed = true;
            return normalized;
          });

          if (changed) {
            d.markDraftDirty();
            d.normalizeDraftElementSelection();
          }

          d.renderStep2OnNextFrame();
          return;
        }

        d.updateSelectedDraftElement({ x: x, y: y });
        d.renderStep2OnNextFrame();
      });

      on(win, 'mouseup', function (event) {
        if (d.state.spacePanState) {
          d.state.spacePanState = null;
          d.setSpacePanUiState();
          return;
        }

        if (d.state.draftResizeDragging) {
          d.state.draftResizeDragging = null;
          d.endDraftHistoryTransaction();
          d.render();
          return;
        }

        if (d.state.draftGuideDragging) {
          d.state.draftGuideDragging = null;
          d.endDraftHistoryTransaction();
          d.render();
          return;
        }

        if (d.state.draftTextDrag) {
          var td = d.state.draftTextDrag;
          var dx = Math.abs(Number(td.currentX || td.startX) - Number(td.startX || 0));
          var dy = Math.abs(Number(td.currentY || td.startY) - Number(td.startY || 0));
          var createdTextItem = null;

          if (dx >= 14 || dy >= 14) {
            createdTextItem = d.addDraftElement('text', {
              x: Math.min(Number(td.startX || 0), Number(td.currentX || td.startX || 0)),
              y: Math.min(Number(td.startY || 0), Number(td.currentY || td.startY || 0)),
              width: Math.max(36, dx),
              height: Math.max(20, dy),
              side: d.normalizeDraftEditorSide(td.side || d.state.draftActiveSide),
              textMode: 'paragraph',
              textAlign: 'left',
              label: '',
            });
          } else {
            createdTextItem = d.addDraftElement('text', {
              x: Number(td.startX || 0),
              y: Number(td.startY || 0),
              side: d.normalizeDraftEditorSide(td.side || d.state.draftActiveSide),
              textMode: 'artistic',
              textAlign: 'left',
              autoFitArtistic: true,
              label: '',
            });
          }

          if (createdTextItem && createdTextItem.__id && String(createdTextItem.textMode || '').toLowerCase() === 'artistic') {
            d.setDraftInlineTextEditing(createdTextItem.__id);
          }

          d.state.draftTextDrag = null;
          d.endDraftHistoryTransaction();
          d.render();
          return;
        }

        if (d.state.draftRectDrag) {
          var rd = d.state.draftRectDrag;
          var rectBox = d.draftDragBox(
            Number(rd.startX || 0),
            Number(rd.startY || 0),
            Number(rd.currentX || rd.startX || 0),
            Number(rd.currentY || rd.startY || 0),
            !!(event.shiftKey || rd.lockSquare)
          );
          var count = (d.state.templateDraft && d.state.templateDraft.elements ? d.state.templateDraft.elements.length : 0) + 1;

          if (rectBox.width >= 8 || rectBox.height >= 8) {
            d.addDraftElement('rectangle', {
              x: rectBox.x,
              y: rectBox.y,
              width: Math.max(12, rectBox.width),
              height: Math.max(12, rectBox.height),
              side: d.normalizeDraftEditorSide(rd.side || d.state.draftActiveSide),
              color: '#2563eb',
              label: 'Rectangle ' + String(count),
            });
          }

          d.state.draftRectDrag = null;
          d.endDraftHistoryTransaction();
          d.render();
          return;
        }

        if (d.state.draftSelectDrag) {
          var sd = d.state.draftSelectDrag;
          var selectBox = d.draftDragBox(
            Number(sd.startX || 0),
            Number(sd.startY || 0),
            Number(sd.currentX || sd.startX || 0),
            Number(sd.currentY || sd.startY || 0),
            false
          );
          selectBox.side = d.normalizeDraftEditorSide(sd.side || d.state.draftActiveSide);
          var clickOnly = selectBox.width < 3 && selectBox.height < 3;

          if (clickOnly) {
            if (!sd.appendSelection) {
              d.state.draftSelectedElementId = '';
              d.state.draftSelectedElementIds = new Set();
              d.state.draftSelectedGuideId = '';
              d.clearDraftInlineTextEditing();
            }
          } else {
            d.selectDraftElementsByBox(
              selectBox,
              !!sd.appendSelection,
              'intersect',
              Array.isArray(sd.baseSelectionIds) ? new Set(sd.baseSelectionIds) : null
            );
          }

          d.state.draftSelectDrag = null;
          d.endDraftHistoryTransaction();
          d.render();
          return;
        }

        if (!d.state.draftDragging) {
          d.endDraftHistoryTransaction();
          return;
        }
        d.state.draftDragging = null;
        d.endDraftHistoryTransaction();
        d.render();
      });

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

  window.GcEditorPointerEventBindings = {
    create: createPointerEventBindings,
  };
})();
