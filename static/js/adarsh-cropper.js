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

    // ── Auto Adjust All state ──
    autoAdjustState: {
      running: false,
      progress: '',
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
      // Restore persisted state from sessionStorage (if navigating back)
      this._restoreState();

      this._checkEngineWithRetry();
      // Start keepalive polling — silently re-checks every 30 s
      this._keepaliveId = setInterval(() => { this._keepalivePoll(); }, KEEPALIVE_MS);

      // Save state before navigating away so results persist
      var self = this;
      this._beforeUnloadHandler = function () { self._saveState(); };
      window.addEventListener('beforeunload', this._beforeUnloadHandler);
      // Also save on link clicks (SPA-like navigation via HTMX/turbo)
      document.addEventListener('click', function (ev) {
        var link = ev.target.closest('a[href]');
        if (link && !link.getAttribute('href').startsWith('#')) {
          self._saveState();
        }
      });
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
      // Clear persisted state when user explicitly clears
      try { sessionStorage.removeItem('_cropperState'); } catch (_) {}
    },

    // ══════════════════════════════════════════════════════════════════
    //  STATE PERSISTENCE — survive navigation away and back
    // ══════════════════════════════════════════════════════════════════

    /**
     * Key to storage — unique for this page.
     */
    _STORAGE_KEY: '_cropperState',

    /**
     * Save essential state to sessionStorage so navigating away
     * and coming back retains cropped photos, results, and folder path.
     */
    _saveState() {
      try {
        if (!this.result.visible && !this.preview.visible) return;
        var state = {
          folderPath: this.folderPath,
          activeTab: this.activeTab,
          result: {
            visible: this.result.visible,
            total: this.result.total,
            success: this.result.success,
            failed: this.result.failed,
            accuracy: this.result.accuracy,
            time: this.result.time,
            outputFolder: this.result.outputFolder,
            failedFolder: this.result.failedFolder,
            errors: this.result.errors,
          },
          preview: {
            visible: this.preview.visible,
            folder: this.preview.folder,
            images: this.preview.images,
            editedImages: this.preview.editedImages,
            failedImages: this.preview.failedImages,
            deletedImages: this.preview.deletedImages,
          },
          timestamp: Date.now(),
        };
        sessionStorage.setItem(this._STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn('[Cropper] State save failed:', err);
      }
    },

    /**
     * Restore state from sessionStorage if available and recent (< 30 min).
     */
    _restoreState() {
      try {
        var raw = sessionStorage.getItem(this._STORAGE_KEY);
        if (!raw) return;
        var state = JSON.parse(raw);
        // Only restore if saved within the last 30 minutes
        if (Date.now() - (state.timestamp || 0) > 30 * 60 * 1000) {
          sessionStorage.removeItem(this._STORAGE_KEY);
          return;
        }

        // Restore folder path
        if (state.folderPath) this.folderPath = state.folderPath;
        if (state.activeTab) this.activeTab = state.activeTab;

        // Restore result summary
        if (state.result && state.result.visible) {
          this.result.visible = true;
          this.result.total = state.result.total || 0;
          this.result.success = state.result.success || 0;
          this.result.failed = state.result.failed || 0;
          this.result.accuracy = state.result.accuracy || '—';
          this.result.time = state.result.time || '—';
          this.result.outputFolder = state.result.outputFolder || '';
          this.result.failedFolder = state.result.failedFolder || '';
          this.result.errors = state.result.errors || [];
          // Redraw donut chart after DOM renders
          var self = this;
          this.$nextTick(function () {
            self._drawDonutChart(self.result.success, self.result.failed);
          });
        }

        // Restore preview images
        if (state.preview && state.preview.visible) {
          this.preview.visible = true;
          this.preview.folder = state.preview.folder || '';
          this.preview.images = state.preview.images || [];
          this.preview.editedImages = state.preview.editedImages || [];
          this.preview.failedImages = state.preview.failedImages || [];
          this.preview.deletedImages = state.preview.deletedImages || [];
        }

        console.log('[Cropper] State restored from session');
      } catch (err) {
        console.warn('[Cropper] State restore failed:', err);
        try { sessionStorage.removeItem(this._STORAGE_KEY); } catch (_) {}
      }
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
    //  AUTO-ADJUST ALL — batch auto-levels on every image in current tab
    // ══════════════════════════════════════════════════════════════════
    async autoAdjustAll() {
      var images = this.currentTabImages();
      if (!images || images.length === 0) return;

      this.autoAdjustState.running  = true;
      this.autoAdjustState.progress = '0 / ' + images.length;

      // CSRF token for saving
      var csrfToken = '';
      var csrfMeta  = document.querySelector('meta[name="csrf-token"]');
      if (csrfMeta) {
        csrfToken = csrfMeta.getAttribute('content');
      } else {
        var m = document.cookie.match(/csrftoken=([^;]+)/);
        if (m) csrfToken = m[1];
      }

      var done  = 0;
      var total = images.length;

      for (var i = 0; i < total; i++) {
        var img = images[i];
        this.autoAdjustState.progress = done + ' / ' + total;

        try {
          var resultUrl = await this._autoAdjustSingle(img, csrfToken);
          if (resultUrl) {
            img.url = resultUrl + '&t=' + Date.now();
          }
        } catch (err) {
          console.warn('[AutoAdjust] Failed for ' + img.name + ':', err);
        }

        done++;
        this.autoAdjustState.progress = done + ' / ' + total;
      }

      this.autoAdjustState.running  = false;
      this.autoAdjustState.progress = '';

      // Reload the edited tab so the newly saved images appear there
      this.preview.editedImages = [];
      this._loadTabImages('edited');

      if (typeof Toast !== 'undefined') {
        Toast.success('Auto-adjusted ' + done + ' images.');
      }
    },

    /**
     * Auto-adjust a single image: load → auto-levels → export → save.
     * Returns the new served URL on success, or null.
     */
    _autoAdjustSingle(imgObj, csrfToken) {
      var self = this;

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
