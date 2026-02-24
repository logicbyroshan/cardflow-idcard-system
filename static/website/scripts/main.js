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
    let isDeleting = false;

    function esc(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function getFullText(line) {
        return line.before + line.product + line.after;
    }

    function renderLine(line, chars) {
        const bLen = line.before.length;
        const pLen = line.product.length;
        const full = getFullText(line);
        const visible = full.substring(0, chars);

        if (chars <= bLen) {
            return esc(visible);
        } else if (chars <= bLen + pLen) {
            return esc(line.before) + '<span class="typing-highlight">' + esc(visible.substring(bLen)) + '</span>';
        } else {
            return esc(line.before) + '<span class="typing-highlight">' + esc(line.product) + '</span>' + esc(visible.substring(bLen + pLen));
        }
    }

    function type() {
        const currentLine = lines[lineIndex];
        const fullText = getFullText(currentLine);
        let speed;

        if (isDeleting) {
            charIndex--;
            speed = 30;
        } else {
            charIndex++;
            speed = 70;
        }

        typingEl.innerHTML = renderLine(currentLine, charIndex);

        if (!isDeleting && charIndex === fullText.length) {
            speed = 2200;
            isDeleting = true;
        } else if (isDeleting && charIndex === 0) {
            isDeleting = false;
            lineIndex = (lineIndex + 1) % lines.length;
            speed = 400;
        }

        setTimeout(type, speed);
    }

    setTimeout(type, 800);
}

// ===== 3. Mobile Menu Toggle =====
function initMobileMenu() {
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');

    if (!hamburger) return;

    hamburger.addEventListener('click', (e) => {
        e.stopPropagation();
        navLinks.classList.toggle('active');
        hamburger.classList.toggle('active');
    });

    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('active');
            hamburger.classList.remove('active');
        });
    });

    document.addEventListener('click', (e) => {
        if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
            navLinks.classList.remove('active');
            hamburger.classList.remove('active');
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

    document.querySelectorAll('.bento-card, .work-item, .testimonial-card, .info-box, .download-app-wrapper').forEach(el => {
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

    // QR code points to the website root — user opens in browser → can install PWA → goes to login
    const siteUrl = window.location.origin + '/';
    qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&color=100F57&data=' + encodeURIComponent(siteUrl);
}

// ===== 7. PWA Install Trigger =====
function triggerPwaInstall() {
    if (window.__pwaInstallPrompt) {
        // Native install prompt available (Chrome/Edge on Android/Desktop)
        window.__pwaInstallPrompt.prompt();
        window.__pwaInstallPrompt.userChoice.then(function(choice) {
            if (choice.outcome === 'accepted') {
                console.log('PWA install accepted');
            }
            window.__pwaInstallPrompt = null;
        });
    } else if (window.__panelUrl) {
        // Redirect to panel login — PWA install happens from the panel subdomain
        window.location.href = window.__panelUrl + '/auth/login/';
    } else {
        // Fallback for local dev: redirect to panel login
        window.location.href = window.location.origin + '/panel/auth/login/';
    }
}

// ===== Initialize Everything =====
document.addEventListener('DOMContentLoaded', () => {
    initHeroSlider();
    initTypingEffect();
    initMobileMenu();
    initScrollEffects();
    createScrollTopButton();
    initPhoneSlideshow();
    initQrCode();
});