(function () {
  'use strict';

  var TABLE_ID = Number(window.TABLE_ID || 0);
  var modalEl = document.getElementById('gcEditorModal');
  var flowRoot = document.getElementById('gcSimpleFlowRoot');
  var alertBar = document.getElementById('gcEditorAlertBar');
  var stepCounterEl = document.getElementById('gcStepCounter');
  var headerStepperEl = document.getElementById('gcHeaderStepper');

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
    draftSelectedGuideId: '',
    draftActiveSide: 'front',
    draftTool: 'select',
    draftDragging: null,
    draftGuideDragging: null,
    draftTextDrag: null,
    draftSuppressTextClick: false,
    draftZoom: 1,
    draftUnit: 'px',
    draftDirty: false,
    cards: [],
    selectedRequestIds: new Set(),
    lastPdfBlob: null,
    lastPdfName: 'cards.pdf',
  };
  var pdfJsLoadPromise = null;
  var draftElementSeed = 1;
  var draftGuideSeed = 1;

  function ensureStyles() {
    if (document.getElementById('gcThreeStepStyles')) {
      return;
    }

    var style = document.createElement('style');
    style.id = 'gcThreeStepStyles';
    style.textContent = ''
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
      + '.gc-step2-tools{border:1px solid #dbe2ea;border-radius:4px;background:#ffffff;padding:6px 4px;display:flex;flex-direction:column;gap:6px;align-items:stretch;}'
      + '.gc-step2-tool-btn{height:52px;border:1px solid #cbd5e1;border-radius:4px;background:#f8fafc;color:#334155;font-size:10px;font-weight:700;line-height:1.15;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;}'
      + '.gc-step2-tool-btn i{font-size:13px;}'
      + '.gc-step2-tool-btn.is-active{background:#eff6ff;border-color:#3b82f6;color:#1d4ed8;}'
      + '.gc-step2-canvas-shell{display:flex;flex-direction:column;min-height:0;border:1px solid #dbe2ea;border-radius:4px;background:#ffffff;overflow:hidden;}'
      + '.gc-step2-canvas-head{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid #e2e8f0;background:#f8fbff;}'
      + '.gc-step2-canvas-head .gc-inline-label{font-size:10px;}'
      + '.gc-step2-center-controls{display:flex;align-items:center;gap:6px;justify-self:center;flex-wrap:wrap;}'
      + '.gc-step2-zoom-range{width:120px;accent-color:#2563eb;}'
      + '.gc-step2-zoom-pill{font-size:10px;font-weight:800;color:#1e3a8a;background:#e0e7ff;border:1px solid #bfdbfe;border-radius:999px;padding:2px 7px;line-height:1.2;min-width:52px;text-align:center;}'
      + '.gc-step2-unit-select{height:28px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;padding:0 8px;font-size:11px;color:#0f172a;}'
      + '.gc-step2-size-controls{display:flex;align-items:center;gap:4px;}'
      + '.gc-step2-size-label{font-size:10px;font-weight:700;color:#334155;}'
      + '.gc-step2-size-input{height:28px;width:64px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;padding:0 6px;font-size:11px;color:#0f172a;}'
      + '.gc-step2-side-switch{display:flex;align-items:center;gap:6px;}'
      + '.gc-step2-side-switch .gc-choice-btn{height:28px;padding:0 10px;border-radius:4px;font-size:11px;}'
      + '.gc-step2-canvas-stage{position:relative;flex:1;min-height:360px;background:#d6dde7;overflow:hidden;}'
      + '.gc-step2-stage-content{position:absolute;top:20px;left:20px;right:0;bottom:0;display:flex;align-items:center;justify-content:center;overflow:auto;padding:18px;}'
      + '.gc-step2-canvas-wrap{position:relative;display:block;flex:0 0 auto;transform-origin:top left;}'
      + '.gc-step2-ruler-corner{position:absolute;top:0;left:0;width:20px;height:20px;border:1px solid #aeb7c4;background:#d6dde7;z-index:3;}'
      + '.gc-step2-ruler-top{position:absolute;top:0;left:20px;right:0;height:20px;border:1px solid #aeb7c4;background-color:#d6dde7;background-image:repeating-linear-gradient(to right,rgba(100,116,139,.26) 0,rgba(100,116,139,.26) 1px,transparent 1px,transparent 8px),repeating-linear-gradient(to right,rgba(30,41,59,.36) 0,rgba(30,41,59,.36) 1px,transparent 1px,transparent 40px);cursor:ns-resize;z-index:2;}'
      + '.gc-step2-ruler-left{position:absolute;top:20px;left:0;bottom:0;width:20px;border:1px solid #aeb7c4;background-color:#d6dde7;background-image:repeating-linear-gradient(to bottom,rgba(100,116,139,.26) 0,rgba(100,116,139,.26) 1px,transparent 1px,transparent 8px),repeating-linear-gradient(to bottom,rgba(30,41,59,.36) 0,rgba(30,41,59,.36) 1px,transparent 1px,transparent 40px);cursor:ew-resize;z-index:2;}'
      + '.gc-step2-guide-layer{position:absolute;inset:0;pointer-events:none;z-index:2;}'
      + '.gc-step2-guide-layer .gc-draft-guide{pointer-events:auto;}'
      + '.gc-step2-canvas{position:relative;width:100%;height:100%;background:#ffffff;border:1px solid #b8c1cc;border-radius:2px;box-shadow:8px 8px 0 rgba(15,23,42,0.12);}'
      + '.gc-step2-canvas.is-text-mode{cursor:text;}'
      + '.gc-step2-canvas.is-photo-mode{cursor:crosshair;}'
      + '.gc-step2-canvas-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;font-weight:600;pointer-events:none;padding:10px;text-align:center;}'
      + '.gc-draft-el{position:absolute;display:flex;align-items:center;justify-content:center;padding:2px 4px;border:1px dashed #2563eb;background:rgba(37,99,235,0.13);color:#1d4ed8;font-size:10px;font-weight:700;text-align:center;line-height:1.2;border-radius:2px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;}'
      + '.gc-draft-el.gc-draft-el-text{background:transparent;border:1px dashed transparent;color:#0f172a;}'
      + '.gc-draft-el.gc-draft-el-text:hover{border-color:rgba(37,99,235,0.45);background:rgba(59,130,246,0.08);}'
      + '.gc-draft-el.gc-draft-el-artistic{white-space:nowrap;align-items:center;}'
      + '.gc-draft-el.gc-draft-el-paragraph{white-space:normal;align-items:flex-start;padding-top:4px;}'
      + '.gc-draft-el.gc-draft-el-photo{border-style:solid;border-color:#0ea5e9;background:rgba(14,165,233,0.14);color:#0369a1;}'
      + '.gc-draft-el.is-selected{border:1px solid #1d4ed8;background:rgba(59,130,246,0.22);box-shadow:0 0 0 1px rgba(37,99,235,0.25) inset;}'
      + '.gc-draft-el.gc-draft-el-text.is-selected{background:transparent;}'
      + '.gc-draft-guide{position:absolute;border:0;background:transparent;z-index:2;cursor:pointer;}'
      + '.gc-draft-guide.is-vertical{width:14px;transform:translateX(-7px);}'
      + '.gc-draft-guide.is-horizontal{height:14px;transform:translateY(-7px);}'
      + '.gc-draft-guide::before{content:"";position:absolute;background:#0ea5e9;opacity:.75;}'
      + '.gc-draft-guide.is-vertical::before{left:6px;top:0;width:2px;height:100%;}'
      + '.gc-draft-guide.is-horizontal::before{left:0;top:6px;width:100%;height:2px;}'
      + '.gc-draft-guide.is-selected::before{background:#0284c7;opacity:1;box-shadow:0 0 0 1px rgba(2,132,199,0.35);}'
      + '.gc-draft-insert-guide{position:absolute;border:1px dashed #0f766e;background:rgba(45,212,191,0.18);pointer-events:none;z-index:2;}'
      + '.gc-step2-props{border:1px solid #dbe2ea;border-radius:4px;background:#ffffff;padding:8px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;}'
      + '.gc-prop-section-title{font-size:10px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:.05em;margin:2px 0;}'
      + '.gc-prop-group{display:flex;flex-direction:column;gap:4px;}'
      + '.gc-prop-group label{font-size:11px;font-weight:700;color:#334155;}'
      + '.gc-prop-input,.gc-prop-select{height:30px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;padding:0 8px;font-size:11px;color:#0f172a;}'
      + '.gc-prop-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}'
      + '.gc-prop-note{font-size:11px;color:#64748b;line-height:1.35;}'
      + '.gc-prop-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}'
      + '.gc-prop-actions .btn{height:28px;padding:0 8px;font-size:11px;line-height:1;}'
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
      + '@media (max-width:860px){.gc-step1-upload-row{grid-template-columns:1fr;}.gc-upload-input-wrap{flex-wrap:wrap;}.gc-inline-controls{gap:8px;}.gc-step1-topbar{align-items:flex-start;}.gc-inline-control-block.gc-inline-template-block{min-width:100%;}.gc-inline-template-row .gc-select{min-width:0;max-width:none;flex:1;}.gc-step2-main{grid-template-columns:1fr;}.gc-step2-tools{flex-direction:row;padding:6px;justify-content:space-between;}.gc-step2-tool-btn{flex:1;height:44px;}.gc-step2-canvas-head{grid-template-columns:1fr;}.gc-step2-center-controls{justify-self:stretch;justify-content:flex-start;}.gc-step2-zoom-range{width:100px;}.gc-step2-size-input{width:58px;}.gc-step2-canvas-stage{min-height:240px;padding:10px;}.gc-step2-props{order:2;}.gc-step-panel-step3 .gc-preview-box.gc-mm-landscape{width:min(100%,340px);}.gc-step-panel-step3 .gc-preview-box.gc-mm-portrait{width:min(100%,220px);}.gc-step3-summary{grid-template-columns:1fr 1fr;}.gc-actions{justify-content:center;}}';

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
    stepCounterEl.textContent = 'Step ' + String(state.step) + ' of 3';

    if (!headerStepperEl) {
      return;
    }

    var stepNodes = headerStepperEl.querySelectorAll('[data-step]');
    Array.prototype.forEach.call(stepNodes, function (node) {
      var stepNum = Number(node.getAttribute('data-step') || 0);
      var isActive = stepNum === state.step;
      var isDone = stepNum > 0 && stepNum < state.step;
      node.classList.toggle('is-active', isActive);
      node.classList.toggle('is-done', isDone);
    });
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
    state.draftSelectedGuideId = '';
    state.draftActiveSide = 'front';
    state.draftTool = 'select';
    state.draftDragging = null;
    state.draftGuideDragging = null;
    state.draftTextDrag = null;
    state.draftSuppressTextClick = false;
    state.draftZoom = 1;
    state.draftUnit = 'px';
    state.draftDirty = false;
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

  function draftRealDimensionsMm() {
    var tpl = currentTemplateJson();
    var canvas = tpl && tpl.canvas && typeof tpl.canvas === 'object' ? tpl.canvas : {};
    var widthMm = Number(canvas.realWidthMM || (state.orientation === 'portrait' ? 54 : 85.6));
    var heightMm = Number(canvas.realHeightMM || (state.orientation === 'portrait' ? 85.6 : 54));

    if (!Number.isFinite(widthMm) || widthMm <= 0) {
      widthMm = state.orientation === 'portrait' ? 54 : 85.6;
    }
    if (!Number.isFinite(heightMm) || heightMm <= 0) {
      heightMm = state.orientation === 'portrait' ? 85.6 : 54;
    }

    return { widthMm: widthMm, heightMm: heightMm };
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
    var min = -span;
    var max = span * 2;
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
    var normalized = normalizeDraftGuide({ id: target.id, axis: target.axis, pos: pos });
    target.pos = normalized.pos;
    markDraftDirty();
    return true;
  }

  function removeDraftGuideById(id) {
    var guides = draftGuides();
    var before = guides.length;
    var wanted = String(id || '');
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

    return guides.map(function (guide) {
      var isVertical = guide.axis === 'x';
      var ratio = Number(guide.pos || 0) / (isVertical ? Math.max(1, metrics.width) : Math.max(1, metrics.height));
      var posPx = ratio * (isVertical ? canvasWidth : canvasHeight);
      var cls = 'gc-draft-guide ' + (isVertical ? 'is-vertical' : 'is-horizontal')
        + (String(guide.id || '') === state.draftSelectedGuideId ? ' is-selected' : '');
      var style = isVertical
        ? 'left:' + String(canvasLeft + posPx) + 'px;top:' + String(outside ? 0 : canvasTop) + 'px;height:' + String(outside ? layerHeight : canvasHeight) + 'px;'
        : 'top:' + String(canvasTop + posPx) + 'px;left:' + String(outside ? 0 : canvasLeft) + 'px;width:' + String(outside ? layerWidth : canvasWidth) + 'px;';

      return '<button type="button" class="' + cls + '" data-action="select-draft-guide" data-guide-id="' + escapeAttr(String(guide.id || '')) + '" style="' + style + '"></button>';
    }).join('');
  }

  function currentDraftUnit() {
    var unit = String(state.draftUnit || 'px').toLowerCase();
    if (unit !== 'px' && unit !== 'mm' && unit !== 'cm' && unit !== 'in') {
      unit = 'px';
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
    if (unit === 'px') {
      return v;
    }

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
    if (unit === 'px') {
      return v;
    }

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

  function formatDraftMeasure(value, axis) {
    var converted = canvasValueToUnit(value, axis);
    if (currentDraftUnit() === 'px') {
      return String(Math.round(converted));
    }
    return String(Math.round(converted * 100) / 100);
  }

  function nextDraftElementId() {
    draftElementSeed += 1;
    return 'd' + String(Date.now()) + '_' + String(draftElementSeed);
  }

  function normalizeDraftElement(raw, idx) {
    var metrics = draftCanvasMetrics();
    var item = raw && typeof raw === 'object' ? raw : {};
    var width = Number(item.width || 90);
    var height = Number(item.height || 24);
    var x = Number(item.x || 16);
    var y = Number(item.y || (16 + (idx * 12)));

    if (!Number.isFinite(width) || width <= 0) width = 90;
    if (!Number.isFinite(height) || height <= 0) height = 24;
    if (!Number.isFinite(x)) x = 16;
    if (!Number.isFinite(y)) y = 16;

    width = Math.max(12, Math.min(metrics.width, width));
    height = Math.max(12, Math.min(metrics.height, height));
    x = Math.max(0, Math.min(metrics.width - width, x));
    y = Math.max(0, Math.min(metrics.height - height, y));

    var side = String(item.side || 'front').toLowerCase();
    if (side !== 'front' && side !== 'back' && side !== 'both') {
      side = 'front';
    }

    var type = String(item.type || 'text').toLowerCase();
    if (type !== 'text' && type !== 'image') {
      type = 'text';
    }

    var fontSize = Number(item.fontSize || 11);
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
      fontSize = 11;
    }
    fontSize = Math.max(6, Math.min(72, fontSize));

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

    var fontFamily = String(item.fontFamily || 'Arial').slice(0, 80);
    var fontWeight = String(item.fontWeight || '600');
    if (['300', '400', '500', '600', '700', '800', 'normal', 'bold'].indexOf(fontWeight) === -1) {
      fontWeight = '600';
    }

    var textAlign = String(item.textAlign || 'center').toLowerCase();
    if (textAlign !== 'left' && textAlign !== 'center' && textAlign !== 'right') {
      textAlign = 'center';
    }

    var color = String(item.color || '#1e293b').slice(0, 20);
    var textMode = String(item.textMode || 'artistic').toLowerCase();
    if (textMode !== 'artistic' && textMode !== 'paragraph') {
      textMode = 'artistic';
    }

    return {
      __id: item.__id || nextDraftElementId(),
      type: type,
      field: String(item.field || ''),
      label: String(item.label || (type === 'image' ? 'Image' : 'Text')),
      side: side,
      x: x,
      y: y,
      width: width,
      height: height,
      fontSize: fontSize,
      fontFamily: fontFamily,
      lineHeight: lineHeight,
      fontWeight: fontWeight,
      textAlign: textAlign,
      letterSpacing: letterSpacing,
      color: color,
      textMode: type === 'text' ? textMode : '',
      imageKind: type === 'image' ? String(item.imageKind || '') : '',
    };
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
    state.draftSelectedGuideId = '';
    state.draftActiveSide = 'front';
    state.draftDirty = false;

    if (!state.selectedTemplate) {
      state.selectedTemplate = {
        id: null,
        name: state.templateDraftName,
        template_json: templateJsonForApi(clean),
        version: 1,
        font_size: 11,
        font_family: 'Arial',
      };
    }
  }

  function selectedDraftElement() {
    ensureStep2DraftInitialized();
    var elements = state.templateDraft && Array.isArray(state.templateDraft.elements)
      ? state.templateDraft.elements
      : [];
    return elements.find(function (item) {
      return item && item.__id === state.draftSelectedElementId;
    }) || null;
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

  function addDraftElement(type, options) {
    options = options || {};
    ensureStep2DraftInitialized();
    var baseType = type === 'image' ? 'image' : 'text';
    var nextIndex = state.templateDraft.elements.length;

    var defaultWidth = baseType === 'image' ? 86 : 96;
    var defaultHeight = baseType === 'image' ? 68 : 24;
    var defaultX = 16 + ((nextIndex * 10) % 60);
    var defaultY = 16 + ((nextIndex * 10) % 60);

    var item = normalizeDraftElement({
      type: baseType,
      label: String(options.label || (baseType === 'image' ? 'Image ' + String(nextIndex + 1) : 'Text ' + String(nextIndex + 1))),
      field: String(options.field || ''),
      side: String(options.side || state.draftActiveSide || 'front'),
      width: Number(options.width || defaultWidth),
      height: Number(options.height || defaultHeight),
      x: Number(options.x || defaultX),
      y: Number(options.y || defaultY),
      fontFamily: String(options.fontFamily || 'Arial'),
      fontWeight: String(options.fontWeight || '600'),
      textAlign: String(options.textAlign || 'center'),
      lineHeight: Number(options.lineHeight || 1.2),
      letterSpacing: Number(options.letterSpacing || 0),
      color: String(options.color || '#1e293b'),
      textMode: String(options.textMode || (baseType === 'text' ? 'artistic' : '')),
      imageKind: String(options.imageKind || ''),
    }, nextIndex);
    state.templateDraft.elements.push(item);
    state.draftSelectedElementId = item.__id;
    markDraftDirty();
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

    addDraftElement('image', {
      label: 'Photo 19 x 25 mm',
      imageKind: 'photo_19x25',
      width: width,
      height: height,
      x: x,
      y: y,
      side: state.draftActiveSide,
      color: '#0369a1',
    });
  }

  function updateDraftCanvasSize(widthInput, heightInput) {
    ensureStep2DraftInitialized();
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

    markDraftDirty();
  }

  function canvasEventToDraftPoint(canvasEl, event, options) {
    options = options || {};
    var metrics = draftCanvasMetrics();
    var rect = canvasEl.getBoundingClientRect();
    var xPx = Number(event.clientX || 0) - rect.left;
    var yPx = Number(event.clientY || 0) - rect.top;

    var x = (xPx / Math.max(1, rect.width)) * metrics.width;
    var y = (yPx / Math.max(1, rect.height)) * metrics.height;

    if (!Number.isFinite(x)) x = metrics.width / 2;
    if (!Number.isFinite(y)) y = metrics.height / 2;

    if (options.allowOutside) {
      return {
        x: x,
        y: y,
        metrics: metrics,
        rect: rect,
      };
    }

    return {
      x: Math.max(0, Math.min(metrics.width, x)),
      y: Math.max(0, Math.min(metrics.height, y)),
      metrics: metrics,
      rect: rect,
    };
  }

  function removeDraftElement() {
    ensureStep2DraftInitialized();
    if (!state.draftSelectedElementId) {
      return;
    }

    state.templateDraft.elements = state.templateDraft.elements.filter(function (item) {
      return item.__id !== state.draftSelectedElementId;
    });
    state.draftSelectedElementId = state.templateDraft.elements.length
      ? state.templateDraft.elements[0].__id
      : '';
    markDraftDirty();
  }

  function nudgeSelectedDraftElement(dx, dy) {
    var selected = selectedDraftElement();
    if (!selected) {
      return false;
    }

    var moveX = Number(dx || 0);
    var moveY = Number(dy || 0);
    if (!Number.isFinite(moveX)) {
      moveX = 0;
    }
    if (!Number.isFinite(moveY)) {
      moveY = 0;
    }

    updateSelectedDraftElement({
      x: Number(selected.x || 0) + moveX,
      y: Number(selected.y || 0) + moveY,
    });
    return true;
  }

  function duplicateSelectedDraftElement() {
    var selected = selectedDraftElement();
    if (!selected) {
      return false;
    }

    var nextLabel = String(selected.label || (selected.type === 'image' ? 'Image' : 'Text')) + ' Copy';
    addDraftElement(selected.type, {
      label: nextLabel,
      field: selected.field,
      side: selected.side,
      width: selected.width,
      height: selected.height,
      x: Number(selected.x || 0) + 8,
      y: Number(selected.y || 0) + 8,
      fontFamily: selected.fontFamily,
      fontWeight: selected.fontWeight,
      textAlign: selected.textAlign,
      lineHeight: selected.lineHeight,
      letterSpacing: selected.letterSpacing,
      color: selected.color,
      textMode: selected.textMode,
      imageKind: selected.imageKind,
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

    Object.keys(patch || {}).forEach(function (key) {
      current[key] = patch[key];
    });

    var normalized = normalizeDraftElement(current, 0);
    Object.keys(normalized).forEach(function (key) {
      current[key] = normalized[key];
    });
    current.__id = state.draftSelectedElementId;

    markDraftDirty();
  }

  function renderDraftElementsHtml() {
    ensureStep2DraftInitialized();
    var metrics = draftCanvasMetrics();
    var side = state.draftActiveSide === 'back' ? 'back' : 'front';
    var rows = state.templateDraft.elements
      .filter(function (item) {
        return draftElementVisibleOnSide(item, side);
      })
      .map(function (item, idx) {
        var left = Math.max(0, Math.min(100, (Number(item.x || 0) / metrics.width) * 100));
        var top = Math.max(0, Math.min(100, (Number(item.y || 0) / metrics.height) * 100));
        var width = Math.max(2, Math.min(100, (Number(item.width || 1) / metrics.width) * 100));
        var height = Math.max(2, Math.min(100, (Number(item.height || 1) / metrics.height) * 100));
        var label = String(item.label || item.field || ('Field ' + String(idx + 1)));
        var cls = 'gc-draft-el gc-draft-el-' + (item.type === 'image' ? 'photo' : 'text')
          + (item.type === 'text' ? (' gc-draft-el-' + (item.textMode === 'paragraph' ? 'paragraph' : 'artistic')) : '')
          + (item.__id === state.draftSelectedElementId ? ' is-selected' : '');
        var style = 'left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%;';

        if (item.type === 'text') {
          var align = item.textAlign === 'left'
            ? 'flex-start'
            : (item.textAlign === 'right' ? 'flex-end' : 'center');
          style += 'font-size:' + Number(item.fontSize || 11) + 'px;'
            + 'font-family:' + escapeAttr(item.fontFamily || 'Arial') + ';'
            + 'line-height:' + Number(item.lineHeight || 1.2) + ';'
            + 'font-weight:' + escapeAttr(item.fontWeight || '600') + ';'
            + 'letter-spacing:' + Number(item.letterSpacing || 0) + 'px;'
            + 'color:' + escapeAttr(item.color || '#1e293b') + ';'
            + 'justify-content:' + align + ';'
            + (item.textMode === 'paragraph' ? 'white-space:normal;' : 'white-space:nowrap;');
        }

        var imageKind = String(item.imageKind || '');
        if (item.type === 'image' && (imageKind === 'photo_19x25' || imageKind === 'photo_19x24')) {
          label = 'Photo 19 x 25';
        }

        return '<button type="button" class="' + cls + '" data-action="select-draft-element" data-el-id="' + escapeAttr(item.__id) + '"'
          + ' style="' + style + '">'
          + escapeHtml(label)
          + '</button>';
      });

    if (!rows.length) {
      return '<div class="gc-step2-canvas-empty">Use left tools to insert text or 19 x 25 mm photo placeholder</div>';
    }

    return rows.join('');
  }

  function renderDraftInsertGuideHtml() {
    var drag = state.draftTextDrag;
    if (!drag) {
      return '';
    }

    var metrics = draftCanvasMetrics();
    var x1 = Number(drag.startX || 0);
    var y1 = Number(drag.startY || 0);
    var x2 = Number(drag.currentX || x1);
    var y2 = Number(drag.currentY || y1);

    var left = Math.max(0, Math.min(100, (Math.min(x1, x2) / metrics.width) * 100));
    var top = Math.max(0, Math.min(100, (Math.min(y1, y2) / metrics.height) * 100));
    var width = Math.max(0.8, Math.min(100, (Math.abs(x2 - x1) / metrics.width) * 100));
    var height = Math.max(0.8, Math.min(100, (Math.abs(y2 - y1) / metrics.height) * 100));

    return '<div class="gc-draft-insert-guide" style="left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%;"></div>';
  }

  function renderDraftPropsHtml() {
    var item = selectedDraftElement();
    if (!item) {
      return '<div class="gc-prop-note">No element selected. Add a field or click one from canvas.</div>';
    }

    var isText = item.type === 'text';
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

    return ''
      + '<div class="gc-prop-section-title">Element</div>'
      + '<div class="gc-prop-group">'
      + '<label for="gcDraftLabelInput">Label</label>'
      + '<input id="gcDraftLabelInput" class="gc-prop-input" type="text" value="' + escapeAttr(item.label || '') + '">'
      + '</div>'
      + '<div class="gc-prop-group">'
      + '<label for="gcDraftFieldInput">Data Field</label>'
      + '<input id="gcDraftFieldInput" class="gc-prop-input" type="text" value="' + escapeAttr(item.field || '') + '">'
      + '</div>'
      + '<div class="gc-prop-grid">'
      + '<div class="gc-prop-group">'
      + '<label for="gcDraftTypeInput">Type</label>'
      + '<select id="gcDraftTypeInput" class="gc-prop-select">'
      + '<option value="text"' + (item.type === 'text' ? ' selected' : '') + '>Text</option>'
      + '<option value="image"' + (item.type === 'image' ? ' selected' : '') + '>Image</option>'
      + '</select>'
      + '</div>'
      + '<div class="gc-prop-group">'
      + '<label for="gcDraftSideInput">Side</label>'
      + '<select id="gcDraftSideInput" class="gc-prop-select">'
      + '<option value="front"' + (item.side === 'front' ? ' selected' : '') + '>Front</option>'
      + '<option value="back"' + (item.side === 'back' ? ' selected' : '') + '>Back</option>'
      + '<option value="both"' + (item.side === 'both' ? ' selected' : '') + '>Both</option>'
      + '</select>'
      + '</div>'
      + '</div>'
      + '<div class="gc-prop-grid">'
      + '<div class="gc-prop-group"><label for="gcDraftXInput">X (' + unit + ')</label><input id="gcDraftXInput" class="gc-prop-input" type="number" step="any" value="' + escapeAttr(xValue) + '"></div>'
      + '<div class="gc-prop-group"><label for="gcDraftYInput">Y (' + unit + ')</label><input id="gcDraftYInput" class="gc-prop-input" type="number" step="any" value="' + escapeAttr(yValue) + '"></div>'
      + '<div class="gc-prop-group"><label for="gcDraftWInput">Width (' + unit + ')</label><input id="gcDraftWInput" class="gc-prop-input" type="number" step="any" value="' + escapeAttr(wValue) + '"></div>'
      + '<div class="gc-prop-group"><label for="gcDraftHInput">Height (' + unit + ')</label><input id="gcDraftHInput" class="gc-prop-input" type="number" step="any" value="' + escapeAttr(hValue) + '"></div>'
      + '</div>'
      + '<div class="gc-prop-group">'
      + '<label for="gcDraftFontInput">Font Size</label>'
      + '<input id="gcDraftFontInput" class="gc-prop-input" type="number" min="6" max="72" step="1" value="' + escapeAttr(Math.round(Number(item.fontSize || 11))) + '">'
      + '</div>'
      + (isText
        ? '<div class="gc-prop-section-title">Text Options</div>'
          + '<div class="gc-prop-grid">'
          + '<div class="gc-prop-group">'
          + '<label for="gcDraftFontFamilyInput">Font Family</label>'
          + '<select id="gcDraftFontFamilyInput" class="gc-prop-select">'
          + '<option value="Arial"' + (String(item.fontFamily || '') === 'Arial' ? ' selected' : '') + '>Arial</option>'
          + '<option value="Calibri"' + (String(item.fontFamily || '') === 'Calibri' ? ' selected' : '') + '>Calibri</option>'
          + '<option value="Times New Roman"' + (String(item.fontFamily || '') === 'Times New Roman' ? ' selected' : '') + '>Times New Roman</option>'
          + '<option value="Verdana"' + (String(item.fontFamily || '') === 'Verdana' ? ' selected' : '') + '>Verdana</option>'
          + '<option value="Tahoma"' + (String(item.fontFamily || '') === 'Tahoma' ? ' selected' : '') + '>Tahoma</option>'
          + '</select>'
          + '</div>'
          + '<div class="gc-prop-group">'
          + '<label for="gcDraftWeightInput">Weight</label>'
          + '<select id="gcDraftWeightInput" class="gc-prop-select">'
          + '<option value="400"' + (String(item.fontWeight || '') === '400' ? ' selected' : '') + '>Regular</option>'
          + '<option value="500"' + (String(item.fontWeight || '') === '500' ? ' selected' : '') + '>Medium</option>'
          + '<option value="600"' + (String(item.fontWeight || '') === '600' ? ' selected' : '') + '>Semibold</option>'
          + '<option value="700"' + (String(item.fontWeight || '') === '700' ? ' selected' : '') + '>Bold</option>'
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
          + '</div>'
        : '<div class="gc-prop-note">Image placeholder selected. Use size and position controls above.</div>')
      + '<div class="gc-prop-actions">'
      + '<button type="button" class="btn btn-outline" data-action="nudge-draft" data-dx="-1" data-dy="0">Left</button>'
      + '<button type="button" class="btn btn-outline" data-action="nudge-draft" data-dx="1" data-dy="0">Right</button>'
      + '<button type="button" class="btn btn-outline" data-action="nudge-draft" data-dx="0" data-dy="-1">Up</button>'
      + '<button type="button" class="btn btn-outline" data-action="nudge-draft" data-dx="0" data-dy="1">Down</button>'
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

      return '<div class="gc-template-el" style="left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%;">'
        + escapeHtml(label) + '</div>';
    });

    if (!rows.length) {
      return '<div class="gc-preview-empty">No template elements on this side</div>';
    }

    return rows.join('');
  }

  function step1Valid() {
    if (!hasDesignForSide('front')) {
      return false;
    }
    if (state.isTwoSided && !hasDesignForSide('back')) {
      return false;
    }
    return true;
  }

  function hasDesignForSide(side) {
    if (side === 'back') {
      return !!(state.backFile || state.backPreviewUrl);
    }
    return !!(state.frontFile || state.frontPreviewUrl);
  }

  function step2Valid() {
    return true;
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
      : '<div class="gc-preview-empty">Upload ' + escapeHtml(side) + ' design PDF to preview</div>';

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
      : (state.frontPreviewUrl ? 'Using saved design PDF' : 'No file selected');
    var backName = state.backFile
      ? state.backFile.name
      : (state.backPreviewUrl ? 'Using saved design PDF' : 'No file selected');
    var sizeLabel = state.orientation === 'portrait' ? '57mm x 87mm' : '87mm x 57mm';

    var topbarHtml = ''
      + '<div class="gc-step1-topbar">'
      + '<div class="gc-inline-controls">'
      + '<div class="gc-inline-control-block">'
      + '<div class="gc-inline-label">Card Type</div>'
      + '<div class="gc-choice-row">'
      + '<button type="button" class="gc-choice-btn' + (state.orientation === 'landscape' ? ' is-active' : '') + '" data-action="set-orientation" data-value="landscape">Horizontal</button>'
      + '<button type="button" class="gc-choice-btn' + (state.orientation === 'portrait' ? ' is-active' : '') + '" data-action="set-orientation" data-value="portrait">Vertical</button>'
      + '</div>'
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
      + '<label>Front PDF</label>'
      + '<div class="gc-upload-input-wrap">'
      + '<input id="gcFrontPdfInput" class="gc-file-input-native" type="file" accept="application/pdf,.pdf">'
      + '<label for="gcFrontPdfInput" class="gc-upload-btn">Choose Front PDF</label>'
      + (hasDesignForSide('front')
        ? '<button type="button" class="btn btn-outline gc-upload-clear-btn" data-action="clear-pdf" data-side="front">Remove</button>'
        : '')
      + '<div class="gc-file-pill' + (frontName === 'No file selected' ? ' is-empty' : '') + '">' + escapeHtml(frontName) + '</div>'
      + '</div>'
      + '</div>'
      + (state.isTwoSided
        ? '<div class="gc-step1-upload-col">'
          + '<label>Back PDF</label>'
          + '<div class="gc-upload-input-wrap">'
          + '<input id="gcBackPdfInput" class="gc-file-input-native" type="file" accept="application/pdf,.pdf">'
          + '<label for="gcBackPdfInput" class="gc-upload-btn">Choose Back PDF</label>'
          + (hasDesignForSide('back')
            ? '<button type="button" class="btn btn-outline gc-upload-clear-btn" data-action="clear-pdf" data-side="back">Remove</button>'
            : '')
          + '<div class="gc-file-pill' + (backName === 'No file selected' ? ' is-empty' : '') + '">' + escapeHtml(backName) + '</div>'
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

  function renderStep2() {
    ensureStep2DraftInitialized();

    var templateName = String(state.templateDraftName || (state.selectedTemplate && state.selectedTemplate.name) || 'New Template');
    var templateVersion = state.selectedTemplate && state.selectedTemplate.id
      ? Number(state.selectedTemplate.version || 1)
      : null;
    var metrics = draftCanvasMetrics();
    var zoom = Number(state.draftZoom || 1);
    if (!Number.isFinite(zoom) || zoom <= 0) {
      zoom = 1;
    }
    var targetDisplayWidth = 760;
    var displayScale = targetDisplayWidth / Math.max(1, Number(metrics.width || 1));
    if (!Number.isFinite(displayScale)) {
      displayScale = 1;
    }
    displayScale = Math.max(1, Math.min(2.4, displayScale));
    var canvasDisplayWidth = Math.max(240, Math.round(Number(metrics.width || 1) * displayScale));
    var canvasDisplayHeight = Math.max(160, Math.round(Number(metrics.height || 1) * displayScale));
    var canvasWrapStyle = 'width:' + String(canvasDisplayWidth) + 'px;height:' + String(canvasDisplayHeight) + 'px;transform:scale(' + zoom.toFixed(2) + ');';
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
    var activeFront = state.draftActiveSide !== 'back';
    var selectActive = state.draftTool === 'select';
    var textActive = state.draftTool === 'text';
    var photoActive = state.draftTool === 'photo';
    var canvasClass = 'gc-step2-canvas'
      + (textActive ? ' is-text-mode' : '')
      + (photoActive ? ' is-photo-mode' : '');

    return '<div class="gc-step-panel gc-step-panel-step2">'
      + '<div class="gc-step2-workspace">'
      + '<div class="gc-step2-main">'
      + '<div class="gc-step2-tools">'
      + '<button type="button" class="gc-step2-tool-btn' + (selectActive ? ' is-active' : '') + '" data-action="set-draft-tool" data-tool="select">'
      + '<i class="fa-solid fa-arrow-pointer"></i><span>Select</span>'
      + '</button>'
      + '<button type="button" class="gc-step2-tool-btn' + (textActive ? ' is-active' : '') + '" data-action="set-draft-tool" data-tool="text">'
      + '<i class="fa-solid fa-font"></i><span>Text</span>'
      + '</button>'
      + '<button type="button" class="gc-step2-tool-btn' + (photoActive ? ' is-active' : '') + '" data-action="set-draft-tool" data-tool="photo">'
      + '<i class="fa-solid fa-image"></i><span>Photo 19x25</span>'
      + '</button>'
      + '</div>'
      + '<div class="gc-step2-canvas-shell">'
      + '<div class="gc-step2-canvas-head">'
      + '<div class="gc-inline-group">'
      + '<div class="gc-inline-label">Working Template</div>'
      + '<div class="gc-inline-value">' + escapeHtml(templateName) + (templateVersion ? ' (v' + templateVersion + ')' : ' (Draft)') + '</div>'
      + '</div>'
      + '<div class="gc-step2-center-controls">'
      + '<button type="button" class="btn btn-outline" data-action="zoom-out">-</button>'
      + '<input id="gcDraftZoomRange" class="gc-step2-zoom-range" type="range" min="25" max="400" step="5" value="' + escapeAttr(zoomLabel) + '">'
      + '<button type="button" class="btn btn-outline" data-action="zoom-in">+</button>'
      + '<button type="button" class="btn btn-outline" data-action="zoom-fit">Fit</button>'
      + '<span class="gc-step2-zoom-pill">' + zoomLabel + '%</span>'
      + '<select id="gcDraftUnitSelect" class="gc-step2-unit-select">'
      + '<option value="px"' + (unit === 'px' ? ' selected' : '') + '>px</option>'
      + '<option value="mm"' + (unit === 'mm' ? ' selected' : '') + '>mm</option>'
      + '<option value="cm"' + (unit === 'cm' ? ' selected' : '') + '>cm</option>'
      + '<option value="in"' + (unit === 'in' ? ' selected' : '') + '>in</option>'
      + '</select>'
      + '<div class="gc-step2-size-controls">'
      + '<span class="gc-step2-size-label">W (' + unitLabel + ')</span>'
      + '<input id="gcDraftCanvasWidthCenterInput" class="gc-step2-size-input" type="number" step="any" value="' + escapeAttr(canvasWValue) + '">'
      + '<span class="gc-step2-size-label">H (' + unitLabel + ')</span>'
      + '<input id="gcDraftCanvasHeightCenterInput" class="gc-step2-size-input" type="number" step="any" value="' + escapeAttr(canvasHValue) + '">'
      + '</div>'
      + '<button type="button" class="btn btn-blue" data-action="save-draft-template">Save Template</button>'
      + '</div>'
      + '<div class="gc-step2-side-switch">'
      + '<button type="button" class="gc-choice-btn' + (activeFront ? ' is-active' : '') + '" data-action="switch-draft-side" data-side="front">Front</button>'
      + (state.isTwoSided
        ? '<button type="button" class="gc-choice-btn' + (!activeFront ? ' is-active' : '') + '" data-action="switch-draft-side" data-side="back">Back</button>'
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
      + '<div class="' + canvasClass + '" data-action="draft-canvas-tap" style="' + canvasStyle + '">'
      + renderDraftElementsHtml()
      + renderDraftInsertGuideHtml()
      + '</div>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="gc-step2-props">'
      + '<div class="gc-prop-section-title">Template</div>'
      + '<div class="gc-prop-group">'
      + '<label for="gcTemplateNameInput">Template Name</label>'
      + '<input id="gcTemplateNameInput" class="gc-prop-input" type="text" value="' + escapeAttr(templateName) + '">'
      + '</div>'
      + '<div class="gc-prop-actions">'
      + '<button type="button" class="btn btn-outline" data-action="remove-draft-element">Delete Selected</button>'
      + '</div>'
      + renderDraftPropsHtml()
      + '</div>'
      + '</div>'
      + '</div>'
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
      resetStep2DraftState();
      return;
    }

    var detail = await requestJson('GET', templateDetailPath(id));
    state.selectedTemplateId = id;
    state.selectedTemplate = detail.template || null;
    resetStep2DraftState();
    state.templateDraftName = state.selectedTemplate ? String(state.selectedTemplate.name || '') : '';
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
    if ((!baseTemplate || !baseTemplate.template_json) && state.templates.length) {
      var fallbackId = bestTemplateId();
      if (fallbackId) {
        try {
          var fallbackDetail = await requestJson('GET', templateDetailPath(fallbackId));
          baseTemplate = fallbackDetail && fallbackDetail.template ? fallbackDetail.template : baseTemplate;
        } catch (_fallbackErr) {
          // Keep creating a minimal draft when fallback fetch is unavailable.
        }
      }
    }

    var payload = {
      name: String(state.templateDraftName || draftTemplateName()).slice(0, 120),
      is_two_sided: !!state.isTwoSided,
      card_orientation: normalizeOrientation(state.orientation),
      template_json: state.templateDraft ? templateJsonForApi(state.templateDraft) : ((baseTemplate && baseTemplate.template_json) ? baseTemplate.template_json : defaultTemplateJson()),
      font_size: Number((baseTemplate && baseTemplate.font_size) || 11),
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
      font_size: Number((state.selectedTemplate && state.selectedTemplate.font_size) || 11),
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

    if (state.selectedTemplate && state.selectedTemplate.id && !state.draftDirty) {
      return state.selectedTemplate;
    }

    if (state.draftDirty) {
      return createDraftTemplate();
    }

    var preferredTemplateId = bestTemplateId();
    if (preferredTemplateId) {
      await selectTemplate(preferredTemplateId);
      if (state.selectedTemplate && state.selectedTemplate.id) {
        return state.selectedTemplate;
      }
    }

    return createDraftTemplate();
  }

  async function uploadDesignPdfs() {
    if (state.frontFile) {
      var frontForm = new FormData();
      frontForm.append('pdf', state.frontFile, state.frontFile.name);
      await requestForm(uploadPdfPath('front'), frontForm);
    } else if (!state.frontPreviewUrl) {
      throw new Error('Front PDF is required.');
    }

    if (state.isTwoSided) {
      if (state.backFile) {
        var backForm = new FormData();
        backForm.append('pdf', state.backFile, state.backFile.name);
        await requestForm(uploadPdfPath('back'), backForm);
      } else if (!state.backPreviewUrl) {
        throw new Error('Back PDF is required for 2 sided cards.');
      }
    }
  }

  async function clearPdfForSide(side) {
    if (side !== 'front' && side !== 'back') {
      return;
    }

    state.loading = true;
    render();

    try {
      var data = await requestJson('POST', clearPdfPath(side), {});
      var template = data && data.template && typeof data.template === 'object' ? data.template : null;

      revokeLocalPreview(side);
      if (side === 'front') {
        state.frontFile = null;
        state.frontPreviewUrl = template && typeof template.front_pdf_url === 'string' ? template.front_pdf_url : '';
      } else {
        state.backFile = null;
        state.backPreviewUrl = template && typeof template.back_pdf_url === 'string' ? template.back_pdf_url : '';
      }

      setAlert((side === 'front' ? 'Front' : 'Back') + ' design cleared.', 'warning');
      showToast((side === 'front' ? 'Front' : 'Back') + ' design cleared.', 'success');
    } catch (err) {
      var message = err && err.message ? err.message : 'Unable to clear design PDF.';
      setAlert(message, 'error');
      showToast(message, 'error');
    } finally {
      state.loading = false;
      render();
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
      var side = String(target.getAttribute('data-side') || 'front');
      state.draftActiveSide = side === 'back' ? 'back' : 'front';
      render();
      return;
    }

    if (action === 'zoom-in') {
      setDraftZoom((Number(state.draftZoom || 1) + 0.1));
      render();
      return;
    }

    if (action === 'zoom-out') {
      setDraftZoom((Number(state.draftZoom || 1) - 0.1));
      render();
      return;
    }

    if (action === 'zoom-fit') {
      setDraftZoom(1);
      render();
      return;
    }

    if (action === 'set-draft-tool') {
      var tool = String(target.getAttribute('data-tool') || 'select');
      state.draftTextDrag = null;
      state.draftDragging = null;
      state.draftGuideDragging = null;
      state.draftSuppressTextClick = false;
      if (tool === 'photo') {
        state.draftTool = 'photo';
      } else if (tool === 'text') {
        state.draftTool = 'text';
      } else {
        state.draftTool = 'select';
      }
      render();
      return;
    }

    if (action === 'draft-canvas-tap') {
      if (state.step !== 2 || state.draftTool !== 'text') {
        return;
      }
      if (state.draftSuppressTextClick) {
        state.draftSuppressTextClick = false;
        return;
      }
      return;
    }

    if (action === 'add-draft-text') {
      addDraftElement('text');
      render();
      return;
    }

    if (action === 'add-draft-image') {
      state.draftTool = 'photo';
      render();
      return;
    }

    if (action === 'select-draft-element') {
      var elId = String(target.getAttribute('data-el-id') || '');
      state.draftSelectedElementId = elId;
      state.draftSelectedGuideId = '';
      render();
      return;
    }

    if (action === 'select-draft-guide') {
      var guideId = String(target.getAttribute('data-guide-id') || '');
      state.draftSelectedGuideId = guideId;
      state.draftSelectedElementId = '';
      render();
      return;
    }

    if (action === 'remove-draft-element') {
      if (selectedDraftElement()) {
        removeDraftElement();
      } else if (selectedDraftGuide()) {
        removeDraftGuideById(state.draftSelectedGuideId);
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
    setDraftZoom(nextZoom);
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
      setDraftZoom(nextZoom);
      render();
    }

    event.preventDefault();
  }, { passive: false, capture: true });

  flowRoot.addEventListener('mousedown', function (event) {
    if (state.step !== 2) {
      return;
    }

    var guideEl = event.target.closest('.gc-draft-guide');
    if (guideEl) {
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
        state.draftSelectedGuideId = guideId;
        state.draftSelectedElementId = '';
        state.draftGuideDragging = {
          id: guideId,
          axis: guide.axis,
          canvasEl: guideCanvas,
          isNew: false,
        };
        event.preventDefault();
        render();
        return;
      }
    }

    var rulerEl = event.target.closest('.gc-step2-ruler-top, .gc-step2-ruler-left');
    if (rulerEl) {
      var shell = rulerEl.closest('.gc-step2-canvas-shell');
      var rulerCanvas = shell ? shell.querySelector('.gc-step2-canvas') : null;
      if (rulerCanvas) {
        var axis = rulerEl.classList.contains('gc-step2-ruler-top') ? 'x' : 'y';
        var startPoint = canvasEventToDraftPoint(rulerCanvas, event, { allowOutside: true });
        var startPos = axis === 'x' ? startPoint.x : startPoint.y;
        var newGuideId = addDraftGuide(axis, startPos);
        state.draftSelectedGuideId = newGuideId;
        state.draftSelectedElementId = '';
        state.draftGuideDragging = {
          id: newGuideId,
          axis: axis,
          canvasEl: rulerCanvas,
          isNew: true,
        };
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
      state.draftTextDrag = {
        canvasEl: canvasEl,
        startX: startPoint.x,
        startY: startPoint.y,
        currentX: startPoint.x,
        currentY: startPoint.y,
      };
      state.draftSuppressTextClick = false;
      event.preventDefault();
      render();
      return;
    }

    if (state.draftTool !== 'select') {
      return;
    }

    var el = event.target.closest('.gc-draft-el');
    if (!el || !canvasEl) {
      return;
    }

    var elId = String(el.getAttribute('data-el-id') || '');
    if (!elId) {
      return;
    }

    ensureStep2DraftInitialized();
    var current = state.templateDraft.elements.find(function (item) {
      return item && item.__id === elId;
    });
    if (!current) {
      return;
    }

    state.draftSelectedElementId = elId;
    state.draftSelectedGuideId = '';
    var point = canvasEventToDraftPoint(canvasEl, event);
    state.draftDragging = {
      id: elId,
      startMouseX: Number(event.clientX || 0),
      startMouseY: Number(event.clientY || 0),
      startX: Number(current.x || 0),
      startY: Number(current.y || 0),
      canvasRect: point.rect,
      metrics: point.metrics,
    };

    event.preventDefault();
    render();
  });

  flowRoot.addEventListener('dblclick', function (event) {
    var guideEl = event.target.closest('.gc-draft-guide');
    if (guideEl) {
      var guideId = String(guideEl.getAttribute('data-guide-id') || '');
      if (guideId) {
        removeDraftGuideById(guideId);
        state.draftSelectedGuideId = '';
        event.preventDefault();
        render();
      }
      return;
    }

    if (state.step !== 2 || state.draftTool !== 'photo') {
      return;
    }

    var canvasEl = event.target.closest('.gc-step2-canvas');
    if (!canvasEl || event.target !== canvasEl) {
      return;
    }

    var point = canvasEventToDraftPoint(canvasEl, event);
    addPhotoPlaceholderElement({
      atPoint: true,
      x: point.x,
      y: point.y,
    });
    state.draftTool = 'select';
    event.preventDefault();
    render();
  });

  window.addEventListener('mousemove', function (event) {
    var guideDrag = state.draftGuideDragging;
    if (guideDrag && guideDrag.canvasEl) {
      var guidePoint = canvasEventToDraftPoint(guideDrag.canvasEl, event, { allowOutside: true });
      var nextPos = guideDrag.axis === 'x' ? guidePoint.x : guidePoint.y;
      updateDraftGuidePosition(guideDrag.id, nextPos);
      render();
      return;
    }

    var textDrag = state.draftTextDrag;
    if (textDrag && textDrag.canvasEl) {
      var livePoint = canvasEventToDraftPoint(textDrag.canvasEl, event);
      textDrag.currentX = livePoint.x;
      textDrag.currentY = livePoint.y;
      render();
      return;
    }

    var drag = state.draftDragging;
    if (!drag) {
      return;
    }

    var scaleX = drag.metrics.width / Math.max(1, drag.canvasRect.width);
    var scaleY = drag.metrics.height / Math.max(1, drag.canvasRect.height);
    var x = drag.startX + ((Number(event.clientX || 0) - drag.startMouseX) * scaleX);
    var y = drag.startY + ((Number(event.clientY || 0) - drag.startMouseY) * scaleY);

    updateSelectedDraftElement({ x: x, y: y });
    render();
  });

  window.addEventListener('mouseup', function (event) {
    if (state.draftGuideDragging) {
      var dragGuide = state.draftGuideDragging;
      var rect = dragGuide.canvasEl.getBoundingClientRect();
      var x = Number(event && event.clientX || 0);
      var y = Number(event && event.clientY || 0);
      var outside = x < rect.left - 24 || x > rect.right + 24 || y < rect.top - 24 || y > rect.bottom + 24;
      if (outside) {
        removeDraftGuideById(dragGuide.id);
      }
      state.draftGuideDragging = null;
      render();
      return;
    }

    if (state.draftTextDrag) {
      var td = state.draftTextDrag;
      var dx = Math.abs(Number(td.currentX || td.startX) - Number(td.startX || 0));
      var dy = Math.abs(Number(td.currentY || td.startY) - Number(td.startY || 0));

      if (dx >= 14 || dy >= 14) {
        addDraftElement('text', {
          x: Math.min(Number(td.startX || 0), Number(td.currentX || td.startX || 0)),
          y: Math.min(Number(td.startY || 0), Number(td.currentY || td.startY || 0)),
          width: Math.max(36, dx),
          height: Math.max(20, dy),
          side: state.draftActiveSide,
          textMode: 'paragraph',
          textAlign: 'left',
          label: 'Paragraph ' + String((state.templateDraft && state.templateDraft.elements ? state.templateDraft.elements.length : 0) + 1),
        });
      } else {
        addDraftElement('text', {
          x: Number(td.startX || 0),
          y: Number(td.startY || 0),
          width: 120,
          height: 24,
          side: state.draftActiveSide,
          textMode: 'artistic',
          textAlign: 'left',
          label: 'Artistic Text ' + String((state.templateDraft && state.templateDraft.elements ? state.templateDraft.elements.length : 0) + 1),
        });
      }

      state.draftTextDrag = null;
      state.draftSuppressTextClick = true;
      render();
      return;
    }

    if (!state.draftDragging) {
      return;
    }
    state.draftDragging = null;
  });

  window.addEventListener('keydown', function (event) {
    if (!isStep2EditorActive()) {
      return;
    }

    if (isTypingTarget(event.target)) {
      return;
    }

    var key = String(event.key || '');
    var lower = key.toLowerCase();
    var ctrlOrMeta = !!(event.ctrlKey || event.metaKey);
    var handled = false;

    if (!ctrlOrMeta && !event.altKey && (key === 'Delete' || key === 'Backspace')) {
      if (selectedDraftElement()) {
        removeDraftElement();
        handled = true;
      } else if (selectedDraftGuide()) {
        handled = removeDraftGuideById(state.draftSelectedGuideId);
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
    } else if (!ctrlOrMeta && !event.altKey && key === 'Escape') {
      state.draftDragging = null;
      state.draftGuideDragging = null;
      state.draftTextDrag = null;
      state.draftTool = 'select';
      handled = true;
    } else if (ctrlOrMeta && !event.altKey && lower === 'd') {
      handled = duplicateSelectedDraftElement();
    } else if (ctrlOrMeta && !event.altKey && lower === 's') {
      triggerSaveDraftTemplate();
      handled = true;
    } else if (ctrlOrMeta && !event.altKey && (key === '+' || key === '=')) {
      setDraftZoom(Number(state.draftZoom || 1) + 0.1);
      handled = true;
    } else if (ctrlOrMeta && !event.altKey && (key === '-' || key === '_')) {
      setDraftZoom(Number(state.draftZoom || 1) - 0.1);
      handled = true;
    } else if (ctrlOrMeta && !event.altKey && lower === '0') {
      setDraftZoom(1);
      handled = true;
    }

    if (!handled) {
      return;
    }

    event.preventDefault();
    render();
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

    if (target.id === 'gcDraftCanvasWidthCenterInput' || target.id === 'gcDraftCanvasWidthInput') {
      var widthValue = unitValueToCanvas(Number(target.value || 0), 'x');
      updateDraftCanvasSize(widthValue, draftCanvasMetrics().height);
      render();
      return;
    }

    if (target.id === 'gcDraftCanvasHeightCenterInput' || target.id === 'gcDraftCanvasHeightInput') {
      var heightValue = unitValueToCanvas(Number(target.value || 0), 'y');
      updateDraftCanvasSize(draftCanvasMetrics().width, heightValue);
      render();
      return;
    }

    if (target.id === 'gcDraftZoomRange') {
      setDraftZoom(Number(target.value || 100) / 100);
      render();
      return;
    }

    if (target.id === 'gcDraftUnitSelect') {
      var unit = String(target.value || 'px').toLowerCase();
      if (unit !== 'px' && unit !== 'mm' && unit !== 'cm' && unit !== 'in') {
        unit = 'px';
      }
      state.draftUnit = unit;
      render();
      return;
    }

    if (target.id === 'gcDraftLabelInput') {
      updateSelectedDraftElement({ label: String(target.value || '') });
      render();
      return;
    }

    if (target.id === 'gcDraftFieldInput') {
      updateSelectedDraftElement({ field: String(target.value || '') });
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
      var fs = Number(target.value || 11);
      if (!Number.isFinite(fs)) {
        fs = 11;
      }
      updateSelectedDraftElement({ fontSize: Math.max(6, Math.min(72, fs)) });
      render();
      return;
    }

    if (target.id === 'gcDraftFontFamilyInput') {
      updateSelectedDraftElement({ fontFamily: String(target.value || 'Arial') });
      render();
      return;
    }

    if (target.id === 'gcDraftWeightInput') {
      updateSelectedDraftElement({ fontWeight: String(target.value || '600') });
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