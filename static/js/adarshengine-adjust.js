/**
 * AdarshEngine  Render Pipeline & Auto Adjustments
 * 
 *
 * Extends AdarshEngine with:
 *   - Render pipeline (levels + vibrance + temperature)
 *   - Auto Levels (histogram-based intelligent correction)
 *   - Future placeholders (skin balance, background whitening, sharpness)
 *
 * Must be loaded AFTER adarshengine.js
 */
;(function () {
  'use strict';

  var AdarshEngine = window.AdarshEngine._Engine;
  if (!AdarshEngine) {
    console.error('[AdarshEngine] Core not loaded \u2014 cannot register adjust methods.');
    return;
  }

  // 
  //  PHASE 3 + 4: RENDER PIPELINE
  // 

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

      // Create a working copy  never mutate the original
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
   * @param {number}            len  - Total byte length (w  h  4).
   */
  AdarshEngine.prototype._applyPipeline = function (src, dst, len) {
    var bp    = this.params.blackPoint;
    var wp    = this.params.whitePoint;
    var gamma = this.params.gamma;
    var vib   = this.params.vibrance / 100;  // normalise to -1+1
    var temp  = this.params.temperature || 0; // -100+100

    //  Phase 8: Safety guards 
    if (gamma <= 0) gamma = 0.01;
    var range = wp - bp;
    if (range < 1) range = 1;  // prevent division by zero

    var invRange = 1 / range;
    var invGamma = 1 / gamma;

    //  Phase 3: Pre-compute LUT for Levels 
    // Maps 0255 input  0255 output after levels + gamma.
    // LUT avoids per-pixel pow() calls for massive speed gain.
    var lut = new Uint8Array(256);
    for (var i = 0; i < 256; i++) {
      // 1. Normalise against black/white points
      var norm = (i - bp) * invRange;
      // 2. Clamp 01
      if (norm < 0) norm = 0;
      if (norm > 1) norm = 1;
      // 3. Gamma correction
      var gc = Math.pow(norm, invGamma);
      // 4. Map back to 0255 (fast round)
      lut[i] = (gc * 255 + 0.5) | 0;
    }

    //  Process every pixel 
    //  Temperature: pre-compute R/B shift 
    // Warm: boost red, reduce blue.  Cool: boost blue, reduce red.
    // Uses a gentle cubic curve for natural feel (like Lightroom).
    var tempShiftR = 0, tempShiftB = 0;
    if (temp !== 0) {
      var tNorm = temp / 100;  // -1+1
      // Cubic for smooth response: sign * abs^0.7 * maxShift
      var sign = tNorm >= 0 ? 1 : -1;
      var curve = sign * Math.pow(Math.abs(tNorm), 0.7);
      tempShiftR =  curve * 30;  // max 30
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
        // diff/255  0 when fully saturated, 1 when grey.
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
   * Clamp value to 0255 integer (static utility).
   * @param {number} v
   * @returns {number}
   */
  AdarshEngine._clamp255 = function (v) {
    if (v < 0) return 0;
    if (v > 255) return 255;
    return v | 0;
  };

  // 
  //  v2: AUTO LEVELS  Histogram-based intelligent correction
  // 

  /**
   * Auto-detect optimal black point, white point, and gamma by
   * analysing the image luminance histogram.
   *
   * Production-hardened algorithm:
   *   1. Build a luminance histogram (256 bins) from originalImageData.
   *   2. Compute cumulative distribution.
   *   3. Find shadow boundary (bottom 1% outlier clip)  black point.
   *   4. Find highlight boundary (top 1% outlier clip)  white point.
   *   5. Compute average luminance  derive gamma for balanced midtones.
   *   6. Apply safety clamps: min range 30, gamma 0.52.0, skin-safe.
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

    // Guard: don't run during active crop  canvas state is invalid
    if (this.cropActive) {
      this._warn('autoLevels: Cannot run while crop is active');
      return;
    }

    var data = this.originalImageData.data;
    var totalPixels = data.length / 4;

    if (totalPixels < 1) return;

    //  Step 1: Build luminance histogram 
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

    //  Step 2: Cumulative distribution for outlier clipping 
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

    //  Step 3: Safety  enforce minimum range 
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

    //  Step 4: Derive gamma from average luminance 
    // Map the average brightness to a gamma correction.
    // Target midpoint = 128. If avg < 128, gamma > 1 (brighten).
    var avgLum = lumSum / totalPixels;
    var range = whitePoint - blackPoint;
    if (range < 1) range = 1;

    // Normalise average to 01 within the detected range
    var normAvg = (avgLum - blackPoint) / range;
    if (normAvg < 0.02) normAvg = 0.02;
    if (normAvg > 0.98) normAvg = 0.98;

    // Target: midtone should map to 0.5  solve gamma
    // 0.5 = normAvg ^ (1/gamma)  gamma = -ln(2) / ln(normAvg)
    var rawGamma = -Math.log(2) / Math.log(normAvg);

    // Guard NaN/Infinity from edge-case log values
    if (!isFinite(rawGamma) || isNaN(rawGamma)) rawGamma = 1.0;

    // Blend: 50% calculated, 50% neutral  gentle correction
    // preserves natural skin tones and prevents over-correction
    var gamma = rawGamma * 0.5 + 1.0 * 0.5;

    //  Step 5: Safety clamps 
    // Tighter range (0.52.0) than v1  prevents unnatural contrast
    if (gamma < 0.5) gamma = 0.5;
    if (gamma > 2.0) gamma = 2.0;

    // Round for clean slider values
    blackPoint = Math.round(blackPoint);
    whitePoint = Math.round(whitePoint);
    gamma = Math.round(gamma * 100) / 100;

    //  Step 6: Auto Color Temperature (Yellow/Blue Cast Detection) 
    var temperature = 0;
    var rSum = 0, gSum = 0, bSum = 0;
    
    for (var i = 0; i < data.length; i += 16) {
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
    }
    
    var pixelCount = data.length / 16;
    var avgR = rSum / pixelCount;
    var avgG = gSum / pixelCount;
    var avgB = bSum / pixelCount;
    
    var rbDiff = avgR - avgB;
    
    if (rbDiff > 8 && avgR > avgG - 5) {
      temperature = Math.max(-35, Math.min(-10, -rbDiff * 1.2));
    } else if (rbDiff < -8) {
      temperature = Math.max(10, Math.min(30, -rbDiff * 1.0));
    } else if (Math.abs(rbDiff) <= 8 && avgLum < 140) {
      temperature = 5;
    }
    
    temperature = Math.round(temperature);

    //  Step 7: Auto Vibrance (Dull Image Detection) 
    var vibrance = 0;
    var satSum = 0;
    
    for (var i = 0; i < data.length; i += 16) {
      var r = data[i];
      var g = data[i + 1];
      var b = data[i + 2];
      var maxC = Math.max(r, g, b);
      var minC = Math.min(r, g, b);
      satSum += (maxC - minC);
    }
    
    var avgSat = satSum / pixelCount;
    
    if (avgSat < 45) {
      vibrance = Math.round(Math.max(15, Math.min(25, (45 - avgSat) * 0.6)));
    } else if (avgSat < 60) {
      vibrance = 10;
    }

    //  Step 8: Lift Shadows (Brighten Faces) 
    if (blackPoint > 15) {
      var shadowLift = Math.round(blackPoint * 0.25);
      blackPoint = Math.max(5, blackPoint - shadowLift);
    }

    //  Step 9: Subtle Contrast Boost 
    var currentRange = whitePoint - blackPoint;
    if (currentRange < 200) {
      var expansion = Math.min(15, Math.round(currentRange * 0.08));
      blackPoint = Math.max(0, blackPoint - Math.round(expansion / 2));
      whitePoint = Math.min(255, whitePoint + Math.round(expansion / 2));
    }
    
    if (whitePoint - blackPoint < 30) {
      var mid = Math.round((blackPoint + whitePoint) / 2);
      blackPoint = Math.max(0, mid - 15);
      whitePoint = Math.min(255, mid + 15);
    }

    blackPoint = Math.round(blackPoint);
    whitePoint = Math.round(whitePoint);

    this._log(
      'Auto Levels: BP=' + blackPoint,
      'WP=' + whitePoint,
      'Gamma=' + gamma.toFixed(2),
      'AvgLum=' + avgLum.toFixed(1),
      'Temp=' + temperature,
      'Vib=' + vibrance
    );

    //  Step 10: Apply to sliders and parameters 
    this.params.blackPoint = blackPoint;
    this.params.whitePoint = whitePoint;
    this.params.gamma = gamma;
    this.params.vibrance = vibrance;
    this.params.temperature = temperature;

    var e = this._els;
    if (e.black) {
      e.black.value    = blackPoint;
      e.white.value    = whitePoint;
      e.gamma.value    = Math.round(gamma * 100);
      e.vibrance.value = vibrance;
      if (e.temp) e.temp.value = temperature;

      e.blackVal.textContent = blackPoint;
      e.whiteVal.textContent = whitePoint;
      e.gammaVal.textContent = gamma.toFixed(2);
      e.vibranceVal.textContent = vibrance;
      if (e.tempVal) e.tempVal.textContent = temperature;
    }

    this._syncHandlePositions();

    //  Step 11: Re-render with new values 
    this.render();
  };

  // 
  //  v2: FUTURE PLACEHOLDERS
  // 

  /**
   * Auto skin-tone balance  placeholder for future implementation.
   * Will detect skin-tone regions and balance colour temperature.
   */
  AdarshEngine.prototype.autoSkinBalance = function () {
    this._log('autoSkinBalance()  not yet implemented (future release)');
  };

  /**
   * Background whitening  placeholder for future implementation.
   * Will detect and whiten passport photo backgrounds.
   */
  AdarshEngine.prototype.backgroundWhitening = function () {
    this._log('backgroundWhitening()  not yet implemented (future release)');
  };

  /**
   * Sharpness enhancement  placeholder for future implementation.
   * Will apply unsharp mask for improved detail clarity.
   */
  AdarshEngine.prototype.sharpnessEnhancement = function () {
    this._log('sharpnessEnhancement()  not yet implemented (future release)');
  };

})();
