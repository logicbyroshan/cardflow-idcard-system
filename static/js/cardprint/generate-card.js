/**
 * generate-card.js
 * Runs on the Generate Card editor page (generate-card.html).
 *
 * Globals injected by the template (before this script loads):
 *   TABLE_ID         {number}
 *   TABLE_NAME       {string}
 *   TEMPLATE_DATA    {object}   {is_two_sided, font_size, font_family, field_mappings: {front:{},back:{}}}
 *   FRONT_PDF_URL    {string}   may be ''
 *   BACK_PDF_URL     {string}   may be ''
 *   TABLE_FIELDS     {Array}    [{name, type}, ...]
 */

(function () {
  'use strict';

  /*  Constants  */
  const SCALE = 7; // px per mm
  const LANDSCAPE_W_MM = 87;
  const LANDSCAPE_H_MM = 57;
  const PORTRAIT_W_MM = 57;
  const PORTRAIT_H_MM = 87;

  /*  State  */
  let fabric_canvas = null;   // currently active Fabric.js canvas (front/back)
  let fabric_canvas_front = null;
  let fabric_canvas_back = null;
  let currentSide   = 'front';
  let isTwoSided    = false;
  let cardOrientation = 'landscape';

  // field_mappings: { front: { FieldName: {x_mm,y_mm,w_mm,h_mm} }, back: {...} }
  let fieldMappings = { front: {}, back: {} };
  let editableDesignModels = { front: null, back: null };
  let editableModeBySide = { front: false, back: false };
  let editableSelectedBlockBySide = { front: null, back: null };
  let pendingFieldToMapBySide = { front: '', back: '' };

  // cards currently in generate list (each: {pr_id, card_id, sr_no, ordered_fields})
  let genCards = [];
  let selectedPrIds = new Set();

  // Last generated output blob (PDF)
  let lastPdfBlob = null;
  let lastGeneratedFilename = 'generated_cards.pdf';
  let modalAlertTimer = null;
  let canvasInitInProgress = false;
  let editorBootstrapped = false;
  let activeRenderTicket = { front: 0, back: 0 };
  let overlayWatchdogTimer = null;
  let templatePersistedThisSession = false;
  let modalOpenBaselineTemplate = null;
  let pendingCloseCleanupPromise = Promise.resolve();
  let generatedPreviewActive = false;
  const GENERATE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
  const isInlineModalEditor = !!document.getElementById('gcEditorModal');
  const printApiBases = resolvePrintApiBases();

  function normalizeOrientation(value) {
    return value === 'portrait' ? 'portrait' : 'landscape';
  }

  function getCardWidthMm() {
    return cardOrientation === 'portrait' ? PORTRAIT_W_MM : LANDSCAPE_W_MM;
  }

  function getCardHeightMm() {
    return cardOrientation === 'portrait' ? PORTRAIT_H_MM : LANDSCAPE_H_MM;
  }

  function getCardWidthPx() {
    return getCardWidthMm() * SCALE;
  }

  function getCardHeightPx() {
    return getCardHeightMm() * SCALE;
  }

  function hasFrontPdf() {
    return !!String(FRONT_PDF_URL || '').trim();
  }

  function hasBackPdf() {
    return !!String(BACK_PDF_URL || '').trim();
  }

  function hasDesignPdfForSide(side) {
    return side === 'back' ? hasBackPdf() : hasFrontPdf();
  }

  function hasEditableDesignForSide(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    const hasLines = !!(model && Array.isArray(model.lines) && model.lines.length);
    const hasImages = !!(model && Array.isArray(model.images) && model.images.length);
    return !!editableModeBySide[targetSide] && (hasLines || hasImages);
  }

  function hasDesignAssetForSide(side) {
    return hasDesignPdfForSide(side) || hasEditableDesignForSide(side);
  }

  function getRenderableMappingsForSide(side) {
    if (!hasDesignAssetForSide(side)) return {};
    return (fieldMappings && fieldMappings[side]) || {};
  }

  function readFontSizeValue() {
    const el = document.getElementById('fontSizeInput');
    const fallback = parseInt(TEMPLATE_DATA && TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.font_size_pt, 10) || parseInt(TEMPLATE_DATA && TEMPLATE_DATA.font_size, 10) || 11;
    const v = el ? parseInt(el.value, 10) : fallback;
    return Math.min(72, Math.max(6, isNaN(v) ? 11 : v));
  }

  function readFontFamilyValue() {
    const el = document.getElementById('fontFamilySelect');
    const fallback = (TEMPLATE_DATA && TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.font_family) || (TEMPLATE_DATA && TEMPLATE_DATA.font_family) || 'Arial';
    const v = (el && el.value) ? String(el.value).trim() : String(fallback).trim();
    return v || 'Arial';
  }

  function readLineHeightValue() {
    const el = document.getElementById('lineHeightInput');
    const fallback = Number(TEMPLATE_DATA && TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.line_height) || 1.15;
    const v = el ? Number(el.value) : fallback;
    if (!Number.isFinite(v)) return 1.15;
    return Math.min(3, Math.max(0.8, v));
  }

  function readCharSpacingValue() {
    const el = document.getElementById('charSpacingInput');
    const fallback = Number(TEMPLATE_DATA && TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.char_spacing_pt) || 0;
    const v = el ? Number(el.value) : fallback;
    if (!Number.isFinite(v)) return 0;
    return Math.min(20, Math.max(-5, v));
  }

  function readFontWeightValue() {
    const el = document.getElementById('fontWeightSelect');
    const fallback = String(TEMPLATE_DATA && TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.font_weight || 'normal').toLowerCase();
    const v = String((el && el.value) ? el.value : fallback).toLowerCase();
    if (v === 'bold' || v === 'semibold') return v;
    return 'normal';
  }

  function normalizeHexColor(value) {
    const raw = String(value || '').trim();
    if (!raw) return '#111111';
    let v = raw.startsWith('#') ? raw.slice(1) : raw;
    if (/^[0-9a-fA-F]{3}$/.test(v)) {
      v = v.split('').map(function (ch) { return ch + ch; }).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(v)) return '#111111';
    return '#' + v.toUpperCase();
  }

  function readFontColorValue() {
    const picker = document.getElementById('fontColorInput');
    const textInput = document.getElementById('fontColorTextInput');
    const fallback = normalizeHexColor(TEMPLATE_DATA && TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.font_color_hex || '#111111');
    const source = (textInput && textInput.value) || (picker && picker.value) || fallback;
    return normalizeHexColor(source);
  }

  function updateDocxStylePreview() {
    const sample = document.getElementById('docxStylePreviewSample');
    const colorPicker = document.getElementById('fontColorInput');
    const colorText = document.getElementById('fontColorTextInput');
    if (!sample) return;

    const family = readFontFamilyValue();
    const size = readFontSizeValue();
    const lineHeight = readLineHeightValue();
    const spacing = readCharSpacingValue();
    const weight = readFontWeightValue();
    const color = readFontColorValue();

    if (colorPicker) colorPicker.value = color;
    if (colorText) colorText.value = color;

    sample.style.fontFamily = family;
    sample.style.fontSize = String(Math.min(30, Math.max(10, size))) + 'px';
    sample.style.lineHeight = String(lineHeight);
    sample.style.letterSpacing = String(spacing) + 'pt';
    sample.style.color = color;
    sample.style.fontWeight = weight === 'bold' ? '700' : (weight === 'semibold' ? '600' : '400');
  }

  function getCanvasForSide(side) {
    return side === 'back' ? fabric_canvas_back : fabric_canvas_front;
  }

  function setActiveCanvas(side) {
    const resolvedSide = (side === 'back' && getCanvasForSide('back')) ? 'back' : 'front';
    fabric_canvas = getCanvasForSide(resolvedSide) || getCanvasForSide('front');
    const frontWrap = document.getElementById('genCardWrapper');
    const backWrap = document.getElementById('genCardSecondaryWrapper');
    if (frontWrap) frontWrap.classList.toggle('gc-side-active', resolvedSide === 'front');
    if (backWrap) backWrap.classList.toggle('gc-side-active', resolvedSide === 'back');
  }

  function getEditableLayerElement(side) {
    return document.getElementById(side === 'back' ? 'genEditableLayerBack' : 'genEditableLayerFront');
  }

  function getPreviewWrapperElement(side) {
    return document.getElementById(side === 'back' ? 'genCardSecondaryWrapper' : 'genCardWrapper');
  }

  function getGeneratedPreviewLayer(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const wrapper = getPreviewWrapperElement(targetSide);
    if (!wrapper) return null;

    const layerId = targetSide === 'back' ? 'genGeneratedPreviewLayerBack' : 'genGeneratedPreviewLayerFront';
    let layer = document.getElementById(layerId);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = layerId;
      layer.className = 'gen-generated-preview-layer hidden';

      const img = document.createElement('img');
      img.className = 'gen-generated-preview-image';
      img.alt = targetSide + ' generated preview';
      layer.appendChild(img);

      wrapper.appendChild(layer);
    }

    const imageEl = layer.querySelector('img');
    return imageEl ? { layer: layer, img: imageEl } : null;
  }

  function hideGeneratedPreviewOnSide(side) {
    const entry = getGeneratedPreviewLayer(side);
    if (!entry) return;
    entry.img.removeAttribute('src');
    entry.layer.classList.add('hidden');
  }

  function clearGeneratedPreview() {
    hideGeneratedPreviewOnSide('front');
    hideGeneratedPreviewOnSide('back');
    generatedPreviewActive = false;
  }

  function showGeneratedPreviewOnSide(side, dataUrl) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const entry = getGeneratedPreviewLayer(targetSide);
    if (!entry || !dataUrl) return;
    entry.img.src = dataUrl;
    entry.layer.classList.remove('hidden');

    const noTplId = targetSide === 'back' ? 'noTemplateMsgSecondary' : 'noTemplateMsg';
    const noTpl = document.getElementById(noTplId);
    if (noTpl) noTpl.classList.add('hidden');
    generatedPreviewActive = true;
  }

  function renderPreviewPageToDataUrl(pdfDoc, pageNumber) {
    const pageNo = Number(pageNumber);
    if (!pdfDoc || !Number.isFinite(pageNo) || pageNo < 1 || pageNo > Number(pdfDoc.numPages || 0)) {
      return Promise.resolve('');
    }

    return pdfDoc.getPage(pageNo).then(function (page) {
      const targetW = getCardWidthPx();
      const targetH = getCardHeightPx();
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(targetW / viewport.width, targetH / viewport.height);
      const scaledVP = page.getViewport({ scale: scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(scaledVP.width));
      canvas.height = Math.max(1, Math.round(scaledVP.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable');

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      return page.render({ canvasContext: ctx, viewport: scaledVP }).promise.then(function () {
        try {
          return canvas.toDataURL('image/png');
        } catch (_e) {
          return '';
        }
      });
    });
  }

  function showGeneratedPreviewInMainArea(blob) {
    if (!blob) return Promise.reject(new Error('Preview file is empty'));

    const pdfLib = getPdfJsLib();
    if (!pdfLib || !ensurePdfWorkerConfigured()) {
      return Promise.reject(new Error('PDF viewer library failed to load'));
    }

    return blob.arrayBuffer()
      .then(function (ab) {
        return pdfLib.getDocument({ data: new Uint8Array(ab) }).promise;
      })
      .then(function (pdfDoc) {
        clearGeneratedPreview();
        return Promise.all([
          renderPreviewPageToDataUrl(pdfDoc, 1),
          (isTwoSided && Number(pdfDoc.numPages || 0) >= 2)
            ? renderPreviewPageToDataUrl(pdfDoc, 2)
            : Promise.resolve(''),
        ]).then(function (images) {
          const frontDataUrl = images[0] || '';
          const backDataUrl = images[1] || '';
          if (frontDataUrl) showGeneratedPreviewOnSide('front', frontDataUrl);
          if (backDataUrl) {
            showGeneratedPreviewOnSide('back', backDataUrl);
          } else {
            hideGeneratedPreviewOnSide('back');
          }
          if (pdfDoc && typeof pdfDoc.destroy === 'function') {
            try { pdfDoc.destroy(); } catch (_e) {}
          }
        });
      });
  }

  function ptToPx(pt) {
    const numeric = Number(pt);
    if (!Number.isFinite(numeric)) return 11 * (25.4 / 72) * SCALE;
    return numeric * (25.4 / 72) * SCALE;
  }

  function clearEditableDesignModel(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    clearEditableSelection(targetSide);
    editableModeBySide[targetSide] = false;
    editableDesignModels[targetSide] = null;
    const layer = getEditableLayerElement(targetSide);
    if (layer) {
      layer.innerHTML = '';
      layer.classList.add('hidden');
    }
  }

  function clearEditableSelection(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const prev = editableSelectedBlockBySide[targetSide];
    if (prev && prev.el && prev.el.classList) {
      prev.el.classList.remove('is-selected');
    }
    editableSelectedBlockBySide[targetSide] = null;
  }

  function setPendingFieldToMap(side, fieldName) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const value = String(fieldName || '').trim();
    pendingFieldToMapBySide[targetSide] = value;
  }

  function getPendingFieldToMap(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    return String(pendingFieldToMapBySide[targetSide] || '').trim();
  }

  function clearPendingFieldToMap(side) {
    setPendingFieldToMap(side, '');
  }

  function normalizeEditableDesignModel(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const lines = Array.isArray(raw.lines) ? raw.lines.filter(function (x) { return x && typeof x === 'object'; }) : [];
    const images = Array.isArray(raw.images) ? raw.images.filter(function (x) { return x && typeof x === 'object'; }) : [];
    if (!lines.length && !images.length) return null;
    return {
      engine: String(raw.engine || 'pymupdf-editable').slice(0, 50),
      page_mm: (raw.page_mm && typeof raw.page_mm === 'object') ? {
        width: Number(raw.page_mm.width || 0),
        height: Number(raw.page_mm.height || 0),
      } : null,
      lines: cloneDeep(lines),
      images: cloneDeep(images),
    };
  }

  function loadEditableDesignFromTemplate(template) {
    const frontModel = normalizeEditableDesignModel(template && template.editable_design_front);
    const backModel = normalizeEditableDesignModel(template && template.editable_design_back);

    editableDesignModels.front = frontModel;
    editableModeBySide.front = !!frontModel;
    editableDesignModels.back = backModel;
    editableModeBySide.back = !!backModel;
    clearEditableSelection('front');
    clearEditableSelection('back');
    clearPendingFieldToMap('front');
    clearPendingFieldToMap('back');
  }

  function buildEditableDesignPayloadForTemplate(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    if (!editableModeBySide[targetSide]) return null;
    return normalizeEditableDesignModel(editableDesignModels[targetSide]);
  }

  function tryMapPendingFieldToSelection(side, selection) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const selectedName = getPendingFieldToMap(targetSide);
    if (!selectedName) return false;
    if (!hasEditableDesignForSide(targetSide)) return false;

    const sel = selection || getEditableSelection(targetSide);
    if (!sel || !sel.el || !sel.el.isConnected) return false;

    const fieldObj = (TABLE_FIELDS || []).find(function (f) { return f.name === selectedName; });
    if (!fieldObj) {
      showToast('Selected field is not available.', 'warning');
      return false;
    }

    mapSelectedEditableBlockToField(targetSide, fieldObj, sel);
    clearPendingFieldToMap(targetSide);
    const fieldSelect = document.getElementById('fieldToPlaceSelect');
    if (fieldSelect) fieldSelect.value = '';
    return true;
  }

  function setEditableSelection(side, blockType, blockIndex, el) {
    const targetSide = side === 'back' ? 'back' : 'front';
    if (!el) {
      clearEditableSelection(targetSide);
      return;
    }
    const prev = editableSelectedBlockBySide[targetSide];
    if (prev && prev.el && prev.el !== el && prev.el.classList) {
      prev.el.classList.remove('is-selected');
    }
    editableSelectedBlockBySide[targetSide] = {
      type: blockType,
      index: Number(blockIndex),
      el: el,
    };
    el.classList.add('is-selected');

    if (blockType === 'line') {
      syncStyleInputsFromSelectedEditableLine(targetSide);
    }

    tryMapPendingFieldToSelection(targetSide, editableSelectedBlockBySide[targetSide]);
  }

  function getEditableSelection(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    return editableSelectedBlockBySide[targetSide] || null;
  }

  function getSelectedEditableLine(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const sel = getEditableSelection(targetSide);
    if (!sel || sel.type !== 'line' || !sel.el || !sel.el.isConnected) {
      return null;
    }
    return sel;
  }

  function isTypingElement(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (!el.closest) return false;
    return !!el.closest('input, textarea, select, [contenteditable="true"]');
  }

  function deleteSelectedEditableContent(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const sel = getEditableSelection(targetSide);
    if (!sel || !sel.el || !sel.el.isConnected) return false;

    const model = editableDesignModels[targetSide];
    if (!model) return false;

    if (sel.type === 'line') {
      if (!Array.isArray(model.lines) || !model.lines[sel.index]) return false;
      model.lines[sel.index].text = '';
      sel.el.textContent = '';
      return true;
    }

    if (sel.type === 'image') {
      if (!Array.isArray(model.images) || !model.images[sel.index]) return false;
      model.images.splice(sel.index, 1);
      clearEditableSelection(targetSide);
      renderEditableDesignLayer(targetSide);
      return true;
    }

    return false;
  }

  function onEditorKeydown(ev) {
    const key = String((ev && ev.key) || '').toLowerCase();
    if (key !== 'delete' && key !== 'backspace') return;
    if (!hasEditableDesignForSide(currentSide)) return;

    const sel = getEditableSelection(currentSide);
    if (!sel || !sel.el || !sel.el.isConnected) return;

    // When user is actively editing text, keep native delete/backspace behavior.
    if (sel.type === 'line' && sel.el.dataset && sel.el.dataset.editing === '1') {
      return;
    }
    if (isTypingElement(ev.target)) return;

    const changed = deleteSelectedEditableContent(currentSide);
    if (!changed) return;
    ev.preventDefault();
    ev.stopPropagation();
    updateGenerateBtn();
  }

  function syncStyleInputsFromSelectedEditableLine(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const sel = getSelectedEditableLine(targetSide);
    if (!sel) return false;
    const model = editableDesignModels[targetSide];
    if (!model || !Array.isArray(model.lines) || !model.lines[sel.index]) return false;

    const line = model.lines[sel.index];
    const sizeInput = document.getElementById('fontSizeInput');
    const familyInput = document.getElementById('fontFamilySelect');
    const weightInput = document.getElementById('fontWeightSelect');
    const lhInput = document.getElementById('lineHeightInput');
    const csInput = document.getElementById('charSpacingInput');
    const colorInput = document.getElementById('fontColorInput');
    const colorTextInput = document.getElementById('fontColorTextInput');

    const linePt = clampNumber(line.font_size_pt, 6, 72, readFontSizeValue());
    const lineFamily = String(line.font_family || readFontFamilyValue() || 'Arial').trim() || 'Arial';
    const lineWeightRaw = String(line.font_weight || '400').toLowerCase();
    const lineWeight = (lineWeightRaw === '700' || lineWeightRaw === 'bold')
      ? 'bold'
      : ((lineWeightRaw === '600' || lineWeightRaw === 'semibold') ? 'semibold' : 'normal');
    const lineHeight = clampNumber(line.line_height, 0.8, 3, readLineHeightValue());
    const charSpacing = clampNumber(line.char_spacing_pt, -5, 20, readCharSpacingValue());
    const color = normalizeHexColor(line.font_color_hex || readFontColorValue());

    if (sizeInput) sizeInput.value = String(Math.round(linePt));
    if (familyInput) familyInput.value = lineFamily;
    if (weightInput) weightInput.value = lineWeight;
    if (lhInput) lhInput.value = String(lineHeight);
    if (csInput) csInput.value = String(charSpacing);
    if (colorInput) colorInput.value = color;
    if (colorTextInput) colorTextInput.value = color;

    updateDocxStylePreview();
    return true;
  }

  function applyStyleInputsToSelectedEditableLine(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const sel = getSelectedEditableLine(targetSide);
    if (!sel) return false;

    const model = editableDesignModels[targetSide];
    if (!model || !Array.isArray(model.lines) || !model.lines[sel.index]) return false;
    const line = model.lines[sel.index];
    const el = sel.el;

    const fontPt = readFontSizeValue();
    const fontPx = Math.max(8, ptToPx(fontPt));
    const family = readFontFamilyValue();
    const weightInput = readFontWeightValue();
    const weight = weightInput === 'bold' ? '700' : (weightInput === 'semibold' ? '600' : '400');
    const lineHeight = readLineHeightValue();
    const charSpacing = readCharSpacingValue();
    const color = readFontColorValue();

    el.style.fontSize = fontPx + 'px';
    el.style.fontFamily = family;
    el.style.fontWeight = weight;
    el.style.lineHeight = String(lineHeight);
    el.style.letterSpacing = String(charSpacing) + 'pt';
    el.style.color = color;

    line.font_size_pt = Math.round(fontPt * 100) / 100;
    line.font_family = family;
    line.font_weight = weight;
    line.line_height = Math.round(lineHeight * 100) / 100;
    line.char_spacing_pt = Math.round(charSpacing * 100) / 100;
    line.font_color_hex = color;
    return true;
  }

  function readEditableElementRectMm(el) {
    if (!el) {
      return { x_mm: 0, y_mm: 0, w_mm: 0, h_mm: 0 };
    }
    const leftPx = Number(parseFloat(el.style.left));
    const topPx = Number(parseFloat(el.style.top));
    const widthPx = Number(parseFloat(el.style.width));
    const heightPx = Number(parseFloat(el.style.height));

    const safeLeft = Number.isFinite(leftPx) ? leftPx : 0;
    const safeTop = Number.isFinite(topPx) ? topPx : 0;
    const safeWidth = Number.isFinite(widthPx) ? widthPx : Number(el.offsetWidth || 10);
    const safeHeight = Number.isFinite(heightPx)
      ? heightPx
      : Number(parseFloat(el.style.minHeight) || el.offsetHeight || 8);

    return {
      x_mm: safeLeft / SCALE,
      y_mm: safeTop / SCALE,
      w_mm: safeWidth / SCALE,
      h_mm: safeHeight / SCALE,
    };
  }

  function persistEditableBlockPosition(side, blockType, blockIndex, el) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    if (!model) return;
    const rect = readEditableElementRectMm(el);
    if (blockType === 'line' && Array.isArray(model.lines) && model.lines[blockIndex]) {
      model.lines[blockIndex].x_mm = Math.round(rect.x_mm * 100) / 100;
      model.lines[blockIndex].y_mm = Math.round(rect.y_mm * 100) / 100;
      // Keep original extracted text-box size for line mapping precision.
      // The editor may visually expand width for readability, but mappings must
      // remain tied to the real PDF line box.
      if (!Number.isFinite(Number(model.lines[blockIndex].w_mm))) {
        model.lines[blockIndex].w_mm = Math.round(rect.w_mm * 100) / 100;
      }
      if (!Number.isFinite(Number(model.lines[blockIndex].h_mm))) {
        model.lines[blockIndex].h_mm = Math.round(rect.h_mm * 100) / 100;
      }
    }
    if (blockType === 'image' && Array.isArray(model.images) && model.images[blockIndex]) {
      model.images[blockIndex].x_mm = Math.round(rect.x_mm * 100) / 100;
      model.images[blockIndex].y_mm = Math.round(rect.y_mm * 100) / 100;
      model.images[blockIndex].w_mm = Math.round(rect.w_mm * 100) / 100;
      model.images[blockIndex].h_mm = Math.round(rect.h_mm * 100) / 100;
    }
  }

  function wireEditableBlockInteractions(el, side, blockType, blockIndex) {
    if (!el || el.__gcEditableBound) return;
    el.__gcEditableBound = true;

    let drag = null;

    function stopDrag() {
      if (!drag) return;
      drag = null;
      persistEditableBlockPosition(side, blockType, blockIndex, el);
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
    }

    function onDragMove(ev) {
      if (!drag) return;
      const cardW = getCardWidthPx();
      const cardH = getCardHeightPx();
      const nextLeft = Math.max(0, Math.min(cardW - drag.widthPx, drag.leftPx + (ev.clientX - drag.startX)));
      const nextTop = Math.max(0, Math.min(cardH - drag.heightPx, drag.topPx + (ev.clientY - drag.startY)));
      el.style.left = nextLeft + 'px';
      el.style.top = nextTop + 'px';
    }

    function onDragEnd() {
      stopDrag();
    }

    el.addEventListener('click', function (ev) {
      setEditableSelection(side, blockType, blockIndex, el);
      ev.stopPropagation();
    });

    el.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0) return;
      if (blockType === 'line' && el.dataset.editing === '1') return;
      setEditableSelection(side, blockType, blockIndex, el);

      const leftPx = Number(parseFloat(el.style.left));
      const topPx = Number(parseFloat(el.style.top));
      const widthPx = Number(parseFloat(el.style.width));
      const heightPx = Number(parseFloat(el.style.height) || parseFloat(el.style.minHeight));
      drag = {
        startX: ev.clientX,
        startY: ev.clientY,
        leftPx: Number.isFinite(leftPx) ? leftPx : 0,
        topPx: Number.isFinite(topPx) ? topPx : 0,
        widthPx: Number.isFinite(widthPx) ? widthPx : Number(el.offsetWidth || 10),
        heightPx: Number.isFinite(heightPx) ? heightPx : Number(el.offsetHeight || 8),
      };
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
      ev.preventDefault();
      ev.stopPropagation();
    });

    if (blockType === 'line') {
      el.addEventListener('dblclick', function (ev) {
        el.dataset.editing = '1';
        el.classList.add('is-editing');
        el.setAttribute('contenteditable', 'true');
        setEditableSelection(side, blockType, blockIndex, el);
        try {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } catch (_e) {
          // no-op
        }
        ev.preventDefault();
        ev.stopPropagation();
      });

      el.addEventListener('blur', function () {
        if (el.dataset.editing === '1') {
          el.dataset.editing = '0';
          el.classList.remove('is-editing');
          el.setAttribute('contenteditable', 'false');
          if (editableDesignModels[side] && Array.isArray(editableDesignModels[side].lines) && editableDesignModels[side].lines[blockIndex]) {
            editableDesignModels[side].lines[blockIndex].text = el.textContent || '';
          }
        }
      });

      el.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          el.blur();
          return;
        }
        if (ev.key === 'Enter' && el.dataset.editing === '1') {
          ev.preventDefault();
          el.blur();
        }
      });
    }
  }

  function renderEditableDesignLayer(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const layer = getEditableLayerElement(targetSide);
    if (!layer) return;

    const model = editableDesignModels[targetSide];
    const enabled = !!editableModeBySide[targetSide] && !!model;
    if (!enabled) {
      layer.innerHTML = '';
      layer.classList.add('hidden');
      return;
    }

    const lines = Array.isArray(model.lines) ? model.lines : [];
    const images = Array.isArray(model.images) ? model.images : [];
    const cardW = getCardWidthPx();
    const rightMarginPx = 5 * SCALE;

    layer.innerHTML = '';
    layer.onmousedown = function (ev) {
      if (ev.target === layer) {
        clearEditableSelection(targetSide);
      }
    };

    images.forEach(function (imgBlock, imgIdx) {
      if (!imgBlock || !imgBlock.data_url) return;
      const img = document.createElement('img');
      img.className = 'gen-editable-image';
      img.alt = 'design-image';
      img.src = imgBlock.data_url;
      img.style.left = (Number(imgBlock.x_mm || 0) * SCALE) + 'px';
      img.style.top = (Number(imgBlock.y_mm || 0) * SCALE) + 'px';
      img.style.width = Math.max(2, Number(imgBlock.w_mm || 2) * SCALE) + 'px';
      img.style.height = Math.max(2, Number(imgBlock.h_mm || 2) * SCALE) + 'px';
      const selectedImage = getEditableSelection(targetSide);
      if (selectedImage && selectedImage.type === 'image' && selectedImage.index === imgIdx) {
        img.classList.add('is-selected');
        selectedImage.el = img;
      }
      wireEditableBlockInteractions(img, targetSide, 'image', imgIdx);
      layer.appendChild(img);
    });

    lines.forEach(function (line, idx) {
      const node = document.createElement('div');
      node.className = 'gen-editable-line';
      node.setAttribute('contenteditable', 'false');
      node.setAttribute('spellcheck', 'false');
      node.dataset.idx = String(idx);
      node.textContent = String(line && line.text || '');

      const xPx = Math.max(0, Number(line && line.x_mm || 0) * SCALE);
      const yPx = Math.max(0, Number(line && line.y_mm || 0) * SCALE);
      const wPx = Math.max(8, Number(line && line.w_mm || 8) * SCALE);
      const hPx = Math.max(8, Number(line && line.h_mm || 8) * SCALE);
      const maxToRightPx = Math.max(12, cardW - xPx - rightMarginPx);
      const textAlignRaw = String(line && line.text_align || 'left').toLowerCase();
      const textAlign = (textAlignRaw === 'center' || textAlignRaw === 'right') ? textAlignRaw : 'left';
      let effectiveLeftPx = xPx;
      let effectiveWidthPx = wPx;

      if (textAlign === 'left') {
        // Keep previous anti-wrap behavior for normal left-aligned paragraphs.
        effectiveWidthPx = Math.max(12, Math.min(maxToRightPx, Math.max(wPx, maxToRightPx)));
      } else if (textAlign === 'center') {
        // Preserve optical center by expanding width around the original line center.
        const centerPx = xPx + (wPx / 2);
        const desiredWidth = Math.max(wPx, Math.min(cardW - (2 * rightMarginPx), Math.max(wPx * 1.6, 120)));
        effectiveWidthPx = Math.max(12, desiredWidth);
        effectiveLeftPx = Math.max(0, Math.min(cardW - effectiveWidthPx, centerPx - (effectiveWidthPx / 2)));
      } else {
        // Preserve right edge anchor for right-aligned lines.
        const rightEdge = xPx + wPx;
        const desiredWidth = Math.max(wPx, Math.min(cardW - rightMarginPx, Math.max(wPx * 1.3, 100)));
        effectiveWidthPx = Math.max(12, desiredWidth);
        effectiveLeftPx = Math.max(0, Math.min(cardW - effectiveWidthPx, rightEdge - effectiveWidthPx));
      }

      const fontPx = Math.max(8, ptToPx(line && line.font_size_pt));
      const fontFamily = String(line && line.font_family || 'Arial').trim() || 'Arial';
      const fontWeight = String(line && line.font_weight || '400').trim() || '400';
      const lineHeight = clampNumber(line && line.line_height, 0.8, 3, 1.05);
      const charSpacing = clampNumber(line && line.char_spacing_pt, -5, 20, 0);
      const fontColor = normalizeHexColor(line && line.font_color_hex || '#111111');

      node.style.left = effectiveLeftPx + 'px';
      node.style.top = yPx + 'px';
      node.style.width = effectiveWidthPx + 'px';
      node.style.height = hPx + 'px';
      node.style.minHeight = hPx + 'px';
      node.style.fontSize = fontPx + 'px';
      node.style.fontFamily = fontFamily;
      node.style.fontWeight = fontWeight;
      node.style.lineHeight = String(lineHeight);
      node.style.letterSpacing = String(charSpacing) + 'pt';
      node.style.color = fontColor;
      node.style.textAlign = textAlign;
      node.dataset.editing = '0';

      node.addEventListener('input', function () {
        const i = Number(this.dataset.idx);
        if (!Number.isInteger(i) || !editableDesignModels[targetSide] || !editableDesignModels[targetSide].lines || !editableDesignModels[targetSide].lines[i]) return;
        editableDesignModels[targetSide].lines[i].text = this.textContent || '';
      });

      const selectedLine = getEditableSelection(targetSide);
      if (selectedLine && selectedLine.type === 'line' && selectedLine.index === idx) {
        node.classList.add('is-selected');
        selectedLine.el = node;
      }

      wireEditableBlockInteractions(node, targetSide, 'line', idx);

      layer.appendChild(node);
    });

    const noTplId = targetSide === 'back' ? 'noTemplateMsgSecondary' : 'noTemplateMsg';
    const noTpl = document.getElementById(noTplId);
    if (noTpl) noTpl.classList.add('hidden');

    layer.classList.remove('hidden');
  }

  function applyCanvasDimensions() {
    const w = getCardWidthPx();
    const h = getCardHeightPx();
    const wrapper = document.getElementById('genCardWrapper');
    if (wrapper) {
      wrapper.style.width = w + 'px';
      wrapper.style.height = h + 'px';
    }

    const canvasEl = document.getElementById('genCardCanvas');
    if (canvasEl) {
      canvasEl.style.width = w + 'px';
      canvasEl.style.height = h + 'px';
    }

    const secondaryCanvasEl = document.getElementById('genCardSecondaryCanvas');
    if (secondaryCanvasEl) {
      secondaryCanvasEl.style.width = w + 'px';
      secondaryCanvasEl.style.height = h + 'px';
    }

    const secondaryWrapper = document.getElementById('genCardSecondaryWrapper');
    if (secondaryWrapper) {
      secondaryWrapper.style.width = w + 'px';
      secondaryWrapper.style.height = h + 'px';
    }

    if (fabric_canvas_front) {
      fabric_canvas_front.setDimensions({ width: w, height: h });
      fabric_canvas_front.calcOffset();
      fabric_canvas_front.renderAll();
    }
    if (fabric_canvas_back) {
      fabric_canvas_back.setDimensions({ width: w, height: h });
      fabric_canvas_back.calcOffset();
      fabric_canvas_back.renderAll();
    }

    renderEditableDesignLayer('front');
    renderEditableDesignLayer('back');
  }

  function countMappedFields(side) {
    return Object.keys(getRenderableMappingsForSide(side)).length;
  }

  function hasRequiredMappings() {
    const frontCount = countMappedFields('front');
    const backCount = countMappedFields('back');
    return frontCount > 0 && (!isTwoSided || backCount > 0);
  }

  function updateSetupStatus() {
    const setupEl = document.getElementById('genSetupStatus');
    const frontAssetOk = hasDesignAssetForSide('front');
    const backNeeded = isTwoSided;
    const backAssetOk = !backNeeded || hasDesignAssetForSide('back');
    const frontMapped = countMappedFields('front');
    const backMapped = countMappedFields('back');

    if (setupEl) {
      const sideText = isTwoSided ? '2-Sided' : '1-Sided';
      const orientText = cardOrientation === 'portrait' ? 'Vertical' : 'Horizontal';
      const designText = backNeeded
        ? (frontAssetOk && backAssetOk ? 'Design layer: front + back ready.' : 'Design layer: upload and convert front + back.')
        : (frontAssetOk ? 'Design layer: front ready.' : 'Design layer: upload and convert front.');
      const mappingText = backNeeded
        ? ('Format fields: Front ' + frontMapped + ', Back ' + backMapped + '.')
        : ('Format fields: Front ' + frontMapped + '.');
      setupEl.textContent = 'Setup: ' + sideText + ' | ' + orientText + ' | ' + designText + ' ' + mappingText;
    }

    syncUploadButtons();
  }

  function syncUploadButtons() {
    const uploadFrontWrapper = document.getElementById('uploadFrontWrapper');
    const uploadBackWrapper = document.getElementById('uploadBackWrapper');
    const removeFrontBtn = document.getElementById('removeFrontPdfBtn');
    const removeBackBtn = document.getElementById('removeBackPdfBtn');

    const frontReady = hasFrontPdf();
    const backReady = hasBackPdf();

    // Design PDF actions.
    if (uploadFrontWrapper) uploadFrontWrapper.classList.toggle('hidden', frontReady);
    if (removeFrontBtn) removeFrontBtn.classList.toggle('hidden', !frontReady);

    if (uploadBackWrapper) uploadBackWrapper.classList.toggle('hidden', !isTwoSided || backReady);
    if (removeBackBtn) removeBackBtn.classList.toggle('hidden', !isTwoSided || !backReady);
  }

  function resolvePrintApiBases() {
    const out = [];
    const seen = {};

    function add(base) {
      if (!base || typeof base !== 'string') return;
      const clean = base.replace(/\/+$/, '');
      if (!clean || seen[clean]) return;
      seen[clean] = true;
      out.push(clean);
    }

    if (typeof window.PRINT_BASE_PATH === 'string' && window.PRINT_BASE_PATH.trim()) {
      add(window.PRINT_BASE_PATH.trim());
    }

    const path = window.location.pathname || '';
    const panelIdx = path.indexOf('/panel/print/');
    if (panelIdx >= 0) {
      add('/panel/print');
    }

    const printIdx = path.indexOf('/print/');
    if (printIdx >= 0) {
      add(path.slice(0, printIdx + '/print'.length));
    }

    // Final fallbacks for mixed local/prod routing setups.
    add('/panel/print');
    add('/print');

    return out;
  }

  function joinUrl(base, relPath) {
    const p = (relPath || '').startsWith('/') ? relPath : ('/' + relPath);
    return base + p;
  }

  function filenameFromContentDisposition(disposition, fallbackName) {
    const raw = String(disposition || '');
    const utfMatch = raw.match(/filename\*=UTF-8''([^;]+)/i);
    if (utfMatch && utfMatch[1]) return decodeURIComponent(utfMatch[1]).replace(/\"/g, '');
    const plainMatch = raw.match(/filename="?([^";]+)"?/i);
    if (plainMatch && plainMatch[1]) return plainMatch[1].trim();
    return fallbackName;
  }

  function fetchFromPrintApi(relPath, options) {
    let i = 0;
    let lastError = null;

    function next() {
      if (i >= printApiBases.length) {
        if (lastError) return Promise.reject(lastError);
        return Promise.reject(new Error('Print API route not found for ' + relPath));
      }

      const base = printApiBases[i++];
      const url = joinUrl(base, relPath);
      return fetch(url, options)
        .then(function (res) {
          if (res.status === 404) {
            lastError = new Error('404 at ' + url);
            return next();
          }
          return res;
        })
        .catch(function (err) {
          lastError = err;
          return next();
        });
    }

    return next();
  }

  function parseJsonResponse(response, fallbackMessage) {
    const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
    if (contentType.indexOf('application/json') === -1) {
      return response.text().then(function () {
        throw new Error(fallbackMessage || 'Unexpected server response');
      });
    }
    return response.json();
  }

  function cloneDeep(obj) {
    try {
      return JSON.parse(JSON.stringify(obj || {}));
    } catch (_e) {
      return {};
    }
  }

  function rectOverlapRatio(ax, ay, aw, ah, bx, by, bw, bh) {
    const ax2 = ax + aw;
    const ay2 = ay + ah;
    const bx2 = bx + bw;
    const by2 = by + bh;
    const interW = Math.max(0, Math.min(ax2, bx2) - Math.max(ax, bx));
    const interH = Math.max(0, Math.min(ay2, by2) - Math.max(ay, by));
    const interArea = interW * interH;
    const areaA = Math.max(0.0001, aw * ah);
    return interArea / areaA;
  }

  function withSourceLineIndices(rawMappings) {
    const out = cloneDeep(rawMappings || { front: {}, back: {} });
    ['front', 'back'].forEach(function (side) {
      const sideMap = (out && out[side] && typeof out[side] === 'object') ? out[side] : {};
      const model = editableDesignModels[side];
      const lines = (model && Array.isArray(model.lines)) ? model.lines : [];
      const hasLines = lines.length > 0;

      Object.keys(sideMap).forEach(function (fieldName) {
        const mapping = sideMap[fieldName];
        if (!mapping || typeof mapping !== 'object') return;

        const hasExplicitSourceIdx = Object.prototype.hasOwnProperty.call(mapping, 'source_line_idx') && mapping.source_line_idx !== '';
        const existingIdx = Number(mapping.source_line_idx);
        if (Number.isInteger(existingIdx) && existingIdx >= 0 && existingIdx < lines.length) {
          const mx0 = Number(mapping.x_mm || 0);
          const my0 = Number(mapping.y_mm || 0);
          const mw0 = Math.max(0.5, Number(mapping.w_mm || 1));
          const mh0 = Math.max(0.5, Number(mapping.h_mm || 1));
          const curr = lines[existingIdx] || {};
          const cx0 = Number(curr.x_mm || 0);
          const cy0 = Number(curr.y_mm || 0);
          const cw0 = Math.max(0.5, Number(curr.w_mm || 1));
          const ch0 = Math.max(0.5, Number(curr.h_mm || 1));
          const overlap0 = rectOverlapRatio(cx0, cy0, cw0, ch0, mx0, my0, mw0, mh0);
          const dx0 = Math.abs(cx0 - mx0) / Math.max(1, mw0);
          const dy0 = Math.abs(cy0 - my0) / Math.max(1, mh0);
          const score0 = (overlap0 * 1.7) - (dx0 * 0.8) - (dy0 * 1.35);
          const reliable0 = overlap0 >= 0.16 || (score0 > -0.12 && dy0 <= 0.55);
          if (reliable0) return;
          mapping.source_line_idx = null;
          return;
        }
        if (!hasLines) {
          mapping.source_line_idx = null;
          return;
        }

        if (hasExplicitSourceIdx) {
          mapping.source_line_idx = null;
          return;
        }

        const mx = Number(mapping.x_mm || 0);
        const my = Number(mapping.y_mm || 0);
        const mw = Math.max(0.5, Number(mapping.w_mm || 1));
        const mh = Math.max(0.5, Number(mapping.h_mm || 1));

        let bestIdx = -1;
        let bestScore = -Infinity;
        lines.forEach(function (line, idx) {
          if (!line || typeof line !== 'object') return;
          const lx = Number(line.x_mm || 0);
          const ly = Number(line.y_mm || 0);
          const lw = Math.max(0.5, Number(line.w_mm || 1));
          const lh = Math.max(0.5, Number(line.h_mm || 1));
          const overlap = rectOverlapRatio(lx, ly, lw, lh, mx, my, mw, mh);
          const dx = Math.abs(lx - mx) / Math.max(1, mw);
          const dy = Math.abs(ly - my) / Math.max(1, mh);
          const score = (overlap * 1.7) - (dx * 0.8) - (dy * 1.35);
          if (score > bestScore) {
            bestScore = score;
            bestIdx = idx;
          }
        });

        if (bestIdx >= 0) {
          const bestLine = lines[bestIdx] || {};
          const bx = Number(bestLine.x_mm || 0);
          const by = Number(bestLine.y_mm || 0);
          const bw = Math.max(0.5, Number(bestLine.w_mm || 1));
          const bh = Math.max(0.5, Number(bestLine.h_mm || 1));
          const bestOverlap = rectOverlapRatio(bx, by, bw, bh, mx, my, mw, mh);
          const dy = Math.abs(by - my) / Math.max(1, mh);
          // Only backfill missing indices on strong geometric matches.
          const reliable = bestOverlap >= 0.55 && bestScore >= 0.2 && dy <= 0.25;
          mapping.source_line_idx = reliable ? bestIdx : null;
        } else {
          mapping.source_line_idx = null;
        }
      });
    });
    return out;
  }

  function describePdfLoadError(err) {
    const msg = (err && err.message) ? String(err.message) : '';
    if (!msg) return 'Unknown error';
    if (/Unexpected server response/i.test(msg)) return 'Server returned an unexpected response while reading the PDF';
    if (/Missing PDF|InvalidPDF|corrupt/i.test(msg)) return 'The uploaded file could not be parsed as a valid PDF';
    if (/password/i.test(msg)) return 'Password-protected PDFs are not supported';
    return msg;
  }

  function loadPdfDocument(resolvedUrl) {
    const pdfLib = getPdfJsLib();
    if (!pdfLib) return Promise.reject(new Error('PDF library unavailable'));

    function fetchPdfBytes(url) {
      return fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      }).then(function (resp) {
        if (!resp.ok) {
          throw new Error('HTTP ' + resp.status + ' while fetching PDF');
        }
        const ct = (resp.headers.get('Content-Type') || '').toLowerCase();
        if (ct && ct.indexOf('pdf') === -1) {
          return resp.text().then(function (body) {
            const preview = String(body || '').replace(/\s+/g, ' ').slice(0, 120);
            throw new Error('Non-PDF response (' + ct + ') ' + preview);
          });
        }
        return resp.arrayBuffer();
      });
    }

    function workerFailure(err) {
      const msg = (err && err.message) ? String(err.message) : '';
      return /worker|fake worker|workerSrc|Cannot load script/i.test(msg);
    }

    // Primary path: let PDF.js fetch directly by URL.
    return pdfLib.getDocument({ url: resolvedUrl, withCredentials: true }).promise
      .catch(function (firstErr) {
        // Fallback path: fetch bytes ourselves and pass data buffer to PDF.js.
        // This avoids issues with range/cookie/proxy quirks on some setups.
        return fetchPdfBytes(resolvedUrl).then(function (buf) {
          return pdfLib.getDocument({ data: new Uint8Array(buf) }).promise;
        }).catch(function (fallbackErr) {
          // Last fallback: render without worker to bypass worker script loading issues.
          if (workerFailure(firstErr) || workerFailure(fallbackErr)) {
            return fetchPdfBytes(resolvedUrl).then(function (buf2) {
              return pdfLib.getDocument({ data: new Uint8Array(buf2), disableWorker: true }).promise;
            }).catch(function (finalErr) {
              const compositeFinal = new Error(
                'URL load failed: ' + describePdfLoadError(firstErr) +
                ' | Fallback failed: ' + describePdfLoadError(fallbackErr) +
                ' | No-worker failed: ' + describePdfLoadError(finalErr)
              );
              throw compositeFinal;
            });
          }

          const composite = new Error(
            'URL load failed: ' + describePdfLoadError(firstErr) + ' | Fallback failed: ' + describePdfLoadError(fallbackErr)
          );
          throw composite;
        });
      });
  }

  /*  PDF.js worker  */
  let pdfWorkerConfigured = false;
  function getPdfJsLib() {
    return (typeof window.pdfjsLib !== 'undefined') ? window.pdfjsLib : null;
  }
  function ensurePdfWorkerConfigured() {
    const lib = getPdfJsLib();
    if (!lib) return false;
    if (pdfWorkerConfigured) return true;

    const workerFromLocal = '/static/js/vendor/pdf.worker.min.js';
    const workerFromCdn = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const workerFromUnpkg = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const workerFromCdnJs = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const loadedScript = Array.from(document.querySelectorAll('script[src]')).find(function(s) {
      const src = String(s.getAttribute('src') || s.src || '');
      if (!/pdf(\.min)?\.js/i.test(src)) return false;
      return /\/static\/js\/vendor\/pdf\.min\.js/i.test(src) ||
        /pdfjs-dist/i.test(src) ||
        /cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js/i.test(src);
    });
    const loadedSrc = loadedScript ? loadedScript.src : '';
    // Default to local worker so local/dev works even without internet.
    let workerSrc = workerFromLocal;
    if (/unpkg\.com\/pdfjs-dist/i.test(loadedSrc)) {
      workerSrc = workerFromUnpkg;
    } else if (/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js/i.test(loadedSrc)) {
      workerSrc = workerFromCdnJs;
    } else if (/cdn\.jsdelivr\.net\/npm\/pdfjs-dist/i.test(loadedSrc)) {
      workerSrc = workerFromCdn;
    }
    lib.GlobalWorkerOptions.workerSrc = workerSrc;
    pdfWorkerConfigured = true;
    return true;
  }

  ensurePdfWorkerConfigured();

  function isCanvasReady(side) {
    const canvas = side ? getCanvasForSide(side) : fabric_canvas;
    return !!(canvas && typeof canvas.getObjects === 'function');
  }

  function getConfiguredFields(side) {
    const cfg = (typeof FIELD_CONFIG !== 'undefined') ? FIELD_CONFIG : {};
    const names = (side === 'front') ? (cfg.front_fields || []) : (cfg.back_fields || []);
    if (Array.isArray(names) && names.length > 0) {
      return TABLE_FIELDS.filter(f => names.indexOf(f.name) >= 0);
    }
    return TABLE_FIELDS.slice();
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeMatchText(raw) {
    return String(raw || '')
      .toLowerCase()
      .replace(/\(.*?\)/g, ' ')
      .replace(/[_\-]+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /*  DOM READY  */
  document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('genCardCanvas')) {
      return;
    }
    // In print-cards page, the editor is inside a hidden modal.
    // Do not initialize/render in background; bootstrap only when modal opens.
    if (isInlineModalEditor) {
      return;
    }

    bootstrapEditor();
    if (hasEditableDesignForSide('front')) {
      clearCanvasBackground('front');
      renderEditableDesignLayer('front');
    } else if (FRONT_PDF_URL) {
      renderPdf(FRONT_PDF_URL, 0, 'front');
    }
    if (isTwoSided) {
      if (hasEditableDesignForSide('back')) {
        clearCanvasBackground('back');
        renderEditableDesignLayer('back');
      } else if (BACK_PDF_URL) {
        renderPdf(BACK_PDF_URL, 0, 'back');
      }
    }
  });

  function bootstrapEditor() {
    if (editorBootstrapped) return;
    initFabric();
    populateFieldDropdown();
    loadState();
    bindEvents();
    loadCardList();
    editorBootstrapped = true;
  }

  function syncTemplateFromServer() {
    return fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/template/?_=' + Date.now(), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    .then(function(r) {
      if (!r.ok) {
        return parseJsonResponse(r, 'Template fetch failed').then(function(data) {
          throw new Error((data && (data.message || data.error)) || 'Template fetch failed');
        });
      }
      return parseJsonResponse(r, 'Template fetch failed');
    })
    .then(function(data) {
      if (!data || data.status !== 'ok' || !data.template) {
        throw new Error((data && (data.message || data.error)) || 'Template fetch failed');
      }
      return data.template;
    });
  }

  function applyTemplateState(template) {
    if (!template) return;
    exitDrawMode();
    clearGeneratedPreview();
    clearEditableDesignModel('front');
    clearEditableDesignModel('back');

    if (typeof TEMPLATE_DATA === 'object' && TEMPLATE_DATA) {
      TEMPLATE_DATA.is_two_sided = !!template.is_two_sided;
      TEMPLATE_DATA.field_mappings = template.field_mappings || { front: {}, back: {} };
      TEMPLATE_DATA.font_size = template.font_size || TEMPLATE_DATA.font_size;
      TEMPLATE_DATA.font_family = template.font_family || TEMPLATE_DATA.font_family;
      TEMPLATE_DATA.card_orientation = normalizeOrientation(template.card_orientation || TEMPLATE_DATA.card_orientation);
      TEMPLATE_DATA.front_fields = Array.isArray(template.front_fields) ? template.front_fields : (TEMPLATE_DATA.front_fields || []);
      TEMPLATE_DATA.back_fields = Array.isArray(template.back_fields) ? template.back_fields : (TEMPLATE_DATA.back_fields || []);
    }

    if (typeof FIELD_CONFIG === 'object' && FIELD_CONFIG) {
      if (Array.isArray(template.front_fields)) FIELD_CONFIG.front_fields = template.front_fields;
      if (Array.isArray(template.back_fields)) FIELD_CONFIG.back_fields = template.back_fields;
      FIELD_CONFIG.is_two_sided = !!template.is_two_sided;
      FIELD_CONFIG.card_orientation = normalizeOrientation(template.card_orientation || FIELD_CONFIG.card_orientation);
    }

    FRONT_PDF_URL = (typeof template.front_pdf_url === 'string') ? template.front_pdf_url : '';
    BACK_PDF_URL = (typeof template.back_pdf_url === 'string') ? template.back_pdf_url : '';

    fieldMappings.front = (template.field_mappings && template.field_mappings.front) || {};
    fieldMappings.back  = (template.field_mappings && template.field_mappings.back) || {};
    loadEditableDesignFromTemplate(template);
    if (!hasDesignAssetForSide('front')) fieldMappings.front = {};
    if (!hasDesignAssetForSide('back')) fieldMappings.back = {};

    const fs = parseInt(template.font_size, 10);
    const fontSizeInput = document.getElementById('fontSizeInput');
    if (!isNaN(fs) && fontSizeInput) {
      const styleFs = Number(template.docx_style && template.docx_style.font_size_pt);
      const effectiveFs = Number.isFinite(styleFs) ? styleFs : fs;
      fontSizeInput.value = Math.min(72, Math.max(6, effectiveFs));
    }
    const fontFamilySelect = document.getElementById('fontFamilySelect');
    if (fontFamilySelect) {
      const styleFamily = String((template.docx_style && template.docx_style.font_family) || template.font_family || '').trim();
      if (styleFamily) fontFamilySelect.value = styleFamily;
    }
    const lineHeightInput = document.getElementById('lineHeightInput');
    if (lineHeightInput) {
      const lh = Number(template.docx_style && template.docx_style.line_height);
      lineHeightInput.value = Number.isFinite(lh) ? Math.min(3, Math.max(0.8, lh)) : 1.15;
    }
    const charSpacingInput = document.getElementById('charSpacingInput');
    if (charSpacingInput) {
      const cs = Number(template.docx_style && template.docx_style.char_spacing_pt);
      charSpacingInput.value = Number.isFinite(cs) ? Math.min(20, Math.max(-5, cs)) : 0;
    }
    const fontWeightSelect = document.getElementById('fontWeightSelect');
    if (fontWeightSelect) {
      const fw = String(template.docx_style && template.docx_style.font_weight || 'normal').toLowerCase();
      fontWeightSelect.value = (fw === 'bold' || fw === 'semibold') ? fw : 'normal';
    }
    const fontColorInput = document.getElementById('fontColorInput');
    const fontColorTextInput = document.getElementById('fontColorTextInput');
    const styleColor = normalizeHexColor(template.docx_style && template.docx_style.font_color_hex || '#111111');
    if (fontColorInput) fontColorInput.value = styleColor;
    if (fontColorTextInput) fontColorTextInput.value = styleColor;

    setOrientation(template.card_orientation || (TEMPLATE_DATA && TEMPLATE_DATA.card_orientation) || 'landscape', false);
    setTwoSided(!!template.is_two_sided, false);
    if (currentSide === 'back' && (!BACK_PDF_URL || !isTwoSided) && FRONT_PDF_URL) {
      currentSide = 'front';
      const frontSideBtn = document.getElementById('frontSideBtn');
      const backSideBtn = document.getElementById('backSideBtn');
      const activeSideLabel = document.getElementById('activeSideLabel');
      if (frontSideBtn) frontSideBtn.classList.add('active');
      if (backSideBtn) backSideBtn.classList.remove('active');
      if (activeSideLabel) activeSideLabel.textContent = 'Front';
    }
    setActiveCanvas(currentSide);

    renderPlacedFields();
    renderMappingsOnCanvas();
    updateSetupStatus();
    updateGenerateBtn();
    updateSideBySidePreview();
    updateDocxStylePreview();
  }

  /*  Expose public API for the modal in print-cards.html  */
  // Called when the modal opens: refreshes the card list and re-renders the PDF
  window.gcEditorRefresh = function (frontUrl, backUrl) {
    resetGeneratedOutput();
    templatePersistedThisSession = false;
    modalOpenBaselineTemplate = null;

    bootstrapEditor();

    if (frontUrl) FRONT_PDF_URL = frontUrl;
    if (backUrl)  BACK_PDF_URL  = backUrl;

    // Wait for close-cleanup completion, then pull latest saved template.
    pendingCloseCleanupPromise
      .catch(function(err) {
        console.warn('[gcEditorRefresh] prior close cleanup warning:', err && err.message ? err.message : err);
      })
      .then(function () {
        return syncTemplateFromServer()
          .then(function(template) {
            applyTemplateState(template);
            modalOpenBaselineTemplate = cloneDeep(template || {});
          })
          .catch(function(err) {
            console.warn('[gcEditorRefresh] Using local template state:', err && err.message ? err.message : err);
            modalOpenBaselineTemplate = {
              is_two_sided: isTwoSided,
              card_orientation: cardOrientation,
              field_mappings: cloneDeep(fieldMappings),
              font_size: readFontSizeValue(),
              font_family: readFontFamilyValue(),
              front_pdf_url: FRONT_PDF_URL || '',
              back_pdf_url: BACK_PDF_URL || '',
              has_front_pdf: hasFrontPdf(),
              has_back_pdf: hasBackPdf(),
              front_fields: (typeof FIELD_CONFIG === 'object' && FIELD_CONFIG && Array.isArray(FIELD_CONFIG.front_fields)) ? cloneDeep(FIELD_CONFIG.front_fields) : [],
              back_fields: (typeof FIELD_CONFIG === 'object' && FIELD_CONFIG && Array.isArray(FIELD_CONFIG.back_fields)) ? cloneDeep(FIELD_CONFIG.back_fields) : [],
            };
          });
      })
      .finally(function() {
        // Rebuild side-aware field options from latest runtime FIELD_CONFIG.
        const latestCfg = (typeof FIELD_CONFIG !== 'undefined') ? FIELD_CONFIG : {};
        if (typeof latestCfg.is_two_sided !== 'undefined') {
          setTwoSided(!!latestCfg.is_two_sided, true);
        }
        if (latestCfg.card_orientation) {
          setOrientation(latestCfg.card_orientation, false);
        }
        populateFieldDropdown();

        // The Fabric canvas may have been created while the modal was hidden
        // (display:none), so getBoundingClientRect returned zeros and internal
        // offsets are wrong. Recalculate after the modal is visible.
        requestAnimationFrame(function () {
          if (!isCanvasReady('front')) initFabric();
          applyCanvasDimensions();
          setActiveCanvas(currentSide === 'back' ? 'back' : 'front');

          loadCardList();

          if (hasEditableDesignForSide('front')) {
            clearCanvasBackground('front');
            renderEditableDesignLayer('front');
          } else if (FRONT_PDF_URL) {
            setTimeout(function () { renderPdf(FRONT_PDF_URL, 0, 'front'); }, 80);
          } else {
            clearCanvasBackground('front');
          }

          if (isTwoSided) {
            if (hasEditableDesignForSide('back')) {
              clearCanvasBackground('back');
              renderEditableDesignLayer('back');
            } else if (BACK_PDF_URL) {
              setTimeout(function () { renderPdf(BACK_PDF_URL, 0, 'back'); }, 100);
            } else {
              clearCanvasBackground('back');
            }
          } else {
            clearCanvasBackground('back');
          }

          updateSetupStatus();
        });
      });
  };

  // Download the last generated output blob (triggered by footer download button)
  window.gcDownloadLastPdf = function () {
    if (!lastPdfBlob) return;
    const url = URL.createObjectURL(lastPdfBlob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = lastGeneratedFilename || ('cards-' + (TABLE_NAME || 'output').replace(/[^a-z0-9_-]/gi, '_') + '.pdf');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  window.gcEditorBeforeClose = function () {
    resetGeneratedOutput();
    pendingCloseCleanupPromise = clearTransientUploadedPdfsOnClose();
    return pendingCloseCleanupPromise;
  };

  function resetGeneratedOutput() {
    lastPdfBlob = null;
    lastGeneratedFilename = 'generated_cards.pdf';
    const dlBtn = document.getElementById('gcDownloadPdfBtn');
    if (dlBtn) {
      dlBtn.disabled = true;
      dlBtn.classList.add('opacity-50');
    }
  }

  /*  Fabric.js canvas init  */
  function initFabric() {
    const hasFront = isCanvasReady('front');
    const hasBackNode = !!document.getElementById('genCardSecondaryCanvas');
    const hasBack = hasBackNode ? isCanvasReady('back') : true;
    if ((hasFront && hasBack) || canvasInitInProgress) return;
    if (!document.getElementById('genCardCanvas')) {
      return;
    }

    if (typeof fabric === 'undefined') {
      // CDN script can be late; avoid failing fast and retry a few times.
      let tries = 0;
      canvasInitInProgress = true;
      const waitForFabric = function () {
        if (typeof fabric !== 'undefined') {
          canvasInitInProgress = false;
          initFabric();
          return;
        }
        tries += 1;
        if (tries >= 150) {
          canvasInitInProgress = false;
          showToast('Canvas library failed to load. Please refresh and try again.', 'error');
          return;
        }
        setTimeout(waitForFabric, 200);
      };
      waitForFabric();
      return;
    }

    canvasInitInProgress = true;
    applyCanvasDimensions();
    fabric_canvas_front = new fabric.Canvas('genCardCanvas', {
      width:             getCardWidthPx(),
      height:            getCardHeightPx(),
      selection:         false,
      preserveObjectStacking: true,
    });

    fabric_canvas_front.calcOffset();
  bindCanvasInteraction(fabric_canvas_front);

    const secondaryCanvas = document.getElementById('genCardSecondaryCanvas');
    if (secondaryCanvas) {
      fabric_canvas_back = new fabric.Canvas('genCardSecondaryCanvas', {
        width:             getCardWidthPx(),
        height:            getCardHeightPx(),
        selection:         false,
        preserveObjectStacking: true,
      });

      fabric_canvas_back.calcOffset();
      bindCanvasInteraction(fabric_canvas_back);
    }

    setActiveCanvas(currentSide === 'back' ? 'back' : 'front');
    canvasInitInProgress = false;
  }

  function bindCanvasInteraction(canvas) {
    if (!canvas || canvas.__gcBound) return;
    canvas.__gcBound = true;
    canvas.on('object:modified', onMappingObjectModified);
  }

  function onMappingObjectModified(evt) {
    const target = evt && evt.target;
    if (!target || !target.__isMappingRect) return;

    const side = target.__mappingSide === 'back' ? 'back' : 'front';
    const fieldName = String(target.__fieldName || '').trim();
    if (!fieldName) return;

    const cardW = getCardWidthPx();
    const cardH = getCardHeightPx();
    const scaledW = Math.max(4, target.getScaledWidth());
    const scaledH = Math.max(4, target.getScaledHeight());

    let left = Number(target.left || 0);
    let top = Number(target.top || 0);
    left = Math.max(0, Math.min(cardW - scaledW, left));
    top = Math.max(0, Math.min(cardH - scaledH, top));

    target.set({
      left: left,
      top: top,
      width: scaledW,
      height: scaledH,
      scaleX: 1,
      scaleY: 1,
    });

    fieldMappings[side] = fieldMappings[side] || {};
    const prev = (fieldMappings[side][fieldName] && typeof fieldMappings[side][fieldName] === 'object')
      ? fieldMappings[side][fieldName]
      : {};
    fieldMappings[side][fieldName] = Object.assign({}, prev, {
      x_mm: left / SCALE,
      y_mm: top / SCALE,
      w_mm: scaledW / SCALE,
      h_mm: scaledH / SCALE,
    });

    renderMappingsOnSide(side);
    renderPlacedFields();
    updateGenerateBtn();
    updateSetupStatus();
  }

  /*  Populate field dropdown from TABLE_FIELDS (filtered by FIELD_CONFIG)  */
  function populateFieldDropdown() {
    const sel = document.getElementById('fieldToPlaceSelect');
    if (!sel) return;
    // Remove existing options except the first placeholder
    while (sel.options.length > 1) sel.remove(1);

    const cfg = (typeof FIELD_CONFIG !== 'undefined') ? FIELD_CONFIG : {};
    const allowedNames = (currentSide === 'front')
      ? (cfg.front_fields || [])
      : (cfg.back_fields || []);

    // If field_config has selections, only show those; otherwise show all
    const fields = allowedNames.length > 0
      ? TABLE_FIELDS.filter(f => allowedNames.indexOf(f.name) >= 0)
      : TABLE_FIELDS;

    fields.forEach(function (f) {
      const opt  = document.createElement('option');
      opt.value  = f.name;
      const isPhoto = f.type && (f.type === 'photo' || f.type.includes('photo'));
      opt.textContent = f.name + (isPhoto ? ' [IMG]' : '');
      sel.appendChild(opt);
    });

    const pending = getPendingFieldToMap(currentSide);
    if (pending) sel.value = pending;
  }

  /*  Load template state from server-injected TEMPLATE_DATA  */
  function loadState() {
    exitDrawMode();
    isTwoSided = !!TEMPLATE_DATA.is_two_sided;
    const desiredOrientation = normalizeOrientation((TEMPLATE_DATA && TEMPLATE_DATA.card_orientation) || (typeof FIELD_CONFIG === 'object' && FIELD_CONFIG ? FIELD_CONFIG.card_orientation : '') || 'landscape');

    const fs = parseInt((TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.font_size_pt) || TEMPLATE_DATA.font_size) || 11;
    const fontSizeInput = document.getElementById('fontSizeInput');
    if (fontSizeInput) fontSizeInput.value = Math.min(72, Math.max(6, fs));

    const ff = (TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.font_family) || TEMPLATE_DATA.font_family || 'Arial';
    const fontFamilySelect = document.getElementById('fontFamilySelect');
    if (fontFamilySelect) fontFamilySelect.value = ff;

    const lineHeightInput = document.getElementById('lineHeightInput');
    if (lineHeightInput) {
      const lh = Number(TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.line_height);
      lineHeightInput.value = Number.isFinite(lh) ? Math.min(3, Math.max(0.8, lh)) : 1.15;
    }

    const charSpacingInput = document.getElementById('charSpacingInput');
    if (charSpacingInput) {
      const cs = Number(TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.char_spacing_pt);
      charSpacingInput.value = Number.isFinite(cs) ? Math.min(20, Math.max(-5, cs)) : 0;
    }

    const fontWeightSelect = document.getElementById('fontWeightSelect');
    if (fontWeightSelect) {
      const fw = String(TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.font_weight || 'normal').toLowerCase();
      fontWeightSelect.value = (fw === 'bold' || fw === 'semibold') ? fw : 'normal';
    }

    const fontColorInput = document.getElementById('fontColorInput');
    const fontColorTextInput = document.getElementById('fontColorTextInput');
    const styleColor = normalizeHexColor(TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.font_color_hex || '#111111');
    if (fontColorInput) fontColorInput.value = styleColor;
    if (fontColorTextInput) fontColorTextInput.value = styleColor;

    if (isTwoSided) {
      setTwoSided(true, false);
    } else {
      setTwoSided(false, false);
    }

    setOrientation(desiredOrientation, false);

    if (TEMPLATE_DATA.field_mappings) {
      fieldMappings.front = TEMPLATE_DATA.field_mappings.front || {};
      fieldMappings.back  = TEMPLATE_DATA.field_mappings.back  || {};
    }
    loadEditableDesignFromTemplate(TEMPLATE_DATA || {});
    if (!hasDesignAssetForSide('front')) fieldMappings.front = {};
    if (!hasDesignAssetForSide('back')) fieldMappings.back = {};
    setActiveCanvas(currentSide);

    renderMappingsOnCanvas();
    renderPlacedFields();
    updateSetupStatus();
    updateGenerateBtn();
    updateSideBySidePreview();
    updateDocxStylePreview();
  }

  /*  Bind UI events  */
  function bindEvents() {
    const singleSidedBtn = document.getElementById('singleSidedBtn');
    const twoSidedBtn = document.getElementById('twoSidedBtn');
    if (singleSidedBtn) singleSidedBtn.addEventListener('click', () => setTwoSided(false, true));
    if (twoSidedBtn) twoSidedBtn.addEventListener('click', () => setTwoSided(true, true));

    const landscapeBtn = document.getElementById('landscapeBtn');
    const portraitBtn = document.getElementById('portraitBtn');
    if (landscapeBtn) landscapeBtn.addEventListener('click', () => setOrientation('landscape', true));
    if (portraitBtn) portraitBtn.addEventListener('click', () => setOrientation('portrait', true));

    const frontSideBtn = document.getElementById('frontSideBtn');
    const backSideBtn = document.getElementById('backSideBtn');
    if (frontSideBtn) frontSideBtn.addEventListener('click', () => switchSide('front'));
    if (backSideBtn) backSideBtn.addEventListener('click', () => switchSide('back'));

    const fieldSelect = document.getElementById('fieldToPlaceSelect');
    const convertWordBtn = document.getElementById('convertWordBtn');
    const saveFormatBtn = document.getElementById('saveFormatBtn');
    const fontSizeInput = document.getElementById('fontSizeInput');
    const fontFamilySelect = document.getElementById('fontFamilySelect');
    const fontWeightSelect = document.getElementById('fontWeightSelect');
    const lineHeightInput = document.getElementById('lineHeightInput');
    const charSpacingInput = document.getElementById('charSpacingInput');
    const fontColorInput = document.getElementById('fontColorInput');
    const fontColorTextInput = document.getElementById('fontColorTextInput');

    if (fieldSelect) {
      fieldSelect.addEventListener('change', function () {
        const selectedName = String(this.value || '').trim();
        if (!selectedName) {
          clearPendingFieldToMap(currentSide);
          return;
        }
        const fieldObj = (TABLE_FIELDS || []).find(function (f) { return f.name === selectedName; });
        if (!fieldObj) {
          showToast('Selected field is not available.', 'warning');
          return;
        }

        setPendingFieldToMap(currentSide, selectedName);
        if (!hasEditableDesignForSide(currentSide)) {
          showToast('Convert the design first, then click the text block you want to map.', 'info');
          return;
        }

        if (tryMapPendingFieldToSelection(currentSide)) {
          return;
        }

        showToast('Field selected. Now click the converted text/image block to map it.', 'info');
      });
    }

    if (convertWordBtn) {
      convertWordBtn.addEventListener('click', function () {
        convertDesignPdfToEditable(currentSide);
      });
    }

    if (saveFormatBtn) {
      saveFormatBtn.addEventListener('click', function () {
        saveLayoutFormat();
      });
    }

    if (fontSizeInput) {
      fontSizeInput.addEventListener('change', function () {
        const val = Math.min(72, Math.max(6, parseInt(this.value || '11', 10) || 11));
        this.value = val;
        applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
      });
    }

    if (fontFamilySelect) {
      fontFamilySelect.addEventListener('change', function () {
        applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
      });
    }

    if (fontWeightSelect) {
      fontWeightSelect.addEventListener('change', function () {
        applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
      });
    }

    if (lineHeightInput) {
      lineHeightInput.addEventListener('change', function () {
        const val = Math.min(3, Math.max(0.8, Number(this.value || '1.15')));
        this.value = Number.isFinite(val) ? val : 1.15;
        applyStyleInputsToSelectedEditableLine(currentSide);
        updateDocxStylePreview();
      });
    }

    if (charSpacingInput) {
      charSpacingInput.addEventListener('change', function () {
        const val = Math.min(20, Math.max(-5, Number(this.value || '0')));
        this.value = Number.isFinite(val) ? val : 0;
        applyStyleInputsToSelectedEditableLine(currentSide);
        updateDocxStylePreview();
      });
    }

    if (fontColorInput) {
      fontColorInput.addEventListener('input', function () {
        const color = normalizeHexColor(this.value);
        this.value = color;
        if (fontColorTextInput) fontColorTextInput.value = color;
        applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
      });
      fontColorInput.addEventListener('change', function () {
        const color = normalizeHexColor(this.value);
        this.value = color;
        if (fontColorTextInput) fontColorTextInput.value = color;
        applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
      });
    }

    if (fontColorTextInput) {
      fontColorTextInput.addEventListener('input', function () {
        const raw = String(this.value || '').trim();
        if (!/^#?[0-9a-fA-F]{0,6}$/.test(raw)) return;
        if (/^#?[0-9a-fA-F]{3}$/.test(raw) || /^#?[0-9a-fA-F]{6}$/.test(raw)) {
          const color = normalizeHexColor(raw);
          if (fontColorInput) fontColorInput.value = color;
          applyStyleInputsToSelectedEditableLine(currentSide);
          updateGenerateBtn();
          updateDocxStylePreview();
        }
      });
      fontColorTextInput.addEventListener('change', function () {
        const color = normalizeHexColor(this.value);
        this.value = color;
        if (fontColorInput) fontColorInput.value = color;
        applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
      });
    }

    // Generate actions
    const generatePreviewBtn = document.getElementById('generatePreviewBtn');
    const generateAllBtn = document.getElementById('generatePdfBtn');
    if (generatePreviewBtn) generatePreviewBtn.addEventListener('click', generatePreview);
    if (generateAllBtn) generateAllBtn.addEventListener('click', generatePdf);

    // Card list: select all / none (only if the UI exists)
    const genSelectAllEl = document.getElementById('genSelectAllBtn');
    const genClearSelEl  = document.getElementById('genClearSelBtn');
    if (genSelectAllEl) {
      genSelectAllEl.addEventListener('click', () => {
        genCards.forEach(c => selectedPrIds.add(c.pr_id));
        renderCardList(genCards);
        updateGenerateBtn();
      });
    }
    if (genClearSelEl) {
      genClearSelEl.addEventListener('click', () => {
        selectedPrIds.clear();
        renderCardList(genCards);
        updateGenerateBtn();
      });
    }

    // Card search (only if the UI exists)
    const genCardSearchEl = document.getElementById('genCardSearch');
    if (genCardSearchEl) {
      genCardSearchEl.addEventListener('input', function () {
        const q = this.value.toLowerCase();
        const filtered = genCards.filter(c =>
          buildDisplayName(c).toLowerCase().includes(q)
        );
        renderCardList(filtered);
      });
    }

    // Upload design PDFs
    const uploadFrontInput = document.getElementById('uploadFrontInput');
    const uploadBackInput = document.getElementById('uploadBackInput');

    if (uploadFrontInput) {
      uploadFrontInput.addEventListener('click', function () {
        // Allow re-selecting the same file repeatedly.
        this.value = '';
      });
      uploadFrontInput.addEventListener('change', function () {
        if (this.files[0]) uploadDesignPdf(this.files[0], 'front');
      });
    }
    if (uploadBackInput) {
      uploadBackInput.addEventListener('click', function () {
        this.value = '';
      });
      uploadBackInput.addEventListener('change', function () {
        if (this.files[0]) uploadDesignPdf(this.files[0], 'back');
      });
    }

    const removeFrontBtn = document.getElementById('removeFrontPdfBtn');
    const removeBackBtn = document.getElementById('removeBackPdfBtn');
    if (removeFrontBtn) {
      removeFrontBtn.addEventListener('click', function () { removePdf('front'); });
    }
    if (removeBackBtn) {
      removeBackBtn.addEventListener('click', function () { removePdf('back'); });
    }

    document.addEventListener('keydown', onEditorKeydown);
  }

  /*  SIDE MANAGEMENT  */

  function setOrientation(nextOrientation, withUpdate) {
    const next = normalizeOrientation(nextOrientation);
    cardOrientation = next;
    if (typeof FIELD_CONFIG === 'object' && FIELD_CONFIG) {
      FIELD_CONFIG.card_orientation = cardOrientation;
    }

    const landscapeBtn = document.getElementById('landscapeBtn');
    const portraitBtn = document.getElementById('portraitBtn');
    if (landscapeBtn) landscapeBtn.classList.toggle('active', cardOrientation === 'landscape');
    if (portraitBtn) portraitBtn.classList.toggle('active', cardOrientation === 'portrait');

    applyCanvasDimensions();
    renderPlacedFields();

    if (hasEditableDesignForSide('front')) {
      clearCanvasBackground('front');
      renderEditableDesignLayer('front');
    } else if (FRONT_PDF_URL) {
      renderPdf(FRONT_PDF_URL, 0, 'front');
    } else {
      clearCanvasBackground('front');
    }

    if (isTwoSided) {
      if (hasEditableDesignForSide('back')) {
        clearCanvasBackground('back');
        renderEditableDesignLayer('back');
      } else if (BACK_PDF_URL) {
        renderPdf(BACK_PDF_URL, 0, 'back');
      } else {
        clearCanvasBackground('back');
      }
    } else {
      clearCanvasBackground('back');
    }

    if (withUpdate) {
      updateGenerateBtn();
    }
    updateSetupStatus();
  }

  function setTwoSided(val, withUpdate) {
    isTwoSided = val;

    if (typeof FIELD_CONFIG === 'object' && FIELD_CONFIG) {
      FIELD_CONFIG.is_two_sided = val;
    }

    const singleSidedBtn = document.getElementById('singleSidedBtn');
    const twoSidedBtn = document.getElementById('twoSidedBtn');
    const sideToggle = document.getElementById('sideToggle');
    const uploadBackWrapper = document.getElementById('uploadBackWrapper');
    if (singleSidedBtn) singleSidedBtn.classList.toggle('active', !val);
    if (twoSidedBtn) twoSidedBtn.classList.toggle('active', val);
    if (sideToggle) sideToggle.classList.toggle('hidden', !val);
    if (uploadBackWrapper) uploadBackWrapper.classList.toggle('hidden', !val);
    const secondaryPanel = document.getElementById('genCardSecondaryPanel');
    if (secondaryPanel) secondaryPanel.classList.toggle('hidden', !val);

    if (!val && currentSide === 'back') {
      switchSide('front');
    }

    if (withUpdate) {
      renderMappingsOnCanvas();
      if (val && !hasBackPdf()) {
        showToast('2-sided selected. Upload Back design PDF if you want back-side visual preview.', 'info');
      }
    }

    if (val) {
      if (hasEditableDesignForSide('back')) {
        clearCanvasBackground('back');
        renderEditableDesignLayer('back');
      } else if (BACK_PDF_URL) {
        renderPdf(BACK_PDF_URL, 0, 'back');
      } else {
        clearCanvasBackground('back');
      }
    } else {
      clearCanvasBackground('back');
    }
    setActiveCanvas(currentSide);

    updateSetupStatus();
    updateGenerateBtn();
    renderMappingsOnCanvas();
  }

  function switchSide(side) {
    if (side === 'back' && !isTwoSided) return;
    currentSide = side;
    setActiveCanvas(side);
    const frontSideBtn = document.getElementById('frontSideBtn');
    const backSideBtn = document.getElementById('backSideBtn');
    const activeSideLabel = document.getElementById('activeSideLabel');
    if (frontSideBtn) frontSideBtn.classList.toggle('active', side === 'front');
    if (backSideBtn) backSideBtn.classList.toggle('active', side === 'back');
    if (activeSideLabel) activeSideLabel.textContent = side === 'front' ? 'Front' : 'Back';

    // Refresh dropdown to show only fields allowed for this side
    populateFieldDropdown();

    renderMappingsOnCanvas();
    exitDrawMode();

    const sideHasDesign = hasDesignAssetForSide(side);
    if (!sideHasDesign && side === 'back' && isTwoSided) {
      showToast('Upload Back design PDF to continue with the back side.', 'warning');
    }
  }

  function mapSelectedEditableBlockToField(side, fieldObj, selection) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const fieldName = String((fieldObj && fieldObj.name) || '').trim();
    if (!fieldName || !selection || !selection.el) return;

    let rect = readEditableElementRectMm(selection.el);
    if (selection.type === 'line') {
      const model = editableDesignModels[targetSide];
      const line = model && Array.isArray(model.lines) ? model.lines[selection.index] : null;
      if (line && typeof line === 'object') {
        rect = {
          x_mm: Number(line.x_mm || 0),
          y_mm: Number(line.y_mm || 0),
          w_mm: Math.max(0.5, Number(line.w_mm || rect.w_mm || 8)),
          h_mm: Math.max(0.5, Number(line.h_mm || rect.h_mm || 3)),
        };
      }
    }
    const prev = (fieldMappings[targetSide][fieldName] && typeof fieldMappings[targetSide][fieldName] === 'object')
      ? fieldMappings[targetSide][fieldName]
      : {};

    const isPhoto = isImageFieldType(fieldObj.type, fieldName) || selection.type === 'image';
    const mapped = {
      x_mm: rect.x_mm,
      y_mm: rect.y_mm,
      w_mm: rect.w_mm,
      h_mm: rect.h_mm,
      source_line_idx: selection.type === 'line' ? Number(selection.index) : null,
      label_text: isPhoto
        ? String(prev.label_text || formatFieldLabel(fieldName)).trim()
        : String(prev.label_text || '').trim(),
      placeholder: isPhoto
        ? '[PHOTO]'
        : String(prev.placeholder || 'XXXXX').trim(),
      show_key: false,
    };

    fieldMappings[targetSide][fieldName] = Object.assign({}, prev, mapped);
    renderMappingsOnCanvas();
    renderPlacedFields();
    updateGenerateBtn();
    updateSetupStatus();
    showToast('Mapped ' + fieldName + ' successfully.', 'success');
  }

  function exitDrawMode() {
    // Legacy no-op kept for old call sites after removing rectangle draw workflow.
    const frontWrap = document.getElementById('genCardWrapper');
    const backWrap = document.getElementById('genCardSecondaryWrapper');
    if (frontWrap) frontWrap.classList.add('no-draw-mode');
    if (backWrap) backWrap.classList.add('no-draw-mode');
  }

  /*  CANVAS RENDERING  */

  function clearCanvasBackground(side) {
    const targetSide = side || currentSide;
    const canvas = getCanvasForSide(targetSide);
    if (!canvas || typeof canvas.getObjects !== 'function') return;

    canvas.backgroundImage = null;
    if (typeof canvas.setBackgroundColor === 'function') {
      canvas.setBackgroundColor('#ffffff', function () {
        canvas.renderAll();
      });
    }
    canvas.renderAll();

    const noTplId = targetSide === 'back' ? 'noTemplateMsgSecondary' : 'noTemplateMsg';
    const noTpl = document.getElementById(noTplId);
    if (noTpl) {
      if (hasEditableDesignForSide(targetSide)) {
        noTpl.classList.add('hidden');
      } else {
        noTpl.classList.remove('hidden');
      }
    }

    if (hasEditableDesignForSide(targetSide)) {
      renderEditableDesignLayer(targetSide);
    }
  }

  function hidePdfOverlay(overlayEl) {
    const el = overlayEl || document.getElementById('pdfLoadingOverlay');
    if (el) el.classList.add('hidden');
  }

  function updateSideBySidePreview() {
    const panel = document.getElementById('genCardSecondaryPanel');
    const labelEl = document.getElementById('genSecondarySideLabel');
    if (panel) panel.classList.toggle('hidden', !isTwoSided);
    if (labelEl) labelEl.textContent = 'Back Working Area';
  }

  function renderMappingsOnSide(side) {
    const canvas = getCanvasForSide(side);
    if (!canvas || typeof canvas.getObjects !== 'function') return;

    // Remove old mapping overlays first.
    const toRemove = canvas.getObjects().filter(o => o.__isMapping);
    toRemove.forEach(o => canvas.remove(o));

    const sideMappings = getRenderableMappingsForSide(side);
    Object.keys(sideMappings).forEach(function (fieldName) {
      const mapping = sideMappings[fieldName] || {};

      const x = Math.max(0, Number(mapping.x_mm || 0) * SCALE);
      const y = Math.max(0, Number(mapping.y_mm || 0) * SCALE);
      const w = Math.max(12, Number(mapping.w_mm || 20) * SCALE);
      const h = Math.max(10, Number(mapping.h_mm || 8) * SCALE);

      const preview = mappingPreviewText(fieldName, mapping);
      const stroke = preview.isPhoto ? '#059669' : '#2563EB';
      const fill = preview.isPhoto ? 'rgba(16,185,129,0.18)' : 'rgba(37,99,235,0.14)';

      const rect = new fabric.Rect({
        left: x,
        top: y,
        width: w,
        height: h,
        fill: fill,
        stroke: stroke,
        strokeWidth: 1.6,
        strokeDashArray: [6, 4],
        rx: 2,
        ry: 2,
        transparentCorners: false,
        objectCaching: false,
      });
      rect.setControlsVisibility({ mtr: false });
      rect.__isMapping = true;
      rect.__isMappingRect = true;
      rect.__mappingSide = side;
      rect.__fieldName = fieldName;
      canvas.add(rect);

      const labelSize = Math.max(8, Math.min(12, h * 0.19));
      const valueSize = Math.max(9, Math.min(16, h * 0.3));
      const line1Top = y + 3;
      const line2Top = y + Math.max(16, h * 0.42);

      if (preview.line1) {
        const line1 = new fabric.Text(preview.line1, {
          left: x + 4,
          top: line1Top,
          fontSize: labelSize,
          fontWeight: '700',
          fill: preview.isPhoto ? '#065F46' : '#1E3A8A',
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        line1.__isMapping = true;
        canvas.add(line1);
      }

      const line2 = new fabric.Text(preview.line2, {
        left: x + 4,
        top: line2Top,
        fontSize: valueSize,
        fontWeight: preview.isPhoto ? '700' : '600',
        fill: preview.isPhoto ? '#065F46' : '#1F2937',
        selectable: false,
        evented: false,
        objectCaching: false,
      });
      line2.__isMapping = true;
      canvas.add(line2);
    });

    canvas.renderAll();
  }

  function renderMappingsOnCanvas() {
    renderMappingsOnSide('front');
    if (isTwoSided) {
      renderMappingsOnSide('back');
    } else {
      renderMappingsOnSide('back');
    }
  }

  /*  PDF.js rendering  */
  function renderPdf(url, attempt, side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const retry = Number.isFinite(attempt) ? attempt : 0;
    const renderTicket = ++activeRenderTicket[targetSide];

    // If editor lives in a hidden modal, skip background rendering.
    if (isInlineModalEditor) {
      const overlayModal = document.getElementById('gcEditorModal');
      if (overlayModal && overlayModal.classList.contains('hidden')) {
        return;
      }
    }

    const targetCanvas = getCanvasForSide(targetSide);
    if (!targetCanvas || !isCanvasReady(targetSide)) {
      initFabric();
      if (retry < 150) {
        setTimeout(function () {
          renderPdf(url, retry + 1, targetSide);
        }, 200);
        return;
      }
      if (!isInlineModalEditor) {
        showToast('Editor canvas is not ready. Please refresh and try again.', 'error');
      }
      return;
    }

    const overlayId = targetSide === 'back' ? 'pdfLoadingOverlaySecondary' : 'pdfLoadingOverlay';
    const noTplId = targetSide === 'back' ? 'noTemplateMsgSecondary' : 'noTemplateMsg';
    const overlay = document.getElementById(overlayId);
    const noTpl = document.getElementById(noTplId);

    if (hasEditableDesignForSide(targetSide)) {
      if (overlay) hidePdfOverlay(overlay);
      if (noTpl) noTpl.classList.add('hidden');
      clearCanvasBackground(targetSide);
      renderEditableDesignLayer(targetSide);
      return;
    }

    const sourceUrl = (url || '').trim();
    if (sourceUrl && /\.docx(?:$|\?)/i.test(sourceUrl)) {
      if (overlay) hidePdfOverlay(overlay);
      if (noTpl) {
        const p = noTpl.querySelector('p');
        if (p) p.textContent = 'DOCX template imported. Preview is not shown here.';
        noTpl.classList.remove('hidden');
      }
      return;
    }

    if (overlay) overlay.classList.remove('hidden');
    if (noTpl) noTpl.classList.add('hidden');

    if (!ensurePdfWorkerConfigured()) {
      if (retry < 150) {
        setTimeout(function () {
          renderPdf(url, retry + 1, targetSide);
        }, 200);
        return;
      }
      if (overlay) hidePdfOverlay(overlay);
      if (noTpl) noTpl.classList.remove('hidden');
      showToast('PDF viewer library failed to load. Please refresh the page or check your internet connection.', 'error');
      return;
    }

    const pdfLib = getPdfJsLib();
    if (!pdfLib) {
      if (overlay) hidePdfOverlay(overlay);
      if (noTpl) noTpl.classList.remove('hidden');
      showToast('PDF viewer library failed to load. Please refresh the page or check your internet connection.', 'error');
      return;
    }

    try {
      if (!sourceUrl) {
        if (overlay) hidePdfOverlay(overlay);
        if (noTpl) noTpl.classList.remove('hidden');
        clearCanvasBackground(targetSide);
        updateSetupStatus();
        return;
      }

      const resolvedUrl = new URL(sourceUrl, window.location.origin).toString();
      loadPdfDocument(resolvedUrl)
        .then(function (pdfDoc) {
          if (renderTicket !== activeRenderTicket[targetSide]) return Promise.reject(new Error('Stale render ignored'));
          return pdfDoc.getPage(1);
        })
        .then(function (page) {
          if (renderTicket !== activeRenderTicket[targetSide]) return Promise.reject(new Error('Stale render ignored'));

          const cardW = getCardWidthPx();
          const cardH = getCardHeightPx();
          const viewport = page.getViewport({ scale: 1 });
          const scaleX = cardW / viewport.width;
          const scaleY = cardH / viewport.height;
          const pdfScale = Math.min(scaleX, scaleY);
          const scaledVP = page.getViewport({ scale: pdfScale });

          const offscreen = document.createElement('canvas');
          offscreen.width = scaledVP.width;
          offscreen.height = scaledVP.height;
          const ctx = offscreen.getContext('2d');
          if (!ctx) throw new Error('2D canvas context unavailable');

          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, offscreen.width, offscreen.height);
          ctx.restore();

          return page.render({ canvasContext: ctx, viewport: scaledVP }).promise.then(function () {
            if (renderTicket !== activeRenderTicket[targetSide]) return;

            let dataUrl = '';
            try {
              dataUrl = offscreen.toDataURL();
            } catch (e) {
              console.error('Canvas toDataURL failed:', e);
              if (overlay) hidePdfOverlay(overlay);
              if (noTpl) noTpl.classList.remove('hidden');
              showToast('Failed to convert PDF to image.', 'error');
              return;
            }

            fabric.Image.fromURL(dataUrl, function (img) {
              if (renderTicket !== activeRenderTicket[targetSide]) return;
              if (!img || img.width === 0) {
                if (overlay) hidePdfOverlay(overlay);
                if (noTpl) noTpl.classList.remove('hidden');
                showToast('Failed to render PDF onto canvas.', 'error');
                return;
              }

              img.set({ left: 0, top: 0, selectable: false, evented: false, opacity: 1 });
              img.scaleToWidth(cardW);

              targetCanvas.calcOffset();
              targetCanvas.setBackgroundImage(img);
              if (typeof targetCanvas.requestRenderAll === 'function') {
                targetCanvas.requestRenderAll();
              } else {
                targetCanvas.renderAll();
              }

              if (overlay) hidePdfOverlay(overlay);
              if (noTpl) noTpl.classList.add('hidden');
              clearModalAlert();
              renderMappingsOnSide(targetSide);
            });
          });
        })
        .catch(function (err) {
          if (String((err && err.message) || '').indexOf('Stale render ignored') >= 0) {
            return;
          }
          console.error('PDF.js error (' + targetSide + '):', err);
          if (overlay) hidePdfOverlay(overlay);
          if (noTpl) noTpl.classList.remove('hidden');
          showToast('Failed to load PDF template: ' + describePdfLoadError(err), 'error');
        });
    } catch (err) {
      console.error('renderPdf error (' + targetSide + '):', err);
      if (overlay) hidePdfOverlay(overlay);
      if (noTpl) noTpl.classList.remove('hidden');
      showToast('Failed to render PDF template.', 'error');
    }
  }

  function isImageFieldType(type, name) {
    const t = (type || '').toLowerCase();
    const n = (name || '').toLowerCase();
    return t === 'image' || t === 'photo' || t === 'file' ||
           n === 'photo' || n === 'image' || n === 'picture' || n === 'pic' || n === 'img' ||
           n.includes('photo') || n.includes('image') || n.includes('signature');
  }

  function formatFieldLabel(fieldName) {
    const raw = String(fieldName || '').trim().replace(/[_\-]+/g, ' ');
    if (!raw) return 'Field';
    return raw.replace(/\s+/g, ' ').replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
  }

  function mappingPreviewText(fieldName, mapping) {
    const fieldObj = (TABLE_FIELDS || []).find(function (f) {
      return String((f && f.name) || '') === String(fieldName || '');
    }) || {};
    const isPhoto = isImageFieldType(fieldObj.type, fieldName);
    if (isPhoto) {
      return {
        line1: 'PHOTO',
        line2: String((mapping && mapping.placeholder) || '[PHOTO]'),
        isPhoto: true,
      };
    }

    const showKeyRaw = mapping && Object.prototype.hasOwnProperty.call(mapping, 'show_key')
      ? mapping.show_key
      : true;
    const showKey = (typeof showKeyRaw === 'string')
      ? !(/^(false|0|no)$/i.test(showKeyRaw.trim()))
      : !!showKeyRaw;
    const label = String((mapping && mapping.label_text) || formatFieldLabel(fieldName)).trim();
    const hasPlaceholder = !!(mapping && Object.prototype.hasOwnProperty.call(mapping, 'placeholder'));
    const valuePlaceholder = hasPlaceholder
      ? String(mapping.placeholder == null ? '' : mapping.placeholder).trim()
      : 'XXXXX';

    return {
      line1: showKey ? (label.endsWith(':') ? label : (label + ':')) : '',
      line2: valuePlaceholder,
      isPhoto: false,
    };
  }

  /*  PLACED FIELDS UI  */

  function renderPlacedFields() {
    const container = document.getElementById('genPlacedFields');
    const noMsg     = document.getElementById('noFieldsMsg');
    if (!container || !noMsg) return;

    // Collect all placed fields across both sides
    const allPlaced = [];
    ['front', 'back'].forEach(side => {
      if (!isTwoSided && side === 'back') return;
      Object.entries(getRenderableMappingsForSide(side)).forEach(([name, dim]) => {
        allPlaced.push({ side, name, dim });
      });
    });

    if (allPlaced.length === 0) {
      noMsg.classList.remove('hidden');
      container.querySelectorAll('.gen-placed-field-item').forEach(el => el.remove());
      return;
    }

    noMsg.classList.add('hidden');
    container.querySelectorAll('.gen-placed-field-item').forEach(el => el.remove());

    allPlaced.forEach(({ side, name }) => {
      const fieldObj = TABLE_FIELDS.find(f => f.name === name) || { type: 'text' };
      const fieldType = String((fieldObj && fieldObj.type) || '').toLowerCase();
      const isImg = fieldType === 'photo' || fieldType.indexOf('photo') >= 0 || fieldType === 'image' || fieldType === 'file';
      const div = document.createElement('div');
      div.className = 'gen-placed-field-item';
      div.innerHTML = `
        <span class="field-side-tag">${side === 'front' ? 'F' : 'B'}</span>
        <span class="field-name">${escHtml(name)}</span>
        <span class="gen-placed-field-type">${isImg ? 'IMG' : 'T'}</span>
        <button class="gen-remove-field-btn" data-side="${side}" data-field="${escHtml(name)}" title="Remove placement">x</button>
      `;
      div.querySelector('button').addEventListener('click', function () {
        removeFieldMapping(this.dataset.side, this.dataset.field);
      });
      container.appendChild(div);
    });
  }

  function removeFieldMapping(side, fieldName) {
    if (fieldMappings[side]) delete fieldMappings[side][fieldName];
    renderMappingsOnCanvas();
    renderPlacedFields();
    updateGenerateBtn();
    updateSetupStatus();
  }

  /*  CARD LIST  */

  /** Build a display name from ordered_fields (first 2 text fields) */
  function buildDisplayName(item) {
    if (!item.ordered_fields) return 'Card #' + (item.card_id || item.pr_id);
    const textParts = [];
    for (let i = 0; i < item.ordered_fields.length && textParts.length < 2; i++) {
      const f = item.ordered_fields[i];
      const t = (f.type || '').toLowerCase();
      const n = (f.name || '').toLowerCase();
      if (t === 'image' || t === 'photo' || t === 'file' || n === 'photo' || n.includes('photo')) continue;
      if (f.value && f.value !== '-') textParts.push(f.value);
    }
    return textParts.length > 0 ? textParts.join(' - ') : ('Card #' + (item.card_id || item.pr_id));
  }

  function loadCardList() {
    const loadingEl = document.getElementById('genCardListLoading');
    const emptyEl   = document.getElementById('genCardListEmpty');
    const listEl    = document.getElementById('genCardList');
    const hasListUI = !!listEl;

    fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/cards/', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    .then(function(r) {
      if (!r.ok) {
        return parseJsonResponse(r, 'Failed to load generate list.').then(function(data) {
          throw new Error((data && (data.message || data.error)) || 'Failed to load generate list.');
        });
      }
      return parseJsonResponse(r, 'Failed to load generate list.');
    })
    .then(data => {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (!data || (data.status && data.status !== 'ok')) {
        showToast((data && (data.message || data.error)) || 'Failed to load generate list.', 'error');
        return;
      }
      if (data.error)  { showToast(data.error, 'error'); return; }
      genCards = data.items || data.cards || [];
      const preselected = Array.isArray(window.GEN_PRESELECT_PR_IDS) ? window.GEN_PRESELECT_PR_IDS : [];
      const countBadge = document.getElementById('genCardCountBadge');
      if (countBadge) countBadge.textContent = data.total || genCards.length;
      if (hasListUI) {
        if (genCards.length === 0) {
          if (emptyEl) emptyEl.classList.remove('hidden');
        } else {
          if (preselected.length > 0) {
            selectedPrIds.clear();
            genCards.forEach(c => {
              if (preselected.indexOf(c.pr_id) >= 0) selectedPrIds.add(c.pr_id);
            });
            // If stale preselection no longer matches current rows, fall back to full list.
            if (selectedPrIds.size === 0) {
              genCards.forEach(c => selectedPrIds.add(c.pr_id));
            }
          }
          renderCardList(genCards);
        }
      } else {
        // No selection UI in modal mode: preselect requested IDs, else all cards.
        selectedPrIds.clear();
        if (preselected.length > 0) {
          genCards.forEach(c => {
            if (preselected.indexOf(c.pr_id) >= 0) selectedPrIds.add(c.pr_id);
          });
          if (selectedPrIds.size === 0) {
            genCards.forEach(c => selectedPrIds.add(c.pr_id));
          }
        } else {
          genCards.forEach(c => selectedPrIds.add(c.pr_id));
        }
      }
      // Use preselection only for the current open session.
      window.GEN_PRESELECT_PR_IDS = [];
      updateGenerateBtn();
    }).catch(err => {
      if (loadingEl) loadingEl.classList.add('hidden');
      console.error(err);
      showToast('Failed to load generate list.', 'error');
    });
  }

  function renderCardList(cards) {
    const listEl  = document.getElementById('genCardList');
    const emptyEl = document.getElementById('genCardListEmpty');
    if (!listEl) return; // no list UI in this view
    listEl.querySelectorAll('.gen-card-item').forEach(el => el.remove());

    if (cards.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');

    cards.forEach(card => {
      const prId = card.pr_id || card.id;
      const displayName = buildDisplayName(card);
      const div = document.createElement('div');
      div.className = 'gen-card-item' + (selectedPrIds.has(prId) ? ' selected' : '');
      div.innerHTML = `
        <input type="checkbox" ${selectedPrIds.has(prId) ? 'checked' : ''} data-id="${prId}">
        <span class="gen-card-name">${escHtml(displayName)}</span>
        <span class="gen-card-id">#${card.sr_no || prId}</span>
      `;
      const cb = div.querySelector('input[type=checkbox]');
      cb.addEventListener('change', function () {
        if (this.checked) {
          selectedPrIds.add(prId);
          div.classList.add('selected');
        } else {
          selectedPrIds.delete(prId);
          div.classList.remove('selected');
        }
        updateGenerateBtn();
      });
      div.addEventListener('click', function (e) {
        if (e.target.tagName === 'INPUT') return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
      listEl.appendChild(div);
    });
  }

  function updateGenerateBtn() {
    const hasCards    = selectedPrIds.size > 0;
    const hasTemplateAssets = hasDesignAssetForSide('front') && (!isTwoSided || hasDesignAssetForSide('back'));
    const canGenerate = hasCards && hasTemplateAssets && hasRequiredMappings();
    const generateBtn = document.getElementById('generatePdfBtn');
    const previewBtn = document.getElementById('generatePreviewBtn');
    if (generateBtn) generateBtn.disabled = !canGenerate;
    if (previewBtn) previewBtn.disabled = !canGenerate;
  }

  /*  API CALLS  */

  function buildTemplatePersistPayload() {
    return {
      is_two_sided: isTwoSided,
      card_orientation: cardOrientation,
      font_size: readFontSizeValue(),
      font_family: readFontFamilyValue(),
      field_mappings: withSourceLineIndices(fieldMappings),
      editable_design_front: buildEditableDesignPayloadForTemplate('front'),
      editable_design_back: buildEditableDesignPayloadForTemplate('back'),
      front_fields: (typeof FIELD_CONFIG === 'object' && FIELD_CONFIG && Array.isArray(FIELD_CONFIG.front_fields)) ? cloneDeep(FIELD_CONFIG.front_fields) : [],
      back_fields: (typeof FIELD_CONFIG === 'object' && FIELD_CONFIG && Array.isArray(FIELD_CONFIG.back_fields)) ? cloneDeep(FIELD_CONFIG.back_fields) : [],
      docx_font_family: readFontFamilyValue(),
      docx_font_size_pt: readFontSizeValue(),
      docx_line_height: readLineHeightValue(),
      docx_char_spacing_pt: readCharSpacingValue(),
      docx_font_weight: readFontWeightValue(),
      docx_font_color_hex: readFontColorValue(),
    };
  }

  function saveLayoutFormat() {
    if (!hasDesignAssetForSide('front')) {
      showToast('Upload and convert Front design PDF first.', 'warning');
      return;
    }
    if (isTwoSided && !hasDesignAssetForSide('back')) {
      showToast('Upload and convert Back design PDF for 2-sided format.', 'warning');
      return;
    }
    if (!hasRequiredMappings()) {
      showToast('Map at least one field before saving format.', 'warning');
      return;
    }

    const btn = document.getElementById('saveFormatBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    }

    const payload = buildTemplatePersistPayload();

    persistTemplate(payload)
      .then(function (data) {
        templatePersistedThisSession = true;
        if (data && data.template && typeof TEMPLATE_DATA === 'object' && TEMPLATE_DATA) {
          // Keep the current in-memory canvas state as source of truth after save.
          // Re-applying server-sanitized template immediately can cause visible drift.
          TEMPLATE_DATA.is_two_sided = !!data.template.is_two_sided;
          TEMPLATE_DATA.font_size = data.template.font_size || TEMPLATE_DATA.font_size;
          TEMPLATE_DATA.font_family = data.template.font_family || TEMPLATE_DATA.font_family;
          TEMPLATE_DATA.card_orientation = normalizeOrientation(data.template.card_orientation || TEMPLATE_DATA.card_orientation);
          TEMPLATE_DATA.front_fields = Array.isArray(data.template.front_fields) ? data.template.front_fields : (TEMPLATE_DATA.front_fields || []);
          TEMPLATE_DATA.back_fields = Array.isArray(data.template.back_fields) ? data.template.back_fields : (TEMPLATE_DATA.back_fields || []);
          TEMPLATE_DATA.field_mappings = cloneDeep(fieldMappings);
        }
        showToast('Format saved. You can reuse and edit it later.', 'success');
      })
      .catch(function (err) {
        console.error(err);
        showToast(err.message || 'Failed to save format.', 'error');
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Format';
        }
      });
  }

  function generatePreview() {
    if (selectedPrIds.size === 0) {
      showToast('Select at least one card.', 'warning');
      return;
    }

    if (!hasFrontPdf() && !hasEditableDesignForSide('front')) {
      showToast('Upload Front design PDF first.', 'warning');
      const frontInput = document.getElementById('uploadFrontInput');
      if (frontInput) frontInput.click();
      return;
    }
    if (isTwoSided && !hasBackPdf() && !hasEditableDesignForSide('back')) {
      showToast('Upload Back design PDF for 2-sided cards.', 'warning');
      const backInput = document.getElementById('uploadBackInput');
      if (backInput) backInput.click();
      return;
    }
    if (!hasRequiredMappings()) {
      showToast('Map at least one field before generating preview.', 'warning');
      return;
    }

    const btn = document.getElementById('generatePreviewBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Previewing...';
    }

    const payload = buildTemplatePersistPayload();
    const firstPrId = Array.from(selectedPrIds)[0];

    persistTemplate(payload)
      .then(function () {
        templatePersistedThisSession = true;
        return fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/generate/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken'),
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({ request_ids: [firstPrId], preview_only: true }),
        });
      })
      .then(function (response) {
        if (!response.ok) {
          return parseJsonResponse(response, 'Server error').then(function (d) {
            throw new Error(d.error || d.message || 'Server error');
          });
        }
        const contentDisposition = response.headers.get('Content-Disposition') || '';
        lastGeneratedFilename = filenameFromContentDisposition(contentDisposition, 'generated_preview.pdf');
        return response.blob();
      })
      .then(function (blob) {
        lastPdfBlob = blob;
        const dlBtn = document.getElementById('gcDownloadPdfBtn');
        if (dlBtn) {
          dlBtn.disabled = false;
          dlBtn.classList.remove('opacity-50');
        }
        return showGeneratedPreviewInMainArea(blob).then(function () {
          showToast('Preview shown in the card area. Review it, then click Generate All.', 'success');
        });
      })
      .catch(function (err) {
        console.error(err);
        showToast(err.message || 'Failed to generate preview.', 'error');
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-regular fa-eye"></i> Generate Preview';
        }
        updateGenerateBtn();
      });
  }

  function generatePdf() {
    if (selectedPrIds.size === 0) {
      showToast('Select at least one card.', 'warning');
      return;
    }

    if (!hasFrontPdf() && !hasEditableDesignForSide('front')) {
      showToast('Upload Front design PDF first.', 'warning');
      const frontInput = document.getElementById('uploadFrontInput');
      if (frontInput) frontInput.click();
      return;
    }
    if (isTwoSided && !hasBackPdf() && !hasEditableDesignForSide('back')) {
      showToast('Upload Back design PDF for 2-sided cards.', 'warning');
      const backInput = document.getElementById('uploadBackInput');
      if (backInput) backInput.click();
      return;
    }
    if (!hasRequiredMappings()) {
      showToast('Map at least one field before generating.', 'warning');
      return;
    }

    const btn = document.getElementById('generatePdfBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating All...';

    const payload = buildTemplatePersistPayload();

    let generateTimeoutHandle = null;

    // Persist latest DOCX style/orientation settings before generating output.
    persistTemplate(payload)
    .then(function() {
      templatePersistedThisSession = true;
      const requestOptions = {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-CSRFToken':       getCookie('csrftoken'),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ request_ids: Array.from(selectedPrIds) }),
      };

      if (typeof AbortController !== 'undefined') {
        const generateController = new AbortController();
        generateTimeoutHandle = window.setTimeout(function () {
          generateController.abort();
        }, GENERATE_REQUEST_TIMEOUT_MS);
        requestOptions.signal = generateController.signal;
      }

      return fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/generate/', requestOptions);
    })
    .then(response => {
      if (!response.ok) {
        return parseJsonResponse(response, 'Server error').then(d => { throw new Error(d.error || d.message || 'Server error'); });
      }
      const contentDisposition = response.headers.get('Content-Disposition') || '';
      lastGeneratedFilename = filenameFromContentDisposition(contentDisposition, 'generated_cards.pdf');
      return response.blob();
    })
    .then(blob => {
      // Store the blob  allow download via button
      lastPdfBlob = blob;

      // Enable footer download button if it exists (modal mode)
      const dlBtn = document.getElementById('gcDownloadPdfBtn');
      if (dlBtn) {
        dlBtn.disabled = false;
        dlBtn.classList.remove('opacity-50');
      }

      showToast('PDF generated! Click Download to save. Cards moved to Finalized.', 'success');
      clearGeneratedPreview();
      selectedPrIds.clear();
      loadCardList();
    })
    .catch(err => {
      console.error(err);
      if (err && err.name === 'AbortError') {
        showToast('Generation timed out. Try again with fewer cards.', 'error');
        return;
      }
      showToast(err.message || 'Failed to generate output file.', 'error');
    })
    .finally(() => {
      if (generateTimeoutHandle) {
        clearTimeout(generateTimeoutHandle);
        generateTimeoutHandle = null;
      }
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-gears"></i> Generate All';
    });
  }

  function persistTemplate(payload) {
    return fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/template/save/', {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-CSRFToken':       getCookie('csrftoken'),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(payload),
    })
    .then(function(r) {
      if (!r.ok) {
        return parseJsonResponse(r, 'Failed to save template').then(function(data) {
          throw new Error((data && (data.message || data.error)) || 'Failed to save template');
        });
      }
      return parseJsonResponse(r, 'Failed to save template');
    })
    .then(function(data) {
      if (data.status && data.status !== 'ok') {
        throw new Error(data.message || data.error || 'Failed to save template');
      }
      if (data.error) {
        throw new Error(data.error);
      }
      return data;
    });
  }

  function convertDesignPdfToEditable(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const hasPdf = targetSide === 'back' ? hasBackPdf() : hasFrontPdf();
    if (!hasPdf) {
      showToast('Upload ' + (targetSide === 'back' ? 'Back' : 'Front') + ' design PDF first.', 'warning');
      return;
    }

    const btn = document.getElementById('convertWordBtn');
    const original = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Converting...';
    }

    fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/template/?_=' + Date.now(), {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    })
      .then(function(r) {
        if (!r.ok) {
          return parseJsonResponse(r, 'Failed to check template').then(function(data) {
            throw new Error((data && (data.message || data.error)) || 'Failed to check template');
          });
        }
        return parseJsonResponse(r, 'Failed to check template');
      })
      .then(function(templateResp) {
        const tpl = templateResp && templateResp.template ? templateResp.template : null;
        const serverHasPdf = targetSide === 'back'
          ? !!(tpl && tpl.has_back_pdf)
          : !!(tpl && tpl.has_front_pdf);
        if (!serverHasPdf) {
          if (targetSide === 'front') FRONT_PDF_URL = '';
          if (targetSide === 'back') BACK_PDF_URL = '';
          clearEditableDesignModel(targetSide);
          updateSetupStatus();
          throw new Error('Upload ' + (targetSide === 'back' ? 'Back' : 'Front') + ' design PDF first.');
        }

        return fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/template/convert-inline/' + targetSide + '/?_=' + Date.now(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken'),
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            card_orientation: cardOrientation,
          }),
        });
      })
      .then(function(response) {
        if (!response.ok) {
          return parseJsonResponse(response, 'Failed to convert PDF').then(function(data) {
            throw new Error((data && (data.message || data.error)) || 'Failed to convert PDF');
          });
        }
        return parseJsonResponse(response, 'Failed to convert PDF');
      })
      .then(function(data) {
        if (!data || data.status !== 'ok' || !data.design) {
          throw new Error((data && (data.message || data.error)) || 'Failed to convert PDF');
        }

        editableDesignModels[targetSide] = data.design;
        editableModeBySide[targetSide] = true;

        clearCanvasBackground(targetSide);
        renderEditableDesignLayer(targetSide);
        renderMappingsOnSide(targetSide);
        updateSetupStatus();

        showToast((targetSide === 'back' ? 'Back' : 'Front') + ' converted. Select a field, then click the converted text/image block to map it.', 'success');
      })
      .catch(function(err) {
        console.error(err);
        showToast(err.message || 'Failed to convert PDF to editable layer.', 'error');
      })
      .finally(function() {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = original || '<i class="fa-solid fa-file-word"></i> Convert to Editable Doc';
        }
      });
  }

  function uploadDesignPdf(file, side) {
    const formData = new FormData();
    formData.append('pdf', file);

    showToast(`Uploading ${side} design PDF...`, 'info');

    const inputEl = side === 'front'
      ? document.getElementById('uploadFrontInput')
      : document.getElementById('uploadBackInput');
    if (inputEl) inputEl.disabled = true;

    fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/template/upload-pdf/' + side + '/', {
      method:  'POST',
      headers: {
        'X-CSRFToken':       getCookie('csrftoken'),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: formData,
    })
    .then(function(r) {
      if (!r.ok) {
        return parseJsonResponse(r, 'Upload failed.').then(function(data) {
          throw new Error((data && (data.message || data.error)) || 'Upload failed.');
        });
      }
      return parseJsonResponse(r, 'Upload failed.');
    })
    .then(data => {
      if (!data || data.status !== 'ok') {
        showToast((data && (data.message || data.error)) || 'Upload failed.', 'error');
        return;
      }
      if (!data.pdf_url) {
        showToast('Design uploaded but no preview URL returned.', 'error');
        return;
      }
      showToast(`${side.charAt(0).toUpperCase() + side.slice(1)} design PDF uploaded!`, 'success');
      var freshUrl = data.pdf_url + (data.pdf_url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      if (side === 'front') {
        FRONT_PDF_URL = freshUrl;
      } else {
        BACK_PDF_URL = freshUrl;
      }

      clearGeneratedPreview();
      clearEditableDesignModel(side);

      renderPdf(freshUrl, 0, side);
      updateSetupStatus();
      updateGenerateBtn();
    })
    .catch(err => {
      console.error(err);
      showToast('Upload failed.', 'error');
    })
    .finally(() => {
      if (inputEl) {
        inputEl.disabled = false;
        inputEl.value = '';
      }
      updateSetupStatus();
    });
  }

  function removePdf(side) {
    const target = side === 'back' ? 'Back' : 'Front';
    const exists = side === 'back' ? hasBackPdf() : hasFrontPdf();
    if (!exists) {
      showToast(target + ' design PDF is already empty.', 'warning');
      return;
    }

    fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/template/clear-pdf/' + side + '/', {
      method: 'POST',
      headers: {
        'X-CSRFToken': getCookie('csrftoken'),
        'X-Requested-With': 'XMLHttpRequest',
      },
    })
    .then(function (r) {
      if (!r.ok) {
        return parseJsonResponse(r, 'Failed to remove template').then(function (data) {
          throw new Error((data && (data.message || data.error)) || 'Failed to remove template');
        });
      }
      return parseJsonResponse(r, 'Failed to remove template');
    })
    .then(function () {
      if (side === 'front') FRONT_PDF_URL = '';
      if (side === 'back') BACK_PDF_URL = '';

      exitDrawMode();
      fieldMappings[side] = {};
      clearGeneratedPreview();
      clearEditableDesignModel(side);

      clearCanvasBackground(side);
      renderMappingsOnCanvas();
      renderPlacedFields();

      updateSetupStatus();
      updateGenerateBtn();
      showToast(target + ' design PDF removed.', 'success');
      updateSideBySidePreview();
    })
    .catch(function (err) {
      console.error(err);
      showToast(err.message || ('Failed to remove ' + target + ' design PDF.'), 'error');
    });
  }

  function clearTransientUploadedPdfsOnClose() {
    if (!isInlineModalEditor) return Promise.resolve();
    if (templatePersistedThisSession) return Promise.resolve();

    const sidesToClearPdf = [];
    if (hasFrontPdf()) sidesToClearPdf.push('front');
    if (hasBackPdf()) sidesToClearPdf.push('back');

    if (!sidesToClearPdf.length) return Promise.resolve();

    const clearJobs = [];
    sidesToClearPdf.forEach(function (side) {
      clearJobs.push(fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/template/clear-pdf/' + side + '/', {
        method: 'POST',
        keepalive: true,
        headers: {
          'X-CSRFToken': getCookie('csrftoken'),
          'X-Requested-With': 'XMLHttpRequest',
        },
      }).catch(function (err) {
        console.warn('[gcEditorBeforeClose] clear transient design PDF failed for', side, err);
      }));
    });

    return Promise.allSettled(clearJobs).then(function () {
      if (sidesToClearPdf.indexOf('front') >= 0) FRONT_PDF_URL = '';
      if (sidesToClearPdf.indexOf('back') >= 0) BACK_PDF_URL = '';
    });
  }

  /*  HELPERS  */

  function getCookie(name) {
    const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? m.pop() : '';
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // showToast: uses global toast utility if available, else console
  function showToast(msg, type) {
    if ((type === 'error' || type === 'warning') && showModalAlert(msg, type)) {
      return;
    }
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    } else {
      console.log(`[${type}] ${msg}`);
    }
  }

  function showModalAlert(msg, type) {
    if (!isInlineModalEditor) return false;

    const overlay = document.getElementById('gcEditorModal');
    const alertBar = document.getElementById('gcEditorAlertBar');
    if (!overlay || !alertBar || overlay.classList.contains('hidden')) return false;

    alertBar.textContent = String(msg || 'Something went wrong.');
    alertBar.classList.remove('hidden', 'gc-alert-error', 'gc-alert-warning');
    alertBar.classList.add(type === 'warning' ? 'gc-alert-warning' : 'gc-alert-error');

    if (modalAlertTimer) clearTimeout(modalAlertTimer);
    modalAlertTimer = setTimeout(function () {
      alertBar.classList.add('hidden');
    }, 6500);

    return true;
  }

  function clearModalAlert() {
    if (!isInlineModalEditor) return;
    const alertBar = document.getElementById('gcEditorAlertBar');
    if (!alertBar) return;
    if (modalAlertTimer) {
      clearTimeout(modalAlertTimer);
      modalAlertTimer = null;
    }
    alertBar.classList.add('hidden');
    alertBar.textContent = '';
  }

})();
