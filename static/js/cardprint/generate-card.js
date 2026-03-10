/**
 * generate-card.js
 * Runs on the Generate Card editor page (generate-card.html).
 *
 * Globals injected by the template (before this script loads):
 *   TABLE_ID         {number}
 *   TABLE_NAME       {string}
 *   TEMPLATE_DATA    {object}  — {is_two_sided, font_size, font_family, field_mappings: {front:{},back:{}}}
 *   FRONT_PDF_URL    {string}  — may be ''
 *   BACK_PDF_URL     {string}  — may be ''
 *   TABLE_FIELDS     {Array}   — [{name, type}, ...]
 */

(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────── */
  const SCALE   = 7;          // px per mm
  const CARD_W  = 87 * SCALE; // 609 px
  const CARD_H  = 57 * SCALE; // 399 px

  /* ── State ─────────────────────────────────────────────── */
  let fabric_canvas = null;   // Fabric.js canvas
  let currentSide   = 'front';
  let isTwoSided    = false;
  let drawMode      = false;
  let drawField     = null;   // {name, type} being drawn
  let drawStart     = null;   // {x,y} in canvas px
  let drawRect      = null;   // live Fabric Rect while dragging
  let isMouseDown   = false;

  // field_mappings: { front: { FieldName: {x_mm,y_mm,w_mm,h_mm} }, back: {...} }
  let fieldMappings = { front: {}, back: {} };

  // cards currently in generate list (each: {pr_id, card_id, sr_no, ordered_fields})
  let genCards = [];
  let selectedPrIds = new Set();

  // Keep a reference to the last-loaded PDF page for auto-detect
  let lastPdfPage = null;

  // Last generated PDF blob (for the Download PDF footer button)
  let lastPdfBlob = null;

  /* ── PDF.js worker ─────────────────────────────────────── */
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  /* ══════════════════════════════════════════ DOM READY ══ */
  document.addEventListener('DOMContentLoaded', function () {
    initFabric();
    populateFieldDropdown();
    loadState();
    bindEvents();
    loadCardList();
    if (FRONT_PDF_URL) renderPdf(FRONT_PDF_URL, true);
  });

  /* ── Expose public API for the modal in print-cards.html ── */
  // Called when the modal opens: refreshes the card list and re-renders the PDF
  window.gcEditorRefresh = function (frontUrl, backUrl) {
    if (frontUrl) FRONT_PDF_URL = frontUrl;
    if (backUrl)  BACK_PDF_URL  = backUrl;
    loadCardList();
    if (FRONT_PDF_URL && currentSide === 'front') renderPdf(FRONT_PDF_URL, false);
  };

  // Download the last generated PDF blob (triggered by footer Download PDF button)
  window.gcDownloadLastPdf = function () {
    if (!lastPdfBlob) return;
    const url = URL.createObjectURL(lastPdfBlob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = 'cards-' + (TABLE_NAME || 'output').replace(/[^a-z0-9_-]/gi, '_') + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /* ── Fabric.js canvas init ──────────────────────────────── */
  function initFabric() {
    fabric_canvas = new fabric.Canvas('genCardCanvas', {
      width:             CARD_W,
      height:            CARD_H,
      selection:         false,
      preserveObjectStacking: true,
    });

    // Mouse events for rectangle drawing
    fabric_canvas.on('mouse:down', onMouseDown);
    fabric_canvas.on('mouse:move', onMouseMove);
    fabric_canvas.on('mouse:up',   onMouseUp);
  }

  /* ── Populate field dropdown from TABLE_FIELDS (filtered by FIELD_CONFIG) ── */
  function populateFieldDropdown() {
    const sel = document.getElementById('fieldToPlaceSelect');
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
      opt.textContent = f.name + (isPhoto ? ' \uD83D\uDDBC' : '');
      sel.appendChild(opt);
    });
  }

  /* ── Load template state from server-injected TEMPLATE_DATA ── */
  function loadState() {
    isTwoSided = !!TEMPLATE_DATA.is_two_sided;

    const fs = parseInt(TEMPLATE_DATA.font_size) || 8;
    document.getElementById('fontSizeInput').value = Math.min(10, Math.max(7, fs));

    const ff = TEMPLATE_DATA.font_family || 'Helvetica-Bold';
    document.getElementById('fontFamilySelect').value = ff;

    if (isTwoSided) {
      setTwoSided(true, false);
    } else {
      setTwoSided(false, false);
    }

    if (TEMPLATE_DATA.field_mappings) {
      fieldMappings.front = TEMPLATE_DATA.field_mappings.front || {};
      fieldMappings.back  = TEMPLATE_DATA.field_mappings.back  || {};
    }

    renderMappingsOnCanvas();
    renderPlacedFields();
  }

  /* ── Bind UI events ─────────────────────────────────────── */
  function bindEvents() {
    // 1-sided / 2-sided
    document.getElementById('singleSidedBtn').addEventListener('click', () => setTwoSided(false, true));
    document.getElementById('twoSidedBtn').addEventListener('click',   () => setTwoSided(true, true));

    // Front / Back side toggle
    document.getElementById('frontSideBtn').addEventListener('click', () => switchSide('front'));
    document.getElementById('backSideBtn').addEventListener('click',  () => switchSide('back'));

    // Field to place — enable/disable draw btn
    document.getElementById('fieldToPlaceSelect').addEventListener('change', function () {
      const hasField = !!this.value;
      document.getElementById('startDrawBtn').disabled = !hasField;
    });

    // Draw button
    document.getElementById('startDrawBtn').addEventListener('click', function () {
      const fieldName = document.getElementById('fieldToPlaceSelect').value;
      if (!fieldName) return;
      const fieldObj = TABLE_FIELDS.find(f => f.name === fieldName) || { name: fieldName, type: 'text' };
      enterDrawMode(fieldObj);
    });

    // Cancel draw
    document.getElementById('cancelDrawBtn').addEventListener('click', exitDrawMode);

    // Save template
    document.getElementById('saveTemplateBtn').addEventListener('click', saveTemplate);

    // Generate PDF
    document.getElementById('generatePdfBtn').addEventListener('click', generatePdf);

    // Auto-detect button
    const autoDetectBtn = document.getElementById('autoDetectBtn');
    if (autoDetectBtn) {
      autoDetectBtn.addEventListener('click', function () {
        autoDetectFields();
      });
    }

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

    // Upload PDFs
    document.getElementById('uploadFrontInput').addEventListener('change', function () {
      if (this.files[0]) uploadPdf(this.files[0], 'front');
    });
    document.getElementById('uploadBackInput').addEventListener('change', function () {
      if (this.files[0]) uploadPdf(this.files[0], 'back');
    });
  }

  /* ═══════════════════════ SIDE MANAGEMENT ═══════════════ */

  function setTwoSided(val, withUpdate) {
    isTwoSided = val;

    document.getElementById('singleSidedBtn').classList.toggle('active',  !val);
    document.getElementById('twoSidedBtn').classList.toggle('active',   val);
    document.getElementById('sideToggle').classList.toggle('hidden', !val);
    document.getElementById('uploadBackWrapper').classList.toggle('hidden', !val);

    if (!val && currentSide === 'back') {
      switchSide('front');
    }

    if (withUpdate) {
      renderMappingsOnCanvas();
    }
  }

  function switchSide(side) {
    currentSide = side;
    document.getElementById('frontSideBtn').classList.toggle('active', side === 'front');
    document.getElementById('backSideBtn').classList.toggle('active',  side === 'back');
    document.getElementById('activeSideLabel').textContent = side === 'front' ? 'Front' : 'Back';
    document.getElementById('uploadFrontLabel').textContent = side === 'front' ? 'Re-upload Front PDF' : 'Upload Front PDF';

    // Refresh dropdown to show only fields allowed for this side
    populateFieldDropdown();

    const pdfUrl = side === 'front' ? FRONT_PDF_URL : BACK_PDF_URL;
    if (pdfUrl) {
      renderPdf(pdfUrl, false);
    } else {
      clearCanvasBackground();
    }

    renderMappingsOnCanvas();
    exitDrawMode();
  }

  /* ═══════════════════════ DRAW MODE ════════════════════ */

  function enterDrawMode(fieldObj) {
    drawMode  = true;
    drawField = fieldObj;
    document.getElementById('drawModeIndicator').classList.remove('hidden');
    document.getElementById('drawFieldName').textContent = fieldObj.name;
    document.getElementById('startDrawBtn').disabled = true;
    document.getElementById('genCardWrapper').classList.remove('no-draw-mode');
    fabric_canvas.defaultCursor = 'crosshair';
    fabric_canvas.forEachObject(o => { o.selectable = false; o.evented = false; });
  }

  function exitDrawMode() {
    drawMode  = false;
    drawField = null;
    drawStart = null;
    if (drawRect) { fabric_canvas.remove(drawRect); drawRect = null; }
    document.getElementById('drawModeIndicator').classList.add('hidden');
    document.getElementById('fieldToPlaceSelect').value = '';
    document.getElementById('startDrawBtn').disabled = true;
    document.getElementById('genCardWrapper').classList.add('no-draw-mode');
    fabric_canvas.defaultCursor = 'default';
  }

  /* ─ Fabric mouse handlers ─ */
  function onMouseDown(opt) {
    if (!drawMode) return;
    isMouseDown = true;
    const p = fabric_canvas.getPointer(opt.e);
    drawStart = { x: p.x, y: p.y };
    drawRect = new fabric.Rect({
      left:        p.x,
      top:         p.y,
      width:       0,
      height:      0,
      fill:        'rgba(59,130,246,0.18)',
      stroke:      '#3b82f6',
      strokeWidth: 2,
      selectable:  false,
      evented:     false,
      rx: 2, ry: 2,
    });
    fabric_canvas.add(drawRect);
  }

  function onMouseMove(opt) {
    if (!drawMode || !isMouseDown || !drawRect) return;
    const p = fabric_canvas.getPointer(opt.e);
    const x = Math.min(p.x, drawStart.x);
    const y = Math.min(p.y, drawStart.y);
    const w = Math.abs(p.x - drawStart.x);
    const h = Math.abs(p.y - drawStart.y);
    drawRect.set({ left: x, top: y, width: w, height: h });
    fabric_canvas.renderAll();
  }

  function onMouseUp(opt) {
    if (!drawMode || !isMouseDown) return;
    isMouseDown = false;
    const p = fabric_canvas.getPointer(opt.e);
    const rawW = Math.abs(p.x - drawStart.x);
    const rawH = Math.abs(p.y - drawStart.y);

    if (rawW < 6 || rawH < 6) {
      // Too small — ignore
      if (drawRect) { fabric_canvas.remove(drawRect); drawRect = null; }
      return;
    }

    const x_mm = Math.min(p.x, drawStart.x) / SCALE;
    const y_mm = Math.min(p.y, drawStart.y) / SCALE;
    const w_mm = rawW / SCALE;
    const h_mm = rawH / SCALE;

    // Store mapping
    fieldMappings[currentSide][drawField.name] = { x_mm, y_mm, w_mm, h_mm };

    // Remove the live rect and re-render all mappings as labelled rects
    if (drawRect) { fabric_canvas.remove(drawRect); drawRect = null; }
    exitDrawMode();
    renderMappingsOnCanvas();
    renderPlacedFields();

    // Re-focus dropdown for quick next placement
    document.getElementById('fieldToPlaceSelect').focus();
  }

  /* ═══════════════════════ CANVAS RENDERING ══════════════ */

  function clearCanvasBackground() {
    fabric_canvas.backgroundImage = null;
    fabric_canvas.renderAll();
    document.getElementById('noTemplateMsg').classList.remove('hidden');
  }

  function renderMappingsOnCanvas() {
    // Remove all non-background objects (the mapping rect overlays)
    const toRemove = fabric_canvas.getObjects().filter(o => o.__isMapping);
    toRemove.forEach(o => fabric_canvas.remove(o));

    const mappings = fieldMappings[currentSide] || {};
    Object.entries(mappings).forEach(([fieldName, dim]) => {
      const rect = new fabric.Rect({
        left:        dim.x_mm * SCALE,
        top:         dim.y_mm * SCALE,
        width:       dim.w_mm * SCALE,
        height:      dim.h_mm * SCALE,
        fill:        'rgba(59,130,246,0.12)',
        stroke:      '#3b82f6',
        strokeWidth: 1,
        selectable:  false,
        evented:     false,
        rx: 2, ry: 2,
        __isMapping: true,
      });

      const label = new fabric.Text(fieldName, {
        left:       dim.x_mm * SCALE + 3,
        top:        dim.y_mm * SCALE + 2,
        fontSize:   10,
        fill:       '#1d4ed8',
        fontFamily: 'sans-serif',
        selectable: false,
        evented:    false,
        __isMapping: true,
        backgroundColor: 'rgba(255,255,255,0.7)',
      });

      fabric_canvas.add(rect);
      fabric_canvas.add(label);
    });

    fabric_canvas.renderAll();
  }

  /* ── PDF.js rendering ─────────────────────────────────── */
  function renderPdf(url, autoDetectOnLoad) {
    const overlay = document.getElementById('pdfLoadingOverlay');
    const noTpl   = document.getElementById('noTemplateMsg');
    overlay.classList.remove('hidden');
    noTpl.classList.add('hidden');

    pdfjsLib.getDocument(url).promise.then(function (pdfDoc) {
      return pdfDoc.getPage(1);
    }).then(function (page) {
      lastPdfPage = page;

      // Scale the PDF page to fit exactly CARD_W × CARD_H
      const viewport = page.getViewport({ scale: 1 });
      const scaleX   = CARD_W  / viewport.width;
      const scaleY   = CARD_H / viewport.height;
      const pdfScale = Math.min(scaleX, scaleY);
      const scaledVP = page.getViewport({ scale: pdfScale });

      const offscreen = document.createElement('canvas');
      offscreen.width  = scaledVP.width;
      offscreen.height = scaledVP.height;
      const ctx = offscreen.getContext('2d');

      return page.render({ canvasContext: ctx, viewport: scaledVP }).promise.then(function () {
        fabric.Image.fromURL(offscreen.toDataURL(), function (img) {
          img.set({
            left:       0,
            top:        0,
            selectable: false,
            evented:    false,
          });
          img.scaleToWidth(CARD_W);
          fabric_canvas.setBackgroundImage(img, function () {
            fabric_canvas.renderAll();
            overlay.classList.add('hidden');
            renderMappingsOnCanvas();
            // Auto-detect on first load if no mappings exist yet
            if (autoDetectOnLoad && Object.keys(fieldMappings[currentSide] || {}).length === 0) {
              autoDetectFields();
            }
          });
        });
      });
    }).catch(function (err) {
      console.error('PDF.js error:', err);
      overlay.classList.add('hidden');
      noTpl.classList.remove('hidden');
      showToast('Failed to load PDF template.', 'error');
    });
  }

  /* ═══════════════════════ AUTO-DETECT FIELDS ═══════════ */

  /**
   * Extract text items from the loaded PDF page, match them to table field
   * names, and auto-populate fieldMappings for the current side.
   */
  function autoDetectFields() {
    if (!lastPdfPage) {
      showToast('Upload a PDF template first.', 'warning');
      return;
    }

    const btn = document.getElementById('autoDetectBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Detecting…'; }

    // Get which fields are allowed for the current side
    const cfg = (typeof FIELD_CONFIG !== 'undefined') ? FIELD_CONFIG : {};
    const allowedNames = (currentSide === 'front')
      ? (cfg.front_fields || [])
      : (cfg.back_fields || []);
    const fieldsToMatch = allowedNames.length > 0
      ? TABLE_FIELDS.filter(f => allowedNames.indexOf(f.name) >= 0)
      : TABLE_FIELDS;

    const viewport = lastPdfPage.getViewport({ scale: 1 });
    const scaleX = CARD_W / viewport.width;
    const scaleY = CARD_H / viewport.height;
    const pdfScale = Math.min(scaleX, scaleY);

    lastPdfPage.getTextContent().then(function (textContent) {
      const matched = new Set();
      const newMappings = {};
      const detectedFontSizes = [];
      const detectedFontNames = [];

      // Build a lookup: lowercase field name → field object
      const fieldLookup = {};
      fieldsToMatch.forEach(f => {
        fieldLookup[f.name.toLowerCase().trim()] = f;
      });

      textContent.items.forEach(function (item) {
        if (!item.str || !item.str.trim()) return;

        const rawText = item.str.trim();
        // PDF transform: [scaleX, skewX, skewY, scaleY, translateX, translateY]
        const tx = item.transform;
        // Position in PDF coordinates (origin = bottom-left)
        const pdfX = tx[4];
        const pdfY = tx[5];
        const pdfFontSize = Math.abs(tx[3]) || Math.abs(tx[0]) || 10;

        // Collect font info for auto font detection
        detectedFontSizes.push(pdfFontSize);
        if (item.fontName) detectedFontNames.push(item.fontName);

        // Convert to our canvas coordinates (origin = top-left)
        const canvasX = pdfX * pdfScale;
        const canvasY = CARD_H - (pdfY * pdfScale);

        // Try to match this text to a field name
        const matchedField = matchTextToField(rawText, fieldLookup, matched);
        if (!matchedField) return;

        matched.add(matchedField.name.toLowerCase().trim());

        // Estimate bounding box
        const isImage = isImageFieldType(matchedField.type, matchedField.name);
        let box_w_mm, box_h_mm;
        if (isImage) {
          // Default image box: ~20mm × 25mm
          box_w_mm = 20;
          box_h_mm = 25;
        } else {
          // Text: estimate width from text length and font size, height from font size
          const charWidthPx = pdfFontSize * pdfScale * 0.55;
          const estWidth = Math.max(rawText.length * charWidthPx, 30);
          box_w_mm = Math.min(estWidth / SCALE, 80);
          box_h_mm = Math.max((pdfFontSize * pdfScale * 1.4) / SCALE, 4);
        }

        // Position: use detected position, nudge up by half box height
        let x_mm = canvasX / SCALE;
        let y_mm = (canvasY / SCALE) - (box_h_mm * 0.7);

        // Clamp to card bounds
        x_mm = Math.max(0, Math.min(x_mm, 87 - box_w_mm));
        y_mm = Math.max(0, Math.min(y_mm, 57 - box_h_mm));

        newMappings[matchedField.name] = {
          x_mm: Math.round(x_mm * 100) / 100,
          y_mm: Math.round(y_mm * 100) / 100,
          w_mm: Math.round(box_w_mm * 100) / 100,
          h_mm: Math.round(box_h_mm * 100) / 100,
        };
      });

      // ── Auto-detect font size and family from PDF text ──
      if (detectedFontSizes.length > 0) {
        // Find the most common font size (rounded to nearest int), clamp to 7–10
        const sizeCounts = {};
        detectedFontSizes.forEach(s => {
          const rounded = Math.round(s);
          sizeCounts[rounded] = (sizeCounts[rounded] || 0) + 1;
        });
        let bestSize = 8, bestSizeCount = 0;
        Object.entries(sizeCounts).forEach(([sz, cnt]) => {
          if (cnt > bestSizeCount) { bestSize = parseInt(sz); bestSizeCount = cnt; }
        });
        bestSize = Math.min(10, Math.max(7, bestSize));
        document.getElementById('fontSizeInput').value = bestSize;
      }
      if (detectedFontNames.length > 0) {
        // Determine if the dominant font is bold or regular
        const nameCounts = {};
        detectedFontNames.forEach(fn => {
          nameCounts[fn] = (nameCounts[fn] || 0) + 1;
        });
        let bestFont = '', bestFontCount = 0;
        Object.entries(nameCounts).forEach(([fn, cnt]) => {
          if (cnt > bestFontCount) { bestFont = fn; bestFontCount = cnt; }
        });
        const isBold = /bold/i.test(bestFont);
        document.getElementById('fontFamilySelect').value = isBold ? 'Helvetica-Bold' : 'Helvetica';
      }

      // Merge into current side mappings (don't overwrite manually-placed fields)
      const existing = fieldMappings[currentSide] || {};
      let addedCount = 0;
      Object.keys(newMappings).forEach(name => {
        if (!existing[name]) {
          existing[name] = newMappings[name];
          addedCount++;
        }
      });
      fieldMappings[currentSide] = existing;

      renderMappingsOnCanvas();
      renderPlacedFields();
      updateGenerateBtn();

      if (addedCount > 0) {
        showToast('Auto-detected ' + addedCount + ' field(s). You can adjust them manually.', 'success');
      } else if (Object.keys(newMappings).length > 0) {
        showToast('All detected fields were already placed.', 'info');
      } else {
        showToast('No matching field labels found in PDF. Place fields manually.', 'warning');
      }

    }).catch(function (err) {
      console.error('Auto-detect error:', err);
      showToast('Auto-detection failed. Place fields manually.', 'error');
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Auto-Detect'; }
    });
  }

  /**
   * Try to match extracted PDF text to a table field name.
   * Uses multiple strategies: exact match, contains, fuzzy.
   */
  function matchTextToField(text, fieldLookup, alreadyMatched) {
    const clean = text.toLowerCase().trim()
      .replace(/[:\-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 1. Exact match
    if (fieldLookup[clean] && !alreadyMatched.has(clean)) {
      return fieldLookup[clean];
    }

    // 2. Check each field name — if the PDF text contains the field name or vice versa
    for (const [lowerName, field] of Object.entries(fieldLookup)) {
      if (alreadyMatched.has(lowerName)) continue;

      const cleanName = lowerName.replace(/[_\-]/g, ' ').trim();

      // PDF text contains the field name
      if (clean.includes(cleanName) && cleanName.length >= 3) {
        return field;
      }
      // Field name contains the PDF text
      if (cleanName.includes(clean) && clean.length >= 3) {
        return field;
      }
      // Handle common label patterns: "Field Name :" or "Field Name-"
      const labelPattern = clean.replace(/\s*[:;\-]\s*$/, '').trim();
      if (labelPattern === cleanName) {
        return field;
      }
    }

    return null;
  }

  function isImageFieldType(type, name) {
    const t = (type || '').toLowerCase();
    const n = (name || '').toLowerCase();
    return t === 'image' || t === 'photo' || t === 'file' ||
           n === 'photo' || n === 'image' || n === 'picture' || n === 'pic' || n === 'img' ||
           n.includes('photo') || n.includes('image') || n.includes('signature');
  }

  /* ══════════════════════════════════ PLACED FIELDS UI ══ */

  function renderPlacedFields() {
    const container = document.getElementById('genPlacedFields');
    const noMsg     = document.getElementById('noFieldsMsg');

    // Collect all placed fields across both sides
    const allPlaced = [];
    ['front', 'back'].forEach(side => {
      if (!isTwoSided && side === 'back') return;
      Object.entries(fieldMappings[side] || {}).forEach(([name, dim]) => {
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
      const div = document.createElement('div');
      div.className = 'gen-placed-field-item';
      div.innerHTML = `
        <span class="field-side-tag">${side === 'front' ? 'F' : 'B'}</span>
        <span class="field-name">${escHtml(name)}</span>
        <span class="gen-placed-field-type">${fieldObj.type === 'photo' || fieldObj.type.includes('photo') ? '🖼' : 'T'}</span>
        <button class="gen-remove-field-btn" data-side="${side}" data-field="${escHtml(name)}" title="Remove placement">✕</button>
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
  }

  /* ═══════════════════════ CARD LIST ════════════════════ */

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
    return textParts.length > 0 ? textParts.join(' — ') : ('Card #' + (item.card_id || item.pr_id));
  }

  function loadCardList() {
    const loadingEl = document.getElementById('genCardListLoading');
    const emptyEl   = document.getElementById('genCardListEmpty');
    const listEl    = document.getElementById('genCardList');
    const hasListUI = !!listEl;

    fetch(`/print/api/generate-card/table/${TABLE_ID}/cards/`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    .then(r => r.json())
    .then(data => {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (data.error)  { showToast(data.error, 'error'); return; }
      genCards = data.items || data.cards || [];
      const countBadge = document.getElementById('genCardCountBadge');
      if (countBadge) countBadge.textContent = data.total || genCards.length;
      if (hasListUI) {
        if (genCards.length === 0) {
          if (emptyEl) emptyEl.classList.remove('hidden');
        } else {
          renderCardList(genCards);
        }
      } else {
        // No selection UI — auto-select all loaded cards
        genCards.forEach(c => selectedPrIds.add(c.pr_id));
      }
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
    const hasMappings = Object.keys(fieldMappings.front).length > 0 ||
                        Object.keys(fieldMappings.back).length > 0;
    document.getElementById('generatePdfBtn').disabled = !(hasCards && hasMappings);
  }

  /* ═══════════════════════ API CALLS ═════════════════════ */

  function saveTemplate() {
    const btn = document.getElementById('saveTemplateBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

    const payload = {
      is_two_sided:   isTwoSided,
      font_size:      parseInt(document.getElementById('fontSizeInput').value) || 8,
      font_family:    document.getElementById('fontFamilySelect').value,
      field_mappings: fieldMappings,
    };

    fetch(`/print/api/generate-card/table/${TABLE_ID}/template/save/`, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-CSRFToken':       getCookie('csrftoken'),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(payload),
    })
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        showToast(data.error, 'error');
      } else {
        showToast('Template saved!', 'success');
      }
    })
    .catch(err => {
      console.error(err);
      showToast('Failed to save template.', 'error');
    })
    .finally(() => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Template';
      updateGenerateBtn();
    });
  }

  function generatePdf() {
    if (selectedPrIds.size === 0) {
      showToast('Select at least one card.', 'warning');
      return;
    }

    const btn = document.getElementById('generatePdfBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating…';

    fetch(`/print/api/generate-card/table/${TABLE_ID}/generate/`, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-CSRFToken':       getCookie('csrftoken'),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ request_ids: Array.from(selectedPrIds) }),
    })
    .then(response => {
      if (!response.ok) {
        return response.json().then(d => { throw new Error(d.error || d.message || 'Server error'); });
      }
      return response.blob();
    })
    .then(blob => {
      // Store the blob — allow download via button
      lastPdfBlob = blob;

      // Enable footer Download PDF button if it exists (modal mode)
      const dlBtn = document.getElementById('gcDownloadPdfBtn');
      if (dlBtn) {
        dlBtn.disabled = false;
        dlBtn.classList.remove('opacity-50');
      }

      showToast('PDF ready! Click Download PDF to save. Cards moved to Finalized.', 'success');
      selectedPrIds.clear();
      loadCardList();
    })
    .catch(err => {
      console.error(err);
      showToast(err.message || 'Failed to generate PDF.', 'error');
    })
    .finally(() => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-gears"></i> Generate PDF';
    });
  }

  function uploadPdf(file, side) {
    const formData = new FormData();
    formData.append('pdf', file);

    showToast(`Uploading ${side} template…`, 'info');

    fetch(`/print/api/generate-card/table/${TABLE_ID}/template/upload-pdf/${side}/`, {
      method:  'POST',
      headers: {
        'X-CSRFToken':       getCookie('csrftoken'),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: formData,
    })
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        showToast(data.error, 'error');
        return;
      }
      showToast(`${side.charAt(0).toUpperCase() + side.slice(1)} template uploaded!`, 'success');
      if (side === 'front') {
        FRONT_PDF_URL = data.pdf_url;
        if (currentSide === 'front') renderPdf(data.pdf_url, true);
      } else {
        BACK_PDF_URL = data.pdf_url;
        if (currentSide === 'back') renderPdf(data.pdf_url, true);
      }
    })
    .catch(err => {
      console.error(err);
      showToast('Upload failed.', 'error');
    });
  }

  /* ═══════════════════════ HELPERS ═══════════════════════ */

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
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    } else {
      console.log(`[${type}] ${msg}`);
    }
  }

})();
