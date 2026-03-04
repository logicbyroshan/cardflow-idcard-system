/**
 * Adarsh Cropper — Alpine.js Component  v5.0.0
 * ──────────────────────────────────────────────
 * Folder-only processing.  No ZIP upload.
 *
 * Features:
 *   - Direct engine connection at http://127.0.0.1:4765 (fallback: Django proxy)
 *   - Staged retry: 3 tries → 5 min sleep → 3 tries → 1 hr sleep → 3 tries → stop
 *   - Keepalive polling every 30 s (only while connected) — restarts staged retry on disconnect
 *   - Donut chart showing cropped vs failed counts
 *   - Image preview grid always available after processing
 *
 * @module adarsh-cropper
 * @version 5.0.0
 */

// ── Engine connection constants ──────────────────────────────────────────
var ENGINE_DIRECT_URL = 'http://127.0.0.1:4765';
var ENGINE_API_KEY    = 'passport-engine-local-key';
var KEEPALIVE_MS      = 30000;  // poll engine status every 30 s (only when connected)

// Staged-retry schedule: [{ attempts, retryDelayMs, sleepAfterMs | null }]
// 2 tries (2 s apart) → sleep 5 min → 2 tries → stop
// Kept minimal to avoid flooding the console with ERR_CONNECTION_REFUSED.
var ENGINE_RETRY_STAGES = [
  { attempts: 2, retryDelayMs: 2000, sleepAfterMs: 5 * 60 * 1000 },  // 5 min
  { attempts: 2, retryDelayMs: 2000, sleepAfterMs: null },            // give up
];

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

    // ── Compress state ──
    compressing: false,
    compressModal: {
      visible: false,
      source: 'folder',     // 'results' (from cropped output) or 'folder' (manual path)
      folderPath: '',
      targetKB: 100,
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
    _retryGaveUp: false,   // true once all retry stages exhausted

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

      this._stagedRetryConnect();
      // Start keepalive polling — only pings when engine is already connected
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
     * Staged retry connect:
     *  Stage 1: try 3 times (1.5 s apart)
     *  Stage 2: sleep 5 min, then try 3 times
     *  Stage 3: sleep 1 hr, then try 3 times
     *  After that: give up — user must manually refresh or click reconnect.
     */
    async _stagedRetryConnect() {
      this._retryGaveUp = false;
      for (var s = 0; s < ENGINE_RETRY_STAGES.length; s++) {
        var stage = ENGINE_RETRY_STAGES[s];
        for (var a = 1; a <= stage.attempts; a++) {
          await this.checkEngine();
          if (this.engine.connected) {
            console.log('[Cropper] Engine connected (stage ' + (s + 1) + ', attempt ' + a + ')');
            return;  // success — keepalive will handle ongoing monitoring
          }
          // Use debug level so these don't clutter the console by default
          console.debug('[Cropper] Engine not detected — stage ' + (s + 1) + ' attempt ' + a + '/' + stage.attempts);
          if (a < stage.attempts) {
            await new Promise(function (r) { setTimeout(r, stage.retryDelayMs); });
          }
        }
        // All attempts in this stage failed
        if (stage.sleepAfterMs) {
          var mins = Math.round(stage.sleepAfterMs / 60000);
          console.debug('[Cropper] Will retry in ' + mins + ' min…');
          await new Promise(function (r) { setTimeout(r, stage.sleepAfterMs); });
        }
      }
      // All stages exhausted — give up quietly
      this._retryGaveUp = true;
      console.info('[Cropper] Engine not found — retries exhausted. Refresh or click Reconnect to try again.');
    },

    // ══════════════════════════════════════════════════════════════════
    //  KEEPALIVE POLLING — detect disconnect / reconnect silently
    // ══════════════════════════════════════════════════════════════════
    async _keepalivePoll() {
      // Don't poll while processing (engine is busy)
      if (this.processing) return;
      // Don't poll if retries were exhausted and engine was never connected
      if (this._retryGaveUp && !this.engine.connected) return;
      var wasConnected = this.engine.connected;

      try {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 2000);
        var resp = await fetch(ENGINE_DIRECT_URL + '/status', { signal: controller.signal });
        clearTimeout(timer);

        if (resp.ok) {
          var data = await resp.json();
          if (!this.engine.connected) {
            // Reconnected — refresh full engine info
            console.log('[Cropper] Engine reconnected');
            this._retryGaveUp = false;
            await this.checkEngine();
          }
          return;
        }
      } catch (_) { /* direct failed */ }

      // Try proxy fallback
      try {
        var data = await ApiClient.get('/api/engine/status/');
        if (data && data.connected) {
          if (!this.engine.connected) {
            console.log('[Cropper] Engine reconnected via proxy');
            this._retryGaveUp = false;
            await this.checkEngine();
          }
          return;
        }
      } catch (_) { /* proxy failed too */ }

      // Engine went offline
      if (wasConnected) {
        console.debug('[Cropper] Engine disconnected — restarting detection…');
        this.engine.connected = false;
        this.engine.checked = true;
        this._broadcastEngineState();
        // Engine was connected but lost — run staged retry
        this._stagedRetryConnect();
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
        var timer = setTimeout(function () { controller.abort(); }, 3000);

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
          this._retryGaveUp = false;  // successful connect resets gave-up flag
          console.log('[Cropper] Connected directly to local engine v' + this.engine.version);
          this._broadcastEngineState();
          return;
        }
      } catch (_directErr) {
        // Direct failed — try Django proxy
      }

      // ── Attempt 2: Django proxy ───────────────────────────────────
      try {
        var data = await ApiClient.get('/api/engine/status/');

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
          this._retryGaveUp = false;  // successful connect resets gave-up flag
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
      this.engine.uptime = window.CropperUtils.formatUptime(secs);
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
        var data = await ApiClient.get('/api/cropper/latest-version/');
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
     * Compare two semver strings — delegates to CropperUtils.
     */
    _semverCompare(a, b) {
      return window.CropperUtils.semverCompare(a, b);
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
      var startTime = Date.now();
      var self = this;
      this._progressTimer = setInterval(() => {
        var elapsed = (Date.now() - startTime) / 1000;
        // Exponential deceleration: fast start, slows toward 90%
        var target = 90;
        var tau = 12; // reaches ~63% at 12s, ~86% at 24s
        var pct = Math.round(target * (1 - Math.exp(-elapsed / tau)));
        pct = Math.max(pct, self.progress.percent); // never go backwards
        if (pct < target) {
          self._updateProgress(pct, 'Engine processing photos…');
        }
      }, 500);
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
            '/api/engine/process-folder/',
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
     * Draw a simple donut chart — delegates to CropperDonut.
     */
    _drawDonutChart(success, failed) {
      window.CropperDonut.draw(this.$refs.chartCanvas, success, failed);
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
            '/api/engine/preview/?folder=' + encodeURIComponent(folderPath)
          );
        }

        if (data && data.files && data.files.length > 0) {
          var folder = data.folder || folderPath;
          var self = this;
          this.preview.images = data.files.map(function (name) {
            var fullPath = folder + '\\' + name;
            // Always use Django proxy for img src to avoid Mixed Content on HTTPS pages.
            // (Direct engine connection via fetch() works on HTTPS due to localhost exemption,
            //  but <img src="http://127.0.0.1:"> is blocked as passive mixed content.)
            return {
              name: name,
              url: '/api/engine/serve-image/?path=' + encodeURIComponent(fullPath),
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
            '/api/engine/preview/?folder=' + encodeURIComponent(tabFolder)
          );
        }

        if (data && data.files && data.files.length > 0) {
          var folder = data.folder || tabFolder;
          var self = this;
          var images = data.files.map(function (name) {
            var fullPath = folder + '\\' + name;
            // Always proxy for img src — avoids Mixed Content on HTTPS pages.
            return {
              name: name,
              url: '/api/engine/serve-image/?path=' + encodeURIComponent(fullPath),
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
     * Auto-adjust a single image — delegates to CropperAutoAdjust.
     */
    _autoAdjustSingle(imgObj, csrfToken) {
      return window.CropperAutoAdjust.adjustSingle(imgObj, csrfToken);
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
        var data = await ApiClient.post('/api/engine/delete-image/', {
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
    //  COMPRESS IMAGES — reduce file size to target KB
    // ══════════════════════════════════════════════════════════════════

    /**
     * Open the compress modal.
     * If there are cropped results available, offer to compress those.
     * Otherwise, ask for a folder path (pre-fill from the main input).
     */
    openCompressModal() {
      if (this.result.visible && this.result.success > 0 && this.result.outputFolder) {
        // There are cropped images — offer to compress them directly
        this.compressModal.source = 'results';
        this.compressModal.folderPath = this.result.outputFolder;
      } else {
        // No results — ask for a folder path
        this.compressModal.source = 'folder';
        this.compressModal.folderPath = this.folderPath.trim();
      }
      this.compressModal.visible = true;
    },

    /**
     * Start the compression process.
     * Uses the same direct/proxy pattern as processFolder().
     */
    async startCompress() {
      var targetKB = this.compressModal.targetKB;
      var folderPath = this.compressModal.folderPath.trim();

      if (!targetKB || targetKB <= 0) {
        if (typeof Toast !== 'undefined') Toast.error('Please enter a valid target size in KB.');
        return;
      }
      if (!folderPath) {
        if (typeof Toast !== 'undefined') Toast.error('Please enter a folder path.');
        return;
      }

      this.compressModal.visible = false;
      this.compressing = true;
      this.result.visible = false;
      this.preview.visible = false;
      this.error.visible = false;
      this._showProgress('Compressing images…');

      try {
        this._updateProgress(10, 'Sending compression request to engine…');
        this._startProgressSimulation();

        var data;

        if (this.engine.direct) {
          // ── Direct to local engine ────────────────────────────────
          var resp = await fetch(ENGINE_DIRECT_URL + '/compress-folder', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-ENGINE-KEY': ENGINE_API_KEY,
            },
            body: JSON.stringify({ folder_path: folderPath, target_kb: targetKB }),
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
            '/api/engine/compress-folder/',
            { folder_path: folderPath, target_kb: targetKB }
          );
        }

        this._hideProgress();

        if (data && data.total != null) {
          this._updateProgress(100, 'Compression complete!');
          this._showResult(data);
          if (typeof Toast !== 'undefined') {
            Toast.success('Compression complete! ' + (data.success || 0) + '/' + (data.total || 0) + ' images compressed to ≤ ' + targetKB + ' KB');
          }
        } else {
          throw new Error((data && data.message) || 'Compression failed');
        }

      } catch (err) {
        this._hideProgress();
        this._handleCompressError(err);
      } finally {
        this.compressing = false;
      }
    },

    /**
     * Handle compression-specific errors — delegates classification to CropperUtils.
     */
    _handleCompressError(err) {
      var classified = window.CropperUtils.classifyCompressError(err);
      if (classified.title === 'Engine Not Reachable') {
        this.checkEngine();
      }
      this._showError(classified.title, classified.message);
    },

    // ══════════════════════════════════════════════════════════════════
    //  ERROR HANDLING
    // ══════════════════════════════════════════════════════════════════
    _handleProcessError(err) {
      var classified = window.CropperUtils.classifyProcessError(err);
      if (classified.title === 'Engine Not Reachable') {
        // Trigger a check — engine may have gone offline mid-process
        this.checkEngine();
      }
      this._showError(classified.title, classified.message);
    },

    _showError(title, message) {
      this.error.title = title;
      this.error.message = message;
      this.error.visible = true;
      if (typeof Toast !== 'undefined') Toast.error(message);
    },
  };
}
