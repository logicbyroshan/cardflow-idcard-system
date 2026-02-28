/**
 * AdarshEngine — Histogram & Level Handles
 * ═══════════════════════════════════════════════════════════════
 *
 * Extends AdarshEngine with:
 *   - Level handle dragging (black point, gamma, white point)
 *   - Histogram drawing (RGB + luminance)
 *   - Handle position syncing
 *
 * Must be loaded AFTER adarshengine.js
 */
;(function () {
  'use strict';

  var AdarshEngine = window.AdarshEngine._Engine;
  if (!AdarshEngine) {
    console.error('[AdarshEngine] Core not loaded \u2014 cannot register histogram methods.');
    return;
  }

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

})();
