/**
 * Adarsh Engine Integration - Image Edit Persistence
 * ===================================================
 * 
 * Integrates with the Adarsh Engine image editor to:
 * 1. Save edited images to the server (in /media/edited_images/)
 * 2. Download edited images as a bulk ZIP file
 * 
 * Usage:
 *   AdarshEngineIntegration.saveEditedImage(editId, imageDataUri, filters)
 *   AdarshEngineIntegration.downloadSelectedEdits(editIds)
 */

window.AdarshEngineIntegration = window.AdarshEngineIntegration || (function() {
  'use strict';
  
  // Get CSRF token from page
  function getCsrfToken() {
    const token = document.querySelector('[name="csrfmiddlewaretoken"]')?.value || '';
    return token || getCsrfFromCookie();
  }
  
  function getCsrfFromCookie() {
    const name = 'csrftoken';
    let cookieValue = '';
    if (document.cookie && document.cookie !== '') {
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.substring(0, name.length + 1) === (name + '=')) {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  }
  
  /**
   * Convert data URI to base64
   */
  function dataUriToBase64(dataUri) {
    if (!dataUri) return '';
    if (dataUri.indexOf('base64,') === -1) return '';
    return dataUri.split('base64,')[1];
  }
  
  /**
   * Show toast notification
   */
  function showToast(message, isSuccess) {
    if (typeof showToast !== 'undefined') {
      // Use global showToast if available
      window.showToast && window.showToast(message, isSuccess);
    } else {
      console.log((isSuccess ? '✓' : '✗') + ' ' + message);
    }
  }
  
  return {
    /**
     * Save a single edited image to the server
     */
    saveEditedImage: function(editId, imageDataUri, filters) {
      return new Promise(function(resolve, reject) {
        try {
          const imageBase64 = dataUriToBase64(imageDataUri);
          if (!imageBase64) {
            reject(new Error('Invalid image data format'));
            return;
          }
          
          const formData = new FormData();
          formData.append('edit_id', editId);
          formData.append('image_data', imageBase64);
          formData.append('filters', JSON.stringify(filters || {}));
          
          // Add CSRF token
          const csrfToken = getCsrfToken();
          if (csrfToken) {
            formData.append('csrfmiddlewaretoken', csrfToken);
          }
          
          fetch('/api/image-editor/save/', {
            method: 'POST',
            body: formData,
            headers: {
              'X-CSRFToken': csrfToken
            }
          })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              console.log(`✓ Saved: ${data.filename}`);
              resolve(data);
            } else {
              console.error('Save failed:', data.message);
              reject(new Error(data.message || 'Save failed'));
            }
          })
          .catch(err => {
            console.error('Save error:', err);
            reject(err);
          });
        } catch (err) {
          reject(err);
        }
      });
    },
    
    /**
     * Save multiple edited images in parallel
     */
    saveEditedImages: function(editsMap) {
      /**
       * editsMap structure:
       * {
       *   "edit_0": { imageDataUri: "data:image/png;base64,...", filters: {...} },
       *   "edit_1": { imageDataUri: "data:image/png;base64,...", filters: {...} }
       * }
       */
      const promises = [];
      
      for (const editId in editsMap) {
        if (editsMap.hasOwnProperty(editId)) {
          const edit = editsMap[editId];
          promises.push(
            this.saveEditedImage(editId, edit.imageDataUri, edit.filters)
              .catch(err => {
                console.warn(`Failed to save ${editId}:`, err.message);
                return { success: false, edit_id: editId, error: err.message };
              })
          );
        }
      }
      
      return Promise.all(promises);
    },
    
    /**
     * Download edited images as ZIP
     */
    downloadEditedImages: function(editIds) {
      try {
        const formData = new FormData();
        
        // Add each edit ID to form data
        editIds.forEach(editId => {
          formData.append('edit_ids', editId);
        });
        
        const csrfToken = getCsrfToken();
        if (csrfToken) {
          formData.append('csrfmiddlewaretoken', csrfToken);
        }
        
        fetch('/api/image-editor/download/', {
          method: 'POST',
          body: formData,
          headers: {
            'X-CSRFToken': csrfToken
          }
        })
        .then(res => {
          if (!res.ok) {
            return res.json().then(data => {
              throw new Error(data.message || 'Download failed');
            });
          }
          return res.blob();
        })
        .then(blob => {
          // Create download link
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `edited_images_${new Date().toISOString().slice(0,10)}.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          
          showToast('✓ Download started', true);
          console.log('✓ Bulk download started');
        })
        .catch(err => {
          console.error('Download error:', err);
          showToast(`✗ Download failed: ${err.message}`, false);
        });
      } catch (err) {
        console.error('Download preparation error:', err);
        showToast('✗ Download error', false);
      }
    },
    
    /**
     * Auto-fix and save all images in a batch, then download
     */
    autoFixAndDownload: function(imageElements, filters) {
      /**
       * imageElements: Array of image DOM elements or { id, src, ...}
       * filters: { brightness, contrast, saturation, ... }
       */
      return new Promise(function(resolve, reject) {
        const editsMap = {};
        
        // Prepare all edits
        imageElements.forEach((img, idx) => {
          const editId = `edit_${idx}`;
          const src = img.src || img.imageDataUri || '';
          
          editsMap[editId] = {
            imageDataUri: src,
            filters: filters || {}
          };
        });
        
        // Save all edits
        window.AdarshEngineIntegration.saveEditedImages(editsMap)
          .then(results => {
            const editIds = results
              .filter(r => r.success)
              .map(r => r.edit_id);
            
            if (editIds.length > 0) {
              showToast(`✓ ${editIds.length} images saved`, true);
              console.log('✓ All images saved, starting download...');
              
              // Start download
              window.AdarshEngineIntegration.downloadEditedImages(editIds);
              resolve({ success: true, saved: editIds.length });
            } else {
              reject(new Error('No images were saved successfully'));
            }
          })
          .catch(err => {
            console.error('Batch operation failed:', err);
            reject(err);
          });
      });
    },
    
    /**
     * Get list of all saved edit IDs from the server
     */
    getAvailableEditIds: function() {
      // This would require a backend endpoint to list available edits
      // Placeholder for now
      return fetch('/api/image-editor/list/', { method: 'GET' })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            return data.edit_ids || [];
          }
          return [];
        })
        .catch(err => {
          console.warn('Could not fetch available edit IDs:', err);
          return [];
        });
    },
  };
})();
