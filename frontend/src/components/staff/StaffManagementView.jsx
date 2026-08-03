import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pen, Eye, Trash2, ToggleRight, Link, UsersRound, UserCog, Camera,
  Search, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  RefreshCw, Loader2, AlertCircle, Info, ListCheck
} from 'lucide-react';

import { staffApi, operatorApi, assistantApi, photographerApi } from '../../services/api';

/*
  Exact replica of manage-staff.html layout:
  Action Bar (Left: Status tabs, Search | Right: Add, Edit, View, Delete, Active)
  Data Table (Name, Email, Phone, Status, Created At, Updated At, Log/Assignments)
  Pagination Bar
*/

const STATUS_TABS = ['All', 'Active', 'Inactive'];
const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function StaffManagementView({ addToast, staffType = 'operator', onOpenActionDrawer, onNavigate, onOpenDeleteModal }) {
  const [staffList, setStaffList]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);
  const [search, setSearch]         = useState('');
  const [statusTab, setStatusTab]   = useState('All');
  const [selected, setSelected]     = useState(null);
  const [page, setPage]             = useState(1);
  const [total, setTotal]           = useState(0);
  const [pageSize, setPageSize]     = useState(25);

  const isAssistant = staffType === 'assistant';
  const isPhotographer = staffType === 'photographer';

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      if (isAssistant) {
        const res = await assistantApi.list();
        const items = res?.data?.staff || res?.staff || [];
        setStaffList(items);
        setTotal(items.length);
      } else if (isPhotographer) {
        // Photographers list from operatorApi or clientApi
        const res = await operatorApi.list();
        const items = (res?.operators || []).filter(o => o.designation?.toLowerCase().includes('photo') || o.role === 'photographer');
        setStaffList(items);
        setTotal(items.length);
      } else {
        const res = await operatorApi.list({
          page, search,
          status: statusTab !== 'All' ? statusTab.toLowerCase() : '',
          page_size: pageSize,
        });
        const list = res.operators || res.results || res.staff || [];
        setStaffList(list);
        setTotal(res.count || res.total || list.length);
      }
    } catch (err) {
      console.warn('Load staff list error:', err);
      setStaffList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusTab, pageSize, isAssistant, isPhotographer]);


  useEffect(() => { load(); }, [load]);

  const handleToggleStatus = async () => {
    if (!selected) return;
    try {
      let res;
      if (isAssistant) res = await assistantApi.toggleStatus(selected);
      else if (isPhotographer) res = await photographerApi.toggleStatus(selected);
      else res = await operatorApi.toggleStatus(selected);

      if (res.success !== false) {
        addToast?.('Status updated successfully', 'success');
        load();
      } else {
        addToast?.(res.error || res.message || 'Failed to update status', 'error');
      }
    } catch (err) {
      addToast?.('Error updating status', 'error');
    }
  };

  const handleDeleteStaff = () => {
    if (!selected) return;
    const selStaff = staffList.find((s) => s.id === selected);
    if (onOpenDeleteModal) {
      onOpenDeleteModal({
        title: `Delete ${isAssistant ? 'Assistant' : isPhotographer ? 'Photographer' : 'Operator'} "${selStaff?.name || ''}"`,
        itemDescription: `user "${selStaff?.name || ''}"`,
        onConfirm: async () => {
          try {
            let res;
            if (isAssistant) res = await assistantApi.delete(selected);
            else if (isPhotographer) res = await photographerApi.delete(selected);
            else res = await operatorApi.delete(selected);

            if (res.success !== false) {
              addToast?.('Deleted successfully', 'success');
              setSelected(null);
              load();
            } else {
              addToast?.(res.error || res.message || 'Failed to delete', 'error');
            }
          } catch (err) {
            addToast?.('Error deleting staff member', 'error');
          }
        }
      });
    }
  };

  const filtered = staffList.filter((s) => {
    const q = search.toLowerCase();
    const name = s.name || s.full_name || s.username || s.email || '';
    const matchSearch = !q || name.toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q);
    const isActive = s.is_active !== undefined ? s.is_active : (s.status || 'active').toLowerCase() === 'active';
    const matchStatus = statusTab === 'All' || (statusTab === 'Active' ? isActive : !isActive);
    return matchSearch && matchStatus;
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selStaff = staffList.find((s) => s.id === selected);

  const formatDate = (d) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return d; }
  };


  const title = isAssistant ? 'Manage Assistant' : isPhotographer ? 'Manage Photographer' : 'Manage Operator';

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── ACTION BAR ── */}
      <div className="action-bar" id="staff-action-bar">
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
              placeholder="Search staff..."
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
              <button className="btn btn-md btn-primary" onClick={() => onOpenActionDrawer?.(isAssistant ? 'add-assistant' : isPhotographer ? 'add-photographer' : 'add-operator')}>
                <Plus size={13} /> Add
              </button>
              <button className="btn btn-md btn-neutral" disabled={!selected} onClick={() => onOpenActionDrawer?.(isAssistant ? 'add-assistant' : isPhotographer ? 'add-photographer' : 'add-operator')}>
                <Pen size={13} /> Edit
              </button>
              <button className="btn btn-md btn-neutral" disabled={!selected} onClick={() => addToast?.(`Viewing ${selStaff?.name || 'Staff'}`, 'info')}>
                <Eye size={13} /> View
              </button>
              <button className="btn btn-md btn-primary" disabled={!selected} onClick={() => onOpenActionDrawer?.(isAssistant ? 'assign-assistant' : 'assign-operator')} title={isAssistant ? "Assign Groups / Classes" : "Assign Organisations"}>
                <Link size={13} /> Assign
              </button>
              <button className="btn btn-md btn-danger" disabled={!selected} onClick={handleDeleteStaff}>
                <Trash2 size={13} /> Delete
              </button>
              <button className="btn btn-md btn-warning" disabled={!selected} onClick={handleToggleStatus}>
                <ToggleRight size={13} /> Active
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* ── TABLE CONTAINER ── */}
      <div className="table-wrapper" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <table className="data-table" id="staff-table" style={{ flexShrink: 0 }}>
          <thead>
            <tr>
              <th style={{ width: '45px', textAlign: 'center' }}>S. No.</th>
              {isAssistant && <th>Client</th>}
              <th style={{ width: 'auto' }}>Name</th>
              <th style={{ width: '180px' }}>Email</th>
              <th style={{ width: '110px', textAlign: 'center' }}>Phone</th>
              <th style={{ width: '80px', textAlign: 'center' }}>Status</th>
              <th style={{ width: '120px', textAlign: 'center' }}>Created At</th>
              <th style={{ width: '120px', textAlign: 'center' }}>Updated At</th>
              <th style={{ width: '45px', textAlign: 'center' }} title="Log">Log</th>
            </tr>
          </thead>
          <tbody id="staff-table-body">
            {loading ? (
              Array.from({ length: 15 }).map((_, i) => (
                <tr key={i} className="skeleton-row">
                  <td><div className="skeleton" style={{ width: '16px', height: '16px', borderRadius: '3px', margin: '0 auto' }} /></td>
                  {isAssistant && <td><div className="skeleton skeleton-cell-mid" /></td>}
                  <td><div className="skeleton" style={{ height: '13px', width: `${65 + (i % 4) * 8}%` }} /></td>
                  <td><div className="skeleton" style={{ height: '13px', width: `${55 + (i % 3) * 10}%` }} /></td>
                  <td style={{ textAlign: 'center' }}><div className="skeleton" style={{ height: '13px', width: '72%', margin: '0 auto' }} /></td>
                  <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-badge" style={{ margin: '0 auto' }} /></td>
                  <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-date" style={{ margin: '0 auto' }} /></td>
                  <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-date" style={{ margin: '0 auto', width: '75%' }} /></td>
                  <td style={{ textAlign: 'center' }}>
                    <div className="skeleton skeleton-cell-btn" style={{ width: '22px', height: '22px', borderRadius: '4px', margin: '0 auto' }} />
                  </td>
                </tr>
              ))
            ) : (
              filtered.map((s, idx) => {
                  const name = s.name || s.full_name || s.user?.get_full_name || s.username || s.user?.username || `Staff #${s.id || idx}`;
                  const email = s.email || s.user?.email || '—';
                  const phone = s.phone || s.user?.phone || '—';
                  const isActive = (s.status || (s.user?.is_active ? 'active' : 'inactive')).toLowerCase() === 'active';
                  const isSel = s.id === selected;

                  const formatDT = (str) => {
                    if (!str) return '—';
                    try {
                      const d = new Date(str);
                      if (isNaN(d.getTime())) return str;
                      const day = String(d.getDate()).padStart(2, '0');
                      const month = String(d.getMonth() + 1).padStart(2, '0');
                      const year = String(d.getFullYear()).slice(-2);
                      const hours = String(d.getHours()).padStart(2, '0');
                      const mins = String(d.getMinutes()).padStart(2, '0');
                      return `${day}/${month}/${year} ${hours}:${mins}`;
                    } catch { return str; }
                  };

                  return (
                    <tr
                      key={s.id || idx}
                      className={isSel ? 'selected' : ''}
                      onClick={() => setSelected(isSel ? null : s.id)}
                      data-staff-id={s.id}
                    >
                      <td className="col-checkbox text-center" style={{ width: '45px' }}>
                        <input type="checkbox" checked={isSel} readOnly style={{ cursor: 'pointer' }} />
                      </td>
                      {isAssistant && <td><span style={{ fontSize: '11px', color: '#475569', fontWeight: 500 }}>{s.client_name || s.client?.name || '—'}</span></td>}
                      <td style={{ width: 'auto' }}>
                        <span style={{ fontWeight: 600, color: '#0f172a' }}>{name}</span>
                      </td>
                      <td style={{ width: '180px', color: '#6b7280', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</td>
                      <td className="text-center" style={{ width: '110px', color: '#6b7280', fontSize: '11px' }}>{phone}</td>
                      <td className="text-center" style={{ width: '80px' }}>
                        <span className={`badge ${isActive ? 'badge-success' : 'badge-neutral'}`}>
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="text-center" style={{ width: '120px', fontSize: '11px', color: '#64748b' }}>{formatDT(s.created_at)}</td>
                      <td className="text-center" style={{ width: '120px', fontSize: '11px', color: '#64748b' }}>{formatDT(s.updated_at)}</td>
                      <td className="text-center" style={{ width: '45px' }}>
                        <button
                          className="client-history-trigger"
                          onClick={(e) => { e.stopPropagation(); addToast?.(`Log: ${name}`, 'info'); }}
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
        {!loading && filtered.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center', minHeight: '240px' }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
              color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(37,99,235,0.12)', border: '1px solid #bfdbfe', marginBottom: '12px'
            }}>
              {isAssistant ? <UsersRound size={30} /> : isPhotographer ? <Camera size={30} /> : <UserCog size={30} />}
            </div>
            <div style={{ maxWidth: '340px' }}>
              <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
                {isAssistant ? 'No Assistant Accounts Found' : isPhotographer ? 'No Photographer Accounts Found' : 'No Operator Accounts Found'}
              </h4>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                {search ? `No staff records match "${search}"` : `There are no ${title.toLowerCase()} accounts registered yet.`}
              </p>
            </div>
            {!search && (
              <button
                onClick={() => onOpenActionDrawer?.(isAssistant ? 'add-assistant' : isPhotographer ? 'add-photographer' : 'add-operator')}
                className="btn btn-primary btn-sm"
                style={{ marginTop: '14px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', padding: '7px 16px', borderRadius: '5px' }}
              >
                <Plus size={14} /> Add First {isAssistant ? 'Assistant' : isPhotographer ? 'Photographer' : 'Operator'}
              </button>
            )}
          </div>
        )}
      </div>


      {/* ── STICKY BOTTOM PAGINATION BAR ── */}
      <div className="pagination-bar" id="paginationBar">
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
