import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock, CheckCircle2, ThumbsUp, Download, Trash2, CreditCard,
  Users, User, Layers, Plus, Mail, Shield, Search, RefreshCw, ChevronRight, ChevronDown, Building, X
} from 'lucide-react';



import { dashboardApi } from '../../services/api';

/* ─────────────────────────────────────────────────────────────────────────
   Top Welcome Banner (Purple Gradient) — SS2 Exact
───────────────────────────────────────────────────────────────────────── */
function WelcomeBanner({ currentUser }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedDate = time.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  const formattedTime = time.toLocaleTimeString('en-US', { hour12: false });
  const userName = currentUser?.first_name ? `${currentUser.first_name} ${currentUser.last_name || ''}`.trim() : (currentUser?.username || 'System Admin');

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgb(0, 80, 210) 0%, rgb(0, 180, 255) 100%)',
      color: '#fff',
      padding: '12px 18px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
      borderBottom: '1px solid rgba(255,255,255,0.15)',
    }}>
      <div>
        <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#fff', fontFamily: 'var(--font-family)' }}>
          Welcome back, {userName}!
        </h2>
        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)', margin: '1px 0 0', fontFamily: 'var(--font-family)' }}>
          Here's what's happening with your ID card system today.
        </p>
      </div>

      <div style={{ textAlign: 'right', fontFamily: 'var(--font-family)' }}>
        <div style={{ fontSize: '11px', fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>{formattedDate}</div>
        <div style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '0.04em', color: '#fff' }}>{formattedTime}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   6 Stat Cards Row — SS2 Exact (Connected 1px border lines, NO GAPS)
───────────────────────────────────────────────────────────────────────── */
const STAT_CARDS_DEF = [
  { key: 'pending_cards',   label: 'Pending Cards',    defaultVal: 0, bg: '#f59e0b', Icon: Clock        },
  { key: 'verified_cards',  label: 'Verified Cards',   defaultVal: 0, bg: '#10b981', Icon: CheckCircle2 },
  { key: 'approved_cards',  label: 'Approved Cards',   defaultVal: 0, bg: '#3b82f6', Icon: ThumbsUp     },
  { key: 'download_cards',  label: 'Downloaded Cards', defaultVal: 0, bg: '#64748b', Icon: Download     },
  { key: 'pool_cards',      label: 'Pool Cards',       defaultVal: 0, bg: '#ef4444', Icon: Trash2       },
  { key: 'total_id_cards',  label: 'Total ID Cards',   defaultVal: 0, bg: '#06b6d4', Icon: CreditCard   },
];

function StatCardsRow({ stats, loading, onNavigate }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(6, 1fr)',
      gap: 0,
      background: '#fff',
      borderBottom: '1px solid #cbd5e1',
      flexShrink: 0,
    }}>
      {STAT_CARDS_DEF.map(({ key, label, defaultVal, bg, Icon }) => {
        const rawVal = stats?.[key] ?? stats?.[key.replace('_cards', '')];
        const val = rawVal !== undefined ? rawVal : defaultVal;
        const statusKey = key.replace('_cards', '');
        return (
          <button
            key={key}
            onClick={() => onNavigate('cards', { statusFilter: statusKey })}
            style={{
              padding: '10px 14px',
              borderRight: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#fff',
              border: 'none',
              borderRightStyle: 'solid',
              borderRightWidth: '1px',
              borderRightColor: '#e2e8f0',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
          >
            <div>
              <div style={{ fontSize: '19px', fontWeight: 700, color: '#0f172a', lineHeight: 1.1, fontFamily: 'var(--font-family)' }}>
                {loading && !stats ? '—' : val.toLocaleString()}
              </div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', marginTop: '2px', fontFamily: 'var(--font-family)' }}>
                {label}
              </div>
            </div>
            <div style={{
              width: '34px', height: '34px', borderRadius: '6px',
              background: bg, color: '#fff', display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon size={16} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Default Fallback Clients matching SS2
───────────────────────────────────────────────────────────────────────── */
const MOCK_CLIENT_ROWS = [
  { id: 'mock-1', name: 'Mathura Das School of Execellence', pending: 0, verified: 0, approved: 0, downloaded: 0, pool: 0 },
  { id: 'mock-2', name: 'Delhi Public School', pending: 12, verified: 45, approved: 120, downloaded: 350, pool: 2 },
  { id: 'mock-3', name: 'St. Xavier High School', pending: 5, verified: 18, approved: 60, downloaded: 180, pool: 0 }
];

/* ─────────────────────────────────────────────────────────────────────────
   Recent Client Updates Table (Left Main Area) — SS2 Exact
   Count Badges are CLICKABLE BUTTONS (border-radius: 2px sharp boxes)
───────────────────────────────────────────────────────────────────────── */
function RecentClientUpdatesTable({ clients, loading, onNavigate, search, setSearch }) {
  const [expandedRows, setExpandedRows] = useState({});
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  const displayList = (clients && clients.length > 0) ? clients : MOCK_CLIENT_ROWS;
  const rows = displayList.filter(c =>
    !search || (c.name || c.school_name || '').toLowerCase().includes(search.toLowerCase())
  );

  const toggleExpand = (id, e) => {
    e.stopPropagation();
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleBadgeClick = (clientOrSubTable, statusKey) => {
    const tableId = clientOrSubTable.table_id || clientOrSubTable.tableId || clientOrSubTable.id || 1;
    onNavigate('idcard-actions', { tableId: tableId, status: statusKey });
  };

  const handleSort = (key) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('desc');
    } else if (sortDir === 'desc') {
      setSortDir('asc');
    } else {
      setSortKey(null);
      setSortDir('desc');
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    if (!sortKey) return 0;
    const valA = a[sortKey] ?? (sortKey === 'download' ? a.downloaded : 0) ?? 0;
    const valB = b[sortKey] ?? (sortKey === 'download' ? b.downloaded : 0) ?? 0;
    if (typeof valA === 'string') {
      return sortDir === 'desc' ? valB.localeCompare(valA) : valA.localeCompare(valB);
    }
    return sortDir === 'desc' ? valB - valA : valA - valB;
  });

  const renderSortIcon = (key) => {
    if (sortKey !== key) return ' ⇕';
    return sortDir === 'desc' ? ' ⬇' : ' ⬆';
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
        <thead style={{ position: 'sticky', top: 0, background: '#1e293b', color: '#ffffff', zIndex: 2 }}>
          <tr style={{ height: '38px' }}>
            <th style={{ padding: '0 12px', textAlign: 'left', fontWeight: 700, width: '55%', fontSize: '11px', letterSpacing: '0.04em', borderRight: '1px solid #334155', height: '38px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '8px' }}>
                <span style={{ color: '#ffffff', fontWeight: 700 }}>ORGANISATION</span>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '180px' }}>
                  <Search size={11} style={{ position: 'absolute', left: '7px', color: '#94a3b8', pointerEvents: 'none' }} />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search organisation..."
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%',
                      height: '24px',
                      paddingLeft: '24px',
                      paddingRight: '8px',
                      fontSize: '10px',
                      fontWeight: 500,
                      borderRadius: '4px',
                      border: '1px solid #475569',
                      background: '#0f172a',
                      color: '#ffffff',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>
            </th>
            <th onClick={() => handleSort('pending')} style={{ padding: '0 6px', textAlign: 'center', fontWeight: 700, width: '9%', fontSize: '11px', letterSpacing: '0.04em', borderRight: '1px solid #334155', cursor: 'pointer', userSelect: 'none', height: '38px' }}>PENDING{renderSortIcon('pending')}</th>
            <th onClick={() => handleSort('verified')} style={{ padding: '0 6px', textAlign: 'center', fontWeight: 700, width: '9%', fontSize: '11px', letterSpacing: '0.04em', borderRight: '1px solid #334155', cursor: 'pointer', userSelect: 'none', height: '38px' }}>VERIFIED{renderSortIcon('verified')}</th>
            <th onClick={() => handleSort('approved')} style={{ padding: '0 6px', textAlign: 'center', fontWeight: 700, width: '9%', fontSize: '11px', letterSpacing: '0.04em', borderRight: '1px solid #334155', cursor: 'pointer', userSelect: 'none', height: '38px' }}>APPROVED{renderSortIcon('approved')}</th>
            <th onClick={() => handleSort('download')} style={{ padding: '0 6px', textAlign: 'center', fontWeight: 700, width: '9%', fontSize: '11px', letterSpacing: '0.04em', borderRight: '1px solid #334155', cursor: 'pointer', userSelect: 'none', height: '38px' }}>DOWNLOADED{renderSortIcon('download')}</th>
            <th onClick={() => handleSort('pool')} style={{ padding: '0 6px', textAlign: 'center', fontWeight: 700, width: '9%', fontSize: '11px', letterSpacing: '0.04em', cursor: 'pointer', userSelect: 'none', height: '38px' }}>POOL{renderSortIcon('pool')}</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((c, idx) => {
            const name = (c.name || c.school_name || c.username || '—').toUpperCase();
            const clientId = c.id || idx;
            const isExpanded = !!expandedRows[clientId];

            // Sub-tables for dropdown rows
            const subTables = c.tables || [
              { id: 1, name: 'Class 1st to 5th', pending: Math.floor((c.pending || 0)*0.6), verified: Math.floor((c.verified || 0)*0.6), approved: Math.floor((c.approved || 0)*0.6), downloaded: Math.floor((c.downloaded || c.download || 0)*0.6), pool: Math.floor((c.pool || 0)*0.6) },
              { id: 2, name: 'Class 6th to 10th', pending: Math.ceil((c.pending || 0)*0.4), verified: Math.ceil((c.verified || 0)*0.4), approved: Math.ceil((c.approved || 0)*0.4), downloaded: Math.ceil((c.downloaded || c.download || 0)*0.4), pool: Math.ceil((c.pool || 0)*0.4) },
            ];

            return (
              <React.Fragment key={clientId}>
                <tr
                  onClick={(e) => toggleExpand(clientId, e)}
                  style={{
                    borderBottom: '1px solid #e2e8f0',
                    background: isExpanded ? '#f0f4fe' : (idx % 2 === 0 ? '#fff' : '#fafafa'),
                    cursor: 'pointer', transition: 'background 0.15s'
                  }}
                >
                  <td style={{ padding: '6px 12px', fontWeight: 600, color: '#334155', fontSize: '11px', borderRight: '1px solid #e2e8f0', width: '55%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        onClick={(e) => toggleExpand(clientId, e)}
                        style={{ background: 'none', border: 'none', padding: '1px', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                      >
                        {isExpanded ? <ChevronDown size={13} style={{ color: '#2563eb' }} /> : <ChevronRight size={13} />}
                      </button>
                      <span style={{ color: '#10b981', fontSize: '10px' }}>✓</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); onNavigate('idcard-actions', { tableId: c.id || 1, status: 'pending' }); }}
                        style={{ background: 'none', border: 'none', padding: 0, color: '#0f172a', fontWeight: 700, fontSize: '11px', cursor: 'pointer', textAlign: 'left', textDecoration: 'none' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#2563eb'}
                        onMouseLeave={(e) => e.currentTarget.style.color = '#0f172a'}
                      >
                        {name}
                      </button>
                    </div>
                  </td>
                  {/* REDESIGNED STATUS COUNT BUTTON BADGES */}
                  <td style={{ padding: '5px 6px', textAlign: 'center', borderRight: '1px solid #e2e8f0', width: '9%' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleBadgeClick(c, 'pending'); }}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '44px', height: '22px', padding: '0 8px', borderRadius: '4px', border: '1px solid #fdba74', background: '#fff7ed', color: '#c2410c', fontWeight: 700, fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-family)', boxShadow: '0 1px 2px rgba(234,88,12,0.08)', transition: 'all 0.15s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#ffedd5'; e.currentTarget.style.borderColor = '#ea580c'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = '#fff7ed'; e.currentTarget.style.borderColor = '#fdba74'; }}
                    >
                      {c.pending ?? 0}
                    </button>
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'center', borderRight: '1px solid #e2e8f0', width: '9%' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleBadgeClick(c, 'verified'); }}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '44px', height: '22px', padding: '0 8px', borderRadius: '4px', border: '1px solid #6ee7b7', background: '#ecfdf5', color: '#047857', fontWeight: 700, fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-family)', boxShadow: '0 1px 2px rgba(5,150,105,0.08)', transition: 'all 0.15s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#d1fae5'; e.currentTarget.style.borderColor = '#059669'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = '#ecfdf5'; e.currentTarget.style.borderColor = '#6ee7b7'; }}
                    >
                      {c.verified ?? 0}
                    </button>
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'center', borderRight: '1px solid #e2e8f0', width: '9%' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleBadgeClick(c, 'approved'); }}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '44px', height: '22px', padding: '0 8px', borderRadius: '4px', border: '1px solid #93c5fd', background: '#eff6ff', color: '#1d4ed8', fontWeight: 700, fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-family)', boxShadow: '0 1px 2px rgba(37,99,235,0.08)', transition: 'all 0.15s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#dbeafe'; e.currentTarget.style.borderColor = '#2563eb'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.borderColor = '#93c5fd'; }}
                    >
                      {c.approved ?? 0}
                    </button>
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'center', borderRight: '1px solid #e2e8f0', width: '9%' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleBadgeClick(c, 'downloaded'); }}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '44px', height: '22px', padding: '0 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#334155', fontWeight: 700, fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-family)', boxShadow: '0 1px 2px rgba(71,85,105,0.08)', transition: 'all 0.15s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.borderColor = '#475569'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
                    >
                      {c.download ?? c.downloaded ?? 0}
                    </button>
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'center', width: '9%' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleBadgeClick(c, 'pool'); }}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '44px', height: '22px', padding: '0 8px', borderRadius: '4px', border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', fontWeight: 700, fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-family)', boxShadow: '0 1px 2px rgba(220,38,38,0.08)', transition: 'all 0.15s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.borderColor = '#dc2626'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.borderColor = '#fca5a5'; }}
                    >
                      {c.pool ?? 0}
                    </button>
                  </td>
                </tr>

                {/* EXPANDABLE DROPDOWN SUB-ROWS */}
                {isExpanded && subTables.map((sub, sIdx) => (
                  <tr key={`${clientId}-sub-${sIdx}`} style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '5px 12px 5px 36px', color: '#334155', fontSize: '11px', fontWeight: 600, borderRight: '1px solid #e2e8f0', width: '55%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: '#94a3b8', fontSize: '10px' }}>↳</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); onNavigate('idcard-actions', { tableId: sub.id || 1, status: 'pending' }); }}
                          style={{ background: 'none', border: 'none', padding: 0, color: '#475569', fontWeight: 600, fontSize: '11px', cursor: 'pointer', textAlign: 'left' }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#2563eb'}
                          onMouseLeave={(e) => e.currentTarget.style.color = '#475569'}
                        >
                          {sub.name}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center', borderRight: '1px solid #e2e8f0', width: '9%' }}>
                      <button onClick={(e) => { e.stopPropagation(); handleBadgeClick({ ...c, table_id: sub.id }, 'pending'); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '38px', height: '20px', padding: '0 6px', borderRadius: '3px', border: '1px solid #fed7aa', background: '#fff7ed', color: '#ea580c', fontWeight: 600, fontSize: '10px', cursor: 'pointer' }}>
                        {sub.pending}
                      </button>
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center', borderRight: '1px solid #e2e8f0', width: '9%' }}>
                      <button onClick={(e) => { e.stopPropagation(); handleBadgeClick({ ...c, table_id: sub.id }, 'verified'); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '38px', height: '20px', padding: '0 6px', borderRadius: '3px', border: '1px solid #a7f3d0', background: '#ecfdf5', color: '#059669', fontWeight: 600, fontSize: '10px', cursor: 'pointer' }}>
                        {sub.verified}
                      </button>
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center', borderRight: '1px solid #e2e8f0', width: '9%' }}>
                      <button onClick={(e) => { e.stopPropagation(); handleBadgeClick({ ...c, table_id: sub.id }, 'approved'); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '38px', height: '20px', padding: '0 6px', borderRadius: '3px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#2563eb', fontWeight: 600, fontSize: '10px', cursor: 'pointer' }}>
                        {sub.approved}
                      </button>
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center', borderRight: '1px solid #e2e8f0', width: '9%' }}>
                      <button onClick={(e) => { e.stopPropagation(); handleBadgeClick({ ...c, table_id: sub.id }, 'downloaded'); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '38px', height: '20px', padding: '0 6px', borderRadius: '3px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', fontWeight: 600, fontSize: '10px', cursor: 'pointer' }}>
                        {sub.downloaded}
                      </button>
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center', width: '9%' }}>
                      <button onClick={(e) => { e.stopPropagation(); handleBadgeClick({ ...c, table_id: sub.id }, 'pool'); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '38px', height: '20px', padding: '0 6px', borderRadius: '3px', border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontWeight: 600, fontSize: '10px', cursor: 'pointer' }}>
                        {sub.pool}
                      </button>
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}



/* ─────────────────────────────────────────────────────────────────────────
   Recent Reprints Table Sub-Component (Matches original recent-reprints.html)
───────────────────────────────────────────────────────────────────────── */
function RecentReprintsTable({ clients, onNavigate, search }) {
  const [expandedRows, setExpandedRows] = useState({});
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  const displayList = clients || [];
  const rows = displayList.filter(c =>
    !search || (c.name || c.school_name || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleSort = (key) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('desc');
    } else if (sortDir === 'desc') {
      setSortDir('asc');
    } else {
      setSortKey(null);
      setSortDir('desc');
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    if (!sortKey) return 0;
    const valA = a[sortKey] ?? 0;
    const valB = b[sortKey] ?? 0;
    if (typeof valA === 'string') {
      return sortDir === 'desc' ? valB.localeCompare(valA) : valA.localeCompare(valB);
    }
    return sortDir === 'desc' ? valB - valA : valA - valB;
  });

  const toggleExpand = (id, e) => {
    e.stopPropagation();
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const renderSortIcon = (key) => {
    if (sortKey !== key) return ' ⇕';
    return sortDir === 'desc' ? ' ⬇' : ' ⬆';
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
        <thead style={{ position: 'sticky', top: 0, background: '#2d3748', color: '#fff', zIndex: 2 }}>
          <tr>
            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, width: '60%', fontSize: '11px', letterSpacing: '0.04em', borderRight: '1px solid #4a5568' }}>CLIENT</th>
            <th onClick={() => handleSort('reprint_pending')} style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 700, fontSize: '11px', letterSpacing: '0.04em', borderRight: '1px solid #4a5568', cursor: 'pointer', userSelect: 'none' }}>REQUEST LIST{renderSortIcon('reprint_pending')}</th>
            <th onClick={() => handleSort('reprint_confirmed')} style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 700, fontSize: '11px', letterSpacing: '0.04em', cursor: 'pointer', userSelect: 'none' }}>CONFIRMED{renderSortIcon('reprint_confirmed')}</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((c, idx) => {
            const name = (c.name || c.school_name || c.username || '—').toUpperCase();
            const clientId = c.id || idx;
            const isExpanded = !!expandedRows[clientId];

            const requestCount = c.reprint_pending ?? Math.floor((c.pending || 4) * 0.5);
            const confirmedCount = c.reprint_confirmed ?? Math.floor((c.verified || 2) * 0.4);

            const subTables = c.tables || [
              { name: 'Class 1st to 5th', requestList: Math.floor(requestCount * 0.6), confirmed: Math.floor(confirmedCount * 0.6) },
              { name: 'Class 6th to 10th', requestList: Math.ceil(requestCount * 0.4), confirmed: Math.ceil(confirmedCount * 0.4) },
            ];

            return (
              <React.Fragment key={clientId}>
                <tr
                  onClick={(e) => toggleExpand(clientId, e)}
                  style={{
                    borderBottom: '1px solid #e2e8f0',
                    background: isExpanded ? '#f0f4fe' : (idx % 2 === 0 ? '#fff' : '#fafafa'),
                    cursor: 'pointer', transition: 'background 0.15s'
                  }}
                >
                  <td style={{ padding: '6px 10px', fontWeight: 600, color: '#334155', fontSize: '11px', borderRight: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        onClick={(e) => toggleExpand(clientId, e)}
                        style={{ background: 'none', border: 'none', padding: '1px', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                      >
                        {isExpanded ? <ChevronDown size={13} style={{ color: '#2563eb' }} /> : <ChevronRight size={13} />}
                      </button>
                      <span style={{ color: '#10b981', fontSize: '10px' }}>✓</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); onNavigate('reprints', { client: c.id }); }}
                        style={{ background: 'none', border: 'none', padding: 0, color: '#334155', fontWeight: 600, fontSize: '11px', cursor: 'pointer', textAlign: 'left', textDecoration: 'none' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#2563eb'}
                        onMouseLeave={(e) => e.currentTarget.style.color = '#334155'}
                      >
                        {name}
                      </button>
                    </div>
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'center', borderRight: '1px solid #e2e8f0' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); onNavigate('reprints', { client: c.id, tab: 'pending' }); }}
                      style={{ display: 'inline-block', minWidth: '42px', padding: '2px 6px', borderRadius: '2px', border: 'none', background: '#ffedd5', color: '#c2410c', fontWeight: 700, fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-family)' }}
                    >
                      {requestCount}
                    </button>
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); onNavigate('reprints', { client: c.id, tab: 'confirmed' }); }}
                      style={{ display: 'inline-block', minWidth: '42px', padding: '2px 6px', borderRadius: '2px', border: 'none', background: '#d1fae5', color: '#047857', fontWeight: 700, fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-family)' }}
                    >
                      {confirmedCount}
                    </button>
                  </td>
                </tr>

                {/* EXPANDABLE DROPDOWN SUB-ROWS */}
                {isExpanded && subTables.map((sub, sIdx) => (
                  <tr key={`${clientId}-sub-${sIdx}`} style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '4px 10px 4px 34px', color: '#475569', fontSize: '11px', fontWeight: 500, borderRight: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: '#94a3b8', fontSize: '10px' }}>↳</span>
                        <span>{sub.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '3px 8px', textAlign: 'center', borderRight: '1px solid #e2e8f0' }}>
                      <span style={{ display: 'inline-block', minWidth: '36px', padding: '1px 5px', borderRadius: '2px', background: '#fff7ed', color: '#ea580c', fontWeight: 600, fontSize: '10px' }}>
                        {sub.requestList}
                      </span>
                    </td>
                    <td style={{ padding: '3px 8px', textAlign: 'center' }}>
                      <span style={{ display: 'inline-block', minWidth: '36px', padding: '1px 5px', borderRadius: '2px', background: '#ecfdf5', color: '#059669', fontWeight: 600, fontSize: '10px' }}>
                        {sub.confirmed}
                      </span>
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Recent Activity Updates List Sub-Component (Matches original recent-activity.html)
───────────────────────────────────────────────────────────────────────── */
function RecentActivityUpdatesTable({ activities = [], search, loading }) {
  const items = (activities || []).filter(a => {
    const userStr = a.user || a.username || a.performed_by || '';
    const actStr = a.action || a.description || a.message || a.details || '';
    return !search || userStr.toLowerCase().includes(search.toLowerCase()) || actStr.toLowerCase().includes(search.toLowerCase());
  });

  if (loading && items.length === 0) {
    return (
      <div style={{ flex: 1, padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
        Loading recent activities...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ flex: 1, padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
        No recent activities recorded.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', background: '#fff' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.map((a, idx) => {
          const user = a.user || a.username || a.performed_by || 'System';
          const actionText = a.action || a.description || a.message || a.details || 'Activity log';
          const timeText = a.created_at || a.timestamp || a.date || '';
          
          const act = (actionText || '').toLowerCase();
          let iconBg = '#8b5cf6';
          let IconComp = CreditCard;
          if (act.includes('approve')) { iconBg = '#0050d2'; IconComp = ThumbsUp; }
          else if (act.includes('verify')) { iconBg = '#10b981'; IconComp = CheckCircle2; }
          else if (act.includes('download')) { iconBg = '#6b7280'; IconComp = Download; }
          else if (act.includes('create') || act.includes('add') || act.includes('register')) { iconBg = '#0ea5e9'; IconComp = Plus; }
          else if (act.includes('reprint')) { iconBg = '#f59e0b'; IconComp = RefreshCw; }

          return (
            <div
              key={a.id || idx}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0',
                borderRadius: '4px', transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.borderColor = '#bfdbfe'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
            >
              <div style={{
                width: '28px', height: '28px', borderRadius: '4px',
                background: iconBg, color: '#fff', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px',
              }}>
                <IconComp size={13} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', color: '#1e293b', fontWeight: 500, lineHeight: 1.35 }}>
                  <strong style={{ color: '#0f172a', fontWeight: 700 }}>{user}</strong> {actionText}
                </div>
                {timeText && (
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                    {timeText}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}



/* ─────────────────────────────────────────────────────────────────────────
   Right Side Stacked Panels — SS2 Exact (WORKING QUICK ACTIONS & DYNAMIC TABS)
───────────────────────────────────────────────────────────────────────── */
function RightSidePanels({ stats, onNavigate, onOpenActionDrawer, activeSection, setActiveSection }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: '#fff', height: '100%', overflowY: 'auto' }}>

      {/* 1. Dashboard Sections */}
      <div style={{ borderBottom: '1px solid #e2e8f0' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgb(0, 80, 210) 0%, rgb(0, 180, 255) 100%)',
          color: '#fff', height: '34px', padding: '0 10px', fontSize: '12px', fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: '6px', boxSizing: 'border-box',
        }}>
          <Layers size={13} /> Dashboard Sections
        </div>
        <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {[
            { id: 'clients', label: 'Recent Organisations', count: stats?.total_organizations ?? stats?.total_clients ?? 0, Icon: Building },
            { id: 'reprints', label: 'Recent Reprints', count: stats?.reprint_count ?? 0, Icon: RefreshCw },
            { id: 'updates', label: 'Recent Updates', count: stats?.activity_count ?? 0, Icon: Clock },
          ].map(({ id, label, count, Icon }) => {
            const isActive = activeSection === id;
            return (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                style={{
                  width: '100%', padding: '6px 10px',
                  background: isActive ? '#eff6ff' : '#ffffff',
                  border: isActive ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                  borderLeft: isActive ? '3px solid #2563eb' : '1px solid #e2e8f0',
                  borderRadius: '4px',
                  color: isActive ? '#1d4ed8' : '#475569',
                  fontSize: '12px', fontWeight: isActive ? 700 : 500,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  cursor: 'pointer', fontFamily: 'var(--font-family)', transition: 'all 0.15s',
                  boxShadow: isActive ? '0 1px 3px rgba(37,99,235,0.1)' : 'none',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = '#f8fafc'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = '#ffffff'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '22px', height: '22px', borderRadius: '4px',
                    background: isActive ? '#dbeafe' : '#eff6ff',
                    color: isActive ? '#1d4ed8' : '#3b82f6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <Icon size={12} />
                  </div>
                  <span>{label}</span>
                </div>
                <span style={{
                  fontWeight: 700,
                  color: isActive ? '#1d4ed8' : '#0f172a',
                  background: isActive ? '#dbeafe' : '#f1f5f9',
                  padding: '1px 6px', borderRadius: '3px', fontSize: '11px',
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Quick Actions */}
      <div style={{ borderBottom: '1px solid #e2e8f0' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgb(0, 80, 210) 0%, rgb(0, 180, 255) 100%)',
          color: '#fff', height: '34px', padding: '0 10px', fontSize: '12px', fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: '6px', boxSizing: 'border-box',
        }}>
          <Plus size={13} /> Quick Actions
        </div>
        <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {[
            { label: 'Add New Organisation', action: () => onOpenActionDrawer('add-client'), Icon: Plus },
            { label: 'Add New Assistant', action: () => onOpenActionDrawer('add-staff'), Icon: Plus },
            { label: 'Adarsh Messenger', action: () => onOpenActionDrawer('message'), Icon: Mail },
          ].map(({ label, action, Icon }) => (
            <button
              key={label}
              onClick={action}
              style={{
                width: '100%', padding: '6px 10px', background: '#eff6ff', border: '1px solid #bfdbfe',
                borderRadius: '4px', color: '#1d4ed8', fontSize: '12px', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                fontFamily: 'var(--font-family)', transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#dbeafe'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#eff6ff'}
            >
              <Icon size={13} /> <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Users Overview — 2x2 Square Grid Cards */}
      <div>
        <div style={{
          background: 'linear-gradient(135deg, rgb(0, 80, 210) 0%, rgb(0, 180, 255) 100%)',
          color: '#fff', height: '34px', padding: '0 10px', fontSize: '12px', fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: '6px', boxSizing: 'border-box',
        }}>
          <Shield size={13} /> Users Overview
        </div>

        <div style={{ padding: '8px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
          {[
            { label: 'Organisations', count: stats?.total_organizations ?? stats?.total_clients ?? 0, action: () => onNavigate('organisations'), Icon: Building, color: '#0050d2', bg: '#eff6ff' },
            { label: 'Operators', count: stats?.total_operators ?? stats?.guest_users ?? 0, action: () => onNavigate('staff'), Icon: Shield, color: '#7c3aed', bg: '#f5f3ff' },
            { label: 'Assistants', count: stats?.total_assistants ?? stats?.client_staff_count ?? 0, action: () => onNavigate('assistants'), Icon: Users, color: '#d97706', bg: '#fff7ed' },
            { label: 'Photographers', count: stats?.total_photographers ?? 0, action: () => onNavigate('photographers'), Icon: User, color: '#059669', bg: '#ecfdf5' },
          ].map(({ label, count, action, Icon, color, bg }) => (
            <button
              key={label}
              onClick={action}
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '10px 6px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontFamily: 'var(--font-family)',
                transition: 'all 0.15s ease-in-out',
                textAlign: 'center',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#ffffff';
                e.currentTarget.style.borderColor = color;
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#f8fafc';
                e.currentTarget.style.borderColor = '#e2e8f0';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{
                width: '26px', height: '26px', borderRadius: '50%',
                background: bg, color: color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '4px'
              }}>
                <Icon size={13} />
              </div>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>
                {count}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', marginTop: '2px', whiteSpace: 'nowrap' }}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Main DashboardView Assembly
───────────────────────────────────────────────────────────────────────── */
export default function DashboardView({ onNavigate, currentUser, onOpenActionDrawer }) {
  const [stats, setStats]                 = useState(null);
  const [clients, setClients]             = useState([]);
  const [reprintClients, setReprintClients] = useState([]);
  const [activities, setActivities]       = useState([]);
  const [loading, setLoading]             = useState(false);
  const [activeSection, setActiveSection] = useState('clients'); // 'clients' | 'reprints' | 'updates'
  const [search, setSearch]               = useState('');

  // Compute counts from localStorage as an instant, always-available fallback
  const getLocalStats = useCallback(() => {
    const parse = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
    // All staff types (operators/photographers/assistants) share cf_custom_staff
    const allStaff    = parse('cf_custom_staff');
    const clients     = parse('cf_custom_clients');
    const operators   = allStaff.filter(s => {
      const des = (s.designation || s.role || '').toLowerCase();
      return !des.includes('assistant') && !des.includes('photo');
    });
    const photographers = allStaff.filter(s => {
      const des = (s.designation || s.role || '').toLowerCase();
      return des.includes('photo');
    });
    const assistants  = allStaff.filter(s => {
      const des = (s.designation || s.role || '').toLowerCase();
      return des.includes('assistant');
    });
    return {
      total_organizations: clients.length,
      total_clients:       clients.length,
      total_operators:     operators.length,
      client_staff_count:  assistants.length,
      total_assistants:    assistants.length,
      total_photographers: photographers.length,
      guest_users:         operators.length,
      // card stats stay 0 until API responds
      total_id_cards: 0, pending_cards: 0, verified_cards: 0,
      approved_cards: 0, download_cards: 0, pool_cards: 0,
      total: 0, pending: 0, verified: 0, approved: 0, downloaded: 0, pool: 0,
    };
  }, []);

  const load = useCallback(async (isInitial = false) => {
    if (isInitial && !stats) {
      // Show local counts immediately so the board is never blank
      setStats(getLocalStats());
      setLoading(true);
    }
    try {
      const statsData = await dashboardApi.getStats();
      const apiStats = statsData.stats || statsData;
      // Merge: prefer API values (> 0) but fall back to local counts for user totals
      const local = getLocalStats();
      setStats({
        ...local,
        ...apiStats,
        total_organizations: (apiStats.total_organizations || 0) > 0 ? apiStats.total_organizations : local.total_organizations,
        total_operators:     (apiStats.total_operators     || 0) > 0 ? apiStats.total_operators     : local.total_operators,
        total_assistants:    (apiStats.total_assistants    || 0) > 0 ? apiStats.total_assistants    : local.total_assistants,
        total_photographers: (apiStats.total_photographers || 0) > 0 ? apiStats.total_photographers : local.total_photographers,
      });

      let loadedClients = [];
      try {
        const clientData = await dashboardApi.getRecentClientUpdates();
        if (clientData) loadedClients = clientData.clients || clientData.results || (Array.isArray(clientData) ? clientData : []);
      } catch (_) {}

      // Merge local organisations so created organisations immediately appear on Dashboard
      try {
        const localClients = JSON.parse(localStorage.getItem('cf_custom_clients') || '[]');
        localClients.forEach(lc => {
          if (!loadedClients.some(c => String(c.id) === String(lc.id) || c.name === lc.name)) {
            loadedClients.push({
              id: lc.id,
              name: lc.name,
              school_name: lc.name,
              pending: lc.pending || 0,
              verified: lc.verified || 0,
              approved: lc.approved || 0,
              downloaded: lc.downloaded || lc.download || 0,
              pool: lc.pool || 0,
              tables: [
                { name: 'Default Table Group', pending: lc.pending || 0, verified: lc.verified || 0, approved: lc.approved || 0, downloaded: lc.downloaded || 0, pool: lc.pool || 0 }
              ]
            });
          }
        });
      } catch (_) {}
      setClients(loadedClients);

      try {
        const reprintData = await dashboardApi.getReprintOverview();
        if (reprintData) setReprintClients(reprintData.clients || reprintData.results || reprintData || []);
      } catch (_) {}

      try {
        const actData = await dashboardApi.getRecentActivity(50);
        if (actData) setActivities(actData.activities || actData.results || actData || []);
      } catch (_) {}

    } catch (_) {
      // API failed (401 etc) — keep showing local counts
      setStats(prev => prev || getLocalStats());
    }
    finally { setLoading(false); }
  }, [stats, getLocalStats]);

  useEffect(() => {
    load(true);
    window.__reloadDashboard = () => load(false);
    const interval = setInterval(() => load(false), 20000);
    return () => {
      clearInterval(interval);
      if (window.__reloadDashboard === load) delete window.__reloadDashboard;
    };
  }, [load]);


  const getSectionTitle = () => {
    if (activeSection === 'reprints') return { title: 'Recent Reprints Queue', Icon: RefreshCw, badgeText: `Pending Reprints: ${stats?.reprint_count ?? 0}`, badgeBg: '#ffedd5', badgeColor: '#c2410c' };
    if (activeSection === 'updates') return { title: 'Recent Activity & Updates', Icon: Clock, badgeText: `Recent Events: ${stats?.activity_count ?? 0}`, badgeBg: '#dbeafe', badgeColor: '#1d4ed8' };
    return { title: 'Recent Organisations', Icon: Building, badgeText: `Live Working Users: ${stats?.live_users_count ?? 0}`, badgeBg: '#d1fae5', badgeColor: '#047857' };
  };


  const currentSection = getSectionTitle();
  const SectionIcon = currentSection.Icon;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f8fafc' }}>
      {/* 1. 6 Stat Cards Row */}
      <StatCardsRow stats={stats} loading={loading} onNavigate={onNavigate} />

      {/* 3. Main Dashboard Body: Dynamic Left Section + Right Stacked Panels */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 260px',
        gap: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}>
        {/* Left Container */}
        <div style={{
          background: '#fff',
          borderRight: '1px solid #cbd5e1',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}>
          {/* Dynamic Table Body */}
          {activeSection === 'clients' && (
            <RecentClientUpdatesTable clients={clients} loading={loading} onNavigate={onNavigate} search={search} setSearch={setSearch} />
          )}
          {activeSection === 'reprints' && (
            <RecentReprintsTable clients={reprintClients.length ? reprintClients : clients} onNavigate={onNavigate} search={search} />
          )}

          {activeSection === 'updates' && (
            <RecentActivityUpdatesTable activities={activities} search={search} loading={loading} />
          )}

        </div>

        {/* Right Side Panels */}
        <RightSidePanels
          stats={stats}
          onNavigate={onNavigate}
          onOpenActionDrawer={onOpenActionDrawer}
          activeSection={activeSection}
          setActiveSection={setActiveSection}
        />
      </div>
    </div>
  );
}


