import React, { useState, useEffect, useCallback } from "react";
import { Edit2, RotateCcw, RotateCw, RefreshCw, Search, X, Loader2, AlertCircle, ChevronLeft, ChevronRight, Clock, CheckCircle, Download, AlertTriangle, CreditCard, Table2, Building, ChevronDown, ArrowRightLeft } from "lucide-react";
import CardEditDrawer from "./CardEditDrawer";
import { cardApi, clientApi, schemaApi } from "../../services/api";

const STATUS_BADGE = {
  pending:  { cls: "badge-pending",  label: "Pending",   Icon: Clock },
  verified: { cls: "badge-verified", label: "Verified",  Icon: CheckCircle },
  approved: { cls: "badge-approved", label: "Approved",  Icon: CheckCircle },
  download: { cls: "badge-download", label: "Download",  Icon: Download },
  pool:     { cls: "badge-pool",     label: "Pool",      Icon: AlertTriangle },
  printed:  { cls: "badge-printed",  label: "Printed",   Icon: CheckCircle },
};

const PAGE_SIZE = 25;

function TableSelector({ onSelect }) {
  const [clients, setClients]           = useState([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [expanded, setExpanded]         = useState({});
  const [tableMap, setTableMap]         = useState({});
  const [tableLoading, setTableLoading] = useState({});
  const [search, setSearch]             = useState("");

  useEffect(() => {
    (async () => {
      setClientsLoading(true);
      const local = JSON.parse(localStorage.getItem("cf_custom_clients") || "[]");
      try {
        const data = await clientApi.getAllClients({ page: 1, page_size: 200 });
        const api = data?.clients || data?.results || (Array.isArray(data) ? data : []);
        const merged = [...api];
        local.forEach(lc => { if (!merged.find(ac => String(ac.id) === String(lc.id))) merged.push(lc); });
        setClients(merged);
      } catch { setClients(local); }
      finally { setClientsLoading(false); }
    })();
  }, []);

  const toggleExpand = async (client) => {
    const id = client.id;
    const isOpen = expanded[id];
    setExpanded(p => ({ ...p, [id]: !isOpen }));
    if (!isOpen && !tableMap[id]) {
      setTableLoading(p => ({ ...p, [id]: true }));
      const localTables = JSON.parse(localStorage.getItem("cf_custom_tables") || "[]");
      const defaultTables = [
        { id: `tbl_${id}_1`, name: 'Class 1st to 5th', session_year: '2026-27' },
        { id: `tbl_${id}_2`, name: 'Class 6th to 10th', session_year: '2026-27' },
        { id: `tbl_${id}_3`, name: 'Class 11th & 12th', session_year: '2026-27' },
        { id: `tbl_${id}_4`, name: 'Staff & Teachers', session_year: '2026-27' },
      ];
      try {
        const groupId = client.group_id || client.group?.id || client.id;
        const data = await schemaApi.getGroupTables(groupId);
        const list = data?.tables || data?.results || (Array.isArray(data) ? data : []);
        const orgLocal = localTables.filter(t => t.client_name === client.name || String(t.client_id) === String(id));
        const merged = [...orgLocal, ...list];
        setTableMap(p => ({ ...p, [id]: merged.length > 0 ? merged : defaultTables }));
      } catch {
        const orgLocal = localTables.filter(t => t.client_name === client.name || String(t.client_id) === String(id));
        setTableMap(p => ({ ...p, [id]: orgLocal.length > 0 ? orgLocal : defaultTables }));
      }
      finally { setTableLoading(p => ({ ...p, [id]: false })); }
    }
  };

  const filtered = clients.filter(c => !search || (c.name || "").toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ width: "260px", flexShrink: 0, background: "#fff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ background: "linear-gradient(135deg, rgb(0,80,210) 0%, rgb(0,180,255) 100%)", color: "#fff", padding: "10px 12px", fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
        <Table2 size={13} /> Select a Table
      </div>
      <div style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
        <div className="notif-search-box" style={{ width: "100%" }}>
          <Search size={12} style={{ color: "#9ca3af", marginRight: "6px", flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search organisations..." />
          {search && <button onClick={() => setSearch("")} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#9ca3af" }}><X size={11} /></button>}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {clientsLoading ? (
          <div style={{ padding: "20px", textAlign: "center", color: "#9ca3af", fontSize: "12px" }}>
            <Loader2 size={20} style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto 8px" }} />Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", color: "#9ca3af", fontSize: "12px" }}>
            <Building size={28} style={{ opacity: 0.3, display: "block", margin: "0 auto 8px" }} />No organisations found
          </div>
        ) : filtered.map(c => (
          <div key={c.id}>
            <div onClick={() => toggleExpand(c)} style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid #f8fafc", display: "flex", alignItems: "center", gap: "8px", background: expanded[c.id] ? "#eff6ff" : "transparent" }}
              onMouseEnter={e => { if (!expanded[c.id]) e.currentTarget.style.background="#f8fafc"; }}
              onMouseLeave={e => { if (!expanded[c.id]) e.currentTarget.style.background="transparent"; }}>
              <Building size={13} style={{ color: "#64748b", flexShrink: 0 }} />
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
              {tableLoading[c.id] ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite", color: "#94a3b8" }} /> : expanded[c.id] ? <ChevronDown size={12} style={{ color: "#94a3b8" }} /> : <ChevronRight size={12} style={{ color: "#94a3b8" }} />}
            </div>
            {expanded[c.id] && (
              <div style={{ background: "#f8fafc" }}>
                {(tableMap[c.id] || []).length === 0 ? (
                  <div style={{ padding: "8px 20px", fontSize: "11px", color: "#9ca3af", fontStyle: "italic" }}>No tables</div>
                ) : (tableMap[c.id] || []).map(t => (
                  <div key={t.id} onClick={() => onSelect(t)} style={{ padding: "7px 20px", cursor: "pointer", fontSize: "12px", color: "#374151", display: "flex", alignItems: "center", gap: "6px", borderBottom: "1px solid #f1f5f9" }}
                    onMouseEnter={e => { e.currentTarget.style.background="#dbeafe"; e.currentTarget.style.color="#1d4ed8"; }}
                    onMouseLeave={e => { e.currentTarget.style.background="transparent"; e.currentTarget.style.color="#374151"; }}>
                    <Table2 size={11} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                    <span style={{ fontSize: "10px", color: "#94a3b8" }}>{t.session_year}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CardTableView({ tableId: propTableId, cards: propCards, onEditCard, addToast }) {
  const [activeTableId, setActiveTableId] = useState(propTableId || null);
  const [activeTableName, setActiveTableName] = useState("");
  const [liveCards, setLiveCards]       = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [search, setSearch]             = useState("");
  const [page, setPage]                 = useState(1);
  const [total, setTotal]               = useState(0);
  const [statusCounts, setStatusCounts] = useState({});
  const [changingStatus, setChangingStatus] = useState(null); // cardId being status-changed

  useEffect(() => { if (propTableId) setActiveTableId(propTableId); }, [propTableId]);

  const load = useCallback(async () => {
    if (!activeTableId) return;
    setLoading(true); setError(false);
    try {
      const data = await cardApi.getCards(activeTableId, { page, search, page_size: PAGE_SIZE });
      setLiveCards(data.cards || data.results || data || []);
      setTotal(data.total || data.count || 0);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [activeTableId, page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [activeTableId, search]);

  // Load per-table status counts from backend
  useEffect(() => {
    if (!activeTableId) return;
    cardApi.getStatusCounts(activeTableId)
      .then(data => setStatusCounts(data || {}))
      .catch(() => {}); // silent fallback
  }, [activeTableId]);

  const handleChangeStatus = useCallback(async (card, newStatus) => {
    setChangingStatus(card.id);
    try {
      await cardApi.changeStatus(card.id, newStatus);
      addToast?.(`Status changed to ${newStatus}`, 'success');
      load();
      // Refresh counts after status change
      cardApi.getStatusCounts(activeTableId).then(d => setStatusCounts(d || {})).catch(() => {});
    } catch {
      addToast?.('Failed to change card status', 'error');
    } finally {
      setChangingStatus(null);
    }
  }, [activeTableId, load, addToast]);

  const handleSelectTable = (t) => {
    setActiveTableId(t.id);
    setActiveTableName(t.name || "");
    setSearch("");
    setPage(1);
    setLiveCards([]);
  };

  const displayCards = activeTableId ? liveCards : (propCards?.length ? propCards : []);
  const isLive       = !!activeTableId;
  const totalPages   = Math.ceil(total / PAGE_SIZE);
  const showSelector = !propTableId;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {showSelector && <TableSelector onSelect={handleSelectTable} />}

      <div className="data-card" style={{ borderRadius: 0, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="action-bar" style={{ position: "relative" }}>
          <div className="action-bar-left">
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>{activeTableName || "ID Cards"}</span>
            <div className="action-divider" />
            <span style={{ fontSize: "12px", color: "#6b7280" }}>
              {isLive ? (loading ? "Loading..." : `${total.toLocaleString()} records`) : `${displayCards.length} entries`}
            </span>
            {isLive && !loading && Object.keys(statusCounts).length > 0 && (
              <>
                <div className="action-divider" />
                {Object.entries(statusCounts).map(([st, cnt]) => {
                  const cfg = STATUS_BADGE[st] || STATUS_BADGE.pending;
                  return cnt > 0 ? (
                    <span key={st} style={{ fontSize: "11px", padding: "2px 7px", borderRadius: "10px", background: st === 'verified' || st === 'approved' || st === 'printed' ? '#dcfce7' : st === 'pending' ? '#fef9c3' : '#fee2e2', color: st === 'verified' || st === 'approved' || st === 'printed' ? '#15803d' : st === 'pending' ? '#92400e' : '#b91c1c', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                      {cfg.label}: {cnt}
                    </span>
                  ) : null;
                })}
              </>
            )}
          </div>
          {isLive && (
            <div className="action-bar-right">
              <div className="notif-search-box" style={{ width: "160px" }}>
                <Search size={12} style={{ color: "#9ca3af", flexShrink: 0, marginRight: "6px" }} />
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search..." />
                {search && <button onClick={() => setSearch("")} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#9ca3af", display: "flex", alignItems: "center", padding: "0 2px" }}><X size={12} /></button>}
              </div>
              <button onClick={load} className="btn btn-md btn-neutral" style={{ padding: "0 8px", height: "28px" }}>
                {loading ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={11} />}
              </button>
            </div>
          )}
        </div>

        {!isLive && !displayCards.length && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", color: "#94a3b8" }}>
            <Table2 size={48} style={{ opacity: 0.2 }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#64748b", marginBottom: "6px" }}>No Table Selected</div>
              <div style={{ fontSize: "12px" }}>Choose an organisation and table from the left panel</div>
            </div>
          </div>
        )}

        {error && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "10px" }}>
            <AlertCircle size={32} style={{ color: "#f59e0b" }} />
            <span style={{ fontSize: "13px", color: "#94a3b8" }}>Failed to load cards</span>
            <button onClick={load} className="btn btn-sm btn-neutral" style={{ display: "flex", alignItems: "center", gap: "6px" }}><RefreshCw size={12} /> Retry</button>
          </div>
        )}

        {(isLive || displayCards.length > 0) && !error && (
          <div className="table-wrapper" style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", minHeight: 0 }}>
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
                {loading ? Array.from({ length: 15 }).map((_, i) => (
                  <tr key={i} className="skeleton-row">
                    <td style={{ textAlign: "center" }}><div className="skeleton" style={{ height: "13px", width: "24px", margin: "0 auto" }} /></td>
                    <td style={{ textAlign: "center" }}><div className="skeleton" style={{ width: "32px", height: "32px", borderRadius: "50%", margin: "0 auto" }} /></td>
                    <td><div className="skeleton" style={{ height: "13px", width: `${65+(i%4)*8}%` }} /></td>
                    <td><div className="skeleton" style={{ height: "13px", width: `${55+(i%3)*10}%` }} /></td>
                    <td><div className="skeleton" style={{ height: "13px", width: "60%" }} /></td>
                    <td><div className="skeleton" style={{ height: "13px", width: "40%" }} /></td>
                    <td style={{ textAlign: "center" }}><div className="skeleton skeleton-cell-badge" style={{ margin: "0 auto" }} /></td>
                    <td style={{ textAlign: "center" }}><div style={{ display: "inline-flex", gap: "4px" }}><div className="skeleton" style={{ width: "26px", height: "26px", borderRadius: "4px" }} /><div className="skeleton" style={{ width: "26px", height: "26px", borderRadius: "4px" }} /><div className="skeleton" style={{ width: "26px", height: "26px", borderRadius: "4px" }} /></div></td>
                  </tr>
                )) : displayCards.map((card, idx) => {
                  const d = card.field_data || card.fields || {};
                  const status = card.status || "pending";
                  const cfg = STATUS_BADGE[status] || STATUS_BADGE.pending;
                  const Icon = cfg.Icon;
                  const photo = d.PHOTO || card.photo_url || "";
                  const name = d.NAME || card.name || "—";
                  return (
                    <tr key={card.id}>
                      <td className="col-sr" style={{ textAlign: "center", color: "#9ca3af" }}>{(page-1)*PAGE_SIZE+idx+1}</td>
                      <td className="col-photo">
                        <div style={{ width: "28px", height: "28px", borderRadius: "4px", background: "#e5e7eb", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "#667eea", margin: "0 auto" }}>
                          {photo ? <img src={`/${photo}`} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => e.currentTarget.style.display="none"} /> : name[0] || "C"}
                        </div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{name}</td>
                      <td style={{ color: "#6b7280" }}>{d.FATHER_NAME || "—"}</td>
                      <td>{d.CLASS || "—"}</td>
                      <td>{d.SECTION || "—"}</td>
                      <td><span className={`badge ${cfg.cls}`}><Icon size={10} /> {cfg.label}</span></td>
                      <td className="col-actions">
                        <div style={{ display: "flex", gap: "3px", justifyContent: "center" }}>
                          <button onClick={async () => { try { await cardApi.undoImage(card.id); addToast?.("Undo photo", "success"); load(); } catch { addToast?.("Undo failed", "error"); } }} className="btn btn-sm" title="Undo photo" style={{ background: "#fef3c7", color: "#d97706", border: "none", width: "24px", height: "24px", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px" }}><RotateCcw size={11} /></button>
                          <button onClick={async () => { try { await cardApi.redoImage(card.id); addToast?.("Redo photo", "success"); load(); } catch { addToast?.("Redo failed", "error"); } }} className="btn btn-sm" title="Redo photo" style={{ background: "#d1fae5", color: "#059669", border: "none", width: "24px", height: "24px", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px" }}><RotateCw size={11} /></button>
                          <button
                            title="Change Status"
                            disabled={changingStatus === card.id}
                            onClick={() => {
                              // Cycle through statuses
                              const cycle = ['pending','verified','approved','printed','pool'];
                              const next = cycle[(cycle.indexOf(status) + 1) % cycle.length];
                              handleChangeStatus(card, next);
                            }}
                            style={{ background: "#ede9fe", color: "#7c3aed", border: "none", width: "24px", height: "24px", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px", cursor: changingStatus === card.id ? 'not-allowed' : 'pointer' }}
                          >
                            {changingStatus === card.id ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRightLeft size={11} />}
                          </button>
                          <button onClick={() => setSelectedCard(card)} className="btn btn-sm btn-neutral" title="Edit" style={{ width: "24px", height: "24px", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px" }}><Edit2 size={11} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && displayCards.length === 0 && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", textAlign: "center", minHeight: "240px" }}>
                <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(37,99,235,0.12)", border: "1px solid #bfdbfe", marginBottom: "12px" }}>
                  <CreditCard size={30} />
                </div>
                <h4 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", margin: "0 0 6px 0" }}>No ID Cards Found</h4>
                <p style={{ fontSize: "12px", color: "#64748b", margin: 0, lineHeight: 1.5 }}>
                  {search ? `No cards match "${search}"` : "There are no ID card records in this table yet."}
                </p>
              </div>
            )}
          </div>
        )}

        {isLive && totalPages > 1 && (
          <div className="pagination-bar">
            <div className="pagination-info">Showing <strong>{(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE,total)}</strong> of <strong>{total}</strong></div>
            <div className="pagination-controls">
              <button className="pagination-btn" disabled={page===1} onClick={() => setPage(p=>p-1)}><ChevronLeft size={12} /></button>
              {Array.from({ length: Math.min(totalPages,5) }).map((_,i) => {
                const p = i+1;
                return <button key={p} className={`pagination-btn${page===p?" active":""}`} onClick={() => setPage(p)}>{p}</button>;
              })}
              <button className="pagination-btn" disabled={page>=totalPages} onClick={() => setPage(p=>p+1)}><ChevronRight size={12} /></button>
            </div>
          </div>
        )}

        {selectedCard && (
          <CardEditDrawer
            card={selectedCard}
            addToast={addToast}
            onClose={() => setSelectedCard(null)}
            onSave={(updated) => { if (onEditCard) onEditCard(updated); setSelectedCard(null); load(); }}
          />
        )}
      </div>
    </div>
  );
}
