(function (window) {
  'use strict';

  function toWsUrl(path) {
    var cleanPath = String(path || '/ws/panel/realtime/').trim();
    if (!cleanPath) {
      cleanPath = '/ws/panel/realtime/';
    }
    if (/^wss?:\/\//i.test(cleanPath)) {
      return cleanPath;
    }

    var loc = window.location;
    var scheme = loc.protocol === 'https:' ? 'wss://' : 'ws://';
    var normalizedPath = cleanPath.charAt(0) === '/' ? cleanPath : '/' + cleanPath;
    return scheme + loc.host + normalizedPath;
  }

  function uniqueTopics(topics) {
    var list = Array.isArray(topics) ? topics : [];
    var seen = Object.create(null);
    var out = [];
    list.forEach(function (topic) {
      var text = String(topic || '').trim().toLowerCase();
      if (!text || seen[text]) {
        return;
      }
      seen[text] = true;
      out.push(text);
    });
    return out;
  }

  function RealtimeService() {
    this.socket = null;
    this.wsPath = '/ws/panel/realtime/';
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.maxReconnectDelayMs = 300000; // 5 minutes max backoff
    this.explicitlyClosed = false;
    this.desiredTopics = [];
    this.messageListeners = [];
  }

  RealtimeService.prototype._emit = function (packet) {
    this.messageListeners.forEach(function (listener) {
      try {
        listener(packet || {});
      } catch (err) {
        window.console.error('Realtime listener error:', err);
      }
    });
  };

  RealtimeService.prototype.onMessage = function (listener) {
    if (typeof listener !== 'function') {
      return function () {};
    }
    this.messageListeners.push(listener);

    var self = this;
    return function () {
      self.messageListeners = self.messageListeners.filter(function (fn) {
        return fn !== listener;
      });
    };
  };

  RealtimeService.prototype._scheduleReconnect = function () {
    if (this.explicitlyClosed) {
      return;
    }
    if (this.reconnectTimer) {
      return;
    }

    var self = this;
    var delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempt), this.maxReconnectDelayMs);
    this.reconnectAttempt += 1;

    this.reconnectTimer = window.setTimeout(function () {
      self.reconnectTimer = null;
      self._open();
    }, delay);
  };

  RealtimeService.prototype._open = function () {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    var topics = uniqueTopics(this.desiredTopics);
    var url = toWsUrl(this.wsPath);
    if (topics.length) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + 'topics=' + encodeURIComponent(topics.join(','));
    }

    try {
      this.socket = new WebSocket(url);
    } catch (err) {
      this._emit({ type: 'realtime.state', status: 'error', error: String(err && err.message || err) });
      this._scheduleReconnect();
      return;
    }

    var self = this;

    this.socket.addEventListener('open', function () {
      self.reconnectAttempt = 0;
      self._emit({ type: 'realtime.state', status: 'connected' });
      if (self.desiredTopics.length) {
        self.send('realtime.subscribe', { topics: self.desiredTopics.slice() });
      }
    });

    this.socket.addEventListener('message', function (event) {
      var packet = null;
      try {
        packet = JSON.parse(event.data || '{}');
      } catch (err) {
        packet = { type: 'realtime.error', message: 'Invalid realtime payload.' };
      }
      self._emit(packet);
    });

    this.socket.addEventListener('close', function () {
      self._emit({ type: 'realtime.state', status: 'disconnected' });
      self.socket = null;
      self._scheduleReconnect();
    });

    this.socket.addEventListener('error', function () {
      self._emit({ type: 'realtime.state', status: 'error' });
    });
  };

  RealtimeService.prototype.connect = function (options) {
    options = options || {};
    this.wsPath = String(options.wsPath || this.wsPath || '/ws/panel/realtime/');
    this.desiredTopics = uniqueTopics(options.topics || this.desiredTopics || []);
    this.explicitlyClosed = false;
    this._open();
  };

  RealtimeService.prototype.close = function () {
    this.explicitlyClosed = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  };

  RealtimeService.prototype.isConnected = function () {
    return !!(this.socket && this.socket.readyState === WebSocket.OPEN);
  };

  RealtimeService.prototype.send = function (type, payload) {
    if (!this.isConnected()) {
      return false;
    }
    var packet = payload || {};
    packet.type = String(type || '').trim();
    if (!packet.type) {
      return false;
    }
    this.socket.send(JSON.stringify(packet));
    return true;
  };

  RealtimeService.prototype.subscribe = function (topics) {
    var incoming = uniqueTopics(topics);
    if (!incoming.length) {
      return;
    }

    var merged = uniqueTopics(this.desiredTopics.concat(incoming));
    this.desiredTopics = merged;

    if (this.isConnected()) {
      this.send('realtime.subscribe', { topics: incoming });
    }
  };

  RealtimeService.prototype.unsubscribe = function (topics) {
    var outgoing = uniqueTopics(topics);
    if (!outgoing.length) {
      return;
    }

    this.desiredTopics = this.desiredTopics.filter(function (topic) {
      return outgoing.indexOf(topic) === -1;
    });

    if (this.isConnected()) {
      this.send('realtime.unsubscribe', { topics: outgoing });
    }
  };

  window.AppRealtimeService = window.AppRealtimeService || new RealtimeService();
})(window);
