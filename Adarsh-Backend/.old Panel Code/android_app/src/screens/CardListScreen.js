import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, TextInput, ScrollView,
  Dimensions,
} from 'react-native';
import { DynamicIcon, IconSearch, IconCheck } from '../components/Icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CardItem from '../components/CardItem';
import TopBar from '../components/TopBar';
import { CardListSkeleton } from '../components/Skeleton';
import { ErrorBanner } from '../components/NetworkGuard';
import Toast from '../components/Toast';
import CardModalForm from '../components/CardModalForm';
import ConfirmModal from '../components/ConfirmModal';
import FilterDrawer from '../components/FilterDrawer';
import { apiGet, apiPost } from '../api/client';
import { colors, gradients, shadows, radius } from '../theme';
import { useAuth } from '../context/AuthContext';

const { width } = Dimensions.get('window'); // eslint-disable-line no-unused-vars

const STATUS_OPTIONS = [
  { key: 'pending',  label: 'Pending',  bg: '#fffbeb', c: '#f59e0b', icon: 'clock' },
  { key: 'verified', label: 'Verified', bg: '#ecfdf5', c: '#10b981', icon: 'check' },
  { key: 'approved', label: 'Approved', bg: '#eff6ff', c: '#3b82f6', icon: 'thumbs-up' },
  { key: 'download', label: 'Download', bg: '#f5f3ff', c: '#8b5cf6', icon: 'download' },
  { key: 'pool',     label: 'Pool',     bg: '#fef2f2', c: '#ef4444', icon: 'archive' },
];

export default function CardListScreen({ navigation, route }) {
  const { tableId, status: initialStatus } = route?.params || {};
  const { user } = useAuth();
  const perms = useMemo(() => ({
    ...(user?.permissions || {}),
    isSuperAdmin: !!(user?.isSuperAdmin || user?.role === 'super_admin' || user?.role === 'admin'),
    role: user?.role,
  }), [user]);
  const insets = useSafeAreaInsets();

  const allowedStatuses = useMemo(() => {
    return STATUS_OPTIONS.filter(opt => {
      const p = {
        pending:  'perm_idcard_pending_list',
        verified: 'perm_idcard_verified_list',
        approved: 'perm_idcard_approved_list',
        download: 'perm_idcard_download_list',
        pool:     'perm_idcard_pool_list',
      }[opt.key];
      return (user?.isSuperAdmin) || !p || perms[p];
    });
  }, [user, perms]);

  // ── State ────────────────────────────────────────────────────────────────
  const [currentStatus, setCurrentStatus] = useState(() => {
    if (initialStatus && allowedStatuses.some(s => s.key === initialStatus)) return initialStatus;
    return allowedStatuses[0]?.key || 'pending';
  });

  const [cards, setCards]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [page, setPage]                 = useState(1);
  const [hasMore, setHasMore]           = useState(false);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [tableName, setTableName]       = useState('');
  const [tableCounts, setTableCounts]   = useState({});
  const [error, setError]               = useState(null);
  const [toast, setToast]               = useState({ visible: false, message: '', type: 'info' });

  const [selectMode, setSelectMode]       = useState(false);
  const [selectedIds, setSelectedIds]     = useState(new Set());
  const [bulkLoading, setBulkLoading]     = useState(false);
  const [selectAllLoading, setSelectAllLoading] = useState(false);

  const [searchQuery, setSearchQuery]     = useState('');
  const [activeFilters, setActiveFilters] = useState({});
  const hasActiveFilters = useMemo(() => {
    return Object.keys(activeFilters).some(key => 
      key !== 'sort' && 
      key !== 'image_column' && 
      activeFilters[key] !== null && 
      activeFilters[key] !== undefined && 
      activeFilters[key] !== ''
    );
  }, [activeFilters]);
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [totalCount, setTotalCount]       = useState(0);

  const [showForm, setShowForm]           = useState(false);
  const [editingCardId, setEditingCardId] = useState(null);

  const [confirmModal, setConfirmModal]   = useState({
    visible: false, title: '', message: '', icon: '', color: colors.brandPrimary,
    onConfirm: null, statusFrom: '', statusTo: '',
  });

  // ── Refs ─────────────────────────────────────────────────────────────────
  const searchDebounceRef   = useRef(null);
  const isFirstSearchMount  = useRef(true);
  // Keep a ref to the latest loadCards so debounce can call it without stale closure
  const loadCardsRef        = useRef(null);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const showToast = useCallback(
    (message, type = 'info') => setToast({ visible: true, message, type }),
    [],
  );

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  // ── Data loading ─────────────────────────────────────────────────────────
  const loadCards = useCallback(async (pageNum = 1, append = false) => {
    if (pageNum === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const params = { page: pageNum, status: currentStatus, search: searchQuery, ...activeFilters };
      const { ok, data } = await apiGet(`/api/mobile/table/${tableId}/cards/`, params);

      if (ok && data?.success) {
        const fetchedCards  = data.data?.cards || [];
        const tableFields   = data.data?.table?.fields || [];
        const mappedCards   = fetchedCards.map(c => ({ ...c, ordered_fields: tableFields }));

        setCards(prev => append ? [...prev, ...mappedCards] : mappedCards);
        setHasMore(data.data?.has_more || false);
        setTableName(data.data?.table?.name || '');
        setTotalCount(data.data?.total || 0);
        setTableCounts(data.data?.counts || {});
      } else {
        setError(data?.message || 'Failed to load cards');
      }
    } catch (e) {
      setError('Network error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [tableId, currentStatus, searchQuery, activeFilters]);

  // Keep ref in sync with the latest loadCards
  useEffect(() => { loadCardsRef.current = loadCards; }, [loadCards]);

  useFocusEffect(useCallback(() => { loadCards(1); }, [loadCards]));

  // Debounced search – fires 400ms after user stops typing; skips initial mount
  useEffect(() => {
    if (isFirstSearchMount.current) {
      isFirstSearchMount.current = false;
      return;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setPage(1);
      // Use ref so we always call the latest loadCards, avoiding stale closure
      if (loadCardsRef.current) loadCardsRef.current(1);
    }, 400);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]); // intentionally only [searchQuery] — we use ref to avoid stale closure

  // Clear selection when status / filters / table changes
  useEffect(() => {
    exitSelectMode();
  }, [currentStatus, activeFilters, tableId, exitSelectMode]);

  const onRefresh  = useCallback(() => { setRefreshing(true); setPage(1); loadCards(1); }, [loadCards]);
  const loadMore   = useCallback(() => {
    if (hasMore && !loadingMore && !loading) {
      const next = page + 1;
      setPage(next);
      loadCards(next, true);
    }
  }, [hasMore, loadingMore, loading, page, loadCards]);

  // ── Selection ─────────────────────────────────────────────────────────────
  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectMode(next.size > 0);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(async () => {
    const currentPageIds       = cards.map(c => c.id);
    const currentlyAllSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));

    // If every record is already selected → deselect all
    if (currentlyAllSelected && selectedIds.size === totalCount) {
      setSelectedIds(new Set());
      setSelectMode(false);
      return;
    }

    // If some (but not all) of the current page are selected → deselect current page
    if (!currentlyAllSelected && selectedIds.size > 0) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        currentPageIds.forEach(id => next.delete(id));
        setSelectMode(next.size > 0);
        return next;
      });
      return;
    }

    // Fetch ALL matching IDs from server (respects current filters & search)
    setSelectAllLoading(true);
    try {
      const params = { status: currentStatus, search: searchQuery, ...activeFilters };
      const { ok, data } = await apiGet(`/api/mobile/table/${tableId}/cards/all-ids/`, params);
      if (ok && data?.card_ids) {
        const allIds = data.card_ids;
        setSelectedIds(new Set(allIds));
        setSelectMode(allIds.length > 0);
      } else {
        // Fallback: select current page only
        setSelectedIds(prev => {
          const next = new Set(prev);
          currentPageIds.forEach(id => next.add(id));
          setSelectMode(true);
          return next;
        });
      }
    } catch (_e) {
      // Fallback: select current page only
      setSelectedIds(prev => {
        const next = new Set(prev);
        currentPageIds.forEach(id => next.add(id));
        setSelectMode(true);
        return next;
      });
    } finally {
      setSelectAllLoading(false);
    }
  }, [cards, selectedIds, totalCount, currentStatus, searchQuery, activeFilters, tableId, showToast]);
  
  // Helper to update local list and counts after a successful card action
  const updateCardStateLocally = useCallback((idsArray, fromStatus, toStatus) => {
    // 1. Remove the IDs from the cards array
    setCards(prev => prev.filter(c => !idsArray.includes(c.id)));
    
    // 2. Adjust total count
    setTotalCount(prev => Math.max(0, prev - idsArray.length));
    
    // 3. Update tableCounts locally
    setTableCounts(prev => {
      const next = { ...prev };
      const count = idsArray.length;
      if (fromStatus && next[fromStatus] !== undefined) {
        next[fromStatus] = Math.max(0, next[fromStatus] - count);
      }
      if (toStatus && next[toStatus] !== undefined) {
        next[toStatus] = (next[toStatus] || 0) + count;
      }
      return next;
    });
  }, []);

  // ── Bulk actions ──────────────────────────────────────────────────────────
  const handleBulkStatus = useCallback((newStatus) => {
    if (selectedIds.size === 0) return;
    const statusStr = typeof newStatus === 'string' ? newStatus : (newStatus?.status || 'pending');

    let title   = 'Bulk Confirm Action?';
    let message = `Are you sure you want to update ${selectedIds.size} records?`;
    let icon    = 'check';
    let color   = colors.brandPrimary;
    let note    = `This will update all ${selectedIds.size} selected records.`;

    if (currentStatus === 'pending' && statusStr === 'verified') {
      title = 'Verify Selected Cards?'; icon = 'verified'; color = '#10b981';
      note  = `This will move ${selectedIds.size} selected records to Verified list.`;
    } else if (currentStatus === 'verified' && statusStr === 'approved') {
      title = 'Approve Selected Cards?'; icon = 'thumbs-up'; color = '#3b82f6';
      note  = `This will move ${selectedIds.size} selected records to Approved list.`;
    } else if (currentStatus === 'verified' && statusStr === 'pending') {
      title = 'Unverify Selected Cards?'; icon = 'redo'; color = '#f59e0b';
      note  = `This will move ${selectedIds.size} selected records back to Pending list.`;
    } else if (currentStatus === 'approved' && statusStr === 'verified') {
      title = 'Disapprove Selected Cards?'; icon = 'redo'; color = '#f59e0b';
      note  = `This will move ${selectedIds.size} selected records back to Verified list.`;
    } else if (currentStatus === 'download' && statusStr === 'pending') {
      title = 'Retrieve Selected Cards?'; icon = 'redo'; color = '#3b82f6';
      note  = `This will move ${selectedIds.size} selected records back to Pending list.`;
    } else if (currentStatus === 'pool' && statusStr === 'pending') {
      title = 'Retrieve Selected Cards?'; icon = 'redo'; color = '#3b82f6';
      note  = `This will move ${selectedIds.size} selected records back to Pending list.`;
    } else if (statusStr === 'pool') {
      title   = 'Delete Selected Cards?';
      message = `Are you sure you want to delete ${selectedIds.size} records?`;
      icon    = 'trash'; color = colors.red;
      note    = `This will move ${selectedIds.size} selected records to the Pool list.`;
    } else if (statusStr === 'permanent_delete') {
      title   = 'Permanently Delete Selected?';
      message = `Are you sure you want to permanently delete ${selectedIds.size} records?`;
      icon    = 'trash'; color = colors.red;
      note    = 'WARNING: This action cannot be undone and will permanently erase these records from the database.';
    } else {
      const opt = STATUS_OPTIONS.find(o => o.key === statusStr) || STATUS_OPTIONS[0];
      title = `${opt?.label} Selected Cards?`;
    }

    setConfirmModal({
      visible: true, title, message, icon, color,
      statusFrom: currentStatus, statusTo: statusStr, note,
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        setBulkLoading(true);
        try {
          const idsArray = Array.from(selectedIds);
          let res;
          if (statusStr === 'permanent_delete') {
            res = await apiPost(`/api/table/${tableId}/cards/bulk-delete/`, {
              card_ids: idsArray,
            });
          } else {
            res = await apiPost(`/api/mobile/table/${tableId}/bulk-status/`, {
              card_ids: idsArray,
              status: statusStr,
            });
          }
          const { data } = res;
          if (data?.success) {
            showToast(data.message || 'Updated successfully', 'success');
            updateCardStateLocally(idsArray, currentStatus, statusStr === 'permanent_delete' ? null : statusStr);
            exitSelectMode();
          } else {
            showToast(data?.message || 'Update failed', 'error');
          }
        } catch (_e) {
          showToast('Network error', 'error');
        } finally {
          setBulkLoading(false);
        }
      },
    });
  }, [selectedIds, currentStatus, tableId, showToast, exitSelectMode, updateCardStateLocally]);

  // ── Single card actions ───────────────────────────────────────────────────
  const handleSingleStatus = useCallback(async (id, newStatus) => {
    try {
      const { data } = await apiPost(`/api/mobile/card/${id}/status/`, { status: newStatus });
      if (data?.success) { 
        showToast(data.message || 'Updated', 'success'); 
        updateCardStateLocally([id], currentStatus, newStatus);
      }
      else showToast(data?.message || 'Failed', 'error');
    } catch (_e) { showToast('Network error', 'error'); }
  }, [showToast, currentStatus, updateCardStateLocally]);

  const handleSingleDelete = useCallback((cardOrId) => {
    const id = (cardOrId && typeof cardOrId === 'object') ? cardOrId.id : cardOrId;
    setConfirmModal({
      visible: true, title: 'Delete Card?',
      message: 'Are you sure you want to delete this record?',
      icon: 'trash', color: colors.red,
      statusFrom: currentStatus, statusTo: 'pool',
      note: 'This will move the record to the Pool list.',
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        try {
          const { data } = await apiPost(`/api/mobile/card/${id}/delete/`, {});
          if (data?.success) { 
            showToast('Moved to Pool', 'success'); 
            updateCardStateLocally([id], currentStatus, 'pool');
          }
          else showToast(data?.message || 'Failed', 'error');
        } catch (_e) { showToast('Network error', 'error'); }
      },
    });
  }, [currentStatus, showToast, updateCardStateLocally]);

  const handleSingleReprint = useCallback((card) => {
    const fd = card.field_data || {};
    const cardName = card.name || fd.NAME || fd.Name || fd.name || `Card #${card.id}`;
    
    setConfirmModal({
      visible: true,
      title: 'Reprint Card?',
      message: `Are you sure you want to create a reprint request for ${cardName}?`,
      icon: 'redo',
      color: colors.yellow,
      statusFrom: currentStatus,
      statusTo: 'reprint',
      note: 'This will move the card to the Reprint Request list.',
      onConfirm: async () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        try {
          const { data } = await apiPost(`/reprint/api/table/${tableId}/request/`, {
            card_ids: [card.id],
            reason: '',
          });
          if (data?.status === 'ok') {
            showToast(data.message || 'Reprint request created', 'success');
            // Reprint request created successfully. Does not change download status,
            // but increments reprint tab counts.
            setTableCounts(prev => ({
              ...prev,
              reprint: (prev.reprint || 0) + 1,
            }));
          } else {
            showToast(data?.message || 'Failed to create reprint request', 'error');
          }
        } catch (_e) {
          showToast('Network error', 'error');
        }
      },
    });
  }, [tableId, currentStatus, showToast]);

  const handleStatusChange = useCallback((id, newStatus) => {
    const statusStr = typeof newStatus === 'string' ? newStatus : (newStatus?.status || 'pending');
    let title   = 'Confirm Action?';
    let message = 'Are you sure you want to update this record?';
    let icon    = 'check';
    let color   = colors.brandPrimary;
    let note    = '';

    if (currentStatus === 'pending' && statusStr === 'verified') {
      title = 'Verify Card?'; message = 'Are you sure you want to verify this record?';
      icon = 'verified'; color = '#10b981'; note = 'This will move the record to Verified list.';
    } else if (currentStatus === 'verified' && statusStr === 'approved') {
      title = 'Approve Card?'; message = 'Are you sure you want to approve this record?';
      icon = 'thumbs-up'; color = '#3b82f6'; note = 'This will move the record to Approved list.';
    } else if (currentStatus === 'verified' && statusStr === 'pending') {
      title = 'Unverify Card?'; message = 'Are you sure you want to move this record from Verified to Pending?';
      icon = 'redo'; color = '#f59e0b'; note = 'This will move the record back to Pending list.';
    } else if (currentStatus === 'approved' && statusStr === 'verified') {
      title = 'Disapprove Card?'; message = 'Are you sure you want to move this record from Approved to Verified list?';
      icon = 'redo'; color = '#f59e0b'; note = 'This will move the record back to Verified list.';
    } else if (currentStatus === 'download' && statusStr === 'pending') {
      title = 'Retrieve Card?'; message = 'Are you sure you want to move this record from Download to Pending list?';
      icon = 'redo'; color = '#3b82f6'; note = 'This will move the record back to Pending list.';
    } else if (currentStatus === 'pool' && statusStr === 'pending') {
      title = 'Retrieve Card?'; message = 'Are you sure you want to move this record from Pool to Pending list?';
      icon = 'redo'; color = '#ef4444'; note = 'This will move the record back to Pending list.';
    } else {
      const opt = STATUS_OPTIONS.find(o => o.key === statusStr) || STATUS_OPTIONS[0];
      title = `${opt?.label} Card?`;
      message = `Move to the ${opt?.label} list?`;
      icon = opt?.icon || 'check';
      color = opt?.c || colors.brandPrimary;
    }

    setConfirmModal({
      visible: true, title, message, icon, color,
      statusFrom: currentStatus, statusTo: statusStr, note,
      onConfirm: () => {
        setConfirmModal(p => ({ ...p, visible: false }));
        handleSingleStatus(id, statusStr);
      },
    });
  }, [currentStatus, handleSingleStatus]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const allSelected = useMemo(
    () => cards.length > 0 && cards.every(c => selectedIds.has(c.id)),
    [cards, selectedIds],
  );

  const isClientRole = perms.role === 'client' || perms.role === 'client_staff' || perms.role === 'guest_user';
  const hasReprintPerm = perms.perm_idcard_reprint_list || perms.perm_reprint_request_list || perms.perm_confirmed_list;

  const canSelect = useMemo(() => {
    if (!isClientRole) return true;
    if (currentStatus === 'pending') {
      return !!(perms.perm_idcard_verify || perms.perm_idcard_approve || perms.perm_idcard_delete);
    }
    if (currentStatus === 'verified') {
      return !!(perms.perm_idcard_verify || perms.perm_idcard_approve);
    }
    if (currentStatus === 'approved') {
      return !isClientRole && !!perms.perm_idcard_approve;
    }
    if (currentStatus === 'download') {
      return !isClientRole && !!perms.perm_idcard_retrieve;
    }
    if (currentStatus === 'pool') {
      return !!(perms.perm_idcard_retrieve || isClientRole);
    }
    return false;
  }, [isClientRole, currentStatus, perms]);

  const handleEditCard = useCallback((card) => {
    setEditingCardId(card.id);
    setShowForm(true);
  }, []);

  const renderItem = useCallback(({ item }) => {
    const isClient = perms.role === 'client' || perms.role === 'client_staff' || perms.role === 'guest_user';
    const canEdit = perms.perm_idcard_edit && (!isClient || ['pending', 'verified'].includes(currentStatus));
    const canDelete = currentStatus === 'pending' && perms.perm_idcard_delete;
    const statusChangeHandler = isClient && (
      currentStatus === 'approved' ||
      currentStatus === 'download'
    ) ? undefined : handleStatusChange;

    return (
      <CardItem
        item={item}
        showCheckbox={canSelect}
        isSelected={selectedIds.has(item.id)}
        onToggleSelect={toggleSelect}
        onEdit={canEdit ? handleEditCard : undefined}
        currentStatus={currentStatus}
        onStatusChange={statusChangeHandler}
        onDelete={canDelete ? handleSingleDelete : undefined}
        onReprint={(perms.perm_idcard_reprint_list || perms.perm_reprint_request_list) ? handleSingleReprint : undefined}
        permissions={perms}
      />
    );
  }, [selectedIds, perms, currentStatus, toggleSelect, handleStatusChange, handleSingleDelete, handleSingleReprint, handleEditCard, canSelect]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <TopBar
        title={selectMode ? `${selectedIds.size} SELECTED` : `${currentStatus.toUpperCase()} LIST`}
        subtitle={tableName}
        onBack={selectMode ? exitSelectMode : () => navigation.goBack()}
        onAdd={(currentStatus === 'pending' && perms.perm_idcard_add) ? () => { setEditingCardId(null); setShowForm(true); } : undefined}
        rightAction={hasReprintPerm ? {
          onPress: () => navigation.navigate('ReprintDetail', { tableId }),
          icon: 'redo'
        } : undefined}
      />

      {/* Status tabs */}
      <View style={s.tabContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabScroll}>
          {allowedStatuses.map(opt => (
            <TouchableOpacity
              key={opt.key}
              onPress={() => {
                setCurrentStatus(opt.key);
                setPage(1);
                setSearchQuery('');
                setActiveFilters({});
              }}
              style={[s.tabItem, currentStatus === opt.key && { backgroundColor: opt.c, borderColor: opt.c }]}
            >
              <Text style={[s.tabLabel, { color: currentStatus === opt.key ? '#fff' : opt.c }]}>{opt.label}</Text>
              <View style={[s.tabCount, { backgroundColor: currentStatus === opt.key ? 'rgba(255,255,255,0.2)' : `${opt.c}15` }]}>
                <Text style={[s.tabCountText, { color: currentStatus === opt.key ? '#fff' : opt.c }]}>{tableCounts[opt.key] || 0}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Search + Filter row */}
      <View style={s.headerActions}>
        <View style={s.searchWrap}>
          <IconSearch size={14} color={colors.gray400} />
          <TextInput
            style={s.searchInput}
            placeholder="Search name, roll, mobile..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
              setPage(1);
              loadCards(1);
            }}
            clearButtonMode="while-editing"
          />
        </View>
        {hasActiveFilters ? (
          <TouchableOpacity onPress={() => { setActiveFilters({}); setPage(1); }} style={[s.filterBtn, s.filterBtnActive]}>
            <DynamicIcon name="times" size={14} color="#ef4444" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setShowFilterDrawer(true)} style={s.filterBtn}>
            <DynamicIcon name="filter" size={14} color={colors.brandPrimary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Select-all bar */}
      {canSelect && (
        <View style={s.summaryRow}>
          <TouchableOpacity style={s.selectAllBtn} onPress={handleSelectAll} disabled={selectAllLoading}>
            {selectAllLoading
              ? <ActivityIndicator size="small" color={colors.brandPrimary} style={{ marginRight: 8 }} />
              : <View style={[s.checkboxSmall, allSelected && s.checkboxCheckedSmall]}>
                  {allSelected && <IconCheck size={8} color="#fff" />}
                </View>
            }
            <Text style={s.selectAllText}>
              {/* eslint-disable-next-line no-nested-ternary */}
              {selectAllLoading
                ? 'SELECTING...'
                : (selectedIds.size === totalCount && totalCount > 0)
                  ? 'DESELECT ALL'
                  : selectedIds.size > 0
                    ? `${selectedIds.size} SELECTED`
                    : 'SELECT ALL'}
            </Text>
          </TouchableOpacity>
          <Text style={s.totalText}>{totalCount} RECORDS</Text>
        </View>
      )}

      {/* Card list */}
      {error
        ? <ErrorBanner message={error} onRetry={() => loadCards(1)} />
        : loading
          ? <CardListSkeleton />
          : (
            <FlatList
              data={cards}
              renderItem={renderItem}
              keyExtractor={item => item.id.toString()}
              extraData={selectedIds}
              contentContainerStyle={s.list}
              keyboardShouldPersistTaps="handled"
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              ListFooterComponent={loadingMore ? <ActivityIndicator style={{ padding: 20 }} color={colors.brandPrimary} /> : null}
              ListEmptyComponent={<View style={s.empty}><Text style={s.emptyText}>No cards found</Text></View>}
            />
          )
      }

      {/* Bulk action floating bar */}
      {canSelect && selectMode && (
        <View style={[s.floatingBar, { bottom: Math.max(insets.bottom, 16) + 16 }]}>
          <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.floatingGradient}>
            <View style={s.floatingInfo}>
              <Text style={s.floatingCount}>{selectedIds.size} SELECTED</Text>
              <TouchableOpacity onPress={exitSelectMode} disabled={bulkLoading} style={s.floatingCancelIconBtn}>
                {bulkLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <DynamicIcon name="times" size={14} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.fActions}>
              {currentStatus === 'pending'  && perms.perm_idcard_verify  && <FBtn icon="check"        label="VERIFY SELECTED"  disabled={bulkLoading} onPress={() => handleBulkStatus('verified')} />}
              {currentStatus === 'pending'  && perms.perm_idcard_delete && <FBtn icon="trash" label="DELETE SELECTED" color="#ef4444" disabled={bulkLoading} onPress={() => handleBulkStatus('pool')} />}
              
              {currentStatus === 'verified' && perms.perm_idcard_approve && <FBtn icon="check-double" label="APPROVE SELECTED" disabled={bulkLoading} onPress={() => handleBulkStatus('approved')} />}
              {currentStatus === 'verified' && perms.perm_idcard_verify  && <FBtn icon="redo"         label="UNVERIFY SELECTED" color="#f59e0b" disabled={bulkLoading} onPress={() => handleBulkStatus('pending')} />}
              
              {currentStatus === 'approved' && perms.perm_idcard_approve && !isClientRole && <FBtn icon="redo"         label="DISAPPROVE SELECTED" color="#f59e0b" disabled={bulkLoading} onPress={() => handleBulkStatus('verified')} />}
              
              {currentStatus === 'download' && perms.perm_idcard_retrieve && !isClientRole && <FBtn icon="redo"         label="RETRIEVE SELECTED" color="#3b82f6" disabled={bulkLoading} onPress={() => handleBulkStatus('pending')} />}
              
              {currentStatus === 'pool'     && (perms.perm_idcard_retrieve || isClientRole) && <FBtn icon="redo"         label="RETRIEVE FROM POOL" color="#3b82f6" disabled={bulkLoading} onPress={() => handleBulkStatus('pending')} />}
              {currentStatus === 'pool'     && perms.perm_idcard_delete_from_pool && !isClientRole && <FBtn icon="trash" label="PERMANENTLY DELETE SELECTED" color="#ef4444" disabled={bulkLoading} onPress={() => handleBulkStatus('permanent_delete')} />}
            </ScrollView>
          </LinearGradient>
        </View>
      )}

      {/* Modals */}
      <FilterDrawer
        visible={showFilterDrawer}
        onClose={() => setShowFilterDrawer(false)}
        tableId={tableId}
        status={currentStatus}
        currentFilters={activeFilters}
        onApply={f => { setActiveFilters(f); setPage(1); }}
      />
      <CardModalForm
        visible={showForm}
        onClose={() => setShowForm(false)}
        tableId={tableId}
        cardId={editingCardId}
        onSuccess={(updatedCard) => {
          if (editingCardId && updatedCard) {
            setCards(prev => prev.map(c => c.id === editingCardId ? updatedCard : c));
          } else {
            onRefresh();
          }
        }}
      />
      <ConfirmModal
        visible={confirmModal.visible}
        onClose={() => setConfirmModal(p => ({ ...p, visible: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        icon={confirmModal.icon}
        confirmColor={confirmModal.color}
        statusFrom={confirmModal.statusFrom}
        statusTo={confirmModal.statusTo}
        note={confirmModal.note}
      />
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast(p => ({ ...p, visible: false }))}
      />

    </View>
  );
}

function FBtn({ icon, label, onPress, color = '#fff', disabled = false }) {
  return (
    <TouchableOpacity style={[s.fBtn, disabled && { opacity: 0.4 }]} onPress={onPress} disabled={disabled}>
      <DynamicIcon name={icon} size={12} color={color} style={{ marginRight: 8 }} />
      <Text style={[s.fBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root:                { flex: 1, backgroundColor: colors.surfaceBg },
  tabContainer:        { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tabScroll:           { paddingHorizontal: 12, paddingVertical: 8 },
  tabItem:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.xs, borderWidth: 1, borderColor: '#f1f5f9', backgroundColor: '#f8fafc', marginRight: 8 },
  tabLabel:            { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', marginRight: 6 },
  tabCount:            { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 },
  tabCountText:        { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },
  headerActions:       { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8 },
  searchWrap:          { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', height: 44, borderRadius: radius.sm, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm, marginRight: 10 },
  searchInput:         { flex: 1, marginLeft: 8, fontSize: 13, fontFamily: 'SairaSemiCondensed-Medium', color: colors.gray800 },
  filterBtn:           { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: radius.sm, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  filterBtnActive:     { backgroundColor: '#fef2f2', borderColor: '#fca5a5' },
  summaryRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  selectAllBtn:        { flexDirection: 'row', alignItems: 'center' },
  checkboxSmall:       { width: 14, height: 14, borderRadius: 3, borderWidth: 1, borderColor: colors.gray300, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  checkboxCheckedSmall:{ backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  selectAllText:       { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray600 },
  totalText:           { fontSize: 9, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400 },
  list:                { paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 100 },
  empty:               { padding: 80, alignItems: 'center' },
  emptyText:           { fontSize: 13, color: colors.gray400, fontFamily: 'SairaSemiCondensed-Medium' },
  floatingBar:         { position: 'absolute', bottom: 20, left: 12, right: 12, borderRadius: radius.sm, overflow: 'hidden', ...shadows.lg },
  floatingGradient:    { padding: 12 },
  floatingInfo:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  floatingCount:       { color: '#fff', fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold' },
  floatingCancel:      { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },
  floatingCancelIconBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  fActions:            { flexDirection: 'row', gap: 10 },
  fBtn:                { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.xs, gap: 6 },
  fBtnText:            { fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold' },
});
