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
  };

  /**
   * Bind mousedown/mousemove/mouseup for the levels handles.
   */
  AdarshEngine.prototype._bindLevelHandles = function () {
    var self = this;
    var e = this._els;
    if (!e.levelsTrack) return;

    var trackEl = e.levelsTrack;

    function getPercent(clientX) {
      var rect = trackEl.getBoundingClientRect();
      var pct = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(1, pct));
    }

    function onMouseDown(ev) {
      var target = ev.target.closest('.ae-levels-handle');
      if (!target) return;
      ev.preventDefault();
      if (target === e.handleBlack) self._dragging = 'black';
      else if (target === e.handleGamma) self._dragging = 'gamma';
      else if (target === e.handleWhite) self._dragging = 'white';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(ev) {
      if (!self._dragging) return;
      var pct = getPercent(ev.clientX);
      self._updateHandleFromDrag(self._dragging, pct);
    }

    function onMouseUp() {
      self._dragging = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    this._on(trackEl, 'mousedown', onMouseDown);

    // Touch support
    function onTouchStart(ev) {
      var target = ev.target.closest('.ae-levels-handle');
      if (!target) return;
      ev.preventDefault();
      if (target === e.handleBlack) self._dragging = 'black';
      else if (target === e.handleGamma) self._dragging = 'gamma';
      else if (target === e.handleWhite) self._dragging = 'white';
      trackEl.addEventListener('touchmove', onTouchMove, { passive: false });
      trackEl.addEventListener('touchend', onTouchEnd);
    }

    function onTouchMove(ev) {
      if (!self._dragging) return;
      ev.preventDefault();
      var touch = ev.touches[0];
      var pct = getPercent(touch.clientX);
      self._updateHandleFromDrag(self._dragging, pct);
    }

    function onTouchEnd() {
      self._dragging = null;
      trackEl.removeEventListener('touchmove', onTouchMove);
      trackEl.removeEventListener('touchend', onTouchEnd);
    }

    this._on(trackEl, 'touchstart', onTouchStart);
  };

  /**
   * Update parameters and UI when a handle is dragged.
   * @param {string} handle - 'black' | 'gamma' | 'white'
   * @param {number} pct    - 0..1 position on the track
   */
  AdarshEngine.prototype._updateHandleFromDrag = function (handle, pct) {
    var e = this._els;

    if (handle === 'black') {
      var bp = Math.round(pct * 255);
      // Don't let black pass white
      if (bp >= this.params.whitePoint) bp = this.params.whitePoint - 1;
      if (bp < 0) bp = 0;
      this.params.blackPoint = bp;
      e.black.value = bp;
      e.blackVal.textContent = bp;
      e.handleBlack.style.left = ((bp / 255) * 100) + '%';
    } else if (handle === 'white') {
      var wp = Math.round(pct * 255);
      // Don't let white pass black
      if (wp <= this.params.blackPoint) wp = this.params.blackPoint + 1;
      if (wp > 255) wp = 255;
      this.params.whitePoint = wp;
      e.white.value = wp;
      e.whiteVal.textContent = wp;
      e.handleWhite.style.left = ((wp / 255) * 100) + '%';
    } else if (handle === 'gamma') {
      // Gamma track maps 0..1 → gamma 0.1..3.0 (logarithmic)
      // pct=0 → gamma 3.0 (brighten), pct=1 → gamma 0.1 (darken), pct=0.5 → gamma 1.0
      var gamma;
      if (pct <= 0.5) {
        // Left half: 3.0 → 1.0
        gamma = 3.0 - (pct / 0.5) * 2.0;
      } else {
        // Right half: 1.0 → 0.1
        gamma = 1.0 - ((pct - 0.5) / 0.5) * 0.9;
      }
      gamma = Math.max(0.1, Math.min(3.0, gamma));
      gamma = Math.round(gamma * 100) / 100;
      this.params.gamma = gamma;
      e.gamma.value = Math.round(gamma * 100);
      e.gammaVal.textContent = gamma.toFixed(2);
      e.handleGamma.style.left = (pct * 100) + '%';
    }

    // Reposition gamma handle between black and white if black/white moved
    if (handle !== 'gamma') {
      this._repositionGammaHandle();
    }

    this._scheduleRender();
  };

  /**
   * Reposition gamma handle to maintain relative position between black and white.
   */
  AdarshEngine.prototype._repositionGammaHandle = function () {
    var e = this._els;
    var gamma = this.params.gamma;
    var pct;
    if (gamma >= 1.0) {
      pct = ((3.0 - gamma) / 2.0) * 0.5;
    } else {
      pct = 0.5 + ((1.0 - gamma) / 0.9) * 0.5;
    }
    if (e.handleGamma) {
      e.handleGamma.style.left = (pct * 100) + '%';
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  v3: HISTOGRAM DRAWING
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Draw a luminance histogram from originalImageData onto the histogram canvas.
   * Styled like Photoshop's Levels dialog — white histogram bars on dark background.
   */
  AdarshEngine.prototype._drawHistogram = function () {
    var e = this._els;
    if (!e.histogram || !this.originalImageData) return;

    var ctx = e.histogram.getContext('2d');
    var W = e.histogram.width;
    var H = e.histogram.height;
    var data = this.originalImageData.data;

    // Build RGB + luminance histograms
    var histR = new Uint32Array(256);
    var histG = new Uint32Array(256);
    var histB = new Uint32Array(256);
    var histL = new Uint32Array(256);

    for (var i = 0; i < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      histR[r]++;
      histG[g]++;
      histB[b]++;
      var lum = (r * 299 + g * 587 + b * 114 + 500) / 1000 | 0;
      if (lum > 255) lum = 255;
      histL[lum]++;
    }

    // Find max for scaling (ignore extremes at 0 and 255 which are often spikes)
    var maxVal = 0;
    for (var j = 2; j < 254; j++) {
      if (histL[j] > maxVal) maxVal = histL[j];
    }
    if (maxVal === 0) maxVal = 1;

    // Clear
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0f0f1f';
    ctx.fillRect(0, 0, W, H);

    // Draw luminance as white filled area
    var barW = W / 256;

    // Draw R, G, B channels with low opacity
    var channels = [
      { hist: histR, color: 'rgba(239, 68, 68, 0.25)' },
      { hist: histG, color: 'rgba(34, 197, 94, 0.25)' },
      { hist: histB, color: 'rgba(59, 130, 246, 0.25)' },
    ];

    channels.forEach(function (ch) {
      ctx.fillStyle = ch.color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (var k = 0; k < 256; k++) {
        var bh = Math.min((ch.hist[k] / maxVal) * H, H);
        var x = k * barW;
        ctx.lineTo(x, H - bh);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    });

    // Draw luminance on top as white
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (var k = 0; k < 256; k++) {
      var bh = Math.min((histL[k] / maxVal) * H, H);
      var x = k * barW;
      ctx.lineTo(x, H - bh);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    this._log('Histogram drawn');
  };

  /**
   * Sync handle positions to current params (e.g. after reset or autoLevels).
   */
  AdarshEngine.prototype._syncHandlePositions = function () {
    var e = this._els;
    if (!e.handleBlack) return;

    e.handleBlack.style.left = ((this.params.blackPoint / 255) * 100) + '%';
    e.handleWhite.style.left = ((this.params.whitePoint / 255) * 100) + '%';
    this._repositionGammaHandle();
  };

  // ═══════════════════════════════════════════════════════════════════
  //  v3: IMAGE NAVIGATION (prev/next)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Set the image list for navigation.
   * @param {Array<{url: string, name: string}>} images - list of images
   * @param {number} currentIndex - index of the currently open image
   * @param {function} onNavigate - callback(url, name) when navigating
   */
  AdarshEngine.prototype.setImageList = function (images, currentIndex, onNavigate) {
    this._imageList = images || [];
    this._imageIndex = currentIndex >= 0 ? currentIndex : -1;
    this._onNavigate = onNavigate || null;
    this._updateNavButtons();
  };

  /**
   * Navigate to the previous image in the list.
   */
  AdarshEngine.prototype.navigatePrev = function () {
    if (this._imageIndex <= 0 || this._imageList.length === 0) return;
    this._imageIndex--;
    this._navigateToCurrentIndex();
  };

  /**
   * Navigate to the next image in the list.
   */
  AdarshEngine.prototype.navigateNext = function () {
    if (this._imageIndex >= this._imageList.length - 1 || this._imageList.length === 0) return;
    this._imageIndex++;
    this._navigateToCurrentIndex();
  };

  /**
   * Load the image at the current index.
   */
  AdarshEngine.prototype._navigateToCurrentIndex = function () {
    var img = this._imageList[this._imageIndex];
    if (!img) return;

    this._log('Navigating to:', img.name, '(index', this._imageIndex, ')');

    // Reset state and load new image
    this._cancelCrop();
    this._resetSliders();
    this._syncHandlePositions();

    this.currentFilename = img.name;
    this.sourceUrl = img.url;
    this._els.filename.textContent = img.name;

    this._showLoading(true);
    this._hideError();

    var self = this;
    this.originalFullResolutionImage = new Image();
    this.originalFullResolutionImage.crossOrigin = 'anonymous';
    this.originalFullResolutionImage.onload = function () {
      self.loadImage(self.originalFullResolutionImage);
      self._showLoading(false);
      self._updateNavButtons();
      if (typeof self._onNavigate === 'function') {
        self._onNavigate(img.url, img.name);
      }
    };
    this.originalFullResolutionImage.onerror = function () {
      self._showLoading(false);
      self._showError('Failed to load image.');
      self._updateNavButtons();
    };
    this.originalFullResolutionImage.src = img.url;
  };

  /**
   * Update prev/next button disabled states.
   */
  AdarshEngine.prototype._updateNavButtons = function () {
    var e = this._els;
    if (e.navPrev) {
      e.navPrev.disabled = this._imageIndex <= 0 || this._imageList.length <= 1;
    }
    if (e.navNext) {
      e.navNext.disabled = this._imageIndex >= this._imageList.length - 1 || this._imageList.length <= 1;
    }
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

    e.filename.textContent = this.currentFilename;
    this._resetSliders();
    this._showLoading(true);
    this._hideError();

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
    var temp  = this.params.temperature || 0; // -100…+100

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
    // ── Temperature: pre-compute R/B shift ──────────────────────
    // Warm: boost red, reduce blue.  Cool: boost blue, reduce red.
    // Uses a gentle cubic curve for natural feel (like Lightroom).
    var tempShiftR = 0, tempShiftB = 0;
    if (temp !== 0) {
      var tNorm = temp / 100;  // -1…+1
      // Cubic for smooth response: sign * abs^0.7 * maxShift
      var sign = tNorm >= 0 ? 1 : -1;
      var curve = sign * Math.pow(Math.abs(tNorm), 0.7);
      tempShiftR =  curve * 30;  // max ±30
      tempShiftB = -curve * 30;  // opposite direction
    }

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

      // Apply Temperature shift (warm/cool toning)
      if (temp !== 0) {
        r = AdarshEngine._clamp255(r + tempShiftR);
        b = AdarshEngine._clamp255(b + tempShiftB);
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
  //  v2: AUTO LEVELS — Histogram-based intelligent correction
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Auto-detect optimal black point, white point, and gamma by
   * analysing the image luminance histogram.
   *
   * Production-hardened algorithm:
   *   1. Build a luminance histogram (256 bins) from originalImageData.
   *   2. Compute cumulative distribution.
   *   3. Find shadow boundary (bottom 1% outlier clip) → black point.
   *   4. Find highlight boundary (top 1% outlier clip) → white point.
   *   5. Compute average luminance → derive gamma for balanced midtones.
   *   6. Apply safety clamps: min range 30, gamma 0.5–2.0, skin-safe.
   *   7. Update slider DOM + params, trigger render.
   *
   * Designed to improve:
   *   - Underexposed indoor photos
   *   - Slight yellow/dull lighting
   * Without:
   *   - Overexposing backgrounds
   *   - Crushing shadows
   *   - Distorting skin colour
   */
  AdarshEngine.prototype.autoLevels = function () {
    if (!this.originalImageData) {
      this._warn('autoLevels: No image data loaded');
      return;
    }

    // Guard: don't run during active crop — canvas state is invalid
    if (this.cropActive) {
      this._warn('autoLevels: Cannot run while crop is active');
      return;
    }

    var data = this.originalImageData.data;
    var totalPixels = data.length / 4;

    if (totalPixels < 1) return;

    // ── Step 1: Build luminance histogram ────────────────────────
    var hist = new Uint32Array(256);
    var lumSum = 0;

    for (var i = 0; i < data.length; i += 4) {
      // ITU-R BT.601 luminance: 0.299R + 0.587G + 0.114B
      var lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114 + 500) / 1000 | 0;
      if (lum < 0) lum = 0;
      if (lum > 255) lum = 255;
      hist[lum]++;
      lumSum += lum;
    }

    // ── Step 2: Cumulative distribution for outlier clipping ─────
    // Using 1% clip (wider buffer than 0.5%) to prevent shadow crush
    // and highlight washout on passport photos.
    var clipPercent = 0.01; // 1%
    var clipLow  = Math.floor(totalPixels * clipPercent);
    var clipHigh = Math.floor(totalPixels * (1 - clipPercent));

    var cumulative = 0;
    var blackPoint = 0;
    var whitePoint = 255;

    // Find shadow boundary (skip bottom 1%)
    for (var s = 0; s < 256; s++) {
      cumulative += hist[s];
      if (cumulative >= clipLow) {
        blackPoint = s;
        break;
      }
    }

    // Find highlight boundary (skip top 1%)
    cumulative = 0;
    for (var h = 0; h < 256; h++) {
      cumulative += hist[h];
      if (cumulative >= clipHigh) {
        whitePoint = h;
        break;
      }
    }

    // ── Step 3: Safety — enforce minimum range ──────────────────
    // Minimum 30-unit range prevents over-stretch on narrow histograms
    // (e.g., fully white backgrounds, very low contrast images).
    if (whitePoint - blackPoint < 30) {
      var mid = ((blackPoint + whitePoint) / 2) | 0;
      blackPoint = Math.max(0, mid - 15);
      whitePoint = Math.min(255, mid + 15);
    }

    // Hard ceiling: never set black above 60 (preserves shadow detail)
    if (blackPoint > 60) blackPoint = 60;

    // Hard floor: never set white below 200 (preserves highlight detail)
    if (whitePoint < 200) whitePoint = 200;

    // ── Step 4: Derive gamma from average luminance ─────────────
    // Map the average brightness to a gamma correction.
    // Target midpoint = 128. If avg < 128, gamma > 1 (brighten).
    var avgLum = lumSum / totalPixels;
    var range = whitePoint - blackPoint;
    if (range < 1) range = 1;

    // Normalise average to 0–1 within the detected range
    var normAvg = (avgLum - blackPoint) / range;
    if (normAvg < 0.02) normAvg = 0.02;
    if (normAvg > 0.98) normAvg = 0.98;

    // Target: midtone should map to 0.5 → solve gamma
    // 0.5 = normAvg ^ (1/gamma) → gamma = -ln(2) / ln(normAvg)
    var rawGamma = -Math.log(2) / Math.log(normAvg);

    // Guard NaN/Infinity from edge-case log values
    if (!isFinite(rawGamma) || isNaN(rawGamma)) rawGamma = 1.0;

    // Blend: 50% calculated, 50% neutral — gentle correction
    // preserves natural skin tones and prevents over-correction
    var gamma = rawGamma * 0.5 + 1.0 * 0.5;

    // ── Step 5: Safety clamps ───────────────────────────────────
    // Tighter range (0.5–2.0) than v1 — prevents unnatural contrast
    if (gamma < 0.5) gamma = 0.5;
    if (gamma > 2.0) gamma = 2.0;

    // Round for clean slider values
    blackPoint = Math.round(blackPoint);
    whitePoint = Math.round(whitePoint);
    gamma = Math.round(gamma * 100) / 100;

    this._log(
      'Auto Levels: BP=' + blackPoint,
      'WP=' + whitePoint,
      'Gamma=' + gamma.toFixed(2),
      'AvgLum=' + avgLum.toFixed(1)
    );

    // ── Step 6: Apply to sliders and parameters ─────────────────
    this.params.blackPoint = blackPoint;
    this.params.whitePoint = whitePoint;
    this.params.gamma = gamma;

    var e = this._els;
    if (e.black) {
      e.black.value    = blackPoint;
      e.white.value    = whitePoint;
      e.gamma.value    = Math.round(gamma * 100);

      e.blackVal.textContent = blackPoint;
      e.whiteVal.textContent = whitePoint;
      e.gammaVal.textContent = gamma.toFixed(2);
    }

    this._syncHandlePositions();

    // ── Step 7: Re-render with new values ───────────────────────
    this.render();
  };

  // ═══════════════════════════════════════════════════════════════════
  //  v2: FUTURE PLACEHOLDERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Auto skin-tone balance — placeholder for future implementation.
   * Will detect skin-tone regions and balance colour temperature.
   */
  AdarshEngine.prototype.autoSkinBalance = function () {
    this._log('autoSkinBalance() — not yet implemented (future release)');
  };

  /**
   * Background whitening — placeholder for future implementation.
   * Will detect and whiten passport photo backgrounds.
   */
  AdarshEngine.prototype.backgroundWhitening = function () {
    this._log('backgroundWhitening() — not yet implemented (future release)');
  };

  /**
   * Sharpness enhancement — placeholder for future implementation.
   * Will apply unsharp mask for improved detail clarity.
   */
  AdarshEngine.prototype.sharpnessEnhancement = function () {
    this._log('sharpnessEnhancement() — not yet implemented (future release)');
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
  //  PHASE 6 + v2: SAVE — Re-apply pipeline at full resolution
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Extract the filesystem path from a serve-image URL.
   * Works with both proxy URLs (/panel/api/engine/serve-image/?path=...)
   * and direct engine URLs (/serve-image?path=...).
   * Returns null if not a serve-image URL.
   * @param {string} url
   * @returns {string|null}
   */
  AdarshEngine.prototype._extractPathFromUrl = function (url) {
    if (!url || typeof url !== 'string') return null;
    try {
      // Handle relative URLs by making them absolute
      var fullUrl = url;
      if (url.startsWith('/')) {
        fullUrl = window.location.origin + url;
      }
      var parsed = new URL(fullUrl);
      return parsed.searchParams.get('path') || null;
    } catch (e) {
      // Fallback: regex for ?path= parameter
      var match = url.match(/[?&]path=([^&]+)/);
      if (match) return decodeURIComponent(match[1]);
      return null;
    }
  };

  /**
   * Save the edited image:
   *  1. Apply levels + vibrance to FULL resolution image.
   *  2. Export full-res canvas as data URL (0.95 quality).
   *  3. If source was a filesystem image, POST to /edited/ via backend.
   *  4. Call onSaveCallback (replaces preview, triggers existing save).
   *
   * Ensures no resolution loss (Phase 6).
   * v2: Also saves to /edited/ subfolder via backend endpoint.
   * Production-hardened: double-save guard, dimension cap, error recovery.
   */
  AdarshEngine.prototype._save = function () {
    if (!this.originalFullResolutionImage) return;
    if (this._saving) return; // Guard: prevent concurrent saves
    this._saving = true;

    var self = this;
    var e = this._els;

    e.save.disabled = true;
    e.save.classList.add('ae-saving');
    e.save.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Saving…';

    // Phase 7: Let UI update before heavy pixel work
    setTimeout(function () {
      try {
        var fullImg = self.originalFullResolutionImage;
        var fw = fullImg.naturalWidth;
        var fh = fullImg.naturalHeight;

        // Guard: cap export dimensions to prevent browser crash
        if (fw > AdarshEngine.MAX_EXPORT_DIM || fh > AdarshEngine.MAX_EXPORT_DIM) {
          var scale = AdarshEngine.MAX_EXPORT_DIM / Math.max(fw, fh);
          fw = Math.round(fw * scale);
          fh = Math.round(fh * scale);
          self._log('Export capped to:', fw, '×', fh);
        }

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

        // Export as JPEG data URL (studio-grade quality)
        var dataUrl = offscreen.toDataURL('image/jpeg', AdarshEngine.EXPORT_QUALITY);

        if (self.debug) {
          var dt = (performance.now() - t0).toFixed(0);
          self._log('Full-res pipeline:', dt + 'ms');
        }

        // Phase 14: Clean up offscreen canvas immediately
        offscreen.width = 1;
        offscreen.height = 1;
        offscreen = null;
        offCtx = null;
        srcData = null;
        dstData = null;

        // ── v2: Save to /edited/ folder via backend ─────────────
        var originalPath = self._extractPathFromUrl(self.sourceUrl);
        if (originalPath) {
          self._saveToEditedFolder(dataUrl, originalPath, self.currentFilename);
        } else {
          self._log('No filesystem path detected — skipping /edited/ save');
        }

        // Phase 6: Call the callback (replaces preview + triggers save)
        if (typeof self.onSaveCallback === 'function') {
          self.onSaveCallback(dataUrl, self.currentFilename);
        }

        // Toast feedback (use existing Toast if available)
        if (typeof Toast !== 'undefined') {
          Toast.success('Image saved!');
        }

        // v3: Save does NOT close the editor — user uses X to close

      } catch (err) {
        // Phase 8: Catch save errors
        self._warn('Save failed:', err);
        self._showError('Save failed: ' + (err.message || 'Unknown error'));
      } finally {
        self._saving = false;
        if (e.save) {
          e.save.disabled = false;
          e.save.classList.remove('ae-saving');
          e.save.innerHTML =
            '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save';
        }
      }
    }, 50);
  };

  /**
   * v2: POST the edited image to the backend for /edited/ folder save.
   * Non-blocking — errors are logged but don't prevent the callback save.
   *
   * @param {string} dataUrl      - The full-res JPEG data URL.
   * @param {string} originalPath - Filesystem path of the original image.
   * @param {string} filename     - Original filename.
   */
  AdarshEngine.prototype._saveToEditedFolder = function (dataUrl, originalPath, filename) {
    var self = this;

    // CSRF token for Django POST
    var csrfToken = '';
    var csrfMeta = document.querySelector('meta[name="csrf-token"]');
    if (csrfMeta) {
      csrfToken = csrfMeta.getAttribute('content');
    } else {
      // Fallback: read from cookie
      var match = document.cookie.match(/csrftoken=([^;]+)/);
      if (match) csrfToken = match[1];
    }

    var payload = {
      image_data: dataUrl,
      original_path: originalPath,
      filename: filename,
    };

    self._log('Saving to /edited/ folder:', originalPath);

    fetch('/panel/api/engine/save-edited/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken,
      },
      body: JSON.stringify(payload),
    })
    .then(function (resp) {
      if (!resp.ok) {
        self._warn('Backend save-edited HTTP', resp.status);
        return null;
      }
      return resp.json().catch(function () {
        self._warn('Backend save-edited: invalid JSON response');
        return null;
      });
    })
    .then(function (data) {
      if (!data) return;
      if (data.success) {
        self._log('Saved to /edited/:', data.saved_path);
      } else {
        self._warn('Backend save-edited failed:', data.message);
      }
    })
    .catch(function (err) {
      // Network error — non-blocking, just log
      self._warn('Save to /edited/ request failed:', err.message || err);
    });
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

    /** Access the underlying class for advanced usage. */
    _Engine: AdarshEngine,
  };

})();
