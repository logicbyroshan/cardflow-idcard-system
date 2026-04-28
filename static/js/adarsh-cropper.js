/**
 * Adarsh Cropper  -  Alpine.js Component  v5.0.0
 * ----------------------------------------------
 * Folder-only processing.  No ZIP upload.
 *
 * Features:
 *   - Direct engine connection at http://127.0.0.1:4765 (fallback: Django proxy)
 *   - Staged retry: 3 tries -> 5 min sleep -> 3 tries -> 1 hr sleep -> 3 tries -> stop
 *   - Keepalive polling every 30 s (only while connected)  -  restarts staged retry on disconnect
 *   - Donut chart showing cropped vs failed counts
 *   - Image preview grid always available after processing
 *
 * @module adarsh-cropper
 * @version 5.0.0
 */

// -- Engine connection constants ------------------------------------------
var ENGINE_DIRECT_URL = 'http://127.0.0.1:4765';
var ENGINE_API_KEY    = 'passport-engine-local-key';
var KEEPALIVE_MS      = 30000;  // poll engine status every 30 s (only when connected)

// Staged-retry schedule: [{ attempts, retryDelayMs, sleepAfterMs | null }]
// 2 tries (2 s apart) -> sleep 5 min -> 2 tries -> stop
// Kept minimal to avoid flooding the console with ERR_CONNECTION_REFUSED.
var ENGINE_RETRY_STAGES = [
  { attempts: 2, retryDelayMs: 2000, sleepAfterMs: 5 * 60 * 1000 },  // 5 min
  { attempts: 2, retryDelayMs: 2000, sleepAfterMs: null },            // give up
];

function cropperApp() {
  return {
    // -- Engine state --
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

    // -- UI state --
    folderPath: '',
    folderLocked: false,   // lock the path once processing starts
    workingFolder: '',     // tracks active folder through pipeline steps
    processing: false,
    stopping: false,       // tracks if stop was requested

    // -- Progress --
    progress: {
      visible: false,
      label: 'Processing...',
      percent: 0,
      detail: 'Preparing...',
    },

    // -- Result --
    result: {
      visible: false,
      total: 0,
      success: 0,
      failed: 0,
      accuracy: ' - ',
      time: ' - ',
      outputFolder: '',
      failedFolder: '',
      errors: [],
      errorsExpanded: false,
    },

    // -- Preview --
    preview: {
      visible: false,
      loading: false,
      images: [],
      editedImages: [],
      failedImages: [],
      deletedImages: [],
      folder: '',
    },

    // -- Tabs --
    activeTab: 'cropped',

    // -- Delete confirmation --
    deleteConfirm: {
      visible: false,
      imageName: '',
      imagePath: '',
      deleting: false,
    },

    // -- Auto Adjust All state --
    autoAdjustState: {
      running: false,
      progress: '',
    },

    // -- Pipeline (preset) state --
    pipeline: {
      facePick: false,      // Page photo picker disabled by default
      photosPerPage: 3,     // Number of photos expected in each scanned page
      faceCrop: false,      // Face crop disabled by default
      compress: false,      // Compress disabled by default
      compressKB: 50,       // Default 50KB target
      rename: false,        // Rename disabled by default
      renameOperation: 'remove_camera_prefix',
      renameParam: '',      // For prefix text or base name
      edit: false,          // Edit/preview disabled by default
    },

    // -- Client selection state --
    inputMode: 'manual',           // 'client' or 'manual'
    clients: [],                   // List of accessible clients
    clientsLoading: false,
    clientsLoaded: false,
    selectedClientId: '',          // Selected client ID

    // -- Error --
    error: {
      visible: false,
      title: '',
      message: '',
    },

    // -- Selection state --
    selection: {
      all: false,
      count: 0,
      selected: {},  // { [imageName]: true }
    },

    // -- Rename state --
    renameState: {
      running: false,
    },
    renameModal: {
      visible: false,
      loading: false,
      operation: 'add_prefix',
      params: {
        prefix: '',
        suffix: '',
        old_text: '',
        new_text: '',
        text: '',
        base_name: '',
        start: 1,
        digits: 3,
      },
      preview: [],
      previewStats: {
        total: 0,
        changed: 0,
        conflicts: 0,
      },
    },

    // -- Internal --
    _progressTimer: null,
    _keepaliveId: null,
    _retryGaveUp: false,   // true once all retry stages exhausted
    _pendingPreviewReload: false, // true when restored state needs image URL refresh
    _abortController: null, // used to cancel ongoing fetch requests


    // -- Update state --
    update: {
      available: false,
      version: '',
      downloadUrl: '',
      bootstrapVersion: '3.19.0',
      bootstrapDownloadUrl: '',
      changelog: '',
      installing: false,
      installError: '',
    },

    // 
    //  INIT
    // 
    init() {
      // Restore persisted state from sessionStorage (if navigating back)
      this._restoreState();

      // Fetch latest release info immediately (for download button version)
      this._fetchLatestVersion();

      this._stagedRetryConnect();
      // Start keepalive polling  -  only pings when engine is already connected
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
     *  After that: give up  -  user must manually refresh or click reconnect.
     */
    async _stagedRetryConnect() {
      this._retryGaveUp = false;
      for (var s = 0; s < ENGINE_RETRY_STAGES.length; s++) {
        var stage = ENGINE_RETRY_STAGES[s];
        for (var a = 1; a <= stage.attempts; a++) {
          await this.checkEngine();
          if (this.engine.connected) {
            // If state was restored from sessionStorage, re-fetch preview
            // images so URLs match the current connection mode.
            if (this._pendingPreviewReload && this.preview.folder) {
              this._pendingPreviewReload = false;
              this._loadPreview(this.preview.folder);
            }
            return;  // success  -  keepalive will handle ongoing monitoring
          }
          // Use debug level so these don't clutter the console by default
          console.debug('[Cropper] Engine not detected  -  stage ' + (s + 1) + ' attempt ' + a + '/' + stage.attempts);
          if (a < stage.attempts) {
            await new Promise(function (r) { setTimeout(r, stage.retryDelayMs); });
          }
        }
        // All attempts in this stage failed
        if (stage.sleepAfterMs) {
          var mins = Math.round(stage.sleepAfterMs / 60000);
          console.debug('[Cropper] Will retry in ' + mins + ' min...');
          await new Promise(function (r) { setTimeout(r, stage.sleepAfterMs); });
        }
      }
      // All stages exhausted  -  give up quietly
      this._retryGaveUp = true;
      console.info('[Cropper] Engine not found  -  retries exhausted. Refresh or click Reconnect to try again.');
    },

    // 
    //  KEEPALIVE POLLING  -  detect disconnect / reconnect silently
    // 
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
            // Reconnected  -  refresh full engine info
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
            this._retryGaveUp = false;
            await this.checkEngine();
          }
          return;
        }
      } catch (_) { /* proxy failed too */ }

      // Engine went offline
      if (wasConnected) {
        console.debug('[Cropper] Engine disconnected  -  restarting detection...');
        this.engine.connected = false;
        this.engine.checked = true;
        this._broadcastEngineState();
        // Engine was connected but lost  -  run staged retry
        this._stagedRetryConnect();
      }
    },

    // 
    //  ENGINE DETECTION  -  try direct first, then Django proxy fallback
    // 
    async checkEngine() {
      this.engine.loading = true;
      this.engine.connected = false;
      this.engine.direct = false;

      // -- Attempt 1: Direct connection to local engine --------------
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
          this._broadcastEngineState();
          return;
        }
      } catch (_directErr) {
        // Direct failed  -  try Django proxy
      }

      // -- Attempt 2: Django proxy -----------------------------------
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

    // 
    //  FETCH LATEST VERSION  -  called on init to populate download button
    // 
    async _fetchLatestVersion() {
      try {
        var data = await ApiClient.get('/api/cropper/latest-version/');
        if (data) {
          this.update.bootstrapVersion = data.bootstrap_version || this.update.bootstrapVersion || '3.18.0';
          this.update.bootstrapDownloadUrl = data.bootstrap_download_url || '';
        }
        if (data && data.available) {
          // Store the latest release info for download buttons
          this.update.version = data.version || '';
          this.update.downloadUrl = data.download_url || '';
          this.update.changelog = data.changelog || '';
        }
      } catch (err) {
        console.warn('[Cropper] Failed to fetch latest version:', err);
      }
    },

    // 
    //  AUTO-UPDATE CHECK  -  compare installed version vs latest release
    // 
    async _checkForUpdates() {
      try {
        var data = await ApiClient.get('/api/cropper/latest-version/');

        if (data) {
          this.update.bootstrapVersion = data.bootstrap_version || this.update.bootstrapVersion || '3.18.0';
          this.update.bootstrapDownloadUrl = data.bootstrap_download_url || '';
        }

        if (!data || !data.available) {
          this.update.available = false;
          this.update.installError = '';
          return;
        }

        var installedVersion = this.engine.version || '0.0.0';
        var latestVersion = data.version || '0.0.0';

        // Always store the latest version info
        this.update.version = latestVersion;
        this.update.downloadUrl = data.download_url || '';
        this.update.changelog = data.changelog || '';

        if (this._semverCompare(latestVersion, installedVersion) > 0) {
          this.update.available = true;
        } else {
          this.update.available = false;
          this.update.installError = '';
        }
      } catch (err) {
        console.warn('[Cropper] Update check failed:', err);
        // Silently ignore  -  update check is non-critical
      }
    },

    /**
     * Compare two semver strings  -  delegates to CropperUtils.
     */
    _semverCompare(a, b) {
      return window.CropperUtils.semverCompare(a, b);
    },

    /**
     * Return a same-origin URL for downloading the installer.
     */
    _resolvedUpdateDownloadUrl() {
      if (this.update.downloadUrl && String(this.update.downloadUrl).charAt(0) === '/') {
        return this.update.downloadUrl;
      }
      return '/panel/engine/download/';
    },

    _resolvedBootstrapDownloadUrl() {
      var url = String(this.update.bootstrapDownloadUrl || '');
      if (url) {
        if (url.charAt(0) === '/' || /^https?:\/\//i.test(url)) {
          return url;
        }
      }
      return this._resolvedUpdateDownloadUrl();
    },

    needsBootstrapInstaller() {
      var installedVersion = this.engine && this.engine.version ? this.engine.version : '0.0.0';
      var bootstrapVersion = this.update.bootstrapVersion || '3.18.0';
      return this._semverCompare(installedVersion, bootstrapVersion) < 0;
    },

    downloadBootstrapInstaller() {
      window.location.href = this._resolvedBootstrapDownloadUrl();
    },

    /**
     * Download and apply update in-place through the local engine service.
     */
    async installEngineUpdate() {
      if (this.update.installing) return;

      var bootstrapVersion = this.update.bootstrapVersion || '3.18.0';

      // Older engines do not support self-update upload/install.
      if (this.needsBootstrapInstaller()) {
        this.update.installError = (
          'Current engine v' + (this.engine.version || 'unknown') +
          ' does not support one-click update. Download and install v' +
          bootstrapVersion + ' first.'
        );
        if (typeof Toast !== 'undefined') {
          Toast.info('Please download and install v' + bootstrapVersion + ' first.');
        }
        return;
      }

      this.update.installing = true;
      this.update.installError = '';
      this._showProgress('Installing engine update...');
      this._updateProgress(5, 'Requesting update from server...');

      try {
        var installResp = await fetch('/api/engine/self-update/', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            silent: true,
            source_version: this.update.version || '',
          }),
        });

        var installData = {};
        try { installData = await installResp.json(); } catch (_) {}

        if (!installResp.ok || !installData.accepted) {
          var detail = installData.message || installData.detail || ('Engine update error ' + installResp.status);
          throw new Error(detail);
        }

        this._updateProgress(100, 'Update installer launched. Waiting for service restart...');
        this.update.available = false;

        if (typeof Toast !== 'undefined') {
          Toast.info('Update started. Please wait 30-60 seconds while Adarsh Engine restarts.');
        }

        var self = this;
        setTimeout(function () {
          self.checkEngine();
        }, 12000);
      } catch (err) {
        this.update.installError = err && err.message ? err.message : 'Failed to start update.';
        console.warn('[Cropper] Update install failed:', err);
        if (typeof Toast !== 'undefined') {
          Toast.error('Update failed: ' + this.update.installError);
        }
      } finally {
        this.update.installing = false;
        this._hideProgress();
      }
    },

    /**
     * Stop the current processing pipeline.
     * Signals the local engine to stop and aborts browser-side loop.
     */
    async stopProcessing() {
      if (!this.processing || this.stopping) return;
      
      this.stopping = true;
      this.progress.detail = 'Stopping... please wait.';
      
      // 1. Abort ongoing fetch requests in the browser
      if (this._abortController) {
        this._abortController.abort();
      }
      
      // 2. Signal the backend/local engine to stop
      try {
        await ApiClient.post('/api/engine/stop/', {});
      } catch (err) {
        console.debug('[Cropper] Engine stop signal failed (might not be supported):', err);
      }
    },

    /**
     * Shut down the engine service completely (full process exit).
     * Requires user confirmation. After shutdown, engine goes offline.
     */
    async shutdownEngine() {
      if (!this.engine.connected) {
        if (typeof Toast !== 'undefined') Toast.info('Engine is already offline.');
        return;
      }

      var confirmed = confirm(
        'Stop Adarsh Engine?\n\n' +
        'This will shut down the local photo processing engine. ' +
        'You will need to restart the service manually or reboot your computer.\n\n' +
        'Are you sure?'
      );
      if (!confirmed) return;

      try {
        var resp = await fetch('/api/engine/shutdown/', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        var data = {};
        try { data = await resp.json(); } catch (_) {}

        this.engine.connected = false;
        this.engine.checked = true;
        this._broadcastEngineState();

        if (typeof Toast !== 'undefined') {
          Toast.success('Engine stopped successfully. Restart the service when needed.');
        }
      } catch (err) {
        console.warn('[Cropper] Shutdown request failed:', err);
        if (typeof Toast !== 'undefined') {
          Toast.error('Failed to stop engine: ' + (err.message || 'Unknown error'));
        }
      }
    },

    // 
    //  PROGRESS HELPERS

    // 
    _showProgress(label) {
      this.progress.visible = true;
      this.progress.label = label || 'Processing...';
      this.progress.percent = 0;
      this.progress.detail = 'Preparing...';
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
          self._updateProgress(pct, 'Engine processing photos...');
        }
      }, 500);
    },

    // 
    //  CLIENT SELECTION
    // 
    
    /**
     * Load accessible clients from the server.
     * Called when switching to client mode or on first page load.
     */
    async loadClients() {
      // Only load once
      if (this.clientsLoaded || this.clientsLoading) return;
      
      this.clientsLoading = true;
      try {
        var resp = await fetch('/api/engine/clients/');
        var data = await resp.json();
        
        if (data.success && data.clients) {
          this.clients = data.clients;
          this.clientsLoaded = true;
        } else {
          console.error('Failed to load clients:', data.message);
          this.clients = [];
        }
      } catch (err) {
        console.error('Error loading clients:', err);
        this.clients = [];
      } finally {
        this.clientsLoading = false;
      }
    },
    
    /**
     * Handle client selection from dropdown.
     * Sets the folderPath to the selected client's image folder.
     */
    onClientSelect() {
      var clientId = this.selectedClientId;
      if (!clientId) {
        // No client selected, clear the folder path
        this.folderPath = '';
        return;
      }
      
      // Find the selected client
      var client = this.clients.find(function(c) { return c.id == clientId; });
      if (client && client.folder_path) {
        this.folderPath = client.folder_path;
      }
    },

    // 
    //  PROCESS FOLDER
    // 
    async processFolder() {
      var path = this.folderPath.trim();
      if (!path || this.processing) return;
      
      // Check that at least one operation is selected
      var hasOperation = this.pipeline.facePick || this.pipeline.faceCrop || this.pipeline.compress || this.pipeline.rename || this.pipeline.edit;
      if (!hasOperation) {
        if (typeof Toast !== 'undefined') Toast.warning('Please select at least one operation');
        return;
      }
      
      // Lock the folder path so it can't be accidentally changed
      this.folderLocked = true;
      this.processing = true;
      this.error.visible = false;
      this.stopping = false;
      this._abortController = new AbortController();
      this._showProgress('Processing...');


      try {
        // Use workingFolder if we already have one (chained ops), otherwise start from path
        var outputFolder = this.workingFolder || path;

        // If page photo picker is enabled, extract printed photo regions first.
        if (this.pipeline.facePick) {
          this._showProgress('Picking photos from pages...');
          this._updateProgress(10, 'Detecting photo regions and correcting perspective...');

          var pickData;
          if (this.engine.direct) {
            var pickResp = await fetch(ENGINE_DIRECT_URL + '/page-photo-picker-folder', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-ENGINE-KEY': ENGINE_API_KEY,
              },
              signal: this._abortController.signal,
              body: JSON.stringify({
                folder_path: outputFolder,
                photos_per_page: this.pipeline.photosPerPage || 3,
              }),
            });

            if (!pickResp.ok) {
              var pickErrBody = {};
              try { pickErrBody = await pickResp.json(); } catch (_) {}
              throw new Error(pickErrBody.message || pickErrBody.detail || 'Page picker error ' + pickResp.status);
            }
            pickData = await pickResp.json();
          } else {
            pickData = await ApiClient.post('/api/engine/page-photo-picker-folder/', {
              folder_path: outputFolder,
              photos_per_page: this.pipeline.photosPerPage || 3,
            }, { signal: this._abortController.signal });
          }

          this._hideProgress();
          if (this.stopping) return;

          if (pickData && pickData.total != null) {

            this._showResult(pickData);
            var pickedFilesWritten = Number(pickData.photos_written || 0);
            if (pickData.output_folder && (pickData.success > 0 || pickedFilesWritten > 0)) {
              outputFolder = pickData.output_folder;
            } else if (this.pipeline.faceCrop) {
              throw new Error('Page Photo Picker found no photos to crop. Disable Face Crop or choose a folder with printable photo pages.');
            }
          } else {
            throw new Error((pickData && pickData.message) || 'Page photo picker failed');
          }
        }
        
        // If face crop is enabled, run face crop.
        // Preserve legacy behavior (original path) unless page picker already produced a new source folder.
        if (this.pipeline.faceCrop) {
          var faceCropInputFolder = this.pipeline.facePick ? outputFolder : path;
          this._updateProgress(10, 'Sending folder path to engine...');
          this._startProgressSimulation();

          var data;

          if (this.engine.direct) {
            // -- Direct to local engine --------------------------------
            var resp = await fetch(ENGINE_DIRECT_URL + '/process-folder', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-ENGINE-KEY': ENGINE_API_KEY,
              },
              signal: this._abortController.signal,
              body: JSON.stringify({ folder_path: faceCropInputFolder }),
            });
            if (!resp.ok) {
              var errBody = {};
              try { errBody = await resp.json(); } catch (_) {}
              throw new Error(errBody.message || errBody.detail || 'Engine error ' + resp.status);
            }
            data = await resp.json();
          } else {
            // -- Django proxy fallback ---------------------------------
            data = await ApiClient.post(
              '/api/engine/process-folder/',
              { folder_path: faceCropInputFolder },
              { signal: this._abortController.signal }
            );
          }

          this._hideProgress();
          if (this.stopping) return;

          if (data && data.total != null) {

            this._updateProgress(100, 'Cropping complete!');
            this._showResult(data);
            
            // Use cropped folder for subsequent operations
            if (data.success > 0 && data.output_folder) {
              outputFolder = data.output_folder;
            }
          } else {
            throw new Error((data && data.message) || 'Processing failed');
          }
        }
        
        // Execute pipeline steps (compress + rename) on the output folder
        // For non-faceCrop operations, outputFolder = current workingFolder or original path
        var finalFolder = await this._executePipeline(outputFolder, this.pipeline.faceCrop);
        
        // Update workingFolder so the next operation starts here
        this.workingFolder = finalFolder;
        
        // If Edit-only mode (no pick/crop/compress/rename), just load images for editing
        if (!this.pipeline.facePick && !this.pipeline.faceCrop && !this.pipeline.compress && !this.pipeline.rename && this.pipeline.edit) {
          this._loadPreview(this.workingFolder || path);
          if (typeof Toast !== 'undefined') Toast.info('Images loaded for editing. Click any image to open the editor.');
        } else {
          if (typeof Toast !== 'undefined') Toast.success('Processing complete!');
        }

      } catch (err) {
        this._hideProgress();
        this._handleProcessError(err);
      } finally {
        this.processing = false;
        this.stopping = false;
        this._abortController = null;
      }

    },

    /**
     * Execute pipeline steps after cropping (compress + rename).
     * Returns the final output folder (may change after compress creates subfolder).
     */
    async _executePipeline(outputFolder, hadFaceCrop) {
      var currentFolder = outputFolder;
      var pipelineResult = null;
      
      // Step 1: Compress (if enabled)
      if (this.pipeline.compress && this.pipeline.compressKB > 0) {
        try {
          this._showProgress('Compressing images...');
          this._updateProgress(20, 'Compressing to ' + this.pipeline.compressKB + ' KB...');

          var compressData;
          if (this.engine.direct) {
            var resp = await fetch(ENGINE_DIRECT_URL + '/compress-folder', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-ENGINE-KEY': ENGINE_API_KEY,
              },
              signal: this._abortController.signal,
              body: JSON.stringify({
                folder_path: currentFolder,
                target_kb: this.pipeline.compressKB
              }),
            });
            if (resp.ok) {
              compressData = await resp.json();
            } else {
              var errBody = {};
              try { errBody = await resp.json(); } catch (_) {}
              throw new Error(errBody.message || errBody.detail || 'Compress error ' + resp.status);
            }
          } else {
            compressData = await ApiClient.post('/api/engine/compress-folder/', {
              folder_path: currentFolder,
              target_kb: this.pipeline.compressKB
            }, { signal: this._abortController.signal });
          }

          if (this.stopping) return currentFolder;

          if (compressData && compressData.total >= 0) {

            // Update currentFolder to compressed output for next steps
            if (compressData.output_folder) {
              currentFolder = compressData.output_folder;
            }
            // Store result for display if no faceCrop ran
            if (!hadFaceCrop) {
              pipelineResult = compressData;
            }
          }
        } catch (err) {
          console.warn('[Pipeline] Compress error:', err);
          if (typeof Toast !== 'undefined') Toast.error('Compress failed: ' + err.message);
        }
        this._hideProgress();
      }

      // Step 2: Rename (if enabled)
      if (this.pipeline.rename && this.pipeline.renameOperation) {
        try {
          this._showProgress('Renaming images...');
          this._updateProgress(60, 'Applying rename operation...');

          var renameParams = {};
          if (this.pipeline.renameOperation === 'add_prefix') {
            renameParams.prefix = this.pipeline.renameParam || '';
          } else if (this.pipeline.renameOperation === 'add_suffix') {
            renameParams.suffix = this.pipeline.renameParam || '';
          } else if (this.pipeline.renameOperation === 'remove_prefix') {
            renameParams.prefix = this.pipeline.renameParam || '';
          } else if (this.pipeline.renameOperation === 'remove_suffix') {
            renameParams.suffix = this.pipeline.renameParam || '';
          } else if (this.pipeline.renameOperation === 'sequential') {
            renameParams.base_name = this.pipeline.renameParam || '';
            renameParams.digits = 3;
            renameParams.start = 1;
          } else if (this.pipeline.renameOperation === 'replace_text') {
            var parts = (this.pipeline.renameParam || '').split('->');
            renameParams.old_text = parts[0] || '';
            renameParams.new_text = parts[1] || '';
          } else if (this.pipeline.renameOperation === 'remove_text') {
            renameParams.text = this.pipeline.renameParam || '';
          } else if (this.pipeline.renameOperation === 'change_extension') {
            renameParams.new_extension = this.pipeline.renameParam || '';
          }

          var renameData;
          if (this.engine.direct) {
            var resp = await fetch(ENGINE_DIRECT_URL + '/rename-execute', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-ENGINE-KEY': ENGINE_API_KEY,
              },
              signal: this._abortController.signal,
              body: JSON.stringify({
                folder_path: currentFolder,
                operation: this.pipeline.renameOperation,
                params: renameParams,
                skip_conflicts: true
              }),
            });
            if (resp.ok) {
              renameData = await resp.json();
            } else {
              var errBody = {};
              try { errBody = await resp.json(); } catch (_) {}
              throw new Error(errBody.message || errBody.detail || 'Rename error ' + resp.status);
            }
          } else {
            renameData = await ApiClient.post('/api/engine/rename-execute/', {
              folder_path: currentFolder,
              operation: this.pipeline.renameOperation,
              params: renameParams,
              skip_conflicts: true
            }, { signal: this._abortController.signal });
          }

          if (this.stopping) return currentFolder;

          if (renameData && renameData.renamed >= 0) {

            // Build result for display if this is the final step and no prior result
            if (!hadFaceCrop && !pipelineResult) {
              pipelineResult = {
                total: renameData.renamed + (renameData.skipped || 0) + (renameData.failed || 0),
                success: renameData.renamed,
                failed: renameData.failed || 0,
                output_folder: currentFolder,
                errors: renameData.errors || []
              };
            }
          }
        } catch (err) {
          console.warn('[Pipeline] Rename error:', err);
          if (typeof Toast !== 'undefined') Toast.error('Rename failed: ' + err.message);
        }
        this._hideProgress();
      }
      
      // If pipeline ran without faceCrop, show results
      if (!hadFaceCrop && pipelineResult) {
        this._showResult(pipelineResult);
      }
      
      return currentFolder;
    },

    // 
    //  RESULT DISPLAY + DONUT CHART
    // 
    _showResult(data) {
      var total   = data.total   || 0;
      var success = data.success || 0;
      var failed  = data.failed  || 0;

      // Prefer page-level counters for page picker responses to keep accuracy meaningful.
      if (data.pages_processed != null && data.pages_failed != null) {
        total = data.pages_processed || 0;
        failed = data.pages_failed || 0;
        success = Math.max(0, total - failed);
      }

      this.result.total    = total;
      this.result.success  = success;
      this.result.failed   = failed;
      this.result.accuracy = total > 0 ? ((success / total) * 100).toFixed(1) + '%' : ' - ';

      if (data.processing_time != null) {
        this.result.time = typeof data.processing_time === 'number'
          ? data.processing_time.toFixed(1) + 's'
          : String(data.processing_time);
      } else {
        this.result.time = ' - ';
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
     * Draw a simple donut chart  -  delegates to CropperDonut.
     */
    _drawDonutChart(success, failed) {
      window.CropperDonut.draw(this.$refs.chartCanvas, success, failed);
    },

    clearResults() {
      this.result.visible = false;
      this.preview.visible = false;
      // Unlock folder path and reset working folder so user can start fresh
      this.folderLocked = false;
      this.workingFolder = '';
      // Clear persisted state when user explicitly clears
      try { sessionStorage.removeItem('_cropperState'); } catch (_) {}
    },

    // 
    //  STATE PERSISTENCE  -  survive navigation away and back
    // 

    /**
     * Key to storage  -  unique for this page.
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
          this.result.accuracy = state.result.accuracy || ' - ';
          this.result.time = state.result.time || ' - ';
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
          // When engine is direct, stored Django proxy URLs won't work  - 
          // re-fetch previews from the engine after it connects.
          this._pendingPreviewReload = true;
        }
      } catch (err) {
        console.warn('[Cropper] State restore failed:', err);
        try { sessionStorage.removeItem(this._STORAGE_KEY); } catch (_) {}
      }
    },

    // 
    //  IMAGE PREVIEW  -  always available after processing
    // 

    /**
     * Build the image URL for a given filesystem path.
     *
     * When engine.direct is true the images live on the USER'S local
     * machine, not on the Django server.  In that case:
     *    On HTTP pages we can point <img src> straight at the engine.
     *    On HTTPS pages the browser blocks http://127.0.0.1 as mixed
     *     content for sub-resources, so we fetch()->blob->objectURL
     *     (fetch() has a localhost exemption; <img> does not).
     *
     * When using the Django proxy (engine.direct === false) the server
     * and engine share a filesystem, so the existing proxy URL works.
     */
    _imageUrl(fullPath) {
      if (this.engine.direct) {
        // HTTP -> direct engine URL is fine for <img>
        if (window.location.protocol === 'http:') {
          return this.engine.url + '/serve-image?path=' + encodeURIComponent(fullPath);
        }
        // HTTPS -> return empty; caller must use _loadBlobUrls()
        return '';
      }
      return '/api/engine/serve-image/?path=' + encodeURIComponent(fullPath);
    },

    /**
     * For HTTPS + direct engine: fetch each image via JS fetch() (which
     * has a localhost exemption) and convert to a blob object URL that
     * the browser will happily load in an <img> tag.
     * Processes up to 6 images concurrently to avoid flooding.
     */
    async _loadBlobUrls(images) {
      var self = this;
      var CONCURRENCY = 6;
      var idx = 0;

      async function next() {
        while (idx < images.length) {
          var i = idx++;
          var img = images[i];
          if (img.url) continue;  // already has a URL
          try {
            var resp = await fetch(
              self.engine.url + '/serve-image?path=' + encodeURIComponent(img.path)
            );
            if (resp.ok) {
              var blob = await resp.blob();
              img.url = URL.createObjectURL(blob);
            }
          } catch (_) {
            // Leave url empty  -  the card will show the grey placeholder
          }
        }
      }

      var workers = [];
      for (var w = 0; w < Math.min(CONCURRENCY, images.length); w++) {
        workers.push(next());
      }
      await Promise.all(workers);
    },

    /** True when HTTPS + direct engine -> need blob URLs */
    _needsBlobUrls() {
      return this.engine.direct && window.location.protocol === 'https:';
    },

    /** Revoke any blob object URLs to free memory */
    _revokeBlobUrls(images) {
      if (!images) return;
      for (var i = 0; i < images.length; i++) {
        if (images[i].url && images[i].url.startsWith('blob:')) {
          try { URL.revokeObjectURL(images[i].url); } catch (_) {}
        }
      }
    },

    async _loadPreview(folderPath) {
      // Revoke previous blob URLs before clearing
      this._revokeBlobUrls(this.preview.images);
      this._revokeBlobUrls(this.preview.editedImages);
      this._revokeBlobUrls(this.preview.failedImages);
      this._revokeBlobUrls(this.preview.deletedImages);

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
          if (!resp.ok) throw new Error('Engine preview error ' + resp.status);
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
            return {
              name: name,
              url: self._imageUrl(fullPath),
              path: fullPath,
            };
          });

          // HTTPS + direct engine: fetch blob URLs for every image
          if (this._needsBlobUrls()) {
            await this._loadBlobUrls(this.preview.images);
          }
        }
      } catch (err) {
        console.warn('[Cropper] Preview load failed:', err);
        // Preview is optional  -  don't block the flow
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

    // 
    //  TABS  -  switch between Cropped / Edited / Failed / Deleted
    // 
    switchTab(tab) {
      this.activeTab = tab;
      // Clear selection when switching tabs
      this.selection.selected = {};
      this.selection.count = 0;
      this.selection.all = false;
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
      // Sibling folders are: edited, failed, deleted  -  at the same level
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
          if (!resp.ok) throw new Error('Engine preview error ' + resp.status);
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
            return {
              name: name,
              url: self._imageUrl(fullPath),
              path: fullPath,
            };
          });

          // HTTPS + direct engine: fetch blob URLs
          if (this._needsBlobUrls()) {
            await this._loadBlobUrls(images);
          }

          if (tab === 'edited')  this.preview.editedImages  = images;
          if (tab === 'failed')  this.preview.failedImages   = images;
          if (tab === 'deleted') this.preview.deletedImages  = images;
        }
      } catch (err) {
        console.warn('[Cropper] Failed to load ' + tab + ' images:', err);
      }
    },

    // 
    //  EDITOR INTEGRATION  -  open AdarshEngine with image list nav
    // 
    openEditor(img, idx) {
      var self = this;
      var images = this.currentTabImages();

      window.AdarshEngine.open(img.url, img.name, function (dataUrl, name) {
        // Update the currently displayed image URL
        img.url = dataUrl;
      }, img.path);

      // Build image list for navigation inside the editor
      var engineList = images.map(function (i) {
        return { url: i.url, name: i.name, path: i.path || null };
      });
      window.AdarshEngine.setImageList(engineList, idx, function (url, name) {
        // When user navigates, update reference for future save callbacks
      });

      // Set up Apply to All callback
      window.AdarshEngine.setApplyToAllCallback(function (params) {
        self.applyParamsToAll(params);
      });
    },

    /**
     * Apply adjustment parameters to all images in the current tab.
     * Uses the engine's adjust-image API to apply parameters server-side.
     * @param {Object} params - {blackPoint, gamma, whitePoint, vibrance, temperature}
     */
    async applyParamsToAll(params) {
      var images = this.currentTabImages(); // Apply to current tab's images
      if (!images || images.length === 0) {
        showToast('No images to adjust. Process a folder first.', 'error');
        return;
      }

      var tabName = this.activeTab === 'cropped' ? 'cropped' : this.activeTab;
      var confirmed = await showConfirm({ title: 'Apply to All Images?', text: 'Apply these adjustments to all ' + images.length + ' ' + tabName + ' images? The editor will close and adjustments will be applied in batch.', icon: 'fa-solid fa-wand-magic-sparkles', confirmLabel: 'Apply', btnClass: 'btn-primary', hideWarning: true });
      if (!confirmed) return;

      // Close the engine modal so user can see progress
      window.AdarshEngine.close();

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

      var done    = 0;
      var total   = images.length;
      var success = 0;
      var editedFolder = '';

      for (var i = 0; i < total; i++) {
        var img = images[i];
        this.autoAdjustState.progress = done + ' / ' + total;

        try {
          var result = await this._applyParamsToSingle(img, params, csrfToken);
          if (result && result.url) {
            img.url = result.url + '&t=' + Date.now();
            success++;
            if (result.editedFolder) editedFolder = result.editedFolder;
          }
        } catch (err) {
          console.warn('[ApplyParams] Failed for ' + img.name + ':', err);
        }

        done++;
        this.autoAdjustState.progress = done + ' / ' + total;
      }

      this.autoAdjustState.running  = false;
      this.autoAdjustState.progress = '';

      // Update working folder to the edited output
      if (editedFolder) {
        this.workingFolder = editedFolder;
      }

      // Reload the edited tab so the newly saved images appear there
      this.preview.editedImages = [];
      this._loadTabImages('edited');

      if (typeof Toast !== 'undefined') {
        Toast.success('Applied adjustments to ' + success + ' images.');
      } else {
        showToast('Applied adjustments to ' + success + ' images.', 'success');
      }
    },

    /**
     * Apply parameters to a single image via the adjust-image API.
     */
    async _applyParamsToSingle(imgObj, params, csrfToken) {
      var resp = await fetch('/api/engine/adjust-image/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify({
          image_path: imgObj.path,
          original_path: imgObj.path,
          filename: imgObj.name,
          black_point: params.blackPoint || 0,
          gamma: params.gamma || 1.0,
          white_point: params.whitePoint || 255,
          vibrance: params.vibrance || 0,
          temperature: params.temperature || 0,
        }),
      });

      var data = await resp.json();
      if (!data.success) {
        throw new Error(data.message || 'Adjust failed');
      }

      // Return the URL and edited folder path
      var base = '/api/engine/serve-image/?path=' + encodeURIComponent(data.saved_path);
      return { url: base, editedFolder: data.edited_folder || '' };
    },

    // 
    //  AUTO-ADJUST ALL  -  batch auto-levels on every image in current tab
    // 
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
     * Auto-adjust a single image  -  delegates to CropperAutoAdjust.
     */
    _autoAdjustSingle(imgObj, csrfToken) {
      return window.CropperAutoAdjust.adjustSingle(imgObj, csrfToken);
    },

    // 
    //  DELETE  -  confirm + soft-delete (move to /deleted/ folder)
    // 
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

    // 
    //  ERROR HANDLING
    // 
    _handleProcessError(err) {
      var classified = window.CropperUtils.classifyProcessError(err);
      if (classified.title === 'Engine Not Reachable') {
        // Trigger a check  -  engine may have gone offline mid-process
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

    // 
    //  SELECTION METHODS  -  Select All / Individual Selection
    // 

    /**
     * Check if an image is selected.
     */
    isSelected(img) {
      return this.selection.selected[img.name] === true;
    },

    /**
     * Toggle selection of a single image.
     */
    toggleSelect(img) {
      if (this.selection.selected[img.name]) {
        delete this.selection.selected[img.name];
        this.selection.count--;
      } else {
        this.selection.selected[img.name] = true;
        this.selection.count++;
      }
      this._updateSelectAllState();
    },

    /**
     * Toggle select all / deselect all.
     */
    toggleSelectAll() {
      var images = this.currentTabImages();
      if (this.selection.all || this.selection.count === images.length) {
        // Deselect all
        this.selection.selected = {};
        this.selection.count = 0;
        this.selection.all = false;
      } else {
        // Select all
        this.selection.selected = {};
        for (var i = 0; i < images.length; i++) {
          this.selection.selected[images[i].name] = true;
        }
        this.selection.count = images.length;
        this.selection.all = true;
      }
    },

    /**
     * Update select all checkbox state based on individual selections.
     */
    _updateSelectAllState() {
      var images = this.currentTabImages();
      this.selection.all = this.selection.count > 0 && this.selection.count === images.length;
    },

    /**
     * Get count of selected files for display.
     */
    getSelectedFileCount() {
      if (this.selection.all) {
        return this.currentTabImages().length;
      }
      return this.selection.count || this.currentTabImages().length;
    },

    /**
     * Get list of selected file names.
     */
    getSelectedFiles() {
      var images = this.currentTabImages();
      if (this.selection.all || this.selection.count === 0) {
        // All selected or none selected = use all images
        return images.map(function(img) { return img.name; });
      }
      // Return only selected
      var self = this;
      return images
        .filter(function(img) { return self.selection.selected[img.name]; })
        .map(function(img) { return img.name; });
    },

    /**
     * Clear selection when switching tabs.
     * (Note: switchTab is defined above in TABS section)
     */

    // 
    //  RENAME METHODS  -  Batch rename with preview
    // 

    /**
     * Open the rename modal.
     */
    openRenameModal() {
      this.renameModal.visible = true;
      this.renameModal.loading = false;
      this.renameModal.preview = [];
      this.renameModal.previewStats = { total: 0, changed: 0, conflicts: 0 };
      this.updateRenameParams();
    },

    /**
     * Reset params when operation changes.
     */
    updateRenameParams() {
      this.renameModal.params = {
        prefix: '',
        suffix: '',
        old_text: '',
        new_text: '',
        text: '',
        base_name: '',
        start: 1,
        digits: 3,
      };
      this.renameModal.preview = [];
      this.renameModal.previewStats = { total: 0, changed: 0, conflicts: 0 };
    },

    /**
     * Get the folder path for the current tab.
     */
    _getCurrentTabFolder() {
      var basePath = this.preview.folder;
      if (!basePath) return '';

      if (this.activeTab === 'cropped') {
        return basePath;
      }

      // Go up one level from /cropped to parent, then into the tab subfolder
      var parts = basePath.replace(/[\\/]+$/, '').split(/[\\/]/);
      parts.pop();  // remove 'cropped'
      return parts.join('\\') + '\\' + this.activeTab;
    },

    /**
     * Preview the rename operation without executing.
     */
    async previewRename() {
      var folder = this._getCurrentTabFolder();
      if (!folder) {
        if (typeof Toast !== 'undefined') Toast.error('No folder available for renaming.');
        return;
      }

      this.renameModal.loading = true;
      this.renameModal.preview = [];

      try {
        var fileList = this.getSelectedFiles();
        var data = await ApiClient.post('/api/engine/rename-preview/', {
          folder_path: folder,
          operation: this.renameModal.operation,
          params: this.renameModal.params,
          file_list: fileList,
        });

        if (data.success) {
          this.renameModal.preview = data.files || [];
          this.renameModal.previewStats = {
            total: data.total || 0,
            changed: data.changed || 0,
            conflicts: data.conflicts || 0,
          };
        } else {
          if (typeof Toast !== 'undefined') Toast.error(data.message || 'Preview failed');
        }
      } catch (err) {
        console.error('[Rename] Preview error:', err);
        if (typeof Toast !== 'undefined') Toast.error('Failed to generate preview');
      } finally {
        this.renameModal.loading = false;
      }
    },

    /**
     * Execute the rename operation.
     */
    async executeRename() {
      var folder = this._getCurrentTabFolder();
      if (!folder) {
        if (typeof Toast !== 'undefined') Toast.error('No folder available for renaming.');
        return;
      }

      this.renameModal.loading = true;
      this.renameState.running = true;

      try {
        var fileList = this.getSelectedFiles();
        var data = await ApiClient.post('/api/engine/rename-execute/', {
          folder_path: folder,
          operation: this.renameModal.operation,
          params: this.renameModal.params,
          file_list: fileList,
          skip_conflicts: true,
        });

        if (data.success) {
          var msg = 'Renamed ' + data.renamed + ' files';
          if (data.skipped > 0) msg += ' (' + data.skipped + ' skipped)';
          if (typeof Toast !== 'undefined') Toast.success(msg);

          this.renameModal.visible = false;

          // Clear selection and reload preview
          this.selection.selected = {};
          this.selection.count = 0;
          this.selection.all = false;

          // Reload current tab images
          await this._loadPreview(this.preview.folder);
          await this._loadTabImages(this.activeTab);
        } else {
          if (typeof Toast !== 'undefined') Toast.error(data.message || 'Rename failed');
        }
      } catch (err) {
        console.error('[Rename] Execute error:', err);
        if (typeof Toast !== 'undefined') Toast.error('Failed to rename files');
      } finally {
        this.renameModal.loading = false;
        this.renameState.running = false;
      }
    },
  };
}
