/**
 * Adarsh Cropper — Auto-Adjust Image Processing
 * ────────────────────────────────────────────────
 * Client-side auto-levels adjustment for a single image.
 * Runs entirely in the browser via <canvas>.
 * Must be loaded BEFORE adarsh-cropper.js.
 *
 * @module adarsh-cropper-autoadjust
 */

window.CropperAutoAdjust = {

  /**
   * Auto-adjust a single image: load → auto-levels → export → save.
   * Returns a Promise that resolves to the new served URL, or null.
   *
   * @param {Object} imgObj      - { url, name, path }
   * @param {string} csrfToken   - CSRF token for the save request.
   * @returns {Promise<string|null>}
   */
  adjustSingle: function (imgObj, csrfToken) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.crossOrigin = 'anonymous';

      image.onload = function () {
        try {
          var w = image.naturalWidth;
          var h = image.naturalHeight;

          // Cap dimensions to prevent browser crash
          var MAX = 8000;
          if (w > MAX || h > MAX) {
            var scale = MAX / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }

          // Draw onto offscreen canvas
          var canvas = document.createElement('canvas');
          canvas.width  = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(image, 0, 0, w, h);

          var srcData = ctx.getImageData(0, 0, w, h);
          var src     = srcData.data;
          var total   = src.length / 4;
          if (total < 1) { resolve(null); return; }

          // ── Histogram ──
          var hist   = new Uint32Array(256);
          var lumSum = 0;

          for (var p = 0; p < src.length; p += 4) {
            var lum = (src[p] * 299 + src[p+1] * 587 + src[p+2] * 114 + 500) / 1000 | 0;
            if (lum < 0)   lum = 0;
            if (lum > 255) lum = 255;
            hist[lum]++;
            lumSum += lum;
          }

          // ── Black / white points (1% clip) ──
          var clip    = 0.01;
          var clipLo  = Math.floor(total * clip);
          var clipHi  = Math.floor(total * (1 - clip));
          var cum     = 0;
          var bp      = 0;
          var wp      = 255;

          for (var s = 0; s < 256; s++) {
            cum += hist[s];
            if (cum >= clipLo) { bp = s; break; }
          }
          cum = 0;
          for (var hh = 0; hh < 256; hh++) {
            cum += hist[hh];
            if (cum >= clipHi) { wp = hh; break; }
          }

          // Safety range
          if (wp - bp < 30) {
            var mid = ((bp + wp) / 2) | 0;
            bp = Math.max(0, mid - 15);
            wp = Math.min(255, mid + 15);
          }
          if (bp > 60)  bp = 60;
          if (wp < 200) wp = 200;

          // ── Gamma from average luminance ──
          var avgLum = lumSum / total;
          var range  = wp - bp;
          if (range < 1) range = 1;

          var normAvg = (avgLum - bp) / range;
          if (normAvg < 0.02) normAvg = 0.02;
          if (normAvg > 0.98) normAvg = 0.98;

          var rawGamma = -Math.log(2) / Math.log(normAvg);
          if (!isFinite(rawGamma) || isNaN(rawGamma)) rawGamma = 1.0;
          var gamma = rawGamma * 0.5 + 0.5;
          if (gamma < 0.5) gamma = 0.5;
          if (gamma > 2.0) gamma = 2.0;

          // ── Build LUT ──
          var lut    = new Uint8Array(256);
          var invG   = 1.0 / gamma;
          for (var v = 0; v < 256; v++) {
            var norm = (v - bp) / range;
            if (norm < 0) norm = 0;
            if (norm > 1) norm = 1;
            lut[v] = (Math.pow(norm, invG) * 255 + 0.5) | 0;
          }

          // ── Apply LUT to pixels ──
          var dstData = ctx.createImageData(w, h);
          var dst     = dstData.data;

          for (var px = 0; px < src.length; px += 4) {
            dst[px]     = lut[src[px]];
            dst[px + 1] = lut[src[px + 1]];
            dst[px + 2] = lut[src[px + 2]];
            dst[px + 3] = src[px + 3];
          }

          ctx.putImageData(dstData, 0, 0);

          // ── Export ──
          var dataUrl = canvas.toDataURL('image/jpeg', 0.95);

          // Cleanup
          canvas.width = 1; canvas.height = 1;

          // ── Extract original path from URL ──
          var originalPath = null;
          try {
            var fullUrl = imgObj.url;
            if (fullUrl.startsWith('/')) fullUrl = window.location.origin + fullUrl;
            var parsed = new URL(fullUrl);
            originalPath = parsed.searchParams.get('path') || null;
          } catch (e2) {
            var pm = imgObj.url.match(/[?&]path=([^&]+)/);
            if (pm) originalPath = decodeURIComponent(pm[1]);
          }
          if (!originalPath && imgObj.path) originalPath = imgObj.path;

          if (!originalPath) {
            console.warn('[AutoAdjust] No path for', imgObj.name);
            resolve(null);
            return;
          }

          // ── Save to /edited/ ──
          fetch('/panel/api/engine/save-edited/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRFToken': csrfToken,
            },
            body: JSON.stringify({
              image_data:    dataUrl,
              original_path: originalPath,
              filename:      imgObj.name,
            }),
          })
          .then(function (resp) {
            if (!resp.ok) { resolve(null); return; }
            return resp.json();
          })
          .then(function (data) {
            if (data && data.success && data.saved_path) {
              // Construct a served URL from the saved path
              var servedUrl = '/panel/api/engine/serve-image/?path=' +
                encodeURIComponent(data.saved_path);
              resolve(servedUrl);
            } else {
              // Image was saved but no path returned — keep old URL
              resolve(imgObj.url);
            }
          })
          .catch(function () { resolve(null); });

        } catch (err) {
          reject(err);
        }
      };

      image.onerror = function () {
        reject(new Error('Failed to load image: ' + imgObj.name));
      };

      image.src = imgObj.url;
    });
  },
};
