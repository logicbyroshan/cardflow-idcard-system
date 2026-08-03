import React, { useState, useEffect, useCallback } from 'react';
import { Edit2, RotateCcw, RotateCw, RefreshCw, Search, X, Loader2, AlertCircle, ChevronLeft, ChevronRight, Clock, CheckCircle, Download, AlertTriangle, CreditCard } from 'lucide-react';
import CardEditDrawer from './CardEditDrawer';
import { cardApi } from '../../services/api';

const STATUS_BADGE = {
  pending:  { cls: 'badge-pending',  label: 'Pending',   Icon: Clock },
  verified: { cls: 'badge-verified', label: 'Verified',  Icon: CheckCircle },
  approved: { cls: 'badge-approved', label: 'Approved',  Icon: CheckCircle },
  download: { cls: 'badge-download', label: 'Download',  Icon: Download },
  pool:     { cls: 'badge-pool',     label: 'Pool',      Icon: AlertTriangle },
  printed:  { cls: 'badge-printed',  label: 'Printed',   Icon: CheckCircle },
};

const PAGE_SIZE = 25;

export default function CardTableView({ tableId, cards: propCards, onEditCard, addToast }) {
  const [liveCards, setLiveCards]       = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [search, setSearch]             = useState('');
  const [page, setPage]                 = useState(1);
  const [total, setTotal]               = useState(0);

  const load = useCallback(async () => {
    if (!tableId) return;
    setLoading(true); setError(false);
    try {
      const data = await cardApi.getCards(tableId, { page, search, page_size: PAGE_SIZE });
      setLiveCards(data.cards || data.results || data || []);
      setTotal(data.total || data.count || 0);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [tableId, page, search]);

  useEffect(() => { load(); }, [load]);

  const displayCards = tableId ? liveCards : (propCards?.length ? propCards : []);
  const isLive       = !!tableId;
  const totalPages   = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="data-card" style={{ borderRadius: 0 }}>
      {/* Action bar style header */}
      <div className="action-bar" style={{ position: 'relative' }}>
        <div className="action-bar-left">
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>ID Cards</span>
          <div className="action-divider" />
          <span style={{ fontSize: '12px', color: '#6b7280' }}>
            {isLive
              ? (loading ? 'Loading…' : `${total.toLocaleString()} records`)
              : `${displayCards.length} entries`}
          </span>
        </div>

        {isLive && (
          <div className="action-bar-right">
            <div className="notif-search-box" style={{ width: '160px' }}>
              <Search size={12} style={{ color: '#9ca3af', flexShrink: 0, marginRight: '6px' }} />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search…"
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', padding: '0 2px' }} title="Clear search">
                  <X size={12} />
                </button>
              )}
            </div>
            <button onClick={load} className="btn btn-outline btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {loading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={11} />}
            </button>
          </div>
        )}
      </div>




      {!isLive && !displayCards.length && (
        <div className="empty-state">
          <p>Select a table to view ID card records.</p>
        </div>
      )}

      {(isLive || displayCards.length > 0) && (
        <div className="table-wrapper" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <table className="data-table" style={{ flexShrink: 0 }}>
            <thead>
              <tr>
                <th className="col-sr">#</th>
                <th className="col-photo">Photo</th>
                <th>Name</th>
                <th>Father Name</th>
                <th>Class</th>
                <th>Section</th>
                <th>Status</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 15 }).map((_, i) => (
                    <tr key={i} className="skeleton-row">
                      {/* # */}
                      <td style={{ textAlign: 'center' }}><div className="skeleton" style={{ height: '13px', width: '24px', margin: '0 auto' }} /></td>
                      {/* Photo — circle */}
                      <td style={{ textAlign: 'center' }}>
                        <div className="skeleton" style={{ width: '32px', height: '32px', borderRadius: '50%', margin: '0 auto' }} />
                      </td>
                      {/* Name */}
                      <td><div className="skeleton" style={{ height: '13px', width: `${65 + (i % 4) * 8}%` }} /></td>
                      {/* Father Name */}
                      <td><div className="skeleton" style={{ height: '13px', width: `${55 + (i % 3) * 10}%` }} /></td>
                      {/* Class */}
                      <td><div className="skeleton" style={{ height: '13px', width: '60%' }} /></td>
                      {/* Section */}
                      <td><div className="skeleton" style={{ height: '13px', width: '40%' }} /></td>
                      {/* Status badge */}
                      <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-badge" style={{ margin: '0 auto' }} /></td>
                      {/* Actions buttons */}
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                          <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '4px' }} />
                          <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '4px' }} />
                          <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '4px' }} />
                        </div>
                      </td>
                    </tr>
                  ))
                : displayCards.map((card, idx) => {
                      const d      = card.field_data || card.fields || {};
                      const status = card.status || 'pending';
                      const cfg    = STATUS_BADGE[status] || STATUS_BADGE.pending;
                      const Icon   = cfg.Icon;
                      const photo  = d.PHOTO || card.photo_url || '';
                      const name   = d.NAME  || card.name || '—';

                      return (
                        <tr key={card.id}>
                          <td className="col-sr" style={{ textAlign: 'center', color: '#9ca3af' }}>
                            {(page - 1) * PAGE_SIZE + idx + 1}
                          </td>
                          <td className="col-photo">
                            <div style={{ width: '28px', height: '28px', borderRadius: '4px', background: '#e5e7eb', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: '#667eea', margin: '0 auto' }}>
                              {photo
                                ? <img src={`/${photo}`} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => e.currentTarget.style.display = 'none'} />
                                : name[0] || 'C'
                              }
                            </div>
                          </td>
                          <td style={{ fontWeight: 600 }}>{name}</td>
                          <td style={{ color: '#6b7280' }}>{d.FATHER_NAME || '—'}</td>
                          <td>{d.CLASS || '—'}</td>
                          <td>{d.SECTION || '—'}</td>
                          <td>
                            <span className={`badge ${cfg.cls}`}>
                              <Icon size={10} /> {cfg.label}
                            </span>
                          </td>
                          <td className="col-actions">
                            <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
                              <button
                                onClick={async () => {
                                  try { await cardApi.undoImage(card.id); addToast?.('Undo photo', 'success'); load(); }
                                  catch { addToast?.('Undo failed', 'error'); }
                                }}
                                className="btn btn-sm"
                                title="Undo photo"
                                style={{ background: '#fef3c7', color: '#d97706', border: 'none', width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }}
                              >
                                <RotateCcw size={11} />
                              </button>
                              <button
                                onClick={async () => {
                                  try { await cardApi.redoImage(card.id); addToast?.('Redo photo', 'success'); load(); }
                                  catch { addToast?.('Redo failed', 'error'); }
                                }}
                                className="btn btn-sm"
                                title="Redo photo"
                                style={{ background: '#d1fae5', color: '#059669', border: 'none', width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }}
                              >
                                <RotateCw size={11} />
                              </button>
                              <button
                                onClick={() => setSelectedCard(card)}
                                className="btn btn-sm btn-neutral"
                                title="Edit"
                                style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }}
                              >
                                <Edit2 size={11} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
              }
            </tbody>
          </table>

          {/* Empty state — sibling to table, fills remaining height */}
          {!loading && displayCards.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center', minHeight: '240px' }}>
              <div style={{
                width: '64px', height: '64px', borderRadius: '50%',
                background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 14px rgba(37,99,235,0.12)', border: '1px solid #bfdbfe', marginBottom: '12px'
              }}>
                <CreditCard size={30} />
              </div>
              <div style={{ maxWidth: '340px' }}>
                <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
                  No ID Cards Found
                </h4>
                <p style={{ fontSize: '12px', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                  {search ? `No cards match "${search}"` : 'There are no ID card records in this table yet.'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {isLive && totalPages > 1 && (
        <div className="pagination-bar">
          <div className="pagination-info">
            Showing <strong>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}</strong> of <strong>{total}</strong>
          </div>
          <div className="pagination-controls">
            <button className="pagination-btn" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={12} />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
              const p = i + 1;
              return (
                <button key={p} className={`pagination-btn${page === p ? ' active' : ''}`} onClick={() => setPage(p)}>
                  {p}
                </button>
              );
            })}
            <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}

      {selectedCard && (
        <CardEditDrawer
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onSave={(updated) => { if (onEditCard) onEditCard(updated); setSelectedCard(null); load(); }}
        />
      )}
    </div>
  );
}
