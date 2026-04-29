(function (window, document) {
  'use strict';

  var OfficeWork = {
    state: {
      activeTab: 'tasks',
      realtimeListenerAdded: false,
    },

    ui: {
      tabButtons: Array.prototype.slice.call(document.querySelectorAll('.office-tab-btn')),
      panels: Array.prototype.slice.call(document.querySelectorAll('.office-panel')),
    },

    init: function () {
      this.bindEvents();
      this.initRealtime();
      this.setActiveTab('tasks');
    },

    notify: function (message, type) {
      if (typeof window.showToast === 'function') {
        window.showToast(message, type || 'info');
      } else {
        window.console.log(type + ': ' + message);
      }
    },

    setActiveTab: function (tabName) {
      this.state.activeTab = tabName;
      this.ui.tabButtons.forEach(btn => {
        var isActive = btn.getAttribute('data-tab') === tabName;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive);
      });
      this.ui.panels.forEach(panel => {
        var isActive = panel.getAttribute('data-panel') === tabName;
        panel.classList.toggle('is-active', isActive);
        panel.hidden = !isActive;
      });

      if (tabName === 'tasks' && window.OfficeTasks) {
        window.OfficeTasks.init();
      } else if (tabName === 'leads' && window.OfficeLeads) {
        if (!window.OfficeLeads.state.loaded) window.OfficeLeads.load();
      }
    },

    initRealtime: function () {
      var cfg = window.OfficeWorkConfig || {};
      if (!window.AppRealtimeService || this.state.realtimeListenerAdded) return;
      this.state.realtimeListenerAdded = true;

      window.AppRealtimeService.onMessage(function (p) {
        if (p.type === 'realtime.event') {
          if (p.event.indexOf('officework.task') === 0 && window.OfficeTasks) {
            window.OfficeTasks.handleRealtime(p);
          }
        }
      });

      window.AppRealtimeService.connect({
        wsPath: cfg.realtime.wsPath,
        topics: ['officework.tasks']
      });
    },

    bindEvents: function () {
      var self = this;
      this.ui.tabButtons.forEach(btn => {
        btn.addEventListener('click', function () {
          self.setActiveTab(btn.dataset.tab);
        });
      });
    }
  };

  window.OfficeWork = OfficeWork;

  // Bootstrapping
  function start() {
    if (window.ApiClient && window.OfficeTasks && window.OfficeLeads) {
      window.OfficeWork.init();
    } else {
      setTimeout(start, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})(window, document);
