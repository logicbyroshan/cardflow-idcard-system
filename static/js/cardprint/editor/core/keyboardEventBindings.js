(function () {
  'use strict';

  function createKeyboardEventBindings(deps) {
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

      on(flowRoot, 'keydown', function (event) {
        var target = event.target;
        if (!target || !target.classList || !target.classList.contains('gc-draft-inline-editor')) {
          return;
        }

        var mode = String(target.getAttribute('data-text-mode') || 'artistic').toLowerCase();
        if (event.key === 'Enter' && mode !== 'paragraph') {
          event.preventDefault();
          target.blur();
        }
      });

      on(flowRoot, 'input', function (event) {
        var target = event.target;
        if (target && target.id === 'gcDraftTemplateNameModalInput') {
          d.state.draftSaveTemplateName = String(target.value || '').slice(0, 120);
          if (d.state.draftSaveTemplateError && d.state.draftSaveTemplateName.trim()) {
            d.state.draftSaveTemplateError = '';
          }
          return;
        }

        if (!target || !target.classList || !target.classList.contains('gc-draft-inline-editor')) {
          return;
        }

        var elId = String(target.getAttribute('data-inline-editor-id') || '');
        if (!elId) {
          return;
        }

        if (!d.state.draftInlineEditHistoryActive) {
          d.beginDraftHistoryTransaction();
          d.state.draftInlineEditHistoryActive = true;
        }

        var nextText = String(typeof target.innerText === 'string' ? target.innerText : (target.textContent || ''));
        d.updateDraftTextLabelById(elId, nextText.replace(/\r\n?/g, '\n'));
      });

      on(flowRoot, 'focusout', function (event) {
        var target = event.target;
        if (!target || !target.classList || !target.classList.contains('gc-draft-inline-editor')) {
          return;
        }

        if (d.state.draftInlineEditHistoryActive) {
          d.endDraftHistoryTransaction();
          d.state.draftInlineEditHistoryActive = false;
        }

        if (!d.state.draftInlineEditingElementId) {
          return;
        }

        d.state.draftInlineEditingElementId = '';
        d.render();
      });

      on(win, 'keydown', function (event) {
        if (!d.isStep2EditorActive()) {
          return;
        }

        var key = String(event.key || '');
        var code = String(event.code || '');

        if (d.state.draftSaveModalOpen) {
          if (key === 'Escape') {
            d.closeSaveTemplateModal();
            event.preventDefault();
            d.render();
            return;
          }
          if (key === 'Enter' && !event.shiftKey) {
            var modalInput = flowRoot.querySelector('#gcDraftTemplateNameModalInput');
            var modalValue = String(modalInput && modalInput.value || d.state.draftSaveTemplateName || '').trim();
            if (!modalValue) {
              d.state.draftSaveTemplateError = 'Template name is required.';
              event.preventDefault();
              d.render();
              return;
            }
            d.state.draftSaveTemplateError = '';
            d.closeSaveTemplateModal();
            d.triggerSaveDraftTemplate(modalValue);
            event.preventDefault();
            return;
          }
        }

        if ((key === ' ' || key === 'Spacebar') && !d.isTypingTarget(event.target)) {
          if (!d.state.spacePanMode) {
            d.state.spacePanMode = true;
            d.setSpacePanUiState();
          }
          event.preventDefault();
          return;
        }

        var ctrlOrMeta = !!(event.ctrlKey || event.metaKey);
        if (d.state.zoomWheelMode !== ctrlOrMeta) {
          d.state.zoomWheelMode = ctrlOrMeta;
          d.setSpacePanUiState();
        }

        if (d.isTypingTarget(event.target)) {
          return;
        }

        var lower = key.toLowerCase();
        var bracketRight = key === ']' || code === 'BracketRight';
        var bracketLeft = key === '[' || code === 'BracketLeft';
        var handled = false;

        if (d.state.draftAutoMapReportOpen && key === 'Escape') {
          d.state.draftAutoMapReportOpen = false;
          event.preventDefault();
          d.render();
          return;
        }

        if (ctrlOrMeta && !event.altKey && bracketRight) {
          handled = d.moveSelectedDraftLayers(event.shiftKey ? 'front' : 'forward');
        } else if (ctrlOrMeta && !event.altKey && bracketLeft) {
          handled = d.moveSelectedDraftLayers(event.shiftKey ? 'back' : 'backward');
        } else if (ctrlOrMeta && event.altKey && !event.shiftKey && lower === 'l') {
          d.toggleDraftUiPanel('layers');
          handled = true;
        } else if (ctrlOrMeta && event.altKey && !event.shiftKey && lower === 'a') {
          d.toggleDraftUiPanel('align');
          handled = true;
        } else if (ctrlOrMeta && event.altKey && !event.shiftKey && lower === 'm') {
          d.toggleDraftUiPanel('merge');
          handled = true;
        } else if (ctrlOrMeta && event.altKey && !event.shiftKey && lower === 't') {
          d.toggleDraftUiPanel('text');
          handled = true;
        } else if (ctrlOrMeta && !event.altKey && lower === 'z') {
          handled = event.shiftKey ? d.redoDraftHistory() : d.undoDraftHistory();
        } else if (ctrlOrMeta && !event.altKey && lower === 'y') {
          handled = d.redoDraftHistory();
        } else if (ctrlOrMeta && !event.altKey && lower === 'b') {
          handled = d.toggleSelectedTextStyle('bold');
        } else if (ctrlOrMeta && !event.altKey && lower === 'i') {
          handled = d.toggleSelectedTextStyle('italic');
        } else if (ctrlOrMeta && !event.altKey && lower === 'k') {
          var activeForBreak = d.selectedDraftElement();
          if (activeForBreak && d.isArtisticDraftText(activeForBreak)) {
            handled = true;
            d.breakSelectedArtisticText();
          }
        } else if (!ctrlOrMeta && !event.altKey && (key === 'Delete' || key === 'Backspace')) {
          if (d.selectedDraftElement()) {
            d.removeDraftElement();
            handled = true;
          } else if (d.selectedDraftGuide()) {
            if (d.state.draftGuidesLocked) {
              d.showToast('Unlock guides first to remove them.', 'warning');
              handled = true;
            } else {
              handled = d.removeDraftGuideById(d.state.draftSelectedGuideId);
            }
          }
        } else if (!ctrlOrMeta && !event.altKey && key.indexOf('Arrow') === 0) {
          var step = event.shiftKey ? 10 : 1;
          if (key === 'ArrowLeft') {
            handled = d.nudgeSelectedDraftElement(-step, 0);
          } else if (key === 'ArrowRight') {
            handled = d.nudgeSelectedDraftElement(step, 0);
          } else if (key === 'ArrowUp') {
            handled = d.nudgeSelectedDraftElement(0, -step);
          } else if (key === 'ArrowDown') {
            handled = d.nudgeSelectedDraftElement(0, step);
          }
        } else if (!ctrlOrMeta && !event.altKey && lower === 'p') {
          handled = d.alignSelectedDraftElements('canvas-center');
        } else if (!ctrlOrMeta && !event.altKey && lower === 'e') {
          handled = d.alignSelectedDraftElements('align-v-center');
        } else if (!ctrlOrMeta && !event.altKey && lower === 'c') {
          handled = d.alignSelectedDraftElements('align-h-center');
        } else if (!ctrlOrMeta && !event.altKey && lower === 'l') {
          handled = d.alignSelectedDraftElements('align-left');
        } else if (!ctrlOrMeta && !event.altKey && lower === 'r') {
          handled = d.alignSelectedDraftElements('align-right');
        } else if (!ctrlOrMeta && !event.altKey && lower === 't') {
          handled = d.alignSelectedDraftElements('align-top');
        } else if (!ctrlOrMeta && !event.altKey && lower === 'b') {
          handled = d.alignSelectedDraftElements('align-bottom');
        } else if (!ctrlOrMeta && !event.altKey && key === 'Escape') {
          d.state.draftDragging = null;
          d.state.draftResizeDragging = null;
          d.state.draftGuideDragging = null;
          d.state.draftTextDrag = null;
          d.state.draftRectDrag = null;
          d.state.draftSelectDrag = null;
          d.state.draftLayerDragId = '';
          d.state.draftTransformMode = 'resize';
          d.state.draftAlignPreviewMode = '';
          if (d.state.draftInlineEditHistoryActive) {
            d.endDraftHistoryTransaction();
            d.state.draftInlineEditHistoryActive = false;
          }
          d.endDraftHistoryTransaction();
          d.clearDraftInlineTextEditing();
          d.state.draftTool = 'select';
          handled = true;
        } else if (ctrlOrMeta && !event.altKey && lower === 'd') {
          handled = d.duplicateSelectedDraftElement();
        } else if (ctrlOrMeta && !event.altKey && event.shiftKey && lower === 'v') {
          handled = d.pasteClipboardElements(true);
        } else if (ctrlOrMeta && !event.altKey && lower === 'c') {
          handled = d.copySelectedDraftElements();
        } else if (ctrlOrMeta && !event.altKey && lower === 'x') {
          handled = d.cutSelectedDraftElements();
        } else if (ctrlOrMeta && !event.altKey && lower === 'v') {
          handled = d.pasteClipboardElements(false);
        } else if (ctrlOrMeta && !event.altKey && lower === 's') {
          d.openSaveTemplateModal();
          handled = true;
        } else if (ctrlOrMeta && !event.altKey && (key === '+' || key === '=')) {
          d.applyZoomFactor(d.DRAFT_ZOOM_IN_FACTOR, null);
          handled = true;
        } else if (ctrlOrMeta && !event.altKey && (key === '-' || key === '_')) {
          d.applyZoomFactor(d.DRAFT_ZOOM_OUT_FACTOR, null);
          handled = true;
        } else if (ctrlOrMeta && !event.altKey && lower === '0') {
          d.setDraftZoomWithAnchor(1, null);
          handled = true;
        }

        if (!handled) {
          return;
        }

        event.preventDefault();
        d.render();
      });

      on(win, 'keyup', function (event) {
        if (!d.isStep2EditorActive()) {
          return;
        }

        var key = String(event.key || '');
        if (!event.ctrlKey && !event.metaKey && d.state.zoomWheelMode) {
          d.state.zoomWheelMode = false;
          d.setSpacePanUiState();
        }

        if (key === ' ' || key === 'Spacebar') {
          if (d.state.spacePanMode || d.state.spacePanState) {
            d.state.spacePanMode = false;
            d.state.spacePanState = null;
            d.setSpacePanUiState();
          }
          event.preventDefault();
        }
      });

      on(win, 'blur', function () {
        if (!d.state.zoomWheelMode && !d.state.spacePanMode && !d.state.spacePanState) {
          return;
        }
        d.state.zoomWheelMode = false;
        d.state.spacePanMode = false;
        d.state.spacePanState = null;
        d.setSpacePanUiState();
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

  window.GcEditorKeyboardEventBindings = {
    create: createKeyboardEventBindings,
  };
})();
