/**
 * Adarsh ID Cards - Main JavaScript
 * Handles: Slider, Mobile Menu, Typing Effect, AJAX Forms, and Scroll Animations
 */

// ===== 1. Dynamic Hero Slider =====
function initHeroSlider() {
    const sliderImg = document.getElementById('slider-img');
    const card = document.querySelector('.slide-card');
    const dots = document.querySelectorAll('.dot');
    const titleEl = document.getElementById('slider-title') || document.querySelector('.card-info h3');
    const subtitleEl = document.getElementById('slider-subtitle') || document.querySelector('.card-info p');

    if (!sliderImg || dots.length === 0) return;

    function updateSlider(index) {
        const targetDot = dots[index];
        const newUrl = targetDot.getAttribute('data-url');
        
        if (!newUrl) return;

        const newTitle = targetDot.getAttribute('data-title');
        const newSubtitle = targetDot.getAttribute('data-subtitle');

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
            }, 600);
        }, 300);
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

// ===== 2. Hero Typing Effect =====
function initTypingEffect() {
    const typingEl = document.getElementById('typingText');
    if (!typingEl) return;

    const words = ['ID Cards', 'Digital Lanyards', 'Certificates', 'Marksheets', 'Fee Cards', 'RFID Cards'];
    let wordIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let typingSpeed = 100;

    function type() {
        const currentWord = words[wordIndex];

        if (isDeleting) {
            typingEl.textContent = currentWord.substring(0, charIndex - 1);
            charIndex--;
            typingSpeed = 50;
        } else {
            typingEl.textContent = currentWord.substring(0, charIndex + 1);
            charIndex++;
            typingSpeed = 120;
        }

        if (!isDeleting && charIndex === currentWord.length) {
            // Pause at end of word
            typingSpeed = 2000;
            isDeleting = true;
        } else if (isDeleting && charIndex === 0) {
            isDeleting = false;
            wordIndex = (wordIndex + 1) % words.length;
            typingSpeed = 300;
        }

        setTimeout(type, typingSpeed);
    }

    // Start typing after a short delay
    setTimeout(type, 1000);
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

// ===== Initialize Everything =====
document.addEventListener('DOMContentLoaded', () => {
    initHeroSlider();
    initTypingEffect();
    initMobileMenu();
    initScrollEffects();
    createScrollTopButton();
});