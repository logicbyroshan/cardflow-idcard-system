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
                    noResultsMsg.style.cssText = 'column-span: all; text-align: center; padding: 60px 20px; width: 100%;';
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
                    const _fbList = fallbackImages.map((u, i) => ({src: u, title: catName + ' Sample ' + (i + 1)}));
                    fallbackImages.forEach((imgUrl, index) => {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'gallery-item';
                        const img = document.createElement('img');
                        img.src = imgUrl;
                        img.alt = catName + ' Sample ' + (index + 1);
                        img.loading = 'lazy';
                        wrapper.appendChild(img);
                        wrapper.addEventListener('click', () => openLightboxAt(_fbList, index));
                        galleryGrid.appendChild(wrapper);
                    });
                }
            } else {
                // Build image-only list for lightbox slideshow
                const _imgOnlyItems = catItems.filter(i => i.image && i.type !== 'video' && i.type !== 'reel');
                const _imgList = _imgOnlyItems.map(i => ({src: i.image, title: i.title || catName}));
                // B4: O(1) index lookup instead of O(n) indexOf inside forEach
                const _imgIndexMap = new Map(_imgOnlyItems.map((itm, idx) => [itm, idx]));

                catItems.forEach((item, index) => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'gallery-item';
                    if (item.type === 'video') wrapper.classList.add('video-item');
                    if (item.type === 'reel') wrapper.classList.add('video-item', 'reel-item');

                    if ((item.type === 'video' || item.type === 'reel') && item.video) {
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
                        const _imgIdx = _imgIndexMap.has(item) ? _imgIndexMap.get(item) : 0;
                        wrapper.addEventListener('click', () => openLightboxAt(_imgList, _imgIdx));
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
    const lightboxPrev = document.getElementById('lightboxPrev');
    const lightboxNext = document.getElementById('lightboxNext');
    const lightboxCounter = document.getElementById('lightboxCounter');

    // Slideshow state
    let _lbImages = [];   // [{src, title}, ...]
    let _lbIndex  = 0;

    function _updateLightboxSlide() {
        const item = _lbImages[_lbIndex];
        if (!item) return;
        lightboxImg.src = item.src;
        document.getElementById('lightboxCaption').textContent = item.title || '';
        if (_lbImages.length > 1) {
            lightboxCounter.textContent = (_lbIndex + 1) + ' / ' + _lbImages.length;
            lightboxCounter.style.display = 'block';
            lightboxPrev.style.display = 'flex';
            lightboxNext.style.display = 'flex';
        } else {
            lightboxCounter.style.display = 'none';
            lightboxPrev.style.display  = 'none';
            lightboxNext.style.display  = 'none';
        }
    }

    function openLightboxAt(images, index) {
        _lbImages = images || [];
        _lbIndex  = Math.max(0, Math.min(index, _lbImages.length - 1));
        _updateLightboxSlide();
        lightbox.classList.add('active');
    }

    function openLightbox(src, caption) {
        openLightboxAt([{src: src, title: caption || ''}], 0);
    }

    lightboxPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_lbImages.length < 2) return;
        _lbIndex = (_lbIndex - 1 + _lbImages.length) % _lbImages.length;
        _updateLightboxSlide();
    });

    lightboxNext.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_lbImages.length < 2) return;
        _lbIndex = (_lbIndex + 1) % _lbImages.length;
        _updateLightboxSlide();
    });

    // Touch / swipe support
    (function() {
        let _touchStartX = null;
        lightbox.addEventListener('touchstart', (e) => { _touchStartX = e.touches[0].clientX; }, {passive: true});
        lightbox.addEventListener('touchend', (e) => {
            if (_touchStartX === null) return;
            const dx = e.changedTouches[0].clientX - _touchStartX;
            _touchStartX = null;
            if (Math.abs(dx) < 40) return;
            if (dx < 0) lightboxNext.click();
            else        lightboxPrev.click();
        }, {passive: true});
    })();

    // Click on any portfolio item opens lightbox (image) or plays video
    document.querySelectorAll('.portfolio-item').forEach(item => {
        function handleActivation() {
            const videoUrl = item.dataset.videoUrl;
            if (videoUrl) {
                // Video item — play inline
                const portfolioImage = item.querySelector('.portfolio-image');
                let inlineVideo = portfolioImage.querySelector('.inline-portfolio-video');
                if (inlineVideo) {
                    if (inlineVideo.paused) { inlineVideo.play(); item.classList.add('playing'); }
                    else { inlineVideo.pause(); item.classList.remove('playing'); }
                    return;
                }
                inlineVideo = document.createElement('video');
                inlineVideo.className = 'inline-portfolio-video';
                inlineVideo.src = videoUrl;
                inlineVideo.controls = true;
                inlineVideo.autoplay = true;
                inlineVideo.playsInline = true;
                inlineVideo.style.cssText = 'width:100%;height:auto;display:block;position:relative;z-index:4;border-radius:14px;';
                const img = portfolioImage.querySelector('img');
                const playIcon = portfolioImage.querySelector('.portfolio-play-icon');
                if (img) img.style.display = 'none';
                if (playIcon) playIcon.style.display = 'none';
                portfolioImage.insertBefore(inlineVideo, portfolioImage.firstChild);
                item.classList.add('playing');
                inlineVideo.addEventListener('ended', () => item.classList.remove('playing'));
                inlineVideo.addEventListener('pause', () => item.classList.remove('playing'));
                inlineVideo.addEventListener('play', () => item.classList.add('playing'));
                return;
            }
            const src = item.dataset.src;
            if (src) {
                // Collect all currently-visible image portfolio items for slideshow
                const _visibleImgItems = Array.from(document.querySelectorAll('.portfolio-item'))
                    .filter(el => el.style.display !== 'none' && el.dataset.src && !el.dataset.videoUrl);
                const _pList = _visibleImgItems.map(el => ({src: el.dataset.src, title: el.dataset.title || ''}));
                const _pIdx  = _visibleImgItems.indexOf(item);
                openLightboxAt(_pList, Math.max(0, _pIdx));
            }
        }
        item.addEventListener('click', handleActivation);
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleActivation(); }
        });
    });

    // Video modal references (kept for close logic)
    const videoModal = document.getElementById('videoModal');
    const modalVideo = document.getElementById('modalVideo');

    // --- 5. Global Modal Close Logic ---
    // Save scroll position when opening modals
    let savedScrollPosition = 0;

    function closeGalleryModal() {
        productModal.classList.remove('active');
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        // Restore scroll position
        window.scrollTo(0, savedScrollPosition);
        // Pause all gallery videos
        document.querySelectorAll('#productGalleryGrid video').forEach(v => { v.pause(); v.muted = true; });
    }

    function closeLightbox() {
        lightbox.classList.remove('active');
        lightboxImg.src = '';
        _lbImages = [];
        _lbIndex  = 0;
        // Don't touch body overflow if gallery modal is still open
        if (!productModal.classList.contains('active')) {
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        }
    }

    function closeVideoModal() {
        videoModal.classList.remove('active');
        if (modalVideo) { modalVideo.pause(); modalVideo.src = ''; }
        if (!productModal.classList.contains('active')) {
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        }
    }

    // Save scroll when opening gallery
    exploreButtons.forEach(btn => {
        const origClick = btn.onclick;
        btn.addEventListener('click', () => {
            savedScrollPosition = window.scrollY || window.pageYOffset;
        }, true); // capture phase, before the main handler
    });

    // Close buttons
    document.getElementById('productGalleryClose').addEventListener('click', closeGalleryModal);
    document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
    const videoCloseBtn = document.getElementById('videoModalClose');
    if (videoCloseBtn) videoCloseBtn.addEventListener('click', closeVideoModal);

    // Prevent accidental modal close by backdrop clicks.
    productModal.addEventListener('click', (e) => {
        if (e.target === productModal) {
            e.stopPropagation();
        }
    });

    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });

    if (videoModal) {
        videoModal.addEventListener('click', (e) => {
            if (e.target === videoModal) closeVideoModal();
        });
    }

    // ESC key handling - close topmost modal first; arrow keys navigate lightbox
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (lightbox.classList.contains('active')) {
                closeLightbox();
            } else if (videoModal && videoModal.classList.contains('active')) {
                closeVideoModal();
            }
        } else if (lightbox.classList.contains('active')) {
            if (e.key === 'ArrowLeft')  { e.preventDefault(); lightboxPrev.click(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); lightboxNext.click(); }
        }
    });
});

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
