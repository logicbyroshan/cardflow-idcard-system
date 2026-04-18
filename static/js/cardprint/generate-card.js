(function () {
  'use strict';

  var TABLE_ID = Number(window.TABLE_ID || 0);
  var modalEl = document.getElementById('gcEditorModal');
  var flowRoot = document.getElementById('gcSimpleFlowRoot');
  var stepCounterEl = document.getElementById('gcStepCounter');
  var headerStepperEl = document.getElementById('gcHeaderStepper');
  var headerSaveTemplateBtnEl = document.getElementById('gcHeaderSaveTemplateBtn');

  if (!TABLE_ID || !modalEl || !flowRoot) {
    return;
  }

  var panelBase = window.location.pathname.indexOf('/panel/') === 0 ? '/panel' : '';
  var apiBases = panelBase ? [panelBase + '/print', '/print'] : ['/print', '/panel/print'];

  if (!window.GcEditorState || typeof window.GcEditorState.createInitialEditorState !== 'function'
    || typeof window.GcEditorState.createEditorStateStore !== 'function') {
    return;
  }

  var stateStore = window.GcEditorState.createEditorStateStore(
    window.GcEditorState.createInitialEditorState({
      uiPanels: loadDraftUiPanelsState(),
    })
  );
  var state = stateStore.getState();
  if (!Object.prototype.hasOwnProperty.call(state, 'previewPdfBlob')) {
    state.previewPdfBlob = null;
  }
  if (!Object.prototype.hasOwnProperty.call(state, 'previewPdfName')) {
    state.previewPdfName = 'preview_cards.pdf';
  }
  if (!Object.prototype.hasOwnProperty.call(state, 'previewPdfUrl')) {
    state.previewPdfUrl = '';
  }
  var pdfJsLoadPromise = null;
  var draftElementSeed = 1;
  var draftGuideSeed = 1;
  var PT_TO_PX = 96 / 72;
  var DRAFT_HANDLE_SIZE_MIN_PX = 5;
  var DRAFT_HANDLE_SIZE_MAX_PX = 11;
  var DRAFT_HANDLE_GAP_MIN_PX = 4;
  var DRAFT_HANDLE_GAP_MAX_PX = 6;
  var DRAFT_ROTATE_DRAG_SENSITIVITY = 0.88;
  var DRAFT_ROTATE_MIN_APPLY_DEGREES = 0.08;
  var DRAFT_SKEW_DEGREES_AT_FULL_SPAN = 42;
  var DRAFT_SKEW_SHIFT_SNAP_DEGREES = 3;
  var DRAFT_SKEW_MAX_DEGREES = 75;
  var DRAFT_ZOOM_MIN = 0.1;
  var DRAFT_ZOOM_MAX = 8;
  var DRAFT_ZOOM_IN_FACTOR = 1.1;
  var DRAFT_ZOOM_OUT_FACTOR = 0.9;
  var DRAFT_DEFAULT_FONT_PT = 10;
  var MERGE_TOKEN_REGEX_GLOBAL = /\{\{\s*([^{}]+?)\s*\}\}|<<\s*([^<>]+?)\s*>>|\[\[\s*([^\[\]]+?)\s*\]\]/g;
  var DRAFT_UI_PANELS_STORAGE_KEY = 'gc_step2_ui_panels_v1';
  var draftTextMeasureNode = null;
  var draftRenderRafId = 0;
  var historyService = null;
  var clipboardService = null;
  var stageEventBindings = null;
  var pointerEventBindings = null;
  var keyboardEventBindings = null;
  var draftPointerMoveRafId = 0;
  var draftPointerMoveSnapshot = null;

  function renderStep2OnNextFrame() {
    if (state.step !== 2 || typeof window === 'undefined' || !window.requestAnimationFrame) {
      render();
      return;
    }
    if (draftRenderRafId) {
      return;
    }
    draftRenderRafId = window.requestAnimationFrame(function () {
      draftRenderRafId = 0;
      render();
    });
  }

  function cancelDraftPointerMoveFrame() {
    if (draftPointerMoveRafId && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(draftPointerMoveRafId);
    }
    draftPointerMoveRafId = 0;
  }

  function flushDraftPointerMoveSnapshot() {
    var snapshot = draftPointerMoveSnapshot;
    draftPointerMoveSnapshot = null;
    if (!snapshot) {
      return;
    }
    applyDraftPointerMove(snapshot);
  }

  function queueDraftPointerMove(event) {
    if (!event) {
      return;
    }

    draftPointerMoveSnapshot = {
      clientX: Number(event.clientX || 0),
      clientY: Number(event.clientY || 0),
      shiftKey: !!event.shiftKey,
    };

    if (draftPointerMoveRafId || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      return;
    }

    draftPointerMoveRafId = window.requestAnimationFrame(function () {
      draftPointerMoveRafId = 0;
      flushDraftPointerMoveSnapshot();
    });
  }

  function normalizeDraftUiPanels(value) {
    var raw = value && typeof value === 'object' ? value : {};
    var requestedActive = String(raw.active || '').toLowerCase();
    var active = '';
    if (requestedActive === 'text' || requestedActive === 'align' || requestedActive === 'layers' || requestedActive === 'merge') {
      active = requestedActive;
    }
    if (!active) {
      if (raw.text) {
        active = 'text';
      } else if (raw.align) {
        active = 'align';
      } else if (raw.layers) {
        active = 'layers';
      } else if (raw.merge) {
        active = 'merge';
      }
    }
    return {
      active: active,
      text: active === 'text',
      align: active === 'align',
      layers: active === 'layers',
      merge: active === 'merge',
    };
  }

  function loadDraftUiPanelsState() {
    var fallback = normalizeDraftUiPanels(null);
    try {
      if (!window || !window.localStorage) {
        return fallback;
      }
      var raw = String(window.localStorage.getItem(DRAFT_UI_PANELS_STORAGE_KEY) || '');
      if (!raw) {
        return fallback;
      }
      return normalizeDraftUiPanels(JSON.parse(raw));
    } catch (_err) {
      return fallback;
    }
  }

  function saveDraftUiPanelsState() {
    try {
      if (!window || !window.localStorage) {
        return;
      }
      window.localStorage.setItem(
        DRAFT_UI_PANELS_STORAGE_KEY,
        JSON.stringify(normalizeDraftUiPanels(state.uiPanels))
      );
    } catch (_err) {
      // Ignore storage errors.
    }
  }

  function activeDraftPanelName() {
    state.uiPanels = normalizeDraftUiPanels(state.uiPanels);
    return String(state.uiPanels.active || '');
  }

  function setDraftActivePanel(panelName) {
    var panel = String(panelName || '').toLowerCase();
    if (panel !== 'text' && panel !== 'align' && panel !== 'layers' && panel !== 'merge') {
      panel = '';
    }
    state.uiPanels = normalizeDraftUiPanels({ active: panel });
    saveDraftUiPanelsState();
  }

  function toggleDraftUiPanel(panelName) {
    var panel = String(panelName || '').toLowerCase();
    if (panel !== 'text' && panel !== 'align' && panel !== 'layers' && panel !== 'merge') {
      return;
    }
    var active = activeDraftPanelName();
    setDraftActivePanel(active === panel ? '' : panel);
  }

  function ptToPx(value) {
    var v = Number(value || 0);
    if (!Number.isFinite(v)) {
      return 0;
    }
    return v * PT_TO_PX;
  }

  function pxToPt(value) {
    var v = Number(value || 0);
    if (!Number.isFinite(v)) {
      return 0;
    }
    return v / PT_TO_PX;
  }

  function formatPtValue(value) {
    var num = Math.round(Number(value || 0) * 100) / 100;
    if (!Number.isFinite(num)) {
      return '0';
    }
    return String(num % 1 === 0 ? Math.round(num) : num);
  }

  var FONT_CATALOG = [
    {
      id: 'arial',
      label: 'Arial',
      aliases: ['arial', 'arial black', 'arial mt'],
      faces: [
        { id: 'regular', label: 'Regular', family: 'Arial', weight: '400', style: 'normal' },
        { id: 'bold', label: 'Bold', family: 'Arial', weight: '700', style: 'normal' },
      ],
    },
    {
      id: 'futura',
      label: 'Futura',
      aliases: ['futura'],
      faces: [
        { id: 'light-bt', label: 'Light BT', family: 'Futura', weight: '300', style: 'normal' },
        { id: 'book', label: 'Book', family: 'Futura', weight: '400', style: 'normal' },
        { id: 'medium', label: 'Medium', family: 'Futura', weight: '500', style: 'normal' },
        { id: 'medium-condensed', label: 'Medium Condensed', family: 'Futura', weight: '500', style: 'normal' },
        { id: 'bold', label: 'Bold', family: 'Futura', weight: '700', style: 'normal' },
      ],
    },
  ];
  var TABLE_SCHEMA_FIELDS = normalizeTableSchemaFields(window.TABLE_FIELDS);

  function normalizeTableSchemaFields(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .filter(function (item) {
        return item && typeof item === 'object' && String(item.name || '').trim();
      })
      .map(function (item) {
        var fieldName = String(item.name || '').trim();
        var fieldType = String(item.type || 'text').trim().toLowerCase();
        if (!fieldType) {
          fieldType = 'text';
        }
        return {
          name: fieldName,
          type: fieldType,
          label: String(item.label || item.verbose_name || fieldName),
        };
      });
  }

  function normalizeFieldLookupKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function findTableFieldByName(fieldName) {
    var wantedRaw = String(fieldName || '').trim().toLowerCase();
    var wantedNorm = normalizeFieldLookupKey(fieldName);
    var match = null;

    TABLE_SCHEMA_FIELDS.some(function (field) {
      var nameRaw = String(field.name || '').trim().toLowerCase();
      var nameNorm = normalizeFieldLookupKey(field.name);
      if ((wantedRaw && nameRaw === wantedRaw) || (wantedNorm && nameNorm === wantedNorm)) {
        match = field;
        return true;
      }
      return false;
    });

    return match;
  }

  function extractMergeTokenFieldName(text) {
    var raw = String(text || '').trim();
    if (!raw) {
      return '';
    }

    var tokenMatch = raw.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
    if (!tokenMatch) {
      tokenMatch = raw.match(/^<<\s*([^<>]+?)\s*>>$/);
    }
    if (!tokenMatch) {
      tokenMatch = raw.match(/^\[\[\s*([^\[\]]+?)\s*\]\]$/);
    }
    return tokenMatch ? String(tokenMatch[1] || '').trim() : '';
  }

  function extractMergeTokenFieldNames(text) {
    var raw = String(text || '');
    if (!raw) {
      return [];
    }

    var found = [];
    var seen = {};
    var match = null;
    MERGE_TOKEN_REGEX_GLOBAL.lastIndex = 0;
    while ((match = MERGE_TOKEN_REGEX_GLOBAL.exec(raw)) !== null) {
      var tokenName = String(match[1] || match[2] || match[3] || '').trim();
      if (!tokenName) {
        continue;
      }
      var key = normalizeFieldLookupKey(tokenName);
      if (!key || seen[key]) {
        continue;
      }
      seen[key] = true;
      found.push(tokenName);
    }
    MERGE_TOKEN_REGEX_GLOBAL.lastIndex = 0;
    return found;
  }

  function findBestSchemaFieldForLabel(rawLabel) {
    var candidates = schemaFieldMatchCandidates(rawLabel);
    if (!candidates.length) {
      return null;
    }
    return candidates[0].field || null;
  }

  function schemaFieldMatchCandidates(rawLabel) {
    var tokenField = extractMergeTokenFieldName(rawLabel);
    if (tokenField) {
      var tokenExact = findTableFieldByName(tokenField);
      if (tokenExact) {
        return [{ field: tokenExact, score: 200, reason: 'token-exact' }];
      }
    }

    var cleaned = String(rawLabel || '')
      .replace(/^\s*\d+[.)\-\s]+/, '')
      .replace(/^[\s\[\]{}<>()'"`~!@#$%^&*+=|\\/:;,.?-]+/, '')
      .replace(/[\s\[\]{}<>()'"`~!@#$%^&*+=|\\/:;,.?-]+$/, '')
      .trim();
    if (!cleaned) {
      return [];
    }

    var exact = findTableFieldByName(cleaned);
    if (exact) {
      return [{ field: exact, score: 190, reason: 'exact' }];
    }

    var wantedNorm = normalizeFieldLookupKey(cleaned);
    if (!wantedNorm) {
      return [];
    }

    var out = [];
    TABLE_SCHEMA_FIELDS.forEach(function (field) {
      var nameNorm = normalizeFieldLookupKey(field.name);
      var labelNorm = normalizeFieldLookupKey(field.label || field.name);
      if (!nameNorm && !labelNorm) {
        return;
      }

      var score = 0;
      var reason = '';
      if (wantedNorm && nameNorm && wantedNorm === nameNorm) {
        score = 120;
        reason = 'name-eq';
      } else if (wantedNorm && labelNorm && wantedNorm === labelNorm) {
        score = 112;
        reason = 'label-eq';
      } else {
        if (wantedNorm && nameNorm && wantedNorm.indexOf(nameNorm) >= 0 && nameNorm.length >= 3) {
          score = Math.max(score, 82 + Math.min(12, nameNorm.length));
          reason = score >= 90 ? 'name-in-label' : reason;
        }
        if (wantedNorm && labelNorm && wantedNorm.indexOf(labelNorm) >= 0 && labelNorm.length >= 4) {
          var scoreFromLabelInside = 78 + Math.min(10, labelNorm.length);
          if (scoreFromLabelInside > score) {
            score = scoreFromLabelInside;
            reason = 'label-in-label';
          }
        }
        if (wantedNorm && nameNorm && nameNorm.indexOf(wantedNorm) >= 0 && wantedNorm.length >= 4) {
          var scoreFromNameContains = 70 + Math.min(8, wantedNorm.length);
          if (scoreFromNameContains > score) {
            score = scoreFromNameContains;
            reason = 'name-contains';
          }
        }
        if (wantedNorm && labelNorm && labelNorm.indexOf(wantedNorm) >= 0 && wantedNorm.length >= 4) {
          var scoreFromLabelContains = 68 + Math.min(8, wantedNorm.length);
          if (scoreFromLabelContains > score) {
            score = scoreFromLabelContains;
            reason = 'label-contains';
          }
        }
      }

      if (score >= 78) {
        out.push({
          field: field,
          score: score,
          reason: reason || 'fuzzy',
        });
      }
    });

    out.sort(function (a, b) {
      return Number(b.score || 0) - Number(a.score || 0);
    });
    return out;
  }

  function isImageCompatibleSchemaField(field) {
    if (!field || typeof field !== 'object') {
      return false;
    }
    var t = String(field.type || '').toLowerCase();
    var n = String(field.name || '').toLowerCase();
    return t === 'photo'
      || t === 'rel_photo'
      || t === 'image'
      || t === 'mother_photo'
      || t === 'father_photo'
      || t === 'signature'
      || t === 'barcode'
      || t === 'qr_code'
      || n.indexOf('photo') >= 0
      || n.indexOf('image') >= 0
      || n.indexOf('barcode') >= 0
      || n.indexOf('signature') >= 0
      || /(^|_)qr(_|$)/.test(n);
  }

  function findBestImageSchemaFieldForAutoMap() {
    var ranked = TABLE_SCHEMA_FIELDS
      .filter(function (field) {
        return isImageCompatibleSchemaField(field);
      })
      .map(function (field) {
        var name = String(field && field.name || '').toLowerCase();
        var score = 0;
        if (name.indexOf('photo') >= 0) {
          score += 100;
        }
        if (name === 'photo' || name === 'student_photo') {
          score += 50;
        }
        if (name.indexOf('image') >= 0) {
          score += 25;
        }
        if (name.indexOf('signature') >= 0) {
          score += 15;
        }
        if (name.indexOf('barcode') >= 0 || name.indexOf('qr') >= 0) {
          score -= 15;
        }
        return {
          field: field,
          score: score,
        };
      })
      .sort(function (a, b) {
        return Number(b.score || 0) - Number(a.score || 0);
      });

    return ranked.length ? ranked[0].field : null;
  }

  function isAutoMapPhotoSlot(item) {
    if (!item || String(item.type || '').toLowerCase() !== 'image') {
      return false;
    }

    var src = String(item.src || '').trim();
    if (src) {
      return false;
    }

    var imageKind = String(item.imageKind || '').toLowerCase();
    var label = String(item.label || '').toLowerCase();
    if (imageKind.indexOf('photo') >= 0 || imageKind.indexOf('image') >= 0 || imageKind.indexOf('signature') >= 0) {
      return true;
    }
    if (/\b(photo|image|pic|signature|qr|barcode)\b/.test(label)) {
      return true;
    }

    // Empty-src image placeholders are usually data slots; allow auto binding.
    return true;
  }

  function fieldLabelForUi(fieldName) {
    var field = findTableFieldByName(fieldName);
    if (field && field.label) {
      return String(field.label);
    }
    return String(fieldName || '');
  }

  function renderSchemaFieldOptions(selectedField, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var wanted = String(selectedField || '');
    var includeEmpty = opts.includeEmpty !== false;
    var imageOnly = !!opts.imageOnly;

    var rows = [];
    if (includeEmpty) {
      rows.push('<option value=""' + (!wanted ? ' selected' : '') + '>' + escapeHtml(String(opts.emptyLabel || 'Static content (no field)')) + '</option>');
    }

    TABLE_SCHEMA_FIELDS.forEach(function (field) {
      if (imageOnly && !isImageCompatibleSchemaField(field)) {
        return;
      }
      var name = String(field.name || '');
      var isSelected = wanted && normalizeFieldLookupKey(wanted) === normalizeFieldLookupKey(name);
      var display = fieldLabelForUi(name);
      rows.push('<option value="' + escapeAttr(name) + '"' + (isSelected ? ' selected' : '') + '>' + escapeHtml(display) + '</option>');
    });

    return rows.join('');
  }

  function normalizeFontWeightValue(rawWeight) {
    var weightRaw = String(rawWeight || '').trim().toLowerCase();
    if (weightRaw === 'normal') {
      return '400';
    }
    if (weightRaw === 'bold') {
      return '700';
    }
    var numeric = Number(weightRaw);
    if (!Number.isFinite(numeric)) {
      return '400';
    }
    numeric = Math.round(numeric / 100) * 100;
    numeric = Math.max(100, Math.min(900, numeric));
    return String(numeric);
  }

  function normalizeFontStyleValue(rawStyle) {
    var style = String(rawStyle || '').trim().toLowerCase();
    return (style === 'italic' || style === 'oblique') ? 'italic' : 'normal';
  }

  function findFontFamilyById(id) {
    var wanted = String(id || '').trim().toLowerCase();
    if (!wanted) {
      return null;
    }
    return FONT_CATALOG.find(function (family) {
      return String(family.id || '').toLowerCase() === wanted;
    }) || null;
  }

  function findFontFamilyByName(fontFamilyValue) {
    var raw = String(fontFamilyValue || '').trim().toLowerCase();
    if (!raw) {
      return FONT_CATALOG[0] || null;
    }
    var primary = raw.split(',')[0].replace(/["']/g, '').trim();
    return FONT_CATALOG.find(function (family) {
      var aliases = Array.isArray(family.aliases) ? family.aliases : [];
      return aliases.some(function (alias) {
        var wanted = String(alias || '').trim().toLowerCase();
        return wanted && (primary === wanted || primary.indexOf(wanted) >= 0);
      });
    }) || FONT_CATALOG[0] || null;
  }

  function findFontFaceById(family, faceId) {
    if (!family || !Array.isArray(family.faces)) {
      return null;
    }
    var wanted = String(faceId || '').trim().toLowerCase();
    if (!wanted) {
      return null;
    }
    return family.faces.find(function (face) {
      return String(face.id || '').toLowerCase() === wanted;
    }) || null;
  }

  function resolveFontSelection(item) {
    var source = item && typeof item === 'object' ? item : {};
    var family = findFontFamilyById(source.fontGroup) || findFontFamilyByName(source.fontFamily);
    if (!family) {
      return {
        family: null,
        face: null,
      };
    }

    var byId = findFontFaceById(family, source.fontFace);
    if (byId) {
      return { family: family, face: byId };
    }

    var weight = normalizeFontWeightValue(source.fontWeight || '400');
    var style = normalizeFontStyleValue(source.fontStyle || 'normal');
    var familyName = String(source.fontFamily || '').trim().toLowerCase();

    var best = family.faces.find(function (face) {
      return String(face.family || '').trim().toLowerCase() === familyName
        && normalizeFontWeightValue(face.weight) === weight
        && normalizeFontStyleValue(face.style) === style;
    }) || family.faces.find(function (face) {
      return normalizeFontWeightValue(face.weight) === weight
        && normalizeFontStyleValue(face.style) === style;
    }) || family.faces.find(function (face) {
      return normalizeFontWeightValue(face.weight) === '400'
        && normalizeFontStyleValue(face.style) === 'normal';
    }) || family.faces[0];

    return {
      family: family,
      face: best,
    };
  }

  function renderFontFamilyOptions(selectedFamilyId) {
    var wanted = String(selectedFamilyId || '').trim().toLowerCase();
    return FONT_CATALOG.map(function (family) {
      var id = String(family.id || '');
      return '<option value="' + escapeAttr(id) + '"' + (wanted === id ? ' selected' : '') + '>'
        + escapeHtml(String(family.label || id))
        + '</option>';
    }).join('');
  }

  function renderFontFaceOptions(family, selectedFaceId) {
    if (!family || !Array.isArray(family.faces)) {
      return '';
    }
    var wanted = String(selectedFaceId || '').trim().toLowerCase();
    return family.faces.map(function (face) {
      var id = String(face.id || '');
      var weight = normalizeFontWeightValue(face.weight);
      var suffix = normalizeFontStyleValue(face.style) === 'italic' ? ' italic' : '';
      return '<option value="' + escapeAttr(id) + '"' + (wanted === id ? ' selected' : '') + '>'
        + escapeHtml(String(face.label || id) + ' (' + weight + suffix + ')')
        + '</option>';
    }).join('');
  }

  function coreLocalFontFaceCss() {
    var rules = [
      { family: 'Arial', style: 'normal', weight: '400', file: 'Roshan_Font/arial.ttf' },
      { family: 'Arial', style: 'normal', weight: '700', file: 'Roshan_Font/Arial%20Bold.ttf' },
      { family: 'Futura', style: 'normal', weight: '300', file: 'Roshan_Font/futura%20light%20bt.ttf' },
      { family: 'Futura', style: 'normal', weight: '400', file: 'Roshan_Font/Futura%20Book%20font.ttf' },
      { family: 'Futura', style: 'normal', weight: '500', file: 'Roshan_Font/futura%20medium%20bt.ttf' },
      { family: 'Futura', style: 'normal', weight: '500', file: 'Roshan_Font/futura%20medium%20condensed%20bt.ttf' },
      { family: 'Futura', style: 'normal', weight: '700', file: 'Roshan_Font/Futura%20Bold%20font.ttf' },
    ];
    return rules.map(function (item) {
      return '@font-face{font-family:"' + item.family + '";font-style:' + item.style + ';font-weight:' + item.weight + ';font-display:swap;src:url("/static/fonts/' + item.file + '") format("truetype");}';
    }).join('');
  }

  function ensureStyles() {
    if (document.getElementById('gcThreeStepStyles')) {
      return;
    }

    var style = document.createElement('style');
    style.id = 'gcThreeStepStyles';
    style.textContent = ''
      + coreLocalFontFaceCss()
      + '.gc-flow-box{max-width:none;width:90vw;height:90vh;}'
      + '.gc-flow-header{justify-content:space-between;}'
      + '.gc-flow-header-left{display:flex;align-items:center;gap:10px;min-width:0;}'
      + '.gc-step-pill{display:inline-flex;align-items:center;justify-content:center;padding:4px 10px;border-radius:4px;background:#e0e7ff;color:#1e3a8a;font-size:11px;font-weight:700;white-space:nowrap;}'
      + '.gc-simple-flow-root{height:100%;display:flex;flex-direction:column;background:#f8fafc;}'
      + '.gc-shell{height:100%;display:flex;flex-direction:column;padding:0;gap:0;}'
      + '.gc-progress{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}'
      + '.gc-progress-item{display:flex;align-items:center;gap:8px;border:1px solid #d1d5db;background:#ffffff;border-radius:10px;padding:8px 10px;font-size:12px;color:#4b5563;}'
      + '.gc-progress-num{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#e5e7eb;color:#374151;font-size:11px;font-weight:700;flex:0 0 22px;}'
      + '.gc-progress-item.is-active{border-color:#60a5fa;background:#eff6ff;color:#1e3a8a;}'
      + '.gc-progress-item.is-active .gc-progress-num{background:#2563eb;color:#ffffff;}'
      + '.gc-progress-item.is-done{border-color:#86efac;background:#ecfdf5;color:#166534;}'
      + '.gc-progress-item.is-done .gc-progress-num{background:#16a34a;color:#ffffff;}'
      + '.gc-step-panel{flex:1;min-height:0;border:0;background:transparent;border-radius:0;padding:0;display:flex;flex-direction:column;gap:12px;overflow:auto;}'
      + '.gc-step-title{font-size:16px;font-weight:700;color:#0f172a;margin:0;}'
      + '.gc-step-subtitle{font-size:12px;color:#64748b;margin:0;}'
      + '.gc-choice-row{display:flex;flex-wrap:wrap;gap:8px;}'
      + '.gc-choice-btn{height:34px;padding:0 14px;border-radius:8px;border:1px solid #cbd5e1;background:#ffffff;color:#334155;font-size:12px;font-weight:600;cursor:pointer;}'
      + '.gc-choice-btn.is-active{background:#2563eb;border-color:#2563eb;color:#ffffff;}'
      + '.gc-upload-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;}'
      + '.gc-upload-card{display:flex;flex-direction:column;gap:6px;border:1px solid #dbe2ea;border-radius:10px;background:#f8fafc;padding:10px;}'
      + '.gc-upload-card label{font-size:12px;font-weight:700;color:#334155;}'
      + '.gc-upload-card input[type=file]{font-size:12px;}'
      + '.gc-file-note{font-size:11px;color:#64748b;word-break:break-word;}'
      + '.gc-preview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;}'
      + '.gc-preview-card{border:1px solid #dbe2ea;border-radius:10px;background:#f8fafc;padding:8px;display:flex;flex-direction:column;gap:8px;}'
      + '.gc-preview-head{font-size:12px;font-weight:700;color:#334155;display:flex;justify-content:space-between;align-items:center;}'
      + '.gc-preview-box{position:relative;aspect-ratio:1.6/1;border:1px solid #cbd5e1;border-radius:8px;background:#ffffff;overflow:hidden;}'
      + '.gc-pdf-preview-shell{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#f8fafc;}'
      + '.gc-pdf-canvas{max-width:100%;max-height:100%;display:block;border:0;box-shadow:0 2px 10px rgba(15,23,42,0.12);background:#ffffff;border-radius:4px;}'
      + '.gc-pdf-fallback-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:#ffffff;}'
      + '.gc-pdf-fallback-frame.is-hidden{display:none;}'
      + '.gc-preview-loading{position:absolute;left:10px;right:10px;bottom:10px;padding:6px 8px;border-radius:6px;background:rgba(15,23,42,0.7);color:#ffffff;font-size:11px;font-weight:600;text-align:center;pointer-events:none;}'
      + '.gc-preview-loading.is-hidden{display:none;}'
      + '.gc-preview-loading.is-error{background:rgba(127,29,29,0.84);}'
      + '.gc-preview-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;padding:10px;text-align:center;}'
      + '.gc-template-overlay{position:absolute;inset:0;pointer-events:none;}'
      + '.gc-template-el{position:absolute;border:1px dashed rgba(37,99,235,0.8);background:rgba(37,99,235,0.12);color:#1d4ed8;font-size:10px;font-weight:700;padding:2px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.gc-template-el.gc-template-el-rect{border-style:solid;background:transparent;color:transparent;padding:0;}'
      + '.gc-template-empty{font-size:12px;color:#64748b;border:1px dashed #cbd5e1;border-radius:8px;background:#f8fafc;padding:10px;}'
      + '.gc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
      + '.gc-row label{font-size:12px;font-weight:700;color:#334155;}'
      + '.gc-select{height:34px;border:1px solid #cbd5e1;border-radius:8px;background:#ffffff;padding:0 10px;font-size:12px;min-width:260px;}'
      + '.gc-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;}'
      + '.gc-summary-item{border:1px solid #dbe2ea;border-radius:10px;background:#f8fafc;padding:10px;}'
      + '.gc-summary-label{font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.04em;}'
      + '.gc-summary-value{font-size:14px;color:#0f172a;font-weight:700;margin-top:4px;}'
      + '.gc-flow-box .btn{border-radius:4px;}'
      + '.gc-actions{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:nowrap;}'
      + '.gc-actions-meta{display:flex;flex-direction:column;gap:2px;min-width:0;}'
      + '.gc-actions-meta-title{font-size:12px;font-weight:700;color:#0f172a;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '.gc-actions-meta-step{font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;line-height:1.2;}'
      + '.gc-actions-right{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto;justify-content:flex-end;}'
      + '.gc-loading{position:absolute;inset:0;background:rgba(248,250,252,0.72);display:flex;align-items:center;justify-content:center;z-index:2;}'
      + '.gc-loading-box{display:flex;align-items:center;gap:8px;background:#ffffff;border:1px solid #dbe2ea;border-radius:10px;padding:10px 12px;font-size:12px;font-weight:700;color:#334155;}'
      + '.gc-spinner{width:15px;height:15px;border:2px solid #bfdbfe;border-top-color:#2563eb;border-radius:50%;animation:gcSpin .8s linear infinite;}'
      + '@keyframes gcSpin{to{transform:rotate(360deg);}}'
      + '@media (max-width:900px){.gc-flow-box{width:96vw;height:92vh;}.gc-shell{padding:10px;}.gc-step-panel{padding:12px;}.gc-select{min-width:100%;}}';

    document.head.appendChild(style);
  }

  function ensureStep1CompactStyles() {
    if (document.getElementById('gcStep1CompactStyles')) {
      return;
    }

    var style = document.createElement('style');
    style.id = 'gcStep1CompactStyles';
    style.textContent = ''
      + '.gc-flow-header{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;}'
      + '.gc-header-stepper{display:inline-flex;align-items:center;gap:0;min-width:0;overflow-x:auto;padding:2px 0;}'
      + '.gc-header-modal-actions{display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;margin-left:auto;flex:0 0 auto;min-height:32px;}'
      + '.gc-header-modal-actions .btn{height:28px;padding:0 10px;font-size:11px;line-height:1;}'
      + '.gc-mini-step{position:relative;display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 14px 0 36px;border:1px solid #cbd5e1;border-radius:999px;background:#ffffff;color:#475569;font-size:11px;font-weight:700;line-height:1;white-space:nowrap;transition:all .16s ease;}'
      + '.gc-mini-step::before{content:attr(data-step);position:absolute;left:10px;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:999px;border:1px solid #cbd5e1;background:#f8fafc;color:#64748b;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;}'
      + '.gc-mini-step:not(:last-child){margin-right:14px;}'
      + '.gc-mini-step:not(:last-child)::after{content:"";position:absolute;left:calc(100% + 4px);top:50%;transform:translateY(-50%);width:10px;height:2px;background:#cbd5e1;border-radius:999px;pointer-events:none;}'
      + '.gc-mini-step.is-active{border-color:#3b82f6;background:#eff6ff;color:#1d4ed8;box-shadow:0 0 0 1px rgba(59,130,246,.12);}'
      + '.gc-mini-step.is-active::before{border-color:#3b82f6;background:#2563eb;color:#ffffff;}'
      + '.gc-mini-step.is-done{border-color:#86efac;background:#ecfdf5;color:#166534;}'
      + '.gc-mini-step.is-done::before{border-color:#16a34a;background:#16a34a;color:#ffffff;}'
      + '.gc-mini-step.is-done:not(:last-child)::after{background:#86efac;}'
      + '.gc-step-panel.gc-step-panel-step1{width:100%;max-width:none;margin:0;border-radius:4px;padding:4px 0 0;display:flex;flex-direction:column;gap:6px;min-height:100%;background:#f8fafc;}'
      + '.gc-step1-topbar{display:flex;justify-content:flex-start;align-items:stretch;gap:12px;flex-wrap:nowrap;margin:0;padding:6px 10px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;background:linear-gradient(180deg,#ffffff,#f8fbff);}'
      + '.gc-inline-group{display:flex;flex-direction:column;gap:4px;min-width:0;}'
      + '.gc-inline-group.gc-inline-group-selection{align-items:flex-end;text-align:right;margin-left:auto;flex:0 0 auto;min-width:136px;padding:4px 6px;border:1px solid #dbe2ea;border-radius:6px;background:#ffffff;justify-content:center;gap:1px;}'
      + '.gc-inline-controls{display:flex;align-items:stretch;gap:10px;flex-wrap:nowrap;flex:1 1 auto;min-width:0;}'
      + '.gc-inline-control-block{display:flex;flex-direction:column;gap:4px;min-width:0;flex:0 0 auto;justify-content:center;}'
      + '.gc-inline-control-block:not(.gc-inline-template-block){min-width:112px;}'
      + '.gc-inline-label{font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.03em;line-height:1.1;}'
      + '.gc-inline-value{font-size:13px;font-weight:700;color:#0f172a;line-height:1.2;}'
      + '.gc-inline-value.gc-inline-count-value{display:inline-flex;align-items:baseline;justify-content:flex-end;gap:3px;white-space:nowrap;line-height:1;}'
      + '.gc-inline-count-number{font-size:14px;font-weight:800;color:#0f172a;line-height:1;}'
      + '.gc-inline-count-text{font-size:10px;font-weight:700;color:#475569;line-height:1;}'
      + '.gc-inline-control-block.gc-inline-template-block{flex:0 0 360px !important;width:360px;min-width:360px;max-width:360px;}'
      + '.gc-inline-template-row{display:flex;align-items:center;gap:6px;min-width:0;max-width:100%;width:100%;}'
      + '.gc-inline-template-row .gc-select{height:32px;min-width:220px;max-width:100%;width:100%;flex:1 1 auto;border-radius:4px;}'
      + '.gc-inline-template-row .unified-select-dropdown{flex:1 1 auto;min-width:220px;max-width:100%;width:100%;}'
      + '.gc-inline-template-row .unified-select-dropdown .dropdown-toggle{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '#gcTemplateSelectStep1__options{min-width:0 !important;width:360px;max-width:min(calc(100vw - 24px),360px);}'
      + '#gcTemplateSelectStep1__options.usd-portaled{min-width:0 !important;width:360px !important;max-width:min(calc(100vw - 24px),360px) !important;}'
      + '#gcTemplateSelectStep1__options .dropdown-option{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '.gc-step-panel-step1 .gc-choice-row{display:inline-flex;flex-wrap:nowrap;gap:6px;}'
      + '.gc-step-panel-step1 .gc-choice-btn{height:32px;min-width:74px;padding:0 10px;border-radius:4px;}'
      + '.gc-step1-upload-row{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:8px;padding:6px 10px 0;border-top:1px solid #dbe2ea;align-items:start;margin-bottom:4px;}'
      + '.gc-step1-upload-row.is-single-side{grid-template-columns:minmax(0,1fr);}'
      + '.gc-step1-upload-col{display:flex;flex-direction:column;gap:5px;min-width:0;padding:8px;border:1px solid #e2e8f0;border-radius:4px;background:#ffffff;box-shadow:0 1px 0 rgba(15,23,42,0.04);}'
      + '.gc-step1-upload-col label{font-size:12px;font-weight:700;color:#334155;line-height:1.2;}'
      + '.gc-file-input-native{position:absolute;width:0;height:0;opacity:0;pointer-events:none;}'
      + '.gc-upload-input-wrap{position:relative;display:flex;align-items:center;gap:6px;flex-wrap:nowrap;min-width:0;}'
      + '.gc-upload-btn{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 11px;border:1px solid #3b82f6;background:#eff6ff;color:#1d4ed8;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;transition:all .16s ease;}'
      + '.gc-upload-btn:hover{background:#dbeafe;border-color:#2563eb;color:#1e40af;box-shadow:0 2px 8px rgba(37,99,235,.18);}'
      + '.gc-file-pill{display:inline-flex;align-items:center;min-width:0;max-width:100%;padding:3px 7px;border-radius:4px;background:#f1f5f9;color:#334155;font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '.gc-file-pill.is-empty{background:#f8fafc;color:#64748b;border:1px dashed #cbd5e1;}'
      + '.gc-upload-clear-btn{height:32px;padding:0 9px;border-radius:4px;font-size:11px;font-weight:700;line-height:1;}'
      + '.gc-step1-previews{display:inline-flex;flex-direction:column;gap:6px;padding:6px 10px 0;border-top:1px solid #dbe2ea;background:transparent;min-height:0;max-width:100%;flex:1 1 auto;}'
      + '.gc-step1-previews-head{font-size:12px;font-weight:700;color:#334155;line-height:1.2;}'
      + '.gc-preview-grid.gc-preview-grid-cards{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;justify-content:flex-start;}'
      + '.gc-preview-card.is-card-size{width:auto;max-width:none;border-radius:4px;background:#ffffff;padding:5px;border:1px solid #dbe2ea;}'
      + '.gc-preview-card.is-card-size .gc-preview-box{margin:0 auto;}'
      + '.gc-step-panel-step1 .gc-preview-head{font-size:11px;}'
      + '.gc-step-panel-step1 .gc-preview-box{border-radius:2px;}'
      + '.gc-preview-box.gc-ratio-landscape{aspect-ratio:1.6/1;}'
      + '.gc-preview-box.gc-ratio-portrait{aspect-ratio:1/1.6;}'
      + '.gc-step-panel-step1 .gc-preview-box.gc-mm-landscape{width:87mm;max-width:100%;height:auto;aspect-ratio:1.526/1;}'
      + '.gc-step-panel-step1 .gc-preview-box.gc-mm-portrait{width:57mm;max-width:100%;height:auto;aspect-ratio:1/1.526;}'
      + '.gc-step-panel-step1 .gc-actions{margin-top:auto;padding:8px 10px 10px;position:sticky;bottom:0;background:#f8fafc;z-index:1;}'
      + '.gc-step-panel.gc-step-panel-step2{width:100%;max-width:none;margin:0;border-radius:4px;padding:4px 0 0;display:flex;flex-direction:column;gap:6px;min-height:100%;background:#f8fafc;}'
      + '.gc-step-panel-step2 .gc-step-title,.gc-step-panel-step2 .gc-step-subtitle{padding:0 10px;}'
      + '.gc-step2-workspace{display:flex;flex-direction:column;gap:8px;padding:0 10px;min-height:0;flex:1;}'
      + '.gc-step2-main{display:grid;grid-template-columns:60px minmax(0,1fr) 336px;gap:10px;min-height:0;flex:1;}'
      + '.gc-step2-tools{border:1px solid #cfd8e3;border-radius:10px;background:linear-gradient(180deg,#ffffff 0,#f3f7fb 100%);padding:8px 6px;display:flex;flex-direction:column;gap:7px;align-items:stretch;box-shadow:0 6px 16px rgba(15,23,42,.07);}'
      + '.gc-step2-tool-btn{height:44px;border:1px solid #ccd6e2;border-radius:8px;background:#f7fbff;color:#334155;font-size:10px;font-weight:700;line-height:1.15;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;cursor:pointer;transition:all .16s ease;}'
      + '.gc-step2-tool-btn:hover{border-color:#7a97b9;background:#edf4fb;color:#0f172a;}'
      + '.gc-step2-tool-icon{width:24px;height:24px;border-radius:7px;background:#e2ebf5;color:#1f2937;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px rgba(122,151,185,.34);}'
      + '.gc-step2-tool-icon i{font-size:14px;line-height:1;}'
      + '.gc-step2-tool-label{font-size:10px;font-weight:700;letter-spacing:.01em;line-height:1.1;text-align:center;}'
      + '.gc-step2-tool-btn .gc-step2-tool-label{display:none;}'
      + '.gc-step2-tool-btn.is-active{background:#eff6ff;border-color:#3b82f6;color:#1d4ed8;box-shadow:0 0 0 1px rgba(59,130,246,.15),0 5px 12px rgba(37,99,235,.14);}'
      + '.gc-step2-tool-btn.is-active .gc-step2-tool-icon{background:#2563eb;color:#ffffff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);}'
      + '.gc-step2-canvas-shell{display:flex;flex-direction:column;min-height:0;border:1px solid #d5dde8;border-radius:10px;background:#ffffff;overflow:hidden;box-shadow:0 8px 22px rgba(15,23,42,.07);}'
      + '.gc-step2-canvas-head{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #e2e8f0;background:linear-gradient(180deg,#ffffff 0,#f5f9fe 100%);}'
      + '.gc-step2-canvas-head .gc-inline-label{font-size:10px;}'
      + '.gc-step2-canvas-head .gc-inline-value{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px;}'
      + '.gc-step2-center-controls{display:flex;align-items:center;gap:5px;justify-self:center;flex-wrap:wrap;}'
      + '.gc-step2-zoom-pill{display:inline-flex;align-items:center;justify-content:center;height:32px;min-width:76px;padding:0 10px;border-radius:8px;font-size:12px;font-weight:800;letter-spacing:.01em;color:#1e3a8a;background:#e0e7ff;border:1px solid #bfdbfe;text-align:center;}'
      + '.gc-step2-center-controls .btn{height:32px;min-width:32px;padding:0 10px;font-size:11px;line-height:1;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;gap:6px;}'
      + '.gc-step2-center-controls .btn.is-active{border-color:#2563eb;background:#dbeafe;color:#1d4ed8;}'
      + '.gc-step2-side-switch{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;}'
      + '.gc-step2-side-switch .gc-choice-btn{height:28px;padding:0 10px;border-radius:6px;font-size:11px;}'
      + '.gc-step2-target-side{display:inline-flex;align-items:center;height:26px;padding:0 8px;border:1px solid #cbd5e1;border-radius:4px;background:#ffffff;color:#334155;font-size:10px;font-weight:700;white-space:nowrap;}'
      + '.gc-step2-tool-btn:focus-visible,.gc-prop-tab-btn:focus-visible,.gc-panel-toggle-btn:focus-visible,.gc-layer-item-icon-btn:focus-visible,.gc-prop-icon-btn:focus-visible,.gc-step2-side-switch .gc-choice-btn:focus-visible,.gc-step2-center-controls .btn:focus-visible{outline:2px solid #2563eb;outline-offset:2px;}'
      + '.gc-prop-input:focus-visible,.gc-prop-select:focus-visible{outline:2px solid rgba(37,99,235,.35);outline-offset:1px;border-color:#2563eb;}'
      + '.gc-step2-canvas-stage{position:relative;flex:1;min-height:360px;background:radial-gradient(circle at 22% 14%,#e6edf6 0,#d5dde7 42%,#cfd8e3 100%);overflow:hidden;}'
      + '.gc-step2-stage-content{position:absolute;top:10px;left:10px;right:0;bottom:0;display:flex;align-items:center;justify-content:center;overflow:auto;padding:18px;}'
      + '.gc-step2-stage-content.is-zoom-mode{cursor:zoom-in;}'
      + '.gc-step2-stage-content.is-space-pan{cursor:grab;}'
      + '.gc-step2-stage-content.is-space-pan.is-panning{cursor:grabbing;}'
      + '.gc-step2-stage-content.is-space-pan .gc-step2-canvas,.gc-step2-stage-content.is-space-pan .gc-draft-el,.gc-step2-stage-content.is-space-pan .gc-draft-guide{cursor:grab !important;}'
      + '.gc-step2-canvas-wrap{position:relative;display:block;flex:0 0 auto;transform-origin:top left;}'
      + '.gc-step2-ruler-corner{position:absolute;top:0;left:0;width:10px;height:10px;border:1px solid #aeb7c4;background:#d3dae5;z-index:3;}'
      + '.gc-step2-ruler-top{position:absolute;top:0;left:10px;right:0;height:10px;border:1px solid #aeb7c4;background-color:#d3dae5;background-image:repeating-linear-gradient(to right,rgba(100,116,139,.2) 0,rgba(100,116,139,.2) 1px,transparent 1px,transparent 6px),repeating-linear-gradient(to right,rgba(30,41,59,.35) 0,rgba(30,41,59,.35) 1px,transparent 1px,transparent 30px);cursor:ns-resize;z-index:2;}'
      + '.gc-step2-ruler-left{position:absolute;top:10px;left:0;bottom:0;width:10px;border:1px solid #aeb7c4;background-color:#d3dae5;background-image:repeating-linear-gradient(to bottom,rgba(100,116,139,.2) 0,rgba(100,116,139,.2) 1px,transparent 1px,transparent 6px),repeating-linear-gradient(to bottom,rgba(30,41,59,.35) 0,rgba(30,41,59,.35) 1px,transparent 1px,transparent 30px);cursor:ew-resize;z-index:2;}'
      + '.gc-step2-guide-layer{position:absolute;inset:0;pointer-events:none;z-index:2;}'
      + '.gc-step2-guide-layer .gc-draft-guide{pointer-events:auto;}'
      + '.gc-step2-canvas{position:relative;width:100%;height:100%;background:#ffffff;border:1px solid #b8c1cc;border-radius:2px;box-shadow:8px 8px 0 rgba(15,23,42,0.12);}'
      + '.gc-step2-canvas.is-two-sided{background:#ffffff;}'
      + '.gc-step2-dual-divider{position:absolute;top:0;bottom:0;left:50%;width:0;border-left:1px solid rgba(71,85,105,.35);opacity:.75;pointer-events:none;z-index:1;}'
      + '.gc-step2-dual-side-tag{position:absolute;top:8px;display:inline-flex;align-items:center;justify-content:center;min-width:52px;height:22px;padding:0 8px;border-radius:999px;border:1px solid #bfdbfe;background:rgba(239,246,255,.9);color:#1e3a8a;font-size:10px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;pointer-events:none;z-index:1;}'
      + '.gc-step2-dual-side-tag.is-front{left:8px;}'
      + '.gc-step2-dual-side-tag.is-back{left:calc(50% + 8px);}'
      + '.gc-step2-canvas.is-text-mode{cursor:text;}'
      + '.gc-step2-canvas.is-photo-mode{cursor:crosshair;}'
      + '.gc-step2-canvas.is-rect-mode{cursor:crosshair;}'
      + '.gc-step2-canvas-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;font-weight:600;pointer-events:none;padding:10px;text-align:center;}'
      + '.gc-draft-el{position:absolute;display:flex;align-items:center;justify-content:center;padding:2px 4px;border:1px dashed #2563eb;background:rgba(37,99,235,0.13);color:#1d4ed8;font-size:10px;font-weight:700;text-align:center;line-height:1.2;border-radius:2px;cursor:pointer;overflow:visible;}'
      + '.gc-draft-el.gc-draft-el-text{background:transparent;border:1px dashed transparent;color:#0f172a;padding:0;}'
      + '.gc-draft-el.gc-draft-el-text:hover{border-color:transparent;background:transparent;}'
      + '.gc-draft-el.gc-draft-el-artistic{white-space:pre-wrap;align-items:stretch;overflow:visible;}'
      + '.gc-draft-el-core{display:block;white-space:inherit;pointer-events:none;transform-origin:top left;}'
      + '.gc-draft-el-core.gc-draft-el-core-lines{display:flex;flex-direction:column;justify-content:center;align-items:stretch;}'
      + '.gc-draft-el-core.gc-draft-el-core-lines .gc-draft-el-line{display:block;min-height:1em;width:100%;}'
      + '.gc-draft-el.gc-draft-el-paragraph{white-space:normal;align-items:flex-start;padding-top:2px;overflow:hidden;}'
      + '.gc-draft-el.gc-draft-el-photo{border-style:solid;border-color:#0ea5e9;background:rgba(14,165,233,0.14);color:#0369a1;}'
      + '.gc-draft-el.gc-draft-el-rect{border-style:solid;background:rgba(37,99,235,0.10);color:transparent;padding:0;}'
      + '.gc-draft-el.is-locked{cursor:not-allowed;opacity:.62;pointer-events:none;}'
      + '.gc-draft-el.is-selected{border:1px solid #111827;background:transparent;box-shadow:none;overflow:visible;}'
      + '.gc-draft-el.is-key-object{border:2px solid #f59e0b !important;box-shadow:0 0 0 1px rgba(245,158,11,.35);}'
      + '.gc-draft-el.is-key-object.gc-draft-el-text{border-color:#f59e0b !important;}'
      + '.gc-draft-el.is-selected[data-action="select-draft-element"]{cursor:grab;}'
      + '.gc-draft-el.gc-draft-el-text.is-selected{background:transparent;border-color:transparent;}'
      + '.gc-draft-el.gc-draft-el-text.gc-draft-el-artistic.is-selected::after{display:none;}'
      + '.gc-draft-selection-group{background:transparent !important;border:1px dashed #0f172a !important;z-index:4;pointer-events:auto;}'
      + '.gc-draft-el.is-merge-preview{border-style:dashed;}'
      + '.gc-draft-el.gc-draft-el-text.is-merge-preview{background:rgba(219,234,254,.32);border-color:rgba(37,99,235,.42);color:#1e3a8a;}'
      + '.gc-draft-el.gc-draft-el-photo.is-merge-preview{background:repeating-linear-gradient(45deg,rgba(14,165,233,.12) 0,rgba(14,165,233,.12) 6px,rgba(2,132,199,.18) 6px,rgba(2,132,199,.18) 12px);border-color:#0284c7;color:#075985;}'
      + '.gc-draft-el.gc-draft-el-text.is-editing::after{display:none;}'
      + '.gc-draft-el.gc-draft-el-text.is-editing{border-color:transparent;background:transparent;box-shadow:none;}'
      + '.gc-draft-selection-handle{position:absolute;width:var(--gc-handle-size,8px);height:var(--gc-handle-size,8px);border:1px solid #111827;background:#ffffff;border-radius:1px;box-sizing:border-box;pointer-events:auto;z-index:3;touch-action:none;}'
      + '.gc-draft-selection-handle::after{content:"";position:absolute;left:-6px;top:-6px;right:-6px;bottom:-6px;background:transparent;}'
      + '.gc-draft-selection-handle.is-nw{left:calc(-1 * var(--gc-handle-offset-x,8px));top:calc(-1 * var(--gc-handle-offset-y,8px));}'
      + '.gc-draft-selection-handle.is-n{left:50%;top:calc(-1 * var(--gc-handle-offset-y,8px));transform:translateX(-50%);}'
      + '.gc-draft-selection-handle.is-ne{right:calc(-1 * var(--gc-handle-offset-x,8px));top:calc(-1 * var(--gc-handle-offset-y,8px));}'
      + '.gc-draft-selection-handle.is-e{right:calc(-1 * var(--gc-handle-offset-x,8px));top:50%;transform:translateY(-50%);}'
      + '.gc-draft-selection-handle.is-sw{left:calc(-1 * var(--gc-handle-offset-x,8px));bottom:calc(-1 * var(--gc-handle-offset-y,8px));}'
      + '.gc-draft-selection-handle.is-s{left:50%;bottom:calc(-1 * var(--gc-handle-offset-y,8px));transform:translateX(-50%);}'
      + '.gc-draft-selection-handle.is-se{right:calc(-1 * var(--gc-handle-offset-x,8px));bottom:calc(-1 * var(--gc-handle-offset-y,8px));}'
      + '.gc-draft-selection-handle.is-w{left:calc(-1 * var(--gc-handle-offset-x,8px));top:50%;transform:translateY(-50%);}'
      + '.gc-draft-selection-handle.is-n,.gc-draft-selection-handle.is-s{cursor:ns-resize;}'
      + '.gc-draft-selection-handle.is-e,.gc-draft-selection-handle.is-w{cursor:ew-resize;}'
      + '.gc-draft-selection-handle.is-nw,.gc-draft-selection-handle.is-se{cursor:nwse-resize;}'
      + '.gc-draft-selection-handle.is-ne,.gc-draft-selection-handle.is-sw{cursor:nesw-resize;}'
      + '.gc-draft-selection-handle:hover{border-color:#2563eb;background:#dbeafe;box-shadow:0 0 0 1px rgba(37,99,235,.22);}'
      + '.gc-draft-inline-editor{display:block;width:100%;height:100%;outline:none;border:0;background:transparent;overflow:visible;cursor:text;user-select:text;white-space:inherit;line-height:inherit;letter-spacing:inherit;color:inherit;text-align:inherit;overflow-wrap:normal;word-break:normal;}'
      + '.gc-draft-inline-editor[data-text-mode="paragraph"]{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;}'
      + '.gc-draft-inline-editor[data-text-mode="artistic"]{white-space:pre;overflow-wrap:normal;word-break:normal;}'
      + '.gc-draft-inline-editor:focus{outline:none;}'
      + '.gc-draft-el.gc-draft-el-text.is-editing,.gc-draft-el.gc-draft-el-text.is-editing[data-action="select-draft-element"],.gc-draft-el.gc-draft-el-text.is-editing .gc-draft-el-core{cursor:text !important;}'
      + '.gc-draft-guide{position:absolute;border:0;background:transparent;z-index:2;}'
      + '.gc-draft-guide.is-vertical{width:14px;transform:translateX(-7px);cursor:ew-resize;}'
      + '.gc-draft-guide.is-horizontal{height:14px;transform:translateY(-7px);cursor:ns-resize;}'
      + '.gc-draft-guide::before{content:"";position:absolute;opacity:.8;}'
      + '.gc-draft-guide.is-vertical::before{left:6.5px;top:0;width:1px;height:100%;background-image:repeating-linear-gradient(to bottom,rgba(71,85,105,.85) 0,rgba(71,85,105,.85) 5px,transparent 5px,transparent 9px);}'
      + '.gc-draft-guide.is-horizontal::before{left:0;top:6.5px;width:100%;height:1px;background-image:repeating-linear-gradient(to right,rgba(71,85,105,.85) 0,rgba(71,85,105,.85) 5px,transparent 5px,transparent 9px);}'
      + '.gc-draft-guide.is-selected::before{opacity:1;}'
      + '.gc-draft-guide.is-selected.is-vertical::before{background-image:repeating-linear-gradient(to bottom,rgba(2,132,199,1) 0,rgba(2,132,199,1) 5px,transparent 5px,transparent 9px);}'
      + '.gc-draft-guide.is-selected.is-horizontal::before{background-image:repeating-linear-gradient(to right,rgba(2,132,199,1) 0,rgba(2,132,199,1) 5px,transparent 5px,transparent 9px);}'
      + '.gc-draft-guide:hover::before{opacity:1;}'
      + '.gc-step2-canvas-shell.is-guides-locked .gc-step2-ruler-top,.gc-step2-canvas-shell.is-guides-locked .gc-step2-ruler-left{cursor:not-allowed;opacity:.65;}'
      + '.gc-step2-canvas-shell.is-guides-locked .gc-draft-guide{pointer-events:none;}'
      + '.gc-draft-insert-guide{position:absolute;border:1px dashed #0f766e;background:rgba(45,212,191,0.18);pointer-events:none;z-index:2;}'
      + '.gc-draft-align-preview-line{position:absolute;pointer-events:none;z-index:2;border-color:rgba(245,158,11,.9);border-style:dashed;}'
      + '.gc-draft-align-preview-line.is-v{top:0;bottom:0;width:0;border-left-width:1px;}'
      + '.gc-draft-align-preview-line.is-h{left:0;right:0;height:0;border-top-width:1px;}'
      + '.gc-draft-align-preview-line.is-distribute{border-color:rgba(14,165,233,.95);}'
      + '.gc-draft-axis-lock-hint{position:absolute;pointer-events:none;z-index:2;border-color:rgba(2,132,199,.75);border-style:dotted;}'
      + '.gc-draft-axis-lock-hint.is-v{top:0;bottom:0;width:0;border-left-width:1px;}'
      + '.gc-draft-axis-lock-hint.is-h{left:0;right:0;height:0;border-top-width:1px;}'
      + '.gc-draft-axis-lock-label{position:absolute;pointer-events:none;z-index:2;height:18px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid #7dd3fc;background:rgba(224,242,254,.96);color:#075985;font-size:10px;font-weight:700;letter-spacing:.01em;white-space:nowrap;}'
      + '.gc-draft-axis-lock-label.is-v{transform:translate(-50%,8px);}'
      + '.gc-draft-axis-lock-label.is-h{transform:translate(8px,-50%);}'
      + '.gc-draft-insert-guide.is-rect{border-color:#2563eb;background:rgba(37,99,235,0.13);}'
      + '.gc-draft-insert-guide.is-select{border-color:#0f172a;background:rgba(15,23,42,0.08);}'
      + '.gc-step2-props{border:0;border-radius:0;background:transparent;padding:0;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden;position:relative;}'
      + '.gc-prop-panel-switcher{position:sticky;top:0;z-index:3;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:0 0 6px;background:linear-gradient(180deg,#f8fafc 0,rgba(248,250,252,.9) 85%,rgba(248,250,252,0) 100%);backdrop-filter:saturate(120%) blur(2px);}'
      + '.gc-prop-tab-btn{height:30px;border:1px solid #ccd6e2;border-radius:8px;background:#ffffff;color:#334155;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;transition:all .16s ease;}'
      + '.gc-prop-tab-btn:hover{border-color:#7a97b9;background:#edf4fb;color:#0f172a;}'
      + '.gc-prop-tab-btn.is-active{border-color:#2563eb;background:#dbeafe;color:#1d4ed8;box-shadow:0 0 0 1px rgba(37,99,235,.15);}'
      + '.gc-panel-toggle-btn{height:28px;min-width:28px;padding:0 8px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#334155;display:inline-flex;align-items:center;justify-content:center;gap:5px;font-size:11px;font-weight:700;cursor:pointer;}'
      + '.gc-panel-toggle-btn.is-active{border-color:#2563eb;background:#dbeafe;color:#1d4ed8;}'
      + '.gc-prop-panel{border:1px solid #d4deea;border-radius:12px;background:linear-gradient(180deg,#ffffff 0,#f7fbff 100%);padding:10px;display:flex;flex-direction:column;gap:8px;min-height:0;}'
      + '.gc-prop-panel.gc-prop-panel-floating{box-shadow:0 12px 24px rgba(15,23,42,.12);transform:translateY(0);opacity:1;transition:opacity .18s ease,transform .18s ease;position:sticky;top:0;height:100%;overflow:hidden;}'
      + '.gc-prop-panel-title{font-size:10px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:8px;border-bottom:1px solid #e6edf6;}'
      + '.gc-prop-panel-title i{opacity:.8;}'
      + '.gc-prop-panel-body{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0;overflow:auto;padding-right:2px;}'
      + '.gc-prop-empty{font-size:11px;color:#64748b;padding:12px 9px;border:1px dashed #c5d1de;border-radius:10px;background:linear-gradient(180deg,#f8fafc,#f1f5f9);}'
      + '.gc-layer-stack-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;}'
      + '.gc-layer-stack-actions .btn{height:28px;padding:0 8px;font-size:11px;line-height:1;}'
      + '.gc-layer-list{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto;padding-right:2px;}'
      + '.gc-layer-item{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:6px;padding:5px 6px;border:1px solid #dbe2ea;border-radius:5px;background:#ffffff;cursor:grab;}'
      + '.gc-layer-item.is-selected{border-color:#2563eb;background:#eff6ff;}'
      + '.gc-layer-item.is-hidden{opacity:.55;}'
      + '.gc-layer-item.is-locked{border-style:dashed;}'
      + '.gc-layer-item-label-btn{display:flex;align-items:center;gap:6px;min-width:0;background:transparent;border:0;padding:0;color:#0f172a;font-size:11px;font-weight:700;cursor:pointer;text-align:left;}'
      + '.gc-layer-item-label-btn .gc-layer-item-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.gc-layer-item-meta{font-size:10px;color:#64748b;font-weight:700;white-space:nowrap;}'
      + '.gc-layer-item-icon-btn{width:26px;height:26px;border:1px solid #cbd5e1;border-radius:4px;background:#f8fafc;color:#334155;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;}'
      + '.gc-layer-item-icon-btn.is-active{border-color:#2563eb;background:#dbeafe;color:#1d4ed8;}'
      + '.gc-layer-item-icon-btn.is-off{opacity:.65;}'
      + '.gc-layer-item.is-drag-over{outline:2px solid rgba(37,99,235,.45);outline-offset:1px;}'
      + '.gc-prop-section-title{font-size:10px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:.05em;margin:2px 0;}'
      + '.gc-prop-group{display:flex;flex-direction:column;gap:4px;}'
      + '.gc-prop-group label{font-size:11px;font-weight:700;color:#334155;}'
      + '.gc-prop-input,.gc-prop-select{height:30px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;padding:0 8px;font-size:11px;color:#0f172a;}'
      + '.gc-prop-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}'
      + '.gc-prop-note{font-size:11px;color:#64748b;line-height:1.35;}'
      + '.gc-prop-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}'
      + '.gc-prop-actions .btn{height:28px;padding:0 8px;font-size:11px;line-height:1;}'
      + '.gc-prop-actions.gc-prop-actions-icons{gap:4px;}'
      + '.gc-prop-icon-btn{min-width:30px;padding:0 7px;display:inline-flex;align-items:center;justify-content:center;gap:4px;}'
      + '.gc-prop-icon-btn i{font-size:11px;line-height:1;}'
      + '.gc-prop-icon-btn.is-active{border-color:#2563eb;background:#dbeafe;color:#1d4ed8;}'
      + '.gc-step2-report-overlay{position:fixed;inset:0;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;padding:20px;z-index:16000;}'
      + '.gc-step2-report-modal{width:min(980px,96vw);max-height:min(86vh,820px);display:flex;flex-direction:column;border:1px solid #dbe2ea;border-radius:10px;background:#ffffff;box-shadow:0 24px 60px rgba(2,8,23,.34);overflow:hidden;}'
      + '.gc-step2-report-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid #e2e8f0;background:#f8fbff;}'
      + '.gc-step2-report-title{font-size:13px;font-weight:800;color:#0f172a;}'
      + '.gc-step2-report-summary{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-bottom:1px solid #e2e8f0;background:#ffffff;}'
      + '.gc-step2-report-pill{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:999px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;font-size:11px;font-weight:700;}'
      + '.gc-step2-report-grid{padding:10px 12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;overflow:auto;min-height:0;}'
      + '.gc-step2-report-card{border:1px solid #dbe2ea;border-radius:8px;background:#ffffff;padding:8px;display:flex;flex-direction:column;gap:5px;min-height:120px;}'
      + '.gc-step2-report-card-title{font-size:11px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:.04em;}'
      + '.gc-step2-report-row{display:flex;align-items:center;gap:6px;min-height:24px;padding:3px 5px;border-radius:6px;background:#f8fafc;color:#334155;font-size:11px;line-height:1.25;}'
      + '.gc-step2-report-lbl{font-weight:700;color:#1f2937;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.gc-step2-report-arrow{opacity:.65;}'
      + '.gc-step2-report-field{font-weight:700;color:#1d4ed8;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.gc-step2-report-meta{color:#64748b;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.gc-step2-report-empty{font-size:11px;color:#94a3b8;padding:4px 2px;}'
      + '.gc-step2-report-more{font-size:11px;color:#64748b;padding:2px 2px 0;}'
      + '.gc-save-template-overlay{position:fixed;inset:0;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;padding:20px;z-index:16100;}'
      + '.gc-save-template-modal{width:min(460px,94vw);border:1px solid #dbe2ea;border-radius:10px;background:#ffffff;box-shadow:0 24px 60px rgba(2,8,23,.34);padding:14px;display:flex;flex-direction:column;gap:8px;}'
      + '.gc-save-template-title{font-size:16px;font-weight:800;color:#0f172a;line-height:1.2;}'
      + '.gc-save-template-subtitle{font-size:12px;color:#64748b;line-height:1.35;}'
      + '.gc-save-template-label{font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.04em;}'
      + '.gc-save-template-input{height:34px;border:1px solid #cbd5e1;border-radius:6px;padding:0 10px;font-size:12px;color:#0f172a;}'
      + '.gc-save-template-input:focus{outline:2px solid rgba(37,99,235,.25);outline-offset:1px;border-color:#2563eb;}'
      + '.gc-save-template-error{font-size:11px;color:#b91c1c;font-weight:700;}'
      + '.gc-save-template-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;}'
      + '.gc-step-panel-step2 .gc-actions{margin-top:auto;padding:8px 10px 10px;position:sticky;bottom:0;background:#f8fafc;z-index:1;}'
      + '.gc-step-panel.gc-step-panel-step3{width:100%;max-width:none;margin:0;border-radius:4px;padding:4px 0 0;display:flex;flex-direction:column;gap:6px;min-height:100%;background:#f8fafc;}'
      + '.gc-step-panel-step3 .gc-step-title,.gc-step-panel-step3 .gc-step-subtitle{padding:0 10px;}'
      + '.gc-step3-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;padding:6px 10px;border-top:1px solid #dbe2ea;border-bottom:1px solid #dbe2ea;background:#fbfdff;}'
      + '.gc-step3-summary .gc-summary-item{border:1px solid #dbe2ea;border-radius:4px;background:#ffffff;padding:7px 9px;}'
      + '.gc-step3-summary .gc-summary-label{font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}'
      + '.gc-step3-summary .gc-summary-value{font-size:13px;color:#0f172a;font-weight:700;margin-top:3px;}'
      + '.gc-step3-preview-area{display:flex;flex-direction:column;gap:8px;padding:0 10px;}'
      + '.gc-step3-preview-frame-wrap{width:100%;min-height:320px;height:min(68vh,760px);border:1px solid #dbe2ea;border-radius:8px;background:#ffffff;overflow:hidden;}'
      + '.gc-step3-preview-frame{width:100%;height:100%;border:0;display:block;background:#ffffff;}'
      + '.gc-step-panel-step3 .gc-preview-grid{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;justify-content:flex-start;padding:0 10px;}'
      + '.gc-step-panel-step3 .gc-preview-card{width:auto;max-width:none;padding:5px;border-radius:4px;background:#ffffff;border:1px solid #dbe2ea;}'
      + '.gc-step-panel-step3 .gc-preview-head{font-size:11px;}'
      + '.gc-step-panel-step3 .gc-preview-box{border-radius:2px;}'
      + '.gc-step-panel-step3 .gc-preview-box.gc-mm-landscape{width:79mm;max-width:100%;height:auto;aspect-ratio:1.526/1;}'
      + '.gc-step-panel-step3 .gc-preview-box.gc-mm-portrait{width:52mm;max-width:100%;height:auto;aspect-ratio:1/1.526;}'
      + '.gc-step-panel-step3 .gc-actions{margin-top:auto;padding:8px 10px 10px;position:sticky;bottom:0;background:#f8fafc;z-index:1;}'
      + '@media (max-width:1180px){.gc-flow-header{grid-template-columns:minmax(0,1fr) auto;}.gc-header-stepper{grid-column:1 / -1;order:3;overflow-x:auto;padding-bottom:2px;}.gc-step1-topbar{flex-wrap:wrap;align-items:flex-start;}.gc-inline-controls{flex:1 1 100%;flex-wrap:wrap;}.gc-inline-group.gc-inline-group-selection{align-items:flex-start;text-align:left;margin-left:0;min-width:0;}}'
      + '@media (max-width:860px){.gc-step1-upload-row{grid-template-columns:1fr;}.gc-upload-input-wrap{flex-wrap:wrap;}.gc-inline-controls{gap:8px;flex:1 1 100%;flex-wrap:wrap;}.gc-step1-topbar{align-items:flex-start;flex-wrap:wrap;}.gc-inline-control-block.gc-inline-template-block{min-width:100% !important;max-width:none !important;width:100% !important;flex:1 1 100% !important;}.gc-inline-template-row .gc-select,.gc-inline-template-row .unified-select-dropdown{min-width:0;max-width:none;flex:1 1 auto;}.gc-inline-group.gc-inline-group-selection{margin-left:0;align-items:flex-start;text-align:left;min-width:100%;}.gc-inline-value.gc-inline-count-value{justify-content:flex-start;}#gcTemplateSelectStep1__options,#gcTemplateSelectStep1__options.usd-portaled{min-width:0 !important;width:min(calc(100vw - 24px),420px) !important;max-width:min(calc(100vw - 24px),420px) !important;}.gc-step2-main{grid-template-columns:1fr;}.gc-step2-tools{flex-direction:row;flex-wrap:wrap;padding:6px;justify-content:flex-start;}.gc-step2-tool-btn{width:44px;height:44px;}.gc-step2-canvas-head{grid-template-columns:1fr;}.gc-step2-center-controls{justify-self:stretch;justify-content:flex-start;}.gc-step2-canvas-stage{min-height:240px;padding:10px;}.gc-step2-props{order:2;}.gc-prop-panel-switcher{grid-template-columns:1fr 1fr;}.gc-prop-panel.gc-prop-panel-floating{height:auto;max-height:420px;}.gc-step2-report-grid{grid-template-columns:1fr;}.gc-step2-report-modal{max-height:88vh;}.gc-step-panel-step3 .gc-preview-box.gc-mm-landscape{width:min(100%,340px);}.gc-step-panel-step3 .gc-preview-box.gc-mm-portrait{width:min(100%,220px);}.gc-step3-summary{grid-template-columns:1fr 1fr;}.gc-step3-preview-frame-wrap{height:420px;}.gc-actions{align-items:flex-start;}.gc-actions-meta{max-width:58%;}.gc-actions-right{margin-left:auto;justify-content:flex-end;}}';

    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    var node = document.createElement('div');
    node.textContent = String(value || '');
    return node.innerHTML;
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  function hexToRgbaString(value, alpha, fallbackHex) {
    var fallback = String(fallbackHex || '#2563eb').trim();
    var raw = String(value || '').trim();
    var src = raw || fallback;
    var hex = src.charAt(0) === '#' ? src.slice(1) : src;
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      hex = hex.charAt(0) + hex.charAt(0)
        + hex.charAt(1) + hex.charAt(1)
        + hex.charAt(2) + hex.charAt(2);
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
      hex = '2563eb';
    }
    var a = Number(alpha);
    if (!Number.isFinite(a)) {
      a = 0.14;
    }
    a = Math.max(0, Math.min(1, a));
    var r = parseInt(hex.slice(0, 2), 16);
    var g = parseInt(hex.slice(2, 4), 16);
    var b = parseInt(hex.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function parseFilename(disposition, fallback) {
    if (!disposition) {
      return fallback;
    }

    var match = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
    if (!match || !match[1]) {
      return fallback;
    }

    try {
      return decodeURIComponent(match[1]);
    } catch (_err) {
      return match[1];
    }
  }

  function getCSRFToken() {
    if (typeof window.getCSRFToken === 'function') {
      return window.getCSRFToken();
    }
    var input = document.querySelector('[name=csrfmiddlewaretoken]');
    return input ? input.value : '';
  }

  function showToast(message, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type || 'info');
      return;
    }
    console.log('[GenerateCards][' + (type || 'info') + ']', message);
  }

  function setAlert(message, kind) {
    if (!message) {
      return;
    }
    showToast(String(message), kind === 'error' ? 'error' : 'warning');
  }

  function setStepCounter() {
    if (stepCounterEl) {
      stepCounterEl.textContent = 'Step ' + String(state.step) + ' of 3';
    }

    if (headerStepperEl) {
      var stepNodes = headerStepperEl.querySelectorAll('[data-step]');
      Array.prototype.forEach.call(stepNodes, function (node) {
        var stepNum = Number(node.getAttribute('data-step') || 0);
        var isActive = stepNum === state.step;
        var isDone = stepNum > 0 && stepNum < state.step;
        node.classList.toggle('is-active', isActive);
        node.classList.toggle('is-done', isDone);
      });
    }

    syncHeaderActionButtons();
  }

  function syncHeaderActionButtons() {
    var showStep2Actions = state.step === 2;

    if (headerSaveTemplateBtnEl) {
      headerSaveTemplateBtnEl.classList.toggle('hidden', !showStep2Actions);
      headerSaveTemplateBtnEl.disabled = !!state.loading;
      headerSaveTemplateBtnEl.textContent = state.loading ? 'Saving...' : 'Save (This Table)';
    }
  }

  function normalizeOrientation(value) {
    return value === 'portrait' ? 'portrait' : 'landscape';
  }

  function templatesPath(refId) {
    return '/api/templates/' + Number(refId) + '/';
  }

  function templateDetailPath(templateId) {
    return '/api/template/' + Number(templateId) + '/';
  }

  function templateSetDefaultPath(templateId) {
    return '/api/template/' + Number(templateId) + '/set-default/';
  }

  function cardsPath() {
    return '/api/generate-card/table/' + TABLE_ID + '/cards/?limit=500';
  }

  function generatePath() {
    return '/api/generate-card/table/' + TABLE_ID + '/generate/';
  }

  function uploadPdfPath(side) {
    return '/api/generate-card/table/' + TABLE_ID + '/template/upload-pdf/' + side + '/';
  }

  function clearPdfPath(side) {
    return '/api/generate-card/table/' + TABLE_ID + '/template/clear-pdf/' + side + '/';
  }

  function staticAssetPath(path) {
    var base = typeof window.STATIC_URL === 'string' && window.STATIC_URL
      ? window.STATIC_URL
      : '/static/';
    if (!/\/$/.test(base)) {
      base += '/';
    }
    return base + String(path || '').replace(/^\/+/, '');
  }

  function ensurePdfJsReady() {
    if (window.pdfjsLib && typeof window.pdfjsLib.getDocument === 'function') {
      if (window.pdfjsLib.GlobalWorkerOptions) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = staticAssetPath('js/vendor/pdf.worker.min.js');
      }
      return Promise.resolve(window.pdfjsLib);
    }

    if (pdfJsLoadPromise) {
      return pdfJsLoadPromise;
    }

    pdfJsLoadPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = staticAssetPath('js/vendor/pdf.min.js');
      script.async = true;
      script.onload = function () {
        if (window.pdfjsLib && typeof window.pdfjsLib.getDocument === 'function') {
          if (window.pdfjsLib.GlobalWorkerOptions) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = staticAssetPath('js/vendor/pdf.worker.min.js');
          }
          resolve(window.pdfjsLib);
          return;
        }
        reject(new Error('Unable to initialize PDF preview renderer.'));
      };
      script.onerror = function () {
        reject(new Error('Unable to load PDF preview renderer.'));
      };
      document.head.appendChild(script);
    });

    return pdfJsLoadPromise;
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

  async function requestForm(path, formData) {
    var lastError = null;

    for (var i = 0; i < apiBases.length; i += 1) {
      var url = apiBases[i] + path;
      try {
        var resp = await fetch(url, {
          method: 'POST',
          headers: {
            'X-CSRFToken': getCSRFToken(),
          },
          body: formData,
        });

        if (resp.status === 404 && i < (apiBases.length - 1)) {
          continue;
        }

        var payload = null;
        try {
          payload = await resp.json();
        } catch (_err) {
          payload = null;
        }

        if (!resp.ok || (payload && payload.status === 'error')) {
          throw new Error((payload && payload.message) || ('Upload failed (HTTP ' + resp.status + ')'));
        }

        return payload || { status: 'ok' };
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error('Upload failed');
  }

  async function requestBinary(path, body) {
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
        if (!resp.ok || contentType.indexOf('application/json') !== -1) {
          var data = null;
          try {
            data = await resp.json();
          } catch (_err) {
            data = null;
          }
          throw new Error((data && data.message) || ('Generation failed (HTTP ' + resp.status + ')'));
        }

        return {
          blob: await resp.blob(),
          filename: parseFilename(resp.headers.get('Content-Disposition'), 'cards.pdf'),
        };
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error('Generation failed');
  }

  function downloadBlob(blob, filename) {
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename || 'cards.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
      URL.revokeObjectURL(link.href);
    }, 3000);
  }

  function revokeLocalPreview(side) {
    var existing = state.localPreviewUrls[side];
    if (!existing) {
      return;
    }
    try {
      URL.revokeObjectURL(existing);
    } catch (_err) {
      // Ignore URL revocation issues.
    }
    state.localPreviewUrls[side] = '';
  }

  function resetTransientState() {
    revokeLocalPreview('front');
    revokeLocalPreview('back');
    if (state.previewPdfUrl) {
      try {
        URL.revokeObjectURL(state.previewPdfUrl);
      } catch (_previewErr) {
        // Ignore preview URL cleanup failures.
      }
      state.previewPdfUrl = '';
    }
    state.previewPdfBlob = null;
    state.previewPdfName = 'preview_cards.pdf';
    state.frontFile = null;
    state.backFile = null;
    state.lastPdfBlob = null;
    state.lastPdfName = 'cards.pdf';
  }

  function defaultTemplateJson() {
    return {
      canvas: {
        width: 350,
        height: 200,
        guides: [],
      },
      elements: [],
    };
  }

  function currentTemplateJson() {
    if (state.templateDraft && typeof state.templateDraft === 'object') {
      return state.templateDraft;
    }
    if (!state.selectedTemplate || typeof state.selectedTemplate !== 'object') {
      return defaultTemplateJson();
    }
    var raw = state.selectedTemplate.template_json;
    if (!raw || typeof raw !== 'object') {
      return defaultTemplateJson();
    }
    if (!Array.isArray(raw.elements)) {
      raw.elements = [];
    }
    if (!raw.canvas || typeof raw.canvas !== 'object') {
      raw.canvas = { width: 350, height: 200 };
    }
    return raw;
  }

  function defaultStep2Zoom() {
    return state.isTwoSided ? 1.75 : 2;
  }

  function resetStep2DraftState() {
    cancelDraftPointerMoveFrame();
    draftPointerMoveSnapshot = null;

    state.templateDraft = null;
    state.templateDraftName = '';
    state.draftSelectedElementId = '';
    state.draftSelectedElementIds = new Set();
    state.draftInlineEditingElementId = '';
    state.draftPendingTextEdit = null;
    state.draftSelectedGuideId = '';
    state.draftGuidesLocked = false;
    state.draftMergePreview = false;
    state.draftAutoMapScope = 'active';
    state.draftAutoMapReport = null;
    state.draftAutoMapReportOpen = false;
    state.draftSaveModalOpen = false;
    state.draftSaveTemplateName = '';
    state.draftSaveTemplateError = '';
    state.draftActiveSide = 'front';
    state.draftAlignReference = 'selection';
    state.draftDistributeMode = 'spacing';
    state.draftKeyObjectId = '';
    state.draftAlignPreviewMode = '';
    state.draftTool = 'select';
    state.draftDragging = null;
    state.draftResizeDragging = null;
    state.draftGuideDragging = null;
    state.draftTextDrag = null;
    state.draftRectDrag = null;
    state.draftSelectDrag = null;
    state.draftLayerDragId = '';
    state.draftZoom = defaultStep2Zoom();
    state.draftZoomOriginX = 50;
    state.draftZoomOriginY = 50;
    state.draftLastPointerClientX = null;
    state.draftLastPointerClientY = null;
    state.draftUnit = 'mm';
    state.draftSnapMm = 0.1;
    state.draftDirty = false;
    state.draftHistory = {
      undo: [],
      redo: [],
      applying: false,
      inTxn: false,
      txnCaptured: false,
      maxDepth: 15,
      lastSig: '',
    };
    state.draftInlineEditHistoryActive = false;
  }

  function ensureDraftHistoryState() {
    if (!historyService) {
      if (!window.GcEditorHistoryService || typeof window.GcEditorHistoryService.create !== 'function') {
        if (!state.draftHistory || typeof state.draftHistory !== 'object') {
          state.draftHistory = {
            undo: [],
            redo: [],
            applying: false,
            inTxn: false,
            txnCaptured: false,
            maxDepth: 15,
            lastSig: '',
          };
        }
        return state.draftHistory;
      }
      historyService = window.GcEditorHistoryService.create({
        state: state,
        defaultTemplateJson: defaultTemplateJson,
        deepCloneJson: deepCloneJson,
        normalizeDraftAlignReference: normalizeDraftAlignReference,
        normalizeDraftDistributeMode: normalizeDraftDistributeMode,
        normalizeOrientation: normalizeOrientation,
        normalizeDraftSnapMm: normalizeDraftSnapMm,
        setDraftZoom: setDraftZoom,
        normalizeDraftElementZOrder: normalizeDraftElementZOrder,
        normalizeDraftElementSelection: normalizeDraftElementSelection,
        clearDraftInlineTextEditing: clearDraftInlineTextEditing,
        syncDraftToSelectedTemplate: syncDraftToSelectedTemplate,
        ensureStep2DraftInitialized: ensureStep2DraftInitialized,
        selectedDraftElementSet: selectedDraftElementSet,
        currentDraftUnit: currentDraftUnit,
      });
    }
    return historyService.ensureDraftHistoryState();
  }

  function draftHistorySnapshot() {
    ensureDraftHistoryState();
    return historyService.draftHistorySnapshot();
  }

  function draftHistorySignature(snapshot) {
    ensureDraftHistoryState();
    return historyService.draftHistorySignature(snapshot);
  }

  function captureDraftHistoryPoint() {
    ensureDraftHistoryState();
    return historyService.captureDraftHistoryPoint();
  }

  function beginDraftHistoryTransaction() {
    ensureDraftHistoryState();
    return historyService.beginDraftHistoryTransaction();
  }

  function endDraftHistoryTransaction() {
    ensureDraftHistoryState();
    return historyService.endDraftHistoryTransaction();
  }

  function prepareDraftHistoryMutation() {
    ensureDraftHistoryState();
    return historyService.prepareDraftHistoryMutation();
  }

  function applyDraftHistorySnapshot(snapshot) {
    ensureDraftHistoryState();
    return historyService.applyDraftHistorySnapshot(snapshot);
  }

  function undoDraftHistory() {
    ensureDraftHistoryState();
    return historyService.undoDraftHistory();
  }

  function redoDraftHistory() {
    ensureDraftHistoryState();
    return historyService.redoDraftHistory();
  }

  function deepCloneJson(value, fallback) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_err) {
      return fallback;
    }
  }

  function templateJsonForApi(templateJson) {
    var fallback = defaultTemplateJson();
    var clean = deepCloneJson(templateJson, fallback) || fallback;

    if (!clean.canvas || typeof clean.canvas !== 'object') {
      clean.canvas = { width: 350, height: 200 };
    }
    if (!Array.isArray(clean.elements)) {
      clean.elements = [];
    }

    clean.elements = clean.elements
      .filter(function (item) { return item && typeof item === 'object'; })
      .map(function (item) {
        var out = {};
        Object.keys(item).forEach(function (key) {
          if (key !== '__id') {
            out[key] = item[key];
          }
        });
        return out;
      });

    return clean;
  }

  function draftCanvasMetrics() {
    var tpl = currentTemplateJson();
    var canvas = tpl && tpl.canvas && typeof tpl.canvas === 'object' ? tpl.canvas : {};
    var width = Number(canvas.width || 350);
    var height = Number(canvas.height || 200);

    if (!Number.isFinite(width) || width <= 0) {
      width = 350;
    }
    if (!Number.isFinite(height) || height <= 0) {
      height = 200;
    }

    return { width: width, height: height };
  }

  function normalizeDraftEditorSide(value) {
    return String(value || '').toLowerCase() === 'back' ? 'back' : 'front';
  }

  function draftCanvasLayoutMetrics(metrics) {
    var cardMetrics = metrics || draftCanvasMetrics();
    var cardWidth = Math.max(1, Number(cardMetrics.width || 1));
    var cardHeight = Math.max(1, Number(cardMetrics.height || 1));
    var sideCount = state.isTwoSided ? 2 : 1;

    return {
      cardWidth: cardWidth,
      cardHeight: cardHeight,
      sideCount: sideCount,
      totalWidth: cardWidth * sideCount,
      totalHeight: cardHeight,
    };
  }

  function draftElementRenderSides(item) {
    var side = normalizeDraftEditorSide(item && item.side);
    if (String(item && item.side || '').toLowerCase() === 'both') {
      return state.isTwoSided ? ['front', 'back'] : ['front'];
    }
    if (!state.isTwoSided && side === 'back') {
      return [];
    }
    return [side];
  }

  function draftCanvasDisplayInfo(metrics) {
    var m = metrics || draftCanvasMetrics();
    var real = draftRealDimensionsMm();

    var widthPx = Number(real.widthMm || 0) * (96 / 25.4);
    var heightPx = Number(real.heightMm || 0) * (96 / 25.4);
    if (!Number.isFinite(widthPx) || widthPx <= 0) {
      widthPx = Number(m.width || 1);
    }
    if (!Number.isFinite(heightPx) || heightPx <= 0) {
      heightPx = Number(m.height || 1);
    }

    widthPx = Math.max(1, Math.min(6000, widthPx));
    heightPx = Math.max(1, Math.min(6000, heightPx));

    var scaleX = widthPx / Math.max(1, Number(m.width || 1));
    var scaleY = heightPx / Math.max(1, Number(m.height || 1));

    if (!Number.isFinite(scaleX) || scaleX <= 0) {
      scaleX = 1;
    }
    if (!Number.isFinite(scaleY) || scaleY <= 0) {
      scaleY = 1;
    }

    return {
      widthPx: widthPx,
      heightPx: heightPx,
      scaleX: scaleX,
      scaleY: scaleY,
    };
  }

  function defaultRealDimensionsMmForOrientation(orientation) {
    var safe = normalizeOrientation(orientation);
    if (safe === 'portrait') {
      return { widthMm: 57, heightMm: 87 };
    }
    return { widthMm: 87, heightMm: 57 };
  }

  function draftReferenceOrientation(metrics) {
    var m = metrics || draftCanvasMetrics();
    var width = Number(m.width || 0);
    var height = Number(m.height || 0);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      if (height > (width * 1.02)) {
        return 'portrait';
      }
      if (width > (height * 1.02)) {
        return 'landscape';
      }
    }
    return normalizeOrientation(state.orientation || 'landscape');
  }

  function normalizeRealDimensionsMm(widthMm, heightMm, orientation) {
    var safeOrientation = normalizeOrientation(orientation || state.orientation || 'landscape');
    var defaults = defaultRealDimensionsMmForOrientation(safeOrientation);

    var w = Number(widthMm);
    var h = Number(heightMm);
    if (!Number.isFinite(w) || w <= 0) {
      w = defaults.widthMm;
    }
    if (!Number.isFinite(h) || h <= 0) {
      h = defaults.heightMm;
    }

    if (safeOrientation === 'portrait' && w > h) {
      var portraitSwap = w;
      w = h;
      h = portraitSwap;
    }
    if (safeOrientation === 'landscape' && h > w) {
      var landscapeSwap = h;
      h = w;
      w = landscapeSwap;
    }

    return { widthMm: w, heightMm: h };
  }

  function draftRealDimensionsMm() {
    var tpl = currentTemplateJson();
    var canvas = tpl && tpl.canvas && typeof tpl.canvas === 'object' ? tpl.canvas : {};
    var metrics = draftCanvasMetrics();
    var orientation = draftReferenceOrientation(metrics);
    var widthMm = Number(canvas.realWidthMM);
    var heightMm = Number(canvas.realHeightMM);
    return normalizeRealDimensionsMm(widthMm, heightMm, orientation);
  }

  function nextDraftGuideId() {
    draftGuideSeed += 1;
    return 'g' + String(Date.now()) + '_' + String(draftGuideSeed);
  }

  function normalizeDraftGuide(raw) {
    var metrics = draftCanvasMetrics();
    var item = raw && typeof raw === 'object' ? raw : {};
    var axis = String(item.axis || 'x').toLowerCase();
    if (axis !== 'x' && axis !== 'y') {
      axis = 'x';
    }

    var pos = Number(item.pos || 0);
    if (!Number.isFinite(pos)) {
      pos = 0;
    }

    var span = axis === 'x' ? metrics.width : metrics.height;
    var min = 0;
    var max = span;
    pos = Math.max(min, Math.min(max, pos));

    return {
      id: String(item.id || nextDraftGuideId()),
      axis: axis,
      pos: pos,
    };
  }

  function draftGuides() {
    ensureStep2DraftInitialized();
    var canvas = state.templateDraft && state.templateDraft.canvas && typeof state.templateDraft.canvas === 'object'
      ? state.templateDraft.canvas
      : null;
    if (!canvas) {
      return [];
    }
    if (!Array.isArray(canvas.guides)) {
      canvas.guides = [];
    }
    return canvas.guides;
  }

  function selectedDraftGuide() {
    var guides = draftGuides();
    return guides.find(function (item) {
      return item && String(item.id || '') === state.draftSelectedGuideId;
    }) || null;
  }

  function addDraftGuide(axis, pos) {
    var guides = draftGuides();
    prepareDraftHistoryMutation();
    var guide = normalizeDraftGuide({ axis: axis, pos: pos });
    guides.push(guide);
    state.draftSelectedGuideId = guide.id;
    markDraftDirty();
    return guide.id;
  }

  function updateDraftGuidePosition(id, pos) {
    var guides = draftGuides();
    var target = guides.find(function (item) {
      return item && String(item.id || '') === String(id || '');
    });
    if (!target) {
      return false;
    }
    prepareDraftHistoryMutation();
    var normalized = normalizeDraftGuide({ id: target.id, axis: target.axis, pos: pos });
    target.pos = normalized.pos;
    markDraftDirty();
    return true;
  }

  function removeDraftGuideById(id) {
    var guides = draftGuides();
    var before = guides.length;
    var wanted = String(id || '');
    prepareDraftHistoryMutation();
    state.templateDraft.canvas.guides = guides.filter(function (item) {
      return String(item && item.id || '') !== wanted;
    });
    if (state.draftSelectedGuideId === wanted) {
      state.draftSelectedGuideId = '';
    }
    if (state.templateDraft.canvas.guides.length !== before) {
      markDraftDirty();
      return true;
    }
    return false;
  }

  function renderDraftGuidesHtml(options) {
    options = options || {};
    var metrics = draftCanvasMetrics();
    var layout = draftCanvasLayoutMetrics(metrics);
    var guides = draftGuides();
    if (!guides.length) {
      return '';
    }

    var canvasLeft = Number(options.canvasLeft || 0);
    var canvasTop = Number(options.canvasTop || 0);
    var canvasWidth = Number(options.canvasWidth || metrics.width);
    var canvasHeight = Number(options.canvasHeight || metrics.height);
    var layerWidth = Number(options.layerWidth || canvasWidth);
    var layerHeight = Number(options.layerHeight || canvasHeight);
    var outside = !!options.outside;
    var activeSide = normalizeDraftEditorSide(state.draftActiveSide);
    if (!state.isTwoSided) {
      activeSide = 'front';
    }
    var sideStart = state.isTwoSided && activeSide === 'back' ? (canvasWidth / 2) : 0;
    var sideWidth = state.isTwoSided ? (canvasWidth / 2) : canvasWidth;

    return guides.map(function (guide) {
      var isVertical = guide.axis === 'x';
      var ratio = Number(guide.pos || 0) / (isVertical ? Math.max(1, layout.cardWidth) : Math.max(1, layout.cardHeight));
      var posPx = ratio * (isVertical ? sideWidth : canvasHeight);
      var cls = 'gc-draft-guide ' + (isVertical ? 'is-vertical' : 'is-horizontal')
        + (String(guide.id || '') === state.draftSelectedGuideId ? ' is-selected' : '');
      var style = isVertical
        ? 'left:' + String(canvasLeft + sideStart + posPx) + 'px;top:' + String(outside ? 0 : canvasTop) + 'px;height:' + String(outside ? layerHeight : canvasHeight) + 'px;'
        : 'top:' + String(canvasTop + posPx) + 'px;left:' + String(outside ? 0 : canvasLeft) + 'px;width:' + String(outside ? layerWidth : canvasWidth) + 'px;';

      return '<button type="button" class="' + cls + '" data-action="select-draft-guide" data-guide-id="' + escapeAttr(String(guide.id || '')) + '" style="' + style + '"></button>';
    }).join('');
  }

  function currentDraftUnit() {
    var unit = String(state.draftUnit || 'mm').toLowerCase();
    if (unit !== 'mm' && unit !== 'cm' && unit !== 'in') {
      unit = 'mm';
    }
    return unit;
  }

  function setDraftZoom(value) {
    var next = Number(value || 1);
    if (!Number.isFinite(next)) {
      next = 1;
    }
    state.draftZoom = Math.max(DRAFT_ZOOM_MIN, Math.min(DRAFT_ZOOM_MAX, next));
  }

  function applyZoomFactor(factor, anchorEvent) {
    var safeFactor = Number(factor || 1);
    if (!Number.isFinite(safeFactor) || safeFactor <= 0) {
      return;
    }
    var current = Number(state.draftZoom || 1);
    if (!Number.isFinite(current) || current <= 0) {
      current = 1;
    }
    setDraftZoomWithAnchor(current * safeFactor, anchorEvent || null);
  }

  function applySmoothZoomFromWheel(event) {
    if (!event) {
      return;
    }

    var deltaY = Number(event.deltaY || 0);
    if (!Number.isFinite(deltaY) || deltaY === 0) {
      return;
    }

    var factor = Math.exp(-deltaY * 0.0022);
    applyZoomFactor(factor, event);
  }

  function applyDefaultStep2Viewport() {
    setDraftZoom(defaultStep2Zoom());
    state.draftZoomOriginX = 50;
    state.draftZoomOriginY = 50;
  }

  function canvasValueToUnit(value, axis) {
    var v = Number(value || 0);
    if (!Number.isFinite(v)) {
      v = 0;
    }

    var unit = currentDraftUnit();
    var metrics = draftCanvasMetrics();
    var real = draftRealDimensionsMm();
    var mmPerPx = axis === 'y'
      ? (real.heightMm / Math.max(1, metrics.height))
      : (real.widthMm / Math.max(1, metrics.width));
    var mmValue = v * mmPerPx;

    if (unit === 'mm') return mmValue;
    if (unit === 'cm') return mmValue / 10;
    if (unit === 'in') return mmValue / 25.4;
    return v;
  }

  function unitValueToCanvas(value, axis) {
    var v = Number(value || 0);
    if (!Number.isFinite(v)) {
      v = 0;
    }

    var unit = currentDraftUnit();
    var metrics = draftCanvasMetrics();
    var real = draftRealDimensionsMm();
    var pxPerMm = axis === 'y'
      ? (metrics.height / Math.max(1, real.heightMm))
      : (metrics.width / Math.max(1, real.widthMm));

    if (unit === 'cm') {
      v = v * 10;
    } else if (unit === 'in') {
      v = v * 25.4;
    }

    return v * pxPerMm;
  }

  function unitValueToMm(value) {
    var v = Number(value || 0);
    if (!Number.isFinite(v)) {
      return 0;
    }

    var unit = currentDraftUnit();
    if (unit === 'cm') {
      return v * 10;
    }
    if (unit === 'in') {
      return v * 25.4;
    }
    if (unit === 'mm') {
      return v;
    }
    return v;
  }

  function formatDraftMeasure(value, axis) {
    var converted = canvasValueToUnit(value, axis);
    return String(Math.round(converted * 100) / 100);
  }

  function formatMmLabelValue(value) {
    var num = Math.round(Number(value || 0) * 100) / 100;
    if (!Number.isFinite(num)) {
      return '0';
    }
    return String(num % 1 === 0 ? Math.round(num) : num);
  }

  function normalizeDraftSnapMm(value) {
    var v = Number(value);
    if (!Number.isFinite(v)) {
      v = 0;
    }
    v = Math.max(0, Math.min(10, v));
    return Math.round(v * 1000) / 1000;
  }

  function currentDraftSnapMm() {
    return normalizeDraftSnapMm(state.draftSnapMm);
  }

  function formatDraftSnapMm(value) {
    var num = normalizeDraftSnapMm(value);
    if (num === 0) {
      return '0';
    }
    return String(Math.round(num * 1000) / 1000);
  }

  function draftSnapStepCanvas(axis) {
    var snapMm = currentDraftSnapMm();
    if (snapMm <= 0) {
      return 0;
    }

    var metrics = draftCanvasMetrics();
    var real = draftRealDimensionsMm();
    var spanPx = axis === 'y' ? Number(metrics.height || 0) : Number(metrics.width || 0);
    var spanMm = axis === 'y' ? Number(real.heightMm || 0) : Number(real.widthMm || 0);
    if (!Number.isFinite(spanPx) || !Number.isFinite(spanMm) || spanPx <= 0 || spanMm <= 0) {
      return 0;
    }

    var step = (snapMm / spanMm) * spanPx;
    if (!Number.isFinite(step) || step <= 0) {
      return 0;
    }
    return step;
  }

  function snapCanvasValueToGrid(value, axis) {
    var v = Number(value || 0);
    if (!Number.isFinite(v)) {
      v = 0;
    }
    var step = draftSnapStepCanvas(axis);
    if (step <= 0) {
      return v;
    }
    return Math.round(v / step) * step;
  }

  var draftTextMeasureCanvas = null;

  function draftTextMeasureElement() {
    if (typeof document !== 'undefined' && draftTextMeasureNode && draftTextMeasureNode.ownerDocument === document) {
      return draftTextMeasureNode;
    }
    if (typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') {
      return null;
    }

    var node = document.createElement('span');
    node.setAttribute('aria-hidden', 'true');
    node.style.position = 'fixed';
    node.style.left = '-100000px';
    node.style.top = '-100000px';
    node.style.visibility = 'hidden';
    node.style.pointerEvents = 'none';
    node.style.whiteSpace = 'nowrap';
    node.style.display = 'inline-block';
    node.style.padding = '0';
    node.style.margin = '0';
    node.style.border = '0';
    node.style.lineHeight = '1';
    document.body.appendChild(node);
    draftTextMeasureNode = node;
    return draftTextMeasureNode;
  }

  function draftTextMeasureContext() {
    if (draftTextMeasureCanvas && typeof draftTextMeasureCanvas.getContext === 'function') {
      var existingCtx = draftTextMeasureCanvas.getContext('2d');
      if (existingCtx) {
        return existingCtx;
      }
    }

    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return null;
    }

    draftTextMeasureCanvas = document.createElement('canvas');
    if (!draftTextMeasureCanvas || typeof draftTextMeasureCanvas.getContext !== 'function') {
      return null;
    }

    return draftTextMeasureCanvas.getContext('2d');
  }

  function estimateDraftTextWidthPx(text, fontSize, fontFamily, fontWeight, fontStyle, letterSpacing) {
    var label = String(text == null ? '' : text);

    var lines = label.replace(/\r\n?/g, '\n').split('\n');
    if (!lines.length) {
      lines = [''];
    }

    var size = Number(fontSize || DRAFT_DEFAULT_FONT_PT);
    if (!Number.isFinite(size) || size <= 0) {
      size = DRAFT_DEFAULT_FONT_PT;
    }
    var sizePx = ptToPx(size);
    if (!Number.isFinite(sizePx) || sizePx <= 0) {
      sizePx = ptToPx(DRAFT_DEFAULT_FONT_PT);
    }

    var family = String(fontFamily || 'Arial');
    var weight = String(fontWeight || '400');
    var style = String(fontStyle || 'normal');
    var spacing = Number(letterSpacing || 0);
    if (!Number.isFinite(spacing)) {
      spacing = 0;
    }
    var widest = 0;

    var measureNode = draftTextMeasureElement();
    if (measureNode) {
      measureNode.style.fontFamily = family;
      measureNode.style.fontWeight = weight;
      measureNode.style.fontStyle = style;
      measureNode.style.fontSize = String(size) + 'pt';
      measureNode.style.letterSpacing = String(spacing) + 'px';
      measureNode.style.whiteSpace = 'nowrap';
      measureNode.style.lineHeight = '1';
      lines.forEach(function (line) {
        measureNode.textContent = String(line || '');
        var widthDom = Number(measureNode.getBoundingClientRect && measureNode.getBoundingClientRect().width || 0);
        if (Number.isFinite(widthDom) && widthDom > widest) {
          widest = widthDom;
        }
      });
    }

    var ctx = draftTextMeasureContext();

    if (widest <= 0 && ctx) {
      ctx.font = style + ' ' + weight + ' ' + sizePx + 'px ' + family;
      lines.forEach(function (line) {
        var metrics = ctx.measureText(String(line || ''));
        var width = Number(metrics && metrics.width || 0);
        var boxLeft = Number(metrics && metrics.actualBoundingBoxLeft || 0);
        var boxRight = Number(metrics && metrics.actualBoundingBoxRight || 0);
        var boxWidth = boxLeft + boxRight;
        if (Number.isFinite(boxWidth) && boxWidth > width) {
          width = boxWidth;
        }
        if (Number.isFinite(width) && spacing !== 0) {
          var length = String(line || '').length;
          width += spacing * Math.max(0, length - 1);
        }
        if (Number.isFinite(width) && width > widest) {
          widest = width;
        }
      });
    }

    if (widest <= 0) {
      var fallbackLongest = 0;
      lines.forEach(function (line) {
        var len = String(line || '').length;
        if (len > fallbackLongest) {
          fallbackLongest = len;
        }
      });
      widest = fallbackLongest * sizePx * 0.62;
    }

    return widest;
  }

  var DRAFT_ARTISTIC_MAX_WIDTH_MULTIPLIER = 8;
  var DRAFT_ARTISTIC_MAX_HEIGHT_MULTIPLIER = 4;
  var DRAFT_ARTISTIC_MIN_VISIBLE_PX = 8;

  function normalizeDraftTextType(value) {
    var raw = String(value || '').toLowerCase();
    return raw === 'paragraph' ? 'paragraph' : 'artistic';
  }

  function normalizeDraftAlignReference(value) {
    var raw = String(value || '').toLowerCase();
    if (raw === 'page') {
      return 'page';
    }
    if (raw === 'keyobject' || raw === 'key-object') {
      return 'keyObject';
    }
    return 'selection';
  }

  function normalizeDraftDistributeMode(value) {
    var raw = String(value || '').toLowerCase();
    if (raw === 'centers') {
      return 'centers';
    }
    if (raw === 'edges') {
      return 'edges';
    }
    return 'spacing';
  }

  function normalizeDraftElementZIndex(value, fallback) {
    var z = Number(value);
    if (!Number.isFinite(z)) {
      z = Number(fallback || 1);
    }
    if (!Number.isFinite(z) || z < 1) {
      z = 1;
    }
    return Math.max(1, Math.round(z));
  }

  function isDraftElementVisible(item) {
    return !!item && item.visible !== false;
  }

  function isDraftElementLocked(item) {
    return !!(item && item.locked === true);
  }

  function isDraftElementSelectable(item) {
    return !!item && isDraftElementVisible(item) && !isDraftElementLocked(item);
  }

  function sortDraftElementsByZIndex(elements) {
    var src = Array.isArray(elements) ? elements : [];
    return src
      .map(function (item, idx) {
        return {
          item: item,
          idx: idx,
          z: normalizeDraftElementZIndex(item && item.zIndex, idx + 1),
        };
      })
      .sort(function (a, b) {
        if (a.z !== b.z) {
          return a.z - b.z;
        }
        return a.idx - b.idx;
      })
      .map(function (entry) {
        return entry.item;
      });
  }

  function sortedDraftElements() {
    ensureStep2DraftInitialized();
    return sortDraftElementsByZIndex(state.templateDraft && state.templateDraft.elements);
  }

  function maxDraftElementZIndex() {
    var sorted = sortedDraftElements();
    if (!sorted.length) {
      return 0;
    }
    return normalizeDraftElementZIndex(sorted[sorted.length - 1] && sorted[sorted.length - 1].zIndex, sorted.length);
  }

  function normalizeDraftElementZOrder(markDirty) {
    var elements = Array.isArray(state.templateDraft && state.templateDraft.elements)
      ? state.templateDraft.elements
      : [];
    if (!elements.length) {
      return false;
    }

    var sorted = sortDraftElementsByZIndex(elements);
    var changed = false;
    var normalized = sorted.map(function (item, idx) {
      if (!item) {
        return item;
      }
      var expectedZ = idx + 1;
      var currentZ = normalizeDraftElementZIndex(item.zIndex, expectedZ);
      if (currentZ !== expectedZ || item !== elements[idx]) {
        changed = true;
      }
      var next = Object.assign({}, item);
      next.zIndex = expectedZ;
      return next;
    });

    if (!changed) {
      return false;
    }

    state.templateDraft.elements = normalized;
    normalizeDraftElementSelection();
    if (markDirty) {
      markDraftDirty();
    }
    return true;
  }

  function topDraftElementAtPoint(pointX, pointY, side, includeLocked) {
    ensureStep2DraftInitialized();
    var x = Number(pointX || 0);
    var y = Number(pointY || 0);
    var wantedSide = normalizeDraftEditorSide(side || state.draftActiveSide);
    var allowLocked = !!includeLocked;
    var items = sortedDraftElements();

    for (var i = items.length - 1; i >= 0; i -= 1) {
      var item = items[i];
      if (!item) {
        continue;
      }
      if (!isDraftElementVisible(item)) {
        continue;
      }
      if (!allowLocked && isDraftElementLocked(item)) {
        continue;
      }
      var renderSides = draftElementRenderSides(item);
      if (!renderSides.some(function (s) { return s === wantedSide; })) {
        continue;
      }
      var b = draftElementBounds(item);
      var left = Number(b.x || 0);
      var top = Number(b.y || 0);
      var right = left + Math.max(0, Number(b.width || 0));
      var bottom = top + Math.max(0, Number(b.height || 0));
      if (x >= left && x <= right && y >= top && y <= bottom) {
        return item;
      }
    }

    return null;
  }

  function isArtisticDraftText(item) {
    if (!item || String(item.type || '').toLowerCase() !== 'text') {
      return false;
    }
    return normalizeDraftTextType(item.textType || item.textMode) === 'artistic';
  }

  function clampDraftScale(value) {
    var v = Number(value || 1);
    if (!Number.isFinite(v) || v === 0) {
      v = 1;
    }
    var abs = Math.max(0.05, Math.min(50, Math.abs(v)));
    return v < 0 ? -abs : abs;
  }

  function normalizeDraftAngle(value) {
    var v = Number(value || 0);
    if (!Number.isFinite(v)) {
      return 0;
    }
    return Math.max(-360, Math.min(360, v));
  }

  function draftTextValue(item) {
    if (!item || typeof item !== 'object') {
      return '';
    }
    if (Object.prototype.hasOwnProperty.call(item, 'text')) {
      return String(item.text == null ? '' : item.text);
    }
    return String(item.label == null ? '' : item.label);
  }

  function normalizeDraftTextValue(value) {
    return String(value == null ? '' : value).replace(/\r\n?/g, '\n');
  }

  function splitDraftTextLines(value) {
    var lines = normalizeDraftTextValue(value).split('\n');
    return lines.length ? lines : [''];
  }

  function draftTextAlignOffsetX(textAlign, width) {
    var align = String(textAlign || 'left').toLowerCase();
    var w = Math.max(0, Number(width || 0));
    if (align === 'center') {
      return -(w / 2);
    }
    if (align === 'right') {
      return -w;
    }
    return 0;
  }

  function draftArtisticTransformInfo(item, widthOverride, heightOverride) {
    var baseWidth = Math.max(6, Number(widthOverride == null ? (item && item.width || 6) : widthOverride));
    var baseHeight = Math.max(10, Number(heightOverride == null ? (item && item.height || 10) : heightOverride));
    var scaleX = clampDraftScale(item && item.scaleX);
    var scaleY = clampDraftScale(item && item.scaleY);
    var rotation = normalizeDraftAngle(item && item.rotation);
    var skewX = normalizeDraftAngle(item && item.skewX);
    var skewY = normalizeDraftAngle(item && item.skewY);

    var rotationRad = rotation * (Math.PI / 180);
    var skewXRad = skewX * (Math.PI / 180);
    var skewYRad = skewY * (Math.PI / 180);
    var tanSkewX = Math.tan(skewXRad);
    var tanSkewY = Math.tan(skewYRad);
    if (!Number.isFinite(tanSkewX)) {
      tanSkewX = 0;
    }
    if (!Number.isFinite(tanSkewY)) {
      tanSkewY = 0;
    }
    tanSkewX = Math.max(-100, Math.min(100, tanSkewX));
    tanSkewY = Math.max(-100, Math.min(100, tanSkewY));

    var cosR = Math.cos(rotationRad);
    var sinR = Math.sin(rotationRad);
    var a = scaleX * (cosR - (sinR * tanSkewY));
    var b = scaleX * ((cosR * tanSkewX) - sinR);
    var c = scaleY * (sinR + (cosR * tanSkewY));
    var d = scaleY * ((sinR * tanSkewX) + cosR);

    var p1x = (a * baseWidth);
    var p1y = (c * baseWidth);
    var p2x = (b * baseHeight);
    var p2y = (d * baseHeight);
    var p3x = p1x + p2x;
    var p3y = p1y + p2y;

    var minX = Math.min(0, p1x, p2x, p3x);
    var minY = Math.min(0, p1y, p2y, p3y);
    var maxX = Math.max(0, p1x, p2x, p3x);
    var maxY = Math.max(0, p1y, p2y, p3y);

    return {
      baseWidth: baseWidth,
      baseHeight: baseHeight,
      scaleX: scaleX,
      scaleY: scaleY,
      rotation: rotation,
      skewX: skewX,
      skewY: skewY,
      a: a,
      b: b,
      c: c,
      d: d,
      minX: minX,
      minY: minY,
      maxX: maxX,
      maxY: maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      basisX: a,
      basisY: c,
    };
  }

  function measureDraftTextDimensions(item, textOverride) {
    var metrics = draftCanvasMetrics();
    var displayInfo = draftCanvasDisplayInfo(metrics);
    var displayScaleX = Number(displayInfo.scaleX || 1);
    var displayScaleY = Number(displayInfo.scaleY || 1);
    if (!Number.isFinite(displayScaleX) || displayScaleX <= 0) {
      displayScaleX = 1;
    }
    if (!Number.isFinite(displayScaleY) || displayScaleY <= 0) {
      displayScaleY = 1;
    }

    var fontSize = Number(item && item.fontSize || DRAFT_DEFAULT_FONT_PT);
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
      fontSize = DRAFT_DEFAULT_FONT_PT;
    }
    var fontSizePx = ptToPx(fontSize);
    if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) {
      fontSizePx = ptToPx(DRAFT_DEFAULT_FONT_PT);
    }
    var letterSpacing = Number(item && item.letterSpacing || 0);
    if (!Number.isFinite(letterSpacing)) {
      letterSpacing = 0;
    }

    var value = textOverride == null ? draftTextValue(item) : String(textOverride);
    var normalized = normalizeDraftTextValue(value);
    var lines = splitDraftTextLines(normalized);
    var widthPx = 0;
    lines.forEach(function (lineText) {
      var measured = estimateDraftTextWidthPx(
        lineText,
        fontSize,
        item && item.fontFamily,
        item && item.fontWeight,
        item && item.fontStyle,
        letterSpacing
      );
      if (Number.isFinite(measured) && measured > widthPx) {
        widthPx = measured;
      }
    });
    if (!Number.isFinite(widthPx) || widthPx < 0) {
      widthPx = 0;
    }

    var lineHeightFactor = Number(item && item.lineHeight || 1.2);
    if (!Number.isFinite(lineHeightFactor) || lineHeightFactor <= 0) {
      lineHeightFactor = 1.2;
    }
    lineHeightFactor = Math.max(0.6, Math.min(3, lineHeightFactor));

    var singleLinePx = 0;
    var ctx = draftTextMeasureContext();
    if (ctx) {
      ctx.font = String(item && item.fontStyle || 'normal')
        + ' ' + String(item && item.fontWeight || '400')
        + ' ' + fontSizePx + 'px '
        + String(item && item.fontFamily || 'Arial');
      var glyphMetrics = ctx.measureText('Mg');
      var ascent = Number(glyphMetrics && glyphMetrics.actualBoundingBoxAscent || 0);
      var descent = Number(glyphMetrics && glyphMetrics.actualBoundingBoxDescent || 0);
      var glyphHeight = ascent + descent;
      if (Number.isFinite(glyphHeight) && glyphHeight > 0) {
        singleLinePx = glyphHeight;
      }
    }

    var measureNode = draftTextMeasureElement();
    if ((!Number.isFinite(singleLinePx) || singleLinePx <= 0) && measureNode) {
      measureNode.style.fontFamily = String(item && item.fontFamily || 'Arial');
      measureNode.style.fontWeight = String(item && item.fontWeight || '400');
      measureNode.style.fontStyle = String(item && item.fontStyle || 'normal');
      measureNode.style.fontSize = String(fontSize) + 'pt';
      measureNode.style.letterSpacing = String(letterSpacing) + 'px';
      measureNode.style.lineHeight = '1';
      measureNode.style.whiteSpace = 'nowrap';
      measureNode.textContent = 'Mg';
      var heightDom = Number(measureNode.getBoundingClientRect && measureNode.getBoundingClientRect().height || 0);
      if (Number.isFinite(heightDom) && heightDom > 0) {
        singleLinePx = heightDom;
      }
    }
    if (!Number.isFinite(singleLinePx) || singleLinePx <= 0) {
      singleLinePx = Math.ceil(fontSizePx + 1);
    }

    var lineBoxPx = Math.max(singleLinePx, fontSizePx * lineHeightFactor);
    var lineCount = Math.max(1, lines.length);
    var heightPx = lineBoxPx * lineCount;

    return {
      width: widthPx / displayScaleX,
      height: heightPx / displayScaleY,
      lineBoxHeight: lineBoxPx / displayScaleY,
      lineCount: lineCount,
      hasText: normalized.trim().length > 0,
    };
  }

  function draftArtisticBounds(item) {
    var transform = draftArtisticTransformInfo(item);
    var width = Math.max(1, Number(transform.width || 1));
    var height = Math.max(1, Number(transform.height || 1));
    var anchorX = Number(item && item.x || 0);
    var anchorY = Number(item && item.y || 0);
    if (!Number.isFinite(anchorX)) {
      anchorX = 0;
    }
    if (!Number.isFinite(anchorY)) {
      anchorY = 0;
    }
    var left = anchorX + draftTextAlignOffsetX(item && (item.textAlign || item.align), width);
    var top = anchorY;
    var originX = left - Number(transform.minX || 0);
    var originY = top - Number(transform.minY || 0);
    return {
      x: left,
      y: top,
      width: width,
      height: height,
      anchorX: anchorX,
      anchorY: anchorY,
      baseWidth: transform.baseWidth,
      baseHeight: transform.baseHeight,
      scaleX: transform.scaleX,
      scaleY: transform.scaleY,
      rotation: transform.rotation,
      skewX: transform.skewX,
      skewY: transform.skewY,
      minX: transform.minX,
      minY: transform.minY,
      maxX: transform.maxX,
      maxY: transform.maxY,
      originX: originX,
      originY: originY,
      coreOffsetX: -Number(transform.minX || 0),
      coreOffsetY: -Number(transform.minY || 0),
      matrixA: transform.a,
      matrixB: transform.b,
      matrixC: transform.c,
      matrixD: transform.d,
      basisX: transform.basisX,
      basisY: transform.basisY,
    };
  }

  function draftElementBounds(item) {
    if (!item) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    if (isArtisticDraftText(item)) {
      return draftArtisticBounds(item);
    }
    return {
      x: Number(item.x || 0),
      y: Number(item.y || 0),
      width: Math.max(0, Number(item.width || 0)),
      height: Math.max(0, Number(item.height || 0)),
    };
  }

  function draftArtisticLimits(metrics) {
    var widthBase = Math.max(1, Number(metrics && metrics.width || 0));
    var heightBase = Math.max(1, Number(metrics && metrics.height || 0));
    return {
      maxWidth: widthBase * DRAFT_ARTISTIC_MAX_WIDTH_MULTIPLIER,
      maxHeight: heightBase * DRAFT_ARTISTIC_MAX_HEIGHT_MULTIPLIER,
    };
  }

  function fitDraftArtisticTextBounds(draft) {
    if (!draft || String(draft.type || '').toLowerCase() !== 'text') {
      return;
    }

    var mode = normalizeDraftTextType(draft.textType || draft.textMode);
    if (mode !== 'artistic') {
      return;
    }

    var size = measureDraftTextDimensions(draft);
    var width = Number(size.width || 0);
    var height = Number(size.height || 0);
    var textRaw = normalizeDraftTextValue(draftTextValue(draft));

    var metrics = draftCanvasMetrics();
    var limits = draftArtisticLimits(metrics);
    var resolvedWidth = Number(width.toFixed(2));
    var resolvedHeight = Number(height.toFixed(2));
    draft.width = Math.max(size.hasText ? 8 : 6, Math.min(limits.maxWidth, resolvedWidth));
    draft.height = Math.max(10, Math.min(limits.maxHeight, resolvedHeight));
  }

  function nextDraftElementId() {
    draftElementSeed += 1;
    return 'd' + String(Date.now()) + '_' + String(draftElementSeed);
  }

  function normalizeDraftElement(raw, idx) {
    var metrics = draftCanvasMetrics();
    var item = raw && typeof raw === 'object' ? raw : {};
    var type = String(item.type || 'text').toLowerCase();
    if (type !== 'text' && type !== 'image' && type !== 'rectangle') {
      type = 'text';
    }
    var textType = normalizeDraftTextType(item.textType || item.textMode || 'artistic');
    var isArtisticText = type === 'text' && textType === 'artistic';
    var width = Number(item.width || 90);
    var height = Number(item.height || 24);
    var x = Number(item.x || 16);
    var y = Number(item.y || (16 + (idx * 12)));

    if (!Number.isFinite(width) || width <= 0) width = 90;
    if (!Number.isFinite(height) || height <= 0) height = 24;
    if (!Number.isFinite(x)) x = 16;
    if (!Number.isFinite(y)) y = 16;

    var textAlign = String(item.textAlign || item.align || 'center').toLowerCase();
    if (textAlign !== 'left' && textAlign !== 'center' && textAlign !== 'right') {
      textAlign = 'center';
    }

    var scaleX = clampDraftScale(item.scaleX);
    var scaleY = clampDraftScale(item.scaleY);
    var rotation = normalizeDraftAngle(item.rotation);
    var skewX = normalizeDraftAngle(item.skewX);
    var skewY = normalizeDraftAngle(item.skewY);

    var minWidth = type === 'text' ? 6 : (type === 'rectangle' ? 20 : 12);
    var minHeight = type === 'text' ? 10 : (type === 'rectangle' ? 20 : 12);
    if (isArtisticText) {
      var artisticLimits = draftArtisticLimits(metrics);
      width = Math.max(minWidth, Math.min(artisticLimits.maxWidth, width));
      height = Math.max(minHeight, Math.min(artisticLimits.maxHeight, height));

      var minVisiblePx = DRAFT_ARTISTIC_MIN_VISIBLE_PX;
      var artisticBounds = draftArtisticBounds({
        type: 'text',
        textType: 'artistic',
        textAlign: textAlign,
        x: x,
        y: y,
        width: width,
        height: height,
        scaleX: scaleX,
        scaleY: scaleY,
        rotation: rotation,
        skewX: skewX,
        skewY: skewY,
      });
      var nextX = x;
      var nextY = y;
      var rightEdge = Number(artisticBounds.x || 0) + Number(artisticBounds.width || 0);
      var bottomEdge = Number(artisticBounds.y || 0) + Number(artisticBounds.height || 0);
      if (rightEdge < minVisiblePx) {
        nextX += (minVisiblePx - rightEdge);
      } else if (Number(artisticBounds.x || 0) > (metrics.width - minVisiblePx)) {
        nextX += ((metrics.width - minVisiblePx) - Number(artisticBounds.x || 0));
      }
      if (bottomEdge < minVisiblePx) {
        nextY += (minVisiblePx - bottomEdge);
      } else if (Number(artisticBounds.y || 0) > (metrics.height - minVisiblePx)) {
        nextY += ((metrics.height - minVisiblePx) - Number(artisticBounds.y || 0));
      }
      x = nextX;
      y = nextY;
    } else {
      width = Math.max(minWidth, Math.min(metrics.width, width));
      height = Math.max(minHeight, Math.min(metrics.height, height));
      x = Math.max(0, Math.min(metrics.width - width, x));
      y = Math.max(0, Math.min(metrics.height - height, y));
    }

    var side = String(item.side || 'front').toLowerCase();
    if (side !== 'front' && side !== 'back' && side !== 'both') {
      side = 'front';
    }

    var fontSize = Number(item.fontSize || DRAFT_DEFAULT_FONT_PT);
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
      fontSize = DRAFT_DEFAULT_FONT_PT;
    }
    fontSize = Math.max(4, Math.min(240, fontSize));

    var lineHeight = Number(item.lineHeight || 1.2);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      lineHeight = 1.2;
    }
    lineHeight = Math.max(0.6, Math.min(3, lineHeight));

    var letterSpacing = Number(item.letterSpacing || 0);
    if (!Number.isFinite(letterSpacing)) {
      letterSpacing = 0;
    }
    letterSpacing = Math.max(-10, Math.min(20, letterSpacing));

    var fontSelection = resolveFontSelection(item);
    var fontFamily = String(
      (fontSelection.face && fontSelection.face.family)
      || item.fontFamily
      || 'Arial'
    ).slice(0, 80);
    var fontWeight = normalizeFontWeightValue(
      (fontSelection.face && fontSelection.face.weight)
      || item.fontWeight
      || '400'
    );
    var fontStyle = normalizeFontStyleValue(
      (fontSelection.face && fontSelection.face.style)
      || item.fontStyle
      || 'normal'
    );
    var fontGroup = String(
      (fontSelection.family && fontSelection.family.id)
      || item.fontGroup
      || 'arial'
    );
    var fontFace = String(
      (fontSelection.face && fontSelection.face.id)
      || item.fontFace
      || 'regular'
    );

    var color = String(item.color || '#1e293b').slice(0, 20);
    var textMode = textType;
    var textValue = draftTextValue(item);
    var hasStoredLabel = Object.prototype.hasOwnProperty.call(item, 'label') || Object.prototype.hasOwnProperty.call(item, 'text');
    var fallbackLabel = type === 'image'
      ? 'Image'
      : (type === 'rectangle' ? 'Rectangle' : '');

    var normalizedItem = {
      __id: item.__id || nextDraftElementId(),
      type: type,
      zIndex: normalizeDraftElementZIndex(item.zIndex, idx + 1),
      visible: item.visible !== false,
      locked: item.locked === true,
      field: String(item.field || ''),
      text: type === 'text' ? (hasStoredLabel ? String(textValue) : '') : '',
      label: type === 'text' ? (hasStoredLabel ? String(textValue) : '') : (hasStoredLabel ? String(item.label) : fallbackLabel),
      showLabel: item.showLabel !== false,
      side: side,
      x: x,
      y: y,
      width: width,
      height: height,
      scaleX: type === 'text' ? scaleX : 1,
      scaleY: type === 'text' ? scaleY : 1,
      rotation: type === 'text' ? rotation : 0,
      skewX: type === 'text' ? skewX : 0,
      skewY: type === 'text' ? skewY : 0,
      fontSize: fontSize,
      fontFamily: fontFamily,
      fontGroup: fontGroup,
      fontFace: fontFace,
      lineHeight: lineHeight,
      fontWeight: fontWeight,
      fontStyle: fontStyle,
      textAlign: textAlign,
      align: textAlign,
      letterSpacing: letterSpacing,
      color: color,
      textType: type === 'text' ? textType : '',
      textMode: type === 'text' ? textMode : '',
      imageKind: type === 'image' ? String(item.imageKind || '') : '',
      src: type === 'image' ? String(item.src || item.data_url || '') : '',
    };

    if (normalizedItem.type === 'text' && normalizedItem.textMode === 'artistic') {
      normalizedItem.artisticAutoFit = item.artisticAutoFit !== false;
      if (normalizedItem.artisticAutoFit) {
        fitDraftArtisticTextBounds(normalizedItem);
      }
    }

    return normalizedItem;
  }

  function ensureStep2DraftInitialized() {
    if (state.templateDraft && typeof state.templateDraft === 'object') {
      if (!state.templateDraftName) {
        state.templateDraftName = state.selectedTemplate
          ? String(state.selectedTemplate.name || '')
          : 'New Template';
      }
      return;
    }

    var base = state.selectedTemplate && state.selectedTemplate.template_json
      ? state.selectedTemplate.template_json
      : defaultTemplateJson();
    var clean = templateJsonForApi(base);
    if (!clean.canvas || typeof clean.canvas !== 'object') {
      clean.canvas = { width: 350, height: 200, guides: [] };
    }
    if (!Array.isArray(clean.canvas.guides)) {
      clean.canvas.guides = [];
    }
    clean.canvas.guides = clean.canvas.guides.map(function (guide) {
      return normalizeDraftGuide(guide);
    });
    clean.elements = (clean.elements || []).map(function (item, idx) {
      return normalizeDraftElement(item, idx);
    });

    state.templateDraft = clean;
    state.templateDraftName = state.selectedTemplate
      ? String(state.selectedTemplate.name || 'Template')
      : 'New Template';
    state.draftSelectedElementId = clean.elements.length ? clean.elements[0].__id : '';
    state.draftSelectedElementIds = state.draftSelectedElementId ? new Set([state.draftSelectedElementId]) : new Set();
    state.draftSelectedGuideId = '';
    state.draftActiveSide = 'front';
    state.draftDirty = false;

    if (!state.selectedTemplate) {
      state.selectedTemplate = {
        id: null,
        name: state.templateDraftName,
        template_json: templateJsonForApi(clean),
        version: 1,
        font_size: DRAFT_DEFAULT_FONT_PT,
        font_family: 'Arial',
      };
    }

    normalizeDraftElementZOrder(false);
  }

  function selectedDraftElement() {
    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();
    var elements = state.templateDraft && Array.isArray(state.templateDraft.elements)
      ? state.templateDraft.elements
      : [];

    if (!state.draftSelectedElementId && state.draftSelectedElementIds && state.draftSelectedElementIds.size) {
      state.draftSelectedElementIds.forEach(function (id) {
        if (!state.draftSelectedElementId) {
          state.draftSelectedElementId = String(id || '');
        }
      });
    }

    return elements.find(function (item) {
      return item && item.__id === state.draftSelectedElementId;
    }) || null;
  }

  function selectedDraftElementSet() {
    if (!(state.draftSelectedElementIds instanceof Set)) {
      state.draftSelectedElementIds = new Set();
    }
    if (state.draftSelectedElementId) {
      state.draftSelectedElementIds.add(state.draftSelectedElementId);
    }
    return state.draftSelectedElementIds;
  }

  function normalizeDraftElementSelection() {
    ensureStep2DraftInitialized();
    var elements = state.templateDraft && Array.isArray(state.templateDraft.elements)
      ? state.templateDraft.elements
      : [];
    var validIds = new Set(elements.filter(function (item) {
      return isDraftElementSelectable(item);
    }).map(function (item) {
      return String(item && item.__id || '');
    }).filter(function (id) {
      return !!id;
    }));

    var selectedIds = selectedDraftElementSet();
    var nextSelected = new Set();
    selectedIds.forEach(function (id) {
      var sid = String(id || '');
      if (sid && validIds.has(sid)) {
        nextSelected.add(sid);
      }
    });

    if (state.draftSelectedElementId) {
      var current = String(state.draftSelectedElementId || '');
      if (current && validIds.has(current)) {
        nextSelected.add(current);
      }
    }

    if (!state.draftSelectedElementId || !nextSelected.has(state.draftSelectedElementId)) {
      var nextPrimary = '';
      nextSelected.forEach(function (id) {
        if (!nextPrimary) {
          nextPrimary = id;
        }
      });
      state.draftSelectedElementId = nextPrimary;
    }

    state.draftSelectedElementIds = nextSelected;
    if (state.draftSelectedElementIds.size < 2
      || !state.draftSelectedElementIds.has(String(state.draftKeyObjectId || ''))) {
      state.draftKeyObjectId = '';
    }
  }

  function selectedDraftElements() {
    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();
    var elements = state.templateDraft && Array.isArray(state.templateDraft.elements)
      ? state.templateDraft.elements
      : [];
    var selected = selectedDraftElementSet();
    return elements.filter(function (item) {
      return item && selected.has(item.__id) && isDraftElementSelectable(item);
    });
  }

  function isDraftElementSelected(id) {
    var wanted = String(id || '');
    if (!wanted) {
      return false;
    }
    var selected = selectedDraftElementSet();
    return selected.has(wanted);
  }

  function normalizeDraftTransformMode(value) {
    return String(value || '').toLowerCase() === 'rotate' ? 'rotate' : 'resize';
  }

  function toggleDraftTransformMode() {
    state.draftTransformMode = normalizeDraftTransformMode(state.draftTransformMode) === 'rotate'
      ? 'resize'
      : 'rotate';
  }

  function setDraftSelectedElementIds(nextIds, primaryId) {
    var ids = new Set();
    if (nextIds && typeof nextIds.forEach === 'function') {
      nextIds.forEach(function (id) {
        var sid = String(id || '');
        if (sid) {
          ids.add(sid);
        }
      });
    }

    var nextPrimary = String(primaryId || '');
    if (!nextPrimary || !ids.has(nextPrimary)) {
      nextPrimary = '';
      ids.forEach(function (id) {
        if (!nextPrimary) {
          nextPrimary = String(id || '');
        }
      });
    }

    state.draftSelectedElementIds = ids;
    state.draftSelectedElementId = nextPrimary;
    if (ids.size < 2 || !ids.has(String(state.draftKeyObjectId || ''))) {
      state.draftKeyObjectId = '';
    }
  }

  function draftSelectionBounds(ids, side) {
    ensureStep2DraftInitialized();
    var elements = Array.isArray(state.templateDraft && state.templateDraft.elements)
      ? state.templateDraft.elements
      : [];
    var sideName = normalizeDraftEditorSide(side || state.draftActiveSide);
    var wantedIds = ids && typeof ids.forEach === 'function' ? ids : selectedDraftElementSet();

    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var count = 0;

    elements.forEach(function (item) {
      if (!item || !wantedIds.has(String(item.__id || ''))) {
        return;
      }
      var renderSides = draftElementRenderSides(item);
      if (!renderSides.some(function (s) { return s === sideName; })) {
        return;
      }
      var b = draftElementBounds(item);
      var left = Number(b.x || 0);
      var top = Number(b.y || 0);
      var right = left + Math.max(0, Number(b.width || 0));
      var bottom = top + Math.max(0, Number(b.height || 0));
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, right);
      maxY = Math.max(maxY, bottom);
      count += 1;
    });

    if (!count) {
      return null;
    }

    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      side: sideName,
      count: count,
    };
  }

  function isDraftResizeCornerHandle(handle) {
    var h = normalizeDraftResizeHandle(handle);
    return h === 'nw' || h === 'ne' || h === 'se' || h === 'sw';
  }

  function draftPointFromResizeDrag(resizeDrag, event, scaleX, scaleY) {
    var sx = Number(scaleX || 1);
    var sy = Number(scaleY || 1);
    if (!Number.isFinite(sx) || sx <= 0) {
      sx = 1;
    }
    if (!Number.isFinite(sy) || sy <= 0) {
      sy = 1;
    }
    return {
      x: Number(resizeDrag.startPointerX || 0) + ((Number(event.clientX || 0) - Number(resizeDrag.startMouseX || 0)) * sx),
      y: Number(resizeDrag.startPointerY || 0) + ((Number(event.clientY || 0) - Number(resizeDrag.startMouseY || 0)) * sy),
    };
  }

  function normalizeAngleDeltaDegrees(value) {
    var delta = Number(value || 0);
    if (!Number.isFinite(delta)) {
      return 0;
    }
    while (delta > 180) {
      delta -= 360;
    }
    while (delta < -180) {
      delta += 360;
    }
    return delta;
  }

  function findDraftElementById(id) {
    var wanted = String(id || '');
    if (!wanted) {
      return null;
    }
    ensureStep2DraftInitialized();
    var elements = state.templateDraft && Array.isArray(state.templateDraft.elements)
      ? state.templateDraft.elements
      : [];
    return elements.find(function (item) {
      return item && String(item.__id || '') === wanted;
    }) || null;
  }

  function isDraftTextElement(item) {
    return !!(item && String(item.type || '').toLowerCase() === 'text');
  }

  function clearDraftInlineTextEditing() {
    state.draftInlineEditingElementId = '';
    state.draftPendingTextEdit = null;
  }

  function setDraftInlineTextEditing(id) {
    var wanted = String(id || '');
    var item = findDraftElementById(wanted);
    if (!wanted || !isDraftTextElement(item) || !isDraftElementSelectable(item)) {
      state.draftInlineEditingElementId = '';
      return false;
    }

    state.draftSelectedElementId = wanted;
    state.draftSelectedElementIds = new Set([wanted]);
    state.draftSelectedGuideId = '';

    var currentLabel = String(item.label || '').trim();
    if (/^(artistic\s+text|paragraph|text)\s*\d*$/i.test(currentLabel)) {
      updateDraftTextLabelById(wanted, '');
    }

    if (String(item.textMode || '').toLowerCase() === 'artistic') {
      var ls = Number(item.letterSpacing || 0);
      if (Number.isFinite(ls) && (ls > 3 || ls < -3)) {
        mutateDraftElementById(wanted, function (draft) {
          draft.letterSpacing = 0;
        });
      }
      if (String(item.textAlign || item.align || 'left').toLowerCase() !== 'left') {
        mutateDraftElementById(wanted, function (draft) {
          draft.textAlign = 'left';
          draft.align = 'left';
        });
      }
    }

    state.draftInlineEditingElementId = wanted;
    // Preserve text tool mode while editing so double-click in text workflow doesn't flip to grab/select behavior.
    if (state.draftTool !== 'text') {
      state.draftTool = 'select';
    }
    state.draftPendingTextEdit = null;
    return true;
  }

  function readDraftInlineEditorText(editorEl) {
    if (!editorEl || editorEl.nodeType !== 1) {
      return '';
    }

    var mode = String(editorEl.getAttribute('data-text-mode') || '').toLowerCase();
    if (mode !== 'artistic') {
      return String(typeof editorEl.innerText === 'string' ? editorEl.innerText : (editorEl.textContent || ''));
    }

    var chunks = [];
    function pushNewline() {
      if (!chunks.length) {
        return;
      }
      if (chunks[chunks.length - 1] !== '\n') {
        chunks.push('\n');
      }
    }

    function walk(node) {
      if (!node) {
        return;
      }
      if (node.nodeType === 3) {
        chunks.push(String(node.nodeValue || ''));
        return;
      }
      if (node.nodeType !== 1) {
        return;
      }

      var tag = String(node.tagName || '').toLowerCase();
      if (tag === 'br') {
        pushNewline();
        return;
      }

      var isLineBlock = !!(node.classList && node.classList.contains('gc-draft-el-line'));
      var isBlockTag = tag === 'div' || tag === 'p' || tag === 'li';
      var shouldWrapWithBreaks = isLineBlock || isBlockTag;
      if (shouldWrapWithBreaks) {
        pushNewline();
      }

      Array.prototype.forEach.call(node.childNodes || [], walk);

      if (shouldWrapWithBreaks) {
        pushNewline();
      }
    }

    walk(editorEl);
    var parsed = chunks.join('')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '')
      .replace(/\n{3,}/g, '\n\n');
    return parsed
      .split('\n')
      .map(function (lineText) {
        // ContentEditable often prefixes new lines with NBSP placeholders.
        return String(lineText || '')
          .replace(/^[\u200B\uFEFF]+/, '')
          .replace(/^[\u00A0 ]+(?=\S)/, '');
      })
      .join('\n');
  }

  function updateDraftTextLabelById(id, nextLabel) {
    var wanted = String(id || '');
    if (!wanted) {
      return false;
    }

    ensureStep2DraftInitialized();
    prepareDraftHistoryMutation();
    var changed = false;
    state.templateDraft.elements = state.templateDraft.elements.map(function (item, idx) {
      if (!item || String(item.__id || '') !== wanted) {
        return item;
      }

      var next = String(nextLabel || '');
      var isArtisticText = isArtisticDraftText(item);
      var isInlineArtisticEdit = isArtisticText && String(state.draftInlineEditingElementId || '') === wanted;
      var prevBounds = isArtisticText ? draftArtisticBounds(item) : null;
      if (isArtisticText) {
        next = next.replace(/[ \t\u00A0]+$/g, '');
      }
      var draft = Object.assign({}, item, { label: next, text: next });
      if (isArtisticText && !isInlineArtisticEdit && item.artisticAutoFit !== false) {
        fitDraftArtisticTextBounds(draft);
      }
      var normalized = normalizeDraftElement(draft, idx);
      if (isInlineArtisticEdit) {
        // Keep top-left anchor stable while still letting text auto-size as content changes.
        normalized.x = Number(item.x || 0);
        normalized.y = Number(item.y || 0);
        normalized.artisticAutoFit = true;
      } else if (isArtisticText && prevBounds) {
        // Keep artistic text stable based on text alignment reference point.
        var nextBounds = draftArtisticBounds(normalized);
        var alignMode = String(
          normalized.textAlign
          || normalized.align
          || item.textAlign
          || item.align
          || 'left'
        ).toLowerCase();
        if (alignMode !== 'left' && alignMode !== 'center' && alignMode !== 'right') {
          alignMode = 'left';
        }
        var prevRefX = Number(prevBounds.x || 0);
        var nextRefX = Number(nextBounds.x || 0);
        if (alignMode === 'center') {
          prevRefX += Number(prevBounds.width || 0) / 2;
          nextRefX += Number(nextBounds.width || 0) / 2;
        } else if (alignMode === 'right') {
          prevRefX += Number(prevBounds.width || 0);
          nextRefX += Number(nextBounds.width || 0);
        }
        var driftX = prevRefX - nextRefX;
        var driftY = Number(prevBounds.y || 0) - Number(nextBounds.y || 0);
        if (Number.isFinite(driftX) && Number.isFinite(driftY)
          && (Math.abs(driftX) > 0.005 || Math.abs(driftY) > 0.005)) {
          normalized.x = Number(normalized.x || 0) + driftX;
          normalized.y = Number(normalized.y || 0) + driftY;
        }
      }
      normalized.__id = item.__id;
      changed = true;
      return normalized;
    });

    if (changed) {
      markDraftDirty();
    }

    return changed;
  }

  function mutateDraftElementById(id, mutator) {
    var wanted = String(id || '');
    if (!wanted || typeof mutator !== 'function') {
      return false;
    }

    ensureStep2DraftInitialized();
    prepareDraftHistoryMutation();
    var changed = false;
    state.templateDraft.elements = state.templateDraft.elements.map(function (item, idx) {
      if (!item || String(item.__id || '') !== wanted) {
        return item;
      }

      var draft = Object.assign({}, item);
      mutator(draft, item);
      var normalized = normalizeDraftElement(draft, idx);
      normalized.__id = item.__id;
      changed = true;
      return normalized;
    });

    if (changed) {
      markDraftDirty();
      normalizeDraftElementSelection();
    }

    return changed;
  }

  function normalizeDraftResizeHandle(value) {
    var handle = String(value || '').toLowerCase();
    if (handle !== 'n' && handle !== 'ne' && handle !== 'e' && handle !== 'se'
      && handle !== 's' && handle !== 'sw' && handle !== 'w' && handle !== 'nw') {
      handle = 'se';
    }
    return handle;
  }

  function applyDraftResizeDrag(resizeDrag, event) {
    if (!resizeDrag || !event) {
      return false;
    }

    var handle = normalizeDraftResizeHandle(resizeDrag.handle);
    var hasNorth = handle.indexOf('n') !== -1;
    var hasSouth = handle.indexOf('s') !== -1;
    var hasWest = handle.indexOf('w') !== -1;
    var hasEast = handle.indexOf('e') !== -1;
    var hasHorizontal = hasWest || hasEast;
    var hasVertical = hasNorth || hasSouth;
    var isCorner = hasHorizontal && hasVertical;

    var startWidth = Number(resizeDrag.startWidth || 0);
    var startHeight = Number(resizeDrag.startHeight || 0);
    if (!Number.isFinite(startWidth) || startWidth <= 0 || !Number.isFinite(startHeight) || startHeight <= 0) {
      return false;
    }

    var scaleX = Number(resizeDrag.metrics && resizeDrag.metrics.width || 0) / Math.max(1, draftCanvasSideDisplayWidthPx(resizeDrag.canvasRect));
    var scaleY = Number(resizeDrag.metrics && resizeDrag.metrics.height || 0) / Math.max(1, Number(resizeDrag.canvasRect && resizeDrag.canvasRect.height || 0));
    if (!Number.isFinite(scaleX) || scaleX <= 0) {
      scaleX = 1;
    }
    if (!Number.isFinite(scaleY) || scaleY <= 0) {
      scaleY = 1;
    }

    var pointer = draftPointFromResizeDrag(resizeDrag, event, scaleX, scaleY);
    var deltaX = Number(pointer.x || 0) - Number(resizeDrag.startPointerX || 0);
    var deltaY = Number(pointer.y || 0) - Number(resizeDrag.startPointerY || 0);

    var dragIds = Array.isArray(resizeDrag.dragIds) && resizeDrag.dragIds.length
      ? resizeDrag.dragIds.map(function (id) { return String(id || ''); }).filter(function (id) { return !!id; })
      : [String(resizeDrag.id || '')];
    if (!dragIds.length) {
      return false;
    }
    var dragIdSet = new Set(dragIds);
    var startElements = resizeDrag.startElements && typeof resizeDrag.startElements === 'object'
      ? resizeDrag.startElements
      : {};

    var startLeft = Number(resizeDrag.startX || 0);
    var startTop = Number(resizeDrag.startY || 0);
    var startRight = startLeft + startWidth;
    var startBottom = startTop + startHeight;
    var startCenterX = Number(resizeDrag.startCenterX || ((startLeft + startRight) / 2));
    var startCenterY = Number(resizeDrag.startCenterY || ((startTop + startBottom) / 2));

    var transformMode = normalizeDraftTransformMode(resizeDrag.transformMode || state.draftTransformMode);
    var transformKind = String(resizeDrag.transformKind || '').toLowerCase();
    if (!transformKind) {
      transformKind = transformMode === 'rotate'
        ? (isCorner ? 'rotate' : (hasHorizontal ? 'skew-x' : 'skew-y'))
        : 'resize';
    }

    function applyResizeDragMutations(mutator) {
      if (typeof mutator !== 'function') {
        return false;
      }

      ensureStep2DraftInitialized();
      prepareDraftHistoryMutation();
      var changed = false;
      state.templateDraft.elements = state.templateDraft.elements.map(function (item, idx) {
        if (!item || !dragIdSet.has(String(item.__id || ''))) {
          return item;
        }

        var sid = String(item.__id || '');
        var seed = startElements[sid];
        if (!seed || typeof seed !== 'object') {
          var b = draftElementBounds(item);
          seed = {
            x: Number(item.x || 0),
            y: Number(item.y || 0),
            width: Number(item.width || 0),
            height: Number(item.height || 0),
            scaleX: clampDraftScale(item.scaleX),
            scaleY: clampDraftScale(item.scaleY),
            rotation: normalizeDraftAngle(item.rotation),
            skewX: normalizeDraftAngle(item.skewX),
            skewY: normalizeDraftAngle(item.skewY),
            centerX: Number(b.x || 0) + (Number(b.width || 0) / 2),
            centerY: Number(b.y || 0) + (Number(b.height || 0) / 2),
          };
        }

        var draft = Object.assign({}, item);
        mutator(draft, seed, sid);
        var normalized = normalizeDraftElement(draft, idx);
        normalized.__id = item.__id;
        changed = true;
        return normalized;
      });

      if (changed) {
        markDraftDirty();
        normalizeDraftElementSelection();
      }

      return changed;
    }

    if (transformKind === 'rotate') {
      var angleNow = Math.atan2(Number(pointer.y || 0) - startCenterY, Number(pointer.x || 0) - startCenterX);
      var angleStart = Number(resizeDrag.startAngle || 0);
      var deltaDeg = normalizeAngleDeltaDegrees((angleNow - angleStart) * (180 / Math.PI))
        * Number(DRAFT_ROTATE_DRAG_SENSITIVITY || 1);
      if (Math.abs(deltaDeg) < Number(DRAFT_ROTATE_MIN_APPLY_DEGREES || 0)) {
        deltaDeg = 0;
      }
      if (event.shiftKey) {
        deltaDeg = Math.round(deltaDeg / 15) * 15;
      }
      var deltaRad = deltaDeg * (Math.PI / 180);
      var cosD = Math.cos(deltaRad);
      var sinD = Math.sin(deltaRad);

      return applyResizeDragMutations(function (draft, seed) {
        var offsetX = Number(seed.centerX || 0) - startCenterX;
        var offsetY = Number(seed.centerY || 0) - startCenterY;
        var targetCenterX = startCenterX + (offsetX * cosD) - (offsetY * sinD);
        var targetCenterY = startCenterY + (offsetX * sinD) + (offsetY * cosD);

        if (String(draft.type || '').toLowerCase() === 'text') {
          draft.rotation = normalizeDraftAngle(Number(seed.rotation || 0) + deltaDeg);
        }

        var shiftX = targetCenterX - Number(seed.centerX || 0);
        var shiftY = targetCenterY - Number(seed.centerY || 0);
        draft.x = Number(seed.x || 0) + shiftX;
        draft.y = Number(seed.y || 0) + shiftY;
      });
    }

    if (transformKind === 'skew-x' || transformKind === 'skew-y') {
      var span = transformKind === 'skew-x' ? Math.max(24, startWidth) : Math.max(24, startHeight);
      var rawSkewDelta = (transformKind === 'skew-x' ? deltaX : deltaY)
        * (Number(DRAFT_SKEW_DEGREES_AT_FULL_SPAN || 60) / span);
      if (!Number.isFinite(rawSkewDelta)) {
        rawSkewDelta = 0;
      }
      if (event.shiftKey) {
        rawSkewDelta = Math.round(rawSkewDelta / Math.max(1, Number(DRAFT_SKEW_SHIFT_SNAP_DEGREES || 5)))
          * Math.max(1, Number(DRAFT_SKEW_SHIFT_SNAP_DEGREES || 5));
      }

      return applyResizeDragMutations(function (draft, seed) {
        if (String(draft.type || '').toLowerCase() !== 'text') {
          return;
        }
        if (transformKind === 'skew-x') {
          draft.skewX = normalizeDraftAngle(
            Math.max(-Number(DRAFT_SKEW_MAX_DEGREES || 80), Math.min(Number(DRAFT_SKEW_MAX_DEGREES || 80), Number(seed.skewX || 0) + rawSkewDelta))
          );
        } else {
          draft.skewY = normalizeDraftAngle(
            Math.max(-Number(DRAFT_SKEW_MAX_DEGREES || 80), Math.min(Number(DRAFT_SKEW_MAX_DEGREES || 80), Number(seed.skewY || 0) + rawSkewDelta))
          );
        }
      });
    }

    var left = startLeft;
    var top = startTop;
    var right = startRight;
    var bottom = startBottom;

    if (hasWest) {
      left += deltaX;
    }
    if (hasEast) {
      right += deltaX;
    }
    if (hasNorth) {
      top += deltaY;
    }
    if (hasSouth) {
      bottom += deltaY;
    }

    if (event.altKey) {
      if (hasWest && !hasEast) {
        right -= deltaX;
      } else if (hasEast && !hasWest) {
        left -= deltaX;
      }
      if (hasNorth && !hasSouth) {
        bottom -= deltaY;
      } else if (hasSouth && !hasNorth) {
        top -= deltaY;
      }
    }

    var startAspect = startWidth / Math.max(1, startHeight);
    var lockAspectRatio = isCorner || !!event.shiftKey;
    if (lockAspectRatio) {
      var boxWidth = right - left;
      var boxHeight = bottom - top;
      var absWidthScale = Math.abs(boxWidth / Math.max(1, startWidth));
      var absHeightScale = Math.abs(boxHeight / Math.max(1, startHeight));

      if (absWidthScale >= absHeightScale) {
        boxHeight = (boxWidth / Math.max(0.001, startAspect));
      } else {
        boxWidth = boxHeight * startAspect;
      }

      if (event.altKey) {
        var centerX = (left + right) / 2;
        var centerY = (top + bottom) / 2;
        left = centerX - (boxWidth / 2);
        right = centerX + (boxWidth / 2);
        top = centerY - (boxHeight / 2);
        bottom = centerY + (boxHeight / 2);
      } else {
        if (hasWest && !hasEast) {
          left = right - boxWidth;
        } else if (hasEast && !hasWest) {
          right = left + boxWidth;
        }
        if (hasNorth && !hasSouth) {
          top = bottom - boxHeight;
        } else if (hasSouth && !hasNorth) {
          bottom = top + boxHeight;
        }
        if (hasHorizontal && !hasVertical) {
          var centerYNoAlt = (top + bottom) / 2;
          top = centerYNoAlt - (boxHeight / 2);
          bottom = centerYNoAlt + (boxHeight / 2);
        } else if (hasVertical && !hasHorizontal) {
          var centerXNoAlt = (left + right) / 2;
          left = centerXNoAlt - (boxWidth / 2);
          right = centerXNoAlt + (boxWidth / 2);
        }
      }
    }

    var nextCenterX = (left + right) / 2;
    var nextCenterY = (top + bottom) / 2;
    var nextWidth = Math.max(1, Math.abs(right - left));
    var nextHeight = Math.max(1, Math.abs(bottom - top));
    left = nextCenterX - (nextWidth / 2);
    right = nextCenterX + (nextWidth / 2);
    top = nextCenterY - (nextHeight / 2);
    bottom = nextCenterY + (nextHeight / 2);

    var ratioW = nextWidth / Math.max(1, startWidth);
    var ratioH = nextHeight / Math.max(1, startHeight);

    return applyResizeDragMutations(function (draft, seed) {
      var relX = (Number(seed.centerX || 0) - startLeft) / Math.max(1, startWidth);
      var relY = (Number(seed.centerY || 0) - startTop) / Math.max(1, startHeight);
      var targetCenterX = left + (relX * nextWidth);
      var targetCenterY = top + (relY * nextHeight);

      var type = String(draft.type || '').toLowerCase();
      var isArtisticText = type === 'text' && normalizeDraftTextType(draft.textType || draft.textMode) === 'artistic';

      if (isArtisticText) {
        var nextScaleX = Number(seed.scaleX || 1);
        var nextScaleY = Number(seed.scaleY || 1);

        if (hasHorizontal || isCorner) {
          nextScaleX = clampDraftScale(nextScaleX * ratioW);
        }
        if (hasVertical || isCorner) {
          nextScaleY = clampDraftScale(nextScaleY * ratioH);
        }

        draft.scaleX = nextScaleX;
        draft.scaleY = nextScaleY;
        draft.fontSize = Number(resizeDrag.startFontSize || draft.fontSize || DRAFT_DEFAULT_FONT_PT);

        var candidateBounds = draftElementBounds(draft);
        var candidateCenterX = Number(candidateBounds.x || 0) + (Number(candidateBounds.width || 0) / 2);
        var candidateCenterY = Number(candidateBounds.y || 0) + (Number(candidateBounds.height || 0) / 2);
        draft.x = Number(draft.x || 0) + (targetCenterX - candidateCenterX);
        draft.y = Number(draft.y || 0) + (targetCenterY - candidateCenterY);
        return;
      }

      var minWidth = type === 'text' ? 8 : (type === 'rectangle' ? 20 : 12);
      var minHeight = type === 'text' ? 10 : (type === 'rectangle' ? 20 : 12);
      var widthFactor = (hasHorizontal || isCorner) ? ratioW : 1;
      var heightFactor = (hasVertical || isCorner) ? ratioH : 1;
      var nextElWidth = Math.max(minWidth, Number(seed.width || draft.width || minWidth) * widthFactor);
      var nextElHeight = Math.max(minHeight, Number(seed.height || draft.height || minHeight) * heightFactor);

      draft.width = nextElWidth;
      draft.height = nextElHeight;
      draft.x = targetCenterX - (nextElWidth / 2);
      draft.y = targetCenterY - (nextElHeight / 2);
    });
  }

  function focusDraftInlineEditorIfNeeded() {
    var wanted = String(state.draftInlineEditingElementId || '');
    if (!wanted || !flowRoot) {
      return;
    }

    window.requestAnimationFrame(function () {
      var editor = flowRoot.querySelector('.gc-draft-inline-editor[data-inline-editor-id="' + wanted + '"]');
      if (!editor) {
        return;
      }
      try {
        editor.focus();
        var range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        var sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (_err) {
        // Ignore focus/caret placement failures.
      }
    });
  }

  function applyToSelectedDraftElements(mutator) {
    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();
    var selected = selectedDraftElementSet();
    if (!selected.size || typeof mutator !== 'function') {
      return false;
    }

    prepareDraftHistoryMutation();
    var changed = false;
    state.templateDraft.elements = state.templateDraft.elements.map(function (item, idx) {
      if (!item || !selected.has(item.__id)) {
        return item;
      }

      var draft = Object.assign({}, item);
      mutator(draft, item);
      var normalized = normalizeDraftElement(draft, idx);
      normalized.__id = item.__id;
      changed = true;
      return normalized;
    });

    if (changed) {
      markDraftDirty();
      normalizeDraftElementSelection();
    }

    return changed;
  }

  function applyToDraftElementIds(ids, mutator) {
    var idSet = ids instanceof Set ? ids : new Set(ids || []);
    if (!idSet.size || typeof mutator !== 'function') {
      return false;
    }

    ensureStep2DraftInitialized();
    prepareDraftHistoryMutation();
    var changed = false;
    state.templateDraft.elements = state.templateDraft.elements.map(function (item, idx) {
      if (!item || !idSet.has(String(item.__id || ''))) {
        return item;
      }

      var draft = Object.assign({}, item);
      mutator(draft, item);
      var normalized = normalizeDraftElement(draft, idx);
      normalized.__id = item.__id;
      changed = true;
      return normalized;
    });

    if (changed) {
      markDraftDirty();
      normalizeDraftElementSelection();
    }

    return changed;
  }

  function selectedDraftElementsForLayout() {
    var selected = selectedDraftElements();
    if (!selected.length) {
      return [];
    }

    if (!state.isTwoSided) {
      return selected;
    }

    var side = normalizeDraftEditorSide(state.draftActiveSide);
    var filtered = selected.filter(function (item) {
      return draftElementVisibleOnSide(item, side);
    });
    return filtered.length ? filtered : selected;
  }

  function draftCombinedBoundsFromItems(items, boundsById) {
    if (!Array.isArray(items) || !items.length) {
      return null;
    }

    var minX = Infinity;
    var minY = Infinity;
    var maxRight = -Infinity;
    var maxBottom = -Infinity;

    items.forEach(function (item) {
      var id = String(item && item.__id || '');
      var b = boundsById && boundsById[id] ? boundsById[id] : draftElementBounds(item);
      var x = Number(b.x || 0);
      var y = Number(b.y || 0);
      var right = x + Number(b.width || 0);
      var bottom = y + Number(b.height || 0);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxRight = Math.max(maxRight, right);
      maxBottom = Math.max(maxBottom, bottom);
    });

    if (!Number.isFinite(minX) || !Number.isFinite(minY)
      || !Number.isFinite(maxRight) || !Number.isFinite(maxBottom)) {
      return null;
    }

    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxRight - minX),
      height: Math.max(1, maxBottom - minY),
    };
  }

  function resolveDraftAlignContext(mode) {
    var items = selectedDraftElementsForLayout();
    if (!items.length) {
      return null;
    }

    var boundsById = {};
    var idSet = new Set();
    items.forEach(function (item) {
      var id = String(item && item.__id || '');
      if (!id) {
        return;
      }
      idSet.add(id);
      boundsById[id] = draftElementBounds(item);
    });

    if (!idSet.size) {
      return null;
    }

    var selectionBounds = draftCombinedBoundsFromItems(items, boundsById);
    if (!selectionBounds) {
      return null;
    }

    var safeMode = String(mode || '').toLowerCase();
    var reference = normalizeDraftAlignReference(state.draftAlignReference);
    if (safeMode === 'canvas-center') {
      reference = 'page';
    }

    var keyObjectId = String(state.draftKeyObjectId || '');
    if (!keyObjectId || !idSet.has(keyObjectId) || items.length < 2) {
      keyObjectId = '';
      if (reference === 'keyObject') {
        reference = 'selection';
      }
    }

    var referenceBounds = selectionBounds;
    if (reference === 'page') {
      var metrics = draftCanvasMetrics();
      referenceBounds = {
        x: 0,
        y: 0,
        width: Number(metrics.width || 0),
        height: Number(metrics.height || 0),
      };
    } else if (reference === 'keyObject' && keyObjectId) {
      referenceBounds = boundsById[keyObjectId] || selectionBounds;
    }

    return {
      items: items,
      itemIdSet: idSet,
      boundsById: boundsById,
      selectionBounds: selectionBounds,
      reference: reference,
      referenceBounds: referenceBounds,
      keyObjectId: keyObjectId,
    };
  }

  function resolveDraftDistributeVariant(mode) {
    var raw = String(mode || '').toLowerCase();
    if (raw.indexOf('centers') !== -1) {
      return 'centers';
    }
    if (raw.indexOf('edges') !== -1) {
      return 'edges';
    }
    return normalizeDraftDistributeMode(state.draftDistributeMode);
  }

  function resolveDraftDistributeAction(mode) {
    var raw = String(mode || '').toLowerCase();
    if (raw.indexOf('distribute-') !== 0) {
      return null;
    }

    var axis = raw.indexOf('-v') !== -1 ? 'y' : 'x';
    if (raw.indexOf('-h') !== -1) {
      axis = 'x';
    }

    return {
      axis: axis,
      variant: resolveDraftDistributeVariant(raw),
    };
  }

  function distributeDraftElements(context, axis, variant, options) {
    var dryRun = !!(options && options.dryRun);
    if (!context || !Array.isArray(context.items) || context.items.length < 2) {
      return dryRun ? null : false;
    }

    var keyId = context.reference === 'keyObject' ? String(context.keyObjectId || '') : '';
    var working = context.items.filter(function (item) {
      return !keyId || String(item.__id || '') !== keyId;
    });
    if (working.length < 2) {
      return dryRun ? null : false;
    }

    var safeVariant = normalizeDraftDistributeMode(variant);
    if (working.length <= 2) {
      safeVariant = 'spacing';
    }

    var isHorizontal = axis === 'x';
    var posKey = isHorizontal ? 'x' : 'y';
    var sizeKey = isHorizontal ? 'width' : 'height';

    function metricForItem(item) {
      var id = String(item && item.__id || '');
      var b = context.boundsById[id] || draftElementBounds(item);
      var start = Number(b[posKey] || 0);
      var size = Math.max(0, Number(b[sizeKey] || 0));
      var end = start + size;
      return {
        id: id,
        item: item,
        start: start,
        size: size,
        end: end,
        center: start + (size / 2),
      };
    }

    var keyMetrics = null;
    if (keyId) {
      var keyItem = context.items.find(function (item) {
        return String(item && item.__id || '') === keyId;
      });
      if (!keyItem) {
        return dryRun ? null : false;
      }
      keyMetrics = metricForItem(keyItem);
    }

    if (keyMetrics) {
      var otherMetrics = working.map(metricForItem).filter(function (m) {
        return !!m.id;
      });
      if (otherMetrics.length < 2) {
        return dryRun ? null : false;
      }

      var leftSide = [];
      var rightSide = [];

      otherMetrics.forEach(function (m) {
        if (m.end <= keyMetrics.start) {
          leftSide.push(m);
        } else if (m.start >= keyMetrics.end) {
          rightSide.push(m);
        } else if (m.center < keyMetrics.center) {
          leftSide.push(m);
        } else if (m.center > keyMetrics.center) {
          rightSide.push(m);
        } else if (m.start < keyMetrics.start) {
          leftSide.push(m);
        } else {
          rightSide.push(m);
        }
      });

      leftSide.sort(function (a, b) {
        return a.start - b.start;
      });
      rightSide.sort(function (a, b) {
        return a.start - b.start;
      });

      var targetById = {};

      function distributeSide(metrics, sideName) {
        if (!Array.isArray(metrics) || !metrics.length) {
          return;
        }

        if (safeVariant === 'centers') {
          if (metrics.length < 2) {
            return;
          }
          if (sideName === 'left') {
            var firstCenterL = metrics[0].center;
            var centerStepL = (keyMetrics.center - firstCenterL) / metrics.length;
            if (!Number.isFinite(centerStepL)) {
              return;
            }
            metrics.forEach(function (m, idx) {
              var wantedCenter = firstCenterL + (centerStepL * idx);
              targetById[m.id] = wantedCenter - (m.size / 2);
            });
            return;
          }

          var lastCenterR = metrics[metrics.length - 1].center;
          var centerStepR = (lastCenterR - keyMetrics.center) / metrics.length;
          if (!Number.isFinite(centerStepR)) {
            return;
          }
          metrics.forEach(function (m, idx) {
            var wantedCenter = keyMetrics.center + (centerStepR * (idx + 1));
            targetById[m.id] = wantedCenter - (m.size / 2);
          });
          return;
        }

        if (safeVariant === 'edges') {
          if (metrics.length < 2) {
            return;
          }
          if (sideName === 'left') {
            var firstEdgeL = metrics[0].start;
            var edgeStepL = (keyMetrics.start - firstEdgeL) / metrics.length;
            if (!Number.isFinite(edgeStepL)) {
              return;
            }
            metrics.forEach(function (m, idx) {
              targetById[m.id] = firstEdgeL + (edgeStepL * idx);
            });
            return;
          }

          var lastEdgeR = metrics[metrics.length - 1].start;
          var edgeStepR = (lastEdgeR - keyMetrics.start) / metrics.length;
          if (!Number.isFinite(edgeStepR)) {
            return;
          }
          metrics.forEach(function (m, idx) {
            targetById[m.id] = keyMetrics.start + (edgeStepR * (idx + 1));
          });
          return;
        }

        if (sideName === 'left') {
          var spanStartL = metrics[0].start;
          var spanEndL = keyMetrics.start;
          var totalSizeL = metrics.reduce(function (sum, m) {
            return sum + m.size;
          }, 0);
          var gapsL = metrics.length;
          var gapL = gapsL > 0 ? ((spanEndL - spanStartL - totalSizeL) / gapsL) : 0;
          if (!Number.isFinite(gapL)) {
            return;
          }
          var cursorL = spanStartL;
          metrics.forEach(function (m) {
            targetById[m.id] = cursorL;
            cursorL += m.size + gapL;
          });
          return;
        }

        var spanStartR = keyMetrics.end;
        var spanEndR = metrics[metrics.length - 1].end;
        var totalSizeR = metrics.reduce(function (sum, m) {
          return sum + m.size;
        }, 0);
        var gapsR = metrics.length;
        var gapR = gapsR > 0 ? ((spanEndR - spanStartR - totalSizeR) / gapsR) : 0;
        if (!Number.isFinite(gapR)) {
          return;
        }
        var cursorR = spanStartR + gapR;
        metrics.forEach(function (m) {
          targetById[m.id] = cursorR;
          cursorR += m.size + gapR;
        });
      }

      distributeSide(leftSide, 'left');
      distributeSide(rightSide, 'right');

      var applyKeyIds = Object.keys(targetById);
      if (!applyKeyIds.length) {
        return dryRun ? null : false;
      }

      if (dryRun) {
        return {
          axis: axis,
          variant: safeVariant,
          posKey: posKey,
          sizeKey: sizeKey,
          targetById: targetById,
        };
      }

      var applyKeySet = new Set(applyKeyIds);
      var changedKey = false;
      beginDraftHistoryTransaction();
      try {
        changedKey = applyToDraftElementIds(applyKeySet, function (draft) {
          var id = String(draft.__id || '');
          if (!Object.prototype.hasOwnProperty.call(targetById, id)) {
            return;
          }
          var b = context.boundsById[id] || draftElementBounds(draft);
          var delta = Number(targetById[id]) - Number(b[posKey] || 0);
          if (!Number.isFinite(delta) || Math.abs(delta) < 0.00001) {
            return;
          }

          if (isHorizontal) {
            draft.x = snapCanvasValueToGrid(Number(draft.x || 0) + delta, 'x');
          } else {
            draft.y = snapCanvasValueToGrid(Number(draft.y || 0) + delta, 'y');
          }
        });
      } finally {
        endDraftHistoryTransaction();
      }

      return changedKey;
    }

    var sortedMetrics = working.map(metricForItem).filter(function (m) {
      return !!m.id;
    }).sort(function (a, b) {
      return a.start - b.start;
    });
    if (sortedMetrics.length < 2) {
      return dryRun ? null : false;
    }

    var first = sortedMetrics[0];
    var last = sortedMetrics[sortedMetrics.length - 1];
    var targetById = {};
    var den = sortedMetrics.length - 1;
    var i;

    if (safeVariant === 'centers') {
      if (sortedMetrics.length < 3) {
        return dryRun ? null : false;
      }
      var centerStep = (last.center - first.center) / den;
      if (!Number.isFinite(centerStep)) {
        return dryRun ? null : false;
      }
      for (i = 1; i < (sortedMetrics.length - 1); i += 1) {
        var wantedCenter = first.center + (centerStep * i);
        targetById[sortedMetrics[i].id] = wantedCenter - (sortedMetrics[i].size / 2);
      }
    } else if (safeVariant === 'edges') {
      if (sortedMetrics.length < 3) {
        return dryRun ? null : false;
      }
      var edgeStep = (last.start - first.start) / den;
      if (!Number.isFinite(edgeStep)) {
        return dryRun ? null : false;
      }
      for (i = 1; i < (sortedMetrics.length - 1); i += 1) {
        targetById[sortedMetrics[i].id] = first.start + (edgeStep * i);
      }
    } else {
      if (sortedMetrics.length < 3) {
        return dryRun ? null : false;
      }
      var spanStart = first.start;
      var spanEnd = last.end;
      var totalSize = sortedMetrics.reduce(function (sum, m) {
        return sum + Math.max(0, Number(m.size || 0));
      }, 0);
      var gap = (spanEnd - spanStart - totalSize) / den;
      if (!Number.isFinite(gap)) {
        return dryRun ? null : false;
      }

      var cursor = first.end + gap;
      for (i = 1; i < (sortedMetrics.length - 1); i += 1) {
        targetById[sortedMetrics[i].id] = cursor;
        cursor += sortedMetrics[i].size + gap;
      }
    }

    var applyIds = new Set(Object.keys(targetById));
    if (!applyIds.size) {
      return dryRun ? null : false;
    }

    if (dryRun) {
      return {
        axis: axis,
        variant: safeVariant,
        posKey: posKey,
        sizeKey: sizeKey,
        targetById: targetById,
      };
    }

    var changed = false;
    beginDraftHistoryTransaction();
    try {
      changed = applyToDraftElementIds(applyIds, function (draft) {
        var id = String(draft.__id || '');
        if (!Object.prototype.hasOwnProperty.call(targetById, id)) {
          return;
        }
        var b = context.boundsById[id] || draftElementBounds(draft);
        var delta = Number(targetById[id]) - Number(b[posKey] || 0);
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.00001) {
          return;
        }

        if (isHorizontal) {
          draft.x = snapCanvasValueToGrid(Number(draft.x || 0) + delta, 'x');
        } else {
          draft.y = snapCanvasValueToGrid(Number(draft.y || 0) + delta, 'y');
        }
      });
    } finally {
      endDraftHistoryTransaction();
    }

    return changed;
  }

  function alignSelectedDraftElements(mode) {
    var safeMode = String(mode || '').toLowerCase();
    var context = resolveDraftAlignContext(safeMode);
    if (!context || !context.items.length) {
      return false;
    }

    if (safeMode.indexOf('distribute-') === 0) {
      var distributeAction = resolveDraftDistributeAction(safeMode);
      if (!distributeAction) {
        return false;
      }
      return distributeDraftElements(context, distributeAction.axis, distributeAction.variant);
    }

    var ref = context.referenceBounds || context.selectionBounds;
    var targetX = null;
    var targetY = null;

    if (safeMode === 'align-left') {
      targetX = Number(ref.x || 0);
    } else if (safeMode === 'align-right') {
      targetX = Number(ref.x || 0) + Number(ref.width || 0);
    } else if (safeMode === 'align-h-center') {
      targetX = Number(ref.x || 0) + (Number(ref.width || 0) / 2);
    } else if (safeMode === 'align-top') {
      targetY = Number(ref.y || 0);
    } else if (safeMode === 'align-bottom') {
      targetY = Number(ref.y || 0) + Number(ref.height || 0);
    } else if (safeMode === 'align-v-center') {
      targetY = Number(ref.y || 0) + (Number(ref.height || 0) / 2);
    } else if (safeMode === 'canvas-center') {
      targetX = Number(ref.x || 0) + (Number(ref.width || 0) / 2);
      targetY = Number(ref.y || 0) + (Number(ref.height || 0) / 2);
    } else {
      return false;
    }

    var skipKeyId = context.reference === 'keyObject' ? String(context.keyObjectId || '') : '';
    var changed = false;
    beginDraftHistoryTransaction();
    try {
      changed = applyToDraftElementIds(context.itemIdSet, function (draft) {
        var id = String(draft.__id || '');
        if (skipKeyId && id === skipKeyId) {
          return;
        }

        var b = context.boundsById[id] || draftElementBounds(draft);
        var nextX = Number(draft.x || 0);
        var nextY = Number(draft.y || 0);
        var moveX = false;
        var moveY = false;

        if (targetX !== null) {
          var currentX = safeMode === 'align-left'
            ? Number(b.x || 0)
            : (safeMode === 'align-right'
              ? (Number(b.x || 0) + Number(b.width || 0))
              : (Number(b.x || 0) + (Number(b.width || 0) / 2)));
          var deltaX = targetX - currentX;
          if (Number.isFinite(deltaX) && Math.abs(deltaX) > 0.00001) {
            nextX = Number(draft.x || 0) + deltaX;
            moveX = true;
          }
        }

        if (targetY !== null) {
          var currentY = safeMode === 'align-top'
            ? Number(b.y || 0)
            : (safeMode === 'align-bottom'
              ? (Number(b.y || 0) + Number(b.height || 0))
              : (Number(b.y || 0) + (Number(b.height || 0) / 2)));
          var deltaY = targetY - currentY;
          if (Number.isFinite(deltaY) && Math.abs(deltaY) > 0.00001) {
            nextY = Number(draft.y || 0) + deltaY;
            moveY = true;
          }
        }

        if (moveX) {
          draft.x = snapCanvasValueToGrid(nextX, 'x');
        }
        if (moveY) {
          draft.y = snapCanvasValueToGrid(nextY, 'y');
        }
      });
    } finally {
      endDraftHistoryTransaction();
    }

    return changed;
  }

  function applyDraftLayerOrderByIds(orderedIds) {
    ensureStep2DraftInitialized();
    var elements = Array.isArray(state.templateDraft && state.templateDraft.elements)
      ? state.templateDraft.elements
      : [];
    if (!elements.length || !Array.isArray(orderedIds) || !orderedIds.length) {
      return false;
    }

    var byId = {};
    elements.forEach(function (item) {
      var id = String(item && item.__id || '');
      if (id) {
        byId[id] = item;
      }
    });

    var nextElements = [];
    orderedIds.forEach(function (id, idx) {
      var sid = String(id || '');
      var src = byId[sid];
      if (!src) {
        return;
      }
      var draft = Object.assign({}, src);
      draft.zIndex = idx + 1;
      var normalized = normalizeDraftElement(draft, idx);
      normalized.__id = src.__id;
      nextElements.push(normalized);
      delete byId[sid];
    });

    Object.keys(byId).forEach(function (id) {
      var src = byId[id];
      if (!src) {
        return;
      }
      var idx = nextElements.length;
      var draft = Object.assign({}, src);
      draft.zIndex = idx + 1;
      var normalized = normalizeDraftElement(draft, idx);
      normalized.__id = src.__id;
      nextElements.push(normalized);
    });

    var prevIds = sortDraftElementsByZIndex(elements).map(function (item) {
      return String(item && item.__id || '');
    });
    var nextIds = nextElements.map(function (item) {
      return String(item && item.__id || '');
    });
    if (prevIds.join('|') === nextIds.join('|')) {
      return false;
    }

    state.templateDraft.elements = nextElements;
    normalizeDraftElementSelection();
    markDraftDirty();
    return true;
  }

  function moveSelectedDraftLayers(mode) {
    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();

    var selected = selectedDraftElementSet();
    if (!selected.size) {
      return false;
    }

    var ordered = sortDraftElementsByZIndex(state.templateDraft.elements || []);
    if (ordered.length < 2) {
      return false;
    }

    var ids = ordered.map(function (item) {
      return String(item && item.__id || '');
    }).filter(function (id) {
      return !!id;
    });
    if (!ids.length) {
      return false;
    }

    var selectedIds = new Set(ids.filter(function (id) {
      return selected.has(id);
    }));
    if (!selectedIds.size) {
      return false;
    }

    var safeMode = String(mode || '').toLowerCase();
    var nextIds = ids.slice();
    var changed = false;

    function selectedBlocks() {
      var indices = [];
      nextIds.forEach(function (id, idx) {
        if (selectedIds.has(id)) {
          indices.push(idx);
        }
      });
      if (!indices.length) {
        return [];
      }
      var blocks = [];
      var blockStart = indices[0];
      var prev = indices[0];
      for (var i = 1; i < indices.length; i += 1) {
        var at = indices[i];
        if (at === prev + 1) {
          prev = at;
          continue;
        }
        blocks.push({ start: blockStart, end: prev });
        blockStart = at;
        prev = at;
      }
      blocks.push({ start: blockStart, end: prev });
      return blocks;
    }

    if (safeMode === 'forward') {
      var forwardBlocks = selectedBlocks();
      for (var f = forwardBlocks.length - 1; f >= 0; f -= 1) {
        var fb = forwardBlocks[f];
        if (fb.end >= (nextIds.length - 1)) {
          continue;
        }
        var forwardChunk = nextIds.splice(fb.start, (fb.end - fb.start + 1));
        Array.prototype.splice.apply(nextIds, [fb.start + 1, 0].concat(forwardChunk));
        changed = true;
      }
    } else if (safeMode === 'backward') {
      var backwardBlocks = selectedBlocks();
      backwardBlocks.forEach(function (bb) {
        if (bb.start <= 0) {
          return;
        }
        var backChunk = nextIds.splice(bb.start, (bb.end - bb.start + 1));
        Array.prototype.splice.apply(nextIds, [bb.start - 1, 0].concat(backChunk));
        changed = true;
      });
    } else if (safeMode === 'front') {
      var unselectedFront = nextIds.filter(function (id) {
        return !selectedIds.has(id);
      });
      var selectedFront = nextIds.filter(function (id) {
        return selectedIds.has(id);
      });
      var mergedFront = unselectedFront.concat(selectedFront);
      changed = mergedFront.join('|') !== nextIds.join('|');
      nextIds = mergedFront;
    } else if (safeMode === 'back') {
      var selectedBack = nextIds.filter(function (id) {
        return selectedIds.has(id);
      });
      var unselectedBack = nextIds.filter(function (id) {
        return !selectedIds.has(id);
      });
      var mergedBack = selectedBack.concat(unselectedBack);
      changed = mergedBack.join('|') !== nextIds.join('|');
      nextIds = mergedBack;
    } else {
      return false;
    }

    if (!changed) {
      return false;
    }

    var didApply = false;
    beginDraftHistoryTransaction();
    try {
      prepareDraftHistoryMutation();
      didApply = applyDraftLayerOrderByIds(nextIds);
    } finally {
      endDraftHistoryTransaction();
    }

    return didApply;
  }

  function reorderDraftLayerByIds(sourceId, targetId, placeAfter) {
    var source = String(sourceId || '');
    var target = String(targetId || '');
    if (!source || !target || source === target) {
      return false;
    }

    ensureStep2DraftInitialized();
    var ordered = sortDraftElementsByZIndex(state.templateDraft.elements || []);
    var ids = ordered.map(function (item) {
      return String(item && item.__id || '');
    }).filter(function (id) {
      return !!id;
    });
    var sourceIndex = ids.indexOf(source);
    var targetIndex = ids.indexOf(target);
    if (sourceIndex === -1 || targetIndex === -1) {
      return false;
    }

    var moved = ids.splice(sourceIndex, 1)[0];
    var refreshedTargetIndex = ids.indexOf(target);
    var insertAt = refreshedTargetIndex + (placeAfter ? 1 : 0);
    ids.splice(insertAt, 0, moved);

    var didApply = false;
    beginDraftHistoryTransaction();
    try {
      prepareDraftHistoryMutation();
      didApply = applyDraftLayerOrderByIds(ids);
    } finally {
      endDraftHistoryTransaction();
    }

    return didApply;
  }

  function setDraftLayerVisibility(id, visible) {
    var wanted = String(id || '');
    if (!wanted) {
      return false;
    }
    var nextVisible = visible !== false;
    var changed = false;
    beginDraftHistoryTransaction();
    try {
      changed = mutateDraftElementById(wanted, function (draft) {
        draft.visible = nextVisible;
      });
      if (!nextVisible) {
        clearDraftInlineTextEditing();
      }
      normalizeDraftElementSelection();
    } finally {
      endDraftHistoryTransaction();
    }
    return changed;
  }

  function setDraftLayerLocked(id, locked) {
    var wanted = String(id || '');
    if (!wanted) {
      return false;
    }
    var nextLocked = !!locked;
    var changed = false;
    beginDraftHistoryTransaction();
    try {
      changed = mutateDraftElementById(wanted, function (draft) {
        draft.locked = nextLocked;
      });
      if (nextLocked) {
        clearDraftInlineTextEditing();
      }
      normalizeDraftElementSelection();
    } finally {
      endDraftHistoryTransaction();
    }
    return changed;
  }

  function draftElementVisibleOnSide(item, side) {
    if (!isDraftElementVisible(item)) {
      return false;
    }
    var itemSide = String(item && item.side || 'front').toLowerCase();
    var wanted = String(side || 'front').toLowerCase();
    return itemSide === 'both' || itemSide === wanted;
  }

  function syncDraftToSelectedTemplate() {
    if (!state.templateDraft || typeof state.templateDraft !== 'object') {
      return;
    }

    if (!state.selectedTemplate || typeof state.selectedTemplate !== 'object') {
      state.selectedTemplate = { id: null, version: 1 };
    }

    state.selectedTemplate.name = String(state.templateDraftName || state.selectedTemplate.name || 'New Template');
    state.selectedTemplate.template_json = templateJsonForApi(state.templateDraft);
    state.selectedTemplate.is_two_sided = !!state.isTwoSided;
  }

  function markDraftDirty() {
    state.draftDirty = true;
    syncDraftToSelectedTemplate();
  }

  function sanitizeTextElementLabelForField(fieldName, currentLabel) {
    var field = findTableFieldByName(fieldName);
    var fallback = field ? fieldLabelForUi(field.name) : String(fieldName || '').trim();
    var next = String(currentLabel || '').trim();
    if (!next || /^\{\{.*\}\}$/.test(next)) {
      return fallback;
    }
    return next;
  }

  function normalizeAutoMapScope(rawScope) {
    var scope = String(rawScope || '').trim().toLowerCase();
    if (scope === 'front' || scope === 'back' || scope === 'all' || scope === 'active') {
      return scope;
    }
    return 'active';
  }

  function draftElementMatchesAutoMapScope(item, scope) {
    var wanted = normalizeAutoMapScope(scope);
    if (wanted === 'all') {
      return true;
    }
    if (wanted === 'active') {
      return draftElementVisibleOnSide(item, state.draftActiveSide === 'back' ? 'back' : 'front');
    }
    return draftElementVisibleOnSide(item, wanted);
  }

  function autoMapDraftFields(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var scope = normalizeAutoMapScope(opts.scope || state.draftAutoMapScope || 'active');
    ensureStep2DraftInitialized();
    if (!Array.isArray(state.templateDraft.elements) || !state.templateDraft.elements.length) {
      return {
        scope: scope,
        checked: 0,
        mappedCount: 0,
        imageMappedCount: 0,
        mapped: [],
        unchanged: [],
        skippedManual: [],
        skippedNoLabel: [],
        ambiguous: [],
        unmatched: [],
      };
    }

    prepareDraftHistoryMutation();
    var report = {
      scope: scope,
      checked: 0,
      mappedCount: 0,
      imageMappedCount: 0,
      mapped: [],
      unchanged: [],
      skippedManual: [],
      skippedNoLabel: [],
      ambiguous: [],
      unmatched: [],
    };

    var bestImageField = findBestImageSchemaFieldForAutoMap();
    var changed = false;
    var historyPrepared = false;

    function ensureHistoryPrepared() {
      if (historyPrepared) {
        return;
      }
      prepareDraftHistoryMutation();
      historyPrepared = true;
    }

    state.templateDraft.elements = state.templateDraft.elements.map(function (item, idx) {
      if (!item || typeof item !== 'object') {
        return item;
      }

      if (!draftElementMatchesAutoMapScope(item, scope)) {
        return item;
      }

      var itemType = String(item.type || '').toLowerCase();
      if (itemType !== 'text' && itemType !== 'image') {
        return item;
      }

      report.checked += 1;
      var draft = Object.assign({}, item);
      var existingField = String(draft.field || '').trim();
      var itemSide = String(item.side || 'front').toLowerCase();
      if (itemSide !== 'front' && itemSide !== 'back' && itemSide !== 'both') {
        itemSide = 'front';
      }

      if (itemType === 'image') {
        var existingImageField = existingField ? findTableFieldByName(existingField) : null;
        if (existingImageField && isImageCompatibleSchemaField(existingImageField)) {
          report.unchanged.push({
            id: String(item.__id || ''),
            label: String(draft.label || '').trim() || 'Photo Slot',
            field: existingImageField.name,
            side: itemSide,
          });
          return item;
        }

        if (!isAutoMapPhotoSlot(draft)) {
          return item;
        }

        if (!bestImageField) {
          report.unmatched.push({
            id: String(item.__id || ''),
            label: String(draft.label || '').trim() || 'Photo Slot',
            side: itemSide,
          });
          return item;
        }

        var bestImageFieldName = String(bestImageField.name || '').trim();
        if (!bestImageFieldName) {
          return item;
        }
        if (normalizeFieldLookupKey(existingField) === normalizeFieldLookupKey(bestImageFieldName)) {
          report.unchanged.push({
            id: String(item.__id || ''),
            label: String(draft.label || '').trim() || 'Photo Slot',
            field: bestImageFieldName,
            side: itemSide,
          });
          return item;
        }

        draft.field = bestImageFieldName;
        draft.showLabel = false;

        ensureHistoryPrepared();
        var normalizedImage = normalizeDraftElement(draft, idx);
        normalizedImage.__id = item.__id;
        changed = true;
        report.imageMappedCount += 1;
        report.mapped.push({
          id: String(item.__id || ''),
          label: String(draft.label || '').trim() || 'Photo Slot',
          field: bestImageFieldName,
          side: itemSide,
          score: 200,
        });
        return normalizedImage;
      }

      var label = String(draftTextValue(draft) || '');
      var tokenNames = extractMergeTokenFieldNames(label);
      if (!tokenNames.length) {
        if (existingField) {
          report.skippedManual.push({
            id: String(item.__id || ''),
            label: String(label || '').trim(),
            field: existingField,
            side: itemSide,
          });
        } else {
          report.skippedNoLabel.push({
            id: String(item.__id || ''),
            label: String(label || '').trim(),
            side: itemSide,
          });
        }
        return item;
      }

      var resolvedNames = [];
      var missingNames = [];
      tokenNames.forEach(function (tokenName) {
        var matched = findTableFieldByName(tokenName);
        if (matched && matched.name) {
          resolvedNames.push(String(matched.name));
        } else {
          missingNames.push(String(tokenName));
        }
      });

      if (missingNames.length) {
        report.unmatched.push({
          id: String(item.__id || ''),
          label: String(label || '').trim() || '(empty label)',
          side: itemSide,
          candidates: missingNames.map(function (name) {
            return {
              name: String(name || ''),
              label: String(name || ''),
              score: 0,
            };
          }),
        });
        return item;
      }

      var tokenFieldSummary = resolvedNames.join(', ');
      report.mapped.push({
        id: String(item.__id || ''),
        label: String(label || '').trim() || '(token text)',
        field: tokenFieldSummary,
        side: itemSide,
        score: 200,
      });

      var needsReset = false;
      if (existingField) {
        draft.field = '';
        needsReset = true;
      }
      if (draft.showLabel !== false) {
        draft.showLabel = false;
        needsReset = true;
      }

      if (!needsReset) {
        return item;
      }

      ensureHistoryPrepared();
      var normalized = normalizeDraftElement(draft, idx);
      normalized.__id = item.__id;
      changed = true;
      return normalized;
    });

    report.mappedCount = report.mapped.length;
    if (changed) {
      clearDraftInlineTextEditing();
      normalizeDraftElementSelection();
      markDraftDirty();
    }

    return report;
  }

  function syncSelectedElementField(rawFieldName) {
    var current = selectedDraftElement();
    if (!current) {
      return false;
    }

    var wantedField = String(rawFieldName || '').trim();
    var fieldMeta = wantedField ? findTableFieldByName(wantedField) : null;
    if (wantedField && !fieldMeta) {
      showToast('Selected field is not available in this table schema.', 'warning');
      return false;
    }

    var patch = { field: fieldMeta ? String(fieldMeta.name || '') : '' };

    if (String(current.type || '').toLowerCase() === 'text') {
      if (fieldMeta) {
        patch.label = sanitizeTextElementLabelForField(fieldMeta.name, current.label);
      }
      if (!fieldMeta && !String(current.label || '').trim()) {
        patch.label = '';
      }
    }

    if (String(current.type || '').toLowerCase() === 'image') {
      if (fieldMeta) {
        if (!isImageCompatibleSchemaField(fieldMeta)) {
          showToast('This field is not image-compatible.', 'warning');
          return false;
        }
        patch.src = '';
      }
    }

    updateSelectedDraftElement(patch);
    return true;
  }

  function insertPhotoFieldElement(rawFieldName) {
    ensureStep2DraftInitialized();

    var wantedField = String(rawFieldName || '').trim();
    if (!wantedField) {
      showToast('Select an image field to insert.', 'warning');
      return false;
    }

    var fieldMeta = findTableFieldByName(wantedField);
    if (!fieldMeta) {
      showToast('Selected image field is not available.', 'warning');
      return false;
    }
    if (!isImageCompatibleSchemaField(fieldMeta)) {
      showToast('Selected field is not image-compatible.', 'warning');
      return false;
    }

    var active = selectedDraftElement();
    if (active && String(active.type || '').toLowerCase() === 'image') {
      if (syncSelectedElementField(fieldMeta.name)) {
        updateSelectedDraftElement({
          imageKind: '',
          showLabel: false,
          label: fieldLabelForUi(fieldMeta.name),
        });
        showToast('Image field applied to selected image element.', 'success');
        return true;
      }
      return false;
    }

    addPhotoPlaceholderElement({
      field: fieldMeta.name,
      side: state.draftActiveSide,
      showLabel: false,
      imageKind: '',
      label: fieldLabelForUi(fieldMeta.name),
    });
    showToast('Photo field inserted.', 'success');
    return true;
  }

  function toggleSelectedTextStyle(styleName) {
    var selectedText = selectedDraftElement();
    if (!selectedText || String(selectedText.type || '').toLowerCase() !== 'text') {
      return false;
    }

    var style = String(styleName || '').toLowerCase();
    if (style === 'bold') {
      var isBold = Number(selectedText.fontWeight || 400) >= 600;
      updateSelectedDraftElement({ fontWeight: isBold ? '400' : '700' });
      return true;
    }
    if (style === 'italic') {
      var isItalic = String(selectedText.fontStyle || 'normal').toLowerCase() === 'italic';
      updateSelectedDraftElement({ fontStyle: isItalic ? 'normal' : 'italic' });
      return true;
    }
    return false;
  }

  function addDraftElement(type, options) {
    options = options || {};
    ensureStep2DraftInitialized();
    var baseType = type === 'image'
      ? 'image'
      : (type === 'rectangle' ? 'rectangle' : 'text');
    var nextIndex = state.templateDraft.elements.length;

    var defaultWidth = baseType === 'image' ? 86 : (baseType === 'rectangle' ? 96 : 96);
    var defaultHeight = baseType === 'image' ? 68 : (baseType === 'rectangle' ? 58 : 24);
    var defaultX = 16 + ((nextIndex * 10) % 60);
    var defaultY = 16 + ((nextIndex * 10) % 60);
    var hasLabelOption = Object.prototype.hasOwnProperty.call(options, 'label');
    var hasTextOption = Object.prototype.hasOwnProperty.call(options, 'text');
    var textType = normalizeDraftTextType(options.textType || options.textMode || (baseType === 'text' ? 'artistic' : ''));
    var textValue = hasTextOption
      ? String(options.text || '')
      : (hasLabelOption ? String(options.label || '') : '');

    var itemDraft = {
      type: baseType,
      zIndex: maxDraftElementZIndex() + 1,
      label: baseType === 'text'
        ? textValue
        : (hasLabelOption ? String(options.label) : (
        baseType === 'image'
          ? 'Image ' + String(nextIndex + 1)
          : (baseType === 'rectangle' ? 'Rectangle ' + String(nextIndex + 1) : '')
      )),
      text: baseType === 'text' ? textValue : '',
      field: String(options.field || ''),
      side: String(options.side || state.draftActiveSide || 'front'),
      width: Number(options.width || defaultWidth),
      height: Number(options.height || defaultHeight),
      x: Number(options.x || defaultX),
      y: Number(options.y || defaultY),
      scaleX: baseType === 'text' ? clampDraftScale(options.scaleX) : 1,
      scaleY: baseType === 'text' ? clampDraftScale(options.scaleY) : 1,
      rotation: baseType === 'text' ? normalizeDraftAngle(options.rotation) : 0,
      skewX: baseType === 'text' ? normalizeDraftAngle(options.skewX) : 0,
      skewY: baseType === 'text' ? normalizeDraftAngle(options.skewY) : 0,
      fontFamily: String(options.fontFamily || 'Arial'),
      fontGroup: String(options.fontGroup || 'arial'),
      fontFace: String(options.fontFace || 'regular'),
      fontWeight: String(options.fontWeight || '400'),
      fontStyle: String(options.fontStyle || 'normal'),
      fontSize: Number(options.fontSize || DRAFT_DEFAULT_FONT_PT),
      textAlign: String(options.textAlign || 'left'),
      lineHeight: Number(options.lineHeight || 1.2),
      letterSpacing: Number(options.letterSpacing || 0),
      color: String(options.color || '#1e293b'),
      textType: baseType === 'text' ? textType : '',
      textMode: baseType === 'text' ? textType : '',
      imageKind: String(options.imageKind || ''),
      src: baseType === 'image' ? String(options.src || '') : '',
      showLabel: options.showLabel !== false,
    };

    if (baseType === 'text' && normalizeDraftTextType(itemDraft.textType) === 'artistic' && options.autoFitArtistic === true) {
      fitDraftArtisticTextBounds(itemDraft);
    }

    prepareDraftHistoryMutation();
    var item = normalizeDraftElement(itemDraft, nextIndex);
    state.templateDraft.elements.push(item);
    state.draftSelectedElementId = item.__id;
    state.draftSelectedElementIds = new Set([item.__id]);
    markDraftDirty();
    return item;
  }

  function addPhotoPlaceholderElement(options) {
    options = options || {};
    ensureStep2DraftInitialized();
    var metrics = draftCanvasMetrics();
    var real = draftRealDimensionsMm();
    var width = Math.max(12, (19 / real.widthMm) * metrics.width);
    var height = Math.max(12, (25 / real.heightMm) * metrics.height);

    var x = (metrics.width - width) / 2;
    var y = (metrics.height - height) / 2;
    if (options.atPoint) {
      var px = Number(options.x || (metrics.width / 2));
      var py = Number(options.y || (metrics.height / 2));
      if (!Number.isFinite(px)) {
        px = metrics.width / 2;
      }
      if (!Number.isFinite(py)) {
        py = metrics.height / 2;
      }
      x = px - (width / 2);
      y = py - (height / 2);
    }

    var fieldName = String(options.field || '').trim();
    var fieldMeta = fieldName ? findTableFieldByName(fieldName) : null;

    addDraftElement('image', {
      label: String(options.label || (fieldMeta ? fieldLabelForUi(fieldMeta.name) : 'Photo 19 x 25 mm')),
      field: fieldMeta ? String(fieldMeta.name || '') : '',
      imageKind: String(options.imageKind || (fieldMeta ? '' : 'photo_19x25')),
      showLabel: options.showLabel !== false,
      width: width,
      height: height,
      x: x,
      y: y,
      side: String(options.side || state.draftActiveSide),
      color: '#0369a1',
    });
  }

  function updateDraftCanvasSize(widthInput, heightInput, realSizeMm) {
    ensureStep2DraftInitialized();
    prepareDraftHistoryMutation();
    var metrics = draftCanvasMetrics();

    var nextWidth = Number(widthInput);
    var nextHeight = Number(heightInput);

    if (!Number.isFinite(nextWidth)) {
      nextWidth = metrics.width;
    }
    if (!Number.isFinite(nextHeight)) {
      nextHeight = metrics.height;
    }

    nextWidth = Math.max(120, Math.min(3000, Math.round(nextWidth)));
    nextHeight = Math.max(80, Math.min(3000, Math.round(nextHeight)));

    if (!state.templateDraft.canvas || typeof state.templateDraft.canvas !== 'object') {
      state.templateDraft.canvas = { width: nextWidth, height: nextHeight, guides: [] };
    }

    state.templateDraft.canvas.width = nextWidth;
    state.templateDraft.canvas.height = nextHeight;
    if (realSizeMm && typeof realSizeMm === 'object') {
      var rw = Number(realSizeMm.widthMm);
      var rh = Number(realSizeMm.heightMm);
      if (Number.isFinite(rw) && rw > 0) {
        state.templateDraft.canvas.realWidthMM = rw;
      }
      if (Number.isFinite(rh) && rh > 0) {
        state.templateDraft.canvas.realHeightMM = rh;
      }
    }
    if (!Array.isArray(state.templateDraft.canvas.guides)) {
      state.templateDraft.canvas.guides = [];
    }
    state.templateDraft.canvas.guides = state.templateDraft.canvas.guides.map(function (guide) {
      return normalizeDraftGuide(guide);
    });

    state.templateDraft.elements = (state.templateDraft.elements || []).map(function (item, idx) {
      return normalizeDraftElement(item, idx);
    });
    if (state.draftSelectedElementId) {
      var stillExists = state.templateDraft.elements.some(function (item) {
        return item && item.__id === state.draftSelectedElementId;
      });
      if (!stillExists) {
        state.draftSelectedElementId = state.templateDraft.elements.length
          ? state.templateDraft.elements[0].__id
          : '';
      }
    }

    state.orientation = draftReferenceOrientation({
      width: nextWidth,
      height: nextHeight,
    });

    markDraftDirty();
  }

  function switchDraftCanvasOrientation(nextOrientation) {
    ensureStep2DraftInitialized();

    var wanted = normalizeOrientation(nextOrientation);
    var metrics = draftCanvasMetrics();
    var currentOrientation = draftReferenceOrientation(metrics);
    var shouldSwap = (wanted === 'portrait' && currentOrientation !== 'portrait')
      || (wanted === 'landscape' && currentOrientation !== 'landscape');

    var nextWidth = Number(metrics.width || 0);
    var nextHeight = Number(metrics.height || 0);
    if (shouldSwap) {
      var swap = nextWidth;
      nextWidth = nextHeight;
      nextHeight = swap;
    }

    var real = draftRealDimensionsMm();
    var nextReal = {
      widthMm: Number(real.widthMm || 0),
      heightMm: Number(real.heightMm || 0),
    };
    if (shouldSwap) {
      var swapMm = nextReal.widthMm;
      nextReal.widthMm = nextReal.heightMm;
      nextReal.heightMm = swapMm;
    }

    updateDraftCanvasSize(nextWidth, nextHeight, nextReal);
    state.orientation = wanted;
  }

  function resolveDualSidePoint(xCombined, layout) {
    var side = 'front';
    var x = Number(xCombined || 0);

    if (!state.isTwoSided) {
      return {
        side: 'front',
        x: x,
      };
    }

    if (x >= layout.cardWidth) {
      side = 'back';
      x = x - layout.cardWidth;
    }

    return {
      side: side,
      x: x,
    };
  }

  function draftCanvasSideDisplayWidthPx(rect) {
    var width = Number(rect && rect.width || 0);
    if (!Number.isFinite(width) || width <= 0) {
      width = 1;
    }
    var sides = state.isTwoSided ? 2 : 1;
    return width / sides;
  }

  function canvasEventToDraftPoint(canvasEl, event, options) {
    options = options || {};
    var metrics = draftCanvasMetrics();
    var layout = draftCanvasLayoutMetrics(metrics);
    var rect = canvasEl.getBoundingClientRect();
    var xPx = Number(event.clientX || 0) - rect.left;
    var yPx = Number(event.clientY || 0) - rect.top;

    var xCombined = (xPx / Math.max(1, rect.width)) * layout.totalWidth;
    var y = (yPx / Math.max(1, rect.height)) * layout.totalHeight;

    var sidePoint = resolveDualSidePoint(xCombined, layout);
    var side = sidePoint.side;
    var x = sidePoint.x;

    if (!Number.isFinite(x)) x = metrics.width / 2;
    if (!Number.isFinite(y)) y = metrics.height / 2;
    if (!Number.isFinite(xCombined)) xCombined = x;

    if (options.allowOutside) {
      if (state.isTwoSided) {
        if (xCombined < 0) {
          side = 'front';
          x = xCombined;
        } else if (xCombined > layout.totalWidth) {
          side = 'back';
          x = xCombined - layout.cardWidth;
        }
      }

      return {
        x: x,
        y: y,
        side: side,
        metrics: metrics,
        rect: rect,
      };
    }

    x = Math.max(0, Math.min(layout.cardWidth, x));
    y = Math.max(0, Math.min(layout.cardHeight, y));

    if (state.isTwoSided) {
      if (xCombined <= 0) {
        side = 'front';
        x = 0;
      } else if (xCombined >= layout.totalWidth) {
        side = 'back';
        x = layout.cardWidth;
      }
    }

    return {
      x: x,
      y: y,
      side: side,
      metrics: metrics,
      rect: rect,
    };
  }

  function getActiveDraftCanvasEl() {
    if (!flowRoot) {
      return null;
    }
    return flowRoot.querySelector('.gc-step2-canvas');
  }

  function getActiveStageContentEl() {
    if (!flowRoot) {
      return null;
    }
    return flowRoot.querySelector('.gc-step2-stage-content');
  }

  function resolveDraftCanvasEl(canvasEl) {
    if (canvasEl && document.body.contains(canvasEl)) {
      return canvasEl;
    }
    return getActiveDraftCanvasEl();
  }

  function resolveStageContentEl(stageEl) {
    if (stageEl && document.body.contains(stageEl)) {
      return stageEl;
    }
    return getActiveStageContentEl();
  }

  function setSpacePanUiState() {
    var stageEl = getActiveStageContentEl();
    if (!stageEl) {
      return;
    }
    stageEl.classList.toggle('is-zoom-mode', !!state.zoomWheelMode && !state.spacePanMode);
    stageEl.classList.toggle('is-space-pan', !!state.spacePanMode);
    stageEl.classList.toggle('is-panning', !!state.spacePanState);
  }

  function captureZoomAnchorFromClient(clientX, clientY) {
    if (state.step !== 2) {
      return false;
    }

    var stageEl = getActiveStageContentEl();
    var canvasEl = getActiveDraftCanvasEl();
    if (!stageEl || !canvasEl) {
      return false;
    }

    var stageRect = stageEl.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) {
      return false;
    }

    var cx = Number(clientX || 0);
    var cy = Number(clientY || 0);
    var ratioX = (cx - stageRect.left) / Math.max(1, stageRect.width);
    var ratioY = (cy - stageRect.top) / Math.max(1, stageRect.height);
    ratioX = Math.max(0, Math.min(1, ratioX));
    ratioY = Math.max(0, Math.min(1, ratioY));

    var draftPoint = canvasEventToDraftPoint(canvasEl, { clientX: cx, clientY: cy }, { allowOutside: true });
    var metrics = draftPoint && draftPoint.metrics ? draftPoint.metrics : draftCanvasMetrics();
    var canvasRatioX = Number(draftPoint && draftPoint.x || 0) / Math.max(1, Number(metrics.width || 1));
    var canvasRatioY = Number(draftPoint && draftPoint.y || 0) / Math.max(1, Number(metrics.height || 1));
    canvasRatioX = Math.max(0, Math.min(1, canvasRatioX));
    canvasRatioY = Math.max(0, Math.min(1, canvasRatioY));
    state.draftZoomOriginX = canvasRatioX * 100;
    state.draftZoomOriginY = canvasRatioY * 100;

    state.pendingZoomAnchor = {
      canvasX: Number(draftPoint.x || 0),
      canvasY: Number(draftPoint.y || 0),
      stageRatioX: ratioX,
      stageRatioY: ratioY,
    };
    return true;
  }

  function captureViewportCenterZoomAnchor() {
    var stageEl = getActiveStageContentEl();
    if (!stageEl) {
      return false;
    }
    var rect = stageEl.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return false;
    }
    return captureZoomAnchorFromClient(rect.left + (rect.width / 2), rect.top + (rect.height / 2));
  }

  function applyPendingZoomAnchor() {
    var anchor = state.pendingZoomAnchor;
    if (!anchor || state.step !== 2) {
      state.pendingZoomAnchor = null;
      return;
    }
    state.pendingZoomAnchor = null;

    window.requestAnimationFrame(function () {
      var stageEl = getActiveStageContentEl();
      var canvasEl = getActiveDraftCanvasEl();
      if (!stageEl || !canvasEl) {
        return;
      }

      var stageRect = stageEl.getBoundingClientRect();
      var canvasRect = canvasEl.getBoundingClientRect();
      if (!stageRect.width || !stageRect.height || !canvasRect.width || !canvasRect.height) {
        return;
      }

      var metrics = draftCanvasMetrics();
      var ratioX = Number(anchor.canvasX || 0) / Math.max(1, metrics.width);
      var ratioY = Number(anchor.canvasY || 0) / Math.max(1, metrics.height);
      var pointClientX = canvasRect.left + (ratioX * canvasRect.width);
      var pointClientY = canvasRect.top + (ratioY * canvasRect.height);

      var desiredRatioX = Math.max(0, Math.min(1, Number(anchor.stageRatioX || 0.5)));
      var desiredRatioY = Math.max(0, Math.min(1, Number(anchor.stageRatioY || 0.5)));
      var desiredClientX = stageRect.left + (desiredRatioX * stageRect.width);
      var desiredClientY = stageRect.top + (desiredRatioY * stageRect.height);

      stageEl.scrollLeft += (pointClientX - desiredClientX);
      stageEl.scrollTop += (pointClientY - desiredClientY);
    });
  }

  function setDraftZoomWithAnchor(nextZoom, anchorEvent) {
    if (state.step === 2) {
      var anchored = false;
      if (anchorEvent && Number.isFinite(Number(anchorEvent.clientX)) && Number.isFinite(Number(anchorEvent.clientY))) {
        anchored = captureZoomAnchorFromClient(Number(anchorEvent.clientX), Number(anchorEvent.clientY));
      }
      if (!anchored
        && Number.isFinite(Number(state.draftLastPointerClientX))
        && Number.isFinite(Number(state.draftLastPointerClientY))) {
        anchored = captureZoomAnchorFromClient(
          Number(state.draftLastPointerClientX),
          Number(state.draftLastPointerClientY)
        );
      }
      if (!anchored) {
        captureViewportCenterZoomAnchor();
      }
    }
    setDraftZoom(nextZoom);
  }

  function removeDraftElement() {
    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();
    var selected = selectedDraftElementSet();
    if (!selected.size) {
      return;
    }

    prepareDraftHistoryMutation();
    state.templateDraft.elements = state.templateDraft.elements.filter(function (item) {
      return !selected.has(String(item && item.__id || ''));
    });
    normalizeDraftElementZOrder(false);

    if (state.templateDraft.elements.length) {
      state.draftSelectedElementId = state.templateDraft.elements[0].__id;
      state.draftSelectedElementIds = new Set([state.draftSelectedElementId]);
    } else {
      state.draftSelectedElementId = '';
      state.draftSelectedElementIds = new Set();
    }

    markDraftDirty();
  }

  function nudgeSelectedDraftElement(dx, dy) {
    var moveX = Number(dx || 0);
    var moveY = Number(dy || 0);
    if (!Number.isFinite(moveX)) {
      moveX = 0;
    }
    if (!Number.isFinite(moveY)) {
      moveY = 0;
    }

    var snapX = draftSnapStepCanvas('x');
    var snapY = draftSnapStepCanvas('y');
    if (snapX > 0 && moveX !== 0) {
      moveX = (moveX < 0 ? -1 : 1) * Math.max(1, Math.round(Math.abs(moveX))) * snapX;
    }
    if (snapY > 0 && moveY !== 0) {
      moveY = (moveY < 0 ? -1 : 1) * Math.max(1, Math.round(Math.abs(moveY))) * snapY;
    }

    return applyToSelectedDraftElements(function (draft) {
      draft.x = Number(draft.x || 0) + moveX;
      draft.y = Number(draft.y || 0) + moveY;
    });
  }

  function duplicateSelectedDraftElement() {
    var selected = selectedDraftElement();
    if (!selected) {
      return false;
    }

    var nextLabel = String(
      selected.label
      || (selected.type === 'image' ? 'Image' : (selected.type === 'rectangle' ? 'Rectangle' : 'Text'))
    ) + ' Copy';
    addDraftElement(selected.type, {
      label: nextLabel,
      text: selected.type === 'text' ? String(draftTextValue(selected) || '') : '',
      textType: selected.type === 'text'
        ? normalizeDraftTextType(selected.textType || selected.textMode)
        : '',
      field: selected.field,
      side: selected.side,
      width: selected.width,
      height: selected.height,
      x: Number(selected.x || 0) + 8,
      y: Number(selected.y || 0) + 8,
      scaleX: selected.scaleX,
      scaleY: selected.scaleY,
      rotation: selected.rotation,
      skewX: selected.skewX,
      skewY: selected.skewY,
      fontFamily: selected.fontFamily,
      fontGroup: selected.fontGroup,
      fontFace: selected.fontFace,
      fontWeight: selected.fontWeight,
      fontStyle: selected.fontStyle,
      textAlign: selected.textAlign,
      lineHeight: selected.lineHeight,
      letterSpacing: selected.letterSpacing,
      color: selected.color,
      textMode: selected.textMode,
      imageKind: selected.imageKind,
      src: selected.src,
    });
    return true;
  }

  function ensureClipboardService() {
    if (clipboardService) {
      return true;
    }
    if (!window.GcEditorClipboardService || typeof window.GcEditorClipboardService.create !== 'function') {
      return false;
    }
    clipboardService = window.GcEditorClipboardService.create({
      state: state,
      showToast: showToast,
      selectedDraftElements: selectedDraftElements,
      sortDraftElementsByZIndex: sortDraftElementsByZIndex,
      deepCloneJson: deepCloneJson,
      ensureStep2DraftInitialized: ensureStep2DraftInitialized,
      beginDraftHistoryTransaction: beginDraftHistoryTransaction,
      prepareDraftHistoryMutation: prepareDraftHistoryMutation,
      maxDraftElementZIndex: maxDraftElementZIndex,
      normalizeDraftElement: normalizeDraftElement,
      normalizeDraftElementZOrder: normalizeDraftElementZOrder,
      setDraftSelectedElementIds: setDraftSelectedElementIds,
      clearDraftInlineTextEditing: clearDraftInlineTextEditing,
      markDraftDirty: markDraftDirty,
      endDraftHistoryTransaction: endDraftHistoryTransaction,
      removeDraftElement: removeDraftElement,
    });
    return !!clipboardService;
  }

  function selectedDraftElementsSortedByZIndex() {
    if (ensureClipboardService()) {
      return clipboardService.selectedDraftElementsSortedByZIndex();
    }
    var fallbackSelected = selectedDraftElements();
    if (!fallbackSelected.length) {
      return [];
    }
    return sortDraftElementsByZIndex(fallbackSelected);
  }

  function copySelectedDraftElements(options) {
    if (ensureClipboardService()) {
      return clipboardService.copySelectedDraftElements(options);
    }

    var opts = options && typeof options === 'object' ? options : {};
    var quiet = !!opts.quiet;
    var selected = selectedDraftElementsSortedByZIndex();
    if (!selected.length) {
      if (!quiet) {
        showToast('Select at least one element to copy.', 'warning');
      }
      return false;
    }

    state.clipboard = selected.map(function (item) {
      var snapshot = deepCloneJson(item, {});
      if (snapshot && typeof snapshot === 'object') {
        delete snapshot.__id;
      }
      return snapshot;
    });
    state.clipboardPasteCount = 0;

    if (!quiet) {
      showToast('Copied ' + String(selected.length) + ' element(s).', 'success');
    }
    return true;
  }

  function pasteClipboardElements(inPlace) {
    if (ensureClipboardService()) {
      return clipboardService.pasteClipboardElements(inPlace);
    }

    ensureStep2DraftInitialized();
    var clipboard = Array.isArray(state.clipboard) ? state.clipboard : [];
    if (!clipboard.length) {
      showToast('Clipboard is empty.', 'warning');
      return false;
    }

    var placeInOriginalPosition = !!inPlace;
    var offsetStep = 0;
    if (!placeInOriginalPosition) {
      var pasteCount = Math.max(0, Number(state.clipboardPasteCount || 0));
      offsetStep = (pasteCount + 1) * 10;
    }

    var pastedIds = [];
    beginDraftHistoryTransaction();
    try {
      prepareDraftHistoryMutation();
      var zSeed = maxDraftElementZIndex();
      clipboard.forEach(function (item, idx) {
        var draft = deepCloneJson(item, {});
        if (!draft || typeof draft !== 'object') {
          return;
        }
        delete draft.__id;

        draft.x = Number(draft.x || 0) + offsetStep;
        draft.y = Number(draft.y || 0) + offsetStep;
        draft.zIndex = zSeed + idx + 1;

        var nextIndex = state.templateDraft.elements.length;
        var normalized = normalizeDraftElement(draft, nextIndex);
        state.templateDraft.elements.push(normalized);
        pastedIds.push(String(normalized.__id || ''));
      });

      normalizeDraftElementZOrder(false);
      setDraftSelectedElementIds(new Set(pastedIds), pastedIds[0] || '');
      clearDraftInlineTextEditing();
      state.draftSelectedGuideId = '';
      markDraftDirty();
    } finally {
      endDraftHistoryTransaction();
    }

    if (!pastedIds.length) {
      return false;
    }

    if (!placeInOriginalPosition) {
      state.clipboardPasteCount = Math.max(0, Number(state.clipboardPasteCount || 0)) + 1;
    }
    showToast('Pasted ' + String(pastedIds.length) + ' element(s).', 'success');
    return true;
  }

  function cutSelectedDraftElements() {
    if (ensureClipboardService()) {
      return clipboardService.cutSelectedDraftElements();
    }

    if (!copySelectedDraftElements({ quiet: true })) {
      showToast('Select at least one element to cut.', 'warning');
      return false;
    }

    beginDraftHistoryTransaction();
    try {
      removeDraftElement();
    } finally {
      endDraftHistoryTransaction();
    }
    showToast('Cut selected element(s).', 'success');
    return true;
  }

  function splitArtisticTextParts(value, mode) {
    var text = String(value == null ? '' : value);
    if (!text) {
      return [];
    }

    if (mode === 'words') {
      var wordParts = text.match(/\S+\s*/g);
      if (Array.isArray(wordParts) && wordParts.length) {
        return wordParts;
      }
      return [text];
    }

    return Array.from(text);
  }

  function splitArtisticTextLines(value) {
    return splitDraftTextLines(value);
  }

  function resolveBreakTextMode(rawMode, sourceText) {
    var raw = String(rawMode || '').trim().toLowerCase();
    if (raw === 'line' || raw === 'lines' || raw === 'l') {
      return 'lines';
    }
    if (raw === 'word' || raw === 'words' || raw === 'w') {
      return 'words';
    }
    if (raw === 'char' || raw === 'chars' || raw === 'c') {
      return 'chars';
    }

    var text = String(sourceText == null ? '' : sourceText).replace(/\r\n?/g, '\n');
    if (text.indexOf('\n') !== -1) {
      return 'lines';
    }
    if (/\S+\s+\S+/.test(text)) {
      return 'words';
    }
    return 'chars';
  }

  function breakSelectedArtisticText(mode) {
    var selected = selectedDraftElement();
    if (!selected || !isArtisticDraftText(selected)) {
      return false;
    }

    var sourceText = draftTextValue(selected);
    var wantedMode = resolveBreakTextMode(mode, sourceText);
    if (wantedMode !== 'lines' && wantedMode !== 'chars' && wantedMode !== 'words') {
      return false;
    }

    var sourceLines = splitArtisticTextLines(sourceText);
    var lineParts = sourceLines.map(function (lineText) {
      if (wantedMode === 'lines') {
        return String(lineText || '').length ? [String(lineText)] : [];
      }
      return splitArtisticTextParts(lineText, wantedMode);
    });
    var totalParts = lineParts.reduce(function (sum, partsForLine) {
      return sum + (Array.isArray(partsForLine) ? partsForLine.length : 0);
    }, 0);
    if (totalParts <= 1) {
      showToast('Nothing to break: text has a single segment.', 'info');
      return false;
    }

    ensureStep2DraftInitialized();
    beginDraftHistoryTransaction();
    try {
      prepareDraftHistoryMutation();

      var bounds = draftArtisticBounds(selected);
      var transformInfo = draftArtisticTransformInfo(selected);
      var xAxisX = Number(transformInfo.a || 0);
      var xAxisY = Number(transformInfo.c || 0);
      var yAxisX = Number(transformInfo.b || 0);
      var yAxisY = Number(transformInfo.d || 0);
      if ((Math.abs(xAxisX) < 0.0001 && Math.abs(xAxisY) < 0.0001)
        || (Math.abs(yAxisX) < 0.0001 && Math.abs(yAxisY) < 0.0001)) {
        var fallbackAngle = normalizeDraftAngle(selected.rotation) * (Math.PI / 180);
        xAxisX = Math.cos(fallbackAngle);
        xAxisY = Math.sin(fallbackAngle);
        yAxisX = -Math.sin(fallbackAngle);
        yAxisY = Math.cos(fallbackAngle);
      }

      var originX = Number(bounds.originX || 0);
      var originY = Number(bounds.originY || 0);
      var scaleX = clampDraftScale(selected.scaleX);
      var scaleY = clampDraftScale(selected.scaleY);
      var lineMetrics = measureDraftTextDimensions(selected, 'Mg');
      var lineAdvanceLocal = Math.max(1, Number(lineMetrics.lineBoxHeight || lineMetrics.height || selected.height || 10));
      var createdIds = [];
      var newElements = [];
      var sequenceIndex = 0;

      (state.templateDraft.elements || []).forEach(function (item) {
        if (!item || String(item.__id || '') !== String(selected.__id || '')) {
          newElements.push(item);
          return;
        }

        lineParts.forEach(function (partsForLine, lineIndex) {
          if (!Array.isArray(partsForLine) || !partsForLine.length) {
            return;
          }

          var cursorLocalX = 0;
          var cursorLocalY = lineIndex * lineAdvanceLocal;

          partsForLine.forEach(function (partText) {
            var safeText = String(partText == null ? '' : partText);
            var dims = measureDraftTextDimensions(selected, safeText);
            var partWidth = Math.max(6, Number(dims.width || 6));
            var partHeight = Math.max(10, Number(dims.height || lineAdvanceLocal || 10));
            var partLocalBounds = draftArtisticTransformInfo(selected, partWidth, partHeight);
            var partOriginX = originX + (xAxisX * cursorLocalX) + (yAxisX * cursorLocalY);
            var partOriginY = originY + (xAxisY * cursorLocalX) + (yAxisY * cursorLocalY);
            var piece = Object.assign({}, selected, {
              __id: nextDraftElementId(),
              text: safeText,
              label: safeText,
              textType: 'artistic',
              textMode: 'artistic',
              textAlign: 'left',
              x: partOriginX + Number(partLocalBounds.minX || 0),
              y: partOriginY + Number(partLocalBounds.minY || 0),
              width: partWidth,
              height: partHeight,
              scaleX: scaleX,
              scaleY: scaleY,
              artisticAutoFit: false,
            });
            var normalized = normalizeDraftElement(piece, sequenceIndex);
            normalized.__id = piece.__id;
            newElements.push(normalized);
            createdIds.push(normalized.__id);

            cursorLocalX += Math.max(0, partWidth);
            sequenceIndex += 1;
          });
        });
      });

      state.templateDraft.elements = newElements;
      state.draftSelectedElementIds = new Set(createdIds);
      state.draftSelectedElementId = createdIds.length ? createdIds[0] : '';
      clearDraftInlineTextEditing();
      markDraftDirty();
      return true;
    } finally {
      endDraftHistoryTransaction();
    }
  }

  function isTypingTarget(node) {
    if (!node || node.nodeType !== 1) {
      return false;
    }

    var tag = String(node.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      return true;
    }

    return !!node.isContentEditable;
  }

  function isStep2EditorActive() {
    return state.step === 2 && modalEl && !modalEl.classList.contains('hidden');
  }

  function openSaveTemplateModal() {
    ensureStep2DraftInitialized();
    state.draftSaveTemplateName = String(state.templateDraftName || draftTemplateName());
    state.draftSaveTemplateError = '';
    state.draftSaveModalOpen = true;
  }

  function closeSaveTemplateModal() {
    state.draftSaveTemplateError = '';
    state.draftSaveModalOpen = false;
  }

  function triggerSaveDraftTemplate(nameOverride) {
    if (state.loading) {
      return;
    }

    var providedName = String(nameOverride || '').trim();
    if (providedName) {
      state.templateDraftName = providedName.slice(0, 120);
      state.draftSaveTemplateName = state.templateDraftName;
    }

    state.loading = true;
    render();
    saveDraftTemplate()
      .then(function () {
        setAlert('Template saved successfully.', 'warning');
        showToast('Template saved successfully.', 'success');
      })
      .catch(function (err) {
        var message = err && err.message ? err.message : 'Failed to save template.';
        setAlert(message, 'error');
        showToast(message, 'error');
      })
      .finally(function () {
        state.loading = false;
        render();
      });
  }

  function updateSelectedDraftElement(patch) {
    var current = selectedDraftElement();
    if (!current) {
      return;
    }

    var patchData = patch && typeof patch === 'object' ? patch : {};

    if (Object.prototype.hasOwnProperty.call(patchData, 'text')) {
      patchData.text = String(patchData.text || '');
      patchData.label = patchData.text;
    }
    if (Object.prototype.hasOwnProperty.call(patchData, 'label')) {
      patchData.label = String(patchData.label || '');
      if (String(current.type || '').toLowerCase() === 'text') {
        patchData.text = patchData.label;
      }
    }

    if (Object.prototype.hasOwnProperty.call(patchData, 'label')
      && String(current.type || '').toLowerCase() === 'text'
      && isArtisticDraftText(current)) {
      patchData.label = String(patchData.label || '').replace(/[ \t\u00A0]+$/g, '');
      patchData.text = patchData.label;
    }

    if (isArtisticDraftText(current)) {
      if (Object.prototype.hasOwnProperty.call(patchData, 'width')) {
        var wantedWidth = Number(patchData.width || 0);
        var baseWidth = Math.max(1, Number(current.width || 1));
        if (Number.isFinite(wantedWidth) && wantedWidth > 0) {
          patchData.scaleX = clampDraftScale(wantedWidth / baseWidth);
        }
        delete patchData.width;
      }
      if (Object.prototype.hasOwnProperty.call(patchData, 'height')) {
        var wantedHeight = Number(patchData.height || 0);
        var baseHeight = Math.max(1, Number(current.height || 1));
        if (Number.isFinite(wantedHeight) && wantedHeight > 0) {
          patchData.scaleY = clampDraftScale(wantedHeight / baseHeight);
        }
        delete patchData.height;
      }
      if (Object.prototype.hasOwnProperty.call(patchData, 'scaleX')) {
        patchData.scaleX = clampDraftScale(patchData.scaleX);
      }
      if (Object.prototype.hasOwnProperty.call(patchData, 'scaleY')) {
        patchData.scaleY = clampDraftScale(patchData.scaleY);
      }
      if (Object.prototype.hasOwnProperty.call(patchData, 'rotation')) {
        patchData.rotation = normalizeDraftAngle(patchData.rotation);
      }
      if (Object.prototype.hasOwnProperty.call(patchData, 'skewX')) {
        patchData.skewX = normalizeDraftAngle(patchData.skewX);
      }
      if (Object.prototype.hasOwnProperty.call(patchData, 'skewY')) {
        patchData.skewY = normalizeDraftAngle(patchData.skewY);
      }
    }

    Object.keys(patchData).forEach(function (key) {
      current[key] = patchData[key];
    });

    var isArtisticText = isArtisticDraftText(current);
    if (isArtisticText) {
      var artisticAutoFit = current.artisticAutoFit !== false;
      var hasManualSize = Object.prototype.hasOwnProperty.call(patchData, 'width')
        || Object.prototype.hasOwnProperty.call(patchData, 'height');
      var hasManualScale = Object.prototype.hasOwnProperty.call(patchData, 'scaleX')
        || Object.prototype.hasOwnProperty.call(patchData, 'scaleY');
      var affectsArtisticBounds = Object.prototype.hasOwnProperty.call(patchData, 'label')
        || Object.prototype.hasOwnProperty.call(patchData, 'text')
        || Object.prototype.hasOwnProperty.call(patchData, 'fontSize')
        || Object.prototype.hasOwnProperty.call(patchData, 'fontFamily')
        || Object.prototype.hasOwnProperty.call(patchData, 'fontWeight')
        || Object.prototype.hasOwnProperty.call(patchData, 'fontStyle')
        || Object.prototype.hasOwnProperty.call(patchData, 'lineHeight')
        || Object.prototype.hasOwnProperty.call(patchData, 'letterSpacing')
        || Object.prototype.hasOwnProperty.call(patchData, 'fontFace')
        || Object.prototype.hasOwnProperty.call(patchData, 'fontGroup');
      if (hasManualSize && !Object.prototype.hasOwnProperty.call(patchData, 'artisticAutoFit')) {
        current.artisticAutoFit = false;
        artisticAutoFit = false;
      }
      if (!hasManualSize && !hasManualScale && affectsArtisticBounds && artisticAutoFit) {
        fitDraftArtisticTextBounds(current);
      }
    }

    var normalized = normalizeDraftElement(current, 0);
    Object.keys(normalized).forEach(function (key) {
      current[key] = normalized[key];
    });
    current.__id = state.draftSelectedElementId;

    markDraftDirty();
  }

  function renderDraftElementsHtml() {
    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();
    var metrics = draftCanvasMetrics();
    var layout = draftCanvasLayoutMetrics(metrics);
    var selectedIds = selectedDraftElementSet();
    var transformMode = 'resize';
    var mergePreviewMode = !!state.draftMergePreview;
    var orderedElements = sortedDraftElements();
    var rows = [];

    function renderDraftSelectionHandlesHtml() {
      return ''
        + '<span class="gc-draft-selection-handle is-nw" data-handle="nw" data-transform-kind="resize"></span>'
        + '<span class="gc-draft-selection-handle is-n" data-handle="n" data-transform-kind="resize"></span>'
        + '<span class="gc-draft-selection-handle is-ne" data-handle="ne" data-transform-kind="resize"></span>'
        + '<span class="gc-draft-selection-handle is-e" data-handle="e" data-transform-kind="resize"></span>'
        + '<span class="gc-draft-selection-handle is-sw" data-handle="sw" data-transform-kind="resize"></span>'
        + '<span class="gc-draft-selection-handle is-s" data-handle="s" data-transform-kind="resize"></span>'
        + '<span class="gc-draft-selection-handle is-se" data-handle="se" data-transform-kind="resize"></span>'
        + '<span class="gc-draft-selection-handle is-w" data-handle="w" data-transform-kind="resize"></span>';
    }

    function renderDraftGroupSelectionHtml() {
      if (selectedIds.size <= 1 || state.draftTool !== 'select') {
        return '';
      }

      var activeSide = normalizeDraftEditorSide(state.draftActiveSide);
      if (!state.isTwoSided) {
        activeSide = 'front';
      }
      var groupBounds = draftSelectionBounds(selectedIds, activeSide);
      if (!groupBounds) {
        return '';
      }

      var sideOffsetUnits = state.isTwoSided && activeSide === 'back' ? layout.cardWidth : 0;
      var left = ((Number(groupBounds.x || 0) + sideOffsetUnits) / Math.max(1, layout.totalWidth)) * 100;
      var top = (Number(groupBounds.y || 0) / Math.max(1, layout.cardHeight)) * 100;
      var width = (Number(groupBounds.width || 1) / Math.max(1, layout.totalWidth)) * 100;
      var height = (Number(groupBounds.height || 1) / Math.max(1, layout.cardHeight)) * 100;
      var primaryId = String(state.draftSelectedElementId || '');
      if (!primaryId) {
        selectedIds.forEach(function (sid) {
          if (!primaryId) {
            primaryId = String(sid || '');
          }
        });
      }
      if (!primaryId) {
        return '';
      }

      var style = 'left:' + left + '%;top:' + top + '%;width:' + Math.max(0.8, width) + '%;height:' + Math.max(0.8, height) + '%;'
        + '--gc-handle-size:10px;--gc-handle-offset-x:10px;--gc-handle-offset-y:10px;';
      return '<div class="gc-draft-el gc-draft-selection-group is-selected is-transform-' + escapeAttr(transformMode) + '" data-action="select-draft-element" data-el-id="' + escapeAttr(primaryId) + '" data-selection-group="1" data-render-side="' + escapeAttr(activeSide) + '" style="' + style + '">'
        + renderDraftSelectionHandlesHtml()
        + '</div>';
    }

    orderedElements.forEach(function (item, idx) {
      if (!item) {
        return;
      }
      if (!isDraftElementVisible(item)) {
        return;
      }

      var renderSides = draftElementRenderSides(item);
      renderSides.forEach(function (renderSide) {
        var sideOffsetUnits = state.isTwoSided && renderSide === 'back' ? layout.cardWidth : 0;
        var isArtisticGeometry = isArtisticDraftText(item);
        var visualBounds = isArtisticGeometry ? draftArtisticBounds(item) : draftElementBounds(item);
        var leftRaw = ((Number(visualBounds.x || 0) + sideOffsetUnits) / Math.max(1, layout.totalWidth)) * 100;
        var topRaw = (Number(visualBounds.y || 0) / Math.max(1, layout.cardHeight)) * 100;
        var widthRaw = (Number(visualBounds.width || 1) / Math.max(1, layout.totalWidth)) * 100;
        var heightRaw = (Number(visualBounds.height || 1) / Math.max(1, layout.cardHeight)) * 100;
        var left = isArtisticGeometry ? leftRaw : Math.max(0, Math.min(100, leftRaw));
        var top = isArtisticGeometry ? topRaw : Math.max(0, Math.min(100, topRaw));
        var width = isArtisticGeometry ? Math.max(0.8, widthRaw) : Math.max(2, Math.min(100, widthRaw));
        var height = isArtisticGeometry ? Math.max(0.8, heightRaw) : Math.max(2, Math.min(100, heightRaw));

        var hasStoredLabel = Object.prototype.hasOwnProperty.call(item, 'label') || Object.prototype.hasOwnProperty.call(item, 'text');
        var label = item.type === 'text'
          ? String(draftTextValue(item))
          : (hasStoredLabel
            ? String(item.label)
            : String(item.field || ('Field ' + String(idx + 1))));
        if (!label && item.type !== 'text') {
          label = String(item.field || ('Field ' + String(idx + 1)));
        }
        if (!label && item.type === 'text' && item.field) {
          label = '{{' + fieldLabelForUi(item.field) + '}}';
        }
        if (mergePreviewMode && item.type === 'text' && item.field) {
          label = '{{' + fieldLabelForUi(item.field) + '}}';
        }

        var textType = normalizeDraftTextType(item.textType || item.textMode || 'artistic');
        var isSelected = isDraftElementSelected(item.__id);
        var isLocked = isDraftElementLocked(item);
        var isKeyObject = isSelected
          && selectedIds.size > 1
          && String(state.draftKeyObjectId || '') === String(item.__id || '');
        var cls = 'gc-draft-el gc-draft-el-' + (
          item.type === 'image'
            ? 'photo'
            : (item.type === 'rectangle' ? 'rect' : 'text')
        )
          + ' gc-draft-el-side-' + renderSide
          + (item.type === 'text' ? (' gc-draft-el-' + (textType === 'paragraph' ? 'paragraph' : 'artistic')) : '')
          + (item.type === 'text' && state.draftInlineEditingElementId === item.__id ? ' is-editing' : '')
          + (mergePreviewMode && item.field ? ' is-merge-preview' : '')
          + (isSelected && state.draftTool === 'select' ? (' is-transform-' + transformMode) : '')
          + (isLocked ? ' is-locked' : '')
          + (isKeyObject ? ' is-key-object' : '')
          + (isSelected ? ' is-selected' : '');
        var style = 'left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%;';

        if (item.type === 'text') {
          var fontSizePt = Number(item.fontSize || DRAFT_DEFAULT_FONT_PT);
          if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) {
            fontSizePt = DRAFT_DEFAULT_FONT_PT;
          }
          var fontSizePx = ptToPx(fontSizePt);
          var handleSizePx = Math.round(Math.max(DRAFT_HANDLE_SIZE_MIN_PX, Math.min(DRAFT_HANDLE_SIZE_MAX_PX, fontSizePx * 0.12)));
          var handleGapPx = Math.max(DRAFT_HANDLE_GAP_MIN_PX, Math.min(DRAFT_HANDLE_GAP_MAX_PX, fontSizePx * 0.05));
          var handleOffsetPx = Math.round((handleSizePx / 2) + handleGapPx);
          var handleOffsetYPx = handleOffsetPx;
          var textAlign = item.textAlign === 'left'
            ? 'left'
            : (item.textAlign === 'right' ? 'right' : 'center');
          var resolvedLineHeight = textType === 'paragraph'
            ? Number(item.lineHeight || 1.2)
            : 1;
          style += '--gc-handle-size:' + handleSizePx + 'px;'
            + '--gc-handle-offset-x:' + handleOffsetPx + 'px;'
            + '--gc-handle-offset-y:' + handleOffsetYPx + 'px;'
            + 'font-size:' + formatPtValue(fontSizePt) + 'pt;'
            + 'font-family:' + escapeAttr(item.fontFamily || 'Arial') + ';'
            + 'line-height:' + resolvedLineHeight + ';'
            + 'font-weight:' + escapeAttr(item.fontWeight || '400') + ';'
            + 'font-style:' + escapeAttr(item.fontStyle || 'normal') + ';'
            + 'letter-spacing:' + Number(item.letterSpacing || 0) + 'px;'
            + 'color:' + escapeAttr(item.color || '#1e293b') + ';'
            + 'text-align:' + textAlign + ';'
            + (textType === 'paragraph' ? 'white-space:normal;' : 'white-space:pre-wrap;');
        }

        if (item.type === 'rectangle') {
          var rectColor = String(item.color || '#2563eb');
          style += '--gc-handle-size:9px;'
            + '--gc-handle-offset-x:8px;'
            + '--gc-handle-offset-y:8px;'
            + 'border-color:' + escapeAttr(rectColor) + ';'
            + 'background:' + hexToRgbaString(rectColor, 0.14, '#2563eb') + ';'
            + 'color:transparent;';
          label = '';
        }

        var imageKind = String(item.imageKind || '');
        if (item.type === 'image' && (imageKind === 'photo_19x25' || imageKind === 'photo_19x24')) {
          label = 'Photo 19 x 25';
        }

        if (item.type === 'image') {
          var imageSrc = String(item.src || '').trim();
          if (imageSrc) {
            style += 'background-image:url(' + escapeAttr(imageSrc) + ');'
              + 'background-size:cover;'
              + 'background-position:center;'
              + 'background-repeat:no-repeat;'
              + 'color:transparent;';
            label = '';
          } else if (mergePreviewMode && item.field) {
            label = '[IMG ' + fieldLabelForUi(item.field) + ']';
          }
        }

        var isInlineEditing = item.type === 'text'
          && state.draftInlineEditingElementId === item.__id
          && (!state.isTwoSided || String(item.side || '').toLowerCase() !== 'both' || renderSide === normalizeDraftEditorSide(state.draftActiveSide))
          && selectedIds.size <= 1;

        var contentHtml = '';
        if (item.type === 'text' && isArtisticGeometry) {
          var baseWidth = Math.max(6, Number(item.width || 6));
          var baseHeight = Math.max(10, Number(item.height || 10));
          var textMetrics = measureDraftTextDimensions(item, label);
          var artisticLines = splitDraftTextLines(label);
          var coreOffsetX = Number(visualBounds.coreOffsetX || 0);
          var coreOffsetY = Number(visualBounds.coreOffsetY || 0);
          var scaleTextX = clampDraftScale(item.scaleX);
          var scaleTextY = clampDraftScale(item.scaleY);
          var rotation = normalizeDraftAngle(item.rotation);
          var skewX = normalizeDraftAngle(item.skewX);
          var skewY = normalizeDraftAngle(item.skewY);
          var alignValue = String(item.textAlign || item.align || 'center').toLowerCase();
          var justifyValue = alignValue === 'right'
            ? 'flex-end'
            : (alignValue === 'center' ? 'center' : 'flex-start');
          var metricsHeight = Math.max(1, Number(textMetrics.height || 0));
          var lineHeightCss = Number(item.lineHeight || 1.2);
          if (!Number.isFinite(lineHeightCss) || lineHeightCss <= 0) {
            lineHeightCss = 1.2;
          }
          lineHeightCss = Math.max(0.6, Math.min(3, lineHeightCss));
          var verticalPad = Math.max(0, (baseHeight - metricsHeight) / 2);
          var lineHtml = artisticLines.map(function (lineText) {
            return '<span class="gc-draft-el-line">' + escapeHtml(lineText || '\u00A0') + '</span>';
          }).join('');
          var transformedTextStyle = 'position:absolute;left:' + coreOffsetX.toFixed(3) + 'px;top:' + coreOffsetY.toFixed(3) + 'px;'
            + 'display:flex;align-items:stretch;justify-content:' + justifyValue + ';'
            + 'box-sizing:border-box;padding:' + verticalPad.toFixed(3) + 'px 0;'
            + 'width:' + baseWidth.toFixed(2) + 'px;height:' + baseHeight.toFixed(2) + 'px;'
            + 'line-height:' + lineHeightCss.toFixed(3) + ';'
            + 'text-align:' + alignValue + ';'
            + 'transform-origin:top left;'
            + 'transform:scale(' + scaleTextX.toFixed(4) + ',' + scaleTextY.toFixed(4) + ') rotate(' + rotation.toFixed(3) + 'deg) skew(' + skewX.toFixed(3) + 'deg,' + skewY.toFixed(3) + 'deg);';

          if (isInlineEditing) {
            contentHtml = '<div class="gc-draft-inline-editor gc-draft-el-core gc-draft-el-core-lines" data-inline-text-editor="1" data-inline-editor-id="' + escapeAttr(item.__id) + '" data-text-mode="artistic" contenteditable="true" spellcheck="false" style="' + transformedTextStyle + '">' + lineHtml + '</div>';
          } else {
            contentHtml = '<span class="gc-draft-el-core gc-draft-el-core-lines" style="' + transformedTextStyle + '">' + lineHtml + '</span>';
          }
        } else {
          contentHtml = isInlineEditing
            ? '<div class="gc-draft-inline-editor" data-inline-text-editor="1" data-inline-editor-id="' + escapeAttr(item.__id) + '" data-text-mode="' + escapeAttr(textType === 'paragraph' ? 'paragraph' : 'artistic') + '" contenteditable="true" spellcheck="false">' + escapeHtml(label) + '</div>'
            : escapeHtml(label);
        }

        var handlesHtml = (isSelected && !isInlineEditing && selectedIds.size <= 1 && state.draftTool === 'select')
          ? renderDraftSelectionHandlesHtml()
          : '';

        rows.push('<div class="' + cls + '" data-action="select-draft-element" data-el-id="' + escapeAttr(item.__id) + '" data-render-side="' + escapeAttr(renderSide) + '" data-el-type="' + escapeAttr(String(item.type || 'text')) + '" data-text-mode="' + escapeAttr(textType === 'paragraph' ? 'paragraph' : 'artistic') + '"'
          + ' style="' + style + '">'
          + contentHtml
          + handlesHtml
          + '</div>');
      });
    });

    var groupOverlayHtml = renderDraftGroupSelectionHtml();
    if (groupOverlayHtml) {
      rows.push(groupOverlayHtml);
    }

    if (!rows.length) {
      return '';
    }

    return rows.join('');
  }

  function draftDragBox(startX, startY, currentX, currentY, lockSquare) {
    var sx = Number(startX || 0);
    var sy = Number(startY || 0);
    var ex = Number(currentX || sx);
    var ey = Number(currentY || sy);
    if (!Number.isFinite(sx)) sx = 0;
    if (!Number.isFinite(sy)) sy = 0;
    if (!Number.isFinite(ex)) ex = sx;
    if (!Number.isFinite(ey)) ey = sy;

    if (lockSquare) {
      var dx = ex - sx;
      var dy = ey - sy;
      var size = Math.max(Math.abs(dx), Math.abs(dy));
      ex = sx + (dx < 0 ? -size : size);
      ey = sy + (dy < 0 ? -size : size);
    }

    return {
      x: Math.min(sx, ex),
      y: Math.min(sy, ey),
      width: Math.abs(ex - sx),
      height: Math.abs(ey - sy),
    };
  }

  function draftBoxesIntersect(a, b) {
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

  function selectDraftElementsByBox(box, appendSelection, mode, baseSelectionIds) {
    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();

    var selectionMode = mode;
    var append = appendSelection;
    if (typeof appendSelection === 'string') {
      selectionMode = appendSelection;
      append = false;
    }
    selectionMode = String(selectionMode || 'intersect').toLowerCase();
    if (selectionMode !== 'intersect') {
      selectionMode = 'intersect';
    }

    var activeSide = normalizeDraftEditorSide((box && box.side) || state.draftActiveSide);
    if (!state.isTwoSided) {
      activeSide = 'front';
    }
    var selectedIds = new Set();
    if (append) {
      var base = (baseSelectionIds && typeof baseSelectionIds.forEach === 'function')
        ? baseSelectionIds
        : selectedDraftElementSet();
      base.forEach(function (id) {
        var sid = String(id || '');
        if (sid) {
          selectedIds.add(sid);
        }
      });
    }
    var elements = Array.isArray(state.templateDraft.elements) ? state.templateDraft.elements : [];

    elements.forEach(function (item) {
      if (!item || !item.__id) {
        return;
      }
      if (!isDraftElementSelectable(item)) {
        return;
      }

      var renderSides = draftElementRenderSides(item);
      if (!renderSides.some(function (sideName) { return sideName === activeSide; })) {
        return;
      }

      var itemBox = isArtisticDraftText(item) ? draftArtisticBounds(item) : draftElementBounds(item);
      var hit = selectionMode === 'intersect'
        ? draftBoxesIntersect(box, itemBox)
        : draftBoxesIntersect(box, itemBox);
      if (hit) {
        selectedIds.add(String(item.__id));
      }
    });

    setDraftSelectedElementIds(selectedIds, state.draftSelectedElementId);
    state.draftSelectedGuideId = '';
    clearDraftInlineTextEditing();
    normalizeDraftElementSelection();
  }

  function renderDraftInsertGuideHtml() {
    var drag = state.draftRectDrag || state.draftTextDrag || state.draftSelectDrag;
    if (!drag) {
      return '';
    }

    if (drag.kind === 'text') {
      var textDx = Math.abs(Number(drag.currentX || drag.startX || 0) - Number(drag.startX || 0));
      var textDy = Math.abs(Number(drag.currentY || drag.startY || 0) - Number(drag.startY || 0));
      if (textDx < 6 && textDy < 6) {
        return '';
      }
    }

    if (drag.kind === 'select') {
      var selectDx = Math.abs(Number(drag.currentX || drag.startX || 0) - Number(drag.startX || 0));
      var selectDy = Math.abs(Number(drag.currentY || drag.startY || 0) - Number(drag.startY || 0));
      if (selectDx < 2 && selectDy < 2) {
        return '';
      }
    }

    var metrics = draftCanvasMetrics();
    var layout = draftCanvasLayoutMetrics(metrics);
    var box = draftDragBox(
      Number(drag.startX || 0),
      Number(drag.startY || 0),
      Number(drag.currentX || drag.startX || 0),
      Number(drag.currentY || drag.startY || 0),
      !!(drag.kind === 'rectangle' && drag.lockSquare)
    );
    var guideSide = normalizeDraftEditorSide(drag.side || state.draftActiveSide);
    if (!state.isTwoSided) {
      guideSide = 'front';
    }
    var sideOffsetUnits = state.isTwoSided && guideSide === 'back' ? layout.cardWidth : 0;

    var left = ((box.x + sideOffsetUnits) / layout.totalWidth) * 100;
    var top = (box.y / layout.cardHeight) * 100;
    var width = (box.width / layout.totalWidth) * 100;
    var height = (box.height / layout.cardHeight) * 100;

    if (drag.kind !== 'select') {
      left = Math.max(0, Math.min(100, left));
      top = Math.max(0, Math.min(100, top));
      width = Math.max(0.8, Math.min(100, width));
      height = Math.max(0.8, Math.min(100, height));
    }
    var cls = 'gc-draft-insert-guide'
      + (drag.kind === 'rectangle' ? ' is-rect' : '')
      + (drag.kind === 'select' ? ' is-select' : '');

    return '<div class="' + cls + '" style="left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%;"></div>';
  }

  function renderDraftAlignPreviewHtml() {
    var mode = String(state.draftAlignPreviewMode || '').toLowerCase();
    if (!mode) {
      return '';
    }

    var context = resolveDraftAlignContext(mode);
    if (!context) {
      return '';
    }

    var metrics = draftCanvasMetrics();
    var layout = draftCanvasLayoutMetrics(metrics);
    var activeSide = normalizeDraftEditorSide(state.draftActiveSide);
    if (!state.isTwoSided) {
      activeSide = 'front';
    }
    var sideOffsetUnits = state.isTwoSided && activeSide === 'back' ? layout.cardWidth : 0;
    var rows = [];

    if (mode.indexOf('distribute-') === 0) {
      var distributeAction = resolveDraftDistributeAction(mode);
      if (!distributeAction) {
        return '';
      }

      var preview = distributeDraftElements(context, distributeAction.axis, distributeAction.variant, { dryRun: true });
      if (!preview || !preview.targetById || typeof preview.targetById !== 'object') {
        return '';
      }

      var isHorizontal = preview.axis === 'x';
      var variant = normalizeDraftDistributeMode(preview.variant);
      Object.keys(preview.targetById).forEach(function (id) {
        var item = findDraftElementById(id);
        var b = context.boundsById[id] || draftElementBounds(item);
        var targetStart = Number(preview.targetById[id]);
        if (!Number.isFinite(targetStart)) {
          return;
        }

        if (isHorizontal) {
          var width = Math.max(0, Number(b.width || 0));
          var xVal = variant === 'centers' ? (targetStart + (width / 2)) : targetStart;
          var left = ((xVal + sideOffsetUnits) / Math.max(1, layout.totalWidth)) * 100;
          rows.push('<div class="gc-draft-align-preview-line is-distribute is-v" style="left:' + left + '%;"></div>');
        } else {
          var height = Math.max(0, Number(b.height || 0));
          var yVal = variant === 'centers' ? (targetStart + (height / 2)) : targetStart;
          var top = (yVal / Math.max(1, layout.cardHeight)) * 100;
          rows.push('<div class="gc-draft-align-preview-line is-distribute is-h" style="top:' + top + '%;"></div>');
        }
      });

      return rows.join('');
    }

    if (!context.referenceBounds) {
      return '';
    }

    var ref = context.referenceBounds;
    var vertical = [];
    var horizontal = [];

    if (mode === 'align-left') {
      vertical.push(Number(ref.x || 0));
    } else if (mode === 'align-right') {
      vertical.push(Number(ref.x || 0) + Number(ref.width || 0));
    } else if (mode === 'align-h-center') {
      vertical.push(Number(ref.x || 0) + (Number(ref.width || 0) / 2));
    } else if (mode === 'align-top') {
      horizontal.push(Number(ref.y || 0));
    } else if (mode === 'align-bottom') {
      horizontal.push(Number(ref.y || 0) + Number(ref.height || 0));
    } else if (mode === 'align-v-center') {
      horizontal.push(Number(ref.y || 0) + (Number(ref.height || 0) / 2));
    } else if (mode === 'canvas-center') {
      vertical.push(Number(ref.x || 0) + (Number(ref.width || 0) / 2));
      horizontal.push(Number(ref.y || 0) + (Number(ref.height || 0) / 2));
    } else {
      return '';
    }

    vertical.forEach(function (xVal) {
      var left = ((Number(xVal || 0) + sideOffsetUnits) / Math.max(1, layout.totalWidth)) * 100;
      rows.push('<div class="gc-draft-align-preview-line is-v" style="left:' + left + '%;"></div>');
    });
    horizontal.forEach(function (yVal) {
      var top = (Number(yVal || 0) / Math.max(1, layout.cardHeight)) * 100;
      rows.push('<div class="gc-draft-align-preview-line is-h" style="top:' + top + '%;"></div>');
    });

    return rows.join('');
  }

  function renderDraftAxisLockHintHtml() {
    var drag = state.draftDragging;
    if (!drag || !drag.moved || !drag.lockAxis) {
      return '';
    }

    var lockAxis = String(drag.lockAxis || '');
    if (lockAxis !== 'x' && lockAxis !== 'y') {
      return '';
    }

    var startX = Number(drag.startX || 0);
    var startY = Number(drag.startY || 0);
    if (!Number.isFinite(startX) || !Number.isFinite(startY)) {
      return '';
    }

    var metrics = draftCanvasMetrics();
    var layout = draftCanvasLayoutMetrics(metrics);
    var activeSide = normalizeDraftEditorSide(state.draftActiveSide);
    if (!state.isTwoSided) {
      activeSide = 'front';
    }
    var sideOffsetUnits = state.isTwoSided && activeSide === 'back' ? layout.cardWidth : 0;
    var left = ((startX + sideOffsetUnits) / Math.max(1, layout.totalWidth)) * 100;
    var top = (startY / Math.max(1, layout.cardHeight)) * 100;

    if (lockAxis === 'x') {
      return ''
        + '<div class="gc-draft-axis-lock-hint is-h" style="top:' + top + '%;"></div>'
        + '<div class="gc-draft-axis-lock-label is-h" style="left:' + left + '%;top:' + top + '%;">X only</div>';
    }

    return ''
      + '<div class="gc-draft-axis-lock-hint is-v" style="left:' + left + '%;"></div>'
      + '<div class="gc-draft-axis-lock-label is-v" style="left:' + left + '%;top:' + top + '%;">Y only</div>';
  }

  function draftLayerItemName(item, index) {
    if (!item) {
      return 'Object ' + String(index + 1);
    }
    var type = String(item.type || '').toLowerCase();
    if (type === 'text') {
      var text = String(draftTextValue(item) || item.label || '').trim();
      return text || ('Text ' + String(index + 1));
    }
    if (type === 'image') {
      return String(item.label || '').trim() || ('Image ' + String(index + 1));
    }
    if (type === 'rectangle') {
      return String(item.label || '').trim() || ('Rectangle ' + String(index + 1));
    }
    return String(item.label || '').trim() || ('Object ' + String(index + 1));
  }

  function renderDraftTextPanelHtml() {
    var unit = currentDraftUnit();
    var guidesLocked = !!state.draftGuidesLocked;
    var snapMmLabel = formatDraftSnapMm(state.draftSnapMm);
    return ''
      + renderDraftPropsHtml()
      + '<div class="gc-prop-section-title">Document</div>'
      + '<div class="gc-prop-grid">'
      + '<div class="gc-prop-group">'
      + '<label for="gcDraftUnitSelect">Units</label>'
      + '<select id="gcDraftUnitSelect" class="gc-prop-select">'
      + '<option value="mm"' + (unit === 'mm' ? ' selected' : '') + '>Millimeter</option>'
      + '<option value="cm"' + (unit === 'cm' ? ' selected' : '') + '>Centimeter</option>'
      + '<option value="in"' + (unit === 'in' ? ' selected' : '') + '>Inch</option>'
      + '</select>'
      + '</div>'
      + '<div class="gc-prop-group">'
      + '<label for="gcDraftSnapMmInput">Snap (mm)</label>'
      + '<input id="gcDraftSnapMmInput" class="gc-prop-input" type="number" min="0" max="10" step="0.1" value="' + escapeAttr(snapMmLabel) + '" title="0 = off">'
      + '</div>'
      + '</div>'
      + '<div class="gc-prop-actions">'
      + '<button type="button" class="btn btn-outline' + (guidesLocked ? ' is-active' : '') + '" data-action="toggle-guides-lock" title="Lock/unlock guides">'
      + '<i class="fa-solid ' + (guidesLocked ? 'fa-lock' : 'fa-lock-open') + '"></i> Guides'
      + '</button>'
      + '</div>';
  }

  function renderDraftMergePanelHtml() {
    var mergeFieldOptions = renderSchemaFieldOptions('', {
      includeEmpty: false,
      imageOnly: false,
    });
    var hasMergeFieldChoices = !!mergeFieldOptions;
    var autoMapScope = normalizeAutoMapScope(state.draftAutoMapScope || 'active');
    var autoMapScopeOptions = renderAutoMapScopeOptions(autoMapScope);
    var hasAutoMapReport = !!state.draftAutoMapReport;

    return ''
      + '<div class="gc-prop-section-title">Field Tools</div>'
      + '<div class="gc-prop-note">You can type merge tokens directly in text, e.g. <strong>Name: {{name}}</strong>.</div>'
      + '<div class="gc-prop-actions">'
      + '<button type="button" class="btn btn-outline" data-action="open-auto-map-report"' + (hasAutoMapReport ? '' : ' disabled') + '>Report</button>'
      + '</div>'
      + '<div class="gc-prop-grid">'
      + '<div class="gc-prop-group">'
      + '<label for="gcDraftAutoMapScopeSelect">Auto Map Scope</label>'
      + '<select id="gcDraftAutoMapScopeSelect" class="gc-prop-select"' + (hasMergeFieldChoices ? '' : ' disabled') + '>'
      + autoMapScopeOptions
      + '</select>'
      + '</div>'
      + '</div>'
      + '<div class="gc-prop-actions">'
      + '<button type="button" class="btn btn-outline" data-action="auto-map-fields"' + (hasMergeFieldChoices ? '' : ' disabled') + '>Auto Map</button>'
      + '</div>';
  }

  function renderDraftAlignPanelHtml() {
    var selectedCount = selectedDraftElementSet().size;
    var alignReference = normalizeDraftAlignReference(state.draftAlignReference);
    var distributeMode = normalizeDraftDistributeMode(state.draftDistributeMode);
    var keyOptionDisabled = selectedCount < 2 ? ' disabled' : '';
    var keyObjectLabel = '';
    if (selectedCount > 1 && state.draftKeyObjectId) {
      var keyObj = findDraftElementById(state.draftKeyObjectId);
      if (keyObj) {
        keyObjectLabel = keyObj.type === 'text'
          ? String(draftTextValue(keyObj) || 'Text')
          : String(keyObj.label || keyObj.type || 'Object');
      }
    }

    return ''
      + '<div class="gc-prop-grid">'
      + '<div class="gc-prop-group">'
      + '<label for="gcDraftAlignReferenceSelectPanel">Reference</label>'
      + '<select id="gcDraftAlignReferenceSelectPanel" class="gc-prop-select">'
      + '<option value="selection"' + (alignReference === 'selection' ? ' selected' : '') + '>Selection</option>'
      + '<option value="page"' + (alignReference === 'page' ? ' selected' : '') + '>Page</option>'
      + '<option value="keyObject"' + (alignReference === 'keyObject' ? ' selected' : '') + keyOptionDisabled + '>Key Object</option>'
      + '</select>'
      + '</div>'
      + '</div>'
      + (keyObjectLabel
        ? '<div class="gc-prop-note">Key object: <strong>' + escapeHtml(keyObjectLabel) + '</strong></div>'
        : (selectedCount > 1
          ? '<div class="gc-prop-note">Tip: click a selected object again to set it as key object.</div>'
          : '<div class="gc-prop-note">Select one or more objects to use align actions.</div>'))
      + '<div class="gc-prop-section-title">Align</div>'
      + '<div class="gc-prop-actions gc-prop-actions-icons">'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="align-left" title="Align Left" aria-label="Align Left"><i class="fa-solid fa-align-left"></i></button>'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="align-h-center" title="Align Center X" aria-label="Align Center X"><i class="fa-solid fa-align-center"></i></button>'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="align-right" title="Align Right" aria-label="Align Right"><i class="fa-solid fa-align-right"></i></button>'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="align-top" title="Align Top" aria-label="Align Top"><i class="fa-solid fa-arrow-up"></i></button>'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="align-v-center" title="Align Center Y" aria-label="Align Center Y"><i class="fa-solid fa-arrows-up-down"></i></button>'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="align-bottom" title="Align Bottom" aria-label="Align Bottom"><i class="fa-solid fa-arrow-down"></i></button>'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="canvas-center" title="Center To Canvas" aria-label="Center To Canvas"><i class="fa-solid fa-crosshairs"></i></button>'
      + '</div>'
      + '<div class="gc-prop-section-title">Distribute</div>'
      + '<div class="gc-prop-group">'
      + '<label for="gcDraftDistributeModeSelectPanel">Distribution Mode</label>'
      + '<select id="gcDraftDistributeModeSelectPanel" class="gc-prop-select">'
      + '<option value="spacing"' + (distributeMode === 'spacing' ? ' selected' : '') + '>Spacing</option>'
      + '<option value="centers"' + (distributeMode === 'centers' ? ' selected' : '') + '>Centers</option>'
      + '<option value="edges"' + (distributeMode === 'edges' ? ' selected' : '') + '>Edges</option>'
      + '</select>'
      + '</div>'
      + '<div class="gc-prop-actions gc-prop-actions-icons">'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="distribute-h" title="Distribute Horizontal" aria-label="Distribute Horizontal"><i class="fa-solid fa-arrows-left-right"></i></button>'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="distribute-v" title="Distribute Vertical" aria-label="Distribute Vertical"><i class="fa-solid fa-arrows-up-down"></i></button>'
      + '</div>';
  }

  function renderDraftLayersPanelHtml() {
    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();
    var ordered = sortDraftElementsByZIndex(state.templateDraft && state.templateDraft.elements);
    if (!ordered.length) {
      return '<div class="gc-prop-note">No objects on canvas yet.</div>';
    }

    var rows = [];
    var total = ordered.length;
    var display = ordered.slice().reverse();
    display.forEach(function (item, idx) {
      var id = String(item && item.__id || '');
      if (!id) {
        return;
      }
      var isSelected = isDraftElementSelected(id);
      var isVisible = isDraftElementVisible(item);
      var isLocked = isDraftElementLocked(item);
      var z = normalizeDraftElementZIndex(item.zIndex, total - idx);
      var rowCls = 'gc-layer-item'
        + (isSelected ? ' is-selected' : '')
        + (!isVisible ? ' is-hidden' : '')
        + (isLocked ? ' is-locked' : '');

      rows.push(''
        + '<div class="' + rowCls + '" data-layer-row="1" data-el-id="' + escapeAttr(id) + '" draggable="true">'
        + '<button type="button" class="gc-layer-item-label-btn" data-action="select-layer-element" data-el-id="' + escapeAttr(id) + '" title="Select layer"' + (isLocked ? ' disabled' : '') + '>'
        + '<span class="gc-layer-item-name">' + escapeHtml(draftLayerItemName(item, idx)) + '</span>'
        + '<span class="gc-layer-item-meta">z ' + String(z) + '</span>'
        + '</button>'
        + '<button type="button" class="gc-layer-item-icon-btn' + (isVisible ? ' is-active' : ' is-off') + '" data-action="toggle-layer-visibility" data-el-id="' + escapeAttr(id) + '" title="' + (isVisible ? 'Hide' : 'Show') + '">'
        + '<i class="fa-solid ' + (isVisible ? 'fa-eye' : 'fa-eye-slash') + '"></i>'
        + '</button>'
        + '<button type="button" class="gc-layer-item-icon-btn' + (isLocked ? ' is-active' : '') + '" data-action="toggle-layer-lock" data-el-id="' + escapeAttr(id) + '" title="' + (isLocked ? 'Unlock' : 'Lock') + '">'
        + '<i class="fa-solid ' + (isLocked ? 'fa-lock' : 'fa-lock-open') + '"></i>'
        + '</button>'
        + '</div>');
    });

    return ''
      + '<div class="gc-layer-stack-actions">'
      + '<button type="button" class="btn btn-outline" data-action="layer-stack" data-mode="front" title="Bring to front">Front</button>'
      + '<button type="button" class="btn btn-outline" data-action="layer-stack" data-mode="back" title="Send to back">Back</button>'
      + '<button type="button" class="btn btn-outline" data-action="layer-stack" data-mode="forward" title="Bring forward">Forward</button>'
      + '<button type="button" class="btn btn-outline" data-action="layer-stack" data-mode="backward" title="Send backward">Backward</button>'
      + '</div>'
      + '<div class="gc-prop-note">Drag rows to reorder. Hidden layers skip render/hit-test, locked layers cannot be selected or transformed.</div>'
      + '<div class="gc-layer-list">' + rows.join('') + '</div>';
  }

  function renderStep2RightPanelsHtml() {
    var active = activeDraftPanelName();
    var tabs = ''
      + '<div class="gc-prop-panel-switcher">'
      + '<button type="button" class="gc-prop-tab-btn' + (active === 'text' ? ' is-active' : '') + '" data-action="set-ui-panel" data-panel="text"><i class="fa-solid fa-font"></i> Text</button>'
      + '<button type="button" class="gc-prop-tab-btn' + (active === 'merge' ? ' is-active' : '') + '" data-action="set-ui-panel" data-panel="merge"><i class="fa-solid fa-brackets-curly"></i> Merge</button>'
      + '<button type="button" class="gc-prop-tab-btn' + (active === 'align' ? ' is-active' : '') + '" data-action="set-ui-panel" data-panel="align"><i class="fa-solid fa-border-all"></i> Align</button>'
      + '<button type="button" class="gc-prop-tab-btn' + (active === 'layers' ? ' is-active' : '') + '" data-action="set-ui-panel" data-panel="layers"><i class="fa-solid fa-layer-group"></i> Layers</button>'
      + '</div>';

    if (!active) {
      return tabs + '<div class="gc-prop-empty">Choose a panel tab to continue.</div>';
    }

    var title = active === 'text'
      ? 'Text Panel'
      : (active === 'merge'
        ? 'Mail Merge'
        : (active === 'align' ? 'Align And Distribute' : 'Layer Manager'));
    var icon = active === 'text'
      ? 'fa-font'
      : (active === 'merge'
        ? 'fa-brackets-curly'
        : (active === 'align' ? 'fa-border-all' : 'fa-layer-group'));
    var body = active === 'text'
      ? renderDraftTextPanelHtml()
      : (active === 'merge'
        ? renderDraftMergePanelHtml()
        : (active === 'align' ? renderDraftAlignPanelHtml() : renderDraftLayersPanelHtml()));

    return ''
      + tabs
      + '<div class="gc-prop-panel gc-prop-panel-floating is-open" data-panel-active="' + escapeAttr(active) + '">'
      + '<div class="gc-prop-panel-title">'
      + '<span><i class="fa-solid ' + icon + '"></i> ' + title + '</span>'
      + '</div>'
        + '<div class="gc-prop-panel-body">'
        + body
        + '</div>'
      + '</div>';
  }

  function renderDraftPropsHtml() {
    var item = selectedDraftElement();
    if (!item) {
      return '<div class="gc-prop-note">Select an element to use text, nudge, and align tools.</div>';
    }

    var isText = item.type === 'text';
    var isRectangle = item.type === 'rectangle';
    var fontSelection = resolveFontSelection(item);
    var selectedFamily = fontSelection.family || FONT_CATALOG[0] || null;
    var selectedFace = fontSelection.face || (selectedFamily && selectedFamily.faces ? selectedFamily.faces[0] : null);
    var fontFamilyOptions = renderFontFamilyOptions(selectedFamily ? selectedFamily.id : '');
    var fontFaceOptions = renderFontFaceOptions(selectedFamily, selectedFace ? selectedFace.id : '');
    var lineHeightValue = Number(item.lineHeight || 1.2);
    if (!Number.isFinite(lineHeightValue) || lineHeightValue <= 0) {
      lineHeightValue = 1.2;
    }

    var letterSpacingValue = Number(item.letterSpacing || 0);
    if (!Number.isFinite(letterSpacingValue)) {
      letterSpacingValue = 0;
    }

    var unit = currentDraftUnit().toUpperCase();
    var artisticVisualBounds = isArtisticDraftText(item) ? draftArtisticBounds(item) : null;
    var xValue = formatDraftMeasure(item.x, 'x');
    var yValue = formatDraftMeasure(item.y, 'y');
    var wValue = formatDraftMeasure(artisticVisualBounds ? artisticVisualBounds.width : item.width, 'x');
    var hValue = formatDraftMeasure(artisticVisualBounds ? artisticVisualBounds.height : item.height, 'y');
    var itemSide = String(item.side || 'front').toLowerCase();
    if (itemSide !== 'front' && itemSide !== 'back' && itemSide !== 'both') {
      itemSide = 'front';
    }
    var boldActive = isText && Number(item.fontWeight || 400) >= 600;
    var italicActive = isText && String(item.fontStyle || 'normal').toLowerCase() === 'italic';
    var imageSrc = String(item.src || '');

    return ''
      + '<div class="gc-prop-section-title">Content</div>'
      + (isText
        ? '<div class="gc-prop-note">Double-click on canvas text to edit it. Use the Merge tab to bind text/photo data fields.</div>'
        : (isRectangle
            ? '<div class="gc-prop-note">Rectangle is decorative only.</div>'
            : '<div class="gc-prop-group">'
              + '<label for="gcDraftImageSrcInput">Static Image Source (URL/Data)</label>'
              + '<input id="gcDraftImageSrcInput" class="gc-prop-input" type="text" value="' + escapeAttr(imageSrc) + '" placeholder="https://... or data:image/...">'
              + '</div>'
              + '<div class="gc-prop-note">Use the Merge tab to bind an image field (photo/signature/barcode) from database data.</div>'))
      + '<div class="gc-prop-group">'
      + '<label for="gcDraftSideInput">Side</label>'
      + '<select id="gcDraftSideInput" class="gc-prop-select">'
      + '<option value="front"' + (itemSide === 'front' ? ' selected' : '') + '>Front</option>'
      + '<option value="back"' + (itemSide === 'back' ? ' selected' : '') + '>Back</option>'
      + '<option value="both"' + (itemSide === 'both' ? ' selected' : '') + '>Both</option>'
      + '</select>'
      + '</div>'
      + '<div class="gc-prop-section-title">Position &amp; Size</div>'
      + '<div class="gc-prop-grid">'
      + '<div class="gc-prop-group"><label for="gcDraftXInput">X (' + unit + ')</label><input id="gcDraftXInput" class="gc-prop-input" type="number" step="any" value="' + escapeAttr(xValue) + '"></div>'
      + '<div class="gc-prop-group"><label for="gcDraftYInput">Y (' + unit + ')</label><input id="gcDraftYInput" class="gc-prop-input" type="number" step="any" value="' + escapeAttr(yValue) + '"></div>'
      + '<div class="gc-prop-group"><label for="gcDraftWInput">Width (' + unit + ')</label><input id="gcDraftWInput" class="gc-prop-input" type="number" step="any" min="1" value="' + escapeAttr(wValue) + '"></div>'
      + '<div class="gc-prop-group"><label for="gcDraftHInput">Height (' + unit + ')</label><input id="gcDraftHInput" class="gc-prop-input" type="number" step="any" min="1" value="' + escapeAttr(hValue) + '"></div>'
      + '</div>'
      + '<div class="gc-prop-section-title">Element Tools</div>'
      + (isText
        ? '<div class="gc-prop-group">'
          + '<label for="gcDraftFontInput">Font Size (pt)</label>'
          + '<input id="gcDraftFontInput" class="gc-prop-input" type="number" min="4" max="240" step="0.1" value="' + escapeAttr(formatPtValue(Number(item.fontSize || DRAFT_DEFAULT_FONT_PT))) + '">'
          + '</div>'
        : '')
      + (isText
        ? '<div class="gc-prop-section-title">Text Options</div>'
          + '<div class="gc-prop-grid">'
          + '<div class="gc-prop-group">'
          + '<label for="gcDraftFontFamilyInput">Font Family</label>'
          + '<select id="gcDraftFontFamilyInput" class="gc-prop-select">'
          + fontFamilyOptions
          + '</select>'
          + '</div>'
          + '<div class="gc-prop-group">'
          + '<label for="gcDraftFontFaceInput">Font Face</label>'
          + '<select id="gcDraftFontFaceInput" class="gc-prop-select">'
          + fontFaceOptions
          + '</select>'
          + '</div>'
          + '<div class="gc-prop-group">'
          + '<label for="gcDraftLineHeightInput">Line Height</label>'
          + '<input id="gcDraftLineHeightInput" class="gc-prop-input" type="number" min="0.6" max="3" step="0.1" value="' + escapeAttr(lineHeightValue.toFixed(1)) + '">'
          + '</div>'
          + '<div class="gc-prop-group">'
          + '<label for="gcDraftAlignInput">Align</label>'
          + '<select id="gcDraftAlignInput" class="gc-prop-select">'
          + '<option value="left"' + (item.textAlign === 'left' ? ' selected' : '') + '>Left</option>'
          + '<option value="center"' + (item.textAlign === 'center' ? ' selected' : '') + '>Center</option>'
          + '<option value="right"' + (item.textAlign === 'right' ? ' selected' : '') + '>Right</option>'
          + '</select>'
          + '</div>'
          + '<div class="gc-prop-group">'
          + '<label for="gcDraftLetterSpacingInput">Letter Spacing</label>'
          + '<input id="gcDraftLetterSpacingInput" class="gc-prop-input" type="number" min="-10" max="20" step="0.5" value="' + escapeAttr(letterSpacingValue) + '">'
          + '</div>'
          + '<div class="gc-prop-group">'
          + '<label for="gcDraftColorInput">Color</label>'
          + '<input id="gcDraftColorInput" class="gc-prop-input" type="color" value="' + escapeAttr(String(item.color || '#1e293b')) + '">'
          + '</div>'
          + '<div class="gc-prop-actions gc-prop-actions-icons">'
          + '<button type="button" class="btn btn-outline gc-prop-icon-btn' + (boldActive ? ' is-active' : '') + '" data-action="toggle-text-style" data-style="bold" title="Bold" aria-label="Bold"><i class="fa-solid fa-bold"></i></button>'
          + '<button type="button" class="btn btn-outline gc-prop-icon-btn' + (italicActive ? ' is-active' : '') + '" data-action="toggle-text-style" data-style="italic" title="Italic" aria-label="Italic"><i class="fa-solid fa-italic"></i></button>'
          + '</div>'
          + '</div>'
        : (isRectangle
            ? '<div class="gc-prop-group">'
              + '<label for="gcDraftColorInput">Border Color</label>'
              + '<input id="gcDraftColorInput" class="gc-prop-input" type="color" value="' + escapeAttr(String(item.color || '#2563eb')) + '">'
              + '</div>'
              + '<div class="gc-prop-note">Rectangle selected. Hold Shift while drawing to lock square ratio.</div>'
            : '<div class="gc-prop-note">Image placeholder selected. Use drag/resize handles and alignment controls below.</div>'))
      + '<div class="gc-prop-actions gc-prop-actions-icons">'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="nudge-draft" data-dx="-1" data-dy="0" title="Nudge Left" aria-label="Nudge Left"><i class="fa-solid fa-arrow-left"></i></button>'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="nudge-draft" data-dx="1" data-dy="0" title="Nudge Right" aria-label="Nudge Right"><i class="fa-solid fa-arrow-right"></i></button>'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="nudge-draft" data-dx="0" data-dy="-1" title="Nudge Up" aria-label="Nudge Up"><i class="fa-solid fa-arrow-up"></i></button>'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="nudge-draft" data-dx="0" data-dy="1" title="Nudge Down" aria-label="Nudge Down"><i class="fa-solid fa-arrow-down"></i></button>'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="duplicate-draft-element" title="Duplicate" aria-label="Duplicate"><i class="fa-solid fa-clone"></i></button>'
      + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="remove-draft-element" title="Delete" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>'
      + '</div>';
  }

  function templateElementsForSide(side) {
    var tpl = currentTemplateJson();
    var wanted = side === 'back' ? 'back' : 'front';
    return sortDraftElementsByZIndex((tpl.elements || []).filter(function (item) {
      if (!item || typeof item !== 'object') {
        return false;
      }
      if (!isDraftElementVisible(item)) {
        return false;
      }
      if (String(item.type || '').toLowerCase() === 'background') {
        return false;
      }
      var itemSide = String(item.side || 'front').toLowerCase();
      if (itemSide !== 'front' && itemSide !== 'back' && itemSide !== 'both') {
        itemSide = 'front';
      }
      return itemSide === wanted || itemSide === 'both';
    }));
  }

  function buildOverlayHtml(side) {
    if (!state.selectedTemplate) {
      return '';
    }

    var tpl = currentTemplateJson();
    var canvas = tpl.canvas || {};
    var canvasW = Number(canvas.width || 350);
    var canvasH = Number(canvas.height || 200);
    if (!Number.isFinite(canvasW) || canvasW <= 0) {
      canvasW = 350;
    }
    if (!Number.isFinite(canvasH) || canvasH <= 0) {
      canvasH = 200;
    }

    var rows = templateElementsForSide(side).map(function (item, idx) {
      var x = Number(item.x || 0);
      var y = Number(item.y || 0);
      var w = Number(item.width || 20);
      var h = Number(item.height || 10);

      if (!Number.isFinite(x)) x = 0;
      if (!Number.isFinite(y)) y = 0;
      if (!Number.isFinite(w) || w <= 0) w = 20;
      if (!Number.isFinite(h) || h <= 0) h = 10;

      var left = Math.max(0, Math.min(100, (x / canvasW) * 100));
      var top = Math.max(0, Math.min(100, (y / canvasH) * 100));
      var width = Math.max(2, Math.min(100, (w / canvasW) * 100));
      var height = Math.max(2, Math.min(100, (h / canvasH) * 100));
      var label = String(item.label || item.field || ('Field ' + (idx + 1)));
      var type = String(item.type || 'text').toLowerCase();

      if (type === 'rectangle') {
        var rectColor = String(item.color || '#2563eb');
        return '<div class="gc-template-el gc-template-el-rect" style="left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%;border-color:' + escapeAttr(rectColor) + ';"></div>';
      }

      return '<div class="gc-template-el" style="left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%;">'
        + escapeHtml(label) + '</div>';
    });

    if (!rows.length) {
      return '<div class="gc-preview-empty">No template elements on this side</div>';
    }

    return rows.join('');
  }

  function step1Valid() {
    // Background PDFs are optional in Step 1.
    return true;
  }

  function templateFieldConfig(templateObj) {
    if (!templateObj || typeof templateObj !== 'object') {
      return {};
    }
    return templateObj.field_config && typeof templateObj.field_config === 'object'
      ? templateObj.field_config
      : {};
  }

  function hasTemplateEditableDesign(templateObj, side) {
    if (!templateObj || typeof templateObj !== 'object') {
      return false;
    }

    if (side === 'back') {
      if (Object.prototype.hasOwnProperty.call(templateObj, 'has_back_editable_design')) {
        return !!templateObj.has_back_editable_design;
      }
      return !!templateFieldConfig(templateObj).editable_design_back;
    }

    if (Object.prototype.hasOwnProperty.call(templateObj, 'has_front_editable_design')) {
      return !!templateObj.has_front_editable_design;
    }
    return !!templateFieldConfig(templateObj).editable_design_front;
  }

  function hasSavedTemplateDesignForSide(side) {
    var templateObj = state.selectedTemplate;
    if (!templateObj || typeof templateObj !== 'object') {
      return false;
    }

    var hasPdf = side === 'back'
      ? !!(templateObj.back_pdf_url || templateObj.has_back_pdf)
      : !!(templateObj.front_pdf_url || templateObj.has_front_pdf);
    var hasEditable = hasTemplateEditableDesign(templateObj, side);

    if (side === 'back' && Object.prototype.hasOwnProperty.call(templateObj, 'has_back_design')) {
      return !!templateObj.has_back_design || hasPdf || hasEditable;
    }
    if (side === 'front' && Object.prototype.hasOwnProperty.call(templateObj, 'has_front_design')) {
      return !!templateObj.has_front_design || hasPdf || hasEditable;
    }
    return hasPdf || hasEditable;
  }

  function hasDesignForSide(side) {
    if (side === 'back') {
      return !!(state.backFile || state.backPreviewUrl || hasSavedTemplateDesignForSide('back'));
    }
    return !!(state.frontFile || state.frontPreviewUrl || hasSavedTemplateDesignForSide('front'));
  }

  function selectedCardCount() {
    return state.selectedRequestIds.size;
  }

  function renderProgressItem(stepNumber, label) {
    var classes = 'gc-progress-item';
    if (state.step === stepNumber) {
      classes += ' is-active';
    } else if (state.step > stepNumber) {
      classes += ' is-done';
    }

    return '<div class="' + classes + '">'
      + '<span class="gc-progress-num">' + stepNumber + '</span>'
      + '<span>' + escapeHtml(label) + '</span>'
      + '</div>';
  }

  function renderPdfPreview(title, side, withOverlay, options) {
    options = options || {};
    var source = side === 'back' ? state.backPreviewUrl : state.frontPreviewUrl;
    var hasPdf = !!source;
    var previewOrientation = String(options.orientation || state.orientation || 'landscape').toLowerCase();
    if (previewOrientation !== 'portrait') {
      previewOrientation = 'landscape';
    }
    var cardSized = !!options.cardSized;
    var hideTitle = !!options.hideTitle;
    var boxClass = cardSized
      ? (previewOrientation === 'portrait' ? 'gc-mm-portrait' : 'gc-mm-landscape')
      : (previewOrientation === 'portrait' ? 'gc-ratio-portrait' : 'gc-ratio-landscape');
    var frameHtml = hasPdf
      ? '<div class="gc-pdf-preview-shell">'
        + '<canvas class="gc-pdf-canvas" data-side="' + escapeAttr(side) + '"></canvas>'
        + '<iframe class="gc-pdf-fallback-frame is-hidden" data-side-fallback="' + escapeAttr(side) + '" title="PDF preview"></iframe>'
        + '<div class="gc-preview-loading" data-side-loading="' + escapeAttr(side) + '">Loading preview...</div>'
        + '</div>'
      : '<div class="gc-preview-empty">No ' + escapeHtml(side) + ' background selected (optional)</div>';

    var overlayHtml = withOverlay && hasPdf
      ? '<div class="gc-template-overlay">' + buildOverlayHtml(side) + '</div>'
      : '';

    var titleHtml = hideTitle
      ? ''
      : ('<div class="gc-preview-head"><span>' + escapeHtml(title) + '</span></div>');

    return '<div class="gc-preview-card' + (cardSized ? ' is-card-size' : '') + '">'
      + titleHtml
      + '<div class="gc-preview-box ' + boxClass + '">'
      + frameHtml
      + overlayHtml
      + '</div>'
      + '</div>';
  }

  function flowListNameForUi() {
    var raw = window && Object.prototype.hasOwnProperty.call(window, 'TABLE_NAME')
      ? window.TABLE_NAME
      : '';
    var name = String(raw || '').trim();
    if (!name) {
      return 'Selected List';
    }
    return name;
  }

  function renderStepFooterMeta() {
    var listLine = 'Generate Card List: ' + flowListNameForUi();
    return '<div class="gc-actions-meta">'
      + '<div class="gc-actions-meta-title">' + escapeHtml(listLine) + '</div>'
      + '</div>';
  }

  function renderStep1() {
    var frontName = state.frontFile
      ? state.frontFile.name
      : (state.frontPreviewUrl
        ? 'Background PDF selected'
        : (hasSavedTemplateDesignForSide('front') ? 'Saved design available' : 'No file selected (optional)'));
    var backName = state.backFile
      ? state.backFile.name
      : (state.backPreviewUrl
        ? 'Background PDF selected'
        : (hasSavedTemplateDesignForSide('back') ? 'Saved design available' : 'No file selected (optional)'));
    var realSize = draftRealDimensionsMm();
    var sizeLabel = formatMmLabelValue(realSize.widthMm) + 'mm x ' + formatMmLabelValue(realSize.heightMm) + 'mm';

    var topbarHtml = ''
      + '<div class="gc-step1-topbar">'
      + '<div class="gc-inline-controls">'
      + '<div class="gc-inline-control-block gc-inline-group">'
      + '<div class="gc-inline-label">Card Type</div>'
      + '<div class="gc-choice-row">'
      + '<button type="button" class="gc-choice-btn' + (state.orientation !== 'portrait' ? ' is-active' : '') + '" data-action="set-orientation" data-value="landscape">Horizontal</button>'
      + '<button type="button" class="gc-choice-btn' + (state.orientation === 'portrait' ? ' is-active' : '') + '" data-action="set-orientation" data-value="portrait">Portrait</button>'
      + '</div>'
      + '</div>'
      + '<div class="gc-inline-control-block gc-inline-group">'
      + '<div class="gc-inline-label">Card Sides</div>'
      + '<div class="gc-choice-row">'
      + '<button type="button" class="gc-choice-btn' + (!state.isTwoSided ? ' is-active' : '') + '" data-action="set-sides" data-value="single">1 Sided</button>'
      + '<button type="button" class="gc-choice-btn' + (state.isTwoSided ? ' is-active' : '') + '" data-action="set-sides" data-value="double">2 Sided</button>'
      + '</div>'
      + '</div>'
      + '<div class="gc-inline-control-block gc-inline-template-block">'
      + '<div class="gc-inline-label">Template</div>'
      + '<div class="gc-inline-template-row">'
      + '<select id="gcTemplateSelectStep1" class="gc-select">'
      + renderTemplateOptions()
      + '</select>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="gc-inline-group gc-inline-group-selection">'
      + '<div class="gc-inline-label">Cards To Print</div>'
      + '<div class="gc-inline-value gc-inline-count-value"><span class="gc-inline-count-number">' + String(selectedCardCount()) + '</span><span class="gc-inline-count-text">cards selected</span></div>'
      + '</div>'
      + '</div>';

    var uploadHtml = ''
      + '<div class="gc-step1-upload-row' + (state.isTwoSided ? '' : ' is-single-side') + '">'
      + '<div class="gc-step1-upload-col">'
      + '<label>Front Background PDF (Optional)</label>'
      + '<div class="gc-upload-input-wrap">'
      + '<input id="gcFrontPdfInput" class="gc-file-input-native" type="file" accept="application/pdf,.pdf">'
      + '<label for="gcFrontPdfInput" class="gc-upload-btn">Choose Front PDF</label>'
      + (hasDesignForSide('front')
        ? '<button type="button" class="btn btn-outline gc-upload-clear-btn" data-action="clear-pdf" data-side="front">Remove</button>'
        : '')
      + '<div class="gc-file-pill' + (!hasDesignForSide('front') ? ' is-empty' : '') + '">' + escapeHtml(frontName) + '</div>'
      + '</div>'
      + '</div>'
      + (state.isTwoSided
        ? '<div class="gc-step1-upload-col">'
          + '<label>Back Background PDF (Optional)</label>'
          + '<div class="gc-upload-input-wrap">'
          + '<input id="gcBackPdfInput" class="gc-file-input-native" type="file" accept="application/pdf,.pdf">'
          + '<label for="gcBackPdfInput" class="gc-upload-btn">Choose Back PDF</label>'
          + (hasDesignForSide('back')
            ? '<button type="button" class="btn btn-outline gc-upload-clear-btn" data-action="clear-pdf" data-side="back">Remove</button>'
            : '')
          + '<div class="gc-file-pill' + (!hasDesignForSide('back') ? ' is-empty' : '') + '">' + escapeHtml(backName) + '</div>'
          + '</div>'
          + '</div>'
        : '')
      + '</div>';

    var previewHtml = ''
      + '<div class="gc-step1-previews">'
      + '<div class="gc-step1-previews-head">Design Preview (' + sizeLabel + ')</div>'
      + '<div class="gc-preview-grid gc-preview-grid-cards">'
      + renderPdfPreview('Front', 'front', false, { cardSized: true, orientation: state.orientation, hideTitle: state.isTwoSided })
      + (state.isTwoSided ? renderPdfPreview('Back', 'back', false, { cardSized: true, orientation: state.orientation, hideTitle: true }) : '')
      + '</div>'
      + '</div>';

    var actionsHtml = ''
      + '<div class="gc-actions">'
      + renderStepFooterMeta()
      + '<div class="gc-actions-right">'
      + '<button type="button" class="btn btn-blue" data-action="next-step">Next</button>'
      + '</div>'
      + '</div>';

    return '<div class="gc-step-panel gc-step-panel-step1">'
      + topbarHtml
      + uploadHtml
      + previewHtml
      + actionsHtml
      + '</div>';
  }

  function formatTemplateOptionLabel(label) {
    var text = String(label == null ? '' : label).trim();
    if (!text) {
      return '';
    }
    if (text.length <= 44) {
      return text;
    }
    return text.slice(0, 41).trim() + '...';
  }

  function renderTemplateOptions() {
    var options = ['<option value="" title="No template selected">No template selected</option>'];
    if (!state.templates.length) {
      return options.join('');
    }

    options = options.concat(state.templates.map(function (item) {
      var id = Number(item.id || 0);
      var isSelected = Number(state.selectedTemplateId || 0) === id;
      var title = String(item.name || ('Template #' + id));
      var optionLabel = formatTemplateOptionLabel(title) || ('Template #' + id);
      return '<option value="' + id + '"' + (isSelected ? ' selected' : '') + ' title="' + escapeAttr(title) + '">' + escapeHtml(optionLabel) + '</option>';
    }));

    return options.join('');
  }

  function autoMapScopeLabel(scope) {
    var normalized = normalizeAutoMapScope(scope);
    if (normalized === 'all') {
      return 'All Sides';
    }
    if (normalized === 'front') {
      return 'Front Only';
    }
    if (normalized === 'back') {
      return 'Back Only';
    }
    return 'Active Side';
  }

  function renderAutoMapScopeOptions(selectedScope) {
    var selected = normalizeAutoMapScope(selectedScope);
    if (!state.isTwoSided && selected === 'back') {
      selected = 'active';
    }
    var rows = [];

    rows.push('<option value="active"' + (selected === 'active' ? ' selected' : '') + '>Active Side</option>');
    rows.push('<option value="front"' + (selected === 'front' ? ' selected' : '') + '>Front</option>');
    if (state.isTwoSided) {
      rows.push('<option value="back"' + (selected === 'back' ? ' selected' : '') + '>Back</option>');
    }
    rows.push('<option value="all"' + (selected === 'all' ? ' selected' : '') + '>All Sides</option>');
    return rows.join('');
  }

  function renderAutoMapReportRows(items, limit, formatter) {
    var rows = Array.isArray(items) ? items : [];
    var maxRows = Math.max(1, Number(limit || 6));
    if (!rows.length) {
      return '<div class="gc-step2-report-empty">None</div>';
    }

    var html = rows.slice(0, maxRows).map(function (item) {
      var line = formatter(item || {});
      return '<div class="gc-step2-report-row">' + line + '</div>';
    }).join('');

    if (rows.length > maxRows) {
      html += '<div class="gc-step2-report-more">+' + String(rows.length - maxRows) + ' more</div>';
    }
    return html;
  }

  function renderAutoMapReportModal() {
    var report = state.draftAutoMapReport;
    if (!state.draftAutoMapReportOpen || !report) {
      return '';
    }

    var mappedCount = Number(report.mappedCount || 0);
    var checkedCount = Number(report.checked || 0);
    var unmatchedCount = Array.isArray(report.unmatched) ? report.unmatched.length : 0;
    var ambiguousCount = Array.isArray(report.ambiguous) ? report.ambiguous.length : 0;
    var manualCount = Array.isArray(report.skippedManual) ? report.skippedManual.length : 0;

    return ''
      + '<div class="gc-step2-report-overlay">'
      + '<div class="gc-step2-report-modal" role="dialog" aria-modal="true" aria-label="Auto map report">'
      + '<div class="gc-step2-report-head">'
      + '<div class="gc-step2-report-title">Auto Map Report (' + escapeHtml(autoMapScopeLabel(report.scope)) + ')</div>'
      + '<button type="button" class="btn btn-outline" data-action="close-auto-map-report">Close</button>'
      + '</div>'
      + '<div class="gc-step2-report-summary">'
      + '<div class="gc-step2-report-pill">Checked: <strong>' + String(checkedCount) + '</strong></div>'
      + '<div class="gc-step2-report-pill">Mapped: <strong>' + String(mappedCount) + '</strong></div>'
      + '<div class="gc-step2-report-pill">Ambiguous: <strong>' + String(ambiguousCount) + '</strong></div>'
      + '<div class="gc-step2-report-pill">Unmatched: <strong>' + String(unmatchedCount) + '</strong></div>'
      + '<div class="gc-step2-report-pill">Manual-kept: <strong>' + String(manualCount) + '</strong></div>'
      + '</div>'
      + '<div class="gc-step2-report-grid">'
      + '<div class="gc-step2-report-card"><div class="gc-step2-report-card-title">Mapped</div>'
      + renderAutoMapReportRows(report.mapped, 7, function (item) {
        var lbl = String(item.label || '').trim() || '(empty label)';
        var fld = fieldLabelForUi(item.field || '');
        return '<span class="gc-step2-report-lbl">' + escapeHtml(lbl) + '</span><span class="gc-step2-report-arrow">→</span><span class="gc-step2-report-field">' + escapeHtml(fld) + '</span>';
      })
      + '</div>'
      + '<div class="gc-step2-report-card"><div class="gc-step2-report-card-title">Ambiguous</div>'
      + renderAutoMapReportRows(report.ambiguous, 6, function (item) {
        var lbl = String(item.label || '').trim() || '(empty label)';
        var cands = Array.isArray(item.candidates) ? item.candidates.slice(0, 2).map(function (c) {
          return fieldLabelForUi(c.name || '');
        }).join(' / ') : '';
        return '<span class="gc-step2-report-lbl">' + escapeHtml(lbl) + '</span><span class="gc-step2-report-meta">' + escapeHtml(cands || 'Needs manual selection') + '</span>';
      })
      + '</div>'
      + '<div class="gc-step2-report-card"><div class="gc-step2-report-card-title">Unmatched</div>'
      + renderAutoMapReportRows(report.unmatched, 6, function (item) {
        var lbl = String(item.label || '').trim() || '(empty label)';
        return '<span class="gc-step2-report-lbl">' + escapeHtml(lbl) + '</span>';
      })
      + '</div>'
      + '<div class="gc-step2-report-card"><div class="gc-step2-report-card-title">Skipped Manual Mapping</div>'
      + renderAutoMapReportRows(report.skippedManual, 6, function (item) {
        var lbl = String(item.label || '').trim() || '(empty label)';
        var fld = fieldLabelForUi(item.field || '');
        return '<span class="gc-step2-report-lbl">' + escapeHtml(lbl) + '</span><span class="gc-step2-report-meta">Kept: ' + escapeHtml(fld) + '</span>';
      })
      + '</div>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function renderSaveTemplateModal() {
    if (!state.draftSaveModalOpen) {
      return '';
    }

    var currentName = String(state.draftSaveTemplateName || state.templateDraftName || draftTemplateName());
    var errorHtml = state.draftSaveTemplateError
      ? '<div class="gc-save-template-error">' + escapeHtml(state.draftSaveTemplateError) + '</div>'
      : '';

    return ''
      + '<div class="gc-save-template-overlay">'
      + '<div class="gc-save-template-modal" role="dialog" aria-modal="true" aria-label="Save template">'
      + '<div class="gc-save-template-title">Save Template For This Table</div>'
      + '<div class="gc-save-template-subtitle">This save updates the current table template and version history.</div>'
      + '<label class="gc-save-template-label" for="gcDraftTemplateNameModalInput">Template Name</label>'
      + '<input id="gcDraftTemplateNameModalInput" class="gc-input gc-save-template-input" type="text" maxlength="120" value="' + escapeAttr(currentName) + '" placeholder="Template name">'
      + errorHtml
      + '<div class="gc-save-template-actions">'
      + '<button type="button" class="btn btn-outline" data-action="close-save-template-modal">Cancel</button>'
      + '<button type="button" class="btn btn-blue" data-action="confirm-save-template-modal"' + (state.loading ? ' disabled' : '') + '>Save</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function renderDualSideCanvasOverlayHtml() {
    if (!state.isTwoSided) {
      return '';
    }

    return ''
      + '<div class="gc-step2-dual-divider" aria-hidden="true"></div>'
      + '<div class="gc-step2-dual-side-tag is-front">Front</div>'
      + '<div class="gc-step2-dual-side-tag is-back">Back</div>';
  }

  function renderStep2() {
    ensureStep2DraftInitialized();
    var draftHistoryState = ensureDraftHistoryState();

    var templateName = String(state.templateDraftName || (state.selectedTemplate && state.selectedTemplate.name) || 'New Template');
    var templateVersion = state.selectedTemplate && state.selectedTemplate.id
      ? Number(state.selectedTemplate.version || 1)
      : null;
    var metrics = draftCanvasMetrics();
    var layout = draftCanvasLayoutMetrics(metrics);
    var zoom = Number(state.draftZoom || 1);
    if (!Number.isFinite(zoom) || zoom <= 0) {
      zoom = 1;
    }
    var zoomOriginX = Number(state.draftZoomOriginX);
    var zoomOriginY = Number(state.draftZoomOriginY);
    if (!Number.isFinite(zoomOriginX)) {
      zoomOriginX = 50;
    }
    if (!Number.isFinite(zoomOriginY)) {
      zoomOriginY = 50;
    }
    zoomOriginX = Math.max(0, Math.min(100, zoomOriginX));
    zoomOriginY = Math.max(0, Math.min(100, zoomOriginY));
    var displayInfo = draftCanvasDisplayInfo(metrics);
    var canvasDisplayCardWidth = Math.max(1, Math.round(Number(displayInfo.widthPx || 1)));
    var canvasDisplayHeight = Math.max(1, Math.round(Number(displayInfo.heightPx || 1)));
    var canvasDisplayWidth = Math.max(1, canvasDisplayCardWidth * layout.sideCount);
    var canvasWrapStyle = 'width:' + String(canvasDisplayWidth) + 'px;height:' + String(canvasDisplayHeight) + 'px;transform-origin:' + zoomOriginX.toFixed(2) + '% ' + zoomOriginY.toFixed(2) + '%;transform:scale(' + zoom.toFixed(2) + ');';
    var canvasStyle = 'width:' + String(canvasDisplayWidth) + 'px;height:' + String(canvasDisplayHeight) + 'px;';
    var guidesOuterHtml = renderDraftGuidesHtml({
      outside: true,
      canvasLeft: 0,
      canvasTop: 0,
      canvasWidth: canvasDisplayWidth,
      canvasHeight: canvasDisplayHeight,
      layerWidth: canvasDisplayWidth,
      layerHeight: canvasDisplayHeight,
    });
    var zoomLabel = Math.round(zoom * 100);
    var canUndo = !!(draftHistoryState && draftHistoryState.undo && draftHistoryState.undo.length);
    var canRedo = !!(draftHistoryState && draftHistoryState.redo && draftHistoryState.redo.length);
    var guidesLocked = !!state.draftGuidesLocked;
    var activeFront = normalizeDraftEditorSide(state.draftActiveSide) !== 'back';
    var selectActive = state.draftTool === 'select';
    var textActive = state.draftTool === 'text';
    var photoActive = state.draftTool === 'photo';
    var rectActive = state.draftTool === 'rectangle';
    var canvasClass = 'gc-step2-canvas'
      + (state.isTwoSided ? ' is-two-sided' : '')
      + (textActive ? ' is-text-mode' : '')
      + (photoActive ? ' is-photo-mode' : '')
      + (rectActive ? ' is-rect-mode' : '');

    return '<div class="gc-step-panel gc-step-panel-step2">'
      + '<div class="gc-step2-workspace">'
      + '<div class="gc-step2-main">'
      + '<div class="gc-step2-tools">'
      + '<button type="button" class="gc-step2-tool-btn' + (selectActive ? ' is-active' : '') + '" data-action="set-draft-tool" data-tool="select" title="Select" aria-label="Select">'
      + '<span class="gc-step2-tool-icon"><i class="fa-solid fa-arrow-pointer"></i></span>'
      + '</button>'
      + '<button type="button" class="gc-step2-tool-btn' + (textActive ? ' is-active' : '') + '" data-action="set-draft-tool" data-tool="text" title="Text" aria-label="Text">'
      + '<span class="gc-step2-tool-icon"><i class="fa-solid fa-font"></i></span>'
      + '</button>'
      + '<button type="button" class="gc-step2-tool-btn' + (photoActive ? ' is-active' : '') + '" data-action="set-draft-tool" data-tool="photo" title="Photo" aria-label="Photo">'
      + '<span class="gc-step2-tool-icon"><i class="fa-solid fa-image"></i></span>'
      + '</button>'
      + '<button type="button" class="gc-step2-tool-btn' + (rectActive ? ' is-active' : '') + '" data-action="set-draft-tool" data-tool="rectangle" title="Rectangle" aria-label="Rectangle">'
      + '<span class="gc-step2-tool-icon"><i class="fa-solid fa-vector-square"></i></span>'
      + '</button>'
      + '</div>'
      + '<div class="gc-step2-canvas-shell' + (guidesLocked ? ' is-guides-locked' : '') + '">'
      + '<div class="gc-step2-canvas-head">'
      + '<div class="gc-inline-group">'
      + '<div class="gc-inline-label">Working Template</div>'
      + '<div class="gc-inline-value">' + escapeHtml(templateName) + (templateVersion ? ' (v' + templateVersion + ')' : ' (Draft)') + '</div>'
      + '</div>'
      + '<div class="gc-step2-center-controls">'
      + '<button type="button" class="btn btn-outline" data-action="undo-draft"' + (canUndo ? '' : ' disabled') + ' title="Undo"><i class="fa-solid fa-rotate-left"></i></button>'
      + '<button type="button" class="btn btn-outline" data-action="redo-draft"' + (canRedo ? '' : ' disabled') + ' title="Redo"><i class="fa-solid fa-rotate-right"></i></button>'
      + '<button type="button" class="btn btn-outline" data-action="zoom-out" title="Zoom Out"><i class="fa-solid fa-magnifying-glass-minus"></i></button>'
      + '<button type="button" class="btn btn-outline" data-action="zoom-in" title="Zoom In"><i class="fa-solid fa-magnifying-glass-plus"></i></button>'
      + '<button type="button" class="btn btn-outline" data-action="zoom-fit" title="Fit to View">Fit</button>'
      + '<span class="gc-step2-zoom-pill">' + zoomLabel + '%</span>'
      + '</div>'
      + '<div class="gc-step2-side-switch">'
      + '<button type="button" class="gc-choice-btn' + (activeFront ? ' is-active' : '') + '" data-action="switch-draft-side" data-side="front">Front</button>'
      + (state.isTwoSided
        ? '<button type="button" class="gc-choice-btn' + (!activeFront ? ' is-active' : '') + '" data-action="switch-draft-side" data-side="back">Back</button>'
        : '')
      + (state.isTwoSided
        ? '<span class="gc-step2-target-side">Target: ' + (activeFront ? 'Front' : 'Back') + '</span>'
        : '')
      + '</div>'
      + '</div>'
      + '<div class="gc-step2-canvas-stage">'
      + '<div class="gc-step2-ruler-corner"></div>'
      + '<div class="gc-step2-ruler-top" data-action="start-guide-drag" data-axis="y"></div>'
      + '<div class="gc-step2-ruler-left" data-action="start-guide-drag" data-axis="x"></div>'
      + '<div class="gc-step2-stage-content">'
      + '<div class="gc-step2-canvas-wrap" style="' + canvasWrapStyle + '">'
      + '<div class="gc-step2-guide-layer">' + guidesOuterHtml + '</div>'
      + '<div class="' + canvasClass + '" style="' + canvasStyle + '">'
      + renderDualSideCanvasOverlayHtml()
      + renderDraftElementsHtml()
      + renderDraftAlignPreviewHtml()
      + renderDraftAxisLockHintHtml()
      + renderDraftInsertGuideHtml()
      + '</div>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="gc-step2-props">'
      + renderStep2RightPanelsHtml()
      + '</div>'
      + '</div>'
      + '</div>'
      + renderAutoMapReportModal()
      + renderSaveTemplateModal()
      + '<div class="gc-actions">'
      + renderStepFooterMeta()
      + '<div class="gc-actions-right">'
      + '<button type="button" class="btn btn-outline" data-action="prev-step">Back</button>'
      + '<button type="button" class="btn btn-blue" data-action="next-step">Next</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function renderStep3UploadSection() {
    var frontName = state.frontFile
      ? state.frontFile.name
      : (state.frontPreviewUrl
        ? 'Background PDF selected'
        : (hasSavedTemplateDesignForSide('front') ? 'Saved design available' : 'No file selected (optional)'));
    var backName = state.backFile
      ? state.backFile.name
      : (state.backPreviewUrl
        ? 'Background PDF selected'
        : (hasSavedTemplateDesignForSide('back') ? 'Saved design available' : 'No file selected (optional)'));

    return ''
      + '<div class="gc-step1-upload-row' + (state.isTwoSided ? '' : ' is-single-side') + '">'
      + '<div class="gc-step1-upload-col">'
      + '<div class="gc-inline-label">Front Background PDF (Optional Override)</div>'
      + '<div class="gc-upload-input-wrap">'
      + '<input id="gcFrontPdfInput" class="gc-file-input-native" type="file" accept="application/pdf,.pdf">'
      + '<label for="gcFrontPdfInput" class="gc-upload-btn">Choose Front PDF</label>'
      + '<span class="gc-file-pill" title="' + escapeAttr(frontName) + '">' + escapeHtml(frontName) + '</span>'
      + (hasDesignForSide('front')
        ? '<button type="button" class="btn btn-outline gc-upload-clear-btn" data-action="clear-pdf" data-side="front">Remove</button>'
        : '')
      + '</div>'
      + '</div>'
      + (state.isTwoSided
        ? ('<div class="gc-step1-upload-col">'
          + '<div class="gc-inline-label">Back Background PDF (Optional Override)</div>'
          + '<div class="gc-upload-input-wrap">'
          + '<input id="gcBackPdfInput" class="gc-file-input-native" type="file" accept="application/pdf,.pdf">'
          + '<label for="gcBackPdfInput" class="gc-upload-btn">Choose Back PDF</label>'
          + '<span class="gc-file-pill" title="' + escapeAttr(backName) + '">' + escapeHtml(backName) + '</span>'
          + (hasDesignForSide('back')
            ? '<button type="button" class="btn btn-outline gc-upload-clear-btn" data-action="clear-pdf" data-side="back">Remove</button>'
            : '')
          + '</div>'
          + '</div>')
        : '')
      + '</div>';
  }

  function renderStep3PreviewSection() {
    if (!state.previewPdfUrl) {
      return '<div class="gc-preview-empty">No generated preview yet. Click Generate Preview to review cards before final download.</div>';
    }

    return ''
      + '<div class="gc-step3-preview-frame-wrap">'
      + '<iframe class="gc-step3-preview-frame" src="' + escapeAttr(state.previewPdfUrl) + '#toolbar=1&navpanes=0&view=FitH" title="Generated Cards Preview"></iframe>'
      + '</div>';
  }

  function renderStep3() {
    var previewDisabled = (state.generating || !step1Valid() || selectedCardCount() <= 0) ? ' disabled' : '';
    var downloadDisabled = (state.generating || !state.previewPdfBlob) ? ' disabled' : '';
    var orientationText = state.orientation === 'portrait' ? 'Vertical' : 'Horizontal';
    var sideText = state.isTwoSided ? '2 Sided' : '1 Sided';
    var templateText = state.selectedTemplate ? String(state.selectedTemplate.name || ('Template #' + state.selectedTemplate.id)) : 'Not selected';

    return '<div class="gc-step-panel gc-step-panel-step3">'
      + '<h3 class="gc-step-title">Step 3: Preview And Download</h3>'
      + '<p class="gc-step-subtitle">Generate preview first, verify cards, then download final PDF.</p>'
      + '<div class="gc-summary gc-step3-summary">'
      + '<div class="gc-summary-item"><div class="gc-summary-label">Orientation</div><div class="gc-summary-value">' + escapeHtml(orientationText) + '</div></div>'
      + '<div class="gc-summary-item"><div class="gc-summary-label">Sides</div><div class="gc-summary-value">' + escapeHtml(sideText) + '</div></div>'
      + '<div class="gc-summary-item"><div class="gc-summary-label">Template</div><div class="gc-summary-value">' + escapeHtml(templateText) + '</div></div>'
      + '<div class="gc-summary-item"><div class="gc-summary-label">Cards to Generate</div><div class="gc-summary-value">' + selectedCardCount() + '</div></div>'
      + '</div>'
      + renderStep3UploadSection()
      + '<div class="gc-step3-preview-area">'
      + '<div class="gc-step1-previews-head">Generated Preview</div>'
      + renderStep3PreviewSection()
      + '</div>'
      + '<div class="gc-actions">'
      + renderStepFooterMeta()
      + '<div class="gc-actions-right">'
      + '<button type="button" class="btn btn-outline" data-action="prev-step">Back</button>'
      + '<button type="button" class="btn btn-blue" data-action="generate-preview"' + previewDisabled + '>'
      + (state.generating ? 'Generating...' : 'Generate Preview')
      + '</button>'
      + '<button type="button" class="btn btn-green" data-action="download-final-pdf"' + downloadDisabled + '>'
      + (state.generating ? 'Preparing...' : 'Download Final PDF')
      + '</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function render() {
    if (draftRenderRafId && typeof window !== 'undefined' && window.cancelAnimationFrame) {
      window.cancelAnimationFrame(draftRenderRafId);
      draftRenderRafId = 0;
    }

    if (state.step !== 2) {
      state.spacePanMode = false;
      state.spacePanState = null;
      state.pendingZoomAnchor = null;
    }

    setStepCounter();

    var panelHtml = '';
    if (state.step === 1) {
      panelHtml = renderStep1();
    } else if (state.step === 2) {
      panelHtml = renderStep2();
    } else {
      panelHtml = renderStep3();
    }

    flowRoot.innerHTML = ''
      + '<div class="gc-shell">'
      + panelHtml
      + (state.loading ? '<div class="gc-loading"><div class="gc-loading-box"><span class="gc-spinner"></span><span>Loading...</span></div></div>' : '')
      + '</div>';

    // Re-run unified-select enhancement after dynamic render so Step 1 selects don't fall back to native full-width popups.
    try {
      flowRoot.dispatchEvent(new CustomEvent('htmx:afterSwap', { bubbles: true }));
    } catch (_err) {
      // no-op
    }

    if (state.draftSaveModalOpen) {
      var saveNameInput = flowRoot.querySelector('#gcDraftTemplateNameModalInput');
      if (saveNameInput && document.activeElement !== saveNameInput) {
        saveNameInput.focus();
        saveNameInput.select();
      }
    }

    focusDraftInlineEditorIfNeeded();
    setSpacePanUiState();
    applyPendingZoomAnchor();
    renderPdfCanvases();
  }

  function sidePreviewSource(side) {
    return side === 'back' ? state.backPreviewUrl : state.frontPreviewUrl;
  }

  function sidePreviewFile(side) {
    return side === 'back' ? state.backFile : state.frontFile;
  }

  function sidePreviewKey(side) {
    var file = sidePreviewFile(side);
    if (file) {
      return 'file:' + [file.name || '', Number(file.size || 0), Number(file.lastModified || 0)].join(':');
    }
    return 'url:' + String(sidePreviewSource(side) || '');
  }

  function setCanvasLoadingState(canvas, message, isError) {
    var loadingEl = canvas && canvas.parentElement
      ? canvas.parentElement.querySelector('.gc-preview-loading')
      : null;
    if (!loadingEl) {
      return;
    }
    loadingEl.classList.remove('is-hidden');
    loadingEl.classList.toggle('is-error', !!isError);
    loadingEl.textContent = String(message || (isError ? 'Preview unavailable' : 'Loading preview...'));
  }

  function hideCanvasLoadingState(canvas) {
    var loadingEl = canvas && canvas.parentElement
      ? canvas.parentElement.querySelector('.gc-preview-loading')
      : null;
    if (!loadingEl) {
      return;
    }
    loadingEl.classList.add('is-hidden');
    loadingEl.classList.remove('is-error');
  }

  function clearCanvasFallbackFrame(canvas) {
    var fallbackEl = canvas && canvas.parentElement
      ? canvas.parentElement.querySelector('.gc-pdf-fallback-frame')
      : null;
    if (!fallbackEl) {
      if (canvas) {
        canvas.style.display = '';
      }
      return;
    }
    fallbackEl.classList.add('is-hidden');
    try {
      if (String(fallbackEl.src || '') !== 'about:blank') {
        fallbackEl.src = 'about:blank';
      }
    } catch (_clearErr) {
      // Ignore frame clear failures.
    }
    if (canvas) {
      canvas.style.display = '';
    }
  }

  function showCanvasFallbackFrame(canvas, source) {
    var fallbackEl = canvas && canvas.parentElement
      ? canvas.parentElement.querySelector('.gc-pdf-fallback-frame')
      : null;
    if (!canvas || !fallbackEl || !source) {
      return false;
    }
    try {
      fallbackEl.src = String(source);
      fallbackEl.classList.remove('is-hidden');
      canvas.style.display = 'none';
      return true;
    } catch (_fallbackErr) {
      return false;
    }
  }

  async function drawPdfPreviewCanvas(canvas) {
    var side = String(canvas.getAttribute('data-side') || 'front');
    var source = sidePreviewSource(side);
    if (!source) {
      return;
    }

    var renderKey = sidePreviewKey(side);
    if (canvas.getAttribute('data-render-key') === renderKey && canvas.getAttribute('data-render-state') === 'done') {
      return;
    }

    var token = String(Date.now()) + ':' + Math.random();
    canvas.setAttribute('data-render-key', renderKey);
    canvas.setAttribute('data-render-state', 'loading');
    canvas.setAttribute('data-render-token', token);
    clearCanvasFallbackFrame(canvas);
    setCanvasLoadingState(canvas, 'Loading preview...', false);

    try {
      var pdfjs = await ensurePdfJsReady();
      if (!document.body.contains(canvas)) {
        return;
      }

      var file = sidePreviewFile(side);
      var loadingTask = null;
      if (file) {
        var bytes = new Uint8Array(await file.arrayBuffer());
        loadingTask = pdfjs.getDocument({ data: bytes });
      } else {
        loadingTask = pdfjs.getDocument({ url: source, withCredentials: true });
      }

      var pdf = await loadingTask.promise;
      var page = await pdf.getPage(1);

      if (!document.body.contains(canvas) || canvas.getAttribute('data-render-token') !== token) {
        try {
          await pdf.destroy();
        } catch (_destroyErr) {
          // Ignore stale render cleanup errors.
        }
        return;
      }

      var boxRect = canvas.parentElement.getBoundingClientRect();
      var maxW = Math.max(120, Math.floor(boxRect.width || 320));
      var maxH = Math.max(80, Math.floor(boxRect.height || 200));
      var initialViewport = page.getViewport({ scale: 1 });
      var scale = Math.min(maxW / initialViewport.width, maxH / initialViewport.height);
      // Keep PDF preview crisp and realistic: do not upscale above source size.
      scale = Math.min(1, scale);
      if (!Number.isFinite(scale) || scale <= 0) {
        scale = 1;
      }
      var viewport = page.getViewport({ scale: scale });
      var dpr = window.devicePixelRatio || 1;

      canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      canvas.style.width = Math.max(1, Math.floor(viewport.width)) + 'px';
      canvas.style.height = Math.max(1, Math.floor(viewport.height)) + 'px';

      var ctx = canvas.getContext('2d', { alpha: false });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, viewport.width, viewport.height);

      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      if (canvas.getAttribute('data-render-token') !== token) {
        try {
          await pdf.destroy();
        } catch (_destroyErr2) {
          // Ignore stale render cleanup errors.
        }
        return;
      }

      canvas.setAttribute('data-render-state', 'done');
      hideCanvasLoadingState(canvas);
      try {
        await pdf.destroy();
      } catch (_destroyErr3) {
        // Ignore cleanup errors after successful render.
      }
    } catch (_err) {
      if (showCanvasFallbackFrame(canvas, source)) {
        canvas.setAttribute('data-render-state', 'done-fallback');
        hideCanvasLoadingState(canvas);
        return;
      }
      canvas.setAttribute('data-render-state', 'error');
      setCanvasLoadingState(canvas, 'Preview unavailable for this PDF.', true);
    }
  }

  function renderPdfCanvases() {
    var canvases = flowRoot.querySelectorAll('.gc-pdf-canvas[data-side]');
    Array.prototype.forEach.call(canvases, function (canvas) {
      drawPdfPreviewCanvas(canvas);
    });
  }

  function parseInitialConfig() {
    state.orientation = normalizeOrientation('landscape');
    state.isTwoSided = false;
    state.frontPreviewUrl = '';
    state.backPreviewUrl = '';
  }

  function loadSelectionFromCards() {
    var preselected = Array.isArray(window.GEN_PRESELECT_PR_IDS) ? window.GEN_PRESELECT_PR_IDS : [];
    state.selectedRequestIds = new Set(preselected.map(function (item) {
      return Number(item);
    }).filter(function (item) {
      return Number.isFinite(item) && item > 0;
    }));

    if (state.selectedRequestIds.size > 0) {
      return;
    }

    (state.cards || []).forEach(function (item) {
      var id = Number(item && item.pr_id);
      if (Number.isFinite(id) && id > 0) {
        state.selectedRequestIds.add(id);
      }
    });
  }

  async function loadCards() {
    var data = await requestJson('GET', cardsPath());
    state.cards = Array.isArray(data.items) ? data.items : [];
    loadSelectionFromCards();
  }

  async function loadTemplates() {
    var data = await requestJson('GET', templatesPath(TABLE_ID));
    state.templates = Array.isArray(data.templates) ? data.templates : [];
  }

  async function selectTemplate(templateId) {
    var id = Number(templateId || 0);
    revokeLocalPreview('front');
    revokeLocalPreview('back');
    state.frontFile = null;
    state.backFile = null;

    if (!id) {
      state.selectedTemplateId = null;
      state.selectedTemplate = null;
      state.frontPreviewUrl = '';
      state.backPreviewUrl = '';
      resetStep2DraftState();
      return;
    }

    var detail = await requestJson('GET', templateDetailPath(id));
    state.selectedTemplateId = id;
    state.selectedTemplate = detail.template || null;
    state.frontPreviewUrl = String((state.selectedTemplate && state.selectedTemplate.front_pdf_url) || '');
    state.backPreviewUrl = String((state.selectedTemplate && state.selectedTemplate.back_pdf_url) || '');
    resetStep2DraftState();
    state.templateDraftName = state.selectedTemplate ? String(state.selectedTemplate.name || '') : '';
  }

  function handlePdfFile(side, file) {
    if (!file) {
      return;
    }

    if (!/\.pdf$/i.test(file.name || '')) {
      setAlert('Please upload a PDF file only.', 'error');
      showToast('Please upload a PDF file only.', 'error');
      return;
    }

    if (Number(file.size || 0) > (20 * 1024 * 1024)) {
      setAlert('PDF file size should be 20 MB or less.', 'error');
      showToast('PDF file size should be 20 MB or less.', 'error');
      return;
    }

    revokeLocalPreview(side);
    var previewUrl = URL.createObjectURL(file);
    state.localPreviewUrls[side] = previewUrl;

    if (side === 'front') {
      state.frontFile = file;
      state.frontPreviewUrl = previewUrl;
    } else {
      state.backFile = file;
      state.backPreviewUrl = previewUrl;
    }

    setAlert('', 'warning');
    render();
  }

  function collectStep2MappingValidation() {
    ensureStep2DraftInitialized();
    var template = state.templateDraft;
    var elements = template && Array.isArray(template.elements) ? template.elements : [];
    var hasMappedField = false;
    var invalid = [];
    var invalidSeen = {};

    function addInvalid(name) {
      var key = normalizeFieldLookupKey(name);
      if (!key || invalidSeen[key]) {
        return;
      }
      invalidSeen[key] = true;
      invalid.push(String(name || '').trim());
    }

    elements.forEach(function (item) {
      if (!item || (item.type !== 'text' && item.type !== 'image')) {
        return;
      }

      var fieldName = String(item.field || '').trim();
      if (fieldName) {
        if (findTableFieldByName(fieldName)) {
          hasMappedField = true;
        } else {
          addInvalid(fieldName);
        }
      }

      if (item.type === 'text') {
        var tokenFields = extractMergeTokenFieldNames(String(item.label || item.text || ''));
        tokenFields.forEach(function (tokenName) {
          if (findTableFieldByName(tokenName)) {
            hasMappedField = true;
          } else {
            addInvalid(tokenName);
          }
        });
      }
    });

    return {
      hasMappedField: hasMappedField,
      invalid: invalid,
    };
  }

  function validateStep2MappingsBeforeStep3() {
    var validation = collectStep2MappingValidation();
    if (validation.invalid.length) {
      var badList = validation.invalid.slice(0, 3).join(', ');
      var badSuffix = validation.invalid.length > 3 ? '...' : '';
      var invalidMessage = 'Fix invalid mapped fields before Step 3: ' + badList + badSuffix;
      setAlert(invalidMessage, 'error');
      showToast(invalidMessage, 'error');
      return false;
    }

    if (!validation.hasMappedField) {
      var message = 'Map at least one template field in Step 2 before going to Step 3.';
      setAlert(message, 'error');
      showToast(message, 'error');
      return false;
    }

    return true;
  }

  function handleStepNext() {
    var previousStep = state.step;
    var nextStep = Math.min(3, state.step + 1);
    if (nextStep === 3 && previousStep !== 3 && !validateStep2MappingsBeforeStep3()) {
      render();
      return;
    }

    if (nextStep === 3 && previousStep !== 3) {
      state.loading = true;
      render();
      ensureTemplateAutosavedForStep3()
        .then(function () {
          state.step = 3;
          setAlert('Template autosaved for this table. Generate preview to review before final download.', 'warning');
        })
        .catch(function (err) {
          var message = err && err.message ? err.message : 'Unable to autosave template for Step 3.';
          setAlert(message, 'error');
          showToast(message, 'error');
        })
        .finally(function () {
          state.loading = false;
          render();
        });
      return;
    }

    state.step = nextStep;
    if (state.step === 2) {
      ensureStep2DraftInitialized();
      if (previousStep === 1) {
        applyDefaultStep2Viewport();
      }
    }
    setAlert('', 'warning');
    render();
  }

  function handleStepBack() {
    state.step = Math.max(1, state.step - 1);
    setAlert('', 'warning');
    render();
  }

  function goToStep(stepNum) {
    var previousStep = state.step;
    var nextStep = Number(stepNum || 1);
    if (!Number.isFinite(nextStep)) {
      return;
    }
    nextStep = Math.min(3, Math.max(1, Math.floor(nextStep)));
    if (nextStep === 3 && previousStep !== 3 && !validateStep2MappingsBeforeStep3()) {
      render();
      return;
    }

    if (nextStep === 3 && previousStep !== 3) {
      state.loading = true;
      render();
      ensureTemplateAutosavedForStep3()
        .then(function () {
          state.step = 3;
          setAlert('Template autosaved for this table. Generate preview to review before final download.', 'warning');
        })
        .catch(function (err) {
          var message = err && err.message ? err.message : 'Unable to autosave template for Step 3.';
          setAlert(message, 'error');
          showToast(message, 'error');
        })
        .finally(function () {
          state.loading = false;
          render();
        });
      return;
    }

    state.step = nextStep;
    if (state.step === 2) {
      ensureStep2DraftInitialized();
      if (previousStep === 1) {
        applyDefaultStep2Viewport();
      }
    }
    setAlert('', 'warning');
    render();
  }

  function draftTemplateName() {
    return 'Quick Template ' + String(new Date().toISOString().slice(11, 19)).replace(/:/g, '');
  }

  async function createDraftTemplate() {
    ensureStep2DraftInitialized();

    var baseTemplate = state.selectedTemplate;

    var payload = {
      name: String(state.templateDraftName || draftTemplateName()).slice(0, 120),
      is_two_sided: !!state.isTwoSided,
      card_orientation: normalizeOrientation(state.orientation),
      template_json: state.templateDraft ? templateJsonForApi(state.templateDraft) : defaultTemplateJson(),
      font_size: Number((baseTemplate && baseTemplate.font_size) || DRAFT_DEFAULT_FONT_PT),
      font_family: String((baseTemplate && baseTemplate.font_family) || 'Arial'),
      is_default: false,
    };

    if (baseTemplate && baseTemplate.field_mappings && typeof baseTemplate.field_mappings === 'object') {
      payload.field_mappings = baseTemplate.field_mappings;
    }

    var createResult = await requestJson('POST', templatesPath(TABLE_ID), payload);
    if (Array.isArray(createResult && createResult.templates)) {
      state.templates = createResult.templates;
    }

    var createdTemplate = createResult && createResult.template ? createResult.template : null;
    if (!createdTemplate || !createdTemplate.id) {
      throw new Error('Unable to create template draft.');
    }

    await selectTemplate(createdTemplate.id);
    state.templateDraftName = String(createdTemplate.name || state.templateDraftName || 'Template');
    state.templateDraft = templateJsonForApi(createdTemplate.template_json || state.templateDraft || defaultTemplateJson());
    state.templateDraft.elements = state.templateDraft.elements.map(function (item, idx) {
      return normalizeDraftElement(item, idx);
    });
    normalizeDraftElementZOrder(false);
    state.draftDirty = false;
    if (!state.draftSelectedElementId && state.templateDraft.elements.length) {
      state.draftSelectedElementId = state.templateDraft.elements[0].__id;
    }
    return state.selectedTemplate;
  }

  async function saveDraftTemplate() {
    ensureStep2DraftInitialized();
    syncDraftToSelectedTemplate();

    var name = String(state.templateDraftName || draftTemplateName()).trim().slice(0, 120);
    if (!name) {
      name = draftTemplateName();
      state.templateDraftName = name;
    }

    var payload = {
      name: name,
      is_two_sided: !!state.isTwoSided,
      card_orientation: normalizeOrientation(state.orientation),
      template_json: templateJsonForApi(state.templateDraft),
      font_size: Number((state.selectedTemplate && state.selectedTemplate.font_size) || DRAFT_DEFAULT_FONT_PT),
      font_family: String((state.selectedTemplate && state.selectedTemplate.font_family) || 'Arial'),
      is_default: !!(state.selectedTemplate && state.selectedTemplate.is_default),
    };

    if (state.selectedTemplate && state.selectedTemplate.field_mappings && typeof state.selectedTemplate.field_mappings === 'object') {
      payload.field_mappings = state.selectedTemplate.field_mappings;
    }

    var result = null;
    if (state.selectedTemplate && state.selectedTemplate.id) {
      result = await requestJson('PUT', templatesPath(state.selectedTemplate.id), payload);
    } else {
      result = await requestJson('POST', templatesPath(TABLE_ID), payload);
    }

    if (Array.isArray(result && result.templates)) {
      state.templates = result.templates;
    }

    var savedTemplate = result && result.template ? result.template : null;
    if (!savedTemplate || !savedTemplate.id) {
      throw new Error('Unable to save template.');
    }

    await selectTemplate(savedTemplate.id);
    state.templateDraftName = String(savedTemplate.name || name);
    state.templateDraft = templateJsonForApi(savedTemplate.template_json || payload.template_json);
    state.templateDraft.elements = state.templateDraft.elements.map(function (item, idx) {
      return normalizeDraftElement(item, idx);
    });
    normalizeDraftElementZOrder(false);
    state.draftDirty = false;
    if (!state.draftSelectedElementId && state.templateDraft.elements.length) {
      state.draftSelectedElementId = state.templateDraft.elements[0].__id;
    }

    return state.selectedTemplate;
  }

  async function ensureTemplateAutosavedForStep3() {
    ensureStep2DraftInitialized();
    syncDraftToSelectedTemplate();

    var hasTemplateId = !!(state.selectedTemplate && state.selectedTemplate.id);
    if (hasTemplateId && !state.draftDirty) {
      return state.selectedTemplate;
    }

    if (!state.templateDraftName) {
      var baseName = state.selectedTemplate && state.selectedTemplate.name
        ? String(state.selectedTemplate.name)
        : ('AutoSave ' + String(new Date().toISOString().slice(0, 16)).replace(/[T:]/g, '-'));
      state.templateDraftName = baseName.slice(0, 120);
    }

    return saveDraftTemplate();
  }

  async function uploadDesignPdfs() {
    if (state.frontFile) {
      var frontForm = new FormData();
      frontForm.append('pdf', state.frontFile, state.frontFile.name);
      await requestForm(uploadPdfPath('front'), frontForm);
    }

    if (state.isTwoSided && state.backFile) {
      var backForm = new FormData();
      backForm.append('pdf', state.backFile, state.backFile.name);
      await requestForm(uploadPdfPath('back'), backForm);
    }
  }

  async function clearPdfForSide(side) {
    if (side !== 'front' && side !== 'back') {
      return;
    }

    var templateId = Number(state.selectedTemplate && state.selectedTemplate.id || 0);
    var hadSavedTemplateDesign = hasSavedTemplateDesignForSide(side);

    revokeLocalPreview(side);
    if (side === 'front') {
      state.frontFile = null;
      state.frontPreviewUrl = '';
    } else {
      state.backFile = null;
      state.backPreviewUrl = '';
    }

    if (templateId > 0 && hadSavedTemplateDesign) {
      await requestJson('POST', clearPdfPath(side), {});
      if (state.selectedTemplate && typeof state.selectedTemplate === 'object') {
        if (side === 'front') {
          state.selectedTemplate.front_pdf_url = '';
          state.selectedTemplate.has_front_pdf = false;
          state.selectedTemplate.has_front_editable_design = false;
          state.selectedTemplate.has_front_design = false;
        } else {
          state.selectedTemplate.back_pdf_url = '';
          state.selectedTemplate.has_back_pdf = false;
          state.selectedTemplate.has_back_editable_design = false;
          state.selectedTemplate.has_back_design = false;
        }
      }
    }

    setAlert((side === 'front' ? 'Front' : 'Back') + ' background cleared.', 'warning');
    showToast((side === 'front' ? 'Front' : 'Back') + ' background cleared.', 'success');
    render();
  }

  async function handleGeneratePreview() {
    if (state.generating) {
      return;
    }
    if (!validateStep2MappingsBeforeStep3()) {
      render();
      return;
    }
    if (selectedCardCount() <= 0) {
      setAlert('No cards available to generate.', 'error');
      return;
    }

    state.generating = true;
    render();

    try {
      setAlert('Preparing template and generating preview...', 'warning');
      var workingTemplate = await ensureTemplateAutosavedForStep3();
      if (!workingTemplate || !workingTemplate.id) {
        throw new Error('Unable to prepare template for preview generation.');
      }
      await uploadDesignPdfs();

      var requestIds = Array.from(state.selectedRequestIds);
      var result = await requestBinary(generatePath(), {
        request_ids: requestIds,
        template_id: Number(workingTemplate.id),
        preview_only: true,
        export_format: 'pdf',
      });

      if (state.previewPdfUrl) {
        try {
          URL.revokeObjectURL(state.previewPdfUrl);
        } catch (_revokeErr) {
          // Ignore URL revoke failures.
        }
      }

      state.previewPdfBlob = result.blob;
      state.previewPdfName = result.filename || 'preview_cards.pdf';
      state.previewPdfUrl = URL.createObjectURL(state.previewPdfBlob);

      setAlert('Preview generated. Review it, edit if needed, then download final PDF.', 'warning');
      showToast('Preview generated successfully.', 'success');
    } catch (err) {
      var message = err && err.message ? err.message : 'Generation failed.';
      setAlert(message, 'error');
      showToast(message, 'error');
    } finally {
      state.generating = false;
      render();
    }
  }

  async function handleDownloadFinalPdf() {
    if (state.generating) {
      return;
    }
    if (!state.previewPdfBlob) {
      showToast('Generate preview first, then download final PDF.', 'warning');
      return;
    }

    state.generating = true;
    render();
    try {
      setAlert('Generating final PDF for download...', 'warning');
      var workingTemplate = await ensureTemplateAutosavedForStep3();
      if (!workingTemplate || !workingTemplate.id) {
        throw new Error('Unable to prepare template for final download.');
      }
      await uploadDesignPdfs();

      var requestIds = Array.from(state.selectedRequestIds);
      var result = await requestBinary(generatePath(), {
        request_ids: requestIds,
        template_id: Number(workingTemplate.id),
        preview_only: false,
        export_format: 'pdf',
      });

      state.lastPdfBlob = result.blob;
      state.lastPdfName = result.filename || 'cards.pdf';
      downloadBlob(state.lastPdfBlob, state.lastPdfName);

      setAlert('Final PDF downloaded successfully.', 'warning');
      showToast('Final PDF downloaded successfully.', 'success');
    } catch (err) {
      var message = err && err.message ? err.message : 'Final PDF generation failed.';
      setAlert(message, 'error');
      showToast(message, 'error');
    } finally {
      state.generating = false;
      render();
    }
  }

  async function refreshModalData() {
    resetTransientState();
    resetStep2DraftState();
    parseInitialConfig();
    setAlert('', 'warning');
    state.step = 1;
    state.loading = true;
    render();

    try {
      await Promise.all([loadCards(), loadTemplates()]);
      state.selectedTemplateId = null;
      state.selectedTemplate = null;
    } finally {
      state.loading = false;
      render();
    }
  }

  flowRoot.addEventListener('click', function (event) {
    var target = event.target.closest('[data-action]');
    if (!target) {
      return;
    }

    var action = String(target.getAttribute('data-action') || '');
    if (!action) {
      return;
    }

    if (action === 'set-orientation') {
      state.orientation = normalizeOrientation(target.getAttribute('data-value'));
      render();
      return;
    }

    if (action === 'set-sides') {
      var value = String(target.getAttribute('data-value') || 'single');
      state.isTwoSided = value === 'double';
      if (!state.isTwoSided && state.draftActiveSide === 'back') {
        state.draftActiveSide = 'front';
      }
      render();
      return;
    }

    if (action === 'clear-pdf') {
      clearPdfForSide(String(target.getAttribute('data-side') || ''));
      return;
    }

    if (action === 'next-step') {
      handleStepNext();
      return;
    }

    if (action === 'prev-step') {
      handleStepBack();
      return;
    }

    if (action === 'switch-draft-side') {
      var side = normalizeDraftEditorSide(target.getAttribute('data-side'));
      state.draftActiveSide = (!state.isTwoSided && side === 'back') ? 'front' : side;
      render();
      return;
    }

    if (action === 'switch-draft-orientation') {
      switchDraftCanvasOrientation(target.getAttribute('data-value'));
      render();
      return;
    }

    if (action === 'zoom-in') {
      applyZoomFactor(DRAFT_ZOOM_IN_FACTOR, null);
      render();
      return;
    }

    if (action === 'zoom-out') {
      applyZoomFactor(DRAFT_ZOOM_OUT_FACTOR, null);
      render();
      return;
    }

    if (action === 'zoom-fit') {
      setDraftZoomWithAnchor(1, null);
      render();
      return;
    }

    if (action === 'toggle-guides-lock') {
      state.draftGuidesLocked = !state.draftGuidesLocked;
      if (state.draftGuidesLocked) {
        state.draftGuideDragging = null;
        state.draftSelectedGuideId = '';
      }
      showToast(state.draftGuidesLocked ? 'Guides locked.' : 'Guides unlocked.', 'info');
      render();
      return;
    }

    if (action === 'open-auto-map-report') {
      if (state.draftAutoMapReport) {
        state.draftAutoMapReportOpen = true;
        render();
      }
      return;
    }

    if (action === 'close-auto-map-report') {
      state.draftAutoMapReportOpen = false;
      render();
      return;
    }

    if (action === 'open-save-template-modal') {
      openSaveTemplateModal();
      render();
      return;
    }

    if (action === 'close-save-template-modal') {
      closeSaveTemplateModal();
      render();
      return;
    }

    if (action === 'confirm-save-template-modal') {
      var modalNameInput = flowRoot.querySelector('#gcDraftTemplateNameModalInput');
      var modalName = String(modalNameInput && modalNameInput.value || state.draftSaveTemplateName || '').trim();
      if (!modalName) {
        state.draftSaveTemplateError = 'Template name is required.';
        render();
        return;
      }
      state.draftSaveTemplateError = '';
      closeSaveTemplateModal();
      triggerSaveDraftTemplate(modalName);
      return;
    }

    if (action === 'undo-draft') {
      if (undoDraftHistory()) {
        render();
      }
      return;
    }

    if (action === 'redo-draft') {
      if (redoDraftHistory()) {
        render();
      }
      return;
    }

    if (action === 'set-draft-tool') {
      var tool = String(target.getAttribute('data-tool') || 'select');
      if (state.draftInlineEditHistoryActive) {
        endDraftHistoryTransaction();
        state.draftInlineEditHistoryActive = false;
      }
      endDraftHistoryTransaction();
      state.draftTextDrag = null;
      state.draftRectDrag = null;
      state.draftSelectDrag = null;
      state.draftDragging = null;
      state.draftResizeDragging = null;
      state.draftGuideDragging = null;
      state.draftAlignPreviewMode = '';
      clearDraftInlineTextEditing();
      if (tool === 'photo') {
        state.draftTool = 'photo';
      } else if (tool === 'rectangle') {
        state.draftTool = 'rectangle';
      } else if (tool === 'text') {
        state.draftTool = 'text';
      } else {
        state.draftTool = 'select';
      }
      render();
      return;
    }

    if (action === 'toggle-ui-panel') {
      toggleDraftUiPanel(target.getAttribute('data-panel'));
      render();
      return;
    }

    if (action === 'set-ui-panel') {
      setDraftActivePanel(target.getAttribute('data-panel'));
      render();
      return;
    }

    if (action === 'close-ui-panel') {
      setDraftActivePanel('');
      render();
      return;
    }

    if (action === 'layer-stack') {
      var stackMode = String(target.getAttribute('data-mode') || '').toLowerCase();
      if (moveSelectedDraftLayers(stackMode)) {
        render();
      }
      return;
    }

    if (action === 'select-layer-element') {
      var layerId = String(target.getAttribute('data-el-id') || '');
      var layerItem = findDraftElementById(layerId);
      if (!layerItem || !isDraftElementSelectable(layerItem)) {
        return;
      }
      state.draftSelectedGuideId = '';
      clearDraftInlineTextEditing();
      setDraftSelectedElementIds(new Set([layerId]), layerId);
      render();
      return;
    }

    if (action === 'toggle-layer-visibility') {
      var visId = String(target.getAttribute('data-el-id') || '');
      var visItem = findDraftElementById(visId);
      if (!visItem) {
        return;
      }
      if (setDraftLayerVisibility(visId, !isDraftElementVisible(visItem))) {
        render();
      }
      return;
    }

    if (action === 'toggle-layer-lock') {
      var lockId = String(target.getAttribute('data-el-id') || '');
      var lockItem = findDraftElementById(lockId);
      if (!lockItem) {
        return;
      }
      if (setDraftLayerLocked(lockId, !isDraftElementLocked(lockItem))) {
        render();
      }
      return;
    }

    if (action === 'auto-map-fields') {
      var scopeSelectEl = flowRoot.querySelector('#gcDraftAutoMapScopeSelect');
      var selectedScope = normalizeAutoMapScope(scopeSelectEl && scopeSelectEl.value || state.draftAutoMapScope || 'active');
      state.draftAutoMapScope = selectedScope;
      var mapping = autoMapDraftFields({ scope: selectedScope });
      state.draftAutoMapReport = mapping;
      state.draftAutoMapReportOpen = true;

      var mappedCount = Number(mapping && mapping.mappedCount || 0);
      var unmatchedCount = Array.isArray(mapping && mapping.unmatched) ? mapping.unmatched.length : 0;
      var imageMappedCount = Number(mapping && mapping.imageMappedCount || 0);
      if (mappedCount > 0) {
        showToast('Mapped ' + String(mappedCount) + ' token/photo field(s). Photo slots: ' + String(imageMappedCount) + ', unmatched: ' + String(unmatchedCount) + '.', 'success');
      } else {
        showToast('No token/photo mappings updated. Unmatched: ' + String(unmatchedCount) + '.', 'info');
      }
      render();
      return;
    }

    if (action === 'select-draft-element') {
      if (event.target && event.target.closest && event.target.closest('.gc-draft-selection-handle')) {
        return;
      }
      var elId = String(target.getAttribute('data-el-id') || '');
      var renderSide = normalizeDraftEditorSide(target.getAttribute('data-render-side'));
      if (!elId) {
        return;
      }
      if (state.isTwoSided) {
        state.draftActiveSide = renderSide;
      }
      if (event.target && event.target.closest && event.target.closest('.gc-draft-inline-editor')
        && state.draftInlineEditingElementId === elId) {
        return;
      }

      ensureStep2DraftInitialized();
      normalizeDraftElementSelection();
      var clickedItem = findDraftElementById(elId);
      if (!isDraftElementSelectable(clickedItem)) {
        return;
      }
      var clickedIsText = isDraftTextElement(clickedItem);
      var isDoubleClick = Number(event.detail || 0) >= 2;
      if (!event.shiftKey && clickedIsText && isDoubleClick && !state.draftMergePreview) {
        state.draftSelectedElementId = elId;
        state.draftSelectedElementIds = new Set([elId]);
        state.draftSelectedGuideId = '';
        if (setDraftInlineTextEditing(elId)) {
          state.draftPendingTextEdit = null;
          state.draftDragging = null;
          state.draftResizeDragging = null;
          normalizeDraftElementSelection();
          render();
          return;
        }
      }

      var pendingTextEdit = state.draftPendingTextEdit;
      var shouldInlineEdit = !!(
        !event.shiftKey
        && clickedIsText
        && !state.draftMergePreview
        && pendingTextEdit
        && pendingTextEdit.id === elId
        && !pendingTextEdit.moved
      );
      var selectedSet = selectedDraftElementSet();
      if (event.shiftKey) {
        state.draftPendingTextEdit = null;
        return;
      }

      if (!isDoubleClick
        && selectedSet.size > 1
        && selectedSet.has(elId)
        && !shouldInlineEdit) {
        if (state.draftKeyObjectId !== elId) {
          state.draftKeyObjectId = elId;
          state.draftAlignReference = normalizeDraftAlignReference(state.draftAlignReference);
          render();
        }
        state.draftPendingTextEdit = null;
        return;
      }

      var selectionChanged = false;
      if (!selectedSet.has(elId)) {
        state.draftSelectedElementId = elId;
        state.draftSelectedElementIds = elId ? new Set([elId]) : new Set();
        selectionChanged = true;
      }
      if (shouldInlineEdit) {
        setDraftInlineTextEditing(elId);
      } else if (state.draftInlineEditingElementId && state.draftInlineEditingElementId !== elId) {
        state.draftInlineEditingElementId = '';
      }
      state.draftSelectedGuideId = '';
      state.draftPendingTextEdit = null;
      normalizeDraftElementSelection();
      if (shouldInlineEdit || selectionChanged) {
        render();
      }
      return;
    }

    if (action === 'select-draft-guide') {
      if (state.draftGuidesLocked) {
        return;
      }
      var guideId = String(target.getAttribute('data-guide-id') || '');
      state.draftSelectedGuideId = guideId;
      state.draftSelectedElementId = '';
      state.draftSelectedElementIds = new Set();
      clearDraftInlineTextEditing();
      render();
      return;
    }

    if (action === 'remove-draft-element') {
      if (selectedDraftElement()) {
        removeDraftElement();
      } else if (selectedDraftGuide()) {
        if (state.draftGuidesLocked) {
          showToast('Unlock guides first to remove them.', 'warning');
        } else {
          removeDraftGuideById(state.draftSelectedGuideId);
        }
      }
      render();
      return;
    }

    if (action === 'nudge-draft') {
      var dx = Number(target.getAttribute('data-dx') || 0);
      var dy = Number(target.getAttribute('data-dy') || 0);
      if (nudgeSelectedDraftElement(dx, dy)) {
        render();
      }
      return;
    }

    if (action === 'toggle-text-style') {
      var styleName = String(target.getAttribute('data-style') || '').toLowerCase();
      var selectedText = selectedDraftElement();
      if (!selectedText || String(selectedText.type || '').toLowerCase() !== 'text') {
        showToast('Select a text element first.', 'warning');
        return;
      }

      if (styleName === 'bold') {
        if (toggleSelectedTextStyle('bold')) {
          render();
        }
      } else if (styleName === 'italic') {
        if (toggleSelectedTextStyle('italic')) {
          render();
        }
      }
      return;
    }

    if (action === 'duplicate-draft-element') {
      if (duplicateSelectedDraftElement()) {
        render();
      }
      return;
    }

    if (action === 'align-selected') {
      var mode = String(target.getAttribute('data-mode') || '');
      if (alignSelectedDraftElements(mode)) {
        render();
      }
      return;
    }

    if (action === 'save-draft-template') {
      openSaveTemplateModal();
      render();
      return;
    }

    if (action === 'generate-preview' || action === 'generate-all') {
      handleGeneratePreview();
      return;
    }

    if (action === 'download-final-pdf') {
      handleDownloadFinalPdf();
      return;
    }
  });

  if (window.GcEditorStageEventBindings && typeof window.GcEditorStageEventBindings.create === 'function') {
    stageEventBindings = window.GcEditorStageEventBindings.create({
      flowRoot: flowRoot,
      windowObj: window,
      modalEl: modalEl,
      state: state,
      reorderDraftLayerByIds: reorderDraftLayerByIds,
      render: render,
      applySmoothZoomFromWheel: applySmoothZoomFromWheel,
      renderStep2OnNextFrame: renderStep2OnNextFrame,
    });
    stageEventBindings.bind();
  }

  flowRoot.addEventListener('mousedown', function (event) {
    if (state.step !== 2) {
      return;
    }

    if (isTypingTarget(event.target)) {
      return;
    }

    if (state.spacePanMode) {
      var stageForPan = event.target && event.target.closest
        ? event.target.closest('.gc-step2-stage-content')
        : null;
      if (stageForPan) {
        state.spacePanState = {
          stageEl: stageForPan,
          startClientX: Number(event.clientX || 0),
          startClientY: Number(event.clientY || 0),
          startScrollLeft: Number(stageForPan.scrollLeft || 0),
          startScrollTop: Number(stageForPan.scrollTop || 0),
        };
        setSpacePanUiState();
        event.preventDefault();
        return;
      }
    }

    var guideEl = event.target.closest('.gc-draft-guide');
    if (guideEl) {
      if (state.draftGuidesLocked) {
        event.preventDefault();
        return;
      }
      var guideShell = guideEl.closest('.gc-step2-canvas-shell');
      var guideCanvas = guideShell ? guideShell.querySelector('.gc-step2-canvas') : guideEl.closest('.gc-step2-canvas');
      var guideId = String(guideEl.getAttribute('data-guide-id') || '');
      var guide = selectedDraftGuide();
      if (!guide || String(guide.id || '') !== guideId) {
        var guides = draftGuides();
        guide = guides.find(function (item) {
          return item && String(item.id || '') === guideId;
        }) || null;
      }
      if (guide && guideCanvas) {
        beginDraftHistoryTransaction();
        state.draftSelectedGuideId = guideId;
        state.draftSelectedElementId = '';
        state.draftSelectedElementIds = new Set();
        state.draftGuideDragging = {
          id: guideId,
          axis: guide.axis,
          canvasEl: guideCanvas,
          isNew: false,
        };
        clearDraftInlineTextEditing();
        event.preventDefault();
        render();
        return;
      }
    }

    var rulerEl = event.target.closest('.gc-step2-ruler-top, .gc-step2-ruler-left');
    if (rulerEl) {
      if (state.draftGuidesLocked) {
        event.preventDefault();
        return;
      }
      var shell = rulerEl.closest('.gc-step2-canvas-shell');
      var rulerCanvas = shell ? shell.querySelector('.gc-step2-canvas') : null;
      if (rulerCanvas) {
        beginDraftHistoryTransaction();
        var axisAttr = String(rulerEl.getAttribute('data-axis') || '').toLowerCase();
        var axis = (axisAttr === 'x' || axisAttr === 'y')
          ? axisAttr
          : (rulerEl.classList.contains('gc-step2-ruler-top') ? 'x' : 'y');
        var startPoint = canvasEventToDraftPoint(rulerCanvas, event, { allowOutside: true });
        state.draftActiveSide = normalizeDraftEditorSide(startPoint.side);
        var startPos = axis === 'x' ? startPoint.x : startPoint.y;
        startPos = snapCanvasValueToGrid(startPos, axis);
        var newGuideId = addDraftGuide(axis, startPos);
        state.draftSelectedGuideId = newGuideId;
        state.draftSelectedElementId = '';
        state.draftSelectedElementIds = new Set();
        state.draftGuideDragging = {
          id: newGuideId,
          axis: axis,
          canvasEl: rulerCanvas,
          isNew: true,
        };
        clearDraftInlineTextEditing();
        event.preventDefault();
        render();
        return;
      }
    }

    var canvasEl = event.target.closest('.gc-step2-canvas');
    if (!canvasEl) {
      var stageEl = event.target.closest('.gc-step2-canvas-stage');
      if (stageEl) {
        canvasEl = getActiveDraftCanvasEl();
      }
    }

    if (state.draftTool === 'text') {
      if (!canvasEl || event.target !== canvasEl) {
        return;
      }
      var startPoint = canvasEventToDraftPoint(canvasEl, event);
      state.draftActiveSide = normalizeDraftEditorSide(startPoint.side);
      var snappedStartX = snapCanvasValueToGrid(startPoint.x, 'x');
      var snappedStartY = snapCanvasValueToGrid(startPoint.y, 'y');
      state.draftTextDrag = {
        kind: 'text',
        canvasEl: canvasEl,
        side: state.draftActiveSide,
        startX: snappedStartX,
        startY: snappedStartY,
        currentX: snappedStartX,
        currentY: snappedStartY,
      };
      beginDraftHistoryTransaction();
      event.preventDefault();
      render();
      return;
    }

    if (state.draftTool === 'rectangle') {
      if (canvasEl && event.target === canvasEl) {
        var rectStart = canvasEventToDraftPoint(canvasEl, event);
        state.draftActiveSide = normalizeDraftEditorSide(rectStart.side);
        var snappedRectStartX = snapCanvasValueToGrid(rectStart.x, 'x');
        var snappedRectStartY = snapCanvasValueToGrid(rectStart.y, 'y');
        state.draftRectDrag = {
          kind: 'rectangle',
          canvasEl: canvasEl,
          side: state.draftActiveSide,
          startX: snappedRectStartX,
          startY: snappedRectStartY,
          currentX: snappedRectStartX,
          currentY: snappedRectStartY,
          lockSquare: !!event.shiftKey,
        };
        beginDraftHistoryTransaction();
        event.preventDefault();
        render();
        return;
      }
    }

    if (state.draftTool !== 'select' && state.draftTool !== 'rectangle') {
      return;
    }

    var el = event.target.closest('.gc-draft-el');
    var hitOverride = null;
    if (!canvasEl) {
      return;
    }

    var directHandle = event.target.closest('.gc-draft-selection-handle');
    if (state.draftTool === 'select' && !directHandle) {
      var hitPoint = canvasEventToDraftPoint(canvasEl, event, { allowOutside: true });
      var topItem = topDraftElementAtPoint(hitPoint.x, hitPoint.y, hitPoint.side, false);
      if (topItem) {
        hitOverride = {
          id: String(topItem.__id || ''),
          side: normalizeDraftEditorSide(hitPoint.side),
        };
        if (!el || String(el.getAttribute('data-el-id') || '') !== hitOverride.id) {
          var sideAttr = hitOverride.side === 'back' ? 'back' : 'front';
          var matchNode = canvasEl.querySelector('.gc-draft-el[data-el-id="' + hitOverride.id + '"][data-render-side="' + sideAttr + '"]');
          if (matchNode) {
            el = matchNode;
          }
        }
      }
    }

    if (!el && !hitOverride) {
      var selectStart = canvasEventToDraftPoint(canvasEl, event, { allowOutside: true });
      state.draftActiveSide = normalizeDraftEditorSide(selectStart.side);
      var marqueeBase = !!event.shiftKey ? Array.from(selectedDraftElementSet()) : [];
      state.draftPendingTextEdit = null;
      state.draftDragging = null;
      state.draftResizeDragging = null;
      state.draftSelectDrag = {
        kind: 'select',
        canvasEl: canvasEl,
        side: state.draftActiveSide,
        startX: Number(selectStart.x || 0),
        startY: Number(selectStart.y || 0),
        currentX: Number(selectStart.x || 0),
        currentY: Number(selectStart.y || 0),
        appendSelection: !!event.shiftKey,
        baseSelectionIds: marqueeBase,
      };
      beginDraftHistoryTransaction();
      clearDraftInlineTextEditing();
      event.preventDefault();
      render();
      return;
    }
    var handleEl = event.target.closest('.gc-draft-selection-handle');

    var elId = hitOverride && hitOverride.id
      ? String(hitOverride.id)
      : String(el && el.getAttribute('data-el-id') || '');
    var renderSideForEl = hitOverride && hitOverride.side
      ? normalizeDraftEditorSide(hitOverride.side)
      : normalizeDraftEditorSide(el && el.getAttribute('data-render-side'));
    if (!elId) {
      return;
    }
    if (state.isTwoSided) {
      state.draftActiveSide = renderSideForEl;
    }

    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();
    var selectedBefore = new Set(selectedDraftElementSet());
    var isGroupSelectionEl = !!(el && String(el.getAttribute('data-selection-group') || '') === '1');
    var wasAlreadySelected = selectedBefore.has(elId);
    var current = state.templateDraft.elements.find(function (item) {
      return item && item.__id === elId;
    });
    if (!current || !isDraftElementSelectable(current)) {
      return;
    }

    if (event.shiftKey && !handleEl) {
      var toggled = new Set(selectedBefore);
      if (toggled.has(elId)) {
        toggled.delete(elId);
      } else {
        toggled.add(elId);
      }
      setDraftSelectedElementIds(toggled, elId);
      state.draftSelectedGuideId = '';
      state.draftPendingTextEdit = null;
      clearDraftInlineTextEditing();
      event.preventDefault();
      render();
      return;
    }

    var keepMultiSelection = !event.shiftKey
      && ((selectedBefore.size > 1 && selectedBefore.has(elId)) || isGroupSelectionEl);

    if (handleEl) {
      var dragIdsForResize = keepMultiSelection ? Array.from(selectedBefore) : [elId];
      if (!dragIdsForResize.length) {
        dragIdsForResize = [elId];
      }
      if (!keepMultiSelection) {
        setDraftSelectedElementIds(new Set([elId]), elId);
      } else {
        setDraftSelectedElementIds(new Set(dragIdsForResize), state.draftSelectedElementId || elId);
      }
      state.draftSelectedGuideId = '';
      state.draftInlineEditingElementId = '';
      var resizeHandle = normalizeDraftResizeHandle(handleEl.getAttribute('data-handle'));
      var resizePoint = canvasEventToDraftPoint(canvasEl, event, { allowOutside: true });
      var resizeBounds = keepMultiSelection
        ? draftSelectionBounds(new Set(dragIdsForResize), renderSideForEl)
        : draftElementBounds(current);
      if (!resizeBounds) {
        resizeBounds = draftElementBounds(current);
      }
      var startElements = {};
      dragIdsForResize.forEach(function (sid) {
        var src = findDraftElementById(sid);
        if (!src) {
          return;
        }
        var b = draftElementBounds(src);
        startElements[String(sid)] = {
          x: Number(src.x || 0),
          y: Number(src.y || 0),
          width: Number(src.width || 0),
          height: Number(src.height || 0),
          scaleX: clampDraftScale(src.scaleX),
          scaleY: clampDraftScale(src.scaleY),
          rotation: normalizeDraftAngle(src.rotation),
          skewX: normalizeDraftAngle(src.skewX),
          skewY: normalizeDraftAngle(src.skewY),
          centerX: Number(b.x || 0) + (Number(b.width || 0) / 2),
          centerY: Number(b.y || 0) + (Number(b.height || 0) / 2),
        };
      });
      var startCenterX = Number(resizeBounds.x || 0) + (Number(resizeBounds.width || 0) / 2);
      var startCenterY = Number(resizeBounds.y || 0) + (Number(resizeBounds.height || 0) / 2);
      var startAngle = Math.atan2(Number(resizePoint.y || 0) - startCenterY, Number(resizePoint.x || 0) - startCenterX);
      var transformKind = 'resize';
      state.draftPendingTextEdit = null;
      state.draftDragging = null;
      state.draftResizeDragging = {
        id: elId,
        dragIds: dragIdsForResize,
        handle: resizeHandle,
        transformMode: 'resize',
        transformKind: transformKind,
        type: String(current.type || ''),
        textMode: String(current.textType || current.textMode || ''),
        startFontSize: Number(current.fontSize || DRAFT_DEFAULT_FONT_PT),
        startLetterSpacing: Number(current.letterSpacing || 0),
        startScaleX: clampDraftScale(current.scaleX),
        startScaleY: clampDraftScale(current.scaleY),
        startMouseX: Number(event.clientX || 0),
        startMouseY: Number(event.clientY || 0),
        startPointerX: Number(resizePoint.x || 0),
        startPointerY: Number(resizePoint.y || 0),
        startX: Number(resizeBounds.x || 0),
        startY: Number(resizeBounds.y || 0),
        startWidth: Number(resizeBounds.width || 0),
        startHeight: Number(resizeBounds.height || 0),
        startCenterX: startCenterX,
        startCenterY: startCenterY,
        startAngle: startAngle,
        startElements: startElements,
        groupBounds: resizeBounds,
        startAnchorX: Number(current.x || 0),
        startAnchorY: Number(current.y || 0),
        startBaseWidth: Number(current.width || 0),
        startBaseHeight: Number(current.height || 0),
        canvasRect: resizePoint.rect,
        metrics: resizePoint.metrics,
      };
      beginDraftHistoryTransaction();
      event.preventDefault();
      render();
      return;
    }

    if (!keepMultiSelection) {
      setDraftSelectedElementIds(new Set([elId]), elId);
    } else {
      setDraftSelectedElementIds(selectedBefore, state.draftSelectedElementId || elId);
    }
    state.draftSelectedGuideId = '';
    state.draftInlineEditingElementId = '';

    var dragIds = keepMultiSelection ? Array.from(selectedBefore) : [elId];
    var startPositions = {};
    dragIds.forEach(function (sid) {
      var item = findDraftElementById(sid);
      if (!item) {
        return;
      }
      startPositions[String(sid)] = {
        x: Number(item.x || 0),
        y: Number(item.y || 0),
      };
    });
    if (!Object.prototype.hasOwnProperty.call(startPositions, elId)) {
      startPositions[elId] = {
        x: Number(current.x || 0),
        y: Number(current.y || 0),
      };
    }

    if (!keepMultiSelection && isDraftTextElement(current)) {
      state.draftPendingTextEdit = {
        id: elId,
        startMouseX: Number(event.clientX || 0),
        startMouseY: Number(event.clientY || 0),
        moved: false,
      };
    } else {
      state.draftPendingTextEdit = null;
    }
    var point = canvasEventToDraftPoint(canvasEl, event);
    var anchorStart = startPositions[elId];
    state.draftDragging = {
      id: elId,
      dragIds: dragIds,
      startPositions: startPositions,
      startMouseX: Number(event.clientX || 0),
      startMouseY: Number(event.clientY || 0),
      startX: Number(anchorStart && anchorStart.x || current.x || 0),
      startY: Number(anchorStart && anchorStart.y || current.y || 0),
      moved: false,
      lockAxis: '',
      wasAlreadySelected: wasAlreadySelected,
      canvasRect: point.rect,
      metrics: point.metrics,
    };
    beginDraftHistoryTransaction();
    state.draftResizeDragging = null;

    event.preventDefault();
    render();
  });

  if (window.GcEditorPointerEventBindings && typeof window.GcEditorPointerEventBindings.create === 'function') {
    pointerEventBindings = window.GcEditorPointerEventBindings.create({
      flowRoot: flowRoot,
      windowObj: window,
      state: state,
      removeDraftGuideById: removeDraftGuideById,
      render: render,
      setDraftInlineTextEditing: setDraftInlineTextEditing,
      canvasEventToDraftPoint: canvasEventToDraftPoint,
      normalizeDraftEditorSide: normalizeDraftEditorSide,
      draftCanvasMetrics: draftCanvasMetrics,
      addDraftElement: addDraftElement,
      addPhotoPlaceholderElement: addPhotoPlaceholderElement,
      resolveStageContentEl: resolveStageContentEl,
      applyDraftResizeDrag: applyDraftResizeDrag,
      renderStep2OnNextFrame: renderStep2OnNextFrame,
      resolveDraftCanvasEl: resolveDraftCanvasEl,
      snapCanvasValueToGrid: snapCanvasValueToGrid,
      updateDraftGuidePosition: updateDraftGuidePosition,
      draftDragBox: draftDragBox,
      selectDraftElementsByBox: selectDraftElementsByBox,
      draftCanvasSideDisplayWidthPx: draftCanvasSideDisplayWidthPx,
      ensureStep2DraftInitialized: ensureStep2DraftInitialized,
      prepareDraftHistoryMutation: prepareDraftHistoryMutation,
      normalizeDraftElement: normalizeDraftElement,
      markDraftDirty: markDraftDirty,
      normalizeDraftElementSelection: normalizeDraftElementSelection,
      updateSelectedDraftElement: updateSelectedDraftElement,
      setSpacePanUiState: setSpacePanUiState,
      endDraftHistoryTransaction: endDraftHistoryTransaction,
      clearDraftInlineTextEditing: clearDraftInlineTextEditing,
    });
    pointerEventBindings.bind();
  }

  if (window.GcEditorKeyboardEventBindings && typeof window.GcEditorKeyboardEventBindings.create === 'function') {
    keyboardEventBindings = window.GcEditorKeyboardEventBindings.create({
      flowRoot: flowRoot,
      windowObj: window,
      state: state,
      isStep2EditorActive: isStep2EditorActive,
      isTypingTarget: isTypingTarget,
      closeSaveTemplateModal: closeSaveTemplateModal,
      render: render,
      triggerSaveDraftTemplate: triggerSaveDraftTemplate,
      setSpacePanUiState: setSpacePanUiState,
      toggleDraftUiPanel: toggleDraftUiPanel,
      moveSelectedDraftLayers: moveSelectedDraftLayers,
      redoDraftHistory: redoDraftHistory,
      undoDraftHistory: undoDraftHistory,
      toggleSelectedTextStyle: toggleSelectedTextStyle,
      selectedDraftElement: selectedDraftElement,
      isArtisticDraftText: isArtisticDraftText,
      breakSelectedArtisticText: breakSelectedArtisticText,
      removeDraftElement: removeDraftElement,
      selectedDraftGuide: selectedDraftGuide,
      showToast: showToast,
      removeDraftGuideById: removeDraftGuideById,
      nudgeSelectedDraftElement: nudgeSelectedDraftElement,
      alignSelectedDraftElements: alignSelectedDraftElements,
      endDraftHistoryTransaction: endDraftHistoryTransaction,
      clearDraftInlineTextEditing: clearDraftInlineTextEditing,
      duplicateSelectedDraftElement: duplicateSelectedDraftElement,
      pasteClipboardElements: pasteClipboardElements,
      copySelectedDraftElements: copySelectedDraftElements,
      cutSelectedDraftElements: cutSelectedDraftElements,
      openSaveTemplateModal: openSaveTemplateModal,
      applyZoomFactor: applyZoomFactor,
      DRAFT_ZOOM_IN_FACTOR: DRAFT_ZOOM_IN_FACTOR,
      DRAFT_ZOOM_OUT_FACTOR: DRAFT_ZOOM_OUT_FACTOR,
      setDraftZoomWithAnchor: setDraftZoomWithAnchor,
      beginDraftHistoryTransaction: beginDraftHistoryTransaction,
      updateDraftTextLabelById: updateDraftTextLabelById,
    });
    keyboardEventBindings.bind();
  }

  flowRoot.addEventListener('change', function (event) {
    var target = event.target;
    if (!target) {
      return;
    }

    if (target.id === 'gcFrontPdfInput') {
      var frontFile = target.files && target.files[0] ? target.files[0] : null;
      handlePdfFile('front', frontFile);
      return;
    }

    if (target.id === 'gcBackPdfInput') {
      var backFile = target.files && target.files[0] ? target.files[0] : null;
      handlePdfFile('back', backFile);
      return;
    }

    if (target.id === 'gcTemplateSelectStep1') {
      var templateId = Number(target.value || 0);
      if (!templateId) {
        state.selectedTemplateId = null;
        state.selectedTemplate = null;
        resetStep2DraftState();
        render();
        return;
      }

      state.loading = true;
      render();
      selectTemplate(templateId)
        .then(function () {
          resetStep2DraftState();
          setAlert('', 'warning');
        })
        .catch(function (err) {
          var message = err && err.message ? err.message : 'Failed to load template details.';
          setAlert(message, 'error');
          showToast(message, 'error');
        })
        .finally(function () {
          state.loading = false;
          render();
        });
      return;
    }

    if (target.id === 'gcTemplateNameInput') {
      ensureStep2DraftInitialized();
      state.templateDraftName = String(target.value || '').slice(0, 120);
      markDraftDirty();
      render();
      return;
    }

    if (target.id === 'gcDraftUnitSelect') {
      var unit = String(target.value || 'mm').toLowerCase();
      if (unit !== 'mm' && unit !== 'cm' && unit !== 'in') {
        unit = 'mm';
      }
      state.draftUnit = unit;
      render();
      return;
    }

    if (target.id === 'gcDraftSnapMmInput') {
      state.draftSnapMm = normalizeDraftSnapMm(target.value);
      render();
      return;
    }

    if (target.id === 'gcDraftAlignReferenceSelect' || target.id === 'gcDraftAlignReferenceSelectPanel') {
      state.draftAlignReference = normalizeDraftAlignReference(target.value);
      if (state.draftAlignReference === 'keyObject') {
        var selectedIds = selectedDraftElementSet();
        if (selectedIds.size < 2 || !selectedIds.has(String(state.draftKeyObjectId || ''))) {
          var nextKey = '';
          selectedIds.forEach(function (id) {
            if (!nextKey) {
              nextKey = String(id || '');
            }
          });
          state.draftKeyObjectId = nextKey;
          if (!state.draftKeyObjectId) {
            state.draftAlignReference = 'selection';
          }
        }
      }
      render();
      return;
    }

    if (target.id === 'gcDraftDistributeModeSelect' || target.id === 'gcDraftDistributeModeSelectPanel') {
      state.draftDistributeMode = normalizeDraftDistributeMode(target.value);
      render();
      return;
    }

    if (target.id === 'gcDraftLabelInput') {
      updateSelectedDraftElement({ label: String(target.value || '') });
      render();
      return;
    }

    if (target.id === 'gcDraftFieldInput') {
      syncSelectedElementField(String(target.value || ''));
      render();
      return;
    }

    if (target.id === 'gcDraftImageSrcInput') {
      var selectedImage = selectedDraftElement();
      if (!selectedImage || String(selectedImage.type || '').toLowerCase() !== 'image') {
        return;
      }
      updateSelectedDraftElement({ src: String(target.value || '').trim() });
      render();
      return;
    }

    if (target.id === 'gcDraftShowLabelInput') {
      updateSelectedDraftElement({ showLabel: !!target.checked });
      render();
      return;
    }

    if (target.id === 'gcDraftTypeInput') {
      updateSelectedDraftElement({ type: String(target.value || 'text') });
      render();
      return;
    }

    if (target.id === 'gcDraftSideInput') {
      updateSelectedDraftElement({ side: String(target.value || 'front') });
      render();
      return;
    }

    if (target.id === 'gcDraftXInput') {
      updateSelectedDraftElement({ x: unitValueToCanvas(Number(target.value || 0), 'x') });
      render();
      return;
    }

    if (target.id === 'gcDraftYInput') {
      updateSelectedDraftElement({ y: unitValueToCanvas(Number(target.value || 0), 'y') });
      render();
      return;
    }

    if (target.id === 'gcDraftWInput') {
      var selectedForWidth = selectedDraftElement();
      var widthCanvas = unitValueToCanvas(Number(target.value || 0), 'x');
      if (selectedForWidth && isArtisticDraftText(selectedForWidth)) {
        var baseWidth = Math.max(1, Number(selectedForWidth.width || 1));
        updateSelectedDraftElement({ scaleX: clampDraftScale(widthCanvas / baseWidth) });
      } else {
        updateSelectedDraftElement({ width: widthCanvas });
      }
      render();
      return;
    }

    if (target.id === 'gcDraftHInput') {
      var selectedForHeight = selectedDraftElement();
      var heightCanvas = unitValueToCanvas(Number(target.value || 0), 'y');
      if (selectedForHeight && isArtisticDraftText(selectedForHeight)) {
        var baseHeight = Math.max(1, Number(selectedForHeight.height || 1));
        updateSelectedDraftElement({ scaleY: clampDraftScale(heightCanvas / baseHeight) });
      } else {
        updateSelectedDraftElement({ height: heightCanvas });
      }
      render();
      return;
    }

    if (target.id === 'gcDraftFontInput') {
      var fs = Number(target.value || 12);
      if (!Number.isFinite(fs)) {
        fs = 12;
      }
      updateSelectedDraftElement({ fontSize: Math.max(4, Math.min(240, fs)) });
      render();
      return;
    }

    if (target.id === 'gcDraftFontFamilyInput') {
      var family = findFontFamilyById(target.value) || FONT_CATALOG[0] || null;
      if (!family) {
        return;
      }
      var selected = selectedDraftElement();
      var face = resolveFontSelection(selected || {}).face || family.faces[0];
      if (!face || String(findFontFamilyByName(face.family || '').id || '') !== String(family.id || '')) {
        face = family.faces[0];
      }
      updateSelectedDraftElement({
        fontGroup: String(family.id || 'arial'),
        fontFace: String(face.id || 'regular'),
        fontFamily: String(face.family || 'Arial'),
        fontWeight: normalizeFontWeightValue(face.weight),
        fontStyle: normalizeFontStyleValue(face.style),
      });
      render();
      return;
    }

    if (target.id === 'gcDraftFontFaceInput') {
      var selectedItem = selectedDraftElement();
      var familyFromItem = findFontFamilyById(selectedItem && selectedItem.fontGroup)
        || findFontFamilyByName(selectedItem && selectedItem.fontFamily)
        || FONT_CATALOG[0]
        || null;
      if (!familyFromItem) {
        return;
      }
      var faceById = findFontFaceById(familyFromItem, target.value) || familyFromItem.faces[0];
      updateSelectedDraftElement({
        fontGroup: String(familyFromItem.id || 'arial'),
        fontFace: String(faceById.id || 'regular'),
        fontFamily: String(faceById.family || 'Arial'),
        fontWeight: normalizeFontWeightValue(faceById.weight),
        fontStyle: normalizeFontStyleValue(faceById.style),
      });
      render();
      return;
    }

    if (target.id === 'gcDraftWeightInput') {
      updateSelectedDraftElement({ fontWeight: normalizeFontWeightValue(target.value || '400') });
      render();
      return;
    }

    if (target.id === 'gcDraftLineHeightInput') {
      var lh = Number(target.value || 1.2);
      if (!Number.isFinite(lh)) {
        lh = 1.2;
      }
      updateSelectedDraftElement({ lineHeight: Math.max(0.6, Math.min(3, lh)) });
      render();
      return;
    }

    if (target.id === 'gcDraftAlignInput') {
      var align = String(target.value || 'center');
      if (align !== 'left' && align !== 'center' && align !== 'right') {
        align = 'center';
      }
      updateSelectedDraftElement({ textAlign: align });
      render();
      return;
    }

    if (target.id === 'gcDraftLetterSpacingInput') {
      var ls = Number(target.value || 0);
      if (!Number.isFinite(ls)) {
        ls = 0;
      }
      updateSelectedDraftElement({ letterSpacing: Math.max(-10, Math.min(20, ls)) });
      render();
      return;
    }

    if (target.id === 'gcDraftColorInput') {
      updateSelectedDraftElement({ color: String(target.value || '#1e293b') });
      render();
      return;
    }
  });

  if (headerStepperEl) {
    headerStepperEl.setAttribute('aria-hidden', 'false');
    headerStepperEl.addEventListener('click', function (event) {
      var node = event.target.closest('[data-step]');
      if (!node) {
        return;
      }
      goToStep(node.getAttribute('data-step'));
    });
  }

  if (headerSaveTemplateBtnEl) {
    headerSaveTemplateBtnEl.addEventListener('click', function () {
      if (state.step !== 2) {
        return;
      }
      openSaveTemplateModal();
      render();
    });
  }

  window.gcEditorRefresh = function () {
    return refreshModalData();
  };

  window.gcEditorBeforeClose = function () {
    setAlert('', 'warning');
    resetTransientState();
    resetStep2DraftState();
    state.loading = false;
    state.generating = false;
    state.step = 1;
    render();
    return Promise.resolve();
  };

  window.gcDownloadLastPdf = function () {
    if (!state.lastPdfBlob) {
      return false;
    }
    downloadBlob(state.lastPdfBlob, state.lastPdfName || 'cards.pdf');
    return true;
  };

  ensureStyles();
  ensureStep1CompactStyles();
  parseInitialConfig();
  render();
})();
