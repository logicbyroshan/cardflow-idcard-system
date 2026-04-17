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

  var state = {
    step: 1,
    loading: false,
    generating: false,
    orientation: 'landscape',
    isTwoSided: false,
    frontFile: null,
    backFile: null,
    frontPreviewUrl: '',
    backPreviewUrl: '',
    localPreviewUrls: {
      front: '',
      back: '',
    },
    templates: [],
    selectedTemplateId: null,
    selectedTemplate: null,
    templateDraft: null,
    templateDraftName: '',
    draftSelectedElementId: '',
    draftSelectedElementIds: new Set(),
    draftInlineEditingElementId: '',
    draftPendingTextEdit: null,
    draftSelectedGuideId: '',
    draftGuidesLocked: false,
    draftMergePreview: false,
    draftAutoMapScope: 'active',
    draftAutoMapReport: null,
    draftAutoMapReportOpen: false,
    draftActiveSide: 'front',
    draftTool: 'select',
    draftDragging: null,
    draftResizeDragging: null,
    draftGuideDragging: null,
    draftTextDrag: null,
    draftRectDrag: null,
    draftSelectDrag: null,
    draftZoom: 2,
    draftZoomOriginX: 50,
    draftZoomOriginY: 50,
    draftUnit: 'mm',
    draftSnapMm: 0.1,
    draftDirty: false,
    draftHistory: null,
    draftInlineEditHistoryActive: false,
    pendingZoomAnchor: null,
    draftLastPointerClientX: null,
    draftLastPointerClientY: null,
    spacePanMode: false,
    spacePanState: null,
    cards: [],
    selectedRequestIds: new Set(),
    lastPdfBlob: null,
    lastPdfName: 'cards.pdf',
  };
  var pdfJsLoadPromise = null;
  var draftElementSeed = 1;
  var draftGuideSeed = 1;
  var PT_TO_PX = 96 / 72;
  var DRAFT_HANDLE_SIZE_MIN_PX = 4;
  var DRAFT_HANDLE_SIZE_MAX_PX = 9;
  var DRAFT_HANDLE_GAP_MIN_PX = 3;
  var DRAFT_HANDLE_GAP_MAX_PX = 5;
  var draftTextMeasureNode = null;

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
      + '.gc-actions{display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap;}'
      + '.gc-actions-right{display:flex;gap:8px;flex-wrap:wrap;}'
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
      + '.gc-header-stepper{display:flex;align-items:center;gap:6px;min-width:0;}'
      + '.gc-header-modal-actions{display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;}'
      + '.gc-header-modal-actions .btn{height:28px;padding:0 10px;font-size:11px;line-height:1;}'
      + '.gc-mini-step{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 8px;border:1px solid #cbd5e1;border-radius:4px;background:#ffffff;color:#64748b;font-size:10px;font-weight:700;line-height:1;white-space:nowrap;}'
      + '.gc-mini-step.is-active{border-color:#3b82f6;background:#eff6ff;color:#1d4ed8;}'
      + '.gc-mini-step.is-done{border-color:#86efac;background:#ecfdf5;color:#15803d;}'
      + '.gc-step-panel.gc-step-panel-step1{width:100%;max-width:none;margin:0;border-radius:4px;padding:4px 0 0;display:flex;flex-direction:column;gap:6px;min-height:100%;background:#f8fafc;}'
      + '.gc-step1-topbar{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap;margin:0;padding:6px 10px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;background:linear-gradient(180deg,#ffffff,#f8fbff);}'
      + '.gc-inline-group{display:flex;flex-direction:column;gap:4px;min-width:0;}'
      + '.gc-inline-group.gc-inline-group-selection{align-items:flex-end;text-align:right;margin-left:auto;}'
      + '.gc-inline-controls{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;flex:1;}'
      + '.gc-inline-control-block{display:flex;flex-direction:column;gap:4px;min-width:0;}'
      + '.gc-inline-label{font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.03em;line-height:1.1;}'
      + '.gc-inline-value{font-size:13px;font-weight:700;color:#0f172a;line-height:1.2;}'
      + '.gc-inline-control-block.gc-inline-template-block{min-width:260px;}'
      + '.gc-inline-template-row{display:flex;align-items:center;gap:6px;min-width:0;}'
      + '.gc-inline-template-row .gc-select{height:32px;min-width:230px;max-width:300px;border-radius:4px;}'
      + '.gc-inline-template-row .btn{height:32px;padding:0 10px;font-size:11px;line-height:1;}'
      + '.gc-step-panel-step1 .gc-choice-row{gap:6px;}'
      + '.gc-step-panel-step1 .gc-choice-btn{height:32px;padding:0 12px;border-radius:4px;}'
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
      + '.gc-step2-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 8px;border:1px solid #dbe2ea;border-radius:4px;background:#ffffff;}'
      + '.gc-step2-toolbar-left,.gc-step2-toolbar-right{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}'
      + '.gc-step2-toolbar .btn{height:30px;padding:0 10px;font-size:11px;line-height:1;}'
      + '.gc-step2-main{display:grid;grid-template-columns:58px minmax(0,1fr) 320px;gap:8px;min-height:0;flex:1;}'
      + '.gc-step2-tools{border:1px solid #dbe2ea;border-radius:8px;background:linear-gradient(180deg,#ffffff,#f8fbff);padding:8px 6px;display:flex;flex-direction:column;gap:8px;align-items:stretch;box-shadow:0 1px 0 rgba(15,23,42,0.04);}'
      + '.gc-step2-tool-btn{height:54px;border:1px solid #cbd5e1;border-radius:7px;background:#f8fafc;color:#334155;font-size:10px;font-weight:700;line-height:1.15;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;cursor:pointer;transition:all .16s ease;}'
      + '.gc-step2-tool-btn:hover{border-color:#94a3b8;background:#f1f5f9;color:#0f172a;}'
      + '.gc-step2-tool-icon{width:28px;height:28px;border-radius:8px;background:#e2e8f0;color:#1f2937;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px rgba(148,163,184,.35);}'
      + '.gc-step2-tool-icon i{font-size:14px;line-height:1;}'
      + '.gc-step2-tool-label{font-size:10px;font-weight:700;letter-spacing:.01em;line-height:1.1;text-align:center;}'
      + '.gc-step2-tool-btn .gc-step2-tool-label{display:none;}'
      + '.gc-step2-tool-btn.is-active{background:#eff6ff;border-color:#3b82f6;color:#1d4ed8;box-shadow:0 0 0 1px rgba(59,130,246,.15),0 6px 14px rgba(37,99,235,.16);}'
      + '.gc-step2-tool-btn.is-active .gc-step2-tool-icon{background:#2563eb;color:#ffffff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);}'
      + '.gc-step2-canvas-shell{display:flex;flex-direction:column;min-height:0;border:1px solid #dbe2ea;border-radius:4px;background:#ffffff;overflow:hidden;}'
      + '.gc-step2-canvas-head{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid #e2e8f0;background:#f8fbff;}'
      + '.gc-step2-canvas-head .gc-inline-label{font-size:10px;}'
      + '.gc-step2-center-controls{display:flex;align-items:center;gap:6px;justify-self:center;flex-wrap:wrap;}'
      + '.gc-step2-zoom-range{width:120px;accent-color:#2563eb;}'
      + '.gc-step2-zoom-pill{font-size:10px;font-weight:800;color:#1e3a8a;background:#e0e7ff;border:1px solid #bfdbfe;border-radius:999px;padding:2px 7px;line-height:1.2;min-width:52px;text-align:center;}'
      + '.gc-step2-unit-select{height:28px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;padding:0 8px;font-size:11px;color:#0f172a;}'
      + '.gc-step2-size-controls{display:flex;align-items:center;gap:2px;}'
      + '.gc-step2-size-label{font-size:9px;font-weight:700;color:#334155;}'
      + '.gc-step2-size-input{height:24px;width:48px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;padding:0 4px;font-size:10px;color:#0f172a;text-align:center;}'
      + '.gc-step2-size-input[readonly]{background:#f8fafc;color:#334155;border-color:#d1d5db;pointer-events:none;}'
      + '.gc-step2-snap-control{display:flex;align-items:center;gap:4px;}'
      + '.gc-step2-snap-label{font-size:10px;font-weight:700;color:#334155;white-space:nowrap;}'
      + '.gc-step2-snap-input{height:28px;width:70px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;padding:0 6px;font-size:11px;color:#0f172a;}'
      + '.gc-step2-merge-select{height:28px;min-width:170px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;padding:0 8px;font-size:11px;color:#0f172a;}'
      + '.gc-step2-center-controls .btn.is-active{border-color:#2563eb;background:#dbeafe;color:#1d4ed8;}'
      + '.gc-step2-side-switch{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;}'
      + '.gc-step2-side-switch .gc-choice-btn{height:28px;padding:0 10px;border-radius:4px;font-size:11px;}'
      + '.gc-step2-target-side{display:inline-flex;align-items:center;height:26px;padding:0 8px;border:1px solid #cbd5e1;border-radius:4px;background:#ffffff;color:#334155;font-size:10px;font-weight:700;white-space:nowrap;}'
      + '.gc-step2-canvas-stage{position:relative;flex:1;min-height:360px;background:#d6dde7;overflow:hidden;}'
      + '.gc-step2-stage-content{position:absolute;top:10px;left:10px;right:0;bottom:0;display:flex;align-items:center;justify-content:center;overflow:auto;padding:18px;}'
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
      + '.gc-step2-canvas.is-two-sided{background:linear-gradient(90deg,#ffffff 0,#ffffff calc(50% - .5px),#d1d9e4 calc(50% - .5px),#d1d9e4 calc(50% + .5px),#ffffff calc(50% + .5px),#ffffff 100%);}'
      + '.gc-step2-dual-divider{position:absolute;top:0;bottom:0;left:50%;width:0;border-left:2px dashed rgba(71,85,105,.55);pointer-events:none;z-index:1;}'
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
      + '.gc-draft-el.gc-draft-el-artistic{white-space:nowrap;align-items:center;overflow:visible;}'
      + '.gc-draft-el.gc-draft-el-paragraph{white-space:normal;align-items:flex-start;padding-top:2px;overflow:hidden;}'
      + '.gc-draft-el.gc-draft-el-photo{border-style:solid;border-color:#0ea5e9;background:rgba(14,165,233,0.14);color:#0369a1;}'
      + '.gc-draft-el.gc-draft-el-rect{border-style:solid;background:rgba(37,99,235,0.10);color:transparent;padding:0;}'
      + '.gc-draft-el.is-selected{border:1px solid #111827;background:transparent;box-shadow:none;overflow:visible;}'
      + '.gc-draft-el.gc-draft-el-text.is-selected{background:transparent;border-color:transparent;}'
      + '.gc-draft-el.gc-draft-el-text.gc-draft-el-artistic.is-selected::after{display:none;}'
      + '.gc-draft-el.is-merge-preview{border-style:dashed;}'
      + '.gc-draft-el.gc-draft-el-text.is-merge-preview{background:rgba(219,234,254,.32);border-color:rgba(37,99,235,.42);color:#1e3a8a;}'
      + '.gc-draft-el.gc-draft-el-photo.is-merge-preview{background:repeating-linear-gradient(45deg,rgba(14,165,233,.12) 0,rgba(14,165,233,.12) 6px,rgba(2,132,199,.18) 6px,rgba(2,132,199,.18) 12px);border-color:#0284c7;color:#075985;}'
      + '.gc-draft-el.gc-draft-el-text.is-editing::after{display:none;}'
      + '.gc-draft-el.gc-draft-el-text.is-editing{border-color:transparent;background:transparent;box-shadow:none;}'
      + '.gc-draft-selection-handle{position:absolute;width:var(--gc-handle-size,5px);height:var(--gc-handle-size,5px);border:1px solid #111827;background:#ffffff;border-radius:1px;box-sizing:border-box;pointer-events:auto;z-index:3;}'
      + '.gc-draft-selection-handle.is-nw{left:calc(-1 * var(--gc-handle-offset-x,6px));top:calc(-1 * var(--gc-handle-offset-y,6px));}'
      + '.gc-draft-selection-handle.is-n{left:50%;top:calc(-1 * var(--gc-handle-offset-y,6px));transform:translateX(-50%);}'
      + '.gc-draft-selection-handle.is-ne{right:calc(-1 * var(--gc-handle-offset-x,6px));top:calc(-1 * var(--gc-handle-offset-y,6px));}'
      + '.gc-draft-selection-handle.is-e{right:calc(-1 * var(--gc-handle-offset-x,6px));top:50%;transform:translateY(-50%);}'
      + '.gc-draft-selection-handle.is-sw{left:calc(-1 * var(--gc-handle-offset-x,6px));bottom:calc(-1 * var(--gc-handle-offset-y,6px));}'
      + '.gc-draft-selection-handle.is-s{left:50%;bottom:calc(-1 * var(--gc-handle-offset-y,6px));transform:translateX(-50%);}'
      + '.gc-draft-selection-handle.is-se{right:calc(-1 * var(--gc-handle-offset-x,6px));bottom:calc(-1 * var(--gc-handle-offset-y,6px));}'
      + '.gc-draft-selection-handle.is-w{left:calc(-1 * var(--gc-handle-offset-x,6px));top:50%;transform:translateY(-50%);}'
      + '.gc-draft-selection-handle.is-n,.gc-draft-selection-handle.is-s{cursor:ns-resize;}'
      + '.gc-draft-selection-handle.is-e,.gc-draft-selection-handle.is-w{cursor:ew-resize;}'
      + '.gc-draft-selection-handle.is-nw,.gc-draft-selection-handle.is-se{cursor:nwse-resize;}'
      + '.gc-draft-selection-handle.is-ne,.gc-draft-selection-handle.is-sw{cursor:nesw-resize;}'
      + '.gc-draft-inline-editor{display:block;width:100%;height:100%;outline:none;border:0;background:transparent;overflow:visible;cursor:text;user-select:text;white-space:inherit;line-height:inherit;letter-spacing:inherit;color:inherit;text-align:inherit;}'
      + '.gc-draft-inline-editor:focus{outline:none;}'
      + '.gc-draft-guide{position:absolute;border:0;background:transparent;z-index:2;}'
      + '.gc-draft-guide.is-vertical{width:14px;transform:translateX(-7px);cursor:ew-resize;}'
      + '.gc-draft-guide.is-horizontal{height:14px;transform:translateY(-7px);cursor:ns-resize;}'
      + '.gc-draft-guide::before{content:"";position:absolute;opacity:.8;}'
      + '.gc-draft-guide.is-vertical::before{left:6.5px;top:0;width:1px;height:100%;background-image:repeating-linear-gradient(to bottom,rgba(71,85,105,.85) 0,rgba(71,85,105,.85) 5px,transparent 5px,transparent 9px);}'
      + '.gc-draft-guide.is-horizontal::before{left:0;top:6.5px;width:100%;height:1px;background-image:repeating-linear-gradient(to right,rgba(71,85,105,.85) 0,rgba(71,85,105,.85) 5px,transparent 5px,transparent 9px);}'
      + '.gc-draft-guide.is-selected::before{opacity:1;}'
      + '.gc-draft-guide.is-selected.is-vertical::before{background-image:repeating-linear-gradient(to bottom,rgba(2,132,199,1) 0,rgba(2,132,199,1) 5px,transparent 5px,transparent 9px);}'
      + '.gc-draft-guide.is-selected.is-horizontal::before{background-image:repeating-linear-gradient(to right,rgba(2,132,199,1) 0,rgba(2,132,199,1) 5px,transparent 5px,transparent 9px);}'
      + '.gc-step2-canvas-shell.is-guides-locked .gc-step2-ruler-top,.gc-step2-canvas-shell.is-guides-locked .gc-step2-ruler-left{cursor:not-allowed;opacity:.65;}'
      + '.gc-step2-canvas-shell.is-guides-locked .gc-draft-guide{pointer-events:none;}'
      + '.gc-draft-insert-guide{position:absolute;border:1px dashed #0f766e;background:rgba(45,212,191,0.18);pointer-events:none;z-index:2;}'
      + '.gc-draft-insert-guide.is-rect{border-color:#2563eb;background:rgba(37,99,235,0.13);}'
      + '.gc-draft-insert-guide.is-select{border-color:#0f172a;background:rgba(15,23,42,0.08);}'
      + '.gc-step2-props{border:1px solid #dbe2ea;border-radius:4px;background:#ffffff;padding:8px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;}'
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
      + '.gc-step-panel-step2 .gc-actions{margin-top:auto;padding:8px 10px 10px;position:sticky;bottom:0;background:#f8fafc;z-index:1;}'
      + '.gc-step-panel.gc-step-panel-step3{width:100%;max-width:none;margin:0;border-radius:4px;padding:4px 0 0;display:flex;flex-direction:column;gap:6px;min-height:100%;background:#f8fafc;}'
      + '.gc-step-panel-step3 .gc-step-title,.gc-step-panel-step3 .gc-step-subtitle{padding:0 10px;}'
      + '.gc-step3-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;padding:6px 10px;border-top:1px solid #dbe2ea;border-bottom:1px solid #dbe2ea;background:#fbfdff;}'
      + '.gc-step3-summary .gc-summary-item{border:1px solid #dbe2ea;border-radius:4px;background:#ffffff;padding:7px 9px;}'
      + '.gc-step3-summary .gc-summary-label{font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}'
      + '.gc-step3-summary .gc-summary-value{font-size:13px;color:#0f172a;font-weight:700;margin-top:3px;}'
      + '.gc-step-panel-step3 .gc-preview-grid{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;justify-content:flex-start;padding:0 10px;}'
      + '.gc-step-panel-step3 .gc-preview-card{width:auto;max-width:none;padding:5px;border-radius:4px;background:#ffffff;border:1px solid #dbe2ea;}'
      + '.gc-step-panel-step3 .gc-preview-head{font-size:11px;}'
      + '.gc-step-panel-step3 .gc-preview-box{border-radius:2px;}'
      + '.gc-step-panel-step3 .gc-preview-box.gc-mm-landscape{width:79mm;max-width:100%;height:auto;aspect-ratio:1.526/1;}'
      + '.gc-step-panel-step3 .gc-preview-box.gc-mm-portrait{width:52mm;max-width:100%;height:auto;aspect-ratio:1/1.526;}'
      + '.gc-step-panel-step3 .gc-actions{margin-top:auto;padding:8px 10px 10px;position:sticky;bottom:0;background:#f8fafc;z-index:1;}'
      + '@media (max-width:1180px){.gc-flow-header{grid-template-columns:minmax(0,1fr) auto;}.gc-header-stepper{grid-column:1 / -1;order:3;overflow-x:auto;padding-bottom:2px;}.gc-inline-group.gc-inline-group-selection{align-items:flex-start;text-align:left;margin-left:0;}}'
      + '@media (max-width:860px){.gc-step1-upload-row{grid-template-columns:1fr;}.gc-upload-input-wrap{flex-wrap:wrap;}.gc-inline-controls{gap:8px;}.gc-step1-topbar{align-items:flex-start;}.gc-inline-control-block.gc-inline-template-block{min-width:100%;}.gc-inline-template-row .gc-select{min-width:0;max-width:none;flex:1;}.gc-step2-main{grid-template-columns:1fr;}.gc-step2-tools{flex-direction:row;padding:6px;justify-content:space-between;}.gc-step2-tool-btn{flex:1;height:44px;}.gc-step2-canvas-head{grid-template-columns:1fr;}.gc-step2-center-controls{justify-self:stretch;justify-content:flex-start;}.gc-step2-zoom-range{width:100px;}.gc-step2-size-input{width:58px;}.gc-step2-canvas-stage{min-height:240px;padding:10px;}.gc-step2-props{order:2;}.gc-step2-report-grid{grid-template-columns:1fr;}.gc-step2-report-modal{max-height:88vh;}.gc-step-panel-step3 .gc-preview-box.gc-mm-landscape{width:min(100%,340px);}.gc-step-panel-step3 .gc-preview-box.gc-mm-portrait{width:min(100%,220px);}.gc-step3-summary{grid-template-columns:1fr 1fr;}.gc-actions{justify-content:center;}}';

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
    if (!stepCounterEl) {
      syncHeaderActionButtons();
      return;
    }
    stepCounterEl.textContent = 'Step ' + String(state.step) + ' of 3';

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
      headerSaveTemplateBtnEl.textContent = state.loading ? 'Saving...' : 'Save Template';
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

  function resetStep2DraftState() {
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
    state.draftActiveSide = 'front';
    state.draftTool = 'select';
    state.draftDragging = null;
    state.draftResizeDragging = null;
    state.draftGuideDragging = null;
    state.draftTextDrag = null;
    state.draftRectDrag = null;
    state.draftSelectDrag = null;
    state.draftZoom = 2;
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

  function draftHistorySnapshot() {
    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();
    return {
      templateDraft: deepCloneJson(state.templateDraft, defaultTemplateJson()),
      templateDraftName: String(state.templateDraftName || ''),
      draftSelectedElementId: String(state.draftSelectedElementId || ''),
      draftSelectedElementIds: Array.from(selectedDraftElementSet()).map(function (id) {
        return String(id || '');
      }).sort(),
      draftSelectedGuideId: String(state.draftSelectedGuideId || ''),
      draftMergePreview: !!state.draftMergePreview,
      draftActiveSide: state.draftActiveSide === 'back' ? 'back' : 'front',
      draftTool: String(state.draftTool || 'select'),
      orientation: normalizeOrientation(state.orientation || 'landscape'),
      isTwoSided: !!state.isTwoSided,
      draftUnit: currentDraftUnit(),
      draftSnapMm: normalizeDraftSnapMm(state.draftSnapMm),
      draftZoom: Number(state.draftZoom || 1),
      draftZoomOriginX: Number(state.draftZoomOriginX || 50),
      draftZoomOriginY: Number(state.draftZoomOriginY || 50),
    };
  }

  function draftHistorySignature(snapshot) {
    return JSON.stringify(snapshot || {});
  }

  function captureDraftHistoryPoint() {
    if (state.step !== 2) {
      return false;
    }

    var hist = ensureDraftHistoryState();
    if (hist.applying) {
      return false;
    }

    var snap = draftHistorySnapshot();
    var sig = draftHistorySignature(snap);
    if (sig === hist.lastSig) {
      return false;
    }

    hist.undo.push(snap);
    while (hist.undo.length > Math.max(1, Number(hist.maxDepth || 15))) {
      hist.undo.shift();
    }
    hist.redo = [];
    hist.lastSig = sig;
    if (hist.inTxn) {
      hist.txnCaptured = true;
    }
    return true;
  }

  function beginDraftHistoryTransaction() {
    if (state.step !== 2) {
      return;
    }
    var hist = ensureDraftHistoryState();
    if (!hist.inTxn) {
      hist.inTxn = true;
      hist.txnCaptured = false;
    }
  }

  function endDraftHistoryTransaction() {
    var hist = ensureDraftHistoryState();
    if (!hist.inTxn) {
      return;
    }
    hist.inTxn = false;
    hist.txnCaptured = false;
    if (state.step === 2) {
      hist.lastSig = draftHistorySignature(draftHistorySnapshot());
    }
  }

  function prepareDraftHistoryMutation() {
    if (state.step !== 2) {
      return;
    }
    var hist = ensureDraftHistoryState();
    if (hist.applying) {
      return;
    }
    if (hist.inTxn) {
      if (!hist.txnCaptured) {
        captureDraftHistoryPoint();
      }
      return;
    }
    captureDraftHistoryPoint();
  }

  function applyDraftHistorySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return false;
    }

    state.templateDraft = deepCloneJson(snapshot.templateDraft, defaultTemplateJson());
    state.templateDraftName = String(snapshot.templateDraftName || '');
    state.draftSelectedElementId = String(snapshot.draftSelectedElementId || '');
    state.draftSelectedElementIds = new Set(Array.isArray(snapshot.draftSelectedElementIds)
      ? snapshot.draftSelectedElementIds.map(function (id) { return String(id || ''); })
      : []);
    state.draftSelectedGuideId = String(snapshot.draftSelectedGuideId || '');
    state.draftMergePreview = !!snapshot.draftMergePreview;
    state.draftActiveSide = snapshot.draftActiveSide === 'back' ? 'back' : 'front';

    var tool = String(snapshot.draftTool || 'select');
    if (tool !== 'select' && tool !== 'text' && tool !== 'photo' && tool !== 'rectangle') {
      tool = 'select';
    }
    state.draftTool = tool;

    state.orientation = normalizeOrientation(snapshot.orientation || state.orientation || 'landscape');
    state.isTwoSided = !!snapshot.isTwoSided;

    var unit = String(snapshot.draftUnit || 'mm').toLowerCase();
    if (unit !== 'mm' && unit !== 'cm' && unit !== 'in') {
      unit = 'mm';
    }
    state.draftUnit = unit;
    state.draftSnapMm = normalizeDraftSnapMm(snapshot.draftSnapMm);

    setDraftZoom(Number(snapshot.draftZoom || 1));
    var originX = Number(snapshot.draftZoomOriginX);
    var originY = Number(snapshot.draftZoomOriginY);
    state.draftZoomOriginX = Number.isFinite(originX) ? Math.max(0, Math.min(100, originX)) : 50;
    state.draftZoomOriginY = Number.isFinite(originY) ? Math.max(0, Math.min(100, originY)) : 50;

    state.draftDragging = null;
    state.draftResizeDragging = null;
    state.draftGuideDragging = null;
    state.draftTextDrag = null;
    state.draftRectDrag = null;
    state.draftSelectDrag = null;
    clearDraftInlineTextEditing();
    state.draftInlineEditHistoryActive = false;

    normalizeDraftElementSelection();
    state.draftDirty = true;
    syncDraftToSelectedTemplate();
    return true;
  }

  function undoDraftHistory() {
    if (state.step !== 2) {
      return false;
    }
    var hist = ensureDraftHistoryState();
    if (!hist.undo.length) {
      return false;
    }

    var current = draftHistorySnapshot();
    var previous = hist.undo.pop();
    hist.redo.push(current);
    while (hist.redo.length > Math.max(1, Number(hist.maxDepth || 15))) {
      hist.redo.shift();
    }

    hist.applying = true;
    try {
      applyDraftHistorySnapshot(previous);
    } finally {
      hist.applying = false;
    }

    hist.lastSig = draftHistorySignature(draftHistorySnapshot());
    return true;
  }

  function redoDraftHistory() {
    if (state.step !== 2) {
      return false;
    }
    var hist = ensureDraftHistoryState();
    if (!hist.redo.length) {
      return false;
    }

    var current = draftHistorySnapshot();
    var next = hist.redo.pop();
    hist.undo.push(current);
    while (hist.undo.length > Math.max(1, Number(hist.maxDepth || 15))) {
      hist.undo.shift();
    }

    hist.applying = true;
    try {
      applyDraftHistorySnapshot(next);
    } finally {
      hist.applying = false;
    }

    hist.lastSig = draftHistorySignature(draftHistorySnapshot());
    return true;
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
        : 'top:' + String(canvasTop + posPx) + 'px;left:' + String((outside ? 0 : canvasLeft) + sideStart) + 'px;width:' + String(outside ? Math.min(layerWidth, sideWidth) : sideWidth) + 'px;';

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
    state.draftZoom = Math.max(0.25, Math.min(4, next));
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

    var size = Number(fontSize || 12);
    if (!Number.isFinite(size) || size <= 0) {
      size = 12;
    }
    var sizePx = ptToPx(size);
    if (!Number.isFinite(sizePx) || sizePx <= 0) {
      sizePx = ptToPx(12);
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

    var mode = String(draft.textMode || 'artistic').toLowerCase();
    if (mode !== 'artistic') {
      return;
    }

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
    var fontSize = Number(draft.fontSize || 12);
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
      fontSize = 12;
    }
    var fontSizePx = ptToPx(fontSize);
    if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) {
      fontSizePx = ptToPx(12);
    }
    var letterSpacing = Number(draft.letterSpacing || 0);
    if (!Number.isFinite(letterSpacing)) {
      letterSpacing = 0;
    }

    var label = String(draft.label == null ? '' : draft.label);
    var normalized = label.replace(/\r\n?/g, '\n').split('\n')[0] || '';
    var width = estimateDraftTextWidthPx(
      normalized,
      fontSize,
      draft.fontFamily,
      draft.fontWeight,
      draft.fontStyle,
      letterSpacing
    );
    if (!Number.isFinite(width) || width < 0) {
      width = 0;
    }

    var height = 0;
    var ctx = draftTextMeasureContext();
    if (ctx) {
      ctx.font = String(draft.fontStyle || 'normal')
        + ' ' + String(draft.fontWeight || '400')
        + ' ' + fontSizePx + 'px '
        + String(draft.fontFamily || 'Arial');
      var glyphMetrics = ctx.measureText(normalized || ' ');
      var ascent = Number(glyphMetrics && glyphMetrics.actualBoundingBoxAscent || 0);
      var descent = Number(glyphMetrics && glyphMetrics.actualBoundingBoxDescent || 0);
      var glyphHeight = ascent + descent;
      if (Number.isFinite(glyphHeight) && glyphHeight > 0) {
        height = glyphHeight;
      }
    }

    var measureNode = draftTextMeasureElement();
    if ((!Number.isFinite(height) || height <= 0) && measureNode) {
      measureNode.style.fontFamily = String(draft.fontFamily || 'Arial');
      measureNode.style.fontWeight = String(draft.fontWeight || '400');
      measureNode.style.fontStyle = String(draft.fontStyle || 'normal');
      measureNode.style.fontSize = String(fontSize) + 'pt';
      measureNode.style.letterSpacing = String(letterSpacing) + 'px';
      measureNode.style.lineHeight = '1';
      measureNode.style.whiteSpace = 'nowrap';
      measureNode.textContent = normalized || ' ';
      var heightDom = Number(measureNode.getBoundingClientRect && measureNode.getBoundingClientRect().height || 0);
      if (Number.isFinite(heightDom) && heightDom > 0) {
        height = heightDom;
      }
    }
    if (!Number.isFinite(height) || height <= 0) {
      height = Math.ceil(fontSizePx + 1);
    }

    // Text metrics are in rendered CSS pixels; convert back to internal canvas units.
    width = width / displayScaleX;
    height = height / displayScaleY;

    var limits = draftArtisticLimits(metrics);
    var resolvedWidth = Number(width.toFixed(2));
    var resolvedHeight = Number(height.toFixed(2));
    draft.width = Math.max(normalized.length ? 8 : 6, Math.min(limits.maxWidth, resolvedWidth));
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
    var rawTextMode = String(item.textMode || 'artistic').toLowerCase();
    if (rawTextMode !== 'artistic' && rawTextMode !== 'paragraph') {
      rawTextMode = 'artistic';
    }
    var isArtisticText = type === 'text' && rawTextMode === 'artistic';
    var width = Number(item.width || 90);
    var height = Number(item.height || 24);
    var x = Number(item.x || 16);
    var y = Number(item.y || (16 + (idx * 12)));

    if (!Number.isFinite(width) || width <= 0) width = 90;
    if (!Number.isFinite(height) || height <= 0) height = 24;
    if (!Number.isFinite(x)) x = 16;
    if (!Number.isFinite(y)) y = 16;

    var minWidth = type === 'text' ? 6 : (type === 'rectangle' ? 20 : 12);
    var minHeight = type === 'text' ? 10 : (type === 'rectangle' ? 20 : 12);
    if (isArtisticText) {
      var artisticLimits = draftArtisticLimits(metrics);
      width = Math.max(minWidth, Math.min(artisticLimits.maxWidth, width));
      height = Math.max(minHeight, Math.min(artisticLimits.maxHeight, height));

      var minVisiblePx = DRAFT_ARTISTIC_MIN_VISIBLE_PX;
      var minX = minVisiblePx - width;
      var maxX = metrics.width - minVisiblePx;
      var minY = minVisiblePx - height;
      var maxY = metrics.height - minVisiblePx;
      x = Math.max(minX, Math.min(maxX, x));
      y = Math.max(minY, Math.min(maxY, y));
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

    var fontSize = Number(item.fontSize || 12);
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
      fontSize = 12;
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

    var textAlign = String(item.textAlign || item.align || 'center').toLowerCase();
    if (textAlign !== 'left' && textAlign !== 'center' && textAlign !== 'right') {
      textAlign = 'center';
    }

    var color = String(item.color || '#1e293b').slice(0, 20);
    var textMode = rawTextMode;
    if (textMode !== 'artistic' && textMode !== 'paragraph') {
      textMode = 'artistic';
    }
    if (type === 'text' && textMode === 'artistic') {
      lineHeight = 1;
    }
    var hasStoredLabel = Object.prototype.hasOwnProperty.call(item, 'label');
    var fallbackLabel = type === 'image'
      ? 'Image'
      : (type === 'rectangle' ? 'Rectangle' : '');

    var normalizedItem = {
      __id: item.__id || nextDraftElementId(),
      type: type,
      field: String(item.field || ''),
      label: hasStoredLabel ? String(item.label) : fallbackLabel,
      showLabel: item.showLabel !== false,
      side: side,
      x: x,
      y: y,
      width: width,
      height: height,
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
        font_size: 12,
        font_family: 'Arial',
      };
    }
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
    var validIds = new Set(elements.map(function (item) {
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
  }

  function selectedDraftElements() {
    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();
    var elements = state.templateDraft && Array.isArray(state.templateDraft.elements)
      ? state.templateDraft.elements
      : [];
    var selected = selectedDraftElementSet();
    return elements.filter(function (item) {
      return item && selected.has(item.__id);
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
    if (!wanted || !isDraftTextElement(item)) {
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
    }

    state.draftInlineEditingElementId = wanted;
    state.draftTool = 'select';
    state.draftPendingTextEdit = null;
    return true;
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
      var isArtisticText = String(item.textMode || '').toLowerCase() === 'artistic';
      if (isArtisticText) {
        next = next.replace(/[ \t\u00A0]+$/g, '');
      }
      var draft = Object.assign({}, item, { label: next });
      if (isArtisticText && item.artisticAutoFit !== false) {
        fitDraftArtisticTextBounds(draft);
      }
      var normalized = normalizeDraftElement(draft, idx);
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

    var deltaX = (Number(event.clientX || 0) - Number(resizeDrag.startMouseX || 0)) * scaleX;
    var deltaY = (Number(event.clientY || 0) - Number(resizeDrag.startMouseY || 0)) * scaleY;

    var left = Number(resizeDrag.startX || 0);
    var top = Number(resizeDrag.startY || 0);
    var right = left + startWidth;
    var bottom = top + startHeight;

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

    var resizeType = String(resizeDrag.type || '').toLowerCase();
    var isArtisticText = resizeType === 'text'
      && String(resizeDrag.textMode || '').toLowerCase() === 'artistic';
    var minWidth = isArtisticText ? 6 : (resizeType === 'text' ? 8 : (resizeType === 'rectangle' ? 20 : 12));
    var minHeight = isArtisticText ? 10 : (resizeType === 'rectangle' ? 20 : 12);

    if ((right - left) < minWidth) {
      if (hasWest && !hasEast) {
        left = right - minWidth;
      } else {
        right = left + minWidth;
      }
    }

    if ((bottom - top) < minHeight) {
      if (hasNorth && !hasSouth) {
        top = bottom - minHeight;
      } else {
        bottom = top + minHeight;
      }
    }

    if (isArtisticText) {
      if (!isCorner) {
        return mutateDraftElementById(resizeDrag.id, function (draft) {
          draft.artisticAutoFit = false;
          draft.x = left;
          draft.y = top;
          draft.width = Math.max(minWidth, right - left);
          draft.height = Math.max(minHeight, bottom - top);
        });
      }

      return mutateDraftElementById(resizeDrag.id, function (draft) {
        var startFontSize = Number(resizeDrag.startFontSize || draft.fontSize || 12);
        if (!Number.isFinite(startFontSize) || startFontSize <= 0) {
          startFontSize = 12;
        }
        var scaleFromWidth = (right - left) / Math.max(1, startWidth);
        var scaleFromHeight = (bottom - top) / Math.max(1, startHeight);
        var scale = 1;
        if (isCorner) {
          scale = Math.max(scaleFromWidth, scaleFromHeight);
        } else if (hasHorizontal && !hasVertical) {
          scale = scaleFromWidth;
        } else if (hasVertical && !hasHorizontal) {
          scale = scaleFromHeight;
        }
        if (!Number.isFinite(scale) || scale <= 0) {
          scale = 1;
        }

        var nextFontSize = Math.max(4, Math.min(240, startFontSize * scale));
        var nextLetterSpacing = Number(resizeDrag.startLetterSpacing || draft.letterSpacing || 0);
        if (!Number.isFinite(nextLetterSpacing)) {
          nextLetterSpacing = 0;
        }
        nextLetterSpacing = Math.max(-3, Math.min(3, nextLetterSpacing));
        draft.artisticAutoFit = true;
        draft.fontSize = nextFontSize;
        draft.letterSpacing = nextLetterSpacing;
        fitDraftArtisticTextBounds(draft);

        var fittedWidth = Number(draft.width || startWidth);
        var fittedHeight = Number(draft.height || startHeight);
        var anchorRight = Number(resizeDrag.startX || 0) + startWidth;
        var anchorBottom = Number(resizeDrag.startY || 0) + startHeight;

        if (hasWest && !hasEast) {
          draft.x = anchorRight - fittedWidth;
        } else {
          draft.x = Number(resizeDrag.startX || 0);
        }

        if (hasNorth && !hasSouth) {
          draft.y = anchorBottom - fittedHeight;
        } else {
          draft.y = Number(resizeDrag.startY || 0);
        }
      });
    }

    return mutateDraftElementById(resizeDrag.id, function (draft) {
      draft.x = left;
      draft.y = top;
      draft.width = Math.max(minWidth, right - left);
      draft.height = Math.max(minHeight, bottom - top);
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

  function alignSelectedDraftElements(mode) {
    var selected = selectedDraftElements();
    if (!selected.length) {
      return false;
    }

    var multiOnly = mode !== 'canvas-center';
    if (multiOnly && selected.length < 2) {
      return false;
    }

    var metrics = draftCanvasMetrics();
    var minX = Infinity;
    var minY = Infinity;
    var maxRight = -Infinity;
    var maxBottom = -Infinity;

    selected.forEach(function (item) {
      var x = Number(item.x || 0);
      var y = Number(item.y || 0);
      var w = Number(item.width || 0);
      var h = Number(item.height || 0);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxRight = Math.max(maxRight, x + w);
      maxBottom = Math.max(maxBottom, y + h);
    });

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxRight) || !Number.isFinite(maxBottom)) {
      return false;
    }

    if (mode === 'canvas-center') {
      var targetCanvasCx = Number(metrics.width || 0) / 2;
      var targetCanvasCy = Number(metrics.height || 0) / 2;
      var currentCx = (minX + maxRight) / 2;
      var currentCy = (minY + maxBottom) / 2;
      var dx = targetCanvasCx - currentCx;
      var dy = targetCanvasCy - currentCy;
      return applyToSelectedDraftElements(function (draft) {
        draft.x = Number(draft.x || 0) + dx;
        draft.y = Number(draft.y || 0) + dy;
      });
    }

    if (mode === 'align-left') {
      return applyToSelectedDraftElements(function (draft) {
        draft.x = minX;
      });
    }

    if (mode === 'align-right') {
      return applyToSelectedDraftElements(function (draft) {
        draft.x = maxRight - Number(draft.width || 0);
      });
    }

    if (mode === 'align-top') {
      return applyToSelectedDraftElements(function (draft) {
        draft.y = minY;
      });
    }

    if (mode === 'align-bottom') {
      return applyToSelectedDraftElements(function (draft) {
        draft.y = maxBottom - Number(draft.height || 0);
      });
    }

    if (mode === 'align-h-center') {
      var targetCenterX = (minX + maxRight) / 2;
      return applyToSelectedDraftElements(function (draft) {
        draft.x = targetCenterX - (Number(draft.width || 0) / 2);
      });
    }

    if (mode === 'align-v-center') {
      var targetCenterY = (minY + maxBottom) / 2;
      return applyToSelectedDraftElements(function (draft) {
        draft.y = targetCenterY - (Number(draft.height || 0) / 2);
      });
    }

    if (mode === 'distribute-h') {
      if (selected.length < 3) {
        return false;
      }
      var sortedH = selected.slice().sort(function (a, b) {
        return Number(a.x || 0) - Number(b.x || 0);
      });
      var firstH = sortedH[0];
      var lastH = sortedH[sortedH.length - 1];
      var minLeft = Number(firstH.x || 0);
      var maxRightH = Number(lastH.x || 0) + Number(lastH.width || 0);
      var totalWidth = sortedH.reduce(function (sum, item) {
        return sum + Math.max(0, Number(item.width || 0));
      }, 0);
      var gapH = (maxRightH - minLeft - totalWidth) / Math.max(1, sortedH.length - 1);
      if (!Number.isFinite(gapH)) {
        return false;
      }
      var nextXById = {};
      var cursorX = minLeft;
      sortedH.forEach(function (item) {
        nextXById[String(item.__id || '')] = cursorX;
        cursorX += Math.max(0, Number(item.width || 0)) + gapH;
      });
      return applyToSelectedDraftElements(function (draft) {
        var key = String(draft.__id || '');
        if (Object.prototype.hasOwnProperty.call(nextXById, key)) {
          draft.x = nextXById[key];
        }
      });
    }

    if (mode === 'distribute-v') {
      if (selected.length < 3) {
        return false;
      }
      var sortedV = selected.slice().sort(function (a, b) {
        return Number(a.y || 0) - Number(b.y || 0);
      });
      var firstV = sortedV[0];
      var lastV = sortedV[sortedV.length - 1];
      var minTop = Number(firstV.y || 0);
      var maxBottomV = Number(lastV.y || 0) + Number(lastV.height || 0);
      var totalHeight = sortedV.reduce(function (sum, item) {
        return sum + Math.max(0, Number(item.height || 0));
      }, 0);
      var gapV = (maxBottomV - minTop - totalHeight) / Math.max(1, sortedV.length - 1);
      if (!Number.isFinite(gapV)) {
        return false;
      }
      var nextYById = {};
      var cursorY = minTop;
      sortedV.forEach(function (item) {
        nextYById[String(item.__id || '')] = cursorY;
        cursorY += Math.max(0, Number(item.height || 0)) + gapV;
      });
      return applyToSelectedDraftElements(function (draft) {
        var key = String(draft.__id || '');
        if (Object.prototype.hasOwnProperty.call(nextYById, key)) {
          draft.y = nextYById[key];
        }
      });
    }

    return false;
  }

  function draftElementVisibleOnSide(item, side) {
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
      mapped: [],
      unchanged: [],
      skippedManual: [],
      skippedNoLabel: [],
      ambiguous: [],
      unmatched: [],
    };

    state.templateDraft.elements = state.templateDraft.elements.map(function (item, idx) {
      if (!item || String(item.type || '').toLowerCase() !== 'text') {
        return item;
      }

      if (!draftElementMatchesAutoMapScope(item, scope)) {
        return item;
      }

      report.checked += 1;
      var draft = Object.assign({}, item);
      var existingField = String(draft.field || '').trim();
      var label = String(draft.label || '').trim();
      var tokenField = extractMergeTokenFieldName(label);
      var itemSide = String(item.side || 'front').toLowerCase();
      if (itemSide !== 'front' && itemSide !== 'back' && itemSide !== 'both') {
        itemSide = 'front';
      }

      if (existingField && !tokenField) {
        report.skippedManual.push({
          id: String(item.__id || ''),
          label: label,
          field: existingField,
          side: itemSide,
        });
        return item;
      }

      if (!label) {
        report.skippedNoLabel.push({
          id: String(item.__id || ''),
          side: itemSide,
        });
        return item;
      }

      var candidates = schemaFieldMatchCandidates(label);
      if (!candidates.length) {
        report.unmatched.push({
          id: String(item.__id || ''),
          label: label,
          side: itemSide,
        });
        return item;
      }

      var top = candidates[0];
      var runnerUp = candidates[1] || null;
      var topScore = Number(top && top.score || 0);
      var runnerScore = Number(runnerUp && runnerUp.score || 0);
      var isTokenLocked = top && top.reason === 'token-exact';
      var isAmbiguous = !isTokenLocked
        && !!runnerUp
        && topScore < 150
        && (topScore - runnerScore) <= 5;

      if (isAmbiguous) {
        report.ambiguous.push({
          id: String(item.__id || ''),
          label: label,
          side: itemSide,
          candidates: candidates.slice(0, 3).map(function (entry) {
            return {
              name: String(entry && entry.field && entry.field.name || ''),
              label: fieldLabelForUi(entry && entry.field && entry.field.name || ''),
              score: Number(entry && entry.score || 0),
            };
          }),
        });
        return item;
      }

      var nextField = String(top && top.field && top.field.name || '').trim();
      if (!nextField) {
        return item;
      }

      if (normalizeFieldLookupKey(existingField) === normalizeFieldLookupKey(nextField)) {
        report.unchanged.push({
          id: String(item.__id || ''),
          label: label,
          field: nextField,
          side: itemSide,
        });
        return item;
      }

      draft.field = nextField;
      if (!label || tokenField) {
        draft.label = fieldLabelForUi(nextField);
        draft.showLabel = false;
      }

      var normalized = normalizeDraftElement(draft, idx);
      normalized.__id = item.__id;
      report.mapped.push({
        id: String(item.__id || ''),
        label: label,
        field: nextField,
        side: itemSide,
        score: topScore,
      });
      return normalized;
    });

    report.mappedCount = report.mapped.length;
    if (report.mappedCount > 0) {
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

    var itemDraft = {
      type: baseType,
      label: hasLabelOption ? String(options.label) : (
        baseType === 'image'
          ? 'Image ' + String(nextIndex + 1)
          : (baseType === 'rectangle' ? 'Rectangle ' + String(nextIndex + 1) : '')
      ),
      field: String(options.field || ''),
      side: String(options.side || state.draftActiveSide || 'front'),
      width: Number(options.width || defaultWidth),
      height: Number(options.height || defaultHeight),
      x: Number(options.x || defaultX),
      y: Number(options.y || defaultY),
      fontFamily: String(options.fontFamily || 'Arial'),
      fontGroup: String(options.fontGroup || 'arial'),
      fontFace: String(options.fontFace || 'regular'),
      fontWeight: String(options.fontWeight || '400'),
      fontStyle: String(options.fontStyle || 'normal'),
      textAlign: String(options.textAlign || 'left'),
      lineHeight: Number(options.lineHeight || 1.2),
      letterSpacing: Number(options.letterSpacing || 0),
      color: String(options.color || '#1e293b'),
      textMode: String(options.textMode || (baseType === 'text' ? 'artistic' : '')),
      imageKind: String(options.imageKind || ''),
      src: baseType === 'image' ? String(options.src || '') : '',
      showLabel: options.showLabel !== false,
    };

    if (baseType === 'text' && String(itemDraft.textMode || '').toLowerCase() === 'artistic' && options.autoFitArtistic === true) {
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
      field: selected.field,
      side: selected.side,
      width: selected.width,
      height: selected.height,
      x: Number(selected.x || 0) + 8,
      y: Number(selected.y || 0) + 8,
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

  function triggerSaveDraftTemplate() {
    if (state.loading) {
      return;
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

    if (Object.prototype.hasOwnProperty.call(patchData, 'label')
      && String(current.type || '').toLowerCase() === 'text'
      && String(current.textMode || '').toLowerCase() === 'artistic') {
      patchData.label = String(patchData.label || '').replace(/[ \t\u00A0]+$/g, '');
    }

    Object.keys(patchData).forEach(function (key) {
      current[key] = patchData[key];
    });

    var isArtisticText = String(current.type || '').toLowerCase() === 'text'
      && String(current.textMode || 'artistic').toLowerCase() === 'artistic';
    if (isArtisticText) {
      var artisticAutoFit = current.artisticAutoFit !== false;
      var hasManualSize = Object.prototype.hasOwnProperty.call(patchData, 'width')
        || Object.prototype.hasOwnProperty.call(patchData, 'height');
      var affectsArtisticBounds = Object.prototype.hasOwnProperty.call(patchData, 'label')
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
      if (!hasManualSize && affectsArtisticBounds && artisticAutoFit) {
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
    var mergePreviewMode = !!state.draftMergePreview;
    var rows = [];

    (state.templateDraft.elements || []).forEach(function (item, idx) {
      if (!item) {
        return;
      }

      var renderSides = draftElementRenderSides(item);
      renderSides.forEach(function (renderSide) {
        var sideOffsetUnits = state.isTwoSided && renderSide === 'back' ? layout.cardWidth : 0;
        var isArtisticGeometry = String(item.type || '').toLowerCase() === 'text'
          && String(item.textMode || 'artistic').toLowerCase() === 'artistic';
        var leftRaw = ((Number(item.x || 0) + sideOffsetUnits) / Math.max(1, layout.totalWidth)) * 100;
        var topRaw = (Number(item.y || 0) / Math.max(1, layout.cardHeight)) * 100;
        var widthRaw = (Number(item.width || 1) / Math.max(1, layout.totalWidth)) * 100;
        var heightRaw = (Number(item.height || 1) / Math.max(1, layout.cardHeight)) * 100;
        var left = isArtisticGeometry ? leftRaw : Math.max(0, Math.min(100, leftRaw));
        var top = isArtisticGeometry ? topRaw : Math.max(0, Math.min(100, topRaw));
        var width = isArtisticGeometry ? Math.max(0.8, widthRaw) : Math.max(2, Math.min(100, widthRaw));
        var height = isArtisticGeometry ? Math.max(0.8, heightRaw) : Math.max(2, Math.min(100, heightRaw));
        var hasStoredLabel = Object.prototype.hasOwnProperty.call(item, 'label');
        var label = hasStoredLabel
          ? String(item.label)
          : String(item.field || ('Field ' + String(idx + 1)));
        if (!label && item.type !== 'text') {
          label = String(item.field || ('Field ' + String(idx + 1)));
        }
        if (!label && item.type === 'text' && item.field) {
          label = '{{' + fieldLabelForUi(item.field) + '}}';
        }
        if (mergePreviewMode && item.type === 'text' && item.field) {
          label = '{{' + fieldLabelForUi(item.field) + '}}';
        }
        var isSelected = isDraftElementSelected(item.__id);
        var cls = 'gc-draft-el gc-draft-el-' + (
          item.type === 'image'
            ? 'photo'
            : (item.type === 'rectangle' ? 'rect' : 'text')
        )
          + ' gc-draft-el-side-' + renderSide
          + (item.type === 'text' ? (' gc-draft-el-' + (item.textMode === 'paragraph' ? 'paragraph' : 'artistic')) : '')
          + (item.type === 'text' && state.draftInlineEditingElementId === item.__id ? ' is-editing' : '')
          + (mergePreviewMode && item.field ? ' is-merge-preview' : '')
          + (isSelected ? ' is-selected' : '');
        var style = 'left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%;';

        if (item.type === 'text') {
          var fontSizePt = Number(item.fontSize || 12);
          if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) {
            fontSizePt = 12;
          }
          var fontSizePx = ptToPx(fontSizePt);
          var handleSizePx = Math.round(Math.max(DRAFT_HANDLE_SIZE_MIN_PX, Math.min(DRAFT_HANDLE_SIZE_MAX_PX, fontSizePx * 0.12)));
          var handleGapPx = Math.max(DRAFT_HANDLE_GAP_MIN_PX, Math.min(DRAFT_HANDLE_GAP_MAX_PX, fontSizePx * 0.05));
          var handleOffsetPx = Math.round((handleSizePx / 2) + handleGapPx);
          var handleOffsetYPx = handleOffsetPx;
          var align = item.textAlign === 'left'
            ? 'flex-start'
            : (item.textAlign === 'right' ? 'flex-end' : 'center');
          var textAlign = item.textAlign === 'left'
            ? 'left'
            : (item.textAlign === 'right' ? 'right' : 'center');
          var resolvedLineHeight = item.textMode === 'paragraph'
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
            + 'justify-content:' + align + ';'
            + (item.textMode === 'paragraph' ? 'white-space:normal;' : 'white-space:nowrap;');
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
        var contentHtml = isInlineEditing
          ? '<div class="gc-draft-inline-editor" data-inline-text-editor="1" data-inline-editor-id="' + escapeAttr(item.__id) + '" data-text-mode="' + escapeAttr(item.textMode === 'paragraph' ? 'paragraph' : 'artistic') + '" contenteditable="true" spellcheck="false">' + escapeHtml(label) + '</div>'
          : escapeHtml(label);
        var handlesHtml = (isSelected && !isInlineEditing)
          ? '<span class="gc-draft-selection-handle is-nw" data-handle="nw"></span>'
            + '<span class="gc-draft-selection-handle is-n" data-handle="n"></span>'
            + '<span class="gc-draft-selection-handle is-ne" data-handle="ne"></span>'
            + '<span class="gc-draft-selection-handle is-e" data-handle="e"></span>'
            + '<span class="gc-draft-selection-handle is-sw" data-handle="sw"></span>'
            + '<span class="gc-draft-selection-handle is-s" data-handle="s"></span>'
            + '<span class="gc-draft-selection-handle is-se" data-handle="se"></span>'
            + '<span class="gc-draft-selection-handle is-w" data-handle="w"></span>'
          : '';

        rows.push('<div class="' + cls + '" data-action="select-draft-element" data-el-id="' + escapeAttr(item.__id) + '" data-render-side="' + escapeAttr(renderSide) + '" data-el-type="' + escapeAttr(String(item.type || 'text')) + '" data-text-mode="' + escapeAttr(item.textMode === 'paragraph' ? 'paragraph' : 'artistic') + '"'
          + ' style="' + style + '">'
          + contentHtml
          + handlesHtml
          + '</div>');
      });
    });

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

  function selectDraftElementsByBox(box, appendSelection) {
    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();

    var activeSide = normalizeDraftEditorSide((box && box.side) || state.draftActiveSide);
    if (!state.isTwoSided) {
      activeSide = 'front';
    }
    var selectedIds = appendSelection ? new Set(selectedDraftElementSet()) : new Set();
    var elements = Array.isArray(state.templateDraft.elements) ? state.templateDraft.elements : [];

    elements.forEach(function (item) {
      if (!item || !item.__id) {
        return;
      }

      var renderSides = draftElementRenderSides(item);
      if (!renderSides.some(function (sideName) { return sideName === activeSide; })) {
        return;
      }

      var itemBox = {
        x: Number(item.x || 0),
        y: Number(item.y || 0),
        width: Math.max(0, Number(item.width || 0)),
        height: Math.max(0, Number(item.height || 0)),
      };
      if (draftBoxesIntersect(box, itemBox)) {
        selectedIds.add(String(item.__id));
      }
    });

    state.draftSelectedElementIds = selectedIds;
    state.draftSelectedElementId = '';
    selectedIds.forEach(function (id) {
      if (!state.draftSelectedElementId) {
        state.draftSelectedElementId = String(id || '');
      }
    });
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

    var left = Math.max(0, Math.min(100, ((box.x + sideOffsetUnits) / layout.totalWidth) * 100));
    var top = Math.max(0, Math.min(100, (box.y / layout.cardHeight) * 100));
    var width = Math.max(0.8, Math.min(100, (box.width / layout.totalWidth) * 100));
    var height = Math.max(0.8, Math.min(100, (box.height / layout.cardHeight) * 100));
    var cls = 'gc-draft-insert-guide'
      + (drag.kind === 'rectangle' ? ' is-rect' : '')
      + (drag.kind === 'select' ? ' is-select' : '');

    return '<div class="' + cls + '" style="left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%;"></div>';
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
    var xValue = formatDraftMeasure(item.x, 'x');
    var yValue = formatDraftMeasure(item.y, 'y');
    var wValue = formatDraftMeasure(item.width, 'x');
    var hValue = formatDraftMeasure(item.height, 'y');
    var itemSide = String(item.side || 'front').toLowerCase();
    if (itemSide !== 'front' && itemSide !== 'back' && itemSide !== 'both') {
      itemSide = 'front';
    }
    var showLabelChecked = item.showLabel !== false ? ' checked' : '';
    var textFieldOptions = renderSchemaFieldOptions(item.field, {
      includeEmpty: true,
      emptyLabel: 'Static text (no field)',
      imageOnly: false,
    });
    var imageFieldOptions = renderSchemaFieldOptions(item.field, {
      includeEmpty: true,
      emptyLabel: 'Static image (no field)',
      imageOnly: true,
    });
    var hasMergeField = isText && String(item.field || '').trim();
    var mergePreview = hasMergeField ? '{{' + fieldLabelForUi(item.field) + '}}' : '';
    var boldActive = isText && Number(item.fontWeight || 400) >= 600;
    var italicActive = isText && String(item.fontStyle || 'normal').toLowerCase() === 'italic';
    var imageSrc = String(item.src || '');

    return ''
      + '<div class="gc-prop-section-title">Content</div>'
      + (isText
        ? '<div class="gc-prop-group">'
          + '<label for="gcDraftLabelInput">Text Label</label>'
          + '<input id="gcDraftLabelInput" class="gc-prop-input" type="text" value="' + escapeAttr(item.label || '') + '" placeholder="Type visible text or keep empty for field-only value">'
          + '</div>'
          + '<div class="gc-prop-group">'
          + '<label for="gcDraftFieldInput">Merge Field</label>'
          + '<select id="gcDraftFieldInput" class="gc-prop-select">'
          + textFieldOptions
          + '</select>'
          + '</div>'
          + '<label class="gc-prop-note"><input id="gcDraftShowLabelInput" type="checkbox"' + showLabelChecked + '> Prefix value with label while printing</label>'
          + (hasMergeField
            ? '<div class="gc-prop-note">Merge preview token: <strong>' + escapeHtml(mergePreview) + '</strong></div>'
            : '<div class="gc-prop-note">Tip: assign a merge field to print per-card data in Step 3.</div>')
        : (isRectangle
            ? '<div class="gc-prop-note">Rectangle is decorative only.</div>'
            : '<div class="gc-prop-group">'
              + '<label for="gcDraftFieldInput">Image Field</label>'
              + '<select id="gcDraftFieldInput" class="gc-prop-select">'
              + imageFieldOptions
              + '</select>'
              + '</div>'
              + '<div class="gc-prop-group">'
              + '<label for="gcDraftImageSrcInput">Static Image Source (URL/Data)</label>'
              + '<input id="gcDraftImageSrcInput" class="gc-prop-input" type="text" value="' + escapeAttr(imageSrc) + '" placeholder="https://... or data:image/...">'
              + '</div>'
              + '<div class="gc-prop-note">Use an image field for per-card photos/signatures, or keep a static image source for fixed logos.</div>'))
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
          + '<input id="gcDraftFontInput" class="gc-prop-input" type="number" min="4" max="240" step="0.1" value="' + escapeAttr(formatPtValue(Number(item.fontSize || 12))) + '">'
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
        + '</div>'
        + '<div class="gc-prop-section-title">Align &amp; Distribute</div>'
        + '<div class="gc-prop-actions gc-prop-actions-icons">'
        + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="align-left" title="Align Left" aria-label="Align Left"><i class="fa-solid fa-align-left"></i></button>'
        + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="align-h-center" title="Align Center X" aria-label="Align Center X"><i class="fa-solid fa-align-center"></i></button>'
        + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="align-right" title="Align Right" aria-label="Align Right"><i class="fa-solid fa-align-right"></i></button>'
        + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="align-top" title="Align Top" aria-label="Align Top"><i class="fa-solid fa-arrow-up"></i></button>'
        + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="align-v-center" title="Align Center Y" aria-label="Align Center Y"><i class="fa-solid fa-arrows-up-down"></i></button>'
        + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="align-bottom" title="Align Bottom" aria-label="Align Bottom"><i class="fa-solid fa-arrow-down"></i></button>'
        + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="canvas-center" title="Center To Canvas" aria-label="Center To Canvas"><i class="fa-solid fa-crosshairs"></i></button>'
        + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="distribute-h" title="Distribute Horizontal" aria-label="Distribute Horizontal"><i class="fa-solid fa-arrows-left-right"></i></button>'
        + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="align-selected" data-mode="distribute-v" title="Distribute Vertical" aria-label="Distribute Vertical"><i class="fa-solid fa-arrows-up-down"></i></button>'
          + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="duplicate-draft-element" title="Duplicate" aria-label="Duplicate"><i class="fa-solid fa-clone"></i></button>'
          + '<button type="button" class="btn btn-outline gc-prop-icon-btn" data-action="remove-draft-element" title="Delete" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>'
      + '</div>';
  }

  function templateElementsForSide(side) {
    var tpl = currentTemplateJson();
    var wanted = side === 'back' ? 'back' : 'front';
    return (tpl.elements || []).filter(function (item) {
      if (!item || typeof item !== 'object') {
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
    });
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

  function hasDesignForSide(side) {
    if (side === 'back') {
      return !!(state.backFile || state.backPreviewUrl);
    }
    return !!(state.frontFile || state.frontPreviewUrl);
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
    var boxClass = cardSized
      ? (previewOrientation === 'portrait' ? 'gc-mm-portrait' : 'gc-mm-landscape')
      : (previewOrientation === 'portrait' ? 'gc-ratio-portrait' : 'gc-ratio-landscape');
    var frameHtml = hasPdf
      ? '<div class="gc-pdf-preview-shell">'
        + '<canvas class="gc-pdf-canvas" data-side="' + escapeAttr(side) + '"></canvas>'
        + '<div class="gc-preview-loading" data-side-loading="' + escapeAttr(side) + '">Loading preview...</div>'
        + '</div>'
      : '<div class="gc-preview-empty">No ' + escapeHtml(side) + ' background selected (optional)</div>';

    var overlayHtml = withOverlay && hasPdf
      ? '<div class="gc-template-overlay">' + buildOverlayHtml(side) + '</div>'
      : '';

    return '<div class="gc-preview-card' + (cardSized ? ' is-card-size' : '') + '">'
      + '<div class="gc-preview-head"><span>' + escapeHtml(title) + '</span></div>'
      + '<div class="gc-preview-box ' + boxClass + '">'
      + frameHtml
      + overlayHtml
      + '</div>'
      + '</div>';
  }

  function renderStep1() {
    var frontName = state.frontFile
      ? state.frontFile.name
      : (state.frontPreviewUrl ? 'Background PDF selected' : 'No file selected (optional)');
    var backName = state.backFile
      ? state.backFile.name
      : (state.backPreviewUrl ? 'Background PDF selected' : 'No file selected (optional)');
    var realSize = draftRealDimensionsMm();
    var sizeLabel = formatMmLabelValue(realSize.widthMm) + 'mm x ' + formatMmLabelValue(realSize.heightMm) + 'mm';

    var topbarHtml = ''
      + '<div class="gc-step1-topbar">'
      + '<div class="gc-inline-controls">'
      + '<div class="gc-inline-control-block">'
      + '<div class="gc-inline-label">Card Type</div>'
      + '<div class="gc-inline-value">Horizontal</div>'
      + '</div>'
      + '<div class="gc-inline-control-block">'
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
      + '<button type="button" class="btn btn-outline" data-action="reload-templates">Refresh</button>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="gc-inline-group gc-inline-group-selection">'
      + '<div class="gc-inline-label">Card Selection</div>'
      + '<div class="gc-inline-value">' + selectedCardCount() + ' cards selected</div>'
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
      + renderPdfPreview('Front', 'front', false, { cardSized: true, orientation: state.orientation })
      + (state.isTwoSided ? renderPdfPreview('Back', 'back', false, { cardSized: true, orientation: state.orientation }) : '')
      + '</div>'
      + '</div>';

    var actionsHtml = ''
      + '<div class="gc-actions">'
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

  function renderTemplateOptions() {
    var options = ['<option value="">No template selected (create in Step 2 workspace)</option>'];
    if (!state.templates.length) {
      return options.join('');
    }

    options = options.concat(state.templates.map(function (item) {
      var id = Number(item.id || 0);
      var isSelected = Number(state.selectedTemplateId || 0) === id;
      var title = String(item.name || ('Template #' + id));
      return '<option value="' + id + '"' + (isSelected ? ' selected' : '') + '>' + escapeHtml(title) + '</option>';
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
      outside: false,
      canvasLeft: 0,
      canvasTop: 0,
      canvasWidth: canvasDisplayWidth,
      canvasHeight: canvasDisplayHeight,
      layerWidth: canvasDisplayWidth,
      layerHeight: canvasDisplayHeight,
    });
    var zoomLabel = Math.round(zoom * 100);
    var unit = currentDraftUnit();
    var unitLabel = unit.toUpperCase();
    var canvasWValue = formatDraftMeasure(metrics.width, 'x');
    var canvasHValue = formatDraftMeasure(metrics.height, 'y');
    var snapMmLabel = formatDraftSnapMm(state.draftSnapMm);
    var canUndo = !!(draftHistoryState && draftHistoryState.undo && draftHistoryState.undo.length);
    var canRedo = !!(draftHistoryState && draftHistoryState.redo && draftHistoryState.redo.length);
    var guidesLocked = !!state.draftGuidesLocked;
    var mergeFieldOptions = renderSchemaFieldOptions('', {
      includeEmpty: false,
      imageOnly: false,
    });
    var photoFieldOptions = renderSchemaFieldOptions('', {
      includeEmpty: false,
      imageOnly: true,
    });
    var hasMergeFieldChoices = !!mergeFieldOptions;
    var hasPhotoFieldChoices = !!photoFieldOptions;
    var autoMapScope = normalizeAutoMapScope(state.draftAutoMapScope || 'active');
    var autoMapScopeOptions = renderAutoMapScopeOptions(autoMapScope);
    var hasAutoMapReport = !!state.draftAutoMapReport;
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
      + '<button type="button" class="btn btn-outline" data-action="zoom-out">-</button>'
      + '<button type="button" class="btn btn-outline" data-action="zoom-in">+</button>'
      + '<button type="button" class="btn btn-outline" data-action="zoom-fit">Fit</button>'
      + '<span class="gc-step2-zoom-pill">' + zoomLabel + '%</span>'
      + '<button type="button" class="btn btn-outline" data-action="undo-draft"' + (canUndo ? '' : ' disabled') + '>Undo</button>'
      + '<button type="button" class="btn btn-outline" data-action="redo-draft"' + (canRedo ? '' : ' disabled') + '>Redo</button>'
      + '<select id="gcDraftUnitSelect" class="gc-step2-unit-select">'
      + '<option value="mm"' + (unit === 'mm' ? ' selected' : '') + '>mm</option>'
      + '<option value="cm"' + (unit === 'cm' ? ' selected' : '') + '>cm</option>'
      + '<option value="in"' + (unit === 'in' ? ' selected' : '') + '>in</option>'
      + '</select>'
      + '<label class="gc-step2-snap-control" for="gcDraftSnapMmInput">'
      + '<span class="gc-step2-snap-label">Snap (mm)</span>'
      + '<input id="gcDraftSnapMmInput" class="gc-step2-snap-input" type="number" min="0" max="10" step="0.1" value="' + escapeAttr(snapMmLabel) + '" title="0 = off">'
      + '</label>'
      + '<button type="button" class="btn btn-outline' + (guidesLocked ? ' is-active' : '') + '" data-action="toggle-guides-lock" title="Lock or unlock guide lines">'
      + '<i class="fa-solid ' + (guidesLocked ? 'fa-lock' : 'fa-lock-open') + '"></i> '
      + (guidesLocked ? 'Guides Locked' : 'Lock Guides')
      + '</button>'
      + '<button type="button" class="btn btn-outline' + (state.draftMergePreview ? ' is-active' : '') + '" data-action="toggle-merge-preview" title="Show merge-token preview on canvas">Merge Preview</button>'
      + '<div class="gc-step2-size-controls">'
      + '<span class="gc-step2-size-label">W (' + unitLabel + ')</span>'
      + '<input id="gcDraftCanvasWidthCenterInput" class="gc-step2-size-input" type="number" step="any" value="' + escapeAttr(canvasWValue) + '" readonly aria-readonly="true" tabindex="-1">'
      + '<span class="gc-step2-size-label">H (' + unitLabel + ')</span>'
      + '<input id="gcDraftCanvasHeightCenterInput" class="gc-step2-size-input" type="number" step="any" value="' + escapeAttr(canvasHValue) + '" readonly aria-readonly="true" tabindex="-1">'
      + '</div>'
      + '<select id="gcDraftInsertFieldSelect" class="gc-step2-merge-select"' + (hasMergeFieldChoices ? '' : ' disabled') + '>'
      + (hasMergeFieldChoices ? mergeFieldOptions : '<option value="">No fields available</option>')
      + '</select>'
      + '<button type="button" class="btn btn-outline" data-action="insert-merge-field"' + (hasMergeFieldChoices ? '' : ' disabled') + '>Insert Field</button>'
      + '<select id="gcDraftAutoMapScopeSelect" class="gc-step2-merge-select"' + (hasMergeFieldChoices ? '' : ' disabled') + '>'
      + autoMapScopeOptions
      + '</select>'
      + '<button type="button" class="btn btn-outline" data-action="auto-map-fields"' + (hasMergeFieldChoices ? '' : ' disabled') + '>Auto Map Fields</button>'
      + '<button type="button" class="btn btn-outline" data-action="open-auto-map-report"' + (hasAutoMapReport ? '' : ' disabled') + '>View Map Report</button>'
      + '<select id="gcDraftInsertPhotoFieldSelect" class="gc-step2-merge-select"' + (hasPhotoFieldChoices ? '' : ' disabled') + '>'
      + (hasPhotoFieldChoices ? photoFieldOptions : '<option value="">No image fields</option>')
      + '</select>'
      + '<button type="button" class="btn btn-outline" data-action="insert-photo-field"' + (hasPhotoFieldChoices ? '' : ' disabled') + '>Insert Photo Field</button>'
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
      + renderDraftInsertGuideHtml()
      + '</div>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="gc-step2-props">'
      + renderDraftPropsHtml()
      + '</div>'
      + '</div>'
      + '</div>'
      + renderAutoMapReportModal()
      + '<div class="gc-actions">'
      + '<button type="button" class="btn btn-outline" data-action="prev-step">Back</button>'
      + '<div class="gc-actions-right">'
      + '<button type="button" class="btn btn-blue" data-action="next-step">Next</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function renderStep3() {
    var generateDisabled = (state.generating || !step1Valid() || selectedCardCount() <= 0) ? ' disabled' : '';
    var orientationText = state.orientation === 'portrait' ? 'Vertical' : 'Horizontal';
    var sideText = state.isTwoSided ? '2 Sided' : '1 Sided';
    var templateText = state.selectedTemplate ? String(state.selectedTemplate.name || ('Template #' + state.selectedTemplate.id)) : 'Not selected';

    return '<div class="gc-step-panel gc-step-panel-step3">'
      + '<h3 class="gc-step-title">Step 3: Generate All Cards</h3>'
      + '<p class="gc-step-subtitle">Review summary and generate cards for the selected list.</p>'
      + '<div class="gc-summary gc-step3-summary">'
      + '<div class="gc-summary-item"><div class="gc-summary-label">Orientation</div><div class="gc-summary-value">' + escapeHtml(orientationText) + '</div></div>'
      + '<div class="gc-summary-item"><div class="gc-summary-label">Sides</div><div class="gc-summary-value">' + escapeHtml(sideText) + '</div></div>'
      + '<div class="gc-summary-item"><div class="gc-summary-label">Template</div><div class="gc-summary-value">' + escapeHtml(templateText) + '</div></div>'
      + '<div class="gc-summary-item"><div class="gc-summary-label">Cards to Generate</div><div class="gc-summary-value">' + selectedCardCount() + '</div></div>'
      + '</div>'
      + '<div class="gc-preview-grid gc-preview-grid-cards">'
      + renderPdfPreview('Final Front Preview', 'front', true, { cardSized: true, orientation: state.orientation })
      + (state.isTwoSided ? renderPdfPreview('Final Back Preview', 'back', true, { cardSized: true, orientation: state.orientation }) : '')
      + '</div>'
      + '<div class="gc-actions">'
      + '<button type="button" class="btn btn-outline" data-action="prev-step">Back</button>'
      + '<div class="gc-actions-right">'
      + '<button type="button" class="btn btn-green" data-action="generate-all"' + generateDisabled + '>'
      + (state.generating ? 'Generating...' : 'Generate All')
      + '</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function render() {
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
    if (!id) {
      state.selectedTemplateId = null;
      state.selectedTemplate = null;
      resetStep2DraftState();
      return;
    }

    var detail = await requestJson('GET', templateDetailPath(id));
    state.selectedTemplateId = id;
    state.selectedTemplate = detail.template || null;
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

  function handleStepNext() {
    state.step = Math.min(3, state.step + 1);
    if (state.step === 2) {
      ensureStep2DraftInitialized();
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
    var nextStep = Number(stepNum || 1);
    if (!Number.isFinite(nextStep)) {
      return;
    }
    state.step = Math.min(3, Math.max(1, Math.floor(nextStep)));
    if (state.step === 2) {
      ensureStep2DraftInitialized();
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
      font_size: Number((baseTemplate && baseTemplate.font_size) || 12),
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
      font_size: Number((state.selectedTemplate && state.selectedTemplate.font_size) || 12),
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
    state.draftDirty = false;
    if (!state.draftSelectedElementId && state.templateDraft.elements.length) {
      state.draftSelectedElementId = state.templateDraft.elements[0].__id;
    }

    return state.selectedTemplate;
  }

  async function createWorkingTemplate() {
    ensureStep2DraftInitialized();
    syncDraftToSelectedTemplate();

    var created = await createDraftTemplate();
    return {
      template: created,
      transient: true,
    };
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

  async function deleteTransientTemplate(templateId) {
    var id = Number(templateId || 0);
    if (!id) {
      return;
    }
    try {
      await requestJson('DELETE', templatesPath(id), {});
      state.templates = (state.templates || []).filter(function (item) {
        return Number(item && item.id || 0) !== id;
      });
      if (Number(state.selectedTemplateId || 0) === id) {
        state.selectedTemplateId = null;
        state.selectedTemplate = null;
      }
    } catch (_cleanupErr) {
      // Cleanup is best-effort; generation result should not be blocked.
    }
  }

  async function clearPdfForSide(side) {
    if (side !== 'front' && side !== 'back') {
      return;
    }

    revokeLocalPreview(side);
    if (side === 'front') {
      state.frontFile = null;
      state.frontPreviewUrl = '';
    } else {
      state.backFile = null;
      state.backPreviewUrl = '';
    }

    setAlert((side === 'front' ? 'Front' : 'Back') + ' background cleared.', 'warning');
    showToast((side === 'front' ? 'Front' : 'Back') + ' background cleared.', 'success');
    render();
  }

  async function handleGenerateAll() {
    if (state.generating) {
      return;
    }
    if (selectedCardCount() <= 0) {
      setAlert('No cards available to generate.', 'error');
      return;
    }

    state.generating = true;
    render();

    try {
      setAlert('Preparing template and uploading PDFs...', 'warning');
      var working = await createWorkingTemplate();
      var workingTemplate = working && working.template ? working.template : null;
      var cleanupTransient = !!(working && working.transient && workingTemplate && workingTemplate.id);
      if (!workingTemplate || !workingTemplate.id) {
        throw new Error('Unable to prepare a working template for generation.');
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

      setAlert('Cards generated successfully.', 'warning');
      showToast('Cards generated successfully.', 'success');

      if (cleanupTransient) {
        await deleteTransientTemplate(workingTemplate.id);
      }

      if (typeof window.closeGcEditorModal === 'function') {
        window.closeGcEditorModal();
      }
    } catch (err) {
      var message = err && err.message ? err.message : 'Generation failed.';
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

    if (action === 'reload-templates') {
      state.loading = true;
      render();
      loadTemplates()
        .then(function () {
          if (state.selectedTemplateId) {
            return selectTemplate(state.selectedTemplateId);
          }
          return null;
        })
        .then(function () {
          setAlert('', 'warning');
          render();
        })
        .catch(function (err) {
          var message = err && err.message ? err.message : 'Failed to reload templates.';
          setAlert(message, 'error');
          showToast(message, 'error');
          render();
        })
        .finally(function () {
          state.loading = false;
          render();
        });
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
      setDraftZoomWithAnchor((Number(state.draftZoom || 1) + 0.1), null);
      render();
      return;
    }

    if (action === 'zoom-out') {
      setDraftZoomWithAnchor((Number(state.draftZoom || 1) - 0.1), null);
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

    if (action === 'toggle-merge-preview') {
      state.draftMergePreview = !state.draftMergePreview;
      if (state.draftMergePreview) {
        clearDraftInlineTextEditing();
        state.draftPendingTextEdit = null;
      }
      showToast(state.draftMergePreview ? 'Merge preview enabled.' : 'Merge preview disabled.', 'info');
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

    if (action === 'insert-merge-field') {
      ensureStep2DraftInitialized();
      var selectEl = flowRoot.querySelector('#gcDraftInsertFieldSelect');
      var wantedField = String(selectEl && selectEl.value || '').trim();
      if (!wantedField) {
        showToast('Select a field to insert.', 'warning');
        return;
      }
      var fieldMeta = findTableFieldByName(wantedField);
      if (!fieldMeta) {
        showToast('Selected field is not available.', 'warning');
        return;
      }

      var active = selectedDraftElement();
      if (active && String(active.type || '').toLowerCase() === 'text') {
        if (syncSelectedElementField(fieldMeta.name)) {
          showToast('Field applied to selected text element.', 'success');
        }
      } else {
        var created = addDraftElement('text', {
          label: fieldLabelForUi(fieldMeta.name),
          field: fieldMeta.name,
          side: state.draftActiveSide,
          textMode: 'paragraph',
          textAlign: 'left',
          showLabel: false,
          width: 120,
          height: 26,
        });
        if (created) {
          showToast('Merge field inserted.', 'success');
        }
      }
      render();
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
      var ambiguousCount = Array.isArray(mapping && mapping.ambiguous) ? mapping.ambiguous.length : 0;
      var unmatchedCount = Array.isArray(mapping && mapping.unmatched) ? mapping.unmatched.length : 0;
      if (mappedCount > 0) {
        showToast('Mapped ' + String(mappedCount) + ' field(s). Ambiguous: ' + String(ambiguousCount) + ', unmatched: ' + String(unmatchedCount) + '.', 'success');
      } else {
        showToast('No new mappings. Ambiguous: ' + String(ambiguousCount) + ', unmatched: ' + String(unmatchedCount) + '.', 'info');
      }
      render();
      return;
    }

    if (action === 'insert-photo-field') {
      var photoFieldSelect = flowRoot.querySelector('#gcDraftInsertPhotoFieldSelect');
      var wantedPhotoField = String(photoFieldSelect && photoFieldSelect.value || '').trim();
      if (insertPhotoFieldElement(wantedPhotoField)) {
        render();
      }
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
        if (selectedSet.has(elId)) {
          selectedSet.delete(elId);
          if (state.draftSelectedElementId === elId) {
            var nextId = '';
            selectedSet.forEach(function (sid) {
              if (!nextId) {
                nextId = sid;
              }
            });
            state.draftSelectedElementId = nextId;
          }
        } else {
          selectedSet.add(elId);
          state.draftSelectedElementId = elId;
        }
        clearDraftInlineTextEditing();
      } else {
        state.draftSelectedElementId = elId;
        state.draftSelectedElementIds = elId ? new Set([elId]) : new Set();
        if (shouldInlineEdit) {
          setDraftInlineTextEditing(elId);
        } else if (state.draftInlineEditingElementId && state.draftInlineEditingElementId !== elId) {
          state.draftInlineEditingElementId = '';
        }
      }
      state.draftSelectedGuideId = '';
      state.draftPendingTextEdit = null;
      normalizeDraftElementSelection();
      render();
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
      triggerSaveDraftTemplate();
      return;
    }

    if (action === 'generate-all') {
      handleGenerateAll();
    }
  });

  flowRoot.addEventListener('wheel', function (event) {
    if (state.step !== 2 || !event.altKey) {
      return;
    }

    var stage = event.target && event.target.closest
      ? event.target.closest('.gc-step2-canvas-stage')
      : null;
    if (!stage) {
      return;
    }

    var delta = Number(event.deltaY || 0);
    var nextZoom = Number(state.draftZoom || 1) + (delta < 0 ? 0.08 : -0.08);
    setDraftZoomWithAnchor(nextZoom, event);
    event.preventDefault();
    render();
  }, { passive: false });

  window.addEventListener('wheel', function (event) {
    if (!modalEl || modalEl.classList.contains('hidden') || !event.ctrlKey) {
      return;
    }

    var target = event.target;
    var inModal = target && target.closest ? target.closest('#gcEditorModal') : null;
    if (!inModal) {
      return;
    }

    var stage = target && target.closest ? target.closest('.gc-step2-canvas-stage') : null;
    if (stage && state.step === 2) {
      var delta = Number(event.deltaY || 0);
      var nextZoom = Number(state.draftZoom || 1) + (delta < 0 ? 0.08 : -0.08);
      setDraftZoomWithAnchor(nextZoom, event);
      render();
    }

    event.preventDefault();
  }, { passive: false, capture: true });

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
    if (!canvasEl) {
      return;
    }

    if (!el) {
      var selectStart = canvasEventToDraftPoint(canvasEl, event, { allowOutside: true });
      state.draftActiveSide = normalizeDraftEditorSide(selectStart.side);
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
      };
      beginDraftHistoryTransaction();
      clearDraftInlineTextEditing();
      event.preventDefault();
      render();
      return;
    }
    var handleEl = event.target.closest('.gc-draft-selection-handle');

    var elId = String(el.getAttribute('data-el-id') || '');
    var renderSideForEl = normalizeDraftEditorSide(el.getAttribute('data-render-side'));
    if (!elId) {
      return;
    }
    if (state.isTwoSided) {
      state.draftActiveSide = renderSideForEl;
    }

    if (event.shiftKey) {
      state.draftPendingTextEdit = null;
      event.preventDefault();
      return;
    }

    ensureStep2DraftInitialized();
    normalizeDraftElementSelection();
    var selectedBefore = new Set(selectedDraftElementSet());
    var current = state.templateDraft.elements.find(function (item) {
      return item && item.__id === elId;
    });
    if (!current) {
      return;
    }

    var keepMultiSelection = !event.shiftKey
      && selectedBefore.size > 1
      && selectedBefore.has(elId);

    if (handleEl) {
      state.draftSelectedElementId = elId;
      state.draftSelectedElementIds = new Set([elId]);
      state.draftSelectedGuideId = '';
      state.draftInlineEditingElementId = '';
      var resizeHandle = normalizeDraftResizeHandle(handleEl.getAttribute('data-handle'));
      var resizePoint = canvasEventToDraftPoint(canvasEl, event, { allowOutside: true });
      state.draftPendingTextEdit = null;
      state.draftDragging = null;
      state.draftResizeDragging = {
        id: elId,
        handle: resizeHandle,
        type: String(current.type || ''),
        textMode: String(current.textMode || ''),
        startFontSize: Number(current.fontSize || 12),
        startLetterSpacing: Number(current.letterSpacing || 0),
        startMouseX: Number(event.clientX || 0),
        startMouseY: Number(event.clientY || 0),
        startX: Number(current.x || 0),
        startY: Number(current.y || 0),
        startWidth: Number(current.width || 0),
        startHeight: Number(current.height || 0),
        canvasRect: resizePoint.rect,
        metrics: resizePoint.metrics,
      };
      beginDraftHistoryTransaction();
      event.preventDefault();
      render();
      return;
    }

    if (!keepMultiSelection) {
      state.draftSelectedElementId = elId;
      state.draftSelectedElementIds = new Set([elId]);
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
      canvasRect: point.rect,
      metrics: point.metrics,
    };
    beginDraftHistoryTransaction();
    state.draftResizeDragging = null;

    event.preventDefault();
    render();
  });

  flowRoot.addEventListener('dblclick', function (event) {
    var dblTarget = event.target && event.target.nodeType === 1
      ? event.target
      : (event.target && event.target.parentElement ? event.target.parentElement : null);
    if (!dblTarget || !dblTarget.closest) {
      return;
    }

    var guideEl = dblTarget.closest('.gc-draft-guide');
    if (guideEl) {
      if (state.draftGuidesLocked) {
        event.preventDefault();
        return;
      }
      var guideId = String(guideEl.getAttribute('data-guide-id') || '');
      if (guideId) {
        removeDraftGuideById(guideId);
        state.draftSelectedGuideId = '';
        event.preventDefault();
        render();
      }
      return;
    }

    if (state.step === 2 && state.draftTool === 'select') {
      var textEl = dblTarget.closest('.gc-draft-el.gc-draft-el-text');
      if (textEl && !dblTarget.closest('.gc-draft-selection-handle')) {
        var textId = String(textEl.getAttribute('data-el-id') || '');
        if (textId && setDraftInlineTextEditing(textId)) {
          state.draftPendingTextEdit = null;
          state.draftDragging = null;
          state.draftResizeDragging = null;
          event.preventDefault();
          render();
          return;
        }
      }
    }

    if (state.step !== 2) {
      return;
    }

    var canvasEl = dblTarget.closest('.gc-step2-canvas');
    if (!canvasEl || dblTarget !== canvasEl) {
      return;
    }

    if (state.draftTool === 'rectangle') {
      var rectPoint = canvasEventToDraftPoint(canvasEl, event);
      state.draftActiveSide = normalizeDraftEditorSide(rectPoint.side);
      var metrics = draftCanvasMetrics();
      var count = (state.templateDraft && state.templateDraft.elements ? state.templateDraft.elements.length : 0) + 1;
      addDraftElement('rectangle', {
        x: 0,
        y: 0,
        width: Number(metrics.width || 0),
        height: Number(metrics.height || 0),
        side: state.draftActiveSide,
        color: '#2563eb',
        label: 'Rectangle ' + String(count),
      });
      event.preventDefault();
      render();
      return;
    }

    if (state.draftTool !== 'photo') {
      return;
    }

    var point = canvasEventToDraftPoint(canvasEl, event);
    state.draftActiveSide = normalizeDraftEditorSide(point.side);
    addPhotoPlaceholderElement({
      atPoint: true,
      x: point.x,
      y: point.y,
      side: state.draftActiveSide,
    });
    state.draftTool = 'select';
    event.preventDefault();
    render();
  });

  window.addEventListener('mousemove', function (event) {
    if (state.step === 2) {
      var pointerTarget = event && event.target;
      var pointerInStage = pointerTarget && pointerTarget.closest
        ? pointerTarget.closest('.gc-step2-canvas-stage')
        : null;
      if (pointerInStage) {
        state.draftLastPointerClientX = Number(event.clientX || 0);
        state.draftLastPointerClientY = Number(event.clientY || 0);
      } else {
        state.draftLastPointerClientX = null;
        state.draftLastPointerClientY = null;
      }
    }

    var panState = state.spacePanState;
    if (panState) {
      var panStage = resolveStageContentEl(panState.stageEl);
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

    var resizeDrag = state.draftResizeDragging;
    if (resizeDrag) {
      applyDraftResizeDrag(resizeDrag, event);
      render();
      return;
    }

    var guideDrag = state.draftGuideDragging;
    if (guideDrag) {
      if (state.draftGuidesLocked) {
        state.draftGuideDragging = null;
        render();
        return;
      }
      var guideCanvas = resolveDraftCanvasEl(guideDrag.canvasEl);
      if (!guideCanvas) {
        return;
      }
      guideDrag.canvasEl = guideCanvas;
      var guidePoint = canvasEventToDraftPoint(guideCanvas, event, { allowOutside: true });
      var nextPos = guideDrag.axis === 'x' ? guidePoint.x : guidePoint.y;
      nextPos = snapCanvasValueToGrid(nextPos, guideDrag.axis);
      updateDraftGuidePosition(guideDrag.id, nextPos);
      render();
      return;
    }

    var textDrag = state.draftTextDrag;
    if (textDrag) {
      var textCanvas = resolveDraftCanvasEl(textDrag.canvasEl);
      if (!textCanvas) {
        return;
      }
      textDrag.canvasEl = textCanvas;
      var livePoint = canvasEventToDraftPoint(textCanvas, event);
      textDrag.currentX = snapCanvasValueToGrid(livePoint.x, 'x');
      textDrag.currentY = snapCanvasValueToGrid(livePoint.y, 'y');
      render();
      return;
    }

    var rectDrag = state.draftRectDrag;
    if (rectDrag) {
      var rectCanvas = resolveDraftCanvasEl(rectDrag.canvasEl);
      if (!rectCanvas) {
        return;
      }
      rectDrag.canvasEl = rectCanvas;
      var rectPoint = canvasEventToDraftPoint(rectCanvas, event, { allowOutside: true });
      rectDrag.currentX = snapCanvasValueToGrid(rectPoint.x, 'x');
      rectDrag.currentY = snapCanvasValueToGrid(rectPoint.y, 'y');
      rectDrag.lockSquare = !!event.shiftKey;
      render();
      return;
    }

    var selectDrag = state.draftSelectDrag;
    if (selectDrag) {
      var selectCanvas = resolveDraftCanvasEl(selectDrag.canvasEl);
      if (!selectCanvas) {
        return;
      }
      selectDrag.canvasEl = selectCanvas;
      var selectPoint = canvasEventToDraftPoint(selectCanvas, event, { allowOutside: true });
      selectDrag.currentX = Number(selectPoint.x || selectDrag.startX || 0);
      selectDrag.currentY = Number(selectPoint.y || selectDrag.startY || 0);
      render();
      return;
    }

    var drag = state.draftDragging;
    if (!drag) {
      return;
    }

    var scaleX = drag.metrics.width / Math.max(1, draftCanvasSideDisplayWidthPx(drag.canvasRect));
    var scaleY = drag.metrics.height / Math.max(1, drag.canvasRect.height);
    var x = drag.startX + ((Number(event.clientX || 0) - drag.startMouseX) * scaleX);
    var y = drag.startY + ((Number(event.clientY || 0) - drag.startMouseY) * scaleY);
    x = snapCanvasValueToGrid(x, 'x');
    y = snapCanvasValueToGrid(y, 'y');

    if (state.draftPendingTextEdit && state.draftPendingTextEdit.id === drag.id) {
      var moveDx = Number(event.clientX || 0) - Number(state.draftPendingTextEdit.startMouseX || 0);
      var moveDy = Number(event.clientY || 0) - Number(state.draftPendingTextEdit.startMouseY || 0);
      if (Math.abs(moveDx) > 2 || Math.abs(moveDy) > 2) {
        state.draftPendingTextEdit.moved = true;
      }
    }

    if (Array.isArray(drag.dragIds) && drag.dragIds.length > 1 && drag.startPositions && typeof drag.startPositions === 'object') {
      var anchorStartX = Number(drag.startX || 0);
      var anchorStartY = Number(drag.startY || 0);
      var snappedAnchorX = snapCanvasValueToGrid(anchorStartX + ((Number(event.clientX || 0) - drag.startMouseX) * scaleX), 'x');
      var snappedAnchorY = snapCanvasValueToGrid(anchorStartY + ((Number(event.clientY || 0) - drag.startMouseY) * scaleY), 'y');
      var deltaX = snappedAnchorX - anchorStartX;
      var deltaY = snappedAnchorY - anchorStartY;

      ensureStep2DraftInitialized();
        prepareDraftHistoryMutation();
      var changed = false;
      state.templateDraft.elements = state.templateDraft.elements.map(function (item, idx) {
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

        var normalized = normalizeDraftElement(draft, idx);
        normalized.__id = item.__id;
        changed = true;
        return normalized;
      });

      if (changed) {
        markDraftDirty();
        normalizeDraftElementSelection();
      }

      render();
      return;
    }

    updateSelectedDraftElement({ x: x, y: y });
    render();
  });

  window.addEventListener('mouseup', function (event) {
    if (state.spacePanState) {
      state.spacePanState = null;
      setSpacePanUiState();
      return;
    }

    if (state.draftResizeDragging) {
      state.draftResizeDragging = null;
      endDraftHistoryTransaction();
      render();
      return;
    }

    if (state.draftGuideDragging) {
      state.draftGuideDragging = null;
      endDraftHistoryTransaction();
      render();
      return;
    }

    if (state.draftTextDrag) {
      var td = state.draftTextDrag;
      var dx = Math.abs(Number(td.currentX || td.startX) - Number(td.startX || 0));
      var dy = Math.abs(Number(td.currentY || td.startY) - Number(td.startY || 0));
      var createdTextItem = null;

      if (dx >= 14 || dy >= 14) {
        createdTextItem = addDraftElement('text', {
          x: Math.min(Number(td.startX || 0), Number(td.currentX || td.startX || 0)),
          y: Math.min(Number(td.startY || 0), Number(td.currentY || td.startY || 0)),
          width: Math.max(36, dx),
          height: Math.max(20, dy),
          side: normalizeDraftEditorSide(td.side || state.draftActiveSide),
          textMode: 'paragraph',
          textAlign: 'left',
          label: '',
        });
      } else {
        createdTextItem = addDraftElement('text', {
          x: Number(td.startX || 0),
          y: Number(td.startY || 0),
          side: normalizeDraftEditorSide(td.side || state.draftActiveSide),
          textMode: 'artistic',
          textAlign: 'left',
          autoFitArtistic: true,
          label: '',
        });
      }

      if (createdTextItem && createdTextItem.__id && String(createdTextItem.textMode || '').toLowerCase() === 'artistic') {
        setDraftInlineTextEditing(createdTextItem.__id);
      }

      state.draftTextDrag = null;
      endDraftHistoryTransaction();
      render();
      return;
    }

    if (state.draftRectDrag) {
      var rd = state.draftRectDrag;
      var rectBox = draftDragBox(
        Number(rd.startX || 0),
        Number(rd.startY || 0),
        Number(rd.currentX || rd.startX || 0),
        Number(rd.currentY || rd.startY || 0),
        !!(event.shiftKey || rd.lockSquare)
      );
      var count = (state.templateDraft && state.templateDraft.elements ? state.templateDraft.elements.length : 0) + 1;

      if (rectBox.width >= 8 || rectBox.height >= 8) {
        addDraftElement('rectangle', {
          x: rectBox.x,
          y: rectBox.y,
          width: Math.max(12, rectBox.width),
          height: Math.max(12, rectBox.height),
          side: normalizeDraftEditorSide(rd.side || state.draftActiveSide),
          color: '#2563eb',
          label: 'Rectangle ' + String(count),
        });
      }

      state.draftRectDrag = null;
      endDraftHistoryTransaction();
      render();
      return;
    }

    if (state.draftSelectDrag) {
      var sd = state.draftSelectDrag;
      var selectBox = draftDragBox(
        Number(sd.startX || 0),
        Number(sd.startY || 0),
        Number(sd.currentX || sd.startX || 0),
        Number(sd.currentY || sd.startY || 0),
        false
      );
      selectBox.side = normalizeDraftEditorSide(sd.side || state.draftActiveSide);
      var clickOnly = selectBox.width < 3 && selectBox.height < 3;

      if (clickOnly) {
        if (!sd.appendSelection) {
          state.draftSelectedElementId = '';
          state.draftSelectedElementIds = new Set();
          state.draftSelectedGuideId = '';
          clearDraftInlineTextEditing();
        }
      } else {
        selectDraftElementsByBox(selectBox, !!sd.appendSelection);
      }

      state.draftSelectDrag = null;
      endDraftHistoryTransaction();
      render();
      return;
    }

    if (!state.draftDragging) {
      endDraftHistoryTransaction();
      return;
    }
    state.draftDragging = null;
    endDraftHistoryTransaction();
  });

  flowRoot.addEventListener('keydown', function (event) {
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

  flowRoot.addEventListener('input', function (event) {
    var target = event.target;
    if (!target || !target.classList || !target.classList.contains('gc-draft-inline-editor')) {
      return;
    }

    var elId = String(target.getAttribute('data-inline-editor-id') || '');
    if (!elId) {
      return;
    }

    if (!state.draftInlineEditHistoryActive) {
      beginDraftHistoryTransaction();
      state.draftInlineEditHistoryActive = true;
    }

    var nextText = String(typeof target.innerText === 'string' ? target.innerText : (target.textContent || ''));
    updateDraftTextLabelById(elId, nextText.replace(/\r\n?/g, '\n'));
  });

  flowRoot.addEventListener('focusout', function (event) {
    var target = event.target;
    if (!target || !target.classList || !target.classList.contains('gc-draft-inline-editor')) {
      return;
    }

    if (state.draftInlineEditHistoryActive) {
      endDraftHistoryTransaction();
      state.draftInlineEditHistoryActive = false;
    }

    if (!state.draftInlineEditingElementId) {
      return;
    }

    state.draftInlineEditingElementId = '';
    render();
  });

  window.addEventListener('keydown', function (event) {
    if (!isStep2EditorActive()) {
      return;
    }

    var key = String(event.key || '');
    if ((key === ' ' || key === 'Spacebar') && !isTypingTarget(event.target)) {
      if (!state.spacePanMode) {
        state.spacePanMode = true;
        setSpacePanUiState();
      }
      event.preventDefault();
      return;
    }

    if (isTypingTarget(event.target)) {
      return;
    }

    var lower = key.toLowerCase();
    var ctrlOrMeta = !!(event.ctrlKey || event.metaKey);
    var handled = false;

    if (state.draftAutoMapReportOpen && key === 'Escape') {
      state.draftAutoMapReportOpen = false;
      event.preventDefault();
      render();
      return;
    }

    if (ctrlOrMeta && !event.altKey && lower === 'z') {
      handled = event.shiftKey ? redoDraftHistory() : undoDraftHistory();
    } else if (ctrlOrMeta && !event.altKey && lower === 'y') {
      handled = redoDraftHistory();
    } else if (ctrlOrMeta && !event.altKey && lower === 'b') {
      handled = toggleSelectedTextStyle('bold');
    } else if (ctrlOrMeta && !event.altKey && lower === 'i') {
      handled = toggleSelectedTextStyle('italic');
    } else if (!ctrlOrMeta && !event.altKey && (key === 'Delete' || key === 'Backspace')) {
      if (selectedDraftElement()) {
        removeDraftElement();
        handled = true;
      } else if (selectedDraftGuide()) {
        if (state.draftGuidesLocked) {
          showToast('Unlock guides first to remove them.', 'warning');
          handled = true;
        } else {
          handled = removeDraftGuideById(state.draftSelectedGuideId);
        }
      }
    } else if (!ctrlOrMeta && !event.altKey && key.indexOf('Arrow') === 0) {
      var step = event.shiftKey ? 10 : 1;
      if (key === 'ArrowLeft') {
        handled = nudgeSelectedDraftElement(-step, 0);
      } else if (key === 'ArrowRight') {
        handled = nudgeSelectedDraftElement(step, 0);
      } else if (key === 'ArrowUp') {
        handled = nudgeSelectedDraftElement(0, -step);
      } else if (key === 'ArrowDown') {
        handled = nudgeSelectedDraftElement(0, step);
      }
    } else if (!ctrlOrMeta && !event.altKey && lower === 'p') {
      handled = alignSelectedDraftElements('canvas-center');
    } else if (!ctrlOrMeta && !event.altKey && lower === 'e') {
      handled = alignSelectedDraftElements('align-v-center');
    } else if (!ctrlOrMeta && !event.altKey && lower === 'c') {
      handled = alignSelectedDraftElements('align-h-center');
    } else if (!ctrlOrMeta && !event.altKey && lower === 'l') {
      handled = alignSelectedDraftElements('align-left');
    } else if (!ctrlOrMeta && !event.altKey && lower === 'r') {
      handled = alignSelectedDraftElements('align-right');
    } else if (!ctrlOrMeta && !event.altKey && lower === 't') {
      handled = alignSelectedDraftElements('align-top');
    } else if (!ctrlOrMeta && !event.altKey && lower === 'b') {
      handled = alignSelectedDraftElements('align-bottom');
    } else if (!ctrlOrMeta && !event.altKey && key === 'Escape') {
      state.draftDragging = null;
      state.draftResizeDragging = null;
      state.draftGuideDragging = null;
      state.draftTextDrag = null;
      state.draftRectDrag = null;
      state.draftSelectDrag = null;
      if (state.draftInlineEditHistoryActive) {
        endDraftHistoryTransaction();
        state.draftInlineEditHistoryActive = false;
      }
      endDraftHistoryTransaction();
      clearDraftInlineTextEditing();
      state.draftTool = 'select';
      handled = true;
    } else if (ctrlOrMeta && !event.altKey && lower === 'd') {
      handled = duplicateSelectedDraftElement();
    } else if (ctrlOrMeta && !event.altKey && lower === 's') {
      triggerSaveDraftTemplate();
      handled = true;
    } else if (ctrlOrMeta && !event.altKey && (key === '+' || key === '=')) {
      setDraftZoomWithAnchor(Number(state.draftZoom || 1) + 0.1, null);
      handled = true;
    } else if (ctrlOrMeta && !event.altKey && (key === '-' || key === '_')) {
      setDraftZoomWithAnchor(Number(state.draftZoom || 1) - 0.1, null);
      handled = true;
    } else if (ctrlOrMeta && !event.altKey && lower === '0') {
      setDraftZoomWithAnchor(1, null);
      handled = true;
    }

    if (!handled) {
      return;
    }

    event.preventDefault();
    render();
  });

  window.addEventListener('keyup', function (event) {
    if (!isStep2EditorActive()) {
      return;
    }

    var key = String(event.key || '');
    if (key !== ' ' && key !== 'Spacebar') {
      return;
    }

    if (state.spacePanMode || state.spacePanState) {
      state.spacePanMode = false;
      state.spacePanState = null;
      setSpacePanUiState();
    }
    event.preventDefault();
  });

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

    if (target.id === 'gcDraftCanvasWidthCenterInput') {
      var widthRaw = Number(target.value || 0);
      var widthValue = unitValueToCanvas(widthRaw, 'x');
      var real = draftRealDimensionsMm();
      var widthMm = unitValueToMm(widthRaw);
      if (Number.isFinite(widthMm) && widthMm > 0) {
        real.widthMm = widthMm;
      }
      updateDraftCanvasSize(widthValue, draftCanvasMetrics().height, real);
      render();
      return;
    }

    if (target.id === 'gcDraftCanvasHeightCenterInput') {
      var heightRaw = Number(target.value || 0);
      var heightValue = unitValueToCanvas(heightRaw, 'y');
      var realSize = draftRealDimensionsMm();
      var heightMm = unitValueToMm(heightRaw);
      if (Number.isFinite(heightMm) && heightMm > 0) {
        realSize.heightMm = heightMm;
      }
      updateDraftCanvasSize(draftCanvasMetrics().width, heightValue, realSize);
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
      updateSelectedDraftElement({ width: unitValueToCanvas(Number(target.value || 0), 'x') });
      render();
      return;
    }

    if (target.id === 'gcDraftHInput') {
      updateSelectedDraftElement({ height: unitValueToCanvas(Number(target.value || 0), 'y') });
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
      triggerSaveDraftTemplate();
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