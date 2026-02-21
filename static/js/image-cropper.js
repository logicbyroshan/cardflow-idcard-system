/**
 * Image Cropper Module
 * 
 * Provides a crop dialog powered by Cropper.js for image fields
 * in the side modal. When an image file is selected, a crop modal
 * appears letting the user adjust the crop area before the image
 * is set on the field.
 *
 * Usage: window.ImageCropper.open(file, options) → Promise<File|null>
 */
(function() {
'use strict';

let cropper = null;
let resolvePromise = null;
let currentFileName = '';
let currentFileType = '';

// DOM refs (cached on first use)
let overlay, image, closeBtn, cancelBtn, applyBtn, aspectBtns;

function getElements() {
    if (overlay) return true;
    overlay = document.getElementById('cropModalOverlay');
    image = document.getElementById('cropImage');
    closeBtn = document.getElementById('cropModalClose');
    cancelBtn = document.getElementById('cropCancelBtn');
    applyBtn = document.getElementById('cropApplyBtn');
    aspectBtns = overlay ? overlay.querySelectorAll('.crop-aspect-btn') : [];
    if (!overlay || !image) return false;
    bindEvents();
    return true;
}

function bindEvents() {
    // Close / Cancel → resolve(null)
    closeBtn?.addEventListener('click', cancel);
    cancelBtn?.addEventListener('click', skip);
    // Do NOT close on click-outside — user may accidentally lose their crop
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && overlay?.classList.contains('active')) cancel();
    });

    // Apply crop
    applyBtn?.addEventListener('click', applyCrop);

    // Aspect ratio buttons
    aspectBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            aspectBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            setAspectRatio(this.dataset.aspect);
        });
    });
}

function setAspectRatio(aspect) {
    if (!cropper) return;
    if (aspect === 'free') {
        cropper.setAspectRatio(NaN);
    } else {
        var parts = aspect.split(':');
        cropper.setAspectRatio(parseInt(parts[0]) / parseInt(parts[1]));
    }
}

function openModal(file) {
    if (!getElements()) {
        console.warn('[ImageCropper] Crop modal elements not found');
        return Promise.resolve(null);
    }

    currentFileName = file.name;
    currentFileType = file.type || 'image/jpeg';

    // Start loading Cropper.js in parallel with FileReader
    var cropperReady = (typeof LazyLoad !== 'undefined') ? LazyLoad.cropper() : Promise.resolve(window.Cropper);

    return new Promise(function(resolve) {
        resolvePromise = resolve;

        // Read file → set image src
        var reader = new FileReader();
        reader.onload = function(ev) {
            image.src = ev.target.result;

            // Show overlay
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';

            // Reset aspect buttons — default to free (select whole image)
            aspectBtns.forEach(b => b.classList.remove('active'));
            var freeBtn = overlay.querySelector('[data-aspect="free"]');
            if (freeBtn) freeBtn.classList.add('active');

            // Destroy old cropper & create new
            if (cropper) { cropper.destroy(); cropper = null; }

            // Small delay to ensure image is rendered, then await Cropper lib
            setTimeout(function() {
                cropperReady.then(function(CropperLib) {
                    cropper = new CropperLib(image, {
                        viewMode: 1,
                        dragMode: 'move',
                        autoCropArea: 1,
                        responsive: true,
                        restore: false,
                        guides: true,
                        center: true,
                        highlight: true,
                        cropBoxMovable: true,
                        cropBoxResizable: true,
                        toggleDragModeOnDblclick: false,
                        background: true,
                    });
                });
            }, 100);
        };
        reader.readAsDataURL(file);
    });
}

function closeModal() {
    if (cropper) { cropper.destroy(); cropper = null; }
    overlay?.classList.remove('active');
    document.body.style.overflow = '';
    image.src = '';
}

function cancel() {
    closeModal();
    if (resolvePromise) { resolvePromise(null); resolvePromise = null; }
}

function skip() {
    // Skip cropping — return original file reference marker
    closeModal();
    if (resolvePromise) { resolvePromise('skip'); resolvePromise = null; }
}

function applyCrop() {
    if (!cropper) { cancel(); return; }

    var canvas = cropper.getCroppedCanvas({
        // Limit output size to prevent unnecessarily huge files
        maxWidth: 2048,
        maxHeight: 2048,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
    });

    if (!canvas) { cancel(); return; }

    // Convert to blob then File
    canvas.toBlob(function(blob) {
        if (!blob) { cancel(); return; }

        // Build a clean filename: original stem + _cropped + extension
        var ext = currentFileName.lastIndexOf('.') >= 0
            ? currentFileName.substring(currentFileName.lastIndexOf('.'))
            : '.jpg';
        var stem = currentFileName.lastIndexOf('.') >= 0
            ? currentFileName.substring(0, currentFileName.lastIndexOf('.'))
            : currentFileName;
        var newName = stem + '_cropped' + ext;

        var croppedFile = new File([blob], newName, { type: currentFileType });

        closeModal();
        if (resolvePromise) { resolvePromise(croppedFile); resolvePromise = null; }
    }, currentFileType, 0.92);
}

// Expose
window.ImageCropper = {
    /**
     * Open the crop modal for a given File.
     * @param {File} file - The image file to crop
     * @returns {Promise<File|null|'skip'>} Cropped File, null if cancelled, 'skip' if skipped
     */
    open: openModal,
};

})();
