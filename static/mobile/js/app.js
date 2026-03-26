/**
 * ID Card Manager - Mobile PWA JavaScript
 */

// Service Worker is registered in base.html via Django-served endpoint
// (ensures Service-Worker-Allowed header is set for scope '/')

// Device restriction is handled in mobile_app/base.html via checkDevice().

// Prevent zoom on double-tap
let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    const target = event.target;
    if (target && target.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
    }
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);

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

// Lightweight confirm helper used across mobile templates.
// Returns Promise<boolean> so existing `await showConfirm(...)` calls keep working.
window.showConfirm = function showConfirm(options) {
    var text = (options && options.text) || 'Are you sure?';
    var title = (options && options.title) || '';
    var message = title ? (title + '\n\n' + text) : text;
    return Promise.resolve(window.confirm(message));
};
