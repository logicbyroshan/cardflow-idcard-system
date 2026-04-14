document.addEventListener('DOMContentLoaded', function() {
    
    // --- 1. Filter Logic ---
    const filterTabs = document.querySelectorAll('.filter-tab');
    const cards = document.querySelectorAll('.testimonial-card');
    const testimonialGrid = document.getElementById('testimonialGrid');

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
    const REVIEW_MODAL_QUERY_KEY = 'review';
    const REVIEW_MODAL_QUERY_OPEN_VALUE = 'open';

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