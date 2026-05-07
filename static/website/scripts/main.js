/**
 * Adarsh ID Cards - Main JavaScript
 * Handles: Slider, Mobile Menu, Typing Effect, AJAX Forms, Phone Slideshow, and Scroll Animations
 */

// ===== 1. Dynamic Hero Slider (Crossfade) =====
function initHeroSlider() {
    const sliderImg = document.getElementById('slider-img');
    const card = document.querySelector('.slide-card');
    const dots = document.querySelectorAll('.dot');
    const titleEl = document.getElementById('slider-title') || document.querySelector('.card-info h3');
    const subtitleEl = document.getElementById('slider-subtitle') || document.querySelector('.card-info p');

    if (!sliderImg || dots.length === 0) return;

    // Preload all images for seamless transitions
    dots.forEach(dot => {
        const url = dot.getAttribute('data-url');
        if (url) { const img = new Image(); img.src = url; }
    });

    let isAnimating = false;

    function updateSlider(index) {
        if (isAnimating) return;
        const targetDot = dots[index];
        const newUrl = targetDot.getAttribute('data-url');
        if (!newUrl || sliderImg.src.endsWith(newUrl.split('/').pop())) return;

        const newTitle = targetDot.getAttribute('data-title');
        const newSubtitle = targetDot.getAttribute('data-subtitle');

        isAnimating = true;
        card.classList.add('push-out');

        setTimeout(() => {
            sliderImg.src = newUrl;
            if (titleEl && newTitle) titleEl.textContent = newTitle;
            if (subtitleEl && newSubtitle) subtitleEl.textContent = newSubtitle;

            dots.forEach(d => d.classList.remove('active'));
            targetDot.classList.add('active');

            card.classList.remove('push-out');
            card.classList.add('push-in');

            setTimeout(() => {
                card.classList.remove('push-in');
                isAnimating = false;
            }, 500);
        }, 500);
    }

    let currentSlide = 0;

    let slideInterval = setInterval(() => {
        currentSlide = (currentSlide + 1) % dots.length;
        updateSlider(currentSlide);
    }, 5000);

    dots.forEach((dot, idx) => {
        dot.addEventListener('click', () => {
            clearInterval(slideInterval);
            updateSlider(idx);
            currentSlide = idx;
            slideInterval = setInterval(() => {
                currentSlide = (currentSlide + 1) % dots.length;
                updateSlider(currentSlide);
            }, 5000);
        });
    });
}

// ===== 2. Hero Typing Effect (Full-Line with Highlighted Product) =====
function initTypingEffect() {
    const typingEl = document.getElementById('typingLine');
    if (!typingEl) return;

    const lines = [
        { before: 'Professional ', product: 'ID Cards', after: ' for Your School' },
        { before: 'Custom ', product: 'Digital Lanyards', after: ' for Your College' },
        { before: 'Premium ', product: 'Badges', after: ' for Your Institution' },
        { before: 'Elegant ', product: 'Invitation Cards', after: ' for Your Event' },
        { before: 'Official ', product: 'Certificates', after: ' for Your Academy' },
        { before: 'Detailed ', product: 'Marksheets', after: ' for Your School' },
        { before: 'Comprehensive ', product: 'Report Cards', after: ' for Your Institute' },
        { before: 'Creative ', product: 'Diaries', after: ' for Your Students' },
        { before: 'Custom ', product: 'Calendars', after: ' for Your Organization' },
        { before: 'Stunning ', product: 'Brochures', after: ' for Your Business' },
    ];

    let lineIndex = 0;
    let charIndex = 0;
    const TYPE_SPEED = 68;
    const HOLD_SPEED = 1800;

    function esc(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function getFirstLineText(line) {
        return line.before + line.product;
    }

    function getFullText(line) {
        return getFirstLineText(line) + line.after;
    }

    function renderFirstLine(line, charsInFirstLine) {
        const beforeLen = line.before.length;
        const firstLine = getFirstLineText(line);

        if (charsInFirstLine <= beforeLen) {
            return esc(firstLine.substring(0, charsInFirstLine));
        }

        return (
            esc(line.before) +
            '<span class="typing-highlight">' +
            esc(firstLine.substring(beforeLen, charsInFirstLine)) +
            '</span>'
        );
    }

    function renderCursor() {
        return '<span class="typing-cursor typing-cursor-inline" aria-hidden="true"></span>';
    }

    function renderLine(line, charsTyped) {
        const firstLine = getFirstLineText(line);
        const firstLineLen = firstLine.length;

        if (charsTyped <= firstLineLen) {
            return '<span class="typing-line-one">' + renderFirstLine(line, charsTyped) + renderCursor() + '</span>';
        }

        const secondLineChars = charsTyped - firstLineLen;
        const secondLineHtml = esc(line.after.substring(0, secondLineChars));

        return (
            '<span class="typing-line-one">' + renderFirstLine(line, firstLineLen) + '</span>' +
            '<span class="typing-line-two">' + secondLineHtml + renderCursor() + '</span>'
        );
    }

    function type() {
        const currentIndex = lineIndex;
        const currentLine = lines[currentIndex];
        const fullText = getFullText(currentLine);
        let speed = TYPE_SPEED;
        let charsToRender;

        if (charIndex < fullText.length) {
            charIndex += 1;
            charsToRender = charIndex;
        } else {
            // Keep the fully typed sentence visible before switching to the next.
            charsToRender = fullText.length;
            speed = HOLD_SPEED;
            lineIndex = (lineIndex + 1) % lines.length;
            charIndex = 0;
        }

        typingEl.innerHTML = renderLine(currentLine, charsToRender);
        // Apply gradient class based on current line index
        typingEl.className = 'typing-gradient-' + currentIndex;

        setTimeout(type, speed);
    }

    setTimeout(type, 800);
}

// ===== 3. Mobile Menu Toggle =====
function initMobileMenu() {
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');
    const overlay = document.querySelector('.mobile-menu-overlay');
    const closeBtn = document.querySelector('.mobile-menu-close');

    if (!hamburger || !navLinks) return;

    function setMenuState(isOpen) {
        navLinks.classList.toggle('active', isOpen);
        hamburger.classList.toggle('active', isOpen);
        hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        document.body.classList.toggle('mobile-menu-open', isOpen);
        document.documentElement.classList.toggle('mobile-menu-open', isOpen);
        if (overlay) {
            overlay.classList.toggle('active', isOpen);
        }
    }

    function closeMenu() {
        setMenuState(false);
    }

    hamburger.addEventListener('click', (e) => {
        e.stopPropagation();
        setMenuState(!navLinks.classList.contains('active'));
    });

    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', () => {
            closeMenu();
        });
    });

    if (overlay) {
        overlay.addEventListener('click', closeMenu);
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeMenu);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeMenu();
        }
    });

    document.addEventListener('click', (e) => {
        if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
            closeMenu();
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 999) {
            closeMenu();
        }
    });
}

// ===== 4. UI Enhancements (Scroll, Observers) =====

function initScrollEffects() {
    const navbar = document.querySelector('.navbar');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('reveal-active');
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.bento-card, .work-item, .testimonial-card, .info-box, .download-app-wrapper, .section-title, .contact-wrapper, .trusted-schools, .faq-item, .page-hero, .section-header, .filter-tabs, .rating-card, .gallery-item').forEach(el => {
        el.classList.add('reveal-on-scroll');
        observer.observe(el);
    });
}

function createScrollTopButton() {
    const btn = document.createElement('button');
    btn.innerHTML = '<i class="fas fa-chevron-up"></i>';
    btn.className = 'scroll-top-btn';
    document.body.appendChild(btn);

    window.addEventListener('scroll', () => {
        btn.style.display = window.scrollY > 400 ? 'flex' : 'none';
    });

    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// ===== 5. PWA Phone Mockup Slideshow =====
function initPhoneSlideshow() {
    const slides = document.querySelectorAll('.phone-slide');
    if (slides.length === 0) return;

    let current = 0;
    setInterval(() => {
        slides[current].classList.remove('active');
        current = (current + 1) % slides.length;
        slides[current].classList.add('active');
    }, 3000);
}

// ===== 6. Dynamic QR Code =====
function initQrCode() {
    const qrImg = document.getElementById('appQrCode');
    if (!qrImg) return;
    if (qrImg.dataset.static === 'true') return;

    // QR code points to the mobile app — user opens in Chrome → installs PWA
    const appUrl = window.__panelUrl ? (window.__panelUrl + '/app/') : (window.location.origin + '/app/');
    qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&color=100F57&data=' + encodeURIComponent(appUrl);
}

// ===== 7. Landing CTA App Link =====
function initAppCtaLink() {
    const cta = document.getElementById('openAppCta');
    if (!cta) return;

    const panelUrl = (window.__panelUrl || '').trim();
    const appUrl = panelUrl ? (panelUrl.replace(/\/$/, '') + '/app/') : (window.location.origin + '/app/');
    cta.setAttribute('href', appUrl);
}

// ===== 7. Logo Spin Animation (repeat every 10 seconds) =====
function initLogoSpin() {
    const logoImg = document.querySelector('.logo-img');
    if (!logoImg) return;

    function spin() {
        logoImg.style.animation = 'none';
        // Force reflow
        void logoImg.offsetHeight;
        logoImg.style.animation = 'logoSpin 1s ease-in-out';
    }

    // First spin after 3 seconds, then every 5 seconds
    setTimeout(function() {
        spin();
        setInterval(spin, 5000);
    }, 3000);
}

// ===== 9. Glowing Border Rotation (fallback for browsers without @property) =====
function initGlowBorder() {
    const slideCard = document.querySelector('.slide-card');
    if (!slideCard) return;
    // Check if @property is supported
    if (typeof CSS === 'undefined' || !CSS.registerProperty) {
        let angle = 0;
        function updateAngle() {
            angle = (angle + 2) % 360;
            slideCard.style.setProperty('--glow-angle', angle + 'deg');
            requestAnimationFrame(updateAngle);
        }
        slideCard.style.animation = 'none';
        requestAnimationFrame(updateAngle);
    }
}

// ===== Initialize Everything =====
document.addEventListener('DOMContentLoaded', () => {
    initHeroSlider();
    initMobileMenu();
    initTypingEffect();
    if ('requestIdleCallback' in window) {
        requestIdleCallback(runNonCriticalFeatures, { timeout: 1000 });
    } else {
        setTimeout(runNonCriticalFeatures, 1000);
    }
});

function runNonCriticalFeatures() {
    initScrollEffects();
    createScrollTopButton();
    initPhoneSlideshow();
    initQrCode();
    initAppCtaLink();
    initLogoSpin();
    initGlowBorder();
}