/**
 * AdarshEngine — Navigation, Crop & Save
 * ═══════════════════════════════════════════════════════════════
 *
 * Extends AdarshEngine with:
 *   - Image list navigation (prev/next)
 *   - Manual crop (Cropper.js integration)
 *   - Full-resolution save pipeline + /edited/ folder save
 *
 * Must be loaded AFTER adarshengine.js
 */
;(function () {
  'use strict';

  var AdarshEngine = window.AdarshEngine._Engine;
  if (!AdarshEngine) {
    console.error('[AdarshEngine] Core not loaded \u2014 cannot register nav methods.');
    return;
  }

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
   * Works with both proxy URLs (/api/engine/serve-image/?path=...)
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
        var originalPath = self.sourcePath || self._extractPathFromUrl(self.sourceUrl);
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

    fetch('/api/engine/save-edited/', {
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

})();
