/**
 * AdarshEngine v2 — Intelligent Passport Photo Correction Engine
 * ═══════════════════════════════════════════════════════════════
 *
 * Professional ID-photo correction tool that runs entirely in the browser.
 * Built as a modular class for maintainability and clean lifecycle management.
 *
 * Features:
 *   1. Levels Adjustment  (Black Point / Gamma / White Point)
 *   2. Vibrance           (Skin-safe, protects saturated colours)
 *   3. Manual Crop        (Reuses existing Cropper.js in vendor/)
 *   4. Full-resolution save pipeline
 *   5. Auto Levels        (Histogram-based intelligent auto-correction)
 *   6. Save to /edited/   (Edited images saved to dedicated folder)
 *   7. Future placeholders (Skin balance, background whitening, sharpness)
 *
 * Architecture:
 *   - ALL image processing happens on an HTML5 Canvas (no backend).
 *   - Stores originalImageData on load; every slider change reapplies
 *     the full pipeline from scratch → zero quality degradation.
 *   - Preview capped at 1200px; full-res kept separately for export.
 *   - No CDN, no WebGL, no external dependencies — 100% offline.
 *   - Event listeners tracked for clean destroy (Phase 14).
 *   - Optional debug logging (Phase 13).
 *   - Auto Levels analyses luminance histogram with 0.5% outlier
 *     clipping for optimal shadow/highlight/gamma detection.
 *
 * Integration:
 *   - window.AdarshEngine.open(srcUrl, filename, onSave)
 *   - Edited images saved to /edited/ subfolder via backend endpoint.
 *   - Does NOT modify existing cropper files or preview logic.
 *
 * @module adarshengine
 * @version 2.0.0
 */
;(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  //  CLASS: AdarshEngine
  // ═══════════════════════════════════════════════════════════════════

  /**
   * @class AdarshEngine
   * @param {string} canvasId - The DOM id of the <canvas> element.
   */
  function AdarshEngine(canvasId) {

    // ── Phase 2: Core references ──────────────────────────────────
    /** @type {HTMLCanvasElement} */
    this.canvas = document.getElementById(canvasId);
    /** @type {CanvasRenderingContext2D} */
    this.ctx = this.canvas
      ? this.canvas.getContext('2d', { willReadFrequently: true })
      : null;

    // ── Phase 2: Image storage ────────────────────────────────────
    /** Full-resolution Image element (never displayed directly). */
    this.originalFullResolutionImage = null;
    /** Scaled preview Image element (displayed on canvas). */
    this.previewScaledImage = null;
    /**
     * Original pixel data for the preview canvas.
     * Never mutated — every render copies from this.
     * @type {ImageData|null}
     */
    this.originalImageData = null;

    // ── Phase 3 + 4: Slider parameters ────────────────────────────
    this.params = {
      blackPoint: 0,
      gamma:      1.0,
      whitePoint: 255,
      vibrance:   0,
      temperature: 0,
    };

    // ── Phase 5: Crop state ───────────────────────────────────────
    this.cropperInstance = null;
    this.cropActive = false;

    // ── Phase 7: Performance ──────────────────────────────────────
    this.pendingRender = null;
    this.debounceTimer = null;

    // ── Phase 6: Save callback ────────────────────────────────────
    this.onSaveCallback = null;
    this.currentFilename = '';

    // ── v2: Source URL for /edited/ save routing ──────────────────
    this.sourceUrl = '';

    // ── Phase 13: Debug logging ───────────────────────────────────
    this.debug = false;

    // ── Production hardening: guards ──────────────────────────────
    this._saving = false;

    // ── Phase 14: Tracked event listeners for clean destroy ───────
    this._listeners = [];  // Array of { el, event, handler }

    // ── Scroll position preservation ──────────────────────────────
    this._savedScrollY = 0;

    // ── v3: Image navigation list ─────────────────────────────────
    this._imageList = [];       // Array of { url, name }
    this._imageIndex = -1;      // Current index in _imageList
    this._onNavigate = null;    // Callback when navigating: (dataUrl, name) => void

    // ── v3: Histogram state ───────────────────────────────────────
    this._histogramData = null;
    this._dragging = null;      // 'black' | 'gamma' | 'white' | null

    // ── Phase 1: DOM references (resolved on first open) ──────────
    this._els = {};
    this._bound = false;
  }

  // ── Constants ────────────────────────────────────────────────────

  /** Max preview dimension (Phase 7). */
  AdarshEngine.PREVIEW_MAX = 1200;

  /** Slider debounce delay in ms (Phase 7). */
  AdarshEngine.DEBOUNCE_MS = 50;

  /** Engine version string (Phase 16). */
  AdarshEngine.VERSION = '2.0.0';

  /** JPEG export quality — studio-grade (Phase 4 hardening). */
  AdarshEngine.EXPORT_QUALITY = 0.95;

  /** Maximum image dimension for full-res export canvas. */
  AdarshEngine.MAX_EXPORT_DIM = 8192;

  /** Minimum accepted image dimension. */
  AdarshEngine.MIN_IMAGE_DIM = 10;

  /**
   * Production mode flag.
   * When true: suppresses all console output.
   * Set to false during development for debug logging.
   */
  AdarshEngine.IS_PRODUCTION = false;

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 14: TRACKED EVENT LISTENER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Attach an event listener and track it for later removal.
   * @param {EventTarget} el    - DOM element.
   * @param {string}      event - Event name.
   * @param {function}    fn    - Handler.
   */
  AdarshEngine.prototype._on = function (el, event, fn) {
    if (!el) return;
    el.addEventListener(event, fn);
    this._listeners.push({ el: el, event: event, handler: fn });
  };

  /**
   * Remove all tracked event listeners (Phase 14).
   */
  AdarshEngine.prototype._offAll = function () {
    for (var i = 0; i < this._listeners.length; i++) {
      var l = this._listeners[i];
      l.el.removeEventListener(l.event, l.handler);
    }
    this._listeners = [];
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 13: DEBUG LOGGING
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Log a message if debug mode is enabled.
   * @param {...*} args - Arguments forwarded to console.log.
   */
  AdarshEngine.prototype._log = function () {
    if (AdarshEngine.IS_PRODUCTION || !this.debug) return;
    var args = ['[AdarshEngine]'].concat(Array.prototype.slice.call(arguments));
    console.log.apply(console, args);
  };

  /**
   * Log a warning. Suppressed in production mode.
   */
  AdarshEngine.prototype._warn = function () {
    if (AdarshEngine.IS_PRODUCTION) return;
    var args = ['[AdarshEngine]'].concat(Array.prototype.slice.call(arguments));
    console.warn.apply(console, args);
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 1: DOM RESOLUTION + EVENT BINDING
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Lazily resolve all modal DOM elements and bind events once.
   */
  AdarshEngine.prototype._resolveElements = function () {
    if (this._bound) return;

    var e = this._els;
    e.backdrop      = document.getElementById('aeBackdrop');
    e.canvas        = this.canvas;
    e.filename      = document.getElementById('aeFilename');
    e.loading       = document.getElementById('aeLoading');
    e.errorOverlay  = document.getElementById('aeError');
    e.errorMsg      = document.getElementById('aeErrorMsg');
    e.dimText       = document.getElementById('aeDimText');

    // Sliders (now hidden inputs driven by handles)
    e.black    = document.getElementById('aeBlack');
    e.gamma    = document.getElementById('aeGamma');
    e.white    = document.getElementById('aeWhite');
    e.vibrance = document.getElementById('aeVibrance');

    // Slider value labels
    e.blackVal    = document.getElementById('aeBlackVal');
    e.gammaVal    = document.getElementById('aeGammaVal');
    e.whiteVal    = document.getElementById('aeWhiteVal');
    e.vibranceVal = document.getElementById('aeVibranceVal');
    e.tempVal     = document.getElementById('aeTempVal');

    // Temperature slider
    e.temp = document.getElementById('aeTemp');

    // Histogram & Level handles
    e.histogram     = document.getElementById('aeHistogram');
    e.levelsTrack   = document.getElementById('aeLevelsTrack');
    e.handleBlack   = document.getElementById('aeHandleBlack');
    e.handleGamma   = document.getElementById('aeHandleGamma');
    e.handleWhite   = document.getElementById('aeHandleWhite');

    // Navigation buttons
    e.navPrev = document.getElementById('aeNavPrev');
    e.navNext = document.getElementById('aeNavNext');

    // Buttons
    e.closeTop      = document.getElementById('aeCloseTop');
    e.closeBottom   = document.getElementById('aeCloseBottom');
    e.reset         = document.getElementById('aeReset');
    e.save          = document.getElementById('aeSave');
    e.autoFix       = document.getElementById('aeAutoFix');
    e.cropBtn       = document.getElementById('aeCropBtn');
    e.cropApply     = document.getElementById('aeCropApply');
    e.cropCancel    = document.getElementById('aeCropCancel');
    e.cropToolbar   = document.getElementById('aeCropToolbar');
    e.cropContainer = document.getElementById('aeCropContainer');
    e.cropImage     = document.getElementById('aeCropImage');

    // Preset UI elements
    e.presetSelect  = document.getElementById('aePresetSelect');
    e.presetLoad    = document.getElementById('aePresetLoad');
    e.presetDelete  = document.getElementById('aePresetDelete');
    e.presetName    = document.getElementById('aePresetName');
    e.presetSave    = document.getElementById('aePresetSave');
    e.applyToAll    = document.getElementById('aeApplyToAll');

    this._bindEvents();
    this._bound = true;
  };

  /**
   * Bind all UI events (Phase 1).
   * Every listener goes through _on() so destroy() can remove them.
   */
  AdarshEngine.prototype._bindEvents = function () {
    var self = this;
    var e = this._els;

    // Close buttons
    this._on(e.closeTop,    'click', function () { self.close(); });
    if (e.closeBottom) {
      this._on(e.closeBottom, 'click', function () { self.close(); });
    }

    // Backdrop click closes
    this._on(e.backdrop, 'click', function (ev) {
      if (ev.target === e.backdrop) self.close();
    });

    // Escape key closes; Shift+PageUp/Down navigates
    this._escHandler = function (ev) {
      if (!e.backdrop.classList.contains('ae-open')) return;
      if (ev.key === 'Escape') {
        self.close();
      } else if (ev.shiftKey && ev.key === 'PageUp') {
        ev.preventDefault();
        self.navigatePrev();
      } else if (ev.shiftKey && ev.key === 'PageDown') {
        ev.preventDefault();
        self.navigateNext();
      }
    };
    this._on(document, 'keydown', this._escHandler);

    // Vibrance slider — debounced input
    var vibranceHandler = function () { self._onSliderInput(); };
    this._on(e.vibrance, 'input', vibranceHandler);

    // Temperature slider — debounced input
    var tempHandler = function () { self._onSliderInput(); };
    this._on(e.temp, 'input', tempHandler);

    // Reset (Phase 9)
    this._on(e.reset, 'click', function () { self.reset(); });

    // Save (Phase 6)
    this._on(e.save, 'click', function () { self._save(); });

    // Auto Fix (v2)
    this._on(e.autoFix, 'click', function () { self.autoLevels(); });

    // Manual crop (Phase 5)
    this._on(e.cropBtn,    'click', function () { self._toggleCrop(); });
    this._on(e.cropApply,  'click', function () { self._applyCrop(); });
    this._on(e.cropCancel, 'click', function () { self._cancelCrop(); });

    // Navigation buttons
    this._on(e.navPrev, 'click', function () { self.navigatePrev(); });
    this._on(e.navNext, 'click', function () { self.navigateNext(); });

    // ── Histogram handle dragging ───────────────────────────────
    this._bindLevelHandles();

    // ── Preset controls ─────────────────────────────────────────
    this._bindPresetControls();
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 1: OPEN / CLOSE (Public API)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Open the editor modal with an image.
   *
   * @param {string}   srcUrl   - Image URL (http, blob:, data:).
   * @param {string}   filename - Display name for header.
   * @param {function} onSave   - Callback: (dataUrl, filename) → void.
   */
  AdarshEngine.prototype.open = function (srcUrl, filename, onSave, fsPath) {
    this._resolveElements();
    var self = this;
    var e = this._els;

    // Guard: close any existing session first
    if (e.backdrop && e.backdrop.classList.contains('ae-open')) {
      this.close();
    }

    // Guard: validate srcUrl
    if (!srcUrl || typeof srcUrl !== 'string') {
      this._warn('open() called with invalid srcUrl');
      return;
    }

    this.currentFilename = filename || 'image.jpg';
    this.onSaveCallback = onSave || null;
    this.sourceUrl = srcUrl || '';
    this.sourcePath = fsPath || null;  // explicit filesystem path (for blob URLs)

    e.filename.textContent = this.currentFilename;
    this._resetSliders();
    this._showLoading(true);
    this._hideError();

    // Refresh presets dropdown and clear input
    this._refreshPresetDropdown();
    if (e.presetName) e.presetName.value = '';

    // Save scroll position before locking body scroll
    this._savedScrollY = window.scrollY || window.pageYOffset || 0;

    // Show modal (Phase 1)
    e.backdrop.classList.add('ae-open');
    document.body.style.overflow = 'hidden';

    this._log('Opening editor for:', this.currentFilename);

    // Phase 2: Load image
    this.originalFullResolutionImage = new Image();
    this.originalFullResolutionImage.crossOrigin = 'anonymous';

    this.originalFullResolutionImage.onload = function () {
      self._log('Image loaded:', this.naturalWidth, '×', this.naturalHeight);
      self.loadImage(self.originalFullResolutionImage);
      self._showLoading(false);
      self._updateNavButtons();
    };

    // Phase 8: Error handling — image load failure
    this.originalFullResolutionImage.onerror = function () {
      self._showLoading(false);
      self._showError('Failed to load image. The file may be corrupt or inaccessible.');
      self._warn('Image load failed for:', srcUrl);
    };

    this.originalFullResolutionImage.src = srcUrl;
  };

  /**
   * Close the editor and clean up all state (Phase 14).
   */
  AdarshEngine.prototype.close = function () {
    this._cancelCrop();
    var e = this._els;

    if (e.backdrop) e.backdrop.classList.remove('ae-open');

    // Restore scroll position before unlocking body scroll
    var savedY = this._savedScrollY || 0;
    document.body.style.overflow = '';
    window.scrollTo(0, savedY);

    // Phase 14: Release memory
    this.originalImageData = null;
    this.previewScaledImage = null;
    this.originalFullResolutionImage = null;
    this.onSaveCallback = null;
    this.currentFilename = '';
    this.sourceUrl = '';
    this._saving = false;

    // Phase 7: Cancel pending renders
    if (this.pendingRender) {
      cancelAnimationFrame(this.pendingRender);
      this.pendingRender = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Phase 14: Clear canvas + reset dimensions to free GPU memory
    if (this.canvas && this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.canvas.width = 1;
      this.canvas.height = 1;
    }

    this._log('Editor closed, memory released');
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 2: IMAGE LOADING + CANVAS INIT
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Load an image element into the engine canvas.
   * Scales preview to PREVIEW_MAX if needed, stores originalImageData.
   *
   * @param {HTMLImageElement} imageElement - The loaded image.
   */
  AdarshEngine.prototype.loadImage = function (imageElement) {
    if (!imageElement || !imageElement.naturalWidth) {
      this._showError('Invalid image element.');
      return;
    }

    var w = imageElement.naturalWidth;
    var h = imageElement.naturalHeight;

    // Guard: reject images below minimum dimension
    if (w < AdarshEngine.MIN_IMAGE_DIM || h < AdarshEngine.MIN_IMAGE_DIM) {
      this._showError('Image is too small (' + w + '×' + h + '). Minimum ' + AdarshEngine.MIN_IMAGE_DIM + 'px required.');
      return;
    }

    this.originalFullResolutionImage = imageElement;

    // Phase 7: Scale down for preview if > 2000px (cap at 1200px)
    var pw = w;
    var ph = h;
    if (pw > AdarshEngine.PREVIEW_MAX || ph > AdarshEngine.PREVIEW_MAX) {
      var scale = AdarshEngine.PREVIEW_MAX / Math.max(pw, ph);
      pw = Math.round(pw * scale);
      ph = Math.round(ph * scale);
    }

    // Set canvas dimensions
    this.canvas.width = pw;
    this.canvas.height = ph;

    // Draw scaled preview
    this.ctx.drawImage(imageElement, 0, 0, pw, ph);

    // Phase 2: Capture original pixel data (never mutated)
    this.originalImageData = this.ctx.getImageData(0, 0, pw, ph);

    // Store scaled dimensions
    this.previewScaledImage = { width: pw, height: ph };

    // Update dimensions badge
    if (this._els.dimText) {
      this._els.dimText.textContent = w + ' × ' + h + ' px';
    }

    this._log('Canvas initialized:', pw, '×', ph, '(preview),', w, '×', h, '(full)');

    // Draw histogram from original image data
    this._drawHistogram();
    this._syncHandlePositions();

    // Initial render with current slider values
    this.render();
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 3 + 4: SLIDER HANDLING
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Read all slider values, apply validation (Phase 8), update labels,
   * and schedule a debounced render.
   */
  AdarshEngine.prototype._onSliderInput = function () {
    var e = this._els;

    // Read raw values (NaN-safe)
    var bp = parseInt(e.black.value, 10) || 0;
    var wp = parseInt(e.white.value, 10) || 255;
    var vib = parseInt(e.vibrance.value, 10) || 0;
    var temp = (e.temp ? parseInt(e.temp.value, 10) : 0) || 0;

    // Phase 8: Gamma slider 10–300 → 0.1–3.0. Guard against 0/NaN.
    var rawGamma = parseInt(e.gamma.value, 10) || 100;
    if (rawGamma < 1) rawGamma = 1;  // Prevent gamma = 0
    var gamma = rawGamma / 100;

    // Phase 8: Prevent black >= white (enforce minimum gap of 1)
    if (bp >= wp) {
      bp = wp - 1;
      if (bp < 0) { bp = 0; wp = 1; }
      e.black.value = bp;
      e.white.value = wp;
    }

    // Phase 8: Clamp all values to valid ranges
    bp = Math.max(0, Math.min(254, bp));
    wp = Math.max(1, Math.min(255, wp));
    vib = Math.max(-100, Math.min(100, vib));
    gamma = Math.max(0.01, Math.min(3.0, gamma));
    temp = Math.max(-100, Math.min(100, temp));

    // Store parameters
    this.params.blackPoint = bp;
    this.params.whitePoint = wp;
    this.params.gamma = gamma;
    this.params.vibrance = vib;
    this.params.temperature = temp;

    // Update value labels
    e.blackVal.textContent    = bp;
    e.gammaVal.textContent    = gamma.toFixed(2);
    e.whiteVal.textContent    = wp;
    e.vibranceVal.textContent = vib;
    if (e.tempVal) e.tempVal.textContent = temp;

    // Phase 7: Debounce + rAF render
    this._scheduleRender();

    this._log('Sliders:', 'B=' + bp, 'G=' + gamma.toFixed(2), 'W=' + wp, 'V=' + vib, 'T=' + temp);
  };

  /**
   * Debounce slider changes → requestAnimationFrame (Phase 7).
   */
  AdarshEngine.prototype._scheduleRender = function () {
    var self = this;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(function () {
      if (self.pendingRender) cancelAnimationFrame(self.pendingRender);
      self.pendingRender = requestAnimationFrame(function () { self.render(); });
    }, AdarshEngine.DEBOUNCE_MS);
  };

  /**
   * Reset all sliders to default values (Phase 9).
   * Does NOT reload from backend. Does NOT destroy originalImageData.
   */
  AdarshEngine.prototype._resetSliders = function () {
    var e = this._els;
    if (!e.black) return;

    e.black.value    = 0;
    e.gamma.value    = 100;
    e.white.value    = 255;
    e.vibrance.value = 0;
    if (e.temp) e.temp.value = 0;

    this.params.blackPoint = 0;
    this.params.gamma      = 1.0;
    this.params.whitePoint = 255;
    this.params.vibrance   = 0;
    this.params.temperature = 0;

    e.blackVal.textContent    = '0';
    e.gammaVal.textContent    = '1.00';
    e.whiteVal.textContent    = '255';
    e.vibranceVal.textContent = '0';
    if (e.tempVal) e.tempVal.textContent = '0';

    this._syncHandlePositions();
  };

  /**
   * Full reset: sliders + re-render from originalImageData (Phase 9).
   * Does NOT reload image from backend or destroy the full-res copy.
   */
  AdarshEngine.prototype.reset = function () {
    this._resetSliders();
    this.render();
    this._log('Reset to original');
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 8: ERROR / LOADING UI HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Show the loading spinner overlay.
   * @param {boolean} show
   */
  AdarshEngine.prototype._showLoading = function (show) {
    if (this._els.loading) {
      this._els.loading.style.display = show ? '' : 'none';
    }
  };

  /**
   * Show an error message inside the canvas area (Phase 8).
   * @param {string} msg
   */
  AdarshEngine.prototype._showError = function (msg) {
    var e = this._els;
    if (e.errorOverlay && e.errorMsg) {
      e.errorMsg.textContent = msg;
      e.errorOverlay.style.display = '';
    } else {
      // Fallback if error overlay not in DOM
      this._warn(msg);
    }
  };

  /**
   * Hide the error overlay.
   */
  AdarshEngine.prototype._hideError = function () {
    if (this._els.errorOverlay) {
      this._els.errorOverlay.style.display = 'none';
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PRESETS SYSTEM
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Bind preset control events.
   */
  AdarshEngine.prototype._bindPresetControls = function () {
    var self = this;
    var e = this._els;

    if (!e.presetSelect) return; // Presets UI not present

    // Populate presets on modal open
    this._refreshPresetDropdown();

    // Auto-apply preset when dropdown selection changes
    this._on(e.presetSelect, 'change', function () { 
      if (e.presetSelect.value) {
        self._loadSelectedPreset(); 
      }
    });

    // Load preset (manual button click)
    this._on(e.presetLoad, 'click', function () { self._loadSelectedPreset(); });

    // Delete preset
    this._on(e.presetDelete, 'click', function () { self._deleteSelectedPreset(); });

    // Save preset
    this._on(e.presetSave, 'click', function () { self._saveCurrentAsPreset(); });

    // Apply to All
    if (e.applyToAll) {
      this._on(e.applyToAll, 'click', function () { self._applyToAllImages(); });
    }
  };

  /**
   * Refresh the preset dropdown with current presets.
   */
  AdarshEngine.prototype._refreshPresetDropdown = function () {
    var e = this._els;
    if (!e.presetSelect || typeof AdarshEnginePresets === 'undefined') return;

    var presets = AdarshEnginePresets.getAll();
    var select = e.presetSelect;

    // Clear existing options except the first placeholder
    while (select.options.length > 1) {
      select.remove(1);
    }

    // Add presets
    for (var i = 0; i < presets.length; i++) {
      var opt = document.createElement('option');
      opt.value = presets[i].id;
      opt.textContent = presets[i].name;
      select.appendChild(opt);
    }

    // Reset selection
    select.value = '';
  };

  /**
   * Load the currently selected preset and apply it.
   */
  AdarshEngine.prototype._loadSelectedPreset = function () {
    var e = this._els;
    if (!e.presetSelect || typeof AdarshEnginePresets === 'undefined') return;

    var presetId = e.presetSelect.value;
    if (!presetId) {
      alert('Please select a preset first.');
      return;
    }

    var preset = AdarshEnginePresets.get(presetId);
    if (!preset) {
      alert('Preset not found.');
      return;
    }

    // Apply preset values
    this._applyPresetParams(preset.params);
    this._log('Loaded preset: ' + preset.name);
  };

  /**
   * Apply preset parameters to the current image.
   */
  AdarshEngine.prototype._applyPresetParams = function (params) {
    var e = this._els;

    // Set slider values
    e.black.value = params.blackPoint || 0;
    e.gamma.value = Math.round((params.gamma || 1.0) * 100);
    e.white.value = params.whitePoint || 255;
    e.vibrance.value = params.vibrance || 0;
    if (e.temp) e.temp.value = params.temperature || 0;

    // Update params object
    this.params.blackPoint = params.blackPoint || 0;
    this.params.gamma = params.gamma || 1.0;
    this.params.whitePoint = params.whitePoint || 255;
    this.params.vibrance = params.vibrance || 0;
    this.params.temperature = params.temperature || 0;

    // Update display values (handle 0 correctly)
    e.blackVal.textContent = String(params.blackPoint != null ? params.blackPoint : 0);
    e.gammaVal.textContent = (params.gamma || 1.0).toFixed(2);
    e.whiteVal.textContent = String(params.whitePoint != null ? params.whitePoint : 255);
    e.vibranceVal.textContent = String(params.vibrance != null ? params.vibrance : 0);
    if (e.tempVal) e.tempVal.textContent = String(params.temperature != null ? params.temperature : 0);

    // Sync handle positions and re-render
    this._syncHandlePositions();
    this.render();
  };

  /**
   * Delete the currently selected preset.
   */
  AdarshEngine.prototype._deleteSelectedPreset = function () {
    var e = this._els;
    if (!e.presetSelect || typeof AdarshEnginePresets === 'undefined') return;

    var presetId = e.presetSelect.value;
    if (!presetId) {
      alert('Please select a preset to delete.');
      return;
    }

    var preset = AdarshEnginePresets.get(presetId);
    if (!preset) return;

    if (!confirm('Delete preset "' + preset.name + '"?')) return;

    AdarshEnginePresets.delete(presetId);
    this._refreshPresetDropdown();
    this._log('Deleted preset: ' + preset.name);
  };

  /**
   * Save current adjustments as a new preset.
   */
  AdarshEngine.prototype._saveCurrentAsPreset = function () {
    var e = this._els;
    if (!e.presetName || typeof AdarshEnginePresets === 'undefined') return;

    var name = e.presetName.value.trim();
    if (!name) {
      alert('Please enter a preset name.');
      e.presetName.focus();
      return;
    }

    if (AdarshEnginePresets.nameExists(name)) {
      if (!confirm('A preset named "' + name + '" already exists. Overwrite it?')) {
        return;
      }
      // Delete existing and re-add
      var presets = AdarshEnginePresets.getAll();
      for (var i = 0; i < presets.length; i++) {
        if (presets[i].name.toLowerCase() === name.toLowerCase()) {
          AdarshEnginePresets.delete(presets[i].id);
          break;
        }
      }
    }

    // Create preset from current params
    AdarshEnginePresets.add(name, {
      blackPoint: this.params.blackPoint,
      gamma: this.params.gamma,
      whitePoint: this.params.whitePoint,
      vibrance: this.params.vibrance,
      temperature: this.params.temperature,
    });

    e.presetName.value = '';
    this._refreshPresetDropdown();
    this._log('Saved preset: ' + name);
    alert('Preset "' + name + '" saved successfully!');
  };

  /**
   * Get current adjustment parameters.
   */
  AdarshEngine.prototype.getParams = function () {
    return {
      blackPoint: this.params.blackPoint,
      gamma: this.params.gamma,
      whitePoint: this.params.whitePoint,
      vibrance: this.params.vibrance,
      temperature: this.params.temperature,
    };
  };

  /**
   * Apply to all callback — can be overridden by the page.
   */
  AdarshEngine.prototype._applyToAllImages = function () {
    // This calls the onApplyToAll callback if set
    if (typeof this.onApplyToAllCallback === 'function') {
      this.onApplyToAllCallback(this.getParams());
    } else {
      alert('Apply to All is not configured for this page.');
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 14: FULL DESTROY
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Completely destroy the engine instance.
   * Removes all event listeners, clears canvas, releases references.
   * Call this when the engine is no longer needed.
   */
  AdarshEngine.prototype.destroy = function () {
    this._log('Destroying engine instance');

    // Close modal if open
    this.close();

    // Remove all tracked event listeners
    this._offAll();

    // Clear canvas
    if (this.canvas && this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.canvas.width = 0;
      this.canvas.height = 0;
    }

    // Null out all references
    this.canvas = null;
    this.ctx = null;
    this.originalFullResolutionImage = null;
    this.previewScaledImage = null;
    this.originalImageData = null;
    this.onSaveCallback = null;
    this.sourceUrl = '';
    this._saving = false;
    this._els = {};
    this._bound = false;

    this._log('Engine destroyed');
  };

  // ═══════════════════════════════════════════════════════════════════
  //  SINGLETON INSTANCE + PUBLIC INTERFACE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Singleton instance — created lazily on first open().
   * @type {AdarshEngine|null}
   */
  var _instance = null;

  /**
   * Get or create the singleton engine instance.
   * @returns {AdarshEngine}
   */
  function _getInstance() {
    if (!_instance) {
      _instance = new AdarshEngine('aeCanvas');
    }
    return _instance;
  }

  // ── Expose public API on window ─────────────────────────────────

  window.AdarshEngine = {
    /** Engine version (Phase 16). */
    VERSION: AdarshEngine.VERSION,

    /**
     * Open the photo correction editor (Phase 1).
     *
     * @param {string}   srcUrl   - Image URL (http, blob:, data:).
     * @param {string}   filename - Display filename.
     * @param {function} onSave   - Callback: (dataUrl, filename) → void.
     */
    open: function (srcUrl, filename, onSave) {
      _getInstance().open(srcUrl, filename, onSave);
    },

    /** Close the editor (Phase 14). */
    close: function () {
      if (_instance) _instance.close();
    },

    /** Full destroy — removes listeners, frees memory (Phase 14). */
    destroy: function () {
      if (_instance) {
        _instance.destroy();
        _instance = null;
      }
    },

    /**
     * Enable or disable debug logging (Phase 13).
     * Ignored when IS_PRODUCTION is true.
     * @param {boolean} enabled
     */
    setDebug: function (enabled) {
      if (AdarshEngine.IS_PRODUCTION) return;
      _getInstance().debug = !!enabled;
    },

    /**
     * v2: Auto Levels — histogram-based intelligent correction.
     * Analyses luminance histogram with 0.5% outlier clipping
     * to find optimal black point, white point, and gamma.
     */
    autoLevels: function () {
      _getInstance().autoLevels();
    },

    /**
     * v2: Future placeholder — auto skin-tone balance.
     */
    autoSkinBalance: function () {
      _getInstance().autoSkinBalance();
    },

    /**
     * v2: Future placeholder — background whitening.
     */
    backgroundWhitening: function () {
      _getInstance().backgroundWhitening();
    },

    /**
     * v2: Future placeholder — sharpness enhancement.
     */
    sharpnessEnhancement: function () {
      _getInstance().sharpnessEnhancement();
    },

    /**
     * v3: Set image list for prev/next navigation.
     * @param {Array<{url: string, name: string}>} images
     * @param {number} currentIndex
     * @param {function} onNavigate - callback(url, name)
     */
    setImageList: function (images, currentIndex, onNavigate) {
      _getInstance().setImageList(images, currentIndex, onNavigate);
    },

    /** v3: Navigate to previous image. */
    navigatePrev: function () {
      _getInstance().navigatePrev();
    },

    /** v3: Navigate to next image. */
    navigateNext: function () {
      _getInstance().navigateNext();
    },

    /**
     * Set callback for "Apply to All" button.
     * @param {function} callback - function(params) receives current adjustments
     */
    setApplyToAllCallback: function (callback) {
      _getInstance().onApplyToAllCallback = callback;
    },

    /**
     * Get current adjustment parameters.
     * @returns {Object} {blackPoint, gamma, whitePoint, vibrance, temperature}
     */
    getParams: function () {
      return _getInstance().getParams();
    },

    /**
     * Apply preset parameters to the current image.
     * @param {Object} params - {blackPoint, gamma, whitePoint, vibrance, temperature}
     */
    applyParams: function (params) {
      _getInstance()._applyPresetParams(params);
    },

    /**
     * Refresh the preset dropdown (call after adding/deleting presets externally).
     */
    refreshPresets: function () {
      _getInstance()._refreshPresetDropdown();
    },

    /** Access the underlying class for advanced usage. */
    _Engine: AdarshEngine,
  };

})();
