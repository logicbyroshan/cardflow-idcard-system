(function () {
  'use strict';

  var TABLE_ID = Number(window.TABLE_ID || 0);
  var modalEl = document.getElementById('gcEditorModal');
  var flowRoot = document.getElementById('gcSimpleFlowRoot');
  var alertBar = document.getElementById('gcEditorAlertBar');
  var stepCounterEl = document.getElementById('gcStepCounter');

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
    cards: [],
    selectedRequestIds: new Set(),
    lastPdfBlob: null,
    lastPdfName: 'cards.pdf',
  };

  function ensureStyles() {
    if (document.getElementById('gcThreeStepStyles')) {
      return;
    }

    var style = document.createElement('style');
    style.id = 'gcThreeStepStyles';
    style.textContent = ''
      + '.gc-flow-box{max-width:1200px;width:92vw;height:88vh;}'
      + '.gc-flow-header{justify-content:space-between;}'
      + '.gc-flow-header-left{display:flex;align-items:center;gap:10px;min-width:0;}'
      + '.gc-step-pill{display:inline-flex;align-items:center;justify-content:center;padding:4px 10px;border-radius:999px;background:#e0e7ff;color:#1e3a8a;font-size:11px;font-weight:700;white-space:nowrap;}'
      + '.gc-simple-flow-root{height:100%;display:flex;flex-direction:column;background:#f8fafc;}'
      + '.gc-shell{height:100%;display:flex;flex-direction:column;padding:14px;gap:12px;}'
      + '.gc-progress{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}'
      + '.gc-progress-item{display:flex;align-items:center;gap:8px;border:1px solid #d1d5db;background:#ffffff;border-radius:10px;padding:8px 10px;font-size:12px;color:#4b5563;}'
      + '.gc-progress-num{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#e5e7eb;color:#374151;font-size:11px;font-weight:700;flex:0 0 22px;}'
      + '.gc-progress-item.is-active{border-color:#60a5fa;background:#eff6ff;color:#1e3a8a;}'
      + '.gc-progress-item.is-active .gc-progress-num{background:#2563eb;color:#ffffff;}'
      + '.gc-progress-item.is-done{border-color:#86efac;background:#ecfdf5;color:#166534;}'
      + '.gc-progress-item.is-done .gc-progress-num{background:#16a34a;color:#ffffff;}'
      + '.gc-step-panel{flex:1;min-height:0;border:1px solid #dbe2ea;background:#ffffff;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px;overflow:auto;}'
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
      + '.gc-preview-box iframe{width:100%;height:100%;border:0;display:block;}'
      + '.gc-preview-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;padding:10px;text-align:center;}'
      + '.gc-template-overlay{position:absolute;inset:0;pointer-events:none;}'
      + '.gc-template-el{position:absolute;border:1px dashed rgba(37,99,235,0.8);background:rgba(37,99,235,0.12);color:#1d4ed8;font-size:10px;font-weight:700;padding:2px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.gc-template-empty{font-size:12px;color:#64748b;border:1px dashed #cbd5e1;border-radius:8px;background:#f8fafc;padding:10px;}'
      + '.gc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
      + '.gc-row label{font-size:12px;font-weight:700;color:#334155;}'
      + '.gc-select{height:34px;border:1px solid #cbd5e1;border-radius:8px;background:#ffffff;padding:0 10px;font-size:12px;min-width:260px;}'
      + '.gc-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;}'
      + '.gc-summary-item{border:1px solid #dbe2ea;border-radius:10px;background:#f8fafc;padding:10px;}'
      + '.gc-summary-label{font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.04em;}'
      + '.gc-summary-value{font-size:14px;color:#0f172a;font-weight:700;margin-top:4px;}'
      + '.gc-actions{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;}'
      + '.gc-actions-right{display:flex;gap:8px;flex-wrap:wrap;}'
      + '.gc-loading{position:absolute;inset:0;background:rgba(248,250,252,0.72);display:flex;align-items:center;justify-content:center;z-index:2;}'
      + '.gc-loading-box{display:flex;align-items:center;gap:8px;background:#ffffff;border:1px solid #dbe2ea;border-radius:10px;padding:10px 12px;font-size:12px;font-weight:700;color:#334155;}'
      + '.gc-spinner{width:15px;height:15px;border:2px solid #bfdbfe;border-top-color:#2563eb;border-radius:50%;animation:gcSpin .8s linear infinite;}'
      + '@keyframes gcSpin{to{transform:rotate(360deg);}}'
      + '@media (max-width:900px){.gc-flow-box{width:96vw;height:92vh;}.gc-shell{padding:10px;}.gc-step-panel{padding:12px;}.gc-select{min-width:100%;}}';

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
    if (!alertBar) {
      return;
    }

    if (!message) {
      alertBar.classList.add('hidden');
      alertBar.classList.remove('gc-alert-error');
      alertBar.classList.remove('gc-alert-warning');
      alertBar.textContent = '';
      return;
    }

    alertBar.textContent = String(message);
    alertBar.classList.remove('hidden');
    alertBar.classList.remove('gc-alert-error');
    alertBar.classList.remove('gc-alert-warning');
    alertBar.classList.add(kind === 'error' ? 'gc-alert-error' : 'gc-alert-warning');
  }

  function setStepCounter() {
    if (!stepCounterEl) {
      return;
    }
    stepCounterEl.textContent = 'Step ' + String(state.step) + ' / 3';
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
      },
      elements: [],
    };
  }

  function currentTemplateJson() {
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

      return '<div class="gc-template-el" style="left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%;">'
        + escapeHtml(label) + '</div>';
    });

    if (!rows.length) {
      return '<div class="gc-preview-empty">No template elements on this side</div>';
    }

    return rows.join('');
  }

  function step1Valid() {
    if (!state.frontFile) {
      return false;
    }
    if (state.isTwoSided && !state.backFile) {
      return false;
    }
    return true;
  }

  function step2Valid() {
    return !!(state.selectedTemplate && state.selectedTemplate.id);
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

  function renderPdfPreview(title, side, withOverlay) {
    var source = side === 'back' ? state.backPreviewUrl : state.frontPreviewUrl;
    var hasPdf = !!source;
    var frameHtml = hasPdf
      ? '<iframe src="' + escapeAttr(source) + '#toolbar=0&navpanes=0&scrollbar=0"></iframe>'
      : '<div class="gc-preview-empty">Upload ' + escapeHtml(side) + ' design PDF to preview</div>';

    var overlayHtml = withOverlay && hasPdf
      ? '<div class="gc-template-overlay">' + buildOverlayHtml(side) + '</div>'
      : '';

    return '<div class="gc-preview-card">'
      + '<div class="gc-preview-head"><span>' + escapeHtml(title) + '</span></div>'
      + '<div class="gc-preview-box">'
      + frameHtml
      + overlayHtml
      + '</div>'
      + '</div>';
  }

  function renderStep1() {
    var frontName = state.frontFile ? state.frontFile.name : 'No file selected';
    var backName = state.backFile ? state.backFile.name : 'No file selected';
    var nextDisabled = step1Valid() ? '' : ' disabled';

    return '<div class="gc-step-panel">'
      + '<h3 class="gc-step-title">Step 1: Card Setup and PDF Upload</h3>'
      + '<p class="gc-step-subtitle">Choose card type, choose side count, and upload design PDF files.</p>'
      + '<div class="gc-row"><label>Card Type</label></div>'
      + '<div class="gc-choice-row">'
      + '<button type="button" class="gc-choice-btn' + (state.orientation === 'landscape' ? ' is-active' : '') + '" data-action="set-orientation" data-value="landscape">Horizontal</button>'
      + '<button type="button" class="gc-choice-btn' + (state.orientation === 'portrait' ? ' is-active' : '') + '" data-action="set-orientation" data-value="portrait">Vertical</button>'
      + '</div>'
      + '<div class="gc-row"><label>Card Sides</label></div>'
      + '<div class="gc-choice-row">'
      + '<button type="button" class="gc-choice-btn' + (!state.isTwoSided ? ' is-active' : '') + '" data-action="set-sides" data-value="single">1 Sided</button>'
      + '<button type="button" class="gc-choice-btn' + (state.isTwoSided ? ' is-active' : '') + '" data-action="set-sides" data-value="double">2 Sided</button>'
      + '</div>'
      + '<div class="gc-upload-grid">'
      + '<div class="gc-upload-card">'
      + '<label for="gcFrontPdfInput">Upload Front PDF</label>'
      + '<input id="gcFrontPdfInput" type="file" accept="application/pdf,.pdf">'
      + '<div class="gc-file-note">Front: ' + escapeHtml(frontName) + '</div>'
      + '</div>'
      + (state.isTwoSided
        ? '<div class="gc-upload-card">'
          + '<label for="gcBackPdfInput">Upload Back PDF</label>'
          + '<input id="gcBackPdfInput" type="file" accept="application/pdf,.pdf">'
          + '<div class="gc-file-note">Back: ' + escapeHtml(backName) + '</div>'
          + '</div>'
        : '')
      + '</div>'
      + '<div class="gc-preview-grid">'
      + renderPdfPreview('Front Preview', 'front', false)
      + (state.isTwoSided ? renderPdfPreview('Back Preview', 'back', false) : '')
      + '</div>'
      + '<div class="gc-actions">'
      + '<span class="gc-step-subtitle">Selected cards: ' + selectedCardCount() + '</span>'
      + '<div class="gc-actions-right">'
      + '<button type="button" class="btn btn-blue" data-action="next-step"' + nextDisabled + '>Next</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function renderTemplateOptions() {
    if (!state.templates.length) {
      return '<option value="">No templates available</option>';
    }

    return state.templates.map(function (item) {
      var id = Number(item.id || 0);
      var isSelected = Number(state.selectedTemplateId || 0) === id;
      var title = String(item.name || ('Template #' + id));
      return '<option value="' + id + '"' + (isSelected ? ' selected' : '') + '>' + escapeHtml(title) + '</option>';
    }).join('');
  }

  function renderStep2() {
    var nextDisabled = step2Valid() ? '' : ' disabled';
    var templateName = state.selectedTemplate ? String(state.selectedTemplate.name || '') : '';
    var templateVersion = state.selectedTemplate ? Number(state.selectedTemplate.version || 1) : 1;

    return '<div class="gc-step-panel">'
      + '<h3 class="gc-step-title">Step 2: Select Template</h3>'
      + '<p class="gc-step-subtitle">Choose template and preview it on top of your uploaded PDF design.</p>'
      + '<div class="gc-row">'
      + '<label for="gcTemplateSelect">Template</label>'
      + '<select id="gcTemplateSelect" class="gc-select">'
      + renderTemplateOptions()
      + '</select>'
      + '<button type="button" class="btn btn-outline" data-action="reload-templates">Refresh</button>'
      + '</div>'
      + (state.selectedTemplate
        ? '<div class="gc-template-empty">Using: <strong>' + escapeHtml(templateName) + '</strong> (Version ' + templateVersion + ')</div>'
        : '<div class="gc-template-empty">Please select a template to continue.</div>')
      + '<div class="gc-preview-grid">'
      + renderPdfPreview('Front + Template', 'front', true)
      + (state.isTwoSided ? renderPdfPreview('Back + Template', 'back', true) : '')
      + '</div>'
      + '<div class="gc-actions">'
      + '<button type="button" class="btn btn-outline" data-action="prev-step">Back</button>'
      + '<div class="gc-actions-right">'
      + '<button type="button" class="btn btn-blue" data-action="next-step"' + nextDisabled + '>Next</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function renderStep3() {
    var generateDisabled = (state.generating || !step1Valid() || !step2Valid() || selectedCardCount() <= 0) ? ' disabled' : '';
    var orientationText = state.orientation === 'portrait' ? 'Vertical' : 'Horizontal';
    var sideText = state.isTwoSided ? '2 Sided' : '1 Sided';
    var templateText = state.selectedTemplate ? String(state.selectedTemplate.name || ('Template #' + state.selectedTemplate.id)) : 'Not selected';

    return '<div class="gc-step-panel">'
      + '<h3 class="gc-step-title">Step 3: Generate All Cards</h3>'
      + '<p class="gc-step-subtitle">Review summary and generate cards for the selected list.</p>'
      + '<div class="gc-summary">'
      + '<div class="gc-summary-item"><div class="gc-summary-label">Orientation</div><div class="gc-summary-value">' + escapeHtml(orientationText) + '</div></div>'
      + '<div class="gc-summary-item"><div class="gc-summary-label">Sides</div><div class="gc-summary-value">' + escapeHtml(sideText) + '</div></div>'
      + '<div class="gc-summary-item"><div class="gc-summary-label">Template</div><div class="gc-summary-value">' + escapeHtml(templateText) + '</div></div>'
      + '<div class="gc-summary-item"><div class="gc-summary-label">Cards to Generate</div><div class="gc-summary-value">' + selectedCardCount() + '</div></div>'
      + '</div>'
      + '<div class="gc-preview-grid">'
      + renderPdfPreview('Final Front Preview', 'front', true)
      + (state.isTwoSided ? renderPdfPreview('Final Back Preview', 'back', true) : '')
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
      + '<div class="gc-progress">'
      + renderProgressItem(1, 'Setup')
      + renderProgressItem(2, 'Template')
      + renderProgressItem(3, 'Generate')
      + '</div>'
      + panelHtml
      + (state.loading ? '<div class="gc-loading"><div class="gc-loading-box"><span class="gc-spinner"></span><span>Loading...</span></div></div>' : '')
      + '</div>';
  }

  function parseInitialConfig() {
    var templateData = window.TEMPLATE_DATA && typeof window.TEMPLATE_DATA === 'object' ? window.TEMPLATE_DATA : null;
    state.orientation = normalizeOrientation(templateData && templateData.card_orientation ? templateData.card_orientation : 'landscape');
    state.isTwoSided = !!(templateData && templateData.is_two_sided);
    state.frontPreviewUrl = String(window.FRONT_PDF_URL || '');
    state.backPreviewUrl = String(window.BACK_PDF_URL || '');
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
      return;
    }

    var detail = await requestJson('GET', templateDetailPath(id));
    state.selectedTemplateId = id;
    state.selectedTemplate = detail.template || null;
  }

  function bestTemplateId() {
    var existing = Number(window.TEMPLATE_DATA && window.TEMPLATE_DATA.id ? window.TEMPLATE_DATA.id : 0);
    if (existing) {
      return existing;
    }

    var defaultTemplate = (state.templates || []).find(function (item) {
      return !!(item && item.is_default);
    });
    if (defaultTemplate && defaultTemplate.id) {
      return Number(defaultTemplate.id);
    }

    return state.templates.length ? Number(state.templates[0].id || 0) : 0;
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
    if (state.step === 1 && !step1Valid()) {
      setAlert('Please choose card setup and upload required PDF files.', 'error');
      return;
    }
    if (state.step === 2 && !step2Valid()) {
      setAlert('Please select a template first.', 'error');
      return;
    }
    state.step = Math.min(3, state.step + 1);
    setAlert('', 'warning');
    render();
  }

  function handleStepBack() {
    state.step = Math.max(1, state.step - 1);
    setAlert('', 'warning');
    render();
  }

  async function createWorkingTemplate() {
    if (!state.selectedTemplate || !state.selectedTemplate.id) {
      throw new Error('Please select a template first.');
    }

    var baseTemplate = state.selectedTemplate;
    var payload = {
      name: String(baseTemplate.name || 'Template').slice(0, 120),
      is_two_sided: !!state.isTwoSided,
      card_orientation: normalizeOrientation(state.orientation),
      template_json: baseTemplate.template_json || defaultTemplateJson(),
      font_size: Number(baseTemplate.font_size || 11),
      font_family: String(baseTemplate.font_family || 'Arial'),
      template_id: Number(baseTemplate.id),
      is_default: true,
    };

    if (baseTemplate.field_mappings && typeof baseTemplate.field_mappings === 'object') {
      payload.field_mappings = baseTemplate.field_mappings;
    }

    var saveResult = await requestJson('PUT', templatesPath(baseTemplate.id), payload);
    var savedTemplate = saveResult && saveResult.template ? saveResult.template : null;
    if (!savedTemplate || !savedTemplate.id) {
      throw new Error('Unable to save template settings.');
    }

    await requestJson('POST', templateSetDefaultPath(savedTemplate.id), {});
    await selectTemplate(savedTemplate.id);

    return state.selectedTemplate;
  }

  async function uploadDesignPdfs() {
    if (!state.frontFile) {
      throw new Error('Front PDF is required.');
    }

    var frontForm = new FormData();
    frontForm.append('pdf', state.frontFile, state.frontFile.name);
    await requestForm(uploadPdfPath('front'), frontForm);

    if (state.isTwoSided) {
      if (!state.backFile) {
        throw new Error('Back PDF is required for 2 sided cards.');
      }
      var backForm = new FormData();
      backForm.append('pdf', state.backFile, state.backFile.name);
      await requestForm(uploadPdfPath('back'), backForm);
    }
  }

  async function handleGenerateAll() {
    if (state.generating) {
      return;
    }
    if (!step1Valid()) {
      setAlert('Please complete Step 1 before generating.', 'error');
      state.step = 1;
      render();
      return;
    }
    if (!step2Valid()) {
      setAlert('Please complete Step 2 before generating.', 'error');
      state.step = 2;
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
      setAlert('Preparing template and uploading PDFs...', 'warning');
      var workingTemplate = await createWorkingTemplate();
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
    parseInitialConfig();
    setAlert('', 'warning');
    state.step = 1;
    state.loading = true;
    render();

    try {
      await Promise.all([loadCards(), loadTemplates()]);

      var preferredTemplateId = bestTemplateId();
      if (preferredTemplateId) {
        await selectTemplate(preferredTemplateId);
      } else {
        state.selectedTemplateId = null;
        state.selectedTemplate = null;
      }
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
      if (!state.isTwoSided) {
        state.backFile = null;
        revokeLocalPreview('back');
        state.backPreviewUrl = '';
      }
      render();
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
          if (!state.selectedTemplateId && state.templates.length) {
            return selectTemplate(state.templates[0].id);
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

    if (action === 'generate-all') {
      handleGenerateAll();
    }
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

    if (target.id === 'gcTemplateSelect') {
      var templateId = Number(target.value || 0);
      if (!templateId) {
        state.selectedTemplateId = null;
        state.selectedTemplate = null;
        render();
        return;
      }

      state.loading = true;
      render();
      selectTemplate(templateId)
        .then(function () {
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
    }
  });

  window.gcEditorRefresh = function () {
    return refreshModalData();
  };

  window.gcEditorBeforeClose = function () {
    setAlert('', 'warning');
    resetTransientState();
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
  parseInitialConfig();
  render();
})();