/**
 * ID Card Manager - Mobile PWA JavaScript
 */

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/static/mobile/sw.js')
            .then(reg => console.log('SW registered:', reg.scope))
            .catch(err => console.log('SW registration failed:', err));
    });
}

// Device detection - block desktop
function enforceDeviceRestriction() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        || (window.innerWidth <= 768);
    
    const mobileApp = document.getElementById('mobile-app');
    const desktopBlock = document.getElementById('desktop-block');
    
    if (mobileApp && desktopBlock) {
        if (!isMobile) {
            mobileApp.style.display = 'none';
            desktopBlock.style.display = 'flex';
        } else {
            mobileApp.style.display = 'block';
            desktopBlock.style.display = 'none';
        }
    }
}

window.addEventListener('resize', enforceDeviceRestriction);

// Prevent zoom on double-tap
let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);

// Haptic feedback simulation (for supported devices)
function hapticFeedback(type = 'light') {
    if ('vibrate' in navigator) {
        switch (type) {
            case 'light':
                navigator.vibrate(10);
                break;
            case 'medium':
                navigator.vibrate(20);
                break;
            case 'heavy':
                navigator.vibrate([30, 10, 30]);
                break;
        }
    }
}

// Add haptic to all buttons
document.addEventListener('click', function(e) {
    if (e.target.closest('button, a, .grid-card')) {
        hapticFeedback('light');
    }
});

// Smooth scroll polyfill for older mobile browsers
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});

console.log('%c🃏 ID Card Manager Mobile PWA', 'color: #667eea; font-size: 16px; font-weight: bold;');
