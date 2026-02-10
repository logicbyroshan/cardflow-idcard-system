/**
 * Adarsh ID Cards - Our Works Logic (v2)
 * Handles Filtering, Lightbox, Category Exploration, Video Playback
 */

document.addEventListener('DOMContentLoaded', function() {
    
    // --- Load Category Background Images ---
    initCategoryBackgrounds();
    
    // --- 1. Portfolio Filtering (now uses category IDs) ---
    const filterTabs = document.querySelectorAll('.filter-tab');
    const portfolioItems = document.querySelectorAll('.portfolio-item');
    const portfolioGrid = document.getElementById('portfolioGrid');

    filterTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const filter = this.dataset.filter;
            
            filterTabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            let visibleCount = 0;
            
            portfolioItems.forEach(item => {
                if (filter === 'all' || item.dataset.category === filter) {
                    item.style.display = 'block';
                    setTimeout(() => { item.style.opacity = '1'; item.style.transform = 'scale(1)'; }, 10);
                    visibleCount++;
                } else {
                    item.style.opacity = '0';
                    item.style.transform = 'scale(0.9)';
                    setTimeout(() => { item.style.display = 'none'; }, 300);
                }
            });
            
            let noResultsMsg = portfolioGrid ? portfolioGrid.querySelector('.filter-no-results') : null;
            if (visibleCount === 0 && portfolioItems.length > 0) {
                if (!noResultsMsg && portfolioGrid) {
                    noResultsMsg = document.createElement('div');
                    noResultsMsg.className = 'filter-no-results';
                    noResultsMsg.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 60px 20px;';
                    noResultsMsg.innerHTML = '<p style="color: #94a3b8; font-size: 1.1rem; margin: 0;">No items found in this category.</p>';
                    portfolioGrid.appendChild(noResultsMsg);
                }
                if (noResultsMsg) noResultsMsg.style.display = 'block';
            } else if (noResultsMsg) {
                noResultsMsg.style.display = 'none';
            }
        });
    });

    // --- 2. Category Explore (Opens Modal with filtered items) ---
    const exploreButtons = document.querySelectorAll('.explore-btn');
    const productModal = document.getElementById('productGalleryModal');
    const galleryGrid = document.getElementById('productGalleryGrid');

    exploreButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const categoryId = btn.dataset.filter;
            // Find category name from the card
            const card = btn.closest('.category-card');
            const catName = card ? card.querySelector('h3').textContent : 'Items';
            document.getElementById('productGalleryTitle').textContent = catName;
            
            galleryGrid.innerHTML = '';
            
            // Find all items matching this category ID
            const matches = document.querySelectorAll(`.portfolio-item[data-category="${categoryId}"]`);
            
            if (matches.length === 0) {
                galleryGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 40px;">No samples available for this category yet.</p>';
            }

            matches.forEach(item => {
                const isVideo = item.classList.contains('video-type');
                const img = item.querySelector('.portfolio-image img');
                const wrapper = document.createElement('div');
                wrapper.className = 'gallery-item' + (isVideo ? ' video-item' : '');
                
                if (img) {
                    const clone = img.cloneNode();
                    wrapper.appendChild(clone);
                } else if (isVideo) {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'portfolio-video-placeholder';
                    placeholder.innerHTML = '<i class="fas fa-video"></i>';
                    wrapper.appendChild(placeholder);
                }
                
                // Add title
                const title = item.querySelector('.overlay-content h4');
                if (title) {
                    const info = document.createElement('div');
                    info.className = 'gallery-item-info';
                    info.innerHTML = `<h4>${title.textContent}</h4>`;
                    wrapper.appendChild(info);
                }
                
                // Click to open lightbox or video
                wrapper.addEventListener('click', () => {
                    if (isVideo) {
                        const videoBtn = item.querySelector('.play-portfolio-btn');
                        if (videoBtn) videoBtn.click();
                    } else if (img) {
                        openLightbox(img.src, title ? title.textContent : '');
                    }
                });
                
                galleryGrid.appendChild(wrapper);
            });

            productModal.classList.add('active');
            document.body.classList.add('modal-open');
        });
    });

    // --- 3. Lightbox Functionality ---
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImage');

    function openLightbox(src, caption) {
        lightboxImg.src = src;
        document.getElementById('lightboxCaption').textContent = caption || '';
        lightbox.classList.add('active');
    }

    const zoomBtns = document.querySelectorAll('.zoom-btn');
    zoomBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openLightbox(btn.dataset.src, btn.dataset.title);
        });
    });

    // --- 4. Video Play Buttons in Portfolio ---
    const playBtns = document.querySelectorAll('.play-portfolio-btn');
    const videoModal = document.getElementById('videoModal');
    const modalVideo = document.getElementById('modalVideo');

    playBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const videoUrl = btn.dataset.videoUrl;
            if (videoUrl) {
                modalVideo.src = videoUrl;
                videoModal.classList.add('active');
                document.body.classList.add('modal-open');
                modalVideo.play();
            }
        });
    });

    // --- 5. Reels Carousel ---
    initReelsCarousel();

    // --- 6. Global Modal Close Logic ---
    function closeAllModals() {
        document.querySelectorAll('.product-gallery-modal, .lightbox, .video-modal').forEach(m => m.classList.remove('active'));
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        if (modalVideo) { modalVideo.pause(); modalVideo.src = ''; }
    }

    document.querySelectorAll('.product-gallery-close, .lightbox-close, .video-modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('lightbox') || e.target.classList.contains('video-modal')) {
            closeAllModals();
        }
    });

    // --- 7. Like Button Animation ---
    document.querySelectorAll('.like-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            this.classList.toggle('liked');
            this.querySelector('i').style.color = this.classList.contains('liked') ? '#e74c3c' : '';
        });
    });
});

// ============================================
// REELS CAROUSEL FUNCTIONALITY
// ============================================
function initReelsCarousel() {
    const reelsWrapper = document.querySelector('.reels-wrapper');
    const reelsScroll = document.getElementById('reelsScroll');
    let reelCards = document.querySelectorAll('.reel-card');
    
    if (!reelsScroll || reelCards.length === 0) return;
    
    let currentIndex = 0;
    let isDragging = false;
    let startX = 0;
    let currentlyPlaying = null;
    let isLoading = false;
    let allReelsLoaded = false;
    let isLooping = false;
    let isScrolling = false;
    
    let totalReels = parseInt(reelsWrapper.dataset.totalReels) || 0;
    let loadedCount = parseInt(reelsWrapper.dataset.loadedCount) || reelCards.length;
    
    const cardWidth = 300;
    const scrollSpeed = 0.8;
    const scrollCooldown = 600;
    
    function centerCarousel() {
        reelCards = document.querySelectorAll('.reel-card');
        const wrapperWidth = reelsWrapper.offsetWidth;
        const cardCenter = cardWidth / 2;
        const offset = (wrapperWidth / 2) - cardCenter - (currentIndex * cardWidth);
        reelsScroll.style.transition = `transform ${scrollSpeed}s cubic-bezier(0.4, 0.0, 0.2, 1)`;
        reelsScroll.style.transform = `translateX(${offset}px)`;
        updateActiveCard();
        checkAndLoadMore();
    }
    
    function updateActiveCard() {
        reelCards = document.querySelectorAll('.reel-card');
        reelCards.forEach((card, index) => {
            card.classList.remove('active');
            if (index === currentIndex) {
                card.classList.add('active');
                autoPlayCard(card);
            } else {
                pauseCard(card);
            }
        });
    }
    
    function autoPlayCard(card) {
        const video = card.querySelector('.reel-video-player');
        if (video && currentlyPlaying !== video) {
            if (currentlyPlaying) {
                currentlyPlaying.pause();
                currentlyPlaying.closest('.reel-card')?.classList.remove('playing');
            }
            video.currentTime = 0;
            video.play().then(() => {
                card.classList.add('playing');
                currentlyPlaying = video;
            }).catch(() => {
                card.classList.remove('playing');
            });
        }
    }
    
    function pauseCard(card) {
        const video = card.querySelector('.reel-video-player');
        if (video) {
            video.pause();
            card.classList.remove('playing');
            if (currentlyPlaying === video) currentlyPlaying = null;
        }
    }
    
    function nextCard() {
        reelCards = document.querySelectorAll('.reel-card');
        if (currentIndex >= reelCards.length - 1) {
            if (allReelsLoaded || isLooping) { currentIndex = 0; isLooping = true; }
        } else { currentIndex++; }
        centerCarousel();
    }
    
    function prevCard() {
        reelCards = document.querySelectorAll('.reel-card');
        if (currentIndex <= 0) { currentIndex = reelCards.length - 1; }
        else { currentIndex--; }
        centerCarousel();
    }
    
    function checkAndLoadMore() {
        reelCards = document.querySelectorAll('.reel-card');
        if (currentIndex >= reelCards.length - 3 && !isLoading && !allReelsLoaded && loadedCount < totalReels) {
            loadMoreReels();
        }
    }
    
    function loadMoreReels() {
        if (isLoading || allReelsLoaded) return;
        isLoading = true;
        const reelsUrl = reelsWrapper.dataset.reelsUrl || '/api/reels/';
        fetch(`${reelsUrl}?offset=${loadedCount}&limit=10`)
            .then(r => r.json())
            .then(data => {
                if (data.reels && data.reels.length > 0) {
                    data.reels.forEach((reel, idx) => {
                        const card = createReelCard(reel, loadedCount + idx);
                        reelsScroll.appendChild(card);
                    });
                    loadedCount += data.reels.length;
                    reelsWrapper.dataset.loadedCount = loadedCount;
                    reelCards = document.querySelectorAll('.reel-card');
                    setupReelCardEvents();
                }
                if (!data.has_more) allReelsLoaded = true;
                isLoading = false;
            })
            .catch(() => { isLoading = false; });
    }
    
    function createReelCard(reel, index) {
        const card = document.createElement('div');
        card.className = 'reel-card';
        card.dataset.index = index;
        card.dataset.reelId = reel.id;
        // Escape helper to prevent XSS from dynamic content
        function esc(str) {
            const d = document.createElement('div');
            d.textContent = str || '';
            return d.innerHTML;
        }
        let mediaContent = '';
        if (reel.video_url) {
            mediaContent = `<video class="reel-video-player" muted playsinline loop preload="metadata" ${reel.thumbnail ? `poster="${esc(reel.thumbnail)}"` : ''}><source src="${esc(reel.video_url)}" type="video/mp4"></video>`;
        } else if (reel.thumbnail) {
            mediaContent = `<img src="${esc(reel.thumbnail)}" alt="${esc(reel.title)}" class="reel-thumbnail">`;
        } else {
            mediaContent = `<div class="reel-placeholder"></div>`;
        }
        card.innerHTML = `
            <div class="reel-video">
                ${mediaContent}
                <div class="reel-play-overlay"><button class="play-reel-btn"><i class="fas fa-play"></i></button></div>
                <div class="reel-info">
                    <span class="reel-views"><i class="fas fa-eye"></i> ${parseInt(reel.views_count) || 0}</span>
                    <span class="reel-likes"><i class="fas fa-heart"></i> ${parseInt(reel.likes_count) || 0}</span>
                </div>
            </div>
            <div class="reel-content"><h4>${esc(reel.title)}</h4><p>${esc(reel.description)}</p></div>
        `;
        return card;
    }
    
    function setupReelCardEvents() {
        reelCards = document.querySelectorAll('.reel-card');
        reelCards.forEach((card, index) => {
            const playBtn = card.querySelector('.play-reel-btn');
            const video = card.querySelector('.reel-video-player');
            if (playBtn && video) {
                const newBtn = playBtn.cloneNode(true);
                playBtn.parentNode.replaceChild(newBtn, playBtn);
                newBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (video.paused) {
                        if (currentIndex !== index) { currentIndex = index; centerCarousel(); }
                        else { video.play().then(() => { card.classList.add('playing'); currentlyPlaying = video; }); }
                    } else { video.pause(); card.classList.remove('playing'); }
                });
            }
            if (video) {
                video.removeEventListener('ended', handleVideoEnded);
                video.addEventListener('ended', handleVideoEnded);
            }
        });
    }
    
    function handleVideoEnded() { nextCard(); }
    
    // Scroll wheel
    reelsWrapper.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (isScrolling) return;
        isScrolling = true;
        if (e.deltaY < 0) nextCard(); else if (e.deltaY > 0) prevCard();
        setTimeout(() => { isScrolling = false; }, scrollCooldown);
    }, { passive: false });
    
    // Mouse drag
    reelsScroll.addEventListener('mousedown', (e) => { isDragging = true; startX = e.pageX; reelsScroll.classList.add('is-dragging'); });
    reelsScroll.addEventListener('mousemove', (e) => {
        if (!isDragging) return; e.preventDefault();
        const diff = startX - e.pageX;
        if (Math.abs(diff) > 50) { diff > 0 ? nextCard() : prevCard(); isDragging = false; reelsScroll.classList.remove('is-dragging'); }
    });
    reelsScroll.addEventListener('mouseup', () => { isDragging = false; reelsScroll.classList.remove('is-dragging'); });
    reelsScroll.addEventListener('mouseleave', () => { isDragging = false; reelsScroll.classList.remove('is-dragging'); });
    
    // Touch events
    let touchStartX = 0;
    reelsWrapper.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    reelsWrapper.addEventListener('touchmove', (e) => { if (Math.abs(touchStartX - e.touches[0].clientX) > 10) e.preventDefault(); }, { passive: false });
    reelsWrapper.addEventListener('touchend', (e) => {
        const diff = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 50) { diff > 0 ? nextCard() : prevCard(); }
    }, { passive: true });
    
    setupReelCardEvents();
    
    document.addEventListener('keydown', (e) => {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
        const rect = reelsWrapper.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
            if (e.key === 'ArrowRight') nextCard();
            else if (e.key === 'ArrowLeft') prevCard();
        }
    });
    
    window.addEventListener('load', () => centerCarousel());
    window.addEventListener('resize', () => centerCarousel());
    setTimeout(centerCarousel, 100);
}

/**
 * Initialize Category Card Background Images
 * Shows first image from each category as card cover
 */
function initCategoryBackgrounds() {
    const dataElement = document.getElementById('categoryImagesData');
    if (!dataElement) return;
    
    try {
        const categoryImages = JSON.parse(dataElement.textContent);
        const categoryCards = document.querySelectorAll('.category-card');
        
        categoryCards.forEach(card => {
            const catId = card.dataset.category;
            const imageUrl = categoryImages[catId];
            
            if (imageUrl) {
                const bgImg = card.querySelector('.category-bg-img');
                if (bgImg) {
                    bgImg.src = imageUrl;
                    // Hide placeholder when image loads
                    bgImg.onload = function() {
                        const placeholder = card.querySelector('.bg-placeholder');
                        if (placeholder) placeholder.style.display = 'none';
                    };
                }
            }
        });
    } catch (e) {
        console.warn('Could not parse category images data:', e);
    }
}
