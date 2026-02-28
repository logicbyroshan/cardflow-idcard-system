/**
 * Adarsh Cropper — Alpine.js Component  v5.0.0
 * ──────────────────────────────────────────────
 * Folder-only processing.  No ZIP upload.
 *
 * Features:
 *   - Direct engine connection at http://127.0.0.1:4765 (fallback: Django proxy)
 *   - Keepalive polling every 30 s — auto-reconnects if engine restarts
 *   - Donut chart showing cropped vs failed counts
 *   - Image preview grid always available after processing
 *
 * @module adarsh-cropper
 * @version 5.0.0
 */

// ── Engine connection constants ──────────────────────────────────────────
var ENGINE_DIRECT_URL = 'http://127.0.0.1:4765';
var ENGINE_API_KEY    = 'passport-engine-local-key';
var KEEPALIVE_MS      = 30000;  // poll engine status every 30 s

function cropperApp() {
  return {
    // ── Engine state ──
    engine: {
      loading: true,
      checked: false,
      connected: false,
      version: '',
      uptime: '',
      memory: '',
      direct: false,
      url: '',
    },

    // ── UI state ──
    folderPath: '',
    processing: false,

    // ── Progress ──
    progress: {
      visible: false,
      label: 'Processing…',
      percent: 0,
      detail: 'Preparing…',
    },

    // ── Result ──
    result: {
      visible: false,
      total: 0,
      success: 0,
      failed: 0,
      accuracy: '—',
      time: '—',
      outputFolder: '',
      failedFolder: '',
      errors: [],
      errorsExpanded: false,
    },

    // ── Preview ──
    preview: {
      visible: false,
      loading: false,
      images: [],
      editedImages: [],
      failedImages: [],
      deletedImages: [],
      folder: '',
    },

    // ── Tabs ──
    activeTab: 'cropped',

    // ── Delete confirmation ──
    deleteConfirm: {
      visible: false,
      imageName: '',
      imagePath: '',
      deleting: false,
    },

    // ── Error ──
    error: {
      visible: false,
      title: '',
      message: '',
    },

    // ── Internal ──
    _progressTimer: null,
    _keepaliveId: null,

    // ── Update state ──
    update: {
      available: false,
      version: '',
      downloadUrl: '',
      changelog: '',
    },

    // ══════════════════════════════════════════════════════════════════
    //  INIT
    // ══════════════════════════════════════════════════════════════════
    init() {
      this._checkEngineWithRetry();
      // Start keepalive polling — silently re-checks every 30 s
      this._keepaliveId = setInterval(() => { this._keepalivePoll(); }, KEEPALIVE_MS);
    },

    /**
     * Retry engine detection up to 3 times (1.5 s apart) so a hard-refresh
     * doesn't falsely show "not detected" when the engine is slow to respond.
     */
    async _checkEngineWithRetry(attempt) {
      attempt = attempt || 1;
      var MAX_RETRIES = 3;
      await this.checkEngine();
      if (!this.engine.connected && attempt < MAX_RETRIES) {
        console.log('[Cropper] Engine not detected, retry ' + attempt + '/' + MAX_RETRIES + '…');
        await new Promise(function (r) { setTimeout(r, 1500); });
        await this._checkEngineWithRetry(attempt + 1);
      }
    },

    // ══════════════════════════════════════════════════════════════════
    //  KEEPALIVE POLLING — detect disconnect / reconnect silently
    // ══════════════════════════════════════════════════════════════════
    async _keepalivePoll() {
      // Don't poll while processing (engine is busy)
      if (this.processing) return;
      var wasConnected = this.engine.connected;

      try {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 4000);
        var resp = await fetch(ENGINE_DIRECT_URL + '/status', { signal: controller.signal });
        clearTimeout(timer);

        if (resp.ok) {
          var data = await resp.json();
          if (!this.engine.connected) {
            // Reconnected — refresh full engine info
            console.log('[Cropper] Engine reconnected');
            await this.checkEngine();
          }
          return;
        }
      } catch (_) { /* direct failed */ }

      // Try proxy fallback
      try {
        var data = await ApiClient.get('/panel/api/engine/status/');
        if (data && data.connected) {
          if (!this.engine.connected) {
            console.log('[Cropper] Engine reconnected via proxy');
            await this.checkEngine();
          }
          return;
        }
      } catch (_) { /* proxy failed too */ }

      // Engine went offline
      if (wasConnected) {
        console.warn('[Cropper] Engine disconnected — will auto-reconnect when available');
        this.engine.connected = false;
        this.engine.checked = true;
        this._broadcastEngineState();
      }
    },

    // ══════════════════════════════════════════════════════════════════
    //  ENGINE DETECTION — try direct first, then Django proxy fallback
    // ══════════════════════════════════════════════════════════════════
    async checkEngine() {
      this.engine.loading = true;
      this.engine.connected = false;
      this.engine.direct = false;

      // ── Attempt 1: Direct connection to local engine ──────────────
      try {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 6000);

        var statusResp = await fetch(ENGINE_DIRECT_URL + '/status', {
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (statusResp.ok) {
          var statusData = await statusResp.json();

          // Try health endpoint too (optional)
          var healthData = {};
          try {
            var hResp = await fetch(ENGINE_DIRECT_URL + '/health', {
              signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
            });
            if (hResp.ok) healthData = await hResp.json();
          } catch (_ignore) {}

          this.engine.connected = true;
          this.engine.direct = true;
          this.engine.url = ENGINE_DIRECT_URL;
          this.engine.version = healthData.version || statusData.version || '?';
          this._parseUptime(healthData.uptime_seconds || 0);
          this.engine.memory = healthData.memory_usage_mb != null
            ? String(healthData.memory_usage_mb)
            : '';

          this.engine.loading = false;
          this.engine.checked = true;
          console.log('[Cropper] Connected directly to local engine v' + this.engine.version);
          this._broadcastEngineState();
          return;
        }
      } catch (_directErr) {
        // Direct failed — try Django proxy
      }

      // ── Attempt 2: Django proxy ───────────────────────────────────
      try {
        var data = await ApiClient.get('/panel/api/engine/status/');

        if (data && data.connected) {
          var status = data.status || {};
          var health = data.health || {};

          this.engine.connected = true;
          this.engine.direct = false;
          this.engine.version = health.version || status.version || '?';
          this._parseUptime(health.uptime_seconds || 0);
          this.engine.memory = health.memory_usage_mb != null
            ? String(health.memory_usage_mb)
            : '';
          console.log('[Cropper] Connected via Django proxy v' + this.engine.version);
        }
      } catch (_proxyErr) {
        this.engine.connected = false;
      } finally {
        this.engine.loading = false;
        this.engine.checked = true;
        this._broadcastEngineState();
      }
    },

    _parseUptime(secs) {
      if (secs >= 3600) {
        this.engine.uptime = Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
      } else if (secs > 0) {
        this.engine.uptime = Math.floor(secs / 60) + 'm ' + Math.floor(secs % 60) + 's';
      } else {
        this.engine.uptime = '';
      }
    },

    _broadcastEngineState() {
      window.dispatchEvent(new CustomEvent('engine-state', {
        detail: {
          loading: this.engine.loading,
          checked: this.engine.checked,
          connected: this.engine.connected,
          version: this.engine.version,
        },
      }));
      // Check for updates once engine version is known
      if (this.engine.connected && this.engine.version) {
        this._checkForUpdates();
      }
    },

    // ══════════════════════════════════════════════════════════════════
    //  AUTO-UPDATE CHECK — compare installed version vs latest release
    // ══════════════════════════════════════════════════════════════════
    async _checkForUpdates() {
      try {
        var data = await ApiClient.get('/panel/api/cropper/latest-version/');
        if (!data || !data.available) {
          this.update.available = false;
          return;
        }

        var installedVersion = this.engine.version || '0.0.0';
        var latestVersion = data.version || '0.0.0';

        if (this._semverCompare(latestVersion, installedVersion) > 0) {
          this.update.available = true;
          this.update.version = latestVersion;
          this.update.downloadUrl = data.download_url || '';
          this.update.changelog = data.changelog || '';
          console.log('[Cropper] Update available: v' + latestVersion + ' (installed: v' + installedVersion + ')');
        } else {
          this.update.available = false;
        }
      } catch (err) {
        console.warn('[Cropper] Update check failed:', err);
        // Silently ignore — update check is non-critical
      }
    },

    /**
     * Compare two semver strings (e.g. "3.0.1" vs "3.0.0").
     * Returns: >0 if a > b, <0 if a < b, 0 if equal.
     */
    _semverCompare(a, b) {
      var pa = (a || '0.0.0').split('.').map(Number);
      var pb = (b || '0.0.0').split('.').map(Number);
      for (var i = 0; i < 3; i++) {
        var va = pa[i] || 0;
        var vb = pb[i] || 0;
        if (va !== vb) return va - vb;
      }
      return 0;
    },

    // ══════════════════════════════════════════════════════════════════
    //  PROGRESS HELPERS
    // ══════════════════════════════════════════════════════════════════
    _showProgress(label) {
      this.progress.visible = true;
      this.progress.label = label || 'Processing…';
      this.progress.percent = 0;
      this.progress.detail = 'Preparing…';
    },

    _updateProgress(pct, detail) {
      this.progress.percent = pct;
      if (detail) this.progress.detail = detail;
    },

    _hideProgress() {
      this.progress.visible = false;
      if (this._progressTimer) {
        clearInterval(this._progressTimer);
        this._progressTimer = null;
      }
    },

    _startProgressSimulation() {
      this._progressTimer = setInterval(() => {
        if (this.progress.percent < 85) {
          this._updateProgress(
            Math.min(this.progress.percent + 3, 85),
            'Engine processing photos…'
          );
        }
      }, 800);
    },

    // ══════════════════════════════════════════════════════════════════
    //  PROCESS FOLDER
    // ══════════════════════════════════════════════════════════════════
    async processFolder() {
      var path = this.folderPath.trim();
      if (!path || this.processing) return;
      this.processing = true;
      this.result.visible = false;
      this.preview.visible = false;
      this.error.visible = false;
      this._showProgress('Processing…');

      try {
        this._updateProgress(10, 'Sending folder path to engine…');
        this._startProgressSimulation();

        var data;

        if (this.engine.direct) {
          // ── Direct to local engine ────────────────────────────────
          var resp = await fetch(ENGINE_DIRECT_URL + '/process-folder', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-ENGINE-KEY': ENGINE_API_KEY,
            },
            body: JSON.stringify({ folder_path: path }),
          });
          if (!resp.ok) {
            var errBody = {};
            try { errBody = await resp.json(); } catch (_) {}
            throw new Error(errBody.message || errBody.detail || 'Engine error ' + resp.status);
          }
          data = await resp.json();
        } else {
          // ── Django proxy fallback ─────────────────────────────────
          data = await ApiClient.post(
            '/panel/api/engine/process-folder/',
            { folder_path: path }
          );
        }

        this._hideProgress();

        if (data && data.total != null) {
          this._updateProgress(100, 'Complete!');
          this._showResult(data);
          if (typeof Toast !== 'undefined') Toast.success('Processing complete!');
        } else {
          throw new Error((data && data.message) || 'Processing failed');
        }

      } catch (err) {
        this._hideProgress();
        this._handleProcessError(err);
      } finally {
        this.processing = false;
      }
    },

    // ══════════════════════════════════════════════════════════════════
    //  RESULT DISPLAY + DONUT CHART
    // ══════════════════════════════════════════════════════════════════
    _showResult(data) {
      var total   = data.total   || 0;
      var success = data.success || 0;
      var failed  = data.failed  || 0;

      this.result.total    = total;
      this.result.success  = success;
      this.result.failed   = failed;
      this.result.accuracy = total > 0 ? ((success / total) * 100).toFixed(1) + '%' : '—';

      if (data.processing_time != null) {
        this.result.time = typeof data.processing_time === 'number'
          ? data.processing_time.toFixed(1) + 's'
          : String(data.processing_time);
      } else {
        this.result.time = '—';
      }

      this.result.outputFolder = data.output_folder || '';
      this.result.failedFolder = data.failed_folder || '';
      this.result.errorsExpanded = false;

      var errs = data.errors || [];
      this.result.errors = errs.map(function (e) {
        return typeof e === 'string' ? e : (e.file || e.filename || JSON.stringify(e));
      });

      this.result.visible = true;

      // Draw donut chart after DOM update
      var self = this;
      this.$nextTick(function () { self._drawDonutChart(success, failed); });

      // Auto-load preview if there are successful images
      if (success > 0 && this.result.outputFolder) {
        this._loadPreview(this.result.outputFolder);
      }
    },

    /**
     * Draw a simple donut chart on the canvas element.
     * Pure canvas — no external chart library needed.
     */
    _drawDonutChart(success, failed) {
      var canvas = this.$refs.chartCanvas;
      if (!canvas) return;

      var ctx = canvas.getContext('2d');
      var W = canvas.width;
      var H = canvas.height;
      var cx = W / 2;
      var cy = H / 2;
      var outerR = Math.min(cx, cy) - 4;
      var innerR = outerR * 0.62;  // donut hole

      ctx.clearRect(0, 0, W, H);

      var total = success + failed;
      if (total === 0) return;

      var slices = [
        { value: success, color: '#22c55e' },  // green
        { value: failed,  color: '#ef4444' },  // red
      ];

      var startAngle = -Math.PI / 2;  // 12 o'clock

      slices.forEach(function (slice) {
        if (slice.value === 0) return;
        var sweep = (slice.value / total) * 2 * Math.PI;
        var endAngle = startAngle + sweep;

        ctx.beginPath();
        ctx.arc(cx, cy, outerR, startAngle, endAngle);
        ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = slice.color;
        ctx.fill();

        startAngle = endAngle;
      });

      // Draw count labels on the slices
      startAngle = -Math.PI / 2;
      var midR = (outerR + innerR) / 2;
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';

      slices.forEach(function (slice) {
        if (slice.value === 0) return;
        var sweep = (slice.value / total) * 2 * Math.PI;
        var midAngle = startAngle + sweep / 2;
        var lx = cx + midR * Math.cos(midAngle);
        var ly = cy + midR * Math.sin(midAngle);
        // Only draw label if slice is big enough
        if (sweep > 0.3) {
          ctx.fillText(String(slice.value), lx, ly);
        }
        startAngle += sweep;
      });
    },

    clearResults() {
      this.result.visible = false;
      this.preview.visible = false;
    },

    // ══════════════════════════════════════════════════════════════════
    //  IMAGE PREVIEW — always available after processing
    // ══════════════════════════════════════════════════════════════════
    async _loadPreview(folderPath) {
      this.preview.loading = true;
      this.preview.visible = true;
      this.preview.images = [];
      this.preview.editedImages = [];
      this.preview.failedImages = [];
      this.preview.deletedImages = [];
      this.preview.folder = folderPath;
      this.activeTab = 'cropped';

      try {
        var data;
        if (this.engine.direct) {
          var previewUrl = this.engine.url + '/preview?folder=' + encodeURIComponent(folderPath);
          var resp = await fetch(previewUrl, {
            headers: { 'X-ENGINE-KEY': ENGINE_API_KEY },
          });
          data = await resp.json();
        } else {
          data = await ApiClient.get(
            '/panel/api/engine/preview/?folder=' + encodeURIComponent(folderPath)
          );
        }

        if (data && data.files && data.files.length > 0) {
          var folder = data.folder || folderPath;
          var self = this;
          this.preview.images = data.files.map(function (name) {
            var fullPath = folder + '\\' + name;
            if (self.engine.direct) {
              return {
                name: name,
                url: self.engine.url + '/serve-image?path=' + encodeURIComponent(fullPath),
                path: fullPath,
              };
            }
            return {
              name: name,
              url: '/panel/api/engine/serve-image/?path=' + encodeURIComponent(fullPath),
              path: fullPath,
            };
          });
        }
      } catch (err) {
        console.warn('[Cropper] Preview load failed:', err);
        // Preview is optional — don't block the flow
      } finally {
        this.preview.loading = false;
      }
    },

    copyPath(folderPath) {
      if (folderPath && navigator.clipboard) {
        navigator.clipboard.writeText(folderPath).then(function () {
          if (typeof Toast !== 'undefined') Toast.success('Path copied to clipboard!');
        });
      }
    },

    // ══════════════════════════════════════════════════════════════════
    //  TABS — switch between Cropped / Edited / Failed / Deleted
    // ══════════════════════════════════════════════════════════════════
    switchTab(tab) {
      this.activeTab = tab;
      // Lazy-load when switching to a tab for the first time
      if (tab === 'edited' && this.preview.editedImages.length === 0 && this.preview.folder) {
        this._loadTabImages('edited');
      } else if (tab === 'failed' && this.preview.failedImages.length === 0 && this.preview.folder) {
        this._loadTabImages('failed');
      } else if (tab === 'deleted' && this.preview.deletedImages.length === 0 && this.preview.folder) {
        this._loadTabImages('deleted');
      }
    },

    /**
     * Return the image array for the currently active tab.
     */
    currentTabImages() {
      switch (this.activeTab) {
        case 'edited':  return this.preview.editedImages;
        case 'failed':  return this.preview.failedImages;
        case 'deleted': return this.preview.deletedImages;
        default:        return this.preview.images;
      }
    },

    /**
     * Load images for a sub-tab (edited / failed / deleted).
     * Derives the subfolder path from the main preview folder.
     */
    async _loadTabImages(tab) {
      // The main preview.folder is the cropped folder (e.g. C:\path\cropped)
      // Sibling folders are: edited, failed, deleted — at the same level
      var basePath = this.preview.folder;
      if (!basePath) return;

      // Go up one level from /cropped to parent, then into the tab subfolder
      var parts = basePath.replace(/[\\/]+$/, '').split(/[\\/]/);
      parts.pop();  // remove 'cropped'
      var tabFolder = parts.join('\\') + '\\' + tab;

      try {
        var data;
        if (this.engine.direct) {
          var url = this.engine.url + '/preview?folder=' + encodeURIComponent(tabFolder);
          var resp = await fetch(url, {
            headers: { 'X-ENGINE-KEY': ENGINE_API_KEY },
          });
          data = await resp.json();
        } else {
          data = await ApiClient.get(
            '/panel/api/engine/preview/?folder=' + encodeURIComponent(tabFolder)
          );
        }

        if (data && data.files && data.files.length > 0) {
          var folder = data.folder || tabFolder;
          var self = this;
          var images = data.files.map(function (name) {
            var fullPath = folder + '\\' + name;
            if (self.engine.direct) {
              return {
                name: name,
                url: self.engine.url + '/serve-image?path=' + encodeURIComponent(fullPath),
                path: fullPath,
              };
            }
            return {
              name: name,
              url: '/panel/api/engine/serve-image/?path=' + encodeURIComponent(fullPath),
              path: fullPath,
            };
          });

          if (tab === 'edited')  this.preview.editedImages  = images;
          if (tab === 'failed')  this.preview.failedImages   = images;
          if (tab === 'deleted') this.preview.deletedImages  = images;
        }
      } catch (err) {
        console.warn('[Cropper] Failed to load ' + tab + ' images:', err);
      }
    },

    // ══════════════════════════════════════════════════════════════════
    //  EDITOR INTEGRATION — open AdarshEngine with image list nav
    // ══════════════════════════════════════════════════════════════════
    openEditor(img, idx) {
      var self = this;
      var images = this.currentTabImages();

      window.AdarshEngine.open(img.url, img.name, function (dataUrl, name) {
        // Update the currently displayed image URL
        img.url = dataUrl;
      });

      // Build image list for navigation inside the editor
      var engineList = images.map(function (i) {
        return { url: i.url, name: i.name };
      });
      window.AdarshEngine.setImageList(engineList, idx, function (url, name) {
        // When user navigates, update reference for future save callbacks
      });
    },

    // ══════════════════════════════════════════════════════════════════
    //  DELETE — confirm + soft-delete (move to /deleted/ folder)
    // ══════════════════════════════════════════════════════════════════
    confirmDelete(img) {
      this.deleteConfirm.imageName = img.name;
      this.deleteConfirm.imagePath = img.path || '';
      this.deleteConfirm.deleting = false;
      this.deleteConfirm.visible = true;
    },

    async executeDelete() {
      var path = this.deleteConfirm.imagePath;
      if (!path) {
        if (typeof Toast !== 'undefined') Toast.error('Cannot determine image path.');
        this.deleteConfirm.visible = false;
        return;
      }

      this.deleteConfirm.deleting = true;

      try {
        var data = await ApiClient.post('/panel/api/engine/delete-image/', {
          path: path,
        });

        if (data && data.success) {
          // Remove from current tab's array
          var imgName = this.deleteConfirm.imageName;
          var self = this;

          ['images', 'editedImages', 'failedImages'].forEach(function (key) {
            self.preview[key] = self.preview[key].filter(function (i) {
              return i.name !== imgName || i.path !== path;
            });
          });

          // Reload deleted tab to reflect the move
          this.preview.deletedImages = [];
          if (this.activeTab === 'deleted') {
            this._loadTabImages('deleted');
          }

          if (typeof Toast !== 'undefined') Toast.success('Image moved to deleted folder.');
        } else {
          throw new Error((data && data.error) || 'Delete failed');
        }
      } catch (err) {
        console.error('[Cropper] Delete failed:', err);
        if (typeof Toast !== 'undefined') Toast.error('Delete failed: ' + (err.message || 'Unknown error'));
      } finally {
        this.deleteConfirm.visible = false;
        this.deleteConfirm.deleting = false;
      }
    },

    // ══════════════════════════════════════════════════════════════════
    //  ERROR HANDLING
    // ══════════════════════════════════════════════════════════════════
    _handleProcessError(err) {
      var title = 'Processing Error';
      var message = (err && err.message) || 'An unknown error occurred.';

      if (err && err.data && err.data.message) {
        message = err.data.message;
      }

      if (message.indexOf('not reachable') !== -1 || message.indexOf('Cannot connect') !== -1) {
        title = 'Engine Not Reachable';
        // Trigger a check — engine may have gone offline mid-process
        this.checkEngine();
      } else if (message.indexOf('Permission') !== -1 || message.indexOf('EACCES') !== -1) {
        title = 'Permission Denied';
        message = 'The engine does not have permission to access the specified path.';
      } else if (message.indexOf('not exist') !== -1 || message.indexOf('not found') !== -1) {
        title = 'Path Not Found';
        message = 'The specified folder path does not exist on this machine.';
      } else if (message.indexOf('timed out') !== -1 || message.indexOf('timeout') !== -1) {
        title = 'Timeout';
      }

      this._showError(title, message);
    },

    _showError(title, message) {
      this.error.title = title;
      this.error.message = message;
      this.error.visible = true;
      if (typeof Toast !== 'undefined') Toast.error(message);
    },
  };
}
