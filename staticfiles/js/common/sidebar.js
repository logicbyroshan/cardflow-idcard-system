/**
 * Common Sidebar Module
 * Provides unified sidebar toggle functionality across all pages
 * 
 * @module common/sidebar
 * @version 1.0.0
 */

(function() {
    'use strict';

    // ==========================================
    // STATE
    // ==========================================
    
    let initialized = false;

    // ==========================================
    // SIDEBAR FUNCTIONALITY
    // ==========================================

    /**
     * Initialize sidebar toggle functionality
     */
    function initSidebar() {
        if (initialized) return;

        const sidebar = document.getElementById('sidebar');
        const sidebarToggle = document.getElementById('sidebarToggle');

        if (!sidebar || !sidebarToggle) return;

        // Check localStorage for saved state
        const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
        
        if (isCollapsed) {
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
            sidebarToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
        } else {
            sidebar.classList.remove('collapsed');
            document.body.classList.remove('sidebar-collapsed');
            sidebarToggle.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        }

        // Toggle button click handler
        sidebarToggle.addEventListener('click', function() {
            toggleSidebar();
        });

        // Keyboard shortcuts: C to collapse, V to expand
        document.addEventListener('keydown', function(e) {
            // Don't trigger if user is typing in an input/textarea
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }

            if (e.key.toLowerCase() === 'c' && !sidebar.classList.contains('collapsed')) {
                collapseSidebar();
            } else if (e.key.toLowerCase() === 'v' && sidebar.classList.contains('collapsed')) {
                expandSidebar();
            }
        });

        initialized = true;
    }

    /**
     * Toggle sidebar collapsed state
     */
    function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        if (sidebar.classList.contains('collapsed')) {
            expandSidebar();
        } else {
            collapseSidebar();
        }
    }

    /**
     * Collapse sidebar
     */
    function collapseSidebar() {
        const sidebar = document.getElementById('sidebar');
        const sidebarToggle = document.getElementById('sidebarToggle');
        
        if (!sidebar) return;

        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', 'true');
        
        if (sidebarToggle) {
            sidebarToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
        }

        // Dispatch event
        document.dispatchEvent(new CustomEvent('sidebar:collapsed'));
    }

    /**
     * Expand sidebar
     */
    function expandSidebar() {
        const sidebar = document.getElementById('sidebar');
        const sidebarToggle = document.getElementById('sidebarToggle');
        
        if (!sidebar) return;

        sidebar.classList.remove('collapsed');
        document.body.classList.remove('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', 'false');
        
        if (sidebarToggle) {
            sidebarToggle.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        }

        // Dispatch event
        document.dispatchEvent(new CustomEvent('sidebar:expanded'));
    }

    /**
     * Check if sidebar is collapsed
     * @returns {boolean}
     */
    function isCollapsed() {
        const sidebar = document.getElementById('sidebar');
        return sidebar?.classList.contains('collapsed') || false;
    }

    /**
     * Set active link in sidebar based on current URL
     * @param {string} linkId - ID of the link to activate (optional, will auto-detect if not provided)
     */
    function setActiveLink(linkId = null) {
        const pathname = window.location.pathname;
        
        // Remove all active classes first
        document.querySelectorAll('.sidebar-nav a').forEach(link => {
            link.classList.remove('active');
        });

        if (linkId) {
            const link = document.getElementById(linkId);
            if (link) {
                link.classList.add('active');
            }
            return;
        }

        // Auto-detect based on URL patterns
        const activeClientsLink = document.getElementById('activeClientsLink');
        const allClientsLink = document.getElementById('allClientsLink');
        const dashboardLink = document.getElementById('dashboardLink');
        const staffLink = document.getElementById('staffLink');
        const settingsLink = document.getElementById('settingsLink');

        if (pathname.includes('active-clients') || pathname.includes('/client/') || pathname.includes('/group/')) {
            if (activeClientsLink) activeClientsLink.classList.add('active');
        } else if (pathname.includes('manage-clients')) {
            if (allClientsLink) allClientsLink.classList.add('active');
        } else if (pathname.includes('manage-staff')) {
            if (staffLink) staffLink.classList.add('active');
        } else if (pathname.includes('settings')) {
            if (settingsLink) settingsLink.classList.add('active');
        } else if (pathname === '/panel/' || pathname.includes('dashboard')) {
            if (dashboardLink) dashboardLink.classList.add('active');
        }
    }

    // ==========================================
    // DATE/TIME DISPLAY
    // ==========================================

    let dateTimeInterval = null;

    /**
     * Initialize date/time display in topbar
     */
    function initDateTime() {
        updateDateTime();
        
        // Clear existing interval if any
        if (dateTimeInterval) {
            clearInterval(dateTimeInterval);
        }
        
        dateTimeInterval = setInterval(updateDateTime, 1000);
    }

    /**
     * Update date/time display
     */
    function updateDateTime() {
        const now = new Date();

        const dateEl = document.getElementById('date');
        const timeEl = document.getElementById('time');

        if (dateEl) {
            dateEl.innerText = now.toLocaleDateString('en-US', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
        }

        if (timeEl) {
            timeEl.innerText = now.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        }
    }

    // ==========================================
    // AUTO-INITIALIZE
    // ==========================================

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            initSidebar();
            initDateTime();
            setActiveLink();
        });
    } else {
        initSidebar();
        initDateTime();
        setActiveLink();
    }

    // ==========================================
    // EXPOSE API
    // ==========================================

    window.AdarshSidebar = {
        init: initSidebar,
        toggle: toggleSidebar,
        collapse: collapseSidebar,
        expand: expandSidebar,
        isCollapsed: isCollapsed,
        setActiveLink: setActiveLink,
        initDateTime: initDateTime,
        updateDateTime: updateDateTime
    };

    // Legacy compatibility
    window.initSidebar = initSidebar;
    window.updateDateTime = updateDateTime;

})();
