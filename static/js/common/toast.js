/**
 * Common Toast/Notification Module
 * Provides unified toast notifications across all pages
 * 
 * @module common/toast
 * @version 1.0.0
 */

(function() {
    'use strict';

    // ==========================================
    // STATE
    // ==========================================
    
    let toastTimeout = null;
    let progressToastTimeout = null;

    // ==========================================
    // TOAST FUNCTIONS
    // ==========================================

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {string|boolean} type - 'success', 'error', 'info', 'warning' or boolean (true=success, false=error)
     * @param {number} duration - Duration in ms (default: 3000)
     */
    function showToast(message, type = 'success', duration = 3000) {
        // Normalize type parameter (support both string and boolean)
        if (typeof type === 'boolean') {
            type = type ? 'success' : 'error';
        }
        
        // Clear existing timeout
        if (toastTimeout) {
            clearTimeout(toastTimeout);
            toastTimeout = null;
        }

        // Get or create toast element
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = createToastElement();
        }

        // Get toast elements
        const toastMessage = document.getElementById('toastMessage') || toast.querySelector('span');
        const toastIcon = document.getElementById('toastIcon') || toast.querySelector('i');
        const toastProgress = document.getElementById('toastProgress');
        const toastProgressBar = document.getElementById('toastProgressBar');

        // Set message
        if (toastMessage) {
            toastMessage.textContent = message;
        }

        // Hide progress bar for regular toasts
        if (toastProgress) {
            toastProgress.style.display = 'none';
        }
        if (toastProgressBar) {
            toastProgressBar.classList.remove('indeterminate');
            toastProgressBar.style.width = '0%';
        }

        // Set icon based on type
        if (toastIcon) {
            const iconMap = {
                'success': 'fa-check-circle',
                'error': 'fa-times-circle',
                'info': 'fa-info-circle',
                'warning': 'fa-exclamation-triangle'
            };
            toastIcon.className = `fa-solid ${iconMap[type] || iconMap.success}`;
        }

        // Show toast with appropriate class
        toast.className = `toast show ${type}`;

        // Auto-hide after duration
        toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }

    /**
     * Show a progress toast with indeterminate or determinate progress
     * @param {string} message - Message to display
     * @param {number} progress - Progress percentage (0-100), or -1 for indeterminate
     */
    function showProgressToast(message, progress = -1) {
        // Clear any existing timeout
        if (progressToastTimeout) {
            clearTimeout(progressToastTimeout);
            progressToastTimeout = null;
        }

        let toast = document.getElementById('toast');
        if (!toast) {
            toast = createToastElement();
        }

        const toastMessage = document.getElementById('toastMessage') || toast.querySelector('span');
        const toastIcon = document.getElementById('toastIcon') || toast.querySelector('i');
        const toastProgress = document.getElementById('toastProgress');
        const toastProgressBar = document.getElementById('toastProgressBar');
        const toastPercent = document.getElementById('toastPercent');

        if (toastMessage) {
            toastMessage.textContent = message;
        }

        // Set downloading icon (spinner)
        if (toastIcon) {
            toastIcon.className = 'fa-solid fa-spinner fa-spin';
        }

        // Show progress bar
        if (toastProgress) {
            toastProgress.style.display = 'block';
        }

        // Show/update percentage
        if (toastPercent) {
            if (progress >= 0) {
                toastPercent.style.display = 'inline';
                toastPercent.textContent = Math.round(progress) + '%';
            } else {
                toastPercent.style.display = 'none';
            }
        }

        if (toastProgressBar) {
            if (progress < 0) {
                // Indeterminate progress
                toastProgressBar.classList.add('indeterminate');
                toastProgressBar.style.width = '30%';
            } else {
                // Determinate progress
                toastProgressBar.classList.remove('indeterminate');
                toastProgressBar.style.width = Math.min(progress, 100) + '%';
            }
        }

        toast.className = 'toast show downloading';
    }

    /**
     * Show download complete toast
     * @param {string} message - Success message
     */
    function showDownloadComplete(message = 'Successfully downloaded!') {
        // Clear any existing timeout
        if (progressToastTimeout) {
            clearTimeout(progressToastTimeout);
            progressToastTimeout = null;
        }

        let toast = document.getElementById('toast');
        if (!toast) {
            toast = createToastElement();
        }

        const toastMessage = document.getElementById('toastMessage') || toast.querySelector('span');
        const toastIcon = document.getElementById('toastIcon') || toast.querySelector('i');
        const toastProgress = document.getElementById('toastProgress');
        const toastProgressBar = document.getElementById('toastProgressBar');
        const toastPercent = document.getElementById('toastPercent');

        if (toastMessage) {
            toastMessage.textContent = message;
        }

        // Set success icon
        if (toastIcon) {
            toastIcon.className = 'fa-solid fa-check-circle';
        }

        // Show progress bar at 100%
        if (toastProgress) {
            toastProgress.style.display = 'block';
        }

        if (toastProgressBar) {
            toastProgressBar.classList.remove('indeterminate');
            toastProgressBar.style.width = '100%';
        }

        if (toastPercent) {
            toastPercent.style.display = 'inline';
            toastPercent.textContent = '100%';
        }

        toast.className = 'toast show success';

        // Hide after 3 seconds
        progressToastTimeout = setTimeout(() => {
            toast.classList.remove('show');
            // Reset progress bar
            if (toastProgress) {
                toastProgress.style.display = 'none';
            }
            if (toastProgressBar) {
                toastProgressBar.style.width = '0%';
            }
        }, 3000);
    }

    /**
     * Hide the toast immediately
     */
    function hideToast() {
        const toast = document.getElementById('toast');
        if (toast) {
            toast.classList.remove('show');
        }
        if (toastTimeout) {
            clearTimeout(toastTimeout);
            toastTimeout = null;
        }
        if (progressToastTimeout) {
            clearTimeout(progressToastTimeout);
            progressToastTimeout = null;
        }
    }

    /**
     * Create toast element if it doesn't exist
     * @returns {HTMLElement}
     */
    function createToastElement() {
        const toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        toast.innerHTML = `
            <i id="toastIcon" class="fa-solid fa-check-circle"></i>
            <span id="toastMessage">Success!</span>
            <span id="toastPercent" style="display: none; margin-left: 8px; font-weight: 600;"></span>
            <div id="toastProgress" class="toast-progress" style="display: none;">
                <div id="toastProgressBar" class="toast-progress-bar"></div>
            </div>
        `;
        document.body.appendChild(toast);
        return toast;
    }

    // ==========================================
    // EXPOSE API
    // ==========================================

    window.AdarshToast = {
        show: showToast,
        showProgress: showProgressToast,
        showComplete: showDownloadComplete,
        hide: hideToast
    };

    // Legacy/global compatibility (used throughout existing code)
    window.showToast = showToast;
    window.showProgressToast = showProgressToast;
    window.showDownloadComplete = showDownloadComplete;
    window.hideToast = hideToast;
    window.hideProgressToast = hideToast; // Alias

})();
