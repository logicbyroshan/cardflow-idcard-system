import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pen, Eye, Users, Trash2, ToggleRight, Building,
  Settings, CreditCard, Search, X, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, RefreshCw, Loader2, Info
} from 'lucide-react';

import { clientApi } from '../../services/api';

const STATUS_TABS = ['All', 'Active', 'Inactive'];
const PAGE_SIZE_OPTIONS = [25, 50, 100];

const formatDT = (str) => {
  if (!str) return '—';
  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    const day   = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year  = String(d.getFullYear()).slice(-2);
    const hours = String(d.getHours()).padStart(2, '0');
    const mins  = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${mins}`;
  } catch { return str; }
};

export default function ClientDirectoryView({ addToast, onOpenActionDrawer, onNavigate, onOpenDeleteModal }) {
  const [clients, setClients]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [statusTab, setStatusTab] = useState('All');
  const [selected, setSelected]   = useState(null);
  const [page, setPage]           = useState(1);
  const [total, setTotal]         = useState(0);
  const [pageSize, setPageSize]   = useState(25);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await clientApi.getActive({
        page, search,
        status: statusTab !== 'All' ? statusTab.toLowerCase() : '',
        page_size: pageSize,
      });
      setClients(data.clients || data.results || data || []);
      setTotal(data.total || data.count || 0);
    } catch {
      setClients([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusTab, pageSize]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selClient  = clients.find((c) => c.id === selected);

  const handleToggleStatus = async () => {
    if (!selected) return;
    try {
      const res = await clientApi.toggleStatus(selected);
      if (res.success !== false) {
        addToast?.(`Status toggled for ${selClient?.name || 'client'}`, 'success');
        load();
      } else {
        addToast?.(res.message || 'Failed to toggle status', 'error');
      }
    } catch {
      addToast?.('Error toggling status', 'error');
    }
  };

  const handleDeleteClient = () => {
    if (!selected) return;
    if (onOpenDeleteModal) {
      onOpenDeleteModal({
        title: `Delete Organisation "${selClient?.name || ''}"`,
        itemDescription: `organisation "${selClient?.name || ''}"`,
        onConfirm: async () => {
          try {
            const res = await clientApi.deleteClient(selected);
            if (res.success !== false) {
              addToast?.(`Organisation "${selClient?.name}" deleted`, 'success');
              setSelected(null);
              load();
            } else {
              addToast?.(res.message || 'Failed to delete', 'error');
            }
          } catch {
            addToast?.('Error deleting organisation', 'error');
          }
        }
      });
    }
  };

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── ACTION BAR ── */}
      <div className="action-bar" id="client-action-bar">
        {/* Left */}
        <div className="action-bar-left">
          <div className="status-tabs" style={{ display: 'flex', alignItems: 'center', background: '#eef0f4', borderRadius: '6px', padding: '2px 3px', gap: '2px' }}>
            {STATUS_TABS.map((t) => (
              <button
                key={t}
                onClick={() => { setStatusTab(t); setPage(1); }}
                className={`status-tab${statusTab === t ? ' active' : ''}`}
                style={{
                  padding: '2px 10px', fontSize: '13px', lineHeight: 1.2, borderRadius: '4px',
                  border: 'none', cursor: 'pointer', background: statusTab === t ? '#fff' : 'transparent',
                  color: statusTab === t ? '#374151' : '#6b7280', fontWeight: statusTab === t ? 600 : 400,
                  fontFamily: 'var(--font-family)', transition: 'all 0.15s',
                  boxShadow: statusTab === t ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="action-divider" />

          <div className="notif-search-box" style={{ width: '200px' }}>
            <Search size={13} style={{ color: '#9ca3af', flexShrink: 0, marginRight: '6px' }} />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search All..."
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', padding: '0 2px' }} title="Clear search">
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Right */}
        <div className="action-bar-right">
          <div className="actions">
            <div className="btn-group">
              <button className="btn btn-md btn-primary" onClick={() => onOpenActionDrawer?.('add-client')}>
                <Plus size={13} /> Add
              </button>
              <button className="btn btn-md btn-neutral" disabled={!selected} onClick={() => onOpenActionDrawer?.('add-client')}>
                <Pen size={13} /> Edit
              </button>
              <button className="btn btn-md btn-neutral" disabled={!selected} onClick={() => addToast?.(`Viewing ${selClient?.name || 'client'}`, 'info')}>
                <Eye size={13} /> View
              </button>
              <button className="btn btn-md btn-neutral" disabled={!selected} onClick={() => onOpenActionDrawer?.('add-staff')}>
                <Users size={13} /> Staff
              </button>
              <button className="btn btn-md btn-danger" disabled={!selected} onClick={handleDeleteClient}>
                <Trash2 size={13} /> Delete
              </button>
              <button className="btn btn-md btn-warning" disabled={!selected} onClick={handleToggleStatus}>
                <ToggleRight size={13} /> Active
              </button>
            </div>

            <div className="btn-separator" />

            <div className="btn-group">
              <button className="btn btn-md btn-neutral" disabled={!selected} onClick={() => onNavigate?.('schema')} title="Manage Table Settings">
                <Settings size={13} /> <span>Table Setting</span>
              </button>
              <button className="btn btn-md btn-primary" disabled={!selected} onClick={() => onNavigate?.('reprints')} title="View Tables">
                <CreditCard size={13} /> <span>Tables</span>
              </button>
            </div>

            <div className="btn-separator" />

            <button
              onClick={load}
              className="btn btn-md btn-neutral"
              style={{ padding: '0 8px', height: '28px' }}
              title="Refresh"
            >
              {loading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── TABLE ── */}
      <div className="table-wrapper" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <table className="data-table" id="clientsTable" style={{ flexShrink: 0 }}>
          <thead>
            <tr>
              <th style={{ width: '45px', textAlign: 'center' }}>S. No.</th>
              <th style={{ width: 'auto' }}>Name</th>
              <th style={{ width: '180px' }}>Email</th>
              <th style={{ width: '130px' }}>Username</th>
              <th style={{ width: '110px', textAlign: 'center' }}>Mobile</th>
              <th style={{ width: '80px', textAlign: 'center' }}>Status</th>
              <th style={{ width: '75px', textAlign: 'center' }}>Tables</th>
              <th style={{ width: '120px', textAlign: 'center' }}>Created At</th>
              <th style={{ width: '120px', textAlign: 'center' }}>Updated At</th>
              <th style={{ width: '45px', textAlign: 'center' }} title="Log">Log</th>
            </tr>
          </thead>
          <tbody id="client-table-body">
            {loading ? (
              Array.from({ length: 15 }).map((_, i) => (
                <tr key={i} className="skeleton-row">
                  <td><div className="skeleton" style={{ width: '16px', height: '16px', borderRadius: '3px', margin: '0 auto' }} /></td>
                  <td><div className="skeleton" style={{ height: '13px', width: `${70 + (i % 4) * 7}%` }} /></td>
                  <td><div className="skeleton" style={{ height: '13px', width: '80%' }} /></td>
                  <td><div className="skeleton" style={{ height: '13px', width: '75%' }} /></td>
                  <td style={{ textAlign: 'center' }}><div className="skeleton" style={{ height: '13px', width: '70%', margin: '0 auto' }} /></td>
                  <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-badge" style={{ margin: '0 auto' }} /></td>
                  <td style={{ textAlign: 'center' }}><div className="skeleton" style={{ height: '20px', width: '50px', borderRadius: '6px', margin: '0 auto' }} /></td>
                  <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-date" style={{ margin: '0 auto', width: '80px' }} /></td>
                  <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-date" style={{ margin: '0 auto', width: '80px' }} /></td>
                  <td style={{ textAlign: 'center' }}><div className="skeleton" style={{ width: '22px', height: '22px', borderRadius: '4px', margin: '0 auto' }} /></td>
                </tr>
              ))
            ) : (
              clients.map((c, idx) => {
                const isActive = (c.status || 'active').toLowerCase() === 'active';
                const isSel    = c.id === selected;
                return (
                  <tr
                    key={c.id}
                    className={isSel ? 'selected' : ''}
                    onClick={() => setSelected(isSel ? null : c.id)}
                    data-client-id={c.id}
                  >
                    <td className="col-checkbox text-center" style={{ width: '45px' }}>
                      <input type="checkbox" checked={isSel} readOnly style={{ cursor: 'pointer' }} />
                    </td>
                    <td style={{ width: 'auto' }}>
                      <div className="client-name-cell">
                        <span style={{ fontWeight: 600, color: '#0f172a' }}>
                          {c.name || c.school_name || '—'}
                        </span>
                      </div>
                    </td>
                    <td style={{ width: '180px', color: '#6b7280', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.email || c.user?.email || '—'}
                    </td>
                    <td style={{ width: '130px', color: '#475569', fontSize: '11px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.username || c.user?.username || c.user_code || '—'}
                    </td>
                    <td className="text-center" style={{ width: '110px', color: '#6b7280', fontSize: '11px' }}>
                      {c.phone || c.user?.phone || '—'}
                    </td>
                    <td className="text-center" style={{ width: '80px' }}>
                      <span className={`badge ${isActive ? 'badge-success' : 'badge-neutral'}`}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="text-center" style={{ width: '75px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 6px', borderRadius: '4px', background: '#dbeafe', color: '#1e40af', fontSize: '11px', fontWeight: 600, border: '1px solid #93c5fd' }}>
                        <CreditCard size={10} /> {c.table_count || c.tables_count || 0}
                      </span>
                    </td>
                    <td className="text-center" style={{ width: '120px', fontSize: '11px', color: '#64748b' }}>{formatDT(c.created_at)}</td>
                    <td className="text-center" style={{ width: '120px', fontSize: '11px', color: '#64748b' }}>{formatDT(c.updated_at)}</td>
                    <td className="text-center" style={{ width: '45px' }}>
                      <button
                        className="client-history-trigger"
                        onClick={(e) => { e.stopPropagation(); addToast?.(`Log: ${c.name || idx + 1}`, 'info'); }}
                        title="View log"
                        style={{ width: '22px', height: '22px', border: 'none', borderRadius: '3px', background: 'rgba(37,99,235,0.1)', color: '#2563eb', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Info size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Empty state — sibling to table so flex:1 fills remaining height */}
        {!loading && clients.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center', minHeight: '240px' }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
              color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(37,99,235,0.12)', border: '1px solid #bfdbfe', marginBottom: '12px'
            }}>
              <Building size={30} />
            </div>
            <div style={{ maxWidth: '340px' }}>
              <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
                No Organisations Found
              </h4>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                {search ? `No organisations match "${search}"` : 'There are no organisations registered in the system yet.'}
              </p>
            </div>
            {!search && (
              <button
                onClick={() => onOpenActionDrawer?.('add-client')}
                className="btn btn-primary btn-sm"
                style={{ marginTop: '14px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', padding: '7px 16px', borderRadius: '5px' }}
              >
                <Plus size={14} /> Add First Organisation
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── PAGINATION BAR ── */}
      <div className="pagination-bar">
        <div className="pagination-left">
          <span className="pagination-info">
            Showing <strong>{clients.length > 0 ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)}</strong> of <strong>{total}</strong> results
          </span>
          {selected && (
            <span className="pagination-selected" style={{ marginLeft: '8px', color: '#6b7280', fontSize: '12px' }}>
              · 1 selected
            </span>
          )}
        </div>

        <div className="pagination-center">
          <button className="pagination-btn" disabled={page === 1} onClick={() => setPage(1)} title="First"><ChevronsLeft size={11} /></button>
          <button className="pagination-btn" disabled={page === 1} onClick={() => setPage((p) => p - 1)} title="Previous"><ChevronLeft size={11} /></button>
          {Array.from({ length: Math.max(1, Math.min(totalPages, 7)) }).map((_, i) => {
            const p = i + 1;
            return (
              <button key={p} className={`page-num${page === p ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
            );
          })}
          <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} title="Next"><ChevronRight size={11} /></button>
          <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage(totalPages)} title="Last"><ChevronsRight size={11} /></button>
        </div>

        <div className="pagination-right">
          <label style={{ fontSize: '12px', color: '#6b7280' }}>Rows per page:</label>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            style={{ height: '24px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '12px', padding: '0 4px', background: '#fff', fontFamily: 'var(--font-family)', cursor: 'pointer', outline: 'none' }}
          >
            {PAGE_SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

    </div>
  );
}
