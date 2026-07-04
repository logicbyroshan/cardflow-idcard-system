// Dashboard Page  UI animations, stat counters, hover effects
// Split from dashboard.js  see also dashboard-actions.js

window.DashboardPage = window.DashboardPage || {};

// Global: toggle expandable client row
function toggleClientExpandRow(tr) {
    var directUrl = tr.getAttribute('data-direct-url');
    if (directUrl) {
        window.location.href = directUrl;
        return;
    }

    var idx = tr.getAttribute('data-idx');
    var subRows = document.querySelectorAll('.expand-group-' + idx);
    if (!subRows.length) return;
    var isOpen = tr.classList.contains('expanded');
    // Close all other expand groups in same table
    var tbody = tr.closest('tbody');
    if (tbody) {
        tbody.querySelectorAll('.client-sub-row').forEach(function(r) { r.style.display = 'none'; });
        tbody.querySelectorAll('.client-row.expanded').forEach(function(r) { r.classList.remove('expanded'); });
    }
    if (!isOpen) {
        subRows.forEach(function(r) { r.style.display = ''; });
        tr.classList.add('expanded');
    }
}

// Global: toggle scoped expand rows (for print/reprint tables)
function toggleScopedExpandRow(tr) {
    var idx = tr.getAttribute('data-idx');
    var scope = tr.getAttribute('data-scope') || 'default';
    var subRows = document.querySelectorAll('.' + scope + '-expand-group-' + idx);
    if (!subRows.length) return;
    var isOpen = tr.classList.contains('expanded');
    // Close all other expand groups in same tbody
    var tbody = tr.closest('tbody');
    if (tbody) {
        tbody.querySelectorAll('.client-sub-row').forEach(function(r) { r.style.display = 'none'; });
        tbody.querySelectorAll('.client-row.expanded').forEach(function(r) { r.classList.remove('expanded'); });
    }
    if (!isOpen) {
        subRows.forEach(function(r) { r.style.display = ''; });
        tr.classList.add('expanded');
    }
}

// Expose on namespace
window.DashboardPage.toggleClientExpandRow = toggleClientExpandRow;
window.DashboardPage.toggleScopedExpandRow = toggleScopedExpandRow;

document.addEventListener('DOMContentLoaded', function() {
    const dashboardMiddleScroll = document.querySelector('.dashboard-middle-scroll');

    function syncDashboardPanelHeight() {
        if (!dashboardMiddleScroll) return;
        const panelHeight = dashboardMiddleScroll.clientHeight;
        if (panelHeight > 0) {
            document.documentElement.style.setProperty('--dashboard-panel-height', `${panelHeight}px`);
        }
    }

    syncDashboardPanelHeight();
    window.addEventListener('resize', syncDashboardPanelHeight);

    const dashboardMainColumn = document.getElementById('dashboardMainColumn');
    const dashboardTabButtons = Array.from(document.querySelectorAll('[data-dashboard-tab]'));
    const dashboardPanels = dashboardMainColumn
        ? Array.from(dashboardMainColumn.querySelectorAll('[data-dashboard-panel]'))
        : [];

    function activateDashboardPanel(panelKey) {
        if (!dashboardMainColumn || !panelKey) return;

        dashboardTabButtons.forEach(function(tabBtn) {
            const isActive = tabBtn.getAttribute('data-dashboard-tab') === panelKey;
            tabBtn.classList.toggle('is-active', isActive);
            tabBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        dashboardPanels.forEach(function(panel) {
            const isActive = panel.getAttribute('data-dashboard-panel') === panelKey;
            panel.classList.toggle('is-active', isActive);
            panel.hidden = !isActive;
        });

        try {
            localStorage.setItem('dashboard:active-panel', panelKey);
        } catch (_err) {}

        requestAnimationFrame(syncDashboardPanelHeight);
    }

    if (dashboardMainColumn && dashboardTabButtons.length && dashboardPanels.length) {
        dashboardMainColumn.classList.add('tabbed-layout');
        const availablePanelKeys = new Set(dashboardPanels.map(function(panel) {
            return panel.getAttribute('data-dashboard-panel');
        }));
        const defaultPanel = dashboardTabButtons.find(function(tabBtn) {
            return availablePanelKeys.has(tabBtn.getAttribute('data-dashboard-tab'));
        });
        let initialPanel = defaultPanel ? defaultPanel.getAttribute('data-dashboard-tab') : null;

        try {
            const storedPanel = localStorage.getItem('dashboard:active-panel');
            if (storedPanel && availablePanelKeys.has(storedPanel)) {
                initialPanel = storedPanel;
            }
        } catch (_err2) {}

        if (initialPanel) {
            activateDashboardPanel(initialPanel);
        }

        dashboardTabButtons.forEach(function(tabBtn) {
            tabBtn.addEventListener('click', function() {
                const panelKey = tabBtn.getAttribute('data-dashboard-tab');
                if (!availablePanelKeys.has(panelKey)) return;
                activateDashboardPanel(panelKey);
            });
        });

        window.DashboardPage.activateDashboardPanel = activateDashboardPanel;
    }
    
    // ====================
    // Update Welcome Banner Date/Time
    // ====================
    const welcomeDate = document.getElementById('welcomeDate');
    const welcomeTime = document.getElementById('welcomeTime');
    
    function updateWelcomeDateTime() {
        const now = new Date();
        
        // Format date: Sunday, Feb 01, 2026
        const options = { weekday: 'long', year: 'numeric', month: 'short', day: '2-digit' };
        const dateStr = now.toLocaleDateString('en-US', options);
        
        // Format time: 00:00:00
        const timeStr = now.toLocaleTimeString('en-US', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
        
        if (welcomeDate) welcomeDate.textContent = dateStr;
        if (welcomeTime) welcomeTime.textContent = timeStr;
    }
    
    // Update immediately, then via rAF (pauses when tab hidden)
    updateWelcomeDateTime();
    var _dashLastSec = -1;
    var _dashRafId = null;
    function _dashClockTick() {
        var now = new Date();
        var sec = now.getSeconds();
        if (sec !== _dashLastSec) {
            _dashLastSec = sec;
            updateWelcomeDateTime();
        }
        _dashRafId = requestAnimationFrame(_dashClockTick);
    }
    function _dashOnVis() {
        if (document.hidden) {
            if (_dashRafId) { cancelAnimationFrame(_dashRafId); _dashRafId = null; }
        } else {
            _dashLastSec = -1;
            if (!_dashRafId) _dashRafId = requestAnimationFrame(_dashClockTick);
        }
    }
    document.addEventListener('visibilitychange', _dashOnVis);
    _dashClockTick();
    
    // ====================
    // Animate Stat Cards on Load
    // ====================
    const statCards = document.querySelectorAll('.stat-card');
    statCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            card.style.transition = 'all 0.5s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 100);
    });
    
    // ====================
    // Animate Numbers
    // ====================
    function animateValue(element, start, end, duration) {
        const startTime = performance.now();
        const isFormatted = end.toString().includes(',');
        const endValue = parseInt(end.toString().replace(/,/g, ''));
        
        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            const current = Math.floor(start + (endValue - start) * easeOutQuart);
            
            if (isFormatted) {
                element.textContent = current.toLocaleString();
            } else {
                element.textContent = current;
            }
            
            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }
        
        requestAnimationFrame(update);
    }
    
    // Animate stat values - read actual values from DOM
    setTimeout(() => {
        const pendingCards = document.getElementById('pendingCards');
        const verifiedCards = document.getElementById('verifiedCards');
        const approvedCards = document.getElementById('approvedCards');
        const downloadedCards = document.getElementById('downloadedCards');
        const poolCards = document.getElementById('poolCards');
        
        // Read actual values from DOM, then animate from 0 to that value
        if (pendingCards) {
            const targetValue = parseInt(pendingCards.textContent.replace(/,/g, '')) || 0;
            animateValue(pendingCards, 0, targetValue, 1000);
        }
        if (verifiedCards) {
            const targetValue = parseInt(verifiedCards.textContent.replace(/,/g, '')) || 0;
            animateValue(verifiedCards, 0, targetValue, 1000);
        }
        if (approvedCards) {
            const targetValue = parseInt(approvedCards.textContent.replace(/,/g, '')) || 0;
            animateValue(approvedCards, 0, targetValue, 1200);
        }
        if (downloadedCards) {
            const targetValue = parseInt(downloadedCards.textContent.replace(/,/g, '')) || 0;
            animateValue(downloadedCards, 0, targetValue, 1500);
        }
        if (poolCards) {
            const targetValue = parseInt(poolCards.textContent.replace(/,/g, '')) || 0;
            animateValue(poolCards, 0, targetValue, 1400);
        }
    }, 500);
    
    // ====================
    // Quick Action Hover Effects
    // ====================
    const quickActionBtns = document.querySelectorAll('.quick-action-btn');
    quickActionBtns.forEach(btn => {
        btn.addEventListener('mouseenter', function() {
            this.querySelector('i').style.transform = 'scale(1.1)';
        });
        btn.addEventListener('mouseleave', function() {
            this.querySelector('i').style.transform = 'scale(1)';
        });
    });
    
    // ====================
    // Card Overview Hover
    // ====================
    const cardOverviewItems = document.querySelectorAll('.card-overview-item');
    cardOverviewItems.forEach(item => {
        item.style.cursor = 'pointer';
        item.addEventListener('mouseenter', function() {
            if (this.classList.contains('dashboard-tab-item')) return;
            this.style.background = 'linear-gradient(135deg, rgba(102, 126, 234, 0.08) 0%, rgba(118, 75, 162, 0.08) 100%)';
            this.style.borderColor = 'rgba(102, 126, 234, 0.2)';
        });
        item.addEventListener('mouseleave', function() {
            if (this.classList.contains('dashboard-tab-item')) return;
            this.style.background = '#fafbfc';
            this.style.borderColor = 'rgba(0, 0, 0, 0.04)';
        });
    });
    
    // ====================
    // Activity Item Hover
    // ====================
    const activityItems = document.querySelectorAll('.activity-item');
    activityItems.forEach(item => {
        item.addEventListener('mouseenter', function() {
            this.style.background = 'rgba(102, 126, 234, 0.04)';
            this.style.marginLeft = '-10px';
            this.style.marginRight = '-10px';
            this.style.paddingLeft = '10px';
            this.style.paddingRight = '10px';
            this.style.borderRadius = '8px';
        });
        item.addEventListener('mouseleave', function() {
            this.style.background = 'transparent';
            this.style.marginLeft = '0';
            this.style.marginRight = '0';
            this.style.paddingLeft = '0';
            this.style.paddingRight = '0';
        });
    });
    
    // ====================
    // Recent Table Row Hover
    // ====================
    const tableRows = document.querySelectorAll('.recent-table tbody tr');
    tableRows.forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', function() {
            // Could navigate to client details
        });
    });
    
    // ====================
    // Dashboard Cards Animation on Scroll
    // ====================
    const dashboardCards = document.querySelectorAll('.dashboard-card');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });
    
    dashboardCards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'all 0.5s ease';
        observer.observe(card);
    });
    
    // Trigger immediately for visible cards
    setTimeout(() => {
        dashboardCards.forEach(card => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        });
    }, 300);
    
    // NOTE: Global search (Ctrl+K) is now handled by global-search.js (standalone module)
});
