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
  let editableMultiSelectionBySide = { front: [], back: [] };
  let mappingConfidenceBySide = { front: {}, back: {} };
  let lowConfidenceQueueBySide = { front: [], back: [] };
  let lowConfidenceCursorBySide = { front: 0, back: 0 };
  let compareSnapshotCursor = -1;
  let showGuides = true;
  let lockMappedBlocks = false;
  let docPageSettings = null;
  let docLayoutLibrary = [];
  let activeDocLayoutId = '';
  const EDITOR_HISTORY_LIMIT = 80;
  let editorHistoryStack = [];
  let editorHistoryCursor = -1;
  let historyApplying = false;

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
  let currentEditorFlowStep = 'setup';
  let flowMapUnlocked = false;
  let flowCardSettingsExpanded = false;
  const GENERATE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
  const isInlineModalEditor = !!document.getElementById('gcEditorModal');
  const printApiBases = resolvePrintApiBases();

  function normalizeOrientation(value) {
    return value === 'portrait' ? 'portrait' : 'landscape';
  }

  function defaultDocPageSettings() {
    return {
      margins_mm: { left: 3, right: 3, top: 3, bottom: 3 },
      line_gap_mm: 2.5,
      wrap_mode: 'margin',
      snap_to_guides: true,
      guides_x_mm: [],
      guides_y_mm: [],
    };
  }

  function parseGuideList(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      return raw.split(/[\s,;|]+/g).filter(function (x) { return String(x || '').trim().length > 0; });
    }
    return [];
  }

  function normalizeGuideList(raw, maxMm) {
    const out = [];
    const seen = new Set();
    parseGuideList(raw).forEach(function (v) {
      const n = clampNumber(v, 0, maxMm, -1);
      if (n < 0) return;
      const rounded = Math.round(n * 100) / 100;
      const key = rounded.toFixed(2);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(rounded);
    });
    return out.slice(0, 24);
  }

  function normalizeDocPageSettings(raw, orientation) {
    const safeOrientation = normalizeOrientation(orientation || cardOrientation);
    const cardW = safeOrientation === 'portrait' ? PORTRAIT_W_MM : LANDSCAPE_W_MM;
    const cardH = safeOrientation === 'portrait' ? PORTRAIT_H_MM : LANDSCAPE_H_MM;
    const src = (raw && typeof raw === 'object') ? raw : {};
    const defaults = defaultDocPageSettings();
    const margins = (src.margins_mm && typeof src.margins_mm === 'object') ? src.margins_mm : {};

    let left = clampNumber(margins.left, 0, 25, defaults.margins_mm.left);
    let right = clampNumber(margins.right, 0, 25, defaults.margins_mm.right);
    let top = clampNumber(margins.top, 0, 25, defaults.margins_mm.top);
    let bottom = clampNumber(margins.bottom, 0, 25, defaults.margins_mm.bottom);

    const maxHorizontal = Math.max(4, cardW - 8);
    if ((left + right) > maxHorizontal) {
      const ratioH = maxHorizontal / Math.max(0.1, left + right);
      left = left * ratioH;
      right = right * ratioH;
    }

    const maxVertical = Math.max(4, cardH - 8);
    if ((top + bottom) > maxVertical) {
      const ratioV = maxVertical / Math.max(0.1, top + bottom);
      top = top * ratioV;
      bottom = bottom * ratioV;
    }

    const wrapRaw = String(src.wrap_mode || defaults.wrap_mode).toLowerCase();
    const wrapMode = (wrapRaw === 'box') ? 'box' : 'margin';

    return {
      margins_mm: {
        left: Math.round(left * 100) / 100,
        right: Math.round(right * 100) / 100,
        top: Math.round(top * 100) / 100,
        bottom: Math.round(bottom * 100) / 100,
      },
      line_gap_mm: Math.round(clampNumber(src.line_gap_mm, 0, 12, defaults.line_gap_mm) * 100) / 100,
      wrap_mode: wrapMode,
      snap_to_guides: (typeof src.snap_to_guides === 'undefined') ? true : !!src.snap_to_guides,
      guides_x_mm: normalizeGuideList(src.guides_x_mm, cardW),
      guides_y_mm: normalizeGuideList(src.guides_y_mm, cardH),
    };
  }

  function getCurrentDocPageSettings() {
    docPageSettings = normalizeDocPageSettings(docPageSettings, cardOrientation);
    return docPageSettings;
  }

  function guidesToInputValue(list) {
    if (!Array.isArray(list) || !list.length) return '';
    return list.map(function (n) {
      const rounded = Math.round(Number(n || 0) * 100) / 100;
      if (Math.abs(rounded - Math.round(rounded)) < 0.001) return String(Math.round(rounded));
      return String(rounded);
    }).join(', ');
  }

  function syncDocPageSettingsInputs() {
    const settings = getCurrentDocPageSettings();
    const margins = settings.margins_mm || {};

    const marginTopInput = document.getElementById('marginTopInput');
    const marginRightInput = document.getElementById('marginRightInput');
    const marginBottomInput = document.getElementById('marginBottomInput');
    const marginLeftInput = document.getElementById('marginLeftInput');
    const lineGapInput = document.getElementById('lineGapInput');
    const wrapModeSelect = document.getElementById('wrapModeSelect');
    const snapGuidesToggle = document.getElementById('snapGuidesToggle');
    const verticalGuidesInput = document.getElementById('verticalGuidesInput');
    const horizontalGuidesInput = document.getElementById('horizontalGuidesInput');

    if (marginTopInput) marginTopInput.value = String(margins.top || 0);
    if (marginRightInput) marginRightInput.value = String(margins.right || 0);
    if (marginBottomInput) marginBottomInput.value = String(margins.bottom || 0);
    if (marginLeftInput) marginLeftInput.value = String(margins.left || 0);
    if (lineGapInput) lineGapInput.value = String(settings.line_gap_mm || 0);
    if (wrapModeSelect) wrapModeSelect.value = settings.wrap_mode || 'margin';
    if (snapGuidesToggle) snapGuidesToggle.checked = !!settings.snap_to_guides;
    if (verticalGuidesInput) verticalGuidesInput.value = guidesToInputValue(settings.guides_x_mm || []);
    if (horizontalGuidesInput) horizontalGuidesInput.value = guidesToInputValue(settings.guides_y_mm || []);
  }

  function syncLockMappedBlocksInput() {
    const lockToggle = document.getElementById('lockMappedBlocksToggle');
    if (lockToggle) lockToggle.checked = !!lockMappedBlocks;
  }

  function readDocPageSettingsFromInputs() {
    const source = getCurrentDocPageSettings();
    const margins = source.margins_mm || {};
    const marginTopInput = document.getElementById('marginTopInput');
    const marginRightInput = document.getElementById('marginRightInput');
    const marginBottomInput = document.getElementById('marginBottomInput');
    const marginLeftInput = document.getElementById('marginLeftInput');
    const lineGapInput = document.getElementById('lineGapInput');
    const wrapModeSelect = document.getElementById('wrapModeSelect');
    const snapGuidesToggle = document.getElementById('snapGuidesToggle');
    const verticalGuidesInput = document.getElementById('verticalGuidesInput');
    const horizontalGuidesInput = document.getElementById('horizontalGuidesInput');

    const next = {
      margins_mm: {
        top: marginTopInput ? Number(marginTopInput.value) : margins.top,
        right: marginRightInput ? Number(marginRightInput.value) : margins.right,
        bottom: marginBottomInput ? Number(marginBottomInput.value) : margins.bottom,
        left: marginLeftInput ? Number(marginLeftInput.value) : margins.left,
      },
      line_gap_mm: lineGapInput ? Number(lineGapInput.value) : source.line_gap_mm,
      wrap_mode: wrapModeSelect ? String(wrapModeSelect.value || 'margin') : source.wrap_mode,
      snap_to_guides: snapGuidesToggle ? !!snapGuidesToggle.checked : !!source.snap_to_guides,
      guides_x_mm: verticalGuidesInput ? verticalGuidesInput.value : source.guides_x_mm,
      guides_y_mm: horizontalGuidesInput ? horizontalGuidesInput.value : source.guides_y_mm,
    };

    docPageSettings = normalizeDocPageSettings(next, cardOrientation);
    syncDocPageSettingsInputs();
    return docPageSettings;
  }

  function getMarginBoxPx() {
    const settings = getCurrentDocPageSettings();
    const margins = settings.margins_mm || {};
    const cardW = getCardWidthPx();
    const cardH = getCardHeightPx();
    const left = clampNumber(margins.left, 0, 25, 3) * SCALE;
    const rightInset = clampNumber(margins.right, 0, 25, 3) * SCALE;
    const top = clampNumber(margins.top, 0, 25, 3) * SCALE;
    const bottomInset = clampNumber(margins.bottom, 0, 25, 3) * SCALE;
    const right = Math.max(left + 10, cardW - rightInset);
    const bottom = Math.max(top + 10, cardH - bottomInset);
    return {
      left: left,
      right: right,
      top: top,
      bottom: bottom,
      width: Math.max(10, right - left),
      height: Math.max(10, bottom - top),
    };
  }

  function getMarginBoxMm() {
    const box = getMarginBoxPx();
    return {
      left: box.left / SCALE,
      right: box.right / SCALE,
      top: box.top / SCALE,
      bottom: box.bottom / SCALE,
      width: box.width / SCALE,
      height: box.height / SCALE,
    };
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

  function readTextAlignValue() {
    const el = document.getElementById('textAlignSelect');
    const fallback = String(TEMPLATE_DATA && TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.text_align || 'left').toLowerCase();
    const raw = String((el && el.value) ? el.value : fallback).toLowerCase();
    return (raw === 'center' || raw === 'right') ? raw : 'left';
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

  function clearEditableSelection(side, opts) {
    const options = opts || {};
    const targetSide = side === 'back' ? 'back' : 'front';
    const prev = editableSelectedBlockBySide[targetSide];
    if (prev && prev.el && prev.el.classList) {
      prev.el.classList.remove('is-selected');
    }
    editableSelectedBlockBySide[targetSide] = null;
    if (!options.preserveMulti) {
      clearMultiSelection(targetSide);
    }
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

  function normalizeDocLayoutLibrary(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    raw.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      const id = String(item.id || '').trim();
      const name = String(item.name || '').trim();
      const savedAt = String(item.saved_at || '').trim();
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return;
      if (!name) return;
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id: id, name: name.slice(0, 80), saved_at: savedAt.slice(0, 40) });
    });
    return out;
  }

  function updateGuidesButton() {
    const btn = document.getElementById('toggleGuidesBtn');
    if (!btn) return;
    btn.textContent = showGuides ? 'Hide Guides' : 'Show Guides';
  }

  function renderDocLayoutPicker() {
    const select = document.getElementById('docLayoutSelect');
    if (!select) return;

    const current = String(activeDocLayoutId || '').trim();
    const options = ['<option value="">Select saved DOC</option>'];
    docLayoutLibrary.forEach(function (item) {
      const isSelected = current && item.id === current ? ' selected' : '';
      const label = escHtml(item.name + (item.saved_at ? (' (' + item.saved_at.slice(0, 16).replace('T', ' ') + ')') : ''));
      options.push('<option value="' + escHtml(item.id) + '"' + isSelected + '>' + label + '</option>');
    });
    select.innerHTML = options.join('');
  }

  function syncDocLayoutLibraryFromTemplate(template) {
    docLayoutLibrary = normalizeDocLayoutLibrary(template && template.doc_layout_library);
    const candidateId = String(template && template.active_doc_layout_id || '').trim();
    activeDocLayoutId = docLayoutLibrary.some(function (x) { return x.id === candidateId; }) ? candidateId : '';
    renderDocLayoutPicker();
  }

  function setGuidesVisible(value) {
    showGuides = !!value;
    updateGuidesButton();
    renderEditableDesignLayer('front');
    renderEditableDesignLayer('back');
  }

  function blockSelectionKey(type, index) {
    return String(type || '') + ':' + String(Number(index));
  }

  function normalizeBlockSelectionList(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    const seen = new Set();
    list.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      const type = item.type === 'image' ? 'image' : 'line';
      const index = Number(item.index);
      if (!Number.isInteger(index) || index < 0) return;
      const key = blockSelectionKey(type, index);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ type: type, index: index });
    });
    return out;
  }

  function getMultiSelection(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    return normalizeBlockSelectionList(editableMultiSelectionBySide[targetSide]);
  }

  function isBlockInMultiSelection(side, blockType, blockIndex) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const key = blockSelectionKey(blockType, blockIndex);
    return getMultiSelection(targetSide).some(function (entry) {
      return blockSelectionKey(entry.type, entry.index) === key;
    });
  }

  function updateMultiSelectHint(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const hint = document.getElementById('multiSelectHint');
    if (!hint) return;
    const count = getMultiSelection(targetSide).length;
    if (count <= 0) {
      hint.textContent = 'Tip: Shift+Click blocks to multi-select. Hold Alt and drag on empty canvas area to box-select.';
      return;
    }
    hint.textContent = count + ' block(s) selected. Use Group Left/Center/Right and Distribute tools.';
  }

  function setMultiSelection(side, nextSelection) {
    const targetSide = side === 'back' ? 'back' : 'front';
    editableMultiSelectionBySide[targetSide] = normalizeBlockSelectionList(nextSelection);
    updateMultiSelectHint(targetSide);
  }

  function clearMultiSelection(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    editableMultiSelectionBySide[targetSide] = [];
    updateMultiSelectHint(targetSide);
  }

  function toggleMultiSelectionEntry(side, blockType, blockIndex) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const key = blockSelectionKey(blockType, blockIndex);
    const base = getMultiSelection(targetSide);
    const exists = base.some(function (entry) { return blockSelectionKey(entry.type, entry.index) === key; });
    const next = exists
      ? base.filter(function (entry) { return blockSelectionKey(entry.type, entry.index) !== key; })
      : base.concat([{ type: blockType === 'image' ? 'image' : 'line', index: Number(blockIndex) }]);
    setMultiSelection(targetSide, next);
  }

  function setSingleSelection(side, blockType, blockIndex) {
    const targetSide = side === 'back' ? 'back' : 'front';
    setMultiSelection(targetSide, [{ type: blockType === 'image' ? 'image' : 'line', index: Number(blockIndex) }]);
  }

  function loadEditableDesignFromTemplate(template) {
    const frontModel = normalizeEditableDesignModel(template && template.editable_design_front);
    const backModel = normalizeEditableDesignModel(template && template.editable_design_back);

    editableDesignModels.front = frontModel;
    editableModeBySide.front = !!frontModel;
    editableDesignModels.back = backModel;
    editableModeBySide.back = !!backModel;
    if (frontModel) {
      runAutoCollisionRepairForSide('front', 3);
    }
    if (backModel) {
      runAutoCollisionRepairForSide('back', 3);
    }
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

  function setEditableSelection(side, blockType, blockIndex, el, opts) {
    const options = opts || {};
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

    if (options.additive) {
      toggleMultiSelectionEntry(targetSide, blockType, blockIndex);
      if (!isBlockInMultiSelection(targetSide, blockType, blockIndex)) {
        editableSelectedBlockBySide[targetSide] = null;
        el.classList.remove('is-selected');
      }
    } else if (!options.preserveMulti) {
      setSingleSelection(targetSide, blockType, blockIndex);
    }

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

  function isEditorShortcutContextActive() {
    if (!isInlineModalEditor) return true;
    const overlay = document.getElementById('gcEditorModal');
    return !!(overlay && !overlay.classList.contains('hidden'));
  }

  function normalizedUniqueSortedIndices(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    const seen = new Set();
    list.forEach(function (value) {
      const idx = Number(value);
      if (!Number.isInteger(idx) || idx < 0) return;
      if (seen.has(idx)) return;
      seen.add(idx);
      out.push(idx);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function parseNonNegativeSourceIndex(value) {
    if (typeof value === 'number') {
      return (Number.isInteger(value) && value >= 0) ? value : null;
    }
    if (typeof value === 'string') {
      const raw = value.trim();
      if (!/^\d+$/.test(raw)) return null;
      const parsed = Number(raw);
      return Number.isInteger(parsed) ? parsed : null;
    }
    return null;
  }

  function remapSourceIndexAfterRemoval(sourceIndex, removedAscList) {
    const idx = parseNonNegativeSourceIndex(sourceIndex);
    if (idx === null) return null;
    if (!Array.isArray(removedAscList) || !removedAscList.length) return idx;

    let shift = 0;
    for (let i = 0; i < removedAscList.length; i += 1) {
      const removed = removedAscList[i];
      if (removed === idx) return null;
      if (removed < idx) shift += 1;
    }
    return idx - shift;
  }

  function removeSourceBlocksAndReindexMappings(side, lineIndicesRaw, imageIndicesRaw) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    if (!model) return false;

    const lineIndices = normalizedUniqueSortedIndices(lineIndicesRaw);
    const imageIndices = normalizedUniqueSortedIndices(imageIndicesRaw);
    if (!lineIndices.length && !imageIndices.length) return false;

    if (lineIndices.length && Array.isArray(model.lines)) {
      const lineSet = new Set(lineIndices);
      model.lines = model.lines.filter(function (_item, idx) {
        return !lineSet.has(idx);
      });
    }

    if (imageIndices.length && Array.isArray(model.images)) {
      const imageSet = new Set(imageIndices);
      model.images = model.images.filter(function (_item, idx) {
        return !imageSet.has(idx);
      });
    }

    const sideMappings = (fieldMappings && fieldMappings[targetSide] && typeof fieldMappings[targetSide] === 'object')
      ? fieldMappings[targetSide]
      : null;
    const sideConfidence = (mappingConfidenceBySide && mappingConfidenceBySide[targetSide] && typeof mappingConfidenceBySide[targetSide] === 'object')
      ? mappingConfidenceBySide[targetSide]
      : null;
    if (!sideMappings) return true;

    Object.keys(sideMappings).forEach(function (fieldName) {
      const mapping = sideMappings[fieldName];
      if (!mapping || typeof mapping !== 'object') {
        delete sideMappings[fieldName];
        if (sideConfidence) delete sideConfidence[fieldName];
        return;
      }

      const lineSourceIdx = parseNonNegativeSourceIndex(mapping.source_line_idx);
      const imageSourceIdx = parseNonNegativeSourceIndex(mapping.source_image_idx);
      const hasLineSource = lineSourceIdx !== null;
      const hasImageSource = imageSourceIdx !== null;
      const nextLineIdx = hasLineSource ? remapSourceIndexAfterRemoval(lineSourceIdx, lineIndices) : null;
      const nextImageIdx = hasImageSource ? remapSourceIndexAfterRemoval(imageSourceIdx, imageIndices) : null;

      if ((hasLineSource && nextLineIdx === null) || (hasImageSource && nextImageIdx === null)) {
        delete sideMappings[fieldName];
        if (sideConfidence) delete sideConfidence[fieldName];
        return;
      }

      if (hasLineSource) mapping.source_line_idx = nextLineIdx;
      if (hasImageSource) mapping.source_image_idx = nextImageIdx;
    });

    return true;
  }

  function deleteSelectedEditableContent(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const sel = getEditableSelection(targetSide);
    if (!sel || !sel.el || !sel.el.isConnected) return false;
    if (isSelectionLockedByMapping(targetSide, sel)) {
      notifyMappedBlockLocked();
      return false;
    }

    const model = editableDesignModels[targetSide];
    if (!model) return false;

    if (sel.type === 'line') {
      if (!Array.isArray(model.lines) || !model.lines[sel.index]) return false;
      if (!removeSourceBlocksAndReindexMappings(targetSide, [sel.index], [])) return false;
      clearEditableSelection(targetSide);
      renderEditableDesignLayer(targetSide);
      renderMappingsOnSide(targetSide);
      return true;
    }

    if (sel.type === 'image') {
      if (!Array.isArray(model.images) || !model.images[sel.index]) return false;
      if (!removeSourceBlocksAndReindexMappings(targetSide, [], [sel.index])) return false;
      clearEditableSelection(targetSide);
      renderEditableDesignLayer(targetSide);
      renderMappingsOnSide(targetSide);
      return true;
    }

    return false;
  }

  function nudgeSelectedEditableContent(side, dxPx, dyPx) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const sel = getEditableSelection(targetSide);
    if (!sel || !sel.el || !sel.el.isConnected) return false;
    if (isSelectionLockedByMapping(targetSide, sel)) {
      notifyMappedBlockLocked();
      return false;
    }
    const model = editableDesignModels[targetSide];
    if (!model) return false;

    let rect = readEditableElementRectMm(sel.el);
    let leftPx = (rect.x_mm * SCALE) + Number(dxPx || 0);
    let topPx = (rect.y_mm * SCALE) + Number(dyPx || 0);
    const widthPx = Math.max(8, rect.w_mm * SCALE);
    const heightPx = Math.max(8, rect.h_mm * SCALE);
    const cardW = getCardWidthPx();
    const cardH = getCardHeightPx();

    leftPx = Math.max(0, Math.min(cardW - widthPx, leftPx));
    topPx = Math.max(0, Math.min(cardH - heightPx, topPx));
    const snapped = snapDragPositionPx(leftPx, topPx, widthPx, heightPx);

    if (sel.type === 'line') {
      if (!Array.isArray(model.lines) || !model.lines[sel.index]) return false;
      model.lines[sel.index].x_mm = Math.round((snapped.left / SCALE) * 100) / 100;
      model.lines[sel.index].y_mm = Math.round((snapped.top / SCALE) * 100) / 100;
      syncMappingsForSourceLine(targetSide, sel.index);
    } else if (sel.type === 'image') {
      if (!Array.isArray(model.images) || !model.images[sel.index]) return false;
      model.images[sel.index].x_mm = Math.round((snapped.left / SCALE) * 100) / 100;
      model.images[sel.index].y_mm = Math.round((snapped.top / SCALE) * 100) / 100;
    } else {
      return false;
    }

    renderEditableDesignLayer(targetSide);
    renderMappingsOnSide(targetSide);
    restoreEditableSelection(targetSide, sel.type, sel.index);
    updateGenerateBtn();
    updateSetupStatus();
    return true;
  }

  function duplicateSelectedEditableContent(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const sel = getEditableSelection(targetSide);
    if (!sel || !sel.el || !sel.el.isConnected) return false;
    if (isSelectionLockedByMapping(targetSide, sel)) {
      notifyMappedBlockLocked();
      return false;
    }
    const model = editableDesignModels[targetSide];
    if (!model) return false;

    const offsetMm = 1.6;
    if (sel.type === 'line') {
      if (!Array.isArray(model.lines) || !model.lines[sel.index]) return false;
      const src = model.lines[sel.index];
      const dup = cloneDeep(src);
      const maxX = Math.max(0, getCardWidthMm() - Math.max(1, Number(dup.w_mm || 1)));
      const maxY = Math.max(0, getCardHeightMm() - Math.max(1, Number(dup.h_mm || 1)));
      dup.x_mm = Math.round(Math.max(0, Math.min(maxX, Number(src.x_mm || 0) + offsetMm)) * 100) / 100;
      dup.y_mm = Math.round(Math.max(0, Math.min(maxY, Number(src.y_mm || 0) + offsetMm)) * 100) / 100;
      model.lines.push(dup);
      const newIndex = model.lines.length - 1;
      renderEditableDesignLayer(targetSide);
      renderMappingsOnSide(targetSide);
      restoreEditableSelection(targetSide, 'line', newIndex);
      updateGenerateBtn();
      updateSetupStatus();
      return true;
    }

    if (sel.type === 'image') {
      if (!Array.isArray(model.images) || !model.images[sel.index]) return false;
      const srcImg = model.images[sel.index];
      const dupImg = cloneDeep(srcImg);
      const maxX = Math.max(0, getCardWidthMm() - Math.max(1, Number(dupImg.w_mm || 1)));
      const maxY = Math.max(0, getCardHeightMm() - Math.max(1, Number(dupImg.h_mm || 1)));
      dupImg.x_mm = Math.round(Math.max(0, Math.min(maxX, Number(srcImg.x_mm || 0) + offsetMm)) * 100) / 100;
      dupImg.y_mm = Math.round(Math.max(0, Math.min(maxY, Number(srcImg.y_mm || 0) + offsetMm)) * 100) / 100;
      model.images.push(dupImg);
      const newImageIndex = model.images.length - 1;
      renderEditableDesignLayer(targetSide);
      renderMappingsOnSide(targetSide);
      restoreEditableSelection(targetSide, 'image', newImageIndex);
      updateGenerateBtn();
      updateSetupStatus();
      return true;
    }

    return false;
  }

  function getSelectionEntriesForSide(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const multi = getMultiSelection(targetSide);
    if (multi.length) return multi;
    const sel = getEditableSelection(targetSide);
    if (!sel) return [];
    return [{ type: sel.type, index: sel.index }];
  }

  function getBlockRectMmForSelection(side, entry) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    if (!model || !entry) return null;
    if (entry.type === 'image') {
      const img = Array.isArray(model.images) ? model.images[entry.index] : null;
      if (!img) return null;
      return {
        x_mm: Number(img.x_mm || 0),
        y_mm: Number(img.y_mm || 0),
        w_mm: Math.max(0.5, Number(img.w_mm || 1)),
        h_mm: Math.max(0.5, Number(img.h_mm || 1)),
      };
    }
    const line = Array.isArray(model.lines) ? model.lines[entry.index] : null;
    if (!line) return null;
    return {
      x_mm: Number(line.x_mm || 0),
      y_mm: Number(line.y_mm || 0),
      w_mm: Math.max(0.5, Number(line.w_mm || 1)),
      h_mm: Math.max(0.5, Number(line.h_mm || 1)),
    };
  }

  function setBlockPositionMm(side, entry, xMm, yMm) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    if (!model || !entry) return false;

    if (entry.type === 'image') {
      const img = Array.isArray(model.images) ? model.images[entry.index] : null;
      if (!img) return false;
      img.x_mm = roundMm(xMm);
      img.y_mm = roundMm(yMm);
      return true;
    }

    const line = Array.isArray(model.lines) ? model.lines[entry.index] : null;
    if (!line) return false;
    line.x_mm = roundMm(xMm);
    line.y_mm = roundMm(yMm);
    syncMappingsForSourceLine(targetSide, entry.index);
    return true;
  }

  function nudgeMultiSelectedContent(side, dxPx, dyPx) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const entries = getSelectionEntriesForSide(targetSide);
    if (!entries.length) return false;

    const cardW = getCardWidthMm();
    const cardH = getCardHeightMm();
    const dxMm = Number(dxPx || 0) / SCALE;
    const dyMm = Number(dyPx || 0) / SCALE;
    let changed = false;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (lockMappedBlocks && isMappedSourceBlock(targetSide, entry.type, entry.index)) {
        notifyMappedBlockLocked();
        return false;
      }

      const rect = getBlockRectMmForSelection(targetSide, entry);
      if (!rect) continue;
      const maxX = Math.max(0, cardW - rect.w_mm);
      const maxY = Math.max(0, cardH - rect.h_mm);
      const nextX = Math.max(0, Math.min(maxX, rect.x_mm + dxMm));
      const nextY = Math.max(0, Math.min(maxY, rect.y_mm + dyMm));
      if (Math.abs(nextX - rect.x_mm) > 0.001 || Math.abs(nextY - rect.y_mm) > 0.001) {
        setBlockPositionMm(targetSide, entry, nextX, nextY);
        changed = true;
      }
    }

    if (!changed) return false;
    const first = entries[0];
    renderEditableDesignLayer(targetSide);
    renderMappingsOnSide(targetSide);
    restoreEditableSelection(targetSide, first.type, first.index);
    updateGenerateBtn();
    updateSetupStatus();
    return true;
  }

  function alignMultiSelectedBlocks(side, mode) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const entries = getMultiSelection(targetSide);
    if (entries.length < 2) return 0;

    const normalizedMode = (mode === 'center' || mode === 'right') ? mode : 'left';
    const rects = entries.map(function (entry) {
      return { entry: entry, rect: getBlockRectMmForSelection(targetSide, entry) };
    }).filter(function (item) { return !!item.rect; });
    if (rects.length < 2) return 0;

    for (let i = 0; i < rects.length; i += 1) {
      const item = rects[i];
      if (lockMappedBlocks && isMappedSourceBlock(targetSide, item.entry.type, item.entry.index)) {
        notifyMappedBlockLocked();
        return 0;
      }
    }

    const leftEdge = Math.min.apply(null, rects.map(function (item) { return item.rect.x_mm; }));
    const rightEdge = Math.max.apply(null, rects.map(function (item) { return item.rect.x_mm + item.rect.w_mm; }));
    const centerX = leftEdge + ((rightEdge - leftEdge) / 2);

    let changed = 0;
    rects.forEach(function (item) {
      const rect = item.rect;
      const cardW = getCardWidthMm();
      let nextX = leftEdge;
      if (normalizedMode === 'center') {
        nextX = centerX - (rect.w_mm / 2);
      } else if (normalizedMode === 'right') {
        nextX = rightEdge - rect.w_mm;
      }
      nextX = Math.max(0, Math.min(Math.max(0, cardW - rect.w_mm), nextX));
      if (Math.abs(nextX - rect.x_mm) > 0.001) {
        setBlockPositionMm(targetSide, item.entry, nextX, rect.y_mm);
        changed += 1;
      }
    });

    if (!changed) return 0;
    const first = entries[0];
    renderEditableDesignLayer(targetSide);
    renderMappingsOnSide(targetSide);
    restoreEditableSelection(targetSide, first.type, first.index);
    updateGenerateBtn();
    updateSetupStatus();
    return changed;
  }

  function distributeMultiSelectedBlocks(side, axis) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const entries = getMultiSelection(targetSide);
    if (entries.length < 3) return 0;

    const isVertical = axis === 'y';
    const ordered = entries.map(function (entry) {
      const rect = getBlockRectMmForSelection(targetSide, entry);
      if (!rect) return null;
      if (lockMappedBlocks && isMappedSourceBlock(targetSide, entry.type, entry.index)) return null;
      return {
        entry: entry,
        rect: rect,
        center: isVertical ? (rect.y_mm + (rect.h_mm / 2)) : (rect.x_mm + (rect.w_mm / 2)),
      };
    }).filter(function (item) { return !!item; }).sort(function (a, b) {
      return a.center - b.center;
    });

    if (ordered.length < 3) {
      notifyMappedBlockLocked();
      return 0;
    }

    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const step = (last.center - first.center) / Math.max(1, ordered.length - 1);
    let changed = 0;

    ordered.forEach(function (item, idx) {
      if (idx === 0 || idx === ordered.length - 1) return;
      const targetCenter = first.center + (step * idx);
      const rect = item.rect;
      if (isVertical) {
        const cardH = getCardHeightMm();
        const nextY = Math.max(0, Math.min(Math.max(0, cardH - rect.h_mm), targetCenter - (rect.h_mm / 2)));
        if (Math.abs(nextY - rect.y_mm) > 0.001) {
          setBlockPositionMm(targetSide, item.entry, rect.x_mm, nextY);
          changed += 1;
        }
      } else {
        const cardW = getCardWidthMm();
        const nextX = Math.max(0, Math.min(Math.max(0, cardW - rect.w_mm), targetCenter - (rect.w_mm / 2)));
        if (Math.abs(nextX - rect.x_mm) > 0.001) {
          setBlockPositionMm(targetSide, item.entry, nextX, rect.y_mm);
          changed += 1;
        }
      }
    });

    if (!changed) return 0;
    const firstEntry = entries[0];
    renderEditableDesignLayer(targetSide);
    renderMappingsOnSide(targetSide);
    restoreEditableSelection(targetSide, firstEntry.type, firstEntry.index);
    updateGenerateBtn();
    updateSetupStatus();
    return changed;
  }

  function deleteMultiSelectedContent(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const entries = getMultiSelection(targetSide);
    if (entries.length < 2) return false;
    const model = editableDesignModels[targetSide];
    if (!model) return false;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (lockMappedBlocks && isMappedSourceBlock(targetSide, entry.type, entry.index)) {
        notifyMappedBlockLocked();
        return false;
      }
    }

    const imageIndices = entries
      .filter(function (entry) { return entry.type === 'image'; })
      .map(function (entry) { return entry.index; });

    const lineIndices = entries
      .filter(function (entry) { return entry.type === 'line'; })
      .map(function (entry) { return entry.index; });

    if (!removeSourceBlocksAndReindexMappings(targetSide, lineIndices, imageIndices)) return false;

    clearEditableSelection(targetSide);
    renderEditableDesignLayer(targetSide);
    renderMappingsOnSide(targetSide);
    updateGenerateBtn();
    updateSetupStatus();
    return true;
  }

  function onEditorKeydown(ev) {
    if (!isEditorShortcutContextActive()) return;

    const key = String((ev && ev.key) || '').toLowerCase();
    const hasModifier = !!(ev.ctrlKey || ev.metaKey);

    if (hasModifier && ev.altKey && key === 'r') {
      if (isTypingElement(ev.target)) return;
      ev.preventDefault();
      ev.stopPropagation();
      runMappingAuditCurrentSide();
      return;
    }

    if (hasModifier && !ev.altKey) {
      if (isTypingElement(ev.target)) return;
      if (key === 'z') {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.shiftKey) {
          redoEditorChange();
        } else {
          undoEditorChange();
        }
        return;
      }
      if (key === 'y') {
        ev.preventDefault();
        ev.stopPropagation();
        redoEditorChange();
        return;
      }
      if (key === 'm' && ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        runAutoMapCurrentSide();
        return;
      }
      if (key === 'l' && ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        const count = applyCurrentStyleToAllLines(currentSide);
        if (count > 0) {
          pushEditorHistory();
          showToast('Applied style to ' + count + ' line(s) on ' + (currentSide === 'back' ? 'Back' : 'Front') + '.', 'success');
        } else {
          showToast('No text lines found on this side.', 'info');
        }
        return;
      }
      if (key === 'f' && ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        runAutoFlowCurrentSide();
        return;
      }
      if (key === 'j' && ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        runDistributeLinesCurrentSide();
        return;
      }
      if (key === 'a' && ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        runBulkAlignCurrentSide();
        return;
      }
      if (key === 'h' && ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        const changed = distributeMultiSelectedBlocks(currentSide, 'x');
        if (changed > 0) {
          pushEditorHistory();
          showToast('Distributed selected blocks horizontally.', 'success');
        } else {
          showToast('Select at least 3 blocks to distribute horizontally.', 'info');
        }
        return;
      }
      if (key === 'v' && ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        const changed = distributeMultiSelectedBlocks(currentSide, 'y');
        if (changed > 0) {
          pushEditorHistory();
          showToast('Distributed selected blocks vertically.', 'success');
        } else {
          showToast('Select at least 3 blocks to distribute vertically.', 'info');
        }
        return;
      }
      if (key === 'k' && ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        runResolveCollisionsCurrentSide();
        return;
      }
      if (key === 'b' && ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        reviewNextLowConfidenceMapping(currentSide);
        return;
      }
      if (key === 'd' && hasEditableDesignForSide(currentSide) && !isTypingElement(ev.target)) {
        const duplicated = duplicateSelectedEditableContent(currentSide);
        if (!duplicated) return;
        ev.preventDefault();
        ev.stopPropagation();
        pushEditorHistory();
      }
      return;
    }

    if (!hasEditableDesignForSide(currentSide)) return;

    const sel = getEditableSelection(currentSide);
    if (!sel || !sel.el || !sel.el.isConnected) return;

    // When user is actively editing text, keep native keyboard behavior.
    if (sel.type === 'line' && sel.el.dataset && sel.el.dataset.editing === '1') {
      return;
    }
    if (isTypingElement(ev.target)) return;

    if (key === 'delete' || key === 'backspace') {
      if (getMultiSelection(currentSide).length > 1) {
        const multiChanged = deleteMultiSelectedContent(currentSide);
        if (!multiChanged) return;
        ev.preventDefault();
        ev.stopPropagation();
        pushEditorHistory();
        return;
      }
      const changed = deleteSelectedEditableContent(currentSide);
      if (!changed) return;
      ev.preventDefault();
      ev.stopPropagation();
      updateGenerateBtn();
      pushEditorHistory();
      return;
    }

    const nudgeStep = ev.shiftKey ? 5 : 1;
    if (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown') {
      let dx = 0;
      let dy = 0;
      if (key === 'arrowleft') dx = -nudgeStep;
      if (key === 'arrowright') dx = nudgeStep;
      if (key === 'arrowup') dy = -nudgeStep;
      if (key === 'arrowdown') dy = nudgeStep;
      const moved = getMultiSelection(currentSide).length > 1
        ? nudgeMultiSelectedContent(currentSide, dx, dy)
        : nudgeSelectedEditableContent(currentSide, dx, dy);
      if (!moved) return;
      ev.preventDefault();
      ev.stopPropagation();
      pushEditorHistory();
    }
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
    const textAlignInput = document.getElementById('textAlignSelect');

    const linePt = clampNumber(line.font_size_pt, 6, 72, readFontSizeValue());
    const lineFamily = String(line.font_family || readFontFamilyValue() || 'Arial').trim() || 'Arial';
    const lineWeightRaw = String(line.font_weight || '400').toLowerCase();
    const lineWeight = (lineWeightRaw === '700' || lineWeightRaw === 'bold')
      ? 'bold'
      : ((lineWeightRaw === '600' || lineWeightRaw === 'semibold') ? 'semibold' : 'normal');
    const lineHeight = clampNumber(line.line_height, 0.8, 3, readLineHeightValue());
    const charSpacing = clampNumber(line.char_spacing_pt, -5, 20, readCharSpacingValue());
    const color = normalizeHexColor(line.font_color_hex || readFontColorValue());
    const lineAlignRaw = String(line.text_align || readTextAlignValue()).toLowerCase();
    const lineAlign = (lineAlignRaw === 'center' || lineAlignRaw === 'right') ? lineAlignRaw : 'left';

    if (sizeInput) sizeInput.value = String(Math.round(linePt));
    if (familyInput) familyInput.value = lineFamily;
    if (weightInput) weightInput.value = lineWeight;
    if (lhInput) lhInput.value = String(lineHeight);
    if (csInput) csInput.value = String(charSpacing);
    if (colorInput) colorInput.value = color;
    if (colorTextInput) colorTextInput.value = color;
    if (textAlignInput) textAlignInput.value = lineAlign;

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
    const textAlign = readTextAlignValue();

    el.style.fontSize = fontPx + 'px';
    el.style.fontFamily = family;
    el.style.fontWeight = weight;
    el.style.lineHeight = String(lineHeight);
    el.style.letterSpacing = String(charSpacing) + 'pt';
    el.style.color = color;
    el.style.textAlign = textAlign;

    line.font_size_pt = Math.round(fontPt * 100) / 100;
    line.font_family = family;
    line.font_weight = weight;
    line.line_height = Math.round(lineHeight * 100) / 100;
    line.char_spacing_pt = Math.round(charSpacing * 100) / 100;
    line.font_color_hex = color;
    line.text_align = textAlign;
    autosizeEditableLineNode(el, line);
    syncMappingsForSourceLine(targetSide, sel.index);
    renderMappingsOnSide(targetSide);
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

  function syncMappingsForSourceLine(side, lineIndex) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const idx = Number(lineIndex);
    if (!Number.isInteger(idx) || idx < 0) return;
    const model = editableDesignModels[targetSide];
    const line = model && Array.isArray(model.lines) ? model.lines[idx] : null;
    if (!line || typeof line !== 'object') return;

    const sideMappings = (fieldMappings && fieldMappings[targetSide] && typeof fieldMappings[targetSide] === 'object')
      ? fieldMappings[targetSide]
      : null;
    if (!sideMappings) return;

    Object.keys(sideMappings).forEach(function (fieldName) {
      const mapping = sideMappings[fieldName];
      if (!mapping || typeof mapping !== 'object') return;
      if (Number(mapping.source_line_idx) !== idx) return;
      mapping.x_mm = Number(line.x_mm || 0);
      mapping.y_mm = Number(line.y_mm || 0);
      mapping.w_mm = Math.max(0.5, Number(line.w_mm || mapping.w_mm || 1));
      mapping.h_mm = Math.max(0.5, Number(line.h_mm || mapping.h_mm || 1));
    });
  }

  function isMappedSourceBlock(side, blockType, blockIndex) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const idx = Number(blockIndex);
    if (!Number.isInteger(idx) || idx < 0) return false;
    const sideMappings = (fieldMappings && fieldMappings[targetSide] && typeof fieldMappings[targetSide] === 'object')
      ? fieldMappings[targetSide]
      : {};
    return Object.keys(sideMappings).some(function (fieldName) {
      const mapping = sideMappings[fieldName];
      if (!mapping || typeof mapping !== 'object') return false;
      if (blockType === 'line') {
        return Number.isInteger(Number(mapping.source_line_idx)) && Number(mapping.source_line_idx) === idx;
      }
      if (blockType === 'image') {
        return Number.isInteger(Number(mapping.source_image_idx)) && Number(mapping.source_image_idx) === idx;
      }
      return false;
    });
  }

  function isSelectionLockedByMapping(side, selection) {
    if (!lockMappedBlocks) return false;
    if (!selection || !selection.type) return false;
    return isMappedSourceBlock(side, selection.type, selection.index);
  }

  function notifyMappedBlockLocked() {
    showToast('Mapped block lock is enabled. Turn it off to move, edit, or delete mapped content.', 'info');
  }

  function setLockMappedBlocks(value, opts) {
    const options = opts || {};
    const next = !!value;
    const changed = lockMappedBlocks !== next;
    lockMappedBlocks = next;
    syncLockMappedBlocksInput();

    if (!changed) return false;

    renderEditableDesignLayer('front');
    renderEditableDesignLayer('back');
    updateSetupStatus();
    updateGenerateBtn();

    if (!options.skipHistory) {
      pushEditorHistory();
    }

    if (!options.silent) {
      showToast(next ? 'Mapped block lock enabled.' : 'Mapped block lock disabled.', 'success');
    }
    return true;
  }

  function restoreEditableSelection(side, type, index) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const layer = getEditableLayerElement(targetSide);
    if (!layer) return false;
    let selector = '';
    if (type === 'line') {
      selector = '.gen-editable-line[data-idx="' + String(index) + '"]';
    } else if (type === 'image') {
      selector = '.gen-editable-image[data-idx="' + String(index) + '"]';
    } else {
      return false;
    }
    const el = layer.querySelector(selector);
    if (!el) return false;
    setEditableSelection(targetSide, type, index, el);
    return true;
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
      syncMappingsForSourceLine(targetSide, blockIndex);
    }
    if (blockType === 'image' && Array.isArray(model.images) && model.images[blockIndex]) {
      model.images[blockIndex].x_mm = Math.round(rect.x_mm * 100) / 100;
      model.images[blockIndex].y_mm = Math.round(rect.y_mm * 100) / 100;
      model.images[blockIndex].w_mm = Math.round(rect.w_mm * 100) / 100;
      model.images[blockIndex].h_mm = Math.round(rect.h_mm * 100) / 100;
    }
    renderMappingsOnSide(targetSide);
  }

  function appendGuideLine(layer, horizontal, posPx, kind) {
    const line = document.createElement('div');
    line.className = 'gen-guide-line ' + (horizontal ? 'is-horizontal' : 'is-vertical') + (kind ? (' is-' + kind) : '');
    if (horizontal) {
      line.style.top = posPx + 'px';
    } else {
      line.style.left = posPx + 'px';
    }
    layer.appendChild(line);
  }

  function renderGuideOverlay(layer) {
    const marginBox = getMarginBoxPx();
    const cardW = getCardWidthPx();
    const cardH = getCardHeightPx();
    const settings = getCurrentDocPageSettings();

    const marginRect = document.createElement('div');
    marginRect.className = 'gen-guide-margin-box';
    marginRect.style.left = marginBox.left + 'px';
    marginRect.style.top = marginBox.top + 'px';
    marginRect.style.width = marginBox.width + 'px';
    marginRect.style.height = marginBox.height + 'px';
    layer.appendChild(marginRect);

    appendGuideLine(layer, false, marginBox.left, 'margin');
    appendGuideLine(layer, false, marginBox.right, 'margin');
    appendGuideLine(layer, true, marginBox.top, 'margin');
    appendGuideLine(layer, true, marginBox.bottom, 'margin');

    appendGuideLine(layer, false, cardW / 2, 'center');
    appendGuideLine(layer, true, cardH / 2, 'center');

    const guidesX = Array.isArray(settings.guides_x_mm) ? settings.guides_x_mm : [];
    const guidesY = Array.isArray(settings.guides_y_mm) ? settings.guides_y_mm : [];
    guidesX.forEach(function (xMm) {
      appendGuideLine(layer, false, Number(xMm || 0) * SCALE, 'custom');
    });
    guidesY.forEach(function (yMm) {
      appendGuideLine(layer, true, Number(yMm || 0) * SCALE, 'custom');
    });
  }

  function snapValueToGuides(startPx, sizePx, guidePxList) {
    const thresholdPx = 5;
    const anchors = [
      { value: startPx, offset: 0 },
      { value: startPx + (sizePx / 2), offset: sizePx / 2 },
      { value: startPx + sizePx, offset: sizePx },
    ];

    let best = null;
    anchors.forEach(function (anchor) {
      guidePxList.forEach(function (guide) {
        const delta = guide - anchor.value;
        const dist = Math.abs(delta);
        if (dist > thresholdPx) return;
        if (!best || dist < best.dist) {
          best = { dist: dist, snapped: guide - anchor.offset };
        }
      });
    });

    return best ? best.snapped : startPx;
  }

  function snapDragPositionPx(leftPx, topPx, widthPx, heightPx) {
    const settings = getCurrentDocPageSettings();
    if (!settings.snap_to_guides || !showGuides) {
      return { left: leftPx, top: topPx };
    }

    const cardW = getCardWidthPx();
    const cardH = getCardHeightPx();
    const margin = getMarginBoxPx();
    const guidesX = [margin.left, margin.right, cardW / 2];
    const guidesY = [margin.top, margin.bottom, cardH / 2];

    (settings.guides_x_mm || []).forEach(function (xMm) {
      guidesX.push(Number(xMm || 0) * SCALE);
    });
    (settings.guides_y_mm || []).forEach(function (yMm) {
      guidesY.push(Number(yMm || 0) * SCALE);
    });

    const snappedLeft = snapValueToGuides(leftPx, widthPx, guidesX);
    const snappedTop = snapValueToGuides(topPx, heightPx, guidesY);

    return {
      left: Math.max(0, Math.min(cardW - widthPx, snappedLeft)),
      top: Math.max(0, Math.min(cardH - heightPx, snappedTop)),
    };
  }

  function autosizeEditableLineNode(node, line) {
    if (!node || !line) return;
    const baseHeightPx = Math.max(8, Number(line.h_mm || 3.6) * SCALE);
    const settings = getCurrentDocPageSettings();
    node.style.minHeight = baseHeightPx + 'px';

    if (settings.wrap_mode === 'margin') {
      node.style.height = 'auto';
      const measured = Math.max(baseHeightPx, Number(node.scrollHeight || baseHeightPx));
      node.style.height = measured + 'px';
      line.h_mm = roundMm(measured / SCALE);
    } else {
      node.style.height = baseHeightPx + 'px';
      line.h_mm = roundMm(baseHeightPx / SCALE);
    }
  }

  function readEditableLineText(node) {
    if (!node) return '';
    const value = String(node.innerText || node.textContent || '');
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function beginMarqueeSelection(side, layer, startEv) {
    const targetSide = side === 'back' ? 'back' : 'front';
    if (!layer || !startEv) return;
    const layerRect = layer.getBoundingClientRect();
    const startX = startEv.clientX - layerRect.left;
    const startY = startEv.clientY - layerRect.top;

    const marquee = document.createElement('div');
    marquee.className = 'gen-selection-marquee';
    marquee.style.left = startX + 'px';
    marquee.style.top = startY + 'px';
    marquee.style.width = '0px';
    marquee.style.height = '0px';
    layer.appendChild(marquee);

    function applyRect(clientX, clientY) {
      const x = clientX - layerRect.left;
      const y = clientY - layerRect.top;
      const left = Math.min(startX, x);
      const top = Math.min(startY, y);
      const width = Math.abs(x - startX);
      const height = Math.abs(y - startY);
      marquee.style.left = left + 'px';
      marquee.style.top = top + 'px';
      marquee.style.width = width + 'px';
      marquee.style.height = height + 'px';
      return { left: left, top: top, right: left + width, bottom: top + height };
    }

    function intersects(a, b) {
      return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
    }

    function onMove(ev) {
      applyRect(ev.clientX, ev.clientY);
    }

    function onUp(ev) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const box = applyRect(ev.clientX, ev.clientY);

      const hits = [];
      layer.querySelectorAll('.gen-editable-line, .gen-editable-image').forEach(function (node) {
        const rect = {
          left: Number(parseFloat(node.style.left) || 0),
          top: Number(parseFloat(node.style.top) || 0),
          right: Number(parseFloat(node.style.left) || 0) + Number(parseFloat(node.style.width) || node.offsetWidth || 0),
          bottom: Number(parseFloat(node.style.top) || 0) + Number(parseFloat(node.style.height) || node.offsetHeight || 0),
        };
        if (!intersects(rect, box)) return;
        const isImage = node.classList.contains('gen-editable-image');
        const idx = Number(node.dataset.idx);
        if (!Number.isInteger(idx) || idx < 0) return;
        hits.push({ type: isImage ? 'image' : 'line', index: idx });
      });

      if (ev.shiftKey) {
        setMultiSelection(targetSide, getMultiSelection(targetSide).concat(hits));
      } else {
        setMultiSelection(targetSide, hits);
      }

      if (hits.length) {
        const first = hits[0];
        restoreEditableSelection(targetSide, first.type, first.index);
      } else {
        clearEditableSelection(targetSide, { preserveMulti: false });
      }

      if (marquee.parentNode) marquee.parentNode.removeChild(marquee);
      renderEditableDesignLayer(targetSide);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function wireEditableBlockInteractions(el, side, blockType, blockIndex) {
    if (!el || el.__gcEditableBound) return;
    el.__gcEditableBound = true;

    let drag = null;

    function stopDrag() {
      if (!drag) return;
      const beforeLeft = Number(drag.leftPx || 0);
      const beforeTop = Number(drag.topPx || 0);
      drag = null;
      persistEditableBlockPosition(side, blockType, blockIndex, el);
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      const afterLeft = Number(parseFloat(el.style.left) || 0);
      const afterTop = Number(parseFloat(el.style.top) || 0);
      if (Math.abs(afterLeft - beforeLeft) > 0.2 || Math.abs(afterTop - beforeTop) > 0.2) {
        pushEditorHistory();
      }
    }

    function onDragMove(ev) {
      if (!drag) return;
      const cardW = getCardWidthPx();
      const cardH = getCardHeightPx();
      const boundedLeft = Math.max(0, Math.min(cardW - drag.widthPx, drag.leftPx + (ev.clientX - drag.startX)));
      const boundedTop = Math.max(0, Math.min(cardH - drag.heightPx, drag.topPx + (ev.clientY - drag.startY)));
      const snapped = snapDragPositionPx(boundedLeft, boundedTop, drag.widthPx, drag.heightPx);
      el.style.left = snapped.left + 'px';
      el.style.top = snapped.top + 'px';
    }

    function onDragEnd() {
      stopDrag();
    }

    el.addEventListener('click', function (ev) {
      setEditableSelection(side, blockType, blockIndex, el, { additive: !!ev.shiftKey });
      ev.stopPropagation();
    });

    el.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0) return;
      if (blockType === 'line' && el.dataset.editing === '1') return;
      if (ev.shiftKey) {
        setEditableSelection(side, blockType, blockIndex, el, { additive: true });
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      if (isBlockInMultiSelection(side, blockType, blockIndex)) {
        setEditableSelection(side, blockType, blockIndex, el, { preserveMulti: true });
      } else {
        setEditableSelection(side, blockType, blockIndex, el);
      }
      if (lockMappedBlocks && isMappedSourceBlock(side, blockType, blockIndex)) {
        notifyMappedBlockLocked();
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }

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
        if (lockMappedBlocks && isMappedSourceBlock(side, blockType, blockIndex)) {
          notifyMappedBlockLocked();
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        el.dataset.editStartValue = readEditableLineText(el);
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
          const beforeText = String(el.dataset.editStartValue || '');
          const nextText = readEditableLineText(el);
          el.dataset.editing = '0';
          el.classList.remove('is-editing');
          el.setAttribute('contenteditable', 'false');
          delete el.dataset.editStartValue;
          if (editableDesignModels[side] && Array.isArray(editableDesignModels[side].lines) && editableDesignModels[side].lines[blockIndex]) {
            editableDesignModels[side].lines[blockIndex].text = nextText;
            autosizeEditableLineNode(el, editableDesignModels[side].lines[blockIndex]);
            syncMappingsForSourceLine(side, blockIndex);
          }
          persistEditableBlockPosition(side, blockType, blockIndex, el);
          if (beforeText !== nextText) {
            pushEditorHistory();
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
          if (ev.ctrlKey || ev.metaKey) {
            ev.preventDefault();
            el.blur();
            return;
          }
          // Keep Enter for multiline text like DOC editors.
          ev.preventDefault();
          document.execCommand('insertLineBreak');
        }
      });
    }
  }

  function renderEditableDesignLayer(side, _opts) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const layer = getEditableLayerElement(targetSide);
    if (!layer) return;

    const model = editableDesignModels[targetSide];
    const enabled = !!editableModeBySide[targetSide] && !!model;
    if (!enabled) {
      layer.innerHTML = '';
      layer.classList.remove('with-guides');
      layer.classList.add('hidden');
      updateMultiSelectHint(targetSide);
      updateCollisionStatus(targetSide);
      renderMappingConfidencePanel(targetSide);
      return;
    }

    layer.classList.toggle('with-guides', !!showGuides);
    const pageSettings = getCurrentDocPageSettings();

    const lines = Array.isArray(model.lines) ? model.lines : [];
    const images = Array.isArray(model.images) ? model.images : [];
    const cardW = getCardWidthPx();
    const marginBox = getMarginBoxPx();

    layer.innerHTML = '';
    if (showGuides) {
      renderGuideOverlay(layer);
    }
    layer.onmousedown = function (ev) {
      if (ev.target === layer) {
        if (ev.button === 0 && ev.altKey) {
          beginMarqueeSelection(targetSide, layer, ev);
          ev.preventDefault();
          return;
        }
        clearEditableSelection(targetSide);
      }
    };

    images.forEach(function (imgBlock, imgIdx) {
      if (!imgBlock || !imgBlock.data_url) return;
      const img = document.createElement('img');
      img.className = 'gen-editable-image';
      img.dataset.idx = String(imgIdx);
      img.alt = 'design-image';
      img.src = imgBlock.data_url;
      img.style.left = (Number(imgBlock.x_mm || 0) * SCALE) + 'px';
      img.style.top = (Number(imgBlock.y_mm || 0) * SCALE) + 'px';
      img.style.width = Math.max(2, Number(imgBlock.w_mm || 2) * SCALE) + 'px';
      img.style.height = Math.max(2, Number(imgBlock.h_mm || 2) * SCALE) + 'px';
      if (lockMappedBlocks && isMappedSourceBlock(targetSide, 'image', imgIdx)) {
        img.classList.add('is-locked');
      }
      if (isBlockInMultiSelection(targetSide, 'image', imgIdx)) {
        img.classList.add('is-multi-selected');
      }
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
      const textAlignRaw = String(line && line.text_align || 'left').toLowerCase();
      const textAlign = (textAlignRaw === 'center' || textAlignRaw === 'right') ? textAlignRaw : 'left';
      let effectiveLeftPx = Math.max(0, Math.min(cardW - 12, xPx));
      let effectiveWidthPx = Math.max(12, Math.min(cardW - effectiveLeftPx, wPx));

      if (pageSettings.wrap_mode === 'margin') {
        const marginStart = Math.max(0, Math.min(cardW - 12, marginBox.left));
        const marginEnd = Math.max(marginStart + 12, Math.min(cardW, marginBox.right));
        const maxWidthPx = Math.max(12, marginEnd - marginStart);
        effectiveWidthPx = Math.max(12, Math.min(maxWidthPx, wPx));
        effectiveLeftPx = Math.max(marginStart, Math.min(marginEnd - effectiveWidthPx, xPx));
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
      node.style.maxWidth = '';
      node.style.height = hPx + 'px';
      node.style.minHeight = hPx + 'px';
      node.style.whiteSpace = 'pre';
      node.style.overflow = 'hidden';
      node.style.textOverflow = 'clip';
      node.style.overflowWrap = 'normal';
      node.style.wordBreak = 'normal';
      node.style.fontSize = fontPx + 'px';
      node.style.fontFamily = fontFamily;
      node.style.fontWeight = fontWeight;
      node.style.lineHeight = String(lineHeight);
      node.style.letterSpacing = String(charSpacing) + 'pt';
      node.style.color = fontColor;
      node.style.textAlign = textAlign;
      node.dataset.editing = '0';
      if (lockMappedBlocks && isMappedSourceBlock(targetSide, 'line', idx)) {
        node.classList.add('is-locked');
      }
      if (isBlockInMultiSelection(targetSide, 'line', idx)) {
        node.classList.add('is-multi-selected');
      }

      node.addEventListener('input', function () {
        const i = Number(this.dataset.idx);
        if (!Number.isInteger(i) || !editableDesignModels[targetSide] || !editableDesignModels[targetSide].lines || !editableDesignModels[targetSide].lines[i]) return;
        editableDesignModels[targetSide].lines[i].text = readEditableLineText(this);
        autosizeEditableLineNode(this, editableDesignModels[targetSide].lines[i]);
        syncMappingsForSourceLine(targetSide, i);
        renderMappingsOnSide(targetSide);
      });

      const selectedLine = getEditableSelection(targetSide);
      if (selectedLine && selectedLine.type === 'line' && selectedLine.index === idx) {
        node.classList.add('is-selected');
        selectedLine.el = node;
      }

      wireEditableBlockInteractions(node, targetSide, 'line', idx);

      layer.appendChild(node);
      autosizeEditableLineNode(node, line);
      syncMappingsForSourceLine(targetSide, idx);
    });

    const noTplId = targetSide === 'back' ? 'noTemplateMsgSecondary' : 'noTemplateMsg';
    const noTpl = document.getElementById(noTplId);
    if (noTpl) noTpl.classList.add('hidden');

    layer.classList.remove('hidden');
    updateMultiSelectHint(targetSide);
    updateCollisionStatus(targetSide);
    renderMappingConfidencePanel(targetSide);
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

  function hasUploadedDesignReadyForFlow() {
    return hasDesignAssetForSide('front') && (!isTwoSided || hasDesignAssetForSide('back'));
  }

  function hasConvertedDesignReadyForFlow() {
    return hasEditableDesignForSide('front') && (!isTwoSided || hasEditableDesignForSide('back'));
  }

  function deriveEditorFlowStep() {
    if (!hasUploadedDesignReadyForFlow()) return 'setup';
    if (!hasConvertedDesignReadyForFlow()) return 'convert';
    return flowMapUnlocked ? 'map' : 'style';
  }

  function applyEditorFlowVisibility(forceStep) {
    if (hasRequiredMappings()) {
      flowMapUnlocked = true;
    }
    if (!hasConvertedDesignReadyForFlow()) {
      flowMapUnlocked = false;
    }

    const nextStep = forceStep || deriveEditorFlowStep();
    currentEditorFlowStep = nextStep;

    const showSetupControls = nextStep === 'setup' || nextStep === 'convert';
    const showConvert = nextStep === 'convert';
    const showStyle = nextStep === 'style';
    const showMap = nextStep === 'map';

    const setupBlock = document.getElementById('genSetupTemplateControls');
    const convertBlock = document.getElementById('genConvertTemplateActions');
    const styleBlock = document.getElementById('genDocStyleControls');
    const mappingBlock = document.getElementById('genMappingControls');
    const styleActionbar = document.getElementById('genStyleActionbar');
    const cardSettingsSection = document.getElementById('genCardSettingsSection');
    const sideToggle = document.getElementById('sideToggle');
    const generateActions = document.querySelector('.gen-actions');
    const stageHint = document.getElementById('genFlowStageHint');
    const toggleCardSettingsBtn = document.getElementById('flowToggleCardSettingsBtn');

    if (setupBlock) setupBlock.classList.toggle('hidden', !showSetupControls);
    if (convertBlock) convertBlock.classList.toggle('hidden', !showConvert);
    if (styleBlock) styleBlock.classList.toggle('hidden', !showStyle);
    if (mappingBlock) mappingBlock.classList.toggle('hidden', !showMap);
    if (styleActionbar) styleActionbar.classList.toggle('hidden', !showStyle);
    if (sideToggle) sideToggle.classList.toggle('hidden', !isTwoSided || nextStep === 'setup');
    if (generateActions) generateActions.classList.toggle('hidden', !showMap);

    if (toggleCardSettingsBtn) {
      toggleCardSettingsBtn.classList.toggle('hidden', !showSetupControls);
      toggleCardSettingsBtn.textContent = flowCardSettingsExpanded ? 'Hide Card Settings' : 'Card Settings';
    }
    if (cardSettingsSection) {
      cardSettingsSection.classList.toggle('hidden', !(showSetupControls && flowCardSettingsExpanded));
    }

    if (stageHint) {
      if (nextStep === 'setup') {
        stageHint.textContent = 'Step 1: Choose a saved template or open Card Settings, then upload design PDF(s).';
      } else if (nextStep === 'convert') {
        stageHint.textContent = 'Step 2: Click Convert to Template after upload to create editable design blocks.';
      } else if (nextStep === 'style') {
        stageHint.textContent = 'Step 3: Adjust document style/layout and click Save Format to continue.';
      } else {
        stageHint.textContent = 'Step 4: Map fields to template blocks and finalize your card output.';
      }
    }

    syncUploadButtons();
    return nextStep;
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
    const flowStep = applyEditorFlowVisibility();
    const flowLabel = flowStep === 'setup'
      ? 'Step 1'
      : (flowStep === 'convert' ? 'Step 2' : (flowStep === 'style' ? 'Step 3' : 'Step 4'));

    if (setupEl) {
      const sideText = isTwoSided ? '2-Sided' : '1-Sided';
      const orientText = cardOrientation === 'portrait' ? 'Vertical' : 'Horizontal';
      const designText = backNeeded
        ? (frontAssetOk && backAssetOk ? 'Design layer: front + back ready.' : 'Design layer: upload and convert front + back.')
        : (frontAssetOk ? 'Design layer: front ready.' : 'Design layer: upload and convert front.');
      const mappingText = backNeeded
        ? ('Format fields: Front ' + frontMapped + ', Back ' + backMapped + '.')
        : ('Format fields: Front ' + frontMapped + '.');
      const lockText = lockMappedBlocks ? 'Mapped lock: ON.' : 'Mapped lock: OFF.';
      setupEl.textContent = flowLabel + ' | ' + sideText + ' | ' + orientText + ' | ' + designText + ' ' + mappingText + ' ' + lockText;
    }
  }

  function syncUploadButtons() {
    const uploadArea = document.getElementById('genUploadArea') || document.getElementById('gcHeaderUploadActions');
    const uploadFrontWrapper = document.getElementById('uploadFrontWrapper');
    const uploadBackWrapper = document.getElementById('uploadBackWrapper');
    const removeFrontBtn = document.getElementById('removeFrontPdfBtn');
    const removeBackBtn = document.getElementById('removeBackPdfBtn');

    const flowAllowsUpload = currentEditorFlowStep === 'setup' || currentEditorFlowStep === 'convert';
    if (uploadArea) uploadArea.classList.toggle('hidden', !flowAllowsUpload);

    const frontReady = hasDesignAssetForSide('front');
    const backReady = hasDesignAssetForSide('back');

    // Design PDF actions.
    if (uploadFrontWrapper) uploadFrontWrapper.classList.toggle('hidden', !flowAllowsUpload || frontReady);
    if (removeFrontBtn) removeFrontBtn.classList.toggle('hidden', !flowAllowsUpload || !frontReady);

    if (uploadBackWrapper) uploadBackWrapper.classList.toggle('hidden', !flowAllowsUpload || !isTwoSided || backReady);
    if (removeBackBtn) removeBackBtn.classList.toggle('hidden', !flowAllowsUpload || !isTwoSided || !backReady);
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

  function cloneNullable(value) {
    if (value == null) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_e) {
      return null;
    }
  }

  function updateHistoryButtons() {
    const undoBtn = document.getElementById('undoEditBtn');
    const redoBtn = document.getElementById('redoEditBtn');
    const canUndo = editorHistoryCursor > 0;
    const canRedo = editorHistoryCursor >= 0 && editorHistoryCursor < (editorHistoryStack.length - 1);
    if (undoBtn) undoBtn.disabled = !canUndo;
    if (redoBtn) redoBtn.disabled = !canRedo;
    refreshHistoryCompareOptions();
  }

  function captureEditorStateSnapshot() {
    return {
      field_mappings: cloneDeep(fieldMappings || { front: {}, back: {} }),
      mapping_confidence: cloneDeep(mappingConfidenceBySide || { front: {}, back: {} }),
      editable_design_models: {
        front: cloneNullable(editableDesignModels.front),
        back: cloneNullable(editableDesignModels.back),
      },
      editable_mode_by_side: {
        front: !!editableModeBySide.front,
        back: !!editableModeBySide.back,
      },
      show_guides: !!showGuides,
      lock_mapped_blocks: !!lockMappedBlocks,
      doc_page_settings: cloneDeep(getCurrentDocPageSettings()),
    };
  }

  function applyEditorStateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    historyApplying = true;
    try {
      const mappings = (snapshot.field_mappings && typeof snapshot.field_mappings === 'object')
        ? snapshot.field_mappings
        : { front: {}, back: {} };

      fieldMappings.front = (mappings.front && typeof mappings.front === 'object') ? cloneDeep(mappings.front) : {};
      fieldMappings.back = (mappings.back && typeof mappings.back === 'object') ? cloneDeep(mappings.back) : {};

      const confidence = (snapshot.mapping_confidence && typeof snapshot.mapping_confidence === 'object')
        ? snapshot.mapping_confidence
        : { front: {}, back: {} };
      mappingConfidenceBySide.front = (confidence.front && typeof confidence.front === 'object') ? cloneDeep(confidence.front) : {};
      mappingConfidenceBySide.back = (confidence.back && typeof confidence.back === 'object') ? cloneDeep(confidence.back) : {};
      lowConfidenceQueueBySide.front = [];
      lowConfidenceQueueBySide.back = [];
      lowConfidenceCursorBySide.front = 0;
      lowConfidenceCursorBySide.back = 0;

      const snapModels = (snapshot.editable_design_models && typeof snapshot.editable_design_models === 'object')
        ? snapshot.editable_design_models
        : {};
      editableDesignModels.front = normalizeEditableDesignModel(snapModels.front);
      editableDesignModels.back = normalizeEditableDesignModel(snapModels.back);

      const snapModes = (snapshot.editable_mode_by_side && typeof snapshot.editable_mode_by_side === 'object')
        ? snapshot.editable_mode_by_side
        : {};
      editableModeBySide.front = !!snapModes.front && !!editableDesignModels.front;
      editableModeBySide.back = !!snapModes.back && !!editableDesignModels.back;

      showGuides = !!snapshot.show_guides;
      lockMappedBlocks = !!snapshot.lock_mapped_blocks;
      docPageSettings = normalizeDocPageSettings(snapshot.doc_page_settings, cardOrientation);

      clearEditableSelection('front');
      clearEditableSelection('back');
      clearPendingFieldToMap('front');
      clearPendingFieldToMap('back');
      syncDocPageSettingsInputs();
      syncLockMappedBlocksInput();
      updateGuidesButton();
      populateFieldDropdown();
      renderEditableDesignLayer('front');
      renderEditableDesignLayer('back');
      renderMappingsOnCanvas();
      renderPlacedFields();
      updateSetupStatus();
      updateGenerateBtn();
    } finally {
      historyApplying = false;
      updateHistoryButtons();
    }
  }

  function resetEditorHistory() {
    editorHistoryStack = [captureEditorStateSnapshot()];
    editorHistoryCursor = 0;
    updateHistoryButtons();
  }

  function pushEditorHistory() {
    if (historyApplying) return;
    const snapshot = captureEditorStateSnapshot();
    const serialized = JSON.stringify(snapshot);
    const current = editorHistoryCursor >= 0 ? editorHistoryStack[editorHistoryCursor] : null;
    if (current && JSON.stringify(current) === serialized) {
      updateHistoryButtons();
      return;
    }

    if (editorHistoryCursor < editorHistoryStack.length - 1) {
      editorHistoryStack = editorHistoryStack.slice(0, editorHistoryCursor + 1);
    }

    editorHistoryStack.push(snapshot);
    if (editorHistoryStack.length > EDITOR_HISTORY_LIMIT) {
      editorHistoryStack.shift();
    } else {
      editorHistoryCursor += 1;
    }
    editorHistoryCursor = Math.max(0, editorHistoryStack.length - 1);
    updateHistoryButtons();
  }

  function undoEditorChange() {
    if (editorHistoryCursor <= 0) return false;
    editorHistoryCursor -= 1;
    applyEditorStateSnapshot(editorHistoryStack[editorHistoryCursor]);
    return true;
  }

  function redoEditorChange() {
    if (editorHistoryCursor < 0 || editorHistoryCursor >= (editorHistoryStack.length - 1)) return false;
    editorHistoryCursor += 1;
    applyEditorStateSnapshot(editorHistoryStack[editorHistoryCursor]);
    return true;
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
      TEMPLATE_DATA.mapping_confidence = cloneDeep(template.mapping_confidence || TEMPLATE_DATA.mapping_confidence || { front: {}, back: {} });
      TEMPLATE_DATA.show_guides = !!template.show_guides;
      TEMPLATE_DATA.lock_mapped_blocks = !!template.lock_mapped_blocks;
      TEMPLATE_DATA.doc_page_settings = cloneDeep(template.doc_page_settings || TEMPLATE_DATA.doc_page_settings || defaultDocPageSettings());
      TEMPLATE_DATA.active_doc_layout_id = String(template.active_doc_layout_id || '');
      TEMPLATE_DATA.doc_layout_library = Array.isArray(template.doc_layout_library) ? cloneDeep(template.doc_layout_library) : [];
    }

    if (typeof FIELD_CONFIG === 'object' && FIELD_CONFIG) {
      if (Array.isArray(template.front_fields)) FIELD_CONFIG.front_fields = template.front_fields;
      if (Array.isArray(template.back_fields)) FIELD_CONFIG.back_fields = template.back_fields;
      FIELD_CONFIG.is_two_sided = !!template.is_two_sided;
      FIELD_CONFIG.card_orientation = normalizeOrientation(template.card_orientation || FIELD_CONFIG.card_orientation);
    }

    showGuides = (typeof template.show_guides === 'undefined') ? true : !!template.show_guides;
    lockMappedBlocks = !!template.lock_mapped_blocks;
    docPageSettings = normalizeDocPageSettings(
      template.doc_page_settings || (TEMPLATE_DATA && TEMPLATE_DATA.doc_page_settings),
      template.card_orientation || cardOrientation
    );
    syncDocLayoutLibraryFromTemplate(template);

    FRONT_PDF_URL = (typeof template.front_pdf_url === 'string') ? template.front_pdf_url : '';
    BACK_PDF_URL = (typeof template.back_pdf_url === 'string') ? template.back_pdf_url : '';

    fieldMappings.front = (template.field_mappings && template.field_mappings.front) || {};
    fieldMappings.back  = (template.field_mappings && template.field_mappings.back) || {};
    mappingConfidenceBySide.front = (template.mapping_confidence && template.mapping_confidence.front) || {};
    mappingConfidenceBySide.back = (template.mapping_confidence && template.mapping_confidence.back) || {};
    lowConfidenceQueueBySide.front = [];
    lowConfidenceQueueBySide.back = [];
    lowConfidenceCursorBySide.front = 0;
    lowConfidenceCursorBySide.back = 0;
    loadEditableDesignFromTemplate(template);
    if (!hasDesignAssetForSide('front')) {
      fieldMappings.front = {};
      mappingConfidenceBySide.front = {};
    }
    if (!hasDesignAssetForSide('back')) {
      fieldMappings.back = {};
      mappingConfidenceBySide.back = {};
    }
    flowMapUnlocked = hasRequiredMappings();
    flowCardSettingsExpanded = false;

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
    const textAlignSelect = document.getElementById('textAlignSelect');
    if (textAlignSelect) {
      const ta = String(template.docx_style && template.docx_style.text_align || 'left').toLowerCase();
      textAlignSelect.value = (ta === 'center' || ta === 'right') ? ta : 'left';
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
    updateGuidesButton();
    syncLockMappedBlocksInput();
    syncDocPageSettingsInputs();
    resetEditorHistory();
  }

  /*  Expose public API for the modal in print-cards.html  */
  // Called when the modal opens: refreshes the card list and re-renders the PDF
  window.gcEditorRefresh = function (frontUrl, backUrl) {
    resetGeneratedOutput();
    templatePersistedThisSession = false;
    modalOpenBaselineTemplate = null;
    currentEditorFlowStep = 'setup';
    flowMapUnlocked = false;
    flowCardSettingsExpanded = false;

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
              mapping_confidence: cloneDeep(mappingConfidenceBySide),
              font_size: readFontSizeValue(),
              font_family: readFontFamilyValue(),
              front_pdf_url: FRONT_PDF_URL || '',
              back_pdf_url: BACK_PDF_URL || '',
              has_front_pdf: hasFrontPdf(),
              has_back_pdf: hasBackPdf(),
              front_fields: (typeof FIELD_CONFIG === 'object' && FIELD_CONFIG && Array.isArray(FIELD_CONFIG.front_fields)) ? cloneDeep(FIELD_CONFIG.front_fields) : [],
              back_fields: (typeof FIELD_CONFIG === 'object' && FIELD_CONFIG && Array.isArray(FIELD_CONFIG.back_fields)) ? cloneDeep(FIELD_CONFIG.back_fields) : [],
              show_guides: !!showGuides,
              lock_mapped_blocks: !!lockMappedBlocks,
                doc_page_settings: cloneDeep(getCurrentDocPageSettings()),
              doc_layout_library: cloneDeep(docLayoutLibrary),
              active_doc_layout_id: String(activeDocLayoutId || ''),
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
    pushEditorHistory();
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

    const textAlignSelect = document.getElementById('textAlignSelect');
    if (textAlignSelect) {
      const ta = String(TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.text_align || 'left').toLowerCase();
      textAlignSelect.value = (ta === 'center' || ta === 'right') ? ta : 'left';
    }

    const fontColorInput = document.getElementById('fontColorInput');
    const fontColorTextInput = document.getElementById('fontColorTextInput');
    const styleColor = normalizeHexColor(TEMPLATE_DATA.docx_style && TEMPLATE_DATA.docx_style.font_color_hex || '#111111');
    if (fontColorInput) fontColorInput.value = styleColor;
    if (fontColorTextInput) fontColorTextInput.value = styleColor;

    showGuides = (typeof TEMPLATE_DATA.show_guides === 'undefined') ? true : !!TEMPLATE_DATA.show_guides;
    lockMappedBlocks = !!(TEMPLATE_DATA && TEMPLATE_DATA.lock_mapped_blocks);
    docPageSettings = normalizeDocPageSettings(
      TEMPLATE_DATA && TEMPLATE_DATA.doc_page_settings,
      desiredOrientation
    );
    syncDocPageSettingsInputs();
    syncLockMappedBlocksInput();
    syncDocLayoutLibraryFromTemplate(TEMPLATE_DATA || {});

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
    mappingConfidenceBySide.front = (TEMPLATE_DATA.mapping_confidence && TEMPLATE_DATA.mapping_confidence.front) || {};
    mappingConfidenceBySide.back = (TEMPLATE_DATA.mapping_confidence && TEMPLATE_DATA.mapping_confidence.back) || {};
    lowConfidenceQueueBySide.front = [];
    lowConfidenceQueueBySide.back = [];
    lowConfidenceCursorBySide.front = 0;
    lowConfidenceCursorBySide.back = 0;
    loadEditableDesignFromTemplate(TEMPLATE_DATA || {});
    if (!hasDesignAssetForSide('front')) {
      fieldMappings.front = {};
      mappingConfidenceBySide.front = {};
    }
    if (!hasDesignAssetForSide('back')) {
      fieldMappings.back = {};
      mappingConfidenceBySide.back = {};
    }
    flowMapUnlocked = hasRequiredMappings();
    flowCardSettingsExpanded = false;
    setActiveCanvas(currentSide);

    renderMappingsOnCanvas();
    renderPlacedFields();
    updateSetupStatus();
    updateGenerateBtn();
    updateSideBySidePreview();
    updateDocxStylePreview();
    updateGuidesButton();
    resetEditorHistory();
  }

  /*  Bind UI events  */
  function bindEvents() {
    const singleSidedBtn = document.getElementById('singleSidedBtn');
    const twoSidedBtn = document.getElementById('twoSidedBtn');
    const flowToggleCardSettingsBtn = document.getElementById('flowToggleCardSettingsBtn');
    if (singleSidedBtn) singleSidedBtn.addEventListener('click', () => setTwoSided(false, true));
    if (twoSidedBtn) twoSidedBtn.addEventListener('click', () => setTwoSided(true, true));
    if (flowToggleCardSettingsBtn) {
      flowToggleCardSettingsBtn.addEventListener('click', function () {
        flowCardSettingsExpanded = !flowCardSettingsExpanded;
        applyEditorFlowVisibility(currentEditorFlowStep);
      });
    }

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
    const autoMapSideBtn = document.getElementById('autoMapSideBtn');
    const clearSideMappingsBtn = document.getElementById('clearSideMappingsBtn');
    const saveFormatBtn = document.getElementById('saveFormatBtn');
    const saveDocLayoutBtn = document.getElementById('saveDocLayoutBtn');
    const loadDocLayoutBtn = document.getElementById('loadDocLayoutBtn');
    const downloadDocLayoutBtn = document.getElementById('downloadDocLayoutBtn');
    const docLayoutSelect = document.getElementById('docLayoutSelect');
    const docLayoutNameInput = document.getElementById('docLayoutNameInput');
    const fontSizeInput = document.getElementById('fontSizeInput');
    const fontFamilySelect = document.getElementById('fontFamilySelect');
    const fontWeightSelect = document.getElementById('fontWeightSelect');
    const textAlignSelect = document.getElementById('textAlignSelect');
    const lineHeightInput = document.getElementById('lineHeightInput');
    const charSpacingInput = document.getElementById('charSpacingInput');
    const fontColorInput = document.getElementById('fontColorInput');
    const fontColorTextInput = document.getElementById('fontColorTextInput');
    const toggleGuidesBtn = document.getElementById('toggleGuidesBtn');
    const undoEditBtn = document.getElementById('undoEditBtn');
    const redoEditBtn = document.getElementById('redoEditBtn');
    const addTextLineBtn = document.getElementById('addTextLineBtn');
    const applyStyleToAllLinesBtn = document.getElementById('applyStyleToAllLinesBtn');
    const autoFlowLinesBtn = document.getElementById('autoFlowLinesBtn');
    const distributeLinesBtn = document.getElementById('distributeLinesBtn');
    const applyBulkAlignBtn = document.getElementById('applyBulkAlignBtn');
    const auditMappingsBtn = document.getElementById('auditMappingsBtn');
    const lockMappedBlocksToggle = document.getElementById('lockMappedBlocksToggle');
    const groupAlignLeftBtn = document.getElementById('groupAlignLeftBtn');
    const groupAlignCenterBtn = document.getElementById('groupAlignCenterBtn');
    const groupAlignRightBtn = document.getElementById('groupAlignRightBtn');
    const groupDistributeHorizontalBtn = document.getElementById('groupDistributeHorizontalBtn');
    const groupDistributeVerticalBtn = document.getElementById('groupDistributeVerticalBtn');
    const clearMultiSelectionBtn = document.getElementById('clearMultiSelectionBtn');
    const resolveCollisionsBtn = document.getElementById('resolveCollisionsBtn');
    const reviewLowConfidenceBtn = document.getElementById('reviewLowConfidenceBtn');
    const runSideSyncBtn = document.getElementById('runSideSyncBtn');
    const historyCompareSelect = document.getElementById('historyCompareSelect');
    const runHistoryCompareBtn = document.getElementById('runHistoryCompareBtn');
    const applySelectiveRestoreBtn = document.getElementById('applySelectiveRestoreBtn');
    const marginTopInput = document.getElementById('marginTopInput');
    const marginRightInput = document.getElementById('marginRightInput');
    const marginBottomInput = document.getElementById('marginBottomInput');
    const marginLeftInput = document.getElementById('marginLeftInput');
    const lineGapInput = document.getElementById('lineGapInput');
    const wrapModeSelect = document.getElementById('wrapModeSelect');
    const snapGuidesToggle = document.getElementById('snapGuidesToggle');
    const verticalGuidesInput = document.getElementById('verticalGuidesInput');
    const horizontalGuidesInput = document.getElementById('horizontalGuidesInput');

    function applyPageSettingsAndRender() {
      readDocPageSettingsFromInputs();
      renderEditableDesignLayer('front');
      renderEditableDesignLayer('back');
      updateGenerateBtn();
      pushEditorHistory();
    }

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

    if (autoMapSideBtn) {
      autoMapSideBtn.addEventListener('click', function () {
        runAutoMapCurrentSide();
      });
    }

    if (clearSideMappingsBtn) {
      clearSideMappingsBtn.addEventListener('click', function () {
        clearCurrentSideMappings();
      });
    }

    if (saveFormatBtn) {
      saveFormatBtn.addEventListener('click', function () {
        saveLayoutFormat();
      });
    }

    if (saveDocLayoutBtn) {
      saveDocLayoutBtn.addEventListener('click', function () {
        saveNamedDocLayout();
      });
    }

    if (loadDocLayoutBtn) {
      loadDocLayoutBtn.addEventListener('click', function () {
        loadSelectedDocLayout();
      });
    }

    if (downloadDocLayoutBtn) {
      downloadDocLayoutBtn.addEventListener('click', function () {
        downloadSelectedDocLayout();
      });
    }

    if (docLayoutSelect) {
      docLayoutSelect.addEventListener('change', function () {
        activeDocLayoutId = String(this.value || '').trim();
        const selectedMeta = docLayoutLibrary.find(function (x) { return x.id === activeDocLayoutId; }) || null;
        if (selectedMeta && docLayoutNameInput) {
          docLayoutNameInput.value = selectedMeta.name;
        }
      });
    }

    if (docLayoutNameInput) {
      docLayoutNameInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          saveNamedDocLayout();
        }
      });
    }

    if (fontSizeInput) {
      fontSizeInput.addEventListener('change', function () {
        const val = Math.min(72, Math.max(6, parseInt(this.value || '11', 10) || 11));
        this.value = val;
        const changed = applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
        if (changed) pushEditorHistory();
      });
    }

    if (fontFamilySelect) {
      fontFamilySelect.addEventListener('change', function () {
        const changed = applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
        if (changed) pushEditorHistory();
      });
    }

    if (fontWeightSelect) {
      fontWeightSelect.addEventListener('change', function () {
        const changed = applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
        if (changed) pushEditorHistory();
      });
    }

    if (textAlignSelect) {
      textAlignSelect.addEventListener('change', function () {
        if (applyStyleInputsToSelectedEditableLine(currentSide)) {
          renderEditableDesignLayer(currentSide);
          pushEditorHistory();
        }
        updateGenerateBtn();
        updateDocxStylePreview();
      });
    }

    if (lineHeightInput) {
      lineHeightInput.addEventListener('change', function () {
        const val = Math.min(3, Math.max(0.8, Number(this.value || '1.15')));
        this.value = Number.isFinite(val) ? val : 1.15;
        const changed = applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
        if (changed) pushEditorHistory();
      });
    }

    if (charSpacingInput) {
      charSpacingInput.addEventListener('change', function () {
        const val = Math.min(20, Math.max(-5, Number(this.value || '0')));
        this.value = Number.isFinite(val) ? val : 0;
        const changed = applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
        if (changed) pushEditorHistory();
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
        const changed = applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
        if (changed) pushEditorHistory();
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
        const changed = applyStyleInputsToSelectedEditableLine(currentSide);
        updateGenerateBtn();
        updateDocxStylePreview();
        if (changed) pushEditorHistory();
      });
    }

    if (toggleGuidesBtn) {
      toggleGuidesBtn.addEventListener('click', function () {
        setGuidesVisible(!showGuides);
        pushEditorHistory();
      });
    }

    if (undoEditBtn) {
      undoEditBtn.addEventListener('click', function () {
        undoEditorChange();
      });
    }

    if (redoEditBtn) {
      redoEditBtn.addEventListener('click', function () {
        redoEditorChange();
      });
    }

    if (addTextLineBtn) {
      addTextLineBtn.addEventListener('click', function () {
        addEditableTextBlock(currentSide);
      });
    }

    if (applyStyleToAllLinesBtn) {
      applyStyleToAllLinesBtn.addEventListener('click', function () {
        const count = applyCurrentStyleToAllLines(currentSide);
        if (count > 0) {
          pushEditorHistory();
          showToast('Applied style to ' + count + ' line(s) on ' + (currentSide === 'back' ? 'Back' : 'Front') + '.', 'success');
        } else {
          showToast('No text lines found on this side.', 'info');
        }
      });
    }

    if (autoFlowLinesBtn) {
      autoFlowLinesBtn.addEventListener('click', function () {
        runAutoFlowCurrentSide();
      });
    }

    if (distributeLinesBtn) {
      distributeLinesBtn.addEventListener('click', function () {
        runDistributeLinesCurrentSide();
      });
    }

    if (applyBulkAlignBtn) {
      applyBulkAlignBtn.addEventListener('click', function () {
        runBulkAlignCurrentSide();
      });
    }

    if (auditMappingsBtn) {
      auditMappingsBtn.addEventListener('click', function () {
        runMappingAuditCurrentSide();
      });
    }

    if (lockMappedBlocksToggle) {
      lockMappedBlocksToggle.checked = !!lockMappedBlocks;
      lockMappedBlocksToggle.addEventListener('change', function () {
        setLockMappedBlocks(!!this.checked, { silent: false });
      });
    }

    if (groupAlignLeftBtn) {
      groupAlignLeftBtn.addEventListener('click', function () {
        const changed = alignMultiSelectedBlocks(currentSide, 'left');
        if (changed > 0) {
          pushEditorHistory();
          showToast('Aligned selected blocks to the left.', 'success');
        } else {
          showToast('Select at least 2 blocks to align.', 'info');
        }
      });
    }

    if (groupAlignCenterBtn) {
      groupAlignCenterBtn.addEventListener('click', function () {
        const changed = alignMultiSelectedBlocks(currentSide, 'center');
        if (changed > 0) {
          pushEditorHistory();
          showToast('Centered selected blocks as a group.', 'success');
        } else {
          showToast('Select at least 2 blocks to align.', 'info');
        }
      });
    }

    if (groupAlignRightBtn) {
      groupAlignRightBtn.addEventListener('click', function () {
        const changed = alignMultiSelectedBlocks(currentSide, 'right');
        if (changed > 0) {
          pushEditorHistory();
          showToast('Aligned selected blocks to the right.', 'success');
        } else {
          showToast('Select at least 2 blocks to align.', 'info');
        }
      });
    }

    if (groupDistributeHorizontalBtn) {
      groupDistributeHorizontalBtn.addEventListener('click', function () {
        const changed = distributeMultiSelectedBlocks(currentSide, 'x');
        if (changed > 0) {
          pushEditorHistory();
          showToast('Distributed selected blocks horizontally.', 'success');
        } else {
          showToast('Select at least 3 blocks to distribute horizontally.', 'info');
        }
      });
    }

    if (groupDistributeVerticalBtn) {
      groupDistributeVerticalBtn.addEventListener('click', function () {
        const changed = distributeMultiSelectedBlocks(currentSide, 'y');
        if (changed > 0) {
          pushEditorHistory();
          showToast('Distributed selected blocks vertically.', 'success');
        } else {
          showToast('Select at least 3 blocks to distribute vertically.', 'info');
        }
      });
    }

    if (clearMultiSelectionBtn) {
      clearMultiSelectionBtn.addEventListener('click', function () {
        clearMultiSelection(currentSide);
      });
    }

    if (resolveCollisionsBtn) {
      resolveCollisionsBtn.addEventListener('click', function () {
        runResolveCollisionsCurrentSide();
      });
    }

    if (reviewLowConfidenceBtn) {
      reviewLowConfidenceBtn.addEventListener('click', function () {
        reviewNextLowConfidenceMapping(currentSide);
      });
    }

    if (runSideSyncBtn) {
      runSideSyncBtn.addEventListener('click', function () {
        const directionEl = document.getElementById('syncDirectionSelect');
        const includeLayoutEl = document.getElementById('syncIncludeLayoutToggle');
        const includeStylesEl = document.getElementById('syncIncludeStylesToggle');
        const includeMappingsEl = document.getElementById('syncIncludeMappingsToggle');
        syncSideData({
          direction: directionEl ? directionEl.value : 'front_to_back',
          includeLayout: !!(includeLayoutEl && includeLayoutEl.checked),
          includeStyles: !!(includeStylesEl && includeStylesEl.checked),
          includeMappings: !!(includeMappingsEl && includeMappingsEl.checked),
        });
      });
    }

    if (runHistoryCompareBtn) {
      runHistoryCompareBtn.addEventListener('click', function () {
        runHistoryCompare();
      });
    }

    if (historyCompareSelect) {
      historyCompareSelect.addEventListener('change', function () {
        const idx = Number(this.value);
        compareSnapshotCursor = Number.isInteger(idx) ? idx : -1;
      });
    }

    if (applySelectiveRestoreBtn) {
      applySelectiveRestoreBtn.addEventListener('click', function () {
        applySelectiveRestoreFromHistory();
      });
    }

    [marginTopInput, marginRightInput, marginBottomInput, marginLeftInput, lineGapInput].forEach(function (el) {
      if (!el) return;
      el.addEventListener('change', applyPageSettingsAndRender);
    });

    if (wrapModeSelect) {
      wrapModeSelect.addEventListener('change', applyPageSettingsAndRender);
    }

    if (snapGuidesToggle) {
      snapGuidesToggle.addEventListener('change', applyPageSettingsAndRender);
    }

    [verticalGuidesInput, horizontalGuidesInput].forEach(function (el) {
      if (!el) return;
      el.addEventListener('change', applyPageSettingsAndRender);
      el.addEventListener('blur', applyPageSettingsAndRender);
    });

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
    refreshHistoryCompareOptions();
    updateHistoryButtons();
  }

  /*  SIDE MANAGEMENT  */

  function setOrientation(nextOrientation, withUpdate) {
    const next = normalizeOrientation(nextOrientation);
    cardOrientation = next;
    docPageSettings = normalizeDocPageSettings(docPageSettings, cardOrientation);
    syncDocPageSettingsInputs();
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
    updateMultiSelectHint(side);
    updateCollisionStatus(side);
    renderMappingConfidencePanel(side);

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
      source_image_idx: selection.type === 'image' ? Number(selection.index) : null,
      label_text: isPhoto
        ? String(prev.label_text || formatFieldLabel(fieldName)).trim()
        : String(prev.label_text || '').trim(),
      placeholder: isPhoto
        ? '[PHOTO]'
        : String(prev.placeholder || 'XXXXX').trim(),
      show_key: false,
    };

    fieldMappings[targetSide][fieldName] = Object.assign({}, prev, mapped);
    setMappingConfidenceEntry(targetSide, fieldName, 0.98, 'Manual mapping from selected block', selection.type);
    renderMappingsOnCanvas();
    renderPlacedFields();
    renderMappingConfidencePanel(targetSide);
    updateGenerateBtn();
    updateSetupStatus();
    pushEditorHistory();
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

  function tokenizeForAutoMap(value) {
    const normalized = normalizeMatchText(value);
    if (!normalized) return [];
    return normalized.split(' ').filter(function (x) {
      return x && x.length >= 2;
    });
  }

  function autoMapTextScore(fieldName, lineText) {
    const fieldNorm = normalizeMatchText(fieldName);
    const lineNorm = normalizeMatchText(lineText);
    if (!fieldNorm || !lineNorm) return 0;

    const fieldCompact = fieldNorm.replace(/\s+/g, '');
    const lineCompact = lineNorm.replace(/\s+/g, '');

    let score = 0;
    if (fieldNorm === lineNorm) score += 3;
    if (lineNorm.indexOf(fieldNorm) >= 0 || fieldNorm.indexOf(lineNorm) >= 0) score += 1.6;
    if (fieldCompact && lineCompact && (lineCompact.indexOf(fieldCompact) >= 0 || fieldCompact.indexOf(lineCompact) >= 0)) {
      score += 1.1;
    }

    const fieldTokens = tokenizeForAutoMap(fieldNorm);
    const lineTokens = tokenizeForAutoMap(lineNorm);
    const lineSet = new Set(lineTokens);

    let tokenHits = 0;
    fieldTokens.forEach(function (token) {
      if (lineSet.has(token)) {
        tokenHits += 1;
        return;
      }
      const hasPrefixMatch = lineTokens.some(function (lt) {
        return lt.indexOf(token) === 0 || token.indexOf(lt) === 0;
      });
      if (hasPrefixMatch) tokenHits += 0.65;
    });

    if (fieldTokens.length) {
      score += (tokenHits / fieldTokens.length) * 2.4;
    }
    if (lineTokens.length > 0 && fieldTokens.length > 0) {
      const density = tokenHits / Math.max(lineTokens.length, fieldTokens.length);
      score += density * 0.8;
    }

    return score;
  }

  function hasUsableMapping(mapping) {
    if (!mapping || typeof mapping !== 'object') return false;
    return Number(mapping.w_mm || 0) > 0 && Number(mapping.h_mm || 0) > 0;
  }

  function buildTextMappingFromLine(fieldName, prev, line, lineIdx) {
    return Object.assign({}, prev || {}, {
      x_mm: Math.round(Number(line.x_mm || 0) * 100) / 100,
      y_mm: Math.round(Number(line.y_mm || 0) * 100) / 100,
      w_mm: Math.max(0.5, Math.round(Number(line.w_mm || 0.5) * 100) / 100),
      h_mm: Math.max(0.5, Math.round(Number(line.h_mm || 0.5) * 100) / 100),
      source_line_idx: Number(lineIdx),
      source_image_idx: null,
      label_text: String(prev && prev.label_text || '').trim(),
      placeholder: String(prev && prev.placeholder || 'XXXXX').trim(),
      show_key: (prev && Object.prototype.hasOwnProperty.call(prev, 'show_key')) ? !!prev.show_key : false,
    });
  }

  function buildImageMappingFromBlock(fieldName, prev, imageBlock, imageIdx) {
    return Object.assign({}, prev || {}, {
      x_mm: Math.round(Number(imageBlock.x_mm || 0) * 100) / 100,
      y_mm: Math.round(Number(imageBlock.y_mm || 0) * 100) / 100,
      w_mm: Math.max(0.5, Math.round(Number(imageBlock.w_mm || 0.5) * 100) / 100),
      h_mm: Math.max(0.5, Math.round(Number(imageBlock.h_mm || 0.5) * 100) / 100),
      source_line_idx: null,
      source_image_idx: Number(imageIdx),
      label_text: String(prev && prev.label_text || formatFieldLabel(fieldName)).trim(),
      placeholder: '[PHOTO]',
      show_key: false,
    });
  }

  function autoMapFieldsForSide(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    const lines = model && Array.isArray(model.lines) ? model.lines : [];
    const images = model && Array.isArray(model.images) ? model.images : [];
    fieldMappings[targetSide] = fieldMappings[targetSide] || {};
    const sideMappings = fieldMappings[targetSide];
    mappingConfidenceBySide[targetSide] = mappingConfidenceBySide[targetSide] || {};
    const fields = getConfiguredFields(targetSide);

    const result = {
      mappedText: 0,
      mappedImages: 0,
      skippedExisting: 0,
      noCandidate: 0,
    };

    const usedLineIdx = new Set();
    const usedImageIdx = new Set();

    Object.keys(sideMappings).forEach(function (fieldName) {
      const m = sideMappings[fieldName];
      if (!m || typeof m !== 'object') return;
      if (Number.isInteger(Number(m.source_line_idx))) {
        usedLineIdx.add(Number(m.source_line_idx));
      }
      if (Number.isInteger(Number(m.source_image_idx))) {
        usedImageIdx.add(Number(m.source_image_idx));
      }
    });

    fields.forEach(function (fieldObj) {
      const fieldName = String(fieldObj && fieldObj.name || '').trim();
      if (!fieldName) return;
      const prev = sideMappings[fieldName] && typeof sideMappings[fieldName] === 'object' ? sideMappings[fieldName] : {};
      if (hasUsableMapping(prev)) {
        if (!mappingConfidenceBySide[targetSide][fieldName]) {
          setMappingConfidenceEntry(targetSide, fieldName, 0.72, 'Existing mapping retained', 'existing');
        }
        result.skippedExisting += 1;
        return;
      }

      if (isImageFieldType(fieldObj && fieldObj.type, fieldName)) {
        let imagePickIdx = -1;
        for (let i = 0; i < images.length; i += 1) {
          if (usedImageIdx.has(i)) continue;
          imagePickIdx = i;
          break;
        }
        if (imagePickIdx < 0 || !images[imagePickIdx]) {
          result.noCandidate += 1;
          return;
        }
        sideMappings[fieldName] = buildImageMappingFromBlock(fieldName, prev, images[imagePickIdx], imagePickIdx);
        setMappingConfidenceEntry(targetSide, fieldName, 0.84, 'Sequential unmatched image slot', 'image');
        usedImageIdx.add(imagePickIdx);
        result.mappedImages += 1;
        return;
      }

      let bestIdx = -1;
      let bestScore = -1;
      lines.forEach(function (line, idx) {
        if (!line || typeof line !== 'object') return;
        if (usedLineIdx.has(idx)) return;
        const score = autoMapTextScore(fieldName, line.text || '');
        if (score > bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      });

      if (bestIdx < 0) {
        result.noCandidate += 1;
        return;
      }

      const confidenceEnough = bestScore >= 1.25 || (lines.length === 1 && bestScore >= 0.35);
      if (!confidenceEnough) {
        result.noCandidate += 1;
        return;
      }

      sideMappings[fieldName] = buildTextMappingFromLine(fieldName, prev, lines[bestIdx], bestIdx);
      setMappingConfidenceEntry(
        targetSide,
        fieldName,
        autoMapConfidenceFromScore(bestScore),
        'Text similarity score: ' + bestScore.toFixed(2),
        'text'
      );
      usedLineIdx.add(bestIdx);
      result.mappedText += 1;
    });

    fieldMappings[targetSide] = sideMappings;
    return result;
  }

  function runAutoMapCurrentSide() {
    if (!hasEditableDesignForSide(currentSide)) {
      showToast('Convert the active side design first, then run auto-map.', 'warning');
      return;
    }

    const result = autoMapFieldsForSide(currentSide);
    const totalMapped = result.mappedText + result.mappedImages;
    if (totalMapped <= 0) {
      showToast('No confident auto-matches found. Map manually for best accuracy.', 'info');
      return;
    }

    renderMappingsOnCanvas();
    renderPlacedFields();
    renderMappingConfidencePanel(currentSide);
    updateGenerateBtn();
    updateSetupStatus();
    pushEditorHistory();

    showToast(
      'Auto-map complete: ' + totalMapped + ' field(s) mapped on ' + (currentSide === 'back' ? 'Back' : 'Front') +
      ' (' + result.mappedText + ' text, ' + result.mappedImages + ' image).',
      'success'
    );
  }

  function clearCurrentSideMappings() {
    const targetSide = currentSide === 'back' ? 'back' : 'front';
    const hadMappings = !!Object.keys(getRenderableMappingsForSide(targetSide)).length;
    fieldMappings[targetSide] = {};
    mappingConfidenceBySide[targetSide] = {};
    lowConfidenceQueueBySide[targetSide] = [];
    lowConfidenceCursorBySide[targetSide] = 0;
    renderMappingsOnCanvas();
    renderPlacedFields();
    renderMappingConfidencePanel(targetSide);
    updateGenerateBtn();
    updateSetupStatus();
    if (hadMappings) {
      pushEditorHistory();
      showToast((targetSide === 'back' ? 'Back' : 'Front') + ' mappings cleared.', 'success');
    } else {
      showToast('No mapped fields to clear on this side.', 'info');
    }
  }

  function applyCurrentStyleToAllLines(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    const lines = model && Array.isArray(model.lines) ? model.lines : [];
    if (!lines.length) return 0;

    const fontPt = readFontSizeValue();
    const family = readFontFamilyValue();
    const weightInput = readFontWeightValue();
    const weight = weightInput === 'bold' ? '700' : (weightInput === 'semibold' ? '600' : '400');
    const lineHeight = readLineHeightValue();
    const charSpacing = readCharSpacingValue();
    const color = readFontColorValue();
    const textAlign = readTextAlignValue();

    lines.forEach(function (line, idx) {
      if (!line || typeof line !== 'object') return;
      line.font_size_pt = Math.round(fontPt * 100) / 100;
      line.font_family = family;
      line.font_weight = weight;
      line.line_height = Math.round(lineHeight * 100) / 100;
      line.char_spacing_pt = Math.round(charSpacing * 100) / 100;
      line.font_color_hex = color;
      line.text_align = textAlign;
      syncMappingsForSourceLine(targetSide, idx);
    });

    const sel = getEditableSelection(targetSide);
    renderEditableDesignLayer(targetSide);
    renderMappingsOnSide(targetSide);
    if (sel) {
      restoreEditableSelection(targetSide, sel.type, sel.index);
    }
    updateGenerateBtn();
    return lines.length;
  }

  function roundMm(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function getLineOrderByPosition(lines) {
    return lines
      .map(function (line, idx) {
        return {
          idx: idx,
          x: Number(line && line.x_mm || 0),
          y: Number(line && line.y_mm || 0),
        };
      })
      .sort(function (a, b) {
        if (Math.abs(a.y - b.y) > 0.01) return a.y - b.y;
        if (Math.abs(a.x - b.x) > 0.01) return a.x - b.x;
        return a.idx - b.idx;
      })
      .map(function (item) { return item.idx; });
  }

  function finalizeLineBatchMutation(side, selection) {
    const targetSide = side === 'back' ? 'back' : 'front';
    renderEditableDesignLayer(targetSide);
    renderMappingsOnSide(targetSide);
    if (selection) {
      restoreEditableSelection(targetSide, selection.type, selection.index);
    }
    updateGenerateBtn();
    updateSetupStatus();
  }

  function autoFlowLinesForSide(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    const lines = model && Array.isArray(model.lines) ? model.lines : [];
    if (!lines.length) return { changedCount: 0, appliedGapMm: 0, compressedGap: false };

    const settings = getCurrentDocPageSettings();
    const margin = getMarginBoxMm();
    const lineOrder = getLineOrderByPosition(lines);
    if (!lineOrder.length) return { changedCount: 0, appliedGapMm: 0, compressedGap: false };

    let totalHeight = 0;
    lineOrder.forEach(function (idx) {
      const line = lines[idx] || {};
      totalHeight += Math.max(0.8, Number(line.h_mm || 3.2));
    });

    const requestedGap = clampNumber(settings.line_gap_mm, 0, 12, 2.5);
    let effectiveGap = requestedGap;
    let compressedGap = false;
    if (lineOrder.length > 1) {
      const maxGap = (margin.height - totalHeight) / (lineOrder.length - 1);
      if (Number.isFinite(maxGap) && maxGap < effectiveGap) {
        effectiveGap = Math.max(0, maxGap);
        compressedGap = true;
      }
    }

    let changedCount = 0;
    const placed = [];
    lineOrder.forEach(function (idx, orderIdx) {
      const line = lines[idx];
      if (!line || typeof line !== 'object') return;

      const prevX = Number(line.x_mm || 0);
      const prevY = Number(line.y_mm || 0);
      const prevW = Number(line.w_mm || 0);

      const lineHeightMm = Math.max(0.8, Number(line.h_mm || 3.2));
      const currentWidth = Math.max(1, Number(line.w_mm || 8));
      const boundedWidth = Math.min(Math.max(1, margin.width), currentWidth);
      const maxX = Math.max(margin.left, margin.right - boundedWidth);
      const nextX = Math.max(margin.left, Math.min(maxX, Number(line.x_mm || margin.left)));
      line.x_mm = roundMm(nextX);
      line.w_mm = roundMm(boundedWidth);

      const maxY = Math.max(margin.top, margin.bottom - lineHeightMm);
      let nextY = Math.max(margin.top, Math.min(maxY, Number(line.y_mm || margin.top)));

      // Maintain a minimal vertical gap only against blocks that horizontally overlap.
      let minAllowedY = margin.top;
      placed.forEach(function (prevRect) {
        const overlapX = Math.min(nextX + boundedWidth, prevRect.x + prevRect.w) - Math.max(nextX, prevRect.x);
        if (overlapX <= 0.05) return;
        const overlapRatio = overlapX / Math.max(0.1, Math.min(boundedWidth, prevRect.w));
        if (overlapRatio < 0.12) return;
        minAllowedY = Math.max(minAllowedY, prevRect.y + prevRect.h + effectiveGap);
      });
      if (nextY < minAllowedY) {
        const bumpedY = Math.min(maxY, minAllowedY);
        if (bumpedY + 0.01 < minAllowedY) {
          compressedGap = true;
        }
        nextY = bumpedY;
      }

      line.y_mm = roundMm(nextY);

      if (Math.abs(Number(line.x_mm || 0) - prevX) > 0.01 ||
          Math.abs(Number(line.y_mm || 0) - prevY) > 0.01 ||
          Math.abs(Number(line.w_mm || 0) - prevW) > 0.01) {
        changedCount += 1;
      }

      syncMappingsForSourceLine(targetSide, idx);
      placed.push({
        x: nextX,
        y: nextY,
        w: boundedWidth,
        h: lineHeightMm,
      });
    });

    return {
      changedCount: changedCount,
      appliedGapMm: roundMm(effectiveGap),
      compressedGap: compressedGap,
    };
  }

  function distributeLinesForSide(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    const lines = model && Array.isArray(model.lines) ? model.lines : [];
    if (!lines.length) return { changedCount: 0, appliedGapMm: 0, compressedGap: false };
    if (lines.length === 1) return { changedCount: 0, appliedGapMm: 0, compressedGap: false };

    const margin = getMarginBoxMm();
    const lineOrder = getLineOrderByPosition(lines);

    let totalHeight = 0;
    lineOrder.forEach(function (idx) {
      const line = lines[idx] || {};
      totalHeight += Math.max(0.8, Number(line.h_mm || 3.2));
    });

    let gapMm = (margin.height - totalHeight) / Math.max(1, lineOrder.length - 1);
    let compressedGap = false;
    if (!Number.isFinite(gapMm) || gapMm < 0) {
      gapMm = 0;
      compressedGap = true;
    }

    let cursorY = margin.top;
    let changedCount = 0;
    lineOrder.forEach(function (idx, orderIdx) {
      const line = lines[idx];
      if (!line || typeof line !== 'object') return;

      const prevY = Number(line.y_mm || 0);
      const lineHeightMm = Math.max(0.8, Number(line.h_mm || 3.2));
      const maxY = Math.max(margin.top, margin.bottom - lineHeightMm);
      const nextY = Math.max(margin.top, Math.min(maxY, cursorY));
      line.y_mm = roundMm(nextY);

      if (Math.abs(Number(line.y_mm || 0) - prevY) > 0.01) {
        changedCount += 1;
      }

      syncMappingsForSourceLine(targetSide, idx);
      cursorY = nextY + lineHeightMm + (orderIdx < lineOrder.length - 1 ? gapMm : 0);
    });

    return {
      changedCount: changedCount,
      appliedGapMm: roundMm(gapMm),
      compressedGap: compressedGap,
    };
  }

  function applyBulkAlignToLines(side, alignMode) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    const lines = model && Array.isArray(model.lines) ? model.lines : [];
    if (!lines.length) return 0;

    const modeRaw = String(alignMode || '').toLowerCase();
    const mode = (modeRaw === 'center' || modeRaw === 'right') ? modeRaw : 'left';
    const margin = getMarginBoxMm();
    let changedCount = 0;

    lines.forEach(function (line, idx) {
      if (!line || typeof line !== 'object') return;
      const prevX = Number(line.x_mm || 0);
      const prevAlign = String(line.text_align || 'left').toLowerCase();
      const widthMm = Math.min(Math.max(1, margin.width), Math.max(1, Number(line.w_mm || margin.width)));

      let nextX = margin.left;
      if (mode === 'center') {
        nextX = margin.left + ((margin.width - widthMm) / 2);
      } else if (mode === 'right') {
        nextX = margin.right - widthMm;
      }
      nextX = Math.max(margin.left, Math.min(margin.right - widthMm, nextX));

      line.x_mm = roundMm(nextX);
      line.w_mm = roundMm(widthMm);
      line.text_align = mode;

      if (Math.abs(Number(line.x_mm || 0) - prevX) > 0.01 || prevAlign !== mode) {
        changedCount += 1;
      }

      syncMappingsForSourceLine(targetSide, idx);
    });

    return changedCount;
  }

  function runAutoFlowCurrentSide() {
    if (!hasEditableDesignForSide(currentSide)) {
      showToast('Convert the active side design first, then run Auto Flow.', 'warning');
      return;
    }
    const selection = getEditableSelection(currentSide);
    const result = autoFlowLinesForSide(currentSide);
    if (result.changedCount <= 0) {
      showToast('No text blocks needed auto-flow changes on this side.', 'info');
      return;
    }

    finalizeLineBatchMutation(currentSide, selection);
    pushEditorHistory();
    if (result.compressedGap) {
      showToast('Auto Flow applied with compacted gap (' + result.appliedGapMm + ' mm) to fit page margins.', 'warning');
    } else {
      showToast('Auto Flow applied to ' + result.changedCount + ' line(s).', 'success');
    }
  }

  function runDistributeLinesCurrentSide() {
    if (!hasEditableDesignForSide(currentSide)) {
      showToast('Convert the active side design first, then distribute lines.', 'warning');
      return;
    }
    const selection = getEditableSelection(currentSide);
    const result = distributeLinesForSide(currentSide);
    if (result.changedCount <= 0) {
      showToast('Need at least two text blocks to distribute on this side.', 'info');
      return;
    }

    finalizeLineBatchMutation(currentSide, selection);
    pushEditorHistory();
    if (result.compressedGap) {
      showToast('Distributed lines with zero gap due to limited vertical space.', 'warning');
    } else {
      showToast('Distributed lines with ' + result.appliedGapMm + ' mm spacing.', 'success');
    }
  }

  function runBulkAlignCurrentSide() {
    if (!hasEditableDesignForSide(currentSide)) {
      showToast('Convert the active side design first, then apply bulk alignment.', 'warning');
      return;
    }
    const modeEl = document.getElementById('bulkAlignSelect');
    const mode = modeEl ? modeEl.value : 'left';
    const selection = getEditableSelection(currentSide);
    const changedCount = applyBulkAlignToLines(currentSide, mode);
    if (changedCount <= 0) {
      showToast('No line positions changed for the selected alignment.', 'info');
      return;
    }

    finalizeLineBatchMutation(currentSide, selection);
    pushEditorHistory();
    showToast('Applied ' + String(mode || 'left').toUpperCase() + ' alignment to ' + changedCount + ' line(s).', 'success');
  }

  function auditMappingsForSide(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    const lines = model && Array.isArray(model.lines) ? model.lines : [];
    const images = model && Array.isArray(model.images) ? model.images : [];
    const configuredFields = getConfiguredFields(targetSide)
      .map(function (f) { return String((f && f.name) || '').trim(); })
      .filter(function (name) { return !!name; });
    const sideMappings = getRenderableMappingsForSide(targetSide);
    const mappedFieldNames = Object.keys(sideMappings || {});

    const report = {
      side: targetSide,
      configuredCount: configuredFields.length,
      mappedCount: mappedFieldNames.length,
      unmappedCount: 0,
      invalidGeometryCount: 0,
      outOfBoundsCount: 0,
      missingSourceCount: 0,
      duplicateLineSourceCount: 0,
      duplicateImageSourceCount: 0,
      overlapCount: 0,
      overlapSamples: [],
    };

    const lineSourceUsage = {};
    const imageSourceUsage = {};
    const geometryRows = [];
    const cardW = getCardWidthMm();
    const cardH = getCardHeightMm();

    mappedFieldNames.forEach(function (fieldName) {
      const mapping = sideMappings[fieldName];
      if (!mapping || typeof mapping !== 'object') return;

      const x = Number(mapping.x_mm || 0);
      const y = Number(mapping.y_mm || 0);
      const w = Number(mapping.w_mm || 0);
      const h = Number(mapping.h_mm || 0);

      if (!(w > 0 && h > 0)) {
        report.invalidGeometryCount += 1;
      } else {
        if (x < 0 || y < 0 || (x + w) > (cardW + 0.01) || (y + h) > (cardH + 0.01)) {
          report.outOfBoundsCount += 1;
        }
        geometryRows.push({ fieldName: fieldName, x: x, y: y, w: w, h: h });
      }

      const lineIdx = Number(mapping.source_line_idx);
      if (Number.isInteger(lineIdx)) {
        lineSourceUsage[lineIdx] = (lineSourceUsage[lineIdx] || 0) + 1;
        if (!lines[lineIdx]) report.missingSourceCount += 1;
      }

      const imageIdx = Number(mapping.source_image_idx);
      if (Number.isInteger(imageIdx)) {
        imageSourceUsage[imageIdx] = (imageSourceUsage[imageIdx] || 0) + 1;
        if (!images[imageIdx]) report.missingSourceCount += 1;
      }
    });

    report.duplicateLineSourceCount = Object.keys(lineSourceUsage).filter(function (idx) {
      return Number(lineSourceUsage[idx] || 0) > 1;
    }).length;
    report.duplicateImageSourceCount = Object.keys(imageSourceUsage).filter(function (idx) {
      return Number(imageSourceUsage[idx] || 0) > 1;
    }).length;

    for (let i = 0; i < geometryRows.length; i += 1) {
      for (let j = i + 1; j < geometryRows.length; j += 1) {
        const a = geometryRows[i];
        const b = geometryRows[j];
        const overlap = rectOverlapRatio(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h);
        if (overlap >= 0.24) {
          report.overlapCount += 1;
          if (report.overlapSamples.length < 3) {
            report.overlapSamples.push(a.fieldName + ' <-> ' + b.fieldName);
          }
        }
      }
    }

    report.unmappedCount = configuredFields.filter(function (name) {
      const mapping = sideMappings[name];
      return !hasUsableMapping(mapping);
    }).length;

    return report;
  }

  function runMappingAuditCurrentSide() {
    const report = auditMappingsForSide(currentSide);
    const sideLabel = report.side === 'back' ? 'Back' : 'Front';
    const issueCount =
      report.invalidGeometryCount +
      report.outOfBoundsCount +
      report.missingSourceCount +
      report.duplicateLineSourceCount +
      report.duplicateImageSourceCount +
      report.overlapCount;

    const summary =
      sideLabel + ' audit: mapped ' + report.mappedCount + '/' + report.configuredCount +
      ', unmapped ' + report.unmappedCount +
      ', source issues ' + (report.missingSourceCount + report.duplicateLineSourceCount + report.duplicateImageSourceCount) +
      ', overlaps ' + report.overlapCount +
      ', out-of-bounds ' + report.outOfBoundsCount + '.';

    if (issueCount > 0 || report.unmappedCount > 0) {
      showToast(summary, issueCount > 0 ? 'warning' : 'info');
      console.warn('[Mapping Audit]', report);
    } else {
      showToast(summary, 'success');
      console.info('[Mapping Audit]', report);
    }
  }

  function autoMapConfidenceFromScore(score) {
    const raw = Number(score || 0);
    const normalized = Math.max(0, Math.min(1, (raw - 0.75) / 2.5));
    const confidence = 0.35 + (normalized * 0.62);
    return Math.round(Math.max(0.2, Math.min(0.97, confidence)) * 100) / 100;
  }

  function setMappingConfidenceEntry(side, fieldName, confidence, reason, sourceType) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const name = String(fieldName || '').trim();
    if (!name) return;
    mappingConfidenceBySide[targetSide] = mappingConfidenceBySide[targetSide] || {};
    mappingConfidenceBySide[targetSide][name] = {
      confidence: Math.max(0, Math.min(1, Number(confidence || 0))),
      reason: String(reason || '').trim() || 'Needs manual review',
      source: String(sourceType || '').trim() || 'unknown',
      updated_at: Date.now(),
    };
  }

  function renderMappingConfidencePanel(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const listEl = document.getElementById('mappingConfidenceList');
    if (!listEl) return;

    const sideMappings = getRenderableMappingsForSide(targetSide);
    const names = Object.keys(sideMappings || {});
    if (!names.length) {
      listEl.innerHTML = '<div class="gen-confidence-item"><span class="gen-confidence-meta">No mapped fields yet.</span><span class="gen-confidence-score">--</span></div>';
      lowConfidenceQueueBySide[targetSide] = [];
      lowConfidenceCursorBySide[targetSide] = 0;
      return;
    }

    const entries = names.map(function (name) {
      const confEntry = (mappingConfidenceBySide[targetSide] && mappingConfidenceBySide[targetSide][name]) || null;
      const confidence = confEntry ? Number(confEntry.confidence || 0) : 0.5;
      const reason = confEntry ? confEntry.reason : 'Legacy mapping (no confidence metadata)';
      const source = confEntry ? confEntry.source : 'unknown';
      return {
        field: name,
        confidence: Math.max(0, Math.min(1, confidence)),
        reason: reason,
        source: source,
        low: confidence < 0.55,
      };
    }).sort(function (a, b) {
      if (a.confidence !== b.confidence) return a.confidence - b.confidence;
      return a.field.localeCompare(b.field);
    });

    lowConfidenceQueueBySide[targetSide] = entries.filter(function (entry) { return entry.low; }).map(function (entry) { return entry.field; });
    if (lowConfidenceCursorBySide[targetSide] >= lowConfidenceQueueBySide[targetSide].length) {
      lowConfidenceCursorBySide[targetSide] = 0;
    }

    listEl.innerHTML = entries.map(function (entry) {
      const scorePct = Math.round(entry.confidence * 100);
      const classes = 'gen-confidence-item' + (entry.low ? ' is-low' : '');
      return (
        '<div class="' + classes + '">' +
          '<span><strong>' + escHtml(entry.field) + '</strong><br><span class="gen-confidence-meta">' + escHtml(entry.reason) + ' (' + escHtml(entry.source) + ')</span></span>' +
          '<span class="gen-confidence-score">' + String(scorePct) + '%</span>' +
        '</div>'
      );
    }).join('');
  }

  function reviewNextLowConfidenceMapping(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const queue = lowConfidenceQueueBySide[targetSide] || [];
    if (!queue.length) {
      showToast('No low-confidence mappings pending review on this side.', 'success');
      return false;
    }

    const idx = lowConfidenceCursorBySide[targetSide] % queue.length;
    const fieldName = queue[idx];
    lowConfidenceCursorBySide[targetSide] = (idx + 1) % queue.length;
    const mapping = fieldMappings[targetSide] && fieldMappings[targetSide][fieldName];
    if (!mapping || typeof mapping !== 'object') {
      showToast('Selected low-confidence mapping is missing.', 'warning');
      return false;
    }

    if (targetSide !== currentSide) {
      switchSide(targetSide);
    }

    if (Number.isInteger(Number(mapping.source_line_idx))) {
      restoreEditableSelection(targetSide, 'line', Number(mapping.source_line_idx));
    } else if (Number.isInteger(Number(mapping.source_image_idx))) {
      restoreEditableSelection(targetSide, 'image', Number(mapping.source_image_idx));
    }

    const fieldSelect = document.getElementById('fieldToPlaceSelect');
    if (fieldSelect) fieldSelect.value = fieldName;
    showToast('Reviewing low-confidence field: ' + fieldName, 'info');
    return true;
  }

  function collectEditableBlockRects(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    if (!model) return [];
    const entries = [];
    (Array.isArray(model.lines) ? model.lines : []).forEach(function (line, index) {
      if (!line || typeof line !== 'object') return;
      entries.push({
        type: 'line',
        index: index,
        x_mm: Number(line.x_mm || 0),
        y_mm: Number(line.y_mm || 0),
        w_mm: Math.max(0.5, Number(line.w_mm || 0.5)),
        h_mm: Math.max(0.5, Number(line.h_mm || 0.5)),
      });
    });
    (Array.isArray(model.images) ? model.images : []).forEach(function (img, index) {
      if (!img || typeof img !== 'object') return;
      entries.push({
        type: 'image',
        index: index,
        x_mm: Number(img.x_mm || 0),
        y_mm: Number(img.y_mm || 0),
        w_mm: Math.max(0.5, Number(img.w_mm || 0.5)),
        h_mm: Math.max(0.5, Number(img.h_mm || 0.5)),
      });
    });
    return entries;
  }

  function detectCollisionsForSide(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const blocks = collectEditableBlockRects(targetSide);
    const collisions = [];

    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const a = blocks[i];
        const b = blocks[j];
        const ratio = rectOverlapRatio(a.x_mm, a.y_mm, a.w_mm, a.h_mm, b.x_mm, b.y_mm, b.w_mm, b.h_mm);
        if (ratio >= 0.12) {
          collisions.push({
            a: a,
            b: b,
            ratio: ratio,
          });
        }
      }
    }

    const report = {
      count: collisions.length,
      samples: collisions.slice(0, 3).map(function (entry) {
        return entry.a.type + ':' + entry.a.index + ' <-> ' + entry.b.type + ':' + entry.b.index;
      }),
    };
    return report;
  }

  function updateCollisionStatus(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const statusEl = document.getElementById('collisionStatusText');
    if (!statusEl) return;
    const report = detectCollisionsForSide(targetSide);
    if (!report.count) {
      statusEl.textContent = 'No collisions detected.';
      return;
    }
    statusEl.textContent = report.count + ' collision(s) detected on ' + (targetSide === 'back' ? 'Back' : 'Front') + '.';
  }

  function resolveCollisionsForSide(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const blocks = collectEditableBlockRects(targetSide).sort(function (a, b) {
      if (Math.abs(a.y_mm - b.y_mm) > 0.01) return a.y_mm - b.y_mm;
      return a.x_mm - b.x_mm;
    });
    if (blocks.length < 2) {
      return { moved: 0, remaining: 0 };
    }

    const cardH = getCardHeightMm();
    const gapMm = 0.8;
    let moved = 0;

    for (let i = 1; i < blocks.length; i += 1) {
      const prev = blocks[i - 1];
      const cur = blocks[i];
      const overlap = rectOverlapRatio(prev.x_mm, prev.y_mm, prev.w_mm, prev.h_mm, cur.x_mm, cur.y_mm, cur.w_mm, cur.h_mm);
      if (overlap < 0.12) continue;
      if (lockMappedBlocks && isMappedSourceBlock(targetSide, cur.type, cur.index)) {
        continue;
      }

      const nextY = Math.max(0, Math.min(Math.max(0, cardH - cur.h_mm), (prev.y_mm + prev.h_mm + gapMm)));
      if (nextY <= cur.y_mm + 0.01) continue;

      setBlockPositionMm(targetSide, { type: cur.type, index: cur.index }, cur.x_mm, nextY);
      cur.y_mm = nextY;
      moved += 1;
    }

    const remaining = detectCollisionsForSide(targetSide).count;
    return { moved: moved, remaining: remaining };
  }

  function rebalanceLineLanesForSide(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = editableDesignModels[targetSide];
    const lines = model && Array.isArray(model.lines) ? model.lines : [];
    if (lines.length < 2) {
      return { changedCount: 0 };
    }

    const margin = getMarginBoxMm();
    const settings = getCurrentDocPageSettings();
    const baseGapMm = clampNumber(settings.line_gap_mm, 0, 12, 2.5);
    const rowToleranceMm = 1.4;
    const horizontalGapMm = Math.max(0.4, Math.min(1.4, baseGapMm * 0.35));
    const verticalGapMm = Math.max(0.6, Math.min(2.4, baseGapMm * 0.45));

    const items = lines.map(function (line, idx) {
      const width = Math.max(2.4, Number(line && line.w_mm || 8));
      const height = Math.max(0.9, Number(line && line.h_mm || 3.2));
      const maxX = Math.max(margin.left, margin.right - width);
      const maxY = Math.max(margin.top, margin.bottom - height);
      return {
        idx: idx,
        x: Math.max(margin.left, Math.min(maxX, Number(line && line.x_mm || margin.left))),
        y: Math.max(margin.top, Math.min(maxY, Number(line && line.y_mm || margin.top))),
        w: width,
        h: height,
      };
    });

    const rows = [];
    items
      .slice()
      .sort(function (a, b) {
        if (Math.abs(a.y - b.y) > 0.01) return a.y - b.y;
        return a.x - b.x;
      })
      .forEach(function (item) {
        let row = rows.length ? rows[rows.length - 1] : null;
        if (!row || Math.abs(item.y - row.anchorY) > rowToleranceMm) {
          row = { anchorY: item.y, items: [] };
          rows.push(row);
        }
        row.items.push(item);
      });

    rows.forEach(function (row) {
      row.items.sort(function (a, b) { return a.x - b.x; });
      for (let i = 0; i < row.items.length; i += 1) {
        const cur = row.items[i];
        const next = row.items[i + 1] || null;
        let maxWidth = Math.max(2.4, margin.right - cur.x);
        if (next) {
          maxWidth = Math.min(maxWidth, Math.max(2.4, next.x - cur.x - horizontalGapMm));
        }
        cur.w = Math.max(2.4, Math.min(cur.w, maxWidth));
      }
    });

    const placed = [];
    items
      .slice()
      .sort(function (a, b) {
        if (Math.abs(a.y - b.y) > 0.01) return a.y - b.y;
        return a.x - b.x;
      })
      .forEach(function (item) {
        let minY = margin.top;
        placed.forEach(function (prev) {
          const overlapX = Math.min(item.x + item.w, prev.x + prev.w) - Math.max(item.x, prev.x);
          if (overlapX <= 0.05) return;
          minY = Math.max(minY, prev.y + prev.h + verticalGapMm);
        });

        const maxY = Math.max(margin.top, margin.bottom - item.h);
        item.y = Math.max(margin.top, Math.min(maxY, Math.max(item.y, minY)));
        placed.push({ x: item.x, y: item.y, w: item.w, h: item.h });
      });

    let changedCount = 0;
    items.forEach(function (item) {
      const line = lines[item.idx];
      if (!line || typeof line !== 'object') return;
      const prevX = Number(line.x_mm || 0);
      const prevY = Number(line.y_mm || 0);
      const prevW = Number(line.w_mm || 0);
      const nextX = roundMm(item.x);
      const nextY = roundMm(item.y);
      const nextW = roundMm(item.w);

      line.x_mm = nextX;
      line.y_mm = nextY;
      line.w_mm = nextW;
      syncMappingsForSourceLine(targetSide, item.idx);

      if (Math.abs(nextX - prevX) > 0.01 || Math.abs(nextY - prevY) > 0.01 || Math.abs(nextW - prevW) > 0.01) {
        changedCount += 1;
      }
    });

    return { changedCount: changedCount };
  }

  function runAutoCollisionRepairForSide(side, maxPasses) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const passes = Math.max(1, Number(maxPasses || 1));
    const laneResult = rebalanceLineLanesForSide(targetSide);
    let totalMoved = 0;
    let remaining = detectCollisionsForSide(targetSide).count;
    if (!remaining) {
      return { moved: 0, remaining: 0, laneAdjusted: Number(laneResult && laneResult.changedCount || 0) };
    }

    for (let i = 0; i < passes; i += 1) {
      const result = resolveCollisionsForSide(targetSide);
      totalMoved += Number(result && result.moved || 0);
      remaining = Number(result && result.remaining || 0);
      if (!result || result.moved <= 0 || remaining <= 0) {
        break;
      }
    }

    return {
      moved: totalMoved,
      remaining: remaining,
      laneAdjusted: Number(laneResult && laneResult.changedCount || 0),
    };
  }

  function runResolveCollisionsCurrentSide() {
    if (!hasEditableDesignForSide(currentSide)) {
      showToast('Convert the active side design first to resolve collisions.', 'warning');
      return;
    }
    const result = runAutoCollisionRepairForSide(currentSide, 5);
    const adjusted = Number(result && result.laneAdjusted || 0);
    if (result.moved <= 0 && adjusted <= 0) {
      showToast('No movable collisions found on this side.', 'info');
      return;
    }

    renderEditableDesignLayer(currentSide);
    renderMappingsOnSide(currentSide);
    updateGenerateBtn();
    updateSetupStatus();
    pushEditorHistory();
    if (result.remaining > 0) {
      showToast('Collision resolver adjusted ' + (result.moved + adjusted) + ' block(s). Remaining collisions: ' + result.remaining + '.', 'warning');
    } else {
      showToast('Collision resolver fixed ' + (result.moved + adjusted) + ' block(s).', 'success');
    }
  }

  function syncSideData(options) {
    if (!isTwoSided) {
      showToast('Enable 2-sided mode to run side sync.', 'warning');
      return false;
    }

    const direction = String(options && options.direction || 'front_to_back').toLowerCase();
    const fromSide = direction === 'back_to_front' ? 'back' : 'front';
    const toSide = fromSide === 'front' ? 'back' : 'front';
    const includeLayout = !!(options && options.includeLayout);
    const includeStyles = !!(options && options.includeStyles);
    const includeMappings = !!(options && options.includeMappings);

    if (!includeLayout && !includeStyles && !includeMappings) {
      showToast('Select at least one sync option (layout, styles, mappings).', 'warning');
      return false;
    }

    if ((includeLayout || includeStyles) && !editableDesignModels[fromSide]) {
      showToast('Source side has no editable design model to sync.', 'warning');
      return false;
    }

    if (includeLayout || includeStyles) {
      const sourceModel = normalizeEditableDesignModel(editableDesignModels[fromSide]);
      if (!sourceModel) {
        showToast('Source side has no editable content to sync.', 'warning');
        return false;
      }

      if (!editableDesignModels[toSide]) {
        editableDesignModels[toSide] = cloneDeep(sourceModel);
        editableModeBySide[toSide] = true;
      }

      const targetModel = editableDesignModels[toSide];
      targetModel.lines = Array.isArray(targetModel.lines) ? targetModel.lines : [];
      targetModel.images = Array.isArray(targetModel.images) ? targetModel.images : [];
      const srcLines = Array.isArray(sourceModel.lines) ? sourceModel.lines : [];
      const srcImages = Array.isArray(sourceModel.images) ? sourceModel.images : [];

      if (includeLayout && includeStyles) {
        editableDesignModels[toSide] = cloneDeep(sourceModel);
        editableModeBySide[toSide] = true;
      } else {
        srcLines.forEach(function (srcLine, idx) {
          if (!srcLine || typeof srcLine !== 'object') return;
          if (!targetModel.lines[idx]) {
            targetModel.lines[idx] = cloneDeep(srcLine);
            return;
          }
          const dstLine = targetModel.lines[idx];
          if (includeLayout) {
            dstLine.x_mm = srcLine.x_mm;
            dstLine.y_mm = srcLine.y_mm;
            dstLine.w_mm = srcLine.w_mm;
            dstLine.h_mm = srcLine.h_mm;
          }
          if (includeStyles) {
            dstLine.font_size_pt = srcLine.font_size_pt;
            dstLine.font_family = srcLine.font_family;
            dstLine.font_weight = srcLine.font_weight;
            dstLine.line_height = srcLine.line_height;
            dstLine.char_spacing_pt = srcLine.char_spacing_pt;
            dstLine.font_color_hex = srcLine.font_color_hex;
            dstLine.text_align = srcLine.text_align;
          }
        });

        if (includeLayout) {
          targetModel.images = cloneDeep(srcImages);
        }
      }
      editableModeBySide[toSide] = true;
    }

    if (includeMappings) {
      fieldMappings[toSide] = cloneDeep(fieldMappings[fromSide] || {});
      mappingConfidenceBySide[toSide] = cloneDeep(mappingConfidenceBySide[fromSide] || {});
      lowConfidenceQueueBySide[toSide] = [];
      lowConfidenceCursorBySide[toSide] = 0;
    }

    renderEditableDesignLayer(toSide);
    renderMappingsOnCanvas();
    renderPlacedFields();
    updateSetupStatus();
    updateGenerateBtn();
    pushEditorHistory();

    showToast('Synced ' + (fromSide === 'front' ? 'Front' : 'Back') + ' -> ' + (toSide === 'front' ? 'Front' : 'Back') + '.', 'success');
    return true;
  }

  function refreshHistoryCompareOptions() {
    const select = document.getElementById('historyCompareSelect');
    if (!select) return;

    const current = String(select.value || '').trim();
    const options = ['<option value="">Select history version</option>'];
    editorHistoryStack.forEach(function (_entry, idx) {
      const label = 'Version ' + (idx + 1) + (idx === editorHistoryCursor ? ' (current)' : '');
      const selected = current === String(idx) ? ' selected' : '';
      options.push('<option value="' + String(idx) + '"' + selected + '>' + label + '</option>');
    });
    select.innerHTML = options.join('');

    if (compareSnapshotCursor >= 0 && compareSnapshotCursor < editorHistoryStack.length) {
      select.value = String(compareSnapshotCursor);
    } else if (editorHistoryStack.length >= 2) {
      compareSnapshotCursor = editorHistoryStack.length - 2;
      select.value = String(compareSnapshotCursor);
    }
  }

  function computeSnapshotDiff(baseSnapshot, currentSnapshot) {
    const base = baseSnapshot || {};
    const current = currentSnapshot || {};
    const sides = ['front', 'back'];

    let mappingChanges = 0;
    let layoutChanges = 0;
    let styleChanges = 0;

    sides.forEach(function (side) {
      const baseMappings = (base.field_mappings && base.field_mappings[side]) || {};
      const currentMappings = (current.field_mappings && current.field_mappings[side]) || {};
      const allMapKeys = new Set(Object.keys(baseMappings).concat(Object.keys(currentMappings)));
      allMapKeys.forEach(function (key) {
        if (JSON.stringify(baseMappings[key] || null) !== JSON.stringify(currentMappings[key] || null)) {
          mappingChanges += 1;
        }
      });

      const baseModel = (base.editable_design_models && base.editable_design_models[side]) || null;
      const curModel = (current.editable_design_models && current.editable_design_models[side]) || null;
      const baseLines = baseModel && Array.isArray(baseModel.lines) ? baseModel.lines : [];
      const curLines = curModel && Array.isArray(curModel.lines) ? curModel.lines : [];
      const maxLines = Math.max(baseLines.length, curLines.length);
      for (let i = 0; i < maxLines; i += 1) {
        const a = baseLines[i] || null;
        const b = curLines[i] || null;
        if (!a || !b) {
          if (a || b) layoutChanges += 1;
          continue;
        }
        const layoutSame =
          Math.abs(Number(a.x_mm || 0) - Number(b.x_mm || 0)) < 0.01 &&
          Math.abs(Number(a.y_mm || 0) - Number(b.y_mm || 0)) < 0.01 &&
          Math.abs(Number(a.w_mm || 0) - Number(b.w_mm || 0)) < 0.01 &&
          Math.abs(Number(a.h_mm || 0) - Number(b.h_mm || 0)) < 0.01;
        if (!layoutSame) layoutChanges += 1;

        const styleSame =
          String(a.font_family || '') === String(b.font_family || '') &&
          String(a.font_weight || '') === String(b.font_weight || '') &&
          String(a.font_color_hex || '') === String(b.font_color_hex || '') &&
          String(a.text_align || '') === String(b.text_align || '') &&
          Math.abs(Number(a.font_size_pt || 0) - Number(b.font_size_pt || 0)) < 0.01 &&
          Math.abs(Number(a.line_height || 0) - Number(b.line_height || 0)) < 0.01 &&
          Math.abs(Number(a.char_spacing_pt || 0) - Number(b.char_spacing_pt || 0)) < 0.01;
        if (!styleSame) styleChanges += 1;
      }

      const baseImages = baseModel && Array.isArray(baseModel.images) ? baseModel.images : [];
      const curImages = curModel && Array.isArray(curModel.images) ? curModel.images : [];
      const maxImages = Math.max(baseImages.length, curImages.length);
      for (let i = 0; i < maxImages; i += 1) {
        const a = baseImages[i] || null;
        const b = curImages[i] || null;
        if (!a || !b) {
          if (a || b) layoutChanges += 1;
          continue;
        }
        const same =
          Math.abs(Number(a.x_mm || 0) - Number(b.x_mm || 0)) < 0.01 &&
          Math.abs(Number(a.y_mm || 0) - Number(b.y_mm || 0)) < 0.01 &&
          Math.abs(Number(a.w_mm || 0) - Number(b.w_mm || 0)) < 0.01 &&
          Math.abs(Number(a.h_mm || 0) - Number(b.h_mm || 0)) < 0.01;
        if (!same) layoutChanges += 1;
      }
    });

    const guidesChanged =
      !!base.show_guides !== !!current.show_guides ||
      JSON.stringify(base.doc_page_settings || null) !== JSON.stringify(current.doc_page_settings || null);

    return {
      mappingChanges: mappingChanges,
      layoutChanges: layoutChanges,
      styleChanges: styleChanges,
      guidesChanged: guidesChanged,
    };
  }

  function runHistoryCompare() {
    const select = document.getElementById('historyCompareSelect');
    const summaryEl = document.getElementById('historyCompareSummary');
    if (!select || !summaryEl) return;
    const idx = Number(select.value);
    if (!Number.isInteger(idx) || idx < 0 || idx >= editorHistoryStack.length) {
      summaryEl.textContent = 'Select a valid history version and click Compare.';
      showToast('Select a valid history version first.', 'warning');
      return;
    }

    compareSnapshotCursor = idx;
    const diff = computeSnapshotDiff(editorHistoryStack[idx], captureEditorStateSnapshot());
    summaryEl.textContent =
      'Changes vs selected version -> Mappings: ' + diff.mappingChanges +
      ', Layout: ' + diff.layoutChanges +
      ', Styles: ' + diff.styleChanges +
      ', Guides: ' + (diff.guidesChanged ? 'changed' : 'same') + '.';
    showToast('Comparison complete. Review summary before restore.', 'info');
  }

  function applySelectiveRestoreFromHistory() {
    const select = document.getElementById('historyCompareSelect');
    const mappingToggle = document.getElementById('restoreMappingsToggle');
    const layoutToggle = document.getElementById('restoreLayoutToggle');
    const stylesToggle = document.getElementById('restoreStylesToggle');
    const guidesToggle = document.getElementById('restoreGuidesToggle');

    const idx = Number(select && select.value);
    if (!Number.isInteger(idx) || idx < 0 || idx >= editorHistoryStack.length) {
      showToast('Select a valid history version before restore.', 'warning');
      return;
    }

    const restoreMappings = !!(mappingToggle && mappingToggle.checked);
    const restoreLayout = !!(layoutToggle && layoutToggle.checked);
    const restoreStyles = !!(stylesToggle && stylesToggle.checked);
    const restoreGuides = !!(guidesToggle && guidesToggle.checked);

    if (!restoreMappings && !restoreLayout && !restoreStyles && !restoreGuides) {
      showToast('Select at least one restore scope.', 'warning');
      return;
    }

    const snapshot = editorHistoryStack[idx];
    if (!snapshot || typeof snapshot !== 'object') {
      showToast('Selected history version is invalid.', 'error');
      return;
    }

    if (restoreMappings) {
      fieldMappings = cloneDeep(snapshot.field_mappings || { front: {}, back: {} });
      mappingConfidenceBySide = cloneDeep(snapshot.mapping_confidence || { front: {}, back: {} });
      lowConfidenceQueueBySide.front = [];
      lowConfidenceQueueBySide.back = [];
      lowConfidenceCursorBySide.front = 0;
      lowConfidenceCursorBySide.back = 0;
    }

    if (restoreGuides) {
      showGuides = !!snapshot.show_guides;
      docPageSettings = normalizeDocPageSettings(snapshot.doc_page_settings, cardOrientation);
      syncDocPageSettingsInputs();
      updateGuidesButton();
    }

    if (restoreLayout || restoreStyles) {
      ['front', 'back'].forEach(function (side) {
        const snapModel = snapshot.editable_design_models && snapshot.editable_design_models[side];
        if (!snapModel || typeof snapModel !== 'object') return;

        if (!editableDesignModels[side]) {
          editableDesignModels[side] = normalizeEditableDesignModel(snapModel);
          editableModeBySide[side] = !!editableDesignModels[side];
        }
        if (!editableDesignModels[side]) return;

        const targetModel = editableDesignModels[side];
        const snapLines = Array.isArray(snapModel.lines) ? snapModel.lines : [];
        const snapImages = Array.isArray(snapModel.images) ? snapModel.images : [];

        targetModel.lines = Array.isArray(targetModel.lines) ? targetModel.lines : [];
        const maxLines = Math.max(targetModel.lines.length, snapLines.length);
        for (let i = 0; i < maxLines; i += 1) {
          const src = snapLines[i] || null;
          const dst = targetModel.lines[i] || null;
          if (!src) continue;
          if (!dst) {
            targetModel.lines[i] = cloneDeep(src);
            continue;
          }
          if (restoreLayout) {
            dst.x_mm = src.x_mm;
            dst.y_mm = src.y_mm;
            dst.w_mm = src.w_mm;
            dst.h_mm = src.h_mm;
          }
          if (restoreStyles) {
            dst.font_size_pt = src.font_size_pt;
            dst.font_family = src.font_family;
            dst.font_weight = src.font_weight;
            dst.line_height = src.line_height;
            dst.char_spacing_pt = src.char_spacing_pt;
            dst.font_color_hex = src.font_color_hex;
            dst.text_align = src.text_align;
          }
        }

        if (restoreLayout) {
          targetModel.images = cloneDeep(snapImages);
        }
      });
    }

    renderEditableDesignLayer('front');
    renderEditableDesignLayer('back');
    renderMappingsOnCanvas();
    renderPlacedFields();
    updateSetupStatus();
    updateGenerateBtn();
    pushEditorHistory();
    showToast('Selective restore applied from selected version.', 'success');
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
    if (mappingConfidenceBySide[side]) delete mappingConfidenceBySide[side][fieldName];
    lowConfidenceQueueBySide[side] = [];
    lowConfidenceCursorBySide[side] = 0;
    renderMappingsOnCanvas();
    renderPlacedFields();
    renderMappingConfidencePanel(side);
    updateGenerateBtn();
    updateSetupStatus();
    pushEditorHistory();
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

  function ensureEditableModelForSide(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    if (!editableDesignModels[targetSide]) {
      editableDesignModels[targetSide] = {
        engine: 'manual-doc-layout',
        page_mm: { width: getCardWidthMm(), height: getCardHeightMm() },
        lines: [],
        images: [],
      };
    }
    if (!Array.isArray(editableDesignModels[targetSide].lines)) {
      editableDesignModels[targetSide].lines = [];
    }
    if (!Array.isArray(editableDesignModels[targetSide].images)) {
      editableDesignModels[targetSide].images = [];
    }
    editableModeBySide[targetSide] = true;
    return editableDesignModels[targetSide];
  }

  function addEditableTextBlock(side) {
    const targetSide = side === 'back' ? 'back' : 'front';
    const model = ensureEditableModelForSide(targetSide);
    const lines = Array.isArray(model.lines) ? model.lines : [];
    const settings = getCurrentDocPageSettings();
    const margins = settings.margins_mm || {};
    const leftMm = clampNumber(margins.left, 0, 25, 3);
    const topMm = clampNumber(margins.top, 0, 25, 3);
    const rightMm = clampNumber(margins.right, 0, 25, 3);
    const bottomMm = clampNumber(margins.bottom, 0, 25, 3);
    const lineGapMm = clampNumber(settings.line_gap_mm, 0, 12, 2.5);
    const usableWidthMm = Math.max(14, getCardWidthMm() - leftMm - rightMm);
    const maxYMm = Math.max(topMm + 2, getCardHeightMm() - bottomMm - 4);

    let yMm = topMm + 1.5;
    if (lines.length) {
      const last = lines[lines.length - 1];
      const lastY = Number(last && last.y_mm || 0);
      const lastH = Number(last && last.h_mm || 0);
      yMm = Math.min(maxYMm, Math.max(topMm, lastY + lastH + lineGapMm));
    }

    const newLine = {
      text: 'Type here',
      x_mm: leftMm,
      y_mm: yMm,
      w_mm: Math.max(16, Math.min(usableWidthMm, 70)),
      h_mm: 4.8,
      font_size_pt: readFontSizeValue(),
      font_family: readFontFamilyValue(),
      font_weight: readFontWeightValue() === 'bold' ? '700' : (readFontWeightValue() === 'semibold' ? '600' : '400'),
      line_height: readLineHeightValue(),
      char_spacing_pt: readCharSpacingValue(),
      font_color_hex: readFontColorValue(),
      text_align: readTextAlignValue(),
    };

    model.lines.push(newLine);
    const newIndex = model.lines.length - 1;
    clearCanvasBackground(targetSide);
    renderEditableDesignLayer(targetSide);
    updateSetupStatus();
    updateGenerateBtn();
    pushEditorHistory();

    requestAnimationFrame(function () {
      const layer = getEditableLayerElement(targetSide);
      if (!layer) return;
      const node = layer.querySelector('.gen-editable-line[data-idx="' + String(newIndex) + '"]');
      if (!node) return;
      setEditableSelection(targetSide, 'line', newIndex, node);
      node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
  }

  function saveNamedDocLayout() {
    const nameInput = document.getElementById('docLayoutNameInput');
    const rawName = String((nameInput && nameInput.value) || '').trim();
    const name = rawName.replace(/\s+/g, ' ').slice(0, 80);
    if (!name) {
      showToast('Enter a DOC name before saving.', 'warning');
      if (nameInput) nameInput.focus();
      return;
    }

    const payload = buildTemplatePersistPayload();
    persistTemplate(payload)
      .then(function () {
        templatePersistedThisSession = true;
        return fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/template/doc-layouts/save/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken'),
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({ name: name }),
        });
      })
      .then(function (r) {
        if (!r.ok) {
          return parseJsonResponse(r, 'Failed to save DOC').then(function (data) {
            throw new Error((data && (data.message || data.error)) || 'Failed to save DOC');
          });
        }
        return parseJsonResponse(r, 'Failed to save DOC');
      })
      .then(function (data) {
        if (!data || data.status !== 'ok' || !data.template) {
          throw new Error((data && (data.message || data.error)) || 'Failed to save DOC');
        }
        syncDocLayoutLibraryFromTemplate(data.template);
        activeDocLayoutId = String(data.template.active_doc_layout_id || '').trim();
        renderDocLayoutPicker();
        showToast('DOC saved: ' + name, 'success');
      })
      .catch(function (err) {
        console.error(err);
        showToast(err.message || 'Failed to save DOC.', 'error');
      });
  }

  function loadSelectedDocLayout() {
    const select = document.getElementById('docLayoutSelect');
    const layoutId = String(select && select.value || '').trim();
    if (!layoutId) {
      showToast('Select a saved DOC to load.', 'warning');
      return;
    }

    fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/template/doc-layouts/apply/' + encodeURIComponent(layoutId) + '/', {
      method: 'POST',
      headers: {
        'X-CSRFToken': getCookie('csrftoken'),
        'X-Requested-With': 'XMLHttpRequest',
      },
    })
      .then(function (r) {
        if (!r.ok) {
          return parseJsonResponse(r, 'Failed to load DOC').then(function (data) {
            throw new Error((data && (data.message || data.error)) || 'Failed to load DOC');
          });
        }
        return parseJsonResponse(r, 'Failed to load DOC');
      })
      .then(function (data) {
        if (!data || data.status !== 'ok' || !data.template) {
          throw new Error((data && (data.message || data.error)) || 'Failed to load DOC');
        }
        templatePersistedThisSession = true;
        applyTemplateState(data.template);
        flowMapUnlocked = true;
        updateSetupStatus();
        showToast('Saved DOC loaded.', 'success');
      })
      .catch(function (err) {
        console.error(err);
        showToast(err.message || 'Failed to load DOC.', 'error');
      });
  }

  function downloadSelectedDocLayout() {
    const select = document.getElementById('docLayoutSelect');
    const layoutId = String(select && select.value || '').trim();
    if (!layoutId) {
      showToast('Select a saved DOC to download.', 'warning');
      return;
    }

    fetchFromPrintApi('/api/generate-card/table/' + TABLE_ID + '/template/doc-layouts/download/' + encodeURIComponent(layoutId) + '/', {
      method: 'GET',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    })
      .then(function (response) {
        if (!response.ok) {
          return parseJsonResponse(response, 'Failed to download DOC').then(function (d) {
            throw new Error((d && (d.message || d.error)) || 'Failed to download DOC');
          });
        }
        const contentDisposition = response.headers.get('Content-Disposition') || '';
        const fileName = filenameFromContentDisposition(contentDisposition, 'saved_layout.docx');
        return response.blob().then(function (blob) {
          return { blob: blob, fileName: fileName };
        });
      })
      .then(function (result) {
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 2000);
        showToast('DOC downloaded.', 'success');
      })
      .catch(function (err) {
        console.error(err);
        showToast(err.message || 'Failed to download DOC.', 'error');
      });
  }

  /*  API CALLS  */

  function buildTemplatePersistPayload() {
    readDocPageSettingsFromInputs();
    return {
      is_two_sided: isTwoSided,
      card_orientation: cardOrientation,
      show_guides: !!showGuides,
      lock_mapped_blocks: !!lockMappedBlocks,
      doc_page_settings: cloneDeep(getCurrentDocPageSettings()),
      font_size: readFontSizeValue(),
      font_family: readFontFamilyValue(),
      field_mappings: withSourceLineIndices(fieldMappings),
      mapping_confidence: cloneDeep(mappingConfidenceBySide),
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
      docx_text_align: readTextAlignValue(),
    };
  }

  function saveLayoutFormat() {
    if (!hasDesignAssetForSide('front')) {
      showToast('Upload Front design PDF and convert it to template first.', 'warning');
      return;
    }
    if (isTwoSided && !hasDesignAssetForSide('back')) {
      showToast('Upload Back design PDF and convert it to template for 2-sided format.', 'warning');
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
          TEMPLATE_DATA.mapping_confidence = cloneDeep(mappingConfidenceBySide);
          TEMPLATE_DATA.show_guides = !!showGuides;
          TEMPLATE_DATA.lock_mapped_blocks = !!lockMappedBlocks;
          TEMPLATE_DATA.doc_page_settings = cloneDeep(getCurrentDocPageSettings());
        }
        flowMapUnlocked = true;
        updateSetupStatus();
        showToast('Format saved. Continue with field mapping.', 'success');
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
        runAutoCollisionRepairForSide(targetSide, 3);
        flowMapUnlocked = false;

        clearCanvasBackground(targetSide);
        renderEditableDesignLayer(targetSide);
        renderMappingsOnSide(targetSide);
        updateSetupStatus();
        pushEditorHistory();

        showToast((targetSide === 'back' ? 'Back' : 'Front') + ' converted. Adjust style and click Save Format to continue.', 'success');
      })
      .catch(function(err) {
        console.error(err);
        showToast(err.message || 'Failed to convert PDF to editable layer.', 'error');
      })
      .finally(function() {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = original || '<i class="fa-solid fa-file-word"></i> Convert to Template';
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
      flowMapUnlocked = false;

      renderPdf(freshUrl, 0, side);
      updateSetupStatus();
      updateGenerateBtn();
      pushEditorHistory();
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
    const exists = hasDesignAssetForSide(side);
    if (!exists) {
      showToast(target + ' design layer is already empty.', 'warning');
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
      mappingConfidenceBySide[side] = {};
      lowConfidenceQueueBySide[side] = [];
      lowConfidenceCursorBySide[side] = 0;
      flowMapUnlocked = false;
      clearGeneratedPreview();
      clearEditableDesignModel(side);

      clearCanvasBackground(side);
      renderMappingsOnCanvas();
      renderPlacedFields();

      updateSetupStatus();
      updateGenerateBtn();
      showToast(target + ' design layer cleared.', 'success');
      updateSideBySidePreview();
      pushEditorHistory();
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
