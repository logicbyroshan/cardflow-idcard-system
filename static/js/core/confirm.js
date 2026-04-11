/**
 * Core Confirm Module
 * Universal confirmation modal that works on every page.
 * Dynamically creates DOM + styles on first use.
 *
 * Public API:
 *   showConfirm(opts)   Promise<boolean>
 *
 * Options:
 *   title        {string}    Modal title (default: 'Are you sure?')
 *   text         {string}    Description text (default: 'This action cannot be undone.')
 *   icon         {string}    FontAwesome class (default: 'fa-solid fa-triangle-exclamation')
 *   confirmLabel {string}    Confirm button text (default: 'Confirm')
 *   cancelLabel  {string}    Cancel button text  (default: 'Cancel')
 *   btnClass     {string}    Confirm button class (default: 'btn-danger')
 *   warnings     {string[]}  Warning bullet list items
 *   hideWarning  {boolean}   Hide the warning box entirely
 *
 * @module core/confirm
 * @version 1.0.0
 */
(function () {
  'use strict';

  var OVERLAY_ID  = 'coreConfirmOverlay';
  var _injected   = false;

  /*  CSS (injected once)  */
  var CSS = [
    '#' + OVERLAY_ID + '{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(3px);z-index:9999;align-items:center;justify-content:center}',
    '#' + OVERLAY_ID + '.show{display:flex}',
    '.cc-box{background:#fff;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.08);width:420px;max-width:95vw;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;animation:ccSlide .15s ease}',
    '@keyframes ccSlide{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}',
    '.cc-content{flex:1;min-height:0;overflow-y:auto;padding:28px 24px 16px;text-align:center}',
    '.cc-actions{display:flex;gap:8px;justify-content:center;padding:14px 24px 18px;border-top:1px solid #e5e7eb;background:#fafafa;border-radius:0 0 10px 10px;flex-shrink:0}',
    '.cc-actions .btn{min-width:90px}',
    '.cc-icon{display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius: 8px;margin:0 auto 12px;font-size:20px;background:#fef3c7;color:#d97706}',
    '.cc-title{font-size:15px;font-weight:700;color:#1f2937;margin:0 0 4px}',
    '.cc-text{font-size:13px;color:#6b7280;margin:0 0 10px;line-height:1.5}',
    '.cc-warning{width:100%;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;text-align:left;margin-bottom:16px}',
    '.cc-warning-title{font-size:12px;color:#991b1b;font-weight:600;margin:0 0 6px;display:flex;align-items:center;gap:6px}',
    '.cc-warning-list{margin:0;padding:0 0 0 16px;font-size:12px;color:#7f1d1d;line-height:1.7}'
  ].join('\n');

  /*  Ensure DOM + CSS exist  */
  function ensureDOM() {
    if (_injected) return;
    _injected = true;

    // Inject CSS
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Inject overlay
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML =
      '<div class="cc-box">' +
        '<div class="cc-content">' +
          '<div class="cc-icon" id="ccIcon"><i class="fa-solid fa-triangle-exclamation"></i></div>' +
          '<h4 class="cc-title" id="ccTitle">Are you sure?</h4>' +
          '<p class="cc-text" id="ccText">This action cannot be undone.</p>' +
          '<div class="cc-warning" id="ccWarning">' +
            '<p class="cc-warning-title"><i class="fa-solid fa-circle-exclamation"></i> Warning</p>' +
            '<ul class="cc-warning-list" id="ccWarningList">' +
              '<li>This action may affect your data</li>' +
              '<li>Please confirm before proceeding</li>' +
            '</ul>' +
          '</div>' +
        '</div>' +
        '<div class="cc-actions">' +
          '<button type="button" class="btn btn-neutral" id="ccCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>' +
          '<button type="button" class="btn btn-danger" id="ccOk"><i class="fa-solid fa-check"></i> Confirm</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
  }

  /*  Public: showConfirm(opts)  Promise<boolean>  */
  function showConfirm(opts) {
    opts = opts || {};

    // Delegate to waConfirm if it exists (website admin pages already have a styled one)
    if (window.waConfirm && document.getElementById('waConfirmOverlay')) {
      return window.waConfirm(opts);
    }

    ensureDOM();

    return new Promise(function (resolve) {
      var overlay     = document.getElementById(OVERLAY_ID);
      var iconEl      = document.getElementById('ccIcon');
      var titleEl     = document.getElementById('ccTitle');
      var textEl      = document.getElementById('ccText');
      var okBtn       = document.getElementById('ccOk');
      var cancelBtn   = document.getElementById('ccCancel');
      var warningBox  = document.getElementById('ccWarning');
      var warningList = document.getElementById('ccWarningList');

      titleEl.textContent = opts.title || 'Are you sure?';
      textEl.textContent  = opts.text  || 'This action cannot be undone.';
      okBtn.innerHTML     = '<i class="fa-solid fa-check"></i> ' + (opts.confirmLabel || 'Confirm');
      cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> ' + (opts.cancelLabel || 'Cancel');
      okBtn.className     = 'btn ' + (opts.btnClass || 'btn-danger');

      if (opts.icon) {
        iconEl.innerHTML = '<i class="' + opts.icon + '"></i>';
      } else {
        iconEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
      }

      if (opts.warnings && opts.warnings.length) {
        warningList.innerHTML = opts.warnings.map(function (w) { return '<li>' + w + '</li>'; }).join('');
        warningBox.style.display = '';
      } else if (opts.hideWarning) {
        warningBox.style.display = 'none';
      } else {
        warningList.innerHTML = '<li>This action may affect your data</li><li>Please confirm before proceeding</li>';
        warningBox.style.display = '';
      }

      overlay.classList.add('show');
      okBtn.focus();

      function cleanup(result) {
        overlay.classList.remove('show');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onEscape);
        resolve(result);
      }
      function onOk()      { cleanup(true);  }
      function onCancel()  { cleanup(false); }
      function onBackdrop(e) { if (e.target === overlay) cleanup(false); }
      function onEscape(e)   { if (e.key === 'Escape') cleanup(false); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      overlay.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onEscape);
    });
  }

  // Expose globally
  window.showConfirm = showConfirm;

})();
