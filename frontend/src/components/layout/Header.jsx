import React, { useState, useEffect, useCallback } from 'react';
import { Search, Bell, ChevronDown, Home, LogOut, Heart, Clock } from 'lucide-react';
import { dashboardApi } from '../../services/api';

/*
  Exact replica of base.html <header class="topbar">:
  - Left: Welcome message + Blue Heart + Live Time & Date Badge
  - Right: Presence pills + Global Search + User Profile Dropdown
*/

const PAGE_LABELS = {
  dashboard:    'Manage Dashboard',
  cards:        'Tables',
  reprints:     'Reprint Queue',
  organisations:'Manage Organisation',
  clients:      'Manage Manager',
  staff:        'Manage Operator',
  assistants:   'Manage Assistant',
  photographers:'Manage Photographer',
  schema:       'Table Setting',
  panel:        'Manage CardFlow',

  tutorial:     'Tutorial',
  settings:     'Settings',
  pro:          'Manage Pro Features',

};

export default function Header({
  activeTab = 'dashboard',
  searchQuery, setSearchQuery,
  currentUser, userRole, onLogout,
}) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [presenceStats, setPresenceStats] = useState({ desktop: 0, mobile: 0, never: 0 });
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedDate = time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const formattedTime = time.toLocaleTimeString('en-US', { hour12: false });

  const fetchUnread = useCallback(async () => {
    try {
      const data = await dashboardApi.getUnreadCount();
      setUnreadCount(data.count ?? data.unread_count ?? 0);

      const statsData = await dashboardApi.getStats?.();
      if (statsData) {
        const s = statsData.stats || statsData;
        setPresenceStats({
          desktop: s.desktop_active_users ?? s.desktop_active ?? 0,
          mobile: s.mobile_active_users ?? s.mobile_active ?? 0,
          never: s.never_active_users ?? s.never_active ?? 0,
        });
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchUnread();
    const t = setInterval(fetchUnread, 60_000);
    return () => clearInterval(t);
  }, [fetchUnread]);

  const displayName = (
    currentUser?.name ||
    currentUser?.full_name ||
    (currentUser?.first_name ? `${currentUser.first_name} ${currentUser.last_name || ''}`.trim() : null) ||
    currentUser?.username ||
    'System Admin'
  );

  const pageLabel = PAGE_LABELS[activeTab] || activeTab;

  return (
    <header className="topbar" id="topbar" style={{ height: '50px', background: '#1e1e2e', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', boxSizing: 'border-box' }}>
      {/* Left: Live Time & Date Badge + Animated Blue Heart + Welcome + Name */}
      <div className="nav-left" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* 1. Live Date & Time Button Badge */}
        <div style={{
          padding: '0 10px',
          height: '28px',
          borderRadius: '5px',
          border: '1px solid rgba(59, 130, 246, 0.35)',
          background: 'linear-gradient(135deg, #1e3a8a 0%, #1e293b 100%)',
          color: '#ffffff',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          fontWeight: 600,
          boxSizing: 'border-box',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
        }}>
          <Clock size={12} style={{ color: '#60a5fa' }} />
          <span style={{ color: '#bfdbfe' }}>{formattedDate}</span>
          <span style={{ color: '#ffffff', fontWeight: 700 }}>{formattedTime}</span>
        </div>

        {/* 2. Animated Blue Heart + Welcome + Name */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
          <Heart size={14} fill="#3b82f6" color="#3b82f6" className="heart-pulse-anim" />
          <span>Welcome</span>
          <strong style={{ color: '#60a5fa', fontWeight: 700 }}>{displayName}</strong>
        </div>
      </div>



      {/* Right: active user status pills + global search + notification bell */}
      <div className="nav-right" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
        {/* Status Pills matching dark navbar theme */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
          <span style={{ padding: '0 10px', height: '28px', borderRadius: '5px', border: '1px solid #2563eb', background: '#1e3a8a', color: '#93c5fd', display: 'inline-flex', alignItems: 'center', gap: '5px', boxSizing: 'border-box' }}>
            Total Desktop Active: <strong style={{ color: '#ffffff' }}>{presenceStats.desktop}</strong>
          </span>
          <span style={{ padding: '0 10px', height: '28px', borderRadius: '5px', border: '1px solid #ea580c', background: '#7c2d12', color: '#fdba74', display: 'inline-flex', alignItems: 'center', gap: '5px', boxSizing: 'border-box' }}>
            Total Mobile Active: <strong style={{ color: '#ffffff' }}>{presenceStats.mobile}</strong>
          </span>
          <span style={{ padding: '0 10px', height: '28px', borderRadius: '5px', border: '1px solid #475569', background: '#1e293b', color: '#cbd5e1', display: 'inline-flex', alignItems: 'center', gap: '5px', boxSizing: 'border-box' }}>
            Total Never Active: <strong style={{ color: '#ffffff' }}>{presenceStats.never}</strong>
          </span>
        </div>

        {/* Global search button */}
        <button
          className="global-search-btn"
          onClick={() => setSearchQuery?.('')}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px', border: '1px solid rgba(255, 255, 255, 0.2)', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '5px', minWidth: '180px', height: '28px', padding: '0 10px', fontSize: '12px', color: '#cbd5e1', fontFamily: 'var(--font-family)', boxSizing: 'border-box' }}
        >
          <Search size={12} style={{ color: '#94a3b8' }} />
          <span style={{ flex: 1, textAlign: 'left' }}>Search ID cards...</span>
          <kbd style={{ fontFamily: 'var(--font-family)', border: '1px solid rgba(255, 255, 255, 0.2)', background: 'rgba(255, 255, 255, 0.1)', color: '#cbd5e1', borderRadius: '3px', padding: '1px 5px', fontSize: '10px', fontWeight: 500 }}>
            Ctrl+K
          </kbd>
        </button>



        {/* User dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowUserMenu((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: '#2563eb', border: 'none',
              cursor: 'pointer', height: '28px', padding: '0 8px',
              borderRadius: '5px', transition: 'background 0.15s',
              fontFamily: 'var(--font-family)', color: '#ffffff', boxSizing: 'border-box'
            }}
          >
            <div style={{
              width: '18px', height: '18px', borderRadius: '3px',
              background: 'rgba(255, 255, 255, 0.25)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '10px', fontWeight: 800, flexShrink: 0,
            }}>
              {displayName[0]?.toUpperCase() || 'A'}
            </div>
            <span style={{ fontSize: '12px', color: '#ffffff', fontWeight: 600, maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </span>
            <ChevronDown size={11} color="#ffffff" />
          </button>

          {showUserMenu && (
            <div
              onMouseLeave={() => setShowUserMenu(false)}
              style={{
                position: 'absolute', right: 0, top: 'calc(100% + 2px)',
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px',
                boxShadow: '0 8px 20px rgba(0,0,0,0.12)', minWidth: '160px',
                zIndex: 100, overflow: 'hidden', animation: 'fadeIn 0.12s ease',
              }}
            >
              <div style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>{displayName}</div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '1px', textTransform: 'capitalize' }}>{(userRole || '').replace('_', ' ')}</div>
              </div>
              <button
                onClick={() => { setShowUserMenu(false); onLogout?.(); }}
                style={{
                  width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                  color: '#ef4444', fontSize: '13px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '6px', textAlign: 'left',
                  fontFamily: 'var(--font-family)',
                }}
              >
                <LogOut size={13} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}


