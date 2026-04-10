/**
 * Template-driven Generate Cards runtime (Version 2 visual editor).
 * - Template selection
 * - Fabric.js drag-and-drop editor
 * - Grid snapping + resize
 * - Save/generate/download compatibility
 */
(function () {
  'use strict';

  var TABLE_ID = Number(window.TABLE_ID || 0);
  if (!TABLE_ID) return;

  var TABLE_FIELDS = Array.isArray(window.TABLE_FIELDS) ? window.TABLE_FIELDS : [];
  var modalEl = document.getElementById('gcEditorModal');
  var isModalMode = !!modalEl;

  var panelBase = window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';
  var apiBases = panelBase ? [panelBase + '/print', '/print'] : ['/print', '/panel/print'];
  var GRID_SIZE = 10;

  var state = {
    flow: 'select',
    templates: [],
    activeTemplateId: null,
    template: null,
    selectedSide: 'front',
    selectedElementId: null,
    cards: [],
    selectedRequestIds: new Set(),
    lastPdfBlob: null,
    lastPdfName: 'generated_cards.pdf',
    loading: false,
    fabricCanvas: null,
    fabricObjectsById: {},
    mountedChangeHandlers: false,
    previewMode: 'real',
    sampleByField: {},
  };

  var workflowRoot = null;

  function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function clamp(value, min, max, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function snap(value) {
    return Math.round(Number(value || 0) / GRID_SIZE) * GRID_SIZE;
  }

  function defaultTemplateJson() {
    return {
      canvas: {
        width: 350,
        height: 200,
        unit: 'px',
        realWidthMM: 85.6,
        realHeightMM: 54,
        safeMargin: 10,
        bleed: 5,
        printLayout: {
          mode: '1',
          columns: 1,
          rows: 1,
          marginMM: 8,
          gapXMM: 4,
          gapYMM: 4,
          pageSize: 'a4',
        },
      },
      elements: [],
    };
  }

  function normalizeOrientation(value) {
    return value === 'portrait' ? 'portrait' : 'landscape';
  }

  function getCSRFToken() {
    if (typeof window.getCSRFToken === 'function') return window.getCSRFToken();
    var el = document.querySelector('[name=csrfmiddlewaretoken]');
    return el ? el.value : '';
  }

  function showToast(message, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type || 'info');
      return;
    }
    console.log('[GenerateCards][' + (type || 'info') + ']', message);
  }

  function escapeHtml(text) {
    var d = document.createElement('div');
    d.textContent = String(text || '');
    return d.innerHTML;
  }

  function parseFilename(disposition, fallback) {
    if (!disposition) return fallback;
    var m = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
    if (!m || !m[1]) return fallback;
    try {
      return decodeURIComponent(m[1]);
    } catch (_err) {
      return m[1];
    }
  }

  function templateApiPath(refId) {
    return '/api/templates/' + Number(refId) + '/';
  }

  function templateDetailApiPath(templateId) {
    return '/api/template/' + Number(templateId) + '/';
  }

  function templateDuplicateApiPath(templateId) {
    return '/api/template/' + Number(templateId) + '/duplicate/';
  }

  function templateSetDefaultApiPath(templateId) {
    return '/api/template/' + Number(templateId) + '/set-default/';
  }

  function generateApiPath(path) {
    return '/api/generate-card/table/' + TABLE_ID + path;
  }

  function setLoading(active, message) {
    state.loading = !!active;
    state.loadingMessage = String(message || 'Working...');
    if (!workflowRoot) return;
    var mask = workflowRoot.querySelector('.gc-workflow-loading');
    if (!mask) {
      mask = document.createElement('div');
      mask.className = 'gc-workflow-loading hidden';
      mask.innerHTML = '<div class="gc-workflow-loading-box"><span class="gc-spinner"></span><span class="gc-workflow-loading-text"></span></div>';
      workflowRoot.appendChild(mask);
    }
    var txt = mask.querySelector('.gc-workflow-loading-text');
    if (txt) txt.textContent = state.loadingMessage;
    mask.classList.toggle('hidden', !state.loading);
  }

  async function runWithLoading(message, fn) {
    setLoading(true, message);
    try {
      return await fn();
    } finally {
      setLoading(false);
    }
  }

  async function requestJson(method, path, body) {
    var lastError = null;
    for (var i = 0; i < apiBases.length; i += 1) {
      var url = apiBases[i] + path;
      try {
        var resp = await fetch(url, {
          method: method,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken(),
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        if (resp.status === 404 && i < (apiBases.length - 1)) {
          continue;
        }

        var data = await resp.json();
        if (!resp.ok || (data && data.status === 'error')) {
          throw new Error((data && data.message) || ('Request failed (HTTP ' + resp.status + ')'));
        }
        return data;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Request failed');
  }

  async function requestPdf(path, body) {
    var lastError = null;
    for (var i = 0; i < apiBases.length; i += 1) {
      var url = apiBases[i] + path;
      try {
        var resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken(),
          },
          body: JSON.stringify(body || {}),
        });

        if (resp.status === 404 && i < (apiBases.length - 1)) {
          continue;
        }

        var contentType = String(resp.headers.get('Content-Type') || '').toLowerCase();
        if (!resp.ok || contentType.indexOf('application/pdf') === -1) {
          if (contentType.indexOf('application/json') !== -1) {
            var payload = await resp.json();
            throw new Error((payload && payload.message) || 'Generation failed');
          }
          throw new Error('Generation failed (HTTP ' + resp.status + ')');
        }

        return {
          blob: await resp.blob(),
          filename: parseFilename(resp.headers.get('Content-Disposition'), 'generated_cards.pdf'),
        };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Generation failed');
  }

  function imageLikeField(fieldMeta, fieldName) {
    var type = String((fieldMeta && fieldMeta.type) || '').toLowerCase();
    var name = String(fieldName || '').toLowerCase();
    return (
      ['photo', 'image', 'signature', 'barcode', 'qr_code', 'qr'].indexOf(type) >= 0
      || name.indexOf('photo') >= 0
      || name.indexOf('image') >= 0
      || name.indexOf('sign') >= 0
      || name.indexOf('qr') >= 0
      || name.indexOf('barcode') >= 0
    );
  }

  function byFieldName(name) {
    var target = String(name || '').trim().toLowerCase();
    for (var i = 0; i < TABLE_FIELDS.length; i += 1) {
      if (String(TABLE_FIELDS[i].name || '').trim().toLowerCase() === target) return TABLE_FIELDS[i];
    }
    return null;
  }

  function normalizeImageUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (/^data:image\//i.test(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.indexOf('/media/') === 0) return raw;
    if (raw.indexOf('media/') === 0) return '/' + raw;
    if (raw[0] === '/') return raw;
    return '/media/' + raw;
  }

  function isLikelyImageValue(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (!raw) return false;
    return (
      /^data:image\//.test(raw)
      || /^https?:\/\//.test(raw)
      || raw.indexOf('/media/') === 0
      || raw.indexOf('media/') === 0
      || /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(raw)
    );
  }

  function sampleFallbackForField(fieldName) {
    var name = String(fieldName || '').trim().toLowerCase();
    if (!name) return 'Sample';
    if (name.indexOf('name') >= 0) return 'John Doe';
    if (name.indexOf('class') >= 0) return 'BCA';
    if (name.indexOf('section') >= 0) return 'A';
    if (name.indexOf('roll') >= 0 || name.indexOf('id') >= 0) return '101';
    if (name.indexOf('mobile') >= 0 || name.indexOf('phone') >= 0) return '9999999999';
    return 'Sample';
  }

  function getSampleFieldValue(fieldName) {
    var key = String(fieldName || '').trim().toLowerCase();
    if (!key) return '';
    if (Object.prototype.hasOwnProperty.call(state.sampleByField, key)) {
      var val = state.sampleByField[key];
      if (val !== undefined && val !== null && String(val).trim() !== '') return String(val);
    }
    return sampleFallbackForField(fieldName);
  }

  function buildSampleRecordMap(cards) {
    var map = {};
    var first = Array.isArray(cards) && cards.length ? cards[0] : null;
    var ordered = first && Array.isArray(first.ordered_fields) ? first.ordered_fields : [];
    for (var i = 0; i < ordered.length; i += 1) {
      var row = ordered[i] || {};
      var key = String(row.name || '').trim().toLowerCase();
      if (!key) continue;
      map[key] = row.value;
    }
    return map;
  }

  function ensureTemplateJson(raw) {
    var src = (raw && typeof raw === 'object') ? raw : {};
    var canvas = (src.canvas && typeof src.canvas === 'object') ? src.canvas : {};
    var width = clamp(canvas.width, 100, 1600, 350);
    var height = clamp(canvas.height, 60, 1200, 200);

    var unit = String(canvas.unit || 'px').toLowerCase();
    if (unit !== 'px') unit = 'px';
    var realWidthMM = clamp(canvas.realWidthMM, 10, 400, 85.6);
    var realHeightMM = clamp(canvas.realHeightMM, 10, 400, 54);
    var safeMargin = clamp(canvas.safeMargin, 0, Math.min(width, height) / 2, 10);
    var bleed = clamp(canvas.bleed, 0, Math.min(width, height) / 2, 5);

    var printLayout = (canvas.printLayout && typeof canvas.printLayout === 'object') ? canvas.printLayout : {};
    var layoutMode = String(printLayout.mode || '1').toLowerCase();
    if (['1', '2', '4', 'custom'].indexOf(layoutMode) < 0) layoutMode = '1';
    var layoutCols = clamp(printLayout.columns, 1, 12, layoutMode === '4' ? 2 : (layoutMode === '2' ? 2 : 1));
    var layoutRows = clamp(printLayout.rows, 1, 12, layoutMode === '4' ? 2 : 1);
    var pageSize = String(printLayout.pageSize || 'a4').toLowerCase();
    if (pageSize !== 'a4') pageSize = 'a4';

    var elements = Array.isArray(src.elements) ? src.elements : [];
    var cleanElements = elements.map(function (item) {
      if (!item || typeof item !== 'object') return null;
      var side = String(item.side || 'front').toLowerCase();
      if (side !== 'back' && side !== 'both') side = 'front';
      var type = String(item.type || 'text').toLowerCase();
      if (type !== 'image' && type !== 'background') type = 'text';
      var field = String(item.field || '').trim();
      if ((type === 'text' || type === 'image') && !field) return null;
      var align = String(item.align || 'left').toLowerCase();
      if (align !== 'center' && align !== 'right') align = 'left';
      var color = String(item.color || '#111111').trim();
      if (!/^#?[0-9a-fA-F]{6}$/.test(color)) color = '#111111';
      if (color[0] !== '#') color = '#' + color;

      var srcValue = String(item.src || '').trim();
      if (type === 'background') {
        srcValue = normalizeImageUrl(srcValue);
        if (!srcValue) return null;
      }

      var widthVal = Number(item.width || (type === 'background' ? width : (type === 'image' ? 60 : 120)));
      var heightVal = Number(item.height || (type === 'background' ? height : (type === 'image' ? 70 : 24)));

      var clean = {
        id: String(item.id || ('el_' + Math.random().toString(36).slice(2, 10))),
        type: type,
        label: String(item.label || '').slice(0, 120),
        field: field,
        x: clamp(item.x, 0, width, type === 'background' ? 0 : 20),
        y: clamp(item.y, 0, height, type === 'background' ? 0 : 20),
        width: clamp(widthVal, 10, width, 120),
        height: clamp(heightVal, 10, height, 24),
        fontSize: clamp(item.fontSize, 6, 72, 12),
        align: align,
        color: color,
        side: side,
        showLabel: !!item.showLabel,
        locked: !!item.locked,
      };

      if (type === 'background') {
        clean.field = '';
        clean.label = clean.label || 'Background';
        clean.x = 0;
        clean.y = 0;
        clean.width = width;
        clean.height = height;
        clean.src = srcValue;
        clean.locked = item.locked !== false;
      }

      return clean;
    }).filter(Boolean);

    return {
      canvas: {
        width: width,
        height: height,
        unit: unit,
        realWidthMM: realWidthMM,
        realHeightMM: realHeightMM,
        safeMargin: safeMargin,
        bleed: bleed,
        printLayout: {
          mode: layoutMode,
          columns: Number(layoutCols),
          rows: Number(layoutRows),
          marginMM: clamp(printLayout.marginMM, 0, 40, 8),
          gapXMM: clamp(printLayout.gapXMM, 0, 40, 4),
          gapYMM: clamp(printLayout.gapYMM, 0, 40, 4),
          pageSize: pageSize,
        },
      },
      elements: cleanElements,
    };
  }

  function mappingsToTemplateJson(templateLike) {
    var mappings = (templateLike && templateLike.field_mappings && typeof templateLike.field_mappings === 'object') ? templateLike.field_mappings : {};
    var front = (mappings.front && typeof mappings.front === 'object') ? mappings.front : {};
    var back = (mappings.back && typeof mappings.back === 'object') ? mappings.back : {};
    var canvas = {
      width: 350,
      height: 200,
      unit: 'px',
      realWidthMM: 85.6,
      realHeightMM: 54,
      safeMargin: 10,
      bleed: 5,
      printLayout: {
        mode: '1',
        columns: 1,
        rows: 1,
        marginMM: 8,
        gapXMM: 4,
        gapYMM: 4,
        pageSize: 'a4',
      },
    };
    var cardW = 87;
    var cardH = 57;

    function mmToCanvasX(mm) { return Math.round((Number(mm || 0) / cardW) * canvas.width); }
    function mmToCanvasY(mm) { return Math.round((Number(mm || 0) / cardH) * canvas.height); }

    var elements = [];
    Object.keys(front).forEach(function (fieldName) {
      var map = front[fieldName] || {};
      var fieldMeta = byFieldName(fieldName);
      elements.push({
        id: 'f_' + fieldName,
        type: imageLikeField(fieldMeta, fieldName) ? 'image' : 'text',
        label: String(fieldName),
        field: String(fieldName),
        x: mmToCanvasX(map.x_mm),
        y: mmToCanvasY(map.y_mm),
        width: Math.max(12, mmToCanvasX(map.w_mm || 20)),
        height: Math.max(12, mmToCanvasY(map.h_mm || 10)),
        fontSize: 12,
        align: 'left',
        color: '#111111',
        side: 'front',
        showLabel: true,
        locked: false,
      });
    });
    Object.keys(back).forEach(function (fieldName) {
      var map = back[fieldName] || {};
      var fieldMeta = byFieldName(fieldName);
      elements.push({
        id: 'b_' + fieldName,
        type: imageLikeField(fieldMeta, fieldName) ? 'image' : 'text',
        label: String(fieldName),
        field: String(fieldName),
        x: mmToCanvasX(map.x_mm),
        y: mmToCanvasY(map.y_mm),
        width: Math.max(12, mmToCanvasX(map.w_mm || 20)),
        height: Math.max(12, mmToCanvasY(map.h_mm || 10)),
        fontSize: 12,
        align: 'left',
        color: '#111111',
        side: 'back',
        showLabel: true,
        locked: false,
      });
    });

    return { canvas: canvas, elements: elements };
  }

  function normalizeTemplate(raw) {
    var src = (raw && typeof raw === 'object') ? raw : {};
    var hasTemplateJson = src.template_json && typeof src.template_json === 'object';
    var templateJson = hasTemplateJson ? ensureTemplateJson(src.template_json) : mappingsToTemplateJson(src);

    return {
      id: src.id || null,
      name: String(src.name || 'New Template'),
      is_two_sided: !!src.is_two_sided,
      card_orientation: normalizeOrientation(src.card_orientation || 'landscape'),
      font_size: Number(src.font_size || 11),
      font_family: String(src.font_family || 'Arial'),
      docx_style: (src.docx_style && typeof src.docx_style === 'object') ? src.docx_style : {
        text_align: 'left',
        font_color_hex: '#111111',
      },
      template_json: templateJson,
    };
  }

  function currentTemplate() {
    return state.template;
  }

  function allFieldNames() {
    return TABLE_FIELDS.map(function (f) { return String((f && f.name) || '').trim(); }).filter(Boolean);
  }

  function elementsForSide(side) {
    var tpl = currentTemplate();
    if (!tpl) return [];
    var wanted = side === 'back' ? 'back' : 'front';
    return tpl.template_json.elements.filter(function (item) {
      var elementSide = String(item.side || 'front');
      return elementSide === wanted || elementSide === 'both';
    });
  }

  function getElementById(id) {
    var tpl = currentTemplate();
    if (!tpl || !id) return null;
    var items = tpl.template_json.elements;
    for (var i = 0; i < items.length; i += 1) {
      if (String(items[i].id) === String(id)) return items[i];
    }
    return null;
  }

  function selectedElement() {
    return getElementById(state.selectedElementId);
  }

  function loadSelectionFromRows() {
    var pre = Array.isArray(window.GEN_PRESELECT_PR_IDS) ? window.GEN_PRESELECT_PR_IDS : [];
    state.selectedRequestIds = new Set(pre.map(function (x) { return Number(x); }).filter(Boolean));
    if (state.selectedRequestIds.size > 0) return;
    state.cards.forEach(function (item) {
      if (item && item.pr_id) state.selectedRequestIds.add(Number(item.pr_id));
    });
  }

  async function loadCards() {
    var data = await requestJson('GET', generateApiPath('/cards/?limit=500'));
    state.cards = Array.isArray(data.items) ? data.items : [];
    state.sampleByField = buildSampleRecordMap(state.cards);
    loadSelectionFromRows();
  }

  async function loadTemplates() {
    var data = await requestJson('GET', templateApiPath(TABLE_ID));
    state.templates = Array.isArray(data.templates) ? data.templates : [];
  }

  async function loadTemplateDetail(templateId) {
    var data = await requestJson('GET', templateDetailApiPath(templateId));
    state.template = normalizeTemplate(data.template || {});
    state.activeTemplateId = state.template.id;
    state.selectedSide = state.template.is_two_sided ? state.selectedSide : 'front';
    if (state.selectedSide !== 'back') state.selectedSide = 'front';
    state.selectedElementId = null;
  }

  function newTemplateDraft() {
    var baseName = 'Template ' + new Date().toLocaleTimeString();
    state.template = normalizeTemplate({
      id: null,
      name: baseName,
      is_two_sided: false,
      card_orientation: 'landscape',
      template_json: defaultTemplateJson(),
      docx_style: { text_align: 'left', font_color_hex: '#111111' },
    });
    state.activeTemplateId = null;
    state.selectedSide = 'front';
    state.selectedElementId = null;
  }

  function setFlow(flow) {
    if (state.flow === 'edit' && flow !== 'edit') syncTemplateElementsFromCanvas();
    state.flow = flow;
    render();
  }

  function hasRenderableElements() {
    var tpl = currentTemplate();
    if (!tpl || !tpl.template_json || !Array.isArray(tpl.template_json.elements)) return false;
    return tpl.template_json.elements.length > 0;
  }

  function renderTemplateLibraryList() {
    if (!state.templates.length) {
      return '<div class="gc-empty">No templates found</div>';
    }
    return state.templates.map(function (tpl) {
      var isActive = Number(tpl.id) === Number(state.activeTemplateId || 0);
      var isDefault = !!tpl.is_default;
      return '<div class="gc-template-row' + (isActive ? ' is-active' : '') + '">'
        + '<div class="gc-template-row-head">'
        + '<button type="button" class="gc-template-link" data-action="use-template" data-template-id="' + Number(tpl.id) + '">' + escapeHtml(tpl.name || ('Template #' + tpl.id)) + '</button>'
        + '<span class="gc-template-badges">'
        + (isDefault ? '<span class="gc-badge gc-badge-default">Default</span>' : '')
        + (tpl.is_active ? '<span class="gc-badge gc-badge-active">Active</span>' : '')
        + '</span>'
        + '</div>'
        + '<div class="gc-template-row-meta">v' + Number(tpl.version || 1) + ' | ' + Number(tpl.element_count || 0) + ' elements</div>'
        + '<div class="gc-template-row-actions">'
        + '<button type="button" class="btn btn-xs btn-outline" data-action="edit-template" data-template-id="' + Number(tpl.id) + '">Edit</button>'
        + '<button type="button" class="btn btn-xs btn-outline" data-action="duplicate-template" data-template-id="' + Number(tpl.id) + '">Duplicate</button>'
        + '<button type="button" class="btn btn-xs btn-outline" data-action="set-default-template" data-template-id="' + Number(tpl.id) + '">Set Default</button>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  function renderTemplateSelectionScreen() {
    var listHtml = '';
    if (!state.templates.length) {
      listHtml = '<div class="gc-empty gc-empty-large">'
        + '<div class="gc-empty-title">No templates found</div>'
        + '<div class="gc-empty-subtitle">Create your first professional card template to begin.</div>'
        + '<button type="button" class="btn btn-sm btn-blue" data-action="create-template">Create Template</button>'
        + '</div>';
    } else {
      listHtml = state.templates.map(function (tpl) {
        var defaultBadge = tpl.is_default ? '<span class="gc-badge gc-badge-default">Default</span>' : '';
        return '<div class="gc-template-card">'
          + '<div class="gc-template-card-head">'
          + '<div class="gc-template-card-title">' + escapeHtml(tpl.name || ('Template #' + tpl.id)) + '</div>'
          + defaultBadge
          + '</div>'
          + '<div class="gc-template-meta">Version ' + Number(tpl.version || 1) + ' | ' + Number(tpl.element_count || 0) + ' elements</div>'
          + '<div class="gc-template-actions">'
          + '<button type="button" class="btn btn-sm btn-outline" data-action="use-template" data-template-id="' + Number(tpl.id) + '">Use</button>'
          + '<button type="button" class="btn btn-sm btn-outline" data-action="edit-template" data-template-id="' + Number(tpl.id) + '">Edit</button>'
          + '<button type="button" class="btn btn-sm btn-outline" data-action="duplicate-template" data-template-id="' + Number(tpl.id) + '">Duplicate</button>'
          + '<button type="button" class="btn btn-sm btn-outline" data-action="set-default-template" data-template-id="' + Number(tpl.id) + '">Set Default</button>'
          + '</div>'
          + '</div>';
      }).join('');
    }

    return '<div class="gc-screen">'
      + '<div class="gc-screen-header">'
      + '<h3>Select Template</h3>'
      + '<button type="button" class="btn btn-sm btn-green" data-action="create-template">Create New Template</button>'
      + '</div>'
      + '<div class="gc-template-list">' + listHtml + '</div>'
      + '</div>';
  }

  function renderElementRows(side) {
    var rows = elementsForSide(side);
    if (!rows.length) return '<div class="gc-empty">No elements on this side.</div>';
    return rows.map(function (item) {
      var rowLabel = item.type === 'background' ? 'Background' : (item.label || item.field);
      var rowMeta = item.type === 'background' ? 'background image' : (item.field + ' (' + item.type + ')');
      return '<div class="gc-element-row" data-element-row="' + escapeHtml(item.id) + '">'
        + '<button type="button" class="gc-element-select" data-action="select-element" data-element-id="' + escapeHtml(item.id) + '">' + escapeHtml(rowLabel) + '</button>'
        + '<span class="gc-element-meta">' + escapeHtml(rowMeta) + '</span>'
        + '<button type="button" class="btn btn-xs btn-outline" data-action="delete-element" data-element-id="' + escapeHtml(item.id) + '">Delete</button>'
        + '</div>';
    }).join('');
  }

  function renderSelectedElementEditor() {
    var item = selectedElement();
    var disabled = item ? '' : ' disabled';
    var isBackground = !!(item && item.type === 'background');

    var fieldOptions = allFieldNames().map(function (name) {
      var selected = (item && String(item.field) === String(name)) ? ' selected' : '';
      return '<option value="' + escapeHtml(name) + '"' + selected + '>' + escapeHtml(name) + '</option>';
    }).join('');

    return '<div class="gc-element-edit-wrap">'
      + '<div id="gcNoSelectionMsg" class="gc-empty' + (item ? ' hidden' : '') + '">Select an element on canvas to edit its properties.</div>'
      + '<div class="gc-form-grid">'
        + '<label>Field</label><select id="gcElementField"' + (isBackground ? ' disabled' : disabled) + '>' + fieldOptions + '</select>'
      + '<label>Label</label><input id="gcElementLabel" type="text" value="' + escapeHtml(item ? (item.label || '') : '') + '"' + disabled + '>'
      + '<label>X</label><input id="gcElementX" type="number" min="0" step="1" value="' + Number(item ? (item.x || 0) : 0) + '"' + disabled + '>'
      + '<label>Y</label><input id="gcElementY" type="number" min="0" step="1" value="' + Number(item ? (item.y || 0) : 0) + '"' + disabled + '>'
      + '<label>Width</label><input id="gcElementWidth" type="number" min="10" step="1" value="' + Number(item ? (item.width || 20) : 20) + '"' + disabled + '>'
      + '<label>Height</label><input id="gcElementHeight" type="number" min="10" step="1" value="' + Number(item ? (item.height || 20) : 20) + '"' + disabled + '>'
        + '<label>Font Size</label><input id="gcElementFontSize" type="number" min="6" max="72" step="1" value="' + Number(item ? (item.fontSize || 12) : 12) + '"' + (isBackground ? ' disabled' : disabled) + '>'
        + '<label>Align</label><select id="gcElementAlign"' + (isBackground ? ' disabled' : disabled) + '>'
      + '<option value="left"' + (item && item.align === 'left' ? ' selected' : '') + '>Left</option>'
      + '<option value="center"' + (item && item.align === 'center' ? ' selected' : '') + '>Center</option>'
      + '<option value="right"' + (item && item.align === 'right' ? ' selected' : '') + '>Right</option>'
      + '</select>'
        + '<label>Color</label><input id="gcElementColor" type="color" value="' + escapeHtml(item ? (item.color || '#111111') : '#111111') + '"' + (isBackground ? ' disabled' : disabled) + '>'
        + '<label>Locked</label><input id="gcElementLocked" type="checkbox"' + (item && item.locked ? ' checked' : '') + disabled + '>'
      + '</div>'
      + '</div>';
  }

  function renderTemplateEditorScreen() {
    var tpl = currentTemplate();
    if (!tpl) return '<div class="gc-empty">No template loaded.</div>';

    var side = state.selectedSide === 'back' ? 'back' : 'front';
    var sideOptions = tpl.is_two_sided
      ? '<button type="button" class="btn btn-xs ' + (side === 'front' ? 'btn-blue' : 'btn-outline') + '" data-action="set-side" data-side="front">Front</button>'
        + '<button type="button" class="btn btn-xs ' + (side === 'back' ? 'btn-blue' : 'btn-outline') + '" data-action="set-side" data-side="back">Back</button>'
      : '<button type="button" class="btn btn-xs btn-blue" data-action="set-side" data-side="front">Front</button>';

    var fieldOptions = allFieldNames().map(function (name) {
      return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
    }).join('');

    var canvas = ensureTemplateJson(tpl.template_json).canvas;
    var layout = canvas.printLayout || {};
    var layoutMode = String(layout.mode || '1');
    var previewLabel = state.previewMode === 'real' ? 'Real Preview' : 'Placeholder Preview';
    var canGenerate = !!tpl.id && hasRenderableElements();
    var disabledGenerate = canGenerate ? '' : ' disabled';
    var compactTemplates = renderTemplateLibraryList();
    var currentTemplateLabel = escapeHtml(tpl.name || 'Untitled Template');

    return '<div class="gc-screen gc-screen-editor">'
      + '<div class="gc-top-bar">'
      + '<div class="gc-top-left">'
      + '<div class="gc-label">Template Name</div>'
      + '<input id="gcTemplateName" class="gc-top-name" type="text" value="' + currentTemplateLabel + '" maxlength="120">'
      + '</div>'
      + '<div class="gc-top-actions">'
      + '<div class="gc-top-field"><span class="gc-label">Layout</span><select id="gcLayoutMode"><option value="1"' + (layoutMode === '1' ? ' selected' : '') + '>1 Card</option><option value="2"' + (layoutMode === '2' ? ' selected' : '') + '>2 Cards</option><option value="4"' + (layoutMode === '4' ? ' selected' : '') + '>4 Cards</option><option value="custom"' + (layoutMode === 'custom' ? ' selected' : '') + '>Custom</option></select></div>'
      + '<button type="button" class="btn btn-sm btn-outline" data-action="toggle-preview-mode">' + escapeHtml(previewLabel) + '</button>'
      + '<button type="button" class="btn btn-sm btn-green" data-action="save-template">Save</button>'
      + '<button type="button" class="btn btn-sm btn-outline" data-action="back-to-select">Templates</button>'
      + '</div>'
      + '</div>'

      + '<div class="gc-main-grid">'
      + '<aside class="gc-left-sidebar">'
      + '<div class="gc-panel-card">'
      + '<div class="gc-block-title">Templates</div>'
      + '<div class="gc-template-compact-list">' + compactTemplates + '</div>'
      + '<div class="gc-editor-actions">'
      + '<button type="button" class="btn btn-xs btn-outline" data-action="create-template">Create</button>'
      + '<button type="button" class="btn btn-xs btn-outline" data-action="duplicate-template">Duplicate</button>'
      + '<button type="button" class="btn btn-xs btn-outline" data-action="set-default-template">Set Default</button>'
      + '</div>'
      + '</div>'

      + '<div class="gc-panel-card">'
      + '<div class="gc-block-title">Field Tools</div>'
      + '<div class="gc-form-grid">'
      + '<label>Card Type</label><select id="gcTemplateSides"><option value="single"' + (!tpl.is_two_sided ? ' selected' : '') + '>1-Sided</option><option value="double"' + (tpl.is_two_sided ? ' selected' : '') + '>2-Sided</option></select>'
      + '<label>Orientation</label><select id="gcTemplateOrientation"><option value="landscape"' + (tpl.card_orientation === 'landscape' ? ' selected' : '') + '>Horizontal</option><option value="portrait"' + (tpl.card_orientation === 'portrait' ? ' selected' : '') + '>Vertical</option></select>'
      + '<label>Side</label><div class="gc-side-row">' + sideOptions + '</div>'
      + '</div>'
      + '<div class="gc-add-field-row">'
      + '<select id="gcAddFieldSelect"><option value="">Select field</option>' + fieldOptions + '</select>'
      + '<button type="button" class="btn btn-sm btn-blue" data-action="add-field">Add Field</button>'
      + '</div>'
      + '<div class="gc-add-field-row">'
      + '<input id="gcBackgroundUpload" type="file" accept="image/*">'
      + '<button type="button" class="btn btn-sm btn-outline" data-action="upload-background">Set Background</button>'
      + '<button type="button" class="btn btn-sm btn-outline" data-action="remove-background">Remove BG</button>'
      + '</div>'
      + '<div class="gc-block-title">Elements</div>'
      + '<div class="gc-element-list">' + renderElementRows(side) + '</div>'
      + '</div>'
      + '</aside>'

      + '<section class="gc-center-canvas">'
      + '<div class="gc-panel-card gc-panel-card-fill">'
      + '<div class="gc-block-title">Canvas Editor</div>'
      + '<div class="gc-canvas-wrap">'
      + '<div class="gc-canvas-shell" style="width:' + Number(canvas.width) + 'px;height:' + Number(canvas.height) + 'px">'
      + '<canvas id="templateCanvas" width="' + Number(canvas.width) + '" height="' + Number(canvas.height) + '"></canvas>'
      + '</div>'
      + '</div>'
      + '<div class="gc-meta-row">Grid: 10px | Safe: ' + Number(canvas.safeMargin || 10) + 'px | Bleed: ' + Number(canvas.bleed || 5) + 'px | Real: ' + Number(canvas.realWidthMM || 85.6) + ' x ' + Number(canvas.realHeightMM || 54) + ' mm</div>'
      + '</div>'
      + '</section>'

      + '<aside class="gc-right-sidebar">'
      + '<div class="gc-panel-card">'
      + '<div class="gc-block-title">Properties</div>'
      + '<div class="gc-element-editor">' + renderSelectedElementEditor() + '</div>'
      + '</div>'
      + '<div class="gc-panel-card">'
      + '<div class="gc-block-title">Print Settings</div>'
      + '<div class="gc-form-grid">'
      + '<label>Columns</label><input id="gcLayoutCols" type="number" min="1" max="12" step="1" value="' + Number(layout.columns || 1) + '">'
      + '<label>Rows</label><input id="gcLayoutRows" type="number" min="1" max="12" step="1" value="' + Number(layout.rows || 1) + '">'
      + '<label>Margin (mm)</label><input id="gcLayoutMarginMM" type="number" min="0" max="40" step="0.5" value="' + Number(layout.marginMM || 8) + '">'
      + '<label>Gap X (mm)</label><input id="gcLayoutGapXMM" type="number" min="0" max="40" step="0.5" value="' + Number(layout.gapXMM || 4) + '">'
      + '<label>Gap Y (mm)</label><input id="gcLayoutGapYMM" type="number" min="0" max="40" step="0.5" value="' + Number(layout.gapYMM || 4) + '">'
      + '<label>Real Width (mm)</label><input id="gcCanvasRealWidthMM" type="number" min="10" max="400" step="0.1" value="' + Number(canvas.realWidthMM || 85.6) + '">'
      + '<label>Real Height (mm)</label><input id="gcCanvasRealHeightMM" type="number" min="10" max="400" step="0.1" value="' + Number(canvas.realHeightMM || 54) + '">'
      + '<label>Safe Margin</label><input id="gcCanvasSafeMargin" type="number" min="0" max="500" step="1" value="' + Number(canvas.safeMargin || 10) + '">'
      + '<label>Bleed</label><input id="gcCanvasBleed" type="number" min="0" max="500" step="1" value="' + Number(canvas.bleed || 5) + '">'
      + '</div>'
      + '</div>'
      + '</aside>'
      + '</div>'

      + '<div class="gc-bottom-bar">'
      + '<div class="gc-meta-row">Selected cards: ' + Number(state.selectedRequestIds.size || 0) + '</div>'
      + '<div class="gc-bottom-actions">'
      + '<button type="button" class="btn btn-sm btn-outline" data-action="generate-preview"' + disabledGenerate + '>Generate Preview</button>'
      + '<button type="button" class="btn btn-sm btn-blue" data-action="generate-all"' + disabledGenerate + '>Generate All</button>'
      + '<button type="button" class="btn btn-sm btn-outline" data-action="download-last"' + (state.lastPdfBlob ? '' : ' disabled') + '>Download</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function destroyFabricCanvas() {
    if (state.fabricCanvas) {
      state.fabricCanvas.dispose();
      state.fabricCanvas = null;
      state.fabricObjectsById = {};
    }
  }

  function applyGridBackground(canvas) {
    if (!window.fabric) return;
    var gridCanvas = document.createElement('canvas');
    gridCanvas.width = GRID_SIZE;
    gridCanvas.height = GRID_SIZE;
    var ctx = gridCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(GRID_SIZE - 0.5, 0);
    ctx.lineTo(GRID_SIZE - 0.5, GRID_SIZE);
    ctx.moveTo(0, GRID_SIZE - 0.5);
    ctx.lineTo(GRID_SIZE, GRID_SIZE - 0.5);
    ctx.stroke();

    canvas.setBackgroundColor(
      new window.fabric.Pattern({ source: gridCanvas, repeat: 'repeat' }),
      canvas.renderAll.bind(canvas)
    );
  }

  function drawSafetyGuides(canvas, canvasConfig) {
    if (!window.fabric || !canvas) return;
    var safe = clamp(canvasConfig.safeMargin, 0, Math.min(canvas.getWidth(), canvas.getHeight()) / 2, 10);
    var bleed = clamp(canvasConfig.bleed, 0, Math.min(canvas.getWidth(), canvas.getHeight()) / 2, 5);

    var bleedRect = new window.fabric.Rect({
      left: bleed,
      top: bleed,
      width: Math.max(1, canvas.getWidth() - (bleed * 2)),
      height: Math.max(1, canvas.getHeight() - (bleed * 2)),
      fill: 'transparent',
      stroke: '#dc2626',
      strokeWidth: 1,
      strokeDashArray: [5, 4],
      selectable: false,
      evented: false,
    });
    bleedRect.__guide = true;

    var safeRect = new window.fabric.Rect({
      left: safe,
      top: safe,
      width: Math.max(1, canvas.getWidth() - (safe * 2)),
      height: Math.max(1, canvas.getHeight() - (safe * 2)),
      fill: 'transparent',
      stroke: '#16a34a',
      strokeWidth: 1,
      strokeDashArray: [4, 4],
      selectable: false,
      evented: false,
    });
    safeRect.__guide = true;

    canvas.add(bleedRect);
    canvas.add(safeRect);
    bleedRect.bringToFront();
    safeRect.bringToFront();
  }

  function applyObjectLockState(obj, item) {
    if (!obj) return;
    var locked = !!(item && item.locked);
    obj.set({
      lockMovementX: locked,
      lockMovementY: locked,
      lockScalingX: locked,
      lockScalingY: locked,
      hasControls: !locked,
      selectable: true,
      evented: true,
      hoverCursor: locked ? 'not-allowed' : 'move',
      moveCursor: locked ? 'not-allowed' : 'move',
    });
    obj.__locked = locked;
  }

  function previewTextForElement(item) {
    var field = String(item.field || '').trim();
    var label = String(item.label || field).trim();
    var value = state.previewMode === 'real' ? getSampleFieldValue(field) : '{{' + field + '}}';
    if (item.showLabel === false) return value;
    return label + ': ' + value;
  }

  function resolveImageSourceForElement(item) {
    if (!item) return '';
    if (item.type === 'background') {
      return normalizeImageUrl(item.src || '');
    }
    if (state.previewMode !== 'real') return '';
    var raw = getSampleFieldValue(item.field);
    if (!isLikelyImageValue(raw)) return '';
    return normalizeImageUrl(raw);
  }

  function replaceObjectWithImage(item, placeholderObj, imageUrl) {
    if (!window.fabric || !state.fabricCanvas || !placeholderObj || !imageUrl) return;
    try {
      window.fabric.Image.fromURL(imageUrl, function (img) {
        if (!img || !state.fabricCanvas) return;

        img.set({
          left: Number(item.x || 0),
          top: Number(item.y || 0),
          originX: 'left',
          originY: 'top',
          transparentCorners: false,
          cornerColor: '#2563eb',
          borderColor: '#2563eb',
        });

        var targetW = Math.max(10, Number(item.width || 60));
        var targetH = Math.max(10, Number(item.height || 70));
        var baseW = Math.max(1, Number(img.width || targetW));
        var baseH = Math.max(1, Number(img.height || targetH));
        img.set({
          scaleX: targetW / baseW,
          scaleY: targetH / baseH,
        });

        img.__elementId = String(item.id);
        img.__elementType = String(item.type || 'image');
        applyObjectLockState(img, item);

        state.fabricCanvas.remove(placeholderObj);
        state.fabricCanvas.add(img);
        state.fabricObjectsById[String(item.id)] = img;

        if (item.type === 'background') img.sendToBack();
        syncElementFromCanvasObject(img);

        var activeId = String(state.selectedElementId || '');
        if (activeId && activeId === String(item.id)) {
          state.fabricCanvas.setActiveObject(img);
        }
        state.fabricCanvas.requestRenderAll();
      }, { crossOrigin: 'anonymous' });
    } catch (_err) {
      // Keep placeholder if image cannot be loaded.
    }
  }

  function createFabricObjectFromElement(item) {
    if (!window.fabric) return null;

    if (item.type === 'background') {
      var bgPlaceholder = new window.fabric.Rect({
        left: 0,
        top: 0,
        width: Number(item.width || 60),
        height: Number(item.height || 70),
        fill: '#e2e8f0',
        stroke: '#94a3b8',
        strokeWidth: 1,
      });
      bgPlaceholder.__elementId = String(item.id);
      bgPlaceholder.__elementType = 'background';
      applyObjectLockState(bgPlaceholder, item);
      var bgUrl = resolveImageSourceForElement(item);
      if (bgUrl) replaceObjectWithImage(item, bgPlaceholder, bgUrl);
      return bgPlaceholder;
    }

    if (item.type === 'image') {
      var rect = new window.fabric.Rect({
        left: 0,
        top: 0,
        width: Number(item.width || 60),
        height: Number(item.height || 70),
        fill: '#e2e8f0',
        stroke: '#64748b',
        strokeWidth: 1,
        rx: 4,
        ry: 4,
      });
      var label = new window.fabric.Text('Image: ' + String(item.field || ''), {
        left: Number(item.width || 60) / 2,
        top: Number(item.height || 70) / 2,
        originX: 'center',
        originY: 'center',
        fontSize: 12,
        fill: '#334155',
        selectable: false,
        evented: false,
      });
      var group = new window.fabric.Group([rect, label], {
        left: Number(item.x || 0),
        top: Number(item.y || 0),
        originX: 'left',
        originY: 'top',
        transparentCorners: false,
        cornerColor: '#2563eb',
        borderColor: '#2563eb',
      });
      group.__elementId = String(item.id);
      group.__elementType = 'image';
      applyObjectLockState(group, item);

      var imageUrl = resolveImageSourceForElement(item);
      if (imageUrl) replaceObjectWithImage(item, group, imageUrl);
      return group;
    }

    var textbox = new window.fabric.Textbox(previewTextForElement(item), {
      left: Number(item.x || 0),
      top: Number(item.y || 0),
      width: Number(item.width || 120),
      fontSize: Number(item.fontSize || 12),
      fill: String(item.color || '#111111'),
      textAlign: String(item.align || 'left'),
      originX: 'left',
      originY: 'top',
      transparentCorners: false,
      cornerColor: '#2563eb',
      borderColor: '#2563eb',
      editable: false,
    });

    var targetHeight = Number(item.height || 24);
    var currentHeight = Math.max(1, Number(textbox.getScaledHeight()));
    if (targetHeight > 0) {
      textbox.scaleY = targetHeight / currentHeight;
    }

    textbox.__elementId = String(item.id);
    textbox.__elementType = 'text';
    applyObjectLockState(textbox, item);
    return textbox;
  }

  function clampObjectInsideCanvas(obj) {
    var canvas = state.fabricCanvas;
    if (!canvas || !obj) return;

    var maxLeft = Math.max(0, canvas.getWidth() - obj.getScaledWidth());
    var maxTop = Math.max(0, canvas.getHeight() - obj.getScaledHeight());

    obj.set({
      left: clamp(obj.left, 0, maxLeft, 0),
      top: clamp(obj.top, 0, maxTop, 0),
    });
  }

  function snapObjectPosition(obj) {
    if (!obj) return;
    obj.set({
      left: snap(obj.left || 0),
      top: snap(obj.top || 0),
    });
  }

  function syncElementFromCanvasObject(obj) {
    if (!obj) return;
    if (obj.__guide) return;
    var elementId = String(obj.__elementId || '');
    if (!elementId) return;
    var el = getElementById(elementId);
    if (!el) return;

    clampObjectInsideCanvas(obj);

    var width = Math.max(10, snap(obj.getScaledWidth()));
    var height = Math.max(10, snap(obj.getScaledHeight()));

    if (obj.__elementType === 'text') {
      obj.set({
        left: snap(obj.left || 0),
        top: snap(obj.top || 0),
      });
      if (obj.scaleX !== 1) {
        obj.set({ width: width, scaleX: 1 });
      }
      if (obj.scaleY !== 1) {
        obj.set({ scaleY: 1 });
      }
      el.fontSize = clamp(obj.fontSize, 6, 72, el.fontSize || 12);
      el.align = String(obj.textAlign || 'left');
      el.color = String(obj.fill || '#111111');
      width = Math.max(10, snap(obj.getScaledWidth()));
      height = Math.max(10, snap(obj.getScaledHeight()));
    }

    if (obj.__elementType === 'image' || obj.__elementType === 'background') {
      var baseW = Math.max(1, Number(obj.width || width));
      var baseH = Math.max(1, Number(obj.height || height));
      obj.set({
        left: snap(obj.left || 0),
        top: snap(obj.top || 0),
        scaleX: width / baseW,
        scaleY: height / baseH,
      });
    }

    clampObjectInsideCanvas(obj);

    el.x = round2(snap(obj.left || 0));
    el.y = round2(snap(obj.top || 0));
    el.width = round2(width);
    el.height = round2(height);
    el.locked = !!obj.__locked;

    if (obj.__elementType === 'text') {
      el.fontSize = round2(clamp(obj.fontSize, 6, 72, el.fontSize || 12));
      el.align = String(obj.textAlign || 'left');
      el.color = String(obj.fill || '#111111');
    }

    if (obj.__elementType === 'background') {
      el.x = 0;
      el.y = 0;
    }

    state.fabricCanvas.requestRenderAll();
    syncSelectedElementControls();
  }

  function addElementToCanvas(item) {
    var canvas = state.fabricCanvas;
    if (!canvas || !item) return;
    var obj = createFabricObjectFromElement(item);
    if (!obj) return;
    state.fabricObjectsById[String(item.id)] = obj;
    canvas.add(obj);
  }

  function renderCanvasForCurrentSide() {
    var canvas = state.fabricCanvas;
    if (!canvas) return;
    var tpl = currentTemplate();
    if (!tpl) return;

    var sideElements = elementsForSide(state.selectedSide);
    state.fabricObjectsById = {};
    canvas.clear();
    applyGridBackground(canvas);

    sideElements.forEach(function (item) {
      addElementToCanvas(item);
    });

    Object.keys(state.fabricObjectsById).forEach(function (id) {
      var obj = state.fabricObjectsById[id];
      var el = getElementById(id);
      if (obj && el && el.type === 'background') obj.sendToBack();
    });

    drawSafetyGuides(canvas, tpl.template_json.canvas || {});

    if (state.selectedElementId && state.fabricObjectsById[state.selectedElementId]) {
      canvas.setActiveObject(state.fabricObjectsById[state.selectedElementId]);
    }
    canvas.requestRenderAll();
    refreshElementRowSelection();
    syncSelectedElementControls();
  }

  function initFabricCanvas() {
    if (state.flow !== 'edit') return;
    if (!window.fabric) {
      showToast('Fabric.js not loaded. Visual editor is unavailable.', 'error');
      return;
    }

    var tpl = currentTemplate();
    if (!tpl) return;
    tpl.template_json = ensureTemplateJson(tpl.template_json);

    destroyFabricCanvas();

    var canvasEl = document.getElementById('templateCanvas');
    if (!canvasEl) return;

    var canvasW = Number(tpl.template_json.canvas.width || 350);
    var canvasH = Number(tpl.template_json.canvas.height || 200);

    state.fabricCanvas = new window.fabric.Canvas(canvasEl, {
      width: canvasW,
      height: canvasH,
      preserveObjectStacking: true,
      selection: true,
    });

    state.fabricCanvas.on('object:moving', function (ev) {
      var obj = ev && ev.target;
      if (!obj || obj.__guide || obj.__locked) return;
      snapObjectPosition(obj);
      clampObjectInsideCanvas(obj);
    });

    state.fabricCanvas.on('object:scaling', function (ev) {
      var obj = ev && ev.target;
      if (!obj || obj.__guide || obj.__locked) return;
      clampObjectInsideCanvas(obj);
    });

    state.fabricCanvas.on('object:modified', function (ev) {
      var obj = ev && ev.target;
      if (!obj || obj.__guide) return;
      syncElementFromCanvasObject(obj);
      refreshElementRowSelection();
    });

    state.fabricCanvas.on('selection:created', function (ev) {
      var obj = ev && ev.selected && ev.selected[0];
      if (!obj || obj.__guide) return;
      state.selectedElementId = String(obj.__elementId || '');
      refreshElementRowSelection();
      syncSelectedElementControls();
    });

    state.fabricCanvas.on('selection:updated', function (ev) {
      var obj = ev && ev.selected && ev.selected[0];
      if (!obj || obj.__guide) return;
      state.selectedElementId = String(obj.__elementId || '');
      refreshElementRowSelection();
      syncSelectedElementControls();
    });

    state.fabricCanvas.on('selection:cleared', function () {
      state.selectedElementId = null;
      refreshElementRowSelection();
      syncSelectedElementControls();
    });

    renderCanvasForCurrentSide();
  }

  function refreshElementRowSelection() {
    if (!workflowRoot) return;
    var rows = workflowRoot.querySelectorAll('[data-element-row]');
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var id = String(row.getAttribute('data-element-row') || '');
      row.classList.toggle('is-selected', id && id === String(state.selectedElementId || ''));
    }
  }

  function setSelectionControlsDisabled(disabled) {
    var ids = [
      'gcElementField',
      'gcElementLabel',
      'gcElementX',
      'gcElementY',
      'gcElementWidth',
      'gcElementHeight',
      'gcElementFontSize',
      'gcElementAlign',
      'gcElementColor',
      'gcElementLocked',
    ];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = !!disabled;
    });
    var msg = document.getElementById('gcNoSelectionMsg');
    if (msg) msg.classList.toggle('hidden', !disabled);
  }

  function syncSelectedElementControls() {
    var item = selectedElement();
    if (!item) {
      setSelectionControlsDisabled(true);
      return;
    }

    setSelectionControlsDisabled(false);

    var elField = document.getElementById('gcElementField');
    var elLabel = document.getElementById('gcElementLabel');
    var elX = document.getElementById('gcElementX');
    var elY = document.getElementById('gcElementY');
    var elW = document.getElementById('gcElementWidth');
    var elH = document.getElementById('gcElementHeight');
    var elFont = document.getElementById('gcElementFontSize');
    var elAlign = document.getElementById('gcElementAlign');
    var elColor = document.getElementById('gcElementColor');
    var elLocked = document.getElementById('gcElementLocked');
    var isBackground = item.type === 'background';

    if (elField) elField.value = String(item.field || '');
    if (elLabel) elLabel.value = String(item.label || '');
    if (elX) elX.value = String(round2(item.x || 0));
    if (elY) elY.value = String(round2(item.y || 0));
    if (elW) elW.value = String(round2(item.width || 20));
    if (elH) elH.value = String(round2(item.height || 20));
    if (elFont) elFont.value = String(round2(item.fontSize || 12));
    if (elAlign) elAlign.value = String(item.align || 'left');
    if (elColor) elColor.value = String(item.color || '#111111');
    if (elLocked) elLocked.checked = !!item.locked;

    if (isBackground) {
      if (elField) elField.disabled = true;
      if (elFont) elFont.disabled = true;
      if (elAlign) elAlign.disabled = true;
      if (elColor) elColor.disabled = true;
    }
  }

  function syncTemplateElementsFromCanvas() {
    if (!state.fabricCanvas || state.flow !== 'edit') return;
    var canvas = state.fabricCanvas;
    var objects = canvas.getObjects();
    for (var i = 0; i < objects.length; i += 1) {
      syncElementFromCanvasObject(objects[i]);
    }
  }

  function updateFabricObjectFromElement(item) {
    if (!item || !state.fabricCanvas) return;
    var obj = state.fabricObjectsById[String(item.id)];
    if (!obj) return;

    if (obj.__elementType === 'text') {
      obj.set({
        left: Number(item.x || 0),
        top: Number(item.y || 0),
        width: Math.max(10, Number(item.width || 120)),
        fontSize: Math.max(6, Number(item.fontSize || 12)),
        fill: String(item.color || '#111111'),
        textAlign: String(item.align || 'left'),
        text: previewTextForElement(item),
      });

      var currentHeight = Math.max(1, Number(obj.getScaledHeight()));
      var targetHeight = Math.max(10, Number(item.height || currentHeight));
      obj.set({ scaleY: targetHeight / currentHeight });
      applyObjectLockState(obj, item);
    } else {
      obj.set({
        left: Number(item.x || 0),
        top: Number(item.y || 0),
      });
      var baseW = Math.max(1, Number(obj.width || 1));
      var baseH = Math.max(1, Number(obj.height || 1));
      obj.set({
        scaleX: Math.max(10, Number(item.width || baseW)) / baseW,
        scaleY: Math.max(10, Number(item.height || baseH)) / baseH,
      });
      if (obj.__elementType === 'image' && typeof obj.item === 'function') {
        var textObj = obj.item(1);
        if (textObj) textObj.set('text', 'Image: ' + String(item.field || ''));
        var imageUrl = resolveImageSourceForElement(item);
        if (imageUrl) replaceObjectWithImage(item, obj, imageUrl);
      }
      if (obj.__elementType === 'background') {
        obj.set({ left: 0, top: 0 });
        var bgUrl = resolveImageSourceForElement(item);
        if (bgUrl) replaceObjectWithImage(item, obj, bgUrl);
      }
      applyObjectLockState(obj, item);
    }

    syncElementFromCanvasObject(obj);
    if (state.fabricCanvas) state.fabricCanvas.requestRenderAll();
  }

  function renderTemplateEditor() {
    render();
    initFabricCanvas();
  }

  function render() {
    if (!workflowRoot) return;

    if (state.flow !== 'edit') {
      destroyFabricCanvas();
    }

    var html = state.flow === 'edit' ? renderTemplateEditorScreen() : renderTemplateSelectionScreen();
    workflowRoot.innerHTML = html;

    if (state.flow === 'edit') {
      initFabricCanvas();
    }

    if (state.loading) {
      setLoading(true, state.loadingMessage || 'Working...');
    }

    var footerDownload = document.getElementById('gcDownloadPdfBtn');
    if (footerDownload) footerDownload.disabled = !state.lastPdfBlob;
  }

  function updateSelectedElement(key, rawValue) {
    var item = selectedElement();
    if (!item) return;

    if (key === 'locked') {
      item.locked = !!rawValue;
      updateFabricObjectFromElement(item);
      syncSelectedElementControls();
      return;
    }

    if (key === 'field' || key === 'label' || key === 'align' || key === 'color') {
      item[key] = String(rawValue || '').trim();
      if (key === 'align' && ['left', 'center', 'right'].indexOf(item.align) < 0) item.align = 'left';
      if (key === 'color' && !/^#?[0-9a-fA-F]{6}$/.test(item.color)) item.color = '#111111';
      if (key === 'color' && item.color[0] !== '#') item.color = '#' + item.color;
      updateFabricObjectFromElement(item);
      syncSelectedElementControls();
      return;
    }

    var num = Number(rawValue);
    if (!Number.isFinite(num)) return;

    if (key === 'x' || key === 'y') {
      item[key] = Math.max(0, snap(num));
    } else if (key === 'width' || key === 'height') {
      item[key] = Math.max(10, snap(num));
    } else if (key === 'fontSize') {
      item[key] = Math.max(6, Math.min(72, Math.round(num)));
    }

    updateFabricObjectFromElement(item);
    syncSelectedElementControls();
  }

  function addFieldAsElement(fieldName) {
    var tpl = currentTemplate();
    if (!tpl) return;
    var field = String(fieldName || '').trim();
    if (!field) {
      showToast('Select a field first', 'warning');
      return;
    }

    var side = state.selectedSide === 'back' ? 'back' : 'front';
    var sideCount = elementsForSide(side).length;
    var fieldMeta = byFieldName(field);
    var isImage = imageLikeField(fieldMeta, field);
    var el = {
      id: 'el_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      type: isImage ? 'image' : 'text',
      label: field,
      field: field,
      x: snap(20 + ((sideCount % 6) * 20)),
      y: snap(20 + ((sideCount % 8) * 16)),
      width: isImage ? 70 : 120,
      height: isImage ? 70 : 24,
      fontSize: 12,
      align: 'left',
      color: '#111111',
      side: side,
      showLabel: true,
      locked: false,
    };

    tpl.template_json.elements.push(el);
    state.selectedElementId = el.id;
    renderTemplateEditor();
  }

  function findBackgroundForSide(side) {
    var tpl = currentTemplate();
    if (!tpl) return null;
    var wanted = side === 'back' ? 'back' : 'front';
    var elems = tpl.template_json.elements;
    for (var i = 0; i < elems.length; i += 1) {
      var item = elems[i];
      if (!item || item.type !== 'background') continue;
      var itemSide = String(item.side || 'front');
      if (itemSide === wanted || itemSide === 'both') return item;
    }
    return null;
  }

  function setBackgroundForCurrentSide(src) {
    var tpl = currentTemplate();
    if (!tpl) return;
    var cleanSrc = normalizeImageUrl(src);
    if (!cleanSrc) {
      showToast('Invalid background image source', 'warning');
      return;
    }

    var side = state.selectedSide === 'back' ? 'back' : 'front';
    var canvas = tpl.template_json.canvas || {};
    var existing = findBackgroundForSide(side);
    if (existing) {
      existing.src = cleanSrc;
      existing.width = Number(canvas.width || existing.width || 350);
      existing.height = Number(canvas.height || existing.height || 200);
      existing.locked = true;
    } else {
      tpl.template_json.elements.unshift({
        id: 'bg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
        type: 'background',
        label: 'Background',
        field: '',
        src: cleanSrc,
        x: 0,
        y: 0,
        width: Number(canvas.width || 350),
        height: Number(canvas.height || 200),
        fontSize: 12,
        align: 'left',
        color: '#111111',
        side: side,
        showLabel: false,
        locked: true,
      });
    }

    renderTemplateEditor();
  }

  function removeBackgroundForCurrentSide() {
    var tpl = currentTemplate();
    if (!tpl) return;
    var side = state.selectedSide === 'back' ? 'back' : 'front';
    var before = tpl.template_json.elements.length;
    tpl.template_json.elements = tpl.template_json.elements.filter(function (item) {
      if (!item || item.type !== 'background') return true;
      var itemSide = String(item.side || 'front');
      return !(itemSide === side || itemSide === 'both');
    });
    if (tpl.template_json.elements.length < before) {
      if (selectedElement() && selectedElement().type === 'background') state.selectedElementId = null;
      renderTemplateEditor();
    }
  }

  function currentLayoutPayload() {
    var tpl = currentTemplate();
    if (!tpl) return null;
    var canvas = ensureTemplateJson(tpl.template_json).canvas;
    var layout = canvas.printLayout || {};
    return {
      mode: String(layout.mode || '1'),
      columns: Number(layout.columns || 1),
      rows: Number(layout.rows || 1),
      marginMM: Number(layout.marginMM || 8),
      gapXMM: Number(layout.gapXMM || 4),
      gapYMM: Number(layout.gapYMM || 4),
      pageSize: String(layout.pageSize || 'a4'),
    };
  }

  async function saveTemplate() {
    return runWithLoading('Saving template...', async function () {
      var tpl = currentTemplate();
      if (!tpl) throw new Error('No template loaded');

      syncTemplateElementsFromCanvas();
      tpl.template_json = ensureTemplateJson(tpl.template_json);

      var payload = {
        name: String(tpl.name || 'Template').trim(),
        is_two_sided: !!tpl.is_two_sided,
        card_orientation: normalizeOrientation(tpl.card_orientation),
        template_json: tpl.template_json,
        font_size: Number(tpl.font_size || 11),
        font_family: String(tpl.font_family || 'Arial'),
        docx_font_color_hex: String((tpl.docx_style && tpl.docx_style.font_color_hex) || '#111111'),
        docx_text_align: String((tpl.docx_style && (tpl.docx_style.text_align || tpl.docx_style.align)) || 'left'),
        template_id: tpl.id || null,
      };

      var data;
      if (tpl.id) {
        data = await requestJson('PUT', templateApiPath(tpl.id), payload);
      } else {
        data = await requestJson('POST', templateApiPath(TABLE_ID), payload);
      }

      state.template = normalizeTemplate(data.template || {});
      state.activeTemplateId = state.template.id;
      await loadTemplates();
      showToast('Template saved', 'success');
      renderTemplateEditor();
    });
  }

  function selectedRequestIds() {
    if (state.selectedRequestIds.size > 0) {
      return Array.from(state.selectedRequestIds);
    }
    return state.cards.map(function (item) { return Number(item.pr_id); }).filter(Boolean);
  }

  function downloadBlob(blob, filename) {
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 3000);
  }

  async function runGenerate(previewOnly) {
    var ids = selectedRequestIds();
    if (!ids.length) {
      showToast('No generate-list cards available', 'error');
      return;
    }

    if (!hasRenderableElements()) {
      showToast('Add at least one element before generating', 'warning');
      return;
    }

    try {
      await runWithLoading(previewOnly ? 'Generating preview...' : 'Generating cards...', async function () {
        if (!state.template || !state.template.id) {
          await saveTemplate();
        }

        var body = {
          request_ids: previewOnly ? [ids[0]] : ids,
          preview_only: !!previewOnly,
          template_id: state.template.id,
          layout: currentLayoutPayload(),
        };

        var result = await requestPdf(generateApiPath('/generate/'), body);
        state.lastPdfBlob = result.blob;
        state.lastPdfName = result.filename || (previewOnly ? 'preview_card.pdf' : 'cards.pdf');

        var footerDownload = document.getElementById('gcDownloadPdfBtn');
        if (footerDownload) footerDownload.disabled = false;

        if (previewOnly) {
          var previewUrl = URL.createObjectURL(state.lastPdfBlob);
          window.open(previewUrl, '_blank');
          setTimeout(function () { URL.revokeObjectURL(previewUrl); }, 30000);
          showToast('Cards generated', 'success');
        } else {
          downloadBlob(state.lastPdfBlob, state.lastPdfName || 'cards.pdf');
          showToast('Cards generated', 'success');
          await loadCards();
        }

        render();
      });
    } catch (err) {
      showToast(err && err.message ? err.message : 'Generation failed', 'error');
    }
  }

  function ensureWorkflowStyles() {
    if (document.getElementById('gcTemplateWorkflowStyles')) return;
    var style = document.createElement('style');
    style.id = 'gcTemplateWorkflowStyles';
    style.textContent = ''
      + '.gc-template-workflow{position:relative;display:block;height:100%;overflow:auto;padding:16px;background:#f1f5f9;}'
      + '.gc-screen{background:#fff;border:1px solid #dbe2ea;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(15,23,42,.04);}'
      + '.gc-screen-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;}'
      + '.gc-screen-header h3{margin:0;font-size:16px;font-weight:700;color:#0f172a;}'
      + '.gc-template-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;}'
      + '.gc-template-card{border:1px solid #dbeafe;border-radius:12px;padding:12px;background:#f8fbff;display:flex;flex-direction:column;gap:8px;}'
      + '.gc-template-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}'
      + '.gc-template-card-title{font-size:14px;font-weight:700;color:#1e293b;}'
      + '.gc-template-meta{font-size:12px;color:#64748b;}'
      + '.gc-template-actions{display:flex;gap:8px;flex-wrap:wrap;}'
      + '.gc-empty{font-size:13px;color:#64748b;padding:12px;border:1px dashed #cbd5e1;border-radius:10px;background:#f8fafc;}'
      + '.gc-empty-large{display:flex;flex-direction:column;align-items:flex-start;gap:10px;}'
      + '.gc-empty-title{font-size:15px;font-weight:700;color:#0f172a;}'
      + '.gc-empty-subtitle{font-size:13px;color:#64748b;}'
      + '.gc-screen-editor{display:flex;flex-direction:column;gap:12px;min-height:560px;}'
      + '.gc-top-bar{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;padding:12px;border:1px solid #dbe2ea;border-radius:10px;background:#f8fafc;}'
      + '.gc-top-left{display:flex;flex-direction:column;gap:6px;min-width:260px;flex:1;}'
      + '.gc-label{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.03em;}'
      + '.gc-top-name{height:36px;border:1px solid #cbd5e1;border-radius:8px;padding:0 12px;font-size:14px;color:#0f172a;background:#fff;}'
      + '.gc-top-actions{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;justify-content:flex-end;}'
      + '.gc-top-field{display:flex;flex-direction:column;gap:4px;}'
      + '.gc-top-field select{height:34px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;background:#fff;min-width:110px;}'
      + '.gc-main-grid{display:grid;grid-template-columns:minmax(250px,24%) minmax(420px,52%) minmax(250px,24%);gap:12px;align-items:stretch;}'
      + '.gc-left-sidebar,.gc-center-canvas,.gc-right-sidebar{display:flex;flex-direction:column;gap:12px;min-width:0;}'
      + '.gc-panel-card{border:1px solid #dbe2ea;border-radius:10px;padding:12px;background:#fff;display:flex;flex-direction:column;gap:10px;}'
      + '.gc-panel-card-fill{height:100%;}'
      + '.gc-block-title{font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.04em;}'
      + '.gc-form-grid{display:grid;grid-template-columns:108px 1fr;gap:8px;align-items:center;}'
      + '.gc-form-grid label{font-size:12px;font-weight:600;color:#334155;}'
      + '.gc-form-grid input,.gc-form-grid select,.gc-add-field-row select{height:34px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font-size:13px;background:#fff;color:#0f172a;}'
      + '.gc-side-row{display:flex;gap:6px;}'
      + '.gc-add-field-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}'
      + '.gc-add-field-row input[type=file]{font-size:12px;max-width:210px;}'
      + '.gc-template-compact-list{display:flex;flex-direction:column;gap:8px;max-height:250px;overflow:auto;padding-right:2px;}'
      + '.gc-template-row{border:1px solid #dbe2ea;border-radius:10px;padding:8px;background:#f8fafc;display:flex;flex-direction:column;gap:6px;}'
      + '.gc-template-row.is-active{border-color:#3b82f6;background:#eff6ff;}'
      + '.gc-template-row-head{display:flex;justify-content:space-between;align-items:flex-start;gap:6px;}'
      + '.gc-template-link{border:none;background:transparent;padding:0;text-align:left;font-size:13px;font-weight:700;color:#1e293b;cursor:pointer;max-width:180px;}'
      + '.gc-template-badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}'
      + '.gc-badge{font-size:10px;font-weight:700;border-radius:999px;padding:2px 6px;border:1px solid transparent;line-height:1.2;}'
      + '.gc-badge-default{color:#92400e;background:#fef3c7;border-color:#fde68a;}'
      + '.gc-badge-active{color:#166534;background:#dcfce7;border-color:#86efac;}'
      + '.gc-template-row-meta{font-size:11px;color:#64748b;}'
      + '.gc-template-row-actions{display:flex;gap:6px;flex-wrap:wrap;}'
      + '.gc-element-list{display:flex;flex-direction:column;gap:6px;max-height:190px;overflow:auto;padding-right:3px;}'
      + '.gc-element-row{display:flex;align-items:center;gap:6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:6px;}'
      + '.gc-element-row.is-selected{border-color:#2563eb;background:#dbeafe;box-shadow:inset 0 0 0 1px rgba(37,99,235,.12);}'
      + '.gc-element-select{flex:1;text-align:left;background:transparent;border:none;font-size:12px;font-weight:600;color:#1e293b;cursor:pointer;}'
      + '.gc-element-meta{font-size:11px;color:#64748b;}'
      + '.gc-element-editor{border:1px solid #e2e8f0;border-radius:8px;padding:10px;background:#f8fafc;min-height:220px;}'
      + '.gc-element-edit-wrap{display:flex;flex-direction:column;gap:8px;}'
      + '.gc-editor-actions{display:flex;flex-wrap:wrap;gap:8px;}'
      + '.gc-meta-row{font-size:12px;color:#64748b;}'
      + '.gc-canvas-wrap{border:1px solid #d1d9e2;border-radius:10px;background:#fff;overflow:auto;padding:10px;min-height:420px;display:flex;align-items:flex-start;justify-content:center;}'
      + '.gc-canvas-shell{position:relative;border:1px dashed #cbd5e1;border-radius:8px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.08);}'
      + '#templateCanvas{display:block;}'
      + '.gc-bottom-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px;border:1px solid #dbe2ea;border-radius:10px;background:#f8fafc;}'
      + '.gc-bottom-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;}'
      + '.gc-workflow-loading{position:absolute;inset:0;background:rgba(241,245,249,.65);backdrop-filter:blur(1px);display:flex;align-items:center;justify-content:center;z-index:40;}'
      + '.gc-workflow-loading-box{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #dbe2ea;border-radius:10px;background:#fff;box-shadow:0 6px 24px rgba(15,23,42,.1);font-size:13px;font-weight:600;color:#334155;}'
      + '.gc-spinner{width:16px;height:16px;border:2px solid #cbd5e1;border-top-color:#2563eb;border-radius:50%;animation:gcSpin .8s linear infinite;}'
      + '.hidden{display:none!important;}'
      + '@keyframes gcSpin{to{transform:rotate(360deg);}}'
      + '@media (max-width:1280px){.gc-main-grid{grid-template-columns:minmax(240px,28%) minmax(380px,44%) minmax(240px,28%);}}'
      + '@media (max-width:1100px){.gc-top-bar{flex-direction:column;align-items:stretch;}.gc-top-actions{justify-content:flex-start;}.gc-main-grid{grid-template-columns:1fr;}.gc-canvas-wrap{min-height:320px;}.gc-bottom-bar{flex-direction:column;align-items:flex-start;}}';
    document.head.appendChild(style);
  }

  function ensureWorkflowRoot() {
    workflowRoot = document.getElementById('gcTemplateWorkflow');
    if (workflowRoot) return;

    workflowRoot = document.createElement('div');
    workflowRoot.id = 'gcTemplateWorkflow';
    workflowRoot.className = 'gc-template-workflow';

    if (isModalMode) {
      var body = modalEl.querySelector('.gc-editor-body');
      if (body) body.prepend(workflowRoot);
    } else {
      var wrap = document.querySelector('.gen-editor-wrap') || document.querySelector('.main-content') || document.body;
      wrap.prepend(workflowRoot);
    }
  }

  function hideLegacyLayout() {
    var layout = document.querySelector('.gen-layout');
    if (layout) layout.classList.add('hidden');
  }

  function selectCanvasObjectByElementId(elementId) {
    if (!state.fabricCanvas) return;
    var obj = state.fabricObjectsById[String(elementId || '')];
    if (!obj) return;
    state.fabricCanvas.setActiveObject(obj);
    state.fabricCanvas.requestRenderAll();
  }

  function bindWorkflowEvents() {
    if (!workflowRoot || workflowRoot.__gcBound) return;
    workflowRoot.__gcBound = true;

    workflowRoot.addEventListener('click', function (ev) {
      var target = ev.target.closest('[data-action]');
      if (!target) return;

      var action = String(target.getAttribute('data-action') || '');
      var templateId = Number(target.getAttribute('data-template-id') || 0);
      var elementId = String(target.getAttribute('data-element-id') || '');
      var side = String(target.getAttribute('data-side') || '');

      if (action === 'create-template') {
        newTemplateDraft();
        setFlow('edit');
        return;
      }
      if (action === 'back-to-select') {
        syncTemplateElementsFromCanvas();
        setFlow('select');
        return;
      }
      if (action === 'edit-template' || action === 'use-template') {
        if (!templateId) return;
        runWithLoading('Loading template...', async function () {
          await loadTemplateDetail(templateId);
          setFlow('edit');
        }).catch(function (err) {
          showToast(err && err.message ? err.message : 'Failed to load template', 'error');
        });
        return;
      }
      if (action === 'duplicate-template') {
        var duplicateId = templateId || Number(state.activeTemplateId || (state.template && state.template.id) || 0);
        if (!duplicateId) {
          showToast('Select a template to duplicate', 'warning');
          return;
        }
        runWithLoading('Duplicating template...', async function () {
          var res = await requestJson('POST', templateDuplicateApiPath(duplicateId), { activate: true });
          if (res && res.template) {
            state.template = normalizeTemplate(res.template);
            state.activeTemplateId = state.template.id;
          }
          await loadTemplates();
          setFlow('edit');
          showToast('Template duplicated', 'success');
        }).catch(function (err) {
          showToast(err && err.message ? err.message : 'Failed to duplicate template', 'error');
        });
        return;
      }
      if (action === 'set-default-template') {
        var defaultId = templateId || Number(state.activeTemplateId || (state.template && state.template.id) || 0);
        if (!defaultId) {
          showToast('Select a template first', 'warning');
          return;
        }
        runWithLoading('Setting default template...', async function () {
          await requestJson('POST', templateSetDefaultApiPath(defaultId), {});
          await loadTemplates();
          if (state.template && state.template.id) {
            await loadTemplateDetail(state.template.id);
          }
          render();
          showToast('Default template updated', 'success');
        }).catch(function (err) {
          showToast(err && err.message ? err.message : 'Failed to set default template', 'error');
        });
        return;
      }
      if (action === 'set-side') {
        if (side === 'front' || side === 'back') {
          syncTemplateElementsFromCanvas();
          state.selectedSide = side;
          state.selectedElementId = null;
          renderTemplateEditor();
        }
        return;
      }
      if (action === 'add-field') {
        var select = document.getElementById('gcAddFieldSelect');
        addFieldAsElement(select ? select.value : '');
        return;
      }
      if (action === 'toggle-preview-mode') {
        state.previewMode = state.previewMode === 'real' ? 'placeholder' : 'real';
        renderTemplateEditor();
        return;
      }
      if (action === 'remove-background') {
        removeBackgroundForCurrentSide();
        return;
      }
      if (action === 'upload-background') {
        var fileInput = document.getElementById('gcBackgroundUpload');
        var file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        if (!file) {
          showToast('Choose a background image first', 'warning');
          return;
        }
        var reader = new FileReader();
        reader.onload = function (ev2) {
          var dataUrl = ev2 && ev2.target ? ev2.target.result : '';
          if (!dataUrl) {
            showToast('Failed to read image file', 'error');
            return;
          }
          setBackgroundForCurrentSide(String(dataUrl));
        };
        reader.onerror = function () {
          showToast('Failed to read image file', 'error');
        };
        reader.readAsDataURL(file);
        return;
      }
      if (action === 'select-element') {
        state.selectedElementId = elementId;
        refreshElementRowSelection();
        syncSelectedElementControls();
        selectCanvasObjectByElementId(elementId);
        return;
      }
      if (action === 'delete-element') {
        var tpl = currentTemplate();
        if (!tpl) return;
        tpl.template_json.elements = tpl.template_json.elements.filter(function (item) {
          return String(item.id) !== elementId;
        });
        if (String(state.selectedElementId || '') === elementId) state.selectedElementId = null;
        renderTemplateEditor();
        return;
      }
      if (action === 'save-template') {
        saveTemplate().catch(function (err) {
          showToast(err && err.message ? err.message : 'Failed to save template', 'error');
        });
        return;
      }
      if (action === 'generate-preview') {
        syncTemplateElementsFromCanvas();
        runGenerate(true);
        return;
      }
      if (action === 'generate-all') {
        syncTemplateElementsFromCanvas();
        runGenerate(false);
        return;
      }
      if (action === 'download-last') {
        if (!state.lastPdfBlob) {
          showToast('No file to download yet', 'warning');
          return;
        }
        downloadBlob(state.lastPdfBlob, state.lastPdfName || 'generated_cards.pdf');
        return;
      }
    });

    if (!state.mountedChangeHandlers) {
      state.mountedChangeHandlers = true;
      workflowRoot.addEventListener('change', function (ev) {
        var tpl = currentTemplate();
        if (!tpl) return;
        var t = ev.target;
        if (!t || !t.id) return;

        if (t.id === 'gcTemplateName') tpl.name = String(t.value || '').slice(0, 120);
        if (t.id === 'gcTemplateSides') {
          syncTemplateElementsFromCanvas();
          tpl.is_two_sided = t.value === 'double';
          if (!tpl.is_two_sided) state.selectedSide = 'front';
          renderTemplateEditor();
          return;
        }
        if (t.id === 'gcTemplateOrientation') tpl.card_orientation = normalizeOrientation(t.value);

        if (t.id === 'gcLayoutMode' || t.id === 'gcLayoutCols' || t.id === 'gcLayoutRows' || t.id === 'gcLayoutMarginMM' || t.id === 'gcLayoutGapXMM' || t.id === 'gcLayoutGapYMM') {
          tpl.template_json = ensureTemplateJson(tpl.template_json);
          var layout = tpl.template_json.canvas.printLayout || {};
          if (t.id === 'gcLayoutMode') {
            layout.mode = String(t.value || '1');
            if (layout.mode === '1') { layout.columns = 1; layout.rows = 1; }
            if (layout.mode === '2') { layout.columns = 2; layout.rows = 1; }
            if (layout.mode === '4') { layout.columns = 2; layout.rows = 2; }
          }
          if (t.id === 'gcLayoutCols') layout.columns = clamp(t.value, 1, 12, 1);
          if (t.id === 'gcLayoutRows') layout.rows = clamp(t.value, 1, 12, 1);
          if (t.id === 'gcLayoutMarginMM') layout.marginMM = clamp(t.value, 0, 40, 8);
          if (t.id === 'gcLayoutGapXMM') layout.gapXMM = clamp(t.value, 0, 40, 4);
          if (t.id === 'gcLayoutGapYMM') layout.gapYMM = clamp(t.value, 0, 40, 4);
          tpl.template_json.canvas.printLayout = layout;
          if (t.id === 'gcLayoutMode') {
            renderTemplateEditor();
            return;
          }
        }

        if (t.id === 'gcCanvasRealWidthMM' || t.id === 'gcCanvasRealHeightMM' || t.id === 'gcCanvasSafeMargin' || t.id === 'gcCanvasBleed') {
          tpl.template_json = ensureTemplateJson(tpl.template_json);
          if (t.id === 'gcCanvasRealWidthMM') tpl.template_json.canvas.realWidthMM = clamp(t.value, 10, 400, 85.6);
          if (t.id === 'gcCanvasRealHeightMM') tpl.template_json.canvas.realHeightMM = clamp(t.value, 10, 400, 54);
          if (t.id === 'gcCanvasSafeMargin') tpl.template_json.canvas.safeMargin = clamp(t.value, 0, 500, 10);
          if (t.id === 'gcCanvasBleed') tpl.template_json.canvas.bleed = clamp(t.value, 0, 500, 5);
          renderCanvasForCurrentSide();
        }

        if (t.id === 'gcElementField') updateSelectedElement('field', t.value);
        if (t.id === 'gcElementLabel') updateSelectedElement('label', t.value);
        if (t.id === 'gcElementX') updateSelectedElement('x', t.value);
        if (t.id === 'gcElementY') updateSelectedElement('y', t.value);
        if (t.id === 'gcElementWidth') updateSelectedElement('width', t.value);
        if (t.id === 'gcElementHeight') updateSelectedElement('height', t.value);
        if (t.id === 'gcElementFontSize') updateSelectedElement('fontSize', t.value);
        if (t.id === 'gcElementAlign') updateSelectedElement('align', t.value);
        if (t.id === 'gcElementColor') updateSelectedElement('color', t.value);
        if (t.id === 'gcElementLocked') updateSelectedElement('locked', t.checked);
      });

      workflowRoot.addEventListener('input', function (ev) {
        var t = ev.target;
        if (!t || !t.id) return;
        if (t.id === 'gcElementLabel') updateSelectedElement('label', t.value);
        if (t.id === 'gcElementFontSize') updateSelectedElement('fontSize', t.value);
        if (t.id === 'gcElementColor') updateSelectedElement('color', t.value);
      });
    }

    var footerDownload = document.getElementById('gcDownloadPdfBtn');
    if (footerDownload && !footerDownload.__gcBound) {
      footerDownload.__gcBound = true;
      footerDownload.addEventListener('click', function () {
        if (!state.lastPdfBlob) return;
        downloadBlob(state.lastPdfBlob, state.lastPdfName || 'generated_cards.pdf');
      });
    }
  }

  async function bootstrap() {
    setLoading(true, 'Loading templates...');
    try {
      await Promise.all([loadCards(), loadTemplates()]);
      if (!state.templates.length) {
        newTemplateDraft();
        state.flow = 'edit';
      } else {
        state.flow = 'select';
      }
      render();
    } catch (err) {
      showToast(err && err.message ? err.message : 'Failed to initialize template workflow', 'error');
    } finally {
      setLoading(false);
    }
  }

  function openModal() {
    if (!isModalMode) return;
    modalEl.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    bootstrap();
  }

  function closeModal() {
    if (!isModalMode) return;
    modalEl.classList.add('hidden');
    document.body.style.overflow = '';
  }

  window.gcEditorRefresh = function () {
    return bootstrap();
  };

  window.gcEditorBeforeClose = function () {
    syncTemplateElementsFromCanvas();
    return Promise.resolve();
  };

  window.gcDownloadLastPdf = function () {
    if (!state.lastPdfBlob) return false;
    downloadBlob(state.lastPdfBlob, state.lastPdfName || 'generated_cards.pdf');
    return true;
  };

  ensureWorkflowStyles();
  ensureWorkflowRoot();
  hideLegacyLayout();
  bindWorkflowEvents();

  if (isModalMode) {
    window.openGcEditorModal = openModal;
  } else {
    bootstrap();
  }
})();
