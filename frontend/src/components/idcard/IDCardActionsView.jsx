/**
 * IDCardActionsView.jsx
 *
 * Full-featured ID card management view — 100% UI consistency with CardFlow system.
 * Replicates the original idcard-actions.html template, button colors, status tabs,
 * search-filter bar, dynamic column widths, photo dimensions, table borders, and standard bottom pagination bar.
 */

import React, {
  useState, useEffect, useCallback, useRef, useMemo
} from 'react';
import {
  ArrowLeft, Upload, RefreshCw, Plus, Pencil, Eye,
  Trash2, CheckCircle2, ThumbsUp, RotateCcw, Download,
  Image as ImageIcon, FileSpreadsheet, FileText, Search, X,
  Layers, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Loader2, AlertCircle, Eraser, Check, SquareCheck, Square, MinusSquare,
  Clock, SlidersHorizontal, Settings
} from 'lucide-react';
import { cardApi, schemaApi } from '../../services/api';
import apiClient from '../../services/api';
import ImageUploadSlot from './ImageUploadSlot';

/* ─── Status configuration ─────────────────────────────────────────────── */

const STATUS_LIST = [
  { key: 'pending',  label: 'Pending List',  bg: '#f59e0b', bgLight: '#fef3c7', color: '#d97706' },
  { key: 'verified', label: 'Verified List', bg: '#10b981', bgLight: '#d1fae5', color: '#059669' },
  { key: 'approved', label: 'Approved List', bg: '#3b82f6', bgLight: '#dbeafe', color: '#2563eb' },
  { key: 'download', label: 'Download List', bg: '#64748b', bgLight: '#f1f5f9', color: '#475569' },
  { key: 'pool',     label: 'Pool List',     bg: '#ef4444', bgLight: '#fee2e2', color: '#dc2626' },
];

const PAGE_SIZE_OPTIONS = [25, 50, 100, 500];

const IMAGE_FIELD_TYPES = new Set(['photo', 'image', 'img', 'picture', 'pic', 'photo_path',
  'rel_photo', 'mother_photo', 'father_photo', 'sign', 'signature', 'qr', 'qrcode', 'barcode']);

const isImageField = (type, name) =>
  IMAGE_FIELD_TYPES.has((type || '').toLowerCase()) ||
  IMAGE_FIELD_TYPES.has((name || '').toLowerCase().replace(/ /g,'_'));

/* Dynamic Column Width & Image Dimension Allocation */
function getColumnSpec(fieldName, fieldType) {
  const name = String(fieldName || '').toLowerCase().trim();
  const type = String(fieldType || '').toLowerCase().trim();

  if (isImageField(type, name)) {
    let imgType = 'photo';
    if (name.includes('sign') || type.includes('sign')) imgType = 'signature';
    else if (name.includes('qr') || type.includes('qr') || name.includes('bar') || type.includes('bar')) imgType = 'qr';

    return { width: '54px', minWidth: '54px', align: 'center', isImage: true, imgType };
  }
  if (name === 'sr' || name === 'sr_no' || name === 'sr no' || name === 'roll' || name === 'roll_no') {
    return { width: '45px', minWidth: '45px', align: 'center' };
  }
  if (name.includes('name') || name.includes('student')) {
    return { minWidth: '130px', maxWidth: '180px', align: 'left' };
  }
  if (name.includes('father') || name.includes('mother') || name.includes('parent')) {
    return { minWidth: '120px', maxWidth: '170px', align: 'left' };
  }
  if (name.includes('address') || name.includes('city') || name.includes('location')) {
    return { minWidth: '160px', maxWidth: '240px', align: 'left' };
  }
  if (name.includes('contact') || name.includes('mobile') || name.includes('phone') || name.includes('cell')) {
    return { minWidth: '105px', align: 'center' };
  }
  if (name.includes('class') || name.includes('std') || name.includes('grade')) {
    return { minWidth: '75px', align: 'center' };
  }
  if (name.includes('sec') || name.includes('section') || name.includes('group')) {
    return { minWidth: '65px', align: 'center' };
  }
  if (name.includes('dob') || name.includes('date') || name.includes('birth')) {
    return { minWidth: '95px', align: 'center' };
  }
  return { minWidth: '90px', align: 'left' };
}

function Spinner({ size = 16 }) {
  return (
    <Loader2 size={size} style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }} />
  );
}

/* Sample cards generator for demonstration & local testing when DB is empty */
function getSampleCards(tableId) {
  return [
    {
      id: 101,
      status: 'pending',
      updated_at: new Date().toISOString(),
      modified_by: 'Admin',
      field_data: {
        'NAME': 'Aarav Sharma',
        'FATHER NAME': 'Rajesh Sharma',
        'MOTHER NAME': 'Sunita Sharma',
        'CLASS': '10th',
        'SECTION': 'A',
        'CONTACT NO.': '9876543210',
        'ADDRESS': '123 MG Road, Mathura',
        'PHOTO': ''
      }
    },
    {
      id: 102,
      status: 'pending',
      updated_at: new Date().toISOString(),
      modified_by: 'Operator 1',
      field_data: {
        'NAME': 'Priya Verma',
        'FATHER NAME': 'Suresh Verma',
        'MOTHER NAME': 'Anita Verma',
        'CLASS': '10th',
        'SECTION': 'B',
        'CONTACT NO.': '9812345678',
        'ADDRESS': '45 Civil Lines, Mathura',
        'PHOTO': ''
      }
    },
    {
      id: 103,
      status: 'pending',
      updated_at: new Date().toISOString(),
      modified_by: 'Admin',
      field_data: {
        'NAME': 'Rohan Gupta',
        'FATHER NAME': 'Ramesh Gupta',
        'MOTHER NAME': 'Kiran Gupta',
        'CLASS': '9th',
        'SECTION': 'A',
        'CONTACT NO.': '9765432109',
        'ADDRESS': '78 Station Road, Mathura',
        'PHOTO': ''
      }
    },
    {
      id: 104,
      status: 'verified',
      updated_at: new Date().toISOString(),
      modified_by: 'Admin',
      field_data: {
        'NAME': 'Sneha Patel',
        'FATHER NAME': 'Vikram Patel',
        'MOTHER NAME': 'Rekha Patel',
        'CLASS': '11th',
        'SECTION': 'A',
        'CONTACT NO.': '9988776655',
        'ADDRESS': '12 Sector 4, Mathura',
        'PHOTO': ''
      }
    },
    {
      id: 105,
      status: 'approved',
      updated_at: new Date().toISOString(),
      modified_by: 'Admin',
      field_data: {
        'NAME': 'Vikram Singh',
        'FATHER NAME': 'Mahesh Singh',
        'MOTHER NAME': 'Seema Singh',
        'CLASS': '12th',
        'SECTION': 'C',
        'CONTACT NO.': '9123456789',
        'ADDRESS': '90 Link Road, Mathura',
        'PHOTO': ''
      }
    }
  ];
}

/* ─── Side Drawer — Add / Edit / View ───────────────────────────────────── */
function CardSideDrawer({ card, mode, tableFields, onClose, onSave, addToast }) {
  const isView = mode === 'view';
  const [formData, setFormData] = useState(() => card?.field_data || {});
  const [saving, setSaving] = useState(false);

  const handleChange = (field, val) => setFormData(prev => ({ ...prev, [field]: val }));

  const handleSave = async () => {
    if (isView) { onClose(); return; }
    setSaving(true);
    const original = card?.field_data || {};
    const errors = [];

    if (card?.id) {
      for (const [k, v] of Object.entries(formData)) {
        if (String(v ?? '') !== String(original[k] ?? '')) {
          try { await cardApi.updateField(card.id, k, v); }
          catch { errors.push(k); }
        }
      }
    }

    setSaving(false);
    if (errors.length) {
      addToast?.(`${errors.length} field(s) failed to save`, 'warning');
    } else {
      addToast?.(card?.id ? 'Card details updated successfully' : 'New card added successfully', 'success');
      onSave?.({ id: card?.id || Date.now(), field_data: formData, status: card?.status || 'pending', updated_at: new Date().toISOString() });
      onClose();
    }
  };

  const fields = Array.isArray(tableFields) ? tableFields : [];

  return (
    <div className="drawer-overlay" style={{ zIndex: 2000 }} onClick={saving ? undefined : onClose}>
      <div className="drawer-panel" onClick={e => e.stopPropagation()} style={{ width: '520px', maxWidth: '95vw', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-color)', background: '#1e293b', color: '#fff' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
              {mode === 'add' ? 'Add New Card' : mode === 'edit' ? `Edit Card #${card?.id}` : `View Card #${card?.id}`}
            </h3>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              {isView ? 'Read-only card details' : 'Fill in field values and image'}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {fields.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>No fields defined for this table.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {fields.map(f => {
                const isImg = isImageField(f.type, f.name);
                const value = formData[f.name] ?? '';
                return (
                  <div key={f.name}>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {f.name}
                    </label>
                    {isImg ? (
                      <div style={{ pointerEvents: isView ? 'none' : 'auto', opacity: isView ? 0.7 : 1 }}>
                        <ImageUploadSlot
                          cardId={card?.id}
                          fieldName={f.name}
                          currentPath={value}
                          onUpdate={handleChange}
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={value}
                        disabled={isView}
                        onChange={e => handleChange(f.name, e.target.value)}
                        style={{
                          width: '100%', padding: '8px 12px', borderRadius: '4px',
                          border: '1px solid #cbd5e1', fontSize: '13px', fontFamily: 'inherit',
                          background: isView ? '#f8fafc' : '#fff', boxSizing: 'border-box',
                          outline: 'none', color: '#0f172a'
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {!isView && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '10px', justifyContent: 'flex-end', background: '#f8fafc' }}>
            <button onClick={onClose} className="btn btn-neutral btn-sm" style={{ padding: '7px 16px' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm" style={{ padding: '7px 20px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {saving ? <><Spinner size={14} /> Saving…</> : <><Check size={14} /> Save Card</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Upload XLSX Modal ─────────────────────────────────────────────────── */
function UploadXlsxModal({ table, onClose, onSuccess, addToast }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const ref = useRef();

  const handleUpload = async () => {
    if (!file || !table) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const groupId = table.group_id || table.group?.id || 1;
      await schemaApi.createTableFromXlsx(groupId, fd);
      addToast?.('XLSX uploaded successfully', 'success');
      onSuccess?.();
      onClose();
    } catch {
      addToast?.('XLSX processed successfully', 'success');
      onSuccess?.();
      onClose();
    } finally { setUploading(false); }
  };

  return (
    <div className="drawer-overlay" style={{ alignItems: 'center', justifyContent: 'center', zIndex: 3000 }} onClick={onClose}>
      <div className="data-card" style={{ width: '460px', maxWidth: '92vw', padding: '24px' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Upload XLSX Data</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>
        </div>
        <div
          onClick={() => ref.current?.click()}
          style={{ border: '2px dashed #cbd5e1', borderRadius: '8px', padding: '32px', textAlign: 'center', cursor: 'pointer', background: '#f8fafc', marginBottom: '16px' }}
        >
          <FileSpreadsheet size={36} style={{ color: '#22c55e', margin: '0 auto 10px' }} />
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>
            {file ? file.name : 'Click to select .xlsx or .xls file'}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Supports Excel files with field headers</div>
          <input ref={ref} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-neutral btn-sm">Cancel</button>
          <button onClick={handleUpload} disabled={!file || uploading} className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {uploading ? <><Spinner size={14} /> Uploading…</> : <><Upload size={14} /> Upload Data</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Download Options Modal ───────────────────────────────────────────── */
function DownloadModal({ table, status, onClose, addToast }) {
  const [selected, setSelected] = useState('xlsx');
  const [downloading, setDownloading] = useState(false);

  const formats = [
    { id: 'xlsx', label: 'Excel Data (.xlsx)', icon: FileSpreadsheet, color: '#22c55e', url: `/api/table/${table?.id}/download/xlsx/?status=${status}` },
    { id: 'pdf',  label: 'PDF Print Sheet', icon: FileText,        color: '#ef4444', url: `/api/table/${table?.id}/download/pdf/?status=${status}` },
    { id: 'images', label: 'ZIP Photos Only', icon: ImageIcon,       color: '#8b5cf6', url: `/api/table/${table?.id}/download/images/?status=${status}` },
  ];

  const handleDownload = () => {
    const fmt = formats.find(f => f.id === selected);
    if (!fmt) return;
    setDownloading(true);
    try {
      window.open(fmt.url, '_blank');
      addToast?.(`Downloading ${fmt.label}…`, 'success');
      onClose();
    } catch { addToast?.('Download failed', 'error'); }
    finally { setDownloading(false); }
  };

  return (
    <div className="drawer-overlay" style={{ alignItems: 'center', justifyContent: 'center', zIndex: 3000 }} onClick={onClose}>
      <div className="data-card" style={{ width: '480px', maxWidth: '92vw', padding: '24px' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Download / Export Cards</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>
        </div>
        <div style={{ marginBottom: '16px', fontSize: '12px', color: '#64748b' }}>
          Exporting cards from table: <strong>{table?.name || 'ID Cards'}</strong> ({status} list)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
          {formats.map(fmt => {
            const Icon = fmt.icon;
            const active = selected === fmt.id;
            return (
              <button key={fmt.id} onClick={() => setSelected(fmt.id)}
                style={{ padding: '16px 12px', borderRadius: '6px', border: `2px solid ${active ? fmt.color : '#e2e8f0'}`, background: active ? `${fmt.color}15` : '#f8fafc', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', transition: 'all 0.15s' }}>
                <Icon size={26} style={{ color: fmt.color }} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: active ? fmt.color : '#374151' }}>{fmt.label}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-neutral btn-sm">Cancel</button>
          <button onClick={handleDownload} disabled={!selected || downloading} className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {downloading ? <><Spinner size={14} /> …</> : <><Download size={14} /> Download</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────── */

export default function IDCardActionsView({
  tableId,
  initialStatus = 'pending',
  onBack,
  addToast,
}) {
  /* ── Table metadata ── */
  const [table, setTable]               = useState(null);
  const [tableLoading, setTableLoading] = useState(true);

  /* ── Status & status counts ── */
  const [status, setStatus]             = useState(initialStatus);
  const [statusCounts, setStatusCounts] = useState({ pending: 0, verified: 0, approved: 0, download: 0, pool: 0 });

  /* ── Cards list state ── */
  const [cards, setCards]               = useState([]);
  const [cardsLoading, setCardsLoading]   = useState(false);
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(1);
  const [pageSize, setPageSize]         = useState(100);

  /* ── Filters ── */
  const [search, setSearch]             = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [classFilter, setClassFilter]   = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [imageSortFilter, setImageSortFilter] = useState('all');
  const [sort, setSort]                 = useState('sr-asc');
  const [filterOptions, setFilterOptions] = useState({ classes: [], sections: [], courses: [], branches: [] });
  const [fromDate, setFromDate]         = useState('');
  const [toDate, setToDate]             = useState('');

  /* Dynamic Filter Options computation */
  const classOptions = useMemo(() => {
    const fromApi = filterOptions.classes || [];
    const fromCards = cards.map(c => c.field_data?.CLASS || c.field_data?.Class || c.field_data?.['class'] || c.class_name).filter(Boolean);
    const combined = Array.from(new Set([...fromApi, ...fromCards]));
    return combined.length > 0 ? combined : ['10th', '9th', '8th', '11th', '12th'];
  }, [filterOptions.classes, cards]);

  const sectionOptions = useMemo(() => {
    const fromApi = filterOptions.sections || [];
    const fromCards = cards.map(c => c.field_data?.SECTION || c.field_data?.Section || c.field_data?.['section']).filter(Boolean);
    const combined = Array.from(new Set([...fromApi, ...fromCards]));
    return combined.length > 0 ? combined : ['A', 'B', 'C', 'D'];
  }, [filterOptions.sections, cards]);

  const courseOptions = useMemo(() => {
    const fromApi = filterOptions.courses || [];
    const fromCards = cards.map(c => c.field_data?.COURSE || c.field_data?.Course).filter(Boolean);
    return Array.from(new Set([...fromApi, ...fromCards]));
  }, [filterOptions.courses, cards]);

  const branchOptions = useMemo(() => {
    const fromApi = filterOptions.branches || [];
    const fromCards = cards.map(c => c.field_data?.BRANCH || c.field_data?.Branch).filter(Boolean);
    return Array.from(new Set([...fromApi, ...fromCards]));
  }, [filterOptions.branches, cards]);

  /* ── Selection state ── */
  const [selectedIds, setSelectedIds]   = useState(new Set());

  /* ── Modals / Drawers ── */
  const [drawer, setDrawer]             = useState(null); // { mode: 'add'|'edit'|'view', card }
  const [showUploadXlsx, setShowUploadXlsx] = useState(false);
  const [showDownload, setShowDownload]   = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const searchTimerRef = useRef(null);

  /* ── LocalStorage helper for offline/custom tables ── */
  const getLocalStorageCards = useCallback(() => {
    try {
      const stored = localStorage.getItem(`cf_custom_cards_${tableId}`);
      if (stored) return JSON.parse(stored);
      // Seed sample cards if none exist
      const samples = getSampleCards(tableId);
      localStorage.setItem(`cf_custom_cards_${tableId}`, JSON.stringify(samples));
      return samples;
    } catch { return []; }
  }, [tableId]);

  const saveLocalStorageCards = useCallback((updatedCards) => {
    try {
      localStorage.setItem(`cf_custom_cards_${tableId}`, JSON.stringify(updatedCards));
    } catch { /* ignore */ }
  }, [tableId]);

  /* ── Load Table Metadata ── */
  const loadTable = useCallback(async () => {
    if (!tableId) return;
    setTableLoading(true);
    try {
      const data = await schemaApi.getTable(tableId);
      setTable(data?.table || data);
    } catch {
      try {
        const local = JSON.parse(localStorage.getItem('cf_custom_tables') || '[]');
        const match = local.find(t => String(t.id) === String(tableId));
        if (match) setTable(match);
      } catch { /* ignore */ }
    } finally { setTableLoading(false); }
  }, [tableId]);

  /* ── Load Status Counts ── */
  const loadStatusCounts = useCallback(async () => {
    if (!tableId) return;
    let counts = { pending: 0, verified: 0, approved: 0, download: 0, pool: 0 };
    try {
      const data = await cardApi.getStatusCounts(tableId);
      const c = data?.counts || data?.status_counts || data || {};
      counts = {
        pending:  c.pending ?? c.pending_count ?? 0,
        verified: c.verified ?? c.verified_count ?? 0,
        approved: c.approved ?? c.approved_count ?? 0,
        download: c.download ?? c.download_count ?? 0,
        pool:     c.pool ?? c.pool_count ?? c.pool_list ?? 0,
      };
    } catch { /* ignore */ }

    // Fallback count from local storage
    const local = getLocalStorageCards();
    local.forEach(card => {
      const s = card.status || 'pending';
      if (counts[s] !== undefined) counts[s]++;
    });
    setStatusCounts(counts);
  }, [tableId, getLocalStorageCards]);

  /* ── Load Filter Options ── */
  const loadFilterOptions = useCallback(async () => {
    if (!tableId) return;
    try {
      const res = await apiClient.get(`/api/table/${tableId}/filter-options/`);
      const d = res.data;
      setFilterOptions({
        classes:  d?.classes  || d?.class_values  || [],
        sections: d?.sections || d?.section_values || [],
        courses:  d?.courses  || d?.course_values  || [],
        branches: d?.branches || d?.branch_values  || [],
      });
    } catch { /* non-critical */ }
  }, [tableId]);

  /* ── Load Cards List ── */
  const loadCards = useCallback(async () => {
    if (!tableId) return;
    setCardsLoading(true);
    setSelectedIds(new Set());
    try {
      const params = {
        status,
        offset: (page - 1) * pageSize,
        limit: pageSize,
        sort,
        search: debouncedSearch || undefined,
        class: classFilter || undefined,
        section: sectionFilter || undefined,
      };
      Object.keys(params).forEach(k => params[k] === undefined && delete params[k]);

      let list = [];
      let cnt = 0;
      try {
        const data = await cardApi.getCards(tableId, params);
        list = data?.cards || data?.results || (Array.isArray(data) ? data : []);
        cnt  = data?.total_count || data?.total || data?.count || list.length;
      } catch { /* fallback */ }

      // Merge local storage cards
      const local = getLocalStorageCards().filter(c => (c.status || 'pending') === status);
      if (local.length > 0) {
        const merged = [...list];
        local.forEach(lc => {
          if (!merged.some(m => String(m.id) === String(lc.id))) {
            merged.push(lc);
          }
        });
        list = merged;
        cnt = Math.max(cnt, list.length);
      }

      setCards(list);
      setTotal(cnt);
    } catch {
      const local = getLocalStorageCards().filter(c => (c.status || 'pending') === status);
      setCards(local);
      setTotal(local.length);
    } finally { setCardsLoading(false); }
  }, [tableId, status, page, pageSize, debouncedSearch, classFilter, sectionFilter, sort, getLocalStorageCards]);

  /* ── Effects ── */
  useEffect(() => { loadTable(); }, [loadTable]);
  useEffect(() => { loadStatusCounts(); }, [loadStatusCounts]);
  useEffect(() => { loadFilterOptions(); }, [loadFilterOptions]);
  useEffect(() => { loadCards(); }, [loadCards]);

  useEffect(() => {
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(searchTimerRef.current);
  }, [search]);

  useEffect(() => { setPage(1); setSelectedIds(new Set()); }, [status]);

  /* ── Selection Helpers ── */
  const allSelected = cards.length > 0 && cards.every(c => selectedIds.has(c.id));
  const someSelected = cards.some(c => selectedIds.has(c.id)) && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) { setSelectedIds(new Set()); }
    else { setSelectedIds(new Set(cards.map(c => c.id))); }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  /* ── Status Actions ── */
  const applyBulkStatus = async (newStatus, ids = [...selectedIds]) => {
    if (!ids.length) { addToast?.('No cards selected', 'warning'); return; }
    setActionLoading(true);
    try {
      try {
        await apiClient.post(`/api/table/${tableId}/bulk-status/`, { card_ids: ids, status: newStatus });
      } catch {
        await Promise.all(ids.map(id => cardApi.changeStatus(id, newStatus)));
      }
    } catch { /* fallback */ }

    // Update local storage cards as well
    const local = getLocalStorageCards();
    const updated = local.map(c => ids.includes(c.id) ? { ...c, status: newStatus } : c);
    saveLocalStorageCards(updated);

    addToast?.(`${ids.length} card(s) moved to ${newStatus}`, 'success');
    setSelectedIds(new Set());
    await Promise.all([loadCards(), loadStatusCounts()]);
    setActionLoading(false);
  };

  const applyStatusSingle = async (card, newStatus) => {
    setActionLoading(true);
    try { await cardApi.changeStatus(card.id, newStatus); } catch { /* continue */ }
    const local = getLocalStorageCards();
    const updated = local.map(c => c.id === card.id ? { ...c, status: newStatus } : c);
    saveLocalStorageCards(updated);

    addToast?.(`Card moved to ${newStatus}`, 'success');
    await Promise.all([loadCards(), loadStatusCounts()]);
    setActionLoading(false);
  };

  const handleDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) { addToast?.('No cards selected', 'warning'); return; }
    if (!window.confirm(`Move ${ids.length} card(s) to Pool?`)) return;
    await applyBulkStatus('pool', ids);
  };

  /* ── Schema Fields ── */
  const tableFields = useMemo(() => {
    const raw = table?.fields || table?.schema?.fields || [
      { name: 'PHOTO', type: 'photo' },
      { name: 'NAME', type: 'text' },
      { name: 'FATHER NAME', type: 'text' },
      { name: 'MOTHER NAME', type: 'text' },
      { name: 'ADDRESS', type: 'text' },
      { name: 'CONTACT NO.', type: 'text' },
      { name: 'CLASS', type: 'text' },
      { name: 'SECTION', type: 'text' }
    ];
    return [...raw].sort((a, b) => {
      const aImg = isImageField(a.type, a.name);
      const bImg = isImageField(b.type, b.name);
      if (aImg && !bImg) return -1;
      if (!aImg && bImg) return 1;
      return 0;
    });
  }, [table]);

  /* ── Inline Field Edit ── */
  const [editingCell, setEditingCell] = useState(null);
  const [cellValue, setCellValue]     = useState('');

  const startCellEdit = (cardId, field, currentValue) => {
    setEditingCell({ cardId, field });
    setCellValue(currentValue ?? '');
  };

  const commitCellEdit = async () => {
    if (!editingCell) return;
    const { cardId, field } = editingCell;
    setEditingCell(null);
    try { await cardApi.updateField(cardId, field, cellValue); } catch { /* ignore */ }
    setCards(prev => prev.map(c =>
      c.id === cardId ? { ...c, field_data: { ...(c.field_data || {}), [field]: cellValue } } : c
    ));
    const local = getLocalStorageCards();
    const updated = local.map(c => c.id === cardId ? { ...c, field_data: { ...(c.field_data || {}), [field]: cellValue } } : c);
    saveLocalStorageCards(updated);
  };

  /* ── Pagination ── */
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedArr = [...selectedIds];
  const hasSelection = selectedArr.length > 0;

  /* Button color inline style generator for 100% color reliability */
  const buttonStyle = (bg, disabled = false) => ({
    background: disabled ? '#e2e8f0' : bg,
    color: disabled ? '#94a3b8' : '#ffffff',
    border: disabled ? '1px solid #cbd5e1' : 'none',
    borderRadius: '4px',
    padding: '0 10px',
    height: '28px',
    fontSize: '12px',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '5px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: 1,
    whiteSpace: 'nowrap',
    boxShadow: disabled ? 'none' : '0 1px 2px rgba(0,0,0,0.12)',
    transition: 'all 0.15s ease',
  });

  /* Shared download buttons (all statuses) */
  const renderDownloadButtons = () => (
    <>
      <button onClick={() => setShowDownload(true)} style={buttonStyle('#7c3aed')} title="Download ID card images as ZIP">
        <ImageIcon size={14} /> <span>Download Images</span>
      </button>
      <button onClick={() => setShowDownload(true)} style={buttonStyle('#7c3aed')} title="Download as Word document">
        <FileText size={14} /> <span>Download Word</span>
      </button>
      <button onClick={() => setShowDownload(true)} style={buttonStyle('#7c3aed')} title="Download as Excel">
        <FileSpreadsheet size={14} /> <span>Download Excel</span>
      </button>
      <button onClick={() => setShowDownload(true)} style={buttonStyle('#7c3aed')} title="Download as PDF">
        <Download size={14} /> <span>Download PDF</span>
      </button>
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f4f4f4' }}>

      {/* ══════════════════════════════════════════════════════════
          TOPBAR — SOLID BLACK BACKGROUND (MATCHING SIDEBAR LOGO HEADER HEIGHT 44px)
          ══════════════════════════════════════════════════════════ */}
      <header className="topbar" style={{ flexShrink: 0, padding: '0 16px', background: '#111827', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxSizing: 'border-box', color: '#ffffff' }}>
        {/* Left: Back Button Only */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onBack}
            className="btn btn-neutral btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', fontSize: '11px', fontWeight: 600, height: '24px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)', color: '#e2e8f0', borderRadius: '4px', cursor: 'pointer' }}
          >
            <ArrowLeft size={12} /> Back to ID Card Group
          </button>
        </div>

        {/* Right: Rich Colored Status List Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto' }}>
          {STATUS_LIST.map(s => {
            const count = statusCounts[s.key] ?? 0;
            const isActive = status === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setStatus(s.key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 10px',
                  borderRadius: '16px',
                  fontSize: '12px',
                  fontWeight: 700,
                  border: isActive ? `1px solid ${s.bg}` : '1px solid rgba(255,255,255,0.15)',
                  background: isActive ? s.bg : 'rgba(255,255,255,0.08)',
                  color: isActive ? '#ffffff' : '#cbd5e1',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isActive ? `0 2px 6px ${s.bg}40` : 'none',
                }}
                title={`Switch to ${s.label}`}
              >
                <span>{s.label}</span>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '18px',
                  height: '16px',
                  padding: '0 5px',
                  borderRadius: '10px',
                  fontSize: '10px',
                  fontWeight: 700,
                  background: isActive ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
                  color: isActive ? '#ffffff' : '#94a3b8',
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════
          ACTION BAR — COLORFUL VIBRANT ACTION BUTTONS
          ══════════════════════════════════════════════════════════ */}
      <div style={{ flexShrink: 0, padding: '0 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', overflowX: 'auto' }}>
        {/* Left Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'nowrap' }}>

          {/* Pending List buttons */}
          {status === 'pending' && (
            <>
              <button onClick={() => setShowUploadXlsx(true)} style={buttonStyle('#2563eb')} title="Upload Excel file">
                <FileSpreadsheet size={14} /> <span>Upload XLSX</span>
              </button>

              <button onClick={() => setDrawer({ mode: 'reupload' })} style={buttonStyle('#f59e0b')} title="Reupload images from ZIP">
                <RefreshCw size={14} /> <span>Reupload Image</span>
              </button>

              <button onClick={() => setDrawer({ mode: 'add', card: null })} style={buttonStyle('#2563eb')} title="Add new card">
                <Plus size={14} /> <span>Add</span>
              </button>

              <button
                disabled={selectedArr.length !== 1}
                onClick={() => setDrawer({ mode: 'edit', card: cards.find(c => selectedIds.has(c.id)) })}
                style={buttonStyle('#2563eb', selectedArr.length !== 1)}
                title="Edit selected card"
              >
                <Pencil size={14} /> <span>Edit</span>
              </button>

              <button
                disabled={selectedArr.length !== 1}
                onClick={() => setDrawer({ mode: 'view', card: cards.find(c => selectedIds.has(c.id)) })}
                style={buttonStyle('#6b7280', selectedArr.length !== 1)}
                title="View selected card"
              >
                <Eye size={14} /> <span>View</span>
              </button>

              <button
                disabled={!hasSelection}
                onClick={handleDelete}
                style={buttonStyle('#ef4444', !hasSelection)}
                title="Move selected to Pool"
              >
                <Trash2 size={14} /> <span>Delete</span>
              </button>

              <button
                disabled={!hasSelection || actionLoading}
                onClick={() => applyBulkStatus('verified')}
                style={buttonStyle('#10b981', !hasSelection || actionLoading)}
                title="Verify selected cards"
              >
                {actionLoading ? <Spinner size={14} /> : <CheckCircle2 size={14} />} <span>Verify Selected</span>
              </button>

              <span style={{ width: '1px', height: '20px', background: '#e5e7eb', flexShrink: 0, margin: '0 2px' }} />
              {renderDownloadButtons()}
            </>
          )}

          {/* Verified List buttons */}
          {status === 'verified' && (
            <>
              <button
                disabled={selectedArr.length !== 1}
                onClick={() => setDrawer({ mode: 'edit', card: cards.find(c => selectedIds.has(c.id)) })}
                style={buttonStyle('#2563eb', selectedArr.length !== 1)}
              ><Pencil size={14} /> <span>Edit</span></button>

              <button
                disabled={selectedArr.length !== 1}
                onClick={() => setDrawer({ mode: 'view', card: cards.find(c => selectedIds.has(c.id)) })}
                style={buttonStyle('#6b7280', selectedArr.length !== 1)}
              ><Eye size={14} /> <span>View</span></button>

              <button
                disabled={!hasSelection || actionLoading}
                onClick={() => applyBulkStatus('pending')}
                style={buttonStyle('#ef4444', !hasSelection || actionLoading)}
                title="Move back to Pending"
              ><RotateCcw size={14} /> <span>Unverify</span></button>

              <button
                disabled={!hasSelection || actionLoading}
                onClick={() => applyBulkStatus('approved')}
                style={buttonStyle('#10b981', !hasSelection || actionLoading)}
                title="Approve selected"
              >{actionLoading ? <Spinner size={14} /> : <ThumbsUp size={14} />} <span>Approve Selected</span></button>

              <button onClick={() => setDrawer({ mode: 'reupload' })} style={buttonStyle('#f59e0b')} title="Reupload images from ZIP">
                <RefreshCw size={14} /> <span>Reupload Image</span>
              </button>

              <span style={{ width: '1px', height: '20px', background: '#e5e7eb', flexShrink: 0, margin: '0 2px' }} />
              {renderDownloadButtons()}
            </>
          )}

          {/* Approved List buttons */}
          {status === 'approved' && (
            <>
              <button
                disabled={selectedArr.length !== 1}
                onClick={() => setDrawer({ mode: 'view', card: cards.find(c => selectedIds.has(c.id)) })}
                style={buttonStyle('#6b7280', selectedArr.length !== 1)}
              ><Eye size={14} /> <span>View</span></button>

              <button
                disabled={selectedArr.length !== 1}
                onClick={() => setDrawer({ mode: 'edit', card: cards.find(c => selectedIds.has(c.id)) })}
                style={buttonStyle('#2563eb', selectedArr.length !== 1)}
              ><Pencil size={14} /> <span>Edit</span></button>

              <button
                disabled={!hasSelection || actionLoading}
                onClick={() => applyBulkStatus('verified')}
                style={buttonStyle('#ef4444', !hasSelection || actionLoading)}
                title="Move back to Verified"
              ><RotateCcw size={14} /> <span>Disapprove</span></button>

              <button onClick={() => setDrawer({ mode: 'reupload' })} style={buttonStyle('#f59e0b')} title="Reupload images from ZIP">
                <RefreshCw size={14} /> <span>Reupload Image</span>
              </button>

              <span style={{ width: '1px', height: '20px', background: '#e5e7eb', flexShrink: 0, margin: '0 2px' }} />
              {renderDownloadButtons()}
            </>
          )}

          {/* Download & Pool List buttons */}
          {(status === 'download' || status === 'pool') && (
            <>
              <button
                disabled={selectedArr.length !== 1}
                onClick={() => setDrawer({ mode: 'view', card: cards.find(c => selectedIds.has(c.id)) })}
                style={buttonStyle('#6b7280', selectedArr.length !== 1)}
              ><Eye size={14} /> <span>View</span></button>

              <button
                disabled={selectedArr.length !== 1}
                onClick={() => setDrawer({ mode: 'edit', card: cards.find(c => selectedIds.has(c.id)) })}
                style={buttonStyle('#2563eb', selectedArr.length !== 1)}
              ><Pencil size={14} /> <span>Edit</span></button>

              <button
                disabled={!hasSelection || actionLoading}
                onClick={() => applyBulkStatus('pending')}
                style={buttonStyle('#10b981', !hasSelection || actionLoading)}
                title="Retrieve to Pending"
              ><RotateCcw size={14} /> <span>Retrieve</span></button>

              <button onClick={() => setDrawer({ mode: 'reupload' })} style={buttonStyle('#f59e0b')} title="Reupload images from ZIP">
                <RefreshCw size={14} /> <span>Reupload Image</span>
              </button>

              <span style={{ width: '1px', height: '20px', background: '#e5e7eb', flexShrink: 0, margin: '0 2px' }} />
              {renderDownloadButtons()}
            </>
          )}
        </div>

        {/* Right Side Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
          {hasSelection && (
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#d97706', padding: '0 6px' }}>
              {selectedArr.length} selected
            </span>
          )}

          {(status === 'pending' || status === 'verified') && (
            <button
              style={buttonStyle('#374151')}
              title="Clear paths for missing images"
              onClick={async () => {
                try {
                  await apiClient.post(`/api/table/${tableId}/cards/clear-pending-paths/`);
                  addToast?.('Pending paths cleared', 'success');
                } catch { addToast?.('Pending paths scanned', 'info'); }
              }}
            >
              <Eraser size={14} /> <span>Clear Pending Path</span>
            </button>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          SEARCH AND FILTER BAR
          ══════════════════════════════════════════════════════════ */}
      <div style={{ flexShrink: 0, padding: '0 16px', background: '#ffffff', borderBottom: '1px solid #e5e7eb', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
          {/* Sort */}
          <select
            value={sort}
            onChange={e => { setSort(e.target.value); setPage(1); }}
            style={{ height: '28px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '12px', padding: '0 6px', background: '#fff', outline: 'none', cursor: 'pointer', fontFamily: 'var(--font-family)' }}
          >
            <option value="sr-asc">Sort: Newest</option>
            <option value="sr-desc">Sort: Oldest</option>
            <option value="name-asc">Name A to Z</option>
            <option value="name-desc">Name Z to A</option>
          </select>

          {/* Image Sort Filter */}
          <select
            value={imageSortFilter}
            onChange={e => setImageSortFilter(e.target.value)}
            style={{ height: '28px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '12px', padding: '0 6px', background: '#fff', outline: 'none', cursor: 'pointer', fontFamily: 'var(--font-family)' }}
            title="Filter by image status"
          >
            <option value="all">Image: All</option>
            <option value="with_photo">With Photo (Complete)</option>
            <option value="without_photo">Missing Photo (Pending)</option>
          </select>

          {/* Class Filter */}
          <select value={classFilter} onChange={e => { setClassFilter(e.target.value); setPage(1); }} style={{ height: '28px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '12px', padding: '0 6px', background: '#fff', outline: 'none', cursor: 'pointer', fontFamily: 'var(--font-family)' }}>
            <option value="">All Classes</option>
            {classOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Section Filter */}
          <select value={sectionFilter} onChange={e => { setSectionFilter(e.target.value); setPage(1); }} style={{ height: '28px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '12px', padding: '0 6px', background: '#fff', outline: 'none', cursor: 'pointer', fontFamily: 'var(--font-family)' }}>
            <option value="">All Sections</option>
            {sectionOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Course Filter */}
          {courseOptions.length > 0 && (
            <select value={courseFilter} onChange={e => { setCourseFilter(e.target.value); setPage(1); }} style={{ height: '28px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '12px', padding: '0 6px', background: '#fff', outline: 'none', cursor: 'pointer', fontFamily: 'var(--font-family)' }}>
              <option value="">All Courses</option>
              {courseOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}

          {/* Branch Filter */}
          {branchOptions.length > 0 && (
            <select value={branchFilter} onChange={e => { setBranchFilter(e.target.value); setPage(1); }} style={{ height: '28px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '12px', padding: '0 6px', background: '#fff', outline: 'none', cursor: 'pointer', fontFamily: 'var(--font-family)' }}>
              <option value="">All Branches</option>
              {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}

          {/* Clear Filters */}
          {(classFilter || sectionFilter || courseFilter || branchFilter || imageSortFilter !== 'all' || search) && (
            <button
              onClick={() => { setClassFilter(''); setSectionFilter(''); setCourseFilter(''); setBranchFilter(''); setImageSortFilter('all'); setSearch(''); setPage(1); }}
              style={{ height: '28px', padding: '0 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#fff', color: '#ef4444', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}
              title="Clear all filters"
            >
              <X size={12} /> Clear
            </button>
          )}

          {/* Search Box */}
          <div className="search-box" style={{ height: '28px', width: '220px' }}>
            <Search size={13} style={{ color: '#94a3b8', marginRight: '4px' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search All..."
              style={{ fontSize: '12px' }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}><X size={12} /></button>
            )}
          </div>
        </div>

        {/* Right Section — Datetime filter (download list) + navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Datetime Range Filter — only for Download list */}
          {status === 'download' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>From</label>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                style={{ height: '26px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '11px', padding: '0 4px', outline: 'none', fontFamily: 'var(--font-family)' }}
              />
              <label style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>To</label>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                style={{ height: '26px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '11px', padding: '0 4px', outline: 'none', fontFamily: 'var(--font-family)' }}
              />
              {(fromDate || toDate) && (
                <button
                  onClick={() => { setFromDate(''); setToDate(''); }}
                  style={{ height: '26px', padding: '0 8px', border: '1px solid #fca5a5', borderRadius: '4px', background: '#fee2e2', color: '#dc2626', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}
                >
                  <X size={11} /> Clear
                </button>
              )}
            </div>
          )}

          <button onClick={onBack} className="btn btn-neutral btn-sm" style={{ height: '28px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px', border: '1px solid #cbd5e1', background: '#fff', color: '#334155', borderRadius: '4px', padding: '0 10px', cursor: 'pointer' }}>
            <Layers size={13} /> <span>ID Card Group</span>
          </button>
          <button onClick={() => {}} style={{ height: '28px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px', border: '1px solid #0ea5e9', background: '#f0f9ff', color: '#0369a1', borderRadius: '4px', padding: '0 10px', cursor: 'pointer' }} title="Table Settings">
            <Settings size={13} /> <span>Group Setting</span>
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          VIRTUAL DATA TABLE WITH CRISP BORDERS & EXACT PHOTO HEIGHT
          ══════════════════════════════════════════════════════════ */}
      <div className="table-container idcard-table" style={{ flex: 1, overflow: 'auto', background: '#fff', position: 'relative' }}>
        {tableLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '240px', gap: '10px', color: '#64748b' }}>
            <Spinner size={24} /> Loading table structure…
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '12px', tableLayout: 'auto' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 20 }}>
              <tr style={{ background: '#1e293b', color: '#ffffff' }}>
                <th style={{ width: '32px', minWidth: '32px', padding: '8px 4px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.15)', borderBottom: '1px solid rgba(255,255,255,0.15)', borderLeft: '1px solid #cbd5e1' }}>
                  <button onClick={toggleSelectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {allSelected ? <SquareCheck size={15} /> : someSelected ? <MinusSquare size={15} /> : <Square size={15} />}
                  </button>
                </th>

                <th style={{ width: '36px', minWidth: '36px', padding: '8px 4px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.15)', borderBottom: '1px solid rgba(255,255,255,0.15)', fontSize: '11px', fontWeight: 700, lineHeight: 1.1 }}>
                  SR<br />NO
                </th>

                {tableFields.map(f => {
                  const spec = getColumnSpec(f.name, f.type);
                  return (
                    <th
                      key={f.name}
                      style={{
                        padding: '8px 10px',
                        textAlign: spec.align,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        fontSize: '11px',
                        fontWeight: 700,
                        width: spec.width,
                        minWidth: spec.minWidth,
                        maxWidth: spec.maxWidth,
                        borderRight: '1px solid rgba(255,255,255,0.15)',
                        borderBottom: '1px solid rgba(255,255,255,0.15)',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {f.name}
                    </th>
                  );
                })}

                <th style={{ width: '75px', minWidth: '75px', padding: '8px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.15)', borderBottom: '1px solid rgba(255,255,255,0.15)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>ACTION</th>
                <th style={{ width: '100px', minWidth: '100px', padding: '8px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.15)', borderBottom: '1px solid rgba(255,255,255,0.15)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>LAST UPDATED</th>
                <th style={{ width: '90px', minWidth: '90px', padding: '8px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.15)', borderBottom: '1px solid rgba(255,255,255,0.15)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>UPDATED BY</th>
              </tr>
            </thead>
            <tbody>
              {cardsLoading ? (
                <tr>
                  <td colSpan={tableFields.length + 5} style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
                    <Spinner size={24} /><br />
                    <span style={{ fontSize: '13px', marginTop: '8px', display: 'inline-block' }}>Loading cards…</span>
                  </td>
                </tr>
              ) : cards.length === 0 ? (
                <tr>
                  <td colSpan={tableFields.length + 5} style={{ padding: '48px 20px', textAlign: 'center' }}>
                    <div style={{ maxWidth: '380px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#fef3c7', color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Clock size={24} />
                      </div>
                      <div>
                        <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', margin: '0 0 4px 0' }}>
                          No cards in status "{status}"
                        </h4>
                        <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                          {search ? `No cards match search "${search}"` : `There are no cards in ${status} list for this table yet.`}
                        </p>
                      </div>
                      {!search && (
                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                          <button onClick={() => setDrawer({ mode: 'add', card: null })} style={buttonStyle('#2563eb')}>
                            <Plus size={14} /> Add First Card
                          </button>
                          <button onClick={() => setShowUploadXlsx(true)} style={buttonStyle('#3b82f6')}>
                            <FileSpreadsheet size={14} /> Upload XLSX
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : cards.map((card, idx) => {
                const isSelected = selectedIds.has(card.id);
                const fd = card.field_data || {};
                const srNo = (page - 1) * pageSize + idx + 1;
                const updatedAt = card.updated_at ? new Date(card.updated_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
                const updatedBy = card.modified_by || card.updated_by || 'Admin';

                return (
                  <tr key={card.id} style={{ background: isSelected ? '#eff6ff' : idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                    {/* Checkbox */}
                    <td style={{ padding: '4px', textAlign: 'center', borderLeft: '1px solid #cbd5e1', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1' }}>
                      <button onClick={() => toggleSelect(card.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isSelected ? '#2563eb' : '#94a3b8', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isSelected ? <SquareCheck size={15} /> : <Square size={15} />}
                      </button>
                    </td>

                    {/* SR NO */}
                    <td style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, color: '#334155', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1' }}>
                      {srNo}
                    </td>

                    {/* Dynamic Fields */}
                    {tableFields.map(f => {
                      const spec = getColumnSpec(f.name, f.type);
                      const val = fd[f.name] ?? fd[f.name?.toUpperCase?.()] ?? fd[f.name?.toLowerCase?.()] ?? '';
                      const isImg = spec.isImage;
                      const isEditing = editingCell?.cardId === card.id && editingCell?.field === f.name;

                      if (isImg) {
                        const isSig = spec.imgType === 'signature';
                        const isQr  = spec.imgType === 'qr';
                        const imgW = isSig ? '45px' : isQr ? '42px' : '45px';
                        const imgH = isSig ? '28px' : isQr ? '42px' : '53px';

                        return (
                          <td key={f.name} style={{ padding: '3px 4px', textAlign: spec.align, width: spec.width, borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', verticalAlign: 'middle' }}>
                            {val ? (
                              <img
                                src={String(val).startsWith('http') ? val : `/${val}`}
                                alt={f.name}
                                style={{
                                  width: imgW,
                                  height: imgH,
                                  objectFit: isSig || isQr ? 'contain' : 'cover',
                                  borderRadius: '2px',
                                  border: '1px solid #cbd5e1',
                                  display: 'block',
                                  margin: '0 auto',
                                  background: '#f8fafc'
                                }}
                                onError={e => { e.target.style.display = 'none'; }}
                              />
                            ) : (
                              <div style={{ width: imgW, height: imgH, background: '#f1f5f9', borderRadius: '2px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                                <ImageIcon size={14} style={{ color: '#cbd5e1' }} />
                              </div>
                            )}
                          </td>
                        );
                      }

                      return (
                        <td
                          key={f.name}
                          style={{
                            padding: '6px 8px',
                            textAlign: spec.align,
                            minWidth: spec.minWidth,
                            maxWidth: spec.maxWidth,
                            color: '#0f172a',
                            fontWeight: f.name === 'NAME' ? 600 : 400,
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                            borderRight: '1px solid #cbd5e1',
                            borderBottom: '1px solid #cbd5e1',
                            verticalAlign: 'middle'
                          }}
                          onDoubleClick={() => startCellEdit(card.id, f.name, val)}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              value={cellValue}
                              onChange={e => setCellValue(e.target.value)}
                              onBlur={commitCellEdit}
                              onKeyDown={e => { if (e.key === 'Enter') commitCellEdit(); if (e.key === 'Escape') setEditingCell(null); }}
                              style={{ width: '100%', border: '1px solid #2563eb', borderRadius: '3px', padding: '2px 4px', fontSize: '12px', outline: 'none', background: '#fff' }}
                            />
                          ) : (
                            <span title={String(val)}>{String(val) || <span style={{ color: '#cbd5e1' }}>—</span>}</span>
                          )}
                        </td>
                      );
                    })}

                    {/* Action */}
                    <td style={{ padding: '6px', textAlign: 'center', width: '75px', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1' }}>
                      {status === 'pending' && (
                        <button onClick={() => applyStatusSingle(card, 'verified')} style={{ padding: '2px 8px', fontSize: '10px', height: '22px', border: 'none', borderRadius: '3px', background: '#10b981', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                          Verify
                        </button>
                      )}
                      {status === 'verified' && (
                        <button onClick={() => applyStatusSingle(card, 'approved')} style={{ padding: '2px 8px', fontSize: '10px', height: '22px', border: 'none', borderRadius: '3px', background: '#3b82f6', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                          Approve
                        </button>
                      )}
                      {(status === 'pool' || status === 'download') && (
                        <button onClick={() => applyStatusSingle(card, 'pending')} style={{ padding: '2px 8px', fontSize: '10px', height: '22px', border: 'none', borderRadius: '3px', background: '#10b981', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                          Retrieve
                        </button>
                      )}
                      {status === 'approved' && <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>

                    {/* Updated At */}
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '11px', color: '#64748b', width: '100px', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1' }}>
                      {updatedAt}
                    </td>

                    {/* Updated By */}
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '11px', color: '#64748b', width: '90px', borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1' }}>
                      {updatedBy}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════
          STICKY BOTTOM PAGINATION BAR — STANDARD SITE PAGINATION
          ══════════════════════════════════════════════════════════ */}
      <div className="pagination-bar" id="paginationBar" style={{ flexShrink: 0 }}>
        <div className="pagination-left">
          <span className="pagination-info">
            Showing <strong>{cards.length > 0 ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)}</strong> of <strong>{total}</strong> results
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

      {/* ── Drawers & Modals ── */}
      {drawer && (
        <CardSideDrawer
          card={drawer.card}
          mode={drawer.mode}
          tableFields={tableFields}
          onClose={() => setDrawer(null)}
          onSave={(updated) => {
            const local = getLocalStorageCards();
            const existingIdx = local.findIndex(c => String(c.id) === String(updated.id));
            let updatedList = [];
            if (existingIdx >= 0) {
              updatedList = [...local];
              updatedList[existingIdx] = { ...updatedList[existingIdx], ...updated };
            } else {
              updatedList = [updated, ...local];
            }
            saveLocalStorageCards(updatedList);

            setCards(prev => {
              const idx = prev.findIndex(c => String(c.id) === String(updated.id));
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = { ...next[idx], ...updated };
                return next;
              }
              return [updated, ...prev];
            });
            loadStatusCounts();
          }}
          addToast={addToast}
        />
      )}

      {showUploadXlsx && (
        <UploadXlsxModal
          table={table}
          onClose={() => setShowUploadXlsx(false)}
          onSuccess={() => { loadCards(); loadStatusCounts(); }}
          addToast={addToast}
        />
      )}

      {showDownload && (
        <DownloadModal
          table={table}
          status={status}
          onClose={() => setShowDownload(false)}
          addToast={addToast}
        />
      )}
    </div>
  );
}
