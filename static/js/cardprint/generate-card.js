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

  // cards currently in generate list
  let genCards = [];
  let selectedCardIds = new Set();

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
    if (FRONT_PDF_URL) renderPdf(FRONT_PDF_URL);
  });

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

  /* ── Populate field dropdown from TABLE_FIELDS ─────────── */
  function populateFieldDropdown() {
    const sel = document.getElementById('fieldToPlaceSelect');
    TABLE_FIELDS.forEach(function (f) {
      const opt  = document.createElement('option');
      opt.value  = f.name;
      const isPhoto = f.type && (f.type === 'photo' || f.type.includes('photo'));
      opt.textContent = f.name + (isPhoto ? ' 🖼' : '');
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

    // Card list: select all / none
    document.getElementById('genSelectAllBtn').addEventListener('click', () => {
      genCards.forEach(c => selectedCardIds.add(c.id));
      renderCardList(genCards);
      updateGenerateBtn();
    });
    document.getElementById('genClearSelBtn').addEventListener('click', () => {
      selectedCardIds.clear();
      renderCardList(genCards);
      updateGenerateBtn();
    });

    // Card search
    document.getElementById('genCardSearch').addEventListener('input', function () {
      const q = this.value.toLowerCase();
      const filtered = genCards.filter(c =>
        (c.display_name || c.name || '').toLowerCase().includes(q)
      );
      renderCardList(filtered);
    });

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
    document.getElementById('sideToggle').style.display       = val ? 'inline-flex' : 'none';
    document.getElementById('uploadBackWrapper').style.display = val ? 'inline-flex' : 'none';

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

    const pdfUrl = side === 'front' ? FRONT_PDF_URL : BACK_PDF_URL;
    if (pdfUrl) {
      renderPdf(pdfUrl);
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
    document.getElementById('drawModeIndicator').style.display = 'flex';
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
    document.getElementById('drawModeIndicator').style.display = 'none';
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
    document.getElementById('noTemplateMsg').style.display = '';
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
  function renderPdf(url) {
    const overlay = document.getElementById('pdfLoadingOverlay');
    const noTpl   = document.getElementById('noTemplateMsg');
    overlay.style.display = 'flex';
    noTpl.style.display   = 'none';

    pdfjsLib.getDocument(url).promise.then(function (pdfDoc) {
      return pdfDoc.getPage(1);
    }).then(function (page) {
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
            overlay.style.display = 'none';
            renderMappingsOnCanvas();
          });
        });
      });
    }).catch(function (err) {
      console.error('PDF.js error:', err);
      overlay.style.display = 'none';
      noTpl.style.display   = '';
      showToast('Failed to load PDF template.', 'error');
    });
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
      noMsg.style.display = '';
      // Remove any existing chips
      container.querySelectorAll('.gen-placed-field-item').forEach(el => el.remove());
      return;
    }

    noMsg.style.display = 'none';
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

  function loadCardList() {
    const loadingEl = document.getElementById('genCardListLoading');
    const emptyEl   = document.getElementById('genCardListEmpty');
    const listEl    = document.getElementById('genCardList');

    fetch(`/print/api/generate-card/table/${TABLE_ID}/cards/`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    .then(r => r.json())
    .then(data => {
      loadingEl.style.display = 'none';
      if (data.error)  { showToast(data.error, 'error'); return; }
      genCards = data.cards || [];
      document.getElementById('genCardCountBadge').textContent = genCards.length;
      if (genCards.length === 0) {
        emptyEl.style.display = '';
      } else {
        renderCardList(genCards);
      }
      updateGenerateBtn();
    }).catch(err => {
      loadingEl.style.display = 'none';
      console.error(err);
      showToast('Failed to load generate list.', 'error');
    });
  }

  function renderCardList(cards) {
    const listEl  = document.getElementById('genCardList');
    const emptyEl = document.getElementById('genCardListEmpty');
    listEl.querySelectorAll('.gen-card-item').forEach(el => el.remove());

    if (cards.length === 0) {
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';

    cards.forEach(card => {
      const div = document.createElement('div');
      div.className = 'gen-card-item' + (selectedCardIds.has(card.id) ? ' selected' : '');
      div.innerHTML = `
        <input type="checkbox" ${selectedCardIds.has(card.id) ? 'checked' : ''} data-id="${card.id}">
        <span class="gen-card-name">${escHtml(card.display_name || card.name || 'Card #' + card.id)}</span>
        <span class="gen-card-id">#${card.id}</span>
      `;
      const cb = div.querySelector('input[type=checkbox]');
      cb.addEventListener('change', function () {
        if (this.checked) {
          selectedCardIds.add(card.id);
          div.classList.add('selected');
        } else {
          selectedCardIds.delete(card.id);
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
    const hasCards    = selectedCardIds.size > 0;
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
    if (selectedCardIds.size === 0) {
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
      body: JSON.stringify({ card_ids: Array.from(selectedCardIds) }),
    })
    .then(response => {
      if (!response.ok) {
        return response.json().then(d => { throw new Error(d.error || 'Server error'); });
      }
      return response.blob();
    })
    .then(blob => {
      // Trigger download
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `cards-${TABLE_NAME.replace(/[^a-z0-9_-]/gi, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showToast('PDF downloaded! Cards moved to Finalized.', 'success');
      selectedCardIds.clear();
      loadCardList();
    })
    .catch(err => {
      console.error(err);
      showToast(err.message || 'Failed to generate PDF.', 'error');
    })
    .finally(() => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Generate PDF';
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
        FRONT_PDF_URL = data.url;
        if (currentSide === 'front') renderPdf(data.url);
      } else {
        BACK_PDF_URL = data.url;
        if (currentSide === 'back') renderPdf(data.url);
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
