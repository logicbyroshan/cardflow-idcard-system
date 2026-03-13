/**
 * Adarsh Cropper  Utility Helpers
 * 
 * Pure utility functions used by cropperApp().
 * Must be loaded BEFORE adarsh-cropper.js.
 *
 * @module adarsh-cropper-utils
 */

window.CropperUtils = {

  /**
   * Compare two semver strings (e.g. "3.0.1" vs "3.0.0").
   * Returns: >0 if a > b, <0 if a < b, 0 if equal.
   */
  semverCompare: function (a, b) {
    var pa = (a || '0.0.0').split('.').map(Number);
    var pb = (b || '0.0.0').split('.').map(Number);
    for (var i = 0; i < 3; i++) {
      var va = pa[i] || 0;
      var vb = pb[i] || 0;
      if (va !== vb) return va - vb;
    }
    return 0;
  },

  /**
   * Format an uptime value in seconds into a human-readable string.
   * Returns '' if secs <= 0.
   */
  formatUptime: function (secs) {
    if (secs >= 3600) {
      return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
    } else if (secs > 0) {
      return Math.floor(secs / 60) + 'm ' + Math.floor(secs % 60) + 's';
    }
    return '';
  },

  /**
   * Classify a process-folder error into a user-friendly { title, message }.
   * Does NOT modify any component state.
   */
  classifyProcessError: function (err) {
    var title   = 'Processing Error';
    var message = (err && err.message) || 'An unknown error occurred.';

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

    return { title: title, message: message };
  },

  /**
   * Classify a compress-folder error into a user-friendly { title, message }.
   * Does NOT modify any component state.
   */
  classifyCompressError: function (err) {
    var title   = 'Compression Error';
    var message = (err && err.message) || 'An unknown error occurred.';

    if (err && err.data && err.data.message) {
      message = err.data.message;
    }

    if (message.indexOf('not reachable') !== -1 || message.indexOf('Cannot connect') !== -1) {
      title = 'Engine Not Reachable';
    } else if (message.indexOf('No images found') !== -1) {
      title = 'No Images Found';
      message = 'The specified folder does not contain any supported image files.';
    } else if (message.indexOf('not exist') !== -1 || message.indexOf('not found') !== -1) {
      title = 'Path Not Found';
      message = 'The specified folder path does not exist on this machine.';
    } else if (message.indexOf('timed out') !== -1 || message.indexOf('timeout') !== -1) {
      title = 'Timeout';
    }

    return { title: title, message: message };
  },
};
