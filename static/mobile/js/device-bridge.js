(function initAdarshDeviceBridge(window) {
    var envGate = window.adarshMobileEnv || null;
    var cap = window.Capacitor || null;
    var plugins = cap && cap.Plugins ? cap.Plugins : {};

    var Camera = plugins.Camera || null;
    var App = plugins.App || null;
    var Filesystem = plugins.Filesystem || null;
    var PushNotifications = plugins.PushNotifications || null;

    var QUEUE_KEY = 'adarsh.mobile.critical.retry.queue.v1';
    var MAX_QUEUE_SIZE = 40;
    var flushInProgress = false;
    var runtimeUploadQueue = [];
    var runtimeUploadFlushInProgress = false;

    var UPLOAD_DB_NAME = 'adarsh.mobile.deferred.uploads.v1';
    var UPLOAD_STORE_NAME = 'uploads';
    var MAX_DEFERRED_UPLOADS = 80;
    var deferredUploadFlushInProgress = false;
    var uploadDbOpenPromise = null;

    function isNativeShell() {
        if (envGate && typeof envGate.isNativeShell === 'function') {
            return !!envGate.isNativeShell();
        }
        return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    }

    function isAndroidNativeShell() {
        if (!isNativeShell()) return false;
        var platform = '';
        if (envGate && typeof envGate.getPlatform === 'function') {
            platform = String(envGate.getPlatform() || '').toLowerCase();
        } else if (cap && typeof cap.getPlatform === 'function') {
            try {
                platform = String(cap.getPlatform() || '').toLowerCase();
            } catch (err) {
                platform = '';
            }
        }
        return platform === 'android';
    }

    function getCsrfToken() {
        var m = (document.cookie || '').match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return m && m[1] ? decodeURIComponent(m[1]) : '';
    }

    function isOnline() {
        return typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
    }

    function wait(ms) {
        return new Promise(function(resolve) {
            setTimeout(resolve, ms);
        });
    }

    function normalizeHeaders(headers) {
        var merged = {};
        if (headers && typeof headers === 'object') {
            Object.keys(headers).forEach(function(key) {
                merged[key] = headers[key];
            });
        }
        if (!merged['X-CSRFToken']) {
            merged['X-CSRFToken'] = getCsrfToken();
        }
        return merged;
    }

    function normalizePermissionStatus(rawStatus) {
        var status = String(rawStatus || '').toLowerCase();
        if (!status) return 'unknown';
        if (status === 'granted' || status === 'limited') return 'granted';
        if (status === 'prompt' || status === 'prompt-with-rationale' || status === 'prompt_with_rationale') return 'prompt';
        if (status === 'denied') return 'denied';
        return status;
    }

    function isGrantedStatus(status) {
        return normalizePermissionStatus(status) === 'granted';
    }

    function isUsableStatus(status) {
        var normalized = normalizePermissionStatus(status);
        return normalized === 'granted' || normalized === 'unknown' || normalized === 'unavailable';
    }

    function dispatchPermissionIssue(issue) {
        try {
            window.dispatchEvent(new CustomEvent('adarsh:native-permission-issue', { detail: issue || {} }));
        } catch (err) {}
    }

    async function openNativeSettings() {
        if (!App || typeof App.openSettings !== 'function') {
            return false;
        }
        try {
            await App.openSettings();
            return true;
        } catch (err) {
            return false;
        }
    }

    async function checkPermissionBundle() {
        var state = {
            native: isNativeShell(),
            android: isAndroidNativeShell(),
            camera: 'unavailable',
            photos: 'unavailable',
            storage: 'unavailable',
            notifications: 'unavailable',
        };

        if (!state.native) {
            return Object.assign(state, {
                cameraGranted: false,
                photosGranted: false,
                storageGranted: false,
                notificationsGranted: false,
            });
        }

        if (Camera && typeof Camera.checkPermissions === 'function') {
            try {
                var cameraPerms = await Camera.checkPermissions();
                state.camera = normalizePermissionStatus(cameraPerms && cameraPerms.camera);
                state.photos = normalizePermissionStatus(cameraPerms && cameraPerms.photos);
            } catch (err) {}
        }

        if (Filesystem && typeof Filesystem.checkPermissions === 'function') {
            try {
                var storagePerms = await Filesystem.checkPermissions();
                var storageRaw = storagePerms && (storagePerms.publicStorage || storagePerms.storage || storagePerms.photos);
                state.storage = normalizePermissionStatus(storageRaw);
            } catch (err) {}
        }

        if (PushNotifications && typeof PushNotifications.checkPermissions === 'function') {
            try {
                var notificationPerms = await PushNotifications.checkPermissions();
                state.notifications = normalizePermissionStatus(notificationPerms && notificationPerms.receive);
            } catch (err) {}
        }

        state.cameraGranted = isGrantedStatus(state.camera);
        state.photosGranted = isGrantedStatus(state.photos);
        state.storageGranted = isGrantedStatus(state.storage) || state.storage === 'unavailable';
        state.notificationsGranted = isGrantedStatus(state.notifications);
        return state;
    }

    async function requestPermissionBundle(options) {
        var opts = options || {};
        var wantsCamera = opts.requestCamera !== false;
        var wantsPhotos = opts.requestPhotos !== false;
        var wantsStorage = opts.requestStorage !== false;
        var wantsNotifications = opts.requestNotifications === true;

        if (Camera && typeof Camera.requestPermissions === 'function') {
            var requested = [];
            if (wantsCamera) requested.push('camera');
            if (wantsPhotos) requested.push('photos');
            if (requested.length) {
                try {
                    await Camera.requestPermissions({ permissions: requested });
                } catch (err) {}
            }
        }

        if (wantsStorage && Filesystem && typeof Filesystem.requestPermissions === 'function') {
            try {
                await Filesystem.requestPermissions();
            } catch (err) {}
        }

        if (wantsNotifications && PushNotifications && typeof PushNotifications.requestPermissions === 'function') {
            try {
                await PushNotifications.requestPermissions();
            } catch (err) {}
        }

        var state = await checkPermissionBundle();
        var mediaDenied = (wantsCamera && !isUsableStatus(state.camera)) || (wantsPhotos && !isUsableStatus(state.photos));
        var storageDenied = wantsStorage && !isUsableStatus(state.storage);
        var notificationsDenied = wantsNotifications && !isUsableStatus(state.notifications);

        if (mediaDenied || storageDenied || notificationsDenied) {
            var parts = [];
            if (mediaDenied) parts.push('camera/gallery');
            if (storageDenied) parts.push('storage');
            if (notificationsDenied) parts.push('notifications');
            dispatchPermissionIssue({
                type: 'permission-denied',
                parts: parts,
                state: state,
                message: 'Please allow ' + parts.join(', ') + ' permission in app settings.',
            });
        }

        return state;
    }

    function createUploadId() {
        return 'upl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    function isLikelyNetworkError(err) {
        var msg = String(err && err.message || '').toLowerCase();
        return msg.indexOf('network') !== -1
            || msg.indexOf('failed to fetch') !== -1
            || msg.indexOf('timed out') !== -1
            || msg.indexOf('load failed') !== -1;
    }

    function dispatchSyncState(state) {
        try {
            window.dispatchEvent(new CustomEvent('adarsh:deferred-sync-state', { detail: state || {} }));
        } catch (err) {}
    }

    function openUploadDb() {
        if (uploadDbOpenPromise) return uploadDbOpenPromise;
        uploadDbOpenPromise = new Promise(function(resolve) {
            if (!window.indexedDB) {
                resolve(null);
                return;
            }

            var req = null;
            try {
                req = window.indexedDB.open(UPLOAD_DB_NAME, 1);
            } catch (err) {
                resolve(null);
                return;
            }

            req.onupgradeneeded = function(event) {
                var db = event && event.target ? event.target.result : null;
                if (!db) return;
                if (!db.objectStoreNames.contains(UPLOAD_STORE_NAME)) {
                    var store = db.createObjectStore(UPLOAD_STORE_NAME, { keyPath: 'id' });
                    store.createIndex('next_attempt_at', 'next_attempt_at', { unique: false });
                    store.createIndex('created_at', 'created_at', { unique: false });
                }
            };

            req.onsuccess = function() {
                resolve(req.result || null);
            };
            req.onerror = function() {
                resolve(null);
            };
            req.onblocked = function() {
                resolve(null);
            };
        });
        return uploadDbOpenPromise;
    }

    function serializeFormData(formData) {
        var entries = [];
        if (!formData || typeof formData.forEach !== 'function') return entries;

        formData.forEach(function(value, key) {
            if (typeof File !== 'undefined' && value instanceof File) {
                entries.push({ name: key, kind: 'file', file: value });
                return;
            }
            if (typeof Blob !== 'undefined' && value instanceof Blob) {
                entries.push({
                    name: key,
                    kind: 'blob',
                    blob: value,
                    filename: 'upload_' + Date.now() + '.bin',
                });
                return;
            }
            entries.push({
                name: key,
                kind: 'text',
                value: value == null ? '' : String(value),
            });
        });

        return entries;
    }

    function rebuildFormData(entries) {
        var formData = new FormData();
        (entries || []).forEach(function(entry) {
            if (!entry || !entry.name) return;
            if (entry.kind === 'file' && entry.file) {
                var fileObj = entry.file;
                formData.append(entry.name, fileObj, fileObj.name || ('upload_' + Date.now()));
                return;
            }
            if (entry.kind === 'blob' && entry.blob) {
                formData.append(entry.name, entry.blob, entry.filename || ('upload_' + Date.now() + '.bin'));
                return;
            }
            formData.append(entry.name, entry.value == null ? '' : String(entry.value));
        });
        return formData;
    }

    async function getAllDeferredUploads() {
        var db = await openUploadDb();
        if (!db) return [];
        return new Promise(function(resolve) {
            var tx = db.transaction(UPLOAD_STORE_NAME, 'readonly');
            var store = tx.objectStore(UPLOAD_STORE_NAME);
            var req = store.getAll();
            req.onsuccess = function() {
                resolve(Array.isArray(req.result) ? req.result : []);
            };
            req.onerror = function() {
                resolve([]);
            };
        });
    }

    async function putDeferredUpload(record) {
        var db = await openUploadDb();
        if (!db) return false;
        return new Promise(function(resolve) {
            var tx = db.transaction(UPLOAD_STORE_NAME, 'readwrite');
            var store = tx.objectStore(UPLOAD_STORE_NAME);
            var req = store.put(record);
            req.onsuccess = function() {
                resolve(true);
            };
            req.onerror = function() {
                resolve(false);
            };
        });
    }

    async function deleteDeferredUpload(id) {
        var db = await openUploadDb();
        if (!db) return false;
        return new Promise(function(resolve) {
            var tx = db.transaction(UPLOAD_STORE_NAME, 'readwrite');
            var store = tx.objectStore(UPLOAD_STORE_NAME);
            var req = store.delete(id);
            req.onsuccess = function() { resolve(true); };
            req.onerror = function() { resolve(false); };
        });
    }

    async function trimDeferredUploads() {
        var all = await getAllDeferredUploads();
        if (all.length <= MAX_DEFERRED_UPLOADS) return;

        all.sort(function(a, b) {
            return Number(a && a.created_at || 0) - Number(b && b.created_at || 0);
        });

        var overflow = all.length - MAX_DEFERRED_UPLOADS;
        for (var i = 0; i < overflow; i++) {
            if (!all[i] || !all[i].id) continue;
            await deleteDeferredUpload(all[i].id);
        }
    }

    function isValidCriticalQueueItem(item) {
        return !!(item && typeof item === 'object' && String(item.url || '').trim());
    }

    function isValidDeferredUploadRecord(record) {
        return !!(
            record &&
            typeof record === 'object' &&
            String(record.id || '').trim() &&
            String(record.url || '').trim() &&
            Array.isArray(record.entries) &&
            record.entries.length
        );
    }

    function sanitizeCriticalQueue(queue) {
        if (!Array.isArray(queue) || !queue.length) return [];
        return queue.filter(isValidCriticalQueueItem);
    }

    async function getDeferredSyncState() {
        var deferredUploads = await getAllDeferredUploads();
        var criticalQueue = readCriticalQueue();
        var validDeferredUploads = deferredUploads.filter(isValidDeferredUploadRecord);
        var validRuntimeQueue = runtimeUploadQueue.filter(function(task) {
            return !!(task && typeof task.run === 'function');
        });

        return {
            criticalPending: criticalQueue.length,
            deferredUploadPending: validDeferredUploads.length,
            runtimeUploadPending: validRuntimeQueue.length,
            totalPending: criticalQueue.length + validDeferredUploads.length + validRuntimeQueue.length,
            online: isOnline(),
        };
    }

    function notifySyncState() {
        getDeferredSyncState().then(function(state) {
            dispatchSyncState(state);
        }).catch(function() {});
    }

    function readCriticalQueue() {
        try {
            var raw = localStorage.getItem(QUEUE_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];

            var sanitized = sanitizeCriticalQueue(parsed);
            if (sanitized.length !== parsed.length) {
                writeCriticalQueue(sanitized);
            }
            return sanitized;
        } catch (err) {
            return [];
        }
    }

    function writeCriticalQueue(queue) {
        try {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(queue || []));
        } catch (err) {}
    }

    function queueCriticalJson(item) {
        var queue = readCriticalQueue();
        var dedupeKey = String(item && item.dedupe_key || '').trim();

        if (dedupeKey) {
            queue = queue.filter(function(existing) {
                return String(existing && existing.dedupe_key || '').trim() !== dedupeKey;
            });
        }

        queue.push(item);
        if (queue.length > MAX_QUEUE_SIZE) {
            queue = queue.slice(queue.length - MAX_QUEUE_SIZE);
        }

        writeCriticalQueue(queue);
        notifySyncState();
        return queue.length;
    }

    async function postJson(url, payload, headers) {
        var response = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: Object.assign({
                'Content-Type': 'application/json',
            }, normalizeHeaders(headers)),
            body: JSON.stringify(payload || {}),
        });

        if (!response.ok) {
            throw new Error('Request failed: ' + response.status);
        }

        try {
            return await response.json();
        } catch (err) {
            return {};
        }
    }

    async function enqueueCriticalJson(url, payload, options) {
        var opts = options || {};
        var queueItem = {
            url: String(url || '').trim(),
            payload: payload || {},
            headers: normalizeHeaders(opts.headers || {}),
            dedupe_key: String(opts.dedupeKey || '').trim(),
            attempts: 0,
            created_at: Date.now(),
        };

        if (!queueItem.url) {
            throw new Error('Missing queue URL');
        }

        if (!isOnline()) {
            queueCriticalJson(queueItem);
            return { queued: true, offline: true };
        }

        try {
            var json = await postJson(queueItem.url, queueItem.payload, queueItem.headers);
            return { queued: false, data: json };
        } catch (err) {
            queueCriticalJson(queueItem);
            return { queued: true, offline: !isOnline(), error: err && err.message ? err.message : 'request_failed' };
        }
    }

    async function flushCriticalQueue() {
        if (flushInProgress) return { flushed: 0, remaining: readCriticalQueue().length };
        if (!isOnline()) return { flushed: 0, remaining: readCriticalQueue().length };

        var queue = readCriticalQueue();
        if (!queue.length) return { flushed: 0, remaining: 0 };

        flushInProgress = true;
        var remaining = [];
        var flushed = 0;

        for (var i = 0; i < queue.length; i++) {
            var item = queue[i];
            if (!item || !item.url) continue;

            try {
                await postJson(item.url, item.payload || {}, item.headers || {});
                flushed += 1;
            } catch (err) {
                var attempts = Number(item.attempts || 0) + 1;
                item.attempts = attempts;
                item.last_error = err && err.message ? err.message : 'request_failed';
                item.last_attempt_at = Date.now();
                remaining.push(item);

                if (!isOnline()) {
                    remaining = remaining.concat(queue.slice(i + 1));
                    break;
                }
            }
        }

        writeCriticalQueue(remaining);
        flushInProgress = false;
        notifySyncState();

        return { flushed: flushed, remaining: remaining.length };
    }

    function enqueueRuntimeUpload(task) {
        runtimeUploadQueue.push(task);
        if (runtimeUploadQueue.length > 20) {
            runtimeUploadQueue = runtimeUploadQueue.slice(runtimeUploadQueue.length - 20);
        }
        notifySyncState();
    }

    async function flushRuntimeUploadQueue() {
        if (runtimeUploadFlushInProgress) return;
        if (!isOnline()) return;
        if (!runtimeUploadQueue.length) return;

        runtimeUploadFlushInProgress = true;
        var stillPending = [];

        for (var i = 0; i < runtimeUploadQueue.length; i++) {
            var task = runtimeUploadQueue[i];
            if (!task || typeof task.run !== 'function') continue;
            try {
                await task.run();
            } catch (err) {
                stillPending.push(task);
                if (!isOnline()) {
                    stillPending = stillPending.concat(runtimeUploadQueue.slice(i + 1));
                    break;
                }
            }
        }

        runtimeUploadQueue = stillPending;
        runtimeUploadFlushInProgress = false;
        notifySyncState();
    }

    async function queueDeferredUpload(url, formDataFactory, options) {
        var opts = options || {};
        if (!isAndroidNativeShell()) {
            return { queued: false, reason: 'not_android_native' };
        }

        var formData = null;
        try {
            formData = formDataFactory();
        } catch (err) {
            return { queued: false, reason: 'form_build_failed' };
        }

        var entries = serializeFormData(formData);
        if (!entries.length) {
            return { queued: false, reason: 'empty_form_data' };
        }

        var now = Date.now();
        var delayMs = Number.isInteger(opts.deferDelayMs) ? Math.max(0, opts.deferDelayMs) : 1400;
        var fileCount = entries.filter(function(entry) {
            return entry && (entry.kind === 'file' || entry.kind === 'blob');
        }).length;

        var record = {
            id: createUploadId(),
            queue_key: String(opts.queueKey || '').trim(),
            url: String(url || '').trim(),
            headers: normalizeHeaders(opts.headers || {}),
            entries: entries,
            attempts: 0,
            created_at: now,
            updated_at: now,
            next_attempt_at: now + delayMs,
            last_error: '',
            file_count: fileCount,
        };

        if (!record.url) {
            return { queued: false, reason: 'missing_url' };
        }

        var stored = await putDeferredUpload(record);
        if (!stored) {
            return { queued: false, reason: 'storage_unavailable' };
        }

        await trimDeferredUploads();
        notifySyncState();

        return {
            queued: true,
            deferred: true,
            id: record.id,
            fileCount: fileCount,
        };
    }

    async function flushDeferredUploadQueue() {
        if (deferredUploadFlushInProgress) {
            var current = await getAllDeferredUploads();
            return { flushed: 0, remaining: current.length };
        }
        if (!isAndroidNativeShell() || !isOnline()) {
            var waiting = await getAllDeferredUploads();
            return { flushed: 0, remaining: waiting.length };
        }

        deferredUploadFlushInProgress = true;
        var flushed = 0;

        try {
            var all = await getAllDeferredUploads();
            if (!all.length) {
                return { flushed: 0, remaining: 0 };
            }

            all.sort(function(a, b) {
                var aNext = Number(a && a.next_attempt_at || 0);
                var bNext = Number(b && b.next_attempt_at || 0);
                if (aNext !== bNext) return aNext - bNext;
                return Number(a && a.created_at || 0) - Number(b && b.created_at || 0);
            });

            var now = Date.now();
            for (var i = 0; i < all.length; i++) {
                var task = all[i];
                if (!isValidDeferredUploadRecord(task)) {
                    if (task && task.id) {
                        await deleteDeferredUpload(task.id);
                    }
                    continue;
                }
                if (Number(task.next_attempt_at || 0) > now) continue;

                var formData = rebuildFormData(task.entries || []);
                try {
                    var response = await fetch(task.url, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: normalizeHeaders(task.headers || {}),
                        body: formData,
                    });

                    var text = await response.text();
                    var data = {};
                    try {
                        data = text ? JSON.parse(text) : {};
                    } catch (parseErr) {
                        data = {};
                    }

                    if (response.ok && data.success !== false) {
                        await deleteDeferredUpload(task.id);
                        flushed += 1;
                    } else {
                        task.attempts = Number(task.attempts || 0) + 1;
                        task.updated_at = Date.now();
                        task.last_error = (data && data.message) || ('Request failed: ' + response.status);
                        task.next_attempt_at = Date.now() + Math.min(120000, Math.pow(2, Math.min(task.attempts, 7)) * 1200);
                        await putDeferredUpload(task);
                    }
                } catch (err) {
                    task.attempts = Number(task.attempts || 0) + 1;
                    task.updated_at = Date.now();
                    task.last_error = err && err.message ? err.message : 'network_failed';
                    task.next_attempt_at = Date.now() + Math.min(120000, Math.pow(2, Math.min(task.attempts, 7)) * 1200);
                    await putDeferredUpload(task);

                    if (!isOnline()) {
                        break;
                    }
                }
            }

            var remaining = await getAllDeferredUploads();
            notifySyncState();
            return { flushed: flushed, remaining: remaining.length };
        } finally {
            deferredUploadFlushInProgress = false;
        }
    }

    async function uploadFormDataWithRetry(url, formDataFactory, options) {
        var opts = options || {};
        var retries = Number.isInteger(opts.retries) ? opts.retries : 1;
        var retryDelayMs = Number.isInteger(opts.retryDelayMs) ? opts.retryDelayMs : 700;
        var headers = normalizeHeaders(opts.headers || {});
        var shouldDeferWhenOffline = opts.deferIfOffline !== false && isAndroidNativeShell();

        function makeDeferredSuccessPayload(deferredInfo) {
            var fileCount = Number(deferredInfo && deferredInfo.fileCount || 0);
            return {
                success: true,
                queued: true,
                deferred: true,
                count: fileCount,
                failed: [],
                message: fileCount > 0
                    ? ('Saved ' + fileCount + ' file(s) locally. Sync will continue in background.')
                    : 'Saved locally. Sync will continue in background.',
            };
        }

        async function executeOnce() {
            var formData = formDataFactory();
            var response = await fetch(url, {
                method: 'POST',
                credentials: 'same-origin',
                headers: headers,
                body: formData,
            });

            var text = await response.text();
            var data = {};
            try {
                data = text ? JSON.parse(text) : {};
            } catch (err) {
                data = {};
            }

            if (!response.ok || data.success === false) {
                var errorMessage = (data && data.message)
                    || ('Request failed: ' + response.status);
                var serverErr = new Error(errorMessage);
                serverErr.isServerRejected = true;
                serverErr.responseStatus = response.status;
                throw serverErr;
            }

            return { response: response, data: data, queued: false };
        }

        if (!isOnline()) {
            if (shouldDeferWhenOffline) {
                var queuedOffline = await queueDeferredUpload(url, formDataFactory, {
                    headers: headers,
                    queueKey: String(opts.queueKey || ''),
                    deferDelayMs: opts.deferDelayMs,
                });
                if (queuedOffline && queuedOffline.queued) {
                    return {
                        queued: true,
                        deferred: true,
                        data: makeDeferredSuccessPayload(queuedOffline),
                    };
                }
            }
            enqueueRuntimeUpload({ run: executeOnce, key: String(opts.queueKey || '') });
            throw new Error('No internet connection. Upload will retry while app stays open.');
        }

        var attempt = 0;
        while (attempt <= retries) {
            try {
                return await executeOnce();
            } catch (err) {
                if (attempt >= retries) {
                    if (shouldDeferWhenOffline && !err.isServerRejected && (!isOnline() || isLikelyNetworkError(err))) {
                        var queuedRetry = await queueDeferredUpload(url, formDataFactory, {
                            headers: headers,
                            queueKey: String(opts.queueKey || ''),
                            deferDelayMs: opts.deferDelayMs,
                        });
                        if (queuedRetry && queuedRetry.queued) {
                            return {
                                queued: true,
                                deferred: true,
                                data: makeDeferredSuccessPayload(queuedRetry),
                            };
                        }
                    }
                    if (!isOnline()) {
                        enqueueRuntimeUpload({ run: executeOnce, key: String(opts.queueKey || '') });
                        throw new Error('Upload queued. It will retry when connection returns.');
                    }
                    throw err;
                }
            }
            attempt += 1;
            await wait(retryDelayMs);
        }

        throw new Error('Upload failed');
    }

    function dataUrlToFile(dataUrl, fileName) {
        if (!dataUrl || typeof dataUrl !== 'string') return null;
        var parts = dataUrl.split(',');
        if (parts.length < 2) return null;

        var mimeMatch = parts[0].match(/data:([^;]+);base64/);
        var mime = mimeMatch && mimeMatch[1] ? mimeMatch[1] : 'image/jpeg';
        var binary = atob(parts[1]);
        var len = binary.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        var ext = mime.indexOf('png') !== -1 ? 'png' : 'jpg';
        var name = fileName || ('capture_' + Date.now() + '.' + ext);
        return new File([bytes], name, { type: mime });
    }

    async function pickImage(options) {
        var opts = options || {};
        if (!isNativeShell()) {
            return null;
        }
        if (!Camera || typeof Camera.getPhoto !== 'function') {
            dispatchPermissionIssue({
                type: 'camera-plugin-missing',
                message: 'Camera module is unavailable in this app build. Please update the Android app.',
            });
            return null;
        }

        var sourceMode = String(opts.source || 'gallery').toLowerCase();
        var quality = Number.isInteger(opts.quality) ? opts.quality : 90;
        var timeoutMs = Number.isInteger(opts.timeoutMs) ? opts.timeoutMs : 15000;

        var sourceValue = sourceMode === 'camera'
            ? (cap && cap.CameraSource && cap.CameraSource.Camera ? cap.CameraSource.Camera : 'CAMERA')
            : (cap && cap.CameraSource && cap.CameraSource.Photos ? cap.CameraSource.Photos : 'PHOTOS');

        // Prefer URI results to avoid large base64 payloads freezing WebView.
        var resultType = cap && cap.CameraResultType && cap.CameraResultType.Uri
            ? cap.CameraResultType.Uri
            : 'URI';

        try {
            var permissionState = await requestPermissionBundle({
                requestCamera: sourceMode === 'camera',
                requestPhotos: sourceMode !== 'camera',
                requestStorage: false,
                requestNotifications: false,
            });

            if (sourceMode === 'camera' && !isUsableStatus(permissionState.camera)) {
                throw new Error('Camera permission is required. Enable it from app settings and try again.');
            }
            if (sourceMode !== 'camera' && !isUsableStatus(permissionState.photos)) {
                throw new Error('Gallery permission is required. Enable Photos/Storage from app settings and try again.');
            }

            var timeoutPromise = new Promise(function(resolve) {
                setTimeout(function() {
                    resolve({ __pickerTimeout: true });
                }, timeoutMs);
            });

            var photo = await Promise.race([
                Camera.getPhoto({
                    resultType: resultType,
                    source: sourceValue,
                    allowEditing: false,
                    correctOrientation: true,
                }),
                timeoutPromise,
            ]);

            if (photo && photo.__pickerTimeout) {
                throw new Error('Camera/Gallery timed out. Please try again.');
            }

            if (photo && photo.webPath) {
                var fetched = await fetch(photo.webPath);
                var blob = await fetched.blob();
                return new File([blob], 'capture_' + Date.now() + '.jpg', { type: blob.type || 'image/jpeg' });
            }

            if (photo && photo.dataUrl) {
                return dataUrlToFile(photo.dataUrl);
            }
        } catch (err) {
            var rawMessage = String(err && err.message || '').toLowerCase();
            if (rawMessage.indexOf('cancel') !== -1) {
                return null;
            }
            if (err && err.message) {
                dispatchPermissionIssue({ type: 'picker-error', message: err.message });
                throw err;
            }
            return null;
        }

        return null;
    }

    function setupFlushHooks() {
        window.addEventListener('online', function() {
            flushCriticalQueue();
            flushRuntimeUploadQueue();
            flushDeferredUploadQueue();
        });

        setInterval(function() {
            flushCriticalQueue();
            flushRuntimeUploadQueue();
            flushDeferredUploadQueue();
        }, 30000);

        if (App && typeof App.addListener === 'function') {
            App.addListener('appStateChange', function(state) {
                if (state && state.isActive) {
                    flushCriticalQueue();
                    flushRuntimeUploadQueue();
                    flushDeferredUploadQueue();
                }
            });
        }

        notifySyncState();
    }

    window.adarshDeviceBridge = {
        isNativeShell: isNativeShell,
        checkPermissionBundle: checkPermissionBundle,
        requestPermissionBundle: requestPermissionBundle,
        openNativeSettings: openNativeSettings,
        pickImage: pickImage,
        enqueueCriticalJson: enqueueCriticalJson,
        flushCriticalQueue: flushCriticalQueue,
        uploadFormDataWithRetry: uploadFormDataWithRetry,
        flushDeferredUploadQueue: flushDeferredUploadQueue,
        getDeferredSyncState: getDeferredSyncState,
    };

    setupFlushHooks();
})(window);
