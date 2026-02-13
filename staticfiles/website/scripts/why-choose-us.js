/* ===== Why Choose Us Page JavaScript ===== */

document.addEventListener('DOMContentLoaded', function() {
    
    // --- 1. Counter Animation ---
    const counters = document.querySelectorAll('.stat-number');
    
    const animateCounter = (counter) => {
        const target = parseInt(counter.dataset.count);
        const duration = 2000;
        const startTime = performance.now();
        
        const update = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const value = Math.floor(progress * target);
            
            counter.textContent = value + (target === 100 ? '%' : '+');
            
            if (progress < 1) {
                requestAnimationFrame(update);
            }
        };
        requestAnimationFrame(update);
    };

    const counterObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                counterObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(c => counterObserver.observe(c));

    // --- 2. FAQ Accordion ---
    const faqItems = document.querySelectorAll('.faq-item');
    
    faqItems.forEach(item => {
        item.querySelector('.faq-question').addEventListener('click', () => {
            const wasActive = item.classList.contains('active');
            
            // Close all others
            faqItems.forEach(i => i.classList.remove('active'));
            
            // Toggle current
            if (!wasActive) {
                item.classList.add('active');
            }
        });
    });

    // --- 3. Reveal on Scroll ---
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
            }
        });
    });

    document.querySelectorAll('.feature-card, .stat-item, .faq-item').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'all 0.6s ease-out';
        revealObserver.observe(el);
    });

    // Add CSS for animation dynamically
    const style = document.createElement('style');
    style.innerHTML = `
        .animate-in { opacity: 1 !important; transform: translateY(0) !important; }
        .faq-item.active .faq-answer { display: block; padding-top: 10px; }
        .faq-item.active i { transform: rotate(45deg); }
    `;
    document.head.appendChild(style);
});