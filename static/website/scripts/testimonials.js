document.addEventListener('DOMContentLoaded', function() {
    
    // --- 1. Filter Logic ---
    const filterTabs = document.querySelectorAll('.filter-tab');
    const cards = document.querySelectorAll('.testimonial-card');
    const testimonialGrid = document.getElementById('testimonialGrid');

    function initHelpfulButtons() {
        const helpfulButtons = document.querySelectorAll('.helpful-btn[data-id]');
        if (!helpfulButtons.length || !testimonialGrid) return;

        const helpfulUrl = testimonialGrid.dataset.helpfulUrl || '/testimonial-helpful/';
        const csrfToken = document.querySelector('input[name="csrfmiddlewaretoken"]')?.value
            || document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
            || '';

        helpfulButtons.forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (btn.dataset.loading === '1') return;

                const testimonialId = btn.dataset.id;
                if (!testimonialId) return;

                btn.dataset.loading = '1';
                btn.classList.add('is-loading');

                try {
                    const response = await fetch(helpfulUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                            'X-Requested-With': 'XMLHttpRequest',
                            'X-CSRFToken': csrfToken,
                        },
                        body: new URLSearchParams({ id: testimonialId }).toString(),
                    });

                    const data = await response.json();
                    if (!response.ok || !data.success) {
                        throw new Error(data.message || 'Unable to update helpful count.');
                    }

                    const countEl = btn.querySelector('.helpful-count');
                    if (countEl) {
                        countEl.textContent = String(data.helpful_count ?? countEl.textContent);
                    }

                    const icon = btn.querySelector('i');
                    if (icon) {
                        icon.classList.remove('fa-regular');
                        icon.classList.add('fa-solid');
                    }

                    btn.classList.add('active');
                } catch (_err) {
                    showToast('Unable to mark as helpful right now.', 'error');
                } finally {
                    btn.dataset.loading = '0';
                    btn.classList.remove('is-loading');
                }
            });
        });
    }

    initHelpfulButtons();

    filterTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const filter = this.dataset.filter;
            filterTabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');

            let visibleCount = 0;

            cards.forEach(card => {
                const category = (card.dataset.category || '').toLowerCase().trim();
                if (filter === 'all' || category === filter) {
                    card.style.display = 'block';
                    card.style.opacity = '1';
                    card.style.transform = 'scale(1)';
                    visibleCount++;
                } else {
                    card.style.opacity = '0';
                    card.style.transform = 'scale(0.95)';
                    setTimeout(() => { card.style.display = 'none'; }, 300);
                }
            });

            // Show/hide "no results" message for filtered view
            let noResultsMsg = testimonialGrid?.querySelector('.filter-no-results');
            if (visibleCount === 0 && cards.length > 0) {
                if (!noResultsMsg && testimonialGrid) {
                    noResultsMsg = document.createElement('div');
                    noResultsMsg.className = 'filter-no-results';
                    noResultsMsg.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 60px 20px;';
                    noResultsMsg.innerHTML = '<p style="color: #94a3b8; font-size: 1.1rem; margin: 0;">No reviews found for this category.</p>';
                    testimonialGrid.appendChild(noResultsMsg);
                }
                if (noResultsMsg) noResultsMsg.style.display = 'block';
            } else if (noResultsMsg) {
                noResultsMsg.style.display = 'none';
            }
        });
    });

    // --- 2. Video Modal Logic ---
    const videoModal = document.getElementById('videoModal');
    const modalVideo = document.getElementById('modalVideo');
    const videoCards = document.querySelectorAll('.video-card');

    videoCards.forEach(card => {
        card.addEventListener('click', () => {
            const url = card.dataset.videoUrl;
            if (!url) return;
            if (url.includes('youtube.com') || url.includes('youtu.be')) {
                window.open(url, '_blank');
            } else if (videoModal && modalVideo) {
                modalVideo.src = url;
                videoModal.classList.add('active');
                modalVideo.play();
            }
        });
    });

    document.getElementById('videoModalClose')?.addEventListener('click', () => {
        if (!videoModal || !modalVideo) return;
        videoModal.classList.remove('active');
        modalVideo.pause();
    });

    // --- 3. Review Submission Logic ---
    const reviewModal = document.getElementById('reviewModal');
    const reviewShareBtn = document.getElementById('reviewModalShare');
    const stars = document.querySelectorAll('.star-rating i');
    const ratingInput = document.getElementById('selectedRating');
    const reviewCanSubmit = reviewModal ? reviewModal.dataset.canSubmit !== 'false' : true;
    const reviewAttachmentInput = document.getElementById('reviewAttachmentInput');
    const reviewAttachmentSelectBtn = document.getElementById('reviewAttachmentSelectBtn');
    const reviewAttachmentPasteArea = document.getElementById('reviewAttachmentPasteArea');
    const reviewAttachmentName = document.getElementById('reviewAttachmentName');
    const reviewAttachmentPreview = document.getElementById('reviewAttachmentPreview');
    const reviewAttachmentPreviewImg = document.getElementById('reviewAttachmentPreviewImg');
    const reviewAttachmentClearBtn = document.getElementById('reviewAttachmentClearBtn');
    const REVIEW_MODAL_QUERY_KEY = 'review';
    const REVIEW_MODAL_QUERY_OPEN_VALUE = 'open';
    const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
    let pendingAttachmentFile = null;
    let pendingAttachmentPreviewUrl = '';

    function resetAttachmentPreview() {
        pendingAttachmentFile = null;
        if (pendingAttachmentPreviewUrl) {
            URL.revokeObjectURL(pendingAttachmentPreviewUrl);
            pendingAttachmentPreviewUrl = '';
        }
        if (reviewAttachmentInput) reviewAttachmentInput.value = '';
        if (reviewAttachmentName) reviewAttachmentName.textContent = 'No screenshot attached';
        if (reviewAttachmentPreview) reviewAttachmentPreview.hidden = true;
        if (reviewAttachmentPreviewImg) reviewAttachmentPreviewImg.removeAttribute('src');
    }

    function setAttachmentFile(file) {
        if (!file) return;
        if (!file.type || !file.type.startsWith('image/')) {
            showToast('Only image files are allowed for screenshot.', 'error');
            return;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
            showToast('Screenshot must be 10MB or smaller.', 'error');
            return;
        }

        pendingAttachmentFile = file;
        if (pendingAttachmentPreviewUrl) {
            URL.revokeObjectURL(pendingAttachmentPreviewUrl);
        }
        pendingAttachmentPreviewUrl = URL.createObjectURL(file);

        if (reviewAttachmentName) {
            const kb = Math.max(1, Math.round(file.size / 1024));
            reviewAttachmentName.textContent = `${file.name || 'pasted-image.png'} (${kb} KB)`;
        }
        if (reviewAttachmentPreviewImg) {
            reviewAttachmentPreviewImg.src = pendingAttachmentPreviewUrl;
        }
        if (reviewAttachmentPreview) {
            reviewAttachmentPreview.hidden = false;
        }
    }

    function extractImageFromClipboard(event) {
        const clipboard = event.clipboardData;
        if (!clipboard || !clipboard.items) return null;
        for (let i = 0; i < clipboard.items.length; i += 1) {
            const item = clipboard.items[i];
            if (item && item.kind === 'file' && item.type && item.type.startsWith('image/')) {
                return item.getAsFile();
            }
        }
        return null;
    }

    function buildReviewModalUrl() {
        const url = new URL(window.location.href);
        url.searchParams.set(REVIEW_MODAL_QUERY_KEY, REVIEW_MODAL_QUERY_OPEN_VALUE);
        return url.toString();
    }

    function syncReviewModalUrl(isOpen) {
        if (!window.history || typeof window.history.replaceState !== 'function') return;
        const url = new URL(window.location.href);
        if (isOpen) {
            url.searchParams.set(REVIEW_MODAL_QUERY_KEY, REVIEW_MODAL_QUERY_OPEN_VALUE);
        } else {
            url.searchParams.delete(REVIEW_MODAL_QUERY_KEY);
        }
        const target = url.pathname + (url.search || '') + (url.hash || '');
        window.history.replaceState(window.history.state, '', target);
    }

    function shouldAutoOpenReviewModal() {
        const rawValue = (new URL(window.location.href)).searchParams.get(REVIEW_MODAL_QUERY_KEY);
        const value = String(rawValue || '').trim().toLowerCase();
        return value === REVIEW_MODAL_QUERY_OPEN_VALUE || value === '1' || value === 'true' || value === 'yes';
    }

    function openReviewModal(syncUrl = true) {
        if (!reviewModal) return;
        reviewModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        if (syncUrl) syncReviewModalUrl(true);
    }

    function closeReviewModal(syncUrl = true) {
        if (!reviewModal) return;
        reviewModal.classList.remove('active');
        document.body.style.overflow = '';
        if (syncUrl) syncReviewModalUrl(false);
    }

    async function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
    }

    document.getElementById('heroWriteReviewBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        openReviewModal(true);
    });

    reviewAttachmentSelectBtn?.addEventListener('click', () => {
        reviewAttachmentInput?.click();
    });

    reviewAttachmentInput?.addEventListener('change', () => {
        const selected = reviewAttachmentInput.files && reviewAttachmentInput.files[0];
        if (selected) {
            setAttachmentFile(selected);
        } else {
            resetAttachmentPreview();
        }
    });

    reviewAttachmentPasteArea?.addEventListener('paste', (event) => {
        const imageFile = extractImageFromClipboard(event);
        if (!imageFile) return;
        event.preventDefault();
        setAttachmentFile(imageFile);
    });

    document.addEventListener('paste', (event) => {
        if (!reviewModal || !reviewModal.classList.contains('active') || !reviewCanSubmit) return;
        const imageFile = extractImageFromClipboard(event);
        if (!imageFile) return;
        event.preventDefault();
        setAttachmentFile(imageFile);
    });

    reviewAttachmentClearBtn?.addEventListener('click', () => {
        resetAttachmentPreview();
    });

    document.getElementById('reviewModalClose')?.addEventListener('click', () => {
        closeReviewModal(true);
    });

    // Close modal on backdrop click
    reviewModal?.addEventListener('click', (e) => {
        if (e.target === reviewModal) {
            closeReviewModal(true);
        }
    });

    reviewShareBtn?.addEventListener('click', async () => {
        const shareUrl = buildReviewModalUrl();
        const shareTitle = document.title || 'Write a Review';
        const shareText = 'Submit your review here';

        if (navigator.share) {
            try {
                await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return;
            }
        }

        try {
            await copyText(shareUrl);
            showToast('Review form link copied', 'success');
        } catch (err) {
            showToast('Unable to share link on this device', 'error');
        }
    });

    if (shouldAutoOpenReviewModal()) {
        openReviewModal(false);
    }

    // Star interaction - default all 5 stars selected
    stars.forEach(star => {
        star.addEventListener('click', function() {
            const val = parseInt(this.dataset.rating);
            ratingInput.value = val;
            stars.forEach(s => {
                const sVal = parseInt(s.dataset.rating);
                if (sVal <= val) {
                    s.classList.remove('far');
                    s.classList.add('fas');
                    s.style.color = '#f1c40f';
                } else {
                    s.classList.remove('fas');
                    s.classList.add('far');
                    s.style.color = '#e2e8f0';
                }
            });
        });

        // Hover effects
        star.addEventListener('mouseenter', function() {
            const val = parseInt(this.dataset.rating);
            stars.forEach(s => {
                const sVal = parseInt(s.dataset.rating);
                if (sVal <= val) {
                    s.style.color = '#f1c40f';
                    s.style.transform = 'scale(1.1)';
                }
            });
        });

        star.addEventListener('mouseleave', function() {
            const currentRating = parseInt(ratingInput.value);
            stars.forEach(s => {
                const sVal = parseInt(s.dataset.rating);
                s.style.transform = 'scale(1)';
                if (sVal <= currentRating) {
                    s.style.color = '#f1c40f';
                } else {
                    s.style.color = '#e2e8f0';
                }
            });
        });
    });

    // Initialize stars to show 5 selected by default
    stars.forEach(s => {
        s.classList.remove('far');
        s.classList.add('fas');
        s.style.color = '#f1c40f';
    });

    // AJAX Form Submit
    const reviewForm = document.getElementById('reviewForm');
    reviewForm?.addEventListener('submit', function(e) {
        e.preventDefault();
        const formData = new FormData(this);
        if (pendingAttachmentFile) {
            const filename = pendingAttachmentFile.name || 'screenshot.png';
            formData.set('attachment_image', pendingAttachmentFile, filename);
        }
        const submitBtn = this.querySelector('button[type="submit"]');
        const submitUrl = this.dataset.submitUrl;
        
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

        fetch(submitUrl, {
            method: 'POST',
            body: formData,
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
        .then(res => res.json())
        .then(data => {
            showToast(data.message, data.success ? 'success' : 'error');
            if (data.success) {
                // Auto close modal after successful submission
                setTimeout(() => {
                    closeReviewModal(true);
                    reviewForm.reset();
                    resetAttachmentPreview();
                    // Reset stars to 5 selected
                    ratingInput.value = 5;
                    stars.forEach(s => {
                        s.classList.remove('far');
                        s.classList.add('fas');
                        s.style.color = '#f1c40f';
                    });
                }, 1500);
            }
        })
        .catch(err => {
            showToast('Something went wrong. Please try again.', 'error');
        })
        .finally(() => {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Submit for Approval';
        });
    });

    // --- Toast Notification ---
    initToast();

    // --- Circle Progress Animation ---
    initCircleProgress();
});

// Toast Notification Functions
function initToast() {
    const toastClose = document.querySelector('.toast-close');
    toastClose?.addEventListener('click', hideToast);
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = toast?.querySelector('.toast-message');
    const toastIcon = toast?.querySelector('.toast-icon i');
    
    if (!toast || !toastMessage) return;
    
    toastMessage.textContent = message;
    
    // Update icon and color based on type
    toast.classList.remove('toast-success', 'toast-error');
    toast.classList.add(type === 'success' ? 'toast-success' : 'toast-error');
    
    if (toastIcon) {
        toastIcon.className = type === 'success' 
            ? 'fas fa-check-circle' 
            : 'fas fa-exclamation-circle';
    }
    
    // Show toast
    toast.classList.add('show');
    
    // Auto hide after 4 seconds
    setTimeout(hideToast, 4000);
}

function hideToast() {
    const toast = document.getElementById('toast');
    toast?.classList.remove('show');
}

// Animate circular progress bars when in viewport
function initCircleProgress() {
    const circleProgressElements = document.querySelectorAll('.circle-progress');
    
    if (circleProgressElements.length === 0) return;
    
    const circumference = 2 * Math.PI * 45; // radius = 45
    
    // Set initial state
    circleProgressElements.forEach(circle => {
        const progressBar = circle.querySelector('.progress-bar');
        if (progressBar) {
            progressBar.style.strokeDasharray = circumference;
            progressBar.style.strokeDashoffset = circumference;
        }
    });
    
    // Intersection Observer for animation trigger
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const circle = entry.target;
                const percent = parseInt(circle.dataset.percent) || 0;
                const progressBar = circle.querySelector('.progress-bar');
                
                if (progressBar) {
                    const offset = circumference - (percent / 100) * circumference;
                    progressBar.style.strokeDashoffset = offset;
                }
                
                // Animate the number
                const valueSpan = circle.querySelector('.progress-value');
                if (valueSpan) {
                    animateValue(valueSpan, 0, percent, 1500);
                }
                
                observer.unobserve(circle);
            }
        });
    }, { threshold: 0.5 });
    
    circleProgressElements.forEach(circle => {
        observer.observe(circle);
    });
}

// Animate number counting
function animateValue(element, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const current = Math.floor(progress * (end - start) + start);
        element.textContent = current + '%';
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}