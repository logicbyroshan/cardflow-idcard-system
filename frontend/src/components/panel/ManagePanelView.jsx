import React, { useState, useEffect, useCallback } from 'react';
import {
  Bell, Mail, Activity, Database, FileDown, Server,
  Plus, RefreshCw, Loader2, Trash2, Eye, Send,
  AlertCircle, Users, UserCheck, TriangleAlert, BellOff,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight
} from 'lucide-react';
import { panelApi } from '../../services/api';

/* ── Standard pagination bar — matches StaffManagementView / ClientDirectoryView ── */
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function PaginationBar({ page, setPage, total, pageSize, setPageSize }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, total);

  return (
    <div className="pagination-bar" id="paginationBar">
      <div className="pagination-left">
        <span className="pagination-info">
          Showing <strong>{start}–{end}</strong> of <strong>{total}</strong> results
        </span>
      </div>

      <div className="pagination-center">
        <button className="pagination-btn" disabled={page === 1} onClick={() => setPage(1)}><ChevronsLeft size={11} /></button>
        <button className="pagination-btn" disabled={page === 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={11} /></button>
        {Array.from({ length: Math.max(1, Math.min(totalPages, 5)) }).map((_, i) => {
          const p = i + 1;
          return <button key={p} className={`page-num${page === p ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>;
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
  );
}


/*
  Exact replica of manage-panel.html layout:
  ┌──────────────────────────────────────────────────────────┐
  │  PANEL TABS: Notifications | Email | Logs | Backups |    │
  │              Templates | System & Server                 │
  ├──────────────────────────────────────────────────────────┤
  │  TAB CONTENT (full height, scrollable)                   │
  └──────────────────────────────────────────────────────────┘
*/

const PANEL_TABS = [
  { id: 'notifications',      label: 'Notifications',     Icon: Bell     },
  { id: 'email-logs',         label: 'Email Management',  Icon: Mail     },
  { id: 'log-history',        label: 'Logs & Updates',    Icon: Activity },
  { id: 'backups',            label: 'Backups',           Icon: Database },
  { id: 'download-templates', label: 'Download Templates',Icon: FileDown },
  { id: 'server-info',        label: 'System & Server',   Icon: Server   },
];

/* ── Notifications Tab ─────────────────────────────────── */
function NotificationsTab({ addToast }) {
  const [notifs, setNotifs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [stats, setStats]     = useState({ total: 0, broadcast: 0, targeted: 0, urgent: 0 });
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal]     = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await panelApi.getNotifications({ search });
      const list = data.notifications || data.results || [];
      setNotifs(list);
      setStats({
        total:     data.total ?? list.length,
        broadcast: data.broadcast ?? list.filter((n) => n.target_type === 'all').length,
        targeted:  data.targeted  ?? list.filter((n) => n.target_type !== 'all').length,
        urgent:    data.urgent    ?? list.filter((n) => n.priority === 'urgent').length,
      });
      setTotal(data.total ?? list.length);
    } catch { setNotifs([]); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const PRIORITY_BADGE = {
    urgent:   'badge-danger',
    high:     'badge-warning',
    normal:   'badge-success',
    low:      'badge-neutral',
  };

  return (
    <div className="panel-tab-content active" id="tab-notifications" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Notif Actions Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', flexShrink: 0, gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Bell size={12} style={{ position: 'absolute', left: '8px', color: '#9ca3af', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notifications..."
              className="form-input"
              style={{ paddingLeft: '26px', height: '28px', width: '200px', fontSize: '12px' }}
            />
          </div>
          <button className="btn btn-md btn-danger" onClick={() => addToast?.('Maintenance mode modal', 'warning')}>
            <AlertCircle size={12} /> Enable Maintenance
          </button>
          <button className="btn btn-md btn-primary" onClick={() => addToast?.('Create notification modal', 'info')}>
            <Plus size={12} /> New Notification
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {[
            { label: stats.total,     Icon: Bell,          title: 'Total Sent' },
            { label: stats.broadcast, Icon: Users,         title: 'Broadcasts' },
            { label: stats.targeted,  Icon: UserCheck,     title: 'Targeted'   },
            { label: stats.urgent,    Icon: TriangleAlert, title: 'Urgent'     },
          ].map(({ label, Icon, title }, i) => (
            <span key={i} title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '4px', fontSize: '12px', color: '#374151', fontWeight: 500 }}>
              <Icon size={11} /> {label}
            </span>
          ))}
        </div>
      </div>

      {/* Notifications Table */}
      <div className="table-wrapper" style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table notif-table">
          <thead>
            <tr>
              <th style={{ width: '50px' }}>Sr no.</th>
              <th>Notification</th>
              <th style={{ width: '120px' }}>Category</th>
              <th style={{ width: '90px' }}>Priority</th>
              <th style={{ width: '130px' }}>Target</th>
              <th style={{ width: '80px', textAlign: 'center' }}>Reads</th>
              <th style={{ width: '130px' }}>Sent</th>
              <th style={{ width: '90px', textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody id="notifTableBody">
            {loading
              ? Array.from({ length: 15 }).map((_, i) => (
                  <tr key={i} className="skeleton-row">
                    {/* Sr no. */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton" style={{ height: '13px', width: '24px', margin: '0 auto' }} /></td>
                    {/* Notification title + excerpt */}
                    <td>
                      <div className="skeleton" style={{ height: '13px', width: `${75 + (i % 4) * 5}%`, marginBottom: '5px' }} />
                      <div className="skeleton" style={{ height: '10px', width: `${50 + (i % 3) * 8}%` }} />
                    </td>
                    {/* Category badge */}
                    <td><div className="skeleton skeleton-cell-badge" /></td>
                    {/* Priority badge */}
                    <td><div className="skeleton skeleton-cell-badge" /></td>
                    {/* Target */}
                    <td><div className="skeleton" style={{ height: '13px', width: '70%' }} /></td>
                    {/* Reads */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton" style={{ height: '13px', width: '32px', margin: '0 auto' }} /></td>
                    {/* Sent At */}
                    <td><div className="skeleton skeleton-cell-date" /></td>
                    {/* Actions */}
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '4px' }}>
                        <div className="skeleton" style={{ width: '24px', height: '24px', borderRadius: '4px' }} />
                        <div className="skeleton" style={{ width: '24px', height: '24px', borderRadius: '4px' }} />
                      </div>
                    </td>
                  </tr>
                ))
              : notifs.length === 0
                ? (
                  <tr className="notif-table-empty">
                    <td colSpan={8}>
                      <div className="empty-state">
                        <BellOff size={28} style={{ color: '#d1d5db', marginBottom: '8px' }} />
                        <p>No notifications yet</p>
                        <span>Create your first notification to get started</span>
                      </div>
                    </td>
                  </tr>
                )
                : notifs.map((n, i) => (
                  <tr key={n.id || i}>
                    <td style={{ textAlign: 'center', color: '#9ca3af' }}>{i + 1}</td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>{n.title || n.subject || '—'}</div>
                      <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '1px' }}>{n.message?.slice(0, 60) || ''}</div>
                    </td>
                    <td><span className="badge badge-neutral">{n.category || 'General'}</span></td>
                    <td>
                      <span className={`badge ${PRIORITY_BADGE[n.priority] || 'badge-neutral'}`}>
                        {n.priority || 'normal'}
                      </span>
                    </td>
                    <td style={{ fontSize: '12px' }}>{n.target_type === 'all' ? 'All Users' : n.target || '—'}</td>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{n.read_count ?? '—'}</td>
                    <td style={{ fontSize: '12px', color: '#6b7280' }}>{n.sent_at ? new Date(n.sent_at).toLocaleString('en-IN') : '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
                        <button className="btn btn-sm btn-neutral" style={{ width: '24px', height: '24px', padding: 0 }} title="View"><Eye size={11} /></button>
                        <button className="btn btn-sm btn-danger" style={{ width: '24px', height: '24px', padding: 0 }} title="Delete" onClick={() => addToast?.('Confirm delete?', 'warning')}><Trash2 size={11} /></button>
                      </div>
                    </td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      <PaginationBar
        page={page} setPage={setPage}
        total={total} pageSize={pageSize} setPageSize={setPageSize}
        loading={loading}
      />
    </div>
  );
}

/* ── Email Logs Tab ──────────────────────────────────── */
function EmailLogsTab({ addToast }) {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal]     = useState(0);

  useEffect(() => {
    setLoading(true);
    panelApi.getEmailLogs?.()
      .then((d) => { const list = d?.logs || d?.results || []; setLogs(list); setTotal(d?.total ?? list.length); })
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="panel-tab-content" id="tab-email-logs" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button className="btn btn-md btn-primary" onClick={() => addToast?.('Compose email modal', 'info')}>
          <Send size={12} /> Send Email
        </button>
      </div>
      <div className="table-wrapper" style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Recipient</th>
              <th>Subject</th>
              <th style={{ width: '90px' }}>Status</th>
              <th style={{ width: '140px' }}>Sent At</th>
              <th style={{ width: '80px', textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 15 }).map((_, i) => (
                  <tr key={i} className="skeleton-row">
                    {/* Recipient */}
                    <td><div className="skeleton" style={{ height: '13px', width: `${65 + (i % 4) * 7}%` }} /></td>
                    {/* Subject */}
                    <td><div className="skeleton" style={{ height: '13px', width: `${70 + (i % 3) * 8}%` }} /></td>
                    {/* Status badge */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-badge" style={{ margin: '0 auto' }} /></td>
                    {/* Sent At */}
                    <td><div className="skeleton skeleton-cell-date" /></td>
                    {/* Actions */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton" style={{ width: '24px', height: '24px', borderRadius: '4px', margin: '0 auto' }} /></td>
                  </tr>
                ))
              : logs.length === 0
                ? <tr><td colSpan={5}><div className="empty-state"><p>No email logs found.</p></div></td></tr>
                : logs.map((l, i) => (
                  <tr key={l.id || i}>
                    <td>{l.recipient || l.to || '—'}</td>
                    <td>{l.subject || '—'}</td>
                    <td><span className={`badge ${l.status === 'sent' ? 'badge-success' : 'badge-danger'}`}>{l.status || '—'}</span></td>
                    <td style={{ fontSize: '12px', color: '#6b7280' }}>{l.sent_at ? new Date(l.sent_at).toLocaleString('en-IN') : '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-sm btn-neutral" style={{ width: '24px', height: '24px', padding: 0 }} onClick={() => addToast?.('Resend email', 'info')}><Send size={11} /></button>
                    </td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
      <PaginationBar page={page} setPage={setPage} total={total} pageSize={pageSize} setPageSize={setPageSize} loading={loading} />
    </div>
  );
} 

/* ── Logs Tab ──────────────────────────────────────── */
function LogHistoryTab({ addToast }) {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal]     = useState(0);

  useEffect(() => {
    setLoading(true);
    panelApi.getLogs?.()
      .then((d) => { const list = d?.logs || d?.results || []; setLogs(list); setTotal(d?.total ?? list.length); })
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="panel-tab-content" id="tab-log-history" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button className="btn btn-sm btn-danger" onClick={() => addToast?.('Clear logs confirm?', 'warning')}>
          <Trash2 size={11} /> Clear Logs
        </button>
      </div>
      <div className="table-wrapper" style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>User</th>
              <th>IP Address</th>
              <th>Level</th>
              <th style={{ width: '140px' }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 15 }).map((_, i) => (
                  <tr key={i} className="skeleton-row">
                    {/* Event */}
                    <td><div className="skeleton" style={{ height: '13px', width: `${65 + (i % 4) * 7}%` }} /></td>
                    {/* User */}
                    <td><div className="skeleton" style={{ height: '13px', width: `${50 + (i % 3) * 10}%` }} /></td>
                    {/* IP Address — monospace short */}
                    <td><div className="skeleton" style={{ height: '13px', width: '80px' }} /></td>
                    {/* Level badge */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton skeleton-cell-badge" style={{ margin: '0 auto' }} /></td>
                    {/* Time */}
                    <td><div className="skeleton skeleton-cell-date" /></td>
                  </tr>
                ))
              : logs.length === 0
                ? <tr><td colSpan={5}><div className="empty-state"><p>No logs found.</p></div></td></tr>
                : logs.map((l, i) => (
                  <tr key={l.id || i}>
                    <td>{l.event || l.action || l.message || '—'}</td>
                    <td style={{ color: '#6b7280' }}>{l.user || l.username || '—'}</td>
                    <td style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: '12px' }}>{l.ip_address || '—'}</td>
                    <td><span className={`badge ${l.level === 'error' ? 'badge-danger' : l.level === 'warning' ? 'badge-warning' : 'badge-neutral'}`}>{l.level || 'info'}</span></td>
                    <td style={{ fontSize: '12px', color: '#6b7280' }}>{l.timestamp ? new Date(l.timestamp).toLocaleString('en-IN') : '—'}</td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
      <PaginationBar page={page} setPage={setPage} total={total} pageSize={pageSize} setPageSize={setPageSize} loading={loading} />
    </div>
  );
}

/* ── Backups Tab ──────────────────────────────────── */
function BackupsTab({ addToast }) {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal]     = useState(0);

  useEffect(() => {
    setLoading(true);
    panelApi.getBackups?.()
      .then((d) => { const list = d?.backups || d?.results || []; setBackups(list); setTotal(d?.total ?? list.length); })
      .catch(() => setBackups([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="panel-tab-content" id="tab-backups" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button className="btn btn-md btn-primary" onClick={() => addToast?.('Creating backup…', 'info')}>
          <Database size={12} /> Create Backup
        </button>
      </div>
      <div className="table-wrapper" style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Backup Name</th>
              <th style={{ width: '100px', textAlign: 'center' }}>Size</th>
              <th style={{ width: '90px' }}>Type</th>
              <th style={{ width: '140px' }}>Created At</th>
              <th style={{ width: '90px', textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 15 }).map((_, i) => (
                  <tr key={i} className="skeleton-row">
                    {/* Backup Name — monospace */}
                    <td><div className="skeleton" style={{ height: '13px', width: `${60 + (i % 4) * 8}%` }} /></td>
                    {/* Size */}
                    <td style={{ textAlign: 'center' }}><div className="skeleton" style={{ height: '13px', width: '50px', margin: '0 auto' }} /></td>
                    {/* Type badge */}
                    <td><div className="skeleton skeleton-cell-badge" /></td>
                    {/* Created At */}
                    <td><div className="skeleton skeleton-cell-date" /></td>
                    {/* Actions */}
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '4px', justifyContent: 'center' }}>
                        <div className="skeleton" style={{ width: '24px', height: '24px', borderRadius: '4px' }} />
                        <div className="skeleton" style={{ width: '24px', height: '24px', borderRadius: '4px' }} />
                      </div>
                    </td>
                  </tr>
                ))
              : backups.length === 0
                ? <tr><td colSpan={5}><div className="empty-state"><Database size={24} style={{ color: '#d1d5db', marginBottom: '8px' }} /><p>No backups found.</p></div></td></tr>
                : backups.map((b, i) => (
                  <tr key={b.id || i}>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{b.filename || b.name || '—'}</td>
                    <td style={{ textAlign: 'center', fontSize: '12px' }}>{b.size_human || b.size || '—'}</td>
                    <td><span className="badge badge-neutral">{b.backup_type || 'full'}</span></td>
                    <td style={{ fontSize: '12px', color: '#6b7280' }}>{b.created_at ? new Date(b.created_at).toLocaleString('en-IN') : '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
                        <button className="btn btn-sm btn-neutral" style={{ width: '24px', height: '24px', padding: 0 }} title="Download"><FileDown size={11} /></button>
                        <button className="btn btn-sm btn-danger" style={{ width: '24px', height: '24px', padding: 0 }} title="Delete" onClick={() => addToast?.('Confirm delete?', 'warning')}><Trash2 size={11} /></button>
                      </div>
                    </td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
      <PaginationBar page={page} setPage={setPage} total={total} pageSize={pageSize} setPageSize={setPageSize} loading={loading} />
    </div>
  );
}

/* ── Download Templates Tab ─────────────────────── */
function DownloadTemplatesTab({ addToast }) {
  return (
    <div className="panel-tab-content" id="tab-download-templates" style={{ padding: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        {['ID Card Template A', 'ID Card Template B', 'ID Card Template C', 'Excel Import Template', 'Photo Upload ZIP Guide', 'User Manual PDF'].map((name, i) => (
          <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: 'linear-gradient(135deg, rgb(0, 80, 210) 0%, rgb(0, 180, 255) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>

              <FileDown size={16} color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>{name}</div>
              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '1px' }}>Click to download</div>
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => addToast?.(`Downloading ${name}…`, 'info')}>
              <FileDown size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Server Info Tab ────────────────────────────── */
function ServerInfoTab() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    panelApi.getServerInfo?.()
      .then((d) => setInfo(d))
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, []);

  const rows = info ? [
    ['Django Version',    info.django_version   || '—'],
    ['Python Version',    info.python_version   || '—'],
    ['Database',          info.database          || '—'],
    ['Cache Backend',     info.cache_backend     || '—'],
    ['Debug Mode',        info.debug ? 'Yes' : 'No'],
    ['Server Time',       info.server_time        || '—'],
    ['Uptime',            info.uptime             || '—'],
    ['Disk Usage',        info.disk_usage         || '—'],
  ] : [];

  return (
    <div className="panel-tab-content" id="tab-server-info" style={{ padding: '16px' }}>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: '36px', borderRadius: '4px' }} />
          ))}
        </div>
      ) : (
        <table className="data-table">
          <tbody>
            {rows.map(([key, val]) => (
              <tr key={key}>
                <td style={{ fontWeight: 600, width: '200px', color: '#374151' }}>{key}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '13px', color: '#6b7280' }}>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Main ManagePanelView ───────────────────────── */
export default function ManagePanelView({ addToast }) {
  const [activeTab, setActiveTab] = useState('notifications');

  const TAB_CONTENT = {
    'notifications':       <NotificationsTab addToast={addToast} />,
    'email-logs':          <EmailLogsTab addToast={addToast} />,
    'log-history':         <LogHistoryTab addToast={addToast} />,
    'backups':             <BackupsTab addToast={addToast} />,
    'download-templates':  <DownloadTemplatesTab addToast={addToast} />,
    'server-info':         <ServerInfoTab />,
  };

  return (
    <div className="panel-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Panel Tabs — exact match to manage-panel.html */}
      <div className="panel-tabs" style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: '1px solid #e5e7eb',
        background: '#f9fafb',
        flexShrink: 0,
        overflowX: 'auto',
      }}>
        {PANEL_TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`panel-tab${activeTab === id ? ' active' : ''}`}
            data-tab={id}
            onClick={() => setActiveTab(id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '9px 14px', fontSize: '12px', fontWeight: 500,
              border: 'none',
              borderBottom: `2px solid ${activeTab === id ? 'rgb(0, 80, 210)' : 'transparent'}`,
              background: activeTab === id ? 'rgba(0, 80, 210, 0.06)' : 'transparent',
              cursor: 'pointer', whiteSpace: 'nowrap',
              color: activeTab === id ? 'rgb(0, 80, 210)' : '#6b7280',
              fontFamily: 'var(--font-family)',
              transition: 'all 0.15s',
            }}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {TAB_CONTENT[activeTab]}
      </div>
    </div>
  );
}
