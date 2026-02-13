/**
 * Shared Utilities Module (Legacy Compatibility Layer)
 * 
 * NOTE: This file is maintained for backward compatibility.
 * New code should import from the common/ modules directly:
 * - common/ajax.js     - CSRF token and API calls
 * - common/toast.js    - Toast notifications
 * - common/modal.js    - Modal/Drawer management
 * - common/sidebar.js  - Sidebar functionality
 * - common/validation.js - Form validation
 * - common/utils.js    - Image utilities, helpers
 * 
 * @deprecated Use common/*.js modules instead
 */

// ==========================================
// CSRF TOKEN HELPER
// ==========================================

/**
 * Get CSRF token from cookies for Django form submissions
 * @returns {string} CSRF token value
 */
function getCSRFToken() {
    // First check if loaded from common/ajax.js
    if (window.AdarshAjax && window.AdarshAjax.getCSRFToken) {
        return window.AdarshAjax.getCSRFToken();
    }
    
    // Fallback implementation
    const cookie = document.cookie.split(';').find(c => c.trim().startsWith('csrftoken='));
    return cookie ? cookie.split('=')[1] : '';
}

// Expose globally
window.getCSRFToken = getCSRFToken;

// ==========================================
// TOAST NOTIFICATION SYSTEM
// ==========================================

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string|boolean} type - 'success', 'error', 'info' or boolean (true=success, false=error)
 */
function showToast(message, type = 'success') {
    // Normalize type parameter (support both string and boolean)
    if (typeof type === 'boolean') {
        type = type ? 'success' : 'error';
    }
    
    // Get or create toast element
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        toast.innerHTML = `
            <i id="toastIcon" class="fa-solid fa-check-circle"></i>
            <span id="toastMessage">Success!</span>
        `;
        document.body.appendChild(toast);
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
        switch (type) {
            case 'success':
                toastIcon.className = 'fa-solid fa-check-circle';
                break;
            case 'error':
                toastIcon.className = 'fa-solid fa-times-circle';
                break;
            case 'info':
                toastIcon.className = 'fa-solid fa-info-circle';
                break;
            default:
                toastIcon.className = 'fa-solid fa-check-circle';
        }
    }
    
    // Show toast with appropriate class
    toast.className = 'toast show ' + type;
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Expose globally
window.showToast = showToast;

// ==========================================
// PROGRESS TOAST (for downloads)
// ==========================================

let progressToastTimeout = null;

/**
 * Show a progress toast with indeterminate or determinate progress
 * @param {string} message - Message to display
 * @param {number} progress - Progress percentage (0-100), or -1 for indeterminate
 */
function showProgressToast(message, progress = -1) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    const toastIcon = document.getElementById('toastIcon');
    const toastProgress = document.getElementById('toastProgress');
    const toastProgressBar = document.getElementById('toastProgressBar');
    const toastPercent = document.getElementById('toastPercent');
    
    // Clear any existing timeout
    if (progressToastTimeout) {
        clearTimeout(progressToastTimeout);
        progressToastTimeout = null;
    }
    
    if (toast && toastMessage) {
        toastMessage.textContent = message;
        
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
}

/**
 * Show download complete toast
 * @param {string} message - Success message
 */
function showDownloadComplete(message = 'Successfully downloaded!') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    const toastIcon = document.getElementById('toastIcon');
    const toastProgress = document.getElementById('toastProgress');
    const toastProgressBar = document.getElementById('toastProgressBar');
    const toastPercent = document.getElementById('toastPercent');
    
    // Clear any existing timeout
    if (progressToastTimeout) {
        clearTimeout(progressToastTimeout);
        progressToastTimeout = null;
    }
    
    if (toast && toastMessage) {
        toastMessage.textContent = message;
        
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
}

/**
 * Hide the toast immediately
 */
function hideToast() {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.classList.remove('show');
    }
    if (progressToastTimeout) {
        clearTimeout(progressToastTimeout);
        progressToastTimeout = null;
    }
}

// Expose globally
window.showProgressToast = showProgressToast;
window.showDownloadComplete = showDownloadComplete;
window.hideToast = hideToast;

// ==========================================
// THUMBNAIL UTILITIES
// ==========================================

/**
 * Convert an image path to its thumbnail path.
 * Follows the server structure: adrsh_img/thumbs/{client_code}/{filename}
 * 
 * @param {string} imagePath - Original image path (e.g., 'adarshimg/ABCDE12345/14325123456101.jpg')
 * @returns {string} Thumbnail path (e.g., 'adarshimg/thumbs/ABCDE12345/14325123456101.jpg')
 */
function getThumbPath(imagePath) {
    if (!imagePath || imagePath === '' || imagePath === 'NOT_FOUND') {
        return null;
    }
    
    // Handle PENDING: prefix
    if (imagePath.startsWith('PENDING:')) {
        return null;
    }
    
    // Split path into parts
    const parts = imagePath.replace(/\\/g, '/').split('/');
    
    if (parts.length < 2) {
        // Just a filename - add thumbs folder
        return `thumbs/${imagePath}`;
    }
    
    // Insert 'thumbs' after the base folder
    // e.g., "adarshimg/ABCDE/123.jpg" -> "adarshimg/thumbs/ABCDE/123.jpg"
    const baseFolder = parts[0];
    const rest = parts.slice(1).join('/');
    
    return `${baseFolder}/thumbs/${rest}`;
}

/**
 * Get image URL with fallback to thumbnail or placeholder.
 * Tries thumbnail first for better performance, falls back to original if thumbnail missing.
 * 
 * @param {string} imagePath - Image path from field_data
 * @param {boolean} preferThumbnail - Whether to prefer thumbnail (default: true for tables)
 * @returns {Object} Object with {src, isThumbnail, isPlaceholder}
 */
function getImageUrl(imagePath, preferThumbnail = true) {
    if (!imagePath || imagePath === '' || imagePath === 'NOT_FOUND') {
        return { src: null, isThumbnail: false, isPlaceholder: true };
    }
    
    if (imagePath.startsWith('PENDING:')) {
        return { src: null, isThumbnail: false, isPlaceholder: true, isPending: true, pendingRef: imagePath.substring(8) };
    }
    
    const thumbPath = preferThumbnail ? getThumbPath(imagePath) : null;
    
    return {
        src: `/media/${imagePath}`,
        thumbSrc: thumbPath ? `/media/${thumbPath}` : null,
        isThumbnail: false,
        isPlaceholder: false,
        originalPath: imagePath
    };
}

/**
 * Load image with thumbnail fallback.
 * Tries to load thumbnail first, falls back to original on error.
 * 
 * @param {HTMLImageElement} imgElement - The image element to load into
 * @param {string} imagePath - The image path from field_data
 * @param {Object} options - Options: { useThumbnail: true, onLoad: fn, onError: fn }
 */
function loadImageWithFallback(imgElement, imagePath, options = {}) {
    const { useThumbnail = true, onLoad = null, onError = null } = options;
    
    const urlInfo = getImageUrl(imagePath, useThumbnail);
    
    if (urlInfo.isPlaceholder) {
        if (onError) onError(urlInfo);
        return;
    }
    
    // Try thumbnail first if available
    if (useThumbnail && urlInfo.thumbSrc) {
        imgElement.onerror = function() {
            // Thumbnail failed, try original
            imgElement.onerror = function() {
                if (onError) onError(urlInfo);
            };
            imgElement.src = urlInfo.src;
        };
        imgElement.onload = function() {
            if (onLoad) onLoad(urlInfo, true); // true = loaded thumbnail
        };
        imgElement.src = urlInfo.thumbSrc;
    } else {
        // Load original directly
        imgElement.onerror = function() {
            if (onError) onError(urlInfo);
        };
        imgElement.onload = function() {
            if (onLoad) onLoad(urlInfo, false); // false = loaded original
        };
        imgElement.src = urlInfo.src;
    }
}

/**
 * Get the short display path from a full image path.
 * Useful for showing in modals/drawers.
 * 
 * @param {string} imagePath - Full path like 'adarshimg/ABCDE12345/14325123456101.jpg'
 * @returns {string} Short path like '../ABCDE12345/14325123456101.jpg'
 */
function getShortPath(imagePath) {
    if (!imagePath) return '';
    
    // Handle PENDING: prefix
    if (imagePath.startsWith('PENDING:')) {
        return `Pending: ${imagePath.substring(8)}`;
    }
    
    // Extract folder and filename
    const parts = imagePath.split('/');
    if (parts.length >= 2) {
        return `../${parts.slice(-2).join('/')}`;
    }
    return imagePath;
}

// Expose thumbnail utilities globally
window.getThumbPath = getThumbPath;
window.getImageUrl = getImageUrl;
window.loadImageWithFallback = loadImageWithFallback;
window.getShortPath = getShortPath;

// ==========================================
// UI CONSISTENCY HELPERS
// ==========================================

/**
 * Standard Empty State Messages
 * Use these for consistent messaging across all pages
 */
const EMPTY_STATE_CONFIG = {
    staff: {
        icon: 'fa-user-slash',
        title: 'No Staff Found',
        message: 'Try adjusting your search or filter criteria',
        actionText: 'Add Staff'
    },
    clients: {
        icon: 'fa-building-slash', 
        title: 'No Clients Found',
        message: 'Try adjusting your search or filter criteria',
        actionText: 'Add Client'
    },
    activeClients: {
        icon: 'fa-users-slash',
        title: 'No Active Clients Found',
        message: 'No clients are currently active'
    },
    idCards: {
        icon: 'fa-id-card-clip',
        title: 'No ID Cards Found',
        message: 'Upload ID cards using the bulk upload feature',
        actionText: 'Upload Cards'
    },
    groups: {
        icon: 'fa-folder-open',
        title: 'No Groups Found',
        message: 'Create a group to start managing ID cards',
        actionText: 'Add Group'
    },
    tables: {
        icon: 'fa-table',
        title: 'No Tables Found',
        message: 'Create a table to define ID card structure',
        actionText: 'Create Table'
    },
    searchResults: {
        icon: 'fa-magnifying-glass',
        title: 'No Results Found',
        message: 'Try adjusting your search criteria'
    }
};

window.EMPTY_STATE_CONFIG = EMPTY_STATE_CONFIG;

/**
 * Show empty state for a context
 * @param {string} containerId - ID of the empty state container
 * @param {string} contextType - One of: staff, clients, activeClients, idCards, groups, tables, searchResults
 * @param {Object} options - Optional overrides: { title, message, showAction }
 */
function showEmptyState(containerId, contextType = 'searchResults', options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const config = EMPTY_STATE_CONFIG[contextType] || EMPTY_STATE_CONFIG.searchResults;
    
    // Update icon
    const icon = container.querySelector('i');
    if (icon) {
        icon.className = `fa-solid ${options.icon || config.icon}`;
    }
    
    // Update title
    const title = container.querySelector('h3');
    if (title) {
        title.textContent = options.title || config.title;
    }
    
    // Update message
    const message = container.querySelector('p');
    if (message) {
        message.textContent = options.message || config.message;
    }
    
    // Show/hide action button
    const actionBtn = container.querySelector('.empty-state-action');
    if (actionBtn) {
        if (options.showAction && config.actionText) {
            actionBtn.style.display = '';
            const btnText = actionBtn.querySelector('span') || actionBtn;
            if (btnText.tagName !== 'I') {
                btnText.textContent = options.actionText || config.actionText;
            }
        } else {
            actionBtn.style.display = 'none';
        }
    }
    
    container.style.display = '';
}

/**
 * Hide empty state
 * @param {string} containerId - ID of the empty state container
 */
function hideEmptyState(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.style.display = 'none';
    }
}

window.showEmptyState = showEmptyState;
window.hideEmptyState = hideEmptyState;

/**
 * Standard Drawer Manager
 * Provides consistent drawer open/close behavior across all pages
 */
class DrawerManager {
    constructor(drawerId, options = {}) {
        this.drawer = document.getElementById(drawerId);
        this.overlay = document.getElementById(`${drawerId}-overlay`) || 
                       document.getElementById(options.overlayId);
        this.closeBtn = document.getElementById(`${drawerId}-close`) ||
                        this.drawer?.querySelector('.drawer-close');
        this.cancelBtn = document.getElementById(`${drawerId}-cancel`) ||
                         this.drawer?.querySelector('.drawer-cancel');
        this.submitBtn = document.getElementById(`${drawerId}-submit`) ||
                         this.drawer?.querySelector('.drawer-submit, [type="submit"]');
        this.titleEl = document.getElementById(`${drawerId}-title`) ||
                       this.drawer?.querySelector('.drawer-title span');
        this.iconEl = document.getElementById(`${drawerId}-icon`) ||
                      this.drawer?.querySelector('.drawer-title i');
        
        this.currentMode = 'add';
        this.onOpen = options.onOpen || null;
        this.onClose = options.onClose || null;
        
        this._bindEvents();
    }
    
    _bindEvents() {
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.close());
        }
        if (this.cancelBtn) {
            this.cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.close();
            });
        }
        if (this.overlay) {
            this.overlay.addEventListener('click', () => this.close());
        }
        
        // ESC key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                this.close();
            }
        });
    }
    
    open(mode = 'add', data = null) {
        this.currentMode = mode;
        
        // Update title and icon based on mode
        const modeConfig = {
            add: { icon: 'fa-plus', titlePrefix: 'Add New' },
            edit: { icon: 'fa-pen-to-square', titlePrefix: 'Edit' },
            view: { icon: 'fa-eye', titlePrefix: 'View' }
        };
        
        const config = modeConfig[mode] || modeConfig.add;
        
        if (this.iconEl) {
            this.iconEl.className = `fa-solid ${config.icon}`;
        }
        
        // Show/hide submit button
        if (this.submitBtn) {
            this.submitBtn.style.display = mode === 'view' ? 'none' : '';
        }
        
        // Open drawer
        if (this.drawer) {
            this.drawer.classList.add('open');
        }
        if (this.overlay) {
            this.overlay.classList.add('active');
        }
        document.body.style.overflow = 'hidden';
        
        if (this.onOpen) {
            this.onOpen(mode, data);
        }
    }
    
    close() {
        if (this.drawer) {
            this.drawer.classList.remove('open');
        }
        if (this.overlay) {
            this.overlay.classList.remove('active');
        }
        document.body.style.overflow = '';
        
        if (this.onClose) {
            this.onClose();
        }
    }
    
    isOpen() {
        return this.drawer?.classList.contains('open') || false;
    }
    
    setTitle(title) {
        if (this.titleEl) {
            this.titleEl.textContent = title;
        }
    }
    
    setSubmitText(text) {
        if (this.submitBtn) {
            const textEl = this.submitBtn.querySelector('span') || this.submitBtn;
            textEl.textContent = text;
        }
    }
    
    setLoading(loading) {
        if (this.submitBtn) {
            this.submitBtn.disabled = loading;
            const icon = this.submitBtn.querySelector('i');
            const text = this.submitBtn.querySelector('span');
            
            if (loading) {
                if (icon) icon.className = 'fa-solid fa-spinner fa-spin';
                if (text) text.textContent = 'Saving...';
            }
        }
    }
}

window.DrawerManager = DrawerManager;

/**
 * Standard Image Preview Manager
 * Handles consistent image upload preview behavior
 */
class ImagePreviewManager {
    constructor(inputId, previewId, pathId = null, options = {}) {
        this.input = document.getElementById(inputId);
        this.preview = document.getElementById(previewId);
        this.pathDisplay = pathId ? document.getElementById(pathId) : null;
        
        this.maxSize = options.maxSize || 2 * 1024 * 1024; // 2MB default
        this.allowedTypes = options.allowedTypes || ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        this.placeholderIcon = options.placeholderIcon || 'fa-user';
        this.onSelect = options.onSelect || null;
        this.onError = options.onError || null;
        
        this.selectedFile = null;
        
        this._bindEvents();
    }
    
    _bindEvents() {
        if (this.input) {
            this.input.addEventListener('change', (e) => this._handleFileSelect(e));
        }
    }
    
    _handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        // Validate file type
        if (!this.allowedTypes.includes(file.type)) {
            const error = 'Invalid file type. Please select an image (JPG, PNG, GIF, WebP).';
            if (this.onError) this.onError(error);
            else showToast(error, 'error');
            this.input.value = '';
            return;
        }
        
        // Validate file size
        if (file.size > this.maxSize) {
            const sizeMB = (this.maxSize / 1024 / 1024).toFixed(0);
            const error = `File too large. Maximum size is ${sizeMB}MB.`;
            if (this.onError) this.onError(error);
            else showToast(error, 'error');
            this.input.value = '';
            return;
        }
        
        this.selectedFile = file;
        
        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            if (this.preview) {
                this.preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
                this.preview.classList.add('has-image');
                this.preview.classList.remove('no-path', 'not-found');
            }
            if (this.pathDisplay) {
                this.pathDisplay.textContent = file.name;
                this.pathDisplay.classList.add('has-path');
                this.pathDisplay.classList.remove('no-path', 'not-found');
            }
        };
        reader.readAsDataURL(file);
        
        if (this.onSelect) {
            this.onSelect(file);
        }
    }
    
    reset() {
        this.selectedFile = null;
        if (this.input) this.input.value = '';
        if (this.preview) {
            this.preview.innerHTML = `<i class="fa-solid ${this.placeholderIcon}"></i>`;
            this.preview.classList.remove('has-image', 'not-found');
            this.preview.classList.add('no-path');
        }
        if (this.pathDisplay) {
            this.pathDisplay.textContent = 'No image';
            this.pathDisplay.classList.remove('has-path', 'not-found');
            this.pathDisplay.classList.add('no-path');
        }
    }
    
    setFromUrl(url) {
        if (!url) {
            this.reset();
            return;
        }
        
        if (this.preview) {
            this.preview.innerHTML = `<img src="${url}" alt="Preview">`;
            this.preview.classList.add('has-image');
            this.preview.classList.remove('no-path', 'not-found');
        }
        if (this.pathDisplay) {
            this.pathDisplay.textContent = getShortPath(url);
            this.pathDisplay.classList.add('has-path');
            this.pathDisplay.classList.remove('no-path', 'not-found');
        }
    }
    
    getFile() {
        return this.selectedFile;
    }
}

window.ImagePreviewManager = ImagePreviewManager;

/**
 * Standard Loading Button Helper
 * Shows/hides loading state on buttons consistently
 */
function setButtonLoading(button, loading, loadingText = 'Saving...') {
    if (!button) return;
    
    if (loading) {
        button.disabled = true;
        button.dataset.originalHtml = button.innerHTML;
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${loadingText}`;
    } else {
        button.disabled = false;
        if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
        }
    }
}

window.setButtonLoading = setButtonLoading;
