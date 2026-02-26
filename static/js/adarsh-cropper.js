/**
 * Adarsh Cropper — Alpine.js Component
 * ─────────────────────────────────────
 * Connects directly to the local PassportEngine service running on the
 * user's machine at http://127.0.0.1:4765.  Falls back to Django proxy
 * endpoints when running on localhost (dev mode).
 *
 * Direct engine routes:
 *   GET  http://127.0.0.1:4765/status          → engine status
 *   GET  http://127.0.0.1:4765/health          → engine health probe
 *   POST http://127.0.0.1:4765/process-zip     → process ZIP
 *   POST http://127.0.0.1:4765/process-folder  → process folder
 *
 * Fallback Django proxy routes (dev only):
 *   GET  /panel/api/engine/status/
 *   POST /panel/api/engine/process-zip/
 *   POST /panel/api/engine/process-folder/
 *   GET  /panel/api/engine/preview/
 *   GET  /panel/api/engine/serve-image/
 *
 * @module adarsh-cropper
 * @version 4.0.0
 */

// ── Engine connection constants ──────────────────────────────────────────
var ENGINE_DIRECT_URL = 'http://127.0.0.1:4765';
var ENGINE_API_KEY    = 'passport-engine-local-key';

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
      direct: false,  // true when connected directly to local engine
    },

    // ── UI state ──
    mode: 'zip',          // 'zip' | 'folder'
    file: null,           // selected File object
    folderPath: '',
    outputFolder: '',     // where to save cropped (ZIP mode)
    dragOver: false,
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
    },

    // ── Preview ──
    preview: {
      visible: false,
      loading: false,
      images: [],     // [{name, url}]
      folder: '',
    },

    // ── Error ──
    error: {
      visible: false,
      title: '',
      message: '',
    },

    // ── Internal ──
    _progressTimer: null,

    // ══════════════════════════════════════════════════════════════════
    //  INIT
    // ══════════════════════════════════════════════════════════════════
    init() {
      this.checkEngine();
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
              signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined,
            });
            if (hResp.ok) healthData = await hResp.json();
          } catch (_ignore) {}

          this.engine.connected = true;
          this.engine.direct = true;
          this.engine.version = healthData.version || statusData.version || '?';

          var secs = healthData.uptime_seconds || 0;
          if (secs >= 3600) {
            this.engine.uptime = Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
          } else if (secs > 0) {
            this.engine.uptime = Math.floor(secs / 60) + 'm ' + Math.floor(secs % 60) + 's';
          } else {
            this.engine.uptime = '';
          }
          this.engine.memory = healthData.memory_usage_mb != null
            ? String(healthData.memory_usage_mb)
            : '';

          this.engine.loading = false;
          this.engine.checked = true;
          console.log('[Cropper] Connected directly to local engine v' + this.engine.version);
          return;
        }
      } catch (_directErr) {
        // Direct connection failed — try Django proxy
      }

      // ── Attempt 2: Django proxy (works on localhost dev) ──────────
      try {
        var data = await ApiClient.get('/panel/api/engine/status/');

        if (data && data.connected) {
          var status = data.status || {};
          var health = data.health || {};

          this.engine.connected = true;
          this.engine.direct = false;
          this.engine.version = health.version || status.version || '?';

          var secs = health.uptime_seconds || 0;
          if (secs >= 3600) {
            this.engine.uptime = Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
          } else if (secs > 0) {
            this.engine.uptime = Math.floor(secs / 60) + 'm ' + Math.floor(secs % 60) + 's';
          } else {
            this.engine.uptime = '';
          }
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
      }
    },

    // ══════════════════════════════════════════════════════════════════
    //  FILE HANDLING
    // ══════════════════════════════════════════════════════════════════
    handleDrop(event) {
      this.dragOver = false;
      var files = event.dataTransfer.files;
      if (!files || files.length === 0) return;

      var f = files[0];
      if (!f.name.toLowerCase().endsWith('.zip')) {
        this._showError('Invalid File', 'Only .zip files are accepted.');
        return;
      }
      this.file = f;
    },

    handleFileSelect(event) {
      var input = event.target;
      if (input.files && input.files[0]) {
        var f = input.files[0];
        if (!f.name.toLowerCase().endsWith('.zip')) {
          this._showError('Invalid File', 'Only .zip files are accepted.');
          input.value = '';
          return;
        }
        this.file = f;
      }
    },

    clearFile() {
      this.file = null;
      // Reset file input
      var input = this.$refs.fileInput;
      if (input) input.value = '';
    },

    formatSize(bytes) {
      if (!bytes) return '';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1048576).toFixed(1) + ' MB';
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
      // Gradually increase progress while waiting for server
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
    //  PROCESS ZIP — direct engine or Django proxy
    // ══════════════════════════════════════════════════════════════════
    async processZip() {
      if (!this.file || this.processing) return;
      this.processing = true;
      this.result.visible = false;
      this.preview.visible = false;
      this.error.visible = false;
      this._showProgress('Processing…');

      try {
        this._updateProgress(10, 'Uploading ZIP file…');

        var formData = new FormData();
        formData.append('file', this.file);

        // Pass output folder if user specified one
        var outFolder = this.outputFolder.trim();
        if (outFolder) {
          formData.append('output_folder', outFolder);
          // For direct engine: synthesise original_path
          var zipStem = this.file.name.replace(/\.zip$/i, '');
          formData.append('original_path', outFolder + '\\' + zipStem + '.zip');
        }

        this._updateProgress(30, 'Sending to engine…');
        this._startProgressSimulation();

        var data;

        if (this.engine.direct) {
          // ── Direct to local engine ────────────────────────────────
          var resp = await fetch(ENGINE_DIRECT_URL + '/process-zip', {
            method: 'POST',
            headers: { 'X-ENGINE-KEY': ENGINE_API_KEY },
            body: formData,
          });
          if (!resp.ok) {
            var errBody = {};
            try { errBody = await resp.json(); } catch (_) {}
            throw new Error(errBody.message || errBody.detail || 'Engine error ' + resp.status);
          }
          data = await resp.json();
          data.success = true;
        } else {
          // ── Django proxy fallback ─────────────────────────────────
          data = await ApiClient.upload(
            '/panel/api/engine/process-zip/',
            formData,
            {
              onProgress: (pct) => {
                if (pct < 50) {
                  this._updateProgress(pct, 'Uploading ZIP file…');
                }
              },
              timeout: 300000,
            }
          );
        }

        this._hideProgress();

        if (data && data.success !== false) {
          this._updateProgress(100, 'Complete!');
          this._showResult(data);
          this.clearFile();
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
    //  PROCESS FOLDER — direct engine or Django proxy
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
          data.success = true;
        } else {
          // ── Django proxy fallback ─────────────────────────────────
          data = await ApiClient.post(
            '/panel/api/engine/process-folder/',
            { folder_path: path }
          );
        }

        this._hideProgress();

        if (data && data.success !== false) {
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
    //  RESULT DISPLAY
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

      // Collect error items
      var errs = data.errors || [];
      this.result.errors = errs.map(function (e) {
        return typeof e === 'string' ? e : (e.file || e.filename || JSON.stringify(e));
      });

      this.result.visible = true;

      // Auto-load preview if there are successful images
      if (success > 0 && this.result.outputFolder) {
        this._loadPreview(this.result.outputFolder);
      }
    },

    // ══════════════════════════════════════════════════════════════════
    //  IMAGE PREVIEW
    // ══════════════════════════════════════════════════════════════════
    async _loadPreview(folderPath) {
      this.preview.loading = true;
      this.preview.visible = true;
      this.preview.images = [];
      this.preview.folder = folderPath;

      // In direct mode, files are on the user's local machine.
      // The Django proxy endpoints (preview/serve-image) can't access them
      // in production, so we skip image preview and just show the folder path.
      if (this.engine.direct) {
        this.preview.loading = false;
        return;
      }

      try {
        var data = await ApiClient.get(
          '/panel/api/engine/preview/?folder=' + encodeURIComponent(folderPath)
        );

        if (data && data.files && data.files.length > 0) {
          var folder = data.folder || folderPath;
          this.preview.images = data.files.map(function (name) {
            var fullPath = folder + '\\' + name;
            return {
              name: name,
              url: '/panel/api/engine/serve-image/?path=' + encodeURIComponent(fullPath),
            };
          });
        }
      } catch (_e) {
        // Preview is optional — don't show error
      } finally {
        this.preview.loading = false;
      }
    },

    openFolder(folderPath) {
      // Copy path to clipboard for user convenience
      if (folderPath && navigator.clipboard) {
        navigator.clipboard.writeText(folderPath).then(function () {
          if (typeof Toast !== 'undefined') Toast.success('Path copied to clipboard!');
        });
      }
    },

    // ══════════════════════════════════════════════════════════════════
    //  ERROR HANDLING
    // ══════════════════════════════════════════════════════════════════
    _handleProcessError(err) {
      var title = 'Processing Error';
      var message = (err && err.message) || 'An unknown error occurred.';

      // More specific messages based on error shape
      if (err && err.data && err.data.message) {
        message = err.data.message;
      }

      if (message.indexOf('not reachable') !== -1 || message.indexOf('Cannot connect') !== -1) {
        title = 'Engine Not Reachable';
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
