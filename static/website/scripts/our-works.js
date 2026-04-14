/**
 * Adarsh ID Cards - Our Works Logic (v3)
 * Handles Filtering, Lightbox, Category Exploration, Video Playback, Share
 */

document.addEventListener('DOMContentLoaded', function() {
    
    // --- Load Category Background Images ---
    initCategoryBackgrounds();
    
    // --- 1. Portfolio Filtering + Lazy Batch Rendering ---
    const filterTabs = document.querySelectorAll('.filter-tab');
    const portfolioItems = Array.from(document.querySelectorAll('.portfolio-item'));
    const portfolioGrid = document.getElementById('portfolioGrid');
    const skeletonWrap = document.getElementById('portfolioLoadSkeleton');
    const loadSentinel = document.getElementById('portfolioLoadSentinel');
    const galleryGrid = document.getElementById('productGalleryGrid');
    const gallerySkeleton = document.getElementById('productGallerySkeleton');
    const PORTFOLIO_BATCH_SIZE = 20;
    let currentFilter = 'all';
    let filteredItems = [];
    let renderedCount = 0;
    let isBatchLoading = false;
    let batchObserver = null;

    function setSkeletonVisible(visible) {
        if (!skeletonWrap) return;
        skeletonWrap.hidden = !visible;
    }

    function setGallerySkeletonVisible(visible) {
        if (gallerySkeleton) {
            gallerySkeleton.hidden = !visible;
        }
        if (galleryGrid) {
            galleryGrid.hidden = visible;
        }
    }

    function applyLazyImageAttrs(img, isPriority) {
        if (!img) return;
        img.loading = isPriority ? 'eager' : 'lazy';
        img.decoding = 'async';
        img.setAttribute('fetchpriority', isPriority ? 'high' : 'low');
    }

    function getNoResultMessage() {
        if (!portfolioGrid) return null;
        let msg = portfolioGrid.querySelector('.filter-no-results');
        if (!msg) {
            msg = document.createElement('div');
            msg.className = 'filter-no-results';
            msg.style.cssText = 'column-span: all; text-align: center; padding: 60px 20px; width: 100%; display:none;';
            msg.innerHTML = '<p style="color: #94a3b8; font-size: 1.1rem; margin: 0;">No items found in this category.</p>';
            portfolioGrid.appendChild(msg);
        }
        return msg;
    }

    function hideAllPortfolioItems() {
        portfolioItems.forEach((item) => {
            item.style.opacity = '0';
            item.style.transform = 'scale(0.98)';
            item.style.display = 'none';
        });
    }

    function getFilteredItems(filter) {
        if (filter === 'all') return portfolioItems;
        return portfolioItems.filter((item) => item.dataset.category === filter);
    }

    function updateSentinelState() {
        if (!loadSentinel) return;
        const hasMore = renderedCount < filteredItems.length;
        loadSentinel.style.display = hasMore ? 'block' : 'none';
    }

    function renderPortfolioBatch() {
        if (isBatchLoading) return;
        if (renderedCount >= filteredItems.length) {
            updateSentinelState();
            return;
        }

        isBatchLoading = true;
        setSkeletonVisible(true);

        window.setTimeout(() => {
            const nextItems = filteredItems.slice(renderedCount, renderedCount + PORTFOLIO_BATCH_SIZE);
            nextItems.forEach((item) => {
                item.style.display = 'block';
                window.setTimeout(() => {
                    item.style.opacity = '1';
                    item.style.transform = 'scale(1)';
                }, 16);
            });
            renderedCount += nextItems.length;
            isBatchLoading = false;
            setSkeletonVisible(false);
            updateSentinelState();
        }, 240);
    }

    function applyPortfolioFilter(filter) {
        currentFilter = filter;
        filteredItems = getFilteredItems(filter);
        renderedCount = 0;

        hideAllPortfolioItems();
        updateSentinelState();

        const noResultsMsg = getNoResultMessage();
        if (noResultsMsg) {
            noResultsMsg.style.display = filteredItems.length === 0 ? 'block' : 'none';
        }

        if (filteredItems.length > 0) {
            renderPortfolioBatch();
        } else {
            setSkeletonVisible(false);
        }
    }

    if (loadSentinel && 'IntersectionObserver' in window) {
        batchObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    renderPortfolioBatch();
                }
            });
        }, { root: null, rootMargin: '250px 0px 250px 0px', threshold: 0.01 });
        batchObserver.observe(loadSentinel);
    } else {
        window.addEventListener('scroll', () => {
            if (!loadSentinel) return;
            const rect = loadSentinel.getBoundingClientRect();
            if (rect.top <= (window.innerHeight + 250)) {
                renderPortfolioBatch();
            }
        }, { passive: true });
    }

    filterTabs.forEach((tab) => {
        tab.addEventListener('click', function() {
            const filter = this.dataset.filter;
            filterTabs.forEach((t) => t.classList.remove('active'));
            this.classList.add('active');
            applyPortfolioFilter(filter);
        });
    });

    applyPortfolioFilter(currentFilter);

    // --- 2. Category Explore (Opens Modal with filtered items — images + videos) ---
    const exploreButtons = document.querySelectorAll('.explore-btn');
    const productModal = document.getElementById('productGalleryModal');
    
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
            productModal.classList.add('active');
            document.body.classList.add('modal-open');

            galleryGrid.innerHTML = '';
            setGallerySkeletonVisible(true);

            window.setTimeout(() => {
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
                            applyLazyImageAttrs(img, index === 0);
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

                            function updatePlayOverlay() {
                                wrapper.classList.toggle('is-playing', isPlaying);
                                playBtn.innerHTML = isPlaying
                                    ? '<i class="fas fa-pause"></i>'
                                    : '<i class="fas fa-play"></i>';
                            }

                            function togglePlay(e) {
                                e.stopPropagation();
                                if (isPlaying) {
                                    video.pause();
                                    isPlaying = false;
                                    updatePlayOverlay();
                                } else {
                                    wrapper.classList.remove('is-previewing');
                                    video.muted = false;
                                    video.play().then(() => {
                                        isPlaying = true;
                                        updatePlayOverlay();
                                    }).catch(() => {});
                                }
                            }
                            playBtn.addEventListener('click', togglePlay);
                            video.addEventListener('click', togglePlay);

                            video.addEventListener('play', () => {
                                if (!video.muted) {
                                    isPlaying = true;
                                    updatePlayOverlay();
                                }
                            });

                            video.addEventListener('pause', () => {
                                if (isPlaying) {
                                    isPlaying = false;
                                    updatePlayOverlay();
                                }
                            });

                            video.addEventListener('ended', () => {
                                isPlaying = false;
                                updatePlayOverlay();
                            });

                            // Autoplay on hover (muted)
                            wrapper.addEventListener('mouseenter', () => {
                                if (!isPlaying) {
                                    wrapper.classList.add('is-previewing');
                                    video.muted = true;
                                    video.play().catch(() => {
                                        wrapper.classList.remove('is-previewing');
                                    });
                                }
                            });
                            wrapper.addEventListener('mouseleave', () => {
                                if (!isPlaying) {
                                    wrapper.classList.remove('is-previewing');
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
                            applyLazyImageAttrs(img, index < 2);
                            wrapper.appendChild(img);
                            const _imgIdx = _imgIndexMap.has(item) ? _imgIndexMap.get(item) : 0;
                            wrapper.addEventListener('click', () => openLightboxAt(_imgList, _imgIdx));
                        }

                        galleryGrid.appendChild(wrapper);
                    });
                }

                setGallerySkeletonVisible(false);
            }, 160);
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
    function normalizeHashText(value) {
        return (value || '')
            .toLowerCase()
            .replace(/[-_]+/g, ' ')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function resolveCategoryTargetBySlug(slug) {
        const normalizedSlug = normalizeHashText(slug);
        if (!normalizedSlug) return null;

        const exactCard = document.querySelector('.category-card[data-slug="' + slug + '"]');
        const exactExtra = document.querySelector('.extra-category-tag[data-slug="' + slug + '"]');
        if (exactCard) return exactCard.querySelector('.explore-btn');
        if (exactExtra) return exactExtra;

        const allCategories = document.querySelectorAll('.category-card, .extra-category-tag');
        let bestNode = null;
        let bestScore = 0;

        allCategories.forEach((node) => {
            const nodeSlug = normalizeHashText(node.dataset.slug || '');
            const nodeLabelEl = node.classList.contains('category-card')
                ? node.querySelector('h3')
                : node.querySelector('span');
            const nodeLabel = normalizeHashText(nodeLabelEl ? nodeLabelEl.textContent : '');
            const haystack = (nodeSlug + ' ' + nodeLabel).trim();
            if (!haystack) return;

            let score = 0;
            if (haystack === normalizedSlug) {
                score = 100;
            } else if (haystack.includes(normalizedSlug)) {
                score = 80 + normalizedSlug.length;
            } else if (normalizedSlug.includes(nodeSlug) && nodeSlug.length > 2) {
                score = 50 + nodeSlug.length;
            }

            if (score > bestScore) {
                bestScore = score;
                bestNode = node;
            }
        });

        if (!bestNode) return null;
        return bestNode.classList.contains('category-card') ? bestNode.querySelector('.explore-btn') : bestNode;
    }

    function resolveCategoryTargetByExpertise(expertiseKey) {
        const normalizedKey = normalizeHashText(decodeURIComponent(expertiseKey || ''));
        if (!normalizedKey) return null;

        const expertiseAliasMap = {
            'school id cards': ['school id cards', 'school id', 'id cards'],
            'staff identity cards': ['staff identity cards', 'staff id', 'employee id'],
            'digital lanyards': ['digital lanyards', 'lanyard'],
            'printed marksheets': ['printed marksheets', 'marksheet', 'report card'],
            'certificate design': ['certificate design', 'certificate'],
            'rfid integration': ['rfid integration', 'rfid', 'smart card']
        };

        const lookupTerms = (expertiseAliasMap[normalizedKey] || [normalizedKey]).map(normalizeHashText);
        const allCategories = document.querySelectorAll('.category-card, .extra-category-tag');
        let bestNode = null;
        let bestScore = 0;

        allCategories.forEach((node) => {
            const nodeSlug = normalizeHashText(node.dataset.slug || '');
            const nodeLabelEl = node.classList.contains('category-card')
                ? node.querySelector('h3')
                : node.querySelector('span');
            const nodeLabel = normalizeHashText(nodeLabelEl ? nodeLabelEl.textContent : '');
            const haystack = (nodeSlug + ' ' + nodeLabel).trim();
            if (!haystack) return;

            let score = 0;
            lookupTerms.forEach((term) => {
                if (!term) return;
                if (haystack === term) {
                    score = Math.max(score, 100);
                } else if (haystack.includes(term)) {
                    score = Math.max(score, 80 + term.length);
                } else if (term.includes(nodeSlug) && nodeSlug.length > 2) {
                    score = Math.max(score, 50 + nodeSlug.length);
                }
            });

            if (score > bestScore) {
                bestScore = score;
                bestNode = node;
            }
        });

        if (!bestNode) return null;
        return bestNode.classList.contains('category-card') ? bestNode.querySelector('.explore-btn') : bestNode;
    }

    function openTargetWithDelay(target) {
        if (!target) return false;
        setTimeout(() => target.click(), 500);
        return true;
    }

    function checkHashAndOpen() {
        const hash = window.location.hash || '';
        if (hash.startsWith('#category=')) {
            const slug = decodeURIComponent(hash.replace('#category=', ''));
            if (openTargetWithDelay(resolveCategoryTargetBySlug(slug))) return;
        }
        if (hash.startsWith('#expertise=')) {
            const expertiseKey = hash.replace('#expertise=', '');
            openTargetWithDelay(resolveCategoryTargetByExpertise(expertiseKey));
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
        setGallerySkeletonVisible(false);
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
                    img.decoding = 'async';
                    img.setAttribute('fetchpriority', index === 0 ? 'high' : 'low');
                    if (index === 0) img.classList.add('active');
                    slider.appendChild(img);
                });

                // Start auto-rotation if multiple images
                if (displayImages.length > 1) {
                    let currentIndex = 0;
                    let isPaused = false;
                    const rotateInterval = setInterval(() => {
                        if (isPaused) return;
                        const imgs = slider.querySelectorAll('.slider-img');
                        imgs[currentIndex].classList.remove('active');
                        currentIndex = (currentIndex + 1) % imgs.length;
                        imgs[currentIndex].classList.add('active');
                    }, 3000); // 3 seconds per image

                    card.addEventListener('mouseenter', () => {
                        isPaused = true;
                    });
                    card.addEventListener('mouseleave', () => {
                        isPaused = false;
                    });
                    card.dataset.sliderIntervalActive = String(Boolean(rotateInterval));
                }
            }
        });
    } catch (e) {
        console.warn('Could not parse category images data:', e);
    }
}
