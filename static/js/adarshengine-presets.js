/**
 * Adarsh Engine Presets Manager
 * 
 * Manages saving, loading, and deleting adjustment presets in localStorage.
 * Integrates with the AdarshEngine modal to provide preset functionality.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'adarsh_engine_presets';

  /**
   * AdarshEnginePresets — static manager for adjustment presets.
   */
  var AdarshEnginePresets = {
    /**
     * Get all saved presets from localStorage.
     * @returns {Array} Array of preset objects
     */
    getAll: function () {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        console.error('Failed to load presets:', e);
        return [];
      }
    },

    /**
     * Save presets array to localStorage.
     * @param {Array} presets - Array of preset objects
     */
    saveAll: function (presets) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
      } catch (e) {
        console.error('Failed to save presets:', e);
      }
    },

    /**
     * Add a new preset.
     * @param {string} name - Preset name
     * @param {Object} params - Adjustment parameters
     * @returns {Object} The created preset
     */
    add: function (name, params) {
      var presets = this.getAll();
      var preset = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        name: name.trim(),
        params: {
          blackPoint: params.blackPoint || 0,
          gamma: params.gamma || 1.0,
          whitePoint: params.whitePoint || 255,
          vibrance: params.vibrance || 0,
          temperature: params.temperature || 0,
        },
        createdAt: new Date().toISOString(),
      };
      presets.push(preset);
      this.saveAll(presets);
      return preset;
    },

    /**
     * Get a preset by ID.
     * @param {string} id - Preset ID
     * @returns {Object|null} Preset object or null
     */
    get: function (id) {
      var presets = this.getAll();
      for (var i = 0; i < presets.length; i++) {
        if (presets[i].id === id) return presets[i];
      }
      return null;
    },

    /**
     * Delete a preset by ID.
     * @param {string} id - Preset ID
     * @returns {boolean} True if deleted
     */
    delete: function (id) {
      var presets = this.getAll();
      var newPresets = presets.filter(function (p) { return p.id !== id; });
      if (newPresets.length !== presets.length) {
        this.saveAll(newPresets);
        return true;
      }
      return false;
    },

    /**
     * Update an existing preset.
     * @param {string} id - Preset ID
     * @param {Object} params - New parameters
     * @returns {boolean} True if updated
     */
    update: function (id, params) {
      var presets = this.getAll();
      for (var i = 0; i < presets.length; i++) {
        if (presets[i].id === id) {
          presets[i].params = {
            blackPoint: params.blackPoint || 0,
            gamma: params.gamma || 1.0,
            whitePoint: params.whitePoint || 255,
            vibrance: params.vibrance || 0,
            temperature: params.temperature || 0,
          };
          presets[i].updatedAt = new Date().toISOString();
          this.saveAll(presets);
          return true;
        }
      }
      return false;
    },

    /**
     * Check if a preset name already exists.
     * @param {string} name - Preset name
     * @returns {boolean}
     */
    nameExists: function (name) {
      var presets = this.getAll();
      var trimmed = name.trim().toLowerCase();
      return presets.some(function (p) {
        return p.name.toLowerCase() === trimmed;
      });
    },
  };

  // Export to global scope
  global.AdarshEnginePresets = AdarshEnginePresets;
})(window);
