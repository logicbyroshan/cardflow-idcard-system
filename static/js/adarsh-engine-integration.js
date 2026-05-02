/**
 * Adarsh Engine Integration - Image Edit Persistence
 * ===================================================
 * 
 * Integrates with the Adarsh Engine image editor to:
 * 1. Save edited images to the server (in /media/edited_images/)
 * 2. Download edited images as a bulk ZIP file
 * 3. Auto-detect dark images and apply adaptive brightness/contrast
 * 
 * Usage:
 *   AdarshEngineIntegration.saveEditedImage(editId, imageDataUri, filters)
 *   AdarshEngineIntegration.downloadSelectedEdits(editIds)
 *   AdarshEngineIntegration.autoFixAndDownload(images, filters)
 */

window.AdarshEngineIntegration = window.AdarshEngineIntegration || (function() {
  'use strict';
  
  /**
   * Analyze image brightness and return optimal filter values
   */
  function getAdaptiveFilters(imageElement) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      canvas.width = imageElement.width || imageElement.naturalWidth || 200;
      canvas.height = imageElement.height || imageElement.naturalHeight || 200;
      
      ctx.drawImage(imageElement, 0, 0);
      
      // Get pixel data from center region (ignore borders)
      const imageData = ctx.getImageData(
        canvas.width * 0.25,
        canvas.height * 0.25,
        canvas.width * 0.5,
        canvas.height * 0.5
      );
      
      const data = imageData.data;
      let totalBrightness = 0;
      let pixelCount = 0;
      
      // Calculate average brightness (Y = 0.299*R + 0.587*G + 0.114*B)
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const brightness = (0.299 * r + 0.587 * g + 0.114 * b);
        totalBrightness += brightness;
        pixelCount++;
      }
      
      const avgBrightness = totalBrightness / pixelCount;
      
      // Return adaptive filters based on brightness
      let brightness = 1.0;
      let contrast = 1.0;
      let saturation = 1.0;
      
      if (avgBrightness < 80) {
        // Very dark image
        brightness = 1.6;
        contrast = 1.4;
        saturation = 1.3;
      } else if (avgBrightness < 120) {
        // Dark image
        brightness = 1.4;
        contrast = 1.3;
        saturation = 1.2;
      } else if (avgBrightness < 160) {
        // Slightly dark
        brightness = 1.2;
        contrast = 1.1;
        saturation = 1.1;
      } else {
        // Normal to bright image - light touch
        brightness = 1.05;
        contrast = 1.05;
        saturation = 1.0;
      }
      
      return {
        brightness: brightness,
        contrast: contrast,
        saturation: saturation,
        detectedBrightness: avgBrightness
      };
    } catch (err) {
      console.warn('Brightness detection failed, using default filters:', err);
      return {
        brightness: 1.1,
        contrast: 1.1,
        saturation: 1.0,
        detectedBrightness: 128
      };
    }
  }
  
  /**
   * Apply filters to canvas and return edited base64 image
   */
  function applyFiltersToCanvas(imageElement, filters) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = imageElement.width || imageElement.naturalWidth || 200;
      canvas.height = imageElement.height || imageElement.naturalHeight || 200;
      
      // Apply filters via CSS filter to canvas context
      const filterString = `brightness(${filters.brightness}) contrast(${filters.contrast}) saturate(${filters.saturation})`;
      ctx.filter = filterString;
      
      ctx.drawImage(imageElement, 0, 0);
      
      return canvas.toDataURL('image/png');
    } catch (err) {
      console.warn('Canvas filter application failed, returning original:', err);
      return imageElement.src;
    }
  }
  
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
    autoFixAndDownload: function(imageElements, customFilters) {
      /**
       * imageElements: Array of image DOM elements or { id, src, ...}
       * customFilters: Optional custom filter overrides
       */
      return new Promise(function(resolve, reject) {
        const editsMap = {};
        
        // Prepare all edits with adaptive brightness detection
        Array.from(imageElements).forEach((img, idx) => {
          const editId = `edit_${idx}`;
          
          try {
            // Detect optimal filters for this image
            const adaptiveFilters = getAdaptiveFilters(img);
            
            // Apply filters to canvas and get edited image
            const editedDataUri = applyFiltersToCanvas(img, adaptiveFilters);
            
            editsMap[editId] = {
              imageDataUri: editedDataUri,
              filters: {
                brightness: adaptiveFilters.brightness,
                contrast: adaptiveFilters.contrast,
                saturation: adaptiveFilters.saturation,
                detectedBrightness: adaptiveFilters.detectedBrightness
              }
            };
            
            console.log(`[${editId}] Brightness detected: ${Math.round(adaptiveFilters.detectedBrightness)}, Filters: ${JSON.stringify(adaptiveFilters)}`);
          } catch (err) {
            console.warn(`Failed to process ${editId}:`, err);
            // Use original if processing fails
            editsMap[editId] = {
              imageDataUri: img.src,
              filters: {
                brightness: 1.1,
                contrast: 1.1,
                saturation: 1.0
              }
            };
          }
        });
        
        // Save all edits
        window.AdarshEngineIntegration.saveEditedImages(editsMap)
          .then(results => {
            const editIds = results
              .filter(r => r.success)
              .map(r => r.edit_id);
            
            if (editIds.length > 0) {
              showToast(`Brightened and saved ${editIds.length} image${editIds.length !== 1 ? 's' : ''}`, true);
              console.log('✓ All images auto-fixed and saved, starting download...');
              
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
