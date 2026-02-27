/**
 * AdarshEngine v1 — Photo Correction Engine
 * ═══════════════════════════════════════════
 *
 * Professional ID-photo correction tool that runs entirely in the browser.
 * Built as a modular class for maintainability and clean lifecycle management.
 *
 * Features:
 *   1. Levels Adjustment  (Black Point / Gamma / White Point)
 *   2. Vibrance           (Skin-safe, protects saturated colours)
 *   3. Manual Crop        (Reuses existing Cropper.js in vendor/)
 *   4. Full-resolution save pipeline
 *   5. Auto-levels placeholder (Phase 12)
 *
 * Architecture:
 *   - ALL image processing happens on an HTML5 Canvas (no backend).
 *   - Stores originalImageData on load; every slider change reapplies
 *     the full pipeline from scratch → zero quality degradation.
 *   - Preview capped at 1200px; full-res kept separately for export.
 *   - No CDN, no WebGL, no external dependencies — 100% offline.
 *   - Event listeners tracked for clean destroy (Phase 14).
 *   - Optional debug logging (Phase 13).
 *
 * Integration:
 *   - window.AdarshEngine.open(srcUrl, filename, onSave)
 *   - Does NOT modify existing cropper files, save endpoints, or
 *     preview logic.
 *
 * @module adarshengine
 * @version 1.0.0
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

    // ── Phase 13: Debug logging ───────────────────────────────────
    this.debug = false;

    // ── Phase 14: Tracked event listeners for clean destroy ───────
    this._listeners = [];  // Array of { el, event, handler }

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
  AdarshEngine.VERSION = '1.0.0';

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
    if (!this.debug) return;
    var args = ['[AdarshEngine]'].concat(Array.prototype.slice.call(arguments));
    console.log.apply(console, args);
  };

  /**
   * Log a warning (always, regardless of debug flag).
   */
  AdarshEngine.prototype._warn = function () {
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

    // Sliders
    e.black    = document.getElementById('aeBlack');
    e.gamma    = document.getElementById('aeGamma');
    e.white    = document.getElementById('aeWhite');
    e.vibrance = document.getElementById('aeVibrance');

    // Slider value labels
    e.blackVal    = document.getElementById('aeBlackVal');
    e.gammaVal    = document.getElementById('aeGammaVal');
    e.whiteVal    = document.getElementById('aeWhiteVal');
    e.vibranceVal = document.getElementById('aeVibranceVal');

    // Buttons
    e.closeTop      = document.getElementById('aeCloseTop');
    e.closeBottom   = document.getElementById('aeCloseBottom');
    e.reset         = document.getElementById('aeReset');
    e.save          = document.getElementById('aeSave');
    e.cropBtn       = document.getElementById('aeCropBtn');
    e.cropApply     = document.getElementById('aeCropApply');
    e.cropCancel    = document.getElementById('aeCropCancel');
    e.cropToolbar   = document.getElementById('aeCropToolbar');
    e.cropContainer = document.getElementById('aeCropContainer');
    e.cropImage     = document.getElementById('aeCropImage');

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
    this._on(e.closeBottom, 'click', function () { self.close(); });

    // Backdrop click closes
    this._on(e.backdrop, 'click', function (ev) {
      if (ev.target === e.backdrop) self.close();
    });

    // Escape key closes
    this._escHandler = function (ev) {
      if (ev.key === 'Escape' && e.backdrop.classList.contains('ae-open')) {
        self.close();
      }
    };
    this._on(document, 'keydown', this._escHandler);

    // Sliders — debounced input (Phase 3, 4, 7)
    var sliderHandler = function () { self._onSliderInput(); };
    this._on(e.black,    'input', sliderHandler);
    this._on(e.gamma,    'input', sliderHandler);
    this._on(e.white,    'input', sliderHandler);
    this._on(e.vibrance, 'input', sliderHandler);

    // Reset (Phase 9)
    this._on(e.reset, 'click', function () { self.reset(); });

    // Save (Phase 6)
    this._on(e.save, 'click', function () { self._save(); });

    // Manual crop (Phase 5)
    this._on(e.cropBtn,    'click', function () { self._toggleCrop(); });
    this._on(e.cropApply,  'click', function () { self._applyCrop(); });
    this._on(e.cropCancel, 'click', function () { self._cancelCrop(); });
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
  AdarshEngine.prototype.open = function (srcUrl, filename, onSave) {
    this._resolveElements();
    var self = this;
    var e = this._els;

    this.currentFilename = filename || 'image.jpg';
    this.onSaveCallback = onSave || null;

    e.filename.textContent = this.currentFilename;
    this._resetSliders();
    this._showLoading(true);
    this._hideError();

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
    document.body.style.overflow = '';

    // Phase 14: Release memory
    this.originalImageData = null;
    this.previewScaledImage = null;
    // Keep originalFullResolutionImage reference for potential re-open
    this.originalFullResolutionImage = null;
    this.onSaveCallback = null;
    this.currentFilename = '';

    // Phase 7: Cancel pending renders
    if (this.pendingRender) {
      cancelAnimationFrame(this.pendingRender);
      this.pendingRender = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Phase 14: Clear canvas to free GPU memory
    if (this.canvas && this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
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

    this.originalFullResolutionImage = imageElement;
    var w = imageElement.naturalWidth;
    var h = imageElement.naturalHeight;

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

    // Read raw values
    var bp = parseInt(e.black.value, 10);
    var wp = parseInt(e.white.value, 10);
    var vib = parseInt(e.vibrance.value, 10);

    // Phase 8: Gamma slider 10–300 → 0.1–3.0. Guard against 0.
    var rawGamma = parseInt(e.gamma.value, 10);
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

    // Store parameters
    this.params.blackPoint = bp;
    this.params.whitePoint = wp;
    this.params.gamma = gamma;
    this.params.vibrance = vib;

    // Update value labels
    e.blackVal.textContent    = bp;
    e.gammaVal.textContent    = gamma.toFixed(2);
    e.whiteVal.textContent    = wp;
    e.vibranceVal.textContent = vib;

    // Phase 7: Debounce + rAF render
    this._scheduleRender();

    this._log('Sliders:', 'B=' + bp, 'G=' + gamma.toFixed(2), 'W=' + wp, 'V=' + vib);
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

    this.params.blackPoint = 0;
    this.params.gamma      = 1.0;
    this.params.whitePoint = 255;
    this.params.vibrance   = 0;

    e.blackVal.textContent    = '0';
    e.gammaVal.textContent    = '1.00';
    e.whiteVal.textContent    = '255';
    e.vibranceVal.textContent = '0';
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
  //  PHASE 3 + 4: RENDER PIPELINE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Master render function (Phase 3 + 4).
   *
   * Pipeline:
   *   1. Copy originalImageData (never mutate it).
   *   2. Apply Levels (Phase 3).
   *   3. Apply Vibrance (Phase 4).
   *   4. Put result on canvas.
   *
   * Wrapped in try/catch for safety (Phase 8).
   */
  AdarshEngine.prototype.render = function () {
    this.pendingRender = null;
    if (!this.originalImageData) return;

    try {
      var t0 = this.debug ? performance.now() : 0;

      // Create a working copy — never mutate the original
      var src = this.originalImageData.data;
      var out = this.ctx.createImageData(
        this.originalImageData.width,
        this.originalImageData.height
      );
      var dst = out.data;

      // Run the combined pipeline
      this._applyPipeline(src, dst, src.length);

      // Put processed pixels on canvas
      this.ctx.putImageData(out, 0, 0);

      // Phase 13: Debug timing
      if (this.debug) {
        var dt = (performance.now() - t0).toFixed(1);
        this._log('Render:', dt + 'ms,', (src.length / 4) + ' pixels');
      }
    } catch (err) {
      // Phase 8: Catch render errors gracefully
      this._warn('Render error:', err.message);
    }
  };

  /**
   * Apply the full correction pipeline on pixel arrays (Phase 3 + 4).
   * Shared between preview render and full-res save.
   *
   * @param {Uint8ClampedArray} src  - Source pixel data (RGBA).
   * @param {Uint8ClampedArray} dst  - Destination pixel data (RGBA).
   * @param {number}            len  - Total byte length (w × h × 4).
   */
  AdarshEngine.prototype._applyPipeline = function (src, dst, len) {
    var bp    = this.params.blackPoint;
    var wp    = this.params.whitePoint;
    var gamma = this.params.gamma;
    var vib   = this.params.vibrance / 100;  // normalise to -1…+1

    // ── Phase 8: Safety guards ──────────────────────────────────
    if (gamma <= 0) gamma = 0.01;
    var range = wp - bp;
    if (range < 1) range = 1;  // prevent division by zero

    var invRange = 1 / range;
    var invGamma = 1 / gamma;

    // ── Phase 3: Pre-compute LUT for Levels ─────────────────────
    // Maps 0–255 input → 0–255 output after levels + gamma.
    // LUT avoids per-pixel pow() calls for massive speed gain.
    var lut = new Uint8Array(256);
    for (var i = 0; i < 256; i++) {
      // 1. Normalise against black/white points
      var norm = (i - bp) * invRange;
      // 2. Clamp 0–1
      if (norm < 0) norm = 0;
      if (norm > 1) norm = 1;
      // 3. Gamma correction
      var gc = Math.pow(norm, invGamma);
      // 4. Map back to 0–255 (fast round)
      lut[i] = (gc * 255 + 0.5) | 0;
    }

    // ── Process every pixel ─────────────────────────────────────
    for (var p = 0; p < len; p += 4) {
      // Phase 3: Apply Levels via LUT
      var r = lut[src[p]];
      var g = lut[src[p + 1]];
      var b = lut[src[p + 2]];

      // Phase 4: Apply Vibrance (skin-safe algorithm)
      if (vib !== 0) {
        // Find max channel value (saturation proxy)
        var maxC = r;
        if (g > maxC) maxC = g;
        if (b > maxC) maxC = b;

        // Average across channels
        var avg = (r + g + b) / 3;

        // Difference: high when pixel is already saturated, low when grey
        var diff = maxC - avg;

        // Amount: boost less-saturated pixels more, protect already-
        // saturated colours. Quadratic scaling for smooth response.
        // diff/255 → 0 when fully saturated, 1 when grey.
        var sat = diff / 255;
        var amt = vib * (1 - sat) * (1 - sat);

        // Shift each channel toward/away from its distance to average
        r = AdarshEngine._clamp255(r + (r - avg) * amt);
        g = AdarshEngine._clamp255(g + (g - avg) * amt);
        b = AdarshEngine._clamp255(b + (b - avg) * amt);
      }

      dst[p]     = r;
      dst[p + 1] = g;
      dst[p + 2] = b;
      dst[p + 3] = src[p + 3]; // preserve alpha
    }
  };

  /**
   * Clamp value to 0–255 integer (static utility).
   * @param {number} v
   * @returns {number}
   */
  AdarshEngine._clamp255 = function (v) {
    if (v < 0) return 0;
    if (v > 255) return 255;
    return v | 0;
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 12: AUTO LEVELS (Placeholder — NOT implemented)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Auto-detect optimal black point, white point, and gamma by
   * analysing the image histogram.
   *
   * PLACEHOLDER — will be implemented in a future release.
   *
   * Future algorithm:
   *   1. Build histogram for R, G, B channels.
   *   2. Find min pixel (ignore bottom 0.5% outliers) → black point.
   *   3. Find max pixel (ignore top 0.5% outliers) → white point.
   *   4. Compute mean luminance → derive gamma for balanced midtones.
   *   5. Apply values to sliders and trigger render().
   */
  AdarshEngine.prototype.autoLevels = function () {
    this._log('autoLevels() called — not yet implemented');
    // TODO: Implement histogram analysis
    // TODO: Set this.params.blackPoint, whitePoint, gamma
    // TODO: Update slider DOM elements
    // TODO: Call this.render()
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 5: MANUAL CROP (using existing Cropper.js)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Toggle crop mode on/off.
   */
  AdarshEngine.prototype._toggleCrop = function () {
    if (this.cropActive) {
      this._cancelCrop();
    } else {
      this._startCrop();
    }
  };

  /**
   * Enter crop mode (Phase 5):
   *  1. Export current canvas to data URL.
   *  2. Show Cropper.js container over canvas.
   *  3. Hide the canvas.
   */
  AdarshEngine.prototype._startCrop = function () {
    if (this.cropActive) return;
    var self = this;
    var e = this._els;

    // Export current (filtered) canvas as crop source
    var dataUrl = this.canvas.toDataURL('image/png');
    e.cropImage.src = dataUrl;

    // Show crop container, hide canvas
    e.cropContainer.classList.add('ae-visible');
    this.canvas.style.display = 'none';

    // Small timeout to ensure image is rendered in DOM
    setTimeout(function () {
      if (self.cropperInstance) {
        self.cropperInstance.destroy();
        self.cropperInstance = null;
      }

      // Phase 8: Guard against missing Cropper.js
      var CropperLib = window.Cropper;
      if (!CropperLib) {
        self._showError('Cropper.js is not loaded. Cannot crop.');
        self._cancelCrop();
        return;
      }

      self.cropperInstance = new CropperLib(e.cropImage, {
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,
        responsive: true,
        restore: false,
        guides: true,
        center: true,
        highlight: true,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        background: true,
      });
    }, 80);

    // Toggle UI state
    this.cropActive = true;
    e.cropBtn.classList.add('ae-active');
    e.cropBtn.innerHTML =
      '<i class="fa-solid fa-crop-simple" aria-hidden="true"></i> Cropping…';
    e.cropToolbar.classList.add('ae-visible');

    this._log('Crop mode started');
  };

  /**
   * Apply the crop result (Phase 5):
   *  1. Get cropped canvas from Cropper.js.
   *  2. Create new Image from result.
   *  3. Replace originalFullResolutionImage + originalImageData.
   *  4. Re-init canvas engine (crop modifies the base image).
   */
  AdarshEngine.prototype._applyCrop = function () {
    if (!this.cropperInstance) { this._cancelCrop(); return; }
    var self = this;
    var e = this._els;

    var croppedCanvas = this.cropperInstance.getCroppedCanvas({
      maxWidth: 4096,
      maxHeight: 4096,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });

    if (!croppedCanvas) { this._cancelCrop(); return; }

    var dataUrl = croppedCanvas.toDataURL('image/png');

    // Destroy cropper instance
    this.cropperInstance.destroy();
    this.cropperInstance = null;

    // Hide crop UI, show canvas
    e.cropContainer.classList.remove('ae-visible');
    this.canvas.style.display = '';
    this.cropActive = false;
    e.cropBtn.classList.remove('ae-active');
    e.cropBtn.innerHTML =
      '<i class="fa-solid fa-crop-simple" aria-hidden="true"></i> Manual Crop';
    e.cropToolbar.classList.remove('ae-visible');

    // Load cropped result as new base image
    this._showLoading(true);
    var img = new Image();
    img.onload = function () {
      // Replace the full-res image with cropped version
      self.loadImage(img);
      self._showLoading(false);
      self._log('Crop applied:', img.naturalWidth, '×', img.naturalHeight);
    };
    img.onerror = function () {
      self._showLoading(false);
      self._showError('Failed to apply crop.');
    };
    img.src = dataUrl;
  };

  /**
   * Cancel crop mode without applying (Phase 5).
   */
  AdarshEngine.prototype._cancelCrop = function () {
    if (this.cropperInstance) {
      this.cropperInstance.destroy();
      this.cropperInstance = null;
    }

    var e = this._els;
    if (e.cropContainer) e.cropContainer.classList.remove('ae-visible');
    if (this.canvas) this.canvas.style.display = '';
    this.cropActive = false;

    if (e.cropBtn) {
      e.cropBtn.classList.remove('ae-active');
      e.cropBtn.innerHTML =
        '<i class="fa-solid fa-crop-simple" aria-hidden="true"></i> Manual Crop';
    }
    if (e.cropToolbar) {
      e.cropToolbar.classList.remove('ae-visible');
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 6: SAVE — Re-apply pipeline at full resolution
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Save the edited image:
   *  1. Apply levels + vibrance to FULL resolution image.
   *  2. Export full-res canvas as data URL.
   *  3. Call onSaveCallback (replaces preview, triggers existing save).
   *
   * Ensures no resolution loss (Phase 6).
   */
  AdarshEngine.prototype._save = function () {
    if (!this.originalFullResolutionImage) return;
    var self = this;
    var e = this._els;

    e.save.disabled = true;
    e.save.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Saving…';

    // Phase 7: Let UI update before heavy pixel work
    setTimeout(function () {
      try {
        var fullImg = self.originalFullResolutionImage;
        var fw = fullImg.naturalWidth;
        var fh = fullImg.naturalHeight;

        self._log('Saving at full resolution:', fw, '×', fh);
        var t0 = self.debug ? performance.now() : 0;

        // Draw full-res to offscreen canvas
        var offscreen = document.createElement('canvas');
        offscreen.width = fw;
        offscreen.height = fh;
        var offCtx = offscreen.getContext('2d', { willReadFrequently: true });
        offCtx.drawImage(fullImg, 0, 0, fw, fh);

        // Get full-res pixel data
        var srcData = offCtx.getImageData(0, 0, fw, fh);
        var dstData = offCtx.createImageData(fw, fh);

        // Apply the same pipeline at full resolution
        self._applyPipeline(srcData.data, dstData.data, srcData.data.length);

        offCtx.putImageData(dstData, 0, 0);

        // Export as JPEG data URL (high quality)
        var dataUrl = offscreen.toDataURL('image/jpeg', 0.92);

        if (self.debug) {
          var dt = (performance.now() - t0).toFixed(0);
          self._log('Full-res pipeline:', dt + 'ms');
        }

        // Phase 14: Clean up offscreen canvas
        offscreen.width = 0;
        offscreen.height = 0;
        offscreen = null;
        offCtx = null;

        // Phase 6: Call the callback (replaces preview + triggers save)
        if (typeof self.onSaveCallback === 'function') {
          self.onSaveCallback(dataUrl, self.currentFilename);
        }

        // Toast feedback (use existing Toast if available)
        if (typeof Toast !== 'undefined') {
          Toast.success('Image saved!');
        }

        self.close();

      } catch (err) {
        // Phase 8: Catch save errors
        self._warn('Save failed:', err);
        self._showError('Save failed: ' + (err.message || 'Unknown error'));
      } finally {
        if (e.save) {
          e.save.disabled = false;
          e.save.innerHTML =
            '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save';
        }
      }
    }, 50);
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
     * @param {boolean} enabled
     */
    setDebug: function (enabled) {
      _getInstance().debug = !!enabled;
    },

    /**
     * Auto-levels placeholder (Phase 12).
     * Will be implemented in a future release.
     */
    autoLevels: function () {
      _getInstance().autoLevels();
    },

    /** Access the underlying class for advanced usage. */
    _Engine: AdarshEngine,
  };

})();
