import React, { useState, useEffect, useCallback } from 'react';
import { Search, Bell, ChevronDown, Home, LogOut } from 'lucide-react';
import { dashboardApi } from '../../services/api';

/*
  Exact replica of base.html <header class="topbar">:
  - Left: sidebar-toggle (hamburger) + breadcrumb
  - Right: global-search-btn (Ctrl+K trigger) + notification bell
*/

const PAGE_LABELS = {
  dashboard:    'Dashboard',
  cards:        'ID Card Group',
  reprints:     'Reprint Queue',
  clients:      'Manage Clients',
  staff:        'Manage Operator',
  assistants:   'Manage Assistant',
  photographers:'Manage Captures',
  schema:       'Group Setting',
  panel:        'Manage Panel',
  tutorial:     'Tutorial',
  settings:     'Settings',
  pro:          'Manage Features',
};

export default function Header({
  activeTab = 'dashboard',
  searchQuery, setSearchQuery,
  currentUser, userRole, onLogout,
}) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [presenceStats, setPresenceStats] = useState({ desktop: 0, mobile: 0, never: 0 });

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

  const displayName = currentUser?.first_name
    ? `${currentUser.first_name} ${currentUser.last_name || ''}`.trim()
    : (currentUser?.username || 'Admin');

  const pageLabel = PAGE_LABELS[activeTab] || activeTab;

  return (
    <header className="topbar" id="topbar">
      {/* Left: breadcrumb only — sidebar is always open, no hamburger */}
      <div className="nav-left">
        <div className="breadcrumb">
          {/* Home icon */}
          <span className="breadcrumb-item" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <Home size={12} />
          </span>
          {activeTab === 'dashboard' ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              padding: '2px 8px', borderRadius: '4px',
              background: 'linear-gradient(135deg, rgb(0,80,210) 0%, rgb(0,180,255) 100%)',
              color: '#fff',
              fontSize: '11px', fontWeight: 700,
              letterSpacing: '0.02em',
              boxShadow: '0 1px 4px rgba(0,80,210,0.25)',
            }}>
              Dashboard
            </span>
          ) : (
            <>
              <span className="breadcrumb-sep">›</span>
              <span className="breadcrumb-item active">{pageLabel}</span>
            </>
          )}
        </div>
      </div>



      {/* Right: active user status pills + global search + notification bell */}
      <div className="nav-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Status Pills matching SS2 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
          <span style={{ padding: '2px 8px', borderRadius: '4px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            Total Desktop Active: <strong>{presenceStats.desktop}</strong>
          </span>
          <span style={{ padding: '2px 8px', borderRadius: '4px', border: '1px solid #fed7aa', background: '#fff7ed', color: '#c2410c', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            Total Mobile Active: <strong>{presenceStats.mobile}</strong>
          </span>
          <span style={{ padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            Total Never Active: <strong>{presenceStats.never}</strong>
          </span>
        </div>

        {/* Global search button — same as original */}
        <button
          className="global-search-btn"
          onClick={() => setSearchQuery?.('')}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px', border: '1px solid #e5e7eb', background: '#fff', borderRadius: '6px', minWidth: '180px', height: '28px', padding: '0 10px', fontSize: '12px', color: '#9ca3af', fontFamily: 'var(--font-family)' }}
        >
          <Search size={12} style={{ color: '#9ca3af' }} />
          <span style={{ flex: 1, textAlign: 'left' }}>Search ID cards...</span>
          <kbd style={{ fontFamily: 'var(--font-family)', border: '1px solid #e5e7eb', background: '#f9fafb', color: '#9ca3af', borderRadius: '4px', padding: '1px 5px', fontSize: '10px', fontWeight: 500 }}>
            Ctrl+K
          </kbd>
        </button>


        {/* Notification bell */}
        <button
          style={{
            position: 'relative', width: '30px', height: '30px',
            borderRadius: '4px', background: 'transparent', border: 'none',
            color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#f3f4f6'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <Bell size={15} />
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: '4px', right: '4px',
              minWidth: '14px', height: '14px',
              borderRadius: '9999px',
              background: '#ef4444', color: '#fff',
              fontSize: '9px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 2px', lineHeight: 1,
            }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* User dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowUserMenu((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'transparent', border: 'none',
              cursor: 'pointer', height: '30px', padding: '0 4px',
              borderRadius: '4px', transition: 'background 0.15s',
              fontFamily: 'var(--font-family)',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f3f4f6'}
            onMouseLeave={(e) => !showUserMenu && (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{
              width: '22px', height: '22px', borderRadius: '4px',
              background: 'linear-gradient(135deg, rgb(0, 80, 210) 0%, rgb(0, 180, 255) 100%)',

              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '9px', fontWeight: 700, flexShrink: 0,
            }}>
              {displayName[0]?.toUpperCase() || 'A'}
            </div>
            <span style={{ fontSize: '13px', color: '#374151', fontWeight: 500, maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </span>
            <ChevronDown size={11} color="#9ca3af" />
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


