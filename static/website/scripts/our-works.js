/**
 * Adarsh ID Cards - Our Works Logic (v3)
 * Handles Filtering, Lightbox, Category Exploration, Video Playback, Share
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

    // --- 2. Category Explore (Opens Modal with filtered items — images + videos) ---
    const exploreButtons = document.querySelectorAll('.explore-btn');
    const productModal = document.getElementById('productGalleryModal');
    const galleryGrid = document.getElementById('productGalleryGrid');
    
    // Get category images data for bento backgrounds
    let categoryImagesForModal = {};
    const dataEl = document.getElementById('categoryImagesData');
    if (dataEl) {
        try { categoryImagesForModal = JSON.parse(dataEl.textContent); } catch (e) {}
    }

    // Get category items data (images + videos with orientation)
    let categoryItemsData = {};
    const itemsDataEl = document.getElementById('categoryItemsData');
    if (itemsDataEl) {
        try { categoryItemsData = JSON.parse(itemsDataEl.textContent); } catch (e) {}
    }

    // Track current category for share
    let currentGalleryCategorySlug = '';

    exploreButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const categoryId = btn.dataset.filter;
            const card = btn.closest('.category-card');
            const extraTag = btn.closest('.extra-category-tag');
            let catName = 'Items';
            let catSlug = '';
            if (card) {
                catName = card.querySelector('h3').textContent;
                catSlug = card.dataset.slug || '';
            } else if (extraTag) {
                catName = extraTag.querySelector('span')?.textContent || 'Items';
                catSlug = extraTag.dataset.slug || '';
            }
            document.getElementById('productGalleryTitle').textContent = catName;
            currentGalleryCategorySlug = catSlug;
            
            galleryGrid.innerHTML = '';
            
            // Use rich items data (with images + videos)
            const catItems = categoryItemsData[categoryId] || [];
            
            if (catItems.length === 0) {
                // Fallback: use image-only data
                const fallbackImages = categoryImagesForModal[categoryId] || [];
                if (fallbackImages.length === 0) {
                    galleryGrid.innerHTML = '<p style="text-align: center; padding: 60px 20px; color: #666;">No samples available for this category yet.</p>';
                } else {
                    fallbackImages.forEach((imgUrl, index) => {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'gallery-item';
                        const img = document.createElement('img');
                        img.src = imgUrl;
                        img.alt = catName + ' Sample ' + (index + 1);
                        img.loading = 'lazy';
                        wrapper.appendChild(img);
                        wrapper.addEventListener('click', () => openLightbox(imgUrl, catName + ' Sample'));
                        galleryGrid.appendChild(wrapper);
                    });
                }
            } else {
                catItems.forEach((item, index) => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'gallery-item';
                    if (item.type === 'video') wrapper.classList.add('video-item');

                    if (item.type === 'video' && item.video) {
                        // Video item — inline playback
                        const video = document.createElement('video');
                        video.src = item.video;
                        video.muted = true;
                        video.loop = true;
                        video.playsInline = true;
                        video.preload = 'metadata';
                        if (item.image) video.poster = item.image;
                        video.setAttribute('playsinline', '');

                        // Play/pause overlay
                        const playOverlay = document.createElement('div');
                        playOverlay.className = 'gallery-video-overlay';
                        playOverlay.innerHTML = '<button class="gallery-play-btn"><i class="fas fa-play"></i></button>';
                        
                        let isPlaying = false;
                        const playBtn = playOverlay.querySelector('.gallery-play-btn');

                        function togglePlay(e) {
                            e.stopPropagation();
                            if (isPlaying) {
                                video.pause();
                                playBtn.innerHTML = '<i class="fas fa-play"></i>';
                                isPlaying = false;
                            } else {
                                video.muted = false;
                                video.play().then(() => {
                                    playBtn.innerHTML = '<i class="fas fa-pause"></i>';
                                    isPlaying = true;
                                }).catch(() => {});
                            }
                        }
                        playBtn.addEventListener('click', togglePlay);

                        // Autoplay on hover (muted)
                        wrapper.addEventListener('mouseenter', () => {
                            if (!isPlaying) {
                                video.muted = true;
                                video.play().catch(() => {});
                            }
                        });
                        wrapper.addEventListener('mouseleave', () => {
                            if (!isPlaying) {
                                video.pause();
                                video.currentTime = 0;
                            }
                        });

                        wrapper.appendChild(video);
                        wrapper.appendChild(playOverlay);
                    } else if (item.image) {
                        // Image item
                        const img = document.createElement('img');
                        img.src = item.image;
                        img.alt = item.title || (catName + ' Sample ' + (index + 1));
                        img.loading = 'lazy';
                        wrapper.appendChild(img);
                        wrapper.addEventListener('click', () => openLightbox(item.image, item.title || catName));
                    }

                    galleryGrid.appendChild(wrapper);
                });
            }

            productModal.classList.add('active');
            document.body.classList.add('modal-open');
        });
    });

    // --- Share Button ---
    const shareBtn = document.getElementById('productGalleryShare');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            const url = window.location.origin + window.location.pathname + '#category=' + currentGalleryCategorySlug;
            navigator.clipboard.writeText(url).then(() => {
                const icon = shareBtn.querySelector('i');
                icon.className = 'fas fa-check';
                shareBtn.title = 'Copied!';
                setTimeout(() => {
                    icon.className = 'fas fa-share-alt';
                    shareBtn.title = 'Copy link to this gallery';
                }, 2000);
            }).catch(() => {
                // Fallback
                const inp = document.createElement('input');
                inp.value = url;
                document.body.appendChild(inp);
                inp.select();
                document.execCommand('copy');
                document.body.removeChild(inp);
            });
        });
    }

    // --- Open gallery from URL hash ---
    function checkHashAndOpen() {
        const hash = window.location.hash;
        if (hash.startsWith('#category=')) {
            const slug = hash.replace('#category=', '');
            if (slug) {
                const card = document.querySelector('.category-card[data-slug="' + slug + '"]');
                const extraTag = document.querySelector('.extra-category-tag[data-slug="' + slug + '"]');
                const target = card ? card.querySelector('.explore-btn') : extraTag;
                if (target) setTimeout(() => target.click(), 500);
            }
        }
    }
    checkHashAndOpen();

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
        // Pause all gallery videos
        document.querySelectorAll('#productGalleryGrid video').forEach(v => { v.pause(); v.muted = true; });
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
        const videoSrc = reel.video_file || reel.video_url;
        if (videoSrc) {
            mediaContent = `<video class="reel-video-player" muted playsinline loop preload="metadata" ${reel.thumbnail ? `poster="${esc(reel.thumbnail)}"` : ''}><source src="${esc(videoSrc)}" type="video/mp4"></video>`;
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
                    // Open video in modal for fullscreen playback
                    const videoSrc = video.querySelector('source')?.src || video.src;
                    if (videoSrc) {
                        const videoModal = document.getElementById('videoModal');
                        const modalVideo = document.getElementById('modalVideo');
                        if (videoModal && modalVideo) {
                            modalVideo.src = videoSrc;
                            videoModal.classList.add('active');
                            document.body.classList.add('modal-open');
                            modalVideo.play();
                        }
                    }
                });
            } else if (playBtn) {
                // For reel cards without video (just thumbnail)
                const newBtn = playBtn.cloneNode(true);
                playBtn.parentNode.replaceChild(newBtn, playBtn);
                // No action for thumbnail-only cards
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
 * Initialize Category Card Background Images with Fade Carousel
 * Shows one image at a time, stays for 3 seconds, then fades to the next.
 * Top 10 images rotate per card.
 */
function initCategoryBackgrounds() {
    const dataElement = document.getElementById('categoryImagesData');
    if (!dataElement) return;
    
    try {
        const categoryImages = JSON.parse(dataElement.textContent);
        const categoryCards = document.querySelectorAll('.category-card');
        
        categoryCards.forEach(card => {
            const catId = card.dataset.category;
            const images = categoryImages[catId];
            const slider = card.querySelector('.category-slider');
            
            if (!slider) return;
            
            if (images && images.length > 0) {
                // Hide placeholder
                const placeholder = card.querySelector('.bg-placeholder');
                if (placeholder) placeholder.style.display = 'none';
                
                // Use top 10 images max
                const displayImages = images.slice(0, 10);
                
                // Create image elements directly inside slider
                displayImages.forEach((url, index) => {
                    const img = document.createElement('img');
                    img.src = url;
                    img.alt = `Sample ${index + 1}`;
                    img.className = 'slider-img';
                    img.loading = index === 0 ? 'eager' : 'lazy';
                    if (index === 0) img.classList.add('active');
                    slider.appendChild(img);
                });

                // Start auto-rotation if multiple images
                if (displayImages.length > 1) {
                    let currentIndex = 0;
                    setInterval(() => {
                        const imgs = slider.querySelectorAll('.slider-img');
                        imgs[currentIndex].classList.remove('active');
                        currentIndex = (currentIndex + 1) % imgs.length;
                        imgs[currentIndex].classList.add('active');
                    }, 3000); // 3 seconds per image
                }
            }
        });
    } catch (e) {
        console.warn('Could not parse category images data:', e);
    }
}
