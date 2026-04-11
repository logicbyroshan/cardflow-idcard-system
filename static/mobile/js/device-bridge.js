(function initAdarshDeviceBridge(window) {
    var envGate = window.adarshMobileEnv || null;
    var cap = window.Capacitor || null;
    var plugins = cap && cap.Plugins ? cap.Plugins : {};

    var Camera = plugins.Camera || null;
    var App = plugins.App || null;

    var QUEUE_KEY = 'adarsh.mobile.critical.retry.queue.v1';
    var MAX_QUEUE_SIZE = 40;
    var flushInProgress = false;
    var runtimeUploadQueue = [];
    var runtimeUploadFlushInProgress = false;

    function isNativeShell() {
        if (envGate && typeof envGate.isNativeShell === 'function') {
            return !!envGate.isNativeShell();
        }
        return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
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

    function readCriticalQueue() {
        try {
            var raw = localStorage.getItem(QUEUE_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
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

        return { flushed: flushed, remaining: remaining.length };
    }

    function enqueueRuntimeUpload(task) {
        runtimeUploadQueue.push(task);
        if (runtimeUploadQueue.length > 20) {
            runtimeUploadQueue = runtimeUploadQueue.slice(runtimeUploadQueue.length - 20);
        }
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
    }

    async function uploadFormDataWithRetry(url, formDataFactory, options) {
        var opts = options || {};
        var retries = Number.isInteger(opts.retries) ? opts.retries : 1;
        var retryDelayMs = Number.isInteger(opts.retryDelayMs) ? opts.retryDelayMs : 700;
        var headers = normalizeHeaders(opts.headers || {});

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
                throw new Error(errorMessage);
            }

            return { response: response, data: data, queued: false };
        }

        if (!isOnline()) {
            enqueueRuntimeUpload({ run: executeOnce, key: String(opts.queueKey || '') });
            throw new Error('No internet connection. Upload will retry while app stays open.');
        }

        var attempt = 0;
        while (attempt <= retries) {
            try {
                return await executeOnce();
            } catch (err) {
                if (attempt >= retries) {
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
        if (!isNativeShell() || !Camera || typeof Camera.getPhoto !== 'function') {
            return null;
        }

        var sourceMode = String(opts.source || 'gallery').toLowerCase();
        var quality = Number.isInteger(opts.quality) ? opts.quality : 90;

        var sourceValue = sourceMode === 'camera'
            ? (cap && cap.CameraSource && cap.CameraSource.Camera ? cap.CameraSource.Camera : 'CAMERA')
            : (cap && cap.CameraSource && cap.CameraSource.Photos ? cap.CameraSource.Photos : 'PHOTOS');

        var resultType = cap && cap.CameraResultType && cap.CameraResultType.DataUrl
            ? cap.CameraResultType.DataUrl
            : 'DATAURL';

        try {
            var photo = await Camera.getPhoto({
                quality: quality,
                resultType: resultType,
                source: sourceValue,
                allowEditing: false,
                correctOrientation: true,
            });

            if (photo && photo.dataUrl) {
                return dataUrlToFile(photo.dataUrl);
            }

            if (photo && photo.webPath) {
                var fetched = await fetch(photo.webPath);
                var blob = await fetched.blob();
                return new File([blob], 'capture_' + Date.now() + '.jpg', { type: blob.type || 'image/jpeg' });
            }
        } catch (err) {
            return null;
        }

        return null;
    }

    function setupFlushHooks() {
        window.addEventListener('online', function() {
            flushCriticalQueue();
            flushRuntimeUploadQueue();
        });

        setInterval(function() {
            flushCriticalQueue();
            flushRuntimeUploadQueue();
        }, 30000);

        if (App && typeof App.addListener === 'function') {
            App.addListener('appStateChange', function(state) {
                if (state && state.isActive) {
                    flushCriticalQueue();
                    flushRuntimeUploadQueue();
                }
            });
        }
    }

    window.adarshDeviceBridge = {
        isNativeShell: isNativeShell,
        pickImage: pickImage,
        enqueueCriticalJson: enqueueCriticalJson,
        flushCriticalQueue: flushCriticalQueue,
        uploadFormDataWithRetry: uploadFormDataWithRetry,
    };

    setupFlushHooks();
})(window);
