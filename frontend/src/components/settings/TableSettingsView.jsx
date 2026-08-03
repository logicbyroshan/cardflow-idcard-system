import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pen, Eye, Trash2, ToggleRight, Download, FileSpreadsheet, SlidersHorizontal,
  Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  RefreshCw, Loader2, AlertCircle
} from 'lucide-react';

import { schemaApi, clientApi } from '../../services/api';

const STATUS_TABS = ['All', 'Active', 'Inactive'];
const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function TableSettingsView({ addToast }) {
  const [tables, setTables]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);
  const [search, setSearch]         = useState('');
  const [statusTab, setStatusTab]   = useState('All');
  const [selected, setSelected]     = useState(null);
  const [page, setPage]             = useState(1);
  const [total, setTotal]           = useState(0);
  const [pageSize, setPageSize]     = useState(25);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      // Get tables schema
      const data = await clientApi.getTables?.() || await schemaApi.getSchemas?.();
      const list = data?.tables || data?.results || data || [];
      setTables(list);
      setTotal(data?.total || list.length);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = tables.filter((t) => {
    const q = search.toLowerCase();
    const matchSearch = !q || (t.name || t.table_name || '').toLowerCase().includes(q);
    const isActive = (t.status || 'active').toLowerCase() === 'active';
    const matchStatus = statusTab === 'All' || (statusTab === 'Active' ? isActive : !isActive);
    return matchSearch && matchStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const selTable = tables.find((t) => t.id === selected);

  const formatDate = (d) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return d; }
  };

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── ACTION BAR ── */}
      <div className="action-bar" id="gs-action-bar">
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

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={12} style={{ position: 'absolute', left: '8px', color: '#9ca3af', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search tables..."
              className="form-input"
              style={{ paddingLeft: '26px', height: '28px', width: '180px', fontSize: '12px' }}
            />
          </div>
        </div>

        {/* Right */}
        <div className="action-bar-right">
          <div className="actions">
            <div className="btn-group">
              <button className="btn btn-md btn-primary" onClick={() => addToast?.('Create new table drawer opening…', 'info')}>
                <Plus size={13} /> Add
              </button>
              <button className="btn btn-md btn-neutral" disabled={!selected} onClick={() => addToast?.(`Edit schema ${selTable?.name}`, 'info')}>
                <Pen size={13} /> Edit
              </button>
              <button className="btn btn-md btn-neutral" disabled={!selected} onClick={() => addToast?.(`View ${selTable?.name}`, 'info')}>
                <Eye size={13} /> View
              </button>
              <button className="btn btn-md btn-danger" disabled={!selected} onClick={() => addToast?.('Confirm delete table?', 'warning')}>
                <Trash2 size={13} /> Delete
              </button>
              <button className="btn btn-md btn-warning" disabled={!selected} onClick={() => addToast?.('Table status toggled', 'success')}>
                <ToggleRight size={13} /> Active
              </button>
            </div>

            <div className="btn-separator" />

            <div className="btn-group">
              <button className="btn btn-md btn-neutral" onClick={() => addToast?.('Create Excel Template modal', 'info')}>
                <FileSpreadsheet size={13} /> <span>Create Excel Template</span>
              </button>
              <button className="btn btn-md btn-neutral" disabled={!selected} onClick={() => addToast?.('Download Blank Template', 'info')}>
                <Download size={13} /> <span>Download Blank Excel</span>
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* Error strip */}
      {error && (
        <div style={{ padding: '6px 12px', background: '#fef2f2', borderBottom: '1px solid #fca5a5', fontSize: '12px', color: '#dc2626', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <AlertCircle size={12} /> Could not load table settings. <button onClick={load} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font-family)' }}>Retry</button>
        </div>
      )}

      {/* ── TABLE CONTAINER ── */}
      <div id="gs-table-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div className="table-wrapper" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {filtered.length === 0 && !loading ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
              <div style={{
                width: '64px', height: '64px', borderRadius: '50%',
                background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 14px rgba(37,99,235,0.12)', border: '1px solid #bfdbfe', marginBottom: '12px'
              }}>
                <SlidersHorizontal size={30} />
              </div>
              <div style={{ maxWidth: '340px' }}>
                <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
                  No Table Settings Found
                </h4>
                <p style={{ fontSize: '12px', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                  {search ? `No setting tables match "${search}"` : 'There are no setting tables configured yet.'}
                </p>
              </div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '45px', textAlign: 'center' }}>S. No.</th>
                  <th>Table Name</th>
                  <th>Client</th>
                  <th className="text-center">Status</th>
                  <th className="text-center">Created At</th>
                  <th className="text-center">Updated At</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 15 }).map((_, i) => (
                    <tr key={i} className="skeleton-row">
                      <td><div className="skeleton" style={{ width: '16px', height: '16px', borderRadius: '3px', margin: '0 auto' }} /></td>
                      <td><div className="skeleton" style={{ height: '13px', width: `${65 + (i % 4) * 8}%` }} /></td>
                      <td><div className="skeleton" style={{ height: '13px', width: `${55 + (i % 3) * 10}%` }} /></td>
                      <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-badge" style={{ margin: '0 auto' }} /></td>
                      <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-date" style={{ margin: '0 auto' }} /></td>
                      <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-date" style={{ margin: '0 auto', width: '75%' }} /></td>
                    </tr>
                  ))
                ) : (
                  filtered.map((t, idx) => {
                    const name = t.name || t.table_name || `Table #${t.id || idx}`;
                    const clientName = t.client_name || t.client?.name || '—';
                    const isActive = (t.status || 'active').toLowerCase() === 'active';
                    const isSel = t.id === selected;
                    return (
                      <tr
                        key={t.id || idx}
                        className={isSel ? 'selected' : ''}
                        onClick={() => setSelected(isSel ? null : t.id)}
                      >
                        <td className="col-checkbox text-center">
                          <input type="checkbox" checked={isSel} readOnly style={{ cursor: 'pointer' }} />
                        </td>
                        <td style={{ fontWeight: 600 }}>{name}</td>
                        <td style={{ color: '#475569' }}>{clientName}</td>
                        <td className="text-center">
                          <span className={`badge ${isActive ? 'badge-success' : 'badge-neutral'}`}>
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="text-center" style={{ fontSize: '12px', color: '#6b7280' }}>{formatDate(t.created_at)}</td>
                        <td className="text-center" style={{ fontSize: '12px', color: '#6b7280' }}>{formatDate(t.updated_at)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── STICKY BOTTOM PAGINATION BAR ── */}
      <div className="pagination-bar" style={{ flexShrink: 0 }}>
        <div className="pagination-left">
          <span className="pagination-info">
            Showing <strong>{filtered.length > 0 ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)}</strong> of <strong>{filtered.length}</strong> results
          </span>
        </div>

        <div className="pagination-center">
          <button className="pagination-btn" disabled={page === 1} onClick={() => setPage(1)}><ChevronsLeft size={11} /></button>
          <button className="pagination-btn" disabled={page === 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={11} /></button>
          {Array.from({ length: Math.max(1, Math.min(totalPages, 5)) }).map((_, i) => {
            const p = i + 1;
            return (
              <button key={p} className={`page-num${page === p ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
            );
          })}
          <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={11} /></button>
          <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage(totalPages)}><ChevronsRight size={11} /></button>
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
