import React, { useState, useEffect, useCallback } from 'react';
import {
  Printer, CheckCircle2, Search, RefreshCw, Loader2, AlertCircle,
  FileCheck, RotateCcw, XCircle, ChevronLeft, ChevronRight
} from 'lucide-react';
import { cardApi } from '../../services/api';

/*
  Exact replica of reprint-cards.html layout:
  Step tabs: Request List | Confirmed
  Action Bar + Table + Pagination
*/

const STEPS = [
  { id: 'request_list', label: 'Request List', icon: RotateCcw },
  { id: 'confirmed',    label: 'Confirmed',    icon: CheckCircle2 },
];

export default function ReprintCardsManagerView({ addToast }) {
  const [currentStep, setCurrentStep] = useState('request_list');
  const [reprints, setReprints]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(false);
  const [search, setSearch]           = useState('');
  const [selected, setSelected]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const data = await cardApi.getReprintQueue?.() || [];
      setReprints(Array.isArray(data) ? data : data.cards || data.results || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = reprints.filter((r) => {
    const q = search.toLowerCase();
    const name = r.name || r.field_data?.NAME || '';
    const matchSearch = !q || name.toLowerCase().includes(q) || (r.reason || '').toLowerCase().includes(q);
    const isConfirmed = r.status === 'confirmed' || r.is_confirmed;
    const matchStep = currentStep === 'confirmed' ? isConfirmed : !isConfirmed;
    return matchSearch && matchStep;
  });

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>


      {/* ── ACTION BAR ── */}
      <div className="action-bar">
        <div className="action-bar-left">
          {/* Step Tabs */}
          <div className="status-tabs" style={{ display: 'flex', alignItems: 'center', background: '#eef0f4', borderRadius: '6px', padding: '2px 3px', gap: '2px' }}>
            {STEPS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setCurrentStep(id)}
                className={`status-tab${currentStep === id ? ' active' : ''}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  padding: '3px 12px', fontSize: '13px', lineHeight: 1.2, borderRadius: '4px',
                  border: 'none', cursor: 'pointer', background: currentStep === id ? '#fff' : 'transparent',
                  color: currentStep === id ? '#667eea' : '#6b7280', fontWeight: currentStep === id ? 600 : 400,
                  fontFamily: 'var(--font-family)', transition: 'all 0.15s',
                  boxShadow: currentStep === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          <div className="action-divider" />

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={12} style={{ position: 'absolute', left: '8px', color: '#9ca3af', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reprint requests..."
              className="form-input"
              style={{ paddingLeft: '26px', height: '28px', width: '200px', fontSize: '12px' }}
            />
          </div>
        </div>

        <div className="action-bar-right">
          <div className="actions">
            <button className="btn btn-md btn-primary" disabled={!selected} onClick={() => addToast?.('Approve reprint request', 'success')}>
              <FileCheck size={13} /> Approve
            </button>
            <button className="btn btn-md btn-danger" disabled={!selected} onClick={() => addToast?.('Reject reprint request', 'warning')}>
              <XCircle size={13} /> Reject
            </button>

          </div>
        </div>
      </div>

      {/* ── TABLE WRAPPER ── */}
      <div className="table-wrapper" style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '32px' }}></th>
              <th>Card / Student Name</th>
              <th>Reason</th>
              <th>Requested By</th>
              <th className="text-center">Status</th>
              <th className="text-center">Requested Date</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 15 }).map((_, i) => (
                  <tr key={i} className="skeleton-row">
                    {/* Checkbox */}
                    <td><div className="skeleton" style={{ width: '16px', height: '16px', borderRadius: '3px', margin: '0 auto' }} /></td>
                    {/* Card / Student Name */}
                    <td><div className="skeleton" style={{ height: '13px', width: `${68 + (i % 4) * 7}%` }} /></td>
                    {/* Reason (badge-like) */}
                    <td><div className="skeleton" style={{ height: '20px', width: `${80 + (i % 3) * 10}px`, borderRadius: '10px' }} /></td>
                    {/* Requested By */}
                    <td><div className="skeleton" style={{ height: '13px', width: `${50 + (i % 3) * 12}%` }} /></td>
                    {/* Status badge */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-badge" style={{ margin: '0 auto' }} /></td>
                    {/* Requested Date */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-date" style={{ margin: '0 auto' }} /></td>
                  </tr>
                ))
              : filtered.length === 0
                ? (
                  <tr className="empty-row">
                    <td colSpan={6}>
                      <div className="empty-state" style={{ textAlign: 'center', padding: '40px 16px' }}>
                        <Printer size={28} style={{ color: '#d1d5db', marginBottom: '8px' }} />
                        <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>No Reprint Requests</h3>
                        <p style={{ fontSize: '12px', color: '#94a3b8' }}>{search ? `No matching "${search}"` : 'No cards currently pending reprint in this queue.'}</p>
                      </div>
                    </td>
                  </tr>
                )
                : filtered.map((r, idx) => {
                    const name = r.name || r.field_data?.NAME || `Card #${r.card_id || r.id || idx}`;
                    const reason = r.reason || r.reprint_reason || 'Information Update';
                    const requestedBy = r.requested_by || r.username || 'Staff';
                    const isSel = r.id === selected;
                    return (
                      <tr key={r.id || idx} className={isSel ? 'selected' : ''} onClick={() => setSelected(isSel ? null : r.id)}>
                        <td className="col-checkbox text-center">
                          <input type="checkbox" checked={isSel} readOnly style={{ cursor: 'pointer' }} />
                        </td>
                        <td style={{ fontWeight: 600 }}>{name}</td>
                        <td><span className="badge badge-warning">{reason}</span></td>
                        <td style={{ color: '#6b7280', fontSize: '12px' }}>{requestedBy}</td>
                        <td className="text-center">
                          <span className={`badge ${currentStep === 'confirmed' ? 'badge-success' : 'badge-pending'}`}>
                            {currentStep === 'confirmed' ? 'Confirmed' : 'Pending Review'}
                          </span>
                        </td>
                        <td className="text-center" style={{ fontSize: '12px', color: '#6b7280' }}>
                          {r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : '—'}
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
          <span className="pagination-info">Showing <strong>{filtered.length}</strong> items</span>
        </div>
        <div className="pagination-center">
          <button className="pagination-btn" disabled><ChevronLeft size={11} /></button>
          <span className="page-numbers"><button className="page-num active">1</button></span>
          <button className="pagination-btn" disabled><ChevronRight size={11} /></button>
        </div>
      </div>
    </div>
  );
}


