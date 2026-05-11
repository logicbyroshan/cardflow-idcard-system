/**
 * Adarsh ID Cards - Our Works Logic (v3)
 * Handles Filtering, Lightbox, Category Exploration, Video Playback, Share
 */

document.addEventListener('DOMContentLoaded', function() {
    let pageConfig = {};
    const pageConfigEl = document.getElementById('portfolioPageConfig');
    if (pageConfigEl) {
        try {
            pageConfig = JSON.parse(pageConfigEl.textContent || '{}') || {};
        } catch (e) {
            pageConfig = {};
        }
    }

    const configuredPortfolioBatch = Number(pageConfig.portfolioBatchSize);
    const configuredModalBatch = Number(pageConfig.categoryModalBatchSize);
    const PORTFOLIO_BATCH_SIZE = Number.isFinite(configuredPortfolioBatch)
        ? Math.min(50, Math.max(10, Math.round(configuredPortfolioBatch)))
        : 20;
    const CATEGORY_MODAL_BATCH_SIZE = Number.isFinite(configuredModalBatch)
        ? Math.min(50, Math.max(10, Math.round(configuredModalBatch)))
        : 20;
    const CATEGORY_ITEMS_API = String(pageConfig.categoryItemsApi || '');
    
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
            if (!exceptVideo || !item.contains(exceptVideo)) {
                item.classList.remove('playing');
                if (typeof item._setInlinePlayingState === 'function') {
                    item._setInlinePlayingState(false);
                }
            }
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

        const mediaEls = Array.from(item.querySelectorAll('img, video')).filter((mediaEl) => {
            return !mediaEl.classList.contains('portfolio-preview-fallback');
        });
        if (!mediaEls.length) return Promise.resolve();

        return Promise.all(mediaEls.map((mediaEl) => waitForSingleMediaElement(mediaEl, null, timeoutMs))).then(() => undefined);
    }

    function setSkeletonVisible(visible) {
        // Skeleton removed per UI update
        if (skeletonWrap) skeletonWrap.hidden = true;
    }

    function setGallerySkeletonVisible(visible) {
        // Skeleton removed per UI update
        if (gallerySkeleton) gallerySkeleton.hidden = true;
        if (galleryGrid) galleryGrid.hidden = false;
    }

    function applyLazyImageAttrs(img, isPriority) {
        if (!img) return;
        img.loading = isPriority ? 'eager' : 'lazy';
        img.decoding = 'async';
        img.setAttribute('fetchpriority', isPriority ? 'high' : 'low');
    }

    function hydratePortfolioItemMedia(item, isPriority) {
        if (!item || item.dataset.mediaHydrated === '1') {
            return Promise.resolve();
        }
        item.dataset.mediaHydrated = '1';

        const wrap = item.querySelector('.portfolio-image');
        if (!wrap) {
            return Promise.resolve();
        }

        const lazyImg = wrap.querySelector('img[data-src]');
        if (lazyImg && !lazyImg.getAttribute('src')) {
            applyLazyImageAttrs(lazyImg, Boolean(isPriority));
            lazyImg.src = lazyImg.dataset.src;
        }

        const previewVideo = wrap.querySelector('.portfolio-preview-fallback');
        if (previewVideo && !previewVideo.getAttribute('src')) {
            const primary = previewVideo.dataset.previewPrimary || item.dataset.videoUrl || '';
            const fallback = previewVideo.dataset.previewFallback || item.dataset.videoFallbackUrl || primary;
            const playableSource = pickVideoSource(previewVideo, primary, fallback);
            if (playableSource) {
                previewVideo.src = playableSource;
                previewVideo.dataset.managedVideo = '1';
                previewVideo.preload = 'metadata';
                previewVideo.setAttribute('playsinline', '');

                const markReady = () => {
                    item.classList.add('preview-ready');
                };
                previewVideo.addEventListener('loadeddata', markReady, { once: true });
                previewVideo.addEventListener('canplay', markReady, { once: true });
            }
        }

        if (item.dataset.videoUrl) {
            ensurePortfolioDurationBadge(item);
        }

        return Promise.resolve();
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
            nextItems.forEach((item, index) => {
                const isPriority = renderedCount + index < PORTFOLIO_BATCH_SIZE;
                item.style.display = 'inline-block';
                hydratePortfolioItemMedia(item, isPriority)
                    .then(() => waitForPortfolioItemMedia(item))
                    .finally(() => {
                        item.style.opacity = '1';
                        item.style.transform = 'scale(1)';
                    });
            });
            renderedCount += nextItems.length;
            isBatchLoading = false;
            setSkeletonVisible(false);
            updateSentinelState();
        }, 140);
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
        }, { root: null, rootMargin: '500px 0px 500px 0px', threshold: 0.01 });
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
    const categoryCards = document.querySelectorAll('.category-card');
    const extraCategoryButtons = document.querySelectorAll('.extra-category-tag');
    const productModal = document.getElementById('productGalleryModal');
    
    // Get category images data for bento backgrounds
    let categoryImagesForModal = {};
    const dataEl = document.getElementById('categoryImagesData');
    if (dataEl) {
        try { categoryImagesForModal = JSON.parse(dataEl.textContent); } catch (e) {}
    }

    // Get category items data (initial chunk only)
    let categoryItemsData = {};
    const itemsDataEl = document.getElementById('categoryItemsData');
    if (itemsDataEl) {
        try { categoryItemsData = JSON.parse(itemsDataEl.textContent); } catch (e) {}
    }

    let categoryItemTotalsData = {};
    const itemTotalsDataEl = document.getElementById('categoryItemTotalsData');
    if (itemTotalsDataEl) {
        try { categoryItemTotalsData = JSON.parse(itemTotalsDataEl.textContent); } catch (e) {}
    }

    // Track current category for share
    let currentGalleryCategorySlug = '';
    let currentGalleryCategoryId = '';
    let currentGalleryCategoryName = 'Items';
    let currentGalleryOffset = 0;
    let currentGalleryHasMore = false;
    let isGalleryLoadingMore = false;
    let currentGalleryItems = [];

    const galleryLoadMoreWrap = document.getElementById('productGalleryLoadMoreWrap');
    const galleryLoadMoreBtn = document.getElementById('productGalleryLoadMoreBtn');
    const galleryScrollContainer = document.querySelector('.product-gallery-body');

    function setGalleryLoadMoreVisible(visible) {
        if (!galleryLoadMoreWrap) return;
        galleryLoadMoreWrap.hidden = !visible;
    }

    function setGalleryLoadMoreLoading(loading) {
        if (!galleryLoadMoreBtn) return;
        galleryLoadMoreBtn.disabled = loading;
        galleryLoadMoreBtn.textContent = loading ? 'Loading more...' : 'Load more samples';
    }

    function updateGalleryLoadMoreUi() {
        // Button removed per UI update, infinite scroll used instead
        setGalleryLoadMoreVisible(false);
    }

    function buildFallbackCategoryItems(categoryId, catName) {
        const fallbackMedia = categoryImagesForModal[categoryId] || [];
        return fallbackMedia.map((media, idx) => {
            if (media && typeof media === 'object') {
                const mediaType = String(media.type || 'image').toLowerCase();
                const isVideo = mediaType === 'video' || mediaType === 'reel';
                return {
                    type: mediaType,
                    orientation: mediaType === 'reel' ? 'portrait' : 'square',
                    title: catName + ' Sample ' + (idx + 1),
                    image: mediaType === 'image' ? media.src : (media.poster || ''),
                    video: isVideo ? media.src : '',
                    video_fallback: isVideo ? (media.fallback || media.src) : '',
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

    function buildGalleryCard(item, index, catName, mediaList) {
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

        const mediaIndex = entry ? mediaList.push(entry) - 1 : -1;
        let readyPromise = null;

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

            wrapper.addEventListener('dblclick', () => {
                if (mediaIndex >= 0) openLightboxAt(mediaList, mediaIndex);
            });
            readyPromise = waitForSingleMediaElement(img, wrapper, 1500);
        } else {
            markGalleryItemReady(wrapper);
        }

        // Common click listener for both images and videos to open lightbox
        wrapper.addEventListener('click', (e) => {
            // Only open lightbox if the click wasn't on an interactive element (like the play button)
            // though stopPropagation on the play button should already handle this.
            if (mediaIndex >= 0) {
                const autoplay = isVideoItem; // Maybe autoplay if it's a video? User said "then play"
                openLightboxAt(mediaList, mediaIndex, { autoplayVideo: autoplay });
            }
        });

        return { wrapper, readyPromise };
    }

    function renderCategoryGallery(catItems, catName) {
        galleryGrid.innerHTML = '';
        galleryGrid.classList.remove('media-ready');

        if (!catItems.length) {
            galleryGrid.innerHTML = '<p style="text-align: center; padding: 60px 20px; color: #666;">No samples available for this category yet.</p>';
            galleryGrid.classList.add('media-ready');
            setGallerySkeletonVisible(false);
            return;
        }

        const mediaList = [];
        const readyPromises = [];

        catItems.forEach((item, index) => {
            const built = buildGalleryCard(item, index, catName, mediaList);
            galleryGrid.appendChild(built.wrapper);
            if (built.readyPromise) {
                readyPromises.push(built.readyPromise);
            }
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
    }

    async function fetchMoreCategoryItems(categoryId, offset, limit) {
        if (!CATEGORY_ITEMS_API) {
            return { items: [], has_more: false, total: offset };
        }
        const params = new URLSearchParams({
            category_id: String(categoryId),
            offset: String(offset),
            limit: String(limit),
        });
        const response = await fetch(CATEGORY_ITEMS_API + '?' + params.toString(), {
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
            },
        });
        if (!response.ok) {
            throw new Error('Category items fetch failed');
        }
        return response.json();
    }

    async function loadMoreCategoryItems() {
        if (!currentGalleryCategoryId || !currentGalleryHasMore || isGalleryLoadingMore) return;

        isGalleryLoadingMore = true;
        updateGalleryLoadMoreUi();

        try {
            const payload = await fetchMoreCategoryItems(
                currentGalleryCategoryId,
                currentGalleryOffset,
                CATEGORY_MODAL_BATCH_SIZE,
            );

            const nextItems = Array.isArray(payload.items) ? payload.items : [];
            const nextOffset = Number(payload.next_offset);
            if (nextItems.length) {
                currentGalleryItems = currentGalleryItems.concat(nextItems);
                const previousScrollTop = galleryScrollContainer ? galleryScrollContainer.scrollTop : 0;
                renderCategoryGallery(currentGalleryItems, currentGalleryCategoryName);
                if (galleryScrollContainer) {
                    galleryScrollContainer.scrollTop = previousScrollTop;
                }
            }

            if (Number.isFinite(nextOffset) && nextOffset >= currentGalleryOffset) {
                currentGalleryOffset = nextOffset;
            } else {
                currentGalleryOffset += CATEGORY_MODAL_BATCH_SIZE;
            }

            const payloadTotal = Number(payload.total);
            if (Number.isFinite(payloadTotal)) {
                categoryItemTotalsData[String(currentGalleryCategoryId)] = payloadTotal;
            }

            currentGalleryHasMore = Boolean(payload.has_more) && nextItems.length > 0;
        } catch (error) {
            currentGalleryHasMore = false;
        } finally {
            isGalleryLoadingMore = false;
            updateGalleryLoadMoreUi();
        }
    }

    if (galleryLoadMoreBtn) {
        galleryLoadMoreBtn.addEventListener('click', () => {
            loadMoreCategoryItems();
        });
    }

    if (galleryScrollContainer) {
        galleryScrollContainer.addEventListener('scroll', () => {
            if (!currentGalleryHasMore || isGalleryLoadingMore) return;
            const nearBottom = galleryScrollContainer.scrollTop + galleryScrollContainer.clientHeight >= (galleryScrollContainer.scrollHeight - 220);
            if (nearBottom) {
                loadMoreCategoryItems();
            }
        }, { passive: true });
    }

    function openCategoryGallery(categoryId, catName, catSlug) {
        const normalizedCategoryId = String(categoryId || '');
        if (!normalizedCategoryId) return;

        savedScrollPosition = window.scrollY || window.pageYOffset;
        document.getElementById('productGalleryTitle').textContent = catName || 'Items';
        currentGalleryCategorySlug = catSlug || '';
        currentGalleryCategoryId = normalizedCategoryId;
        currentGalleryCategoryName = catName || 'Items';
        productModal.classList.add('active');
        document.body.classList.add('modal-open');

        galleryGrid.innerHTML = '';
        setGallerySkeletonVisible(true);
        setGalleryLoadMoreVisible(false);

        window.setTimeout(() => {
            let catItems = categoryItemsData[normalizedCategoryId] || [];
            if (!catItems.length) {
                catItems = buildFallbackCategoryItems(normalizedCategoryId, catName || 'Items');
            }
            currentGalleryItems = catItems.slice();
            currentGalleryOffset = currentGalleryItems.length;

            const knownTotal = Number(categoryItemTotalsData[normalizedCategoryId]);
            const totalForCategory = Number.isFinite(knownTotal) ? knownTotal : currentGalleryOffset;
            currentGalleryHasMore = currentGalleryOffset < totalForCategory;

            renderCategoryGallery(currentGalleryItems, catName || 'Items');
            updateGalleryLoadMoreUi();
        }, 160);
    }

    categoryCards.forEach((card) => {
        const openFromCard = () => {
            const categoryId = card.dataset.category;
            const catName = card.querySelector('h3')?.textContent?.trim() || 'Items';
            const catSlug = card.dataset.slug || '';
            openCategoryGallery(categoryId, catName, catSlug);
        };

        card.addEventListener('click', (e) => {
            // Prevent navigation to allow modal to open for users.
            // Search engines will still follow the href.
            e.preventDefault();
            if (e.target.closest('.category-overlay .explore-btn')) {
                // Already handled by capture or bubbling if needed, but safe to prevent here too.
            }
            openFromCard();
        });

        card.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            openFromCard();
        });
    });

    extraCategoryButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const categoryId = btn.dataset.filter || btn.dataset.category;
            const catName = btn.querySelector('span')?.textContent?.trim() || 'Items';
            const catSlug = btn.dataset.slug || '';
            openCategoryGallery(categoryId, catName, catSlug);
        });
    });

    // --- Share Button ---
    const shareBtn = document.getElementById('productGalleryShare');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            // Use hash-based URL to trigger modal on homepage instead of separate page.
            const url = window.location.origin + '/#category=' + currentGalleryCategorySlug;
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
        if (exactCard) return exactCard;
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
        return bestNode;
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
        return bestNode;
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

    const initialCategory = pageConfig.initialCategory;
    if (initialCategory && initialCategory.id) {
        window.setTimeout(() => {
            openCategoryGallery(
                initialCategory.id,
                initialCategory.name || 'Items',
                initialCategory.slug || ''
            );
        }, 250);
    }

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
                productUrl: item.productUrl || '',
            };
        }).filter(Boolean);
    }

    function _updateLightboxSlide(options) {
        const item = _lbMedia[_lbIndex];
        if (!item) return;

        const autoplayVideo = Boolean(options && options.autoplayVideo);
        const isVideo = item.type === 'video';

        lightbox.classList.toggle('is-video', isVideo);
        if (lightboxCaption) {
            const titleText = item.title || '';
            if (item.productUrl) {
                lightboxCaption.innerHTML = `<a href="${item.productUrl}" class="lightbox-product-link">${titleText}</a>`;
            } else {
                lightboxCaption.textContent = titleText;
            }
        }

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
                    productUrl: el.getAttribute('href') || '',
                };
            }
            return {
                type: 'image',
                src: el.dataset.src,
                title: el.dataset.title || '',
                productUrl: el.getAttribute('href') || '',
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
        if (!item || item.dataset.durationBadgeReady === '1') return;
        const videoUrl = item.dataset.videoUrl;
        const fallbackVideoUrl = item.dataset.videoFallbackUrl || videoUrl;
        if (!videoUrl) return;

        item.dataset.durationBadgeReady = '1';

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

        const previewFallback = mediaWrap.querySelector('.portfolio-preview-fallback');
        if (previewFallback) {
            try { previewFallback.pause(); } catch (_) {}
            previewFallback.style.display = 'none';
        }

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

    // Portfolio media interaction: one-at-a-time playback + click to open viewer.
    // Use event delegation for better support with dynamically loaded items
    const mainPortfolioGrid = document.getElementById('portfolioGrid');
    if (mainPortfolioGrid) {
        mainPortfolioGrid.addEventListener('click', (e) => {
            const item = e.target.closest('.portfolio-item');
            if (!item) return;

            const playIcon = e.target.closest('.portfolio-play-icon');
            const videoUrl = item.dataset.videoUrl;

            if (playIcon && videoUrl) {
                // Play inline if the play icon was clicked
                e.preventDefault();
                e.stopPropagation();
                toggleInlinePortfolioVideo(item);
                return;
            }

            // Otherwise open viewer
            e.preventDefault();
            openPortfolioMediaViewer(item, Boolean(videoUrl));
        });
    }

    // Still keep keydown for accessibility on individual items (or could delegate too)
    document.querySelectorAll('.portfolio-item').forEach((item) => {
        item.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            const videoUrl = item.dataset.videoUrl;
            if (videoUrl) {
                // For keyboard, maybe open viewer by default, or toggle inline?
                // Let's stick to opening viewer for consistency with click.
                openPortfolioMediaViewer(item, true);
            } else {
                openPortfolioMediaViewer(item, false);
            }
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
        currentGalleryCategoryId = '';
        currentGalleryCategoryName = 'Items';
        currentGalleryOffset = 0;
        currentGalleryHasMore = false;
        isGalleryLoadingMore = false;
        currentGalleryItems = [];
        updateGalleryLoadMoreUi();
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
 * Advances the bento cards in a single shared sequence so the
 * product range rotates card-by-card in order.
 */
let categoryBackgroundSequenceTimer = null;

function initCategoryBackgrounds() {
    const dataElement = document.getElementById('categoryImagesData');
    if (!dataElement) return;
    
    try {
        const categoryImages = JSON.parse(dataElement.textContent);
        const categoryCards = Array.from(document.querySelectorAll('.category-card'));
        if (!categoryCards.length) return;

        function setupCardSlider(card, cardStates) {
            if (!card || card.dataset.sliderInitialized === '1') return;
            const catId = card.dataset.category;
            const mediaItems = Array.isArray(categoryImages[catId]) ? categoryImages[catId] : [];
            const slider = card.querySelector('.category-slider');
            if (!slider || !mediaItems.length) return;

            card.dataset.sliderInitialized = '1';

            const placeholder = card.querySelector('.bg-placeholder');
            if (placeholder) placeholder.style.display = 'none';

            const displayMedia = mediaItems.slice(0, 6);
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
                    video.preload = 'none';
                    video.setAttribute('playsinline', '');
                    if (isObject && media.poster) {
                        video.poster = media.poster;
                    }
                    if (index === 0) video.classList.add('active');
                    slider.appendChild(video);
                } else {
                    const img = document.createElement('img');
                    img.src = mediaSrc;
                    img.alt = 'Sample ' + (index + 1);
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

            const state = {
                card,
                mediaElements,
                currentIndex: 0,
                isHoverPaused: false,
                isCardVisible: true,
            };
            cardStates.push(state);

            function activateMedia(nextIndex) {
                state.currentIndex = nextIndex;
                mediaElements.forEach((el, idx) => {
                    const isActive = idx === nextIndex;
                    el.classList.toggle('active', isActive);

                    if (el.tagName === 'VIDEO') {
                        if (isActive && isCardVisible) {
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

            activateMedia(0);

            card.addEventListener('mouseenter', () => {
                state.isHoverPaused = true;
            });
            card.addEventListener('mouseleave', () => {
                state.isHoverPaused = false;
            });

            if ('IntersectionObserver' in window) {
                const visibilityObserver = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                        state.isCardVisible = entry.isIntersecting;
                        if (state.isCardVisible) {
                            activateMedia(state.currentIndex);
                        } else {
                            mediaElements.forEach((el) => {
                                if (el.tagName === 'VIDEO') {
                                    el.pause();
                                    el.currentTime = 0;
                                }
                            });
                        }
                    });
                }, { root: null, threshold: 0.12 });
                visibilityObserver.observe(card);
            }

            return state;
        }

        const cardStates = [];

        categoryCards.forEach((card) => setupCardSlider(card, cardStates));

        if (categoryBackgroundSequenceTimer) {
            clearInterval(categoryBackgroundSequenceTimer);
            categoryBackgroundSequenceTimer = null;
        }

        if (cardStates.length > 0) {
            let sequenceIndex = 0;
            categoryBackgroundSequenceTimer = setInterval(() => {
                if (!cardStates.length) return;

                let attempts = 0;
                while (attempts < cardStates.length) {
                    const state = cardStates[sequenceIndex % cardStates.length];
                    sequenceIndex = (sequenceIndex + 1) % cardStates.length;
                    attempts += 1;

                    if (!state || state.mediaElements.length < 2 || state.isHoverPaused || !state.isCardVisible) {
                        continue;
                    }

                    const nextIndex = (state.currentIndex + 1) % state.mediaElements.length;
                    state.mediaElements.forEach((el, idx) => {
                        const isActive = idx === nextIndex;
                        el.classList.toggle('active', isActive);

                        if (el.tagName === 'VIDEO') {
                            if (isActive && state.isCardVisible) {
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
                    state.currentIndex = nextIndex;
                    break;
                }
            }, 2000);
        }

        if ('IntersectionObserver' in window) {
            const setupObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    setupCardSlider(entry.target, cardStates);
                    observer.unobserve(entry.target);
                });
            }, { root: null, rootMargin: '220px 0px', threshold: 0.01 });

            categoryCards.forEach((card) => setupObserver.observe(card));
        } else {
            categoryCards.forEach((card) => setupCardSlider(card, cardStates));
        }
    } catch (e) {
        console.warn('Could not parse category images data:', e);
    }
}

