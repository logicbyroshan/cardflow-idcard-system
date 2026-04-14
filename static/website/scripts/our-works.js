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

    function formatTimeSeconds(totalSeconds) {
        const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
        const mins = Math.floor(safeSeconds / 60);
        const secs = safeSeconds % 60;
        return mins + ':' + String(secs).padStart(2, '0');
    }

    function isHlsSource(url) {
        return Boolean(url && /\.m3u8(?:\?|$)/i.test(url));
    }

    function canPlayNativeHls(videoEl) {
        const probe = videoEl || document.createElement('video');
        if (!probe || typeof probe.canPlayType !== 'function') return false;
        const mimeResult = probe.canPlayType('application/vnd.apple.mpegurl');
        const extResult = probe.canPlayType('application/x-mpegURL');
        return Boolean(mimeResult || extResult);
    }

    function pickVideoSource(videoEl, primaryUrl, fallbackUrl) {
        const primary = primaryUrl || '';
        const fallback = fallbackUrl || '';
        if (!primary) return fallback;
        if (!isHlsSource(primary)) return primary;
        if (canPlayNativeHls(videoEl)) return primary;
        return fallback || primary;
    }

    function pauseManagedVideos(exceptVideo) {
        const managed = document.querySelectorAll('video[data-managed-video="1"]');
        managed.forEach((videoEl) => {
            if (videoEl === exceptVideo) return;
            try { videoEl.pause(); } catch (_) {}
        });

        document.querySelectorAll('.gallery-item.video-item.is-playing').forEach((item) => {
            if (!exceptVideo || !item.contains(exceptVideo)) item.classList.remove('is-playing');
        });
        document.querySelectorAll('.gallery-item.video-item.is-previewing').forEach((item) => {
            if (!exceptVideo || !item.contains(exceptVideo)) item.classList.remove('is-previewing');
        });
        document.querySelectorAll('.portfolio-item.playing').forEach((item) => {
            if (!exceptVideo || !item.contains(exceptVideo)) item.classList.remove('playing');
        });
    }

    function markGalleryItemReady(wrapper) {
        if (!wrapper) return;
        wrapper.classList.remove('media-pending');
        wrapper.classList.add('media-ready');
    }

    function waitForSingleMediaElement(mediaEl, wrapper, timeoutMs) {
        return new Promise((resolve) => {
            let done = false;

            function settle() {
                if (done) return;
                done = true;
                if (wrapper) markGalleryItemReady(wrapper);
                resolve();
            }

            if (!mediaEl) {
                settle();
                return;
            }

            const tag = mediaEl.tagName;
            if (tag === 'IMG') {
                if (mediaEl.complete && mediaEl.naturalWidth > 0) {
                    settle();
                    return;
                }
                mediaEl.addEventListener('load', settle, { once: true });
                mediaEl.addEventListener('error', settle, { once: true });
            } else if (tag === 'VIDEO') {
                if (mediaEl.readyState >= 1) {
                    settle();
                    return;
                }
                mediaEl.addEventListener('loadedmetadata', settle, { once: true });
                mediaEl.addEventListener('canplay', settle, { once: true });
                mediaEl.addEventListener('error', settle, { once: true });
            } else {
                settle();
                return;
            }

            window.setTimeout(settle, timeoutMs || 1400);
        });
    }

    function markGalleryGridReady() {
        if (!galleryGrid) return;
        requestAnimationFrame(() => {
            galleryGrid.classList.add('media-ready');
        });
    }

    function waitForPortfolioItemMedia(item, timeoutMs = 1600) {
        if (!item) return Promise.resolve();

        const mediaEls = Array.from(item.querySelectorAll('img, video'));
        if (!mediaEls.length) return Promise.resolve();

        return Promise.all(mediaEls.map((mediaEl) => waitForSingleMediaElement(mediaEl, null, timeoutMs))).then(() => undefined);
    }

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
            if (visible) {
                galleryGrid.classList.remove('media-ready');
            }
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
                waitForPortfolioItemMedia(item).finally(() => {
                    item.style.opacity = '1';
                    item.style.transform = 'scale(1)';
                });
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

    // --- 2. Category Explore (Opens Modal with filtered items - images + videos) ---
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
                let catItems = categoryItemsData[categoryId] || [];
                if (!catItems.length) {
                    const fallbackMedia = categoryImagesForModal[categoryId] || [];
                    catItems = fallbackMedia.map((media, idx) => {
                        if (media && typeof media === 'object') {
                            const _type = String(media.type || 'image').toLowerCase();
                            return {
                                type: _type,
                                orientation: _type === 'reel' ? 'portrait' : 'square',
                                title: catName + ' Sample ' + (idx + 1),
                                image: _type === 'image' ? media.src : (media.poster || ''),
                                video: (_type === 'video' || _type === 'reel') ? media.src : '',
                                video_fallback: (_type === 'video' || _type === 'reel') ? (media.fallback || media.src) : '',
                            };
                        }
                        return {
                            type: 'image',
                            orientation: 'square',
                            title: catName + ' Sample ' + (idx + 1),
                            image: media,
                        };
                    }).filter((entry) => Boolean(entry && (entry.image || entry.video)));
                }

                galleryGrid.innerHTML = '';
                galleryGrid.classList.remove('media-ready');

                if (!catItems.length) {
                    galleryGrid.innerHTML = '<p style="text-align: center; padding: 60px 20px; color: #666;">No samples available for this category yet.</p>';
                    galleryGrid.classList.add('media-ready');
                    setGallerySkeletonVisible(false);
                    return;
                }

                const mediaList = [];
                const mediaIndexByItem = new Array(catItems.length).fill(-1);
                catItems.forEach((item, idx) => {
                    const itemType = String(item.type || 'image').toLowerCase();
                    const isVideoItem = (itemType === 'video' || itemType === 'reel') && item.video;
                    const entry = isVideoItem
                        ? {
                            type: 'video',
                            src: item.video_stream || item.video,
                            fallbackSrc: item.video_fallback || item.video,
                            poster: item.image || '',
                            title: item.title || catName,
                        }
                        : (item.image
                            ? {
                                type: 'image',
                                src: item.image,
                                title: item.title || catName,
                            }
                            : null);
                    if (!entry) return;
                    mediaIndexByItem[idx] = mediaList.length;
                    mediaList.push(entry);
                });

                const readyPromises = [];
                const galleryScrollContainer = document.querySelector('.product-gallery-body');

                catItems.forEach((item, index) => {
                    const itemType = String(item.type || 'image').toLowerCase();
                    const isVideoItem = (itemType === 'video' || itemType === 'reel') && item.video;

                    const wrapper = document.createElement('div');
                    wrapper.className = 'gallery-item media-pending';
                    if (itemType === 'video') wrapper.classList.add('video-item');
                    if (itemType === 'reel') wrapper.classList.add('video-item', 'reel-item');

                    const orientation = String(item.orientation || (itemType === 'reel' ? 'portrait' : 'square')).toLowerCase();
                    if (orientation === 'portrait' || orientation === 'landscape' || orientation === 'square') {
                        wrapper.classList.add('media-' + orientation);
                    }

                    const mediaIndex = mediaIndexByItem[index];

                    if (isVideoItem) {
                        const video = document.createElement('video');
                        const primaryVideoSrc = item.video_stream || item.video;
                        const fallbackVideoSrc = item.video_fallback || item.video;
                        const selectedVideoSrc = pickVideoSource(video, primaryVideoSrc, fallbackVideoSrc);
                        video.src = selectedVideoSrc;
                        video.muted = true;
                        video.loop = false;
                        video.playsInline = true;
                        video.preload = 'none';
                        video.controls = false;
                        video.dataset.managedVideo = '1';
                        if (item.image) video.poster = item.image;
                        video.setAttribute('playsinline', '');

                        const playOverlay = document.createElement('div');
                        playOverlay.className = 'gallery-video-overlay';
                        playOverlay.innerHTML = '<button class="gallery-play-btn"><i class="fas fa-play"></i></button>';

                        const playBtn = playOverlay.querySelector('.gallery-play-btn');
                        const durationBadge = document.createElement('span');
                        durationBadge.className = 'video-duration-badge';
                        durationBadge.textContent = '--:--';

                        let isPlaying = false;

                        function updatePlayOverlay() {
                            wrapper.classList.toggle('is-playing', isPlaying);
                            playBtn.innerHTML = isPlaying
                                ? '<i class="fas fa-pause"></i>'
                                : '<i class="fas fa-play"></i>';
                        }

                        function playInlineWithSound() {
                            pauseManagedVideos(video);
                            wrapper.classList.remove('is-previewing');
                            video.muted = false;
                            video.play().then(() => {
                                isPlaying = true;
                                updatePlayOverlay();
                            }).catch(() => {});
                        }

                        function togglePlay(e) {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isPlaying) {
                                video.pause();
                                isPlaying = false;
                                updatePlayOverlay();
                            } else {
                                playInlineWithSound();
                            }
                        }

                        playBtn.addEventListener('click', togglePlay);

                        video.addEventListener('play', () => {
                            if (!video.muted) {
                                pauseManagedVideos(video);
                                isPlaying = true;
                                wrapper.classList.remove('is-previewing');
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

                        video.addEventListener('loadedmetadata', () => {
                            if (Number.isFinite(video.duration)) {
                                durationBadge.textContent = formatTimeSeconds(video.duration);
                            }
                        });

                        wrapper.addEventListener('dblclick', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (mediaIndex >= 0) openLightboxAt(mediaList, mediaIndex, { autoplayVideo: true });
                        });

                        if (galleryScrollContainer) {
                            video.addEventListener('wheel', (e) => {
                                galleryScrollContainer.scrollTop += e.deltaY;
                                e.preventDefault();
                            }, { passive: false });
                        }

                        wrapper.appendChild(video);
                        wrapper.appendChild(playOverlay);
                        wrapper.appendChild(durationBadge);
                        markGalleryItemReady(wrapper);
                    } else if (item.image) {
                        const img = document.createElement('img');
                        img.src = item.image;
                        img.alt = item.title || (catName + ' Sample ' + (index + 1));
                        applyLazyImageAttrs(img, index < 2);
                        wrapper.appendChild(img);

                        wrapper.addEventListener('click', () => {
                            if (mediaIndex >= 0) openLightboxAt(mediaList, mediaIndex);
                        });
                        wrapper.addEventListener('dblclick', () => {
                            if (mediaIndex >= 0) openLightboxAt(mediaList, mediaIndex);
                        });
                        readyPromises.push(waitForSingleMediaElement(img, wrapper, 1500));
                    } else {
                        markGalleryItemReady(wrapper);
                    }

                    galleryGrid.appendChild(wrapper);
                });

                const revealGallery = () => {
                    markGalleryGridReady();
                    setGallerySkeletonVisible(false);
                };

                if (readyPromises.length) {
                    Promise.race([
                        Promise.allSettled(readyPromises),
                        new Promise((resolve) => window.setTimeout(resolve, 1500)),
                    ]).then(revealGallery);
                } else {
                    revealGallery();
                }
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

    // --- 3. Lightbox Functionality (images + videos) ---
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImage');
    const lightboxVideo = document.getElementById('lightboxVideo');
    const lightboxVideoToggle = document.getElementById('lightboxVideoToggle');
    const lightboxVideoTime = document.getElementById('lightboxVideoTime');
    const lightboxPrev = document.getElementById('lightboxPrev');
    const lightboxNext = document.getElementById('lightboxNext');
    const lightboxCounter = document.getElementById('lightboxCounter');
    const lightboxCaption = document.getElementById('lightboxCaption');

    // Slideshow state
    let _lbMedia = [];   // [{type:'image'|'video', src, title, poster?}, ...]
    let _lbIndex = 0;

    if (lightboxVideo) {
        lightboxVideo.dataset.managedVideo = '1';
        lightboxVideo.controls = false;
    }

    function _setLightboxVideoToggle(isPlaying) {
        if (!lightboxVideoToggle) return;
        const icon = lightboxVideoToggle.querySelector('i');
        if (!icon) return;
        icon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
        lightboxVideoToggle.setAttribute('aria-label', isPlaying ? 'Pause video' : 'Play video');
    }

    function _updateLightboxVideoTime() {
        if (!lightboxVideo || !lightboxVideoTime) return;
        const current = Number.isFinite(lightboxVideo.currentTime) ? lightboxVideo.currentTime : 0;
        const total = Number.isFinite(lightboxVideo.duration) ? lightboxVideo.duration : 0;
        lightboxVideoTime.textContent = formatTimeSeconds(current) + ' / ' + formatTimeSeconds(total);
    }

    function _stopLightboxVideo() {
        if (!lightboxVideo) return;
        try { lightboxVideo.pause(); } catch (_) {}
        lightboxVideo.removeAttribute('src');
        lightboxVideo.load();
        _setLightboxVideoToggle(false);
        _updateLightboxVideoTime();
    }

    function _normalizeLightboxList(mediaItems) {
        return (mediaItems || []).map((item) => {
            if (typeof item === 'string') {
                return { type: 'image', src: item, title: '' };
            }
            if (!item || !item.src) return null;
            return {
                type: item.type === 'video' ? 'video' : 'image',
                src: item.src,
                fallbackSrc: item.fallbackSrc || item.fallback || '',
                title: item.title || '',
                poster: item.poster || '',
            };
        }).filter(Boolean);
    }

    function _updateLightboxSlide(options) {
        const item = _lbMedia[_lbIndex];
        if (!item) return;

        const autoplayVideo = Boolean(options && options.autoplayVideo);
        const isVideo = item.type === 'video';

        lightbox.classList.toggle('is-video', isVideo);
        if (lightboxCaption) lightboxCaption.textContent = item.title || '';

        if (isVideo) {
            if (lightboxImg) lightboxImg.removeAttribute('src');
            if (lightboxVideo) {
                if (item.poster) {
                    lightboxVideo.poster = item.poster;
                } else {
                    lightboxVideo.removeAttribute('poster');
                }
                const playableSource = pickVideoSource(lightboxVideo, item.src, item.fallbackSrc || '');
                if (lightboxVideo.getAttribute('src') !== playableSource) {
                    lightboxVideo.src = playableSource;
                    lightboxVideo.load();
                }
                _setLightboxVideoToggle(false);
                _updateLightboxVideoTime();
                if (autoplayVideo) {
                    pauseManagedVideos(lightboxVideo);
                    lightboxVideo.muted = false;
                    const playPromise = lightboxVideo.play();
                    if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch(() => {
                            _setLightboxVideoToggle(false);
                        });
                    }
                }
            }
        } else {
            _stopLightboxVideo();
            if (lightboxImg) lightboxImg.src = item.src;
        }

        if (_lbMedia.length > 1) {
            lightboxCounter.textContent = (_lbIndex + 1) + ' / ' + _lbMedia.length;
            lightboxCounter.style.display = 'block';
            lightboxPrev.style.display = 'flex';
            lightboxNext.style.display = 'flex';
        } else {
            lightboxCounter.style.display = 'none';
            lightboxPrev.style.display = 'none';
            lightboxNext.style.display = 'none';
        }
    }

    function openLightboxAt(mediaItems, index, options) {
        _lbMedia = _normalizeLightboxList(mediaItems);
        if (!_lbMedia.length) return;
        _lbIndex = Math.max(0, Math.min(index, _lbMedia.length - 1));
        lightbox.classList.add('active');
        _updateLightboxSlide(options || {});
    }

    function openLightbox(src, caption) {
        openLightboxAt([{ type: 'image', src: src, title: caption || '' }], 0);
    }

    if (lightboxVideoToggle && lightboxVideo) {
        lightboxVideoToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (lightboxVideo.paused) {
                pauseManagedVideos(lightboxVideo);
                lightboxVideo.muted = false;
                lightboxVideo.play().catch(() => {});
            } else {
                lightboxVideo.pause();
            }
        });
    }

    if (lightboxVideo) {
        lightboxVideo.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (lightboxVideo.paused) {
                pauseManagedVideos(lightboxVideo);
                lightboxVideo.muted = false;
                lightboxVideo.play().catch(() => {});
            } else {
                lightboxVideo.pause();
            }
        });

        lightboxVideo.addEventListener('play', () => {
            pauseManagedVideos(lightboxVideo);
            _setLightboxVideoToggle(true);
            _updateLightboxVideoTime();
        });
        lightboxVideo.addEventListener('pause', () => {
            _setLightboxVideoToggle(false);
            _updateLightboxVideoTime();
        });
        lightboxVideo.addEventListener('ended', () => {
            _setLightboxVideoToggle(false);
            _updateLightboxVideoTime();
        });
        lightboxVideo.addEventListener('timeupdate', _updateLightboxVideoTime);
        lightboxVideo.addEventListener('loadedmetadata', _updateLightboxVideoTime);
        lightboxVideo.addEventListener('durationchange', _updateLightboxVideoTime);
    }

    lightboxPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_lbMedia.length < 2) return;
        _lbIndex = (_lbIndex - 1 + _lbMedia.length) % _lbMedia.length;
        const target = _lbMedia[_lbIndex];
        _updateLightboxSlide({ autoplayVideo: Boolean(target && target.type === 'video') });
    });

    lightboxNext.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_lbMedia.length < 2) return;
        _lbIndex = (_lbIndex + 1) % _lbMedia.length;
        const target = _lbMedia[_lbIndex];
        _updateLightboxSlide({ autoplayVideo: Boolean(target && target.type === 'video') });
    });

    // Touch / swipe support
    (function() {
        let _touchStartX = null;
        lightbox.addEventListener('touchstart', (e) => { _touchStartX = e.touches[0].clientX; }, { passive: true });
        lightbox.addEventListener('touchend', (e) => {
            if (_touchStartX === null) return;
            const dx = e.changedTouches[0].clientX - _touchStartX;
            _touchStartX = null;
            if (Math.abs(dx) < 40) return;
            if (dx < 0) lightboxNext.click();
            else lightboxPrev.click();
        }, { passive: true });
    })();

    function buildVisiblePortfolioMediaList() {
        const visibleItems = Array.from(document.querySelectorAll('.portfolio-item')).filter((el) => {
            if (el.style.display === 'none') return false;
            return Boolean(el.dataset.src || el.dataset.videoUrl);
        });

        const media = visibleItems.map((el) => {
            if (el.dataset.videoUrl) {
                return {
                    type: 'video',
                    src: el.dataset.videoUrl,
                    fallbackSrc: el.dataset.videoFallbackUrl || el.dataset.videoUrl,
                    poster: el.dataset.videoThumb || el.dataset.src || '',
                    title: el.dataset.title || '',
                };
            }
            return {
                type: 'image',
                src: el.dataset.src,
                title: el.dataset.title || '',
            };
        });

        return { visibleItems, media };
    }

    function openPortfolioMediaViewer(item, autoplayVideo) {
        const { visibleItems, media } = buildVisiblePortfolioMediaList();
        const idx = visibleItems.indexOf(item);
        if (idx < 0) return;
        openLightboxAt(media, idx, { autoplayVideo: Boolean(autoplayVideo) });
    }

    function ensurePortfolioDurationBadge(item) {
        const videoUrl = item.dataset.videoUrl;
        const fallbackVideoUrl = item.dataset.videoFallbackUrl || videoUrl;
        if (!videoUrl) return;

        const mediaWrap = item.querySelector('.portfolio-image');
        if (!mediaWrap) return;

        let badge = mediaWrap.querySelector('.portfolio-video-duration');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'video-duration-badge portfolio-video-duration';
            badge.textContent = '--:--';
            mediaWrap.appendChild(badge);
        }

        const probe = document.createElement('video');
        probe.preload = 'metadata';
        probe.src = pickVideoSource(probe, videoUrl, fallbackVideoUrl);

        let done = false;
        function applyDuration() {
            if (done) return;
            done = true;
            if (Number.isFinite(probe.duration) && probe.duration > 0) {
                badge.textContent = formatTimeSeconds(probe.duration);
            }
        }

        probe.addEventListener('loadedmetadata', applyDuration, { once: true });
        probe.addEventListener('error', applyDuration, { once: true });
        window.setTimeout(applyDuration, 1600);
    }

    function ensureInlinePortfolioVideo(item) {
        if (item._inlineVideo) return item._inlineVideo;

        const videoUrl = item.dataset.videoUrl;
        const fallbackVideoUrl = item.dataset.videoFallbackUrl || videoUrl;
        const mediaWrap = item.querySelector('.portfolio-image');
        if (!videoUrl || !mediaWrap) return null;

        const inlineVideo = document.createElement('video');
        inlineVideo.className = 'inline-portfolio-video';
        inlineVideo.src = pickVideoSource(inlineVideo, videoUrl, fallbackVideoUrl);
        inlineVideo.controls = false;
        inlineVideo.preload = 'none';
        inlineVideo.playsInline = true;
        inlineVideo.dataset.managedVideo = '1';
        inlineVideo.setAttribute('playsinline', '');
        inlineVideo.style.cssText = 'width:100%;height:auto;display:block;position:relative;z-index:4;border-radius:14px;object-fit:contain;background:#070912;';

        const img = mediaWrap.querySelector('img');
        if (img) img.style.display = 'none';

        const iconEl = item.querySelector('.portfolio-play-icon i');
        function setInlinePlayingState(isPlaying) {
            item.classList.toggle('playing', isPlaying);
            if (iconEl) iconEl.className = isPlaying ? 'fa-solid fa-pause-circle' : 'fa-solid fa-play-circle';
        }

        inlineVideo.addEventListener('play', () => {
            pauseManagedVideos(inlineVideo);
            setInlinePlayingState(true);
        });
        inlineVideo.addEventListener('pause', () => setInlinePlayingState(false));
        inlineVideo.addEventListener('ended', () => setInlinePlayingState(false));

        inlineVideo.addEventListener('loadedmetadata', () => {
            const badge = mediaWrap.querySelector('.portfolio-video-duration');
            if (badge && Number.isFinite(inlineVideo.duration) && inlineVideo.duration > 0) {
                badge.textContent = formatTimeSeconds(inlineVideo.duration);
            }
        });

        mediaWrap.insertBefore(inlineVideo, mediaWrap.firstChild);
        item._inlineVideo = inlineVideo;
        item._setInlinePlayingState = setInlinePlayingState;
        return inlineVideo;
    }

    function toggleInlinePortfolioVideo(item) {
        const inlineVideo = ensureInlinePortfolioVideo(item);
        if (!inlineVideo) return;

        if (inlineVideo.paused) {
            pauseManagedVideos(inlineVideo);
            inlineVideo.muted = false;
            inlineVideo.play().catch(() => {
                if (item._setInlinePlayingState) item._setInlinePlayingState(false);
            });
        } else {
            inlineVideo.pause();
        }
    }

    // Portfolio media interaction: one-at-a-time playback + dblclick to open viewer.
    document.querySelectorAll('.portfolio-item').forEach((item) => {
        const videoUrl = item.dataset.videoUrl;
        if (videoUrl) {
            ensurePortfolioDurationBadge(item);
        }

        let clickTimer = null;

        item.addEventListener('click', (e) => {
            e.preventDefault();
            if (!videoUrl) {
                openPortfolioMediaViewer(item, false);
                return;
            }

            if (clickTimer) {
                window.clearTimeout(clickTimer);
                clickTimer = null;
            }

            clickTimer = window.setTimeout(() => {
                toggleInlinePortfolioVideo(item);
                clickTimer = null;
            }, 220);
        });

        item.addEventListener('dblclick', (e) => {
            if (!videoUrl) return;
            e.preventDefault();
            if (clickTimer) {
                window.clearTimeout(clickTimer);
                clickTimer = null;
            }
            openPortfolioMediaViewer(item, true);
        });

        item.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (videoUrl) toggleInlinePortfolioVideo(item);
            else openPortfolioMediaViewer(item, false);
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
        pauseManagedVideos(null);
    }

    function closeLightbox() {
        lightbox.classList.remove('active');
        lightbox.classList.remove('is-video');
        if (lightboxImg) lightboxImg.src = '';
        _stopLightboxVideo();
        _lbMedia = [];
        _lbIndex = 0;
        // Don't touch body overflow if gallery modal is still open
        if (!productModal.classList.contains('active')) {
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        }
    }

    function closeVideoModal() {
        videoModal.classList.remove('active');
        if (modalVideo) {
            modalVideo.pause();
            modalVideo.removeAttribute('src');
            modalVideo.load();
        }
        if (!productModal.classList.contains('active')) {
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        }
    }

    // Save scroll when opening gallery
    exploreButtons.forEach(btn => {
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
 * Initialize Category Card Background Media with Fade Carousel
 * Shows one item at a time (image or video), stays for 3 seconds,
 * then fades to the next. Top 10 media items rotate per card.
 */
function initCategoryBackgrounds() {
    const dataElement = document.getElementById('categoryImagesData');
    if (!dataElement) return;
    
    try {
        const categoryImages = JSON.parse(dataElement.textContent);
        const categoryCards = document.querySelectorAll('.category-card');
        
        categoryCards.forEach(card => {
            const catId = card.dataset.category;
            const mediaItems = categoryImages[catId];
            const slider = card.querySelector('.category-slider');
            
            if (!slider) return;
            
            if (mediaItems && mediaItems.length > 0) {
                // Hide placeholder
                const placeholder = card.querySelector('.bg-placeholder');
                if (placeholder) placeholder.style.display = 'none';
                
                // Use top 10 media items max
                const displayMedia = mediaItems.slice(0, 10);
                
                // Create media elements directly inside slider
                displayMedia.forEach((media, index) => {
                    const isObject = media && typeof media === 'object';
                    const mediaType = isObject ? String(media.type || 'image').toLowerCase() : 'image';
                    const mediaSrc = isObject ? media.src : media;
                    if (!mediaSrc) return;

                    if (mediaType === 'video') {
                        const video = document.createElement('video');
                        video.src = mediaSrc;
                        video.className = 'slider-video';
                        video.muted = true;
                        video.loop = true;
                        video.playsInline = true;
                        video.preload = 'metadata';
                        video.setAttribute('playsinline', '');
                        if (isObject && media.poster) {
                            video.poster = media.poster;
                        }
                        if (index === 0) video.classList.add('active');
                        slider.appendChild(video);
                    } else {
                        const img = document.createElement('img');
                        img.src = mediaSrc;
                        img.alt = `Sample ${index + 1}`;
                        img.className = 'slider-img';
                        img.loading = index === 0 ? 'eager' : 'lazy';
                        img.decoding = 'async';
                        img.setAttribute('fetchpriority', index === 0 ? 'high' : 'low');
                        if (index === 0) img.classList.add('active');
                        slider.appendChild(img);
                    }
                });

                const mediaElements = slider.querySelectorAll('.slider-img, .slider-video');
                if (!mediaElements.length) return;

                function activateMedia(nextIndex) {
                    mediaElements.forEach((el, idx) => {
                        const isActive = idx === nextIndex;
                        el.classList.toggle('active', isActive);

                        if (el.tagName === 'VIDEO') {
                            if (isActive) {
                                const playPromise = el.play();
                                if (playPromise && typeof playPromise.catch === 'function') {
                                    playPromise.catch(() => {});
                                }
                            } else {
                                el.pause();
                                el.currentTime = 0;
                            }
                        }
                    });
                }

                // Ensure first media item is active and video starts if needed.
                let currentIndex = 0;
                activateMedia(currentIndex);

                // Start auto-rotation if multiple media items.
                if (mediaElements.length > 1) {
                    let isPaused = false;
                    const rotateInterval = setInterval(() => {
                        if (isPaused) return;
                        currentIndex = (currentIndex + 1) % mediaElements.length;
                        activateMedia(currentIndex);
                    }, 3000); // 3 seconds per media

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

