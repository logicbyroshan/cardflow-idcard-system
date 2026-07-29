import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pen, Users, Trash2, ToggleRight,
  Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  RefreshCw, Loader2, AlertCircle, ShieldCheck, Building
} from 'lucide-react';
import { clientApi } from '../../services/api';

const STATUS_TABS = ['All', 'Active', 'Inactive'];
const TYPE_TABS = ['All', 'Client (Primary)', 'Manager'];
const PAGE_SIZE_OPTIONS = [25, 50, 100];


export default function ClientAccountsView({ addToast, onOpenActionDrawer, onNavigate, onOpenDeleteModal }) {
  const [accounts, setAccounts]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(false);
  const [search, setSearch]           = useState('');
  const [statusTab, setStatusTab]     = useState('All');
  const [typeTab, setTypeTab]         = useState('All');
  const [selected, setSelected]       = useState(null);
  const [page, setPage]               = useState(1);
  const [total, setTotal]             = useState(0);
  const [pageSize, setPageSize]       = useState(25);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const data = await clientApi.getActive({
        page, search,
        status: statusTab !== 'All' ? statusTab.toLowerCase() : '',
        page_size: pageSize,
      });
      const list = data.clients || data.results || data || [];
      setAccounts(list);
      setTotal(data.total || data.count || list.length);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusTab, pageSize]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selAccount = accounts.find((c) => c.id === selected);

  const filteredAccounts = accounts.filter((acc) => {
    if (typeTab === 'Client (Primary)' && (acc.client_type === 'manager' || !acc.is_default)) return false;
    if (typeTab === 'Manager' && (acc.client_type !== 'manager' && acc.is_default)) return false;
    return true;
  });

  const handleToggleStatus = async () => {
    if (!selected) {
      addToast?.('Select a client account first.', 'warning');
      return;
    }
    try {
      await clientApi.toggleStatus(selected);
      addToast?.('Status updated successfully.', 'success');
      load();
    } catch {
      addToast?.('Failed to toggle status.', 'error');
    }
  };

  const handleDelete = () => {
    if (!selAccount) {
      addToast?.('Select a client account to delete.', 'warning');
      return;
    }
    onOpenDeleteModal?.({
      title: 'Delete Client Account',
      itemDescription: `client account "${selAccount.name}"`,
      onConfirm: async () => {
        try {
          await clientApi.deleteClient(selected);
          addToast?.('Client account deleted.', 'success');
          setSelected(null);
          load();
        } catch {
          addToast?.('Could not delete account.', 'error');
        }
      },
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#ffffff', overflow: 'hidden' }}>
      
      {/* ── Action Bar ── */}
      <div style={{
        padding: '8px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexShrink: 0
      }}>
        {/* Left: Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Status Pills */}
          <div style={{ display: 'flex', background: '#e2e8f0', padding: '2px', borderRadius: '4px' }}>
            {STATUS_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => { setStatusTab(tab); setPage(1); }}
                style={{
                  padding: '3px 10px', fontSize: '11px', fontWeight: statusTab === tab ? 700 : 500,
                  borderRadius: '3px', border: 'none', cursor: 'pointer',
                  background: statusTab === tab ? '#ffffff' : 'transparent',
                  color: statusTab === tab ? '#1e293b' : '#64748b',
                  fontFamily: 'var(--font-family)'
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Type Filter */}
          <select
            value={typeTab}
            onChange={(e) => setTypeTab(e.target.value)}
            style={{
              padding: '4px 8px', fontSize: '11px', borderRadius: '4px',
              border: '1px solid #cbd5e1', outline: 'none', fontFamily: 'var(--font-family)', background: '#fff'
            }}
          >
            {TYPE_TABS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Search Box */}
          <div style={{ position: 'relative', width: '200px' }}>
            <Search size={12} style={{ position: 'absolute', left: '8px', top: '8px', color: '#94a3b8' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search Client accounts..."
              style={{
                width: '100%', height: '26px', paddingLeft: '26px', paddingRight: '8px',
                border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '11px', outline: 'none',
                fontFamily: 'var(--font-family)'
              }}
            />
          </div>
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => onOpenActionDrawer?.('add-client')}
            className="btn btn-primary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '4px 10px' }}
          >
            <Plus size={13} /> Add Client Account
          </button>

          <button
            onClick={() => selAccount && onOpenActionDrawer?.('edit-client', selAccount)}
            disabled={!selected}
            className="btn btn-outline btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '4px 8px' }}
          >
            <Pen size={12} /> Edit
          </button>

          <button
            onClick={handleToggleStatus}
            disabled={!selected}
            className="btn btn-outline btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '4px 8px' }}
          >
            <ToggleRight size={12} /> Status
          </button>

          <button
            onClick={handleDelete}
            disabled={!selected}
            className="btn btn-outline btn-sm text-danger"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '4px 8px' }}
          >
            <Trash2 size={12} /> Delete
          </button>

          <button
            onClick={load}
            className="btn btn-outline btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 6px' }}
          >
            {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
          </button>
        </div>
      </div>

      {/* ── Table View ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {error && (
          <div style={{ padding: '10px 16px', background: '#fef2f2', borderBottom: '1px solid #fca5a5', fontSize: '12px', color: '#dc2626', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertCircle size={14} /> Failed to load client accounts list.
          </div>
        )}

        <table className="data-table" style={{ width: '100%', fontSize: '11px' }}>
          <thead>
            <tr>
              <th style={{ width: '32px', textAlign: 'center' }}>#</th>
              <th>ACCOUNT NAME</th>
              <th>ACCOUNT TYPE</th>
              <th>ORGANISATION</th>
              <th style={{ textAlign: 'center' }}>ASSISTANTS (MAX 100)</th>
              <th style={{ textAlign: 'center' }}>STATUS</th>
              <th>CREATED AT</th>
            </tr>
          </thead>
          <tbody>
            {loading && filteredAccounts.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={7} style={{ padding: '12px', textAlign: 'center', color: '#94a3b8' }}>Loading...</td>
                </tr>
              ))
            ) : filteredAccounts.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                  No Client or Manager accounts found.
                </td>
              </tr>
            ) : (
              filteredAccounts.map((acc, idx) => {
                const isSel = selected === acc.id;
                const isPrimary = acc.client_type !== 'manager' && acc.is_default;
                const orgName = acc.organisation?.name || acc.school_name || 'Global Organisation';
                const assistantCount = acc.assistant_count ?? acc.assistants?.length ?? 0;

                return (
                  <tr
                    key={acc.id}
                    onClick={() => setSelected(isSel ? null : acc.id)}
                    className={isSel ? 'selected' : ''}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="radio"
                        checked={isSel}
                        onChange={() => setSelected(acc.id)}
                      />
                    </td>
                    <td style={{ fontWeight: 600, color: '#0f172a' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Users size={13} style={{ color: isPrimary ? '#2563eb' : '#7c3aed' }} />
                        <span>{acc.name}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
                        background: isPrimary ? '#dbeafe' : '#f3e8ff',
                        color: isPrimary ? '#1d4ed8' : '#6b21a8',
                      }}>
                        {isPrimary ? 'Client (Primary)' : 'Manager'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#475569' }}>
                        <Building size={12} />
                        <span>{orgName}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontWeight: 700, color: assistantCount >= 100 ? '#dc2626' : '#059669' }}>
                        {assistantCount} / 100
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${acc.status === 'inactive' ? 'badge-danger' : 'badge-success'}`}>
                        {acc.status || 'active'}
                      </span>
                    </td>
                    <td style={{ color: '#64748b' }}>
                      {acc.created_at ? new Date(acc.created_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination Footer ── */}
      <div style={{
        padding: '8px 16px', background: '#f8fafc', borderTop: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', flexShrink: 0
      }}>
        <div style={{ color: '#64748b' }}>
          Showing {filteredAccounts.length} of {total} Client accounts
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              style={{ padding: '2px 6px', fontSize: '11px', borderRadius: '3px', border: '1px solid #cbd5e1' }}
            >
              {PAGE_SIZE_OPTIONS.map((sz) => <option key={sz} value={sz}>{sz}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button onClick={() => setPage(1)} disabled={page <= 1} className="btn btn-outline btn-xs"><ChevronsLeft size={12} /></button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn btn-outline btn-xs"><ChevronLeft size={12} /></button>
            <span style={{ padding: '0 6px', fontWeight: 600 }}>Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn btn-outline btn-xs"><ChevronRight size={12} /></button>
            <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="btn btn-outline btn-xs"><ChevronsRight size={12} /></button>
          </div>
        </div>
      </div>

    </div>
  );
}
