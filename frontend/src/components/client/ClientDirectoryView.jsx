import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pen, Eye, Users, Trash2, ToggleRight,
  Settings, CreditCard, Search, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, RefreshCw, Loader2, AlertCircle, Info
} from 'lucide-react';
import { clientApi } from '../../services/api';

/*
  Exact replica of manage-client.html layout:
  ┌─────────────────────────────────────────────────────────┐
  │ ACTION BAR (sticky top)                                  │
  │ Left: Status Tabs | Filter | Search                      │
  │ Right: Add | Edit | View | Staff | Delete | Active |     │
  │        [sep] Group Setting | ID Card Group               │
  ├─────────────────────────────────────────────────────────┤
  │ TABLE: Name | Email | Mobile | Status | Tables | Created │
  │         Updated | Log                                    │
  ├─────────────────────────────────────────────────────────┤
  │ PAGINATION BAR (sticky bottom)                           │
  └─────────────────────────────────────────────────────────┘
*/

const STATUS_TABS = ['All', 'Active', 'Inactive'];
const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function ClientDirectoryView({ addToast, onOpenActionDrawer, onNavigate, onOpenDeleteModal }) {
  const [clients, setClients]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);
  const [search, setSearch]         = useState('');
  const [statusTab, setStatusTab]   = useState('All');
  const [selected, setSelected]     = useState(null); // single selection
  const [page, setPage]             = useState(1);
  const [total, setTotal]           = useState(0);
  const [pageSize, setPageSize]     = useState(25);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const data = await clientApi.getActive({
        page, search,
        status: statusTab !== 'All' ? statusTab.toLowerCase() : '',
        page_size: pageSize,
      });
      setClients(data.clients || data.results || data || []);
      setTotal(data.total || data.count || 0);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusTab, pageSize]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selClient = clients.find((c) => c.id === selected);

  const handleToggleStatus = async () => {
    if (!selected) return;
    try {
      const res = await clientApi.toggleStatus(selected);
      if (res.success !== false) {
        addToast?.(`Status toggled for ${selClient?.name || 'client'}`, 'success');
        load();
      } else {
        addToast?.(res.message || res.error || 'Failed to toggle status', 'error');
      }
    } catch (err) {
      addToast?.('Error toggling status', 'error');
    }
  };

  const handleDeleteClient = () => {
    if (!selected) return;
    if (onOpenDeleteModal) {
      onOpenDeleteModal({
        title: `Delete Client "${selClient?.name || ''}"`,
        itemDescription: `client "${selClient?.name || ''}"`,
        onConfirm: async () => {
          try {
            const res = await clientApi.deleteClient(selected);
            if (res.success !== false) {
              addToast?.(`Client "${selClient?.name}" deleted successfully`, 'success');
              setSelected(null);
              load();
            } else {
              addToast?.(res.message || res.error || 'Failed to delete client', 'error');
            }
          } catch (err) {
            addToast?.('Error deleting client', 'error');
          }
        }
      });
    }
  };

  const formatDate = (d) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return d; }
  };

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>


      {/* ── ACTION BAR ── */}
      <div className="action-bar" id="client-action-bar">
        {/* Left */}
        <div className="action-bar-left">
          {/* Status tabs */}
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

          {/* Search */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={12} style={{ position: 'absolute', left: '8px', color: '#9ca3af', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search All..."
              className="form-input"
              style={{ paddingLeft: '26px', height: '28px', width: '180px', fontSize: '12px' }}
            />
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
              <button className="btn btn-md btn-neutral" disabled={!selected} onClick={() => addToast?.(`Viewing details for ${selClient?.name || 'selected client'}`, 'info')}>
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
              <button className="btn btn-md btn-neutral" disabled={!selected} onClick={() => onNavigate?.('schema')} title="Manage Group Settings">
                <Settings size={13} /> <span>Group Setting</span>
              </button>
              <button className="btn btn-md btn-primary" disabled={!selected} onClick={() => onNavigate?.('reprints')} title="View ID Card Groups">
                <CreditCard size={13} /> <span>ID Card Group</span>
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* ── TABLE ── */}
      <div className="table-wrapper" style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table" id="clientsTable">
          <thead>
            <tr>
              <th style={{ width: '32px' }}></th>
              <th>Name</th>
              <th>Email</th>
              <th className="text-center">Mobile</th>
              <th className="text-center">Status</th>
              <th className="text-center">Tables</th>
              <th className="text-center">Created At</th>
              <th className="text-center">Updated At</th>
              <th className="text-center" title="Log">Log</th>
            </tr>
          </thead>
          <tbody id="client-table-body">
            {loading
              ? Array.from({ length: 15 }).map((_, i) => (
                  <tr key={i} className="skeleton-row">
                    {/* Checkbox */}
                    <td><div className="skeleton" style={{ width: '16px', height: '16px', borderRadius: '3px', margin: '0 auto' }} /></td>
                    {/* Name — long text */}
                    <td><div className="skeleton" style={{ height: '13px', width: `${70 + (i % 4) * 7}%` }} /></td>
                    {/* Email */}
                    <td><div className="skeleton" style={{ height: '13px', width: `${55 + (i % 3) * 10}%` }} /></td>
                    {/* Mobile */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton" style={{ height: '13px', width: '70%', margin: '0 auto' }} /></td>
                    {/* Status badge */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-badge" style={{ margin: '0 auto' }} /></td>
                    {/* Tables — short number */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton" style={{ height: '20px', width: '80px', borderRadius: '6px', margin: '0 auto' }} /></td>
                    {/* Created At */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-date" style={{ margin: '0 auto' }} /></td>
                    {/* Updated At */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-date" style={{ margin: '0 auto', width: '75%' }} /></td>
                    {/* Log / Action buttons */}
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                        <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '4px' }} />
                        <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '4px' }} />
                      </div>
                    </td>
                  </tr>
                ))
              : clients.length === 0
                ? (
                  <tr className="empty-row">
                    <td colSpan={9}>
                      <div className="empty-state" style={{ textAlign: 'center', padding: '40px 16px' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>No Clients Found</h3>
                        <p style={{ fontSize: '12px', color: '#94a3b8' }}>{search ? `No clients match "${search}"` : 'No clients match your current filters.'}</p>
                      </div>
                    </td>
                  </tr>
                )
                : clients.map((c) => {
                    const isActive = (c.status || 'active').toLowerCase() === 'active';
                    const isSel = c.id === selected;
                    return (
                      <tr
                        key={c.id}
                        className={isSel ? 'selected' : ''}
                        onClick={() => setSelected(isSel ? null : c.id)}
                        data-client-id={c.id}
                      >
                        <td className="col-checkbox text-center">
                          <input type="checkbox" checked={isSel} readOnly style={{ cursor: 'pointer' }} />
                        </td>
                        <td>
                          <div className="client-name-cell">
                            <span style={{
                              fontWeight: 600,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              maxWidth: '260px', display: 'inline-block',
                            }}>
                              {c.name || c.school_name || '—'}
                            </span>
                          </div>
                        </td>
                        <td style={{ color: '#6b7280', fontSize: '12px' }}>{c.email || c.user?.email || '—'}</td>
                        <td className="text-center" style={{ color: '#6b7280', fontSize: '12px' }}>{c.phone || c.user?.phone || '—'}</td>
                        <td className="text-center">
                          <span className={`badge ${isActive ? 'badge-success' : 'badge-neutral'}`}>
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="text-center">
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', minWidth: '90px', padding: '2px 8px', borderRadius: '6px', background: '#dbeafe', color: '#1e40af', fontSize: '12px', fontWeight: 500, border: '1px solid #93c5fd', justifyContent: 'center' }}>
                            <CreditCard size={11} /> {c.table_count || c.tables_count || 0} table{(c.table_count || 0) !== 1 ? 's' : ''}
                          </span>
                        </td>
                        <td className="text-center" style={{ fontSize: '12px', color: '#6b7280' }}>{formatDate(c.created_at)}</td>
                        <td className="text-center" style={{ fontSize: '12px', color: '#6b7280' }}>{formatDate(c.updated_at)}</td>
                        <td className="text-center">
                          <button
                            className="client-history-trigger"
                            onClick={(e) => { e.stopPropagation(); addToast?.(`Log: ${c.name}`, 'info'); }}
                            title="View log"
                            style={{ width: '26px', height: '26px', border: 'none', borderRadius: '2px', background: 'rgba(37,99,235,0.1)', color: '#2563eb', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <Info size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
          }
        </tbody>
      </table>
    </div>

    {/* ── STICKY BOTTOM PAGINATION BAR ── */}
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
