import React, { useState, useEffect, useCallback } from "react";
import {
  Clock, CheckCircle, ThumbsUp, Download, Layers,
  Upload, Trash2, ArrowUp, RefreshCw, Search, X, Loader2,
  SlidersHorizontal, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowLeft, FileSpreadsheet, Eye, Edit2, Undo2, Redo2, Layers3, ShieldCheck
} from "lucide-react";
import CardEditDrawer from "./CardEditDrawer";
import { cardApi, schemaApi } from "../../services/api";

const STATUS_TABS = ["All", "Active", "Inactive"];

export default function CardTableView({ addToast, onNavigate }) {
  const [tables, setTables]               = useState([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState("");
  const [statusTab, setStatusTab]         = useState("All");

  /* Drill-down state for viewing cards inside a specific table */
  const [selectedTable, setSelectedTable] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState("pending");

  /* Cards list state inside drill-down mode */
  const [cards, setCards]                 = useState([]);
  const [cardsLoading, setCardsLoading]   = useState(false);
  const [editingCard, setEditingCard]     = useState(null);
  const [cardSearch, setCardSearch]       = useState("");
  const [page, setPage]                   = useState(1);
  const [total, setTotal]                 = useState(0);

  /* Modal states for bulk actions */
  const [activeModal, setActiveModal]     = useState(null); // 'reupload' | 'download-all' | 'delete-all' | 'upgrade'
  const [modalTable, setModalTable]       = useState(null);
  const [deleteCodeInput, setDeleteCodeInput] = useState("");

  /* ── Load tables list (merging API data + localStorage) ── */
  const loadTables = useCallback(async () => {
    setLoading(true);
    let local = [];
    try {
      local = JSON.parse(localStorage.getItem("cf_custom_tables") || "[]");
      const dummyNames = ['Class 1st to 5th', 'Class 6th to 10th', 'Class 11th & 12th', 'Staff & Teachers'];
      local = local.filter(t => t && !dummyNames.includes(t.name));
    } catch { local = []; }

    try {
      const data = await schemaApi.getSchemas();
      const list = data?.tables || data?.results || (Array.isArray(data) ? data : []);
      const merged = [...local];
      (list || []).forEach(item => {
        if (!merged.some(t => String(t.id) === String(item.id) || t.name === item.name)) {
          merged.push(item);
        }
      });
      setTables(merged);
    } catch {
      setTables(local);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTables(); }, [loadTables]);

  /* ── Load cards for a selected table (drill-down view) ── */
  const loadCards = useCallback(async () => {
    if (!selectedTable) return;
    setCardsLoading(true);
    try {
      const data = await cardApi.getCards(selectedTable.id, {
        page,
        search: cardSearch,
        status: selectedStatus !== "all" ? selectedStatus : undefined,
        page_size: 25,
      });
      setCards(data?.cards || data?.results || (Array.isArray(data) ? data : []));
      setTotal(data?.total || data?.count || (Array.isArray(data) ? data.length : 0));
    } catch {
      setCards([]);
      setTotal(0);
    } finally {
      setCardsLoading(false);
    }
  }, [selectedTable, page, cardSearch, selectedStatus]);

  useEffect(() => {
    if (selectedTable) loadCards();
  }, [selectedTable, loadCards]);

  /* ── Table filtering ── */
  const filteredTables = tables.filter(t => {
    if (!t) return false;
    const q = search.toLowerCase();
    const matchSearch = !q || (t.name || "").toLowerCase().includes(q);
    const isActive = t.is_active !== false;
    const matchStatus = statusTab === "All" || (statusTab === "Active" ? isActive : !isActive);
    return matchSearch && matchStatus;
  });

  /* ── Bulk Actions Handlers ── */
  const handleBulkReupload = (table) => {
    setModalTable(table);
    setActiveModal('reupload');
  };

  const handleBulkDownloadAll = (table) => {
    setModalTable(table);
    setActiveModal('download-all');
  };

  const handleBulkDeleteAll = (table) => {
    setModalTable(table);
    setDeleteCodeInput('');
    setActiveModal('delete-all');
  };

  const handleBulkUpgradeClass = (table) => {
    setModalTable(table);
    setActiveModal('upgrade');
  };

  const confirmDeleteAll = async () => {
    if (!modalTable) return;
    try {
      await cardApi.deleteAllCards(modalTable.id, { code: deleteCodeInput });
      addToast?.(`All cards in "${modalTable.name}" deleted successfully`, 'success');
      setActiveModal(null);
      loadTables();
    } catch (err) {
      addToast?.(err?.response?.data?.message || 'Error deleting cards. Check code.', 'error');
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     VIEW 1: TABLE GROUP OVERVIEW (Classic Django idcard_group template UI)
     ═══════════════════════════════════════════════════════════════════════════ */
  if (!selectedTable) {
    return (
      <div className="view-container" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        
        {/* ── ACTION BAR / TOPBAR ── */}
        <div className="action-bar" id="idcard-group-action-bar">
          <div className="action-bar-left">
            <div className="status-tabs" style={{ display: 'flex', alignItems: 'center', background: '#eef0f4', borderRadius: '6px', padding: '2px 3px', gap: '2px' }}>
              {STATUS_TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setStatusTab(t)}
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
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search All..."
                className="form-input"
                style={{ paddingLeft: '26px', height: '28px', width: '180px', fontSize: '12px' }}
              />
            </div>
          </div>

          <div className="action-bar-right">
            <div className="actions">
              {/* Page Switch Buttons Pair */}
              <div className="btn-group">
                <button className="btn btn-md btn-primary" title="Table Group">
                  <ShieldCheck size={13} /> <span>Table Group</span>
                </button>
                <button
                  className="btn btn-md btn-neutral"
                  onClick={() => onNavigate ? onNavigate('schema') : (window.location.href = '/panel/idcard-table/setting/')}
                  title="Table Setting"
                >
                  <SlidersHorizontal size={13} /> <span>Table Setting</span>
                </button>
              </div>

              <div className="btn-separator" />

              <div className="btn-group">
                <button
                  className="btn btn-md btn-neutral"
                  onClick={() => onNavigate ? onNavigate('schema') : (window.location.href = '/panel/idcard-table/setting/')}
                  title="Create table directly from an XLSX file"
                >
                  <FileSpreadsheet size={13} /> <span>Create with XLSX</span>
                </button>
              </div>

              <div className="btn-separator" />

              <button onClick={loadTables} className="btn btn-md btn-neutral" title="Refresh">
                {loading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
                <span>Refresh</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── MAIN CLASSIC TABLE GROUP LIST ── */}
        <div id="gs-table-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div className="table-wrapper" style={{ flex: 1, overflow: 'auto' }}>
            {loading ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
                <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px', display: 'block' }} />
                <span>Loading Table Group data…</span>
              </div>
            ) : filteredTables.length === 0 ? (
              <div style={{ padding: '60px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: '64px', height: '64px', borderRadius: '50%', background: '#eff6ff',
                  color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px'
                }}>
                  <ShieldCheck size={32} />
                </div>
                <h4 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 6px', color: '#0f172a' }}>No Table Groups Found</h4>
                <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                  {search ? `No tables match "${search}"` : 'Create your first table setting to populate table group.'}
                </p>
                <button
                  onClick={() => onNavigate ? onNavigate('schema') : (window.location.href = '/panel/idcard-table/setting/')}
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: '16px', padding: '7px 18px', borderRadius: '6px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <SlidersHorizontal size={14} /> Go to Table Setting
                </button>
              </div>
            ) : (
              <table className="data-table idcard-table">
                <thead>
                  <tr>
                    <th style={{ width: '220px', textAlign: 'left' }}>NAME</th>
                    <th style={{ textAlign: 'center' }}>ACTION</th>
                    <th style={{ width: '440px', textAlign: 'center' }}>BULK ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTables.map((t, idx) => {
                    const pCnt = t.pending_count || 0;
                    const vCnt = t.verified_count || 0;
                    const aCnt = t.approved_count || 0;
                    const dCnt = t.download_count || 0;
                    const lCnt = t.pool_count || 0;
                    const totCnt = t.total_count || (pCnt + vCnt + aCnt + dCnt + lCnt);

                    return (
                      <tr key={t.id || idx}>
                        {/* Column 1: Table Name */}
                        <td style={{ fontWeight: 700, color: '#0f172a', textAlign: 'left' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <span style={{ fontSize: '13px', color: '#1e293b', fontWeight: 700 }}>{t.name}</span>
                            <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 500 }}>
                              {t.client_name || 'Primary Organisation'}
                            </span>
                          </div>
                        </td>

                        {/* Column 2: Action Status Buttons with Count Badges */}
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexWrap: 'nowrap' }}>
                            <button
                              type="button"
                              onClick={() => { setSelectedTable(t); setSelectedStatus('pending'); setPage(1); }}
                              style={statusBtnStyle('pending').btn}
                              title="View Pending ID Cards"
                            >
                              <span>Pending</span>
                              <span style={statusBtnStyle('pending').badge}>{pCnt}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => { setSelectedTable(t); setSelectedStatus('verified'); setPage(1); }}
                              style={statusBtnStyle('verified').btn}
                              title="View Verified ID Cards"
                            >
                              <span>Verified</span>
                              <span style={statusBtnStyle('verified').badge}>{vCnt}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => { setSelectedTable(t); setSelectedStatus('approved'); setPage(1); }}
                              style={statusBtnStyle('approved').btn}
                              title="View Approved ID Cards"
                            >
                              <span>Approved</span>
                              <span style={statusBtnStyle('approved').badge}>{aCnt}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => { setSelectedTable(t); setSelectedStatus('download'); setPage(1); }}
                              style={statusBtnStyle('download').btn}
                              title="View Downloaded ID Cards"
                            >
                              <span>Downloaded</span>
                              <span style={statusBtnStyle('download').badge}>{dCnt}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => { setSelectedTable(t); setSelectedStatus('pool'); setPage(1); }}
                              style={statusBtnStyle('pool').btn}
                              title="View Pool ID Cards"
                            >
                              <span>Pool</span>
                              <span style={statusBtnStyle('pool').badge}>{lCnt}</span>
                            </button>
                          </div>
                        </td>

                        {/* Column 3: Bulk Action Buttons */}
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexWrap: 'nowrap' }}>
                            <button
                              type="button"
                              onClick={() => handleBulkReupload(t)}
                              style={bulkBtnStyle('reupload', totCnt === 0)}
                              disabled={totCnt === 0}
                              title={totCnt === 0 ? "No cards in table" : "Bulk Reupload Images"}
                            >
                              Reupload Image
                            </button>

                            <button
                              type="button"
                              onClick={() => handleBulkDownloadAll(t)}
                              style={bulkBtnStyle('downloadAll', totCnt === 0)}
                              disabled={totCnt === 0}
                              title={totCnt === 0 ? "No cards in table" : "Download All ID Cards"}
                            >
                              Download All ID Card
                            </button>

                            <button
                              type="button"
                              onClick={() => handleBulkDeleteAll(t)}
                              style={bulkBtnStyle('deleteAll', totCnt === 0)}
                              disabled={totCnt === 0}
                              title={totCnt === 0 ? "No cards in table" : "Delete All ID Cards"}
                            >
                              Delete All ID Cards
                            </button>

                            <button
                              type="button"
                              onClick={() => handleBulkUpgradeClass(t)}
                              style={bulkBtnStyle('upgradeClass', totCnt === 0)}
                              disabled={totCnt === 0}
                              title={totCnt === 0 ? "No cards in table" : "Upgrade All Class"}
                            >
                              Upgrade All Class
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── MODALS FOR BULK ACTIONS ── */}
        {activeModal === 'delete-all' && modalTable && (
          <div style={modalBackdropStyle}>
            <div style={modalBoxStyle}>
              <h3 style={{ margin: '0 0 8px', color: '#dc2626', fontSize: '16px', fontWeight: 700 }}>
                Delete All ID Cards
              </h3>
              <p style={{ fontSize: '12px', color: '#475569', margin: '0 0 14px' }}>
                Are you sure you want to permanently delete all cards in <strong>"{modalTable.name}"</strong>? Enter the confirmation code below:
              </p>
              <input
                value={deleteCodeInput}
                onChange={e => setDeleteCodeInput(e.target.value)}
                placeholder="Enter 10-digit delete code"
                style={{ width: '100%', height: '36px', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0 10px', fontSize: '13px', marginBottom: '14px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button onClick={() => setActiveModal(null)} className="btn btn-neutral btn-sm">Cancel</button>
                <button onClick={confirmDeleteAll} className="btn btn-danger btn-sm">Confirm Delete All</button>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     VIEW 2: DRILL-DOWN CARD LIST VIEW FOR A SELECTED TABLE
     ═══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="view-container" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      
      {/* Drill-down Header */}
      <div className="action-bar" style={{ background: '#1e293b', color: '#fff', borderBottom: 'none' }}>
        <div className="action-bar-left" style={{ gap: '12px' }}>
          <button
            onClick={() => setSelectedTable(null)}
            className="btn btn-sm btn-neutral"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <ArrowLeft size={13} /> Back to Table Group
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>{selectedTable.name}</span>
            <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
              {selectedStatus.toUpperCase()} ({total})
            </span>
          </div>
        </div>

        <div className="action-bar-right">
          <div className="status-tabs" style={{ display: 'flex', gap: '4px' }}>
            {['pending', 'verified', 'approved', 'download', 'pool'].map(st => (
              <button
                key={st}
                onClick={() => { setSelectedStatus(st); setPage(1); }}
                style={{
                  padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
                  border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                  background: selectedStatus === st ? '#2563eb' : 'rgba(255,255,255,0.1)',
                  color: '#fff'
                }}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cards Table */}
      <div style={{ flex: 1, overflow: 'auto', background: '#f8fafc' }}>
        {cardsLoading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px', display: 'block' }} />
            Loading cards…
          </div>
        ) : cards.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
            <p>No cards found in status "{selectedStatus}".</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                <th style={{ width: '70px', textAlign: 'center' }}>PHOTO</th>
                <th style={{ textAlign: 'left' }}>NAME</th>
                <th style={{ textAlign: 'left' }}>CLASS / DEPT</th>
                <th style={{ textAlign: 'center' }}>STATUS</th>
                <th style={{ width: '100px', textAlign: 'center' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c, i) => (
                <tr key={c.id || i}>
                  <td style={{ textAlign: 'center', fontSize: '11px', color: '#64748b' }}>{(page - 1) * 25 + i + 1}</td>
                  <td style={{ textAlign: 'center' }}>
                    {c.photo || c.image_url ? (
                      <img src={c.photo || c.image_url} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#e2e8f0', margin: '0 auto' }} />
                    )}
                  </td>
                  <td style={{ fontWeight: 600, color: '#0f172a' }}>{c.name || c.field_data?.NAME || '—'}</td>
                  <td style={{ color: '#475569' }}>{c.class_name || c.field_data?.CLASS || c.field_data?.DEPARTMENT || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span className="badge badge-neutral" style={{ textTransform: 'capitalize' }}>{c.status || selectedStatus}</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => setEditingCard(c)}
                      className="btn btn-xs btn-neutral"
                      style={{ padding: '3px 8px', fontSize: '11px' }}
                    >
                      <Edit2 size={11} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Drawer */}
      {editingCard && (
        <CardEditDrawer
          card={editingCard}
          table={selectedTable}
          onClose={() => setEditingCard(null)}
          onSave={() => { setEditingCard(null); loadCards(); addToast?.('Card updated!', 'success'); }}
        />
      )}
    </div>
  );
}

/* ── Inline Helper Styles matching idcard-group.css ── */
function statusBtnStyle(type) {
  const styles = {
    pending:  { bg: '#fef3c7', color: '#92400e', border: '#fde68a', badgeBg: '#f59e0b' },
    verified: { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7', badgeBg: '#10b981' },
    approved: { bg: '#dbeafe', color: '#1e40af', border: '#93c5fd', badgeBg: '#2563eb' },
    download: { bg: '#f3f4f6', color: '#374151', border: '#d1d5db', badgeBg: '#6b7280' },
    pool:     { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5', badgeBg: '#ef4444' },
  };
  const cfg = styles[type] || styles.download;
  return {
    btn: {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
      padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap', minWidth: '95px'
    },
    badge: {
      background: cfg.badgeBg, color: '#ffffff', minWidth: '30px', height: '16px',
      borderRadius: '8px', fontSize: '10px', fontWeight: 700, display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', padding: '0 4px', marginLeft: '4px'
    }
  };
}

function bulkBtnStyle(type, disabled) {
  const colors = {
    reupload:     { bg: '#ffedd5', color: '#c2410c', border: '#fdba74' },
    downloadAll:  { bg: '#e0e7ff', color: '#3730a3', border: '#a5b4fc' },
    deleteAll:    { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
    upgradeClass: { bg: '#dcfce7', color: '#166534', border: '#86efac' },
  };
  const cfg = colors[type] || colors.reupload;
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
    padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
    background: disabled ? '#f8fafc' : cfg.bg,
    color: disabled ? '#94a3b8' : cfg.color,
    border: `1px solid ${disabled ? '#e2e8f0' : cfg.border}`,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
    whiteSpace: 'nowrap', minWidth: '100px'
  };
}

const modalBackdropStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(15,23,42,0.5)', zIndex: 10000,
  display: 'flex', alignItems: 'center', justifyContent: 'center'
};

const modalBoxStyle = {
  background: '#fff', borderRadius: '8px', width: '420px', maxWidth: '90vw',
  padding: '20px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
};
